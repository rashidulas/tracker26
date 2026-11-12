import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_APP_TIMEZONE,
  addDays,
  dayFilter,
  dayRange,
  eachDay,
  getAppTimeZone,
  isValidDay,
  lastNDaysRange,
  monthRange,
  parseDay,
  toDayString,
  todayInAppTimeZone,
} from './dates';

const inRange = (d: Date, r: { gte: Date; lt: Date }) => d >= r.gte && d < r.lt;

const originalTZ = process.env.TZ;
const originalAppTZ = process.env.APP_TIMEZONE;
afterEach(() => {
  process.env.TZ = originalTZ;
  if (originalAppTZ === undefined) delete process.env.APP_TIMEZONE;
  else process.env.APP_TIMEZONE = originalAppTZ;
});

describe('parseDay / toDayString', () => {
  it('stores a day as UTC midnight and reads it back', () => {
    const d = parseDay('2026-11-01');
    expect(d.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(toDayString(d)).toBe('2026-11-01');
  });

  it('rejects impossible dates', () => {
    expect(isValidDay('2026-13-45')).toBe(false);
    expect(isValidDay('2026-02-30')).toBe(false);
    expect(isValidDay('2026-1-5')).toBe(false);
    expect(isValidDay('2028-02-29')).toBe(true);
    expect(() => parseDay('2026-13-45')).toThrow(RangeError);
  });
});

describe('month boundary', () => {
  // Whatever timezone the server runs in, a day stored for the 1st belongs to
  // that month and not the previous one.
  for (const tz of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo', 'Pacific/Kiritimati']) {
    it(`counts an expense dated the 1st in its own month (server TZ=${tz})`, () => {
      process.env.TZ = tz;
      const expense = parseDay('2026-11-01');
      expect(inRange(expense, monthRange('2026-11-15'))).toBe(true);
      expect(inRange(expense, monthRange('2026-11-15', -1))).toBe(false);
    });
  }

  it('builds month bounds in UTC, including across a year end', () => {
    const r = monthRange('2026-12-31');
    expect(r.gte.toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(r.lt.toISOString()).toBe('2027-01-01T00:00:00.000Z');
    expect(monthRange('2026-01-10', -1).gte.toISOString()).toBe('2025-12-01T00:00:00.000Z');
    expect(inRange(parseDay('2026-11-30'), monthRange('2026-11-01'))).toBe(true);
    expect(inRange(parseDay('2026-12-01'), monthRange('2026-11-01'))).toBe(false);
  });
});

describe('late-evening entry', () => {
  // 11:30pm on Nov 12 in New York is already Nov 13 in UTC.
  const lateEvening = new Date('2026-11-13T04:30:00Z');

  it("uses the user's calendar day for today, not the UTC day", () => {
    expect(lateEvening.toISOString().slice(0, 10)).toBe('2026-11-13');
    expect(todayInAppTimeZone(lateEvening, 'America/New_York')).toBe('2026-11-12');
  });

  it("counts an entry made late in the evening in today's totals", () => {
    const today = todayInAppTimeZone(lateEvening, 'America/New_York');
    const entry = parseDay(today);
    expect(inRange(entry, dayRange(today))).toBe(true);
    expect(inRange(entry, lastNDaysRange(7, today))).toBe(true);
  });

  it('reads the timezone from APP_TIMEZONE, falling back to the default', () => {
    process.env.APP_TIMEZONE = 'Asia/Tokyo';
    expect(todayInAppTimeZone(lateEvening)).toBe('2026-11-13');
    process.env.APP_TIMEZONE = 'Not/A_Zone';
    expect(getAppTimeZone()).toBe(DEFAULT_APP_TIMEZONE);
    delete process.env.APP_TIMEZONE;
    expect(getAppTimeZone()).toBe(DEFAULT_APP_TIMEZONE);
  });
});

describe('ranges', () => {
  it('covers exactly one day', () => {
    const r = dayRange('2026-11-12');
    expect(r.gte.toISOString()).toBe('2026-11-12T00:00:00.000Z');
    expect(r.lt.toISOString()).toBe('2026-11-13T00:00:00.000Z');
  });

  it('covers the last N days including today', () => {
    const r = lastNDaysRange(30, '2026-03-01');
    expect(toDayString(r.gte)).toBe('2026-01-31');
    expect(toDayString(r.lt)).toBe('2026-03-02');
    expect(() => lastNDaysRange(0, '2026-03-01')).toThrow(RangeError);
  });

  it('turns inclusive day filters into half-open bounds', () => {
    expect(dayFilter()).toBeUndefined();
    const f = dayFilter('2026-11-01', parseDay('2026-11-30'));
    expect(f?.gte?.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(f?.lt?.toISOString()).toBe('2026-12-01T00:00:00.000Z');
  });

  it('steps days across month ends', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(eachDay('2026-10-30', '2026-11-02')).toEqual([
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
    ]);
  });
});
