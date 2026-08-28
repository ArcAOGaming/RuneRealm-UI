/**
 * Baked defaults written by backend/native/deploy-marketplace.mjs.
 * Environment variables win, so preview/staging can point elsewhere without
 * editing source. Blank means "not deployed yet" and the UI explains that
 * state instead of sending a wallet signature to a placeholder id.
 */
export const MARKET_DEFAULTS = {
  market: '6yI83FzNf5d0HIVVPJutrPUL0-2xrxe_AQfiL8ivr_w',
  amm: '02Db0p0twtp1IpFIDQP62p8yvPD8stpRQquIv-LaQdo',
  rune: 'C4KguU6ixunOuwfCaIeJ9FDj4E0HQmnwPLNdtYnpYiw',
  quote: 'e_iLPZoYleBRvTSFmhyexhHVj3k52cj6M1qhgB2dAyE',
  node: 'https://hyperbeam.tylerw.ai',
  collection: 'FLpgYCuzLQt-wevwCvuTh9oJ89r_geDO3JWjNaXdQKc',
} as const;
