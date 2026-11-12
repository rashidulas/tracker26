// Server-only data loader for the Insights tab (imported by page.tsx, not a server action).

import { prisma } from '@/lib/prisma';

export type InsightsRange = 'month' | '30d' | '90d' | 'year' | 'all';

export const RANGE_LABELS: Record<InsightsRange, string> = {
  month: 'This month',
  '30d': 'Last 30 days',
  '90d': 'Last 3 months',
  year: 'This year',
  all: 'All time',
};

export interface CategoryTotal {
  id: string;
  name: string;
  icon: string | null;
  amount: number;
  count: number;
}

export interface InsightsData {
  range: InsightsRange;
  /** Inclusive YYYY-MM-DD bounds, or null for open-ended (used for deep links). */
  from: string | null;
  to: string | null;
  expenseTotal: number;
  expenseCount: number;
  incomeTotal: number;
  incomeCount: number;
  days: number;
  expenseByCategory: CategoryTotal[];
  incomeBySource: CategoryTotal[];
  dailyExpenses: Array<{ date: string; amount: number }>;
}

function isoDay(d: Date) {
  return d.toISOString().slice(0, 10);
}

function rangeBounds(range: InsightsRange): { start: Date | null; end: Date } {
  const now = new Date();
  const end = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999));
  const daysAgo = (n: number) =>
    new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() - n + 1));
  switch (range) {
    case 'month':
      return { start: new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1)), end };
    case '30d':
      return { start: daysAgo(30), end };
    case '90d':
      return { start: daysAgo(90), end };
    case 'year':
      return { start: new Date(Date.UTC(now.getFullYear(), 0, 1)), end };
    case 'all':
      return { start: null, end };
  }
}

function totalsBy(
  rows: Array<{
    amount: number;
    category: { id: string; name: string; icon: string | null } | null;
  }>
): CategoryTotal[] {
  const map = new Map<string, CategoryTotal>();
  for (const row of rows) {
    const id = row.category?.id ?? 'uncategorized';
    const entry = map.get(id) ?? {
      id,
      name: row.category?.name ?? 'Uncategorized',
      icon: row.category?.icon ?? null,
      amount: 0,
      count: 0,
    };
    entry.amount += row.amount;
    entry.count += 1;
    map.set(id, entry);
  }
  return Array.from(map.values()).sort((a, b) => b.amount - a.amount);
}

export async function getInsights(
  range: InsightsRange
): Promise<{ success: true; data: InsightsData } | { success: false; error: string }> {
  try {
    const { start, end } = rangeBounds(range);
    const date = start ? { gte: start, lte: end } : { lte: end };
    const select = {
      amount: true,
      date: true,
      category: { select: { id: true, name: true, icon: true } },
    } as const;

    const [expenses, income] = await Promise.all([
      prisma.transaction.findMany({ where: { kind: 'EXPENSE', date }, select, orderBy: { date: 'asc' } }),
      prisma.transaction.findMany({ where: { kind: 'INCOME', date }, select, orderBy: { date: 'asc' } }),
    ]);

    const firstDate = start ?? expenses[0]?.date ?? income[0]?.date ?? end;
    const days = Math.max(1, Math.ceil((end.getTime() - firstDate.getTime()) / 86_400_000));

    // Daily spending series with zero-filled gaps so the line reads honestly.
    const byDay = new Map<string, number>();
    for (const e of expenses) {
      const key = isoDay(e.date);
      byDay.set(key, (byDay.get(key) ?? 0) + e.amount);
    }
    const dailyExpenses: Array<{ date: string; amount: number }> = [];
    if (days <= 400) {
      for (let d = new Date(firstDate); d <= end; d = new Date(d.getTime() + 86_400_000)) {
        const key = isoDay(d);
        dailyExpenses.push({ date: key, amount: byDay.get(key) ?? 0 });
      }
    } else {
      for (const [key, amount] of Array.from(byDay.entries()).sort()) {
        dailyExpenses.push({ date: key, amount });
      }
    }

    return {
      success: true,
      data: {
        range,
        from: start ? isoDay(start) : null,
        to: range === 'all' ? null : isoDay(end),
        expenseTotal: expenses.reduce((s, e) => s + e.amount, 0),
        expenseCount: expenses.length,
        incomeTotal: income.reduce((s, i) => s + i.amount, 0),
        incomeCount: income.length,
        days,
        expenseByCategory: totalsBy(expenses),
        incomeBySource: totalsBy(income),
        dailyExpenses,
      },
    };
  } catch (error) {
    console.error('Error building insights:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to load insights',
    };
  }
}
