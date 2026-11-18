/**
 * Read helpers for how much of an expense is "your spending".
 *
 * Kept free of server imports so client components can use it too.
 */

/**
 * Your part of an expense: the full amount minus what friends owe you for it
 * (Transaction.sharedAmount). Budgets, category totals and "spent" figures use
 * this; account balances use the full amount, because that left the account.
 */
export function myShareOfExpense(t: { amount: number; sharedAmount?: number | null }): number {
  const shared = t.sharedAmount ?? 0;
  return shared > 0 ? Math.max(0, t.amount - shared) : t.amount;
}

/** Sums your share over expenses (see myShareOfExpense). */
export function sumMyShare(rows: { amount: number; sharedAmount?: number | null }[]): number {
  return rows.reduce((sum, t) => sum + myShareOfExpense(t), 0);
}

/**
 * How your share of an expense is spread over categories. A category-split
 * expense has no categoryId of its own; its split items carry the categories.
 * When friends owe part of it, every category is scaled down by the same ratio.
 */
export function expenseCategoryAllocations(t: {
  amount: number;
  categoryId: string | null;
  splitItems?: { categoryId: string; amount: number }[] | null;
  sharedAmount?: number | null;
}): { categoryId: string; amount: number }[] {
  const mine = myShareOfExpense(t);
  const ratio = t.amount > 0 ? mine / t.amount : 1;
  const items = (t.splitItems || []).filter((s) => s.categoryId);
  if (items.length > 0) {
    return items.map((s) => ({ categoryId: s.categoryId, amount: s.amount * ratio }));
  }
  return t.categoryId ? [{ categoryId: t.categoryId, amount: mine }] : [];
}
