import { getAccounts } from './actions';
import AccountsClient from './AccountsClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function AccountsPage() {
  const result = await getAccounts();

  if (!result.success) {
    return (
      <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-400">
        Error: {result.error}
      </div>
    );
  }

  return <AccountsClient initialAccounts={result.data || []} />;
}
