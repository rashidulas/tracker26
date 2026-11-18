/**
 * Read side of recurring entries: the Upcoming list and detection
 * suggestions, loaded from the database. Server-only.
 */
import { prisma } from '@/lib/prisma';
import { addDays, parseDay, todayInAppTimeZone, type DayString } from '@/lib/dates';
import { buildUpcoming, UPCOMING_DAYS, type UpcomingItem } from '@/lib/recurring';
import { detectRecurring, type RecurringSuggestion } from '@/lib/recurringDetection';

/** How much history detection looks at: enough for two yearly charges. */
const DETECTION_DAYS = 800;

export async function loadUpcoming(today: DayString = todayInAppTimeZone()): Promise<UpcomingItem[]> {
  const entries = await prisma.recurringTransaction.findMany({
    where: { active: true, nextDueDate: { lte: parseDay(addDays(today, UPCOMING_DAYS)) } },
    include: {
      category: { select: { name: true, color: true, icon: true } },
      account: { select: { name: true } },
    },
  });
  return buildUpcoming(entries, today);
}

export async function loadSuggestions(
  today: DayString = todayInAppTimeZone()
): Promise<RecurringSuggestion[]> {
  const [transactions, existing, dismissed] = await Promise.all([
    prisma.transaction.findMany({
      where: {
        kind: { in: ['INCOME', 'EXPENSE'] },
        date: { gte: parseDay(addDays(today, -DETECTION_DAYS)) },
      },
      select: {
        id: true,
        date: true,
        amount: true,
        kind: true,
        merchantOrSource: true,
        merchantId: true,
        categoryId: true,
        subcategoryId: true,
        accountId: true,
        recurringId: true,
        splitItems: true,
      },
      orderBy: { date: 'asc' },
    }),
    prisma.recurringTransaction.findMany({
      select: { kind: true, merchantOrSource: true, amount: true, active: true },
    }),
    prisma.dismissedRecurringSuggestion.findMany({ select: { key: true } }),
  ]);
  return detectRecurring(transactions, {
    today,
    existing,
    dismissed: dismissed.map((d) => d.key),
  });
}
