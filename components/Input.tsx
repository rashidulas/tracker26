import { forwardRef } from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className = '', ...props }, ref) => {
    return (
      <div className="w-full">
        {label && (
          <label className="block text-sm font-medium text-ink-secondary mb-1.5">
            {label}
          </label>
        )}
        <input
          ref={ref}
          className={`
            w-full px-3.5 py-2.5 border border-graphite-border rounded-xl text-sm sm:text-base
            text-ink bg-[var(--surface-2)] placeholder-ink-muted
            focus:ring-2 focus:ring-mint/30 focus:border-mint/50 focus:outline-none
            disabled:bg-graphite-elevated disabled:cursor-not-allowed disabled:text-ink-muted
            transition-colors duration-200
            [color-scheme:dark]
            ${error ? 'border-danger/50 focus:ring-danger/30' : ''}
            ${className}
          `}
          {...props}
        />
        {error && <p className="mt-1.5 text-sm text-danger">{error}</p>}
      </div>
    );
  }
);

Input.displayName = 'Input';

export default Input;
