import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useGame } from '../state/gameContext';
import { isAbort } from '../state/usePoll';
import * as game from '../lib/game';
import {
  QUOTE_PROCESS, RUNE_PROCESS,
  AmmDeposit, AmmPool, AmmSwap, TokenInfo, addLiquidity, claimQuoteFaucet,
  depositRuneToGame, depositToken, exchangeConfigured, formatUnits, parseUnits,
  quoteFromPool, readDeposit, readPool, readSwaps, readTokenBalance, readTokenInfo,
  refundDeposit, removeLiquidity, swap,
} from '../lib/marketplace';
import {
  EconomyDesk, EconomyFill, EconomyMarketStats, EconomyOrder, EconomyView, Element,
  GoldMarketItemId, GoldOrderSide, Listing, Monster, Sale,
} from '../lib/types';
import { ELEMENT_LABEL, ITEM_NAME, shortAddress } from '../lib/format';
import { Badge, Button, Empty, ErrorNote, Panel, Skeleton, Spinner, cx } from '../ui/primitives';
import { Dialog } from '../ui/Dialog';
import { CardPreview } from '../ui/CardPreview';
import { CardViewer } from '../ui/CardViewer';
import { ITEM_ART } from '../ui/art';
import { useToast } from '../ui/toastContext';
import { useTourSteps, type TourStep } from '../ui/tourContext';
import { Arrow, ELEMENT_ICON, Exchange, Refresh, Rune, Sparkle, Wallet } from '../ui/icons';
import { MarketForge, MarketForgeMode } from '../ui/MarketForge';
import { economyPreview } from '../lib/economy-preview';

type MarketTab = 'goods' | 'rune' | 'monsters';
type MonsterSort = 'recent' | 'price-low' | 'price-high' | 'level' | 'attack' | 'defense';
type RuneDesk = 'trade' | 'bridge' | 'pool';

const ELEMENTS: Element[] = ['fire', 'water', 'air', 'rock'];
const EMPTY_DEPOSIT = (address = ''): AmmDeposit => ({ address, base: '0', quote: '0', shares: '0' });
const inputClass = 'h-11 w-full rounded-[3px] border border-edge bg-void/35 px-3 ' +
  'font-mono text-sm text-ink outline-none placeholder:text-faint focus:border-element/60';

/**
 * The market's walkthrough.
 *
 * Three sentences, and each one is about a rule rather than a control: which
 * counter you are standing at, who is setting the price, and what the fee is.
 * Those are the things that cost somebody gold when they are not known.
 *
 * **It states the seller fee and what each desk is.** If the fee changes, or a
 * desk is added, or the shop stops being fixed-price, this list is part of that
 * change — see the note at the head of `ui/Tour.tsx`.
 */
const MARKET_TOUR: TourStep[] = [
  {
    target: '[data-tour="market-tabs"]',
    title: 'Three counters',
    body: 'Goods is berries and scrolls for gold. Rune is the token itself — bridge it, pool it, trade it. Monsters is companions changing hands.',
  },
  {
    target: '[data-tour="market-desks"]',
    title: 'Who sets the price',
    body: 'The realm’s shop is fixed price and always there. The trading floor is other players’ limit orders, and it charges the seller 2%.',
  },
  {
    target: '[data-tour="market-purse"]',
    title: 'What you are spending',
    body: 'Gold is what the goods counter takes, and it is not Rune. Your satchel underneath is what you have to sell.',
  },
];

export default function Marketplace() {
  useTourSteps('market', MARKET_TOUR);
  const [tab, setTab] = useState<MarketTab>('goods');

  return (
    <div className="market-screen animate-rise space-y-4">
      <nav aria-label="Market sections" role="tablist"
           data-tour="market-tabs"
           className="market-tabs grid grid-cols-3 gap-1 rounded-[4px] border border-edge bg-surface/75 p-1">
        <MarketTabButton active={tab === 'goods'} onClick={() => setTab('goods')}
                         icon={<Exchange className="h-4 w-4" />}>
          Goods
        </MarketTabButton>
        <MarketTabButton active={tab === 'rune'} onClick={() => setTab('rune')}
                         icon={<Rune className="h-4 w-4" />}>
          Rune
        </MarketTabButton>
        <MarketTabButton active={tab === 'monsters'} onClick={() => setTab('monsters')}
                         icon={<Sparkle className="h-4 w-4" />}>
          Monsters
        </MarketTabButton>
      </nav>

      <div role="tabpanel" className="market-tabpanel">
        {tab === 'goods' ? <GoodsMarket /> : tab === 'rune' ? <RuneExchange /> : <MonsterMarket />}
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

/** What the thing does. A tooltip now — the tiles are art and numbers. */
const ITEM_BLURB: Partial<Record<GoldMarketItemId, string>> = {
  fire_berry: '+5 attack for four battles',
  water_berry: '+5 health for four battles',
  air_berry: '+5 speed for four battles',
  rock_berry: '+5 defense for four battles',
  scroll: 'Calls a defeated creature into your collection',
  rune: 'The realm currency: arena, hunts and cards',
};

type GoodsDesk = 'shop' | 'floor';
type FloorRange = '24h' | '7d' | '30d';

const RANGE_MS: Record<FloorRange, number> = {
  '24h': 24 * 3600_000, '7d': 7 * 24 * 3600_000, '30d': 30 * 24 * 3600_000,
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

function GoodsMarket() {
  const { address, player, connect, connecting, run, isPending, refresh } = useGame();
  const [economy, setEconomy] = useState<EconomyView | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [deskTab, setDeskTab] = useState<GoodsDesk>('shop');
  const [item, setItem] = useState<GoldMarketItemId>('fire_berry');
  const [side, setSide] = useState<GoldOrderSide>('buy');
  const [range, setRange] = useState<FloorRange>('7d');
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [counts, setCounts] = useState<Partial<Record<GoldMarketItemId, number>>>({});

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
    const result = await run('gold-order', () => game.placeGoldOrder(side, item, unit, count),
      `${side === 'buy' ? 'Bid' : 'Ask'} entered for ${formatInteger(count)} ${ITEM_NAME[item]}.`);
    if (result) { setPrice(''); await Promise.all([load(), refresh()]); }
  };

  const shopTrade = async (id: GoldMarketItemId, tradeSide: GoldOrderSide, count: number) => {
    const result = await run(`npc-${tradeSide}-${id}`, () => game.tradeGameShop(tradeSide, id, count),
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

  return (
    <div className="market-goods">
      <GoodsDeskChooser desk={deskTab} onDesk={setDeskTab}
                        gold={gold} liveOrders={economy.orders.length} />

      {error !== null && <ErrorNote error={error} onRetry={() => void load()} />}

      {deskTab === 'shop' ? (
        <RealmShop economy={economy} gold={gold} inventory={player?.inventory}
                   connected={Boolean(address)} connecting={connecting} onConnect={connect}
                   counts={counts} onCount={(id, value) => setCounts((current) => ({ ...current, [id]: value }))}
                   isPending={isPending} onTrade={shopTrade} onRefresh={() => void load()} />
      ) : (
        <TradingFloor economy={economy} address={address} item={item} onItem={setItem}
                      range={range} onRange={setRange} side={side} onSide={setSide}
                      price={price} onPrice={setPrice} quantity={quantity} onQuantity={setQuantity}
                      ownOrders={ownOrders} connecting={connecting} onConnect={connect}
                      isPending={isPending} onSubmit={() => void submitOrder()}
                      onCancel={(id) => void cancel(id)} />
      )}
    </div>
  );
}

/**
 * The chooser. Carved bone-gold for the realm's own counter — the wordmark's
 * colour, the realm's voice — against arcane violet for the floor, which is
 * the only place in the app where a number moving is somebody else's decision.
 */
function GoodsDeskChooser({ desk, onDesk, gold, liveOrders }: {
  desk: GoodsDesk; onDesk: (desk: GoodsDesk) => void; gold: number; liveOrders: number;
}) {
  return (
    <div role="tablist" aria-label="Goods desks" data-tour="market-desks"
         className="market-desks grid gap-2 sm:grid-cols-2">
      <button type="button" role="tab" aria-selected={desk === 'shop'} onClick={() => onDesk('shop')}
              className={cx('market-desk-choice market-desk-shop', desk === 'shop' && 'is-active')}>
        <span className="eyebrow">Fixed price &middot; the realm sets it</span>
        <span className="market-desk-title font-display">The realm&rsquo;s shop</span>
        <span className="market-desk-note">Trade against the game. Nobody bids against you.</span>
        <span className="market-desk-stat">
          <b className="font-mono text-rune">{formatInteger(gold)}</b> gold in your purse
        </span>
      </button>
      <button type="button" role="tab" aria-selected={desk === 'floor'} onClick={() => onDesk('floor')}
              className={cx('market-desk-choice market-desk-floor', desk === 'floor' && 'is-active')}>
        <span className="eyebrow">Live book &middot; players set the price</span>
        <span className="market-desk-title font-mono">Trading floor</span>
        <span className="market-desk-note">Limit orders against other players. 2% seller fee.</span>
        <span className="market-desk-stat">
          <b className="font-mono text-arcane">{formatInteger(liveOrders)}</b> orders live on the book
        </span>
      </button>
    </div>
  );
}

// The realm's shop ----------------------------------------------------------

function RealmShop({
  economy, gold, inventory, connected, connecting, onConnect,
  counts, onCount, isPending, onTrade, onRefresh,
}: {
  economy: EconomyView; gold: number; inventory: Partial<Record<GoldMarketItemId, number>> | undefined;
  connected: boolean; connecting: boolean; onConnect: () => void;
  counts: Partial<Record<GoldMarketItemId, number>>;
  onCount: (item: GoldMarketItemId, value: number) => void;
  isPending: (key: string) => boolean;
  onTrade: (item: GoldMarketItemId, side: GoldOrderSide, count: number) => Promise<void>;
  onRefresh: () => void;
}) {
  return (
    <div className="market-goods-body market-shop grid gap-2.5 lg:grid-cols-[minmax(0,1fr)_16rem]">
      <div className="market-shop-stock grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
        {GOLD_ITEMS.map((id) => (
          <ShopTile key={id} item={id} desk={economy.desks[id]} gold={gold}
                    held={inventory?.[id] ?? 0} count={counts[id] ?? 1}
                    onCount={(value) => onCount(id, value)}
                    connected={connected} connecting={connecting} onConnect={onConnect}
                    busyBuy={isPending(`npc-buy-${id}`)} busySell={isPending(`npc-sell-${id}`)}
                    onBuy={() => void onTrade(id, 'buy', counts[id] ?? 1)}
                    onSell={() => void onTrade(id, 'sell', counts[id] ?? 1)} />
        ))}
      </div>
      <PurseRail gold={gold} inventory={inventory} ok={economy.invariants.ok} onRefresh={onRefresh} />
    </div>
  );
}

/**
 * One good, as a counter tile: what it is, how many the shop has left, and the
 * two prices as struck plaques you press. The prices are the buttons because
 * in a shop the price tag IS the offer, and a separate row of verbs underneath
 * only repeated it.
 */
function ShopTile({
  item, desk, held, gold, count, onCount, connected, connecting, onConnect,
  busyBuy, busySell, onBuy, onSell,
}: {
  item: GoldMarketItemId; desk: EconomyDesk | undefined; held: number; gold: number;
  count: number; onCount: (value: number) => void;
  connected: boolean; connecting: boolean; onConnect: () => void;
  busyBuy: boolean; busySell: boolean; onBuy: () => void; onSell: () => void;
}) {
  const buyPaused = pausedFor(desk, 'buy');
  const sellPaused = pausedFor(desk, 'sell');
  const ask = desk?.ask ?? 0;
  const bid = desk?.bid ?? 0;
  const perAction = Math.max(1, desk?.limits?.perAction ?? 1);
  const cap = Math.max(1, desk?.stockCap ?? 1);
  const stock = desk?.stock ?? 0;
  const cost = ask * count;
  const short = gold < cost;

  return (
    <Panel data-element={ITEM_ELEMENT[item]} className="market-tile flex min-h-0 flex-col p-3">
      <div className="flex items-baseline gap-2">
        <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold leading-tight">{ITEM_NAME[item]}</h3>
        <span title="In your satchel"
              className="shrink-0 rounded-[2px] border border-edge px-1.5 py-0.5 font-mono text-[10px] text-muted">
          &times;{formatInteger(held)}
        </span>
      </div>

      {/* The goods are the shelf. Whatever height the row has goes to the art. */}
      <span className="market-tile-art mt-2 grid min-h-[5rem] flex-1 place-items-center p-2"
            title={ITEM_BLURB[item]}>
        <ItemGlyph item={item} className="h-full max-h-[8.5rem] w-auto max-w-[58%]" />
      </span>

      <div className="mt-2 flex items-center gap-1.5">
        <StockPips value={stock} max={cap} />
        <span className="font-mono text-[10px] text-faint">{formatInteger(stock)}/{formatInteger(cap)} in stock</span>
      </div>

      {!desk ? (
        <p className="pt-2 text-[11px] text-faint">Not stocked. Floor only.</p>
      ) : !connected ? (
        <Button className="mt-2 w-full" size="sm" variant="primary" busy={connecting}
                onClick={onConnect} icon={<Wallet className="h-3.5 w-3.5" />}>Connect</Button>
      ) : (
        <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-1.5">
          <Plaque tone="buy" label={buyPaused ? 'Closed' : 'Buy'} value={ask} busy={busyBuy}
                  disabled={Boolean(buyPaused) || !ask || short} onClick={onBuy}
                  title={buyPaused ?? (short ? `Need ${formatInteger(cost - gold)} more Gold` : `Buy ${count} for ${formatInteger(cost)} Gold`)} />
          <Stepper value={count} max={perAction} onChange={onCount} label={ITEM_NAME[item]} />
          <Plaque tone="sell" label={sellPaused ? 'Closed' : 'Sell'} value={bid} busy={busySell}
                  disabled={Boolean(sellPaused) || !bid || held < count} onClick={onSell}
                  title={sellPaused ?? (held < count ? `You only have ${formatInteger(held)}` : `Sell ${count} for ${formatInteger(bid * count)} Gold`)} />
        </div>
      )}
    </Panel>
  );
}

function Plaque({ tone, label, value, busy, disabled, title, onClick }: {
  tone: 'buy' | 'sell'; label: string; value: number; busy: boolean;
  disabled: boolean; title?: string; onClick: () => void;
}) {
  return (
    <button type="button" title={title} disabled={disabled || busy} onClick={onClick}
            className={cx('market-plaque', tone === 'buy' ? 'is-buy' : 'is-sell')}>
      <span className="market-plaque-label">{label}</span>
      <span className="market-plaque-value">
        {busy ? <Spinner className="h-4 w-4" /> : <>{value ? formatInteger(value) : '--'}<i className="market-plaque-unit">g</i></>}
      </span>
    </button>
  );
}

/** Eight pips, not a percentage bar: a shop counts things, it does not measure. */
function StockPips({ value, max }: { value: number; max: number }) {
  const ratio = Math.max(0, Math.min(1, value / Math.max(1, max)));
  const lit = value > 0 ? Math.max(1, Math.round(ratio * 8)) : 0;
  return (
    <span className="flex gap-[2px]" aria-hidden="true">
      {[0, 1, 2, 3, 4, 5, 6, 7].map((index) => (
        <span key={index} className={cx('h-1.5 w-1.5 rounded-[1px]', index < lit ? 'bg-element' : 'bg-edge/70')} />
      ))}
    </span>
  );
}

function PurseRail({ gold, inventory, ok, onRefresh }: {
  gold: number; inventory: Partial<Record<GoldMarketItemId, number>> | undefined;
  ok: boolean; onRefresh: () => void;
}) {
  return (
    <Panel data-tour="market-purse" className="market-purse flex min-h-0 flex-col p-3.5">
      <div className="eyebrow">Your purse</div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="font-mono text-3xl leading-none text-rune">{formatInteger(gold)}</span>
        <span className="eyebrow">gold</span>
      </div>
      <div className="eyebrow mt-4">Satchel</div>
      <ul className="mt-1.5 min-h-0 flex-1 space-y-0.5 overflow-y-auto">
        {GOLD_ITEMS.map((id) => {
          const count = inventory?.[id] ?? 0;
          return (
            <li key={id} data-element={ITEM_ELEMENT[id]}
                className="flex items-center gap-2 rounded-[2px] px-1 py-1">
              <ItemGlyph item={id} className={cx('h-5 w-5', !count && 'opacity-40')} />
              <span className="min-w-0 flex-1 truncate text-[11px] text-muted">{ITEM_NAME[id]}</span>
              <span className={cx('font-mono text-[11px]', count ? 'text-ink' : 'text-faint')}>{formatInteger(count)}</span>
            </li>
          );
        })}
      </ul>
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-rune/15 pt-3">
        <Badge tone={ok ? 'good' : 'bad'}>{ok ? 'Balanced' : 'Paused'}</Badge>
        <Button size="sm" variant="quiet" onClick={onRefresh}
                icon={<Refresh className="h-3.5 w-3.5" />}>Refresh</Button>
      </div>
    </Panel>
  );
}

// Trading floor -------------------------------------------------------------

function TradingFloor({
  economy, address, item, onItem, range, onRange, side, onSide,
  price, onPrice, quantity, onQuantity, ownOrders, connecting, onConnect,
  isPending, onSubmit, onCancel,
}: {
  economy: EconomyView; address: string | null;
  item: GoldMarketItemId; onItem: (item: GoldMarketItemId) => void;
  range: FloorRange; onRange: (range: FloorRange) => void;
  side: GoldOrderSide; onSide: (side: GoldOrderSide) => void;
  price: string; onPrice: (value: string) => void;
  quantity: string; onQuantity: (value: string) => void;
  ownOrders: EconomyOrder[]; connecting: boolean; onConnect: () => void;
  isPending: (key: string) => boolean; onSubmit: () => void; onCancel: (orderId: string) => void;
}) {
  const now = Date.now();
  const from = now - RANGE_MS[range];
  const series = useMemo(() => seriesByItem(economy.fills, from), [economy.fills, from]);
  const book = economy.market[item];
  const points = series[item] ?? [];

  return (
    <div className="market-goods-body market-floor flex min-h-0 flex-col gap-2.5">
      <div className="market-floor-strip grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {GOLD_ITEMS.map((id) => (
          <FloorTile key={id} item={id} active={item === id} onClick={() => onItem(id)}
                     stats={economy.market[id]} points={series[id] ?? []} />
        ))}
      </div>

      <div className="market-floor-body grid min-h-0 flex-1 gap-2.5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,.85fr)_18rem]">
        <Panel className="flex min-h-0 flex-col overflow-hidden p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-mono text-sm tracking-tight">
              {ITEM_NAME[item]} <span className="text-faint">/ Gold</span>
            </h3>
            <div className="flex gap-1">
              {(['24h', '7d', '30d'] as FloorRange[]).map((value) => (
                <button key={value} type="button" aria-pressed={range === value} onClick={() => onRange(value)}
                        className={cx(
                          'rounded-[2px] border px-2 py-1 font-mono text-[10px] uppercase transition-colors',
                          range === value ? 'border-arcane/60 bg-arcane/12 text-arcane'
                                          : 'border-edge text-faint hover:text-ink',
                        )}>{value}</button>
              ))}
            </div>
          </div>
          <MarketTicker book={book} points={points} />
          <PriceChart className="mt-2.5 min-h-[15rem] flex-1 lg:min-h-0" points={points} from={from} to={now}
                      bid={book?.bestBid} ask={book?.bestAsk} />
        </Panel>

        <Panel className="flex min-h-0 flex-col overflow-hidden p-3.5">
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[3px] border border-arcane/15 bg-arcane/12 p-px">
            <BookPrice label="Best bid" value={book?.bestBid} tone="good" />
            <BookPrice label="Best ask" value={book?.bestAsk} tone="bad" />
          </div>
          <div className="mt-3 grid min-h-0 flex-1 grid-cols-2 gap-4 overflow-y-auto">
            <DepthList label="Bids" tone="good" rows={book?.depth.bids ?? []} />
            <DepthList label="Asks" tone="bad" rows={book?.depth.asks ?? []} />
          </div>
        </Panel>

        <Panel className="flex min-h-0 flex-col overflow-hidden p-3.5">
          <div className="grid grid-cols-2 gap-1.5">
            <Button size="sm" variant={side === 'buy' ? 'primary' : 'quiet'} onClick={() => onSide('buy')}>Bid</Button>
            <Button size="sm" variant={side === 'sell' ? 'primary' : 'quiet'} onClick={() => onSide('sell')}>Ask</Button>
          </div>
          <label className="mt-2.5 block"><span className="eyebrow mb-1 block">Unit price / Gold</span>
            <input className={inputClass} inputMode="numeric" value={price} placeholder="0"
                   onChange={(event) => onPrice(event.target.value)} /></label>
          <label className="mt-2 block"><span className="eyebrow mb-1 block">Quantity</span>
            <input className={inputClass} inputMode="numeric" value={quantity}
                   onChange={(event) => onQuantity(event.target.value)} /></label>
          {!address
            ? <Button className="mt-2.5 w-full" variant="primary" busy={connecting} onClick={onConnect}
                      icon={<Wallet className="h-4 w-4" />}>Connect to trade</Button>
            : <Button className="mt-2.5 w-full" variant="primary" busy={isPending('gold-order')} onClick={onSubmit}>
                Place {side === 'buy' ? 'bid' : 'ask'}
              </Button>}
          <div className="eyebrow mt-4">Your open orders</div>
          <ul className="mt-1.5 min-h-0 flex-1 space-y-1 overflow-y-auto">
            {ownOrders.length === 0
              ? <li className="py-2 text-[11px] text-faint">Nothing of yours on the book.</li>
              : ownOrders.map((order) => (
                <li key={order.id} className="flex items-center gap-2 rounded-[2px] border border-edge/70 px-2 py-1.5">
                  <ItemGlyph item={order.item} className="h-4 w-4" />
                  <span className="min-w-0 flex-1 font-mono text-[10px]">
                    <b className={order.side === 'buy' ? 'text-good' : 'text-bad'}>{order.side === 'buy' ? 'BID' : 'ASK'}</b>{' '}
                    {order.remaining}/{order.quantity} @ {formatInteger(order.price)}
                  </span>
                  <Button size="sm" variant="quiet" busy={isPending(`gold-cancel-${order.id}`)}
                          onClick={() => onCancel(order.id)}>&times;</Button>
                </li>
              ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}

/** Every pair at once: last, move over the window, and the shape of the move. */
function FloorTile({ item, active, onClick, stats, points }: {
  item: GoldMarketItemId; active: boolean; onClick: () => void;
  stats?: EconomyMarketStats; points: PricePoint[];
}) {
  const last = points.at(-1)?.v ?? stats?.bestAsk ?? stats?.bestBid;
  const first = points[0]?.v;
  const change = first && last ? ((last - first) / first) * 100 : 0;
  const tone = change >= 0 ? 'good' : 'bad';
  return (
    <button type="button" aria-pressed={active} onClick={onClick}
            className={cx('market-floor-tile', active && 'is-active')}>
      <span className="flex items-center gap-1.5">
        <ItemGlyph item={item} className="h-4 w-4" />
        <span className="min-w-0 truncate font-mono text-[10px] uppercase tracking-wide text-muted">{ITEM_NAME[item]}</span>
      </span>
      <span className="mt-1 flex items-baseline gap-1.5">
        <span className="font-mono text-base leading-none">{last ? formatInteger(last) : '--'}</span>
        {points.length > 1 && (
          <span className={cx('font-mono text-[10px]', tone === 'good' ? 'text-good' : 'text-bad')}>
            {change >= 0 ? '+' : ''}{change.toFixed(1)}%
          </span>
        )}
      </span>
      <Spark points={points} tone={tone} className="mt-1.5 h-6 w-full" />
    </button>
  );
}

function Spark({ points, tone, className }: { points: PricePoint[]; tone: 'good' | 'bad'; className?: string }) {
  if (points.length < 2) {
    return <span className={cx('grid place-items-center font-mono text-[9px] text-faint', className)}>no fills</span>;
  }
  const xs = points.map((point) => point.t);
  const ys = points.map((point) => point.v);
  const x0 = Math.min(...xs); const spanX = Math.max(...xs) - x0 || 1;
  const y0 = Math.min(...ys); const spanY = Math.max(...ys) - y0 || 1;
  const path = points.map((point, index) =>
    `${index ? 'L' : 'M'}${((point.t - x0) / spanX * 100).toFixed(2)} ${(100 - (point.v - y0) / spanY * 100).toFixed(2)}`,
  ).join(' ');
  return (
    <svg className={className} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <path d={`${path} L100 100 L0 100 Z`} fill={`rgb(var(--${tone}) / .14)`} />
      <path d={path} fill="none" stroke={`rgb(var(--${tone}))`} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
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
function PriceChart({ points, from, to, bid, ask, className }: {
  points: PricePoint[]; from: number; to: number;
  bid?: number; ask?: number; className?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = canvas.current;
    const frame = host.current;
    if (!element || !frame) return undefined;
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
      const pad = { left: 6, right: 44, top: 16, bottom: 18 };
      const plotW = Math.max(1, width - pad.left - pad.right);
      const plotH = Math.max(1, height - pad.top - pad.bottom);
      ctx.clearRect(0, 0, width, height);

      const values = [...points.map((point) => point.v), bid, ask]
        .filter((value): value is number => typeof value === 'number' && value > 0);
      const low = values.length ? Math.min(...values) : 0;
      const high = values.length ? Math.max(...values) : 1;
      const margin = (high - low) * 0.15 || Math.max(1, high * 0.15);
      const top = high + margin; const bottom = Math.max(0, low - margin);
      const y = (value: number) => pad.top + (1 - (value - bottom) / (top - bottom || 1)) * plotH;
      const x = (time: number) => pad.left + ((time - from) / (to - from || 1)) * plotW;

      // A rule per day, labelled, so the gaps between fills are readable.
      const dayMs = 86_400_000;
      ctx.font = '9px "JetBrains Mono", ui-monospace, monospace';
      ctx.textBaseline = 'top';
      for (let day = Math.ceil(from / dayMs) * dayMs; day <= to; day += dayMs) {
        const px = x(day);
        ctx.strokeStyle = 'rgba(150,122,255,.14)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(px, pad.top); ctx.lineTo(px, pad.top + plotH); ctx.stroke();
        ctx.fillStyle = 'rgba(98,108,133,.9)'; ctx.textAlign = 'center';
        ctx.fillText(new Date(day).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }), px, pad.top + plotH + 4);
      }
      for (let index = 0; index <= 3; index += 1) {
        const py = pad.top + (plotH / 3) * index;
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
        ctx.fillText(`${label} ${value}`, pad.left + plotW + 5, py);
        ctx.textBaseline = 'top';
      };
      rule(bid, 'rgb(74,210,149)', 'B');
      rule(ask, 'rgb(255,94,105)', 'A');

      if (points.length) {
        const plotted = points.map((point) => ({ x: x(point.t), y: y(point.v) }));
        if (plotted.length > 1) {
          const gradient = ctx.createLinearGradient(0, pad.top, 0, pad.top + plotH);
          gradient.addColorStop(0, 'rgba(150,122,255,.3)');
          gradient.addColorStop(1, 'rgba(150,122,255,0)');
          ctx.beginPath();
          plotted.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
          ctx.lineTo(plotted[plotted.length - 1].x, pad.top + plotH);
          ctx.lineTo(plotted[0].x, pad.top + plotH);
          ctx.closePath(); ctx.fillStyle = gradient; ctx.fill();
          ctx.beginPath();
          plotted.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
          ctx.strokeStyle = 'rgb(214,200,162)'; ctx.lineWidth = 1.6; ctx.stroke();
        }
        ctx.fillStyle = 'rgb(150,122,255)';
        plotted.forEach((point) => ctx.fillRect(point.x - 2.5, point.y - 2.5, 5, 5));
      } else {
        ctx.fillStyle = 'rgba(98,108,133,.95)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('No fills in this window', pad.left + plotW / 2, pad.top + plotH / 2);
      }
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [points, from, to, bid, ask]);

  return (
    <div ref={host} className={cx('market-price-chart relative overflow-hidden rounded-[3px]', className)}>
      <canvas ref={canvas} className="absolute inset-0 h-full w-full" aria-hidden="true" />
    </div>
  );
}

interface PricePoint { t: number; v: number }

/** Fills inside the window, per item, oldest first. */
function seriesByItem(fills: EconomyFill[], from: number): Partial<Record<GoldMarketItemId, PricePoint[]>> {
  const out: Partial<Record<GoldMarketItemId, PricePoint[]>> = {};
  for (const fill of fills ?? []) {
    if (fill.filledAt < from) continue;
    (out[fill.item] ??= []).push({ t: fill.filledAt, v: fill.price });
  }
  for (const rows of Object.values(out)) rows.sort((a, b) => a.t - b.t);
  return out;
}

/** The strip that says this half is a market: last, spread, volume, traders. */
function MarketTicker({ book, points }: { book?: EconomyMarketStats; points: PricePoint[] }) {
  const spread = book?.bestBid && book?.bestAsk ? book.bestAsk - book.bestBid : undefined;
  const last = points.at(-1)?.v;
  return (
    <dl className="market-ticker mt-2 flex flex-wrap gap-x-4 gap-y-1 border-y border-arcane/15 py-1.5">
      <Tick label="Last">{last ? formatInteger(last) : '--'}</Tick>
      <Tick label="Bid" tone="good">{book?.bestBid ? formatInteger(book.bestBid) : '--'}</Tick>
      <Tick label="Ask" tone="bad">{book?.bestAsk ? formatInteger(book.bestAsk) : '--'}</Tick>
      <Tick label="Spread">{spread === undefined ? '--' : formatInteger(spread)}</Tick>
      <Tick label="Med 7d">{book?.median7d ? formatInteger(book.median7d) : '--'}</Tick>
      <Tick label="Vol 24h">{formatInteger(book?.volume24h ?? 0)}</Tick>
      <Tick label="Vol 7d">{formatInteger(book?.volume7d ?? 0)}</Tick>
      <Tick label="Fills">{formatInteger(points.length)}</Tick>
    </dl>
  );
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

function BookPrice({ label, value, tone }: { label: string; value?: number; tone: 'good' | 'bad' }) {
  return (
    <div className="bg-void/25 px-3 py-2">
      <div className="eyebrow">{label}</div>
      <div className={cx('mt-1 font-mono text-lg leading-none',
        value ? (tone === 'good' ? 'text-good' : 'text-bad') : 'text-faint')}>
        {value ? formatInteger(value) : '--'} <span className="eyebrow">gold</span>
      </div>
    </div>
  );
}

/**
 * Depth as a bar chart. Five stacked numbers said nothing about which price
 * actually had size behind it, and size is the whole point of a book.
 */
function DepthList({ label, rows, tone }: {
  label: string; tone: 'good' | 'bad'; rows: Array<{ price: number; quantity: number }>;
}) {
  const shown = rows.slice(0, 8);
  const peak = Math.max(1, ...shown.map((row) => row.quantity));
  return (
    <div className="min-w-0">
      <div className="eyebrow mb-2">{label}</div>
      {shown.length ? (
        <ul className="space-y-1">
          {shown.map((row, index) => (
            <li key={`${row.price}-${index}`}
                className="relative flex items-center justify-between gap-3 overflow-hidden rounded-[2px] px-2 py-1 font-mono text-xs">
              <span aria-hidden="true"
                    className={cx('absolute inset-y-0 left-0', tone === 'good' ? 'bg-good/10' : 'bg-bad/10')}
                    style={{ width: `${(row.quantity / peak) * 100}%` }} />
              <span className={cx('relative', tone === 'good' ? 'text-good' : 'text-bad')}>{formatInteger(row.price)}</span>
              <span className="relative text-faint">&times; {formatInteger(row.quantity)}</span>
            </li>
          ))}
        </ul>
      ) : <p className="text-xs text-faint">No depth</p>}
    </div>
  );
}
function MarketTabButton({ active, onClick, icon, children }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode;
}) {
  // A full-bleed slab of element colour across a third of the screen was the
  // loudest thing on the page and read as a banner rather than a tab. The
  // selection is a tint and an underline now; the colour still says which one.
  return (
    <button type="button" role="tab" aria-selected={active} onClick={onClick}
            className={cx(
              'market-tab flex min-h-12 items-center justify-center gap-2 rounded-[3px] px-3 transition-colors',
              active
                ? 'bg-element/12 text-element shadow-[inset_0_-2px_0_0_rgb(var(--element))]'
                : 'text-muted hover:bg-raised hover:text-ink',
            )}>
      <span className={cx('shrink-0', active ? 'text-element' : 'text-faint')}>{icon}</span>
      <span className="text-sm font-semibold">{children}</span>
    </button>
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

function RuneExchange() {
  const { address, player, connect, connecting, run: runGame, isPending, refresh: refreshGame } = useGame();
  const toast = useToast();
  const [desk, setDesk] = useState<RuneDesk>('trade');
  const [statsOpen, setStatsOpen] = useState(false);
  const [pool, setPool] = useState<AmmPool | null>(null);
  const [deposit, setDeposit] = useState<AmmDeposit>(() => EMPTY_DEPOSIT());
  const [quoteInfo, setQuoteInfo] = useState<TokenInfo | null>(null);
  const [balances, setBalances] = useState({ base: '0', quote: '0' });
  const [swaps, setSwaps] = useState<AmmSwap[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState('');
  const [baseIn, setBaseIn] = useState(true);
  const [amount, setAmount] = useState('');
  const [slippage, setSlippage] = useState('1');
  const [bridgeAmount, setBridgeAmount] = useState('');
  const [lpBase, setLpBase] = useState('');
  const [lpQuote, setLpQuote] = useState('');

  const refresh = useCallback(async () => {
    setError(null);
    if (!exchangeConfigured()) return;
    try {
      const [nextPool, nextDeposit, relicInfo, runeBalance, relicBalance, recent] = await Promise.all([
        readPool(), address ? readDeposit(address) : null,
        readTokenInfo(QUOTE_PROCESS),
        address ? readTokenBalance(RUNE_PROCESS, address) : '0',
        address ? readTokenBalance(QUOTE_PROCESS, address) : '0',
        readSwaps().catch(() => []),
      ]);
      setPool(nextPool);
      setDeposit(nextDeposit ?? EMPTY_DEPOSIT(address ?? ''));
      setQuoteInfo(relicInfo);
      setBalances({ base: runeBalance, quote: relicBalance });
      setSwaps(recent ?? []);
    } catch (caught) { setError(caught); }
  }, [address]);

  useEffect(() => { void refresh(); }, [refresh]);

  const run = async (key: string, action: () => Promise<unknown>, success: string) => {
    setBusy(key); setError(null);
    try { await action(); toast.success(success); await refresh(); }
    catch (caught) { setError(caught); toast.error(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(''); }
  };

  if (!exchangeConfigured()) {
    return <Panel><Empty icon={<Exchange />} title="The Rune desk needs its three process ids">Configure Rune, TEST-RELIC, and the AMM process before enabling bridge or pool actions.</Empty></Panel>;
  }
  if (!pool && !error) return <div className="grid gap-4 lg:grid-cols-3"><Skeleton className="h-96 lg:col-span-2" /><Skeleton className="h-96" /></div>;
  if (!pool) return <ErrorNote error={error} onRetry={() => void refresh()} />;

  const inputToken = baseIn ? pool.baseToken : pool.quoteToken;
  const inputDenom = baseIn ? pool.baseDenomination : pool.quoteDenomination;
  const outputDenom = baseIn ? pool.quoteDenomination : pool.baseDenomination;
  const inputTicker = baseIn ? pool.baseTicker : pool.quoteTicker;
  const outputTicker = baseIn ? pool.quoteTicker : pool.baseTicker;
  const inputBalance = baseIn ? balances.base : balances.quote;
  const credited = baseIn ? deposit.base : deposit.quote;
  const parsed = tryParseUnits(amount, inputDenom);
  const quoted = parsed.value ? quoteFromPool(pool, inputToken, parsed.value) : '0';
  const slip = Math.max(0, Math.min(50, Number(slippage) || 0));
  const minimum = (BigInt(quoted) * BigInt(Math.floor((100 - slip) * 100)) / 10_000n).toString();
  const pairLive = pool.configured && BigInt(pool.reserveBase) > 0n && BigInt(pool.reserveQuote) > 0n;
  const gameRune = player?.inventory?.rune ?? 0;
  const priceSeries = swapPrices(swaps, pool);
  const forgeMode: MarketForgeMode = desk === 'trade' ? 'trade' : desk === 'bridge' ? 'bridge' : 'pool';
  const bridgeParsed = tryParseUnits(bridgeAmount, pool.baseDenomination);

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

  return (
    <div className="market-rune space-y-3">
      {error !== null && <ErrorNote error={error} onRetry={() => void refresh()} />}

      <div className="market-rune-workspace grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(25rem,1fr)]">
        <div className="market-rune-actions min-h-0">
          <Panel className="market-rune-action-panel h-full overflow-hidden">
            <div className="grid grid-cols-4 gap-px border-b border-rune/10 bg-rune/10 p-px">
              <DeskButton active={desk === 'trade'} onClick={() => setDesk('trade')} label="Trade" />
              <DeskButton active={desk === 'bridge'} onClick={() => setDesk('bridge')} label="Move Rune" />
              <DeskButton active={desk === 'pool'} onClick={() => setDesk('pool')} label="Pair" />
              <DeskButton active={false} onClick={() => setStatsOpen(true)} label="Stats" />
            </div>

            <div className="market-rune-action-content p-4 sm:p-5">
              {desk === 'trade' && (
                <div>
                  <DeskHeading title={`${pool.baseTicker} / ${pool.quoteTicker}`}
                    right={<Badge tone={pairLive ? 'good' : 'warn'}>{pairLive ? 'Ready' : 'Unfunded'}</Badge>} />
                  <div className="market-trade-form space-y-3">
                    <TokenInput label="You send" ticker={inputTicker} value={amount} onChange={setAmount}
                                balance={formatToken(inputBalance, inputDenom)}
                                onMax={() => setAmount(formatUnits(inputBalance, inputDenom, inputDenom))} />
                    <button type="button" aria-label="Reverse trading pair" onClick={() => { setBaseIn((value) => !value); setAmount(''); }}
                            className="market-swap-direction mx-auto grid h-10 w-10 place-items-center rounded-[3px] border border-edge bg-raised text-element transition-transform hover:rotate-180 hover:border-element/60">
                      <Exchange className="h-4 w-4" />
                    </button>
                    <TokenOutput ticker={outputTicker} amount={formatToken(quoted, outputDenom)}
                                 caption={parsed.error || (pairLive ? 'Live pool estimate' : 'Seed the pool before trading')} />
                    <div className="market-price-protection flex items-center justify-between gap-3 rounded-[3px] border border-edge/60 bg-void/25 p-3 text-xs text-faint">
                      <span>Price protection</span>
                      <label className="flex items-center gap-2">Slippage
                        <input className="h-8 w-16 rounded-[3px] border border-edge bg-surface px-2 font-mono text-ink"
                               inputMode="decimal" value={slippage} onChange={(event) => setSlippage(event.target.value)} />%
                      </label>
                    </div>
                    {!address ? (
                      <Button className="w-full" variant="primary" busy={connecting} onClick={connect} icon={<Wallet className="h-4 w-4" />}>Connect to trade</Button>
                    ) : (
                      <div className="grid gap-2 sm:grid-cols-2">
                        <Button busy={busy === 'swap-deposit'} disabled={!parsed.value || BigInt(parsed.value) > BigInt(inputBalance)}
                          onClick={() => parsed.value && void run('swap-deposit', () => depositToken(inputToken, parsed.value!), `${inputTicker} sent to your credited pool balance.`)}>
                          1 / Deposit {inputTicker}
                        </Button>
                        <Button variant="primary" busy={busy === 'swap'} disabled={!parsed.value || BigInt(credited) < BigInt(parsed.value) || !pairLive || pool.paused}
                          onClick={() => parsed.value && void run('swap', () => swap(inputToken, parsed.value!, minimum, Date.now() + 10 * 60_000), `Trade submitted for about ${formatToken(quoted, outputDenom)} ${outputTicker}.`)}>
                          2 / Execute trade
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {desk === 'bridge' && (
                <div>
                  <DeskHeading title="Move Rune" right={<Badge tone="plain">Whole Rune only</Badge>} />
                  <TokenInput label="Amount to move" ticker="Rune" value={bridgeAmount} onChange={setBridgeAmount} />
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <BridgeCard title="Withdraw to wallet" from={`${formatInteger(gameRune)} game Rune`} to={`${formatToken(balances.base, pool.baseDenomination)} wallet ${pool.baseTicker}`}>
                      <Button className="mt-4 w-full" variant="primary" busy={isPending('rune-withdraw')}
                              disabled={!address || !bridgeAmount || Number(bridgeAmount) > gameRune} onClick={() => needWallet(() => void doWithdraw())}>Game to wallet</Button>
                    </BridgeCard>
                    <BridgeCard title="Deposit to game" from={`${formatToken(balances.base, pool.baseDenomination)} wallet ${pool.baseTicker}`} to={`${formatInteger(gameRune)} game Rune`}>
                      <Button className="mt-4 w-full" busy={busy === 'game-deposit'}
                              disabled={!address || !bridgeParsed.value || BigInt(bridgeParsed.value ?? '0') > BigInt(balances.base)} onClick={() => needWallet(doGameDeposit)}>Wallet to game</Button>
                    </BridgeCard>
                  </div>
                </div>
              )}

              {desk === 'pool' && (
                <div>
                  <DeskHeading title={pairLive ? 'Add liquidity' : 'Create pool'} right={<Badge tone={pairLive ? 'good' : 'warn'}>{pairLive ? 'Paired' : 'Not funded'}</Badge>} />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <TokenInput label="Rune side" ticker={pool.baseTicker} value={lpBase} onChange={setLpBase} balance={formatToken(balances.base, pool.baseDenomination)} />
                    <TokenInput label="Relic side" ticker={pool.quoteTicker} value={lpQuote} onChange={setLpQuote} balance={formatToken(balances.quote, pool.quoteDenomination)} />
                  </div>
                  {!address ? (
                    <Button className="mt-4 w-full" variant="primary" busy={connecting} onClick={connect}>Connect to pair tokens</Button>
                  ) : (
                    <div className="mt-4 grid gap-2 sm:grid-cols-3">
                      <Button busy={busy === 'lp-base'} onClick={() => {
                        const value = tryParseUnits(lpBase, pool.baseDenomination);
                        if (!value.value) return setError(new Error(value.error));
                        void run('lp-base', () => depositToken(pool.baseToken, value.value!), 'Rune side deposited.');
                      }}>Deposit Rune</Button>
                      <Button busy={busy === 'lp-quote'} onClick={() => {
                        const value = tryParseUnits(lpQuote, pool.quoteDenomination);
                        if (!value.value) return setError(new Error(value.error));
                        void run('lp-quote', () => depositToken(pool.quoteToken, value.value!), `${pool.quoteTicker} side deposited.`);
                      }}>Deposit {pool.quoteTicker}</Button>
                      <Button variant="primary" busy={busy === 'lp-add'} onClick={() => {
                        const base = tryParseUnits(lpBase, pool.baseDenomination);
                        const quote = tryParseUnits(lpQuote, pool.quoteDenomination);
                        if (!base.value || !quote.value) return setError(new Error(base.error || quote.error));
                        void run('lp-add', () => addLiquidity(base.value!, quote.value!), pairLive ? 'Liquidity shares minted.' : 'Rune pair seeded and liquidity shares minted.');
                      }}>{pairLive ? 'Add liquidity' : 'Create pool'}</Button>
                    </div>
                  )}
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <CreditedBalance label="Rune credited" value={formatToken(deposit.base, pool.baseDenomination)}
                      action={BigInt(deposit.base) > 0n ? <Button size="sm" variant="quiet" onClick={() => void run('refund-base', () => refundDeposit(pool.baseToken, deposit.base), 'Rune deposit refunded.')}>Refund</Button> : undefined} />
                    <CreditedBalance label={`${pool.quoteTicker} credited`} value={formatToken(deposit.quote, pool.quoteDenomination)}
                      action={BigInt(deposit.quote) > 0n ? <Button size="sm" variant="quiet" onClick={() => void run('refund-quote', () => refundDeposit(pool.quoteToken, deposit.quote), `${pool.quoteTicker} deposit refunded.`)}>Refund</Button> : undefined} />
                  </div>
                  {BigInt(deposit.shares) > 0n && (
                    <div className="mt-3 flex items-center justify-between rounded-[3px] border border-good/20 bg-good/[0.05] p-3">
                      <span className="text-xs text-muted">Your position <b className="font-mono text-good">{formatIntegerString(deposit.shares)} shares</b></span>
                      <Button size="sm" busy={busy === 'lp-remove'} onClick={() => void run('lp-remove', () => removeLiquidity(deposit.shares), 'Liquidity returned to your wallet.')}>Remove all</Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </Panel>
        </div>

        <aside className="market-rune-aside grid gap-4">
          <MarketForge mode={forgeMode} reversed={!baseIn} active={Boolean(busy) || isPending('rune-withdraw')}
                       className="min-h-[240px] overflow-hidden rounded-[4px] border border-rune/15" />
          <Panel className="market-rune-price p-4 sm:p-5">
            <DeskHeading title={`${pool.quoteTicker} / Rune`}
              right={<Button size="sm" variant="quiet" onClick={() => void refresh()} icon={<Refresh className="h-3.5 w-3.5" />}>Refresh</Button>} />
            <LineChart values={priceSeries} empty="No pool trades." suffix={` ${pool.quoteTicker}`} className="h-48" />
          </Panel>
          <div className="market-rune-side-stack grid gap-4">
            <Panel className="market-rune-faucet p-4 sm:p-5">
              <DeskHeading title={`Mint ${quoteInfo?.Name ?? pool.quoteTicker}`} right={<Sparkle className="h-5 w-5 text-element" />} />
              <div className="rounded-[3px] border border-element/20 bg-element/[0.06] p-3 text-center">
                <div className="font-mono text-2xl text-element">{formatToken(balances.quote, pool.quoteDenomination)}</div><div className="eyebrow mt-1">Wallet {pool.quoteTicker}</div>
              </div>
              {quoteInfo?.FaucetAmount && (
                <Button className="mt-3 w-full" variant="primary" busy={busy === 'faucet'}
                  onClick={() => needWallet(() => void run('faucet', claimQuoteFaucet, `${formatToken(quoteInfo.FaucetAmount!, pool.quoteDenomination)} ${pool.quoteTicker} minted.`))}
                  icon={<Sparkle className="h-4 w-4" />}>
                  Mint {formatToken(quoteInfo.FaucetAmount, pool.quoteDenomination)} {pool.quoteTicker}
                </Button>
              )}
            </Panel>

            <Panel className="market-rune-trades flex min-h-0 flex-col overflow-hidden">
              <div className="shrink-0 border-b border-rune/10 px-4 py-3"><div className="eyebrow">Recent pool trades</div></div>
              {swaps.length ? <div className="market-swap-list min-h-0 flex-1 divide-y divide-rune/10 overflow-y-auto">{[...swaps].reverse().slice(0, 6).map((record) => <SwapRow key={record.id} swap={record} pool={pool} />)}</div>
                : <div className="grid min-h-0 flex-1 place-items-center px-4 py-5 text-center text-xs text-faint">No trades settled yet.</div>}
            </Panel>
          </div>
        </aside>
      </div>

      {statsOpen && (
        <Dialog title="Rune market stats" onClose={() => setStatsOpen(false)}>
          <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-[3px] border border-rune/10 bg-rune/10 p-px sm:grid-cols-4">
            <MarketMetric label="Pair" value={`${pool.baseTicker} / ${pool.quoteTicker}`} detail={pool.paused ? 'paused' : pairLive ? 'live' : 'unfunded'} />
            <MarketMetric label="Game" value={formatInteger(gameRune)} detail="Rune" />
            <MarketMetric label="Wallet Rune" value={formatToken(balances.base, pool.baseDenomination)} detail={pool.baseTicker} />
            <MarketMetric label={`Wallet ${pool.quoteTicker}`} value={formatToken(balances.quote, pool.quoteDenomination)} detail={pool.quoteTicker} />
            <MarketMetric label="Rune reserve" value={formatToken(pool.reserveBase, pool.baseDenomination)} detail={pool.baseTicker} />
            <MarketMetric label={`${pool.quoteTicker} reserve`} value={formatToken(pool.reserveQuote, pool.quoteDenomination)} detail="pool" />
            <MarketMetric label="Trades" value={formatInteger(pool.swaps)} detail={`${(pool.feeBps / 100).toFixed(2)}% fee`} />
            <MarketMetric label="LP shares" value={formatIntegerString(deposit.shares)} detail={BigInt(deposit.shares) ? 'active' : 'none'} />
          </div>
        </Dialog>
      )}
    </div>
  );
}

function DeskButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} className={cx('min-h-12 bg-surface px-2 py-2 text-center text-sm font-semibold transition-colors', active ? 'bg-element/10 text-element' : 'text-muted hover:bg-raised hover:text-ink')}>
      {label}
    </button>
  );
}

function DeskHeading({ title, right }: { title: string; right?: React.ReactNode }) {
  return <div className="market-desk-heading mb-4 flex items-start justify-between gap-4"><h3 className="text-lg font-semibold">{title}</h3>{right}</div>;
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

function TokenOutput({ ticker, amount, caption }: { ticker: string; amount: string; caption: string }) {
  return <div className="market-token-output rounded-[3px] border border-element/25 bg-element/[0.055] p-4"><div className="flex items-end justify-between gap-3"><span className="text-xs text-faint">You receive</span><span className="font-mono text-xl text-element">{amount} {ticker}</span></div><p className="mt-1 text-right text-[10px] text-faint">{caption}</p></div>;
}

function BridgeCard({ title, from, to, children }: { title: string; from: string; to: string; children: React.ReactNode }) {
  return <div className="rounded-[3px] border border-edge bg-void/25 p-4"><h4 className="text-sm font-semibold">{title}</h4><div className="mt-3 flex items-center gap-2 text-[11px] text-faint"><span className="min-w-0 truncate">{from}</span><Arrow className="h-3.5 w-3.5 shrink-0 text-element" /><span className="min-w-0 truncate">{to}</span></div>{children}</div>;
}

function CreditedBalance({ label, value, action }: { label: string; value: string; action?: React.ReactNode }) {
  return <div className="flex items-center justify-between rounded-[3px] border border-edge/70 bg-void/20 p-3"><div><div className="text-[10px] uppercase tracking-[0.14em] text-faint">{label}</div><div className="mt-1 font-mono text-sm">{value}</div></div>{action}</div>;
}

function SwapRow({ swap: record, pool }: { swap: AmmSwap; pool: AmmPool }) {
  const baseInput = record.inputToken === pool.baseToken;
  const inputTicker = baseInput ? pool.baseTicker : pool.quoteTicker;
  const outputTicker = baseInput ? pool.quoteTicker : pool.baseTicker;
  const inputDenom = baseInput ? pool.baseDenomination : pool.quoteDenomination;
  const outputDenom = baseInput ? pool.quoteDenomination : pool.baseDenomination;
  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between gap-2 text-xs"><span className="font-mono">{formatToken(record.input, inputDenom)} {inputTicker}</span><Arrow className="h-3.5 w-3.5 text-element" /><span className="font-mono text-element">{formatToken(record.output, outputDenom)} {outputTicker}</span></div>
      <div className="mt-1 flex justify-between text-[9px] text-faint"><span>{shortAddress(record.trader, 4)}</span><span>{relativeTime(record.timestamp)}</span></div>
    </div>
  );
}

// Shared market pieces -------------------------------------------------------

function MarketMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="market-metric min-w-0 bg-surface px-2.5 py-2">
      <div className="truncate text-[8px] uppercase tracking-[0.13em] text-faint">{label}</div>
      <div className="mt-0.5 flex min-w-0 items-baseline gap-1.5">
        <span className="min-w-0 truncate font-mono text-sm text-ink" title={value}>{value}</span>
        <span className="shrink-0 truncate text-[8px] uppercase tracking-[0.1em] text-faint">{detail}</span>
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

function tryParseUnits(value: string, denomination: number): { value: string | null; error: string } {
  if (!value.trim()) return { value: null, error: '' };
  try { return { value: parseUnits(value, denomination), error: '' }; }
  catch (caught) { return { value: null, error: caught instanceof Error ? caught.message : String(caught) }; }
}

function swapPrices(records: AmmSwap[], pool: AmmPool): number[] {
  return records.map((record) => {
    const baseInput = record.inputToken === pool.baseToken;
    const base = Number(formatUnits(baseInput ? record.input : record.output, pool.baseDenomination, pool.baseDenomination));
    const quote = Number(formatUnits(baseInput ? record.output : record.input, pool.quoteDenomination, pool.quoteDenomination));
    return base > 0 ? quote / base : 0;
  }).filter((value) => Number.isFinite(value) && value > 0);
}

function formatToken(value: string | bigint, denomination: number): string { return formatUnits(value, denomination, 4); }
function formatInteger(value: number): string { return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value); }
function formatIntegerString(value: string): string { try { return BigInt(value || '0').toLocaleString('en-US'); } catch { return value; } }
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
