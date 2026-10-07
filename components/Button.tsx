interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  children: React.ReactNode;
}

const variantClasses = {
  primary:
    'bg-mint text-graphite font-semibold hover:bg-mint-bright border border-mint/40 shadow-[0_0_20px_-6px_var(--mint-glow)]',
  secondary:
    'bg-graphite-surface-2 text-ink-secondary hover:text-ink hover:bg-graphite-surface-hover border border-graphite-border',
  danger:
    'bg-danger-dim text-danger hover:bg-[rgba(240,113,120,0.2)] border border-danger/25',
  ghost:
    'bg-transparent text-ink-secondary hover:bg-graphite-surface-2 hover:text-ink border border-transparent',
};

const sizeClasses = {
  sm: 'px-3 py-1.5 text-sm rounded-lg',
  md: 'px-4 py-2.5 text-sm rounded-xl',
  lg: 'px-6 py-3 text-base rounded-xl',
};

export default function Button({
  variant = 'primary',
  size = 'md',
  children,
  className = '',
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={`
        inline-flex items-center justify-center gap-2
        ${variantClasses[variant]}
        ${sizeClasses[size]}
        font-medium transition-all duration-200 ease-soft
        disabled:opacity-45 disabled:cursor-not-allowed disabled:shadow-none
        active:scale-[0.98]
        ${className}
      `}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
}
