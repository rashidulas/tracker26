'use server';

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

const accountSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  type: z.enum(['CHECKING', 'SAVINGS', 'CASH', 'CREDIT_CARD', 'INVESTMENT']),
  institution: z.string().optional(),
  startingBalance: z.number(),
});

export async function getAccounts() {
  try {
    const accounts = await prisma.account.findMany({
      orderBy: { name: 'asc' },
      include: {
        transactions: {
          select: {
            amount: true,
            kind: true,
          },
        },
      },
    });

    // Calculate current balance for each account
    const accountsWithBalance = accounts.map((account) => {
      const transactionTotal = account.transactions.reduce((sum, transaction) => {
        if (transaction.kind === 'INCOME') {
          return sum + transaction.amount;
        } else if (transaction.kind === 'EXPENSE') {
          return sum - transaction.amount;
        }
        return sum;
      }, 0);

      return {
        ...account,
        currentBalance: account.startingBalance + transactionTotal,
        transactionCount: account.transactions.length,
      };
    });

    return { success: true, data: accountsWithBalance };
  } catch (error) {
    console.error('Error fetching accounts:', error);
    return { success: false, error: 'Failed to fetch accounts' };
  }
}

export async function createAccount(formData: FormData) {
  try {
    const data = {
      name: formData.get('name') as string,
      type: formData.get('type') as 'CHECKING' | 'SAVINGS' | 'CASH' | 'CREDIT_CARD' | 'INVESTMENT',
      institution: formData.get('institution') as string,
      startingBalance: parseFloat(formData.get('startingBalance') as string) || 0,
    };

    const validated = accountSchema.parse(data);

    await prisma.account.create({
      data: validated,
    });

    revalidatePath('/accounts');
    return { success: true };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error: error.errors[0].message };
    }
    console.error('Error creating account:', error);
    return { success: false, error: 'Failed to create account' };
  }
}

export async function updateAccount(id: string, formData: FormData) {
  try {
    const data = {
      name: formData.get('name') as string,
      type: formData.get('type') as 'CHECKING' | 'SAVINGS' | 'CASH' | 'CREDIT_CARD' | 'INVESTMENT',
      institution: formData.get('institution') as string,
      startingBalance: parseFloat(formData.get('startingBalance') as string) || 0,
    };

    const validated = accountSchema.parse(data);

    await prisma.account.update({
      where: { id },
      data: validated,
    });

    revalidatePath('/accounts');
    return { success: true };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error: error.errors[0].message };
    }
    console.error('Error updating account:', error);
    return { success: false, error: 'Failed to update account' };
  }
}

export async function deleteAccount(id: string) {
  try {
    // Check if account has transactions
    const count = await prisma.transaction.count({
      where: { accountId: id },
    });

    if (count > 0) {
      return {
        success: false,
        error: `Cannot delete account. It has ${count} transaction(s).`,
      };
    }

    await prisma.account.delete({
      where: { id },
    });

    revalidatePath('/accounts');
    return { success: true };
  } catch (error) {
    console.error('Error deleting account:', error);
    return { success: false, error: 'Failed to delete account' };
  }
}
