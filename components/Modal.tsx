'use client';

import { ReactNode, useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

const sizeClasses = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
};

const FOCUSABLE = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function getFocusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute('inert') && el.getClientRects().length > 0
  );
}

export default function Modal({
  isOpen,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: ModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();
  const descriptionId = useId();

  // Remember what had focus at the moment the modal opens. This must happen
  // during render: children with autoFocus grab focus in the commit phase,
  // before any effect runs.
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  if (isOpen && !wasOpenRef.current && typeof document !== 'undefined') {
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
  }
  wasOpenRef.current = isOpen;

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Lock scroll, trap focus and restore focus. Depends only on isOpen so that
  // parents passing an inline onClose don't cause focus to jump on re-render.
  useEffect(() => {
    if (!isOpen) return;

    const previouslyFocused = restoreFocusRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const dialog = modalRef.current;
    if (dialog) {
      // A child with autoFocus has already taken focus; otherwise prefer the
      // first visible form field in the body, then any focusable control.
      if (!dialog.contains(document.activeElement)) {
        const focusable = getFocusable(dialog);
        const firstField = focusable.find(
          (el) => el.closest('[data-modal-body]') && el.matches('input, select, textarea')
        );
        const firstBodyControl = focusable.find((el) => el.closest('[data-modal-body]'));
        (firstField ?? firstBodyControl ?? focusable[0] ?? dialog).focus();
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      const node = modalRef.current;
      if (!node) return;
      // Only the top-most dialog handles keys when modals are stacked.
      const dialogs = document.querySelectorAll('[data-modal-dialog]');
      if (dialogs[dialogs.length - 1] !== node) return;

      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }

      if (e.key !== 'Tab') return;
      const focusable = getFocusable(node);
      if (focusable.length === 0) {
        e.preventDefault();
        node.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (e.shiftKey && (active === first || !node.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !node.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-md animate-fade-up"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        data-modal-dialog
        className={`relative bg-graphite-surface border border-white/[0.07] rounded-t-3xl sm:rounded-3xl shadow-[0_24px_80px_-20px_rgba(0,0,0,0.75)] w-full ${sizeClasses[size]} max-h-[94vh] sm:max-h-[88vh] flex flex-col animate-fade-up overflow-hidden focus:outline-none`}
      >
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-mint/40 to-transparent" />
        <div className="sm:hidden flex justify-center pt-3 pb-1" aria-hidden="true">
          <div className="w-10 h-1 rounded-full bg-white/15" />
        </div>
        <div className="flex items-start justify-between gap-3 px-5 pt-3 pb-4 sm:px-6 sm:pt-5 sm:pb-4 border-b border-graphite-border-subtle flex-shrink-0">
          <div className="min-w-0">
            <h2
              id={titleId}
              className="text-lg sm:text-xl font-semibold text-ink font-display tracking-tight"
            >
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="text-sm text-ink-muted mt-1 leading-relaxed">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-ink-muted hover:text-ink transition-colors w-11 h-11 inline-flex items-center justify-center rounded-xl hover:bg-graphite-surface-2 flex-shrink-0 -mr-2 -mt-1"
            aria-label={`Close ${title}`}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div data-modal-body className="flex-1 overflow-y-auto px-5 py-5 sm:px-6 sm:py-6">
          {children}
        </div>
        {footer && (
          <div className="flex-shrink-0 px-5 py-4 sm:px-6 sm:py-4 border-t border-graphite-border-subtle bg-graphite-elevated/80 backdrop-blur-sm">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
