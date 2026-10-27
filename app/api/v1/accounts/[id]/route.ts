import { prisma } from '@/lib/prisma';
import { withMobileAuth, type RouteContext } from '@/lib/api/auth';
import { accountBodySchema, getAccountDTO } from '@/lib/api/accounts';
import { ApiError, assertId, notFound, ok, parseJson, revalidateWeb } from '@/lib/api/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = RouteContext<{ id: string }>;

export const PATCH = withMobileAuth<Ctx>(async (req, { params }) => {
  const id = assertId((await params).id, 'Account');
  const body = await parseJson(req, accountBodySchema);
  const existing = await prisma.account.findUnique({ where: { id }, select: { id: true } });
  if (!existing) notFound('Account');
  await prisma.account.update({ where: { id }, data: body });
  revalidateWeb('/accounts', '/dashboard', '/expenses', '/income', '/transfers');
  return ok(await getAccountDTO(id));
});

export const DELETE = withMobileAuth<Ctx>(async (_req, { params }) => {
  const id = assertId((await params).id, 'Account');
  const existing = await prisma.account.findUnique({ where: { id }, select: { id: true } });
  if (!existing) notFound('Account');

  // Same rule as web `deleteAccount`.
  const count = await prisma.transaction.count({ where: { accountId: id } });
  if (count > 0) {
    throw new ApiError(`Cannot delete account. It has ${count} transaction(s).`, 409);
  }

  await prisma.account.delete({ where: { id } });
  revalidateWeb('/accounts', '/dashboard');
  return ok({ id });
});
