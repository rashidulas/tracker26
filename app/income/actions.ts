'use server';

import { prisma } from '@/lib/prisma';
import {
  createTransaction,
  deleteTransaction,
  updateTransaction,
  type IncomeInput,
} from '@/lib/transactions';

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

type FormResult = { success: true } | { success: false; error: string };

function incomeFromForm(
  formData: FormData
): { ok: true; input: IncomeInput } | { ok: false; error: string } {
  const tags = (formData.get('tags') as string) || '';
  const rawSplits = formData.get('accountSplits') as string | null;

  let accountSplits: IncomeInput['accountSplits'];
  if (rawSplits) {
    try {
      const parsed = JSON.parse(rawSplits);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        return { ok: false, error: 'At least one account is required' };
      }
      accountSplits = parsed.map((item) => ({
        accountId: String(item?.accountId || ''),
        amount: parseFloat(String(item?.amount)),
      }));
    } catch {
      return { ok: false, error: 'Invalid account splits' };
    }
  }

  return {
    ok: true,
    input: {
      kind: 'INCOME',
      date: (formData.get('date') as string) || '',
      amount: parseFloat(formData.get('amount') as string),
      categoryId: (formData.get('categoryId') as string) || null,
      subcategoryId: (formData.get('subcategoryId') as string) || null,
      accountId: (formData.get('accountId') as string) || null,
      accountSplits,
      merchantOrSource: (formData.get('merchantOrSource') as string) ?? null,
      notes: (formData.get('notes') as string) ?? null,
      tags: tags.split(','),
    },
  };
}

function parseMemberIds(formData: FormData): string[] {
  const raw = formData.get('memberIds') as string | null;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export async function createIncome(formData: FormData): Promise<FormResult> {
  const form = incomeFromForm(formData);
  if (!form.ok) return { success: false, error: form.error };
  const result = await createTransaction(form.input);
  return result.success ? { success: true } : { success: false, error: result.error };
}

export async function updateIncome(id: string, formData: FormData): Promise<FormResult> {
  const form = incomeFromForm(formData);
  if (!form.ok) return { success: false, error: form.error };
  const result = await updateTransaction(id, form.input, {
    absorbLegacyIds: parseMemberIds(formData),
  });
  return result.success ? { success: true } : { success: false, error: result.error };
}

export async function deleteIncome(id: string, memberIds?: string[]): Promise<FormResult> {
  const result = await deleteTransaction(id, { legacyMemberIds: memberIds });
  return result.success ? { success: true } : { success: false, error: result.error };
}
