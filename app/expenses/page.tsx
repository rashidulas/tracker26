import { getExpenses, getCategoriesForSelect, getAccountsForSelect } from './actions';
import ExpensesClient from './ExpensesClient';

export default async function ExpensesPage() {
  const [expensesResult, categoriesResult, accountsResult] = await Promise.all([
    getExpenses(),
    getCategoriesForSelect(),
    getAccountsForSelect(),
  ]);

  if (!expensesResult.success || !categoriesResult.success || !accountsResult.success) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
        Error loading data
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
