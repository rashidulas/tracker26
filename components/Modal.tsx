'use client';

import { ReactNode, useEffect, useRef } from 'react';
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

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-md animate-fade-up"
        onClick={onClose}
      />
      <div
        ref={modalRef}
        className={`relative bg-graphite-surface border border-white/[0.07] rounded-t-3xl sm:rounded-3xl shadow-[0_24px_80px_-20px_rgba(0,0,0,0.75)] w-full ${sizeClasses[size]} max-h-[94vh] sm:max-h-[88vh] flex flex-col animate-fade-up overflow-hidden`}
      >
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-mint/40 to-transparent" />
        <div className="sm:hidden flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-white/15" />
        </div>
        <div className="flex items-start justify-between gap-3 px-5 pt-3 pb-4 sm:px-6 sm:pt-5 sm:pb-4 border-b border-graphite-border-subtle flex-shrink-0">
          <div className="min-w-0">
            <h2 className="text-lg sm:text-xl font-semibold text-ink font-display tracking-tight">
              {title}
            </h2>
            {description && (
              <p className="text-sm text-ink-muted mt-1 leading-relaxed">{description}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-ink-muted hover:text-ink transition-colors p-2 rounded-xl hover:bg-graphite-surface-2 flex-shrink-0 -mr-1"
            aria-label="Close modal"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-6 sm:py-6">{children}</div>
        {footer && (
          <div className="flex-shrink-0 px-5 py-4 sm:px-6 sm:py-4 border-t border-graphite-border-subtle bg-graphite-elevated/80 backdrop-blur-sm">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
