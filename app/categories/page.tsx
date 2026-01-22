import { getCategories } from './actions';
import CategoriesClient from './CategoriesClient';

export default async function CategoriesPage() {
  const result = await getCategories();

  if (!result.success) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
        Error: {result.error}
      </div>
    );
  }

  return <CategoriesClient initialCategories={result.data || []} />;
}
