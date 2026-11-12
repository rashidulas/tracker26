'use client';

import { useState, useEffect } from 'react';
import Button from '@/components/Button';
import Input from '@/components/Input';
import Select from '@/components/Select';
import { createIncome, updateIncome } from './actions';
import { Plus, Trash2 } from 'lucide-react';
import { toDayString, todayInAppTimeZone } from '@/lib/dates';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { IncomeRow } from './incomeRows';

const incomeSchema = z.object({
  date: z.string().min(1, 'Date is required'),
  amount: z.string().min(1, 'Amount is required'),
  categoryId: z.string().min(1, 'Category is required'),
  subcategoryId: z.string().optional(),
  merchantOrSource: z.string().optional(),
  notes: z.string().optional(),
  tags: z.string().optional(),
});

type IncomeFormData = z.infer<typeof incomeSchema>;

type AccountSplit = { accountId: string; amount: string };

function cents(n: number) {
  return Math.round(n * 100);
}

export interface Category {
  id: string;
  name: string;
  subcategories?: Array<{ id: string; name: string }>;
}

export interface Account {
  id: string;
  name: string;
}

export default function IncomeForm({
  income,
  categories,
  accounts,
  onSuccess,
  onCancel,
}: {
  income?: IncomeRow;
  categories: Category[];
  accounts: Account[];
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [splits, setSplits] = useState<AccountSplit[]>(() => {
    if (income?.accounts?.length) {
      return income.accounts.map((a) => ({
        accountId: a.accountId,
        amount: a.amount.toString(),
      }));
    }
    return [{ accountId: '', amount: '' }];
  });

  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors },
  } = useForm<IncomeFormData>({
    resolver: zodResolver(incomeSchema),
    defaultValues: {
      date: income?.date
        ? toDayString(income.date)
        : todayInAppTimeZone(),
      amount: income?.amount.toString() || '',
      categoryId: income?.categoryId || '',
      subcategoryId: income?.subcategoryId || '',
      merchantOrSource: income?.merchantOrSource || '',
      notes: income?.notes || '',
      tags: income?.tags?.join(', ') || '',
    },
  });

  const selectedCategoryId = useWatch({ control, name: 'categoryId' });
  const selectedSubcategoryId = useWatch({ control, name: 'subcategoryId' });
  const totalAmountStr = useWatch({ control, name: 'amount' });
  const availableSubcategories =
    categories.find((c) => c.id === selectedCategoryId)?.subcategories || [];

  const totalAmount = parseFloat(totalAmountStr || '0') || 0;
  const isSplitMode = splits.length > 1;
  const splitSum = splits.reduce((sum, s) => sum + (parseFloat(s.amount) || 0), 0);
  const remaining = totalAmount - splitSum;
  const splitsMatch =
    totalAmount > 0 && cents(splitSum) === cents(totalAmount) && splits.every((s) => s.accountId);

  useEffect(() => {
    const subs =
      categories.find((c) => c.id === selectedCategoryId)?.subcategories || [];
    if (selectedSubcategoryId && !subs.some((s) => s.id === selectedSubcategoryId)) {
      setValue('subcategoryId', '');
    }
  }, [selectedCategoryId, selectedSubcategoryId, categories, setValue]);

  useEffect(() => {
    if (splits.length !== 1) return;
    setSplits((prev) => {
      if (prev.length !== 1) return prev;
      if (prev[0].amount === (totalAmountStr || '')) return prev;
      return [{ ...prev[0], amount: totalAmountStr || '' }];
    });
  }, [totalAmountStr, splits.length]);

  const updateSplit = (index: number, patch: Partial<AccountSplit>) => {
    setSplits((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  };

  const addSplit = () => {
    setSplits((prev) => {
      const next = [...prev];
      if (next.length === 1 && totalAmount > 0) {
        const firstAmt = parseFloat(next[0].amount) || 0;
        if (!next[0].amount || cents(firstAmt) === cents(totalAmount)) {
          const half = Math.floor(cents(totalAmount) / 2) / 100;
          const rest = (cents(totalAmount) - cents(half)) / 100;
          next[0] = { ...next[0], amount: half ? half.toFixed(2) : '' };
          next.push({ accountId: '', amount: rest ? rest.toFixed(2) : '' });
          return next;
        }
      }
      const used = next.reduce((sum, s) => sum + (parseFloat(s.amount) || 0), 0);
      const leftover = Math.max(0, totalAmount - used);
      next.push({
        accountId: '',
        amount: leftover > 0 ? leftover.toFixed(2) : '',
      });
      return next;
    });
  };

  const removeSplit = (index: number) => {
    setSplits((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((_, i) => i !== index);
      if (next.length === 1 && totalAmountStr) {
        return [{ ...next[0], amount: totalAmountStr }];
      }
      return next;
    });
  };

  const onSubmit = async (data: IncomeFormData) => {
    setIsSubmitting(true);
    setError('');

    const total = parseFloat(data.amount);
    if (!total || total <= 0) {
      setError('Amount must be positive');
      setIsSubmitting(false);
      return;
    }

    const prepared = isSplitMode
      ? splits
      : [{ accountId: splits[0]?.accountId || '', amount: data.amount }];

    if (prepared.some((s) => !s.accountId)) {
      setError('Select an account for each split');
      setIsSubmitting(false);
      return;
    }

    const accountIds = prepared.map((s) => s.accountId);
    if (new Set(accountIds).size !== accountIds.length) {
      setError('Each split must use a different account');
      setIsSubmitting(false);
      return;
    }

    const parsedSplits = prepared.map((s) => ({
      accountId: s.accountId,
      amount: parseFloat(s.amount),
    }));

    if (parsedSplits.some((s) => !s.amount || s.amount <= 0)) {
      setError('Each split amount must be positive');
      setIsSubmitting(false);
      return;
    }

    const sum = parsedSplits.reduce((acc, s) => acc + s.amount, 0);
    if (cents(sum) !== cents(total)) {
      setError(
        `Account amounts ($${sum.toFixed(2)}) must equal total ($${total.toFixed(2)})`
      );
      setIsSubmitting(false);
      return;
    }

    const formData = new FormData();
    formData.append('date', data.date);
    formData.append('amount', data.amount);
    formData.append('categoryId', data.categoryId);
    formData.append('subcategoryId', data.subcategoryId || '');
    formData.append('accountSplits', JSON.stringify(parsedSplits));
    formData.append('merchantOrSource', data.merchantOrSource || '');
    formData.append('notes', data.notes || '');
    formData.append('tags', data.tags || '');
    if (income?.memberIds?.length) {
      formData.append('memberIds', JSON.stringify(income.memberIds));
    }

    const result = income
      ? await updateIncome(income.id, formData)
      : await createIncome(formData);

    setIsSubmitting(false);

    if (result.success) {
      onSuccess();
    } else {
      setError(result.error || 'Something went wrong');
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-3 sm:space-y-4">
      {error && (
        <div className="p-3 bg-danger-dim border border-danger/25 rounded-xl text-danger text-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
        <Input
          label="Date"
          type="date"
          {...register('date')}
          error={errors.date?.message}
        />
        <Input
          label="Amount"
          type="number"
          step="0.01"
          {...register('amount')}
          error={errors.amount?.message}
          placeholder="0.00"
        />
      </div>

      <Select
        label="Category"
        {...register('categoryId')}
        error={errors.categoryId?.message}
        options={[
          { value: '', label: 'Select category...' },
          ...categories.map((c) => ({ value: c.id, label: c.name })),
        ]}
      />

      {availableSubcategories.length > 0 && (
        <Select
          label="Subcategory (Optional)"
          {...register('subcategoryId')}
          error={errors.subcategoryId?.message}
          options={[
            { value: '', label: 'None' },
            ...availableSubcategories.map((s) => ({ value: s.id, label: s.name })),
          ]}
        />
      )}

      <div>
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <label className="block text-sm font-medium text-ink-secondary">
            {isSplitMode ? 'Accounts' : 'Account'}
          </label>
          <button
            type="button"
            onClick={addSplit}
            disabled={splits.length >= accounts.length}
            className="inline-flex items-center gap-1 text-sm text-mint hover:text-mint/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            aria-label="Add account split"
            title="Split across another account"
          >
            <Plus size={16} />
            Split
          </button>
        </div>

        <div className="space-y-2">
          {splits.map((split, index) => {
            const usedElsewhere = new Set(
              splits.filter((_, i) => i !== index).map((s) => s.accountId).filter(Boolean)
            );
            return (
              <div key={index} className="flex gap-2 items-start">
                <div className="flex-1 min-w-0">
                  <Select
                    value={split.accountId}
                    onChange={(e) => updateSplit(index, { accountId: e.target.value })}
                    options={[
                      { value: '', label: 'Select account...' },
                      ...accounts
                        .filter((a) => a.id === split.accountId || !usedElsewhere.has(a.id))
                        .map((a) => ({ value: a.id, label: a.name })),
                    ]}
                  />
                </div>
                {isSplitMode && (
                  <div className="w-[7.5rem] shrink-0">
                    <Input
                      type="number"
                      step="0.01"
                      value={split.amount}
                      onChange={(e) => updateSplit(index, { amount: e.target.value })}
                      placeholder="0.00"
                      aria-label={`Amount for account ${index + 1}`}
                    />
                  </div>
                )}
                {isSplitMode && (
                  <button
                    type="button"
                    onClick={() => removeSplit(index)}
                    className="mt-0.5 p-2.5 rounded-xl text-ink-muted hover:text-danger hover:bg-danger-dim transition-colors shrink-0"
                    aria-label="Remove account split"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {isSplitMode && totalAmount > 0 && (
          <p
            className={`mt-2 text-xs ${
              splitsMatch ? 'text-mint' : Math.abs(remaining) < 0.005 ? 'text-ink-muted' : 'text-warning'
            }`}
          >
            {splitsMatch
              ? `Split totals $${splitSum.toFixed(2)}`
              : `$${Math.abs(remaining).toFixed(2)} ${remaining > 0 ? 'left to assign' : 'over total'}`}
          </p>
        )}
      </div>

      <Input
        label="Source (Optional)"
        {...register('merchantOrSource')}
        placeholder="e.g., Company XYZ"
      />

      <div>
        <label className="block text-sm font-medium text-ink-secondary mb-1.5">
          Notes (Optional)
        </label>
        <textarea
          {...register('notes')}
          className="w-full px-3 py-2 border border-graphite-border bg-graphite-surface-2/80 text-ink rounded-xl focus:ring-2 focus:ring-mint/30 focus:border-mint/50 focus:outline-none transition-colors"
          rows={3}
          placeholder="Add notes..."
        />
      </div>

      <Input
        label="Tags (Optional, comma-separated)"
        {...register('tags')}
        placeholder="e.g., bonus, consulting"
      />

      <div className="flex flex-col sm:flex-row gap-3 pt-2 sm:pt-4">
        <Button type="submit" disabled={isSubmitting} className="flex-1 w-full">
          {isSubmitting ? 'Saving...' : income ? 'Update Income' : 'Add Income'}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel} className="flex-1 w-full">
          Cancel
        </Button>
      </div>
    </form>
  );
}
