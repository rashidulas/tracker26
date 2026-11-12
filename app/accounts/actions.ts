'use server';

import { prisma } from '@/lib/prisma';
import { computeBalancesForAccounts } from '@/lib/accountBalance';
import { accountDeleteBlocker } from '@/lib/references';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

const accountSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  type: z.enum(['CHECKING', 'SAVINGS', 'CASH', 'CREDIT_CARD', 'INVESTMENT', 'LOAN']),
  institution: z.string().optional(),
  startingBalance: z.number(),
  creditLimit: z.number().nonnegative('Credit limit cannot be negative').nullable(),
});

function parseCreditLimit(formData: FormData, type: string): number | null {
  if (type !== 'CREDIT_CARD') return null;
  const raw = (formData.get('creditLimit') as string) || '';
  if (!raw.trim()) return null;
  const value = parseFloat(raw);
  if (Number.isNaN(value)) return null;
  return value;
}

export async function getAccounts() {
  try {
    const [accounts, transactions] = await Promise.all([
      prisma.account.findMany({ orderBy: { name: 'asc' } }),
      prisma.transaction.findMany({
        select: {
          amount: true,
          kind: true,
          accountId: true,
          toAccountId: true,
          accountSplits: true,
        },
      }),
    ]);

    const balances = computeBalancesForAccounts(accounts, transactions);
    const accountsWithBalance = accounts.map((account) => ({
      ...account,
      currentBalance: balances.get(account.id)?.balance ?? account.startingBalance,
      transactionCount: balances.get(account.id)?.transactionCount ?? 0,
    }));

    return { success: true, data: accountsWithBalance };
  } catch (error) {
    console.error('Error fetching accounts:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: `Failed to fetch accounts: ${errorMessage}` };
  }
}

export async function createAccount(formData: FormData) {
  try {
    const type = formData.get('type') as
      | 'CHECKING'
      | 'SAVINGS'
      | 'CASH'
      | 'CREDIT_CARD'
      | 'INVESTMENT'
      | 'LOAN';
    const data = {
      name: formData.get('name') as string,
      type,
      institution: formData.get('institution') as string,
      startingBalance: parseFloat(formData.get('startingBalance') as string) || 0,
      creditLimit: parseCreditLimit(formData, type),
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
    const message = error instanceof Error ? error.message : 'Failed to create account';
    if (message.includes('Expected AccountType')) {
      return {
        success: false,
        error: 'Account type not recognized yet. Restart the app and try again.',
      };
    }
    return { success: false, error: 'Failed to create account' };
  }
}

export async function updateAccount(id: string, formData: FormData) {
  try {
    const type = formData.get('type') as
      | 'CHECKING'
      | 'SAVINGS'
      | 'CASH'
      | 'CREDIT_CARD'
      | 'INVESTMENT'
      | 'LOAN';
    const data = {
      name: formData.get('name') as string,
      type,
      institution: formData.get('institution') as string,
      startingBalance: parseFloat(formData.get('startingBalance') as string) || 0,
      creditLimit: parseCreditLimit(formData, type),
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
    const account = await prisma.account.findUnique({
      where: { id },
      select: { name: true },
    });
    if (!account) return { success: false, error: 'Account not found' };

    // Transfers into the account would cascade-delete, and income/expense
    // account splits and goal contributions would be left pointing at nothing.
    const blocker = await accountDeleteBlocker(prisma, id, account.name);
    if (blocker) return { success: false, error: blocker };

    await prisma.account.delete({
      where: { id },
    });

    revalidatePath('/accounts');
    revalidatePath('/dashboard');
    revalidatePath('/goals');
    return { success: true };
  } catch (error) {
    console.error('Error deleting account:', error);
    return { success: false, error: 'Failed to delete account' };
  }
}

/** Accounts for pickers (expense, income and transfer forms). */
export async function getAccountsForSelect() {
  try {
    const accounts = await prisma.account.findMany({
      orderBy: { name: 'asc' },
    });
    return { success: true, data: accounts };
  } catch (error) {
    console.error('Error fetching accounts:', error);
    return { success: false, error: 'Failed to fetch accounts' };
  }
}
