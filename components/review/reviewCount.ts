'use client';

/**
 * How many transactions wait in the review inbox, for the navigation badge
 * and the Transactions tab. One shared value: every component that shows it
 * subscribes here, and anything that may change it (a save from voice or a
 * receipt, the assistant, the due check, approving in the inbox) calls
 * notifyReviewChanged().
 */
import { useEffect, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import { getReviewCount } from '@/app/transactions/review/actions';

let count = 0;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function set(next: number) {
  if (next === count) return;
  count = next;
  listeners.forEach((listener) => listener());
}

function refresh() {
  loading ??= getReviewCount()
    .then((value) => set(value))
    // The badge is a hint; a failed count just leaves the last one.
    .catch(() => {})
    .finally(() => {
      loading = null;
    });
  return loading;
}

const EVENT = 'tracker26:review';

/** Something that may have added to or cleared the inbox just happened. */
export function notifyReviewChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT));
}

/** Set the count directly when the caller already knows it (the inbox itself). */
export function setReviewCount(value: number) {
  set(Math.max(0, value));
}

export function useReviewCount(): number {
  const pathname = usePathname();
  const value = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => count,
    () => 0
  );

  // Moving between pages is when a stale badge would be noticed.
  useEffect(() => {
    void refresh();
  }, [pathname]);

  useEffect(() => {
    const onChange = () => void refresh();
    const onVisible = () => document.visibilityState === 'visible' && void refresh();
    window.addEventListener(EVENT, onChange);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener(EVENT, onChange);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return value;
}
