'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/Button';
import PageHeader from '@/components/PageHeader';
import TabNav from '@/components/TabNav';
import { useToast } from '@/components/ToastProvider';
import { formatDay } from '@/lib/dates';
import type { InsightPreferenceView } from '@/lib/insights/store';
import { MAX_SHOWN, MUTE_DAYS } from '@/lib/insights/types';
import { SETTINGS_TABS } from '../tabs';
import { setInsightEnabled, unmuteInsight } from './actions';

export default function InsightSettingsClient({ preferences }: { preferences: InsightPreferenceView[] }) {
  const router = useRouter();
  const toast = useToast();
  const [rows, setRows] = useState(preferences);
  const [busy, setBusy] = useState<string | null>(null);

  const update = async (
    type: string,
    patch: Partial<InsightPreferenceView>,
    save: () => Promise<{ success: boolean; error?: string }>
  ) => {
    const before = rows;
    setBusy(type);
    setRows((list) => list.map((row) => (row.type === type ? { ...row, ...patch } : row)));
    const result = await save();
    setBusy(null);
    if (!result.success) {
      setRows(before);
      toast.error(result.error ?? 'Failed to save the setting');
      return;
    }
    router.refresh();
  };

  return (
    <div className="page-shell">
      <PageHeader title="Settings" subtitle="Categories, merchant memory and insights" />
      <TabNav tabs={SETTINGS_TABS} label="Settings sections" />

      <div className="space-y-4">
        <p className="text-sm text-ink-secondary max-w-2xl">
          The home page shows at most {MAX_SHOWN} insights, checked once a day. Dismissing one mutes its
          kind for {MUTE_DAYS} days. Turn a kind off here to stop seeing it: it is hidden at once, and
          no longer looked for from the next daily check.
        </p>

        <ul className="panel shadow-panel divide-y divide-graphite-border-subtle">
          {rows.map((row) => (
            <li key={row.type} className="flex items-center gap-4 p-4 sm:p-5">
              <div className="min-w-0 flex-1">
                <p id={`insight-${row.type}`} className="text-sm font-medium text-ink">
                  {row.label}
                </p>
                <p className="text-sm text-ink-muted mt-0.5">{row.description}</p>
                {row.enabled && row.mutedUntil && (
                  <p className="text-xs text-warning mt-1.5 flex flex-wrap items-center gap-2">
                    Muted until {formatDay(row.mutedUntil, { month: 'short', day: 'numeric' })}
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy === row.type}
                      onClick={() => void update(row.type, { mutedUntil: null }, () => unmuteInsight(row.type))}
                    >
                      Unmute
                    </Button>
                  </p>
                )}
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={row.enabled}
                aria-labelledby={`insight-${row.type}`}
                disabled={busy === row.type}
                onClick={() =>
                  void update(row.type, { enabled: !row.enabled }, () => setInsightEnabled(row.type, !row.enabled))
                }
                className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint/40 disabled:opacity-60 ${
                  row.enabled ? 'bg-mint border-mint' : 'bg-graphite-surface-2 border-graphite-border'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
                    row.enabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
