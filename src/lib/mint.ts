/**
 * mint.ts — the chain half of minting, from the page.
 *
 * The page does NOT mint. A mint is a base-layer Arweave transaction carrying
 * the card, it costs AR, and asking every player to hold AR to pull their own
 * companion out would make the feature unusable. `game.mint()` queues the job
 * and a funded worker signs it — see backend/native/mint-worker.mjs.
 *
 * What the page DOES do is the other direction. Bringing a companion home means
 * giving the asset back, and only the holder can do that: it is a transfer,
 * signed by the wallet that owns it. There is no burn in this standard — the
 * whole write API is transfer, make-offer, cancel-order, register-interest — so
 * a deposit is a transfer to the vault the process publishes.
 *
 * `arweave` is imported dynamically, and that is deliberate. It is the only
 * dependency in the client and it is a large one; a static import would put it
 * in the entry chunk for every visitor, when it is needed by the small
 * minority who ever deposit an asset. Vite splits it into its own chunk.
 *
 * Reads here never prompt and never cost: an asset publishes its own balances,
 * and the gateway serves its image at the same id.
 */
import { GameError } from './types';
import { getWallet } from './wallet';

const ADDRESS = /^[A-Za-z0-9_-]{43}$/;

const env = (import.meta as { env?: Record<string, string> }).env ?? {};

/**
 * Where to READ asset state.
 *
 * These processes are scheduled on Arweave itself, and a node can only serve
 * one if it indexes the chain. `schedule.forward.computer` — where the game
 * process lives — answers 500 for every one of them, which reads like the asset
 * is broken rather than like the wrong node was asked.
 */
export const ASSET_NODE = env.VITE_ASSET_NODE || 'https://hb.arweave.net';
export const GATEWAY = env.VITE_ARWEAVE_GATEWAY || 'https://arweave.net';

/** The asset id is the image id. There is no second transaction to look up. */
export const assetImage = (assetId: string) => `${GATEWAY}/${assetId}`;

/**
 * Where a holder can trade it.
 *
 * Bazar's asset route is `#/asset/<collection>/<asset>` — TWO segments. A
 * single-segment link redirects to the front page, which reads as a dead or
 * invalid asset rather than as a bad link.
 *
 * `created-assets` is Bazar's own pass-through segment for an asset that is not
 * in a listed collection, and it resolves any asset by id. Pass a real
 * collection id once the asset is in that collection's manifest; until then the
 * default is the link that actually works.
 */
export const CREATED_ASSETS = 'created-assets';

export const bazarUrl = (assetId: string, collectionId: string = CREATED_ASSETS) =>
  `https://bazar.arweave.net/#/asset/${collectionId}/${assetId}`;

/** A collection's own page. One segment, unlike an asset's. */
export const bazarCollectionUrl = (collectionId: string) =>
  `https://bazar.arweave.net/#/collection/${collectionId}`;

/**
 * Who holds the asset, according to the asset.
 *
 * This is the only ownership truth in the system. A gateway index can tell you
 * a transfer transaction exists; it cannot tell you the process applied it.
 */
export async function assetHolder(assetId: string): Promise<string | null> {
  if (!ADDRESS.test(assetId)) throw new GameError('Not an Arweave id');
  const res = await fetch(`${ASSET_NODE}/${assetId}~process@1.0/now/balances`, {
    headers: { accept: 'application/json' },
  });
  if (!res.ok) throw new GameError(`Could not read asset ${assetId}: ${res.status}`);
  const body = (await res.json()) as Record<string, unknown>;
  const holders = Object.entries(body)
    .filter(([key, value]) => ADDRESS.test(key) && Number(value) > 0);
  return holders.length === 1 ? holders[0][0] : null;
}

/**
 * Hand an asset to `recipient`, on chain, signed by the player.
 *
 * The transaction TARGETS the asset's own process and carries the token amount
 * in a TAG; the native `quantity` is one winston.
 *
 * ONE winston, not zero, and this is the single most expensive thing to get
 * wrong here. A transaction with a target, no data and `quantity: '0'` is a
 * no-op, and every Arweave node rejects it with a bare
 * `400 Transaction verification failed` that names nothing — verified against
 * two nodes, with the reward ruled out from dust up to 2x and every anchor
 * form tried. Bazar's own uploader does the same thing:
 *
 *   request.target ? { data, target: request.target, quantity: '1' } : { data }
 *
 * COST: the player pays the network fee, and the FIRST transfer to any given
 * asset also pays Arweave's wallet-creation fee — about 0.22 AR — because the
 * asset's process address has never held a balance. Transfers after that are
 * dust. That is a real charge to put in front of a player, and it is the open
 * question on this path: the alternative is the house wallet sending each new
 * asset one winston at mint time, which pays the same fee once from our side.
 *
 * Returns the transaction id once the gateway has accepted it. Acceptance is
 * not settlement — the asset's balances change when the transaction is mined,
 * which is why the caller polls `assetHolder` rather than trusting this.
 */
export async function transferAsset(assetId: string, recipient: string): Promise<string> {
  if (!ADDRESS.test(assetId)) throw new GameError('Not an Arweave id');
  if (!ADDRESS.test(recipient)) throw new GameError('Not an Arweave address');

  const { default: Arweave } = await import('arweave');
  const arweave = Arweave.init({ host: new URL(GATEWAY).hostname, port: 443, protocol: 'https' });

  const tx = await arweave.createTransaction({ target: assetId, quantity: '1' });
  tx.addTag('action', 'transfer');
  tx.addTag('recipient', recipient);
  tx.addTag('quantity', '1');

  const wallet = getWallet();
  if (!wallet) throw new GameError('Connect a wallet before transferring an asset');
  if (wallet.sign) {
    const signed = await wallet.sign(tx);
    tx.setSignature(signed as Parameters<typeof tx.setSignature>[0]);
  } else {
    // Older injected wallets may only expose signing through arweave-js.
    await arweave.transactions.sign(tx);
  }
  if (!ADDRESS.test(tx.id)) throw new GameError('The wallet returned an unsigned transaction');

  const res = await arweave.transactions.post(tx);
  // 208 is "already known", which a retry earns. It is a success.
  if (res.status !== 200 && res.status !== 208) {
    throw new GameError(`The network rejected the transfer (${res.status})`);
  }
  return tx.id;
}

/**
 * Wait for a transfer to actually land.
 *
 * A base-layer transaction is not a message: it waits for a block, so this is
 * minutes rather than seconds. The caller is expected to show that honestly
 * rather than spinning as if something is wrong.
 */
export async function waitForHolder(
  assetId: string, expected: string, { timeoutMs = 15 * 60_000, intervalMs = 20_000 } = {},
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const holder = await assetHolder(assetId).catch(() => null);
    if (holder === expected) return true;
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => { setTimeout(resolve, intervalMs); });
  }
}
