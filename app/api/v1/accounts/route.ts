import { prisma } from '@/lib/prisma';
import { withMobileAuth } from '@/lib/api/auth';
import { accountBodySchema, getAccountDTO, listAccountsWithBalances } from '@/lib/api/accounts';
import { ok, parseJson, revalidateWeb } from '@/lib/api/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withMobileAuth(async () => ok(await listAccountsWithBalances()));

export const POST = withMobileAuth(async (req) => {
  const body = await parseJson(req, accountBodySchema);
  const account = await prisma.account.create({ data: body });
  revalidateWeb('/accounts', '/dashboard');
  return ok(await getAccountDTO(account.id), 201);
});
