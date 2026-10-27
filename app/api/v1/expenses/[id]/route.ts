import { withMobileAuth, type RouteContext } from '@/lib/api/auth';
import { assertId, ok, parseJson, revalidateWeb } from '@/lib/api/http';
import { expenseBodySchema, updateExpense } from '@/lib/api/transactions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = RouteContext<{ id: string }>;

export const PATCH = withMobileAuth<Ctx>(async (req, { params }) => {
  const id = assertId((await params).id, 'Expense');
  const body = await parseJson(req, expenseBodySchema);
  const expense = await updateExpense(id, body);
  revalidateWeb('/expenses', '/dashboard', '/accounts', '/analytics');
  return ok(expense);
});
