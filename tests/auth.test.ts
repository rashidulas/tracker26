/**
 * The login: session tokens, the redirect target, the password hash, the
 * middleware's decisions (including a missing configuration in production
 * versus development), the session check used by API routes, and the cron
 * routes' bearer secret.
 *
 * Run: npm test (vitest)
 */
import { afterEach, beforeEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { NextRequest } from 'next/server';

import { readAuthConfig } from '../lib/auth/config';
import { decideAccess, type GateInput } from '../lib/auth/gate';
import { decodePasswordHash, encodePasswordHash, verifyPassword } from '../lib/auth/password';
import { safeRedirectTarget } from '../lib/auth/redirect';
import {
  PERSISTENT_TTL_SECONDS,
  SESSION_COOKIE,
  SHORT_TTL_SECONDS,
  createSessionToken,
  needsRefresh,
  sessionCookieOptions,
  verifySessionToken,
} from '../lib/auth/token';

const SECRET = 'test-secret-test-secret-test-secret-1234';
const OTHER_SECRET = 'another-secret-another-secret-another-99';
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// What the request's cookie jar holds, for code that reads next/headers.
const cookieJar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined),
    set: (name: string, value: string) => void cookieJar.set(name, value),
    delete: (name: string) => void cookieJar.delete(name),
  }),
  headers: async () => new Headers(),
}));

// The cron routes' work, so the tests need no database.
const cronRuns = { recurring: 0, insights: 0 };
vi.mock('@/lib/recurring', () => ({
  runDueRecurring: async () => {
    cronRuns.recurring += 1;
    return { posted: 0 };
  },
}));
vi.mock('@/lib/insights/store', () => ({
  runInsightsCheck: async () => {
    cronRuns.insights += 1;
    return { state: 'ran' };
  },
}));

beforeEach(() => {
  cookieJar.clear();
  cronRuns.recurring = 0;
  cronRuns.insights = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function configure(options: { production: boolean; configured: boolean }) {
  vi.stubEnv('NODE_ENV', options.production ? 'production' : 'development');
  vi.stubEnv('AUTH_SECRET', options.configured ? SECRET : '');
  vi.stubEnv('AUTH_PASSWORD_HASH', options.configured ? 'placeholder-hash' : '');
}

// ==================== SESSION TOKEN ====================

test('a session token verifies with the secret that sealed it', async () => {
  const now = Date.now();
  const token = await createSessionToken(SECRET, { persist: true, now });
  const session = await verifySessionToken(token, SECRET, now + 1000);
  assert.ok(session);
  assert.equal(session.persist, true);
  assert.equal(session.iat, now);
  assert.equal(session.exp, now + PERSISTENT_TTL_SECONDS * 1000);
  // The cookie value is sealed: the payload is not readable in it.
  assert.ok(!token.includes('persist'));
});

test('a tampered token is rejected', async () => {
  const token = await createSessionToken(SECRET, { persist: true });
  const middle = Math.floor(token.length / 2);
  const flip = (at: number) => token.slice(0, at) + (token[at] === 'A' ? 'B' : 'A') + token.slice(at + 1);
  // In the encrypted payload, and in the signature near the end.
  assert.equal(await verifySessionToken(flip(middle), SECRET), null);
  assert.equal(await verifySessionToken(flip(token.length - 12), SECRET), null);
  assert.equal(await verifySessionToken(token.slice(0, -12), SECRET), null);
});

test('a token sealed with another secret is rejected', async () => {
  const token = await createSessionToken(OTHER_SECRET, { persist: true });
  assert.equal(await verifySessionToken(token, SECRET), null);
});

test('garbage and missing tokens are rejected without throwing', async () => {
  for (const value of [undefined, null, '', 'not-a-token', 'a'.repeat(5000), 'Fe26.2**x*y*z**a*b']) {
    assert.equal(await verifySessionToken(value, SECRET), null);
  }
});

test('an expired token is rejected', async () => {
  const now = Date.now();
  const persistent = await createSessionToken(SECRET, { persist: true, now: now - 31 * DAY });
  assert.equal(await verifySessionToken(persistent, SECRET, now), null);

  const short = await createSessionToken(SECRET, { persist: false, now: now - 13 * HOUR });
  assert.equal(await verifySessionToken(short, SECRET, now), null);

  // Still inside their lifetimes.
  const fresh = await createSessionToken(SECRET, { persist: true, now: now - 29 * DAY });
  assert.ok(await verifySessionToken(fresh, SECRET, now));
  const freshShort = await createSessionToken(SECRET, { persist: false, now: now - 11 * HOUR });
  assert.ok(await verifySessionToken(freshShort, SECRET, now));
  assert.equal(SHORT_TTL_SECONDS, 12 * 60 * 60);
});

test('only a persistent session older than a day is renewed', async () => {
  const now = Date.now();
  const base = { v: 1 as const, exp: now + DAY };
  assert.equal(needsRefresh({ ...base, iat: now - 2 * DAY, persist: true }, now), true);
  assert.equal(needsRefresh({ ...base, iat: now - HOUR, persist: true }, now), false);
  assert.equal(needsRefresh({ ...base, iat: now - 2 * DAY, persist: false }, now), false);
});

test('the cookie is httpOnly, same-site, and secure in production', () => {
  const persistent = sessionCookieOptions(true, true);
  assert.equal(persistent.httpOnly, true);
  assert.equal(persistent.secure, true);
  assert.equal(persistent.sameSite, 'lax');
  assert.equal(persistent.path, '/');
  assert.equal(persistent.maxAge, PERSISTENT_TTL_SECONDS);
  // Not "stay signed in": a browser-session cookie.
  assert.equal('maxAge' in sessionCookieOptions(false, true), false);
  assert.equal(sessionCookieOptions(true, false).secure, false);
});

// ==================== REDIRECT TARGET ====================

test('the redirect target accepts paths on this site', () => {
  assert.equal(safeRedirectTarget('/'), '/');
  assert.equal(safeRedirectTarget('/transactions/expenses'), '/transactions/expenses');
  assert.equal(safeRedirectTarget('/plan/budgets?month=2026-11'), '/plan/budgets?month=2026-11');
  assert.equal(safeRedirectTarget('/chat/abc123#latest'), '/chat/abc123#latest');
});

test('the redirect target refuses anything that leaves the site', () => {
  const hostile = [
    'https://evil.example',
    'http://evil.example/path',
    '//evil.example',
    '///evil.example',
    '/\\evil.example',
    '\\\\evil.example',
    '/\t/evil.example',
    '/\n/evil.example',
    'javascript:alert(1)',
    'data:text/html,hi',
    'evil.example',
    'transactions',
    '',
    ' /transactions',
    `/${'a'.repeat(3000)}`,
  ];
  for (const target of hostile) assert.equal(safeRedirectTarget(target), '/', JSON.stringify(target));
  for (const target of [undefined, null, 42, ['/a'], { path: '/a' }]) assert.equal(safeRedirectTarget(target), '/');
});

test('the redirect target never points at the login page or an endpoint', () => {
  assert.equal(safeRedirectTarget('/login'), '/');
  assert.equal(safeRedirectTarget('/login?next=/login'), '/');
  assert.equal(safeRedirectTarget('/api/health'), '/');
  assert.equal(safeRedirectTarget('/a/../login'), '/');
});

// ==================== PASSWORD ====================

test('the password is checked against a base64 or a plain bcrypt hash', async () => {
  const hash = await bcrypt.hash('correct horse battery', 4);
  const encoded = encodePasswordHash(hash);
  assert.equal(decodePasswordHash(encoded), hash);
  assert.equal(decodePasswordHash(hash), hash);

  assert.equal(await verifyPassword('correct horse battery', encoded), true);
  assert.equal(await verifyPassword('correct horse battery', hash), true);
  assert.equal(await verifyPassword('correct horse batterx', encoded), false);
  assert.equal(await verifyPassword('', encoded), false);
  assert.equal(await verifyPassword('x'.repeat(300), encoded), false);
});

test('a value that is not a hash never matches', async () => {
  const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    assert.equal(decodePasswordHash('hunter2'), null);
    // What Next.js leaves of "$2b$12$..." after expanding "$..." in a .env file.
    assert.equal(decodePasswordHash('.abcdefghijklmnopqrstuv'), null);
    assert.equal(await verifyPassword('hunter2', 'hunter2'), false);
    assert.equal(await verifyPassword('', ''), false);
  } finally {
    quiet.mockRestore();
  }
});

// ==================== CONFIGURATION ====================

test('the configuration names what is missing', () => {
  assert.deepEqual(readAuthConfig({}), { configured: false, missing: ['AUTH_PASSWORD_HASH', 'AUTH_SECRET'] });
  assert.deepEqual(readAuthConfig({ AUTH_PASSWORD_HASH: 'h' }), { configured: false, missing: ['AUTH_SECRET'] });
  assert.deepEqual(readAuthConfig({ AUTH_SECRET: SECRET, AUTH_PASSWORD_HASH: '  ' }), {
    configured: false,
    missing: ['AUTH_PASSWORD_HASH'],
  });
  const short = readAuthConfig({ AUTH_PASSWORD_HASH: 'h', AUTH_SECRET: 'too-short' });
  assert.equal(short.configured, false);
  assert.match((short as { missing: string[] }).missing[0], /AUTH_SECRET \(must be at least 32 characters\)/);
  assert.deepEqual(readAuthConfig({ AUTH_PASSWORD_HASH: 'h', AUTH_SECRET: SECRET }), {
    configured: true,
    passwordHash: 'h',
    secret: SECRET,
  });
});

// ==================== THE GATE ====================

const CONFIGURED = { configured: true as const, passwordHash: 'h', secret: SECRET };
const MISSING = { configured: false as const, missing: ['AUTH_PASSWORD_HASH', 'AUTH_SECRET'] };

const gate = (input: Partial<GateInput>) =>
  decideAccess({
    pathname: '/',
    search: '',
    isAction: false,
    config: CONFIGURED,
    production: true,
    signedIn: false,
    ...input,
  });

const PAGES = ['/', '/transactions/expenses', '/chat', '/settings/categories', '/insights', '/anything-new'];
const PROTECTED_APIS = [
  '/api/assistant/chat',
  '/api/assistant/chat/stop',
  '/api/assistant/conversations',
  '/api/assistant/conversations/abc',
  '/api/assistant/transcribe',
  '/api/scan-receipt',
  '/api/something-added-later',
  '/api/health/extra',
  '/api/recurring/run/extra',
];
const OPEN = ['/api/health', '/api/recurring/run', '/api/insights/run'];

test('without a session, pages go to the login page with the place to return to', () => {
  for (const pathname of PAGES) {
    assert.deepEqual(gate({ pathname, search: '?a=1' }), { type: 'login', next: `${pathname}?a=1` });
  }
});

test('without a session, API routes and server actions get 401, not a redirect', () => {
  for (const pathname of PROTECTED_APIS) assert.deepEqual(gate({ pathname }), { type: 'unauthorized' });
  assert.deepEqual(gate({ pathname: '/transactions/expenses', isAction: true }), { type: 'unauthorized' });
});

test('only the login page, the health check and the two cron routes are open', () => {
  for (const pathname of [...OPEN, '/login']) assert.deepEqual(gate({ pathname }), { type: 'allow' });
  // The cron routes stay reachable for a scheduler with no cookie, in every state.
  for (const pathname of OPEN) {
    assert.deepEqual(gate({ pathname, config: MISSING }), { type: 'allow' });
    assert.deepEqual(gate({ pathname, config: MISSING, production: false }), { type: 'allow' });
  }
});

test('with a session everything is allowed', () => {
  for (const pathname of [...PAGES, ...PROTECTED_APIS]) {
    assert.deepEqual(gate({ pathname, signedIn: true }), { type: 'allow' });
  }
});

test('production with the login not configured serves nothing protected', () => {
  for (const pathname of [...PAGES, '/login']) {
    assert.deepEqual(gate({ pathname, config: MISSING }), {
      type: 'not-configured',
      missing: MISSING.missing,
      json: false,
    });
  }
  for (const pathname of PROTECTED_APIS) {
    assert.deepEqual(gate({ pathname, config: MISSING }), {
      type: 'not-configured',
      missing: MISSING.missing,
      json: true,
    });
  }
  // A cookie does not help: there is nothing to verify it with.
  assert.equal(gate({ pathname: '/', config: MISSING, signedIn: true }).type, 'not-configured');
});

test('development with the login not configured stays usable', () => {
  for (const pathname of [...PAGES, ...PROTECTED_APIS, '/login']) {
    assert.deepEqual(gate({ pathname, config: MISSING, production: false }), { type: 'allow' });
  }
});

test('development with the login configured enforces it', () => {
  assert.equal(gate({ pathname: '/', production: false }).type, 'login');
  assert.equal(gate({ pathname: '/api/scan-receipt', production: false }).type, 'unauthorized');
});

// ==================== MIDDLEWARE ====================

async function runMiddleware(path: string, init: { cookie?: string; action?: boolean } = {}) {
  const { middleware } = await import('../middleware');
  const headers = new Headers();
  if (init.cookie) headers.set('cookie', `${SESSION_COOKIE}=${init.cookie}`);
  if (init.action) headers.set('next-action', 'abc');
  return middleware(
    new NextRequest(`http://localhost:3000${path}`, { method: init.action ? 'POST' : 'GET', headers })
  );
}

const passedThrough = (response: Response) => response.headers.get('x-middleware-next') === '1';

test('middleware: no session redirects pages and refuses APIs and actions', async () => {
  configure({ production: true, configured: true });

  const page = await runMiddleware('/transactions/expenses?month=2026-11');
  assert.equal(page.status, 307);
  const location = new URL(page.headers.get('location')!);
  assert.equal(location.pathname, '/login');
  assert.equal(location.searchParams.get('next'), '/transactions/expenses?month=2026-11');

  const home = await runMiddleware('/');
  assert.equal(new URL(home.headers.get('location')!).search, '');

  const api = await runMiddleware('/api/assistant/conversations');
  assert.equal(api.status, 401);
  assert.deepEqual(await api.json(), { error: 'Sign in to continue.' });

  const action = await runMiddleware('/accounts', { action: true });
  assert.equal(action.status, 401);

  assert.ok(passedThrough(await runMiddleware('/login')));
  assert.ok(passedThrough(await runMiddleware('/api/health')));
  assert.ok(passedThrough(await runMiddleware('/api/recurring/run')));
  assert.ok(passedThrough(await runMiddleware('/api/insights/run')));
});

test('middleware: a valid cookie passes, a forged or expired one does not', async () => {
  configure({ production: true, configured: true });

  const valid = await createSessionToken(SECRET, { persist: true });
  const ok = await runMiddleware('/accounts', { cookie: valid });
  assert.ok(passedThrough(ok));
  assert.equal(ok.headers.get('set-cookie'), null);
  assert.ok(passedThrough(await runMiddleware('/api/assistant/conversations', { cookie: valid })));

  const forged = await createSessionToken(OTHER_SECRET, { persist: true });
  assert.equal((await runMiddleware('/accounts', { cookie: forged })).status, 307);
  assert.equal((await runMiddleware('/api/scan-receipt', { cookie: forged })).status, 401);

  const expired = await createSessionToken(SECRET, { persist: true, now: Date.now() - 31 * DAY });
  assert.equal((await runMiddleware('/accounts', { cookie: expired })).status, 307);
});

test('middleware: an older "stay signed in" session is renewed', async () => {
  configure({ production: true, configured: true });
  const old = await createSessionToken(SECRET, { persist: true, now: Date.now() - 3 * DAY });
  const response = await runMiddleware('/accounts', { cookie: old });
  assert.ok(passedThrough(response));
  const setCookie = response.headers.get('set-cookie') ?? '';
  assert.match(setCookie, new RegExp(`^${SESSION_COOKIE}=`));
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /Secure/i);
  assert.match(setCookie, /SameSite=lax/i);
  assert.match(setCookie, new RegExp(`Max-Age=${PERSISTENT_TTL_SECONDS}`));
});

test('middleware: production without configuration answers 503 and names the variables', async () => {
  configure({ production: true, configured: false });

  const page = await runMiddleware('/');
  assert.equal(page.status, 503);
  assert.match(page.headers.get('content-type') ?? '', /text\/html/);
  const html = await page.text();
  assert.match(html, /Login is not configured/);
  assert.match(html, /AUTH_PASSWORD_HASH/);
  assert.match(html, /AUTH_SECRET/);

  const login = await runMiddleware('/login');
  assert.equal(login.status, 503);

  const api = await runMiddleware('/api/assistant/chat');
  assert.equal(api.status, 503);
  const body = (await api.json()) as { error: string };
  assert.match(body.error, /AUTH_PASSWORD_HASH and AUTH_SECRET/);

  // A cookie from before the configuration was lost does not open anything.
  const stale = await createSessionToken(SECRET, { persist: true });
  assert.equal((await runMiddleware('/accounts', { cookie: stale })).status, 503);

  // The health check and the cron routes are not behind the login.
  assert.ok(passedThrough(await runMiddleware('/api/health')));
  assert.ok(passedThrough(await runMiddleware('/api/recurring/run')));
});

test('middleware: production with a secret that is too short is also not configured', async () => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('AUTH_PASSWORD_HASH', 'placeholder-hash');
  vi.stubEnv('AUTH_SECRET', 'short');
  const response = await runMiddleware('/');
  assert.equal(response.status, 503);
  assert.match(await response.text(), /AUTH_SECRET \(must be at least 32 characters\)/);
});

test('middleware: development without configuration lets everything through', async () => {
  configure({ production: false, configured: false });
  assert.ok(passedThrough(await runMiddleware('/')));
  assert.ok(passedThrough(await runMiddleware('/api/assistant/chat')));
  assert.ok(passedThrough(await runMiddleware('/accounts', { action: true })));
});

// ==================== SESSION CHECK INSIDE HANDLERS ====================

test('requireApiSession: 401 without a cookie, null with a valid one', async () => {
  const { requireApiSession, getSessionState } = await import('../lib/auth/session');
  configure({ production: true, configured: true });

  const denied = await requireApiSession();
  assert.equal(denied?.status, 401);

  cookieJar.set(SESSION_COOKIE, await createSessionToken(OTHER_SECRET, { persist: true }));
  assert.equal((await requireApiSession())?.status, 401);

  cookieJar.set(SESSION_COOKIE, await createSessionToken(SECRET, { persist: true }));
  assert.equal(await requireApiSession(), null);
  assert.deepEqual(await getSessionState(), { status: 'ok' });
});

test('requireApiSession: missing configuration is 503 in production and open in development', async () => {
  const { requireApiSession, getSessionState } = await import('../lib/auth/session');

  configure({ production: true, configured: false });
  const denied = await requireApiSession();
  assert.equal(denied?.status, 503);
  assert.match(((await denied!.json()) as { error: string }).error, /AUTH_PASSWORD_HASH and AUTH_SECRET/);

  configure({ production: false, configured: false });
  assert.equal(await requireApiSession(), null);
  assert.deepEqual(await getSessionState(), { status: 'open', missing: ['AUTH_PASSWORD_HASH', 'AUTH_SECRET'] });
});

test('requireSession: redirects a signed-out caller to the login page', async () => {
  const { requireSession } = await import('../lib/auth/session');
  configure({ production: true, configured: true });
  await assert.rejects(requireSession(), (error: Error & { digest?: string }) => {
    assert.match(String(error.digest), /NEXT_REDIRECT.*\/login/);
    return true;
  });

  cookieJar.set(SESSION_COOKIE, await createSessionToken(SECRET, { persist: false }));
  await requireSession();

  configure({ production: true, configured: false });
  await assert.rejects(requireSession(), /Login is not configured/);
});

test('an API route answers 401 before doing anything when there is no session', async () => {
  configure({ production: true, configured: true });
  const { GET } = await import('../app/api/assistant/conversations/route');
  const response = await GET();
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'Sign in to continue.' });
});

// ==================== CRON ROUTES ====================

const cronRequest = (path: string, authorization?: string) =>
  new NextRequest(`http://localhost:3000${path}`, {
    method: 'POST',
    headers: authorization ? { authorization } : {},
  });

test('the cron routes accept the bearer secret without a session', async () => {
  configure({ production: true, configured: true });
  vi.stubEnv('CRON_SECRET', 'cron-secret-for-tests');
  const recurring = await import('../app/api/recurring/run/route');
  const insights = await import('../app/api/insights/run/route');

  const first = await recurring.POST(cronRequest('/api/recurring/run', 'Bearer cron-secret-for-tests'));
  assert.equal(first.status, 200);
  assert.equal(((await first.json()) as { success: boolean }).success, true);
  assert.equal(cronRuns.recurring, 1);

  const second = await insights.GET(cronRequest('/api/insights/run', 'Bearer cron-secret-for-tests'));
  assert.equal(second.status, 200);
  assert.equal(cronRuns.insights, 1);
});

test('the cron routes reject a missing or wrong secret', async () => {
  configure({ production: true, configured: true });
  vi.stubEnv('CRON_SECRET', 'cron-secret-for-tests');
  const routes = [
    (await import('../app/api/recurring/run/route')).POST,
    (await import('../app/api/insights/run/route')).POST,
  ];
  // A session cookie is not what these routes accept.
  cookieJar.set(SESSION_COOKIE, await createSessionToken(SECRET, { persist: true }));
  for (const handler of routes) {
    for (const header of [undefined, 'Bearer wrong', 'Bearer cron-secret-for-testsX', 'cron-secret-for-tests', 'Bearer ']) {
      const response = await handler(cronRequest('/api/x', header));
      assert.equal(response.status, 401, String(header));
    }
  }
  assert.deepEqual(cronRuns, { recurring: 0, insights: 0 });
});

test('the cron routes are disabled when CRON_SECRET is not set', async () => {
  vi.stubEnv('CRON_SECRET', '');
  const { POST } = await import('../app/api/recurring/run/route');
  assert.equal((await POST(cronRequest('/api/recurring/run', 'Bearer '))).status, 503);
  assert.equal(cronRuns.recurring, 0);
});
