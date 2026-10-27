import { z } from 'zod';
import { withMobileAuth } from '@/lib/api/auth';
import { categoryBodySchema, createCategory, listCategories } from '@/lib/api/categories';
import { ok, parseJson, parseQuery, revalidateWeb } from '@/lib/api/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const querySchema = z.object({
  type: z.preprocess((v) => (v === '' ? undefined : v), z.enum(['INCOME', 'EXPENSE']).optional()),
});

export const GET = withMobileAuth(async (req) => {
  const { type } = parseQuery(req, querySchema);
  return ok(await listCategories(type));
});

export const POST = withMobileAuth(async (req) => {
  const body = await parseJson(req, categoryBodySchema);
  const category = await createCategory(body);
  revalidateWeb('/categories', '/expenses', '/income');
  return ok(category, 201);
});
