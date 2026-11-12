'use server';

import { prisma } from '@/lib/prisma';
import {
  createTransaction,
  deleteTransaction,
  updateTransaction,
  type ExpenseInput,
  type TransferPurpose,
} from '@/lib/transactions';

export async function getExpenses(filters?: {
  startDate?: string;
  endDate?: string;
  categoryId?: string;
  subcategoryId?: string;
  minAmount?: number;
  maxAmount?: number;
  search?: string;
}) {
  try {
    const baseWhere: any = {
      OR: [
        { kind: 'EXPENSE' },
        { kind: 'TRANSFER', tags: { has: 'payment' } },
      ],
    };

    if (filters?.startDate || filters?.endDate) {
      baseWhere.date = {};
      if (filters.startDate) baseWhere.date.gte = new Date(filters.startDate);
      if (filters.endDate) baseWhere.date.lte = new Date(filters.endDate);
    }

    if (filters?.categoryId) {
      baseWhere.categoryId = filters.categoryId;
    }

    if (filters?.subcategoryId) {
      baseWhere.subcategoryId = filters.subcategoryId;
    }

    if (filters?.minAmount !== undefined || filters?.maxAmount !== undefined) {
      baseWhere.amount = {};
      if (filters.minAmount !== undefined) baseWhere.amount.gte = filters.minAmount;
      if (filters.maxAmount !== undefined) baseWhere.amount.lte = filters.maxAmount;
    }

    if (filters?.search) {
      baseWhere.AND = [
        {
          OR: [
            { merchantOrSource: { contains: filters.search, mode: 'insensitive' } },
            { notes: { contains: filters.search, mode: 'insensitive' } },
          ],
        },
      ];
    }

    const expenses = await prisma.transaction.findMany({
      where: baseWhere,
      include: {
        category: true,
        subcategory: true,
        account: true,
        toAccount: true,
      },
      orderBy: { date: 'desc' },
    });

    return { success: true, data: expenses };
  } catch (error) {
    console.error('Error fetching expenses:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: `Failed to fetch expenses: ${errorMessage}` };
  }
}

function expenseFromForm(formData: FormData): ExpenseInput {
  const tags = (formData.get('tags') as string) || '';
  return {
    kind: 'EXPENSE',
    date: (formData.get('date') as string) || '',
    amount: parseFloat(formData.get('amount') as string),
    categoryId: (formData.get('categoryId') as string) || null,
    subcategoryId: (formData.get('subcategoryId') as string) || null,
    accountId: (formData.get('accountId') as string) || null,
    merchantOrSource: (formData.get('merchantOrSource') as string) ?? null,
    notes: (formData.get('notes') as string) ?? null,
    tags: tags.split(','),
  };
}

const rowInclude = {
  category: true,
  subcategory: true,
  account: true,
  toAccount: true,
} as const;

/** Return the saved row with relations so the UI can update without a reload. */
async function withRow(
  result: { success: true; data: { id: string } } | { success: false; error: string }
) {
  if (!result.success) return { success: false as const, error: result.error };
  const row = await prisma.transaction.findUnique({
    where: { id: result.data.id },
    include: rowInclude,
  });
  return { success: true as const, data: row ?? undefined };
}

export async function createExpense(formData: FormData) {
  return withRow(await createTransaction(expenseFromForm(formData)));
}

export async function updateExpense(id: string, formData: FormData) {
  // A card payment opened from the Expenses list stays a transfer (see lib/transactions).
  return withRow(await updateTransaction(id, expenseFromForm(formData)));
}

export async function deleteExpense(id: string) {
  const result = await deleteTransaction(id);
  return result.success ? { success: true as const } : { success: false as const, error: result.error };
}

async function createPurposeTransfer(formData: FormData, purpose: TransferPurpose) {
  const fromAccountId = (formData.get('fromAccountId') as string) || '';
  const toAccountId = (formData.get('toAccountId') as string) || '';
  if (!fromAccountId) return { success: false as const, error: 'Please select the account to pay from' };
  if (!toAccountId) {
    return {
      success: false as const,
      error:
        purpose === 'debt-payment'
          ? 'Please select the credit card / debt account'
          : 'Please select the account to pay to',
    };
  }

  return withRow(
    await createTransaction({
      kind: 'TRANSFER',
      purpose,
      date: (formData.get('date') as string) || '',
      amount: parseFloat(formData.get('amount') as string),
      accountId: fromAccountId,
      toAccountId,
      notes: (formData.get('notes') as string) || null,
    })
  );
}

/** Card payment: one TRANSFER from `fromAccountId` to `toAccountId`, tagged "payment". */
export async function createPaymentTransfer(formData: FormData) {
  return createPurposeTransfer(formData, 'payment');
}

/** Debt payment: one TRANSFER into a credit card / loan account, tagged "debt-payment". */
export async function createDebtPaymentTransfer(formData: FormData) {
  return createPurposeTransfer(formData, 'debt-payment');
}

/**
 * Everything the global quick-add form needs: categories, accounts, and past
 * merchants (most recent first) with the category / account used last time for
 * each, plus the account last used per category.
 */
export async function getQuickAddData() {
  try {
    const [categories, accounts, recent] = await Promise.all([
      prisma.category.findMany({
        where: { type: 'EXPENSE' },
        select: {
          id: true,
          name: true,
          icon: true,
          color: true,
          subcategories: { orderBy: { name: 'asc' }, select: { id: true, name: true } },
        },
        orderBy: { name: 'asc' },
      }),
      prisma.account.findMany({
        select: { id: true, name: true, type: true },
        orderBy: { name: 'asc' },
      }),
      prisma.transaction.findMany({
        where: { kind: 'EXPENSE' },
        select: {
          merchantOrSource: true,
          categoryId: true,
          subcategoryId: true,
          accountId: true,
        },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        take: 500,
      }),
    ]);

    const merchants: Array<{
      name: string;
      categoryId: string | null;
      subcategoryId: string | null;
      accountId: string | null;
    }> = [];
    const seen = new Set<string>();
    const accountByCategory: Record<string, string> = {};

    for (const t of recent) {
      if (t.categoryId && t.accountId && !accountByCategory[t.categoryId]) {
        accountByCategory[t.categoryId] = t.accountId;
      }
      const name = t.merchantOrSource?.trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merchants.push({
        name,
        categoryId: t.categoryId,
        subcategoryId: t.subcategoryId,
        accountId: t.accountId,
      });
    }

    return {
      success: true as const,
      data: {
        categories,
        accounts,
        merchants: merchants.slice(0, 200),
        accountByCategory,
        lastAccountId: recent.find((t) => t.accountId)?.accountId ?? null,
      },
    };
  } catch (error) {
    console.error('Error loading quick-add data:', error);
    return { success: false as const, error: 'Failed to load expense form data' };
  }
}
