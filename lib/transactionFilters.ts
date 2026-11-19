/**
 * Structured transaction filters: the parameters of the assistant's
 * searchTransactions tool (lib/assistant/read.ts uses this type), also used
 * by the transaction lists for natural-language search.
 *
 * The lists already hold their rows in the browser, so matchesFilters applies
 * the same filters there with the same meaning as the tool's database query.
 *
 * Pure and safe for client code.
 */
import { toDayString, type DayString } from '@/lib/dates';
import { formatCurrency } from '@/lib/utils';

export type SearchFilters = {
  kind?: 'EXPENSE' | 'INCOME' | 'TRANSFER';
  /** First day, inclusive. */
  start?: DayString;
  /** Last day, inclusive. */
  end?: DayString;
  categoryIds?: string[];
  accountIds?: string[];
  /** Case-insensitive substring of the merchant / source. */
  merchant?: string;
  /** Case-insensitive text found in the merchant, notes or category name, or an exact tag. */
  text?: string;
  minAmount?: number;
  maxAmount?: number;
};

export type FilterableRow = {
  date: Date | string;
  amount: number;
  kind?: string;
  categoryId?: string | null;
  accountId?: string | null;
  toAccountId?: string | null;
  merchantOrSource?: string | null;
  notes?: string | null;
  tags?: string[] | null;
  splitItems?: { categoryId: string }[] | null;
  accountSplits?: { accountId: string }[] | null;
  category?: { name: string } | null;
};

export function hasFilters(f: SearchFilters): boolean {
  return Boolean(
    f.start ||
      f.end ||
      f.categoryIds?.length ||
      f.accountIds?.length ||
      f.merchant?.trim() ||
      f.text?.trim() ||
      f.minAmount !== undefined ||
      f.maxAmount !== undefined
  );
}

export function matchesFilters(row: FilterableRow, f: SearchFilters): boolean {
  if (f.kind && row.kind && row.kind !== f.kind) return false;
  const day = toDayString(row.date);
  if (f.start && day < f.start) return false;
  if (f.end && day > f.end) return false;
  if (f.minAmount !== undefined && row.amount < f.minAmount) return false;
  if (f.maxAmount !== undefined && row.amount > f.maxAmount) return false;
  if (f.categoryIds?.length) {
    const ids = [row.categoryId, ...(row.splitItems ?? []).map((s) => s.categoryId)];
    if (!ids.some((id) => id && f.categoryIds!.includes(id))) return false;
  }
  if (f.accountIds?.length) {
    const ids = [row.accountId, row.toAccountId, ...(row.accountSplits ?? []).map((s) => s.accountId)];
    if (!ids.some((id) => id && f.accountIds!.includes(id))) return false;
  }
  const merchant = f.merchant?.trim().toLowerCase();
  if (merchant && !(row.merchantOrSource ?? '').toLowerCase().includes(merchant)) return false;
  const text = f.text?.trim().toLowerCase();
  if (text) {
    const hit =
      (row.merchantOrSource ?? '').toLowerCase().includes(text) ||
      (row.notes ?? '').toLowerCase().includes(text) ||
      (row.category?.name ?? '').toLowerCase().includes(text) ||
      (row.tags ?? []).some((tag) => tag.toLowerCase() === text);
    if (!hit) return false;
  }
  return true;
}

// ==================== CHIPS ====================

export type FilterChip = {
  /** What removing this chip clears. */
  key: 'period' | 'minAmount' | 'maxAmount' | 'amount' | 'merchant' | 'text' | `category:${string}` | `account:${string}`;
  label: string;
};

export function filterChips(
  f: SearchFilters,
  names: { categories: { id: string; name: string }[]; accounts: { id: string; name: string }[] },
  periodLabel?: string | null
): FilterChip[] {
  const chips: FilterChip[] = [];
  if (f.start || f.end) {
    chips.push({
      key: 'period',
      label: periodLabel || (f.start && f.end ? `${f.start} – ${f.end}` : f.start ? `From ${f.start}` : `Until ${f.end}`),
    });
  }
  if (f.minAmount !== undefined && f.maxAmount !== undefined) {
    chips.push({
      key: 'amount',
      label:
        f.minAmount === f.maxAmount
          ? `Exactly ${formatCurrency(f.minAmount)}`
          : `${formatCurrency(f.minAmount)} – ${formatCurrency(f.maxAmount)}`,
    });
  } else if (f.minAmount !== undefined) {
    // Amounts have two decimals, so "$5.01 or more" is the same as "over $5.00".
    const cents = Math.round(f.minAmount * 100);
    chips.push({
      key: 'minAmount',
      label: cents % 100 === 1 ? `Over ${formatCurrency((cents - 1) / 100)}` : `${formatCurrency(f.minAmount)} or more`,
    });
  } else if (f.maxAmount !== undefined) {
    const cents = Math.round(f.maxAmount * 100);
    chips.push({
      key: 'maxAmount',
      label: cents % 100 === 99 ? `Under ${formatCurrency((cents + 1) / 100)}` : `${formatCurrency(f.maxAmount)} or less`,
    });
  }
  for (const id of f.categoryIds ?? []) {
    const name = names.categories.find((c) => c.id === id)?.name;
    if (name) chips.push({ key: `category:${id}`, label: name });
  }
  for (const id of f.accountIds ?? []) {
    const name = names.accounts.find((a) => a.id === id)?.name;
    if (name) chips.push({ key: `account:${id}`, label: name });
  }
  if (f.merchant?.trim()) chips.push({ key: 'merchant', label: `Merchant: ${f.merchant.trim()}` });
  if (f.text?.trim()) chips.push({ key: 'text', label: `“${f.text.trim()}”` });
  return chips;
}

export function removeChip(f: SearchFilters, key: FilterChip['key']): SearchFilters {
  const next: SearchFilters = { ...f };
  if (key === 'period') {
    delete next.start;
    delete next.end;
  } else if (key === 'amount') {
    delete next.minAmount;
    delete next.maxAmount;
  } else if (key === 'minAmount' || key === 'maxAmount' || key === 'merchant' || key === 'text') {
    delete next[key];
  } else if (key.startsWith('category:')) {
    next.categoryIds = (f.categoryIds ?? []).filter((id) => id !== key.slice('category:'.length));
  } else if (key.startsWith('account:')) {
    next.accountIds = (f.accountIds ?? []).filter((id) => id !== key.slice('account:'.length));
  }
  return next;
}
