import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import {
  collectFromTransactionsForAccount,
  computeAccountBalance,
} from '@/lib/accountBalance';
import { toAccountDTO, type AccountDTO } from './dto';
import { ApiError, notFound, optionalString, requiredString } from './http';

export const ACCOUNT_TYPES = [
  'CHECKING',
  'SAVINGS',
  'CREDIT_CARD',
  'CASH',
  'INVESTMENT',
  'LOAN',
] as const;

export const accountBodySchema = z
  .object({
    name: requiredString('Name'),
    type: z.enum(ACCOUNT_TYPES),
    institution: optionalString(),
    startingBalance: z
      .number({ invalid_type_error: 'Starting balance must be a number' })
      .finite()
      .nullable()
      .optional()
      .transform((v) => v ?? 0),
    creditLimit: z
      .number({ invalid_type_error: 'Credit limit must be a number' })
      .finite()
      .nonnegative('Credit limit cannot be negative')
      .nullable()
      .optional()
      .transform((v) => v ?? null),
  })
  // Same rule as web: credit limit is only kept for credit cards.
  .transform((v) => ({ ...v, creditLimit: v.type === 'CREDIT_CARD' ? v.creditLimit : null }));

/**
 * Accounts with their derived balances — identical math to the web's
 * `getAccounts` (app/accounts/actions.ts).
 */
export async function listAccountsWithBalances(where?: Prisma.AccountWhereInput): Promise<AccountDTO[]> {
  const [accounts, splitTransactions] = await Promise.all([
    prisma.account.findMany({
      where,
      orderBy: { name: 'asc' },
      include: {
        transactionsFrom: {
          select: { amount: true, kind: true, accountId: true, accountSplits: true },
        },
        transactionsTo: { select: { amount: true } },
      },
    }),
    prisma.transaction.findMany({
      where: { kind: { in: ['INCOME', 'EXPENSE'] } },
      select: { amount: true, kind: true, accountId: true, accountSplits: true },
    }),
  ]);

  const withSplits = splitTransactions.filter((t) => (t.accountSplits || []).length > 0);

  return accounts.map(({ transactionsFrom, transactionsTo, ...account }) => {
    const from = collectFromTransactionsForAccount(account.id, transactionsFrom, withSplits);
    return toAccountDTO(account, {
      currentBalance: computeAccountBalance(account.startingBalance, from, transactionsTo, account.id),
      transactionCount: from.length + transactionsTo.length,
    });
  });
}

export async function getAccountDTO(id: string): Promise<AccountDTO> {
  const [account] = await listAccountsWithBalances({ id });
  if (!account) notFound('Account');
  return account;
}

/** Throws 400 unless every id refers to an existing account. */
export async function assertAccountsExist(ids: (string | null | undefined)[]) {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return;
  const found = await prisma.account.count({ where: { id: { in: unique } } });
  if (found !== unique.length) throw new ApiError('Account not found', 400);
}
