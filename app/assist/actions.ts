'use server';

/**
 * Server actions behind the AI helpers in the forms and lists: quick-add
 * text, category suggestions, natural-language search, and the (model-free)
 * duplicate check.
 *
 * Every one of them is optional to the flow it sits in. They return null when
 * no key is configured, the model is slow (a few seconds at most) or anything
 * fails, and the caller carries on with the manual flow. Results are cached
 * in memory per merchant / text, so repeating an entry costs nothing.
 */
import { prisma } from '@/lib/prisma';
import { getHelperModel } from '@/lib/assistant/model';
import { classifyEntry, type ClassifyCategory } from '@/lib/ai/classify';
import { interpretSearch, type SearchResult } from '@/lib/ai/nlSearch';
import { findDuplicate, type DuplicateMatch, type DuplicateProbe } from '@/lib/duplicates';
import { isValidDay, todayInAppTimeZone } from '@/lib/dates';
import { normalizeMerchantName } from '@/lib/merchants';
import { loadChatReference } from '@/lib/assistant/starters';
import { rateLimit } from '@/lib/rateLimit';
import { requireSession } from '@/lib/auth/session';

const MODEL_TIMEOUT_MS = 6000;
const CACHE_LIMIT = 500;
const SYSTEM_CATEGORY_NAMES = new Set(['Payment', 'Debt Payment']);
const OBJECT_ID = /^[a-f\d]{24}$/i;

// On globalThis so a dev-server reload keeps it, like the Prisma client.
const globalCache = globalThis as unknown as { assistCache?: Map<string, unknown> };
const cache = (globalCache.assistCache ??= new Map<string, unknown>());

function remember<T>(key: string, value: T): T {
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  cache.set(key, value);
  return value;
}

async function expenseCategories(): Promise<ClassifyCategory[]> {
  const rows = await prisma.category.findMany({
    where: { type: 'EXPENSE' },
    select: { id: true, name: true, subcategories: { select: { id: true, name: true }, orderBy: { name: 'asc' } } },
    orderBy: { name: 'asc' },
  });
  return rows.filter((c) => !SYSTEM_CATEGORY_NAMES.has(c.name));
}

/** Part of every cache key: a changed category list must not serve stale ids. */
const listKey = (categories: ClassifyCategory[]) =>
  categories.map((c) => `${c.id}${(c.subcategories ?? []).map((s) => s.id).join('')}`).join(',');

export type QuickAddGuess = {
  categoryId: string | null;
  subcategoryId: string | null;
  merchant: string | null;
  notes: string | null;
  confident: boolean;
};

/**
 * Quick add: what the code-side parser (lib/ai/quickAddParse.ts) could not
 * place. `text` is the whole line, for context.
 */
export async function interpretQuickAdd(text: string): Promise<QuickAddGuess | null> {
  await requireSession();
  try {
    const line = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (line.length < 3) return null;
    const config = getHelperModel();
    if (!config.ok) return null;
    const categories = await expenseCategories();
    if (categories.length === 0) return null;
    const key = `quick|${listKey(categories)}|${line.toLowerCase()}`;
    if (cache.has(key)) return cache.get(key) as QuickAddGuess;
    if (!rateLimit('aiHelper').ok) return null;
    const guess = await classifyEntry({
      model: config.model,
      text: line,
      categories,
      abortSignal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
    });
    return remember(key, guess);
  } catch (error) {
    console.error('Quick add: model unavailable:', error instanceof Error ? `${error.name}: ${error.message}` : 'unknown');
    return null;
  }
}

export type CategorySuggestion = {
  categoryId: string;
  subcategoryId: string | null;
  accountId: string | null;
  /** history: used with this merchant before. model: a guess from the name. */
  source: 'history' | 'model';
};

/**
 * A category (and, from history, an account) for a merchant or note being
 * typed. History first: it is free. The model is asked only for a merchant
 * that has never been used, and only suggests when it is sure.
 */
export async function suggestCategory(input: {
  merchant?: string | null;
  notes?: string | null;
}): Promise<CategorySuggestion | null> {
  await requireSession();
  try {
    const merchant = String(input?.merchant ?? '').replace(/\s+/g, ' ').trim().slice(0, 100);
    const notes = String(input?.notes ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (merchant.length < 3 && notes.length < 3) return null;

    const merchantKey = normalizeMerchantName(merchant);
    if (merchantKey) {
      const known = await prisma.merchant.findUnique({
        where: { normalizedName: merchantKey },
        select: { id: true, defaultCategoryId: true, defaultSubcategoryId: true, defaultAccountId: true },
      });
      if (known) {
        const last = await prisma.transaction.findFirst({
          where: { merchantId: known.id, kind: 'EXPENSE', categoryId: { not: null } },
          orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
          select: { categoryId: true, subcategoryId: true, accountId: true },
        });
        const categoryId = known.defaultCategoryId ?? last?.categoryId ?? null;
        const category = categoryId
          ? await prisma.category.findUnique({ where: { id: categoryId }, select: { type: true } })
          : null;
        if (categoryId && category?.type === 'EXPENSE') {
          return {
            categoryId,
            subcategoryId: known.defaultCategoryId ? known.defaultSubcategoryId : last?.subcategoryId ?? null,
            accountId: known.defaultAccountId ?? last?.accountId ?? null,
            source: 'history',
          };
        }
      }
    }

    const config = getHelperModel();
    if (!config.ok) return null;
    const categories = await expenseCategories();
    if (categories.length === 0) return null;
    const key = `suggest|${listKey(categories)}|${merchantKey ?? ''}|${merchantKey ? '' : notes.toLowerCase()}`;
    if (cache.has(key)) return cache.get(key) as CategorySuggestion | null;
    if (!rateLimit('aiHelper').ok) return null;
    const guess = await classifyEntry({
      model: config.model,
      text: [merchant && `Merchant: ${merchant}`, notes && `Note: ${notes}`].filter(Boolean).join('\n'),
      categories,
      abortSignal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
    });
    return remember<CategorySuggestion | null>(
      key,
      guess.categoryId && guess.confident
        ? { categoryId: guess.categoryId, subcategoryId: guess.subcategoryId, accountId: null, source: 'model' }
        : null
    );
  } catch (error) {
    console.error('Category suggestion unavailable:', error instanceof Error ? `${error.name}: ${error.message}` : 'unknown');
    return null;
  }
}

/**
 * Natural-language search for a transaction list. `kind` is the list it was
 * typed into; categories of the other kind are not offered.
 */
export async function smartSearch(
  text: string,
  kind: 'EXPENSE' | 'INCOME' | 'TRANSFER'
): Promise<SearchResult | null> {
  await requireSession();
  try {
    const query = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!query) return null;
    const [categories, accounts] = await Promise.all([
      kind === 'TRANSFER'
        ? []
        : prisma.category.findMany({ where: { type: kind }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      prisma.account.findMany({ select: { id: true, name: true, type: true }, orderBy: { name: 'asc' } }),
    ]);
    const today = todayInAppTimeZone();
    const key = `search|${kind}|${today}|${categories.map((c) => c.id).join('')}|${accounts.map((a) => a.id).join('')}|${query.toLowerCase()}`;
    if (cache.has(key)) return cache.get(key) as SearchResult;
    const config = getHelperModel();
    const result = await interpretSearch({
      text: query,
      ctx: { today, categories, accounts },
      // Over the limit: the code-side parser alone, without the model.
      model: config.ok && rateLimit('aiHelper').ok ? config.model : null,
      abortSignal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
    });
    return remember(key, result);
  } catch (error) {
    console.error('Smart search unavailable:', error instanceof Error ? `${error.name}: ${error.message}` : 'unknown');
    return null;
  }
}

/** Duplicate warning (lib/duplicates.ts). Null means "nothing found" or "could not check". */
export async function checkDuplicate(probe: DuplicateProbe): Promise<DuplicateMatch | null> {
  await requireSession();
  try {
    if (!probe || !['EXPENSE', 'INCOME', 'TRANSFER'].includes(probe.kind)) return null;
    if (!OBJECT_ID.test(String(probe.accountId ?? '')) || !isValidDay(probe.date)) return null;
    const amount = Number(probe.amount);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    return await findDuplicate(prisma, {
      kind: probe.kind,
      accountId: probe.accountId,
      toAccountId: OBJECT_ID.test(String(probe.toAccountId ?? '')) ? probe.toAccountId : null,
      amount,
      date: probe.date,
      merchant: typeof probe.merchant === 'string' ? probe.merchant.slice(0, 100) : null,
      excludeId: OBJECT_ID.test(String(probe.excludeId ?? '')) ? probe.excludeId : null,
    });
  } catch (error) {
    console.error('Duplicate check failed:', error instanceof Error ? error.message : 'unknown');
    return null;
  }
}

/** What the "Ask about this" panel needs to show a chat: the lists for editing a proposal, and today. */
export async function getAskPanelData() {
  await requireSession();
  return { reference: await loadChatReference(prisma), today: todayInAppTimeZone() };
}
