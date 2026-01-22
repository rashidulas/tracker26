'use client';

import { ReactNode } from 'react';

interface ResponsiveTableProps {
  children: ReactNode;
  className?: string;
}

export default function ResponsiveTable({ children, className = '' }: ResponsiveTableProps) {
  return (
    <div className={`bg-white rounded-lg shadow overflow-hidden ${className}`}>
      <div className="overflow-x-auto">
        {children}
      </div>
    </div>
  );
}
