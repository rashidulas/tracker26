'use client';

import { useState, useEffect } from 'react';
import { ArrowLeftRight, Plus, Pencil, Trash2, ArrowRight } from 'lucide-react';
import Modal from '@/components/Modal';
import Button from '@/components/Button';
import Input from '@/components/Input';
import Select from '@/components/Select';
import { formatCurrency, formatDate, formatDateForInput } from '@/lib/utils';
import { useToast } from '@/components/ToastProvider';
import {
  getTransactions,
  createTransaction,
  updateTransaction,
  deleteTransaction,
  getAccountsForSelect,
} from '@/app/transactions/actions';

type Account = {
  id: string;
  name: string;
  type: string;
};

type Transaction = {
  id: string;
  date: Date;
  amount: number;
  kind: string;
  accountId: string;
  toAccountId: string | null;
  notes: string | null;
  account: Account;
  toAccount: Account | null;
};

export default function TransfersPage() {
  const [transfers, setTransfers] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTransfer, setEditingTransfer] = useState<Transaction | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const toast = useToast();

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setIsLoading(true);
      const [transfersData, accountsData] = await Promise.all([
        getTransactions({ kind: 'TRANSFER' }),
        getAccountsForSelect(),
      ]);
      setTransfers(transfersData as Transaction[]);
      setAccounts(accountsData);
    } catch (error) {
      toast.error('Failed to load data');
    } finally {
      setIsLoading(false);
    }
  }

  function handleAdd() {
    setEditingTransfer(null);
    setIsModalOpen(true);
  }

  function handleEdit(transfer: Transaction) {
    setEditingTransfer(transfer);
    setIsModalOpen(true);
  }

  async function handleDelete(id: string) {
    if (!confirm('Are you sure you want to delete this transfer?')) return;

    const result = await deleteTransaction(id);
    if (result.success) {
      toast.success('Transfer deleted successfully');
      loadData();
    } else {
      toast.error(result.error || 'Failed to delete transfer');
    }
  }

  async function handleSubmit(formData: FormData) {
    const data = {
      kind: 'TRANSFER' as const,
      date: new Date(formData.get('date') as string),
      amount: parseFloat(formData.get('amount') as string),
      accountId: formData.get('fromAccountId') as string,
      toAccountId: formData.get('toAccountId') as string,
      notes: (formData.get('notes') as string) || undefined,
      tags: [],
    };

    if (data.accountId === data.toAccountId) {
      toast.error('Cannot transfer to the same account');
      return;
    }

    const result = editingTransfer
      ? await updateTransaction(editingTransfer.id, data)
      : await createTransaction(data);

    if (result.success) {
      toast.success(`Transfer ${editingTransfer ? 'updated' : 'created'} successfully`);
      setIsModalOpen(false);
      loadData();
    } else {
      toast.error(result.error || 'Failed to save transfer');
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-500">Loading transfers...</div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Transfers</h1>
          <p className="text-gray-500 mt-1">Move money between accounts</p>
        </div>
        <Button onClick={handleAdd}>
          <Plus size={20} />
          Add Transfer
        </Button>
      </div>

      {transfers.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <ArrowLeftRight className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No transfers yet</h3>
          <p className="text-gray-500 mb-6">Start by creating your first transfer between accounts</p>
          <Button onClick={handleAdd}>
            <Plus size={20} />
            Add Transfer
          </Button>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    From Account
                  </th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    To Account
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Amount
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Notes
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {transfers.map((transfer) => (
                  <tr key={transfer.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {formatDate(transfer.date)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {transfer.account.name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-center">
                      <ArrowRight size={16} className="text-blue-500 mx-auto" />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {transfer.toAccount?.name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-blue-600 font-medium text-right">
                      {formatCurrency(transfer.amount)}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {transfer.notes || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button
                        onClick={() => handleEdit(transfer)}
                        className="text-blue-600 hover:text-blue-800 mr-3"
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        onClick={() => handleDelete(transfer.id)}
                        className="text-red-600 hover:text-red-800"
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingTransfer ? 'Edit Transfer' : 'Add Transfer'}
      >
        <form action={handleSubmit}>
          <div className="space-y-4">
            <Input
              label="Date"
              name="date"
              type="date"
              defaultValue={editingTransfer ? formatDateForInput(editingTransfer.date) : formatDateForInput(new Date())}
              required
            />

            <Select
              label="From Account"
              name="fromAccountId"
              defaultValue={editingTransfer?.accountId || ''}
              required
              options={[
                { value: '', label: 'Select account...' },
                ...accounts.map((account) => ({
                  value: account.id,
                  label: account.name,
                })),
              ]}
            />

            <Select
              label="To Account"
              name="toAccountId"
              defaultValue={editingTransfer?.toAccountId || ''}
              required
              options={[
                { value: '', label: 'Select account...' },
                ...accounts.map((account) => ({
                  value: account.id,
                  label: account.name,
                })),
              ]}
            />

            <Input
              label="Amount"
              name="amount"
              type="number"
              step="0.01"
              min="0.01"
              defaultValue={editingTransfer?.amount || ''}
              required
            />

            <Input
              label="Notes"
              name="notes"
              defaultValue={editingTransfer?.notes || ''}
            />
          </div>

          <div className="mt-6 flex gap-3">
            <Button type="submit" className="flex-1">
              {editingTransfer ? 'Update' : 'Create'} Transfer
            </Button>
            <Button type="button" variant="secondary" onClick={() => setIsModalOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
