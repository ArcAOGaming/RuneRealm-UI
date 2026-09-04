/**
 * Baked defaults written by backend/native/deploy-marketplace.mjs.
 * Environment variables win, so preview/staging can point elsewhere without
 * editing source. Blank means "not deployed yet" and the UI explains that
 * state instead of sending a wallet signature to a placeholder id.
 */
export const MARKET_DEFAULTS = {
  amm: 'Jy1WAEU0C2wdO6NzmHKHyQYXn9fByhRjIGOFEMgaimI',
  rune: 'C9PFoYKFBCesa3EWfsKaEBfbA1ad0q9AzNJDk0QUtZ4',
  quote: 'aGC5GNngFoCt5Ros1269LyEPbJJP7HvzYH-jXt7zhIM',
  node: 'https://hyperbeam.tylerw.ai',
} as const;
