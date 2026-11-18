import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { runDueRecurring } from '@/lib/recurring';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Cron entry point for the recurring due check (the app also runs it when
 * opened). Posts auto-post entries that are due; idempotent, so any schedule
 * is safe.
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
    return NextResponse.json(
      { error: 'Set CRON_SECRET to enable this route.' },
      { status: 503 }
    );
  }
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const result = await runDueRecurring();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error('Recurring cron run failed:', error);
    return NextResponse.json({ error: 'Due check failed' }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
