'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ToastProvider';
import { deleteExpense } from '@/app/expenses/actions';
import { emitExpenseEvent } from '@/lib/expenseEvents';
import type { ExpenseSaveResult } from '@/app/expenses/ExpenseForm';
import { formatCurrency } from '@/lib/utils';

const money = (n: number) => formatCurrency(n);

/**
 * After the expense form saves: push the row to any list on screen, and show
 * a toast. New entries get an Undo that deletes them again.
 */
export function useExpenseSaved() {
  const toast = useToast();
  const router = useRouter();

  return useCallback(
    ({ row, mode, isEdit }: ExpenseSaveResult) => {
      if (row) emitExpenseEvent({ type: 'upserted', row });

      if (isEdit) {
        toast.success('Expense updated');
        return;
      }

      const what =
        mode === 'payment' ? 'Payment' : mode === 'debt' ? 'Debt payment' : 'Expense';
      const label = row
        ? `${what} added · ${money(row.amount)}${
            mode === 'expense' && row.category ? ` · ${row.category.name}` : ''
          }`
        : `${what} added`;

      toast.success(label, {
        action: row
          ? {
              label: 'Undo',
              onClick: async () => {
                try {
                  const result = await deleteExpense(row.id);
                  if (!result.success) {
                    toast.error(result.error || `Couldn't undo — the ${what.toLowerCase()} is still saved`);
                    return;
                  }
                  emitExpenseEvent({ type: 'removed', id: row.id });
                  toast.info(`${what} removed`);
                  router.refresh();
                } catch {
                  toast.error(`Couldn't undo — the ${what.toLowerCase()} is still saved`);
                }
              },
            }
          : undefined,
      });
    },
    [toast, router]
  );
}
