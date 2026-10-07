import OpenAI from 'openai';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { formatFinanceContextForPrompt, getFinanceContext } from '@/lib/financeContext';

export const runtime = 'nodejs';

const debriefSchema = z.object({
  headline: z.string(),
  summary: z.string(),
  mood: z.enum(['positive', 'neutral', 'caution']),
  todayNote: z.string(),
  monthNote: z.string(),
  highlights: z.array(z.string()).max(6),
  watchouts: z.array(z.string()).max(6),
  actions: z.array(z.string()).max(5),
});

export type DailyDebrief = z.infer<typeof debriefSchema>;

export async function GET() {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'OPENAI_API_KEY is not configured. Add it to your .env file.' },
        { status: 500 }
      );
    }

    const ctx = await getFinanceContext();
    const snapshot = formatFinanceContextForPrompt(ctx);

    const openai = new OpenAI({ apiKey });
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.45,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are Tracker26's private CFO debrief writer.
Write a clear daily money debrief from the live finance snapshot.
Tone: calm, direct, useful — not hype, not shame.
If data is sparse/empty, say so honestly and suggest what to log next.
Use USD. Prefer short bullets. No markdown fences.

Return ONLY JSON:
{
  "headline": "short punchy title",
  "summary": "2-4 sentence daily debrief",
  "mood": "positive" | "neutral" | "caution",
  "todayNote": "one sentence about today",
  "monthNote": "one sentence about this month",
  "highlights": ["up to 6 short positives or notable facts"],
  "watchouts": ["up to 6 risks/overspends/gaps"],
  "actions": ["up to 5 concrete next steps"]
}`,
        },
        {
          role: 'user',
          content: `Write today's debrief for ${ctx.today}.\n\nSnapshot:\n${snapshot}`,
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) {
      return NextResponse.json({ error: 'Empty response from model' }, { status: 502 });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: 'Model returned invalid JSON' }, { status: 502 });
    }

    const validated = debriefSchema.safeParse(parsed);
    if (!validated.success) {
      return NextResponse.json(
        { error: 'Debrief validation failed', details: validated.error.flatten() },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        debrief: validated.data,
        stats: ctx.totals,
        generatedAt: new Date().toISOString(),
        topExpenseCategories: ctx.topExpenseCategories,
      },
    });
  } catch (error) {
    console.error('Debrief error:', error);
    const message = error instanceof Error ? error.message : 'Debrief failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
