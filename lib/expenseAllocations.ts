/**
 * How an expense's amount is spread over categories. A split expense has no
 * categoryId of its own; its split items carry the categories.
 *
 * Kept free of server imports so client components can use it too.
 */
export function expenseCategoryAllocations(t: {
  amount: number;
  categoryId: string | null;
  splitItems?: { categoryId: string; amount: number }[] | null;
}): { categoryId: string; amount: number }[] {
  const items = (t.splitItems || []).filter((s) => s.categoryId);
  if (items.length > 0) return items.map((s) => ({ categoryId: s.categoryId, amount: s.amount }));
  return t.categoryId ? [{ categoryId: t.categoryId, amount: t.amount }] : [];
}
