'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import Button from './Button';
import Input from './Input';
import { formatDateForInput } from '@/lib/utils';

type FilterValue = string | number | Date | string[] | undefined;

interface FilterPanelProps {
  children: React.ReactNode;
  onClearAll: () => void;
  activeFilterCount: number;
  isOpen?: boolean;
  onToggle?: () => void;
}

export function FilterPanel({ children, onClearAll, activeFilterCount, isOpen = true, onToggle }: FilterPanelProps) {
  const [internalOpen, setInternalOpen] = useState(isOpen);
  const open = onToggle ? isOpen : internalOpen;
  const handleToggle = onToggle || (() => setInternalOpen(!internalOpen));

  return (
    <div className="bg-zinc-900/50 border border-zinc-800/60 rounded-2xl mb-6">
      <div className="px-5 py-4 border-b border-zinc-800/60 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={handleToggle}
            className="flex items-center gap-2 text-lg font-semibold text-white hover:text-emerald-400 transition-colors"
          >
            <span>Filters</span>
            {open ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
          </button>
          {activeFilterCount > 0 && (
            <span className="bg-emerald-500/10 text-emerald-400 text-xs font-medium px-2.5 py-0.5 rounded-full border border-emerald-500/20">
              {activeFilterCount} active
            </span>
          )}
        </div>
        {activeFilterCount > 0 && (
          <Button variant="ghost" onClick={onClearAll} size="sm">
            <X size={16} />
            Clear All
          </Button>
        )}
      </div>
      {open && <div className="p-5">{children}</div>}
    </div>
  );
}

interface DateRangeFilterProps {
  startDate?: Date;
  endDate?: Date;
  onStartDateChange: (date: Date | undefined) => void;
  onEndDateChange: (date: Date | undefined) => void;
}

export function DateRangeFilter({ startDate, endDate, onStartDateChange, onEndDateChange }: DateRangeFilterProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div>
        <label className="block text-sm font-medium text-zinc-400 mb-1">Start Date</label>
        <input
          type="date"
          value={startDate ? formatDateForInput(startDate) : ''}
          onChange={(e) => onStartDateChange(e.target.value ? new Date(e.target.value) : undefined)}
          className="w-full px-3 py-2 border border-zinc-700 rounded-xl bg-zinc-800/50 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-zinc-400 mb-1">End Date</label>
        <input
          type="date"
          value={endDate ? formatDateForInput(endDate) : ''}
          onChange={(e) => onEndDateChange(e.target.value ? new Date(e.target.value) : undefined)}
          className="w-full px-3 py-2 border border-zinc-700 rounded-xl bg-zinc-800/50 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
        />
      </div>
    </div>
  );
}

interface AmountRangeFilterProps {
  minAmount?: number;
  maxAmount?: number;
  onMinAmountChange: (amount: number | undefined) => void;
  onMaxAmountChange: (amount: number | undefined) => void;
}

export function AmountRangeFilter({ minAmount, maxAmount, onMinAmountChange, onMaxAmountChange }: AmountRangeFilterProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div>
        <label className="block text-sm font-medium text-zinc-400 mb-1">Min Amount</label>
        <input
          type="number"
          step="0.01"
          min="0"
          placeholder="$0.00"
          value={minAmount ?? ''}
          onChange={(e) => onMinAmountChange(e.target.value ? parseFloat(e.target.value) : undefined)}
          className="w-full px-3 py-2 border border-zinc-700 rounded-xl bg-zinc-800/50 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-zinc-400 mb-1">Max Amount</label>
        <input
          type="number"
          step="0.01"
          min="0"
          placeholder="$999,999"
          value={maxAmount ?? ''}
          onChange={(e) => onMaxAmountChange(e.target.value ? parseFloat(e.target.value) : undefined)}
          className="w-full px-3 py-2 border border-zinc-700 rounded-xl bg-zinc-800/50 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
        />
      </div>
    </div>
  );
}

interface MultiSelectFilterProps {
  label: string;
  options: { id: string; name: string; color?: string }[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

export function MultiSelectFilter({ label, options, selectedIds, onChange }: MultiSelectFilterProps) {
  const toggleOption = (id: string) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter(selectedId => selectedId !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  };

  return (
    <div>
      <label className="block text-sm font-medium text-zinc-400 mb-2">{label}</label>
      <div className="max-h-48 overflow-y-auto border border-zinc-700 rounded-xl p-2 space-y-1 bg-zinc-800/30">
        {options.map(option => (
          <label
            key={option.id}
            className="flex items-center gap-2 px-2 py-1.5 hover:bg-zinc-700/50 rounded-lg cursor-pointer transition-colors"
          >
            <input
              type="checkbox"
              checked={selectedIds.includes(option.id)}
              onChange={() => toggleOption(option.id)}
              className="rounded border-zinc-600 bg-zinc-800 text-emerald-500 focus:ring-emerald-500/40"
            />
            <span className="flex-1 text-sm text-zinc-300">{option.name}</span>
            {option.color && (
              <span
                className="w-3.5 h-3.5 rounded-full border border-zinc-600"
                style={{ backgroundColor: option.color }}
              />
            )}
          </label>
        ))}
      </div>
      {selectedIds.length > 0 && (
        <div className="mt-2 text-xs text-zinc-500">
          {selectedIds.length} selected
        </div>
      )}
    </div>
  );
}

interface SearchFilterProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function SearchFilter({ value, onChange, placeholder = 'Search...' }: SearchFilterProps) {
  return (
    <div>
      <label className="block text-sm font-medium text-zinc-400 mb-1">Search</label>
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 border border-zinc-700 rounded-xl bg-zinc-800/50 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
      />
    </div>
  );
}

interface ActiveFiltersProps {
  filters: { label: string; value: string; onRemove: () => void }[];
}

export function ActiveFilters({ filters }: ActiveFiltersProps) {
  if (filters.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 mb-4">
      {filters.map((filter, index) => (
        <span
          key={index}
          className="inline-flex items-center gap-1 bg-emerald-500/10 text-emerald-400 text-sm px-3 py-1 rounded-full border border-emerald-500/20"
        >
          <span className="font-medium">{filter.label}:</span>
          <span>{filter.value}</span>
          <button
            onClick={filter.onRemove}
            className="ml-1 hover:bg-emerald-500/20 rounded-full p-0.5 transition-colors"
          >
            <X size={14} />
          </button>
        </span>
      ))}
    </div>
  );
}
