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

export async function getIncome(filters?: {
  startDate?: string;
  endDate?: string;
  categoryId?: string;
  subcategoryId?: string;
  search?: string;
}) {
  try {
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

    const shared = {
      date: new Date(validated.date),
      kind: 'INCOME' as const,
      categoryId: validated.categoryId,
      subcategoryId: subResult.subcategoryId,
      merchantOrSource: validated.merchantOrSource,
      notes: validated.notes,
      tags: validated.tags || [],
    };

    if (splitResult.splits.length === 1) {
      await prisma.transaction.create({
        data: {
          ...shared,
          amount: splitResult.splits[0].amount,
          accountId: splitResult.splits[0].accountId,
        },
      });
    } else {
      await prisma.transaction.createMany({
        data: splitResult.splits.map((split) => ({
          ...shared,
          amount: split.amount,
          accountId: split.accountId,
        })),
      });
    }

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

    const shared = {
      date: new Date(validated.date),
      kind: 'INCOME' as const,
      categoryId: validated.categoryId,
      subcategoryId: subResult.subcategoryId,
      merchantOrSource: validated.merchantOrSource,
      notes: validated.notes,
      tags: validated.tags || [],
    };

    const [first, ...rest] = splitResult.splits;

    await prisma.transaction.update({
      where: { id },
      data: {
        ...shared,
        amount: first.amount,
        accountId: first.accountId,
      },
    });

    if (rest.length > 0) {
      await prisma.transaction.createMany({
        data: rest.map((split) => ({
          ...shared,
          amount: split.amount,
          accountId: split.accountId,
        })),
      });
    }

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

export async function deleteIncome(id: string) {
  try {
    await prisma.transaction.delete({
      where: { id },
    });

    revalidatePath('/income');
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
