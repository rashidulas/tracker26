import { forwardRef, useId } from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export const fieldClasses = `
  w-full px-3.5 py-2.5 border border-graphite-border rounded-xl text-sm sm:text-base
  text-ink bg-[var(--surface-2)] placeholder-ink-muted
  focus:ring-2 focus:ring-mint/30 focus:border-mint/50 focus:outline-none
  disabled:bg-graphite-elevated disabled:cursor-not-allowed disabled:text-ink-muted
  transition-colors duration-200
  [color-scheme:dark]
`;

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, className = '', id, ...props }, ref) => {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const errorId = `${inputId}-error`;
    const hintId = `${inputId}-hint`;
    const describedBy =
      [props['aria-describedby'], hint ? hintId : null, error ? errorId : null]
        .filter(Boolean)
        .join(' ') || undefined;

    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={inputId}
            className="block text-sm font-medium text-ink-secondary mb-1.5"
          >
            {label}
          </label>
        )}
        <input
          ref={ref}
          {...props}
          id={inputId}
          aria-invalid={error ? true : props['aria-invalid']}
          aria-describedby={describedBy}
          className={`${fieldClasses} ${error ? 'border-danger/50 focus:ring-danger/30' : ''} ${className}`}
        />
        {hint && !error && (
          <p id={hintId} className="mt-1.5 text-xs text-ink-muted">
            {hint}
          </p>
        )}
        {error && (
          <p id={errorId} className="mt-1.5 text-sm text-danger">
            {error}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';

export default Input;
