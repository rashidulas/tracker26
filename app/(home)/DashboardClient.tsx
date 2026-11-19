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
  ArrowLeftRight,
  CalendarClock,
  Target,
} from 'lucide-react';
import { useState } from 'react';
import UpcomingList from '@/components/recurring/UpcomingList';
import type { UpcomingItem } from '@/lib/recurring';
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
import { formatCurrency, formatDate } from '@/lib/utils';
import { formatDay, todayInAppTimeZone } from '@/lib/dates';
import type { BudgetOverview } from '@/lib/budgetData';
import BudgetPanel from './BudgetPanel';
import { AskButton } from '@/components/assistant/AskAssistant';

interface LiabilityItem {
  id: string;
  name: string;
  institution: string | null;
  currentBalance: number;
  balanceAtMonthStart: number;
  creditLimit?: number | null;
}

interface FriendSummary {
  id: string;
  name: string;
  color: string;
  balance: number;
  entryCount: number;
}

interface GoalSummary {
  id: string;
  name: string;
  targetAmount: number;
  saved: number;
  transferred: number;
  earmarked: number;
  progress: number;
  dueDate: Date | null;
  accountName: string | null;
}

interface DashboardClientProps {
  data: {
    monthIncome: number;
    monthExpenses: number;
    totalBalance: number;
    cashBalance: number;
    /** Goal contributions set aside inside accounts (not transferred). */
    earmarkedForGoals: number;
    goals: GoalSummary[];
    creditCards: LiabilityItem[];
    loans: LiabilityItem[];
    friends: FriendSummary[];
    friendsOwedToYou: number;
    friendsYouOwe: number;
    categoryData: Array<{ name: string; value: number; color: string }>;
    monthlyTrend: Array<{
      month: string;
      income: number;
      expenses: number;
      recurring: number;
      everyday: number;
    }>;
    recentTransactions: Array<{
      id: string;
      date: Date;
      amount: number;
      kind: string;
      merchantOrSource?: string | null;
      category: { name: string; icon: string | null; color: string } | null;
      account: { name: string } | null;
      toAccount?: { name: string } | null;
    }>;
    dailySpending: Array<{ date: string; amount: number; recurring: number; everyday: number }>;
    upcoming: UpcomingItem[];
    suggestionCount: number;
    budget: BudgetOverview | null;
  };
}

const MINT = '#3dcea6';
const DANGER = '#f07178';
const GRID = '#262b36';
const TICK = '#858b96';
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
      <p className="text-mint font-semibold money">{formatCurrency(payload[0].value)}</p>
    </div>
  );
}

const RECURRING_COLOR = '#bb9af7';

type SpendingView = 'all' | 'everyday' | 'recurring';

const SPENDING_VIEWS: { value: SpendingView; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'everyday', label: 'Everyday' },
  { value: 'recurring', label: 'Recurring' },
];

/** Switch charts between all spending, everyday spending and recurring bills. */
function SpendingViewToggle({
  value,
  onChange,
  label,
}: {
  value: SpendingView;
  onChange: (v: SpendingView) => void;
  label: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex p-0.5 rounded-lg bg-graphite-surface-2/90 border border-graphite-border-subtle"
    >
      {SPENDING_VIEWS.map((v) => (
        <button
          key={v.value}
          type="button"
          aria-pressed={value === v.value}
          onClick={() => onChange(v.value)}
          className={`px-2.5 py-1 rounded-md text-xs transition-colors ${
            value === v.value ? 'bg-mint-dim text-mint font-medium' : 'text-ink-secondary hover:text-ink'
          }`}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}

function SplitTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number; dataKey: string; color?: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const names: Record<string, string> = { amount: 'Total', everyday: 'Everyday', recurring: 'Recurring' };
  return (
    <div className="glass rounded-xl px-3 py-2 text-xs shadow-panel space-y-0.5">
      <p className="text-ink-muted mb-1">{label}</p>
      {payload.map((p) => (
        <p key={p.dataKey} className="money font-semibold" style={{ color: p.color }}>
          {payload.length > 1 ? `${names[p.dataKey] ?? p.dataKey} ` : ''}
          {formatCurrency(p.value)}
        </p>
      ))}
    </div>
  );
}

export default function DashboardClient({ data }: DashboardClientProps) {
  const [dailyView, setDailyView] = useState<SpendingView>('all');
  const [trendView, setTrendView] = useState<SpendingView>('all');
  const hasRecurring =
    data.dailySpending.some((d) => d.recurring > 0) ||
    data.monthlyTrend.some((m) => m.recurring > 0);
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
      value: formatCurrency(data.totalBalance, { decimals: 0 }),
      change:
        netIncome >= 0
          ? '+' + formatCurrency(netIncome, { decimals: 0 }) + ' this month'
          : formatCurrency(netIncome, { decimals: 0 }) + ' this month',
      changePositive: netIncome >= 0,
      icon: Wallet,
      sparkData: sparkBalance,
      sparkColor: MINT,
    },
    {
      title: 'Monthly Income',
      value: formatCurrency(data.monthIncome, { decimals: 0 }),
      change: `${incomeChange >= 0 ? '+' : ''}${incomeChange.toFixed(1)}% vs last month`,
      changePositive: incomeChange >= 0,
      icon: TrendingUp,
      sparkData: sparkIncome,
      sparkColor: MINT,
    },
    {
      title: 'Monthly Expenses',
      value: formatCurrency(data.monthExpenses, { decimals: 0 }),
      change: `${expenseChange >= 0 ? '+' : ''}${expenseChange.toFixed(1)}% vs last month`,
      changePositive: expenseChange <= 0,
      icon: TrendingDown,
      sparkData: sparkExpense,
      sparkColor: DANGER,
    },
  ];

  return (
    <div className="space-y-6 lg:space-y-8">
      {data.budget && <BudgetPanel budget={data.budget} />}

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
                    <AskButton
                      label={card.title}
                      className="-my-1.5"
                      context={{ page: 'dashboard', item: { type: 'card', label: card.title } }}
                    />
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
        <div className="text-right">
          <p
            className={`text-xl font-semibold money ${
              data.cashBalance >= 0 ? 'text-mint' : 'text-danger'
            }`}
          >
            {formatCurrency(data.cashBalance, { decimals: 0 })}
          </p>
          {data.earmarkedForGoals > 0 && (
            <p className="text-[11px] text-ink-muted money">
              {formatCurrency(data.cashBalance - data.earmarkedForGoals, { decimals: 0 })} available
              · {formatCurrency(data.earmarkedForGoals, { decimals: 0 })} for goals
            </p>
          )}
        </div>
      </motion.div>

      {(data.upcoming.length > 0 || data.suggestionCount > 0) && (
        <motion.section
          custom={3}
          initial="hidden"
          animate="visible"
          variants={fadeUp}
          className="panel shadow-panel p-5 sm:p-6"
          aria-labelledby="dashboard-upcoming"
        >
          <div className="flex items-start justify-between gap-2 mb-2">
            <div>
              <div className="flex items-center gap-2.5 mb-1">
                <div className="w-8 h-8 rounded-lg bg-info-dim border border-info/15 flex items-center justify-center">
                  <CalendarClock size={15} className="text-info" aria-hidden="true" />
                </div>
                <h2 id="dashboard-upcoming" className="text-lg font-semibold text-ink font-display">
                  Upcoming
                </h2>
              </div>
              <p className="text-xs text-ink-muted pl-[42px]">Recurring entries due in the next 14 days</p>
            </div>
            <Link
              href="/plan/recurring"
              className="inline-flex items-center gap-1 text-xs text-mint hover:text-mint-bright transition-colors shrink-0 pt-1"
            >
              Manage
              <ChevronRight size={14} />
            </Link>
          </div>
          <UpcomingList items={data.upcoming} limit={6} />
          {data.upcoming.length > 6 && (
            <p className="text-xs text-ink-muted mt-2">
              +{data.upcoming.length - 6} more on the{' '}
              <Link href="/plan/recurring" className="text-mint hover:text-mint-bright">
                Recurring page
              </Link>
            </p>
          )}
          {data.suggestionCount > 0 && (
            <Link
              href="/plan/recurring#suggestions-heading"
              className="mt-3 flex items-center justify-between gap-2 rounded-xl border border-info/20 bg-info-dim/40 px-3.5 py-2.5 text-sm text-info hover:border-info/40 transition-colors"
            >
              <span>
                {data.suggestionCount} charge{data.suggestionCount === 1 ? '' : 's'} in your history{' '}
                {data.suggestionCount === 1 ? 'looks' : 'look'} recurring
              </span>
              <span className="inline-flex items-center gap-0.5 text-xs shrink-0">
                Review <ChevronRight size={14} />
              </span>
            </Link>
          )}
        </motion.section>
      )}

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
                  data.creditCards.reduce((s, c) => s + Math.abs(c.currentBalance), 0),
                  { decimals: 0 }
                )}
              </p>
              <p className="text-xs text-ink-muted mt-0.5">
                {data.creditCards.length} card{data.creditCards.length !== 1 ? 's' : ''}
                {(() => {
                  const limited = data.creditCards.filter((c) => (c.creditLimit ?? 0) > 0);
                  if (limited.length === 0) return null;
                  const totalLimit = limited.reduce((s, c) => s + (c.creditLimit ?? 0), 0);
                  const totalDebt = limited.reduce((s, c) => s + Math.abs(c.currentBalance), 0);
                  return ` · ${((totalDebt / totalLimit) * 100).toFixed(0)}% of ${formatCurrency(totalLimit, { decimals: 0 })}`;
                })()}
              </p>
            </div>
          </div>

          <div className="space-y-6">
            {data.creditCards.map((card, i) => {
              const debt = Math.abs(card.currentBalance);
              const startDebt = Math.abs(card.balanceAtMonthStart);
              const limit = card.creditLimit && card.creditLimit > 0 ? card.creditLimit : null;
              const utilisation = limit ? (debt / limit) * 100 : 0;
              const pct = Math.min(utilisation, 100);
              const startPct = limit ? Math.min((startDebt / limit) * 100, 100) : 0;
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
                        {formatCurrency(debt)}
                      </p>
                      <p className="text-[10px] text-ink-muted">
                        {limit ? (
                          <>of {formatCurrency(limit, { decimals: 0 })}</>
                        ) : (
                          <Link href="/accounts" className="underline decoration-dotted hover:text-ink">
                            No limit set
                          </Link>
                        )}
                      </p>
                    </div>
                  </div>

                  {limit && (
                  <div className="relative pt-4">
                    {startPct > 0 && (
                      <div
                        className="absolute top-0 flex flex-col items-center"
                        style={{ left: `${startPct}%`, transform: 'translateX(-50%)' }}
                      >
                        <span className="text-[9px] text-ink-muted whitespace-nowrap leading-none mb-0.5">
                          {formatDay(todayInAppTimeZone(), { month: 'short' })} 1
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
                  )}

                  <div className="flex items-center justify-between gap-2 mt-2">
                    <span
                      className={`text-[10px] money ${utilisation > 100 ? 'text-danger font-medium' : 'text-ink-muted'}`}
                    >
                      {limit ? `${utilisation.toFixed(1)}% used` : 'Utilisation unknown'}
                    </span>
                    {delta !== 0 && (
                      <span
                        className={`text-[10px] font-medium money ${
                          delta > 0 ? 'text-danger' : 'text-mint'
                        }`}
                      >
                        {delta > 0 ? '↑' : '↓'} {formatCurrency(Math.abs(delta))} this month
                      </span>
                    )}
                    {limit && (
                      <span className="text-[10px] text-ink-muted money">
                        {formatCurrency(Math.max(limit - debt, 0), { decimals: 0 })} avail.
                      </span>
                    )}
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
                      {formatCurrency(debt)}
                    </p>
                    {delta !== 0 && (
                      <p
                        className={`text-[10px] font-medium money ${
                          delta > 0 ? 'text-danger' : 'text-mint'
                        }`}
                      >
                        {delta > 0 ? '↑' : '↓'} {formatCurrency(Math.abs(delta))} this month
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
            <p className="text-xs text-ink-muted mt-0.5">
              Daily expenses this month
              {hasRecurring && dailyView === 'all' ? ' · recurring part in purple' : ''}
            </p>
          </div>
          {hasRecurring ? (
            <SpendingViewToggle
              value={dailyView}
              onChange={setDailyView}
              label="Daily spending: show all, everyday or recurring"
            />
          ) : (
            <div className="flex items-center gap-1.5 text-xs text-ink-secondary">
              <div className="w-2 h-2 rounded-full bg-mint" />
              Spending
            </div>
          )}
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
                  <linearGradient id="recurringGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={RECURRING_COLOR} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={RECURRING_COLOR} stopOpacity={0.02} />
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
                <RechartsTooltip content={hasRecurring ? <SplitTooltip /> : <CustomTooltip />} />
                {/* "All": the total in mint, with the recurring part drawn from
                    zero in purple, so the gap between them is everyday spending. */}
                {dailyView !== 'recurring' ? (
                  <Area
                    type="monotone"
                    dataKey={dailyView === 'everyday' ? 'everyday' : 'amount'}
                    stroke={MINT}
                    strokeWidth={2}
                    fill="url(#spendGradient)"
                  />
                ) : null}
                {hasRecurring && dailyView !== 'everyday' ? (
                  <Area
                    type="monotone"
                    dataKey="recurring"
                    stroke={RECURRING_COLOR}
                    strokeWidth={2}
                    fill="url(#recurringGradient)"
                  />
                ) : null}
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
                const isTransfer = tx.kind === 'TRANSFER';
                const IconComp = isTransfer
                  ? ArrowLeftRight
                  : tx.category
                    ? getCategoryIcon(tx.category.name)
                    : DollarSign;
                const title = isTransfer
                  ? tx.merchantOrSource || 'Transfer'
                  : tx.merchantOrSource ||
                    tx.category?.name ||
                    (isIncome ? 'Income' : 'Expense');
                const accountLabel = isTransfer
                  ? `${tx.account?.name || '—'} → ${tx.toAccount?.name || '—'}`
                  : tx.account?.name;
                const subtitleParts = [
                  formatDate(tx.date),
                  !isTransfer && tx.merchantOrSource ? tx.category?.name : null,
                  accountLabel,
                ].filter(Boolean);
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
                        backgroundColor: isTransfer
                          ? 'rgba(122, 162, 247, 0.12)'
                          : tx.category?.color
                          ? `${tx.category.color}18`
                          : isIncome
                            ? 'rgba(61, 206, 166, 0.12)'
                            : 'rgba(240, 113, 120, 0.12)',
                      }}
                    >
                      <IconComp
                        size={16}
                        style={{
                          color: isTransfer
                            ? 'var(--info)'
                            : tx.category?.color || (isIncome ? MINT : DANGER),
                        }}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-ink truncate">
                        {title}
                      </p>
                      <p className="text-xs text-ink-muted truncate">
                        {subtitleParts.join(' · ')}
                      </p>
                    </div>
                    <p
                      className={`text-sm font-semibold money shrink-0 ${
                        isIncome ? 'text-mint' : isTransfer ? 'text-info' : 'text-ink-secondary'
                      }`}
                    >
                      {isIncome ? '+' : isTransfer ? '' : '−'}
                      {formatCurrency(tx.amount)}
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
                {formatCurrency(data.friendsOwedToYou, { decimals: 0 })}
              </p>
            </div>
            <div className="rounded-xl border border-danger/20 bg-danger-dim/40 p-3">
              <p className="text-[10px] uppercase tracking-[0.12em] text-ink-muted mb-1">
                You owe
              </p>
              <p className="text-lg font-semibold text-danger money">
                {formatCurrency(data.friendsYouOwe, { decimals: 0 })}
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
                        : formatCurrency(Math.abs(friend.balance), { decimals: 0 })}
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
        aria-labelledby="dashboard-goals-heading"
      >
        <div className="flex items-start justify-between mb-5 gap-2">
          <div>
            <div className="flex items-center gap-2.5 mb-1">
              <div className="w-8 h-8 rounded-lg bg-mint-dim border border-mint/15 flex items-center justify-center">
                <Target size={15} className="text-mint" aria-hidden="true" />
              </div>
              <h2 id="dashboard-goals-heading" className="text-lg font-semibold text-ink font-display">
                Goals
              </h2>
            </div>
            <p className="text-xs text-ink-muted pl-[42px]">Savings progress</p>
          </div>
          <Link
            href="/plan/goals"
            className="inline-flex items-center gap-1 text-xs text-mint hover:text-mint-bright transition-colors shrink-0 pt-1"
          >
            Open
            <ChevronRight size={14} aria-hidden="true" />
          </Link>
        </div>

        {data.goals.length > 0 ? (
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
            {data.goals.slice(0, 6).map((goal) => (
              <li key={goal.id} className="min-w-0">
                <div className="flex items-baseline justify-between gap-3 mb-1.5">
                  <p className="text-sm font-medium text-ink truncate">{goal.name}</p>
                  <p className="text-xs text-ink-muted money shrink-0">
                    <span className="text-ink">{formatCurrency(goal.saved, { decimals: 0 })}</span>
                    {' / '}
                    {formatCurrency(goal.targetAmount, { decimals: 0 })}
                  </p>
                </div>
                <div
                  className="h-2 w-full rounded-full bg-graphite-surface-2 border border-graphite-border-subtle overflow-hidden"
                  role="progressbar"
                  aria-label={`${goal.name} progress`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(goal.progress)}
                >
                  <div
                    className="h-full rounded-full bg-mint"
                    style={{ width: `${goal.progress}%` }}
                  />
                </div>
                <p className="text-[11px] text-ink-muted mt-1 truncate">
                  {Math.round(goal.progress)}%
                  {goal.accountName
                    ? ` · in ${goal.accountName}`
                    : goal.earmarked > 0
                    ? ' · earmarked'
                    : ''}
                  {goal.dueDate && ` · due ${formatDate(goal.dueDate)}`}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex flex-col items-center justify-center py-8 text-ink-muted">
            <Target size={26} className="mb-2 opacity-40" aria-hidden="true" />
            <p className="text-sm mb-1">No goals yet</p>
            <Link
              href="/plan/goals"
              className="mt-3 text-sm text-mint hover:text-mint-bright transition-colors"
            >
              Add a goal
            </Link>
          </div>
        )}
      </motion.div>

      <motion.div
        custom={7}
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
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-ink-secondary">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-mint" />
              Income
            </div>
            <div className="flex items-center gap-1.5">
              <div
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: trendView === 'recurring' ? RECURRING_COLOR : EXPENSE_LINE }}
              />
              {trendView === 'all' ? 'Expenses' : trendView === 'everyday' ? 'Everyday expenses' : 'Recurring expenses'}
            </div>
            {hasRecurring && (
              <SpendingViewToggle
                value={trendView}
                onChange={setTrendView}
                label="Expenses trend: show all, everyday or recurring"
              />
            )}
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
                formatter={(value: number) => formatCurrency(value)}
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
                dataKey={trendView === 'all' ? 'expenses' : trendView}
                name={trendView === 'all' ? 'Expenses' : trendView === 'everyday' ? 'Everyday' : 'Recurring'}
                stroke={trendView === 'recurring' ? RECURRING_COLOR : EXPENSE_LINE}
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
