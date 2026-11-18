import { describe, expect, it } from 'vitest';
import {
  budgetStatus,
  computeRolloverChain,
  monthPacing,
  resolveCategoryBudget,
  safeToSpendPerDay,
  shiftMonthKey,
  tallySpending,
} from '@/lib/budgets';
import {
  loadBudgetHint,
  loadBudgetMonth,
  loadBudgetOverview,
  type BudgetDb,
} from '@/lib/budgetData';
import { parseDay } from '@/lib/dates';

describe('computeRolloverChain', () => {
  it('carries unspent money forward and lets overspend reduce the next month', () => {
    const [sep, oct, nov] = computeRolloverChain([
      { amount: 300, rolloverEnabled: true, spent: 250 }, // 50 left
      { amount: 300, rolloverEnabled: true, spent: 400 }, // 350 available, 50 over
      { amount: 300, rolloverEnabled: false, spent: 100 },
    ]);
    expect(sep).toMatchObject({ carryIn: 0, available: 300, remaining: 50 });
    expect(oct).toMatchObject({ carryIn: 50, available: 350, remaining: -50 });
    expect(nov).toMatchObject({ carryIn: -50, available: 250, remaining: 150 });
  });

  it('does not carry from a month with rollover off', () => {
    const [, next] = computeRolloverChain([
      { amount: 100, rolloverEnabled: false, spent: 0 },
      { amount: 100, rolloverEnabled: true, spent: 0 },
    ]);
    expect(next.carryIn).toBe(0);
    expect(next.available).toBe(100);
  });

  it('rounds to cents', () => {
    const [, b] = computeRolloverChain([
      { amount: 0.3, rolloverEnabled: true, spent: 0.1 },
      { amount: 0.1, rolloverEnabled: false, spent: 0 },
    ]);
    expect(b.available).toBe(0.3);
  });
});

describe('resolveCategoryBudget', () => {
  const budgets = new Map([
    ['2026-08', { amount: 200, rolloverEnabled: true }],
    // no September budget: breaks the chain
    ['2026-10', { amount: 200, rolloverEnabled: true }],
    ['2026-11', { amount: 200, rolloverEnabled: true }],
  ]);
  const spent = new Map([
    ['2026-08', 0],
    ['2026-09', 500],
    ['2026-10', 120],
    ['2026-11', 30],
  ]);

  it('follows consecutive rollover months back to a gap', () => {
    const nov = resolveCategoryBudget('2026-11', budgets, spent)!;
    // August's 200 must not leak past the missing September budget.
    expect(nov.carryIn).toBe(80);
    expect(nov.available).toBe(280);
    expect(nov.remaining).toBe(250);
  });

  it('returns null for a month without a budget', () => {
    expect(resolveCategoryBudget('2026-09', budgets, spent)).toBeNull();
  });

  it('crosses year boundaries', () => {
    const yearEnd = new Map([
      ['2026-12', { amount: 100, rolloverEnabled: true }],
      ['2027-01', { amount: 100, rolloverEnabled: false }],
    ]);
    const r = resolveCategoryBudget('2027-01', yearEnd, new Map([['2026-12', 40]]))!;
    expect(r.carryIn).toBe(60);
    expect(shiftMonthKey('2027-01', -1)).toBe('2026-12');
  });
});

describe('monthPacing and safe to spend', () => {
  it('counts today as both elapsed and still to go', () => {
    expect(monthPacing('2026-11', '2026-11-18')).toEqual({
      daysInMonth: 30,
      daysElapsed: 18,
      daysLeft: 13,
      fraction: 0.6,
      isCurrent: true,
    });
  });

  it('treats past months as finished and future months as untouched', () => {
    expect(monthPacing('2026-10', '2026-11-18')).toMatchObject({ fraction: 1, daysLeft: 0 });
    expect(monthPacing('2026-12', '2026-11-18')).toMatchObject({ fraction: 0, daysLeft: 31 });
  });

  it('spreads what was left this morning over the days left', () => {
    expect(safeToSpendPerDay({ available: 1000, spentBeforeToday: 610, daysLeft: 13 })).toBe(30);
    expect(safeToSpendPerDay({ available: 100, spentBeforeToday: 150, daysLeft: 5 })).toBe(0);
    expect(safeToSpendPerDay({ available: 100, spentBeforeToday: 0, daysLeft: 0 })).toBe(0);
  });

  it('flags over, near and ahead of pace', () => {
    expect(budgetStatus(110, 100, 0.5)).toBe('over');
    expect(budgetStatus(90, 100, 0.5)).toBe('near');
    expect(budgetStatus(70, 100, 0.5)).toBe('ahead');
    expect(budgetStatus(40, 100, 0.5)).toBe('ok');
  });
});

describe('tallySpending', () => {
  it('counts split items toward their own categories', () => {
    const t = tallySpending([
      { date: parseDay('2026-11-03'), amount: 50, categoryId: 'food', splitItems: [] },
      {
        date: parseDay('2026-11-04'),
        amount: 100,
        categoryId: null,
        splitItems: [
          { categoryId: 'food', amount: 60 },
          { categoryId: 'home', amount: 40 },
        ],
      },
      { date: parseDay('2026-11-05'), amount: 7, categoryId: null, splitItems: [] },
    ]);
    expect(Object.fromEntries(t.byMonth.get('2026-11')!)).toEqual({ food: 110, home: 40 });
    expect(t.uncategorized.get('2026-11')).toBe(7);
  });
});

// ==================== LOADERS ====================

const FOOD = 'a'.repeat(24);
const HOME = 'b'.repeat(24);
const FUN = 'c'.repeat(24);

type Tx = {
  kind: 'EXPENSE' | 'INCOME' | 'TRANSFER';
  date: string;
  amount: number;
  categoryId: string | null;
  splitItems?: { categoryId: string; amount: number }[];
  tags?: string[];
};

function fakeDb(
  budgets: Array<{ month: string; categoryId: string; amount: number; rolloverEnabled?: boolean }>,
  txs: Tx[]
): BudgetDb {
  const inRange = (d: Date, r?: { gte?: Date; lt?: Date }) =>
    !r || ((!r.gte || d >= r.gte) && (!r.lt || d < r.lt));
  return {
    category: {
      findMany: async () => [
        { id: FOOD, name: 'Food', icon: '🍔', color: '#f00' },
        { id: FUN, name: 'Fun', icon: null, color: '#0f0' },
        { id: HOME, name: 'Home', icon: '🏠', color: '#00f' },
      ],
    },
    budget: {
      findMany: async ({ where }) =>
        budgets
          .map((b, i) => ({
            id: String(i),
            month: parseDay(`${b.month}-01`),
            categoryId: b.categoryId,
            amount: b.amount,
            rolloverEnabled: b.rolloverEnabled ?? false,
          }))
          .filter((b) => inRange(b.month, where.month))
          .filter((b) => !where.categoryId || b.categoryId === where.categoryId),
    },
    transaction: {
      findMany: async ({ where }) =>
        txs
          .filter((t) => t.kind === where.kind)
          .map((t) => ({ ...t, date: parseDay(t.date), splitItems: t.splitItems ?? [] }))
          .filter((t) => inRange(t.date, where.date as { gte?: Date; lt?: Date })),
    },
  };
}

describe('budget loaders', () => {
  const budgets = [
    { month: '2026-10', categoryId: FOOD, amount: 400, rolloverEnabled: true },
    { month: '2026-11', categoryId: FOOD, amount: 400, rolloverEnabled: true },
    { month: '2026-11', categoryId: HOME, amount: 100 },
    { month: '2026-10', categoryId: FUN, amount: 50 },
  ];
  const txs: Tx[] = [
    { kind: 'EXPENSE', date: '2026-10-10', amount: 300, categoryId: FOOD }, // Oct: 100 left
    { kind: 'EXPENSE', date: '2026-11-02', amount: 200, categoryId: FOOD },
    {
      kind: 'EXPENSE',
      date: '2026-11-17',
      amount: 120,
      categoryId: null,
      splitItems: [
        { categoryId: FOOD, amount: 70 },
        { categoryId: HOME, amount: 50 },
      ],
    },
    { kind: 'EXPENSE', date: '2026-11-18', amount: 30, categoryId: HOME },
    { kind: 'EXPENSE', date: '2026-11-18', amount: 15, categoryId: FUN }, // unbudgeted
    // Card and debt payments are transfers and must not count anywhere.
    { kind: 'TRANSFER', date: '2026-11-18', amount: 999, categoryId: null, tags: ['payment'] },
    { kind: 'TRANSFER', date: '2026-11-05', amount: 500, categoryId: null, tags: ['debt-payment'] },
  ];
  const db = fakeDb(budgets, txs);
  const today = '2026-11-18';

  it('builds the month with rollover, split items and no transfers', async () => {
    const m = await loadBudgetMonth('2026-11', today, db);
    const food = m.rows.find((r) => r.categoryId === FOOD)!;
    const home = m.rows.find((r) => r.categoryId === HOME)!;
    const fun = m.rows.find((r) => r.categoryId === FUN)!;

    expect(food.spent).toBe(270);
    expect(food.budget).toMatchObject({ carryIn: 100, available: 500, remaining: 230 });
    expect(home.spent).toBe(80);
    expect(home.budget).toMatchObject({ carryIn: 0, available: 100, remaining: 20, status: 'ahead' });
    expect(fun.budget).toBeNull();
    expect(fun.spent).toBe(15);

    expect(m.totals).toMatchObject({
      budgeted: 500,
      available: 600,
      spentInBudgets: 350,
      remaining: 250,
      totalSpent: 365,
      overCount: 0,
    });
    expect(m.copyableFromPrevious).toBe(1); // Fun had a budget in October only
    expect(m.spentTodayInBudgets).toBe(30);
  });

  it('computes safe to spend today and the watchlist for the dashboard', async () => {
    const o = await loadBudgetOverview(today, db);
    // 600 available - 320 spent before today = 280, over 13 days left
    expect(o.safeToSpendToday).toBe(21.54);
    expect(o.leftToday).toBe(-8.46);
    expect(o.spentToday).toBe(45);
    // Week of Monday 2026-11-16: 120 + 30 + 15, transfers excluded
    expect(o.spentThisWeek).toBe(165);
    expect(o.watchlist.map((w) => w.name)).toEqual(['Home', 'Food']);
  });

  it('gives the expense form what is left in one category', async () => {
    expect(await loadBudgetHint(FOOD, '2026-11-20', db)).toEqual({
      month: '2026-11',
      available: 500,
      spent: 270,
      remaining: 230,
    });
    expect(await loadBudgetHint(FUN, '2026-11-20', db)).toBeNull();
  });
});
