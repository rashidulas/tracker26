import { withMobileAuth, type RouteContext } from '@/lib/api/auth';
import { assertId, ok, parseJson, revalidateWeb } from '@/lib/api/http';
import { incomeBodySchema, updateIncome } from '@/lib/api/transactions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = RouteContext<{ id: string }>;

export const PATCH = withMobileAuth<Ctx>(async (req, { params }) => {
  const id = assertId((await params).id, 'Income');
  const body = await parseJson(req, incomeBodySchema);
  const income = await updateIncome(id, body);
  revalidateWeb('/income', '/dashboard', '/accounts', '/analytics');
  return ok(income);
});
