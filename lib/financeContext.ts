import { prisma } from '@/lib/prisma';
import { computeAccountBalance } from '@/lib/accountBalance';
import { signedFriendAmount } from '@/lib/friends';
import {
  startOfDay,
  endOfDay,
  startOfMonth,
  endOfMonth,
  subDays,
  format,
} from 'date-fns';

export type FinanceContext = {
  today: string;
  accounts: {
    id: string;
    name: string;
    type: string;
    balance: number;
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
  friends: {
    name: string;
    balance: number;
  }[];
  loans: {
    name: string;
    balance: number;
  }[];
};

export async function getFinanceContext(): Promise<FinanceContext> {
  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);
  const weekStart = startOfDay(subDays(now, 6));
  const monthStart = startOfMonth(now);
  const monthEnd = endOfMonth(now);
  const today = format(now, 'yyyy-MM-dd');

  const [
    accountsRaw,
    categories,
    todayIncomeAgg,
    todayExpenseAgg,
    weekExpenseAgg,
    monthIncomeAgg,
    monthExpenseAgg,
    expensesByCategory,
    recent,
    friendsRaw,
  ] = await Promise.all([
    prisma.account.findMany({
      include: {
        transactionsFrom: { select: { amount: true, kind: true } },
        transactionsTo: { select: { amount: true } },
      },
      orderBy: { name: 'asc' },
    }),
    prisma.category.findMany({
      select: { id: true, name: true, type: true },
      orderBy: { name: 'asc' },
    }),
    prisma.transaction.aggregate({
      where: { kind: 'INCOME', date: { gte: todayStart, lte: todayEnd } },
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: { kind: 'EXPENSE', date: { gte: todayStart, lte: todayEnd } },
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: { kind: 'EXPENSE', date: { gte: weekStart, lte: todayEnd } },
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: { kind: 'INCOME', date: { gte: monthStart, lte: monthEnd } },
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: { kind: 'EXPENSE', date: { gte: monthStart, lte: monthEnd } },
      _sum: { amount: true },
    }),
    prisma.transaction.groupBy({
      by: ['categoryId'],
      where: {
        kind: 'EXPENSE',
        date: { gte: monthStart, lte: monthEnd },
        categoryId: { not: null },
      },
      _sum: { amount: true },
      orderBy: { _sum: { amount: 'desc' } },
      take: 8,
    }),
    prisma.transaction.findMany({
      take: 20,
      orderBy: { date: 'desc' },
      include: { category: true, account: true },
    }),
    prisma.friend.findMany({
      include: { entries: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  const accounts = accountsRaw.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type,
    balance: computeAccountBalance(a.startingBalance, a.transactionsFrom, a.transactionsTo),
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
  const monthExpenses = monthExpenseAgg._sum.amount || 0;

  const catMap = new Map(categories.map((c) => [c.id, c.name]));

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
      todayExpenses: todayExpenseAgg._sum.amount || 0,
      weekExpenses: weekExpenseAgg._sum.amount || 0,
      monthIncome,
      monthExpenses,
      monthNet: monthIncome - monthExpenses,
    },
    topExpenseCategories: expensesByCategory.map((e) => ({
      name: catMap.get(e.categoryId!) || 'Unknown',
      amount: e._sum.amount || 0,
    })),
    recentTransactions: recent.map((t) => ({
      date: t.date.toISOString().slice(0, 10),
      kind: t.kind,
      amount: t.amount,
      category: t.category?.name ?? null,
      account: t.account?.name ?? null,
      merchant: t.merchantOrSource,
    })),
    friends,
    loans,
  };
}

export function formatFinanceContextForPrompt(ctx: FinanceContext): string {
  return JSON.stringify(ctx, null, 2);
}
