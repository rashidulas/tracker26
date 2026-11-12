// Server-only data loader for the Insights tab (imported by page.tsx, not a server action).
// Dates follow lib/dates.ts: calendar days stored as UTC midnight, "today" in APP_TIMEZONE.

import { prisma } from '@/lib/prisma';
import {
  addDays,
  eachDay,
  lastNDaysRange,
  parseDay,
  startOfMonthDay,
  toDayString,
  todayInAppTimeZone,
  type DayString,
} from '@/lib/dates';

export type InsightsRange = 'month' | '30d' | '90d' | 'year' | 'all';

export interface CategoryTotal {
  id: string;
  name: string;
  icon: string | null;
  amount: number;
  count: number;
}

export interface InsightsData {
  range: InsightsRange;
  /** Inclusive day bounds, or null when open-ended (used for deep links). */
  from: DayString | null;
  to: DayString | null;
  expenseTotal: number;
  expenseCount: number;
  incomeTotal: number;
  incomeCount: number;
  days: number;
  expenseByCategory: CategoryTotal[];
  incomeBySource: CategoryTotal[];
  dailyExpenses: Array<{ date: DayString; amount: number }>;
}

/** First calendar day of the range (inclusive), or null for all time. */
function rangeStart(range: InsightsRange, today: DayString): DayString | null {
  switch (range) {
    case 'month':
      return startOfMonthDay(today);
    case '30d':
      return toDayString(lastNDaysRange(30, today).gte);
    case '90d':
      return toDayString(lastNDaysRange(90, today).gte);
    case 'year':
      return `${today.slice(0, 4)}-01-01`;
    case 'all':
      return null;
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
    const today = todayInAppTimeZone();
    const start = rangeStart(range, today);
    const lt = parseDay(addDays(today, 1));
    const date = start ? { gte: parseDay(start), lt } : { lt };
    const select = {
      amount: true,
      date: true,
      category: { select: { id: true, name: true, icon: true } },
    } as const;

    const [expenses, income] = await Promise.all([
      prisma.transaction.findMany({ where: { kind: 'EXPENSE', date }, select, orderBy: { date: 'asc' } }),
      prisma.transaction.findMany({ where: { kind: 'INCOME', date }, select, orderBy: { date: 'asc' } }),
    ]);

    const first =
      start ??
      [expenses[0]?.date, income[0]?.date]
        .filter((d): d is Date => Boolean(d))
        .map(toDayString)
        .sort()[0] ??
      today;
    const days = eachDay(first, today);

    const byDay = new Map<string, number>();
    for (const e of expenses) {
      const key = toDayString(e.date);
      byDay.set(key, (byDay.get(key) ?? 0) + e.amount);
    }
    // Zero-filled daily series so gaps read honestly; for very long spans keep
    // only days with spending to keep the chart light.
    const dailyExpenses =
      days.length <= 400
        ? days.map((d) => ({ date: d, amount: byDay.get(d) ?? 0 }))
        : Array.from(byDay.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([d, amount]) => ({ date: d, amount }));

    return {
      success: true,
      data: {
        range,
        from: start,
        to: range === 'all' ? null : today,
        expenseTotal: expenses.reduce((s, e) => s + e.amount, 0),
        expenseCount: expenses.length,
        incomeTotal: income.reduce((s, i) => s + i.amount, 0),
        incomeCount: income.length,
        days: Math.max(1, days.length),
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
