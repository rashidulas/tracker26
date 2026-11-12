'use client';

import { ReactNode, useId, useState } from 'react';
import { Filter, X } from 'lucide-react';
import Button from '@/components/Button';
import Input from '@/components/Input';
import Select from '@/components/Select';
import type { TransactionFilterState } from './useTransactionFilters';

interface CategoryOption {
  id: string;
  name: string;
  subcategories?: Array<{ id: string; name: string }>;
}

interface TransactionToolbarProps {
  filters: TransactionFilterState;
  setFilter: <K extends keyof TransactionFilterState>(
    key: K,
    value: TransactionFilterState[K]
  ) => void;
  clearFilters: () => void;
  monthOptions: Array<{ value: string; label: string }>;
  activeFilterCount: number;
  /** Omit to hide the category/subcategory filters (e.g. transfers). */
  categories?: CategoryOption[];
  searchPlaceholder?: string;
  /** Primary actions (Add, Scan…) rendered at the end of the toolbar. */
  actions?: ReactNode;
}

export default function TransactionToolbar({
  filters,
  setFilter,
  clearFilters,
  monthOptions,
  activeFilterCount,
  categories,
  searchPlaceholder = 'Search notes…',
  actions,
}: TransactionToolbarProps) {
  const [open, setOpen] = useState(activeFilterCount > 0);
  const panelId = useId();
  const subcategories =
    categories?.find((c) => c.id === filters.categoryId)?.subcategories || [];

  return (
    <div className="mb-6">
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-full sm:w-48">
          <Select
            aria-label="Month"
            options={monthOptions}
            value={filters.month}
            onChange={(e) => setFilter('month', e.target.value)}
            className="!py-2 text-sm"
          />
        </div>
        <Button
          variant="secondary"
          onClick={() => setOpen((v) => !v)}
          className="relative"
          aria-expanded={open}
          aria-controls={panelId}
        >
          <Filter size={18} aria-hidden="true" />
          Filters
          {activeFilterCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-mint text-graphite text-[10px] font-bold flex items-center justify-center">
              {activeFilterCount}
              <span className="sr-only"> active</span>
            </span>
          )}
        </Button>
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">{actions}</div>
      </div>

      {open && (
        <section
          id={panelId}
          aria-label="Filters"
          className="panel shadow-panel p-5 sm:p-6 mt-4 animate-fade-up"
        >
          <div className="flex justify-between items-center mb-4">
            <h2 className="font-semibold text-ink font-display">Filters</h2>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-ink-muted hover:text-ink transition-colors w-11 h-11 inline-flex items-center justify-center rounded-xl hover:bg-graphite-surface-2 -mr-2"
              aria-label="Hide filters"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
          <div
            className={`grid grid-cols-1 md:grid-cols-2 gap-4 ${
              categories ? 'lg:grid-cols-5' : 'lg:grid-cols-3'
            }`}
          >
            <Input
              label="Start date"
              type="date"
              value={filters.startDate}
              onChange={(e) => setFilter('startDate', e.target.value)}
            />
            <Input
              label="End date"
              type="date"
              value={filters.endDate}
              onChange={(e) => setFilter('endDate', e.target.value)}
            />
            {categories && (
              <>
                <Select
                  label="Category"
                  value={filters.categoryId}
                  onChange={(e) => setFilter('categoryId', e.target.value)}
                  options={[
                    { value: '', label: 'All categories' },
                    ...categories.map((c) => ({ value: c.id, label: c.name })),
                  ]}
                />
                <Select
                  label="Subcategory"
                  value={filters.subcategoryId}
                  disabled={!filters.categoryId || subcategories.length === 0}
                  onChange={(e) => setFilter('subcategoryId', e.target.value)}
                  options={[
                    {
                      value: '',
                      label: filters.categoryId ? 'All subcategories' : 'Select category first',
                    },
                    ...subcategories.map((s) => ({ value: s.id, label: s.name })),
                  ]}
                />
              </>
            )}
            <Input
              label="Search"
              type="search"
              placeholder={searchPlaceholder}
              value={filters.search}
              onChange={(e) => setFilter('search', e.target.value)}
            />
          </div>
          <div className="mt-4">
            <Button variant="secondary" size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
