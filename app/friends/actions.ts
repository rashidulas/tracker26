'use server';

import { prisma } from '@/lib/prisma';
import { signedFriendAmount } from '@/lib/friends';
import {
  createFriendEntry as createEntry,
  deleteFriend as removeFriend,
  deleteFriendEntry as removeEntry,
  updateFriendEntry as updateEntry,
  type FriendEntryInput,
} from '@/lib/friendLedger';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { todayAsStoredDate } from '@/lib/dates';
import type { FriendEntryType } from '@prisma/client';

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

const friendSchema = z.object({
  name: z.string().min(1, 'Name is required').max(60),
  notes: z.string().max(300).optional(),
  color: z.string().optional(),
});

export async function getFriends() {
  try {
    const friends = await prisma.friend.findMany({
      include: {
        entries: {
          orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
          include: {
            account: { select: { id: true, name: true } },
            // The expense this IOU is a share of.
            transaction: {
              select: {
                id: true,
                date: true,
                amount: true,
                sharedAmount: true,
                merchantOrSource: true,
                category: { select: { name: true, icon: true } },
                account: { select: { name: true } },
              },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    const data = friends.map((friend) => {
      const balance = friend.entries.reduce(
        (sum, entry) => sum + signedFriendAmount(entry.type, entry.amount),
        0
      );
      return { ...friend, balance };
    });

    // Sort: largest absolute balances first, then name
    data.sort((a, b) => {
      const absDiff = Math.abs(b.balance) - Math.abs(a.balance);
      if (absDiff !== 0) return absDiff;
      return a.name.localeCompare(b.name);
    });

    return { success: true, data };
  } catch (error) {
    console.error('Error fetching friends:', error);
    return { success: false, error: 'Failed to fetch friends' };
  }
}

export async function createFriend(formData: FormData) {
  try {
    const validated = friendSchema.parse({
      name: formData.get('name') as string,
      notes: (formData.get('notes') as string) || undefined,
      color: (formData.get('color') as string) || undefined,
    });

    const existingCount = await prisma.friend.count();
    const color =
      validated.color || FRIEND_COLORS[existingCount % FRIEND_COLORS.length];

    // Optional opening balance when creating a friend
    const openingAmount = parseFloat((formData.get('openingAmount') as string) || '');
    const openingType = formData.get('openingType') as string;
    const hasOpening =
      openingAmount > 0 &&
      (openingType === 'THEY_OWE_ME' || openingType === 'I_OWE_THEM');

    // Friend and opening entry are written together or not at all.
    const friend = await prisma.$transaction(async (tx) => {
      const created = await tx.friend.create({
        data: {
          name: validated.name.trim(),
          notes: validated.notes?.trim() || null,
          color,
        },
      });
      if (hasOpening) {
        await tx.friendEntry.create({
          data: {
            friendId: created.id,
            date: todayAsStoredDate(),
            amount: openingAmount,
            type: openingType as 'THEY_OWE_ME' | 'I_OWE_THEM',
            description: 'Opening balance',
          },
        });
      }
      return created;
    });

    revalidatePath('/friends');
    return { success: true, data: friend };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error: error.errors[0].message };
    }
    console.error('Error creating friend:', error);
    return { success: false, error: 'Failed to create friend' };
  }
}

export async function updateFriend(id: string, formData: FormData) {
  try {
    const validated = friendSchema.parse({
      name: formData.get('name') as string,
      notes: (formData.get('notes') as string) || undefined,
      color: (formData.get('color') as string) || undefined,
    });

    await prisma.friend.update({
      where: { id },
      data: {
        name: validated.name.trim(),
        notes: validated.notes?.trim() || null,
        color: validated.color || '#7aa2f7',
      },
    });

    revalidatePath('/friends');
    return { success: true };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error: error.errors[0].message };
    }
    console.error('Error updating friend:', error);
    return { success: false, error: 'Failed to update friend' };
  }
}

export async function deleteFriend(id: string) {
  const result = await removeFriend(id);
  return result.success ? { success: true as const } : result;
}

function entryFromForm(formData: FormData): FriendEntryInput {
  return {
    friendId: (formData.get('friendId') as string) || '',
    date: (formData.get('date') as string) || '',
    amount: parseFloat(formData.get('amount') as string),
    type: formData.get('type') as FriendEntryType,
    description: (formData.get('description') as string) || null,
    notes: (formData.get('notes') as string) || null,
    accountId: (formData.get('accountId') as string) || null,
  };
}

export async function createFriendEntry(formData: FormData) {
  const result = await createEntry(entryFromForm(formData));
  return result.success ? { success: true as const } : result;
}

export async function updateFriendEntry(id: string, formData: FormData) {
  const result = await updateEntry(id, entryFromForm(formData));
  return result.success ? { success: true as const } : result;
}

export async function deleteFriendEntry(id: string) {
  const result = await removeEntry(id);
  return result.success ? { success: true as const } : result;
}

/** Friends for the expense form's "Split with friends" picker. */
export async function getFriendsForSelect() {
  try {
    const friends = await prisma.friend.findMany({
      select: { id: true, name: true, color: true },
      orderBy: { name: 'asc' },
    });
    return { success: true as const, data: friends };
  } catch (error) {
    console.error('Error fetching friends:', error);
    return { success: false as const, error: 'Failed to fetch friends' };
  }
}
