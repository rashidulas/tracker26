import { withMobileAuth, type RouteContext } from '@/lib/api/auth';
import { categoryBodySchema, deleteCategory, updateCategory } from '@/lib/api/categories';
import { assertId, ok, parseJson, revalidateWeb } from '@/lib/api/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = RouteContext<{ id: string }>;

export const PATCH = withMobileAuth<Ctx>(async (req, { params }) => {
  const id = assertId((await params).id, 'Category');
  const body = await parseJson(req, categoryBodySchema);
  const category = await updateCategory(id, body);
  revalidateWeb('/categories', '/expenses', '/income', '/dashboard', '/analytics');
  return ok(category);
});

export const DELETE = withMobileAuth<Ctx>(async (_req, { params }) => {
  const id = assertId((await params).id, 'Category');
  await deleteCategory(id);
  revalidateWeb('/categories', '/expenses', '/income');
  return ok({ id });
});
