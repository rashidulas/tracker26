/**
 * Merchant memory.
 *
 * A Merchant is one name after light normalisation: surrounding whitespace is
 * trimmed, runs of whitespace become one space, and case is ignored when
 * matching ("  walmart " and "Walmart" are the same merchant). The first
 * spelling saved becomes the display name.
 *
 * Income and expense rows get a merchantId (lib/transactions.ts does this on
 * every write); transfers keep only their text label.
 *
 * Defaults (category, subcategory, account) are only ever set by the user, via
 * "Always use this category for <merchant>?" or the merchants page.
 *
 * Pure helpers at the top are safe for client code; the database helpers take
 * a transaction client so they run inside the caller's prisma.$transaction.
 */
import type { Prisma } from '@prisma/client';

/** Trim and collapse whitespace. null for empty input. */
export function cleanMerchantName(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(/\s+/g, ' ').trim();
  return cleaned || null;
}

/** The matching key: cleaned and lower-cased. null for empty input. */
export function normalizeMerchantName(raw: string | null | undefined): string | null {
  const cleaned = cleanMerchantName(raw);
  return cleaned ? cleaned.toLocaleLowerCase('en-US') : null;
}

export type MerchantDefaults = {
  defaultCategoryId: string | null;
  defaultSubcategoryId: string | null;
  defaultAccountId: string | null;
};

type Tx = Pick<Prisma.TransactionClient, 'merchant'>;

/** Find the merchant for `name`, creating it if new. null when name is empty. */
export async function ensureMerchant(
  tx: Tx,
  name: string | null | undefined
): Promise<{ id: string; name: string } | null> {
  const cleaned = cleanMerchantName(name);
  const key = normalizeMerchantName(name);
  if (!cleaned || !key) return null;
  const existing = await tx.merchant.findUnique({
    where: { normalizedName: key },
    select: { id: true, name: true },
  });
  if (existing) return existing;
  return tx.merchant.create({
    data: { name: cleaned, normalizedName: key },
    select: { id: true, name: true },
  });
}

/**
 * The merchant's default category for a transaction of `kind`, or null when
 * it has none or the default is the other kind (a merchant can be both a shop
 * and a refund source).
 */
export function defaultCategoryForKind(
  merchant: { defaultCategoryId: string | null; defaultSubcategoryId: string | null } | null | undefined,
  categoryType: (id: string) => 'INCOME' | 'EXPENSE' | null | undefined,
  kind: 'INCOME' | 'EXPENSE'
): { categoryId: string; subcategoryId: string | null } | null {
  if (!merchant?.defaultCategoryId) return null;
  if (categoryType(merchant.defaultCategoryId) !== kind) return null;
  return {
    categoryId: merchant.defaultCategoryId,
    subcategoryId: merchant.defaultSubcategoryId ?? null,
  };
}

// ==================== FORM MEMORY ====================

/** What the expense form fills in when a merchant is typed or picked. */
export type MerchantMemory = {
  name: string;
  merchantId: string | null;
  categoryId: string | null;
  subcategoryId: string | null;
  accountId: string | null;
  /** The category came from a default the user set ("Always use ..."). */
  hasDefault: boolean;
};

/**
 * Merge merchant defaults with what was used last time. A default the user set
 * wins; otherwise the last transaction with that merchant fills the gaps.
 * `recent` is newest first. Only categories of `kind` are used.
 */
export function buildMerchantMemory(
  merchants: ({ id: string; name: string; normalizedName: string } & MerchantDefaults)[],
  recent: {
    merchantOrSource: string | null;
    categoryId: string | null;
    subcategoryId: string | null;
    accountId: string | null;
  }[],
  categoryType: (id: string) => 'INCOME' | 'EXPENSE' | null | undefined,
  kind: 'INCOME' | 'EXPENSE' = 'EXPENSE',
  limit = 300
): MerchantMemory[] {
  const byKey = new Map<string, MerchantMemory>();
  const order: string[] = [];
  const merchantByKey = new Map(merchants.map((m) => [m.normalizedName, m]));

  for (const t of recent) {
    const key = normalizeMerchantName(t.merchantOrSource);
    if (!key || byKey.has(key)) continue;
    const m = merchantByKey.get(key);
    byKey.set(key, {
      name: m?.name ?? cleanMerchantName(t.merchantOrSource)!,
      merchantId: m?.id ?? null,
      categoryId: t.categoryId && categoryType(t.categoryId) === kind ? t.categoryId : null,
      subcategoryId: t.categoryId && categoryType(t.categoryId) === kind ? t.subcategoryId : null,
      accountId: t.accountId,
      hasDefault: false,
    });
    order.push(key);
  }

  for (const m of merchants) {
    const def = defaultCategoryForKind(m, categoryType, kind);
    if (!def && !m.defaultAccountId) continue;
    const prev = byKey.get(m.normalizedName);
    if (!prev) order.push(m.normalizedName);
    byKey.set(m.normalizedName, {
      name: m.name,
      merchantId: m.id,
      categoryId: def?.categoryId ?? prev?.categoryId ?? null,
      subcategoryId: def ? def.subcategoryId : prev?.subcategoryId ?? null,
      accountId: m.defaultAccountId ?? prev?.accountId ?? null,
      hasDefault: Boolean(def),
    });
  }

  return order.slice(0, limit).map((k) => byKey.get(k)!);
}

// ==================== MIGRATION PLAN ====================

export type MigrationSource = {
  id: string;
  kind: 'INCOME' | 'EXPENSE' | 'TRANSFER';
  merchantOrSource: string | null;
  merchantId?: string | null;
  date: Date;
  categoryId?: string | null;
};

export type PlannedMerchant = {
  /** Display name: the most used spelling (ties: the most recent). */
  name: string;
  normalizedName: string;
  /** Every spelling found, with how often it was used. */
  variants: { text: string; count: number }[];
  transactionIds: string[];
  /** Already in the Merchant collection (re-runs only link rows). */
  existingId: string | null;
  incomeCount: number;
  expenseCount: number;
};

export type MerchantMigrationPlan = {
  merchants: PlannedMerchant[];
  /** Income/expense rows with no merchant text. */
  blank: number;
  /** Transfers: their text is a label ("Payment"), not a merchant. */
  transfersSkipped: number;
  /** Rows that already have a merchantId. */
  alreadyLinked: number;
  /** Rows whose stored text changes (whitespace or case of the chosen spelling). */
  textChanges: number;
};

/**
 * What the merchant migration would do. Pure, so the dry run and the real run
 * share it and it can be tested without a database.
 */
export function planMerchantMigration(
  rows: MigrationSource[],
  existing: { id: string; name: string; normalizedName: string }[] = []
): MerchantMigrationPlan {
  const existingByKey = new Map(existing.map((m) => [m.normalizedName, m]));
  const groups = new Map<
    string,
    {
      /** Cleaned spellings: candidates for the name. */
      variants: Map<string, { count: number; last: number }>;
      /** Stored text exactly as found, for the plan. */
      raw: Map<string, number>;
      ids: string[];
      income: number;
      expense: number;
    }
  >();
  let blank = 0;
  let transfersSkipped = 0;
  let alreadyLinked = 0;

  for (const row of rows) {
    if (row.kind === 'TRANSFER') {
      transfersSkipped += 1;
      continue;
    }
    if (row.merchantId) {
      alreadyLinked += 1;
      continue;
    }
    const cleaned = cleanMerchantName(row.merchantOrSource);
    const key = normalizeMerchantName(row.merchantOrSource);
    if (!cleaned || !key) {
      blank += 1;
      continue;
    }
    let g = groups.get(key);
    if (!g) {
      g = { variants: new Map(), raw: new Map(), ids: [], income: 0, expense: 0 };
      groups.set(key, g);
    }
    const text = row.merchantOrSource as string;
    g.raw.set(text, (g.raw.get(text) ?? 0) + 1);
    const v = g.variants.get(cleaned) ?? { count: 0, last: 0 };
    v.count += 1;
    v.last = Math.max(v.last, row.date.getTime());
    g.variants.set(cleaned, v);
    g.ids.push(row.id);
    if (row.kind === 'INCOME') g.income += 1;
    else g.expense += 1;
  }

  let textChanges = 0;
  const merchants: PlannedMerchant[] = [];
  for (const [key, g] of groups) {
    // Most used spelling; on a tie prefer one with capitals ("Trader Joes"
    // over "trader joes", "Netflix" over "NETFLIX"), then the most recent.
    const casing = (s: string) =>
      s === s.toLowerCase() ? 0 : s === s.toUpperCase() ? 1 : 2;
    const ranked = [...g.variants.entries()].sort(
      (a, b) =>
        b[1].count - a[1].count ||
        casing(b[0]) - casing(a[0]) ||
        b[1].last - a[1].last ||
        a[0].localeCompare(b[0])
    );
    const prior = existingByKey.get(key);
    const name = prior?.name ?? ranked[0][0];
    merchants.push({
      name,
      normalizedName: key,
      variants: [...g.raw.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([text, count]) => ({ text, count })),
      transactionIds: g.ids,
      existingId: prior?.id ?? null,
      incomeCount: g.income,
      expenseCount: g.expense,
    });
  }
  // Count stored strings that will change to the canonical name.
  const nameByKey = new Map(merchants.map((m) => [m.normalizedName, m.name]));
  for (const row of rows) {
    if (row.kind === 'TRANSFER' || row.merchantId) continue;
    const key = normalizeMerchantName(row.merchantOrSource);
    if (key && row.merchantOrSource !== nameByKey.get(key)) textChanges += 1;
  }

  merchants.sort(
    (a, b) => b.transactionIds.length - a.transactionIds.length || a.name.localeCompare(b.name)
  );
  return { merchants, blank, transfersSkipped, alreadyLinked, textChanges };
}
