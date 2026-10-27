import { GET as legacyDebrief } from '@/app/api/assistant/debrief/route';
import { relayLegacyResponse } from '@/lib/api/assistant';
import { withMobileAuth } from '@/lib/api/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withMobileAuth(async () => relayLegacyResponse(await legacyDebrief()));
