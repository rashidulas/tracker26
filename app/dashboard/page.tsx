import { getDashboardData } from './actions';
import DashboardClient from './DashboardClient';

export default async function DashboardPage() {
  const result = await getDashboardData();

  if (!result.success) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
        Error: {result.error}
      </div>
    );
  }

  return <DashboardClient data={result.data!} />;
}
