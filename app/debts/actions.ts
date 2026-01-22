'use server';

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

const debtSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  type: z.enum(['CREDIT_CARD', 'PERSONAL_LOAN', 'STUDENT_LOAN', 'MORTGAGE', 'AUTO_LOAN', 'OTHER']),
  currentBalance: z.number(),
  apr: z.number().optional(),
  minPayment: z.number().optional(),
  dueDay: z.number().min(1).max(31).optional(),
});

const paymentSchema = z.object({
  date: z.string().min(1, 'Date is required'),
  amount: z.number().positive('Amount must be positive'),
  debtId: z.string().min(1, 'Debt is required'),
  fromAccountId: z.string().min(1, 'Account is required'),
  notes: z.string().optional(),
});

export async function getDebts() {
  try {
    const debts = await prisma.debt.findMany({
      include: {
        payments: {
          orderBy: { date: 'desc' },
          take: 5,
        },
      },
      orderBy: { name: 'asc' },
    });
    return { success: true, data: debts };
  } catch (error) {
    console.error('Error fetching debts:', error);
    return { success: false, error: 'Failed to fetch debts' };
  }
}

export async function createDebt(formData: FormData) {
  try {
    const data = {
      name: formData.get('name') as string,
      type: formData.get('type') as any,
      currentBalance: parseFloat(formData.get('currentBalance') as string),
      apr: formData.get('apr') ? parseFloat(formData.get('apr') as string) : undefined,
      minPayment: formData.get('minPayment') ? parseFloat(formData.get('minPayment') as string) : undefined,
      dueDay: formData.get('dueDay') ? parseInt(formData.get('dueDay') as string) : undefined,
    };

    const validated = debtSchema.parse(data);
    await prisma.debt.create({ data: validated });
    revalidatePath('/debts');
    return { success: true };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error: error.errors[0].message };
    }
    return { success: false, error: 'Failed to create debt' };
  }
}

export async function updateDebt(id: string, formData: FormData) {
  try {
    const data = {
      name: formData.get('name') as string,
      type: formData.get('type') as any,
      currentBalance: parseFloat(formData.get('currentBalance') as string),
      apr: formData.get('apr') ? parseFloat(formData.get('apr') as string) : undefined,
      minPayment: formData.get('minPayment') ? parseFloat(formData.get('minPayment') as string) : undefined,
      dueDay: formData.get('dueDay') ? parseInt(formData.get('dueDay') as string) : undefined,
    };

    const validated = debtSchema.parse(data);
    await prisma.debt.update({ where: { id }, data: validated });
    revalidatePath('/debts');
    return { success: true };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error: error.errors[0].message };
    }
    return { success: false, error: 'Failed to update debt' };
  }
}

export async function deleteDebt(id: string) {
  try {
    await prisma.debt.delete({ where: { id } });
    revalidatePath('/debts');
    return { success: true };
  } catch (error) {
    return { success: false, error: 'Failed to delete debt' };
  }
}

export async function createPayment(formData: FormData) {
  try {
    const data = {
      date: formData.get('date') as string,
      amount: parseFloat(formData.get('amount') as string),
      debtId: formData.get('debtId') as string,
      fromAccountId: formData.get('fromAccountId') as string,
      notes: formData.get('notes') as string,
    };

    const validated = paymentSchema.parse(data);

    // Create payment
    await prisma.debtPayment.create({
      data: {
        ...validated,
        date: new Date(validated.date),
      },
    });

    // Update debt balance
    const debt = await prisma.debt.findUnique({ where: { id: validated.debtId } });
    if (debt) {
      await prisma.debt.update({
        where: { id: validated.debtId },
        data: { currentBalance: debt.currentBalance - validated.amount },
      });
    }

    revalidatePath('/debts');
    return { success: true };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error: error.errors[0].message };
    }
    return { success: false, error: 'Failed to create payment' };
  }
}

export async function getAccounts() {
  try {
    const accounts = await prisma.account.findMany({
      orderBy: { name: 'asc' },
    });
    return { success: true, data: accounts };
  } catch (error) {
    return { success: false, error: 'Failed to fetch accounts' };
  }
}
