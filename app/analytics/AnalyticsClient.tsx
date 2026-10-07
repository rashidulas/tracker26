'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Loader2,
  RefreshCw,
  Sparkles,
  Target,
  Wallet,
} from 'lucide-react';
import Button from '@/components/Button';
import PageHeader from '@/components/PageHeader';

type Debrief = {
  headline: string;
  summary: string;
  mood: 'positive' | 'neutral' | 'caution';
  todayNote: string;
  monthNote: string;
  highlights: string[];
  watchouts: string[];
  actions: string[];
};

type Stats = {
  totalBalance: number;
  cashBalance: number;
  creditCardDebt: number;
  todayIncome: number;
  todayExpenses: number;
  weekExpenses: number;
  monthIncome: number;
  monthExpenses: number;
  monthNet: number;
};

function money(n: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}

function moneyFull(n: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(n);
}

const moodStyles = {
  positive: 'border-mint/30 bg-mint-dim text-mint',
  neutral: 'border-info/30 bg-info-dim text-info',
  caution: 'border-warning/30 bg-warning-dim text-warning',
};

export default function AnalyticsClient() {
  const [debrief, setDebrief] = useState<Debrief | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [topCats, setTopCats] = useState<{ name: string; amount: number }[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/assistant/debrief', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to generate debrief');
      }
      setDebrief(data.data.debrief);
      setStats(data.data.stats);
      setTopCats(data.data.topExpenseCategories || []);
      setGeneratedAt(data.data.generatedAt);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="page-shell space-y-6">
      <PageHeader
        title="Analytics"
        subtitle="AI daily debrief with full context of your money"
        actions={
          <Button
            variant="secondary"
            onClick={() => void load()}
            disabled={loading}
            className="w-full sm:w-auto"
          >
            {loading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <RefreshCw size={16} />
            )}
            Refresh debrief
          </Button>
        }
      />

      {error && (
        <div className="panel border-danger/25 bg-danger-dim p-4 text-danger text-sm flex gap-3">
          <AlertTriangle size={18} className="shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">Couldn’t generate debrief</p>
            <p className="opacity-80 mt-1">{error}</p>
          </div>
        </div>
      )}

      {loading && !debrief && (
        <div className="panel shadow-panel p-10 flex flex-col items-center justify-center text-ink-muted gap-3">
          <Loader2 size={28} className="animate-spin text-mint" />
          <p className="text-sm">Reading your accounts, transactions, and goals…</p>
        </div>
      )}

      {debrief && stats && (
        <>
          <section className="panel shadow-panel overflow-hidden relative">
            <div className="absolute inset-0 bg-gradient-to-br from-mint/[0.08] via-transparent to-info/[0.06] pointer-events-none" />
            <div className="relative p-5 sm:p-7 space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.16em] text-mint">
                  <Sparkles size={12} />
                  Daily debrief
                </span>
                <span
                  className={`text-[11px] font-medium px-2.5 py-0.5 rounded-full border capitalize ${moodStyles[debrief.mood]}`}
                >
                  {debrief.mood}
                </span>
                {generatedAt && (
                  <span className="text-[11px] text-ink-muted ml-auto">
                    {new Date(generatedAt).toLocaleString()}
                  </span>
                )}
              </div>
              <h2 className="text-2xl sm:text-3xl font-semibold text-ink font-display tracking-tight">
                {debrief.headline}
              </h2>
              <p className="text-ink-secondary leading-relaxed max-w-3xl">{debrief.summary}</p>
              <div className="grid sm:grid-cols-2 gap-3 pt-1">
                <div className="rounded-xl border border-graphite-border-subtle bg-graphite-elevated/60 p-3.5">
                  <p className="text-[11px] text-ink-muted uppercase tracking-[0.12em] mb-1">
                    Today
                  </p>
                  <p className="text-sm text-ink">{debrief.todayNote}</p>
                </div>
                <div className="rounded-xl border border-graphite-border-subtle bg-graphite-elevated/60 p-3.5">
                  <p className="text-[11px] text-ink-muted uppercase tracking-[0.12em] mb-1">
                    This month
                  </p>
                  <p className="text-sm text-ink">{debrief.monthNote}</p>
                </div>
              </div>
            </div>
          </section>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <StatCard
              label="Total balance"
              value={money(stats.totalBalance)}
              icon={Wallet}
              tone={stats.totalBalance >= 0 ? 'mint' : 'danger'}
            />
            <StatCard
              label="Today spent"
              value={moneyFull(stats.todayExpenses)}
              icon={ArrowDownRight}
              tone="danger"
              sub={`In ${moneyFull(stats.todayIncome)}`}
            />
            <StatCard
              label="Month net"
              value={money(stats.monthNet)}
              icon={stats.monthNet >= 0 ? ArrowUpRight : ArrowDownRight}
              tone={stats.monthNet >= 0 ? 'mint' : 'danger'}
              sub={`${money(stats.monthIncome)} in · ${money(stats.monthExpenses)} out`}
            />
            <StatCard
              label="7-day spend"
              value={money(stats.weekExpenses)}
              icon={Target}
              tone="neutral"
              sub={
                stats.creditCardDebt > 0
                  ? `Card debt ${money(stats.creditCardDebt)}`
                  : `Cash ${money(stats.cashBalance)}`
              }
            />
          </div>

          <div className="grid lg:grid-cols-3 gap-4">
            <InsightList
              title="Highlights"
              items={debrief.highlights}
              empty="No highlights yet — log a few transactions."
              accent="mint"
            />
            <InsightList
              title="Watch outs"
              items={debrief.watchouts}
              empty="Nothing concerning right now."
              accent="warning"
            />
            <InsightList
              title="Suggested actions"
              items={debrief.actions}
              empty="Keep logging — suggestions will show up."
              accent="info"
            />
          </div>

          {topCats.length > 0 && (
            <section className="panel shadow-panel p-5 sm:p-6">
              <h3 className="text-lg font-semibold text-ink font-display mb-4">
                Top spending this month
              </h3>
              <div className="space-y-3">
                {topCats.map((cat) => {
                  const max = topCats[0]?.amount || 1;
                  const pct = Math.min((cat.amount / max) * 100, 100);
                  return (
                    <div key={cat.name}>
                      <div className="flex justify-between text-sm mb-1.5">
                        <span className="text-ink-secondary">{cat.name}</span>
                        <span className="money text-ink">{moneyFull(cat.amount)}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-graphite-surface-2 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-mint/80"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  tone,
  sub,
}: {
  label: string;
  value: string;
  icon: React.ElementType;
  tone: 'mint' | 'danger' | 'neutral';
  sub?: string;
}) {
  const toneClass =
    tone === 'mint'
      ? 'text-mint bg-mint-dim'
      : tone === 'danger'
        ? 'text-danger bg-danger-dim'
        : 'text-ink-secondary bg-graphite-surface-2';

  return (
    <div className="panel shadow-panel p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${toneClass}`}>
          <Icon size={15} />
        </span>
        <p className="text-[11px] text-ink-muted uppercase tracking-[0.12em]">{label}</p>
      </div>
      <p className="text-xl font-semibold text-ink money">{value}</p>
      {sub && <p className="text-[11px] text-ink-muted mt-1">{sub}</p>}
    </div>
  );
}

function InsightList({
  title,
  items,
  empty,
  accent,
}: {
  title: string;
  items: string[];
  empty: string;
  accent: 'mint' | 'warning' | 'info';
}) {
  const dot =
    accent === 'mint'
      ? 'bg-mint'
      : accent === 'warning'
        ? 'bg-warning'
        : 'bg-info';

  return (
    <section className="panel shadow-panel p-5">
      <h3 className="text-base font-semibold text-ink font-display mb-3">{title}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-ink-muted">{empty}</p>
      ) : (
        <ul className="space-y-2.5">
          {items.map((item) => (
            <li key={item} className="flex gap-2.5 text-sm text-ink-secondary leading-snug">
              <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
