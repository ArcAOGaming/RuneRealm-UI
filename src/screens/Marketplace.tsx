import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { useGame } from '../state/gameContext';
import { isAbort } from '../state/usePoll';
import * as game from '../lib/game';
import {
  QUOTE_PROCESS, RUNE_PROCESS,
  TokenInfo, claimQuoteFaucet, depositRuneToGame, exchangeConfigured,
  formatUnits, parseUnits, readTokenBalance, readTokenInfo,
} from '../lib/marketplace';
import {
  EconomyDesk, EconomyFill, EconomyMarketStats, EconomyOrder, EconomyView, Element,
  GoldMarketItemId, GoldOrderSide, GoldOrderTif, Listing, Monster, PlayerFill, Sale,
} from '../lib/types';
import { ELEMENT_LABEL, ITEM_NAME, shortAddress } from '../lib/format';
import { Badge, Button, Empty, ErrorNote, Panel, Skeleton, cx } from '../ui/primitives';
import { Dialog } from '../ui/Dialog';
import { CardPreview } from '../ui/CardPreview';
import { CardViewer } from '../ui/CardViewer';
import { ITEM_ART } from '../ui/art';
import { useToast } from '../ui/toastContext';
import { useTourSteps, type TourStep } from '../ui/tourContext';
import { Arrow, ELEMENT_ICON, Exchange, Refresh, Rune, Sparkle, Wallet } from '../ui/icons';
import { MarketVenue, MarketVenuePicker, usePopover, venueFromSearch } from '../ui/marketVenues';
import { MarketDiorama } from '../ui/MarketDiorama';
import type { MarketDioramaStockItem } from '../gfx/marketDiorama';
import { economyPreview } from '../lib/economy-preview';

type MonsterSort = 'recent' | 'price-low' | 'price-high' | 'level' | 'attack' | 'defense';

const ELEMENTS: Element[] = ['fire', 'water', 'air', 'rock'];
const inputClass = 'h-11 w-full rounded-[3px] border border-edge bg-void/35 px-3 ' +
  'font-mono text-sm text-ink outline-none placeholder:text-faint focus:border-element/60';

/**
 * The market's walkthrough.
 *
 * Four sentences, and each one is about a rule rather than a control: which
 * counter you are standing at, that both books are the same instrument, who is
 * setting the price, and how far from the realm's own price it will let you
 * go. Those are the things that cost somebody gold when they are not known.
 *
 * **It states the fee, the corridor and where the realm's desk is.** If the
 * fee changes, if the desk stops quoting into the ladder, or if the price band
 * moves, this list is part of that change — see the note at the head of
 * `ui/Tour.tsx` and the walkthrough rule in `CLAUDE.md`.
 */
const MARKET_TOUR: TourStep[] = [
  {
    /* The header tab on desktop, the screen's own picker on a phone. Both
       carry the same four rows; whichever is on screen is the one pointed at.
       See `findTarget` in `ui/Tour.tsx`. */
    target: '[data-tour-to="/market"], .market-venue-trigger',
    title: 'Four counters, one list',
    body: 'Market opens onto four counters. The shop sells at a price the realm sets and cannot be haggled with. The internal book is players trading goods for Gold. The external book is that same instrument on real tokens in your wallet. Monsters is companions changing hands.',
  },
  {
    target: '[data-tour="market-book"]',
    title: 'Two books, one shape',
    body: 'Both books draw the same strip, the same ladder and the same ticket, so what you learn on one you already know on the other. They are the same instrument: resting bids and asks, matched by price then time. The only difference is what funds them — Gold the realm issues on the internal one, tokens from your wallet on the external one. Neither has a pool behind it, so nothing fills until someone is on the other side.',
  },
  {
    target: '[data-tour="market-desks"]',
    title: 'The realm quotes on the floor too',
    body: 'The shop’s bid and ask sit in the internal book’s own ladder, marked with a ◆. So you never have to compare the two counters: whichever is better fills you, and a player quoting inside the realm’s spread is always taken first. Trading on the book itself is free — the shop’s spread is what the realm takes.',
  },
  {
    target: '[data-tour="market-ticket"]',
    title: 'Read the trade ticket',
    body: 'Limit rests at your price; Market takes what the ladder has now and cancels the rest; All-or-none does the whole size or nothing; Maker-only refuses to cross. Prices must sit inside the band shown here — the realm refuses anything far outside its own quote, so one fat finger cannot set the market’s price. At the shop counter the realm reprices after every unit it trades, so a large order fills at several rates; the ticket lists each one before you commit.',
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
        {venue === 'shop' || venue === 'internal'
          ? <GoodsMarket desk={venue === 'shop' ? 'shop' : 'floor'}
                         onDesk={(next) => setVenue(next === 'shop' ? 'shop' : 'internal')} />
          : venue === 'external' ? <ExternalBook />
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

/** Which element tints a good. Scroll and Rune keep the page's own colour. */
const ITEM_ELEMENT: Partial<Record<GoldMarketItemId, Element>> = {
  fire_berry: 'fire', water_berry: 'water', air_berry: 'air', rock_berry: 'rock',
};

type GoodsDesk = 'shop' | 'floor';
type FloorRange = '12h' | '24h' | '7d' | '30d';
type ChartMode = 'line' | 'candles';
type CandleInterval = '5m' | '30m' | '1h' | '4h' | '1d';

const RANGE_MS: Record<FloorRange, number> = {
  '12h': 12 * 3600_000, '24h': 24 * 3600_000,
  '7d': 7 * 24 * 3600_000, '30d': 30 * 24 * 3600_000,
};

const CANDLE_MS: Record<CandleInterval, number> = {
  '5m': 5 * 60_000, '30m': 30 * 60_000, '1h': 3600_000,
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

function GoodsMarket({ desk: deskTab, onDesk: setDeskTab }: {
  desk: GoodsDesk; onDesk: (desk: GoodsDesk) => void;
}) {
  const { address, player, connect, connecting, run, isPending, refresh } = useGame();
  const [economy, setEconomy] = useState<EconomyView | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [item, setItem] = useState<GoldMarketItemId>('fire_berry');
  const [side, setSide] = useState<GoldOrderSide>('buy');
  const [range, setRange] = useState<FloorRange>('12h');
  const [chartMode, setChartMode] = useState<ChartMode>('line');
  const [candleInterval, setCandleInterval] = useState<CandleInterval>('30m');
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('5');
  const [tif, setTif] = useState<GoldOrderTif>('GTC');
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
      const view = await game.readEconomy({ signal });
      if (!signal?.aborted) setEconomy(view);
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

  const submitOrder = async () => {
    const unit = Math.floor(Number(price));
    const count = Math.floor(Number(quantity));
    if (!Number.isSafeInteger(unit) || unit <= 0 || !Number.isSafeInteger(count) || count <= 0) {
      setError(new Error('Price and quantity must be positive whole numbers.'));
      return;
    }
    const result = await run('gold-order',
      () => game.placeGoldOrder(side, item, unit, count, { tif }),
      TIF_RECEIPT[tif](side, count, item));
    if (result) { setPrice(''); await Promise.all([load(), refresh()]); }
  };

  /* Moving a quote, in one message.

     The old way was cancel-then-place: two slots, two creation costs, and the
     order went to the back of a queue it was already near the front of. An
     amend that only shrinks at the same price keeps both; anything else
     re-queues, and the process says which in `requeued`. */
  const amend = async (orderId: string, changes: { price?: number; quantity?: number }) => {
    const result = await run(`gold-amend-${orderId}`, () => game.amendGoldOrder(orderId, changes),
      'Quote moved.');
    if (result) await Promise.all([load(), refresh()]);
    return result;
  };

  const cancelAll = async (only?: GoldMarketItemId) => {
    const result = await run('gold-cancel-all',
      () => game.cancelGoldOrders(only ? { item: only } : {}),
      only ? `Every ${ITEM_NAME[only]} order withdrawn.` : 'Every order withdrawn.');
    if (result) await Promise.all([load(), refresh()]);
  };

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

  const cancel = async (orderId: string) => {
    const result = await run(`gold-cancel-${orderId}`, () => game.cancelGoldOrder(orderId),
      'Order cancelled and remaining escrow returned.');
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
  const ownOrders = economy.orders.filter((order) => order.account === address);
  const openPlayerExchange = () => {
    const book = economy.market[item];
    const best = side === 'buy' ? book?.bestAsk : book?.bestBid;
    if (best) setPrice(String(best));
    setDeskTab('floor');
  };

  return (
    <div className="market-goods">
      <MarketHealthStrip
        lead={deskTab === 'floor' && (
          <MarketPicker value={item} onPick={(next) => setItem(next as GoldMarketItemId)}
                        format={formatInteger}
                        glyph={(id) => <ItemGlyph item={id as GoldMarketItemId} className="h-4 w-4" />}
                        markets={GOLD_ITEMS.map((id) => ({
                          id,
                          label: `${ITEM_NAME[id]} / Gold`,
                          bestBid: economy.market[id]?.bestBid,
                          bestAsk: economy.market[id]?.bestAsk,
                        }))} />
        )}
        stats={[
          { label: 'Gold', value: formatInteger(gold), tone: 'text-rune' },
          { label: 'Book orders', value: formatInteger(economy.orders.length), tone: 'text-arcane' },
          { label: 'Market', value: economy.invariants.ok ? 'Stable' : 'Paused',
            tone: economy.invariants.ok ? 'text-good' : 'text-bad' },
        ]}
        actions={
          <Button size="sm" variant="quiet" onClick={() => void load()}
                  icon={<Refresh className="h-3.5 w-3.5" />}>Refresh</Button>
        } />

      {error !== null && <ErrorNote error={error} onRetry={() => void load()} />}

      {deskTab === 'shop' ? (
        <RealmShop economy={economy} gold={gold} inventory={player?.inventory}
                   item={item} onItem={setItem} side={side} onSide={setSide}
                   connected={Boolean(address)} connecting={connecting} onConnect={connect}
                   count={count} onCount={setCount}
                   isPending={isPending} onTrade={shopTrade} onRefresh={() => void load()}
                   onOpenFloor={openPlayerExchange} />
      ) : (
        <TradingFloor economy={economy} address={address} gold={gold} inventory={player?.inventory}
                      item={item}
                      range={range} onRange={setRange} chartMode={chartMode} onChartMode={setChartMode}
                      candleInterval={candleInterval} onCandleInterval={setCandleInterval}
                      side={side} onSide={setSide} tif={tif} onTif={setTif}
                      price={price} onPrice={setPrice} quantity={quantity} onQuantity={setQuantity}
                      ownOrders={ownOrders} recentFills={player?.recentFills}
                      connecting={connecting} onConnect={connect}
                      isPending={isPending} onSubmit={() => void submitOrder()}
                      onCancel={(id) => void cancel(id)}
                      onCancelAll={(only) => void cancelAll(only)}
                      onAmend={amend} />
      )}
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
  economy, gold, inventory, item, onItem, side, onSide, connected, connecting, onConnect,
  count, onCount, isPending, onTrade, onRefresh, onOpenFloor,
}: {
  economy: EconomyView; gold: number; inventory: Partial<Record<GoldMarketItemId, number>> | undefined;
  item: GoldMarketItemId; onItem: (item: GoldMarketItemId) => void;
  side: GoldOrderSide; onSide: (side: GoldOrderSide) => void;
  connected: boolean; connecting: boolean; onConnect: () => void;
  count: number;
  onCount: (value: number) => void;
  isPending: (key: string) => boolean;
  onTrade: (item: GoldMarketItemId, side: GoldOrderSide, count: number) => Promise<void>;
  onRefresh: () => void; onOpenFloor: () => void;
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
      <ShopShowcase item={item} desk={desk} plan={plan} side={side} count={count} sceneInventory={sceneInventory}
                    onItem={onItem} onRefresh={onRefresh} />

      <ShopTradeTicket item={item} desk={desk} market={economy.market[item]} plan={plan}
                       held={held} gold={gold}
                       count={count} onCount={onCount}
                       side={side} onSide={onSide} connected={connected}
                       connecting={connecting} onConnect={onConnect}
                       busy={isPending(`npc-${side}-${item}`)}
                       onTrade={() => void onTrade(item, side, count)} onOpenFloor={onOpenFloor} />
    </div>
  );
}

function ShopShowcase({ item, desk, plan, side, count, sceneInventory, onItem, onRefresh }: {
  item: GoldMarketItemId; desk: EconomyDesk | undefined;
  plan: DeskFillPlan; side: GoldOrderSide; count: number; sceneInventory: MarketDioramaStockItem[];
  onItem: (item: GoldMarketItemId) => void; onRefresh: () => void;
}) {
  const stock = desk?.stock ?? 0;
  const cap = Math.max(1, desk?.stockCap ?? 1);
  const ratio = stock / cap;
  const stockLabel = !desk ? 'Floor only' : stock === 0 ? 'Sold out' : ratio < .2 ? 'Scarce' : ratio < .55 ? 'Moving' : 'Well stocked';
  return (
    <Panel data-element={ITEM_ELEMENT[item]} className="market-shop-showcase flex min-h-0 flex-col overflow-hidden p-0">
      <div className="market-panel-heading flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="eyebrow">Selected good</div>
          <h2 className="mt-1 truncate font-display text-xl font-semibold">{ITEM_NAME[item]}</h2>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={!desk || !stock ? 'bad' : ratio < .2 ? 'warn' : 'element'}>{stockLabel}</Badge>
          <Button size="sm" variant="quiet" title="Refresh shop" onClick={onRefresh}
                  icon={<Refresh className="h-3.5 w-3.5" />}>Refresh</Button>
        </div>
      </div>
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
  item, desk, market, plan, held, gold, count, onCount, side, onSide,
  connected, connecting, onConnect, busy, onTrade, onOpenFloor,
}: {
  item: GoldMarketItemId; desk: EconomyDesk | undefined; market: EconomyMarketStats | undefined;
  plan: DeskFillPlan;
  held: number; gold: number;
  count: number; onCount: (value: number) => void; side: GoldOrderSide; onSide: (side: GoldOrderSide) => void;
  connected: boolean; connecting: boolean; onConnect: () => void; busy: boolean;
  onTrade: () => void; onOpenFloor: () => void;
}) {
  const paused = pausedFor(desk, side);
  const unitPrice = side === 'buy' ? desk?.ask ?? 0 : desk?.bid ?? 0;
  const playerPrice = side === 'buy' ? market?.bestAsk ?? 0 : market?.bestBid ?? 0;
  const playerDepth = side === 'buy' ? market?.depth.asks ?? [] : market?.depth.bids ?? [];
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

  return (
    <Panel data-tour="market-ticket" data-element={ITEM_ELEMENT[item]}
           className="market-shop-ticket flex min-h-0 flex-col overflow-hidden p-0">
      <div className="market-panel-heading">
        <div className="eyebrow">Instant trade</div>
        <h3 className="mt-1 text-sm font-semibold">Deal ticket</h3>
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
          <button type="button" onClick={onOpenFloor} className={cx(playerBetter && 'is-best')}>
            <span><i>Player exchange</i><small>{playerUnits ? `${formatInteger(playerUnits)} at best price` : 'Live order book'}</small></span>
            <b>{playerPrice ? `${formatInteger(playerPrice)}g` : '--'}</b>
          </button>
        </div>

        {playerBetter && (
          <button type="button" onClick={onOpenFloor} className="market-better-route mt-2">
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
          <div><dt>Gold after</dt><dd>{canTrade ? formatInteger(goldAfter) : formatInteger(gold)}</dd></div>
          <div><dt>Held after</dt><dd>{canTrade ? formatInteger(heldAfter) : formatInteger(held)}</dd></div>
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
              {playerPrice > 0 && <button type="button" onClick={onOpenFloor} className="mt-1.5 flex items-center gap-1 text-[11px] text-ink hover:text-arcane">Trade on the player exchange <Arrow className="h-3 w-3" /></button>}
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
    blurb: 'Rests on the book at your price until it fills or you withdraw it.' },
  { value: 'IOC', label: 'Market',
    blurb: 'Takes whatever the ladder offers right now and cancels the rest. Nothing rests.' },
  { value: 'FOK', label: 'All or none',
    blurb: 'Fills the whole quantity at once or does nothing at all, and costs nothing when it does nothing.' },
  { value: 'PostOnly', label: 'Maker only',
    blurb: 'Refused rather than allowed to cross, so this can only ever add liquidity.' },
];

const TIF_RECEIPT: Record<GoldOrderTif, (side: GoldOrderSide, count: number, item: GoldMarketItemId) => string> = {
  GTC: (side, count, item) => `${side === 'buy' ? 'Bid' : 'Ask'} entered for ${formatInteger(count)} ${ITEM_NAME[item]}.`,
  IOC: (_side, count, item) => `Took what the book offered, up to ${formatInteger(count)} ${ITEM_NAME[item]}.`,
  FOK: (_side, count, item) => `Filled all ${formatInteger(count)} ${ITEM_NAME[item]} at once.`,
  PostOnly: (side, count, item) => `${side === 'buy' ? 'Bid' : 'Ask'} added for ${formatInteger(count)} ${ITEM_NAME[item]} without crossing.`,
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
  rows: MarketDepthRow[], tone: 'good' | 'bad', want: { units?: number; gold?: number },
) {
  const levels = aggregateDepth(rows, tone);
  let units = 0; let cost = 0; let limit = 0;
  for (const level of levels) {
    const room = want.gold !== undefined
      ? Math.min(level.quantity, Math.floor((want.gold - cost) / Math.max(1, level.price)))
      : Math.min(level.quantity, Math.max(0, (want.units ?? 0) - units));
    if (room <= 0) break;
    units += room; cost += room * level.price; limit = level.price;
    if (want.units !== undefined && units >= want.units) break;
  }
  return { units, cost, limit, average: units ? Math.round(cost / units) : 0 };
}

function TradingFloor({
  economy, address, gold, inventory, item, range, onRange,
  chartMode, onChartMode, candleInterval, onCandleInterval, side, onSide, tif, onTif,
  price, onPrice, quantity, onQuantity, ownOrders, recentFills, connecting, onConnect,
  isPending, onSubmit, onCancel, onCancelAll, onAmend,
}: {
  economy: EconomyView; address: string | null; gold: number;
  inventory: Partial<Record<GoldMarketItemId, number>> | undefined;
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
}) {
  const now = Date.now();
  const from = now - RANGE_MS[range];
  const series = useMemo(() => seriesByItem(economy.fills, from), [economy.fills, from]);
  const book = economy.market[item];
  const points = series[item] ?? [];
  /* Daily bars come from the process. `economy.fills` is a 500-row ring shared
     by every market, so a 30-day chart drawn from it is a chart of the last few
     hundred trades wearing a month's axis. A published candle is permanent. */
  const dailyBars = useMemo<CandleBar[]>(() => (economy.candles?.[item] ?? [])
    .filter((bar) => bar.d * 86_400_000 >= from - 86_400_000)
    .map((bar) => ({ t: bar.d * 86_400_000, open: bar.o, high: bar.h, low: bar.l, close: bar.c, volume: bar.v })),
  [economy.candles, item, from]);
  const publishedBars = chartMode === 'candles' && candleInterval === '1d' ? dailyBars : undefined;

  const [amending, setAmending] = useState<{ id: string; price: string; quantity: string } | null>(null);
  const [spend, setSpend] = useState('');

  const immediate = tif === 'IOC' || tif === 'FOK';
  const ladder = side === 'buy' ? (book?.depth.asks ?? []) : (book?.depth.bids ?? []);
  const ladderTone: 'good' | 'bad' = side === 'buy' ? 'bad' : 'good';
  const parsedSpend = Math.floor(Number(spend));
  const spending = tif === 'IOC' && side === 'buy'
    && Number.isSafeInteger(parsedSpend) && parsedSpend > 0;
  /* In "spend" mode the ladder decides both numbers; otherwise the fields do,
     and an immediate order still takes its limit from the ladder because the
     player asked for a size, not a price. */
  const swept = useMemo(() => (spending
    ? sweepLadder(ladder, ladderTone, { gold: Math.max(0, parsedSpend - 1) })
    : sweepLadder(ladder, ladderTone, { units: Math.max(0, Math.floor(Number(quantity))) })),
  [ladder, ladderTone, spending, parsedSpend, quantity]);

  const parsedPrice = immediate ? swept.limit : Math.floor(Number(price));
  const parsedQuantity = spending ? swept.units : Math.floor(Number(quantity));
  const validOrder = Number.isSafeInteger(parsedPrice) && parsedPrice > 0
    && Number.isSafeInteger(parsedQuantity) && parsedQuantity > 0;
  const notional = validOrder ? parsedPrice * parsedQuantity : 0;
  /* Read the fee off the market, never a constant.
     The process charges the TAKER, at a per-market rate that is 0 on every
     in-game market -- the NPC desk spread is the Gold sink, not the book. A
     hardcoded 2% here described a rule the process no longer has, which is
     worse than showing nothing. See ORDERBOOK.md paragraph 7.3. */
  const market = economy.markets?.[`${item}/gold`];
  const minimumOrder = market?.minValue ?? 10;
  const belowMinimum = validOrder && notional < minimumOrder;
  const creationCost = 1;
  const takerBps = market?.takerBps ?? 0;
  const crossesBook = validOrder && (side === 'buy'
    ? Boolean(book?.bestAsk && parsedPrice >= book.bestAsk)
    : Boolean(book?.bestBid && parsedPrice <= book.bestBid));
  /* Only a crossing order is a taker. Resting is free, always. */
  const takerFee = crossesBook && takerBps ? Math.ceil(notional * takerBps / 10000) : 0;
  const requiredGold = side === 'buy' ? notional + creationCost + takerFee : creationCost;
  const held = inventory?.[item] ?? 0;
  const shortGold = validOrder ? Math.max(0, requiredGold - gold) : 0;
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
  const orderReady = validOrder && !belowMinimum && !shortGold && !shortItems
    && !outsideBand && !postOnlyCrosses && !nothingToTake && !killShort;
  const pickDepth = (nextSide: GoldOrderSide, nextPrice: number) => {
    onSide(nextSide);
    onPrice(String(nextPrice));
  };
  const mineHere = ownOrders.filter((order) => order.item === item);

  return (
    <div className="market-goods-body market-floor flex min-h-0 flex-col gap-2.5">
      <div data-tour="market-book" className="market-book-body grid min-h-0 flex-1 gap-2.5">
        <Panel className="market-order-book flex min-h-0 flex-col overflow-hidden p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-mono text-sm tracking-tight">
              {ITEM_NAME[item]} <span className="text-faint">/ Gold</span>
            </h3>
            <BookChartToolbar chartMode={chartMode} onChartMode={onChartMode}
                              candleInterval={candleInterval} onCandleInterval={onCandleInterval}
                              range={range} onRange={onRange} />
          </div>
          <BookTicker rows={internalTicks(book, points)} />
          <PriceChart className="mt-2.5 min-h-[15rem] flex-1 lg:min-h-0" points={points} from={from} to={now}
                      bid={book?.bestBid} ask={book?.bestAsk} mode={chartMode}
                      candleMs={CANDLE_MS[candleInterval]} published={publishedBars}
                      unit="Gold" format={formatInteger} />
          {publishedBars !== undefined && publishedBars.length > 0 && (
            <p className="mt-1.5 text-[10px] text-faint">
              Daily candles come from the process and are kept for 30 days. The raw fill
              list is capped, so anything older than that lives only here.
            </p>
          )}
        </Panel>

        <Panel className="market-depth-panel flex min-h-0 flex-col overflow-hidden p-3.5">
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[3px] border border-arcane/15 bg-arcane/12 p-px">
            <BookPrice label="Best bid" value={book?.bestBid} tone="good" unit="gold" format={formatInteger} />
            <BookPrice label="Best ask" value={book?.bestAsk} tone="bad" unit="gold" format={formatInteger} />
          </div>
          <DepthMountain bids={book?.depth.bids ?? []} asks={book?.depth.asks ?? []}
                         unit="g" format={formatInteger} className="mt-3 min-h-[9rem] flex-1" />
          <div className="market-depth-ladders mt-3 grid max-h-44 grid-cols-2 gap-4 overflow-y-auto">
            <DepthList label="Bids" tone="good" rows={book?.depth.bids ?? []} unit="Gold" format={formatInteger}
                       onPick={(value) => pickDepth('sell', value)} action="Sell into bid" />
            <DepthList label="Asks" tone="bad" rows={book?.depth.asks ?? []} unit="Gold" format={formatInteger}
                       onPick={(value) => pickDepth('buy', value)} action="Buy from ask" />
          </div>
          {/* The realm's desk is IN this ladder, and saying so once, here, is
              what removes the two-tabs problem: nobody has to compare the
              shop's price with the floor's, because a taker gets whichever of
              the two is better without choosing a counter. */}
          {Boolean(book?.houseBid || book?.houseAsk) && (
            <p className="mt-2.5 border-t border-edge/60 pt-2 text-[10px] leading-relaxed text-faint">
              <b className="market-depth-house" aria-hidden="true">&#9670;</b> The realm&rsquo;s desk quotes
              {book?.houseBid ? ` ${formatInteger(book.houseBid)} bid` : ''}
              {book?.houseBid && book?.houseAsk ? ' /' : ''}
              {book?.houseAsk ? ` ${formatInteger(book.houseAsk)} ask` : ''} into this ladder.
              A player quoting inside that is always taken first.
            </p>
          )}
        </Panel>

        <Panel data-tour="market-ticket" className="market-order-ticket flex min-h-0 flex-col overflow-hidden p-3.5">
          <div className="flex items-start justify-between gap-3">
            <div><div className="eyebrow">Order ticket</div>
              <h3 className="mt-1 text-sm font-semibold">{ITEM_NAME[item]}</h3></div>
            <div className="flex flex-wrap justify-end gap-1">
              {validOrder && !immediate && (
                <Badge tone={crossesBook ? 'good' : 'plain'}>{crossesBook ? 'Crosses' : 'Rests'}</Badge>
              )}
              <Badge tone="plain">1g fee</Badge>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-1.5">
            <Button size="sm" variant={side === 'buy' ? 'primary' : 'quiet'} onClick={() => onSide('buy')}>Bid</Button>
            <Button size="sm" variant={side === 'sell' ? 'primary' : 'quiet'} onClick={() => onSide('sell')}>Ask</Button>
          </div>

          {/* Time in force. Everything else a book does is a special case of
              these four, and the only difference between them is what happens
              to the part that did not trade. */}
          <div className="market-tif mt-2 grid grid-cols-4 gap-1" role="group" aria-label="Time in force">
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
            <label className="mt-2.5 block"><span className="eyebrow mb-1 block">Spend / Gold (optional)</span>
              <input className={inputClass} inputMode="numeric" value={spend} placeholder="Leave blank to use quantity"
                     onChange={(event) => setSpend(event.target.value)} /></label>
          )}

          {immediate ? (
            <div className="mt-2.5 rounded-[3px] border border-edge/70 bg-void/25 px-3 py-2">
              <div className="eyebrow">Limit, taken from the ladder</div>
              <div className={cx('mt-1 font-mono text-lg leading-none', swept.limit ? 'text-ink' : 'text-faint')}>
                {swept.limit ? formatInteger(swept.limit) : '--'} <span className="eyebrow">gold</span>
              </div>
              <p className="mt-1.5 text-[10px] leading-relaxed text-faint">
                The realm never takes an unpriced order, so this is the worst price the sweep
                needs, not a cushion. Average {swept.average ? formatInteger(swept.average) : '--'}.
              </p>
            </div>
          ) : (
            <label className="mt-2.5 block"><span className="eyebrow mb-1 block">Unit price / Gold</span>
              <input className={inputClass} inputMode="numeric" value={price} placeholder="0"
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
            <div><dt>Order value</dt><dd>{notional ? `${formatInteger(notional)} Gold` : '--'}</dd></div>
            <div><dt>Creation cost</dt><dd>{creationCost} Gold</dd></div>
            <div>
              <dt>Taker fee</dt>
              <dd className={takerFee ? 'text-bad' : 'text-good'}>
                {takerBps === 0 ? 'None' : takerFee ? `${formatInteger(takerFee)} Gold` : 'None, this rests'}
              </dd>
            </div>
            {side === 'sell' ? (
              <div><dt>Est. proceeds</dt><dd className="text-good">{notional ? `${formatInteger(Math.max(0, notional - takerFee))} Gold` : '--'}</dd></div>
            ) : (
              <div><dt>Gold committed</dt><dd className="text-good">{notional ? `${formatInteger(requiredGold)} Gold` : '--'}</dd></div>
            )}
            {band && (
              <div><dt>Price band</dt>
                <dd className={outsideBand ? 'text-warn' : 'text-faint'}>
                  {formatInteger(band.low)}&ndash;{formatInteger(band.high)} Gold
                </dd></div>
            )}
          </dl>

          <p className="mt-3 border-t border-edge/60 pt-2 text-[10px] leading-relaxed text-faint">
            Good for 30 days &middot; price-time priority &middot; partial fills allowed
          </p>
          {crossesBook && side === 'buy' && !immediate && (
            <p className="mt-1 text-[10px] leading-relaxed text-good">The resting ask sets the fill price; unused bid escrow returns.</p>
          )}
          {outsideBand && band && (
            <p className="mt-2 text-[11px] text-warn">
              Outside the {formatInteger(band.low)}&ndash;{formatInteger(band.high)} Gold band. The realm refuses
              prices this far from its own desk, so one mistake cannot set the market&rsquo;s median.
            </p>
          )}
          {postOnlyCrosses && <p className="mt-2 text-[11px] text-warn">A maker-only order may not cross. Move the price, or switch to Limit.</p>}
          {nothingToTake && <p className="mt-2 text-[11px] text-warn">Nothing is resting on that side to take.</p>}
          {killShort && !nothingToTake && <p className="mt-2 text-[11px] text-warn">Only {formatInteger(swept.units)} available, and an all-or-none order would do nothing.</p>}
          {belowMinimum && <p className="mt-2 text-[11px] text-warn">Minimum order value is {minimumOrder} Gold.</p>}
          {Boolean(shortGold) && <p className="mt-2 text-[11px] text-warn">Need {formatInteger(shortGold)} more Gold.</p>}
          {Boolean(shortItems) && <p className="mt-2 text-[11px] text-warn">Need {formatInteger(shortItems)} more {ITEM_NAME[item]}.</p>}
          {!address
            ? <Button className="mt-2.5 w-full" variant="primary" busy={connecting} onClick={onConnect}
                      icon={<Wallet className="h-4 w-4" />}>Connect to trade</Button>
            : <Button className="mt-2.5 w-full" variant="primary" busy={isPending('gold-order')}
                      disabled={!orderReady} onClick={onSubmit}>
                {immediate ? `Take ${formatInteger(parsedQuantity)}` : `Place ${side === 'buy' ? 'bid' : 'ask'}`}
              </Button>}

          <div className="mt-4 flex items-center justify-between gap-2">
            <div className="eyebrow">Your open orders</div>
            {/* One message to step away from every quote in this market. The
                alternative is one message per order, which is two seconds of
                being unable to withdraw a price that has gone wrong. */}
            {mineHere.length > 1 && (
              <button type="button" className="market-ticket-link"
                      disabled={isPending('gold-cancel-all')}
                      onClick={() => onCancelAll(item)}>
                Withdraw all {mineHere.length}
              </button>
            )}
          </div>
          <ul className="mt-1.5 space-y-1 overflow-y-auto">
            {ownOrders.length === 0
              ? <li className="py-2 text-[11px] text-faint">Nothing of yours on the book.</li>
              : ownOrders.map((order) => (
                <li key={order.id} className="rounded-[2px] border border-edge/70 px-2 py-1.5">
                  <div className="flex items-center gap-2">
                    <ItemGlyph item={order.item} className="h-4 w-4" />
                    <span className="min-w-0 flex-1 font-mono text-[10px]">
                      <b className={order.side === 'buy' ? 'text-good' : 'text-bad'}>{order.side === 'buy' ? 'BID' : 'ASK'}</b>{' '}
                      {order.remaining}/{order.quantity} @ {formatInteger(order.price)}
                    </span>
                    <button type="button" className="market-ticket-link"
                            aria-expanded={amending?.id === order.id}
                            onClick={() => setAmending(amending?.id === order.id ? null : {
                              id: order.id, price: String(order.price), quantity: String(order.remaining),
                            })}>Move</button>
                    <Button size="sm" variant="quiet" busy={isPending(`gold-cancel-${order.id}`)}
                            onClick={() => onCancel(order.id)}>&times;</Button>
                  </div>
                  {amending?.id === order.id && (
                    <>
                      <div className="mt-1.5 flex items-end gap-1.5">
                        <label className="min-w-0 flex-1"><span className="eyebrow mb-1 block">Price</span>
                          <input className="market-amend-input" inputMode="numeric" value={amending.price}
                                 onChange={(event) => setAmending({ ...amending, price: event.target.value })} /></label>
                        <label className="min-w-0 flex-1"><span className="eyebrow mb-1 block">Qty</span>
                          <input className="market-amend-input" inputMode="numeric" value={amending.quantity}
                                 onChange={(event) => setAmending({ ...amending, quantity: event.target.value })} /></label>
                        <Button size="sm" variant="primary" busy={isPending(`gold-amend-${order.id}`)}
                                onClick={() => {
                                  const nextPrice = Math.floor(Number(amending.price));
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
          <div className="eyebrow mt-4">Your recent fills</div>
          <ul className="mt-1.5 min-h-0 flex-1 space-y-1 overflow-y-auto">
            {!recentFills?.length
              ? <li className="py-2 text-[11px] text-faint">Nothing filled yet.</li>
              : recentFills.slice(0, 12).map((fill) => (
                <li key={fill.id} className="flex items-center gap-2 px-1 py-1 font-mono text-[10px]">
                  <ItemGlyph item={fill.item} className="h-3.5 w-3.5" />
                  <b className={fill.side === 'buy' ? 'text-good' : 'text-bad'}>
                    {fill.side === 'buy' ? 'BUY' : 'SELL'}
                  </b>
                  <span className="min-w-0 flex-1 truncate">
                    {formatInteger(fill.quantity)} @ {formatInteger(fill.price)}
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
 * The floor's price history, over real time rather than over an index.
 *
 * Fills are sparse and unevenly spaced — two trades an hour apart then nothing
 * for a day — so plotting them evenly would draw a busy market that does not
 * exist. The x axis is the chosen window with a rule per day, and the current
 * best bid and ask are dashed across it, because where the last trade sits
 * relative to the live book is the only reading anybody takes from this.
 */
/**
 * Line or candles, which candle, and how far back.
 *
 * Extracted the moment there were two books: a toolbar that lives in one
 * screen's JSX is a toolbar the other screen grows a slightly different copy
 * of, and then the two stop being the same instrument.
 */
function BookChartToolbar({ chartMode, onChartMode, candleInterval, onCandleInterval, range, onRange }: {
  chartMode: ChartMode; onChartMode: (mode: ChartMode) => void;
  candleInterval: CandleInterval; onCandleInterval: (interval: CandleInterval) => void;
  range: FloorRange; onRange: (range: FloorRange) => void;
}) {
  return (
    <div className="market-chart-toolbar flex flex-wrap justify-end gap-1">
      {(['line', 'candles'] as ChartMode[]).map((value) => (
        <ChartControl key={value} active={chartMode === value} onClick={() => onChartMode(value)}>
          {value === 'line' ? 'Line' : 'Candles'}
        </ChartControl>
      ))}
      <span className="market-chart-divider" aria-hidden="true" />
      {chartMode === 'candles' && (['5m', '30m', '1h', '4h', '1d'] as CandleInterval[]).map((value) => (
        <ChartControl key={value} active={candleInterval === value} onClick={() => onCandleInterval(value)}>
          {value}
        </ChartControl>
      ))}
      {chartMode === 'candles' && <span className="market-chart-divider" aria-hidden="true" />}
      {(['12h', '24h', '7d', '30d'] as FloorRange[]).map((value) => (
        <ChartControl key={value} active={range === value} onClick={() => onRange(value)}>{value}</ChartControl>
      ))}
    </div>
  );
}

function ChartControl({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick}
            className={cx('market-chart-control', active && 'is-active')}>
      {children}
    </button>
  );
}

interface PricePoint { t: number; v: number; q: number }
interface CandleBar { t: number; open: number; high: number; low: number; close: number; volume: number }

function candleBars(points: PricePoint[], interval: number): CandleBar[] {
  const buckets = new Map<number, CandleBar>();
  for (const point of points) {
    const start = Math.floor(point.t / interval) * interval;
    const row = buckets.get(start);
    if (!row) {
      buckets.set(start, { t: start, open: point.v, high: point.v, low: point.v, close: point.v, volume: point.q });
    } else {
      row.high = Math.max(row.high, point.v);
      row.low = Math.min(row.low, point.v);
      row.close = point.v;
      row.volume += point.q;
    }
  }
  return [...buckets.values()].sort((a, b) => a.t - b.t);
}

function PriceChart({ points, from, to, bid, ask, mode, candleMs, published, unit, format, className }: {
  points: PricePoint[]; from: number; to: number; mode: ChartMode; candleMs: number;
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
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const derived = useMemo(() => candleBars(points, candleMs), [points, candleMs]);
  const bars = published?.length ? published : derived;
  const latestBar = bars.at(-1);

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
      const pad = { left: 7, right: 46, top: 18, bottom: 20 };
      const plotW = Math.max(1, width - pad.left - pad.right);
      const plotH = Math.max(1, height - pad.top - pad.bottom);
      const priceH = mode === 'candles' ? plotH * .76 : plotH;
      ctx.clearRect(0, 0, width, height);

      const priceValues = mode === 'candles'
        ? bars.flatMap((bar) => [bar.high, bar.low])
        : points.map((point) => point.v);
      const values = [...priceValues, bid, ask]
        .filter((value): value is number => typeof value === 'number' && value > 0);
      const low = values.length ? Math.min(...values) : 0;
      const high = values.length ? Math.max(...values) : 1;
      const margin = (high - low) * .15 || Math.max(1, high * .15);
      const top = high + margin; const bottom = Math.max(0, low - margin);
      const y = (value: number) => pad.top + (1 - (value - bottom) / (top - bottom || 1)) * priceH;
      const x = (time: number) => pad.left + ((time - from) / (to - from || 1)) * plotW;

      const span = to - from;
      const hour = 3600_000; const day = 24 * hour;
      const gridMs = span <= 13 * hour ? 2 * hour : span <= 25 * hour ? 4 * hour : span <= 8 * day ? day : 5 * day;
      ctx.font = '9px "JetBrains Mono", ui-monospace, monospace';
      ctx.textBaseline = 'top';
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
      for (let index = 0; index <= 3; index += 1) {
        const py = pad.top + (priceH / 3) * index;
        ctx.strokeStyle = 'rgba(214,200,162,.07)';
        ctx.beginPath(); ctx.moveTo(pad.left, py); ctx.lineTo(pad.left + plotW, py); ctx.stroke();
      }

      const rule = (value: number | undefined, colour: string, label: string) => {
        if (!value) return;
        const py = y(value);
        ctx.save();
        ctx.setLineDash([3, 3]); ctx.strokeStyle = colour; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(pad.left, py); ctx.lineTo(pad.left + plotW, py); ctx.stroke();
        ctx.restore();
        ctx.fillStyle = colour; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText(`${label} ${format(value)}`, pad.left + plotW + 5, py);
      };
      rule(bid, 'rgb(74,210,149)', 'B');
      rule(ask, 'rgb(255,94,105)', 'A');

      if (mode === 'candles' && bars.length) {
        const maxVolume = Math.max(1, ...bars.map((bar) => bar.volume));
        const volumeBottom = pad.top + plotH;
        const volumeHeight = plotH - priceH - 5;
        const bodyWidth = Math.max(2, Math.min(16, plotW * (candleMs / Math.max(1, span)) * .72));
        ctx.strokeStyle = 'rgba(214,200,162,.08)';
        ctx.beginPath(); ctx.moveTo(pad.left, pad.top + priceH + 3); ctx.lineTo(pad.left + plotW, pad.top + priceH + 3); ctx.stroke();
        for (const bar of bars) {
          const px = x(bar.t + candleMs / 2);
          const rising = bar.close >= bar.open;
          const colour = rising ? 'rgb(74,210,149)' : 'rgb(255,94,105)';
          ctx.strokeStyle = colour; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(px, y(bar.high)); ctx.lineTo(px, y(bar.low)); ctx.stroke();
          const bodyTop = Math.min(y(bar.open), y(bar.close));
          const bodyHeight = Math.max(1.5, Math.abs(y(bar.open) - y(bar.close)));
          ctx.fillStyle = rising ? 'rgba(74,210,149,.78)' : 'rgba(255,94,105,.78)';
          ctx.fillRect(px - bodyWidth / 2, bodyTop, bodyWidth, bodyHeight);
          const volume = (bar.volume / maxVolume) * Math.max(1, volumeHeight);
          ctx.fillStyle = rising ? 'rgba(74,210,149,.18)' : 'rgba(255,94,105,.18)';
          ctx.fillRect(px - bodyWidth / 2, volumeBottom - volume, bodyWidth, volume);
        }
      } else if (points.length) {
        const plotted = points.map((point) => ({ x: x(point.t), y: y(point.v) }));
        if (plotted.length > 1) {
          const gradient = ctx.createLinearGradient(0, pad.top, 0, pad.top + priceH);
          gradient.addColorStop(0, 'rgba(150,122,255,.3)');
          gradient.addColorStop(1, 'rgba(150,122,255,0)');
          ctx.beginPath();
          plotted.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
          ctx.lineTo(plotted[plotted.length - 1].x, pad.top + priceH);
          ctx.lineTo(plotted[0].x, pad.top + priceH);
          ctx.closePath(); ctx.fillStyle = gradient; ctx.fill();
          ctx.beginPath();
          plotted.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
          ctx.strokeStyle = 'rgb(214,200,162)'; ctx.lineWidth = 1.6; ctx.stroke();
        }
        ctx.fillStyle = 'rgb(150,122,255)';
        plotted.forEach((point) => ctx.fillRect(point.x - 2.5, point.y - 2.5, 5, 5));
      } else {
        ctx.fillStyle = 'rgba(128,138,164,.95)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('No fills in this window', pad.left + plotW / 2, pad.top + priceH / 2);
      }

      if (pointer && pointer.x >= pad.left && pointer.x <= pad.left + plotW
          && pointer.y >= pad.top && pointer.y <= pad.top + plotH) {
        const candidates = mode === 'candles'
          ? bars.map((bar) => ({ t: bar.t + candleMs / 2, v: bar.close, bar }))
          : points.map((point) => ({ t: point.t, v: point.v, bar: undefined }));
        if (candidates.length) {
          const hoverTime = from + ((pointer.x - pad.left) / plotW) * span;
          const nearest = candidates.reduce((best, row) => Math.abs(row.t - hoverTime) < Math.abs(best.t - hoverTime) ? row : best);
          const px = x(nearest.t); const py = y(nearest.v);
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
    element.addEventListener('mousemove', onMove);
    element.addEventListener('mouseleave', onLeave);
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(frame);
    return () => {
      observer.disconnect();
      element.removeEventListener('mousemove', onMove);
      element.removeEventListener('mouseleave', onLeave);
    };
  }, [points, bars, from, to, bid, ask, mode, candleMs, unit, format]);

  return (
    <div ref={host} className={cx('market-price-chart relative overflow-hidden rounded-[3px]', className)}>
      {mode === 'candles' && latestBar && (
        <div className="market-candle-readout" aria-hidden="true">
          <span>O {format(latestBar.open)}</span><span>H {format(latestBar.high)}</span>
          <span>L {format(latestBar.low)}</span><span>C {format(latestBar.close)}</span>
        </div>
      )}
      <canvas ref={canvas} className="absolute inset-0 h-full w-full cursor-crosshair"
              role="img" aria-label={`${mode === 'candles' ? 'Candlestick' : 'Line'} price chart with ${points.length} fills`} />
    </div>
  );
}

/** Fills inside the window, per item, oldest first. */
function seriesByItem(fills: EconomyFill[], from: number): Partial<Record<GoldMarketItemId, PricePoint[]>> {
  const out: Partial<Record<GoldMarketItemId, PricePoint[]>> = {};
  for (const fill of fills ?? []) {
    if (fill.filledAt < from) continue;
    (out[fill.item] ??= []).push({ t: fill.filledAt, v: fill.price, q: fill.quantity });
  }
  for (const rows of Object.values(out)) rows.sort((a, b) => a.t - b.t);
  return out;
}

/**
 * The strip that says this half is a market: last, spread, volume, traders.
 *
 * It takes rows rather than a book, because the external venue has all eight
 * of these numbers and not one of them comes out of an `EconomyMarketStats`.
 * Both books use the same eight labels in the same order on purpose — that
 * repetition is the whole point of the strip.
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

/* The internal book's eight, including who is on the touch.

   The realm's desk quotes into this same ladder, so "is the best bid a player
   or the house" is the one reading a trader cannot work out from the numbers
   themselves — and it is the difference between a market with players in it
   and an empty one being held open by the house. */
function internalTicks(book: EconomyMarketStats | undefined, points: PricePoint[]) {
  const spread = book?.bestBid && book?.bestAsk ? book.bestAsk - book.bestBid : undefined;
  const last = points.at(-1)?.v;
  const houseBid = book?.houseBid !== undefined && book.bestBid === book.houseBid
    && (book.p2pBid === undefined || book.p2pBid < book.houseBid);
  const houseAsk = book?.houseAsk !== undefined && book.bestAsk === book.houseAsk
    && (book.p2pAsk === undefined || book.p2pAsk > book.houseAsk);
  return [
    { label: 'Last', value: last ? formatInteger(last) : '--' },
    { label: houseBid ? 'Bid · realm' : 'Bid', tone: 'good' as const,
      value: book?.bestBid ? formatInteger(book.bestBid) : '--' },
    { label: houseAsk ? 'Ask · realm' : 'Ask', tone: 'bad' as const,
      value: book?.bestAsk ? formatInteger(book.bestAsk) : '--' },
    { label: 'Spread', value: spread === undefined ? '--' : formatInteger(spread) },
    { label: 'Med 7d', value: book?.median7d ? formatInteger(book.median7d) : '--' },
    { label: 'Vol 24h', value: formatInteger(book?.volume24h ?? 0) },
    { label: 'Vol 7d', value: formatInteger(book?.volume7d ?? 0) },
    { label: 'Fills', value: formatInteger(points.length) },
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
  const priceSpan = Math.max(1, maxPrice - minPrice);
  const x = (price: number) => 5 + ((price - minPrice) / priceSpan) * 90;
  const bidTotal = bids.reduce((sum, row) => sum + row.quantity, 0);
  const askTotal = asks.reduce((sum, row) => sum + row.quantity, 0);
  const maxDepth = Math.max(1, bidTotal, askTotal);
  const y = (quantity: number) => 88 - (quantity / maxDepth) * 72;

  let cumulative = 0;
  const bidPoints = bids.map((row) => ({ x: x(row.price), y: y(cumulative += row.quantity) })).sort((a, b) => a.x - b.x);
  cumulative = 0;
  const askPoints = asks.map((row) => ({ x: x(row.price), y: y(cumulative += row.quantity) })).sort((a, b) => a.x - b.x);
  const steppedArea = (points: Array<{ x: number; y: number }>) => {
    if (!points.length) return '';
    let path = `M${points[0].x.toFixed(2)} 88 L${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
    for (let index = 1; index < points.length; index += 1) {
      path += ` H${points[index].x.toFixed(2)} V${points[index].y.toFixed(2)}`;
    }
    return `${path} L${points.at(-1)!.x.toFixed(2)} 88 Z`;
  };
  const bestBidX = bids.length ? x(bids[0].price) : 50;
  const bestAskX = asks.length ? x(asks[0].price) : 50;

  return (
    <div className={cx('market-depth-mountain relative overflow-hidden rounded-[3px]', className)}
         role="img" aria-label={`${formatInteger(bidTotal)} bid units and ${formatInteger(askTotal)} ask units in visible depth`}>
      <div className="market-depth-caption"><span className="text-good">{formatInteger(bidTotal)} bid units</span><span>Cumulative depth</span><span className="text-bad">{formatInteger(askTotal)} ask units</span></div>
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {[28, 48, 68, 88].map((line) => <path key={line} d={`M5 ${line}H95`} stroke="rgb(var(--rune) / .07)" vectorEffect="non-scaling-stroke" />)}
        {bestAskX > bestBidX && <rect x={bestBidX} y="10" width={bestAskX - bestBidX} height="78" fill="rgb(var(--arcane) / .055)" />}
        {bidPoints.length > 0 && <path d={steppedArea(bidPoints)} fill="rgb(var(--good) / .15)" stroke="rgb(var(--good) / .78)" strokeWidth="1.3" vectorEffect="non-scaling-stroke" />}
        {askPoints.length > 0 && <path d={steppedArea(askPoints)} fill="rgb(var(--bad) / .14)" stroke="rgb(var(--bad) / .78)" strokeWidth="1.3" vectorEffect="non-scaling-stroke" />}
        <path d={`M${bestBidX} 10V88 M${bestAskX} 10V88`} stroke="rgb(var(--arcane) / .28)" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="market-depth-axis"><span>{format(minPrice)}{unit}</span><span>spread</span><span>{format(maxPrice)}{unit}</span></div>
    </div>
  );
}

/** Price ladder beneath the cumulative depth view. */
function DepthList({ label, rows, tone, onPick, action, unit, format, formatSize, houseNote }: {
  label: string; tone: 'good' | 'bad'; rows: MarketDepthRow[];
  onPick: (price: number) => void; action: string;
  unit: string; format: (value: number) => string; formatSize?: (value: number) => string;
  /* The venue supplies the sentence for a level's size, so a ladder can say
     what its own levels mean rather than assuming resting player orders. */
  houseNote?: (row: { quantity: number; orders: number; house: number }) => string;
}) {
  /* The deployed view may still publish one row per order. Collapse it here so
     the ladder always reads as price levels while the process moves to the
     smaller aggregated contract described in ORDERBOOK.md. */
  const shown = aggregateDepth(rows, tone).slice(0, 8);
  const peak = Math.max(1, ...shown.map((row) => row.quantity));
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
              <button type="button" title={`${action} at ${format(row.price)} ${unit}`}
                      onClick={() => onPick(row.price)} className="market-depth-row">
                <span aria-hidden="true"
                      className={cx('absolute inset-y-0 left-0', tone === 'good' ? 'bg-good/10' : 'bg-bad/10')}
                      style={{ width: `${(row.quantity / peak) * 100}%` }} />
                <span className={cx('relative', tone === 'good' ? 'text-good' : 'text-bad')}>{format(row.price)}</span>
                <span className="relative text-faint" title={note(row)}>
                  &times; {size(row.quantity)}
                  {/* The house is in the same ladder as everyone else, so the
                      only honest way to show it is here, on the level it is
                      quoting — not in a second tab the player has to compare. */}
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
 * The external book.
 *
 * The same instrument as the trading floor, funded differently: Gold the realm
 * issues on the internal one, tokens out of your wallet here. When its process
 * is deployed this becomes the same three panels drawn by the same components,
 * because it IS the same book -- resting bids and asks, price then time.
 *
 * What it is not, and never was in any honest sense, is a pool. The
 * constant-product AMM that used to sit here has been deleted: it held no
 * value, it was never configured, and a curve is not what this game trades on.
 * Nothing fills until somebody is on the other side, which is the correct
 * behaviour for a book rather than a gap in one.
 *
 * Moving Rune across the bridge is not trading, so it stays on this screen only
 * because it has nowhere better to live yet.
 */
function ExternalBook() {
  const { address, player, connect, run: runGame, refresh: refreshGame } = useGame();
  const toast = useToast();
  const [quoteInfo, setQuoteInfo] = useState<TokenInfo | null>(null);
  const [balances, setBalances] = useState({ base: '0', quote: '0' });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState('');
  const [bridgeAmount, setBridgeAmount] = useState('');

  const refresh = useCallback(async () => {
    setError(null);
    if (!exchangeConfigured()) return;
    try {
      const [relicInfo, runeBalance, relicBalance] = await Promise.all([
        readTokenInfo(QUOTE_PROCESS),
        address ? readTokenBalance(RUNE_PROCESS, address) : '0',
        address ? readTokenBalance(QUOTE_PROCESS, address) : '0',
      ]);
      setQuoteInfo(relicInfo);
      setBalances({ base: runeBalance, quote: relicBalance });
    } catch (caught) { setError(caught); }
  }, [address]);

  useEffect(() => { void refresh(); }, [refresh]);

  const run = async (key: string, action: () => Promise<unknown>, success: string) => {
    setBusy(key); setError(null);
    try { await action(); toast.success(success); await refresh(); }
    catch (caught) { setError(caught); toast.error(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(''); }
  };

  const quoteTicker = quoteInfo?.Ticker ?? 'TEST-RELIC';
  const quoteDenomination = Number(quoteInfo?.Denomination ?? 6);
  const bridgeParsed = tryParseUnits(bridgeAmount, 0);
  const gameRune = player?.inventory?.rune ?? 0;
  const needWallet = (action: () => void) => { if (!address) connect(); else action(); };

  const doWithdraw = async () => {
    const value = Number(bridgeAmount);
    if (!Number.isSafeInteger(value) || value <= 0) { setError(new Error('Enter a positive whole Rune amount.')); return; }
    const result = await runGame('rune-withdraw', () => game.withdrawRune(value), `${formatInteger(value)} Rune is moving to your wallet.`);
    if (result) { setBridgeAmount(''); window.setTimeout(() => void refresh(), 1200); }
  };
  const doGameDeposit = () => {
    if (!bridgeParsed.value) { setError(new Error(bridgeParsed.error || 'Enter a positive Rune amount.')); return; }
    void run('game-deposit', async () => {
      await depositRuneToGame(bridgeParsed.value!);
      window.setTimeout(() => void refreshGame(), 1200);
    }, `${bridgeAmount} Rune burned into your game balance.`).then(() => setBridgeAmount(''));
  };

  if (!exchangeConfigured()) {
    return (
      <Panel>
        <Empty icon={<Exchange />} title="The external venue needs its process ids">
          Configure the Rune and quote token processes before enabling anything here.
        </Empty>
      </Panel>
    );
  }

  return (
    <div className="market-goods market-external">
      <MarketHealthStrip
        lead={<div className="text-sm font-medium">{`TEST-RUNE / ${quoteTicker}`}</div>}
        stats={[
          { label: 'Wallet TEST-RUNE', value: formatToken(balances.base, 0), tone: 'text-rune' },
          { label: `Wallet ${quoteTicker}`, value: formatToken(balances.quote, quoteDenomination), tone: 'text-arcane' },
          { label: 'Order book', value: 'Not deployed', tone: 'text-warn' },
        ]} />

      <Panel className="mt-2.5" data-tour="external-book">
        <Empty icon={<Exchange />} title="The external order book is not deployed yet">
          It will be the same book as the trading floor — the same ladder, the same
          ticket, the same price-time priority — and the only difference will be what
          funds it: game Gold there, real tokens here. There is no pool and no market
          maker; liquidity is whatever bids and asks people leave resting.
        </Empty>
      </Panel>

      {/* The bridge is real today and is not part of the book: Rune moves between
          your game balance and your wallet by minting and burning, whether or not
          anything is trading. */}
      <Panel className="mt-2.5">
        <BridgeCard title="Rune bridge" from="Game balance" to="Wallet">
          <div className="grid gap-2">
            <TokenInput label="Rune" ticker="TEST-RUNE" value={bridgeAmount} onChange={setBridgeAmount}
                        balance={formatInteger(gameRune)} onMax={() => setBridgeAmount(String(gameRune))} />
            <div className="flex gap-2">
              <Button busy={busy === 'rune-withdraw'} onClick={() => needWallet(() => void doWithdraw())}>
                Withdraw to wallet
              </Button>
              <Button variant="quiet" busy={busy === 'game-deposit'} onClick={() => needWallet(doGameDeposit)}>
                Deposit into game
              </Button>
            </div>
          </div>
        </BridgeCard>
        {quoteInfo?.FaucetAmount && (
          <div className="mt-2.5">
            <Button size="sm" variant="quiet" busy={busy === 'faucet'}
                    onClick={() => needWallet(() => void run('faucet', claimQuoteFaucet, `${quoteTicker} claimed.`))}>
              {`Claim ${quoteTicker} from the faucet`}
            </Button>
          </div>
        )}
        {error ? <div className="mt-2.5"><ErrorNote error={error} onRetry={() => void refresh()} /></div> : null}
      </Panel>
    </div>
  );
}

function TokenInput({ label, ticker, value, onChange, balance, onMax }: {
  label: string; ticker: string; value: string; onChange: (value: string) => void; balance?: string; onMax?: () => void;
}) {
  return (
    <label className="market-token-input block rounded-[3px] border border-edge bg-void/30 p-3.5 focus-within:border-element/55">
      <span className="mb-2 flex items-center justify-between gap-3 text-xs text-faint"><span>{label}</span>
        {balance !== undefined && <button type="button" onClick={onMax} className="font-mono hover:text-element">Wallet {balance}{onMax ? ' / max' : ''}</button>}
      </span>
      <span className="flex items-center gap-3">
        <input className="min-w-0 flex-1 bg-transparent font-mono text-2xl text-ink outline-none placeholder:text-faint" inputMode="decimal" placeholder="0" value={value} onChange={(event) => onChange(event.target.value)} />
        <Badge tone="element"><Rune className="h-3 w-3" />{ticker}</Badge>
      </span>
    </label>
  );
}

function BridgeCard({ title, from, to, children }: { title: string; from: string; to: string; children: React.ReactNode }) {
  return <div className="rounded-[3px] border border-edge bg-void/25 p-4"><h4 className="text-sm font-semibold">{title}</h4><div className="mt-3 flex items-center gap-2 text-[11px] text-faint"><span className="min-w-0 truncate">{from}</span><Arrow className="h-3.5 w-3.5 shrink-0 text-element" /><span className="min-w-0 truncate">{to}</span></div>{children}</div>;
}

// Shared market pieces -------------------------------------------------------

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

function tryParseUnits(value: string, denomination: number): { value: string | null; error: string } {
  if (!value.trim()) return { value: null, error: '' };
  try { return { value: parseUnits(value, denomination), error: '' }; }
  catch (caught) { return { value: null, error: caught instanceof Error ? caught.message : String(caught) }; }
}

function formatToken(value: string | bigint, denomination: number): string { return formatUnits(value, denomination, 4); }
function formatInteger(value: number): string { return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value); }
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
