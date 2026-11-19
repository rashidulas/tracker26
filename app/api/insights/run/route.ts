import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { runInsightsCheck } from '@/lib/insights/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Cron entry point for the insights check (the app also runs it when opened):
 * detects today's insights and writes the weekly / monthly recap when one is
 * due. Idempotent per day, so any schedule is safe; once a day is enough.
 *
 * Same protection as /api/recurring/run: requires CRON_SECRET, sent as
 * `Authorization: Bearer <CRON_SECRET>` (what Vercel Cron sends). Without
 * CRON_SECRET configured the route is disabled.
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
    const result = await runInsightsCheck();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error('Insights cron run failed:', error);
    return NextResponse.json({ error: 'Insights check failed' }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
