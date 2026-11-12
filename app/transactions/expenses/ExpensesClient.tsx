'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Camera, Plus, Receipt } from 'lucide-react';
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
import ExpenseForm from './ExpenseForm';
import ReceiptScanner from './ReceiptScanner';
import { deleteExpense } from './actions';

interface Expense {
  id: string;
  date: Date;
  amount: number;
  kind: string;
  categoryId: string | null;
  subcategoryId?: string | null;
  accountId: string | null;
  merchantOrSource: string | null;
  notes: string | null;
  tags: string[];
  category: { id: string; name: string; icon: string | null } | null;
  subcategory?: { id: string; name: string } | null;
  account: { id: string; name: string } | null;
  toAccount: { id: string; name: string } | null;
}

interface ExpensesClientProps {
  expenses: Expense[];
  categories: Array<{
    id: string;
    name: string;
    icon?: string | null;
    color?: string | null;
    subcategories?: Array<{ id: string; name: string }>;
  }>;
  accounts: Array<{ id: string; name: string }>;
}

type ExpenseItem = TransactionListItem & {
  expense: Expense;
  categoryId: string | null;
  subcategoryId: string | null;
  searchText: string;
};

export default function ExpensesClient({ expenses, categories, accounts }: ExpensesClientProps) {
  const router = useRouter();
  const toast = useToast();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const items = useMemo<ExpenseItem[]>(
    () =>
      expenses.map((expense) => ({
        id: expense.id,
        expense,
        date: expense.date,
        amount: expense.amount,
        tone: expense.kind === 'TRANSFER' ? 'transfer' : 'expense',
        icon: expense.category?.icon || '💸',
        title: expense.merchantOrSource || expense.category?.name || 'Untitled expense',
        badge: expense.subcategory?.name,
        meta: [
          expense.category?.name || 'Uncategorized',
          expense.toAccount ? (
            <span className="inline-flex items-center gap-1">
              {expense.account?.name || '—'}
              <ArrowRight size={10} aria-label="to" />
              {expense.toAccount.name}
            </span>
          ) : (
            expense.account?.name || null
          ),
        ],
        categoryId: expense.categoryId,
        subcategoryId: expense.subcategoryId ?? null,
        searchText: `${expense.merchantOrSource || ''} ${expense.notes || ''}`,
      })),
    [expenses]
  );

  const { filters, setFilter, clearFilters, monthOptions, filtered, activeFilterCount } =
    useTransactionFilters(items);

  const total = filtered.reduce((sum, item) => sum + item.amount, 0);

  const closeForm = () => {
    setIsModalOpen(false);
    setEditingExpense(null);
  };

  const handleAdd = () => {
    setEditingExpense(null);
    setIsModalOpen(true);
  };

  const handleDelete = async (item: ExpenseItem) => {
    if (!confirm('Delete this expense?')) return;
    const result = await deleteExpense(item.id);
    if (result.success) {
      toast.success('Expense deleted');
      router.refresh();
    } else {
      toast.error(result.error || 'Failed to delete expense');
    }
  };

  const actions = (
    <>
      <Button variant="secondary" onClick={() => setIsScannerOpen(true)}>
        <Camera size={18} aria-hidden="true" />
        Scan
      </Button>
      <Button onClick={handleAdd}>
        <Plus size={18} aria-hidden="true" />
        Add expense
      </Button>
    </>
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
        searchPlaceholder="Merchant or notes…"
        actions={actions}
      />

      <TransactionSummary tone="expense" total={total} count={filtered.length} />

      <TransactionList
        items={filtered}
        noun="expense"
        onEdit={(item) => {
          setEditingExpense(item.expense);
          setIsModalOpen(true);
        }}
        onDelete={handleDelete}
        empty={
          <EmptyTransactions
            icon={<Receipt className="text-danger" size={24} />}
            title="No expenses found"
            body="Add one manually or scan a receipt to get started."
            actions={actions}
          />
        }
      />

      <Modal
        isOpen={isModalOpen}
        onClose={closeForm}
        title={editingExpense ? 'Edit expense' : 'Add expense'}
        description="Amount first, then category — details stay optional."
        size="lg"
        footer={
          <div className="flex gap-3">
            <Button type="button" variant="secondary" onClick={closeForm} className="flex-1">
              Cancel
            </Button>
            <Button type="submit" form="expense-form" disabled={isSubmitting} className="flex-1">
              {isSubmitting ? 'Saving...' : editingExpense ? 'Save changes' : 'Add expense'}
            </Button>
          </div>
        }
      >
        <ExpenseForm
          expense={editingExpense || undefined}
          categories={categories}
          accounts={accounts}
          onSuccess={() => {
            const wasEditing = Boolean(editingExpense);
            closeForm();
            toast.success(wasEditing ? 'Expense updated' : 'Expense added');
            router.refresh();
          }}
          onCancel={closeForm}
          hideActions
          onSubmittingChange={setIsSubmitting}
          formId="expense-form"
        />
      </Modal>

      <Modal
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        title="Scan receipt"
        description="Snap a receipt and review the draft before saving."
        size="lg"
      >
        <ReceiptScanner
          categories={categories}
          accounts={accounts}
          onSuccess={() => {
            setIsScannerOpen(false);
            toast.success('Expense added from receipt');
            router.refresh();
          }}
          onCancel={() => setIsScannerOpen(false)}
        />
      </Modal>
    </>
  );
}
