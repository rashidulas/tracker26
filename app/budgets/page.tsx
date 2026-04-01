'use client';

import { PieChart } from 'lucide-react';

export default function BudgetsPage() {
  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold text-white">Budgets</h1>
          <p className="text-zinc-400 mt-1">Set and track monthly budgets</p>
        </div>
      </div>

      <div className="bg-zinc-900/50 border border-zinc-800/60 rounded-2xl p-12 text-center">
        <PieChart size={64} className="mx-auto text-zinc-600 mb-4" />
        <h2 className="text-xl font-semibold text-white mb-2">Budget Management</h2>
        <p className="text-zinc-400 mb-4">
          Set monthly budgets per category and track your spending against them.
        </p>
        <p className="text-sm text-zinc-500">
          Full budget tracking features coming soon with monthly comparisons and rollover support.
        </p>
      </div>
    </div>
  );
}
