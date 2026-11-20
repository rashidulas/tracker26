/**
 * The middleware's decision, as a pure function so it can be tested:
 * given a request and the state of the login, what happens?
 *
 * Public without a session:
 *   /login                 the sign-in page (and its form post)
 *   /api/health            uptime check; returns no data
 *   /api/recurring/run     cron; requires Authorization: Bearer <CRON_SECRET>
 *   /api/insights/run      cron; same
 *   /api/reminders/run     cron; same
 *   /sw.js, /manifest.webmanifest, /icon, /apple-icon
 *                          what a browser fetches without cookies to install
 *                          the app and show notifications; they hold no data
 * Everything else needs a session. Static assets never reach the middleware
 * (see the matcher in middleware.ts).
 *
 * A later non-browser client (bearer token) would get its own branch here and
 * in lib/auth/session.ts; nothing below assumes a cookie beyond `signedIn`.
 */
import type { AuthConfig } from '@/lib/auth/config';

export const LOGIN_PATH = '/login';
export const CRON_PATHS = ['/api/recurring/run', '/api/insights/run', '/api/reminders/run'];
/** Static files of the installable app. No data, and fetched without cookies. */
export const APP_SHELL_PATHS = ['/sw.js', '/manifest.webmanifest', '/icon', '/apple-icon'];
const OPEN_PATHS = ['/api/health', ...CRON_PATHS, ...APP_SHELL_PATHS];

export type GateInput = {
  pathname: string;
  search: string;
  /** A server action call: a POST carrying the Next-Action header. */
  isAction: boolean;
  config: AuthConfig;
  production: boolean;
  signedIn: boolean;
};

export type GateDecision =
  | { type: 'allow' }
  /** Production with the login not set up: 503 naming the variables. */
  | { type: 'not-configured'; missing: string[]; json: boolean }
  /** API routes and server actions: 401, no redirect. */
  | { type: 'unauthorized' }
  /** Pages: to the login page, remembering where the user was going. */
  | { type: 'login'; next: string };

const isApi = (pathname: string) => pathname === '/api' || pathname.startsWith('/api/');

export function decideAccess(input: GateInput): GateDecision {
  const { pathname } = input;
  if (OPEN_PATHS.includes(pathname)) return { type: 'allow' };

  if (!input.config.configured) {
    // Development stays usable (with a banner); production never fails open.
    if (!input.production) return { type: 'allow' };
    return {
      type: 'not-configured',
      missing: input.config.missing,
      json: isApi(pathname) || input.isAction,
    };
  }

  if (pathname === LOGIN_PATH) return { type: 'allow' };
  if (input.signedIn) return { type: 'allow' };
  if (isApi(pathname) || input.isAction) return { type: 'unauthorized' };
  return { type: 'login', next: `${pathname}${input.search}` };
}
