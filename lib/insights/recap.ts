/**
 * Weekly and monthly recaps: the figures, computed in code.
 *
 * A weekly recap covers one completed week (Monday to Sunday); a monthly
 * recap one completed calendar month. buildRecap works out every figure; the
 * model only words them (lib/insights/wording.ts), and recapTemplate is the
 * wording used when no model is available.
 *
 * Comparisons need history: "the period before" needs that period to be
 * covered by the data, and "your average" needs four weeks (three months).
 * When there is not enough, the comparison is left out and a note says so.
 *
 * Pure: no database, no clock.
 */
import { monthKeyOf } from '@/lib/budgets';
import { addDays, formatDay, startOfMonthDay, startOfWeekDay, type DayString } from '@/lib/dates';
import { formatCurrency } from '@/lib/utils';
import {
  CREDIT_BANDS,
  FRIEND,
  detectFriendBalances,
  priorWeekStarts,
  spentBetween,
  upcomingMovements,
  type InsightData,
} from './detect';
import type { Fact } from './types';

export type RecapKind = 'weekly' | 'monthly';

export const RECAP = {
  weekly: { minPeriods: 4, maxPeriods: 8, upcomingDays: 7 },
  monthly: { minPeriods: 3, maxPeriods: 6, upcomingDays: 30 },
  /** A category counts as "above usual" from this ratio and this many dollars. */
  aboveUsual: { ratio: 1.25, minDifference: 15 },
} as const;

export type RecapFacts = {
  kind: RecapKind;
  periodStart: DayString;
  periodEnd: DayString;
  /** "Nov 9 – Nov 15" or "October 2026". */
  label: string;
  /** The day the figures were computed (budget status and "coming up" are as of this day). */
  generatedOn: DayString;
  spent: number;
  count: number;
  income: number;
  /** The period before; null when the history does not cover it. */
  previous: { spent: number; change: number; changePct: number | null } | null;
  /** Mean of the earlier periods; null until there is enough history. */
  average: { spent: number; periods: number; change: number; changePct: number | null } | null;
  topCategories: { id: string; name: string; amount: number }[];
  topMerchants: { name: string; amount: number; count: number }[];
  budget: null | {
    /** "November" */
    month: string;
    available: number;
    spent: number;
    remaining: number;
    /** Days left in the month counting the day of generation; 0 for a finished month. */
    daysLeft: number;
    over: { name: string; overBy: number }[];
  };
  upcoming: {
    days: number;
    count: number;
    totalOut: number;
    items: { name: string; amount: number; day: DayString; kind: 'INCOME' | 'EXPENSE' | 'TRANSFER' }[];
  };
  /** One concrete suggestion, chosen and worded in code. */
  suggestion: { kind: string; plain: string };
  /** Plain statements about what could not be compared yet. */
  notes: string[];
};

export type RecapText = { headline: string; summary: string; suggestion: string };

const round2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => formatCurrency(round2(n));
const shortDay = (day: DayString) => formatDay(day, { month: 'short', day: 'numeric' });
const pct = (ratio: number) => `${Math.round(Math.abs(ratio) * 100)}%`;

export function recapKey(kind: RecapKind, periodStart: DayString) {
  return `${kind}:${periodStart}`;
}

/** The most recent completed week or month before `today`. */
export function lastCompletedPeriod(kind: RecapKind, today: DayString): { start: DayString; end: DayString } {
  if (kind === 'weekly') {
    const start = addDays(startOfWeekDay(today), -7);
    return { start, end: addDays(start, 6) };
  }
  const start = startOfMonthDay(today, -1);
  return { start, end: addDays(startOfMonthDay(today), -1) };
}

function periodEnd(kind: RecapKind, start: DayString): DayString {
  return kind === 'weekly' ? addDays(start, 6) : addDays(startOfMonthDay(start, 1), -1);
}

export function recapLabel(kind: RecapKind, start: DayString): string {
  return kind === 'weekly'
    ? `${shortDay(start)} – ${shortDay(addDays(start, 6))}`
    : formatDay(start, { month: 'long', year: 'numeric' });
}

/** Starts of the earlier periods the history fully covers, newest first. */
function priorStarts(data: InsightData, kind: RecapKind, start: DayString): DayString[] {
  if (kind === 'weekly') return priorWeekStarts(data, start);
  const out: DayString[] = [];
  if (!data.firstDay) return out;
  for (let i = 1; i <= RECAP.monthly.maxPeriods; i += 1) {
    const prior = startOfMonthDay(start, -i);
    if (prior < data.firstDay) break;
    out.push(prior);
  }
  return out;
}

function compare(spent: number, base: number) {
  const change = round2(spent - base);
  return { change, changePct: base > 0 ? round2(change / base) : null };
}

function categoryTotals(data: InsightData, start: DayString, end: DayString) {
  const totals = new Map<string, number>();
  for (const e of data.expenses) {
    if (e.day < start || e.day > end) continue;
    for (const share of e.shares) totals.set(share.categoryId, (totals.get(share.categoryId) ?? 0) + share.amount);
  }
  return totals;
}

export function buildRecap(data: InsightData, kind: RecapKind, periodStart: DayString): RecapFacts {
  const end = periodEnd(kind, periodStart);
  const rules = RECAP[kind];
  const periodWord = kind === 'weekly' ? 'week' : 'month';
  const inPeriod = data.expenses.filter((e) => e.day >= periodStart && e.day <= end);
  const spent = spentBetween(data, periodStart, end);
  const notes: string[] = [];

  // ---- comparisons ----
  const prior = priorStarts(data, kind, periodStart);
  const priorSpent = prior.map((start) => spentBetween(data, start, periodEnd(kind, start)));
  const previous = prior.length > 0 ? { spent: priorSpent[0], ...compare(spent, priorSpent[0]) } : null;
  let average: RecapFacts['average'] = null;
  if (prior.length >= rules.minPeriods) {
    const mean = round2(priorSpent.reduce((s, x) => s + x, 0) / prior.length);
    average = { spent: mean, periods: prior.length, ...compare(spent, mean) };
  }
  if (!previous) notes.push(`There is no earlier ${periodWord} of entries to compare this one with yet.`);
  if (!average) {
    notes.push(
      `Not enough history yet to compare with your average: that needs ${rules.minPeriods} full ${periodWord}s before this one, and there ${prior.length === 1 ? 'is' : 'are'} ${prior.length}.`
    );
  }

  // ---- where it went ----
  const byCategory = categoryTotals(data, periodStart, end);
  const topCategories = [...byCategory.entries()]
    .map(([id, amount]) => ({ id, name: data.categories.get(id) ?? 'Unknown', amount: round2(amount) }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 3);
  const merchants = new Map<string, { name: string; amount: number; count: number }>();
  for (const e of inPeriod) {
    if (!e.merchantKey || !e.merchant) continue;
    const entry = merchants.get(e.merchantKey) ?? { name: e.merchant, amount: 0, count: 0 };
    entry.name = e.merchant;
    entry.amount = round2(entry.amount + e.amount);
    entry.count += 1;
    merchants.set(e.merchantKey, entry);
  }
  const topMerchants = [...merchants.values()].sort((a, b) => b.amount - a.amount).slice(0, 3);

  // ---- budgets: the month in progress for a week, the month itself for a month ----
  const budgetMonth = kind === 'weekly' ? monthKeyOf(data.today) : monthKeyOf(periodStart);
  const budgetData = data.budgets.get(budgetMonth);
  const budgeted = budgetData?.rows.filter((r) => r.budget) ?? [];
  const budget: RecapFacts['budget'] =
    budgetData && budgeted.length > 0
      ? {
          month: formatDay(`${budgetMonth}-01`, { month: 'long' }),
          available: budgetData.totals.available,
          spent: budgetData.totals.spentInBudgets,
          remaining: budgetData.totals.remaining,
          daysLeft: budgetData.pacing.isCurrent ? budgetData.pacing.daysLeft : 0,
          over: budgeted
            .filter((r) => r.spent > r.budget!.available)
            .map((r) => ({ name: r.name, overBy: round2(r.spent - r.budget!.available) }))
            .sort((a, b) => b.overBy - a.overBy),
        }
      : null;

  // ---- coming up ----
  const movements = upcomingMovements(data, addDays(data.today, rules.upcomingDays)).filter(
    // A transfer appears once, as the money leaving.
    (m) => m.kind === 'INCOME' || m.amount < 0
  );
  const upcoming: RecapFacts['upcoming'] = {
    days: rules.upcomingDays,
    count: movements.length,
    totalOut: round2(movements.filter((m) => m.kind === 'EXPENSE').reduce((s, m) => s - m.amount, 0)),
    items: movements.slice(0, 5).map((m) => ({ name: m.name, amount: Math.abs(m.amount), day: m.day, kind: m.kind })),
  };

  // ---- one suggestion ----
  const suggestion = pickSuggestion();

  return {
    kind,
    periodStart,
    periodEnd: end,
    label: recapLabel(kind, periodStart),
    generatedOn: data.today,
    spent,
    count: inPeriod.length,
    income: round2(data.income.filter((i) => i.day >= periodStart && i.day <= end).reduce((s, i) => s + i.amount, 0)),
    previous,
    average,
    topCategories,
    topMerchants,
    budget,
    upcoming,
    suggestion,
    notes,
  };

  function pickSuggestion(): RecapFacts['suggestion'] {
    const next = kind === 'weekly' ? 'this week' : 'this month';
    if (budget && budget.over.length > 0) {
      const worst = budget.over[0];
      return {
        kind: 'budget_over',
        plain:
          budget.daysLeft > 0
            ? `${worst.name} is ${money(worst.overBy)} over its ${budget.month} budget with ${budget.daysLeft} day${budget.daysLeft === 1 ? '' : 's'} left. Hold off on it until the month ends, or move ${money(worst.overBy)} from a budget with room.`
            : `${worst.name} ended ${budget.month} ${money(worst.overBy)} over budget. Either raise that budget by ${money(worst.overBy)} or decide what to cut ${next}.`,
      };
    }

    // The category furthest above its own average over the earlier periods.
    if (prior.length >= rules.minPeriods) {
      const usual = new Map<string, number>();
      for (const start of prior) {
        for (const [id, amount] of categoryTotals(data, start, periodEnd(kind, start))) {
          usual.set(id, (usual.get(id) ?? 0) + amount / prior.length);
        }
      }
      const above = [...byCategory.entries()]
        .map(([id, amount]) => ({ id, amount: round2(amount), usual: round2(usual.get(id) ?? 0) }))
        .filter(
          (c) =>
            c.usual > 0 &&
            c.amount >= c.usual * RECAP.aboveUsual.ratio &&
            c.amount - c.usual >= RECAP.aboveUsual.minDifference
        )
        .sort((a, b) => b.amount - b.usual - (a.amount - a.usual))[0];
      if (above) {
        const name = data.categories.get(above.id) ?? 'One category';
        return {
          kind: 'category_above_usual',
          plain: `${name} came to ${money(above.amount)} against a usual ${money(above.usual)} a ${periodWord}. Bringing it back to ${money(above.usual)} ${next} would save ${money(above.amount - above.usual)}.`,
        };
      }
    }

    const card = data.accounts
      .filter((a) => a.type === 'CREDIT_CARD' && a.creditLimit && a.creditLimit > 0)
      .map((a) => ({ name: a.name, owed: Math.max(0, -a.balance), limit: a.creditLimit! }))
      .filter((a) => a.owed / a.limit >= CREDIT_BANDS[0])
      .sort((a, b) => b.owed / b.limit - a.owed / a.limit)[0];
    if (card) {
      const pay = round2(card.owed - card.limit * CREDIT_BANDS[0]);
      return {
        kind: 'card_utilisation',
        plain: `${card.name} is using ${pct(card.owed / card.limit)} of its limit. Paying ${money(pay)} would bring it down to ${pct(CREDIT_BANDS[0])}.`,
      };
    }

    const owed = detectFriendBalances(data)
      .filter((i) => i.numbers.theyOwe === 1)
      .sort((a, b) => b.weight - a.weight)[0];
    if (owed) {
      return { kind: 'friend_balance', plain: `${owed.plain} A good ${periodWord} to ask (it has been over ${FRIEND.openDays} days).` };
    }

    if (budget && budget.daysLeft > 0 && budget.remaining > 0) {
      const perDay = round2(budget.remaining / budget.daysLeft);
      return {
        kind: 'budget_pace',
        plain: `You have ${money(budget.remaining)} left in your ${budget.month} budgets for ${budget.daysLeft} day${budget.daysLeft === 1 ? '' : 's'}: about ${money(perDay)} a day keeps you inside them.`,
      };
    }
    if (!budget && topCategories.length > 0) {
      const top = topCategories[0];
      return {
        kind: 'set_budget',
        plain: `${top.name} was your largest category at ${money(top.amount)}. Setting a budget for it would show its pace through the month.`,
      };
    }
    return {
      kind: 'keep_logging',
      plain: 'Nothing needs attention. Keep entering expenses as they happen so the next recap has more to compare.',
    };
  }
}

// ==================== WORDING IN CODE ====================

/** Every figure of a recap as labelled, formatted facts: what the model may use. */
export function recapFactList(facts: RecapFacts): Fact[] {
  const period = facts.kind === 'weekly' ? 'week' : 'month';
  const out: Fact[] = [
    { label: 'Period', value: facts.label },
    { label: 'Spent', value: money(facts.spent) },
    { label: 'Expenses recorded', value: String(facts.count) },
  ];
  if (facts.income > 0) out.push({ label: 'Income', value: money(facts.income) });
  if (facts.previous) {
    out.push({ label: `Spent the ${period} before`, value: money(facts.previous.spent) });
    out.push({ label: `Change from the ${period} before`, value: signed(facts.previous) });
  }
  if (facts.average) {
    out.push({ label: `Average of the ${facts.average.periods} ${period}s before`, value: money(facts.average.spent) });
    out.push({ label: 'Change from that average', value: signed(facts.average) });
  }
  facts.topCategories.forEach((c, i) => out.push({ label: `Top category ${i + 1}`, value: `${c.name} ${money(c.amount)}` }));
  facts.topMerchants.forEach((m, i) =>
    out.push({ label: `Top merchant ${i + 1}`, value: `${m.name} ${money(m.amount)} (${m.count} purchase${m.count === 1 ? '' : 's'})` })
  );
  if (facts.budget) {
    const b = facts.budget;
    out.push({ label: `${b.month} budgets`, value: `${money(b.spent)} spent of ${money(b.available)}, ${money(b.remaining)} left` });
    if (b.daysLeft > 0) out.push({ label: `Days left in ${b.month}`, value: String(b.daysLeft) });
    b.over.forEach((o) => out.push({ label: 'Over budget', value: `${o.name} by ${money(o.overBy)}` }));
  } else {
    out.push({ label: 'Budgets', value: 'none set' });
  }
  out.push({
    label: `Scheduled in the next ${facts.upcoming.days} days`,
    value: facts.upcoming.count === 0 ? 'nothing' : `${facts.upcoming.count} entries, ${money(facts.upcoming.totalOut)} in expenses`,
  });
  facts.upcoming.items.forEach((item) =>
    out.push({ label: 'Coming up', value: `${item.name} ${money(item.amount)} on ${shortDay(item.day)} (${item.kind.toLowerCase()})` })
  );
  out.push({ label: 'Suggestion', value: facts.suggestion.plain });
  facts.notes.forEach((note) => out.push({ label: 'Note', value: note }));
  return out;
}

function signed(c: { change: number; changePct: number | null }) {
  const direction = c.change > 0 ? 'more' : c.change < 0 ? 'less' : 'the same';
  if (c.change === 0) return direction;
  return `${money(Math.abs(c.change))} ${direction}${c.changePct === null ? '' : ` (${pct(c.changePct)})`}`;
}

/** The recap in plain sentences, built in code. Used when no model is available. */
export function recapTemplate(facts: RecapFacts): RecapText {
  const period = facts.kind === 'weekly' ? 'week' : 'month';
  const title = facts.kind === 'weekly' ? `Week of ${shortDay(facts.periodStart)}` : formatDay(facts.periodStart, { month: 'long' });
  if (facts.count === 0) {
    return {
      headline: `${title}: nothing recorded`,
      summary: `No expenses were entered for ${facts.label}. ${facts.notes.join(' ')}`.trim(),
      suggestion: facts.suggestion.plain,
    };
  }

  const parts: string[] = [];
  if (facts.previous) {
    parts.push(
      facts.previous.change === 0
        ? `You spent ${money(facts.spent)}, the same as the ${period} before.`
        : `You spent ${money(facts.spent)}, ${signed(facts.previous)} than the ${period} before (${money(facts.previous.spent)}).`
    );
  } else {
    parts.push(`You spent ${money(facts.spent)}.`);
  }
  if (facts.average && facts.average.change !== 0) {
    parts.push(
      `Your average over the ${facts.average.periods} ${period}s before is ${money(facts.average.spent)}, so this was ${signed(facts.average)}.`
    );
  }
  if (facts.topCategories.length > 0) {
    parts.push(`Most went to ${facts.topCategories.map((c) => `${c.name} (${money(c.amount)})`).join(', ')}.`);
  }
  if (facts.topMerchants.length > 0) {
    parts.push(`Top merchants: ${facts.topMerchants.map((m) => `${m.name} (${money(m.amount)})`).join(', ')}.`);
  }
  if (facts.budget) {
    const b = facts.budget;
    const over = b.over.length > 0 ? ` ${b.over.length} over: ${b.over.map((o) => `${o.name} by ${money(o.overBy)}`).join(', ')}.` : '';
    parts.push(
      b.daysLeft > 0
        ? `${b.month} budgets: ${money(b.spent)} of ${money(b.available)} used, ${money(b.remaining)} left with ${b.daysLeft} day${b.daysLeft === 1 ? '' : 's'} to go.${over}`
        : `${b.month} budgets: ${money(b.spent)} of ${money(b.available)} used.${over}`
    );
  }
  if (facts.upcoming.count > 0) {
    const first = facts.upcoming.items[0];
    parts.push(
      `Coming up in the next ${facts.upcoming.days} days: ${facts.upcoming.count} scheduled entr${facts.upcoming.count === 1 ? 'y' : 'ies'}, ${money(facts.upcoming.totalOut)} in expenses, starting with ${first.name} (${money(first.amount)}) on ${shortDay(first.day)}.`
    );
  } else {
    parts.push(`Nothing is scheduled in the next ${facts.upcoming.days} days.`);
  }
  parts.push(...facts.notes);

  return {
    headline: `${title}: ${money(facts.spent)} spent`,
    summary: parts.join(' '),
    suggestion: facts.suggestion.plain,
  };
}
