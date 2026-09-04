import type {
  EconomyAssetLedger, EconomyDesk, EconomyFill, EconomyMarketStats, EconomyView, GoldMarketItemId,
} from './types';

const items: GoldMarketItemId[] = [
  'air_berry', 'water_berry', 'fire_berry', 'rock_berry',
  'scroll', 'legendary_scroll', 'rune',
];
const flow = { issued: 12, consumed: 8 };
const ledger = (issued: number, consumed: number, player: number, escrow: number, shop: number): EconomyAssetLedger => ({
  issued, consumed, player, escrow, shop,
  rolling7d: flow, rolling30d: { issued: 48, consumed: 31 },
  sources: { 'Lootbox.Open': 24, 'Admin.Load restoration': issued - 24 },
  sinks: { 'Monster.Feed': consumed },
});
const market = (bid?: number, ask?: number): EconomyMarketStats => ({
  bestBid: bid, bestAsk: ask,
  depth: { bids: bid ? [{ price: bid, quantity: 18 }, { price: bid - 1, quantity: 35 }] : [],
    asks: ask ? [{ price: ask, quantity: 14 }, { price: ask + 1, quantity: 27 }] : [] },
  volume24h: 46, volume7d: 281, median7d: bid && ask ? Math.round((bid + ask) / 2) : undefined,
  median30d: bid && ask ? Math.round((bid + ask) / 2) : undefined,
  medianSamples7d: 31, medianSamples30d: 92, uniqueMakers7d: 17, uniqueTakers7d: 21,
});
const desk = (item: GoldMarketItemId, stock: number, cap: number, reserve: number, bid: number, ask: number): EconomyDesk => ({
  item, stock, stockCap: cap, goldReserve: reserve, anchorBps: 10000,
  band: 2, bid, ask, limits: { perAction: 100, perAccount: 250, global: 500 },
  enabled: { buy: true, sell: true }, pause: {}, projectedExhaustion: Math.floor(reserve / bid),
  traded: { bought: 122, sold: 76, goldIn: 601, goldOut: 493 },
});

export function economyPreview(): EconomyView {
  const assets = {
    air_berry: ledger(7100, 260, 6680, 45, 115),
    water_berry: ledger(7040, 220, 6590, 50, 180),
    fire_berry: ledger(6980, 310, 6460, 70, 140),
    rock_berry: ledger(7150, 280, 6725, 55, 90),
    scroll: ledger(860, 93, 742, 25, 0),
    legendary_scroll: ledger(47, 3, 42, 2, 0),
    rune: ledger(4350, 440, 3565, 95, 250),
  };
  const invariants = Object.fromEntries(items.map((item) => [item, {
    ok: true, expected: assets[item].issued - assets[item].consumed,
    accounted: assets[item].player + assets[item].escrow + assets[item].shop,
    difference: 0,
  }])) as EconomyView['invariants']['assets'];
  return {
    version: 1, mode: 'testing', generatedAt: Date.now(),
    invariants: {
      ok: true, gold: { ok: true, expected: 300000, accounted: 300000, difference: 0 },
      assets: invariants,
      lootboxes: Array.from({ length: 5 }, (_, index) => ({ ok: true, expected: 80 - index * 8, accounted: 80 - index * 8, difference: 0 })),
      rune: { inGame: 3910, outsideTokenSupply: 290, pendingWithdrawals: 12,
        pendingDeposits: 0, economic: 4212, accounted: 4212, difference: 0, observedAt: Date.now() - 60000 },
    },
    gold: { issued: 300000, burned: 1840, outstanding: 298160, authorized: 300000,
      ceiling: 20000000, player: 48220, escrow: 8300, shop: 181640, locked: 60000,
      target: 300000, perQualifiedPlayer: 1000, qualifiedActive: 126,
      candidateQualifiedActive: 141, rolling7d: { issued: 0, consumed: 420 },
      rolling30d: { issued: 0, consumed: 1840 } },
    assets,
    lootboxes: Array.from({ length: 5 }, (_, index) => ({ issued: 240 - index * 18,
      opened: 160 - index * 10, held: 80 - index * 8, rolling7d: flow,
      rolling30d: { issued: 52, consumed: 38 }, sources: { 'Battle.Attack': 80, 'Monster.Claim': 60 } })),
    orders: [
      { id: 'O71', seq: 71, account: 'DA9qhP25ZPz6MHIhO-7aNHDN3LsTAL7yCKYIkqr13Z8', side: 'sell', item: 'fire_berry', price: 8, quantity: 20, remaining: 12, createdAt: Date.now() - 900000, expiresAt: Date.now() + 20 * 86400000 },
      { id: 'O72', seq: 72, account: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', side: 'buy', item: 'fire_berry', price: 6, quantity: 30, remaining: 30, createdAt: Date.now() - 600000, expiresAt: Date.now() + 21 * 86400000 },
    ],
    fills: previewFills(),
    market: {
      air_berry: market(5, 8), water_berry: market(5, 9), fire_berry: market(6, 8),
      rock_berry: market(4, 7), scroll: market(240, 410), legendary_scroll: market(1200, 1750), rune: market(980, 1460),
    },
    desks: {
      air_berry: desk('air_berry', 115, 355, 5200, 4, 9),
      water_berry: desk('water_berry', 180, 352, 4800, 4, 9),
      fire_berry: desk('fire_berry', 140, 349, 5100, 4, 9),
      rock_berry: desk('rock_berry', 90, 358, 4900, 4, 9),
      scroll: { ...desk('scroll', 0, 86, 20000, 225, 500), pause: { buy: 'Reliable Scroll supply unavailable', sell: 'Reliable Scroll supply unavailable' } },
      rune: desk('rune', 250, 250, 200000, 650, 1250),
    },
    rejected: { 'Self-trading is not allowed': 4, 'Global 20-hour quantity limit reached': 2 },
    policy: {
      emergency: { paused: false, at: 0 },
      gold: { targetFloor: 300000, expansionEnabled: false },
      qualification: { enabled: false, reason: 'Open launch decision', requiredDistinctDays: 3, requiredSinkActions: 1 },
      runeRewards: { enabled: false, epochBudget: 0, reserveBalance: 75, reason: 'Open launch decision' },
      proceeds: { teamBps: 5000, runeBps: 3000, treasuryBps: 2000 },
      amm: { maxSlippageBps: 100, maxWeeklyPoolBps: 500 },
      runeAcquisition: { budgetQuote: 7500, quoteSpent: 2200, runeReceived: 19, executions: [] },
      passes: { genesisSealed: false, genesisPassCount: 168, lifetimePassCount: 168,
        legacyCount: 168, promisedCount: 0, unassignedPromiseSlots: 0,
        promiseClaimDeadline: 0, purchaseEnabled: false, foregoneRuneAcquisitionReference: 0 },
      externalRuneSupply: 290, externalRuneObservedAt: Date.now() - 60000,
      pending: {}, history: [],
    },
    passQuote: { referenceUnit: 'USD cents until an on-chain payment asset is selected',
      launch: 2500, growth: 2500, security: 2400, next: 2500,
      genesisPassCount: 168, lifetimePassCount: 168, purchaseEnabled: false },
  };
}

/**
 * A week of plausible fills, so the trading floor's charts have something to
 * draw in `?economy-preview`. A random walk seeded off the index rather than
 * `Math.random`, because a preview that redraws differently every render is
 * useless for judging the chart.
 */
function previewFills(): EconomyFill[] {
  const day = 86_400_000;
  const now = Date.now();
  const seeds: Array<[GoldMarketItemId, number]> = [
    ['fire_berry', 7], ['water_berry', 6], ['air_berry', 6], ['rock_berry', 5],
    ['scroll', 320], ['rune', 1180],
  ];
  const rows: EconomyFill[] = [];
  let id = 0;
  for (const [item, base] of seeds) {
    let price = base;
    for (let step = 0; step < 26; step += 1) {
      // Deterministic wobble: a sine pair with coprime periods reads as noise.
      const drift = Math.sin(step * 0.7 + base) * 0.06 + Math.sin(step * 1.9) * 0.035;
      price = Math.max(1, Math.round(price * (1 + drift)));
      id += 1;
      rows.push({
        id: `F${id}`, item, buyOrder: `O${id}`, sellOrder: `O${id + 500}`,
        buyer: 'DA9qhP25ZPz6MHIhO-7aNHDN3LsTAL7yCKYIkqr13Z8',
        seller: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
        maker: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
        taker: 'DA9qhP25ZPz6MHIhO-7aNHDN3LsTAL7yCKYIkqr13Z8',
        price, quantity: 1 + (step % 4), gross: price * (1 + (step % 4)),
        fee: Math.max(1, Math.round(price * 0.02)),
        filledAt: now - (7 * day) + (step * (7 * day)) / 26,
      });
    }
  }
  return rows;
}
