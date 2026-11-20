import { getRecurringPageData } from './actions';
import RecurringClient, { type PlanPrefill } from './RecurringClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const one = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value)?.slice(0, 100) || undefined;

export default async function RecurringPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [result, params] = await Promise.all([getRecurringPageData(), searchParams]);

  if (!result.success) {
    return (
      <div role="alert" className="p-4 bg-danger-dim border border-danger/25 rounded-2xl text-danger">
        {result.error}
      </div>
    );
  }

  // /plan/recurring?plan=1&friend=…&total=… opens the installment form
  // (linked from the Friends page and the expense form).
  const prefill: PlanPrefill | null =
    one(params.plan) === '1'
      ? {
          friendId: one(params.friend),
          total: one(params.total),
          name: one(params.name),
          categoryId: one(params.category),
          existingDebt: one(params.debt) === 'existing',
        }
      : null;

  return <RecurringClient data={result.data} prefill={prefill} />;
}
