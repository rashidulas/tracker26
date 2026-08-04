import { getExpenses, getCategoriesForSelect, getAccountsForSelect } from './actions';
import { getDebts } from '@/app/debts/actions';
import ExpensesClient from './ExpensesClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function ExpensesPage() {
  const [expensesResult, categoriesResult, accountsResult, debtsResult] = await Promise.all([
    getExpenses(),
    getCategoriesForSelect(),
    getAccountsForSelect(),
    getDebts(),
  ]);

  if (!expensesResult.success || !categoriesResult.success || !accountsResult.success) {
    return (
      <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400">
        Error loading data
      </div>
    );
  }

  return (
    <ExpensesClient
      initialExpenses={expensesResult.data || []}
      categories={categoriesResult.data || []}
      accounts={accountsResult.data || []}
      debts={debtsResult.data || []}
    />
  );
}
