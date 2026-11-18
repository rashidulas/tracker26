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

export type FriendEntryMoney = {
  type: FriendEntryType;
  amount: number;
  accountId?: string | null;
  transactionId?: string | null;
};

/**
 * How a friend entry changes the balance of its account:
 *   THEY_OWE_ME with an account  = you lent them money from it  → out
 *   I_OWE_THEM with an account   = you borrowed money into it   → in
 *   THEY_PAID_ME                 = they paid you back into it   → in
 *   I_PAID_THEM                  = you paid them back from it   → out
 *
 * An entry without an account changes nothing. An entry that belongs to a
 * split expense changes nothing either: the expense already moved the money.
 */
export function friendEntryAccountDelta(entry: FriendEntryMoney): number {
  if (!entry.accountId || entry.transactionId) return 0;
  switch (entry.type) {
    case 'THEY_OWE_ME':
    case 'I_PAID_THEM':
      return -entry.amount;
    case 'I_OWE_THEM':
    case 'THEY_PAID_ME':
      return entry.amount;
    default:
      return 0;
  }
}

/** Wording for the account picker on each entry type. */
export const FRIEND_ACCOUNT_LABELS: Record<FriendEntryType, string> = {
  THEY_OWE_ME: 'Lent from account',
  I_OWE_THEM: 'Borrowed into account',
  THEY_PAID_ME: 'Received into account',
  I_PAID_THEM: 'Paid from account',
};
