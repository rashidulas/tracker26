'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus, Filter, X, Camera, Receipt, ArrowRight } from 'lucide-react';
import Modal from '@/components/Modal';
import Button from '@/components/Button';
import Input from '@/components/Input';
import Select from '@/components/Select';
import PageHeader from '@/components/PageHeader';
import { useToast } from '@/components/ToastProvider';
import ExpenseForm from './ExpenseForm';
import ReceiptScanner from './ReceiptScanner';
import {
  deleteTransactions,
  duplicateTransactions,
  recategorizeTransactions,
} from '@/app/transactions/actions';
import { formatCurrency } from '@/lib/utils';
import {
  buildMonthOptions,
  currentMonthKey,
  dayKey,
  groupByDay,
  localTodayKey,
  matchesSearch,
  monthKey,
  prependNew,
} from '@/lib/transactionList';
import {
  BulkActionBar,
  EmptyResults,
  GroupedList,
  ListToolbar,
  TransactionRow,
  useDebouncedValue,
  useMonthParam,
  useSelection,
} from '@/components/transactions/TransactionList';

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

const EMPTY_FILTERS = { startDate: '', endDate: '', categoryId: '', subcategoryId: '' };

export default function ExpensesClient({
  initialExpenses,
  categories,
  accounts,
}: ExpensesClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();

  const [expenses, setExpenses] = useState(initialExpenses);
  useEffect(() => setExpenses(initialExpenses), [initialExpenses]);

  const [month, setMonth] = useMonthParam(searchParams.get('month') || currentMonthKey());
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, 200);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [showFilters, setShowFilters] = useState(false);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const filterSubcategories =
    categories.find((c) => c.id === filters.categoryId)?.subcategories || [];

  const monthOptions = useMemo(
    () => buildMonthOptions(expenses.map((e) => e.date)),
    [expenses]
  );

  const filteredExpenses = useMemo(
    () =>
      expenses.filter((expense) => {
        if (month !== 'all' && monthKey(expense.date) !== month) return false;
        const key = dayKey(expense.date);
        if (filters.startDate && key < filters.startDate) return false;
        if (filters.endDate && key > filters.endDate) return false;
        if (filters.categoryId && expense.categoryId !== filters.categoryId) return false;
        if (filters.subcategoryId && expense.subcategoryId !== filters.subcategoryId) return false;
        return matchesSearch(
          debouncedQuery,
          [
            expense.merchantOrSource,
            expense.notes,
            expense.category?.name,
            expense.subcategory?.name,
            expense.account?.name,
            expense.toAccount?.name,
            ...expense.tags,
          ],
          expense.amount
        );
      }),
    [expenses, month, filters, debouncedQuery]
  );

  const groups = useMemo(
    () => groupByDay(filteredExpenses, (e) => e.date, (e) => e.amount),
    [filteredExpenses]
  );

  const selection = useSelection(filteredExpenses.map((e) => e.id));
  const selectedTotal = filteredExpenses
    .filter((e) => selection.selected.has(e.id))
    .reduce((sum, e) => sum + e.amount, 0);

  const totalExpenses = filteredExpenses.reduce((sum, e) => sum + e.amount, 0);
  const activeFilterCount = Object.values(filters).filter(Boolean).length;
  const resetKey = `${month}|${debouncedQuery}|${JSON.stringify(filters)}`;

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingExpense(null);
  };

  const handleSuccess = () => {
    closeModal();
    router.refresh();
  };

  const markBusy = (ids: string[], on: boolean) =>
    setBusyIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
      return next;
    });

  const handleDuplicate = async (expense: Expense) => {
    markBusy([expense.id], true);
    const result = await duplicateTransactions([expense.id], localTodayKey());
    markBusy([expense.id], false);
    if (result.success) {
      setExpenses((prev) => prependNew(prev, result.data as Expense[]));
      if (month !== 'all' && month !== currentMonthKey()) setMonth(currentMonthKey());
      toast.success(`Duplicated “${expense.merchantOrSource || expense.category?.name || 'expense'}” to today`);
    } else {
      toast.error(result.error);
    }
  };

  const handleDelete = async (expense: Expense) => {
    if (!confirm('Delete this expense?')) return;
    markBusy([expense.id], true);
    const result = await deleteTransactions([expense.id]);
    markBusy([expense.id], false);
    if (result.success) {
      setExpenses((prev) => prev.filter((e) => e.id !== expense.id));
      toast.success('Expense deleted');
    } else {
      toast.error(result.error);
    }
  };

  const handleBulkDelete = async () => {
    const ids = Array.from(selection.selected);
    if (!confirm(`Delete ${ids.length} transaction${ids.length === 1 ? '' : 's'}? This cannot be undone.`)) return;
    setBulkBusy(true);
    const result = await deleteTransactions(ids);
    setBulkBusy(false);
    if (result.success) {
      const gone = new Set(ids);
      setExpenses((prev) => prev.filter((e) => !gone.has(e.id)));
      selection.clear();
      toast.success(`Deleted ${result.count} transaction${result.count === 1 ? '' : 's'}`);
    } else {
      toast.error(result.error);
    }
  };

  const handleBulkRecategorize = async (categoryId: string) => {
    const ids = Array.from(selection.selected);
    const category = categories.find((c) => c.id === categoryId);
    if (!category) return;
    setBulkBusy(true);
    const result = await recategorizeTransactions(ids, categoryId);
    setBulkBusy(false);
    if (result.success) {
      const moved = new Set(ids);
      setExpenses((prev) =>
        prev.map((e) =>
          moved.has(e.id) && e.kind === 'EXPENSE'
            ? {
                ...e,
                categoryId,
                category: { id: category.id, name: category.name, icon: category.icon ?? null },
                subcategoryId: null,
                subcategory: null,
              }
            : e
        )
      );
      selection.clear();
      const skipped = ids.length - result.count;
      toast.success(
        `Moved ${result.count} to ${category.name}` +
          (skipped > 0 ? ` (${skipped} transfer${skipped === 1 ? '' : 's'} skipped)` : '')
      );
    } else {
      toast.error(result.error);
    }
  };

  const clearAll = () => {
    setQuery('');
    setFilters(EMPTY_FILTERS);
    setMonth('all');
  };

  return (
    <div className="page-shell">
      <PageHeader
        title="Expenses"
        subtitle="Log spending quickly — filter when you need the detail"
        actions={
          <>
            <Button variant="secondary" onClick={() => setIsScannerOpen(true)}>
              <Camera size={18} />
              Scan
            </Button>
            <Button onClick={() => { setEditingExpense(null); setIsModalOpen(true); }}>
              <Plus size={18} />
              Add Expense
            </Button>
          </>
        }
      />

      <ListToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="Search merchant, notes, category, tag or amount"
        month={month}
        monthOptions={monthOptions}
        onMonthChange={setMonth}
        selecting={selection.selecting}
        onToggleSelecting={() => selection.setSelecting(!selection.selecting)}
      >
        <button
          type="button"
          onClick={() => setShowFilters((s) => !s)}
          className="relative inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl border border-graphite-border text-sm text-ink-secondary hover:text-ink hover:bg-graphite-surface-hover shrink-0"
          aria-expanded={showFilters}
        >
          <Filter size={16} />
          <span className="hidden sm:inline">Filters</span>
          {activeFilterCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-mint text-graphite text-[10px] font-bold flex items-center justify-center">
              {activeFilterCount}
            </span>
          )}
        </button>
      </ListToolbar>

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
                  aria-label="Close filters"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
                    setFilters({ ...filters, categoryId: e.target.value, subcategoryId: '' })
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
              </div>
              <div className="mt-4">
                <Button variant="secondary" size="sm" onClick={() => setFilters(EMPTY_FILTERS)}>
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
            {filteredExpenses.length} transaction{filteredExpenses.length === 1 ? '' : 's'}
          </p>
        </div>
      </div>

      {expenses.length === 0 ? (
        <div className="panel border-dashed border-graphite-border py-16 px-6 text-center">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-danger-dim flex items-center justify-center mb-4">
            <Receipt className="text-danger" size={24} />
          </div>
          <p className="text-ink font-medium font-display text-lg">No expenses yet</p>
          <p className="text-ink-muted text-sm mt-1.5">
            Add one manually or scan a receipt to get started.
          </p>
          <div className="flex flex-wrap justify-center gap-2 mt-6">
            <Button onClick={() => { setEditingExpense(null); setIsModalOpen(true); }}>
              <Plus size={18} />
              Add Expense
            </Button>
            <Button variant="secondary" onClick={() => setIsScannerOpen(true)}>
              <Camera size={18} />
              Scan Receipt
            </Button>
          </div>
        </div>
      ) : filteredExpenses.length === 0 ? (
        <EmptyResults query={debouncedQuery} onClear={clearAll} />
      ) : (
        <GroupedList
          groups={groups}
          totalCount={filteredExpenses.length}
          resetKey={resetKey}
          getId={(e) => e.id}
          selection={selection}
          totalTone="text-danger"
          renderRow={(expense) => (
            <TransactionRow
              key={expense.id}
              id={expense.id}
              selection={selection}
              busy={busyIds.has(expense.id)}
              leading={expense.category?.icon || '💸'}
              title={expense.merchantOrSource || expense.category?.name || 'Untitled expense'}
              badge={
                expense.subcategory?.name ? (
                  <span className="hidden sm:inline px-2 py-0.5 rounded-full text-[11px] bg-graphite-surface-2 text-ink-muted border border-graphite-border-subtle shrink-0">
                    {expense.subcategory.name}
                  </span>
                ) : null
              }
              meta={
                <>
                  <span className="truncate">{expense.category?.name || 'Uncategorized'}</span>
                  {(expense.account || expense.toAccount) && (
                    <>
                      <span className="text-graphite-border">·</span>
                      {expense.toAccount ? (
                        <span className="inline-flex items-center gap-1 truncate">
                          {expense.account?.name || '—'}
                          <ArrowRight size={10} className="shrink-0" />
                          {expense.toAccount.name}
                        </span>
                      ) : (
                        <span className="truncate">{expense.account?.name}</span>
                      )}
                    </>
                  )}
                  {expense.tags.length > 0 && (
                    <span className="hidden md:inline truncate text-ink-muted/80">
                      · {expense.tags.map((t) => `#${t}`).join(' ')}
                    </span>
                  )}
                </>
              }
              amount={formatCurrency(expense.amount)}
              amountTone={expense.kind === 'TRANSFER' ? 'text-info' : 'text-danger'}
              onDuplicate={() => handleDuplicate(expense)}
              onEdit={() => {
                setEditingExpense(expense);
                setIsModalOpen(true);
              }}
              onDelete={() => handleDelete(expense)}
            />
          )}
        />
      )}

      <BulkActionBar
        count={selection.selected.size}
        total={selectedTotal}
        categories={categories}
        onRecategorize={handleBulkRecategorize}
        onDelete={handleBulkDelete}
        onClear={selection.clear}
        busy={bulkBusy}
      />

      <Modal
        isOpen={isModalOpen}
        onClose={closeModal}
        title={editingExpense ? 'Edit expense' : 'Add expense'}
        description="Amount first, then category — details stay optional."
        size="lg"
        footer={
          <div className="flex gap-3">
            <Button type="button" variant="secondary" onClick={closeModal} className="flex-1">
              Cancel
            </Button>
            <Button type="submit" form="expense-form" disabled={isSubmitting} className="flex-1">
              {isSubmitting ? 'Saving...' : editingExpense ? 'Save changes' : 'Add Expense'}
            </Button>
          </div>
        }
      >
        <ExpenseForm
          expense={editingExpense || undefined}
          categories={categories}
          accounts={accounts}
          onSuccess={handleSuccess}
          onCancel={closeModal}
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
            router.refresh();
          }}
          onCancel={() => setIsScannerOpen(false)}
        />
      </Modal>
    </div>
  );
}
