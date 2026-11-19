/**
 * Write tools for the chat assistant. They propose; the user commits.
 *
 * 1. The model calls createExpense / createIncome. Before anything is shown
 *    to the user, checkProposal looks the ids up and either describes the
 *    proposal (the approval card's text) or explains what is wrong so the
 *    model can fix it.
 * 2. The user approves or denies the proposal in the UI (AI SDK tool approval).
 *    Before approving, the user may change the amount, date, category,
 *    account or merchant on the card. Those changes arrive beside the
 *    approval as a ProposalEdit; the signed proposal itself is never altered.
 * 3. Only after approval does the SDK run the tool, which calls saveProposal.
 *    It applies the user's edit, checks the result against the database
 *    again, and saves through lib/transactions.ts with the tool call id as
 *    the idempotency key, so a retried request or a double tap returns the
 *    first save instead of creating a second transaction.
 */
import type { PrismaClient } from '@prisma/client';
import { isValidDay, toDayString } from '@/lib/dates';
import { cleanMerchantName, normalizeMerchantName } from '@/lib/merchants';
import { createTransactionOnce, type TransactionDeps } from '@/lib/transactions';
import { formatCurrency } from '@/lib/utils';
import type { Effect } from '@/lib/assistant/effects';
import type { FieldEdits } from '@/lib/assistant/preview';

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

/**
 * What the user changed on the approval card. Only these fields can be
 * edited; a missing field keeps the proposed value.
 */
export type ProposalEdit = {
  amount?: number;
  date?: string;
  categoryId?: string;
  subcategoryId?: string | null;
  accountId?: string;
  merchant?: string | null;
  /**
   * Changes to a card of one of the other write tools (lib/assistant/actions.ts),
   * by field key. Not used by createExpense / createIncome.
   */
  fields?: FieldEdits;
};

/** The proposal with the user's changes applied. */
export function applyProposalEdit(p: Proposal, edit: ProposalEdit): Proposal {
  const next: Proposal = { ...p };
  if (edit.amount !== undefined) next.amount = edit.amount;
  if (edit.date !== undefined) next.date = edit.date;
  if (edit.accountId !== undefined) next.accountId = edit.accountId;
  if (edit.merchant !== undefined) next.merchant = edit.merchant;
  if (edit.categoryId !== undefined && edit.categoryId !== p.categoryId) {
    next.categoryId = edit.categoryId;
    // A subcategory belongs to one category; it does not survive a change.
    next.subcategoryId = null;
  }
  if (edit.subcategoryId !== undefined) next.subcategoryId = edit.subcategoryId;
  return next;
}

/** The checked proposal in words, for the approval card and its saved state. */
export type ProposalDetails = {
  amount: number;
  date: string;
  category: string;
  subcategory: string | null;
  account: string;
  merchant: string | null;
};

export type ProposalDb = Pick<PrismaClient, 'category' | 'subcategory' | 'account' | 'merchant'>;

export type ProposalCheck =
  | {
      ok: true;
      /** One line for the approval card, e.g. "Expense $20.00 at Costco · Groceries · from Discover · 2026-11-17". */
      summary: string;
      /** The merchant as the user first saved it ("costco " → "Costco"), or the cleaned text if new. */
      merchant: string | null;
      details: ProposalDetails;
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

  // Known merchants keep the spelling the user saved (lib/merchants.ts).
  const key = normalizeMerchantName(p.merchant);
  const known = key
    ? await db.merchant.findUnique({ where: { normalizedName: key }, select: { name: true } })
    : null;
  const merchant = known?.name ?? cleanMerchantName(p.merchant);
  const parts = [
    `${kind === 'EXPENSE' ? 'Expense' : 'Income'} ${formatCurrency(p.amount)}${
      merchant ? ` ${kind === 'EXPENSE' ? 'at' : 'from'} ${merchant}` : ''
    }`,
    subName ? `${category.name} › ${subName}` : category.name,
    `${kind === 'EXPENSE' ? 'from' : 'into'} ${account.name}`,
    p.date,
  ];
  return {
    ok: true,
    summary: parts.join(' · '),
    merchant,
    details: {
      amount: p.amount,
      date: p.date,
      category: category.name,
      subcategory: subName,
      account: account.name,
      merchant,
    },
  };
}

export type SaveResult = {
  status: 'saved';
  transactionId: string;
  /** True when this tool call had already been saved; nothing new was written. */
  alreadySaved: boolean;
  /** What was saved, in one line. */
  summary: string;
  /** What was saved, field by field. */
  details: ProposalDetails;
  /** Present when the user changed the proposal on the card before approving. */
  editedByUser?: true;
  /** Where the budget this touched stands now (lib/assistant/effects.ts). */
  effects?: Effect[];
};

/** Thrown when an approved proposal could not be saved. The message is readable. */
export class SaveError extends Error {}

export async function saveProposal(
  kind: ProposalKind,
  proposed: Proposal,
  toolCallId: string,
  deps: { db: ProposalDb; tx?: Partial<TransactionDeps>; edit?: ProposalEdit }
): Promise<SaveResult> {
  // The user's changes are checked exactly like the model's proposal was.
  const p = deps.edit ? applyProposalEdit(proposed, deps.edit) : proposed;
  const check = await checkProposal(deps.db, kind, p);
  if (!check.ok) {
    throw new SaveError(
      deps.edit
        ? `Not saved: the user changed this proposal before approving, and the changed version is not valid (${check.problem}). Tell the user and offer to propose it again.`
        : `Not saved: ${check.problem}.`
    );
  }

  const result = await createTransactionOnce(
    `assistant:${toolCallId}`,
    {
      kind,
      date: p.date,
      amount: p.amount,
      categoryId: p.categoryId,
      subcategoryId: p.subcategoryId ?? null,
      accountId: p.accountId,
      merchantOrSource: check.merchant,
      notes: p.notes ?? null,
      tags: p.tags ?? [],
    },
    deps.tx
  );
  if (!result.success) throw new SaveError(`Not saved: ${result.error}.`);

  const { transaction, replayed } = result.data;
  // A replay returns the first save, which is what gets described, whatever
  // this call asked for.
  let saved: { summary: string; details: ProposalDetails } = check;
  if (replayed && transaction.categoryId && transaction.accountId) {
    const first = await checkProposal(deps.db, kind, {
      amount: transaction.amount,
      date: toDayString(transaction.date),
      categoryId: transaction.categoryId,
      subcategoryId: transaction.subcategoryId,
      accountId: transaction.accountId,
      merchant: transaction.merchantOrSource,
    });
    if (first.ok) saved = first;
  }

  return {
    status: 'saved',
    transactionId: transaction.id,
    alreadySaved: replayed,
    summary: saved.summary,
    details: saved.details,
    ...(deps.edit && !replayed ? { editedByUser: true as const } : {}),
  };
}
