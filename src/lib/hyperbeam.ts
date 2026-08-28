/**
 * HyperBEAM transport.
 *
 * This is the only file in the app that talks to the network. There is no
 * legacynet here and there cannot be: no MU, no CU, no `@permaweb/aoconnect`,
 * no `~genesis-wasm@1.0`. The old RuneRealm processes are gone and the stack
 * that served them is not coming back.
 *
 * Three things are genuinely different from the legacy client, and they shape
 * everything above this file:
 *
 *   1. A WRITE is an ANS-104 data item signed by the wallet's `signDataItem`,
 *      POSTed to `/<pid>~process@1.0/schedule?codec-device=ans104@1.0`.
 *      A browser cannot produce HyperBEAM's httpsig signature — the wallet's
 *      signMessage is a double hash with the wrong salt length — so ANS-104 is
 *      the only option from a page. Conveniently it is exactly what
 *      `createDataItemSigner` was already producing.
 *
 *   2. A READ is a plain unsigned GET. There is no `dryrun`, no speculative
 *      execution, and no free handler invocation. Reads cost nothing and never
 *      prompt the wallet, but they only answer questions the process has
 *      published — see the bottom of `backend/native/game.lua`.
 *
 *   3. The reply to a write is NOT in the POST response; the message is
 *      computed asynchronously. The POST does return the SLOT it landed in,
 *      and a slot can be addressed directly:
 *
 *          /<pid>~process@1.0/compute&slot=<n>/results/output/data
 *
 *      so a reply is read back by its own slot. That matters: the process also
 *      publishes a single `results/output/data` reflecting whatever it computed
 *      most recently, and polling THAT hands you another player's reply the
 *      moment two people are online at once.
 */

import {
  getWallet, type ArweaveWallet, activeAddress, connectWallet, disconnectWallet,
  PERMISSIONS, restoreWallet,
} from './wallet';

export {
  getWallet, type ArweaveWallet, activeAddress, connectWallet, disconnectWallet,
  PERMISSIONS, restoreWallet,
};

export type Tag = { name: string; value: string };

const env = (import.meta as any).env ?? {};

/** Node to talk to. Override with VITE_HB_NODE. */
export const HB_NODE: string = env.VITE_HB_NODE || 'https://hyperbeam.tylerw.ai';

/**
 * Fallback nodes.
 *
 * A caveat that is easy to get wrong: a process is bound to the scheduler it
 * was spawned on. Another node can only serve it if it can fetch it, and one
 * that cannot answers `necessary_message_not_found` — which reads like a bug in
 * your message rather than "wrong node". A fallback list is therefore not a
 * general redundancy mechanism; it only helps for a node that is *down* rather
 * than one that simply does not have this process.
 *
 * That is also why failures report the FIRST node's error, not the last: the
 * primary's real reason (`scheduler_timeout`, say) is the useful one, and the
 * fallback's `necessary_message_not_found` is noise that names the wrong node
 * and the wrong cause.
 */
export const HB_NODES: string[] = [
  HB_NODE,
  'https://schedule.forward.computer',
].filter((n, i, a) => a.indexOf(n) === i);

/** The game process. Set VITE_GAME_PROCESS after a deploy. */
export const GAME_PROCESS: string =
  env.VITE_GAME_PROCESS || 'YUwUslusKtTJTu0g7M_qHjgfC2HpG8DCFWs_G2pozt0';

/**
 * Public address that owns `GAME_PROCESS`.
 *
 * Knowing an address is not authorization: every `Admin.*` write is still
 * verified from the message signature by Lua. Publishing it lets the client
 * avoid signing a throwaway `Stats` message merely to decide whether the
 * connected address should see the owner console.
 */
export const GAME_OWNER: string =
  env.VITE_GAME_OWNER || 'DA9qhP25ZPz6MHIhO-7aNHDN3LsTAL7yCKYIkqr13Z8';

const AO_TAGS: Tag[] = [
  { name: 'data-protocol', value: 'ao' },
  { name: 'variant', value: 'ao.N.1' },
];

export class NetworkError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'NetworkError';
  }
}

// Wallet --------------------------------------------------------------------

/**
 * Only the permissions actually used. The old build asked for eleven, including
 * ENCRYPT, DECRYPT and ACCESS_ALL_ADDRESSES, none of which it ever called —
 * that is a scary consent dialog in exchange for nothing.
 */
// Reads ---------------------------------------------------------------------

const clean = (node: string) => node.replace(/\/$/, '');

async function getText(url: string, signal?: AbortSignal): Promise<string | null> {
  const res = await fetch(url, { headers: { accept: 'text/plain' }, signal });
  // 404 means the process has not published that key. That is a legitimate
  // "no value yet", not a failure.
  if (res.status === 404) return null;
  if (!res.ok) throw new NetworkError(`read failed: ${res.status}`, res.status);
  return (await res.text()).trim();
}

/** Unsigned GET of a published state key. Free, and never prompts the wallet. */
export async function readState(
  key: string,
  opts: { process?: string; node?: string; signal?: AbortSignal } = {},
): Promise<string | null> {
  const pid = opts.process ?? GAME_PROCESS;
  const nodes = opts.node ? [opts.node] : HB_NODES;
  let first: unknown;
  for (const node of nodes) {
    try {
      return await getText(`${clean(node)}/${pid}~process@1.0/now/${key}`, opts.signal);
    } catch (err) {
      if ((err as any)?.name === 'AbortError') throw err;
      first = first ?? err;
    }
  }
  throw first instanceof Error ? first : new NetworkError('all nodes failed');
}

export async function readJSON<T>(
  key: string,
  opts: { process?: string; node?: string; signal?: AbortSignal } = {},
): Promise<T | null> {
  const text = await readState(key, opts);
  if (text === null || text === '') return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

// Writes --------------------------------------------------------------------

export type Sent = { slot: number | null; id: string | null; node: string };

/**
 * Sign and schedule a message. Returns the slot it landed in.
 *
 * Tag names become HTTP headers and headers are case-insensitive, so `Action`
 * and `action` are the SAME field. Sending both makes the item invalid and the
 * node answers a bare `400 Message is not valid.` naming nothing — so tags are
 * folded to lowercase and deduplicated here, last one winning.
 */
export async function sendMessage({
  process: pid = GAME_PROCESS,
  tags = [],
  data = '',
  node,
}: {
  process?: string;
  tags?: Tag[];
  data?: string;
  node?: string;
}): Promise<Sent> {
  const wallet = getWallet();
  if (!wallet) throw new NetworkError('No Arweave wallet connected.');

  const fields = new Map<string, string>();
  const put = (name: string, value: unknown) => {
    if (value === undefined || value === null) return;
    fields.set(String(name).toLowerCase(), String(value));
  };
  put('type', 'Message');
  for (const t of AO_TAGS) put(t.name, t.value);
  for (const t of tags) put(t.name, t.value);
  // ANS-104 items are content-addressed, so two identical messages have the
  // same id. `schedule.forward.computer` does NOT currently collapse them —
  // byte-identical items were verified landing in two separate slots and both
  // taking effect — but a scheduler that did would silently drop the second of
  // two identical actions, and "feed twice in a row" is exactly that shape.
  // This is cheap insurance against a scheduler that behaves correctly.
  put('random-seed', String(Math.floor(Math.random() * 1e9)));

  const signed = await wallet.signDataItem({
    data,
    target: pid,
    tags: [...fields].map(([name, value]) => ({ name, value })),
  });
  const body = new Uint8Array(signed as ArrayBuffer);

  const nodes = node ? [node] : HB_NODES;
  let first: unknown;
  for (const candidate of nodes) {
    try {
      const url =
        `${clean(candidate)}/${pid}~process@1.0/schedule?codec-device=ans104@1.0`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/ans104', 'accept-bundle': 'true' },
        body,
      });
      if (!res.ok) {
        const detail = res.headers.get('details') || (await res.text()).slice(0, 200);
        throw new NetworkError(`HyperBEAM ${res.status}: ${detail}`, res.status);
      }
      const slot = res.headers.get('slot');
      return {
        slot: slot === null ? null : Number(slot),
        id: res.headers.get('id'),
        node: candidate,
      };
    } catch (err) {
      // Keep the FIRST error: the primary's reason is the real one.
      first = first ?? err;
    }
  }
  throw first instanceof Error ? first : new NetworkError('all nodes rejected the write');
}

/**
 * Read the reply produced by one specific slot.
 *
 * `/now/results/output/data` holds whatever the process computed LAST, which is
 * fine alone at a keyboard and wrong the moment two players are online: you get
 * their answer, parse it as your own, and the screen fills with someone else's
 * companion. Addressing the slot removes that entirely.
 *
 * A slot that has not been computed yet answers 404, so this retries. The node
 * computes on demand, and steady-state that resolves in about a second; during
 * a write backlog it can take several.
 */
export async function readSlot<T>(
  slot: number,
  // A hundred and twenty attempts at half a second is one minute of waiting for a slot
  // that has not been computed yet. That is generous on purpose: a read settles
  // in about a third of a second when the node is caught up, and takes tens of
  // seconds while it is working through a backlog of writes. Giving up early
  // would report a successful action as a failure.
  { process: pid = GAME_PROCESS, node = HB_NODE, attempts = 120, delayMs = 500, signal }: {
    process?: string; node?: string; attempts?: number; delayMs?: number; signal?: AbortSignal;
  } = {},
): Promise<T> {
  const url = `${clean(node)}/${pid}~process@1.0/compute&slot=${slot}/results/output/data`;
  // A 404 means "not computed yet". This node can also answer a transient 500
  // while an accepted slot is computing, then serve that same slot normally a
  // few seconds later. Preserve the last hard error for diagnosis, but give it
  // the same bounded backlog window instead of failing a scheduled action after
  // three fast responses.
  let lastError: Error | null = null;

  for (let i = 0; i < attempts; i++) {
    let text: string | null = null;
    try {
      text = await getText(url, signal);
      lastError = null;
    } catch (err) {
      if ((err as any)?.name === 'AbortError') throw err;
      lastError = err instanceof Error ? err : new NetworkError(String(err));
    }
    if (text !== null && text !== '') {
      try {
        return JSON.parse(text) as T;
      } catch {
        return text as unknown as T;
      }
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  const waited = ((attempts * delayMs) / 1000).toFixed(0);
  throw new NetworkError(lastError
    ? `Could not read the reply for slot ${slot} after ${waited}s: ${lastError.message}. `
      + 'The message was scheduled, so this is a read problem rather than a lost action.'
    : `No reply for slot ${slot} after ${waited}s. The message was scheduled; the node is `
      + 'probably still working through a backlog, so the action most likely succeeded even though this timed out.',
  );
}

/** Sign, schedule, and read back this message's own reply. */
export async function send<T>(
  tags: Tag[],
  { data = '', process: pid = GAME_PROCESS, node }: {
    data?: string; process?: string; node?: string;
  } = {},
): Promise<T> {
  const sent = await sendMessage({ process: pid, tags, data, node });
  if (sent.slot === null) {
    throw new NetworkError('The node accepted the message but did not report a slot.');
  }
  return readSlot<T>(sent.slot, { process: pid, node: sent.node });
}
