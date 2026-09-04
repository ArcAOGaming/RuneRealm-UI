/**
 * Toasts.
 *
 * Every write either succeeds or is refused by a handler, and both need to be
 * visible. The old client dropped handler errors on the floor in several
 * places, which made a refusal indistinguishable from a slow network — you
 * clicked, nothing happened, and there was nothing to go on.
 */
import {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { Check, X, Info } from './icons';
import { type ToastCtx as Ctx, ToastContext } from './toastContext';

type Kind = 'success' | 'error' | 'info';
type Toast = { id: number; kind: Kind; message: string };

const LIFETIME: Record<Kind, number> = {
  success: 3200,
  info: 3600,
  // Errors carry the reason an action was refused, and some of them are long.
  // They stay put long enough to actually be read.
  error: 7000,
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const push = useCallback((kind: Kind, message: string) => {
    const id = nextId.current++;
    setToasts((all) => {
      // Clicking a busy button twice should not stack two identical toasts.
      const deduped = all.filter((t) => !(t.kind === kind && t.message === message));
      return [...deduped, { id, kind, message }].slice(-4);
    });
    setTimeout(() => setToasts((all) => all.filter((t) => t.id !== id)), LIFETIME[kind]);
  }, []);

  const value = useMemo<Ctx>(() => ({
    success: (m) => push('success', m),
    error: (m) => push('error', m),
    info: (m) => push('info', m),
  }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="toast-viewport pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 sm:items-end sm:p-6"
        role="status"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <ToastRow key={t.id} toast={t} onClose={() =>
            setToasts((all) => all.filter((x) => x.id !== t.id))} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastRow({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const tone = {
    success: { ring: 'border-good/40', icon: 'text-good', Icon: Check },
    error: { ring: 'border-bad/45', icon: 'text-bad', Icon: X },
    info: { ring: 'border-edge', icon: 'text-muted', Icon: Info },
  }[toast.kind];

  return (
    <div
      className={
        'pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-[3px] border ' +
        'bg-surface/95 p-3.5 shadow-lift backdrop-blur transition-all duration-200 ' +
        tone.ring + ' ' +
        (shown ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0')
      }
    >
      <tone.Icon className={'mt-0.5 h-4 w-4 shrink-0 ' + tone.icon} />
      <p className="min-w-0 flex-1 text-sm leading-relaxed text-ink/90">{toast.message}</p>
      <button
        onClick={onClose}
        aria-label="Dismiss"
        className="touch-icon-button -m-1 rounded p-1 text-faint transition-colors hover:text-ink"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
