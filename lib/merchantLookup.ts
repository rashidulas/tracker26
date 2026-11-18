/**
 * Merchant defaults for AI drafts (chat assistant, receipt scanner).
 * Server-only.
 */
import { prisma } from '@/lib/prisma';
import { normalizeMerchantName } from '@/lib/merchants';

export type MerchantDefaultsInfo = {
  id: string;
  name: string;
  defaultCategory: { id: string; name: string; type: 'INCOME' | 'EXPENSE' } | null;
  defaultSubcategoryId: string | null;
  defaultAccount: { id: string; name: string } | null;
};

const select = {
  id: true,
  name: true,
  defaultSubcategoryId: true,
  defaultCategory: { select: { id: true, name: true, type: true } },
  defaultAccount: { select: { id: true, name: true } },
} as const;

export async function findMerchantDefaults(name: string | null | undefined): Promise<MerchantDefaultsInfo | null> {
  const key = normalizeMerchantName(name);
  if (!key) return null;
  return prisma.merchant.findUnique({ where: { normalizedName: key }, select });
}

/** Merchants with a default, for the assistant's system prompt. */
export async function listMerchantDefaults(limit = 150): Promise<MerchantDefaultsInfo[]> {
  return prisma.merchant.findMany({
    where: { OR: [{ defaultCategoryId: { not: null } }, { defaultAccountId: { not: null } }] },
    select,
    orderBy: { updatedAt: 'desc' },
    take: limit,
  });
}
