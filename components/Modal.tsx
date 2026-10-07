'use client';

import { ReactNode, useEffect, useRef } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

const sizeClasses = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
};

export default function Modal({ isOpen, onClose, title, children, size = 'md' }: ModalProps) {
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
      <div
        className="absolute inset-0 bg-black/65 backdrop-blur-sm animate-fade-up"
        onClick={onClose}
      />
      <div
        ref={modalRef}
        className={`relative bg-graphite-surface border border-graphite-border rounded-2xl shadow-panel w-full ${sizeClasses[size]} max-h-[92vh] sm:max-h-[85vh] flex flex-col animate-fade-up`}
      >
        <div className="flex items-center justify-between px-4 py-3.5 sm:px-6 sm:py-4 border-b border-graphite-border-subtle flex-shrink-0">
          <h2 className="text-base sm:text-lg font-semibold text-ink font-display truncate pr-2">
            {title}
          </h2>
          <button
            onClick={onClose}
            className="text-ink-muted hover:text-ink transition-colors p-1.5 rounded-lg hover:bg-graphite-surface-2 flex-shrink-0"
            aria-label="Close modal"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">{children}</div>
      </div>
    </div>
  );
}
