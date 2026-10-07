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
      <div className="page-shell">
        <div className="p-4 bg-danger-dim border border-danger/25 rounded-2xl text-danger">
          Error loading data
        </div>
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
