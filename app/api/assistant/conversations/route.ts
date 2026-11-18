import { NextResponse } from 'next/server';
import { listConversations } from '@/lib/assistant/conversations';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The chat sidebar's list, newest first. */
export async function GET() {
  try {
    return NextResponse.json({ conversations: await listConversations(prisma) });
  } catch (error) {
    console.error('Assistant conversations error:', error);
    return NextResponse.json({ error: 'Could not load your chats' }, { status: 500 });
  }
}
