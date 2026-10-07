'use client';

import { useState, useEffect } from 'react';
import { TrendingDown, DollarSign, Calendar, BarChart3 } from 'lucide-react';
import PageHeader from '@/components/PageHeader';
import SummaryCard from '@/components/SummaryCard';
import { formatCurrency, formatDate } from '@/lib/utils';
import { useToast } from '@/components/ToastProvider';
import {
  FilterPanel,
  DateRangeFilter,
  AmountRangeFilter,
  MultiSelectFilter,
  SearchFilter,
  ActiveFilters,
} from '@/components/FilterComponents';
import {
  getFilteredExpenses,
  getExpenseSummary,
  getExpenseChartData,
  getExpenseCategories,
  getAllAccounts,
  type ExpenseFilter,
} from '@/app/dashboards/actions';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Legend } from 'recharts';
import Modal from '@/components/Modal';
import { updateTransaction, deleteTransaction } from '@/app/transactions/actions';
import Button from '@/components/Button';
import Input from '@/components/Input';
import Select from '@/components/Select';

type Transaction = {
  id: string;
  date: Date;
  amount: number;
  merchantOrSource: string | null;
  notes: string | null;
  category: { id: string; name: string; color: string | null } | null;
  account: { id: string; name: string };
};

export default function ExpenseDashboardPage() {
  const [expenses, setExpenses] = useState<Transaction[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [chartData, setChartData] = useState<any>(null);
  const [categories, setCategories] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editingExpense, setEditingExpense] = useState<Transaction | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  
  // Filter state
  const [filters, setFilters] = useState<ExpenseFilter>({});
  const [isFilterOpen, setIsFilterOpen] = useState(true);
  const [sortBy, setSortBy] = useState<'date' | 'amount' | 'category'>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  
  const toast = useToast();

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    loadFilteredData();
  }, [filters]);

  async function loadData() {
    try {
      const [categoriesData, accountsData] = await Promise.all([
        getExpenseCategories(),
        getAllAccounts(),
      ]);
      setCategories(categoriesData);
      setAccounts(accountsData);
    } catch (error) {
      toast.error('Failed to load data');
    }
  }

  async function loadFilteredData() {
    try {
      setIsLoading(true);
      const [expensesData, summaryData, charts] = await Promise.all([
        getFilteredExpenses(filters),
        getExpenseSummary(filters),
        getExpenseChartData(filters),
      ]);
      setExpenses(expensesData as Transaction[]);
      setSummary(summaryData);
      setChartData(charts);
    } catch (error) {
      toast.error('Failed to load expenses');
    } finally {
      setIsLoading(false);
    }
  }

  function clearAllFilters() {
    setFilters({});
  }

  function getActiveFilters() {
    const active: { label: string; value: string; onRemove: () => void }[] = [];
    
    if (filters.startDate) {
      active.push({
        label: 'Start Date',
        value: formatDate(filters.startDate),
        onRemove: () => setFilters({ ...filters, startDate: undefined }),
      });
    }
    if (filters.endDate) {
      active.push({
        label: 'End Date',
        value: formatDate(filters.endDate),
        onRemove: () => setFilters({ ...filters, endDate: undefined }),
      });
    }
    if (filters.minAmount) {
      active.push({
        label: 'Min Amount',
        value: formatCurrency(filters.minAmount),
        onRemove: () => setFilters({ ...filters, minAmount: undefined }),
      });
    }
    if (filters.maxAmount) {
      active.push({
        label: 'Max Amount',
        value: formatCurrency(filters.maxAmount),
        onRemove: () => setFilters({ ...filters, maxAmount: undefined }),
      });
    }
    if (filters.categoryIds && filters.categoryIds.length > 0) {
      active.push({
        label: 'Categories',
        value: `${filters.categoryIds.length} selected`,
        onRemove: () => setFilters({ ...filters, categoryIds: [] }),
      });
    }
    if (filters.accountIds && filters.accountIds.length > 0) {
      active.push({
        label: 'Accounts',
        value: `${filters.accountIds.length} selected`,
        onRemove: () => setFilters({ ...filters, accountIds: [] }),
      });
    }
    if (filters.search) {
      active.push({
        label: 'Search',
        value: filters.search,
        onRemove: () => setFilters({ ...filters, search: undefined }),
      });
    }

    return active;
  }

  function getSortedExpenses() {
    const sorted = [...expenses].sort((a, b) => {
      let comparison = 0;
      
      if (sortBy === 'date') {
        comparison = a.date.getTime() - b.date.getTime();
      } else if (sortBy === 'amount') {
        comparison = a.amount - b.amount;
      } else if (sortBy === 'category') {
        comparison = (a.category?.name || '').localeCompare(b.category?.name || '');
      }

      return sortOrder === 'asc' ? comparison : -comparison;
    });

    return sorted;
  }

  function handleSort(column: 'date' | 'amount' | 'category') {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(column);
      setSortOrder('desc');
    }
  }

  function handleRowClick(expense: Transaction) {
    setEditingExpense(expense);
    setIsModalOpen(true);
  }

  async function handleDelete() {
    if (!editingExpense) return;
    if (!confirm('Delete this expense?')) return;

    const result = await deleteTransaction(editingExpense.id);
    if (result.success) {
      toast.success('Expense deleted');
      setIsModalOpen(false);
      loadFilteredData();
    } else {
      toast.error(result.error || 'Failed to delete');
    }
  }

  function handleCategorySelect(categoryId: string | null | undefined) {
    if (!categoryId) return;
    setFilters(prev => ({
      ...prev,
      categoryIds: [categoryId]
    }));
  }

  const sortedExpenses = getSortedExpenses();
  const activeFilters = getActiveFilters();

  return (
    <div className="page-shell">
      <PageHeader
        title="Expense Dashboard"
        subtitle="Analyze your spending patterns with powerful filters"
      />

      {/* Filters */}
      <FilterPanel
        onClearAll={clearAllFilters}
        activeFilterCount={activeFilters.length}
        isOpen={isFilterOpen}
        onToggle={() => setIsFilterOpen(!isFilterOpen)}
      >
        <div className="space-y-6">
          <DateRangeFilter
            startDate={filters.startDate}
            endDate={filters.endDate}
            onStartDateChange={(date) => setFilters({ ...filters, startDate: date })}
            onEndDateChange={(date) => setFilters({ ...filters, endDate: date })}
          />

          <AmountRangeFilter
            minAmount={filters.minAmount}
            maxAmount={filters.maxAmount}
            onMinAmountChange={(amount) => setFilters({ ...filters, minAmount: amount })}
            onMaxAmountChange={(amount) => setFilters({ ...filters, maxAmount: amount })}
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <MultiSelectFilter
              label="Categories"
              options={categories}
              selectedIds={filters.categoryIds || []}
              onChange={(ids) => setFilters({ ...filters, categoryIds: ids })}
            />

            <MultiSelectFilter
              label="Accounts"
              options={accounts}
              selectedIds={filters.accountIds || []}
              onChange={(ids) => setFilters({ ...filters, accountIds: ids })}
            />
          </div>

          <SearchFilter
            value={filters.search || ''}
            onChange={(value) => setFilters({ ...filters, search: value })}
            placeholder="Search merchant or notes..."
          />
        </div>
      </FilterPanel>

      {/* Active Filters */}
      <ActiveFilters filters={activeFilters} />

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
          <SummaryCard
            title="Total Expenses"
            value={formatCurrency(summary.total)}
            icon={DollarSign}
            color="red"
          />
          <SummaryCard
            title="Average per Day"
            value={formatCurrency(summary.avgPerDay)}
            icon={Calendar}
            color="blue"
          />
          <SummaryCard
            title="Transaction Count"
            value={summary.count.toString()}
            icon={BarChart3}
            color="gray"
          />
          <SummaryCard
            title="Date Range"
            value={`${summary.daysDiff} days`}
            icon={Calendar}
            color="green"
          />
        </div>
      )}

      {/* Charts */}
      {chartData && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          {/* Pie Chart */}
          <div className="panel shadow-panel p-6">
            <h2 className="text-lg font-semibold text-ink font-display mb-4">Expenses by Category</h2>
            {chartData.pieData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={chartData.pieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={100}
                    label={(entry) => `${entry.name}: ${formatCurrency(entry.value)}`}
                    onClick={(data) => {
                      if (data && data.payload) {
                        handleCategorySelect(data.payload.id);
                      }
                    }}
                    style={{ cursor: 'pointer' }}
                  >
                    {chartData.pieData.map((entry: any, index: number) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number) => formatCurrency(value)}
                    contentStyle={{ backgroundColor: '#12151b', border: '1px solid #262b36', borderRadius: 12, color: '#f0f2f5' }} labelStyle={{ color: '#9aa1ad' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-center text-ink-muted py-12">No data to display</div>
            )}
          </div>

          {/* Line Chart */}
          <div className="panel shadow-panel p-6">
            <h2 className="text-lg font-semibold text-ink font-display mb-4">Daily Expense Trend</h2>
            {chartData.trendData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chartData.trendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#262b36" />
                  <XAxis dataKey="date" tick={{ fill: '#6b7280', fontSize: 12 }} stroke="#262b36" />
                  <YAxis tick={{ fill: '#6b7280', fontSize: 12 }} stroke="#262b36" />
                  <Tooltip
                    formatter={(value: number) => formatCurrency(value)}
                    contentStyle={{ backgroundColor: '#12151b', border: '1px solid #262b36', borderRadius: 12, color: '#f0f2f5' }} labelStyle={{ color: '#9aa1ad' }}
                  />
                  <Legend wrapperStyle={{ color: '#9aa1ad' }} />
                  <Line type="monotone" dataKey="amount" stroke="#f07178" name="Expenses" />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-center text-ink-muted py-12">No data to display</div>
            )}
          </div>
        </div>
      )}

      {/* Top Categories */}
      {summary?.topCategories && summary.topCategories.length > 0 && (
        <div className="panel shadow-panel p-6 mb-6">
          <h2 className="text-lg font-semibold text-ink font-display mb-4">Top 5 Categories</h2>
          <div className="space-y-3">
            {summary.topCategories.map((cat: any, index: number) => (
              <div 
                key={cat.id} 
                className="flex items-center gap-3 cursor-pointer hover:bg-graphite-surface-hover p-2 -mx-2 rounded-xl transition-all group"
                onClick={() => handleCategorySelect(cat.id)}
                title={`Filter by ${cat.name}`}
              >
                <span className="text-ink-muted font-medium w-6">{index + 1}</span>
                {cat.color && (
                  <span className="w-4 h-4 rounded-full" style={{ backgroundColor: cat.color }} />
                )}
                <span className="flex-1 text-ink group-hover:text-danger group-hover:underline transition-all">{cat.name}</span>
                <span className="font-semibold text-danger money">{formatCurrency(cat.amount)}</span>
                <span className="text-sm text-ink-muted">
                  ({((cat.amount / summary.total) * 100).toFixed(1)}%)
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Expense Table */}
      <div className="panel shadow-panel">
        <div className="px-6 py-4 border-b border-graphite-border-subtle">
          <h2 className="text-lg font-semibold text-ink font-display">Expense Transactions</h2>
        </div>
        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="text-center py-12 text-ink-muted">Loading...</div>
          ) : sortedExpenses.length === 0 ? (
            <div className="text-center py-12">
              <TrendingDown className="w-16 h-16 text-ink-muted mx-auto mb-4" />
              <p className="text-ink-muted">No expenses found with current filters</p>
            </div>
          ) : (
            <table className="w-full">
              <thead className="bg-graphite-surface-2/60 border-b border-graphite-border-subtle">
                <tr>
                  <th
                    onClick={() => handleSort('date')}
                    className="px-6 py-3 text-left text-xs font-medium text-ink-muted uppercase tracking-wider cursor-pointer hover:bg-graphite-surface-hover"
                  >
                    Date {sortBy === 'date' && (sortOrder === 'asc' ? '↑' : '↓')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-ink-muted uppercase tracking-wider">
                    Merchant
                  </th>
                  <th
                    onClick={() => handleSort('category')}
                    className="px-6 py-3 text-left text-xs font-medium text-ink-muted uppercase tracking-wider cursor-pointer hover:bg-graphite-surface-hover"
                  >
                    Category {sortBy === 'category' && (sortOrder === 'asc' ? '↑' : '↓')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-ink-muted uppercase tracking-wider">
                    Account
                  </th>
                  <th
                    onClick={() => handleSort('amount')}
                    className="px-6 py-3 text-right text-xs font-medium text-ink-muted uppercase tracking-wider cursor-pointer hover:bg-graphite-surface-hover"
                  >
                    Amount {sortBy === 'amount' && (sortOrder === 'asc' ? '↑' : '↓')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-ink-muted uppercase tracking-wider">
                    Notes
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-graphite-border-subtle">
                {sortedExpenses.map((expense) => (
                  <tr
                    key={expense.id}
                    onClick={() => handleRowClick(expense)}
                    className="hover:bg-graphite-surface-hover transition-colors cursor-pointer"
                  >
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-ink">
                      {formatDate(expense.date)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-ink">
                      {expense.merchantOrSource || '-'}
                    </td>
                    <td 
                      className="px-6 py-4 whitespace-nowrap text-sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCategorySelect(expense.category?.id);
                      }}
                    >
                      <div className="flex items-center gap-2 group cursor-pointer" title={`Filter by ${expense.category?.name || 'Uncategorized'}`}>
                        {expense.category?.color && (
                          <span
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: expense.category.color }}
                          />
                        )}
                        <span className="text-ink group-hover:text-danger group-hover:underline transition-all">
                          {expense.category?.name || 'Uncategorized'}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-ink-muted">
                      {expense.account?.name || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-danger text-right money">
                      {formatCurrency(expense.amount)}
                    </td>
                    <td className="px-6 py-4 text-sm text-ink-muted max-w-xs truncate">
                      {expense.notes || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Edit Modal */}
      {editingExpense && (
        <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Expense Details">
          <div className="space-y-4">
            <div className="bg-graphite-surface-2/60 p-4 rounded-xl space-y-2">
              <div className="flex justify-between">
                <span className="text-sm text-ink-muted">Date:</span>
                <span className="text-sm font-medium text-ink">{formatDate(editingExpense.date)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-ink-muted">Amount:</span>
                <span className="text-lg font-semibold text-danger money">{formatCurrency(editingExpense.amount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-ink-muted">Category:</span>
                <span className="text-sm font-medium text-ink">{editingExpense.category?.name || 'Uncategorized'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-ink-muted">Account:</span>
                <span className="text-sm font-medium text-ink">{editingExpense.account?.name || '-'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-ink-muted">Merchant:</span>
                <span className="text-sm font-medium text-ink">{editingExpense.merchantOrSource || '-'}</span>
              </div>
              {editingExpense.notes && (
                <div>
                  <span className="text-sm text-ink-muted block mb-1">Notes:</span>
                  <span className="text-sm text-ink-secondary">{editingExpense.notes}</span>
                </div>
              )}
            </div>

            <div className="flex gap-3">
              <Button onClick={handleDelete} variant="secondary" className="flex-1">
                Delete
              </Button>
              <Button onClick={() => setIsModalOpen(false)} className="flex-1">
                Close
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
