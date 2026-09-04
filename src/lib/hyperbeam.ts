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
  env.VITE_GAME_PROCESS || 'swZHN8BCgOL0mPu8pwCdajDeKfxlamWzZTrfs1tRwQA';

/** Separate roaming/battle authority. Empty until `deploy-hunt.mjs` wires it. */
export const HUNT_PROCESS: string = env.VITE_HUNT_PROCESS || 'UBdjzmaI6PgbKWkvpf5MQG19qo2cITthQw74MO4RM6w';
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
  /**
   * What the push itself answered, and what the confirmation read concluded.
   *
   * Both are diagnostics, never a verdict — `pushStatus` is 500 on this node
   * for every SUCCESSFUL withdrawal (see `deliverSlot`), so a human reading
   * this error should reconcile against published state and not against the
   * code. `confirmed` is null when nothing could confirm and the status was all
   * there was to go on. (`status`, from `NetworkError`, stays unset here: this
   * error is not itself an HTTP failure.)
   */
  readonly pushStatus: number | null;
  readonly confirmed: boolean | null;

  constructor({ slot, action, completed, cause, pushStatus = null, confirmed = null }: {
    slot: number; action: string; completed: boolean; cause?: unknown;
    pushStatus?: number | null; confirmed?: boolean | null;
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
    this.pushStatus = pushStatus;
    this.confirmed = confirmed;
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

/**
 * What one signed write actually spent, split by phase.
 *
 * A single round-trip number cannot be acted on. "Slow" has four unrelated
 * causes here and they call for opposite responses. Building and signing the
 * item is local CPU and says nothing about the node. The POST is the scheduler
 * admitting the message, and is where an overloaded or bundler-blocked
 * scheduler shows up. The reply read is pull-based COMPUTE, and is where
 * published-state size shows up. Splitting them is the difference between
 * "the node is slow" and "our own state got too big".
 *
 * All values are milliseconds. `readMs` and `attempts` are absent when the
 * caller never waited for a reply.
 */
export type TransportTiming = {
  action: string | null;
  slot: number | null;
  node: string;
  /** Folding tags and choosing a node, before the wallet is touched. */
  buildMs: number;
  /** `wallet.signDataItem` — building the ANS-104 item and signing it. */
  signMs: number;
  /** POST /schedule until the node answers with a slot. */
  postMs: number;
  /** buildMs + signMs + postMs, including any node fallback that was tried. */
  sendMs: number;
  /** Reading the computed reply back, across every attempt it took. */
  readMs?: number;
  /** How many compute reads were needed before the reply existed. */
  attempts?: number;
  /** Signed item size. The POST is proportional to it. */
  bytes: number;
  ok: boolean;
  error?: string;
};

/**
 * Where phase timings go. Null by default, so the shipped app measures nothing
 * and logs nothing; a harness installs one. See
 * `backend/native/swarm/worker.mjs`, which forwards them into the run log.
 */
let transportObserver: ((timing: TransportTiming) => void) | null = null;

export function setTransportObserver(
  fn: ((timing: TransportTiming) => void) | null,
): void {
  transportObserver = fn;
}

function observeTransport(timing: TransportTiming): void {
  if (!transportObserver) return;
  // Diagnostics must never be able to fail an action the scheduler has
  // already accepted.
  try { transportObserver(timing); } catch { /* observers never throw */ }
}

export type Sent = {
  slot: number;
  id: string | null;
  node: string;
  action: string | null;
  timing?: {
    buildMs: number; signMs: number; postMs: number; sendMs: number; bytes: number;
  };
};

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
/**
 * The two waits inside a write, published separately.
 *
 * A write does not have one duration, it has two, and they belong to different
 * people. The first is the WALLET: the item is built and handed to
 * `signDataItem`, and until the player approves it in the extension nothing
 * has been sent, nothing is owed, and rejecting costs nothing. The second is
 * the CHAIN: the signed item is scheduled and the process has to compute it,
 * which is the one to forty-five seconds this node actually takes.
 *
 * A screen that starts animating on the CLICK is animating through the first
 * wait — behind a modal the player is still reading — and has to unwind the
 * whole thing if they hit reject. So the phases are published and the screens
 * key off them: `signing` up to the signature, `settling` from the signature
 * to the computed reply.
 */
export type WritePhase = 'signing' | 'settling';
export type WritePhaseSink = (phase: WritePhase) => void;

let writeSink: WritePhaseSink | null = null;

/**
 * Report the phases of writes started inside `body` to `sink`.
 *
 * The sink is captured SYNCHRONOUSLY by `send`, which is what lets this exist
 * without threading a callback through all forty-odd verbs in `game.ts`.
 *
 * It assumes one write at a time. `run()` in GameProvider is the only caller
 * and the UI disables every other action while a write is in flight, so that
 * holds; if two ever did overlap the cost is one animation attributed to the
 * wrong button, not a wrong result.
 */
export async function withWritePhase<T>(
  sink: WritePhaseSink, body: () => Promise<T>,
): Promise<T> {
  const previous = writeSink;
  writeSink = sink;
  try {
    return await body();
  } finally {
    writeSink = previous;
  }
}

export async function sendMessage({
  process: pid = GAME_PROCESS,
  tags = [],
  data = '',
  node,
  signal,
  onPhase,
}: {
  process?: string;
  tags?: Tag[];
  data?: string;
  node?: string;
  signal?: AbortSignal;
  onPhase?: WritePhaseSink;
}): Promise<Sent> {
  const tEnter = performance.now();
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

  const tSign = performance.now();
  // Everything above this line is local: building the item costs nothing and
  // commits to nothing. The wallet's dialog opens on the next line.
  onPhase?.('signing');
  const signed = await wallet.signDataItem({
    data,
    target: pid,
    tags: [...fields].map(([name, value]) => ({ name, value })),
  });
  const body = new Uint8Array(signed as ArrayBuffer);
  const tSigned = performance.now();
  // Approved. From here the write is the chain's problem, and a screen may
  // start showing that it is happening.
  onPhase?.('settling');

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
    const tPost = performance.now();
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

    const tAccepted = performance.now();
    const rawSlot = res.headers.get('slot');
    const slot = rawSlot === null ? Number.NaN : Number(rawSlot);
    if (!Number.isSafeInteger(slot) || slot < 0) {
      throw new AmbiguousWriteError(
        `HyperBEAM accepted the message but returned an invalid slot (${rawSlot ?? 'missing'}).`,
        res.status,
      );
    }
    return {
      slot,
      id: res.headers.get('id'),
      node: candidate,
      action,
      // buildMs is measured from the top of this function and sendMs to the
      // accepted response, so a node that had to be failed over is charged
      // here rather than disappearing between the phases.
      timing: {
        buildMs: tSign - tEnter,
        signMs: tSigned - tSign,
        postMs: tAccepted - tPost,
        sendMs: tAccepted - tEnter,
        bytes: body.byteLength,
      },
    };
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
 * THE PUSH RESPONSE IS NOT THE VERDICT. Measured on the live node
 * (`hyperbeam.tylerw.ai`, game `Icr5SQ…`, token `x7qflC…`) over 8 pushes of a
 * slot carrying a real outbox: HTTP 500 every single time, 11.7 s to 27.5 s,
 * and the mint landed on the token every single time — visible at
 * `/<rune>~process@1.0/now/balance-<addr>` 14.6–15.4 s after the withdrawal was
 * scheduled. The 500 body is a HyperBEAM error page whose stacktrace is
 * `hb_cache:write/2` under `dev_push:push_result_message/4`: the node crashes
 * CACHING the push result, after both hops have been delivered and computed.
 * The same body carries the proof — `mint-notice -> {target: <game>, slot: N}`.
 * The trigger is the token's `credit-notice`, which `rune.lua` targets at a
 * WALLET address; a wallet is not a process, the 404 sub-message lands in the
 * result map, and normalizing that map for the cache is what dies. So for
 * `Rune.Withdraw` on this deployment the status code means the opposite of the
 * obvious: 200 means the withdrawal was REJECTED (no outbox to walk — measured
 * at 1.35 s), and 500 means the delivery RAN.
 *
 * Hence `pushSlot` reports what happened rather than a verdict, and
 * `deliverSlot` takes its verdict from a caller-supplied `confirm` read when
 * one is available.
 */
export type PushOutcome = {
  /** The node answered this push request at all. */
  responded: boolean;
  /** The HTTP status it answered with, or null when no response arrived. */
  status: number | null;
  /** `res.ok`. Kept because it is the only signal when nothing can confirm. */
  ok: boolean;
};

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

/**
 * Ceiling on the single push request.
 *
 * The old value was 10_000, and 10 s is below the FLOOR of the measured
 * distribution (11.7 s min, 27.5 s max over 8 live pushes) — so no attempt ever
 * completed, and three of them burned a 30 s budget before reporting a failure
 * that had not happened. Worse, the abort landed in the wrong place: a push
 * aborted at 1 s or 5 s delivered NOTHING (the withdrawal stayed deducted and
 * `pending` — the original destroyed-rune bug), while one aborted at 12 s
 * delivered at +15.4 s. The point of no return is somewhere between 5 s and
 * 12 s and the old 10 s window straddled it, which is how one soak produced
 * both failure modes at once.
 *
 * So this is not a latency budget to be tuned down. It is a generous ceiling on
 * a socket that must be allowed to run past that boundary. Nothing waits on it:
 * when a `confirm` read is available `deliverSlot` returns on that instead and
 * deliberately leaves the push running.
 */
const PUSH_TIMEOUT_MS = 90_000;

/**
 * How long to keep asking the confirmation read whether delivery landed.
 *
 * Measured landing: 14.6 s / 15.2 s / 15.0 s / 15.4 s after scheduling, with
 * the push started immediately. Here the push starts after the reply read, so
 * the slot is already computed and this is if anything pessimistic. 40 s is
 * ~2.6x the measured maximum: long enough that a landed mint is never called a
 * failure, short enough that the player is not held for the 90 s the push
 * itself is allowed.
 */
// Matched to PUSH_TIMEOUT_MS deliberately. A confirmation window SHORTER than
// the push window declares failure while the delivery it is waiting on is
// still in flight -- which is the false negative this whole change exists to
// remove, and under load it is not rare. The common path still returns in the
// measured 12.9-15.4 s; only the already-abnormal case waits longer.
const CONFIRM_TIMEOUT_MS = PUSH_TIMEOUT_MS;

/**
 * Gap between confirmation reads. `now/balance-<addr>` is ONE byte and answers
 * in 111–375 ms (median 129 ms over 6 samples), so polling it is close to free;
 * the interval exists to keep a 40 s window from becoming 300 requests.
 */
const CONFIRM_INTERVAL_MS = 750;

/**
 * One push. Never retried by anything in this file — see `deliverSlot`.
 *
 * Returns what the node did, not whether the delivery worked. The caller
 * decides, because on this deployment the status cannot.
 */
export async function pushSlot(
  slot: number,
  { process: pid = GAME_PROCESS, node = HB_NODE, signal }:
    { process?: string; node?: string; signal?: AbortSignal } = {},
): Promise<PushOutcome> {
  try {
    const res = await fetch(`${clean(node)}/${pid}~process@1.0/push&slot=${slot}`, { signal });
    return { responded: true, status: res.status, ok: res.ok };
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') throw err;
    return { responded: false, status: null, ok: false };
  }
}

export type DeliveryOptions = {
  process?: string;
  node?: string;
  /** Ceiling on the push socket. Defaults to `PUSH_TIMEOUT_MS`. */
  timeoutMs?: number;
  /**
   * The read that decides whether delivery landed.
   *
   * When supplied this is the ONLY verdict; the push's status is recorded and
   * ignored. It must be a cheap published read that proves the DOWNSTREAM
   * effect exists — for a withdrawal, that the recipient's token balance has
   * risen by the amount asked. `game.ts` builds that closure, because this file
   * does not know which process holds the tokens or who is withdrawing.
   *
   * Resolve false for "not yet"; never throw for a transient read failure.
   */
  confirm?: () => Promise<boolean>;
  /** Wall-clock budget for the confirmation poll. Defaults to 40 s. */
  confirmTimeoutMs?: number;
  /** Gap between confirmation reads. Defaults to 750 ms. */
  confirmIntervalMs?: number;
};

export type DeliveryResult = {
  /** The verdict. `confirm` when there was one, otherwise `res.ok`. */
  delivered: boolean;
  /** What the confirmation read concluded, or null when none was supplied. */
  confirmed: boolean | null;
  /** The push's HTTP status, for the error a caller has to act on. */
  status: number | null;
  responded: boolean;
};

/**
 * Push a slot ONCE and decide whether its outbox actually landed.
 *
 * The single push is not a budget choice, it is a correctness one. Re-pushing a
 * game slot is NOT idempotent and NOT a re-delivery guard: measured on the live
 * process, two re-pushes of an already-delivered slot took `totalsupply`
 * 233 -> 234 -> 235 and the owner's token balance 3 -> 4 -> 5, with no second
 * in-game deduction. `rune.lua`'s `Mint` credits unconditionally — the
 * withdrawal id guards only the game-side `Rune.Minted` settlement — so every
 * retry mints unbacked Rune. The 3-attempt loop this replaces is what turned 80
 * deducted Rune into 224 minted Rune across 40 wallets in one soak (2.80x, 144
 * unbacked). A retry here is not a slower fix, it is a mint.
 *
 * The same reasoning covers `marketplace.ts`'s `OUTBOX_EXCHANGE_ACTIONS`: a
 * retried `Transfer`, `Swap` or `Liquidity.Remove` re-delivers a Credit-Notice
 * or a payout exactly the same way. One push, always.
 *
 * With a `confirm` read the push is not even awaited — the read says when the
 * tokens exist, typically ~10 s sooner than the push responds, and the socket
 * is left running because aborting it before the ~5–12 s point of no return is
 * what strands a withdrawal.
 */
/**
 * Pushes this client has started and not yet seen finish.
 *
 * A confirmed delivery returns to its caller while the push socket is still
 * open, and that socket is still doing work: the mint (hop 1) is what the
 * confirmation read proves, but the token's `Rune.Minted` reply back to the
 * game (hop 2) rides the same push. A browser tab stays open and it finishes.
 * A short-lived Node process does NOT — measured: two withdrawals whose tokens
 * minted correctly left their game-side rows `pending` because the harness
 * exited the instant the balance moved, which is the same stranded shape I1
 * saw when it aborted a push at 12 s.
 *
 * So any non-browser host — the swarm workers, verification scripts, anything
 * that calls `process.exit` — must await this before exiting.
 */
const inFlightPushes = new Set<Promise<unknown>>();

export function pendingDeliveries(): Promise<void> {
  return Promise.allSettled([...inFlightPushes]).then(() => undefined);
}

export async function deliverSlot(
  slot: number,
  {
    process: pid = GAME_PROCESS,
    node = HB_NODE,
    timeoutMs = PUSH_TIMEOUT_MS,
    confirm,
    confirmTimeoutMs = CONFIRM_TIMEOUT_MS,
    confirmIntervalMs = CONFIRM_INTERVAL_MS,
  }: DeliveryOptions = {},
): Promise<DeliveryResult> {
  const pushWindow = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : PUSH_TIMEOUT_MS;
  const controller = new AbortController();
  // Deliberately not `unref`'d. The guard is cleared the moment the push
  // settles, so the only thing it can keep alive is a process trying to exit
  // while a delivery is still in flight — and killing that is what strands a
  // withdrawal, so waiting is the correct behaviour.
  const guard = setTimeout(() => controller.abort(), pushWindow);
  // Captured rather than awaited: when a confirmation read exists the verdict
  // must not wait on this socket, but whatever it eventually says is still
  // worth reporting on the failure path.
  const landed: { value: PushOutcome | null } = { value: null };
  const outcome = pushSlot(slot, { process: pid, node, signal: controller.signal })
    .catch((): PushOutcome => ({ responded: false, status: null, ok: false }))
    .then((result) => {
      clearTimeout(guard);
      landed.value = result;
      inFlightPushes.delete(outcome);
      return result;
    });
  inFlightPushes.add(outcome);

  if (!confirm) {
    // Nothing can prove the downstream effect, so the status is all there is.
    // This is the pre-existing contract and it is kept exactly: every caller
    // without a confirmation read (the fleet's settlement, the hunt, the
    // exchange verbs) sees a 200 from this node and is unaffected by the
    // `Rune.Withdraw` inversion described above.
    const result = await outcome;
    return { delivered: result.ok, confirmed: null, status: result.status, responded: result.responded };
  }

  const budget = Number.isFinite(confirmTimeoutMs) && confirmTimeoutMs > 0
    ? confirmTimeoutMs : CONFIRM_TIMEOUT_MS;
  const gap = Number.isFinite(confirmIntervalMs) && confirmIntervalMs >= 0
    ? confirmIntervalMs : CONFIRM_INTERVAL_MS;
  const deadline = Date.now() + budget;
  let confirmed = false;
  // The first read is immediate: the mint can already have landed while this
  // client was reading the slot's own reply.
  for (;;) {
    confirmed = await confirm().catch(() => false);
    if (confirmed) break;
    if (Date.now() + gap >= deadline) break;
    if (gap > 0) await new Promise((resolve) => { setTimeout(resolve, gap); });
  }

  // Whatever the verdict, the push is left alone. Confirmed, it has already
  // done its job; unconfirmed, aborting it is the one action that can turn a
  // late delivery into a stranded one.
  return {
    delivered: confirmed,
    confirmed,
    status: landed.value?.status ?? null,
    responded: landed.value?.responded ?? false,
  };
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
 *
 * It is a RECOVERY signal only, and deliberately not on the happy path. It
 * names the last slot the node has already computed, so for a slot this client
 * just scheduled it is behind by construction — measured stale on 30 of 30
 * actions. Probing it before reading a reply therefore cannot answer the
 * question, cannot reduce the request count (both branches read the same
 * compute URL afterwards), and on a node running HyperBEAM's stock
 * `process_now_from_cache=false` it makes `now` COMPUTE, doubling the work of
 * every write. Its one real use is below: after a pull response is lost, this
 * says whether the computation nonetheless finished.
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

export type ReadSlotOptions = {
  process?: string;
  node?: string;
  /**
   * Maximum cached-head recovery polls. `timeoutMs` normally binds first; this
   * only stops a node that answers the head instantly and forever.
   */
  attempts?: number;
  /** First recovery pause. Each later pause doubles, capped by `maxDelayMs`. */
  delayMs?: number;
  /** Ceiling on a single recovery pause. Raised to `delayMs` if smaller. */
  maxDelayMs?: number;
  /**
   * Hard wall-clock budget for RECOVERY, measured from the moment the compute
   * read failed. The compute read itself is never cut short — on a slow node it
   * is the action — so this bounds the failure path only. Raise it for a
   * caller that would rather wait than reconcile.
   */
  timeoutMs?: number;
  signal?: AbortSignal;
  /**
   * Called once per compute read. A reply that took four attempts and one that
   * arrived on the first are the same elapsed time from very different causes,
   * and only the count separates them. Diagnostics only — nothing here changes
   * what is read.
   */
  onAttempt?: () => void;
};

/**
 * Read one slot's reply without confusing it with another player's result.
 *
 * The happy path is ONE request. HyperBEAM computation is pull-based, so
 * asking for this slot's own output both triggers the computation and returns
 * the reply; there is nothing useful to ask first (see `computedSlot`).
 *
 * Everything after that first request is recovery, and recovery is bounded:
 * exponential backoff against a hard deadline, so a node returning 5xx costs
 * ~25 s and ~a dozen requests rather than ~110 s and ~128. The uncomputed slot
 * is never pulled a second time — the cheap cached head is polled instead, and
 * the result is re-read only once the node says the slot is complete.
 *
 * A write is never retried here. This function only ever READS; when it gives
 * up it throws `NetworkError`, and `send` converts that into the durable
 * `AcceptedWriteError`/`OutboxDeliveryError` contracts.
 */
export async function readSlot<T>(
  slot: number,
  {
    process: pid = GAME_PROCESS, node = HB_NODE,
    attempts = 12, delayMs = 500, maxDelayMs = 4_000, timeoutMs = 25_000,
    signal, onAttempt,
  }: ReadSlotOptions = {},
): Promise<T> {
  throwIfCancelled(signal);
  const url = `${clean(node)}/${pid}~process@1.0/compute&slot=${slot}/results/output/data`;
  const pollAttempts = Number.isSafeInteger(attempts) && attempts > 0 ? attempts : 1;
  const baseWaitMs = Number.isFinite(delayMs) && delayMs > 0 ? delayMs : 0;
  const capWaitMs = Number.isFinite(maxDelayMs) && maxDelayMs > 0
    ? Math.max(baseWaitMs, maxDelayMs) : baseWaitMs;
  const budgetMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 0;
  let lastError: Error | null = null;

  // Set once recovery begins, so a slow compute read never eats the recovery
  // budget it is supposed to be rescued by.
  let deadline = Number.POSITIVE_INFINITY;
  const remainingMs = () => deadline - Date.now();

  const readReply = async (): Promise<{ found: false } | { found: true; value: T }> => {
    onAttempt?.();
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
      throwIfCancelled(signal);
      try {
        const reply = await readReply();
        if (reply.found) return reply.value;
        lastError = null;
      } catch (err) {
        throwIfCancelled(signal, err);
        lastError = err instanceof Error ? err : new NetworkError(String(err));
      }
      if (i + 1 >= cachedAttempts) break;
      const left = remainingMs();
      if (left <= 0) break;
      const pause = Math.min(baseWaitMs, left);
      if (pause > 0) await abortableDelay(pause, signal);
    }
    throw new NetworkError(lastError
      ? `Could not read the cached reply for slot ${slot}: ${lastError.message}.`
      : `The process completed slot ${slot}, but its reply is not available.`,
    );
  };

  // The one request the happy path needs. Pull this accepted slot immediately,
  // exactly once: it is both the request for computation and the read of it.
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
  deadline = budgetMs > 0 ? Date.now() + budgetMs : Number.POSITIVE_INFINITY;
  let waitedMs = 0;
  let nextWaitMs = baseWaitMs;
  for (let i = 0; i < pollAttempts; i++) {
    throwIfCancelled(signal);
    if (i > 0) {
      const left = remainingMs();
      if (left <= 0) break;
      const pause = Math.min(nextWaitMs, left);
      if (pause > 0) {
        await abortableDelay(pause, signal);
        waitedMs += pause;
      }
      nextWaitMs = capWaitMs > 0 ? Math.min(capWaitMs, nextWaitMs * 2) : 0;
    }
    const at = await computedSlot(pid, node, signal);
    if (at !== null && at >= slot) return readCachedReply();
    if (remainingMs() <= 0) break;
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
 * have emitted an outbox. Undelivered outboxes report a distinct error carrying
 * the accepted slot and explicitly tell callers not to replay the game action.
 *
 * The push happens exactly once, and its HTTP status is only the verdict when
 * `deliveryOptions.confirm` is absent — see `deliverSlot` for the measurements
 * behind both of those.
 */
export type SendOptions<T> = {
    data?: string; process?: string; node?: string; signal?: AbortSignal;
    /**
     * Recovery tuning for the reply read. `timeoutMs` is the one that matters:
     * it caps how long a failing read can hold a button before the caller gets
     * the durable `AcceptedWriteError` and reconciles.
     */
    readOptions?: Omit<ReadSlotOptions, 'process' | 'node' | 'signal'>;
    /**
     * How the outbox push is bounded and, more importantly, how its success is
     * decided. There is deliberately no `attempts` here: a second push
     * re-executes the outbox and mints again (see `deliverSlot`), so a retry is
     * not something a caller may ask for.
     */
    deliveryOptions?: Omit<DeliveryOptions, 'process' | 'node'>;
    /**
     * Feature-gated cross-process contracts whose action is not always an
     * outbox action. A boolean is safe even when the reply read fails; a
     * predicate is used for terminal-only delivery after a computed reply.
     */
    requiredOutbox?: boolean | ((reply: T) => boolean);
};

/**
 * One signed write, from tags to computed reply.
 *
 * The phase timings are collected into `probe` rather than returned, because
 * every failure exit of this function is a durable-write contract that callers
 * already handle, and none of them may grow an extra field. `send` owns the
 * probe and reports it once, on every path.
 */
async function sendProbed<T>(
  tags: Tag[],
  { data = '', process: pid = GAME_PROCESS, node, signal, readOptions, deliveryOptions,
    requiredOutbox }: SendOptions<T> = {},
  probe: { sent?: Sent; attempts: number; readMs?: number },
): Promise<T> {
  // Captured HERE, synchronously, before the first await. `send` is called
  // synchronously out of the caller's own verb, so this is the sink that was
  // installed for THIS write even if another one starts while it is settling.
  const onPhase = writeSink ?? undefined;
  const sent = await sendMessage({ process: pid, tags, data, node, signal, onPhase });
  probe.sent = sent;
  let reply: T | undefined;
  let readError: unknown;
  const countAttempt = () => { probe.attempts++; };
  const tRead = performance.now();
  try {
    reply = await readSlot<T>(sent.slot, {
      process: pid, node: sent.node, signal, ...readOptions, onAttempt: countAttempt,
    });
  } catch (error) {
    readError = error;
  }
  probe.readMs = performance.now() - tRead;

  // A computed slot's reply is permanent and content-addressed: once the node
  // has computed slot N, reading it again is a cached GET that costs ~30 ms.
  // So a failed first read does NOT mean the action failed. It means the read
  // budget ran out first -- because the compute had not finished inside it, or
  // because a busy client spent the budget on its own event loop rather than
  // on the network. The write itself is already durable at this point; the
  // slot number in hand proves the scheduler accepted it.
  //
  // Reporting that as a failure is the dangerous outcome, not the slow one: a
  // caller told "it failed" will offer a retry, and these actions are not
  // replayable. Swearing a faction is refused a second time, a loot box is
  // already spent, a berry is already eaten. This was observed live -- a
  // faction swear applied on-chain while the UI reported failure.
  //
  // So spend one more patient read before giving up. It runs only on the error
  // path, and it is the difference between a slow success and a false failure.
  if (readError !== undefined) {
    try {
      reply = await readSlot<T>(sent.slot, {
        process: pid,
        node: sent.node,
        signal,
        ...readOptions,
        attempts: 6,
        delayMs: 1_000,
        maxDelayMs: 8_000,
        timeoutMs: 30_000,
        onAttempt: countAttempt,
      });
      readError = undefined;
    } catch {
      // Keep the ORIGINAL readError: it describes why the first, normally
      // sized read failed, which is the more useful diagnosis.
    }
    // The recovery read is part of what the caller waited for, so it belongs
    // in readMs. Leaving it out would report the patient path as the fast one.
    probe.readMs = performance.now() - tRead;
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
    const delivery = await deliverSlot(sent.slot, {
      process: pid, node: sent.node, ...deliveryOptions,
    });
    if (!delivery.delivered) {
      throw new OutboxDeliveryError({
        slot: sent.slot, action: sent.action, completed: readError === undefined,
        cause: readError, pushStatus: delivery.status, confirmed: delivery.confirmed,
      });
    }
  }

  if (readError !== undefined) {
    throw new AcceptedWriteError({ slot: sent.slot, action: sent.action, cause: readError });
  }
  return reply as T;
}

export async function send<T>(tags: Tag[], options: SendOptions<T> = {}): Promise<T> {
  if (!transportObserver) return sendProbed<T>(tags, options, { attempts: 0 });

  const started = performance.now();
  const probe: { sent?: Sent; attempts: number; readMs?: number } = { attempts: 0 };
  // A write that failed is the measurement that matters most during a node
  // outage: it is the only record that the node was unreachable at that
  // moment, and dropping it would make an outage look like a gap in the data
  // rather than a run of failures.
  const report = (ok: boolean, error?: unknown) => {
    const t = probe.sent?.timing;
    observeTransport({
      action: probe.sent?.action ?? null,
      slot: probe.sent?.slot ?? null,
      node: probe.sent?.node ?? options.node ?? HB_NODE,
      buildMs: t?.buildMs ?? 0,
      signMs: t?.signMs ?? 0,
      // With no accepted response there is no phase split to report, so the
      // whole wait is charged to the POST — which is where it was spent.
      postMs: t?.postMs ?? (probe.sent ? 0 : performance.now() - started),
      sendMs: t?.sendMs ?? (performance.now() - started),
      readMs: probe.readMs,
      attempts: probe.attempts || undefined,
      bytes: t?.bytes ?? 0,
      ok,
      ...(error === undefined ? {} : {
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      }),
    });
  };

  try {
    const reply = await sendProbed<T>(tags, options, probe);
    report(true);
    return reply;
  } catch (error) {
    report(false, error);
    throw error;
  }
}
