/**
 * Calendar-day date handling for the whole app.
 *
 * THE RULE
 * --------
 * A transaction date (expense, income, transfer, goal contribution, friend
 * entry, goal due date) is a *calendar day*, not an instant. It is stored as
 * UTC midnight of that day: "2026-11-01" is stored as 2026-11-01T00:00:00.000Z.
 *
 * Every range query builds its bounds in UTC from calendar days, as a
 * half-open interval `{ gte: <UTC midnight of first day>, lt: <UTC midnight of
 * the day after the last day> }`. Never use the server's local time
 * (date-fns startOfMonth/endOfMonth/startOfDay, `new Date(y, m, d)`,
 * `getMonth()`, ...) to build bounds or keys for these dates, and never derive
 * "today" from `toISOString()` (that is the UTC day, which is tomorrow in the
 * evening in US timezones).
 *
 * "Today" is the calendar day in the user's timezone, taken from the
 * APP_TIMEZONE environment variable (an IANA name such as "America/Chicago"),
 * not from the server's or the browser's locale. next.config.ts exposes it to
 * client code as well, so forms and server actions agree on what today is.
 */

/** A calendar day in `YYYY-MM-DD` form. */
export type DayString = string;

/** Half-open UTC range usable directly as a Prisma `date` filter. */
export type DateRange = { gte: Date; lt: Date };

export const DEFAULT_APP_TIMEZONE = 'America/New_York';

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The user's IANA timezone: APP_TIMEZONE if set and valid, else the default. */
export function getAppTimeZone(): string {
  const tz = process.env.APP_TIMEZONE?.trim();
  return tz && isValidTimeZone(tz) ? tz : DEFAULT_APP_TIMEZONE;
}

/** True for a real calendar day in `YYYY-MM-DD` form (rejects 2026-13-45, 2026-02-30). */
export function isValidDay(value: unknown): value is DayString {
  if (typeof value !== 'string') return false;
  const m = DAY_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === mo - 1 &&
    date.getUTCDate() === d
  );
}

/** Parse a `YYYY-MM-DD` day into the stored Date (UTC midnight). Throws on invalid input. */
export function parseDay(day: DayString): Date {
  if (!isValidDay(day)) {
    throw new RangeError(`Invalid calendar day: ${JSON.stringify(day)}`);
  }
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** The calendar day of a stored date (read in UTC), as `YYYY-MM-DD`. */
export function toDayString(date: Date | string): DayString {
  if (typeof date === 'string' && isValidDay(date)) return date;
  const d = typeof date === 'string' ? new Date(date) : date;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Today's calendar day in the user's timezone (APP_TIMEZONE), as `YYYY-MM-DD`. */
export function todayInAppTimeZone(
  now: Date = new Date(),
  timeZone: string = getAppTimeZone()
): DayString {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Today's stored Date (UTC midnight of today in the user's timezone). */
export function todayAsStoredDate(now: Date = new Date()): Date {
  return parseDay(todayInAppTimeZone(now));
}

/** Shift a calendar day by `n` days (negative to go back). */
export function addDays(day: DayString, n: number): DayString {
  return toDayString(new Date(parseDay(day).getTime() + n * MS_PER_DAY));
}

/** First day of the month containing `day`, shifted by `offset` months. */
export function startOfMonthDay(day: DayString, offset = 0): DayString {
  const d = parseDay(day);
  return toDayString(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1)));
}

/** UTC bounds for a single calendar day. */
export function dayRange(day: DayString): DateRange {
  const gte = parseDay(day);
  return { gte, lt: new Date(gte.getTime() + MS_PER_DAY) };
}

/** UTC bounds for the month containing `day`, shifted by `offset` months. */
export function monthRange(day: DayString, offset = 0): DateRange {
  const first = startOfMonthDay(day, offset);
  return { gte: parseDay(first), lt: parseDay(startOfMonthDay(first, 1)) };
}

/** UTC bounds for the last `n` calendar days ending with (and including) `today`. */
export function lastNDaysRange(n: number, today: DayString): DateRange {
  if (!Number.isInteger(n) || n < 1) throw new RangeError(`n must be a positive integer, got ${n}`);
  return { gte: parseDay(addDays(today, -(n - 1))), lt: dayRange(today).lt };
}

/**
 * Prisma `date` filter for an inclusive span of calendar days, either end
 * optional. Accepts day strings or stored Dates (from date inputs).
 * Returns undefined when neither end is given.
 */
export function dayFilter(
  start?: DayString | Date | null,
  end?: DayString | Date | null
): { gte?: Date; lt?: Date } | undefined {
  if (!start && !end) return undefined;
  const filter: { gte?: Date; lt?: Date } = {};
  if (start) filter.gte = parseDay(toDayString(start));
  if (end) filter.lt = dayRange(toDayString(end)).lt;
  return filter;
}

/** Every calendar day from `start` to `end`, inclusive. */
export function eachDay(start: DayString, end: DayString): DayString[] {
  const days: DayString[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
  return days;
}

/** Format a stored date (or day string) for display without timezone shifting. */
export function formatDay(
  date: Date | DayString,
  options: Intl.DateTimeFormatOptions
): string {
  const d = typeof date === 'string' ? parseDay(toDayString(date)) : date;
  return d.toLocaleDateString('en-US', { ...options, timeZone: 'UTC' });
}
