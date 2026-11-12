/**
 * Bulk list actions in lib/transactions.ts: duplicate, delete, re-categorise.
 *
 * Run: npm test (vitest)
 */
import { test, beforeEach } from 'vitest';
import assert from 'node:assert/strict';

import {
  createTransaction,
  deleteTransactions,
  duplicateTransactions,
  recategorizeTransactions,
  type TransactionDeps,
} from '../lib/transactions';
import { toDayString } from '../lib/dates';
import { FakeDb } from './support/fakeDb';

let db: FakeDb;
let deps: TransactionDeps;
let ids: Record<'checking' | 'card' | 'groceries' | 'produce' | 'dining' | 'salary', string>;

beforeEach(() => {
  db = new FakeDb();
  deps = { db: db as never, revalidate: () => {} };
  const checking = db.seed('account', { name: 'Checking', type: 'CHECKING' });
  const card = db.seed('account', { name: 'Card', type: 'CREDIT_CARD' });
  const groceries = db.seed('category', { name: 'Groceries', type: 'EXPENSE', color: '#000' });
  const produce = db.seed('subcategory', { name: 'Produce', categoryId: groceries.id });
  const dining = db.seed('category', { name: 'Dining', type: 'EXPENSE', color: '#000' });
  const salary = db.seed('category', { name: 'Salary', type: 'INCOME', color: '#000' });
  ids = {
    checking: checking.id,
    card: card.id,
    groceries: groceries.id,
    produce: produce.id,
    dining: dining.id,
    salary: salary.id,
  };
});

function ok<T>(result: { success: true; data: T } | { success: false; error: string }): T {
  if (!result.success) assert.fail(`expected success, got: ${result.error}`);
  return result.data;
}

const expense = (extra: Record<string, unknown> = {}) =>
  createTransaction(
    {
      kind: 'EXPENSE',
      date: '2026-10-05',
      amount: 12.5,
      categoryId: ids.groceries,
      subcategoryId: ids.produce,
      accountId: ids.checking,
      merchantOrSource: 'Market',
      notes: 'weekly',
      tags: ['food'],
      ...extra,
    },
    deps
  );

test('duplicate copies an expense onto the given day', async () => {
  const src = ok(await expense());
  const [copy] = ok(await duplicateTransactions([src.id], '2026-11-12', deps));

  assert.notEqual(copy.id, src.id);
  assert.equal(toDayString(copy.date), '2026-11-12');
  assert.equal(copy.amount, 12.5);
  assert.equal(copy.categoryId, ids.groceries);
  assert.equal(copy.subcategoryId, ids.produce);
  assert.equal(copy.accountId, ids.checking);
  assert.equal(copy.merchantOrSource, 'Market');
  assert.deepEqual(copy.tags, ['food']);
  assert.equal(db.data.transaction.length, 2);
});

test('duplicate keeps a card payment a tagged transfer', async () => {
  const payment = ok(
    await createTransaction(
      {
        kind: 'TRANSFER',
        date: '2026-11-01',
        amount: 300,
        accountId: ids.checking,
        toAccountId: ids.card,
        purpose: 'payment',
      },
      deps
    )
  );
  const [copy] = ok(await duplicateTransactions([payment.id], '2026-11-12', deps));
  assert.equal(copy.kind, 'TRANSFER');
  assert.equal(copy.toAccountId, ids.card);
  assert.equal(copy.categoryId, payment.categoryId);
  assert.deepEqual(copy.tags, ['payment']);
});

test('duplicate rejects a bad day and writes nothing', async () => {
  const src = ok(await expense());
  const result = await duplicateTransactions([src.id], '2026-13-40', deps);
  assert.equal(result.success, false);
  assert.equal(db.data.transaction.length, 1);
});

test('bulk delete removes only the selected rows', async () => {
  const a = ok(await expense());
  const b = ok(await expense({ amount: 3 }));
  const c = ok(await expense({ amount: 4 }));
  const { deleted } = ok(await deleteTransactions([a.id, c.id], deps));
  assert.equal(deleted, 2);
  assert.deepEqual(
    db.data.transaction.map((t) => t.id),
    [b.id]
  );
});

test('bulk delete also removes legacy split-group siblings', async () => {
  const a = db.seed('transaction', {
    kind: 'INCOME', date: new Date('2026-11-01'), amount: 60, accountId: ids.checking,
    categoryId: ids.salary, splitGroupId: 'g1',
  });
  db.seed('transaction', {
    kind: 'INCOME', date: new Date('2026-11-01'), amount: 40, accountId: ids.card,
    categoryId: ids.salary, splitGroupId: 'g1',
  });
  const other = ok(await expense());
  const { deleted } = ok(await deleteTransactions([a.id], deps));
  assert.equal(deleted, 2);
  assert.deepEqual(db.data.transaction.map((t) => t.id), [other.id]);
});

test('re-categorise moves matching expenses and clears the subcategory', async () => {
  const a = ok(await expense());
  const income = ok(
    await createTransaction(
      { kind: 'INCOME', date: '2026-11-01', amount: 100, categoryId: ids.salary, accountId: ids.checking },
      deps
    )
  );
  const split = ok(
    await expense({
      categoryId: null,
      subcategoryId: null,
      amount: 10,
      splitItems: [
        { categoryId: ids.groceries, amount: 6 },
        { categoryId: ids.dining, amount: 4 },
      ],
    })
  );

  const { updated } = ok(await recategorizeTransactions([a.id, income.id, split.id], ids.dining, deps));
  assert.equal(updated, 1, 'only the plain expense changes');

  const byId = new Map(db.data.transaction.map((t) => [t.id, t]));
  assert.equal(byId.get(a.id)!.categoryId, ids.dining);
  assert.equal(byId.get(a.id)!.subcategoryId, null);
  assert.equal(byId.get(income.id)!.categoryId, ids.salary);
  assert.equal(byId.get(split.id)!.categoryId, null);
});

test('bulk actions reject empty and malformed selections', async () => {
  assert.equal((await deleteTransactions([], deps)).success, false);
  assert.equal((await deleteTransactions(['not-an-id'], deps)).success, false);
  assert.equal((await recategorizeTransactions(['not-an-id'], ids.dining, deps)).success, false);
});
