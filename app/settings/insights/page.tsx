import { getInsightSettings } from './actions';
import InsightSettingsClient from './InsightSettingsClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function InsightSettingsPage() {
  const result = await getInsightSettings();

  if (!result.success) {
    return (
      <div className="page-shell">
        <div role="alert" className="p-4 bg-danger-dim border border-danger/25 rounded-2xl text-danger">
          {result.error}
        </div>
      </div>
    );
  }

  return <InsightSettingsClient preferences={result.data} />;
}
