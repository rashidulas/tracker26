'use client';

import Link from 'next/link';
import { BellRing, CalendarDays, CheckCircle2 } from 'lucide-react';
import UpcomingList from '@/components/recurring/UpcomingList';
import PushToggle from '@/components/reminders/PushToggle';
import { DEFAULT_REMIND_DAYS, REMINDER_HORIZON_DAYS } from '@/lib/reminders';
import { formatCurrency } from '@/lib/utils';
import type { RemindersPageData } from './actions';

export default function RemindersClient({ data }: { data: RemindersPageData }) {
  const due = data.reminders.filter((r) => r.stage !== 'soon');
  const soon = data.reminders.filter((r) => r.stage === 'soon');
  const dueTotal = due.filter((r) => r.kind !== 'INCOME').reduce((sum, r) => sum + r.amount, 0);

  return (
    <div className="space-y-5">
      <section className="panel shadow-panel p-5 sm:p-6" aria-labelledby="due-heading">
        <div className="flex items-center gap-2.5 mb-1">
          <div
            className={`w-8 h-8 rounded-lg flex items-center justify-center border ${
              due.length > 0 ? 'bg-warning-dim border-warning/20' : 'bg-mint-dim border-mint/15'
            }`}
          >
            {due.length > 0 ? (
              <BellRing size={15} className="text-warning" aria-hidden="true" />
            ) : (
              <CheckCircle2 size={15} className="text-mint" aria-hidden="true" />
            )}
          </div>
          <h2 id="due-heading" className="text-lg font-semibold text-ink font-display">
            {due.length > 0 ? 'Needs you now' : 'Nothing due today'}
          </h2>
        </div>
        <p className="text-xs text-ink-muted mb-3 pl-[42px]">
          {due.length > 0 ? (
            <>
              Due today or overdue ·{' '}
              <span className="money text-ink-secondary">{formatCurrency(dueTotal)}</span> to pay
            </>
          ) : (
            'Payments show here on the day they are due and stay until you mark them paid or skip them.'
          )}
        </p>
        {due.length > 0 && <UpcomingList items={due} />}
      </section>

      {soon.length > 0 && (
        <section className="panel shadow-panel p-5 sm:p-6" aria-labelledby="soon-heading">
          <h2 id="soon-heading" className="text-lg font-semibold text-ink font-display">
            Coming up
          </h2>
          <p className="text-xs text-ink-muted mt-0.5 mb-3">
            Inside each entry’s reminder window. You can pay early; it is dated today.
          </p>
          <UpcomingList items={soon} />
        </section>
      )}

      <section className="panel shadow-panel p-5 sm:p-6" aria-labelledby="later-heading">
        <div className="flex items-center gap-2 mb-0.5">
          <CalendarDays size={16} className="text-info" aria-hidden="true" />
          <h2 id="later-heading" className="text-lg font-semibold text-ink font-display">
            Later
          </h2>
        </div>
        <p className="text-xs text-ink-muted mb-3">The next {REMINDER_HORIZON_DAYS} days</p>
        <UpcomingList items={data.later} emptyText={`Nothing else in the next ${REMINDER_HORIZON_DAYS} days.`} />
      </section>

      <section className="panel shadow-panel p-5 sm:p-6" aria-labelledby="notify-heading">
        <h2 id="notify-heading" className="text-lg font-semibold text-ink font-display mb-2">
          Notifications
        </h2>
        <PushToggle push={data.push} />
        <p className="text-xs text-ink-muted mt-4">
          Reminders start {DEFAULT_REMIND_DAYS} days before the due date unless an entry says
          otherwise. Change it per entry on the{' '}
          <Link href="/plan/recurring" className="text-mint hover:text-mint-bright">
            Recurring
          </Link>{' '}
          tab. Entries that post automatically don’t remind.
        </p>
      </section>
    </div>
  );
}
