'use client';

import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { format } from 'date-fns';

export interface TransactionFilterState {
  month: string; // 'YYYY-MM' or 'all'
  startDate: string;
  endDate: string;
  categoryId: string;
  subcategoryId: string;
  search: string;
}

export interface FilterableItem {
  date: Date | string;
  categoryId?: string | null;
  subcategoryId?: string | null;
  searchText: string;
}

export function monthKeyUTC(date: Date | string) {
  const d = new Date(date);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

const EMPTY_ADVANCED = {
  startDate: '',
  endDate: '',
  categoryId: '',
  subcategoryId: '',
  search: '',
};

/**
 * Filter state shared by every Transactions tab. Initial values come from the URL
 * (?month=, ?from=, ?to=, ?category=, ?subcategory=, ?q=) so Insights can deep-link
 * into a pre-filtered list. A date range or category in the URL implies "all months".
 */
export function useTransactionFilters<T extends FilterableItem>(items: T[]) {
  const searchParams = useSearchParams();

  const [filters, setFilters] = useState<TransactionFilterState>(() => {
    const from = searchParams.get('from') || '';
    const to = searchParams.get('to') || '';
    const categoryId = searchParams.get('category') || '';
    const explicitMonth = searchParams.get('month');
    return {
      month: explicitMonth || (from || to || categoryId ? 'all' : currentMonthKey()),
      startDate: from,
      endDate: to,
      categoryId,
      subcategoryId: searchParams.get('subcategory') || '',
      search: searchParams.get('q') || '',
    };
  });

  const monthOptions = useMemo(() => {
    const months = new Map<string, string>();
    months.set(currentMonthKey(), format(new Date(), 'MMMM yyyy'));
    for (const item of items) {
      const d = new Date(item.date);
      months.set(
        monthKeyUTC(d),
        format(new Date(d.getUTCFullYear(), d.getUTCMonth(), 1), 'MMMM yyyy')
      );
    }
    const keys = Array.from(months.keys()).sort((a, b) => b.localeCompare(a));
    return [
      { value: 'all', label: 'All months' },
      ...keys.map((key) => ({ value: key, label: months.get(key)! })),
    ];
  }, [items]);

  const filtered = useMemo(() => {
    const start = filters.startDate ? new Date(filters.startDate) : null;
    const end = filters.endDate ? new Date(`${filters.endDate}T23:59:59.999Z`) : null;
    const search = filters.search.trim().toLowerCase();
    return items.filter((item) => {
      const d = new Date(item.date);
      if (filters.month !== 'all' && monthKeyUTC(d) !== filters.month) return false;
      if (start && d < start) return false;
      if (end && d > end) return false;
      if (filters.categoryId && item.categoryId !== filters.categoryId) return false;
      if (filters.subcategoryId && item.subcategoryId !== filters.subcategoryId) return false;
      if (search && !item.searchText.toLowerCase().includes(search)) return false;
      return true;
    });
  }, [items, filters]);

  const activeFilterCount = [
    filters.startDate,
    filters.endDate,
    filters.categoryId,
    filters.subcategoryId,
    filters.search,
  ].filter(Boolean).length;

  const setFilter = <K extends keyof TransactionFilterState>(
    key: K,
    value: TransactionFilterState[K]
  ) =>
    setFilters((prev) => ({
      ...prev,
      [key]: value,
      ...(key === 'categoryId' ? { subcategoryId: '' } : {}),
    }));

  return {
    filters,
    setFilter,
    clearFilters: () => setFilters((prev) => ({ ...prev, ...EMPTY_ADVANCED })),
    monthOptions,
    filtered,
    activeFilterCount,
  };
}
