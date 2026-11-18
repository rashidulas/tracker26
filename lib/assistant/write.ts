/**
 * Write tools for the chat assistant. They propose; the user commits.
 *
 * 1. The model calls createExpense / createIncome. Before anything is shown
 *    to the user, checkProposal looks the ids up and either describes the
 *    proposal (the approval card's text) or explains what is wrong so the
 *    model can fix it.
 * 2. The user approves or denies the proposal in the UI (AI SDK tool approval).
 * 3. Only after approval does the SDK run the tool, which calls saveProposal.
 *    It saves through lib/transactions.ts with the tool call id as the
 *    idempotency key, so a retried request or a double tap returns the first
 *    save instead of creating a second transaction.
 */
import type { PrismaClient } from '@prisma/client';
import { isValidDay } from '@/lib/dates';
import { createTransactionOnce, type TransactionDeps } from '@/lib/transactions';
import { formatCurrency } from '@/lib/utils';

export type ProposalKind = 'EXPENSE' | 'INCOME';

export type Proposal = {
  amount: number;
  date: string;
  categoryId: string;
  subcategoryId?: string | null;
  accountId: string;
  merchant?: string | null;
  notes?: string | null;
  tags?: string[] | null;
};

export type ProposalDb = Pick<PrismaClient, 'category' | 'subcategory' | 'account'>;

export type ProposalCheck =
  | {
      ok: true;
      /** One line for the approval card, e.g. "Expense $20.00 at Costco · Groceries · from Discover · 2026-11-17". */
      summary: string;
    }
  | { ok: false; problem: string };

const OBJECT_ID = /^[a-f\d]{24}$/i;

export async function checkProposal(
  db: ProposalDb,
  kind: ProposalKind,
  p: Proposal
): Promise<ProposalCheck> {
  const noun = kind === 'EXPENSE' ? 'expense' : 'income';
  if (!(p.amount > 0) || !Number.isFinite(p.amount)) {
    return { ok: false, problem: 'amount must be a positive number' };
  }
  if (Math.abs(p.amount * 100 - Math.round(p.amount * 100)) > 1e-6) {
    return { ok: false, problem: 'amount can have at most 2 decimal places' };
  }
  if (!isValidDay(p.date)) {
    return { ok: false, problem: `date "${p.date}" is not a real calendar day in YYYY-MM-DD form` };
  }
  if (!OBJECT_ID.test(p.categoryId)) {
    return { ok: false, problem: `categoryId "${p.categoryId}" is not an id from the category list` };
  }
  if (!OBJECT_ID.test(p.accountId)) {
    return { ok: false, problem: `accountId "${p.accountId}" is not an id from the account list` };
  }

  const [category, account] = await Promise.all([
    db.category.findUnique({ where: { id: p.categoryId }, select: { name: true, type: true } }),
    db.account.findUnique({ where: { id: p.accountId }, select: { name: true } }),
  ]);
  if (!category) {
    return { ok: false, problem: `categoryId "${p.categoryId}" does not exist; pick one from the category list` };
  }
  if (category.type !== kind) {
    return {
      ok: false,
      problem: `"${category.name}" is ${category.type === 'INCOME' ? 'an income' : 'an expense'} category; an ${noun} needs ${kind === 'INCOME' ? 'an income' : 'an expense'} category`,
    };
  }
  if (!account) {
    return { ok: false, problem: `accountId "${p.accountId}" does not exist; pick one from the account list` };
  }

  let subName: string | null = null;
  if (p.subcategoryId) {
    const sub = OBJECT_ID.test(p.subcategoryId)
      ? await db.subcategory.findFirst({
          where: { id: p.subcategoryId, categoryId: p.categoryId },
          select: { name: true },
        })
      : null;
    if (!sub) {
      return { ok: false, problem: `subcategoryId "${p.subcategoryId}" is not a subcategory of "${category.name}"; omit it or pick a valid one` };
    }
    subName = sub.name;
  }

  const merchant = p.merchant?.trim();
  const parts = [
    `${kind === 'EXPENSE' ? 'Expense' : 'Income'} ${formatCurrency(p.amount)}${
      merchant ? ` ${kind === 'EXPENSE' ? 'at' : 'from'} ${merchant}` : ''
    }`,
    subName ? `${category.name} › ${subName}` : category.name,
    `${kind === 'EXPENSE' ? 'from' : 'into'} ${account.name}`,
    p.date,
  ];
  return { ok: true, summary: parts.join(' · ') };
}

export type SaveResult = {
  status: 'saved';
  transactionId: string;
  /** True when this tool call had already been saved; nothing new was written. */
  alreadySaved: boolean;
  summary: string;
};

/** Thrown when an approved proposal could not be saved. The message is readable. */
export class SaveError extends Error {}

export async function saveProposal(
  kind: ProposalKind,
  p: Proposal,
  toolCallId: string,
  deps: { db: ProposalDb; tx?: Partial<TransactionDeps> }
): Promise<SaveResult> {
  const check = await checkProposal(deps.db, kind, p);
  if (!check.ok) throw new SaveError(`Not saved: ${check.problem}.`);

  const result = await createTransactionOnce(
    `assistant:${toolCallId}`,
    {
      kind,
      date: p.date,
      amount: p.amount,
      categoryId: p.categoryId,
      subcategoryId: p.subcategoryId ?? null,
      accountId: p.accountId,
      merchantOrSource: p.merchant ?? null,
      notes: p.notes ?? null,
      tags: p.tags ?? [],
    },
    deps.tx
  );
  if (!result.success) throw new SaveError(`Not saved: ${result.error}.`);

  return {
    status: 'saved',
    transactionId: result.data.transaction.id,
    alreadySaved: result.data.replayed,
    summary: check.summary,
  };
}
