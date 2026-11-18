'use server';

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { budgetInputSchema } from '@/lib/validations';
import { budgetMonthDate, isValidMonthKey, shiftMonthKey } from '@/lib/budgets';
import { loadBudgetHint, loadBudgetMonth } from '@/lib/budgetData';
import { isValidDay, todayInAppTimeZone } from '@/lib/dates';

/** Pages that show budget figures. */
function revalidateBudgets() {
  revalidatePath('/plan/budgets');
  revalidatePath('/');
}

export async function getBudgetMonth(key: string) {
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
  const parsed = budgetInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.issues[0]?.message ?? 'Invalid budget' };
  }
  const { month: key, categoryId, amount, rolloverEnabled } = parsed.data;
  try {
    const month = budgetMonthDate(key);
    if (!amount) {
      await prisma.budget.deleteMany({ where: { month, categoryId } });
    } else {
      const category = await prisma.category.findUnique({ where: { id: categoryId } });
      if (!category || category.type !== 'EXPENSE') {
        return { success: false as const, error: 'Budgets need an expense category' };
      }
      await prisma.budget.upsert({
        where: { month_categoryId: { month, categoryId } },
        create: { month, categoryId, amount, rolloverEnabled: rolloverEnabled ?? false },
        update: { amount, ...(rolloverEnabled === undefined ? {} : { rolloverEnabled }) },
      });
    }
    revalidateBudgets();
    return { success: true as const };
  } catch (error) {
    console.error('Error saving budget:', error);
    return { success: false as const, error: 'Failed to save budget' };
  }
}

/** Turn rollover on or off for an existing budget. */
export async function setBudgetRollover(key: string, categoryId: string, rolloverEnabled: boolean) {
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
  try {
    if (!isValidMonthKey(key)) throw new Error(`Invalid month ${key}`);
    const month = budgetMonthDate(key);
    const [previous, existing] = await Promise.all([
      prisma.budget.findMany({ where: { month: budgetMonthDate(shiftMonthKey(key, -1)) } }),
      prisma.budget.findMany({ where: { month }, select: { categoryId: true } }),
    ]);
    const taken = new Set(existing.map((b) => b.categoryId));
    const toCopy = previous.filter((b) => !taken.has(b.categoryId));
    if (toCopy.length > 0) {
      await prisma.budget.createMany({
        data: toCopy.map((b) => ({
          month,
          categoryId: b.categoryId,
          amount: b.amount,
          rolloverEnabled: b.rolloverEnabled ?? false,
        })),
      });
    }
    revalidateBudgets();
    return { success: true as const, copied: toCopy.length };
  } catch (error) {
    console.error('Error copying budgets:', error);
    return { success: false as const, error: 'Failed to copy last month' };
  }
}

/** For the expense form: what is left in a category's budget in the month of `day`. */
export async function getBudgetHint(categoryId: string, day: string) {
  try {
    if (!/^[a-f\d]{24}$/i.test(categoryId) || !isValidDay(day)) return null;
    return await loadBudgetHint(categoryId, day);
  } catch (error) {
    console.error('Error loading budget hint:', error);
    return null;
  }
}
