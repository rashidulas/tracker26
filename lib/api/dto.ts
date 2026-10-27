import type {
  Account,
  AccountType,
  Category,
  CategoryType,
  Friend,
  FriendEntry,
  FriendEntryType,
  Prisma,
  Subcategory,
  TransactionKind,
} from '@prisma/client';
import { signedFriendAmount } from '@/lib/friends';

/** Relations every TransactionDTO needs. */
export const transactionInclude = {
  category: true,
  subcategory: true,
  account: true,
  toAccount: true,
} satisfies Prisma.TransactionInclude;

export type TransactionWithRelations = Prisma.TransactionGetPayload<{
  include: typeof transactionInclude;
}>;

export const categoryInclude = {
  subcategories: { orderBy: { name: 'asc' } },
  _count: { select: { transactions: true } },
} satisfies Prisma.CategoryInclude;

export type CategoryWithRelations = Prisma.CategoryGetPayload<{ include: typeof categoryInclude }>;

export const friendInclude = {
  entries: { orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] },
} satisfies Prisma.FriendInclude;

export type FriendWithEntries = Prisma.FriendGetPayload<{ include: typeof friendInclude }>;

// ---------------------------------------------------------------------------
// DTO types (mirror ios/API.md)
// ---------------------------------------------------------------------------

export type SubcategoryDTO = { id: string; name: string };
export type CategoryRef = {
  id: string;
  name: string;
  type: CategoryType;
  color: string;
  icon: string | null;
};
export type AccountRef = { id: string; name: string; type: AccountType };

export type TransactionDTO = {
  id: string;
  date: string;
  amount: number;
  kind: TransactionKind;
  categoryId: string | null;
  subcategoryId: string | null;
  accountId: string | null;
  toAccountId: string | null;
  merchantOrSource: string | null;
  notes: string | null;
  tags: string[];
  accountSplits: { accountId: string; amount: number }[];
  category: CategoryRef | null;
  subcategory: SubcategoryDTO | null;
  account: AccountRef | null;
  toAccount: AccountRef | null;
};

export type AccountDTO = {
  id: string;
  name: string;
  type: AccountType;
  institution: string | null;
  startingBalance: number;
  creditLimit: number | null;
  currentBalance: number;
  transactionCount: number;
};

export type CategoryDTO = CategoryRef & {
  subcategories: SubcategoryDTO[];
  transactionCount: number;
};

export type FriendEntryDTO = {
  id: string;
  friendId: string;
  date: string;
  amount: number;
  type: FriendEntryType;
  description: string | null;
  notes: string | null;
};

export type FriendDTO = {
  id: string;
  name: string;
  notes: string | null;
  color: string;
  balance: number;
  entries: FriendEntryDTO[];
};

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

/** `YYYY-MM-DD` of a stored (UTC-midnight) date. */
export function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Round to cents to avoid float noise like 12.300000000000001 in computed sums. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function toCategoryRef(c: Category): CategoryRef {
  return { id: c.id, name: c.name, type: c.type, color: c.color, icon: c.icon ?? null };
}

function toAccountRef(a: Account): AccountRef {
  return { id: a.id, name: a.name, type: a.type };
}

function toSubcategoryDTO(s: Subcategory): SubcategoryDTO {
  return { id: s.id, name: s.name };
}

export function toTransactionDTO(t: TransactionWithRelations): TransactionDTO {
  return {
    id: t.id,
    date: toDateString(t.date),
    amount: t.amount,
    kind: t.kind,
    categoryId: t.categoryId ?? null,
    subcategoryId: t.subcategoryId ?? null,
    accountId: t.accountId ?? null,
    toAccountId: t.toAccountId ?? null,
    merchantOrSource: t.merchantOrSource ?? null,
    notes: t.notes ?? null,
    tags: t.tags ?? [],
    accountSplits: (t.accountSplits ?? []).map((s) => ({ accountId: s.accountId, amount: s.amount })),
    category: t.category ? toCategoryRef(t.category) : null,
    subcategory: t.subcategory ? toSubcategoryDTO(t.subcategory) : null,
    account: t.account ? toAccountRef(t.account) : null,
    toAccount: t.toAccount ? toAccountRef(t.toAccount) : null,
  };
}

export function toAccountDTO(
  a: Account,
  computed: { currentBalance: number; transactionCount: number }
): AccountDTO {
  return {
    id: a.id,
    name: a.name,
    type: a.type,
    institution: a.institution ?? null,
    startingBalance: a.startingBalance,
    creditLimit: a.creditLimit ?? null,
    currentBalance: round2(computed.currentBalance),
    transactionCount: computed.transactionCount,
  };
}

export function toCategoryDTO(c: CategoryWithRelations): CategoryDTO {
  return {
    ...toCategoryRef(c),
    subcategories: [...c.subcategories]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(toSubcategoryDTO),
    transactionCount: c._count.transactions,
  };
}

export function toFriendEntryDTO(e: FriendEntry): FriendEntryDTO {
  return {
    id: e.id,
    friendId: e.friendId,
    date: toDateString(e.date),
    amount: e.amount,
    type: e.type,
    description: e.description ?? null,
    notes: e.notes ?? null,
  };
}

export function friendBalance(entries: Pick<FriendEntry, 'type' | 'amount'>[]): number {
  return round2(entries.reduce((sum, e) => sum + signedFriendAmount(e.type, e.amount), 0));
}

export function toFriendDTO(f: Friend & { entries: FriendEntry[] }): FriendDTO {
  const entries = [...f.entries].sort(
    (a, b) => b.date.getTime() - a.date.getTime() || b.createdAt.getTime() - a.createdAt.getTime()
  );
  return {
    id: f.id,
    name: f.name,
    notes: f.notes ?? null,
    color: f.color,
    balance: friendBalance(f.entries),
    entries: entries.map(toFriendEntryDTO),
  };
}

/** Sort friends like the web: largest |balance| first, then name. */
export function sortFriends<T extends { balance: number; name: string }>(friends: T[]): T[] {
  return [...friends].sort((a, b) => {
    const diff = Math.abs(b.balance) - Math.abs(a.balance);
    return diff !== 0 ? diff : a.name.localeCompare(b.name);
  });
}
