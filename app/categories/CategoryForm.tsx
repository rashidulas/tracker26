'use client';

import { useForm, Controller } from 'react-hook-form';
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

const COLOR_PRESETS = [
  '#3dcea6',
  '#5ee0b8',
  '#7aa2f7',
  '#bb9af7',
  '#f07178',
  '#e8a05a',
  '#e8c468',
  '#7dcfff',
  '#9aa1ad',
  '#c0caf5',
];

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
    control,
    watch,
    setValue,
    formState: { errors },
  } = useForm<CategoryFormData>({
    resolver: zodResolver(categorySchema),
    defaultValues: {
      name: category?.name || '',
      type: category?.type || 'EXPENSE',
      color: category?.color || '#3dcea6',
      icon: category?.icon || '📁',
    },
  });

  const selectedColor = watch('color') || '#3dcea6';
  const selectedIcon = watch('icon') || '📁';

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
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      {error && (
        <div className="p-3 bg-danger-dim border border-danger/25 rounded-2xl text-danger text-sm">
          {error}
        </div>
      )}

      <div className="flex items-center gap-3 p-3 rounded-xl bg-graphite-surface-2/70 border border-graphite-border-subtle">
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center text-xl border border-white/5"
          style={{ backgroundColor: `${selectedColor}22` }}
        >
          <span>{selectedIcon}</span>
        </div>
        <div className="min-w-0">
          <p className="text-xs text-ink-muted uppercase tracking-[0.12em]">Preview</p>
          <p className="text-sm text-ink truncate">
            {watch('name')?.trim() || 'New category'}
          </p>
        </div>
      </div>

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

      <Input
        label="Icon (Emoji)"
        {...register('icon')}
        error={errors.icon?.message}
        placeholder="📁"
        maxLength={4}
      />

      <div>
        <label className="block text-sm font-medium text-ink-secondary mb-2">Color</label>
        <Controller
          name="color"
          control={control}
          render={({ field }) => (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {COLOR_PRESETS.map((hex) => {
                  const active = field.value?.toLowerCase() === hex.toLowerCase();
                  return (
                    <button
                      key={hex}
                      type="button"
                      onClick={() => field.onChange(hex)}
                      className={`w-8 h-8 rounded-full transition-all duration-150 ${
                        active
                          ? 'ring-2 ring-mint ring-offset-2 ring-offset-graphite-surface scale-105'
                          : 'hover:scale-105 opacity-90 hover:opacity-100'
                      }`}
                      style={{ backgroundColor: hex }}
                      aria-label={`Select color ${hex}`}
                    />
                  );
                })}
              </div>
              <div className="flex items-center gap-3">
                <label className="relative w-12 h-10 rounded-xl overflow-hidden border border-graphite-border cursor-pointer shrink-0">
                  <span
                    className="absolute inset-0"
                    style={{ backgroundColor: field.value || '#3dcea6' }}
                  />
                  <input
                    type="color"
                    value={field.value || '#3dcea6'}
                    onChange={(e) => field.onChange(e.target.value)}
                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                    aria-label="Custom color"
                  />
                </label>
                <input
                  type="text"
                  value={field.value || ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (/^#[0-9a-fA-F]{0,6}$/.test(v) || v === '') {
                      field.onChange(v);
                    }
                  }}
                  onBlur={() => {
                    if (!field.value || !/^#[0-9a-fA-F]{6}$/.test(field.value)) {
                      setValue('color', '#3dcea6');
                    }
                  }}
                  className="flex-1 px-3.5 py-2.5 border border-graphite-border rounded-xl text-sm text-ink bg-graphite-surface-2/80 font-mono placeholder-ink-muted focus:ring-2 focus:ring-mint/30 focus:border-mint/50 focus:outline-none"
                  placeholder="#3dcea6"
                  spellCheck={false}
                />
              </div>
            </div>
          )}
        />
        {errors.color?.message && (
          <p className="mt-1.5 text-sm text-danger">{errors.color.message}</p>
        )}
      </div>

      <div className="flex gap-3 pt-2">
        <Button type="button" variant="secondary" onClick={onCancel} className="flex-1">
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting} className="flex-1">
          {isSubmitting ? 'Saving...' : category ? 'Update' : 'Create'}
        </Button>
      </div>
    </form>
  );
}
