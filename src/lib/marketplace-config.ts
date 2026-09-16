/**
 * Baked defaults written by backend/native/deploy-marketplace.mjs.
 * Environment variables win, so preview/staging can point elsewhere without
 * editing source. Blank means "not deployed yet" and the UI explains that
 * state instead of sending a wallet signature to a placeholder id.
 */
export const MARKET_DEFAULTS = {
  rune: 'j_0pVrzHiSqenIB24PjanDBbREKhCh03L23stv_7OXc',
  quote: 'I4LT2WtUbe2iTUm48KH96BMMp9lzBHwO9paSEa1l0Iw',
  internalVenue: 'khNdS2oR8kkeK-TAASOTRSuD5Eiwaw5qLhNrZ7itJDE',
  externalVenue: 'Q9E-ONGRPdZy-166rXBQCyPK1YMoyUobqwIRiHFiKNg',
  node: 'https://hyperbeam.tylerw.ai',
} as const;
