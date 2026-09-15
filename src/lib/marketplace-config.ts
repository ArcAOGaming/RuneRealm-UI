/**
 * Baked defaults written by backend/native/deploy-marketplace.mjs.
 * Environment variables win, so preview/staging can point elsewhere without
 * editing source. Blank means "not deployed yet" and the UI explains that
 * state instead of sending a wallet signature to a placeholder id.
 */
export const MARKET_DEFAULTS = {
  rune: '6YIWne3owSWaeNwlsS1PBtWh6SMS43giJrIQaHGgo0U',
  quote: 'Ddl0QH1Ns3FEiviqiN-AsmhNXkB6OhTXZCJ8t4vZP9I',
  internalVenue: 'eRT6H-WiZTKjGLNnDAdDbx6lIB3_VayavHEABrcwuAo',
  externalVenue: 'g9deoTqVy9Uf7fKDZunf4alfbRh0LXE01uyg1czgrn4',
  node: 'https://hyperbeam.tylerw.ai',
} as const;
