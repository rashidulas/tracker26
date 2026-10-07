'use client';

import { useState } from 'react';
import Modal from '@/components/Modal';
import Button from '@/components/Button';
import AccountForm from './AccountForm';
import { deleteAccount } from './actions';
import PageHeader from '@/components/PageHeader';
import {
  Plus,
  Edit2,
  Trash2,
  Wallet,
  Landmark,
  PiggyBank,
  Banknote,
  CreditCard,
  TrendingUp,
  Briefcase,
  type LucideIcon,
} from 'lucide-react';

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

  const getTypeIcon = (type: string): LucideIcon => {
    switch (type) {
      case 'CHECKING':
        return Landmark;
      case 'SAVINGS':
        return PiggyBank;
      case 'CASH':
        return Banknote;
      case 'CREDIT_CARD':
        return CreditCard;
      case 'INVESTMENT':
        return TrendingUp;
      default:
        return Briefcase;
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
    <div className="page-shell">
      <PageHeader
        title="Accounts"
        subtitle="Manage your financial accounts"
        actions={
          <Button onClick={handleAdd} className="w-full sm:w-auto">
            <Plus size={18} />
            Add Account
          </Button>
        }
      />

      {deleteError && (
        <div className="mb-4 p-3 bg-danger-dim border border-danger/25 rounded-2xl text-danger text-sm">
          {deleteError}
        </div>
      )}

      {/* Total Balance Card */}
      <div className="panel shadow-panel p-6 mb-6 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-mint-dim via-transparent to-transparent pointer-events-none" />
        <div className="relative">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2.5 rounded-xl bg-mint-dim text-mint">
              <Wallet size={20} />
            </div>
            <h2 className="text-sm font-medium text-ink-secondary">Total Balance</h2>
          </div>
          <p className="text-3xl sm:text-4xl font-semibold text-ink money">
            {formatCurrency(totalBalance)}
          </p>
          <p className="text-sm text-ink-muted mt-2">Across {accounts.length} account(s)</p>
        </div>
      </div>

      {/* Accounts Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {accounts.map((account) => {
          const TypeIcon = getTypeIcon(account.type);
          return (
            <div key={account.id} className="panel-hover shadow-panel p-6">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-graphite-surface-2 border border-graphite-border-subtle text-mint">
                    <TypeIcon size={22} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-ink font-display">{account.name}</h3>
                    <p className="text-sm text-ink-muted">{account.type.replace('_', ' ')}</p>
                  </div>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => handleEdit(account)}
                    className="p-1.5 rounded-lg text-ink-muted hover:text-mint hover:bg-mint-dim transition-colors"
                  >
                    <Edit2 size={16} />
                  </button>
                  <button
                    onClick={() => handleDelete(account.id)}
                    className="p-1.5 rounded-lg text-ink-muted hover:text-danger hover:bg-danger-dim transition-colors"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>

              {account.institution && (
                <p className="text-sm text-ink-secondary mb-3">{account.institution}</p>
              )}

              <div className="border-t border-graphite-border-subtle pt-3">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm text-ink-secondary">Current Balance</span>
                  <span className="text-lg font-semibold text-ink money">
                    {formatCurrency(account.currentBalance)}
                  </span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-ink-secondary">Starting</span>
                  <span className="text-ink-secondary money">
                    {formatCurrency(account.startingBalance)}
                  </span>
                </div>
                <div className="flex justify-between items-center text-sm mt-1">
                  <span className="text-ink-secondary">Transactions</span>
                  <span className="text-ink-secondary">{account.transactionCount}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {accounts.length === 0 && (
        <div className="panel shadow-panel p-12 text-center">
          <Wallet size={48} className="mx-auto text-ink-muted mb-4" />
          <p className="text-ink-muted">No accounts yet. Add your first account!</p>
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
