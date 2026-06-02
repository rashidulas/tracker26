'use client';

import { useState, useEffect } from 'react';
import Modal from '@/components/Modal';
import Button from '@/components/Button';
import Input from '@/components/Input';
import Select from '@/components/Select';
import { deleteIncome, createIncome, updateIncome, getIncome, getCategoriesForSelect, getAccountsForSelect } from './actions';
import { Plus, Edit2, Trash2, Filter, X } from 'lucide-react';
import { format } from 'date-fns';
import { formatDate, formatDateForInput, getLocalTodayForInput } from '@/lib/utils';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

const incomeSchema = z.object({
  date: z.string().min(1, 'Date is required'),
  amount: z.string().min(1, 'Amount is required'),
  categoryId: z.string().min(1, 'Category is required'),
  accountId: z.string().min(1, 'Account is required'),
  merchantOrSource: z.string().optional(),
  notes: z.string().optional(),
  tags: z.string().optional(),
});

type IncomeFormData = z.infer<typeof incomeSchema>;

interface Income {
  id: string;
  date: Date;
  amount: number;
  categoryId: string | null;
  accountId: string | null;
  merchantOrSource: string | null;
  notes: string | null;
  tags: string[];
  category: { id: string; name: string; icon: string | null } | null;
  account: { id: string; name: string } | null;
}

interface Category {
  id: string;
  name: string;
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
  income?: Income;
  categories: Category[];
  accounts: Account[];
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<IncomeFormData>({
    resolver: zodResolver(incomeSchema),
    defaultValues: {
      date: income?.date
        ? formatDateForInput(income.date)
        : getLocalTodayForInput(),
      amount: income?.amount.toString() || '',
      categoryId: income?.categoryId || '',
      accountId: income?.accountId || '',
      merchantOrSource: income?.merchantOrSource || '',
      notes: income?.notes || '',
      tags: income?.tags?.join(', ') || '',
    },
  });

  const onSubmit = async (data: IncomeFormData) => {
    setIsSubmitting(true);
    setError('');

    const formData = new FormData();
    formData.append('date', data.date);
    formData.append('amount', data.amount);
    formData.append('categoryId', data.categoryId);
    formData.append('accountId', data.accountId);
    formData.append('merchantOrSource', data.merchantOrSource || '');
    formData.append('notes', data.notes || '');
    formData.append('tags', data.tags || '');

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
        label="Account"
        {...register('accountId')}
        error={errors.accountId?.message}
        options={[
          { value: '', label: 'Select account...' },
          ...accounts.map((a) => ({ value: a.id, label: a.name })),
        ]}
      />

      <Input
        label="Source (Optional)"
        {...register('merchantOrSource')}
        placeholder="e.g., Company XYZ"
      />

      <div>
        <label className="block text-sm font-medium text-zinc-400 mb-1">
          Notes (Optional)
        </label>
        <textarea
          {...register('notes')}
          className="w-full px-3 py-2 border border-zinc-700 bg-zinc-800/50 text-zinc-100 rounded-lg focus:ring-2 focus:ring-emerald-500/40 focus:outline-none focus:border-transparent"
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
  const [income, setIncome] = useState<Income[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingIncome, setEditingIncome] = useState<Income | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({
    startDate: '',
    endDate: '',
    categoryId: '',
    search: '',
  });

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
        ...(filters.search && { search: filters.search }),
      };

      const [incomeResult, categoriesResult, accountsResult] = await Promise.all([
        getIncome(Object.keys(filterObj).length > 0 ? filterObj : undefined),
        getCategoriesForSelect(),
        getAccountsForSelect(),
      ]);

      if (incomeResult.success && incomeResult.data) {
        setIncome(incomeResult.data);
      }

      if (categoriesResult.success && categoriesResult.data) {
        setCategories(categoriesResult.data);
      }

      if (accountsResult.success && accountsResult.data) {
        setAccounts(accountsResult.data);
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

  const handleEdit = (item: Income) => {
    setEditingIncome(item);
    setIsModalOpen(true);
  };

  const handleAdd = () => {
    setEditingIncome(null);
    setIsModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this income?')) return;
    const result = await deleteIncome(id);
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
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-zinc-500">Loading...</div>
      </div>
    );
  }

  const totalIncome = income.reduce((sum, item) => sum + item.amount, 0);

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white">Income</h1>
          <p className="text-sm sm:text-base text-zinc-400 mt-1">Track and manage your income</p>
        </div>
        <div className="flex gap-3">
          <Button variant="secondary" onClick={() => setShowFilters(!showFilters)} className="flex-1 sm:flex-none">
            <Filter size={20} className="inline mr-2" />
            Filters
          </Button>
          <Button onClick={handleAdd} className="flex-1 sm:flex-none">
            <Plus size={20} className="inline mr-2" />
            Add Income
          </Button>
        </div>
      </div>

      {showFilters && (
        <div className="bg-zinc-900/50 rounded-2xl border border-zinc-800/60 p-4 sm:p-6 mb-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-base sm:text-lg font-semibold text-white">Filters</h3>
            <button onClick={() => setShowFilters(false)} className="text-zinc-500 hover:text-zinc-300 p-1">
              <X size={20} />
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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
              onChange={(e) => setFilters({ ...filters, categoryId: e.target.value })}
              options={[
                { value: '', label: 'All Categories' },
                ...categories.map((c) => ({ value: c.id, label: c.name })),
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
              onClick={() => setFilters({ startDate: '', endDate: '', categoryId: '', search: '' })}
            >
              Clear Filters
            </Button>
          </div>
        </div>
      )}

      <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-4 mb-6">
        <div className="flex justify-between items-center">
          <span className="text-zinc-400 font-medium">Total Income</span>
          <span className="text-2xl font-bold text-emerald-400">{formatCurrency(totalIncome)}</span>
        </div>
        <p className="text-sm text-zinc-400 mt-1">{income.length} transaction(s)</p>
      </div>

      <div className="bg-zinc-900/50 rounded-2xl border border-zinc-800/60 overflow-hidden">
        <div className="overflow-x-auto mobile-table-scroll">
          <table className="min-w-full divide-y divide-zinc-800">
            <thead className="bg-zinc-800/50 border-b border-zinc-800">
              <tr>
                <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-zinc-500 uppercase">Date</th>
                <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-zinc-500 uppercase">Category</th>
                <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-zinc-500 uppercase hidden sm:table-cell">Source</th>
                <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-zinc-500 uppercase hidden md:table-cell">Account</th>
                <th className="px-4 sm:px-6 py-3 text-right text-xs font-medium text-zinc-500 uppercase">Amount</th>
                <th className="px-4 sm:px-6 py-3 text-right text-xs font-medium text-zinc-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {income.map((item) => (
                <tr key={item.id} className="hover:bg-zinc-800/30">
                  <td className="px-4 sm:px-6 py-3 sm:py-4 whitespace-nowrap text-xs sm:text-sm text-white">
                    {formatDate(item.date)}
                  </td>
                  <td className="px-4 sm:px-6 py-3 sm:py-4 whitespace-nowrap">
                  <div className="flex items-center gap-2">
                    {item.category?.icon && <span>{item.category.icon}</span>}
                    <span className="text-sm text-white">{item.category?.name || 'Uncategorized'}</span>
                  </div>
                </td>
                <td className="px-4 sm:px-6 py-3 sm:py-4 text-xs sm:text-sm text-zinc-400 hidden sm:table-cell">
                  {item.merchantOrSource || '-'}
                </td>
                <td className="px-4 sm:px-6 py-3 sm:py-4 whitespace-nowrap text-xs sm:text-sm text-zinc-400 hidden md:table-cell">
                  {item.account?.name || '-'}
                </td>
                <td className="px-4 sm:px-6 py-3 sm:py-4 whitespace-nowrap text-right text-xs sm:text-sm font-medium text-emerald-400">
                  {formatCurrency(item.amount)}
                </td>
                <td className="px-4 sm:px-6 py-3 sm:py-4 whitespace-nowrap text-right">
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => handleEdit(item)}
                      className="text-emerald-400 hover:text-emerald-300 p-1 touch-target"
                      aria-label="Edit"
                    >
                      <Edit2 size={16} className="sm:w-[18px] sm:h-[18px]" />
                    </button>
                    <button
                      onClick={() => handleDelete(item.id)}
                      className="text-red-400 hover:text-red-300 p-1 touch-target"
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
            <p className="text-sm sm:text-base text-zinc-500">No income found</p>
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
