/**
 * Merchant memory: linking on write, "apply to past transactions", and the
 * migration plan for existing merchantOrSource strings.
 */
import { test, beforeEach, describe } from 'vitest';
import assert from 'node:assert/strict';

import {
  applyMerchantCategory,
  createTransaction,
  detachSubcategories,
  updateTransaction,
} from '../lib/transactions';
import {
  cleanMerchantName,
  defaultCategoryForKind,
  normalizeMerchantName,
  planMerchantMigration,
} from '../lib/merchants';
import { detectRecurring } from '../lib/recurringDetection';
import { parseDay } from '../lib/dates';
import { FakeDb } from './support/fakeDb';

let db: FakeDb;
let deps: { db: never; revalidate: (p: string) => void };
let ids: { checking: string; groceries: string; produce: string; dining: string; refunds: string };

beforeEach(() => {
  db = new FakeDb();
  deps = { db: db as never, revalidate: () => {} };
  const groceries = db.seed('category', { name: 'Groceries', type: 'EXPENSE', color: '#000' });
  ids = {
    checking: db.seed('account', { name: 'Checking', type: 'CHECKING', startingBalance: 0 }).id,
    groceries: groceries.id,
    produce: db.seed('subcategory', { name: 'Produce', categoryId: groceries.id }).id,
    dining: db.seed('category', { name: 'Dining', type: 'EXPENSE', color: '#000' }).id,
    refunds: db.seed('category', { name: 'Refunds', type: 'INCOME', color: '#000' }).id,
  };
});

function ok<T>(r: { success: true; data: T } | { success: false; error: string }): T {
  if (!r.success) assert.fail(`expected success, got: ${r.error}`);
  return r.data;
}

const expense = (merchant: string | null, categoryId = ids.groceries) => ({
  kind: 'EXPENSE' as const,
  date: '2026-11-10',
  amount: 25,
  categoryId,
  accountId: ids.checking,
  merchantOrSource: merchant,
});

describe('normalisation', () => {
  test('case and whitespace', () => {
    assert.equal(cleanMerchantName('  Trader   Joe’s \t'), 'Trader Joe’s');
    assert.equal(normalizeMerchantName('  TRADER   joe’s'), 'trader joe’s');
    assert.equal(normalizeMerchantName('   '), null);
    assert.equal(normalizeMerchantName(null), null);
  });

  test('defaults only apply to the matching kind', () => {
    const type = (id: string) => (id === ids.refunds ? 'INCOME' : 'EXPENSE') as 'INCOME' | 'EXPENSE';
    const m = { defaultCategoryId: ids.groceries, defaultSubcategoryId: null };
    assert.deepEqual(defaultCategoryForKind(m, type, 'EXPENSE'), {
      categoryId: ids.groceries,
      subcategoryId: null,
    });
    assert.equal(defaultCategoryForKind(m, type, 'INCOME'), null);
  });
});

describe('linking on write', () => {
  test('one merchant per normalised name; text becomes the merchant name', async () => {
    const a = ok(await createTransaction(expense('Walmart'), deps));
    const b = ok(await createTransaction(expense('  walmart  '), deps));
    const c = ok(await createTransaction(expense('WAL  MART'), deps));
    assert.equal(db.data.merchant.length, 2);
    assert.equal(a.merchantId, b.merchantId);
    assert.notEqual(a.merchantId, c.merchantId);
    assert.equal(b.merchantOrSource, 'Walmart');
  });

  test('no merchant text, no merchant; transfers never get one', async () => {
    const a = ok(await createTransaction(expense(''), deps));
    assert.equal(a.merchantId, null);
    const savings = db.seed('account', { name: 'Savings', type: 'SAVINGS', startingBalance: 0 });
    const t = ok(
      await createTransaction(
        {
          kind: 'TRANSFER',
          purpose: 'payment',
          date: '2026-11-10',
          amount: 10,
          accountId: ids.checking,
          toAccountId: savings.id,
        },
        deps
      )
    );
    assert.equal(t.merchantId, null);
    assert.equal(t.merchantOrSource, 'Payment');
    assert.equal(db.data.merchant.length, 0);
  });

  test('editing the merchant relinks; editing other fields keeps it', async () => {
    const a = ok(await createTransaction(expense('Costco'), deps));
    const kept = ok(
      await updateTransaction(a.id, { ...expense(undefined as never), amount: 30 }, {}, deps)
    );
    assert.equal(kept.merchantId, a.merchantId);
    const moved = ok(await updateTransaction(a.id, expense('Aldi'), {}, deps));
    assert.notEqual(moved.merchantId, a.merchantId);
    assert.equal(moved.merchantOrSource, 'Aldi');
  });
});

describe('apply to past transactions', () => {
  test('updates only this merchant, this kind, unsplit rows that differ', async () => {
    const a = ok(await createTransaction(expense('Cafe Luna', ids.groceries), deps));
    ok(await createTransaction(expense('cafe luna', ids.groceries), deps));
    ok(await createTransaction(expense('Cafe Luna', ids.dining), deps));
    ok(await createTransaction(expense('Other place', ids.groceries), deps));
    ok(
      await createTransaction(
        { kind: 'INCOME', date: '2026-11-10', amount: 5, categoryId: ids.refunds, accountId: ids.checking, merchantOrSource: 'Cafe Luna' },
        deps
      )
    );
    const r = ok(await applyMerchantCategory(a.merchantId!, ids.dining, null, deps));
    assert.equal(r.updated, 2);
    const rows = db.data.transaction.filter((t) => t.merchantId === a.merchantId);
    assert.deepEqual(
      rows.map((t) => [t.kind, t.categoryId]).sort(),
      [
        ['EXPENSE', ids.dining],
        ['EXPENSE', ids.dining],
        ['EXPENSE', ids.dining],
        ['INCOME', ids.refunds],
      ].sort()
    );
    assert.equal(db.data.transaction.find((t) => t.merchantOrSource === 'Other place')!.categoryId, ids.groceries);
  });

  test('rejects a subcategory from another category', async () => {
    const a = ok(await createTransaction(expense('Cafe Luna'), deps));
    const r = await applyMerchantCategory(a.merchantId!, ids.dining, ids.produce, deps);
    assert.deepEqual(r, { success: false, error: 'Subcategory does not belong to the selected category' });
  });

  test('deleting a subcategory clears it from merchant defaults', async () => {
    const m = db.seed('merchant', {
      name: 'Farm Stand',
      normalizedName: 'farm stand',
      defaultCategoryId: ids.groceries,
      defaultSubcategoryId: ids.produce,
    });
    await db.$transaction((tx) => detachSubcategories(tx as never, [ids.produce]));
    assert.equal(db.data.merchant.find((x) => x.id === m.id)!.defaultSubcategoryId, null);
  });
});

describe('migration plan', () => {
  const row = (id: string, kind: 'INCOME' | 'EXPENSE' | 'TRANSFER', text: string | null, day: string) => ({
    id,
    kind,
    merchantOrSource: text,
    date: parseDay(day),
  });

  test('groups spellings, picks the most used one, skips transfers and blanks', () => {
    const plan = planMerchantMigration([
      row('1', 'EXPENSE', 'Starbucks', '2026-01-01'),
      row('2', 'EXPENSE', 'starbucks ', '2026-02-01'),
      row('3', 'EXPENSE', 'Starbucks', '2026-03-01'),
      row('4', 'EXPENSE', 'STARBUCKS', '2026-04-01'),
      row('5', 'INCOME', 'Acme  Corp', '2026-01-15'),
      row('6', 'EXPENSE', '   ', '2026-01-15'),
      row('7', 'EXPENSE', null, '2026-01-15'),
      row('8', 'TRANSFER', 'Payment', '2026-01-15'),
      { ...row('9', 'EXPENSE', 'Starbucks', '2026-05-01'), merchantId: 'm1' },
    ]);
    assert.deepEqual(
      plan.merchants.map((m) => [m.name, m.transactionIds.length, m.variants.length]),
      [
        ['Starbucks', 4, 3],
        ['Acme Corp', 1, 1],
      ]
    );
    assert.equal(plan.blank, 2);
    assert.equal(plan.transfersSkipped, 1);
    assert.equal(plan.alreadyLinked, 1);
    // "starbucks ", "STARBUCKS" and "Acme  Corp" change; raw spellings are kept for the plan.
    assert.equal(plan.textChanges, 3);
  });

  test('re-runs reuse existing merchants and their names', () => {
    const plan = planMerchantMigration(
      [row('1', 'EXPENSE', 'TARGET', '2026-01-01')],
      [{ id: 'm1', name: 'Target', normalizedName: 'target' }]
    );
    assert.equal(plan.merchants[0].existingId, 'm1');
    assert.equal(plan.merchants[0].name, 'Target');
  });
});

test('detection follows a charge on the 31st through short months', () => {
  const days = ['2026-07-31', '2026-08-31', '2026-09-30', '2026-10-31'];
  const history = days.map((d, i) => ({
    id: `x${i}`,
    date: d,
    amount: 50,
    kind: 'EXPENSE' as const,
    merchantOrSource: 'Storage Unit',
    categoryId: 'c',
    accountId: 'a',
  }));
  const [s] = detectRecurring(history, { today: '2026-11-18' });
  assert.equal(s.occurrences, 4);
  assert.equal(s.nextDueDate, '2026-11-30');
});

describe('form memory', () => {
  test('a default the user set wins over last used; otherwise last used fills in', async () => {
    const { buildMerchantMemory } = await import('../lib/merchants');
    const type = (id: string) => (id === 'inc' ? 'INCOME' : 'EXPENSE') as 'INCOME' | 'EXPENSE';
    const memory = buildMerchantMemory(
      [
        { id: 'm1', name: 'Walmart', normalizedName: 'walmart', defaultCategoryId: 'groceries', defaultSubcategoryId: null, defaultAccountId: null },
        { id: 'm2', name: 'Payroll Co', normalizedName: 'payroll co', defaultCategoryId: 'inc', defaultSubcategoryId: null, defaultAccountId: 'acct2' },
      ],
      [
        { merchantOrSource: 'walmart', categoryId: 'household', subcategoryId: 'sub', accountId: 'card' },
        { merchantOrSource: 'Cafe', categoryId: 'dining', subcategoryId: null, accountId: 'cash' },
        { merchantOrSource: 'cafe', categoryId: 'groceries', subcategoryId: null, accountId: 'card' },
      ],
      type,
      'EXPENSE'
    );
    assert.deepEqual(memory, [
      { name: 'Walmart', merchantId: 'm1', categoryId: 'groceries', subcategoryId: null, accountId: 'card', hasDefault: true },
      { name: 'Cafe', merchantId: null, categoryId: 'dining', subcategoryId: null, accountId: 'cash', hasDefault: false },
      // Income default does not apply to expenses, but its account does.
      { name: 'Payroll Co', merchantId: 'm2', categoryId: null, subcategoryId: null, accountId: 'acct2', hasDefault: false },
    ]);
  });
});
