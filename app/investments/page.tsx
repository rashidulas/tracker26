'use client';

import { useState } from 'react';
import Button from '@/components/Button';
import { TrendingUp } from 'lucide-react';

export default function InvestmentsPage() {
  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Investments</h1>
          <p className="text-gray-600 mt-1">Track your investment portfolio</p>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-12 text-center">
        <TrendingUp size={64} className="mx-auto text-gray-400 mb-4" />
        <h2 className="text-xl font-semibold text-gray-900 mb-2">Investment Tracking</h2>
        <p className="text-gray-600 mb-4">
          Track your holdings, contributions, and investment transactions manually.
        </p>
        <p className="text-sm text-gray-500">
          Full investment tracking features coming soon with holdings management and transaction history.
        </p>
      </div>
    </div>
  );
}
