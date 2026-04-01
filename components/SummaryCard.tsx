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
  blue: 'bg-blue-500/10 text-blue-400',
  green: 'bg-emerald-500/10 text-emerald-400',
  red: 'bg-red-500/10 text-red-400',
  purple: 'bg-purple-500/10 text-purple-400',
  yellow: 'bg-yellow-500/10 text-yellow-400',
  gray: 'bg-zinc-700/50 text-zinc-400',
};

export default function SummaryCard({ title, value, icon: Icon, trend, color = 'blue' }: SummaryCardProps) {
  return (
    <div className="bg-zinc-900/50 border border-zinc-800/60 rounded-2xl p-4 sm:p-5 hover:border-zinc-700/60 transition-all duration-200">
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <p className="text-xs sm:text-sm text-zinc-500 mb-1 truncate">{title}</p>
          <p className="text-lg sm:text-2xl font-bold text-white truncate">{value}</p>
          {trend && (
            <p className={`text-xs sm:text-sm mt-2 ${trend.isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
              {trend.isPositive ? '↑' : '↓'} {Math.abs(trend.value)}%
            </p>
          )}
        </div>
        <div className={`p-3 sm:p-3.5 rounded-xl ${colorClasses[color]} flex-shrink-0`}>
          <Icon size={20} className="sm:w-5 sm:h-5" />
        </div>
      </div>
    </div>
  );
}
