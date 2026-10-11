'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Modal from '@/components/Modal';
import Button from '@/components/Button';
import Input from '@/components/Input';
import Select from '@/components/Select';
import ExpenseForm from './ExpenseForm';
import { deleteExpense } from './actions';
import ReceiptScanner from './ReceiptScanner';
import PageHeader from '@/components/PageHeader';
import {
  Plus,
  Pencil,
  Trash2,
  Filter,
  X,
  Camera,
  Receipt,
  ArrowRight,
} from 'lucide-react';
import { format } from 'date-fns';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { formatDate } from '@/lib/utils';

interface Expense {
  id: string;
  date: Date;
  amount: number;
  kind: string;
  categoryId: string | null;
  subcategoryId?: string | null;
  accountId: string | null;
  merchantOrSource: string | null;
  notes: string | null;
  tags: string[];
  category: { id: string; name: string; icon: string | null } | null;
  subcategory?: { id: string; name: string } | null;
  account: { id: string; name: string } | null;
  toAccount: { id: string; name: string } | null;
}

interface ExpensesClientProps {
  initialExpenses: Expense[];
  categories: Array<{
    id: string;
    name: string;
    icon?: string | null;
    color?: string | null;
    subcategories?: Array<{ id: string; name: string }>;
  }>;
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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [filters, setFilters] = useState({
    startDate: '',
    endDate: '',
    categoryId: '',
    subcategoryId: '',
    search: '',
  });

  const filterSubcategories =
    categories.find((c) => c.id === filters.categoryId)?.subcategories || [];

  const getMonthOptions = () => {
    const monthsMap = new Map<string, string>();
    const currentMonthLabel = format(now, 'MMMM yyyy');
    monthsMap.set(currentMonthKey, currentMonthLabel);

    initialExpenses.forEach((expense) => {
      const d = new Date(expense.date);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      const utcDate = new Date(d.getUTCFullYear(), d.getUTCMonth(), 1);
      const label = format(utcDate, 'MMMM yyyy');
      monthsMap.set(key, label);
    });

    const sortedKeys = Array.from(monthsMap.keys()).sort((a, b) => b.localeCompare(a));

    return [
      { value: 'all', label: 'All Months' },
      ...sortedKeys.map((key) => ({ value: key, label: monthsMap.get(key)! })),
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
    if (!confirm('Delete this expense?')) return;

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
    if (filters.subcategoryId && expense.subcategoryId !== filters.subcategoryId) return false;
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      const matchesMerchant = expense.merchantOrSource?.toLowerCase().includes(searchLower);
      const matchesNotes = expense.notes?.toLowerCase().includes(searchLower);
      if (!matchesMerchant && !matchesNotes) return false;
    }
    return true;
  });

  const totalExpenses = filteredExpenses.reduce((sum, expense) => sum + expense.amount, 0);
  const activeFilterCount = [
    filters.startDate,
    filters.endDate,
    filters.categoryId,
    filters.subcategoryId,
    filters.search,
  ].filter(Boolean).length;

  return (
    <div className="page-shell">
      <PageHeader
        title="Expenses"
        subtitle="Log spending quickly — filter when you need the detail"
        actions={
          <>
            <div className="w-full sm:w-44">
              <Select
                options={monthOptions}
                value={selectedMonth}
                onChange={handleMonthChange}
                className="!py-2 text-sm"
              />
            </div>
            <Button
              variant="secondary"
              onClick={() => setShowFilters(!showFilters)}
              className="relative"
            >
              <Filter size={18} />
              Filters
              {activeFilterCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-mint text-graphite text-[10px] font-bold flex items-center justify-center">
                  {activeFilterCount}
                </span>
              )}
            </Button>
            <Button variant="secondary" onClick={() => setIsScannerOpen(true)}>
              <Camera size={18} />
              Scan
            </Button>
            <Button onClick={handleAdd}>
              <Plus size={18} />
              Add Expense
            </Button>
          </>
        }
      />

      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden mb-6"
          >
            <div className="panel shadow-panel p-5 sm:p-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-semibold text-ink font-display">Filters</h3>
                <button
                  onClick={() => setShowFilters(false)}
                  className="text-ink-muted hover:text-ink transition-colors p-1.5 rounded-lg hover:bg-graphite-surface-2"
                >
                  <X size={18} />
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
                      label: filters.categoryId
                        ? 'All Subcategories'
                        : 'Select category first',
                    },
                    ...filterSubcategories.map((s) => ({ value: s.id, label: s.name })),
                  ]}
                />
                <Input
                  label="Search"
                  placeholder="Merchant or notes…"
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
          </motion.div>
        )}
      </AnimatePresence>

      {/* Summary strip */}
      <div className="relative overflow-hidden rounded-2xl border border-danger/20 bg-gradient-to-r from-danger-dim/80 to-graphite-surface mb-6 px-5 py-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.16em] text-ink-muted mb-1">
              Total this view
            </p>
            <p className="text-3xl font-semibold text-danger money tracking-tight">
              {formatCurrency(totalExpenses)}
            </p>
          </div>
          <p className="text-sm text-ink-secondary">
            {filteredExpenses.length} transaction
            {filteredExpenses.length === 1 ? '' : 's'}
          </p>
        </div>
      </div>

      {/* Expense list */}
      {filteredExpenses.length === 0 ? (
        <div className="panel border-dashed border-graphite-border py-16 px-6 text-center">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-danger-dim flex items-center justify-center mb-4">
            <Receipt className="text-danger" size={24} />
          </div>
          <p className="text-ink font-medium font-display text-lg">No expenses found</p>
          <p className="text-ink-muted text-sm mt-1.5">
            Add one manually or scan a receipt to get started.
          </p>
          <div className="flex flex-wrap justify-center gap-2 mt-6">
            <Button onClick={handleAdd}>
              <Plus size={18} />
              Add Expense
            </Button>
            <Button variant="secondary" onClick={() => setIsScannerOpen(true)}>
              <Camera size={18} />
              Scan Receipt
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredExpenses.map((expense, index) => (
            <motion.div
              key={expense.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(index * 0.03, 0.3), duration: 0.35 }}
              className="group flex items-center gap-3 sm:gap-4 rounded-2xl border border-graphite-border-subtle bg-graphite-surface px-3.5 sm:px-5 py-3.5 hover:border-graphite-border hover:bg-graphite-surface-hover transition-all duration-200"
            >
              <div className="w-11 h-11 rounded-xl bg-graphite-surface-2 border border-graphite-border-subtle flex items-center justify-center text-lg shrink-0">
                {expense.category?.icon || '💸'}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-medium text-ink truncate">
                    {expense.merchantOrSource ||
                      expense.category?.name ||
                      'Untitled expense'}
                  </p>
                  {expense.subcategory?.name && (
                    <span className="px-2 py-0.5 rounded-full text-[11px] bg-graphite-surface-2 text-ink-muted border border-graphite-border-subtle">
                      {expense.subcategory.name}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5 text-xs text-ink-muted">
                  <span>{formatDate(expense.date)}</span>
                  <span className="text-graphite-border">·</span>
                  <span>{expense.category?.name || 'Uncategorized'}</span>
                  {(expense.account || expense.toAccount) && (
                    <>
                      <span className="text-graphite-border">·</span>
                      {expense.toAccount ? (
                        <span className="inline-flex items-center gap-1">
                          {expense.account?.name || '—'}
                          <ArrowRight size={10} />
                          {expense.toAccount.name}
                        </span>
                      ) : (
                        <span>{expense.account?.name}</span>
                      )}
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1 sm:gap-2 shrink-0">
                <p
                  className={`text-sm sm:text-base font-semibold money tabular-nums ${
                    expense.kind === 'TRANSFER' ? 'text-info' : 'text-danger'
                  }`}
                >
                  {formatCurrency(expense.amount)}
                </p>
                <div className="flex items-center opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity ml-1">
                  <button
                    onClick={() => handleEdit(expense)}
                    className="p-2 rounded-xl text-ink-muted hover:text-mint hover:bg-mint-dim transition-colors"
                    aria-label="Edit expense"
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    onClick={() => handleDelete(expense.id)}
                    className="p-2 rounded-xl text-ink-muted hover:text-danger hover:bg-danger-dim transition-colors"
                    aria-label="Delete expense"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      <Modal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingExpense(null);
        }}
        title={editingExpense ? 'Edit expense' : 'Add expense'}
        description="Amount first, then category — details stay optional."
        size="lg"
        footer={
          <div className="flex gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setIsModalOpen(false);
                setEditingExpense(null);
              }}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form="expense-form"
              disabled={isSubmitting}
              className="flex-1"
            >
              {isSubmitting
                ? 'Saving...'
                : editingExpense
                ? 'Save changes'
                : 'Add Expense'}
            </Button>
          </div>
        }
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
          hideActions
          onSubmittingChange={setIsSubmitting}
          formId="expense-form"
        />
      </Modal>

      <Modal
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        title="Scan receipt"
        description="Snap a receipt and review the draft before saving."
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
