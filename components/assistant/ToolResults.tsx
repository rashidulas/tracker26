'use client';

/**
 * What a read tool returned, shown inside the assistant's message: a chart
 * for a breakdown or a trend, a compact table for a comparison or a list of
 * balances, and tappable rows for transactions.
 *
 * Every figure shown comes straight from the tool result
 * (lib/assistant/read.ts). Nothing is added up here; the only arithmetic is
 * the width of a bar.
 */
import { memo } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { AssistantUIMessage } from '@/lib/assistant/engine';
import { describeRange } from '@/lib/assistant/toolLabels';
import { formatDay, isValidDay, type DayString } from '@/lib/dates';
import { formatCompactNumber, formatCurrency } from '@/lib/utils';

type Part = AssistantUIMessage['parts'][number];
type Done<T extends Part['type']> = Extract<Part, { type: T; state: 'output-available' }>;

// Chart colours are the design tokens from app/globals.css.
const COLOR = {
  expense: 'var(--danger)',
  income: 'var(--mint)',
  grid: 'var(--border-subtle)',
  tick: 'var(--text-muted)',
  label: 'var(--text-secondary)',
  cursor: 'var(--surface-2)',
};

const MAX_ROWS = 6;

function Card({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <figure className="my-3 rounded-2xl border border-graphite-border-subtle bg-graphite-elevated/70 p-3.5 sm:p-4">
      <figcaption className="mb-2.5 flex items-baseline justify-between gap-3">
        <span className="text-xs font-medium uppercase tracking-[0.12em] text-ink-muted">{title}</span>
        {note && <span className="money shrink-0 text-sm text-ink">{note}</span>}
      </figcaption>
      {children}
    </figure>
  );
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const shortDay = (day: string) => (isValidDay(day) ? formatDay(day, { month: 'short', day: 'numeric' }) : day);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: { full: string; amount: number; count?: number } }[];
}) {
  const row = active ? payload?.[0]?.payload : undefined;
  if (!row) return null;
  return (
    <div className="rounded-xl border border-graphite-border bg-graphite-surface-2 px-3 py-2 text-xs shadow-panel">
      <p className="text-ink-secondary">{row.full}</p>
      <p className="money mt-0.5 text-sm text-ink">{formatCurrency(row.amount)}</p>
      {row.count !== undefined && (
        <p className="mt-0.5 text-ink-muted">
          {row.count} {row.count === 1 ? 'transaction' : 'transactions'}
        </p>
      )}
    </div>
  );
}

// ==================== SUMMARY: BREAKDOWN OR TREND ====================

function Summary({ part, today }: { part: Done<'tool-summarizeTransactions'>; today: DayString }) {
  const out = part.output;
  if (out.groups.length < 2) return null;
  const color = out.kind === 'INCOME' ? COLOR.income : COLOR.expense;
  const what = out.kind === 'INCOME' ? 'Income' : 'Spending';
  const range = describeRange(out.start, out.end, today);
  const total = formatCurrency(out.total);

  if (out.groupBy === 'day' || out.groupBy === 'week' || out.groupBy === 'month') {
    const data = out.groups.map((g) => {
      const key = g.name.replace(/^week of /, '');
      return {
        full:
          out.groupBy === 'month'
            ? formatDay(`${key}-01`, { month: 'long', year: 'numeric' })
            : out.groupBy === 'week'
              ? `Week of ${shortDay(key)}`
              : formatDay(key, { weekday: 'short', month: 'short', day: 'numeric' }),
        label: out.groupBy === 'month' ? formatDay(`${key}-01`, { month: 'short' }) : shortDay(key),
        amount: g.amount,
        count: g.count,
      };
    });
    return (
      <Card title={`${what} by ${out.groupBy}${range ? ` · ${range}` : ''}`} note={total}>
        <div className="h-44 w-full" role="img" aria-label={`${what} by ${out.groupBy}, ${total} in total`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={COLOR.grid} vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: COLOR.tick, fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                minTickGap={16}
                interval="preserveStartEnd"
              />
              <YAxis
                width={52}
                tick={{ fill: COLOR.tick, fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) =>
                  v >= 10_000 ? `$${formatCompactNumber(v)}` : formatCurrency(v, { decimals: 0 })
                }
              />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: COLOR.cursor }} />
              <Bar dataKey="amount" fill={color} radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    );
  }

  const rows = out.groups.slice(0, 8).map((g) => ({
    full: g.name,
    label: clip(g.name, 16),
    amount: g.amount,
    count: g.count,
    other: false,
  }));
  const hidden = out.groups.slice(8);
  const rest = out.otherGroups;
  return (
    <Card title={`${what} by ${out.groupBy}${range ? ` · ${range}` : ''}`} note={total}>
      <div
        style={{ height: rows.length * 34 + 8 }}
        className="w-full"
        role="img"
        aria-label={`${what} by ${out.groupBy}: ${rows.map((r) => `${r.full} ${formatCurrency(r.amount)}`).join(', ')}`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 76, bottom: 0, left: 0 }} barCategoryGap={8}>
            <XAxis type="number" hide domain={[0, 'dataMax']} />
            <YAxis
              type="category"
              dataKey="label"
              width={112}
              tick={{ fill: COLOR.label, fontSize: 12 }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: COLOR.cursor }} />
            <Bar dataKey="amount" radius={[0, 4, 4, 0]} maxBarSize={18} isAnimationActive={false}>
              {rows.map((row) => (
                <Cell key={row.full} fill={color} />
              ))}
              <LabelList
                dataKey="amount"
                position="right"
                formatter={(v: number) => formatCurrency(v)}
                style={{ fill: COLOR.label, fontSize: 12, fontFamily: 'var(--font-mono)' }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {(hidden.length > 0 || rest) && (
        <p className="mt-1.5 text-xs text-ink-muted">
          {[
            hidden.length > 0 ? `${hidden.length} more not charted` : null,
            rest ? `${rest.groups} smaller ${rest.groups === 1 ? 'group' : 'groups'}: ${formatCurrency(rest.amount)}` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      )}
    </Card>
  );
}

// ==================== COMPARISON ====================

function Compare({ part }: { part: Done<'tool-comparePeriods'> }) {
  const out = part.output;
  const moreIsGood = out.kind === 'INCOME';
  const tone = (change: number) =>
    change === 0 ? 'text-ink-muted' : change > 0 === moreIsGood ? 'text-mint' : 'text-danger';
  const signed = (change: number) => formatCurrency(change, { signDisplay: 'exceptZero' });
  const groups = 'groups' in out && out.groups ? out.groups.slice(0, MAX_ROWS) : [];
  const hidden = ('groups' in out && out.groups ? out.groups.length : 0) - groups.length + (('moreGroups' in out && out.moreGroups) || 0);

  return (
    <Card title={`${out.kind === 'INCOME' ? 'Income' : 'Spending'} · ${out.periodA.label} vs ${out.periodB.label}`}>
      <div className="-mx-1 overflow-x-auto mobile-table-scroll">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-muted">
              <th scope="col" className="px-1 pb-1.5 font-medium">
                <span className="sr-only">Group</span>
              </th>
              <th scope="col" className="px-1 pb-1.5 text-right font-medium">{clip(out.periodA.label, 14)}</th>
              <th scope="col" className="px-1 pb-1.5 text-right font-medium">{clip(out.periodB.label, 14)}</th>
              <th scope="col" className="px-1 pb-1.5 text-right font-medium">Change</th>
            </tr>
          </thead>
          <tbody className="money">
            <tr className="border-t border-graphite-border-subtle">
              <th scope="row" className="px-1 py-1.5 text-left font-sans font-medium tracking-normal text-ink">Total</th>
              <td className="px-1 py-1.5 text-right text-ink">{formatCurrency(out.periodA.total)}</td>
              <td className="px-1 py-1.5 text-right text-ink">{formatCurrency(out.periodB.total)}</td>
              <td className={`px-1 py-1.5 text-right ${tone(out.change)}`}>{signed(out.change)}</td>
            </tr>
            {groups.map((g) => (
              <tr key={g.name} className="border-t border-graphite-border-subtle">
                <th scope="row" className="max-w-[9rem] truncate px-1 py-1.5 text-left font-sans font-normal tracking-normal text-ink-secondary">
                  {g.name}
                </th>
                <td className="px-1 py-1.5 text-right text-ink-secondary">{formatCurrency(g.periodA)}</td>
                <td className="px-1 py-1.5 text-right text-ink-secondary">{formatCurrency(g.periodB)}</td>
                <td className={`px-1 py-1.5 text-right ${tone(g.change)}`}>{signed(g.change)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hidden > 0 && <p className="mt-1.5 text-xs text-ink-muted">{hidden} more not shown</p>}
    </Card>
  );
}

// ==================== TRANSACTIONS ====================

const LIST_PAGE = { EXPENSE: 'expenses', INCOME: 'income', TRANSFER: 'transfers' } as const;

/** The list page that shows this transaction: its day on Expenses / Income, its month on Transfers. */
function transactionHref(t: { kind: keyof typeof LIST_PAGE; date: string }) {
  return t.kind === 'TRANSFER'
    ? `/transactions/transfers?month=${t.date.slice(0, 7)}`
    : `/transactions/${LIST_PAGE[t.kind]}?from=${t.date}&to=${t.date}`;
}

function Transactions({ part }: { part: Done<'tool-searchTransactions'> }) {
  const out = part.output;
  if (out.transactions.length === 0) return null;
  const rows = out.transactions.slice(0, MAX_ROWS);
  const more = out.matchCount - rows.length;
  return (
    <Card title={`${out.matchCount} ${out.matchCount === 1 ? 'transaction' : 'transactions'}`}>
      <ul className="-mx-2 divide-y divide-graphite-border-subtle">
        {rows.map((t) => {
          const title = t.merchant ?? (t.kind === 'TRANSFER' ? `Transfer to ${t.toAccount ?? 'account'}` : t.category) ?? 'Transaction';
          const detail = [shortDay(t.date), t.merchant ? t.category : null, t.account].filter(Boolean).join(' · ');
          return (
            <li key={t.id}>
              <Link
                href={transactionHref(t)}
                className="flex min-h-[52px] items-center justify-between gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-graphite-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint/40"
                aria-label={`${title}, ${formatCurrency(t.amount)}, ${detail}. Open in ${capitalise(LIST_PAGE[t.kind])}`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm text-ink">{title}</span>
                  <span className="block truncate text-xs text-ink-muted">{detail}</span>
                </span>
                <span className={`money shrink-0 text-sm ${t.kind === 'INCOME' ? 'text-mint' : 'text-ink'}`}>
                  {t.kind === 'INCOME' ? '+' : ''}
                  {formatCurrency(t.amount)}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {more > 0 && <p className="mt-1.5 text-xs text-ink-muted">and {more} more</p>}
    </Card>
  );
}

// ==================== BARS: BUDGETS AND GOALS ====================

function Meter({ fraction, tone }: { fraction: number; tone: string }) {
  return (
    <div className="mt-1.5 h-1.5 rounded-full bg-graphite-surface-2" aria-hidden="true">
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.min(100, Math.max(2, fraction * 100))}%` }} />
    </div>
  );
}

const BUDGET_TONE: Record<string, string> = {
  over: 'bg-danger',
  near: 'bg-warning',
  ahead: 'bg-warning',
  ok: 'bg-mint',
};

function Budgets({ part }: { part: Done<'tool-budgetStatus'> }) {
  const out = part.output;
  if (out.budgets.length === 0) return null;
  const rows = out.budgets.slice(0, MAX_ROWS);
  return (
    <Card
      title={`Budgets · ${formatDay(`${out.month}-01`, { month: 'long', year: 'numeric' })}`}
      note={`${formatCurrency(out.totals.remaining)} left`}
    >
      <ul className="space-y-2.5">
        {rows.map((b) => (
          <li key={b.categoryId}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate text-ink">{b.category}</span>
              <span className="money shrink-0 text-ink-secondary">
                {formatCurrency(b.spent)} <span className="text-ink-muted">of {formatCurrency(b.available)}</span>
              </span>
            </div>
            <Meter fraction={b.usedPct === null ? 1 : b.usedPct / 100} tone={BUDGET_TONE[b.status] ?? 'bg-mint'} />
          </li>
        ))}
      </ul>
      <div className="mt-2.5 flex items-center justify-between gap-3">
        <p className="text-xs text-ink-muted">
          {out.budgets.length > rows.length ? `${out.budgets.length - rows.length} more · ` : ''}
          {out.pacing.monthElapsedPct}% of the month gone
        </p>
        <Link
          href={`/plan/budgets?month=${out.month}`}
          className="inline-flex min-h-[36px] items-center gap-1 text-sm text-mint hover:text-mint-bright"
        >
          Budgets <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </div>
    </Card>
  );
}

function Goals({ part }: { part: Done<'tool-goalProgress'> }) {
  const goals = part.output.goals;
  if (goals.length === 0) return null;
  return (
    <Card title="Savings goals">
      <ul className="space-y-2.5">
        {goals.slice(0, MAX_ROWS).map((g) => (
          <li key={g.id}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate text-ink">{g.name}</span>
              <span className="money shrink-0 text-ink-secondary">
                {formatCurrency(g.saved)} <span className="text-ink-muted">of {formatCurrency(g.target)}</span>
              </span>
            </div>
            <Meter fraction={g.progressPct / 100} tone="bg-mint" />
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ==================== SIMPLE LISTS ====================

function Rows({ rows }: { rows: { key: string; name: string; detail?: string | null; value: string; tone?: string }[] }) {
  return (
    <ul className="divide-y divide-graphite-border-subtle">
      {rows.map((row) => (
        <li key={row.key} className="flex items-center justify-between gap-3 py-1.5 text-sm">
          <span className="min-w-0">
            <span className="block truncate text-ink">{row.name}</span>
            {row.detail && <span className="block truncate text-xs text-ink-muted">{row.detail}</span>}
          </span>
          <span className={`money shrink-0 ${row.tone ?? 'text-ink'}`}>{row.value}</span>
        </li>
      ))}
    </ul>
  );
}

const ACCOUNT_TYPE: Record<string, string> = {
  CHECKING: 'Checking',
  SAVINGS: 'Savings',
  CREDIT_CARD: 'Credit card',
  CASH: 'Cash',
  INVESTMENT: 'Investment',
  LOAN: 'Loan',
};

function Accounts({ part }: { part: Done<'tool-accountBalances'> }) {
  const out = part.output;
  if (out.accounts.length === 0) return null;
  return (
    <Card title="Accounts" note={`${formatCurrency(out.totals.netBalance)} net`}>
      <Rows
        rows={out.accounts.map((a) => ({
          key: a.id,
          name: a.name,
          detail: [
            ACCOUNT_TYPE[a.type] ?? a.type,
            a.utilizationPct !== null && a.utilizationPct !== undefined ? `${a.utilizationPct}% used` : null,
          ]
            .filter(Boolean)
            .join(' · '),
          value: formatCurrency(a.balance),
          tone: a.balance < 0 ? 'text-danger' : 'text-ink',
        }))}
      />
    </Card>
  );
}

function Friends({ part }: { part: Done<'tool-friendBalances'> }) {
  const friends = part.output.friends.filter((f) => f.balance !== 0);
  if (friends.length === 0) return null;
  return (
    <Card title="Friends">
      <Rows
        rows={friends.slice(0, MAX_ROWS).map((f) => ({
          key: f.id,
          name: f.name ?? 'Friend',
          detail: f.balance > 0 ? 'owes you' : 'you owe',
          value: formatCurrency(Math.abs(f.balance)),
          tone: f.balance > 0 ? 'text-mint' : 'text-danger',
        }))}
      />
    </Card>
  );
}

function Upcoming({ part }: { part: Done<'tool-upcomingRecurring'> }) {
  const items = part.output.scheduled;
  if (items.length === 0) return null;
  return (
    <Card title={`Coming up · to ${shortDay(part.output.to)}`}>
      <Rows
        rows={items.slice(0, MAX_ROWS).map((item, index) => ({
          key: `${item.name}-${item.dueDate}-${index}`,
          name: item.name ?? 'Recurring entry',
          detail: [shortDay(item.dueDate), item.status === 'overdue' ? 'overdue' : null, item.account]
            .filter(Boolean)
            .join(' · '),
          value: `${item.kind === 'INCOME' ? '+' : ''}${formatCurrency(item.amount)}`,
          tone: item.kind === 'INCOME' ? 'text-mint' : item.status === 'overdue' ? 'text-danger' : 'text-ink',
        }))}
      />
      {items.length > MAX_ROWS && <p className="mt-1.5 text-xs text-ink-muted">and {items.length - MAX_ROWS} more</p>}
    </Card>
  );
}

// ==================== DISPATCH ====================

function ToolResult({ part, today }: { part: Part; today: DayString }) {
  if (!('state' in part) || part.state !== 'output-available') return null;
  switch (part.type) {
    case 'tool-summarizeTransactions':
      return <Summary part={part} today={today} />;
    case 'tool-comparePeriods':
      return <Compare part={part} />;
    case 'tool-searchTransactions':
      return <Transactions part={part} />;
    case 'tool-budgetStatus':
      return <Budgets part={part} />;
    case 'tool-goalProgress':
      return <Goals part={part} />;
    case 'tool-accountBalances':
      return <Accounts part={part} />;
    case 'tool-friendBalances':
      return <Friends part={part} />;
    case 'tool-upcomingRecurring':
      return <Upcoming part={part} />;
    default:
      return null;
  }
}

export default memo(ToolResult);
