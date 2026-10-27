import { withMobileAuth } from '@/lib/api/auth';
import { ok, parseJson, revalidateWeb } from '@/lib/api/http';
import { createPayment, paymentBodySchema } from '@/lib/api/transactions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withMobileAuth(async (req) => {
  const body = await parseJson(req, paymentBodySchema);
  const payment = await createPayment(body);
  revalidateWeb('/expenses', '/accounts', '/dashboard', '/transfers', '/categories');
  return ok(payment, 201);
});
