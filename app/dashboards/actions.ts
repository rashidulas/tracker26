'use server';

import { prisma } from '@/lib/prisma';
import { getMonthDateRange } from '@/lib/utils';

// ==================== TYPES ====================
export type ExpenseFilter = {
  startDate?: Date;
  endDate?: Date;
  minAmount?: number;
  maxAmount?: number;
  categoryIds?: string[];
  accountIds?: string[];
  search?: string;
};

export type IncomeFilter = {
  startDate?: Date;
  endDate?: Date;
  minAmount?: number;
  maxAmount?: number;
  sourceIds?: string[]; // category IDs for income sources
  accountIds?: string[];
  search?: string;
};

// ==================== EXPENSE DASHBOARD ====================
export async function getFilteredExpenses(filter: ExpenseFilter) {
  try {
    const where: any = {
      kind: 'EXPENSE',
    };

    // Date range filter
    if (filter.startDate || filter.endDate) {
      where.date = {};
      if (filter.startDate) where.date.gte = filter.startDate;
      if (filter.endDate) where.date.lte = filter.endDate;
    }

    // Amount range filter
    if (filter.minAmount !== undefined || filter.maxAmount !== undefined) {
      where.amount = {};
      if (filter.minAmount !== undefined) where.amount.gte = filter.minAmount;
      if (filter.maxAmount !== undefined) where.amount.lte = filter.maxAmount;
    }

    // Category filter (multi-select)
    if (filter.categoryIds && filter.categoryIds.length > 0) {
      where.categoryId = { in: filter.categoryIds };
    }

    // Account filter
    if (filter.accountIds && filter.accountIds.length > 0) {
      where.accountId = { in: filter.accountIds };
    }

    // Text search (merchant or notes)
    if (filter.search) {
      where.OR = [
        { merchantOrSource: { contains: filter.search, mode: 'insensitive' } },
        { notes: { contains: filter.search, mode: 'insensitive' } },
      ];
    }

    const expenses = await prisma.transaction.findMany({
      where,
      include: {
        category: { select: { id: true, name: true, color: true } },
        account: { select: { id: true, name: true } },
      },
      orderBy: { date: 'desc' },
    });

    return expenses;
  } catch (error) {
    console.error('Error fetching filtered expenses:', error);
    throw new Error('Failed to fetch filtered expenses');
  }
}

export async function getExpenseSummary(filter: ExpenseFilter) {
  try {
    const expenses = await getFilteredExpenses(filter);

    // Calculate total
    const total = expenses.reduce((sum, exp) => sum + exp.amount, 0);

    // Calculate date range days
    const startDate = filter.startDate || (expenses.length > 0 ? expenses[expenses.length - 1].date : new Date());
    const endDate = filter.endDate || (expenses.length > 0 ? expenses[0].date : new Date());
    const daysDiff = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));

    // Average per day
    const avgPerDay = total / daysDiff;

    // Top 5 categories
    const categoryTotals: { [key: string]: { name: string; amount: number; color?: string } } = {};
    expenses.forEach(exp => {
      if (exp.category) {
        const catId = exp.category.id;
        if (!categoryTotals[catId]) {
          categoryTotals[catId] = { name: exp.category.name, amount: 0, color: exp.category.color || undefined };
        }
        categoryTotals[catId].amount += exp.amount;
      }
    });

    const topCategories = Object.entries(categoryTotals)
      .map(([id, data]) => ({ id, ...data }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);

    return {
      total,
      avgPerDay,
      count: expenses.length,
      daysDiff,
      topCategories,
    };
  } catch (error) {
    console.error('Error calculating expense summary:', error);
    throw new Error('Failed to calculate expense summary');
  }
}

export async function getExpenseChartData(filter: ExpenseFilter) {
  try {
    const expenses = await getFilteredExpenses(filter);

    // Category breakdown for pie chart
    const categoryData: { [key: string]: { id: string; name: string; value: number; color: string } } = {};
    expenses.forEach(exp => {
      if (exp.category) {
        const catId = exp.category.id;
        if (!categoryData[catId]) {
          categoryData[catId] = {
            id: catId,
            name: exp.category.name,
            value: 0,
            color: exp.category.color || '#6b7280',
          };
        }
        categoryData[catId].value += exp.amount;
      }
    });

    const pieData = Object.values(categoryData);

    // Daily trend for line chart
    const dailyTotals: { [key: string]: number } = {};
    expenses.forEach(exp => {
      const dateKey = exp.date.toISOString().split('T')[0];
      dailyTotals[dateKey] = (dailyTotals[dateKey] || 0) + exp.amount;
    });

    const trendData = Object.entries(dailyTotals)
      .map(([date, amount]) => ({ date, amount }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return { pieData, trendData };
  } catch (error) {
    console.error('Error generating expense chart data:', error);
    throw new Error('Failed to generate expense chart data');
  }
}

// ==================== INCOME DASHBOARD ====================
export async function getFilteredIncome(filter: IncomeFilter) {
  try {
    const where: any = {
      kind: 'INCOME',
    };

    // Date range filter
    if (filter.startDate || filter.endDate) {
      where.date = {};
      if (filter.startDate) where.date.gte = filter.startDate;
      if (filter.endDate) where.date.lte = filter.endDate;
    }

    // Amount range filter
    if (filter.minAmount !== undefined || filter.maxAmount !== undefined) {
      where.amount = {};
      if (filter.minAmount !== undefined) where.amount.gte = filter.minAmount;
      if (filter.maxAmount !== undefined) where.amount.lte = filter.maxAmount;
    }

    // Source filter (categoryIds)
    if (filter.sourceIds && filter.sourceIds.length > 0) {
      where.categoryId = { in: filter.sourceIds };
    }

    // Account filter
    if (filter.accountIds && filter.accountIds.length > 0) {
      where.accountId = { in: filter.accountIds };
    }

    // Text search (source or notes)
    if (filter.search) {
      where.OR = [
        { merchantOrSource: { contains: filter.search, mode: 'insensitive' } },
        { notes: { contains: filter.search, mode: 'insensitive' } },
      ];
    }

    const income = await prisma.transaction.findMany({
      where,
      include: {
        category: { select: { id: true, name: true, color: true } },
        account: { select: { id: true, name: true } },
      },
      orderBy: { date: 'desc' },
    });

    return income;
  } catch (error) {
    console.error('Error fetching filtered income:', error);
    throw new Error('Failed to fetch filtered income');
  }
}

export async function getIncomeSummary(filter: IncomeFilter) {
  try {
    const income = await getFilteredIncome(filter);

    // Calculate total
    const total = income.reduce((sum, inc) => sum + inc.amount, 0);

    // Calculate date range days
    const startDate = filter.startDate || (income.length > 0 ? income[income.length - 1].date : new Date());
    const endDate = filter.endDate || (income.length > 0 ? income[0].date : new Date());
    const daysDiff = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));
    const monthsDiff = Math.max(1, daysDiff / 30);

    // Average per day and per month
    const avgPerDay = total / daysDiff;
    const avgPerMonth = total / monthsDiff;

    // Breakdown by source
    const sourceTotals: { [key: string]: { name: string; amount: number; color?: string } } = {};
    income.forEach(inc => {
      if (inc.category) {
        const catId = inc.category.id;
        if (!sourceTotals[catId]) {
          sourceTotals[catId] = { name: inc.category.name, amount: 0, color: inc.category.color || undefined };
        }
        sourceTotals[catId].amount += inc.amount;
      }
    });

    const sourceBreakdown = Object.entries(sourceTotals)
      .map(([id, data]) => ({ id, ...data }))
      .sort((a, b) => b.amount - a.amount);

    return {
      total,
      avgPerDay,
      avgPerMonth,
      count: income.length,
      daysDiff,
      sourceBreakdown,
    };
  } catch (error) {
    console.error('Error calculating income summary:', error);
    throw new Error('Failed to calculate income summary');
  }
}

export async function getIncomeChartData(filter: IncomeFilter) {
  try {
    const income = await getFilteredIncome(filter);

    // Source breakdown for bar chart
    const sourceData: { [key: string]: { name: string; amount: number; color: string } } = {};
    income.forEach(inc => {
      if (inc.category) {
        const catId = inc.category.id;
        if (!sourceData[catId]) {
          sourceData[catId] = {
            name: inc.category.name,
            amount: 0,
            color: inc.category.color || '#10b981',
          };
        }
        sourceData[catId].amount += inc.amount;
      }
    });

    const barData = Object.values(sourceData);

    // Daily trend for line chart
    const dailyTotals: { [key: string]: number } = {};
    income.forEach(inc => {
      const dateKey = inc.date.toISOString().split('T')[0];
      dailyTotals[dateKey] = (dailyTotals[dateKey] || 0) + inc.amount;
    });

    const trendData = Object.entries(dailyTotals)
      .map(([date, amount]) => ({ date, amount }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return { barData, trendData };
  } catch (error) {
    console.error('Error generating income chart data:', error);
    throw new Error('Failed to generate income chart data');
  }
}

// ==================== HELPER FUNCTIONS ====================
export async function getExpenseCategories() {
  const categories = await prisma.category.findMany({
    where: {
      type: 'EXPENSE',
    },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, color: true },
  });
  return categories;
}

export async function getIncomeCategories() {
  const categories = await prisma.category.findMany({
    where: {
      type: 'INCOME',
    },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, color: true },
  });
  return categories;
}

export async function getAllAccounts() {
  const accounts = await prisma.account.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });
  return accounts;
}
