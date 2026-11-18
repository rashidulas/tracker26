/**
 * Finds charges (and income) in the history that repeat, so the app can
 * suggest turning them into recurring entries. Suggest only: nothing here
 * writes.
 *
 * A series is at least three transactions (two for yearly) with
 *   - the same merchant (normalised, lib/merchants.ts) and kind,
 *   - amounts within AMOUNT_TOLERANCE of the series' median, and
 *   - each gap within DAY_TOLERANCE days of one interval: 7 days, 14 days,
 *     one calendar month or one calendar year,
 * ending with the most recent matching transaction, and still current (the
 * next charge is not long overdue).
 *
 * Pure and client-safe.
 */
import { addDays, toDayString, type DayString } from '@/lib/dates';
import { normalizeMerchantName, cleanMerchantName } from '@/lib/merchants';
import {
  addMonthsClamped,
  daysBetween,
  firstOnOrAfter,
  FREQUENCY_DAYS,
  nextAfter,
  type Frequency,
} from '@/lib/recurringSchedule';

export const AMOUNT_TOLERANCE = 0.075;
export const DAY_TOLERANCE = 2;

const MIN_OCCURRENCES: Record<Frequency, number> = {
  WEEKLY: 3,
  BIWEEKLY: 3,
  MONTHLY: 3,
  YEARLY: 2,
};

// Checked in this order; the longest run wins, ties go to the shorter interval.
const ORDER: Frequency[] = ['WEEKLY', 'BIWEEKLY', 'MONTHLY', 'YEARLY'];

export type DetectionTransaction = {
  id: string;
  date: Date | DayString;
  amount: number;
  kind: 'INCOME' | 'EXPENSE' | 'TRANSFER';
  merchantOrSource: string | null;
  merchantId?: string | null;
  categoryId: string | null;
  subcategoryId?: string | null;
  accountId: string | null;
  recurringId?: string | null;
  splitItems?: unknown[] | null;
};

export type RecurringSuggestion = {
  /** Stable id for dismissing: kind, merchant, frequency and rounded amount. */
  key: string;
  kind: 'INCOME' | 'EXPENSE';
  merchantName: string;
  merchantId: string | null;
  frequency: Frequency;
  /** The latest amount, which is what the next charge most likely is. */
  amount: number;
  minAmount: number;
  maxAmount: number;
  categoryId: string | null;
  subcategoryId: string | null;
  accountId: string | null;
  firstDate: DayString;
  lastDate: DayString;
  /** Suggested next due day (today or later). */
  nextDueDate: DayString;
  occurrences: number;
  transactionIds: string[];
};

export type ExistingRecurring = {
  kind: string;
  merchantOrSource: string | null;
  amount: number;
  active?: boolean;
};

type Item = {
  id: string;
  day: DayString;
  amount: number;
  tx: DetectionTransaction;
};

const median = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

export const withinAmount = (a: number, b: number, tolerance = AMOUNT_TOLERANCE) =>
  Math.abs(a - b) <= tolerance * Math.max(Math.abs(a), Math.abs(b));

/** Does `next` follow `prev` by one interval, give or take DAY_TOLERANCE days? */
export function gapMatches(
  prev: DayString,
  next: DayString,
  frequency: Frequency,
  dayOfMonth?: number
): boolean {
  const near = (expected: DayString) => Math.abs(daysBetween(expected, next)) <= DAY_TOLERANCE;
  if (frequency === 'WEEKLY') return near(addDays(prev, 7));
  if (frequency === 'BIWEEKLY') return near(addDays(prev, 14));
  const months = frequency === 'MONTHLY' ? 1 : 12;
  if (near(addMonthsClamped(prev, months))) return true;
  // A charge on the 31st lands on the 30th or 28th in short months; from
  // there the next one is back on the series' day, not on the 28th.
  const isMonthEnd = addDays(prev, 1).slice(8, 10) === '01';
  return Boolean(dayOfMonth && isMonthEnd && near(addMonthsClamped(prev, months, dayOfMonth)));
}

/** The longest run of `items` (sorted by day) that ends at the last item. */
function trailingRun(items: Item[], frequency: Frequency): Item[] {
  if (items.length === 0) return [];
  const last = items[items.length - 1];
  const anchorDay = Number(last.day.slice(8, 10));
  const run = [last];
  for (let i = items.length - 2; i >= 0; i -= 1) {
    // Skip a second charge in the same window rather than ending the run.
    const candidate = items[i];
    if (gapMatches(candidate.day, run[0].day, frequency, anchorDay)) {
      run.unshift(candidate);
    } else if (daysBetween(candidate.day, run[0].day) > FREQUENCY_DAYS[frequency] + 31) {
      break;
    }
  }
  return run;
}

function isCurrent(lastDay: DayString, frequency: Frequency, today: DayString) {
  const due = nextAfter(lastDay, frequency, lastDay);
  const grace = Math.max(DAY_TOLERANCE + 1, Math.round(FREQUENCY_DAYS[frequency] / 2));
  return daysBetween(due, today) <= grace;
}

function bestSeries(items: Item[]): { frequency: Frequency; run: Item[] } | null {
  let best: { frequency: Frequency; run: Item[] } | null = null;
  // Seeds newest first: the latest amount is most likely the current price.
  const seeds = [...items].reverse();
  const tried = new Set<number>();
  for (const seed of seeds) {
    const cents = Math.round(seed.amount * 100);
    if (tried.has(cents)) continue;
    tried.add(cents);
    const cluster = items.filter((it) => withinAmount(it.amount, seed.amount));
    // One charge per day at most.
    const perDay: Item[] = [];
    for (const it of cluster) {
      if (perDay.length && perDay[perDay.length - 1].day === it.day) continue;
      perDay.push(it);
    }
    for (const frequency of ORDER) {
      const run = trailingRun(perDay, frequency);
      if (run.length < MIN_OCCURRENCES[frequency]) continue;
      const mid = median(run.map((r) => r.amount));
      if (!run.every((r) => withinAmount(r.amount, mid))) continue;
      if (!best || run.length > best.run.length) best = { frequency, run };
    }
  }
  return best;
}

export function suggestionKey(
  kind: string,
  merchant: string,
  frequency: Frequency,
  amount: number
): string {
  return `${kind}:${normalizeMerchantName(merchant) ?? ''}:${frequency}:${Math.round(amount)}`;
}

export function detectRecurring(
  transactions: DetectionTransaction[],
  options: {
    today: DayString;
    existing?: ExistingRecurring[];
    dismissed?: Iterable<string>;
  }
): RecurringSuggestion[] {
  const dismissed = new Set(options.dismissed ?? []);
  const existing = (options.existing ?? []).filter((e) => e.active !== false);

  const groups = new Map<string, Item[]>();
  for (const tx of transactions) {
    if (tx.kind === 'TRANSFER' || tx.recurringId) continue;
    if (tx.splitItems && tx.splitItems.length > 0) continue;
    if (!(tx.amount > 0)) continue;
    const key = normalizeMerchantName(tx.merchantOrSource);
    if (!key) continue;
    const groupKey = `${tx.kind}:${key}`;
    const list = groups.get(groupKey) ?? [];
    list.push({ id: tx.id, day: toDayString(tx.date), amount: tx.amount, tx });
    groups.set(groupKey, list);
  }

  const suggestions: RecurringSuggestion[] = [];
  for (const items of groups.values()) {
    items.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.id.localeCompare(b.id)));
    let remaining = items;
    // A merchant can have more than one series (two subscriptions at one shop).
    for (let guard = 0; guard < 5 && remaining.length >= 2; guard += 1) {
      const series = bestSeries(remaining);
      if (!series) break;
      const used = new Set(series.run.map((r) => r.id));
      remaining = remaining.filter((r) => !used.has(r.id));

      const { frequency, run } = series;
      const last = run[run.length - 1];
      if (!isCurrent(last.day, frequency, options.today)) continue;

      const tx = last.tx;
      const kind = tx.kind as 'INCOME' | 'EXPENSE';
      const name = cleanMerchantName(tx.merchantOrSource) ?? '';
      const amounts = run.map((r) => r.amount);
      const key = suggestionKey(kind, name, frequency, median(amounts));
      if (dismissed.has(key)) continue;

      const covered = existing.some(
        (e) =>
          e.kind === kind &&
          normalizeMerchantName(e.merchantOrSource) === normalizeMerchantName(name) &&
          withinAmount(e.amount, last.amount)
      );
      if (covered) continue;

      const next = nextAfter(last.day, frequency, last.day);
      suggestions.push({
        key,
        kind,
        merchantName: name,
        merchantId: tx.merchantId ?? null,
        frequency,
        amount: last.amount,
        minAmount: Math.min(...amounts),
        maxAmount: Math.max(...amounts),
        categoryId: tx.categoryId,
        subcategoryId: tx.subcategoryId ?? null,
        accountId: tx.accountId,
        firstDate: run[0].day,
        lastDate: last.day,
        nextDueDate: next >= options.today ? next : firstOnOrAfter(last.day, frequency, options.today),
        occurrences: run.length,
        transactionIds: run.map((r) => r.id),
      });
    }
  }

  return suggestions.sort(
    (a, b) => b.occurrences - a.occurrences || b.amount - a.amount || a.key.localeCompare(b.key)
  );
}
