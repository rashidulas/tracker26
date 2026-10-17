'use client';

import { useState, useEffect } from 'react';
import Modal from '@/components/Modal';
import Button from '@/components/Button';
import Input from '@/components/Input';
import Select from '@/components/Select';
import { deleteIncome, createIncome, updateIncome, getIncome, getCategoriesForSelect, getAccountsForSelect } from './actions';
import PageHeader from '@/components/PageHeader';
import { Plus, Edit2, Trash2, Filter, X } from 'lucide-react';
import { formatDate, formatDateForInput, getLocalTodayForInput } from '@/lib/utils';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

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

interface IncomePart {
  id: string;
  date: Date;
  amount: number;
  categoryId: string | null;
  subcategoryId?: string | null;
  accountId: string | null;
  merchantOrSource: string | null;
  notes: string | null;
  tags: string[];
  splitGroupId?: string | null;
  accountSplits?: Array<{ accountId: string; amount: number }> | null;
  category: { id: string; name: string; icon: string | null } | null;
  subcategory?: { id: string; name: string } | null;
  account: { id: string; name: string } | null;
}

interface IncomeAccountSplit {
  accountId: string;
  name: string;
  amount: number;
}

interface IncomeRow {
  id: string;
  memberIds: string[];
  date: Date;
  amount: number;
  categoryId: string | null;
  subcategoryId?: string | null;
  merchantOrSource: string | null;
  notes: string | null;
  tags: string[];
  splitGroupId?: string | null;
  category: { id: string; name: string; icon: string | null } | null;
  subcategory?: { id: string; name: string } | null;
  accounts: IncomeAccountSplit[];
}

function incomeFingerprint(item: IncomePart) {
  return [
    new Date(item.date).toISOString().slice(0, 10),
    item.categoryId || '',
    item.subcategoryId || '',
    item.merchantOrSource || '',
    item.notes || '',
    [...(item.tags || [])].map((t) => t.toLowerCase()).sort().join(','),
  ].join('|');
}

function groupIncomeRows(
  parts: IncomePart[],
  accountNameById: Map<string, string>
): IncomeRow[] {
  const used = new Set<string>();
  const rows: IncomeRow[] = [];

  const resolveAccountName = (accountId: string, fallback?: string | null) =>
    accountNameById.get(accountId) || fallback || 'Unknown';

  // One DB row with embedded accountSplits = one income transaction
  for (const part of parts) {
    const splits = part.accountSplits || [];
    if (splits.length === 0) continue;
    used.add(part.id);
    rows.push({
      id: part.id,
      memberIds: [part.id],
      date: part.date,
      amount: part.amount,
      categoryId: part.categoryId,
      subcategoryId: part.subcategoryId,
      merchantOrSource: part.merchantOrSource,
      notes: part.notes,
      tags: part.tags,
      splitGroupId: part.splitGroupId,
      category: part.category,
      subcategory: part.subcategory,
      accounts: splits.map((s) => ({
        accountId: s.accountId,
        name: resolveAccountName(s.accountId, part.account?.name),
        amount: s.amount,
      })),
    });
  }

  // Legacy multi-row groups (pre accountSplits)
  const byGroup = new Map<string, IncomePart[]>();
  for (const part of parts) {
    if (used.has(part.id) || !part.splitGroupId) continue;
    const list = byGroup.get(part.splitGroupId) || [];
    list.push(part);
    byGroup.set(part.splitGroupId, list);
  }

  for (const [groupId, members] of byGroup) {
    members.forEach((m) => used.add(m.id));
    const sorted = [...members].sort((a, b) => b.amount - a.amount);
    const primary = sorted[0];
    rows.push({
      id: primary.id,
      memberIds: sorted.map((m) => m.id),
      date: primary.date,
      amount: sorted.reduce((sum, m) => sum + m.amount, 0),
      categoryId: primary.categoryId,
      subcategoryId: primary.subcategoryId,
      merchantOrSource: primary.merchantOrSource,
      notes: primary.notes,
      tags: primary.tags,
      splitGroupId: groupId,
      category: primary.category,
      subcategory: primary.subcategory,
      accounts: sorted.map((m) => ({
        accountId: m.accountId || '',
        name: resolveAccountName(m.accountId || '', m.account?.name),
        amount: m.amount,
      })),
    });
  }

  const leftover = parts.filter((p) => !used.has(p.id));
  const byFingerprint = new Map<string, IncomePart[]>();
  for (const part of leftover) {
    const key = incomeFingerprint(part);
    const list = byFingerprint.get(key) || [];
    list.push(part);
    byFingerprint.set(key, list);
  }

  for (const members of byFingerprint.values()) {
    const distinctAccounts = new Set(members.map((m) => m.accountId).filter(Boolean));
    const shouldMerge = members.length > 1 && distinctAccounts.size > 1;

    if (!shouldMerge) {
      for (const part of members) {
        rows.push({
          id: part.id,
          memberIds: [part.id],
          date: part.date,
          amount: part.amount,
          categoryId: part.categoryId,
          subcategoryId: part.subcategoryId,
          merchantOrSource: part.merchantOrSource,
          notes: part.notes,
          tags: part.tags,
          splitGroupId: part.splitGroupId,
          category: part.category,
          subcategory: part.subcategory,
          accounts: [
            {
              accountId: part.accountId || '',
              name: resolveAccountName(part.accountId || '', part.account?.name),
              amount: part.amount,
            },
          ],
        });
      }
      continue;
    }

    const sorted = [...members].sort((a, b) => b.amount - a.amount);
    const primary = sorted[0];
    rows.push({
      id: primary.id,
      memberIds: sorted.map((m) => m.id),
      date: primary.date,
      amount: sorted.reduce((sum, m) => sum + m.amount, 0),
      categoryId: primary.categoryId,
      subcategoryId: primary.subcategoryId,
      merchantOrSource: primary.merchantOrSource,
      notes: primary.notes,
      tags: primary.tags,
      splitGroupId: primary.splitGroupId,
      category: primary.category,
      subcategory: primary.subcategory,
      accounts: sorted.map((m) => ({
        accountId: m.accountId || '',
        name: resolveAccountName(m.accountId || '', m.account?.name),
        amount: m.amount,
      })),
    });
  }

  return rows.sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );
}

interface Category {
  id: string;
  name: string;
  subcategories?: Array<{ id: string; name: string }>;
}

interface Account {
  id: string;
  name: string;
}

function IncomeForm({
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
        ? formatDateForInput(income.date)
        : getLocalTodayForInput(),
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

export default function IncomePage() {
  const [income, setIncome] = useState<IncomeRow[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingIncome, setEditingIncome] = useState<IncomeRow | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({
    startDate: '',
    endDate: '',
    categoryId: '',
    subcategoryId: '',
    search: '',
  });

  const filterSubcategories =
    categories.find((c) => c.id === filters.categoryId)?.subcategories || [];

  useEffect(() => {
    loadData();
  }, [filters]);

  async function loadData() {
    try {
      setIsLoading(true);
      const filterObj = {
        ...(filters.startDate && { startDate: filters.startDate }),
        ...(filters.endDate && { endDate: filters.endDate }),
        ...(filters.categoryId && { categoryId: filters.categoryId }),
        ...(filters.subcategoryId && { subcategoryId: filters.subcategoryId }),
        ...(filters.search && { search: filters.search }),
      };

      const [incomeResult, categoriesResult, accountsResult] = await Promise.all([
        getIncome(Object.keys(filterObj).length > 0 ? filterObj : undefined),
        getCategoriesForSelect(),
        getAccountsForSelect(),
      ]);

      if (accountsResult.success && accountsResult.data) {
        setAccounts(accountsResult.data);
      }

      const accountNameById = new Map(
        (accountsResult.success && accountsResult.data
          ? accountsResult.data
          : []
        ).map((a: Account) => [a.id, a.name])
      );

      if (incomeResult.success && incomeResult.data) {
        setIncome(
          groupIncomeRows(incomeResult.data as IncomePart[], accountNameById)
        );
      }

      if (categoriesResult.success && categoriesResult.data) {
        setCategories(categoriesResult.data);
      }
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setIsLoading(false);
    }
  }

  const handleSuccess = () => {
    setIsModalOpen(false);
    setEditingIncome(null);
    loadData();
  };

  const handleEdit = (item: IncomeRow) => {
    setEditingIncome(item);
    setIsModalOpen(true);
  };

  const handleAdd = () => {
    setEditingIncome(null);
    setIsModalOpen(true);
  };

  const handleDelete = async (item: IncomeRow) => {
    if (!confirm('Are you sure you want to delete this income?')) return;
    const result = await deleteIncome(item.id, item.memberIds);
    if (result.success) {
      loadData();
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  if (isLoading) {
    return (
      <div className="page-shell">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-ink-muted">Loading...</div>
        </div>
      </div>
    );
  }

  const totalIncome = income.reduce((sum, item) => sum + item.amount, 0);

  return (
    <div className="page-shell">
      <PageHeader
        title="Income"
        subtitle="Track and manage your income"
        actions={
          <>
            <Button variant="secondary" onClick={() => setShowFilters(!showFilters)}>
              <Filter size={18} />
              Filters
            </Button>
            <Button onClick={handleAdd}>
              <Plus size={18} />
              Add Income
            </Button>
          </>
        }
      />

      {showFilters && (
        <div className="panel shadow-panel p-4 sm:p-6 mb-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-base sm:text-lg font-semibold text-ink font-display">Filters</h3>
            <button onClick={() => setShowFilters(false)} className="text-ink-muted hover:text-ink transition-colors p-1">
              <X size={20} />
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            <Input
              label="Start Date"
              type="date"
              value={filters.startDate}
              onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
            />
            <Input
              label="End Date"
              type="date"
              value={filters.endDate}
              onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
            />
            <Select
              label="Category"
              value={filters.categoryId}
              onChange={(e) =>
                setFilters({
                  ...filters,
                  categoryId: e.target.value,
                  subcategoryId: '',
                })
              }
              options={[
                { value: '', label: 'All Categories' },
                ...categories.map((c) => ({ value: c.id, label: c.name })),
              ]}
            />
            <Select
              label="Subcategory"
              value={filters.subcategoryId}
              onChange={(e) => setFilters({ ...filters, subcategoryId: e.target.value })}
              options={[
                {
                  value: '',
                  label: filters.categoryId ? 'All Subcategories' : 'Select category first',
                },
                ...filterSubcategories.map((s) => ({ value: s.id, label: s.name })),
              ]}
            />
            <Input
              label="Search"
              placeholder="Source or notes..."
              value={filters.search}
              onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            />
          </div>
          <div className="mt-4">
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                setFilters({
                  startDate: '',
                  endDate: '',
                  categoryId: '',
                  subcategoryId: '',
                  search: '',
                })
              }
            >
              Clear Filters
            </Button>
          </div>
        </div>
      )}

      <div className="bg-mint-dim border border-mint/25 rounded-2xl p-4 mb-6">
        <div className="flex justify-between items-center">
          <span className="text-ink-secondary font-medium">Total Income</span>
          <span className="text-2xl font-semibold text-mint money">{formatCurrency(totalIncome)}</span>
        </div>
        <p className="text-sm text-ink-secondary mt-1">{income.length} transaction(s)</p>
      </div>

      <div className="panel shadow-panel overflow-hidden">
        <div className="overflow-x-auto mobile-table-scroll">
          <table className="min-w-full divide-y divide-graphite-border-subtle">
            <thead className="bg-graphite-surface-2/60 border-b border-graphite-border-subtle">
              <tr>
                <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-ink-muted uppercase tracking-wider">Date</th>
                <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-ink-muted uppercase tracking-wider">Category</th>
                <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-ink-muted uppercase tracking-wider hidden sm:table-cell">Source</th>
                <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-ink-muted uppercase tracking-wider hidden md:table-cell">Account</th>
                <th className="px-4 sm:px-6 py-3 text-right text-xs font-medium text-ink-muted uppercase tracking-wider">Amount</th>
                <th className="px-4 sm:px-6 py-3 text-right text-xs font-medium text-ink-muted uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-graphite-border-subtle">
              {income.map((item) => (
                <tr key={item.memberIds.join('-')} className="hover:bg-graphite-surface-hover transition-colors">
                  <td className="px-4 sm:px-6 py-3 sm:py-4 whitespace-nowrap text-xs sm:text-sm text-ink">
                    {formatDate(item.date)}
                  </td>
                  <td className="px-4 sm:px-6 py-3 sm:py-4 whitespace-nowrap">
                  <div className="flex items-center gap-2">
                    {item.category?.icon && <span>{item.category.icon}</span>}
                    <div>
                      <span className="text-sm text-ink">
                        {item.category?.name || 'Uncategorized'}
                      </span>
                      {item.subcategory?.name && (
                        <p className="text-xs text-ink-muted">{item.subcategory.name}</p>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-4 sm:px-6 py-3 sm:py-4 text-xs sm:text-sm text-ink-secondary hidden sm:table-cell">
                  {item.merchantOrSource || '-'}
                </td>
                <td className="px-4 sm:px-6 py-3 sm:py-4 text-xs sm:text-sm text-ink-secondary hidden md:table-cell">
                  {item.accounts.length <= 1 ? (
                    item.accounts[0]?.name || '-'
                  ) : (
                    <div className="space-y-1">
                      {item.accounts.map((acc) => (
                        <div key={`${acc.accountId}-${acc.amount}`} className="flex items-baseline justify-between gap-3">
                          <span>{acc.name}</span>
                          <span className="text-mint money tabular-nums">
                            {formatCurrency(acc.amount)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </td>
                <td className="px-4 sm:px-6 py-3 sm:py-4 whitespace-nowrap text-right text-xs sm:text-sm font-medium text-mint money">
                  {formatCurrency(item.amount)}
                </td>
                <td className="px-4 sm:px-6 py-3 sm:py-4 whitespace-nowrap text-right">
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => handleEdit(item)}
                      className="rounded-lg text-ink-muted hover:text-mint hover:bg-mint-dim transition-colors p-1 touch-target"
                      aria-label="Edit"
                    >
                      <Edit2 size={16} className="sm:w-[18px] sm:h-[18px]" />
                    </button>
                    <button
                      onClick={() => handleDelete(item)}
                      className="rounded-lg text-ink-muted hover:text-danger hover:bg-danger-dim transition-colors p-1 touch-target"
                      aria-label="Delete"
                    >
                      <Trash2 size={16} className="sm:w-[18px] sm:h-[18px]" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>

        {income.length === 0 && (
          <div className="text-center py-12">
            <p className="text-sm sm:text-base text-ink-muted">No income found</p>
          </div>
        )}
      </div>

      <Modal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingIncome(null);
        }}
        title={editingIncome ? 'Edit Income' : 'Add Income'}
        size="lg"
      >
        <IncomeForm
          income={editingIncome || undefined}
          categories={categories}
          accounts={accounts}
          onSuccess={handleSuccess}
          onCancel={() => {
            setIsModalOpen(false);
            setEditingIncome(null);
          }}
        />
      </Modal>
    </div>
  );
}
