/**
 * The install-prompt context and its hook, apart from `PwaInstall.tsx`.
 *
 * Same reason as `state/gameContext.ts`.
 */
import { createContext, useContext } from 'react';

export type InstallResult = 'accepted' | 'dismissed' | 'ios-help' | 'browser-help' | 'installed';

export type PwaInstallContextValue = {
  installed: boolean;
  installing: boolean;
  promptReady: boolean;
  ios: boolean;
  install: () => Promise<InstallResult>;
};

export const PwaInstallContext = createContext<PwaInstallContextValue | null>(null);

export function usePwaInstall(): PwaInstallContextValue {
  const context = useContext(PwaInstallContext);
  if (!context) throw new Error('usePwaInstall must be used inside <PwaInstallProvider>');
  return context;
}
