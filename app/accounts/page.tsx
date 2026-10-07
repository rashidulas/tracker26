import { getAccounts } from './actions';
import AccountsClient from './AccountsClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function AccountsPage() {
  const result = await getAccounts();

  if (!result.success) {
    return (
      <div className="page-shell">
        <div className="p-4 bg-danger-dim border border-danger/25 rounded-2xl text-danger">
          Error: {result.error}
        </div>
      </div>
    );
  }

  return <AccountsClient initialAccounts={result.data || []} />;
}
