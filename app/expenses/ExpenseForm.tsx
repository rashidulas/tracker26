'use client';

import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Input from '@/components/Input';
import Select from '@/components/Select';
import Button from '@/components/Button';
import {
  createExpense,
  updateExpense,
  createDebtPaymentTransfer,
  createPaymentTransfer,
} from './actions';
import { useEffect, useState } from 'react';
import { formatDateForInput, getLocalTodayForInput } from '@/lib/utils';
import {
  CreditCard,
  ArrowRight,
  Banknote,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

const expenseSchema = z.object({
  date: z.string().min(1, 'Date is required'),
  amount: z.string().optional(),
  categoryId: z.string().min(1, 'Category is required'),
  subcategoryId: z.string().optional(),
  accountId: z.string().optional(),
  merchantOrSource: z.string().optional(),
  notes: z.string().optional(),
  tags: z.string().optional(),
  toAccountId: z.string().optional(),
  payAmount: z.string().optional(),
});

type ExpenseFormData = z.infer<typeof expenseSchema>;

interface ExpenseFormProps {
  expense?: {
    id: string;
    date: Date;
    amount: number;
    categoryId: string | null;
    subcategoryId?: string | null;
    accountId: string | null;
    merchantOrSource?: string | null;
    notes?: string | null;
    tags: string[];
  };
  categories: Array<{
    id: string;
    name: string;
    icon?: string | null;
    color?: string | null;
    subcategories?: Array<{ id: string; name: string }>;
  }>;
  accounts: Array<{ id: string; name: string; type?: string }>;
  onSuccess: () => void;
  onCancel: () => void;
  hideActions?: boolean;
  onSubmittingChange?: (submitting: boolean) => void;
  formId?: string;
}

const DEBT_PAYMENT_SENTINEL = '__DEBT_PAYMENT__';
const PAYMENT_SENTINEL = '__PAYMENT__';

export default function ExpenseForm({
  expense,
  categories,
  accounts,
  onSuccess,
  onCancel,
  hideActions = false,
  onSubmittingChange,
  formId = 'expense-form',
}: ExpenseFormProps) {
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showDetails, setShowDetails] = useState(
    Boolean(expense?.notes || expense?.tags?.length || expense?.merchantOrSource)
  );

  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors },
  } = useForm<ExpenseFormData>({
    resolver: zodResolver(expenseSchema),
    defaultValues: {
      date: expense?.date ? formatDateForInput(expense.date) : getLocalTodayForInput(),
      amount: expense?.amount.toString() || '',
      categoryId: expense?.categoryId || '',
      subcategoryId: expense?.subcategoryId || '',
      accountId: expense?.accountId || '',
      merchantOrSource: expense?.merchantOrSource || '',
      notes: expense?.notes || '',
      tags: expense?.tags?.join(', ') || '',
      toAccountId: '',
      payAmount: '',
    },
  });

  const selectedCategoryId = useWatch({ control, name: 'categoryId' });
  const selectedFromAccountId = useWatch({ control, name: 'accountId' });
  const selectedToAccountId = useWatch({ control, name: 'toAccountId' });
  const payAmountVal = useWatch({ control, name: 'payAmount' });
  const selectedSubcategoryId = useWatch({ control, name: 'subcategoryId' });

  const isDebtPayment = selectedCategoryId === DEBT_PAYMENT_SENTINEL;
  const isPayment = selectedCategoryId === PAYMENT_SENTINEL;

  const selectedCategory = categories.find((c) => c.id === selectedCategoryId);
  const availableSubcategories = selectedCategory?.subcategories || [];

  useEffect(() => {
    onSubmittingChange?.(isSubmitting);
  }, [isSubmitting, onSubmittingChange]);

  useEffect(() => {
    if (isDebtPayment || isPayment) {
      setValue('subcategoryId', '');
      return;
    }
    const subs =
      categories.find((c) => c.id === selectedCategoryId)?.subcategories || [];
    if (selectedSubcategoryId && !subs.some((s) => s.id === selectedSubcategoryId)) {
      setValue('subcategoryId', '');
    }
  }, [
    selectedCategoryId,
    selectedSubcategoryId,
    categories,
    isDebtPayment,
    isPayment,
    setValue,
  ]);

  const fromAccount = accounts.find((a) => a.id === selectedFromAccountId);
  const toAccount = accounts.find((a) => a.id === selectedToAccountId);
  const toAccountOptions = accounts.filter((a) => a.id !== selectedFromAccountId);
  const fromAccountOptions = accounts.filter((a) => a.id !== selectedToAccountId);

  const regularCategories = categories.filter(
    (c) => c.name !== 'Debt Payment' && c.name !== 'Payment'
  );

  const onSubmit = async (data: ExpenseFormData) => {
    setIsSubmitting(true);
    setError('');

    try {
      if (isPayment) {
        if (!data.accountId) {
          setError('Please select the account to pay from.');
          return;
        }
        if (!data.toAccountId) {
          setError('Please select the account to pay to.');
          return;
        }
        if (!data.payAmount || parseFloat(data.payAmount) <= 0) {
          setError('Please enter a valid payment amount.');
          return;
        }

        const formData = new FormData();
        formData.append('date', data.date);
        formData.append('amount', data.payAmount);
        formData.append('fromAccountId', data.accountId);
        formData.append('toAccountId', data.toAccountId);
        formData.append('notes', data.notes || '');

        const result = await createPaymentTransfer(formData);
        if (result.success) onSuccess();
        else setError(result.error || 'Failed to record payment');
      } else if (isDebtPayment) {
        if (!data.toAccountId) {
          setError('Please select the credit card / debt account to pay.');
          return;
        }
        if (!data.accountId) {
          setError('Please select the account to pay from.');
          return;
        }
        if (!data.payAmount || parseFloat(data.payAmount) <= 0) {
          setError('Please enter a valid payment amount.');
          return;
        }

        const formData = new FormData();
        formData.append('date', data.date);
        formData.append('amount', data.payAmount);
        formData.append('fromAccountId', data.accountId);
        formData.append('toAccountId', data.toAccountId);
        formData.append('notes', data.notes || '');

        const result = await createDebtPaymentTransfer(formData);
        if (result.success) onSuccess();
        else setError(result.error || 'Failed to record payment');
      } else {
        if (!data.amount || parseFloat(data.amount) <= 0) {
          setError('Please enter a valid amount.');
          return;
        }
        const formData = new FormData();
        formData.append('date', data.date);
        formData.append('amount', data.amount);
        formData.append('categoryId', data.categoryId);
        formData.append('subcategoryId', data.subcategoryId || '');
        formData.append('accountId', data.accountId || '');
        formData.append('merchantOrSource', data.merchantOrSource || '');
        formData.append('notes', data.notes || '');
        formData.append('tags', data.tags || '');

        const result = expense
          ? await updateExpense(expense.id, formData)
          : await createExpense(formData);

        if (result.success) onSuccess();
        else setError(result.error || 'Something went wrong');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form id={formId} onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {error && (
        <div className="p-3 bg-danger-dim border border-danger/25 rounded-2xl text-danger text-sm">
          {error}
        </div>
      )}

      {/* Amount hero */}
      <div className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-danger-dim/40 to-graphite-surface-2/60 px-5 pt-7 pb-6 text-center">
        <p className="text-[11px] uppercase tracking-[0.18em] text-ink-muted mb-4">
          {isPayment || isDebtPayment ? 'Payment amount' : 'Amount'}
        </p>
        <div className="flex items-baseline justify-center gap-1 money">
          <span className="text-2xl text-ink-muted font-medium">$</span>
          <input
            type="number"
            step="0.01"
            inputMode="decimal"
            {...register(isPayment || isDebtPayment ? 'payAmount' : 'amount')}
            placeholder="0.00"
            className="w-[min(100%,12rem)] bg-transparent text-center text-4xl sm:text-5xl font-semibold text-ink outline-none placeholder:text-ink-muted/35 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            autoFocus={!expense}
          />
        </div>
      </div>

      <Input label="Date" type="date" {...register('date')} error={errors.date?.message} />

      {/* Category picker */}
      <div>
        <label className="block text-sm font-medium text-ink-secondary mb-2">
          Category
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setValue('categoryId', PAYMENT_SENTINEL, { shouldValidate: true })}
            className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm border transition-all duration-200 ${
              isPayment
                ? 'bg-info-dim border-info/40 text-info'
                : 'bg-graphite-surface-2/70 border-graphite-border-subtle text-ink-secondary hover:border-graphite-border hover:text-ink'
            }`}
          >
            <Banknote size={15} />
            Payment
          </button>
          <button
            type="button"
            onClick={() =>
              setValue('categoryId', DEBT_PAYMENT_SENTINEL, { shouldValidate: true })
            }
            className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm border transition-all duration-200 ${
              isDebtPayment
                ? 'bg-mint-dim border-mint/40 text-mint'
                : 'bg-graphite-surface-2/70 border-graphite-border-subtle text-ink-secondary hover:border-graphite-border hover:text-ink'
            }`}
          >
            <CreditCard size={15} />
            Debt Payment
          </button>
          {regularCategories.map((c) => {
            const active = selectedCategoryId === c.id;
            const color = c.color || '#3dcea6';
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setValue('categoryId', c.id, { shouldValidate: true })}
                className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm border transition-all duration-200 ${
                  active
                    ? 'border-transparent text-ink shadow-sm'
                    : 'bg-graphite-surface-2/70 border-graphite-border-subtle text-ink-secondary hover:border-graphite-border hover:text-ink'
                }`}
                style={
                  active
                    ? {
                        backgroundColor: `${color}22`,
                        borderColor: `${color}55`,
                        boxShadow: `0 0 0 1px ${color}33`,
                      }
                    : undefined
                }
              >
                <span className="text-base leading-none">{c.icon || '📁'}</span>
                {c.name}
              </button>
            );
          })}
        </div>
        {errors.categoryId?.message && (
          <p className="mt-1.5 text-sm text-danger">{errors.categoryId.message}</p>
        )}
        {/* Hidden registered field for RHF */}
        <input type="hidden" {...register('categoryId')} />
      </div>

      {!isDebtPayment && !isPayment && availableSubcategories.length > 0 && (
        <div>
          <label className="block text-sm font-medium text-ink-secondary mb-2">
            Subcategory <span className="text-ink-muted font-normal">(optional)</span>
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setValue('subcategoryId', '')}
              className={`px-3 py-1.5 rounded-full text-sm border transition-all ${
                !selectedSubcategoryId
                  ? 'bg-graphite-surface border-mint/40 text-mint'
                  : 'border-graphite-border-subtle text-ink-muted hover:text-ink'
              }`}
            >
              None
            </button>
            {availableSubcategories.map((s) => {
              const active = selectedSubcategoryId === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setValue('subcategoryId', s.id)}
                  className={`px-3 py-1.5 rounded-full text-sm border transition-all ${
                    active
                      ? 'bg-mint-dim border-mint/40 text-mint'
                      : 'border-graphite-border-subtle text-ink-secondary hover:text-ink'
                  }`}
                >
                  {s.name}
                </button>
              );
            })}
          </div>
          <input type="hidden" {...register('subcategoryId')} />
        </div>
      )}

      {/* Payment modes */}
      {isPayment && (
        <div className="space-y-4 rounded-2xl border border-info/20 bg-info-dim/30 p-4">
          <div className="flex items-start gap-3">
            <Banknote size={18} className="text-info mt-0.5 shrink-0" />
            <p className="text-sm text-info leading-relaxed">
              Moves money from <strong>Pay From</strong> to <strong>Pay To</strong> without
              counting as spending.
            </p>
          </div>
          <Select
            label="Pay From"
            {...register('accountId')}
            options={[
              { value: '', label: 'Select account…' },
              ...fromAccountOptions.map((a) => ({ value: a.id, label: a.name })),
            ]}
          />
          <Select
            label="Pay To"
            {...register('toAccountId')}
            options={[
              { value: '', label: 'Select account…' },
              ...toAccountOptions.map((a) => ({ value: a.id, label: a.name })),
            ]}
          />
          {fromAccount && toAccount && payAmountVal && parseFloat(payAmountVal) > 0 && (
            <div className="flex items-center gap-3 p-3 bg-graphite-surface/80 border border-graphite-border-subtle rounded-xl text-sm">
              <div className="flex-1 text-center">
                <p className="text-ink-muted text-xs mb-1">{fromAccount.name}</p>
                <p className="text-danger font-medium money">
                  − ${parseFloat(payAmountVal).toFixed(2)}
                </p>
              </div>
              <ArrowRight size={16} className="text-ink-muted shrink-0" />
              <div className="flex-1 text-center">
                <p className="text-ink-muted text-xs mb-1">{toAccount.name}</p>
                <p className="text-mint font-medium money">
                  + ${parseFloat(payAmountVal).toFixed(2)}
                </p>
              </div>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-ink-secondary mb-1.5">
              Notes <span className="text-ink-muted font-normal">(optional)</span>
            </label>
            <textarea
              {...register('notes')}
              className="w-full px-3.5 py-2.5 border border-graphite-border bg-graphite-surface-2/80 text-ink rounded-xl focus:ring-2 focus:ring-mint/30 focus:border-mint/50 focus:outline-none transition-colors text-sm"
              rows={2}
              placeholder="e.g. Monthly transfer to savings"
            />
          </div>
        </div>
      )}

      {isDebtPayment && (
        <div className="space-y-4 rounded-2xl border border-mint/20 bg-mint-dim/30 p-4">
          <div className="flex items-start gap-3">
            <CreditCard size={18} className="text-mint mt-0.5 shrink-0" />
            <p className="text-sm text-mint leading-relaxed">
              Pays down a card or debt from another account.
            </p>
          </div>
          <Select
            label="Debt / Card to Pay"
            {...register('toAccountId')}
            options={[
              { value: '', label: 'Select account…' },
              ...toAccountOptions.map((a) => ({ value: a.id, label: a.name })),
            ]}
          />
          <Select
            label="Pay From Account"
            {...register('accountId')}
            options={[
              { value: '', label: 'Select account…' },
              ...fromAccountOptions.map((a) => ({ value: a.id, label: a.name })),
            ]}
          />
          {fromAccount && toAccount && payAmountVal && parseFloat(payAmountVal) > 0 && (
            <div className="flex items-center gap-3 p-3 bg-graphite-surface/80 border border-graphite-border-subtle rounded-xl text-sm">
              <div className="flex-1 text-center">
                <p className="text-ink-muted text-xs mb-1">{fromAccount.name}</p>
                <p className="text-danger font-medium money">
                  − ${parseFloat(payAmountVal).toFixed(2)}
                </p>
              </div>
              <ArrowRight size={16} className="text-ink-muted shrink-0" />
              <div className="flex-1 text-center">
                <p className="text-ink-muted text-xs mb-1">{toAccount.name}</p>
                <p className="text-mint font-medium money">
                  + ${parseFloat(payAmountVal).toFixed(2)}
                </p>
              </div>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-ink-secondary mb-1.5">
              Notes <span className="text-ink-muted font-normal">(optional)</span>
            </label>
            <textarea
              {...register('notes')}
              className="w-full px-3.5 py-2.5 border border-graphite-border bg-graphite-surface-2/80 text-ink rounded-xl focus:ring-2 focus:ring-mint/30 focus:border-mint/50 focus:outline-none transition-colors text-sm"
              rows={2}
              placeholder="e.g. Monthly minimum payment"
            />
          </div>
        </div>
      )}

      {/* Regular expense fields */}
      {!isDebtPayment && !isPayment && (
        <div className="space-y-4">
          <Select
            label="Account"
            {...register('accountId')}
            error={errors.accountId?.message}
            options={[
              { value: '', label: 'No account' },
              ...accounts.map((a) => ({ value: a.id, label: a.name })),
            ]}
          />

          <button
            type="button"
            onClick={() => setShowDetails((v) => !v)}
            className="flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink transition-colors"
          >
            {showDetails ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            {showDetails ? 'Hide details' : 'Merchant, notes & tags'}
          </button>

          {showDetails && (
            <div className="space-y-4 animate-fade-up">
              <Input
                label="Merchant"
                {...register('merchantOrSource')}
                error={errors.merchantOrSource?.message}
                placeholder="e.g. Walmart"
              />
              <div>
                <label className="block text-sm font-medium text-ink-secondary mb-1.5">
                  Notes
                </label>
                <textarea
                  {...register('notes')}
                  className="w-full px-3.5 py-2.5 border border-graphite-border bg-graphite-surface-2/80 text-ink rounded-xl focus:ring-2 focus:ring-mint/30 focus:border-mint/50 focus:outline-none transition-colors text-sm"
                  rows={3}
                  placeholder="Add notes…"
                />
              </div>
              <Input
                label="Tags"
                {...register('tags')}
                error={errors.tags?.message}
                placeholder="business, deductible"
              />
            </div>
          )}
        </div>
      )}

      {!hideActions && (
        <div className="flex flex-col sm:flex-row gap-3 pt-1">
          <Button type="submit" disabled={isSubmitting} className="flex-1 w-full">
            {isSubmitting
              ? 'Saving...'
              : isPayment
              ? 'Record Payment'
              : isDebtPayment
              ? 'Record Debt Payment'
              : expense
              ? 'Update Expense'
              : 'Add Expense'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={onCancel}
            className="flex-1 w-full"
          >
            Cancel
          </Button>
        </div>
      )}
    </form>
  );
}
