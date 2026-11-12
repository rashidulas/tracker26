'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { ChevronLeft, ChevronRight, Copy, PiggyBank } from 'lucide-react';
import Button from '@/components/Button';
import { useToast } from '@/components/ToastProvider';
import { formatCurrency } from '@/lib/utils';
import { copyPreviousMonth, setBudget } from './actions';

interface BudgetRow {
  categoryId: string;
  name: string;
  icon: string | null;
  budgetId: string | null;
  limit: number | null;
  spent: number;
}

interface BudgetsClientProps {
  data: {
    month: string;
    rows: BudgetRow[];
    uncategorizedSpent: number;
    hasPreviousBudgets: boolean;
  };
}

function shiftMonth(key: string, delta: number) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(key: string) {
  const [y, m] = key.split('-').map(Number);
  return format(new Date(y, m - 1, 1), 'MMMM yyyy');
}

function monthRange(key: string) {
  const [y, m] = key.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${key}-01`, to: `${key}-${String(last).padStart(2, '0')}` };
}

function BudgetLine({ row, month }: { row: BudgetRow; month: string }) {
  const router = useRouter();
  const toast = useToast();
  const [value, setValue] = useState(row.limit?.toString() ?? '');
  const [saving, setSaving] = useState(false);
  const lastSaved = useRef<number | null>(row.limit);
  const inputId = `budget-${row.categoryId}`;

  const limit = row.limit ?? 0;
  const pct = limit > 0 ? (row.spent / limit) * 100 : 0;
  const over = limit > 0 && row.spent > limit;
  const near = !over && pct >= 85;
  const { from, to } = monthRange(month);

  async function save() {
    const trimmed = value.trim();
    const next = trimmed === '' ? null : parseFloat(trimmed);
    if (next !== null && (!Number.isFinite(next) || next < 0)) {
      toast.error('Enter a positive amount, or leave blank for no budget');
      return;
    }
    const normalized = next && next > 0 ? next : null;
    if (normalized === lastSaved.current) return;
    lastSaved.current = normalized;
    setSaving(true);
    const result = await setBudget(month, row.categoryId, next);
    setSaving(false);
    if (result.success) {
      toast.success(next ? `${row.name} budget set to ${formatCurrency(next)}` : `${row.name} budget removed`);
      router.refresh();
    } else {
      lastSaved.current = row.limit;
      toast.error(result.error);
    }
  }

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
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted text-sm" aria-hidden="true">
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

      {limit > 0 && (
        <div className="mt-3">
          <div
            role="progressbar"
            aria-label={`${row.name} budget used`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.min(100, Math.round(pct))}
            className="h-2 rounded-full bg-graphite-surface-2 overflow-hidden"
          >
            <div
              className={`h-full rounded-full ${over ? 'bg-danger' : near ? 'bg-warning' : 'bg-mint'}`}
              style={{ width: `${Math.min(100, pct)}%` }}
            />
          </div>
          <p
            id={`${inputId}-status`}
            className={`mt-1.5 text-xs ${over ? 'text-danger' : near ? 'text-warning' : 'text-ink-muted'}`}
          >
            {over
              ? `Over by ${formatCurrency(row.spent - limit)} (${pct.toFixed(0)}% used)`
              : `${formatCurrency(limit - row.spent)} left · ${pct.toFixed(0)}% used`}
          </p>
        </div>
      )}
      {limit <= 0 && (
        <p id={`${inputId}-status`} className="sr-only">
          No budget set
        </p>
      )}
    </li>
  );
}

export default function BudgetsClient({ data }: BudgetsClientProps) {
  const router = useRouter();
  const toast = useToast();
  const [copying, setCopying] = useState(false);

  const budgeted = data.rows.filter((r) => r.limit);
  const totalLimit = budgeted.reduce((s, r) => s + (r.limit ?? 0), 0);
  const totalBudgetedSpent = budgeted.reduce((s, r) => s + r.spent, 0);
  const totalSpent =
    data.rows.reduce((s, r) => s + r.spent, 0) + data.uncategorizedSpent;
  const overCount = budgeted.filter((r) => r.spent > (r.limit ?? 0)).length;

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
        {data.hasPreviousBudgets && (
          <Button variant="secondary" onClick={() => void copyLast()} disabled={copying}>
            <Copy size={16} aria-hidden="true" />
            {copying ? 'Copying…' : 'Copy last month'}
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        <div className="panel shadow-panel px-5 py-4">
          <p className="text-xs uppercase tracking-[0.14em] text-ink-muted">Budgeted</p>
          <p className="mt-1 text-2xl font-semibold text-ink money">{formatCurrency(totalLimit)}</p>
          <p className="text-xs text-ink-muted mt-0.5">
            across {budgeted.length} categor{budgeted.length === 1 ? 'y' : 'ies'}
          </p>
        </div>
        <div className="panel shadow-panel px-5 py-4">
          <p className="text-xs uppercase tracking-[0.14em] text-ink-muted">Spent in budgets</p>
          <p className="mt-1 text-2xl font-semibold text-ink money">{formatCurrency(totalBudgetedSpent)}</p>
          <p className={`text-xs mt-0.5 ${overCount ? 'text-danger' : 'text-ink-muted'}`}>
            {overCount ? `${overCount} over budget` : 'All within budget'}
          </p>
        </div>
        <div className="panel shadow-panel px-5 py-4">
          <p className="text-xs uppercase tracking-[0.14em] text-ink-muted">Total spent</p>
          <p className="mt-1 text-2xl font-semibold text-ink money">{formatCurrency(totalSpent)}</p>
          <p className="text-xs text-ink-muted mt-0.5">including unbudgeted categories</p>
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
          </p>
          <ul className="space-y-2">
            {data.rows.map((row) => (
              <BudgetLine key={row.categoryId} row={row} month={data.month} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
