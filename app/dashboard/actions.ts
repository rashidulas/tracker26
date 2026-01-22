'use server';

import { prisma } from '@/lib/prisma';
import { startOfMonth, endOfMonth, startOfYear, subMonths } from 'date-fns';

export async function getDashboardData() {
  try {
    const now = new Date();
    const monthStart = startOfMonth(now);
    const monthEnd = endOfMonth(now);
    const yearStart = startOfYear(now);

    // Get current month income
    const monthIncome = await prisma.transaction.aggregate({
      where: {
        kind: 'INCOME',
        date: { gte: monthStart, lte: monthEnd },
      },
      _sum: { amount: true },
    });

    // Get current month expenses
    const monthExpenses = await prisma.transaction.aggregate({
      where: {
        kind: 'EXPENSE',
        date: { gte: monthStart, lte: monthEnd },
      },
      _sum: { amount: true },
    });

    // Get expenses by category (current month)
    const expensesByCategory = await prisma.transaction.groupBy({
      by: ['categoryId'],
      where: {
        kind: 'EXPENSE',
        date: { gte: monthStart, lte: monthEnd },
        categoryId: { not: null },
      },
      _sum: { amount: true },
    });

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

    // Get monthly trend for the year
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

    // Get total debt
    const debts = await prisma.debt.findMany();
    const totalDebt = debts.reduce((sum, debt) => sum + debt.currentBalance, 0);

    // Get total savings (goals)
    const goals = await prisma.goal.findMany({
      include: { contributions: true },
    });
    const totalSavings = goals.reduce((sum, goal) => {
      const contributions = goal.contributions.reduce((s, c) => s + c.amount, 0);
      return sum + contributions;
    }, 0);

    // Get recent transactions
    const recentTransactions = await prisma.transaction.findMany({
      take: 10,
      orderBy: { date: 'desc' },
      include: {
        category: true,
        account: true,
      },
    });

    // Calculate accounts total
    const accounts = await prisma.account.findMany({
      include: {
        transactionsFrom: {
          select: { amount: true, kind: true },
        },
        transactionsTo: {
          select: { amount: true },
        },
      },
    });

    const totalBalance = accounts.reduce((sum, account) => {
      const transactionTotal = account.transactionsFrom.reduce((s, t) => {
        if (t.kind === 'INCOME') return s + t.amount;
        if (t.kind === 'EXPENSE') return s - t.amount;
        return s;
      }, 0);
      const transfersIn = account.transactionsTo.reduce((s, t) => s + t.amount, 0);
      return sum + account.startingBalance + transactionTotal + transfersIn;
    }, 0);

    return {
      success: true,
      data: {
        monthIncome: monthIncome._sum.amount || 0,
        monthExpenses: monthExpenses._sum.amount || 0,
        totalDebt,
        totalSavings,
        totalBalance,
        categoryData,
        monthlyTrend,
        recentTransactions,
      },
    };
  } catch (error) {
    console.error('Error fetching dashboard data:', error);
    return { success: false, error: 'Failed to fetch dashboard data' };
  }
}
