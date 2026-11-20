'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarClock, Zap } from 'lucide-react';
import Button from '@/components/Button';
import { fieldClasses } from '@/components/Input';
import { useToast } from '@/components/ToastProvider';
import { postRecurring, skipRecurringOccurrence } from '@/app/plan/recurring/actions';
import { notifyRemindersChanged } from '@/components/reminders/reminderStore';
import { formatCurrency } from '@/lib/utils';
import { todayInAppTimeZone } from '@/lib/dates';
import { dueLabel, planLine } from '@/lib/reminders';
import type { UpcomingItem } from '@/lib/recurring';

/**
 * What is due, with one-tap "Post now" / "Pay" and "Skip" on each entry's
 * next occurrence. Later occurrences of the same entry are listed for
 * planning but can only be handled once the earlier one is. A payment can be
 * made for a different amount ("Other amount"), which is how an installment
 * is paid early, late or in part.
 */
export default function UpcomingList({
  items,
  emptyText = 'Nothing due in the next 14 days.',
  limit,
  onHandled,
}: {
  items: UpcomingItem[];
  emptyText?: string;
  limit?: number;
  /** Called after an entry was posted or skipped. */
  onHandled?: (item: UpcomingItem) => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  // Hide handled rows at once; the refresh brings the next occurrence.
  const [handled, setHandled] = useState<Set<string>>(() => new Set());
  const [custom, setCustom] = useState<{ key: string; value: string } | null>(null);
  const today = todayInAppTimeZone();

  const visible = items.filter((i) => !handled.has(`${i.recurringId}:${i.dueDate}`));
  const shown = limit ? visible.slice(0, limit) : visible;

  const act = async (item: UpcomingItem, action: 'post' | 'skip', amount?: number) => {
    const key = `${item.recurringId}:${item.dueDate}`;
    setBusy(key);
    const result =
      action === 'post'
        ? await postRecurring(item.recurringId, item.dueDate, amount)
        : await skipRecurringOccurrence(item.recurringId, item.dueDate);
    setBusy(null);
    if (!result.success) {
      toast.error(result.error);
      router.refresh();
      return;
    }
    setHandled((prev) => new Set(prev).add(key));
    setCustom(null);
    if (action === 'skip') toast.success(`Skipped ${item.name} this time`);
    else if ('completed' in result && result.completed) toast.success(`${item.name} is paid off`);
    else if (item.friendName) {
      toast.success(`Paid ${item.friendName} ${formatCurrency(amount ?? item.amount)} for ${item.name}`);
    } else toast.success(`Posted ${item.name}`);
    notifyRemindersChanged();
    onHandled?.(item);
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
        // Paying someone back reads better as "Pay" than "Post now".
        const paying = item.kind !== 'INCOME' && Boolean(item.friendName || item.plan);
        const plan = planLine(item);
        const editing = custom?.key === key;
        const customAmount = editing ? Number(custom.value) : NaN;
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
              <p className="text-sm font-medium text-ink truncate">
                {item.name}
                {item.friendName && (
                  <span className="font-normal text-ink-secondary"> · to {item.friendName}</span>
                )}
              </p>
              <p className={`text-xs ${item.overdue ? 'text-warning' : 'text-ink-muted'} truncate`}>
                {dueLabel(item.dueDate, today)}
                {item.accountName ? ` · ${item.accountName}` : ''}
                {item.autoPost && (
                  <span className="inline-flex items-center gap-0.5 ml-1.5 text-info">
                    <Zap size={11} aria-hidden="true" />
                    auto
                  </span>
                )}
              </p>
              {plan && <p className="text-xs text-ink-muted truncate">{plan}</p>}
            </div>
            <p
              className={`text-sm font-semibold money tabular-nums ${
                income ? 'text-mint' : item.kind === 'TRANSFER' ? 'text-info' : 'text-ink'
              }`}
            >
              {income ? '+' : ''}
              {formatCurrency(item.amount)}
            </p>
            {!item.actionable ? (
              <p className="w-full sm:w-auto text-right text-[11px] text-ink-muted">After the one above</p>
            ) : editing ? (
              <form
                className="flex gap-1.5 w-full justify-end items-center"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (Number.isFinite(customAmount) && customAmount > 0) void act(item, 'post', customAmount);
                }}
              >
                <label className="sr-only" htmlFor={`amount-${key}`}>
                  Amount to pay for {item.name}
                </label>
                <input
                  id={`amount-${key}`}
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  autoFocus
                  value={custom.value}
                  onChange={(e) => setCustom({ key, value: e.target.value })}
                  className={`${fieldClasses} !w-32 !py-1.5 !text-sm`}
                />
                <Button
                  size="sm"
                  type="submit"
                  disabled={busy !== null || !Number.isFinite(customAmount) || customAmount <= 0}
                >
                  {isBusy ? 'Saving…' : paying ? 'Pay' : 'Post'}
                </Button>
                <Button size="sm" type="button" variant="ghost" onClick={() => setCustom(null)}>
                  Cancel
                </Button>
              </form>
            ) : (
              <div className="flex flex-wrap gap-1.5 w-full sm:w-auto justify-end">
                <Button
                  size="sm"
                  onClick={() => void act(item, 'post')}
                  disabled={busy !== null}
                  aria-label={`${paying ? 'Pay' : 'Post'} ${item.name} now`}
                >
                  {isBusy ? 'Saving…' : paying ? 'Mark paid' : 'Post now'}
                </Button>
                {item.kind !== 'INCOME' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setCustom({ key, value: item.amount.toFixed(2) })}
                    disabled={busy !== null}
                    aria-label={`Pay a different amount for ${item.name}`}
                  >
                    Other amount
                  </Button>
                )}
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
            )}
          </li>
        );
      })}
    </ul>
  );
}
