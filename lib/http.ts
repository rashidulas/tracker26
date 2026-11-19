/**
 * Shared guards for API route handlers: request size limits and the
 * rate-limit response.
 */
import { NextResponse } from 'next/server';
import { rateLimit, retryAfterText, type LimitName } from '@/lib/rateLimit';

const MB = 1024 * 1024;

/**
 * Request size limits. Vercel refuses request bodies over 4.5 MB before the
 * function runs, so there is no point allowing more; images are downscaled
 * in the browser (components/assistant/Composer.tsx prepareImage) to a few
 * hundred kilobytes each.
 */
export const MAX_CHAT_BODY_BYTES = 4.5 * MB;
export const MAX_SCAN_BODY_BYTES = 4.5 * MB;
/** One receipt image, decoded. */
export const MAX_IMAGE_BYTES = 3 * MB;
export const MAX_AUDIO_BODY_BYTES = 4.5 * MB;
/** Two minutes of speech (the recorder's limit) is about 2 MB at most. */
export const MAX_AUDIO_BYTES = 4 * MB;

export type LimitedBody = { ok: true; bytes: Uint8Array<ArrayBuffer> } | { ok: false; reason: 'too-large' | 'unreadable' };

/**
 * Read a request body, giving up as soon as it passes `maxBytes`. The
 * Content-Length header is checked first but not trusted: the stream is
 * counted as it is read.
 */
export async function readLimitedBody(request: Request, maxBytes: number): Promise<LimitedBody> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, reason: 'too-large' };
  if (!request.body) return { ok: true, bytes: new Uint8Array(0) };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return { ok: false, reason: 'too-large' };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}

/** Decoded size of base64 text (a data URL's payload), without decoding it. */
export function base64Bytes(base64: string): number {
  const length = base64.length;
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((length * 3) / 4) - padding;
}

/**
 * Count one call against a named limit:
 *   const limited = tooManyRequests('chat');
 *   if (limited) return limited;
 */
export function tooManyRequests(name: LimitName): NextResponse | null {
  const result = rateLimit(name);
  if (result.ok) return null;
  return NextResponse.json(
    { error: `Too many requests. Try again ${retryAfterText(result.retryAfterSeconds)}.` },
    { status: 429, headers: { 'Retry-After': String(result.retryAfterSeconds) } }
  );
}
