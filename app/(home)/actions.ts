'use server';

import { prisma } from '@/lib/prisma';
import { signedFriendAmount } from '@/lib/friends';
import { expenseCategoryAllocations, myShareOfExpense } from '@/lib/transactions';
import { loadAccountBalances } from '@/lib/ledgerBalances';
import { goalProgress } from '@/lib/goals';
import { todayInAppTimeZone, monthRange, toDayString, eachDay, formatDay } from '@/lib/dates';
import { loadSuggestions, loadUpcoming } from '@/lib/recurringQueries';
import { loadBudgetOverview } from '@/lib/budgetData';

/** Spending from an aggregate: your share, not what friends owe you back. */
function spentFrom(agg: { _sum: { amount: number | null; sharedAmount: number | null } }) {
  return (agg._sum.amount || 0) - (agg._sum.sharedAmount || 0);
}

export async function getDashboardData() {
  try {
    const today = todayInAppTimeZone();
    const thisMonth = monthRange(today);
    const monthStart = thisMonth.gte;

    const [
      monthIncomeAgg,
      monthExpensesAgg,
      monthExpenses,
      recentTransactions,
      accounts,
      accountsAtMonthStart,
      dailyTransactions,
      friendsRaw,
      goalsRaw,
      budget,
      trendRows,
      upcoming,
      suggestions,
    ] = await Promise.all([
      prisma.transaction.aggregate({
        where: { kind: 'INCOME', date: thisMonth },
        _sum: { amount: true },
      }),
      prisma.transaction.aggregate({
        where: { kind: 'EXPENSE', date: thisMonth },
        _sum: { amount: true, sharedAmount: true },
      }),
      // Not a groupBy on categoryId: split expenses have categoryId null and
      // carry their categories in splitItems.
      prisma.transaction.findMany({
        where: {
          kind: 'EXPENSE',
          date: thisMonth,
        },
        select: { amount: true, categoryId: true, splitItems: true, sharedAmount: true },
      }),
      prisma.transaction.findMany({
        take: 10,
        orderBy: { date: 'desc' },
        include: { category: true, account: true, toAccount: true },
      }),
      loadAccountBalances(prisma),
      loadAccountBalances(prisma, { before: monthStart }),
      prisma.transaction.findMany({
        where: {
          kind: 'EXPENSE',
          date: thisMonth,
        },
        select: { date: true, amount: true, sharedAmount: true, recurringId: true },
        orderBy: { date: 'asc' },
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
      loadBudgetOverview(today).catch((error) => {
        console.error('Error loading budget overview:', error);
        return null;
      }),
      // 12-month trend, split into recurring and everyday spending.
      prisma.transaction.findMany({
        where: {
          kind: { in: ['INCOME', 'EXPENSE'] },
          date: { gte: monthRange(today, -11).gte, lt: thisMonth.lt },
        },
        select: { kind: true, amount: true, sharedAmount: true, date: true, recurringId: true },
      }),
      loadUpcoming(today),
      loadSuggestions(today),
    ]);

    const totalsByCategory = new Map<string, number>();
    for (const expense of monthExpenses) {
      for (const share of expenseCategoryAllocations(expense)) {
        totalsByCategory.set(
          share.categoryId,
          (totalsByCategory.get(share.categoryId) || 0) + share.amount
        );
      }
    }

    const categoriesMap = await prisma.category.findMany({
      where: { id: { in: [...totalsByCategory.keys()] } },
    });

    const categoryData = [...totalsByCategory.entries()].map(([categoryId, value]) => {
      const category = categoriesMap.find((c) => c.id === categoryId);
      return {
        name: category?.name || 'Unknown',
        value,
        color: category?.color || '#gray',
      };
    });

    // Monthly trend (12 months). "Recurring" is spending posted from (or
    // linked to) a recurring entry; "everyday" is the rest.
    const monthlyTrend = [];
    for (let i = 11; i >= 0; i--) {
      const range = monthRange(today, -i);
      let income = 0;
      let recurring = 0;
      let everyday = 0;
      for (const t of trendRows) {
        if (t.date < range.gte || t.date >= range.lt) continue;
        if (t.kind === 'INCOME') income += t.amount;
        else if (t.recurringId) recurring += myShareOfExpense(t);
        else everyday += myShareOfExpense(t);
      }
      monthlyTrend.push({
        month: formatDay(range.gte, { month: 'short' }),
        income,
        expenses: recurring + everyday,
        recurring,
        everyday,
      });
    }

    const startById = new Map(accountsAtMonthStart.map((a) => [a.id, a.currentBalance]));
    const mapLiability = (a: (typeof accounts)[number]) => ({
      id: a.id,
      name: a.name,
      institution: a.institution,
      currentBalance: a.currentBalance,
      balanceAtMonthStart: startById.get(a.id) ?? a.startingBalance,
      creditLimit: a.creditLimit ?? null,
    });

    const creditCards = accounts.filter((a) => a.type === 'CREDIT_CARD').map(mapLiability);
    const loans = accounts.filter((a) => a.type === 'LOAN').map(mapLiability);

    const cashAccounts = accounts.filter((a) => a.type !== 'CREDIT_CARD' && a.type !== 'LOAN');
    const cashBalance = cashAccounts.reduce((sum, a) => sum + a.currentBalance, 0);
    const earmarkedForGoals = accounts.reduce((sum, a) => sum + a.earmarked, 0);

    const totalBalance = accounts.reduce((sum, account) => sum + account.currentBalance, 0);

    const friends = friendsRaw
      .map((f) => {
        const balance = f.entries.reduce(
          (sum, entry) => sum + signedFriendAmount(entry.type, entry.amount),
          0
        );
        return {
          id: f.id,
          name: f.name,
          color: f.color,
          balance,
          entryCount: f.entries.length,
        };
      })
      .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));

    const friendsOwedToYou = friends.reduce((s, f) => s + Math.max(0, f.balance), 0);
    const friendsYouOwe = friends.reduce((s, f) => s + Math.max(0, -f.balance), 0);

    const goals = goalsRaw
      .map(goalProgress)
      .map((g) => ({
        id: g.id,
        name: g.name,
        targetAmount: g.targetAmount,
        saved: g.totalContributions,
        transferred: g.transferred,
        earmarked: g.earmarked,
        progress: g.progress,
        dueDate: g.dueDate,
        accountName: g.account?.name ?? null,
      }))
      // Unfinished goals first, closest to done at the top.
      .sort((a, b) => Number(a.progress >= 100) - Number(b.progress >= 100) || b.progress - a.progress);

    // Daily spending trend for area chart
    const days = eachDay(toDayString(monthStart), today);
    const dailyMap = new Map<string, { recurring: number; everyday: number }>();
    for (const t of dailyTransactions) {
      const key = toDayString(t.date);
      const day = dailyMap.get(key) ?? { recurring: 0, everyday: 0 };
      if (t.recurringId) day.recurring += myShareOfExpense(t);
      else day.everyday += myShareOfExpense(t);
      dailyMap.set(key, day);
    }
    const dailySpending = days.map((d) => {
      const day = dailyMap.get(d) ?? { recurring: 0, everyday: 0 };
      return {
        date: formatDay(d, { month: 'short', day: '2-digit' }),
        amount: day.recurring + day.everyday,
        recurring: day.recurring,
        everyday: day.everyday,
      };
    });

    return {
      success: true,
      data: {
        monthIncome: monthIncomeAgg._sum.amount || 0,
        monthExpenses: spentFrom(monthExpensesAgg),
        totalBalance,
        cashBalance,
        earmarkedForGoals,
        creditCards,
        loans,
        friends,
        friendsOwedToYou,
        friendsYouOwe,
        goals,
        categoryData,
        monthlyTrend,
        recentTransactions,
        dailySpending,
        budget,
        upcoming,
        suggestionCount: suggestions.length,
      },
    };
  } catch (error) {
    console.error('Error fetching dashboard data:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to fetch dashboard data';
    return { success: false, error: `Failed to fetch dashboard data: ${errorMessage}` };
  }
}
