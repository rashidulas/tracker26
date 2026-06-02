'use client';

import { motion } from 'framer-motion';
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
import { format } from 'date-fns';
import { formatDate } from '@/lib/utils';

interface BudgetItem {
  id: string;
  categoryName: string;
  categoryColor: string;
  budgeted: number;
  spent: number;
}

interface DashboardClientProps {
  data: {
    monthIncome: number;
    monthExpenses: number;
    totalDebt: number;
    totalSavings: number;
    totalBalance: number;
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
    budgetProgress: BudgetItem[];
    dailySpending: Array<{ date: string; amount: number }>;
  };
}

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] as [number, number, number, number] },
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
          <Line
            type="monotone"
            dataKey="y"
            stroke={color}
            strokeWidth={1.5}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="glass rounded-xl px-3 py-2 text-xs shadow-2xl">
      <p className="text-zinc-400 mb-1">{label}</p>
      <p className="text-emerald-400 font-semibold">{formatCurrencyFull(payload[0].value)}</p>
    </div>
  );
}

export default function DashboardClient({ data }: DashboardClientProps) {
  const netIncome = data.monthIncome - data.monthExpenses;
  const incomeChange = data.monthlyTrend.length >= 2
    ? ((data.monthlyTrend[data.monthlyTrend.length - 1].income - data.monthlyTrend[data.monthlyTrend.length - 2].income) /
        (data.monthlyTrend[data.monthlyTrend.length - 2].income || 1)) * 100
    : 0;
  const expenseChange = data.monthlyTrend.length >= 2
    ? ((data.monthlyTrend[data.monthlyTrend.length - 1].expenses - data.monthlyTrend[data.monthlyTrend.length - 2].expenses) /
        (data.monthlyTrend[data.monthlyTrend.length - 2].expenses || 1)) * 100
    : 0;

  const sparkIncome = data.monthlyTrend.slice(-7).map((d) => d.income);
  const sparkExpense = data.monthlyTrend.slice(-7).map((d) => d.expenses);
  const sparkBalance = data.monthlyTrend.slice(-7).map((d) => d.income - d.expenses);

  const summaryCards = [
    {
      title: 'Total Balance',
      value: formatCurrency(data.totalBalance),
      change: netIncome >= 0 ? '+' + formatCurrency(netIncome) + ' this month' : formatCurrency(netIncome) + ' this month',
      changePositive: netIncome >= 0,
      icon: Wallet,
      sparkData: sparkBalance,
      sparkColor: '#10b981',
    },
    {
      title: 'Monthly Income',
      value: formatCurrency(data.monthIncome),
      change: `${incomeChange >= 0 ? '+' : ''}${incomeChange.toFixed(1)}% vs last month`,
      changePositive: incomeChange >= 0,
      icon: TrendingUp,
      sparkData: sparkIncome,
      sparkColor: '#10b981',
    },
    {
      title: 'Monthly Expenses',
      value: formatCurrency(data.monthExpenses),
      change: `${expenseChange >= 0 ? '+' : ''}${expenseChange.toFixed(1)}% vs last month`,
      changePositive: expenseChange <= 0,
      icon: TrendingDown,
      sparkData: sparkExpense,
      sparkColor: '#ef4444',
    },
  ];

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 lg:space-y-8 min-h-screen">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">Dashboard</h1>
        <p className="text-sm text-zinc-500 mt-1">Welcome to your financial overview</p>
      </motion.div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-6">
        {summaryCards.map((card, i) => {
          const Icon = card.icon;
          return (
            <motion.div
              key={card.title}
              custom={i}
              initial="hidden"
              animate="visible"
              variants={fadeUp}
              className="group relative overflow-hidden rounded-2xl border border-zinc-800/60 bg-zinc-900/50 backdrop-blur-xl p-5 sm:p-6 hover:border-zinc-700/60 transition-all duration-300"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent pointer-events-none" />
              <div className="relative flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                      <Icon size={16} className="text-emerald-400" />
                    </div>
                    <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">{card.title}</p>
                  </div>
                  <p className="text-2xl sm:text-3xl font-bold text-white tracking-tight">{card.value}</p>
                  <div className="flex items-center gap-1.5 mt-2">
                    {card.changePositive ? (
                      <ArrowUpRight size={14} className="text-emerald-400" />
                    ) : (
                      <ArrowDownRight size={14} className="text-red-400" />
                    )}
                    <span className={`text-xs font-medium ${card.changePositive ? 'text-emerald-400' : 'text-red-400'}`}>
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

      {/* Main Chart — Spending Over Time */}
      <motion.div
        custom={3}
        initial="hidden"
        animate="visible"
        variants={fadeUp}
        className="rounded-2xl border border-zinc-800/60 bg-zinc-900/50 backdrop-blur-xl p-5 sm:p-6"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-2">
          <div>
            <h2 className="text-lg font-semibold text-white">Spending Over Time</h2>
            <p className="text-xs text-zinc-500 mt-0.5">Daily expenses this month</p>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
              <span className="text-zinc-400">Spending</span>
            </div>
          </div>
        </div>
        <div className="h-[280px] sm:h-[320px]">
          {data.dailySpending.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.dailySpending} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="spendGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke="#27272a"
                />
                <XAxis
                  dataKey="date"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#71717a', fontSize: 11 }}
                  interval="preserveStartEnd"
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#71717a', fontSize: 11 }}
                  tickFormatter={(v) => `$${v}`}
                />
                <RechartsTooltip content={<CustomTooltip />} />
                <Area
                  type="monotone"
                  dataKey="amount"
                  stroke="#10b981"
                  strokeWidth={2}
                  fill="url(#spendGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-zinc-600">
              No spending data this month
            </div>
          )}
        </div>
      </motion.div>

      {/* Transactions + Budget Progress Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6">
        {/* Recent Transactions */}
        <motion.div
          custom={4}
          initial="hidden"
          animate="visible"
          variants={fadeUp}
          className="lg:col-span-2 rounded-2xl border border-zinc-800/60 bg-zinc-900/50 backdrop-blur-xl p-5 sm:p-6"
        >
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-lg font-semibold text-white">Recent Transactions</h2>
              <p className="text-xs text-zinc-500 mt-0.5">Latest activity across accounts</p>
            </div>
          </div>

          {data.recentTransactions.length > 0 ? (
            <div className="space-y-1">
              {data.recentTransactions.map((tx, i) => {
                const isIncome = tx.kind === 'INCOME';
                const IconComp = tx.category ? getCategoryIcon(tx.category.name) : DollarSign;
                return (
                  <motion.div
                    key={tx.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.3 + i * 0.04, duration: 0.3 }}
                    className="flex items-center gap-3 sm:gap-4 py-3 px-2 rounded-xl hover:bg-zinc-800/30 transition-colors group cursor-default"
                  >
                    <div
                      className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-transform group-hover:scale-105"
                      style={{
                        backgroundColor: tx.category?.color
                          ? `${tx.category.color}15`
                          : isIncome
                            ? 'rgba(16, 185, 129, 0.1)'
                            : 'rgba(239, 68, 68, 0.1)',
                      }}
                    >
                      <IconComp
                        size={16}
                        style={{
                          color: tx.category?.color || (isIncome ? '#10b981' : '#ef4444'),
                        }}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-zinc-200 truncate">
                        {tx.category?.name || (isIncome ? 'Income' : 'Expense')}
                      </p>
                      <p className="text-xs text-zinc-500">
                        {formatDate(tx.date)}
                        {tx.account ? ` · ${tx.account.name}` : ''}
                      </p>
                    </div>
                    <p className={`text-sm font-semibold tabular-nums ${isIncome ? 'text-emerald-400' : 'text-zinc-300'}`}>
                      {isIncome ? '+' : '-'}{formatCurrencyFull(tx.amount)}
                    </p>
                  </motion.div>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-zinc-600">
              <DollarSign size={32} className="mb-2 text-zinc-700" />
              <p className="text-sm">No transactions yet</p>
            </div>
          )}
        </motion.div>

        {/* Budget Progress */}
        <motion.div
          custom={5}
          initial="hidden"
          animate="visible"
          variants={fadeUp}
          className="rounded-2xl border border-zinc-800/60 bg-zinc-900/50 backdrop-blur-xl p-5 sm:p-6"
        >
          <div className="mb-5">
            <h2 className="text-lg font-semibold text-white">Budget Progress</h2>
            <p className="text-xs text-zinc-500 mt-0.5">This month&apos;s spending limits</p>
          </div>

          {data.budgetProgress.length > 0 ? (
            <div className="space-y-5">
              {data.budgetProgress.map((budget) => {
                const pct = budget.budgeted > 0 ? Math.min((budget.spent / budget.budgeted) * 100, 100) : 0;
                const isOver = budget.spent > budget.budgeted;
                return (
                  <div key={budget.id}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-zinc-300">{budget.categoryName}</span>
                      <span className="text-xs text-zinc-500">
                        {formatCurrency(budget.spent)} / {formatCurrency(budget.budgeted)}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-zinc-800 overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{ delay: 0.5, duration: 0.8, ease: 'easeOut' }}
                        className="h-full rounded-full transition-colors"
                        style={{
                          backgroundColor: isOver ? '#ef4444' : budget.categoryColor || '#10b981',
                        }}
                      />
                    </div>
                    {isOver && (
                      <p className="text-[10px] text-red-400 mt-1">
                        Over by {formatCurrency(budget.spent - budget.budgeted)}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-zinc-600">
              <Zap size={28} className="mb-2 text-zinc-700" />
              <p className="text-sm mb-1">No budgets set</p>
              <p className="text-xs text-zinc-700">Create budgets to track spending limits</p>
            </div>
          )}

          {/* Quick Stats */}
          <div className="mt-6 pt-5 border-t border-zinc-800/60 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-zinc-500">Total Debt</span>
              <span className="text-sm font-semibold text-red-400">{formatCurrency(data.totalDebt)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-zinc-500">Savings Goals</span>
              <span className="text-sm font-semibold text-emerald-400">{formatCurrency(data.totalSavings)}</span>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Income vs Expenses (12 months) */}
      <motion.div
        custom={6}
        initial="hidden"
        animate="visible"
        variants={fadeUp}
        className="rounded-2xl border border-zinc-800/60 bg-zinc-900/50 backdrop-blur-xl p-5 sm:p-6"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-2">
          <div>
            <h2 className="text-lg font-semibold text-white">Income vs Expenses</h2>
            <p className="text-xs text-zinc-500 mt-0.5">12-month trend overview</p>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
              <span className="text-zinc-400">Income</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-indigo-500" />
              <span className="text-zinc-400">Expenses</span>
            </div>
          </div>
        </div>
        <div className="h-[280px] sm:h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data.monthlyTrend} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="incomeGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="expenseGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6366f1" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#27272a" />
              <XAxis
                dataKey="month"
                axisLine={false}
                tickLine={false}
                tick={{ fill: '#71717a', fontSize: 11 }}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fill: '#71717a', fontSize: 11 }}
                tickFormatter={(v) => `$${v}`}
              />
              <RechartsTooltip
                contentStyle={{
                  background: 'rgba(24,24,27,0.9)',
                  border: '1px solid rgba(63,63,70,0.4)',
                  borderRadius: '12px',
                  backdropFilter: 'blur(12px)',
                  fontSize: '12px',
                }}
                labelStyle={{ color: '#a1a1aa' }}
                itemStyle={{ color: '#fafafa' }}
                formatter={(value: number) => formatCurrencyFull(value)}
              />
              <Area type="monotone" dataKey="income" stroke="#10b981" strokeWidth={2} fill="url(#incomeGrad)" />
              <Area type="monotone" dataKey="expenses" stroke="#6366f1" strokeWidth={2} fill="url(#expenseGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </motion.div>
    </div>
  );
}
