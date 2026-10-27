import { withMobileAuth } from '@/lib/api/auth';
import { ok, parseJson, parseQuery, revalidateWeb } from '@/lib/api/http';
import {
  createExpense,
  expenseBodySchema,
  expenseWhere,
  listQuerySchema,
  listTransactions,
} from '@/lib/api/transactions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withMobileAuth(async (req) => {
  const query = parseQuery(req, listQuerySchema);
  return ok(await listTransactions(expenseWhere, query));
});

export const POST = withMobileAuth(async (req) => {
  const body = await parseJson(req, expenseBodySchema);
  const expense = await createExpense(body);
  revalidateWeb('/expenses', '/dashboard', '/accounts', '/analytics');
  return ok(expense, 201);
});
