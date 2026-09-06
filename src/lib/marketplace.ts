/**
 * Network client for the Rune bridge and the external token pair.
 *
 * Monster sales settle in the game process through `lib/game.ts`. Rune moves
 * between the game and its token by burning and minting. What trades the two
 * tokens against each other is an ORDER BOOK — resting bids and asks that users
 * place — not a pool: there is no swap, no liquidity position and no market
 * maker anywhere in this app. The only counterparty that always fills is the
 * in-game Shop, which is a supply-policy desk inside `game.lua` and is reached
 * through `lib/game.ts`, not from here.
 */
import { readJSON, readState, send } from './hyperbeam';
import { MARKET_DEFAULTS } from './marketplace-config';
import { Reply } from './types';

const env = (import.meta as { env?: Record<string, string> }).env ?? {};
const ID = /^[A-Za-z0-9_-]{43}$/;

export const RUNE_PROCESS = env.VITE_RUNE_PROCESS || MARKET_DEFAULTS.rune;
export const QUOTE_PROCESS = env.VITE_QUOTE_PROCESS || MARKET_DEFAULTS.quote;
export const MARKET_NODE = env.VITE_MARKET_NODE || MARKET_DEFAULTS.node || undefined;

/** Both sides of the pair have to exist for the external venue to mean anything. */
export const exchangeConfigured = () => [RUNE_PROCESS, QUOTE_PROCESS]
  .every((value) => ID.test(value));

export interface TokenInfo {
  Name: string;
  Ticker: string;
  Denomination: string;
  TotalSupply: string;
  FaucetAmount?: string;
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
 * - `Transfer` moves tokens and emits the `Credit-Notice` that is the only
 *   thing telling the recipient process who they belong to. Unpushed, the
 *   recipient holds the balance and credits nobody. Measured while the pool
 *   still existed: 94 TEST-RUNE sitting in its balance, `deposit-<address>` a
 *   404 for every wallet, the process parked at slot 12 with the notices never
 *   scheduled. Fourteen atoms are still stranded there.
 * - `Burn` is the bridge deposit; its `Burn-Notice` is what makes the game
 *   credit the Rune back. Unpushed, the tokens are destroyed and nothing
 *   arrives.
 *
 * `requiredOutbox` makes the client push the slot and raise
 * `OutboxDeliveryError` when it cannot, which is recoverable — the message is
 * durable and can be pushed again — rather than a balance that quietly
 * disappears. Any future custody verb on the external order book belongs in
 * this set for exactly the same reason.
 */
const OUTBOX_EXCHANGE_ACTIONS = new Set(['Transfer', 'Burn']);

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
