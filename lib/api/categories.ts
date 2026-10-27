import type { CategoryType } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { categoryInclude, toCategoryDTO, type CategoryDTO } from './dto';
import { ApiError, notFound, optionalString, requiredString } from './http';

export const DEFAULT_CATEGORY_COLOR = '#6B7280';

/** Trim, drop empties, dedupe case-insensitively keeping first casing (same as web). */
function normalizeSubcategories(names: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(name);
  }
  return unique;
}

export const categoryBodySchema = z.object({
  name: requiredString('Name'),
  type: z.enum(['INCOME', 'EXPENSE']),
  color: optionalString().transform((v) => v ?? DEFAULT_CATEGORY_COLOR),
  icon: optionalString(),
  subcategories: z
    .array(z.string().max(50, 'Subcategory names must be at most 50 characters'))
    .nullable()
    .optional()
    .transform((v) => normalizeSubcategories(v ?? [])),
});

export type CategoryBody = z.output<typeof categoryBodySchema>;

export async function listCategories(type?: CategoryType): Promise<CategoryDTO[]> {
  const categories = await prisma.category.findMany({
    where: type ? { type } : undefined,
    orderBy: { name: 'asc' },
    include: categoryInclude,
  });
  return categories.map(toCategoryDTO);
}

export async function getCategoryDTO(id: string): Promise<CategoryDTO> {
  const category = await prisma.category.findUnique({ where: { id }, include: categoryInclude });
  if (!category) notFound('Category');
  return toCategoryDTO(category);
}

export async function createCategory(body: CategoryBody): Promise<CategoryDTO> {
  const category = await prisma.category.create({
    data: {
      name: body.name,
      type: body.type,
      color: body.color,
      icon: body.icon,
      subcategories: body.subcategories.length
        ? { create: body.subcategories.map((name) => ({ name })) }
        : undefined,
    },
    include: categoryInclude,
  });
  return toCategoryDTO(category);
}

/** Mirrors `updateCategory` in app/categories/actions.ts (subcategory diff). */
export async function updateCategory(id: string, body: CategoryBody): Promise<CategoryDTO> {
  const exists = await prisma.category.findUnique({ where: { id }, select: { id: true } });
  if (!exists) notFound('Category');

  const existing = await prisma.subcategory.findMany({
    where: { categoryId: id },
    select: { id: true, name: true },
  });

  const desiredByKey = new Map(body.subcategories.map((name) => [name.toLowerCase(), name]));
  const existingByKey = new Map(existing.map((sub) => [sub.name.toLowerCase(), sub]));

  const toCreate = [...desiredByKey.entries()]
    .filter(([key]) => !existingByKey.has(key))
    .map(([, name]) => name);
  const toDelete = existing.filter((sub) => !desiredByKey.has(sub.name.toLowerCase()));
  const toRename = existing.filter((sub) => {
    const desired = desiredByKey.get(sub.name.toLowerCase());
    return desired !== undefined && desired !== sub.name;
  });

  await prisma.$transaction(async (tx) => {
    await tx.category.update({
      where: { id },
      data: { name: body.name, type: body.type, color: body.color, icon: body.icon },
    });

    if (toDelete.length > 0) {
      const deleteIds = toDelete.map((s) => s.id);
      await tx.transaction.updateMany({
        where: { subcategoryId: { in: deleteIds } },
        data: { subcategoryId: null },
      });
      await tx.subcategory.deleteMany({ where: { id: { in: deleteIds } } });
    }

    for (const sub of toRename) {
      await tx.subcategory.update({
        where: { id: sub.id },
        data: { name: desiredByKey.get(sub.name.toLowerCase())! },
      });
    }

    if (toCreate.length > 0) {
      await tx.subcategory.createMany({
        data: toCreate.map((name) => ({ name, categoryId: id })),
      });
    }
  });

  return getCategoryDTO(id);
}

export async function deleteCategory(id: string) {
  const exists = await prisma.category.findUnique({ where: { id }, select: { id: true } });
  if (!exists) notFound('Category');

  const count = await prisma.transaction.count({ where: { categoryId: id } });
  if (count > 0) {
    throw new ApiError(
      `Cannot delete category. It has ${count} transaction(s). Please reassign or delete them first.`,
      409
    );
  }

  await prisma.category.delete({ where: { id } });
}

/** Throws 400 unless the category exists (and matches `type` when given). */
export async function assertCategory(id: string, type?: CategoryType) {
  const category = await prisma.category.findUnique({ where: { id }, select: { type: true } });
  if (!category) throw new ApiError('Category not found', 400);
  if (type && category.type !== type) {
    throw new ApiError(
      type === 'INCOME'
        ? 'That category is not an income category'
        : 'That category is not an expense category',
      400
    );
  }
}

/** Same rule as web `resolveSubcategoryId`: subcategory must belong to the category. */
export async function resolveSubcategoryId(
  categoryId: string,
  subcategoryId: string | null
): Promise<string | null> {
  if (!subcategoryId) return null;
  const sub = await prisma.subcategory.findFirst({
    where: { id: subcategoryId, categoryId },
    select: { id: true },
  });
  if (!sub) throw new ApiError('Subcategory does not belong to the selected category', 400);
  return sub.id;
}
