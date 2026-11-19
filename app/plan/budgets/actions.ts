'use server';

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { budgetInputSchema } from '@/lib/validations';
import { budgetMonthDate, isValidMonthKey } from '@/lib/budgets';
import { copyPreviousMonthIn, setBudgetIn } from '@/lib/budgetWrites';
import { TransactionError } from '@/lib/transactions';
import { loadBudgetHint, loadBudgetMonth } from '@/lib/budgetData';
import { isValidDay, todayInAppTimeZone } from '@/lib/dates';
import { requireSession } from '@/lib/auth/session';

/** Pages that show budget figures. */
function revalidateBudgets() {
  revalidatePath('/plan/budgets');
  revalidatePath('/');
}

export async function getBudgetMonth(key: string) {
  await requireSession();
  try {
    if (!isValidMonthKey(key)) throw new Error(`Invalid month ${key}`);
    return { success: true as const, data: await loadBudgetMonth(key, todayInAppTimeZone()) };
  } catch (error) {
    console.error('Error loading budgets:', error);
    return { success: false as const, error: 'Failed to load budgets' };
  }
}

/**
 * Create, update or remove a category's budget for a month. An amount of null
 * or 0 removes it. rolloverEnabled left undefined keeps the current setting.
 */
export async function setBudget(input: z.input<typeof budgetInputSchema>) {
  await requireSession();
  try {
    // The rules live in lib/budgetWrites.ts, shared with the chat assistant.
    await setBudgetIn(prisma, input);
    revalidateBudgets();
    return { success: true as const };
  } catch (error) {
    if (error instanceof TransactionError) return { success: false as const, error: error.message };
    console.error('Error saving budget:', error);
    return { success: false as const, error: 'Failed to save budget' };
  }
}

/** Turn rollover on or off for an existing budget. */
export async function setBudgetRollover(key: string, categoryId: string, rolloverEnabled: boolean) {
  await requireSession();
  try {
    if (!isValidMonthKey(key)) throw new Error(`Invalid month ${key}`);
    const { count } = await prisma.budget.updateMany({
      where: { month: budgetMonthDate(key), categoryId },
      data: { rolloverEnabled },
    });
    if (count === 0) return { success: false as const, error: 'Set a budget amount first' };
    revalidateBudgets();
    return { success: true as const };
  } catch (error) {
    console.error('Error saving rollover:', error);
    return { success: false as const, error: 'Failed to save rollover' };
  }
}

/** Copies last month's budgets (amount and rollover) into categories with no budget yet. */
export async function copyPreviousMonth(key: string) {
  await requireSession();
  try {
    if (!isValidMonthKey(key)) throw new Error(`Invalid month ${key}`);
    const { copied } = await copyPreviousMonthIn(prisma, key);
    revalidateBudgets();
    return { success: true as const, copied };
  } catch (error) {
    console.error('Error copying budgets:', error);
    return { success: false as const, error: 'Failed to copy last month' };
  }
}

/** For the expense form: what is left in a category's budget in the month of `day`. */
export async function getBudgetHint(categoryId: string, day: string) {
  await requireSession();
  try {
    if (!/^[a-f\d]{24}$/i.test(categoryId) || !isValidDay(day)) return null;
    return await loadBudgetHint(categoryId, day);
  } catch (error) {
    console.error('Error loading budget hint:', error);
    return null;
  }
}
