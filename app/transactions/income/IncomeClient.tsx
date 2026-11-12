'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, TrendingUp } from 'lucide-react';
import Modal from '@/components/Modal';
import Button from '@/components/Button';
import { useToast } from '@/components/ToastProvider';
import TransactionList, {
  EmptyTransactions,
  TransactionSummary,
  type TransactionListItem,
} from '@/components/transactions/TransactionList';
import TransactionToolbar from '@/components/transactions/TransactionToolbar';
import { useTransactionFilters } from '@/components/transactions/useTransactionFilters';
import { formatCurrency } from '@/lib/utils';
import type { IncomeRow } from '@/lib/incomeRows';
import IncomeForm, { type Account, type Category } from './IncomeForm';
import { deleteIncome } from './actions';

interface IncomeClientProps {
  rows: IncomeRow[];
  categories: Category[];
  accounts: Account[];
}

type IncomeItem = TransactionListItem & {
  row: IncomeRow;
  categoryId: string | null;
  subcategoryId: string | null;
  searchText: string;
};

export default function IncomeClient({ rows, categories, accounts }: IncomeClientProps) {
  const router = useRouter();
  const toast = useToast();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<IncomeRow | null>(null);

  const items = useMemo<IncomeItem[]>(
    () =>
      rows.map((row) => ({
        id: row.memberIds.join('-'),
        row,
        date: row.date,
        amount: row.amount,
        tone: 'income',
        icon: row.category?.icon || '💰',
        title: row.merchantOrSource || row.category?.name || 'Income',
        badge: row.subcategory?.name,
        meta: [
          row.category?.name || 'Uncategorized',
          row.accounts.length > 1
            ? `${row.accounts.length} accounts`
            : row.accounts[0]?.name || null,
        ],
        detail:
          row.accounts.length > 1 ? (
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
              {row.accounts.map((acc) => (
                <li key={`${acc.accountId}-${acc.amount}`}>
                  {acc.name}{' '}
                  <span className="text-mint money tabular-nums">{formatCurrency(acc.amount)}</span>
                </li>
              ))}
            </ul>
          ) : undefined,
        categoryId: row.categoryId,
        subcategoryId: row.subcategoryId ?? null,
        searchText: `${row.merchantOrSource || ''} ${row.notes || ''}`,
      })),
    [rows]
  );

  const { filters, setFilter, clearFilters, monthOptions, filtered, activeFilterCount } =
    useTransactionFilters(items);

  const total = filtered.reduce((sum, item) => sum + item.amount, 0);

  const close = () => {
    setIsModalOpen(false);
    setEditing(null);
  };

  const handleAdd = () => {
    setEditing(null);
    setIsModalOpen(true);
  };

  const handleDelete = async (item: IncomeItem) => {
    if (!confirm('Delete this income?')) return;
    const result = await deleteIncome(item.row.id, item.row.memberIds);
    if (result.success) {
      toast.success('Income deleted');
      router.refresh();
    } else {
      toast.error(result.error || 'Failed to delete income');
    }
  };

  const addButton = (
    <Button onClick={handleAdd}>
      <Plus size={18} aria-hidden="true" />
      Add income
    </Button>
  );

  return (
    <>
      <TransactionToolbar
        filters={filters}
        setFilter={setFilter}
        clearFilters={clearFilters}
        monthOptions={monthOptions}
        activeFilterCount={activeFilterCount}
        categories={categories}
        searchPlaceholder="Source or notes…"
        actions={addButton}
      />

      <TransactionSummary tone="income" total={total} count={filtered.length} />

      <TransactionList
        items={filtered}
        noun="income"
        onEdit={(item) => {
          setEditing(item.row);
          setIsModalOpen(true);
        }}
        onDelete={handleDelete}
        empty={
          <EmptyTransactions
            icon={<TrendingUp className="text-mint" size={24} />}
            title="No income found"
            body="Nothing matches this month and these filters."
            actions={addButton}
          />
        }
      />

      <Modal
        isOpen={isModalOpen}
        onClose={close}
        title={editing ? 'Edit income' : 'Add income'}
        size="lg"
      >
        <IncomeForm
          income={editing || undefined}
          categories={categories}
          accounts={accounts}
          onSuccess={() => {
            close();
            toast.success(editing ? 'Income updated' : 'Income added');
            router.refresh();
          }}
          onCancel={close}
        />
      </Modal>
    </>
  );
}
