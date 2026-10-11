'use client';

import { useForm, Controller, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Input from '@/components/Input';
import Button from '@/components/Button';
import { createCategory, updateCategory } from './actions';
import { useState, KeyboardEvent, useEffect } from 'react';
import { Plus, Trash2, ArrowDownLeft, ArrowUpRight } from 'lucide-react';

const categorySchema = z.object({
  name: z.string().min(1, 'Name is required'),
  type: z.enum(['INCOME', 'EXPENSE']),
  color: z.string().optional(),
  icon: z.string().optional(),
  subcategories: z.array(
    z.object({
      name: z.string(),
    })
  ),
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

const ICON_PRESETS = ['📁', '🚗', '🛒', '🍽️', '🏠', '💡', '✈️', '💼', '🎬', '🏥', '🛍️', '💰'];

interface CategoryFormProps {
  category?: {
    id: string;
    name: string;
    type: 'INCOME' | 'EXPENSE';
    color?: string | null;
    icon?: string | null;
    subcategories?: Array<{ id: string; name: string }>;
  };
  onSuccess: () => void;
  onCancel: () => void;
  hideActions?: boolean;
  onSubmittingChange?: (submitting: boolean) => void;
  formId?: string;
}

export default function CategoryForm({
  category,
  onSuccess,
  onCancel,
  hideActions = false,
  onSubmittingChange,
  formId = 'category-form',
}: CategoryFormProps) {
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [subDraft, setSubDraft] = useState('');

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
      subcategories:
        category?.subcategories?.map((s) => ({ name: s.name })) || [],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: 'subcategories',
  });

  const selectedColor = watch('color') || '#3dcea6';
  const selectedIcon = watch('icon') || '📁';
  const selectedType = watch('type');
  const nameValue = watch('name');
  const filledSubs = fields.filter((f) => f.name.trim()).length;

  useEffect(() => {
    onSubmittingChange?.(isSubmitting);
  }, [isSubmitting, onSubmittingChange]);

  const addSubcategory = () => {
    const name = subDraft.trim();
    if (!name) return;
    const exists = fields.some(
      (f) => f.name.trim().toLowerCase() === name.toLowerCase()
    );
    if (!exists) append({ name });
    setSubDraft('');
  };

  const onSubKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addSubcategory();
    }
  };

  const onSubmit = async (data: CategoryFormData) => {
    setIsSubmitting(true);
    setError('');

    const formData = new FormData();
    formData.append('name', data.name);
    formData.append('type', data.type);
    if (data.color) formData.append('color', data.color);
    if (data.icon) formData.append('icon', data.icon);

    const subcategoryNames = data.subcategories
      .map((s) => s.name.trim())
      .filter(Boolean);

    for (const name of subcategoryNames) {
      formData.append('subcategories', name);
    }

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
    <form id={formId} onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {error && (
        <div className="p-3 bg-danger-dim border border-danger/25 rounded-2xl text-danger text-sm">
          {error}
        </div>
      )}

      <div
        className="relative overflow-hidden rounded-2xl border border-white/[0.06] p-5"
        style={{
          background: `linear-gradient(135deg, ${selectedColor}18 0%, transparent 55%), var(--surface-2)`,
        }}
      >
        <div className="flex items-center gap-4">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl border border-white/10 shadow-lg"
            style={{ backgroundColor: `${selectedColor}28` }}
          >
            {selectedIcon}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] uppercase tracking-[0.16em] text-ink-muted mb-1">
              Preview
            </p>
            <p className="text-lg font-semibold text-ink font-display truncate">
              {nameValue?.trim() || 'New category'}
            </p>
            <p className="text-xs text-ink-secondary mt-0.5">
              {selectedType === 'INCOME' ? 'Income' : 'Expense'}
              {filledSubs > 0 && ` · ${filledSubs} subcategor${filledSubs === 1 ? 'y' : 'ies'}`}
            </p>
          </div>
        </div>
      </div>

      <Input
        label="Name"
        {...register('name')}
        error={errors.name?.message}
        placeholder="e.g. Car, Groceries, Salary"
        autoFocus={!category}
      />

      <div>
        <label className="block text-sm font-medium text-ink-secondary mb-2">Type</label>
        <Controller
          name="type"
          control={control}
          render={({ field }) => (
            <div className="grid grid-cols-2 gap-2 p-1 rounded-2xl bg-graphite-surface-2/80 border border-graphite-border-subtle">
              {(
                [
                  { value: 'EXPENSE', label: 'Expense', Icon: ArrowDownLeft },
                  { value: 'INCOME', label: 'Income', Icon: ArrowUpRight },
                ] as const
              ).map(({ value, label, Icon }) => {
                const active = field.value === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => field.onChange(value)}
                    className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
                      active
                        ? value === 'INCOME'
                          ? 'bg-mint-dim text-mint shadow-sm'
                          : 'bg-danger-dim text-danger shadow-sm'
                        : 'text-ink-muted hover:text-ink'
                    }`}
                  >
                    <Icon size={15} />
                    {label}
                  </button>
                );
              })}
            </div>
          )}
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-ink-secondary mb-2">Icon</label>
        <div className="flex flex-wrap gap-2 mb-3">
          {ICON_PRESETS.map((emoji) => {
            const active = selectedIcon === emoji;
            return (
              <button
                key={emoji}
                type="button"
                onClick={() => setValue('icon', emoji)}
                className={`w-10 h-10 rounded-xl text-lg flex items-center justify-center transition-all duration-150 ${
                  active
                    ? 'bg-mint-dim ring-2 ring-mint/50 scale-105'
                    : 'bg-graphite-surface-2/80 border border-graphite-border-subtle hover:border-graphite-border hover:bg-graphite-surface-hover'
                }`}
                aria-label={`Icon ${emoji}`}
              >
                {emoji}
              </button>
            );
          })}
        </div>
        <Input
          {...register('icon')}
          error={errors.icon?.message}
          placeholder="Or type any emoji"
          maxLength={4}
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-ink-secondary mb-2">Color</label>
        <Controller
          name="color"
          control={control}
          render={({ field }) => (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2.5">
                {COLOR_PRESETS.map((hex) => {
                  const active = field.value?.toLowerCase() === hex.toLowerCase();
                  return (
                    <button
                      key={hex}
                      type="button"
                      onClick={() => field.onChange(hex)}
                      className={`w-8 h-8 rounded-full transition-all duration-150 ${
                        active
                          ? 'ring-2 ring-offset-2 ring-offset-graphite-surface scale-110'
                          : 'hover:scale-110 opacity-85 hover:opacity-100'
                      }`}
                      style={{
                        backgroundColor: hex,
                        ...(active ? { ['--tw-ring-color' as string]: hex } : {}),
                      }}
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
      </div>

      <div>
        <div className="mb-2">
          <label className="block text-sm font-medium text-ink-secondary">
            Subcategories
          </label>
          <p className="text-xs text-ink-muted mt-0.5">
            Optional — press Enter to add (Fuel, Maintenance…)
          </p>
        </div>

        <div className="rounded-2xl border border-graphite-border-subtle bg-graphite-surface-2/50 p-3 space-y-3">
          {fields.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {fields.map((field, index) => (
                <span
                  key={field.id}
                  className="inline-flex items-center gap-1.5 pl-3 pr-1.5 py-1 rounded-full text-sm text-ink bg-graphite-surface border border-graphite-border"
                >
                  {field.name || '…'}
                  <button
                    type="button"
                    onClick={() => remove(index)}
                    className="p-1 rounded-full text-ink-muted hover:text-danger hover:bg-danger-dim transition-colors"
                    aria-label={`Remove ${field.name}`}
                  >
                    <Trash2 size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <input
              value={subDraft}
              onChange={(e) => setSubDraft(e.target.value)}
              onKeyDown={onSubKeyDown}
              className="flex-1 px-3.5 py-2.5 border border-graphite-border rounded-xl text-sm text-ink bg-graphite-surface placeholder-ink-muted focus:ring-2 focus:ring-mint/30 focus:border-mint/50 focus:outline-none"
              placeholder="Add a subcategory…"
            />
            <Button
              type="button"
              variant="secondary"
              onClick={addSubcategory}
              disabled={!subDraft.trim()}
            >
              <Plus size={16} />
              Add
            </Button>
          </div>
        </div>
      </div>

      {!hideActions && (
        <div className="flex gap-3 pt-1">
          <Button type="button" variant="secondary" onClick={onCancel} className="flex-1">
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting} className="flex-1">
            {isSubmitting ? 'Saving...' : category ? 'Save changes' : 'Create category'}
          </Button>
        </div>
      )}
    </form>
  );
}
