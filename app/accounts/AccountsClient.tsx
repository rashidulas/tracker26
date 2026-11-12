'use client';

import { formatCurrency } from '@/lib/utils';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ToastProvider';
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
  HandCoins,
  type LucideIcon,
} from 'lucide-react';

interface Account {
  id: string;
  name: string;
  type: 'CHECKING' | 'SAVINGS' | 'CASH' | 'CREDIT_CARD' | 'INVESTMENT' | 'LOAN';
  institution: string | null;
  startingBalance: number;
  creditLimit?: number | null;
  currentBalance: number;
  transactionCount: number;
}

interface AccountsClientProps {
  initialAccounts: Account[];
}

export default function AccountsClient({ initialAccounts }: AccountsClientProps) {
  const router = useRouter();
  const toast = useToast();
  const [accounts, setAccounts] = useState(initialAccounts);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  // Hidden while the delete waits out its Undo window.
  const [pendingDelete, setPendingDelete] = useState<Set<string>>(() => new Set());

  // Refreshed server data (balances, counts) replaces local state.
  useEffect(() => {
    setAccounts(initialAccounts);
  }, [initialAccounts]);

  const setPending = (id: string, on: boolean) =>
    setPendingDelete((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const handleSuccess = () => {
    toast.success(editingAccount ? 'Account updated' : 'Account added');
    setIsModalOpen(false);
    setEditingAccount(null);
    router.refresh();
  };

  const handleEdit = (account: Account) => {
    setEditingAccount(account);
    setIsModalOpen(true);
  };

  const handleAdd = () => {
    setEditingAccount(null);
    setIsModalOpen(true);
  };

  const handleDelete = (account: Account) => {
    setPending(account.id, true);
    toast.deferred({
      message: `Deleted ${account.name}`,
      commit: () => deleteAccount(account.id),
      errorMessage: 'Failed to delete account',
      onUndo: () => setPending(account.id, false),
      onFailed: () => setPending(account.id, false),
      onCommitted: () => {
        setAccounts((prev) => prev.filter((a) => a.id !== account.id));
        setPending(account.id, false);
        router.refresh();
      },
    });
  };

  const visibleAccounts = accounts.filter((a) => !pendingDelete.has(a.id));

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
      case 'LOAN':
        return HandCoins;
      case 'INVESTMENT':
        return TrendingUp;
      default:
        return Briefcase;
    }
  };

  const totalBalance = visibleAccounts.reduce((sum, account) => sum + account.currentBalance, 0);

  const accountSections: Array<{
    key: Account['type'];
    label: string;
    types: Account['type'][];
  }> = [
    { key: 'CREDIT_CARD', label: 'Credit Cards', types: ['CREDIT_CARD'] },
    { key: 'CHECKING', label: 'Checking', types: ['CHECKING'] },
    { key: 'CASH', label: 'Cash', types: ['CASH'] },
    { key: 'SAVINGS', label: 'Savings', types: ['SAVINGS'] },
    { key: 'LOAN', label: 'Loans', types: ['LOAN'] },
    { key: 'INVESTMENT', label: 'Investments', types: ['INVESTMENT'] },
  ];

  const sections = accountSections
    .map((section) => ({
      ...section,
      accounts: visibleAccounts
        .filter((a) => section.types.includes(a.type))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .filter((section) => section.accounts.length > 0);

  const renderAccountCard = (account: Account) => {
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
              onClick={() => handleDelete(account)}
              className="p-1.5 rounded-lg text-ink-muted hover:text-danger hover:bg-danger-dim transition-colors"
              aria-label={`Delete ${account.name}`}
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
          {account.type === 'CREDIT_CARD' && (
            <div className="flex justify-between items-center text-sm mb-1">
              <span className="text-ink-secondary">Limit</span>
              <span className="text-mint money font-medium">
                {account.creditLimit != null && account.creditLimit > 0
                  ? formatCurrency(account.creditLimit)
                  : '—'}
              </span>
            </div>
          )}
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
  };

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
          <p className="text-sm text-ink-muted mt-2">Across {visibleAccounts.length} account(s)</p>
        </div>
      </div>

      <div className="space-y-8 mb-6">
        {sections.map((section) => (
          <section key={section.key}>
            <div className="flex items-baseline justify-between gap-3 mb-3">
              <h2 className="text-sm font-medium text-ink-secondary tracking-wide uppercase">
                {section.label}
              </h2>
              <span className="text-xs text-ink-muted">
                {section.accounts.length} account{section.accounts.length === 1 ? '' : 's'}
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {section.accounts.map(renderAccountCard)}
            </div>
          </section>
        ))}
      </div>

      {visibleAccounts.length === 0 && (
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
