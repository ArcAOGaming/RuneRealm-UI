import {
  createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState,
} from 'react';

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

export type InstallResult = 'accepted' | 'dismissed' | 'ios-help' | 'browser-help' | 'installed';

type PwaInstallContextValue = {
  installed: boolean;
  installing: boolean;
  promptReady: boolean;
  ios: boolean;
  install: () => Promise<InstallResult>;
};

const PwaInstallContext = createContext<PwaInstallContextValue | null>(null);

// Browsers may decide that the app is installable before React mounts. Keep
// the one-shot event at module scope so moving the install button into a
// dialog cannot miss it.
let capturedPrompt: InstallPromptEvent | null = null;
const promptListeners = new Set<(prompt: InstallPromptEvent) => void>();

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    // The install action is a production convenience. Capturing the one-shot
    // event during local Vite development only produces Chromium's "banner
    // not shown" warning on every admin reload, while there is no installed
    // dev build worth preserving.
    if (import.meta.env.DEV) return;
    event.preventDefault();
    capturedPrompt = event as InstallPromptEvent;
    promptListeners.forEach((listener) => listener(capturedPrompt!));
  });
}

function isStandalone() {
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true;
}

function isIos() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}

/**
 * Capture the browser's one-shot install event for the lifetime of the app.
 *
 * The wallet dialog is intentionally mounted only while it is open. Listening
 * there loses `beforeinstallprompt` when the browser fires it earlier, which is
 * why the old header button worked on the landing page but a menu-based action
 * could silently do nothing. This provider stays mounted above the game and
 * hands the saved prompt to either the connect or account view.
 */
export function PwaInstallProvider({ children }: { children: ReactNode }) {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(() => capturedPrompt);
  const [installed, setInstalled] = useState(() => isStandalone());
  const [installing, setInstalling] = useState(false);
  const ios = isIos();

  useEffect(() => {
    const onInstalled = () => {
      setInstalled(true);
      capturedPrompt = null;
      setPrompt(null);
    };

    promptListeners.add(setPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      promptListeners.delete(setPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const install = useCallback(async (): Promise<InstallResult> => {
    if (installed) return 'installed';
    if (!prompt) return ios ? 'ios-help' : 'browser-help';

    setInstalling(true);
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      capturedPrompt = null;
      setPrompt(null); // Browser prompts can be used only once.
      if (choice.outcome === 'accepted') setInstalled(true);
      return choice.outcome;
    } finally {
      setInstalling(false);
    }
  }, [installed, ios, prompt]);

  const value = useMemo(() => ({
    installed, installing, promptReady: !!prompt, ios, install,
  }), [installed, installing, prompt, ios, install]);

  return <PwaInstallContext.Provider value={value}>{children}</PwaInstallContext.Provider>;
}

export function usePwaInstall(): PwaInstallContextValue {
  const context = useContext(PwaInstallContext);
  if (!context) throw new Error('usePwaInstall must be used inside <PwaInstallProvider>');
  return context;
}
