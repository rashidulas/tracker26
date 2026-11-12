'use server';

import { prisma } from '@/lib/prisma';
import { transactionFilterSchema, type TransactionFilter } from '@/lib/validations';
import {
  createTransaction as createTx,
  deleteTransaction as deleteTx,
  updateTransaction as updateTx,
  deleteTransactions as deleteManyTx,
  duplicateTransactions as duplicateTx,
  recategorizeTransactions as recategorizeTx,
  type TransactionInput,
} from '@/lib/transactions';
import { dayFilter, toDayString } from '@/lib/dates';

// ==================== GET TRANSACTIONS ====================
export async function getTransactions(filter?: TransactionFilter) {
  try {
    const where: any = {};

    if (filter) {
      const validatedFilter = transactionFilterSchema.parse(filter);

      const dateRange = dayFilter(validatedFilter.startDate, validatedFilter.endDate);
      if (dateRange) where.date = dateRange;

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

// ==================== WRITES (all via lib/transactions) ====================
export async function createTransaction(data: TransactionInput) {
  return createTx(data);
}

export async function updateTransaction(id: string, data: TransactionInput) {
  return updateTx(id, data);
}

export async function deleteTransaction(id: string) {
  return deleteTx(id);
}

// ==================== BULK / LIST ACTIONS ====================
/** Copies transactions onto `day` (YYYY-MM-DD) and returns the copies. */
export async function duplicateTransactions(ids: string[], day: string) {
  return duplicateTx(ids, day);
}

export async function deleteTransactions(ids: string[]) {
  const result = await deleteManyTx(ids);
  return result.success
    ? { success: true as const, count: result.data.deleted }
    : result;
}

export async function recategorizeTransactions(ids: string[], categoryId: string) {
  const result = await recategorizeTx(ids, categoryId);
  return result.success
    ? { success: true as const, count: result.data.updated }
    : result;
}

// ==================== EXPORT TO CSV ====================
export async function exportTransactionsToCSV(filter?: TransactionFilter) {
  try {
    const transactions = await getTransactions(filter);

    const csvData = transactions.map(tx => ({
      Date: toDayString(tx.date),
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
