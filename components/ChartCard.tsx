import { ReactNode } from 'react';

interface ChartCardProps {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}

export default function ChartCard({ title, children, action }: ChartCardProps) {
  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        {action && <div>{action}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}
