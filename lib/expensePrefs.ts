/**
 * Remembers the last-used values in the expense form so the next entry needs
 * fewer taps. Everything lives in localStorage and every access is guarded:
 * private mode, disabled storage or corrupt JSON just fall back to defaults.
 */

const STORAGE_KEY = 'tracker26.expensePrefs.v1';
const MAX_MERCHANTS = 200;

export interface MerchantMemory {
  name: string;
  categoryId: string | null;
  subcategoryId: string | null;
  accountId: string | null;
  usedAt: number;
}

export interface ExpensePrefs {
  lastAccountId: string | null;
  /** categoryId -> accountId last used with it */
  accountByCategory: Record<string, string>;
  /** lower-cased merchant name -> what was used with it last time */
  merchants: Record<string, MerchantMemory>;
}

const EMPTY: ExpensePrefs = { lastAccountId: null, accountByCategory: {}, merchants: {} };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function loadExpensePrefs(): ExpensePrefs {
  if (typeof window === 'undefined') return { ...EMPTY };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...EMPTY };
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return { ...EMPTY };

    const accountByCategory: Record<string, string> = {};
    if (isRecord(parsed.accountByCategory)) {
      for (const [k, v] of Object.entries(parsed.accountByCategory)) {
        if (typeof v === 'string') accountByCategory[k] = v;
      }
    }

    const merchants: Record<string, MerchantMemory> = {};
    if (isRecord(parsed.merchants)) {
      for (const [k, v] of Object.entries(parsed.merchants)) {
        if (!isRecord(v) || typeof v.name !== 'string') continue;
        merchants[k] = {
          name: v.name,
          categoryId: typeof v.categoryId === 'string' ? v.categoryId : null,
          subcategoryId: typeof v.subcategoryId === 'string' ? v.subcategoryId : null,
          accountId: typeof v.accountId === 'string' ? v.accountId : null,
          usedAt: typeof v.usedAt === 'number' ? v.usedAt : 0,
        };
      }
    }

    return {
      lastAccountId: typeof parsed.lastAccountId === 'string' ? parsed.lastAccountId : null,
      accountByCategory,
      merchants,
    };
  } catch {
    return { ...EMPTY };
  }
}

function save(prefs: ExpensePrefs) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Storage full or unavailable — remembering is a convenience, not a requirement.
  }
}

export function rememberExpense(entry: {
  accountId?: string | null;
  categoryId?: string | null;
  subcategoryId?: string | null;
  merchant?: string | null;
}) {
  if (typeof window === 'undefined') return;
  const prefs = loadExpensePrefs();

  if (entry.accountId) prefs.lastAccountId = entry.accountId;
  if (entry.categoryId && entry.accountId) {
    prefs.accountByCategory[entry.categoryId] = entry.accountId;
  }

  const merchant = entry.merchant?.trim();
  if (merchant) {
    prefs.merchants[merchant.toLowerCase()] = {
      name: merchant,
      categoryId: entry.categoryId || null,
      subcategoryId: entry.subcategoryId || null,
      accountId: entry.accountId || null,
      usedAt: Date.now(),
    };
    const keys = Object.keys(prefs.merchants);
    if (keys.length > MAX_MERCHANTS) {
      keys
        .sort((a, b) => prefs.merchants[a].usedAt - prefs.merchants[b].usedAt)
        .slice(0, keys.length - MAX_MERCHANTS)
        .forEach((k) => delete prefs.merchants[k]);
    }
  }

  save(prefs);
}
