'use server';

import { revalidatePath } from 'next/cache';
import { InsightError, dismissInsight, regenerateRecap, runInsightsCheck } from '@/lib/insights/store';
import { requireSession } from '@/lib/auth/session';
import { rateLimit, retryAfterText } from '@/lib/rateLimit';

/**
 * The insights check, run when the app opens (components/insights/InsightsCheck.tsx).
 * Idempotent per day: see lib/insights/store.ts.
 */
export async function checkInsights() {
  await requireSession();
  try {
    const result = await runInsightsCheck();
    if (result.state === 'ran') {
      revalidatePath('/');
      revalidatePath('/insights');
    }
    return { state: result.state };
  } catch (error) {
    console.error('Insights check failed:', error);
    return { state: 'error' as const };
  }
}

export async function dismissInsightAction(key: string) {
  await requireSession();
  try {
    if (typeof key !== 'string' || !key || key.length > 300) {
      return { success: false as const, error: 'Invalid insight' };
    }
    const result = await dismissInsight(key);
    revalidatePath('/');
    return { success: true as const, label: result.label, days: result.days };
  } catch (error) {
    if (!(error instanceof InsightError)) console.error('Error dismissing insight:', error);
    return {
      success: false as const,
      error: error instanceof InsightError ? error.message : 'Failed to dismiss the insight',
    };
  }
}

/** Regenerate the latest weekly or monthly recap: fresh figures, one model call. */
export async function regenerateRecapAction(key: string) {
  await requireSession();
  try {
    if (typeof key !== 'string' || key.length > 40) return { success: false as const, error: 'Invalid recap' };
    const limit = rateLimit('recap');
    if (!limit.ok) {
      return { success: false as const, error: `Too many requests. Try again ${retryAfterText(limit.retryAfterSeconds)}.` };
    }
    const recap = await regenerateRecap(key);
    revalidatePath('/');
    revalidatePath('/insights');
    return { success: true as const, wording: recap.wording };
  } catch (error) {
    if (!(error instanceof InsightError)) console.error('Error regenerating recap:', error);
    return {
      success: false as const,
      error: error instanceof InsightError ? error.message : 'Failed to regenerate the recap',
    };
  }
}
