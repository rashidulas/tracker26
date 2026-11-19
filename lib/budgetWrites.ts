/**
 * Writes for budgets. Used by the Budgets page's server actions and by the
 * chat assistant, so both follow the same rules.
 *
 * The functions take the client to write with: the Prisma client itself, or
 * a transaction client when the write is part of a larger change.
 *
 * Server-only.
 */
import type { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { budgetMonthDate, isValidMonthKey, shiftMonthKey, type MonthKey } from '@/lib/budgets';
import { TransactionError } from '@/lib/transactions';
import { budgetInputSchema } from '@/lib/validations';

type BudgetWriteDb = Pick<Prisma.TransactionClient, 'budget' | 'category'>;

function fail(message: string): never {
  throw new TransactionError(message);
}

/**
 * Create, update or remove a category's budget for a month. An amount of null
 * or 0 removes it. rolloverEnabled left undefined keeps the current setting.
 */
export async function setBudgetIn(
  db: BudgetWriteDb,
  input: z.input<typeof budgetInputSchema>
): Promise<{ removed: boolean }> {
  const parsed = budgetInputSchema.safeParse(input);
  if (!parsed.success) fail(parsed.error.issues[0]?.message ?? 'Invalid budget');
  const { month: key, categoryId, amount, rolloverEnabled } = parsed.data;
  const month = budgetMonthDate(key);
  if (!amount) {
    await db.budget.deleteMany({ where: { month, categoryId } });
    return { removed: true };
  }
  const category = await db.category.findUnique({ where: { id: categoryId } });
  if (!category || category.type !== 'EXPENSE') fail('Budgets need an expense category');
  await db.budget.upsert({
    where: { month_categoryId: { month, categoryId } },
    create: { month, categoryId, amount, rolloverEnabled: rolloverEnabled ?? false },
    update: { amount, ...(rolloverEnabled === undefined ? {} : { rolloverEnabled }) },
  });
  return { removed: false };
}

/** Last month's budgets that `key` has no budget for yet: what copying would add. */
export async function budgetsToCopy(db: Pick<BudgetWriteDb, 'budget'>, key: MonthKey) {
  if (!isValidMonthKey(key)) fail('Invalid month');
  const previous = await db.budget.findMany({
    where: { month: budgetMonthDate(shiftMonthKey(key, -1)) },
  });
  const existing = await db.budget.findMany({
    where: { month: budgetMonthDate(key) },
    select: { categoryId: true },
  });
  const taken = new Set(existing.map((b) => b.categoryId));
  return previous.filter((b) => !taken.has(b.categoryId));
}

/** Copies last month's budgets (amount and rollover) into categories with no budget yet. */
export async function copyPreviousMonthIn(
  db: Pick<BudgetWriteDb, 'budget'>,
  key: MonthKey
): Promise<{ copied: number }> {
  const toCopy = await budgetsToCopy(db, key);
  if (toCopy.length > 0) {
    await db.budget.createMany({
      data: toCopy.map((b) => ({
        month: budgetMonthDate(key),
        categoryId: b.categoryId,
        amount: b.amount,
        rolloverEnabled: b.rolloverEnabled ?? false,
      })),
    });
  }
  return { copied: toCopy.length };
}
