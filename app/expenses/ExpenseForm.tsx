'use client';

import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod';
import Input from '@/components/Input';
import Select from '@/components/Select';
import Button from '@/components/Button';
import { createExpense, updateExpense, createDebtPaymentTransfer, createPaymentTransfer } from './actions';
import { useState } from 'react';
import { formatDateForInput, getLocalTodayForInput } from '@/lib/utils';
import { CreditCard, ArrowRight, Banknote } from 'lucide-react';

const expenseSchema = z.object({
  date: z.string().min(1, 'Date is required'),
  amount: z.string().min(1, 'Amount is required'),
  categoryId: z.string().min(1, 'Category is required'),
  accountId: z.string().optional(),
  merchantOrSource: z.string().optional(),
  notes: z.string().optional(),
  tags: z.string().optional(),
  // debt payment extras
  toAccountId: z.string().optional(),   // credit card account (the one being paid)
  payAmount: z.string().optional(),     // payment amount (separate from expense amount)
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
  accounts: Array<{ id: string; name: string; type?: string }>;
  debts: Array<{ id: string; name: string; currentBalance: number }>; // kept for compatibility, unused in this mode
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
    control,
    formState: { errors },
  } = useForm<ExpenseFormData>({
    resolver: zodResolver(expenseSchema),
    defaultValues: {
      date: expense?.date ? formatDateForInput(expense.date) : getLocalTodayForInput(),
      amount: expense?.amount.toString() || '',
      categoryId: expense?.categoryId || '',
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

  const DEBT_PAYMENT_SENTINEL = '__DEBT_PAYMENT__';
  const PAYMENT_SENTINEL = '__PAYMENT__';
  const isDebtPayment = selectedCategoryId === DEBT_PAYMENT_SENTINEL;
  const isPayment = selectedCategoryId === PAYMENT_SENTINEL;

  const fromAccount = accounts.find((a) => a.id === selectedFromAccountId);
  const toAccount = accounts.find((a) => a.id === selectedToAccountId);

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
        if (result.success) {
          onSuccess();
        } else {
          setError(result.error || 'Failed to record payment');
        }
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
        if (result.success) {
          onSuccess();
        } else {
          setError(result.error || 'Failed to record payment');
        }
      } else {
        // Regular expense
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

        if (result.success) {
          onSuccess();
        } else {
          setError(result.error || 'Something went wrong');
        }
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Accounts that can be paid TO (credit card / debt accounts — exclude the from account)
  const toAccountOptions = accounts.filter((a) => a.id !== selectedFromAccountId);
  // Accounts that can pay FROM (exclude the to account)
  const fromAccountOptions = accounts.filter((a) => a.id !== selectedToAccountId);

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-3 sm:space-y-4">
      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Date — always shown */}
      <Input
        label="Date"
        type="date"
        {...register('date')}
        error={errors.date?.message}
      />

      {/* Category — always shown */}
      <Select
        label="Category"
        {...register('categoryId')}
        error={errors.categoryId?.message}
        options={[
          { value: '', label: 'Select category...' },
          { value: '__PAYMENT__', label: '💸 Payment' },
          { value: '__DEBT_PAYMENT__', label: '💳 Debt Payment' },
          ...categories
            .filter((c) => c.name !== 'Debt Payment' && c.name !== 'Payment')
            .map((c) => ({ value: c.id, label: c.name })),
        ]}
      />

      {/* ── PAYMENT MODE ─────────────────────────────────── */}
      {isPayment && (
        <>
          <div className="flex items-start gap-3 p-3 bg-blue-500/10 border border-blue-500/25 rounded-xl">
            <Banknote size={18} className="text-blue-400 mt-0.5 shrink-0" />
            <p className="text-sm text-blue-300">
              Money will be deducted from <strong>Pay From</strong> and added to <strong>Pay To</strong>.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1">
              Pay From <span className="text-red-400">*</span>
            </label>
            <select
              {...register('accountId')}
              className="w-full px-3 py-2 border border-zinc-700 bg-zinc-800/50 text-zinc-100 rounded-lg focus:ring-2 focus:ring-blue-500/40 focus:outline-none"
            >
              <option value="">Select account...</option>
              {fromAccountOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1">
              Pay To <span className="text-red-400">*</span>
            </label>
            <select
              {...register('toAccountId')}
              className="w-full px-3 py-2 border border-zinc-700 bg-zinc-800/50 text-zinc-100 rounded-lg focus:ring-2 focus:ring-blue-500/40 focus:outline-none"
            >
              <option value="">Select account...</option>
              {toAccountOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>

          <Input
            label="Amount *"
            type="number"
            step="0.01"
            {...register('payAmount')}
            placeholder="0.00"
          />

          {fromAccount && toAccount && payAmountVal && parseFloat(payAmountVal) > 0 && (
            <div className="flex items-center gap-3 p-3 bg-zinc-800/60 border border-zinc-700/50 rounded-xl text-sm">
              <div className="flex-1 text-center">
                <p className="text-zinc-500 text-xs mb-1">{fromAccount.name}</p>
                <p className="text-red-400 font-medium">
                  − ${parseFloat(payAmountVal).toFixed(2)}
                </p>
              </div>
              <ArrowRight size={16} className="text-zinc-500 shrink-0" />
              <div className="flex-1 text-center">
                <p className="text-zinc-500 text-xs mb-1">{toAccount.name}</p>
                <p className="text-emerald-400 font-medium">
                  + ${parseFloat(payAmountVal).toFixed(2)}
                </p>
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1">
              Notes (Optional)
            </label>
            <textarea
              {...register('notes')}
              className="w-full px-3 py-2 border border-zinc-700 bg-zinc-800/50 text-zinc-100 rounded-lg focus:ring-2 focus:ring-blue-500/40 focus:outline-none"
              rows={2}
              placeholder="e.g., Monthly transfer to savings"
            />
          </div>
        </>
      )}

      {/* ── DEBT PAYMENT MODE ─────────────────────────────── */}
      {isDebtPayment && (
        <>
          {/* Info banner */}
          <div className="flex items-start gap-3 p-3 bg-violet-500/10 border border-violet-500/25 rounded-xl">
            <CreditCard size={18} className="text-violet-400 mt-0.5 shrink-0" />
            <p className="text-sm text-violet-300">
              Money will be deducted from <strong>Pay From Account</strong> and
              credited to the <strong>Debt / Card</strong> account.
            </p>
          </div>

          {/* Debt/Card to Pay — from accounts */}
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1">
              Debt / Card to Pay <span className="text-red-400">*</span>
            </label>
            <select
              {...register('toAccountId')}
              className="w-full px-3 py-2 border border-zinc-700 bg-zinc-800/50 text-zinc-100 rounded-lg focus:ring-2 focus:ring-violet-500/40 focus:outline-none"
            >
              <option value="">Select account...</option>
              {toAccountOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>

          {/* Pay From Account — from accounts */}
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1">
              Pay From Account <span className="text-red-400">*</span>
            </label>
            <select
              {...register('accountId')}
              className="w-full px-3 py-2 border border-zinc-700 bg-zinc-800/50 text-zinc-100 rounded-lg focus:ring-2 focus:ring-violet-500/40 focus:outline-none"
            >
              <option value="">Select account...</option>
              {fromAccountOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>

          {/* Payment Amount */}
          <Input
            label="Amount Paid *"
            type="number"
            step="0.01"
            {...register('payAmount')}
            placeholder="0.00"
          />

          {/* Live preview */}
          {fromAccount && toAccount && payAmountVal && parseFloat(payAmountVal) > 0 && (
            <div className="flex items-center gap-3 p-3 bg-zinc-800/60 border border-zinc-700/50 rounded-xl text-sm">
              <div className="flex-1 text-center">
                <p className="text-zinc-500 text-xs mb-1">{fromAccount.name}</p>
                <p className="text-red-400 font-medium">
                  − ${parseFloat(payAmountVal).toFixed(2)}
                </p>
              </div>
              <ArrowRight size={16} className="text-zinc-500 shrink-0" />
              <div className="flex-1 text-center">
                <p className="text-zinc-500 text-xs mb-1">{toAccount.name}</p>
                <p className="text-emerald-400 font-medium">
                  + ${parseFloat(payAmountVal).toFixed(2)}
                </p>
              </div>
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1">
              Notes (Optional)
            </label>
            <textarea
              {...register('notes')}
              className="w-full px-3 py-2 border border-zinc-700 bg-zinc-800/50 text-zinc-100 rounded-lg focus:ring-2 focus:ring-violet-500/40 focus:outline-none"
              rows={2}
              placeholder="e.g., Monthly minimum payment"
            />
          </div>
        </>
      )}

      {/* ── REGULAR EXPENSE FIELDS ──────────────────────────── */}
      {!isDebtPayment && !isPayment && (
        <>
          <Input
            label="Amount"
            type="number"
            step="0.01"
            {...register('amount')}
            error={errors.amount?.message}
            placeholder="0.00"
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
        </>
      )}

      <div className="flex flex-col sm:flex-row gap-3 pt-2 sm:pt-4">
        <Button type="submit" disabled={isSubmitting} className="flex-1 w-full">
          {isSubmitting
            ? 'Saving...'
            : isPayment
            ? '💸 Record Payment'
            : isDebtPayment
            ? '💳 Record Debt Payment'
            : expense
            ? 'Update Expense'
            : 'Add Expense'}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel} className="flex-1 w-full">
          Cancel
        </Button>
      </div>
    </form>
  );
}
