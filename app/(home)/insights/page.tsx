import AnalyticsClient from './AnalyticsClient';
import InsightsCharts from './InsightsCharts';
import { getInsights, type InsightsRange } from './data';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const RANGES: InsightsRange[] = ['month', '30d', '90d', 'year', 'all'];

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; view?: string }>;
}) {
  const params = await searchParams;
  const range = RANGES.includes(params.range as InsightsRange)
    ? (params.range as InsightsRange)
    : 'month';
  const result = await getInsights(range);

  return (
    <div className="space-y-10">
      {result.success ? (
        <InsightsCharts data={result.data} />
      ) : (
        <div role="alert" className="p-4 rounded-2xl border border-danger/25 bg-danger-dim text-danger">
          Couldn&apos;t load charts: {result.error}
        </div>
      )}
      <AnalyticsClient />
    </div>
  );
}
