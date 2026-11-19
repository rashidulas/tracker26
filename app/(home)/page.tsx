import { getDashboardData } from './actions';
import DashboardClient from './DashboardClient';
import InsightStrip from '@/components/insights/InsightStrip';
import { RecapSummaryCard } from '@/components/insights/RecapView';
import { loadDashboardRecaps, loadInsightStrip } from '@/lib/insights/store';
import { requireSession } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const emptyData = {
  monthIncome: 0,
  monthExpenses: 0,
  totalBalance: 0,
  cashBalance: 0,
  earmarkedForGoals: 0,
  goals: [],
  creditCards: [],
  loans: [],
  friends: [],
  friendsOwedToYou: 0,
  friendsYouOwe: 0,
  categoryData: [],
  monthlyTrend: [],
  recentTransactions: [],
  dailySpending: [],
  budget: null,
  upcoming: [],
  suggestionCount: 0,
};

/** Stored insights and recaps for the top of the dashboard. Reads only; never fails the page. */
async function loadProactive() {
  try {
    const [strip, recaps] = await Promise.all([loadInsightStrip(), loadDashboardRecaps()]);
    return { strip, recaps };
  } catch (error) {
    console.error('Error loading insights:', error);
    return { strip: { insights: [], note: null }, recaps: [] };
  }
}

export default async function DashboardPage() {
  await requireSession();
  const [result, proactive] = await Promise.all([getDashboardData(), loadProactive()]);

  if (!result.success) {
    return (
      <div>
        <div className="mb-6 p-4 rounded-2xl border border-warning/25 bg-warning-dim">
          <h3 className="font-semibold text-warning mb-1 font-display">Database Connection Issue</h3>
          <p className="text-sm text-warning/80">{result.error}</p>
          <p className="text-xs text-warning/60 mt-2">
            Please check: 1) DATABASE_URL in environment variables, 2) MongoDB Atlas network access, 3) Database credentials.
          </p>
        </div>
        <DashboardClient data={emptyData} />
      </div>
    );
  }

  return (
    <div className="space-y-6 lg:space-y-8">
      <InsightStrip insights={proactive.strip.insights} note={proactive.strip.note} />
      {proactive.recaps.map((recap) => (
        <RecapSummaryCard key={recap.key} recap={recap} />
      ))}
      <DashboardClient data={result.data!} />
    </div>
  );
}
