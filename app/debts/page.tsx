'use client';

import { useState, useEffect } from 'react';
import Modal from '@/components/Modal';
import Button from '@/components/Button';
import Input from '@/components/Input';
import Select from '@/components/Select';
import { createDebt, updateDebt, deleteDebt, createPayment, getDebts, getAccounts } from './actions';
import { Plus, Edit2, Trash2, DollarSign } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { format } from 'date-fns';

const debtSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  type: z.string().min(1, 'Type is required'),
  currentBalance: z.string().min(1, 'Balance is required'),
  apr: z.string().optional(),
  minPayment: z.string().optional(),
  dueDay: z.string().optional(),
});

const paymentSchema = z.object({
  date: z.string().min(1, 'Date is required'),
  amount: z.string().min(1, 'Amount is required'),
  fromAccountId: z.string().min(1, 'Account is required'),
  notes: z.string().optional(),
});

type DebtFormData = z.infer<typeof debtSchema>;
type PaymentFormData = z.infer<typeof paymentSchema>;

interface Debt {
  id: string;
  name: string;
  type: string;
  currentBalance: number;
  apr: number | null;
  minPayment: number | null;
  dueDay: number | null;
  payments: Array<{
    id: string;
    date: Date;
    amount: number;
  }>;
}

interface Account {
  id: string;
  name: string;
}

function DebtForm({ debt, onSuccess, onCancel }: {
  debt?: Debt;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { register, handleSubmit, formState: { errors } } = useForm<DebtFormData>({
    resolver: zodResolver(debtSchema),
    defaultValues: {
      name: debt?.name || '',
      type: debt?.type || 'CREDIT_CARD',
      currentBalance: debt?.currentBalance.toString() || '',
      apr: debt?.apr?.toString() || '',
      minPayment: debt?.minPayment?.toString() || '',
      dueDay: debt?.dueDay?.toString() || '',
    },
  });

  const onSubmit = async (data: DebtFormData) => {
    setIsSubmitting(true);
    setError('');

    const formData = new FormData();
    Object.entries(data).forEach(([key, value]) => {
      if (value) formData.append(key, value);
    });

    const result = debt
      ? await updateDebt(debt.id, formData)
      : await createDebt(formData);

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
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      <Input label="Debt Name" {...register('name')} error={errors.name?.message} placeholder="e.g., Student Loan" />

      <Select
        label="Type"
        {...register('type')}
        error={errors.type?.message}
        options={[
          { value: 'CREDIT_CARD', label: 'Credit Card' },
          { value: 'PERSONAL_LOAN', label: 'Personal Loan' },
          { value: 'STUDENT_LOAN', label: 'Student Loan' },
          { value: 'MORTGAGE', label: 'Mortgage' },
          { value: 'AUTO_LOAN', label: 'Auto Loan' },
          { value: 'OTHER', label: 'Other' },
        ]}
      />

      <Input
        label="Current Balance"
        type="number"
        step="0.01"
        {...register('currentBalance')}
        error={errors.currentBalance?.message}
        placeholder="0.00"
      />

      <div className="grid grid-cols-2 gap-4">
        <Input
          label="APR % (Optional)"
          type="number"
          step="0.01"
          {...register('apr')}
          placeholder="4.5"
        />
        <Input
          label="Min Payment (Optional)"
          type="number"
          step="0.01"
          {...register('minPayment')}
          placeholder="100.00"
        />
      </div>

      <Input
        label="Due Day (Optional)"
        type="number"
        min="1"
        max="31"
        {...register('dueDay')}
        placeholder="15"
      />

      <div className="flex gap-3 pt-4">
        <Button type="submit" disabled={isSubmitting} className="flex-1">
          {isSubmitting ? 'Saving...' : debt ? 'Update' : 'Create'}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function PaymentForm({
  debtId,
  accounts,
  onSuccess,
  onCancel,
}: {
  debtId: string;
  accounts: Array<{ id: string; name: string }>;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { register, handleSubmit, formState: { errors } } = useForm<PaymentFormData>({
    resolver: zodResolver(paymentSchema),
    defaultValues: {
      date: new Date().toISOString().split('T')[0],
      amount: '',
      fromAccountId: '',
      notes: '',
    },
  });

  const onSubmit = async (data: PaymentFormData) => {
    setIsSubmitting(true);
    setError('');

    const formData = new FormData();
    formData.append('date', data.date);
    formData.append('amount', data.amount);
    formData.append('debtId', debtId);
    formData.append('fromAccountId', data.fromAccountId);
    formData.append('notes', data.notes || '');

    const result = await createPayment(formData);
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
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
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

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Notes (Optional)</label>
        <textarea
          {...register('notes')}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          rows={3}
        />
      </div>

      <div className="flex gap-3 pt-4">
        <Button type="submit" disabled={isSubmitting} className="flex-1">
          {isSubmitting ? 'Processing...' : 'Record Payment'}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export default function DebtsPage() {
  const [debts, setDebts] = useState<Debt[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDebtModalOpen, setIsDebtModalOpen] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [editingDebt, setEditingDebt] = useState<Debt | null>(null);
  const [selectedDebtForPayment, setSelectedDebtForPayment] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setIsLoading(true);
      const [debtsResult, accountsResult] = await Promise.all([
        getDebts(),
        getAccounts(),
      ]);
      
      if (debtsResult.success && debtsResult.data) {
        setDebts(debtsResult.data);
      }
      
      if (accountsResult.success && accountsResult.data) {
        setAccounts(accountsResult.data);
      }
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setIsLoading(false);
    }
  }

  const handleSuccess = () => {
    setIsDebtModalOpen(false);
    setIsPaymentModalOpen(false);
    setEditingDebt(null);
    setSelectedDebtForPayment(null);
    loadData();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this debt?')) return;
    const result = await deleteDebt(id);
    if (result.success) {
      setDebts(debts.filter((d) => d.id !== id));
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  const totalDebt = debts.reduce((sum, debt) => sum + debt.currentBalance, 0);

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Debts</h1>
          <p className="text-gray-600 mt-1">Track and manage your debts</p>
        </div>
        <Button onClick={() => setIsDebtModalOpen(true)}>
          <Plus size={20} className="inline mr-2" />
          Add Debt
        </Button>
      </div>

      <div className="bg-red-50 border border-red-200 rounded-lg p-6 mb-6">
        <div className="flex justify-between items-center">
          <span className="text-gray-700 font-medium">Total Debt</span>
          <span className="text-3xl font-bold text-red-600">{formatCurrency(totalDebt)}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {debts.map((debt) => (
          <div key={debt.id} className="bg-white rounded-lg shadow p-6">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">{debt.name}</h3>
                <p className="text-sm text-gray-500">{debt.type.replace('_', ' ')}</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => { setEditingDebt(debt); setIsDebtModalOpen(true); }} className="text-blue-600">
                  <Edit2 size={16} />
                </button>
                <button onClick={() => handleDelete(debt.id)} className="text-red-600">
                  <Trash2 size={16} />
                </button>
              </div>
            </div>

            <div className="space-y-3 mb-4">
              <div className="flex justify-between">
                <span className="text-gray-600">Balance</span>
                <span className="font-bold text-red-600">{formatCurrency(debt.currentBalance)}</span>
              </div>
              {debt.apr && (
                <div className="flex justify-between">
                  <span className="text-gray-600">APR</span>
                  <span className="text-gray-900">{debt.apr}%</span>
                </div>
              )}
              {debt.minPayment && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Min Payment</span>
                  <span className="text-gray-900">{formatCurrency(debt.minPayment)}</span>
                </div>
              )}
              {debt.dueDay && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Due Day</span>
                  <span className="text-gray-900">{debt.dueDay}</span>
                </div>
              )}
            </div>

            <Button
              variant="primary"
              size="sm"
              className="w-full"
              onClick={() => { setSelectedDebtForPayment(debt.id); setIsPaymentModalOpen(true); }}
            >
              <DollarSign size={16} className="inline mr-2" />
              Record Payment
            </Button>

            {debt.payments.length > 0 && (
              <div className="mt-4 pt-4 border-t">
                <h4 className="text-sm font-medium text-gray-700 mb-2">Recent Payments</h4>
                {debt.payments.map((payment) => (
                  <div key={payment.id} className="flex justify-between text-sm py-1">
                    <span className="text-gray-600">{format(new Date(payment.date), 'MMM dd')}</span>
                    <span className="text-green-600">{formatCurrency(payment.amount)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {debts.length === 0 && (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <p className="text-gray-500">No debts tracked. Add your first debt!</p>
        </div>
      )}

      <Modal
        isOpen={isDebtModalOpen}
        onClose={() => { setIsDebtModalOpen(false); setEditingDebt(null); }}
        title={editingDebt ? 'Edit Debt' : 'Add Debt'}
      >
        <DebtForm
          debt={editingDebt || undefined}
          onSuccess={handleSuccess}
          onCancel={() => { setIsDebtModalOpen(false); setEditingDebt(null); }}
        />
      </Modal>

      <Modal
        isOpen={isPaymentModalOpen}
        onClose={() => { setIsPaymentModalOpen(false); setSelectedDebtForPayment(null); }}
        title="Record Payment"
      >
        {selectedDebtForPayment && (
          <PaymentForm
            debtId={selectedDebtForPayment}
            accounts={accounts}
            onSuccess={handleSuccess}
            onCancel={() => { setIsPaymentModalOpen(false); setSelectedDebtForPayment(null); }}
          />
        )}
      </Modal>
    </div>
  );
}
