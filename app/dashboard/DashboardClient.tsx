'use client';

import SummaryCard from '@/components/SummaryCard';
import ChartCard from '@/components/ChartCard';
import { DollarSign, TrendingUp, TrendingDown, CreditCard, Target } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { format } from 'date-fns';

interface DashboardClientProps {
  data: {
    monthIncome: number;
    monthExpenses: number;
    totalDebt: number;
    totalSavings: number;
    totalBalance: number;
    categoryData: Array<{ name: string; value: number; color: string }>;
    monthlyTrend: Array<{ month: string; income: number; expenses: number }>;
    recentTransactions: Array<{
      id: string;
      date: Date;
      amount: number;
      kind: string;
      category: { name: string; icon: string | null } | null;
      account: { name: string };
    }>;
  };
}

export default function DashboardClient({ data }: DashboardClientProps) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  const netIncome = data.monthIncome - data.monthExpenses;

  return (
    <div>
      <div className="mb-6 sm:mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm sm:text-base text-gray-600 mt-1">Welcome to your financial overview</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 sm:gap-6 mb-6 sm:mb-8">
        <SummaryCard
          title="Month Income"
          value={formatCurrency(data.monthIncome)}
          icon={TrendingUp}
          color="green"
        />
        <SummaryCard
          title="Month Expenses"
          value={formatCurrency(data.monthExpenses)}
          icon={TrendingDown}
          color="red"
        />
        <SummaryCard
          title="Net (Month)"
          value={formatCurrency(netIncome)}
          icon={DollarSign}
          color={netIncome >= 0 ? 'green' : 'red'}
        />
        <SummaryCard
          title="Total Debt"
          value={formatCurrency(data.totalDebt)}
          icon={CreditCard}
          color="red"
        />
        <SummaryCard
          title="Savings Goals"
          value={formatCurrency(data.totalSavings)}
          icon={Target}
          color="blue"
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mb-6 sm:mb-8">
        {/* Expenses by Category */}
        <ChartCard title="Expenses by Category (This Month)">
          {data.categoryData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={data.categoryData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {data.categoryData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color || `#${Math.floor(Math.random()*16777215).toString(16)}`} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => formatCurrency(value as number)} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[300px] flex items-center justify-center text-gray-500">
              No expense data for this month
            </div>
          )}
        </ChartCard>

        {/* Income vs Expenses Trend */}
        <ChartCard title="Income vs Expenses (12 Months)">
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={data.monthlyTrend}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip formatter={(value) => formatCurrency(value as number)} />
              <Legend />
              <Bar dataKey="income" fill="#10b981" name="Income" />
              <Bar dataKey="expenses" fill="#ef4444" name="Expenses" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Recent Transactions */}
      <ChartCard title="Recent Transactions">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead>
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Category</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Account</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {data.recentTransactions.map((transaction) => (
                <tr key={transaction.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                    {format(new Date(transaction.date), 'MMM dd, yyyy')}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm">
                    {transaction.category ? (
                      <div className="flex items-center gap-2">
                        {transaction.category.icon && <span>{transaction.category.icon}</span>}
                        <span>{transaction.category.name}</span>
                      </div>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">
                    {transaction.account.name}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm">
                    <span
                      className={`px-2 py-1 text-xs font-medium rounded-full ${
                        transaction.kind === 'INCOME'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-red-100 text-red-700'
                      }`}
                    >
                      {transaction.kind}
                    </span>
                  </td>
                  <td
                    className={`px-4 py-3 whitespace-nowrap text-right text-sm font-medium ${
                      transaction.kind === 'INCOME' ? 'text-green-600' : 'text-red-600'
                    }`}
                  >
                    {transaction.kind === 'INCOME' ? '+' : '-'}
                    {formatCurrency(transaction.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {data.recentTransactions.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              No transactions yet
            </div>
          )}
        </div>
      </ChartCard>
    </div>
  );
}
