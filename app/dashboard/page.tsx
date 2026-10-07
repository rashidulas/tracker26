import { getDashboardData } from './actions';
import DashboardClient from './DashboardClient';
import FinanceAssistant from '@/components/assistant/FinanceAssistant';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const emptyData = {
  monthIncome: 0,
  monthExpenses: 0,
  totalSavings: 0,
  totalBalance: 0,
  cashBalance: 0,
  creditCards: [],
  categoryData: [],
  monthlyTrend: [],
  recentTransactions: [],
  budgetProgress: [],
  dailySpending: [],
};

export default async function DashboardPage() {
  const result = await getDashboardData();

  if (!result.success) {
    return (
      <div className="page-shell">
        <div className="mb-6 p-4 rounded-2xl border border-warning/25 bg-warning-dim">
          <h3 className="font-semibold text-warning mb-1 font-display">Database Connection Issue</h3>
          <p className="text-sm text-warning/80">{result.error}</p>
          <p className="text-xs text-warning/60 mt-2">
            Please check: 1) DATABASE_URL in environment variables, 2) MongoDB Atlas network access, 3) Database credentials.
          </p>
        </div>
        <DashboardClient data={emptyData} />
        <FinanceAssistant />
      </div>
    );
  }

  return (
    <>
      <DashboardClient data={result.data!} />
      <FinanceAssistant />
    </>
  );
}
