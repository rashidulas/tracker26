import { POST as legacyScanReceipt } from '@/app/api/scan-receipt/route';
import { relayLegacyResponse } from '@/lib/api/assistant';
import { withMobileAuth } from '@/lib/api/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Delegates to the web's Gemini receipt scanner; 422 for non-receipts is passed through.
export const POST = withMobileAuth(async (req) => relayLegacyResponse(await legacyScanReceipt(req)));
