/**
 * One way to read account balances, used by the Accounts page, the dashboard
 * and the assistant so they always agree:
 *   balance   = transactions (incl. goal transfers) + friend settlements
 *   earmarked = goal contributions that did not move money
 *   available = balance - earmarked
 *
 * Server-only.
 */
import type { Account, PrismaClient } from '@prisma/client';
import {
  computeBalancesForAccounts,
  earmarkedByAccount,
  friendAccountMovements,
} from '@/lib/accountBalance';

type BalanceDb = Pick<PrismaClient, 'account' | 'transaction' | 'friendEntry' | 'goalContribution'>;

export type AccountWithBalance = Account & {
  currentBalance: number;
  earmarked: number;
  available: number;
  transactionCount: number;
};

export async function loadAccountBalances(
  db: BalanceDb,
  options: { before?: Date } = {}
): Promise<AccountWithBalance[]> {
  const [accounts, transactions, friendEntries, contributions] = await Promise.all([
    db.account.findMany({ orderBy: { name: 'asc' } }),
    db.transaction.findMany({
      select: {
        amount: true,
        kind: true,
        date: true,
        accountId: true,
        toAccountId: true,
        accountSplits: true,
      },
    }),
    // Filtered in code: on MongoDB a `null` filter skips documents written
    // before these fields existed.
    db.friendEntry.findMany({
      select: { type: true, amount: true, date: true, accountId: true, transactionId: true },
    }),
    db.goalContribution.findMany({
      select: { fromAccountId: true, amount: true, transactionId: true, date: true },
    }),
  ]);

  const { before } = options;
  const inRange = <T extends { date: Date }>(rows: T[]) =>
    before ? rows.filter((r) => r.date < before) : rows;

  const balances = computeBalancesForAccounts(
    accounts,
    inRange(transactions),
    friendAccountMovements(inRange(friendEntries))
  );
  const earmarks = earmarkedByAccount(inRange(contributions));

  return accounts.map((account) => {
    const currentBalance = balances.get(account.id)?.balance ?? account.startingBalance;
    const earmarked = earmarks.get(account.id) ?? 0;
    return {
      ...account,
      currentBalance,
      earmarked,
      available: currentBalance - earmarked,
      transactionCount: balances.get(account.id)?.transactionCount ?? 0,
    };
  });
}
