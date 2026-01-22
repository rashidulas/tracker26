'use client';

import { useState, useEffect } from 'react';
import { LineChart, Plus, TrendingUp, TrendingDown, DollarSign, Pencil, Trash2, RefreshCw } from 'lucide-react';
import Modal from '@/components/Modal';
import Button from '@/components/Button';
import Input from '@/components/Input';
import Select from '@/components/Select';
import SummaryCard from '@/components/SummaryCard';
import { formatCurrency, formatPercent } from '@/lib/utils';
import { useToast } from '@/components/ToastProvider';
import {
  getHoldings,
  createHolding,
  updateHolding,
  updateLastPrice,
  deleteHolding,
  getInvestmentStats,
  getInvestmentAccounts,
} from './actions';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

type Holding = {
  id: string;
  symbol: string;
  name: string;
  quantity: number;
  avgCostBasis: number;
  lastPrice: number;
  account: { id: string; name: string };
  marketValue: number;
  totalCost: number;
  gain: number;
  gainPercent: number;
};

type Account = {
  id: string;
  name: string;
};

export default function InvestmentsPage() {
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isPriceModalOpen, setIsPriceModalOpen] = useState(false);
  const [editingHolding, setEditingHolding] = useState<Holding | null>(null);
  const [updatingPrice, setUpdatingPrice] = useState<Holding | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const toast = useToast();

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setIsLoading(true);
      const [holdingsData, accountsData, statsData] = await Promise.all([
        getHoldings(),
        getInvestmentAccounts(),
        getInvestmentStats(),
      ]);
      setHoldings(holdingsData);
      setAccounts(accountsData);
      setStats(statsData);
    } catch (error) {
      toast.error('Failed to load data');
    } finally {
      setIsLoading(false);
    }
  }

  function handleAdd() {
    setEditingHolding(null);
    setIsModalOpen(true);
  }

  function handleEdit(holding: Holding) {
    setEditingHolding(holding);
    setIsModalOpen(true);
  }

  function handleUpdatePrice(holding: Holding) {
    setUpdatingPrice(holding);
    setIsPriceModalOpen(true);
  }

  async function handleDelete(id: string) {
    if (!confirm('Are you sure you want to delete this holding?')) return;

    const result = await deleteHolding(id);
    if (result.success) {
      toast.success('Holding deleted successfully');
      loadData();
    } else {
      toast.error(result.error || 'Failed to delete holding');
    }
  }

  async function handleSubmit(formData: FormData) {
    const data = {
      symbol: (formData.get('symbol') as string).toUpperCase(),
      name: formData.get('name') as string,
      quantity: parseFloat(formData.get('quantity') as string),
      avgCostBasis: parseFloat(formData.get('avgCostBasis') as string),
      lastPrice: parseFloat(formData.get('lastPrice') as string),
      accountId: formData.get('accountId') as string,
    };

    const result = editingHolding
      ? await updateHolding(editingHolding.id, data)
      : await createHolding(data);

    if (result.success) {
      toast.success(`Holding ${editingHolding ? 'updated' : 'created'} successfully`);
      setIsModalOpen(false);
      loadData();
    } else {
      toast.error(result.error || 'Failed to save holding');
    }
  }

  async function handlePriceUpdate(formData: FormData) {
    if (!updatingPrice) return;

    const lastPrice = parseFloat(formData.get('lastPrice') as string);
    const result = await updateLastPrice(updatingPrice.id, lastPrice);

    if (result.success) {
      toast.success('Price updated successfully');
      setIsPriceModalOpen(false);
      loadData();
    } else {
      toast.error(result.error || 'Failed to update price');
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-500">Loading investments...</div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Investments</h1>
          <p className="text-gray-500 mt-1">Track your investment portfolio</p>
        </div>
        <Button onClick={handleAdd}>
          <Plus size={20} />
          Add Holding
        </Button>
      </div>

      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
          <SummaryCard
            title="Market Value"
            value={formatCurrency(stats.totalMarketValue)}
            icon={DollarSign}
            color="blue"
          />
          <SummaryCard
            title="Total Cost"
            value={formatCurrency(stats.totalCost)}
            icon={TrendingDown}
            color="gray"
          />
          <SummaryCard
            title="Total Gain"
            value={formatCurrency(stats.totalGain)}
            icon={stats.totalGain >= 0 ? TrendingUp : TrendingDown}
            color={stats.totalGain >= 0 ? 'green' : 'red'}
          />
          <SummaryCard
            title="Return"
            value={formatPercent(stats.totalGainPercent)}
            icon={stats.totalGain >= 0 ? TrendingUp : TrendingDown}
            color={stats.totalGain >= 0 ? 'green' : 'red'}
          />
        </div>
      )}

      {stats?.contributionHistory && stats.contributionHistory.length > 0 && (
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Contribution History (Last 12 Months)</h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={stats.contributionHistory}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip formatter={(value: number) => formatCurrency(value)} />
              <Legend />
              <Bar dataKey="amount" fill="#3b82f6" name="Contributions" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {holdings.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <LineChart className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No holdings yet</h3>
          <p className="text-gray-500 mb-6">Start tracking your investments by adding your first holding</p>
          <Button onClick={handleAdd}>
            <Plus size={20} />
            Add Holding
          </Button>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Symbol</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Account</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Quantity</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Avg Cost</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Last Price</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Market Value</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Gain/Loss</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {holdings.map((holding) => (
                  <tr key={holding.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{holding.symbol}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{holding.name}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{holding.account.name}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">{holding.quantity.toFixed(4)}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">{formatCurrency(holding.avgCostBasis)}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {formatCurrency(holding.lastPrice)}
                        <button onClick={() => handleUpdatePrice(holding)} className="text-blue-600 hover:text-blue-800" title="Update price">
                          <RefreshCw size={14} />
                        </button>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 text-right">{formatCurrency(holding.marketValue)}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right">
                      <div className={holding.gain >= 0 ? 'text-green-600' : 'text-red-600'}>
                        <div className="font-medium">{formatCurrency(holding.gain)}</div>
                        <div className="text-xs">{formatPercent(holding.gainPercent)}</div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button onClick={() => handleEdit(holding)} className="text-blue-600 hover:text-blue-800 mr-3"><Pencil size={16} /></button>
                      <button onClick={() => handleDelete(holding.id)} className="text-red-600 hover:text-red-800"><Trash2 size={16} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={editingHolding ? 'Edit Holding' : 'Add Holding'}>
        <form action={handleSubmit}>
          <div className="space-y-4">
            <Input label="Symbol (Ticker)" name="symbol" placeholder="AAPL" defaultValue={editingHolding?.symbol || ''} required />
            <Input label="Name" name="name" placeholder="Apple Inc." defaultValue={editingHolding?.name || ''} required />
            <Select 
              label="Account" 
              name="accountId" 
              defaultValue={editingHolding?.account.id || ''} 
              required
              options={[
                { value: '', label: 'Select account' },
                ...accounts.map((account) => ({ value: account.id, label: account.name }))
              ]}
            />
            <Input label="Quantity (Shares)" name="quantity" type="number" step="0.0001" min="0" defaultValue={editingHolding?.quantity || ''} required />
            <Input label="Average Cost per Share" name="avgCostBasis" type="number" step="0.01" min="0" defaultValue={editingHolding?.avgCostBasis || ''} required />
            <Input label="Last Price per Share" name="lastPrice" type="number" step="0.01" min="0" defaultValue={editingHolding?.lastPrice || ''} required />
          </div>
          <div className="mt-6 flex gap-3">
            <Button type="submit" className="flex-1">{editingHolding ? 'Update' : 'Create'} Holding</Button>
            <Button type="button" variant="secondary" onClick={() => setIsModalOpen(false)}>Cancel</Button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={isPriceModalOpen} onClose={() => setIsPriceModalOpen(false)} title={`Update Price - ${updatingPrice?.symbol}`}>
        <form action={handlePriceUpdate}>
          <div className="space-y-4">
            <div className="bg-gray-50 p-4 rounded-lg">
              <div className="text-sm text-gray-500">Current Price</div>
              <div className="text-2xl font-bold text-gray-900">{formatCurrency(updatingPrice?.lastPrice || 0)}</div>
            </div>
            <Input label="New Price per Share" name="lastPrice" type="number" step="0.01" min="0" defaultValue={updatingPrice?.lastPrice || ''} required autoFocus />
          </div>
          <div className="mt-6 flex gap-3">
            <Button type="submit" className="flex-1">Update Price</Button>
            <Button type="button" variant="secondary" onClick={() => setIsPriceModalOpen(false)}>Cancel</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
