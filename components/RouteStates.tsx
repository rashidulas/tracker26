'use client';

// Shared loading skeletons and error boundary UI for route-level
// loading.tsx / error.tsx files.

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle, RotateCcw } from 'lucide-react';

function Bar({ className = '' }: { className?: string }) {
  return <div className={`rounded-lg bg-graphite-surface-2 animate-pulse ${className}`} />;
}

function HeaderSkeleton({ actions = 1 }: { actions?: number }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-8">
      <div className="space-y-2">
        <Bar className="h-8 w-40" />
        <Bar className="h-4 w-64 max-w-full" />
      </div>
      <div className="flex gap-2">
        {Array.from({ length: actions }).map((_, i) => (
          <Bar key={i} className="h-10 w-28 rounded-xl" />
        ))}
      </div>
    </div>
  );
}

export function ListSkeleton({ actions = 1 }: { actions?: number }) {
  return (
    <div className="page-shell" aria-busy="true" aria-label="Loading">
      <HeaderSkeleton actions={actions} />
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <Bar className="h-11 flex-1 rounded-xl" />
        <Bar className="h-11 sm:w-44 rounded-xl" />
      </div>
      <Bar className="h-[88px] w-full rounded-2xl mb-6" />
      {[4, 3].map((rows, g) => (
        <div key={g} className="mb-5">
          <div className="flex items-center justify-between px-1 mb-2">
            <Bar className="h-3 w-20" />
            <Bar className="h-3 w-16" />
          </div>
          <div className="space-y-1.5">
            {Array.from({ length: rows }).map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-3 rounded-2xl border border-graphite-border-subtle bg-graphite-surface px-4 py-3"
              >
                <Bar className="w-10 h-10 rounded-xl shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <Bar className="h-4 w-1/2" />
                  <Bar className="h-3 w-1/3" />
                </div>
                <Bar className="h-5 w-20" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="page-shell space-y-5" aria-busy="true" aria-label="Loading">
      <HeaderSkeleton actions={0} />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="panel p-5 space-y-3">
            <Bar className="h-3 w-24" />
            <Bar className="h-8 w-32" />
            <Bar className="h-3 w-20" />
          </div>
        ))}
      </div>
      <div className="panel p-5 sm:p-6 space-y-5">
        <Bar className="h-5 w-40" />
        {[0, 1].map((i) => (
          <div key={i} className="space-y-2">
            <div className="flex justify-between">
              <Bar className="h-4 w-28" />
              <Bar className="h-4 w-20" />
            </div>
            <Bar className="h-2.5 w-full rounded-full" />
          </div>
        ))}
      </div>
      <div className="panel p-5 sm:p-6">
        <Bar className="h-5 w-48 mb-6" />
        <Bar className="h-[260px] w-full rounded-xl" />
      </div>
    </div>
  );
}

export function RouteError({
  error,
  reset,
  title = 'Something went wrong',
}: {
  error: Error & { digest?: string };
  reset: () => void;
  title?: string;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="page-shell">
      <div className="panel shadow-panel max-w-lg mx-auto mt-8 p-6 sm:p-8 text-center">
        <div className="mx-auto w-12 h-12 rounded-2xl bg-danger-dim flex items-center justify-center mb-4">
          <AlertTriangle className="text-danger" size={22} />
        </div>
        <h2 className="text-lg font-semibold text-ink font-display">{title}</h2>
        <p className="text-sm text-ink-muted mt-1.5">
          The data could not be loaded. Check your connection and try again.
        </p>
        {error.digest && (
          <p className="text-[11px] text-ink-muted/70 mt-2 font-mono">Ref: {error.digest}</p>
        )}
        <div className="flex flex-wrap justify-center gap-2 mt-6">
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-mint text-graphite text-sm font-semibold hover:bg-mint-bright"
          >
            <RotateCcw size={15} />
            Try again
          </button>
          <Link
            href="/dashboard"
            className="inline-flex items-center px-4 py-2.5 rounded-xl border border-graphite-border text-sm text-ink-secondary hover:text-ink hover:bg-graphite-surface-hover"
          >
            Go to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
