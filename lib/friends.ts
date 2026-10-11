import type { FriendEntryType } from '@prisma/client';

/** Positive = they owe you; negative = you owe them */
export function signedFriendAmount(type: FriendEntryType, amount: number): number {
  switch (type) {
    case 'THEY_OWE_ME':
    case 'I_PAID_THEM':
      return amount;
    case 'I_OWE_THEM':
    case 'THEY_PAID_ME':
      return -amount;
    default:
      return 0;
  }
}
