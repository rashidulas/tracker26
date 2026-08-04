'use server';

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

const transactionSchema = z.object({
  date: z.string().min(1, 'Date is required'),
  amount: z.number().positive('Amount must be positive'),
  categoryId: z.string().min(1, 'Category is required'),
  accountId: z.string().optional(),
  merchantOrSource: z.string().optional(),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export async function getExpenses(filters?: {
  startDate?: string;
  endDate?: string;
  categoryId?: string;
  minAmount?: number;
  maxAmount?: number;
  search?: string;
}) {
  try {
    const where: any = { kind: 'EXPENSE' };

    if (filters?.startDate || filters?.endDate) {
      where.date = {};
      if (filters.startDate) where.date.gte = new Date(filters.startDate);
      if (filters.endDate) where.date.lte = new Date(filters.endDate);
    }

    if (filters?.categoryId) {
      where.categoryId = filters.categoryId;
    }

    if (filters?.minAmount !== undefined || filters?.maxAmount !== undefined) {
      where.amount = {};
      if (filters.minAmount !== undefined) where.amount.gte = filters.minAmount;
      if (filters.maxAmount !== undefined) where.amount.lte = filters.maxAmount;
    }

    if (filters?.search) {
      where.OR = [
        { merchantOrSource: { contains: filters.search, mode: 'insensitive' } },
        { notes: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const expenses = await prisma.transaction.findMany({
      where,
      include: {
        category: true,
        account: true,
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

export async function createExpense(formData: FormData) {
  try {
    const tags = formData.get('tags') as string;
    const rawAccountId = formData.get('accountId') as string;
    const data = {
      date: formData.get('date') as string,
      amount: parseFloat(formData.get('amount') as string),
      categoryId: formData.get('categoryId') as string,
      accountId: rawAccountId || undefined,
      merchantOrSource: formData.get('merchantOrSource') as string,
      notes: formData.get('notes') as string,
      tags: tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [],
    };

    const validated = transactionSchema.parse(data);

    await prisma.transaction.create({
      data: {
        date: new Date(validated.date),
        amount: validated.amount,
        kind: 'EXPENSE',
        categoryId: validated.categoryId,
        accountId: validated.accountId || null,
        merchantOrSource: validated.merchantOrSource,
        notes: validated.notes,
        tags: validated.tags || [],
      },
    });

    revalidatePath('/expenses');
    return { success: true };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error: error.errors[0].message };
    }
    console.error('Error creating expense:', error);
    return { success: false, error: 'Failed to create expense' };
  }
}

export async function updateExpense(id: string, formData: FormData) {
  try {
    const tags = formData.get('tags') as string;
    const rawAccountId = formData.get('accountId') as string;
    const data = {
      date: formData.get('date') as string,
      amount: parseFloat(formData.get('amount') as string),
      categoryId: formData.get('categoryId') as string,
      accountId: rawAccountId || undefined,
      merchantOrSource: formData.get('merchantOrSource') as string,
      notes: formData.get('notes') as string,
      tags: tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [],
    };

    const validated = transactionSchema.parse(data);

    await prisma.transaction.update({
      where: { id },
      data: {
        date: new Date(validated.date),
        amount: validated.amount,
        kind: 'EXPENSE',
        categoryId: validated.categoryId,
        accountId: validated.accountId || null,
        merchantOrSource: validated.merchantOrSource,
        notes: validated.notes,
        tags: validated.tags || [],
      },
    });

    revalidatePath('/expenses');
    return { success: true };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error: error.errors[0].message };
    }
    console.error('Error updating expense:', error);
    return { success: false, error: 'Failed to update expense' };
  }
}

export async function deleteExpense(id: string) {
  try {
    await prisma.transaction.delete({
      where: { id },
    });

    revalidatePath('/expenses');
    return { success: true };
  } catch (error) {
    console.error('Error deleting expense:', error);
    return { success: false, error: 'Failed to delete expense' };
  }
}

export async function getCategoriesForSelect() {
  try {
    const categories = await prisma.category.findMany({
      where: {
        type: 'EXPENSE',
      },
      orderBy: { name: 'asc' },
    });
    return { success: true, data: categories };
  } catch (error) {
    return { success: false, error: 'Failed to fetch categories' };
  }
}

export async function getAccountsForSelect() {
  try {
    const accounts = await prisma.account.findMany({
      orderBy: { name: 'asc' },
    });
    return { success: true, data: accounts };
  } catch (error) {
    return { success: false, error: 'Failed to fetch accounts' };
  }
}

/**
 * Payment Transfer:
 *  - Deducts `amount` from `fromAccountId`
 *  - Credits `amount` to `toAccountId`
 *  Creates a single TRANSFER transaction tagged as a payment between accounts.
 */
export async function createPaymentTransfer(formData: FormData) {
  try {
    const amount = parseFloat(formData.get('amount') as string);
    const fromAccountId = formData.get('fromAccountId') as string;
    const toAccountId = formData.get('toAccountId') as string;
    const date = formData.get('date') as string;
    const notes = formData.get('notes') as string;

    if (!amount || amount <= 0) return { success: false, error: 'Amount must be positive' };
    if (!fromAccountId) return { success: false, error: 'Please select the account to pay from' };
    if (!toAccountId) return { success: false, error: 'Please select the account to pay to' };
    if (fromAccountId === toAccountId) return { success: false, error: 'From and To accounts cannot be the same' };

    // Find or create "Payment" category for labelling
    let paymentCategory = await prisma.category.findFirst({
      where: { name: 'Payment', type: 'EXPENSE' },
    });
    if (!paymentCategory) {
      paymentCategory = await prisma.category.create({
        data: { name: 'Payment', type: 'EXPENSE', color: '#3b82f6', icon: '💸' },
      });
    }

    await prisma.transaction.create({
      data: {
        date: new Date(date),
        amount,
        kind: 'TRANSFER',
        categoryId: paymentCategory.id,
        accountId: fromAccountId,
        toAccountId: toAccountId,
        merchantOrSource: 'Payment',
        notes: notes || 'Account payment transfer',
        tags: ['payment'],
      },
    });

    revalidatePath('/expenses');
    revalidatePath('/accounts');
    revalidatePath('/dashboard');
    return { success: true };
  } catch (error) {
    console.error('Error creating payment transfer:', error);
    return { success: false, error: 'Failed to record payment' };
  }
}

/**
 * Debt Payment Transfer:
 *  - Deducts `amount` from `fromAccountId` (e.g. Checking)
 *  - Credits `amount` to `toAccountId` (e.g. AMEX credit card account)
 *  Creates a single TRANSFER transaction that links both accounts.
 */
export async function createDebtPaymentTransfer(formData: FormData) {
  try {
    const amount = parseFloat(formData.get('amount') as string);
    const fromAccountId = formData.get('fromAccountId') as string;
    const toAccountId = formData.get('toAccountId') as string;
    const date = formData.get('date') as string;
    const notes = formData.get('notes') as string;

    if (!amount || amount <= 0) return { success: false, error: 'Amount must be positive' };
    if (!fromAccountId) return { success: false, error: 'Please select the account to pay from' };
    if (!toAccountId) return { success: false, error: 'Please select the credit card / debt account' };
    if (fromAccountId === toAccountId) return { success: false, error: 'From and To accounts cannot be the same' };

    // Find or create "Debt Payment" category for labelling
    let debtCategory = await prisma.category.findFirst({
      where: { name: 'Debt Payment', type: 'EXPENSE' },
    });
    if (!debtCategory) {
      debtCategory = await prisma.category.create({
        data: { name: 'Debt Payment', type: 'EXPENSE', color: '#8b5cf6', icon: '💳' },
      });
    }

    // Create a TRANSFER transaction: money moves from checking → credit card
    await prisma.transaction.create({
      data: {
        date: new Date(date),
        amount,
        kind: 'TRANSFER',
        categoryId: debtCategory.id,
        accountId: fromAccountId,      // money leaves here
        toAccountId: toAccountId,      // money arrives here (credit card)
        merchantOrSource: 'Debt Payment',
        notes: notes || 'Debt payment transfer',
        tags: ['debt-payment'],
      },
    });

    revalidatePath('/expenses');
    revalidatePath('/accounts');
    revalidatePath('/dashboard');
    return { success: true };
  } catch (error) {
    console.error('Error creating debt payment transfer:', error);
    return { success: false, error: 'Failed to record debt payment' };
  }
}

