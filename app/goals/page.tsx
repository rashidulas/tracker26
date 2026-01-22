import { getGoals, getAccounts } from './actions';
import GoalsClient from './GoalsClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function GoalsPage() {
  const [goalsResult, accountsResult] = await Promise.all([
    getGoals(),
    getAccounts(),
  ]);

  if (!goalsResult.success || !accountsResult.success) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
        Error loading data
      </div>
    );
  }

  return (
    <GoalsClient
      initialGoals={goalsResult.data || []}
      accounts={accountsResult.data || []}
    />
  );
}
