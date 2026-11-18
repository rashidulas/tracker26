/**
 * Tiny in-page event bus so a save in the global quick-add can update any list
 * that is currently on screen (e.g. /expenses) without reloading the page.
 */

/** A friend's share of a split expense (one IOU entry). */
export type ExpenseFriendShare = {
  id: string;
  amount: number;
  friend: { id: string; name: string; color: string };
};

export type ExpenseRow = {
  id: string;
  date: Date;
  amount: number;
  kind: string;
  categoryId: string | null;
  subcategoryId?: string | null;
  accountId: string | null;
  toAccountId?: string | null;
  merchantOrSource: string | null;
  notes: string | null;
  tags: string[];
  category: { id: string; name: string; icon: string | null } | null;
  subcategory?: { id: string; name: string } | null;
  account: { id: string; name: string } | null;
  toAccount: { id: string; name: string } | null;
  /** What friends owe you for this expense; your share is amount - sharedAmount. */
  sharedAmount?: number | null;
  friendEntries?: ExpenseFriendShare[];
};

export type ExpenseEvent =
  | { type: 'upserted'; row: ExpenseRow }
  | { type: 'removed'; id: string };

const EVENT_NAME = 'tracker26:expense';

export function emitExpenseEvent(detail: ExpenseEvent) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<ExpenseEvent>(EVENT_NAME, { detail }));
}

export function onExpenseEvent(listener: (event: ExpenseEvent) => void) {
  const handler = (e: Event) => listener((e as CustomEvent<ExpenseEvent>).detail);
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
