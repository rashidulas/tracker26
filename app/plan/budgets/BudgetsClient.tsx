'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, Copy, PiggyBank, Repeat } from 'lucide-react';
import Button from '@/components/Button';
import { useToast } from '@/components/ToastProvider';
import { formatCurrency } from '@/lib/utils';
import { formatDay } from '@/lib/dates';
import type { BudgetMonthData, BudgetRow } from '@/lib/budgetData';
import type { BudgetStatus, MonthPacing } from '@/lib/budgets';
import { copyPreviousMonth, setBudget, setBudgetRollover } from './actions';

function shiftMonth(key: string, delta: number) {
  const [y, m] = key.split('-').map(Number);
  const total = y * 12 + (m - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

function monthLabel(key: string) {
  return formatDay(`${key}-01`, { month: 'long', year: 'numeric' });
}

function monthBounds(key: string) {
  const [y, m] = key.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${key}-01`, to: `${key}-${String(last).padStart(2, '0')}` };
}

const STATUS_BAR: Record<BudgetStatus, string> = {
  over: 'bg-danger',
  near: 'bg-warning',
  ahead: 'bg-warning/70',
  ok: 'bg-mint',
};
const STATUS_TEXT: Record<BudgetStatus, string> = {
  over: 'text-danger',
  near: 'text-warning',
  ahead: 'text-warning',
  ok: 'text-ink-muted',
};

function PaceBar({
  used,
  status,
  pacing,
  label,
}: {
  used: number;
  status: BudgetStatus;
  pacing: MonthPacing;
  label: string;
}) {
  const pct = Math.round(used * 100);
  const pacePct = Math.round(pacing.fraction * 100);
  return (
    <div className="relative">
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, pct)}
        aria-valuetext={`${pct}% spent, ${pacePct}% of the month gone`}
        className="h-2 rounded-full bg-graphite-surface-2 overflow-hidden"
      >
        <div
          className={`h-full rounded-full ${STATUS_BAR[status]}`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
      {pacing.isCurrent && (
        <span
          aria-hidden="true"
          title={`${pacePct}% of the month gone`}
          className="absolute -top-1 h-4 w-0.5 rounded bg-ink/70"
          style={{ left: `calc(${pacePct}% - 1px)` }}
        />
      )}
    </div>
  );
}

function BudgetLine({
  row,
  month,
  pacing,
}: {
  row: BudgetRow;
  month: string;
  pacing: MonthPacing;
}) {
  const router = useRouter();
  const toast = useToast();
  const budget = row.budget;
  const [value, setValue] = useState(budget?.amount.toString() ?? '');
  const [saving, setSaving] = useState(false);
  const lastSaved = useRef<number | null>(budget?.amount ?? null);
  const inputId = `budget-${row.categoryId}`;
  const { from, to } = monthBounds(month);

  async function save() {
    const trimmed = value.trim();
    const next = trimmed === '' ? null : Number(trimmed);
    if (next !== null && (!Number.isFinite(next) || next < 0)) {
      toast.error('Enter a positive amount, or leave blank for no budget');
      return;
    }
    const normalized = next && next > 0 ? next : null;
    if (normalized === lastSaved.current) return;
    lastSaved.current = normalized;
    setSaving(true);
    const result = await setBudget({ month, categoryId: row.categoryId, amount: normalized });
    setSaving(false);
    if (result.success) {
      toast.success(
        normalized ? `${row.name} budget set to ${formatCurrency(normalized)}` : `${row.name} budget removed`
      );
      router.refresh();
    } else {
      lastSaved.current = budget?.amount ?? null;
      toast.error(result.error);
    }
  }

  async function toggleRollover(enabled: boolean) {
    setSaving(true);
    const result = await setBudgetRollover(month, row.categoryId, enabled);
    setSaving(false);
    if (result.success) {
      toast.success(enabled ? `${row.name}: leftover rolls into next month` : `${row.name}: rollover off`);
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  const pct = budget ? Math.round(budget.used * 100) : 0;
  const pacePct = Math.round(pacing.fraction * 100);

  return (
    <li className="panel shadow-panel p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <span
            className="w-10 h-10 rounded-xl bg-graphite-surface-2 border border-graphite-border-subtle flex items-center justify-center text-lg shrink-0"
            aria-hidden="true"
          >
            {row.icon || '🏷️'}
          </span>
          <div className="min-w-0">
            <label htmlFor={inputId} className="block text-sm font-medium text-ink truncate">
              {row.name}
            </label>
            <Link
              href={`/transactions/expenses?category=${row.categoryId}&from=${from}&to=${to}`}
              className="text-xs text-ink-muted hover:text-mint underline-offset-2 hover:underline"
            >
              {formatCurrency(row.spent)} spent
            </Link>
          </div>
        </div>
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="relative w-32">
            <span
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted text-sm"
              aria-hidden="true"
            >
              $
            </span>
            <input
              id={inputId}
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              placeholder="No budget"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onBlur={() => void save()}
              disabled={saving}
              aria-describedby={`${inputId}-status`}
              className="w-full min-h-[44px] pl-7 pr-3 border border-graphite-border rounded-xl text-sm text-ink bg-[var(--surface-2)] placeholder-ink-muted focus:ring-2 focus:ring-mint/30 focus:border-mint/50 focus:outline-none [color-scheme:dark] money tabular-nums"
            />
          </div>
        </form>
      </div>

      {budget ? (
        <div className="mt-3 space-y-1.5">
          <PaceBar used={budget.used} status={budget.status} pacing={pacing} label={`${row.name} budget used`} />
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <p id={`${inputId}-status`} className={`text-xs ${STATUS_TEXT[budget.status]}`}>
              {budget.remaining < 0
                ? `Over by ${formatCurrency(-budget.remaining)}`
                : `${formatCurrency(budget.remaining)} left`}
              {' · '}
              {pct}% spent
              {pacing.isCurrent && `, ${pacePct}% of month gone`}
              {budget.carryIn !== 0 && (
                <span className="text-ink-muted">
                  {' · '}
                  {formatCurrency(budget.amount)} {budget.carryIn > 0 ? '+' : '−'}{' '}
                  {formatCurrency(Math.abs(budget.carryIn))} carried from last month
                </span>
              )}
            </p>
            <label className="inline-flex items-center gap-2 text-xs text-ink-secondary cursor-pointer min-h-[32px]">
              <input
                type="checkbox"
                checked={budget.rolloverEnabled}
                disabled={saving}
                onChange={(e) => void toggleRollover(e.target.checked)}
                className="accent-[var(--mint,#3dcea6)] w-4 h-4"
              />
              <Repeat size={13} aria-hidden="true" />
              Roll over to next month
            </label>
          </div>
        </div>
      ) : (
        <p id={`${inputId}-status`} className="sr-only">
          No budget set
        </p>
      )}
    </li>
  );
}

export default function BudgetsClient({ data }: { data: BudgetMonthData }) {
  const router = useRouter();
  const toast = useToast();
  const [copying, setCopying] = useState(false);
  const { totals, pacing } = data;

  const budgetedCount = data.rows.filter((r) => r.budget).length;
  const usedPct = totals.available > 0 ? Math.round((totals.spentInBudgets / totals.available) * 100) : 0;
  const pacePct = Math.round(pacing.fraction * 100);

  async function copyLast() {
    setCopying(true);
    const result = await copyPreviousMonth(data.month);
    setCopying(false);
    if (result.success) {
      toast.success(`Copied ${result.copied} budget${result.copied === 1 ? '' : 's'} from last month`);
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Link
            href={`/plan/budgets?month=${shiftMonth(data.month, -1)}`}
            className="w-11 h-11 inline-flex items-center justify-center rounded-xl text-ink-secondary hover:text-ink hover:bg-graphite-surface-2"
            aria-label={`Previous month, ${monthLabel(shiftMonth(data.month, -1))}`}
          >
            <ChevronLeft size={18} aria-hidden="true" />
          </Link>
          <h2 className="text-lg font-semibold text-ink font-display min-w-[10rem] text-center" aria-live="polite">
            {monthLabel(data.month)}
          </h2>
          <Link
            href={`/plan/budgets?month=${shiftMonth(data.month, 1)}`}
            className="w-11 h-11 inline-flex items-center justify-center rounded-xl text-ink-secondary hover:text-ink hover:bg-graphite-surface-2"
            aria-label={`Next month, ${monthLabel(shiftMonth(data.month, 1))}`}
          >
            <ChevronRight size={18} aria-hidden="true" />
          </Link>
        </div>
        {data.copyableFromPrevious > 0 && (
          <Button variant="secondary" onClick={() => void copyLast()} disabled={copying}>
            <Copy size={16} aria-hidden="true" />
            {copying ? 'Copying…' : `Copy last month's budgets (${data.copyableFromPrevious})`}
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        <div className="panel shadow-panel px-5 py-4">
          <p className="text-xs uppercase tracking-[0.14em] text-ink-muted">Available</p>
          <p className="mt-1 text-2xl font-semibold text-ink money">{formatCurrency(totals.available)}</p>
          <p className="text-xs text-ink-muted mt-0.5">
            {formatCurrency(totals.budgeted)} budgeted across {budgetedCount} categor
            {budgetedCount === 1 ? 'y' : 'ies'}
            {totals.available !== totals.budgeted && ' + rollover'}
          </p>
        </div>
        <div className="panel shadow-panel px-5 py-4">
          <p className="text-xs uppercase tracking-[0.14em] text-ink-muted">Spent in budgets</p>
          <p className="mt-1 text-2xl font-semibold text-ink money">{formatCurrency(totals.spentInBudgets)}</p>
          <p className={`text-xs mt-0.5 ${totals.overCount ? 'text-danger' : 'text-ink-muted'}`}>
            {usedPct}% spent{pacing.isCurrent && `, ${pacePct}% of the month gone`}
            {totals.overCount > 0 && ` · ${totals.overCount} over`}
          </p>
        </div>
        <div className="panel shadow-panel px-5 py-4">
          <p className="text-xs uppercase tracking-[0.14em] text-ink-muted">Total spent</p>
          <p className="mt-1 text-2xl font-semibold text-ink money">{formatCurrency(totals.totalSpent)}</p>
          <p className="text-xs text-ink-muted mt-0.5">all categories · card and debt payments excluded</p>
        </div>
      </div>

      {data.rows.length === 0 ? (
        <div className="panel border-dashed border-graphite-border py-14 px-6 text-center">
          <PiggyBank className="mx-auto text-ink-muted mb-3" size={28} aria-hidden="true" />
          <p className="text-ink font-medium">No expense categories yet</p>
          <p className="text-sm text-ink-muted mt-1">
            <Link href="/settings/categories" className="text-mint hover:underline">
              Add a category
            </Link>{' '}
            to start budgeting.
          </p>
        </div>
      ) : (
        <section aria-labelledby="categories-h">
          <h3 id="categories-h" className="text-sm font-medium text-ink-secondary mb-1">
            Expense categories
          </h3>
          <p className="text-xs text-ink-muted mb-3">
            Type a monthly limit and press Enter (or tab away) to save. Clear it to remove the budget.
            {pacing.isCurrent && ' The tick on each bar marks how far through the month we are.'}
          </p>
          <ul className="space-y-2">
            {data.rows.map((row) => (
              <BudgetLine key={row.categoryId} row={row} month={data.month} pacing={pacing} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
