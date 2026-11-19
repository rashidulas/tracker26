import OpenAI from 'openai';
import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/auth/session';
import { MAX_AUDIO_BODY_BYTES, MAX_AUDIO_BYTES, readLimitedBody, tooManyRequests } from '@/lib/http';

export const runtime = 'nodejs';

const TOO_LARGE = 'That recording is too long. Try a shorter one.';

export async function POST(request: NextRequest) {
  const denied = await requireApiSession();
  if (denied) return denied;
  const limited = tooManyRequests('transcribe');
  if (limited) return limited;

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'OPENAI_API_KEY is not configured. Add it to your .env file.' },
        { status: 500 }
      );
    }

    const raw = await readLimitedBody(request, MAX_AUDIO_BODY_BYTES);
    if (!raw.ok && raw.reason === 'too-large') {
      return NextResponse.json({ error: TOO_LARGE }, { status: 413 });
    }
    let audio: FormDataEntryValue | null = null;
    try {
      if (!raw.ok) throw new Error('unreadable');
      // Parsed from the size-checked bytes, not from the request itself.
      const formData = await new Response(raw.bytes, {
        headers: { 'content-type': request.headers.get('content-type') ?? '' },
      }).formData();
      audio = formData.get('audio');
    } catch {
      return NextResponse.json({ error: 'No audio file provided' }, { status: 400 });
    }

    if (!(audio instanceof File)) {
      return NextResponse.json({ error: 'No audio file provided' }, { status: 400 });
    }
    if (audio.size > MAX_AUDIO_BYTES) {
      return NextResponse.json({ error: TOO_LARGE }, { status: 413 });
    }
    // "audio/webm;codecs=opus", "audio/mp4": what the recorder produces.
    if (!/^(audio|video)\/(webm|mp4|mpeg|ogg|wav|x-m4a|m4a)\b/.test(audio.type)) {
      return NextResponse.json({ error: 'That recording is not in a supported format' }, { status: 415 });
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
    // The provider's message stays in the server log.
    console.error('Transcription error:', error instanceof Error ? `${error.name}: ${error.message}` : 'unknown');
    return NextResponse.json(
      { error: 'Could not transcribe that right now. Try again or type it instead.' },
      { status: 500 }
    );
  }
}
