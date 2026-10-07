import OpenAI from 'openai';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  assistantResponseSchema,
  buildAssistantSystemPrompt,
  type ChatMessage,
} from '@/lib/assistant';

export const runtime = 'nodejs';

type IncomingMessage = {
  role: 'user' | 'assistant';
  content: string;
  image?: { dataUrl: string; mimeType: string };
};

function extractJson(text: string) {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) return trimmed;
  const match = trimmed.match(/\{[\s\S]*\}/);
  return match ? match[0] : trimmed;
}

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'OPENAI_API_KEY is not configured. Add it to your .env file.' },
        { status: 500 }
      );
    }

    const body = await request.json();
    const messages = (body.messages || []) as IncomingMessage[];

    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: 'messages are required' }, { status: 400 });
    }

    const [categories, accounts] = await Promise.all([
      prisma.category.findMany({
        select: { id: true, name: true, type: true },
        orderBy: { name: 'asc' },
      }),
      prisma.account.findMany({
        select: { id: true, name: true, type: true },
        orderBy: { name: 'asc' },
      }),
    ]);

    const expenseCategories = categories.filter((c) => c.type === 'EXPENSE');
    const incomeCategories = categories.filter((c) => c.type === 'INCOME');
    const today = new Date().toISOString().slice(0, 10);

    const systemPrompt = buildAssistantSystemPrompt({
      today,
      expenseCategories,
      incomeCategories,
      accounts,
    });

    const openaiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
    ];

    for (const msg of messages.slice(-12)) {
      if (msg.role === 'assistant') {
        openaiMessages.push({ role: 'assistant', content: msg.content });
        continue;
      }

      if (msg.image?.dataUrl) {
        const dataUrl = msg.image.dataUrl.includes('base64,')
          ? msg.image.dataUrl
          : `data:${msg.image.mimeType || 'image/jpeg'};base64,${msg.image.dataUrl}`;

        openaiMessages.push({
          role: 'user',
          content: [
            { type: 'text', text: msg.content || 'Please review this image and log the transaction if it is a receipt or payment.' },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        });
      } else {
        openaiMessages.push({ role: 'user', content: msg.content });
      }
    }

    const openai = new OpenAI({ apiKey });
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: openaiMessages,
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) {
      return NextResponse.json({ error: 'Empty response from model' }, { status: 502 });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJson(raw));
    } catch {
      return NextResponse.json({ error: 'Model returned invalid JSON' }, { status: 502 });
    }

    const validated = assistantResponseSchema.safeParse(parsed);
    if (!validated.success) {
      return NextResponse.json(
        { error: 'Model response failed validation', details: validated.error.flatten() },
        { status: 502 }
      );
    }

    let draft = validated.data.draft;

    if (draft) {
      const category = categories.find((c) => c.id === draft!.categoryId);
      if (!category) {
        return NextResponse.json({
          success: true,
          data: {
            message:
              validated.data.message +
              ' I could not match that to a category in your list — please create the category or try again.',
            draft: null,
          },
        });
      }

      if (draft.kind === 'EXPENSE' && category.type !== 'EXPENSE') {
        draft = null;
      } else if (draft.kind === 'INCOME' && category.type !== 'INCOME') {
        draft = null;
      } else if (draft.kind === 'INCOME' && !draft.accountId) {
        return NextResponse.json({
          success: true,
          data: {
            message:
              validated.data.message +
              ' Which account should this income go into?',
            draft: null,
          },
        });
      } else if (draft.accountId && !accounts.some((a) => a.id === draft!.accountId)) {
        draft = { ...draft, accountId: null };
        if (draft.kind === 'INCOME') {
          return NextResponse.json({
            success: true,
            data: {
              message:
                validated.data.message +
                ' That account was not found — which account should I use?',
              draft: null,
            },
          });
        }
      }
    }

    const historySafe: ChatMessage[] = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const enrichedDraft = draft
      ? {
          ...draft,
          categoryName: categories.find((c) => c.id === draft.categoryId)?.name ?? 'Category',
          accountName: draft.accountId
            ? accounts.find((a) => a.id === draft.accountId)?.name ?? null
            : null,
        }
      : null;

    return NextResponse.json({
      success: true,
      data: {
        message: validated.data.message,
        draft: enrichedDraft,
      },
      meta: {
        historyLength: historySafe.length,
        categoryCount: categories.length,
        accountCount: accounts.length,
      },
    });
  } catch (error) {
    console.error('Assistant chat error:', error);
    const message = error instanceof Error ? error.message : 'Assistant request failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
