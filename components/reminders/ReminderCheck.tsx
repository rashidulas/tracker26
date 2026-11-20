'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BellRing } from 'lucide-react';
import Modal from '@/components/Modal';
import Button from '@/components/Button';
import UpcomingList from '@/components/recurring/UpcomingList';
import { useReminders } from '@/components/reminders/reminderStore';
import type { Reminder } from '@/lib/reminders';

const SEEN_KEY = 'tracker26:reminders-seen';

/** Which reminders this device has already shown, per day. */
function readSeen(today: string): Set<string> {
  try {
    const stored = JSON.parse(localStorage.getItem(SEEN_KEY) ?? 'null') as
      | { day?: string; keys?: string[] }
      | null;
    return new Set(stored?.day === today ? stored.keys ?? [] : []);
  } catch {
    return new Set();
  }
}

function writeSeen(today: string, keys: Set<string>) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify({ day: today, keys: [...keys] }));
  } catch {
    // Private mode: the pop-up shows again on the next page load, no harm.
  }
}

/** A reminder is shown once per day and per stage: again when "soon" turns into "today". */
const seenKey = (r: Reminder) => `${r.key}:${r.stage}`;

function heading(reminders: Reminder[]) {
  const due = reminders.filter((r) => r.stage !== 'soon').length;
  if (due === 0) return reminders.length === 1 ? 'A payment is coming up' : 'Payments coming up';
  if (reminders.some((r) => r.stage === 'overdue')) {
    return due === 1 ? 'A payment is overdue' : `${due} payments need you`;
  }
  return due === 1 ? 'Due today' : `${due} things are due today`;
}

/**
 * The first time the app is opened on a day with something due (or coming
 * due within its lead time), show it. Closing it, or handling the entries,
 * keeps it quiet for the rest of the day on this device; the badge on Plan
 * and the Reminders tab stay until the entries are paid or skipped.
 */
export default function ReminderCheck() {
  const { today, reminders, loaded } = useReminders();
  const pathname = usePathname();
  const [shown, setShown] = useState<Reminder[] | null>(null);
  // Handled everything in the pop-up: don't reopen it for what comes next today.
  const done = useRef(false);

  useEffect(() => {
    if (!loaded || shown || done.current || reminders.length === 0) return;
    // The Reminders page already shows them; don't interrupt the chat either.
    if (pathname.startsWith('/plan/reminders') || pathname.startsWith('/chat')) return;
    const seen = readSeen(today);
    if (reminders.every((r) => seen.has(seenKey(r)))) return;
    setShown(reminders);
    // Mark at once: a second tab or a reload should not repeat it.
    writeSeen(today, new Set([...seen, ...reminders.map(seenKey)]));
  }, [loaded, reminders, today, shown, pathname]);

  const title = useMemo(() => (shown ? heading(shown) : ''), [shown]);
  if (!shown) return null;

  return (
    <Modal
      isOpen
      onClose={() => setShown(null)}
      title={title}
      description="Mark each one paid when you have paid it, or skip it this time."
      size="lg"
      footer={
        <div className="flex gap-3">
          <Link
            href="/plan/reminders"
            onClick={() => setShown(null)}
            className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl border border-graphite-border bg-graphite-surface-2 px-4 py-2.5 text-sm font-medium text-ink-secondary hover:text-ink"
          >
            <BellRing size={16} aria-hidden="true" />
            All reminders
          </Link>
          <Button type="button" onClick={() => setShown(null)} className="flex-1">
            Later
          </Button>
        </div>
      }
    >
      <UpcomingList
        items={shown}
        emptyText="All done for now."
        // Close once the last one is handled.
        onHandled={(item) => {
          const left = shown.filter((r) => r.recurringId !== item.recurringId || r.dueDate !== item.dueDate);
          setShown(left.length > 0 ? left : null);
          if (left.length === 0) done.current = true;
        }}
      />
    </Modal>
  );
}
