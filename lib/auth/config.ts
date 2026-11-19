/**
 * Login configuration, read from the environment.
 *
 * Two variables, both required:
 *   AUTH_PASSWORD_HASH  the owner's password, hashed by `npm run auth:hash`
 *   AUTH_SECRET         at least 32 characters; signs and encrypts the session cookie
 *
 * When either is missing the app never fails open in production: every
 * protected request gets a "login is not configured" response that names the
 * missing variables (lib/auth/gate.ts). In development the app stays usable
 * and shows a warning banner (app/layout.tsx).
 *
 * No Node-only imports here: middleware.ts (Edge runtime) uses this file.
 */

export const PASSWORD_HASH_VAR = 'AUTH_PASSWORD_HASH';
export const SECRET_VAR = 'AUTH_SECRET';
/** iron-session refuses shorter passwords. */
export const MIN_SECRET_LENGTH = 32;

export type AuthConfig =
  | { configured: true; passwordHash: string; secret: string }
  | { configured: false; missing: string[] };

type Env = Record<string, string | undefined>;

export function readAuthConfig(env: Env = process.env): AuthConfig {
  const passwordHash = (env[PASSWORD_HASH_VAR] ?? '').trim();
  const secret = (env[SECRET_VAR] ?? '').trim();
  const missing: string[] = [];
  if (!passwordHash) missing.push(PASSWORD_HASH_VAR);
  if (!secret) missing.push(SECRET_VAR);
  else if (secret.length < MIN_SECRET_LENGTH) {
    missing.push(`${SECRET_VAR} (must be at least ${MIN_SECRET_LENGTH} characters)`);
  }
  if (missing.length > 0) return { configured: false, missing };
  return { configured: true, passwordHash, secret };
}

export function isProduction(env: Env = process.env): boolean {
  return env.NODE_ENV === 'production';
}

export function notConfiguredMessage(missing: string[]): string {
  return `Login is not configured. Set ${missing.join(' and ')} in the environment (see the README, "Login"), then restart or redeploy.`;
}
