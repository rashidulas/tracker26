/**
 * The only place that writes Transaction documents.
 *
 * Every server action (expenses, income, transfers, payments, the chat
 * assistant) goes through createTransaction / updateTransaction /
 * deleteTransaction here, so the rules that keep account balances right live
 * in one place:
 *   - expenses and income always have an account (or account splits)
 *   - categories must match the kind; subcategories must belong to the category
 *   - split items (by category) and account splits must add up to the total
 *   - only transfers carry toAccountId
 *   - editing a transfer keeps its category and system tags ("payment", ...)
 *   - every multi-document write runs inside one prisma.$transaction
 *   - every page that shows transactions or balances is revalidated
 *   - income and expenses with merchant text are linked to a Merchant
 *     (created on first use), and the text becomes the merchant's name
 *   - an expense split with friends keeps one THEY_OWE_ME FriendEntry per
 *     friend (FriendEntry.transactionId) and Transaction.sharedAmount = their
 *     sum; deleting the expense deletes those entries
 *   - a transfer that is a goal contribution (GoalContribution.transactionId)
 *     keeps the contribution's amount, date and source account in step, and
 *     deleting the transfer deletes the contribution
 *
 * lib/friendLedger.ts and lib/goalLedger.ts build on the *In primitives and
 * runLedgerWrite here, so a friend entry or goal contribution and the
 * transaction it belongs to are written in the same database transaction.
 *
 * Server-only. Not a 'use server' file: callers are server actions.
 */
import type { Prisma, PrismaClient, Transaction, TransactionKind } from '@prisma/client';
import { z } from 'zod';
import { isValidDay, parseDay, toDayString } from '@/lib/dates';
import { ensureMerchant } from '@/lib/merchants';

// ==================== DEPENDENCIES ====================

export type TransactionDb = Pick<PrismaClient, '$transaction'>;
type Tx = Prisma.TransactionClient;
/** The client handed to work running inside runLedgerWrite. */
export type LedgerTx = Tx;

export type TransactionDeps = {
  db: TransactionDb;
  revalidate: (path: string) => void;
};

/** Pages that read transactions or balances derived from them. */
export const TRANSACTION_PAGES = [
  '/',
  '/insights',
  '/accounts',
  '/transactions/expenses',
  '/transactions/income',
  '/transactions/transfers',
  '/plan/budgets',
  '/plan/goals',
  '/friends',
  '/plan/recurring',
  '/settings/merchants',
  '/chat',
] as const;

async function resolveDeps(deps?: Partial<TransactionDeps>): Promise<TransactionDeps> {
  if (deps?.db && deps?.revalidate) return deps as TransactionDeps;
  // Imported lazily so tests can run this module without Next or a database.
  const [{ prisma }, { revalidatePath }] = await Promise.all([
    import('@/lib/prisma'),
    import('next/cache'),
  ]);
  return {
    db: deps?.db ?? prisma,
    revalidate: deps?.revalidate ?? ((path) => revalidatePath(path)),
  };
}

// ==================== INPUT ====================

/** Tags the app relies on to find card / debt payments. Never dropped on edit. */
export const SYSTEM_TRANSFER_TAGS = ['payment', 'debt-payment'] as const;

export const TRANSFER_PURPOSES = {
  payment: {
    tag: 'payment',
    category: { name: 'Payment', color: '#3b82f6', icon: '💸' },
    merchantOrSource: 'Payment',
    defaultNotes: 'Account payment transfer',
  },
  'debt-payment': {
    tag: 'debt-payment',
    category: { name: 'Debt Payment', color: '#8b5cf6', icon: '💳' },
    merchantOrSource: 'Debt Payment',
    defaultNotes: 'Debt payment transfer',
  },
} as const;

export type TransferPurpose = keyof typeof TRANSFER_PURPOSES;

const objectId = (label: string) =>
  z
    .string({ required_error: `${label} is required` })
    .trim()
    .regex(/^[a-f\d]{24}$/i, `${label} is invalid`);

const optionalObjectId = (label: string) =>
  z
    .string()
    .trim()
    .nullish()
    .transform((v) => v || null)
    .refine((v) => v === null || /^[a-f\d]{24}$/i.test(v), `${label} is invalid`);

const amountSchema = z
  .number({ required_error: 'Amount is required', invalid_type_error: 'Amount must be a number' })
  .finite('Amount must be a number')
  .positive('Amount must be positive');

/**
 * A transaction date is a calendar day stored as UTC midnight (lib/dates.ts).
 * Accepts a `YYYY-MM-DD` string, or a Date whose UTC day is that day.
 */
const dateSchema = z
  .union([z.date(), z.string()], { required_error: 'Date is required' })
  .transform((v, ctx) => {
    const day =
      v instanceof Date ? (Number.isNaN(v.getTime()) ? '' : toDayString(v)) : v.trim();
    if (!isValidDay(day)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Please enter a valid date' });
      return z.NEVER;
    }
    return parseDay(day);
  });

/** undefined = leave as is on update; '' / null = clear. */
const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((v) => (v === undefined ? undefined : v?.trim() || null));

const tagsSchema = z.array(z.string()).optional();

const accountSplitSchema = z.object({
  accountId: objectId('Split account'),
  amount: z.number().finite().positive('Split amount must be positive'),
});

const splitItemSchema = z.object({
  categoryId: objectId('Split category'),
  amount: z.number().finite().positive('Split amount must be positive'),
  notes: optionalText(200),
});

const friendSplitSchema = z.object({
  friendId: objectId('Friend'),
  amount: z.number().finite().positive("A friend's share must be positive"),
});

const common = {
  date: dateSchema,
  amount: amountSchema,
  merchantOrSource: optionalText(100),
  notes: optionalText(500),
  tags: tagsSchema,
};

const expenseInputSchema = z.object({
  kind: z.literal('EXPENSE'),
  ...common,
  categoryId: optionalObjectId('Category'),
  subcategoryId: optionalObjectId('Subcategory'),
  accountId: optionalObjectId('Account'),
  accountSplits: z.array(accountSplitSchema).optional(),
  splitItems: z.array(splitItemSchema).optional(),
  /**
   * What each friend owes you for this expense. undefined = keep the current
   * split on update; [] = not split.
   */
  friendSplits: z.array(friendSplitSchema).optional(),
});

const incomeInputSchema = z.object({
  kind: z.literal('INCOME'),
  ...common,
  categoryId: optionalObjectId('Category'),
  subcategoryId: optionalObjectId('Subcategory'),
  accountId: optionalObjectId('Account'),
  accountSplits: z.array(accountSplitSchema).optional(),
});

const transferInputSchema = z.object({
  kind: z.literal('TRANSFER'),
  ...common,
  accountId: objectId('From account'),
  toAccountId: objectId('To account'),
  purpose: z.enum(['payment', 'debt-payment']).optional(),
});

export const transactionInputSchema = z.discriminatedUnion('kind', [
  expenseInputSchema,
  incomeInputSchema,
  transferInputSchema,
]);

export type ExpenseInput = z.input<typeof expenseInputSchema>;
export type IncomeInput = z.input<typeof incomeInputSchema>;
export type TransferInput = z.input<typeof transferInputSchema>;
export type TransactionInput = z.input<typeof transactionInputSchema>;
export type FriendSplit = z.input<typeof friendSplitSchema>;
type ParsedInput = z.output<typeof transactionInputSchema>;

export type TransactionResult<T = Transaction> =
  | { success: true; data: T }
  | { success: false; error: string };

// ==================== ERRORS ====================

/** A problem with the request that the user can fix. Message is shown as-is. */
export class TransactionError extends Error {}

export function fail(message: string): never {
  throw new TransactionError(message);
}

export const cents = (n: number) => Math.round(n * 100);
const money = (n: number) => `$${n.toFixed(2)}`;

function kindLabel(kind: TransactionKind) {
  return kind === 'INCOME' ? 'income' : kind === 'EXPENSE' ? 'an expense' : 'a transfer';
}

export function normalizeTags(tags: string[] | undefined | null): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags || []) {
    const tag = raw.trim();
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

function isSystemTag(tag: string) {
  return (SYSTEM_TRANSFER_TAGS as readonly string[]).includes(tag.toLowerCase());
}

export function isPaymentTransfer(t: { kind: TransactionKind; tags: string[] }) {
  return t.kind === 'TRANSFER' && t.tags.some(isSystemTag);
}

// ==================== RESOLUTION ====================

async function assertAccountsExist(tx: Tx, ids: string[]) {
  const unique = [...new Set(ids)];
  const found = await tx.account.findMany({
    where: { id: { in: unique } },
    select: { id: true },
  });
  if (found.length !== unique.length) fail('Account not found');
}

/** Primary account + embedded account splits for an income or expense. */
async function resolveAccounts(
  tx: Tx,
  input: Extract<ParsedInput, { kind: 'EXPENSE' | 'INCOME' }>
): Promise<{ accountId: string; accountSplits: { accountId: string; amount: number }[] }> {
  const splits = input.accountSplits ?? [];

  if (splits.length > 0) {
    const ids = splits.map((s) => s.accountId);
    if (new Set(ids).size !== ids.length) fail('Each split must use a different account');
    const total = splits.reduce((sum, s) => sum + s.amount, 0);
    if (cents(total) !== cents(input.amount)) {
      fail(
        `Account amounts ($${total.toFixed(2)}) must equal total ($${input.amount.toFixed(2)})`
      );
    }
    await assertAccountsExist(tx, ids);
    // One split is just a single account.
    return {
      accountId: splits[0].accountId,
      accountSplits: splits.length > 1 ? splits.map((s) => ({ ...s })) : [],
    };
  }

  if (!input.accountId) {
    fail(
      input.kind === 'EXPENSE'
        ? 'Choose the account this expense was paid from'
        : 'Choose the account this income went into'
    );
  }
  await assertAccountsExist(tx, [input.accountId]);
  return { accountId: input.accountId, accountSplits: [] };
}

async function resolveCategory(
  tx: Tx,
  input: Extract<ParsedInput, { kind: 'EXPENSE' | 'INCOME' }>
): Promise<{
  categoryId: string | null;
  subcategoryId: string | null;
  splitItems: { categoryId: string; amount: number; notes: string | null }[];
}> {
  const splitItems = input.kind === 'EXPENSE' ? input.splitItems ?? [] : [];

  if (splitItems.length > 0) {
    if (input.subcategoryId) fail('A split expense cannot have a subcategory');
    const total = splitItems.reduce((sum, s) => sum + s.amount, 0);
    if (cents(total) !== cents(input.amount)) {
      fail('Split amounts must sum to transaction amount');
    }
    const ids = [...new Set(splitItems.map((s) => s.categoryId))];
    const categories = await tx.category.findMany({
      where: { id: { in: ids } },
      select: { id: true, type: true },
    });
    if (categories.length !== ids.length) fail('Category not found');
    if (categories.some((c) => c.type !== 'EXPENSE')) {
      fail('Split categories must be expense categories');
    }
    return {
      categoryId: null,
      subcategoryId: null,
      splitItems: splitItems.map((s) => ({
        categoryId: s.categoryId,
        amount: s.amount,
        notes: s.notes ?? null,
      })),
    };
  }

  if (!input.categoryId) fail('Category is required');
  const category = await tx.category.findUnique({
    where: { id: input.categoryId },
    select: { id: true, type: true },
  });
  if (!category) fail('Category not found');
  if (category.type !== input.kind) {
    fail(`That category is not ${input.kind === 'INCOME' ? 'an income' : 'an expense'} category`);
  }

  let subcategoryId: string | null = null;
  if (input.subcategoryId) {
    const sub = await tx.subcategory.findFirst({
      where: { id: input.subcategoryId, categoryId: category.id },
      select: { id: true },
    });
    if (!sub) fail('Subcategory does not belong to the selected category');
    subcategoryId = sub.id;
  }

  return { categoryId: category.id, subcategoryId, splitItems: [] };
}

async function purposeCategoryId(tx: Tx, purpose: TransferPurpose) {
  const { category } = TRANSFER_PURPOSES[purpose];
  const row = await tx.category.upsert({
    where: { name_type: { name: category.name, type: 'EXPENSE' } },
    create: { ...category, type: 'EXPENSE' },
    update: {},
    select: { id: true },
  });
  return row.id;
}

type WriteData = Omit<Prisma.TransactionUncheckedCreateInput, 'id' | 'createdAt' | 'updatedAt'>;

/** Full document for an income/expense. `existing` supplies kept optional text. */
async function buildIncomeOrExpense(
  tx: Tx,
  input: Extract<ParsedInput, { kind: 'EXPENSE' | 'INCOME' }>,
  existing?: Transaction
): Promise<WriteData> {
  // Sequential on purpose: one MongoDB session should not run queries in parallel.
  const cat = await resolveCategory(tx, input);
  const acct = await resolveAccounts(tx, input);
  const merchantText =
    input.merchantOrSource !== undefined ? input.merchantOrSource : existing?.merchantOrSource ?? null;
  const merchant = await ensureMerchant(tx, merchantText);
  return {
    kind: input.kind,
    date: input.date,
    amount: input.amount,
    categoryId: cat.categoryId,
    subcategoryId: cat.subcategoryId,
    splitItems: cat.splitItems,
    accountId: acct.accountId,
    accountSplits: acct.accountSplits,
    toAccountId: null,
    merchantOrSource: merchant?.name ?? null,
    merchantId: merchant?.id ?? null,
    notes: input.notes !== undefined ? input.notes : existing?.notes ?? null,
    tags: input.tags !== undefined ? normalizeTags(input.tags) : existing?.tags ?? [],
    splitGroupId: null,
  };
}

async function buildTransfer(
  tx: Tx,
  input: Extract<ParsedInput, { kind: 'TRANSFER' }>,
  existing?: Transaction
): Promise<WriteData> {
  if (input.accountId === input.toAccountId) fail('From and To accounts cannot be the same');
  await assertAccountsExist(tx, [input.accountId, input.toAccountId]);

  const purpose = input.purpose ? TRANSFER_PURPOSES[input.purpose] : null;

  // Keep the category and the system tags of an existing transfer: the
  // Transfers page does not know about them, and the Expenses list finds card
  // payments by the "payment" tag.
  const categoryId = input.purpose
    ? await purposeCategoryId(tx, input.purpose)
    : existing?.categoryId ?? null;
  const keptSystemTags = (existing?.tags ?? []).filter(isSystemTag);
  const baseTags = input.tags !== undefined ? input.tags : existing?.tags ?? [];
  const tags = normalizeTags([...baseTags, ...keptSystemTags, ...(purpose ? [purpose.tag] : [])]);

  const merchantOrSource =
    input.merchantOrSource !== undefined
      ? input.merchantOrSource
      : existing
      ? existing.merchantOrSource
      : purpose?.merchantOrSource ?? null;
  // On create, an empty note falls back to the purpose's default.
  const notes = existing
    ? input.notes !== undefined
      ? input.notes
      : existing.notes
    : input.notes || purpose?.defaultNotes || null;

  return {
    kind: 'TRANSFER',
    date: input.date,
    amount: input.amount,
    accountId: input.accountId,
    toAccountId: input.toAccountId,
    categoryId,
    subcategoryId: null,
    splitItems: [],
    accountSplits: [],
    merchantOrSource,
    merchantId: null,
    notes,
    tags,
    splitGroupId: null,
  };
}

function parseInput(input: TransactionInput): ParsedInput {
  const parsed = transactionInputSchema.safeParse(input);
  if (!parsed.success) fail(parsed.error.errors[0]?.message || 'Invalid transaction');
  return parsed.data;
}

// ==================== RUNNER ====================

/**
 * Runs `work` in one database transaction, turns TransactionError into a
 * user-facing error and revalidates every page that shows money. Used by this
 * module and by lib/friendLedger.ts and lib/goalLedger.ts.
 */
export async function runLedgerWrite<T>(
  deps: Partial<TransactionDeps> | undefined,
  label: string,
  work: (tx: Tx) => Promise<T>
): Promise<TransactionResult<T>> {
  const { db, revalidate } = await resolveDeps(deps);
  let data: T;
  try {
    data = await db.$transaction((tx) => work(tx));
  } catch (error) {
    if (error instanceof TransactionError) return { success: false, error: error.message };
    console.error(`Error trying to ${label}:`, error);
    return { success: false, error: `Failed to ${label}` };
  }
  for (const path of TRANSACTION_PAGES) revalidate(path);
  return { success: true, data };
}

const run = runLedgerWrite;

// ==================== LINKED FRIEND ENTRIES ====================

/** Description given to the IOU entries of a split expense. */
async function sharedExpenseDescription(
  tx: Tx,
  t: Pick<Transaction, 'merchantOrSource' | 'categoryId'>
): Promise<string> {
  if (t.merchantOrSource) return t.merchantOrSource;
  if (t.categoryId) {
    const category = await tx.category.findUnique({
      where: { id: t.categoryId },
      select: { name: true },
    });
    if (category) return category.name;
  }
  return 'Shared expense';
}

/**
 * Makes the expense's linked THEY_OWE_ME entries match `splits` (one per
 * friend) and stores their sum in sharedAmount. With `splits` undefined the
 * current entries are kept and only follow the expense's date and name.
 *
 * `previousDescription` is the auto description before this edit: an entry
 * whose description was changed by hand keeps it.
 */
async function syncFriendSplits(
  tx: Tx,
  transaction: Transaction,
  splits: { friendId: string; amount: number }[] | undefined,
  previousDescription: string | null
): Promise<void> {
  const existing = await tx.friendEntry.findMany({ where: { transactionId: transaction.id } });
  if (splits === undefined && existing.length === 0) return;
  if (transaction.kind !== 'EXPENSE') {
    if ((splits?.length ?? 0) > 0 || existing.length > 0) {
      fail('Only expenses can be split with friends');
    }
    return;
  }

  const description = await sharedExpenseDescription(tx, transaction);
  const keepsAutoDescription = (current: string | null) =>
    !current || current === previousDescription || current === description;

  let shared = 0;
  if (splits === undefined) {
    for (const entry of existing) {
      shared += entry.amount;
      await tx.friendEntry.update({
        where: { id: entry.id },
        data: {
          date: transaction.date,
          ...(keepsAutoDescription(entry.description) ? { description } : {}),
        },
      });
    }
  } else {
    const friendIds = splits.map((s) => s.friendId);
    if (new Set(friendIds).size !== friendIds.length) {
      fail('Each friend can only be in a split once');
    }
    if (friendIds.length > 0) {
      const found = await tx.friend.findMany({
        where: { id: { in: friendIds } },
        select: { id: true },
      });
      if (found.length !== friendIds.length) fail('Friend not found');
    }

    const kept = new Set<string>();
    for (const split of splits) {
      shared += split.amount;
      const current = existing.find((e) => e.friendId === split.friendId && !kept.has(e.id));
      if (current) {
        kept.add(current.id);
        await tx.friendEntry.update({
          where: { id: current.id },
          data: {
            amount: split.amount,
            date: transaction.date,
            ...(keepsAutoDescription(current.description) ? { description } : {}),
          },
        });
      } else {
        await tx.friendEntry.create({
          data: {
            friendId: split.friendId,
            transactionId: transaction.id,
            accountId: null,
            type: 'THEY_OWE_ME',
            amount: split.amount,
            date: transaction.date,
            description,
          },
        });
      }
    }
    const removed = existing.filter((e) => !kept.has(e.id)).map((e) => e.id);
    if (removed.length > 0) {
      await tx.friendEntry.deleteMany({ where: { id: { in: removed } } });
    }
  }

  if (cents(shared) > cents(transaction.amount)) {
    fail(
      `Friends' shares (${money(shared)}) can't be more than the expense (${money(transaction.amount)})`
    );
  }
  const sharedAmount = shared > 0 ? cents(shared) / 100 : null;
  if ((transaction.sharedAmount ?? null) !== sharedAmount) {
    await tx.transaction.update({ where: { id: transaction.id }, data: { sharedAmount } });
    transaction.sharedAmount = sharedAmount;
  }
}

/**
 * Recomputes an expense's sharedAmount from its linked friend entries, after
 * one of them was edited or deleted on the Friends page.
 */
export async function refreshSharedAmount(tx: Tx, transactionId: string): Promise<void> {
  const transaction = await tx.transaction.findUnique({ where: { id: transactionId } });
  if (!transaction) return;
  const entries = await tx.friendEntry.findMany({
    where: { transactionId },
    select: { amount: true },
  });
  const shared = entries.reduce((sum, e) => sum + e.amount, 0);
  if (cents(shared) > cents(transaction.amount)) {
    fail(
      `Friends' shares (${money(shared)}) can't be more than the expense (${money(transaction.amount)})`
    );
  }
  const sharedAmount = shared > 0 ? cents(shared) / 100 : null;
  if ((transaction.sharedAmount ?? null) !== sharedAmount) {
    await tx.transaction.update({ where: { id: transactionId }, data: { sharedAmount } });
  }
}

// ==================== LINKED GOAL CONTRIBUTIONS ====================

/**
 * A transfer that funds a goal: the contribution follows the transfer's
 * amount, date and source account. Its destination must stay the goal's
 * account, otherwise the goal and the account would disagree.
 */
async function syncGoalContributions(tx: Tx, transfer: Transaction): Promise<void> {
  const linked = await tx.goalContribution.findMany({
    where: { transactionId: transfer.id },
    select: { id: true, goalId: true },
  });
  for (const contribution of linked) {
    const goal = await tx.goal.findUnique({
      where: { id: contribution.goalId },
      select: { name: true, accountId: true },
    });
    if (transfer.kind !== 'TRANSFER' || !transfer.accountId) {
      fail('This transaction funds a goal and must stay a transfer');
    }
    if (goal?.accountId && goal.accountId !== transfer.toAccountId) {
      fail(
        `This transfer is a contribution to "${goal.name}" and has to go into that goal's account. Change it from Goals instead.`
      );
    }
    await tx.goalContribution.update({
      where: { id: contribution.id },
      data: { amount: transfer.amount, date: transfer.date, fromAccountId: transfer.accountId },
    });
  }
}

/** Friend entries and goal contributions that exist only because of these rows. */
async function deleteLinkedRecords(tx: Tx, transactionIds: string[]) {
  if (transactionIds.length === 0) return;
  await tx.friendEntry.deleteMany({ where: { transactionId: { in: transactionIds } } });
  await tx.goalContribution.deleteMany({ where: { transactionId: { in: transactionIds } } });
}

// ==================== IN-TRANSACTION PRIMITIVES ====================

/** createTransaction, inside a transaction the caller already opened. */
export async function createTransactionIn(
  tx: Tx,
  input: TransactionInput,
  extra: { recurringId?: string | null } = {}
): Promise<Transaction> {
  const parsed = parseInput(input);
  const data =
    parsed.kind === 'TRANSFER'
      ? await buildTransfer(tx, parsed)
      : await buildIncomeOrExpense(tx, parsed);
  // recurringId: set when posted from a recurring entry (lib/recurring.ts).
  const created = await tx.transaction.create({
    data: { ...data, recurringId: extra.recurringId ?? null },
  });
  if (parsed.kind === 'EXPENSE' && (parsed.friendSplits?.length ?? 0) > 0) {
    await syncFriendSplits(tx, created, parsed.friendSplits, null);
  }
  return created;
}

// ==================== PUBLIC API ====================

export async function createTransaction(
  input: TransactionInput,
  deps?: Partial<TransactionDeps>
): Promise<TransactionResult> {
  return run(deps, 'save transaction', (tx) => createTransactionIn(tx, input));
}

/**
 * createTransaction that runs at most once per `key`.
 *
 * The key is stored in IdempotencyKey in the same database transaction as the
 * new row. Calling again with a key that was already used returns the row the
 * first call saved (`replayed: true`) instead of saving a second one. If two
 * calls race, the unique index on the key makes one of them fail; that one
 * then finds the winner's row and returns it.
 */
export async function createTransactionOnce(
  key: string,
  input: TransactionInput,
  deps?: Partial<TransactionDeps>
): Promise<TransactionResult<{ transaction: Transaction; replayed: boolean }>> {
  if (!key.trim()) return { success: false, error: 'Missing idempotency key' };

  const findPrior = async (tx: Tx) => {
    const prior = await tx.idempotencyKey.findUnique({ where: { key } });
    if (!prior) return null;
    const transaction = await tx.transaction.findUnique({ where: { id: prior.transactionId } });
    if (!transaction) fail('This was already saved once and has since been deleted');
    return transaction;
  };

  const result = await run(deps, 'save transaction', async (tx) => {
    const prior = await findPrior(tx);
    if (prior) return { transaction: prior, replayed: true };
    const transaction = await createTransactionIn(tx, input);
    await tx.idempotencyKey.create({ data: { key, transactionId: transaction.id } });
    return { transaction, replayed: false };
  });
  if (result.success) return result;

  // Lost a race with a concurrent call using the same key?
  const winner = await run(deps, 'save transaction', findPrior);
  if (winner.success && winner.data) {
    return { success: true, data: { transaction: winner.data, replayed: true } };
  }
  return result;
}

export type UpdateOptions = {
  /**
   * Legacy multi-row income splits: ids of sibling rows of the same kind that
   * this edit replaces. They are deleted in the same database transaction.
   */
  absorbLegacyIds?: string[];
};

/** updateTransaction, inside a transaction the caller already opened. */
export async function updateTransactionIn(
  tx: Tx,
  id: string,
  input: TransactionInput,
  options: UpdateOptions = {}
): Promise<Transaction> {
  const existing = await tx.transaction.findUnique({ where: { id } });
  if (!existing) fail('Transaction not found');

  let parsed = parseInput(input);

  // Card / debt payments are listed on the Expenses page, so the expense
  // form can edit them. Keep them transfers: same destination account,
  // category and tags.
  if (parsed.kind === 'EXPENSE' && isPaymentTransfer(existing) && existing.toAccountId) {
    if ((parsed.friendSplits?.length ?? 0) > 0) {
      fail('A card or debt payment cannot be split with friends');
    }
    const fromAccountId =
      parsed.accountId ?? parsed.accountSplits?.[0]?.accountId ?? existing.accountId;
    if (!fromAccountId) fail('Choose the account this payment was made from');
    parsed = parseInput({
      kind: 'TRANSFER',
      date: parsed.date,
      amount: parsed.amount,
      accountId: fromAccountId,
      toAccountId: existing.toAccountId,
      merchantOrSource: parsed.merchantOrSource,
      notes: parsed.notes,
      tags: parsed.tags,
    });
  }

  if (parsed.kind !== existing.kind) {
    fail(
      `This is ${kindLabel(existing.kind)} and can't be changed into ${kindLabel(parsed.kind)}. Delete it and add a new one instead.`
    );
  }

  const previousDescription =
    existing.kind === 'EXPENSE' ? await sharedExpenseDescription(tx, existing) : null;

  const data =
    parsed.kind === 'TRANSFER'
      ? await buildTransfer(tx, parsed, existing)
      : await buildIncomeOrExpense(tx, parsed, existing);

  const siblings = (options.absorbLegacyIds ?? []).filter((s) => s !== id);
  const siblingWhere: Prisma.TransactionWhereInput[] = [];
  if (siblings.length > 0) siblingWhere.push({ id: { in: siblings } });
  if (existing.splitGroupId) siblingWhere.push({ splitGroupId: existing.splitGroupId });
  if (siblingWhere.length > 0) {
    const doomed = await tx.transaction.findMany({
      where: { OR: siblingWhere, kind: existing.kind, id: { not: id } },
      select: { id: true },
    });
    await deleteLinkedRecords(
      tx,
      doomed.map((d) => d.id)
    );
    await tx.transaction.deleteMany({
      where: { OR: siblingWhere, kind: existing.kind, id: { not: id } },
    });
  }

  const updated = await tx.transaction.update({ where: { id }, data });
  if (updated.kind === 'TRANSFER') {
    await syncGoalContributions(tx, updated);
  } else {
    await syncFriendSplits(
      tx,
      updated,
      parsed.kind === 'EXPENSE' ? parsed.friendSplits : undefined,
      previousDescription
    );
  }
  return updated;
}

export async function updateTransaction(
  id: string,
  input: TransactionInput,
  options: UpdateOptions = {},
  deps?: Partial<TransactionDeps>
): Promise<TransactionResult> {
  return run(deps, 'update transaction', (tx) => updateTransactionIn(tx, id, input, options));
}

export type DeleteOptions = {
  /** Legacy multi-row income splits: sibling rows to delete with this one. */
  legacyMemberIds?: string[];
};

/**
 * deleteTransaction, inside a transaction the caller already opened. Also
 * deletes the friend IOUs of a split expense and the goal contribution a
 * transfer paid for.
 */
export async function deleteTransactionIn(
  tx: Tx,
  id: string,
  options: DeleteOptions = {}
): Promise<{ deleted: number }> {
  const existing = await tx.transaction.findUnique({ where: { id } });
  if (!existing) fail('Transaction not found');

  const ids = new Set([id, ...(options.legacyMemberIds ?? [])]);
  const or: Prisma.TransactionWhereInput[] = [{ id: { in: [...ids] } }];
  if (existing.splitGroupId) or.push({ splitGroupId: existing.splitGroupId });
  const where: Prisma.TransactionWhereInput = { OR: or, kind: existing.kind };

  const doomed = await tx.transaction.findMany({ where, select: { id: true } });
  await deleteLinkedRecords(
    tx,
    doomed.map((d) => d.id)
  );
  const { count } = await tx.transaction.deleteMany({ where });
  return { deleted: count };
}

export async function deleteTransaction(
  id: string,
  options: DeleteOptions = {},
  deps?: Partial<TransactionDeps>
): Promise<TransactionResult<{ deleted: number }>> {
  return run(deps, 'delete transaction', (tx) => deleteTransactionIn(tx, id, options));
}

// ==================== BULK (list pages) ====================

const MAX_BULK = 500;

function checkIds(ids: string[]) {
  const unique = [...new Set(ids)];
  if (unique.length === 0) fail('Nothing selected');
  if (unique.length > MAX_BULK) fail(`Select at most ${MAX_BULK} transactions`);
  if (unique.some((id) => !/^[a-f\d]{24}$/i.test(id))) fail('Transaction not found');
  return unique;
}

const listInclude = {
  category: true,
  subcategory: true,
  account: true,
  toAccount: true,
} satisfies Prisma.TransactionInclude;

/**
 * Copies each transaction onto `day` (YYYY-MM-DD). Each copy is rebuilt
 * through the same rules as a normal create, with the source as `existing` so
 * transfers keep their category and system tags.
 */
export async function duplicateTransactions(
  ids: string[],
  day: string,
  deps?: Partial<TransactionDeps>
): Promise<TransactionResult<Prisma.TransactionGetPayload<{ include: typeof listInclude }>[]>> {
  return run(deps, 'duplicate transactions', async (tx) => {
    const unique = checkIds(ids);
    if (!isValidDay(day)) fail('Please enter a valid date');
    const sources = await tx.transaction.findMany({ where: { id: { in: unique } } });
    if (sources.length !== unique.length) fail('Transaction not found');

    const created = [];
    for (const src of sources) {
      const base = {
        date: day,
        amount: src.amount,
        merchantOrSource: src.merchantOrSource,
        notes: src.notes,
        tags: src.tags,
      };
      const parsed =
        src.kind === 'TRANSFER'
          ? parseInput({
              ...base,
              kind: 'TRANSFER',
              accountId: src.accountId ?? '',
              toAccountId: src.toAccountId ?? '',
            })
          : parseInput({
              ...base,
              kind: src.kind,
              categoryId: src.categoryId,
              subcategoryId: src.subcategoryId,
              accountId: src.accountId,
              accountSplits: src.accountSplits.length > 1 ? src.accountSplits : undefined,
              ...(src.kind === 'EXPENSE' && src.splitItems.length > 0
                ? { splitItems: src.splitItems }
                : {}),
            });
      const data =
        parsed.kind === 'TRANSFER'
          ? await buildTransfer(tx, parsed, src)
          : await buildIncomeOrExpense(tx, parsed, src);
      created.push(await tx.transaction.create({ data, include: listInclude }));
    }
    return created;
  });
}

/** Deletes the given transactions plus any legacy split-group siblings. */
export async function deleteTransactions(
  ids: string[],
  deps?: Partial<TransactionDeps>
): Promise<TransactionResult<{ deleted: number }>> {
  return run(deps, 'delete transactions', async (tx) => {
    const unique = checkIds(ids);
    const rows = await tx.transaction.findMany({
      where: { id: { in: unique } },
      select: { splitGroupId: true },
    });
    if (rows.length === 0) fail('Transaction not found');
    const groups = [...new Set(rows.map((r) => r.splitGroupId).filter((g): g is string => !!g))];
    const or: Prisma.TransactionWhereInput[] = [{ id: { in: unique } }];
    if (groups.length > 0) or.push({ splitGroupId: { in: groups } });
    const doomed = await tx.transaction.findMany({ where: { OR: or }, select: { id: true } });
    await deleteLinkedRecords(
      tx,
      doomed.map((d) => d.id)
    );
    const { count } = await tx.transaction.deleteMany({ where: { OR: or } });
    return { deleted: count };
  });
}

/**
 * Moves transactions to `categoryId` and clears their subcategory. Only rows
 * whose kind matches the category type change; transfers and split expenses
 * (whose categories live on their split items) are skipped.
 */
export async function recategorizeTransactions(
  ids: string[],
  categoryId: string,
  deps?: Partial<TransactionDeps>
): Promise<TransactionResult<{ updated: number }>> {
  return run(deps, 're-categorise transactions', async (tx) => {
    const unique = checkIds(ids);
    if (!/^[a-f\d]{24}$/i.test(categoryId)) fail('Category not found');
    const category = await tx.category.findUnique({
      where: { id: categoryId },
      select: { id: true, type: true },
    });
    if (!category) fail('Category not found');
    const { count } = await tx.transaction.updateMany({
      where: { id: { in: unique }, kind: category.type, splitItems: { isEmpty: true } },
      data: { categoryId: category.id, subcategoryId: null },
    });
    return { updated: count };
  });
}

/**
 * Gives every income/expense of `merchantId` the category `categoryId` (and
 * subcategory, which may be null). Rows of the other kind and split expenses
 * are left alone. Used by "apply to past transactions" after the user sets a
 * merchant default.
 */
export async function applyMerchantCategory(
  merchantId: string,
  categoryId: string,
  subcategoryId: string | null,
  deps?: Partial<TransactionDeps>
): Promise<TransactionResult<{ updated: number }>> {
  return run(deps, 'update past transactions', async (tx) => {
    if (!/^[a-f\d]{24}$/i.test(merchantId)) fail('Merchant not found');
    if (!/^[a-f\d]{24}$/i.test(categoryId)) fail('Category not found');
    const category = await tx.category.findUnique({
      where: { id: categoryId },
      select: { id: true, type: true },
    });
    if (!category) fail('Category not found');
    if (subcategoryId) {
      const sub = await tx.subcategory.findFirst({
        where: { id: subcategoryId, categoryId },
        select: { id: true },
      });
      if (!sub) fail('Subcategory does not belong to the selected category');
    }
    // Split expenses are filtered here, not with `splitItems: { isEmpty: true }`:
    // older documents have no splitItems field at all, and MongoDB's isEmpty
    // does not match a missing field.
    const rows = await tx.transaction.findMany({
      where: { merchantId, kind: category.type },
      select: { id: true, categoryId: true, subcategoryId: true, splitItems: true },
    });
    const ids = rows
      .filter((r) => (r.splitItems ?? []).length === 0)
      .filter((r) => r.categoryId !== categoryId || (r.subcategoryId ?? null) !== subcategoryId)
      .map((r) => r.id);
    if (ids.length === 0) return { updated: 0 };
    const { count } = await tx.transaction.updateMany({
      where: { id: { in: ids } },
      data: { categoryId, subcategoryId },
    });
    return { updated: count };
  });
}

/**
 * Clear subcategoryId on transactions before those subcategories are deleted.
 * Runs inside the caller's database transaction (category edit). Does not
 * change any amount or account, so balances are unaffected.
 */
export async function detachSubcategories(tx: Tx, subcategoryIds: string[]) {
  if (subcategoryIds.length === 0) return 0;
  const { count } = await tx.transaction.updateMany({
    where: { subcategoryId: { in: subcategoryIds } },
    data: { subcategoryId: null },
  });
  // Merchant defaults and recurring templates point at subcategories too.
  await tx.merchant.updateMany({
    where: { defaultSubcategoryId: { in: subcategoryIds } },
    data: { defaultSubcategoryId: null },
  });
  await tx.recurringTransaction.updateMany({
    where: { subcategoryId: { in: subcategoryIds } },
    data: { subcategoryId: null },
  });
  return count;
}

// ==================== READ HELPERS ====================

export {
  expenseCategoryAllocations,
  myShareOfExpense,
  sumMyShare,
} from '@/lib/expenseAllocations';
