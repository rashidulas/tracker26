/**
 * Recurring schedules on calendar days (lib/dates.ts rules apply: days are
 * `YYYY-MM-DD`, stored as UTC midnight).
 *
 * A schedule is a frequency plus a start day, the first due date. Occurrence n
 * is always computed from the start day, never from the previous occurrence,
 * so a monthly entry on the 31st is due Jan 31, Feb 28 (29), Mar 31, ... and
 * never drifts to the 28th.
 *
 * Pure and client-safe.
 */
import { addDays, parseDay, toDayString, type DayString } from '@/lib/dates';

export const FREQUENCIES = ['WEEKLY', 'BIWEEKLY', 'MONTHLY', 'YEARLY'] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export const FREQUENCY_LABELS: Record<Frequency, string> = {
  WEEKLY: 'Weekly',
  BIWEEKLY: 'Every two weeks',
  MONTHLY: 'Monthly',
  YEARLY: 'Yearly',
};

/** Nominal length in days, for detection and sorting. */
export const FREQUENCY_DAYS: Record<Frequency, number> = {
  WEEKLY: 7,
  BIWEEKLY: 14,
  MONTHLY: 30,
  YEARLY: 365,
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysInMonth(year: number, monthIndex: number) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/** `day` shifted by `months` calendar months, clamped to the end of short months. */
export function addMonthsClamped(day: DayString, months: number, dayOfMonth?: number): DayString {
  const d = parseDay(day);
  const target = d.getUTCMonth() + months;
  const year = d.getUTCFullYear() + Math.floor(target / 12);
  const month = ((target % 12) + 12) % 12;
  const want = dayOfMonth ?? d.getUTCDate();
  return toDayString(new Date(Date.UTC(year, month, Math.min(want, daysInMonth(year, month)))));
}

/** Whole days from `a` to `b` (negative when b is before a). */
export function daysBetween(a: DayString, b: DayString): number {
  return Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / MS_PER_DAY);
}

/** The n-th due day (n = 0 is the start day). */
export function occurrence(start: DayString, frequency: Frequency, n: number): DayString {
  switch (frequency) {
    case 'WEEKLY':
      return addDays(start, 7 * n);
    case 'BIWEEKLY':
      return addDays(start, 14 * n);
    case 'MONTHLY':
      return addMonthsClamped(start, n);
    case 'YEARLY':
      return addMonthsClamped(start, 12 * n);
  }
}

/** Rough occurrence index of `day`, refined by the callers. */
function estimateIndex(start: DayString, frequency: Frequency, day: DayString): number {
  if (frequency === 'WEEKLY') return Math.floor(daysBetween(start, day) / 7);
  if (frequency === 'BIWEEKLY') return Math.floor(daysBetween(start, day) / 14);
  const s = parseDay(start);
  const d = parseDay(day);
  const months =
    (d.getUTCFullYear() - s.getUTCFullYear()) * 12 + (d.getUTCMonth() - s.getUTCMonth());
  return frequency === 'MONTHLY' ? months : Math.floor(months / 12);
}

/** The first due day on or after `day` (the start day if `day` is earlier). */
export function firstOnOrAfter(start: DayString, frequency: Frequency, day: DayString): DayString {
  if (day <= start) return start;
  let n = Math.max(0, estimateIndex(start, frequency, day));
  while (n > 0 && occurrence(start, frequency, n - 1) >= day) n -= 1;
  while (occurrence(start, frequency, n) < day) n += 1;
  return occurrence(start, frequency, n);
}

/** The first due day strictly after `day`. */
export function nextAfter(start: DayString, frequency: Frequency, day: DayString): DayString {
  return firstOnOrAfter(start, frequency, addDays(day, 1));
}

/**
 * Due days from `from` to `to` (inclusive), starting at the schedule's first
 * day on or after `from`, stopping after `endDate` and after `limit` days.
 */
export function occurrencesBetween(
  start: DayString,
  frequency: Frequency,
  from: DayString,
  to: DayString,
  endDate?: DayString | null,
  limit = 60
): DayString[] {
  const out: DayString[] = [];
  let day = firstOnOrAfter(start, frequency, from);
  while (day <= to && (!endDate || day <= endDate) && out.length < limit) {
    out.push(day);
    day = nextAfter(start, frequency, day);
  }
  return out;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

/** "Monthly on the 1st", "Every two weeks on Friday", "Yearly on Mar 4". */
export function scheduleLabel(frequency: Frequency, start: DayString | Date): string {
  const d = parseDay(toDayString(start));
  switch (frequency) {
    case 'WEEKLY':
      return `Weekly on ${WEEKDAYS[d.getUTCDay()]}`;
    case 'BIWEEKLY':
      return `Every two weeks on ${WEEKDAYS[d.getUTCDay()]}`;
    case 'MONTHLY': {
      const day = d.getUTCDate();
      return day >= 29
        ? `Monthly on the ${ordinal(day)} (or the last day)`
        : `Monthly on the ${ordinal(day)}`;
    }
    case 'YEARLY':
      return `Yearly on ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  }
}
