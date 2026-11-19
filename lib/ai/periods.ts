/**
 * Date phrases → calendar days, in code.
 *
 * Shared by the quick-add parser ("yesterday", "nov 18", "last friday") and
 * the natural-language search ("last month", "this week"). A model never
 * computes a date range: at most it names a period (PeriodSpec) and
 * resolvePeriod below turns it into days, using lib/dates.ts.
 *
 * Pure and safe for client code.
 */
import {
  addDays,
  daysInMonth,
  formatDay,
  isValidDay,
  parseDay,
  startOfMonthDay,
  startOfWeekDay,
  type DayString,
} from '@/lib/dates';

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** 1-12 for "nov", "november", "sept"; null otherwise. */
export function monthNumber(word: string): number | null {
  const w = word.toLowerCase().replace(/\.$/, '');
  if (w.length < 3) return null;
  if (w === 'sept') return 9;
  const index = MONTHS.findIndex((m) => m === w || (w.length === 3 && m.startsWith(w)));
  return index >= 0 ? index + 1 : null;
}

/** 0 (Sunday) - 6 for "fri", "friday", "thurs"; null otherwise. */
export function weekdayNumber(word: string): number | null {
  const w = word.toLowerCase().replace(/\.$/, '');
  if (w.length < 3) return null;
  // "sun" and "sat" are ordinary words too often to count as days.
  const index = WEEKDAYS.findIndex(
    (d) =>
      d === w ||
      (w.length === 3 && w !== 'sun' && w !== 'sat' && d.startsWith(w)) ||
      (w === 'tues' && d === 'tuesday') ||
      (w === 'thurs' && d === 'thursday')
  );
  return index >= 0 ? index : null;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** A real day from its parts, or null (rejects Feb 30). */
export function dayFromParts(year: number, month: number, day: number): DayString | null {
  const value = `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}`;
  return isValidDay(value) ? value : null;
}

/**
 * A month and day with no year: the most recent such day that is not after
 * today ("dec 28" typed on Jan 3 is last year's).
 */
export function mostRecentMonthDay(month: number, day: number, today: DayString): DayString | null {
  const year = Number(today.slice(0, 4));
  const thisYear = dayFromParts(year, month, day);
  if (thisYear && thisYear <= today) return thisYear;
  return dayFromParts(year - 1, month, day) ?? thisYear;
}

/** The most recent `weekday` on or before today; with `strictlyBefore`, before today. */
export function mostRecentWeekday(weekday: number, today: DayString, strictlyBefore = false): DayString {
  const current = parseDay(today).getUTCDay();
  let back = (current - weekday + 7) % 7;
  if (back === 0 && strictlyBefore) back = 7;
  return addDays(today, -back);
}

// ==================== PERIODS ====================

/** A period by name. This is all a model is allowed to say about dates. */
export type PeriodSpec =
  | { type: 'today' }
  | { type: 'yesterday' }
  | { type: 'this'; unit: 'week' | 'month' | 'year' }
  | { type: 'last'; unit: 'week' | 'month' | 'year' }
  /** The last n days / weeks / months, ending today. */
  | { type: 'lastN'; unit: 'day' | 'week' | 'month'; n: number }
  /** A calendar month; without a year, the most recent one that has started. */
  | { type: 'month'; month: number; year?: number | null }
  | { type: 'year'; year: number }
  /** Days the user wrote out themselves. */
  | { type: 'range'; start: DayString; end: DayString };

export type ResolvedPeriod = { start: DayString; end: DayString; label: string };

const monthLabel = (first: DayString, today: DayString) =>
  formatDay(first, first.slice(0, 4) === today.slice(0, 4) ? { month: 'long' } : { month: 'long', year: 'numeric' });

const shortDay = (day: DayString, today: DayString) =>
  formatDay(day, day.slice(0, 4) === today.slice(0, 4) ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });

export function rangeLabel(start: DayString, end: DayString, today: DayString): string {
  if (start === end) return shortDay(start, today);
  if (start === startOfMonthDay(start) && end === addDays(startOfMonthDay(start, 1), -1)) return monthLabel(start, today);
  return `${shortDay(start, today)} – ${shortDay(end, today)}`;
}

/** Turn a named period into inclusive days. Null when the spec makes no sense. */
export function resolvePeriod(spec: PeriodSpec, today: DayString): ResolvedPeriod | null {
  const monthSpan = (first: DayString): ResolvedPeriod => ({
    start: first,
    end: addDays(first, daysInMonth(first) - 1),
    label: monthLabel(first, today),
  });
  const year = Number(today.slice(0, 4));

  switch (spec.type) {
    case 'today':
      return { start: today, end: today, label: 'Today' };
    case 'yesterday': {
      const y = addDays(today, -1);
      return { start: y, end: y, label: 'Yesterday' };
    }
    case 'this':
    case 'last': {
      const back = spec.type === 'last' ? 1 : 0;
      if (spec.unit === 'week') {
        const start = addDays(startOfWeekDay(today), -7 * back);
        return { start, end: addDays(start, 6), label: back ? 'Last week' : 'This week' };
      }
      if (spec.unit === 'month') {
        return { ...monthSpan(startOfMonthDay(today, -back)), label: back ? 'Last month' : 'This month' };
      }
      const y = year - back;
      return { start: `${y}-01-01`, end: `${y}-12-31`, label: back ? 'Last year' : 'This year' };
    }
    case 'lastN': {
      const n = Math.floor(spec.n);
      if (!Number.isFinite(n) || n < 1 || n > 3660) return null;
      if (spec.unit === 'month') {
        if (n > 120) return null;
        // Same day of the month, n months back (clamped to that month's length).
        const first = startOfMonthDay(today, -n);
        const day = Math.min(Number(today.slice(8, 10)), daysInMonth(first));
        const start = addDays(first, day - 1);
        return { start, end: today, label: `Last ${n} month${n === 1 ? '' : 's'}` };
      }
      const days = spec.unit === 'week' ? n * 7 : n;
      return {
        start: addDays(today, -(days - 1)),
        end: today,
        label: `Last ${n} ${spec.unit}${n === 1 ? '' : 's'}`,
      };
    }
    case 'month': {
      if (!Number.isInteger(spec.month) || spec.month < 1 || spec.month > 12) return null;
      let y = spec.year ?? year;
      if (!Number.isInteger(y) || y < 1970 || y > 2200) return null;
      // No year given: the most recent such month that is not in the future.
      if (spec.year == null && `${y}-${pad(spec.month)}-01` > today) y -= 1;
      return monthSpan(`${y}-${pad(spec.month)}-01`);
    }
    case 'year': {
      if (!Number.isInteger(spec.year) || spec.year < 1970 || spec.year > 2200) return null;
      return { start: `${spec.year}-01-01`, end: `${spec.year}-12-31`, label: String(spec.year) };
    }
    case 'range': {
      if (!isValidDay(spec.start) || !isValidDay(spec.end) || spec.start > spec.end) return null;
      return { start: spec.start, end: spec.end, label: rangeLabel(spec.start, spec.end, today) };
    }
    default:
      return null;
  }
}
