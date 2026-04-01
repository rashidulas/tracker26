'use client';

import { useState, useEffect } from 'react';
import { TrendingDown, DollarSign, Calendar, BarChart3 } from 'lucide-react';
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

  const sortedExpenses = getSortedExpenses();
  const activeFilters = getActiveFilters();

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-white">Expense Dashboard</h1>
        <p className="text-zinc-500 mt-1">Analyze your spending patterns with powerful filters</p>
      </div>

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
          <div className="bg-zinc-900/50 border border-zinc-800/60 rounded-2xl p-6">
            <h2 className="text-lg font-semibold text-white mb-4">Expenses by Category</h2>
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
                  >
                    {chartData.pieData.map((entry: any, index: number) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: number) => formatCurrency(value)} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-center text-zinc-500 py-12">No data to display</div>
            )}
          </div>

          {/* Line Chart */}
          <div className="bg-zinc-900/50 border border-zinc-800/60 rounded-2xl p-6">
            <h2 className="text-lg font-semibold text-white mb-4">Daily Expense Trend</h2>
            {chartData.trendData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chartData.trendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip formatter={(value: number) => formatCurrency(value)} />
                  <Legend />
                  <Line type="monotone" dataKey="amount" stroke="#ef4444" name="Expenses" />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-center text-zinc-500 py-12">No data to display</div>
            )}
          </div>
        </div>
      )}

      {/* Top Categories */}
      {summary?.topCategories && summary.topCategories.length > 0 && (
        <div className="bg-zinc-900/50 border border-zinc-800/60 rounded-2xl p-6 mb-6">
          <h2 className="text-lg font-semibold text-white mb-4">Top 5 Categories</h2>
          <div className="space-y-3">
            {summary.topCategories.map((cat: any, index: number) => (
              <div key={cat.id} className="flex items-center gap-3">
                <span className="text-zinc-500 font-medium w-6">{index + 1}</span>
                {cat.color && (
                  <span className="w-4 h-4 rounded-full" style={{ backgroundColor: cat.color }} />
                )}
                <span className="flex-1 text-zinc-200">{cat.name}</span>
                <span className="font-semibold text-red-400">{formatCurrency(cat.amount)}</span>
                <span className="text-sm text-zinc-500">
                  ({((cat.amount / summary.total) * 100).toFixed(1)}%)
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Expense Table */}
      <div className="bg-zinc-900/50 border border-zinc-800/60 rounded-2xl">
        <div className="px-6 py-4 border-b border-zinc-800">
          <h2 className="text-lg font-semibold text-white">Expense Transactions</h2>
        </div>
        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="text-center py-12 text-zinc-500">Loading...</div>
          ) : sortedExpenses.length === 0 ? (
            <div className="text-center py-12">
              <TrendingDown className="w-16 h-16 text-zinc-700 mx-auto mb-4" />
              <p className="text-zinc-500">No expenses found with current filters</p>
            </div>
          ) : (
            <table className="w-full">
              <thead className="bg-zinc-800/50 border-b border-zinc-800">
                <tr>
                  <th
                    onClick={() => handleSort('date')}
                    className="px-6 py-3 text-left text-xs font-medium text-zinc-500 uppercase cursor-pointer hover:bg-zinc-700/50"
                  >
                    Date {sortBy === 'date' && (sortOrder === 'asc' ? '↑' : '↓')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 uppercase">
                    Merchant
                  </th>
                  <th
                    onClick={() => handleSort('category')}
                    className="px-6 py-3 text-left text-xs font-medium text-zinc-500 uppercase cursor-pointer hover:bg-zinc-700/50"
                  >
                    Category {sortBy === 'category' && (sortOrder === 'asc' ? '↑' : '↓')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 uppercase">
                    Account
                  </th>
                  <th
                    onClick={() => handleSort('amount')}
                    className="px-6 py-3 text-right text-xs font-medium text-zinc-500 uppercase cursor-pointer hover:bg-zinc-700/50"
                  >
                    Amount {sortBy === 'amount' && (sortOrder === 'asc' ? '↑' : '↓')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 uppercase">
                    Notes
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {sortedExpenses.map((expense) => (
                  <tr
                    key={expense.id}
                    onClick={() => handleRowClick(expense)}
                    className="hover:bg-zinc-800/30 cursor-pointer"
                  >
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-white">
                      {formatDate(expense.date)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-white">
                      {expense.merchantOrSource || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <div className="flex items-center gap-2">
                        {expense.category?.color && (
                          <span
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: expense.category.color }}
                          />
                        )}
                        <span className="text-white">{expense.category?.name || 'Uncategorized'}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-500">
                      {expense.account?.name || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-red-400 text-right">
                      {formatCurrency(expense.amount)}
                    </td>
                    <td className="px-6 py-4 text-sm text-zinc-500 max-w-xs truncate">
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
            <div className="bg-zinc-800/50 p-4 rounded-xl space-y-2">
              <div className="flex justify-between">
                <span className="text-sm text-zinc-500">Date:</span>
                <span className="text-sm font-medium text-zinc-200">{formatDate(editingExpense.date)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-zinc-500">Amount:</span>
                <span className="text-lg font-bold text-red-400">{formatCurrency(editingExpense.amount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-zinc-500">Category:</span>
                <span className="text-sm font-medium text-zinc-200">{editingExpense.category?.name || 'Uncategorized'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-zinc-500">Account:</span>
                <span className="text-sm font-medium text-zinc-200">{editingExpense.account?.name || '-'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-zinc-500">Merchant:</span>
                <span className="text-sm font-medium text-zinc-200">{editingExpense.merchantOrSource || '-'}</span>
              </div>
              {editingExpense.notes && (
                <div>
                  <span className="text-sm text-zinc-500 block mb-1">Notes:</span>
                  <span className="text-sm text-zinc-300">{editingExpense.notes}</span>
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
