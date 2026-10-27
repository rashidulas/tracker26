import { withMobileAuth } from '@/lib/api/auth';
import { ok } from '@/lib/api/http';
import { listExpenseMonths } from '@/lib/api/transactions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withMobileAuth(async () => ok(await listExpenseMonths()));
