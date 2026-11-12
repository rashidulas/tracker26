/**
 * One-off: merge legacy multi-row income splits into one transaction with
 * embedded accountSplits.
 *
 * Before accountSplits existed, an income paid into several accounts was saved
 * as one INCOME row per account, linked by splitGroupId or only by identical
 * date / category / subcategory / source / notes / tags. This script finds
 * those groups and, per group, inside one database transaction:
 *   - keeps the largest row, sets amount = group total and
 *     accountSplits = one entry per row, clears splitGroupId
 *   - deletes the other rows
 * Account balances do not change: each account keeps the same income amount.
 *
 * This used to run on every getIncome() read. It now runs only when you run it.
 *
 * Dry run (default, writes nothing):
 *   npx tsx --env-file=.env.local prisma/consolidate-legacy-income-splits.ts
 * Apply:
 *   npx tsx --env-file=.env.local prisma/consolidate-legacy-income-splits.ts --apply
 *
 * Caution: rows grouped only by fingerprint (no splitGroupId) could be two
 * separate incomes that match on every field except account. Those would be
 * merged too, so read the dry-run output before applying. Groups that repeat
 * an account are skipped (a split never pays the same account twice).
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

type Row = {
  id: string;
  date: Date;
  amount: number;
  categoryId: string | null;
  subcategoryId: string | null;
  accountId: string | null;
  merchantOrSource: string | null;
  notes: string | null;
  tags: string[];
  splitGroupId: string | null;
  accountSplits: { accountId: string; amount: number }[];
};

function fingerprint(item: Row) {
  return [
    new Date(item.date).toISOString().slice(0, 10),
    item.categoryId || '',
    item.subcategoryId || '',
    item.merchantOrSource || '',
    item.notes || '',
    [...(item.tags || [])].map((t) => t.toLowerCase()).sort().join(','),
  ].join('|');
}

async function main() {
  const rows: Row[] = await prisma.transaction.findMany({
    where: { kind: 'INCOME' },
    select: {
      id: true,
      date: true,
      amount: true,
      categoryId: true,
      subcategoryId: true,
      accountId: true,
      merchantOrSource: true,
      notes: true,
      tags: true,
      splitGroupId: true,
      accountSplits: true,
    },
  });

  // Rows that already use accountSplits are not legacy.
  const candidates = rows.filter(
    (t) => (!t.accountSplits || t.accountSplits.length === 0) && t.accountId
  );

  const groups = new Map<string, Row[]>();
  for (const row of candidates) {
    const key = row.splitGroupId ? `group:${row.splitGroupId}` : `fp:${fingerprint(row)}`;
    groups.set(key, [...(groups.get(key) || []), row]);
  }

  const toMerge = [...groups.entries()].filter(([, members]) => {
    const accounts = new Set(members.map((m) => m.accountId));
    return members.length > 1 && accounts.size === members.length;
  });
  const skipped = [...groups.entries()].filter(([, members]) => {
    const accounts = new Set(members.map((m) => m.accountId));
    return members.length > 1 && accounts.size !== members.length;
  });

  console.log(`${rows.length} income rows, ${candidates.length} without accountSplits.`);
  console.log(`${toMerge.length} legacy group(s) to merge.${APPLY ? '' : ' (dry run)'}`);
  if (skipped.length > 0) {
    console.log(
      `${skipped.length} group(s) skipped: they repeat an account, so they are probably separate incomes, not a split.`
    );
    for (const [key, members] of skipped) {
      console.log(`  skip ${key}: ${members.map((m) => `${m.id}=$${m.amount}`).join(', ')}`);
    }
  }

  let merged = 0;
  for (const [key, members] of toMerge) {
    const sorted = [...members].sort((a, b) => b.amount - a.amount);
    const primary = sorted[0];
    const total = sorted.reduce((sum, m) => sum + m.amount, 0);
    const splits = sorted.map((m) => ({ accountId: m.accountId as string, amount: m.amount }));
    const siblingIds = sorted.slice(1).map((m) => m.id);

    console.log(
      `  ${key}\n    keep ${primary.id}: amount ${primary.amount} -> ${total}, splits ${JSON.stringify(splits)}\n    delete ${siblingIds.join(', ')}`
    );

    if (!APPLY) continue;

    await prisma.$transaction(async (tx) => {
      // Re-check inside the transaction so a concurrent edit is not overwritten.
      const current = await tx.transaction.findMany({
        where: { id: { in: sorted.map((m) => m.id) }, kind: 'INCOME' },
        select: { id: true, amount: true, accountId: true, accountSplits: true },
      });
      const unchanged =
        current.length === sorted.length &&
        current.every((c) => {
          const before = sorted.find((m) => m.id === c.id)!;
          return (
            c.amount === before.amount &&
            c.accountId === before.accountId &&
            c.accountSplits.length === 0
          );
        });
      if (!unchanged) throw new Error(`Group ${key} changed since it was read; re-run the script.`);

      await tx.transaction.update({
        where: { id: primary.id },
        data: { amount: total, accountSplits: splits, splitGroupId: null },
      });
      await tx.transaction.deleteMany({ where: { id: { in: siblingIds }, kind: 'INCOME' } });
    });
    merged += 1;
  }

  console.log(APPLY ? `Merged ${merged} group(s).` : 'Dry run only. Re-run with --apply to write.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
