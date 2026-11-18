'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { runDueCheck } from '@/app/plan/recurring/actions';
import { useToast } from '@/components/ToastProvider';

/**
 * Runs the recurring due check once when the app is opened (each full page
 * load). Posting is idempotent on the server, so a second tab or a reload
 * never posts the same occurrence twice.
 */
export default function DueCheck() {
  const router = useRouter();
  const toast = useToast();

  useEffect(() => {
    let cancelled = false;
    void runDueCheck().then((result) => {
      if (cancelled || !result) return;
      if (result.posted > 0) {
        toast.success(
          `Posted ${result.posted} recurring ${result.posted === 1 ? 'entry' : 'entries'}`
        );
        router.refresh();
      }
      if (result.errors.length > 0) {
        const first = result.errors[0];
        toast.error(`Could not post “${first.name}”: ${first.error}`, 8000);
      }
    });
    return () => {
      cancelled = true;
    };
    // Once per app load.
  }, []);

  return null;
}
