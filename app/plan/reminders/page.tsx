import { getRemindersPageData } from './actions';
import RemindersClient from './RemindersClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function RemindersPage() {
  const result = await getRemindersPageData();

  if (!result.success) {
    return (
      <div role="alert" className="p-4 bg-danger-dim border border-danger/25 rounded-2xl text-danger">
        {result.error}
      </div>
    );
  }

  return <RemindersClient data={result.data} />;
}
