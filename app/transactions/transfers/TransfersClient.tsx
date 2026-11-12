'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeftRight, ArrowRight, Plus } from 'lucide-react';
import Modal from '@/components/Modal';
import Button from '@/components/Button';
import Input from '@/components/Input';
import Select from '@/components/Select';
import { useToast } from '@/components/ToastProvider';
import TransactionList, {
  EmptyTransactions,
  TransactionSummary,
  type TransactionListItem,
} from '@/components/transactions/TransactionList';
import TransactionToolbar from '@/components/transactions/TransactionToolbar';
import { useTransactionFilters } from '@/components/transactions/useTransactionFilters';
import { formatDateForInput, getLocalTodayForInput } from '@/lib/utils';
import { createTransaction, deleteTransaction, updateTransaction } from '../actions';

type Account = { id: string; name: string; type: string };

export type Transfer = {
  id: string;
  date: Date;
  amount: number;
  kind: string;
  accountId: string;
  toAccountId: string | null;
  notes: string | null;
  account: Account | null;
  toAccount: Account | null;
};

type TransferItem = TransactionListItem & { transfer: Transfer; searchText: string };

export default function TransfersClient({
  transfers,
  accounts,
}: {
  transfers: Transfer[];
  accounts: Account[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<Transfer | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const items = useMemo<TransferItem[]>(
    () =>
      transfers.map((transfer) => ({
        id: transfer.id,
        transfer,
        date: transfer.date,
        amount: transfer.amount,
        tone: 'transfer',
        icon: <ArrowLeftRight size={18} className="text-info" />,
        title: `${transfer.account?.name || '—'} → ${transfer.toAccount?.name || '—'}`,
        meta: [transfer.notes],
        searchText: `${transfer.account?.name || ''} ${transfer.toAccount?.name || ''} ${
          transfer.notes || ''
        }`,
      })),
    [transfers]
  );

  const { filters, setFilter, clearFilters, monthOptions, filtered, activeFilterCount } =
    useTransactionFilters(items);

  const total = filtered.reduce((sum, item) => sum + item.amount, 0);
  const accountOptions = [
    { value: '', label: 'Select account…' },
    ...accounts.map((a) => ({ value: a.id, label: a.name })),
  ];

  const close = () => {
    setIsModalOpen(false);
    setEditing(null);
  };

  const handleAdd = () => {
    setEditing(null);
    setIsModalOpen(true);
  };

  async function handleDelete(item: TransferItem) {
    if (!confirm('Delete this transfer?')) return;
    const result = await deleteTransaction(item.id);
    if (result.success) {
      toast.success('Transfer deleted');
      router.refresh();
    } else {
      toast.error(result.error || 'Failed to delete transfer');
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
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

    setIsSubmitting(true);
    const result = editing
      ? await updateTransaction(editing.id, data)
      : await createTransaction(data);
    setIsSubmitting(false);

    if (result.success) {
      toast.success(editing ? 'Transfer updated' : 'Transfer added');
      close();
      router.refresh();
    } else {
      toast.error(result.error || 'Failed to save transfer');
    }
  }

  const addButton = (
    <Button onClick={handleAdd}>
      <Plus size={18} aria-hidden="true" />
      Add transfer
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
        searchPlaceholder="Account or notes…"
        actions={addButton}
      />

      <TransactionSummary tone="transfer" total={total} count={filtered.length} label="Moved this view" />

      <TransactionList
        items={filtered}
        noun="transfer"
        onEdit={(item) => {
          setEditing(item.transfer);
          setIsModalOpen(true);
        }}
        onDelete={handleDelete}
        empty={
          <EmptyTransactions
            icon={<ArrowRight className="text-info" size={24} />}
            title="No transfers found"
            body="Move money between your accounts to see it here."
            actions={addButton}
          />
        }
      />

      <Modal isOpen={isModalOpen} onClose={close} title={editing ? 'Edit transfer' : 'Add transfer'}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Date"
            name="date"
            type="date"
            defaultValue={editing ? formatDateForInput(editing.date) : getLocalTodayForInput()}
            required
          />
          <Select
            label="From account"
            name="fromAccountId"
            defaultValue={editing?.accountId || ''}
            required
            options={accountOptions}
          />
          <Select
            label="To account"
            name="toAccountId"
            defaultValue={editing?.toAccountId || ''}
            required
            options={accountOptions}
          />
          <Input
            label="Amount"
            name="amount"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0.01"
            defaultValue={editing?.amount ?? ''}
            required
          />
          <Input label="Notes" name="notes" defaultValue={editing?.notes || ''} />

          <div className="pt-2 flex gap-3">
            <Button type="submit" className="flex-1" disabled={isSubmitting}>
              {isSubmitting ? 'Saving…' : editing ? 'Save changes' : 'Add transfer'}
            </Button>
            <Button type="button" variant="secondary" onClick={close}>
              Cancel
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
