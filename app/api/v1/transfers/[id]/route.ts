import { withMobileAuth, type RouteContext } from '@/lib/api/auth';
import { assertId, ok, parseJson, revalidateWeb } from '@/lib/api/http';
import { transferBodySchema, updateTransfer } from '@/lib/api/transactions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = RouteContext<{ id: string }>;

export const PATCH = withMobileAuth<Ctx>(async (req, { params }) => {
  const id = assertId((await params).id, 'Transfer');
  const body = await parseJson(req, transferBodySchema);
  const transfer = await updateTransfer(id, body);
  revalidateWeb('/transfers', '/accounts', '/dashboard', '/expenses');
  return ok(transfer);
});
