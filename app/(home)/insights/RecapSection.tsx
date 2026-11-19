import Link from 'next/link';
import RecapView from '@/components/insights/RecapView';
import RegenerateRecapButton from '@/components/insights/RegenerateRecapButton';
import { todayInAppTimeZone } from '@/lib/dates';
import { getRecap, isRegenerable, listRecaps } from '@/lib/insights/store';

/**
 * The stored weekly and monthly recaps. Reads only: a recap is written once,
 * by the daily insights check, and rewritten only with "Regenerate".
 */
export default async function RecapSection({ selected }: { selected?: string }) {
  let recaps: Awaited<ReturnType<typeof listRecaps>>;
  try {
    recaps = await listRecaps();
  } catch (error) {
    console.error('Error loading recaps:', error);
    return (
      <div role="alert" className="p-4 rounded-2xl border border-danger/25 bg-danger-dim text-danger">
        Couldn&apos;t load recaps.
      </div>
    );
  }

  const key = recaps.some((r) => r.key === selected) ? selected! : recaps[0]?.key;
  const recap = key ? await getRecap(key) : null;
  const today = todayInAppTimeZone();

  return (
    <section id="recap" className="space-y-4 scroll-mt-24" aria-labelledby="recap-h">
      <div>
        <h2 id="recap-h" className="text-xl font-semibold text-ink font-display">
          Recaps
        </h2>
        <p className="text-sm text-ink-muted mt-1">
          Written once a week and at the end of each month, then kept here.
        </p>
      </div>

      {recap ? (
        <RecapView
          recap={recap}
          actions={isRegenerable(recap, today) ? <RegenerateRecapButton recapKey={recap.key} /> : undefined}
        />
      ) : (
        <div className="panel shadow-panel p-6 text-sm text-ink-secondary">
          No recap yet. The first weekly recap is written the first time you open the app after a
          full week (Monday to Sunday) that has entries in it; the first monthly recap after a full
          month.
        </div>
      )}

      {recaps.length > 1 && (
        <nav aria-label="Earlier recaps">
          <h3 className="text-sm font-semibold text-ink font-display mb-2">All recaps</h3>
          <ul className="flex flex-wrap gap-2">
            {recaps.map((r) => {
              const active = r.key === key;
              return (
                <li key={r.key}>
                  <Link
                    href={`/insights?recap=${encodeURIComponent(r.key)}#recap`}
                    aria-current={active ? 'true' : undefined}
                    className={`inline-flex items-center min-h-[40px] px-3.5 rounded-full border text-sm transition-colors ${
                      active
                        ? 'border-mint/40 bg-mint-dim text-mint'
                        : 'border-graphite-border-subtle text-ink-secondary hover:text-ink hover:border-graphite-border'
                    }`}
                  >
                    {r.kind === 'monthly' ? r.label : `Week of ${r.label.split(' – ')[0]}`}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </section>
  );
}
