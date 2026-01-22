'use server';

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

const categorySchema = z.object({
  name: z.string().min(1, 'Name is required'),
  type: z.enum(['INCOME', 'EXPENSE', 'BOTH']),
  color: z.string().optional(),
  icon: z.string().optional(),
});

export async function getCategories() {
  try {
    const categories = await prisma.category.findMany({
      orderBy: { name: 'asc' },
      include: {
        _count: {
          select: { transactions: true },
        },
      },
    });
    return { success: true, data: categories };
  } catch (error) {
    console.error('Error fetching categories:', error);
    return { success: false, error: 'Failed to fetch categories' };
  }
}

export async function createCategory(formData: FormData) {
  try {
    const data = {
      name: formData.get('name') as string,
      type: formData.get('type') as 'INCOME' | 'EXPENSE' | 'BOTH',
      color: formData.get('color') as string,
      icon: formData.get('icon') as string,
    };

    const validated = categorySchema.parse(data);

    await prisma.category.create({
      data: validated,
    });

    revalidatePath('/categories');
    return { success: true };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error: error.errors[0].message };
    }
    console.error('Error creating category:', error);
    return { success: false, error: 'Failed to create category' };
  }
}

export async function updateCategory(id: string, formData: FormData) {
  try {
    const data = {
      name: formData.get('name') as string,
      type: formData.get('type') as 'INCOME' | 'EXPENSE' | 'BOTH',
      color: formData.get('color') as string,
      icon: formData.get('icon') as string,
    };

    const validated = categorySchema.parse(data);

    await prisma.category.update({
      where: { id },
      data: validated,
    });

    revalidatePath('/categories');
    return { success: true };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error: error.errors[0].message };
    }
    console.error('Error updating category:', error);
    return { success: false, error: 'Failed to update category' };
  }
}

export async function deleteCategory(id: string) {
  try {
    // Check if category has transactions
    const count = await prisma.transaction.count({
      where: { categoryId: id },
    });

    if (count > 0) {
      return {
        success: false,
        error: `Cannot delete category. It has ${count} transaction(s). Please reassign or delete them first.`,
      };
    }

    await prisma.category.delete({
      where: { id },
    });

    revalidatePath('/categories');
    return { success: true };
  } catch (error) {
    console.error('Error deleting category:', error);
    return { success: false, error: 'Failed to delete category' };
  }
}
