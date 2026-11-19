/**
 * Duplicate warning: before a transaction is saved, is there already one of
 * the same kind on the same account, for a similar amount, within two days?
 *
 * Plain code, no model. The forms show the match ("Looks like a duplicate
 * of ...") and let the user save anyway; a failed or slow check never blocks
 * a save.
 */
import type { PrismaClient, TransactionKind } from '@prisma/client';
import { addDays, dayFilter, isValidDay, parseDay, toDayString, type DayString } from '@/lib/dates';
import { normalizeMerchantName } from '@/lib/merchants';

export const DUPLICATE_WINDOW_DAYS = 2;
/** Amounts this close count as similar: 5%, and never less than one cent. */
export const DUPLICATE_AMOUNT_TOLERANCE = 0.05;

export type DuplicateProbe = {
  kind: TransactionKind;
  accountId: string;
  /** Transfers only: the same destination is required too. */
  toAccountId?: string | null;
  amount: number;
  date: DayString;
  merchant?: string | null;
  /** The row being edited, which is not a duplicate of itself. */
  excludeId?: string | null;
};

export type DuplicateCandidate = {
  id: string;
  kind: TransactionKind;
  date: DayString;
  amount: number;
  accountId: string | null;
  toAccountId?: string | null;
  accountSplits?: { accountId: string }[] | null;
  merchant: string | null;
};

const cents = (n: number) => Math.round(n * 100);

export function isSimilarAmount(a: number, b: number): boolean {
  if (!(a > 0) || !(b > 0)) return false;
  const tolerance = Math.max(1, Math.round(Math.max(cents(a), cents(b)) * DUPLICATE_AMOUNT_TOLERANCE));
  return Math.abs(cents(a) - cents(b)) <= tolerance;
}

function daysApart(a: DayString, b: DayString) {
  return Math.abs(Math.round((parseDay(a).getTime() - parseDay(b).getTime()) / 86_400_000));
}

function isDuplicate(probe: DuplicateProbe, c: DuplicateCandidate): boolean {
  if (c.id === probe.excludeId || c.kind !== probe.kind) return false;
  const onAccount =
    c.accountId === probe.accountId || (c.accountSplits ?? []).some((s) => s.accountId === probe.accountId);
  if (!onAccount) return false;
  if (probe.kind === 'TRANSFER' && probe.toAccountId && c.toAccountId !== probe.toAccountId) return false;
  if (daysApart(probe.date, c.date) > DUPLICATE_WINDOW_DAYS) return false;
  if (!isSimilarAmount(probe.amount, c.amount)) return false;
  // Two different named merchants are two purchases, however alike the amounts.
  const a = normalizeMerchantName(probe.merchant);
  const b = normalizeMerchantName(c.merchant);
  if (probe.kind !== 'TRANSFER' && a && b && a !== b) return false;
  return true;
}

/** The closest duplicate among `candidates`: nearest amount, then nearest day. */
export function pickDuplicate<C extends DuplicateCandidate>(probe: DuplicateProbe, candidates: C[]): C | null {
  if (!isValidDay(probe.date) || !(probe.amount > 0) || !probe.accountId) return null;
  const hits = candidates.filter((c) => isDuplicate(probe, c));
  hits.sort(
    (x, y) =>
      Math.abs(cents(x.amount) - cents(probe.amount)) - Math.abs(cents(y.amount) - cents(probe.amount)) ||
      daysApart(probe.date, x.date) - daysApart(probe.date, y.date)
  );
  return hits[0] ?? null;
}

export type DuplicateMatch = {
  id: string;
  kind: TransactionKind;
  date: DayString;
  amount: number;
  merchant: string | null;
  category: string | null;
  account: string | null;
};

export type DuplicateDb = Pick<PrismaClient, 'transaction' | 'category' | 'account'>;

export async function findDuplicate(db: DuplicateDb, probe: DuplicateProbe): Promise<DuplicateMatch | null> {
  if (!isValidDay(probe.date) || !(probe.amount > 0) || !probe.accountId) return null;
  const rows = await db.transaction.findMany({
    where: {
      kind: probe.kind,
      date: dayFilter(addDays(probe.date, -DUPLICATE_WINDOW_DAYS), addDays(probe.date, DUPLICATE_WINDOW_DAYS)),
      OR: [{ accountId: probe.accountId }, { accountSplits: { some: { accountId: probe.accountId } } }],
    },
    select: {
      id: true,
      kind: true,
      date: true,
      amount: true,
      accountId: true,
      toAccountId: true,
      accountSplits: true,
      merchantOrSource: true,
      categoryId: true,
    },
    orderBy: { date: 'desc' },
    take: 200,
  });
  const hit = pickDuplicate(
    probe,
    rows.map((r) => ({ ...r, date: toDayString(r.date), merchant: r.merchantOrSource }))
  );
  if (!hit) return null;
  const [category, account] = await Promise.all([
    hit.categoryId ? db.category.findUnique({ where: { id: hit.categoryId }, select: { name: true } }) : null,
    hit.accountId ? db.account.findUnique({ where: { id: hit.accountId }, select: { name: true } }) : null,
  ]);
  return {
    id: hit.id,
    kind: hit.kind,
    date: hit.date,
    amount: hit.amount,
    merchant: hit.merchant,
    category: category?.name ?? null,
    account: account?.name ?? null,
  };
}
