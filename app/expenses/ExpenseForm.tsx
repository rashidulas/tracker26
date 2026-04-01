'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Input from '@/components/Input';
import Select from '@/components/Select';
import Button from '@/components/Button';
import { createExpense, updateExpense } from './actions';
import { useState } from 'react';

const expenseSchema = z.object({
  date: z.string().min(1, 'Date is required'),
  amount: z.string().min(1, 'Amount is required'),
  categoryId: z.string().min(1, 'Category is required'),
  accountId: z.string().optional(),
  merchantOrSource: z.string().optional(),
  notes: z.string().optional(),
  tags: z.string().optional(),
});

type ExpenseFormData = z.infer<typeof expenseSchema>;

interface ExpenseFormProps {
  expense?: {
    id: string;
    date: Date;
    amount: number;
    categoryId: string | null;
    accountId: string | null;
    merchantOrSource?: string | null;
    notes?: string | null;
    tags: string[];
  };
  categories: Array<{ id: string; name: string }>;
  accounts: Array<{ id: string; name: string }>;
  onSuccess: () => void;
  onCancel: () => void;
}

export default function ExpenseForm({
  expense,
  categories,
  accounts,
  onSuccess,
  onCancel,
}: ExpenseFormProps) {
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ExpenseFormData>({
    resolver: zodResolver(expenseSchema),
    defaultValues: {
      date: expense?.date
        ? new Date(expense.date).toISOString().split('T')[0]
        : new Date().toISOString().split('T')[0],
      amount: expense?.amount.toString() || '',
      categoryId: expense?.categoryId || '',
      accountId: expense?.accountId || '',
      merchantOrSource: expense?.merchantOrSource || '',
      notes: expense?.notes || '',
      tags: expense?.tags?.join(', ') || '',
    },
  });

  const onSubmit = async (data: ExpenseFormData) => {
    setIsSubmitting(true);
    setError('');

    const formData = new FormData();
    formData.append('date', data.date);
    formData.append('amount', data.amount);
    formData.append('categoryId', data.categoryId);
    formData.append('accountId', data.accountId || '');
    formData.append('merchantOrSource', data.merchantOrSource || '');
    formData.append('notes', data.notes || '');
    formData.append('tags', data.tags || '');

    const result = expense
      ? await updateExpense(expense.id, formData)
      : await createExpense(formData);

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
        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
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

      <Select
        label="Account (Optional)"
        {...register('accountId')}
        error={errors.accountId?.message}
        options={[
          { value: '', label: 'No account' },
          ...accounts.map((a) => ({ value: a.id, label: a.name })),
        ]}
      />

      <Input
        label="Merchant (Optional)"
        {...register('merchantOrSource')}
        error={errors.merchantOrSource?.message}
        placeholder="e.g., Walmart"
      />

      <div>
        <label className="block text-sm font-medium text-zinc-400 mb-1">
          Notes (Optional)
        </label>
        <textarea
          {...register('notes')}
          className="w-full px-3 py-2 border border-zinc-700 bg-zinc-800/50 text-zinc-100 rounded-lg focus:ring-2 focus:ring-emerald-500/40 focus:outline-none"
          rows={3}
          placeholder="Add notes..."
        />
      </div>

      <Input
        label="Tags (Optional, comma-separated)"
        {...register('tags')}
        error={errors.tags?.message}
        placeholder="e.g., business, deductible"
      />

      <div className="flex flex-col sm:flex-row gap-3 pt-2 sm:pt-4">
        <Button type="submit" disabled={isSubmitting} className="flex-1 w-full">
          {isSubmitting ? 'Saving...' : expense ? 'Update Expense' : 'Add Expense'}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel} className="flex-1 w-full">
          Cancel
        </Button>
      </div>
    </form>
  );
}
