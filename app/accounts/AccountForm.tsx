'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Input from '@/components/Input';
import Select from '@/components/Select';
import Button from '@/components/Button';
import { createAccount, updateAccount } from './actions';
import { useState } from 'react';

const accountSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  type: z.enum(['CHECKING', 'SAVINGS', 'CASH', 'CREDIT_CARD', 'INVESTMENT']),
  institution: z.string().optional(),
  startingBalance: z.string().min(1, 'Starting balance is required'),
});

type AccountFormData = z.infer<typeof accountSchema>;

interface AccountFormProps {
  account?: {
    id: string;
    name: string;
    type: 'CHECKING' | 'SAVINGS' | 'CASH' | 'CREDIT_CARD' | 'INVESTMENT';
    institution?: string | null;
    startingBalance: number;
  };
  onSuccess: () => void;
  onCancel: () => void;
}

export default function AccountForm({ account, onSuccess, onCancel }: AccountFormProps) {
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<AccountFormData>({
    resolver: zodResolver(accountSchema),
    defaultValues: {
      name: account?.name || '',
      type: account?.type || 'CHECKING',
      institution: account?.institution || '',
      startingBalance: account?.startingBalance.toString() || '0',
    },
  });

  const onSubmit = async (data: AccountFormData) => {
    setIsSubmitting(true);
    setError('');

    const formData = new FormData();
    formData.append('name', data.name);
    formData.append('type', data.type);
    formData.append('institution', data.institution || '');
    formData.append('startingBalance', data.startingBalance);

    const result = account
      ? await updateAccount(account.id, formData)
      : await createAccount(formData);

    setIsSubmitting(false);

    if (result.success) {
      onSuccess();
    } else {
      setError(result.error || 'Something went wrong');
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-400 text-sm">
          {error}
        </div>
      )}

      <Input
        label="Account Name"
        {...register('name')}
        error={errors.name?.message}
        placeholder="e.g., Main Checking"
      />

      <Select
        label="Account Type"
        {...register('type')}
        error={errors.type?.message}
        options={[
          { value: 'CHECKING', label: 'Checking' },
          { value: 'SAVINGS', label: 'Savings' },
          { value: 'CASH', label: 'Cash' },
          { value: 'CREDIT_CARD', label: 'Credit Card' },
          { value: 'INVESTMENT', label: 'Investment' },
        ]}
      />

      <Input
        label="Institution (Optional)"
        {...register('institution')}
        error={errors.institution?.message}
        placeholder="e.g., Chase Bank"
      />

      <Input
        label="Starting Balance"
        type="number"
        step="0.01"
        {...register('startingBalance')}
        error={errors.startingBalance?.message}
        placeholder="0.00"
      />

      <div className="flex gap-3 pt-4">
        <Button type="submit" disabled={isSubmitting} className="flex-1">
          {isSubmitting ? 'Saving...' : account ? 'Update' : 'Create'}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
