// Shared helpers for the transaction list pages (expenses, income, transfers).
//
// Transaction dates are stored as UTC midnight of the calendar day the user
// picked, so day/month keys are taken from the UTC parts of the date, while
// "today" comes from the user's local clock.

export function dayKey(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toISOString().slice(0, 10);
}

export function monthKey(date: Date | string): string {
  return dayKey(date).slice(0, 7);
}

function localKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function localTodayKey(now: Date = new Date()): string {
  return localKey(now);
}

export function currentMonthKey(now: Date = new Date()): string {
  return localKey(now).slice(0, 7);
}

export function dayLabel(key: string, now: Date = new Date()): string {
  const today = localKey(now);
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (key === today) return 'Today';
  if (key === localKey(y)) return 'Yesterday';

  const d = new Date(`${key}T00:00:00Z`);
  const sameYear = key.slice(0, 4) === today.slice(0, 4);
  return d.toLocaleDateString('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

export interface DayGroup<T> {
  key: string;
  label: string;
  total: number;
  items: T[];
}

/** Groups items (assumed sorted newest first) into calendar days. */
export function groupByDay<T>(
  items: T[],
  getDate: (item: T) => Date | string,
  getAmount: (item: T) => number
): DayGroup<T>[] {
  const now = new Date();
  const groups: DayGroup<T>[] = [];
  const byKey = new Map<string, DayGroup<T>>();
  for (const item of items) {
    const key = dayKey(getDate(item));
    let group = byKey.get(key);
    if (!group) {
      group = { key, label: dayLabel(key, now), total: 0, items: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.items.push(item);
    group.total += getAmount(item);
  }
  return groups.sort((a, b) => b.key.localeCompare(a.key));
}

/** Takes groups until `limit` items have been included (the last group may be partial). */
export function sliceGroups<T>(groups: DayGroup<T>[], limit: number): DayGroup<T>[] {
  const out: DayGroup<T>[] = [];
  let remaining = limit;
  for (const group of groups) {
    if (remaining <= 0) break;
    out.push(
      group.items.length <= remaining ? group : { ...group, items: group.items.slice(0, remaining) }
    );
    remaining -= group.items.length;
  }
  return out;
}

/**
 * Every whitespace-separated term in `query` must match one of `fields`
 * (case-insensitive substring) or, for numeric terms, the amount
 * ("12" matches 12.00–12.99, "$1,200.5" matches 1200.50).
 */
export function matchesSearch(
  query: string,
  fields: Array<string | null | undefined>,
  amount?: number
): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = fields.filter(Boolean).join('\n').toLowerCase();
  const amountText = amount === undefined ? '' : Math.abs(amount).toFixed(2);
  return terms.every((term) => {
    if (haystack.includes(term)) return true;
    if (!amountText) return false;
    const numeric = term.replace(/[$,]/g, '');
    return /^\d+(\.\d{0,2})?$/.test(numeric) && amountText.startsWith(numeric);
  });
}

export function buildMonthOptions(dates: Array<Date | string>, now: Date = new Date()) {
  const keys = new Set<string>([currentMonthKey(now)]);
  for (const d of dates) keys.add(monthKey(d));
  const sorted = Array.from(keys).sort((a, b) => b.localeCompare(a));
  return [
    { value: 'all', label: 'All months' },
    ...sorted.map((key) => ({
      value: key,
      label: new Date(`${key}-01T00:00:00Z`).toLocaleDateString('en-US', {
        timeZone: 'UTC',
        month: 'long',
        year: 'numeric',
      }),
    })),
  ];
}

/** Adds newly created rows to the front, ignoring any already present (e.g. after a refresh). */
export function prependNew<T extends { id: string }>(prev: T[], added: T[]): T[] {
  const seen = new Set(prev.map((x) => x.id));
  return [...added.filter((x) => !seen.has(x.id)), ...prev];
}
