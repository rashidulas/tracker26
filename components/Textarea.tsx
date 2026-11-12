import { forwardRef, useId } from 'react';
import { fieldClasses } from './Input';

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  hint?: string;
}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, hint, className = '', id, rows = 3, ...props }, ref) => {
    const generatedId = useId();
    const textareaId = id ?? generatedId;
    const errorId = `${textareaId}-error`;
    const hintId = `${textareaId}-hint`;
    const describedBy =
      [props['aria-describedby'], hint ? hintId : null, error ? errorId : null]
        .filter(Boolean)
        .join(' ') || undefined;

    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={textareaId}
            className="block text-sm font-medium text-ink-secondary mb-1.5"
          >
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          rows={rows}
          {...props}
          id={textareaId}
          aria-invalid={error ? true : props['aria-invalid']}
          aria-describedby={describedBy}
          className={`${fieldClasses} resize-y ${error ? 'border-danger/50 focus:ring-danger/30' : ''} ${className}`}
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

Textarea.displayName = 'Textarea';

export default Textarea;
