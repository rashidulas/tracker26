'use server';

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

const monthKey = z.string().regex(/^\d{4}-\d{2}$/, 'Invalid month');

/** Budgets are keyed by the first instant of the month in UTC. */
function monthStart(key: string) {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1));
}

function previousMonthKey(key: string) {
  const d = monthStart(key);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export async function getBudgetMonth(key: string) {
  try {
    const month = monthStart(monthKey.parse(key));
    const next = new Date(month);
    next.setUTCMonth(next.getUTCMonth() + 1);

    const [categories, budgets, spending] = await Promise.all([
      prisma.category.findMany({
        where: { type: 'EXPENSE' },
        select: { id: true, name: true, icon: true },
        orderBy: { name: 'asc' },
      }),
      prisma.budget.findMany({ where: { month } }),
      prisma.transaction.groupBy({
        by: ['categoryId'],
        where: { kind: 'EXPENSE', date: { gte: month, lt: next } },
        _sum: { amount: true },
      }),
    ]);

    const budgetByCategory = new Map(budgets.map((b) => [b.categoryId, b]));
    const spentByCategory = new Map(
      spending.map((s) => [s.categoryId ?? 'uncategorized', s._sum.amount ?? 0])
    );

    const rows = categories.map((c) => ({
      categoryId: c.id,
      name: c.name,
      icon: c.icon,
      budgetId: budgetByCategory.get(c.id)?.id ?? null,
      limit: budgetByCategory.get(c.id)?.amount ?? null,
      spent: spentByCategory.get(c.id) ?? 0,
    }));

    return {
      success: true as const,
      data: {
        month: key,
        rows,
        uncategorizedSpent: spentByCategory.get('uncategorized') ?? 0,
        hasPreviousBudgets:
          budgets.length === 0 &&
          (await prisma.budget.count({ where: { month: monthStart(previousMonthKey(key)) } })) > 0,
      },
    };
  } catch (error) {
    console.error('Error loading budgets:', error);
    return { success: false as const, error: 'Failed to load budgets' };
  }
}

export async function setBudget(key: string, categoryId: string, amount: number | null) {
  try {
    const month = monthStart(monthKey.parse(key));
    if (amount === null || amount <= 0) {
      await prisma.budget.deleteMany({ where: { month, categoryId } });
    } else {
      const value = z.number().positive().finite().parse(amount);
      await prisma.budget.upsert({
        where: { month_categoryId: { month, categoryId } },
        create: { month, categoryId, amount: value },
        update: { amount: value },
      });
    }
    revalidatePath('/plan/budgets');
    return { success: true as const };
  } catch (error) {
    console.error('Error saving budget:', error);
    return { success: false as const, error: 'Failed to save budget' };
  }
}

export async function copyPreviousMonth(key: string) {
  try {
    const month = monthStart(monthKey.parse(key));
    const previous = await prisma.budget.findMany({
      where: { month: monthStart(previousMonthKey(key)) },
    });
    for (const b of previous) {
      await prisma.budget.upsert({
        where: { month_categoryId: { month, categoryId: b.categoryId } },
        create: { month, categoryId: b.categoryId, amount: b.amount },
        update: {},
      });
    }
    revalidatePath('/plan/budgets');
    return { success: true as const, copied: previous.length };
  } catch (error) {
    console.error('Error copying budgets:', error);
    return { success: false as const, error: 'Failed to copy last month' };
  }
}
