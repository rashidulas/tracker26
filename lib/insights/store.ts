/**
 * Stored insights and recaps: the daily check, dismissing, preferences and
 * the reads the pages use. Server-only.
 *
 * THE DAILY CHECK (runInsightsCheck)
 * ----------------------------------
 * Runs when the app is opened (components/insights/InsightsCheck.tsx) and from
 * the cron route (app/api/insights/run). It is idempotent per calendar day:
 * the first caller creates the day's InsightRun row, and the unique index on
 * its day makes every other caller that day a no-op. So two tabs opening at
 * once produce one run, one stored recap and one model call. A run that died
 * half way is taken over after STALE_RUN_MS.
 *
 * A run detects insights in code, stores each one under its key, and makes at
 * most ONE model call that words the few insights that will be shown plus any
 * recap that is due. Nothing here runs on an ordinary page load: pages only
 * read what is stored.
 *
 * KEYS
 * ----
 * Insights are stored by key (type, subject, period). The same insight is
 * therefore one row: it is shown until it is dismissed, stops being detected,
 * or is SHOW_DAYS old, and never again after that. Dismissing one also mutes
 * its type for MUTE_DAYS.
 */
import type { LanguageModel } from 'ai';
import { getHelperModel } from '@/lib/assistant/model';
import { addDays, isValidDay, todayInAppTimeZone, type DayString } from '@/lib/dates';
import { daysBetween } from '@/lib/recurringSchedule';
import { detectInsights, rankInsights } from './detect';
import { loadFirstDay, loadInsightData, type InsightDb } from './load';
import {
  buildRecap,
  lastCompletedPeriod,
  recapKey,
  recapLabel,
  type RecapFacts,
  type RecapKind,
  type RecapText,
} from './recap';
import {
  INSIGHT_TYPES,
  INSIGHT_TYPE_INFO,
  MAX_SHOWN,
  MIN_HISTORY_DAYS,
  MUTE_DAYS,
  SHOW_DAYS,
  historyNote,
  isInsightType,
  type DetectedInsight,
  type InsightType,
  type ShownInsight,
} from './types';
import { writeWording } from './wording';

/** A run still marked running after this long is assumed dead and taken over. */
export const STALE_RUN_MS = 2 * 60 * 1000;
/** The wording call is abandoned after this long; templates are used instead. */
const WORDING_TIMEOUT_MS = 20 * 1000;

export type InsightDeps = {
  db?: InsightDb;
  /** null = no model (templates only). Omitted = the configured helper model. */
  model?: LanguageModel | null;
  today?: DayString;
  now?: () => Date;
};

async function resolve(deps: InsightDeps = {}) {
  const db = deps.db ?? ((await import('@/lib/prisma')).prisma as InsightDb);
  let model = deps.model;
  if (model === undefined) {
    const config = getHelperModel();
    model = config.ok ? config.model : null;
  }
  return { db, model, today: deps.today ?? todayInAppTimeZone(), now: deps.now ?? (() => new Date()) };
}

const isUniqueViolation = (error: unknown) => (error as { code?: string } | null)?.code === 'P2002';

/** Thrown for a request the caller can correct. */
export class InsightError extends Error {}

function parseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

// ==================== PREFERENCES ====================

async function loadPreferenceRows(db: InsightDb, today: DayString) {
  const rows = await db.insightPreference.findMany({});
  const disabled = new Set<string>();
  const muted = new Map<string, DayString>();
  for (const row of rows) {
    if (row.enabled === false) disabled.add(row.type);
    if (row.mutedUntil && isValidDay(row.mutedUntil) && today < row.mutedUntil) muted.set(row.type, row.mutedUntil);
  }
  return { disabled, muted };
}

export type InsightPreferenceView = {
  type: InsightType;
  label: string;
  description: string;
  enabled: boolean;
  /** Set while the type is muted after a dismissal. */
  mutedUntil: DayString | null;
};

export async function loadInsightPreferences(deps?: InsightDeps): Promise<InsightPreferenceView[]> {
  const { db, today } = await resolve({ ...deps, model: null });
  const { disabled, muted } = await loadPreferenceRows(db, today);
  return INSIGHT_TYPES.map((type) => ({
    type,
    ...INSIGHT_TYPE_INFO[type],
    enabled: !disabled.has(type),
    mutedUntil: muted.get(type) ?? null,
  }));
}

export async function setInsightTypeEnabled(type: string, enabled: boolean, deps?: InsightDeps) {
  if (!isInsightType(type)) throw new InsightError('Unknown insight type');
  const { db } = await resolve({ ...deps, model: null });
  await db.insightPreference.upsert({
    where: { type },
    create: { type, enabled },
    update: { enabled },
  });
}

export async function unmuteInsightType(type: string, deps?: InsightDeps) {
  if (!isInsightType(type)) throw new InsightError('Unknown insight type');
  const { db } = await resolve({ ...deps, model: null });
  await db.insightPreference.upsert({
    where: { type },
    create: { type, mutedUntil: null },
    update: { mutedUntil: null },
  });
}

// ==================== DISMISS ====================

/** Hide an insight for good and mute its type for MUTE_DAYS. */
export async function dismissInsight(key: string, deps?: InsightDeps) {
  const { db, today, now } = await resolve({ ...deps, model: null });
  const row = await db.insight.findUnique({ where: { key } });
  if (!row) throw new InsightError('That insight no longer exists');
  const mutedUntil = addDays(today, MUTE_DAYS);
  await db.insight.update({ where: { key }, data: { dismissedAt: now() } });
  await db.insightPreference.upsert({
    where: { type: row.type },
    create: { type: row.type, mutedUntil },
    update: { mutedUntil },
  });
  const label = isInsightType(row.type) ? INSIGHT_TYPE_INFO[row.type].label : row.type;
  return { type: row.type, label, mutedUntil, days: MUTE_DAYS };
}

// ==================== THE DAILY CHECK ====================

async function claimRun(db: InsightDb, day: DayString, now: Date): Promise<'claimed' | 'done' | 'busy'> {
  try {
    await db.insightRun.create({ data: { day, status: 'running', claimedAt: now } });
    return 'claimed';
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
  }
  const run = await db.insightRun.findUnique({ where: { day } });
  if (!run) return 'busy';
  if (run.status === 'done') return 'done';
  if (now.getTime() - run.claimedAt.getTime() < STALE_RUN_MS) return 'busy';
  // Take over a dead run. The claimedAt condition lets only one caller win.
  const { count } = await db.insightRun.updateMany({
    where: { day, status: 'running', claimedAt: run.claimedAt },
    data: { claimedAt: now },
  });
  return count === 1 ? 'claimed' : 'busy';
}

type StoredData = Omit<DetectedInsight, 'key' | 'type' | 'severity'>;

const storedData = (insight: DetectedInsight): string => {
  const { key: _key, type: _type, severity: _severity, ...rest } = insight;
  return JSON.stringify(rest satisfies StoredData);
};

function isShowable(
  row: { type: string; firstDay: string; dismissedAt: Date | null },
  today: DayString,
  prefs: { disabled: Set<string>; muted: Map<string, DayString> }
) {
  return (
    !row.dismissedAt &&
    !prefs.disabled.has(row.type) &&
    !prefs.muted.has(row.type) &&
    daysBetween(row.firstDay, today) < SHOW_DAYS
  );
}

export type CheckResult =
  /** Already ran today: nothing was done. */
  | { state: 'done' }
  /** Another request is running it right now. */
  | { state: 'busy' }
  | { state: 'ran'; detected: number; recaps: string[]; modelCalled: boolean };

export async function runInsightsCheck(deps?: InsightDeps): Promise<CheckResult> {
  const { db, model, today, now } = await resolve(deps);
  const claim = await claimRun(db, today, now());
  if (claim !== 'claimed') return { state: claim };

  const prefs = await loadPreferenceRows(db, today);
  const data = await loadInsightData(db, today);
  const { insights: detected } = detectInsights(data, { disabled: prefs.disabled });

  // ---- store what was detected, one row per key ----
  const existing = await db.insight.findMany({ where: { key: { in: detected.map((i) => i.key) } } });
  const byKey = new Map(existing.map((row) => [row.key, row]));
  const candidates: DetectedInsight[] = [];
  for (const insight of detected) {
    const json = storedData(insight);
    const row = byKey.get(insight.key);
    if (!row) {
      try {
        await db.insight.create({
          data: {
            key: insight.key,
            type: insight.type,
            severity: insight.severity,
            data: json,
            text: insight.plain,
            wording: 'template',
            firstDay: today,
            lastSeenDay: today,
          },
        });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        continue;
      }
      if (isShowable({ type: insight.type, firstDay: today, dismissedAt: null }, today, prefs)) candidates.push(insight);
      continue;
    }
    const changed = row.data !== json;
    await db.insight.update({
      where: { key: insight.key },
      data: {
        lastSeenDay: today,
        severity: insight.severity,
        // New figures: the stored sentence no longer matches them.
        ...(changed ? { data: json, text: insight.plain, wording: 'template' } : {}),
      },
    });
    if (isShowable(row, today, prefs) && (changed || row.wording !== 'model')) candidates.push(insight);
  }

  // Only the few that will be on the dashboard are sent to the model.
  const shownKeys = new Set(
    rankInsights(
      detected.filter((i) => {
        const row = byKey.get(i.key);
        return isShowable(row ?? { type: i.type, firstDay: today, dismissedAt: null }, today, prefs);
      })
    )
      .slice(0, MAX_SHOWN)
      .map((i) => i.key)
  );
  const toWord = candidates.filter((i) => shownKeys.has(i.key));

  // ---- recaps that are due: the last completed week and month, once each ----
  const due: { key: string; kind: RecapKind; facts: RecapFacts }[] = [];
  for (const kind of ['weekly', 'monthly'] as const) {
    const period = lastCompletedPeriod(kind, today);
    // Nothing recorded up to the end of the period: there is nothing to recap.
    if (!data.firstDay || data.firstDay > period.end) continue;
    const key = recapKey(kind, period.start);
    if (await db.recap.findUnique({ where: { key } })) continue;
    due.push({ key, kind, facts: buildRecap(data, kind, period.start) });
  }

  // ---- one model call for everything ----
  const wording = await writeWording({
    model,
    insights: toWord,
    recaps: due,
    abortSignal: AbortSignal.timeout(WORDING_TIMEOUT_MS),
  });
  if (wording.error) console.error('Insight wording failed, using templates:', wording.error);

  for (const [key, text] of wording.insights) {
    await db.insight.update({ where: { key }, data: { text, wording: 'model' } });
  }
  const created: string[] = [];
  for (const recap of due) {
    const written = wording.recaps.get(recap.key)!;
    try {
      await db.recap.create({
        data: {
          key: recap.key,
          kind: recap.kind,
          periodStart: recap.facts.periodStart,
          periodEnd: recap.facts.periodEnd,
          data: JSON.stringify(recap.facts),
          text: JSON.stringify(written.text),
          wording: written.fromModel ? 'model' : 'template',
          generatedAt: now(),
        },
      });
      created.push(recap.key);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }

  await db.insightRun.update({
    where: { day: today },
    data: { status: 'done', finishedAt: now(), modelCalls: wording.called ? 1 : 0 },
  });
  return { state: 'ran', detected: detected.length, recaps: created, modelCalled: wording.called };
}

// ==================== READS ====================

function toShown(row: { key: string; type: string; severity: string; data: string; text: string; wording: string }) {
  const data = parseJson<StoredData>(row.data);
  if (!data || !isInsightType(row.type)) return null;
  const shown: ShownInsight & { weight: number } = {
    key: row.key,
    type: row.type,
    severity: row.severity as ShownInsight['severity'],
    title: data.title,
    text: row.text,
    facts: data.facts ?? [],
    link: data.link,
    wording: row.wording === 'model' ? 'model' : 'template',
    weight: data.weight ?? 0,
  };
  return shown;
}

/**
 * What the dashboard strip shows: at most MAX_SHOWN stored insights from the
 * latest check, or a plain note when there is not enough history yet. Reads
 * only; never detects or calls a model.
 */
export async function loadInsightStrip(deps?: InsightDeps): Promise<{ insights: ShownInsight[]; note: string | null }> {
  const { db, today } = await resolve({ ...deps, model: null });
  const runs = await db.insightRun.findMany({ where: { status: 'done' }, orderBy: { day: 'desc' }, take: 1 });
  const latest = runs[0];
  const [rows, prefs] = await Promise.all([
    latest ? db.insight.findMany({ where: { lastSeenDay: latest.day } }) : Promise.resolve([]),
    loadPreferenceRows(db, today),
  ]);
  const insights = rankInsights(
    rows
      .filter((row) => isShowable(row, today, prefs))
      .map(toShown)
      .filter((i): i is NonNullable<typeof i> => i !== null)
  )
    .slice(0, MAX_SHOWN)
    .map(({ weight: _weight, ...insight }) => insight);

  let note: string | null = null;
  if (insights.length === 0) {
    const firstDay = await loadFirstDay(db);
    const days = firstDay ? Math.max(0, daysBetween(firstDay, today)) : 0;
    // With no data at all the dashboard already says so; only the "not yet" case is worth a line.
    if (firstDay && days < MIN_HISTORY_DAYS) note = historyNote(firstDay, days).message;
  }
  return { insights, note };
}

export type StoredRecap = {
  key: string;
  kind: RecapKind;
  label: string;
  facts: RecapFacts;
  text: RecapText;
  wording: 'template' | 'model';
  generatedAt: string;
};

function toStoredRecap(row: { key: string; kind: string; data: string; text: string; wording: string; generatedAt: Date }): StoredRecap | null {
  const facts = parseJson<RecapFacts>(row.data);
  const text = parseJson<RecapText>(row.text);
  if (!facts || !text || (row.kind !== 'weekly' && row.kind !== 'monthly')) return null;
  return {
    key: row.key,
    kind: row.kind,
    label: facts.label,
    facts,
    text,
    wording: row.wording === 'model' ? 'model' : 'template',
    generatedAt: row.generatedAt.toISOString(),
  };
}

export type RecapListItem = { key: string; kind: RecapKind; label: string; periodStart: DayString };

/** Stored recaps, newest period first (a month sorts after the weeks inside it). */
export async function listRecaps(deps?: InsightDeps): Promise<RecapListItem[]> {
  const { db } = await resolve({ ...deps, model: null });
  const rows = await db.recap.findMany({
    select: { key: true, kind: true, periodStart: true, periodEnd: true },
    orderBy: [{ periodEnd: 'desc' }, { kind: 'asc' }],
    take: 120,
  });
  return rows
    .filter((r): r is typeof r & { kind: RecapKind } => r.kind === 'weekly' || r.kind === 'monthly')
    .map((r) => ({ key: r.key, kind: r.kind, label: recapLabel(r.kind, r.periodStart), periodStart: r.periodStart }));
}

export async function getRecap(key: string, deps?: InsightDeps): Promise<StoredRecap | null> {
  const { db } = await resolve({ ...deps, model: null });
  const row = await db.recap.findUnique({ where: { key } });
  return row ? toStoredRecap(row) : null;
}

/** Recaps the dashboard shows today: the weekly one on Mondays, the monthly one in the first days of a month. */
export async function loadDashboardRecaps(deps?: InsightDeps): Promise<StoredRecap[]> {
  const { db, today } = await resolve({ ...deps, model: null });
  const kinds: RecapKind[] = [];
  if (Number(today.slice(8, 10)) <= MONTHLY_ON_DASHBOARD_DAYS) kinds.push('monthly');
  if (lastCompletedPeriod('weekly', today).end === addDays(today, -1)) kinds.push('weekly');
  const out: StoredRecap[] = [];
  for (const kind of kinds) {
    const recap = await getRecap(recapKey(kind, lastCompletedPeriod(kind, today).start), { db, today });
    if (recap) out.push(recap);
  }
  return out;
}

/** The monthly recap stays on the dashboard for the first days of the new month. */
export const MONTHLY_ON_DASHBOARD_DAYS = 3;

/** Whether a recap can be regenerated: only the latest completed week and month, whose history is loaded. */
export function isRegenerable(recap: { kind: RecapKind; facts: { periodStart: DayString } }, today: DayString) {
  return lastCompletedPeriod(recap.kind, today).start === recap.facts.periodStart;
}

/**
 * Regenerate a recap on demand: fresh figures as of today and one model call.
 * Only for the latest completed week or month.
 */
export async function regenerateRecap(key: string, deps?: InsightDeps): Promise<StoredRecap> {
  const { db, model, today, now } = await resolve(deps);
  const [kind, start] = key.split(':') as [RecapKind, DayString];
  if ((kind !== 'weekly' && kind !== 'monthly') || lastCompletedPeriod(kind, today).start !== start) {
    throw new InsightError('Only the latest recap can be regenerated');
  }
  const data = await loadInsightData(db, today);
  const facts = buildRecap(data, kind, start);
  const wording = await writeWording({
    model,
    insights: [],
    recaps: [{ key, facts }],
    abortSignal: AbortSignal.timeout(WORDING_TIMEOUT_MS),
  });
  if (wording.error) console.error('Recap wording failed, using the template:', wording.error);
  const written = wording.recaps.get(key)!;
  const fields = {
    kind,
    periodStart: facts.periodStart,
    periodEnd: facts.periodEnd,
    data: JSON.stringify(facts),
    text: JSON.stringify(written.text),
    wording: written.fromModel ? 'model' : 'template',
    generatedAt: now(),
  };
  const row = await db.recap.upsert({ where: { key }, create: { key, ...fields }, update: fields });
  return toStoredRecap(row)!;
}
