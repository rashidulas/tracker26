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
 *
 * Server-only. Not a 'use server' file: callers are server actions.
 */
import type { Prisma, PrismaClient, Transaction, TransactionKind } from '@prisma/client';
import { z } from 'zod';

// ==================== DEPENDENCIES ====================

export type TransactionDb = Pick<PrismaClient, '$transaction'>;
type Tx = Prisma.TransactionClient;

export type TransactionDeps = {
  db: TransactionDb;
  revalidate: (path: string) => void;
};

/** Pages that read transactions or balances derived from them. */
export const TRANSACTION_PAGES = [
  '/',
  '/dashboard',
  '/accounts',
  '/expenses',
  '/income',
  '/transfers',
  '/analytics',
  '/budgets',
  '/expenses-dashboard',
  '/income-dashboard',
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

const dateSchema = z
  .union([z.date(), z.string().trim().min(1, 'Date is required')], {
    required_error: 'Date is required',
  })
  .transform((v) => (v instanceof Date ? v : new Date(v)))
  .refine((d) => !Number.isNaN(d.getTime()), 'Date is invalid');

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
type ParsedInput = z.output<typeof transactionInputSchema>;

export type TransactionResult<T = Transaction> =
  | { success: true; data: T }
  | { success: false; error: string };

// ==================== ERRORS ====================

/** A problem with the request that the user can fix. Message is shown as-is. */
export class TransactionError extends Error {}

function fail(message: string): never {
  throw new TransactionError(message);
}

const cents = (n: number) => Math.round(n * 100);

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
    merchantOrSource:
      input.merchantOrSource !== undefined ? input.merchantOrSource : existing?.merchantOrSource ?? null,
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

async function run<T>(
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

// ==================== PUBLIC API ====================

export async function createTransaction(
  input: TransactionInput,
  deps?: Partial<TransactionDeps>
): Promise<TransactionResult> {
  return run(deps, 'save transaction', async (tx) => {
    const parsed = parseInput(input);
    const data =
      parsed.kind === 'TRANSFER'
        ? await buildTransfer(tx, parsed)
        : await buildIncomeOrExpense(tx, parsed);
    return tx.transaction.create({ data });
  });
}

export type UpdateOptions = {
  /**
   * Legacy multi-row income splits: ids of sibling rows of the same kind that
   * this edit replaces. They are deleted in the same database transaction.
   */
  absorbLegacyIds?: string[];
};

export async function updateTransaction(
  id: string,
  input: TransactionInput,
  options: UpdateOptions = {},
  deps?: Partial<TransactionDeps>
): Promise<TransactionResult> {
  return run(deps, 'update transaction', async (tx) => {
    const existing = await tx.transaction.findUnique({ where: { id } });
    if (!existing) fail('Transaction not found');

    let parsed = parseInput(input);

    // Card / debt payments are listed on the Expenses page, so the expense
    // form can edit them. Keep them transfers: same destination account,
    // category and tags.
    if (parsed.kind === 'EXPENSE' && isPaymentTransfer(existing) && existing.toAccountId) {
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

    const data =
      parsed.kind === 'TRANSFER'
        ? await buildTransfer(tx, parsed, existing)
        : await buildIncomeOrExpense(tx, parsed, existing);

    const siblings = (options.absorbLegacyIds ?? []).filter((s) => s !== id);
    const siblingWhere: Prisma.TransactionWhereInput[] = [];
    if (siblings.length > 0) siblingWhere.push({ id: { in: siblings } });
    if (existing.splitGroupId) siblingWhere.push({ splitGroupId: existing.splitGroupId });
    if (siblingWhere.length > 0) {
      await tx.transaction.deleteMany({
        where: { OR: siblingWhere, kind: existing.kind, id: { not: id } },
      });
    }

    return tx.transaction.update({ where: { id }, data });
  });
}

export type DeleteOptions = {
  /** Legacy multi-row income splits: sibling rows to delete with this one. */
  legacyMemberIds?: string[];
};

export async function deleteTransaction(
  id: string,
  options: DeleteOptions = {},
  deps?: Partial<TransactionDeps>
): Promise<TransactionResult<{ deleted: number }>> {
  return run(deps, 'delete transaction', async (tx) => {
    const existing = await tx.transaction.findUnique({ where: { id } });
    if (!existing) fail('Transaction not found');

    const ids = new Set([id, ...(options.legacyMemberIds ?? [])]);
    const or: Prisma.TransactionWhereInput[] = [{ id: { in: [...ids] } }];
    if (existing.splitGroupId) or.push({ splitGroupId: existing.splitGroupId });

    const { count } = await tx.transaction.deleteMany({
      where: { OR: or, kind: existing.kind },
    });
    return { deleted: count };
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
  return count;
}

// ==================== READ HELPERS ====================

/**
 * How an expense's amount is spread over categories. A split expense has no
 * categoryId of its own; its split items carry the categories.
 */
export function expenseCategoryAllocations(t: {
  amount: number;
  categoryId: string | null;
  splitItems?: { categoryId: string; amount: number }[] | null;
}): { categoryId: string; amount: number }[] {
  const items = (t.splitItems || []).filter((s) => s.categoryId);
  if (items.length > 0) return items.map((s) => ({ categoryId: s.categoryId, amount: s.amount }));
  return t.categoryId ? [{ categoryId: t.categoryId, amount: t.amount }] : [];
}
