/**
 * What still points at an account or category. Used to refuse deletes that
 * would cascade-delete transfers, orphan account/category splits, or leave
 * goal contributions and budgets dangling.
 */
import type { PrismaClient } from '@prisma/client';

type ReferenceDb = Pick<
  PrismaClient,
  'transaction' | 'goalContribution' | 'budget' | 'subcategory'
>;

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

function sentence(subject: string, parts: string[]) {
  if (parts.length === 0) return null;
  const list =
    parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `Cannot delete ${subject}. Still attached: ${list}. Reassign or delete them first.`;
}

export async function accountReferences(db: ReferenceDb, accountId: string) {
  const [primary, transfersIn, splitShares, contributions] = await Promise.all([
    db.transaction.count({ where: { accountId } }),
    db.transaction.count({ where: { toAccountId: accountId, NOT: { accountId } } }),
    db.transaction.count({
      where: {
        accountSplits: { some: { accountId } },
        NOT: { accountId },
      },
    }),
    db.goalContribution.count({ where: { fromAccountId: accountId } }),
  ]);
  return { primary, transfersIn, splitShares, contributions };
}

/** null when the account can be deleted; otherwise a message listing what is attached. */
export async function accountDeleteBlocker(db: ReferenceDb, accountId: string, name?: string) {
  const r = await accountReferences(db, accountId);
  const parts: string[] = [];
  if (r.primary) parts.push(`${plural(r.primary, 'transaction')} from this account`);
  if (r.transfersIn) parts.push(`${plural(r.transfersIn, 'transfer')} into it`);
  if (r.splitShares) parts.push(`${plural(r.splitShares, 'split transaction')} with a share in it`);
  if (r.contributions) parts.push(plural(r.contributions, 'goal contribution'));
  return sentence(name ? `account "${name}"` : 'account', parts);
}

export async function categoryReferences(db: ReferenceDb, categoryId: string) {
  const subcategoryIds = (
    await db.subcategory.findMany({ where: { categoryId }, select: { id: true } })
  ).map((s) => s.id);

  const [direct, viaSubcategory, splitItems, budgets] = await Promise.all([
    db.transaction.count({ where: { categoryId } }),
    subcategoryIds.length
      ? db.transaction.count({
          where: { subcategoryId: { in: subcategoryIds }, NOT: { categoryId } },
        })
      : Promise.resolve(0),
    db.transaction.count({
      where: { splitItems: { some: { categoryId } }, NOT: { categoryId } },
    }),
    db.budget.count({ where: { categoryId } }),
  ]);
  return { direct, viaSubcategory, splitItems, budgets };
}

/** null when the category can be deleted; otherwise a message listing what is attached. */
export async function categoryDeleteBlocker(db: ReferenceDb, categoryId: string, name?: string) {
  const r = await categoryReferences(db, categoryId);
  const parts: string[] = [];
  if (r.direct) parts.push(plural(r.direct, 'transaction'));
  if (r.viaSubcategory) {
    parts.push(`${plural(r.viaSubcategory, 'transaction')} using one of its subcategories`);
  }
  if (r.splitItems) parts.push(`${plural(r.splitItems, 'split expense')} with a line in it`);
  if (r.budgets) parts.push(plural(r.budgets, 'budget'));
  return sentence(name ? `category "${name}"` : 'category', parts);
}
