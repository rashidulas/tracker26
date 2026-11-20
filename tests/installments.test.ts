/**
 * Installment plans, paying a friend back on a schedule, and reminders.
 *
 * The running example: a 15,000 camera bought on Fuad's card, paid back
 * monthly over three years.
 */
import { test, beforeEach, describe } from 'vitest';
import assert from 'node:assert/strict';

import {
  buildUpcoming,
  createRecurring,
  paidByRecurring,
  planProgress,
  postRecurringNow,
  runDueRecurring,
  setRecurringActive,
  skipRecurring,
  updateRecurring,
  type RecurringInput,
} from '../lib/recurring';
import { deleteTransaction, updateTransaction } from '../lib/transactions';
import { deleteFriend, updateFriendEntry } from '../lib/friendLedger';
import { signedFriendAmount } from '../lib/friends';
import { computeBalancesForAccounts, friendAccountMovements } from '../lib/accountBalance';
import { buildReminders, reminderNotification, remindLead } from '../lib/reminders';
import { collectReminderNotifications, runReminderNotifications } from '../lib/push';
import { toDayString } from '../lib/dates';
import { FakeDb } from './support/fakeDb';

let db: FakeDb;
let deps: { db: never; revalidate: (p: string) => void };
let ids: { checking: string; electronics: string; housing: string; fuad: string };

beforeEach(() => {
  db = new FakeDb();
  deps = { db: db as never, revalidate: () => {} };
  ids = {
    checking: db.seed('account', { name: 'Checking', type: 'CHECKING', startingBalance: 5000 }).id,
    electronics: db.seed('category', { name: 'Electronics', type: 'EXPENSE', color: '#000' }).id,
    housing: db.seed('category', { name: 'Housing', type: 'EXPENSE', color: '#000' }).id,
    fuad: db.seed('friend', { name: 'Fuad' }).id,
  };
});

function ok<T>(r: { success: true; data: T } | { success: false; error: string }): T {
  if (!r.success) assert.fail(`expected success, got: ${r.error}`);
  return r.data;
}

function err(r: { success: boolean; error?: string }, pattern: RegExp) {
  assert.equal(r.success, false, 'expected failure');
  assert.match(r.error ?? '', pattern);
}

const round = (n: number) => Math.round(n * 100) / 100;

const camera = (over: Partial<RecurringInput> = {}): RecurringInput => ({
  name: 'Camera',
  kind: 'EXPENSE',
  amount: 416.67,
  categoryId: ids.electronics,
  accountId: ids.checking,
  frequency: 'MONTHLY',
  startDate: '2026-12-05',
  friendId: ids.fuad,
  totalAmount: 15000,
  recordDebt: true,
  debtDate: '2026-11-20',
  ...over,
});

/** Positive = Fuad owes me, negative = I owe Fuad. */
function owedByFuad() {
  return round(
    db.data.friendEntry
      .filter((e) => e.friendId === ids.fuad)
      .reduce((sum, e) => sum + signedFriendAmount(e.type, e.amount), 0)
  );
}

function checking() {
  const map = computeBalancesForAccounts(
    db.data.account as never,
    db.data.transaction as never,
    friendAccountMovements(db.data.friendEntry as never)
  );
  return round(map.get(ids.checking)!.balance);
}

async function upcoming(today: string, days = 14) {
  const entries: Record<string, any>[] = db.data.recurringTransaction
    .filter((e) => e.active)
    .map((e) => ({
      ...e,
      friend: e.friendId ? { name: db.data.friend.find((f) => f.id === e.friendId)!.name } : null,
      account: { name: 'Checking' },
    }));
  const paid = await paidByRecurring(db as never, entries.map((e) => e.id));
  return buildUpcoming(entries as never, today, days, paid);
}

describe('installment plan with a friend', () => {
  test('setting it up records the debt and moves no money', async () => {
    const plan = ok(await createRecurring(camera(), deps));
    assert.equal(plan.totalAmount, 15000);
    assert.equal(plan.friendId, ids.fuad);
    assert.equal(owedByFuad(), -15000);
    assert.equal(checking(), 5000);
    assert.equal(db.data.transaction.length, 0);
    const debt = db.data.friendEntry[0];
    assert.equal(debt.type, 'I_OWE_THEM');
    assert.equal(toDayString(debt.date), '2026-11-20');
    assert.equal(debt.description, 'Camera');
  });

  test('without recordDebt the friend balance is left alone', async () => {
    ok(await createRecurring(camera({ recordDebt: false }), deps));
    assert.equal(db.data.friendEntry.length, 0);
  });

  test('a payment is an expense, lowers the debt and moves the account once', async () => {
    const plan = ok(await createRecurring(camera(), deps));
    const result = ok(await postRecurringNow(plan.id, '2026-12-05', { today: '2026-12-05' }, deps));
    assert.equal(result.amount, 416.67);
    assert.equal(result.completed, false);

    const expense = db.data.transaction[0];
    assert.equal(expense.kind, 'EXPENSE');
    assert.equal(expense.amount, 416.67);
    assert.equal(expense.categoryId, ids.electronics);
    assert.equal(expense.recurringId, plan.id);
    assert.equal(expense.sharedAmount, null, 'the payment is all my spending');

    const paidBack = db.data.friendEntry.find((e) => e.type === 'I_PAID_THEM')!;
    assert.equal(paidBack.paymentTransactionId, expense.id);
    assert.equal(paidBack.accountId, null);
    assert.equal(paidBack.transactionId, null);

    assert.equal(owedByFuad(), -14583.33);
    assert.equal(checking(), 4583.33);
    assert.equal(toDayString(db.data.recurringTransaction[0].nextDueDate), '2027-01-05');
  });

  test('36 payments pay it off exactly; the last one is the remainder', async () => {
    const plan = ok(await createRecurring(camera({ autoPost: true }), deps));
    const run = await runDueRecurring({ today: '2030-01-01' }, deps);
    assert.deepEqual(run.errors, []);
    assert.equal(run.posted, 36);

    const amounts = db.data.transaction.map((t) => t.amount);
    assert.equal(amounts.length, 36);
    assert.equal(amounts[0], 416.67);
    assert.equal(amounts[35], 416.55);
    assert.equal(round(amounts.reduce((a, b) => a + b, 0)), 15000);
    assert.equal(toDayString(db.data.transaction[35].date), '2029-11-05');

    assert.equal(owedByFuad(), 0);
    assert.equal(db.data.recurringTransaction[0].active, false);
    // Nothing more comes due, however often the check runs.
    assert.equal((await runDueRecurring({ today: '2031-01-01' }, deps)).posted, 0);
    err(await postRecurringNow(plan.id, '2029-12-05', { today: '2029-12-05' }, deps), /paused/);
    err(await setRecurringActive(plan.id, true, deps), /paid off/);
  });

  test('paying a different amount changes what is left, never more than the rest', async () => {
    const plan = ok(await createRecurring(camera({ totalAmount: 1000, amount: 400 }), deps));
    ok(await postRecurringNow(plan.id, '2026-12-05', { today: '2026-12-05', amount: 700 }, deps));
    assert.equal(owedByFuad(), -300);
    err(
      await postRecurringNow(plan.id, '2027-01-05', { today: '2027-01-05', amount: 500 }, deps),
      /Only \$300\.00 is left/
    );
    const last = ok(await postRecurringNow(plan.id, '2027-01-05', { today: '2027-01-05' }, deps));
    assert.equal(last.amount, 300);
    assert.equal(last.completed, true);
    assert.equal(owedByFuad(), 0);
    assert.equal(db.data.recurringTransaction[0].active, false);
  });

  test('editing or deleting a payment keeps the debt and the plan in step', async () => {
    const plan = ok(await createRecurring(camera({ totalAmount: 1000, amount: 400 }), deps));
    ok(await postRecurringNow(plan.id, '2026-12-05', { today: '2026-12-05' }, deps));
    const expense = db.data.transaction[0];

    ok(
      await updateTransaction(
        expense.id,
        {
          kind: 'EXPENSE',
          date: '2026-12-07',
          amount: 250,
          categoryId: ids.electronics,
          accountId: ids.checking,
        },
        {},
        deps
      )
    );
    const paidBack = db.data.friendEntry.find((e) => e.type === 'I_PAID_THEM')!;
    assert.equal(paidBack.amount, 250);
    assert.equal(toDayString(paidBack.date), '2026-12-07');
    assert.equal(owedByFuad(), -750);
    assert.equal(planProgress(1000, (await paidByRecurring(db as never, [plan.id])).get(plan.id)!, 400).remaining, 750);

    ok(await deleteTransaction(expense.id, {}, deps));
    assert.equal(owedByFuad(), -1000);
    assert.equal(db.data.friendEntry.filter((e) => e.type === 'I_PAID_THEM').length, 0);
    assert.equal(checking(), 5000);
  });

  test('the amount of a payment cannot be changed from the Friends page', async () => {
    const plan = ok(await createRecurring(camera(), deps));
    ok(await postRecurringNow(plan.id, '2026-12-05', { today: '2026-12-05' }, deps));
    const paidBack = db.data.friendEntry.find((e) => e.type === 'I_PAID_THEM')!;
    const base = {
      friendId: ids.fuad,
      date: '2026-12-05',
      amount: 416.67,
      type: 'I_PAID_THEM' as const,
    };
    err(await updateFriendEntry(paidBack.id, { ...base, amount: 100 }, deps), /expense/);
    ok(await updateFriendEntry(paidBack.id, { ...base, notes: 'bank transfer' }, deps));
    assert.equal(db.data.friendEntry.find((e) => e.id === paidBack.id)!.notes, 'bank transfer');
  });

  test('skipping a month pushes the plan out without changing the debt', async () => {
    const plan = ok(await createRecurring(camera(), deps));
    ok(await skipRecurring(plan.id, '2026-12-05', deps));
    assert.equal(owedByFuad(), -15000);
    assert.equal(toDayString(db.data.recurringTransaction[0].nextDueDate), '2027-01-05');
  });

  test('deleting the friend keeps the plan going as a plain expense', async () => {
    const plan = ok(await createRecurring(camera(), deps));
    ok(await deleteFriend(ids.fuad, deps));
    assert.equal(db.data.recurringTransaction[0].friendId, null);
    ok(await postRecurringNow(plan.id, '2026-12-05', { today: '2026-12-05' }, deps));
    assert.equal(db.data.friendEntry.length, 0);
    assert.equal(db.data.transaction.length, 1);
  });

  test('validation', async () => {
    err(await createRecurring(camera({ friendId: '0'.repeat(24) }), deps), /Friend not found/);
    err(await createRecurring(camera({ totalAmount: 100 }), deps), /less than one payment/);
    err(await createRecurring(camera({ endDate: '2027-12-05' }), deps), /no end date/);
    err(
      await createRecurring(
        camera({ kind: 'INCOME', categoryId: ids.electronics }),
        deps
      ),
      /Only an expense/
    );
  });

  test('lowering the total to what is already paid ends the plan', async () => {
    const plan = ok(await createRecurring(camera({ totalAmount: 1000, amount: 400 }), deps));
    ok(await postRecurringNow(plan.id, '2026-12-05', { today: '2026-12-05' }, deps));
    const updated = ok(
      await updateRecurring(
        plan.id,
        camera({ totalAmount: 400, amount: 400, startDate: '2027-01-05', recordDebt: false }),
        deps
      )
    );
    assert.equal(updated.active, false);
  });
});

describe('a regular payment to a friend without a total', () => {
  test('each post pays the friend and never ends', async () => {
    const rent = ok(
      await createRecurring(
        {
          name: 'Rent share',
          kind: 'EXPENSE',
          amount: 600,
          categoryId: ids.housing,
          accountId: ids.checking,
          frequency: 'MONTHLY',
          startDate: '2026-12-01',
          friendId: ids.fuad,
        },
        deps
      )
    );
    ok(await postRecurringNow(rent.id, '2026-12-01', { today: '2026-12-01' }, deps));
    ok(await postRecurringNow(rent.id, '2027-01-01', { today: '2027-01-01' }, deps));
    // Nothing was owed up front, so Fuad is now ahead by what was paid.
    assert.equal(owedByFuad(), 1200);
    assert.equal(db.data.recurringTransaction[0].active, true);
  });
});

describe('upcoming', () => {
  test('a plan lists only the payments that are left, the last as the remainder', async () => {
    ok(await createRecurring(camera({ totalAmount: 1000, amount: 400, frequency: 'WEEKLY' }), deps));
    const items = await upcoming('2026-12-01', 60);
    assert.deepEqual(
      items.map((i) => [i.dueDate, i.amount]),
      [
        ['2026-12-05', 400],
        ['2026-12-12', 400],
        ['2026-12-19', 200],
      ]
    );
    assert.equal(items[0].friendName, 'Fuad');
    assert.equal(items[0].plan!.remaining, 1000);
    assert.equal(items[0].plan!.paymentsLeft, 3);
    assert.equal(items[2].plan!.paymentsLeft, 1);
  });
});

describe('reminders', () => {
  test('remind two days before by default, then on the day, then as overdue', async () => {
    ok(await createRecurring(camera(), deps));
    const at = async (today: string) => buildReminders(await upcoming(today), today);

    assert.equal((await at('2026-12-02')).length, 0);
    const soon = await at('2026-12-03');
    assert.equal(soon.length, 1);
    assert.equal(soon[0].stage, 'soon');
    assert.equal(soon[0].daysUntil, 2);
    assert.equal((await at('2026-12-05'))[0].stage, 'today');
    assert.equal((await at('2026-12-09'))[0].stage, 'overdue');

    const note = reminderNotification(soon[0]);
    assert.match(note.title, /^Due in 2 days \(Sat, Dec 5\): Camera$/);
    assert.match(note.body, /Pay Fuad \$416\.67 for Camera from Checking/);
    assert.match(note.body, /\$14,583\.33 left after this · 35 more payments/);
  });

  test('each entry can set its own lead time or switch reminders off', async () => {
    ok(await createRecurring(camera({ remindDaysBefore: 7 }), deps));
    assert.equal(buildReminders(await upcoming('2026-11-28'), '2026-11-28').length, 1);

    db.data.recurringTransaction[0].remindDaysBefore = -1;
    assert.equal(buildReminders(await upcoming('2026-12-05'), '2026-12-05').length, 0);

    // Entries that post themselves stay quiet unless asked.
    assert.equal(remindLead({ remindDaysBefore: null, autoPost: true }), null);
    assert.equal(remindLead({ remindDaysBefore: 1, autoPost: true }), 1);
    assert.equal(remindLead({ remindDaysBefore: null, autoPost: false }), 2);
  });

  test('a paid occurrence stops reminding', async () => {
    const plan = ok(await createRecurring(camera(), deps));
    ok(await postRecurringNow(plan.id, '2026-12-05', { today: '2026-12-04' }, deps));
    assert.equal(buildReminders(await upcoming('2026-12-05'), '2026-12-05').length, 0);
  });
});

describe('reminder notifications', () => {
  const subscribe = () =>
    db.seed('pushSubscription', { endpoint: 'https://push.example/abc', p256dh: 'k', auth: 'a' });

  test('each stage is sent once, however often the run repeats', async () => {
    ok(await createRecurring(camera(), deps));
    subscribe();
    const sent: { title: string; body: string }[] = [];
    const run = async (today: string) =>
      runReminderNotifications({
        db: db as never,

        reminders: buildReminders(await upcoming(today), today),
        send: async (_subscription, payload) => {
          sent.push(payload);
          return 'sent';
        },
      });

    assert.equal((await run('2026-12-02')).sent, 0);
    assert.equal((await run('2026-12-03')).sent, 1);
    assert.equal((await run('2026-12-03')).sent, 0);
    assert.equal((await run('2026-12-04')).sent, 0, 'still "soon": already told');
    assert.equal((await run('2026-12-05')).sent, 1);
    assert.equal((await run('2026-12-06')).sent, 1);
    assert.equal((await run('2026-12-07')).sent, 0, 'overdue is said once');
    assert.deepEqual(
      sent.map((s) => s.title.split(':')[0]),
      ['Due in 2 days (Sat, Dec 5)', 'Due today', 'Overdue since Dec 5']
    );
  });

  test('nothing is logged while no device is subscribed, and dead devices are dropped', async () => {
    ok(await createRecurring(camera(), deps));
    const today = '2026-12-05';
    const reminders = buildReminders(await upcoming(today), today);
    const none = await runReminderNotifications({
      db: db as never,

      reminders,
      send: async () => 'sent',
    });
    assert.deepEqual(none, { sent: 0, devices: 0, removed: 0 });
    assert.equal(db.data.reminderLog.length, 0);

    subscribe();
    const gone = await runReminderNotifications({
      db: db as never,

      reminders,
      send: async () => 'gone',
    });
    assert.equal(gone.removed, 1);
    assert.equal(db.data.pushSubscription.length, 0);
    assert.equal(db.data.reminderLog.length, 0, 'not delivered, so it can be sent again');
  });

  test('collect picks the stage key', async () => {
    ok(await createRecurring(camera(), deps));
    const today = '2026-12-05';
    const list = collectReminderNotifications(buildReminders(await upcoming(today), today));
    assert.equal(list.length, 1);
    assert.match(list[0].key, /:2026-12-05:today$/);
  });
});
