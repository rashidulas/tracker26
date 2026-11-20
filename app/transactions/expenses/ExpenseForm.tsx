'use client';

import Link from 'next/link';
import { useForm, useWatch, type FieldErrors } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Input from '@/components/Input';
import Textarea from '@/components/Textarea';
import Select from '@/components/Select';
import Button from '@/components/Button';
import {
  createExpense,
  updateExpense,
  createDebtPaymentTransfer,
  createPaymentTransfer,
} from './actions';
import { createCategory } from '@/app/settings/categories/actions';
import { getBudgetHint } from '@/app/plan/budgets/actions';
import type { BudgetHint } from '@/lib/budgetData';
import { formatCurrency } from '@/lib/utils';
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { addDays, toDayString, todayInAppTimeZone } from '@/lib/dates';
import { useToast } from '@/components/ToastProvider';
import { loadExpensePrefs, rememberExpense } from '@/lib/expensePrefs';
import type { ExpenseRow } from '@/lib/expenseEvents';
import { normalizeMerchantName } from '@/lib/merchants';
import { useMerchantRulePrompt } from '@/components/merchants/MerchantRulePrompt';
import QuickLine, { type QuickLineChip } from '@/components/quickadd/QuickLine';
import { DuplicateWarning, useDuplicateGuard } from '@/components/transactions/DuplicateWarning';
import { notifyReviewChanged } from '@/components/review/reviewCount';
import { interpretQuickAdd, suggestCategory, type CategorySuggestion, type QuickAddGuess } from '@/app/assist/actions';
import { needsModel, parseQuickAdd } from '@/lib/ai/quickAddParse';
import { dayLabel } from '@/lib/transactionList';
import {
  Sparkles,
  X,
  CreditCard,
  ArrowRight,
  Banknote,
  ChevronDown,
  ChevronUp,
  Plus,
  Store,
  Users,
} from 'lucide-react';

export interface FriendOption {
  id: string;
  name: string;
  color?: string | null;
}

type SplitRow = { friendId: string; amount: string };

const toCents = (raw: string | number) => Math.round(Number(raw) * 100);

/**
 * Equal split of `total` between you and each friend. Friends get the same
 * whole-cent share; you absorb the leftover cent(s).
 */
function equalFriendShares(total: number, friendCount: number): string[] {
  if (!(total > 0) || friendCount === 0) return Array(friendCount).fill('');
  const each = Math.floor(toCents(total) / (friendCount + 1));
  return Array(friendCount).fill((each / 100).toFixed(2));
}

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
  merchantId?: string | null;
  /** The category is a default the user chose ("Always use ..."). */
  hasDefault?: boolean;
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
    friendEntries?: Array<{ amount: number; friend: { id: string } }>;
  };
  /** Friends you can split this expense with. */
  friends?: FriendOption[];
  categories: Array<{
    id: string;
    name: string;
    icon?: string | null;
    color?: string | null;
    subcategories?: Array<{ id: string; name: string }>;
  }>;
  accounts: Array<{ id: string; name: string; type?: string }>;
  /** Merchant memory from the server: user defaults, else last used; most recent first. */
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
  /** Show the one-line entry ("12.50 lunch chipotle discover yesterday") above the form. */
  quickLine?: boolean;
}

/** Fields the one-line entry can fill. */
const LINE_FIELDS = ['amount', 'date', 'accountId', 'categoryId', 'subcategoryId', 'merchantOrSource', 'notes'] as const;
type LineField = (typeof LINE_FIELDS)[number];

// Answers already fetched this session, by text / merchant: typing the same
// thing again costs nothing. Failures are not kept, so they are retried.
const lineGuessCache = new Map<string, QuickAddGuess>();
const suggestionCache = new Map<string, CategorySuggestion | null>();

const LINE_DEBOUNCE_MS = 700;
const SUGGEST_DEBOUNCE_MS = 900;

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

/**
 * "$120 left in Groceries this month" under the category picker. Figures come
 * from the server (lib/budgetData.ts), the same numbers as the Budgets page.
 */
function BudgetHintLine({
  categoryId,
  categoryName,
  date,
  amount,
  editingAmount,
}: {
  categoryId: string;
  categoryName: string;
  date: string;
  amount: string | undefined;
  /** When editing, the saved amount is already counted in "spent". */
  editingAmount: number | null;
}) {
  const [hint, setHint] = useState<{ key: string; value: BudgetHint | null } | null>(null);
  const key = `${categoryId}|${date}`;

  useEffect(() => {
    let cancelled = false;
    getBudgetHint(categoryId, date)
      .then((value) => !cancelled && setHint({ key, value }))
      .catch(() => !cancelled && setHint({ key, value: null }));
    return () => {
      cancelled = true;
    };
  }, [categoryId, date, key]);

  if (!hint || hint.key !== key || !hint.value) return null;
  const { remaining, month } = hint.value;
  const typed = Number(amount);
  const delta = Number.isFinite(typed) && typed > 0 ? typed - (editingAmount ?? 0) : 0;
  const after = remaining - delta;
  const thisMonth = month === todayInAppTimeZone().slice(0, 7);
  const when = thisMonth
    ? 'this month'
    : `in ${new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long' })}`;

  return (
    <p className="mt-2 text-xs text-ink-muted" aria-live="polite">
      {remaining >= 0 ? (
        <>
          <span className="text-ink-secondary money">{formatCurrency(remaining)}</span> left in {categoryName}{' '}
          {when}
        </>
      ) : (
        <>
          {categoryName} is <span className="text-danger money">{formatCurrency(-remaining)}</span> over budget{' '}
          {when}
        </>
      )}
      {delta !== 0 && (
        <span className={after < 0 ? 'text-danger' : ''}>
          {' · '}
          {after >= 0 ? `${formatCurrency(after)} after this` : `${formatCurrency(-after)} over after this`}
        </span>
      )}
    </p>
  );
}

function localYesterdayForInput() {
  return addDays(todayInAppTimeZone(), -1);
}

export default function ExpenseForm({
  expense,
  categories,
  accounts,
  merchants = [],
  friends = [],
  serverAccountByCategory = {},
  serverLastAccountId = null,
  onSuccess,
  onCancel,
  hideActions = false,
  onSubmittingChange,
  formId = 'expense-form',
  submitIntentRef,
  quickLine = false,
}: ExpenseFormProps) {
  const toast = useToast();
  const merchantRule = useMerchantRulePrompt();
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
  // The merchant's account beats "the account last used with this category".
  const accountFromMerchant = useRef(false);
  const amountRef = useRef<HTMLInputElement | null>(null);

  // ---- Split with friends ----------------------------------------------------
  const initialSplit: SplitRow[] = (expense?.friendEntries ?? []).map((e) => ({
    friendId: e.friend.id,
    amount: e.amount.toFixed(2),
  }));
  const [splitOpen, setSplitOpen] = useState(initialSplit.length > 0);
  const [splitRows, setSplitRows] = useState<SplitRow[]>(initialSplit);
  // Equal shares follow the amount until a share is typed by hand. An existing
  // split keeps its saved amounts.
  const [splitCustom, setSplitCustom] = useState(initialSplit.length > 0);

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
  const amountVal = useWatch({ control, name: 'amount' });
  const merchantVal = useWatch({ control, name: 'merchantOrSource' }) || '';
  const notesVal = useWatch({ control, name: 'notes' }) || '';

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
    // A default the user chose wins; then this device's memory (most recent);
    // then what the server saw used last.
    Object.values(prefs.merchants)
      .sort((a, b) => b.usedAt - a.usedAt)
      .forEach((m) => {
        const key = normalizeMerchantName(m.name);
        if (key && !map.has(key)) map.set(key, m);
      });
    merchants.forEach((m) => {
      const key = normalizeMerchantName(m.name);
      if (!key) return;
      const local = map.get(key);
      if (m.hasDefault) {
        map.set(key, { ...m, accountId: m.accountId ?? local?.accountId ?? null });
      } else if (!local) {
        map.set(key, m);
      } else {
        // Keep the server's canonical spelling and id.
        map.set(key, { ...local, name: m.name, merchantId: m.merchantId });
      }
    });
    return map;
  }, [prefs, merchants]);

  const merchantQuery = normalizeMerchantName(merchantVal) ?? '';
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
    if (expense || accountTouched.current || accountFromMerchant.current) return;
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
    const memory = merchantIndex.get(normalizeMerchantName(name) ?? '');
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
      accountFromMerchant.current = true;
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

  // ---- One-line entry ---------------------------------------------------------
  //
  // The line is parsed in code on every keystroke (lib/ai/quickAddParse.ts).
  // Words the code cannot place go to the model once typing pauses; if that
  // is slow or unavailable they simply become the note. Each field remembers
  // what the line last put there, so a value the user typed by hand is never
  // overwritten or cleared by the line.

  const [line, setLine] = useState('');
  const lineFromVoice = useRef(false);
  const lineApplied = useRef<Partial<Record<LineField, string>>>({});
  const [lineGuess, setLineGuess] = useState<{ key: string; value: QuickAddGuess | null } | null>(null);
  const lineKey = line.replace(/\s+/g, ' ').trim().toLowerCase();

  const lineContext = useMemo(
    () => ({
      today: todayInAppTimeZone(),
      accounts,
      categories: localCategories.filter((c) => c.name !== 'Debt Payment' && c.name !== 'Payment'),
      merchants: Array.from(merchantIndex.values()),
    }),
    [accounts, localCategories, merchantIndex]
  );
  const lineParse = useMemo(
    () => (quickLine && lineKey ? parseQuickAdd(line, lineContext) : null),
    [quickLine, line, lineKey, lineContext]
  );
  const lineMemory = lineParse?.merchantKnown
    ? merchantIndex.get(normalizeMerchantName(lineParse.merchant) ?? '')
    : undefined;
  const lineMemoryCategory = categoryExists(lineMemory?.categoryId) ? lineMemory?.categoryId : undefined;
  const lineWantsModel = Boolean(lineParse) && needsModel(lineParse!, Boolean(lineMemoryCategory));
  // undefined: not answered yet. null: asked, nothing came back.
  const lineAnswer = lineWantsModel && lineGuess?.key === lineKey ? lineGuess.value : undefined;
  const lineThinking = lineWantsModel && lineAnswer === undefined;

  useEffect(() => {
    if (!lineWantsModel || !lineKey || lineGuess?.key === lineKey) return;
    const cached = lineGuessCache.get(lineKey);
    if (cached) {
      setLineGuess({ key: lineKey, value: cached });
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      let value: QuickAddGuess | null = null;
      try {
        value = await interpretQuickAdd(lineKey);
      } catch {
        value = null;
      }
      if (cancelled) return;
      if (value) lineGuessCache.set(lineKey, value);
      setLineGuess({ key: lineKey, value });
    }, LINE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [lineWantsModel, lineKey, lineGuess]);

  /** What the line asks each field to hold. A missing key means "nothing to say". */
  const lineTargets = useMemo(() => {
    const t: Partial<Record<LineField, string>> = {};
    if (!lineParse) return t;
    if (lineParse.amount !== undefined) t.amount = lineParse.amount.toFixed(2);
    if (lineParse.date) t.date = lineParse.date;

    const guessed = lineAnswer?.confident && categoryExists(lineAnswer.categoryId) ? lineAnswer : null;
    const categoryId = lineParse.categoryId ?? lineMemoryCategory ?? guessed?.categoryId ?? undefined;
    if (categoryId) {
      t.categoryId = categoryId;
      const sub = lineParse.categoryId
        ? lineParse.subcategoryId
        : lineMemoryCategory
        ? lineMemory?.subcategoryId
        : guessed?.subcategoryId;
      const subOk = localCategories.find((c) => c.id === categoryId)?.subcategories?.some((s) => s.id === sub);
      t.subcategoryId = subOk && sub ? sub : '';
    }
    const accountId = lineParse.accountId ?? (accountExists(lineMemory?.accountId) ? lineMemory?.accountId : undefined);
    if (accountId) t.accountId = accountId;

    const merchant = lineParse.merchant ?? lineAnswer?.merchant ?? undefined;
    if (merchant) t.merchantOrSource = merchant;

    // Leftover words: the model's note if it answered, else the words as typed.
    if (lineParse.leftover) {
      if (!lineWantsModel || lineAnswer === null) t.notes = lineParse.leftover;
      else if (lineAnswer) t.notes = lineAnswer.notes ?? (lineAnswer.merchant ? '' : lineParse.leftover);
    }
    if (t.notes === '') delete t.notes;
    return t;
    // categoryExists / accountExists read the lists named in the deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineParse, lineAnswer, lineWantsModel, lineMemory, lineMemoryCategory, localCategories, accounts]);

  useEffect(() => {
    if (!quickLine) return;
    const blank: Record<LineField, string> = {
      amount: '',
      date: todayInAppTimeZone(),
      accountId: initialAccountId,
      categoryId: '',
      subcategoryId: '',
      merchantOrSource: '',
      notes: '',
    };
    for (const field of LINE_FIELDS) {
      const want = lineTargets[field];
      const had = lineApplied.current[field];
      if (want !== undefined && want !== had) {
        setValue(field, want, { shouldValidate: Boolean(errors[field]) });
        lineApplied.current[field] = want;
        if (field === 'accountId') accountFromMerchant.current = true;
        if (field === 'notes') setShowDetails(true);
      } else if (want === undefined && had !== undefined) {
        // The words that filled this field were deleted: undo, unless the
        // user has changed the field since.
        if (getValues(field) === had) setValue(field, blank[field]);
        delete lineApplied.current[field];
      }
    }
    // Only when what the line says changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quickLine, lineTargets]);

  const lineChips: QuickLineChip[] = [];
  if (lineTargets.amount) lineChips.push({ key: 'amount', label: formatCurrency(Number(lineTargets.amount)) });
  if (lineTargets.date) lineChips.push({ key: 'date', label: dayLabel(lineTargets.date) });
  if (lineTargets.merchantOrSource) lineChips.push({ key: 'merchant', label: lineTargets.merchantOrSource });
  if (lineTargets.categoryId) {
    const c = localCategories.find((x) => x.id === lineTargets.categoryId);
    const s = c?.subcategories?.find((x) => x.id === lineTargets.subcategoryId);
    if (c) lineChips.push({ key: 'category', label: `${c.icon ? `${c.icon} ` : ''}${c.name}${s ? ` › ${s.name}` : ''}` });
  }
  if (lineTargets.accountId) {
    const a = accounts.find((x) => x.id === lineTargets.accountId);
    if (a) lineChips.push({ key: 'account', label: a.name });
  }
  if (lineTargets.notes) lineChips.push({ key: 'notes', label: `note: ${lineTargets.notes}` });

  // ---- Category suggestion ----------------------------------------------------
  //
  // Shown as a chip to accept, never applied silently. Merchant memory first
  // (instant, free); for a merchant or note with no history the server is
  // asked once typing pauses (history again, then the model), cached per
  // merchant.

  const [fetchedSuggestion, setFetchedSuggestion] = useState<{ key: string; value: CategorySuggestion | null } | null>(null);
  const [dismissedSuggestion, setDismissedSuggestion] = useState<string | null>(null);
  const noteKey = notesVal.replace(/\s+/g, ' ').trim().toLowerCase();
  const suggestKey = merchantQuery ? `m:${merchantQuery}` : noteKey.length >= 3 ? `n:${noteKey}` : '';
  const memorySuggestion = merchantQuery ? merchantIndex.get(merchantQuery) : undefined;
  const canSuggest = !expense && !isTransfer && Boolean(suggestKey);

  useEffect(() => {
    // The one-line entry asks the model itself; do not ask twice. If it
    // answered, its verdict stands; if it failed, this is the one retry.
    if (!canSuggest || selectedCategoryId || lineThinking || lineAnswer) return;
    if (memorySuggestion?.categoryId || suggestKey.length < 5 || fetchedSuggestion?.key === suggestKey) return;
    if (suggestionCache.has(suggestKey)) {
      setFetchedSuggestion({ key: suggestKey, value: suggestionCache.get(suggestKey) ?? null });
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      let value: CategorySuggestion | null = null;
      let failed = false;
      try {
        value = await suggestCategory(merchantQuery ? { merchant: merchantVal } : { notes: notesVal });
      } catch {
        failed = true;
      }
      if (cancelled) return;
      if (!failed) suggestionCache.set(suggestKey, value);
      setFetchedSuggestion({ key: suggestKey, value });
    }, SUGGEST_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // merchantVal / notesVal are read through suggestKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSuggest, selectedCategoryId, lineThinking, lineAnswer, memorySuggestion, suggestKey, fetchedSuggestion]);

  const suggestion: { categoryId: string; subcategoryId: string | null; accountId: string | null; why: string } | null =
    (() => {
      if (!canSuggest) return null;
      if (memorySuggestion && categoryExists(memorySuggestion.categoryId)) {
        return {
          categoryId: memorySuggestion.categoryId,
          subcategoryId: memorySuggestion.subcategoryId,
          accountId: memorySuggestion.accountId,
          why: memorySuggestion.hasDefault ? 'your default for this merchant' : 'used last time',
        };
      }
      const fetched = fetchedSuggestion?.key === suggestKey ? fetchedSuggestion.value : null;
      if (fetched && categoryExists(fetched.categoryId)) {
        return { ...fetched, why: fetched.source === 'history' ? 'used last time' : 'suggested' };
      }
      // The one-line entry's guess when the model was not sure enough to fill it in.
      if (lineAnswer && !lineAnswer.confident && categoryExists(lineAnswer.categoryId)) {
        return { categoryId: lineAnswer.categoryId, subcategoryId: lineAnswer.subcategoryId, accountId: null, why: 'a guess' };
      }
      return null;
    })();
  const showSuggestion =
    suggestion !== null && suggestion.categoryId !== selectedCategoryId && dismissedSuggestion !== suggestKey;
  const suggestionCategory = suggestion ? localCategories.find((c) => c.id === suggestion.categoryId) : undefined;
  const suggestionSub = suggestionCategory?.subcategories?.find((s) => s.id === suggestion?.subcategoryId);
  const suggestionAccount =
    suggestion && accountExists(suggestion.accountId) && !accountTouched.current
      ? accounts.find((a) => a.id === suggestion.accountId)
      : undefined;

  const acceptSuggestion = () => {
    if (!suggestion) return;
    setValue('categoryId', suggestion.categoryId, { shouldValidate: Boolean(errors.categoryId) });
    setValue('subcategoryId', suggestionSub ? suggestionSub.id : '');
    if (suggestionAccount) {
      setValue('accountId', suggestionAccount.id);
      accountFromMerchant.current = true;
    } else {
      applyAccountForCategory(suggestion.categoryId);
    }
  };

  // ---- Duplicate warning ------------------------------------------------------

  const duplicateGuard = useDuplicateGuard();
  const heldIntent = useRef<SubmitIntent>('save');

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

  const totalAmount = Number(amountVal) > 0 ? Number(amountVal) : 0;
  const splitShares: SplitRow[] = splitCustom
    ? splitRows
    : (() => {
        const equal = equalFriendShares(totalAmount, splitRows.length);
        return splitRows.map((r, i) => ({ ...r, amount: equal[i] }));
      })();
  const friendsTotalCents = splitShares.reduce((sum, r) => sum + (toCents(r.amount) || 0), 0);
  const myShareCents = toCents(totalAmount) - friendsTotalCents;
  const splitActive = splitOpen && splitShares.length > 0;
  const splitError = !splitActive
    ? ''
    : splitShares.some((r) => !(Number(r.amount) > 0))
    ? "Enter each friend's share"
    : myShareCents < 0
    ? "Friends' shares are more than the amount"
    : '';

  const toggleSplitFriend = (friendId: string) => {
    // Changing who is in the split goes back to equal shares.
    setSplitCustom(false);
    setSplitRows((rows) =>
      rows.some((r) => r.friendId === friendId)
        ? rows.filter((r) => r.friendId !== friendId)
        : [...rows, { friendId, amount: '' }]
    );
  };

  const setSplitAmount = (friendId: string, value: string) => {
    setSplitCustom(true);
    setSplitRows(
      splitShares.map((r) => (r.friendId === friendId ? { ...r, amount: value } : r))
    );
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

  /**
   * After a save: if the category was changed for a merchant (on an edit, or
   * away from what that merchant usually gets), offer to make it the default.
   */
  const offerMerchantRule = (
    data: ExpenseFormData,
    saved: { merchantId?: string | null; merchantOrSource?: string | null } | null
  ) => {
    const name = saved?.merchantOrSource || data.merchantOrSource?.trim();
    if (!name || !data.categoryId) return;
    const memory = merchantIndex.get(normalizeMerchantName(name) ?? '');
    const sub = data.subcategoryId || null;
    const sameAs = (categoryId?: string | null, subcategoryId?: string | null) =>
      categoryId === data.categoryId && (subcategoryId || null) === sub;
    if (memory?.hasDefault && sameAs(memory.categoryId, memory.subcategoryId)) return;
    const changedOnEdit = Boolean(expense) && !sameAs(expense?.categoryId, expense?.subcategoryId);
    const differsFromUsual = Boolean(memory?.categoryId) && !sameAs(memory?.categoryId, memory?.subcategoryId);
    if (!changedOnEdit && !differsFromUsual) return;
    const category = localCategories.find((c) => c.id === data.categoryId);
    if (!category) return;
    const subName = category.subcategories?.find((s) => s.id === sub)?.name;
    merchantRule.offer({
      merchantId: saved?.merchantId ?? memory?.merchantId ?? null,
      merchantName: name,
      categoryId: data.categoryId,
      subcategoryId: sub,
      categoryLabel: `${category.icon ? `${category.icon} ` : ''}${category.name}${subName ? ` › ${subName}` : ''}`,
    });
  };

  const onSubmit = async (data: ExpenseFormData) => {
    if (!isTransfer && splitError) {
      toast.error(splitError);
      return;
    }
    const intent: SubmitIntent = submitIntentRef?.current ?? 'save';
    if (submitIntentRef) submitIntentRef.current = 'save';
    setIsSubmitting(true);

    try {
      let result: { success: boolean; error?: string; data?: unknown };
      let mode: ExpenseSaveResult['mode'] = 'expense';

      // A new entry that looks like one already saved: ask before saving twice.
      if (!expense && data.accountId) {
        const clear = await duplicateGuard.check({
          kind: isTransfer ? 'TRANSFER' : 'EXPENSE',
          accountId: data.accountId,
          toAccountId: isTransfer ? data.toAccountId : null,
          amount: Number(isTransfer ? data.payAmount : data.amount),
          date: data.date,
          merchant: isTransfer ? null : data.merchantOrSource,
        });
        if (!clear) {
          heldIntent.current = intent;
          requestAnimationFrame(() =>
            document
              .getElementById(formId)
              ?.querySelector('[data-duplicate-warning]')
              ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
          );
          return;
        }
      }
      const source = !expense && !isTransfer && lineFromVoice.current && lineKey ? 'voice' : '';

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
        formData.append('source', source);
        formData.append(
          'friendSplits',
          JSON.stringify(
            splitActive
              ? splitShares.map((r) => ({ friendId: r.friendId, amount: Number(r.amount) }))
              : []
          )
        );
        result = expense
          ? await updateExpense(expense.id, formData)
          : await createExpense(formData);
      }

      if (!result.success) {
        toast.error(result.error || 'Could not save — please try again');
        return;
      }
      duplicateGuard.reset();
      // Spoken entries go to the review inbox.
      if (source) notifyReviewChanged();

      if (mode === 'expense') {
        offerMerchantRule(data, (result.data as { merchantId?: string | null; merchantOrSource?: string | null } | undefined) ?? null);
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
        lineApplied.current = {};
        lineFromVoice.current = false;
        setLine('');
        setSplitOpen(false);
        setSplitRows([]);
        setSplitCustom(false);
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
      {quickLine && !expense && (
        <QuickLine
          id={`${formId}-line`}
          value={line}
          onChange={(text, viaVoice) => {
            if (viaVoice) lineFromVoice.current = true;
            else if (!text.trim()) lineFromVoice.current = false;
            setLine(text);
          }}
          chips={lineChips}
          thinking={lineThinking}
          leftover={lineThinking ? lineParse?.leftover : undefined}
        />
      )}

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
                // A typed merchant that was used before is offered as a
                // suggestion chip below; nothing is filled in silently.
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
                          {s.hasDefault && <span className="ml-1 text-mint">· default</span>}
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

      {showSuggestion && suggestion && suggestionCategory && (
        <div className="flex items-center gap-1.5" aria-live="polite" data-category-suggestion>
          <button
            type="button"
            onClick={acceptSuggestion}
            className="inline-flex min-h-[40px] min-w-0 items-center gap-2 rounded-full border border-mint/40 bg-mint-dim px-3.5 py-1.5 text-left text-sm text-mint transition-colors hover:bg-mint/20"
          >
            <Sparkles size={14} className="shrink-0" aria-hidden="true" />
            <span className="min-w-0">
              <span className="sr-only">Use suggested category </span>
              <span className="block truncate">
                {suggestionCategory.icon || '📁'} {suggestionCategory.name}
                {suggestionSub ? ` › ${suggestionSub.name}` : ''}
                {suggestionAccount ? ` · ${suggestionAccount.name}` : ''}
              </span>
              <span className="block truncate text-[11px] leading-tight text-mint/70">
                {suggestion.why} · tap to use
              </span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => setDismissedSuggestion(suggestKey)}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-ink-muted hover:bg-graphite-surface-2 hover:text-ink"
            aria-label="Dismiss suggestion"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Category picker */}
      <div>
        <p id={`${formId}-category-label`} className="block text-sm font-medium text-ink-secondary mb-2">
          Category
        </p>
        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-labelledby={`${formId}-category-label`}
        >
          <button
            type="button"
            onClick={() => pickCategory(PAYMENT_SENTINEL)}
            aria-pressed={isPayment}
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
            aria-pressed={isDebtPayment}
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
        {!isTransfer && selectedCategory && selectedDate && (
          <BudgetHintLine
            categoryId={selectedCategory.id}
            categoryName={selectedCategory.name}
            date={selectedDate}
            // Budgets count only your share of an expense split with friends.
            amount={splitActive ? (Math.max(0, myShareCents) / 100).toFixed(2) : amountVal}
            editingAmount={
              expense &&
              expense.categoryId === selectedCategory.id &&
              toDayString(expense.date).slice(0, 7) === selectedDate.slice(0, 7)
                ? expense.amount -
                  (expense.friendEntries ?? []).reduce((sum, e) => sum + e.amount, 0)
                : null
            }
          />
        )}
      </div>

      {!isTransfer && availableSubcategories.length > 0 && (
        <div>
          <p id={`${formId}-subcategory-label`} className="block text-sm font-medium text-ink-secondary mb-2">
            Subcategory <span className="text-ink-muted font-normal">(optional)</span>
          </p>
          <div className="flex flex-wrap gap-2" role="group" aria-labelledby={`${formId}-subcategory-label`}>
            <button
              type="button"
              onClick={() => setValue('subcategoryId', '')}
              aria-pressed={!selectedSubcategoryId}
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
                  aria-pressed={active}
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
          <Textarea
            label="Notes (optional)"
            {...register('notes')}
            rows={2}
            placeholder={isPayment ? 'e.g. Monthly transfer to savings' : 'e.g. Monthly minimum payment'}
          />
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
          {!expense && (
            <p className="-mt-2 text-xs text-ink-muted">
              On a friend’s card, or paying it off over time?{' '}
              <Link href="/plan/recurring?plan=1" className="text-mint hover:text-mint-bright">
                Set up an installment plan
              </Link>{' '}
              instead: each payment becomes the expense.
            </p>
          )}

          {friends.length > 0 && (
            <div className="rounded-2xl border border-graphite-border-subtle bg-graphite-surface-2/40 p-3.5">
              <button
                type="button"
                onClick={() => setSplitOpen((v) => !v)}
                aria-expanded={splitOpen}
                aria-controls={`${formId}-split`}
                className="w-full flex items-center justify-between gap-2 text-sm font-medium text-ink-secondary hover:text-ink"
              >
                <span className="inline-flex items-center gap-2">
                  <Users size={16} aria-hidden="true" />
                  Split with friends
                  {splitActive && (
                    <span className="text-xs font-normal text-ink-muted">
                      · {splitShares.length} friend{splitShares.length === 1 ? '' : 's'}
                    </span>
                  )}
                </span>
                {splitOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>

              {splitOpen && (
                <div id={`${formId}-split`} className="mt-3 space-y-3">
                  <div
                    className="flex flex-wrap gap-2"
                    role="group"
                    aria-label="Friends in this split"
                  >
                    {friends.map((f) => {
                      const on = splitRows.some((r) => r.friendId === f.id);
                      return (
                        <button
                          key={f.id}
                          type="button"
                          onClick={() => toggleSplitFriend(f.id)}
                          aria-pressed={on}
                          className={chipClass(on)}
                        >
                          <span
                            aria-hidden="true"
                            className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle"
                            style={{ backgroundColor: f.color || '#7aa2f7' }}
                          />
                          {f.name}
                        </button>
                      );
                    })}
                  </div>

                  {splitShares.length > 0 && (
                    <div className="space-y-2">
                      {splitShares.map((row) => {
                        const friend = friends.find((f) => f.id === row.friendId);
                        return (
                          <div key={row.friendId} className="flex items-center gap-3">
                            <label
                              htmlFor={`${formId}-split-${row.friendId}`}
                              className="flex-1 min-w-0 truncate text-sm text-ink-secondary"
                            >
                              {friend?.name ?? 'Friend'} owes you
                            </label>
                            <div className="relative w-32">
                              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-muted">
                                $
                              </span>
                              <input
                                id={`${formId}-split-${row.friendId}`}
                                type="number"
                                step="0.01"
                                min="0"
                                inputMode="decimal"
                                value={row.amount}
                                onChange={(e) => setSplitAmount(row.friendId, e.target.value)}
                                placeholder="0.00"
                                className="w-full rounded-xl border border-graphite-border-subtle bg-graphite-surface px-3 py-2 pl-6 text-right text-sm text-ink money outline-none focus:border-mint/50"
                              />
                            </div>
                          </div>
                        );
                      })}
                      <div className="flex items-center justify-between gap-3 border-t border-graphite-border-subtle pt-2 text-sm">
                        <span className="text-ink-muted">
                          Your share{' '}
                          <span className={myShareCents < 0 ? 'text-danger' : 'text-ink money'}>
                            ${(myShareCents / 100).toFixed(2)}
                          </span>
                        </span>
                        {splitCustom && (
                          <button
                            type="button"
                            onClick={() => setSplitCustom(false)}
                            className="text-xs text-mint hover:underline"
                          >
                            Split equally
                          </button>
                        )}
                      </div>
                      {splitError && (
                        <p className="text-sm text-danger" role="alert">
                          {splitError}
                        </p>
                      )}
                      <p className="text-xs text-ink-muted">
                        The account pays the full amount. Budgets and spending count only your
                        share; each friend gets a &ldquo;they owe me&rdquo; entry.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

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
              <Textarea
                label="Notes"
                {...register('notes')}
                rows={3}
                placeholder="Add notes…"
              />
              <Input label="Tags" {...register('tags')} placeholder="business, deductible" />
            </div>
          )}
        </div>
      )}

      <DuplicateWarning
        match={duplicateGuard.match}
        busy={isSubmitting}
        onCancel={duplicateGuard.reset}
        onSaveAnyway={() => {
          duplicateGuard.confirm();
          if (submitIntentRef) submitIntentRef.current = heldIntent.current;
          void handleSubmit(onSubmit, onInvalid)();
        }}
      />

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
