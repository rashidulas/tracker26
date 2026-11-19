'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import {
  buildMerchantMemory,
  MerchantDefaultError,
  normalizeMerchantName,
  setMerchantCategoryDefaultIn,
  type MerchantMemory,
} from '@/lib/merchants';
import { applyMerchantCategory, TRANSACTION_PAGES } from '@/lib/transactions';

const objectId = /^[a-f\d]{24}$/i;

function revalidateAll() {
  for (const path of TRANSACTION_PAGES) revalidatePath(path);
}

/**
 * Merchant memory for a form of `kind`: defaults the user set, otherwise what
 * was used last time (newest first).
 */
export async function getMerchantMemory(kind: 'INCOME' | 'EXPENSE' = 'EXPENSE'): Promise<MerchantMemory[]> {
  const [merchants, recent, categories] = await Promise.all([
    prisma.merchant.findMany({
      where: {
        OR: [{ defaultCategoryId: { not: null } }, { defaultAccountId: { not: null } }],
      },
      select: {
        id: true,
        name: true,
        normalizedName: true,
        defaultCategoryId: true,
        defaultSubcategoryId: true,
        defaultAccountId: true,
      },
    }),
    prisma.transaction.findMany({
      where: { kind, merchantOrSource: { not: null } },
      select: { merchantOrSource: true, categoryId: true, subcategoryId: true, accountId: true },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 800,
    }),
    prisma.category.findMany({ select: { id: true, type: true } }),
  ]);
  const types = new Map(categories.map((c) => [c.id, c.type]));
  return buildMerchantMemory(merchants, recent, (id) => types.get(id), kind);
}

/** Defaults for one merchant name, for AI drafts and the receipt scanner. */
export async function lookupMerchant(name: string) {
  const key = normalizeMerchantName(name);
  if (!key) return null;
  return prisma.merchant.findUnique({
    where: { normalizedName: key },
    select: {
      id: true,
      name: true,
      defaultCategoryId: true,
      defaultSubcategoryId: true,
      defaultAccountId: true,
    },
  });
}

export async function getMerchantsPageData() {
  try {
    const [merchants, counts, categories, accounts] = await Promise.all([
      prisma.merchant.findMany({
        include: {
          defaultCategory: { select: { id: true, name: true, icon: true, type: true } },
          defaultSubcategory: { select: { id: true, name: true } },
          defaultAccount: { select: { id: true, name: true } },
        },
        orderBy: { name: 'asc' },
      }),
      prisma.transaction.groupBy({
        by: ['merchantId'],
        where: { merchantId: { not: null } },
        _count: { _all: true },
      }),
      prisma.category.findMany({
        select: {
          id: true,
          name: true,
          type: true,
          icon: true,
          subcategories: { orderBy: { name: 'asc' }, select: { id: true, name: true } },
        },
        orderBy: { name: 'asc' },
      }),
      prisma.account.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    ]);
    const countBy = new Map(counts.map((c) => [c.merchantId, c._count._all]));
    // Whitespace-only text has no merchant to link, so count in code.
    const unlinked = (
      await prisma.transaction.findMany({
        where: {
          kind: { in: ['INCOME', 'EXPENSE'] },
          merchantOrSource: { not: null },
          OR: [{ merchantId: null }, { merchantId: { isSet: false } }],
        },
        select: { merchantOrSource: true },
      })
    ).filter((t) => normalizeMerchantName(t.merchantOrSource)).length;
    return {
      success: true as const,
      data: {
        merchants: merchants.map((m) => ({ ...m, transactionCount: countBy.get(m.id) ?? 0 })),
        categories,
        accounts,
        unlinked,
      },
    };
  } catch (error) {
    console.error('Error loading merchants:', error);
    return { success: false as const, error: 'Failed to load merchants' };
  }
}

export type MerchantsPageData = Extract<
  Awaited<ReturnType<typeof getMerchantsPageData>>,
  { success: true }
>['data'];

/**
 * "Always use this category for <merchant>?" accepted. Saves the default and
 * says how many past transactions of that merchant would change, so the UI
 * can offer to update them too.
 */
export async function setMerchantCategoryDefault(input: {
  merchantId?: string | null;
  name?: string | null;
  categoryId: string;
  subcategoryId?: string | null;
}) {
  try {
    // The rules live in lib/merchants.ts, shared with the chat assistant.
    const saved = await prisma.$transaction((tx) => setMerchantCategoryDefaultIn(tx, input));
    revalidatePath('/settings/merchants');
    return {
      success: true as const,
      merchantId: saved.merchantId,
      merchantName: saved.merchantName,
      categoryName: saved.categoryName,
      subcategoryId: saved.subcategoryId,
      pastToUpdate: saved.pastToUpdate,
    };
  } catch (error) {
    if (error instanceof MerchantDefaultError) return { success: false as const, error: error.message };
    console.error('Error saving merchant default:', error);
    return { success: false as const, error: 'Failed to save merchant default' };
  }
}

export async function applyCategoryToPast(merchantId: string, categoryId: string, subcategoryId: string | null) {
  const result = await applyMerchantCategory(merchantId, categoryId, subcategoryId);
  return result.success
    ? { success: true as const, updated: result.data.updated }
    : { success: false as const, error: result.error };
}

/** Merchants page: set or clear every default at once. */
export async function updateMerchantDefaults(
  merchantId: string,
  input: { categoryId: string | null; subcategoryId: string | null; accountId: string | null }
) {
  try {
    if (!objectId.test(merchantId)) return { success: false as const, error: 'Merchant not found' };
    const categoryId = input.categoryId && objectId.test(input.categoryId) ? input.categoryId : null;
    const accountId = input.accountId && objectId.test(input.accountId) ? input.accountId : null;
    if (categoryId && !(await prisma.category.findUnique({ where: { id: categoryId }, select: { id: true } }))) {
      return { success: false as const, error: 'Category not found' };
    }
    if (accountId && !(await prisma.account.findUnique({ where: { id: accountId }, select: { id: true } }))) {
      return { success: false as const, error: 'Account not found' };
    }
    let subcategoryId: string | null = null;
    if (categoryId && input.subcategoryId && objectId.test(input.subcategoryId)) {
      const sub = await prisma.subcategory.findFirst({
        where: { id: input.subcategoryId, categoryId },
        select: { id: true },
      });
      subcategoryId = sub?.id ?? null;
    }
    await prisma.merchant.update({
      where: { id: merchantId },
      data: { defaultCategoryId: categoryId, defaultSubcategoryId: subcategoryId, defaultAccountId: accountId },
    });
    revalidateAll();
    return { success: true as const };
  } catch (error) {
    console.error('Error updating merchant:', error);
    return { success: false as const, error: 'Failed to update merchant' };
  }
}
