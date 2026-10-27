import { withMobileAuth } from '@/lib/api/auth';
import { ok, parseJson, revalidateWeb } from '@/lib/api/http';
import { createTransfer, listTransactions, transferBodySchema } from '@/lib/api/transactions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withMobileAuth(async () => ok(await listTransactions({ kind: 'TRANSFER' })));

export const POST = withMobileAuth(async (req) => {
  const body = await parseJson(req, transferBodySchema);
  const transfer = await createTransfer(body);
  revalidateWeb('/transfers', '/accounts', '/dashboard');
  return ok(transfer, 201);
});
