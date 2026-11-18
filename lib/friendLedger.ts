/**
 * Writes for friend IOUs. Every write runs through runLedgerWrite from
 * lib/transactions.ts, so an entry and the expense or account it touches are
 * changed in one database transaction and the same pages are revalidated.
 *
 * Two kinds of entry:
 *   - linked to an expense (transactionId): a friend's share of something you
 *     paid for. Created by the expense form's "Split with friends". Its type
 *     is THEY_OWE_ME, its date follows the expense and it has no account.
 *     Editing its amount here updates the expense's sharedAmount.
 *   - standalone: optionally with accountId, the account the money went
 *     through (lent, borrowed, received, paid back). That account's balance
 *     moves (see friendEntryAccountDelta).
 *
 * Server-only. Not a 'use server' file: callers are server actions.
 */
import type { FriendEntry } from '@prisma/client';
import { z } from 'zod';
import { isValidDay, parseDay } from '@/lib/dates';
import {
  fail,
  refreshSharedAmount,
  runLedgerWrite,
  type LedgerTx,
  type TransactionDeps,
  type TransactionResult,
} from '@/lib/transactions';

const isObjectId = (v: string) => /^[a-f\d]{24}$/i.test(v);

const text = (max: number) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((v) => v?.trim() || null);

const entryInputSchema = z.object({
  friendId: z.string().refine(isObjectId, 'Friend not found'),
  date: z.string().refine(isValidDay, 'Please enter a valid date'),
  amount: z
    .number({ invalid_type_error: 'Amount must be a number' })
    .finite('Amount must be a number')
    .positive('Amount must be positive'),
  type: z.enum(['THEY_OWE_ME', 'I_OWE_THEM', 'THEY_PAID_ME', 'I_PAID_THEM']),
  description: text(120),
  notes: text(300),
  accountId: z
    .string()
    .nullish()
    .transform((v) => v?.trim() || null)
    .refine((v) => v === null || isObjectId(v), 'Account not found'),
});

export type FriendEntryInput = z.input<typeof entryInputSchema>;

function parseEntry(input: FriendEntryInput) {
  const parsed = entryInputSchema.safeParse(input);
  if (!parsed.success) fail(parsed.error.errors[0]?.message || 'Invalid entry');
  return parsed.data;
}

async function assertAccount(tx: LedgerTx, accountId: string | null) {
  if (!accountId) return;
  const account = await tx.account.findUnique({ where: { id: accountId }, select: { id: true } });
  if (!account) fail('Account not found');
}

export async function createFriendEntry(
  input: FriendEntryInput,
  deps?: Partial<TransactionDeps>
): Promise<TransactionResult<FriendEntry>> {
  return runLedgerWrite(deps, 'add entry', async (tx) => {
    const data = parseEntry(input);
    const friend = await tx.friend.findUnique({ where: { id: data.friendId }, select: { id: true } });
    if (!friend) fail('Friend not found');
    await assertAccount(tx, data.accountId);
    return tx.friendEntry.create({
      data: {
        friendId: data.friendId,
        date: parseDay(data.date),
        amount: data.amount,
        type: data.type,
        description: data.description,
        notes: data.notes,
        accountId: data.accountId,
        transactionId: null,
      },
    });
  });
}

/**
 * Edits an entry. An entry that is part of an expense keeps its friend, type
 * and date (they follow the expense); only its amount, description and notes
 * change, and the expense's sharedAmount follows.
 */
export async function updateFriendEntry(
  id: string,
  input: FriendEntryInput,
  deps?: Partial<TransactionDeps>
): Promise<TransactionResult<FriendEntry>> {
  return runLedgerWrite(deps, 'update entry', async (tx) => {
    const existing = await tx.friendEntry.findUnique({ where: { id } });
    if (!existing) fail('Entry not found');
    const data = parseEntry({ ...input, friendId: existing.friendId });

    if (existing.transactionId) {
      if (data.type !== existing.type) {
        fail("This entry is a friend's share of an expense, so it stays \"They owe me\"");
      }
      if (data.accountId) {
        fail('This entry is part of an expense, which already moved the money. Pick no account.');
      }
      const updated = await tx.friendEntry.update({
        where: { id },
        data: { amount: data.amount, description: data.description, notes: data.notes },
      });
      await refreshSharedAmount(tx, existing.transactionId);
      return updated;
    }

    await assertAccount(tx, data.accountId);
    return tx.friendEntry.update({
      where: { id },
      data: {
        date: parseDay(data.date),
        amount: data.amount,
        type: data.type,
        description: data.description,
        notes: data.notes,
        accountId: data.accountId,
      },
    });
  });
}

/** Deletes an entry. A split expense's share goes back to being yours. */
export async function deleteFriendEntry(
  id: string,
  deps?: Partial<TransactionDeps>
): Promise<TransactionResult<{ deleted: number }>> {
  return runLedgerWrite(deps, 'delete entry', async (tx) => {
    const existing = await tx.friendEntry.findUnique({ where: { id } });
    if (!existing) fail('Entry not found');
    await tx.friendEntry.delete({ where: { id } });
    if (existing.transactionId) await refreshSharedAmount(tx, existing.transactionId);
    return { deleted: 1 };
  });
}

/**
 * Deletes a friend and all their entries. Expenses they shared go back to
 * being fully yours; money already settled through an account stops counting
 * toward that account's balance, so the caller should warn about that.
 */
export async function deleteFriend(
  id: string,
  deps?: Partial<TransactionDeps>
): Promise<TransactionResult<{ deleted: number }>> {
  return runLedgerWrite(deps, 'delete friend', async (tx) => {
    const friend = await tx.friend.findUnique({ where: { id }, select: { id: true } });
    if (!friend) fail('Friend not found');
    const entries = await tx.friendEntry.findMany({
      where: { friendId: id },
      select: { transactionId: true },
    });
    await tx.friendEntry.deleteMany({ where: { friendId: id } });
    const expenses = [
      ...new Set(entries.map((e) => e.transactionId).filter((t): t is string => !!t)),
    ];
    for (const transactionId of expenses) await refreshSharedAmount(tx, transactionId);
    await tx.friend.delete({ where: { id } });
    return { deleted: entries.length };
  });
}
