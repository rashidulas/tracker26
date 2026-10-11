import { getFriends } from './actions';
import FriendsClient from './FriendsClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function FriendsPage() {
  const result = await getFriends();

  if (!result.success) {
    return (
      <div className="page-shell">
        <div className="p-4 bg-danger-dim border border-danger/25 rounded-2xl text-danger">
          Error: {result.error}
        </div>
      </div>
    );
  }

  return <FriendsClient initialFriends={result.data || []} />;
}
