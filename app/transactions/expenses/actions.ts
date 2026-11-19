'use server';

import { prisma } from '@/lib/prisma';
import {
  createTransaction,
  deleteTransaction,
  updateTransaction,
  type ExpenseInput,
  type FriendSplit,
  type TransferPurpose,
} from '@/lib/transactions';
import { dayFilter } from '@/lib/dates';
import { getMerchantMemory } from '@/app/settings/merchants/actions';

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
    // Only real spending. Card payments and debt payments are transfers
    // (lib/budgets.ts explains why) and are listed under Transfers.
    const baseWhere: any = { kind: 'EXPENSE' };

    const dateRange = dayFilter(filters?.startDate, filters?.endDate);
    if (dateRange) baseWhere.date = dateRange;

    if (filters?.categoryId) {
      // Split expenses keep their categories in splitItems.
      baseWhere.OR = [
        { categoryId: filters.categoryId },
        { splitItems: { some: { categoryId: filters.categoryId } } },
      ];
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
      include: rowInclude,
      orderBy: { date: 'desc' },
    });

    return { success: true, data: expenses };
  } catch (error) {
    console.error('Error fetching expenses:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: `Failed to fetch expenses: ${errorMessage}` };
  }
}

/**
 * "friendSplits" is JSON: [{ friendId, amount }]. Absent = leave the current
 * split alone (forms that don't show it); "[]" = not split.
 */
function friendSplitsFromForm(formData: FormData): FriendSplit[] | undefined {
  const raw = formData.get('friendSplits');
  if (typeof raw !== 'string') return undefined;
  try {
    const parsed = JSON.parse(raw || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.map((s) => ({ friendId: String(s?.friendId ?? ''), amount: Number(s?.amount) }));
  } catch {
    return [];
  }
}

/** "splitItems" is JSON: [{ categoryId, amount, notes? }] (receipts split by category). */
function splitItemsFromForm(formData: FormData): ExpenseInput['splitItems'] {
  const raw = formData.get('splitItems');
  if (typeof raw !== 'string' || !raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return undefined;
    return parsed.map((s) => ({
      categoryId: String(s?.categoryId ?? ''),
      amount: Number(s?.amount),
      notes: typeof s?.notes === 'string' ? s.notes.slice(0, 200) : null,
    }));
  } catch {
    return undefined;
  }
}

function expenseFromForm(formData: FormData): ExpenseInput {
  const tags = (formData.get('tags') as string) || '';
  // How it was entered, when not typed into the form (lib/transactions).
  const source = formData.get('source');
  return {
    friendSplits: friendSplitsFromForm(formData),
    splitItems: splitItemsFromForm(formData),
    source: source === 'voice' || source === 'receipt' ? source : undefined,
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
  // A split expense's IOUs: who owes you what for it.
  friendEntries: {
    select: {
      id: true,
      amount: true,
      friend: { select: { id: true, name: true, color: true } },
    },
  },
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
    const [categories, accounts, recent, friends, merchants] = await Promise.all([
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
          categoryId: true,
          accountId: true,
        },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        take: 500,
      }),
      prisma.friend.findMany({
        select: { id: true, name: true, color: true },
        orderBy: { name: 'asc' },
      }),
      // Defaults the user set, else what was used last time (lib/merchants.ts).
      getMerchantMemory('EXPENSE'),
    ]);

    const accountByCategory: Record<string, string> = {};
    for (const t of recent) {
      if (t.categoryId && t.accountId && !accountByCategory[t.categoryId]) {
        accountByCategory[t.categoryId] = t.accountId;
      }
    }

    return {
      success: true as const,
      data: {
        categories,
        accounts,
        friends,
        merchants,
        accountByCategory,
        lastAccountId: recent.find((t) => t.accountId)?.accountId ?? null,
      },
    };
  } catch (error) {
    console.error('Error loading quick-add data:', error);
    return { success: false as const, error: 'Failed to load expense form data' };
  }
}
