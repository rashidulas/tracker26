/**
 * Proactive insights (prompt 14):
 *   - every detector against hand-built data, each with a case that has too
 *     little history (or no trigger) and must produce nothing
 *   - the wording layer: the number check and the no-model template fallback
 *   - the daily check against the in-memory database: storing by key,
 *     dismissing and muting, switching a type off, the history note
 *   - recaps: figures worked out by hand, and idempotent generation (two
 *     concurrent runs, one stored recap, one model call)
 *
 * No network: models are MockLanguageModelV4 with scripted answers.
 * TODAY is Tuesday 2026-11-17; "last week" is Mon 2026-11-09 to Sun 2026-11-15.
 */
import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import { MockLanguageModelV4 } from 'ai/test';

import { monthPacing } from '../lib/budgets';
import type { BudgetMonthData, BudgetRow } from '../lib/budgetData';
import { addDays, parseDay } from '../lib/dates';
import {
  detectBillCoverage,
  detectBudgetOverrun,
  detectCategoryPace,
  detectCreditUtilisation,
  detectFriendBalances,
  detectGoodWeek,
  detectInsights,
  detectLargeTransactions,
  detectRecurringChanged,
  detectStreak,
  detectSubscriptionMissed,
  type InsightData,
  type InsightExpense,
  type InsightRecurring,
} from '../lib/insights/detect';
import { loadInsightData } from '../lib/insights/load';
import { buildRecap, lastCompletedPeriod, recapKey, recapTemplate } from '../lib/insights/recap';
import {
  STALE_RUN_MS,
  dismissInsight,
  getRecap,
  listRecaps,
  loadDashboardRecaps,
  loadInsightPreferences,
  loadInsightStrip,
  regenerateRecap,
  runInsightsCheck,
  setInsightTypeEnabled,
  unmuteInsightType,
} from '../lib/insights/store';
import { INSIGHT_TYPES, MAX_SHOWN, MUTE_DAYS, type DetectedInsight } from '../lib/insights/types';
import { acceptText, numbersIn, usesOnlyKnownNumbers, writeWording } from '../lib/insights/wording';
import { contextSection, contextTitle, parseAskContext } from '../lib/assistant/context';
import { seedAssistantData, TODAY } from './support/assistantSeed';
import { FakeDb } from './support/fakeDb';

// ==================== BUILDERS ====================

let nextId = 0;
function exp(day: string, amount: number, over: Partial<InsightExpense> = {}): InsightExpense {
  nextId += 1;
  const categoryId = over.categoryId === undefined ? 'cat-misc' : over.categoryId;
  const merchant = over.merchant ?? null;
  return {
    id: `e${nextId}`,
    day,
    amount,
    gross: amount,
    categoryId,
    shares: categoryId ? [{ categoryId, amount }] : [],
    merchant,
    merchantKey: merchant ? merchant.toLowerCase() : null,
    recurringId: null,
    accountId: 'acc-checking',
    ...over,
  };
}

function recurring(over: Partial<InsightRecurring> & { name: string; amount: number; nextDueDate: string }): InsightRecurring {
  return {
    id: `r-${over.name}`,
    kind: 'EXPENSE',
    frequency: 'MONTHLY',
    startDate: over.nextDueDate,
    endDate: null,
    autoPost: false,
    categoryId: null,
    accountId: 'acc-checking',
    toAccountId: null,
    merchantOrSource: over.name,
    ...over,
  };
}

function budgetMonth(rows: Array<{ id: string; name: string; available: number; spent: number }>, today = TODAY): BudgetMonthData {
  const month = today.slice(0, 7);
  const budgetRows: BudgetRow[] = rows.map((r) => ({
    categoryId: r.id,
    name: r.name,
    icon: null,
    color: '#000',
    spent: r.spent,
    budget: {
      amount: r.available,
      rolloverEnabled: false,
      carryIn: 0,
      available: r.available,
      remaining: r.available - r.spent,
      status: r.spent > r.available ? 'over' : 'ok',
      used: r.spent / r.available,
    },
  }));
  const available = rows.reduce((s, r) => s + r.available, 0);
  const spent = rows.reduce((s, r) => s + r.spent, 0);
  return {
    month,
    today,
    pacing: monthPacing(month, today),
    rows: budgetRows,
    uncategorizedSpent: 0,
    totals: { budgeted: available, available, spentInBudgets: spent, remaining: available - spent, totalSpent: spent, overCount: 0 },
    copyableFromPrevious: 0,
    spentTodayInBudgets: 0,
  };
}

function data(over: Partial<InsightData> = {}): InsightData {
  const expenses = [...(over.expenses ?? [])].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  return {
    today: TODAY,
    firstDay: '2026-01-01',
    income: [],
    categories: new Map([
      ['cat-misc', 'Misc'],
      ['cat-dining', 'Dining'],
      ['cat-fun', 'Fun'],
      ['cat-rent', 'Rent'],
    ]),
    budgets: new Map(),
    recurring: [],
    accounts: [],
    friends: [],
    ...over,
    expenses,
  };
}

const only = (insights: DetectedInsight[]) => {
  assert.equal(insights.length, 1, `expected one insight, got ${insights.length}`);
  return insights[0];
};

// ==================== DETECTORS ====================

describe('budget overrun', () => {
  test('a budget already over reports the overshoot', () => {
    const d = data({ budgets: new Map([['2026-11', budgetMonth([{ id: 'cat-dining', name: 'Dining', available: 100, spent: 130 }])]]) });
    const insight = only(detectBudgetOverrun(d));
    assert.equal(insight.key, 'budget_overrun:cat-dining:2026-11:over');
    assert.equal(insight.severity, 'alert');
    assert.equal(insight.numbers.overBy, 30);
    assert.match(insight.plain, /\$30\.00 over its \$100\.00 budget/);
    assert.equal(insight.link.href, '/plan/budgets?month=2026-11');
  });

  test('everyday spending is projected to the end of the month', () => {
    // Day 17 of 30: 80 so far, 80 / 17 * 13 = 61.18 more -> 141.18, 41.18 over 100.
    const d = data({
      expenses: [exp('2026-11-05', 80, { categoryId: 'cat-dining' })],
      budgets: new Map([['2026-11', budgetMonth([{ id: 'cat-dining', name: 'Dining', available: 100, spent: 80 }])]]),
    });
    const insight = only(detectBudgetOverrun(d));
    assert.equal(insight.key, 'budget_overrun:cat-dining:2026-11:projected');
    assert.equal(insight.severity, 'warning');
    assert.equal(insight.numbers.projected, 141.18);
    assert.equal(insight.numbers.overshoot, 41.18);
  });

  test('a recurring charge is counted from its schedule, not multiplied out', () => {
    // 60 of 100 spent on day 17, all of it one posted recurring charge: stays at 60.
    const d = data({
      expenses: [exp('2026-11-01', 60, { categoryId: 'cat-rent', recurringId: 'r-Rent' })],
      budgets: new Map([['2026-11', budgetMonth([{ id: 'cat-rent', name: 'Rent', available: 100, spent: 60 }])]]),
      recurring: [recurring({ name: 'Rent', amount: 60, nextDueDate: '2026-12-01', categoryId: 'cat-rent' })],
    });
    assert.deepEqual(detectBudgetOverrun(d), []);
  });

  test('too early in the month to project: nothing', () => {
    const today = '2026-11-03';
    const d = data({
      today,
      expenses: [exp('2026-11-02', 40, { categoryId: 'cat-dining' })],
      budgets: new Map([['2026-11', budgetMonth([{ id: 'cat-dining', name: 'Dining', available: 100, spent: 40 }], today)]]),
    });
    assert.deepEqual(detectBudgetOverrun(d), []);
  });
});

describe('category pace', () => {
  const history = (firstDay: string) =>
    data({
      firstDay,
      expenses: [
        exp('2026-08-10', 50, { categoryId: 'cat-fun' }),
        exp('2026-09-10', 50, { categoryId: 'cat-fun' }),
        exp('2026-10-10', 50, { categoryId: 'cat-fun' }),
        // After day 17 of its month: not part of "by this point in the month".
        exp('2026-10-25', 500, { categoryId: 'cat-fun' }),
        exp('2026-11-04', 120, { categoryId: 'cat-fun' }),
      ],
    });

  test('well ahead of the last three months at the same day', () => {
    const insight = only(detectCategoryPace(history('2026-07-01')));
    assert.equal(insight.key, 'category_pace:cat-fun:2026-11');
    assert.equal(insight.numbers.usual, 50);
    assert.equal(insight.numbers.spent, 120);
    assert.equal(insight.numbers.difference, 70);
    assert.match(insight.plain, /140% higher/);
    assert.equal(insight.link.href, '/transactions/expenses?category=cat-fun&month=2026-11');
  });

  test('less than three full months of history: nothing', () => {
    assert.deepEqual(detectCategoryPace(history('2026-08-05')), []);
  });

  test('a budgeted category is left to the budget insight', () => {
    const d = history('2026-07-01');
    d.budgets.set('2026-11', budgetMonth([{ id: 'cat-fun', name: 'Fun', available: 500, spent: 120 }]));
    assert.deepEqual(detectCategoryPace(d), []);
  });
});

describe('large transaction', () => {
  const coffee = (count: number) =>
    Array.from({ length: count }, (_, i) => exp(addDays('2026-10-01', i * 5), 10, { merchant: 'Corner Cafe', categoryId: 'cat-dining' }));

  test('far above the usual amount at that merchant', () => {
    const big = exp('2026-11-15', 60, { merchant: 'Corner Cafe', categoryId: 'cat-dining' });
    const insight = only(detectLargeTransactions(data({ expenses: [...coffee(4), big] })));
    assert.equal(insight.key, `large_transaction:${big.id}`);
    assert.equal(insight.numbers.amount, 60);
    assert.equal(insight.numbers.typical, 10);
    assert.equal(insight.numbers.times, 6);
    assert.equal(insight.link.href, '/transactions/expenses?from=2026-11-15&to=2026-11-15&category=cat-dining');
  });

  test('too few earlier purchases to know what is usual: nothing', () => {
    const big = exp('2026-11-15', 60, { merchant: 'Corner Cafe', categoryId: 'cat-dining' });
    assert.deepEqual(detectLargeTransactions(data({ expenses: [...coffee(3), big] })), []);
  });
});

describe('recurring charge changed', () => {
  test('a set-up subscription charged a new amount', () => {
    const netflix = recurring({ name: 'Netflix', amount: 17.99, nextDueDate: '2026-12-14' });
    const charge = (day: string, amount: number) => exp(day, amount, { merchant: 'Netflix', recurringId: netflix.id });
    const d = data({
      recurring: [netflix],
      expenses: [charge('2026-09-14', 15.49), charge('2026-10-14', 15.49), charge('2026-11-14', 17.99)],
    });
    const insight = only(detectRecurringChanged(d));
    assert.equal(insight.key, `recurring_changed:${netflix.id}:2026-11-14`);
    assert.equal(insight.numbers.previous, 15.49);
    assert.equal(insight.numbers.latest, 17.99);
    assert.equal(insight.numbers.difference, 2.5);
    assert.match(insight.plain, /charged \$17\.99 on Nov 14, up from \$15\.49: \$2\.50 more each time \(16%\)/);
  });

  test('a repeating charge that was never set up, at a new price', () => {
    const spotify = (day: string, amount: number) => exp(day, amount, { merchant: 'Spotify' });
    const d = data({
      expenses: [spotify('2026-08-12', 9.99), spotify('2026-09-12', 9.99), spotify('2026-10-12', 9.99), spotify('2026-11-12', 11.99)],
    });
    const insight = only(detectRecurringChanged(d));
    assert.equal(insight.key, 'recurring_changed:spotify:2026-11-12');
    assert.equal(insight.numbers.difference, 2);
  });

  test('the same amount as before, or no earlier charge: nothing', () => {
    const netflix = recurring({ name: 'Netflix', amount: 15.49, nextDueDate: '2026-12-14' });
    const charge = (day: string) => exp(day, 15.49, { merchant: 'Netflix', recurringId: netflix.id });
    assert.deepEqual(detectRecurringChanged(data({ recurring: [netflix], expenses: [charge('2026-10-14'), charge('2026-11-14')] })), []);
    assert.deepEqual(detectRecurringChanged(data({ recurring: [netflix], expenses: [charge('2026-11-14')] })), []);
    assert.deepEqual(detectRecurringChanged(data({ recurring: [netflix] })), []);
  });
});

describe('subscription not charged', () => {
  const gym = recurring({ name: 'Gym', amount: 40, nextDueDate: '2026-11-10' });

  test('an entry a week past its due day with no charge', () => {
    const insight = only(detectSubscriptionMissed(data({ recurring: [gym] })));
    assert.equal(insight.key, `subscription_missed:${gym.id}:2026-11-10`);
    assert.equal(insight.numbers.daysLate, 7);
    assert.match(insight.plain, /Gym \(\$40\.00\) was expected on Nov 10, 7 days ago/);
  });

  test('logged by hand, or still inside the grace period: nothing', () => {
    assert.deepEqual(
      detectSubscriptionMissed(data({ recurring: [gym], expenses: [exp('2026-11-11', 40, { merchant: 'Gym' })] })),
      []
    );
    assert.deepEqual(detectSubscriptionMissed(data({ recurring: [{ ...gym, nextDueDate: '2026-11-15' }] })), []);
  });

  test('a repeating charge that was never set up and stopped arriving', () => {
    const hulu = (day: string) => exp(day, 12, { merchant: 'Hulu' });
    const d = data({ expenses: [hulu('2026-08-08'), hulu('2026-09-08'), hulu('2026-10-08')] });
    const insight = only(detectSubscriptionMissed(d));
    assert.equal(insight.key, 'subscription_missed:hulu:2026-11-08');
    assert.equal(insight.numbers.daysLate, 9);
  });
});

describe('bill the balance may not cover', () => {
  const checking = { id: 'acc-checking', name: 'Checking', type: 'CHECKING', balance: 500, creditLimit: null };
  const rent = recurring({ name: 'Rent', amount: 800, nextDueDate: '2026-11-20' });

  test('a bill larger than what the account holds', () => {
    const insight = only(detectBillCoverage(data({ accounts: [checking], recurring: [rent] })));
    assert.equal(insight.key, `bill_coverage:${rent.id}:2026-11-20`);
    assert.equal(insight.severity, 'alert');
    assert.equal(insight.numbers.shortfall, 300);
    assert.match(insight.plain, /Rent \(\$800\.00\) is due on Nov 20 from Checking, which holds \$500\.00/);
  });

  test('a pay day before the bill covers it: nothing', () => {
    const pay = recurring({ name: 'Paycheck', kind: 'INCOME', amount: 1000, nextDueDate: '2026-11-19' });
    assert.deepEqual(detectBillCoverage(data({ accounts: [checking], recurring: [rent, pay] })), []);
  });

  test('a bill beyond the next week, or paid from a card: nothing', () => {
    assert.deepEqual(detectBillCoverage(data({ accounts: [checking], recurring: [{ ...rent, nextDueDate: '2026-11-30' }] })), []);
    const card = { id: 'acc-card', name: 'Card', type: 'CREDIT_CARD', balance: -100, creditLimit: 5000 };
    assert.deepEqual(detectBillCoverage(data({ accounts: [card], recurring: [{ ...rent, accountId: 'acc-card' }] })), []);
  });
});

describe('credit card utilisation', () => {
  const card = (balance: number, creditLimit: number | null) => ({ id: 'acc-card', name: 'Discover', type: 'CREDIT_CARD', balance, creditLimit });

  test('36% of the limit', () => {
    const insight = only(detectCreditUtilisation(data({ accounts: [card(-1800, 5000)] })));
    assert.equal(insight.key, 'credit_utilisation:acc-card:2026-11:30');
    assert.equal(insight.severity, 'info');
    assert.equal(insight.numbers.owed, 1800);
    assert.equal(insight.numbers.toTarget, 300);
    assert.match(insight.plain, /owes \$1,800\.00 of a \$5,000\.00 limit \(36%\)\. Paying \$300\.00 would bring it to 30%/);
  });

  test('a higher band is a new insight and more severe', () => {
    const insight = only(detectCreditUtilisation(data({ accounts: [card(-4000, 5000)] })));
    assert.equal(insight.key, 'credit_utilisation:acc-card:2026-11:75');
    assert.equal(insight.severity, 'alert');
  });

  test('under the threshold, or no limit recorded: nothing', () => {
    assert.deepEqual(detectCreditUtilisation(data({ accounts: [card(-1000, 5000)] })), []);
    assert.deepEqual(detectCreditUtilisation(data({ accounts: [card(-1800, null)] })), []);
  });
});

describe('friend balance outstanding', () => {
  test('open for 47 days with no recent activity', () => {
    const d = data({
      friends: [{ id: 'f-alex', name: 'Alex', entries: [{ day: '2026-10-01', amount: 50 }, { day: '2026-10-15', amount: -20 }] }],
    });
    const insight = only(detectFriendBalances(d));
    assert.equal(insight.key, 'friend_balance:f-alex:2026-10-01:30');
    assert.equal(insight.numbers.amount, 30);
    assert.equal(insight.numbers.openDays, 47);
    assert.equal(insight.plain, 'Alex has owed you $30.00 since Oct 1, 47 days ago.');
  });

  test('settled and reopened recently, or simply recent: nothing', () => {
    const settled = [{ day: '2026-09-01', amount: 50 }, { day: '2026-09-20', amount: -50 }, { day: '2026-11-05', amount: 25 }];
    assert.deepEqual(detectFriendBalances(data({ friends: [{ id: 'f', name: 'Sam', entries: settled }] })), []);
    assert.deepEqual(detectFriendBalances(data({ friends: [{ id: 'f', name: 'Sam', entries: [{ day: '2026-11-01', amount: -15 }] }] })), []);
  });
});

describe('good week and streak', () => {
  /** 200 on the Monday of each of the 8 weeks before last week, then 100 last week. */
  const weeks = () => [
    ...Array.from({ length: 8 }, (_, i) => exp(addDays('2026-11-02', -7 * i), 200)),
    exp('2026-11-09', 40),
    exp('2026-11-11', 30),
    exp('2026-11-13', 30),
  ];

  test('last week well under the typical week', () => {
    const insight = only(detectGoodWeek(data({ firstDay: '2026-06-01', expenses: weeks() })));
    assert.equal(insight.key, 'good_week:2026-11-09');
    assert.equal(insight.severity, 'positive');
    assert.equal(insight.numbers.spent, 100);
    assert.equal(insight.numbers.typical, 200);
    assert.equal(insight.numbers.saved, 100);
    assert.equal(insight.link.href, '/transactions/expenses?from=2026-11-09&to=2026-11-15');
  });

  test('fewer than four earlier weeks of history: nothing', () => {
    assert.deepEqual(detectGoodWeek(data({ firstDay: '2026-10-20', expenses: weeks() })), []);
    assert.deepEqual(detectStreak(data({ firstDay: '2026-10-28', expenses: weeks() })), []);
  });

  test('an ordinary week: nothing', () => {
    const ordinary = [...weeks(), exp('2026-11-14', 90)];
    assert.deepEqual(detectGoodWeek(data({ firstDay: '2026-06-01', expenses: ordinary })), []);
  });

  test('a run of days under the typical day', () => {
    // Typical week 210 (30 a day). 10 a day from Nov 9 to Nov 16; before that
    // nothing back to the 210 on Monday Nov 2. Streak: Nov 3 .. Nov 16 = 14 days.
    const expenses = [
      ...Array.from({ length: 7 }, (_, i) => exp(addDays('2026-11-02', -7 * i), 210)),
      ...Array.from({ length: 8 }, (_, i) => exp(addDays('2026-11-09', i), 10)),
    ];
    const insight = only(detectStreak(data({ firstDay: '2026-06-01', expenses })));
    assert.equal(insight.key, 'streak:2026-11-03:10');
    assert.equal(insight.numbers.length, 14);
    assert.equal(insight.numbers.typicalDay, 30);
    // The same data is also a good week; together only the week is kept.
    const all = detectInsights(data({ firstDay: '2026-06-01', expenses })).insights.map((i) => i.type);
    assert.deepEqual(all, ['good_week']);
  });
});

describe('detectInsights', () => {
  test('a few days of data produce no comparisons, and the history note says why', () => {
    const d = data({
      firstDay: '2026-11-10',
      expenses: [exp('2026-11-10', 300, { categoryId: 'cat-fun', merchant: 'Arcade' }), exp('2026-11-15', 900, { categoryId: 'cat-fun', merchant: 'Arcade' })],
    });
    const result = detectInsights(d);
    assert.deepEqual(result.insights, []);
    assert.equal(result.history.enough, false);
    assert.match(result.history.message ?? '', /Not enough history yet/);
    assert.match(result.history.message ?? '', /21 more days/);
  });

  test('ranks alerts first and skips disabled types', () => {
    const d = data({
      accounts: [{ id: 'acc-card', name: 'Discover', type: 'CREDIT_CARD', balance: -1800, creditLimit: 5000 }],
      budgets: new Map([['2026-11', budgetMonth([{ id: 'cat-dining', name: 'Dining', available: 100, spent: 130 }])]]),
      friends: [{ id: 'f-alex', name: 'Alex', entries: [{ day: '2026-10-01', amount: 50 }] }],
    });
    assert.deepEqual(detectInsights(d).insights.map((i) => i.type), ['budget_overrun', 'credit_utilisation', 'friend_balance']);
    assert.deepEqual(
      detectInsights(d, { disabled: ['budget_overrun'] }).insights.map((i) => i.type),
      ['credit_utilisation', 'friend_balance']
    );
  });
});

// ==================== WORDING ====================

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

/**
 * A model that answers every wording call. `write` gets the ids found in the
 * prompt and returns the JSON the model "wrote".
 */
function wordingModel(
  write: (ids: { insights: string[]; recaps: string[] }) => unknown = ({ insights, recaps }) => ({
    insights: insights.map((id) => ({ id, text: `Model sentence for ${id.replace(/\d/g, '')}.` })),
    recaps: recaps.map((id) => ({ id, headline: 'A model headline', summary: 'A model summary without figures.', suggestion: 'A model suggestion.' })),
  })
) {
  const prompts: string[] = [];
  const model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      const prompt = JSON.stringify(options.prompt);
      prompts.push(prompt);
      // Let other requests interleave, as a real model call would.
      await new Promise((resolve) => setTimeout(resolve, 5));
      const ids = {
        insights: [...prompt.matchAll(/INSIGHT (i\d+)/g)].map((m) => m[1]),
        recaps: [...prompt.matchAll(/RECAP (r\d+)/g)].map((m) => m[1]),
      };
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(write(ids)) }],
        finishReason: { unified: 'stop' as const, raw: undefined },
        usage,
        warnings: [],
      };
    },
  });
  return { model, prompts };
}

const overBudget = (): DetectedInsight =>
  only(detectBudgetOverrun(data({ budgets: new Map([['2026-11', budgetMonth([{ id: 'cat-dining', name: 'Dining', available: 100, spent: 130 }])]]) })));

describe('wording', () => {
  test('numbers are compared as numbers, whatever their formatting', () => {
    assert.deepEqual(numbersIn('Paid $1,234.50 (38%) on Nov 20'), ['1234.5', '38', '20']);
    assert.equal(usesOnlyKnownNumbers('You are $30 over', ['Over by: $30.00']), true);
    assert.equal(usesOnlyKnownNumbers('You are $35 over', ['Over by: $30.00']), false);
    assert.equal(acceptText('  Fine,\n no figures.  ', [], 100), 'Fine, no figures.');
    assert.equal(acceptText('', [], 100), null);
    assert.equal(acceptText('x'.repeat(101), [], 100), null);
  });

  test('without a model the template sentences stand and nothing is called', async () => {
    const insight = overBudget();
    const facts = buildRecap(data({ expenses: [exp('2026-11-10', 60)] }), 'weekly', '2026-11-09');
    const wording = await writeWording({ model: null, insights: [insight], recaps: [{ key: 'weekly:2026-11-09', facts }] });
    assert.equal(wording.called, false);
    assert.equal(wording.insights.size, 0);
    assert.deepEqual(wording.recaps.get('weekly:2026-11-09'), { text: recapTemplate(facts), fromModel: false });
  });

  test('a sentence that uses the given figures is accepted', async () => {
    const insight = overBudget();
    const { model, prompts } = wordingModel(() => ({
      insights: [{ id: 'i1', text: 'Dining has gone $30.00 past its $100.00 budget.' }],
      recaps: [],
    }));
    const wording = await writeWording({ model, insights: [insight], recaps: [] });
    assert.equal(wording.called, true);
    assert.equal(wording.insights.get(insight.key), 'Dining has gone $30.00 past its $100.00 budget.');
    // The model is given the figures as formatted facts, not raw data to compute from.
    assert.match(prompts[0], /Over by: \$30\.00/);
  });

  test('an invented figure is thrown away, so the template is kept', async () => {
    const insight = overBudget();
    const { model } = wordingModel(() => ({
      insights: [{ id: 'i1', text: 'Dining is $45.00 over budget, about 45% too much.' }],
      recaps: [],
    }));
    const wording = await writeWording({ model, insights: [insight], recaps: [] });
    assert.equal(wording.called, true);
    assert.equal(wording.insights.has(insight.key), false);
  });

  test('a failing model leaves the templates in place', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error('overloaded');
      },
    });
    const facts = buildRecap(data({ expenses: [exp('2026-11-10', 60)] }), 'weekly', '2026-11-09');
    const wording = await writeWording({ model, insights: [overBudget()], recaps: [{ key: 'k', facts }] });
    assert.equal(wording.insights.size, 0);
    assert.equal(wording.recaps.get('k')?.fromModel, false);
    assert.match(wording.error ?? '', /overloaded/);
  });

  test('a recap field with an invented figure falls back on its own', async () => {
    const facts = buildRecap(data({ expenses: [exp('2026-11-10', 60)] }), 'weekly', '2026-11-09');
    const { model } = wordingModel(() => ({
      insights: [],
      recaps: [{ id: 'r1', headline: 'A quiet week', summary: 'You spent $60.00 this week.', suggestion: 'Save $500 next week.' }],
    }));
    const written = (await writeWording({ model, insights: [], recaps: [{ key: 'k', facts }] })).recaps.get('k')!;
    assert.equal(written.fromModel, true);
    assert.equal(written.text.headline, 'A quiet week');
    assert.equal(written.text.summary, 'You spent $60.00 this week.');
    assert.equal(written.text.suggestion, recapTemplate(facts).suggestion);
  });
});

// ==================== RECAP FIGURES ====================

describe('recap figures', () => {
  test('periods', () => {
    assert.deepEqual(lastCompletedPeriod('weekly', TODAY), { start: '2026-11-09', end: '2026-11-15' });
    assert.deepEqual(lastCompletedPeriod('weekly', '2026-11-16'), { start: '2026-11-09', end: '2026-11-15' });
    assert.deepEqual(lastCompletedPeriod('monthly', TODAY), { start: '2026-10-01', end: '2026-10-31' });
  });

  test('the weekly recap of the seeded data, worked out by hand', async () => {
    const { db } = seedAssistantData();
    const facts = buildRecap(await loadInsightData(db as never, TODAY), 'weekly', '2026-11-09');
    // Nov 10 Steakhouse 60, Nov 12 Hardware store 25, Nov 14 Pizza place 40 of which 25 is a friend's.
    assert.equal(facts.spent, 100);
    assert.equal(facts.count, 3);
    assert.equal(facts.label, 'Nov 9 – Nov 15');
    // The week before: Costco 180 on Nov 3.
    assert.deepEqual(facts.previous, { spent: 180, change: -80, changePct: -0.44 });
    // Eight weeks before: 180, 0, 15.49 (Oct 20), 0, 0, 0, 0, 15.49 (Sep 20) = 210.98 / 8.
    assert.equal(facts.average?.periods, 8);
    assert.equal(facts.average?.spent, 26.37);
    assert.deepEqual(facts.topCategories.map((c) => [c.name, c.amount]), [['Dining', 75], ['Household', 25]]);
    assert.deepEqual(facts.topMerchants.map((m) => [m.name, m.amount]), [['Steakhouse', 60], ['Hardware store', 25], ['Pizza place', 15]]);
    // November budgets: Groceries 400 (with rollover) + Dining 50; spent 180 + 75.
    assert.deepEqual(facts.budget, { month: 'November', available: 450, spent: 255, remaining: 195, daysLeft: 14, over: [{ name: 'Dining', overBy: 25 }] });
    assert.deepEqual(facts.upcoming.items, [{ name: 'Netflix', amount: 15.49, day: '2026-11-20', kind: 'EXPENSE' }]);
    assert.equal(facts.suggestion.kind, 'budget_over');
    assert.deepEqual(facts.notes, []);

    const text = recapTemplate(facts);
    assert.equal(text.headline, 'Week of Nov 9: $100.00 spent');
    assert.match(text.summary, /You spent \$100\.00, \$80\.00 less \(44%\) than the week before \(\$180\.00\)/);
    assert.match(text.suggestion, /Dining is \$25\.00 over its November budget with 14 days left/);
  });

  test('with too little history the comparisons are left out and a note says so', () => {
    const d = data({ firstDay: '2026-11-10', expenses: [exp('2026-11-10', 60), exp('2026-11-12', 40)] });
    const facts = buildRecap(d, 'weekly', '2026-11-09');
    assert.equal(facts.spent, 100);
    assert.equal(facts.previous, null);
    assert.equal(facts.average, null);
    assert.equal(facts.notes.length, 2);
    assert.match(facts.notes[1], /Not enough history yet to compare with your average: that needs 4 full weeks/);
    assert.match(recapTemplate(facts).summary, /Not enough history yet/);
  });
});

// ==================== THE DAILY CHECK ====================

/** The seeded data plus a second budget that is over, so two insights share a type. */
function seeded() {
  const seededData = seedAssistantData();
  // Household: 25 spent on Nov 12 against a budget of 10.
  seededData.db.seed('budget', { month: parseDay('2026-11-01'), categoryId: seededData.ids.household, amount: 10, rolloverEnabled: false });
  return seededData;
}

describe('daily check', () => {
  test('stores what it detects with template wording when there is no model', async () => {
    const { db, ids } = seeded();
    const result = await runInsightsCheck({ db: db as never, model: null, today: TODAY });
    assert.deepEqual(result, { state: 'ran', detected: 3, recaps: ['weekly:2026-11-09', 'monthly:2026-10-01'], modelCalled: false });

    const strip = await loadInsightStrip({ db: db as never, today: TODAY });
    assert.equal(strip.note, null);
    assert.deepEqual(
      strip.insights.map((i) => [i.key, i.wording]),
      [
        [`budget_overrun:${ids.dining}:2026-11:over`, 'template'],
        [`budget_overrun:${ids.household}:2026-11:over`, 'template'],
        [`friend_balance:${ids.alex}:2026-10-01:30`, 'template'],
      ]
    );
    // Dining: 60 + 15 against 50. The sentence is the one built in code.
    assert.equal(strip.insights[0].text, 'Dining is $25.00 over its $50.00 budget for November, with 13 days left after today.');
    assert.equal(strip.insights[2].text, 'Alex has owed you $30.00 since Oct 1, 47 days ago.');
    assert.equal(db.data.recap.every((r) => r.wording === 'template'), true);
  });

  test('a second run the same day does nothing', async () => {
    const { db } = seeded();
    const { model } = wordingModel();
    await runInsightsCheck({ db: db as never, model, today: TODAY });
    assert.deepEqual(await runInsightsCheck({ db: db as never, model, today: TODAY }), { state: 'done' });
    assert.equal(model.doGenerateCalls.length, 1);
    assert.equal(db.data.insightRun.length, 1);
    assert.equal(db.data.insightRun[0].modelCalls, 1);
  });

  test('two concurrent runs: one stored recap of each kind, one model call', async () => {
    const { db } = seeded();
    const { model, prompts } = wordingModel();
    const deps = { db: db as never, model, today: TODAY };
    const results = await Promise.all([runInsightsCheck(deps), runInsightsCheck(deps)]);
    assert.deepEqual(results.map((r) => r.state).sort(), ['busy', 'ran']);
    assert.equal(model.doGenerateCalls.length, 1);
    assert.deepEqual(db.data.recap.map((r) => r.key).sort(), ['monthly:2026-10-01', 'weekly:2026-11-09']);
    // One call words the three insights and both recaps.
    assert.equal((prompts[0].match(/INSIGHT i\d/g) ?? []).length, 3);
    assert.equal((prompts[0].match(/RECAP r\d/g) ?? []).length, 2);

    // Opening the app again later, and the next day, never rewrites a stored recap.
    assert.deepEqual(await runInsightsCheck(deps), { state: 'done' });
    const nextDay = await runInsightsCheck({ ...deps, today: addDays(TODAY, 1) });
    assert.equal(nextDay.state === 'ran' && nextDay.recaps.length, 0);
    assert.equal(db.data.recap.length, 2);
    const weekly = await getRecap('weekly:2026-11-09', deps);
    assert.equal(weekly?.wording, 'model');
    assert.equal(weekly?.text.summary, 'A model summary without figures.');
    assert.equal(weekly?.facts.spent, 100);
  });

  test('model wording is stored; figures that changed are worded again the next day', async () => {
    const { db, ids } = seeded();
    const { model, prompts } = wordingModel();
    await runInsightsCheck({ db: db as never, model, today: TODAY });
    let strip = await loadInsightStrip({ db: db as never, today: TODAY });
    assert.deepEqual(strip.insights.map((i) => i.wording), ['model', 'model', 'model']);
    assert.equal(strip.insights[0].text, 'Model sentence for i.');

    // Next day: one more dining expense, and every "days left / days ago" moved on.
    db.seed('transaction', { date: parseDay('2026-11-18'), kind: 'EXPENSE', amount: 10, categoryId: ids.dining, accountId: ids.chase, merchantOrSource: 'Cafe' });
    const tomorrow = addDays(TODAY, 1);
    await runInsightsCheck({ db: db as never, model, today: tomorrow });
    assert.equal(model.doGenerateCalls.length, 2);
    assert.equal((prompts[1].match(/INSIGHT i\d/g) ?? []).length, 3);
    assert.match(prompts[1], /Over by: \$35\.00/);
    assert.match(prompts[1], /Days open: 48/);
    // No recap is due again, so none is sent.
    assert.equal((prompts[1].match(/RECAP r\d/g) ?? []).length, 0);
    strip = await loadInsightStrip({ db: db as never, today: tomorrow });
    assert.equal(strip.insights.length, 3);
    // Still one row per key.
    assert.equal(db.data.insight.length, 3);
  });

  test('an insight whose figures did not change keeps its wording: no second model call', async () => {
    const db = new FakeDb();
    const card = db.seed('account', { name: 'Discover', type: 'CREDIT_CARD', startingBalance: 0, creditLimit: 5000 });
    const category = db.seed('category', { name: 'Travel', type: 'EXPENSE', color: '#000' });
    // Entered yesterday: 36% of the limit, and no completed week to recap yet.
    db.seed('transaction', { date: parseDay('2026-11-16'), kind: 'EXPENSE', amount: 1800, categoryId: category.id, accountId: card.id, merchantOrSource: 'Airline' });
    const { model } = wordingModel();
    const day1 = await runInsightsCheck({ db: db as never, model, today: TODAY });
    assert.deepEqual(day1, { state: 'ran', detected: 1, recaps: [], modelCalled: true });
    const day2 = await runInsightsCheck({ db: db as never, model, today: addDays(TODAY, 1) });
    assert.deepEqual(day2, { state: 'ran', detected: 1, recaps: [], modelCalled: false });
    assert.equal(model.doGenerateCalls.length, 1);
    const strip = await loadInsightStrip({ db: db as never, today: addDays(TODAY, 1) });
    assert.deepEqual(strip.insights.map((i) => [i.type, i.wording]), [['credit_utilisation', 'model']]);
  });

  test('a run that died is taken over once it is stale', async () => {
    const { db } = seeded();
    const started = new Date('2026-11-17T15:00:00Z');
    db.seed('insightRun', { day: TODAY, status: 'running', claimedAt: started });
    const at = (ms: number) => () => new Date(started.getTime() + ms);
    assert.deepEqual(await runInsightsCheck({ db: db as never, model: null, today: TODAY, now: at(STALE_RUN_MS - 1000) }), { state: 'busy' });
    const result = await runInsightsCheck({ db: db as never, model: null, today: TODAY, now: at(STALE_RUN_MS + 1000) });
    assert.equal(result.state, 'ran');
    assert.equal(db.data.insightRun[0].status, 'done');
  });

  test('never more than three on the dashboard', async () => {
    const { db, ids } = seeded();
    // A fourth: Discover at 36% of its 5000 limit (180 owed already, plus 1620).
    db.seed('transaction', { date: parseDay('2026-11-16'), kind: 'EXPENSE', amount: 1620, categoryId: ids.subscriptions, accountId: ids.discover, merchantOrSource: 'Laptop' });
    const result = await runInsightsCheck({ db: db as never, model: null, today: TODAY });
    assert.ok(result.state === 'ran' && result.detected > MAX_SHOWN);
    const strip = await loadInsightStrip({ db: db as never, today: TODAY });
    assert.equal(strip.insights.length, MAX_SHOWN);
  });

  test('too little history: nothing is shown and the strip says so plainly', async () => {
    const db = new FakeDb();
    const account = db.seed('account', { name: 'Checking', type: 'CHECKING', startingBalance: 1000 });
    const category = db.seed('category', { name: 'Fun', type: 'EXPENSE', color: '#000' });
    for (const [day, amount] of [['2026-11-16', 20], ['2026-11-17', 900]] as const) {
      db.seed('transaction', { date: parseDay(day), kind: 'EXPENSE', amount, categoryId: category.id, accountId: account.id, merchantOrSource: 'Arcade' });
    }
    const { model } = wordingModel();
    const result = await runInsightsCheck({ db: db as never, model, today: TODAY });
    // No full week of entries yet either, so no recap and nothing to word.
    assert.deepEqual(result, { state: 'ran', detected: 0, recaps: [], modelCalled: false });
    assert.equal(model.doGenerateCalls.length, 0);
    const strip = await loadInsightStrip({ db: db as never, today: TODAY });
    assert.deepEqual(strip.insights, []);
    assert.match(strip.note ?? '', /Not enough history yet to compare your spending/);
  });
});

describe('dismissing and muting', () => {
  test('a dismissed insight stays gone and its type is muted for a while', async () => {
    const { db, ids } = seeded();
    const deps = { db: db as never, model: null, today: TODAY };
    await runInsightsCheck(deps);
    const diningKey = `budget_overrun:${ids.dining}:2026-11:over`;
    const householdKey = `budget_overrun:${ids.household}:2026-11:over`;
    const friendKey = `friend_balance:${ids.alex}:2026-10-01:30`;

    const dismissed = await dismissInsight(diningKey, deps);
    assert.deepEqual(dismissed, { type: 'budget_overrun', label: 'Budgets at risk', mutedUntil: addDays(TODAY, MUTE_DAYS), days: MUTE_DAYS });

    // Stored, not held in memory: the row and the mute are in the database.
    assert.ok(db.data.insight.find((r) => r.key === diningKey)?.dismissedAt instanceof Date);
    assert.equal(db.data.insightPreference[0].mutedUntil, '2026-11-24');

    // Gone after a "refresh", along with the other insight of the muted type.
    assert.deepEqual((await loadInsightStrip(deps)).insights.map((i) => i.key), [friendKey]);

    // The next day's check detects both budgets again but shows neither.
    const day2 = { ...deps, today: addDays(TODAY, 1) };
    await runInsightsCheck(day2);
    assert.deepEqual((await loadInsightStrip(day2)).insights.map((i) => i.key), [friendKey]);
    assert.equal(db.data.insight.filter((r) => r.key === diningKey).length, 1);

    // Unmuted (here by hand in Settings): the other budget is back, the dismissed one never.
    await unmuteInsightType('budget_overrun', day2);
    assert.deepEqual((await loadInsightStrip(day2)).insights.map((i) => i.key), [householdKey, friendKey]);
  });

  test('the mute ends on its own', async () => {
    const { db, ids } = seeded();
    const deps = { db: db as never, model: null, today: TODAY };
    await runInsightsCheck(deps);
    await dismissInsight(`friend_balance:${ids.alex}:2026-10-01:30`, deps);
    const prefs = (day: string) => loadInsightPreferences({ ...deps, today: day });
    const friend = async (day: string) => (await prefs(day)).find((p) => p.type === 'friend_balance');
    assert.equal((await friend(addDays(TODAY, MUTE_DAYS - 1)))?.mutedUntil, '2026-11-24');
    assert.equal((await friend(addDays(TODAY, MUTE_DAYS)))?.mutedUntil, null);
  });

  test('a type switched off in settings is not detected', async () => {
    const { db, ids } = seeded();
    const deps = { db: db as never, model: null, today: TODAY };
    await setInsightTypeEnabled('budget_overrun', false, deps);
    const prefs = await loadInsightPreferences(deps);
    assert.deepEqual(prefs.map((p) => p.type), [...INSIGHT_TYPES]);
    assert.equal(prefs.find((p) => p.type === 'budget_overrun')?.enabled, false);

    await runInsightsCheck(deps);
    assert.deepEqual((await loadInsightStrip(deps)).insights.map((i) => i.key), [`friend_balance:${ids.alex}:2026-10-01:30`]);
    await assert.rejects(() => setInsightTypeEnabled('not_a_type', false, deps), /Unknown insight type/);
  });
});

describe('stored recaps', () => {
  test('browsable, shown on the dashboard on Mondays, regenerated only on demand', async () => {
    const { db } = seeded();
    const { model } = wordingModel();
    const monday = '2026-11-16';
    const deps = { db: db as never, model, today: monday };
    await runInsightsCheck(deps);
    assert.deepEqual((await listRecaps(deps)).map((r) => [r.key, r.label]), [
      ['weekly:2026-11-09', 'Nov 9 – Nov 15'],
      ['monthly:2026-10-01', 'October 2026'],
    ]);
    assert.deepEqual((await loadDashboardRecaps(deps)).map((r) => r.key), ['weekly:2026-11-09']);
    assert.deepEqual(await loadDashboardRecaps({ ...deps, today: TODAY }), []);
    // The monthly recap is on the dashboard for the first days of the month.
    assert.deepEqual((await loadDashboardRecaps({ ...deps, today: '2026-11-02' })).map((r) => r.key), ['monthly:2026-10-01']);
    assert.deepEqual(await loadDashboardRecaps({ ...deps, today: '2026-11-05' }), []);

    // Reading never calls the model; regenerating calls it once and keeps one row.
    assert.equal(model.doGenerateCalls.length, 1);
    const again = await regenerateRecap(recapKey('weekly', '2026-11-09'), deps);
    assert.equal(model.doGenerateCalls.length, 2);
    assert.equal(again.wording, 'model');
    assert.equal(db.data.recap.length, 2);
    await assert.rejects(() => regenerateRecap('weekly:2026-10-05', deps), /Only the latest recap/);
  });
});

// ==================== TELL ME MORE ====================

describe('"Tell me more" context', () => {
  test('the insight travels to the assistant as context', () => {
    const insight = overBudget();
    const context = parseAskContext({
      page: 'dashboard',
      insight: { type: insight.type, title: insight.title, text: insight.plain, facts: insight.facts.map((f) => `${f.label}: ${f.value}`) },
    });
    assert.ok(context);
    assert.equal(contextTitle(context), 'Dining is over budget');
    const section = contextSection(context);
    assert.match(section, /an insight the app showed them, headed "Dining is over budget"/);
    assert.match(section, /"Over by: \$30\.00"/);
    assert.match(section, /check its figures with a tool/);
  });
});
