'use client';

import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Modal from '@/components/Modal';
import Button from '@/components/Button';
import Input from '@/components/Input';
import PageHeader from '@/components/PageHeader';
import {
  createFriend,
  createFriendEntry,
  deleteFriend,
  deleteFriendEntry,
  updateFriend,
} from './actions';
import {
  Plus,
  Users,
  ArrowDownLeft,
  ArrowUpRight,
  Handshake,
  Pencil,
  Trash2,
  ChevronRight,
} from 'lucide-react';
import { formatCurrency, formatDate, getLocalTodayForInput } from '@/lib/utils';

type EntryType = 'THEY_OWE_ME' | 'I_OWE_THEM' | 'THEY_PAID_ME' | 'I_PAID_THEM';

interface FriendEntry {
  id: string;
  date: Date;
  amount: number;
  type: EntryType;
  description: string | null;
  notes: string | null;
}

interface Friend {
  id: string;
  name: string;
  notes: string | null;
  color: string;
  balance: number;
  entries: FriendEntry[];
}

interface FriendsClientProps {
  initialFriends: Friend[];
}

const ENTRY_OPTIONS: {
  value: EntryType;
  label: string;
  hint: string;
  tone: 'mint' | 'danger' | 'info';
}[] = [
  {
    value: 'THEY_OWE_ME',
    label: 'They owe me',
    hint: 'You covered a shared expense',
    tone: 'mint',
  },
  {
    value: 'I_OWE_THEM',
    label: 'I owe them',
    hint: 'They covered a shared expense',
    tone: 'danger',
  },
  {
    value: 'THEY_PAID_ME',
    label: 'They paid me',
    hint: 'Settlement received',
    tone: 'info',
  },
  {
    value: 'I_PAID_THEM',
    label: 'I paid them',
    hint: 'Settlement sent',
    tone: 'info',
  },
];

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
}

function balanceLabel(balance: number) {
  if (Math.abs(balance) < 0.005) return 'Settled up';
  if (balance > 0) return 'They owe you';
  return 'You owe them';
}

function entryLabel(type: EntryType) {
  return ENTRY_OPTIONS.find((o) => o.value === type)?.label || type;
}

export default function FriendsClient({ initialFriends }: FriendsClientProps) {
  const [friends, setFriends] = useState(initialFriends);
  const [friendModalOpen, setFriendModalOpen] = useState(false);
  const [editingFriend, setEditingFriend] = useState<Friend | null>(null);
  const [detailFriend, setDetailFriend] = useState<Friend | null>(null);
  const [entryModalOpen, setEntryModalOpen] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Friend form state
  const [friendName, setFriendName] = useState('');
  const [friendNotes, setFriendNotes] = useState('');
  const [openingAmount, setOpeningAmount] = useState('');
  const [openingType, setOpeningType] = useState<'THEY_OWE_ME' | 'I_OWE_THEM' | ''>('');

  // Entry form state
  const [entryAmount, setEntryAmount] = useState('');
  const [entryType, setEntryType] = useState<EntryType>('THEY_OWE_ME');
  const [entryDate, setEntryDate] = useState(getLocalTodayForInput());
  const [entryDescription, setEntryDescription] = useState('');

  const totals = useMemo(() => {
    const owedToYou = friends.reduce((s, f) => s + Math.max(0, f.balance), 0);
    const youOwe = friends.reduce((s, f) => s + Math.max(0, -f.balance), 0);
    return { owedToYou, youOwe, net: owedToYou - youOwe };
  }, [friends]);

  const reload = () => window.location.reload();

  const openAddFriend = () => {
    setEditingFriend(null);
    setFriendName('');
    setFriendNotes('');
    setOpeningAmount('');
    setOpeningType('');
    setError('');
    setFriendModalOpen(true);
  };

  const openEditFriend = (friend: Friend) => {
    setEditingFriend(friend);
    setFriendName(friend.name);
    setFriendNotes(friend.notes || '');
    setOpeningAmount('');
    setOpeningType('');
    setError('');
    setFriendModalOpen(true);
  };

  const openAddEntry = (friend: Friend) => {
    setDetailFriend(friend);
    setEntryAmount('');
    setEntryType('THEY_OWE_ME');
    setEntryDate(getLocalTodayForInput());
    setEntryDescription('');
    setError('');
    setEntryModalOpen(true);
  };

  const handleSaveFriend = async () => {
    setIsSubmitting(true);
    setError('');
    const formData = new FormData();
    formData.append('name', friendName);
    formData.append('notes', friendNotes);
    if (!editingFriend && openingAmount && openingType) {
      formData.append('openingAmount', openingAmount);
      formData.append('openingType', openingType);
    }

    const result = editingFriend
      ? await updateFriend(editingFriend.id, formData)
      : await createFriend(formData);

    setIsSubmitting(false);
    if (result.success) {
      setFriendModalOpen(false);
      reload();
    } else {
      setError(result.error || 'Something went wrong');
    }
  };

  const handleDeleteFriend = async (friend: Friend) => {
    if (!confirm(`Remove ${friend.name} and all their entries?`)) return;
    const result = await deleteFriend(friend.id);
    if (result.success) {
      setFriends(friends.filter((f) => f.id !== friend.id));
      if (detailFriend?.id === friend.id) setDetailFriend(null);
    } else {
      setError(result.error || 'Failed to delete');
    }
  };

  const handleSaveEntry = async () => {
    if (!detailFriend) return;
    setIsSubmitting(true);
    setError('');
    const formData = new FormData();
    formData.append('friendId', detailFriend.id);
    formData.append('date', entryDate);
    formData.append('amount', entryAmount);
    formData.append('type', entryType);
    formData.append('description', entryDescription);

    const result = await createFriendEntry(formData);
    setIsSubmitting(false);
    if (result.success) {
      setEntryModalOpen(false);
      reload();
    } else {
      setError(result.error || 'Something went wrong');
    }
  };

  const handleDeleteEntry = async (entryId: string) => {
    if (!confirm('Delete this entry?')) return;
    const result = await deleteFriendEntry(entryId);
    if (result.success) reload();
  };

  return (
    <div className="page-shell">
      <PageHeader
        title="Friends"
        subtitle="Shared expenses and who owes whom"
        actions={
          <Button onClick={openAddFriend} className="w-full sm:w-auto">
            <Plus size={18} />
            Add Friend
          </Button>
        }
      />

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        <div className="rounded-2xl border border-mint/20 bg-gradient-to-br from-mint-dim/70 to-graphite-surface p-4">
          <p className="text-[11px] uppercase tracking-[0.14em] text-ink-muted mb-1">
            Owed to you
          </p>
          <p className="text-2xl font-semibold text-mint money">
            {formatCurrency(totals.owedToYou)}
          </p>
        </div>
        <div className="rounded-2xl border border-danger/20 bg-gradient-to-br from-danger-dim/70 to-graphite-surface p-4">
          <p className="text-[11px] uppercase tracking-[0.14em] text-ink-muted mb-1">
            You owe
          </p>
          <p className="text-2xl font-semibold text-danger money">
            {formatCurrency(totals.youOwe)}
          </p>
        </div>
        <div className="rounded-2xl border border-graphite-border-subtle bg-graphite-surface p-4">
          <p className="text-[11px] uppercase tracking-[0.14em] text-ink-muted mb-1">
            Net
          </p>
          <p
            className={`text-2xl font-semibold money ${
              totals.net > 0.005
                ? 'text-mint'
                : totals.net < -0.005
                ? 'text-danger'
                : 'text-ink'
            }`}
          >
            {formatCurrency(totals.net)}
          </p>
        </div>
      </div>

      {friends.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="panel border-dashed border-graphite-border py-16 px-6 text-center"
        >
          <div className="mx-auto w-14 h-14 rounded-2xl bg-info-dim flex items-center justify-center mb-4">
            <Users className="text-info" size={24} />
          </div>
          <p className="text-ink font-medium font-display text-lg">No friends yet</p>
          <p className="text-ink-muted text-sm mt-1.5 max-w-sm mx-auto">
            Add a friend to track shared expenses and balances between you.
          </p>
          <Button onClick={openAddFriend} className="mt-6">
            <Plus size={18} />
            Add Friend
          </Button>
        </motion.div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {friends.map((friend, index) => {
            const settled = Math.abs(friend.balance) < 0.005;
            return (
              <motion.button
                key={friend.id}
                type="button"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.04 }}
                onClick={() => setDetailFriend(friend)}
                className="group text-left relative overflow-hidden rounded-2xl border border-graphite-border-subtle bg-graphite-surface p-5 hover:border-graphite-border hover:bg-graphite-surface-hover transition-all duration-200"
              >
                <div
                  className="absolute inset-x-0 top-0 h-1"
                  style={{ backgroundColor: friend.color }}
                />
                <div className="flex items-center gap-3.5">
                  <div
                    className="w-12 h-12 rounded-2xl flex items-center justify-center text-sm font-semibold text-ink border border-white/10 shrink-0"
                    style={{ backgroundColor: `${friend.color}28` }}
                  >
                    {initials(friend.name) || '?'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-base font-semibold text-ink font-display truncate">
                        {friend.name}
                      </h3>
                      <ChevronRight
                        size={16}
                        className="text-ink-muted group-hover:text-ink transition-colors shrink-0"
                      />
                    </div>
                    <p className="text-xs text-ink-muted mt-0.5">
                      {balanceLabel(friend.balance)}
                      {friend.entries.length > 0 &&
                        ` · ${friend.entries.length} entr${
                          friend.entries.length === 1 ? 'y' : 'ies'
                        }`}
                    </p>
                  </div>
                  <p
                    className={`text-lg font-semibold money tabular-nums shrink-0 ${
                      settled
                        ? 'text-ink-muted'
                        : friend.balance > 0
                        ? 'text-mint'
                        : 'text-danger'
                    }`}
                  >
                    {settled
                      ? '$0.00'
                      : formatCurrency(Math.abs(friend.balance))}
                  </p>
                </div>
              </motion.button>
            );
          })}
        </div>
      )}

      {/* Friend detail */}
      <Modal
        isOpen={!!detailFriend && !entryModalOpen && !friendModalOpen}
        onClose={() => setDetailFriend(null)}
        title={detailFriend?.name || 'Friend'}
        description={
          detailFriend
            ? `${balanceLabel(detailFriend.balance)}${
                Math.abs(detailFriend.balance) >= 0.005
                  ? ` · ${formatCurrency(Math.abs(detailFriend.balance))}`
                  : ''
              }`
            : undefined
        }
        size="lg"
        footer={
          detailFriend && (
            <div className="flex flex-col sm:flex-row gap-2">
              <Button
                variant="secondary"
                onClick={() => openEditFriend(detailFriend)}
                className="flex-1"
              >
                <Pencil size={16} />
                Edit
              </Button>
              <Button onClick={() => openAddEntry(detailFriend)} className="flex-1">
                <Plus size={16} />
                Add entry
              </Button>
            </div>
          )
        }
      >
        {detailFriend && (
          <div className="space-y-5">
            <div
              className={`rounded-2xl border p-4 ${
                Math.abs(detailFriend.balance) < 0.005
                  ? 'border-graphite-border-subtle bg-graphite-surface-2/60'
                  : detailFriend.balance > 0
                  ? 'border-mint/25 bg-mint-dim/40'
                  : 'border-danger/25 bg-danger-dim/40'
              }`}
            >
              <p className="text-[11px] uppercase tracking-[0.14em] text-ink-muted mb-1">
                Balance
              </p>
              <p
                className={`text-3xl font-semibold money ${
                  Math.abs(detailFriend.balance) < 0.005
                    ? 'text-ink'
                    : detailFriend.balance > 0
                    ? 'text-mint'
                    : 'text-danger'
                }`}
              >
                {Math.abs(detailFriend.balance) < 0.005
                  ? 'Settled up'
                  : `${detailFriend.balance > 0 ? '+' : '−'}${formatCurrency(
                      Math.abs(detailFriend.balance)
                    )}`}
              </p>
              <p className="text-sm text-ink-secondary mt-1">
                {balanceLabel(detailFriend.balance)}
              </p>
            </div>

            {detailFriend.notes && (
              <p className="text-sm text-ink-secondary">{detailFriend.notes}</p>
            )}

            <div>
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-medium text-ink-secondary">Activity</h4>
                <button
                  type="button"
                  onClick={() => handleDeleteFriend(detailFriend)}
                  className="text-xs text-ink-muted hover:text-danger transition-colors inline-flex items-center gap-1"
                >
                  <Trash2 size={12} />
                  Remove friend
                </button>
              </div>

              {detailFriend.entries.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-graphite-border py-10 text-center">
                  <Handshake className="mx-auto text-ink-muted mb-2" size={22} />
                  <p className="text-sm text-ink-muted">No entries yet</p>
                  <Button
                    size="sm"
                    className="mt-4"
                    onClick={() => openAddEntry(detailFriend)}
                  >
                    <Plus size={14} />
                    Add first entry
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <AnimatePresence initial={false}>
                    {detailFriend.entries.map((entry) => {
                      const positive =
                        entry.type === 'THEY_OWE_ME' || entry.type === 'I_PAID_THEM';
                      return (
                        <div
                          key={entry.id}
                          className="flex items-start gap-3 rounded-xl border border-graphite-border-subtle bg-graphite-surface-2/40 px-3.5 py-3"
                        >
                          <div
                            className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                              positive ? 'bg-mint-dim text-mint' : 'bg-danger-dim text-danger'
                            }`}
                          >
                            {positive ? (
                              <ArrowUpRight size={16} />
                            ) : (
                              <ArrowDownLeft size={16} />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-ink">
                              {entry.description || entryLabel(entry.type)}
                            </p>
                            <p className="text-xs text-ink-muted mt-0.5">
                              {formatDate(entry.date)} · {entryLabel(entry.type)}
                            </p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <p
                              className={`text-sm font-semibold money ${
                                positive ? 'text-mint' : 'text-danger'
                              }`}
                            >
                              {positive ? '+' : '−'}
                              {formatCurrency(entry.amount)}
                            </p>
                            <button
                              type="button"
                              onClick={() => handleDeleteEntry(entry.id)}
                              className="p-1.5 rounded-lg text-ink-muted hover:text-danger hover:bg-danger-dim transition-colors"
                              aria-label="Delete entry"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </AnimatePresence>
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Add / Edit friend */}
      <Modal
        isOpen={friendModalOpen}
        onClose={() => setFriendModalOpen(false)}
        title={editingFriend ? 'Edit friend' : 'Add friend'}
        description="Track shared spends and balances with someone."
        footer={
          <div className="flex gap-3">
            <Button
              variant="secondary"
              onClick={() => setFriendModalOpen(false)}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveFriend}
              disabled={isSubmitting || !friendName.trim()}
              className="flex-1"
            >
              {isSubmitting ? 'Saving...' : editingFriend ? 'Save' : 'Add friend'}
            </Button>
          </div>
        }
      >
        <div className="space-y-5">
          {error && (
            <div className="p-3 bg-danger-dim border border-danger/25 rounded-2xl text-danger text-sm">
              {error}
            </div>
          )}
          <Input
            label="Name"
            value={friendName}
            onChange={(e) => setFriendName(e.target.value)}
            placeholder="e.g. Alex"
            autoFocus
          />
          <Input
            label="Notes (optional)"
            value={friendNotes}
            onChange={(e) => setFriendNotes(e.target.value)}
            placeholder="Roommate, trip buddy…"
          />

          {!editingFriend && (
            <div className="rounded-2xl border border-graphite-border-subtle bg-graphite-surface-2/50 p-4 space-y-3">
              <div>
                <p className="text-sm font-medium text-ink-secondary">
                  Opening balance
                </p>
                <p className="text-xs text-ink-muted mt-0.5">
                  Optional — if something is already outstanding
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setOpeningType(openingType === 'THEY_OWE_ME' ? '' : 'THEY_OWE_ME')
                  }
                  className={`px-3 py-2.5 rounded-xl text-sm border transition-all ${
                    openingType === 'THEY_OWE_ME'
                      ? 'bg-mint-dim border-mint/40 text-mint'
                      : 'border-graphite-border-subtle text-ink-secondary'
                  }`}
                >
                  They owe me
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setOpeningType(openingType === 'I_OWE_THEM' ? '' : 'I_OWE_THEM')
                  }
                  className={`px-3 py-2.5 rounded-xl text-sm border transition-all ${
                    openingType === 'I_OWE_THEM'
                      ? 'bg-danger-dim border-danger/40 text-danger'
                      : 'border-graphite-border-subtle text-ink-secondary'
                  }`}
                >
                  I owe them
                </button>
              </div>
              {openingType && (
                <Input
                  label="Amount"
                  type="number"
                  step="0.01"
                  value={openingAmount}
                  onChange={(e) => setOpeningAmount(e.target.value)}
                  placeholder="0.00"
                />
              )}
            </div>
          )}
        </div>
      </Modal>

      {/* Add entry */}
      <Modal
        isOpen={entryModalOpen}
        onClose={() => {
          setEntryModalOpen(false);
          setError('');
        }}
        title={detailFriend ? `Entry · ${detailFriend.name}` : 'Add entry'}
        description="Log a shared expense or a settlement."
        footer={
          <div className="flex gap-3">
            <Button
              variant="secondary"
              onClick={() => setEntryModalOpen(false)}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveEntry}
              disabled={isSubmitting || !entryAmount || parseFloat(entryAmount) <= 0}
              className="flex-1"
            >
              {isSubmitting ? 'Saving...' : 'Save entry'}
            </Button>
          </div>
        }
      >
        <div className="space-y-5">
          {error && (
            <div className="p-3 bg-danger-dim border border-danger/25 rounded-2xl text-danger text-sm">
              {error}
            </div>
          )}

          <div className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-info-dim/30 to-graphite-surface-2/60 px-5 pt-6 pb-5 text-center">
            <p className="text-[11px] uppercase tracking-[0.18em] text-ink-muted mb-3">
              Amount
            </p>
            <div className="flex items-baseline justify-center gap-1 money">
              <span className="text-2xl text-ink-muted font-medium">$</span>
              <input
                type="number"
                step="0.01"
                inputMode="decimal"
                value={entryAmount}
                onChange={(e) => setEntryAmount(e.target.value)}
                placeholder="0.00"
                className="w-[min(100%,11rem)] bg-transparent text-center text-4xl font-semibold text-ink outline-none placeholder:text-ink-muted/35 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                autoFocus
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-ink-secondary mb-2">
              What happened?
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {ENTRY_OPTIONS.map((opt) => {
                const active = entryType === opt.value;
                const toneClass =
                  opt.tone === 'mint'
                    ? 'bg-mint-dim border-mint/40 text-mint'
                    : opt.tone === 'danger'
                    ? 'bg-danger-dim border-danger/40 text-danger'
                    : 'bg-info-dim border-info/40 text-info';
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setEntryType(opt.value)}
                    className={`text-left px-3.5 py-3 rounded-xl border transition-all ${
                      active
                        ? toneClass
                        : 'border-graphite-border-subtle bg-graphite-surface-2/60 text-ink-secondary hover:border-graphite-border'
                    }`}
                  >
                    <p className="text-sm font-medium">{opt.label}</p>
                    <p
                      className={`text-xs mt-0.5 ${
                        active ? 'opacity-80' : 'text-ink-muted'
                      }`}
                    >
                      {opt.hint}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          <Input
            label="Date"
            type="date"
            value={entryDate}
            onChange={(e) => setEntryDate(e.target.value)}
          />
          <Input
            label="Description (optional)"
            value={entryDescription}
            onChange={(e) => setEntryDescription(e.target.value)}
            placeholder="Dinner, Uber, Airbnb split…"
          />
        </div>
      </Modal>
    </div>
  );
}
