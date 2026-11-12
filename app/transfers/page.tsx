import { getTransactions } from '@/app/transactions/actions';
import { getAccountsForSelect } from '@/app/accounts/actions';
import TransfersClient, { type Transfer } from './TransfersClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function TransfersPage() {
  const [transfers, accountsResult] = await Promise.all([
    getTransactions({ kind: 'TRANSFER' }),
    getAccountsForSelect(),
  ]);

  if (!accountsResult.success) {
    throw new Error(accountsResult.error || 'Error loading accounts');
  }

  return (
    <TransfersClient
      initialTransfers={transfers as Transfer[]}
      accounts={accountsResult.data || []}
    />
  );
}
