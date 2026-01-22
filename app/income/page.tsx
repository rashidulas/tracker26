'use client';

import { useState } from 'react';
import Modal from '@/components/Modal';
import Button from '@/components/Button';
import Input from '@/components/Input';
import Select from '@/components/Select';
import { deleteIncome, createIncome, updateIncome } from './actions';
import { Plus, Edit2, Trash2, Filter, X } from 'lucide-react';
import { format } from 'date-fns';
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
  categoryId: string;
  accountId: string;
  merchantOrSource: string | null;
  notes: string | null;
  tags: string[];
  category: { id: string; name: string; icon: string | null };
  account: { id: string; name: string };
}

interface IncomeClientProps {
  initialIncome: Income[];
  categories: Array<{ id: string; name: string }>;
  accounts: Array<{ id: string; name: string }>;
}

function IncomeForm({
  income,
  categories,
  accounts,
  onSuccess,
  onCancel,
}: {
  income?: Income;
  categories: Array<{ id: string; name: string }>;
  accounts: Array<{ id: string; name: string }>;
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
        ? new Date(income.date).toISOString().split('T')[0]
        : new Date().toISOString().split('T')[0],
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
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
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
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Notes (Optional)
        </label>
        <textarea
          {...register('notes')}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          rows={3}
          placeholder="Add notes..."
        />
      </div>

      <Input
        label="Tags (Optional, comma-separated)"
        {...register('tags')}
        placeholder="e.g., bonus, consulting"
      />

      <div className="flex gap-3 pt-4">
        <Button type="submit" disabled={isSubmitting} className="flex-1">
          {isSubmitting ? 'Saving...' : income ? 'Update' : 'Create'}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export default function IncomeClient({
  initialIncome,
  categories,
  accounts,
}: IncomeClientProps) {
  const [income, setIncome] = useState(initialIncome);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingIncome, setEditingIncome] = useState<Income | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({
    startDate: '',
    endDate: '',
    categoryId: '',
    search: '',
  });

  const handleSuccess = () => {
    setIsModalOpen(false);
    setEditingIncome(null);
    window.location.reload();
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
      setIncome(income.filter((i) => i.id !== id));
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  const filteredIncome = income.filter((item) => {
    if (filters.startDate && new Date(item.date) < new Date(filters.startDate)) return false;
    if (filters.endDate && new Date(item.date) > new Date(filters.endDate)) return false;
    if (filters.categoryId && item.categoryId !== filters.categoryId) return false;
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      const matchesSource = item.merchantOrSource?.toLowerCase().includes(searchLower);
      const matchesNotes = item.notes?.toLowerCase().includes(searchLower);
      if (!matchesSource && !matchesNotes) return false;
    }
    return true;
  });

  const totalIncome = filteredIncome.reduce((sum, item) => sum + item.amount, 0);

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Income</h1>
          <p className="text-gray-600 mt-1">Track and manage your income</p>
        </div>
        <div className="flex gap-3">
          <Button variant="secondary" onClick={() => setShowFilters(!showFilters)}>
            <Filter size={20} className="inline mr-2" />
            Filters
          </Button>
          <Button onClick={handleAdd}>
            <Plus size={20} className="inline mr-2" />
            Add Income
          </Button>
        </div>
      </div>

      {showFilters && (
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-semibold text-gray-900">Filters</h3>
            <button onClick={() => setShowFilters(false)} className="text-gray-400 hover:text-gray-600">
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

      <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
        <div className="flex justify-between items-center">
          <span className="text-gray-700 font-medium">Total Income</span>
          <span className="text-2xl font-bold text-green-600">{formatCurrency(totalIncome)}</span>
        </div>
        <p className="text-sm text-gray-600 mt-1">{filteredIncome.length} transaction(s)</p>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Category</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Source</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Account</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {filteredIncome.map((item) => (
              <tr key={item.id} className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {format(new Date(item.date), 'MMM dd, yyyy')}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center gap-2">
                    {item.category.icon && <span>{item.category.icon}</span>}
                    <span className="text-sm text-gray-900">{item.category.name}</span>
                  </div>
                </td>
                <td className="px-6 py-4 text-sm text-gray-600">
                  {item.merchantOrSource || '-'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                  {item.account.name}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium text-green-600">
                  {formatCurrency(item.amount)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                  <button
                    onClick={() => handleEdit(item)}
                    className="text-blue-600 hover:text-blue-900 mr-4"
                  >
                    <Edit2 size={18} />
                  </button>
                  <button
                    onClick={() => handleDelete(item.id)}
                    className="text-red-600 hover:text-red-900"
                  >
                    <Trash2 size={18} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {filteredIncome.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-500">No income found</p>
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
