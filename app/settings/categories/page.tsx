import { getCategories } from './actions';
import CategoriesClient from './CategoriesClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function CategoriesPage() {
  const result = await getCategories();

  if (!result.success) {
    return (
      <div className="page-shell">
        <div className="p-4 bg-danger-dim border border-danger/25 rounded-2xl text-danger">
          Error: {result.error}
        </div>
      </div>
    );
  }

  return <CategoriesClient initialCategories={result.data || []} />;
}
