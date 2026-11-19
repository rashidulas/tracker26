import { NextRequest, NextResponse } from 'next/server';
import {
  deleteConversation,
  loadConversation,
  renameConversation,
} from '@/lib/assistant/conversations';
import { requireApiSession } from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

/** One conversation with its messages. `running` is true while a reply is still being produced. */
export async function GET(_request: NextRequest, { params }: Context) {
  const denied = await requireApiSession();
  if (denied) return denied;
  try {
    const { id } = await params;
    const conversation = await loadConversation(prisma, id);
    if (!conversation) return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
    return NextResponse.json({ conversation });
  } catch (error) {
    console.error('Assistant conversation error:', error);
    return NextResponse.json({ error: 'Could not load this chat' }, { status: 500 });
  }
}

/** Rename. Body: { title }. */
export async function PATCH(request: NextRequest, { params }: Context) {
  const denied = await requireApiSession();
  if (denied) return denied;
  try {
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as { title?: unknown } | null;
    if (typeof body?.title !== 'string' || !body.title.trim()) {
      return NextResponse.json({ error: 'Enter a name for this chat' }, { status: 400 });
    }
    const conversation = await renameConversation(prisma, id, body.title);
    if (!conversation) return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
    return NextResponse.json({ conversation });
  } catch (error) {
    console.error('Assistant rename error:', error);
    return NextResponse.json({ error: 'Could not rename this chat' }, { status: 500 });
  }
}

/** Delete the conversation and its messages. Transactions it recorded are kept. */
export async function DELETE(_request: NextRequest, { params }: Context) {
  const denied = await requireApiSession();
  if (denied) return denied;
  try {
    const { id } = await params;
    const deleted = await deleteConversation(prisma, id);
    if (!deleted) return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Assistant delete error:', error);
    return NextResponse.json({ error: 'Could not delete this chat' }, { status: 500 });
  }
}
