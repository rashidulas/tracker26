import { prisma } from '@/lib/prisma';
import { loadAccountBalances } from '@/lib/ledgerBalances';
import { goalProgress } from '@/lib/goals';
import { signedFriendAmount } from '@/lib/friends';
import { expenseCategoryAllocations } from '@/lib/transactions';
import {
  todayInAppTimeZone,
  dayRange,
  lastNDaysRange,
  monthRange,
  toDayString,
} from '@/lib/dates';

export type FinanceContext = {
  today: string;
  accounts: {
    id: string;
    name: string;
    type: string;
    balance: number;
    /** Balance minus money earmarked for goals. */
    available: number;
    creditLimit: number | null;
  }[];
  expenseCategories: { id: string; name: string }[];
  incomeCategories: { id: string; name: string }[];
  totals: {
    totalBalance: number;
    cashBalance: number;
    creditCardDebt: number;
    loanDebt: number;
    friendsOwedToYou: number;
    friendsYouOwe: number;
    friendsNet: number;
    todayIncome: number;
    todayExpenses: number;
    weekExpenses: number;
    last30DaysIncome: number;
    last30DaysExpenses: number;
    monthIncome: number;
    monthExpenses: number;
    monthNet: number;
  };
  topExpenseCategories: { name: string; amount: number }[];
  recentTransactions: {
    date: string;
    kind: string;
    amount: number;
    category: string | null;
    account: string | null;
    merchant: string | null;
  }[];
  recentIncome: {
    date: string;
    amount: number;
    category: string | null;
    account: string | null;
    merchant: string | null;
  }[];
  friends: {
    name: string;
    balance: number;
  }[];
  loans: {
    name: string;
    balance: number;
  }[];
  goals: {
    name: string;
    target: number;
    saved: number;
    progress: number;
    account: string | null;
  }[];
};

type SpendAgg = { _sum: { amount: number | null; sharedAmount?: number | null } };
/** Spending is your share: friends' shares of split expenses are left out. */
const spent = (agg: SpendAgg) => (agg._sum.amount || 0) - (agg._sum.sharedAmount || 0);

export async function getFinanceContext(): Promise<FinanceContext> {
  const today = todayInAppTimeZone();
  const todayRange = dayRange(today);
  const last7Days = lastNDaysRange(7, today);
  const last30Days = lastNDaysRange(30, today);
  const thisMonth = monthRange(today);

  const [
    accountsRaw,
    categories,
    todayIncomeAgg,
    todayExpenseAgg,
    weekExpenseAgg,
    last30IncomeAgg,
    last30ExpenseAgg,
    monthIncomeAgg,
    monthExpenseAgg,
    expensesByCategory,
    recent,
    recentIncome,
    friendsRaw,
    goalsRaw,
  ] = await Promise.all([
    loadAccountBalances(prisma),
    prisma.category.findMany({
      select: { id: true, name: true, type: true },
      orderBy: { name: 'asc' },
    }),
    prisma.transaction.aggregate({
      where: { kind: 'INCOME', date: todayRange },
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: { kind: 'EXPENSE', date: todayRange },
      _sum: { amount: true, sharedAmount: true },
    }),
    prisma.transaction.aggregate({
      where: { kind: 'EXPENSE', date: last7Days },
      _sum: { amount: true, sharedAmount: true },
    }),
    prisma.transaction.aggregate({
      where: { kind: 'INCOME', date: last30Days },
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: { kind: 'EXPENSE', date: last30Days },
      _sum: { amount: true, sharedAmount: true },
    }),
    prisma.transaction.aggregate({
      where: { kind: 'INCOME', date: thisMonth },
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: { kind: 'EXPENSE', date: thisMonth },
      _sum: { amount: true, sharedAmount: true },
    }),
    // Split expenses keep their categories in splitItems, so total in code.
    prisma.transaction.findMany({
      where: {
        kind: 'EXPENSE',
        date: thisMonth,
      },
      select: { amount: true, categoryId: true, splitItems: true, sharedAmount: true },
    }),
    prisma.transaction.findMany({
      take: 20,
      orderBy: { date: 'desc' },
      include: { category: true, account: true },
    }),
    prisma.transaction.findMany({
      where: { kind: 'INCOME', date: last30Days },
      orderBy: { date: 'desc' },
      take: 40,
      include: { category: true, account: true },
    }),
    prisma.friend.findMany({
      include: { entries: true },
      orderBy: { name: 'asc' },
    }),
    prisma.goal.findMany({
      include: {
        account: { select: { name: true } },
        contributions: { select: { amount: true, transactionId: true } },
      },
      orderBy: { name: 'asc' },
    }),
  ]);

  const accounts = accountsRaw.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type,
    balance: a.currentBalance,
    available: a.available,
    creditLimit: a.creditLimit ?? null,
  }));

  const totalBalance = accounts.reduce((s, a) => s + a.balance, 0);
  const cashBalance = accounts
    .filter((a) => a.type !== 'CREDIT_CARD' && a.type !== 'LOAN')
    .reduce((s, a) => s + a.balance, 0);
  const creditCardDebt = accounts
    .filter((a) => a.type === 'CREDIT_CARD')
    .reduce((s, a) => s + Math.abs(Math.min(a.balance, 0)), 0);
  const loanDebt = accounts
    .filter((a) => a.type === 'LOAN')
    .reduce((s, a) => s + Math.abs(Math.min(a.balance, 0)), 0);

  const loans = accounts
    .filter((a) => a.type === 'LOAN')
    .map((a) => ({ name: a.name, balance: a.balance }));

  const friends = friendsRaw.map((f) => {
    const balance = f.entries.reduce(
      (sum, entry) => sum + signedFriendAmount(entry.type, entry.amount),
      0
    );
    return { name: f.name, balance };
  });

  const friendsOwedToYou = friends.reduce((s, f) => s + Math.max(0, f.balance), 0);
  const friendsYouOwe = friends.reduce((s, f) => s + Math.max(0, -f.balance), 0);
  const friendsNet = friendsOwedToYou - friendsYouOwe;

  const monthIncome = monthIncomeAgg._sum.amount || 0;
  const monthExpenses = spent(monthExpenseAgg);

  const catMap = new Map(categories.map((c) => [c.id, c.name]));
  const categoryTotals = new Map<string, number>();
  for (const expense of expensesByCategory) {
    for (const share of expenseCategoryAllocations(expense)) {
      categoryTotals.set(share.categoryId, (categoryTotals.get(share.categoryId) || 0) + share.amount);
    }
  }
  const topExpenseCategories = [...categoryTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  return {
    today,
    accounts,
    expenseCategories: categories
      .filter((c) => c.type === 'EXPENSE')
      .map((c) => ({ id: c.id, name: c.name })),
    incomeCategories: categories
      .filter((c) => c.type === 'INCOME')
      .map((c) => ({ id: c.id, name: c.name })),
    totals: {
      totalBalance,
      cashBalance,
      creditCardDebt,
      loanDebt,
      friendsOwedToYou,
      friendsYouOwe,
      friendsNet,
      todayIncome: todayIncomeAgg._sum.amount || 0,
      todayExpenses: spent(todayExpenseAgg),
      weekExpenses: spent(weekExpenseAgg),
      last30DaysIncome: last30IncomeAgg._sum.amount || 0,
      last30DaysExpenses: spent(last30ExpenseAgg),
      monthIncome,
      monthExpenses,
      monthNet: monthIncome - monthExpenses,
    },
    topExpenseCategories: topExpenseCategories.map(([categoryId, amount]) => ({
      name: catMap.get(categoryId) || 'Unknown',
      amount,
    })),
    recentTransactions: recent.map((t) => ({
      date: toDayString(t.date),
      kind: t.kind,
      amount: t.amount,
      category: t.category?.name ?? null,
      account: t.account?.name ?? null,
      merchant: t.merchantOrSource,
    })),
    recentIncome: recentIncome.map((t) => ({
      date: toDayString(t.date),
      amount: t.amount,
      category: t.category?.name ?? null,
      account: t.account?.name ?? null,
      merchant: t.merchantOrSource,
    })),
    friends,
    loans,
    goals: goalsRaw.map(goalProgress).map((g) => ({
      name: g.name,
      target: g.targetAmount,
      saved: g.totalContributions,
      progress: Math.round(g.progress),
      account: g.account?.name ?? null,
    })),
  };
}

export function formatFinanceContextForPrompt(ctx: FinanceContext): string {
  return JSON.stringify(ctx, null, 2);
}
