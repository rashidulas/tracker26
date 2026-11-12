'use client';

// Building blocks shared by the expenses, income and transfers lists:
// sticky search toolbar, day-group headers, scroll pagination, row actions,
// selection and the bulk action bar.

import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Search,
  X,
  Copy,
  Pencil,
  Trash2,
  MoreVertical,
  CheckSquare,
  Loader2,
} from 'lucide-react';
import { cn, formatCurrency } from '@/lib/utils';
import { sliceGroups, type DayGroup } from '@/lib/transactionList';

// ==================== HOOKS ====================

export function useDebouncedValue<T>(value: T, delay = 200): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

/**
 * Month filter kept in client state and mirrored into `?month=` with
 * history.replaceState, so switching months never triggers a server render.
 */
export function useMonthParam(initial: string) {
  const [month, setMonthState] = useState(initial);
  const setMonth = useCallback((value: string) => {
    setMonthState(value);
    const url = new URL(window.location.href);
    url.searchParams.set('month', value);
    window.history.replaceState(window.history.state, '', url);
  }, []);
  return [month, setMonth] as const;
}

/** Renders `pageSize` more items each time the sentinel scrolls into view. */
export function useScrollPagination(total: number, resetKey: string, pageSize = 40) {
  const [limit, setLimit] = useState(pageSize);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setLimit(pageSize);
  }, [resetKey, pageSize]);

  const hasMore = limit < total;

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setLimit((l) => l + pageSize);
        }
      },
      { rootMargin: '600px 0px' }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, pageSize, limit]);

  return { limit, hasMore, sentinelRef, loadMore: () => setLimit((l) => l + pageSize) };
}

/** Selection of row ids, pruned automatically when rows disappear. */
export function useSelection(allIds: string[]) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selecting, setSelecting] = useState(false);

  const idKey = allIds.join('|');
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const present = new Set(allIds);
      const next = new Set(Array.from(prev).filter((id) => present.has(id)));
      return next.size === prev.size ? prev : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idKey]);

  const toggle = useCallback((id: string) => {
    setSelecting(true);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const setMany = useCallback((ids: string[], on: boolean) => {
    setSelecting(true);
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setSelected(new Set());
    setSelecting(false);
  }, []);

  return {
    selected,
    selecting,
    setSelecting: (on: boolean) => (on ? setSelecting(true) : clear()),
    toggle,
    setMany,
    clear,
  };
}

// ==================== TOOLBAR ====================

export function ListToolbar({
  query,
  onQueryChange,
  placeholder,
  month,
  monthOptions,
  onMonthChange,
  selecting,
  onToggleSelecting,
  children,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  placeholder: string;
  month: string;
  monthOptions: Array<{ value: string; label: string }>;
  onMonthChange: (m: string) => void;
  selecting: boolean;
  onToggleSelecting: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="sticky top-[calc(3rem+env(safe-area-inset-top))] lg:top-0 z-30 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-3 mb-4 bg-graphite/90 backdrop-blur-xl border-b border-graphite-border-subtle">
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1 min-w-0">
          <Search
            size={16}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-muted"
            aria-hidden="true"
          />
          <input
            type="search"
            inputMode="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={placeholder}
            aria-label="Search transactions"
            className="w-full pl-10 pr-10 py-2.5 border border-graphite-border rounded-xl text-base sm:text-sm text-ink bg-[var(--surface-2)] placeholder-ink-muted focus:ring-2 focus:ring-mint/30 focus:border-mint/50 focus:outline-none transition-colors [color-scheme:dark] [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button
              type="button"
              onClick={() => onQueryChange('')}
              className="absolute right-0.5 top-1/2 -translate-y-1/2 w-11 h-11 inline-flex items-center justify-center rounded-lg text-ink-muted hover:text-ink hover:bg-graphite-surface-hover"
              aria-label="Clear search"
            >
              <X size={14} aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <select
            value={month}
            onChange={(e) => onMonthChange(e.target.value)}
            aria-label="Month"
            className="flex-1 sm:flex-none sm:w-44 px-3 py-2.5 border border-graphite-border rounded-xl text-sm text-ink bg-[var(--surface-2)] focus:ring-2 focus:ring-mint/30 focus:outline-none [color-scheme:dark]"
          >
            {monthOptions.map((o) => (
              <option key={o.value} value={o.value} className="bg-[var(--surface)]">
                {o.label}
              </option>
            ))}
          </select>
          {children}
          <button
            type="button"
            onClick={onToggleSelecting}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl border text-sm transition-colors shrink-0',
              selecting
                ? 'border-mint/50 bg-mint-dim text-mint'
                : 'border-graphite-border text-ink-secondary hover:text-ink hover:bg-graphite-surface-hover'
            )}
            aria-pressed={selecting}
          >
            <CheckSquare size={16} aria-hidden="true" />
            <span className="hidden sm:inline">{selecting ? 'Done' : 'Select'}</span>
            <span className="sr-only sm:hidden">{selecting ? 'Done selecting' : 'Select transactions'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ==================== GROUPED LIST ====================

export function GroupedList<T>({
  groups,
  totalCount,
  resetKey,
  getId,
  renderRow,
  selection,
  totalTone = 'text-ink-secondary',
  formatTotal = (n) => formatCurrency(n),
}: {
  groups: DayGroup<T>[];
  totalCount: number;
  resetKey: string;
  getId: (item: T) => string;
  renderRow: (item: T) => ReactNode;
  selection: ReturnType<typeof useSelection>;
  totalTone?: string;
  formatTotal?: (n: number) => string;
}) {
  const { limit, hasMore, sentinelRef, loadMore } = useScrollPagination(totalCount, resetKey);
  const visibleGroups = useMemo(() => sliceGroups(groups, limit), [groups, limit]);

  return (
    <div className="space-y-5">
      {visibleGroups.map((group) => {
        const fullGroup = groups.find((g) => g.key === group.key) || group;
        const ids = fullGroup.items.map(getId);
        const allSelected = ids.length > 0 && ids.every((id) => selection.selected.has(id));
        return (
          <section key={group.key} aria-label={group.label}>
            <div className="flex items-center gap-2 px-1 mb-2">
              {selection.selecting && (
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={() => selection.setMany(ids, !allSelected)}
                  aria-label={`Select all on ${group.label}`}
                  className="w-4 h-4 accent-[var(--mint)] shrink-0"
                />
              )}
              <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-muted">
                {group.label}
              </h2>
              <span className="text-[11px] text-ink-muted/70">
                {fullGroup.items.length}
              </span>
              <span className="flex-1 h-px bg-graphite-border-subtle" />
              <span className={cn('text-xs font-semibold money tabular-nums', totalTone)}>
                {formatTotal(fullGroup.total)}
              </span>
            </div>
            <div className="space-y-1.5">{group.items.map((item) => renderRow(item))}</div>
          </section>
        );
      })}
      {hasMore && (
        <div ref={sentinelRef} className="flex justify-center py-4">
          <button
            type="button"
            onClick={loadMore}
            className="inline-flex items-center gap-2 text-sm text-ink-muted hover:text-ink"
          >
            <Loader2 size={14} className="animate-spin" />
            Load more ({totalCount - limit} left)
          </button>
        </div>
      )}
    </div>
  );
}

// ==================== ROW ====================

export function TransactionRow({
  id,
  label,
  selection,
  leading,
  title,
  badge,
  meta,
  amount,
  amountTone,
  onDuplicate,
  onEdit,
  onDelete,
  busy,
}: {
  id: string;
  /** Plain-text description used in accessible names, e.g. "Groceries, $42.10, Nov 3". */
  label?: string;
  selection: ReturnType<typeof useSelection>;
  leading: ReactNode;
  title: ReactNode;
  badge?: ReactNode;
  meta: ReactNode;
  amount: ReactNode;
  amountTone: string;
  onDuplicate?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  busy?: boolean;
}) {
  const isSelected = selection.selected.has(id);
  return (
    <div
      onClick={selection.selecting ? () => selection.toggle(id) : undefined}
      className={cn(
        'group flex items-center gap-2.5 sm:gap-3.5 rounded-2xl border px-3 sm:px-4 py-3 transition-colors duration-150',
        isSelected
          ? 'border-mint/40 bg-mint-dim/60'
          : 'border-graphite-border-subtle bg-graphite-surface hover:border-graphite-border hover:bg-graphite-surface-hover',
        selection.selecting && 'cursor-pointer select-none',
        busy && 'opacity-50 pointer-events-none'
      )}
    >
      <input
        type="checkbox"
        checked={isSelected}
        onChange={() => selection.toggle(id)}
        onClick={(e) => e.stopPropagation()}
        aria-label={label ? `Select ${label}` : 'Select transaction'}
        className={cn(
          'w-4 h-4 accent-[var(--mint)] shrink-0',
          selection.selecting ? 'block' : 'hidden sm:block sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100'
        )}
      />
      <div aria-hidden="true" className="w-10 h-10 rounded-xl bg-graphite-surface-2 border border-graphite-border-subtle flex items-center justify-center text-base shrink-0">
        {leading}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          <p className="text-sm font-medium text-ink truncate">{title}</p>
          {badge}
        </div>
        <div className="flex items-center gap-x-1.5 mt-0.5 text-xs text-ink-muted min-w-0 truncate">
          {meta}
        </div>
      </div>
      <p className={cn('text-sm sm:text-base font-semibold money tabular-nums shrink-0', amountTone)}>
        {amount}
      </p>
      {!selection.selecting && (
        <RowActions label={label} onDuplicate={onDuplicate} onEdit={onEdit} onDelete={onDelete} />
      )}
    </div>
  );
}

function RowActions({
  label,
  onDuplicate,
  onEdit,
  onDelete,
}: {
  label?: string;
  onDuplicate?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('touchstart', close);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('touchstart', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const actions = [
    onDuplicate && { label: 'Duplicate', icon: Copy, run: onDuplicate, tone: 'hover:text-info hover:bg-info-dim' },
    onEdit && { label: 'Edit', icon: Pencil, run: onEdit, tone: 'hover:text-mint hover:bg-mint-dim' },
    onDelete && { label: 'Delete', icon: Trash2, run: onDelete, tone: 'hover:text-danger hover:bg-danger-dim' },
  ].filter(Boolean) as Array<{ label: string; icon: typeof Copy; run: () => void; tone: string }>;

  return (
    <>
      <div className="hidden sm:flex items-center opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
        {actions.map((a) => (
          <button
            key={a.label}
            type="button"
            onClick={a.run}
            className={cn('w-11 h-11 inline-flex items-center justify-center rounded-xl text-ink-muted transition-colors', a.tone)}
            aria-label={label ? `${a.label} ${label}` : a.label}
            title={a.label}
          >
            <a.icon size={15} aria-hidden="true" />
          </button>
        ))}
      </div>
      <div ref={ref} className="relative sm:hidden -mr-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="w-11 h-11 inline-flex items-center justify-center rounded-xl text-ink-muted hover:text-ink hover:bg-graphite-surface-2"
          aria-label={label ? `Actions for ${label}` : 'Row actions'}
          aria-expanded={open}
        >
          <MoreVertical size={16} aria-hidden="true" />
        </button>
        {open && (
          <div className="absolute right-0 top-full mt-1 z-20 w-40 rounded-xl border border-graphite-border bg-graphite-elevated shadow-panel py-1">
            {actions.map((a) => (
              <button
                key={a.label}
                type="button"
                onClick={() => {
                  setOpen(false);
                  a.run();
                }}
                className={cn(
                  'w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-ink-secondary hover:bg-graphite-surface-hover',
                  a.label === 'Delete' && 'text-danger'
                )}
              >
                <a.icon size={15} aria-hidden="true" />
                {a.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// ==================== BULK BAR ====================

export function BulkActionBar({
  count,
  total,
  categories,
  onRecategorize,
  onDelete,
  onClear,
  busy,
}: {
  count: number;
  total: number;
  categories?: Array<{ id: string; name: string; icon?: string | null }>;
  onRecategorize?: (categoryId: string) => void;
  onDelete: () => void;
  onClear: () => void;
  busy?: boolean;
}) {
  if (count === 0) return null;
  return (
    <div className="fixed inset-x-0 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] lg:bottom-6 lg:left-64 z-40 px-4 pointer-events-none">
      <div className="pointer-events-auto mx-auto max-w-2xl flex flex-wrap items-center gap-2 rounded-2xl border border-graphite-border bg-graphite-elevated/95 backdrop-blur-xl shadow-panel px-3 py-2.5">
        <button
          type="button"
          onClick={onClear}
          className="w-11 h-11 inline-flex items-center justify-center rounded-lg text-ink-muted hover:text-ink hover:bg-graphite-surface-hover"
          aria-label="Clear selection"
        >
          <X size={16} aria-hidden="true" />
        </button>
        <p className="text-sm text-ink mr-auto">
          <span className="font-semibold">{count}</span> selected
          <span className="text-ink-muted money ml-2">{formatCurrency(total)}</span>
        </p>
        {categories && onRecategorize && (
          <select
            value=""
            disabled={busy}
            onChange={(e) => e.target.value && onRecategorize(e.target.value)}
            aria-label="Move selected to category"
            className="max-w-[11rem] px-2.5 py-2 border border-graphite-border rounded-xl text-sm text-ink bg-[var(--surface-2)] focus:outline-none [color-scheme:dark]"
          >
            <option value="">Re-categorise…</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id} className="bg-[var(--surface)]">
                {c.icon ? `${c.icon} ` : ''}
                {c.name}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          onClick={onDelete}
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-danger-dim text-danger border border-danger/25 text-sm font-medium hover:bg-danger/20 disabled:opacity-50"
        >
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
          Delete
        </button>
      </div>
    </div>
  );
}

export function EmptyResults({ query, onClear }: { query: string; onClear: () => void }) {
  return (
    <div className="panel border-dashed py-12 px-6 text-center">
      <p className="text-ink font-medium">No matches{query ? ` for “${query}”` : ''}</p>
      <p className="text-ink-muted text-sm mt-1">Try another search, month or filter.</p>
      <button type="button" onClick={onClear} className="mt-4 text-sm text-mint hover:underline">
        Clear search and filters
      </button>
    </div>
  );
}
