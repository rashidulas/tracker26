'use client';

import { PieChart } from 'lucide-react';
import PageHeader from '@/components/PageHeader';

export default function BudgetsPage() {
  return (
    <div className="page-shell">
      <PageHeader title="Budgets" subtitle="Set and track monthly budgets" />

      <div className="panel shadow-panel p-12 text-center">
        <PieChart size={64} className="mx-auto text-ink-muted mb-4" />
        <h2 className="text-xl font-semibold text-ink font-display mb-2">Budget Management</h2>
        <p className="text-ink-secondary mb-4">
          Set monthly budgets per category and track your spending against them.
        </p>
        <p className="text-sm text-ink-muted">
          Full budget tracking features coming soon with monthly comparisons and rollover support.
        </p>
      </div>
    </div>
  );
}
