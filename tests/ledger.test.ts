/**
 * Friends and goals as part of the ledger: a split expense and its IOUs, friend
 * settlements through accounts, and goal contributions as transfers or
 * earmarks. Balances come from the same helpers the Accounts page and the
 * dashboard use (computeBalancesForAccounts + friendAccountMovements +
 * earmarkedByAccount).
 *
 * Run: npm test (vitest)
 */
import { test, beforeEach, describe } from 'vitest';
import assert from 'node:assert/strict';

import {
  createTransaction,
  updateTransaction,
  deleteTransaction,
  deleteTransactions,
  duplicateTransactions,
  expenseCategoryAllocations,
  myShareOfExpense,
  TRANSACTION_PAGES,
  type TransactionDeps,
} from '../lib/transactions';
import {
  createFriendEntry,
  updateFriendEntry,
  deleteFriendEntry,
  deleteFriend,
} from '../lib/friendLedger';
import {
  createGoal,
  updateGoal,
  deleteGoal,
  createContribution,
  updateContribution,
  deleteContribution,
} from '../lib/goalLedger';
import {
  computeBalancesForAccounts,
  earmarkedByAccount,
  friendAccountMovements,
} from '../lib/accountBalance';
import { signedFriendAmount } from '../lib/friends';
import { goalProgress } from '../lib/goals';
import { accountDeleteBlocker } from '../lib/references';
import { FakeDb } from './support/fakeDb';

let db: FakeDb;
let revalidated: string[];
let deps: TransactionDeps;
let ids: {
  checking: string;
  savings: string;
  card: string;
  dining: string;
  alex: string;
  sam: string;
};

beforeEach(() => {
  db = new FakeDb();
  revalidated = [];
  deps = { db: db as never, revalidate: (p) => revalidated.push(p) };
  ids = {
    checking: db.seed('account', { name: 'Checking', type: 'CHECKING', startingBalance: 1000 }).id,
    savings: db.seed('account', { name: 'Savings', type: 'SAVINGS', startingBalance: 500 }).id,
    card: db.seed('account', { name: 'Card', type: 'CREDIT_CARD', startingBalance: 0 }).id,
    dining: db.seed('category', { name: 'Dining', type: 'EXPENSE', color: '#000' }).id,
    alex: db.seed('friend', { name: 'Alex' }).id,
    sam: db.seed('friend', { name: 'Sam' }).id,
  };
});

const round = (n: number) => Math.round(n * 100) / 100;

/** Balances exactly as lib/ledgerBalances.ts computes them. */
function balances() {
  const map = computeBalancesForAccounts(
    db.data.account as never,
    db.data.transaction as never,
    friendAccountMovements(db.data.friendEntry as never)
  );
  const out: Record<string, number> = {};
  for (const a of db.data.account) out[a.name] = round(map.get(a.id)!.balance);
  return out;
}

function earmarks() {
  const map = earmarkedByAccount(db.data.goalContribution as never);
  const out: Record<string, number> = {};
  for (const a of db.data.account) if (map.has(a.id)) out[a.name] = round(map.get(a.id)!);
  return out;
}

function friendBalance(friendId: string) {
  return round(
    db.data.friendEntry
      .filter((e) => e.friendId === friendId)
      .reduce((sum, e) => sum + signedFriendAmount(e.type, e.amount), 0)
  );
}

function ok<T>(result: { success: true; data: T } | { success: false; error: string }): T {
  if (!result.success) assert.fail(`expected success, got: ${result.error}`);
  return result.data;
}

function err(result: { success: boolean; error?: string }, pattern: RegExp) {
  assert.equal(result.success, false, 'expected failure');
  assert.match(result.error ?? '', pattern);
}

const dinner = (extra: Record<string, unknown> = {}) => ({
  kind: 'EXPENSE' as const,
  date: '2026-11-10',
  amount: 60,
  categoryId: ids.dining,
  accountId: ids.checking,
  merchantOrSource: 'Luigi’s',
  ...extra,
});

const START = { Checking: 1000, Savings: 500, Card: 0 };

describe('splitting an expense with friends', () => {
  test('creates one expense and one IOU that reference each other', async () => {
    const expense = ok(
      await createTransaction(dinner({ friendSplits: [{ friendId: ids.alex, amount: 30 }] }), deps)
    );

    assert.equal(db.data.transaction.length, 1);
    assert.equal(db.data.friendEntry.length, 1);
    const entry = db.data.friendEntry[0];
    assert.equal(entry.transactionId, expense.id);
    assert.equal(entry.friendId, ids.alex);
    assert.equal(entry.type, 'THEY_OWE_ME');
    assert.equal(entry.amount, 30);
    assert.equal(entry.accountId, null);
    assert.equal(entry.description, 'Luigi’s');
    assert.deepEqual(entry.date, db.data.transaction[0].date);
    assert.equal(db.data.transaction[0].sharedAmount, 30);
    // the expense finds its IOUs through FriendEntry.transactionId
    assert.deepEqual(
      db.data.friendEntry.filter((e) => e.transactionId === expense.id).map((e) => e.id),
      [entry.id]
    );

    // Account pays the full amount; spending and categories count my share.
    assert.deepEqual(balances(), { ...START, Checking: 940 });
    assert.equal(myShareOfExpense(db.data.transaction[0] as never), 30);
    assert.deepEqual(expenseCategoryAllocations(db.data.transaction[0] as never), [
      { categoryId: ids.dining, amount: 30 },
    ]);
    assert.equal(friendBalance(ids.alex), 30);
    assert.equal(db.commits, 1, 'expense and IOU are one database transaction');
    for (const page of ['/friends', '/plan/goals', '/']) assert.ok(revalidated.includes(page));
  });

  test('settling up moves the chosen account', async () => {
    ok(await createTransaction(dinner({ friendSplits: [{ friendId: ids.alex, amount: 30 }] }), deps));
    ok(
      await createFriendEntry(
        {
          friendId: ids.alex,
          date: '2026-11-12',
          amount: 30,
          type: 'THEY_PAID_ME',
          accountId: ids.savings,
        },
        deps
      )
    );
    assert.equal(friendBalance(ids.alex), 0);
    assert.deepEqual(balances(), { ...START, Checking: 940, Savings: 530 });
  });

  test('lending, borrowing and repaying through accounts', async () => {
    const base = { friendId: ids.sam, date: '2026-11-01' };
    ok(await createFriendEntry({ ...base, amount: 100, type: 'THEY_OWE_ME', accountId: ids.checking }, deps));
    assert.deepEqual(balances(), { ...START, Checking: 900 });
    ok(await createFriendEntry({ ...base, amount: 40, type: 'I_OWE_THEM', accountId: ids.savings }, deps));
    assert.deepEqual(balances(), { ...START, Checking: 900, Savings: 540 });
    ok(await createFriendEntry({ ...base, amount: 40, type: 'I_PAID_THEM', accountId: ids.savings }, deps));
    assert.deepEqual(balances(), { ...START, Checking: 900, Savings: 500 });
    // no account: an IOU only, balances unchanged
    ok(await createFriendEntry({ ...base, amount: 5, type: 'THEY_OWE_ME' }, deps));
    assert.deepEqual(balances(), { ...START, Checking: 900 });
    assert.equal(friendBalance(ids.sam), 105);
  });

  test('editing a settlement moves the balance to the new account', async () => {
    const entry = ok(
      await createFriendEntry(
        { friendId: ids.alex, date: '2026-11-12', amount: 30, type: 'THEY_PAID_ME', accountId: ids.checking },
        deps
      )
    );
    ok(
      await updateFriendEntry(
        entry.id,
        { friendId: ids.alex, date: '2026-11-13', amount: 25, type: 'THEY_PAID_ME', accountId: ids.savings },
        deps
      )
    );
    assert.deepEqual(balances(), { ...START, Savings: 525 });
    ok(
      await updateFriendEntry(
        entry.id,
        { friendId: ids.alex, date: '2026-11-13', amount: 25, type: 'THEY_PAID_ME', accountId: null },
        deps
      )
    );
    assert.deepEqual(balances(), START);
    err(
      await updateFriendEntry(
        entry.id,
        { friendId: ids.alex, date: '2026-11-13', amount: 25, type: 'THEY_PAID_ME', accountId: 'f'.repeat(24) },
        deps
      ),
      /Account not found/
    );
  });

  test('equal three-way split and changing who is in it', async () => {
    const expense = ok(
      await createTransaction(
        dinner({
          amount: 90,
          friendSplits: [
            { friendId: ids.alex, amount: 30 },
            { friendId: ids.sam, amount: 30 },
          ],
        }),
        deps
      )
    );
    assert.equal(db.data.transaction[0].sharedAmount, 60);
    const alexEntryId = db.data.friendEntry.find((e) => e.friendId === ids.alex)!.id;

    // Drop Sam, Alex now owes 45: Alex's entry is updated in place.
    ok(
      await updateTransaction(
        expense.id,
        dinner({ amount: 90, friendSplits: [{ friendId: ids.alex, amount: 45 }] }),
        {},
        deps
      )
    );
    assert.equal(db.data.friendEntry.length, 1);
    assert.equal(db.data.friendEntry[0].id, alexEntryId);
    assert.equal(db.data.friendEntry[0].amount, 45);
    assert.equal(db.data.transaction[0].sharedAmount, 45);
    assert.equal(friendBalance(ids.sam), 0);
  });

  test('editing the expense without the split keeps it and moves its date', async () => {
    const expense = ok(
      await createTransaction(dinner({ friendSplits: [{ friendId: ids.alex, amount: 30 }] }), deps)
    );
    ok(await updateTransaction(expense.id, dinner({ amount: 70, date: '2026-11-11', merchantOrSource: 'Luigi' }), {}, deps));
    const entry = db.data.friendEntry[0];
    assert.equal(entry.amount, 30);
    assert.equal(entry.description, 'Luigi', 'auto description follows the merchant');
    assert.equal(entry.date.toISOString().slice(0, 10), '2026-11-11');
    assert.equal(db.data.transaction[0].sharedAmount, 30);
    assert.deepEqual(balances(), { ...START, Checking: 930 });

    // A description typed by hand is kept.
    ok(
      await updateFriendEntry(
        entry.id,
        { friendId: ids.alex, date: '2026-11-11', amount: 30, type: 'THEY_OWE_ME', description: 'Pizza night' },
        deps
      )
    );
    ok(await updateTransaction(expense.id, dinner({ amount: 70, merchantOrSource: 'Luigi’s Pizza' }), {}, deps));
    assert.equal(db.data.friendEntry[0].description, 'Pizza night');
  });

  test('shares larger than the expense are refused and nothing is written', async () => {
    err(
      await createTransaction(
        dinner({
          friendSplits: [
            { friendId: ids.alex, amount: 40 },
            { friendId: ids.sam, amount: 30 },
          ],
        }),
        deps
      ),
      /can't be more than the expense/
    );
    assert.equal(db.data.transaction.length, 0);
    assert.equal(db.data.friendEntry.length, 0);

    const expense = ok(
      await createTransaction(dinner({ friendSplits: [{ friendId: ids.alex, amount: 30 }] }), deps)
    );
    err(await updateTransaction(expense.id, dinner({ amount: 20 }), {}, deps), /can't be more/);
    assert.equal(db.data.transaction[0].amount, 60, 'rolled back');
    assert.equal(db.data.friendEntry[0].amount, 30);
  });

  test('unknown or repeated friends are refused', async () => {
    err(
      await createTransaction(dinner({ friendSplits: [{ friendId: 'a'.repeat(24), amount: 10 }] }), deps),
      /Friend not found/
    );
    err(
      await createTransaction(
        dinner({
          friendSplits: [
            { friendId: ids.alex, amount: 10 },
            { friendId: ids.alex, amount: 10 },
          ],
        }),
        deps
      ),
      /only be in a split once/
    );
    assert.equal(db.data.transaction.length, 0);
  });

  test('clearing the split deletes the IOU', async () => {
    const expense = ok(
      await createTransaction(dinner({ friendSplits: [{ friendId: ids.alex, amount: 30 }] }), deps)
    );
    ok(await updateTransaction(expense.id, dinner({ friendSplits: [] }), {}, deps));
    assert.equal(db.data.friendEntry.length, 0);
    assert.equal(db.data.transaction[0].sharedAmount, null);
    assert.equal(myShareOfExpense(db.data.transaction[0] as never), 60);
  });

  test('editing a linked IOU on the Friends page updates the expense share', async () => {
    const expense = ok(
      await createTransaction(dinner({ friendSplits: [{ friendId: ids.alex, amount: 30 }] }), deps)
    );
    const entryId = db.data.friendEntry[0].id;
    const edit = (patch: Record<string, unknown>) =>
      updateFriendEntry(
        entryId,
        { friendId: ids.alex, date: '2026-11-10', amount: 30, type: 'THEY_OWE_ME', ...patch } as never,
        deps
      );

    ok(await edit({ amount: 20, date: '2030-01-01' }));
    assert.equal(db.data.transaction[0].sharedAmount, 20);
    assert.equal(
      db.data.friendEntry[0].date.toISOString().slice(0, 10),
      '2026-11-10',
      'date follows the expense'
    );
    err(await edit({ amount: 61 }), /can't be more than the expense/);
    assert.equal(db.data.friendEntry[0].amount, 20, 'rolled back');
    err(await edit({ type: 'THEY_PAID_ME' }), /stays "They owe me"/);
    err(await edit({ accountId: ids.savings }), /already moved the money/);
    assert.deepEqual(balances(), { ...START, Checking: 940 });

    ok(await deleteFriendEntry(entryId, deps));
    assert.equal(db.data.transaction[0].sharedAmount, null);
    assert.equal(db.data.transaction[0].id, expense.id);
  });

  test('deleting the expense deletes its IOUs, one by one or in bulk', async () => {
    const one = ok(
      await createTransaction(dinner({ friendSplits: [{ friendId: ids.alex, amount: 30 }] }), deps)
    );
    const two = ok(
      await createTransaction(dinner({ friendSplits: [{ friendId: ids.sam, amount: 10 }] }), deps)
    );
    ok(await deleteTransaction(one.id, {}, deps));
    assert.deepEqual(
      db.data.friendEntry.map((e) => e.friendId),
      [ids.sam]
    );
    ok(await deleteTransactions([two.id], deps));
    assert.equal(db.data.friendEntry.length, 0);
    assert.deepEqual(balances(), START);
  });

  test('deleting a friend gives their shares back to you', async () => {
    ok(
      await createTransaction(
        dinner({
          friendSplits: [
            { friendId: ids.alex, amount: 20 },
            { friendId: ids.sam, amount: 20 },
          ],
        }),
        deps
      )
    );
    ok(await deleteFriend(ids.alex, deps));
    assert.equal(db.data.transaction[0].sharedAmount, 20);
    assert.deepEqual(
      db.data.friendEntry.map((e) => e.friendId),
      [ids.sam]
    );
    assert.equal(db.data.friend.length, 1);
  });

  test('a duplicated split expense is not split', async () => {
    const expense = ok(
      await createTransaction(dinner({ friendSplits: [{ friendId: ids.alex, amount: 30 }] }), deps)
    );
    const [copy] = ok(await duplicateTransactions([expense.id], '2026-11-20', deps));
    assert.equal(copy.sharedAmount ?? null, null);
    assert.equal(db.data.friendEntry.length, 1);
  });

  test('an account with friend settlements cannot be deleted', async () => {
    ok(
      await createFriendEntry(
        { friendId: ids.alex, date: '2026-11-12', amount: 30, type: 'THEY_PAID_ME', accountId: ids.card },
        deps
      )
    );
    assert.match((await accountDeleteBlocker(db as never, ids.card)) ?? '', /1 friend entry paid/);
  });
});

describe('goal contributions', () => {
  async function goal(accountId: string | null = null) {
    return ok(
      await createGoal({ name: 'Trip', targetAmount: 1000, dueDate: '2027-06-01', accountId }, deps)
    );
  }

  function progress(goalId: string) {
    return goalProgress({
      targetAmount: db.data.goal.find((g) => g.id === goalId)!.targetAmount,
      contributions: db.data.goalContribution.filter((c) => c.goalId === goalId) as never,
    });
  }

  test('with a goal account, a contribution is a real transfer', async () => {
    const g = await goal(ids.savings);
    const c = ok(
      await createContribution(
        { goalId: g.id, date: '2026-11-05', amount: 200, fromAccountId: ids.checking },
        deps
      )
    );
    assert.equal(db.data.transaction.length, 1);
    const transfer = db.data.transaction[0];
    assert.equal(transfer.kind, 'TRANSFER');
    assert.equal(transfer.accountId, ids.checking);
    assert.equal(transfer.toAccountId, ids.savings);
    assert.equal(transfer.merchantOrSource, 'Goal: Trip');
    assert.equal(c.transactionId, transfer.id);
    assert.deepEqual(balances(), { ...START, Checking: 800, Savings: 700 });
    assert.deepEqual(earmarks(), {});
    assert.equal(progress(g.id).totalContributions, 200);
    assert.equal(progress(g.id).progress, 20);
    assert.equal(db.commits, 2, 'goal, then contribution + transfer together');
  });

  test('without a goal account, a contribution is an earmark', async () => {
    const g = await goal();
    ok(
      await createContribution(
        { goalId: g.id, date: '2026-11-05', amount: 150, fromAccountId: ids.checking },
        deps
      )
    );
    assert.equal(db.data.transaction.length, 0);
    assert.deepEqual(balances(), START, 'balance unchanged');
    assert.deepEqual(earmarks(), { Checking: 150 }, 'available goes down');
    assert.equal(progress(g.id).earmarked, 150);
  });

  test('editing a contribution keeps its transfer in step, or switches kind', async () => {
    const g = await goal(ids.savings);
    const c = ok(
      await createContribution(
        { goalId: g.id, date: '2026-11-05', amount: 200, fromAccountId: ids.checking },
        deps
      )
    );
    const transferId = c.transactionId;

    ok(await updateContribution(c.id, { date: '2026-11-06', amount: 250, fromAccountId: ids.checking }, deps));
    assert.equal(db.data.transaction.length, 1);
    assert.equal(db.data.transaction[0].id, transferId, 'same transfer, edited');
    assert.equal(db.data.transaction[0].amount, 250);
    assert.deepEqual(balances(), { ...START, Checking: 750, Savings: 750 });

    // Money already in the goal account: no transfer, an earmark there.
    ok(await updateContribution(c.id, { date: '2026-11-06', amount: 250, fromAccountId: ids.savings }, deps));
    assert.equal(db.data.transaction.length, 0);
    assert.equal(db.data.goalContribution[0].transactionId, null);
    assert.deepEqual(balances(), START);
    assert.deepEqual(earmarks(), { Savings: 250 });

    ok(await updateContribution(c.id, { date: '2026-11-07', amount: 100, fromAccountId: ids.checking }, deps));
    assert.equal(db.data.transaction.length, 1);
    assert.equal(db.data.goalContribution[0].transactionId, db.data.transaction[0].id);
    assert.deepEqual(balances(), { ...START, Checking: 900, Savings: 600 });
    assert.deepEqual(earmarks(), {});
  });

  test('deleting a contribution deletes its transfer', async () => {
    const g = await goal(ids.savings);
    const c = ok(
      await createContribution(
        { goalId: g.id, date: '2026-11-05', amount: 200, fromAccountId: ids.checking },
        deps
      )
    );
    ok(await deleteContribution(c.id, deps));
    assert.equal(db.data.goalContribution.length, 0);
    assert.equal(db.data.transaction.length, 0);
    assert.deepEqual(balances(), START);

    const g2 = await goal();
    const e = ok(
      await createContribution(
        { goalId: g2.id, date: '2026-11-05', amount: 50, fromAccountId: ids.checking },
        deps
      )
    );
    ok(await deleteContribution(e.id, deps));
    assert.deepEqual(earmarks(), {});
  });

  test('the transfer and the contribution stay in step from the Transfers page', async () => {
    const g = await goal(ids.savings);
    const c = ok(
      await createContribution(
        { goalId: g.id, date: '2026-11-05', amount: 200, fromAccountId: ids.checking },
        deps
      )
    );
    const transfer = {
      kind: 'TRANSFER' as const,
      date: '2026-11-08',
      amount: 300,
      accountId: ids.card,
      toAccountId: ids.savings,
    };
    ok(await updateTransaction(c.transactionId!, transfer, {}, deps));
    const after = db.data.goalContribution[0];
    assert.equal(after.amount, 300);
    assert.equal(after.fromAccountId, ids.card);
    assert.equal(after.date.toISOString().slice(0, 10), '2026-11-08');

    err(
      await updateTransaction(c.transactionId!, { ...transfer, toAccountId: ids.checking }, {}, deps),
      /contribution to "Trip"/
    );

    ok(await deleteTransaction(c.transactionId!, {}, deps));
    assert.equal(db.data.goalContribution.length, 0, 'deleting the transfer deletes the contribution');
  });

  test("a goal's account can't change under transfers; deleting the goal keeps them", async () => {
    const g = await goal(ids.savings);
    ok(
      await createContribution(
        { goalId: g.id, date: '2026-11-05', amount: 200, fromAccountId: ids.checking },
        deps
      )
    );
    err(
      await updateGoal(g.id, { name: 'Trip', targetAmount: 1000, accountId: ids.card }, deps),
      /already transferred/
    );
    ok(await updateGoal(g.id, { name: 'Big trip', targetAmount: 2000, accountId: ids.savings }, deps));
    assert.equal(db.data.goal[0].name, 'Big trip');

    ok(await deleteGoal(g.id, deps));
    assert.equal(db.data.goal.length, 0);
    assert.equal(db.data.goalContribution.length, 0);
    assert.equal(db.data.transaction.length, 1, 'the money really moved; the transfer stays');
    assert.deepEqual(balances(), { ...START, Checking: 800, Savings: 700 });
  });

  test('bad input is refused', async () => {
    const g = await goal(ids.savings);
    err(
      await createContribution(
        { goalId: g.id, date: '2026-11-05', amount: -5, fromAccountId: ids.checking },
        deps
      ),
      /positive/
    );
    err(
      await createContribution(
        { goalId: g.id, date: '2026-11-05', amount: 5, fromAccountId: 'b'.repeat(24) },
        deps
      ),
      /Account not found/
    );
    err(await createGoal({ name: 'X', targetAmount: 10, accountId: 'c'.repeat(24) }, deps), /Account not found/);
    assert.equal(db.data.transaction.length, 0);
    assert.equal(db.data.goalContribution.length, 0);
  });

  test('goal accounts and earmarks block deleting an account', async () => {
    const g = await goal(ids.savings);
    assert.match((await accountDeleteBlocker(db as never, ids.savings)) ?? '', /1 goal saving into it/);
    ok(await deleteGoal(g.id, deps));
    assert.equal(await accountDeleteBlocker(db as never, ids.savings), null);
  });
});

test('every money page is revalidated', () => {
  for (const page of ['/friends', '/plan/goals', '/accounts', '/']) {
    assert.ok((TRANSACTION_PAGES as readonly string[]).includes(page), page);
  }
});
