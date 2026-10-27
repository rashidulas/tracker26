import { withMobileAuth } from '@/lib/api/auth';
import { getDashboard } from '@/lib/api/dashboard';
import { ok } from '@/lib/api/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withMobileAuth(async () => ok(await getDashboard()));
