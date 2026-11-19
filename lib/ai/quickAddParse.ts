/**
 * The code side of natural-language quick add.
 *
 * "12.50 lunch chipotle discover yesterday" → amount 12.50, date yesterday,
 * account Discover, merchant Chipotle (if it has been used before), and
 * "lunch" left over. Everything here is plain string matching against the
 * user's own accounts, categories and merchants, so it runs on every
 * keystroke. Only the leftover words ever go to a model (lib/ai/classify.ts),
 * and only when no category or merchant could be found without one.
 *
 * Pure and safe for client code.
 */
import { addDays, type DayString } from '@/lib/dates';
import { dayFromParts, monthNumber, mostRecentMonthDay, mostRecentWeekday, weekdayNumber } from '@/lib/ai/periods';

export type QuickAddContext = {
  today: DayString;
  accounts: { id: string; name: string; type?: string }[];
  categories: { id: string; name: string; subcategories?: { id: string; name: string }[] }[];
  /** Merchant memory: names used before, with what was used with them. */
  merchants: { name: string; categoryId?: string | null; subcategoryId?: string | null; accountId?: string | null }[];
};

export type QuickAddParse = {
  amount?: number;
  date?: DayString;
  accountId?: string;
  /** A category (or subcategory) the text names. */
  categoryId?: string;
  subcategoryId?: string;
  /** A merchant used before (its saved spelling), or the words after "at". */
  merchant?: string;
  /** The merchant is one from merchant memory. */
  merchantKnown: boolean;
  /** Words nothing above explains, in the order typed. */
  leftover: string;
};

type Token = { raw: string; norm: string; used: boolean };

/** Lower-case, drop apostrophes and dots, turn other punctuation into spaces. */
export function simplify(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’`.®™]/g, '')
    .replace(/[^a-z0-9&$]+/g, ' ')
    .trim();
}

/** "groceries" and "grocery", "coffees" and "coffee" compare equal. */
function stem(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

const STOPWORDS = new Set([
  'a', 'an', 'the', 'at', 'on', 'for', 'with', 'from', 'in', 'to', 'of', 'and', 'my', 'i', 'paid', 'spent',
  'bought', 'got', 'using', 'via', 'by', 'was', 'it', '@',
]);
const ACCOUNT_LEADS = new Set(['on', 'with', 'using', 'from', 'via', 'my', 'the', 'by']);
const GENERIC_ACCOUNT_WORDS = new Set(['card', 'account', 'bank', 'credit', 'debit', 'the', 'my', 'and', 'of']);
const GENERIC_CATEGORY_WORDS = new Set(['other', 'others', 'expense', 'expenses', 'misc', 'general', 'out', 'and', 'the', 'of']);
const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };

const AMOUNT_RE = /^\$?(\d{1,3}(?:,\d{3})+|\d+)(\.\d{1,2})?\$?$/;
const DAY_NUMBER_RE = /^(\d{1,2})(st|nd|rd|th)?$/;

function tokenize(text: string): Token[] {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((raw) => ({ raw, norm: raw.toLowerCase().replace(/^[,;:(]+|[,;:.!?)]+$/g, ''), used: false }));
}

const free = (tokens: Token[], start: number, length: number) =>
  start >= 0 && start + length <= tokens.length && tokens.slice(start, start + length).every((t) => !t.used);

const use = (tokens: Token[], start: number, length: number) => {
  for (let i = start; i < start + length; i += 1) tokens[i].used = true;
};

// ==================== DATE ====================

function findDate(tokens: Token[], today: DayString): DayString | undefined {
  const at = (i: number) => (i >= 0 && i < tokens.length && !tokens[i].used ? tokens[i].norm : '');
  const take = (start: number, length: number, day: DayString | null | undefined) => {
    if (!day) return undefined;
    use(tokens, start, length);
    // "on friday", "on 11/18"
    if (at(start - 1) === 'on') tokens[start - 1].used = true;
    return day;
  };

  for (let i = 0; i < tokens.length; i += 1) {
    const word = at(i);
    if (!word) continue;
    const next = at(i + 1);

    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(word);
    if (iso) {
      const day = take(i, 1, dayFromParts(Number(iso[1]), Number(iso[2]), Number(iso[3])));
      if (day) return day;
    }

    const slash = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/.exec(word);
    if (slash) {
      const [month, dayOfMonth] = [Number(slash[1]), Number(slash[2])];
      const day = slash[3]
        ? dayFromParts(slash[3].length === 2 ? 2000 + Number(slash[3]) : Number(slash[3]), month, dayOfMonth)
        : mostRecentMonthDay(month, dayOfMonth, today);
      const taken = take(i, 1, day);
      if (taken) return taken;
    }

    if (word === 'today' || word === 'tonight') return take(i, 1, today);
    if (word === 'yesterday') return take(i, 1, addDays(today, -1));
    if (word === 'last' && next === 'night') return take(i, 2, addDays(today, -1));
    if (word === 'this' && ['morning', 'afternoon', 'evening'].includes(next)) return take(i, 2, today);

    // "3 days ago", "a week ago"
    const count = /^\d{1,3}$/.test(word) ? Number(word) : NUMBER_WORDS[word];
    if (count && /^(days?|weeks?)$/.test(next) && at(i + 2) === 'ago') {
      const days = next.startsWith('week') ? count * 7 : count;
      if (days <= 366) return take(i, 3, addDays(today, -days));
    }

    // "nov 18", "november 18th 2025", "18 nov"
    const month = monthNumber(word);
    const dayAfter = DAY_NUMBER_RE.exec(next);
    if (month && dayAfter) {
      const yearWord = at(i + 2);
      const hasYear = /^(19|20)\d{2}$/.test(yearWord);
      const day = hasYear
        ? dayFromParts(Number(yearWord), month, Number(dayAfter[1]))
        : mostRecentMonthDay(month, Number(dayAfter[1]), today);
      const taken = take(i, hasYear ? 3 : 2, day);
      if (taken) return taken;
    }
    const dayBefore = DAY_NUMBER_RE.exec(word);
    const monthAfter = dayBefore ? monthNumber(next) : null;
    // "7 nov 3rd" is seven dollars on November 3rd, not November 7th.
    if (dayBefore && monthAfter && !DAY_NUMBER_RE.test(at(i + 2))) {
      const taken = take(i, 2, mostRecentMonthDay(monthAfter, Number(dayBefore[1]), today));
      if (taken) return taken;
    }

    // "friday" (the most recent one, today included), "last friday" (before today)
    const weekday = weekdayNumber(word);
    if (weekday !== null) return take(i, 1, mostRecentWeekday(weekday, today));
    const lastWeekday = word === 'last' ? weekdayNumber(next) : null;
    if (lastWeekday !== null) return take(i, 2, mostRecentWeekday(lastWeekday, today, true));
  }
  return undefined;
}

// ==================== AMOUNT ====================

function findAmount(tokens: Token[]): number | undefined {
  const candidates = tokens
    .map((token, index) => ({ token, index, match: token.used ? null : AMOUNT_RE.exec(token.norm) }))
    .filter((c) => c.match);
  // "$12" or "12.50" is clearly money; a bare "7" might be part of a name.
  const pick = candidates.find((c) => /[$.]/.test(c.token.norm)) ?? candidates[0];
  if (!pick) return undefined;
  const value = Number(pick.token.norm.replace(/[$,]/g, ''));
  if (!Number.isFinite(value) || value <= 0 || value >= 10_000_000) return undefined;
  pick.token.used = true;
  const next = tokens[pick.index + 1];
  if (next && !next.used && /^(dollars?|bucks?|usd)$/.test(next.norm)) next.used = true;
  return Math.round(value * 100) / 100;
}

// ==================== NAMES ====================

/** The longest run of unused tokens (up to maxLength) that `lookup` recognises. */
function matchPhrase<T>(
  tokens: Token[],
  maxLength: number,
  lookup: (phrase: string, length: number) => T | undefined
): { start: number; length: number; value: T } | undefined {
  for (let length = Math.min(maxLength, tokens.length); length >= 1; length -= 1) {
    for (let start = 0; start + length <= tokens.length; start += 1) {
      if (!free(tokens, start, length)) continue;
      const phrase = simplify(tokens.slice(start, start + length).map((t) => t.norm).join(' '));
      if (!phrase) continue;
      const value = lookup(phrase, length);
      if (value !== undefined) return { start, length, value };
    }
  }
  return undefined;
}

/** Entries whose key appears exactly once; ambiguous keys are dropped. */
function uniqueIndex<T>(pairs: [string, T][]): Map<string, T> {
  const seen = new Map<string, T | null>();
  for (const [key, value] of pairs) {
    if (!key) continue;
    seen.set(key, seen.has(key) && seen.get(key) !== value ? null : value);
  }
  const out = new Map<string, T>();
  seen.forEach((value, key) => {
    if (value !== null) out.set(key, value);
  });
  return out;
}

type CategoryHit = { categoryId: string; subcategoryId?: string };

export function parseQuickAdd(
  text: string,
  ctx: QuickAddContext,
  /** namesOnly: match accounts, categories and merchants; leave numbers and dates alone (search). */
  options: { namesOnly?: boolean } = {}
): QuickAddParse {
  const tokens = tokenize(text);
  const result: QuickAddParse = { merchantKnown: false, leftover: '' };
  if (tokens.length === 0) return result;

  if (!options.namesOnly) {
    result.date = findDate(tokens, ctx.today);
    result.amount = findAmount(tokens);
  }

  // ---- accounts by full name ("chase checking") ----
  const accountByName = uniqueIndex(ctx.accounts.map((a) => [simplify(a.name), a.id]));
  const takeAccount = (hit: { start: number; length: number; value: string } | undefined) => {
    if (!hit) return;
    result.accountId = hit.value;
    use(tokens, hit.start, hit.length);
    for (let i = hit.start - 1; i >= 0 && !tokens[i].used && ACCOUNT_LEADS.has(tokens[i].norm); i -= 1) {
      tokens[i].used = true;
    }
    const after = tokens[hit.start + hit.length];
    if (after && !after.used && (after.norm === 'card' || after.norm === 'account')) after.used = true;
  };
  takeAccount(matchPhrase(tokens, 4, (phrase) => accountByName.get(phrase)));

  // ---- merchants used before ----
  const merchantByName = new Map<string, QuickAddContext['merchants'][number]>();
  for (const m of ctx.merchants) {
    const key = simplify(m.name);
    if (key && !merchantByName.has(key)) merchantByName.set(key, m);
  }
  const merchantHit = matchPhrase(tokens, 5, (phrase) => merchantByName.get(phrase));
  if (merchantHit) {
    result.merchant = merchantHit.value.name;
    result.merchantKnown = true;
    use(tokens, merchantHit.start, merchantHit.length);
    const before = tokens[merchantHit.start - 1];
    if (before && !before.used && (before.norm === 'at' || before.norm === '@')) before.used = true;
  }

  // ---- categories and subcategories by name ----
  const categoryPairs: [string, CategoryHit][] = [];
  for (const c of ctx.categories) {
    const hit: CategoryHit = { categoryId: c.id };
    categoryPairs.push([simplify(c.name), hit], [stem(simplify(c.name)), hit]);
    for (const s of c.subcategories ?? []) {
      const subHit: CategoryHit = { categoryId: c.id, subcategoryId: s.id };
      categoryPairs.push([simplify(s.name), subHit], [stem(simplify(s.name)), subHit]);
    }
  }
  // A category name wins over a subcategory of the same name elsewhere.
  const categoryByName = new Map<string, CategoryHit>();
  for (const [key, hit] of categoryPairs) {
    const prior = categoryByName.get(key);
    if (key && (!prior || (prior.subcategoryId && !hit.subcategoryId))) categoryByName.set(key, hit);
  }
  const takeCategory = (hit: { start: number; length: number; value: CategoryHit } | undefined) => {
    if (!hit) return;
    result.categoryId = hit.value.categoryId;
    if (hit.value.subcategoryId) result.subcategoryId = hit.value.subcategoryId;
    use(tokens, hit.start, hit.length);
  };
  takeCategory(matchPhrase(tokens, 4, (phrase) => categoryByName.get(phrase) ?? categoryByName.get(stem(phrase))));

  // ---- accounts by one distinctive word ("discover", "amex", "cash") ----
  if (!result.accountId) {
    const pairs: [string, string][] = [];
    for (const a of ctx.accounts) {
      for (const word of new Set(simplify(a.name).split(' '))) {
        if (word.length >= 3 && !GENERIC_ACCOUNT_WORDS.has(word)) pairs.push([word, a.id]);
      }
    }
    const byWord = uniqueIndex(pairs);
    const cash = ctx.accounts.filter((a) => a.type === 'CASH');
    if (cash.length === 1 && !byWord.has('cash')) byWord.set('cash', cash[0].id);
    takeAccount(matchPhrase(tokens, 1, (phrase) => byWord.get(phrase)));
  }

  // ---- categories by one distinctive word ("dining" for "Dining Out") ----
  if (!result.categoryId) {
    const pairs: [string, CategoryHit][] = [];
    for (const c of ctx.categories) {
      const hit: CategoryHit = { categoryId: c.id };
      for (const word of new Set(simplify(c.name).split(' '))) {
        if (word.length >= 4 && !GENERIC_CATEGORY_WORDS.has(word)) pairs.push([stem(word), hit]);
      }
    }
    const byWord = uniqueIndex(pairs);
    takeCategory(matchPhrase(tokens, 1, (phrase) => (phrase.length >= 4 ? byWord.get(stem(phrase)) : undefined)));
  }

  // ---- "at <somewhere new>" ----
  // (Quick add only: in a search, "at restaurants" is a description, not a name.)
  if (!result.merchant && !options.namesOnly) {
    const atIndex = tokens.findIndex((t, i) => !t.used && (t.norm === 'at' || t.norm === '@') && tokens[i + 1] && !tokens[i + 1].used);
    if (atIndex >= 0) {
      const words: string[] = [];
      let i = atIndex + 1;
      while (i < tokens.length && !tokens[i].used && !STOPWORDS.has(tokens[i].norm) && words.length < 4) {
        words.push(tokens[i].raw.replace(/[,;:.!?]+$/g, ''));
        i += 1;
      }
      if (words.length > 0) {
        use(tokens, atIndex, words.length + 1);
        const typed = words.join(' ');
        // Typed all in lower case: capitalise each word, as a name would be.
        result.merchant = typed === typed.toLowerCase() ? typed.replace(/\b[a-z]/g, (c) => c.toUpperCase()) : typed;
      }
    }
  }

  result.leftover = tokens
    .filter((t) => !t.used && t.norm && !STOPWORDS.has(t.norm))
    .map((t) => t.raw.replace(/^[,;:(]+|[,;:.!?)]+$/g, ''))
    .join(' ')
    .trim();
  return result;
}

/**
 * Whether a model could add anything: there are words left that nothing
 * explains, and the category or the merchant is still unknown.
 */
export function needsModel(parse: QuickAddParse, hasMerchantCategory: boolean): boolean {
  if (parse.leftover.length < 3) return false;
  const hasCategory = Boolean(parse.categoryId) || hasMerchantCategory;
  return !hasCategory || !parse.merchant;
}
