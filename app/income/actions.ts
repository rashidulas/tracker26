'use server';

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

const incomeSchema = z.object({
  date: z.string().min(1, 'Date is required'),
  amount: z.number().positive('Amount must be positive'),
  categoryId: z.string().min(1, 'Category is required'),
  subcategoryId: z.string().optional(),
  accountId: z.string().optional(),
  merchantOrSource: z.string().optional(),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

const accountSplitSchema = z.object({
  accountId: z.string().min(1, 'Account is required'),
  amount: z.number().positive('Split amount must be positive'),
});

function cents(n: number) {
  return Math.round(n * 100);
}

function parseAccountSplits(
  formData: FormData,
  totalAmount: number
): { ok: true; splits: Array<{ accountId: string; amount: number }> } | { ok: false; error: string } {
  const raw = formData.get('accountSplits') as string | null;

  let splits: Array<{ accountId: string; amount: number }> = [];

  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        return { ok: false, error: 'At least one account is required' };
      }
      splits = parsed.map((item) => ({
        accountId: String(item.accountId || ''),
        amount: parseFloat(String(item.amount)),
      }));
    } catch {
      return { ok: false, error: 'Invalid account splits' };
    }
  } else {
    const accountId = (formData.get('accountId') as string) || '';
    splits = [{ accountId, amount: totalAmount }];
  }

  for (const split of splits) {
    const result = accountSplitSchema.safeParse(split);
    if (!result.success) {
      return { ok: false, error: result.error.errors[0].message };
    }
  }

  const accountIds = splits.map((s) => s.accountId);
  if (new Set(accountIds).size !== accountIds.length) {
    return { ok: false, error: 'Each split must use a different account' };
  }

  const splitTotal = splits.reduce((sum, s) => sum + s.amount, 0);
  if (cents(splitTotal) !== cents(totalAmount)) {
    return {
      ok: false,
      error: `Account amounts ($${splitTotal.toFixed(2)}) must equal total ($${totalAmount.toFixed(2)})`,
    };
  }

  return { ok: true, splits };
}

async function resolveSubcategoryId(
  categoryId: string,
  subcategoryId?: string
): Promise<{ ok: true; subcategoryId: string | null } | { ok: false; error: string }> {
  if (!subcategoryId) return { ok: true, subcategoryId: null };

  const sub = await prisma.subcategory.findFirst({
    where: { id: subcategoryId, categoryId },
    select: { id: true },
  });

  if (!sub) {
    return { ok: false, error: 'Subcategory does not belong to the selected category' };
  }

  return { ok: true, subcategoryId: sub.id };
}

function incomeFingerprint(item: {
  date: Date;
  categoryId: string | null;
  subcategoryId?: string | null;
  merchantOrSource: string | null;
  notes: string | null;
  tags: string[];
}) {
  return [
    new Date(item.date).toISOString().slice(0, 10),
    item.categoryId || '',
    item.subcategoryId || '',
    item.merchantOrSource || '',
    item.notes || '',
    [...(item.tags || [])].map((t) => t.toLowerCase()).sort().join(','),
  ].join('|');
}

/** Merge old multi-row income splits into one transaction with accountSplits. */
async function consolidateLegacyIncomeSplits() {
  const legacy = await prisma.transaction.findMany({
    where: { kind: 'INCOME' },
    select: {
      id: true,
      date: true,
      amount: true,
      categoryId: true,
      subcategoryId: true,
      accountId: true,
      merchantOrSource: true,
      notes: true,
      tags: true,
      splitGroupId: true,
      accountSplits: true,
    },
  });

  const candidates = legacy.filter(
    (t) => (!t.accountSplits || t.accountSplits.length === 0) && t.accountId
  );

  const byKey = new Map<string, typeof candidates>();
  for (const item of candidates) {
    const key = item.splitGroupId
      ? `group:${item.splitGroupId}`
      : `fp:${incomeFingerprint(item)}`;
    const list = byKey.get(key) || [];
    list.push(item);
    byKey.set(key, list);
  }

  for (const members of byKey.values()) {
    const accounts = new Set(members.map((m) => m.accountId).filter(Boolean));
    if (members.length < 2 || accounts.size < 2) continue;

    const sorted = [...members].sort((a, b) => b.amount - a.amount);
    const primary = sorted[0];
    const total = sorted.reduce((sum, m) => sum + m.amount, 0);
    const splits = sorted.map((m) => ({
      accountId: m.accountId as string,
      amount: m.amount,
    }));

    await prisma.transaction.update({
      where: { id: primary.id },
      data: {
        amount: total,
        accountId: primary.accountId,
        accountSplits: splits,
        splitGroupId: null,
      },
    });

    const siblingIds = sorted.slice(1).map((m) => m.id);
    if (siblingIds.length > 0) {
      await prisma.transaction.deleteMany({
        where: { id: { in: siblingIds }, kind: 'INCOME' },
      });
    }
  }
}

export async function getIncome(filters?: {
  startDate?: string;
  endDate?: string;
  categoryId?: string;
  subcategoryId?: string;
  search?: string;
}) {
  try {
    await consolidateLegacyIncomeSplits();

    const where: any = { kind: 'INCOME' };

    if (filters?.startDate || filters?.endDate) {
      where.date = {};
      if (filters.startDate) where.date.gte = new Date(filters.startDate);
      if (filters.endDate) where.date.lte = new Date(filters.endDate);
    }

    if (filters?.categoryId) {
      where.categoryId = filters.categoryId;
    }

    if (filters?.subcategoryId) {
      where.subcategoryId = filters.subcategoryId;
    }

    if (filters?.search) {
      where.OR = [
        { merchantOrSource: { contains: filters.search, mode: 'insensitive' } },
        { notes: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const income = await prisma.transaction.findMany({
      where,
      include: {
        category: true,
        subcategory: true,
        account: true,
      },
      orderBy: { date: 'desc' },
    });

    return { success: true, data: income };
  } catch (error) {
    console.error('Error fetching income:', error);
    return { success: false, error: 'Failed to fetch income' };
  }
}

export async function createIncome(formData: FormData) {
  try {
    const tags = formData.get('tags') as string;
    const rawSubcategoryId = (formData.get('subcategoryId') as string) || '';
    const amount = parseFloat(formData.get('amount') as string);
    const data = {
      date: formData.get('date') as string,
      amount,
      categoryId: formData.get('categoryId') as string,
      subcategoryId: rawSubcategoryId || undefined,
      merchantOrSource: formData.get('merchantOrSource') as string,
      notes: formData.get('notes') as string,
      tags: tags ? tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
    };

    const validated = incomeSchema.parse(data);
    const subResult = await resolveSubcategoryId(
      validated.categoryId,
      validated.subcategoryId
    );
    if (!subResult.ok) return { success: false, error: subResult.error };

    const splitResult = parseAccountSplits(formData, validated.amount);
    if (!splitResult.ok) return { success: false, error: splitResult.error };

    const multi = splitResult.splits.length > 1;
    const primary = splitResult.splits[0];

    await prisma.transaction.create({
      data: {
        date: new Date(validated.date),
        amount: validated.amount,
        kind: 'INCOME',
        categoryId: validated.categoryId,
        subcategoryId: subResult.subcategoryId,
        accountId: primary.accountId,
        merchantOrSource: validated.merchantOrSource,
        notes: validated.notes,
        tags: validated.tags || [],
        accountSplits: multi ? splitResult.splits : [],
        splitGroupId: null,
      },
    });

    revalidatePath('/income');
    revalidatePath('/dashboard');
    revalidatePath('/accounts');
    return { success: true };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error: error.errors[0].message };
    }
    console.error('Error creating income:', error);
    return { success: false, error: 'Failed to create income' };
  }
}

export async function updateIncome(id: string, formData: FormData) {
  try {
    const tags = formData.get('tags') as string;
    const rawSubcategoryId = (formData.get('subcategoryId') as string) || '';
    const amount = parseFloat(formData.get('amount') as string);
    const data = {
      date: formData.get('date') as string,
      amount,
      categoryId: formData.get('categoryId') as string,
      subcategoryId: rawSubcategoryId || undefined,
      merchantOrSource: formData.get('merchantOrSource') as string,
      notes: formData.get('notes') as string,
      tags: tags ? tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
    };

    const validated = incomeSchema.parse(data);
    const subResult = await resolveSubcategoryId(
      validated.categoryId,
      validated.subcategoryId
    );
    if (!subResult.ok) return { success: false, error: subResult.error };

    const splitResult = parseAccountSplits(formData, validated.amount);
    if (!splitResult.ok) return { success: false, error: splitResult.error };

    const existing = await prisma.transaction.findUnique({ where: { id } });
    if (!existing || existing.kind !== 'INCOME') {
      return { success: false, error: 'Income not found' };
    }

    // Legacy multi-row splits: drop sibling rows, keep one real transaction
    let keepId = id;
    const memberIdsRaw = formData.get('memberIds') as string | null;
    let siblingIds: string[] = [];
    if (memberIdsRaw) {
      try {
        const parsed = JSON.parse(memberIdsRaw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          siblingIds = parsed.map(String).filter((memberId) => memberId !== id);
        }
      } catch {
        // ignore
      }
    } else if (existing.splitGroupId) {
      const members = await prisma.transaction.findMany({
        where: { splitGroupId: existing.splitGroupId, kind: 'INCOME' },
        select: { id: true },
      });
      siblingIds = members.map((m) => m.id).filter((memberId) => memberId !== id);
    }

    if (siblingIds.length > 0) {
      await prisma.transaction.deleteMany({
        where: { id: { in: siblingIds }, kind: 'INCOME' },
      });
    }

    const multi = splitResult.splits.length > 1;
    const primary = splitResult.splits[0];

    await prisma.transaction.update({
      where: { id: keepId },
      data: {
        date: new Date(validated.date),
        amount: validated.amount,
        kind: 'INCOME',
        categoryId: validated.categoryId,
        subcategoryId: subResult.subcategoryId,
        accountId: primary.accountId,
        merchantOrSource: validated.merchantOrSource,
        notes: validated.notes,
        tags: validated.tags || [],
        accountSplits: multi ? splitResult.splits : [],
        splitGroupId: null,
      },
    });

    revalidatePath('/income');
    revalidatePath('/dashboard');
    revalidatePath('/accounts');
    return { success: true };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error: error.errors[0].message };
    }
    console.error('Error updating income:', error);
    return { success: false, error: 'Failed to update income' };
  }
}

export async function deleteIncome(id: string, memberIds?: string[]) {
  try {
    if (memberIds && memberIds.length > 1) {
      await prisma.transaction.deleteMany({
        where: { id: { in: memberIds }, kind: 'INCOME' },
      });
    } else {
      const existing = await prisma.transaction.findUnique({ where: { id } });
      if (!existing) {
        return { success: false, error: 'Income not found' };
      }
      if (existing.splitGroupId) {
        await prisma.transaction.deleteMany({
          where: { splitGroupId: existing.splitGroupId, kind: 'INCOME' },
        });
      } else {
        await prisma.transaction.delete({ where: { id } });
      }
    }

    revalidatePath('/income');
    revalidatePath('/dashboard');
    revalidatePath('/accounts');
    return { success: true };
  } catch (error) {
    console.error('Error deleting income:', error);
    return { success: false, error: 'Failed to delete income' };
  }
}

export async function getCategoriesForSelect() {
  try {
    const categories = await prisma.category.findMany({
      where: {
        type: 'INCOME',
      },
      include: {
        subcategories: {
          orderBy: { name: 'asc' },
          select: { id: true, name: true },
        },
      },
      orderBy: { name: 'asc' },
    });
    return { success: true, data: categories };
  } catch (error) {
    return { success: false, error: 'Failed to fetch categories' };
  }
}

export async function getAccountsForSelect() {
  try {
    const accounts = await prisma.account.findMany({
      orderBy: { name: 'asc' },
    });
    return { success: true, data: accounts };
  } catch (error) {
    return { success: false, error: 'Failed to fetch accounts' };
  }
}
