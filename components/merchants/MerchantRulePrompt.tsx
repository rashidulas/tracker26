'use client';

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Store, X } from 'lucide-react';
import Button from '@/components/Button';
import { useToast } from '@/components/ToastProvider';
import { applyCategoryToPast, setMerchantCategoryDefault } from '@/app/settings/merchants/actions';

export type MerchantRuleOffer = {
  merchantId?: string | null;
  merchantName: string;
  categoryId: string;
  subcategoryId?: string | null;
  /** Shown in the question, e.g. "🛒 Groceries". */
  categoryLabel: string;
};

type Step =
  | { kind: 'ask'; offer: MerchantRuleOffer }
  | {
      kind: 'past';
      offer: MerchantRuleOffer;
      merchantId: string;
      merchantName: string;
      subcategoryId: string | null;
      count: number;
    };

const Ctx = createContext<{ offer: (o: MerchantRuleOffer) => void } | null>(null);

/**
 * Offer to remember a category for a merchant:
 *   1. "Always use Groceries for Walmart?"  → saves the merchant default
 *   2. "Also change 12 past Walmart transactions?" → updates history
 * Nothing changes unless the user says yes at each step.
 */
export function useMerchantRulePrompt() {
  const ctx = useContext(Ctx);
  // Outside the provider (tests, isolated renders) offering is a no-op.
  return ctx ?? { offer: () => {} };
}

export function MerchantRuleProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const toast = useToast();
  const [step, setStep] = useState<Step | null>(null);
  const [busy, setBusy] = useState(false);
  const titleId = useId();
  const cardRef = useRef<HTMLDivElement>(null);

  const offer = useCallback((o: MerchantRuleOffer) => {
    if (!o.merchantName.trim() || !o.categoryId) return;
    setStep({ kind: 'ask', offer: o });
  }, []);

  useEffect(() => {
    if (!step) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) setStep(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, busy]);

  const accept = async () => {
    if (!step || step.kind !== 'ask') return;
    setBusy(true);
    const result = await setMerchantCategoryDefault({
      merchantId: step.offer.merchantId,
      name: step.offer.merchantName,
      categoryId: step.offer.categoryId,
      subcategoryId: step.offer.subcategoryId ?? null,
    });
    setBusy(false);
    if (!result.success) {
      toast.error(result.error);
      setStep(null);
      return;
    }
    if (result.pastToUpdate > 0) {
      setStep({
        kind: 'past',
        offer: step.offer,
        merchantId: result.merchantId,
        merchantName: result.merchantName,
        subcategoryId: result.subcategoryId,
        count: result.pastToUpdate,
      });
    } else {
      toast.success(`${result.merchantName} will now default to ${step.offer.categoryLabel}`);
      setStep(null);
    }
  };

  const applyPast = async () => {
    if (!step || step.kind !== 'past') return;
    setBusy(true);
    const result = await applyCategoryToPast(step.merchantId, step.offer.categoryId, step.subcategoryId);
    setBusy(false);
    setStep(null);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success(
      `Updated ${result.updated} past ${step.merchantName} transaction${result.updated === 1 ? '' : 's'}`
    );
    router.refresh();
  };

  const decline = () => {
    if (step?.kind === 'past') {
      toast.success(`${step.merchantName} will default to ${step.offer.categoryLabel} from now on`);
    }
    setStep(null);
  };

  useEffect(() => {
    if (step) requestAnimationFrame(() => cardRef.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true }));
  }, [step]);

  return (
    <Ctx.Provider value={{ offer }}>
      {children}
      {step && (
        <div
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          ref={cardRef}
          className="fixed z-[80] left-3 right-3 sm:left-auto sm:right-6 sm:w-[380px] bottom-[calc(6rem+env(safe-area-inset-bottom))] lg:bottom-24 panel shadow-panel p-4 animate-fade-up"
        >
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-mint-dim border border-mint/20 flex items-center justify-center shrink-0">
              <Store size={15} className="text-mint" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <p id={titleId} className="text-sm text-ink">
                {step.kind === 'ask' ? (
                  <>
                    Always use <strong>{step.offer.categoryLabel}</strong> for{' '}
                    <strong>{step.offer.merchantName}</strong>?
                  </>
                ) : (
                  <>
                    Also change {step.count} past <strong>{step.merchantName}</strong> transaction
                    {step.count === 1 ? '' : 's'} to <strong>{step.offer.categoryLabel}</strong>?
                  </>
                )}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={() => void (step.kind === 'ask' ? accept() : applyPast())}
                  disabled={busy}
                >
                  {busy ? 'Saving…' : step.kind === 'ask' ? 'Always use it' : `Update ${step.count}`}
                </Button>
                <Button size="sm" variant="ghost" onClick={decline} disabled={busy}>
                  {step.kind === 'ask' ? 'Not now' : 'Only new ones'}
                </Button>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setStep(null)}
              disabled={busy}
              aria-label="Close"
              className="p-1 -m-1 rounded-lg text-ink-muted hover:text-ink"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}
