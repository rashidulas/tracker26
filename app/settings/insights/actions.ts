'use server';

import { revalidatePath } from 'next/cache';
import {
  InsightError,
  loadInsightPreferences,
  setInsightTypeEnabled,
  unmuteInsightType,
} from '@/lib/insights/store';

export async function getInsightSettings() {
  try {
    return { success: true as const, data: await loadInsightPreferences() };
  } catch (error) {
    console.error('Error loading insight settings:', error);
    return { success: false as const, error: 'Failed to load insight settings' };
  }
}

async function change(run: () => Promise<void>) {
  try {
    await run();
    revalidatePath('/settings/insights');
    revalidatePath('/');
    return { success: true as const };
  } catch (error) {
    if (!(error instanceof InsightError)) console.error('Error saving insight settings:', error);
    return {
      success: false as const,
      error: error instanceof InsightError ? error.message : 'Failed to save the setting',
    };
  }
}

export async function setInsightEnabled(type: string, enabled: boolean) {
  return change(() => setInsightTypeEnabled(type, enabled === true));
}

export async function unmuteInsight(type: string) {
  return change(() => unmuteInsightType(type));
}
