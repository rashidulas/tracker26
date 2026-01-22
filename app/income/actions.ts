'use server';

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

const incomeSchema = z.object({
  date: z.string().min(1, 'Date is required'),
  amount: z.number().positive('Amount must be positive'),
  categoryId: z.string().min(1, 'Category is required'),
  accountId: z.string().min(1, 'Account is required'),
  merchantOrSource: z.string().optional(),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export async function getIncome(filters?: {
  startDate?: string;
  endDate?: string;
  categoryId?: string;
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
    const data = {
      date: formData.get('date') as string,
      amount: parseFloat(formData.get('amount') as string),
      categoryId: formData.get('categoryId') as string,
      accountId: formData.get('accountId') as string,
      merchantOrSource: formData.get('merchantOrSource') as string,
      notes: formData.get('notes') as string,
      tags: tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [],
    };

    const validated = incomeSchema.parse(data);

    await prisma.transaction.create({
      data: {
        ...validated,
        date: new Date(validated.date),
        kind: 'INCOME',
      },
    });

    revalidatePath('/income');
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
    const data = {
      date: formData.get('date') as string,
      amount: parseFloat(formData.get('amount') as string),
      categoryId: formData.get('categoryId') as string,
      accountId: formData.get('accountId') as string,
      merchantOrSource: formData.get('merchantOrSource') as string,
      notes: formData.get('notes') as string,
      tags: tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [],
    };

    const validated = incomeSchema.parse(data);

    await prisma.transaction.update({
      where: { id },
      data: {
        ...validated,
        date: new Date(validated.date),
        kind: 'INCOME',
      },
    });

    revalidatePath('/income');
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
