'use server';

import { prisma } from '@/lib/prisma';
import {
  createContribution as addContribution,
  createGoal as addGoal,
  deleteContribution as removeContribution,
  deleteGoal as removeGoal,
  updateContribution as editContribution,
  updateGoal as editGoal,
  type GoalInput,
} from '@/lib/goalLedger';
import { goalProgress } from '@/lib/goals';

export async function getGoals() {
  try {
    const goals = await prisma.goal.findMany({
      include: {
        account: { select: { id: true, name: true } },
        contributions: {
          orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
          include: { fromAccount: { select: { id: true, name: true } } },
        },
      },
      orderBy: { name: 'asc' },
    });

    return { success: true as const, data: goals.map(goalProgress) };
  } catch (error) {
    console.error('Error fetching goals:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return { success: false as const, error: `Failed to fetch goals: ${errorMessage}` };
  }
}

function goalFromForm(formData: FormData): GoalInput {
  return {
    name: (formData.get('name') as string) || '',
    targetAmount: parseFloat(formData.get('targetAmount') as string),
    dueDate: (formData.get('dueDate') as string) || null,
    accountId: (formData.get('accountId') as string) || null,
  };
}

function contributionFromForm(formData: FormData) {
  return {
    date: (formData.get('date') as string) || '',
    amount: parseFloat(formData.get('amount') as string),
    fromAccountId: (formData.get('fromAccountId') as string) || '',
    notes: (formData.get('notes') as string) || null,
  };
}

const done = <T extends { success: boolean }>(r: T) =>
  r.success ? { success: true as const } : (r as unknown as { success: false; error: string });

export async function createGoal(formData: FormData) {
  return done(await addGoal(goalFromForm(formData)));
}

export async function updateGoal(id: string, formData: FormData) {
  return done(await editGoal(id, goalFromForm(formData)));
}

export async function deleteGoal(id: string) {
  return done(await removeGoal(id));
}

export async function createContribution(formData: FormData) {
  return done(
    await addContribution({
      goalId: (formData.get('goalId') as string) || '',
      ...contributionFromForm(formData),
    })
  );
}

export async function updateContribution(id: string, formData: FormData) {
  return done(await editContribution(id, contributionFromForm(formData)));
}

export async function deleteContribution(id: string) {
  return done(await removeContribution(id));
}

export async function getAccounts() {
  try {
    const accounts = await prisma.account.findMany({
      select: { id: true, name: true, type: true },
      orderBy: { name: 'asc' },
    });
    return { success: true as const, data: accounts };
  } catch {
    return { success: false as const, error: 'Failed to fetch accounts' };
  }
}
