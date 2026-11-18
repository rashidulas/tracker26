/**
 * The chat assistant's tools, as AI SDK tool definitions.
 *
 * Read tools run immediately. Write tools (createExpense, createIncome) need
 * the user's approval: `toolApproval` below checks each proposal against the
 * database first, then either asks the user ('user-approval', with a one-line
 * summary for the approval card) or bounces it back to the model with the
 * problem so it can fix it. The SDK runs the approval rule again when the
 * approval comes back, so a proposal that went stale in between is not saved.
 *
 * Errors thrown from execute become tool-error results the model can read and
 * recover from. Messages are written for the model; nothing raw from Zod or
 * Prisma is passed through.
 */
import { tool } from 'ai';
import { z } from 'zod';
import { isValidDay, type DayString } from '@/lib/dates';
import type { TransactionDeps } from '@/lib/transactions';
import {
  accountBalances,
  budgetStatus,
  comparePeriods,
  friendBalances,
  goalProgress,
  searchTransactions,
  summarizeTransactions,
  ToolInputError,
  upcomingRecurring,
  type ReadDb,
} from '@/lib/assistant/read';
import {
  checkProposal,
  saveProposal,
  SaveError,
  applyProposalEdit,
  type Proposal,
  type ProposalDb,
  type ProposalEdit,
  type ProposalKind,
} from '@/lib/assistant/write';

export type AssistantToolDeps = {
  db: ReadDb & ProposalDb;
  today: DayString;
  /** Overrides for lib/transactions (tests pass a fake database). */
  transactionDeps?: Partial<TransactionDeps>;
  /**
   * Changes the user made on approval cards, by tool call id. Applied when an
   * approved proposal is saved; the proposal the server signed stays as it was.
   */
  proposalEdits?: ReadonlyMap<string, ProposalEdit>;
};

// ==================== SCHEMAS ====================

const day = z
  .string()
  .refine(isValidDay, 'Use a real calendar day in YYYY-MM-DD form');

const id = z.string().min(1);

const filterFields = {
  categoryIds: z
    .array(id)
    .optional()
    .describe('Only these categories (ids from the category list). Split expenses count only their matching part.'),
  accountIds: z
    .array(id)
    .optional()
    .describe('Only these accounts (ids from the account list). Account splits count only their matching part.'),
  merchant: z.string().optional().describe('Case-insensitive part of the merchant / payer name, e.g. "costco".'),
  text: z
    .string()
    .optional()
    .describe('Case-insensitive text found in the merchant, notes or category name, or an exact tag.'),
};

const period = z.object({
  start: day.describe('First day, inclusive (YYYY-MM-DD).'),
  end: day.describe('Last day, inclusive (YYYY-MM-DD).'),
  label: z.string().optional().describe('Short label such as "March 2026".'),
});

const proposalSchema = (kind: ProposalKind) =>
  z.object({
    amount: z.number().positive().describe('Positive amount in the app currency, at most 2 decimals.'),
    date: day.describe('Calendar day it happened (YYYY-MM-DD). Use today unless the user or receipt says otherwise.'),
    categoryId: id.describe(
      `Id of ${kind === 'EXPENSE' ? 'an expense' : 'an income'} category from the category list.`
    ),
    subcategoryId: id.nullish().describe('Optional subcategory id belonging to that category.'),
    accountId: id.describe(
      kind === 'EXPENSE'
        ? 'Id of the account it was paid from. Never guess: ask if the user has not said.'
        : 'Id of the account it was paid into. Never guess: ask if the user has not said.'
    ),
    merchant: z
      .string()
      .max(100)
      .nullish()
      .describe(kind === 'EXPENSE' ? 'Merchant / payee, e.g. "Costco".' : 'Source / payer, e.g. "Acme Corp".'),
    notes: z.string().max(500).nullish(),
    tags: z.array(z.string().max(40)).max(10).nullish(),
  });

/** One approval card's edits, as sent by the browser. Unknown fields are rejected. */
export const proposalEditSchema = z
  .object({
    amount: z.number().positive().optional(),
    date: day.optional(),
    categoryId: id.optional(),
    subcategoryId: id.nullable().optional(),
    accountId: id.optional(),
    merchant: z.string().max(100).nullable().optional(),
  })
  .strict();

/** Edits for one request: tool call id → edit. */
export const proposalEditsSchema = z.record(z.string().min(1).max(200), proposalEditSchema);

// ==================== ERRORS ====================

/** Run a read, turning failures into messages the model can act on. */
async function safely<T>(name: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ToolInputError || error instanceof SaveError) throw new Error(error.message);
    console.error(`Assistant tool ${name} failed:`, error);
    throw new Error(`${name} failed because of a temporary server problem. Try once more, then tell the user it is unavailable.`);
  }
}

// ==================== TOOLS ====================

export function buildAssistantTools(deps: AssistantToolDeps) {
  const ctx = { db: deps.db, today: deps.today };

  const writeTool = (kind: ProposalKind) =>
    tool({
      description:
        kind === 'EXPENSE'
          ? 'Propose recording an expense. The user sees the proposal and must approve it before anything is saved. Call once per expense, only when amount, category and account are all known.'
          : 'Propose recording income. The user sees the proposal and must approve it before anything is saved. Call once per income, only when amount, category and account are all known.',
      inputSchema: proposalSchema(kind),
      execute: async (input, { toolCallId }) =>
        safely(kind === 'EXPENSE' ? 'createExpense' : 'createIncome', () =>
          saveProposal(kind, input as Proposal, toolCallId, {
            db: deps.db,
            tx: deps.transactionDeps,
            edit: deps.proposalEdits?.get(toolCallId),
          })
        ),
    });

  return {
    searchTransactions: tool({
      description:
        'Find individual transactions (newest first) with optional filters, paginated. Also returns the match count and the totals of all matches. Use for "show me", "when did I", "what was that" questions.',
      inputSchema: z.object({
        ...filterFields,
        kind: z.enum(['EXPENSE', 'INCOME', 'TRANSFER']).optional(),
        start: day.optional().describe('First day, inclusive.'),
        end: day.optional().describe('Last day, inclusive.'),
        minAmount: z.number().nonnegative().optional(),
        maxAmount: z.number().nonnegative().optional(),
        limit: z.number().int().min(1).max(50).optional().describe('Page size, default 20.'),
        offset: z.number().int().min(0).optional().describe('Use nextOffset from the previous page.'),
      }),
      execute: (input) => safely('searchTransactions', () => searchTransactions(ctx, input)),
    }),

    summarizeTransactions: tool({
      description:
        'Total spending (EXPENSE) or income (INCOME) over a date range, optionally grouped by category, merchant, account, day, week (Monday start) or month. Use for any "how much" question about one period.',
      inputSchema: z.object({
        ...filterFields,
        kind: z.enum(['EXPENSE', 'INCOME']),
        start: day.describe('First day, inclusive.'),
        end: day.describe('Last day, inclusive.'),
        groupBy: z.enum(['category', 'merchant', 'account', 'day', 'week', 'month', 'none']),
        limit: z.number().int().min(1).max(100).optional().describe('Max groups for category/merchant/account (default 15).'),
      }),
      execute: (input) => safely('summarizeTransactions', () => summarizeTransactions(ctx, input)),
    }),

    comparePeriods: tool({
      description:
        'Compare spending or income between two date ranges (e.g. March vs April), optionally per category, merchant or account. change = periodB − periodA.',
      inputSchema: z.object({
        ...filterFields,
        kind: z.enum(['EXPENSE', 'INCOME']),
        periodA: period,
        periodB: period,
        groupBy: z.enum(['category', 'merchant', 'account', 'none']).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
      execute: (input) => safely('comparePeriods', () => comparePeriods(ctx, input)),
    }),

    accountBalances: tool({
      description:
        'Current balance of every account (including friend settlements), money set aside for goals and what is available, credit card debt, available credit and utilisation, loan balances, and totals. Same figures as the Accounts page.',
      inputSchema: z.object({}),
      execute: () => safely('accountBalances', () => accountBalances(ctx)),
    }),

    budgetStatus: tool({
      description:
        'Budgets for a month, as on the Budgets page: each budgeted category with budget, amount rolled over, available, spent (your share), remaining, % used and status (over, near, ahead of pace, ok), plus unbudgeted spending and how far through the month it is.',
      inputSchema: z.object({
        month: z
          .string()
          .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM')
          .optional()
          .describe('YYYY-MM; defaults to the current month.'),
      }),
      execute: (input) => safely('budgetStatus', () => budgetStatus(ctx, input)),
    }),

    goalProgress: tool({
      description: 'Savings goals: target, saved so far (transferred and earmarked), remaining, linked account, due date and the monthly amount needed to finish on time.',
      inputSchema: z.object({}),
      execute: () => safely('goalProgress', () => goalProgress(ctx)),
    }),

    friendBalances: tool({
      description:
        'Who owes the user money and whom the user owes (positive balance = they owe the user). Pass friendId for that friend\'s recent entries.',
      inputSchema: z.object({ friendId: id.optional() }),
      execute: (input) => safely('friendBalances', () => friendBalances(ctx, input)),
    }),

    upcomingRecurring: tool({
      description:
        'Bills, subscriptions and paychecks due in the next N days from the recurring entries the user set up, plus repeating patterns found in past transactions that are not set up as recurring entries yet.',
      inputSchema: z.object({
        days: z.number().int().min(1).max(365).optional().describe('Look-ahead in days (default 30).'),
        kind: z.enum(['EXPENSE', 'INCOME']).optional(),
      }),
      execute: (input) => safely('upcomingRecurring', () => upcomingRecurring(ctx, input)),
    }),

    createExpense: writeTool('EXPENSE'),
    createIncome: writeTool('INCOME'),
  };
}

export type AssistantTools = ReturnType<typeof buildAssistantTools>;

/** Prefix the model is told to look for on proposals the server rejected (not the user). */
export const INVALID_PROPOSAL_PREFIX = 'Invalid proposal, nothing was shown to the user:';

/** Prefix on proposals whose user-edited version could not be saved. */
export const EDITED_PROPOSAL_PREFIX =
  'The user changed this proposal before approving, and the changed version is not valid:';

/**
 * Approval rules. Write tools are checked against the database first: a
 * valid proposal waits for the user; an invalid one is denied straight away
 * with the reason, so the model can correct it instead of the user approving
 * something that cannot be saved.
 */
export function buildToolApproval(
  deps: Pick<AssistantToolDeps, 'db' | 'proposalEdits'>
) {
  const rule = (kind: ProposalKind) => async (input: unknown, options: { toolCallId: string }) => {
    try {
      // When an approval comes back with the user's edits, the edited
      // version is the one that will be saved, so that is the one to check.
      const edit = deps.proposalEdits?.get(options.toolCallId);
      const proposal = edit ? applyProposalEdit(input as Proposal, edit) : (input as Proposal);
      const check = await checkProposal(deps.db, kind, proposal);
      if (check.ok) return { type: 'user-approval' as const, reason: check.summary };
      return {
        type: 'denied' as const,
        reason: edit
          ? `${EDITED_PROPOSAL_PREFIX} ${check.problem}. Nothing was saved. Tell the user and offer to propose it again.`
          : `${INVALID_PROPOSAL_PREFIX} ${check.problem}.`,
      };
    } catch (error) {
      console.error('Assistant proposal check failed:', error);
      return {
        type: 'denied' as const,
        reason: `${INVALID_PROPOSAL_PREFIX} the server could not check it right now. Tell the user to try again shortly.`,
      };
    }
  };
  return { createExpense: rule('EXPENSE'), createIncome: rule('INCOME') };
}
