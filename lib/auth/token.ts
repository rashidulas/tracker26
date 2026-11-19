/**
 * The session token: what the session cookie holds.
 *
 * Sealed (encrypted and signed) with iron-session, so the browser can neither
 * read nor change it, and a token sealed with another secret is rejected.
 * There is one user, so the token carries no identity: holding a valid one
 * is being signed in.
 *
 * iron-session uses the Web Crypto API, so this file also runs in
 * middleware.ts (Edge runtime). Keep it free of Node-only imports.
 */
import { sealData, unsealData } from 'iron-session';

export const SESSION_COOKIE = 'tracker26_session';

const DAY = 24 * 60 * 60;
/** "Stay signed in": 30 days, renewed while the app keeps being used. */
export const PERSISTENT_TTL_SECONDS = 30 * DAY;
/** Without it: a browser-session cookie, and the token itself ends after 12 hours. */
export const SHORT_TTL_SECONDS = 12 * 60 * 60;
/** A persistent session older than this is re-issued on the next request. */
export const REFRESH_AFTER_SECONDS = DAY;

export type SessionPayload = {
  v: 1;
  /** Issued at, ms since epoch. */
  iat: number;
  /** Expires at, ms since epoch. */
  exp: number;
  /** "Stay signed in" was ticked. */
  persist: boolean;
};

export function sessionTtlSeconds(persist: boolean) {
  return persist ? PERSISTENT_TTL_SECONDS : SHORT_TTL_SECONDS;
}

export async function createSessionToken(
  secret: string,
  options: { persist: boolean; now?: number }
): Promise<string> {
  const now = options.now ?? Date.now();
  const ttl = sessionTtlSeconds(options.persist);
  const payload: SessionPayload = { v: 1, iat: now, exp: now + ttl * 1000, persist: options.persist };
  return sealData(payload, { password: secret, ttl });
}

/** The payload of a valid, unexpired token; null for anything else. Never throws. */
export async function verifySessionToken(
  token: string | undefined | null,
  secret: string,
  now: number = Date.now()
): Promise<SessionPayload | null> {
  if (!token || token.length > 2048) return null;
  try {
    // ttl 0: expiry is checked below against `exp`, which is inside the seal.
    const data = await unsealData<Partial<SessionPayload>>(token, { password: secret, ttl: 0 });
    if (
      data?.v !== 1 ||
      typeof data.iat !== 'number' ||
      typeof data.exp !== 'number' ||
      typeof data.persist !== 'boolean'
    ) {
      return null;
    }
    if (data.exp <= now || data.iat > now + 60_000) return null;
    return { v: 1, iat: data.iat, exp: data.exp, persist: data.persist };
  } catch {
    return null;
  }
}

export function needsRefresh(session: SessionPayload, now: number = Date.now()): boolean {
  return session.persist && now - session.iat > REFRESH_AFTER_SECONDS * 1000;
}

/** Cookie attributes. `secure` is off only for plain-http local development. */
export function sessionCookieOptions(persist: boolean, production: boolean) {
  return {
    httpOnly: true,
    secure: production,
    sameSite: 'lax' as const,
    path: '/',
    ...(persist ? { maxAge: PERSISTENT_TTL_SECONDS } : {}),
  };
}
