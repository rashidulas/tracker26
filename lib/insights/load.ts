/**
 * Loads the snapshot the insight detectors and recaps read
 * (lib/insights/detect.ts InsightData). Server-only; the database is passed in
 * so tests can supply the in-memory fake.
 */
import type { PrismaClient } from '@prisma/client';
import { loadBudgetMonth, type BudgetDb } from '@/lib/budgetData';
import { monthKeyOf, shiftMonthKey, type MonthKey } from '@/lib/budgets';
import type { BudgetMonthData } from '@/lib/budgetData';
import { dayRange, parseDay, startOfMonthDay, toDayString, type DayString } from '@/lib/dates';
import { expenseCategoryAllocations, myShareOfExpense } from '@/lib/expenseAllocations';
import { signedFriendAmount } from '@/lib/friends';
import { loadAccountBalances } from '@/lib/ledgerBalances';
import { cleanMerchantName, normalizeMerchantName } from '@/lib/merchants';
import type { Frequency } from '@/lib/recurringSchedule';
import { HISTORY_MONTHS, type InsightData } from './detect';

export type InsightDb = Pick<
  PrismaClient,
  | 'transaction'
  | 'category'
  | 'budget'
  | 'recurringTransaction'
  | 'account'
  | 'friend'
  | 'friendEntry'
  | 'goalContribution'
  | 'insight'
  | 'insightPreference'
  | 'insightRun'
  | 'recap'
>;

/** Day of the earliest transaction of any kind, or null with no data. */
export async function loadFirstDay(db: InsightDb): Promise<DayString | null> {
  const first = await db.transaction.findMany({ orderBy: { date: 'asc' }, take: 1, select: { date: true } });
  return first[0] ? toDayString(first[0].date) : null;
}

export async function loadInsightData(db: InsightDb, today: DayString): Promise<InsightData> {
  const month = monthKeyOf(today);
  const range = { gte: parseDay(startOfMonthDay(today, -HISTORY_MONTHS)), lt: dayRange(today).lt };
  const budgetDb = db as unknown as BudgetDb;

  const [expenseRows, incomeRows, firstDay, categories, thisBudget, lastBudget, recurring, accounts, friends, friendEntries] =
    await Promise.all([
      db.transaction.findMany({
        where: { kind: 'EXPENSE', date: range },
        select: {
          id: true,
          date: true,
          amount: true,
          sharedAmount: true,
          categoryId: true,
          splitItems: true,
          merchantOrSource: true,
          recurringId: true,
          accountId: true,
        },
        orderBy: { date: 'asc' },
      }),
      db.transaction.findMany({
        where: { kind: 'INCOME', date: range },
        select: { date: true, amount: true },
        orderBy: { date: 'asc' },
      }),
      loadFirstDay(db),
      db.category.findMany({ select: { id: true, name: true } }),
      loadBudgetMonth(month, today, budgetDb),
      loadBudgetMonth(shiftMonthKey(month, -1), today, budgetDb),
      db.recurringTransaction.findMany({ where: { active: true } }),
      loadAccountBalances(db),
      db.friend.findMany({ select: { id: true, name: true } }),
      db.friendEntry.findMany({
        select: { friendId: true, date: true, amount: true, type: true },
        orderBy: { date: 'asc' },
      }),
    ]);

  const budgets = new Map<MonthKey, BudgetMonthData>([
    [thisBudget.month, thisBudget],
    [lastBudget.month, lastBudget],
  ]);

  return {
    today,
    firstDay,
    expenses: expenseRows.map((t) => {
      const merchant = cleanMerchantName(t.merchantOrSource);
      return {
        id: t.id,
        day: toDayString(t.date),
        amount: myShareOfExpense(t),
        gross: t.amount,
        categoryId: t.categoryId,
        shares: expenseCategoryAllocations(t),
        merchant,
        merchantKey: normalizeMerchantName(merchant),
        recurringId: t.recurringId,
        accountId: t.accountId,
      };
    }),
    income: incomeRows.map((t) => ({ day: toDayString(t.date), amount: t.amount })),
    categories: new Map(categories.map((c) => [c.id, c.name])),
    budgets,
    recurring: recurring.map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      amount: r.amount,
      frequency: r.frequency as Frequency,
      startDate: toDayString(r.startDate),
      nextDueDate: toDayString(r.nextDueDate),
      endDate: r.endDate ? toDayString(r.endDate) : null,
      autoPost: r.autoPost,
      categoryId: r.categoryId,
      accountId: r.accountId,
      toAccountId: r.toAccountId,
      merchantOrSource: r.merchantOrSource,
    })),
    accounts: accounts.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      balance: a.currentBalance,
      creditLimit: a.creditLimit ?? null,
    })),
    friends: friends.map((f) => ({
      id: f.id,
      name: f.name,
      entries: friendEntries
        .filter((e) => e.friendId === f.id)
        .map((e) => ({ day: toDayString(e.date), amount: signedFriendAmount(e.type, e.amount) })),
    })),
  };
}
