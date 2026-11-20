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
  occurrence,
  scheduleLabel,
  type Frequency,
} from '@/lib/recurringSchedule';
import { formatDay, isValidDay, todayInAppTimeZone } from '@/lib/dates';
import { REMIND_OPTIONS } from '@/lib/reminders';
import { formatCurrency } from '@/lib/utils';
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
  /** An installment plan: a total paid off in regular payments. */
  plan: boolean;
  totalAmount: string;
  /** How many payments; kept in step with total and amount. Not stored. */
  payments: string;
  /** Expenses: the friend each payment pays back. */
  friendId: string;
  /** New plans with a friend: also add the total to what you owe them. */
  recordDebt: boolean;
  debtDate: string;
  /** '' = app default. */
  remindDaysBefore: string;
  linkTransactionIds?: string[];
};

const toCents = (n: number) => Math.round(n * 100);

/** The regular payment that pays `total` off in `count` payments (rounded up to the cent). */
function paymentFor(total: string, count: string): string | null {
  const t = Number(total);
  const n = Math.round(Number(count));
  if (!Number.isFinite(t) || t <= 0 || !Number.isFinite(n) || n < 1) return null;
  return (Math.ceil(toCents(t) / n) / 100).toFixed(2);
}

function countFor(total: string, amount: string): string | null {
  const t = Number(total);
  const a = Number(amount);
  if (!Number.isFinite(t) || t <= 0 || !Number.isFinite(a) || a <= 0) return null;
  return String(Math.ceil(toCents(t) / toCents(a)));
}

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
    plan: false,
    totalAmount: '',
    payments: '',
    friendId: '',
    recordDebt: true,
    debtDate: todayInAppTimeZone(),
    remindDaysBefore: '',
  };
}

export function emptyPlanValues(): RecurringFormValues {
  return { ...emptyRecurringValues(), plan: true, payments: '12' };
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
  friends,
  formId,
  onSaved,
  onSubmittingChange,
}: {
  id: string | null;
  initial: RecurringFormValues;
  categories: RecurringPageData['categories'];
  accounts: RecurringPageData['accounts'];
  friends: RecurringPageData['friends'];
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
  const friend = friends.find((f) => f.id === v.friendId) ?? null;
  // Plans pay a friend, a loan / card account of yours, or someone untracked.
  const debtAccounts = accounts.filter((a) => a.type === 'LOAN' || a.type === 'CREDIT_CARD');
  const payee =
    v.kind === 'TRANSFER' && v.toAccountId
      ? `account:${v.toAccountId}`
      : v.friendId
      ? `friend:${v.friendId}`
      : '';
  const payeeAccount = v.kind === 'TRANSFER' ? accounts.find((a) => a.id === v.toAccountId) ?? null : null;
  const setPayee = (value: string) => {
    const [type, payeeId] = value.split(':');
    setV((prev) => {
      if (type !== 'account') {
        return { ...prev, kind: 'EXPENSE', toAccountId: '', friendId: type === 'friend' ? payeeId : '' };
      }
      const account = accounts.find((a) => a.id === payeeId);
      const next = {
        ...prev,
        kind: 'TRANSFER' as const,
        toAccountId: payeeId,
        friendId: '',
        categoryId: '',
        subcategoryId: '',
        name: prev.name || (account ? account.name : ''),
        // What is still owed on the account is the total to pay off.
        totalAmount: !prev.totalAmount && account && account.owed > 0 ? account.owed.toFixed(2) : prev.totalAmount,
      };
      // A known payment sets how many are left; otherwise the count sets the payment.
      if (Number(next.amount) > 0) next.payments = countFor(next.totalAmount, next.amount) ?? next.payments;
      else next.amount = paymentFor(next.totalAmount, next.payments) ?? next.amount;
      return next;
    });
    setErrors({});
  };
  const planCount = Math.round(Number(v.payments));
  const lastPayment =
    v.plan && validStart && Number.isFinite(planCount) && planCount >= 1 && planCount <= 1200
      ? occurrence(v.startDate, v.frequency, planCount - 1)
      : null;

  /** Total or count changed: the payment follows. Payment changed: the count follows. */
  const setPlan = (key: 'totalAmount' | 'payments' | 'amount', value: string) => {
    setV((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'amount') next.payments = countFor(next.totalAmount, value) ?? prev.payments;
      else next.amount = paymentFor(next.totalAmount, next.payments) ?? prev.amount;
      return next;
    });
    setErrors((prev) => ({ ...prev, totalAmount: undefined, payments: undefined, amount: undefined, form: undefined }));
  };

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
    if (!v.plan && v.endDate && validStart && v.endDate < v.startDate) e.endDate = 'Ends before it starts';
    if (v.plan) {
      const total = Number(v.totalAmount);
      if (!v.totalAmount.trim() || !Number.isFinite(total) || total <= 0) e.totalAmount = 'Enter the total to pay off';
      else if (!e.amount && toCents(total) < toCents(amount)) e.amount = 'More than the total';
      if (!v.name.trim()) e.name = 'Say what this is for';
      if (v.recordDebt && friend && !id && !isValidDay(v.debtDate)) e.debtDate = 'Pick the purchase date';
    } else if (!v.name.trim() && !v.merchantOrSource.trim() && v.kind !== 'TRANSFER') {
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
        endDate: v.plan ? null : v.endDate || null,
        autoPost: v.autoPost,
        friendId: v.kind === 'EXPENSE' ? v.friendId || null : null,
        totalAmount: v.plan ? Number(v.totalAmount) : null,
        recordDebt: !id && v.plan && Boolean(v.friendId) && v.recordDebt,
        debtDate: v.debtDate || null,
        remindDaysBefore: v.remindDaysBefore === '' ? null : Number(v.remindDaysBefore),
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

      {!v.plan && (
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
      )}

      {v.plan && (
        <>
          <Input
            label="What is it for?"
            value={v.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="e.g. Camera"
            error={errors.name}
          />
          <Select
            label="Who do you pay?"
            value={payee}
            onChange={(e) => setPayee(e.target.value)}
            hint={
              payeeAccount
                ? `Each payment moves money into ${payeeAccount.name} and lowers what you owe on it.`
                : friend
                ? `Each payment is an expense and lowers what you owe ${friend.name}.`
                : 'Pick a friend or one of your loan or card accounts to keep what you owe up to date.'
            }
            options={[
              { value: '', label: 'Someone else (a shop, a lender…)' },
              ...friends.map((f) => ({ value: `friend:${f.id}`, label: f.name })),
              ...debtAccounts.map((a) => ({
                value: `account:${a.id}`,
                label: `${a.name} (${a.type === 'LOAN' ? 'loan' : 'card'}${
                  a.owed > 0 ? `, ${formatCurrency(a.owed)} owed` : ''
                })`,
              })),
            ]}
          />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Input
              label={id ? 'Total' : payeeAccount ? 'Still to pay' : 'Total to pay back'}
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              value={v.totalAmount}
              onChange={(e) => setPlan('totalAmount', e.target.value)}
              placeholder="0.00"
              error={errors.totalAmount}
            />
            <Input
              label="Payments"
              type="number"
              step="1"
              min="1"
              inputMode="numeric"
              value={v.payments}
              onChange={(e) => setPlan('payments', e.target.value)}
              hint={id ? 'Still to make' : undefined}
            />
            <Input
              label="Each payment"
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              value={v.amount}
              onChange={(e) => setPlan('amount', e.target.value)}
              placeholder="0.00"
              error={errors.amount}
            />
          </div>
        </>
      )}

      {!v.plan && (
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
      )}

      {v.kind !== 'TRANSFER' && !v.plan && (
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
        {v.kind === 'TRANSFER' && !v.plan && (
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
            label={id ? 'Next due date' : v.plan ? 'First payment' : 'First due date'}
            type="date"
            value={v.startDate}
            onChange={(e) => set('startDate', e.target.value)}
            error={errors.startDate}
            hint={validStart ? scheduleLabel(v.frequency, v.startDate) : undefined}
          />
        </div>
        {v.plan ? (
          lastPayment && (
            <p className="text-xs text-ink-muted" role="status">
              {planCount} payment{planCount === 1 ? '' : 's'}, the last around{' '}
              {formatDay(lastPayment, { month: 'short', day: 'numeric', year: 'numeric' })}. The plan
              ends by itself when the total is paid.
            </p>
          )
        ) : (
          <Input
            label="End date (optional)"
            type="date"
            value={v.endDate}
            onChange={(e) => set('endDate', e.target.value)}
            error={errors.endDate}
            hint="Leave empty to repeat until you pause it"
          />
        )}
        {v.kind === 'EXPENSE' && !v.plan && friends.length > 0 && (
          <Select
            label="Pays back a friend (optional)"
            value={v.friendId}
            onChange={(e) => set('friendId', e.target.value)}
            hint="Each payment then also lowers what you owe them"
            options={[{ value: '', label: 'No one' }, ...friends.map((f) => ({ value: f.id, label: f.name }))]}
          />
        )}
        <Select
          label="Remind me"
          value={v.remindDaysBefore}
          onChange={(e) => set('remindDaysBefore', e.target.value)}
          hint={
            v.autoPost && v.remindDaysBefore === ''
              ? 'Entries that post automatically stay quiet unless you pick a time here'
              : 'On the Reminders tab, when you open the app, and as a notification if they are on'
          }
          options={REMIND_OPTIONS}
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

      {v.plan && !id && friend && (
        <div className="rounded-2xl border border-graphite-border-subtle bg-graphite-surface-2/40 p-4 space-y-3">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={v.recordDebt}
              onChange={(e) => set('recordDebt', e.target.checked)}
              className="mt-1 h-4 w-4 accent-[var(--mint)]"
            />
            <span>
              <span className="block text-sm font-medium text-ink">
                Add {Number(v.totalAmount) > 0 ? formatCurrency(Number(v.totalAmount)) : 'the total'} to what I
                owe {friend.name}
              </span>
              <span className="block text-xs text-ink-muted">
                Untick this if that debt is already on the Friends page. Each payment lowers it either way.
              </span>
            </span>
          </label>
          {v.recordDebt && (
            <Input
              label="Bought on"
              type="date"
              value={v.debtDate}
              onChange={(e) => set('debtDate', e.target.value)}
              error={errors.debtDate}
            />
          )}
        </div>
      )}

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
