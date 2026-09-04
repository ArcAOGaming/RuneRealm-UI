/**
 * Baked defaults written by backend/native/deploy-marketplace.mjs.
 * Environment variables win, so preview/staging can point elsewhere without
 * editing source. Blank means "not deployed yet" and the UI explains that
 * state instead of sending a wallet signature to a placeholder id.
 */
export const MARKET_DEFAULTS = {
  amm: '4KcPdg-8hwf7lYDmRR72Kurgfy5k2PM2YNeXiDM_oeU',
  rune: 'xa6UF3wF-Vq57JVa3SQZa9qxhfKrqcwUr577AudWAoI',
  quote: 'X81wLs7gNXAypYlCJe252hWTiBQm0NwL1W61e6fRsEk',
  node: 'https://hyperbeam.tylerw.ai',
} as const;
