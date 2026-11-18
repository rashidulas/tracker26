import { getExpenses } from './actions';
import { getCategoriesForSelect } from '@/app/settings/categories/actions';
import { getAccountsForSelect } from '@/app/accounts/actions';
import { getFriendsForSelect } from '@/app/friends/actions';
import ExpensesClient from './ExpensesClient';
import { getMerchantMemory } from '@/app/settings/merchants/actions';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function ExpensesPage() {
  const [expensesResult, categoriesResult, accountsResult, friendsResult, merchants] = await Promise.all([
    getExpenses(),
    getCategoriesForSelect('EXPENSE'),
    getAccountsForSelect(),
    getFriendsForSelect(),
    getMerchantMemory('EXPENSE').catch((error) => {
      console.error('Error loading merchant memory:', error);
      return [];
    }),
  ]);

  if (!expensesResult.success || !categoriesResult.success || !accountsResult.success) {
    throw new Error(
      expensesResult.error || categoriesResult.error || accountsResult.error || 'Error loading expenses'
    );
  }

  return (
    <ExpensesClient
      initialExpenses={expensesResult.data || []}
      categories={categoriesResult.data || []}
      accounts={accountsResult.data || []}
      friends={friendsResult.success ? friendsResult.data : []}
      merchants={merchants}
    />
  );
}
