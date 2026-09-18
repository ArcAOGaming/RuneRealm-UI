/**
 * Client for both Rune Realm custody venues.
 *
 * The internal and external deployments run the same `venue.lua` contract and
 * expose the same order verbs. Only custody differs: game assets enter through
 * `Venue.Send`; tokens enter through `Transfer` and its Credit-Notice.
 */
import { isVault, ShardedVenue, type ShardedTransport } from '@runerealm/orderbook/sharded';
import { readJSON, send } from './hyperbeam';
import graph from './graph.json';
import { Reply } from './types';
import { activeAddress } from './wallet';

const ID = /^[A-Za-z0-9_-]{43}$/;

export const INTERNAL_VENUE_PROCESS = graph.processes.internalVenue;
export const EXTERNAL_VENUE_PROCESS = graph.processes.externalVenue;
export const VENUE_NODE = graph.venueNode || graph.marketNode || undefined;

export const internalVenueConfigured = () => ID.test(INTERNAL_VENUE_PROCESS);
export const externalVenueConfigured = () => ID.test(EXTERNAL_VENUE_PROCESS);
export const venuesConfigured = () => internalVenueConfigured() && externalVenueConfigured();

export type VenueSide = 'buy' | 'sell';
export type VenueTif = 'GTC' | 'IOC' | 'FOK' | 'PostOnly';
export type VenueStp = 'CancelResting' | 'Reject' | 'CancelBoth';

export interface VenueOrder {
  id: string;
  market: string;
  item: string;
  side: VenueSide;
  price: number;
  quantity: number;
  remaining: number;
  lot: number;
  createdAt: number;
  expiresAt: number;
}

export interface VenueFill {
  id: string;
  market: string;
  item: string;
  price: number;
  quantity: number;
  fee: number;
  buyer: string;
  seller: string;
  takerSide: VenueSide;
  filledAt: number;
}

export interface VenuePosition {
  account: string;
  free: Record<string, string>;
  orders: VenueOrder[];
  fills: VenueFill[];
}

export interface VenueLevel {
  price: number;
  quantity: number;
  orders: number;
  house?: boolean;
}

export interface VenueMarketBook {
  id: string;
  base: string;
  quote: string;
  status: string;
  tick: number;
  lot: number;
  bestBid?: number;
  bestAsk?: number;
  depth: { bids: VenueLevel[]; asks: VenueLevel[] };
  /** The corridor an order must be priced inside, or absent while unpriced. */
  band?: { low: number; high: number; bps: number };
  candles?: VenueCandle[];
}

/** One published daily OHLCV row; `d` is the UTC epoch-day number. */
export interface VenueCandle {
  d: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  g: number;
  n: number;
}

export type VenueBook = Record<string, VenueMarketBook>;

/**
 * One public trade, as four numbers: `[at, price, quantity, takerBought]`.
 *
 * The tuple order is the contract with `tapeView` in `backend/native/orderbook.lua`
 * and is asserted on the raw published text in `venue_test.lua`. It is
 * positional because the names would be 15 of the 40 bytes and there are
 * ninety-six rows, and every byte of published state is marshalled five times
 * on every message the venue ever receives.
 *
 * `at` is SECONDS, not the millisecond `filledAt` the private ring carries.
 * `takerBought` is 1 when the buy side took and 0 when the sell side did.
 */
export type VenueTrade = [at: number, price: number, quantity: number, takerBought: number];

/** The tape, grouped by market id. Bounded venue-wide, newest last. */
export type VenueTape = Record<string, VenueTrade[]>;

/**
 * One durable intraday OHLCV row published by `venue.lua`.
 *
 * The bucket timestamp is in seconds and the remaining values are integer
 * atomic units. Tuples keep the hot published key compact: each venue retains
 * three hours of one-minute bars and one day of five-minute bars per market.
 */
export type VenueIntradayCandle = [
  bucketStart: number,
  open: number,
  high: number,
  low: number,
  close: number,
  baseVolume: number,
  quoteVolume: number,
  fillCount: number,
];

export type VenueIntradayCandles = Record<string, {
  '60'?: VenueIntradayCandle[];
  '300'?: VenueIntradayCandle[];
}>;

interface VenueBookHistoryState {
  fills?: Array<Partial<VenueFill> & { filledAt?: number; taker?: string; maker?: string }>;
}

export interface VenueInfo {
  Name: string;
  Mode: 'internal' | 'external' | '';
  Sealed: boolean;
  GameProcess?: string;
  Paused: boolean;
  WithdrawalsOpen: boolean;
  Assets: Record<string, { id: string; name: string; kind: string; process?: string }>;
  Markets: Record<string, { id: string; base: string; quote: string; status: string }>;
}

function unwrap<T>(reply: Reply<T>): T {
  if (reply && typeof reply === 'object' && 'error' in reply && reply.error) {
    throw new Error(String(reply.error));
  }
  return reply as T;
}

function requireProcess(process: string): string {
  if (!ID.test(process)) throw new Error('This Rune Realm venue has not been deployed yet.');
  return process;
}

const readVenueJSON = <T>(process: string, key: string) =>
  readJSON<T>(key, { process: requireProcess(process), node: VENUE_NODE });

/**
 * A graph entry that names a VAULT is the sharded venue (one process per
 * market; rune-orderbook ORDERBOOK.md §16). Every function below hands it to
 * rune-orderbook's router, which reads across the pairs and turns an order
 * whose funds are elsewhere into one signed batch. The shim only delegates.
 */
const shardTransport: ShardedTransport = {
  read: <T>(process: string, key: string) => readJSON<T>(key, { process, node: VENUE_NODE }),
  send: <T>(process: string, tags: Array<{ name: string; value: string }>,
    options?: { requiredOutbox?: boolean }) =>
    send<T>(tags, { process, node: VENUE_NODE, requiredOutbox: options?.requiredOutbox }),
};
const shards = new Map<string, Promise<ShardedVenue | null>>();
function shard(process: string): Promise<ShardedVenue | null> {
  let found = shards.get(process);
  if (!found) {
    found = isVault(shardTransport, requireProcess(process))
      .then((vault) => (vault ? new ShardedVenue(shardTransport, process) : null));
    shards.set(process, found);
  }
  return found;
}
async function signer(): Promise<string> {
  const address = await activeAddress();
  if (!address || !ID.test(address)) throw new Error('Connect a wallet first.');
  return address;
}

interface VenuePairPublication {
  id: string;
  base: string;
  quote: string;
  book: string;
  candles: string;
  tape: string;
}

/** Prefer 5.3b pair keys; absence of the index identifies a legacy venue. */
async function readVenuePairs<T>(
  process: string,
  field: 'book' | 'candles' | 'tape',
): Promise<Record<string, T> | null> {
  let index: Record<string, VenuePairPublication> | null;
  try {
    index = await readVenueJSON<Record<string, VenuePairPublication>>(process, 'venuepairs');
  } catch {
    return null;
  }
  if (!index || Array.isArray(index) || typeof index !== 'object') return null;
  const out: Record<string, T> = {};
  await Promise.all(Object.entries(index).map(async ([id, pair]) => {
    if (!pair || typeof pair[field] !== 'string') return;
    try {
      const value = await readVenueJSON<T>(process, pair[field]);
      if (value !== null) out[id] = value;
    } catch { /* A newly configured pair has no projection until its first write. */ }
  }));
  return out;
}

export const readVenueInfo = async (process: string): Promise<VenueInfo | null> => {
  const s = await shard(process);
  return s ? s.info() : readVenueJSON<VenueInfo>(process, 'venueinfo');
};
export const readVenueBook = async (process: string): Promise<VenueBook | null> => {
  const s = await shard(process);
  if (s) return s.book<VenueMarketBook>();
  return (await readVenuePairs<VenueMarketBook>(process, 'book'))
    ?? readVenueJSON<VenueBook>(process, 'venuebook');
};

/**
 * The public trade tape.
 *
 * A separate key from `venuebook` because it is a separate answer, and reads
 * are free: published state costs a GET, not a slot. Read on the same timer as
 * the book.
 *
 * A venue that has never traded publishes `{}` — `venue.lua` wraps it in
 * `jsonObject` for exactly that reason — but a venue deployed before this key
 * existed publishes nothing at all, and the node answers an absent key with
 * its own HTML landing page at status 200. `readJSON` rejects that; the caller
 * treats a rejection as an empty tape rather than an error, because a book
 * with no tape is still a book.
 */
export const readVenueTape = async (process: string): Promise<VenueTape | null> => {
  const s = await shard(process);
  if (s) return s.tape<VenueTrade[]>();
  return (await readVenuePairs<VenueTrade[]>(process, 'tape'))
    ?? readVenueJSON<VenueTape>(process, 'venuetape');
};
export const readVenueCandles = async (process: string): Promise<VenueIntradayCandles | null> => {
  const s = await shard(process);
  if (s) return s.candles<VenueIntradayCandles[string]>();
  return (await readVenuePairs<VenueIntradayCandles[string]>(process, 'candles'))
    ?? readVenueJSON<VenueIntradayCandles>(process, 'venuecandles');
};

/** Read one interval defensively; older deployments simply return no rows. */
export function marketVenueCandles(
  candles: VenueIntradayCandles | null,
  marketId: string | undefined,
  interval: 60 | 300,
): VenueIntradayCandle[] {
  if (!candles || !marketId || Array.isArray(candles)) return [];
  const rows = candles[marketId]?.[interval === 60 ? '60' : '300'];
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((row): row is VenueIntradayCandle => Array.isArray(row) && row.length >= 8)
    .map((row) => row.slice(0, 8).map(Number) as VenueIntradayCandle)
    .filter(([at, open, high, low, close, baseVolume, quoteVolume, count]) =>
      [at, open, high, low, close, baseVolume, quoteVolume, count]
        .every((value) => Number.isFinite(value))
      && at > 0 && open > 0 && high > 0 && low > 0 && close > 0
      && baseVolume >= 0 && quoteVolume >= 0 && count > 0)
    .sort((a, b) => a[0] - b[0]);
}

/**
 * Backfill the chart from the venue's already-published restore state.
 *
 * `venuetape` is intentionally only 96 rows venue-wide. At the internal test
 * target that is barely two minutes across seven pairs, even though the venue
 * still retains 500 fills in `venuebookstate` so it can restore its median and
 * account histories after a cold slot. Reading that existing key adds no
 * contract bytes or write work. The browser immediately projects it to the
 * same address-free four-number tuples and never exposes its account fields.
 */
export async function readVenueHistoryTape(process: string): Promise<VenueTape> {
  const s = await shard(process);
  const fills = s ? await s.historyFills() as VenueBookHistoryState['fills']
    : (await readVenueJSON<VenueBookHistoryState>(process, 'venuebookstate'))?.fills;
  const out: VenueTape = {};
  for (const fill of Array.isArray(fills) ? fills : []) {
    const market = typeof fill.market === 'string' && fill.market
      ? fill.market : typeof fill.item === 'string' ? `${fill.item}/gold` : '';
    const at = Math.floor(Number(fill.filledAt ?? 0) / 1000);
    const price = Number(fill.price ?? 0);
    const quantity = Number(fill.quantity ?? 0);
    const takerSide = fill.takerSide === 'buy' || fill.takerSide === 'sell'
      ? fill.takerSide
      : fill.taker && fill.buyer && fill.taker === fill.buyer ? 'buy' : 'sell';
    if (!market || !(at > 0) || !(price > 0) || !(quantity > 0)) continue;
    (out[market] ??= []).push([at, price, quantity, takerSide === 'buy' ? 1 : 0]);
  }
  return out;
}

/** Join a durable backfill to the moving public tail without double prints. */
export function mergeVenueTapes(...tapes: Array<VenueTape | null | undefined>): VenueTape {
  const out: VenueTape = {};
  const covered = new Map<string, number>();
  for (const tape of tapes) {
    if (!tape || Array.isArray(tape)) continue;
    const occurrences = new Map<string, number>();
    for (const [market, rows] of Object.entries(tape)) {
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        if (!Array.isArray(row) || row.length < 4) continue;
        const normalized = row.map(Number) as VenueTrade;
        const key = `${market}:${normalized.join(':')}`;
        const occurrence = (occurrences.get(key) ?? 0) + 1;
        occurrences.set(key, occurrence);
        /* Equal fills in the same second are still separate fills. Skip only
           the N occurrences the earlier source already supplied, not every
           row with the same public tuple. */
        if (occurrence <= (covered.get(key) ?? 0)) continue;
        (out[market] ??= []).push(normalized);
      }
    }
    for (const [key, count] of occurrences) {
      covered.set(key, Math.max(covered.get(key) ?? 0, count));
    }
  }
  for (const rows of Object.values(out)) rows.sort((a, b) => a[0] - b[0]);
  return out;
}

/** The tape for one market, oldest first, tolerant of every absent shape. */
export function marketTrades(tape: VenueTape | null, marketId: string | undefined): VenueTrade[] {
  if (!tape || !marketId || Array.isArray(tape)) return [];
  const rows = tape[marketId];
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((row): row is VenueTrade => Array.isArray(row) && row.length >= 4)
    .map((row) => [Number(row[0]), Number(row[1]), Number(row[2]), Number(row[3])] as VenueTrade)
    .filter((row) => row.every((value) => Number.isFinite(value)) && row[0] > 0)
    .sort((a, b) => a[0] - b[0]);
}

/**
 * The market registry: fees, tick, lot, the minimum and the band width.
 *
 * Separate from `venuebook` because none of it moves. The book is re-read on a
 * timer; this is read once, and a client that assumes a fee rather than
 * reading it here is describing a rule the process may not have.
 *
 * `creationCost` IS published now — the flat quote charged for putting an order
 * on the book, on top of the notional and any taker fee. Both Rune Realm venues
 * are deployed with it at zero, which is exactly why it has to be read rather
 * than assumed: the first venue deployed with a non-zero cost would otherwise
 * quote a ticket the process refuses.
 */
export interface VenueMarketConfig {
  id: string; base: string; quote: string;
  tick: number; lot: number; minValue: number;
  maxPrice: number; maxQuantity: number;
  takerBps: number; bandBps: number; creationCost: number; status: string;
}

/**
 * A venue deployed before `creationCost` was published does not send the key,
 * so it is defaulted to 0 here — the same tolerance `readVenuePosition` gives
 * the older free-only balance shape. Zero is the truthful default: it is what
 * every venue in existence charges, and the alternative (leaving it undefined)
 * would put `NaN` through the order ticket's arithmetic.
 */
export const readVenueMarkets = async (process: string) => {
  const s = await shard(process);
  const rows = s ? await s.markets()
    : await readVenueJSON<Record<string, VenueMarketConfig>>(process, 'markets');
  if (!rows || typeof rows !== 'object') return rows;
  const out: Record<string, VenueMarketConfig> = {};
  for (const [id, row] of Object.entries(rows)) {
    out[id] = { ...row, creationCost: Number(row?.creationCost ?? 0) || 0 };
  }
  return out;
};

/** A new venue publishes the full bounded account view; accept its old free-only shape too. */
export async function readVenuePosition(process: string, address: string): Promise<VenuePosition> {
  if (!ID.test(address)) return { account: address, free: {}, orders: [], fills: [] };
  const s = await shard(process);
  if (s) return s.position(address);
  const value = await readVenueJSON<VenuePosition | Record<string, string>>(
    process, `balance-${address}`,
  );
  if (value && 'free' in value) {
    const position = value as VenuePosition;
    return { account: position.account || address, free: position.free ?? {},
      orders: position.orders ?? [], fills: position.fills ?? [] };
  }
  return { account: address, free: (value as Record<string, string> | null) ?? {},
    orders: [], fills: [] };
}

let actionSeq = 0;
const actionId = (kind: string) =>
  `${kind}-${Date.now().toString(36)}-${(++actionSeq).toString(36)}`;

async function write<T>(process: string, tags: Record<string, string>, requiredOutbox = false) {
  return unwrap<T>(await send<Reply<T>>(
    Object.entries(tags).map(([name, value]) => ({ name, value })),
    { process: requireProcess(process), node: VENUE_NODE, requiredOutbox },
  ));
}

export interface VenueOrderOptions {
  tif?: VenueTif;
  stp?: VenueStp;
  expiresIn?: number;
}

const orderTags = (options: VenueOrderOptions = {}) => ({
  ...(options.tif ? { Tif: options.tif } : {}),
  ...(options.stp ? { Stp: options.stp } : {}),
  ...(options.expiresIn ? { ExpiresIn: String(Math.floor(options.expiresIn)) } : {}),
});

type PlaceReply = { order: { order?: VenueOrder; fills?: VenueFill[]; open?: boolean };
  account: VenuePosition };
export const placeVenueOrder = async (
  process: string, side: VenueSide, item: string, price: string | number,
  quantity: string | number, options: VenueOrderOptions = {},
): Promise<PlaceReply> => {
  const s = await shard(process);
  if (s) return s.place<PlaceReply>(await signer(), side, item, price, quantity, options);
  return write<PlaceReply>(process, {
    Action: 'Order.Place', Side: side, Item: item, Price: String(price),
    Quantity: String(quantity), ActionId: actionId('venue-order'), ...orderTags(options),
  });
};

type AmendReply = { order: unknown; account: VenuePosition };
export const amendVenueOrder = async (
  process: string, orderId: string,
  changes: { price?: string | number; quantity?: string | number },
  options: VenueOrderOptions = {},
): Promise<AmendReply> => {
  const s = await shard(process);
  if (s) return s.amend<AmendReply>(orderId, changes, options, await signer());
  return write<AmendReply>(process, {
    Action: 'Order.Amend', OrderId: orderId, ActionId: actionId('venue-amend'),
    ...(changes.price !== undefined ? { Price: String(changes.price) } : {}),
    ...(changes.quantity !== undefined ? { Quantity: String(changes.quantity) } : {}),
    ...orderTags(options),
  });
};

type CancelReply = { cancelled: VenueOrder; account: VenuePosition };
export const cancelVenueOrder = async (process: string, orderId: string) => {
  const s = await shard(process);
  if (s) return s.cancel<CancelReply>(orderId, await signer());
  return write<CancelReply>(process, {
    Action: 'Order.Cancel', OrderId: orderId, ActionId: actionId('venue-cancel'),
  });
};

type CancelAllReply = { cancelled: { cancelledIds?: string[] }; account: VenuePosition };
export const cancelAllVenueOrders = async (process: string, item?: string) => {
  const s = await shard(process);
  if (s) {
    return s.cancelAll<CancelAllReply>(await signer(), item);
  }
  return write<CancelAllReply>(process, {
    Action: 'Order.CancelAll', ActionId: actionId('venue-cancelall'),
    ...(item ? { Item: item } : {}),
  });
};

export const maintainVenueOrders = async (process: string, limit = 25) => {
  const s = await shard(process);
  if (s) return s.maintain<{ expired: number }>(limit);
  return write<{ expired: number }>(process, {
    Action: 'Order.Maintain', Limit: String(Math.max(1, Math.floor(limit))),
  });
};

type WithdrawReply = { withdrawal: { id: string; status: string }; account: VenuePosition };
export const withdrawFromVenue = async (
  process: string, asset: string, quantity: string | number,
): Promise<WithdrawReply> => {
  const s = await shard(process);
  if (s) return s.withdraw<WithdrawReply>(await signer(), asset, quantity);
  return write<WithdrawReply>(process, {
    Action: 'Withdraw', Asset: asset, Quantity: String(quantity),
  }, true);
};

/** Token custody enters the external venue through the token's own Transfer outbox. */
export const depositTokenToVenue = (
  tokenProcess: string, venueProcess: string, quantity: string | number,
) => write<{ Balance?: string; Reference?: string }>(tokenProcess, {
  Action: 'Transfer', Recipient: requireProcess(venueProcess), Quantity: String(quantity),
}, true);
