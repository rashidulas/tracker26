'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ToastProvider';
import { AskButton } from '@/components/assistant/AskAssistant';
import Modal from '@/components/Modal';
import Button from '@/components/Button';
import Input from '@/components/Input';
import Textarea from '@/components/Textarea';
import Select from '@/components/Select';
import {
  createGoal,
  updateGoal,
  deleteGoal,
  createContribution,
  updateContribution,
  deleteContribution,
} from './actions';
import {
  Plus,
  Edit2,
  Trash2,
  DollarSign,
  Target as TargetIcon,
  ArrowRight,
  Bookmark,
  Pencil,
  Wallet,
} from 'lucide-react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { formatDate, formatCurrency } from '@/lib/utils';
import { toDayString, todayInAppTimeZone } from '@/lib/dates';

const goalSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  targetAmount: z.string().min(1, 'Target amount is required'),
  dueDate: z.string().optional(),
  accountId: z.string().optional(),
});

const contributionSchema = z.object({
  date: z.string().min(1, 'Date is required'),
  amount: z.string().min(1, 'Amount is required'),
  fromAccountId: z.string().min(1, 'Account is required'),
  notes: z.string().optional(),
});

type GoalFormData = z.infer<typeof goalSchema>;
type ContributionFormData = z.infer<typeof contributionSchema>;

interface Contribution {
  id: string;
  date: Date;
  amount: number;
  notes: string | null;
  fromAccountId: string;
  transactionId: string | null;
  fromAccount: { id: string; name: string } | null;
}

interface Goal {
  id: string;
  name: string;
  targetAmount: number;
  dueDate: Date | null;
  accountId: string | null;
  account: { id: string; name: string } | null;
  totalContributions: number;
  transferred: number;
  earmarked: number;
  remaining: number;
  progress: number;
  contributions: Contribution[];
}

type Account = { id: string; name: string };

interface GoalsClientProps {
  initialGoals: Goal[];
  accounts: Account[];
}

const accountName = (accounts: Account[], id: string | null | undefined) =>
  accounts.find((a) => a.id === id)?.name ?? 'account';

function GoalForm({
  goal,
  accounts,
  onSuccess,
  onCancel,
}: {
  goal: Goal | null;
  accounts: Account[];
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<GoalFormData>({
    resolver: zodResolver(goalSchema),
    defaultValues: {
      name: goal?.name || '',
      targetAmount: goal?.targetAmount.toString() || '',
      dueDate: goal?.dueDate ? toDayString(goal.dueDate) : '',
      accountId: goal?.accountId || '',
    },
  });
  const accountId = useWatch({ control, name: 'accountId' });

  const onSubmit = async (data: GoalFormData) => {
    setIsSubmitting(true);
    setError('');

    const formData = new FormData();
    formData.append('name', data.name);
    formData.append('targetAmount', data.targetAmount);
    formData.append('dueDate', data.dueDate || '');
    formData.append('accountId', data.accountId || '');

    const result = goal ? await updateGoal(goal.id, formData) : await createGoal(formData);

    setIsSubmitting(false);
    if (result.success) onSuccess();
    else setError(result.error || 'Something went wrong');
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {error && (
        <div className="p-3 bg-danger-dim border border-danger/25 rounded-xl text-danger text-sm">
          {error}
        </div>
      )}

      <Input
        label="Goal Name"
        {...register('name')}
        error={errors.name?.message}
        placeholder="e.g., Emergency Fund"
      />
      <Input
        label="Target Amount"
        type="number"
        step="0.01"
        {...register('targetAmount')}
        error={errors.targetAmount?.message}
        placeholder="10000.00"
      />
      <Input label="Due Date (Optional)" type="date" {...register('dueDate')} />
      <div>
        <Select
          label="Savings account (optional)"
          {...register('accountId')}
          options={[
            { value: '', label: 'None, earmark money where it is' },
            ...accounts.map((a) => ({ value: a.id, label: a.name })),
          ]}
        />
        <p className="text-xs text-ink-muted mt-1.5">
          {accountId
            ? `Contributions from other accounts become transfers into ${accountName(accounts, accountId)}.`
            : 'Contributions stay in their account and are set aside: the balance is unchanged, the available amount goes down.'}
        </p>
      </div>

      <div className="flex gap-3 pt-4">
        <Button type="submit" disabled={isSubmitting} className="flex-1">
          {isSubmitting ? 'Saving...' : goal ? 'Update' : 'Create'}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function ContributionForm({
  goal,
  contribution,
  accounts,
  onSuccess,
  onCancel,
}: {
  goal: Goal;
  contribution: Contribution | null;
  accounts: Account[];
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<ContributionFormData>({
    resolver: zodResolver(contributionSchema),
    defaultValues: {
      date: contribution ? toDayString(contribution.date) : todayInAppTimeZone(),
      amount: contribution ? contribution.amount.toFixed(2) : '',
      fromAccountId: contribution?.fromAccountId ?? '',
      notes: contribution?.notes ?? '',
    },
  });
  const fromAccountId = useWatch({ control, name: 'fromAccountId' });
  const amount = Number(useWatch({ control, name: 'amount' })) || 0;
  const transfers = Boolean(goal.accountId && fromAccountId && fromAccountId !== goal.accountId);

  const onSubmit = async (data: ContributionFormData) => {
    setIsSubmitting(true);
    setError('');

    const formData = new FormData();
    formData.append('goalId', goal.id);
    formData.append('date', data.date);
    formData.append('amount', data.amount);
    formData.append('fromAccountId', data.fromAccountId);
    formData.append('notes', data.notes || '');

    const result = contribution
      ? await updateContribution(contribution.id, formData)
      : await createContribution(formData);
    setIsSubmitting(false);

    if (result.success) onSuccess();
    else setError(result.error || 'Something went wrong');
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {error && (
        <div className="p-3 bg-danger-dim border border-danger/25 rounded-xl text-danger text-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <Input label="Date" type="date" {...register('date')} error={errors.date?.message} />
        <Input
          label="Amount"
          type="number"
          step="0.01"
          {...register('amount')}
          error={errors.amount?.message}
          placeholder="0.00"
        />
      </div>

      <Select
        label="From Account"
        {...register('fromAccountId')}
        error={errors.fromAccountId?.message}
        options={[
          { value: '', label: 'Select account...' },
          ...accounts.map((a) => ({ value: a.id, label: a.name })),
        ]}
      />

      {fromAccountId && (
        <div
          className={`flex items-start gap-2.5 rounded-xl border p-3 text-sm ${
            transfers ? 'border-info/25 bg-info-dim/30 text-info' : 'border-mint/20 bg-mint-dim/30 text-mint'
          }`}
        >
          {transfers ? (
            <ArrowRight size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          ) : (
            <Bookmark size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          )}
          <p>
            {transfers
              ? `Transfers ${amount > 0 ? formatCurrency(amount) : 'the money'} from ${accountName(accounts, fromAccountId)} to ${goal.account?.name ?? 'the goal account'}. Both balances change.`
              : `Earmarks ${amount > 0 ? formatCurrency(amount) : 'the money'} in ${accountName(accounts, fromAccountId)}. Its balance stays the same; its available amount goes down.`}
          </p>
        </div>
      )}

      <Textarea label="Notes (Optional)" {...register('notes')} rows={3} />

      <div className="flex gap-3 pt-4">
        <Button type="submit" disabled={isSubmitting} className="flex-1">
          {isSubmitting ? 'Saving...' : contribution ? 'Save changes' : 'Add Contribution'}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export default function GoalsClient({ initialGoals, accounts }: GoalsClientProps) {
  const router = useRouter();
  const toast = useToast();
  const [goals, setGoals] = useState(initialGoals);
  // Hidden while the delete waits out its Undo window.
  const [pendingDelete, setPendingDelete] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setGoals(initialGoals);
  }, [initialGoals]);

  const setPending = (id: string, on: boolean) =>
    setPendingDelete((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const visibleGoals = goals
    .filter((g) => !pendingDelete.has(g.id))
    .map((g) =>
      g.contributions.some((c) => pendingDelete.has(c.id))
        ? { ...g, contributions: g.contributions.filter((c) => !pendingDelete.has(c.id)) }
        : g
    );
  const [isGoalModalOpen, setIsGoalModalOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [contributionGoalId, setContributionGoalId] = useState<string | null>(null);
  const [editingContribution, setEditingContribution] = useState<Contribution | null>(null);
  const contributionGoal = goals.find((g) => g.id === contributionGoalId) ?? null;

  const closeGoalModal = () => {
    setIsGoalModalOpen(false);
    setEditingGoal(null);
  };
  const closeContributionModal = () => {
    setContributionGoalId(null);
    setEditingContribution(null);
  };

  const handleGoalSaved = () => {
    toast.success(editingGoal ? 'Goal updated' : 'Goal added');
    closeGoalModal();
    router.refresh();
  };

  const handleContributionSaved = () => {
    toast.success(editingContribution ? 'Contribution updated' : 'Contribution added');
    closeContributionModal();
    router.refresh();
  };

  const handleDelete = (goal: Goal) => {
    setPending(goal.id, true);
    toast.deferred({
      message:
        goal.transferred > 0
          ? `Deleted ${goal.name}. Transfers already made stay in your accounts.`
          : `Deleted ${goal.name}`,
      commit: () => deleteGoal(goal.id),
      errorMessage: 'Failed to delete goal',
      onUndo: () => setPending(goal.id, false),
      onFailed: () => setPending(goal.id, false),
      onCommitted: () => {
        setGoals((prev) => prev.filter((g) => g.id !== goal.id));
        setPending(goal.id, false);
        router.refresh();
      },
    });
  };

  const handleDeleteContribution = (contribution: Contribution) => {
    setPending(contribution.id, true);
    toast.deferred({
      message: contribution.transactionId
        ? `Deleted contribution and its ${formatCurrency(contribution.amount)} transfer`
        : `Deleted ${formatCurrency(contribution.amount)} earmark`,
      commit: () => deleteContribution(contribution.id),
      errorMessage: 'Failed to delete contribution',
      onUndo: () => setPending(contribution.id, false),
      onFailed: () => setPending(contribution.id, false),
      onCommitted: () => router.refresh(),
    });
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <p className="text-sm text-ink-muted">Track progress toward your savings targets.</p>
        <Button onClick={() => setIsGoalModalOpen(true)} className="w-full sm:w-auto">
          <Plus size={18} aria-hidden="true" />
          Add Goal
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
        {visibleGoals.map((goal) => (
          <div key={goal.id} className="panel-hover shadow-panel p-4 sm:p-6">
            <div className="flex justify-between items-start mb-4">
              <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
                <TargetIcon size={20} className="sm:w-6 sm:h-6 text-mint flex-shrink-0" />
                <div className="min-w-0">
                  <h3 className="text-base sm:text-lg font-semibold text-ink font-display truncate">
                    {goal.name}
                  </h3>
                  <p className="text-xs sm:text-sm text-ink-muted inline-flex items-center gap-1">
                    <Wallet size={12} aria-hidden="true" />
                    {goal.account ? `Saved in ${goal.account.name}` : 'Earmarked in your accounts'}
                    {goal.dueDate && ` · Due ${formatDate(goal.dueDate)}`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <AskButton
                  label={`${goal.name} goal`}
                  context={{ page: 'goals', item: { type: 'goal', id: goal.id, label: goal.name } }}
                />
                <button
                  onClick={() => {
                    setEditingGoal(goal);
                    setIsGoalModalOpen(true);
                  }}
                  className="w-11 h-11 inline-flex items-center justify-center rounded-xl text-ink-muted hover:text-mint hover:bg-mint-dim transition-colors"
                  aria-label={`Edit goal ${goal.name}`}
                >
                  <Edit2 size={16} aria-hidden="true" />
                </button>
                <button
                  onClick={() => handleDelete(goal)}
                  className="w-11 h-11 inline-flex items-center justify-center rounded-xl text-ink-muted hover:text-danger hover:bg-danger-dim transition-colors"
                  aria-label={`Delete goal ${goal.name}`}
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </div>
            </div>

            <div className="space-y-3 mb-4">
              <div className="flex justify-between text-sm">
                <span className="text-ink-secondary">Progress</span>
                <span className="font-medium text-ink">{goal.progress.toFixed(1)}%</span>
              </div>

              <div
                className="w-full bg-graphite-surface-2 border border-graphite-border-subtle rounded-full h-3"
                role="progressbar"
                aria-label={`${goal.name} progress`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(goal.progress)}
              >
                <div
                  className="bg-mint h-3 rounded-full transition-all"
                  style={{ width: `${goal.progress}%` }}
                />
              </div>

              <div className="flex justify-between">
                <div>
                  <p className="text-xs text-ink-muted">Saved</p>
                  <p className="font-semibold text-mint money">
                    {formatCurrency(goal.totalContributions)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-ink-muted">Target</p>
                  <p className="font-semibold text-ink money">{formatCurrency(goal.targetAmount)}</p>
                </div>
              </div>

              <p className="text-center pt-1 text-sm text-ink-secondary">
                {formatCurrency(goal.remaining)} remaining
                {goal.transferred > 0 && goal.earmarked > 0 && (
                  <span className="block text-xs text-ink-muted mt-0.5">
                    {formatCurrency(goal.transferred)} transferred ·{' '}
                    {formatCurrency(goal.earmarked)} earmarked
                  </span>
                )}
              </p>
            </div>

            {goal.contributions.length > 0 && (
              <ul className="mb-4 space-y-1.5" aria-label={`${goal.name} contributions`}>
                {goal.contributions.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center gap-2 rounded-xl border border-graphite-border-subtle bg-graphite-surface-2/40 pl-3 pr-1 py-1"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-ink money">{formatCurrency(c.amount)}</p>
                      <p className="text-xs text-ink-muted truncate">
                        {formatDate(c.date)} ·{' '}
                        {c.transactionId
                          ? `Transfer ${c.fromAccount?.name ?? ''} → ${goal.account?.name ?? 'goal account'}`
                          : `Earmarked in ${c.fromAccount?.name ?? 'account'}`}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingContribution(c);
                        setContributionGoalId(goal.id);
                      }}
                      className="w-11 h-11 inline-flex items-center justify-center rounded-xl text-ink-muted hover:text-mint hover:bg-mint-dim transition-colors"
                      aria-label={`Edit ${formatCurrency(c.amount)} contribution from ${formatDate(c.date)}`}
                    >
                      <Pencil size={14} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteContribution(c)}
                      className="w-11 h-11 inline-flex items-center justify-center rounded-xl text-ink-muted hover:text-danger hover:bg-danger-dim transition-colors"
                      aria-label={`Delete ${formatCurrency(c.amount)} contribution from ${formatDate(c.date)}`}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <Button
              variant="primary"
              size="sm"
              className="w-full"
              onClick={() => {
                setEditingContribution(null);
                setContributionGoalId(goal.id);
              }}
            >
              <DollarSign size={16} />
              Add Contribution
            </Button>
          </div>
        ))}
      </div>

      {visibleGoals.length === 0 && (
        <div className="panel shadow-panel p-12 text-center">
          <TargetIcon size={64} className="mx-auto text-ink-muted mb-4" />
          <p className="text-ink-muted">No goals yet. Add your first savings goal!</p>
        </div>
      )}

      <Modal
        isOpen={isGoalModalOpen}
        onClose={closeGoalModal}
        title={editingGoal ? 'Edit Goal' : 'Add Goal'}
      >
        {isGoalModalOpen && (
          <GoalForm
            goal={editingGoal}
            accounts={accounts}
            onSuccess={handleGoalSaved}
            onCancel={closeGoalModal}
          />
        )}
      </Modal>

      <Modal
        isOpen={Boolean(contributionGoal)}
        onClose={closeContributionModal}
        title={
          contributionGoal
            ? `${editingContribution ? 'Edit contribution' : 'Add contribution'} · ${contributionGoal.name}`
            : 'Contribution'
        }
      >
        {contributionGoal && (
          <ContributionForm
            key={editingContribution?.id ?? 'new'}
            goal={contributionGoal}
            contribution={editingContribution}
            accounts={accounts}
            onSuccess={handleContributionSaved}
            onCancel={closeContributionModal}
          />
        )}
      </Modal>
    </div>
  );
}
