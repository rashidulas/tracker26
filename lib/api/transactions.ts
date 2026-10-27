import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { assertAccountsExist } from './accounts';
import { assertCategory, resolveSubcategoryId } from './categories';
import {
  toTransactionDTO,
  transactionInclude,
  type TransactionDTO,
} from './dto';
import {
  ApiError,
  dateString,
  monthString,
  notFound,
  objectId,
  optionalId,
  optionalString,
  positiveAmount,
  requiredId,
  tagsSchema,
} from './http';

// ---------------------------------------------------------------------------
// Date helpers (all UTC — transaction dates are stored as UTC midnight)
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

/** `[start, end)` of a `YYYY-MM` month in UTC. */
export function utcMonthRange(month: string): { gte: Date; lt: Date } {
  const [y, m] = month.split('-').map(Number);
  return { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) };
}

export function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

// ---------------------------------------------------------------------------
// List filters
// ---------------------------------------------------------------------------

const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

export const listQuerySchema = z.object({
  month: z.preprocess(emptyToUndefined, monthString.optional()),
  startDate: z.preprocess(emptyToUndefined, dateString.optional()),
  endDate: z.preprocess(emptyToUndefined, dateString.optional()),
  categoryId: z.preprocess(emptyToUndefined, objectId('Category').optional()),
  search: z.preprocess(emptyToUndefined, z.string().trim().optional()),
});

export type ListQuery = z.output<typeof listQuerySchema>;

/** Expenses list rule shared with the web: EXPENSE, or TRANSFER tagged "payment". */
export const expenseWhere: Prisma.TransactionWhereInput = {
  OR: [{ kind: 'EXPENSE' }, { kind: 'TRANSFER', tags: { has: 'payment' } }],
};

function filterConditions(q: ListQuery): Prisma.TransactionWhereInput[] {
  const and: Prisma.TransactionWhereInput[] = [];
  if (q.month) and.push({ date: utcMonthRange(q.month) });
  if (q.startDate) and.push({ date: { gte: new Date(q.startDate) } });
  // Inclusive end date: everything before the start of the following day.
  if (q.endDate) and.push({ date: { lt: new Date(new Date(q.endDate).getTime() + DAY_MS) } });
  if (q.categoryId) and.push({ categoryId: q.categoryId });
  if (q.search) {
    and.push({
      OR: [
        { merchantOrSource: { contains: q.search, mode: 'insensitive' } },
        { notes: { contains: q.search, mode: 'insensitive' } },
      ],
    });
  }
  return and;
}

export async function listTransactions(
  base: Prisma.TransactionWhereInput,
  q: ListQuery = {}
): Promise<TransactionDTO[]> {
  const rows = await prisma.transaction.findMany({
    where: { AND: [base, ...filterConditions(q)] },
    include: transactionInclude,
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
  });
  return rows.map(toTransactionDTO);
}

export async function listExpenseMonths(): Promise<string[]> {
  const rows = await prisma.transaction.findMany({ where: expenseWhere, select: { date: true } });
  return [...new Set(rows.map((r) => monthKey(r.date)))].sort((a, b) => b.localeCompare(a));
}

export async function getTransactionDTO(id: string): Promise<TransactionDTO> {
  const row = await prisma.transaction.findUnique({ where: { id }, include: transactionInclude });
  if (!row) notFound('Transaction');
  return toTransactionDTO(row);
}

async function findTransaction(id: string, what: string) {
  const row = await prisma.transaction.findUnique({ where: { id } });
  if (!row) notFound(what);
  return row;
}

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

export const expenseBodySchema = z.object({
  date: dateString,
  amount: positiveAmount(),
  categoryId: requiredId('Category'),
  subcategoryId: optionalId('Subcategory'),
  accountId: optionalId('Account'),
  merchantOrSource: optionalString(),
  notes: optionalString(),
  tags: tagsSchema,
});

type ExpenseBody = z.output<typeof expenseBodySchema>;

async function expenseData(body: ExpenseBody) {
  await assertCategory(body.categoryId);
  const subcategoryId = await resolveSubcategoryId(body.categoryId, body.subcategoryId);
  await assertAccountsExist([body.accountId]);
  return {
    date: new Date(body.date),
    amount: body.amount,
    kind: 'EXPENSE' as const,
    categoryId: body.categoryId,
    subcategoryId,
    accountId: body.accountId,
    merchantOrSource: body.merchantOrSource,
    notes: body.notes,
    tags: body.tags,
  };
}

export async function createExpense(body: ExpenseBody): Promise<TransactionDTO> {
  const row = await prisma.transaction.create({
    data: await expenseData(body),
    include: transactionInclude,
  });
  return toTransactionDTO(row);
}

export async function updateExpense(id: string, body: ExpenseBody): Promise<TransactionDTO> {
  const existing = await findTransaction(id, 'Expense');
  if (existing.kind === 'TRANSFER') {
    // Editing a payment transfer as an expense would turn it into an EXPENSE
    // that still carries toAccountId and corrupt both account balances.
    throw new ApiError('This is a payment transfer. Edit it from Transfers instead.', 400);
  }
  if (existing.kind !== 'EXPENSE') notFound('Expense');

  const row = await prisma.transaction.update({
    where: { id },
    data: await expenseData(body),
    include: transactionInclude,
  });
  return toTransactionDTO(row);
}

// ---------------------------------------------------------------------------
// Payments (TRANSFERs created from the expense form)
// ---------------------------------------------------------------------------

export const paymentBodySchema = z
  .object({
    mode: z.enum(['PAYMENT', 'DEBT_PAYMENT']),
    amount: positiveAmount(),
    date: dateString,
    fromAccountId: requiredId('From account'),
    toAccountId: requiredId('To account'),
    notes: optionalString(),
  })
  .refine((v) => v.fromAccountId !== v.toAccountId, 'From and To accounts cannot be the same');

const PAYMENT_MODES = {
  PAYMENT: {
    category: { name: 'Payment', color: '#3b82f6', icon: '💸' },
    tag: 'payment',
    merchant: 'Payment',
    defaultNotes: 'Account payment transfer',
  },
  DEBT_PAYMENT: {
    category: { name: 'Debt Payment', color: '#8b5cf6', icon: '💳' },
    tag: 'debt-payment',
    merchant: 'Debt Payment',
    defaultNotes: 'Debt payment transfer',
  },
} as const;

/** Mirrors `createPaymentTransfer` / `createDebtPaymentTransfer` in app/expenses/actions.ts. */
export async function createPayment(body: z.output<typeof paymentBodySchema>): Promise<TransactionDTO> {
  const mode = PAYMENT_MODES[body.mode];
  await assertAccountsExist([body.fromAccountId, body.toAccountId]);

  let category = await prisma.category.findFirst({
    where: { name: mode.category.name, type: 'EXPENSE' },
  });
  if (!category) {
    category = await prisma.category.create({
      data: { ...mode.category, type: 'EXPENSE' },
    });
  }

  const row = await prisma.transaction.create({
    data: {
      date: new Date(body.date),
      amount: body.amount,
      kind: 'TRANSFER',
      categoryId: category.id,
      accountId: body.fromAccountId,
      toAccountId: body.toAccountId,
      merchantOrSource: mode.merchant,
      notes: body.notes || mode.defaultNotes,
      tags: [mode.tag],
    },
    include: transactionInclude,
  });
  return toTransactionDTO(row);
}

// ---------------------------------------------------------------------------
// Income
// ---------------------------------------------------------------------------

const cents = (n: number) => Math.round(n * 100);

export const incomeBodySchema = z
  .object({
    date: dateString,
    amount: positiveAmount(),
    categoryId: requiredId('Category'),
    subcategoryId: optionalId('Subcategory'),
    accountSplits: z
      .array(
        z.object({
          accountId: requiredId('Account'),
          amount: positiveAmount('Split amount'),
        }),
        { required_error: 'At least one account is required' }
      )
      .min(1, 'At least one account is required'),
    merchantOrSource: optionalString(),
    notes: optionalString(),
    tags: tagsSchema,
  })
  // Same rules as web `parseAccountSplits`.
  .superRefine((v, ctx) => {
    const ids = v.accountSplits.map((s) => s.accountId);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: 'custom', message: 'Each split must use a different account' });
      return;
    }
    const total = v.accountSplits.reduce((sum, s) => sum + s.amount, 0);
    if (cents(total) !== cents(v.amount)) {
      ctx.addIssue({
        code: 'custom',
        message: `Account amounts ($${total.toFixed(2)}) must equal total ($${v.amount.toFixed(2)})`,
      });
    }
  });

type IncomeBody = z.output<typeof incomeBodySchema>;

async function incomeData(body: IncomeBody) {
  await assertCategory(body.categoryId);
  const subcategoryId = await resolveSubcategoryId(body.categoryId, body.subcategoryId);
  await assertAccountsExist(body.accountSplits.map((s) => s.accountId));

  const multi = body.accountSplits.length > 1;
  return {
    date: new Date(body.date),
    amount: body.amount,
    kind: 'INCOME' as const,
    categoryId: body.categoryId,
    subcategoryId,
    accountId: body.accountSplits[0].accountId,
    merchantOrSource: body.merchantOrSource,
    notes: body.notes,
    tags: body.tags,
    accountSplits: multi ? body.accountSplits : [],
  };
}

export async function createIncome(body: IncomeBody): Promise<TransactionDTO> {
  const row = await prisma.transaction.create({
    data: { ...(await incomeData(body)), splitGroupId: null },
    include: transactionInclude,
  });
  return toTransactionDTO(row);
}

/**
 * Updates just this row. Unlike the web (which consolidates legacy
 * `splitGroupId` rows on read and then deletes siblings on edit), the API
 * returns legacy sibling rows individually, so deleting siblings here would
 * silently drop money the user never saw in the edit form. `splitGroupId` is
 * left untouched so the web's consolidation still groups them later.
 */
export async function updateIncome(id: string, body: IncomeBody): Promise<TransactionDTO> {
  const existing = await findTransaction(id, 'Income');
  if (existing.kind !== 'INCOME') notFound('Income');

  const row = await prisma.transaction.update({
    where: { id },
    data: await incomeData(body),
    include: transactionInclude,
  });
  return toTransactionDTO(row);
}

// ---------------------------------------------------------------------------
// Transfers
// ---------------------------------------------------------------------------

export const transferBodySchema = z
  .object({
    date: dateString,
    amount: positiveAmount(),
    fromAccountId: requiredId('From account'),
    toAccountId: requiredId('To account'),
    notes: optionalString(),
  })
  .refine((v) => v.fromAccountId !== v.toAccountId, 'Cannot transfer to the same account');

type TransferBody = z.output<typeof transferBodySchema>;

export async function createTransfer(body: TransferBody): Promise<TransactionDTO> {
  await assertAccountsExist([body.fromAccountId, body.toAccountId]);
  const row = await prisma.transaction.create({
    data: {
      date: new Date(body.date),
      amount: body.amount,
      kind: 'TRANSFER',
      accountId: body.fromAccountId,
      toAccountId: body.toAccountId,
      notes: body.notes,
      tags: [],
    },
    include: transactionInclude,
  });
  return toTransactionDTO(row);
}

/** Preserves existing `categoryId`, `tags` and `merchantOrSource` (payment transfers keep their label). */
export async function updateTransfer(id: string, body: TransferBody): Promise<TransactionDTO> {
  const existing = await findTransaction(id, 'Transfer');
  if (existing.kind !== 'TRANSFER') notFound('Transfer');
  await assertAccountsExist([body.fromAccountId, body.toAccountId]);

  const row = await prisma.transaction.update({
    where: { id },
    data: {
      date: new Date(body.date),
      amount: body.amount,
      accountId: body.fromAccountId,
      toAccountId: body.toAccountId,
      notes: body.notes,
    },
    include: transactionInclude,
  });
  return toTransactionDTO(row);
}

export async function deleteTransaction(id: string) {
  await findTransaction(id, 'Transaction');
  await prisma.transaction.delete({ where: { id } });
}
