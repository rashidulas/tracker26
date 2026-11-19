/**
 * Writes for categories and subcategories. Used by the Categories page's
 * server actions and by the chat assistant.
 *
 * The functions take a transaction client, so a category and its
 * subcategories are written together or not at all.
 *
 * Server-only.
 */
import type { Category, Prisma, Subcategory } from '@prisma/client';
import { z } from 'zod';
import { TransactionError } from '@/lib/transactions';

type Tx = Pick<Prisma.TransactionClient, 'category' | 'subcategory'>;

export const DEFAULT_CATEGORY_COLOR = '#6B7280';

export const categoryInputSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  type: z.enum(['INCOME', 'EXPENSE']),
  color: z.string().optional(),
  icon: z.string().optional(),
  subcategories: z.array(z.string().min(1).max(50)).optional(),
});

export type CategoryInput = z.input<typeof categoryInputSchema>;

const DUPLICATE_CATEGORY = 'A category with this name and type already exists';

function fail(message: string): never {
  throw new TransactionError(message);
}

const isUniqueViolation = (error: unknown) => (error as { code?: string } | null)?.code === 'P2002';

/** Trim, drop blanks and case-insensitive repeats, keeping the first spelling. */
export function uniqueSubcategoryNames(raw: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of raw) {
    const name = value.trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    unique.push(name);
  }
  return unique;
}

/** Creates a category with its subcategories. Throws ZodError on invalid input. */
export async function createCategoryIn(
  tx: Tx,
  input: CategoryInput
): Promise<Category & { subcategories: Subcategory[] }> {
  const data = categoryInputSchema.parse(input);
  // The unique index on (name, type) also guards this; checking first gives a
  // readable message inside a larger transaction.
  const clash = await tx.category.findFirst({
    where: { name: data.name, type: data.type },
    select: { id: true },
  });
  if (clash) fail(DUPLICATE_CATEGORY);
  let category: Category;
  try {
    category = await tx.category.create({
      data: {
        name: data.name,
        type: data.type,
        color: data.color || DEFAULT_CATEGORY_COLOR,
        icon: data.icon,
      },
    });
  } catch (error) {
    if (isUniqueViolation(error)) fail(DUPLICATE_CATEGORY);
    throw error;
  }
  const subcategories: Subcategory[] = [];
  for (const name of data.subcategories ?? []) {
    subcategories.push(await tx.subcategory.create({ data: { name, categoryId: category.id } }));
  }
  subcategories.sort((a, b) => a.name.localeCompare(b.name));
  return { ...category, subcategories };
}

/** Adds one subcategory to an existing category. Names are unique per category, ignoring case. */
export async function addSubcategoryIn(
  tx: Tx,
  categoryId: string,
  rawName: string
): Promise<Subcategory> {
  const name = rawName.trim();
  if (!name) fail('Subcategory name is required');
  if (name.length > 50) fail('Subcategory name is too long');
  const category = await tx.category.findUnique({
    where: { id: categoryId },
    select: { id: true, name: true },
  });
  if (!category) fail('Category not found');
  const existing = await tx.subcategory.findMany({
    where: { categoryId },
    select: { name: true },
  });
  if (existing.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
    fail(`"${category.name}" already has a subcategory called "${name}"`);
  }
  return tx.subcategory.create({ data: { name, categoryId } });
}
