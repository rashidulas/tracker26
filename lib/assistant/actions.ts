/**
 * The assistant's write tools beyond "add one expense / one income":
 * editing and deleting transactions, batches, transfers and payments,
 * friends, goals, budgets, recurring entries, categories and merchants.
 *
 * Every tool here is a proposal. Nothing is saved until the user approves it.
 *
 * HOW A PROPOSAL IS CHECKED AND SAVED
 * -----------------------------------
 * Each action is one function, `perform(tx, input)`, that makes the change
 * through the same shared modules the app's own forms use (lib/transactions,
 * friendLedger, goalLedger, budgetWrites, recurring, categories, merchants)
 * and returns a preview of what it did.
 *
 *   - To check a proposal and build its approval card, `perform` runs inside
 *     a database transaction that is always rolled back (previewAction). The
 *     card therefore shows exactly what approving will do, every id and
 *     amount has been checked against the database by the real rules, and no
 *     business rule is written a second time here.
 *   - When the user approves, `perform` runs again in a transaction that is
 *     committed together with an IdempotencyKey row for the tool call id
 *     (saveAction → runLedgerWriteOnce). A retry or a double tap finds the key
 *     and returns the first result. A proposal with several writes (a batch,
 *     an expense with its friend split) is one transaction: all or nothing.
 *   - Changes the user made on the card arrive as field edits. They are
 *     applied to the tool input, which is validated again and goes through the
 *     same two steps. Nothing the browser sends is trusted.
 *
 * Messages thrown as ActionError or TransactionError are written to be read:
 * they reach the model (to fix its input) and never contain raw Zod or
 * Prisma text.
 */
import type { Transaction } from '@prisma/client';
import { z } from 'zod';
import { budgetsToCopy, copyPreviousMonthIn, setBudgetIn } from '@/lib/budgetWrites';
import { budgetMonthDate, isValidMonthKey } from '@/lib/budgets';
import { addSubcategoryIn, createCategoryIn, uniqueSubcategoryNames } from '@/lib/categories';
import { formatDay, isValidDay, toDayString, type DayString } from '@/lib/dates';
import { myShareOfExpense } from '@/lib/expenseAllocations';
import { createFriendEntryIn, createFriendIn } from '@/lib/friendLedger';
import { signedFriendAmount } from '@/lib/friends';
import { contributionNeedsTransfer, createContributionIn, createGoalIn } from '@/lib/goalLedger';
import { MerchantDefaultError, setMerchantCategoryDefaultIn } from '@/lib/merchants';
import { createRecurringIn, setRecurringActiveIn, skipRecurringIn } from '@/lib/recurring';
import { FREQUENCIES, FREQUENCY_LABELS, type Frequency } from '@/lib/recurringSchedule';
import {
  applyMerchantCategoryIn,
  createTransactionIn,
  deleteTransactionsIn,
  duplicateTransactionsIn,
  isPaymentTransfer,
  recategorizeTransactionsIn,
  runLedgerWriteOnce,
  TransactionError,
  updateTransactionIn,
  type LedgerTx,
  type TransactionDb,
  type TransactionDeps,
  type TransactionInput,
} from '@/lib/transactions';
import { formatCurrency } from '@/lib/utils';
import { buildAppLink } from '@/lib/assistant/links';
import type {
  FieldEdits,
  PreviewField,
  PreviewItem,
  ProposalPreview,
} from '@/lib/assistant/preview';

// ==================== TYPES ====================

/** A problem with a proposal that the model (or the user's edit) can fix. */
export class ActionError extends Error {}

function bad(message: string): never {
  throw new ActionError(message);
}

type Tx = LedgerTx;

export type ActionContext = { today: DayString };

/** What a saved change touched, so its knock-on effects can be looked up afterwards. */
export type ActionRefs = {
  budgets: { categoryId: string; month: string }[];
  accountIds: string[];
  friendIds: string[];
  goalIds: string[];
};

export type ActionOutcome = { preview: ProposalPreview; refs: ActionRefs };

type ActionDef<S extends z.ZodTypeAny> = {
  description: string;
  inputSchema: S;
  /** Paths in the input the user may change on the approval card. */
  editable: RegExp;
  perform: (tx: Tx, input: z.output<S>, ctx: ActionContext) => Promise<ActionOutcome>;
};

const define = <S extends z.ZodTypeAny>(def: ActionDef<S>) => def;

const noRefs = (): ActionRefs => ({ budgets: [], accountIds: [], friendIds: [], goalIds: [] });

// ==================== SHARED SCHEMA PIECES ====================

const OBJECT_ID = /^[a-f\d]{24}$/i;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

const id = z.string().min(1);
const day = z.string().refine(isValidDay, 'Use a real calendar day in YYYY-MM-DD form');
const amount = z.number().positive();
const month = z.string().regex(MONTH, 'Use YYYY-MM');

const categorySplit = z.object({
  categoryId: id.describe('Expense category id.'),
  amount: amount.describe('Part of the total that belongs to this category.'),
});
const accountSplit = z.object({
  accountId: id.describe('Account id.'),
  amount: amount.describe('Part of the total paid from / into this account.'),
});
const friendShare = z.object({
  friendId: id.describe('Friend id from friendBalances.'),
  amount: amount.describe('What this friend owes the user for the expense.'),
});

// ==================== LOOKUPS AND WORDING ====================

type Names = {
  accounts: Map<string, { id: string; name: string; type: string }>;
  categories: Map<string, { id: string; name: string; type: 'INCOME' | 'EXPENSE' }>;
};

// Sequential on purpose: one MongoDB session should not run queries in parallel.
async function loadNames(tx: Tx): Promise<Names> {
  const accounts = await tx.account.findMany({ select: { id: true, name: true, type: true } });
  const categories = await tx.category.findMany({ select: { id: true, name: true, type: true } });
  return {
    accounts: new Map(accounts.map((a) => [a.id, a])),
    categories: new Map(categories.map((c) => [c.id, c])),
  };
}

function accountOf(names: Names, value: string | null | undefined, label = 'accountId') {
  const account = value ? names.accounts.get(value) : undefined;
  if (!account) bad(`${label} "${value ?? ''}" is not an id from the account list`);
  return account;
}

function categoryOf(
  names: Names,
  value: string | null | undefined,
  kind?: 'INCOME' | 'EXPENSE',
  label = 'categoryId'
) {
  const category = value ? names.categories.get(value) : undefined;
  if (!category) bad(`${label} "${value ?? ''}" is not an id from the category list`);
  if (kind && category.type !== kind) {
    bad(
      `"${category.name}" is ${category.type === 'INCOME' ? 'an income' : 'an expense'} category; this needs ${
        kind === 'INCOME' ? 'an income' : 'an expense'
      } category`
    );
  }
  return category;
}

function checkAmount(value: number, label = 'amount') {
  if (!Number.isFinite(value) || !(value > 0)) bad(`${label} must be a positive number`);
  if (Math.abs(value * 100 - Math.round(value * 100)) > 1e-6) bad(`${label} can have at most 2 decimal places`);
}

function checkId(value: string | null | undefined, label: string): string {
  if (!value || !OBJECT_ID.test(value)) bad(`${label} "${value ?? ''}" is not a valid id`);
  return value;
}

const money = (n: number) => formatCurrency(n);
const cents = (n: number) => Math.round(n * 100);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const clip = (text: string | null | undefined, max = 80) => {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};
const monthName = (key: string) => formatDay(`${key}-01`, { month: 'long', year: 'numeric' });
const unique = <T>(list: T[]) => [...new Set(list)];

function kindWord(t: Pick<Transaction, 'kind' | 'tags'>) {
  if (t.kind === 'INCOME') return 'Income';
  if (t.kind === 'EXPENSE') return 'Expense';
  if (t.tags.some((tag) => tag.toLowerCase() === 'payment')) return 'Card payment';
  if (t.tags.some((tag) => tag.toLowerCase() === 'debt-payment')) return 'Debt payment';
  return 'Transfer';
}

/** "Expense $25.50 at Chipotle" */
function transactionTitle(t: Transaction) {
  const merchant = t.kind === 'TRANSFER' ? null : clip(t.merchantOrSource, 60);
  return `${kindWord(t)} ${money(t.amount)}${merchant ? ` ${t.kind === 'INCOME' ? 'from' : 'at'} ${merchant}` : ''}`;
}

function categoryText(t: Transaction, names: Names) {
  const name = (value: string | null) => (value ? names.categories.get(value)?.name ?? '(deleted)' : '');
  if (t.splitItems.length > 0) {
    return t.splitItems.map((s) => `${name(s.categoryId)} ${money(s.amount)}`).join(' + ');
  }
  return name(t.categoryId);
}

function accountText(t: Transaction, names: Names) {
  const name = (value: string | null) => (value ? names.accounts.get(value)?.name ?? '(deleted)' : '');
  if (t.kind !== 'TRANSFER' && t.accountSplits.length > 1) {
    return t.accountSplits.map((s) => `${name(s.accountId)} ${money(s.amount)}`).join(' + ');
  }
  return name(t.accountId);
}

/** The values of a transaction as the card shows them, by label. */
function transactionValues(t: Transaction, names: Names): [string, string][] {
  const rows: [string, string][] = [['Amount', money(t.amount)]];
  if (t.kind === 'TRANSFER') {
    rows.push(['From', accountText(t, names)]);
    rows.push(['To', t.toAccountId ? names.accounts.get(t.toAccountId)?.name ?? '(deleted)' : '']);
  } else {
    rows.push([t.kind === 'INCOME' ? 'From' : 'Merchant', clip(t.merchantOrSource, 60)]);
    rows.push(['Category', categoryText(t, names)]);
    rows.push([t.kind === 'INCOME' ? 'Into' : 'Paid from', accountText(t, names)]);
  }
  rows.push(['Date', toDayString(t.date)]);
  if (t.kind === 'EXPENSE' && (t.sharedAmount ?? 0) > 0) {
    rows.push(['Friends owe', money(t.sharedAmount!)]);
    rows.push(['Your share', money(myShareOfExpense(t))]);
  }
  if (t.notes) rows.push(['Notes', clip(t.notes, 80)]);
  return rows;
}

const plainFields = (rows: [string, string][]): PreviewField[] =>
  rows.filter(([, value]) => value).map(([label, value]) => ({ label, value }));

/** One compact line for a transaction in a list of several. */
function transactionLine(t: Transaction, names: Names): PreviewField[] {
  const where =
    t.kind === 'TRANSFER'
      ? `${accountText(t, names)} → ${t.toAccountId ? names.accounts.get(t.toAccountId)?.name ?? '' : ''}`
      : [categoryText(t, names), accountText(t, names)].filter(Boolean).join(' · ');
  return [{ label: toDayString(t.date), value: where }];
}

function budgetRefs(rows: Transaction[]): ActionRefs['budgets'] {
  const seen = new Map<string, { categoryId: string; month: string }>();
  for (const t of rows) {
    if (t.kind !== 'EXPENSE') continue;
    const monthKey = toDayString(t.date).slice(0, 7);
    const ids = t.splitItems.length > 0 ? t.splitItems.map((s) => s.categoryId) : t.categoryId ? [t.categoryId] : [];
    for (const categoryId of ids) seen.set(`${monthKey}:${categoryId}`, { categoryId, month: monthKey });
  }
  return [...seen.values()];
}

function accountRefs(rows: Transaction[]): string[] {
  return unique(
    rows.flatMap((t) => [
      t.accountId,
      t.toAccountId,
      ...(t.kind === 'TRANSFER' ? [] : t.accountSplits.map((s) => s.accountId)),
    ])
  ).filter((v): v is string => !!v);
}

function listLink(rows: Transaction[]): ProposalPreview['link'] | undefined {
  if (rows.length === 0) return undefined;
  const days = rows.map((t) => toDayString(t.date)).sort();
  const kinds = unique(rows.map((t) => t.kind));
  if (kinds.length !== 1) return undefined;
  if (kinds[0] === 'TRANSFER') {
    const months = unique(days.map((d) => d.slice(0, 7)));
    const link = buildAppLink({ page: 'transfers', month: months.length === 1 ? months[0] : null });
    return { href: link.href, label: 'View in Transfers' };
  }
  const page = kinds[0] === 'INCOME' ? 'income' : 'expenses';
  const link = buildAppLink({ page, from: days[0], to: days[days.length - 1] });
  return { href: link.href, label: `View in ${link.page}` };
}

async function loadTransactions(tx: Tx, ids: string[]): Promise<Transaction[]> {
  const wanted = unique(ids);
  for (const value of wanted) checkId(value, 'transaction id');
  const rows = await tx.transaction.findMany({ where: { id: { in: wanted } } });
  const found = new Set(rows.map((r) => r.id));
  const missing = wanted.filter((value) => !found.has(value));
  if (missing.length > 0) {
    bad(
      `No transaction has the id ${missing.map((m) => `"${m}"`).join(', ')}. Use ids returned by searchTransactions; it may have been deleted already.`
    );
  }
  // Keep the order the ids were given in.
  const byId = new Map(rows.map((r) => [r.id, r]));
  return wanted.map((value) => byId.get(value)!);
}

// ==================== TRANSACTIONS: ADD ====================

const newTransaction = z.object({
  kind: z.enum(['EXPENSE', 'INCOME']),
  amount: amount.describe('Total amount, at most 2 decimals.'),
  date: day.describe('Calendar day it happened (YYYY-MM-DD). Use today unless the user says otherwise.'),
  categoryId: id
    .nullish()
    .describe('Category id of the matching kind. Leave out only when categorySplits is given.'),
  subcategoryId: id.nullish().describe('Optional subcategory id belonging to categoryId.'),
  accountId: id
    .nullish()
    .describe('Account paid from (expense) or into (income). Leave out only when accountSplits is given. Never guess.'),
  merchant: z.string().max(100).nullish().describe('Merchant / payee, or payer for income.'),
  notes: z.string().max(500).nullish(),
  categorySplits: z
    .array(categorySplit)
    .min(2)
    .max(10)
    .nullish()
    .describe('Expenses only: split the total across categories. The parts must add up to amount.'),
  accountSplits: z
    .array(accountSplit)
    .min(2)
    .max(6)
    .nullish()
    .describe('Split the total across accounts (for example a paycheck paid into two accounts). The parts must add up to amount.'),
  friendShares: z
    .array(friendShare)
    .min(1)
    .max(10)
    .nullish()
    .describe('Expenses only: what each friend owes the user for it. The user paid the full amount; their own share is amount minus these.'),
});

function newTransactionInput(item: z.output<typeof newTransaction>, names: Names, label: string): TransactionInput {
  checkAmount(item.amount, `${label}amount`);
  const splitByCategory = (item.categorySplits?.length ?? 0) > 0;
  const splitByAccount = (item.accountSplits?.length ?? 0) > 0;
  if (item.kind === 'INCOME' && (splitByCategory || item.friendShares?.length)) {
    bad(`${label}only an expense can have categorySplits or friendShares`);
  }
  if (splitByCategory) {
    for (const s of item.categorySplits!) {
      categoryOf(names, s.categoryId, 'EXPENSE', `${label}categorySplits.categoryId`);
      checkAmount(s.amount, `${label}categorySplits.amount`);
    }
  } else {
    if (!item.categoryId) bad(`${label}categoryId is missing. Ask the user which category if it is not clear.`);
    categoryOf(names, item.categoryId, item.kind, `${label}categoryId`);
  }
  if (splitByAccount) {
    for (const s of item.accountSplits!) {
      accountOf(names, s.accountId, `${label}accountSplits.accountId`);
      checkAmount(s.amount, `${label}accountSplits.amount`);
    }
  } else {
    if (!item.accountId) bad(`${label}accountId is missing. Ask the user which account.`);
    accountOf(names, item.accountId, `${label}accountId`);
  }
  for (const share of item.friendShares ?? []) checkAmount(share.amount, `${label}friendShares.amount`);

  const base = {
    date: item.date,
    amount: item.amount,
    subcategoryId: splitByCategory ? null : item.subcategoryId ?? null,
    categoryId: splitByCategory ? null : item.categoryId,
    accountId: splitByAccount ? null : item.accountId,
    accountSplits: splitByAccount ? item.accountSplits! : undefined,
    merchantOrSource: item.merchant ?? null,
    notes: item.notes ?? null,
    tags: [],
  };
  if (item.kind === 'INCOME') return { kind: 'INCOME', ...base };
  return {
    kind: 'EXPENSE',
    ...base,
    splitItems: splitByCategory ? item.categorySplits! : undefined,
    friendSplits: item.friendShares?.length ? item.friendShares : undefined,
  };
}

const logTransactions = define({
  description:
    'Propose adding one or more expenses or income entries in a single card that the user approves once; they are saved together or not at all. Use it when the user lists several purchases in one message ("coffee 4.50, lunch 12, parking 6"), when an expense is split across categories (categorySplits), when income or an expense is split across accounts (accountSplits), or when friends owe part of an expense the user paid (friendShares). For one plain expense or income use createExpense / createIncome instead. Every item needs an amount, a category (or categorySplits) and an account (or accountSplits): ask for whatever is missing first.',
  inputSchema: z.object({
    items: z.array(newTransaction).min(1).max(20).describe('The transactions to add, in the order the user gave them.'),
  }),
  editable: /^items\.\d+\.(amount|date|categoryId|accountId|merchant)$/,
  perform: async (tx, input) => {
    const names = await loadNames(tx);
    const created: Transaction[] = [];
    const items: PreviewItem[] = [];
    const friendIds: string[] = [];
    for (const [index, item] of input.items.entries()) {
      const label = input.items.length > 1 ? `items[${index}]: ` : '';
      const row = await createTransactionIn(tx, {
        ...newTransactionInput(item, names, label),
        source: 'assistant',
      });
      // Friend shares are stored after the row is created; read the final version.
      const saved = (await tx.transaction.findUnique({ where: { id: row.id } })) ?? row;
      created.push(saved);
      friendIds.push(...(item.friendShares ?? []).map((s) => s.friendId));

      const key = (field: string) => `items.${index}.${field}`;
      const split = saved.splitItems.length > 0;
      const multiAccount = saved.accountSplits.length > 1;
      const shared = (saved.sharedAmount ?? 0) > 0;
      const fields: PreviewField[] = [
        {
          label: 'Amount',
          value: money(saved.amount),
          // The parts of a split have to keep adding up to the total.
          ...(split || multiAccount || shared ? {} : { edit: { key: key('amount'), control: 'amount', value: saved.amount } }),
        },
        { label: 'Date', value: toDayString(saved.date), edit: { key: key('date'), control: 'date', value: toDayString(saved.date) } },
        {
          label: 'Category',
          value: categoryText(saved, names),
          ...(split
            ? {}
            : {
                edit: {
                  key: key('categoryId'),
                  control: saved.kind === 'INCOME' ? 'incomeCategory' : 'expenseCategory',
                  value: saved.categoryId,
                },
              }),
        },
        {
          label: saved.kind === 'INCOME' ? 'Into' : 'Paid from',
          value: accountText(saved, names),
          ...(multiAccount ? {} : { edit: { key: key('accountId'), control: 'account', value: saved.accountId } }),
        },
      ];
      if (shared) {
        const friends = await tx.friendEntry.findMany({ where: { transactionId: saved.id } });
        const friendNames = await tx.friend.findMany({
          where: { id: { in: friends.map((f) => f.friendId) } },
          select: { id: true, name: true },
        });
        const nameOf = new Map(friendNames.map((f) => [f.id, f.name]));
        for (const entry of friends) {
          fields.push({ label: `${clip(nameOf.get(entry.friendId), 30)} owes`, value: money(entry.amount) });
        }
        fields.push({ label: 'Your share', value: money(myShareOfExpense(saved)) });
      }
      items.push({ title: transactionTitle(saved), tone: 'add', fields });
    }

    const n = created.length;
    const noun = n === 1 ? kindWord(created[0]).toLowerCase() : plural(n, 'transaction');
    const titles = created.map((t) => transactionTitle(t)).join('; ');
    return {
      preview: {
        v: 1,
        heading: `Add ${noun}`,
        done: `Added ${noun}`,
        summary: `Added ${titles}`,
        destructive: false,
        count: n,
        items,
        link: listLink(created),
      },
      refs: { ...noRefs(), budgets: budgetRefs(created), accountIds: accountRefs(created), friendIds: unique(friendIds) },
    };
  },
});

// ==================== TRANSACTIONS: CHANGE ====================

const transactionChanges = z.object({
  amount: amount.optional().describe('New total.'),
  date: day.optional().describe('New calendar day.'),
  categoryId: id.optional().describe('New category (same kind as the transaction). Clears the subcategory and any category split.'),
  subcategoryId: id.nullish().describe('Subcategory of the new category.'),
  accountId: id.optional().describe('New account paid from / into. For a transfer: the account the money leaves.'),
  toAccountId: id.optional().describe('Transfers only: the account the money goes to.'),
  merchant: z.string().max(100).nullish().describe('New merchant / payer text. null clears it.'),
  notes: z.string().max(500).nullish().describe('New notes. null clears them.'),
  categorySplits: z.array(categorySplit).min(2).max(10).optional().describe('Expenses only: split the total across categories. Must add up to the total.'),
  accountSplits: z.array(accountSplit).min(2).max(6).optional().describe('Income and expenses: split the total across accounts. Must add up to the total.'),
});

/** The complete input updateTransactionIn needs: the stored row with the changes laid over it. */
function editedInput(
  existing: Transaction,
  changes: z.output<typeof transactionChanges>,
  names: Names,
  friendSplits?: { friendId: string; amount: number }[]
): TransactionInput {
  if (existing.splitGroupId) {
    bad('This entry is one part of an older multi-part entry and can only be edited on its page in the app.');
  }
  if (changes.amount !== undefined) checkAmount(changes.amount, 'changes.amount');
  const base = {
    date: changes.date ?? toDayString(existing.date),
    amount: changes.amount ?? existing.amount,
    // undefined keeps the stored text; null clears it.
    merchantOrSource: changes.merchant,
    notes: changes.notes,
  };

  if (existing.kind === 'TRANSFER') {
    if (changes.categoryId || changes.categorySplits || changes.accountSplits || changes.subcategoryId) {
      bad('A transfer has no category or account split to change. Only its amount, date, accounts and notes can change.');
    }
    if (changes.accountId) accountOf(names, changes.accountId, 'changes.accountId');
    if (changes.toAccountId) accountOf(names, changes.toAccountId, 'changes.toAccountId');
    return {
      kind: 'TRANSFER',
      ...base,
      accountId: changes.accountId ?? existing.accountId ?? '',
      toAccountId: changes.toAccountId ?? existing.toAccountId ?? '',
    };
  }

  if (changes.toAccountId) bad('toAccountId only applies to transfers.');
  if (existing.kind === 'INCOME' && changes.categorySplits) bad('Only an expense can be split across categories.');

  let categoryId = existing.categoryId;
  let subcategoryId = existing.subcategoryId;
  let splitItems = existing.splitItems.map((s) => ({ categoryId: s.categoryId, amount: s.amount, notes: s.notes }));
  if (changes.categorySplits) {
    for (const s of changes.categorySplits) categoryOf(names, s.categoryId, 'EXPENSE', 'changes.categorySplits.categoryId');
    categoryId = null;
    subcategoryId = null;
    splitItems = changes.categorySplits.map((s) => ({ ...s, notes: null }));
  } else if (changes.categoryId) {
    categoryOf(names, changes.categoryId, existing.kind, 'changes.categoryId');
    categoryId = changes.categoryId;
    subcategoryId = changes.subcategoryId ?? null;
    splitItems = [];
  } else if (changes.subcategoryId !== undefined) {
    subcategoryId = changes.subcategoryId;
  }

  let accountId = existing.accountId;
  let accountSplits = existing.accountSplits.length > 1 ? existing.accountSplits.map((s) => ({ ...s })) : undefined;
  if (changes.accountSplits) {
    for (const s of changes.accountSplits) accountOf(names, s.accountId, 'changes.accountSplits.accountId');
    accountSplits = changes.accountSplits;
  } else if (changes.accountId) {
    accountOf(names, changes.accountId, 'changes.accountId');
    accountId = changes.accountId;
    accountSplits = undefined;
  }

  const shared = { ...base, categoryId, subcategoryId, accountId, accountSplits };
  if (existing.kind === 'INCOME') return { kind: 'INCOME', ...shared };
  return {
    kind: 'EXPENSE',
    ...shared,
    splitItems: splitItems.length > 0 ? splitItems : undefined,
    // undefined keeps the friends the expense is already split with.
    friendSplits,
  };
}

/** Fields of an edited transaction: every value, with the old one where it changed. */
function changedFields(before: Transaction, after: Transaction, names: Names) {
  const was = new Map(transactionValues(before, names));
  const now = transactionValues(after, names);
  const labels = unique([...now.map(([label]) => label), ...was.keys()]);
  const nowBy = new Map(now);
  let changed = 0;
  const fields: PreviewField[] = [];
  for (const label of labels) {
    const value = nowBy.get(label) ?? '';
    const previous = was.get(label) ?? '';
    if (!value && !previous) continue;
    if (value !== previous) changed += 1;
    fields.push({ label, value: value || '(none)', ...(value !== previous ? { was: previous || '(none)' } : {}) });
  }
  return { fields, changed };
}

const changeTransactions = define({
  description:
    'Propose changing transactions that already exist. Find them with searchTransactions first and pass their ids; never invent an id. action "edit": change one transaction (amount, date, category, account, merchant, notes, or split it across categories or accounts) by passing only the fields that change in `changes`. action "delete": delete one or more transactions for good. action "duplicate": copy one or more transactions onto `date` (today if omitted), for example "same again as last Friday". action "recategorize": move several income or expense transactions to `categoryId` at once. The card shows the user exactly which records change, the old and new values, and how many are affected; nothing changes until they approve.',
  inputSchema: z.object({
    action: z.enum(['edit', 'delete', 'duplicate', 'recategorize']),
    transactionIds: z
      .array(id)
      .min(1)
      .max(50)
      .describe('Ids from searchTransactions. "edit" takes exactly one; the others take one or more.'),
    changes: transactionChanges.optional().describe('For "edit": only the fields that should change.'),
    date: day.optional().describe('For "duplicate": the day the copies are dated. Defaults to today.'),
    categoryId: id.optional().describe('For "recategorize": the category to move the transactions to.'),
  }),
  editable: /^(date|categoryId|changes\.(amount|date|categoryId|accountId|toAccountId|merchant))$/,
  perform: async (tx, input, ctx) => {
    const names = await loadNames(tx);
    const rows = await loadTransactions(tx, input.transactionIds);

    if (input.action === 'edit') {
      if (rows.length !== 1) bad('"edit" changes one transaction at a time. Pass a single id, or use "recategorize" to move several to a category.');
      const before = rows[0];
      const changes = input.changes ?? {};
      if (Object.values(changes).every((v) => v === undefined)) bad('"edit" needs `changes` with at least one field.');
      const after = await updateTransactionIn(tx, before.id, editedInput(before, changes, names));
      const { fields, changed } = changedFields(before, after, names);
      if (changed === 0) bad('Nothing would change: the transaction already has these values.');

      // Let the user adjust the main values on the card before approving.
      const editKey: Record<string, PreviewField['edit']> = {
        Amount:
          after.splitItems.length > 0 || after.accountSplits.length > 1 || (after.sharedAmount ?? 0) > 0
            ? undefined
            : { key: 'changes.amount', control: 'amount', value: after.amount },
        Date: { key: 'changes.date', control: 'date', value: toDayString(after.date) },
        Category:
          after.kind === 'TRANSFER' || after.splitItems.length > 0
            ? undefined
            : {
                key: 'changes.categoryId',
                control: after.kind === 'INCOME' ? 'incomeCategory' : 'expenseCategory',
                value: after.categoryId,
              },
        'Paid from': after.accountSplits.length > 1 ? undefined : { key: 'changes.accountId', control: 'account', value: after.accountId },
        Into: after.accountSplits.length > 1 ? undefined : { key: 'changes.accountId', control: 'account', value: after.accountId },
        Merchant: { key: 'changes.merchant', control: 'text', value: after.merchantOrSource ?? '' },
        ...(after.kind === 'TRANSFER'
          ? {
              From: { key: 'changes.accountId', control: 'account', value: after.accountId },
              To: { key: 'changes.toAccountId', control: 'account', value: after.toAccountId },
            }
          : after.kind === 'INCOME'
          ? { From: { key: 'changes.merchant', control: 'text', value: after.merchantOrSource ?? '' } }
          : {}),
      };
      return {
        preview: {
          v: 1,
          heading: `Edit ${kindWord(before).toLowerCase()}`,
          done: `Edited ${kindWord(before).toLowerCase()}`,
          summary: `Edited ${transactionTitle(before)} (${toDayString(before.date)}): ${fields
            .filter((f) => f.was !== undefined)
            .map((f) => `${f.label} ${f.was} → ${f.value}`)
            .join(', ')}`,
          destructive: false,
          count: 1,
          items: [
            {
              title: transactionTitle(before),
              tone: 'change',
              fields: fields.map((f) => (editKey[f.label] ? { ...f, edit: editKey[f.label] } : f)),
            },
          ],
          link: listLink([after]),
        },
        refs: {
          ...noRefs(),
          budgets: budgetRefs([before, after]),
          accountIds: accountRefs([before, after]),
        },
      };
    }

    if (input.action === 'delete') {
      const ids = rows.map((r) => r.id);
      const friendEntries = await tx.friendEntry.findMany({
        where: { transactionId: { in: ids } },
        select: { friendId: true },
      });
      const contributions = await tx.goalContribution.findMany({
        where: { transactionId: { in: ids } },
        select: { goalId: true },
      });
      const { deleted } = await deleteTransactionsIn(tx, ids);
      const extras = [
        friendEntries.length > 0 ? plural(friendEntries.length, 'friend IOU') : null,
        contributions.length > 0 ? plural(contributions.length, 'goal contribution') : null,
      ].filter(Boolean);
      const older = deleted - rows.length;
      const warning = [
        extras.length > 0 ? `Also removes ${extras.join(' and ')} linked to ${rows.length === 1 ? 'it' : 'them'}.` : null,
        older > 0 ? `Includes ${plural(older, 'other part')} of an older multi-part entry.` : null,
        'This cannot be undone.',
      ]
        .filter(Boolean)
        .join(' ');
      return {
        preview: {
          v: 1,
          heading: `Delete ${plural(deleted, 'transaction')}`,
          done: `Deleted ${plural(deleted, 'transaction')}`,
          summary: `Deleted ${rows.map((t) => `${transactionTitle(t)} (${toDayString(t.date)})`).join('; ')}`,
          destructive: true,
          count: deleted,
          items: rows.map((t) => ({
            title: transactionTitle(t),
            tone: 'remove' as const,
            fields: rows.length === 1 ? plainFields(transactionValues(t, names).slice(1)) : transactionLine(t, names),
          })),
          warning,
        },
        refs: {
          budgets: budgetRefs(rows),
          accountIds: accountRefs(rows),
          friendIds: unique(friendEntries.map((e) => e.friendId)),
          goalIds: unique(contributions.map((c) => c.goalId)),
        },
      };
    }

    if (input.action === 'duplicate') {
      const onDay = input.date ?? ctx.today;
      const copies = (await duplicateTransactionsIn(tx, rows.map((r) => r.id), onDay, { source: 'assistant' })) as Transaction[];
      return {
        preview: {
          v: 1,
          heading: `Duplicate ${plural(copies.length, 'transaction')}`,
          done: `Duplicated ${plural(copies.length, 'transaction')}`,
          summary: `Added ${copies.map((t) => transactionTitle(t)).join('; ')} on ${onDay}`,
          destructive: false,
          count: copies.length,
          items: copies.map((t, index) => ({
            title: transactionTitle(t),
            tone: 'add' as const,
            fields: [
              ...transactionLine(t, names).map((f) => ({ ...f, label: 'Details' })),
              // One date for every copy; shown once.
              ...(index === 0
                ? [{ label: 'Date', value: onDay, edit: { key: 'date', control: 'date' as const, value: onDay } }]
                : [{ label: 'Date', value: onDay }]),
            ],
          })),
          link: listLink(copies),
        },
        refs: { ...noRefs(), budgets: budgetRefs(copies), accountIds: accountRefs(copies) },
      };
    }

    // recategorize
    const category = categoryOf(names, input.categoryId);
    const ids = rows.map((r) => r.id);
    await recategorizeTransactionsIn(tx, ids, category.id);
    const after = await tx.transaction.findMany({ where: { id: { in: ids } } });
    const afterBy = new Map(after.map((t) => [t.id, t]));
    const moved = rows.filter((t) => afterBy.get(t.id)?.categoryId !== t.categoryId || afterBy.get(t.id)?.subcategoryId !== t.subcategoryId);
    const skipped = rows.length - moved.length;
    if (moved.length === 0) {
      bad(
        `None of these can move to "${category.name}": it is ${category.type === 'INCOME' ? 'an income' : 'an expense'} category, and transfers, split expenses and transactions already in it are left alone.`
      );
    }
    return {
      preview: {
        v: 1,
        heading: `Move ${plural(moved.length, 'transaction')} to ${category.name}`,
        done: `Moved ${plural(moved.length, 'transaction')} to ${category.name}`,
        summary: `Moved ${plural(moved.length, 'transaction')} to ${category.name}`,
        destructive: moved.length > 1,
        count: moved.length,
        items: moved.map((t, index) => ({
          title: `${transactionTitle(t)} · ${toDayString(t.date)}`,
          tone: 'change' as const,
          fields: [
            {
              label: 'Category',
              value: category.name,
              was: categoryText(t, names) || '(none)',
              ...(index === 0
                ? {
                    edit: {
                      key: 'categoryId',
                      control: category.type === 'INCOME' ? ('incomeCategory' as const) : ('expenseCategory' as const),
                      value: category.id,
                    },
                  }
                : {}),
            },
          ],
        })),
        ...(skipped > 0
          ? { warning: `${plural(skipped, 'transaction')} left as ${skipped === 1 ? 'it is' : 'they are'} (a transfer, a split expense, the other kind, or already in ${category.name}).` }
          : {}),
        link: listLink(moved),
      },
      refs: {
        ...noRefs(),
        budgets: budgetRefs([...moved, ...moved.map((t) => afterBy.get(t.id)!)]),
      },
    };
  },
});

// ==================== TRANSFERS AND PAYMENTS ====================

const moveMoney = define({
  description:
    'Propose moving money between two of the user\'s accounts. action "transfer": an ordinary transfer (checking to savings). action "cardPayment": paying a credit card from another account. action "loanPayment": a payment into a loan account. Payments are transfers, never expenses: the purchases on the card were already counted when they were made. Both accounts must be named by the user or obvious from the conversation; ask if not.',
  inputSchema: z.object({
    action: z.enum(['transfer', 'cardPayment', 'loanPayment']),
    fromAccountId: id.describe('Account the money leaves.'),
    toAccountId: id.describe('Account the money goes to: the credit card for "cardPayment", the loan for "loanPayment".'),
    amount: amount.describe('Amount moved, at most 2 decimals.'),
    date: day.describe('Calendar day (YYYY-MM-DD). Use today unless the user says otherwise.'),
    notes: z.string().max(500).nullish(),
  }),
  editable: /^(amount|date|fromAccountId|toAccountId)$/,
  perform: async (tx, input) => {
    const names = await loadNames(tx);
    checkAmount(input.amount);
    const from = accountOf(names, input.fromAccountId, 'fromAccountId');
    const to = accountOf(names, input.toAccountId, 'toAccountId');
    if (input.action === 'cardPayment' && to.type !== 'CREDIT_CARD') {
      bad(`"${to.name}" is not a credit card. For "cardPayment", toAccountId must be a credit card account.`);
    }
    if (input.action === 'loanPayment' && to.type !== 'LOAN') {
      bad(`"${to.name}" is not a loan account. For "loanPayment", toAccountId must be a loan account.`);
    }
    const created = await createTransactionIn(tx, {
      kind: 'TRANSFER',
      // Same tagging and category as the app's own payment forms (lib/transactions).
      purpose: input.action === 'cardPayment' ? 'payment' : input.action === 'loanPayment' ? 'debt-payment' : undefined,
      date: input.date,
      amount: input.amount,
      accountId: from.id,
      toAccountId: to.id,
      notes: input.notes ?? null,
      source: 'assistant',
    });
    const what = input.action === 'cardPayment' ? 'Card payment' : input.action === 'loanPayment' ? 'Loan payment' : 'Transfer';
    return {
      preview: {
        v: 1,
        heading: what,
        done: `${what} saved`,
        summary: `${what} ${money(created.amount)} from ${from.name} to ${to.name} on ${input.date}`,
        destructive: false,
        count: 1,
        items: [
          {
            title: `${what} ${money(created.amount)}`,
            tone: 'add',
            fields: [
              { label: 'Amount', value: money(created.amount), edit: { key: 'amount', control: 'amount', value: created.amount } },
              { label: 'Date', value: input.date, edit: { key: 'date', control: 'date', value: input.date } },
              { label: 'From', value: from.name, edit: { key: 'fromAccountId', control: 'account', value: from.id } },
              { label: 'To', value: to.name, edit: { key: 'toAccountId', control: 'account', value: to.id } },
              ...(input.notes?.trim() ? [{ label: 'Notes', value: clip(input.notes) }] : []),
            ],
          },
        ],
        link: listLink([created]),
      },
      refs: { ...noRefs(), accountIds: [from.id, to.id] },
    };
  },
});

// ==================== FRIENDS ====================

async function friendOf(tx: Tx, value: string | null | undefined) {
  const friendId = value && OBJECT_ID.test(value) ? value : null;
  const friend = friendId ? await tx.friend.findUnique({ where: { id: friendId }, select: { id: true, name: true } }) : null;
  if (!friend) bad(`friendId "${value ?? ''}" is not a friend. Call friendBalances to list friends, or add the friend first.`);
  return friend;
}

async function friendBalance(tx: Tx, friendId: string) {
  const entries = await tx.friendEntry.findMany({ where: { friendId }, select: { type: true, amount: true } });
  return entries.reduce((sum, e) => sum + cents(signedFriendAmount(e.type, e.amount)), 0) / 100;
}

const owedText = (name: string, balance: number) =>
  balance > 0 ? `${name} owes you ${money(balance)}` : balance < 0 ? `You owe ${name} ${money(-balance)}` : `Settled up with ${name}`;

const updateFriends = define({
  description:
    'Propose a change on the Friends page (money owed between the user and friends). action "addFriend": add a person by `name`. action "iPaid": the user paid for something on a friend\'s behalf or lent them money, so the friend now owes the user `amount`. action "theyPaid": the friend paid for the user, so the user owes them `amount`. action "splitExpense": friends owe part of an expense that is already recorded (pass its `transactionId` from searchTransactions and each friend\'s `shares`); for an expense that is not recorded yet, use logTransactions with friendShares instead. action "settleUp": money changed hands to clear the balance: leave `amount` out to settle the whole balance, which the server works out, including who pays whom. Get friend ids from friendBalances.',
  inputSchema: z.object({
    action: z.enum(['addFriend', 'iPaid', 'theyPaid', 'splitExpense', 'settleUp']),
    name: z.string().max(60).optional().describe('For "addFriend": the friend\'s name.'),
    friendId: id.optional().describe('For "iPaid", "theyPaid" and "settleUp": the friend, from friendBalances.'),
    amount: amount.optional().describe('For "iPaid" / "theyPaid": the amount owed. For "settleUp": the amount paid back; omit to settle the full balance.'),
    date: day.optional().describe('Calendar day; defaults to today.'),
    description: z.string().max(120).optional().describe('What it was for, e.g. "Concert tickets".'),
    accountId: id
      .optional()
      .describe('Account the money actually moved through: for "settleUp", where the repayment was received or paid from; for "iPaid" / "theyPaid", only when cash was lent or borrowed directly and is not already recorded as an expense. Omit when no account balance should change.'),
    transactionId: id.optional().describe('For "splitExpense": the expense, from searchTransactions.'),
    shares: z.array(friendShare).min(1).max(10).optional().describe('For "splitExpense": what each friend owes for that expense. Replaces any shares already on it.'),
  }),
  editable: /^(name|amount|date|description|accountId)$/,
  perform: async (tx, input, ctx) => {
    const onDay = input.date ?? ctx.today;

    if (input.action === 'addFriend') {
      const name = (input.name ?? '').replace(/\s+/g, ' ').trim();
      if (!name) bad('"addFriend" needs a name.');
      const existing = await tx.friend.findMany({ select: { name: true } });
      if (existing.some((f) => f.name.trim().toLowerCase() === name.toLowerCase())) {
        bad(`There is already a friend called "${name}". Use friendBalances to get their id.`);
      }
      const friend = await createFriendIn(tx, { name });
      return {
        preview: {
          v: 1,
          heading: 'Add friend',
          done: 'Added friend',
          summary: `Added friend ${friend.name} (id ${friend.id})`,
          destructive: false,
          count: 1,
          items: [
            {
              title: friend.name,
              tone: 'add',
              fields: [{ label: 'Name', value: friend.name, edit: { key: 'name', control: 'text', value: friend.name } }],
            },
          ],
          link: { href: buildAppLink({ page: 'friends' }).href, label: 'View in Friends' },
        },
        refs: { ...noRefs(), friendIds: [friend.id] },
      };
    }

    if (input.action === 'splitExpense') {
      const names = await loadNames(tx);
      const [expense] = await loadTransactions(tx, [checkId(input.transactionId, 'transactionId')]);
      if (expense.kind !== 'EXPENSE') bad('Only an expense can be split with friends.');
      if (!input.shares?.length) bad('"splitExpense" needs `shares`: each friend and what they owe.');
      for (const share of input.shares) checkAmount(share.amount, 'shares.amount');
      await updateTransactionIn(tx, expense.id, editedInput(expense, {}, names, input.shares));
      const after = (await tx.transaction.findUnique({ where: { id: expense.id } }))!;
      const fields: PreviewField[] = [];
      for (const share of input.shares) {
        const friend = await friendOf(tx, share.friendId);
        fields.push({ label: `${clip(friend.name, 30)} owes`, value: money(share.amount) });
      }
      fields.push({
        label: 'Your share',
        value: money(myShareOfExpense(after)),
        ...(cents(myShareOfExpense(after)) !== cents(myShareOfExpense(expense)) ? { was: money(myShareOfExpense(expense)) } : {}),
      });
      return {
        preview: {
          v: 1,
          heading: 'Split expense with friends',
          done: 'Split expense with friends',
          summary: `Split ${transactionTitle(expense)} (${toDayString(expense.date)}): friends owe ${money(after.sharedAmount ?? 0)}, your share ${money(myShareOfExpense(after))}`,
          destructive: false,
          count: 1,
          items: [{ title: `${transactionTitle(expense)} · ${toDayString(expense.date)}`, tone: 'change', fields }],
          link: { href: buildAppLink({ page: 'friends' }).href, label: 'View in Friends' },
        },
        refs: {
          ...noRefs(),
          budgets: budgetRefs([expense]),
          friendIds: unique(input.shares.map((s) => s.friendId)),
        },
      };
    }

    const friend = await friendOf(tx, input.friendId);
    const names = await loadNames(tx);
    const account = input.accountId ? accountOf(names, input.accountId) : null;
    const before = await friendBalance(tx, friend.id);

    let type: 'THEY_OWE_ME' | 'I_OWE_THEM' | 'THEY_PAID_ME' | 'I_PAID_THEM';
    let value = input.amount;
    let title: string;
    let accountLabel: string;
    if (input.action === 'settleUp') {
      if (before === 0) bad(`${friend.name} and the user are already settled up; there is nothing to pay back.`);
      const owed = Math.abs(before);
      value = value ?? owed;
      if (cents(value) > cents(owed)) {
        bad(`The balance with ${friend.name} is ${money(owed)}; settling ${money(value)} would be more than that. Omit amount to settle it in full.`);
      }
      type = before > 0 ? 'THEY_PAID_ME' : 'I_PAID_THEM';
      title = before > 0 ? `${friend.name} pays you back ${money(value)}` : `You pay ${friend.name} back ${money(value)}`;
      accountLabel = before > 0 ? 'Received into' : 'Paid from';
    } else {
      if (value === undefined) bad(`"${input.action}" needs an amount.`);
      type = input.action === 'iPaid' ? 'THEY_OWE_ME' : 'I_OWE_THEM';
      title = input.action === 'iPaid' ? `${friend.name} owes you ${money(value)}` : `You owe ${friend.name} ${money(value)}`;
      accountLabel = input.action === 'iPaid' ? 'Lent from' : 'Borrowed into';
    }
    checkAmount(value);

    const description = input.description?.trim() || (input.action === 'settleUp' ? 'Settle up' : null);
    await createFriendEntryIn(tx, {
      friendId: friend.id,
      date: onDay,
      amount: value,
      type,
      description,
      accountId: account?.id ?? null,
    });
    const after = await friendBalance(tx, friend.id);
    return {
      preview: {
        v: 1,
        heading: input.action === 'settleUp' ? `Settle up with ${friend.name}` : 'Record friend IOU',
        done: input.action === 'settleUp' ? `Settled up with ${friend.name}` : 'Recorded friend IOU',
        summary: `${title} on ${onDay}${description ? ` (${clip(description, 60)})` : ''}. ${owedText(friend.name, after)}.`,
        destructive: false,
        count: 1,
        items: [
          {
            title,
            tone: 'add',
            fields: [
              { label: 'Amount', value: money(value), edit: { key: 'amount', control: 'amount', value } },
              { label: 'Date', value: onDay, edit: { key: 'date', control: 'date', value: onDay } },
              {
                label: 'For',
                value: description ?? '',
                ...(input.action === 'settleUp' ? {} : { edit: { key: 'description', control: 'text' as const, value: description ?? '' } }),
              },
              {
                label: accountLabel,
                value: account?.name ?? 'No account',
                edit: { key: 'accountId', control: 'account', value: account?.id ?? null },
              },
              { label: 'Balance after', value: owedText(friend.name, after), was: owedText(friend.name, before) },
            ],
          },
        ],
        link: { href: buildAppLink({ page: 'friends' }).href, label: 'View in Friends' },
      },
      refs: { ...noRefs(), friendIds: [friend.id], accountIds: account ? [account.id] : [] },
    };
  },
});

// ==================== GOALS ====================

const updateGoals = define({
  description:
    'Propose a change to savings goals. action "create": a new goal with a `name` and `targetAmount`, optionally a `dueDate` and the `accountId` that holds its savings. action "contribute": put `amount` toward goal `goalId` from `fromAccountId`. If the goal has its own account and the money comes from a different one, a real transfer is recorded; otherwise the money is only set aside (earmarked) where it already is. The card says which. Get goal ids from goalProgress.',
  inputSchema: z.object({
    action: z.enum(['create', 'contribute']),
    name: z.string().max(80).optional().describe('For "create": the goal\'s name.'),
    targetAmount: amount.optional().describe('For "create": how much to save in total.'),
    dueDate: day.nullish().describe('For "create": optional target day.'),
    accountId: id.nullish().describe('For "create": optional account that holds this goal\'s savings.'),
    goalId: id.optional().describe('For "contribute": the goal, from goalProgress.'),
    amount: amount.optional().describe('For "contribute": the amount to add.'),
    fromAccountId: id.optional().describe('For "contribute": the account the money comes from. Never guess.'),
    date: day.optional().describe('For "contribute": calendar day; defaults to today.'),
    notes: z.string().max(500).nullish(),
  }),
  editable: /^(name|targetAmount|dueDate|amount|date|fromAccountId)$/,
  perform: async (tx, input, ctx) => {
    const names = await loadNames(tx);
    const link = { href: buildAppLink({ page: 'goals' }).href, label: 'View in Goals' };

    if (input.action === 'create') {
      if (input.targetAmount === undefined) bad('"create" needs a targetAmount.');
      checkAmount(input.targetAmount, 'targetAmount');
      const account = input.accountId ? accountOf(names, input.accountId) : null;
      const goal = await createGoalIn(tx, {
        name: input.name ?? '',
        targetAmount: input.targetAmount,
        dueDate: input.dueDate ?? null,
        accountId: account?.id ?? null,
      });
      const due = goal.dueDate ? toDayString(goal.dueDate) : null;
      return {
        preview: {
          v: 1,
          heading: 'Create goal',
          done: 'Created goal',
          summary: `Created goal ${goal.name} with a target of ${money(goal.targetAmount)}${due ? ` by ${due}` : ''} (id ${goal.id})`,
          destructive: false,
          count: 1,
          items: [
            {
              title: goal.name,
              tone: 'add',
              fields: [
                { label: 'Name', value: goal.name, edit: { key: 'name', control: 'text', value: goal.name } },
                { label: 'Target', value: money(goal.targetAmount), edit: { key: 'targetAmount', control: 'amount', value: goal.targetAmount } },
                { label: 'Due', value: due ?? 'No date', edit: { key: 'dueDate', control: 'date', value: due } },
                ...(account ? [{ label: 'Saved in', value: account.name }] : []),
              ],
            },
          ],
          link,
        },
        refs: { ...noRefs(), goalIds: [goal.id] },
      };
    }

    const goalId = checkId(input.goalId, 'goalId');
    const goal = await tx.goal.findUnique({ where: { id: goalId } });
    if (!goal) bad(`goalId "${goalId}" is not a goal. Call goalProgress to list goals.`);
    if (input.amount === undefined) bad('"contribute" needs an amount.');
    checkAmount(input.amount);
    if (!input.fromAccountId) bad('"contribute" needs fromAccountId. Ask the user which account the money comes from.');
    const from = accountOf(names, input.fromAccountId, 'fromAccountId');
    const onDay = input.date ?? ctx.today;
    await createContributionIn(tx, {
      goalId: goal.id,
      date: onDay,
      amount: input.amount,
      fromAccountId: from.id,
      notes: input.notes ?? null,
    });
    const moves = contributionNeedsTransfer(goal, from.id);
    const goalAccount = goal.accountId ? names.accounts.get(goal.accountId)?.name ?? '' : '';
    const how = moves
      ? `Transfer from ${from.name} to ${goalAccount}`
      : `Set aside in ${from.name} (no money moves)`;
    return {
      preview: {
        v: 1,
        heading: 'Add to goal',
        done: 'Added to goal',
        summary: `Added ${money(input.amount)} to ${goal.name} on ${onDay}. ${how}.`,
        destructive: false,
        count: 1,
        items: [
          {
            title: `${money(input.amount)} toward ${goal.name}`,
            tone: 'add',
            fields: [
              { label: 'Amount', value: money(input.amount), edit: { key: 'amount', control: 'amount', value: input.amount } },
              { label: 'Date', value: onDay, edit: { key: 'date', control: 'date', value: onDay } },
              { label: 'From', value: from.name, edit: { key: 'fromAccountId', control: 'account', value: from.id } },
              { label: 'How', value: how },
            ],
          },
        ],
        link,
      },
      refs: {
        ...noRefs(),
        goalIds: [goal.id],
        accountIds: unique([from.id, ...(moves && goal.accountId ? [goal.accountId] : [])]),
      },
    };
  },
});

// ==================== BUDGETS ====================

const updateBudgets = define({
  description:
    'Propose a change to monthly budgets. action "set": set or change the budget of one expense category for a month (`amount` 0 removes it; `rollover` carries unspent money into the next month). action "copyLastMonth": give `month` the same budgets as the month before, for every category that has no budget in `month` yet; existing budgets are not touched. `month` defaults to the current month.',
  inputSchema: z.object({
    action: z.enum(['set', 'copyLastMonth']),
    month: month.optional().describe('YYYY-MM; defaults to the current month.'),
    categoryId: id.optional().describe('For "set": the expense category.'),
    amount: z.number().nonnegative().optional().describe('For "set": the monthly budget. 0 removes the budget.'),
    rollover: z.boolean().optional().describe('For "set": turn rollover on or off. Omit to keep the current setting.'),
  }),
  editable: /^(amount|month)$/,
  perform: async (tx, input, ctx) => {
    const key = input.month ?? ctx.today.slice(0, 7);
    if (!isValidMonthKey(key)) bad(`month "${key}" must look like YYYY-MM`);
    const link = { href: buildAppLink({ page: 'budgets', month: key }).href, label: 'View in Budgets' };

    if (input.action === 'copyLastMonth') {
      const names = await loadNames(tx);
      const toCopy = await budgetsToCopy(tx, key);
      if (toCopy.length === 0) {
        bad(`Nothing to copy into ${monthName(key)}: the month before has no budgets, or ${monthName(key)} already has a budget for each of them.`);
      }
      const { copied } = await copyPreviousMonthIn(tx, key);
      return {
        preview: {
          v: 1,
          heading: `Copy ${plural(copied, 'budget')} into ${monthName(key)}`,
          done: `Copied ${plural(copied, 'budget')} into ${monthName(key)}`,
          summary: `Copied ${plural(copied, 'budget')} from the month before into ${monthName(key)}: ${toCopy
            .map((b) => `${names.categories.get(b.categoryId)?.name ?? '(deleted)'} ${money(b.amount)}`)
            .join(', ')}`,
          destructive: false,
          count: copied,
          items: toCopy.map((b) => ({
            title: `${names.categories.get(b.categoryId)?.name ?? '(deleted category)'} ${money(b.amount)}`,
            tone: 'add' as const,
            fields: b.rolloverEnabled ? [{ label: 'Rollover', value: 'On' }] : [],
          })),
          link,
        },
        refs: { ...noRefs(), budgets: toCopy.map((b) => ({ categoryId: b.categoryId, month: key })) },
      };
    }

    const names = await loadNames(tx);
    const category = categoryOf(names, input.categoryId, 'EXPENSE');
    if (input.amount === undefined) bad('"set" needs an amount (0 removes the budget).');
    if (input.amount > 0) checkAmount(input.amount);
    const before = await tx.budget.findFirst({ where: { month: budgetMonthDate(key), categoryId: category.id } });
    if (!before && input.amount === 0) bad(`${category.name} has no budget in ${monthName(key)} to remove.`);
    const { removed } = await setBudgetIn(tx, {
      month: key,
      categoryId: category.id,
      amount: input.amount,
      rolloverEnabled: input.rollover,
    });
    const rolloverBefore = before?.rolloverEnabled ?? false;
    const rolloverAfter = input.rollover ?? rolloverBefore;
    if (before && !removed && cents(before.amount) === cents(input.amount) && rolloverBefore === rolloverAfter) {
      bad(`Nothing would change: ${category.name} already has a budget of ${money(before.amount)} in ${monthName(key)}.`);
    }
    const verb = removed ? 'Remove' : before ? 'Change' : 'Set';
    const done = removed ? 'Removed' : before ? 'Changed' : 'Set';
    return {
      preview: {
        v: 1,
        heading: `${verb} budget`,
        done: `${done} budget`,
        summary: removed
          ? `Removed the ${category.name} budget for ${monthName(key)} (was ${money(before!.amount)})`
          : `${done} the ${category.name} budget for ${monthName(key)} ${before ? `from ${money(before.amount)} ` : ''}to ${money(input.amount)}`,
        destructive: false,
        count: 1,
        items: [
          {
            title: `${category.name} · ${monthName(key)}`,
            tone: removed ? 'remove' : before ? 'change' : 'add',
            fields: [
              {
                label: 'Budget',
                value: removed ? 'No budget' : money(input.amount),
                ...(before ? { was: money(before.amount) } : {}),
                edit: { key: 'amount', control: 'amount', value: input.amount },
              },
              ...(removed
                ? []
                : [
                    {
                      label: 'Rollover',
                      value: rolloverAfter ? 'On' : 'Off',
                      ...(before && rolloverBefore !== rolloverAfter ? { was: rolloverBefore ? 'On' : 'Off' } : {}),
                    },
                  ]),
            ],
          },
        ],
        link,
      },
      refs: { ...noRefs(), budgets: [{ categoryId: category.id, month: key }] },
    };
  },
});

// ==================== RECURRING ====================

const updateRecurring = define({
  description:
    'Propose a change to recurring entries (bills, subscriptions, paychecks, regular transfers). action "create": set up a new one from `kind`, `amount`, `frequency`, `startDate` (the first due day), the account and, for income and expenses, a category. action "pause": stop an entry from coming due until it is resumed. action "resume": undo a pause. action "skip": skip only the next occurrence of an entry and move it on to the one after. Get `recurringId` from upcomingRecurring.',
  inputSchema: z.object({
    action: z.enum(['create', 'pause', 'resume', 'skip']),
    recurringId: id.optional().describe('For "pause", "resume" and "skip": the entry, from upcomingRecurring.'),
    name: z.string().max(80).optional().describe('For "create": a short name. Defaults to the merchant.'),
    kind: z.enum(['EXPENSE', 'INCOME', 'TRANSFER']).optional().describe('For "create".'),
    amount: amount.optional().describe('For "create": the amount each time.'),
    frequency: z.enum(FREQUENCIES).optional().describe('For "create": how often it repeats.'),
    startDate: day.optional().describe('For "create": the first due day. It also sets the weekday or day of the month it repeats on.'),
    endDate: day.nullish().describe('For "create": optional last day.'),
    categoryId: id.nullish().describe('For "create": category (income and expenses).'),
    subcategoryId: id.nullish(),
    accountId: id.optional().describe('For "create": account paid from / into, or the account a transfer leaves.'),
    toAccountId: id.nullish().describe('For "create" with kind TRANSFER: the account the money goes to.'),
    merchant: z.string().max(100).nullish().describe('For "create": merchant / payer.'),
    autoPost: z
      .boolean()
      .optional()
      .describe('For "create": true records it automatically on each due day; false (default) only reminds the user, who confirms each one.'),
    notes: z.string().max(500).nullish(),
  }),
  editable: /^(amount|startDate|name)$/,
  perform: async (tx, input) => {
    const names = await loadNames(tx);
    const link = { href: buildAppLink({ page: 'recurring' }).href, label: 'View in Recurring' };

    if (input.action === 'create') {
      if (!input.kind) bad('"create" needs a kind.');
      if (input.amount === undefined) bad('"create" needs an amount.');
      checkAmount(input.amount);
      if (!input.frequency) bad('"create" needs a frequency. Ask the user how often it repeats.');
      if (!input.startDate) bad('"create" needs startDate, the first due day.');
      if (!input.accountId) bad('"create" needs accountId. Ask the user which account.');
      const account = accountOf(names, input.accountId);
      const to = input.kind === 'TRANSFER' ? accountOf(names, input.toAccountId, 'toAccountId') : null;
      const category = input.kind === 'TRANSFER' ? null : categoryOf(names, input.categoryId, input.kind);
      const created = await createRecurringIn(tx, {
        name: input.name,
        kind: input.kind,
        amount: input.amount,
        categoryId: category?.id ?? null,
        subcategoryId: input.subcategoryId ?? null,
        accountId: account.id,
        toAccountId: to?.id ?? null,
        merchantOrSource: input.merchant ?? null,
        notes: input.notes ?? null,
        frequency: input.frequency,
        startDate: input.startDate,
        endDate: input.endDate ?? null,
        autoPost: input.autoPost ?? false,
      });
      const frequency = FREQUENCY_LABELS[created.frequency as Frequency] ?? created.frequency;
      return {
        preview: {
          v: 1,
          heading: 'Create recurring entry',
          done: 'Created recurring entry',
          summary: `Created recurring ${created.kind.toLowerCase()} ${created.name}: ${money(created.amount)} ${frequency.toLowerCase()}, first due ${input.startDate} (id ${created.id})`,
          destructive: false,
          count: 1,
          items: [
            {
              title: created.name,
              tone: 'add',
              fields: [
                { label: 'Name', value: created.name, edit: { key: 'name', control: 'text', value: input.name ?? created.name } },
                { label: 'Amount', value: money(created.amount), edit: { key: 'amount', control: 'amount', value: created.amount } },
                { label: 'Repeats', value: frequency },
                { label: 'First due', value: input.startDate, edit: { key: 'startDate', control: 'date', value: input.startDate } },
                ...(category ? [{ label: 'Category', value: category.name }] : []),
                { label: to ? 'From' : created.kind === 'INCOME' ? 'Into' : 'Paid from', value: account.name },
                ...(to ? [{ label: 'To', value: to.name }] : []),
                { label: 'Records', value: created.autoPost ? 'Automatically on the due day' : 'When you confirm each one' },
                ...(input.endDate ? [{ label: 'Ends', value: input.endDate }] : []),
              ],
            },
          ],
          link,
        },
        refs: noRefs(),
      };
    }

    const recurringId = checkId(input.recurringId, 'recurringId');
    const before = await tx.recurringTransaction.findUnique({ where: { id: recurringId } });
    if (!before) bad(`recurringId "${recurringId}" is not a recurring entry. Call upcomingRecurring to list them.`);
    const title = `${before.name} · ${money(before.amount)} ${(FREQUENCY_LABELS[before.frequency as Frequency] ?? before.frequency).toLowerCase()}`;

    if (input.action === 'skip') {
      const due = toDayString(before.nextDueDate);
      const result = await skipRecurringIn(tx, before.id, due);
      return {
        preview: {
          v: 1,
          heading: 'Skip one occurrence',
          done: 'Skipped one occurrence',
          summary: `Skipped ${before.name} due ${due}. ${result.ended ? 'That was its last occurrence.' : `Next due ${result.nextDueDate}.`}`,
          destructive: false,
          count: 1,
          items: [
            {
              title,
              tone: 'change',
              fields: [
                { label: 'Skipped', value: due },
                { label: 'Next due', value: result.ended ? 'None (ended)' : result.nextDueDate, was: due },
              ],
            },
          ],
          link,
        },
        refs: noRefs(),
      };
    }

    const active = input.action === 'resume';
    if (before.active === active) bad(`${before.name} is already ${active ? 'active' : 'paused'}.`);
    await setRecurringActiveIn(tx, before.id, active);
    return {
      preview: {
        v: 1,
        heading: active ? 'Resume recurring entry' : 'Pause recurring entry',
        done: active ? 'Resumed recurring entry' : 'Paused recurring entry',
        summary: `${active ? 'Resumed' : 'Paused'} ${before.name}${active ? `; next due ${toDayString(before.nextDueDate)}` : ''}`,
        destructive: false,
        count: 1,
        items: [
          {
            title,
            tone: 'change',
            fields: [
              { label: 'Status', value: active ? 'Active' : 'Paused', was: active ? 'Paused' : 'Active' },
              ...(active ? [{ label: 'Next due', value: toDayString(before.nextDueDate) }] : []),
            ],
          },
        ],
        link,
      },
      refs: noRefs(),
    };
  },
});

// ==================== CATEGORIES AND MERCHANTS ====================

const updateCategories = define({
  description:
    'Propose a change to categories or merchant defaults. action "createCategory": a new income or expense category (`name`, `type`, optional `subcategories` and an emoji `icon`). action "createSubcategory": add subcategory `name` under `categoryId`. action "setMerchantDefault": always use `categoryId` (and optionally `subcategoryId`) for `merchant` from now on; with `applyToPast` true, that merchant\'s past transactions of the same kind are moved to the category too, and the card lists every one that changes.',
  inputSchema: z.object({
    action: z.enum(['createCategory', 'createSubcategory', 'setMerchantDefault']),
    name: z.string().max(50).optional().describe('For "createCategory" / "createSubcategory": the new name.'),
    type: z.enum(['EXPENSE', 'INCOME']).optional().describe('For "createCategory".'),
    icon: z.string().max(8).optional().describe('For "createCategory": one emoji.'),
    subcategories: z.array(z.string().max(50)).max(20).optional().describe('For "createCategory": subcategory names to create with it.'),
    categoryId: id.optional().describe('For "createSubcategory": the parent category. For "setMerchantDefault": the default category.'),
    subcategoryId: id.nullish().describe('For "setMerchantDefault": optional default subcategory of that category.'),
    merchant: z.string().max(100).optional().describe('For "setMerchantDefault": the merchant\'s name.'),
    applyToPast: z.boolean().optional().describe('For "setMerchantDefault": also move the merchant\'s past transactions to the category. Only when the user asks for it.'),
  }),
  editable: /^(name|categoryId)$/,
  perform: async (tx, input) => {
    const names = await loadNames(tx);

    if (input.action === 'createCategory') {
      const name = (input.name ?? '').replace(/\s+/g, ' ').trim();
      if (!name) bad('"createCategory" needs a name.');
      if (!input.type) bad('"createCategory" needs a type: EXPENSE or INCOME.');
      const category = await createCategoryIn(tx, {
        name,
        type: input.type,
        icon: input.icon?.trim() || undefined,
        subcategories: uniqueSubcategoryNames(input.subcategories ?? []),
      });
      return {
        preview: {
          v: 1,
          heading: `Create ${input.type === 'INCOME' ? 'income' : 'expense'} category`,
          done: `Created ${input.type === 'INCOME' ? 'income' : 'expense'} category`,
          summary: `Created ${input.type === 'INCOME' ? 'income' : 'expense'} category ${category.name} (id ${category.id})${
            category.subcategories.length
              ? ` with subcategories ${category.subcategories.map((s) => `${s.name} (id ${s.id})`).join(', ')}`
              : ''
          }`,
          destructive: false,
          count: 1 + category.subcategories.length,
          items: [
            {
              title: `${category.icon ? `${category.icon} ` : ''}${category.name}`,
              tone: 'add',
              fields: [
                { label: 'Name', value: category.name, edit: { key: 'name', control: 'text', value: category.name } },
                { label: 'Type', value: category.type === 'INCOME' ? 'Income' : 'Expense' },
                ...(category.subcategories.length
                  ? [{ label: 'Subcategories', value: category.subcategories.map((s) => s.name).join(', ') }]
                  : []),
              ],
            },
          ],
          link: { href: buildAppLink({ page: 'categories' }).href, label: 'View in Categories' },
        },
        refs: noRefs(),
      };
    }

    if (input.action === 'createSubcategory') {
      const category = categoryOf(names, input.categoryId);
      const sub = await addSubcategoryIn(tx, category.id, input.name ?? '');
      return {
        preview: {
          v: 1,
          heading: 'Create subcategory',
          done: 'Created subcategory',
          summary: `Created subcategory ${sub.name} (id ${sub.id}) under ${category.name}`,
          destructive: false,
          count: 1,
          items: [
            {
              title: `${category.name} › ${sub.name}`,
              tone: 'add',
              fields: [
                { label: 'Name', value: sub.name, edit: { key: 'name', control: 'text', value: sub.name } },
                { label: 'Under', value: category.name },
              ],
            },
          ],
          link: { href: buildAppLink({ page: 'categories' }).href, label: 'View in Categories' },
        },
        refs: noRefs(),
      };
    }

    // setMerchantDefault
    const category = categoryOf(names, input.categoryId);
    if (!input.merchant?.trim()) bad('"setMerchantDefault" needs the merchant\'s name.');
    let saved: Awaited<ReturnType<typeof setMerchantCategoryDefaultIn>>;
    try {
      saved = await setMerchantCategoryDefaultIn(tx, {
        name: input.merchant,
        categoryId: category.id,
        subcategoryId: input.subcategoryId ?? null,
      });
    } catch (error) {
      if (error instanceof MerchantDefaultError) bad(error.message);
      throw error;
    }
    const items: PreviewItem[] = [
      {
        title: saved.merchantName,
        tone: 'change',
        fields: [
          {
            label: 'Always use',
            value: category.name,
            edit: {
              key: 'categoryId',
              control: category.type === 'INCOME' ? 'incomeCategory' : 'expenseCategory',
              value: category.id,
            },
          },
        ],
      },
    ];
    let moved: Transaction[] = [];
    if (input.applyToPast && saved.pastToUpdate > 0) {
      const past = await tx.transaction.findMany({ where: { merchantId: saved.merchantId, kind: category.type } });
      await applyMerchantCategoryIn(tx, saved.merchantId, category.id, saved.subcategoryId);
      const after = await tx.transaction.findMany({ where: { id: { in: past.map((t) => t.id) } } });
      const afterBy = new Map(after.map((t) => [t.id, t]));
      moved = past.filter(
        (t) => afterBy.get(t.id)?.categoryId !== t.categoryId || afterBy.get(t.id)?.subcategoryId !== t.subcategoryId
      );
      for (const t of moved) {
        items.push({
          title: `${transactionTitle(t)} · ${toDayString(t.date)}`,
          tone: 'change',
          fields: [{ label: 'Category', value: category.name, was: categoryText(t, names) || '(none)' }],
        });
      }
    }
    const kindNoun = category.type === 'INCOME' ? 'income entry' : 'expense';
    return {
      preview: {
        v: 1,
        heading: `Set default for ${saved.merchantName}`,
        done: `Set default for ${saved.merchantName}`,
        summary: `${saved.merchantName} now defaults to ${category.name}${
          moved.length > 0 ? `; moved ${plural(moved.length, `past ${kindNoun}`)} to it` : ''
        }`,
        destructive: moved.length > 1,
        count: 1 + moved.length,
        items,
        ...(moved.length > 0
          ? { warning: `Also moves ${plural(moved.length, `past ${kindNoun}`)} from ${saved.merchantName} to ${category.name}.` }
          : saved.pastToUpdate > 0
          ? { warning: `${plural(saved.pastToUpdate, `past ${kindNoun}`)} from ${saved.merchantName} keep${saved.pastToUpdate === 1 ? 's its' : ' their'} current category.` }
          : {}),
        link: { href: buildAppLink({ page: 'merchants' }).href, label: 'View in Merchants' },
      },
      refs: { ...noRefs(), budgets: budgetRefs([...moved, ...moved.map((t) => ({ ...t, categoryId: category.id }))]) },
    };
  },
});

// ==================== REGISTRY ====================

export const ACTIONS = {
  logTransactions,
  changeTransactions,
  moveMoney,
  updateFriends,
  updateGoals,
  updateBudgets,
  updateRecurring,
  updateCategories,
};

export type ActionName = keyof typeof ACTIONS;
export const ACTION_NAMES = Object.keys(ACTIONS) as ActionName[];

// ==================== EDITS ====================

/**
 * The tool input with the user's card edits applied. Only paths the action
 * lists as editable can change, and the result is validated again with the
 * tool's own schema. The input the server signed is never modified.
 */
export function applyFieldEdits(name: ActionName, input: unknown, edits: FieldEdits | undefined): unknown {
  if (!edits || Object.keys(edits).length === 0) return input;
  const action = ACTIONS[name];
  const next = structuredClone(input) as Record<string, unknown>;
  for (const [path, value] of Object.entries(edits)) {
    if (!action.editable.test(path)) bad(`"${path}" cannot be changed on this card`);
    const keys = path.split('.');
    let target: Record<string, unknown> = next;
    for (const key of keys.slice(0, -1)) {
      const child = target[key];
      if (child === undefined || child === null) {
        target[key] = {};
      } else if (typeof child !== 'object') {
        bad(`"${path}" cannot be changed on this card`);
      }
      target = target[key] as Record<string, unknown>;
    }
    const last = keys[keys.length - 1];
    // A subcategory belongs to one category; it does not survive a change.
    if (last === 'categoryId' && target.categoryId !== value && 'subcategoryId' in target) {
      target.subcategoryId = null;
    }
    target[last] = value;
  }
  const parsed = action.inputSchema.safeParse(next);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    bad(`${issue?.path.join('.') || 'a value'} is not valid (${issue?.message ?? 'invalid'})`);
  }
  return parsed.data;
}

// ==================== PREVIEW AND SAVE ====================

class Rollback extends Error {
  constructor(readonly outcome: ActionOutcome) {
    super('rollback');
  }
}

/** A problem worth showing to the model, or null for an unexpected failure. */
function readable(error: unknown): string | null {
  if (error instanceof ActionError || error instanceof TransactionError) return error.message;
  if (error instanceof z.ZodError) return error.issues[0]?.message ?? 'Invalid input';
  return null;
}

export type ActionCheck = { ok: true; preview: ProposalPreview } | { ok: false; problem: string };

/**
 * What approving this proposal would do, found by doing it inside a database
 * transaction and rolling that back. Returns the problem instead when the
 * proposal cannot be saved as it is.
 */
export async function previewAction(
  db: TransactionDb,
  name: ActionName,
  input: unknown,
  ctx: ActionContext,
  edits?: FieldEdits
): Promise<ActionCheck> {
  try {
    const action = ACTIONS[name] as unknown as ActionDef<z.ZodTypeAny>;
    const effective = applyFieldEdits(name, input, edits);
    await db.$transaction(async (tx) => {
      throw new Rollback(await action.perform(tx, effective, ctx));
    });
    return { ok: false, problem: 'the change could not be checked' };
  } catch (error) {
    if (error instanceof Rollback) return { ok: true, preview: error.outcome.preview };
    const problem = readable(error);
    if (problem === null) throw error;
    return { ok: false, problem };
  }
}

export type ActionSaved = {
  /** True when this tool call had already been saved; nothing new was written. */
  replayed: boolean;
  outcome: ActionOutcome;
  /** The user changed the proposal on the card before approving. */
  edited: boolean;
};

/** Thrown when an approved proposal could not be saved. The message is readable. */
export class ActionSaveError extends Error {}

/**
 * Make an approved change, once. Everything the action writes and the record
 * that this tool call was handled are committed together or not at all.
 */
export async function saveAction(
  name: ActionName,
  input: unknown,
  toolCallId: string,
  deps: { tx?: Partial<TransactionDeps>; today: DayString; edits?: FieldEdits }
): Promise<ActionSaved> {
  const action = ACTIONS[name] as unknown as ActionDef<z.ZodTypeAny>;
  const edited = !!deps.edits && Object.keys(deps.edits).length > 0;
  const prefix = edited
    ? 'Not saved: the user changed this proposal before approving, and the changed version is not valid'
    : 'Not saved';
  let effective: unknown;
  try {
    effective = applyFieldEdits(name, input, deps.edits);
  } catch (error) {
    throw new ActionSaveError(`${prefix} (${readable(error) ?? 'invalid change'}). Tell the user and offer to propose it again.`);
  }
  const result = await runLedgerWriteOnce(`assistant:${toolCallId}`, deps.tx, 'save this change', async (tx) => {
    try {
      return await action.perform(tx, effective, { today: deps.today });
    } catch (error) {
      // TransactionError is what runLedgerWrite reports back as a readable failure.
      const problem = readable(error);
      if (problem !== null) throw new TransactionError(problem);
      throw error;
    }
  });
  if (!result.success) {
    throw new ActionSaveError(
      edited ? `${prefix} (${result.error}). Tell the user and offer to propose it again.` : `${prefix}: ${result.error}.`
    );
  }
  return { replayed: result.data.replayed, outcome: result.data.value, edited: edited && !result.data.replayed };
}
