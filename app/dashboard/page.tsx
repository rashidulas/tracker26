import { getDashboardData } from './actions';
import DashboardClient from './DashboardClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const emptyData = {
  monthIncome: 0,
  monthExpenses: 0,
  totalDebt: 0,
  totalSavings: 0,
  totalBalance: 0,
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
      <div className="p-8">
        <div className="mb-6 p-4 rounded-2xl border border-yellow-500/20 bg-yellow-500/5">
          <h3 className="font-semibold text-yellow-400 mb-1">Database Connection Issue</h3>
          <p className="text-sm text-yellow-400/70">{result.error}</p>
          <p className="text-xs text-yellow-400/50 mt-2">
            Please check: 1) DATABASE_URL in environment variables, 2) MongoDB Atlas network access, 3) Database credentials.
          </p>
        </div>
        <DashboardClient data={emptyData} />
      </div>
    );
  }

  return <DashboardClient data={result.data!} />;
}
