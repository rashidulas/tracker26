'use client';

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  ReactNode,
} from 'react';
import { X, CheckCircle, XCircle, AlertCircle, Info } from 'lucide-react';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastOptions {
  duration?: number;
  action?: ToastAction;
}

interface Toast {
  id: string;
  type: ToastType;
  message: string;
  action?: ToastAction;
}

type ActionResult = { success: boolean; error?: string } | void;

interface DeferredOptions {
  /** Message shown while the action is pending, e.g. "Account deleted". */
  message: string;
  /** Runs when the toast times out or is dismissed without Undo. */
  commit: () => Promise<ActionResult>;
  /** Runs when the user presses Undo — restore the UI here. */
  onUndo: () => void;
  /** Runs after a successful commit. */
  onCommitted?: () => void;
  /** Runs after a failed commit (an error toast is shown automatically). */
  onFailed?: (error: string) => void;
  /** Fallback error message when commit fails without one. */
  errorMessage?: string;
  duration?: number;
}

interface ToastContextType {
  showToast: (type: ToastType, message: string, durationOrOptions?: number | ToastOptions) => string;
  dismiss: (id: string) => void;
  success: (message: string, durationOrOptions?: number | ToastOptions) => string;
  error: (message: string, durationOrOptions?: number | ToastOptions) => string;
  warning: (message: string, durationOrOptions?: number | ToastOptions) => string;
  info: (message: string, durationOrOptions?: number | ToastOptions) => string;
  /**
   * Hide-now, commit-later pattern: the caller removes the item from the UI,
   * this shows an Undo toast, and only runs `commit` once the toast expires.
   */
  deferred: (options: DeferredOptions) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return context;
}

const UNDO_DURATION = 5000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  // Deferred commits keyed by toast id; run on timeout / close / page unload.
  const pending = useRef(new Map<string, () => void>());

  const removeToast = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback(
    (type: ToastType, message: string, durationOrOptions?: number | ToastOptions) => {
      const opts: ToastOptions =
        typeof durationOrOptions === 'number'
          ? { duration: durationOrOptions }
          : durationOrOptions || {};
      const duration = opts.duration ?? (opts.action ? UNDO_DURATION : 3000);
      const id = Math.random().toString(36).slice(2, 10);

      setToasts((prev) => [...prev.slice(-3), { id, type, message, action: opts.action }]);

      if (duration > 0) {
        timers.current.set(
          id,
          setTimeout(() => {
            const run = pending.current.get(id);
            pending.current.delete(id);
            removeToast(id);
            run?.();
          }, duration)
        );
      }
      return id;
    },
    [removeToast]
  );

  const success = useCallback(
    (message: string, o?: number | ToastOptions) => showToast('success', message, o),
    [showToast]
  );
  const error = useCallback(
    (message: string, o?: number | ToastOptions) => showToast('error', message, o ?? 5000),
    [showToast]
  );
  const warning = useCallback(
    (message: string, o?: number | ToastOptions) => showToast('warning', message, o),
    [showToast]
  );
  const info = useCallback(
    (message: string, o?: number | ToastOptions) => showToast('info', message, o),
    [showToast]
  );

  const deferred = useCallback(
    ({
      message,
      commit,
      onUndo,
      onCommitted,
      onFailed,
      errorMessage = 'Something went wrong',
      duration = UNDO_DURATION,
    }: DeferredOptions) => {
      let settled = false;
      const run = async () => {
        if (settled) return;
        settled = true;
        try {
          const result = await commit();
          if (result && !result.success) {
            const msg = result.error || errorMessage;
            showToast('error', msg, 6000);
            onFailed?.(msg);
            return;
          }
          onCommitted?.();
        } catch {
          showToast('error', errorMessage, 6000);
          onFailed?.(errorMessage);
        }
      };

      const id = showToast('info', message, {
        duration,
        action: {
          label: 'Undo',
          onClick: () => {
            if (settled) return;
            settled = true;
            pending.current.delete(id);
            onUndo();
          },
        },
      });
      pending.current.set(id, () => void run());
    },
    [showToast]
  );

  // Closing a toast (X) commits its pending action immediately.
  const closeToast = useCallback(
    (id: string) => {
      const run = pending.current.get(id);
      pending.current.delete(id);
      removeToast(id);
      run?.();
    },
    [removeToast]
  );

  const runAction = useCallback(
    (toast: Toast) => {
      pending.current.delete(toast.id);
      removeToast(toast.id);
      toast.action?.onClick();
    },
    [removeToast]
  );

  // Best effort: don't silently drop pending deletes if the tab is closed.
  useEffect(() => {
    const flush = () => {
      pending.current.forEach((run) => run());
      pending.current.clear();
    };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, []);

  return (
    <ToastContext.Provider
      value={{ showToast, dismiss: closeToast, success, error, warning, info, deferred }}
    >
      {children}
      <ToastContainer toasts={toasts} onClose={closeToast} onAction={runAction} />
    </ToastContext.Provider>
  );
}

function ToastContainer({
  toasts,
  onClose,
  onAction,
}: {
  toasts: Toast[];
  onClose: (id: string) => void;
  onAction: (toast: Toast) => void;
}) {
  return (
    // Bottom of the screen (above the mobile tab bar), never over the header.
    // Errors and warnings go in an assertive region; everything else is polite.
    <div className="fixed z-[80] inset-x-0 bottom-[calc(6.25rem+env(safe-area-inset-bottom))] lg:bottom-6 lg:left-64 px-4 flex flex-col items-center gap-2 pointer-events-none">
      <div role="alert" aria-live="assertive" className="w-full flex flex-col items-center gap-2">
        {toasts
          .filter((t) => t.type === 'error' || t.type === 'warning')
          .map((toast) => (
            <ToastItem key={toast.id} toast={toast} onClose={onClose} onAction={onAction} />
          ))}
      </div>
      <div role="status" aria-live="polite" className="w-full flex flex-col items-center gap-2">
        {toasts
          .filter((t) => t.type !== 'error' && t.type !== 'warning')
          .map((toast) => (
            <ToastItem key={toast.id} toast={toast} onClose={onClose} onAction={onAction} />
          ))}
      </div>
    </div>
  );
}

function ToastItem({
  toast,
  onClose,
  onAction,
}: {
  toast: Toast;
  onClose: (id: string) => void;
  onAction: (toast: Toast) => void;
}) {
  const icons = {
    success: <CheckCircle className="w-5 h-5" />,
    error: <XCircle className="w-5 h-5" />,
    warning: <AlertCircle className="w-5 h-5" />,
    info: <Info className="w-5 h-5" />,
  };

  const iconColor = {
    success: 'text-mint',
    error: 'text-danger',
    warning: 'text-warning',
    info: 'text-info',
  };

  const border = {
    success: 'border-mint/25',
    error: 'border-danger/30',
    warning: 'border-warning/25',
    info: 'border-graphite-border',
  };

  return (
    <div
      className={`pointer-events-auto w-full max-w-sm flex items-center gap-3 pl-4 pr-2 py-2.5 rounded-2xl border bg-graphite-elevated/95 text-ink shadow-panel backdrop-blur-xl animate-fade-up ${border[toast.type]}`}
    >
      <div className={`flex-shrink-0 ${iconColor[toast.type]}`} aria-hidden="true">{icons[toast.type]}</div>
      <p className="flex-1 text-sm font-medium py-1">{toast.message}</p>
      {toast.action && (
        <button
          type="button"
          onClick={() => onAction(toast)}
          className="flex-shrink-0 min-h-[44px] px-3 rounded-xl text-sm font-semibold text-mint hover:bg-mint-dim transition-colors"
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={() => onClose(toast.id)}
        className="flex-shrink-0 w-11 h-11 -my-1 inline-flex items-center justify-center rounded-lg text-ink-muted hover:text-ink transition-colors"
        aria-label="Dismiss notification"
      >
        <X className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  );
}
