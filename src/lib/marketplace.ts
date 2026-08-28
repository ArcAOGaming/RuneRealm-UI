/**
 * Network client for the companion market and Rune AMM.
 *
 * The two market halves have different settlement authorities:
 *
 * - A companion is an Arweave-scheduled token@1.0 process. This app curates
 *   and filters it, while its live balances/order book remain ownership truth.
 * - Rune/quote swaps settle in our Lua AMM after each token process delivers a
 *   Credit-Notice. Depositing and swapping are therefore two explicit writes.
 */
import { readJSON, readState, send } from './hyperbeam';
import { MARKET_DEFAULTS } from './marketplace-config';
import { RegistryAsset, Reply } from './types';

const env = (import.meta as { env?: Record<string, string> }).env ?? {};
const ID = /^[A-Za-z0-9_-]{43}$/;

export const MARKET_PROCESS = env.VITE_MARKET_PROCESS || MARKET_DEFAULTS.market;
export const AMM_PROCESS = env.VITE_AMM_PROCESS || MARKET_DEFAULTS.amm;
export const RUNE_PROCESS = env.VITE_RUNE_PROCESS || MARKET_DEFAULTS.rune;
export const QUOTE_PROCESS = env.VITE_QUOTE_PROCESS || MARKET_DEFAULTS.quote;
export const MARKET_NODE = env.VITE_MARKET_NODE || MARKET_DEFAULTS.node || undefined;
export const MARKET_COLLECTION = env.VITE_COLLECTION_PROCESS || MARKET_DEFAULTS.collection;

export const marketConfigured = () => [MARKET_PROCESS, AMM_PROCESS, RUNE_PROCESS, QUOTE_PROCESS]
  .every((value) => ID.test(value));

export interface MarketInfo {
  name: string;
  gameProcess: string;
  collectionId: string;
  runeToken: string;
  quoteToken: string;
  ammProcess: string;
  quoteTicker: string;
  settlement: string;
  settlementAsset: 'AR';
  assetCount: number;
  activeListings: number;
  owner: string;
}

export interface MarketListing {
  assetId: string;
  seller: string;
  orderId: string;
  /** Whole winston, because native asset sales settle in AR. */
  price: string;
  quote: 'AR';
  status: 'active' | 'cancelled';
  createdAt: number;
  updatedAt: number;
  /** Always false in the index. Verify the asset process before purchase. */
  verified: false;
}

export interface TokenInfo {
  Name: string;
  Ticker: string;
  Denomination: string;
  TotalSupply: string;
  FaucetAmount?: string;
}

export interface AmmPool {
  name: string;
  baseToken: string;
  quoteToken: string;
  baseTicker: string;
  quoteTicker: string;
  baseDenomination: number;
  quoteDenomination: number;
  feeBps: number;
  reserveBase: string;
  reserveQuote: string;
  totalShares: string;
  swaps: number;
  paused: boolean;
  configured: boolean;
}

export interface AmmDeposit {
  address: string;
  base: string;
  quote: string;
  shares: string;
}

function unwrap<T>(reply: Reply<T>): T {
  if (reply && typeof reply === 'object' && 'error' in reply && reply.error) {
    throw new Error(String(reply.error));
  }
  return reply as T;
}

const write = async <T>(process: string, tags: Record<string, string>): Promise<T> => {
  if (!ID.test(process)) throw new Error('This marketplace process has not been deployed yet.');
  return unwrap<T>(await send<Reply<T>>(
    Object.entries(tags).map(([name, value]) => ({ name, value })),
    { process, node: MARKET_NODE },
  ));
};

const readMarketJSON = <T>(process: string, key: string) => {
  if (!ID.test(process)) return Promise.resolve(null);
  return readJSON<T>(key, { process, node: MARKET_NODE });
};

export const readMarketInfo = () => readMarketJSON<MarketInfo>(MARKET_PROCESS, 'marketinfo');
export const readListings = () =>
  readMarketJSON<Record<string, MarketListing>>(MARKET_PROCESS, 'listings');
export const readMarketAssets = () =>
  readMarketJSON<Record<string, RegistryAsset>>(MARKET_PROCESS, 'assets');
export const readPool = () => readMarketJSON<AmmPool>(AMM_PROCESS, 'amm');
export const readDeposit = (address: string) =>
  readMarketJSON<AmmDeposit>(AMM_PROCESS, `deposit-${address}`);
export const readTokenInfo = (token: string) => readMarketJSON<TokenInfo>(token, 'tokeninfo');

export async function readTokenBalance(token: string, address: string): Promise<string> {
  if (!ID.test(token) || !ID.test(address)) return '0';
  const direct = await readState(`balance-${address}`, { process: token, node: MARKET_NODE });
  if (direct !== null && /^\d+$/.test(direct)) return direct;
  const balances = await readMarketJSON<Record<string, string>>(token, 'balances');
  return balances?.[address] ?? '0';
}

export const claimQuoteFaucet = () => write<{ Balance: string }>(QUOTE_PROCESS, { Action: 'Faucet' });

/** First half of a swap: transfer tokens into the AMM's credited deposit. */
export const depositToken = (token: string, quantity: string) => write<{ Balance: string }>(token, {
  Action: 'Transfer',
  Recipient: AMM_PROCESS,
  Quantity: quantity,
  'X-Action': 'AMM-Deposit',
});

export const swap = (inputToken: string, quantity: string, minOutput: string, deadline: number) =>
  write<{ action: string; swap: { input: string; output: string }; pool: AmmPool }>(AMM_PROCESS, {
    Action: 'Swap', InputToken: inputToken, Quantity: quantity,
    MinOutput: minOutput, Deadline: String(deadline),
  });

export const refundDeposit = (token: string, quantity: string) =>
  write<{ action: string }>(AMM_PROCESS, {
    Action: 'Deposit.Refund', Token: token, Quantity: quantity,
  });

export const addLiquidity = (baseQuantity: string, quoteQuantity: string) =>
  write<{ shares: string; pool: AmmPool }>(AMM_PROCESS, {
    Action: 'Liquidity.Add', BaseQuantity: baseQuantity, QuoteQuantity: quoteQuantity,
  });

export const removeLiquidity = (shares: string) =>
  write<{ base: string; quote: string; pool: AmmPool }>(AMM_PROCESS, {
    Action: 'Liquidity.Remove', Shares: shares,
  });

export const announceListing = (assetId: string, orderId: string, priceWinston: string) =>
  write<MarketListing>(MARKET_PROCESS, {
    Action: 'Listing.Create', AssetId: assetId, OrderId: orderId, Price: priceWinston,
  });

export const cancelListing = (assetId: string) => write<MarketListing>(MARKET_PROCESS, {
  Action: 'Listing.Cancel', AssetId: assetId,
});

/** Exact decimal input -> atomic integer conversion. */
export function parseUnits(value: string, denomination: number): string {
  const text = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(text)) throw new Error('Enter a positive number.');
  const [whole, fraction = ''] = text.split('.');
  if (fraction.length > denomination) {
    throw new Error(`This token supports at most ${denomination} decimal places.`);
  }
  const atomic = BigInt(whole) * (10n ** BigInt(denomination))
    + BigInt((fraction + '0'.repeat(denomination)).slice(0, denomination) || '0');
  if (atomic <= 0n) throw new Error('Amount must be greater than zero.');
  return atomic.toString();
}

export function formatUnits(value: string | bigint, denomination: number, maxFraction = 6): string {
  const amount = typeof value === 'bigint' ? value : BigInt(value || '0');
  if (denomination === 0) return amount.toString();
  const scale = 10n ** BigInt(denomination);
  const whole = amount / scale;
  const fraction = (amount % scale).toString().padStart(denomination, '0')
    .slice(0, Math.max(0, maxFraction)).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

/** Same integer formula as amm.lua, for a free client-side preview. */
export function quoteFromPool(pool: AmmPool, inputToken: string, quantity: string): string {
  const amount = BigInt(quantity);
  const baseIn = inputToken === pool.baseToken || inputToken === 'base';
  const reserveIn = BigInt(baseIn ? pool.reserveBase : pool.reserveQuote);
  const reserveOut = BigInt(baseIn ? pool.reserveQuote : pool.reserveBase);
  if (amount <= 0n || reserveIn <= 0n || reserveOut <= 0n) return '0';
  const effective = amount * BigInt(10_000 - pool.feeBps) / 10_000n;
  return (effective * reserveOut / (reserveIn + effective)).toString();
}
