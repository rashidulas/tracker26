import { getMerchantsPageData } from './actions';
import MerchantsClient from './MerchantsClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function MerchantsPage() {
  const result = await getMerchantsPageData();

  if (!result.success) {
    return (
      <div className="page-shell">
        <div role="alert" className="p-4 bg-danger-dim border border-danger/25 rounded-2xl text-danger">
          {result.error}
        </div>
      </div>
    );
  }

  return <MerchantsClient data={result.data} />;
}
