'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import Select from '@/components/Select';
import { formatCurrency } from '@/lib/utils';
import type { CategoryTotal, InsightsData, InsightsRange } from './data';

const RANGE_OPTIONS: Array<{ value: InsightsRange; label: string }> = [
  { value: 'month', label: 'This month' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 3 months' },
  { value: 'year', label: 'This year' },
  { value: 'all', label: 'All time' },
];

const DANGER = '#f07178';
const GRID = '#262b36';
const TICK = '#858b96';

function transactionsHref(
  tab: 'expenses' | 'income',
  data: InsightsData,
  categoryId?: string
) {
  const params = new URLSearchParams();
  if (categoryId && categoryId !== 'uncategorized') params.set('category', categoryId);
  if (data.from) params.set('from', data.from);
  if (data.to) params.set('to', data.to);
  if (!data.from && !data.to) params.set('month', 'all');
  const qs = params.toString();
  return `/transactions/${tab}${qs ? `?${qs}` : ''}`;
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="panel shadow-panel px-5 py-4">
      <p className="text-xs uppercase tracking-[0.14em] text-ink-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-ink money tracking-tight">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-ink-muted">{sub}</p>}
    </div>
  );
}

/** Ranked bars: one hue, value labels in text ink, each row links to the filtered list. */
function RankedBreakdown({
  title,
  rows,
  barClass,
  hrefFor,
  allHref,
  emptyText,
}: {
  title: string;
  rows: CategoryTotal[];
  barClass: string;
  hrefFor: (row: CategoryTotal) => string;
  allHref: string;
  emptyText: string;
}) {
  const headingId = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-h`;
  const max = rows[0]?.amount || 1;
  const total = rows.reduce((s, r) => s + r.amount, 0) || 1;
  const shown = rows.slice(0, 8);
  const rest = rows.slice(8);
  const restTotal = rest.reduce((s, r) => s + r.amount, 0);

  return (
    <section className="panel shadow-panel p-5 sm:p-6" aria-labelledby={headingId}>
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 id={headingId} className="text-lg font-semibold text-ink font-display">
          {title}
        </h2>
        <Link
          href={allHref}
          className="inline-flex items-center gap-1 min-h-[44px] px-2 -mr-2 text-sm text-mint hover:text-mint-bright"
        >
          View list <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-ink-muted py-6 text-center">{emptyText}</p>
      ) : (
        <ul className="space-y-1">
          {shown.map((row) => {
            const pct = (row.amount / total) * 100;
            return (
              <li key={row.id}>
                <Link
                  href={hrefFor(row)}
                  className="block rounded-xl px-2 py-2 -mx-2 hover:bg-graphite-surface-2 transition-colors"
                  aria-label={`${row.name}: ${formatCurrency(row.amount)}, ${pct.toFixed(0)}% — view transactions`}
                >
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="text-ink truncate">
                      <span aria-hidden="true" className="mr-1.5">
                        {row.icon}
                      </span>
                      {row.name}
                    </span>
                    <span className="shrink-0 text-ink-secondary money tabular-nums">
                      {formatCurrency(row.amount)}
                      <span className="ml-2 text-xs text-ink-muted">{pct.toFixed(0)}%</span>
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 rounded-full bg-graphite-surface-2" aria-hidden="true">
                    <div
                      className={`h-full rounded-full ${barClass}`}
                      style={{ width: `${Math.max(2, (row.amount / max) * 100)}%` }}
                    />
                  </div>
                </Link>
              </li>
            );
          })}
          {rest.length > 0 && (
            <li className="flex justify-between text-sm text-ink-muted px-0 pt-2">
              <span>{rest.length} more</span>
              <span className="money tabular-nums">{formatCurrency(restTotal)}</span>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

function TrendTooltip({
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
    <div className="rounded-xl border border-graphite-border bg-graphite-elevated px-3 py-2 shadow-panel">
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="text-sm font-semibold text-ink money">{formatCurrency(payload[0].value)}</p>
    </div>
  );
}

export default function InsightsCharts({ data }: { data: InsightsData }) {
  const router = useRouter();
  const net = data.incomeTotal - data.expenseTotal;
  const peakDay = data.dailyExpenses.reduce(
    (best, d) => (d.amount > best.amount ? d : best),
    { date: '', amount: 0 }
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-xl font-semibold text-ink font-display">Spending & income</h2>
        <div className="w-full sm:w-52">
          <Select
            label="Period"
            value={data.range}
            options={RANGE_OPTIONS}
            onChange={(e) => router.push(`/insights?range=${e.target.value}`, { scroll: false })}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Stat
          label="Spent"
          value={formatCurrency(data.expenseTotal)}
          sub={`${data.expenseCount} expenses`}
        />
        <Stat
          label="Earned"
          value={formatCurrency(data.incomeTotal)}
          sub={`${data.incomeCount} income entries`}
        />
        <Stat
          label="Net"
          value={`${net < 0 ? '−' : ''}${formatCurrency(Math.abs(net))}`}
          sub={net >= 0 ? 'Saved' : 'Overspent'}
        />
        <Stat
          label="Avg / day"
          value={formatCurrency(data.expenseTotal / data.days)}
          sub={`over ${data.days} day${data.days === 1 ? '' : 's'}`}
        />
      </div>

      <section className="panel shadow-panel p-5 sm:p-6" aria-labelledby="daily-spend-h">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
          <h2 id="daily-spend-h" className="text-lg font-semibold text-ink font-display">
            Daily spending
          </h2>
          {peakDay.amount > 0 && (
            <p className="text-sm text-ink-muted">
              Peak {formatCurrency(peakDay.amount)} on {peakDay.date}
            </p>
          )}
        </div>
        {data.dailyExpenses.length === 0 ? (
          <p className="text-sm text-ink-muted py-10 text-center">No spending in this period.</p>
        ) : (
          <>
            <div className="h-64" aria-hidden="true">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.dailyExpenses} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="spendFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={DANGER} stopOpacity={0.25} />
                      <stop offset="100%" stopColor={DANGER} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: TICK, fontSize: 12 }}
                    stroke={GRID}
                    tickFormatter={(d: string) => d.slice(5)}
                    minTickGap={24}
                  />
                  <YAxis
                    tick={{ fill: TICK, fontSize: 12 }}
                    stroke={GRID}
                    width={56}
                    tickFormatter={(v: number) => `$${Math.round(v)}`}
                  />
                  <Tooltip content={<TrendTooltip />} cursor={{ stroke: TICK, strokeDasharray: '3 3' }} />
                  <Area
                    type="monotone"
                    dataKey="amount"
                    stroke={DANGER}
                    strokeWidth={2}
                    fill="url(#spendFill)"
                    activeDot={{ r: 4 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-ink-muted hover:text-ink min-h-[44px] flex items-center">
                Show as table
              </summary>
              <div className="max-h-64 overflow-y-auto mt-2">
                <table className="w-full text-left">
                  <caption className="sr-only">Daily spending</caption>
                  <thead>
                    <tr className="text-ink-muted">
                      <th scope="col" className="py-1 font-medium">Date</th>
                      <th scope="col" className="py-1 font-medium text-right">Spent</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.dailyExpenses
                      .filter((d) => d.amount > 0)
                      .map((d) => (
                        <tr key={d.date} className="border-t border-graphite-border-subtle">
                          <td className="py-1 text-ink-secondary">{d.date}</td>
                          <td className="py-1 text-right text-ink money tabular-nums">
                            {formatCurrency(d.amount)}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        )}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
        <RankedBreakdown
          title="Spending by category"
          rows={data.expenseByCategory}
          barClass="bg-danger"
          hrefFor={(row) => transactionsHref('expenses', data, row.id)}
          allHref={transactionsHref('expenses', data)}
          emptyText="No expenses in this period."
        />
        <RankedBreakdown
          title="Income by source"
          rows={data.incomeBySource}
          barClass="bg-mint"
          hrefFor={(row) => transactionsHref('income', data, row.id)}
          allHref={transactionsHref('income', data)}
          emptyText="No income in this period."
        />
      </div>
    </div>
  );
}
