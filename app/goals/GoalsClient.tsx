'use client';

import { useState } from 'react';
import PageHeader from '@/components/PageHeader';
import Modal from '@/components/Modal';
import Button from '@/components/Button';
import Input from '@/components/Input';
import Select from '@/components/Select';
import { createGoal, updateGoal, deleteGoal, createContribution } from './actions';
import { Plus, Edit2, Trash2, DollarSign, Target as TargetIcon } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { format } from 'date-fns';
import { formatDate, formatDateForInput } from '@/lib/utils';

const goalSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  targetAmount: z.string().min(1, 'Target amount is required'),
  dueDate: z.string().optional(),
});

const contributionSchema = z.object({
  date: z.string().min(1, 'Date is required'),
  amount: z.string().min(1, 'Amount is required'),
  fromAccountId: z.string().min(1, 'Account is required'),
  notes: z.string().optional(),
});

interface Goal {
  id: string;
  name: string;
  targetAmount: number;
  dueDate: Date | null;
  totalContributions: number;
  progress: number;
  contributions: Array<{
    id: string;
    date: Date;
    amount: number;
  }>;
}

interface GoalsClientProps {
  initialGoals: Goal[];
  accounts: Array<{ id: string; name: string }>;
}

function GoalForm({ goal, onSuccess, onCancel }: any) {
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { register, handleSubmit, formState: { errors } } = useForm({
    resolver: zodResolver(goalSchema),
    defaultValues: {
      name: goal?.name || '',
      targetAmount: goal?.targetAmount.toString() || '',
      dueDate: goal?.dueDate ? formatDateForInput(goal.dueDate) : '',
    },
  });

  const onSubmit = async (data: any) => {
    setIsSubmitting(true);
    setError('');

    const formData = new FormData();
    Object.entries(data).forEach(([key, value]) => {
      if (value) formData.append(key, value as string);
    });

    const result = goal
      ? await updateGoal(goal.id, formData)
      : await createGoal(formData);

    setIsSubmitting(false);

    if (result.success) {
      onSuccess();
    } else {
      setError(result.error || 'Something went wrong');
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {error && (
        <div className="p-3 bg-danger-dim border border-danger/25 rounded-xl text-danger text-sm">
          {error}
        </div>
      )}

      <Input label="Goal Name" {...register('name')} error={errors.name?.message as string} placeholder="e.g., Emergency Fund" />
      <Input
        label="Target Amount"
        type="number"
        step="0.01"
        {...register('targetAmount')}
        error={errors.targetAmount?.message as string}
        placeholder="10000.00"
      />
      <Input label="Due Date (Optional)" type="date" {...register('dueDate')} />

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

function ContributionForm({ goalId, accounts, onSuccess, onCancel }: any) {
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { register, handleSubmit, formState: { errors } } = useForm({
    resolver: zodResolver(contributionSchema),
    defaultValues: {
      date: new Date().toISOString().split('T')[0],
      amount: '',
      fromAccountId: '',
      notes: '',
    },
  });

  const onSubmit = async (data: any) => {
    setIsSubmitting(true);
    setError('');

    const formData = new FormData();
    formData.append('goalId', goalId);
    Object.entries(data).forEach(([key, value]) => {
      if (value) formData.append(key, value as string);
    });

    const result = await createContribution(formData);
    setIsSubmitting(false);

    if (result.success) {
      onSuccess();
    } else {
      setError(result.error || 'Something went wrong');
    }
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
          ...accounts.map((a: any) => ({ value: a.id, label: a.name })),
        ]}
      />

      <div>
        <label className="block text-sm font-medium text-ink-secondary mb-1.5">Notes (Optional)</label>
        <textarea
          {...register('notes')}
          className="w-full px-3 py-2 border border-graphite-border rounded-xl bg-graphite-surface-2/80 text-ink focus:ring-2 focus:ring-mint/30 focus:border-mint/50 focus:outline-none transition-colors"
          rows={3}
        />
      </div>

      <div className="flex gap-3 pt-4">
        <Button type="submit" disabled={isSubmitting} className="flex-1">
          {isSubmitting ? 'Processing...' : 'Add Contribution'}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export default function GoalsClient({ initialGoals, accounts }: GoalsClientProps) {
  const [goals, setGoals] = useState(initialGoals);
  const [isGoalModalOpen, setIsGoalModalOpen] = useState(false);
  const [isContributionModalOpen, setIsContributionModalOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [selectedGoalForContribution, setSelectedGoalForContribution] = useState<string | null>(null);

  const handleSuccess = () => {
    setIsGoalModalOpen(false);
    setIsContributionModalOpen(false);
    setEditingGoal(null);
    setSelectedGoalForContribution(null);
    window.location.reload();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this goal?')) return;
    const result = await deleteGoal(id);
    if (result.success) {
      setGoals(goals.filter((g) => g.id !== id));
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  return (
    <div className="page-shell">
      <PageHeader
        title="Goals"
        subtitle="Track your savings goals"
        actions={
          <Button onClick={() => setIsGoalModalOpen(true)} className="w-full sm:w-auto">
            <Plus size={18} />
            Add Goal
          </Button>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
        {goals.map((goal) => (
          <div key={goal.id} className="panel-hover shadow-panel p-4 sm:p-6">
            <div className="flex justify-between items-start mb-4">
              <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
                <TargetIcon size={20} className="sm:w-6 sm:h-6 text-mint flex-shrink-0" />
                <div className="min-w-0">
                  <h3 className="text-base sm:text-lg font-semibold text-ink font-display truncate">{goal.name}</h3>
                  {goal.dueDate && (
                    <p className="text-xs sm:text-sm text-ink-muted">Due: {formatDate(goal.dueDate)}</p>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setEditingGoal(goal);
                    setIsGoalModalOpen(true);
                  }}
                  className="p-1.5 rounded-lg text-ink-muted hover:text-mint hover:bg-mint-dim transition-colors"
                >
                  <Edit2 size={16} />
                </button>
                <button
                  onClick={() => handleDelete(goal.id)}
                  className="p-1.5 rounded-lg text-ink-muted hover:text-danger hover:bg-danger-dim transition-colors"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>

            <div className="space-y-3 mb-4">
              <div className="flex justify-between text-sm">
                <span className="text-ink-secondary">Progress</span>
                <span className="font-medium text-ink">{goal.progress.toFixed(1)}%</span>
              </div>

              <div className="w-full bg-graphite-surface-2 border border-graphite-border-subtle rounded-full h-3">
                <div
                  className="bg-mint h-3 rounded-full transition-all"
                  style={{ width: `${goal.progress}%` }}
                />
              </div>

              <div className="flex justify-between">
                <div>
                  <p className="text-xs text-ink-muted">Saved</p>
                  <p className="font-semibold text-mint money">{formatCurrency(goal.totalContributions)}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-ink-muted">Target</p>
                  <p className="font-semibold text-ink money">{formatCurrency(goal.targetAmount)}</p>
                </div>
              </div>

              <div className="text-center pt-2">
                <p className="text-sm text-ink-secondary">
                  {formatCurrency(goal.targetAmount - goal.totalContributions)} remaining
                </p>
              </div>
            </div>

            <Button
              variant="primary"
              size="sm"
              className="w-full"
              onClick={() => {
                setSelectedGoalForContribution(goal.id);
                setIsContributionModalOpen(true);
              }}
            >
              <DollarSign size={16} />
              Add Contribution
            </Button>
          </div>
        ))}
      </div>

      {goals.length === 0 && (
        <div className="panel shadow-panel p-12 text-center">
          <TargetIcon size={64} className="mx-auto text-ink-muted mb-4" />
          <p className="text-ink-muted">No goals yet. Add your first savings goal!</p>
        </div>
      )}

      <Modal
        isOpen={isGoalModalOpen}
        onClose={() => {
          setIsGoalModalOpen(false);
          setEditingGoal(null);
        }}
        title={editingGoal ? 'Edit Goal' : 'Add Goal'}
      >
        <GoalForm
          goal={editingGoal}
          onSuccess={handleSuccess}
          onCancel={() => {
            setIsGoalModalOpen(false);
            setEditingGoal(null);
          }}
        />
      </Modal>

      <Modal
        isOpen={isContributionModalOpen}
        onClose={() => {
          setIsContributionModalOpen(false);
          setSelectedGoalForContribution(null);
        }}
        title="Add Contribution"
      >
        {selectedGoalForContribution && (
          <ContributionForm
            goalId={selectedGoalForContribution}
            accounts={accounts}
            onSuccess={handleSuccess}
            onCancel={() => {
              setIsContributionModalOpen(false);
              setSelectedGoalForContribution(null);
            }}
          />
        )}
      </Modal>
    </div>
  );
}
