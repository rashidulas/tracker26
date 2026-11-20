'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import {
  createRecurring,
  deleteRecurring,
  paidByRecurring,
  planProgress,
  postRecurringNow,
  runDueRecurring,
  setRecurringActive,
  skipRecurring,
  updateRecurring,
  type RecurringInput,
} from '@/lib/recurring';
import { loadSuggestions, loadUpcoming } from '@/lib/recurringQueries';
import { todayInAppTimeZone, toDayString } from '@/lib/dates';
import { requireSession } from '@/lib/auth/session';

export async function getRecurringPageData() {
  await requireSession();
  try {
    const today = todayInAppTimeZone();
    const [entries, suggestions, upcoming, categories, accounts, friends] = await Promise.all([
      prisma.recurringTransaction.findMany({
        include: {
          category: { select: { id: true, name: true, color: true, icon: true } },
          subcategory: { select: { id: true, name: true } },
          account: { select: { id: true, name: true } },
          toAccount: { select: { id: true, name: true } },
          friend: { select: { id: true, name: true, color: true } },
        },
        orderBy: [{ active: 'desc' }, { nextDueDate: 'asc' }],
      }),
      loadSuggestions(today),
      loadUpcoming(today),
      prisma.category.findMany({
        select: {
          id: true,
          name: true,
          type: true,
          icon: true,
          color: true,
          subcategories: { orderBy: { name: 'asc' }, select: { id: true, name: true } },
        },
        orderBy: { name: 'asc' },
      }),
      prisma.account.findMany({
        select: { id: true, name: true, type: true },
        orderBy: { name: 'asc' },
      }),
      prisma.friend.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    ]);
    const paid = await paidByRecurring(
      prisma,
      entries.filter((e) => e.totalAmount != null).map((e) => e.id)
    );

    return {
      success: true as const,
      data: {
        today,
        entries: entries.map((e) => ({
          ...e,
          startDate: toDayString(e.startDate),
          nextDueDate: toDayString(e.nextDueDate),
          endDate: e.endDate ? toDayString(e.endDate) : null,
          /** Installment plans: paid so far, what is left and how many payments. */
          plan:
            e.totalAmount != null
              ? planProgress(e.totalAmount, paid.get(e.id) ?? 0, e.amount)
              : null,
        })),
        suggestions,
        upcoming,
        categories,
        accounts,
        friends,
      },
    };
  } catch (error) {
    console.error('Error loading recurring entries:', error);
    return { success: false as const, error: 'Failed to load recurring entries' };
  }
}

export type RecurringPageData = Extract<
  Awaited<ReturnType<typeof getRecurringPageData>>,
  { success: true }
>['data'];

function plain<T>(result: { success: true; data: T } | { success: false; error: string }) {
  return result.success ? { success: true as const } : { success: false as const, error: result.error };
}

export async function saveRecurring(id: string | null, input: RecurringInput) {
  await requireSession();
  if (id) return plain(await updateRecurring(id, input));
  const result = await createRecurring(input);
  return result.success
    ? { success: true as const, linked: result.data.linked }
    : { success: false as const, error: result.error };
}

export async function removeRecurring(id: string) {
  await requireSession();
  return plain(await deleteRecurring(id));
}

export async function toggleRecurring(id: string, active: boolean) {
  await requireSession();
  return plain(await setRecurringActive(id, active));
}

/** Post an occurrence; `amount` pays a different amount this one time. */
export async function postRecurring(id: string, dueDate: string, amount?: number) {
  await requireSession();
  const result = await postRecurringNow(
    id,
    dueDate,
    typeof amount === 'number' ? { amount } : {}
  );
  return result.success
    ? { success: true as const, completed: result.data.completed, amount: result.data.amount }
    : { success: false as const, error: result.error };
}

export async function skipRecurringOccurrence(id: string, dueDate: string) {
  await requireSession();
  return plain(await skipRecurring(id, dueDate));
}

export async function dismissSuggestion(key: string) {
  await requireSession();
  try {
    if (typeof key !== 'string' || !key || key.length > 300) {
      return { success: false as const, error: 'Invalid suggestion' };
    }
    await prisma.dismissedRecurringSuggestion.upsert({
      where: { key },
      create: { key },
      update: {},
    });
    revalidatePath('/plan/recurring');
    revalidatePath('/');
    return { success: true as const };
  } catch (error) {
    console.error('Error dismissing suggestion:', error);
    return { success: false as const, error: 'Failed to dismiss suggestion' };
  }
}

/**
 * The due check, run when the app opens (components/recurring/DueCheck.tsx).
 * Idempotent: see lib/recurring.ts.
 */
export async function runDueCheck() {
  await requireSession();
  try {
    return { success: true as const, ...(await runDueRecurring()) };
  } catch (error) {
    console.error('Recurring due check failed:', error);
    return { success: false as const, posted: 0, errors: [] };
  }
}
