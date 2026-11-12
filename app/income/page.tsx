import { getIncome } from './actions';
import { getCategoriesForSelect } from '@/app/categories/actions';
import { getAccountsForSelect } from '@/app/accounts/actions';
import IncomeClient from './IncomeClient';
import type { IncomePart } from './incomeRows';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function IncomePage() {
  const [incomeResult, categoriesResult, accountsResult] = await Promise.all([
    getIncome(),
    getCategoriesForSelect('INCOME'),
    getAccountsForSelect(),
  ]);

  if (!incomeResult.success || !categoriesResult.success || !accountsResult.success) {
    throw new Error(
      incomeResult.error || categoriesResult.error || accountsResult.error || 'Error loading income'
    );
  }

  return (
    <IncomeClient
      initialParts={(incomeResult.data || []) as IncomePart[]}
      categories={categoriesResult.data || []}
      accounts={accountsResult.data || []}
    />
  );
}
