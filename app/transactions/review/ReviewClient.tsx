'use client';

/**
 * The review inbox, one entry at a time: Approve (it is right), Fix (open
 * the normal form, and saving approves it), Delete, or Later. The entries
 * still waiting are listed underneath and can be picked out of order.
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Check, CheckCheck, Inbox, Pencil, SkipForward, Trash2 } from 'lucide-react';
import Button from '@/components/Button';
import Modal from '@/components/Modal';
import { useToast } from '@/components/ToastProvider';
import ExpenseForm, { type FriendOption, type MerchantSuggestion } from '@/app/transactions/expenses/ExpenseForm';
import IncomeForm from '@/app/transactions/income/IncomeForm';
import type { IncomeRow } from '@/app/transactions/income/incomeRows';
import { deleteTransactions } from '@/app/transactions/actions';
import { setReviewCount } from '@/components/review/reviewCount';
import { dayLabel, monthKey } from '@/lib/transactionList';
import { toDayString } from '@/lib/dates';
import { formatCurrency } from '@/lib/utils';
import { approveReview, type getReviewItems } from './actions';

type Item = Awaited<ReturnType<typeof getReviewItems>>[number];

type CategoryOption = {
  id: string;
  name: string;
  icon?: string | null;
  color?: string | null;
  subcategories?: Array<{ id: string; name: string }>;
};

const SOURCE_LABELS: Record<string, string> = {
  voice: 'Entered by voice',
  receipt: 'From a receipt',
  assistant: 'Added by the assistant',
  recurring: 'Posted automatically (recurring)',
};

const titleOf = (item: Item) =>
  item.merchantOrSource ||
  item.category?.name ||
  (item.kind === 'TRANSFER' ? 'Transfer' : item.kind === 'INCOME' ? 'Income' : 'Expense');

const amountTone = (item: Item) =>
  item.kind === 'INCOME' ? 'text-mint' : item.kind === 'TRANSFER' ? 'text-info' : 'text-danger';

export default function ReviewClient({
  initialItems,
  expenseCategories,
  incomeCategories,
  accounts,
  friends = [],
  merchants = [],
}: {
  initialItems: Item[];
  expenseCategories: CategoryOption[];
  incomeCategories: CategoryOption[];
  accounts: Array<{ id: string; name: string }>;
  friends?: FriendOption[];
  merchants?: MerchantSuggestion[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [items, setItems] = useState(initialItems);
  // Server data wins whenever it is refreshed.
  useEffect(() => setItems(initialItems), [initialItems]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);
  const [formBusy, setFormBusy] = useState(false);

  useEffect(() => setReviewCount(items.length), [items.length]);

  const current = items.find((i) => i.id === currentId) ?? items[0] ?? null;
  const rest = items.filter((i) => i.id !== current?.id);
  const categoryNames = useMemo(
    () => new Map([...expenseCategories, ...incomeCategories].map((c) => [c.id, c])),
    [expenseCategories, incomeCategories]
  );

  const remove = (ids: string[]) => {
    const gone = new Set(ids);
    setItems((prev) => prev.filter((i) => !gone.has(i.id)));
    setCurrentId(null);
  };

  const approve = async (ids: string[]) => {
    if (ids.length === 0) return;
    setBusy(true);
    try {
      const result = await approveReview(ids);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      remove(ids);
      toast.success(ids.length === 1 ? 'Approved' : `Approved ${ids.length} entries`);
      router.refresh();
    } catch {
      toast.error('Could not approve. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const destroy = async (item: Item) => {
    if (!confirm(`Delete ${titleOf(item)} · ${formatCurrency(item.amount)}? This cannot be undone.`)) return;
    setBusy(true);
    try {
      const result = await deleteTransactions([item.id]);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      remove([item.id]);
      toast.success('Deleted');
      router.refresh();
    } catch {
      toast.error('Could not delete. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  /** Move the current entry to the end of the queue. */
  const later = () => {
    if (!current || items.length < 2) return;
    setItems((prev) => [...prev.filter((i) => i.id !== current.id), current]);
    setCurrentId(null);
  };

  /** The fix was saved through the normal form: that counts as reviewed. */
  const fixed = async (item: Item) => {
    setEditing(null);
    try {
      await approveReview([item.id]);
    } catch {
      // The edit itself is saved; the entry just stays in the inbox.
    }
    remove([item.id]);
    toast.success('Saved and approved');
    router.refresh();
  };

  const incomeRow = (item: Item): IncomeRow => ({
    id: item.id,
    memberIds: [item.id],
    date: item.date,
    amount: item.amount,
    categoryId: item.categoryId,
    subcategoryId: item.subcategoryId,
    merchantOrSource: item.merchantOrSource,
    notes: item.notes,
    tags: item.tags,
    category: item.category,
    subcategory: item.subcategory,
    accounts:
      item.accountSplits.length > 0
        ? item.accountSplits.map((s) => ({
            accountId: s.accountId,
            name: accounts.find((a) => a.id === s.accountId)?.name ?? 'Unknown',
            amount: s.amount,
          }))
        : item.accountId
        ? [{ accountId: item.accountId, name: item.account?.name ?? 'Unknown', amount: item.amount }]
        : [],
  });

  if (!current) {
    return (
      <div className="panel border-dashed border-graphite-border py-16 px-6 text-center">
        <div className="mx-auto w-14 h-14 rounded-2xl bg-mint-dim flex items-center justify-center mb-4">
          <Inbox className="text-mint" size={24} aria-hidden="true" />
        </div>
        <p className="text-ink font-medium font-display text-lg">Nothing to review</p>
        <p className="text-ink-muted text-sm mt-1.5 max-w-sm mx-auto">
          Entries added by voice, from a receipt, by the assistant or posted automatically from a recurring entry
          wait here until you have checked them.
        </p>
      </div>
    );
  }

  const split = current.splitItems.length > 0;
  const details: Array<[string, string]> = [
    ['Date', dayLabel(toDayString(current.date))],
    [
      'Category',
      split
        ? current.splitItems
            .map((s) => `${categoryNames.get(s.categoryId)?.name ?? 'Unknown'} ${formatCurrency(s.amount)}`)
            .join(' + ')
        : `${current.category?.name ?? (current.kind === 'TRANSFER' ? 'Transfer' : 'None')}${
            current.subcategory ? ` › ${current.subcategory.name}` : ''
          }`,
    ],
    [
      current.kind === 'TRANSFER' ? 'From' : 'Account',
      current.accountSplits.length > 1
        ? current.accountSplits
            .map((s) => `${accounts.find((a) => a.id === s.accountId)?.name ?? 'Unknown'} ${formatCurrency(s.amount)}`)
            .join(' + ')
        : current.account?.name ?? 'None',
    ],
  ];
  if (current.kind === 'TRANSFER') details.push(['To', current.toAccount?.name ?? 'None']);
  if (current.friendEntries.length > 0) {
    details.push(['Split with', current.friendEntries.map((f) => `${f.friend.name} ${formatCurrency(f.amount)}`).join(', ')]);
  }
  if (current.notes) details.push(['Notes', current.notes]);
  if (current.tags.length > 0) details.push(['Tags', current.tags.join(', ')]);

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-secondary" aria-live="polite">
          <span className="font-semibold text-ink">{items.length}</span> to review
        </p>
        {items.length > 1 && (
          <Button variant="secondary" size="sm" onClick={() => approve(items.map((i) => i.id))} disabled={busy}>
            <CheckCheck size={15} aria-hidden="true" />
            Approve all {items.length}
          </Button>
        )}
      </div>

      <article className="panel shadow-panel p-5 sm:p-6" aria-label={`Review ${titleOf(current)}`}>
        <p className="inline-flex items-center rounded-full border border-info/25 bg-info-dim px-2.5 py-0.5 text-xs text-info">
          {SOURCE_LABELS[current.source ?? ''] ?? 'Needs a look'}
        </p>
        <div className="mt-3 flex items-start justify-between gap-4">
          <div className="min-w-0 flex items-center gap-3">
            <div
              aria-hidden="true"
              className="w-11 h-11 rounded-xl bg-graphite-surface-2 border border-graphite-border-subtle flex items-center justify-center text-lg shrink-0"
            >
              {current.category?.icon || (current.kind === 'TRANSFER' ? '↔' : current.kind === 'INCOME' ? '💵' : '💸')}
            </div>
            <h2 className="min-w-0 break-words text-lg font-semibold text-ink font-display">{titleOf(current)}</h2>
          </div>
          <p className={`shrink-0 text-2xl font-semibold money tracking-tight ${amountTone(current)}`}>
            {formatCurrency(current.amount)}
          </p>
        </div>

        <dl className="mt-4 divide-y divide-graphite-border-subtle border-y border-graphite-border-subtle">
          {details.map(([label, value]) => (
            <div key={label} className="flex items-baseline justify-between gap-4 py-2.5 text-sm">
              <dt className="shrink-0 text-ink-muted">{label}</dt>
              <dd className="min-w-0 break-words text-right text-ink">{value}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-5 grid grid-cols-2 gap-2.5 sm:flex sm:flex-wrap">
          <Button onClick={() => approve([current.id])} disabled={busy} className="col-span-2 sm:flex-1">
            <Check size={17} aria-hidden="true" />
            Approve
          </Button>
          {current.kind === 'TRANSFER' ? (
            <Link
              href={`/transactions/transfers?month=${monthKey(current.date)}`}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-graphite-border bg-graphite-surface-2 px-4 py-2.5 text-sm font-medium text-ink-secondary hover:bg-graphite-surface-hover hover:text-ink"
            >
              <Pencil size={15} aria-hidden="true" />
              Fix in Transfers
              <ArrowRight size={14} aria-hidden="true" />
            </Link>
          ) : (
            <Button variant="secondary" onClick={() => setEditing(current)} disabled={busy}>
              <Pencil size={15} aria-hidden="true" />
              Fix
            </Button>
          )}
          <Button variant="danger" onClick={() => destroy(current)} disabled={busy}>
            <Trash2 size={15} aria-hidden="true" />
            Delete
          </Button>
          {items.length > 1 && (
            <Button variant="ghost" onClick={later} disabled={busy} className="col-span-2 sm:col-auto">
              <SkipForward size={15} aria-hidden="true" />
              Later
            </Button>
          )}
        </div>
      </article>

      {rest.length > 0 && (
        <section className="mt-6" aria-label="Also waiting">
          <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-[0.12em] text-ink-muted">Also waiting</h2>
          <ul className="space-y-1.5">
            {rest.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => {
                    setCurrentId(item.id);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  className="flex w-full items-center gap-3 rounded-2xl border border-graphite-border-subtle bg-graphite-surface px-3.5 py-3 text-left transition-colors hover:border-graphite-border hover:bg-graphite-surface-hover"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">{titleOf(item)}</span>
                    <span className="block truncate text-xs text-ink-muted">
                      {dayLabel(toDayString(item.date))} · {SOURCE_LABELS[item.source ?? ''] ?? 'Needs a look'}
                    </span>
                  </span>
                  <span className={`shrink-0 text-sm font-semibold money ${amountTone(item)}`}>
                    {formatCurrency(item.amount)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Modal
        isOpen={editing !== null}
        onClose={() => setEditing(null)}
        title={editing?.kind === 'INCOME' ? 'Fix income' : 'Fix expense'}
        description="Saving also approves it."
        size="lg"
        footer={
          editing?.kind === 'EXPENSE' ? (
            <div className="flex gap-3">
              <Button type="button" variant="secondary" onClick={() => setEditing(null)} className="flex-1">
                Cancel
              </Button>
              <Button type="submit" form="review-expense-form" disabled={formBusy} className="flex-1">
                {formBusy ? 'Saving...' : 'Save and approve'}
              </Button>
            </div>
          ) : undefined
        }
      >
        {editing?.kind === 'EXPENSE' && (
          <ExpenseForm
            key={editing.id}
            expense={editing}
            categories={expenseCategories}
            accounts={accounts}
            merchants={merchants}
            friends={friends}
            onSuccess={() => void fixed(editing)}
            onCancel={() => setEditing(null)}
            hideActions
            onSubmittingChange={setFormBusy}
            formId="review-expense-form"
          />
        )}
        {editing?.kind === 'INCOME' && (
          <IncomeForm
            key={editing.id}
            income={incomeRow(editing)}
            categories={incomeCategories}
            accounts={accounts}
            onSuccess={() => void fixed(editing)}
            onCancel={() => setEditing(null)}
          />
        )}
      </Modal>
    </div>
  );
}
