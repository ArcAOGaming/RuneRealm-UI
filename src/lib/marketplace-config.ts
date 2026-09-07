/**
 * Baked defaults written by backend/native/deploy-marketplace.mjs.
 * Environment variables win, so preview/staging can point elsewhere without
 * editing source. Blank means "not deployed yet" and the UI explains that
 * state instead of sending a wallet signature to a placeholder id.
 */
export const MARKET_DEFAULTS = {
  rune: 'qm6v_m_igHJKvHFLN3YrCveIXwt9mCYmN9GSzfe8UVQ',
  quote: '7igIbzIxOyax3coasMVJV8tuqRIiGRrdoZjoKeQPOp8',
  internalVenue: 'i4X-1aJrTsCdENH12AKMr-lAce3RgNzNoNoDGFkU5Iw',
  externalVenue: '0NEltc1z-wSzNEjpU90wPc23Ingn7F7d1Fi_COFEx6Y',
  node: 'http://localhost:8737',
} as const;
