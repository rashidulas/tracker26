'use client';

import { useState } from 'react';
import Modal from '@/components/Modal';
import Button from '@/components/Button';
import CategoryForm from './CategoryForm';
import { deleteCategory } from './actions';
import { Plus, Edit2, Trash2 } from 'lucide-react';

interface Category {
  id: string;
  name: string;
  type: 'INCOME' | 'EXPENSE';
  color: string | null;
  icon: string | null;
  _count: {
    transactions: number;
  };
}

interface CategoriesClientProps {
  initialCategories: Category[];
}

export default function CategoriesClient({ initialCategories }: CategoriesClientProps) {
  const [categories, setCategories] = useState(initialCategories);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [deleteError, setDeleteError] = useState('');

  const handleSuccess = () => {
    setIsModalOpen(false);
    setEditingCategory(null);
    window.location.reload(); // Simple refresh to get updated data
  };

  const handleEdit = (category: Category) => {
    setEditingCategory(category);
    setIsModalOpen(true);
  };

  const handleAdd = () => {
    setEditingCategory(null);
    setIsModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this category?')) return;

    setDeleteError('');
    const result = await deleteCategory(id);

    if (result.success) {
      setCategories(categories.filter((c) => c.id !== id));
    } else {
      setDeleteError(result.error || 'Failed to delete category');
      setTimeout(() => setDeleteError(''), 5000);
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'INCOME':
        return 'bg-green-100 text-green-700';
      case 'EXPENSE':
        return 'bg-red-100 text-red-700';
      default:
        return 'bg-blue-100 text-blue-700';
    }
  };

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Categories</h1>
          <p className="text-sm sm:text-base text-gray-600 mt-1">Organize your income and expenses</p>
        </div>
        <Button onClick={handleAdd} className="w-full sm:w-auto">
          <Plus size={20} className="inline mr-2" />
          Add Category
        </Button>
      </div>

      {deleteError && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {deleteError}
        </div>
      )}

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Category
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Type
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Transactions
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {categories.map((category) => (
              <tr key={category.id} className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{category.icon}</span>
                    <div>
                      <div className="text-sm font-medium text-gray-900">
                        {category.name}
                      </div>
                      {category.color && (
                        <div className="flex items-center gap-2 mt-1">
                          <div
                            className="w-4 h-4 rounded"
                            style={{ backgroundColor: category.color }}
                          />
                          <span className="text-xs text-gray-500">{category.color}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`px-2 py-1 text-xs font-medium rounded-full ${getTypeColor(category.type)}`}>
                    {category.type}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {category._count.transactions}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  <button
                    onClick={() => handleEdit(category)}
                    className="text-blue-600 hover:text-blue-900 mr-4"
                  >
                    <Edit2 size={18} />
                  </button>
                  <button
                    onClick={() => handleDelete(category.id)}
                    className="text-red-600 hover:text-red-900"
                  >
                    <Trash2 size={18} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {categories.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-500">No categories yet. Add your first category!</p>
          </div>
        )}
      </div>

      <Modal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingCategory(null);
        }}
        title={editingCategory ? 'Edit Category' : 'Add Category'}
      >
        <CategoryForm
          category={editingCategory || undefined}
          onSuccess={handleSuccess}
          onCancel={() => {
            setIsModalOpen(false);
            setEditingCategory(null);
          }}
        />
      </Modal>
    </div>
  );
}
