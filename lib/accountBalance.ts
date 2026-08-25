type FromTransaction = { amount: number; kind: string };
type ToTransaction = { amount: number };

/**
 * Account balance:
 *   starting
 *   + income on this account
 *   - expenses on this account
 *   - transfers out (Pay From / TRANSFER.accountId)
 *   + transfers in (Pay To / TRANSFER.toAccountId)
 */
export function computeAccountBalance(
  startingBalance: number,
  fromTransactions: FromTransaction[],
  toTransactions: ToTransaction[]
): number {
  const fromDelta = fromTransactions.reduce((sum, transaction) => {
    if (transaction.kind === 'INCOME') return sum + transaction.amount;
    if (transaction.kind === 'EXPENSE' || transaction.kind === 'TRANSFER') {
      return sum - transaction.amount;
    }
    return sum;
  }, 0);

  const transfersIn = toTransactions.reduce((sum, transfer) => sum + transfer.amount, 0);

  return startingBalance + fromDelta + transfersIn;
}
