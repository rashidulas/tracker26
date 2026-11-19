/**
 * The chat assistant's tools, as AI SDK tool definitions.
 *
 * Read tools run immediately. Write tools need the user's approval:
 * `toolApproval` below checks each proposal against the database first, then
 * either asks the user ('user-approval', with what the approval card shows)
 * or bounces it back to the model with the problem so it can fix it. The SDK
 * runs the approval rule again when the approval comes back, so a proposal
 * that went stale in between is not saved.
 *
 * createExpense and createIncome are in lib/assistant/write.ts; every other
 * write tool is an action in lib/assistant/actions.ts.
 *
 * Errors thrown from execute become tool-error results the model can read and
 * recover from. Messages are written for the model; nothing raw from Zod or
 * Prisma is passed through.
 */
import { tool } from 'ai';
import { z } from 'zod';
import { isValidDay, type DayString } from '@/lib/dates';
import type { TransactionDb, TransactionDeps } from '@/lib/transactions';
import type { PrismaClient } from '@prisma/client';
import {
  ACTIONS,
  ACTION_NAMES,
  ActionSaveError,
  previewAction,
  saveAction,
  type ActionName,
  type ActionOutcome,
} from '@/lib/assistant/actions';
import { knockOnEffects, type Effect } from '@/lib/assistant/effects';
import { APP_PAGES, buildAppLink, INSIGHT_RANGES, LinkError } from '@/lib/assistant/links';
import { encodePreview, type ProposalPreview } from '@/lib/assistant/preview';
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
  /**
   * The Prisma client. Proposals are checked by running them in a transaction
   * that is rolled back, so it has to be able to open one.
   */
  db: ReadDb & ProposalDb & TransactionDb & Pick<PrismaClient, 'idempotencyKey'>;
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

/** What a saved action returns to the browser. The model gets a shorter version. */
export type ActionResult = {
  status: 'saved';
  /** True when this tool call had already been saved; nothing new was written. */
  alreadySaved: boolean;
  /** What was done, in one line. */
  summary: string;
  /** What was done, record by record, for the card. */
  preview: ProposalPreview;
  /** Where the budgets, accounts, friends or goals it touched stand now. */
  effects: Effect[];
  /** Present when the user changed the proposal on the card before approving. */
  editedByUser?: true;
};

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
    // Cards of the other write tools: field key → new value. Which keys may
    // change, and to what, is checked per tool (applyFieldEdits).
    fields: z
      .record(z.string().min(1).max(60), z.union([z.string().max(200), z.number().finite(), z.null()]))
      .refine((fields) => Object.keys(fields).length <= 100, 'Too many changes')
      .optional(),
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
    if (
      error instanceof ToolInputError ||
      error instanceof SaveError ||
      error instanceof ActionSaveError ||
      error instanceof LinkError
    ) {
      throw new Error(error.message);
    }
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
        safely(kind === 'EXPENSE' ? 'createExpense' : 'createIncome', async () => {
          const edit = deps.proposalEdits?.get(toolCallId);
          const saved = await saveProposal(kind, input as Proposal, toolCallId, {
            db: deps.db,
            tx: deps.transactionDeps,
            edit,
          });
          if (kind !== 'EXPENSE') return saved;
          // Where this expense leaves its category's budget, if it has one.
          const final = edit ? applyProposalEdit(input as Proposal, edit) : (input as Proposal);
          const effects = await knockOnEffects(ctx, {
            budgets: [{ categoryId: final.categoryId, month: saved.details.date.slice(0, 7) }],
            accountIds: [],
            friendIds: [],
            goalIds: [],
          });
          return effects.length > 0 ? { ...saved, effects } : saved;
        }),
    });

  /** One of the actions in lib/assistant/actions.ts as an approval-gated tool. */
  const actionTool = <N extends ActionName>(name: N) =>
    tool({
      description: ACTIONS[name].description,
      inputSchema: ACTIONS[name].inputSchema as (typeof ACTIONS)[N]['inputSchema'],
      execute: async (input: unknown, { toolCallId }: { toolCallId: string }): Promise<ActionResult> =>
        safely(name, async () => {
          const saved = await saveAction(name, input, toolCallId, {
            tx: deps.transactionDeps,
            today: deps.today,
            edits: deps.proposalEdits?.get(toolCallId)?.fields,
          });
          const outcome: ActionOutcome = saved.outcome;
          return {
            status: 'saved' as const,
            alreadySaved: saved.replayed,
            summary: outcome.preview.summary,
            preview: outcome.preview,
            effects: await knockOnEffects(ctx, outcome.refs),
            ...(saved.edited ? { editedByUser: true as const } : {}),
          };
        }),
      // The record-by-record preview is for the card; the model needs the outcome.
      toModelOutput: ({ output }: { output: ActionResult }) => ({
        type: 'json' as const,
        value: {
          status: output.status,
          alreadySaved: output.alreadySaved,
          summary: output.summary,
          recordsAffected: output.preview.count,
          effects: output.effects,
          ...(output.editedByUser ? { editedByUser: true } : {}),
        },
      }),
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

    logTransactions: actionTool('logTransactions'),
    changeTransactions: actionTool('changeTransactions'),
    moveMoney: actionTool('moveMoney'),
    updateFriends: actionTool('updateFriends'),
    updateGoals: actionTool('updateGoals'),
    updateBudgets: actionTool('updateBudgets'),
    updateRecurring: actionTool('updateRecurring'),
    updateCategories: actionTool('updateCategories'),

    linkToPage: tool({
      description:
        'Get a link to a page of the app, with filters applied, to put in your answer as a Markdown link ("[Open these 14 expenses](href)"). Use it when the user would want to look at or work with records themselves, for example after listing transactions. Only these filters exist: expenses and income can be narrowed by a date range (from, to), a category and a month; transfers and budgets by month; insights by range. No page can be filtered by account, merchant or search text, and there is no page for a single transaction, so link to the list for that day instead. The result says which filters were ignored. Always use the href exactly as returned.',
      inputSchema: z.object({
        page: z
          .enum(APP_PAGES)
          .describe(
            'dashboard (home), insights (charts), expenses, income, transfers (the three transaction lists), accounts, budgets, goals, recurring, friends, categories, merchants (settings).'
          ),
        from: day.optional().describe('expenses / income: first day shown, inclusive.'),
        to: day.optional().describe('expenses / income: last day shown, inclusive.'),
        categoryId: id.optional().describe('expenses / income: show one category (id from the category list).'),
        month: z
          .string()
          .regex(/^[0-9]{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM')
          .optional()
          .describe('expenses / income / transfers / budgets: the month shown (YYYY-MM). Not needed with from/to.'),
        range: z.enum(INSIGHT_RANGES).optional().describe('insights: the period charted.'),
      }),
      execute: (input) =>
        safely('linkToPage', async () => {
          if (input.categoryId) {
            const category = await deps.db.category.findUnique({
              where: { id: input.categoryId },
              select: { type: true },
            });
            if (!category) throw new LinkError(`Unknown category id "${input.categoryId}". Use an id from the category list.`);
            const expected = input.page === 'income' ? 'INCOME' : 'EXPENSE';
            if ((input.page === 'income' || input.page === 'expenses') && category.type !== expected) {
              throw new LinkError(`That category is not ${expected === 'INCOME' ? 'an income' : 'an expense'} category, so the ${input.page} page cannot filter by it.`);
            }
          }
          const link = buildAppLink(input);
          return {
            href: link.href,
            page: link.page,
            ...(link.ignored.length > 0
              ? { ignoredFilters: link.ignored, note: `The ${link.page} page cannot be filtered by ${link.ignored.join(' or ')} through a link.` }
              : {}),
          };
        }),
    }),
  };
}

/** The tools that write, by name. Each waits for the user's approval. */
export const WRITE_TOOL_NAMES: readonly string[] = ['createExpense', 'createIncome', ...ACTION_NAMES];

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
  deps: Pick<AssistantToolDeps, 'db' | 'proposalEdits' | 'today' | 'transactionDeps'>
) {
  const actionRule = (name: ActionName) => async (input: unknown, options: { toolCallId: string }) => {
    try {
      const edits = deps.proposalEdits?.get(options.toolCallId)?.fields;
      // Already saved (a retry or a double tap): let it through; saving again
      // returns the first result. Checking it now would wrongly fail, since
      // the record it deletes or pauses has already changed.
      const prior = await deps.db.idempotencyKey.findUnique({
        where: { key: `assistant:${options.toolCallId}` },
      });
      if (prior?.result) {
        const outcome = JSON.parse(prior.result) as ActionOutcome;
        return { type: 'user-approval' as const, reason: encodePreview(outcome.preview) };
      }
      const check = await previewAction(
        deps.transactionDeps?.db ?? deps.db,
        name,
        input,
        { today: deps.today },
        edits
      );
      if (check.ok) return { type: 'user-approval' as const, reason: encodePreview(check.preview) };
      return {
        type: 'denied' as const,
        reason: edits
          ? `${EDITED_PROPOSAL_PREFIX} ${check.problem}. Nothing was saved. Tell the user and offer to propose it again.`
          : `${INVALID_PROPOSAL_PREFIX} ${check.problem}.`,
      };
    } catch (error) {
      console.error(`Assistant proposal check failed (${name}):`, error instanceof Error ? error.message : error);
      return {
        type: 'denied' as const,
        reason: `${INVALID_PROPOSAL_PREFIX} the server could not check it right now. Tell the user to try again shortly.`,
      };
    }
  };

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
  return {
    createExpense: rule('EXPENSE'),
    createIncome: rule('INCOME'),
    logTransactions: actionRule('logTransactions'),
    changeTransactions: actionRule('changeTransactions'),
    moveMoney: actionRule('moveMoney'),
    updateFriends: actionRule('updateFriends'),
    updateGoals: actionRule('updateGoals'),
    updateBudgets: actionRule('updateBudgets'),
    updateRecurring: actionRule('updateRecurring'),
    updateCategories: actionRule('updateCategories'),
  };
}
