'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import Modal from '@/components/Modal';
import Button from '@/components/Button';
import ExpenseForm, { type ExpenseSaveResult, type SubmitIntent } from '@/app/expenses/ExpenseForm';
import { getQuickAddData } from '@/app/expenses/actions';
import { useExpenseSaved } from './useExpenseSaved';

type QuickAddData = NonNullable<Awaited<ReturnType<typeof getQuickAddData>>['data']>;

interface QuickAddContextValue {
  open: () => void;
}

const QuickAddContext = createContext<QuickAddContextValue | undefined>(undefined);

export function useQuickAdd() {
  const ctx = useContext(QuickAddContext);
  if (!ctx) throw new Error('useQuickAdd must be used within QuickAddProvider');
  return ctx;
}

const FORM_ID = 'quick-add-expense-form';

function isTypingTarget(el: EventTarget | null) {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return (
    tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
  );
}

export function QuickAddProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const announceSaved = useExpenseSaved();
  const [isOpen, setIsOpen] = useState(false);
  const [data, setData] = useState<QuickAddData | null>(null);
  const [loadError, setLoadError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Remounts the form for each fresh open so smart defaults are re-read.
  const [formKey, setFormKey] = useState(0);
  const intentRef = useRef<SubmitIntent>('save');
  const loading = useRef(false);

  const load = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    try {
      const result = await getQuickAddData();
      if (result.success && result.data) {
        setData(result.data);
        setLoadError('');
      } else {
        setLoadError(result.error || 'Could not load the form');
      }
    } catch {
      setLoadError('Could not load the form — check your connection');
    } finally {
      loading.current = false;
    }
  }, []);

  // Warm the cache once the page is idle so the first open is instant.
  useEffect(() => {
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(() => void load());
      return () => w.cancelIdleCallback?.(id);
    }
    const t = setTimeout(() => void load(), 1500);
    return () => clearTimeout(t);
  }, [load]);

  const open = useCallback(() => {
    setFormKey((k) => k + 1);
    setIsOpen(true);
    void load(); // refresh categories / accounts / merchants in the background
  }, [load]);

  const close = useCallback(() => setIsOpen(false), []);

  // Desktop shortcut: "N" opens quick-add when you're not typing somewhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat) return;
      if (e.key !== 'n' && e.key !== 'N') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      if (isOpen) return;
      e.preventDefault();
      open();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, open]);

  const handleSuccess = useCallback(
    (result: ExpenseSaveResult) => {
      announceSaved(result);
      if (result.intent !== 'another') setIsOpen(false);
      router.refresh();
    },
    [announceSaved, router]
  );

  return (
    <QuickAddContext.Provider value={{ open }}>
      {children}

      {/* Desktop floating action button */}
      <button
        type="button"
        onClick={open}
        className="hidden lg:flex fixed bottom-6 right-6 z-40 items-center gap-2 pl-4 pr-5 h-12 rounded-full bg-mint text-graphite font-semibold shadow-[0_10px_30px_-8px_var(--mint-glow)] border border-mint/40 hover:bg-mint-bright transition-colors"
        aria-label="Add expense (shortcut N)"
        title="Add expense (N)"
      >
        <Plus size={20} strokeWidth={2.5} />
        <span className="text-sm">Expense</span>
        <kbd className="ml-1 px-1.5 py-0.5 rounded-md bg-graphite/15 text-[11px] font-mono leading-none">
          N
        </kbd>
      </button>

      <Modal
        isOpen={isOpen}
        onClose={close}
        title="Add expense"
        description="Amount, category, save — the rest is optional."
        size="lg"
        footer={
          <div className="flex gap-3">
            {/* Save comes first in the DOM so Enter in a field means plain Save. */}
            <Button
              type="submit"
              form={FORM_ID}
              disabled={isSubmitting || !data}
              onClick={() => {
                intentRef.current = 'save';
              }}
              className="flex-1 order-3"
            >
              {isSubmitting ? 'Saving…' : 'Save'}
            </Button>
            <Button
              type="submit"
              form={FORM_ID}
              variant="secondary"
              disabled={isSubmitting || !data}
              onClick={() => {
                intentRef.current = 'another';
              }}
              className="flex-1 order-2 whitespace-nowrap"
            >
              Save &amp; add another
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={close}
              className="hidden sm:inline-flex order-1"
            >
              Cancel
            </Button>
          </div>
        }
      >
        {data ? (
          <ExpenseForm
            key={formKey}
            categories={data.categories}
            accounts={data.accounts}
            merchants={data.merchants}
            serverAccountByCategory={data.accountByCategory}
            serverLastAccountId={data.lastAccountId}
            onSuccess={handleSuccess}
            onCancel={close}
            hideActions
            onSubmittingChange={setIsSubmitting}
            formId={FORM_ID}
            submitIntentRef={intentRef}
          />
        ) : loadError ? (
          <div className="py-10 text-center space-y-4">
            <p className="text-sm text-danger">{loadError}</p>
            <Button variant="secondary" onClick={() => void load()}>
              Try again
            </Button>
          </div>
        ) : (
          <div className="space-y-5 animate-pulse" aria-busy="true" aria-label="Loading form">
            <div className="h-32 rounded-2xl bg-graphite-surface-2/70" />
            <div className="h-10 rounded-xl bg-graphite-surface-2/70" />
            <div className="h-10 rounded-xl bg-graphite-surface-2/70" />
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-9 w-24 rounded-xl bg-graphite-surface-2/70" />
              ))}
            </div>
          </div>
        )}
      </Modal>
    </QuickAddContext.Provider>
  );
}
