import { forwardRef } from 'react';
import { ChevronDown } from 'lucide-react';

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options: { value: string; label: string }[];
}

const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, options, className = '', ...props }, ref) => {
    return (
      <div className="w-full">
        {label && (
          <label className="block text-sm font-medium text-ink-secondary mb-1.5">
            {label}
          </label>
        )}
        <div className="relative">
          <select
            ref={ref}
            className={`
              w-full px-3.5 py-2.5 pr-10 border border-graphite-border rounded-xl text-sm sm:text-base
              text-ink bg-[var(--surface-2)]
              focus:ring-2 focus:ring-mint/30 focus:border-mint/50 focus:outline-none
              disabled:bg-graphite-elevated disabled:cursor-not-allowed disabled:text-ink-muted
              transition-colors duration-200 appearance-none
              [color-scheme:dark]
              ${error ? 'border-danger/50' : ''}
              ${className}
            `}
            {...props}
          >
            {options.map((option) => (
              <option
                key={option.value}
                value={option.value}
                className="bg-[var(--surface)] text-[var(--text)]"
              >
                {option.label}
              </option>
            ))}
          </select>
          <ChevronDown
            size={16}
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted"
          />
        </div>
        {error && <p className="mt-1.5 text-sm text-danger">{error}</p>}
      </div>
    );
  }
);

Select.displayName = 'Select';

export default Select;
