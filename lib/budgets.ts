/**
 * Budget calculations. Pure functions, no database access (see
 * lib/budgetData.ts for the loaders), so they can run in tests.
 *
 * WHAT COUNTS AS SPENDING
 * -----------------------
 * Only EXPENSE transactions. Transfers never count, including card payments
 * ("payment" tag) and debt payments ("debt-payment" tag): the purchases they
 * pay off were already counted as expenses when they were made, so counting
 * the payment too would double count. A split expense counts toward each of
 * its split items' categories (lib/transactions.ts expenseCategoryAllocations).
 *
 * MONTHS
 * ------
 * Budgets are keyed by month (`YYYY-MM`) and stored as UTC midnight of the
 * first day of that month, the same convention as transaction dates
 * (lib/dates.ts).
 *
 * ROLLOVER
 * --------
 * A budget with rolloverEnabled carries what is left at the end of its month
 * into the same category's budget the next month: unspent money adds to it,
 * overspend subtracts from it. The carry flows through consecutive months as
 * long as each month has a budget and the month before it had rollover on.
 * A month without a budget for the category breaks the chain.
 */
import { expenseCategoryAllocations } from '@/lib/expenseAllocations';
import {
  daysInMonth,
  isValidDay,
  parseDay,
  startOfMonthDay,
  toDayString,
  type DayString,
} from '@/lib/dates';

/** A month in `YYYY-MM` form. */
export type MonthKey = string;

/** How many months back a rollover chain is followed. */
export const ROLLOVER_LOOKBACK_MONTHS = 24;

/** At or above this share of the budget a category is "near" its limit. */
export const NEAR_LIMIT_RATIO = 0.85;

const round2 = (n: number) => Math.round(n * 100) / 100;

export function isValidMonthKey(value: unknown): value is MonthKey {
  return typeof value === 'string' && /^\d{4}-\d{2}$/.test(value) && isValidDay(`${value}-01`);
}

export function monthKeyOf(date: Date | DayString): MonthKey {
  return toDayString(date).slice(0, 7);
}

/** First calendar day of a month key. */
export function monthFirstDay(key: MonthKey): DayString {
  return `${key}-01`;
}

/** The stored Date a budget for this month is keyed by. */
export function budgetMonthDate(key: MonthKey): Date {
  return parseDay(monthFirstDay(key));
}

export function shiftMonthKey(key: MonthKey, delta: number): MonthKey {
  return monthKeyOf(startOfMonthDay(monthFirstDay(key), delta));
}

// ==================== ROLLOVER ====================

export interface BudgetMonth {
  amount: number;
  rolloverEnabled: boolean;
  spent: number;
}

export interface BudgetMonthResult extends BudgetMonth {
  /** Carried in from the previous month (negative after an overspend). */
  carryIn: number;
  /** amount + carryIn: what can be spent this month. */
  available: number;
  /** available - spent (negative when over). */
  remaining: number;
}

/**
 * Runs a chain of consecutive months (oldest first) for one category. The
 * first month starts with no carry; each later month receives the previous
 * month's remaining amount if the previous month had rollover enabled.
 */
export function computeRolloverChain(chain: BudgetMonth[]): BudgetMonthResult[] {
  const out: BudgetMonthResult[] = [];
  for (const [i, month] of chain.entries()) {
    const prev = out[i - 1];
    const carryIn = prev && prev.rolloverEnabled ? prev.remaining : 0;
    const available = round2(month.amount + carryIn);
    out.push({
      ...month,
      carryIn: round2(carryIn),
      available,
      remaining: round2(available - month.spent),
    });
  }
  return out;
}

/**
 * The budget for one category in `target`, with rollover from earlier months.
 * `budgets` and `spent` are keyed by month. Returns null when the category has
 * no budget in `target`.
 */
export function resolveCategoryBudget(
  target: MonthKey,
  budgets: Map<MonthKey, { amount: number; rolloverEnabled: boolean }>,
  spent: Map<MonthKey, number>,
  lookback: number = ROLLOVER_LOOKBACK_MONTHS
): BudgetMonthResult | null {
  if (!budgets.has(target)) return null;
  const months: MonthKey[] = [target];
  for (let i = 1; i <= lookback; i++) {
    const prev = shiftMonthKey(target, -i);
    const budget = budgets.get(prev);
    if (!budget || !budget.rolloverEnabled) break;
    months.unshift(prev);
  }
  const chain = computeRolloverChain(
    months.map((m) => ({
      amount: budgets.get(m)!.amount,
      rolloverEnabled: budgets.get(m)!.rolloverEnabled,
      spent: spent.get(m) ?? 0,
    }))
  );
  return chain[chain.length - 1];
}

// ==================== SPENDING ====================

export interface SpendingTransaction {
  date: Date;
  amount: number;
  categoryId: string | null;
  splitItems?: { categoryId: string; amount: number }[] | null;
}

export interface SpendingTotals {
  /** month -> category -> amount */
  byMonth: Map<MonthKey, Map<string, number>>;
  /** month -> amount with no category */
  uncategorized: Map<MonthKey, number>;
}

/** Totals EXPENSE transactions by month and category, counting split items. */
export function tallySpending(expenses: SpendingTransaction[]): SpendingTotals {
  const byMonth = new Map<MonthKey, Map<string, number>>();
  const uncategorized = new Map<MonthKey, number>();
  for (const t of expenses) {
    const key = monthKeyOf(t.date);
    const shares = expenseCategoryAllocations(t);
    if (shares.length === 0) {
      uncategorized.set(key, round2((uncategorized.get(key) ?? 0) + t.amount));
      continue;
    }
    let month = byMonth.get(key);
    if (!month) byMonth.set(key, (month = new Map()));
    for (const share of shares) {
      month.set(share.categoryId, round2((month.get(share.categoryId) ?? 0) + share.amount));
    }
  }
  return { byMonth, uncategorized };
}

/** Amount of an expense that belongs to `categoryIds` (all of it when the set is omitted). */
export function spendingIn(t: SpendingTransaction, categoryIds?: Set<string>): number {
  const shares = expenseCategoryAllocations(t);
  if (!categoryIds) return shares.length ? shares.reduce((s, x) => s + x.amount, 0) : t.amount;
  return shares.filter((s) => categoryIds.has(s.categoryId)).reduce((s, x) => s + x.amount, 0);
}

// ==================== PACING ====================

export interface MonthPacing {
  daysInMonth: number;
  /** Days of the month gone, counting today. */
  daysElapsed: number;
  /** Days left, counting today. */
  daysLeft: number;
  /** daysElapsed / daysInMonth, 0..1 */
  fraction: number;
  isCurrent: boolean;
}

/** How far through `month` we are on `today`. Past months are fully elapsed. */
export function monthPacing(month: MonthKey, today: DayString): MonthPacing {
  const total = daysInMonth(monthFirstDay(month));
  const current = monthKeyOf(today);
  let elapsed: number;
  if (month < current) elapsed = total;
  else if (month > current) elapsed = 0;
  else elapsed = Number(today.slice(8, 10));
  return {
    daysInMonth: total,
    daysElapsed: elapsed,
    daysLeft: total - elapsed + (month === current ? 1 : 0),
    fraction: elapsed / total,
    isCurrent: month === current,
  };
}

export type BudgetStatus = 'over' | 'near' | 'ahead' | 'ok';

/**
 * over: spent more than available. near: at NEAR_LIMIT_RATIO or more.
 * ahead: spending faster than the month is passing. ok: otherwise.
 */
export function budgetStatus(spent: number, available: number, paceFraction: number): BudgetStatus {
  if (available <= 0) return spent > 0 || available < 0 ? 'over' : 'ok';
  const used = spent / available;
  if (spent > available) return 'over';
  if (used >= NEAR_LIMIT_RATIO) return 'near';
  if (used > paceFraction + 0.05) return 'ahead';
  return 'ok';
}

/** Share of the budget used, for sorting (over budget sorts highest). */
export function usedRatio(spent: number, available: number): number {
  if (available <= 0) return spent > 0 || available < 0 ? Number.POSITIVE_INFINITY : 0;
  return spent / available;
}

/**
 * What can be spent per day for the rest of the month and stay within budget:
 * what was left at the start of today, spread over the days left (today
 * included). Never negative.
 */
export function safeToSpendPerDay(input: {
  available: number;
  spentBeforeToday: number;
  daysLeft: number;
}): number {
  if (input.daysLeft <= 0) return 0;
  const left = input.available - input.spentBeforeToday;
  return left > 0 ? round2(left / input.daysLeft) : 0;
}
