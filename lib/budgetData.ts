/**
 * Server-side budget loaders. Every figure the Budgets page, the dashboard
 * and the expense form show is computed here from lib/budgets.ts, so the
 * three always agree.
 *
 * Server-only. The database is passed in so tests can supply a fake.
 */
import {
  ROLLOVER_LOOKBACK_MONTHS,
  budgetMonthDate,
  budgetStatus,
  monthKeyOf,
  monthPacing,
  resolveCategoryBudget,
  safeToSpendPerDay,
  shiftMonthKey,
  spendingIn,
  tallySpending,
  usedRatio,
  type BudgetStatus,
  type MonthKey,
  type MonthPacing,
  type SpendingTransaction,
} from '@/lib/budgets';
import { dayRange, toDayString, weekToDateRange, type DayString } from '@/lib/dates';
import { sumMyShare } from '@/lib/expenseAllocations';

type DateFilter = { gte: Date; lt: Date };

/** The slice of PrismaClient the loaders use. */
export interface BudgetDb {
  category: {
    findMany(args: {
      where: { type: 'EXPENSE'; id?: string };
      select: { id: true; name: true; icon: true; color: true };
      orderBy?: { name: 'asc' };
    }): Promise<Array<{ id: string; name: string; icon: string | null; color: string }>>;
  };
  budget: {
    findMany(args: {
      where: { month: DateFilter; categoryId?: string };
    }): Promise<
      Array<{ id: string; month: Date; categoryId: string; amount: number; rolloverEnabled: boolean | null }>
    >;
  };
  transaction: {
    findMany(args: {
      where: Record<string, unknown>;
      select: { date: true; amount: true; categoryId: true; splitItems: true; sharedAmount: true };
    }): Promise<SpendingTransaction[]>;
  };
}

async function defaultDb(): Promise<BudgetDb> {
  const { prisma } = await import('@/lib/prisma');
  return prisma as unknown as BudgetDb;
}

/** Budgets from `lookback` months before `target` through `target`. */
function lookbackRange(target: MonthKey, lookback = ROLLOVER_LOOKBACK_MONTHS): DateFilter {
  return {
    gte: budgetMonthDate(shiftMonthKey(target, -lookback)),
    lt: budgetMonthDate(shiftMonthKey(target, 1)),
  };
}

// sharedAmount: only your share of an expense split with friends counts.
const SPENDING_SELECT = {
  date: true,
  amount: true,
  categoryId: true,
  splitItems: true,
  sharedAmount: true,
} as const;

// ==================== BUDGET MONTH ====================

export interface BudgetRow {
  categoryId: string;
  name: string;
  icon: string | null;
  color: string;
  spent: number;
  budget: null | {
    amount: number;
    rolloverEnabled: boolean;
    carryIn: number;
    available: number;
    remaining: number;
    status: BudgetStatus;
    /** 0..1+ share of available spent */
    used: number;
  };
}

export interface BudgetMonthData {
  month: MonthKey;
  today: DayString;
  pacing: MonthPacing;
  rows: BudgetRow[];
  uncategorizedSpent: number;
  totals: {
    budgeted: number;
    available: number;
    spentInBudgets: number;
    remaining: number;
    totalSpent: number;
    overCount: number;
  };
  /** Categories budgeted last month that have no budget this month. */
  copyableFromPrevious: number;
  /** Spending today in budgeted categories (only when `month` is the current month). */
  spentTodayInBudgets: number;
}

export async function loadBudgetMonth(
  month: MonthKey,
  today: DayString,
  db?: BudgetDb
): Promise<BudgetMonthData> {
  const d = db ?? (await defaultDb());
  const range = lookbackRange(month);

  const [categories, budgets, expenses] = await Promise.all([
    d.category.findMany({
      where: { type: 'EXPENSE' },
      select: { id: true, name: true, icon: true, color: true },
      orderBy: { name: 'asc' },
    }),
    d.budget.findMany({ where: { month: range } }),
    d.transaction.findMany({
      where: { kind: 'EXPENSE', date: range },
      select: SPENDING_SELECT,
    }),
  ]);

  const spending = tallySpending(expenses);
  const budgetsByCategory = new Map<string, Map<MonthKey, { amount: number; rolloverEnabled: boolean }>>();
  for (const b of budgets) {
    let m = budgetsByCategory.get(b.categoryId);
    if (!m) budgetsByCategory.set(b.categoryId, (m = new Map()));
    m.set(monthKeyOf(b.month), { amount: b.amount, rolloverEnabled: b.rolloverEnabled ?? false });
  }

  const pacing = monthPacing(month, today);
  const thisMonth = spending.byMonth.get(month) ?? new Map<string, number>();

  const rows: BudgetRow[] = categories.map((c) => {
    const history = budgetsByCategory.get(c.id) ?? new Map();
    const spentHistory = new Map<MonthKey, number>();
    for (const [key, cats] of spending.byMonth) spentHistory.set(key, cats.get(c.id) ?? 0);
    const resolved = resolveCategoryBudget(month, history, spentHistory);
    const spent = thisMonth.get(c.id) ?? 0;
    return {
      categoryId: c.id,
      name: c.name,
      icon: c.icon,
      color: c.color,
      spent,
      budget: resolved && {
        amount: resolved.amount,
        rolloverEnabled: resolved.rolloverEnabled,
        carryIn: resolved.carryIn,
        available: resolved.available,
        remaining: resolved.remaining,
        status: budgetStatus(spent, resolved.available, pacing.fraction),
        used: Math.min(usedRatio(spent, resolved.available), 9.99),
      },
    };
  });

  const budgeted = rows.filter((r) => r.budget);
  const budgetedIds = new Set(budgeted.map((r) => r.categoryId));
  const sum = (xs: number[]) => Math.round(xs.reduce((s, x) => s + x, 0) * 100) / 100;
  const uncategorizedSpent = spending.uncategorized.get(month) ?? 0;

  const todayKey = toDayString(today);
  const spentTodayInBudgets = pacing.isCurrent
    ? sum(
        expenses
          .filter((t) => toDayString(t.date) === todayKey)
          .map((t) => spendingIn(t, budgetedIds))
      )
    : 0;

  const previous = budgetsByCategory;
  const prevKey = shiftMonthKey(month, -1);
  let copyableFromPrevious = 0;
  for (const history of previous.values()) {
    if (history.has(prevKey) && !history.has(month)) copyableFromPrevious++;
  }

  const available = sum(budgeted.map((r) => r.budget!.available));
  const spentInBudgets = sum(budgeted.map((r) => r.spent));

  return {
    month,
    today,
    pacing,
    rows,
    uncategorizedSpent,
    totals: {
      budgeted: sum(budgeted.map((r) => r.budget!.amount)),
      available,
      spentInBudgets,
      remaining: sum([available, -spentInBudgets]),
      totalSpent: sum([...rows.map((r) => r.spent), uncategorizedSpent]),
      overCount: budgeted.filter((r) => r.budget!.status === 'over').length,
    },
    copyableFromPrevious,
    spentTodayInBudgets,
  };
}

// ==================== DASHBOARD ====================

export interface BudgetOverview {
  hasBudgets: boolean;
  /** Per-day allowance for the rest of the month across budgeted categories. */
  safeToSpendToday: number;
  /** safeToSpendToday minus what was spent today in budgeted categories. */
  leftToday: number;
  daysLeft: number;
  remainingThisMonth: number;
  /** All spending (every category), today and Monday-to-today. */
  spentToday: number;
  spentThisWeek: number;
  /** The three budgets closest to or over their limit. */
  watchlist: Array<{
    categoryId: string;
    name: string;
    icon: string | null;
    spent: number;
    available: number;
    remaining: number;
    used: number;
    status: BudgetStatus;
  }>;
  pacing: MonthPacing;
}

export async function loadBudgetOverview(today: DayString, db?: BudgetDb): Promise<BudgetOverview> {
  const d = db ?? (await defaultDb());
  const month = monthKeyOf(today);
  const [data, todayExpenses, weekExpenses] = await Promise.all([
    loadBudgetMonth(month, today, d),
    d.transaction.findMany({
      where: { kind: 'EXPENSE', date: dayRange(today) },
      select: SPENDING_SELECT,
    }),
    d.transaction.findMany({
      where: { kind: 'EXPENSE', date: weekToDateRange(today) },
      select: SPENDING_SELECT,
    }),
  ]);

  const total = (xs: SpendingTransaction[]) =>
    Math.round(sumMyShare(xs) * 100) / 100;

  const safe = safeToSpendPerDay({
    available: data.totals.available,
    spentBeforeToday: data.totals.spentInBudgets - data.spentTodayInBudgets,
    daysLeft: data.pacing.daysLeft,
  });

  const watchlist = data.rows
    .filter((r) => r.budget)
    .sort((a, b) => b.budget!.used - a.budget!.used)
    .slice(0, 3)
    .map((r) => ({
      categoryId: r.categoryId,
      name: r.name,
      icon: r.icon,
      spent: r.spent,
      available: r.budget!.available,
      remaining: r.budget!.remaining,
      used: r.budget!.used,
      status: r.budget!.status,
    }));

  return {
    hasBudgets: data.rows.some((r) => r.budget),
    safeToSpendToday: safe,
    leftToday: Math.round((safe - data.spentTodayInBudgets) * 100) / 100,
    daysLeft: data.pacing.daysLeft,
    remainingThisMonth: data.totals.remaining,
    spentToday: total(todayExpenses),
    spentThisWeek: total(weekExpenses),
    watchlist,
    pacing: data.pacing,
  };
}

// ==================== EXPENSE FORM HINT ====================

export interface BudgetHint {
  month: MonthKey;
  available: number;
  spent: number;
  remaining: number;
}

/** What is left in one category's budget for the month containing `day`, or null if unbudgeted. */
export async function loadBudgetHint(
  categoryId: string,
  day: DayString,
  db?: BudgetDb
): Promise<BudgetHint | null> {
  const d = db ?? (await defaultDb());
  const month = monthKeyOf(day);
  const range = lookbackRange(month);
  const budgets = await d.budget.findMany({ where: { month: range, categoryId } });
  if (!budgets.some((b) => monthKeyOf(b.month) === month)) return null;

  const expenses = await d.transaction.findMany({
    where: {
      kind: 'EXPENSE',
      date: range,
      OR: [{ categoryId }, { splitItems: { some: { categoryId } } }],
    },
    select: SPENDING_SELECT,
  });
  const spending = tallySpending(expenses);
  const spent = new Map<MonthKey, number>();
  for (const [key, cats] of spending.byMonth) spent.set(key, cats.get(categoryId) ?? 0);
  const history = new Map(
    budgets.map((b) => [monthKeyOf(b.month), { amount: b.amount, rolloverEnabled: b.rolloverEnabled ?? false }])
  );
  const resolved = resolveCategoryBudget(month, history, spent);
  if (!resolved) return null;
  return {
    month,
    available: resolved.available,
    spent: resolved.spent,
    remaining: resolved.remaining,
  };
}
