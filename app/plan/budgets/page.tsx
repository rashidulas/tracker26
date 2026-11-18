import { getBudgetMonth } from './actions';
import BudgetsClient from './BudgetsClient';
import { currentMonthKey } from '@/lib/transactionList';
import { isValidMonthKey } from '@/lib/budgets';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function BudgetsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month } = await searchParams;
  const key = isValidMonthKey(month) ? month : currentMonthKey();
  const result = await getBudgetMonth(key);

  if (!result.success) {
    return (
      <div role="alert" className="p-4 bg-danger-dim border border-danger/25 rounded-2xl text-danger">
        {result.error}
      </div>
    );
  }

  return <BudgetsClient key={key} data={result.data} />;
}
