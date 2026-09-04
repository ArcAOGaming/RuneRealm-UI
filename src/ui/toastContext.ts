/**
 * The toast context and its hook, apart from `Toast.tsx`.
 *
 * Same reason as `state/gameContext.ts`: a module that exports a component AND
 * a context object cannot be Fast-Refreshed, so every edit to the provider
 * minted a fresh context and already-refreshed screens read null from it.
 */
import { createContext, useContext } from 'react';

export type ToastCtx = {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
};

export const ToastContext = createContext<ToastCtx | null>(null);

export function useToast(): ToastCtx {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
