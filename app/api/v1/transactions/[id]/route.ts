import { withMobileAuth, type RouteContext } from '@/lib/api/auth';
import { assertId, ok, revalidateWeb } from '@/lib/api/http';
import { deleteTransaction } from '@/lib/api/transactions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = RouteContext<{ id: string }>;

export const DELETE = withMobileAuth<Ctx>(async (_req, { params }) => {
  const id = assertId((await params).id, 'Transaction');
  await deleteTransaction(id);
  revalidateWeb('/expenses', '/income', '/transfers', '/accounts', '/dashboard', '/analytics');
  return ok({ id });
});
