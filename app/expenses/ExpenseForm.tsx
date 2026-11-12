'use client';

import { useForm, useWatch, type FieldErrors } from 'react-hook-form';
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
import { createCategory } from '@/app/categories/actions';
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { addDays, toDayString, todayInAppTimeZone } from '@/lib/dates';
import { useToast } from '@/components/ToastProvider';
import { loadExpensePrefs, rememberExpense } from '@/lib/expensePrefs';
import type { ExpenseRow } from '@/lib/expenseEvents';
import {
  CreditCard,
  ArrowRight,
  Banknote,
  ChevronDown,
  ChevronUp,
  Plus,
  Store,
} from 'lucide-react';

const DEBT_PAYMENT_SENTINEL = '__DEBT_PAYMENT__';
const PAYMENT_SENTINEL = '__PAYMENT__';

function checkAmount(raw: string | undefined): string | null {
  if (!raw || !raw.trim()) return 'Enter an amount';
  const n = Number(raw);
  if (!Number.isFinite(n)) return 'Enter a valid number';
  if (n <= 0) return 'Amount must be greater than 0';
  return null;
}

// Every rule lives in one superRefine so all field errors show at once.
const expenseSchema = z
  .object({
    date: z.string(),
    amount: z.string().optional(),
    categoryId: z.string(),
    subcategoryId: z.string().optional(),
    accountId: z.string().optional(),
    merchantOrSource: z.string().optional(),
    notes: z.string().optional(),
    tags: z.string().optional(),
    toAccountId: z.string().optional(),
    payAmount: z.string().optional(),
  })
  .superRefine((d, ctx) => {
    const transfer = d.categoryId === PAYMENT_SENTINEL || d.categoryId === DEBT_PAYMENT_SENTINEL;
    const amountError = checkAmount(transfer ? d.payAmount : d.amount);
    if (amountError) {
      ctx.addIssue({ code: 'custom', path: [transfer ? 'payAmount' : 'amount'], message: amountError });
    }
    if (!d.date) ctx.addIssue({ code: 'custom', path: ['date'], message: 'Pick a date' });
    if (!d.categoryId) {
      ctx.addIssue({ code: 'custom', path: ['categoryId'], message: 'Pick a category' });
    }
    if (transfer) {
      if (!d.accountId) {
        ctx.addIssue({ code: 'custom', path: ['accountId'], message: 'Choose the account to pay from' });
      }
      if (!d.toAccountId) {
        ctx.addIssue({
          code: 'custom',
          path: ['toAccountId'],
          message:
            d.categoryId === DEBT_PAYMENT_SENTINEL
              ? 'Choose the card or debt to pay'
              : 'Choose the account to pay to',
        });
      }
    }
  });

type ExpenseFormData = z.infer<typeof expenseSchema>;

export type SubmitIntent = 'save' | 'another';

export interface MerchantSuggestion {
  name: string;
  categoryId: string | null;
  subcategoryId: string | null;
  accountId: string | null;
}

export interface ExpenseSaveResult {
  row: ExpenseRow | null;
  mode: 'expense' | 'payment' | 'debt';
  isEdit: boolean;
  intent: SubmitIntent;
}

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
  /** Past merchants from the server, most recent first. */
  merchants?: MerchantSuggestion[];
  /** Server-side fallbacks for when nothing is remembered locally. */
  serverAccountByCategory?: Record<string, string>;
  serverLastAccountId?: string | null;
  onSuccess: (result: ExpenseSaveResult) => void;
  onCancel: () => void;
  hideActions?: boolean;
  onSubmittingChange?: (submitting: boolean) => void;
  formId?: string;
  /** Set by the footer buttons just before submit ("Save" vs "Save & add another"). */
  submitIntentRef?: MutableRefObject<SubmitIntent>;
}

const QUICK_COLORS = [
  '#3dcea6',
  '#7aa2f7',
  '#bb9af7',
  '#f07178',
  '#e8a05a',
  '#e8c468',
  '#7dcfff',
  '#9aa1ad',
];

const QUICK_ICONS = ['📁', '🚗', '🛒', '🍽️', '🏠', '💡', '✈️', '💼', '🎬', '🏥', '🛍️', '💰'];

type CategoryOption = ExpenseFormProps['categories'][number];

function localYesterdayForInput() {
  return addDays(todayInAppTimeZone(), -1);
}

export default function ExpenseForm({
  expense,
  categories,
  accounts,
  merchants = [],
  serverAccountByCategory = {},
  serverLastAccountId = null,
  onSuccess,
  onCancel,
  hideActions = false,
  onSubmittingChange,
  formId = 'expense-form',
  submitIntentRef,
}: ExpenseFormProps) {
  const toast = useToast();
  const [prefs] = useState(() => loadExpensePrefs());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [localCategories, setLocalCategories] = useState<CategoryOption[]>(categories);
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryIcon, setNewCategoryIcon] = useState('📁');
  const [newCategoryColor, setNewCategoryColor] = useState('#3dcea6');
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [categoryCreateError, setCategoryCreateError] = useState('');
  const [showDetails, setShowDetails] = useState(
    Boolean(expense?.notes || expense?.tags?.length)
  );
  const [merchantFocused, setMerchantFocused] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  // Once the user picks an account themselves, smart defaults stop touching it.
  const accountTouched = useRef(Boolean(expense));
  const amountRef = useRef<HTMLInputElement | null>(null);

  const accountExists = (id: string | null | undefined): id is string =>
    Boolean(id && accounts.some((a) => a.id === id));

  const initialAccountId = (() => {
    if (expense) return expense.accountId || '';
    if (accountExists(prefs.lastAccountId)) return prefs.lastAccountId;
    if (accountExists(serverLastAccountId)) return serverLastAccountId;
    return '';
  })();

  const {
    register,
    handleSubmit,
    control,
    setValue,
    getValues,
    reset,
    formState: { errors },
  } = useForm<ExpenseFormData>({
    resolver: zodResolver(expenseSchema),
    defaultValues: {
      date: expense?.date ? toDayString(expense.date) : todayInAppTimeZone(),
      amount: expense?.amount.toString() || '',
      categoryId: expense?.categoryId || '',
      subcategoryId: expense?.subcategoryId || '',
      accountId: initialAccountId,
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
  const selectedDate = useWatch({ control, name: 'date' });
  const merchantVal = useWatch({ control, name: 'merchantOrSource' }) || '';

  const isDebtPayment = selectedCategoryId === DEBT_PAYMENT_SENTINEL;
  const isPayment = selectedCategoryId === PAYMENT_SENTINEL;
  const isTransfer = isDebtPayment || isPayment;

  const selectedCategory = localCategories.find((c) => c.id === selectedCategoryId);
  const availableSubcategories = selectedCategory?.subcategories || [];

  useEffect(() => {
    setLocalCategories(categories);
  }, [categories]);

  useEffect(() => {
    onSubmittingChange?.(isSubmitting);
  }, [isSubmitting, onSubmittingChange]);

  useEffect(() => {
    if (isTransfer) {
      setValue('subcategoryId', '');
      return;
    }
    const subs =
      localCategories.find((c) => c.id === selectedCategoryId)?.subcategories || [];
    if (selectedSubcategoryId && !subs.some((s) => s.id === selectedSubcategoryId)) {
      setValue('subcategoryId', '');
    }
  }, [selectedCategoryId, selectedSubcategoryId, localCategories, isTransfer, setValue]);

  // ---- Merchant memory -------------------------------------------------------

  const merchantIndex = useMemo(() => {
    const map = new Map<string, MerchantSuggestion>();
    // Local memory first (this device, most recent), then server history.
    Object.values(prefs.merchants)
      .sort((a, b) => b.usedAt - a.usedAt)
      .forEach((m) => map.set(m.name.toLowerCase(), m));
    merchants.forEach((m) => {
      const key = m.name.toLowerCase();
      if (!map.has(key)) map.set(key, m);
    });
    return map;
  }, [prefs, merchants]);

  const merchantQuery = merchantVal.trim().toLowerCase();
  const suggestions = useMemo(() => {
    if (!merchantQuery) return [];
    const starts: MerchantSuggestion[] = [];
    const contains: MerchantSuggestion[] = [];
    merchantIndex.forEach((m, key) => {
      if (key === merchantQuery) return;
      if (key.startsWith(merchantQuery)) starts.push(m);
      else if (key.includes(merchantQuery)) contains.push(m);
    });
    return [...starts, ...contains].slice(0, 6);
  }, [merchantIndex, merchantQuery]);

  const showSuggestions = merchantFocused && suggestions.length > 0;

  useEffect(() => setHighlighted(0), [merchantQuery]);

  const categoryExists = (id: string | null | undefined): id is string =>
    Boolean(id && localCategories.some((c) => c.id === id));

  const applyAccountForCategory = (categoryId: string) => {
    if (expense || accountTouched.current) return;
    const candidate = prefs.accountByCategory[categoryId] ?? serverAccountByCategory[categoryId];
    if (accountExists(candidate)) setValue('accountId', candidate);
  };

  const pickCategory = (categoryId: string) => {
    setValue('categoryId', categoryId, { shouldValidate: Boolean(errors.categoryId) });
    if (categoryId !== PAYMENT_SENTINEL && categoryId !== DEBT_PAYMENT_SENTINEL) {
      applyAccountForCategory(categoryId);
    }
  };

  /** Fill category / subcategory / account from what was used with this merchant. */
  const applyMerchantMemory = (name: string, { overrideCategory }: { overrideCategory: boolean }) => {
    const memory = merchantIndex.get(name.trim().toLowerCase());
    if (!memory) return;
    // Picking a suggestion is explicit, so it wins; a typed match only fills blanks.
    const canSetCategory = overrideCategory || !getValues('categoryId');
    if (canSetCategory && categoryExists(memory.categoryId)) {
      setValue('categoryId', memory.categoryId, { shouldValidate: Boolean(errors.categoryId) });
      const subOk = localCategories
        .find((c) => c.id === memory.categoryId)
        ?.subcategories?.some((s) => s.id === memory.subcategoryId);
      setValue('subcategoryId', subOk && memory.subcategoryId ? memory.subcategoryId : '');
    }
    if (!expense && !accountTouched.current && accountExists(memory.accountId)) {
      setValue('accountId', memory.accountId);
    } else if (canSetCategory && memory.categoryId) {
      applyAccountForCategory(memory.categoryId);
    }
  };

  const chooseSuggestion = (s: MerchantSuggestion) => {
    setValue('merchantOrSource', s.name);
    applyMerchantMemory(s.name, { overrideCategory: true });
    setMerchantFocused(false);
  };

  const merchantField = register('merchantOrSource');

  // ---- Category creation -----------------------------------------------------

  const regularCategories = localCategories.filter(
    (c) => c.name !== 'Debt Payment' && c.name !== 'Payment'
  );

  const resetNewCategory = () => {
    setShowNewCategory(false);
    setNewCategoryName('');
    setNewCategoryIcon('📁');
    setNewCategoryColor('#3dcea6');
    setCategoryCreateError('');
  };

  const handleCreateCategory = async () => {
    const name = newCategoryName.trim();
    if (!name) {
      setCategoryCreateError('Name is required');
      return;
    }

    setCreatingCategory(true);
    setCategoryCreateError('');

    const formData = new FormData();
    formData.append('name', name);
    formData.append('type', 'EXPENSE');
    formData.append('color', newCategoryColor);
    formData.append('icon', newCategoryIcon);

    const result = await createCategory(formData);
    setCreatingCategory(false);

    if (!result.success || !result.data) {
      setCategoryCreateError(result.error || 'Failed to create category');
      return;
    }

    const created = {
      id: result.data.id,
      name: result.data.name,
      icon: result.data.icon,
      color: result.data.color,
      subcategories: result.data.subcategories || [],
    };

    setLocalCategories((prev) =>
      [...prev, created].sort((a, b) => a.name.localeCompare(b.name))
    );
    pickCategory(created.id);
    setValue('subcategoryId', '');
    resetNewCategory();
  };

  // ---- Submit ----------------------------------------------------------------

  const fromAccount = accounts.find((a) => a.id === selectedFromAccountId);
  const toAccount = accounts.find((a) => a.id === selectedToAccountId);
  const toAccountOptions = accounts.filter((a) => a.id !== selectedFromAccountId);
  const fromAccountOptions = accounts.filter((a) => a.id !== selectedToAccountId);

  const onInvalid = (errs: FieldErrors<ExpenseFormData>) => {
    // The amount field gets focus from RHF; for anything else, bring it into view.
    if (errs.amount || errs.payAmount) return;
    requestAnimationFrame(() => {
      document
        .getElementById(formId)
        ?.querySelector('[data-field-error]')
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  };

  const onSubmit = async (data: ExpenseFormData) => {
    const intent: SubmitIntent = submitIntentRef?.current ?? 'save';
    if (submitIntentRef) submitIntentRef.current = 'save';
    setIsSubmitting(true);

    try {
      let result: { success: boolean; error?: string; data?: unknown };
      let mode: ExpenseSaveResult['mode'] = 'expense';

      if (isTransfer) {
        mode = isPayment ? 'payment' : 'debt';
        const formData = new FormData();
        formData.append('date', data.date);
        formData.append('amount', data.payAmount || '');
        formData.append('fromAccountId', data.accountId || '');
        formData.append('toAccountId', data.toAccountId || '');
        formData.append('notes', data.notes || '');
        result = isPayment
          ? await createPaymentTransfer(formData)
          : await createDebtPaymentTransfer(formData);
      } else {
        const formData = new FormData();
        formData.append('date', data.date);
        formData.append('amount', data.amount || '');
        formData.append('categoryId', data.categoryId);
        formData.append('subcategoryId', data.subcategoryId || '');
        formData.append('accountId', data.accountId || '');
        formData.append('merchantOrSource', data.merchantOrSource || '');
        formData.append('notes', data.notes || '');
        formData.append('tags', data.tags || '');
        result = expense
          ? await updateExpense(expense.id, formData)
          : await createExpense(formData);
      }

      if (!result.success) {
        toast.error(result.error || 'Could not save — please try again');
        return;
      }

      if (mode === 'expense') {
        rememberExpense({
          accountId: data.accountId,
          categoryId: data.categoryId,
          subcategoryId: data.subcategoryId,
          merchant: data.merchantOrSource,
        });
      } else if (data.accountId) {
        rememberExpense({ accountId: data.accountId });
      }

      if (intent === 'another' && !expense) {
        // Keep the date and account; clear everything else for the next entry.
        reset({
          date: data.date,
          accountId: data.accountId || '',
          amount: '',
          categoryId: '',
          subcategoryId: '',
          merchantOrSource: '',
          notes: '',
          tags: '',
          toAccountId: '',
          payAmount: '',
        });
        accountTouched.current = true;
        requestAnimationFrame(() => amountRef.current?.focus());
      }

      onSuccess({
        row: (result.data as ExpenseRow | undefined) ?? null,
        mode,
        isEdit: Boolean(expense),
        intent,
      });
    } catch {
      toast.error('Could not save — check your connection and try again');
    } finally {
      setIsSubmitting(false);
    }
  };

  const today = todayInAppTimeZone();
  const yesterday = localYesterdayForInput();
  const amountField = register(isTransfer ? 'payAmount' : 'amount');
  const amountError = (isTransfer ? errors.payAmount : errors.amount)?.message;

  const chipClass = (active: boolean) =>
    `px-3 py-2 rounded-xl text-sm border transition-all duration-200 ${
      active
        ? 'bg-mint-dim border-mint/40 text-mint'
        : 'bg-graphite-surface-2/70 border-graphite-border-subtle text-ink-secondary hover:border-graphite-border hover:text-ink'
    }`;

  return (
    <form
      id={formId}
      onSubmit={handleSubmit(onSubmit, onInvalid)}
      className="space-y-5"
      noValidate
    >
      {/* Amount hero */}
      <div
        className={`rounded-2xl border bg-gradient-to-b from-danger-dim/40 to-graphite-surface-2/60 px-5 pt-6 pb-5 text-center transition-colors ${
          amountError ? 'border-danger/50' : 'border-white/[0.06]'
        }`}
      >
        <label
          htmlFor={`${formId}-amount`}
          className="block text-[11px] uppercase tracking-[0.18em] text-ink-muted mb-3"
        >
          {isTransfer ? 'Payment amount' : 'Amount'}
        </label>
        <div className="flex items-baseline justify-center gap-1 money">
          <span className="text-2xl text-ink-muted font-medium">$</span>
          <input
            id={`${formId}-amount`}
            type="number"
            step="0.01"
            min="0"
            inputMode="decimal"
            {...amountField}
            ref={(el) => {
              amountField.ref(el);
              amountRef.current = el;
            }}
            placeholder="0.00"
            aria-invalid={Boolean(amountError)}
            aria-describedby={amountError ? `${formId}-amount-error` : undefined}
            className="w-[min(100%,12rem)] bg-transparent text-center text-4xl sm:text-5xl font-semibold text-ink outline-none placeholder:text-ink-muted/35 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            autoFocus={!expense}
          />
        </div>
        {amountError && (
          <p
            id={`${formId}-amount-error`}
            data-field-error
            className="mt-2 text-sm text-danger"
            role="alert"
          >
            {amountError}
          </p>
        )}
      </div>

      {/* Date with quick chips */}
      <div>
        <label
          htmlFor={`${formId}-date`}
          className="block text-sm font-medium text-ink-secondary mb-1.5"
        >
          Date
        </label>
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <Input
              id={`${formId}-date`}
              type="date"
              {...register('date')}
              className="!py-2"
            />
          </div>
          <button
            type="button"
            className={chipClass(selectedDate === today)}
            onClick={() => setValue('date', today, { shouldValidate: Boolean(errors.date) })}
          >
            Today
          </button>
          <button
            type="button"
            className={chipClass(selectedDate === yesterday)}
            onClick={() => setValue('date', yesterday, { shouldValidate: Boolean(errors.date) })}
          >
            Yesterday
          </button>
        </div>
        {errors.date?.message && (
          <p data-field-error className="mt-1.5 text-sm text-danger">
            {errors.date.message}
          </p>
        )}
      </div>

      {/* Merchant with autocomplete */}
      {!isTransfer && (
        <div className="relative">
          <label
            htmlFor={`${formId}-merchant`}
            className="block text-sm font-medium text-ink-secondary mb-1.5"
          >
            Merchant <span className="text-ink-muted font-normal">(optional)</span>
          </label>
          <div className="relative">
            <Store
              size={16}
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-muted"
            />
            <Input
              id={`${formId}-merchant`}
              {...merchantField}
              placeholder="e.g. Walmart"
              autoComplete="off"
              role="combobox"
              aria-expanded={showSuggestions}
              aria-controls={`${formId}-merchant-list`}
              aria-autocomplete="list"
              className="!pl-10"
              onFocus={() => setMerchantFocused(true)}
              onBlur={(e) => {
                merchantField.onBlur(e);
                setMerchantFocused(false);
                // Typed an exact past merchant: fill blanks from last time.
                applyMerchantMemory(e.target.value, { overrideCategory: false });
              }}
              onKeyDown={(e) => {
                if (!showSuggestions) return;
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setHighlighted((h) => (h + 1) % suggestions.length);
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setHighlighted((h) => (h - 1 + suggestions.length) % suggestions.length);
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  chooseSuggestion(suggestions[highlighted]);
                } else if (e.key === 'Escape') {
                  e.stopPropagation();
                  setMerchantFocused(false);
                }
              }}
            />
          </div>
          {showSuggestions && (
            <ul
              id={`${formId}-merchant-list`}
              role="listbox"
              className="absolute z-20 left-0 right-0 mt-1.5 max-h-60 overflow-y-auto rounded-xl border border-graphite-border bg-graphite-elevated shadow-panel py-1"
            >
              {suggestions.map((s, i) => {
                const cat = localCategories.find((c) => c.id === s.categoryId);
                return (
                  <li key={s.name} role="option" aria-selected={i === highlighted}>
                    <button
                      type="button"
                      // mousedown fires before the input blurs, so the pick isn't lost
                      onMouseDown={(e) => {
                        e.preventDefault();
                        chooseSuggestion(s);
                      }}
                      onMouseEnter={() => setHighlighted(i)}
                      className={`w-full flex items-center justify-between gap-3 px-3.5 py-2.5 text-left text-sm ${
                        i === highlighted ? 'bg-graphite-surface-2 text-ink' : 'text-ink-secondary'
                      }`}
                    >
                      <span className="truncate">{s.name}</span>
                      {cat && (
                        <span className="shrink-0 text-xs text-ink-muted">
                          {cat.icon || '📁'} {cat.name}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/* Category picker */}
      <div>
        <label className="block text-sm font-medium text-ink-secondary mb-2">
          Category
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => pickCategory(PAYMENT_SENTINEL)}
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
            onClick={() => pickCategory(DEBT_PAYMENT_SENTINEL)}
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
                onClick={() => pickCategory(c.id)}
                aria-pressed={active}
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
          <button
            type="button"
            onClick={() => {
              setShowNewCategory((v) => !v);
              setCategoryCreateError('');
            }}
            className={`inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-sm border border-dashed transition-all duration-200 ${
              showNewCategory
                ? 'bg-mint-dim border-mint/40 text-mint'
                : 'bg-transparent border-graphite-border text-ink-muted hover:border-mint/40 hover:text-mint'
            }`}
            aria-label="Create category"
            title="Create category"
          >
            <Plus size={16} />
            <span className="sm:inline">New</span>
          </button>
        </div>

        {showNewCategory && (
          <div className="mt-3 rounded-2xl border border-graphite-border-subtle bg-graphite-surface-2/50 p-3.5 space-y-3">
            <Input
              label="Category name"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              placeholder="e.g. Pets"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleCreateCategory();
                }
              }}
            />
            <div>
              <p className="text-xs font-medium text-ink-secondary mb-2">Icon</p>
              <div className="flex flex-wrap gap-1.5">
                {QUICK_ICONS.map((icon) => (
                  <button
                    key={icon}
                    type="button"
                    onClick={() => setNewCategoryIcon(icon)}
                    className={`w-9 h-9 rounded-lg text-base border transition-all ${
                      newCategoryIcon === icon
                        ? 'border-mint/50 bg-mint-dim'
                        : 'border-graphite-border-subtle hover:border-graphite-border'
                    }`}
                  >
                    {icon}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-medium text-ink-secondary mb-2">Color</p>
              <div className="flex flex-wrap gap-2">
                {QUICK_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setNewCategoryColor(color)}
                    className={`w-7 h-7 rounded-full border-2 transition-transform ${
                      newCategoryColor === color
                        ? 'border-ink scale-110'
                        : 'border-transparent hover:scale-105'
                    }`}
                    style={{ backgroundColor: color }}
                    aria-label={`Color ${color}`}
                  />
                ))}
              </div>
            </div>
            {categoryCreateError && (
              <p className="text-sm text-danger">{categoryCreateError}</p>
            )}
            <div className="flex gap-2">
              <Button
                type="button"
                onClick={() => void handleCreateCategory()}
                disabled={creatingCategory}
                className="flex-1"
              >
                {creatingCategory ? 'Creating…' : 'Create & select'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={resetNewCategory}
                className="flex-1"
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {errors.categoryId?.message && (
          <p data-field-error className="mt-1.5 text-sm text-danger" role="alert">
            {errors.categoryId.message}
          </p>
        )}
        <input type="hidden" {...register('categoryId')} />
      </div>

      {!isTransfer && availableSubcategories.length > 0 && (
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
      {isTransfer && (
        <div
          className={`space-y-4 rounded-2xl border p-4 ${
            isPayment ? 'border-info/20 bg-info-dim/30' : 'border-mint/20 bg-mint-dim/30'
          }`}
        >
          <div className="flex items-start gap-3">
            {isPayment ? (
              <Banknote size={18} className="text-info mt-0.5 shrink-0" />
            ) : (
              <CreditCard size={18} className="text-mint mt-0.5 shrink-0" />
            )}
            <p className={`text-sm leading-relaxed ${isPayment ? 'text-info' : 'text-mint'}`}>
              {isPayment ? (
                <>
                  Moves money from <strong>Pay From</strong> to <strong>Pay To</strong> without
                  counting as spending.
                </>
              ) : (
                'Pays down a card or debt from another account.'
              )}
            </p>
          </div>
          {isDebtPayment && (
            <div data-field-error={errors.toAccountId ? '' : undefined}>
              <Select
                label="Debt / Card to Pay"
                {...register('toAccountId')}
                error={errors.toAccountId?.message}
                options={[
                  { value: '', label: 'Select account…' },
                  ...toAccountOptions.map((a) => ({ value: a.id, label: a.name })),
                ]}
              />
            </div>
          )}
          <div data-field-error={errors.accountId ? '' : undefined}>
            <Select
              label={isPayment ? 'Pay From' : 'Pay From Account'}
              {...register('accountId', {
                onChange: () => {
                  accountTouched.current = true;
                },
              })}
              error={errors.accountId?.message}
              options={[
                { value: '', label: 'Select account…' },
                ...fromAccountOptions.map((a) => ({ value: a.id, label: a.name })),
              ]}
            />
          </div>
          {isPayment && (
            <div data-field-error={errors.toAccountId ? '' : undefined}>
              <Select
                label="Pay To"
                {...register('toAccountId')}
                error={errors.toAccountId?.message}
                options={[
                  { value: '', label: 'Select account…' },
                  ...toAccountOptions.map((a) => ({ value: a.id, label: a.name })),
                ]}
              />
            </div>
          )}
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
              placeholder={isPayment ? 'e.g. Monthly transfer to savings' : 'e.g. Monthly minimum payment'}
            />
          </div>
        </div>
      )}

      {/* Regular expense fields */}
      {!isTransfer && (
        <div className="space-y-4">
          <Select
            label="Account"
            {...register('accountId', {
              onChange: () => {
                accountTouched.current = true;
              },
            })}
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
            {showDetails ? 'Hide notes & tags' : 'Notes & tags'}
          </button>

          {showDetails && (
            <div className="space-y-4 animate-fade-up">
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
              <Input label="Tags" {...register('tags')} placeholder="business, deductible" />
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
