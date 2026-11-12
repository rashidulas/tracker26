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

function done(result: { success: boolean; error?: string }) {
  return result.success ? { success: true } : { success: false, error: result.error };
}

export async function createExpense(formData: FormData) {
  return done(await createTransaction(expenseFromForm(formData)));
}

export async function updateExpense(id: string, formData: FormData) {
  // A card payment opened from the Expenses list stays a transfer (see lib/transactions).
  return done(await updateTransaction(id, expenseFromForm(formData)));
}

export async function deleteExpense(id: string) {
  return done(await deleteTransaction(id));
}

async function createPurposeTransfer(formData: FormData, purpose: TransferPurpose) {
  const fromAccountId = (formData.get('fromAccountId') as string) || '';
  const toAccountId = (formData.get('toAccountId') as string) || '';
  if (!fromAccountId) return { success: false, error: 'Please select the account to pay from' };
  if (!toAccountId) {
    return {
      success: false,
      error:
        purpose === 'debt-payment'
          ? 'Please select the credit card / debt account'
          : 'Please select the account to pay to',
    };
  }

  return done(
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
