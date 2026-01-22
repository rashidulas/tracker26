import { getAccounts } from './actions';
import AccountsClient from './AccountsClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function AccountsPage() {
  const result = await getAccounts();

  if (!result.success) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
        Error: {result.error}
      </div>
    );
  }

  return <AccountsClient initialAccounts={result.data || []} />;
}
