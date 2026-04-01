import { getCategories } from './actions';
import CategoriesClient from './CategoriesClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function CategoriesPage() {
  const result = await getCategories();

  if (!result.success) {
    return (
      <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-400">
        Error: {result.error}
      </div>
    );
  }

  return <CategoriesClient initialCategories={result.data || []} />;
}
