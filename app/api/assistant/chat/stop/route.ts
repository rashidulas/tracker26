import { NextRequest, NextResponse } from 'next/server';
import { stopChatRun } from '@/lib/assistant/chat';
import { requireApiSession } from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

/** Stops the reply being produced for a conversation. Body: { id }. */
export async function POST(request: NextRequest) {
  const denied = await requireApiSession();
  if (denied) return denied;
  try {
    const body = (await request.json().catch(() => null)) as { id?: unknown } | null;
    const outcome = await stopChatRun(prisma, body?.id);
    if (outcome === 'invalid') {
      return NextResponse.json({ error: 'Unknown chat' }, { status: 400 });
    }
    return NextResponse.json({ success: true, outcome });
  } catch (error) {
    console.error('Assistant stop error:', error);
    return NextResponse.json({ error: 'Could not stop the reply' }, { status: 500 });
  }
}
