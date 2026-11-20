'use client';

/**
 * Today's reminders (lib/reminders.ts), shared by the navigation badge, the
 * Plan tab and the first-open-of-the-day pop-up. One value: every component
 * that shows it subscribes here, and anything that may change it (posting or
 * skipping an entry, saving a recurring entry) calls notifyRemindersChanged().
 */
import { useEffect, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import { getReminders } from '@/app/plan/reminders/actions';
import type { Reminder } from '@/lib/reminders';

export type ReminderState = { today: string; reminders: Reminder[]; loaded: boolean };

const EMPTY: ReminderState = { today: '', reminders: [], loaded: false };
let state: ReminderState = EMPTY;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function refresh() {
  loading ??= getReminders()
    .then((value) => {
      state = { ...value, loaded: true };
      listeners.forEach((listener) => listener());
    })
    // A hint, not data: a failed load keeps the last list.
    .catch(() => {})
    .finally(() => {
      loading = null;
    });
  return loading;
}

const EVENT = 'tracker26:reminders';

/** Something that may have added or settled a reminder just happened. */
export function notifyRemindersChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT));
}

export function useReminders(): ReminderState {
  const pathname = usePathname();
  const value = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
    () => EMPTY
  );

  useEffect(() => {
    void refresh();
  }, [pathname]);

  useEffect(() => {
    const onChange = () => void refresh();
    // Coming back to an open tab the next morning counts as opening the app.
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

/** Reminders that are due today or overdue: the number on the badge. */
export function useDueCount(): number {
  return useReminders().reminders.filter((r) => r.stage !== 'soon').length;
}
