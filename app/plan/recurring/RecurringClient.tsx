'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Pencil, Trash2, Pause, Play, Sparkles, X, Zap, Repeat } from 'lucide-react';
import Modal from '@/components/Modal';
import Button from '@/components/Button';
import { useToast } from '@/components/ToastProvider';
import UpcomingList from '@/components/recurring/UpcomingList';
import RecurringForm, { emptyRecurringValues, type RecurringFormValues } from './RecurringForm';
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

function fromEntry(e: Entry): RecurringFormValues {
  return {
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

export default function RecurringClient({ data }: { data: RecurringPageData }) {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState<{ id: string | null; values: RecurringFormValues; key: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [hiddenSuggestions, setHiddenSuggestions] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState<string | null>(null);

  const open = (id: string | null, values: RecurringFormValues) =>
    setEditing({ id, values, key: Date.now() });

  const suggestions = data.suggestions.filter((s) => !hiddenSuggestions.has(s.key));
  const active = data.entries.filter((e) => e.active);
  const inactive = data.entries.filter((e) => !e.active);

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
          <p className="text-xs text-ink-muted">
            {e.active
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
        <Button onClick={() => open(null, emptyRecurringValues())} className="w-full sm:w-auto">
          <Plus size={18} />
          Add recurring
        </Button>
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

      <section className="panel shadow-panel p-5 sm:p-6" aria-labelledby="entries-heading">
        <h2 id="entries-heading" className="text-lg font-semibold text-ink font-display mb-1">
          Recurring entries
        </h2>
        {data.entries.length === 0 ? (
          <p className="text-sm text-ink-muted py-6 text-center">No recurring entries yet.</p>
        ) : (
          <ul className="divide-y divide-graphite-border-subtle">
            {active.map(renderEntry)}
            {inactive.map(renderEntry)}
          </ul>
        )}
      </section>

      <Modal
        isOpen={editing !== null}
        onClose={() => setEditing(null)}
        title={editing?.id ? 'Edit recurring entry' : 'Add recurring entry'}
        description="A template plus a schedule. Posted entries are ordinary transactions."
        size="lg"
        footer={
          <div className="flex gap-3">
            <Button type="button" variant="secondary" onClick={() => setEditing(null)} className="flex-1">
              Cancel
            </Button>
            <Button type="submit" form={FORM_ID} disabled={submitting} className="flex-1">
              {submitting ? 'Saving…' : editing?.id ? 'Save changes' : 'Add recurring'}
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
            formId={FORM_ID}
            onSubmittingChange={setSubmitting}
            onSaved={({ linked }) => {
              const wasEdit = Boolean(editing.id);
              setEditing(null);
              toast.success(
                wasEdit
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
