import { confirmBodySchema, confirmDraft } from '@/lib/api/assistant';
import { withMobileAuth } from '@/lib/api/auth';
import { ok, parseJson, revalidateWeb } from '@/lib/api/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withMobileAuth(async (req) => {
  const { draft } = await parseJson(req, confirmBodySchema);
  const transaction = await confirmDraft(draft);
  revalidateWeb('/dashboard', '/analytics', '/expenses', '/income', '/accounts', '/chat');
  return ok(transaction, 201);
});
