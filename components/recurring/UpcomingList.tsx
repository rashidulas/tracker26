'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarClock, Zap } from 'lucide-react';
import Button from '@/components/Button';
import { useToast } from '@/components/ToastProvider';
import { postRecurring, skipRecurringOccurrence } from '@/app/plan/recurring/actions';
import { formatCurrency } from '@/lib/utils';
import { daysBetween } from '@/lib/recurringSchedule';
import { formatDay, todayInAppTimeZone } from '@/lib/dates';
import type { UpcomingItem } from '@/lib/recurring';

function dueLabel(dueDate: string, today: string) {
  const diff = daysBetween(today, dueDate);
  if (diff === 0) return 'Due today';
  if (diff === 1) return 'Due tomorrow';
  if (diff < 0) return `Overdue · ${formatDay(dueDate, { month: 'short', day: 'numeric' })}`;
  if (diff < 7) return `Due ${formatDay(dueDate, { weekday: 'long' })}`;
  return `Due ${formatDay(dueDate, { month: 'short', day: 'numeric' })}`;
}

/**
 * What is due in the next 14 days, with one-tap "Post now" and "Skip" on each
 * entry's next occurrence. Later occurrences of the same entry are listed for
 * planning but can only be handled once the earlier one is.
 */
export default function UpcomingList({
  items,
  emptyText = 'Nothing due in the next 14 days.',
  limit,
}: {
  items: UpcomingItem[];
  emptyText?: string;
  limit?: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  // Hide handled rows at once; the refresh brings the next occurrence.
  const [handled, setHandled] = useState<Set<string>>(() => new Set());
  const today = todayInAppTimeZone();

  const visible = items.filter((i) => !handled.has(`${i.recurringId}:${i.dueDate}`));
  const shown = limit ? visible.slice(0, limit) : visible;

  const act = async (item: UpcomingItem, action: 'post' | 'skip') => {
    const key = `${item.recurringId}:${item.dueDate}`;
    setBusy(key);
    const result =
      action === 'post'
        ? await postRecurring(item.recurringId, item.dueDate)
        : await skipRecurringOccurrence(item.recurringId, item.dueDate);
    setBusy(null);
    if (!result.success) {
      toast.error(result.error);
      router.refresh();
      return;
    }
    setHandled((prev) => new Set(prev).add(key));
    toast.success(action === 'post' ? `Posted ${item.name}` : `Skipped ${item.name} this time`);
    router.refresh();
  };

  if (shown.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-ink-muted">
        <CalendarClock size={24} className="mb-2 opacity-40" aria-hidden="true" />
        <p className="text-sm">{emptyText}</p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-graphite-border-subtle">
      {shown.map((item) => {
        const key = `${item.recurringId}:${item.dueDate}`;
        const isBusy = busy === key;
        const income = item.kind === 'INCOME';
        return (
          <li key={key} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-base"
              style={{ backgroundColor: `${item.categoryColor || '#7aa2f7'}1f` }}
              aria-hidden="true"
            >
              {item.categoryIcon || (item.kind === 'TRANSFER' ? '↔' : '🔁')}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink truncate">{item.name}</p>
              <p
                className={`text-xs ${item.overdue ? 'text-warning' : 'text-ink-muted'} truncate`}
              >
                {dueLabel(item.dueDate, today)}
                {item.accountName ? ` · ${item.accountName}` : ''}
                {item.autoPost && (
                  <span className="inline-flex items-center gap-0.5 ml-1.5 text-info">
                    <Zap size={11} aria-hidden="true" />
                    auto
                  </span>
                )}
              </p>
            </div>
            <p
              className={`text-sm font-semibold money tabular-nums ${
                income ? 'text-mint' : item.kind === 'TRANSFER' ? 'text-info' : 'text-ink'
              }`}
            >
              {income ? '+' : ''}
              {formatCurrency(item.amount)}
            </p>
            {item.actionable ? (
              <div className="flex gap-1.5 w-full sm:w-auto justify-end">
                <Button
                  size="sm"
                  onClick={() => void act(item, 'post')}
                  disabled={busy !== null}
                  aria-label={`Post ${item.name} now`}
                >
                  {isBusy ? 'Posting…' : 'Post now'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void act(item, 'skip')}
                  disabled={busy !== null}
                  aria-label={`Skip ${item.name} this time`}
                >
                  Skip
                </Button>
              </div>
            ) : (
              <p className="w-full sm:w-auto text-right text-[11px] text-ink-muted">
                After the one above
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
