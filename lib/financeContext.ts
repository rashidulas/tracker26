import { prisma } from '@/lib/prisma';
import { computeAccountBalance } from '@/lib/accountBalance';
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
  goals: {
    name: string;
    target: number;
    saved: number;
    progressPct: number;
  }[];
  budgets: {
    category: string;
    budgeted: number;
    spent: number;
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
    goals,
    budgets,
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
    prisma.goal.findMany({ include: { contributions: true } }),
    prisma.budget.findMany({
      where: { month: monthStart },
      include: { category: true },
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
    .filter((a) => a.type !== 'CREDIT_CARD')
    .reduce((s, a) => s + a.balance, 0);
  const creditCardDebt = accounts
    .filter((a) => a.type === 'CREDIT_CARD')
    .reduce((s, a) => s + Math.abs(Math.min(a.balance, 0)), 0);

  const monthIncome = monthIncomeAgg._sum.amount || 0;
  const monthExpenses = monthExpenseAgg._sum.amount || 0;

  const catMap = new Map(categories.map((c) => [c.id, c.name]));
  const spendingByCategory = new Map(
    expensesByCategory.map((e) => [e.categoryId!, e._sum.amount || 0])
  );

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
    goals: goals.map((g) => {
      const saved = g.contributions.reduce((s, c) => s + c.amount, 0);
      return {
        name: g.name,
        target: g.targetAmount,
        saved,
        progressPct: g.targetAmount > 0 ? Math.round((saved / g.targetAmount) * 100) : 0,
      };
    }),
    budgets: budgets.map((b) => ({
      category: b.category.name,
      budgeted: b.amount,
      spent: spendingByCategory.get(b.categoryId) || 0,
    })),
  };
}

export function formatFinanceContextForPrompt(ctx: FinanceContext): string {
  return JSON.stringify(ctx, null, 2);
}
