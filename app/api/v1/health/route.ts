import { prisma } from '@/lib/prisma';
import { withMobileAuth } from '@/lib/api/auth';
import { ok } from '@/lib/api/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withMobileAuth(async () => {
  const [categories, accounts] = await Promise.all([prisma.category.count(), prisma.account.count()]);
  return ok({ status: 'ok', categories, accounts, serverTime: new Date().toISOString() });
});
