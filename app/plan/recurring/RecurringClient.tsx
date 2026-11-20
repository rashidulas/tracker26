'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Pencil, Trash2, Pause, Play, Sparkles, X, Zap, Repeat, CalendarRange } from 'lucide-react';
import Modal from '@/components/Modal';
import Button from '@/components/Button';
import { useToast } from '@/components/ToastProvider';
import UpcomingList from '@/components/recurring/UpcomingList';
import RecurringForm, {
  emptyPlanValues,
  emptyRecurringValues,
  type RecurringFormValues,
} from './RecurringForm';
import { notifyRemindersChanged } from '@/components/reminders/reminderStore';
import {
  dismissSuggestion,
  removeRecurring,
  toggleRecurring,
  type RecurringPageData,
} from './actions';
import { formatCurrency } from '@/lib/utils';
import { formatDay } from '@/lib/dates';
import { FREQUENCY_LABELS, scheduleLabel, type Frequency } from '@/lib/recurringSchedule';
import type { RecurringSuggestion } from '@/lib/recurringDetection';

type Entry = RecurringPageData['entries'][number];

const FORM_ID = 'recurring-form';

/** Opens the installment form pre-filled, from a link elsewhere in the app. */
export type PlanPrefill = {
  friendId?: string;
  total?: string;
  name?: string;
  categoryId?: string;
  /** The debt is already on the Friends page. */
  existingDebt?: boolean;
};

function fromEntry(e: Entry): RecurringFormValues {
  return {
    ...emptyRecurringValues(),
    plan: e.plan !== null,
    totalAmount: e.totalAmount != null ? String(e.totalAmount) : '',
    payments: e.plan ? String(e.plan.paymentsLeft) : '',
    friendId: e.friendId ?? '',
    remindDaysBefore: e.remindDaysBefore == null ? '' : String(e.remindDaysBefore),
    name: e.name,
    kind: e.kind,
    amount: String(e.amount),
    categoryId: e.categoryId ?? '',
    subcategoryId: e.subcategoryId ?? '',
    accountId: e.accountId,
    toAccountId: e.toAccountId ?? '',
    merchantOrSource: e.merchantOrSource ?? '',
    notes: e.notes ?? '',
    frequency: e.frequency as Frequency,
    startDate: e.nextDueDate,
    endDate: e.endDate ?? '',
    autoPost: e.autoPost,
  };
}

function fromSuggestion(s: RecurringSuggestion): RecurringFormValues {
  return {
    ...emptyRecurringValues(),
    name: s.merchantName,
    kind: s.kind,
    amount: s.amount.toFixed(2),
    categoryId: s.categoryId ?? '',
    subcategoryId: s.subcategoryId ?? '',
    accountId: s.accountId ?? '',
    merchantOrSource: s.merchantName,
    frequency: s.frequency,
    startDate: s.nextDueDate,
    linkTransactionIds: s.transactionIds,
  };
}

export default function RecurringClient({
  data,
  prefill,
}: {
  data: RecurringPageData;
  prefill?: PlanPrefill | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState<{ id: string | null; values: RecurringFormValues; key: number } | null>(
    () =>
      prefill
        ? {
            id: null,
            key: 0,
            values: {
              ...emptyPlanValues(),
              friendId: data.friends.some((f) => f.id === prefill.friendId) ? prefill.friendId! : '',
              totalAmount: prefill.total && Number(prefill.total) > 0 ? prefill.total : '',
              amount:
                prefill.total && Number(prefill.total) > 0
                  ? (Math.ceil((Number(prefill.total) * 100) / 12) / 100).toFixed(2)
                  : '',
              name: prefill.name ?? '',
              categoryId: data.categories.some((c) => c.id === prefill.categoryId && c.type === 'EXPENSE')
                ? prefill.categoryId!
                : '',
              recordDebt: !prefill.existingDebt,
            },
          }
        : null
  );
  const [submitting, setSubmitting] = useState(false);
  const [hiddenSuggestions, setHiddenSuggestions] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState<string | null>(null);

  const open = (id: string | null, values: RecurringFormValues) =>
    setEditing({ id, values, key: Date.now() });

  const suggestions = data.suggestions.filter((s) => !hiddenSuggestions.has(s.key));
  const active = data.entries.filter((e) => e.active);
  const inactive = data.entries.filter((e) => !e.active);
  const plans = data.entries.filter((e) => e.plan !== null);
  const regular = data.entries.filter((e) => e.plan === null);
  const owedOnPlans = plans.reduce((sum, e) => sum + (e.plan?.remaining ?? 0), 0);

  /** The form's close: also drop the link's query string so a refresh does not reopen it. */
  const closeForm = () => {
    setEditing(null);
    if (prefill) router.replace('/plan/recurring');
  };

  const monthlyCost = active
    .filter((e) => e.kind === 'EXPENSE')
    .reduce((sum, e) => {
      const perMonth = { WEEKLY: 52 / 12, BIWEEKLY: 26 / 12, MONTHLY: 1, YEARLY: 1 / 12 }[e.frequency as Frequency];
      return sum + e.amount * perMonth;
    }, 0);

  const dismiss = async (s: RecurringSuggestion) => {
    setHiddenSuggestions((prev) => new Set(prev).add(s.key));
    const result = await dismissSuggestion(s.key);
    if (!result.success) {
      toast.error(result.error);
      setHiddenSuggestions((prev) => {
        const next = new Set(prev);
        next.delete(s.key);
        return next;
      });
    }
  };

  const toggle = async (e: Entry) => {
    setBusy(e.id);
    const result = await toggleRecurring(e.id, !e.active);
    setBusy(null);
    if (!result.success) toast.error(result.error);
    else toast.success(e.active ? `Paused ${e.name}` : `Resumed ${e.name}`);
    notifyRemindersChanged();
    router.refresh();
  };

  const remove = async (e: Entry) => {
    if (
      !confirm(
        `Delete “${e.name}”? Transactions it already posted stay, but charts will count them as everyday spending.`
      )
    ) {
      return;
    }
    setBusy(e.id);
    const result = await removeRecurring(e.id);
    setBusy(null);
    if (!result.success) toast.error(result.error);
    else toast.success(`Deleted ${e.name}`);
    notifyRemindersChanged();
    router.refresh();
  };

  const renderEntry = (e: Entry) => {
    const sign = e.kind === 'INCOME' ? '+' : '';
    return (
      <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3.5">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-base"
          style={{ backgroundColor: `${e.category?.color || '#7aa2f7'}1f` }}
          aria-hidden="true"
        >
          {e.category?.icon || (e.kind === 'TRANSFER' ? '↔' : '🔁')}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink truncate">
            {e.name}
            {e.friend && <span className="font-normal text-ink-secondary"> · to {e.friend.name}</span>}
            {e.autoPost && (
              <span className="ml-2 inline-flex items-center gap-0.5 text-[11px] text-info align-middle">
                <Zap size={11} aria-hidden="true" /> auto-post
              </span>
            )}
          </p>
          <p className="text-xs text-ink-muted truncate">
            {scheduleLabel(e.frequency as Frequency, e.startDate)}
            {' · '}
            {e.kind === 'TRANSFER'
              ? `${e.account?.name ?? '—'} → ${e.toAccount?.name ?? '—'}`
              : [e.category?.name, e.account?.name].filter(Boolean).join(' · ')}
          </p>
          {e.plan && (
            <div className="mt-1.5 mb-1 max-w-md">
              <div
                className="h-1.5 rounded-full bg-graphite-surface-2 overflow-hidden"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={e.plan.total}
                aria-valuenow={e.plan.paid}
                aria-label={`${e.name}: paid ${formatCurrency(e.plan.paid)} of ${formatCurrency(e.plan.total)}`}
              >
                <div
                  className="h-full rounded-full bg-mint"
                  style={{ width: `${Math.min(100, (e.plan.paid / e.plan.total) * 100)}%` }}
                />
              </div>
              <p className="text-xs text-ink-secondary mt-1 money">
                {formatCurrency(e.plan.paid)} of {formatCurrency(e.plan.total)} paid
                {e.plan.remaining > 0
                  ? ` · ${formatCurrency(e.plan.remaining)} left · ${e.plan.paymentsLeft} payment${
                      e.plan.paymentsLeft === 1 ? '' : 's'
                    } to go`
                  : ''}
              </p>
            </div>
          )}
          <p className="text-xs text-ink-muted">
            {e.plan && e.plan.remaining === 0
              ? 'Paid off'
              : e.active
              ? `Next: ${formatDay(e.nextDueDate, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}`
              : e.endDate && e.nextDueDate > e.endDate
              ? `Ended ${formatDay(e.endDate, { month: 'short', day: 'numeric', year: 'numeric' })}`
              : 'Paused'}
            {e.active && e.endDate
              ? ` · until ${formatDay(e.endDate, { month: 'short', day: 'numeric', year: 'numeric' })}`
              : ''}
          </p>
        </div>
        <p
          className={`text-sm font-semibold money tabular-nums ${
            e.kind === 'INCOME' ? 'text-mint' : e.kind === 'TRANSFER' ? 'text-info' : 'text-ink'
          }`}
        >
          {sign}
          {formatCurrency(e.amount)}
        </p>
        <div className="flex gap-1 w-full sm:w-auto justify-end">
          <Button size="sm" variant="ghost" onClick={() => open(e.id, fromEntry(e))} aria-label={`Edit ${e.name}`}>
            <Pencil size={15} />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void toggle(e)}
            disabled={busy === e.id}
            aria-label={e.active ? `Pause ${e.name}` : `Resume ${e.name}`}
            title={e.active ? 'Pause' : 'Resume'}
          >
            {e.active ? <Pause size={15} /> : <Play size={15} />}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void remove(e)}
            disabled={busy === e.id}
            aria-label={`Delete ${e.name}`}
          >
            <Trash2 size={15} />
          </Button>
        </div>
      </li>
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <p className="text-sm text-ink-secondary">
          {active.length > 0 ? (
            <>
              {active.length} active · about{' '}
              <span className="money text-ink">{formatCurrency(monthlyCost, { decimals: 0 })}</span> a month in
              recurring spending
            </>
          ) : (
            'Rent, subscriptions, pay day — enter them once and they show up when due.'
          )}
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <Button variant="secondary" onClick={() => open(null, emptyPlanValues())} className="w-full sm:w-auto">
            <CalendarRange size={18} />
            Installment plan
          </Button>
          <Button onClick={() => open(null, emptyRecurringValues())} className="w-full sm:w-auto">
            <Plus size={18} />
            Add recurring
          </Button>
        </div>
      </div>

      <section className="panel shadow-panel p-5 sm:p-6" aria-labelledby="upcoming-heading">
        <h2 id="upcoming-heading" className="text-lg font-semibold text-ink font-display">
          Upcoming
        </h2>
        <p className="text-xs text-ink-muted mt-0.5 mb-3">Due in the next 14 days</p>
        <UpcomingList items={data.upcoming} />
      </section>

      {suggestions.length > 0 && (
        <section className="panel shadow-panel p-5 sm:p-6" aria-labelledby="suggestions-heading">
          <div className="flex items-center gap-2 mb-1">
            <Sparkles size={16} className="text-info" aria-hidden="true" />
            <h2 id="suggestions-heading" className="text-lg font-semibold text-ink font-display">
              Looks recurring
            </h2>
          </div>
          <p className="text-xs text-ink-muted mb-3">
            Found in your history: same merchant, a similar amount, at a regular interval. Nothing is
            created until you review it.
          </p>
          <ul className="divide-y divide-graphite-border-subtle">
            {suggestions.map((s) => (
              <li key={s.key} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink truncate">{s.merchantName}</p>
                  <p className="text-xs text-ink-muted">
                    {FREQUENCY_LABELS[s.frequency]} · {s.occurrences} times since{' '}
                    {formatDay(s.firstDate, { month: 'short', year: 'numeric' })}
                    {s.minAmount !== s.maxAmount &&
                      ` · ${formatCurrency(s.minAmount)}–${formatCurrency(s.maxAmount)}`}
                  </p>
                </div>
                <p className={`text-sm font-semibold money ${s.kind === 'INCOME' ? 'text-mint' : 'text-ink'}`}>
                  {s.kind === 'INCOME' ? '+' : ''}
                  {formatCurrency(s.amount)}
                </p>
                <div className="flex gap-1.5 w-full sm:w-auto justify-end">
                  <Button size="sm" variant="secondary" onClick={() => open(null, fromSuggestion(s))}>
                    <Repeat size={14} />
                    Make recurring
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void dismiss(s)}
                    aria-label={`Dismiss suggestion for ${s.merchantName}`}
                    title="Not recurring"
                  >
                    <X size={15} />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="panel shadow-panel p-5 sm:p-6" aria-labelledby="plans-heading">
        <h2 id="plans-heading" className="text-lg font-semibold text-ink font-display">
          Installment plans
        </h2>
        <p className="text-xs text-ink-muted mt-0.5 mb-1">
          {plans.length > 0 ? (
            <>
              Something bought now and paid off over time ·{' '}
              <span className="money text-ink-secondary">{formatCurrency(owedOnPlans)}</span> still to pay
            </>
          ) : (
            'Bought something on a friend’s card or on credit? Set the total and the payment, and each one shows up when it is due.'
          )}
        </p>
        {plans.length > 0 && (
          <ul className="divide-y divide-graphite-border-subtle">
            {plans.filter((e) => e.active).map(renderEntry)}
            {plans.filter((e) => !e.active).map(renderEntry)}
          </ul>
        )}
      </section>

      <section className="panel shadow-panel p-5 sm:p-6" aria-labelledby="entries-heading">
        <h2 id="entries-heading" className="text-lg font-semibold text-ink font-display mb-1">
          Recurring entries
        </h2>
        {regular.length === 0 ? (
          <p className="text-sm text-ink-muted py-6 text-center">No recurring entries yet.</p>
        ) : (
          <ul className="divide-y divide-graphite-border-subtle">
            {regular.filter((e) => e.active).map(renderEntry)}
            {regular.filter((e) => !e.active).map(renderEntry)}
          </ul>
        )}
      </section>

      <Modal
        isOpen={editing !== null}
        onClose={closeForm}
        title={
          editing?.values.plan
            ? editing.id
              ? 'Edit installment plan'
              : 'New installment plan'
            : editing?.id
            ? 'Edit recurring entry'
            : 'Add recurring entry'
        }
        description={
          editing?.values.plan
            ? 'A total paid off in regular payments. Each payment is an expense on the day you make it.'
            : 'A template plus a schedule. Posted entries are ordinary transactions.'
        }
        size="lg"
        footer={
          <div className="flex gap-3">
            <Button type="button" variant="secondary" onClick={closeForm} className="flex-1">
              Cancel
            </Button>
            <Button type="submit" form={FORM_ID} disabled={submitting} className="flex-1">
              {submitting ? 'Saving…' : editing?.id ? 'Save changes' : editing?.values.plan ? 'Start plan' : 'Add recurring'}
            </Button>
          </div>
        }
      >
        {editing && (
          <RecurringForm
            key={editing.key}
            id={editing.id}
            initial={editing.values}
            categories={data.categories}
            accounts={data.accounts}
            friends={data.friends}
            formId={FORM_ID}
            onSubmittingChange={setSubmitting}
            onSaved={({ linked }) => {
              const wasEdit = Boolean(editing.id);
              const wasPlan = editing.values.plan;
              closeForm();
              notifyRemindersChanged();
              toast.success(
                wasPlan
                  ? wasEdit
                    ? 'Installment plan updated'
                    : 'Installment plan started'
                  : wasEdit
                  ? 'Recurring entry updated'
                  : linked
                  ? `Recurring entry added · ${linked} past transactions linked`
                  : 'Recurring entry added'
              );
              router.refresh();
            }}
          />
        )}
      </Modal>
    </div>
  );
}
