'use server';

/**
 * Sign in and sign out. The only server actions that do not start with
 * requireSession() (tests/authCoverage.test.ts lists this file as the
 * exception).
 */
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { isProduction, notConfiguredMessage, readAuthConfig } from '@/lib/auth/config';
import { LOGIN_PATH } from '@/lib/auth/gate';
import { verifyPassword } from '@/lib/auth/password';
import { safeRedirectTarget } from '@/lib/auth/redirect';
import { endSession, startSession } from '@/lib/auth/session';
import { limiter, retryAfterText } from '@/lib/rateLimit';

export type SignInState = { error?: string };

/** Every wrong password costs at least this long, on top of the hash check. */
const FAILURE_DELAY_MS = 600;

async function clientAddress() {
  const h = await headers();
  // The first entry is the client as seen by the host's proxy (Vercel sets it).
  // Where nothing sets it the header can be forged, which is why there is
  // also a limit across all addresses.
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || 'unknown';
}

const lockedMessage = (seconds: number) => `Too many attempts. Try again ${retryAfterText(seconds)}.`;

export async function signIn(_previous: SignInState, formData: FormData): Promise<SignInState> {
  const config = readAuthConfig();
  if (!config.configured) {
    if (!isProduction()) redirect('/');
    return { error: notConfiguredMessage(config.missing) };
  }

  const address = await clientAddress();
  const perAddress = limiter('loginAddress');
  const overall = limiter('loginAll');
  const blocked = [perAddress.peek(address), overall.peek('all')].find((r) => !r.ok);
  if (blocked) return { error: lockedMessage(blocked.retryAfterSeconds) };

  const password = formData.get('password');
  const ok = typeof password === 'string' && (await verifyPassword(password, config.passwordHash));
  if (!ok) {
    perAddress.consume(address);
    overall.consume('all');
    console.warn(`Login: wrong password from ${address}`);
    await new Promise((resolve) => setTimeout(resolve, FAILURE_DELAY_MS));
    const now = perAddress.peek(address);
    // The same message whatever was wrong; nothing here says how close a guess was.
    return { error: now.ok ? 'Incorrect password.' : lockedMessage(now.retryAfterSeconds) };
  }

  perAddress.reset(address);
  await startSession(config.secret, formData.get('remember') === 'on');
  redirect(safeRedirectTarget(formData.get('next')));
}

export async function signOut(): Promise<void> {
  await endSession();
  redirect(LOGIN_PATH);
}
