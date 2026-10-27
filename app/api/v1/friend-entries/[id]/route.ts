import { withMobileAuth, type RouteContext } from '@/lib/api/auth';
import { deleteFriendEntry } from '@/lib/api/friends';
import { assertId, ok, revalidateWeb } from '@/lib/api/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = RouteContext<{ id: string }>;

export const DELETE = withMobileAuth<Ctx>(async (_req, { params }) => {
  const id = assertId((await params).id, 'Entry');
  await deleteFriendEntry(id);
  revalidateWeb('/friends', '/dashboard');
  return ok({ id });
});
