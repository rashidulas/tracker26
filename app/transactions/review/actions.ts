'use server';

import { prisma } from '@/lib/prisma';
import { markReviewed } from '@/lib/transactions';

/** Rows waiting in the review inbox, oldest first, so they are cleared in order. */
export async function getReviewItems() {
  return prisma.transaction.findMany({
    where: { needsReview: true },
    include: {
      category: true,
      subcategory: true,
      account: true,
      toAccount: true,
      friendEntries: {
        select: { id: true, amount: true, friend: { select: { id: true, name: true, color: true } } },
      },
    },
    orderBy: [{ createdAt: 'asc' }],
    take: 500,
  });
}

export async function getReviewCount(): Promise<number> {
  try {
    return await prisma.transaction.count({ where: { needsReview: true } });
  } catch (error) {
    console.error('Error counting review items:', error);
    return 0;
  }
}

/** Approve the given rows: they are correct as saved. */
export async function approveReview(ids: string[]) {
  const result = await markReviewed(ids);
  return result.success
    ? { success: true as const, count: result.data.reviewed }
    : { success: false as const, error: result.error };
}
