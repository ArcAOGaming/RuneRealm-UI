/** Register the app shell only in a compiled production build. */
export function registerPwa() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js', {
      scope: '/',
      updateViaCache: 'none',
    }).catch(() => {
      // Installation is an enhancement. A browser or host that disallows
      // service workers must never prevent the online game from starting.
    });
  }, { once: true });
}
