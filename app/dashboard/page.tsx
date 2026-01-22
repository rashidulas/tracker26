import { getDashboardData } from './actions';
import DashboardClient from './DashboardClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function DashboardPage() {
  const result = await getDashboardData();

  if (!result.success) {
    // Show dashboard with zeros instead of crashing
    const emptyData = {
      monthIncome: 0,
      monthExpenses: 0,
      totalDebt: 0,
      totalSavings: 0,
      totalBalance: 0,
      categoryData: [],
      monthlyTrend: [],
      recentTransactions: [],
    };

    return (
      <div>
        <div className="mb-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <h3 className="font-semibold text-yellow-800 mb-1">Database Connection Issue</h3>
          <p className="text-sm text-yellow-700">{result.error}</p>
          <p className="text-xs text-yellow-600 mt-2">
            Please check: 1) DATABASE_URL in Vercel environment variables, 2) MongoDB Atlas network access allows Vercel IPs (0.0.0.0/0), 3) Database credentials are correct.
          </p>
        </div>
        <DashboardClient data={emptyData} />
      </div>
    );
  }

  return <DashboardClient data={result.data!} />;
}
