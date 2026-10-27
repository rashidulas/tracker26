import { POST as legacyTranscribe } from '@/app/api/assistant/transcribe/route';
import { relayLegacyResponse } from '@/lib/api/assistant';
import { withMobileAuth } from '@/lib/api/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Legacy route returns `{ success, text }`; v1 returns `{ data: { text } }`.
export const POST = withMobileAuth(async (req) =>
  relayLegacyResponse(await legacyTranscribe(req), (json) => ({ text: json.text }))
);
