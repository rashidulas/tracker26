'use client';

import { useMemo, useState } from 'react';
import Input from '@/components/Input';
import Select from '@/components/Select';
import Textarea from '@/components/Textarea';
import { useToast } from '@/components/ToastProvider';
import { saveRecurring } from './actions';
import {
  FREQUENCIES,
  FREQUENCY_LABELS,
  scheduleLabel,
  type Frequency,
} from '@/lib/recurringSchedule';
import { isValidDay, todayInAppTimeZone } from '@/lib/dates';
import type { RecurringPageData } from './actions';

type Kind = 'EXPENSE' | 'INCOME' | 'TRANSFER';

export type RecurringFormValues = {
  name: string;
  kind: Kind;
  amount: string;
  categoryId: string;
  subcategoryId: string;
  accountId: string;
  toAccountId: string;
  merchantOrSource: string;
  notes: string;
  frequency: Frequency;
  startDate: string;
  endDate: string;
  autoPost: boolean;
  linkTransactionIds?: string[];
};

export function emptyRecurringValues(): RecurringFormValues {
  return {
    name: '',
    kind: 'EXPENSE',
    amount: '',
    categoryId: '',
    subcategoryId: '',
    accountId: '',
    toAccountId: '',
    merchantOrSource: '',
    notes: '',
    frequency: 'MONTHLY',
    startDate: todayInAppTimeZone(),
    endDate: '',
    autoPost: false,
  };
}

const KINDS: { value: Kind; label: string }[] = [
  { value: 'EXPENSE', label: 'Expense' },
  { value: 'INCOME', label: 'Income' },
  { value: 'TRANSFER', label: 'Transfer' },
];

export default function RecurringForm({
  id,
  initial,
  categories,
  accounts,
  formId,
  onSaved,
  onSubmittingChange,
}: {
  id: string | null;
  initial: RecurringFormValues;
  categories: RecurringPageData['categories'];
  accounts: RecurringPageData['accounts'];
  formId: string;
  onSaved: (info: { linked?: number }) => void;
  onSubmittingChange?: (busy: boolean) => void;
}) {
  const toast = useToast();
  const [v, setV] = useState<RecurringFormValues>(initial);
  const [errors, setErrors] = useState<Partial<Record<keyof RecurringFormValues | 'form', string>>>({});
  const set = <K extends keyof RecurringFormValues>(key: K, value: RecurringFormValues[K]) => {
    setV((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined, form: undefined }));
  };

  const kindCategories = useMemo(
    () => categories.filter((c) => c.type === v.kind),
    [categories, v.kind]
  );
  const subcategories = kindCategories.find((c) => c.id === v.categoryId)?.subcategories ?? [];
  const today = todayInAppTimeZone();
  const validStart = isValidDay(v.startDate);

  const validate = () => {
    const e: typeof errors = {};
    const amount = Number(v.amount);
    if (!v.amount.trim() || !Number.isFinite(amount) || amount <= 0) e.amount = 'Enter an amount above 0';
    if (!v.accountId) e.accountId = v.kind === 'TRANSFER' ? 'Choose the account to transfer from' : 'Choose an account';
    if (v.kind === 'TRANSFER') {
      if (!v.toAccountId) e.toAccountId = 'Choose the account to transfer to';
      else if (v.toAccountId === v.accountId) e.toAccountId = 'Pick a different account';
    } else if (!v.categoryId) {
      e.categoryId = 'Pick a category';
    }
    if (!validStart) e.startDate = 'Pick the first due date';
    if (v.endDate && validStart && v.endDate < v.startDate) e.endDate = 'Ends before it starts';
    if (!v.name.trim() && !v.merchantOrSource.trim() && v.kind !== 'TRANSFER') {
      e.name = 'Give it a name, or fill in the merchant';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!validate()) return;
    onSubmittingChange?.(true);
    try {
      const result = await saveRecurring(id, {
        name: v.name,
        kind: v.kind,
        amount: Number(v.amount),
        categoryId: v.kind === 'TRANSFER' ? null : v.categoryId,
        subcategoryId: v.kind === 'TRANSFER' ? null : v.subcategoryId || null,
        accountId: v.accountId,
        toAccountId: v.kind === 'TRANSFER' ? v.toAccountId : null,
        merchantOrSource: v.kind === 'TRANSFER' ? null : v.merchantOrSource,
        notes: v.notes,
        frequency: v.frequency,
        startDate: v.startDate,
        endDate: v.endDate || null,
        autoPost: v.autoPost,
        linkTransactionIds: v.linkTransactionIds,
      });
      if (!result.success) {
        setErrors({ form: result.error });
        return;
      }
      onSaved({ linked: 'linked' in result ? result.linked : undefined });
    } catch {
      toast.error('Could not save — check your connection and try again');
    } finally {
      onSubmittingChange?.(false);
    }
  };

  const accountOptions = [
    { value: '', label: 'Select account…' },
    ...accounts.map((a) => ({ value: a.id, label: a.name })),
  ];

  return (
    <form id={formId} onSubmit={submit} noValidate className="space-y-4">
      {errors.form && (
        <div role="alert" className="p-3 bg-danger-dim border border-danger/25 rounded-xl text-danger text-sm">
          {errors.form}
        </div>
      )}

      <fieldset>
        <legend className="block text-sm font-medium text-ink-secondary mb-2">Type</legend>
        <div className="inline-flex p-1 rounded-xl bg-graphite-surface-2/90 border border-graphite-border-subtle">
          {KINDS.map((k) => (
            <button
              key={k.value}
              type="button"
              aria-pressed={v.kind === k.value}
              onClick={() => {
                setV((prev) => ({
                  ...prev,
                  kind: k.value,
                  categoryId: prev.kind === k.value ? prev.categoryId : '',
                  subcategoryId: prev.kind === k.value ? prev.subcategoryId : '',
                }));
                setErrors({});
              }}
              className={`px-3.5 py-1.5 rounded-lg text-sm transition-colors ${
                v.kind === k.value ? 'bg-mint-dim text-mint font-medium' : 'text-ink-secondary hover:text-ink'
              }`}
            >
              {k.label}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Input
          label="Name"
          value={v.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder={v.kind === 'INCOME' ? 'e.g. Salary' : v.kind === 'TRANSFER' ? 'e.g. Savings top-up' : 'e.g. Rent'}
          error={errors.name}
          hint={v.kind !== 'TRANSFER' ? 'Defaults to the merchant' : undefined}
        />
        <Input
          label="Amount"
          type="number"
          step="0.01"
          min="0"
          inputMode="decimal"
          value={v.amount}
          onChange={(e) => set('amount', e.target.value)}
          placeholder="0.00"
          error={errors.amount}
        />
      </div>

      {v.kind !== 'TRANSFER' && (
        <Input
          label={v.kind === 'INCOME' ? 'Source (optional)' : 'Merchant (optional)'}
          value={v.merchantOrSource}
          onChange={(e) => set('merchantOrSource', e.target.value)}
          placeholder={v.kind === 'INCOME' ? 'e.g. Acme Corp' : 'e.g. Oak Street Apartments'}
        />
      )}

      {v.kind !== 'TRANSFER' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Select
            label="Category"
            value={v.categoryId}
            onChange={(e) => {
              set('categoryId', e.target.value);
              set('subcategoryId', '');
            }}
            error={errors.categoryId}
            options={[
              { value: '', label: 'Select category…' },
              ...kindCategories.map((c) => ({ value: c.id, label: `${c.icon ?? ''} ${c.name}`.trim() })),
            ]}
          />
          {subcategories.length > 0 && (
            <Select
              label="Subcategory (optional)"
              value={v.subcategoryId}
              onChange={(e) => set('subcategoryId', e.target.value)}
              options={[{ value: '', label: 'None' }, ...subcategories.map((s) => ({ value: s.id, label: s.name }))]}
            />
          )}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Select
          label={v.kind === 'TRANSFER' ? 'From account' : v.kind === 'INCOME' ? 'Into account' : 'Paid from'}
          value={v.accountId}
          onChange={(e) => set('accountId', e.target.value)}
          error={errors.accountId}
          options={accountOptions}
        />
        {v.kind === 'TRANSFER' && (
          <Select
            label="To account"
            value={v.toAccountId}
            onChange={(e) => set('toAccountId', e.target.value)}
            error={errors.toAccountId}
            options={accountOptions}
          />
        )}
      </div>

      <div className="rounded-2xl border border-graphite-border-subtle bg-graphite-surface-2/40 p-4 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Select
            label="Repeats"
            value={v.frequency}
            onChange={(e) => set('frequency', e.target.value as Frequency)}
            options={FREQUENCIES.map((f) => ({ value: f, label: FREQUENCY_LABELS[f] }))}
          />
          <Input
            label={id ? 'Next due date' : 'First due date'}
            type="date"
            value={v.startDate}
            onChange={(e) => set('startDate', e.target.value)}
            error={errors.startDate}
            hint={validStart ? scheduleLabel(v.frequency, v.startDate) : undefined}
          />
        </div>
        <Input
          label="End date (optional)"
          type="date"
          value={v.endDate}
          onChange={(e) => set('endDate', e.target.value)}
          error={errors.endDate}
          hint="Leave empty to repeat until you pause it"
        />
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={v.autoPost}
            onChange={(e) => set('autoPost', e.target.checked)}
            className="mt-1 h-4 w-4 accent-[var(--mint)]"
          />
          <span>
            <span className="block text-sm font-medium text-ink">Post automatically when due</span>
            <span className="block text-xs text-ink-muted">
              Otherwise it waits in Upcoming for you to tap Post now or Skip.
            </span>
          </span>
        </label>
        {validStart && v.startDate < today && (
          <p className="text-xs text-warning" role="status">
            {v.autoPost
              ? 'This date is in the past: every occurrence since then will be posted the next time the app opens.'
              : 'This date is in the past: it will show as overdue until you post or skip it.'}
          </p>
        )}
      </div>

      <Textarea
        label="Notes (optional)"
        value={v.notes}
        onChange={(e) => set('notes', e.target.value)}
        rows={2}
      />

      {v.linkTransactionIds && v.linkTransactionIds.length > 0 && (
        <p className="text-xs text-ink-muted">
          The {v.linkTransactionIds.length} past transactions this was found from will be marked as
          recurring, so charts can show them separately.
        </p>
      )}
    </form>
  );
}
