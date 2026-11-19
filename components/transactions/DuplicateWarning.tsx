'use client';

/**
 * "Looks like a duplicate of ..." before a new transaction is saved.
 *
 * A form calls guard.check(probe) at the top of its submit. If a likely
 * duplicate exists the form stops and shows <DuplicateWarning>; "Save anyway"
 * calls guard.confirm() and submits again. The check can never block a save:
 * if it fails or takes too long, check() answers "go ahead".
 */
import { useCallback, useRef, useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import Button from '@/components/Button';
import { checkDuplicate } from '@/app/assist/actions';
import type { DuplicateMatch, DuplicateProbe } from '@/lib/duplicates';
import { dayLabel } from '@/lib/transactionList';
import { formatCurrency } from '@/lib/utils';

const CHECK_TIMEOUT_MS = 2500;

export function useDuplicateGuard() {
  const [match, setMatch] = useState<DuplicateMatch | null>(null);
  const confirmed = useRef(false);

  /** True: save. False: a possible duplicate is now shown; wait for the user. */
  const check = useCallback(async (probe: DuplicateProbe): Promise<boolean> => {
    if (confirmed.current) return true;
    let found: DuplicateMatch | null = null;
    try {
      found = await Promise.race([
        checkDuplicate(probe),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), CHECK_TIMEOUT_MS)),
      ]);
    } catch {
      found = null;
    }
    setMatch(found);
    return found === null;
  }, []);

  /** The user chose "Save anyway": the next check passes. */
  const confirm = useCallback(() => {
    confirmed.current = true;
    setMatch(null);
  }, []);

  /** After a save, or when the entry changed: check afresh next time. */
  const reset = useCallback(() => {
    confirmed.current = false;
    setMatch(null);
  }, []);

  return { match, check, confirm, reset };
}

export function describeDuplicate(match: DuplicateMatch): string {
  const what =
    match.merchant || match.category || (match.kind === 'TRANSFER' ? 'a transfer' : match.kind === 'INCOME' ? 'income' : 'an expense');
  const parts = [what, formatCurrency(match.amount), dayLabel(match.date)];
  if (match.account) parts.push(match.account);
  return parts.join(' · ');
}

export function DuplicateWarning({
  match,
  onSaveAnyway,
  onCancel,
  busy,
}: {
  match: DuplicateMatch | null;
  onSaveAnyway: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  if (!match) return null;
  return (
    <div
      role="alert"
      data-duplicate-warning
      className="rounded-2xl border border-warning/30 bg-warning-dim px-4 py-3"
    >
      <div className="flex items-start gap-2.5">
        <TriangleAlert size={18} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink">Looks like a duplicate of</p>
          <p className="mt-0.5 text-sm text-ink-secondary break-words">{describeDuplicate(match)}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={onSaveAnyway} disabled={busy}>
              Save anyway
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={onCancel} disabled={busy}>
              Don’t save
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
