// Groups raw INCOME transactions into one row per logical income entry
// (an entry may be split across several accounts).

export interface IncomePart {
  id: string;
  date: Date;
  amount: number;
  categoryId: string | null;
  subcategoryId?: string | null;
  accountId: string | null;
  merchantOrSource: string | null;
  notes: string | null;
  tags: string[];
  splitGroupId?: string | null;
  accountSplits?: Array<{ accountId: string; amount: number }> | null;
  category: { id: string; name: string; icon: string | null } | null;
  subcategory?: { id: string; name: string } | null;
  account: { id: string; name: string } | null;
}

export interface IncomeAccountSplit {
  accountId: string;
  name: string;
  amount: number;
}

export interface IncomeRow {
  id: string;
  memberIds: string[];
  date: Date;
  amount: number;
  categoryId: string | null;
  subcategoryId?: string | null;
  merchantOrSource: string | null;
  notes: string | null;
  tags: string[];
  splitGroupId?: string | null;
  category: { id: string; name: string; icon: string | null } | null;
  subcategory?: { id: string; name: string } | null;
  accounts: IncomeAccountSplit[];
}

function incomeFingerprint(item: IncomePart) {
  return [
    new Date(item.date).toISOString().slice(0, 10),
    item.categoryId || '',
    item.subcategoryId || '',
    item.merchantOrSource || '',
    item.notes || '',
    [...(item.tags || [])].map((t) => t.toLowerCase()).sort().join(','),
  ].join('|');
}

export function groupIncomeRows(
  parts: IncomePart[],
  accountNameById: Map<string, string>
): IncomeRow[] {
  const used = new Set<string>();
  const rows: IncomeRow[] = [];

  const resolveAccountName = (accountId: string, fallback?: string | null) =>
    accountNameById.get(accountId) || fallback || 'Unknown';

  // One DB row with embedded accountSplits = one income transaction
  for (const part of parts) {
    const splits = part.accountSplits || [];
    if (splits.length === 0) continue;
    used.add(part.id);
    rows.push({
      id: part.id,
      memberIds: [part.id],
      date: part.date,
      amount: part.amount,
      categoryId: part.categoryId,
      subcategoryId: part.subcategoryId,
      merchantOrSource: part.merchantOrSource,
      notes: part.notes,
      tags: part.tags,
      splitGroupId: part.splitGroupId,
      category: part.category,
      subcategory: part.subcategory,
      accounts: splits.map((s) => ({
        accountId: s.accountId,
        name: resolveAccountName(s.accountId, part.account?.name),
        amount: s.amount,
      })),
    });
  }

  // Legacy multi-row groups (pre accountSplits)
  const byGroup = new Map<string, IncomePart[]>();
  for (const part of parts) {
    if (used.has(part.id) || !part.splitGroupId) continue;
    const list = byGroup.get(part.splitGroupId) || [];
    list.push(part);
    byGroup.set(part.splitGroupId, list);
  }

  for (const [groupId, members] of byGroup) {
    members.forEach((m) => used.add(m.id));
    const sorted = [...members].sort((a, b) => b.amount - a.amount);
    const primary = sorted[0];
    rows.push({
      id: primary.id,
      memberIds: sorted.map((m) => m.id),
      date: primary.date,
      amount: sorted.reduce((sum, m) => sum + m.amount, 0),
      categoryId: primary.categoryId,
      subcategoryId: primary.subcategoryId,
      merchantOrSource: primary.merchantOrSource,
      notes: primary.notes,
      tags: primary.tags,
      splitGroupId: groupId,
      category: primary.category,
      subcategory: primary.subcategory,
      accounts: sorted.map((m) => ({
        accountId: m.accountId || '',
        name: resolveAccountName(m.accountId || '', m.account?.name),
        amount: m.amount,
      })),
    });
  }

  const leftover = parts.filter((p) => !used.has(p.id));
  const byFingerprint = new Map<string, IncomePart[]>();
  for (const part of leftover) {
    const key = incomeFingerprint(part);
    const list = byFingerprint.get(key) || [];
    list.push(part);
    byFingerprint.set(key, list);
  }

  for (const members of byFingerprint.values()) {
    const distinctAccounts = new Set(members.map((m) => m.accountId).filter(Boolean));
    const shouldMerge = members.length > 1 && distinctAccounts.size > 1;

    if (!shouldMerge) {
      for (const part of members) {
        rows.push({
          id: part.id,
          memberIds: [part.id],
          date: part.date,
          amount: part.amount,
          categoryId: part.categoryId,
          subcategoryId: part.subcategoryId,
          merchantOrSource: part.merchantOrSource,
          notes: part.notes,
          tags: part.tags,
          splitGroupId: part.splitGroupId,
          category: part.category,
          subcategory: part.subcategory,
          accounts: [
            {
              accountId: part.accountId || '',
              name: resolveAccountName(part.accountId || '', part.account?.name),
              amount: part.amount,
            },
          ],
        });
      }
      continue;
    }

    const sorted = [...members].sort((a, b) => b.amount - a.amount);
    const primary = sorted[0];
    rows.push({
      id: primary.id,
      memberIds: sorted.map((m) => m.id),
      date: primary.date,
      amount: sorted.reduce((sum, m) => sum + m.amount, 0),
      categoryId: primary.categoryId,
      subcategoryId: primary.subcategoryId,
      merchantOrSource: primary.merchantOrSource,
      notes: primary.notes,
      tags: primary.tags,
      splitGroupId: primary.splitGroupId,
      category: primary.category,
      subcategory: primary.subcategory,
      accounts: sorted.map((m) => ({
        accountId: m.accountId || '',
        name: resolveAccountName(m.accountId || '', m.account?.name),
        amount: m.amount,
      })),
    });
  }

  return rows.sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );
}
