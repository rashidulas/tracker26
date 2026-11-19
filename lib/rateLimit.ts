/**
 * In-memory sliding-window rate limiter.
 *
 * Good enough for one person on one server process. Its limits, plainly:
 * the counters live in this process's memory, so on serverless hosting
 * (Vercel) each warm instance counts separately and a cold start forgets
 * everything. There it slows abuse down rather than capping it. For a hard
 * cap, keep `RateLimiter`'s interface and back it with a shared store, e.g.
 * @upstash/ratelimit on Upstash Redis (Vercel KV), and set a spending limit
 * at the model provider.
 */

export type RateLimitResult = {
  ok: boolean;
  /** Calls left in the current window. */
  remaining: number;
  /** Seconds until a call would be allowed again (0 when ok). */
  retryAfterSeconds: number;
};

export type RateLimiter = {
  /** Count one call. `ok` is false when the key is over its limit; that call is not counted. */
  consume(key: string): RateLimitResult;
  /** The same answer without counting a call. */
  peek(key: string): RateLimitResult;
  reset(key: string): void;
};

export function createRateLimiter(options: {
  limit: number;
  windowMs: number;
  now?: () => number;
  /** Keys tracked before the oldest are dropped. */
  maxKeys?: number;
}): RateLimiter {
  const { limit, windowMs } = options;
  const now = options.now ?? Date.now;
  const maxKeys = options.maxKeys ?? 5000;
  const hits = new Map<string, number[]>();

  const live = (key: string, at: number) => {
    const list = (hits.get(key) ?? []).filter((t) => t > at - windowMs);
    if (list.length === 0) hits.delete(key);
    else hits.set(key, list);
    return list;
  };

  const result = (list: number[], at: number): RateLimitResult => {
    if (list.length < limit) return { ok: true, remaining: limit - list.length, retryAfterSeconds: 0 };
    // Allowed again when the oldest counted call leaves the window.
    const oldest = list[list.length - limit];
    return { ok: false, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - at) / 1000)) };
  };

  return {
    consume(key) {
      const at = now();
      const list = live(key, at);
      const before = result(list, at);
      if (!before.ok) return before;
      list.push(at);
      // Re-insert so the map's order is "least recently used first".
      hits.delete(key);
      hits.set(key, list);
      if (hits.size > maxKeys) hits.delete(hits.keys().next().value as string);
      return { ok: true, remaining: limit - list.length, retryAfterSeconds: 0 };
    },
    peek(key) {
      const at = now();
      return result(live(key, at), at);
    },
    reset(key) {
      hits.delete(key);
    },
  };
}

const MINUTE = 60_000;

/**
 * The app's limits. One user, so the model limits are per route, not per
 * client: they cap what the whole app can spend in a minute.
 */
const LIMITS = {
  /** Chat turns, including approvals. */
  chat: { limit: 30, windowMs: MINUTE },
  transcribe: { limit: 20, windowMs: MINUTE },
  scanReceipt: { limit: 12, windowMs: MINUTE },
  /** Quick add, category suggestions, smart search (one small model call each). */
  aiHelper: { limit: 60, windowMs: MINUTE },
  recap: { limit: 6, windowMs: MINUTE },
  /** Wrong passwords from one address. */
  loginAddress: { limit: 5, windowMs: 15 * MINUTE },
  /** Wrong passwords from anywhere: a backstop when addresses are spoofed or rotated. */
  loginAll: { limit: 50, windowMs: 15 * MINUTE },
} as const;

export type LimitName = keyof typeof LIMITS;

// On globalThis so a dev-server reload keeps the counters, like the Prisma client.
const globalLimiters = globalThis as unknown as { rateLimiters?: Map<string, RateLimiter> };
const limiters = (globalLimiters.rateLimiters ??= new Map<string, RateLimiter>());

export function limiter(name: LimitName): RateLimiter {
  let found = limiters.get(name);
  if (!found) {
    found = createRateLimiter(LIMITS[name]);
    limiters.set(name, found);
  }
  return found;
}

/** Count one call against a named limit. */
export function rateLimit(name: LimitName, key = 'app'): RateLimitResult {
  return limiter(name).consume(key);
}

/** "in 40 seconds", "in 12 minutes". */
export function retryAfterText(seconds: number): string {
  if (seconds < 90) return `in ${seconds} second${seconds === 1 ? '' : 's'}`;
  const minutes = Math.ceil(seconds / 60);
  return `in ${minutes} minutes`;
}
