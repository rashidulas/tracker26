import { createUIMessageStreamResponse } from 'ai';
import { NextRequest, NextResponse } from 'next/server';
import { approvalSecret, runAssistant } from '@/lib/assistant/engine';
import { getAssistantModel } from '@/lib/assistant/model';
import { getAppTimeZone, todayInAppTimeZone } from '@/lib/dates';
import { prisma } from '@/lib/prisma';
import { APP_CURRENCY } from '@/lib/utils';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Streams one assistant turn as an AI SDK UI message stream (for useChat).
 * Body: { messages: UIMessage[] } — the whole conversation so far.
 */
export async function POST(request: NextRequest) {
  const config = getAssistantModel();
  if (!config.ok) {
    console.error('Assistant config:', config.error);
    return NextResponse.json({ error: config.error }, { status: 500 });
  }

  let body: { messages?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON' }, { status: 400 });
  }

  try {
    const result = await runAssistant({
      messages: body.messages,
      model: config.model,
      provider: config.provider,
      deps: {
        db: prisma,
        today: todayInAppTimeZone(),
        timeZone: getAppTimeZone(),
        currency: APP_CURRENCY,
      },
      approvalSecret: approvalSecret(),
      abortSignal: request.signal,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return createUIMessageStreamResponse({ stream: result.stream });
  } catch (error) {
    console.error('Assistant chat error:', error);
    return NextResponse.json(
      { error: 'The assistant is unavailable right now. Please try again.' },
      { status: 500 }
    );
  }
}
