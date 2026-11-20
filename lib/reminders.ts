/**
 * Reminders: which upcoming entries to bring to the user's attention today.
 *
 * An entry reminds from `remindDaysBefore` days ahead of its due day until it
 * is posted or skipped. Entries without their own setting use the default;
 * entries that post themselves do not remind unless asked to.
 *
 * Three stages, each notified once (lib/push.ts): "soon" when the lead time
 * starts, "today" on the due day, "overdue" after it.
 *
 * Pure and client-safe.
 */
import { daysBetween } from '@/lib/recurringSchedule';
import { formatDay, type DayString } from '@/lib/dates';
import { formatCurrency } from '@/lib/utils';
import type { UpcomingItem } from '@/lib/recurring';

/** Days of notice for entries that have no setting of their own. */
export const DEFAULT_REMIND_DAYS = 2;
/** How far ahead the Reminders page lists what is coming. */
export const REMINDER_HORIZON_DAYS = 60;

export const REMIND_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: `Default (${DEFAULT_REMIND_DAYS} days before)` },
  { value: '0', label: 'On the day' },
  { value: '1', label: '1 day before' },
  { value: '2', label: '2 days before' },
  { value: '3', label: '3 days before' },
  { value: '5', label: '5 days before' },
  { value: '7', label: 'A week before' },
  { value: '-1', label: "Don't remind me" },
];

export type ReminderStage = 'overdue' | 'today' | 'soon';

export type Reminder = UpcomingItem & {
  stage: ReminderStage;
  /** Days from today to the due day; negative when overdue. */
  daysUntil: number;
  /** `<recurringId>:<dueDate>`: one per occurrence. */
  key: string;
};

/** Days of notice for an entry, or null when it should not remind. */
export function remindLead(item: Pick<UpcomingItem, 'remindDaysBefore' | 'autoPost'>): number | null {
  if (item.remindDaysBefore != null) return item.remindDaysBefore < 0 ? null : item.remindDaysBefore;
  return item.autoPost ? null : DEFAULT_REMIND_DAYS;
}

/** The occurrences that should be shown as reminders on `today`, most urgent first. */
export function buildReminders(upcoming: UpcomingItem[], today: DayString): Reminder[] {
  const out: Reminder[] = [];
  for (const item of upcoming) {
    // Only an entry's next occurrence can be acted on.
    if (!item.actionable) continue;
    const lead = remindLead(item);
    if (lead === null) continue;
    const daysUntil = daysBetween(today, item.dueDate);
    if (daysUntil > lead) continue;
    out.push({
      ...item,
      daysUntil,
      stage: daysUntil < 0 ? 'overdue' : daysUntil === 0 ? 'today' : 'soon',
      key: `${item.recurringId}:${item.dueDate}`,
    });
  }
  return out.sort((a, b) =>
    a.dueDate !== b.dueDate ? (a.dueDate < b.dueDate ? -1 : 1) : a.name.localeCompare(b.name)
  );
}

export function dueLabel(dueDate: DayString, today: DayString): string {
  const diff = daysBetween(today, dueDate);
  if (diff === 0) return 'Due today';
  if (diff === 1) return 'Due tomorrow';
  if (diff < 0) return `Overdue · ${formatDay(dueDate, { month: 'short', day: 'numeric' })}`;
  if (diff < 7) return `Due ${formatDay(dueDate, { weekday: 'long' })}`;
  return `Due ${formatDay(dueDate, { month: 'short', day: 'numeric' })}`;
}

/** "Pay", "Receive" or "Move": what the user does about it. */
export function reminderVerb(item: Pick<UpcomingItem, 'kind'>): string {
  return item.kind === 'INCOME' ? 'Expect' : item.kind === 'TRANSFER' ? 'Move' : 'Pay';
}

/** One line saying what is owed to whom: "Pay Fuad $416.67 for Camera". */
export function reminderSentence(item: UpcomingItem): string {
  const amount = formatCurrency(item.amount);
  if (item.kind === 'INCOME') return `Expect ${amount} from ${item.name}`;
  if (item.kind === 'TRANSFER') return `Move ${amount}: ${item.name}`;
  if (item.friendName) return `Pay ${item.friendName} ${amount} for ${item.name}`;
  return `Pay ${amount} for ${item.name}`;
}

/** "payment 4 of 36 · $13,750.00 left after this" for an installment plan. */
export function planLine(item: Pick<UpcomingItem, 'plan' | 'amount'>): string | null {
  const plan = item.plan;
  if (!plan) return null;
  const after = Math.max(0, Math.round((plan.remaining - item.amount) * 100) / 100);
  if (after === 0) return 'Last payment';
  return `${formatCurrency(after)} left after this · ${plan.paymentsLeft - 1} more payment${
    plan.paymentsLeft - 1 === 1 ? '' : 's'
  }`;
}

/** Title and body of the notification for a reminder. */
export function reminderNotification(reminder: Reminder): { title: string; body: string } {
  const when =
    reminder.stage === 'overdue'
      ? `Overdue since ${formatDay(reminder.dueDate, { month: 'short', day: 'numeric' })}`
      : reminder.stage === 'today'
      ? 'Due today'
      : reminder.daysUntil === 1
      ? 'Due tomorrow'
      : `Due in ${reminder.daysUntil} days (${formatDay(reminder.dueDate, {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
        })})`;
  const details = [
    reminderSentence(reminder),
    reminder.accountName && reminder.kind !== 'INCOME' ? `from ${reminder.accountName}` : null,
  ]
    .filter(Boolean)
    .join(' ');
  const plan = planLine(reminder);
  return { title: `${when}: ${reminder.name}`, body: plan ? `${details}. ${plan}.` : `${details}.` };
}
