import { prisma } from '@/lib/prisma';
import {
  collectFromTransactionsForAccount,
  computeAccountBalance,
} from '@/lib/accountBalance';
import {
  friendBalance,
  round2,
  sortFriends,
  toDateString,
  toTransactionDTO,
  transactionInclude,
  type TransactionDTO,
} from './dto';

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FALLBACK_COLOR = '#6b7280';
const DAY_MS = 24 * 60 * 60 * 1000;

type Liability = {
  id: string;
  name: string;
  institution: string | null;
  currentBalance: number;
  balanceAtMonthStart: number;
};

export type DashboardDTO = {
  totalBalance: number;
  cashBalance: number;
  monthIncome: number;
  monthExpenses: number;
  lastMonthIncome: number;
  lastMonthExpenses: number;
  creditCards: (Liability & { creditLimit: number | null })[];
  loans: Liability[];
  friends: { id: string; name: string; color: string; balance: number; entryCount: number }[];
  friendsOwedToYou: number;
  friendsYouOwe: number;
  categoryData: { categoryId: string; name: string; value: number; color: string; icon: string | null }[];
  monthlyTrend: { month: string; label: string; income: number; expenses: number }[];
  dailySpending: { date: string; amount: number }[];
  recentTransactions: TransactionDTO[];
};

/**
 * Same numbers as the web dashboard (app/dashboard/actions.ts) but with all
 * month windows computed in UTC (transaction dates are stored as UTC
 * midnight), and trend/category/daily data bucketed in JS from a single
 * INCOME/EXPENSE query instead of 24+ sequential aggregates.
 */
export async function getDashboard(): Promise<DashboardDTO> {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const monthStart = new Date(Date.UTC(y, m, 1));
  const nextMonthStart = new Date(Date.UTC(y, m + 1, 1));
  const lastMonthStart = new Date(Date.UTC(y, m - 1, 1));
  const trendStart = new Date(Date.UTC(y, m - 11, 1));

  const [accounts, incomeExpenseRows, recent, friendsRaw] = await Promise.all([
    prisma.account.findMany({
      orderBy: { name: 'asc' },
      include: {
        transactionsFrom: {
          select: { amount: true, kind: true, date: true, accountId: true, accountSplits: true },
        },
        transactionsTo: { select: { amount: true, date: true } },
      },
    }),
    prisma.transaction.findMany({
      where: { kind: { in: ['INCOME', 'EXPENSE'] } },
      select: {
        amount: true,
        kind: true,
        date: true,
        accountId: true,
        accountSplits: true,
        categoryId: true,
      },
    }),
    prisma.transaction.findMany({
      take: 10,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      include: transactionInclude,
    }),
    prisma.friend.findMany({
      orderBy: { name: 'asc' },
      include: { entries: { select: { type: true, amount: true } } },
    }),
  ]);

  // ---- Account balances (identical math to web `balanceFor`) ----
  const withSplits = incomeExpenseRows.filter((t) => (t.accountSplits || []).length > 0);
  type AccountRow = (typeof accounts)[number];

  const balanceFor = (a: AccountRow, before?: Date) => {
    const fromFilter = before ? (t: { date: Date }) => t.date < before : undefined;
    const linked = fromFilter ? a.transactionsFrom.filter(fromFilter) : a.transactionsFrom;
    const splitPool = fromFilter ? withSplits.filter(fromFilter) : withSplits;
    const from = collectFromTransactionsForAccount(a.id, linked, splitPool);
    const to = fromFilter ? a.transactionsTo.filter(fromFilter) : a.transactionsTo;
    return computeAccountBalance(a.startingBalance, from, to, a.id);
  };

  const mapLiability = (a: AccountRow): Liability => ({
    id: a.id,
    name: a.name,
    institution: a.institution ?? null,
    currentBalance: round2(balanceFor(a)),
    balanceAtMonthStart: round2(balanceFor(a, monthStart)),
  });

  const creditCards = accounts
    .filter((a) => a.type === 'CREDIT_CARD')
    .map((a) => ({ ...mapLiability(a), creditLimit: a.creditLimit ?? null }));
  const loans = accounts.filter((a) => a.type === 'LOAN').map(mapLiability);

  const balances = accounts.map((a) => ({ type: a.type, balance: balanceFor(a) }));
  const totalBalance = round2(balances.reduce((s, a) => s + a.balance, 0));
  const cashBalance = round2(
    balances
      .filter((a) => a.type !== 'CREDIT_CARD' && a.type !== 'LOAN')
      .reduce((s, a) => s + a.balance, 0)
  );

  // ---- Month buckets ----
  const trendKeys: string[] = [];
  for (let i = 11; i >= 0; i--) {
    trendKeys.push(new Date(Date.UTC(y, m - i, 1)).toISOString().slice(0, 7));
  }
  const trend = new Map(trendKeys.map((k) => [k, { income: 0, expenses: 0 }]));
  const lastMonthKey = lastMonthStart.toISOString().slice(0, 7);
  const thisMonthKey = monthStart.toISOString().slice(0, 7);

  const byCategory = new Map<string, number>();
  const byDay = new Map<string, number>();

  for (const t of incomeExpenseRows) {
    if (t.date < trendStart || t.date >= nextMonthStart) continue;
    const key = t.date.toISOString().slice(0, 7);
    const bucket = trend.get(key);
    if (!bucket) continue;
    if (t.kind === 'INCOME') bucket.income += t.amount;
    else bucket.expenses += t.amount;

    if (key === thisMonthKey && t.kind === 'EXPENSE') {
      if (t.categoryId) byCategory.set(t.categoryId, (byCategory.get(t.categoryId) || 0) + t.amount);
      const day = toDateString(t.date);
      byDay.set(day, (byDay.get(day) || 0) + t.amount);
    }
  }

  const monthlyTrend = trendKeys.map((key) => {
    const bucket = trend.get(key)!;
    return {
      month: key,
      label: MONTH_LABELS[Number(key.slice(5, 7)) - 1],
      income: round2(bucket.income),
      expenses: round2(bucket.expenses),
    };
  });

  const thisMonth = trend.get(thisMonthKey)!;
  const lastMonth = trend.get(lastMonthKey)!;

  // ---- Category breakdown (this month's EXPENSE) ----
  const categories = byCategory.size
    ? await prisma.category.findMany({ where: { id: { in: [...byCategory.keys()] } } })
    : [];
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const categoryData = [...byCategory.entries()]
    .map(([categoryId, value]) => {
      const category = categoryById.get(categoryId);
      return {
        categoryId,
        name: category?.name || 'Unknown',
        value: round2(value),
        color: category?.color || FALLBACK_COLOR,
        icon: category?.icon ?? null,
      };
    })
    .sort((a, b) => b.value - a.value);

  // ---- Daily spending: each UTC day from month start through today ----
  const todayStart = Date.UTC(y, m, now.getUTCDate());
  const dailySpending: DashboardDTO['dailySpending'] = [];
  for (let t = monthStart.getTime(); t <= todayStart; t += DAY_MS) {
    const date = toDateString(new Date(t));
    dailySpending.push({ date, amount: round2(byDay.get(date) || 0) });
  }

  // ---- Friends ----
  const friends = sortFriends(
    friendsRaw.map((f) => ({
      id: f.id,
      name: f.name,
      color: f.color,
      balance: friendBalance(f.entries),
      entryCount: f.entries.length,
    }))
  );
  const friendsOwedToYou = round2(friends.reduce((s, f) => s + Math.max(0, f.balance), 0));
  const friendsYouOwe = round2(friends.reduce((s, f) => s + Math.max(0, -f.balance), 0));

  return {
    totalBalance,
    cashBalance,
    monthIncome: round2(thisMonth.income),
    monthExpenses: round2(thisMonth.expenses),
    lastMonthIncome: round2(lastMonth.income),
    lastMonthExpenses: round2(lastMonth.expenses),
    creditCards,
    loans,
    friends,
    friendsOwedToYou,
    friendsYouOwe,
    categoryData,
    monthlyTrend,
    dailySpending,
    recentTransactions: recent.map(toTransactionDTO),
  };
}
