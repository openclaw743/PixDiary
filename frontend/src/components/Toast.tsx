/**
 * Tiny toast system.
 *
 * One toast at a time (we don't need a stack for MVP). Auto-dismiss after
 * `durationMs` (default 6s). Toasts may include an optional action button
 * (e.g. "Undo" for a soft-deleted entry).
 *
 * Reduced-motion: per `accessibility.md` "no toast slide". The toast simply
 * fades in via opacity (which the global reduced-motion media query already
 * shortens to ~0ms).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export interface ToastAction {
  label: string;
  onAction: () => void;
}

export interface ToastInput {
  /** Visible message. */
  message: string;
  /** Sets aria-live politeness; default 'polite'. 'assertive' for errors. */
  tone?: 'info' | 'success' | 'error';
  /** Optional action button. */
  action?: ToastAction;
  /** Auto-dismiss delay in ms; default 6000. */
  durationMs?: number;
}

interface ToastState extends ToastInput {
  id: number;
}

interface ToastContextValue {
  show: (toast: ToastInput) => void;
  dismiss: () => void;
  /** Test seam: read the live toast. */
  current: ToastState | null;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const idCounter = useRef(0);
  const timer = useRef<number | null>(null);

  const dismiss = useCallback(() => {
    setToast(null);
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const show = useCallback(
    (input: ToastInput) => {
      idCounter.current += 1;
      const id = idCounter.current;
      const duration = input.durationMs ?? 6000;
      setToast({ id, ...input });
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        setToast((cur) => (cur && cur.id === id ? null : cur));
        timer.current = null;
      }, duration);
    },
    [],
  );

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const value = useMemo<ToastContextValue>(
    () => ({ show, dismiss, current: toast }),
    [show, dismiss, toast],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toast={toast} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastViewport({
  toast,
  onDismiss,
}: {
  toast: ToastState | null;
  onDismiss: () => void;
}) {
  if (!toast) {
    return (
      <div className="sr-only" aria-live="polite" aria-atomic="true" />
    );
  }
  const live = toast.tone === 'error' ? 'assertive' : 'polite';
  const role = toast.tone === 'error' ? 'alert' : 'status';
  return (
    <div
      role={role}
      aria-live={live}
      aria-atomic="true"
      className="pointer-events-none fixed inset-x-0 bottom-6 z-toast flex justify-center px-4"
    >
      <div className="pointer-events-auto flex max-w-md items-center gap-3 rounded-md border border-border-strong bg-surface-card px-4 py-3 shadow-lg">
        <span className="text-sm text-ink-900">{toast.message}</span>
        {toast.action ? (
          <button
            type="button"
            onClick={() => {
              toast.action!.onAction();
              onDismiss();
            }}
            className="text-sm font-semibold text-accent-700 underline"
          >
            {toast.action.label}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss notification"
          className="ml-2 text-ink-500 hover:text-ink-900"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a <ToastProvider>');
  }
  return ctx;
}
