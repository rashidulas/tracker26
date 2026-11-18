'use server';

import { prisma } from '@/lib/prisma';
import {
  collectFromTransactionsForAccount,
  computeAccountBalance,
} from '@/lib/accountBalance';
import { signedFriendAmount } from '@/lib/friends';
import { expenseCategoryAllocations } from '@/lib/transactions';
import { todayInAppTimeZone, monthRange, toDayString, eachDay, formatDay } from '@/lib/dates';
import { loadSuggestions, loadUpcoming } from '@/lib/recurringQueries';

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
      dailyTransactions,
      friendsRaw,
      splitTransactionsRaw,
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
        _sum: { amount: true },
      }),
      // Not a groupBy on categoryId: split expenses have categoryId null and
      // carry their categories in splitItems.
      prisma.transaction.findMany({
        where: {
          kind: 'EXPENSE',
          date: thisMonth,
        },
        select: { amount: true, categoryId: true, splitItems: true },
      }),
      prisma.transaction.findMany({
        take: 10,
        orderBy: { date: 'desc' },
        include: { category: true, account: true, toAccount: true },
      }),
      prisma.account.findMany({
        include: {
          transactionsFrom: {
            select: {
              amount: true,
              kind: true,
              date: true,
              accountId: true,
              accountSplits: true,
            },
          },
          transactionsTo: {
            where: { kind: 'TRANSFER' },
            select: { amount: true, date: true },
          },
        },
      }),
      prisma.transaction.findMany({
        where: {
          kind: 'EXPENSE',
          date: thisMonth,
        },
        select: { date: true, amount: true, recurringId: true },
        orderBy: { date: 'asc' },
      }),
      prisma.friend.findMany({
        include: { entries: true },
        orderBy: { name: 'asc' },
      }),
      prisma.transaction.findMany({
        where: { kind: { in: ['INCOME', 'EXPENSE'] } },
        select: {
          amount: true,
          kind: true,
          date: true,
          accountId: true,
          accountSplits: true,
        },
      }),
      // 12-month trend, split into recurring and everyday spending.
      prisma.transaction.findMany({
        where: {
          kind: { in: ['INCOME', 'EXPENSE'] },
          date: { gte: monthRange(today, -11).gte, lt: thisMonth.lt },
        },
        select: { kind: true, amount: true, date: true, recurringId: true },
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
        else if (t.recurringId) recurring += t.amount;
        else everyday += t.amount;
      }
      monthlyTrend.push({
        month: formatDay(range.gte, { month: 'short' }),
        income,
        expenses: recurring + everyday,
        recurring,
        everyday,
      });
    }

    const withSplits = splitTransactionsRaw.filter(
      (t) => (t.accountSplits || []).length > 0
    );

    const balanceFor = (
      a: (typeof accounts)[number],
      fromFilter?: (t: (typeof a.transactionsFrom)[number]) => boolean,
      toFilter?: (t: (typeof a.transactionsTo)[number]) => boolean
    ) => {
      const linked = fromFilter
        ? a.transactionsFrom.filter(fromFilter)
        : a.transactionsFrom;
      const splitPool = fromFilter ? withSplits.filter(fromFilter) : withSplits;
      const from = collectFromTransactionsForAccount(a.id, linked, splitPool);
      const to = toFilter ? a.transactionsTo.filter(toFilter) : a.transactionsTo;
      return computeAccountBalance(a.startingBalance, from, to, a.id);
    };

    const mapLiability = (a: (typeof accounts)[number]) => {
      const currentBalance = balanceFor(a);
      const balanceAtMonthStart = balanceFor(
        a,
        (t) => t.date < monthStart,
        (t) => t.date < monthStart
      );

      return {
        id: a.id,
        name: a.name,
        institution: a.institution,
        currentBalance,
        balanceAtMonthStart,
        creditLimit: a.creditLimit ?? null,
      };
    };

    const creditCards = accounts.filter((a) => a.type === 'CREDIT_CARD').map(mapLiability);
    const loans = accounts.filter((a) => a.type === 'LOAN').map(mapLiability);

    const cashBalance = accounts
      .filter((a) => a.type !== 'CREDIT_CARD' && a.type !== 'LOAN')
      .reduce((sum, a) => sum + balanceFor(a), 0);

    const totalBalance = accounts.reduce(
      (sum, account) => sum + balanceFor(account),
      0
    );

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

    // Daily spending trend for area chart
    const days = eachDay(toDayString(monthStart), today);
    const dailyMap = new Map<string, { recurring: number; everyday: number }>();
    for (const t of dailyTransactions) {
      const key = toDayString(t.date);
      const day = dailyMap.get(key) ?? { recurring: 0, everyday: 0 };
      if (t.recurringId) day.recurring += t.amount;
      else day.everyday += t.amount;
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
        monthExpenses: monthExpensesAgg._sum.amount || 0,
        totalBalance,
        cashBalance,
        creditCards,
        loans,
        friends,
        friendsOwedToYou,
        friendsYouOwe,
        categoryData,
        monthlyTrend,
        recentTransactions,
        dailySpending,
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
