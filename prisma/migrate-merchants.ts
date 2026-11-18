/**
 * One-off: turn existing merchantOrSource strings into Merchant records and
 * link income/expense rows to them (Transaction.merchantId).
 *
 * Plan (lib/merchants.ts planMerchantMigration):
 *   - spellings are grouped after light normalisation: surrounding whitespace
 *     trimmed, inner runs of whitespace collapsed, case ignored
 *   - each group becomes one Merchant named after its most used spelling
 *     (ties: the most recent); an existing Merchant with that name is reused
 *   - every row in the group gets merchantId, and its text becomes that name
 *   - transfers are skipped: their text ("Payment", "Debt Payment") is a label
 *   - no defaults are set: those stay the user's decision
 * Amounts, dates, categories and accounts are not touched, so balances and
 * totals do not change. Safe to re-run: linked rows are skipped.
 *
 * Dry run (default, writes nothing; prints the plan and merchant list):
 *   npx tsx --env-file=.env.local prisma/migrate-merchants.ts
 * Apply:
 *   npx tsx --env-file=.env.local prisma/migrate-merchants.ts --apply
 */
import { PrismaClient } from '@prisma/client';
import { planMerchantMigration } from '../lib/merchants';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

async function main() {
  const [rows, existing] = await Promise.all([
    prisma.transaction.findMany({
      select: { id: true, kind: true, merchantOrSource: true, merchantId: true, date: true },
    }),
    prisma.merchant.findMany({ select: { id: true, name: true, normalizedName: true } }),
  ]);

  const plan = planMerchantMigration(rows, existing);
  const linkCount = plan.merchants.reduce((s, m) => s + m.transactionIds.length, 0);
  const toCreate = plan.merchants.filter((m) => !m.existingId).length;

  console.log(`Merchant migration${APPLY ? '' : ' (dry run, nothing is written)'}`);
  console.log('');
  console.log(`Transactions scanned:        ${rows.length}`);
  console.log(`  to link to a merchant:     ${linkCount}`);
  console.log(`    text normalised:         ${plan.textChanges}`);
  console.log(`  already linked:            ${plan.alreadyLinked}`);
  console.log(`  no merchant text:          ${plan.blank}`);
  console.log(`  transfers (left as is):    ${plan.transfersSkipped}`);
  console.log(`Merchants to create:         ${toCreate}`);
  console.log(`Existing merchants reused:   ${plan.merchants.length - toCreate}`);
  console.log('');

  const width = Math.min(40, Math.max(8, ...plan.merchants.map((m) => m.name.length)));
  console.log(`${'Merchant'.padEnd(width)}  Txns  Exp  Inc  Stored spellings (if they change)`);
  console.log(`${'-'.repeat(width)}  ----  ---  ---  --------------------------------`);
  for (const m of plan.merchants) {
    const merged = m.variants.length > 1 || m.variants[0].text !== m.name ? m.variants.map((v) => `"${v.text}" ×${v.count}`).join(', ') : '';
    console.log(
      `${m.name.slice(0, width).padEnd(width)}  ${String(m.transactionIds.length).padStart(4)}  ${String(
        m.expenseCount
      ).padStart(3)}  ${String(m.incomeCount).padStart(3)}  ${merged}${m.existingId ? ' (exists)' : ''}`
    );
  }
  console.log('');

  if (!APPLY) {
    console.log('Dry run only. Re-run with --apply to write.');
    return;
  }

  let created = 0;
  let linked = 0;
  for (const m of plan.merchants) {
    await prisma.$transaction(async (tx) => {
      const merchant =
        (m.existingId && { id: m.existingId }) ||
        (await tx.merchant.findUnique({ where: { normalizedName: m.normalizedName }, select: { id: true } })) ||
        (created++, await tx.merchant.create({ data: { name: m.name, normalizedName: m.normalizedName }, select: { id: true } }));
      for (let i = 0; i < m.transactionIds.length; i += 500) {
        const ids = m.transactionIds.slice(i, i + 500);
        const { count } = await tx.transaction.updateMany({
          where: { id: { in: ids }, kind: { in: ['INCOME', 'EXPENSE'] } },
          data: { merchantId: merchant.id, merchantOrSource: m.name },
        });
        linked += count;
      }
    });
  }
  console.log(`Created ${created} merchant(s), linked ${linked} transaction(s).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
