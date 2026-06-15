'use server';

import { prisma } from '@/lib/prisma';
import { startOfMonth, endOfMonth, startOfYear, subMonths, eachDayOfInterval, format } from 'date-fns';

export async function getDashboardData() {
  try {
    const now = new Date();
    const monthStart = startOfMonth(now);
    const monthEnd = endOfMonth(now);

    const [
      monthIncomeAgg,
      monthExpensesAgg,
      expensesByCategory,
      debts,
      goals,
      recentTransactions,
      accounts,
      budgets,
      dailyTransactions,
    ] = await Promise.all([
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
      }),
      prisma.debt.findMany(),
      prisma.goal.findMany({ include: { contributions: true } }),
      prisma.transaction.findMany({
        take: 10,
        orderBy: { date: 'desc' },
        include: { category: true, account: true },
      }),
      prisma.account.findMany({
        include: {
          transactionsFrom: { select: { amount: true, kind: true, date: true } },
          transactionsTo: { select: { amount: true, date: true } },
        },
      }),
      prisma.budget.findMany({
        where: { month: monthStart },
        include: { category: true },
      }),
      prisma.transaction.findMany({
        where: {
          kind: 'EXPENSE',
          date: { gte: monthStart, lte: monthEnd },
        },
        select: { date: true, amount: true },
        orderBy: { date: 'asc' },
      }),
    ]);

    const categoriesMap = await prisma.category.findMany({
      where: {
        id: { in: expensesByCategory.map((e) => e.categoryId!).filter(Boolean) },
      },
    });

    const categoryData = expensesByCategory.map((expense) => {
      const category = categoriesMap.find((c) => c.id === expense.categoryId);
      return {
        name: category?.name || 'Unknown',
        value: expense._sum.amount || 0,
        color: category?.color || '#gray',
      };
    });

    // Monthly trend (12 months)
    const monthlyTrend = [];
    for (let i = 11; i >= 0; i--) {
      const date = subMonths(now, i);
      const start = startOfMonth(date);
      const end = endOfMonth(date);

      const [income, expenses] = await Promise.all([
        prisma.transaction.aggregate({
          where: { kind: 'INCOME', date: { gte: start, lte: end } },
          _sum: { amount: true },
        }),
        prisma.transaction.aggregate({
          where: { kind: 'EXPENSE', date: { gte: start, lte: end } },
          _sum: { amount: true },
        }),
      ]);

      monthlyTrend.push({
        month: start.toLocaleDateString('en-US', { month: 'short' }),
        income: income._sum.amount || 0,
        expenses: expenses._sum.amount || 0,
      });
    }

    const creditCards = accounts
      .filter((a) => a.type === 'CREDIT_CARD')
      .map((a) => {
        const transactionTotal = a.transactionsFrom.reduce((s, t) => {
          if (t.kind === 'INCOME') return s + t.amount;
          if (t.kind === 'EXPENSE') return s - t.amount;
          return s;
        }, 0);
        const transfersIn = a.transactionsTo.reduce((s, t) => s + t.amount, 0);
        const currentBalance = a.startingBalance + transactionTotal + transfersIn;

        // Balance at the very start of this month (before any this-month transactions)
        const priorTransactionTotal = a.transactionsFrom
          .filter((t) => new Date(t.date) < monthStart)
          .reduce((s, t) => {
            if (t.kind === 'INCOME') return s + t.amount;
            if (t.kind === 'EXPENSE') return s - t.amount;
            return s;
          }, 0);
        const priorTransfersIn = a.transactionsTo
          .filter((t) => new Date(t.date) < monthStart)
          .reduce((s, t) => s + t.amount, 0);
        const balanceAtMonthStart = a.startingBalance + priorTransactionTotal + priorTransfersIn;

        return {
          id: a.id,
          name: a.name,
          institution: a.institution,
          currentBalance,
          balanceAtMonthStart,
        };
      });

    const totalDebt = debts.reduce((sum, debt) => sum + debt.currentBalance, 0);

    const totalSavings = goals.reduce((sum, goal) => {
      const contributions = goal.contributions.reduce((s, c) => s + c.amount, 0);
      return sum + contributions;
    }, 0);

    const totalBalance = accounts.reduce((sum, account) => {
      const transactionTotal = account.transactionsFrom.reduce((s, t) => {
        if (t.kind === 'INCOME') return s + t.amount;
        if (t.kind === 'EXPENSE') return s - t.amount;
        return s;
      }, 0);
      const transfersIn = account.transactionsTo.reduce((s, t) => s + t.amount, 0);
      return sum + account.startingBalance + transactionTotal + transfersIn;
    }, 0);

    // Build spending-per-category lookup for budget progress
    const spendingByCategory = new Map<string, number>();
    for (const e of expensesByCategory) {
      if (e.categoryId) {
        spendingByCategory.set(e.categoryId, e._sum.amount || 0);
      }
    }

    const budgetProgress = budgets.map((b) => ({
      id: b.id,
      categoryName: b.category.name,
      categoryColor: b.category.color,
      budgeted: b.amount,
      spent: spendingByCategory.get(b.categoryId) || 0,
    }));

    // Daily spending trend for area chart
    const days = eachDayOfInterval({ start: monthStart, end: now > monthEnd ? monthEnd : now });
    const dailyMap = new Map<string, number>();
    for (const t of dailyTransactions) {
      const utcDate = new Date(
        t.date.getUTCFullYear(),
        t.date.getUTCMonth(),
        t.date.getUTCDate(),
        t.date.getUTCHours(),
        t.date.getUTCMinutes(),
        t.date.getUTCSeconds()
      );
      const key = format(utcDate, 'MMM dd');
      dailyMap.set(key, (dailyMap.get(key) || 0) + t.amount);
    }
    const dailySpending = days.map((d) => {
      const key = format(d, 'MMM dd');
      return { date: key, amount: dailyMap.get(key) || 0 };
    });

    return {
      success: true,
      data: {
        monthIncome: monthIncomeAgg._sum.amount || 0,
        monthExpenses: monthExpensesAgg._sum.amount || 0,
        totalDebt,
        totalSavings,
        totalBalance,
        creditCards,
        categoryData,
        monthlyTrend,
        recentTransactions,
        budgetProgress,
        dailySpending,
      },
    };
  } catch (error) {
    console.error('Error fetching dashboard data:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to fetch dashboard data';
    return { success: false, error: `Failed to fetch dashboard data: ${errorMessage}` };
  }
}
