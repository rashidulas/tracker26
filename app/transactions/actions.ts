'use server';

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import {
  transactionSchema,
  type TransactionInput,
  transactionFilterSchema,
  type TransactionFilter,
} from '@/lib/validations';

// ==================== GET TRANSACTIONS ====================
export async function getTransactions(filter?: TransactionFilter) {
  try {
    const where: any = {};

    if (filter) {
      const validatedFilter = transactionFilterSchema.parse(filter);

      if (validatedFilter.startDate || validatedFilter.endDate) {
        where.date = {};
        if (validatedFilter.startDate) {
          where.date.gte = validatedFilter.startDate;
        }
        if (validatedFilter.endDate) {
          where.date.lte = validatedFilter.endDate;
        }
      }

      if (validatedFilter.categoryId) {
        where.categoryId = validatedFilter.categoryId;
      }

      if (validatedFilter.accountId) {
        where.accountId = validatedFilter.accountId;
      }

      if (validatedFilter.kind) {
        where.kind = validatedFilter.kind;
      }

      if (validatedFilter.minAmount || validatedFilter.maxAmount) {
        where.amount = {};
        if (validatedFilter.minAmount) {
          where.amount.gte = validatedFilter.minAmount;
        }
        if (validatedFilter.maxAmount) {
          where.amount.lte = validatedFilter.maxAmount;
        }
      }

      if (validatedFilter.search) {
        where.OR = [
          { merchantOrSource: { contains: validatedFilter.search, mode: 'insensitive' } },
          { notes: { contains: validatedFilter.search, mode: 'insensitive' } },
          { tags: { has: validatedFilter.search } },
        ];
      }
    }

    const transactions = await prisma.transaction.findMany({
      where,
      include: {
        category: true,
        account: true,
        toAccount: true,
      },
      orderBy: { date: 'desc' },
    });

    return transactions;
  } catch (error) {
    console.error('Error fetching transactions:', error);
    throw new Error('Failed to fetch transactions');
  }
}

// ==================== CREATE TRANSACTION ====================
export async function createTransaction(data: TransactionInput) {
  try {
    const validated = transactionSchema.parse(data);

    // For transfers, create the transaction
    if (validated.kind === 'TRANSFER') {
      const transaction = await prisma.transaction.create({
        data: {
          date: validated.date,
          amount: validated.amount,
          kind: 'TRANSFER',
          accountId: validated.accountId,
          toAccountId: validated.toAccountId!,
          notes: validated.notes,
          tags: validated.tags,
        },
      });

      revalidatePath('/transfers');
      revalidatePath('/accounts');
      revalidatePath('/dashboard');
      return { success: true, data: transaction };
    }

    // For income/expense with splits
    if (validated.kind === 'EXPENSE' && validated.splitItems && validated.splitItems.length > 0) {
      // Validate split amounts sum to transaction amount
      const splitTotal = validated.splitItems.reduce((sum: number, item: any) => sum + item.amount, 0);
      if (Math.abs(splitTotal - validated.amount) > 0.01) {
        return { success: false, error: 'Split amounts must sum to transaction amount' };
      }

      const transaction = await prisma.transaction.create({
        data: {
          date: validated.date,
          amount: validated.amount,
          kind: validated.kind as 'EXPENSE',
          categoryId: null, // No single category for split
          accountId: validated.accountId,
          merchantOrSource: (validated as any).merchantOrSource,
          notes: validated.notes,
          tags: validated.tags,
          splitItems: validated.splitItems,
        },
      });

      revalidatePath('/expenses');
      revalidatePath('/accounts');
      revalidatePath('/dashboard');
      return { success: true, data: transaction };
    }

    // Regular income/expense
    const transaction = await prisma.transaction.create({
      data: {
        date: validated.date,
        amount: validated.amount,
        kind: validated.kind as 'INCOME' | 'EXPENSE',
        categoryId: (validated as any).categoryId,
        accountId: validated.accountId,
        merchantOrSource: (validated as any).merchantOrSource,
        notes: validated.notes,
        tags: validated.tags,
      },
    });

    revalidatePath(validated.kind === 'INCOME' ? '/income' : '/expenses');
    revalidatePath('/accounts');
    revalidatePath('/dashboard');
    return { success: true, data: transaction };
  } catch (error) {
    console.error('Error creating transaction:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to create transaction' };
  }
}

// ==================== UPDATE TRANSACTION ====================
export async function updateTransaction(id: string, data: TransactionInput) {
  try {
    const validated = transactionSchema.parse(data);

    if (validated.kind === 'TRANSFER') {
      const transaction = await prisma.transaction.update({
        where: { id },
        data: {
          date: validated.date,
          amount: validated.amount,
          kind: 'TRANSFER',
          categoryId: null,
          accountId: validated.accountId,
          toAccountId: validated.toAccountId!,
          notes: validated.notes,
          tags: validated.tags,
        },
      });

      revalidatePath('/transfers');
      revalidatePath('/accounts');
      revalidatePath('/dashboard');
      return { success: true, data: transaction };
    }

    if (validated.kind === 'EXPENSE' && validated.splitItems && validated.splitItems.length > 0) {
      const splitTotal = validated.splitItems.reduce((sum: number, item: any) => sum + item.amount, 0);
      if (Math.abs(splitTotal - validated.amount) > 0.01) {
        return { success: false, error: 'Split amounts must sum to transaction amount' };
      }

      const transaction = await prisma.transaction.update({
        where: { id },
        data: {
          date: validated.date,
          amount: validated.amount,
          kind: validated.kind as 'EXPENSE',
          categoryId: null,
          accountId: validated.accountId,
          merchantOrSource: (validated as any).merchantOrSource,
          notes: validated.notes,
          tags: validated.tags,
          splitItems: validated.splitItems,
        },
      });

      revalidatePath('/expenses');
      revalidatePath('/accounts');
      revalidatePath('/dashboard');
      return { success: true, data: transaction };
    }

    const transaction = await prisma.transaction.update({
      where: { id },
      data: {
        date: validated.date,
        amount: validated.amount,
        kind: validated.kind as 'INCOME' | 'EXPENSE',
        categoryId: (validated as any).categoryId,
        accountId: validated.accountId,
        merchantOrSource: (validated as any).merchantOrSource,
        notes: validated.notes,
        tags: validated.tags,
        splitItems: [], // Clear splits if any
      },
    });

    revalidatePath(validated.kind === 'INCOME' ? '/income' : '/expenses');
    revalidatePath('/accounts');
    revalidatePath('/dashboard');
    return { success: true, data: transaction };
  } catch (error) {
    console.error('Error updating transaction:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to update transaction' };
  }
}

// ==================== DELETE TRANSACTION ====================
export async function deleteTransaction(id: string) {
  try {
    await prisma.transaction.delete({
      where: { id },
    });

    revalidatePath('/expenses');
    revalidatePath('/income');
    revalidatePath('/transfers');
    revalidatePath('/accounts');
    revalidatePath('/dashboard');
    return { success: true };
  } catch (error) {
    console.error('Error deleting transaction:', error);
    return { success: false, error: 'Failed to delete transaction' };
  }
}

// ==================== EXPORT TO CSV ====================
export async function exportTransactionsToCSV(filter?: TransactionFilter) {
  try {
    const transactions = await getTransactions(filter);

    const csvData = transactions.map(tx => ({
      Date: tx.date.toISOString().split('T')[0],
      Type: tx.kind,
      Amount: tx.amount.toFixed(2),
      Category: tx.category?.name || (tx.kind === 'TRANSFER' ? 'Transfer' : 'Split'),
      Account: tx.account?.name || '',
      ToAccount: tx.toAccount?.name || '',
      Merchant: tx.merchantOrSource || '',
      Notes: tx.notes || '',
      Tags: tx.tags.join(', '),
    }));

    return { success: true, data: csvData };
  } catch (error) {
    console.error('Error exporting transactions:', error);
    return { success: false, error: 'Failed to export transactions' };
  }
}

// ==================== GET HELPERS ====================
export async function getCategoriesForSelect(type?: 'INCOME' | 'EXPENSE') {
  const where = type ? {
    type: type as 'INCOME' | 'EXPENSE',
  } : {};

  const categories = await prisma.category.findMany({
    where,
    orderBy: { name: 'asc' },
    select: { id: true, name: true, type: true },
  });

  return { success: true, data: categories };
}

export async function getAccountsForSelect() {
  const accounts = await prisma.account.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true, type: true },
  });

  return accounts;
}
