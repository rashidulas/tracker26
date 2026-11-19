import { NextRequest, NextResponse } from 'next/server';
import { getAssistantModel } from '@/lib/assistant/model';
import { imagePartFromUpload, scanReceipt } from '@/lib/ai/receipts';
import { requireApiSession } from '@/lib/auth/session';
import { todayInAppTimeZone } from '@/lib/dates';
import { MAX_IMAGE_BYTES, MAX_SCAN_BODY_BYTES, base64Bytes, readLimitedBody, tooManyRequests } from '@/lib/http';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const maxDuration = 60;

const TOO_LARGE = 'That image is too large. Try a smaller photo.';
/** Kept under maxDuration so a slow model ends in a readable error, not a killed request. */
const SCAN_TIMEOUT_MS = 45_000;

/**
 * The Scan button. Reads one image through the shared receipt pipeline
 * (lib/ai/receipts.ts, the same one the chat assistant's readReceipt tool
 * uses) with the configured assistant model, and returns a checked draft for
 * the user to review. Nothing is saved here.
 *
 * Body: { image: data URL or base64, mimeType? }
 */
export async function POST(request: NextRequest) {
  const denied = await requireApiSession();
  if (denied) return denied;
  const limited = tooManyRequests('scanReceipt');
  if (limited) return limited;

  const config = getAssistantModel();
  if (!config.ok) {
    console.error('Receipt scan config:', config.error);
    return NextResponse.json(
      { error: 'Receipt scanning is not set up (no model key). Enter the expense by hand.' },
      { status: 503 }
    );
  }

  let body: { image?: unknown; mimeType?: unknown };
  // The scanner downscales in the browser (prepareImage), so a body this
  // large is a format the browser could not shrink, or not the scanner at all.
  const raw = await readLimitedBody(request, MAX_SCAN_BODY_BYTES);
  if (!raw.ok && raw.reason === 'too-large') {
    return NextResponse.json({ error: TOO_LARGE }, { status: 413 });
  }
  try {
    if (!raw.ok) throw new Error('unreadable');
    body = JSON.parse(new TextDecoder().decode(raw.bytes));
    if (typeof body !== 'object' || body === null) throw new Error('not an object');
  } catch {
    return NextResponse.json({ error: 'No image provided' }, { status: 400 });
  }
  if (typeof body.image !== 'string' || !body.image) {
    return NextResponse.json({ error: 'No image provided' }, { status: 400 });
  }
  const image = imagePartFromUpload(body.image, typeof body.mimeType === 'string' ? body.mimeType : null);
  if (!image) return NextResponse.json({ error: 'Please select an image file' }, { status: 400 });
  if (base64Bytes(body.image.replace(/^data:[^,]*,/, '')) > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: TOO_LARGE }, { status: 413 });
  }

  try {
    const result = await scanReceipt({
      db: prisma,
      model: config.model,
      image,
      today: todayInAppTimeZone(),
      abortSignal: AbortSignal.timeout(SCAN_TIMEOUT_MS),
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 422 });
    return NextResponse.json({ success: true, data: result.draft });
  } catch (error) {
    console.error('Receipt scan error:', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json(
      { error: 'The receipt could not be read right now. Try again or enter it by hand.' },
      { status: 500 }
    );
  }
}
