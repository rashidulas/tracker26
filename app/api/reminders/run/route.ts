import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { todayInAppTimeZone } from '@/lib/dates';
import { runDueRecurring } from '@/lib/recurring';
import { loadUpcoming } from '@/lib/recurringQueries';
import { buildReminders, REMINDER_HORIZON_DAYS } from '@/lib/reminders';
import { pushConfig, runReminderNotifications } from '@/lib/push';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * The daily cron (vercel.json): posts auto-post entries that are due, then
 * sends a notification for every reminder that has not been notified yet.
 * Both steps are idempotent, so any schedule is safe.
 *
 * Requires CRON_SECRET, sent as `Authorization: Bearer <CRON_SECRET>` (what
 * Vercel Cron sends). Without CRON_SECRET configured the route is disabled.
 */
function authorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get('authorization') ?? '';
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

async function handle(request: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Set CRON_SECRET to enable this route.' }, { status: 503 });
  }
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const today = todayInAppTimeZone();
    const posted = await runDueRecurring({ today });
    const reminders = buildReminders(await loadUpcoming(today, REMINDER_HORIZON_DAYS), today);
    const notified = pushConfig()
      ? await runReminderNotifications({ db: prisma, reminders })
      : { sent: 0, devices: 0, removed: 0 };
    return NextResponse.json({
      success: true,
      posted: posted.posted,
      errors: posted.errors.length,
      reminders: reminders.length,
      notificationsConfigured: pushConfig() !== null,
      ...notified,
    });
  } catch (error) {
    console.error('Reminder cron run failed:', error);
    return NextResponse.json({ error: 'Reminder run failed' }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
