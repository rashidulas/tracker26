import Link from 'next/link';
import type { ReactNode } from 'react';
import { CalendarClock, ChevronRight, Lightbulb, Sparkles } from 'lucide-react';
import { formatDay } from '@/lib/dates';
import type { StoredRecap } from '@/lib/insights/store';
import { formatCurrency } from '@/lib/utils';

const KIND_LABEL = { weekly: 'Weekly recap', monthly: 'Monthly recap' } as const;

function Change({ change, changePct }: { change: number; changePct: number | null }) {
  if (change === 0) return <span className="text-ink-muted">no change</span>;
  const up = change > 0;
  // More spending is not good news, so "up" takes the warning colour.
  return (
    <span className={up ? 'text-warning' : 'text-mint'}>
      {formatCurrency(Math.abs(change))} {up ? 'more' : 'less'}
      {changePct !== null && ` (${Math.round(Math.abs(changePct) * 100)}%)`}
    </span>
  );
}

function Eyebrow({ recap }: { recap: StoredRecap }) {
  return (
    <p className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-medium uppercase tracking-[0.14em] text-mint">
      <span className="inline-flex items-center gap-1.5">
        <Sparkles size={12} aria-hidden="true" />
        {KIND_LABEL[recap.kind]}
      </span>
      <span className="text-ink-muted normal-case tracking-normal">{recap.label}</span>
    </p>
  );
}

function Suggestion({ text }: { text: string }) {
  return (
    <div className="flex gap-3 rounded-xl border border-mint/20 bg-mint-dim p-3.5">
      <Lightbulb size={16} className="text-mint shrink-0 mt-0.5" aria-hidden="true" />
      <div>
        <p className="text-[11px] text-mint uppercase tracking-[0.12em] mb-0.5">One suggestion</p>
        <p className="text-sm text-ink">{text}</p>
      </div>
    </div>
  );
}

/** The short form shown on the dashboard: wording only, with a link to the full recap. */
export function RecapSummaryCard({ recap }: { recap: StoredRecap }) {
  return (
    <section aria-label={`${KIND_LABEL[recap.kind]}, ${recap.label}`} className="panel shadow-panel p-5 sm:p-6 space-y-3">
      <Eyebrow recap={recap} />
      <h2 className="text-xl font-semibold text-ink font-display tracking-tight">{recap.text.headline}</h2>
      <p className="text-sm text-ink-secondary leading-relaxed max-w-3xl">{recap.text.summary}</p>
      <Suggestion text={recap.text.suggestion} />
      <Link
        href={`/insights?recap=${encodeURIComponent(recap.key)}#recap`}
        className="inline-flex items-center min-h-[36px] text-sm text-mint hover:underline"
      >
        Open the full recap
        <ChevronRight size={15} aria-hidden="true" />
      </Link>
    </section>
  );
}

function Tile({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-xl border border-graphite-border-subtle bg-graphite-elevated/60 p-3.5">
      <p className="text-[11px] text-ink-muted uppercase tracking-[0.12em] mb-1">{label}</p>
      <p className="text-lg font-semibold text-ink money">{value}</p>
      {sub && <p className="text-xs mt-0.5">{sub}</p>}
    </div>
  );
}

function Ranked({ title, rows, empty }: { title: string; rows: { name: string; amount: number; note?: string }[]; empty: string }) {
  const max = rows[0]?.amount || 1;
  return (
    <div>
      <h4 className="text-sm font-semibold text-ink font-display mb-2.5">{title}</h4>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-muted">{empty}</p>
      ) : (
        <ul className="space-y-2.5">
          {rows.map((row) => (
            <li key={row.name}>
              <div className="flex justify-between gap-3 text-sm mb-1">
                <span className="text-ink-secondary truncate">
                  {row.name}
                  {row.note && <span className="text-ink-muted"> · {row.note}</span>}
                </span>
                <span className="money text-ink">{formatCurrency(row.amount)}</span>
              </div>
              <div className="h-1.5 rounded-full bg-graphite-surface-2 overflow-hidden">
                <div className="h-full rounded-full bg-mint/80" style={{ width: `${Math.min((row.amount / max) * 100, 100)}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A recap in full: the wording, then every figure it was written from. */
export default function RecapView({ recap, actions }: { recap: StoredRecap; actions?: ReactNode }) {
  const f = recap.facts;
  const period = f.kind === 'weekly' ? 'week' : 'month';
  const shortDay = (day: string) => formatDay(day, { month: 'short', day: 'numeric' });

  return (
    <article className="panel shadow-panel overflow-hidden relative">
      <div className="absolute inset-0 bg-gradient-to-br from-mint/[0.06] via-transparent to-info/[0.04] pointer-events-none" />
      <div className="relative p-5 sm:p-7 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <Eyebrow recap={recap} />
          {actions}
        </div>
        <h3 className="text-2xl sm:text-3xl font-semibold text-ink font-display tracking-tight">{recap.text.headline}</h3>
        <p className="text-ink-secondary leading-relaxed max-w-3xl">{recap.text.summary}</p>
        <Suggestion text={recap.text.suggestion} />

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Tile label="Spent" value={formatCurrency(f.spent)} sub={<span className="text-ink-muted">{f.count} expense{f.count === 1 ? '' : 's'}</span>} />
          <Tile
            label={`${period === 'week' ? 'Week' : 'Month'} before`}
            value={f.previous ? formatCurrency(f.previous.spent) : '—'}
            sub={f.previous ? <Change {...f.previous} /> : <span className="text-ink-muted">Not enough history</span>}
          />
          <Tile
            label={f.average ? `Average of ${f.average.periods} ${period}s` : 'Your average'}
            value={f.average ? formatCurrency(f.average.spent) : '—'}
            sub={f.average ? <Change {...f.average} /> : <span className="text-ink-muted">Not enough history</span>}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Ranked title="Top categories" rows={f.topCategories} empty="No categorised spending." />
          <Ranked
            title="Top merchants"
            rows={f.topMerchants.map((m) => ({ name: m.name, amount: m.amount, note: `${m.count}×` }))}
            empty="No merchants recorded."
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h4 className="text-sm font-semibold text-ink font-display mb-2.5">Budgets{f.budget ? ` · ${f.budget.month}` : ''}</h4>
            {f.budget ? (
              <div className="text-sm text-ink-secondary space-y-1">
                <p>
                  <span className="money text-ink">{formatCurrency(f.budget.spent)}</span> of{' '}
                  <span className="money text-ink">{formatCurrency(f.budget.available)}</span> used
                  {f.budget.daysLeft > 0 && (
                    <>
                      , <span className="money text-ink">{formatCurrency(f.budget.remaining)}</span> left with {f.budget.daysLeft} day
                      {f.budget.daysLeft === 1 ? '' : 's'} to go
                    </>
                  )}
                  .
                </p>
                {f.budget.over.length === 0 ? (
                  <p className="text-mint">Nothing over budget.</p>
                ) : (
                  <ul>
                    {f.budget.over.map((o) => (
                      <li key={o.name} className="text-danger">
                        {o.name} over by <span className="money">{formatCurrency(o.overBy)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <p className="text-sm text-ink-muted">No budgets set for this month.</p>
            )}
          </div>
          <div>
            <h4 className="text-sm font-semibold text-ink font-display mb-2.5 inline-flex items-center gap-1.5">
              <CalendarClock size={14} className="text-ink-muted" aria-hidden="true" />
              Coming up · next {f.upcoming.days} days
            </h4>
            {f.upcoming.items.length === 0 ? (
              <p className="text-sm text-ink-muted">Nothing scheduled.</p>
            ) : (
              <ul className="text-sm text-ink-secondary space-y-1">
                {f.upcoming.items.map((item, i) => (
                  <li key={`${item.name}-${item.day}-${i}`} className="flex justify-between gap-3">
                    <span className="truncate">
                      {item.name} <span className="text-ink-muted">· {shortDay(item.day)}</span>
                    </span>
                    <span className={`money ${item.kind === 'INCOME' ? 'text-mint' : 'text-ink'}`}>
                      {item.kind === 'INCOME' ? '+' : ''}
                      {formatCurrency(item.amount)}
                    </span>
                  </li>
                ))}
                {f.upcoming.count > f.upcoming.items.length && (
                  <li className="text-ink-muted">and {f.upcoming.count - f.upcoming.items.length} more</li>
                )}
              </ul>
            )}
          </div>
        </div>

        {f.notes.length > 0 && (
          <ul className="text-xs text-ink-muted space-y-1">
            {f.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        )}
        <p className="text-[11px] text-ink-muted">
          Figures computed by the app as of {shortDay(f.generatedOn)}.{' '}
          {recap.wording === 'model' ? 'Wording by the assistant.' : 'Plain wording (no model was used).'}
        </p>
      </div>
    </article>
  );
}
