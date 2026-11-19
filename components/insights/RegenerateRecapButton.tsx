'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, RefreshCw } from 'lucide-react';
import { regenerateRecapAction } from '@/app/(home)/insights/actions';
import Button from '@/components/Button';
import { useToast } from '@/components/ToastProvider';

/** Regenerates a recap on demand; the only way a stored recap is rewritten. */
export default function RegenerateRecapButton({ recapKey }: { recapKey: string }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    const result = await regenerateRecapAction(recapKey);
    setBusy(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success(result.wording === 'model' ? 'Recap regenerated' : 'Recap regenerated with plain wording (no model available)');
    router.refresh();
  };

  return (
    <Button variant="secondary" size="sm" onClick={() => void run()} disabled={busy}>
      {busy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />}
      {busy ? 'Regenerating…' : 'Regenerate'}
    </Button>
  );
}
