import { useEffect, useState } from 'react';

/** Wall-clock milliseconds, re-read every `everyMs` while `enabled`. */
export function useClock(everyMs: number, enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(timer);
  }, [enabled, everyMs]);
  return now;
}
