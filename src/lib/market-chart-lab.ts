/**
 * Deterministic, client-only market fixtures for the Chart Lab.
 *
 * This is intentionally not a mock of the network client and never names a
 * process. It supplies the exact public shapes the real floor renders so the
 * chart, ladder and tape can be judged without waiting for a thin live market
 * to happen to produce a useful pattern.
 */
import type { EconomyCandle, EconomyMarketStats, GoldMarketItemId } from './types';
import type { VenueTrade } from './venue';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export interface ChartLabPoint {
  t: number;
  v: number;
  q: number;
}

export interface ChartLabMarket {
  id: string;
  label: string;
  item: GoldMarketItemId;
  book: EconomyMarketStats;
  candles: EconomyCandle[];
  points: ChartLabPoint[];
  trades: VenueTrade[];
}

type Profile = 'trend' | 'gaps' | 'volatile' | 'doji';

const PROFILES: Array<{
  id: string;
  label: string;
  item: GoldMarketItemId;
  profile: Profile;
}> = [
  { id: 'lab-trend', label: 'Dense trend · Rune / Gold', item: 'rune', profile: 'trend' },
  { id: 'lab-gaps', label: 'Thin + gaps · Water Berry / Gold', item: 'water_berry', profile: 'gaps' },
  { id: 'lab-volatile', label: 'Volatile · Fire Berry / Gold', item: 'fire_berry', profile: 'volatile' },
  { id: 'lab-doji', label: 'Flat + doji · Rock Berry / Gold', item: 'rock_berry', profile: 'doji' },
];

/** A dense recent tape plus progressively coarser history out to thirty days. */
function sampleTimes(now: number): number[] {
  const times = new Set<number>();
  for (let age = 0; age <= 3 * HOUR; age += 30_000) times.add(now - age);
  for (let age = 0; age <= DAY; age += 5 * MINUTE) times.add(now - age);
  for (let age = 0; age <= 30 * DAY; age += 6 * HOUR) times.add(now - age);
  return [...times].sort((a, b) => a - b);
}

function omitted(profile: Profile, age: number): boolean {
  if (profile !== 'gaps') return false;
  return (age > 52 * MINUTE && age < 94 * MINUTE)
    || (age > 5 * HOUR && age < 8 * HOUR)
    || (age > 4 * DAY && age < 6 * DAY)
    || (age > 13 * DAY && age < 15 * DAY);
}

/** Stable signed noise in [-1, 1], keyed by a time bucket and profile seed. */
function noise(bucket: number, seed: number): number {
  let value = (bucket + Math.imul(seed, 0x9e3779b9)) | 0;
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  value ^= value >>> 16;
  return ((value >>> 0) / 0xffffffff) * 2 - 1;
}

const DOJI_WICK = [0, 1, 3, 1, -1, -3, -1, 2, 1, 0];

/**
 * A slow market regime plus faster prints inside it.
 *
 * The first fixture used only long sine waves. Across one five-minute bar
 * those waves were nearly monotonic, so high/low landed on open/close and
 * every candle was a wickless block. The 5-minute bucket noise moves whole
 * bars; the 30-second noise moves prints inside them, producing honest wicks.
 */
function priceAt(profile: Profile, age: number, time: number, seed: number): number {
  const minute = age / MINUTE;
  const fiveMinuteBucket = Math.floor(time / (5 * MINUTE));
  const thirtySecondBucket = Math.floor(time / 30_000);
  const barNoise = noise(fiveMinuteBucket, seed + 17);
  const printNoise = noise(thirtySecondBucket, seed + 41);
  switch (profile) {
    case 'trend':
      return Math.max(8, Math.round(62 + (30 * DAY - age) / DAY * 1.35
        + Math.sin(minute / 17) * 4 + Math.sin(minute / 83) * 7
        + barNoise * 2.5 + printNoise * 3.5));
    case 'gaps': {
      const regime = age < 52 * MINUTE ? 112 : age < 5 * HOUR ? 82 : age < 13 * DAY ? 96 : 70;
      return Math.max(8, Math.round(regime + Math.sin(minute / 11) * 5
        + Math.sin(minute / 37) * 3 + barNoise * 3 + printNoise * 4));
    }
    case 'volatile':
      return Math.max(8, Math.round(105 + Math.sin(minute / 2.7) * 24
        + Math.sin(minute / 13) * 18 + Math.sin(minute / 61) * 12
        + barNoise * 8 + printNoise * 9));
    case 'doji': {
      /* Each five-minute bar opens and closes on zero but trades above and
         below it in between: a real doji body with visible upper/lower wicks. */
      const slot = ((thirtySecondBucket % DOJI_WICK.length) + DOJI_WICK.length)
        % DOJI_WICK.length;
      const plateau = 80 + (Math.floor(fiveMinuteBucket / 6) % 7 === 0 ? 1 : 0)
        - (Math.floor(fiveMinuteBucket / 11) % 9 === 0 ? 1 : 0);
      return plateau + DOJI_WICK[slot];
    }
  }
}

function quantityAt(time: number, seed: number): number {
  const bucket = Math.floor(time / 30_000);
  const ordinary = 1 + Math.floor((noise(bucket, seed + 73) + 1) * 3.5);
  const burst = bucket % (17 + seed) === 0 ? 12 + seed * 2 : 0;
  return ordinary + burst;
}

function dailyCandles(points: ChartLabPoint[]): EconomyCandle[] {
  const byDay = new Map<number, EconomyCandle>();
  for (const point of points) {
    const day = Math.floor(point.t / DAY);
    const row = byDay.get(day);
    if (!row) {
      byDay.set(day, {
        d: day, o: point.v, h: point.v, l: point.v, c: point.v,
        v: point.q, g: point.v * point.q, n: 1,
      });
    } else {
      row.h = Math.max(row.h, point.v);
      row.l = Math.min(row.l, point.v);
      row.c = point.v;
      row.v += point.q;
      row.g += point.v * point.q;
      row.n += 1;
    }
  }
  return [...byDay.values()].sort((a, b) => a.d - b.d);
}

function median(values: number[]): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function depth(last: number, side: 'bid' | 'ask') {
  return Array.from({ length: 7 }, (_, index) => {
    const distance = index + 1;
    return {
      price: Math.max(1, last + (side === 'bid' ? -distance * 2 : distance * 2)),
      quantity: 10 + distance * distance * 3,
      orders: 1 + (index % 4),
    };
  });
}

function buildMarket(now: number, definition: typeof PROFILES[number], seed: number): ChartLabMarket {
  const points = sampleTimes(now)
    .filter((time) => !omitted(definition.profile, now - time))
    .map((time) => ({
      t: time,
      v: priceAt(definition.profile, now - time, time, seed),
      q: quantityAt(time, seed),
    }));
  const candles = dailyCandles(points);
  const last = points.at(-1)?.v ?? 80;
  const bids = depth(last, 'bid');
  const asks = depth(last, 'ask');
  const lastDay = points.filter((point) => point.t >= now - DAY);
  const lastWeek = points.filter((point) => point.t >= now - 7 * DAY);
  const weekCloses = candles.filter((row) => row.d >= Math.floor((now - 7 * DAY) / DAY)).map((row) => row.c);
  const monthCloses = candles.map((row) => row.c);
  const book: EconomyMarketStats = {
    bestBid: bids[0].price,
    bestAsk: asks[0].price,
    p2pBid: bids[0].price,
    p2pAsk: asks[0].price,
    houseBidUnits: 0,
    houseAskUnits: 0,
    band: { low: Math.max(1, Math.floor(last * .45)), high: Math.ceil(last * 1.55), bps: 5000 },
    depth: { bids, asks },
    volume24h: lastDay.reduce((sum, point) => sum + point.q, 0),
    volume7d: lastWeek.reduce((sum, point) => sum + point.q, 0),
    median7d: median(weekCloses),
    median30d: median(monthCloses),
    medianSamples7d: weekCloses.length,
    medianSamples30d: monthCloses.length,
    uniqueMakers7d: 18 + seed * 3,
    uniqueTakers7d: 24 + seed * 4,
  };
  const trades = points.slice(-96).map((point, index) => [
    Math.floor(point.t / 1000), point.v, point.q,
    Math.sin(point.t / 47_111 + seed + index) >= 0 ? 1 : 0,
  ] as VenueTrade);
  return { ...definition, book, candles, points, trades };
}

/** Stable for a supplied clock; callers round the clock before passing it. */
export function buildChartLab(now: number): ChartLabMarket[] {
  return PROFILES.map((definition, index) => buildMarket(now, definition, index + 1));
}
