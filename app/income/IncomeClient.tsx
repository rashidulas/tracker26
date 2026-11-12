'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus, Filter, X, TrendingUp } from 'lucide-react';
import Modal from '@/components/Modal';
import Button from '@/components/Button';
import Input from '@/components/Input';
import Select from '@/components/Select';
import PageHeader from '@/components/PageHeader';
import { useToast } from '@/components/ToastProvider';
import IncomeForm, { type Account, type Category } from './IncomeForm';
import { groupIncomeRows, type IncomePart, type IncomeRow } from './incomeRows';
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

const EMPTY_FILTERS = { startDate: '', endDate: '', categoryId: '', subcategoryId: '' };

export default function IncomeClient({
  initialParts,
  categories,
  accounts,
}: {
  initialParts: IncomePart[];
  categories: Array<Category & { icon?: string | null }>;
  accounts: Account[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();

  const [parts, setParts] = useState(initialParts);
  useEffect(() => setParts(initialParts), [initialParts]);

  const accountNameById = useMemo(
    () => new Map(accounts.map((a) => [a.id, a.name])),
    [accounts]
  );
  const income = useMemo(() => groupIncomeRows(parts, accountNameById), [parts, accountNameById]);

  const [month, setMonth] = useMonthParam(searchParams.get('month') || currentMonthKey());
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, 200);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [showFilters, setShowFilters] = useState(false);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingIncome, setEditingIncome] = useState<IncomeRow | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const filterSubcategories =
    categories.find((c) => c.id === filters.categoryId)?.subcategories || [];

  const monthOptions = useMemo(() => buildMonthOptions(income.map((i) => i.date)), [income]);

  const filtered = useMemo(
    () =>
      income.filter((item) => {
        if (month !== 'all' && monthKey(item.date) !== month) return false;
        const key = dayKey(item.date);
        if (filters.startDate && key < filters.startDate) return false;
        if (filters.endDate && key > filters.endDate) return false;
        if (filters.categoryId && item.categoryId !== filters.categoryId) return false;
        if (filters.subcategoryId && item.subcategoryId !== filters.subcategoryId) return false;
        return matchesSearch(
          debouncedQuery,
          [
            item.merchantOrSource,
            item.notes,
            item.category?.name,
            item.subcategory?.name,
            ...item.accounts.map((a) => a.name),
            ...item.tags,
          ],
          item.amount
        );
      }),
    [income, month, filters, debouncedQuery]
  );

  const groups = useMemo(() => groupByDay(filtered, (i) => i.date, (i) => i.amount), [filtered]);
  const selection = useSelection(filtered.map((i) => i.id));
  const selectedRows = filtered.filter((i) => selection.selected.has(i.id));
  const selectedTotal = selectedRows.reduce((sum, i) => sum + i.amount, 0);
  const totalIncome = filtered.reduce((sum, item) => sum + item.amount, 0);
  const activeFilterCount = Object.values(filters).filter(Boolean).length;
  const resetKey = `${month}|${debouncedQuery}|${JSON.stringify(filters)}`;

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingIncome(null);
  };

  const markBusy = (id: string, on: boolean) =>
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const handleDuplicate = async (item: IncomeRow) => {
    markBusy(item.id, true);
    const result = await duplicateTransactions(item.memberIds, localTodayKey());
    markBusy(item.id, false);
    if (result.success) {
      setParts((prev) => prependNew(prev, result.data as IncomePart[]));
      if (month !== 'all' && month !== currentMonthKey()) setMonth(currentMonthKey());
      toast.success(`Duplicated “${item.merchantOrSource || item.category?.name || 'income'}” to today`);
    } else {
      toast.error(result.error);
    }
  };

  const removeRows = async (rows: IncomeRow[]) => {
    const ids = rows.flatMap((r) => r.memberIds);
    const result = await deleteTransactions(ids);
    if (result.success) {
      const gone = new Set(ids);
      setParts((prev) => prev.filter((p) => !gone.has(p.id)));
    }
    return result;
  };

  const handleDelete = async (item: IncomeRow) => {
    if (!confirm('Delete this income?')) return;
    markBusy(item.id, true);
    const result = await removeRows([item]);
    markBusy(item.id, false);
    if (result.success) toast.success('Income deleted');
    else toast.error(result.error);
  };

  const handleBulkDelete = async () => {
    const n = selectedRows.length;
    if (!confirm(`Delete ${n} income entr${n === 1 ? 'y' : 'ies'}? This cannot be undone.`)) return;
    setBulkBusy(true);
    const result = await removeRows(selectedRows);
    setBulkBusy(false);
    if (result.success) {
      selection.clear();
      toast.success(`Deleted ${n} income entr${n === 1 ? 'y' : 'ies'}`);
    } else {
      toast.error(result.error);
    }
  };

  const handleBulkRecategorize = async (categoryId: string) => {
    const category = categories.find((c) => c.id === categoryId);
    if (!category) return;
    const ids = selectedRows.flatMap((r) => r.memberIds);
    setBulkBusy(true);
    const result = await recategorizeTransactions(ids, categoryId);
    setBulkBusy(false);
    if (result.success) {
      const moved = new Set(ids);
      setParts((prev) =>
        prev.map((p) =>
          moved.has(p.id)
            ? {
                ...p,
                categoryId,
                category: { id: category.id, name: category.name, icon: category.icon ?? null },
                subcategoryId: null,
                subcategory: null,
              }
            : p
        )
      );
      selection.clear();
      toast.success(`Moved ${selectedRows.length} to ${category.name}`);
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
        title="Income"
        subtitle="Track and manage your income"
        actions={
          <Button onClick={() => { setEditingIncome(null); setIsModalOpen(true); }}>
            <Plus size={18} />
            Add Income
          </Button>
        }
      />

      <ListToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="Search source, notes, category, tag or amount"
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

      {showFilters && (
        <div className="panel shadow-panel p-4 sm:p-6 mb-6">
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
      )}

      <div className="relative overflow-hidden rounded-2xl border border-mint/20 bg-gradient-to-r from-mint-dim/80 to-graphite-surface mb-6 px-5 py-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.16em] text-ink-muted mb-1">
              Total this view
            </p>
            <p className="text-3xl font-semibold text-mint money tracking-tight">
              {formatCurrency(totalIncome)}
            </p>
          </div>
          <p className="text-sm text-ink-secondary">
            {filtered.length} transaction{filtered.length === 1 ? '' : 's'}
          </p>
        </div>
      </div>

      {income.length === 0 ? (
        <div className="panel border-dashed border-graphite-border py-16 px-6 text-center">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-mint-dim flex items-center justify-center mb-4">
            <TrendingUp className="text-mint" size={24} />
          </div>
          <p className="text-ink font-medium font-display text-lg">No income yet</p>
          <div className="flex justify-center mt-6">
            <Button onClick={() => { setEditingIncome(null); setIsModalOpen(true); }}>
              <Plus size={18} />
              Add Income
            </Button>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <EmptyResults query={debouncedQuery} onClear={clearAll} />
      ) : (
        <GroupedList
          groups={groups}
          totalCount={filtered.length}
          resetKey={resetKey}
          getId={(i) => i.id}
          selection={selection}
          totalTone="text-mint"
          formatTotal={(n) => `+${formatCurrency(n)}`}
          renderRow={(item) => (
            <TransactionRow
              key={item.memberIds.join('-')}
              id={item.id}
              selection={selection}
              busy={busyIds.has(item.id)}
              leading={item.category?.icon || '💰'}
              title={item.merchantOrSource || item.category?.name || 'Income'}
              badge={
                item.accounts.length > 1 ? (
                  <span className="px-2 py-0.5 rounded-full text-[11px] bg-graphite-surface-2 text-ink-muted border border-graphite-border-subtle shrink-0">
                    Split ×{item.accounts.length}
                  </span>
                ) : null
              }
              meta={
                <>
                  <span className="truncate">
                    {item.category?.name || 'Uncategorized'}
                    {item.subcategory?.name ? ` / ${item.subcategory.name}` : ''}
                  </span>
                  <span className="text-graphite-border">·</span>
                  <span className="truncate">
                    {item.accounts
                      .map((a) =>
                        item.accounts.length > 1 ? `${a.name} ${formatCurrency(a.amount)}` : a.name
                      )
                      .join(', ') || '—'}
                  </span>
                </>
              }
              amount={`+${formatCurrency(item.amount)}`}
              amountTone="text-mint"
              onDuplicate={() => handleDuplicate(item)}
              onEdit={() => {
                setEditingIncome(item);
                setIsModalOpen(true);
              }}
              onDelete={() => handleDelete(item)}
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
        title={editingIncome ? 'Edit Income' : 'Add Income'}
        size="lg"
      >
        <IncomeForm
          income={editingIncome || undefined}
          categories={categories}
          accounts={accounts}
          onSuccess={() => {
            closeModal();
            router.refresh();
          }}
          onCancel={closeModal}
        />
      </Modal>
    </div>
  );
}
