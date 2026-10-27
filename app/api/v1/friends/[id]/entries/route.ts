import { withMobileAuth, type RouteContext } from '@/lib/api/auth';
import { addFriendEntry, friendEntrySchema } from '@/lib/api/friends';
import { assertId, ok, parseJson, revalidateWeb } from '@/lib/api/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = RouteContext<{ id: string }>;

export const POST = withMobileAuth<Ctx>(async (req, { params }) => {
  const id = assertId((await params).id, 'Friend');
  const body = await parseJson(req, friendEntrySchema);
  const friend = await addFriendEntry(id, body);
  revalidateWeb('/friends', '/dashboard');
  return ok(friend, 201);
});
