/**
 * Baked defaults written by backend/native/deploy-marketplace.mjs.
 * Environment variables win, so preview/staging can point elsewhere without
 * editing source. Blank means "not deployed yet" and the UI explains that
 * state instead of sending a wallet signature to a placeholder id.
 */
export const MARKET_DEFAULTS = {
  rune: 'lOW-gbK2i6SHyWgkeS0q7cog5cN3J2Vfr76Jc1Z_60A',
  quote: 'quRPySI5_B0ZduY4d_p8ozc2iZ0SYqQiUQZyGF5bmp0',
  internalVenue: 'h-tIieBB0euTMLtnpYj9A5O4eFIN4x4a2POgd7y24ys',
  externalVenue: 'aNtH8d-SWgTBzx1wL4krKgzL9V8aJ_NDkVIMpbSyzls',
  node: 'https://hyperbeam.tylerw.ai',
} as const;
