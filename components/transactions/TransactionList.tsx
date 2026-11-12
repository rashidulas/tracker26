'use client';

import { ReactNode } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';

export type TransactionTone = 'expense' | 'income' | 'transfer';

export interface TransactionListItem {
  id: string;
  date: Date | string;
  amount: number;
  tone: TransactionTone;
  /** Leading glyph, usually the category emoji. */
  icon?: ReactNode;
  title: string;
  badge?: string | null;
  /** Secondary facts shown under the title, separated by dots. */
  meta: ReactNode[];
  /** Optional block under the row, e.g. split-account breakdown. */
  detail?: ReactNode;
}

const amountTone: Record<TransactionTone, string> = {
  expense: 'text-danger',
  income: 'text-mint',
  transfer: 'text-info',
};

const summaryTone: Record<TransactionTone, string> = {
  expense: 'border-danger/20 from-danger-dim/80',
  income: 'border-mint/20 from-mint-dim/80',
  transfer: 'border-info/20 from-info-dim/80',
};

export function TransactionSummary({
  tone,
  total,
  count,
  label = 'Total this view',
}: {
  tone: TransactionTone;
  total: number;
  count: number;
  label?: string;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-2xl border bg-gradient-to-r to-graphite-surface mb-6 px-5 py-4 ${summaryTone[tone]}`}
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.16em] text-ink-muted mb-1">{label}</p>
          <p className={`text-3xl font-semibold money tracking-tight ${amountTone[tone]}`}>
            {formatCurrency(total)}
          </p>
        </div>
        <p className="text-sm text-ink-secondary" role="status">
          {count} transaction{count === 1 ? '' : 's'}
        </p>
      </div>
    </div>
  );
}

interface TransactionListProps<T extends TransactionListItem> {
  items: T[];
  /** Noun used in accessible labels, e.g. "expense". */
  noun: string;
  onEdit?: (item: T) => void;
  onDelete?: (item: T) => void;
  empty: ReactNode;
}

/** The one list used by every Transactions tab (expenses, income, transfers). */
export default function TransactionList<T extends TransactionListItem>({
  items,
  noun,
  onEdit,
  onDelete,
  empty,
}: TransactionListProps<T>) {
  if (items.length === 0) return <>{empty}</>;

  return (
    <ul className="space-y-2" aria-label={`${noun[0].toUpperCase()}${noun.slice(1)} list`}>
      {items.map((item) => {
        const label = `${item.title}, ${formatCurrency(item.amount)}, ${formatDate(item.date)}`;
        return (
          <li
            key={item.id}
            className="group rounded-2xl border border-graphite-border-subtle bg-graphite-surface px-3.5 sm:px-5 py-3 hover:border-graphite-border hover:bg-graphite-surface-hover focus-within:border-graphite-border transition-colors duration-200"
          >
            <div className="flex items-center gap-3 sm:gap-4">
              <div
                className="w-11 h-11 rounded-xl bg-graphite-surface-2 border border-graphite-border-subtle flex items-center justify-center text-lg shrink-0"
                aria-hidden="true"
              >
                {item.icon}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-medium text-ink truncate">{item.title}</p>
                  {item.badge && (
                    <span className="px-2 py-0.5 rounded-full text-[11px] bg-graphite-surface-2 text-ink-muted border border-graphite-border-subtle">
                      {item.badge}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5 text-xs text-ink-muted">
                  <span>{formatDate(item.date)}</span>
                  {item.meta.filter(Boolean).map((m, i) => (
                    <span key={i} className="inline-flex items-center gap-2">
                      <span aria-hidden="true" className="text-graphite-border">
                        ·
                      </span>
                      {m}
                    </span>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-1 sm:gap-2 shrink-0">
                <p
                  className={`text-sm sm:text-base font-semibold money tabular-nums ${amountTone[item.tone]}`}
                >
                  {formatCurrency(item.amount)}
                </p>
                {(onEdit || onDelete) && (
                  <div className="flex items-center sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 transition-opacity">
                    {onEdit && (
                      <button
                        type="button"
                        onClick={() => onEdit(item)}
                        className="w-11 h-11 inline-flex items-center justify-center rounded-xl text-ink-muted hover:text-mint hover:bg-mint-dim transition-colors"
                        aria-label={`Edit ${noun}: ${label}`}
                      >
                        <Pencil size={16} aria-hidden="true" />
                      </button>
                    )}
                    {onDelete && (
                      <button
                        type="button"
                        onClick={() => onDelete(item)}
                        className="w-11 h-11 inline-flex items-center justify-center rounded-xl text-ink-muted hover:text-danger hover:bg-danger-dim transition-colors"
                        aria-label={`Delete ${noun}: ${label}`}
                      >
                        <Trash2 size={16} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
            {item.detail && <div className="mt-2 pl-14 sm:pl-[3.75rem]">{item.detail}</div>}
          </li>
        );
      })}
    </ul>
  );
}

export function EmptyTransactions({
  icon,
  title,
  body,
  actions,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  actions?: ReactNode;
}) {
  return (
    <div className="panel border-dashed border-graphite-border py-16 px-6 text-center">
      <div
        className="mx-auto w-14 h-14 rounded-2xl bg-graphite-surface-2 flex items-center justify-center mb-4"
        aria-hidden="true"
      >
        {icon}
      </div>
      <p className="text-ink font-medium font-display text-lg">{title}</p>
      <p className="text-ink-muted text-sm mt-1.5">{body}</p>
      {actions && <div className="flex flex-wrap justify-center gap-2 mt-6">{actions}</div>}
    </div>
  );
}
