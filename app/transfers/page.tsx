'use client';

import { useState, useEffect } from 'react';
import { ArrowLeftRight, Plus, Pencil, Trash2, ArrowRight } from 'lucide-react';
import PageHeader from '@/components/PageHeader';
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
      <div className="page-shell">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-ink-muted">Loading transfers...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <PageHeader
        title="Transfers"
        subtitle="Move money between accounts"
        actions={
          <Button onClick={handleAdd}>
            <Plus size={18} />
            Add Transfer
          </Button>
        }
      />

      {transfers.length === 0 ? (
        <div className="panel shadow-panel p-12 text-center">
          <ArrowLeftRight className="w-16 h-16 text-ink-muted mx-auto mb-4" />
          <h3 className="text-lg font-medium text-ink font-display mb-2">No transfers yet</h3>
          <p className="text-ink-muted mb-6">Start by creating your first transfer between accounts</p>
          <Button onClick={handleAdd}>
            <Plus size={20} />
            Add Transfer
          </Button>
        </div>
      ) : (
        <div className="panel shadow-panel overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full divide-y divide-graphite-border-subtle">
              <thead className="bg-graphite-surface-2/60 border-b border-graphite-border-subtle">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-ink-muted uppercase tracking-wider">
                    Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-ink-muted uppercase tracking-wider">
                    From Account
                  </th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-ink-muted uppercase tracking-wider">
                    
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-ink-muted uppercase tracking-wider">
                    To Account
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-ink-muted uppercase tracking-wider">
                    Amount
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-ink-muted uppercase tracking-wider">
                    Notes
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-ink-muted uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-graphite-border-subtle">
                {transfers.map((transfer) => (
                  <tr key={transfer.id} className="hover:bg-graphite-surface-hover transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-ink">
                      {formatDate(transfer.date)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-ink">
                      {transfer.account?.name || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-center">
                      <ArrowRight size={16} className="text-mint mx-auto" />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-ink">
                      {transfer.toAccount?.name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-mint font-medium text-right money">
                      {formatCurrency(transfer.amount)}
                    </td>
                    <td className="px-6 py-4 text-sm text-ink-muted">
                      {transfer.notes || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button
                        onClick={() => handleEdit(transfer)}
                        className="rounded-lg text-ink-muted hover:text-mint hover:bg-mint-dim transition-colors mr-2 p-1.5"
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        onClick={() => handleDelete(transfer.id)}
                        className="p-1.5 rounded-lg text-ink-muted hover:text-danger hover:bg-danger-dim transition-colors"
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
