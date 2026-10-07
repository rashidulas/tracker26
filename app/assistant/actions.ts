'use server';

import { revalidatePath } from 'next/cache';
import { createExpense } from '@/app/expenses/actions';
import { createIncome } from '@/app/income/actions';
import type { AssistantDraft } from '@/lib/assistant';

export async function confirmAssistantDraft(draft: AssistantDraft) {
  try {
    const formData = new FormData();
    formData.append('date', draft.date);
    formData.append('amount', String(draft.amount));
    formData.append('categoryId', draft.categoryId);
    if (draft.accountId) formData.append('accountId', draft.accountId);
    if (draft.merchantOrSource) formData.append('merchantOrSource', draft.merchantOrSource);
    if (draft.notes) formData.append('notes', draft.notes);
    if (draft.tags?.length) formData.append('tags', draft.tags.join(','));

    const result =
      draft.kind === 'INCOME' ? await createIncome(formData) : await createExpense(formData);

    if (result.success) {
      revalidatePath('/dashboard');
      revalidatePath('/analytics');
      revalidatePath('/expenses');
      revalidatePath('/income');
      revalidatePath('/accounts');
    }

    return result;
  } catch (error) {
    console.error('confirmAssistantDraft error:', error);
    return { success: false, error: 'Failed to save transaction' };
  }
}
