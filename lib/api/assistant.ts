import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { assistantDraftSchema } from '@/lib/assistant';
import { toTransactionDTO, transactionInclude, type TransactionDTO } from './dto';
import { ApiError, fail, ok } from './http';

export const confirmBodySchema = z.object(
  { draft: assistantDraftSchema },
  { required_error: 'draft is required' }
);

/**
 * Same validation as `confirmAssistantDraft` (app/assistant/actions.ts), but
 * returns the created transaction.
 */
export async function confirmDraft(
  draft: z.output<typeof assistantDraftSchema>
): Promise<TransactionDTO> {
  if (draft.kind === 'INCOME' && !draft.accountId) {
    throw new ApiError('Pick an account for this income first', 400);
  }

  const category = await prisma.category.findUnique({
    where: { id: draft.categoryId },
    select: { id: true, type: true },
  });
  if (!category) throw new ApiError('Category not found', 400);
  if (draft.kind === 'INCOME' && category.type !== 'INCOME') {
    throw new ApiError('That category is not an income category', 400);
  }
  if (draft.kind === 'EXPENSE' && category.type !== 'EXPENSE') {
    throw new ApiError('That category is not an expense category', 400);
  }

  if (draft.accountId) {
    const account = await prisma.account.findUnique({
      where: { id: draft.accountId },
      select: { id: true },
    });
    if (!account) throw new ApiError('Account not found', 400);
  }

  const row = await prisma.transaction.create({
    data: {
      date: new Date(draft.date),
      amount: draft.amount,
      kind: draft.kind,
      categoryId: draft.categoryId,
      accountId: draft.accountId || null,
      merchantOrSource: draft.merchantOrSource || null,
      notes: draft.notes || null,
      tags: draft.tags || [],
      accountSplits: [],
      splitGroupId: null,
    },
    include: transactionInclude,
  });
  return toTransactionDTO(row);
}

/**
 * Re-wrap a response from one of the existing web AI routes
 * (`{ success, data }` / `{ error }`) into the v1 `{ data }` / `{ error }` envelope.
 */
export async function relayLegacyResponse(
  res: Response,
  pick: (json: Record<string, unknown>) => unknown = (json) => json.data
): Promise<Response> {
  let json: Record<string, unknown> | null = null;
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    json = null;
  }

  if (!res.ok || !json) {
    const message = typeof json?.error === 'string' ? json.error : 'Request failed';
    return fail(message, res.ok ? 502 : res.status);
  }
  return ok(pick(json));
}
