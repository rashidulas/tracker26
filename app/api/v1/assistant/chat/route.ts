import { POST as legacyChat } from '@/app/api/assistant/chat/route';
import { relayLegacyResponse } from '@/lib/api/assistant';
import { withMobileAuth } from '@/lib/api/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Delegates to the web's chat route (same prompt + draft guards) and re-wraps
// `{ success, data, meta }` as `{ data: { message, draft } }`.
export const POST = withMobileAuth(async (req) => relayLegacyResponse(await legacyChat(req)));
