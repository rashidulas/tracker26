import LoadError from '../LoadError';
import { getAccountsForSelect, getTransactions } from '../actions';
import TransfersClient, { type Transfer } from './TransfersClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function TransfersPage() {
  try {
    const [transfers, accounts] = await Promise.all([
      getTransactions({ kind: 'TRANSFER' }),
      getAccountsForSelect(),
    ]);
    return <TransfersClient transfers={transfers as Transfer[]} accounts={accounts} />;
  } catch {
    return <LoadError what="transfers" />;
  }
}
