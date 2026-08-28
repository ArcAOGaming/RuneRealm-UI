import { useCallback, useEffect, useMemo, useState } from 'react';

import { useGame } from '../state/GameProvider';
import * as game from '../lib/game';
import {
  AMM_PROCESS, MARKET_COLLECTION, MARKET_PROCESS, QUOTE_PROCESS, RUNE_PROCESS,
  AmmDeposit, AmmPool, MarketListing, TokenInfo, addLiquidity, announceListing,
  cancelListing, claimQuoteFaucet, depositToken, formatUnits, marketConfigured, parseUnits,
  quoteFromPool, readDeposit, readListings, readMarketAssets, readPool,
  readTokenBalance, readTokenInfo, refundDeposit, removeLiquidity, swap,
} from '../lib/marketplace';
import { assetHolder, assetImage, bazarUrl } from '../lib/mint';
import { Element, RegistryAsset } from '../lib/types';
import { ELEMENT_LABEL, shortAddress } from '../lib/format';
import { Badge, Button, Empty, ErrorNote, Panel, SectionTitle, Skeleton, cx } from '../ui/primitives';
import { Dialog } from '../ui/Dialog';
import { useToast } from '../ui/Toast';
import { ELEMENT_ICON, Exchange, Refresh, Rune, Sparkle, Wallet } from '../ui/icons';

type Tab = 'companions' | 'rune';
type AssetSort = 'recent' | 'level' | 'attack' | 'price';

const EMPTY_DEPOSIT = (address = ''): AmmDeposit => ({ address, base: '0', quote: '0', shares: '0' });
const inputClass = 'h-10 w-full rounded-[3px] border border-edge bg-raised/70 px-3 ' +
  'font-mono text-sm text-ink outline-none placeholder:text-faint focus:border-element/60';

export default function Marketplace() {
  const [tab, setTab] = useState<Tab>('companions');
  return (
    <div className="animate-rise space-y-5">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="eyebrow mb-2">Realm exchange</div>
          <h1 className="text-2xl font-semibold tracking-tight">Marketplace</h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted">
            Trade minted companions in their native asset processes, or exchange circulating Rune
            through the realm&apos;s constant-product pool.
          </p>
        </div>
        <div className="flex rounded-[3px] border border-edge bg-surface/70 p-1">
          <TabButton active={tab === 'companions'} onClick={() => setTab('companions')}>Companions</TabButton>
          <TabButton active={tab === 'rune'} onClick={() => setTab('rune')}>Rune exchange</TabButton>
        </div>
      </header>
      <div className="rule-runic" />
      {tab === 'companions' ? <CompanionMarket /> : <RuneExchange />}
    </div>
  );
}

function TabButton({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button onClick={onClick} className={cx(
      'market-tab h-11 rounded-[2px] px-3 text-xs font-medium transition-colors sm:h-8',
      active ? 'bg-element text-void' : 'text-muted hover:text-ink',
    )}>
      {children}
    </button>
  );
}

function CompanionMarket() {
  const { address, connect, connecting } = useGame();
  const toast = useToast();
  const [assets, setAssets] = useState<RegistryAsset[] | null>(null);
  const [listings, setListings] = useState<Record<string, MarketListing>>({});
  const [holders, setHolders] = useState<Record<string, string | null>>({});
  const [error, setError] = useState<unknown>(null);
  const [query, setQuery] = useState('');
  const [element, setElement] = useState<Element | 'all'>('all');
  const [sort, setSort] = useState<AssetSort>('recent');
  const [listedOnly, setListedOnly] = useState(false);
  const [listingOpen, setListingOpen] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [curated, registry, indexed] = await Promise.all([
        readMarketAssets().catch(() => null),
        game.readAssetRegistry().catch(() => null),
        readListings().catch(() => null),
      ]);
      const rows = Object.values(curated && Object.keys(curated).length ? curated : (registry ?? {}))
        .filter((asset) => asset.state !== 'returned');
      setAssets(rows);
      setListings(indexed ?? {});

      let cursor = 0;
      const workers = Array.from({ length: Math.min(4, rows.length) }, async () => {
        for (;;) {
          const asset = rows[cursor++];
          if (!asset) break;
          const holder = await assetHolder(asset.assetId).catch(() => null);
          setHolders((current) => ({ ...current, [asset.assetId]: holder }));
        }
      });
      await Promise.all(workers);
    } catch (caught) {
      setError(caught);
      setAssets([]);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const shown = useMemo(() => {
    if (!assets) return null;
    const needle = query.trim().toLowerCase();
    return assets.filter((asset) => {
      const listing = listings[asset.assetId];
      if (element !== 'all' && asset.element !== element) return false;
      if (listedOnly && listing?.status !== 'active') return false;
      return !needle || [asset.name, asset.faction, asset.assetId, asset.minter]
        .some((value) => String(value ?? '').toLowerCase().includes(needle));
    }).sort((a, b) => {
      if (sort === 'level') return b.level - a.level || b.mintedAt - a.mintedAt;
      if (sort === 'attack') return b.attack - a.attack || b.level - a.level;
      if (sort === 'price') {
        const ap = BigInt(listings[a.assetId]?.price ?? '999999999999999999');
        const bp = BigInt(listings[b.assetId]?.price ?? '999999999999999999');
        return ap < bp ? -1 : ap > bp ? 1 : 0;
      }
      return b.mintedAt - a.mintedAt;
    });
  }, [assets, listings, element, listedOnly, query, sort]);

  const owned = (assets ?? []).filter((asset) => holders[asset.assetId] === address);

  return (
    <div className="space-y-4">
      <Panel className="p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <input
            className={cx(inputClass, 'lg:max-w-xs')}
            aria-label="Search companions"
            placeholder="Search name, faction or asset id"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="flex flex-wrap gap-1.5">
            <FilterChip active={element === 'all'} onClick={() => setElement('all')}>All</FilterChip>
            {(['fire', 'water', 'air', 'rock'] as Element[]).map((value) => (
              <FilterChip key={value} element={value} active={element === value}
                          onClick={() => setElement(value)}>{ELEMENT_LABEL[value]}</FilterChip>
            ))}
          </div>
          <label className="flex min-h-11 items-center gap-2 text-xs text-muted lg:min-h-0">
            <input className="h-5 w-5 shrink-0" type="checkbox" checked={listedOnly} onChange={(e) => setListedOnly(e.target.checked)} />
            Announced offers
          </label>
          <select className={cx(inputClass, 'lg:ml-auto lg:w-auto')} value={sort}
                  onChange={(e) => setSort(e.target.value as AssetSort)} aria-label="Sort assets">
            <option value="recent">Newest minted</option>
            <option value="level">Highest level</option>
            <option value="attack">Highest attack</option>
            <option value="price">Lowest announced price</option>
          </select>
          <Button size="sm" onClick={() => void load()} icon={<Refresh className="h-4 w-4" />}>Refresh</Button>
          {address ? (
            <Button size="sm" variant="primary" disabled={!owned.length || !MARKET_PROCESS}
                    onClick={() => setListingOpen(true)}>List mine</Button>
          ) : (
            <Button size="sm" variant="primary" busy={connecting} onClick={connect}
                    icon={<Wallet className="h-4 w-4" />}>Connect</Button>
          )}
        </div>
      </Panel>

      <Panel className="border-l-2 border-l-rune/30 p-4">
        <div className="flex items-start gap-3">
          <Sparkle className="mt-0.5 h-4 w-4 shrink-0 text-rune" />
          <p className="text-xs leading-relaxed text-muted">
            The game registry supplies creature stats; each asset&apos;s own balance supplies ownership.
            Offer announcements here are discovery hints, so the trade link always re-checks the native
            <code className="mx-1 font-mono text-ink/80">arweave-swap@1.0</code> order before payment.
            Companion settlement is in AR today—not AO or Rune.
          </p>
        </div>
      </Panel>

      {error !== null && <ErrorNote error={error} onRetry={() => void load()} />}
      {!shown ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((key) => <Skeleton key={key} className="h-[420px]" />)}
        </div>
      ) : shown.length === 0 ? (
        <Panel><Empty title="No companions match">Try a different element, search, or listing filter.</Empty></Panel>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((asset) => (
            <AssetCard key={asset.assetId} asset={asset} listing={listings[asset.assetId]}
                       holder={holders[asset.assetId]} address={address}
                       onCancelled={(next) => setListings((current) => ({ ...current, [next.assetId]: next }))} />
          ))}
        </div>
      )}

      {listingOpen && (
        <ListingDialog assets={owned} onClose={() => setListingOpen(false)} onListed={(listing) => {
          setListings((current) => ({ ...current, [listing.assetId]: listing }));
          setListingOpen(false);
          toast.success('Native offer added to the Rune Realm index.');
        }} />
      )}
    </div>
  );
}

function AssetCard({ asset, listing, holder, address, onCancelled }: {
  asset: RegistryAsset; listing?: MarketListing; holder?: string | null; address: string | null;
  onCancelled: (listing: MarketListing) => void;
}) {
  const Icon = ELEMENT_ICON[asset.element];
  const liveSeller = listing?.status === 'active' && holder === listing.seller;
  const href = bazarUrl(asset.assetId, MARKET_COLLECTION || undefined);
  const toast = useToast();
  const [cancelling, setCancelling] = useState(false);
  const clearIndex = async () => {
    setCancelling(true);
    try {
      const next = await cancelListing(asset.assetId);
      onCancelled(next);
      toast.success('Offer announcement removed from the Rune Realm index.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally { setCancelling(false); }
  };
  return (
    <Panel data-element={asset.element} className="overflow-hidden">
      <div className="relative aspect-[648/1065] overflow-hidden bg-raised/40">
        <img src={assetImage(asset.assetId)} alt={`${asset.name} minted card`}
             className="h-full w-full object-cover" loading="lazy" />
        <div className="absolute left-3 top-3 flex gap-1.5">
          <Badge tone="element"><Icon className="h-3 w-3" />{ELEMENT_LABEL[asset.element]}</Badge>
          <Badge tone="plain">Lvl {asset.level}</Badge>
        </div>
      </div>
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold">{asset.name}</h3>
            <p className="mt-0.5 truncate text-xs text-faint">{asset.faction}</p>
          </div>
          {listing?.status === 'active' && (
            <div className="text-right">
              <div className="font-mono text-sm text-rune">
                {formatUnits(listing.price, 12, 4)} AR
              </div>
              <div className={cx('text-[10px]', liveSeller ? 'text-good' : 'text-warn')}>
                {liveSeller ? 'seller still holds' : 're-check offer'}
              </div>
            </div>
          )}
        </div>
        <div className="mt-3 grid grid-cols-4 gap-2 border-y border-rune/10 py-3 text-center">
          {([['ATK', asset.attack], ['DEF', asset.defense], ['SPD', asset.speed], ['HP', asset.health]] as const)
            .map(([label, value]) => (
              <div key={label}><div className="font-mono text-sm">{value}</div><div className="eyebrow mt-0.5">{label}</div></div>
            ))}
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="min-w-0 text-[11px] text-faint">
            <div>Holder</div>
            <code className="font-mono">{holder === undefined ? 'checking…' : holder ? shortAddress(holder, 6) : 'unresolved'}</code>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            {listing?.status === 'active' && listing.seller === address && (
              <Button size="sm" variant="quiet" busy={cancelling} title="Clear the index after cancelling the native offer"
                      onClick={() => void clearIndex()}>Clear index</Button>
            )}
            <Button size="sm" variant={holder === address ? 'ghost' : 'primary'}
                    onClick={() => window.open(href, '_blank', 'noopener,noreferrer')}>
              {holder === address ? 'Manage offer' : listing?.status === 'active' ? 'View offer' : 'Inspect'}
            </Button>
          </div>
        </div>
      </div>
    </Panel>
  );
}

function ListingDialog({ assets, onClose, onListed }: {
  assets: RegistryAsset[]; onClose: () => void; onListed: (listing: MarketListing) => void;
}) {
  const [assetId, setAssetId] = useState(assets[0]?.assetId ?? '');
  const [orderId, setOrderId] = useState('');
  const [price, setPrice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const selected = assets.find((asset) => asset.assetId === assetId);
  const nativeUrl = selected ? bazarUrl(selected.assetId, MARKET_COLLECTION || undefined) : '#';

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      if (!/^[A-Za-z0-9_-]{43}$/.test(orderId.trim())) {
        throw new Error('Paste the 43-character make-offer transaction id.');
      }
      const listing = await announceListing(assetId, orderId.trim(), parseUnits(price, 12));
      onListed(listing);
    } catch (caught) { setError(caught); } finally { setBusy(false); }
  };

  return (
    <Dialog title="Index a native offer" onClose={onClose} busy={busy} element={selected?.element}>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        Create the offer on the asset process first. Then paste its transaction id here so the
        Rune Realm index can surface it beside the creature&apos;s stats.
      </p>
      <div className="mt-4 space-y-3">
        <label className="block"><span className="eyebrow mb-1.5 block">Companion</span>
          <select className={inputClass} value={assetId} onChange={(e) => setAssetId(e.target.value)}>
            {assets.map((asset) => <option key={asset.assetId} value={asset.assetId}>{asset.name} · lvl {asset.level}</option>)}
          </select>
        </label>
        <Button className="w-full" variant="ghost"
                onClick={() => window.open(nativeUrl, '_blank', 'noopener,noreferrer')}>
          Open native market action
        </Button>
        <label className="block"><span className="eyebrow mb-1.5 block">Offer transaction id</span>
          <input className={inputClass} value={orderId} onChange={(e) => setOrderId(e.target.value)} placeholder="43-character id" />
        </label>
        <label className="block"><span className="eyebrow mb-1.5 block">Price in AR</span>
          <input className={inputClass} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.25" />
        </label>
        {error !== null && <ErrorNote error={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" busy={busy} onClick={() => void submit()}>Add to index</Button>
        </div>
      </div>
    </Dialog>
  );
}

function RuneExchange() {
  const { address, connect, connecting } = useGame();
  const toast = useToast();
  const [pool, setPool] = useState<AmmPool | null>(null);
  const [deposit, setDeposit] = useState<AmmDeposit>(() => EMPTY_DEPOSIT());
  const [baseInfo, setBaseInfo] = useState<TokenInfo | null>(null);
  const [quoteInfo, setQuoteInfo] = useState<TokenInfo | null>(null);
  const [balances, setBalances] = useState({ base: '0', quote: '0' });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState('');
  const [baseIn, setBaseIn] = useState(true);
  const [amount, setAmount] = useState('');
  const [slippage, setSlippage] = useState('1');
  const [lpBase, setLpBase] = useState('');
  const [lpQuote, setLpQuote] = useState('');

  const refresh = useCallback(async () => {
    setError(null);
    if (!marketConfigured()) return;
    try {
      const [nextPool, nextDeposit, runeInfo, relicInfo, runeBalance, relicBalance] = await Promise.all([
        readPool(), address ? readDeposit(address) : null,
        readTokenInfo(RUNE_PROCESS), readTokenInfo(QUOTE_PROCESS),
        address ? readTokenBalance(RUNE_PROCESS, address) : '0',
        address ? readTokenBalance(QUOTE_PROCESS, address) : '0',
      ]);
      setPool(nextPool);
      setDeposit(nextDeposit ?? EMPTY_DEPOSIT(address ?? ''));
      setBaseInfo(runeInfo); setQuoteInfo(relicInfo);
      setBalances({ base: runeBalance, quote: relicBalance });
    } catch (caught) { setError(caught); }
  }, [address]);

  useEffect(() => { void refresh(); }, [refresh]);

  const run = async (key: string, action: () => Promise<unknown>, success: string) => {
    setBusy(key); setError(null);
    try {
      await action(); toast.success(success);
      await refresh();
    } catch (caught) {
      setError(caught); toast.error(caught instanceof Error ? caught.message : String(caught));
    } finally { setBusy(''); }
  };

  if (!marketConfigured()) {
    return (
      <Panel>
        <Empty icon={<Exchange />} title="Market processes are ready to deploy"
          action={<code className="rounded bg-raised px-3 py-2 font-mono text-xs text-rune">npm run deploy:marketplace</code>}>
          The UI is installed, but no AMM/index ids are configured. Deployment creates TEST-Relic,
          the Rune pair and the companion index on the same Hyperbeam node.
        </Empty>
      </Panel>
    );
  }

  if (!address) {
    return <Panel><Empty icon={<Wallet />} title="Connect to exchange Rune"
      action={<Button variant="primary" busy={connecting} onClick={connect}>Connect wallet</Button>}>
      Pool state is public. Deposits, swaps and liquidity changes require your wallet signature.
    </Empty></Panel>;
  }

  if (!pool && !error) return <div className="grid gap-4 lg:grid-cols-3"><Skeleton className="h-80 lg:col-span-2" /><Skeleton className="h-80" /></div>;
  if (!pool) return <ErrorNote error={error} onRetry={() => void refresh()} />;

  const inputToken = baseIn ? pool.baseToken : pool.quoteToken;
  const inputDenom = baseIn ? pool.baseDenomination : pool.quoteDenomination;
  const outputDenom = baseIn ? pool.quoteDenomination : pool.baseDenomination;
  const inputTicker = baseIn ? pool.baseTicker : pool.quoteTicker;
  const outputTicker = baseIn ? pool.quoteTicker : pool.baseTicker;
  let atomic = '0'; let quoted = '0'; let amountError = '';
  try {
    atomic = amount ? parseUnits(amount, inputDenom) : '0';
    quoted = quoteFromPool(pool, inputToken, atomic);
  } catch (caught) { amountError = caught instanceof Error ? caught.message : String(caught); }
  const slip = Math.max(0, Math.min(50, Number(slippage) || 0));
  const minimum = (BigInt(quoted) * BigInt(Math.floor((100 - slip) * 100)) / 10_000n).toString();
  const credited = baseIn ? deposit.base : deposit.quote;

  const doDeposit = () => run('deposit', () => depositToken(inputToken, atomic),
    `${inputTicker} transferred. The AMM will credit it when the notice lands.`);
  const doSwap = () => run('swap', () => swap(inputToken, atomic, minimum, Date.now() + 10 * 60_000),
    `Swap queued for ${formatUnits(quoted, outputDenom)} ${outputTicker}.`);

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        {error !== null && <ErrorNote error={error} onRetry={() => void refresh()} />}
        <Panel className="p-5" glow>
          <SectionTitle right={<Badge tone={pool.paused ? 'bad' : 'good'}>{pool.paused ? 'Paused' : 'Live pool'}</Badge>}>
            Swap
          </SectionTitle>
          <div className="space-y-3">
            <TokenInput label="You deposit" ticker={inputTicker} value={amount} onChange={setAmount}
                        balance={formatUnits(baseIn ? balances.base : balances.quote, inputDenom)} />
            <button aria-label="Reverse pair" onClick={() => { setBaseIn((value) => !value); setAmount(''); }}
                    className="mx-auto flex h-9 w-9 items-center justify-center rounded-[3px] border border-edge bg-raised text-muted hover:border-element/60 hover:text-element">
              <Exchange className="h-4 w-4" />
            </button>
            <div className="rounded-[3px] border border-edge bg-raised/45 p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-faint">Expected output</span>
                <span className="font-mono text-lg text-element">{formatUnits(quoted, outputDenom)} {outputTicker}</span>
              </div>
              <div className="mt-2 flex items-center justify-between gap-3 text-xs text-faint">
                <label className="flex items-center gap-2">Slippage
                  <input className="h-7 w-16 rounded-[3px] border border-edge bg-surface px-2 font-mono"
                         inputMode="decimal" value={slippage} onChange={(e) => setSlippage(e.target.value)} />%
                </label>
                <span>fee {(pool.feeBps / 100).toFixed(2)}%</span>
              </div>
            </div>
            {amountError && <p className="text-xs text-bad">{amountError}</p>}
            <div className="grid gap-2 sm:grid-cols-2">
              <Button variant="ghost" busy={busy === 'deposit'} disabled={BigInt(atomic) <= 0n}
                      onClick={() => void doDeposit()}>1 · Deposit {inputTicker}</Button>
              <Button variant="primary" busy={busy === 'swap'}
                      disabled={BigInt(atomic) <= 0n || BigInt(credited) < BigInt(atomic) || pool.paused}
                      onClick={() => void doSwap()}>2 · Swap credited deposit</Button>
            </div>
            <p className="text-[11px] leading-relaxed text-faint">
              Depositing and swapping are separate because the token&apos;s Credit-Notice arrives
              asynchronously. Your credited balance never changes price until you sign step two,
              and can be refunded at any time.
            </p>
          </div>
        </Panel>

        <Panel className="p-5">
          <SectionTitle>Provide liquidity</SectionTitle>
          <div className="grid gap-3 sm:grid-cols-2">
            <TokenInput label="Rune side" ticker={pool.baseTicker} value={lpBase} onChange={setLpBase} />
            <TokenInput label="Quote side" ticker={pool.quoteTicker} value={lpQuote} onChange={setLpQuote} />
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <Button busy={busy === 'lp-base'} onClick={() => {
              try { const value = parseUnits(lpBase, pool.baseDenomination); void run('lp-base', () => depositToken(pool.baseToken, value), 'Rune side deposited.'); }
              catch (caught) { setError(caught); }
            }}>Deposit Rune</Button>
            <Button busy={busy === 'lp-quote'} onClick={() => {
              try { const value = parseUnits(lpQuote, pool.quoteDenomination); void run('lp-quote', () => depositToken(pool.quoteToken, value), 'Quote side deposited.'); }
              catch (caught) { setError(caught); }
            }}>Deposit {pool.quoteTicker}</Button>
            <Button variant="primary" busy={busy === 'lp-add'} onClick={() => {
              try {
                const base = parseUnits(lpBase, pool.baseDenomination);
                const quote = parseUnits(lpQuote, pool.quoteDenomination);
                void run('lp-add', () => addLiquidity(base, quote), 'Liquidity shares minted.');
              } catch (caught) { setError(caught); }
            }}>Add liquidity</Button>
          </div>
          {BigInt(deposit.shares) > 0n && (
            <div className="mt-4 flex items-center justify-between border-t border-rune/10 pt-4">
              <span className="text-xs text-muted">Your shares <b className="font-mono text-ink">{deposit.shares}</b></span>
              <Button size="sm" busy={busy === 'lp-remove'} onClick={() => void run(
                'lp-remove', () => removeLiquidity(deposit.shares), 'Liquidity returned to your wallet.',
              )}>Remove all</Button>
            </div>
          )}
        </Panel>
      </div>

      <div className="space-y-4">
        <Panel className="p-5">
          <SectionTitle right={<Button size="sm" variant="quiet" onClick={() => void refresh()} icon={<Refresh className="h-3.5 w-3.5" />}>Refresh</Button>}>
            Your balances
          </SectionTitle>
          <BalanceRow ticker={pool.baseTicker} wallet={formatUnits(balances.base, pool.baseDenomination)}
                      deposited={formatUnits(deposit.base, pool.baseDenomination)} />
          <BalanceRow ticker={pool.quoteTicker} wallet={formatUnits(balances.quote, pool.quoteDenomination)}
                      deposited={formatUnits(deposit.quote, pool.quoteDenomination)} />
          {quoteInfo?.FaucetAmount && (
            <>
              <Button className="mt-4 w-full" busy={busy === 'faucet'} onClick={() => void run(
                'faucet', claimQuoteFaucet,
                `${formatUnits(quoteInfo.FaucetAmount!, pool.quoteDenomination)} ${quoteInfo.Ticker} minted.`,
              )} icon={<Sparkle className="h-4 w-4" />}>
                Mint {formatUnits(quoteInfo.FaucetAmount, pool.quoteDenomination)} {quoteInfo.Ticker}
              </Button>
              <p className="mt-2 text-center text-[10px] leading-relaxed text-faint">
                Free test liquidity. Every click mints another fixed batch to your connected wallet.
              </p>
            </>
          )}
          {(BigInt(deposit.base) > 0n || BigInt(deposit.quote) > 0n) && (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button size="sm" disabled={BigInt(deposit.base) === 0n} onClick={() => void run(
                'refund-base', () => refundDeposit(pool.baseToken, deposit.base), 'Rune deposit refunded.',
              )}>Refund Rune</Button>
              <Button size="sm" disabled={BigInt(deposit.quote) === 0n} onClick={() => void run(
                'refund-quote', () => refundDeposit(pool.quoteToken, deposit.quote), 'Quote deposit refunded.',
              )}>Refund quote</Button>
            </div>
          )}
        </Panel>

        <Panel className="p-5">
          <SectionTitle>Pool reserves</SectionTitle>
          <div className="space-y-3">
            <ReserveRow ticker={pool.baseTicker} value={formatUnits(pool.reserveBase, pool.baseDenomination)} />
            <ReserveRow ticker={pool.quoteTicker} value={formatUnits(pool.reserveQuote, pool.quoteDenomination)} />
            <div className="inlay" />
            <div className="flex justify-between text-xs text-faint"><span>LP shares</span><b className="font-mono text-muted">{pool.totalShares}</b></div>
            <div className="flex justify-between text-xs text-faint"><span>Swaps</span><b className="font-mono text-muted">{pool.swaps}</b></div>
          </div>
        </Panel>

        <Panel className="p-4">
          <div className="eyebrow">Pair contracts</div>
          <dl className="mt-2 space-y-2 text-[11px] text-faint">
            <ContractRow label="AMM" value={AMM_PROCESS} />
            <ContractRow label={baseInfo?.Ticker ?? 'Rune'} value={RUNE_PROCESS} />
            <ContractRow label={quoteInfo?.Ticker ?? 'Quote'} value={QUOTE_PROCESS} />
          </dl>
        </Panel>
      </div>
    </div>
  );
}

function TokenInput({ label, ticker, value, onChange, balance }: {
  label: string; ticker: string; value: string; onChange: (value: string) => void; balance?: string;
}) {
  return (
    <label className="block rounded-[3px] border border-edge bg-raised/35 p-3">
      <span className="mb-2 flex items-center justify-between text-xs text-faint">
        <span>{label}</span>{balance !== undefined && <span>Wallet {balance}</span>}
      </span>
      <span className="flex items-center gap-3">
        <input className="min-w-0 flex-1 bg-transparent font-mono text-xl text-ink outline-none placeholder:text-faint"
               inputMode="decimal" placeholder="0" value={value} onChange={(e) => onChange(e.target.value)} />
        <Badge tone="element"><Rune className="h-3 w-3" />{ticker}</Badge>
      </span>
    </label>
  );
}

function BalanceRow({ ticker, wallet, deposited }: { ticker: string; wallet: string; deposited: string }) {
  return (
    <div className="border-b border-rune/10 py-3 last:border-0">
      <div className="flex items-center justify-between gap-2"><b className="text-sm">{ticker}</b><span className="font-mono text-sm">{wallet}</span></div>
      <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-faint"><span>Credited to AMM</span><span className="font-mono">{deposited}</span></div>
    </div>
  );
}

function ReserveRow({ ticker, value }: { ticker: string; value: string }) {
  return <div className="flex items-baseline justify-between gap-3"><span className="text-xs text-muted">{ticker}</span><b className="font-mono text-lg text-ink">{value}</b></div>;
}

function ContractRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-start justify-between gap-3"><dt>{label}</dt><dd className="min-w-0 truncate font-mono text-muted" title={value}>{shortAddress(value, 6)}</dd></div>;
}

function FilterChip({ active, onClick, element, children }: {
  active: boolean; onClick: () => void; element?: Element; children: React.ReactNode;
}) {
  return (
    <button data-element={element} onClick={onClick} className={cx(
      'filter-chip min-h-11 min-w-11 rounded-[3px] border px-2.5 py-1.5 text-xs transition-colors lg:min-h-0 lg:min-w-0',
      active ? 'border-element/60 bg-element/10 text-element' : 'border-edge text-faint hover:text-ink',
    )}>{children}</button>
  );
}
