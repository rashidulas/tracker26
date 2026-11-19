/**
 * The session check used inside server code. middleware.ts already turns
 * away requests without a session, but a matcher mistake must not be enough
 * to expose data, so:
 *
 *   - every server action and data loader starts with `await requireSession()`
 *     (tests/authCoverage.test.ts fails the build's test run if one does not);
 *   - every API route handler starts with `requireApiSession()`.
 *
 * Server actions need this for a second reason: an action can be invoked by
 * posting its id to any URL, including the public /login page.
 *
 * A later bearer-token client would be recognised in getSessionState(); the
 * callers would not change.
 */
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { NextResponse } from 'next/server';
import { isProduction, notConfiguredMessage, readAuthConfig } from '@/lib/auth/config';
import { LOGIN_PATH } from '@/lib/auth/gate';
import {
  SESSION_COOKIE,
  createSessionToken,
  sessionCookieOptions,
  verifySessionToken,
} from '@/lib/auth/token';

export type SessionState =
  /** Signed in. */
  | { status: 'ok' }
  /** Development with the login not set up: usable, with a warning banner. */
  | { status: 'open'; missing: string[] }
  /** Production with the login not set up: nothing is served. */
  | { status: 'not-configured'; missing: string[] }
  | { status: 'signed-out' };

export async function getSessionState(): Promise<SessionState> {
  // Read first, whatever the configuration: reading cookies is what tells
  // Next the render depends on the request, so no page is prerendered at
  // build time with a login state baked in.
  const cookieStore = await cookies();
  const config = readAuthConfig();
  if (!config.configured) {
    return isProduction()
      ? { status: 'not-configured', missing: config.missing }
      : { status: 'open', missing: config.missing };
  }
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = await verifySessionToken(token, config.secret);
  return session ? { status: 'ok' } : { status: 'signed-out' };
}

/**
 * For server actions, data loaders and pages. Sends a signed-out caller to
 * the login page (Next turns this into a redirect for both a page render and
 * an action call). Call it first, outside any try block: redirect() works by
 * throwing.
 */
export async function requireSession(): Promise<void> {
  const state = await getSessionState();
  if (state.status === 'ok' || state.status === 'open') return;
  if (state.status === 'not-configured') throw new Error(notConfiguredMessage(state.missing));
  redirect(LOGIN_PATH);
}

/**
 * For API route handlers:
 *   const denied = await requireApiSession();
 *   if (denied) return denied;
 */
export async function requireApiSession(): Promise<NextResponse | null> {
  const state = await getSessionState();
  if (state.status === 'ok' || state.status === 'open') return null;
  if (state.status === 'not-configured') {
    return NextResponse.json({ error: notConfiguredMessage(state.missing) }, { status: 503 });
  }
  return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 });
}

/** Set the session cookie. Only from a server action or route handler. */
export async function startSession(secret: string, persist: boolean): Promise<void> {
  const token = await createSessionToken(secret, { persist });
  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions(persist, isProduction()));
}

export async function endSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}
