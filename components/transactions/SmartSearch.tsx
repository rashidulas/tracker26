'use client';

/**
 * Natural-language search for the transaction lists.
 *
 * Typing in the search box still filters instantly by plain text. Pressing
 * Enter (or the sparkle button) asks the server to read the query as filters
 * ("coffee over $5 last month"); what comes back is shown as removable chips
 * and applied to the rows already on the page. If the query has nothing
 * structured in it, or the server is slow or unavailable, nothing changes and
 * the plain text search stays as it was.
 */
import { useCallback, useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { smartSearch } from '@/app/assist/actions';
import {
  filterChips,
  hasFilters,
  removeChip,
  type FilterChip,
  type SearchFilters,
} from '@/lib/transactionFilters';

const SEARCH_TIMEOUT_MS = 8000;

export function useSmartSearch(kind: 'EXPENSE' | 'INCOME' | 'TRANSFER') {
  const [filters, setFilters] = useState<SearchFilters>({});
  const [periodLabel, setPeriodLabel] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  /** Returns the filters that were applied, or null when the query stays plain text. */
  const run = useCallback(
    async (text: string): Promise<SearchFilters | null> => {
      const query = text.trim();
      if (!query) return null;
      setPending(true);
      try {
        const result = await Promise.race([
          smartSearch(query, kind),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), SEARCH_TIMEOUT_MS)),
        ]);
        if (!result || result.via === 'none' || !hasFilters(result.filters)) return null;
        setFilters(result.filters);
        setPeriodLabel(result.periodLabel);
        return result.filters;
      } catch {
        return null;
      } finally {
        setPending(false);
      }
    },
    [kind]
  );

  const remove = useCallback((key: FilterChip['key']) => {
    setFilters((current) => removeChip(current, key));
    if (key === 'period') setPeriodLabel(null);
  }, []);

  const clear = useCallback(() => {
    setFilters({});
    setPeriodLabel(null);
  }, []);

  return { filters, periodLabel, pending, active: hasFilters(filters), run, remove, clear };
}

export type SmartSearchState = ReturnType<typeof useSmartSearch>;

export function SmartFilterChips({
  smart,
  categories,
  accounts,
}: {
  smart: SmartSearchState;
  categories: { id: string; name: string }[];
  accounts: { id: string; name: string }[];
}) {
  if (!smart.active) return null;
  const chips = filterChips(smart.filters, { categories, accounts }, smart.periodLabel);
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label="Filters from your search">
      <Sparkles size={14} className="shrink-0 text-mint" aria-hidden="true" />
      {chips.map((chip) => (
        <span
          key={chip.key}
          className="inline-flex max-w-full items-center gap-1 rounded-full border border-mint/30 bg-mint-dim py-1 pl-3 pr-1 text-sm text-mint"
        >
          <span className="truncate">{chip.label}</span>
          <button
            type="button"
            onClick={() => smart.remove(chip.key)}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full hover:bg-mint/20"
            aria-label={`Remove filter ${chip.label}`}
          >
            <X size={13} aria-hidden="true" />
          </button>
        </span>
      ))}
      <button type="button" onClick={smart.clear} className="px-1 text-sm text-ink-muted hover:text-ink hover:underline">
        Clear
      </button>
    </div>
  );
}
