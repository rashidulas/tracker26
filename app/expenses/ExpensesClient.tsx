'use client';

import { useState } from 'react';
import Modal from '@/components/Modal';
import Button from '@/components/Button';
import Input from '@/components/Input';
import Select from '@/components/Select';
import ExpenseForm from './ExpenseForm';
import { deleteExpense } from './actions';
import ReceiptScanner from './ReceiptScanner';
import { Plus, Edit2, Trash2, Filter, X, Camera } from 'lucide-react';
import { format } from 'date-fns';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { formatDate } from '@/lib/utils';

interface Expense {
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

interface ExpensesClientProps {
  initialExpenses: Expense[];
  categories: Array<{ id: string; name: string }>;
  accounts: Array<{ id: string; name: string }>;
}

export default function ExpensesClient({
  initialExpenses,
  categories,
  accounts,
}: ExpensesClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();

  const now = new Date();
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const selectedMonth = searchParams.get('month') || currentMonthKey;

  const [expenses, setExpenses] = useState(initialExpenses);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({
    startDate: '',
    endDate: '',
    categoryId: '',
    search: '',
  });

  const getMonthOptions = () => {
    const monthsMap = new Map<string, string>();
    
    // Add current month by default
    const currentMonthLabel = format(now, 'MMMM yyyy');
    monthsMap.set(currentMonthKey, currentMonthLabel);
    
    // Add months from initialExpenses (using UTC to prevent timezone shifts)
    initialExpenses.forEach(expense => {
      const d = new Date(expense.date);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      const utcDate = new Date(d.getUTCFullYear(), d.getUTCMonth(), 1);
      const label = format(utcDate, 'MMMM yyyy');
      monthsMap.set(key, label);
    });
    
    // Sort keys descending (most recent first)
    const sortedKeys = Array.from(monthsMap.keys()).sort((a, b) => b.localeCompare(a));
    
    return [
      { value: 'all', label: 'All Months' },
      ...sortedKeys.map(key => ({ value: key, label: monthsMap.get(key)! }))
    ];
  };

  const monthOptions = getMonthOptions();

  const handleMonthChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    const params = new URLSearchParams(searchParams.toString());
    params.set('month', value);
    router.push(`${pathname}?${params.toString()}`);
  };

  const handleSuccess = () => {
    setIsModalOpen(false);
    setEditingExpense(null);
    window.location.reload();
  };

  const handleEdit = (expense: Expense) => {
    setEditingExpense(expense);
    setIsModalOpen(true);
  };

  const handleAdd = () => {
    setEditingExpense(null);
    setIsModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this expense?')) return;

    const result = await deleteExpense(id);
    if (result.success) {
      setExpenses(expenses.filter((e) => e.id !== id));
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  const filteredExpenses = expenses.filter((expense) => {
    if (selectedMonth && selectedMonth !== 'all') {
      const d = new Date(expense.date);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      if (key !== selectedMonth) return false;
    }
    if (filters.startDate && new Date(expense.date) < new Date(filters.startDate)) return false;
    if (filters.endDate && new Date(expense.date) > new Date(filters.endDate)) return false;
    if (filters.categoryId && expense.categoryId !== filters.categoryId) return false;
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      const matchesMerchant = expense.merchantOrSource?.toLowerCase().includes(searchLower);
      const matchesNotes = expense.notes?.toLowerCase().includes(searchLower);
      if (!matchesMerchant && !matchesNotes) return false;
    }
    return true;
  });

  const totalExpenses = filteredExpenses.reduce((sum, expense) => sum + expense.amount, 0);

  return (
    <div>
      <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-white">Expenses</h1>
            <p className="text-sm sm:text-base text-zinc-400 mt-1">Track and manage your expenses</p>
          </div>
          <div className="w-full sm:w-48 sm:mt-2">
            <Select
              options={monthOptions}
              value={selectedMonth}
              onChange={handleMonthChange}
              className="!py-2 text-sm"
            />
          </div>
        </div>
        <div className="flex gap-3 w-full md:w-auto">
          <Button variant="secondary" onClick={() => setShowFilters(!showFilters)} className="flex-1 md:flex-none">
            <Filter size={20} className="inline mr-2" />
            Filters
          </Button>
          <Button variant="secondary" onClick={() => setIsScannerOpen(true)} className="flex-1 md:flex-none">
            <Camera size={20} className="inline mr-2" />
            Scan Receipt
          </Button>
          <Button onClick={handleAdd} className="flex-1 md:flex-none">
            <Plus size={20} className="inline mr-2" />
            Add Expense
          </Button>
        </div>
      </div>

      {/* Filters Panel */}
      {showFilters && (
        <div className="bg-zinc-900/50 border border-zinc-800/60 rounded-2xl p-6 mb-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-semibold text-white">Filters</h3>
            <button onClick={() => setShowFilters(false)} className="text-zinc-500 hover:text-zinc-300">
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
              placeholder="Merchant or notes..."
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

      {/* Summary */}
      <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4 mb-6">
        <div className="flex justify-between items-center">
          <span className="text-zinc-300 font-medium">Total Expenses</span>
          <span className="text-2xl font-bold text-red-400">{formatCurrency(totalExpenses)}</span>
        </div>
        <p className="text-sm text-zinc-400 mt-1">{filteredExpenses.length} transaction(s)</p>
      </div>

      {/* Expenses Table */}
      <div className="bg-zinc-900/50 border border-zinc-800/60 rounded-2xl overflow-hidden">
        <table className="min-w-full divide-y divide-zinc-800">
          <thead className="bg-zinc-800/50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 uppercase">Date</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 uppercase">Category</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 uppercase">Merchant</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 uppercase">Account</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-zinc-500 uppercase">Amount</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-zinc-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-zinc-900/50 divide-y divide-zinc-800">
            {filteredExpenses.map((expense) => (
              <tr key={expense.id} className="hover:bg-zinc-800/30">
                <td className="px-6 py-4 whitespace-nowrap text-sm text-white">
                  {formatDate(expense.date)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center gap-2">
                    {expense.category?.icon && <span>{expense.category.icon}</span>}
                    <span className="text-sm text-white">{expense.category?.name || 'Uncategorized'}</span>
                  </div>
                </td>
                <td className="px-6 py-4 text-sm text-zinc-400">
                  {expense.merchantOrSource || '-'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-400">
                  {expense.account?.name || '-'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium text-red-400">
                  {formatCurrency(expense.amount)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                  <button
                    onClick={() => handleEdit(expense)}
                    className="text-emerald-400 hover:text-emerald-300 mr-4"
                  >
                    <Edit2 size={18} />
                  </button>
                  <button
                    onClick={() => handleDelete(expense.id)}
                    className="text-red-400 hover:text-red-300"
                  >
                    <Trash2 size={18} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {filteredExpenses.length === 0 && (
          <div className="text-center py-12">
            <p className="text-zinc-500">No expenses found</p>
          </div>
        )}
      </div>

      <Modal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingExpense(null);
        }}
        title={editingExpense ? 'Edit Expense' : 'Add Expense'}
        size="lg"
      >
        <ExpenseForm
          expense={editingExpense || undefined}
          categories={categories}
          accounts={accounts}
          onSuccess={handleSuccess}
          onCancel={() => {
            setIsModalOpen(false);
            setEditingExpense(null);
          }}
        />
      </Modal>

      <Modal
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        title="Scan Receipt"
        size="lg"
      >
        <ReceiptScanner
          categories={categories}
          accounts={accounts}
          onSuccess={() => {
            setIsScannerOpen(false);
            window.location.reload();
          }}
          onCancel={() => setIsScannerOpen(false)}
        />
      </Modal>
    </div>
  );
}
