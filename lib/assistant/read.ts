/**
 * Read-only queries behind the chat assistant's tools.
 *
 * Each function runs narrow Prisma queries and returns a compact, already
 * computed result. All arithmetic (totals, groupings, differences,
 * percentages, balances) happens here; the model only reads the numbers.
 *
 * Money rules match the rest of the app:
 *   - spending is EXPENSE rows, income is INCOME rows; transfers (including
 *     card payments) are never counted as either
 *   - spending is your share: what friends owe you for an expense
 *     (sharedAmount) is left out, as on the Budgets page (lib/expenseAllocations)
 *   - a split expense spreads its amount over its split items' categories
 *     (expenseCategoryAllocations)
 *   - balances, budgets, goals and recurring entries come from the same
 *     modules the app's pages use (ledgerBalances, budgetData, goals, recurring)
 *   - an income/expense with account splits spreads its amount over those
 *     accounts (amountAttributedToAccount)
 *   - dates are calendar days (lib/dates.ts); ranges are inclusive of both ends
 *
 * Free text that came from the user's data (merchant names, notes, tags,
 * friend entry descriptions) is returned as data only. The assistant's
 * instructions tell the model never to follow instructions found in it.
 */
import type { Prisma, PrismaClient, TransactionKind } from '@prisma/client';
import { loadBudgetMonth, type BudgetDb } from '@/lib/budgetData';
import {
  addDays,
  dayFilter,
  eachDay,
  isValidDay,
  parseDay,
  toDayString,
  type DayString,
} from '@/lib/dates';
import { expenseCategoryAllocations, myShareOfExpense } from '@/lib/expenseAllocations';
import { signedFriendAmount } from '@/lib/friends';
import { goalProgress as computeGoalProgress } from '@/lib/goals';
import { loadAccountBalances } from '@/lib/ledgerBalances';
import { buildUpcoming } from '@/lib/recurring';
import { detectRecurring } from '@/lib/recurringDetection';
import { FREQUENCY_LABELS, type Frequency } from '@/lib/recurringSchedule';

// ==================== CONTEXT ====================

export type ReadDb = Pick<
  PrismaClient,
  | 'transaction'
  | 'account'
  | 'category'
  | 'budget'
  | 'goal'
  | 'goalContribution'
  | 'friend'
  | 'friendEntry'
  | 'recurringTransaction'
  | 'dismissedRecurringSuggestion'
>;

export type ReadContext = {
  db: ReadDb;
  /** Today in the user's timezone (YYYY-MM-DD). */
  today: DayString;
};

/** A problem with the tool input the model can fix. The message is shown to the model. */
export class ToolInputError extends Error {}

function bad(message: string): never {
  throw new ToolInputError(message);
}

// ==================== MONEY ====================

/** Sums in cents so 0.1 + 0.2 style errors never reach an answer. */
class Total {
  private c = 0;
  add(amount: number) {
    this.c += amount * 100;
    return this;
  }
  get value() {
    return Math.round(this.c) / 100;
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const pct = (part: number, whole: number) =>
  whole === 0 ? null : Math.round((part / whole) * 1000) / 10;

/** Truncate user-entered free text so one long note cannot flood the context. */
function clip(text: string | null | undefined, max = 120): string | null {
  if (!text) return null;
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

// ==================== DATES ====================

export type DayRangeInput = { start: DayString; end: DayString };

function checkRange(range: DayRangeInput, label = 'Date range') {
  if (!isValidDay(range.start)) bad(`${label}: start "${range.start}" is not a real day (YYYY-MM-DD)`);
  if (!isValidDay(range.end)) bad(`${label}: end "${range.end}" is not a real day (YYYY-MM-DD)`);
  if (range.start > range.end) bad(`${label}: start ${range.start} is after end ${range.end}`);
}

/** Monday of the week containing `day`. */
function weekStart(day: DayString): DayString {
  const dow = parseDay(day).getUTCDay(); // 0 = Sunday
  return addDays(day, -((dow + 6) % 7));
}

function daysBetween(a: DayString, b: DayString) {
  return Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / 86_400_000);
}

// ==================== LOOKUPS ====================

type Lookups = {
  categories: Map<string, { id: string; name: string; type: string }>;
  accounts: Map<string, { id: string; name: string; type: string }>;
};

async function loadLookups(db: ReadDb): Promise<Lookups> {
  const [categories, accounts] = await Promise.all([
    db.category.findMany({ select: { id: true, name: true, type: true } }),
    db.account.findMany({ select: { id: true, name: true, type: true } }),
  ]);
  return {
    categories: new Map(categories.map((c) => [c.id, c])),
    accounts: new Map(accounts.map((a) => [a.id, a])),
  };
}

function checkIds(ids: string[] | undefined, map: Map<string, unknown>, label: string) {
  for (const id of ids ?? []) {
    if (!map.has(id)) bad(`Unknown ${label} id "${id}". Use an id from the ${label} list.`);
  }
}

// ==================== FILTERS ====================

export type TransactionFilters = {
  kind?: TransactionKind;
  start?: DayString;
  end?: DayString;
  categoryIds?: string[];
  accountIds?: string[];
  /** Case-insensitive substring of the merchant / source. */
  merchant?: string;
  /** Case-insensitive substring of merchant, notes or category name, or an exact tag. */
  text?: string;
  minAmount?: number;
  maxAmount?: number;
};

function buildWhere(f: TransactionFilters, lookups: Lookups): Prisma.TransactionWhereInput {
  if (f.start && !isValidDay(f.start)) bad(`start "${f.start}" is not a real day (YYYY-MM-DD)`);
  if (f.end && !isValidDay(f.end)) bad(`end "${f.end}" is not a real day (YYYY-MM-DD)`);
  if (f.start && f.end && f.start > f.end) bad(`start ${f.start} is after end ${f.end}`);
  if (f.minAmount !== undefined && f.maxAmount !== undefined && f.minAmount > f.maxAmount) {
    bad('minAmount is larger than maxAmount');
  }
  checkIds(f.categoryIds, lookups.categories, 'category');
  checkIds(f.accountIds, lookups.accounts, 'account');

  const and: Prisma.TransactionWhereInput[] = [];
  if (f.categoryIds?.length) {
    and.push({
      OR: [
        { categoryId: { in: f.categoryIds } },
        { splitItems: { some: { categoryId: { in: f.categoryIds } } } },
      ],
    });
  }
  if (f.accountIds?.length) {
    and.push({
      OR: [
        { accountId: { in: f.accountIds } },
        { toAccountId: { in: f.accountIds } },
        { accountSplits: { some: { accountId: { in: f.accountIds } } } },
      ],
    });
  }
  const text = f.text?.trim();
  if (text) {
    const nameHits = [...lookups.categories.values()]
      .filter((c) => c.name.toLowerCase().includes(text.toLowerCase()))
      .map((c) => c.id);
    and.push({
      OR: [
        { merchantOrSource: { contains: text, mode: 'insensitive' } },
        { notes: { contains: text, mode: 'insensitive' } },
        { tags: { has: text } },
        ...(nameHits.length ? [{ categoryId: { in: nameHits } }] : []),
      ],
    });
  }

  const merchant = f.merchant?.trim();
  return {
    ...(f.kind ? { kind: f.kind } : {}),
    ...(f.start || f.end ? { date: dayFilter(f.start, f.end) } : {}),
    ...(merchant ? { merchantOrSource: { contains: merchant, mode: 'insensitive' as const } } : {}),
    ...(f.minAmount !== undefined || f.maxAmount !== undefined
      ? {
          amount: {
            ...(f.minAmount !== undefined ? { gte: f.minAmount } : {}),
            ...(f.maxAmount !== undefined ? { lte: f.maxAmount } : {}),
          },
        }
      : {}),
    ...(and.length ? { AND: and } : {}),
  };
}

// ==================== ALLOCATION ====================

const amountFields = {
  id: true,
  date: true,
  amount: true,
  kind: true,
  categoryId: true,
  accountId: true,
  toAccountId: true,
  merchantOrSource: true,
  splitItems: true,
  accountSplits: true,
  sharedAmount: true,
} satisfies Prisma.TransactionSelect;

type AmountRow = Prisma.TransactionGetPayload<{ select: typeof amountFields }>;

type Share = { categoryId: string | null; accountId: string | null; amount: number };

/**
 * How one transaction's amount is spread over (category, account) pairs.
 * Category splits and account splits are applied proportionally. For an
 * expense the shares add up to your share (amount minus what friends owe);
 * for income and transfers, to the full amount.
 */
export function shares(t: {
  amount: number;
  kind: TransactionKind;
  categoryId: string | null;
  accountId: string | null;
  splitItems?: { categoryId: string; amount: number }[] | null;
  accountSplits?: { accountId: string; amount: number }[] | null;
  sharedAmount?: number | null;
}): Share[] {
  const cats: { categoryId: string | null; amount: number }[] =
    t.kind === 'EXPENSE'
      ? expenseCategoryAllocations(t)
      : t.categoryId
      ? [{ categoryId: t.categoryId, amount: t.amount }]
      : [];
  const total = t.kind === 'EXPENSE' ? myShareOfExpense(t) : t.amount;
  const catList = cats.length ? cats : [{ categoryId: null, amount: total }];
  const accts =
    t.kind !== 'TRANSFER' && (t.accountSplits?.length ?? 0) > 0
      ? t.accountSplits!
      : [{ accountId: t.accountId as string | null, amount: t.amount }];
  return catList.flatMap((c) =>
    accts.map((a) => ({
      categoryId: c.categoryId,
      accountId: a.accountId,
      amount: t.amount === 0 ? 0 : (c.amount * a.amount) / t.amount,
    }))
  );
}

/** The shares that pass the category / account filters. */
function filteredShares(t: AmountRow, f: TransactionFilters): Share[] {
  return shares(t).filter(
    (s) =>
      (!f.categoryIds?.length || (s.categoryId !== null && f.categoryIds.includes(s.categoryId))) &&
      (!f.accountIds?.length ||
        (s.accountId !== null && f.accountIds.includes(s.accountId)) ||
        (t.kind === 'TRANSFER' && !!t.toAccountId && f.accountIds.includes(t.toAccountId)))
  );
}

// ==================== SEARCH ====================

export type SearchInput = TransactionFilters & { limit?: number; offset?: number };

const MAX_TOTALS_ROWS = 20_000;

export async function searchTransactions(ctx: ReadContext, input: SearchInput) {
  const lookups = await loadLookups(ctx.db);
  const where = buildWhere(input, lookups);
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
  const offset = Math.max(input.offset ?? 0, 0);

  const [matchCount, rows] = await Promise.all([
    ctx.db.transaction.count({ where }),
    ctx.db.transaction.findMany({
      where,
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      skip: offset,
      take: limit,
      select: { ...amountFields, subcategoryId: true, notes: true, tags: true },
    }),
  ]);

  let totals: { expense: number; income: number; transfer: number } | null = null;
  if (matchCount <= MAX_TOTALS_ROWS) {
    const all = await ctx.db.transaction.findMany({ where, select: amountFields });
    const t = { EXPENSE: new Total(), INCOME: new Total(), TRANSFER: new Total() };
    for (const row of all) {
      for (const s of filteredShares(row, input)) t[row.kind].add(s.amount);
    }
    totals = { expense: t.EXPENSE.value, income: t.INCOME.value, transfer: t.TRANSFER.value };
  }

  const name = (id: string | null, map: Map<string, { name: string }>) =>
    id ? map.get(id)?.name ?? '(deleted)' : null;

  return {
    matchCount,
    offset,
    returned: rows.length,
    nextOffset: offset + rows.length < matchCount ? offset + rows.length : null,
    totalsOfAllMatches: totals,
    ...(totals === null ? { note: 'Too many matches to total; narrow the filters or use summarizeTransactions.' } : {}),
    transactions: rows.map((t) => ({
      id: t.id,
      date: toDayString(t.date),
      kind: t.kind,
      amount: round2(t.amount),
      ...(t.kind === 'EXPENSE' && (t.sharedAmount ?? 0) > 0
        ? { yourShare: round2(myShareOfExpense(t)), friendsOwe: round2(t.sharedAmount!) }
        : {}),
      merchant: clip(t.merchantOrSource, 80),
      category:
        t.splitItems.length > 0
          ? t.splitItems
              .map((s) => `${name(s.categoryId, lookups.categories)} ${round2(s.amount).toFixed(2)}`)
              .join(' + ')
          : name(t.categoryId, lookups.categories),
      account:
        t.accountSplits.length > 1
          ? t.accountSplits
              .map((s) => `${name(s.accountId, lookups.accounts)} ${round2(s.amount).toFixed(2)}`)
              .join(' + ')
          : name(t.accountId, lookups.accounts),
      ...(t.kind === 'TRANSFER' ? { toAccount: name(t.toAccountId, lookups.accounts) } : {}),
      ...(t.notes ? { notes: clip(t.notes) } : {}),
      ...(t.tags.length ? { tags: t.tags.slice(0, 8) } : {}),
    })),
  };
}

// ==================== SUMMARIZE ====================

export type GroupBy = 'category' | 'merchant' | 'account' | 'day' | 'week' | 'month' | 'none';

export type SummarizeInput = Omit<TransactionFilters, 'kind' | 'start' | 'end'> & {
  kind: 'EXPENSE' | 'INCOME';
  start: DayString;
  end: DayString;
  groupBy: GroupBy;
  /** Max groups for category / merchant / account; the rest are folded into "other". */
  limit?: number;
};

type Group = { key: string; label: string; amount: number; count: number };

const MAX_TIME_BUCKETS = 400;

function merchantKey(name: string | null) {
  return name ? name.trim().replace(/\s+/g, ' ').toLowerCase() : '';
}

async function groupTotals(
  ctx: ReadContext,
  lookups: Lookups,
  input: SummarizeInput
): Promise<{ total: number; count: number; groups: Map<string, Group> }> {
  const where = buildWhere({ ...input }, lookups);
  const rows = await ctx.db.transaction.findMany({ where, select: amountFields });

  const groups = new Map<string, { label: string; total: Total; ids: Set<string> }>();
  const total = new Total();
  const counted = new Set<string>();

  const bucket = (key: string, label: string) => {
    let g = groups.get(key);
    if (!g) {
      g = { label, total: new Total(), ids: new Set() };
      groups.set(key, g);
    }
    return g;
  };

  // Time buckets are zero-filled so gaps show up as 0.
  if (input.groupBy === 'day' || input.groupBy === 'week' || input.groupBy === 'month') {
    const keys = new Set<string>();
    for (const d of eachDay(input.start, input.end)) {
      keys.add(input.groupBy === 'day' ? d : input.groupBy === 'week' ? weekStart(d) : d.slice(0, 7));
      if (keys.size > MAX_TIME_BUCKETS) {
        bad(`Too many ${input.groupBy} buckets for this range; group by a longer period.`);
      }
    }
    for (const k of keys) bucket(k, input.groupBy === 'week' ? `week of ${k}` : k);
  }

  for (const row of rows) {
    const day = toDayString(row.date);
    for (const s of filteredShares(row, input)) {
      let key: string;
      let label: string;
      switch (input.groupBy) {
        case 'category':
          key = s.categoryId ?? 'none';
          label = s.categoryId
            ? lookups.categories.get(s.categoryId)?.name ?? '(deleted category)'
            : '(uncategorised)';
          break;
        case 'account':
          key = s.accountId ?? 'none';
          label = s.accountId ? lookups.accounts.get(s.accountId)?.name ?? '(deleted account)' : '(no account)';
          break;
        case 'merchant':
          key = merchantKey(row.merchantOrSource) || 'none';
          label = row.merchantOrSource?.trim().replace(/\s+/g, ' ') || '(no merchant)';
          break;
        case 'day':
          key = label = day;
          break;
        case 'week':
          key = weekStart(day);
          label = `week of ${key}`;
          break;
        case 'month':
          key = label = day.slice(0, 7);
          break;
        default:
          key = 'all';
          label = 'All';
      }
      const g = bucket(key, clip(label, 80) ?? label);
      g.total.add(s.amount);
      g.ids.add(row.id);
      total.add(s.amount);
      counted.add(row.id);
    }
  }

  const out = new Map<string, Group>();
  for (const [key, g] of groups) {
    out.set(key, { key, label: g.label, amount: g.total.value, count: g.ids.size });
  }
  return { total: total.value, count: counted.size, groups: out };
}

const isTimeGroup = (g: GroupBy) => g === 'day' || g === 'week' || g === 'month';

export async function summarizeTransactions(ctx: ReadContext, input: SummarizeInput) {
  checkRange(input);
  const lookups = await loadLookups(ctx.db);
  const { total, count, groups } = await groupTotals(ctx, lookups, input);
  const limit = Math.min(Math.max(input.limit ?? 15, 1), 100);

  let list = [...groups.values()];
  let other: { groups: number; amount: number; count: number } | null = null;
  if (isTimeGroup(input.groupBy)) {
    list.sort((a, b) => a.key.localeCompare(b.key));
  } else if (input.groupBy !== 'none') {
    list.sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label));
    if (list.length > limit) {
      const rest = list.slice(limit);
      const sum = new Total();
      rest.forEach((g) => sum.add(g.amount));
      other = { groups: rest.length, amount: sum.value, count: rest.reduce((n, g) => n + g.count, 0) };
      list = list.slice(0, limit);
    }
  }

  return {
    kind: input.kind,
    start: input.start,
    end: input.end,
    days: daysBetween(input.start, input.end) + 1,
    total,
    transactionCount: count,
    ...(isTimeGroup(input.groupBy) && list.length > 0
      ? { averagePerBucket: round2(total / list.length) }
      : {}),
    groupBy: input.groupBy,
    groups:
      input.groupBy === 'none'
        ? []
        : list.map((g) => ({
            ...((input.groupBy === 'category' || input.groupBy === 'account') && g.key !== 'none'
              ? { id: g.key }
              : {}),
            name: g.label,
            amount: g.amount,
            count: g.count,
            sharePct: pct(g.amount, total),
          })),
    ...(other ? { otherGroups: other } : {}),
  };
}

// ==================== COMPARE ====================

export type CompareInput = Omit<TransactionFilters, 'kind' | 'start' | 'end'> & {
  kind: 'EXPENSE' | 'INCOME';
  periodA: DayRangeInput & { label?: string };
  periodB: DayRangeInput & { label?: string };
  groupBy?: 'category' | 'merchant' | 'account' | 'none';
  limit?: number;
};

export async function comparePeriods(ctx: ReadContext, input: CompareInput) {
  checkRange(input.periodA, 'periodA');
  checkRange(input.periodB, 'periodB');
  const lookups = await loadLookups(ctx.db);
  const groupBy = input.groupBy ?? 'none';
  const base = { ...input, groupBy } as const;
  const [a, b] = await Promise.all([
    groupTotals(ctx, lookups, { ...base, ...input.periodA }),
    groupTotals(ctx, lookups, { ...base, ...input.periodB }),
  ]);

  const change = (x: number, y: number) => ({
    change: round2(y - x),
    changePct: x === 0 ? null : Math.round(((y - x) / x) * 1000) / 10,
  });

  const keys = new Set([...a.groups.keys(), ...b.groups.keys()]);
  const limit = Math.min(Math.max(input.limit ?? 15, 1), 100);
  const rows = [...keys]
    .map((key) => {
      const ga = a.groups.get(key);
      const gb = b.groups.get(key);
      const amountA = ga?.amount ?? 0;
      const amountB = gb?.amount ?? 0;
      return {
        ...(groupBy === 'category' || groupBy === 'account' ? (key !== 'none' ? { id: key } : {}) : {}),
        name: (gb ?? ga)!.label,
        periodA: amountA,
        periodB: amountB,
        ...change(amountA, amountB),
      };
    })
    .sort((x, y) => Math.abs(y.change) - Math.abs(x.change) || x.name.localeCompare(y.name));

  const label = (p: CompareInput['periodA'], fallback: string) =>
    p.label?.trim() ? clip(p.label, 40)! : fallback;

  return {
    kind: input.kind,
    periodA: {
      label: label(input.periodA, 'A'),
      start: input.periodA.start,
      end: input.periodA.end,
      total: a.total,
      transactionCount: a.count,
    },
    periodB: {
      label: label(input.periodB, 'B'),
      start: input.periodB.start,
      end: input.periodB.end,
      total: b.total,
      transactionCount: b.count,
    },
    /** periodB minus periodA. */
    ...change(a.total, b.total),
    ...(groupBy === 'none'
      ? {}
      : {
          groupBy,
          groups: rows.slice(0, limit),
          ...(rows.length > limit ? { moreGroups: rows.length - limit } : {}),
        }),
  };
}

// ==================== ACCOUNTS ====================

type AccountRow = {
  id: string;
  name: string;
  type: string;
  institution?: string | null;
  balance: number;
  /** Balance minus money set aside for goals (only when something is set aside). */
  earmarkedForGoals?: number;
  available?: number;
  /** Credit cards and loans: amount owed (never negative). */
  owed?: number;
  creditLimit?: number | null;
  availableCredit?: number;
  utilizationPct?: number | null;
};

/** Same figures as the Accounts page (lib/ledgerBalances.ts). */
export async function accountBalances(ctx: ReadContext) {
  const accounts = await loadAccountBalances(ctx.db);

  const assets = new Total();
  const available = new Total();
  const cardDebt = new Total();
  const loanDebt = new Total();
  const net = new Total();
  const limits = new Total();
  const owedOnLimitedCards = new Total();

  const rows = accounts.map((a): AccountRow => {
    const balance = round2(a.currentBalance);
    net.add(balance);
    const base: AccountRow = {
      id: a.id,
      name: a.name,
      type: a.type,
      ...(a.institution ? { institution: clip(a.institution, 60) } : {}),
      balance,
      ...(a.earmarked > 0
        ? { earmarkedForGoals: round2(a.earmarked), available: round2(a.available) }
        : {}),
    };
    if (a.type === 'CREDIT_CARD') {
      const owed = round2(Math.max(0, -balance));
      cardDebt.add(owed);
      if (a.creditLimit && a.creditLimit > 0) {
        limits.add(a.creditLimit);
        owedOnLimitedCards.add(owed);
        return {
          ...base,
          owed,
          creditLimit: a.creditLimit,
          availableCredit: round2(a.creditLimit - owed),
          utilizationPct: pct(owed, a.creditLimit),
        };
      }
      return { ...base, owed, creditLimit: null, utilizationPct: null };
    }
    if (a.type === 'LOAN') {
      loanDebt.add(Math.max(0, -balance));
      return { ...base, owed: round2(Math.max(0, -balance)) };
    }
    assets.add(balance);
    available.add(a.available);
    return base;
  });

  return {
    accounts: rows,
    totals: {
      /** Checking, savings, cash and investment balances. */
      assets: assets.value,
      /** Assets minus money set aside for goals. */
      availableAssets: available.value,
      creditCardDebt: cardDebt.value,
      loanDebt: loanDebt.value,
      /** Sum of every account balance (debts are negative). */
      netBalance: net.value,
      overallCreditUtilizationPct: pct(owedOnLimitedCards.value, limits.value),
    },
  };
}

// ==================== BUDGETS ====================

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Same figures as the Budgets page (lib/budgetData.ts): rollover, pacing, your share. */
export async function budgetStatus(ctx: ReadContext, input: { month?: string }) {
  const month = input.month ?? ctx.today.slice(0, 7);
  if (!MONTH_RE.test(month)) bad(`month "${month}" must look like YYYY-MM`);

  const data = await loadBudgetMonth(month, ctx.today, ctx.db as unknown as BudgetDb);
  const budgeted = data.rows.filter((r) => r.budget);

  return {
    month,
    pacing: {
      daysInMonth: data.pacing.daysInMonth,
      daysElapsed: data.pacing.daysElapsed,
      monthElapsedPct: Math.round(data.pacing.fraction * 1000) / 10,
      isCurrentMonth: data.pacing.isCurrent,
    },
    totals: {
      budgeted: round2(data.totals.budgeted),
      /** Budgets plus amounts rolled over from earlier months. */
      available: round2(data.totals.available),
      spentInBudgetedCategories: round2(data.totals.spentInBudgets),
      remaining: round2(data.totals.remaining),
      totalSpending: round2(data.totals.totalSpent),
      categoriesOver: data.totals.overCount,
    },
    budgets: budgeted
      .map((r) => ({
        categoryId: r.categoryId,
        category: r.name,
        budget: round2(r.budget!.amount),
        ...(r.budget!.rolloverEnabled ? { rolledOver: round2(r.budget!.carryIn) } : {}),
        available: round2(r.budget!.available),
        spent: round2(r.spent),
        remaining: round2(r.budget!.remaining),
        // used is Infinity when nothing is available but money was spent.
        usedPct: Number.isFinite(r.budget!.used) ? Math.round(r.budget!.used * 1000) / 10 : null,
        /** over | near (close to the limit) | ahead (spending faster than the month) | ok */
        status: r.budget!.status,
      }))
      .sort((a, b) => (b.usedPct ?? Infinity) - (a.usedPct ?? Infinity)),
    unbudgetedSpending: data.rows
      .filter((r) => !r.budget && r.spent > 0)
      .map((r) => ({ category: r.name, spent: round2(r.spent) }))
      .sort((a, b) => b.spent - a.spent)
      .slice(0, 15),
    ...(data.uncategorizedSpent > 0 ? { uncategorizedSpent: round2(data.uncategorizedSpent) } : {}),
    ...(budgeted.length === 0 ? { note: `No budgets are set for ${month}.` } : {}),
  };
}

// ==================== GOALS ====================

/** Same progress figures as the Goals page (lib/goals.ts). */
export async function goalProgress(ctx: ReadContext) {
  const [goals, contributions, accounts] = await Promise.all([
    ctx.db.goal.findMany({ orderBy: { name: 'asc' } }),
    ctx.db.goalContribution.findMany({
      select: { goalId: true, amount: true, date: true, transactionId: true },
    }),
    ctx.db.account.findMany({ select: { id: true, name: true } }),
  ]);
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));

  return {
    goals: goals.map((g) => {
      const mine = contributions.filter((c) => c.goalId === g.id);
      const p = computeGoalProgress({ targetAmount: g.targetAmount, contributions: mine });
      const saved = round2(p.totalContributions);
      const remaining = round2(p.remaining);
      const last = mine.reduce<DayString | null>((max, c) => {
        const d = toDayString(c.date);
        return !max || d > max ? d : max;
      }, null);
      const due = g.dueDate ? toDayString(g.dueDate) : null;
      const daysLeft = due ? daysBetween(ctx.today, due) : null;
      const monthsLeft = daysLeft !== null && daysLeft > 0 ? daysLeft / 30.4375 : null;
      return {
        id: g.id,
        name: clip(g.name, 80),
        target: round2(g.targetAmount),
        saved,
        /** Moved into the goal's account by transfer. */
        transferred: round2(p.transferred),
        /** Set aside in place on the source account. */
        earmarked: round2(p.earmarked),
        remaining,
        progressPct: Math.round(p.progress * 10) / 10,
        complete: remaining === 0,
        account: g.accountId ? accountName.get(g.accountId) ?? null : null,
        dueDate: due,
        daysLeft,
        ...(remaining > 0 && monthsLeft
          ? { neededPerMonth: round2(remaining / Math.max(monthsLeft, 1)) }
          : {}),
        ...(remaining > 0 && daysLeft !== null && daysLeft < 0 ? { overdue: true } : {}),
        contributions: mine.length,
        lastContribution: last,
      };
    }),
  };
}

// ==================== FRIENDS ====================

export async function friendBalances(ctx: ReadContext, input: { friendId?: string }) {
  const [friends, entries] = await Promise.all([
    ctx.db.friend.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    ctx.db.friendEntry.findMany({
      select: { friendId: true, amount: true, type: true, date: true, description: true },
      orderBy: { date: 'desc' },
    }),
  ]);
  if (input.friendId && !friends.some((f) => f.id === input.friendId)) {
    bad(`Unknown friend id "${input.friendId}". Call friendBalances without friendId to list friends.`);
  }

  const owedToYou = new Total();
  const youOwe = new Total();
  const rows = friends.map((f) => {
    const mine = entries.filter((e) => e.friendId === f.id);
    const bal = new Total();
    mine.forEach((e) => bal.add(signedFriendAmount(e.type, e.amount)));
    const balance = bal.value;
    if (balance > 0) owedToYou.add(balance);
    if (balance < 0) youOwe.add(-balance);
    return {
      id: f.id,
      name: clip(f.name, 60),
      /** Positive: they owe you. Negative: you owe them. */
      balance,
      lastEntry: mine[0] ? toDayString(mine[0].date) : null,
      ...(input.friendId === f.id
        ? {
            recentEntries: mine.slice(0, 15).map((e) => ({
              date: toDayString(e.date),
              type: e.type,
              amount: round2(e.amount),
              description: clip(e.description, 80),
            })),
          }
        : {}),
    };
  });

  return {
    friends: input.friendId ? rows.filter((r) => r.id === input.friendId) : rows,
    totals: {
      owedToYou: owedToYou.value,
      youOwe: youOwe.value,
      net: round2(owedToYou.value - youOwe.value),
    },
  };
}

// ==================== RECURRING ====================

/** How much history pattern detection looks at (same as the Recurring page). */
const DETECTION_DAYS = 800;

/**
 * Bills, subscriptions and paychecks due in the next `days` days, from the
 * user's recurring entries (lib/recurring.ts), plus repeating patterns the
 * app has noticed but the user has not set up yet (lib/recurringDetection.ts).
 */
export async function upcomingRecurring(
  ctx: ReadContext,
  input: { days?: number; kind?: 'EXPENSE' | 'INCOME' }
) {
  const days = Math.min(Math.max(Math.round(input.days ?? 30), 1), 365);
  const horizon = addDays(ctx.today, days);

  const [lookups, entries, history, existing, dismissed] = await Promise.all([
    loadLookups(ctx.db),
    ctx.db.recurringTransaction.findMany({
      where: { active: true, nextDueDate: { lte: parseDay(horizon) } },
    }),
    ctx.db.transaction.findMany({
      where: {
        kind: { in: ['INCOME', 'EXPENSE'] },
        date: { gte: parseDay(addDays(ctx.today, -DETECTION_DAYS)) },
      },
      select: {
        id: true,
        date: true,
        amount: true,
        kind: true,
        merchantOrSource: true,
        merchantId: true,
        categoryId: true,
        subcategoryId: true,
        accountId: true,
        recurringId: true,
        splitItems: true,
      },
      orderBy: { date: 'asc' },
    }),
    ctx.db.recurringTransaction.findMany({
      select: { kind: true, merchantOrSource: true, amount: true, active: true },
    }),
    ctx.db.dismissedRecurringSuggestion.findMany({ select: { key: true } }),
  ]);

  const name = (id: string | null, map: Map<string, { name: string }>) =>
    id ? map.get(id)?.name ?? null : null;

  const upcoming = buildUpcoming(
    entries.map((e) => ({
      ...e,
      category: e.categoryId
        ? { name: name(e.categoryId, lookups.categories) ?? '(deleted category)', color: '', icon: null }
        : null,
      account: { name: name(e.accountId, lookups.accounts) ?? '(deleted account)' },
    })),
    ctx.today,
    days
  ).filter((i) => !input.kind || i.kind === input.kind);

  const suggestions = detectRecurring(history, {
    today: ctx.today,
    existing,
    dismissed: dismissed.map((d) => d.key),
  }).filter((s) => (!input.kind || s.kind === input.kind) && s.nextDueDate <= horizon);

  const expenses = new Total();
  const income = new Total();
  for (const i of upcoming) {
    if (i.kind === 'EXPENSE') expenses.add(i.amount);
    if (i.kind === 'INCOME') income.add(i.amount);
  }

  return {
    from: ctx.today,
    to: horizon,
    /** From the user's recurring entries (Plan › Recurring). */
    scheduled: upcoming.map((i) => ({
      name: clip(i.name, 80),
      kind: i.kind,
      amount: round2(i.amount),
      dueDate: i.dueDate,
      status: i.overdue ? 'overdue' : i.dueDate === ctx.today ? 'due-today' : 'upcoming',
      postsAutomatically: i.autoPost,
      category: i.categoryName,
      account: i.accountName,
    })),
    totals: { scheduledExpenses: expenses.value, scheduledIncome: income.value },
    /** Repeating patterns found in past transactions that are not set up as recurring entries. */
    notSetUpYet: suggestions.slice(0, 10).map((s) => ({
      merchant: clip(s.merchantName, 80),
      kind: s.kind,
      frequency: FREQUENCY_LABELS[s.frequency as Frequency] ?? s.frequency,
      expectedAmount: round2(s.amount),
      expectedDate: s.nextDueDate,
      lastDate: s.lastDate,
      occurrences: s.occurrences,
      category: name(s.categoryId, lookups.categories),
      account: name(s.accountId, lookups.accounts),
    })),
  };
}
