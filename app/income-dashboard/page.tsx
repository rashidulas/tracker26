'use client';

import { useState, useEffect } from 'react';
import { TrendingUp, DollarSign, Calendar, BarChart3 } from 'lucide-react';
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
  getFilteredIncome,
  getIncomeSummary,
  getIncomeChartData,
  getIncomeCategories,
  getAllAccounts,
  type IncomeFilter,
} from '@/app/dashboards/actions';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Legend } from 'recharts';
import Modal from '@/components/Modal';
import { deleteTransaction } from '@/app/transactions/actions';
import Button from '@/components/Button';

type Transaction = {
  id: string;
  date: Date;
  amount: number;
  merchantOrSource: string | null;
  notes: string | null;
  category: { id: string; name: string; color: string | null } | null;
  account: { id: string; name: string };
};

export default function IncomeDashboardPage() {
  const [income, setIncome] = useState<Transaction[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [chartData, setChartData] = useState<any>(null);
  const [categories, setCategories] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editingIncome, setEditingIncome] = useState<Transaction | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  
  // Filter state
  const [filters, setFilters] = useState<IncomeFilter>({});
  const [isFilterOpen, setIsFilterOpen] = useState(true);
  const [sortBy, setSortBy] = useState<'date' | 'amount' | 'source'>('date');
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
        getIncomeCategories(),
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
      const [incomeData, summaryData, charts] = await Promise.all([
        getFilteredIncome(filters),
        getIncomeSummary(filters),
        getIncomeChartData(filters),
      ]);
      setIncome(incomeData as Transaction[]);
      setSummary(summaryData);
      setChartData(charts);
    } catch (error) {
      toast.error('Failed to load income');
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
    if (filters.sourceIds && filters.sourceIds.length > 0) {
      active.push({
        label: 'Sources',
        value: `${filters.sourceIds.length} selected`,
        onRemove: () => setFilters({ ...filters, sourceIds: [] }),
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

  function getSortedIncome() {
    const sorted = [...income].sort((a, b) => {
      let comparison = 0;
      
      if (sortBy === 'date') {
        comparison = a.date.getTime() - b.date.getTime();
      } else if (sortBy === 'amount') {
        comparison = a.amount - b.amount;
      } else if (sortBy === 'source') {
        comparison = (a.category?.name || '').localeCompare(b.category?.name || '');
      }

      return sortOrder === 'asc' ? comparison : -comparison;
    });

    return sorted;
  }

  function handleSort(column: 'date' | 'amount' | 'source') {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(column);
      setSortOrder('desc');
    }
  }

  function handleRowClick(incomeItem: Transaction) {
    setEditingIncome(incomeItem);
    setIsModalOpen(true);
  }

  async function handleDelete() {
    if (!editingIncome) return;
    if (!confirm('Delete this income?')) return;

    const result = await deleteTransaction(editingIncome.id);
    if (result.success) {
      toast.success('Income deleted');
      setIsModalOpen(false);
      loadFilteredData();
    } else {
      toast.error(result.error || 'Failed to delete');
    }
  }

  const sortedIncome = getSortedIncome();
  const activeFilters = getActiveFilters();

  return (
    <div className="page-shell">
      <PageHeader
        title="Income Dashboard"
        subtitle="Track and analyze your income sources and patterns"
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
              label="Income Sources"
              options={categories}
              selectedIds={filters.sourceIds || []}
              onChange={(ids) => setFilters({ ...filters, sourceIds: ids })}
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
            placeholder="Search description or notes..."
          />
        </div>
      </FilterPanel>

      {/* Active Filters */}
      <ActiveFilters filters={activeFilters} />

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
          <SummaryCard
            title="Total Income"
            value={formatCurrency(summary.total)}
            icon={DollarSign}
            color="green"
          />
          <SummaryCard
            title="Average per Day"
            value={formatCurrency(summary.avgPerDay)}
            icon={Calendar}
            color="blue"
          />
          <SummaryCard
            title="Average per Month"
            value={formatCurrency(summary.avgPerMonth)}
            icon={BarChart3}
            color="purple"
          />
          <SummaryCard
            title="Transaction Count"
            value={summary.count.toString()}
            icon={TrendingUp}
            color="gray"
          />
        </div>
      )}

      {/* Charts */}
      {chartData && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          {/* Bar Chart */}
          <div className="panel shadow-panel p-6">
            <h2 className="text-lg font-semibold text-ink font-display mb-4">Income by Source</h2>
            {chartData.barData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={chartData.barData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#262b36" />
                  <XAxis dataKey="name" tick={{ fill: '#6b7280', fontSize: 12 }} stroke="#262b36" />
                  <YAxis tick={{ fill: '#6b7280', fontSize: 12 }} stroke="#262b36" />
                  <Tooltip
                    formatter={(value: number) => formatCurrency(value)}
                    contentStyle={{ backgroundColor: '#12151b', border: '1px solid #262b36', borderRadius: 12, color: '#f0f2f5' }} labelStyle={{ color: '#9aa1ad' }}
                  />
                  <Bar dataKey="amount" fill="#3dcea6" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-center text-ink-muted py-12">No data to display</div>
            )}
          </div>

          {/* Line Chart */}
          <div className="panel shadow-panel p-6">
            <h2 className="text-lg font-semibold text-ink font-display mb-4">Income Trend</h2>
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
                  <Line type="monotone" dataKey="amount" stroke="#3dcea6" name="Income" />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-center text-ink-muted py-12">No data to display</div>
            )}
          </div>
        </div>
      )}

      {/* Source Breakdown */}
      {summary?.sourceBreakdown && summary.sourceBreakdown.length > 0 && (
        <div className="panel shadow-panel p-6 mb-6">
          <h2 className="text-lg font-semibold text-ink font-display mb-4">Income Sources Breakdown</h2>
          <div className="space-y-3">
            {summary.sourceBreakdown.map((source: any, index: number) => (
              <div key={source.id} className="flex items-center gap-3">
                <span className="text-ink-muted font-medium w-6">{index + 1}</span>
                {source.color && (
                  <span className="w-4 h-4 rounded-full" style={{ backgroundColor: source.color }} />
                )}
                <span className="flex-1 text-ink">{source.name}</span>
                <span className="font-semibold text-mint money">{formatCurrency(source.amount)}</span>
                <span className="text-sm text-ink-muted">
                  ({((source.amount / summary.total) * 100).toFixed(1)}%)
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Income Table */}
      <div className="panel shadow-panel">
        <div className="px-6 py-4 border-b border-graphite-border-subtle">
          <h2 className="text-lg font-semibold text-ink font-display">Income Transactions</h2>
        </div>
        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="text-center py-12 text-ink-muted">Loading...</div>
          ) : sortedIncome.length === 0 ? (
            <div className="text-center py-12">
              <TrendingUp className="w-16 h-16 text-ink-muted mx-auto mb-4" />
              <p className="text-ink-muted">No income found with current filters</p>
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
                  <th
                    onClick={() => handleSort('source')}
                    className="px-6 py-3 text-left text-xs font-medium text-ink-muted uppercase tracking-wider cursor-pointer hover:bg-graphite-surface-hover"
                  >
                    Income Source {sortBy === 'source' && (sortOrder === 'asc' ? '↑' : '↓')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-ink-muted uppercase tracking-wider">
                    Description
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
                {sortedIncome.map((incomeItem) => (
                  <tr
                    key={incomeItem.id}
                    onClick={() => handleRowClick(incomeItem)}
                    className="hover:bg-graphite-surface-hover transition-colors cursor-pointer"
                  >
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-ink">
                      {formatDate(incomeItem.date)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <div className="flex items-center gap-2">
                        {incomeItem.category?.color && (
                          <span
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: incomeItem.category.color }}
                          />
                        )}
                        <span className="text-ink">{incomeItem.category?.name || 'Uncategorized'}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-ink">
                      {incomeItem.merchantOrSource || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-ink-muted">
                      {incomeItem.account?.name || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-mint text-right money">
                      {formatCurrency(incomeItem.amount)}
                    </td>
                    <td className="px-6 py-4 text-sm text-ink-muted max-w-xs truncate">
                      {incomeItem.notes || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* View/Delete Modal */}
      {editingIncome && (
        <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Income Details">
          <div className="space-y-4">
            <div className="bg-graphite-surface-2/60 p-4 rounded-xl space-y-2">
              <div className="flex justify-between">
                <span className="text-sm text-ink-muted">Date:</span>
                <span className="text-sm font-medium text-ink">{formatDate(editingIncome.date)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-ink-muted">Amount:</span>
                <span className="text-lg font-semibold text-mint money">{formatCurrency(editingIncome.amount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-ink-muted">Source:</span>
                <span className="text-sm font-medium text-ink">{editingIncome.category?.name || 'Uncategorized'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-ink-muted">Account:</span>
                <span className="text-sm font-medium text-ink">{editingIncome.account?.name || '-'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-ink-muted">Description:</span>
                <span className="text-sm font-medium text-ink">{editingIncome.merchantOrSource || '-'}</span>
              </div>
              {editingIncome.notes && (
                <div>
                  <span className="text-sm text-ink-muted block mb-1">Notes:</span>
                  <span className="text-sm text-ink-secondary">{editingIncome.notes}</span>
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
