import { withMobileAuth } from '@/lib/api/auth';
import { createFriend, friendCreateSchema, listFriends } from '@/lib/api/friends';
import { ok, parseJson, revalidateWeb } from '@/lib/api/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withMobileAuth(async () => ok(await listFriends()));

export const POST = withMobileAuth(async (req) => {
  const body = await parseJson(req, friendCreateSchema);
  const friend = await createFriend(body);
  revalidateWeb('/friends', '/dashboard');
  return ok(friend, 201);
});
