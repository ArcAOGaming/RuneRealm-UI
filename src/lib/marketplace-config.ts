/**
 * Baked defaults written by backend/native/deploy-marketplace.mjs.
 * Environment variables win, so preview/staging can point elsewhere without
 * editing source. Blank means "not deployed yet" and the UI explains that
 * state instead of sending a wallet signature to a placeholder id.
 */
export const MARKET_DEFAULTS = {
  amm: 'vAhjQlZesUAO5Wvhp7lmcFpZC5t6LRrIwGeBRdUBVOc',
  rune: '3c2FKXXdz-gC15K_38W9jdwDCx_eSnpj-tTRCb2IdA0',
  quote: '7rUsU5Hs0EZFik5WQ9wmvHqK3tOaQpW1blKy-Q8OJX4',
  node: 'https://hyperbeam.tylerw.ai',
} as const;
