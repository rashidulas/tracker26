'use client';

import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import Modal from '@/components/Modal';
import Button from '@/components/Button';
import CategoryForm from './CategoryForm';
import { deleteCategory } from './actions';
import PageHeader from '@/components/PageHeader';
import { Plus, Pencil, Trash2, Tags, ArrowDownLeft, ArrowUpRight } from 'lucide-react';

interface Subcategory {
  id: string;
  name: string;
}

interface Category {
  id: string;
  name: string;
  type: 'INCOME' | 'EXPENSE';
  color: string | null;
  icon: string | null;
  subcategories: Subcategory[];
  _count: {
    transactions: number;
  };
}

interface CategoriesClientProps {
  initialCategories: Category[];
}

const fadeUp = {
  hidden: { opacity: 0, y: 14 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      delay: i * 0.04,
      duration: 0.4,
      ease: [0.25, 0.46, 0.45, 0.94] as [number, number, number, number],
    },
  }),
};

type FilterTab = 'ALL' | 'EXPENSE' | 'INCOME';

export default function CategoriesClient({ initialCategories }: CategoriesClientProps) {
  const [categories, setCategories] = useState(initialCategories);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [filter, setFilter] = useState<FilterTab>('ALL');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const counts = useMemo(() => {
    return {
      all: categories.length,
      expense: categories.filter((c) => c.type === 'EXPENSE').length,
      income: categories.filter((c) => c.type === 'INCOME').length,
    };
  }, [categories]);

  const filtered = useMemo(() => {
    if (filter === 'ALL') return categories;
    return categories.filter((c) => c.type === filter);
  }, [categories, filter]);

  const handleSuccess = () => {
    setIsModalOpen(false);
    setEditingCategory(null);
    window.location.reload();
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
    if (!confirm('Delete this category? This cannot be undone.')) return;

    setDeleteError('');
    const result = await deleteCategory(id);

    if (result.success) {
      setCategories(categories.filter((c) => c.id !== id));
    } else {
      setDeleteError(result.error || 'Failed to delete category');
      setTimeout(() => setDeleteError(''), 5000);
    }
  };

  const tabs: { id: FilterTab; label: string; count: number }[] = [
    { id: 'ALL', label: 'All', count: counts.all },
    { id: 'EXPENSE', label: 'Expense', count: counts.expense },
    { id: 'INCOME', label: 'Income', count: counts.income },
  ];

  return (
    <div className="page-shell">
      <PageHeader
        title="Categories"
        subtitle="Shape how you track money — with optional subcategories"
        actions={
          <Button onClick={handleAdd} className="w-full sm:w-auto">
            <Plus size={18} />
            Add Category
          </Button>
        }
      />

      {deleteError && (
        <div className="mb-5 p-3.5 bg-danger-dim border border-danger/25 rounded-2xl text-danger text-sm">
          {deleteError}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-6">
        {tabs.map((tab) => {
          const active = filter === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilter(tab.id)}
              className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-full text-sm font-medium transition-all duration-200 ${
                active
                  ? 'bg-mint text-graphite shadow-[0_0_20px_-6px_var(--mint-glow)]'
                  : 'bg-graphite-surface-2/80 text-ink-secondary border border-graphite-border-subtle hover:border-graphite-border hover:text-ink'
              }`}
            >
              {tab.label}
              <span
                className={`text-xs tabular-nums ${
                  active ? 'text-graphite/70' : 'text-ink-muted'
                }`}
              >
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="panel border-dashed border-graphite-border py-16 px-6 text-center"
        >
          <div className="mx-auto w-14 h-14 rounded-2xl bg-mint-dim flex items-center justify-center mb-4">
            <Tags className="text-mint" size={24} />
          </div>
          <p className="text-ink font-medium font-display text-lg">No categories yet</p>
          <p className="text-ink-muted text-sm mt-1.5 max-w-sm mx-auto">
            Create your first category to organize spending and income.
          </p>
          <Button onClick={handleAdd} className="mt-6">
            <Plus size={18} />
            Add Category
          </Button>
        </motion.div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
          {filtered.map((category, index) => {
            const color = category.color || '#3dcea6';
            const isIncome = category.type === 'INCOME';
            return (
              <motion.article
                key={category.id}
                custom={index}
                initial="hidden"
                animate="visible"
                variants={fadeUp}
                className="group relative overflow-hidden rounded-2xl border border-graphite-border-subtle bg-graphite-surface hover:border-graphite-border hover:bg-graphite-surface-hover transition-all duration-300"
              >
                <div
                  className="absolute inset-x-0 top-0 h-1"
                  style={{ backgroundColor: color }}
                />
                <div
                  className="absolute -top-12 -right-12 w-36 h-36 rounded-full blur-3xl opacity-25 pointer-events-none"
                  style={{ backgroundColor: color }}
                />

                <div className="relative p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className="w-12 h-12 rounded-2xl flex items-center justify-center text-xl border border-white/10 shrink-0"
                        style={{ backgroundColor: `${color}22` }}
                      >
                        {category.icon || '📁'}
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-base font-semibold text-ink font-display truncate">
                          {category.name}
                        </h3>
                        <div className="flex items-center gap-2 mt-1">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${
                              isIncome
                                ? 'bg-mint-dim text-mint'
                                : 'bg-danger-dim text-danger'
                            }`}
                          >
                            {isIncome ? (
                              <ArrowUpRight size={11} />
                            ) : (
                              <ArrowDownLeft size={11} />
                            )}
                            {isIncome ? 'Income' : 'Expense'}
                          </span>
                          <span className="text-xs text-ink-muted tabular-nums">
                            {category._count.transactions} txn
                            {category._count.transactions === 1 ? '' : 's'}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => handleEdit(category)}
                        className="p-2 rounded-xl text-ink-muted hover:text-mint hover:bg-mint-dim transition-colors"
                        aria-label={`Edit ${category.name}`}
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        onClick={() => handleDelete(category.id)}
                        className="p-2 rounded-xl text-ink-muted hover:text-danger hover:bg-danger-dim transition-colors"
                        aria-label={`Delete ${category.name}`}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 pt-4 border-t border-graphite-border-subtle">
                    {category.subcategories?.length ? (
                      <div className="flex flex-wrap gap-1.5">
                        {category.subcategories.map((sub) => (
                          <span
                            key={sub.id}
                            className="px-2.5 py-1 text-xs rounded-full text-ink-secondary bg-graphite-surface-2 border border-graphite-border-subtle"
                          >
                            {sub.name}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleEdit(category)}
                        className="text-xs text-ink-muted hover:text-mint transition-colors"
                      >
                        + Add subcategories
                      </button>
                    )}
                  </div>
                </div>
              </motion.article>
            );
          })}
        </div>
      )}

      <Modal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingCategory(null);
        }}
        title={editingCategory ? 'Edit category' : 'New category'}
        description={
          editingCategory
            ? 'Update details or refine subcategories for better analytics.'
            : 'Create a category and optionally nest subcategories under it.'
        }
        footer={
          <div className="flex gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setIsModalOpen(false);
                setEditingCategory(null);
              }}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form="category-form"
              disabled={isSubmitting}
              className="flex-1"
            >
              {isSubmitting
                ? 'Saving...'
                : editingCategory
                ? 'Save changes'
                : 'Create category'}
            </Button>
          </div>
        }
      >
        <CategoryForm
          category={editingCategory || undefined}
          onSuccess={handleSuccess}
          onCancel={() => {
            setIsModalOpen(false);
            setEditingCategory(null);
          }}
          hideActions
          onSubmittingChange={setIsSubmitting}
          formId="category-form"
        />
      </Modal>
    </div>
  );
}
