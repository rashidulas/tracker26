import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Wallet } from 'lucide-react';
import { safeRedirectTarget } from '@/lib/auth/redirect';
import { getSessionState } from '@/lib/auth/session';
import LoginForm from './LoginForm';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Sign in — Tracker26',
  robots: { index: false, follow: false },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const params = await searchParams;
  const next = safeRedirectTarget(Array.isArray(params.next) ? params.next[0] : params.next);

  const state = await getSessionState();
  // Already signed in, or development without a login configured.
  if (state.status === 'ok' || state.status === 'open') redirect(next);

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3 mb-6">
          <div
            className="w-11 h-11 rounded-xl bg-mint-dim border border-mint/25 flex items-center justify-center shadow-glow"
            aria-hidden="true"
          >
            <Wallet size={20} className="text-mint" strokeWidth={2} />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-ink tracking-tight font-display">Tracker26</h1>
            <p className="text-sm text-ink-muted">Sign in to continue</p>
          </div>
        </div>

        <div className="rounded-2xl border border-graphite-border bg-graphite-surface p-5 sm:p-6 shadow-panel">
          {state.status === 'not-configured' ? (
            <p className="text-sm text-warning">
              Login is not configured. Missing: {state.missing.join(', ')}.
            </p>
          ) : (
            <LoginForm next={next} />
          )}
        </div>
      </div>
    </main>
  );
}
