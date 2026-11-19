/**
 * Insight detection: plain code, no model.
 *
 * Each detector reads the snapshot (InsightData, loaded by
 * lib/insights/load.ts) and returns candidate insights with the figures
 * behind them. A detector that does not have enough history to make its
 * comparison returns nothing; it never guesses.
 *
 * Spending is "your share" (lib/expenseAllocations.ts), the same figure the
 * budgets and the dashboard use. Recurring charge amounts and account
 * balances use the full amount that left the account.
 *
 * Pure: no database, no clock. `today` comes in with the data.
 */
import { buildAppLink } from '@/lib/assistant/links';
import type { BudgetMonthData } from '@/lib/budgetData';
import { monthKeyOf, shiftMonthKey, type MonthKey } from '@/lib/budgets';
import {
  addDays,
  formatDay,
  startOfMonthDay,
  startOfWeekDay,
  type DayString,
} from '@/lib/dates';
import { normalizeMerchantName } from '@/lib/merchants';
import { detectRecurring } from '@/lib/recurringDetection';
import {
  daysBetween,
  nextAfter,
  occurrencesBetween,
  type Frequency,
} from '@/lib/recurringSchedule';
import { formatCurrency } from '@/lib/utils';
import {
  SEVERITY_RANK,
  historyNote,
  type DetectedInsight,
  type HistoryNote,
  type InsightType,
  type Severity,
} from './types';

// ==================== SNAPSHOT ====================

export type InsightExpense = {
  id: string;
  day: DayString;
  /** Your share of the expense. */
  amount: number;
  /** What left the account (your share plus what friends owe you for it). */
  gross: number;
  /** Null for an expense split over categories. */
  categoryId: string | null;
  /** Your share by category (one entry unless the expense is split). */
  shares: { categoryId: string; amount: number }[];
  merchant: string | null;
  /** Normalised merchant name (lib/merchants.ts), the matching key. */
  merchantKey: string | null;
  recurringId: string | null;
  accountId: string | null;
};

export type InsightRecurring = {
  id: string;
  name: string;
  kind: 'INCOME' | 'EXPENSE' | 'TRANSFER';
  amount: number;
  frequency: Frequency;
  startDate: DayString;
  nextDueDate: DayString;
  endDate: DayString | null;
  autoPost: boolean;
  categoryId: string | null;
  accountId: string;
  toAccountId: string | null;
  merchantOrSource: string | null;
};

export type InsightAccount = {
  id: string;
  name: string;
  type: string;
  /** Current balance; negative on a card or loan means money owed. */
  balance: number;
  creditLimit: number | null;
};

export type InsightFriend = {
  id: string;
  name: string;
  /** Signed from your side: positive = they owe you. Oldest first. */
  entries: { day: DayString; amount: number }[];
};

export type InsightData = {
  today: DayString;
  /** Day of the earliest transaction of any kind; null with no data. */
  firstDay: DayString | null;
  /** Expenses of the last HISTORY_MONTHS months, oldest first. */
  expenses: InsightExpense[];
  income: { day: DayString; amount: number }[];
  /** Category id -> name. */
  categories: Map<string, string>;
  /** Budget figures (lib/budgetData.ts) for this month and last month. */
  budgets: Map<MonthKey, BudgetMonthData>;
  /** Active recurring entries. */
  recurring: InsightRecurring[];
  accounts: InsightAccount[];
  friends: InsightFriend[];
};

/** How many full months of expenses the snapshot carries besides the current one. */
export const HISTORY_MONTHS = 7;

// ==================== THRESHOLDS ====================

export const PACE = { minDay: 5, months: 3, minMonthsWithSpending: 2, ratio: 1.4, minDifference: 25, minUsual: 20 };
export const BUDGET = { minDay: 5, projectedRatio: 1.05, minOvershoot: 10 };
export const LARGE = {
  recentDays: 7,
  minAmount: 20,
  merchant: { days: 180, minCount: 4, ratio: 2.5, minDifference: 20 },
  category: { days: 90, minCount: 8, ratio: 4, minDifference: 50 },
};
export const PRICE_CHANGE = { recentDays: 14, minDifference: 0.5, minRatio: 0.02 };
export const MISSED = { graceDays: 3, matchDaysBefore: 5 };
export const BILL = { horizonDays: 7 };
export const CREDIT_BANDS = [0.3, 0.5, 0.75, 1] as const;
export const FRIEND = { minAmount: 5, openDays: 30, quietDays: 14, buckets: [30, 90] as const };
export const WEEKS = { lookback: 8, minWeeks: 4, goodRatio: 0.7, minTypical: 50, minEntries: 3 };
export const STREAK = { buckets: [5, 10, 20] as const, maxDays: 30 };

// ==================== HELPERS ====================

const round2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => formatCurrency(round2(n));
const percent = (ratio: number) => `${Math.round(ratio * 100)}%`;
const shortDay = (day: DayString) => formatDay(day, { month: 'short', day: 'numeric' });
const monthName = (key: MonthKey) => formatDay(`${key}-01`, { month: 'long' });
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Days from the first recorded transaction to today. */
export function historyDays(data: InsightData): number {
  return data.firstDay ? Math.max(0, daysBetween(data.firstDay, data.today)) : 0;
}

/** Your spending from `start` to `end`, both inclusive. */
export function spentBetween(data: InsightData, start: DayString, end: DayString): number {
  return round2(sum(data.expenses.filter((e) => e.day >= start && e.day <= end).map((e) => e.amount)));
}

/**
 * The completed weeks (Monday to Sunday) before the week starting `weekStart`
 * that the history fully covers, newest first, at most WEEKS.lookback.
 */
export function priorWeekStarts(data: InsightData, weekStart: DayString): DayString[] {
  const out: DayString[] = [];
  if (!data.firstDay) return out;
  for (let i = 1; i <= WEEKS.lookback; i += 1) {
    const start = addDays(weekStart, -7 * i);
    if (start < data.firstDay) break;
    out.push(start);
  }
  return out;
}

function expenseLink(input: { categoryId?: string | null; from?: DayString; to?: DayString; month?: MonthKey }) {
  const link = buildAppLink({ page: 'expenses', ...input });
  return { href: link.href, label: 'See the expenses' };
}

/** Occurrences of a recurring entry from its next due day through `to`. */
function occurrencesThrough(entry: InsightRecurring, to: DayString): DayString[] {
  if (entry.nextDueDate > to) return [];
  return occurrencesBetween(entry.startDate, entry.frequency, entry.nextDueDate, to, entry.endDate, 10);
}

// ==================== BUDGETS ====================

/** A budget that is over, or on track to go over by the end of the month. */
export function detectBudgetOverrun(data: InsightData): DetectedInsight[] {
  const month = monthKeyOf(data.today);
  const budget = data.budgets.get(month);
  if (!budget) return [];
  const { daysElapsed, daysInMonth: total } = budget.pacing;
  const daysAfterToday = total - daysElapsed;
  const monthStart = startOfMonthDay(data.today);
  const monthEnd = addDays(startOfMonthDay(data.today, 1), -1);
  const link = { href: buildAppLink({ page: 'budgets', month }).href, label: 'Open budgets' };

  const out: DetectedInsight[] = [];
  for (const row of budget.rows) {
    if (!row.budget || row.budget.available <= 0) continue;
    const available = row.budget.available;
    const spent = round2(row.spent);

    if (spent > available) {
      const overBy = round2(spent - available);
      out.push({
        key: `budget_overrun:${row.categoryId}:${month}:over`,
        type: 'budget_overrun',
        severity: 'alert',
        title: `${row.name} is over budget`,
        plain: `${row.name} is ${money(overBy)} over its ${money(available)} budget for ${monthName(month)}, with ${daysAfterToday} day${daysAfterToday === 1 ? '' : 's'} left after today.`,
        numbers: { categoryId: row.categoryId, spent, available, overBy, daysLeft: daysAfterToday },
        facts: [
          { label: 'Spent', value: money(spent) },
          { label: 'Budget', value: money(available) },
          { label: 'Over by', value: money(overBy) },
        ],
        link,
        weight: overBy,
      });
      continue;
    }

    if (daysElapsed < BUDGET.minDay || daysAfterToday <= 0) continue;
    // Everyday spending keeps its pace; recurring charges are counted from
    // their schedule instead, so one rent payment is not multiplied out.
    const inCategory = data.expenses.filter((e) => e.day >= monthStart && e.day <= data.today);
    const everyday = sum(
      inCategory
        .filter((e) => !e.recurringId)
        .flatMap((e) => e.shares.filter((s) => s.categoryId === row.categoryId).map((s) => s.amount))
    );
    const scheduled = sum(
      data.recurring
        .filter((r) => r.kind === 'EXPENSE' && r.categoryId === row.categoryId)
        .map((r) => r.amount * occurrencesThrough(r, monthEnd).length)
    );
    const projected = round2(spent + (everyday / daysElapsed) * daysAfterToday + scheduled);
    const overshoot = round2(projected - available);
    if (projected <= available * BUDGET.projectedRatio || overshoot < BUDGET.minOvershoot) continue;
    out.push({
      key: `budget_overrun:${row.categoryId}:${month}:projected`,
      type: 'budget_overrun',
      severity: 'warning',
      title: `${row.name} is on track to go over budget`,
      plain: `${row.name} has used ${money(spent)} of its ${money(available)} budget. At this pace it ends ${monthName(month)} near ${money(projected)}, about ${money(overshoot)} over.`,
      numbers: { categoryId: row.categoryId, spent, available, projected, overshoot, daysLeft: daysAfterToday },
      facts: [
        { label: 'Spent so far', value: money(spent) },
        { label: 'Budget', value: money(available) },
        { label: 'Projected', value: money(projected) },
        { label: 'Projected overshoot', value: money(overshoot) },
      ],
      link,
      weight: overshoot,
    });
  }
  return out;
}

// ==================== CATEGORY PACE ====================

/**
 * A category without a budget whose month-to-date spending is well above what
 * it had reached by the same day in each of the last three months. Budgeted
 * categories are left to detectBudgetOverrun.
 */
export function detectCategoryPace(data: InsightData): DetectedInsight[] {
  const month = monthKeyOf(data.today);
  const dayOfMonth = Number(data.today.slice(8, 10));
  if (dayOfMonth < PACE.minDay || !data.firstDay) return [];
  const earliestNeeded = `${shiftMonthKey(month, -PACE.months)}-01`;
  if (data.firstDay > earliestNeeded) return [];

  const budgeted = new Set(
    (data.budgets.get(month)?.rows ?? []).filter((r) => r.budget).map((r) => r.categoryId)
  );
  // category -> month -> spent through `dayOfMonth`
  const totals = new Map<string, Map<MonthKey, number>>();
  for (const e of data.expenses) {
    if (Number(e.day.slice(8, 10)) > dayOfMonth) continue;
    const key = monthKeyOf(e.day);
    for (const share of e.shares) {
      let byMonth = totals.get(share.categoryId);
      if (!byMonth) totals.set(share.categoryId, (byMonth = new Map()));
      byMonth.set(key, (byMonth.get(key) ?? 0) + share.amount);
    }
  }

  const out: DetectedInsight[] = [];
  for (const [categoryId, byMonth] of totals) {
    if (budgeted.has(categoryId)) continue;
    const name = data.categories.get(categoryId);
    if (!name) continue;
    const prior = Array.from({ length: PACE.months }, (_, i) => byMonth.get(shiftMonthKey(month, -(i + 1))) ?? 0);
    if (prior.filter((x) => x > 0).length < PACE.minMonthsWithSpending) continue;
    const usual = round2(sum(prior) / PACE.months);
    const spent = round2(byMonth.get(month) ?? 0);
    const difference = round2(spent - usual);
    if (usual < PACE.minUsual || spent < usual * PACE.ratio || difference < PACE.minDifference) continue;
    const above = spent / usual - 1;
    out.push({
      key: `category_pace:${categoryId}:${month}`,
      type: 'category_pace',
      severity: 'warning',
      title: `${name} is running ahead of its usual pace`,
      plain: `${name} is at ${money(spent)} so far in ${monthName(month)}. By day ${dayOfMonth} of the last ${PACE.months} months it was usually around ${money(usual)}, so this is ${percent(above)} higher.`,
      numbers: { categoryId, spent, usual, difference, above: round2(above), dayOfMonth },
      facts: [
        { label: 'This month so far', value: money(spent) },
        { label: `Usual by day ${dayOfMonth}`, value: money(usual) },
        { label: 'Above usual', value: `${money(difference)} (${percent(above)})` },
      ],
      link: expenseLink({ categoryId, month }),
      weight: difference,
    });
  }
  return out.sort((a, b) => b.weight - a.weight).slice(0, 2);
}

// ==================== LARGE TRANSACTION ====================

/** A recent expense far above the usual amount at its merchant, or else in its category. */
export function detectLargeTransactions(data: InsightData): DetectedInsight[] {
  const since = addDays(data.today, -(LARGE.recentDays - 1));
  const out: DetectedInsight[] = [];
  for (const e of data.expenses) {
    if (e.day < since || e.day > data.today || e.recurringId || e.amount < LARGE.minAmount) continue;

    const before = (days: number) =>
      data.expenses.filter((o) => o.id !== e.id && o.day < e.day && o.day >= addDays(e.day, -days));
    let basis: 'merchant' | 'category' | null = null;
    let typical = 0;
    let count = 0;

    if (e.merchantKey) {
      const same = before(LARGE.merchant.days).filter((o) => o.merchantKey === e.merchantKey);
      const mid = median(same.map((o) => o.amount));
      if (
        same.length >= LARGE.merchant.minCount &&
        e.amount >= mid * LARGE.merchant.ratio &&
        e.amount - mid >= LARGE.merchant.minDifference
      ) {
        basis = 'merchant';
        typical = mid;
        count = same.length;
      }
    }
    if (!basis && e.categoryId) {
      const same = before(LARGE.category.days).filter((o) => o.categoryId === e.categoryId && !o.recurringId);
      const mid = median(same.map((o) => o.amount));
      if (
        same.length >= LARGE.category.minCount &&
        e.amount >= mid * LARGE.category.ratio &&
        e.amount - mid >= LARGE.category.minDifference
      ) {
        basis = 'category';
        typical = mid;
        count = same.length;
      }
    }
    if (!basis) continue;

    const category = e.categoryId ? data.categories.get(e.categoryId) ?? null : null;
    const where = basis === 'merchant' ? e.merchant! : category!;
    const what = e.merchant ?? category ?? 'An expense';
    const times = Math.round((e.amount / typical) * 10) / 10;
    out.push({
      key: `large_transaction:${e.id}`,
      type: 'large_transaction',
      severity: 'info',
      title: `Larger than usual: ${what}`,
      plain: `${money(e.amount)} at ${what} on ${shortDay(e.day)} is about ${times} times your usual ${money(typical)} ${basis === 'merchant' ? `at ${where}` : `for ${where}`} (from your last ${count} there).`,
      numbers: { transactionId: e.id, amount: round2(e.amount), typical: round2(typical), times, basis, count },
      facts: [
        { label: 'Amount', value: money(e.amount) },
        { label: `Usual ${basis === 'merchant' ? 'at this merchant' : 'in this category'}`, value: money(typical) },
        { label: 'Date', value: shortDay(e.day) },
      ],
      link: expenseLink({ categoryId: e.categoryId, from: e.day, to: e.day }),
      weight: e.amount - typical,
    });
  }
  return out.sort((a, b) => b.weight - a.weight).slice(0, 2);
}

// ==================== RECURRING CHARGES ====================

/** Repeating expense series that are not set up as recurring entries. */
function detectedSeries(data: InsightData) {
  return detectRecurring(
    data.expenses.map((e) => ({
      id: e.id,
      date: e.day,
      amount: e.gross,
      kind: 'EXPENSE' as const,
      merchantOrSource: e.merchant,
      categoryId: e.categoryId,
      accountId: e.accountId,
      recurringId: e.recurringId,
      splitItems: e.categoryId === null && e.shares.length > 0 ? e.shares : null,
    })),
    {
      today: data.today,
      existing: data.recurring.map((r) => ({ kind: r.kind, merchantOrSource: r.merchantOrSource, amount: r.amount })),
    }
  ).filter((s) => s.kind === 'EXPENSE');
}

function isPriceChange(previous: number, latest: number) {
  const diff = Math.abs(latest - previous);
  return diff >= Math.max(PRICE_CHANGE.minDifference, previous * PRICE_CHANGE.minRatio);
}

/** A recurring charge whose latest amount differs from the one before it. */
export function detectRecurringChanged(data: InsightData): DetectedInsight[] {
  const since = addDays(data.today, -PRICE_CHANGE.recentDays);
  const out: DetectedInsight[] = [];
  const add = (subject: string, name: string, previous: number, latest: InsightExpense) => {
    if (latest.day < since || !isPriceChange(previous, latest.gross)) return;
    const difference = round2(latest.gross - previous);
    const up = difference > 0;
    const change = Math.abs(difference) / previous;
    out.push({
      key: `recurring_changed:${subject}:${latest.day}`,
      type: 'recurring_changed',
      severity: up ? 'warning' : 'info',
      title: `${name} ${up ? 'went up' : 'went down'}`,
      plain: `${name} charged ${money(latest.gross)} on ${shortDay(latest.day)}, ${up ? 'up' : 'down'} from ${money(previous)}: ${money(Math.abs(difference))} ${up ? 'more' : 'less'} each time (${percent(change)}).`,
      numbers: { previous: round2(previous), latest: round2(latest.gross), difference, change: round2(change), day: latest.day },
      facts: [
        { label: 'New amount', value: money(latest.gross) },
        { label: 'Previous amount', value: money(previous) },
        { label: 'Change', value: `${up ? '+' : '-'}${money(Math.abs(difference))} (${percent(change)})` },
        { label: 'Charged on', value: shortDay(latest.day) },
      ],
      link: { href: buildAppLink({ page: 'recurring' }).href, label: 'Open recurring' },
      weight: Math.abs(difference),
    });
  };

  // Entries the user set up: the charges posted from them, plus charges at
  // the same merchant that were logged by hand.
  for (const r of data.recurring) {
    if (r.kind !== 'EXPENSE') continue;
    const merchantKey = normalizeMerchantName(r.merchantOrSource ?? r.name);
    const charges = data.expenses.filter(
      (e) => e.recurringId === r.id || (!e.recurringId && merchantKey !== null && e.merchantKey === merchantKey)
    );
    const latest = charges[charges.length - 1];
    if (!latest) continue;
    const previous = charges.length >= 2 ? charges[charges.length - 2].gross : r.amount;
    add(r.id, r.name, previous, latest);
  }

  // Series found in the history that are not set up as entries.
  for (const s of detectedSeries(data)) {
    const key = normalizeMerchantName(s.merchantName);
    if (!key) continue;
    const later = data.expenses.filter((e) => e.merchantKey === key && !e.recurringId && e.day > s.lastDate);
    if (later.length > 0) {
      // The new price fell outside the series' tolerance, so it is not part of it.
      add(key, s.merchantName, s.amount, later[later.length - 1]);
      continue;
    }
    const run = s.transactionIds
      .map((id) => data.expenses.find((e) => e.id === id))
      .filter((e): e is InsightExpense => Boolean(e));
    if (run.length >= 2) add(key, s.merchantName, run[run.length - 2].gross, run[run.length - 1]);
  }
  return out;
}

/** A recurring charge that was expected by now and has not been recorded. */
export function detectSubscriptionMissed(data: InsightData): DetectedInsight[] {
  const out: DetectedInsight[] = [];
  const cutoff = addDays(data.today, -MISSED.graceDays);
  const add = (subject: string, name: string, amount: number, expected: DayString, setUp: boolean) => {
    const daysLate = daysBetween(expected, data.today);
    out.push({
      key: `subscription_missed:${subject}:${expected}`,
      type: 'subscription_missed',
      severity: 'info',
      title: `${name} has not been charged`,
      plain: `${name} (${money(amount)}) was expected on ${shortDay(expected)}, ${daysLate} days ago, and no charge has been recorded. It may have been cancelled, or it has not been entered yet.`,
      numbers: { amount: round2(amount), expected, daysLate },
      facts: [
        { label: 'Usual amount', value: money(amount) },
        { label: 'Expected on', value: shortDay(expected) },
        { label: 'Days late', value: String(daysLate) },
      ],
      link: {
        href: buildAppLink({ page: 'recurring' }).href,
        label: setUp ? 'Open recurring' : 'Review recurring charges',
      },
      weight: amount,
    });
  };

  for (const r of data.recurring) {
    if (r.kind !== 'EXPENSE' || r.nextDueDate > cutoff) continue;
    const merchantKey = normalizeMerchantName(r.merchantOrSource ?? r.name);
    // Logged by hand instead of posted from the entry: not missing.
    const logged = data.expenses.some(
      (e) =>
        e.day >= addDays(r.nextDueDate, -MISSED.matchDaysBefore) &&
        (e.recurringId === r.id || (merchantKey !== null && e.merchantKey === merchantKey))
    );
    if (!logged) add(r.id, r.name, r.amount, r.nextDueDate, true);
  }

  for (const s of detectedSeries(data)) {
    const key = normalizeMerchantName(s.merchantName);
    if (!key) continue;
    const expected = nextAfter(s.lastDate, s.frequency, s.lastDate);
    if (expected > cutoff) continue;
    if (data.expenses.some((e) => e.merchantKey === key && e.day > s.lastDate)) continue;
    add(key, s.merchantName, s.amount, expected, false);
  }
  return out;
}

// ==================== BILLS AND BALANCES ====================

/** What recurring entries will move in or out of accounts through `horizon`. */
export function upcomingMovements(data: InsightData, horizon: DayString) {
  const events: Array<{
    day: DayString;
    accountId: string;
    amount: number;
    name: string;
    recurringId: string;
    kind: InsightRecurring['kind'];
  }> = [];
  for (const r of data.recurring) {
    for (const day of occurrencesThrough(r, horizon)) {
      const base = { day, name: r.name, recurringId: r.id, kind: r.kind };
      if (r.kind === 'INCOME') events.push({ ...base, accountId: r.accountId, amount: r.amount });
      else events.push({ ...base, accountId: r.accountId, amount: -r.amount });
      if (r.kind === 'TRANSFER' && r.toAccountId) {
        events.push({ ...base, accountId: r.toAccountId, amount: r.amount });
      }
    }
  }
  // Money arriving on a day is counted before money leaving on it.
  return events.sort((a, b) => (a.day !== b.day ? (a.day < b.day ? -1 : 1) : b.amount - a.amount));
}

/** An upcoming bill that would take its cash account below zero. */
export function detectBillCoverage(data: InsightData): DetectedInsight[] {
  const horizon = addDays(data.today, BILL.horizonDays);
  const events = upcomingMovements(data, horizon);
  const out: DetectedInsight[] = [];
  for (const account of data.accounts) {
    if (!['CHECKING', 'SAVINGS', 'CASH'].includes(account.type)) continue;
    let running = account.balance;
    for (const event of events.filter((e) => e.accountId === account.id)) {
      running += event.amount;
      if (event.amount >= 0 || running >= 0) continue;
      const bill = -event.amount;
      const shortfall = round2(-running);
      const due = event.day < data.today ? data.today : event.day;
      out.push({
        key: `bill_coverage:${event.recurringId}:${event.day}`,
        type: 'bill_coverage',
        severity: 'alert',
        title: `${account.name} may not cover ${event.name}`,
        plain: `${event.name} (${money(bill)}) is due ${event.day < data.today ? 'now' : `on ${shortDay(due)}`} from ${account.name}, which holds ${money(account.balance)}. After the other scheduled entries before it, that leaves it about ${money(shortfall)} short.`,
        numbers: { accountId: account.id, bill: round2(bill), balance: round2(account.balance), shortfall, due: event.day },
        facts: [
          { label: 'Bill', value: money(bill) },
          { label: 'Due', value: shortDay(due) },
          { label: `${account.name} balance`, value: money(account.balance) },
          { label: 'Short by', value: money(shortfall) },
        ],
        link: { href: buildAppLink({ page: 'accounts' }).href, label: 'Open accounts' },
        weight: shortfall,
      });
      break;
    }
  }
  return out;
}

/** A credit card using 30% or more of its limit. */
export function detectCreditUtilisation(data: InsightData): DetectedInsight[] {
  const month = monthKeyOf(data.today);
  const out: DetectedInsight[] = [];
  for (const account of data.accounts) {
    if (account.type !== 'CREDIT_CARD' || !account.creditLimit || account.creditLimit <= 0) continue;
    const owed = round2(Math.max(0, -account.balance));
    const used = owed / account.creditLimit;
    const band = [...CREDIT_BANDS].reverse().find((b) => used >= b);
    if (!band) continue;
    const target = CREDIT_BANDS[0];
    const toTarget = round2(owed - account.creditLimit * target);
    const severity: Severity = band >= 0.75 ? 'alert' : band >= 0.5 ? 'warning' : 'info';
    out.push({
      // A new key when the card climbs into a higher band, or in a new month.
      key: `credit_utilisation:${account.id}:${month}:${Math.round(band * 100)}`,
      type: 'credit_utilisation',
      severity,
      title: `${account.name} is at ${percent(used)} of its limit`,
      plain: `${account.name} owes ${money(owed)} of a ${money(account.creditLimit)} limit (${percent(used)}).${toTarget > 0 ? ` Paying ${money(toTarget)} would bring it to ${percent(target)}.` : ''}`,
      numbers: { accountId: account.id, owed, limit: account.creditLimit, used: round2(used), toTarget },
      facts: [
        { label: 'Owed', value: money(owed) },
        { label: 'Limit', value: money(account.creditLimit) },
        { label: 'Used', value: percent(used) },
        ...(toTarget > 0 ? [{ label: `To reach ${percent(target)}`, value: money(toTarget) }] : []),
      ],
      link: { href: buildAppLink({ page: 'accounts' }).href, label: 'Open accounts' },
      weight: owed,
    });
  }
  return out;
}

// ==================== FRIENDS ====================

/** A balance with a friend that has been open for a month or more with no recent activity. */
export function detectFriendBalances(data: InsightData): DetectedInsight[] {
  const out: DetectedInsight[] = [];
  for (const friend of data.friends) {
    let balance = 0;
    let openSince: DayString | null = null;
    let last: DayString | null = null;
    for (const entry of friend.entries) {
      const wasOpen = Math.abs(balance) >= 0.005;
      balance += entry.amount;
      const isOpen = Math.abs(balance) >= 0.005;
      if (!isOpen) openSince = null;
      else if (!wasOpen) openSince = entry.day;
      last = entry.day;
    }
    if (!openSince || !last || Math.abs(balance) < FRIEND.minAmount) continue;
    const openDays = daysBetween(openSince, data.today);
    if (openDays < FRIEND.openDays || daysBetween(last, data.today) < FRIEND.quietDays) continue;
    const bucket = [...FRIEND.buckets].reverse().find((b) => openDays >= b)!;
    const amount = round2(Math.abs(balance));
    const theyOwe = balance > 0;
    out.push({
      key: `friend_balance:${friend.id}:${openSince}:${bucket}`,
      type: 'friend_balance',
      severity: 'info',
      title: theyOwe ? `${friend.name} still owes you` : `You still owe ${friend.name}`,
      plain: theyOwe
        ? `${friend.name} has owed you ${money(amount)} since ${shortDay(openSince)}, ${openDays} days ago.`
        : `You have owed ${friend.name} ${money(amount)} since ${shortDay(openSince)}, ${openDays} days ago.`,
      numbers: { friendId: friend.id, amount, openDays, since: openSince, theyOwe: theyOwe ? 1 : 0 },
      facts: [
        { label: theyOwe ? 'They owe you' : 'You owe them', value: money(amount) },
        { label: 'Open since', value: shortDay(openSince) },
        { label: 'Days open', value: String(openDays) },
      ],
      link: { href: buildAppLink({ page: 'friends' }).href, label: 'Open friends' },
      weight: amount,
    });
  }
  return out;
}

// ==================== GOOD WEEK, STREAK ====================

/** Last week (Monday to Sunday) well under the median of the weeks before it. */
export function detectGoodWeek(data: InsightData): DetectedInsight[] {
  const weekStart = addDays(startOfWeekDay(data.today), -7);
  const weekEnd = addDays(weekStart, 6);
  const prior = priorWeekStarts(data, weekStart);
  if (prior.length < WEEKS.minWeeks) return [];
  const typical = round2(median(prior.map((start) => spentBetween(data, start, addDays(start, 6)))));
  const spent = spentBetween(data, weekStart, weekEnd);
  const entries = data.expenses.filter((e) => e.day >= weekStart && e.day <= weekEnd).length;
  // A week with almost nothing entered is more likely unlogged than frugal.
  if (entries < WEEKS.minEntries || typical < WEEKS.minTypical || spent > typical * WEEKS.goodRatio) return [];
  const saved = round2(typical - spent);
  const below = 1 - spent / typical;
  return [
    {
      key: `good_week:${weekStart}`,
      type: 'good_week',
      severity: 'positive',
      title: 'A notably good week',
      plain: `Last week (${shortDay(weekStart)} to ${shortDay(weekEnd)}) you spent ${money(spent)}, ${percent(below)} below your typical week of ${money(typical)}. That is ${money(saved)} less than usual.`,
      numbers: { spent, typical, saved, below: round2(below), weekStart, weeks: prior.length },
      facts: [
        { label: 'Last week', value: money(spent) },
        { label: `Typical week (last ${prior.length})`, value: money(typical) },
        { label: 'Below typical', value: `${money(saved)} (${percent(below)})` },
      ],
      link: expenseLink({ from: weekStart, to: weekEnd }),
      weight: saved,
    },
  ];
}

/** Several days in a row, ending yesterday, each under the typical daily spend. */
export function detectStreak(data: InsightData): DetectedInsight[] {
  const thisWeek = startOfWeekDay(data.today);
  const prior = priorWeekStarts(data, thisWeek);
  if (prior.length < WEEKS.minWeeks) return [];
  const typicalDay = round2(median(prior.map((start) => spentBetween(data, start, addDays(start, 6)))) / 7);
  if (typicalDay * 7 < WEEKS.minTypical) return [];

  const byDay = new Map<DayString, number>();
  for (const e of data.expenses) byDay.set(e.day, (byDay.get(e.day) ?? 0) + e.amount);

  let length = 0;
  let logged = 0;
  let total = 0;
  for (let day = addDays(data.today, -1); length < STREAK.maxDays; day = addDays(day, -1)) {
    const spent = byDay.get(day) ?? 0;
    if (spent >= typicalDay || (data.firstDay && day < data.firstDay)) break;
    length += 1;
    total += spent;
    if (byDay.has(day)) logged += 1;
  }
  const bucket = [...STREAK.buckets].reverse().find((b) => length >= b);
  // Days with nothing entered count, but not when they are most of the streak.
  if (!bucket || logged * 2 < length) return [];
  const start = addDays(data.today, -length);
  const average = round2(total / length);
  return [
    {
      key: `streak:${start}:${bucket}`,
      type: 'streak',
      severity: 'positive',
      title: `${length} days in a row under your usual`,
      plain: `You have spent less than your typical ${money(typicalDay)} a day for ${length} days running (since ${shortDay(start)}), averaging ${money(average)} a day.`,
      numbers: { length, typicalDay, average, start },
      facts: [
        { label: 'Days in a row', value: String(length) },
        { label: 'Typical day', value: money(typicalDay) },
        { label: 'Average these days', value: money(average) },
      ],
      link: expenseLink({ from: start, to: addDays(data.today, -1) }),
      weight: (typicalDay - average) * length,
    },
  ];
}

// ==================== ALL ====================

export const DETECTORS: Record<InsightType, (data: InsightData) => DetectedInsight[]> = {
  budget_overrun: detectBudgetOverrun,
  category_pace: detectCategoryPace,
  large_transaction: detectLargeTransactions,
  recurring_changed: detectRecurringChanged,
  subscription_missed: detectSubscriptionMissed,
  bill_coverage: detectBillCoverage,
  credit_utilisation: detectCreditUtilisation,
  friend_balance: detectFriendBalances,
  good_week: detectGoodWeek,
  streak: detectStreak,
};

export function rankInsights<T extends { severity: Severity; weight?: number; key: string }>(insights: T[]): T[] {
  return [...insights].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      (b.weight ?? 0) - (a.weight ?? 0) ||
      a.key.localeCompare(b.key)
  );
}

/** Every candidate insight, most important first, plus what the history allows. */
export function detectInsights(
  data: InsightData,
  options: { disabled?: Iterable<string> } = {}
): { insights: DetectedInsight[]; history: HistoryNote } {
  const disabled = new Set(options.disabled ?? []);
  const found: DetectedInsight[] = [];
  for (const [type, detector] of Object.entries(DETECTORS) as [InsightType, (d: InsightData) => DetectedInsight[]][]) {
    if (!disabled.has(type)) found.push(...detector(data));
  }
  // A streak says the same thing as a good week; keep the week.
  const insights = found.some((i) => i.type === 'good_week') ? found.filter((i) => i.type !== 'streak') : found;
  return { insights: rankInsights(insights), history: historyNote(data.firstDay, historyDays(data)) };
}
