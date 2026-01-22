'use client';

import { useState } from 'react';
import Modal from '@/components/Modal';
import Button from '@/components/Button';
import AccountForm from './AccountForm';
import { deleteAccount } from './actions';
import { Plus, Edit2, Trash2, Wallet } from 'lucide-react';

interface Account {
  id: string;
  name: string;
  type: 'CHECKING' | 'SAVINGS' | 'CASH' | 'CREDIT_CARD' | 'INVESTMENT';
  institution: string | null;
  startingBalance: number;
  currentBalance: number;
  transactionCount: number;
}

interface AccountsClientProps {
  initialAccounts: Account[];
}

export default function AccountsClient({ initialAccounts }: AccountsClientProps) {
  const [accounts, setAccounts] = useState(initialAccounts);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [deleteError, setDeleteError] = useState('');

  const handleSuccess = () => {
    setIsModalOpen(false);
    setEditingAccount(null);
    window.location.reload();
  };

  const handleEdit = (account: Account) => {
    setEditingAccount(account);
    setIsModalOpen(true);
  };

  const handleAdd = () => {
    setEditingAccount(null);
    setIsModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this account?')) return;

    setDeleteError('');
    const result = await deleteAccount(id);

    if (result.success) {
      setAccounts(accounts.filter((a) => a.id !== id));
    } else {
      setDeleteError(result.error || 'Failed to delete account');
      setTimeout(() => setDeleteError(''), 5000);
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'CHECKING':
        return '🏦';
      case 'SAVINGS':
        return '💰';
      case 'CASH':
        return '💵';
      case 'CREDIT_CARD':
        return '💳';
      case 'INVESTMENT':
        return '📈';
      default:
        return '💼';
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  const totalBalance = accounts.reduce((sum, account) => sum + account.currentBalance, 0);

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Accounts</h1>
          <p className="text-gray-600 mt-1">Manage your financial accounts</p>
        </div>
        <Button onClick={handleAdd}>
          <Plus size={20} className="inline mr-2" />
          Add Account
        </Button>
      </div>

      {deleteError && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {deleteError}
        </div>
      )}

      {/* Total Balance Card */}
      <div className="bg-gradient-to-r from-blue-500 to-blue-600 rounded-lg shadow-lg p-6 mb-6 text-white">
        <div className="flex items-center gap-3 mb-2">
          <Wallet size={24} />
          <h2 className="text-lg font-medium">Total Balance</h2>
        </div>
        <p className="text-4xl font-bold">{formatCurrency(totalBalance)}</p>
        <p className="text-sm opacity-90 mt-2">Across {accounts.length} account(s)</p>
      </div>

      {/* Accounts Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {accounts.map((account) => (
          <div key={account.id} className="bg-white rounded-lg shadow p-6 hover:shadow-md transition-shadow">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <span className="text-3xl">{getTypeIcon(account.type)}</span>
                <div>
                  <h3 className="font-semibold text-gray-900">{account.name}</h3>
                  <p className="text-sm text-gray-500">{account.type.replace('_', ' ')}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => handleEdit(account)}
                  className="text-blue-600 hover:text-blue-800"
                >
                  <Edit2 size={16} />
                </button>
                <button
                  onClick={() => handleDelete(account.id)}
                  className="text-red-600 hover:text-red-800"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>

            {account.institution && (
              <p className="text-sm text-gray-600 mb-3">{account.institution}</p>
            )}

            <div className="border-t pt-3">
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm text-gray-600">Current Balance</span>
                <span className="text-lg font-bold text-gray-900">
                  {formatCurrency(account.currentBalance)}
                </span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-600">Starting</span>
                <span className="text-gray-700">{formatCurrency(account.startingBalance)}</span>
              </div>
              <div className="flex justify-between items-center text-sm mt-1">
                <span className="text-gray-600">Transactions</span>
                <span className="text-gray-700">{account.transactionCount}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {accounts.length === 0 && (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <Wallet size={48} className="mx-auto text-gray-400 mb-4" />
          <p className="text-gray-500">No accounts yet. Add your first account!</p>
        </div>
      )}

      <Modal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingAccount(null);
        }}
        title={editingAccount ? 'Edit Account' : 'Add Account'}
      >
        <AccountForm
          account={editingAccount || undefined}
          onSuccess={handleSuccess}
          onCancel={() => {
            setIsModalOpen(false);
            setEditingAccount(null);
          }}
        />
      </Modal>
    </div>
  );
}
