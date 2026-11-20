'use server';

import { prisma } from '@/lib/prisma';
import { requireSession } from '@/lib/auth/session';
import { todayInAppTimeZone } from '@/lib/dates';
import { loadUpcoming } from '@/lib/recurringQueries';
import { buildReminders, REMINDER_HORIZON_DAYS, type Reminder } from '@/lib/reminders';
import { pushConfig, sendTestNotification } from '@/lib/push';

/** What needs attention today: for the pop-up, the badge and the page. */
export async function getReminders(): Promise<{ today: string; reminders: Reminder[] }> {
  await requireSession();
  const today = todayInAppTimeZone();
  try {
    return { today, reminders: buildReminders(await loadUpcoming(today, REMINDER_HORIZON_DAYS), today) };
  } catch (error) {
    console.error('Error loading reminders:', error);
    return { today, reminders: [] };
  }
}

export async function getRemindersPageData() {
  await requireSession();
  try {
    const today = todayInAppTimeZone();
    const [upcoming, devices] = await Promise.all([
      loadUpcoming(today, REMINDER_HORIZON_DAYS),
      prisma.pushSubscription.findMany({
        select: { id: true, endpoint: true, label: true, createdAt: true, lastSentAt: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    const reminders = buildReminders(upcoming, today);
    const reminding = new Set(reminders.map((r) => r.key));
    return {
      success: true as const,
      data: {
        today,
        reminders,
        /** Everything else in the next 60 days, for planning. */
        later: upcoming.filter((i) => !reminding.has(`${i.recurringId}:${i.dueDate}`)),
        push: {
          /** Null when the server has no VAPID keys: notifications are off. */
          publicKey: pushConfig()?.publicKey ?? null,
          devices: devices.map((d) => ({
            id: d.id,
            endpoint: d.endpoint,
            label: d.label,
            createdAt: d.createdAt.toISOString(),
            lastSentAt: d.lastSentAt?.toISOString() ?? null,
          })),
        },
      },
    };
  } catch (error) {
    console.error('Error loading reminders:', error);
    return { success: false as const, error: 'Failed to load reminders' };
  }
}

export type RemindersPageData = Extract<
  Awaited<ReturnType<typeof getRemindersPageData>>,
  { success: true }
>['data'];

/** The push services browsers use. The server only ever posts to these. */
const PUSH_HOSTS = [
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'web.push.apple.com',
  'notify.windows.com',
];

function validEndpoint(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 1000) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      PUSH_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))
    );
  } catch {
    return false;
  }
}

const validKey = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_\-+/=]{8,300}$/.test(value);

/** Remember this browser's push subscription so reminders can reach it. */
export async function savePushSubscription(input: {
  endpoint: string;
  p256dh: string;
  auth: string;
  label?: string;
}) {
  await requireSession();
  if (!pushConfig()) return { success: false as const, error: 'Notifications are not set up on the server' };
  if (!validEndpoint(input?.endpoint) || !validKey(input.p256dh) || !validKey(input.auth)) {
    return { success: false as const, error: 'This browser sent a subscription the app cannot use' };
  }
  const label = typeof input.label === 'string' ? input.label.trim().slice(0, 60) || null : null;
  try {
    await prisma.pushSubscription.upsert({
      where: { endpoint: input.endpoint },
      create: { endpoint: input.endpoint, p256dh: input.p256dh, auth: input.auth, label },
      update: { p256dh: input.p256dh, auth: input.auth, label },
    });
    return { success: true as const };
  } catch (error) {
    console.error('Error saving push subscription:', error);
    return { success: false as const, error: 'Could not turn notifications on' };
  }
}

export async function removePushSubscription(endpoint: string) {
  await requireSession();
  try {
    if (typeof endpoint !== 'string' || !endpoint) return { success: false as const, error: 'Unknown device' };
    await prisma.pushSubscription.deleteMany({ where: { endpoint } });
    return { success: true as const };
  } catch (error) {
    console.error('Error removing push subscription:', error);
    return { success: false as const, error: 'Could not turn notifications off' };
  }
}

export async function sendTestPush() {
  await requireSession();
  if (!pushConfig()) return { success: false as const, error: 'Notifications are not set up on the server' };
  try {
    const result = await sendTestNotification(prisma);
    if (result.devices === 0) return { success: false as const, error: 'No device has notifications turned on' };
    if (!result.delivered) return { success: false as const, error: 'The push service did not accept the notification' };
    return { success: true as const };
  } catch (error) {
    console.error('Error sending test notification:', error);
    return { success: false as const, error: 'Could not send a test notification' };
  }
}
