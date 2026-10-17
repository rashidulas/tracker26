'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { assistantDraftSchema, type AssistantDraft } from '@/lib/assistant';

export async function confirmAssistantDraft(draft: AssistantDraft) {
  try {
    const validated = assistantDraftSchema.safeParse(draft);
    if (!validated.success) {
      return {
        success: false,
        error: validated.error.errors[0]?.message || 'Invalid draft',
      };
    }

    const data = validated.data;

    if (data.kind === 'INCOME' && !data.accountId) {
      return { success: false, error: 'Pick an account for this income first' };
    }

    const category = await prisma.category.findUnique({
      where: { id: data.categoryId },
      select: { id: true, type: true },
    });
    if (!category) {
      return { success: false, error: 'Category not found' };
    }
    if (data.kind === 'INCOME' && category.type !== 'INCOME') {
      return { success: false, error: 'That category is not an income category' };
    }
    if (data.kind === 'EXPENSE' && category.type !== 'EXPENSE') {
      return { success: false, error: 'That category is not an expense category' };
    }

    if (data.accountId) {
      const account = await prisma.account.findUnique({
        where: { id: data.accountId },
        select: { id: true },
      });
      if (!account) {
        return { success: false, error: 'Account not found' };
      }
    }

    await prisma.transaction.create({
      data: {
        date: new Date(data.date),
        amount: data.amount,
        kind: data.kind,
        categoryId: data.categoryId,
        accountId: data.accountId || null,
        merchantOrSource: data.merchantOrSource || null,
        notes: data.notes || null,
        tags: data.tags || [],
        accountSplits: [],
        splitGroupId: null,
      },
    });

    revalidatePath('/dashboard');
    revalidatePath('/analytics');
    revalidatePath('/expenses');
    revalidatePath('/income');
    revalidatePath('/accounts');
    revalidatePath('/chat');

    return { success: true };
  } catch (error) {
    console.error('confirmAssistantDraft error:', error);
    const message = error instanceof Error ? error.message : 'Failed to save transaction';
    return { success: false, error: message };
  }
}
