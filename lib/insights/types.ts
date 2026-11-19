/**
 * Proactive insights: shared types and the tuning constants.
 *
 * Two layers (see lib/insights/detect.ts and lib/insights/wording.ts):
 *   1. Detection, in plain code. Every figure an insight shows is computed
 *      there, together with a plain sentence built from those figures.
 *   2. Wording, by the model. It may rephrase that sentence but can only use
 *      figures the detection layer produced; anything else is thrown away.
 *
 * Pure and safe for client code.
 */
import type { DayString } from '@/lib/dates';

export const INSIGHT_TYPES = [
  'budget_overrun',
  'category_pace',
  'large_transaction',
  'recurring_changed',
  'subscription_missed',
  'bill_coverage',
  'credit_utilisation',
  'friend_balance',
  'good_week',
  'streak',
] as const;

export type InsightType = (typeof INSIGHT_TYPES)[number];

export function isInsightType(value: unknown): value is InsightType {
  return typeof value === 'string' && (INSIGHT_TYPES as readonly string[]).includes(value);
}

/** Names and one-line explanations, for Settings and the mute message. */
export const INSIGHT_TYPE_INFO: Record<InsightType, { label: string; description: string }> = {
  budget_overrun: {
    label: 'Budgets at risk',
    description: 'A budget that is over, or on track to go over, with the projected overshoot.',
  },
  category_pace: {
    label: 'Category pace',
    description: 'A category without a budget running well ahead of its usual pace for this point in the month.',
  },
  large_transaction: {
    label: 'Unusually large purchases',
    description: 'A single expense much larger than usual for its merchant or category.',
  },
  recurring_changed: {
    label: 'Price changes',
    description: 'A recurring charge whose amount changed since last time.',
  },
  subscription_missed: {
    label: 'Missing charges',
    description: 'A recurring charge that has not shown up when it was expected.',
  },
  bill_coverage: {
    label: 'Bills the balance may not cover',
    description: 'An upcoming bill that would take its account below zero.',
  },
  credit_utilisation: {
    label: 'Credit card utilisation',
    description: 'A card using 30% or more of its limit.',
  },
  friend_balance: {
    label: 'Old balances with friends',
    description: 'A balance with a friend that has been open for a month or more.',
  },
  good_week: {
    label: 'Good weeks',
    description: 'A week with notably lower spending than your typical week.',
  },
  streak: {
    label: 'Spending streaks',
    description: 'Several days in a row under your typical daily spending.',
  },
};

export type Severity = 'alert' | 'warning' | 'info' | 'positive';

export const SEVERITY_RANK: Record<Severity, number> = { alert: 0, warning: 1, info: 2, positive: 3 };

/** A labelled figure, already formatted for display ("$182.40", "38%", "Nov 20"). */
export type Fact = { label: string; value: string };

export type DetectedInsight = {
  /** Stable across runs: type, subject and period. Stored once (Insight.key). */
  key: string;
  type: InsightType;
  severity: Severity;
  /** Short heading built in code, e.g. "Dining is over budget". */
  title: string;
  /** The template sentence, built in code from `numbers`. Shown when no model is available. */
  plain: string;
  /** The raw figures behind the insight. */
  numbers: Record<string, number | string>;
  /** The same figures formatted for display; the only figures the model may use. */
  facts: Fact[];
  /** The page that shows what the insight is about, with its filters applied. */
  link: { href: string; label: string };
  /** Sort weight within a severity: roughly the dollars at stake. */
  weight: number;
};

/** A stored insight as the dashboard shows it. */
export type ShownInsight = {
  key: string;
  type: InsightType;
  severity: Severity;
  title: string;
  text: string;
  facts: Fact[];
  link: { href: string; label: string };
  wording: 'template' | 'model';
};

// ==================== TUNING ====================

/** At most this many insights are shown on the dashboard. */
export const MAX_SHOWN = 3;
/** An insight that is not dismissed stops being shown this many days after it was first detected. */
export const SHOW_DAYS = 7;
/** Dismissing an insight mutes its type for this many days. */
export const MUTE_DAYS = 7;
/** Below this many days of history no comparison with "usual" is made at all. */
export const MIN_HISTORY_DAYS = 28;

export type HistoryNote = {
  /** Days from the first recorded transaction to today (0 with no data). */
  days: number;
  /** False until there is enough history for comparisons. */
  enough: boolean;
  /** Plain statement for the page when there is not enough data yet. */
  message: string | null;
};

export function historyNote(firstDay: DayString | null, days: number): HistoryNote {
  if (!firstDay) {
    return { days: 0, enough: false, message: 'No insights yet: there are no transactions to learn from.' };
  }
  if (days < MIN_HISTORY_DAYS) {
    const left = MIN_HISTORY_DAYS - days;
    return {
      days,
      enough: false,
      message: `Not enough history yet to compare your spending with what is usual for you. Comparisons start after about four weeks of entries (${left} more day${left === 1 ? '' : 's'}).`,
    };
  }
  return { days, enough: true, message: null };
}
