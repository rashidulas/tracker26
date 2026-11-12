'use server';

import { assistantDraftSchema, type AssistantDraft } from '@/lib/assistant';
import { createTransaction } from '@/lib/transactions';

export async function confirmAssistantDraft(draft: AssistantDraft) {
  const validated = assistantDraftSchema.safeParse(draft);
  if (!validated.success) {
    return {
      success: false,
      error: validated.error.errors[0]?.message || 'Invalid draft',
    };
  }

  const data = validated.data;
  if (!data.accountId) {
    return {
      success: false,
      error:
        data.kind === 'INCOME'
          ? 'Pick an account for this income first'
          : 'Pick an account for this expense first',
    };
  }

  // Validation (category kind, account exists), the write and revalidation
  // all happen in lib/transactions.
  const result = await createTransaction({
    kind: data.kind,
    date: data.date,
    amount: data.amount,
    categoryId: data.categoryId,
    accountId: data.accountId,
    merchantOrSource: data.merchantOrSource ?? null,
    notes: data.notes ?? null,
    tags: data.tags ?? [],
  });

  return result.success ? { success: true } : { success: false, error: result.error };
}
