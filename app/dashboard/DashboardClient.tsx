'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import {
  Wallet,
  TrendingUp,
  TrendingDown,
  ArrowUpRight,
  ArrowDownRight,
  ShoppingCart,
  Home,
  Utensils,
  Music,
  Car,
  Zap,
  CreditCard,
  DollarSign,
  Users,
  HandCoins,
  ChevronRight,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  LineChart,
  Line,
} from 'recharts';
import { formatDate } from '@/lib/utils';
import DashboardViewSwitcher from '@/components/DashboardViewSwitcher';

interface LiabilityItem {
  id: string;
  name: string;
  institution: string | null;
  currentBalance: number;
  balanceAtMonthStart: number;
}

interface FriendSummary {
  id: string;
  name: string;
  color: string;
  balance: number;
  entryCount: number;
}

interface DashboardClientProps {
  data: {
    monthIncome: number;
    monthExpenses: number;
    totalBalance: number;
    cashBalance: number;
    creditCards: LiabilityItem[];
    loans: LiabilityItem[];
    friends: FriendSummary[];
    friendsOwedToYou: number;
    friendsYouOwe: number;
    categoryData: Array<{ name: string; value: number; color: string }>;
    monthlyTrend: Array<{ month: string; income: number; expenses: number }>;
    recentTransactions: Array<{
      id: string;
      date: Date;
      amount: number;
      kind: string;
      category: { name: string; icon: string | null; color: string } | null;
      account: { name: string } | null;
    }>;
    dailySpending: Array<{ date: string; amount: number }>;
  };
}

const MINT = '#3dcea6';
const DANGER = '#f07178';
const GRID = '#262b36';
const TICK = '#6b7280';
const EXPENSE_LINE = '#f07178';

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.07, duration: 0.45, ease: [0.25, 0.46, 0.45, 0.94] as [number, number, number, number] },
  }),
};

const categoryIcons: Record<string, React.ElementType> = {
  food: Utensils,
  groceries: ShoppingCart,
  rent: Home,
  entertainment: Music,
  transport: Car,
  utilities: Zap,
  shopping: ShoppingCart,
};

function getCategoryIcon(name: string) {
  const key = name.toLowerCase();
  for (const [k, Icon] of Object.entries(categoryIcons)) {
    if (key.includes(k)) return Icon;
  }
  return CreditCard;
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatCurrencyFull(amount: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
}

function MiniSparkline({ data, color }: { data: number[]; color: string }) {
  const chartData = data.map((v, i) => ({ x: i, y: v }));
  return (
    <div className="w-24 h-10">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData}>
          <Line type="monotone" dataKey="y" stroke={color} strokeWidth={1.5} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="glass rounded-xl px-3 py-2 text-xs shadow-panel">
      <p className="text-ink-muted mb-1">{label}</p>
      <p className="text-mint font-semibold money">{formatCurrencyFull(payload[0].value)}</p>
    </div>
  );
}

export default function DashboardClient({ data }: DashboardClientProps) {
  const netIncome = data.monthIncome - data.monthExpenses;
  const incomeChange =
    data.monthlyTrend.length >= 2
      ? ((data.monthlyTrend[data.monthlyTrend.length - 1].income -
          data.monthlyTrend[data.monthlyTrend.length - 2].income) /
          (data.monthlyTrend[data.monthlyTrend.length - 2].income || 1)) *
        100
      : 0;
  const expenseChange =
    data.monthlyTrend.length >= 2
      ? ((data.monthlyTrend[data.monthlyTrend.length - 1].expenses -
          data.monthlyTrend[data.monthlyTrend.length - 2].expenses) /
          (data.monthlyTrend[data.monthlyTrend.length - 2].expenses || 1)) *
        100
      : 0;

  const sparkIncome = data.monthlyTrend.slice(-7).map((d) => d.income);
  const sparkExpense = data.monthlyTrend.slice(-7).map((d) => d.expenses);
  const sparkBalance = data.monthlyTrend.slice(-7).map((d) => d.income - d.expenses);

  const summaryCards = [
    {
      title: 'Total Balance',
      value: formatCurrency(data.totalBalance),
      change:
        netIncome >= 0
          ? '+' + formatCurrency(netIncome) + ' this month'
          : formatCurrency(netIncome) + ' this month',
      changePositive: netIncome >= 0,
      icon: Wallet,
      sparkData: sparkBalance,
      sparkColor: MINT,
    },
    {
      title: 'Monthly Income',
      value: formatCurrency(data.monthIncome),
      change: `${incomeChange >= 0 ? '+' : ''}${incomeChange.toFixed(1)}% vs last month`,
      changePositive: incomeChange >= 0,
      icon: TrendingUp,
      sparkData: sparkIncome,
      sparkColor: MINT,
    },
    {
      title: 'Monthly Expenses',
      value: formatCurrency(data.monthExpenses),
      change: `${expenseChange >= 0 ? '+' : ''}${expenseChange.toFixed(1)}% vs last month`,
      changePositive: expenseChange <= 0,
      icon: TrendingDown,
      sparkData: sparkExpense,
      sparkColor: DANGER,
    },
  ];

  return (
    <div className="page-shell space-y-6 lg:space-y-8">
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4"
      >
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">Your financial overview at a glance</p>
        </div>
        <DashboardViewSwitcher />
      </motion.div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-5">
        {summaryCards.map((card, i) => {
          const Icon = card.icon;
          return (
            <motion.div
              key={card.title}
              custom={i}
              initial="hidden"
              animate="visible"
              variants={fadeUp}
              className="group relative overflow-hidden panel shadow-panel p-5 sm:p-6 hover:border-graphite-border transition-colors duration-300"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-mint/[0.04] to-transparent pointer-events-none" />
              <div className="relative flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2.5 mb-3">
                    <div className="w-8 h-8 rounded-lg bg-mint-dim border border-mint/15 flex items-center justify-center">
                      <Icon size={15} className="text-mint" />
                    </div>
                    <p className="text-[11px] font-medium text-ink-muted uppercase tracking-[0.14em]">
                      {card.title}
                    </p>
                  </div>
                  <p className="text-2xl sm:text-3xl font-semibold text-ink tracking-tight money">
                    {card.value}
                  </p>
                  <div className="flex items-center gap-1.5 mt-2">
                    {card.changePositive ? (
                      <ArrowUpRight size={14} className="text-mint" />
                    ) : (
                      <ArrowDownRight size={14} className="text-danger" />
                    )}
                    <span
                      className={`text-xs font-medium ${
                        card.changePositive ? 'text-mint' : 'text-danger'
                      }`}
                    >
                      {card.change}
                    </span>
                  </div>
                </div>
                <MiniSparkline data={card.sparkData} color={card.sparkColor} />
              </div>
            </motion.div>
          );
        })}
      </div>

      <motion.div
        custom={3}
        initial="hidden"
        animate="visible"
        variants={fadeUp}
        className="panel shadow-panel px-5 py-4 flex items-center justify-between"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-mint-dim border border-mint/15 flex items-center justify-center flex-shrink-0">
            <Wallet size={15} className="text-mint" />
          </div>
          <div>
            <p className="text-[11px] font-medium text-ink-muted uppercase tracking-[0.14em]">
              Cash &amp; Accounts
            </p>
            <p className="text-[10px] text-ink-muted/80">Checking, savings &amp; other</p>
          </div>
        </div>
        <p
          className={`text-xl font-semibold money ${
            data.cashBalance >= 0 ? 'text-mint' : 'text-danger'
          }`}
        >
          {formatCurrency(data.cashBalance)}
        </p>
      </motion.div>

      {data.creditCards.length > 0 && (
        <motion.div
          custom={3}
          initial="hidden"
          animate="visible"
          variants={fadeUp}
          className="panel shadow-panel p-5 sm:p-6"
        >
          <div className="flex items-start justify-between mb-6">
            <div>
              <div className="flex items-center gap-2.5 mb-1">
                <div className="w-8 h-8 rounded-lg bg-danger-dim border border-danger/15 flex items-center justify-center">
                  <CreditCard size={15} className="text-danger" />
                </div>
                <h2 className="text-lg font-semibold text-ink font-display">Credit Card Debt</h2>
              </div>
              <p className="text-xs text-ink-muted pl-[42px]">
                Outstanding balances across your cards
              </p>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-2xl sm:text-3xl font-semibold text-danger money">
                {formatCurrency(
                  data.creditCards.reduce((s, c) => s + Math.abs(c.currentBalance), 0)
                )}
              </p>
              <p className="text-xs text-ink-muted mt-0.5">
                {data.creditCards.length} card{data.creditCards.length !== 1 ? 's' : ''}
              </p>
            </div>
          </div>

          <div className="space-y-6">
            {data.creditCards.map((card, i) => {
              const debt = Math.abs(card.currentBalance);
              const startDebt = Math.abs(card.balanceAtMonthStart);
              const limit = 10000;
              const pct = Math.min((debt / limit) * 100, 100);
              const startPct = Math.min((startDebt / limit) * 100, 100);
              const delta = debt - startDebt;
              const barColor =
                pct > 80
                  ? 'linear-gradient(90deg, #b91c1c, #f07178)'
                  : pct > 50
                    ? 'linear-gradient(90deg, #c2410c, #e8a05a)'
                    : 'linear-gradient(90deg, #a16207, #e8c468)';

              return (
                <div key={card.id}>
                  <div className="flex items-start justify-between mb-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-ink truncate">{card.name}</p>
                      {card.institution && (
                        <p className="text-xs text-ink-muted truncate">{card.institution}</p>
                      )}
                    </div>
                    <div className="text-right pl-4 flex-shrink-0">
                      <p className="text-sm font-semibold text-danger money">
                        {formatCurrencyFull(debt)}
                      </p>
                      <p className="text-[10px] text-ink-muted">of $10,000</p>
                    </div>
                  </div>

                  <div className="relative pt-4">
                    {startPct > 0 && (
                      <div
                        className="absolute top-0 flex flex-col items-center"
                        style={{ left: `${startPct}%`, transform: 'translateX(-50%)' }}
                      >
                        <span className="text-[9px] text-ink-muted whitespace-nowrap leading-none mb-0.5">
                          {new Date().toLocaleDateString('en-US', { month: 'short' })} 1
                        </span>
                        <div className="w-px h-2 bg-ink-muted" />
                      </div>
                    )}

                    <div className="relative h-2.5 rounded-full bg-graphite-surface-2 overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{
                          delay: 0.4 + i * 0.12,
                          duration: 1,
                          ease: [0.25, 0.46, 0.45, 0.94],
                        }}
                        className="h-full rounded-full"
                        style={{ background: barColor }}
                      />
                    </div>

                    {startPct > 0 && (
                      <div
                        className="absolute top-4 bottom-0 w-0.5 rounded-full bg-white/40 z-10"
                        style={{ left: `${startPct}%`, transform: 'translateX(-50%)' }}
                      />
                    )}
                  </div>

                  <div className="flex items-center justify-between mt-2">
                    <span className="text-[10px] text-ink-muted money">{pct.toFixed(1)}% used</span>
                    {delta !== 0 && (
                      <span
                        className={`text-[10px] font-medium money ${
                          delta > 0 ? 'text-danger' : 'text-mint'
                        }`}
                      >
                        {delta > 0 ? '↑' : '↓'} {formatCurrencyFull(Math.abs(delta))} this month
                      </span>
                    )}
                    <span className="text-[10px] text-ink-muted money">
                      {formatCurrency(Math.max(limit - debt, 0))} avail.
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </motion.div>
      )}

      {data.loans.length > 0 && (
        <motion.div
          custom={3}
          initial="hidden"
          animate="visible"
          variants={fadeUp}
          className="panel shadow-panel p-5 sm:p-6"
        >
          <div className="flex items-start justify-between mb-5 gap-3">
            <div>
              <div className="flex items-center gap-2.5 mb-1">
                <div className="w-8 h-8 rounded-lg bg-warning-dim border border-warning/15 flex items-center justify-center">
                  <HandCoins size={15} className="text-warning" />
                </div>
                <h2 className="text-lg font-semibold text-ink font-display">Loans</h2>
              </div>
              <p className="text-xs text-ink-muted pl-[42px]">Outstanding loan balances</p>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-2xl sm:text-3xl font-semibold text-warning money">
                {formatCurrency(
                  data.loans.reduce((s, l) => s + Math.abs(Math.min(l.currentBalance, 0)), 0)
                )}
              </p>
              <p className="text-xs text-ink-muted mt-0.5">
                {data.loans.length} loan{data.loans.length !== 1 ? 's' : ''}
              </p>
            </div>
          </div>

          <div className="space-y-3">
            {data.loans.map((loan) => {
              const debt = Math.abs(Math.min(loan.currentBalance, 0));
              const startDebt = Math.abs(Math.min(loan.balanceAtMonthStart, 0));
              const delta = debt - startDebt;
              return (
                <div
                  key={loan.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-graphite-border-subtle bg-graphite-surface-2/40 px-3.5 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink truncate">{loan.name}</p>
                    {loan.institution && (
                      <p className="text-xs text-ink-muted truncate">{loan.institution}</p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold text-warning money">
                      {formatCurrencyFull(debt)}
                    </p>
                    {delta !== 0 && (
                      <p
                        className={`text-[10px] font-medium money ${
                          delta > 0 ? 'text-danger' : 'text-mint'
                        }`}
                      >
                        {delta > 0 ? '↑' : '↓'} {formatCurrencyFull(Math.abs(delta))} this month
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </motion.div>
      )}

      <motion.div
        custom={3}
        initial="hidden"
        animate="visible"
        variants={fadeUp}
        className="panel shadow-panel p-5 sm:p-6"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-2">
          <div>
            <h2 className="text-lg font-semibold text-ink font-display">Spending Over Time</h2>
            <p className="text-xs text-ink-muted mt-0.5">Daily expenses this month</p>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-ink-secondary">
            <div className="w-2 h-2 rounded-full bg-mint" />
            Spending
          </div>
        </div>
        <div className="h-[280px] sm:h-[320px]">
          {data.dailySpending.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={data.dailySpending}
                margin={{ top: 5, right: 5, left: -20, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="spendGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={MINT} stopOpacity={0.28} />
                    <stop offset="95%" stopColor={MINT} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={GRID} />
                <XAxis
                  dataKey="date"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: TICK, fontSize: 11 }}
                  interval="preserveStartEnd"
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: TICK, fontSize: 11 }}
                  tickFormatter={(v) => `$${v}`}
                />
                <RechartsTooltip content={<CustomTooltip />} />
                <Area
                  type="monotone"
                  dataKey="amount"
                  stroke={MINT}
                  strokeWidth={2}
                  fill="url(#spendGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-ink-muted text-sm">
              No spending data this month
            </div>
          )}
        </div>
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-5">
        <motion.div
          custom={4}
          initial="hidden"
          animate="visible"
          variants={fadeUp}
          className="lg:col-span-2 panel shadow-panel p-5 sm:p-6"
        >
          <div className="mb-5">
            <h2 className="text-lg font-semibold text-ink font-display">Recent Transactions</h2>
            <p className="text-xs text-ink-muted mt-0.5">Latest activity across accounts</p>
          </div>

          {data.recentTransactions.length > 0 ? (
            <div className="space-y-0.5">
              {data.recentTransactions.map((tx, i) => {
                const isIncome = tx.kind === 'INCOME';
                const IconComp = tx.category ? getCategoryIcon(tx.category.name) : DollarSign;
                return (
                  <motion.div
                    key={tx.id}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.25 + i * 0.04, duration: 0.3 }}
                    className="flex items-center gap-3 sm:gap-4 py-3 px-2 rounded-xl hover:bg-graphite-surface-2/60 transition-colors"
                  >
                    <div
                      className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{
                        backgroundColor: tx.category?.color
                          ? `${tx.category.color}18`
                          : isIncome
                            ? 'rgba(61, 206, 166, 0.12)'
                            : 'rgba(240, 113, 120, 0.12)',
                      }}
                    >
                      <IconComp
                        size={16}
                        style={{
                          color: tx.category?.color || (isIncome ? MINT : DANGER),
                        }}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-ink truncate">
                        {tx.category?.name || (isIncome ? 'Income' : 'Expense')}
                      </p>
                      <p className="text-xs text-ink-muted">
                        {formatDate(tx.date)}
                        {tx.account ? ` · ${tx.account.name}` : ''}
                      </p>
                    </div>
                    <p
                      className={`text-sm font-semibold money ${
                        isIncome ? 'text-mint' : 'text-ink-secondary'
                      }`}
                    >
                      {isIncome ? '+' : '-'}
                      {formatCurrencyFull(tx.amount)}
                    </p>
                  </motion.div>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-ink-muted">
              <DollarSign size={28} className="mb-2 opacity-40" />
              <p className="text-sm">No transactions yet</p>
            </div>
          )}
        </motion.div>

        <motion.div
          custom={5}
          initial="hidden"
          animate="visible"
          variants={fadeUp}
          className="panel shadow-panel p-5 sm:p-6"
        >
          <div className="flex items-start justify-between mb-5 gap-2">
            <div>
              <div className="flex items-center gap-2.5 mb-1">
                <div className="w-8 h-8 rounded-lg bg-info-dim border border-info/15 flex items-center justify-center">
                  <Users size={15} className="text-info" />
                </div>
                <h2 className="text-lg font-semibold text-ink font-display">Friends</h2>
              </div>
              <p className="text-xs text-ink-muted pl-[42px]">Shared expenses and IOUs</p>
            </div>
            <Link
              href="/friends"
              className="inline-flex items-center gap-1 text-xs text-mint hover:text-mint-bright transition-colors shrink-0 pt-1"
            >
              Open
              <ChevronRight size={14} />
            </Link>
          </div>

          <div className="grid grid-cols-2 gap-2.5 mb-4">
            <div className="rounded-xl border border-mint/20 bg-mint-dim/40 p-3">
              <p className="text-[10px] uppercase tracking-[0.12em] text-ink-muted mb-1">
                Owed to you
              </p>
              <p className="text-lg font-semibold text-mint money">
                {formatCurrency(data.friendsOwedToYou)}
              </p>
            </div>
            <div className="rounded-xl border border-danger/20 bg-danger-dim/40 p-3">
              <p className="text-[10px] uppercase tracking-[0.12em] text-ink-muted mb-1">
                You owe
              </p>
              <p className="text-lg font-semibold text-danger money">
                {formatCurrency(data.friendsYouOwe)}
              </p>
            </div>
          </div>

          {data.friends.length > 0 ? (
            <div className="space-y-2">
              {data.friends.slice(0, 5).map((friend) => {
                const settled = Math.abs(friend.balance) < 0.005;
                return (
                  <div
                    key={friend.id}
                    className="flex items-center gap-3 py-2 px-1 rounded-xl"
                  >
                    <div
                      className="w-9 h-9 rounded-xl flex items-center justify-center text-xs font-semibold text-ink border border-white/10 shrink-0"
                      style={{ backgroundColor: `${friend.color}28` }}
                    >
                      {friend.name
                        .split(/\s+/)
                        .filter(Boolean)
                        .slice(0, 2)
                        .map((p) => p[0]?.toUpperCase())
                        .join('') || '?'}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-ink truncate">{friend.name}</p>
                      <p className="text-[11px] text-ink-muted">
                        {settled
                          ? 'Settled up'
                          : friend.balance > 0
                          ? 'They owe you'
                          : 'You owe them'}
                      </p>
                    </div>
                    <p
                      className={`text-sm font-semibold money tabular-nums ${
                        settled
                          ? 'text-ink-muted'
                          : friend.balance > 0
                          ? 'text-mint'
                          : 'text-danger'
                      }`}
                    >
                      {settled
                        ? '$0'
                        : formatCurrency(Math.abs(friend.balance))}
                    </p>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-10 text-ink-muted">
              <Users size={26} className="mb-2 opacity-40" />
              <p className="text-sm mb-1">No friends yet</p>
              <p className="text-xs text-ink-muted/70 text-center px-4">
                Track shared spends and who owes whom
              </p>
              <Link
                href="/friends"
                className="mt-4 text-sm text-mint hover:text-mint-bright transition-colors"
              >
                Add a friend
              </Link>
            </div>
          )}
        </motion.div>
      </div>

      <motion.div
        custom={6}
        initial="hidden"
        animate="visible"
        variants={fadeUp}
        className="panel shadow-panel p-5 sm:p-6"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-2">
          <div>
            <h2 className="text-lg font-semibold text-ink font-display">Income vs Expenses</h2>
            <p className="text-xs text-ink-muted mt-0.5">12-month trend overview</p>
          </div>
          <div className="flex items-center gap-4 text-xs text-ink-secondary">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-mint" />
              Income
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-danger" />
              Expenses
            </div>
          </div>
        </div>
        <div className="h-[280px] sm:h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={data.monthlyTrend}
              margin={{ top: 5, right: 5, left: -20, bottom: 0 }}
            >
              <defs>
                <linearGradient id="incomeGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={MINT} stopOpacity={0.22} />
                  <stop offset="95%" stopColor={MINT} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="expenseGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={EXPENSE_LINE} stopOpacity={0.18} />
                  <stop offset="95%" stopColor={EXPENSE_LINE} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={GRID} />
              <XAxis
                dataKey="month"
                axisLine={false}
                tickLine={false}
                tick={{ fill: TICK, fontSize: 11 }}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fill: TICK, fontSize: 11 }}
                tickFormatter={(v) => `$${v}`}
              />
              <RechartsTooltip
                contentStyle={{
                  background: 'rgba(18, 21, 27, 0.92)',
                  border: '1px solid #262b36',
                  borderRadius: '12px',
                  backdropFilter: 'blur(12px)',
                  fontSize: '12px',
                }}
                labelStyle={{ color: '#9aa1ad' }}
                itemStyle={{ color: '#f0f2f5' }}
                formatter={(value: number) => formatCurrencyFull(value)}
              />
              <Area
                type="monotone"
                dataKey="income"
                stroke={MINT}
                strokeWidth={2}
                fill="url(#incomeGrad)"
              />
              <Area
                type="monotone"
                dataKey="expenses"
                stroke={EXPENSE_LINE}
                strokeWidth={2}
                fill="url(#expenseGrad)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </motion.div>
    </div>
  );
}
