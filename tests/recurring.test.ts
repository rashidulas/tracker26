/**
 * Recurring entries: schedules, posting exactly once, the due check, the
 * Upcoming list and detection of repeating charges.
 */
import { test, beforeEach, describe } from 'vitest';
import assert from 'node:assert/strict';

import {
  ALREADY_HANDLED,
  buildUpcoming,
  createRecurring,
  deleteRecurring,
  postRecurringNow,
  runDueRecurring,
  skipRecurring,
  updateRecurring,
  type RecurringInput,
} from '../lib/recurring';
import {
  addMonthsClamped,
  firstOnOrAfter,
  nextAfter,
  occurrencesBetween,
  scheduleLabel,
} from '../lib/recurringSchedule';
import { detectRecurring, type DetectionTransaction } from '../lib/recurringDetection';
import { accountDeleteBlocker } from '../lib/references';
import { addDays, parseDay, toDayString } from '../lib/dates';
import { FakeDb } from './support/fakeDb';

let db: FakeDb;
let deps: { db: never; revalidate: (p: string) => void };
let ids: { checking: string; card: string; housing: string; streaming: string; salary: string };

beforeEach(() => {
  db = new FakeDb();
  deps = { db: db as never, revalidate: () => {} };
  ids = {
    checking: db.seed('account', { name: 'Checking', type: 'CHECKING', startingBalance: 5000 }).id,
    card: db.seed('account', { name: 'Card', type: 'CREDIT_CARD', startingBalance: 0 }).id,
    housing: db.seed('category', { name: 'Housing', type: 'EXPENSE', color: '#000' }).id,
    streaming: db.seed('category', { name: 'Streaming', type: 'EXPENSE', color: '#000' }).id,
    salary: db.seed('category', { name: 'Salary', type: 'INCOME', color: '#000' }).id,
  };
});

function ok<T>(r: { success: true; data: T } | { success: false; error: string }): T {
  if (!r.success) assert.fail(`expected success, got: ${r.error}`);
  return r.data;
}

const rent = (over: Partial<RecurringInput> = {}): RecurringInput => ({
  name: 'Rent',
  kind: 'EXPENSE',
  amount: 1800,
  categoryId: ids.housing,
  accountId: ids.checking,
  merchantOrSource: 'Oak Street Apartments',
  frequency: 'MONTHLY',
  startDate: '2026-12-01',
  autoPost: false,
  ...over,
});

// ==================== SCHEDULE ====================

describe('schedule', () => {
  test('monthly on the 31st clamps to short months without drifting', () => {
    assert.deepEqual(occurrencesBetween('2026-01-31', 'MONTHLY', '2026-01-01', '2026-05-31'), [
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
    ]);
    assert.equal(nextAfter('2026-01-31', 'MONTHLY', '2026-02-28'), '2026-03-31');
  });

  test('weekly, every two weeks and yearly', () => {
    assert.equal(nextAfter('2026-11-06', 'WEEKLY', '2026-11-06'), '2026-11-13');
    assert.equal(nextAfter('2026-11-06', 'BIWEEKLY', '2026-11-10'), '2026-11-20');
    assert.equal(firstOnOrAfter('2024-02-29', 'YEARLY', '2025-01-01'), '2025-02-28');
    assert.equal(firstOnOrAfter('2024-02-29', 'YEARLY', '2027-03-01'), '2028-02-29');
    assert.equal(addMonthsClamped('2026-12-15', 1), '2027-01-15');
  });

  test('labels say which day', () => {
    assert.equal(scheduleLabel('MONTHLY', '2026-12-01'), 'Monthly on the 1st');
    assert.equal(scheduleLabel('BIWEEKLY', '2026-11-20'), 'Every two weeks on Friday');
    assert.equal(scheduleLabel('YEARLY', '2027-03-04'), 'Yearly on Mar 4');
  });
});

// ==================== POSTING ====================

describe('posting', () => {
  test('monthly rent shows in Upcoming and posts exactly once', async () => {
    const entry = ok(await createRecurring(rent(), deps));
    assert.equal(toDayString(entry.nextDueDate), '2026-12-01');

    const upcoming = buildUpcoming(db.data.recurringTransaction as never, '2026-11-18');
    assert.equal(upcoming.length, 1);
    assert.equal(upcoming[0].dueDate, '2026-12-01');
    assert.equal(upcoming[0].actionable, true);

    // Post now, then tap it again (double tap, second tab, stale page).
    const first = await postRecurringNow(entry.id, '2026-12-01', { today: '2026-12-01' }, deps);
    const second = await postRecurringNow(entry.id, '2026-12-01', { today: '2026-12-01' }, deps);
    assert.equal(first.success, true);
    assert.deepEqual(second, { success: false, error: ALREADY_HANDLED });

    const posted = db.data.transaction.filter((t) => t.recurringId === entry.id);
    assert.equal(posted.length, 1);
    assert.equal(toDayString(posted[0].date), '2026-12-01');
    assert.equal(posted[0].amount, 1800);
    assert.equal(posted[0].categoryId, ids.housing);
    assert.equal(posted[0].merchantOrSource, 'Oak Street Apartments');
    assert.ok(posted[0].merchantId, 'posted row is linked to the merchant');

    assert.equal(toDayString(db.data.recurringTransaction[0].nextDueDate), '2027-01-01');
    assert.equal(db.data.recurringPosting.length, 1);
  });

  test('posting early is dated today; manual entries are never auto-posted', async () => {
    const entry = ok(await createRecurring(rent(), deps));
    const due = await runDueRecurring({ today: '2026-12-20' }, deps);
    assert.deepEqual(due, { posted: 0, errors: [] });

    ok(await postRecurringNow(entry.id, '2026-12-01', { today: '2026-11-28' }, deps));
    assert.equal(toDayString(db.data.transaction[0].date), '2026-11-28');
  });

  test('the due check auto-posts each missed occurrence once, however often it runs', async () => {
    const entry = ok(await createRecurring(rent({ autoPost: true, startDate: '2026-09-01' }), deps));
    const run1 = await runDueRecurring({ today: '2026-11-18' }, deps);
    const run2 = await runDueRecurring({ today: '2026-11-18' }, deps);
    const run3 = await runDueRecurring({ today: '2026-11-18' }, deps);
    assert.equal(run1.posted, 3);
    assert.equal(run2.posted, 0);
    assert.equal(run3.posted, 0);
    const days = db.data.transaction.map((t) => toDayString(t.date)).sort();
    assert.deepEqual(days, ['2026-09-01', '2026-10-01', '2026-11-01']);
    assert.equal(toDayString(db.data.recurringTransaction[0].nextDueDate), '2026-12-01');
    assert.equal(entry.autoPost, true);
  });

  test('a racing second run is stopped by the unique posting index', async () => {
    const entry = ok(await createRecurring(rent({ autoPost: true, startDate: '2026-11-01' }), deps));
    // Simulate a run that recorded the posting but whose nextDueDate update we
    // have not seen yet: the posting row alone must block a second post.
    db.seed('recurringPosting', {
      recurringId: entry.id,
      dueDate: parseDay('2026-11-01'),
      status: 'POSTED',
    });
    const r = await runDueRecurring({ today: '2026-11-18' }, deps);
    assert.deepEqual(r, { posted: 0, errors: [] });
    assert.equal(db.data.transaction.length, 0, 'rolled back: no duplicate transaction');
  });

  test('skip moves to the next occurrence without a transaction', async () => {
    const entry = ok(await createRecurring(rent(), deps));
    ok(await skipRecurring(entry.id, '2026-12-01', deps));
    assert.equal(db.data.transaction.length, 0);
    assert.equal(toDayString(db.data.recurringTransaction[0].nextDueDate), '2027-01-01');
    const again = await skipRecurring(entry.id, '2026-12-01', deps);
    assert.equal(again.success, false);
  });

  test('stops after the end date', async () => {
    const entry = ok(
      await createRecurring(rent({ autoPost: true, startDate: '2026-09-01', endDate: '2026-10-15' }), deps)
    );
    const r = await runDueRecurring({ today: '2026-11-18' }, deps);
    assert.equal(r.posted, 2);
    const stored = db.data.recurringTransaction.find((e) => e.id === entry.id)!;
    assert.equal(stored.active, false);
  });

  test('a broken template is reported, not half-posted', async () => {
    const entry = ok(await createRecurring(rent({ autoPost: true, startDate: '2026-11-01' }), deps));
    db.data.category = db.data.category.filter((c) => c.id !== ids.housing);
    const r = await runDueRecurring({ today: '2026-11-18' }, deps);
    assert.equal(r.posted, 0);
    assert.equal(r.errors.length, 1);
    assert.equal(r.errors[0].error, 'Category not found');
    assert.equal(db.data.recurringPosting.length, 0);
    assert.equal(toDayString(db.data.recurringTransaction[0].nextDueDate), '2026-11-01');
    assert.equal(entry.name, 'Rent');
  });

  test('transfers post with both accounts and no merchant link', async () => {
    const entry = ok(
      await createRecurring(
        {
          kind: 'TRANSFER',
          amount: 200,
          accountId: ids.checking,
          toAccountId: ids.card,
          frequency: 'BIWEEKLY',
          startDate: '2026-11-20',
        },
        deps
      )
    );
    assert.equal(entry.name, 'Transfer');
    ok(await postRecurringNow(entry.id, '2026-11-20', { today: '2026-11-20' }, deps));
    const t = db.data.transaction[0];
    assert.equal(t.kind, 'TRANSFER');
    assert.equal(t.toAccountId, ids.card);
    assert.equal(t.merchantId, null);
    assert.equal(toDayString(db.data.recurringTransaction[0].nextDueDate), '2026-12-04');
  });

  test('validation: category kind and transfer accounts', async () => {
    const wrongKind = await createRecurring(rent({ categoryId: ids.salary }), deps);
    assert.deepEqual(wrongKind, { success: false, error: 'That category is not an expense category' });
    const sameAccount = await createRecurring(
      { ...rent(), kind: 'TRANSFER', toAccountId: ids.checking },
      deps
    );
    assert.deepEqual(sameAccount, { success: false, error: 'From and To accounts cannot be the same' });
  });

  test('editing the next due date re-anchors; editing the amount does not', async () => {
    const entry = ok(await createRecurring(rent(), deps));
    ok(await updateRecurring(entry.id, rent({ amount: 1850 }), deps));
    assert.equal(toDayString(db.data.recurringTransaction[0].nextDueDate), '2026-12-01');
    ok(await updateRecurring(entry.id, rent({ startDate: '2026-12-03' }), deps));
    assert.equal(toDayString(db.data.recurringTransaction[0].nextDueDate), '2026-12-03');
    assert.equal(toDayString(db.data.recurringTransaction[0].startDate), '2026-12-03');
  });

  test('deleting an entry keeps its transactions but unlinks them', async () => {
    const entry = ok(await createRecurring(rent(), deps));
    ok(await postRecurringNow(entry.id, '2026-12-01', { today: '2026-12-01' }, deps));
    ok(await deleteRecurring(entry.id, deps));
    assert.equal(db.data.transaction.length, 1);
    assert.equal(db.data.transaction[0].recurringId, null);
    assert.equal(db.data.recurringPosting.length, 0);
  });

  test('accounts used by a recurring entry cannot be deleted', async () => {
    ok(await createRecurring(rent(), deps));
    const blocker = await accountDeleteBlocker(db as never, ids.checking, 'Checking');
    assert.match(blocker ?? '', /1 recurring entry/);
  });

  test('accepting a suggestion links the matched history', async () => {
    const past = ['2026-08-01', '2026-09-01', '2026-10-01'].map((d) =>
      db.seed('transaction', {
        kind: 'EXPENSE',
        date: parseDay(d),
        amount: 1800,
        categoryId: ids.housing,
        accountId: ids.checking,
        merchantOrSource: 'oak street  apartments',
      })
    );
    const other = db.seed('transaction', {
      kind: 'EXPENSE',
      date: parseDay('2026-10-05'),
      amount: 20,
      categoryId: ids.housing,
      accountId: ids.checking,
      merchantOrSource: 'Hardware store',
    });
    const entry = ok(
      await createRecurring(
        rent({ linkTransactionIds: [...past.map((p) => p.id), other.id] }),
        deps
      )
    );
    assert.equal(entry.linked, 3);
    assert.equal(db.data.transaction.find((t) => t.id === other.id)!.recurringId, null);
  });
});

describe('upcoming', () => {
  test('lists every occurrence in the next 14 days, only the first is actionable', async () => {
    const weekly = ok(
      await createRecurring(
        rent({ name: 'Cleaner', amount: 60, frequency: 'WEEKLY', startDate: '2026-11-16' }),
        deps
      )
    );
    ok(await createRecurring(rent({ startDate: '2027-01-01' }), deps)); // beyond 14 days
    const items = buildUpcoming(db.data.recurringTransaction as never, '2026-11-18');
    assert.deepEqual(
      items.map((i) => [i.dueDate, i.overdue, i.actionable]),
      [
        ['2026-11-16', true, true],
        ['2026-11-23', false, false],
        ['2026-11-30', false, false],
      ]
    );
    assert.equal(items[0].recurringId, weekly.id);
  });
});

// ==================== DETECTION ====================

describe('detection', () => {
  let n = 0;
  const tx = (date: string, amount: number, merchant: string, over: Partial<DetectionTransaction> = {}) => {
    n += 1;
    return {
      id: `t${n}`,
      date,
      amount,
      kind: 'EXPENSE' as const,
      merchantOrSource: merchant,
      categoryId: 'cat',
      accountId: 'acc',
      ...over,
    };
  };

  test('finds a monthly charge with small amount and date drift', () => {
    const history = [
      tx('2026-07-03', 15.49, 'Netflix'),
      tx('2026-08-02', 15.49, 'netflix'),
      tx('2026-09-04', 15.99, 'NETFLIX '),
      tx('2026-10-03', 15.99, 'Netflix'),
      tx('2026-11-02', 16.49, 'Netflix'),
    ];
    const [s, ...rest] = detectRecurring(history, { today: '2026-11-18' });
    assert.equal(rest.length, 0);
    assert.equal(s.frequency, 'MONTHLY');
    assert.equal(s.occurrences, 5);
    assert.equal(s.amount, 16.49);
    assert.equal(s.nextDueDate, '2026-12-02');
  });

  test('weekly and every-two-weeks', () => {
    const weekly = ['2026-10-21', '2026-10-28', '2026-11-04', '2026-11-12'].map((d) =>
      tx(d, 40, 'Yoga Studio')
    );
    const pay = ['2026-10-02', '2026-10-16', '2026-10-30', '2026-11-13'].map((d) =>
      tx(d, 2500, 'Acme Corp', { kind: 'INCOME' })
    );
    const found = detectRecurring([...weekly, ...pay], { today: '2026-11-18' });
    const byName = Object.fromEntries(found.map((s) => [s.merchantName, s]));
    assert.equal(byName['Yoga Studio'].frequency, 'WEEKLY');
    assert.equal(byName['Acme Corp'].frequency, 'BIWEEKLY');
    assert.equal(byName['Acme Corp'].kind, 'INCOME');
    assert.equal(byName['Acme Corp'].nextDueDate, '2026-11-27');
  });

  test('ignores amounts that differ by more than about 7.5%', () => {
    const history = [
      tx('2026-08-01', 50, 'Grocer'),
      tx('2026-09-01', 80, 'Grocer'),
      tx('2026-10-01', 50, 'Grocer'),
      tx('2026-11-01', 95, 'Grocer'),
    ];
    assert.deepEqual(detectRecurring(history, { today: '2026-11-18' }), []);
  });

  test('ignores dates more than about 2 days off the interval', () => {
    const history = [
      tx('2026-08-01', 30, 'Gym'),
      tx('2026-09-06', 30, 'Gym'),
      tx('2026-10-01', 30, 'Gym'),
      tx('2026-11-05', 30, 'Gym'),
    ];
    assert.deepEqual(detectRecurring(history, { today: '2026-11-18' }), []);
  });

  test('skips cancelled series, existing entries, dismissed and linked rows', () => {
    const stale = ['2026-03-01', '2026-04-01', '2026-05-01'].map((d) => tx(d, 9.99, 'Old App'));
    const covered = ['2026-09-01', '2026-10-01', '2026-11-01'].map((d) => tx(d, 1800, 'Landlord'));
    const dismissed = ['2026-09-10', '2026-10-10', '2026-11-10'].map((d) => tx(d, 12, 'News'));
    const linked = ['2026-09-15', '2026-10-15', '2026-11-15'].map((d) =>
      tx(d, 70, 'Phone', { recurringId: 'r1' })
    );
    const all = [...stale, ...covered, ...dismissed, ...linked];
    const first = detectRecurring(all, { today: '2026-11-18' });
    const newsKey = first.find((s) => s.merchantName === 'News')!.key;
    const found = detectRecurring(all, {
      today: '2026-11-18',
      existing: [{ kind: 'EXPENSE', merchantOrSource: 'landlord', amount: 1800 }],
      dismissed: [newsKey],
    });
    assert.deepEqual(found, []);
  });

  test('a yearly charge needs two occurrences', () => {
    const history = [tx('2025-03-10', 99, 'Domain'), tx('2026-03-11', 99, 'Domain')];
    const [s] = detectRecurring(history, { today: '2026-11-18' });
    assert.equal(s.frequency, 'YEARLY');
    assert.equal(s.nextDueDate, '2027-03-11');
  });

  test('one-off extra purchases at the same merchant do not break the series', () => {
    const history = [
      tx('2026-08-05', 10.99, 'Spotify'),
      tx('2026-09-05', 10.99, 'Spotify'),
      tx('2026-09-20', 10.99, 'Spotify'), // gift card, same price
      tx('2026-10-05', 10.99, 'Spotify'),
      tx('2026-11-05', 10.99, 'Spotify'),
    ];
    const [s] = detectRecurring(history, { today: '2026-11-18' });
    assert.equal(s.frequency, 'MONTHLY');
    assert.equal(s.occurrences, 4);
    assert.equal(addDays(s.lastDate, 0), '2026-11-05');
  });
});
