import { withMobileAuth, type RouteContext } from '@/lib/api/auth';
import { deleteFriend, friendUpdateSchema, updateFriend } from '@/lib/api/friends';
import { assertId, ok, parseJson, revalidateWeb } from '@/lib/api/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = RouteContext<{ id: string }>;

export const PATCH = withMobileAuth<Ctx>(async (req, { params }) => {
  const id = assertId((await params).id, 'Friend');
  const body = await parseJson(req, friendUpdateSchema);
  const friend = await updateFriend(id, body);
  revalidateWeb('/friends', '/dashboard');
  return ok(friend);
});

export const DELETE = withMobileAuth<Ctx>(async (_req, { params }) => {
  const id = assertId((await params).id, 'Friend');
  await deleteFriend(id);
  revalidateWeb('/friends', '/dashboard');
  return ok({ id });
});
