import { getTransactions, getAccountsForSelect } from '@/app/transactions/actions';
import TransfersClient, { type Transfer } from './TransfersClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function TransfersPage() {
  const [transfers, accounts] = await Promise.all([
    getTransactions({ kind: 'TRANSFER' }),
    getAccountsForSelect(),
  ]);

  return <TransfersClient initialTransfers={transfers as Transfer[]} accounts={accounts} />;
}
