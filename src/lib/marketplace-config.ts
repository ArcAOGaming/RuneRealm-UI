/**
 * Baked defaults written by backend/native/deploy-marketplace.mjs.
 * Environment variables win, so preview/staging can point elsewhere without
 * editing source. Blank means "not deployed yet" and the UI explains that
 * state instead of sending a wallet signature to a placeholder id.
 */
export const MARKET_DEFAULTS = {
  rune: 'rf3eq7qbOOopkt0PH-V6wqiZCbHHH3VG0v_BV2dDkhU',
  quote: '5mxFE3bAy1PpOEeC8DQuHi93NNzyl09vlFAZ6-Pv64Y',
  internalVenue: 'jzyrU-DDcW-EsePcv_obVDen88yjQDUNZJPAHwsbEe8',
  externalVenue: '3vY3m_0T3Pe5tEDDrGKsWvzridRm1uh8Ua0JS59p8HM',
  node: 'https://hyperbeam.tylerw.ai',
} as const;
