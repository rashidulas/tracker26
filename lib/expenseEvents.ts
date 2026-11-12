/**
 * Tiny in-page event bus so a save in the global quick-add can update any list
 * that is currently on screen (e.g. /expenses) without reloading the page.
 */

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
