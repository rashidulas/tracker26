import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { friendInclude, sortFriends, toFriendDTO, type FriendDTO } from './dto';
import {
  ApiError,
  dateString,
  notFound,
  optionalString,
  positiveAmount,
  requiredString,
} from './http';

/** Same palette the web cycles through for new friends. */
const FRIEND_COLORS = [
  '#7aa2f7',
  '#3dcea6',
  '#bb9af7',
  '#f07178',
  '#e8a05a',
  '#e8c468',
  '#7dcfff',
  '#c0caf5',
];

export const friendUpdateSchema = z.object({
  name: requiredString('Name', 60),
  notes: optionalString(300),
  color: optionalString(),
});

export const friendCreateSchema = friendUpdateSchema
  .extend({
    openingAmount: z
      .number({ invalid_type_error: 'Opening amount must be a number' })
      .finite()
      .nonnegative('Opening amount cannot be negative')
      .nullable()
      .optional(),
    openingType: z.enum(['THEY_OWE_ME', 'I_OWE_THEM']).nullable().optional(),
  })
  .refine((v) => !(v.openingAmount && v.openingAmount > 0 && !v.openingType), {
    message: 'openingType is required when openingAmount is set',
  });

export const friendEntrySchema = z.object({
  date: dateString,
  amount: positiveAmount(),
  type: z.enum(['THEY_OWE_ME', 'I_OWE_THEM', 'THEY_PAID_ME', 'I_PAID_THEM']),
  description: optionalString(120),
  notes: optionalString(300),
});

export async function listFriends(): Promise<FriendDTO[]> {
  const friends = await prisma.friend.findMany({ include: friendInclude, orderBy: { name: 'asc' } });
  return sortFriends(friends.map(toFriendDTO));
}

export async function getFriendDTO(id: string): Promise<FriendDTO> {
  const friend = await prisma.friend.findUnique({ where: { id }, include: friendInclude });
  if (!friend) notFound('Friend');
  return toFriendDTO(friend);
}

/** Mirrors `createFriend` (app/friends/actions.ts) incl. the optional opening balance. */
export async function createFriend(body: z.output<typeof friendCreateSchema>): Promise<FriendDTO> {
  const existingCount = await prisma.friend.count();
  const color = body.color || FRIEND_COLORS[existingCount % FRIEND_COLORS.length];

  const friend = await prisma.friend.create({
    data: { name: body.name, notes: body.notes, color },
  });

  if (body.openingAmount && body.openingAmount > 0 && body.openingType) {
    const now = new Date();
    await prisma.friendEntry.create({
      data: {
        friendId: friend.id,
        // Today as UTC midnight, consistent with every other stored date.
        date: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())),
        amount: body.openingAmount,
        type: body.openingType,
        description: 'Opening balance',
      },
    });
  }

  return getFriendDTO(friend.id);
}

export async function updateFriend(
  id: string,
  body: z.output<typeof friendUpdateSchema>
): Promise<FriendDTO> {
  const existing = await prisma.friend.findUnique({ where: { id }, select: { color: true } });
  if (!existing) notFound('Friend');

  await prisma.friend.update({
    where: { id },
    data: {
      name: body.name,
      notes: body.notes,
      // Keep the current color when the client doesn't send one.
      color: body.color || existing.color || '#7aa2f7',
    },
  });
  return getFriendDTO(id);
}

export async function deleteFriend(id: string) {
  const existing = await prisma.friend.findUnique({ where: { id }, select: { id: true } });
  if (!existing) notFound('Friend');
  // Entries cascade via the schema relation (same as web).
  await prisma.friend.delete({ where: { id } });
}

export async function addFriendEntry(
  friendId: string,
  body: z.output<typeof friendEntrySchema>
): Promise<FriendDTO> {
  const friend = await prisma.friend.findUnique({ where: { id: friendId }, select: { id: true } });
  if (!friend) notFound('Friend');

  await prisma.friendEntry.create({
    data: {
      friendId,
      date: new Date(body.date),
      amount: body.amount,
      type: body.type,
      description: body.description,
      notes: body.notes,
    },
  });
  return getFriendDTO(friendId);
}

export async function deleteFriendEntry(id: string) {
  const entry = await prisma.friendEntry.findUnique({ where: { id }, select: { id: true } });
  if (!entry) throw new ApiError('Entry not found', 404);
  await prisma.friendEntry.delete({ where: { id } });
}
