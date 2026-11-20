/**
 * Reminder notifications over Web Push.
 *
 * Needs VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY (`npx web-push
 * generate-vapid-keys`); without them notifications are simply off.
 * VAPID_SUBJECT is the contact the push services ask for: a mailto: or https:
 * address (default: the app's own address).
 *
 * Each reminder stage is sent once: a ReminderLog row keyed
 * "<recurringId>:<dueDay>:<stage>" is written when at least one device took
 * it, so a failed delivery is tried again on the next run.
 *
 * Server-only.
 */
import type { PrismaClient } from '@prisma/client';
import { reminderNotification, type Reminder } from '@/lib/reminders';

export type PushPayload = { title: string; body: string; url: string; tag: string };
export type PushTarget = { endpoint: string; p256dh: string; auth: string };
/** gone = the browser dropped the subscription; it will never work again. */
export type SendResult = 'sent' | 'gone' | 'failed';
export type PushSender = (target: PushTarget, payload: PushPayload) => Promise<SendResult>;

type PushDb = Pick<PrismaClient, 'pushSubscription' | 'reminderLog'>;

export function pushConfig(): { publicKey: string; privateKey: string; subject: string } | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return null;
  const subject =
    process.env.VAPID_SUBJECT?.trim() ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : 'https://tracker26.invalid');
  return { publicKey, privateKey, subject };
}

/** Sends one notification to one device with the web-push library. */
export const sendWebPush: PushSender = async (target, payload) => {
  const config = pushConfig();
  if (!config) return 'failed';
  const webpush = (await import('web-push')).default;
  try {
    await webpush.sendNotification(
      { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
      JSON.stringify(payload),
      {
        vapidDetails: config,
        // Worth delivering for a day; after that the next stage says more.
        TTL: 24 * 60 * 60,
        urgency: 'normal',
      }
    );
    return 'sent';
  } catch (error) {
    const status = (error as { statusCode?: number } | null)?.statusCode;
    if (status === 404 || status === 410) return 'gone';
    console.error('Push delivery failed:', status ?? error);
    return 'failed';
  }
};

/** The notification for each reminder, with the key that makes it once-only. */
export function collectReminderNotifications(
  reminders: Reminder[]
): { key: string; payload: PushPayload }[] {
  return reminders.map((reminder) => {
    const key = `${reminder.key}:${reminder.stage}`;
    return {
      key,
      payload: { ...reminderNotification(reminder), url: '/plan/reminders', tag: reminder.key },
    };
  });
}

/** Sends `payload` to every device; forgets devices that are gone. */
async function deliver(db: PushDb, send: PushSender, payloads: PushPayload[]) {
  const devices = await db.pushSubscription.findMany();
  const delivered = payloads.map(() => false);
  let removed = 0;
  for (const device of devices) {
    let gone = false;
    let sentAny = false;
    for (const [i, payload] of payloads.entries()) {
      const result = await send(device, payload);
      if (result === 'gone') {
        gone = true;
        break;
      }
      if (result === 'sent') {
        delivered[i] = true;
        sentAny = true;
      }
    }
    if (gone) {
      await db.pushSubscription.deleteMany({ where: { endpoint: device.endpoint } });
      removed += 1;
    } else if (sentAny) {
      await db.pushSubscription.updateMany({
        where: { endpoint: device.endpoint },
        data: { lastSentAt: new Date() },
      });
    }
  }
  return { devices: devices.length, delivered, removed };
}

export type ReminderRunResult = { sent: number; devices: number; removed: number };

/**
 * Notify about every reminder stage that has not been notified yet. Safe to
 * run any number of times a day.
 */
export async function runReminderNotifications(options: {
  db: PushDb;
  reminders: Reminder[];
  send?: PushSender;
}): Promise<ReminderRunResult> {
  const { db, reminders, send = sendWebPush } = options;
  if ((await db.pushSubscription.count()) === 0) return { sent: 0, devices: 0, removed: 0 };

  const all = collectReminderNotifications(reminders);
  if (all.length === 0) return { sent: 0, devices: 0, removed: 0 };
  const already = new Set(
    (
      await db.reminderLog.findMany({
        where: { key: { in: all.map((n) => n.key) } },
        select: { key: true },
      })
    ).map((row) => row.key)
  );
  const pending = all.filter((n) => !already.has(n.key));
  if (pending.length === 0) return { sent: 0, devices: 0, removed: 0 };

  const result = await deliver(db, send, pending.map((n) => n.payload));
  let sent = 0;
  for (const [i, notification] of pending.entries()) {
    if (!result.delivered[i]) continue;
    try {
      await db.reminderLog.create({ data: { key: notification.key } });
      sent += 1;
    } catch (error) {
      // P2002: another run logged it at the same moment.
      if ((error as { code?: string } | null)?.code !== 'P2002') throw error;
    }
  }
  return { sent, devices: result.devices, removed: result.removed };
}

/** A notification on demand, to check that a device receives them. */
export async function sendTestNotification(db: PushDb, send: PushSender = sendWebPush) {
  const result = await deliver(db, send, [
    {
      title: 'Tracker26 reminders are on',
      body: 'You will hear from me before a payment is due.',
      url: '/plan/reminders',
      tag: 'test',
    },
  ]);
  return { devices: result.devices, delivered: result.delivered[0], removed: result.removed };
}
