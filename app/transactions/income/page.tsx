import { groupIncomeRows, type IncomePart } from '@/lib/incomeRows';
import LoadError from '../LoadError';
import IncomeClient from './IncomeClient';
import { getAccountsForSelect, getCategoriesForSelect, getIncome } from './actions';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function IncomePage() {
  const [incomeResult, categoriesResult, accountsResult] = await Promise.all([
    getIncome(),
    getCategoriesForSelect(),
    getAccountsForSelect(),
  ]);

  if (!incomeResult.success || !categoriesResult.success || !accountsResult.success) {
    return <LoadError what="income" />;
  }

  const accounts = (accountsResult.data || []).map((a) => ({ id: a.id, name: a.name }));
  const rows = groupIncomeRows(
    (incomeResult.data || []) as IncomePart[],
    new Map(accounts.map((a) => [a.id, a.name]))
  );

  return (
    <IncomeClient
      rows={rows}
      categories={categoriesResult.data || []}
      accounts={accounts}
    />
  );
}
