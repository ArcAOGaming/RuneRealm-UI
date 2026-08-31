/**
 * Baked defaults written by backend/native/deploy-marketplace.mjs.
 * Environment variables win, so preview/staging can point elsewhere without
 * editing source. Blank means "not deployed yet" and the UI explains that
 * state instead of sending a wallet signature to a placeholder id.
 */
export const MARKET_DEFAULTS = {
  amm: '6e-BMF4NON7ZPi4ZUZs9cZ6idoTem3_bsCkIvJEkIcM',
  rune: 'KZSbMhEEzMvu0TnGXSh9u8lHNexqYw00lljmYLqhZ3A',
  quote: 'neqJJmAwsq9jkaUEhEYNOKp8wTNbpoHQxN-q9mBi50E',
  node: 'https://hyperbeam.tylerw.ai',
} as const;
