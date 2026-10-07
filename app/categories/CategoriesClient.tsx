'use client';

import { useState } from 'react';
import Modal from '@/components/Modal';
import Button from '@/components/Button';
import CategoryForm from './CategoryForm';
import { deleteCategory } from './actions';
import PageHeader from '@/components/PageHeader';
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
        return 'bg-mint-dim text-mint';
      case 'EXPENSE':
        return 'bg-danger-dim text-danger';
      default:
        return 'bg-info-dim text-info';
    }
  };

  return (
    <div className="page-shell">
      <PageHeader
        title="Categories"
        subtitle="Organize your income and expenses"
        actions={
          <Button onClick={handleAdd} className="w-full sm:w-auto">
            <Plus size={18} />
            Add Category
          </Button>
        }
      />

      {deleteError && (
        <div className="mb-4 p-3 bg-danger-dim border border-danger/25 rounded-2xl text-danger text-sm">
          {deleteError}
        </div>
      )}

      <div className="panel shadow-panel overflow-hidden">
        <table className="min-w-full divide-y divide-graphite-border-subtle">
          <thead className="bg-graphite-surface-2/60">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-ink-muted uppercase tracking-wider">
                Category
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-ink-muted uppercase tracking-wider">
                Type
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-ink-muted uppercase tracking-wider">
                Transactions
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-ink-muted uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-graphite-border-subtle">
            {categories.map((category) => (
              <tr key={category.id} className="hover:bg-graphite-surface-hover transition-colors">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{category.icon}</span>
                    <div>
                      <div className="text-sm font-medium text-ink">
                        {category.name}
                      </div>
                      {category.color && (
                        <div className="flex items-center gap-2 mt-1">
                          <div
                            className="w-4 h-4 rounded"
                            style={{ backgroundColor: category.color }}
                          />
                          <span className="text-xs text-ink-muted">{category.color}</span>
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
                <td className="px-6 py-4 whitespace-nowrap text-sm text-ink-secondary">
                  {category._count.transactions}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  <button
                    onClick={() => handleEdit(category)}
                    className="p-1.5 rounded-lg text-ink-muted hover:text-mint hover:bg-mint-dim transition-colors mr-2"
                  >
                    <Edit2 size={18} />
                  </button>
                  <button
                    onClick={() => handleDelete(category.id)}
                    className="p-1.5 rounded-lg text-ink-muted hover:text-danger hover:bg-danger-dim transition-colors"
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
            <p className="text-ink-muted">No categories yet. Add your first category!</p>
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
