'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Input from '@/components/Input';
import Select from '@/components/Select';
import Button from '@/components/Button';
import { createCategory, updateCategory } from './actions';
import { useState } from 'react';

const categorySchema = z.object({
  name: z.string().min(1, 'Name is required'),
  type: z.enum(['INCOME', 'EXPENSE']),
  color: z.string().optional(),
  icon: z.string().optional(),
});

type CategoryFormData = z.infer<typeof categorySchema>;

interface CategoryFormProps {
  category?: {
    id: string;
    name: string;
    type: 'INCOME' | 'EXPENSE';
    color?: string | null;
    icon?: string | null;
  };
  onSuccess: () => void;
  onCancel: () => void;
}

export default function CategoryForm({ category, onSuccess, onCancel }: CategoryFormProps) {
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CategoryFormData>({
    resolver: zodResolver(categorySchema),
    defaultValues: {
      name: category?.name || '',
      type: category?.type || 'EXPENSE',
      color: category?.color || '#3b82f6',
      icon: category?.icon || '📁',
    },
  });

  const onSubmit = async (data: CategoryFormData) => {
    setIsSubmitting(true);
    setError('');

    const formData = new FormData();
    formData.append('name', data.name);
    formData.append('type', data.type);
    if (data.color) formData.append('color', data.color);
    if (data.icon) formData.append('icon', data.icon);

    const result = category
      ? await updateCategory(category.id, formData)
      : await createCategory(formData);

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
        label="Category Name"
        {...register('name')}
        error={errors.name?.message}
        placeholder="e.g., Groceries"
      />

      <Select
        label="Type"
        {...register('type')}
        error={errors.type?.message}
        options={[
          { value: 'INCOME', label: 'Income' },
          { value: 'EXPENSE', label: 'Expense' },
        ]}
      />

      <div className="grid grid-cols-2 gap-4">
        <Input
          label="Icon (Emoji)"
          {...register('icon')}
          error={errors.icon?.message}
          placeholder="📁"
        />

        <Input
          label="Color"
          type="color"
          {...register('color')}
          error={errors.color?.message}
        />
      </div>

      <div className="flex gap-3 pt-4">
        <Button type="submit" disabled={isSubmitting} className="flex-1">
          {isSubmitting ? 'Saving...' : category ? 'Update' : 'Create'}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
