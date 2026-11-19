/**
 * The login gate. Runs before every page, server action and API route (see
 * the matcher) and turns away requests without a valid session cookie. The
 * decision itself is lib/auth/gate.ts.
 *
 * Runtime: Edge, the default for middleware in Next.js 15 (the Node.js
 * runtime is opt-in from 15.5). Everything imported here is Edge-safe:
 * the session token uses Web Crypto, and the password hash is only checked
 * in the sign-in server action.
 *
 * This is the first line of defence, not the only one: server actions and
 * API routes check the session again themselves (lib/auth/session.ts).
 */
import { NextResponse, type NextRequest } from 'next/server';
import { isProduction, notConfiguredMessage, readAuthConfig } from '@/lib/auth/config';
import { LOGIN_PATH, decideAccess } from '@/lib/auth/gate';
import {
  SESSION_COOKIE,
  createSessionToken,
  needsRefresh,
  sessionCookieOptions,
  verifySessionToken,
} from '@/lib/auth/token';

export const config = {
  // Everything except Next's own static output and the favicon. API routes
  // and server actions are deliberately included.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function notConfiguredPage(missing: string[]) {
  const items = missing.map((name) => `<li><code>${escapeHtml(name)}</code></li>`).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Login is not configured</title>
<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: #0a0b0d; color: #f0f2f5; font-family: system-ui, sans-serif; padding: 24px; }
  main { max-width: 440px; background: #12151b; border: 1px solid #262b36; border-radius: 16px; padding: 28px; }
  h1 { font-size: 20px; margin: 0 0 12px; }
  p, li { color: #9aa1ad; line-height: 1.55; font-size: 15px; }
  code { color: #e8c468; }
</style>
</head>
<body>
<main>
<h1>Login is not configured</h1>
<p>Tracker26 will not serve anything until its login is set up. These environment variables are missing or invalid:</p>
<ul>${items}</ul>
<p>Run <code>npm run auth:hash</code> to generate them, add them to the host's environment, then redeploy. The README has the steps under "Login".</p>
</main>
</body>
</html>`;
}

export async function middleware(request: NextRequest) {
  const authConfig = readAuthConfig();
  const production = isProduction();
  const { pathname, search } = request.nextUrl;

  const session = authConfig.configured
    ? await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value, authConfig.secret)
    : null;

  const decision = decideAccess({
    pathname,
    search,
    isAction: request.method === 'POST' && request.headers.has('next-action'),
    config: authConfig,
    production,
    signedIn: session !== null,
  });

  switch (decision.type) {
    case 'not-configured': {
      const headers = { 'Cache-Control': 'no-store', 'Retry-After': '300' };
      if (decision.json) {
        return NextResponse.json({ error: notConfiguredMessage(decision.missing) }, { status: 503, headers });
      }
      return new NextResponse(notConfiguredPage(decision.missing), {
        status: 503,
        headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' },
      });
    }
    case 'unauthorized':
      return NextResponse.json(
        { error: 'Sign in to continue.' },
        { status: 401, headers: { 'Cache-Control': 'no-store' } }
      );
    case 'login': {
      const url = request.nextUrl.clone();
      url.pathname = LOGIN_PATH;
      url.search = '';
      if (decision.next !== '/') url.searchParams.set('next', decision.next);
      return NextResponse.redirect(url);
    }
    case 'allow': {
      const response = NextResponse.next();
      // "Stay signed in" slides: a session used after a day gets a fresh 30 days.
      if (authConfig.configured && session && needsRefresh(session)) {
        const token = await createSessionToken(authConfig.secret, { persist: true });
        response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(true, production));
      }
      return response;
    }
  }
}
