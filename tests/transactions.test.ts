/**
 * Account balances after creating, editing and deleting each kind of
 * transaction through lib/transactions.ts.
 *
 * Balances are computed with computeBalancesForAccounts, the same function the
 * Accounts page uses, over whatever the module stored.
 *
 * Run: npm test (vitest)
 */
import { test, beforeEach } from 'vitest';
import assert from 'node:assert/strict';

import {
  createTransaction,
  updateTransaction,
  deleteTransaction,
  expenseCategoryAllocations,
  TRANSACTION_PAGES,
  type TransactionDeps,
} from '../lib/transactions';
import { computeBalancesForAccounts } from '../lib/accountBalance';
import { accountDeleteBlocker, categoryDeleteBlocker } from '../lib/references';
import { FakeDb } from './support/fakeDb';

let db: FakeDb;
let revalidated: string[];
let deps: TransactionDeps;
let ids: {
  checking: string;
  savings: string;
  card: string;
  groceries: string;
  produce: string;
  dining: string;
  salary: string;
  bonus: string;
  freelance: string;
};

beforeEach(() => {
  db = new FakeDb();
  revalidated = [];
  deps = { db: db as never, revalidate: (p) => revalidated.push(p) };

  const checking = db.seed('account', { name: 'Checking', type: 'CHECKING', startingBalance: 1000 });
  const savings = db.seed('account', { name: 'Savings', type: 'SAVINGS', startingBalance: 500 });
  const card = db.seed('account', { name: 'Card', type: 'CREDIT_CARD', startingBalance: 0 });
  const groceries = db.seed('category', { name: 'Groceries', type: 'EXPENSE', color: '#000' });
  const produce = db.seed('subcategory', { name: 'Produce', categoryId: groceries.id });
  const dining = db.seed('category', { name: 'Dining', type: 'EXPENSE', color: '#000' });
  const salary = db.seed('category', { name: 'Salary', type: 'INCOME', color: '#000' });
  const bonus = db.seed('subcategory', { name: 'Bonus', categoryId: salary.id });
  const freelance = db.seed('category', { name: 'Freelance', type: 'INCOME', color: '#000' });

  ids = {
    checking: checking.id,
    savings: savings.id,
    card: card.id,
    groceries: groceries.id,
    produce: produce.id,
    dining: dining.id,
    salary: salary.id,
    bonus: bonus.id,
    freelance: freelance.id,
  };
});

function balances() {
  const map = computeBalancesForAccounts(db.data.account as never, db.data.transaction as never);
  const out: Record<string, number> = {};
  for (const account of db.data.account) {
    out[account.name] = Math.round(map.get(account.id)!.balance * 100) / 100;
  }
  return out;
}

const START = { Checking: 1000, Savings: 500, Card: 0 };

function ok<T>(result: { success: true; data: T } | { success: false; error: string }): T {
  if (!result.success) assert.fail(`expected success, got: ${result.error}`);
  return result.data;
}

function err(result: { success: boolean; error?: string }): string {
  assert.equal(result.success, false, 'expected the write to be refused');
  return (result as { error: string }).error;
}

/** Same filter the Expenses page (getExpenses) uses. */
async function expensesList() {
  return db.transaction.findMany({
    where: { OR: [{ kind: 'EXPENSE' }, { kind: 'TRANSFER', tags: { has: 'payment' } }] },
  });
}

// ==================== EXPENSE ====================

test('expense: create, edit (amount, account, subcategory), delete', async () => {
  const created = ok(
    await createTransaction(
      { kind: 'EXPENSE', date: '2026-11-01', amount: 50, categoryId: ids.groceries, accountId: ids.checking },
      deps
    )
  );
  assert.deepEqual(balances(), { ...START, Checking: 950 });
  for (const page of ['/dashboard', '/accounts', '/expenses']) {
    assert.ok(revalidated.includes(page), `revalidates ${page}`);
  }

  const updated = ok(
    await updateTransaction(
      created.id,
      {
        kind: 'EXPENSE',
        date: '2026-11-02',
        amount: 80,
        categoryId: ids.groceries,
        subcategoryId: ids.produce,
        accountId: ids.card,
      },
      {},
      deps
    )
  );
  assert.equal(updated.subcategoryId, ids.produce);
  assert.equal(updated.toAccountId, null);
  assert.deepEqual(balances(), { ...START, Card: -80 });

  ok(await deleteTransaction(created.id, {}, deps));
  assert.deepEqual(balances(), START);
  assert.equal(db.data.transaction.length, 0);
});

test('expense without an account is refused and changes nothing', async () => {
  const message = err(
    await createTransaction(
      { kind: 'EXPENSE', date: '2026-11-01', amount: 50, categoryId: ids.groceries, accountId: null },
      deps
    )
  );
  assert.match(message, /account/i);
  assert.equal(db.data.transaction.length, 0);
  assert.deepEqual(revalidated, []);
});

test('expense: wrong-kind category, foreign subcategory and kind change are refused', async () => {
  err(
    await createTransaction(
      { kind: 'EXPENSE', date: '2026-11-01', amount: 5, categoryId: ids.salary, accountId: ids.checking },
      deps
    )
  );
  err(
    await createTransaction(
      {
        kind: 'EXPENSE',
        date: '2026-11-01',
        amount: 5,
        categoryId: ids.dining,
        subcategoryId: ids.produce,
        accountId: ids.checking,
      },
      deps
    )
  );

  const expense = ok(
    await createTransaction(
      { kind: 'EXPENSE', date: '2026-11-01', amount: 5, categoryId: ids.dining, accountId: ids.checking },
      deps
    )
  );
  const message = err(
    await updateTransaction(
      expense.id,
      { kind: 'INCOME', date: '2026-11-01', amount: 5, categoryId: ids.salary, accountId: ids.checking },
      {},
      deps
    )
  );
  assert.match(message, /can't be changed/);
  assert.equal(db.data.transaction[0].kind, 'EXPENSE');
  assert.deepEqual(balances(), { ...START, Checking: 995 });
});

test('split expense (by category): create, edit, delete; dashboard allocation', async () => {
  const split = ok(
    await createTransaction(
      {
        kind: 'EXPENSE',
        date: '2026-11-01',
        amount: 100,
        accountId: ids.checking,
        splitItems: [
          { categoryId: ids.groceries, amount: 60 },
          { categoryId: ids.dining, amount: 40 },
        ],
      },
      deps
    )
  );
  assert.equal(split.categoryId, null);
  assert.deepEqual(balances(), { ...START, Checking: 900 });

  ok(
    await updateTransaction(
      split.id,
      {
        kind: 'EXPENSE',
        date: '2026-11-01',
        amount: 120,
        accountId: ids.checking,
        splitItems: [
          { categoryId: ids.groceries, amount: 80 },
          { categoryId: ids.dining, amount: 40 },
        ],
      },
      {},
      deps
    )
  );
  assert.deepEqual(balances(), { ...START, Checking: 880 });
  assert.deepEqual(expenseCategoryAllocations(db.data.transaction[0] as never), [
    { categoryId: ids.groceries, amount: 80 },
    { categoryId: ids.dining, amount: 40 },
  ]);

  // Lines that do not add up, or use an income category, are refused.
  err(
    await updateTransaction(
      split.id,
      {
        kind: 'EXPENSE',
        date: '2026-11-01',
        amount: 120,
        accountId: ids.checking,
        splitItems: [
          { categoryId: ids.groceries, amount: 10 },
          { categoryId: ids.dining, amount: 40 },
        ],
      },
      {},
      deps
    )
  );
  err(
    await updateTransaction(
      split.id,
      {
        kind: 'EXPENSE',
        date: '2026-11-01',
        amount: 120,
        accountId: ids.checking,
        splitItems: [
          { categoryId: ids.groceries, amount: 80 },
          { categoryId: ids.salary, amount: 40 },
        ],
      },
      {},
      deps
    )
  );
  assert.deepEqual(balances(), { ...START, Checking: 880 });

  ok(await deleteTransaction(split.id, {}, deps));
  assert.deepEqual(balances(), START);
});

// ==================== INCOME ====================

test('income: create, edit (account, category, subcategory), delete', async () => {
  const income = ok(
    await createTransaction(
      { kind: 'INCOME', date: '2026-11-01', amount: 2000, categoryId: ids.salary, accountId: ids.checking },
      deps
    )
  );
  assert.deepEqual(balances(), { ...START, Checking: 3000 });

  const updated = ok(
    await updateTransaction(
      income.id,
      {
        kind: 'INCOME',
        date: '2026-11-01',
        amount: 2100,
        categoryId: ids.salary,
        subcategoryId: ids.bonus,
        accountId: ids.savings,
      },
      {},
      deps
    )
  );
  assert.equal(updated.subcategoryId, ids.bonus);
  assert.deepEqual(balances(), { ...START, Savings: 2600 });

  // Changing category drops the old category's subcategory if not re-sent.
  const recategorised = ok(
    await updateTransaction(
      income.id,
      { kind: 'INCOME', date: '2026-11-01', amount: 2100, categoryId: ids.freelance, accountId: ids.savings },
      {},
      deps
    )
  );
  assert.equal(recategorised.subcategoryId, null);

  err(
    await createTransaction(
      { kind: 'INCOME', date: '2026-11-01', amount: 1, categoryId: ids.salary, accountId: null },
      deps
    )
  );

  ok(await deleteTransaction(income.id, {}, deps));
  assert.deepEqual(balances(), START);
});

test('split income (by account): create, edit splits, collapse to one account, delete', async () => {
  const income = ok(
    await createTransaction(
      {
        kind: 'INCOME',
        date: '2026-11-01',
        amount: 3000,
        categoryId: ids.salary,
        accountSplits: [
          { accountId: ids.checking, amount: 2000 },
          { accountId: ids.savings, amount: 1000 },
        ],
      },
      deps
    )
  );
  assert.equal(income.accountId, ids.checking);
  assert.deepEqual(balances(), { Checking: 3000, Savings: 1500, Card: 0 });

  // Edit the split: different accounts and amounts.
  ok(
    await updateTransaction(
      income.id,
      {
        kind: 'INCOME',
        date: '2026-11-01',
        amount: 3000,
        categoryId: ids.salary,
        accountSplits: [
          { accountId: ids.checking, amount: 500 },
          { accountId: ids.card, amount: 2500 },
        ],
      },
      {},
      deps
    )
  );
  assert.deepEqual(balances(), { Checking: 1500, Savings: 500, Card: 2500 });

  // Bad splits are refused and leave the stored split alone.
  err(
    await updateTransaction(
      income.id,
      {
        kind: 'INCOME',
        date: '2026-11-01',
        amount: 3000,
        categoryId: ids.salary,
        accountSplits: [
          { accountId: ids.checking, amount: 500 },
          { accountId: ids.card, amount: 2000 },
        ],
      },
      {},
      deps
    )
  );
  err(
    await updateTransaction(
      income.id,
      {
        kind: 'INCOME',
        date: '2026-11-01',
        amount: 3000,
        categoryId: ids.salary,
        accountSplits: [
          { accountId: ids.checking, amount: 1500 },
          { accountId: ids.checking, amount: 1500 },
        ],
      },
      {},
      deps
    )
  );
  assert.deepEqual(balances(), { Checking: 1500, Savings: 500, Card: 2500 });

  // Back to a single account: splits are cleared, not left behind.
  const single = ok(
    await updateTransaction(
      income.id,
      { kind: 'INCOME', date: '2026-11-01', amount: 3000, categoryId: ids.salary, accountId: ids.savings },
      {},
      deps
    )
  );
  assert.deepEqual(single.accountSplits, []);
  assert.deepEqual(balances(), { Checking: 1000, Savings: 3500, Card: 0 });

  ok(await deleteTransaction(income.id, {}, deps));
  assert.deepEqual(balances(), START);
});

test('legacy multi-row income: edit absorbs sibling rows, delete removes the group', async () => {
  const a = db.seed('transaction', {
    kind: 'INCOME', date: new Date('2026-10-01'), amount: 600, categoryId: ids.salary,
    accountId: ids.checking, splitGroupId: 'g1',
  });
  const b = db.seed('transaction', {
    kind: 'INCOME', date: new Date('2026-10-01'), amount: 400, categoryId: ids.salary,
    accountId: ids.savings, splitGroupId: 'g1',
  });
  assert.deepEqual(balances(), { Checking: 1600, Savings: 900, Card: 0 });

  ok(
    await updateTransaction(
      a.id,
      {
        kind: 'INCOME',
        date: '2026-10-01',
        amount: 1000,
        categoryId: ids.salary,
        accountSplits: [
          { accountId: ids.checking, amount: 600 },
          { accountId: ids.savings, amount: 400 },
        ],
      },
      { absorbLegacyIds: [a.id, b.id] },
      deps
    )
  );
  assert.equal(db.data.transaction.length, 1);
  assert.deepEqual(balances(), { Checking: 1600, Savings: 900, Card: 0 });

  const c = db.seed('transaction', {
    kind: 'INCOME', date: new Date('2026-10-02'), amount: 10, categoryId: ids.salary,
    accountId: ids.checking, splitGroupId: 'g2',
  });
  db.seed('transaction', {
    kind: 'INCOME', date: new Date('2026-10-02'), amount: 20, categoryId: ids.salary,
    accountId: ids.savings, splitGroupId: 'g2',
  });
  const deleted = ok(await deleteTransaction(c.id, {}, deps));
  assert.equal(deleted.deleted, 2);
  assert.deepEqual(balances(), { Checking: 1600, Savings: 900, Card: 0 });
});

test('a failure after the first write rolls the whole edit back', async () => {
  const a = db.seed('transaction', {
    kind: 'INCOME', date: new Date('2026-10-01'), amount: 600, categoryId: ids.salary,
    accountId: ids.checking, splitGroupId: 'g1',
  });
  const b = db.seed('transaction', {
    kind: 'INCOME', date: new Date('2026-10-01'), amount: 400, categoryId: ids.salary,
    accountId: ids.savings, splitGroupId: 'g1',
  });
  const before = balances();

  // Siblings get deleted first; then the final update fails.
  const originalUpdate = db.transaction.update;
  db.transaction.update = async () => {
    throw new Error('simulated write failure');
  };
  const quiet = console.error;
  console.error = () => {};
  try {
    const message = err(
      await updateTransaction(
        a.id,
        {
          kind: 'INCOME',
          date: '2026-10-01',
          amount: 1000,
          categoryId: ids.salary,
          accountSplits: [
            { accountId: ids.checking, amount: 600 },
            { accountId: ids.savings, amount: 400 },
          ],
        },
        { absorbLegacyIds: [b.id] },
        deps
      )
    );
    assert.equal(message, 'Failed to update transaction');
  } finally {
    db.transaction.update = originalUpdate;
    console.error = quiet;
  }

  assert.equal(db.data.transaction.length, 2, 'sibling row is back');
  assert.deepEqual(balances(), before);
  assert.deepEqual(revalidated, [], 'nothing revalidated on failure');
});

// ==================== TRANSFER ====================

test('transfer: create, edit (amount, destination), delete', async () => {
  const transfer = ok(
    await createTransaction(
      { kind: 'TRANSFER', date: '2026-11-01', amount: 200, accountId: ids.checking, toAccountId: ids.savings },
      deps
    )
  );
  assert.deepEqual(balances(), { Checking: 800, Savings: 700, Card: 0 });
  assert.ok(revalidated.includes('/transfers'));

  ok(
    await updateTransaction(
      transfer.id,
      { kind: 'TRANSFER', date: '2026-11-01', amount: 300, accountId: ids.checking, toAccountId: ids.card },
      {},
      deps
    )
  );
  assert.deepEqual(balances(), { Checking: 700, Savings: 500, Card: 300 });

  err(
    await updateTransaction(
      transfer.id,
      { kind: 'TRANSFER', date: '2026-11-01', amount: 300, accountId: ids.card, toAccountId: ids.card },
      {},
      deps
    )
  );

  ok(await deleteTransaction(transfer.id, {}, deps));
  assert.deepEqual(balances(), START);
});

test('card payment edited on the Transfers page keeps its tag, category and Expenses listing', async () => {
  const payment = ok(
    await createTransaction(
      {
        kind: 'TRANSFER',
        purpose: 'payment',
        date: '2026-11-01',
        amount: 150,
        accountId: ids.checking,
        toAccountId: ids.card,
      },
      deps
    )
  );
  const paymentCategory = db.data.category.find((c) => c.name === 'Payment')!;
  assert.ok(paymentCategory, 'Payment category created');
  assert.equal(payment.categoryId, paymentCategory.id);
  assert.deepEqual(payment.tags, ['payment']);
  assert.deepEqual(balances(), { Checking: 850, Savings: 500, Card: 150 });

  // Exactly what app/transfers/page.tsx sends: no tags, no category.
  const edited = ok(
    await updateTransaction(
      payment.id,
      {
        kind: 'TRANSFER',
        date: new Date('2026-11-03'),
        amount: 175,
        accountId: ids.checking,
        toAccountId: ids.card,
        notes: '',
      },
      {},
      deps
    )
  );
  assert.deepEqual(edited.tags, ['payment']);
  assert.equal(edited.categoryId, paymentCategory.id);
  assert.deepEqual(balances(), { Checking: 825, Savings: 500, Card: 175 });
  assert.deepEqual(
    (await expensesList()).map((t) => t.id),
    [payment.id],
    'still shown on the Expenses page'
  );

  // Even if the caller sends an explicit empty tag list.
  const cleared = ok(
    await updateTransaction(
      payment.id,
      { kind: 'TRANSFER', date: '2026-11-03', amount: 175, accountId: ids.checking, toAccountId: ids.card, tags: [] },
      {},
      deps
    )
  );
  assert.deepEqual(cleared.tags, ['payment']);

  // A second payment reuses the same category.
  ok(
    await createTransaction(
      { kind: 'TRANSFER', purpose: 'payment', date: '2026-11-04', amount: 25, accountId: ids.savings, toAccountId: ids.card },
      deps
    )
  );
  assert.equal(db.data.category.filter((c) => c.name === 'Payment').length, 1);
  assert.deepEqual(balances(), { Checking: 825, Savings: 475, Card: 200 });

  ok(await deleteTransaction(payment.id, {}, deps));
  assert.deepEqual(balances(), { Checking: 1000, Savings: 475, Card: 25 });
});

test('card payment edited from the Expenses list stays a transfer', async () => {
  const payment = ok(
    await createTransaction(
      { kind: 'TRANSFER', purpose: 'payment', date: '2026-11-01', amount: 150, accountId: ids.checking, toAccountId: ids.card },
      deps
    )
  );

  // What ExpenseForm -> updateExpense sends for that row.
  const edited = ok(
    await updateTransaction(
      payment.id,
      {
        kind: 'EXPENSE',
        date: '2026-11-02',
        amount: 60,
        categoryId: payment.categoryId,
        subcategoryId: null,
        accountId: ids.savings,
        merchantOrSource: 'Payment',
        notes: '',
        tags: [],
      },
      {},
      deps
    )
  );
  assert.equal(edited.kind, 'TRANSFER');
  assert.equal(edited.toAccountId, ids.card);
  assert.equal(edited.categoryId, payment.categoryId);
  assert.ok(edited.tags.includes('payment'));
  assert.deepEqual(balances(), { Checking: 1000, Savings: 440, Card: 60 });
  assert.equal((await expensesList()).length, 1);
});

test('debt payment: create, edit, delete', async () => {
  const debt = ok(
    await createTransaction(
      { kind: 'TRANSFER', purpose: 'debt-payment', date: '2026-11-01', amount: 90, accountId: ids.checking, toAccountId: ids.card },
      deps
    )
  );
  assert.ok(db.data.category.some((c) => c.name === 'Debt Payment'));
  assert.deepEqual(debt.tags, ['debt-payment']);
  assert.equal(debt.notes, 'Debt payment transfer');
  assert.deepEqual(balances(), { Checking: 910, Savings: 500, Card: 90 });

  const edited = ok(
    await updateTransaction(
      debt.id,
      { kind: 'TRANSFER', date: '2026-11-01', amount: 120, accountId: ids.savings, toAccountId: ids.card },
      {},
      deps
    )
  );
  assert.deepEqual(edited.tags, ['debt-payment']);
  assert.deepEqual(balances(), { Checking: 1000, Savings: 380, Card: 120 });

  ok(await deleteTransaction(debt.id, {}, deps));
  assert.deepEqual(balances(), START);
});

// ==================== MODULE GUARANTEES ====================

test('every page that shows transactions is revalidated on each write', async () => {
  ok(
    await createTransaction(
      { kind: 'INCOME', date: '2026-11-01', amount: 1, categoryId: ids.salary, accountId: ids.checking },
      deps
    )
  );
  assert.deepEqual([...new Set(revalidated)].sort(), [...TRANSACTION_PAGES].sort());
});

// ==================== DELETE GUARDS ====================

test('deleteAccount guard reports transfers in, income splits and goal contributions', async () => {
  assert.equal(await accountDeleteBlocker(db as never, ids.savings, 'Savings'), null);

  ok(
    await createTransaction(
      { kind: 'TRANSFER', date: '2026-11-01', amount: 10, accountId: ids.checking, toAccountId: ids.savings },
      deps
    )
  );
  ok(
    await createTransaction(
      {
        kind: 'INCOME',
        date: '2026-11-01',
        amount: 100,
        categoryId: ids.salary,
        accountSplits: [
          { accountId: ids.checking, amount: 60 },
          { accountId: ids.savings, amount: 40 },
        ],
      },
      deps
    )
  );
  db.seed('goalContribution', {
    goalId: 'g', date: new Date(), amount: 5, fromAccountId: ids.savings,
  });

  const message = await accountDeleteBlocker(db as never, ids.savings, 'Savings');
  assert.equal(
    message,
    'Cannot delete account "Savings". Still attached: 1 transfer into it, 1 split transaction with a share in it and 1 goal contribution. Reassign or delete them first.'
  );

  const checking = await accountDeleteBlocker(db as never, ids.checking);
  assert.match(checking!, /2 transactions from this account/);
});

test('deleteCategory guard reports split-expense lines, subcategory use and budgets', async () => {
  assert.equal(await categoryDeleteBlocker(db as never, ids.dining, 'Dining'), null);

  ok(
    await createTransaction(
      {
        kind: 'EXPENSE',
        date: '2026-11-01',
        amount: 30,
        accountId: ids.checking,
        splitItems: [
          { categoryId: ids.groceries, amount: 10 },
          { categoryId: ids.dining, amount: 20 },
        ],
      },
      deps
    )
  );
  db.seed('budget', { month: new Date('2026-11-01'), categoryId: ids.dining, amount: 100 });

  assert.equal(
    await categoryDeleteBlocker(db as never, ids.dining, 'Dining'),
    'Cannot delete category "Dining". Still attached: 1 split expense with a line in it and 1 budget. Reassign or delete them first.'
  );

  // A transaction that kept a subcategory of this category but not its id.
  db.seed('transaction', {
    kind: 'EXPENSE', date: new Date(), amount: 1, accountId: ids.checking,
    categoryId: ids.dining, subcategoryId: ids.produce,
  });
  assert.match(
    (await categoryDeleteBlocker(db as never, ids.groceries))!,
    /1 transaction using one of its subcategories/
  );
});

// ==================== DATES ====================

test('dates are stored as UTC midnight of the calendar day; impossible days are refused', async () => {
  const saved = ok(
    await createTransaction(
      { kind: 'EXPENSE', date: '2026-11-01', amount: 5, categoryId: ids.dining, accountId: ids.checking },
      deps
    )
  );
  assert.equal(saved.date.toISOString(), '2026-11-01T00:00:00.000Z');

  for (const date of ['2026-13-45', '2026-02-30', '11/01/2026', '']) {
    assert.equal(
      err(
        await createTransaction(
          { kind: 'EXPENSE', date, amount: 5, categoryId: ids.dining, accountId: ids.checking },
          deps
        )
      ),
      'Please enter a valid date',
      `refuses ${JSON.stringify(date)}`
    );
  }
  assert.equal(db.data.transaction.length, 1);
});
