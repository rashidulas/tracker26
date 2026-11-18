/**
 * Short status text for the chips shown while the assistant's read tools run
 * ("Looking at March spending") and after ("Looked at March spending").
 *
 * Built from the tool's input, which may still be incomplete while it
 * streams in, so every field is optional here.
 */
import { addDays, daysInMonth, formatDay, isValidDay, startOfMonthDay, type DayString } from '@/lib/dates';

type Input = Record<string, unknown> | undefined | null;

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** "March", "March 2025", "Mar 3 – Mar 9", "2026" … for an inclusive day range. */
export function describeRange(start: unknown, end: unknown, today: DayString): string | undefined {
  if (!isValidDay(start) || !isValidDay(end) || start > end) return undefined;
  const thisYear = today.slice(0, 4);
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  const year = sameYear && start.slice(0, 4) !== thisYear ? ` ${start.slice(0, 4)}` : '';

  if (start === end) {
    if (start === today) return 'today';
    if (start === addDays(today, -1)) return 'yesterday';
    return `${formatDay(start, { month: 'short', day: 'numeric' })}${year}`;
  }
  const monthEnd = `${start.slice(0, 8)}${String(daysInMonth(start)).padStart(2, '0')}`;
  if (start === startOfMonthDay(start) && end === monthEnd) {
    return `${formatDay(start, { month: 'long' })}${year}`;
  }
  if (sameYear && start.slice(5) === '01-01' && end.slice(5) === '12-31') return start.slice(0, 4);
  if (start === startOfMonthDay(today) && end === today) return 'this month';
  if (start === `${thisYear}-01-01` && end === today) return 'this year';
  const fmt = (d: DayString) =>
    `${formatDay(d, { month: 'short', day: 'numeric' })}${sameYear ? '' : `, ${d.slice(0, 4)}`}`;
  return `${fmt(start)} – ${fmt(end)}${year}`;
}

function monthLabel(month: unknown, today: DayString) {
  const m = str(month);
  if (!m || !/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) return 'this month’s';
  if (m === today.slice(0, 7)) return 'this month’s';
  return `${formatDay(`${m}-01`, { month: 'long' })}${m.slice(0, 4) === today.slice(0, 4) ? '' : ` ${m.slice(0, 4)}`}`;
}

const clip = (s: string) => (s.length > 28 ? `${s.slice(0, 27)}…` : s);

export type ActivityLabel = { running: string; done: string };

const pair = (ing: string, ed: string, rest: string): ActivityLabel => ({
  running: `${ing} ${rest}`,
  done: `${ed} ${rest}`,
});

export function toolActivityLabel(toolName: string, input: Input, today: DayString): ActivityLabel {
  const i = input ?? {};
  switch (toolName) {
    case 'summarizeTransactions': {
      const what = i.kind === 'INCOME' ? 'income' : 'spending';
      const range = describeRange(i.start, i.end, today);
      const merchant = str(i.merchant) ?? str(i.text);
      const at = merchant ? ` at ${clip(merchant)}` : '';
      // "today’s spending", "March spending", "Mar 3 – Mar 9 spending"
      const when = range === 'today' || range === 'yesterday' ? `${range}’s ` : range ? `${range} ` : '';
      return pair('Looking at', 'Looked at', `${when}${what}${at}`);
    }
    case 'comparePeriods': {
      const a = i.periodA as Input;
      const b = i.periodB as Input;
      const la = str(a?.label) ?? describeRange(a?.start, a?.end, today);
      const lb = str(b?.label) ?? describeRange(b?.start, b?.end, today);
      return pair('Comparing', 'Compared', la && lb ? `${clip(la)} with ${clip(lb)}` : 'two periods');
    }
    case 'searchTransactions': {
      const term = str(i.merchant) ?? str(i.text);
      const range = describeRange(i.start, i.end, today);
      const noun = i.kind === 'INCOME' ? 'income' : i.kind === 'TRANSFER' ? 'transfers' : 'transactions';
      return pair(
        'Searching',
        'Searched',
        `${noun}${term ? ` for “${clip(term)}”` : ''}${range ? ` · ${range}` : ''}`
      );
    }
    case 'accountBalances':
      return pair('Checking', 'Checked', 'account balances');
    case 'budgetStatus':
      return pair('Checking', 'Checked', `${monthLabel(i.month, today)} budgets`);
    case 'goalProgress':
      return pair('Checking', 'Checked', 'savings goals');
    case 'friendBalances':
      return pair('Checking', 'Checked', 'friend balances');
    case 'upcomingRecurring': {
      const days = typeof i.days === 'number' ? i.days : 30;
      return pair('Looking for', 'Looked for', `bills in the next ${days} days`);
    }
    default:
      return pair('Looking', 'Looked', 'that up');
  }
}
