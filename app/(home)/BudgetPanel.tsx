import Link from 'next/link';
import { PiggyBank, ChevronRight } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import type { BudgetOverview } from '@/lib/budgetData';
import type { BudgetStatus } from '@/lib/budgets';

const BAR: Record<BudgetStatus, string> = {
  over: 'bg-danger',
  near: 'bg-warning',
  ahead: 'bg-warning/70',
  ok: 'bg-mint',
};

/** "Safe to spend today" plus the three budgets closest to their limit. */
export default function BudgetPanel({ budget }: { budget: BudgetOverview }) {
  if (!budget.hasBudgets) {
    return (
      <div className="panel shadow-panel px-5 py-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-mint-dim border border-mint/15 flex items-center justify-center">
            <PiggyBank size={15} className="text-mint" aria-hidden="true" />
          </div>
          <p className="text-sm text-ink-secondary">
            Set monthly budgets to see what is safe to spend each day.
          </p>
        </div>
        <Link href="/plan/budgets" className="text-sm text-mint hover:underline">
          Set budgets
        </Link>
      </div>
    );
  }

  const pacePct = Math.round(budget.pacing.fraction * 100);
  const overToday = budget.leftToday < 0;

  return (
    <section
      aria-labelledby="budget-panel-h"
      className="panel shadow-panel p-5 sm:p-6 grid grid-cols-1 lg:grid-cols-2 gap-6"
    >
      <div>
        <h2
          id="budget-panel-h"
          className="text-[11px] font-medium text-ink-muted uppercase tracking-[0.14em] mb-2"
        >
          Safe to spend today
        </h2>
        <p className="text-3xl sm:text-4xl font-semibold text-ink tracking-tight money">
          {formatCurrency(budget.safeToSpendToday)}
        </p>
        <p className="text-xs text-ink-muted mt-1">
          {formatCurrency(Math.max(0, budget.remainingThisMonth))} left in budgets ÷ {budget.daysLeft} day
          {budget.daysLeft === 1 ? '' : 's'} to go (today included)
        </p>
        <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
          <div>
            <dt className="text-xs text-ink-muted">Spent today</dt>
            <dd className="font-medium text-ink money">{formatCurrency(budget.spentToday)}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-muted">This week</dt>
            <dd className="font-medium text-ink money">{formatCurrency(budget.spentThisWeek)}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-muted">{overToday ? 'Over today' : 'Left today'}</dt>
            <dd className={`font-medium money ${overToday ? 'text-danger' : 'text-mint'}`}>
              {formatCurrency(Math.abs(budget.leftToday))}
            </dd>
          </div>
        </dl>
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[11px] font-medium text-ink-muted uppercase tracking-[0.14em]">
            Closest to limit · {pacePct}% of month gone
          </h3>
          <Link
            href="/plan/budgets"
            className="inline-flex items-center gap-0.5 text-xs text-ink-secondary hover:text-mint"
          >
            All budgets <ChevronRight size={14} aria-hidden="true" />
          </Link>
        </div>
        <ul className="space-y-3">
          {budget.watchlist.map((b) => {
            const pct = Math.round(b.used * 100);
            return (
              <li key={b.categoryId}>
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="text-ink truncate">
                    <span aria-hidden="true">{b.icon || '🏷️'} </span>
                    {b.name}
                  </span>
                  <span className={`text-xs money ${b.remaining < 0 ? 'text-danger' : 'text-ink-muted'}`}>
                    {b.remaining < 0
                      ? `${formatCurrency(-b.remaining)} over`
                      : `${formatCurrency(b.remaining)} left`}
                  </span>
                </div>
                <div className="relative mt-1.5">
                  <div
                    role="progressbar"
                    aria-label={`${b.name} budget used`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.min(100, pct)}
                    aria-valuetext={`${pct}% spent of ${formatCurrency(b.available)}`}
                    className="h-1.5 rounded-full bg-graphite-surface-2 overflow-hidden"
                  >
                    <div
                      className={`h-full rounded-full ${BAR[b.status]}`}
                      style={{ width: `${Math.min(100, pct)}%` }}
                    />
                  </div>
                  <span
                    aria-hidden="true"
                    className="absolute -top-1 h-3.5 w-0.5 rounded bg-ink/70"
                    style={{ left: `calc(${pacePct}% - 1px)` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
