import LoadError from '../LoadError';
import { getExpenses, getCategoriesForSelect, getAccountsForSelect } from './actions';
import ExpensesClient from './ExpensesClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function ExpensesPage() {
  const [expensesResult, categoriesResult, accountsResult] = await Promise.all([
    getExpenses(),
    getCategoriesForSelect(),
    getAccountsForSelect(),
  ]);

  if (!expensesResult.success || !categoriesResult.success || !accountsResult.success) {
    return <LoadError what="expenses" />;
  }

  return (
    <ExpensesClient
      expenses={expensesResult.data || []}
      categories={categoriesResult.data || []}
      accounts={accountsResult.data || []}
    />
  );
}
