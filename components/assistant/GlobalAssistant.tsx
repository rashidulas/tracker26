'use client';

import { useEffect, useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import FinanceAssistant from './FinanceAssistant';

export default function GlobalAssistant() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`fixed z-[45] bottom-[calc(5.75rem+env(safe-area-inset-bottom))] right-4 lg:bottom-6 lg:right-6 flex items-center gap-2 rounded-full bg-mint text-graphite font-semibold pl-3.5 pr-4 py-3 shadow-glow transition-all duration-200 hover:bg-mint-bright active:scale-[0.98] ${
          open ? 'opacity-0 pointer-events-none scale-90' : 'opacity-100'
        }`}
        aria-label="Open finance assistant"
      >
        <span className="relative flex h-6 w-6 items-center justify-center">
          <span className="absolute inset-0 rounded-full bg-graphite/10" />
          <Sparkles size={15} className="relative" />
        </span>
        <span className="text-sm">Ask AI</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center sm:p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/55 backdrop-blur-sm"
            aria-label="Close assistant"
            onClick={() => setOpen(false)}
          />
          <div className="relative w-full sm:max-w-xl max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-2xl border border-graphite-border bg-graphite shadow-panel animate-fade-up">
            <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 border-b border-graphite-border-subtle bg-graphite-surface/95 backdrop-blur-xl">
              <div>
                <p className="text-[11px] font-medium text-mint uppercase tracking-[0.16em]">
                  Global assistant
                </p>
                <p className="text-sm text-ink-secondary">Log money or ask about your finances</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="p-2 rounded-full text-ink-muted hover:text-ink hover:bg-graphite-surface-2"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-3 sm:p-4">
              <FinanceAssistant embedded />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
