/**
 * Password check against AUTH_PASSWORD_HASH (bcrypt, via bcryptjs).
 *
 * `npm run auth:hash` prints the hash base64-encoded, because a bcrypt hash
 * contains "$" and Next.js expands "$..." inside .env files, which silently
 * corrupts it. A plain "$2b$..." hash is accepted too, for hosts whose
 * settings page stores values as typed.
 *
 * Node only (server actions); not imported by middleware.
 */
import bcrypt from 'bcryptjs';

const BCRYPT = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

/** The bcrypt hash in AUTH_PASSWORD_HASH, or null if the value is not one. */
export function decodePasswordHash(value: string): string | null {
  const trimmed = value.trim();
  if (BCRYPT.test(trimmed)) return trimmed;
  try {
    const decoded = Buffer.from(trimmed, 'base64').toString('utf8').trim();
    return BCRYPT.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

export function encodePasswordHash(hash: string): string {
  return Buffer.from(hash, 'utf8').toString('base64');
}

export async function verifyPassword(password: string, configuredHash: string): Promise<boolean> {
  const hash = decodePasswordHash(configuredHash);
  if (!hash) {
    console.error('AUTH_PASSWORD_HASH is not a valid hash. Generate one with `npm run auth:hash`.');
    return false;
  }
  if (typeof password !== 'string' || password.length === 0 || password.length > 256) return false;
  return bcrypt.compare(password, hash);
}
