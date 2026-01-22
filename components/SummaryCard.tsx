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
  blue: 'bg-blue-100 text-blue-600',
  green: 'bg-green-100 text-green-600',
  red: 'bg-red-100 text-red-600',
  purple: 'bg-purple-100 text-purple-600',
  yellow: 'bg-yellow-100 text-yellow-600',
  gray: 'bg-gray-100 text-gray-600',
};

export default function SummaryCard({ title, value, icon: Icon, trend, color = 'blue' }: SummaryCardProps) {
  return (
    <div className="bg-white rounded-lg shadow p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <p className="text-xs sm:text-sm text-gray-600 mb-1 truncate">{title}</p>
          <p className="text-lg sm:text-2xl font-bold text-gray-900 truncate">{value}</p>
          {trend && (
            <p className={`text-xs sm:text-sm mt-2 ${trend.isPositive ? 'text-green-600' : 'text-red-600'}`}>
              {trend.isPositive ? '↑' : '↓'} {Math.abs(trend.value)}%
            </p>
          )}
        </div>
        <div className={`p-3 sm:p-4 rounded-full ${colorClasses[color]} flex-shrink-0`}>
          <Icon size={20} className="sm:w-6 sm:h-6" />
        </div>
      </div>
    </div>
  );
}
