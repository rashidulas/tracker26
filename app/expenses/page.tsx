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
    return (
      <div className="page-shell">
        <div className="p-4 bg-danger-dim border border-danger/25 rounded-2xl text-danger">
          Error loading data
        </div>
      </div>
    );
  }

  return (
    <ExpensesClient
      initialExpenses={expensesResult.data || []}
      categories={categoriesResult.data || []}
      accounts={accountsResult.data || []}
    />
  );
}
