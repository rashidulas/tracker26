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
          <label className="block text-sm font-medium text-zinc-400 mb-1.5">
            {label}
          </label>
        )}
        <input
          ref={ref}
          className={`
            w-full px-3 py-2.5 sm:py-2 border border-zinc-700 rounded-xl text-base
            text-zinc-100 bg-zinc-800/50 placeholder-zinc-600
            focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/50 focus:outline-none
            disabled:bg-zinc-900 disabled:cursor-not-allowed disabled:text-zinc-600
            ${error ? 'border-red-500/50' : ''}
            ${className}
          `}
          {...props}
        />
        {error && (
          <p className="mt-1 text-sm text-red-400">{error}</p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';

export default Input;
