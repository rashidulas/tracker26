/**
 * Recurring entries: templates, posting, skipping and the due check.
 *
 * IDEMPOTENCY
 * -----------
 * Each occurrence is handled at most once. Posting or skipping occurrence D of
 * entry R runs in one database transaction that
 *   1. requires R.nextDueDate to still be D (otherwise someone already handled
 *      it: "already posted"),
 *   2. inserts RecurringPosting(R, D), which has a unique index on
 *      (recurringId, dueDate), so a racing second run fails here,
 *   3. creates the transaction through lib/transactions (same rules as any
 *      other write) with recurringId = R,
 *   4. moves nextDueDate on with a conditional update (where nextDueDate = D).
 * If any step fails the whole transaction rolls back. Opening the app twice,
 * two tabs, or the cron route racing the app can never post D twice.
 *
 * PAYING A FRIEND BACK, AND INSTALLMENT PLANS
 * -------------------------------------------
 * An expense entry with friendId pays that friend: posting an occurrence
 * writes the expense (which moves the account) and an I_PAID_THEM friend
 * entry linked to it by paymentTransactionId (which lowers what you owe).
 * An entry with totalAmount is an installment plan. What is paid is the sum
 * of the transactions posted from it, so editing or deleting a payment
 * changes what is left; the last payment is the remainder and the plan
 * switches itself off when nothing is left.
 *
 * Server-only.
 */
import type { Prisma, RecurringTransaction } from '@prisma/client';
import { z } from 'zod';
import { isValidDay, parseDay, toDayString, todayInAppTimeZone, type DayString } from '@/lib/dates';
import {
  createTransactionIn,
  runLedgerWrite,
  TransactionError,
  type TransactionDeps,
  type TransactionInput,
  type TransactionResult,
} from '@/lib/transactions';
import { cleanMerchantName, ensureMerchant, normalizeMerchantName } from '@/lib/merchants';
import { FREQUENCIES, nextAfter, occurrencesBetween, type Frequency } from '@/lib/recurringSchedule';
import { addDays } from '@/lib/dates';

type Tx = Prisma.TransactionClient;

/** How far ahead the Upcoming card looks. */
export const UPCOMING_DAYS = 14;
/** Safety cap on occurrences auto-posted for one entry in one run. */
const MAX_CATCH_UP = 120;

// ==================== INPUT ====================

const objectId = /^[a-f\d]{24}$/i;
const optionalId = z
  .string()
  .trim()
  .nullish()
  .transform((v) => v || null)
  .refine((v) => v === null || objectId.test(v), 'Invalid id');

const day = (label: string) =>
  z
    .string({ required_error: `${label} is required` })
    .trim()
    .refine(isValidDay, `${label} must be a valid date`);

export const recurringInputSchema = z
  .object({
    name: z.string().trim().max(80).optional(),
    kind: z.enum(['INCOME', 'EXPENSE', 'TRANSFER']),
    amount: z
      .number({ invalid_type_error: 'Amount must be a number' })
      .finite('Amount must be a number')
      .positive('Amount must be positive'),
    categoryId: optionalId,
    subcategoryId: optionalId,
    accountId: z.string().trim().regex(objectId, 'Choose an account'),
    toAccountId: optionalId,
    merchantOrSource: z.string().max(100).nullish(),
    notes: z.string().max(500).nullish(),
    frequency: z.enum(FREQUENCIES),
    /** First due date; sets the schedule's day. */
    startDate: day('First due date'),
    endDate: z
      .string()
      .trim()
      .nullish()
      .transform((v) => v || null)
      .refine((v) => v === null || isValidDay(v), 'End date must be a valid date'),
    autoPost: z.boolean().default(false),
    /** Expenses only: each payment also pays back this friend. */
    friendId: optionalId,
    /** Installment plan: the total to pay off. Null = repeats until ended. */
    totalAmount: z
      .number({ invalid_type_error: 'Total must be a number' })
      .finite('Total must be a number')
      .positive('Total must be positive')
      .nullish()
      .transform((v) => v ?? null),
    /**
     * Create only, with a friend and a total: also add the total to what you
     * owe the friend, dated `debtDate` (default: the first due date).
     */
    recordDebt: z.boolean().optional(),
    debtDate: z
      .string()
      .trim()
      .nullish()
      .transform((v) => v || null)
      .refine((v) => v === null || isValidDay(v), 'Purchase date must be a valid date'),
    /** Days before the due day to remind; negative = never; null = default. */
    remindDaysBefore: z.number().int().min(-1).max(60).nullish().transform((v) => v ?? null),
    /** Past transactions to link to this entry (from a detection suggestion). */
    linkTransactionIds: z.array(z.string().regex(objectId)).max(500).optional(),
  })
  .superRefine((d, ctx) => {
    if (d.friendId && d.kind !== 'EXPENSE') {
      ctx.addIssue({ code: 'custom', path: ['friendId'], message: 'Only an expense can pay back a friend' });
    }
    if (d.totalAmount !== null && Math.round(d.totalAmount * 100) < Math.round(d.amount * 100)) {
      ctx.addIssue({ code: 'custom', path: ['totalAmount'], message: 'The total is less than one payment' });
    }
    if (d.totalAmount !== null && d.endDate) {
      ctx.addIssue({
        code: 'custom',
        path: ['endDate'],
        message: 'An installment plan ends when the total is paid, so it has no end date',
      });
    }
    if (d.endDate && d.endDate < d.startDate) {
      ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'End date is before the first due date' });
    }
    if (d.kind === 'TRANSFER') {
      if (!d.toAccountId) ctx.addIssue({ code: 'custom', path: ['toAccountId'], message: 'Choose the account to transfer to' });
    } else if (!d.categoryId) {
      ctx.addIssue({ code: 'custom', path: ['categoryId'], message: 'Category is required' });
    }
  });

export type RecurringInput = z.input<typeof recurringInputSchema>;
type ParsedRecurring = z.output<typeof recurringInputSchema>;

function fail(message: string): never {
  throw new TransactionError(message);
}

function parse(input: RecurringInput): ParsedRecurring {
  const parsed = recurringInputSchema.safeParse(input);
  if (!parsed.success) fail(parsed.error.errors[0]?.message || 'Invalid recurring entry');
  return parsed.data;
}

/** The transaction a template produces on `date`. */
export function templateToInput(
  t: Pick<
    RecurringTransaction,
    'kind' | 'amount' | 'categoryId' | 'subcategoryId' | 'accountId' | 'toAccountId' | 'merchantOrSource' | 'notes'
  >,
  date: DayString
): TransactionInput {
  if (t.kind === 'TRANSFER') {
    return {
      kind: 'TRANSFER',
      date,
      amount: t.amount,
      accountId: t.accountId,
      toAccountId: t.toAccountId ?? '',
      merchantOrSource: t.merchantOrSource,
      notes: t.notes,
    };
  }
  return {
    kind: t.kind,
    date,
    amount: t.amount,
    categoryId: t.categoryId,
    subcategoryId: t.subcategoryId,
    accountId: t.accountId,
    merchantOrSource: t.merchantOrSource,
    notes: t.notes,
  };
}

/** Checks the template against the same rules as a real transaction. */
async function validateTemplate(tx: Tx, p: ParsedRecurring) {
  const accountIds = [p.accountId, ...(p.kind === 'TRANSFER' && p.toAccountId ? [p.toAccountId] : [])];
  if (p.kind === 'TRANSFER' && p.accountId === p.toAccountId) fail('From and To accounts cannot be the same');
  const accounts = await tx.account.findMany({ where: { id: { in: accountIds } }, select: { id: true } });
  if (accounts.length !== new Set(accountIds).size) fail('Account not found');
  if (p.friendId) {
    const friend = await tx.friend.findUnique({ where: { id: p.friendId }, select: { id: true } });
    if (!friend) fail('Friend not found');
  }
  if (p.kind === 'TRANSFER') return;
  const category = await tx.category.findUnique({
    where: { id: p.categoryId! },
    select: { id: true, type: true },
  });
  if (!category) fail('Category not found');
  if (category.type !== p.kind) {
    fail(`That category is not ${p.kind === 'INCOME' ? 'an income' : 'an expense'} category`);
  }
  if (p.subcategoryId) {
    const sub = await tx.subcategory.findFirst({
      where: { id: p.subcategoryId, categoryId: category.id },
      select: { id: true },
    });
    if (!sub) fail('Subcategory does not belong to the selected category');
  }
}

async function templateData(tx: Tx, p: ParsedRecurring) {
  await validateTemplate(tx, p);
  // A plan's payments are listed under what was bought ("Camera") when no
  // merchant was given, instead of as nameless expenses.
  const merchantSource =
    p.merchantOrSource?.trim() || (p.totalAmount !== null ? p.name?.trim() : '') || null;
  const merchant = p.kind === 'TRANSFER' ? null : await ensureMerchant(tx, merchantSource);
  // A plan that pays into a loan or card labels its payments with its name.
  const merchantText =
    p.kind === 'TRANSFER'
      ? cleanMerchantName(p.merchantOrSource) ?? (p.totalAmount !== null ? cleanMerchantName(p.name) : null)
      : merchant?.name ?? null;
  const name =
    cleanMerchantName(p.name) ?? merchantText ?? (p.kind === 'TRANSFER' ? 'Transfer' : 'Recurring entry');
  return {
    name,
    kind: p.kind,
    amount: p.amount,
    categoryId: p.kind === 'TRANSFER' ? null : p.categoryId,
    subcategoryId: p.kind === 'TRANSFER' ? null : p.subcategoryId,
    accountId: p.accountId,
    toAccountId: p.kind === 'TRANSFER' ? p.toAccountId : null,
    merchantId: merchant?.id ?? null,
    merchantOrSource: merchantText,
    notes: p.notes?.trim() || null,
    frequency: p.frequency,
    endDate: p.endDate ? parseDay(p.endDate) : null,
    autoPost: p.autoPost,
    friendId: p.kind === 'EXPENSE' ? p.friendId : null,
    totalAmount: p.totalAmount === null ? null : toCents(p.totalAmount) / 100,
    remindDaysBefore: p.remindDaysBefore,
  };
}

// ==================== INSTALLMENT PLANS ====================

const toCents = (n: number) => Math.round(n * 100);
const money = (n: number) => `$${n.toFixed(2)}`;

export type PlanProgress = {
  total: number;
  paid: number;
  remaining: number;
  /** Payments still to make at the regular amount (the last may be smaller). */
  paymentsLeft: number;
  /** The next payment: the regular amount, or what is left if that is less. */
  nextAmount: number;
};

export function planProgress(total: number, paid: number, amount: number): PlanProgress {
  const remaining = Math.max(0, toCents(total) - toCents(paid));
  const each = toCents(amount);
  return {
    total: toCents(total) / 100,
    paid: toCents(paid) / 100,
    remaining: remaining / 100,
    paymentsLeft: each > 0 ? Math.ceil(remaining / each) : 0,
    nextAmount: Math.min(each, remaining) / 100,
  };
}

type PaidDb = { transaction: Pick<Tx['transaction'], 'findMany'> };

/** What has been posted from each of these entries so far. */
export async function paidByRecurring(db: PaidDb, ids: string[]): Promise<Map<string, number>> {
  const paid = new Map<string, number>();
  if (ids.length === 0) return paid;
  const rows = await db.transaction.findMany({
    where: { recurringId: { in: ids } },
    select: { recurringId: true, amount: true },
  });
  for (const row of rows) {
    if (!row.recurringId) continue;
    paid.set(row.recurringId, (paid.get(row.recurringId) ?? 0) + toCents(row.amount));
  }
  for (const [id, value] of paid) paid.set(id, value / 100);
  return paid;
}

async function isPaidOff(tx: Tx, id: string, totalAmount: number | null) {
  if (totalAmount === null) return false;
  const paid = (await paidByRecurring(tx, [id])).get(id) ?? 0;
  return toCents(paid) >= toCents(totalAmount);
}

/**
 * Link past transactions (from a detection suggestion) so charts count them
 * as recurring. Only unlinked rows of the same kind and merchant are linked.
 */
async function linkHistory(tx: Tx, recurringId: string, p: ParsedRecurring) {
  const ids = [...new Set(p.linkTransactionIds ?? [])];
  if (ids.length === 0 || p.kind === 'TRANSFER') return 0;
  const key = normalizeMerchantName(p.merchantOrSource);
  if (!key) return 0;
  const rows = await tx.transaction.findMany({
    where: { id: { in: ids }, kind: p.kind },
    select: { id: true, merchantOrSource: true, recurringId: true },
  });
  const ok = rows
    .filter((r) => !r.recurringId && normalizeMerchantName(r.merchantOrSource) === key)
    .map((r) => r.id);
  if (ok.length === 0) return 0;
  const { count } = await tx.transaction.updateMany({
    where: { id: { in: ok } },
    data: { recurringId },
  });
  return count;
}

// ==================== TEMPLATE CRUD ====================

export async function createRecurring(
  input: RecurringInput,
  deps?: Partial<TransactionDeps>
): Promise<TransactionResult<RecurringTransaction & { linked: number }>> {
  return runLedgerWrite(deps, 'save recurring entry', (tx) => createRecurringIn(tx, input));
}

/** createRecurring, inside a transaction the caller already opened. */
export async function createRecurringIn(
  tx: Tx,
  input: RecurringInput
): Promise<RecurringTransaction & { linked: number }> {
  const p = parse(input);
  const data = await templateData(tx, p);
  const start = parseDay(p.startDate);
  const created = await tx.recurringTransaction.create({
    data: { ...data, startDate: start, nextDueDate: start, active: true },
  });
  const linked = await linkHistory(tx, created.id, p);
  // "I owe Fuad 15,000 for the camera": the debt the plan then pays down.
  if (p.recordDebt && created.friendId && created.totalAmount !== null) {
    await tx.friendEntry.create({
      data: {
        friendId: created.friendId,
        date: parseDay(p.debtDate ?? p.startDate),
        amount: created.totalAmount,
        type: 'I_OWE_THEM',
        description: created.name,
        notes: 'Paid back in installments',
        accountId: null,
        transactionId: null,
        paymentTransactionId: null,
      },
    });
  }
  return { ...created, linked };
}

/**
 * Edit a template. The schedule is re-anchored only when the frequency or the
 * next due date changes; startDate then becomes the new next due date.
 */
export async function updateRecurring(
  id: string,
  input: RecurringInput,
  deps?: Partial<TransactionDeps>
): Promise<TransactionResult<RecurringTransaction>> {
  return runLedgerWrite(deps, 'update recurring entry', async (tx) => {
    const existing = await tx.recurringTransaction.findUnique({ where: { id } });
    if (!existing) fail('Recurring entry not found');
    const p = parse(input);
    const data = await templateData(tx, p);
    const scheduleChanged =
      p.frequency !== existing.frequency || p.startDate !== toDayString(existing.nextDueDate);
    const next = scheduleChanged ? parseDay(p.startDate) : existing.nextDueDate;
    const ended =
      Boolean(data.endDate && next > data.endDate) || (await isPaidOff(tx, id, data.totalAmount));
    return tx.recurringTransaction.update({
      where: { id },
      data: {
        ...data,
        ...(scheduleChanged ? { startDate: next, nextDueDate: next } : {}),
        active: ended ? false : existing.active || scheduleChanged,
      },
    });
  });
}

export async function setRecurringActive(
  id: string,
  active: boolean,
  deps?: Partial<TransactionDeps>
): Promise<TransactionResult<RecurringTransaction>> {
  return runLedgerWrite(deps, active ? 'resume recurring entry' : 'pause recurring entry', (tx) =>
    setRecurringActiveIn(tx, id, active)
  );
}

/** setRecurringActive, inside a transaction the caller already opened. */
export async function setRecurringActiveIn(
  tx: Tx,
  id: string,
  active: boolean
): Promise<RecurringTransaction> {
  const existing = await tx.recurringTransaction.findUnique({ where: { id } });
  if (!existing) fail('Recurring entry not found');
  if (active && existing.endDate && existing.nextDueDate > existing.endDate) {
    fail('This entry has ended. Change its end date to resume it.');
  }
  if (active && (await isPaidOff(tx, id, existing.totalAmount ?? null))) {
    fail('This plan is paid off. Raise its total to keep paying.');
  }
  return tx.recurringTransaction.update({ where: { id }, data: { active } });
}

/**
 * Delete a template and its posting log. Posted transactions stay; they are
 * unlinked, so charts count them as everyday spending from then on.
 */
export async function deleteRecurring(
  id: string,
  deps?: Partial<TransactionDeps>
): Promise<TransactionResult<{ deleted: true }>> {
  return runLedgerWrite(deps, 'delete recurring entry', async (tx) => {
    const existing = await tx.recurringTransaction.findUnique({ where: { id }, select: { id: true } });
    if (!existing) fail('Recurring entry not found');
    await tx.transaction.updateMany({ where: { recurringId: id }, data: { recurringId: null } });
    await tx.recurringPosting.deleteMany({ where: { recurringId: id } });
    await tx.recurringTransaction.delete({ where: { id } });
    return { deleted: true as const };
  });
}

// ==================== POSTING ====================

export const ALREADY_HANDLED = 'Already posted or skipped. Refresh to see the latest.';

function isConflict(error: unknown) {
  const code = (error as { code?: string } | null)?.code;
  // P2002 unique constraint (RecurringPosting), P2034 write conflict / deadlock.
  return code === 'P2002' || code === 'P2034';
}

/**
 * Handle occurrence `dueDay` of entry `id`: post it (creating a transaction
 * dated `postDate`) or skip it. See IDEMPOTENCY at the top of this file.
 */
async function handleOccurrence(
  tx: Tx,
  id: string,
  dueDay: DayString,
  action: 'POST' | 'SKIP',
  postDate: DayString,
  options: {
    /** Posted by the due check, not by the user: goes to the review inbox. */
    auto?: boolean;
    /** Pay a different amount this time (more, less, or the rest of a plan). */
    amount?: number;
  } = {}
) {
  const rec = await tx.recurringTransaction.findUnique({ where: { id } });
  if (!rec) fail('Recurring entry not found');
  if (!rec.active) fail('This recurring entry is paused');
  if (toDayString(rec.nextDueDate) !== dueDay) fail(ALREADY_HANDLED);

  const due = parseDay(dueDay);
  let transactionId: string | null = null;
  let amount = rec.amount;
  let completed = false;
  if (action === 'POST') {
    if (options.amount !== undefined) {
      if (!Number.isFinite(options.amount) || options.amount <= 0) fail('Amount must be positive');
      amount = toCents(options.amount) / 100;
    }
    if (rec.totalAmount != null) {
      const paid = (await paidByRecurring(tx, [id])).get(id) ?? 0;
      const remaining = toCents(rec.totalAmount) - toCents(paid);
      if (remaining <= 0) fail(`${rec.name} is already paid off`);
      if (options.amount === undefined) amount = Math.min(toCents(amount), remaining) / 100;
      else if (toCents(amount) > remaining) {
        fail(`Only ${money(remaining / 100)} is left to pay on ${rec.name}`);
      }
      completed = toCents(amount) >= remaining;
    }
  }
  try {
    const posting = await tx.recurringPosting.create({
      data: { recurringId: id, dueDate: due, status: action === 'POST' ? 'POSTED' : 'SKIPPED' },
    });
    if (action === 'POST') {
      // A plan paying into a loan or a card is a debt / card payment, like the
      // ones entered by hand: same category, tag and place in the lists.
      let purpose: 'payment' | 'debt-payment' | undefined;
      if (rec.kind === 'TRANSFER' && rec.totalAmount != null && rec.toAccountId) {
        const to = await tx.account.findUnique({ where: { id: rec.toAccountId }, select: { type: true } });
        purpose = to?.type === 'LOAN' ? 'debt-payment' : to?.type === 'CREDIT_CARD' ? 'payment' : undefined;
      }
      const created = await createTransactionIn(
        tx,
        {
          ...templateToInput(rec, postDate),
          ...(purpose ? { purpose } : {}),
          amount,
          ...(options.auto ? { source: 'recurring' as const } : {}),
        },
        { recurringId: id }
      );
      transactionId = created.id;
      if (rec.friendId && rec.kind === 'EXPENSE') {
        const friend = await tx.friend.findUnique({ where: { id: rec.friendId }, select: { id: true } });
        if (friend) {
          await tx.friendEntry.create({
            data: {
              friendId: friend.id,
              date: parseDay(postDate),
              amount,
              type: 'I_PAID_THEM',
              description: rec.name,
              accountId: null,
              transactionId: null,
              paymentTransactionId: created.id,
            },
          });
        }
      }
      await tx.recurringPosting.update({ where: { id: posting.id }, data: { transactionId } });
    }
  } catch (error) {
    if (isConflict(error)) fail(ALREADY_HANDLED);
    throw error;
  }

  const next = nextAfter(toDayString(rec.startDate), rec.frequency as Frequency, dueDay);
  const ended = completed || Boolean(rec.endDate && parseDay(next) > rec.endDate);
  const { count } = await tx.recurringTransaction.updateMany({
    where: { id, nextDueDate: due },
    data: { nextDueDate: parseDay(next), ...(ended ? { active: false } : {}) },
  });
  if (count !== 1) fail(ALREADY_HANDLED);
  return {
    transactionId,
    nextDueDate: next,
    ended,
    /** An installment plan that this payment finished. */
    completed,
    amount: action === 'POST' ? amount : 0,
  };
}

/**
 * "Post now". Occurrences due today or earlier are dated on their due day; an
 * early post (paid ahead) is dated today.
 */
export async function postRecurringNow(
  id: string,
  dueDay: DayString,
  options: { today?: DayString; amount?: number } = {},
  deps?: Partial<TransactionDeps>
) {
  return runLedgerWrite(deps, 'post recurring entry', (tx) =>
    postRecurringNowIn(tx, id, dueDay, options)
  );
}

/** postRecurringNow, inside a transaction the caller already opened. */
export async function postRecurringNowIn(
  tx: Tx,
  id: string,
  dueDay: DayString,
  options: { today?: DayString; amount?: number } = {}
) {
  const today = options.today ?? todayInAppTimeZone();
  if (!isValidDay(dueDay)) fail('Invalid due date');
  return handleOccurrence(tx, id, dueDay, 'POST', dueDay <= today ? dueDay : today, {
    amount: options.amount,
  });
}

export async function skipRecurring(id: string, dueDay: DayString, deps?: Partial<TransactionDeps>) {
  return runLedgerWrite(deps, 'skip recurring entry', (tx) => skipRecurringIn(tx, id, dueDay));
}

/** skipRecurring, inside a transaction the caller already opened. */
export async function skipRecurringIn(tx: Tx, id: string, dueDay: DayString) {
  if (!isValidDay(dueDay)) fail('Invalid due date');
  return handleOccurrence(tx, id, dueDay, 'SKIP', dueDay);
}

export type DueRunResult = {
  posted: number;
  /** Entries that could not be posted (for example a deleted category). */
  errors: { id: string; name: string; error: string }[];
};

/**
 * The due check: post every auto-post occurrence due on or before `today`.
 * Manual entries are left for the user. Safe to run any number of times.
 */
export async function runDueRecurring(
  options: { today?: DayString } = {},
  deps?: Partial<TransactionDeps>
): Promise<DueRunResult> {
  const today = options.today ?? todayInAppTimeZone();
  const db = deps?.db ?? (await import('@/lib/prisma')).prisma;
  const due = await (db as unknown as { recurringTransaction: Tx['recurringTransaction'] }).recurringTransaction.findMany({
    where: { active: true, autoPost: true, nextDueDate: { lte: parseDay(today) } },
    select: { id: true, name: true },
  });

  const result: DueRunResult = { posted: 0, errors: [] };
  for (const entry of due) {
    for (let i = 0; i < MAX_CATCH_UP; i += 1) {
      const outcome = await runLedgerWrite(deps, 'post recurring entry', async (tx) => {
        const rec = await tx.recurringTransaction.findUnique({
          where: { id: entry.id },
          select: { active: true, autoPost: true, nextDueDate: true },
        });
        if (!rec || !rec.active || !rec.autoPost) return null;
        const dueDay = toDayString(rec.nextDueDate);
        if (dueDay > today) return null;
        return handleOccurrence(tx, entry.id, dueDay, 'POST', dueDay, { auto: true });
      });
      if (!outcome.success) {
        // Another run got there first: nothing to report.
        if (outcome.error !== ALREADY_HANDLED) {
          result.errors.push({ id: entry.id, name: entry.name, error: outcome.error });
        }
        break;
      }
      if (!outcome.data) break;
      result.posted += 1;
      if (outcome.data.ended) break;
    }
  }
  return result;
}

// ==================== UPCOMING ====================

export type UpcomingItem = {
  recurringId: string;
  name: string;
  kind: 'INCOME' | 'EXPENSE' | 'TRANSFER';
  amount: number;
  dueDate: DayString;
  overdue: boolean;
  /** Only the entry's next occurrence can be posted or skipped. */
  actionable: boolean;
  autoPost: boolean;
  categoryName: string | null;
  categoryColor: string | null;
  categoryIcon: string | null;
  accountName: string | null;
  /** The friend this payment pays back. */
  friendName: string | null;
  /** Installment plans: where the plan stands before this payment. */
  plan: PlanProgress | null;
  /** The entry's own reminder lead time (null = app default). */
  remindDaysBefore: number | null;
};

type UpcomingSource = Pick<
  RecurringTransaction,
  'id' | 'name' | 'kind' | 'amount' | 'frequency' | 'startDate' | 'nextDueDate' | 'endDate' | 'autoPost'
> & {
  totalAmount?: number | null;
  remindDaysBefore?: number | null;
  category?: { name: string; color: string; icon: string | null } | null;
  account?: { name: string } | null;
  friend?: { name: string } | null;
};

/**
 * Occurrences from each entry's next due day through `today + days`. `paid`
 * (paidByRecurring) is needed for installment plans: they stop when the total
 * is reached and their last payment is the remainder.
 */
export function buildUpcoming(
  entries: UpcomingSource[],
  today: DayString,
  days = UPCOMING_DAYS,
  paid: Map<string, number> = new Map()
): UpcomingItem[] {
  const horizon = addDays(today, days);
  const items: UpcomingItem[] = [];
  for (const e of entries) {
    const next = toDayString(e.nextDueDate);
    if (next > horizon) continue;
    const end = e.endDate ? toDayString(e.endDate) : null;
    const plan =
      e.totalAmount != null ? planProgress(e.totalAmount, paid.get(e.id) ?? 0, e.amount) : null;
    if (plan && plan.paymentsLeft === 0) continue;
    const dates = occurrencesBetween(
      toDayString(e.startDate),
      e.frequency as Frequency,
      next,
      horizon,
      end,
      Math.min(10, plan?.paymentsLeft ?? 10)
    );
    dates.forEach((dueDate, i) => {
      // Later payments of a plan assume the ones before them were made in full.
      const planAt = plan
        ? planProgress(plan.total, plan.paid + e.amount * i, e.amount)
        : null;
      items.push({
        recurringId: e.id,
        name: e.name,
        kind: e.kind,
        amount: planAt ? planAt.nextAmount : e.amount,
        dueDate,
        overdue: dueDate < today,
        actionable: i === 0,
        autoPost: e.autoPost,
        categoryName: e.category?.name ?? null,
        categoryColor: e.category?.color ?? null,
        categoryIcon: e.category?.icon ?? null,
        accountName: e.account?.name ?? null,
        friendName: e.friend?.name ?? null,
        plan: planAt,
        remindDaysBefore: e.remindDaysBefore ?? null,
      });
    });
  }
  return items.sort((a, b) =>
    a.dueDate !== b.dueDate ? (a.dueDate < b.dueDate ? -1 : 1) : a.name.localeCompare(b.name)
  );
}
