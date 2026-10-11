'use server';

import { prisma } from '@/lib/prisma';
import { signedFriendAmount } from '@/lib/friends';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
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

const entrySchema = z.object({
  friendId: z.string().min(1),
  date: z.string().min(1, 'Date is required'),
  amount: z.number().positive('Amount must be positive'),
  type: z.enum(['THEY_OWE_ME', 'I_OWE_THEM', 'THEY_PAID_ME', 'I_PAID_THEM']),
  description: z.string().max(120).optional(),
  notes: z.string().max(300).optional(),
});

export async function getFriends() {
  try {
    const friends = await prisma.friend.findMany({
      include: {
        entries: {
          orderBy: { date: 'desc' },
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

    const friend = await prisma.friend.create({
      data: {
        name: validated.name.trim(),
        notes: validated.notes?.trim() || null,
        color,
      },
    });

    // Optional opening balance when creating a friend
    const openingAmount = parseFloat((formData.get('openingAmount') as string) || '');
    const openingType = formData.get('openingType') as string;
    if (
      openingAmount > 0 &&
      (openingType === 'THEY_OWE_ME' || openingType === 'I_OWE_THEM')
    ) {
      await prisma.friendEntry.create({
        data: {
          friendId: friend.id,
          date: new Date(),
          amount: openingAmount,
          type: openingType,
          description: 'Opening balance',
        },
      });
    }

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
  try {
    await prisma.friend.delete({ where: { id } });
    revalidatePath('/friends');
    return { success: true };
  } catch (error) {
    console.error('Error deleting friend:', error);
    return { success: false, error: 'Failed to delete friend' };
  }
}

export async function createFriendEntry(formData: FormData) {
  try {
    const validated = entrySchema.parse({
      friendId: formData.get('friendId') as string,
      date: formData.get('date') as string,
      amount: parseFloat(formData.get('amount') as string),
      type: formData.get('type') as FriendEntryType,
      description: (formData.get('description') as string) || undefined,
      notes: (formData.get('notes') as string) || undefined,
    });

    await prisma.friendEntry.create({
      data: {
        friendId: validated.friendId,
        date: new Date(validated.date),
        amount: validated.amount,
        type: validated.type,
        description: validated.description?.trim() || null,
        notes: validated.notes?.trim() || null,
      },
    });

    revalidatePath('/friends');
    return { success: true };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error: error.errors[0].message };
    }
    console.error('Error creating friend entry:', error);
    return { success: false, error: 'Failed to add entry' };
  }
}

export async function deleteFriendEntry(id: string) {
  try {
    await prisma.friendEntry.delete({ where: { id } });
    revalidatePath('/friends');
    return { success: true };
  } catch (error) {
    console.error('Error deleting friend entry:', error);
    return { success: false, error: 'Failed to delete entry' };
  }
}
