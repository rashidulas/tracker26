import { withMobileAuth } from '@/lib/api/auth';
import { ok, parseJson, parseQuery, revalidateWeb } from '@/lib/api/http';
import {
  createIncome,
  incomeBodySchema,
  listQuerySchema,
  listTransactions,
} from '@/lib/api/transactions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Note: unlike the web's getIncome, this never runs the DB-mutating
// consolidateLegacyIncomeSplits — GET stays read-only.
export const GET = withMobileAuth(async (req) => {
  const query = parseQuery(req, listQuerySchema);
  return ok(await listTransactions({ kind: 'INCOME' }, query));
});

export const POST = withMobileAuth(async (req) => {
  const body = await parseJson(req, incomeBodySchema);
  const income = await createIncome(body);
  revalidateWeb('/income', '/dashboard', '/accounts', '/analytics');
  return ok(income, 201);
});
