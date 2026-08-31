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
 * was spawned on. Another node can only serve it if it can fetch it. More
 * importantly, a network failure or 5xx after POST begins may hide an accepted
 * message, so replaying the signed item on a fallback can execute it twice.
 * Fallback is therefore used only for the narrow, explicit pre-acceptance
 * responses classified below; ambiguous writes stop immediately and must be
 * reconciled rather than retried.
 */
export const HB_NODES: string[] = [
  HB_NODE,
  'https://schedule.forward.computer',
].filter((n, i, a) => a.indexOf(n) === i);

/** The game process. Set VITE_GAME_PROCESS after a deploy. */
export const GAME_PROCESS: string =
  env.VITE_GAME_PROCESS || 'Sjf2oEUkKIKvXgleCPD5urvCYmahf7Q3Esvn1TN78Cs';

/** Separate roaming/battle authority. Empty until `deploy-hunt.mjs` wires it. */
export const HUNT_PROCESS: string = env.VITE_HUNT_PROCESS || 'B3w3bj60UsO8_f_ymU6yourGC5cNXXd2LI6Y0zugM3g';
export const HUNT_NODE: string = env.VITE_HUNT_NODE || 'https://hyperbeam.tylerw.ai';

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

/**
 * Scheduling reached a point where the node may have accepted the signed item.
 * Replaying that same item can schedule the action twice, so callers must
 * reconcile by id/state instead of retrying the write.
 */
export class AmbiguousWriteError extends NetworkError {
  readonly scheduledUnknown = true;

  constructor(message: string, status?: number, readonly cause?: unknown) {
    super(`${message} The message may already be scheduled; do not retry it.`, status);
    this.name = 'AmbiguousWriteError';
  }
}

/** A game write finished (or was durably accepted), but its required outbox did not. */
export class OutboxDeliveryError extends NetworkError {
  readonly accepted = true;
  readonly durable = true;
  readonly slot: number;
  readonly action: string;
  readonly completed: boolean;

  constructor({ slot, action, completed, cause }: {
    slot: number; action: string; completed: boolean; cause?: unknown;
  }) {
    super(
      `${action} ${completed ? 'completed' : 'was accepted'} at slot ${slot}, but its required `
      + `outbox delivery could not be confirmed. Do not retry the game action; reconcile `
      + 'the downstream delivery instead.',
    );
    this.name = 'OutboxDeliveryError';
    this.slot = slot;
    this.action = action;
    this.completed = completed;
    if (cause !== undefined) (this as Error & { cause?: unknown }).cause = cause;
  }
}

/** The scheduler accepted this write, but its correlated reply was unavailable. */
export class AcceptedWriteError extends NetworkError {
  readonly accepted = true;
  readonly durable = true;
  readonly completed = null;
  readonly slot: number;
  readonly action: string | null;

  constructor({ slot, action, cause }: { slot: number; action: string | null; cause?: unknown }) {
    super(
      `${action ?? 'The message'} was accepted durably at slot ${slot}, but its reply could not `
      + 'be read. Do not retry the action; reconcile the accepted slot or published state.',
    );
    this.name = 'AcceptedWriteError';
    this.slot = slot;
    this.action = action;
    if (cause !== undefined) (this as Error & { cause?: unknown }).cause = cause;
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

export type Sent = { slot: number; id: string | null; node: string; action: string | null };

// These responses are emitted before a scheduler accepts the item, so trying
// another configured route cannot duplicate it. Every other failure is either
// terminal for this item or ambiguous and must not be replayed automatically.
const SAFE_SCHEDULE_FALLBACK_STATUSES = new Set([404, 429]);

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
  signal,
}: {
  process?: string;
  tags?: Tag[];
  data?: string;
  node?: string;
  signal?: AbortSignal;
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
  // Read the semantic Action from the same last-value-wins fields that are
  // signed. Looking at the original tag array can disagree on mixed-case
  // duplicates because HTTP header names are case-insensitive.
  const action = fields.get('action')?.toLowerCase() ?? null;

  const signed = await wallet.signDataItem({
    data,
    target: pid,
    tags: [...fields].map(([name, value]) => ({ name, value })),
  });
  const body = new Uint8Array(signed as ArrayBuffer);

  const nodes = node ? [node] : HB_NODES;
  let first: unknown;
  for (const candidate of nodes) {
    // Before a request exists, cancellation is definitive. Once fetch starts,
    // even an AbortError is ambiguous: the server may have accepted the bytes
    // before the client stopped waiting for its response.
    if (signal?.aborted) throw new DOMException('The scheduling request was aborted.', 'AbortError');
    const url =
      `${clean(candidate)}/${pid}~process@1.0/schedule?codec-device=ans104@1.0`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/ans104', 'accept-bundle': 'true' },
        body,
        signal,
      });
    } catch (err) {
      throw new AmbiguousWriteError(
        `The scheduling request to ${candidate} ended without a response.`, undefined, err,
      );
    }

    if (!res.ok) {
      let detail = res.headers.get('details') ?? '';
      if (!detail) {
        try { detail = (await res.text()).slice(0, 200); } catch { /* status is enough */ }
      }
      const message = `HyperBEAM ${res.status}: ${detail || res.statusText || 'schedule failed'}`;
      if (res.status === 408 || res.status === 409 || res.status >= 500) {
        throw new AmbiguousWriteError(message, res.status);
      }
      const rejected = new NetworkError(message, res.status);
      if (!SAFE_SCHEDULE_FALLBACK_STATUSES.has(res.status)) throw rejected;
      first = first ?? rejected;
      continue;
    }

    const rawSlot = res.headers.get('slot');
    const slot = rawSlot === null ? Number.NaN : Number(rawSlot);
    if (!Number.isSafeInteger(slot) || slot < 0) {
      throw new AmbiguousWriteError(
        `HyperBEAM accepted the message but returned an invalid slot (${rawSlot ?? 'missing'}).`,
        res.status,
      );
    }
    return { slot, id: res.headers.get('id'), node: candidate, action };
  }
  throw first instanceof Error ? first : new NetworkError('all nodes rejected the write');
}

/**
 * Deliver whatever a computed slot put in its outbox.
 *
 * A process cannot send anything by itself. When a handler wants to reach
 * another process it writes the message into `results.outbox`, and the message
 * sits there until somebody asks the node to push it. Nothing does that
 * automatically — not the scheduler, not the next read — so a cross-process
 * action that is never pushed is a message the sender believes it sent.
 *
 * That is not theoretical. `Rune.Withdraw` deducted a player's runes and asked
 * the token to mint them; the token's slot count never moved, the tokens were
 * never minted, and the runes were gone. Pushing is the other half of every
 * message that crosses a process boundary.
 *
 * A single push attempt returns false rather than confusing downstream
 * delivery with the already-accepted game action. `send` applies the required
 * bounded retry policy and raises `OutboxDeliveryError` with the accepted slot
 * when delivery still cannot be confirmed.
 */
/**
 * The actions whose slot carries an outbox worth delivering.
 *
 * A push is the heavy one: it is the recursive cross-process delivery, not a
 * read. This ran for EVERY write — the reasoning being that a handler which
 * started emitting an outbox later would otherwise silently stop working.
 *
 * That trade looked free and is not. Exactly one handler in `game.lua` builds
 * an outbox (`Rune.Withdraw`, the mint request to the token). Every feed,
 * quest, level-up, listing and battle round was asking the node to walk a
 * delivery that was always empty — and with fifty actors that is hundreds of
 * heavy operations competing with the compute the same clients were waiting on.
 *
 * So the list is the contract, and it is a short one. A handler that starts
 * emitting an outbox belongs here; `game_test.lua` asserts the outbox shape for
 * `Rune.Withdraw`, and `verify-withdraw.mjs` pushes explicitly rather than
 * relying on this, so the bridge is covered from both sides regardless.
 */
export const OUTBOX_ACTIONS = new Set(['rune.withdraw']);

export async function pushSlot(
  slot: number,
  { process: pid = GAME_PROCESS, node = HB_NODE, signal }:
    { process?: string; node?: string; signal?: AbortSignal } = {},
): Promise<boolean> {
  try {
    const res = await fetch(`${clean(node)}/${pid}~process@1.0/push&slot=${slot}`, { signal });
    return res.ok;
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') throw err;
    return false;
  }
}

export async function pushSlotWithRetry(
  slot: number,
  {
    process: pid = GAME_PROCESS,
    node = HB_NODE,
    attempts = 3,
    delayMs = 250,
    attemptTimeoutMs = 10_000,
    overallTimeoutMs = 30_000,
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (timer) => clearTimeout(timer),
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  }: {
    process?: string; node?: string; attempts?: number; delayMs?: number;
    attemptTimeoutMs?: number; overallTimeoutMs?: number;
    setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
    clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<boolean> {
  const count = Number.isSafeInteger(attempts) && attempts > 0 ? attempts : 1;
  const attemptWindow = Number.isFinite(attemptTimeoutMs) && attemptTimeoutMs > 0
    ? attemptTimeoutMs : 10_000;
  const overallWindow = Number.isFinite(overallTimeoutMs) && overallTimeoutMs > 0
    ? overallTimeoutMs : 30_000;
  let expired = false;
  let activeController: AbortController | null = null;

  const work = async () => {
    for (let attempt = 0; attempt < count && !expired; attempt++) {
      const controller = new AbortController();
      activeController = controller;
      let attemptTimer: ReturnType<typeof setTimeout> | undefined;
      const attemptExpired = new Promise<boolean>((resolve) => {
        attemptTimer = setTimer(() => {
          controller.abort();
          resolve(false);
        }, attemptWindow);
      });
      const pushed = pushSlot(slot, { process: pid, node, signal: controller.signal })
        .catch(() => false);
      const ok = await Promise.race([pushed, attemptExpired]);
      if (attemptTimer !== undefined) clearTimer(attemptTimer);
      activeController = null;
      if (ok) return true;
      if (attempt + 1 < count && delayMs > 0 && !expired) await sleep(delayMs);
    }
    return false;
  };

  let overallTimer: ReturnType<typeof setTimeout> | undefined;
  const overallExpired = new Promise<boolean>((resolve) => {
    overallTimer = setTimer(() => {
      expired = true;
      activeController?.abort();
      resolve(false);
    }, overallWindow);
  });
  try {
    return await Promise.race([work(), overallExpired]);
  } finally {
    expired = true;
    (activeController as AbortController | null)?.abort();
    if (overallTimer !== undefined) clearTimer(overallTimer);
  }
}

function throwIfCancelled(signal: AbortSignal | undefined, error?: unknown): void {
  if (signal?.aborted) {
    throw signal.reason ?? error ?? new DOMException('The request was aborted.', 'AbortError');
  }
  const name = (error as { name?: string } | undefined)?.name;
  if (name === 'AbortError' || name === 'TimeoutError') throw error;
}

async function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  throwIfCancelled(signal);
  if (!signal) {
    await new Promise((resolve) => setTimeout(resolve, ms));
    return;
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', cancel);
      resolve();
    };
    const cancel = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(signal.reason ?? new DOMException('The request was aborted.', 'AbortError'));
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
  });
}

/**
 * How far the process has actually computed. This cached read does not request
 * new computation; its latency still depends on the node and current load.
 */
async function computedSlot(
  pid: string, node: string, signal?: AbortSignal,
): Promise<number | null> {
  try {
    const text = await getText(`${clean(node)}/${pid}~process@1.0/now/at-slot`, signal);
    if (text === null || text.trim() === '') return null;
    const value = Number(text.trim());
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  } catch (err) {
    throwIfCancelled(signal, err);
    return null;
  }
}

/**
 * Read one slot's reply without confusing it with another player's result.
 * Use the cached head as the fast path, pull a pending slot exactly once, and
 * recover a lost pull response with cached head polling instead of more pulls.
 */
export async function readSlot<T>(
  slot: number,
  {
    process: pid = GAME_PROCESS, node = HB_NODE, attempts = 120, delayMs = 500,
    signal,
  }: {
    process?: string; node?: string; attempts?: number; delayMs?: number;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  throwIfCancelled(signal);
  const url = `${clean(node)}/${pid}~process@1.0/compute&slot=${slot}/results/output/data`;
  const pollAttempts = Number.isSafeInteger(attempts) && attempts > 0 ? attempts : 1;
  const waitMs = Number.isFinite(delayMs) && delayMs > 0 ? delayMs : 0;
  let lastError: Error | null = null;

  const readReply = async (): Promise<{ found: false } | { found: true; value: T }> => {
    const text = await getText(url, signal);
    if (text === null || text === '') return { found: false };
    try {
      return { found: true, value: JSON.parse(text) as T };
    } catch {
      return { found: true, value: text as unknown as T };
    }
  };

  const readCachedReply = async (): Promise<T> => {
    const cachedAttempts = Math.max(1, Math.min(6, pollAttempts));
    for (let i = 0; i < cachedAttempts; i++) {
      try {
        const reply = await readReply();
        if (reply.found) return reply.value;
        lastError = null;
      } catch (err) {
        throwIfCancelled(signal, err);
        lastError = err instanceof Error ? err : new NetworkError(String(err));
      }
      if (i + 1 < cachedAttempts && waitMs > 0) {
        await abortableDelay(waitMs, signal);
      }
    }
    throw new NetworkError(lastError
      ? `Could not read the cached reply for slot ${slot}: ${lastError.message}.`
      : `The process completed slot ${slot}, but its reply is not available.`,
    );
  };

  const initialAt = await computedSlot(pid, node, signal);
  if (initialAt !== null && initialAt >= slot) return readCachedReply();

  // HyperBEAM computation is pull-based. Pull this accepted slot immediately,
  // exactly once, instead of adding a fixed passive delay to every action.
  try {
    const reply = await readReply();
    if (reply.found) return reply.value;
    lastError = null;
  } catch (err) {
    throwIfCancelled(signal, err);
    lastError = err instanceof Error ? err : new NetworkError(String(err));
  }

  // A lost HTTP response does not mean computation failed. Poll only the cached
  // head, then read the result again after the slot is known to be complete.
  let waitedMs = 0;
  for (let i = 0; i < pollAttempts; i++) {
    if (i > 0 && waitMs > 0) {
      await abortableDelay(waitMs, signal);
      waitedMs += waitMs;
    }
    const at = await computedSlot(pid, node, signal);
    if (at !== null && at >= slot) return readCachedReply();
  }

  const waited = (waitedMs / 1000).toFixed(1);
  throw new NetworkError(lastError
    ? `Could not read the reply for slot ${slot} after one compute request and `
      + `${waited}s of cached recovery polling: ${lastError.message}. `
      + 'The message was scheduled, so this is a read problem rather than a lost action.'
    : `No reply for slot ${slot} after one compute request and ${waited}s of cached recovery `
      + 'polling. The message was scheduled and is durable, so do not submit it again.',
  );
}

/**
 * Sign, schedule, read back this message's own reply, and push its outbox when
 * the action contract says it can emit one.
 *
 * The push is what makes an action that reaches another process actually reach
 * it; see `pushSlot`. Recursive delivery is expensive, so ordinary gameplay
 * writes never ask HyperBEAM to walk an outbox they cannot produce. Keep
 * `OUTBOX_ACTIONS` synchronized with handlers that emit cross-process messages.
 *
 * Delivery is attempted after the reply read, or after that read's bounded
 * timeout. A handler rejection is returned without a push because it cannot
 * have emitted an outbox. Exhausted delivery reports a distinct error carrying
 * the accepted slot and explicitly tells callers not to replay the game action.
 */
export type SendOptions<T> = {
    data?: string; process?: string; node?: string; signal?: AbortSignal;
    readOptions?: { attempts?: number; delayMs?: number };
    deliveryOptions?: { attempts?: number; delayMs?: number };
    /**
     * Feature-gated cross-process contracts whose action is not always an
     * outbox action. A boolean is safe even when the reply read fails; a
     * predicate is used for terminal-only delivery after a computed reply.
     */
    requiredOutbox?: boolean | ((reply: T) => boolean);
};

export async function send<T>(
  tags: Tag[],
  { data = '', process: pid = GAME_PROCESS, node, signal, readOptions, deliveryOptions,
    requiredOutbox }: SendOptions<T> = {},
): Promise<T> {
  const sent = await sendMessage({ process: pid, tags, data, node, signal });
  let reply: T | undefined;
  let readError: unknown;
  try {
    reply = await readSlot<T>(sent.slot, {
      process: pid, node: sent.node, signal, ...readOptions,
    });
  } catch (error) {
    readError = error;
  }

  // Only the actions that actually emit one. See OUTBOX_ACTIONS.
  const handlerRejected = readError === undefined
    && reply !== null
    && typeof reply === 'object'
    && 'error' in reply
    && Boolean((reply as { error?: unknown }).error);
  const explicitlyRequired = requiredOutbox === true
    || (typeof requiredOutbox === 'function' && readError === undefined
      && requiredOutbox(reply as T));
  if (sent.action && (OUTBOX_ACTIONS.has(sent.action) || explicitlyRequired) && !handlerRejected) {
    // Delivery is independent of reading the local reply. In particular, a
    // cached-read timeout must not silently strand a withdrawal's mint request.
    const delivered = await pushSlotWithRetry(sent.slot, {
      process: pid, node: sent.node, ...deliveryOptions,
    });
    if (!delivered) {
      throw new OutboxDeliveryError({
        slot: sent.slot, action: sent.action, completed: readError === undefined,
        cause: readError,
      });
    }
  }

  if (readError !== undefined) {
    throw new AcceptedWriteError({ slot: sent.slot, action: sent.action, cause: readError });
  }
  return reply as T;
}
