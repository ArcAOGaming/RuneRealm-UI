import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { OrderbookTerminal, type OrderbookHost } from '@runerealm/orderbook/ui';
import '@runerealm/orderbook/style.css';

import { useGame } from '../state/gameContext';
import { isAbort } from '../state/usePoll';
import * as game from '../lib/game';
import { send as sendAo } from '../lib/hyperbeam';
import {
  EXTERNAL_VENUE_PROCESS, INTERNAL_VENUE_PROCESS, VenueBook, VenueMarketBook,
  VenueTrade, internalVenueConfigured, readVenueBook,
} from '../lib/venue';
import {
  EconomyCandle, EconomyDesk, EconomyMarketStats, EconomyOrder, EconomyView, Element,
  GoldMarketItemId, GoldOrderSide, GoldOrderTif, Listing, Monster, PlayerFill, Sale,
} from '../lib/types';
import { ELEMENT_LABEL, ITEM_NAME, formatInteger, shortAddress } from '../lib/format';
import {
  Badge, Button, Empty, ErrorNote, Panel, Skeleton, TransactionHold, cx,
} from '../ui/primitives';
import { Dialog } from '../ui/Dialog';
import { CardPreview } from '../ui/CardPreview';
import { CardViewer } from '../ui/CardViewer';
import { ITEM_ART } from '../ui/art';
import { useTourSteps, type TourStep } from '../ui/tourContext';
import { Arrow, ELEMENT_ICON, Refresh, Rune, Sparkle, Wallet } from '../ui/icons';
import { MarketVenue, MarketVenuePicker, usePopover, venueFromSearch } from '../ui/marketVenues';
import { MarketDiorama } from '../ui/MarketDiorama';
import type { MarketDioramaStockItem } from '../gfx/marketDiorama';
import { economyPreview } from '../lib/economy-preview';
import { buildChartLab } from '../lib/market-chart-lab';

type MonsterSort = 'recent' | 'price-low' | 'price-high' | 'level' | 'attack' | 'defense';

const ELEMENTS: Element[] = ['fire', 'water', 'air', 'rock'];
const inputClass = 'h-11 w-full rounded-[3px] border border-edge bg-void/35 px-3 ' +
  'font-mono text-sm text-ink outline-none placeholder:text-faint focus:border-element/60';

/**
 * The market's walkthrough.
 *
 * Four sentences, and each one is about a rule rather than a control: which
 * counter you are standing at, that both books are the same instrument and
 * hold their own custody, who the counterparty is, and what the ticket will
 * and will not send. Those are the things that cost somebody gold when they
 * are not known.
 *
 * **It states the custody boundary, fee and corridor.** If those move, this
 * list is part of that change — see the note at the head of
 * `ui/Tour.tsx` and the walkthrough rule in `CLAUDE.md`.
 */
const MARKET_TOUR: TourStep[] = [
  {
    /* The header tab on desktop, the screen's own picker on a phone. Both
       carry the same five rows; whichever is on screen is the one pointed at.
       See `findTarget` in `ui/Tour.tsx`. */
    target: '[data-tour-to="/market"], .market-venue-trigger',
    title: 'Five counters, one list',
    body: 'Market opens onto five counters. The shop sells at a price the realm sets and cannot be haggled with. The internal book is players trading goods for Gold. The external book is that same instrument on real tokens in your wallet. Chart Lab uses clearly marked synthetic markets to exercise every chart state without a wallet or contract. Monsters is companions changing hands.',
  },
  {
    target: '[data-tour="market-book"]',
    title: 'Two books, one shape',
    body: 'Both live books and Chart Lab draw the same chart, ladder, tape and ticket, so what you learn on one carries to the others. Chart Lab is synthetic and never signs. The live books are the same instrument: resting bids and asks, matched by price then time. Only their funding differs — game goods and Gold internally, wallet tokens externally. Recent trades under the ladder are the venue’s most recent, everybody’s and not just yours; a colour there is the side that took, not the way the price moved. A live venue holds what it matches, so deposit the asset you mean to spend before you quote it. Neither live book has a pool behind it, so nothing fills until someone is on the other side.',
  },
  {
    target: '[data-tour="market-desks"]',
    title: 'The shop is a different counterparty',
    body: 'The shop fills immediately from finite realm stock and reserves. Both live books fill only against player orders: the internal venue holds deposited game goods and Gold, while the external venue holds deposited wallet tokens. Internal trading is free; the external taker pays 0.30%, and makers pay nothing. Chart Lab only previews those mechanics with local fixtures.',
  },
  {
    target: '[data-tour="market-ticket"]',
    title: 'Read the trade ticket',
    body: 'Limit trades at your price or better and rests any remainder; Market takes what the ladder has now and cancels the rest; Fill all now does the whole size immediately or nothing; Maker-only refuses to cross. Market and Fill all never go in unpriced — the limit shown is the worst price the sweep needs. The published band rejects a fat-finger price once the market has a reference. Move re-prices a quote in one message, Cancel frees its escrow immediately, and Withdraw returns only the balance no live order is holding.',
  },
];

/**
 * The market screen.
 *
 * Which counter you are at is in the URL and nowhere else, because the control
 * that sets it is in the header next to Arena — see `ui/marketVenues.tsx`.
 * Below `lg` there is no header nav to hang it off, so the screen carries the
 * same picker itself and hides it above.
 */
export default function Marketplace() {
  useTourSteps('market', MARKET_TOUR);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const venue = venueFromSearch(params.toString());
  const setVenue = (next: MarketVenue) =>
    navigate(next === 'shop' ? '/market' : `/market?venue=${next}`, { replace: true });

  return (
    <div className="market-screen animate-rise space-y-4">
      <MarketVenuePicker venue={venue} onVenue={setVenue} className="lg:hidden" />

      <div role="tabpanel" className="market-tabpanel">
        {venue === 'shop'
          ? <GoodsMarket onOpenFloor={(order) =>
              navigate(`/market?${prefillSearch(order)}`, { replace: true })} />
          : venue === 'internal' ? <VenueFloor mode="internal" prefill={readPrefill(params)} />
          : venue === 'external' ? <VenueFloor mode="external" />
          : venue === 'lab' ? <ChartLab />
          : <MonsterMarket />}
      </div>
    </div>
  );
}

// Gold goods market ---------------------------------------------------------

/**
 * Two desks, one at a time.
 *
 * The Goods tab holds a shop and a market, and they are not the same kind of
 * thing: one sells to you at a price the realm sets and cannot be haggled
 * with, the other is players bidding against each other. Stacked down one
 * scrolling page they read as one screen with two halves, and players treated
 * the second like the first. So they are a chooser — the same gesture as the
 * tab bar above it — and whichever is chosen gets the whole viewport, which is
 * also what lets the shop show every good and the floor every chart without
 * anybody scrolling for them.
 *
 * `legendary_scroll` is deliberately absent: nothing mints one, it has no art,
 * and it has no NPC desk. The type still carries it because the process still
 * publishes a ledger row under that id.
 */
const GOLD_ITEMS: GoldMarketItemId[] = [
  'fire_berry', 'water_berry', 'air_berry', 'rock_berry', 'scroll', 'rune',
];
const VENUE_GAME_ASSETS: GoldMarketItemId[] = [...GOLD_ITEMS, 'legendary_scroll'];

/** Which element tints a good. Scroll and Rune keep the page's own colour. */
const ITEM_ELEMENT: Partial<Record<GoldMarketItemId, Element>> = {
  fire_berry: 'fire', water_berry: 'water', air_berry: 'air', rock_berry: 'rock',
};

/**
 * An order carried from one counter to another.
 *
 * The shop's comparison row names a good, a side, a size and the resting quote
 * it is beating; clicking it should hand the floor exactly that, priced to
 * cross. It travels in the URL rather than in a context because the venue is
 * already in the URL -- so the whole thing survives a reload and a shared
 * link, and there is one place that says which counter you are standing at.
 */
interface FloorPrefill {
  item: GoldMarketItemId;
  side: GoldOrderSide;
  count: number;
  price?: number;
}

/** The same four values coming back off the URL, or nothing if they are not all there. */
function readPrefill(params: URLSearchParams): FloorPrefill | undefined {
  const item = params.get('item');
  const side = params.get('side');
  if (!item || (side !== 'buy' && side !== 'sell')) return undefined;
  const count = Math.floor(Number(params.get('qty') ?? '0'));
  const price = Math.floor(Number(params.get('price') ?? '0'));
  return {
    item: item as GoldMarketItemId, side,
    count: Number.isSafeInteger(count) && count > 0 ? count : 1,
    price: Number.isSafeInteger(price) && price > 0 ? price : undefined,
  };
}

const prefillSearch = (order: FloorPrefill) => new URLSearchParams({
  venue: 'internal', item: order.item, side: order.side,
  qty: String(Math.max(1, Math.floor(order.count))),
  ...(order.price ? { price: String(order.price) } : {}),
}).toString();

/**
 * How a price in one market is written down, and read back.
 *
 * The two venues run the SAME `venue.lua`, so every number the floor does
 * arithmetic on -- a price, a notional, a band edge -- is an integer in quote
 * units on both. The only thing that differs is how many of those units make
 * one of the thing a human calls a price: one, on a Gold market; a million, on
 * a market quoted in a six-decimal token. That difference belongs in four
 * functions, not in a second copy of the screen.
 */
interface FloorUnit {
  /** The quote asset's name, as it goes in prose. */
  quote: string;
  /** The same name where it is a unit chip under a number. */
  quoteShort: string;
  /** Integer quote units to display text. */
  format: (value: number) => string;
  /** Display text to integer quote units; NaN when the text is not a price. */
  parse: (text: string) => number;
  /** Integer quote units back into something the price field can be seeded with. */
  edit: (value: number) => string;
  placeholder: string;
}

/** Gold is the unit. Nothing to scale, and a fraction of one does not exist. */
const GOLD_UNIT: FloorUnit = {
  quote: 'Gold', quoteShort: 'gold',
  format: (value) => formatInteger(value),
  parse: (text) => Math.floor(Number(text)),
  edit: (value) => String(value),
  placeholder: '0',
};

type FloorRange = '30m' | '1h' | '3h' | '12h' | '24h' | '7d' | '30d';
type ChartMode = 'line' | 'candles';
type CandleInterval = '30s' | '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d';

const RANGE_MS: Record<FloorRange, number> = {
  '30m': 30 * 60_000, '1h': 3600_000, '3h': 3 * 3600_000,
  '12h': 12 * 3600_000, '24h': 24 * 3600_000,
  '7d': 7 * 24 * 3600_000, '30d': 30 * 24 * 3600_000,
};

const CANDLE_MS: Record<CandleInterval, number> = {
  '30s': 30_000, '1m': 60_000, '5m': 5 * 60_000,
  '15m': 15 * 60_000, '30m': 30 * 60_000, '1h': 3600_000,
  '4h': 4 * 3600_000, '1d': 24 * 3600_000,
};

/**
 * A desk with nothing wrong with it publishes `pause` as an empty Lua table,
 * which arrives as `[]`. Reading `.buy` off that is undefined rather than a
 * crash, but the array is a real shape and the guard says so.
 */
function pausedFor(desk: EconomyDesk | undefined, side: GoldOrderSide): string | undefined {
  if (!desk || Array.isArray(desk.pause)) return undefined;
  return desk.pause?.[side] || undefined;
}

function shopPauseCopy(reason: string): string {
  if (reason === 'Policy-epoch supply-flow limit reached') {
    return 'The realm desk reached its 7-day supply-flow cap. Player exchange orders are still open.';
  }
  return reason;
}

function GoodsMarket({ onOpenFloor }: { onOpenFloor: (order: FloorPrefill) => void }) {
  const {
    address, player, connect, connecting, run, isPending, writePhase, refresh,
  } = useGame();
  const [economy, setEconomy] = useState<EconomyView | null>(null);
  /* The shop's "player exchange" column, read from the venue the button
     actually navigates to. It used to come off `economy.market`, which is
     `game.lua`'s own ladder -- a different book with different prices, so the
     comparison could say the floor was better and then show another number
     when you got there. */
  const [venueBook, setVenueBook] = useState<VenueBook | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [item, setItem] = useState<GoldMarketItemId>('fire_berry');
  const [side, setSide] = useState<GoldOrderSide>('buy');
  /* One quantity for the whole shop, not one per item and side. It is the size
     of the trade the player is setting up; changing which berry they are
     looking at, or which way they are trading, is not them changing their mind
     about how many. Only the stepper and the field move it. */
  const [count, setCount] = useState(5);

  const load = useCallback(async (signal?: AbortSignal) => {
    setError(null);
    try {
      if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('economy-preview')) {
        setEconomy(economyPreview()); return;
      }
      const [view, book] = await Promise.all([
        game.readEconomy({ signal }),
        internalVenueConfigured()
          ? readVenueBook(INTERNAL_VENUE_PROCESS).catch(() => null)
          : Promise.resolve(null),
      ]);
      if (signal?.aborted) return;
      setEconomy(view);
      setVenueBook(book);
    }
    catch (caught) {
      if (isAbort(caught)) return;
      setError(caught); setEconomy(null);
    }
  }, []);
  // Tied to the screen: leaving the desk must not leave a read holding one of
  // the browser's six connections to the node for the rest of the session.
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const shopTrade = async (id: GoldMarketItemId, tradeSide: GoldOrderSide, count: number) => {
    const trade = async () => {
      try { return await game.tradeGameShop(tradeSide, id, count); }
      catch (caught) {
        if (caught instanceof Error && caught.message.includes('Policy-epoch supply-flow limit reached')) {
          throw new Error(shopPauseCopy('Policy-epoch supply-flow limit reached'));
        }
        throw caught;
      }
    };
    const result = await run(`npc-${tradeSide}-${id}`, trade,
      tradeSide === 'buy'
        ? `Bought ${formatInteger(count)} ${ITEM_NAME[id]}.`
        : `Sold ${formatInteger(count)} ${ITEM_NAME[id]}.`);
    if (result) await Promise.all([load(), refresh()]);
  };

  if (!economy && !error) {
    return (
      <div className="market-goods">
        <div className="market-desks grid gap-2 sm:grid-cols-2">
          <Skeleton className="h-24" /><Skeleton className="h-24" />
        </div>
        <div className="market-goods-body mt-2.5 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {GOLD_ITEMS.map((id) => <Skeleton key={id} className="h-28" />)}
        </div>
      </div>
    );
  }
  if (!economy) return <ErrorNote error={error} onRetry={() => void load()} />;

  const gold = player?.gold ?? 0;

  /* No health strip over the shop.
     It carried two numbers -- the purse and whether the market is stable --
     over a counter that has one ticket on it, and both of them are things you
     read WHILE pricing a trade, not before deciding to. They are in the ticket
     now: the purse folded into the row that already said what it would be
     afterwards, and the market's state as a badge on the ticket's own heading.
     The strip stays on the two books, where it also carries the pair, the
     custody popover and the refresh. */
  return (
    <div className="market-goods">
      {error !== null && <ErrorNote error={error} onRetry={() => void load()} />}
      {writePhase(`npc-${side}-${item}`) === 'settling' && (
        <TransactionHold className="mb-2">
          The trade is signed. The goods stay on the counter until the desk confirms the fill.
        </TransactionHold>
      )}

      <RealmShop economy={economy} venueBook={venueBook} gold={gold} inventory={player?.inventory}
                 item={item} onItem={setItem} side={side} onSide={setSide}
                 connected={Boolean(address)} connecting={connecting} onConnect={connect}
                 count={count} onCount={setCount}
                 isPending={isPending} onTrade={shopTrade} onRefresh={() => void load()}
                 onOpenFloor={onOpenFloor} />
    </div>
  );
}

/**
 * Which market the book is showing.
 *
 * A dropdown rather than a band of tiles. The external registry holds one pair
 * today and arbitrary pairs later, so a six-wide strip holding one tile is a
 * strip of five empty cells — and the answer to "which market" belongs on the
 * same line as "what do I hold in it", because that is one thought.
 *
 * The touch rides in the trigger. Whichever pair you are on, its bid and ask
 * are readable without opening anything.
 */
function MarketPicker({ markets, value, onPick, glyph, format }: {
  markets: Array<{ id: string; label: string; bestBid?: number; bestAsk?: number }>;
  value: string; onPick: (id: string) => void;
  glyph: (id: string) => React.ReactNode; format: (value: number) => string;
}) {
  const [open, setOpen] = useState(false);
  const { host, list } = usePopover(open, () => setOpen(false));
  const current = markets.find((row) => row.id === value) ?? markets[0];
  if (!current) return null;

  const quote = (row: { bestBid?: number; bestAsk?: number }) => (
    <span className="market-pair-quote">
      <b className="text-good">{row.bestBid ? format(row.bestBid) : '--'}</b>
      <i>/</i>
      <b className="text-bad">{row.bestAsk ? format(row.bestAsk) : '--'}</b>
    </span>
  );

  return (
    <div ref={host} className="market-pair relative">
      <button type="button" className="market-pair-trigger" aria-haspopup="listbox" aria-expanded={open}
              aria-label={`Market: ${current.label}`}
              onClick={() => setOpen((was) => !was)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown' && !open) { event.preventDefault(); setOpen(true); }
              }}>
        {glyph(current.id)}
        <span className="market-pair-name">{current.label}</span>
        {quote(current)}
        <Arrow className={cx('market-venue-caret h-3.5 w-3.5', open && 'is-open')} />
      </button>
      {open && (
        <div ref={list} role="listbox" aria-label="Markets" className="market-venue-list market-pair-list">
          {markets.map((row, index) => (
            <button key={row.id} type="button" role="option" aria-selected={row.id === value}
                    data-selected={row.id === value} className="market-venue-option market-pair-option"
                    onKeyDown={(event) => {
                      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
                      event.preventDefault();
                      const next = (index + (event.key === 'ArrowDown' ? 1 : markets.length - 1)) % markets.length;
                      list.current?.querySelectorAll<HTMLElement>('[role="option"]')[next]?.focus();
                    }}
                    onClick={() => { onPick(row.id); setOpen(false); }}>
              {glyph(row.id)}
              <span className="market-pair-name min-w-0 flex-1">{row.label}</span>
              {quote(row)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The bar over every counter.
 *
 * The same row on both books, in the same place, so the eye does not have to
 * re-learn where the venue tells you its state. What it holds is the one thing
 * the two books are allowed to differ on, because on the internal book your
 * position is Gold in a player record and on the external one it is two tokens
 * in a wallet you own.
 */
function MarketHealthStrip({ lead, stats, actions }: {
  stats: Array<{ label: string; value: string; tone?: string }>;
  /** Which market, when the venue has more than one. Sits before the actions. */
  lead?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    /* Not a `Panel`: `.panel` draws its notched corner with `clip-path`, and a
       clip-path clips descendants — which ate the market picker's popover. The
       bar wears the panel's surface without its shape. */
    <div data-tour="market-desks" className="market-desk-bar flex flex-wrap items-center gap-2 p-2">
      {lead}
      <div className="market-desk-actions flex min-w-0 flex-1 flex-wrap items-center gap-1.5">{actions}</div>
      <dl className="market-desk-health flex items-center justify-end gap-2">
        {stats.map((row) => (
          <div key={row.label}>
            <dt>{row.label}</dt>
            <dd className={row.tone}>{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// The realm's shop ----------------------------------------------------------

/**
 * What one unit of a desk trade costs, unit by unit.
 *
 * The desk reprices against its OWN STOCK after every single unit -- see the
 * pricing loop in `economy.lua`'s `shopTrade`, which walks `deskBand` against
 * the stock that will exist immediately before each unit. So the headline
 * quote is the price of the FIRST unit and says nothing about the fifth:
 * selling five berries into a fresh desk bidding 5 pays 23, not 25, because
 * the third unit pushes the desk's stock over a band edge and the last two
 * fill at 4.
 *
 * A ticket that multiplies the headline by the quantity is therefore not
 * approximating, it is wrong, and it is wrong in the direction that costs the
 * player -- they are told 25 and handed 23. Walking the ladder is the only
 * honest total.
 *
 * Nothing new crosses the wire for this. `marketStats` already publishes the
 * desk's own levels inside `depth`, best price first, with `house` counting
 * the desk's units at each price; the player orders resting alongside them are
 * a different venue and are deliberately not walked here.
 */
function venueMarketStats(market: VenueMarketBook | undefined): EconomyMarketStats | undefined {
  if (!market) return undefined;
  const depth = (rows: VenueMarketBook['depth']['bids'] | undefined) =>
    (rows ?? []).map((level) => ({
      price: level.price, quantity: level.quantity, orders: level.orders,
    }));
  return {
    bestBid: market.bestBid, bestAsk: market.bestAsk,
    p2pBid: market.bestBid, p2pAsk: market.bestAsk,
    houseBidUnits: 0, houseAskUnits: 0,
    band: market.band,
    depth: { bids: depth(market.depth?.bids), asks: depth(market.depth?.asks) },
    volume24h: 0, volume7d: 0, medianSamples7d: 0, medianSamples30d: 0,
    uniqueMakers7d: 0, uniqueTakers7d: 0,
  };
}

interface DeskFillPlan {
  /** Units the published ladder can price, and what they cost together. */
  units: number;
  total: number;
  /** One entry per PRICE, in fill order. More than one means the rate moved. */
  steps: Array<{ price: number; units: number }>;
  /** Units the request runs past the end of the published ladder. */
  unpriced: number;
  first: number;
  last: number;
}

function deskFillPlan(
  depth: EconomyMarketStats['depth'] | undefined,
  side: GoldOrderSide,
  count: number,
): DeskFillPlan {
  const rows = (side === 'buy' ? depth?.asks : depth?.bids) ?? [];
  const steps: Array<{ price: number; units: number }> = [];
  let remaining = Math.max(0, count);
  let total = 0;
  let units = 0;
  for (const row of rows) {
    if (remaining <= 0) break;
    /* `quantity` is the desk AND the players at this price; only the desk is
       on the other side of a shop ticket. */
    const available = row.house ?? 0;
    if (available <= 0) continue;
    const take = Math.min(available, remaining);
    steps.push({ price: row.price, units: take });
    total += row.price * take;
    units += take;
    remaining -= take;
  }
  return {
    units,
    total,
    steps,
    unpriced: remaining,
    first: steps[0]?.price ?? 0,
    last: steps[steps.length - 1]?.price ?? 0,
  };
}


function RealmShop({
  economy, venueBook, gold, inventory, item, onItem, side, onSide, connected, connecting, onConnect,
  count, onCount, isPending, onTrade, onRefresh, onOpenFloor,
}: {
  economy: EconomyView; venueBook: VenueBook | null;
  gold: number; inventory: Partial<Record<GoldMarketItemId, number>> | undefined;
  item: GoldMarketItemId; onItem: (item: GoldMarketItemId) => void;
  side: GoldOrderSide; onSide: (side: GoldOrderSide) => void;
  connected: boolean; connecting: boolean; onConnect: () => void;
  count: number;
  onCount: (value: number) => void;
  isPending: (key: string) => boolean;
  onTrade: (item: GoldMarketItemId, side: GoldOrderSide, count: number) => Promise<void>;
  onRefresh: () => void; onOpenFloor: (order: FloorPrefill) => void;
}) {
  const desk = economy.desks[item];
  const held = inventory?.[item] ?? 0;
  /* One walk, two consumers: the ticket states the total and the diorama
     piles up the Gold that total actually is. */
  const plan = deskFillPlan(economy.market[item]?.depth, side, count);
  const sceneInventory = GOLD_ITEMS.map((id) => ({
    id,
    name: ITEM_NAME[id],
    art: ITEM_ART[id],
    element: ITEM_ELEMENT[id] ?? 'arcane',
    stock: economy.desks[id]?.stock ?? 0,
    stockCap: economy.desks[id]?.stockCap ?? 0,
    bid: economy.desks[id]?.bid,
    ask: economy.desks[id]?.ask,
    bestBid: economy.market[id]?.bestBid,
    bestAsk: economy.market[id]?.bestAsk,
    held: inventory?.[id] ?? 0,
  }));
  return (
    <div className="market-goods-body market-shop-workspace">
      <ShopShowcase item={item} plan={plan} side={side} count={count} sceneInventory={sceneInventory}
                    onItem={onItem} />

      <ShopTradeTicket item={item} desk={desk} p2p={venueMarketStats(venueBook?.[`${item}/gold`])} plan={plan}
                       held={held} gold={gold} stable={economy.invariants.ok}
                       count={count} onCount={onCount}
                       side={side} onSide={onSide} connected={connected}
                       connecting={connecting} onConnect={onConnect}
                       busy={isPending(`npc-${side}-${item}`)}
                       onTrade={() => void onTrade(item, side, count)} onRefresh={onRefresh}
                       onOpenFloor={onOpenFloor} />
    </div>
  );
}

function ShopShowcase({ item, plan, side, count, sceneInventory, onItem }: {
  item: GoldMarketItemId;
  plan: DeskFillPlan; side: GoldOrderSide; count: number; sceneInventory: MarketDioramaStockItem[];
  onItem: (item: GoldMarketItemId) => void;
}) {
  return (
    /* The walkthrough's "the shop is a different counterparty" step used to
       point at the health strip, which the shop no longer has -- and a step
       whose target is missing is dropped in silence. It points at the realm's
       own stock instead, which is what the sentence is actually about. */
    <Panel data-tour="market-desks" data-element={ITEM_ELEMENT[item]}
           className="market-shop-showcase flex min-h-0 flex-col overflow-hidden p-0">
      <div className="market-shop-showcase-art relative grid min-h-[13rem] flex-1 place-items-center overflow-hidden">
        <div className="market-diorama-fallback absolute inset-0" aria-hidden="true">
          <div className="market-shop-room-backdrop" />
        </div>
        {/* Gold sits on the upper table either way: it is what you pay when
            buying and what you take when selling. */}
        <MarketDiorama quantity={count} inventory={sceneInventory} mode={side}
                       gold={plan.total}
                       item={{ id: item, art: ITEM_ART[item], element: ITEM_ELEMENT[item] ?? 'arcane' }}
                       selected={item} onSelect={(id) => onItem(id as GoldMarketItemId)}
                       className="absolute inset-0 z-[3]" />
      </div>
    </Panel>
  );
}

function ShopTradeTicket({
  item, desk, p2p, plan, held, gold, stable, count, onCount, side, onSide,
  connected, connecting, onConnect, busy, onTrade, onRefresh, onOpenFloor,
}: {
  item: GoldMarketItemId; desk: EconomyDesk | undefined;
  /** The internal venue's ladder for this good: the other counter's price. */
  p2p: EconomyMarketStats | undefined;
  plan: DeskFillPlan;
  held: number; gold: number;
  /** `economy.invariants.ok` -- the whole market's state, not this desk's. */
  stable: boolean;
  count: number; onCount: (value: number) => void; side: GoldOrderSide; onSide: (side: GoldOrderSide) => void;
  connected: boolean; connecting: boolean; onConnect: () => void; busy: boolean;
  onTrade: () => void; onRefresh: () => void; onOpenFloor: (order: FloorPrefill) => void;
}) {
  const paused = pausedFor(desk, side);
  const unitPrice = side === 'buy' ? desk?.ask ?? 0 : desk?.bid ?? 0;
  const playerPrice = side === 'buy' ? p2p?.bestAsk ?? 0 : p2p?.bestBid ?? 0;
  const playerDepth = side === 'buy' ? p2p?.depth.asks ?? [] : p2p?.depth.bids ?? [];
  const playerUnits = playerDepth
    .filter((row) => row.price === playerPrice)
    .reduce((sum, row) => sum + row.quantity, 0);
  const perAction = Math.max(1, desk?.limits?.perAction ?? 1);
  const playerBetter = Boolean(playerPrice && unitPrice && (side === 'buy' ? playerPrice < unitPrice : playerPrice > unitPrice));
  const priceEdge = playerBetter ? Math.abs(playerPrice - unitPrice) * Math.min(count, playerUnits || count) : 0;
  /* The walked total, not the headline times the quantity. Anything the
     published ladder could not price is carried at the last rate it did
     quote, which is the closest honest guess and is flagged as one. */
  const total = plan.total + plan.unpriced * (plan.last || unitPrice);
  /* Rounded to the Gold the desk actually deals in -- there are no fractions
     of a Gold anywhere in the process, so an average is a reading, not a
     price, and it is labelled as an average for that reason. */
  const average = count > 0 ? total / count : 0;
  const rateMoves = plan.steps.length > 1;
  const shortBy = side === 'buy' ? Math.max(0, total - gold) : Math.max(0, count - held);
  /* The quantity is the shop's, not the desk's, so it can outrun a stricter
     desk's per-action limit. Say so rather than offering a trade the process
     will refuse — the number itself is the player's and does not move. */
  const overLimit = Math.max(0, count - perAction);
  const canTrade = Boolean(desk && unitPrice && !paused && !shortBy && !overLimit);
  const goldAfter = side === 'buy' ? gold - total : gold + total;
  const heldAfter = side === 'buy' ? held + count : held - count;
  /* The order that ACTS on the number the row is showing.
     Same good, same side, same size, priced AT the resting quote it just
     compared against -- so a limit order at that price crosses and takes it.
     Arriving at the floor with an empty ticket meant re-deriving all four,
     from a ladder that has just scrolled off the screen you decided on. */
  const prefill: FloorPrefill = { item, side, count, price: playerPrice || undefined };

  return (
    <Panel data-tour="market-ticket" data-element={ITEM_ELEMENT[item]}
           className="market-shop-ticket flex min-h-0 flex-col overflow-hidden p-0">
      <div className="market-panel-heading flex items-start justify-between gap-3">
        <div>
          <div className="eyebrow">Instant trade</div>
          <h3 className="mt-1 text-sm font-semibold">Deal ticket</h3>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {/* The whole market's state, which is a different thing from this
              desk's pause below -- the desk closes one side of one good, this
              says the process stopped honouring its own invariants. */}
          <Badge tone={stable ? 'plain' : 'bad'}>{stable ? 'Market stable' : 'Market paused'}</Badge>
          <Button size="sm" variant="quiet" title="Refresh shop" onClick={onRefresh}
                  icon={<Refresh className="h-3.5 w-3.5" />}>Refresh</Button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col p-3.5">
        <div className="grid grid-cols-2 gap-1.5">
          <Button size="sm" variant={side === 'buy' ? 'primary' : 'quiet'} onClick={() => onSide('buy')}>Buy</Button>
          <Button size="sm" variant={side === 'sell' ? 'primary' : 'quiet'} onClick={() => onSide('sell')}>Sell</Button>
        </div>

        <div className="market-ticket-item mt-3 flex items-center gap-3 border-y border-edge/70 py-3">
          <ItemGlyph item={item} className="h-10 w-10" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{ITEM_NAME[item]}</div>
            <div className="mt-0.5 font-mono text-[10px] text-faint">
              {side === 'buy' ? 'Realm asks' : 'Realm bids'}{rateMoves ? ' · first unit' : ''}
            </div>
          </div>
          <div className="font-mono text-xl text-element">{unitPrice ? formatInteger(unitPrice) : '--'}<span className="text-[10px] text-faint">g</span></div>
        </div>

        <div className="mt-3 flex items-center justify-between gap-3">
          <div><div className="eyebrow">Quantity</div><div className="mt-1 text-[11px] text-faint">Max {formatInteger(perAction)}</div></div>
          <Stepper value={count} max={perAction} onChange={onCount} label={ITEM_NAME[item]} />
        </div>

        <div className="market-venue-compare mt-3">
          <div className={cx(!playerBetter && !paused && 'is-best')}>
            <span><i>Realm desk</i><small>Immediate</small></span>
            <b>{unitPrice ? `${formatInteger(unitPrice)}g` : 'Closed'}</b>
          </div>
          <button type="button" onClick={() => onOpenFloor(prefill)} className={cx(playerBetter && 'is-best')}>
            <span><i>Player exchange</i><small>{playerUnits ? `${formatInteger(playerUnits)} at best price` : 'Live order book'}</small></span>
            <b>{playerPrice ? `${formatInteger(playerPrice)}g` : '--'}</b>
          </button>
        </div>

        {playerBetter && (
          <button type="button" onClick={() => onOpenFloor(prefill)} className="market-better-route mt-2">
            Better P2P price {priceEdge ? `· ${formatInteger(priceEdge)} Gold ${side === 'buy' ? 'less' : 'more'}` : ''}
            <Arrow className="h-3.5 w-3.5" />
          </button>
        )}

        {/* The desk reprices per unit, so a trade big enough to cross a band
            edge fills at two or three different rates. Showing only the total
            would leave the player to discover that from their balance; this
            names every rate and the quantity that filled at it. */}
        {rateMoves && (
          <div className="market-ticket-steps mt-3">
            <div className="eyebrow">
              Rate {side === 'buy' ? 'rises' : 'drops'} {plan.steps.length - 1}
              {plan.steps.length === 2 ? ' time' : ' times'} in this trade
            </div>
            <ol className="mt-1.5 space-y-1">
              {plan.steps.map((step, index) => (
                <li key={step.price} className="flex items-baseline justify-between gap-3 font-mono text-[11px]">
                  <span className="text-faint">
                    {index === 0 ? 'First' : 'Next'} {formatInteger(step.units)}
                  </span>
                  <span className={index === 0 ? 'text-element' : 'text-faint'}>
                    {formatInteger(step.price)}g each
                  </span>
                </li>
              ))}
            </ol>
            <p className="mt-1.5 text-[10px] leading-relaxed text-faint">
              The realm reprices after every unit it {side === 'buy' ? 'sells' : 'buys'}.
            </p>
          </div>
        )}

        <dl className="market-ticket-summary mt-3 space-y-2">
          <div>
            <dt>{rateMoves ? 'Average unit' : 'Unit price'}</dt>
            <dd>{unitPrice ? `${rateMoves ? average.toFixed(1) : formatInteger(unitPrice)} Gold` : '--'}</dd>
          </div>
          <div><dt>{side === 'buy' ? 'Total cost' : 'You receive'}</dt><dd className="text-element">{unitPrice ? `${formatInteger(total)} Gold` : '--'}</dd></div>
          {/* Balance now, and what the trade leaves. Two numbers in one row,
              because "Gold after" alone answered half a question and the other
              half was in a strip above the whole screen. */}
          <div>
            <dt>Gold</dt>
            <dd>{formatInteger(gold)}{canTrade && <><span className="market-ticket-arrow">&rarr;</span>
              <span className="text-element">{formatInteger(goldAfter)}</span></>}</dd>
          </div>
          <div>
            <dt>{ITEM_NAME[item]}</dt>
            <dd>{formatInteger(held)}{canTrade && <><span className="market-ticket-arrow">&rarr;</span>
              <span className="text-element">{formatInteger(heldAfter)}</span></>}</dd>
          </div>
        </dl>
        {plan.unpriced > 0 && unitPrice > 0 && (
          <p className="mt-2 text-[10px] leading-relaxed text-faint">
            The realm publishes its ladder {formatInteger(plan.units)} deep; the last
            {' '}{formatInteger(plan.unpriced)} are estimated at {formatInteger(plan.last || unitPrice)}g
            and may fill for {side === 'buy' ? 'more' : 'less'}.
          </p>
        )}

        <div className="mt-auto pt-4">
          {!desk && <p className="mb-2 text-[11px] text-faint">This good is available on the player exchange only.</p>}
          {paused && (
            <div className="mb-2 rounded-[3px] border border-warn/35 bg-warn/[.07] p-2.5">
              <p className="text-[11px] leading-relaxed text-warn">{shopPauseCopy(paused)}</p>
              {playerPrice > 0 && <button type="button" onClick={() => onOpenFloor(prefill)} className="mt-1.5 flex items-center gap-1 text-[11px] text-ink hover:text-arcane">Trade on the player exchange <Arrow className="h-3 w-3" /></button>}
            </div>
          )}
          {!paused && Boolean(overLimit) && (
            <p className="mb-2 text-[11px] text-warn">
              {ITEM_NAME[item]} trades at most {formatInteger(perAction)} at a time.
            </p>
          )}
          {!paused && !overLimit && Boolean(shortBy) && (
            <p className="mb-2 text-[11px] text-warn">
              {side === 'buy' ? `Need ${formatInteger(shortBy)} more Gold.` : `Need ${formatInteger(shortBy)} more in your satchel.`}
            </p>
          )}
          {!connected ? (
            <Button className="w-full" variant="primary" busy={connecting} onClick={onConnect}
                    icon={<Wallet className="h-4 w-4" />}>Connect to trade</Button>
          ) : (
            <Button className="w-full" variant="primary" busy={busy} disabled={!canTrade} onClick={onTrade}>
              {side === 'buy' ? 'Buy' : 'Sell'} {formatInteger(count)} &middot; {unitPrice ? formatInteger(total) : '--'} Gold
            </Button>
          )}
        </div>
      </div>
    </Panel>
  );
}

// Trading floor -------------------------------------------------------------

/**
 * What a time in force MEANS, in the language of the screen.
 *
 * Four values on one tag, and the difference between them is entirely about
 * what happens to the part that did not trade -- which is the one thing a
 * trader has to understand before sending one, and the one thing the tag name
 * does not say.
 */
const TIF_CHOICES: Array<{ value: GoldOrderTif; label: string; blurb: string }> = [
  { value: 'GTC', label: 'Limit',
    blurb: 'Trades at your limit or better now; any remainder rests until it fills or you withdraw it.' },
  { value: 'IOC', label: 'Market',
    blurb: 'Takes whatever the ladder offers right now and cancels the rest. Nothing rests.' },
  { value: 'FOK', label: 'Fill all now',
    blurb: 'Fills the whole quantity right now or does nothing at all, and costs nothing when it does nothing.' },
  { value: 'PostOnly', label: 'Maker only',
    blurb: 'Refused rather than allowed to cross, so this can only ever add liquidity.' },
];

const TIF_TERMS: Record<GoldOrderTif, string> = {
  GTC: 'Good for 30 days · price-time priority · partial fills allowed',
  IOC: 'Executes now · unfilled quantity cancels · nothing rests',
  FOK: 'Executes now · full quantity only · nothing rests',
  PostOnly: 'Good for 30 days · adds liquidity only · partial fills allowed',
};

/**
 * Walk a ladder and work out what an immediate order would actually get.
 *
 * This is how "spend 200 Gold" becomes a real order. The process never accepts
 * an unpriced one -- a market order with no limit is a promise to pay whatever
 * the worst resting order asks, against a price ceiling of a million -- so the
 * limit is the client's job, and it is exactly the last price the sweep needs
 * rather than a guess with a cushion on it. If the book moves in between, the
 * order simply fills less.
 */
function sweepLadder(
  rows: MarketDepthRow[], tone: 'good' | 'bad', want: { units?: number; quote?: number },
) {
  const levels = aggregateDepth(rows, tone);
  let units = 0; let cost = 0; let limit = 0;
  for (const level of levels) {
    const room = want.quote !== undefined
      ? Math.min(level.quantity, Math.floor((want.quote - cost) / Math.max(1, level.price)))
      : Math.min(level.quantity, Math.max(0, (want.units ?? 0) - units));
    if (room <= 0) break;
    units += room; cost += room * level.price; limit = level.price;
    if (want.units !== undefined && units >= want.units) break;
  }
  return { units, cost, limit, average: units ? Math.round(cost / units) : 0 };
}

function TradingFloor({
  book, candles, publishedCandles, points, trades, config, unit, ticks, lead, actions, extraStats,
  address, quoteBalance, baseBalance, item, range, onRange,
  chartMode, onChartMode, candleInterval, onCandleInterval, side, onSide, tif, onTif,
  price, onPrice, quantity, onQuantity, ownOrders, recentFills, connecting, onConnect,
  isPending, onSubmit, onCancel, onCancelAll, onAmend, demo = false,
}: {
  /* The ladder, the band and the bars, and nothing else about the venue.

     This used to take the whole `EconomyView`, back when the only book was the
     one inside `game.lua`. The book now lives in `venue.lua` and is deployed
     twice -- once holding game goods, once holding tokens -- so the floor
     takes the four things it actually draws and a `unit` that says how a price
     in this market is written down. Everything below is the same instrument
     either way, which is the point. */
  book: EconomyMarketStats | undefined;
  candles: EconomyCandle[];
  /** Durable venue bars, keyed by display interval. The trade tail remains the fallback. */
  publishedCandles?: Partial<Record<CandleInterval, CandleBar[]>>;
  /** Address-free chart history for this market, oldest first. */
  trades: VenueTrade[];
  points: PricePoint[];
  config: { minValue: number; takerBps: number; creationCost: number };
  unit: FloorUnit;
  ticks: Array<{ label: string; value: string; tone?: 'good' | 'bad' }>;
  /** The market picker and the refresh control, hung off the health strip. */
  lead?: React.ReactNode;
  actions?: React.ReactNode;
  /** Anything the venue reports that is NOT held in custody here. */
  extraStats?: Array<{ label: string; value: string; tone?: string }>;
  address: string | null; quoteBalance: number; baseBalance: number;
  item: GoldMarketItemId;
  range: FloorRange; onRange: (range: FloorRange) => void;
  chartMode: ChartMode; onChartMode: (mode: ChartMode) => void;
  candleInterval: CandleInterval; onCandleInterval: (interval: CandleInterval) => void;
  side: GoldOrderSide; onSide: (side: GoldOrderSide) => void;
  tif: GoldOrderTif; onTif: (tif: GoldOrderTif) => void;
  price: string; onPrice: (value: string) => void;
  quantity: string; onQuantity: (value: string) => void;
  ownOrders: EconomyOrder[]; recentFills?: PlayerFill[];
  connecting: boolean; onConnect: () => void;
  isPending: (key: string) => boolean; onSubmit: () => void; onCancel: (orderId: string) => void;
  onCancelAll: (item?: GoldMarketItemId) => void;
  onAmend: (orderId: string, changes: { price?: number; quantity?: number }) => Promise<unknown>;
  /** Exercises every control locally but never signs, sends, or mutates a book. */
  demo?: boolean;
}) {
  const now = Date.now();
  const from = now - RANGE_MS[range];
  const zoomChart = useCallback((direction: ChartZoom) => {
    const allowed = chartMode === 'candles' ? rangesFor(candleInterval) : FLOOR_RANGES;
    const next = adjacentRange(range, direction, allowed);
    if (next !== range) onRange(next);
  }, [chartMode, candleInterval, range, onRange]);
  /* Daily bars and the optional intraday map come from the process and survive
     beyond the bounded fill ring. A venue can publish two compact source
     intervals and let the browser fold them into every wider chart interval. */
  const dailyBars = useMemo<CandleBar[]>(() => candles
    .filter((bar) => bar.d * 86_400_000 >= from - 86_400_000)
    .map((bar) => ({
      t: bar.d * 86_400_000, open: bar.o, high: bar.h, low: bar.l,
      close: bar.c, volume: bar.v, trades: bar.n,
    })),
  [candles, from]);
  const publishedBars = chartMode === 'candles'
    ? publishedCandles?.[candleInterval] ?? (candleInterval === '1d' ? dailyBars : undefined)
    : undefined;

  const [amending, setAmending] = useState<{ id: string; price: string; quantity: string } | null>(null);
  const [spend, setSpend] = useState('');

  const immediate = tif === 'IOC' || tif === 'FOK';
  const ladder = side === 'buy' ? (book?.depth.asks ?? []) : (book?.depth.bids ?? []);
  const ladderTone: 'good' | 'bad' = side === 'buy' ? 'bad' : 'good';
  const parsedSpend = unit.parse(spend);
  const spending = tif === 'IOC' && side === 'buy'
    && Number.isSafeInteger(parsedSpend) && parsedSpend > 0;
  /* In "spend" mode the ladder decides both numbers; otherwise the fields do,
     and an immediate order still takes its limit from the ladder because the
     player asked for a size, not a price. */
  const swept = useMemo(() => (spending
    ? sweepLadder(ladder, ladderTone, { quote: Math.max(0, parsedSpend - config.creationCost) })
    : sweepLadder(ladder, ladderTone, { units: Math.max(0, Math.floor(Number(quantity))) })),
  [ladder, ladderTone, spending, parsedSpend, quantity, config.creationCost]);

  const parsedPrice = immediate ? swept.limit : unit.parse(price);
  const parsedQuantity = spending ? swept.units : Math.floor(Number(quantity));
  const validOrder = Number.isSafeInteger(parsedPrice) && parsedPrice > 0
    && Number.isSafeInteger(parsedQuantity) && parsedQuantity > 0;
  const rawNotional = validOrder ? parsedPrice * parsedQuantity : 0;
  const unsafeNotional = validOrder && !Number.isSafeInteger(rawNotional);
  const notional = unsafeNotional ? 0 : rawNotional;
  /* Read the fee off the market, never a constant.
     The process charges the TAKER, at a per-market rate that is 0 on every
     internal market and 30 bps on the external one. A hardcoded number here
     describes a rule the process may not have, which is worse than showing
     nothing. See ORDERBOOK.md paragraph 7.3. */
  const minimumOrder = config.minValue;
  const belowMinimum = validOrder && !unsafeNotional && notional < minimumOrder;
  const creationCost = config.creationCost;
  const takerBps = config.takerBps;
  const crossesBook = validOrder && (side === 'buy'
    ? Boolean(book?.bestAsk && parsedPrice >= book.bestAsk)
    : Boolean(book?.bestBid && parsedPrice <= book.bestBid));
  /* Only a crossing order is a taker. Resting is free, always. */
  const takerFee = crossesBook && takerBps ? Math.ceil(notional * takerBps / 10000) : 0;
  const requiredQuote = side === 'buy' ? notional + creationCost + takerFee : creationCost;
  const held = baseBalance;
  const shortQuote = validOrder ? Math.max(0, requiredQuote - quoteBalance) : 0;
  const shortItems = side === 'sell' && validOrder ? Math.max(0, parsedQuantity - held) : 0;
  /* The corridor, checked here so the player is told before spending a message
     to find out. Without it the price ceiling is the only limit, and one
     crossing order can print a million -- which then becomes the seven-day
     median every other reader takes as the truth. */
  const band = book?.band;
  const outsideBand = validOrder && band !== undefined
    && (parsedPrice < band.low || parsedPrice > band.high);
  const postOnlyCrosses = tif === 'PostOnly' && crossesBook;
  const nothingToTake = immediate && swept.units <= 0;
  const killShort = tif === 'FOK' && swept.units < parsedQuantity;
  const orderReady = validOrder && !unsafeNotional && !belowMinimum && !shortQuote && !shortItems
    && !outsideBand && !postOnlyCrosses && !nothingToTake && !killShort;
  const ladderPeak = ladderScale(book?.depth.bids ?? [], book?.depth.asks ?? []);
  const pickDepth = (nextSide: GoldOrderSide, nextPrice: number) => {
    onSide(nextSide);
    onPrice(String(nextPrice));
  };
  const mineHere = ownOrders.filter((order) => order.item === item);

  return (
    <div className="market-goods-body market-floor flex min-h-0 flex-col gap-2.5">
      <MarketHealthStrip lead={lead} actions={actions} stats={[
        ...extraStats ?? [],
        { label: `${unit.quote} here`, value: unit.format(quoteBalance), tone: 'text-rune' },
        { label: `${ITEM_NAME[item] ?? item} here`, value: formatInteger(baseBalance), tone: 'text-arcane' },
        { label: demo ? 'Sample orders' : 'Your orders', value: formatInteger(ownOrders.length) },
      ]} />

      <div data-tour="market-book" className="market-book-body grid min-h-0 flex-1 gap-2.5">
        <Panel className="market-order-book flex min-h-0 flex-col overflow-hidden p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-mono text-sm tracking-tight">
              {ITEM_NAME[item]} <span className="text-faint">/ {unit.quote}</span>
            </h3>
            <BookChartToolbar chartMode={chartMode} onChartMode={onChartMode}
                              candleInterval={candleInterval} onCandleInterval={onCandleInterval}
                              range={range} onRange={onRange} onZoom={zoomChart} />
          </div>
          <BookTicker rows={ticks} />
          <PriceChart className="mt-2.5 min-h-[15rem] flex-1 lg:min-h-0" points={points} from={from} to={now}
                      bid={book?.bestBid} ask={book?.bestAsk} mode={chartMode}
                      candleMs={CANDLE_MS[candleInterval]} published={publishedBars}
                      unit={unit.quote} format={unit.format} onZoom={zoomChart}
                      emptyAction={publishedBars === undefined && candles.length > 0
                        ? {
                          note: `No trades fall inside this ${range} window.`,
                          label: 'Show the daily bars',
                          onClick: () => { onChartMode('candles'); onCandleInterval('1d'); onRange('30d'); },
                        }
                        : undefined} />
        </Panel>

        <Panel className="market-depth-panel flex min-h-0 flex-col overflow-hidden p-3.5">
          {/* Top of book, and the spread with it. The spread used to be a bare
              difference in the tape strip and a caption under the depth chart,
              in different units, neither next to the two prices it is the gap
              between. It is one number about these two, so it goes between
              them, in the quote unit and in basis points -- bps being the only
              form comparable across a Gold book and a token book. */}
          <div className="market-top-of-book grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-px overflow-hidden rounded-[3px] border border-arcane/15 bg-arcane/12 p-px">
            <BookPrice label="Best bid" value={book?.bestBid} tone="good" unit={unit.quoteShort} format={unit.format} />
            <BookSpread bid={book?.bestBid} ask={book?.bestAsk} format={unit.format} />
            <BookPrice label="Best ask" value={book?.bestAsk} tone="bad" unit={unit.quoteShort} format={unit.format} />
          </div>
          {/* Capped, and deliberately. Cumulative depth is a SHAPE -- which side
              is heavier and how far out it reaches -- and a shape does not get
              truer with more pixels. Left on `flex-1` it grew to five hundred
              of them on a book with three levels a side, which read as a wall
              of colour and pushed the ladder, the part with numbers in it,
              off the bottom of the panel. */}
          <DepthMountain bids={book?.depth.bids ?? []} asks={book?.depth.asks ?? []}
                         unit={unit.quoteShort} format={unit.format}
                         className="mt-3 min-h-[10rem] max-h-64 flex-1" />
          {/* Bids mirrored, asks not, so the two columns open away from the
              spread between them and the pair reads as one shape. Both bars are
              on one scale -- see `ladderScale`. */}
          <div className="market-depth-ladders mt-3 grid min-h-0 flex-1 grid-cols-2 content-start gap-4 overflow-y-auto">
            <DepthList label="Bids" tone="good" rows={book?.depth.bids ?? []} unit={unit.quote} format={unit.format}
                       scale={ladderPeak}
                       onPick={(value) => pickDepth('sell', value)} action="Sell into bid" />
            <DepthList label="Asks" tone="bad" rows={book?.depth.asks ?? []} unit={unit.quote} format={unit.format}
                       scale={ladderPeak}
                       onPick={(value) => pickDepth('buy', value)} action="Buy from ask" />
          </div>
          <RecentTrades trades={trades} unit={unit} />

          {/* No house row, and no note saying there is one. The venue holds
              custody and matches players against players; nothing quotes into
              this ladder that is not somebody's resting order. The shop is a
              separate counter with its own stock, on its own tab.

              Moving assets in and out is not part of reading the ladder, so it
              is not stapled underneath one: it is a popover on the health
              strip, between the pair and the refresh, on both books. */}
        </Panel>

        <Panel data-tour="market-ticket" className="market-order-ticket flex min-h-0 flex-col overflow-hidden p-3.5">
          <div className="flex items-start justify-between gap-3">
            <div><div className="eyebrow">Order ticket</div>
              <h3 className="mt-1 text-sm font-semibold">{ITEM_NAME[item]}</h3></div>
            <div className="flex flex-wrap justify-end gap-1">
              {demo && <Badge tone="element">Synthetic</Badge>}
              {validOrder && !immediate && (
                <Badge tone={crossesBook ? 'good' : 'plain'}>{crossesBook ? 'Crosses' : 'Rests'}</Badge>
              )}
              <Badge tone="plain">
                {takerBps ? `${(takerBps / 100).toFixed(2)}% taker` : 'No fee'}
              </Badge>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-1.5">
            <Button size="sm" variant={side === 'buy' ? 'primary' : 'quiet'} onClick={() => onSide('buy')}>Bid</Button>
            <Button size="sm" variant={side === 'sell' ? 'primary' : 'quiet'} onClick={() => onSide('sell')}>Ask</Button>
          </div>

          {/* Time in force. Everything else a book does is a special case of
              these four, and the only difference between them is what happens
              to the part that did not trade. */}
          <div className="market-tif mt-2 grid grid-cols-2 gap-1" role="group" aria-label="Time in force">
            {TIF_CHOICES.map((choice) => (
              <button key={choice.value} type="button" title={choice.blurb}
                      aria-pressed={tif === choice.value}
                      onClick={() => onTif(choice.value)}
                      className={cx('market-tif-choice', tif === choice.value && 'is-active')}>
                {choice.label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[10px] leading-relaxed text-faint">
            {TIF_CHOICES.find((choice) => choice.value === tif)?.blurb}
          </p>

          {tif === 'IOC' && side === 'buy' && (
            <label className="mt-2.5 block"><span className="eyebrow mb-1 block">Spend / {unit.quote} (optional)</span>
              <input className={inputClass} inputMode="numeric" value={spend} placeholder="Leave blank to use quantity"
                     onChange={(event) => setSpend(event.target.value)} /></label>
          )}

          {immediate ? (
            <div className="mt-2.5 rounded-[3px] border border-edge/70 bg-void/25 px-3 py-2">
              <div className="eyebrow">Limit, taken from the ladder</div>
              <div className={cx('mt-1 font-mono text-lg leading-none', swept.limit ? 'text-ink' : 'text-faint')}>
                {swept.limit ? unit.format(swept.limit) : '--'} <span className="eyebrow">{unit.quoteShort}</span>
              </div>
              <p className="mt-1.5 text-[10px] leading-relaxed text-faint">
                The venue never takes an unpriced order, so this is the worst price the sweep
                needs, not a cushion. Average {swept.average ? unit.format(swept.average) : '--'}.
              </p>
            </div>
          ) : (
            <label className="mt-2.5 block"><span className="eyebrow mb-1 block">Unit price / {unit.quote}</span>
              <input className={inputClass} inputMode="decimal" value={price} placeholder={unit.placeholder}
                     onChange={(event) => onPrice(event.target.value)} /></label>
          )}
          {!spending && (
            <label className="mt-2 block"><span className="eyebrow mb-1 block">Quantity</span>
              <input className={inputClass} inputMode="numeric" value={quantity}
                     onChange={(event) => onQuantity(event.target.value)} /></label>
          )}

          <dl className="market-ticket-summary mt-3 space-y-2">
            {immediate && (
              <div><dt>Available now</dt>
                <dd className={swept.units ? 'text-good' : 'text-warn'}>
                  {formatInteger(swept.units)} of {formatInteger(Math.max(parsedQuantity, swept.units))}
                </dd></div>
            )}
            <div><dt>Order value</dt><dd>{notional ? `${unit.format(notional)} ${unit.quote}` : '--'}</dd></div>
            {creationCost > 0 && (
              <div><dt>Creation cost</dt><dd>{unit.format(creationCost)} {unit.quote}</dd></div>
            )}
            <div>
              <dt>Taker fee</dt>
              <dd className={takerFee ? 'text-bad' : 'text-good'}>
                {takerBps === 0 ? 'None' : takerFee ? `${unit.format(takerFee)} ${unit.quote}` : 'None, this rests'}
              </dd>
            </div>
            {side === 'sell' ? (
              <div><dt>Est. proceeds</dt><dd className="text-good">{notional ? `${unit.format(Math.max(0, notional - takerFee))} ${unit.quote}` : '--'}</dd></div>
            ) : (
              <div><dt>{unit.quote} committed</dt><dd className="text-good">{notional ? `${unit.format(requiredQuote)} ${unit.quote}` : '--'}</dd></div>
            )}
            {band && (
              <div><dt>Price band</dt>
                <dd className={outsideBand ? 'text-warn' : 'text-faint'}>
                  {unit.format(band.low)}&ndash;{unit.format(band.high)} {unit.quote}
                </dd></div>
            )}
          </dl>

          <p className="mt-3 border-t border-edge/60 pt-2 text-[10px] leading-relaxed text-faint">
            {TIF_TERMS[tif]}
          </p>
          {crossesBook && side === 'buy' && !immediate && (
            <p className="mt-1 text-[10px] leading-relaxed text-good">The resting ask sets the fill price; unused bid escrow returns.</p>
          )}
          {outsideBand && band && (
            <p className="mt-2 text-[11px] text-warn">
              Outside the {unit.format(band.low)}&ndash;{unit.format(band.high)} {unit.quote} band. The venue refuses
              prices this far from the market&rsquo;s own reference, so one mistake cannot set its median.
            </p>
          )}
          {postOnlyCrosses && <p className="mt-2 text-[11px] text-warn">A maker-only order may not cross. Move the price, or switch to Limit.</p>}
          {nothingToTake && <p className="mt-2 text-[11px] text-warn">Nothing is resting on that side to take.</p>}
          {killShort && !nothingToTake && <p className="mt-2 text-[11px] text-warn">Only {formatInteger(swept.units)} available, and a fill-all order would do nothing.</p>}
          {unsafeNotional && <p className="mt-2 text-[11px] text-warn">This order is too large for the client to quote exactly. Reduce its price or quantity.</p>}
          {belowMinimum && <p className="mt-2 text-[11px] text-warn">Minimum order value is {unit.format(minimumOrder)} {unit.quote}.</p>}
          {Boolean(shortQuote) && <p className="mt-2 text-[11px] text-warn">
            Need {unit.format(shortQuote)} more {unit.quote} deposited at this venue.</p>}
          {Boolean(shortItems) && <p className="mt-2 text-[11px] text-warn">
            Need {formatInteger(shortItems)} more {ITEM_NAME[item]} deposited at this venue.</p>}
          {demo
            ? <>
              <p className="mt-2 text-[10px] leading-relaxed text-arcane">
                Preview only. Change the ticket to test totals and depth; nothing here signs or reaches a process.
              </p>
              <Button className="mt-2.5 w-full" variant="primary" disabled>Chart Lab · no order sent</Button>
            </>
            : !address
            ? <Button className="mt-2.5 w-full" variant="primary" busy={connecting} onClick={onConnect}
                      icon={<Wallet className="h-4 w-4" />}>Connect to trade</Button>
            : <Button className="mt-2.5 w-full" variant="primary" busy={isPending('gold-order')}
                      disabled={!orderReady} onClick={onSubmit}>
                {immediate ? `Take ${formatInteger(parsedQuantity)}` : `Place ${side === 'buy' ? 'bid' : 'ask'}`}
              </Button>}

          <div className="mt-4 flex items-center justify-between gap-2">
            <div className="eyebrow">{demo ? 'Sample open orders' : 'Your open orders'}</div>
            {/* One message to step away from every quote in this market. The
                alternative is one message per order, which is two seconds of
                being unable to withdraw a price that has gone wrong. */}
            {!demo && mineHere.length > 1 && (
              <button type="button" className="market-ticket-link"
                      disabled={isPending('gold-cancel-all')}
                      onClick={() => onCancelAll(item)}>
                Withdraw all {mineHere.length}
              </button>
            )}
          </div>
          <ul className="mt-1.5 space-y-1 overflow-y-auto">
            {ownOrders.length === 0
              ? <li className="py-2 text-[11px] text-faint">
                {demo ? 'This fixture has no sample orders.' : 'Nothing of yours on the book.'}
              </li>
              : ownOrders.map((order) => (
                <li key={order.id} className="rounded-[2px] border border-edge/70 px-2 py-1.5">
                  <div className="flex items-center gap-2">
                    <ItemGlyph item={order.item} className="h-4 w-4" />
                    <span className="min-w-0 flex-1 font-mono text-[10px]">
                      <b className={order.side === 'buy' ? 'text-good' : 'text-bad'}>{order.side === 'buy' ? 'BID' : 'ASK'}</b>{' '}
                      {order.remaining}/{order.quantity} @ {unit.format(order.price)}
                    </span>
                    {!demo && <>
                      <button type="button" className="market-ticket-link"
                              aria-expanded={amending?.id === order.id}
                              onClick={() => setAmending(amending?.id === order.id ? null : {
                                id: order.id, price: unit.edit(order.price), quantity: String(order.remaining),
                              })}>Move</button>
                      <Button size="sm" variant="quiet" busy={isPending(`gold-cancel-${order.id}`)}
                              onClick={() => onCancel(order.id)}>&times;</Button>
                    </>}
                  </div>
                  {amending?.id === order.id && (
                    <>
                      <div className="mt-1.5 flex items-end gap-1.5">
                        <label className="min-w-0 flex-1"><span className="eyebrow mb-1 block">Price</span>
                          <input className="market-amend-input" inputMode="decimal" value={amending.price}
                                 onChange={(event) => setAmending({ ...amending, price: event.target.value })} /></label>
                        <label className="min-w-0 flex-1"><span className="eyebrow mb-1 block">Qty</span>
                          <input className="market-amend-input" inputMode="numeric" value={amending.quantity}
                                 onChange={(event) => setAmending({ ...amending, quantity: event.target.value })} /></label>
                        <Button size="sm" variant="primary" busy={isPending(`gold-amend-${order.id}`)}
                                onClick={() => {
                                  const nextPrice = unit.parse(amending.price);
                                  const nextQuantity = Math.floor(Number(amending.quantity));
                                  if (!(nextPrice > 0) || !(nextQuantity > 0)) return;
                                  void onAmend(order.id, { price: nextPrice, quantity: nextQuantity })
                                    .then(() => setAmending(null));
                                }}>Save</Button>
                      </div>
                      <p className="mt-1 text-[10px] leading-relaxed text-faint">
                        The same price at a smaller size keeps your place in the queue. A new
                        price goes to the back of it. Either way it is one message and no extra fee.
                      </p>
                    </>
                  )}
                </li>
              ))}
          </ul>

          {/* A trader's own fills. The global list is a 500-row ring shared by
              every market, so hunting through it for your own trades is both
              the wrong shape and, past five hundred trades, wrong. */}
          <div className="eyebrow mt-4">{demo ? 'Sample account fills' : 'Your recent fills'}</div>
          <ul className="mt-1.5 min-h-0 flex-1 space-y-1 overflow-y-auto">
            {!recentFills?.length
              ? <li className="py-2 text-[11px] text-faint">
                {demo ? 'This fixture has no sample fills.' : 'Nothing filled yet.'}
              </li>
              : recentFills.slice(0, 12).map((fill) => (
                <li key={fill.id} className="flex items-center gap-2 px-1 py-1 font-mono text-[10px]">
                  <ItemGlyph item={fill.item} className="h-3.5 w-3.5" />
                  <b className={fill.side === 'buy' ? 'text-good' : 'text-bad'}>
                    {fill.side === 'buy' ? 'BUY' : 'SELL'}
                  </b>
                  <span className="min-w-0 flex-1 truncate">
                    {formatInteger(fill.quantity)} @ {unit.format(fill.price)}
                    <span className="text-faint"> &middot; {fill.role}</span>
                  </span>
                  <span className="text-faint">{relativeTime(fill.filledAt)}</span>
                </li>
              ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}

/**
 * The line is elapsed time; candles are traded intervals.
 *
 * A thin market can print twice, sit idle for hours, then print again. Leaving
 * every empty interval on the candle axis turns those three useful bars into a
 * few pixels separated by an empty canvas. Filling the hole with synthetic
 * OHLC rows would be worse: it would draw activity that never happened.
 * Candles therefore pack only intervals that traded and mark every internal
 * break with its real idle duration. The selected window still decides which
 * trades are eligible, and the toolbar says how much wall-clock time it covers.
 */
/**
 * Line or candles, which candle, and how far back.
 *
 * Extracted the moment there were two books: a toolbar that lives in one
 * screen's JSX is a toolbar the other screen grows a slightly different copy
 * of, and then the two stop being the same instrument.
 */
const CANDLE_INTERVALS: CandleInterval[] = ['30s', '1m', '5m', '15m', '30m', '1h', '4h', '1d'];
const FLOOR_RANGES: FloorRange[] = ['30m', '1h', '3h', '12h', '24h', '7d', '30d'];
type ChartZoom = 'in' | 'out';

/** One discrete time-window step, shortest to longest. */
function adjacentRange(range: FloorRange, direction: ChartZoom, allowed: FloorRange[]): FloorRange {
  const windows = FLOOR_RANGES.filter((value) => allowed.includes(value));
  const at = windows.indexOf(range);
  if (at < 0 || !windows.length) return range;
  const next = direction === 'in' ? Math.max(0, at - 1) : Math.min(windows.length - 1, at + 1);
  return windows[next] ?? range;
}

/**
 * Which windows an interval can actually be drawn in.
 *
 * The two controls used to be independent, and they are not independent
 * questions: 5m over 30d is 8,640 bars in seven hundred pixels, which is a
 * solid block, and 1d over 12h is half a bar, which is nothing. Every book
 * elsewhere couples them and this one now does too -- between three bars and
 * four hundred, and the range snaps into that band when the interval moves.
 */
const MIN_BARS = 3;
const MAX_BARS = 400;
const rangesFor = (interval: CandleInterval) => FLOOR_RANGES.filter((value) => {
  const bars = RANGE_MS[value] / CANDLE_MS[interval];
  return bars >= MIN_BARS && bars <= MAX_BARS;
});

function BookChartToolbar({
  chartMode, onChartMode, candleInterval, onCandleInterval, range, onRange, onZoom,
}: {
  chartMode: ChartMode; onChartMode: (mode: ChartMode) => void;
  candleInterval: CandleInterval; onCandleInterval: (interval: CandleInterval) => void;
  range: FloorRange; onRange: (range: FloorRange) => void;
  onZoom: (direction: ChartZoom) => void;
}) {
  const allowed = chartMode === 'candles' ? rangesFor(candleInterval) : FLOOR_RANGES;
  const zoomedIn = adjacentRange(range, 'in', allowed);
  const zoomedOut = adjacentRange(range, 'out', allowed);
  const nearestRange = (valid: FloorRange[]) => {
    if (valid.includes(range) || !valid.length) return;
    const wanted = FLOOR_RANGES.indexOf(range);
    onRange(valid.reduce((best, value) =>
      Math.abs(FLOOR_RANGES.indexOf(value) - wanted) < Math.abs(FLOOR_RANGES.indexOf(best) - wanted)
        ? value : best));
  };
  /* Moving the interval moves the window with it, to the nearest one it can be
     drawn in, so the chart never lands on a combination it has to refuse. */
  const pickInterval = (next: CandleInterval) => {
    onCandleInterval(next);
    nearestRange(rangesFor(next));
  };
  /* Line accepts every window. Coming back to candles must apply the same
     coupling as changing the interval, or a 30-day line can leave a 30-second
     candle view selected even though its range button is disabled. */
  const pickMode = (next: ChartMode) => {
    onChartMode(next);
    if (next === 'candles') nearestRange(rangesFor(candleInterval));
  };

  return (
    <div className="market-chart-toolbar flex flex-wrap justify-end gap-1">
      {(['line', 'candles'] as ChartMode[]).map((value) => (
        <ChartControl key={value} active={chartMode === value} onClick={() => pickMode(value)}>
          {value === 'line' ? 'Line' : 'Candles'}
        </ChartControl>
      ))}
      <span className="market-chart-divider" aria-hidden="true" />
      {chartMode === 'candles' && <span className="market-chart-group-label">Bar</span>}
      {chartMode === 'candles' && CANDLE_INTERVALS.map((value) => (
          <ChartControl key={value} active={candleInterval === value} onClick={() => pickInterval(value)}
                        title={value === '1d'
                          ? 'Daily bars, published by the venue and kept for 30 days'
                          : `${value} bars, aggregated from the venue's recent public trades`}>
            {value}
          </ChartControl>
        ))}
      {chartMode === 'candles' && <span className="market-chart-divider" aria-hidden="true" />}
      <span className="market-chart-group-label">Window</span>
      {FLOOR_RANGES.map((value) => (
        <ChartControl key={value} active={range === value} disabled={!allowed.includes(value)}
                      title={allowed.includes(value) ? undefined
                        : `${value} of ${candleInterval} bars does not draw`}
                      onClick={() => onRange(value)}>{value}</ChartControl>
      ))}
      <ChartControl active={false} disabled={zoomedOut === range} ariaLabel="Zoom out"
                    title="Zoom out to a longer time window" onClick={() => onZoom('out')}>−</ChartControl>
      <ChartControl active={false} disabled={zoomedIn === range} ariaLabel="Zoom in"
                    title="Zoom in to a shorter time window" onClick={() => onZoom('in')}>+</ChartControl>
    </div>
  );
}

function ChartControl({ active, onClick, children, disabled, title, ariaLabel }: {
  active: boolean; onClick: () => void; children: React.ReactNode;
  disabled?: boolean; title?: string; ariaLabel?: string;
}) {
  return (
    <button type="button" aria-pressed={active} aria-label={ariaLabel}
            onClick={onClick} disabled={disabled} title={title}
            className={cx('market-chart-control', active && 'is-active')}>
      {children}
    </button>
  );
}

interface PricePoint { t: number; v: number; q: number }
interface CandleBar {
  t: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  trades: number;
}

interface CandleGap {
  after: number;
  duration: number;
}

function candleBars(points: PricePoint[], interval: number): CandleBar[] {
  const buckets = new Map<number, CandleBar>();
  for (const point of points) {
    const start = Math.floor(point.t / interval) * interval;
    const row = buckets.get(start);
    if (!row) {
      buckets.set(start, {
        t: start, open: point.v, high: point.v, low: point.v, close: point.v,
        volume: point.q, trades: 1,
      });
    } else {
      row.high = Math.max(row.high, point.v);
      row.low = Math.min(row.low, point.v);
      row.close = point.v;
      row.volume += point.q;
      row.trades += 1;
    }
  }
  return [...buckets.values()].sort((a, b) => a.t - b.t);
}

/** Empty intervals between real bars. Nothing synthetic is added to the chart. */
function candleGaps(bars: CandleBar[], interval: number): CandleGap[] {
  const gaps: CandleGap[] = [];
  for (let index = 1; index < bars.length; index += 1) {
    const elapsed = bars[index].t - bars[index - 1].t;
    const missing = Math.max(0, Math.round(elapsed / interval) - 1);
    if (missing > 0) gaps.push({ after: index - 1, duration: missing * interval });
  }
  return gaps;
}

function chartDuration(value: number): string {
  const minutes = Math.max(1, Math.round(value / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours < 24) return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const extraHours = hours % 24;
  return extraHours ? `${days}d ${extraHours}h` : `${days}d`;
}

function PriceChart({ points, from, to, bid, ask, mode, candleMs, published, unit, format,
                     className, emptyAction, onZoom }: {
  points: PricePoint[]; from: number; to: number; mode: ChartMode; candleMs: number;
  /* What to offer when this window has nothing in it. The venue's retained
     history is bounded by trade count, so a quiet market can still run off its
     end; a bare "no fills" over a live book reads as a dead market. */
  emptyAction?: { label: string; note: string; onClick: () => void };
  /* The quote asset's name and how to print a price in it. A book quoted in
     Gold prints whole numbers; one quoted in a six-decimal token does not, and
     `formatInteger` rounded every external price to the same integer. */
  unit: string; format: (value: number) => string;
  /* Daily bars straight from the process, when it has them for this window.
     They are the whole reason candles were added: `economy.fills` is a 500-row
     ring, so a chart derived from it silently loses everything older than the
     last five hundred trades in the whole market. A published candle is
     permanent. */
  published?: CandleBar[];
  bid?: number; ask?: number; className?: string;
  onZoom?: (direction: ChartZoom) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const lastWheelZoom = useRef(0);
  /* A selected window is a data boundary, not only an x-axis label. The old
     renderer kept every tape row in its price scale and empty-state count,
     even when the row was outside the window, which could flatten the visible
     bars or claim a window had trades while drawing none. */
  const visiblePoints = useMemo(() => points.filter((point) => point.t >= from && point.t <= to),
    [points, from, to]);
  const visiblePublished = useMemo(() => published?.filter((bar) =>
    bar.t <= to && bar.t + candleMs > from), [published, from, to, candleMs]);
  const derived = useMemo(() => candleBars(visiblePoints, candleMs), [visiblePoints, candleMs]);
  const bars = visiblePublished?.length ? visiblePublished : derived;
  const gaps = useMemo(() => candleGaps(bars, candleMs), [bars, candleMs]);
  const latestBar = bars.at(-1);
  const plottedTrades = mode === 'candles'
    ? bars.reduce((sum, bar) => sum + bar.trades, 0)
    : visiblePoints.length;
  /* Gold prices are whole quote atoms. A diagonal between 8 and 9 implies
     tradeable prices that cannot exist, so line mode holds the last real print
     until the timestamp of the next one. Divisible token books keep the
     continuous line. */
  const steppedLine = mode === 'line' && unit === 'Gold';
  const visiblePriceLevels = useMemo(() => new Set(visiblePoints.map((point) => point.v)).size,
    [visiblePoints]);
  const windowIntervals = Math.max(1,
    Math.floor(to / candleMs) - Math.floor(from / candleMs) + 1);
  const emptyIntervals = Math.max(0, windowIntervals - bars.length);
  const emptyNote = emptyAction?.note ?? ((bid || ask)
    ? `${[
      bid ? `bid ${format(bid)}` : '', ask ? `ask ${format(ask)}` : '',
    ].filter(Boolean).join(' / ')} ${unit} is live. Price history starts with a fill.`
    : 'No resting quotes or fills in this window.');

  useEffect(() => {
    const element = canvas.current;
    const frame = host.current;
    if (!element || !frame) return undefined;
    let pointer: { x: number; y: number } | null = null;

    const draw = () => {
      const rect = frame.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      element.width = Math.round(rect.width * dpr);
      element.height = Math.round(rect.height * dpr);
      const ctx = element.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const width = rect.width; const height = rect.height;
      /* The OHLC strip wraps on a phone. Give its second line real plot space
         instead of letting it sit over the high wick. */
      const pad = { left: 7, right: 58, top: width < 520 ? 32 : 18, bottom: 20 };
      const plotW = Math.max(1, width - pad.left - pad.right);
      const plotH = Math.max(1, height - pad.top - pad.bottom);
      const priceH = mode === 'candles' ? plotH * .76 : plotH;
      ctx.clearRect(0, 0, width, height);

      const priceValues = mode === 'candles'
        ? bars.flatMap((bar) => [bar.high, bar.low])
        : visiblePoints.map((point) => point.v);
      const historyValues = priceValues
        .filter((value): value is number => typeof value === 'number' && value > 0);
      const quoteValues = [bid, ask]
        .filter((value): value is number => typeof value === 'number' && value > 0);
      /* Candles own the historical price scale. The live bid and ask are
         overlays, not observations: including a wide current spread in the
         domain squeezed every real candle into the strip between those two
         rules. With no history, quotes still provide a useful empty scale. */
      const scaleValues = historyValues.length ? historyValues : quoteValues;
      const low = scaleValues.length ? Math.min(...scaleValues) : 0;
      const high = scaleValues.length ? Math.max(...scaleValues) : 1;
      /* A one-Gold move on an 8-Gold berry is one discrete tick, not an 80%
         chart crash. Autoscaling only to observed high/low made real 8/9 data
         fill the entire panel while the broad synthetic fixture looked calm.
         Give coarse Gold markets at least four units of vertical context; a
         wider real range still owns the scale. Token markets use a percentage
         floor because their quote atoms are divisible. */
      const observedSpan = high - low;
      const minimumSpan = unit === 'Gold'
        ? Math.max(4, high * .08)
        : Math.max(1, high * .06);
      const priceSpan = Math.max(observedSpan * 1.24, minimumSpan);
      const centre = (high + low) / 2;
      let bottom = Math.max(0, centre - priceSpan / 2);
      let top = bottom + priceSpan;
      if (top < high) { top = high + priceSpan * .06; bottom = Math.max(0, top - priceSpan); }
      const y = (value: number) => pad.top + (1 - (value - bottom) / (top - bottom || 1)) * priceH;
      const span = to - from;
      const x = (time: number) => pad.left + ((time - from) / (span || 1)) * plotW;
      /* Candle x is activity-based, not wall-clock based. Each real interval
         owns one slot; absent intervals own no pixels and are called out by a
         break marker below. This is the same convention used to omit closed
         sessions on an exchange chart, made explicit because this venue is
         open continuously and its breaks are inactivity rather than closure. */
      const candleSlot = plotW / Math.max(1, bars.length);
      const candleX = (index: number) => pad.left + candleSlot * (index + .5);
      const rawLine = visiblePoints.map((point) => ({
        t: point.t, v: point.v, x: x(point.t), y: y(point.v),
      }));
      /* Thousands of trades can land in the same few screen pixels on a long
         window. Painting each one produces a solid purple column at the right
         edge, which is neither a price line nor useful density. A line is the
         closing print, so each eight-pixel time column keeps its last trade; the
         candle view remains the place that preserves highs and lows. */
      let plottedLine = rawLine;
      if (rawLine.length > Math.max(120, Math.floor(plotW / 8))) {
        plottedLine = [];
        let bucket = -1;
        let group: typeof rawLine = [];
        const flush = () => {
          if (!group.length) return;
          plottedLine.push(group[group.length - 1]);
        };
        for (const row of rawLine) {
          const nextBucket = Math.floor((row.x - pad.left) / 8);
          if (nextBucket !== bucket) { flush(); group = []; bucket = nextBucket; }
          group.push(row);
        }
        flush();
      }
      const deltas = visiblePoints.slice(1).map((point, index) => point.t - visiblePoints[index].t)
        .filter((value) => value > 0).sort((a, b) => a - b);
      const medianDelta = deltas.length ? deltas[Math.floor(deltas.length / 2)] : span;
      /* Downsampling increases the ordinary distance between kept points.
         Count that bucket width as continuity or a narrow/mobile chart turns
         every retained point into a one-point "segment" and the line vanishes. */
      const sampledBucketTime = span * 8 / Math.max(1, plotW);
      const lineBreakAfter = Math.max(60_000, span / 100, medianDelta * 4,
        sampledBucketTime * 1.5);
      const lineSegments: typeof plottedLine[] = [];
      for (const point of plottedLine) {
        const segment = lineSegments.at(-1);
        const previous = segment?.at(-1);
        if (!segment || (previous && point.t - previous.t > lineBreakAfter)) {
          lineSegments.push([point]);
        } else {
          segment.push(point);
        }
      }

      const hour = 3600_000; const day = 24 * hour;
      ctx.font = '9px "JetBrains Mono", ui-monospace, monospace';
      ctx.textBaseline = 'top';
      if (mode === 'candles' && bars.length) {
        const maxLabels = Math.max(2, Math.floor(plotW / 105));
        const labelCount = Math.min(bars.length, maxLabels);
        const indices = new Set<number>();
        for (let slot = 0; slot < labelCount; slot += 1) {
          indices.add(labelCount === 1 ? 0
            : Math.round(slot * (bars.length - 1) / (labelCount - 1)));
        }
        for (const index of [...indices].sort((a, b) => a - b)) {
          const px = candleX(index);
          ctx.strokeStyle = 'rgba(150,122,255,.12)'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(px, pad.top); ctx.lineTo(px, pad.top + plotH); ctx.stroke();
          ctx.fillStyle = 'rgba(128,138,164,.88)'; ctx.textAlign = 'center';
          const label = candleMs >= day
            ? new Date(bars[index].t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
            : new Date(bars[index].t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
          ctx.fillText(label, px, pad.top + plotH + 4);
        }
        /* An omitted interval is shown, never silently squeezed out. The cut
           occupies the seam between two real bar slots and says how much
           wall-clock time is missing when there is room for the label. */
        for (const gap of gaps) {
          const px = (candleX(gap.after) + candleX(gap.after + 1)) / 2;
          ctx.fillStyle = 'rgba(150,122,255,.035)';
          ctx.fillRect(px - 8, pad.top, 16, plotH);
          ctx.save();
          ctx.setLineDash([2, 4]); ctx.strokeStyle = 'rgba(150,159,184,.28)';
          ctx.beginPath(); ctx.moveTo(px, pad.top + 14); ctx.lineTo(px, pad.top + plotH - 14); ctx.stroke();
          ctx.restore();
          ctx.strokeStyle = 'rgba(214,200,162,.45)'; ctx.lineWidth = 1;
          for (const offset of [-3, 3]) {
            ctx.beginPath();
            ctx.moveTo(px - 4, pad.top + priceH / 2 + offset + 3);
            ctx.lineTo(px + 4, pad.top + priceH / 2 + offset - 3);
            ctx.stroke();
          }
          if (plotW >= 420 && gaps.length <= 4) {
            const label = `${chartDuration(gap.duration)} idle`;
            ctx.font = '8px "JetBrains Mono", ui-monospace, monospace';
            const labelW = ctx.measureText(label).width + 8;
            ctx.fillStyle = 'rgba(10,12,20,.9)';
            ctx.fillRect(px - labelW / 2, pad.top + priceH / 2 + 11, labelW, 13);
            ctx.fillStyle = 'rgba(150,159,184,.82)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(label, px, pad.top + priceH / 2 + 17.5);
          }
        }
      } else {
        const gridMs = span <= 45 * 60_000 ? 5 * 60_000
          : span <= 90 * 60_000 ? 15 * 60_000
          : span <= 4 * hour ? 30 * 60_000
          : span <= 13 * hour ? 2 * hour
          : span <= 25 * hour ? 4 * hour
          : span <= 8 * day ? day : 5 * day;
        for (let tick = Math.ceil(from / gridMs) * gridMs; tick <= to; tick += gridMs) {
          const px = x(tick);
          ctx.strokeStyle = 'rgba(150,122,255,.14)'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(px, pad.top); ctx.lineTo(px, pad.top + plotH); ctx.stroke();
          ctx.fillStyle = 'rgba(128,138,164,.88)'; ctx.textAlign = 'center';
          const label = span <= 25 * hour
            ? new Date(tick).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
            : new Date(tick).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
          ctx.fillText(label, px, pad.top + plotH + 4);
        }
      }
      /* A price axis, which the chart went without: four gridlines and no
         number on any of them, so the only readable price was whatever the bid
         and ask rules happened to land on. Every reading taken off a price
         chart is "how far is this from that", and that needs a scale. */
      ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      for (let index = 0; index <= 3; index += 1) {
        const py = pad.top + (priceH / 3) * index;
        ctx.strokeStyle = 'rgba(214,200,162,.07)';
        ctx.beginPath(); ctx.moveTo(pad.left, py); ctx.lineTo(pad.left + plotW, py); ctx.stroke();
        if (scaleValues.length) {
          ctx.fillStyle = 'rgba(128,138,164,.72)';
          /* Prices are integer quote atoms. The padded chart range and its
             thirds are display geometry, so their interpolation is usually
             fractional even though every real price is exact. Round the
             synthetic tick back to an atom before the token formatter turns
             it into a BigInt. */
          const tickPrice = Math.round(top - ((top - bottom) / 3) * index);
          ctx.fillText(format(tickPrice), pad.left + plotW + 5, py);
        }
      }

      /* Bid, ask and last, each with its own tag painted over the axis rather
         than beside it -- an unpainted label sat on top of the scale numbers
         and the two colours read as one string. */
      const rule = (value: number | undefined, colour: string, label: string, dash: number[]) => {
        if (!value) return;
        const exactY = y(value);
        const above = exactY < pad.top;
        const below = exactY > pad.top + priceH;
        const py = Math.max(pad.top, Math.min(pad.top + priceH, exactY));
        ctx.save();
        ctx.setLineDash(dash); ctx.strokeStyle = colour; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(pad.left, py); ctx.lineTo(pad.left + plotW, py); ctx.stroke();
        ctx.restore();
        /* Keep an off-scale live quote visible without letting it rescale the
           history. The arrow says which direction the actual price lies. */
        const text = `${label}${above ? '↑' : below ? '↓' : ''} ${format(value)}`;
        const boxW = Math.min(pad.right - 4, ctx.measureText(text).width + 8);
        ctx.fillStyle = 'rgba(10,12,20,.92)';
        ctx.fillRect(pad.left + plotW + 3, py - 6.5, boxW, 13);
        ctx.fillStyle = colour; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText(text, pad.left + plotW + 7, py);
      };
      const lastTrade = mode === 'candles' ? bars.at(-1)?.close : visiblePoints.at(-1)?.v;
      rule(lastTrade, mode === 'candles' ? 'rgba(214,200,162,.58)' : 'rgb(214,200,162)',
        'L', mode === 'candles' ? [2, 3] : [1, 0]);
      rule(bid, 'rgb(74,210,149)', 'B', [3, 3]);
      rule(ask, 'rgb(255,94,105)', 'A', [3, 3]);

      if (mode === 'candles' && bars.length) {
        const maxVolume = Math.max(1, ...bars.map((bar) => bar.volume));
        const volumeBottom = pad.top + plotH;
        const volumeHeight = plotH - priceH - 5;
        const bodyWidth = Math.max(bars.length > 120 ? 1 : 4, Math.min(16, candleSlot * .56));
        ctx.strokeStyle = 'rgba(214,200,162,.08)';
        ctx.beginPath(); ctx.moveTo(pad.left, pad.top + priceH + 3); ctx.lineTo(pad.left + plotW, pad.top + priceH + 3); ctx.stroke();
        for (const [index, bar] of bars.entries()) {
          const px = candleX(index);
          const rising = bar.close >= bar.open;
          const colour = rising ? 'rgb(74,210,149)' : 'rgb(255,94,105)';
          ctx.strokeStyle = colour; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(px, y(bar.high)); ctx.lineTo(px, y(bar.low)); ctx.stroke();
          const openY = y(bar.open); const closeY = y(bar.close);
          const bodyHeight = Math.abs(openY - closeY);
          if (bodyHeight < 1.5) {
            /* A flat OHLC interval is a doji, not an invisible one-pixel body.
               Centre it on the exact price so it does not lean down from it. */
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(px - bodyWidth / 2, openY); ctx.lineTo(px + bodyWidth / 2, openY); ctx.stroke();
          } else {
            ctx.fillStyle = rising ? 'rgba(74,210,149,.78)' : 'rgba(255,94,105,.78)';
            ctx.fillRect(px - bodyWidth / 2, Math.min(openY, closeY), bodyWidth, bodyHeight);
          }
          const volume = (bar.volume / maxVolume) * Math.max(1, volumeHeight);
          ctx.fillStyle = rising ? 'rgba(74,210,149,.18)' : 'rgba(255,94,105,.18)';
          ctx.fillRect(px - bodyWidth / 2, volumeBottom - volume, bodyWidth, volume);
        }
      } else if (plottedLine.length) {
        const gradient = ctx.createLinearGradient(0, pad.top, 0, pad.top + priceH);
        gradient.addColorStop(0, 'rgba(150,122,255,.3)');
        gradient.addColorStop(1, 'rgba(150,122,255,0)');
        const trace = (segment: typeof plottedLine) => {
          segment.forEach((point, index) => {
            if (index === 0) {
              ctx.moveTo(point.x, point.y);
            } else if (steppedLine) {
              ctx.lineTo(point.x, segment[index - 1].y);
              ctx.lineTo(point.x, point.y);
            } else {
              ctx.lineTo(point.x, point.y);
            }
          });
        };
        for (const segment of lineSegments) {
          if (segment.length > 1) {
            ctx.beginPath();
            trace(segment);
            ctx.lineTo(segment[segment.length - 1].x, pad.top + priceH);
            ctx.lineTo(segment[0].x, pad.top + priceH);
            ctx.closePath(); ctx.fillStyle = gradient; ctx.fill();
            ctx.beginPath();
            trace(segment);
            ctx.strokeStyle = 'rgb(214,200,162)'; ctx.lineWidth = 1.6; ctx.stroke();
          }
        }
        ctx.fillStyle = 'rgb(150,122,255)';
        if (plottedLine.length <= 80) {
          plottedLine.forEach((point) => ctx.fillRect(point.x - 1.5, point.y - 1.5, 3, 3));
        } else {
          for (const segment of lineSegments) {
            const point = segment.at(-1);
            if (point) ctx.fillRect(point.x - 2, point.y - 2, 4, 4);
          }
        }
      }

      if (pointer && pointer.x >= pad.left && pointer.x <= pad.left + plotW
          && pointer.y >= pad.top && pointer.y <= pad.top + plotH) {
        const candidates = mode === 'candles'
          ? bars.map((bar, index) => ({ t: bar.t + candleMs / 2, v: bar.close, bar, px: candleX(index) }))
          : plottedLine.map((point) => ({ t: point.t, v: point.v, bar: undefined, px: point.x }));
        if (candidates.length) {
          const pointerX = pointer.x;
          const nearest = candidates.reduce((best, row) => Math.abs(row.px - pointerX) < Math.abs(best.px - pointerX) ? row : best);
          const px = nearest.px; const py = y(nearest.v);
          ctx.save(); ctx.setLineDash([2, 3]); ctx.strokeStyle = 'rgba(214,200,162,.42)';
          ctx.beginPath(); ctx.moveTo(px, pad.top); ctx.lineTo(px, pad.top + plotH); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(pad.left, py); ctx.lineTo(pad.left + plotW, py); ctx.stroke(); ctx.restore();
          const timeLabel = new Date(nearest.t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
          const valueLabel = nearest.bar
            ? `O ${format(nearest.bar.open)}  H ${format(nearest.bar.high)}`
              + `  L ${format(nearest.bar.low)}  C ${format(nearest.bar.close)}`
            : `${format(nearest.v)} ${unit}`;
          const boxW = nearest.bar ? 212 : 148; const boxH = 34;
          const boxX = px + boxW + 12 > pad.left + plotW ? px - boxW - 8 : px + 8;
          const boxY = Math.max(pad.top + 3, Math.min(py - boxH - 7, pad.top + priceH - boxH));
          ctx.fillStyle = 'rgba(10,12,20,.94)'; ctx.fillRect(boxX, boxY, boxW, boxH);
          ctx.strokeStyle = 'rgba(150,122,255,.45)'; ctx.strokeRect(boxX + .5, boxY + .5, boxW - 1, boxH - 1);
          ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.font = '9px "JetBrains Mono", ui-monospace, monospace';
          ctx.fillStyle = 'rgba(150,159,184,.95)'; ctx.fillText(timeLabel, boxX + 7, boxY + 5);
          ctx.fillStyle = 'rgb(233,236,246)'; ctx.fillText(valueLabel, boxX + 7, boxY + 18);
        }
      }
    };

    const onMove = (event: MouseEvent) => {
      const rect = element.getBoundingClientRect();
      pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      draw();
    };
    const onLeave = () => { pointer = null; draw(); };
    const onWheel = (event: WheelEvent) => {
      /* Ordinary wheel motion keeps scrolling the page. Ctrl/Command-wheel is
         deliberate chart zoom (and what trackpad pinch reports), so a reader
         merely passing over the plot is never trapped. */
      if (!onZoom || (!event.ctrlKey && !event.metaKey)) return;
      event.preventDefault();
      const now = Date.now();
      if (now - lastWheelZoom.current < 220) return;
      lastWheelZoom.current = now;
      onZoom(event.deltaY < 0 ? 'in' : 'out');
    };
    element.addEventListener('mousemove', onMove);
    element.addEventListener('mouseleave', onLeave);
    element.addEventListener('wheel', onWheel, { passive: false });
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(frame);
    return () => {
      observer.disconnect();
      element.removeEventListener('mousemove', onMove);
      element.removeEventListener('mouseleave', onLeave);
      element.removeEventListener('wheel', onWheel);
    };
  }, [visiblePoints, bars, gaps, from, to, bid, ask, mode, candleMs, unit, format, onZoom, steppedLine]);

  const empty = mode === 'candles' ? bars.length === 0 : visiblePoints.length === 0;

  return (
    <div ref={host} className={cx('market-price-chart relative overflow-hidden rounded-[3px]', className)}>
      {mode === 'candles' && latestBar && (
        <div className="market-candle-readout" aria-hidden="true">
          <i>{bars.length} traded / {formatInteger(emptyIntervals)} empty</i>
          <span>O {format(latestBar.open)}</span><span>H {format(latestBar.high)}</span>
          <span>L {format(latestBar.low)}</span><span>C {format(latestBar.close)}</span>
          <span>V {formatInteger(latestBar.volume)}</span><span>N {formatInteger(latestBar.trades)}</span>
        </div>
      )}
      {steppedLine && visiblePoints.length > 0 && (
        <div className="market-line-readout" aria-hidden="true">
          Exact Gold steps · {formatInteger(visiblePriceLevels)} price {visiblePriceLevels === 1 ? 'level' : 'levels'}
        </div>
      )}
      <canvas ref={canvas} className="absolute inset-0 h-full w-full cursor-crosshair"
              tabIndex={0} title="Ctrl/Command-wheel or use + and − to zoom the time window"
              onKeyDown={(event) => {
                if ((event.key === '+' || event.key === '=') && onZoom) {
                  event.preventDefault(); onZoom('in');
                } else if ((event.key === '-' || event.key === '_') && onZoom) {
                  event.preventDefault(); onZoom('out');
                }
              }}
              role="img" aria-label={mode === 'candles'
                ? `Candlestick price chart with ${bars.length} traded intervals covering ${plottedTrades} trades. ${emptyIntervals} empty intervals are omitted and ${gaps.length} internal gap${gaps.length === 1 ? '' : 's'} ${gaps.length === 1 ? 'is' : 'are'} marked.`
                : `${steppedLine ? 'Stepped' : 'Line'} price chart with ${plottedTrades} recent trades across ${visiblePriceLevels} price levels`} />
      {empty && (
        <div className="market-chart-empty">
          <p>{emptyNote}</p>
          {emptyAction && (
            <button type="button" className="market-chart-control" onClick={emptyAction.onClick}>
              {emptyAction.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The strip that says this half is a market: what it last traded at, where it
 * sits now, and how much of it there has been.
 *
 * It takes rows rather than a book, because the external venue has every one of
 * these numbers and not one of them comes out of an `EconomyMarketStats`. Both
 * books use the same labels in the same order on purpose — that repetition is
 * the whole point of the strip.
 *
 * What is deliberately NOT in it is the bid and the ask. They are in the
 * top-of-book tiles, drawn across the chart as rules, and printed on the pair
 * trigger; a fourth copy on the same screen is what made a six-item strip read
 * as a wall.
 */
function BookTicker({ rows }: {
  rows: Array<{ label: string; value: string; tone?: 'good' | 'bad' }>;
}) {
  return (
    <dl className="market-ticker mt-2 flex flex-wrap gap-x-4 gap-y-1 border-y border-arcane/15 py-1.5">
      {rows.map((row) => <Tick key={row.label} label={row.label} tone={row.tone}>{row.value}</Tick>)}
    </dl>
  );
}

/* The tape strip's numbers.

   The address-free history projection supplies last price while daily bars
   supply the durable day/week totals. Raw fill parties never reach this
   component. The labels are the same on both venues on purpose; only `unit`
   differs. */
function bookTicks(
  book: EconomyMarketStats | undefined, candles: EconomyCandle[],
  points: PricePoint[], unit: FloorUnit,
) {
  /* Not bid and ask: they are two inches away in the top-of-book tiles, drawn
     across the chart as rules, and printed on the pair trigger. Three copies of
     the same two numbers is what made this strip hard to read. The mid is the
     one price nothing else was showing. */
  const twoSided = Boolean(book?.bestBid && book?.bestAsk);
  const mid = twoSided ? (book!.bestAsk! + book!.bestBid!) / 2 : undefined;
  const today = Math.floor(Date.now() / 86_400_000);
  const week = candles.filter((bar) => today - bar.d < 7);
  const last = points.at(-1)?.v ?? candles.at(-1)?.c;
  const closes = week.map((bar) => bar.c).sort((a, b) => a - b);
  const median = closes.length ? closes[Math.floor(closes.length / 2)] : undefined;
  return [
    { label: 'Last', value: last ? unit.format(last) : '--' },
    { label: 'Mid', value: mid ? unit.format(mid) : '--' },
    { label: 'Med 7d', value: median ? unit.format(median) : '--' },
    { label: 'Vol today', value: formatInteger(candles.find((bar) => bar.d === today)?.v ?? 0) },
    { label: 'Vol 7d', value: formatInteger(week.reduce((sum, bar) => sum + bar.v, 0)) },
    { label: 'Trades 7d', value: formatInteger(week.reduce((sum, bar) => sum + bar.n, 0)) },
  ];
}

function Tick({ label, children, tone }: { label: string; children: React.ReactNode; tone?: 'good' | 'bad' }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-[9px] uppercase tracking-[0.16em] text-faint">{label}</dt>
      <dd className={cx('font-mono text-xs', tone === 'good' ? 'text-good' : tone === 'bad' ? 'text-bad' : 'text-ink')}>
        {children}
      </dd>
    </div>
  );
}

/** The pixel art where there is any, the Rune mark where there is not. */
function ItemGlyph({ item, className }: { item: GoldMarketItemId; className?: string }) {
  const art = ITEM_ART[item];
  return art
    ? <img src={art} alt="" className={cx('shrink-0 object-contain [image-rendering:pixelated]', className)} />
    : <Rune className={cx('shrink-0 text-element', className)} />;
}

function Stepper({ value, max, onChange, label }: {
  value: number; max: number; onChange: (value: number) => void; label: string;
}) {
  const clamp = (next: number) => onChange(Math.max(1, Math.min(max, Math.floor(next) || 1)));
  const step = 'grid w-7 shrink-0 place-items-center text-sm text-muted transition-colors ' +
    'hover:bg-raised hover:text-ink disabled:pointer-events-none disabled:opacity-30';
  return (
    <div className="flex items-stretch overflow-hidden rounded-[3px] border border-edge bg-void/35">
      <button type="button" className={step} aria-label={`One fewer, ${label}`}
              disabled={value <= 1} onClick={() => clamp(value - 1)}>&minus;</button>
      <input aria-label={label} inputMode="numeric" value={value}
             onChange={(event) => clamp(Number(event.target.value.replace(/\D/g, '')))}
             className="w-8 min-w-0 border-x border-edge bg-transparent text-center font-mono text-xs text-ink outline-none" />
      <button type="button" className={step} aria-label={`One more, ${label}`}
              disabled={value >= max} onClick={() => clamp(value + 1)}>+</button>
    </div>
  );
}

function BookPrice({ label, value, tone, unit, format }: {
  label: string; value?: number; tone: 'good' | 'bad'; unit: string;
  format: (value: number) => string;
}) {
  return (
    <div className="min-w-0 bg-void/25 px-3 py-2">
      <div className="eyebrow">{label}</div>
      <div className={cx('mt-1 truncate font-mono text-lg leading-none',
        value ? (tone === 'good' ? 'text-good' : 'text-bad') : 'text-faint')}>
        {value ? format(value) : '--'} <span className="eyebrow">{unit}</span>
      </div>
    </div>
  );
}

/**
 * The gap, between the two prices it is the gap between.
 *
 * Absolute and in basis points, because neither one alone travels: 2 Gold is
 * wide on a berry and invisible on a Rune, and 40 bps means the same thing on
 * both books and on the token book quoted in six decimals.
 */
function BookSpread({ bid, ask, format }: {
  bid?: number; ask?: number; format: (value: number) => string;
}) {
  const open = Boolean(bid && ask && ask > bid);
  const spread = open ? ask! - bid! : undefined;
  const mid = open ? (ask! + bid!) / 2 : undefined;
  const bps = spread && mid ? Math.round((spread / mid) * 10_000) : undefined;
  return (
    <div className="market-spread-cell" title={mid ? `Mid ${format(mid)}` : 'One side of the book is empty'}>
      <div className="eyebrow">Spread</div>
      <div className={cx('market-spread-value', !open && 'text-faint')}>
        {spread === undefined ? '--' : format(spread)}
      </div>
      <div className="market-spread-bps">{bps === undefined ? 'one-sided' : `${formatInteger(bps)} bps`}</div>
    </div>
  );
}

type MarketDepthRow = { price: number; quantity: number; orders?: number; house?: number };

function aggregateDepth(rows: MarketDepthRow[], tone: 'good' | 'bad') {
  const levels = new Map<number, { price: number; quantity: number; orders: number; house: number }>();
  for (const row of rows) {
    const level = levels.get(row.price) ?? { price: row.price, quantity: 0, orders: 0, house: 0 };
    level.quantity += row.quantity;
    level.orders += row.orders ?? 1;
    level.house += row.house ?? 0;
    levels.set(row.price, level);
  }
  return [...levels.values()].sort((a, b) => tone === 'good' ? b.price - a.price : a.price - b.price);
}

/** Half the depth chart's narrowest price window, as a fraction of mid. */
const DEPTH_MIN_HALF_WINDOW = .15;
/** And its widest. Past this a level is clamped to the edge, not drawn to. */
const DEPTH_MAX_HALF_WINDOW = .75;

/** Cumulative market depth: bid liquidity grows left, ask liquidity grows right. */
function DepthMountain({ bids: rawBids, asks: rawAsks, unit, format, className }: {
  bids: MarketDepthRow[]; asks: MarketDepthRow[]; className?: string;
  unit: string; format: (value: number) => string;
}) {
  const bids = aggregateDepth(rawBids, 'good').slice(0, 10);
  const asks = aggregateDepth(rawAsks, 'bad').slice(0, 10);
  const prices = [...bids, ...asks].map((row) => row.price);
  if (!prices.length) return <div className={cx('market-depth-mountain grid place-items-center text-xs text-faint', className)}>No resting liquidity</div>;

  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const twoSided = bids.length > 0 && asks.length > 0;
  const reference = twoSided
    ? (bids[0].price + asks[0].price) / 2
    : bids.length ? bids[0].price : asks[0].price;
  const wanted = Math.max(
    maxPrice - reference, reference - minPrice,
    reference * DEPTH_MIN_HALF_WINDOW, 1,
  );
  const half = Math.min(wanted, reference * DEPTH_MAX_HALF_WINDOW) || 1;
  const lowPrice = Math.max(0, reference - half);
  const highPrice = reference + half;
  const clippedLow = minPrice < lowPrice;
  const clippedHigh = maxPrice > highPrice;
  const priceSpan = highPrice - lowPrice || 1;
  const x = (price: number) =>
    Math.max(5, Math.min(95, 5 + ((price - lowPrice) / priceSpan) * 90));
  const bidTotal = bids.reduce((sum, row) => sum + row.quantity, 0);
  const askTotal = asks.reduce((sum, row) => sum + row.quantity, 0);
  const maxDepth = Math.max(1, bidTotal, askTotal);
  const y = (quantity: number) => 88 - (quantity / maxDepth) * 72;
  const referenceX = x(reference);
  const steps = (levels: typeof bids, side: 'bid' | 'ask') => {
    let cumulative = 0;
    return levels.map((row, index) => {
      cumulative += row.quantity;
      const here = x(row.price);
      const next = levels[index + 1];
      const outer = next ? x(next.price) : side === 'bid' ? 5 : 95;
      return {
        from: Math.min(here, outer), to: Math.max(here, outer),
        y: y(cumulative), side,
      };
    });
  };
  const steppedArea = (rows: ReturnType<typeof steps>) => {
    const ordered = rows.filter((row) => row.to - row.from > .01)
      .sort((a, b) => a.from - b.from);
    if (!ordered.length) return '';
    let path = `M${ordered[0].from.toFixed(2)} 88`;
    for (const row of ordered) {
      path += ` L${row.from.toFixed(2)} ${row.y.toFixed(2)} L${row.to.toFixed(2)} ${row.y.toFixed(2)}`;
    }
    return `${path} L${ordered.at(-1)!.to.toFixed(2)} 88 Z`;
  };
  const bidSteps = steps(bids, 'bid');
  const askSteps = steps(asks, 'ask');
  const bestBidX = bids.length ? x(bids[0].price) : undefined;
  const bestAskX = asks.length ? x(asks[0].price) : undefined;
  const referenceLabel = twoSided ? 'mid' : bids.length ? 'best bid' : 'best ask';

  return (
    <div className={cx('market-depth-mountain relative overflow-hidden rounded-[3px]', className)}
         role="img" aria-label={`${formatInteger(bidTotal)} bid units and ${formatInteger(askTotal)} ask units in visible depth`}>
      <div className="market-depth-caption"><span className="text-good">{formatInteger(bidTotal)} bid units</span><span>Cumulative depth</span><span className="text-bad">{formatInteger(askTotal)} ask units</span></div>
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {[28, 48, 68, 88].map((line) => <path key={line} d={`M5 ${line}H95`} stroke="rgb(var(--rune) / .07)" vectorEffect="non-scaling-stroke" />)}
        {bestBidX !== undefined && bestAskX !== undefined && bestAskX > bestBidX && (
          <rect x={bestBidX} y="10" width={bestAskX - bestBidX} height="78" fill="rgb(var(--arcane) / .055)" />
        )}
        {bidSteps.length > 0 && <path d={steppedArea(bidSteps)} fill="rgb(var(--good) / .15)" stroke="rgb(var(--good) / .78)" strokeWidth="1.3" vectorEffect="non-scaling-stroke" />}
        {askSteps.length > 0 && <path d={steppedArea(askSteps)} fill="rgb(var(--bad) / .14)" stroke="rgb(var(--bad) / .78)" strokeWidth="1.3" vectorEffect="non-scaling-stroke" />}
        {bestBidX !== undefined && <path d={`M${bestBidX} 10V88`} stroke="rgb(var(--good) / .38)" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />}
        {bestAskX !== undefined && <path d={`M${bestAskX} 10V88`} stroke="rgb(var(--bad) / .38)" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />}
        {twoSided && <path d={`M${referenceX} 8V88`} stroke="rgb(var(--arcane) / .5)" vectorEffect="non-scaling-stroke" />}
      </svg>
      <div className="market-depth-axis">
        <span>{clippedLow ? '≤ ' : ''}{format(Math.round(lowPrice))} {unit}</span>
        <span>{referenceLabel} {format(Math.round(reference))} {unit}</span>
        <span>{clippedHigh ? '≥ ' : ''}{format(Math.round(highPrice))} {unit}</span>
      </div>
    </div>
  );
}

/** How many levels each ladder wall shows. */
const DEPTH_LADDER_ROWS = 8;

function ladderScale(bids: MarketDepthRow[], asks: MarketDepthRow[]): number {
  const side = (rows: MarketDepthRow[], tone: 'good' | 'bad') =>
    aggregateDepth(rows, tone).slice(0, DEPTH_LADDER_ROWS)
      .reduce((sum, row) => sum + row.quantity, 0);
  return Math.max(1, side(bids, 'good'), side(asks, 'bad'));
}

/** Mirrored cumulative price wall beneath the depth mountain. */
function DepthList({ label, rows, tone, onPick, action, unit, format, formatSize, houseNote, scale }: {
  label: string; tone: 'good' | 'bad'; rows: MarketDepthRow[];
  onPick: (price: number) => void; action: string;
  unit: string; format: (value: number) => string; formatSize?: (value: number) => string;
  scale?: number;
  houseNote?: (row: { quantity: number; orders: number; house: number }) => string;
}) {
  const levels = aggregateDepth(rows, tone).slice(0, DEPTH_LADDER_ROWS);
  let running = 0;
  const shown = levels.map((row) => ({ ...row, cumulative: running += row.quantity }));
  const peak = scale ?? Math.max(1, ...shown.map((row) => row.cumulative));
  const size = formatSize ?? formatInteger;
  const note = houseNote ?? ((row: { quantity: number; orders: number; house: number }) =>
    (row.house >= row.quantity
      ? `${formatInteger(row.house)} units quoted by the realm's desk`
      : `${formatInteger(row.orders)} resting ${row.orders === 1 ? 'order' : 'orders'}`
        + (row.house ? `, plus ${formatInteger(row.house)} from the realm's desk` : '')));
  return (
    <div className="min-w-0">
      <div className="eyebrow mb-2">{label}</div>
      {shown.length ? (
        <ul className="space-y-1">
          {shown.map((row, index) => (
            <li key={`${row.price}-${index}`}>
              <button type="button"
                      title={`${action} at ${format(row.price)} ${unit} — ${size(row.cumulative)} cumulative to here`}
                      onClick={() => onPick(row.price)}
                      className={cx('market-depth-row', tone === 'good' && 'is-bid')}>
                <span aria-hidden="true"
                      className={cx('absolute inset-y-0', tone === 'good' ? 'right-0 bg-good/10' : 'left-0 bg-bad/10')}
                      style={{ width: `${Math.min(100, (row.cumulative / peak) * 100)}%` }} />
                <span className={cx('relative', tone === 'good' ? 'text-good' : 'text-bad')}>{format(row.price)}</span>
                <span className="relative text-faint" title={note(row)}>
                  &times; {size(row.quantity)}
                  {row.house > 0 && <b className="market-depth-house" aria-label="realm desk">&#9670;</b>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : <p className="text-xs text-faint">No depth</p>}
    </div>
  );
}
/**
 * The tape: what actually traded, newest first.
 *
 * The book has never had one, for a good reason -- a venue publishing its raw
 * fills would pay 282 bytes a row, five times over, on every message it ever
 * receives, and most of that is two addresses nobody may see. `venuetape`
 * publishes the readable quarter instead: when, at what price, how many, and
 * which side took, as four integers.
 *
 * Colour is the TAKER's side, which is the convention everywhere and is the
 * one thing a printed price does not tell you: green means somebody lifted an
 * ask, red means somebody hit a bid. It is not "the price went up".
 */
function RecentTrades({ trades, unit }: { trades: VenueTrade[]; unit: FloorUnit }) {
  const rows = [...trades].reverse().slice(0, 24);
  return (
    <div className="market-tape mt-3 flex min-h-0 flex-1 flex-col">
      <div className="eyebrow mb-2 flex items-baseline justify-between gap-2">
        <span>Recent trades</span>
        <span className="market-tape-legend">taker side</span>
      </div>
      {rows.length ? (
        <>
          <div className="market-tape-columns" aria-hidden="true">
            <span>Side</span><span>Price</span><span>Qty</span><span>Total</span><span>Time</span>
          </div>
          <ol className="min-h-0 flex-1 space-y-px overflow-y-auto">
            {rows.map(([at, price, quantity, takerBought], index) => (
              <li key={`${at}-${price}-${quantity}-${index}`} className="market-tape-row">
                <b className={takerBought ? 'text-good' : 'text-bad'}>
                  {takerBought ? 'Buy' : 'Sell'}
                </b>
                <span className={takerBought ? 'text-good' : 'text-bad'}>{unit.format(price)}</span>
                <span className="text-muted">{formatInteger(quantity)}</span>
                <span className="text-muted">
                  {Number.isSafeInteger(price * quantity) ? unit.format(price * quantity) : '—'}
                </span>
                <time dateTime={new Date(at * 1000).toISOString()} className="text-faint"
                      title={new Date(at * 1000).toLocaleString()}>
                  {new Date(at * 1000).toLocaleTimeString(undefined,
                    { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </time>
              </li>
            ))}
          </ol>
        </>
      ) : (
        <p className="text-xs text-faint">Nothing has traded on this book yet.</p>
      )}
    </div>
  );
}

// Monster market ------------------------------------------------------------

/**
 * The listings are the cards, and nothing else.
 *
 * A card already prints its name, faction, element, level and four stats, in
 * the layout the worker composites and the buyer will own. Repeating all of it
 * in HTML underneath doubled the height of every tile, pushed the grid down to
 * one visible listing, and said the same thing twice in two typefaces. What is
 * left under the art is the only thing the picture cannot tell you: the asking
 * price. Clicking the card picks it up — the same held, turnable object the
 * collection uses — and the buy is repeated there.
 *
 * The stats have not gone anywhere: they are what the sort and the element
 * filter run on.
 */
function MonsterMarket() {
  const { address, player, connect, connecting, run, isPending } = useGame();
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [history, setHistory] = useState<Sale[]>([]);
  const [stats, setStats] = useState<{ listings: number; sales: number } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [query, setQuery] = useState('');
  const [element, setElement] = useState<Element | 'all'>('all');
  const [sort, setSort] = useState<MonsterSort>('recent');
  const [listingOpen, setListingOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [held, setHeld] = useState<Listing | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setError(null);
    try {
      const [market, sales, marketStats] = await Promise.all([
        game.readMarket({ signal }),
        game.readMarketHistory({ signal }).catch(() => []),
        game.readMarketStats({ signal }).catch(() => null),
      ]);
      if (signal?.aborted) return;
      const rows = Object.values(market ?? {});
      setListings(rows);
      setHistory(sales ?? []);
      setStats(marketStats ?? { listings: rows.length, sales: sales?.length ?? 0 });
    } catch (caught) {
      if (isAbort(caught)) return;
      setError(caught);
      setListings([]);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const owned = useMemo(() => Object.values(player?.collection ?? {}), [player?.collection]);
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (listings ?? []).filter((listing) => {
      const monster = listing.monster;
      if (element !== 'all' && monster.elementType !== element) return false;
      return !needle || [monster.name, monster.faction, listing.seller]
        .some((value) => String(value ?? '').toLowerCase().includes(needle));
    }).sort((a, b) => {
      if (sort === 'price-low') return a.price - b.price;
      if (sort === 'price-high') return b.price - a.price;
      if (sort === 'attack') return b.monster.attack - a.monster.attack || a.price - b.price;
      if (sort === 'defense') return b.monster.defense - a.monster.defense || a.price - b.price;
      if (sort === 'level') return b.monster.level - a.monster.level || a.price - b.price;
      return b.listedAt - a.listedAt;
    });
  }, [element, listings, query, sort]);

  const floor = listings?.length ? Math.min(...listings.map((listing) => listing.price)) : 0;
  const totalVolume = history.reduce((sum, sale) => sum + sale.price, 0);
  const average = history.length ? Math.round(totalVolume / history.length) : 0;
  const saleSeries = [...history].reverse().map((sale) => sale.price);
  const runeBalance = player?.inventory?.rune ?? 0;

  const cancel = async (listing: Listing) => {
    const result = await run(`cancel-${listing.id}`, () => game.cancelListing(listing.id),
      `${listing.monster.name} returned to your collection.`);
    if (result) { setHeld(null); await load(); }
  };

  const buy = async (listing: Listing) => {
    const result = await run(`buy-${listing.id}`, () => game.buyListing(listing.id),
      `${listing.monster.name} joined your collection.`);
    if (result) { setHeld(null); await load(); }
  };

  return (
    <div className="market-monsters space-y-3">
      <Panel className="p-3">
        <div className="grid gap-2.5 xl:grid-cols-[minmax(11rem,1fr)_auto_auto] xl:items-center">
          <input className={inputClass} value={query} onChange={(event) => setQuery(event.target.value)}
                 aria-label="Search monster listings" placeholder="Search monster, faction, or trainer" />
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="eyebrow mr-0.5 hidden sm:inline">Type</span>
            <FilterChip active={element === 'all'} onClick={() => setElement('all')}>All</FilterChip>
            {ELEMENTS.map((value) => {
              const Icon = ELEMENT_ICON[value];
              return (
                <FilterChip key={value} element={value} active={element === value}
                            onClick={() => setElement(value)}>
                  <Icon className="h-3.5 w-3.5" />{ELEMENT_LABEL[value]}
                </FilterChip>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select className={cx(inputClass, 'min-w-0 flex-1 xl:w-48 xl:flex-none')} value={sort}
                    onChange={(event) => setSort(event.target.value as MonsterSort)} aria-label="Sort monster listings">
              <option value="recent">Recently listed</option>
              <option value="price-low">Cheapest first</option>
              <option value="price-high">Dearest first</option>
              <option value="attack">Highest attack</option>
              <option value="defense">Highest defense</option>
              <option value="level">Highest level</option>
            </select>
            <Button size="sm" title="Refresh market" onClick={() => void load()}
                    icon={<Refresh className="h-4 w-4" />}>Refresh</Button>
            <Button size="sm" variant="quiet" onClick={() => setStatsOpen(true)}>Stats</Button>
            <Button size="sm" variant="primary" busy={!address && connecting}
                    disabled={Boolean(address) && !owned.length}
                    onClick={() => address ? setListingOpen(true) : connect()}>
              {address ? `Sell (${owned.length})` : 'Connect to sell'}
            </Button>
          </div>
        </div>
      </Panel>

      <div className="market-monsters-scroll space-y-3">
        {error !== null && <ErrorNote error={error} onRetry={() => void load()} />}
        {listings === null ? (
          <div className="market-listing-grid">
            {[0, 1, 2, 3, 4, 5].map((key) => <Skeleton key={key} className="aspect-[648/1180]" />)}
          </div>
        ) : shown.length === 0 ? (
          <Panel>
            <Empty icon={<Sparkle />} title={listings.length ? 'No matching monsters' : 'No monsters listed'}
                   action={address && owned.length ? <Button variant="primary" onClick={() => setListingOpen(true)}>List yours</Button> : undefined}>
              {listings.length ? 'Change the filters.' : 'List a monster from your collection.'}
            </Empty>
          </Panel>
        ) : (
          <div className="market-listing-grid">
            {shown.map((listing) => (
              <MonsterListingCard key={listing.id} listing={listing} mine={listing.seller === address}
                                  affordable={runeBalance >= listing.price}
                                  connected={Boolean(address)}
                                  busy={isPending(`buy-${listing.id}`) || isPending(`cancel-${listing.id}`)}
                                  onInspect={() => setHeld(listing)}
                                  onTrade={() => {
                                    if (!address) { connect(); return; }
                                    if (listing.seller === address) void cancel(listing);
                                    else void buy(listing);
                                  }} />
            ))}
          </div>
        )}
      </div>

      {statsOpen && (
        <Dialog title="Monster market stats" onClose={() => setStatsOpen(false)}>
          <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-[3px] border border-rune/10 bg-rune/10 p-px sm:grid-cols-4">
            <MonsterStat label="Listings" value={formatInteger(stats?.listings ?? listings?.length ?? 0)} title="Live listings in contract escrow" />
            <MonsterStat label="Floor" value={floor ? `${formatInteger(floor)} Rune` : '--'} title="Lowest current ask" />
            <MonsterStat label="Volume" value={`${formatInteger(totalVolume)} Rune`} title={`${stats?.sales ?? history.length} completed trades`} />
            <MonsterStat label="Average" value={average ? `${formatInteger(average)} Rune` : '--'} title="Average recorded sale" />
          </div>
          <LineChart values={saleSeries} empty="No completed sales." suffix=" Rune" className="mt-4 h-52" />
          {history.length > 0 && (
            <div className="mt-4 max-h-52 divide-y divide-rune/10 overflow-y-auto rounded-[3px] border border-rune/10">
              {history.slice(0, 12).map((sale) => <SaleRow key={`${sale.id}-${sale.soldAt}`} sale={sale} />)}
            </div>
          )}
        </Dialog>
      )}

      {listingOpen && (
        <ListMonsterDialog monsters={owned} busy={isPending('market-list')} onClose={() => setListingOpen(false)}
          onSubmit={async (monsterId, price) => {
            const monster = owned.find((candidate) => candidate.id === monsterId);
            const result = await run('market-list', () => game.listMonster(monsterId, price),
              `${monster?.name ?? 'Monster'} listed for ${formatInteger(price)} Rune.`);
            if (result) { setListingOpen(false); await load(); }
          }} />
      )}

      {held && (
        <CardViewer monster={held.monster} onClose={() => setHeld(null)}
          footer={
            <div className="flex items-center gap-3 rounded-[3px] border border-edge bg-surface/90 px-4 py-2.5 backdrop-blur">
              <span className="flex items-baseline gap-1.5">
                <span className={cx('font-mono text-xl', runeBalance >= held.price || held.seller === address ? 'text-rune' : 'text-bad')}>
                  {formatInteger(held.price)}
                </span>
                <span className="eyebrow">rune</span>
              </span>
              {!address ? (
                <Button variant="primary" busy={connecting} onClick={connect} icon={<Wallet className="h-4 w-4" />}>Connect to buy</Button>
              ) : held.seller === address ? (
                <Button busy={isPending(`cancel-${held.id}`)} onClick={() => void cancel(held)}>Cancel listing</Button>
              ) : (
                <Button variant="primary" busy={isPending(`buy-${held.id}`)} disabled={runeBalance < held.price}
                        onClick={() => void buy(held)}>
                  {runeBalance >= held.price ? 'Buy' : `Need ${formatInteger(held.price - runeBalance)} more`}
                </Button>
              )}
            </div>
          } />
      )}
    </div>
  );
}

function MonsterListingCard({ listing, mine, busy, affordable, connected, onInspect, onTrade }: {
  listing: Listing; mine: boolean; busy: boolean; affordable: boolean; connected: boolean;
  onInspect: () => void; onTrade: () => void;
}) {
  const monster = listing.monster;
  const blocked = connected && !mine && !affordable;
  return (
    <Panel data-element={monster.elementType} className="market-monster-card group flex flex-col overflow-hidden">
      <button type="button" onClick={onInspect} aria-label={`Inspect ${monster.name}`}
              className="block w-full bg-void/40 p-2 outline-none focus-visible:bg-element/10">
        <CardPreview monster={monster}
                     className="mx-auto w-full transition-transform duration-500 group-hover:scale-[1.025]" />
      </button>
      <div className="mt-auto flex items-center justify-between gap-2 border-t border-rune/10 px-3 py-2.5">
        <span className="flex items-baseline gap-1">
          <span className={cx('font-mono text-lg leading-none', blocked ? 'text-bad' : 'text-rune')}>
            {formatInteger(listing.price)}
          </span>
          <span className="eyebrow">rune</span>
        </span>
        <Button size="sm" variant={mine ? 'ghost' : 'primary'} busy={busy} disabled={blocked}
                title={blocked ? 'Not enough Rune' : undefined} onClick={onTrade}>
          {mine ? 'Cancel' : connected ? 'Buy' : 'Connect'}
        </Button>
      </div>
    </Panel>
  );
}

function SaleRow({ sale }: { sale: Sale }) {
  const Icon = ELEMENT_ICON[sale.element];
  return (
    <div data-element={sale.element} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:px-5">
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[3px] border border-element/35 bg-element/10 text-element"><Icon className="h-4 w-4" /></span>
        <span className="min-w-0"><b className="block truncate text-sm">{sale.name}</b><span className="text-[11px] text-faint">Level {sale.level} / {relativeTime(sale.soldAt)}</span></span>
      </div>
      <div className="hidden items-center gap-2 font-mono text-[11px] text-faint sm:flex">
        {shortAddress(sale.seller, 4)} <Arrow className="h-3 w-3" /> {shortAddress(sale.buyer, 4)}
      </div>
      <div className="text-right font-mono text-sm text-rune">{formatInteger(sale.price)} Rune</div>
    </div>
  );
}

function ListMonsterDialog({ monsters, busy, onClose, onSubmit }: {
  monsters: Monster[]; busy: boolean; onClose: () => void; onSubmit: (monsterId: string, price: number) => Promise<void>;
}) {
  const [monsterId, setMonsterId] = useState(monsters[0]?.id ?? '');
  const [price, setPrice] = useState('');
  const [validation, setValidation] = useState('');
  const selected = monsters.find((monster) => monster.id === monsterId);
  const submit = () => {
    const amount = Number(price);
    if (!Number.isInteger(amount) || amount < 1 || amount > 1_000_000) {
      setValidation('Enter a whole Rune price between 1 and 1,000,000.');
      return;
    }
    setValidation('');
    void onSubmit(monsterId, amount);
  };
  return (
    <Dialog title="List a collection monster" onClose={onClose} busy={busy} element={selected?.elementType}>
      {selected && <CardPreview monster={selected} eager className="mx-auto mt-4 w-36" />}
      <div className="mt-4 space-y-3">
        <label className="block"><span className="eyebrow mb-1.5 block">Monster</span>
          <select className={inputClass} value={monsterId} onChange={(event) => setMonsterId(event.target.value)}>
            {monsters.map((monster) => <option key={monster.id} value={monster.id}>{monster.name} / level {monster.level}</option>)}
          </select>
        </label>
        <label className="block"><span className="eyebrow mb-1.5 block">Price in Rune</span>
          <input className={inputClass} inputMode="numeric" value={price} onChange={(event) => setPrice(event.target.value)} placeholder="250" />
        </label>
        {validation && <p className="text-xs text-bad">{validation}</p>}
        <div className="flex justify-end gap-2 pt-1"><Button onClick={onClose} disabled={busy}>Keep it</Button><Button variant="primary" busy={busy} disabled={!monsterId} onClick={submit}>List monster</Button></div>
      </div>
    </Dialog>
  );
}

// Rune exchange -------------------------------------------------------------

// The external book ---------------------------------------------------------

/**
 * A client-only venue for judging the instrument instead of its liquidity.
 *
 * The live TEST books are intentionally honest and therefore thin: their
 * chart can only show the trades people actually made. Chart Lab feeds the
 * exact same `TradingFloor` four deterministic profiles that exercise dense
 * candles, long idle gaps, violent ranges and flat doji bars. No process id,
 * wallet method or write function is reachable from this component.
 */
function ChartLab() {
  const [clock] = useState(() => Math.floor(Date.now() / 30_000) * 30_000);
  const markets = useMemo(() => buildChartLab(clock), [clock]);
  const [marketId, setMarketId] = useState(() => markets[0]?.id ?? '');
  const market = markets.find((row) => row.id === marketId) ?? markets[0];

  const [range, setRange] = useState<FloorRange>('3h');
  const [chartMode, setChartMode] = useState<ChartMode>('candles');
  const [candleInterval, setCandleInterval] = useState<CandleInterval>('5m');
  const [side, setSide] = useState<GoldOrderSide>('buy');
  const [tif, setTif] = useState<GoldOrderTif>('GTC');
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('12');

  if (!market) return null;

  const totalVolume = market.points.reduce((sum, point) => sum + point.q, 0);
  const ownOrders: EconomyOrder[] = [
    {
      id: 'LAB-BID', seq: 1, account: 'chart-lab', side: 'buy', item: market.item,
      price: market.book.bestBid ?? 1, quantity: 24, remaining: 18,
      createdAt: clock - 18 * 60_000, expiresAt: clock + 29 * 24 * 3600_000,
      market: market.id, lot: 1,
    },
    {
      id: 'LAB-ASK', seq: 2, account: 'chart-lab', side: 'sell', item: market.item,
      price: market.book.bestAsk ?? 1, quantity: 16, remaining: 9,
      createdAt: clock - 11 * 60_000, expiresAt: clock + 29 * 24 * 3600_000,
      market: market.id, lot: 1,
    },
  ];
  const recentFills: PlayerFill[] = [...market.trades].slice(-8).reverse()
    .map(([at, value, count, takerBought], index) => ({
      id: `LAB-F${index + 1}`, market: market.id, item: market.item,
      side: takerBought ? 'buy' : 'sell', price: value, quantity: count,
      gross: value * count, fee: 0, filledAt: at * 1000,
      role: index % 3 === 0 ? 'maker' : 'taker',
    }));

  const reset = () => {
    setRange('3h'); setChartMode('candles'); setCandleInterval('5m');
    setSide('buy'); setTif('GTC'); setPrice(''); setQuantity('12');
  };

  return (
    <div className="market-goods market-chart-lab">
      <TradingFloor
        demo book={market.book} candles={market.candles} points={market.points}
        trades={market.trades} unit={GOLD_UNIT}
        ticks={bookTicks(market.book, market.candles, market.points, GOLD_UNIT)}
        config={{ minValue: 10, takerBps: 30, creationCost: 0 }}
        lead={(
          <MarketPicker value={market.id} onPick={setMarketId} format={GOLD_UNIT.format}
                        glyph={(id) => (
                          <ItemGlyph item={markets.find((row) => row.id === id)?.item ?? 'rune'}
                                     className="h-4 w-4" />
                        )}
                        markets={markets.map((row) => ({
                          id: row.id, label: row.label,
                          bestBid: row.book.bestBid, bestAsk: row.book.bestAsk,
                        }))} />
        )}
        actions={<>
          <Badge tone="element">Synthetic · local only</Badge>
          <Button size="sm" variant="quiet" icon={<Refresh className="h-3.5 w-3.5" />}
                  onClick={reset}>Reset view</Button>
        </>}
        extraStats={[
          { label: 'Synthetic fills', value: formatInteger(market.points.length), tone: 'text-good' },
          { label: 'Traded volume', value: formatInteger(totalVolume), tone: 'text-arcane' },
          { label: 'Source', value: 'LOCAL', tone: 'text-rune' },
        ]}
        address="chart-lab" quoteBalance={250_000} baseBalance={5_000} item={market.item}
        range={range} onRange={setRange}
        chartMode={chartMode} onChartMode={setChartMode}
        candleInterval={candleInterval} onCandleInterval={setCandleInterval}
        side={side} onSide={setSide} tif={tif} onTif={setTif}
        price={price} onPrice={setPrice} quantity={quantity} onQuantity={setQuantity}
        ownOrders={ownOrders} recentFills={recentFills}
        connecting={false} onConnect={() => undefined}
        isPending={() => false} onSubmit={() => undefined}
        onCancel={() => undefined} onCancelAll={() => undefined}
        onAmend={async () => undefined} />
    </div>
  );
}

/**
 * The trading floor, over a custody venue.
 *
 * One component for both deployments, because they run the same `venue.lua`
 * and are therefore the same instrument: the same ladder, the same ticket, the
 * same price-time priority. What differs is what funds them -- game goods and
 * Gold on the internal one, wallet tokens on the external one -- so the only
 * things this branches on are the `unit` a price is written in and how an
 * asset gets INTO custody. Everything a trader looks at is the same screen.
 *
 * Custody is the one thing the old in-game book did not have. A venue holds
 * what it matches, so an order needs a balance deposited here first, and the
 * strip under the ladder is where that happens. `Cancel` frees escrow at once;
 * `Withdraw` moves out only what no live order is holding.
 */
function VenueFloor({ mode, prefill }: {
  mode: 'internal' | 'external';
  prefill?: FloorPrefill;
}) {
  const { address, player, connect, run: runGame, node } = useGame();
  const process = mode === 'internal' ? INTERNAL_VENUE_PROCESS : EXTERNAL_VENUE_PROCESS;
  const outsideBalances = useMemo<Record<string, string | number> | undefined>(() => {
    if (mode !== 'internal') return undefined;
    return { gold: player?.gold ?? 0, ...(player?.inventory ?? {}) };
  }, [mode, player?.gold, player?.inventory]);

  const host = useMemo<OrderbookHost>(() => ({
    account: address,
    connect: async () => {
      await connect();
      return address;
    },
    execute: async (action, success) => {
      const result = await runGame(`orderbook-${mode}`, action, success);
      if (result === null) throw new Error('The orderbook action did not settle.');
      return result;
    },
    send: (target, tags, options = {}) => sendAo(tags, {
      process: target,
      node,
      data: options.data,
      requiredOutbox: options.requiredOutbox,
    }),
    outsideBalances,
    deposit: mode === 'internal'
      ? async (asset, backingAmount) => {
          if (backingAmount > BigInt(Number.MAX_SAFE_INTEGER)) {
            throw new Error('That deposit is too large for a game inventory.');
          }
          const amount = Number(backingAmount);
          const assetId = asset.id as GoldMarketItemId | 'gold';
          if (!Number.isSafeInteger(amount) || amount <= 0) {
            throw new Error('Enter a positive whole amount.');
          }
          if (assetId !== 'gold' && !VENUE_GAME_ASSETS.includes(assetId)) {
            throw new Error('Rune Realm does not hold that asset.');
          }
          return game.sendToVenue(assetId, amount);
        }
      : undefined,
  }), [address, connect, mode, node, outsideBalances, runGame]);

  return (
    <div className={`market-goods ${mode === 'external' ? 'market-external' : ''}`}>
      <div data-tour="market-book" className="min-h-0 flex-1">
        <OrderbookTerminal
          node={node}
          process={process}
          embedded
          host={host}
          initialMarket={prefill ? `${prefill.item}/gold` : undefined}
          initialSide={prefill?.side}
          initialPrice={prefill?.price ? String(prefill.price) : undefined}
          initialQuantity={prefill ? String(prefill.count) : undefined}
        />
      </div>
    </div>
  );
}

function MonsterStat({ label, value, title }: { label: string; value: string; title: string }) {
  return (
    <div className="min-w-0 bg-surface px-2.5 py-1.5 text-right" title={title}>
      <div className="truncate text-[8px] uppercase tracking-[0.12em] text-faint">{label}</div>
      <div className="mt-0.5 truncate font-mono text-[11px] text-ink">{value}</div>
    </div>
  );
}

function FilterChip({ active, onClick, element, children }: { active: boolean; onClick: () => void; element?: Element; children: React.ReactNode }) {
  return (
    <button type="button" data-element={element} aria-pressed={active} onClick={onClick}
            className={cx(
              'filter-chip inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[3px]',
              'border px-2.5 py-1.5 text-xs transition-colors lg:min-h-9',
              active ? 'border-element/60 bg-element/10 text-element' : 'border-edge text-faint hover:text-ink',
            )}>
      {children}
    </button>
  );
}

function LineChart({ values, empty, suffix, className }: { values: number[]; empty: string; suffix?: string; className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = canvas.current;
    const frame = host.current;
    if (!element || !frame || values.length === 0) return undefined;
    const draw = () => {
      const rect = frame.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      element.width = Math.max(1, Math.round(rect.width * dpr));
      element.height = Math.max(1, Math.round(rect.height * dpr));
      const ctx = element.getContext('2d');
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      const width = rect.width; const height = rect.height;
      const pad = { left: 4, right: 4, top: 12, bottom: 12 };
      ctx.clearRect(0, 0, width, height);
      ctx.strokeStyle = 'rgba(214,200,162,.10)'; ctx.lineWidth = 1;
      for (let i = 1; i < 4; i += 1) { const y = (height / 4) * i; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
      const min = Math.min(...values); const max = Math.max(...values); const range = max - min || Math.max(1, max * 0.08);
      const points = values.map((value, index) => ({
        x: values.length === 1 ? width / 2 : pad.left + (index / (values.length - 1)) * (width - pad.left - pad.right),
        y: pad.top + ((max - value + (max === min ? range / 2 : 0)) / range) * (height - pad.top - pad.bottom),
      }));
      const gradient = ctx.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, 'rgba(150,122,255,.32)'); gradient.addColorStop(1, 'rgba(150,122,255,0)');
      ctx.beginPath(); points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
      ctx.lineTo(points[points.length - 1].x, height); ctx.lineTo(points[0].x, height); ctx.closePath(); ctx.fillStyle = gradient; ctx.fill();
      ctx.beginPath(); points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
      ctx.strokeStyle = 'rgba(214,200,162,.95)'; ctx.lineWidth = 1.6; ctx.stroke();
      const last = points[points.length - 1]; ctx.fillStyle = 'rgb(150,122,255)'; ctx.fillRect(last.x - 3, last.y - 3, 6, 6);
    };
    draw(); const observer = new ResizeObserver(draw); observer.observe(frame); return () => observer.disconnect();
  }, [values]);
  const latest = values.at(-1);
  const change = values.length > 1 ? latest! - values[0] : 0;
  return (
    <div ref={host} className={cx('market-chart relative overflow-hidden rounded-[3px] border border-rune/10 bg-void/30', className)}>
      {values.length ? <>
        <canvas ref={canvas} className="absolute inset-0 h-full w-full" aria-hidden="true" />
        <div className="pointer-events-none absolute left-3 top-3"><div className="font-mono text-lg">{compactNumber(latest!)}{suffix}</div>{values.length > 1 && <div className={cx('mt-0.5 font-mono text-[10px]', change >= 0 ? 'text-good' : 'text-bad')}>{change >= 0 ? '+' : ''}{compactNumber(change)}</div>}</div>
        <div className="pointer-events-none absolute bottom-2 right-3 text-[9px] uppercase tracking-[0.14em] text-faint">{values.length} points</div>
      </> : <div className="grid h-full place-items-center px-6 text-center text-xs text-faint">{empty}</div>}
    </div>
  );
}

function compactNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return new Intl.NumberFormat('en-US', { notation: Math.abs(value) >= 10_000 ? 'compact' : 'standard', maximumFractionDigits: 4 }).format(value);
}
function relativeTime(timestamp: number): string {
  if (!timestamp) return 'recently';
  const normalized = timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp;
  const seconds = Math.max(0, Math.floor((Date.now() - normalized) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60); if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60); if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24); if (days < 30) return `${days}d ago`;
  return new Date(normalized).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
