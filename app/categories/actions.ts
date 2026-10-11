'use server';

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

const categorySchema = z.object({
  name: z.string().min(1, 'Name is required'),
  type: z.enum(['INCOME', 'EXPENSE']),
  color: z.string().optional(),
  icon: z.string().optional(),
  subcategories: z.array(z.string().min(1).max(50)).optional(),
});

function parseSubcategories(formData: FormData): string[] {
  const raw = formData.getAll('subcategories') as string[];
  const names = raw
    .map((name) => name.trim())
    .filter(Boolean);

  // Deduplicate case-insensitively while preserving first casing
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const name of names) {
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(name);
  }
  return unique;
}

export async function getCategories() {
  try {
    const categories = await prisma.category.findMany({
      orderBy: { name: 'asc' },
      include: {
        subcategories: {
          orderBy: { name: 'asc' },
        },
        _count: {
          select: { transactions: true },
        },
      },
    });
    return { success: true, data: categories };
  } catch (error) {
    console.error('Error fetching categories:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: `Failed to fetch categories: ${errorMessage}` };
  }
}

export async function createCategory(formData: FormData) {
  try {
    const subcategoryNames = parseSubcategories(formData);
    const data = {
      name: formData.get('name') as string,
      type: formData.get('type') as 'INCOME' | 'EXPENSE',
      color: formData.get('color') as string,
      icon: formData.get('icon') as string,
      subcategories: subcategoryNames,
    };

    const validated = categorySchema.parse(data);

    await prisma.category.create({
      data: {
        name: validated.name,
        type: validated.type,
        color: validated.color || '#6B7280',
        icon: validated.icon,
        subcategories: validated.subcategories?.length
          ? {
              create: validated.subcategories.map((name) => ({ name })),
            }
          : undefined,
      },
    });

    revalidatePath('/categories');
    revalidatePath('/expenses');
    revalidatePath('/income');
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
    const subcategoryNames = parseSubcategories(formData);
    const data = {
      name: formData.get('name') as string,
      type: formData.get('type') as 'INCOME' | 'EXPENSE',
      color: formData.get('color') as string,
      icon: formData.get('icon') as string,
      subcategories: subcategoryNames,
    };

    const validated = categorySchema.parse(data);

    const existing = await prisma.subcategory.findMany({
      where: { categoryId: id },
      select: { id: true, name: true },
    });

    const desiredByKey = new Map(
      (validated.subcategories || []).map((name) => [name.toLowerCase(), name])
    );
    const existingByKey = new Map(
      existing.map((sub) => [sub.name.toLowerCase(), sub])
    );

    const toCreate = [...desiredByKey.entries()]
      .filter(([key]) => !existingByKey.has(key))
      .map(([, name]) => name);

    const toDelete = existing.filter(
      (sub) => !desiredByKey.has(sub.name.toLowerCase())
    );

    // Rename casing-only changes in place
    const toRename = existing.filter((sub) => {
      const desired = desiredByKey.get(sub.name.toLowerCase());
      return desired !== undefined && desired !== sub.name;
    });

    await prisma.$transaction(async (tx) => {
      await tx.category.update({
        where: { id },
        data: {
          name: validated.name,
          type: validated.type,
          color: validated.color || '#6B7280',
          icon: validated.icon,
        },
      });

      if (toDelete.length > 0) {
        const deleteIds = toDelete.map((s) => s.id);
        await tx.transaction.updateMany({
          where: { subcategoryId: { in: deleteIds } },
          data: { subcategoryId: null },
        });
        await tx.subcategory.deleteMany({
          where: { id: { in: deleteIds } },
        });
      }

      for (const sub of toRename) {
        const newName = desiredByKey.get(sub.name.toLowerCase())!;
        await tx.subcategory.update({
          where: { id: sub.id },
          data: { name: newName },
        });
      }

      if (toCreate.length > 0) {
        await tx.subcategory.createMany({
          data: toCreate.map((name) => ({ name, categoryId: id })),
        });
      }
    });

    revalidatePath('/categories');
    revalidatePath('/expenses');
    revalidatePath('/income');
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

    // Subcategories cascade via schema relation
    await prisma.category.delete({
      where: { id },
    });

    revalidatePath('/categories');
    revalidatePath('/expenses');
    revalidatePath('/income');
    return { success: true };
  } catch (error) {
    console.error('Error deleting category:', error);
    return { success: false, error: 'Failed to delete category' };
  }
}
