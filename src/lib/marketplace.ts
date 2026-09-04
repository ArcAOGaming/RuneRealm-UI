/**
 * Network client for the Rune bridge and AMM.
 *
 * Monster sales now settle in the game process through `lib/game.ts`. Rune and
 * quote swaps settle in our Lua AMM after each token process delivers a
 *   Credit-Notice. Depositing and swapping are therefore two explicit writes.
 */
import { readJSON, readState, send } from './hyperbeam';
import { MARKET_DEFAULTS } from './marketplace-config';
import { Reply } from './types';

const env = (import.meta as { env?: Record<string, string> }).env ?? {};
const ID = /^[A-Za-z0-9_-]{43}$/;

export const AMM_PROCESS = env.VITE_AMM_PROCESS || MARKET_DEFAULTS.amm;
export const RUNE_PROCESS = env.VITE_RUNE_PROCESS || MARKET_DEFAULTS.rune;
export const QUOTE_PROCESS = env.VITE_QUOTE_PROCESS || MARKET_DEFAULTS.quote;
export const MARKET_NODE = env.VITE_MARKET_NODE || MARKET_DEFAULTS.node || undefined;

/** The exchange no longer depends on the legacy minted-asset index. */
export const exchangeConfigured = () => [AMM_PROCESS, RUNE_PROCESS, QUOTE_PROCESS]
  .every((value) => ID.test(value));

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

/** A settled pool trade, newest entries are published by the AMM. */
export interface AmmSwap {
  id: number;
  trader: string;
  inputToken: string;
  outputToken: string;
  input: string;
  output: string;
  timestamp: number;
}

function unwrap<T>(reply: Reply<T>): T {
  if (reply && typeof reply === 'object' && 'error' in reply && reply.error) {
    throw new Error(String(reply.error));
  }
  return reply as T;
}

/**
 * Exchange verbs whose whole effect is a message to ANOTHER process.
 *
 * HyperBEAM does not deliver an outbox by itself — something has to push the
 * slot — and `OUTBOX_ACTIONS` in `hyperbeam.ts` listed only `rune.withdraw`,
 * which is a fact about the GAME process. Every verb below was going out
 * without a push, and the failure is silent and looks exactly like theft:
 *
 * - `Transfer` into the AMM moves the tokens and emits the `Credit-Notice` that
 *   is the only thing telling the pool who they belong to. Unpushed, the pool
 *   holds the balance and credits nobody. Measured on the live pool: 94
 *   TEST-RUNE sitting in the AMM's balance, `deposit-<address>` a 404 for every
 *   wallet, the AMM parked at slot 12 with the notices never scheduled.
 * - `Burn` is the bridge deposit; its `Burn-Notice` is what makes the game
 *   credit the Rune back. Unpushed, the tokens are destroyed and nothing
 *   arrives.
 * - `Swap`, `Liquidity.Remove` and `Deposit.Refund` all pay out by transferring
 *   FROM the pool. Unpushed, the trade settles in the pool's books and the
 *   trader never receives anything.
 *
 * `requiredOutbox` makes the client push the slot and raise
 * `OutboxDeliveryError` when it cannot, which is recoverable — the message is
 * durable and can be pushed again — rather than a balance that quietly
 * disappears.
 */
const OUTBOX_EXCHANGE_ACTIONS = new Set([
  'Transfer', 'Burn', 'Swap', 'Liquidity.Remove', 'Deposit.Refund',
]);

const write = async <T>(process: string, tags: Record<string, string>): Promise<T> => {
  if (!ID.test(process)) throw new Error('This external exchange process has not been deployed yet.');
  return unwrap<T>(await send<Reply<T>>(
    Object.entries(tags).map(([name, value]) => ({ name, value })),
    {
      process,
      node: MARKET_NODE,
      requiredOutbox: OUTBOX_EXCHANGE_ACTIONS.has(tags.Action),
    },
  ));
};

const readMarketJSON = <T>(process: string, key: string) => {
  if (!ID.test(process)) return Promise.resolve(null);
  return readJSON<T>(key, { process, node: MARKET_NODE });
};

export const readPool = () => readMarketJSON<AmmPool>(AMM_PROCESS, 'amm');
export const readSwaps = () => readMarketJSON<AmmSwap[]>(AMM_PROCESS, 'swaps');
/**
 * A wallet's credited deposit, with a fallback to the aggregate.
 *
 * The AMM writes `deposit-<address>` only on a slot where that address was the
 * signer or the `Sender`, so the addressed key is absent for a wallet whose
 * credit arrived on somebody else's slot — a 404, which reads as "no deposit"
 * and is how a genuinely credited balance looked like nothing at all. The
 * `deposits` map is rewritten on every message and always has the answer.
 *
 * Same shape as `readTokenBalance` below, and for the same reason.
 */
export const readDeposit = async (address: string): Promise<AmmDeposit | null> => {
  const direct = await readMarketJSON<AmmDeposit>(AMM_PROCESS, `deposit-${address}`);
  if (direct && (direct.base !== undefined || direct.quote !== undefined)) return direct;
  const all = await readMarketJSON<Record<string, AmmDeposit>>(AMM_PROCESS, 'deposits');
  return all?.[address] ?? null;
};
export const readTokenInfo = (token: string) => readMarketJSON<TokenInfo>(token, 'tokeninfo');

export async function readTokenBalance(token: string, address: string): Promise<string> {
  if (!ID.test(token) || !ID.test(address)) return '0';
  const direct = await readState(`balance-${address}`, { process: token, node: MARKET_NODE });
  if (direct !== null && /^\d+$/.test(direct)) return direct;
  const balances = await readMarketJSON<Record<string, string>>(token, 'balances');
  return balances?.[address] ?? '0';
}

export const claimQuoteFaucet = () => write<{ Balance: string }>(QUOTE_PROCESS, { Action: 'Faucet' });

/**
 * Move withdrawn Rune back into the game. Burning is the bridge deposit: the
 * Rune token emits a replay-protected Burn-Notice and the game credits the
 * same wallet's collection balance when that notice lands.
 */
export const depositRuneToGame = (quantity: string) => write<{
  Action: 'Burn-Success'; Balance: string; Quantity: string; Reference: string;
}>(RUNE_PROCESS, { Action: 'Burn', Quantity: quantity });

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
