/**
 * Writes for savings goals and their contributions, through runLedgerWrite
 * from lib/transactions.ts so every change is one database transaction.
 *
 * A contribution is one of two things:
 *   - a transfer: the goal has its own account (Goal.accountId) and the money
 *     comes from a different account. A real TRANSFER row moves it, so both
 *     balances change, and GoalContribution.transactionId points at it.
 *   - an earmark: the goal has no account, or the money already sits in the
 *     goal's account. Nothing moves; the source account's balance stays the
 *     same but its "available" amount goes down (earmarkedByAccount).
 *
 * Editing a contribution can switch it between the two (for example after the
 * source account changes). Deleting it deletes its transfer.
 *
 * Server-only. Not a 'use server' file: callers are server actions.
 */
import type { Goal, GoalContribution } from '@prisma/client';
import { z } from 'zod';
import { isValidDay, parseDay } from '@/lib/dates';
import {
  createTransactionIn,
  deleteTransactionIn,
  fail,
  runLedgerWrite,
  updateTransactionIn,
  type LedgerTx,
  type TransactionDeps,
  type TransactionResult,
  type TransferInput,
} from '@/lib/transactions';

const isObjectId = (v: string) => /^[a-f\d]{24}$/i.test(v);

const optionalId = (label: string) =>
  z
    .string()
    .nullish()
    .transform((v) => v?.trim() || null)
    .refine((v) => v === null || isObjectId(v), `${label} not found`);

const goalInputSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  targetAmount: z
    .number({ invalid_type_error: 'Target amount must be a number' })
    .finite('Target amount must be a number')
    .positive('Target amount must be positive'),
  dueDate: z
    .string()
    .nullish()
    .transform((v) => v?.trim() || null)
    .refine((v) => v === null || isValidDay(v), 'Please enter a valid due date'),
  accountId: optionalId('Account'),
});

const contributionInputSchema = z.object({
  goalId: z.string().refine(isObjectId, 'Goal not found'),
  date: z.string().refine(isValidDay, 'Please enter a valid date'),
  amount: z
    .number({ invalid_type_error: 'Amount must be a number' })
    .finite('Amount must be a number')
    .positive('Amount must be positive'),
  fromAccountId: z
    .string({ required_error: 'Account is required' })
    .min(1, 'Account is required')
    .refine(isObjectId, 'Account not found'),
  notes: z
    .string()
    .max(500)
    .nullish()
    .transform((v) => v?.trim() || null),
});

export type GoalInput = z.input<typeof goalInputSchema>;
export type ContributionInput = z.input<typeof contributionInputSchema>;

function parse<S extends z.ZodTypeAny>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) fail(parsed.error.errors[0]?.message || 'Invalid input');
  return parsed.data;
}

async function assertAccount(tx: LedgerTx, accountId: string | null) {
  if (!accountId) return;
  const account = await tx.account.findUnique({ where: { id: accountId }, select: { id: true } });
  if (!account) fail('Account not found');
}

/** True when a contribution from `fromAccountId` has to move money. */
export function contributionNeedsTransfer(
  goal: { accountId: string | null },
  fromAccountId: string
): boolean {
  return Boolean(goal.accountId && goal.accountId !== fromAccountId);
}

function transferFor(
  goal: Pick<Goal, 'name' | 'accountId'>,
  data: z.output<typeof contributionInputSchema>
): TransferInput {
  return {
    kind: 'TRANSFER',
    date: data.date,
    amount: data.amount,
    accountId: data.fromAccountId,
    toAccountId: goal.accountId ?? '',
    merchantOrSource: `Goal: ${goal.name}`,
    notes: data.notes,
    tags: ['goal'],
  };
}

// ==================== GOALS ====================

export async function createGoal(
  input: GoalInput,
  deps?: Partial<TransactionDeps>
): Promise<TransactionResult<Goal>> {
  return runLedgerWrite(deps, 'create goal', (tx) => createGoalIn(tx, input));
}

/** createGoal, inside a transaction the caller already opened. */
export async function createGoalIn(tx: LedgerTx, input: GoalInput): Promise<Goal> {
  const data = parse(goalInputSchema, input);
  await assertAccount(tx, data.accountId);
  return tx.goal.create({
    data: {
      name: data.name,
      targetAmount: data.targetAmount,
      dueDate: data.dueDate ? parseDay(data.dueDate) : null,
      accountId: data.accountId,
    },
  });
}

/**
 * Edits a goal. Its account can change only while no contribution has been
 * transferred into the current one: those transfers would otherwise point at
 * an account the goal no longer uses. Earmarks stay earmarks.
 */
export async function updateGoal(
  id: string,
  input: GoalInput,
  deps?: Partial<TransactionDeps>
): Promise<TransactionResult<Goal>> {
  return runLedgerWrite(deps, 'update goal', async (tx) => {
    const existing = await tx.goal.findUnique({ where: { id } });
    if (!existing) fail('Goal not found');
    const data = parse(goalInputSchema, input);
    await assertAccount(tx, data.accountId);

    if ((existing.accountId ?? null) !== data.accountId && existing.accountId) {
      const transfers = await tx.goalContribution.count({
        where: { goalId: id, transactionId: { not: null } },
      });
      if (transfers > 0) {
        fail(
          `${transfers} contribution${transfers === 1 ? ' was' : 's were'} already transferred into this goal's account. Delete ${transfers === 1 ? 'it' : 'them'} before changing the account.`
        );
      }
    }

    return tx.goal.update({
      where: { id },
      data: {
        name: data.name,
        targetAmount: data.targetAmount,
        dueDate: data.dueDate ? parseDay(data.dueDate) : null,
        accountId: data.accountId,
      },
    });
  });
}

/**
 * Deletes a goal and its contributions. Transfers already made stay: the money
 * really moved, so they remain ordinary transfers between your accounts.
 * Earmarks are released.
 */
export async function deleteGoal(
  id: string,
  deps?: Partial<TransactionDeps>
): Promise<TransactionResult<{ deleted: number }>> {
  return runLedgerWrite(deps, 'delete goal', async (tx) => {
    const existing = await tx.goal.findUnique({ where: { id }, select: { id: true } });
    if (!existing) fail('Goal not found');
    const { count } = await tx.goalContribution.deleteMany({ where: { goalId: id } });
    await tx.goal.delete({ where: { id } });
    return { deleted: count };
  });
}

// ==================== CONTRIBUTIONS ====================

export async function createContribution(
  input: ContributionInput,
  deps?: Partial<TransactionDeps>
): Promise<TransactionResult<GoalContribution>> {
  return runLedgerWrite(deps, 'add contribution', (tx) => createContributionIn(tx, input));
}

/** createContribution, inside a transaction the caller already opened. */
export async function createContributionIn(
  tx: LedgerTx,
  input: ContributionInput
): Promise<GoalContribution> {
  const data = parse(contributionInputSchema, input);
  const goal = await tx.goal.findUnique({ where: { id: data.goalId } });
  if (!goal) fail('Goal not found');

  let transactionId: string | null = null;
  if (contributionNeedsTransfer(goal, data.fromAccountId)) {
    transactionId = (await createTransactionIn(tx, transferFor(goal, data))).id;
  } else {
    await assertAccount(tx, data.fromAccountId);
  }

  return tx.goalContribution.create({
    data: {
      goalId: goal.id,
      date: parseDay(data.date),
      amount: data.amount,
      fromAccountId: data.fromAccountId,
      notes: data.notes,
      transactionId,
    },
  });
}

/** Edits a contribution (its goal stays the same) and its transfer, if any. */
export async function updateContribution(
  id: string,
  input: Omit<ContributionInput, 'goalId'>,
  deps?: Partial<TransactionDeps>
): Promise<TransactionResult<GoalContribution>> {
  return runLedgerWrite(deps, 'update contribution', async (tx) => {
    const existing = await tx.goalContribution.findUnique({ where: { id } });
    if (!existing) fail('Contribution not found');
    const data = parse(contributionInputSchema, { ...input, goalId: existing.goalId });
    const goal = await tx.goal.findUnique({ where: { id: existing.goalId } });
    if (!goal) fail('Goal not found');

    let transactionId = existing.transactionId ?? null;
    if (contributionNeedsTransfer(goal, data.fromAccountId)) {
      if (transactionId) {
        await updateTransactionIn(tx, transactionId, transferFor(goal, data));
      } else {
        transactionId = (await createTransactionIn(tx, transferFor(goal, data))).id;
      }
    } else {
      await assertAccount(tx, data.fromAccountId);
      if (transactionId) {
        // Unlink first: deleting a transfer also deletes the contribution it funds.
        await tx.goalContribution.update({ where: { id }, data: { transactionId: null } });
        await deleteTransactionIn(tx, transactionId);
        transactionId = null;
      }
    }

    return tx.goalContribution.update({
      where: { id },
      data: {
        date: parseDay(data.date),
        amount: data.amount,
        fromAccountId: data.fromAccountId,
        notes: data.notes,
        transactionId,
      },
    });
  });
}

/** Deletes a contribution and the transfer that funded it. */
export async function deleteContribution(
  id: string,
  deps?: Partial<TransactionDeps>
): Promise<TransactionResult<{ deleted: number }>> {
  return runLedgerWrite(deps, 'delete contribution', async (tx) => {
    const existing = await tx.goalContribution.findUnique({ where: { id } });
    if (!existing) fail('Contribution not found');
    if (existing.transactionId) {
      // Removes the transfer and, with it, this contribution.
      await deleteTransactionIn(tx, existing.transactionId);
      const left = await tx.goalContribution.findUnique({ where: { id }, select: { id: true } });
      if (left) await tx.goalContribution.delete({ where: { id } });
    } else {
      await tx.goalContribution.delete({ where: { id } });
    }
    return { deleted: 1 };
  });
}
