import { getReviewItems } from './actions';
import { getCategoriesForSelect } from '@/app/settings/categories/actions';
import { getAccountsForSelect } from '@/app/accounts/actions';
import { getFriendsForSelect } from '@/app/friends/actions';
import { getMerchantMemory } from '@/app/settings/merchants/actions';
import ReviewClient from './ReviewClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * The review inbox: entries that were not typed into a form (voice, receipt,
 * the assistant, auto-posted recurring entries), to approve or fix one by one.
 */
export default async function ReviewPage() {
  const [items, expenseCategories, incomeCategories, accounts, friends, merchants] = await Promise.all([
    getReviewItems(),
    getCategoriesForSelect('EXPENSE'),
    getCategoriesForSelect('INCOME'),
    getAccountsForSelect(),
    getFriendsForSelect(),
    getMerchantMemory('EXPENSE').catch(() => []),
  ]);

  if (!expenseCategories.success || !incomeCategories.success || !accounts.success) {
    throw new Error('Error loading the review inbox');
  }

  return (
    <ReviewClient
      initialItems={items}
      expenseCategories={expenseCategories.data || []}
      incomeCategories={incomeCategories.data || []}
      accounts={accounts.data || []}
      friends={friends.success ? friends.data : []}
      merchants={merchants}
    />
  );
}
