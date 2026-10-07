'use client';

import { ReactNode } from 'react';

interface ResponsiveTableProps {
  children: ReactNode;
  className?: string;
}

export default function ResponsiveTable({ children, className = '' }: ResponsiveTableProps) {
  return (
    <div className={`panel shadow-panel overflow-hidden ${className}`}>
      <div className="overflow-x-auto mobile-table-scroll">{children}</div>
    </div>
  );
}
