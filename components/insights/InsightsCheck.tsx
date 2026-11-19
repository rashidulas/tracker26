'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { checkInsights } from '@/app/(home)/insights/actions';

const RETRY_MS = 4000;
const MAX_RETRIES = 8;

/**
 * Runs the insights check once when the app is opened (each full page load),
 * like the recurring due check next to it. The server does the work at most
 * once a day, so a second tab or a reload costs one small query and never a
 * second model call. When this load was the one that generated today's
 * insights (or another tab was, and has now finished), the page is refreshed
 * so they appear.
 */
export default function InsightsCheck() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let waited = false;

    const attempt = async (left: number) => {
      const result = await checkInsights().catch(() => null);
      if (cancelled || !result) return;
      if (result.state === 'ran' || (result.state === 'done' && waited)) {
        router.refresh();
      } else if (result.state === 'busy' && left > 0) {
        waited = true;
        timer = setTimeout(() => void attempt(left - 1), RETRY_MS);
      }
    };
    void attempt(MAX_RETRIES);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // Once per app load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
