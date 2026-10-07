import OpenAI from 'openai';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'OPENAI_API_KEY is not configured. Add it to your .env file.' },
        { status: 500 }
      );
    }

    const formData = await request.formData();
    const audio = formData.get('audio');

    if (!(audio instanceof File)) {
      return NextResponse.json({ error: 'No audio file provided' }, { status: 400 });
    }

    if (audio.size > 25 * 1024 * 1024) {
      return NextResponse.json({ error: 'Audio file must be under 25MB' }, { status: 400 });
    }

    const openai = new OpenAI({ apiKey });

    let text = '';
    try {
      const transcription = await openai.audio.transcriptions.create({
        file: audio,
        model: 'gpt-4o-mini-transcribe',
        language: 'en',
      });
      text = transcription.text?.trim() || '';
    } catch {
      // Fallback for accounts that only have Whisper enabled
      const transcription = await openai.audio.transcriptions.create({
        file: audio,
        model: 'whisper-1',
        language: 'en',
      });
      text = transcription.text?.trim() || '';
    }

    if (!text) {
      return NextResponse.json({ error: 'Could not understand the audio' }, { status: 422 });
    }

    return NextResponse.json({ success: true, text });
  } catch (error) {
    console.error('Transcription error:', error);
    const message = error instanceof Error ? error.message : 'Transcription failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
