'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ChevronRight, Info, Sparkles, ThumbsUp, TrendingUp, X } from 'lucide-react';
import { dismissInsightAction } from '@/app/(home)/insights/actions';
import { useAskAssistant } from '@/components/assistant/AskAssistant';
import { useToast } from '@/components/ToastProvider';
import type { Severity, ShownInsight } from '@/lib/insights/types';

const TONE: Record<Severity, { icon: React.ElementType; className: string; word: string }> = {
  alert: { icon: AlertTriangle, className: 'text-danger bg-danger-dim border-danger/20', word: 'Needs attention' },
  warning: { icon: TrendingUp, className: 'text-warning bg-warning-dim border-warning/20', word: 'Worth a look' },
  info: { icon: Info, className: 'text-info bg-info-dim border-info/20', word: 'For your information' },
  positive: { icon: ThumbsUp, className: 'text-mint bg-mint-dim border-mint/20', word: 'Good news' },
};

/**
 * The dashboard's insights: at most three, each with a link to what it is
 * about, "Tell me more" (the assistant, with the insight attached) and a
 * dismiss button. Renders nothing when there is nothing to say.
 */
export default function InsightStrip({ insights, note }: { insights: ShownInsight[]; note: string | null }) {
  const router = useRouter();
  const toast = useToast();
  const ask = useAskAssistant();
  // Hide a dismissed insight at once; the refresh brings the stored state.
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const visible = insights.filter((i) => !hidden.has(i.key));

  if (visible.length === 0) {
    if (!note || insights.length > 0) return null;
    return (
      <section aria-label="Insights" className="panel px-5 py-3.5 flex items-start gap-3">
        <Sparkles size={15} className="text-ink-muted shrink-0 mt-0.5" aria-hidden="true" />
        <p className="text-sm text-ink-secondary">{note}</p>
      </section>
    );
  }

  const dismiss = async (insight: ShownInsight) => {
    setHidden((prev) => new Set(prev).add(insight.key));
    const result = await dismissInsightAction(insight.key);
    if (!result.success) {
      setHidden((prev) => {
        const next = new Set(prev);
        next.delete(insight.key);
        return next;
      });
      toast.error(result.error);
      return;
    }
    toast.info(`Dismissed. “${result.label}” insights are muted for ${result.days} days (Settings → Insights).`, 6000);
    router.refresh();
  };

  return (
    <section aria-labelledby="insight-strip-h" className="panel shadow-panel p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3 mb-2">
        <h2
          id="insight-strip-h"
          className="inline-flex items-center gap-1.5 text-[11px] font-medium text-ink-muted uppercase tracking-[0.14em]"
        >
          <Sparkles size={12} className="text-mint" aria-hidden="true" />
          Insights
        </h2>
        <Link href="/settings/insights" className="text-xs text-ink-muted hover:text-ink">
          Settings
        </Link>
      </div>
      <ul className="divide-y divide-graphite-border-subtle">
        {visible.map((insight) => {
          const tone = TONE[insight.severity] ?? TONE.info;
          const Icon = tone.icon;
          return (
            <li key={insight.key} className="flex gap-3 py-3 first:pt-1 last:pb-0">
              <span
                className={`w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 ${tone.className}`}
                title={tone.word}
              >
                <Icon size={15} aria-hidden="true" />
                <span className="sr-only">{tone.word}:</span>
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">{insight.title}</p>
                <p className="text-sm text-ink-secondary leading-snug mt-0.5">{insight.text}</p>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5">
                  <Link
                    href={insight.link.href}
                    className="inline-flex items-center min-h-[36px] text-xs text-ink-secondary hover:text-ink"
                  >
                    {insight.link.label}
                    <ChevronRight size={13} aria-hidden="true" />
                  </Link>
                  <button
                    type="button"
                    onClick={() =>
                      ask.open({
                        page: 'dashboard',
                        insight: {
                          type: insight.type,
                          title: insight.title,
                          text: insight.text,
                          facts: insight.facts.map((f) => `${f.label}: ${f.value}`),
                        },
                      })
                    }
                    className="inline-flex items-center gap-1 min-h-[36px] text-xs font-medium text-mint hover:underline"
                  >
                    <Sparkles size={12} aria-hidden="true" />
                    Tell me more
                  </button>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void dismiss(insight)}
                className="inline-flex h-10 w-10 -mr-2 -mt-1 shrink-0 items-center justify-center rounded-lg text-ink-muted hover:bg-graphite-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint/40"
                aria-label={`Dismiss: ${insight.title}`}
                title="Dismiss"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
