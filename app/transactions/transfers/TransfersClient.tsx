'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeftRight, Plus, ArrowRight } from 'lucide-react';
import Modal from '@/components/Modal';
import Button from '@/components/Button';
import Input from '@/components/Input';
import Select from '@/components/Select';
import { formatCurrency, formatDate } from '@/lib/utils';
import { parseDay, toDayString, todayInAppTimeZone } from '@/lib/dates';
import { useToast } from '@/components/ToastProvider';
import {
  createTransaction,
  updateTransaction,
  deleteTransactions,
  duplicateTransactions,
} from '@/app/transactions/actions';
import {
  buildMonthOptions,
  currentMonthKey,
  groupByDay,
  localTodayKey,
  matchesSearch,
  monthKey,
  prependNew,
} from '@/lib/transactionList';
import {
  BulkActionBar,
  EmptyResults,
  GroupedList,
  ListToolbar,
  TransactionRow,
  useDebouncedValue,
  useMonthParam,
  useSelection,
} from '@/components/transactions/TransactionList';

type Account = {
  id: string;
  name: string;
  type: string;
};

export type Transfer = {
  id: string;
  date: Date;
  amount: number;
  kind: string;
  accountId: string | null;
  toAccountId: string | null;
  merchantOrSource?: string | null;
  notes: string | null;
  tags: string[];
  account: Account | null;
  toAccount: Account | null;
};

export default function TransfersClient({
  initialTransfers,
  accounts,
}: {
  initialTransfers: Transfer[];
  accounts: Account[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();

  const [transfers, setTransfers] = useState(initialTransfers);
  useEffect(() => setTransfers(initialTransfers), [initialTransfers]);

  const [month, setMonth] = useMonthParam(searchParams.get('month') || 'all');
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, 200);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTransfer, setEditingTransfer] = useState<Transfer | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const monthOptions = useMemo(
    () => buildMonthOptions(transfers.map((t) => t.date)),
    [transfers]
  );

  const filtered = useMemo(
    () =>
      transfers.filter((t) => {
        if (month !== 'all' && monthKey(t.date) !== month) return false;
        return matchesSearch(
          debouncedQuery,
          [t.account?.name, t.toAccount?.name, t.merchantOrSource, t.notes, ...(t.tags || [])],
          t.amount
        );
      }),
    [transfers, month, debouncedQuery]
  );

  const groups = useMemo(() => groupByDay(filtered, (t) => t.date, (t) => t.amount), [filtered]);
  const selection = useSelection(filtered.map((t) => t.id));
  const selectedTotal = filtered
    .filter((t) => selection.selected.has(t.id))
    .reduce((s, t) => s + t.amount, 0);
  const totalMoved = filtered.reduce((s, t) => s + t.amount, 0);

  const markBusy = (id: string, on: boolean) =>
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  function openAdd() {
    setEditingTransfer(null);
    setIsModalOpen(true);
  }

  async function handleDuplicate(t: Transfer) {
    markBusy(t.id, true);
    const result = await duplicateTransactions([t.id], localTodayKey());
    markBusy(t.id, false);
    if (result.success) {
      setTransfers((prev) => prependNew(prev, result.data as Transfer[]));
      if (month !== 'all' && month !== currentMonthKey()) setMonth(currentMonthKey());
      toast.success('Transfer duplicated to today');
    } else {
      toast.error(result.error);
    }
  }

  async function handleDelete(t: Transfer) {
    if (!confirm('Delete this transfer?')) return;
    markBusy(t.id, true);
    const result = await deleteTransactions([t.id]);
    markBusy(t.id, false);
    if (result.success) {
      setTransfers((prev) => prev.filter((x) => x.id !== t.id));
      toast.success('Transfer deleted');
    } else {
      toast.error(result.error);
    }
  }

  async function handleBulkDelete() {
    const ids = Array.from(selection.selected);
    if (!confirm(`Delete ${ids.length} transfer${ids.length === 1 ? '' : 's'}? This cannot be undone.`)) return;
    setBulkBusy(true);
    const result = await deleteTransactions(ids);
    setBulkBusy(false);
    if (result.success) {
      const gone = new Set(ids);
      setTransfers((prev) => prev.filter((t) => !gone.has(t.id)));
      selection.clear();
      toast.success(`Deleted ${result.count} transfer${result.count === 1 ? '' : 's'}`);
    } else {
      toast.error(result.error);
    }
  }

  async function handleSubmit(formData: FormData) {
    const data = {
      kind: 'TRANSFER' as const,
      date: parseDay(formData.get('date') as string),
      amount: parseFloat(formData.get('amount') as string),
      accountId: formData.get('fromAccountId') as string,
      toAccountId: formData.get('toAccountId') as string,
      notes: (formData.get('notes') as string) ?? null,
      // No tags: lib/transactions keeps existing tags (e.g. "payment") on edit.
    };

    if (data.accountId === data.toAccountId) {
      toast.error('Cannot transfer to the same account');
      return;
    }

    setIsSaving(true);
    const result = editingTransfer
      ? await updateTransaction(editingTransfer.id, data)
      : await createTransaction(data);
    setIsSaving(false);

    if (result.success) {
      toast.success(`Transfer ${editingTransfer ? 'updated' : 'created'}`);
      setIsModalOpen(false);
      setEditingTransfer(null);
      router.refresh();
    } else {
      toast.error(result.error || 'Failed to save transfer');
    }
  }

  const accountOptions = [
    { value: '', label: 'Select account...' },
    ...accounts.map((account) => ({ value: account.id, label: account.name })),
  ];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-end gap-2 mb-2">
        <Button onClick={openAdd}>
          <Plus size={18} aria-hidden="true" />
          Add Transfer
        </Button>
      </div>

      {transfers.length === 0 ? (
        <div className="panel shadow-panel p-12 text-center">
          <ArrowLeftRight className="w-16 h-16 text-ink-muted mx-auto mb-4" />
          <h3 className="text-lg font-medium text-ink font-display mb-2">No transfers yet</h3>
          <p className="text-ink-muted mb-6">Start by creating your first transfer between accounts</p>
          <Button onClick={openAdd}>
            <Plus size={20} aria-hidden="true" />
            Add Transfer
          </Button>
        </div>
      ) : (
        <>
          <ListToolbar
            query={query}
            onQueryChange={setQuery}
            placeholder="Search account, notes or amount"
            month={month}
            monthOptions={monthOptions}
            onMonthChange={setMonth}
            selecting={selection.selecting}
            onToggleSelecting={() => selection.setSelecting(!selection.selecting)}
          />

          <div className="relative overflow-hidden rounded-2xl border border-info/20 bg-gradient-to-r from-info-dim/80 to-graphite-surface mb-6 px-5 py-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.16em] text-ink-muted mb-1">
                  Moved this view
                </p>
                <p className="text-3xl font-semibold text-info money tracking-tight">
                  {formatCurrency(totalMoved)}
                </p>
              </div>
              <p className="text-sm text-ink-secondary">
                {filtered.length} transfer{filtered.length === 1 ? '' : 's'}
              </p>
            </div>
          </div>

          {filtered.length === 0 ? (
            <EmptyResults
              query={debouncedQuery}
              onClear={() => {
                setQuery('');
                setMonth('all');
              }}
            />
          ) : (
            <GroupedList
              groups={groups}
              totalCount={filtered.length}
              resetKey={`${month}|${debouncedQuery}`}
              getId={(t) => t.id}
              selection={selection}
              totalTone="text-info"
              renderRow={(t) => (
                <TransactionRow
                  key={t.id}
                  id={t.id}
                  label={`Transfer ${t.account?.name || ''} to ${t.toAccount?.name || ''}, ${formatCurrency(t.amount)}, ${formatDate(t.date)}`}
                  selection={selection}
                  busy={busyIds.has(t.id)}
                  leading={<ArrowLeftRight size={16} className="text-info" />}
                  title={
                    <span className="inline-flex flex-wrap items-center gap-x-1.5 whitespace-normal leading-snug">
                      <span>{t.account?.name || '—'}</span>
                      <ArrowRight size={12} className="text-info shrink-0" />
                      <span>{t.toAccount?.name || '—'}</span>
                    </span>
                  }
                  meta={
                    <span className="truncate">
                      {t.notes || t.merchantOrSource || 'Transfer'}
                    </span>
                  }
                  amount={formatCurrency(t.amount)}
                  amountTone="text-info"
                  onDuplicate={() => handleDuplicate(t)}
                  onEdit={() => {
                    setEditingTransfer(t);
                    setIsModalOpen(true);
                  }}
                  onDelete={() => handleDelete(t)}
                />
              )}
            />
          )}
        </>
      )}

      <BulkActionBar
        count={selection.selected.size}
        total={selectedTotal}
        onDelete={handleBulkDelete}
        onClear={selection.clear}
        busy={bulkBusy}
      />

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingTransfer ? 'Edit Transfer' : 'Add Transfer'}
      >
        <form action={handleSubmit} key={editingTransfer?.id || 'new'}>
          <div className="space-y-4">
            <Input
              label="Date"
              name="date"
              type="date"
              defaultValue={
                editingTransfer ? toDayString(editingTransfer.date) : todayInAppTimeZone()
              }
              required
            />
            <Select
              label="From Account"
              name="fromAccountId"
              defaultValue={editingTransfer?.accountId || ''}
              required
              options={accountOptions}
            />
            <Select
              label="To Account"
              name="toAccountId"
              defaultValue={editingTransfer?.toAccountId || ''}
              required
              options={accountOptions}
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
            <Input label="Notes" name="notes" defaultValue={editingTransfer?.notes || ''} />
          </div>

          <div className="mt-6 flex gap-3">
            <Button type="submit" className="flex-1" disabled={isSaving}>
              {isSaving ? 'Saving...' : `${editingTransfer ? 'Update' : 'Create'} Transfer`}
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
