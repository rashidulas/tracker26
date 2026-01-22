'use server';

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

const goalSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  targetAmount: z.number().positive('Target amount must be positive'),
  dueDate: z.string().optional(),
});

const contributionSchema = z.object({
  date: z.string().min(1, 'Date is required'),
  amount: z.number().positive('Amount must be positive'),
  goalId: z.string().min(1, 'Goal is required'),
  fromAccountId: z.string().min(1, 'Account is required'),
  notes: z.string().optional(),
});

export async function getGoals() {
  try {
    const goals = await prisma.goal.findMany({
      include: {
        contributions: {
          orderBy: { date: 'desc' },
        },
      },
      orderBy: { name: 'asc' },
    });

    const goalsWithProgress = goals.map((goal) => {
      const totalContributions = goal.contributions.reduce((sum, c) => sum + c.amount, 0);
      const progress = (totalContributions / goal.targetAmount) * 100;
      return {
        ...goal,
        totalContributions,
        progress: Math.min(progress, 100),
      };
    });

    return { success: true, data: goalsWithProgress };
  } catch (error) {
    console.error('Error fetching goals:', error);
    return { success: false, error: 'Failed to fetch goals' };
  }
}

export async function createGoal(formData: FormData) {
  try {
    const data = {
      name: formData.get('name') as string,
      targetAmount: parseFloat(formData.get('targetAmount') as string),
      dueDate: formData.get('dueDate') as string,
    };

    const validated = goalSchema.parse(data);
    await prisma.goal.create({
      data: {
        ...validated,
        dueDate: validated.dueDate ? new Date(validated.dueDate) : null,
      },
    });

    revalidatePath('/goals');
    return { success: true };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error: error.errors[0].message };
    }
    return { success: false, error: 'Failed to create goal' };
  }
}

export async function updateGoal(id: string, formData: FormData) {
  try {
    const data = {
      name: formData.get('name') as string,
      targetAmount: parseFloat(formData.get('targetAmount') as string),
      dueDate: formData.get('dueDate') as string,
    };

    const validated = goalSchema.parse(data);
    await prisma.goal.update({
      where: { id },
      data: {
        ...validated,
        dueDate: validated.dueDate ? new Date(validated.dueDate) : null,
      },
    });

    revalidatePath('/goals');
    return { success: true };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error: error.errors[0].message };
    }
    return { success: false, error: 'Failed to update goal' };
  }
}

export async function deleteGoal(id: string) {
  try {
    await prisma.goal.delete({ where: { id } });
    revalidatePath('/goals');
    return { success: true };
  } catch (error) {
    return { success: false, error: 'Failed to delete goal' };
  }
}

export async function createContribution(formData: FormData) {
  try {
    const data = {
      date: formData.get('date') as string,
      amount: parseFloat(formData.get('amount') as string),
      goalId: formData.get('goalId') as string,
      fromAccountId: formData.get('fromAccountId') as string,
      notes: formData.get('notes') as string,
    };

    const validated = contributionSchema.parse(data);
    await prisma.goalContribution.create({
      data: {
        ...validated,
        date: new Date(validated.date),
      },
    });

    revalidatePath('/goals');
    return { success: true };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error: error.errors[0].message };
    }
    return { success: false, error: 'Failed to create contribution' };
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
