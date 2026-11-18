/**
 * Groups conversations for the chat sidebar: Today, Yesterday, Previous 7
 * days, Previous 30 days, then by month. Days are the user's calendar days
 * (lib/dates.ts), not the server's.
 */
import { formatDay, parseDay, todayInAppTimeZone, type DayString } from '@/lib/dates';
import type { ConversationSummary } from '@/lib/assistant/conversations';

export type ConversationGroup = { label: string; items: ConversationSummary[] };

const MS_PER_DAY = 86_400_000;

/** `list` must already be sorted newest first. */
export function groupConversations(
  list: ConversationSummary[],
  today: DayString = todayInAppTimeZone(),
  timeZone?: string
): ConversationGroup[] {
  const groups: ConversationGroup[] = [];
  for (const item of list) {
    const day = todayInAppTimeZone(new Date(item.lastMessageAt), timeZone);
    const age = Math.round((parseDay(today).getTime() - parseDay(day).getTime()) / MS_PER_DAY);
    const label =
      age <= 0
        ? 'Today'
        : age === 1
          ? 'Yesterday'
          : age <= 7
            ? 'Previous 7 days'
            : age <= 30
              ? 'Previous 30 days'
              : formatDay(day, { month: 'long', year: 'numeric' });
    const last = groups[groups.length - 1];
    if (last?.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}
