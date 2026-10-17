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
 */
export function computeAccountBalance(
  startingBalance: number,
  fromTransactions: FromTransaction[],
  toTransactions: ToTransaction[],
  accountId?: string
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

  return startingBalance + fromDelta + transfersIn;
}
