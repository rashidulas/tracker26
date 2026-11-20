/**
 * Friends for the expense form's pickers ("Split with friends", "Pays back a
 * friend"), each with their balance. Server-only.
 */
import { prisma } from '@/lib/prisma';
import { signedFriendAmount } from '@/lib/friends';

export type FriendOptionRow = {
  id: string;
  name: string;
  color: string;
  /** Positive = they owe you, negative = you owe them. */
  balance: number;
};

export async function loadFriendOptions(): Promise<FriendOptionRow[]> {
  const friends = await prisma.friend.findMany({
    select: {
      id: true,
      name: true,
      color: true,
      entries: { select: { type: true, amount: true } },
    },
    orderBy: { name: 'asc' },
  });
  return friends.map(({ entries, ...friend }) => ({
    ...friend,
    balance:
      Math.round(entries.reduce((sum, e) => sum + signedFriendAmount(e.type, e.amount), 0) * 100) / 100,
  }));
}
