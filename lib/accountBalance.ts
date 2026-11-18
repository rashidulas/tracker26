import { friendEntryAccountDelta, type FriendEntryMoney } from '@/lib/friends';

export type AccountSplit = { accountId: string; amount: number };

export type FromTransaction = {
  amount: number;
  kind: string;
  accountId?: string | null;
  accountSplits?: AccountSplit[] | null;
  date?: Date | string;
};

type ToTransaction = { amount: number; date?: Date | string };

/** Amount of a transaction that belongs to a specific account. */
export function amountAttributedToAccount(
  transaction: FromTransaction,
  accountId: string
): number {
  const splits = (transaction.accountSplits || []).filter(
    (s) => s.accountId && typeof s.amount === 'number'
  );
  if (splits.length > 0) {
    return splits
      .filter((s) => s.accountId === accountId)
      .reduce((sum, s) => sum + s.amount, 0);
  }
  return transaction.amount;
}

/**
 * Include primary linked txs plus incomes/expenses that credit this account
 * only via accountSplits (secondary accounts on a single split transaction).
 */
export function collectFromTransactionsForAccount(
  accountId: string,
  linkedFrom: FromTransaction[],
  splitTransactions: FromTransaction[] = []
): FromTransaction[] {
  const extras = splitTransactions.filter(
    (tx) =>
      tx.accountId !== accountId &&
      (tx.accountSplits || []).some((s) => s.accountId === accountId)
  );
  return extras.length > 0 ? [...linkedFrom, ...extras] : linkedFrom;
}

/**
 * Account balance:
 *   starting
 *   + income attributed to this account
 *   - expenses attributed to this account
 *   - transfers out (Pay From / TRANSFER.accountId)
 *   + transfers in (Pay To / TRANSFER.toAccountId)
 *   + movements: money lent, borrowed or settled with friends through this
 *     account (signed, see friendAccountMovements)
 *
 * A goal contribution with a linked goal account is a TRANSFER, so it is
 * already in from/to. An earmark does not change the balance; see
 * availableBalance.
 */
export function computeAccountBalance(
  startingBalance: number,
  fromTransactions: FromTransaction[],
  toTransactions: ToTransaction[],
  accountId?: string,
  movements: { amount: number }[] = []
): number {
  const fromDelta = fromTransactions.reduce((sum, transaction) => {
    const amount =
      accountId && transaction.kind !== 'TRANSFER'
        ? amountAttributedToAccount(transaction, accountId)
        : transaction.amount;

    if (amount === 0) return sum;
    if (transaction.kind === 'INCOME') return sum + amount;
    if (transaction.kind === 'EXPENSE' || transaction.kind === 'TRANSFER') {
      return sum - amount;
    }
    return sum;
  }, 0);

  const transfersIn = toTransactions.reduce((sum, transfer) => sum + transfer.amount, 0);
  const moved = movements.reduce((sum, m) => sum + m.amount, 0);

  return startingBalance + fromDelta + transfersIn + moved;
}

/** Money that moved through an account outside Transaction rows. Signed. */
export type AccountMovement = { accountId: string; amount: number; date: Date };

/** Friend entries that moved money through an account, as signed movements. */
export function friendAccountMovements(
  entries: (FriendEntryMoney & { date: Date })[]
): AccountMovement[] {
  const out: AccountMovement[] = [];
  for (const entry of entries) {
    const amount = friendEntryAccountDelta(entry);
    if (amount !== 0 && entry.accountId) {
      out.push({ accountId: entry.accountId, amount, date: entry.date });
    }
  }
  return out;
}

/**
 * Goal contributions without a transfer are earmarks: the money stays in the
 * source account but is set aside. Returns the earmarked total per account.
 */
export function earmarkedByAccount(
  contributions: { fromAccountId: string; amount: number; transactionId?: string | null }[]
): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of contributions) {
    if (c.transactionId) continue;
    out.set(c.fromAccountId, (out.get(c.fromAccountId) ?? 0) + c.amount);
  }
  return out;
}

/** Balance minus what is earmarked for goals. */
export function availableBalance(balance: number, earmarked: number): number {
  return balance - earmarked;
}

export type BalanceTransaction = FromTransaction & {
  toAccountId?: string | null;
};

/**
 * Current balance for every account from the full transaction list.
 * Same rules as computeAccountBalance; only TRANSFER rows credit toAccountId.
 */
export function computeBalancesForAccounts(
  accounts: { id: string; startingBalance: number }[],
  transactions: BalanceTransaction[],
  movements: AccountMovement[] = []
): Map<string, { balance: number; transactionCount: number }> {
  const withSplits = transactions.filter(
    (t) => t.kind !== 'TRANSFER' && (t.accountSplits || []).length > 0
  );
  const result = new Map<string, { balance: number; transactionCount: number }>();

  for (const account of accounts) {
    const linked = transactions.filter((t) => t.accountId === account.id);
    const from = collectFromTransactionsForAccount(account.id, linked, withSplits);
    const to = transactions.filter(
      (t) => t.kind === 'TRANSFER' && t.toAccountId === account.id
    );
    const moved = movements.filter((m) => m.accountId === account.id);
    result.set(account.id, {
      balance: computeAccountBalance(account.startingBalance, from, to, account.id, moved),
      transactionCount: from.length + to.length + moved.length,
    });
  }

  return result;
}
