import { LucideIcon } from 'lucide-react';

interface SummaryCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  trend?: {
    value: number;
    isPositive: boolean;
  };
  color?: 'blue' | 'green' | 'red' | 'purple' | 'yellow' | 'gray';
}

const colorClasses = {
  blue: 'bg-info-dim text-info',
  green: 'bg-mint-dim text-mint',
  red: 'bg-danger-dim text-danger',
  purple: 'bg-info-dim text-info',
  yellow: 'bg-warning-dim text-warning',
  gray: 'bg-graphite-surface-2 text-ink-secondary',
};

export default function SummaryCard({
  title,
  value,
  icon: Icon,
  trend,
  color = 'green',
}: SummaryCardProps) {
  return (
    <div className="panel shadow-panel p-4 sm:p-5 transition-colors duration-200 hover:border-graphite-border">
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-xs sm:text-sm text-ink-muted mb-1.5 truncate">{title}</p>
          <p className="text-xl sm:text-2xl font-semibold text-ink money truncate">{value}</p>
          {trend && (
            <p
              className={`text-xs sm:text-sm mt-2 font-medium ${
                trend.isPositive ? 'text-mint' : 'text-danger'
              }`}
            >
              {trend.isPositive ? '↑' : '↓'} {Math.abs(trend.value)}%
            </p>
          )}
        </div>
        <div
          className={`p-3 rounded-xl ${colorClasses[color]} flex-shrink-0 border border-white/[0.03]`}
        >
          <Icon size={20} />
        </div>
      </div>
    </div>
  );
}
