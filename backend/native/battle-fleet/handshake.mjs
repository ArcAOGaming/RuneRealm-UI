/**
 * handshake.mjs — close the fleet's terminal handshake when the push that was
 * supposed to carry it never came back.
 *
 * ## What this is repairing, measured
 *
 * The fleet's terminal chain is four hops after the fight ends:
 *
 *   worker `Battle.Fleet.Settle`/`Cancelled` -> authority
 *   authority `Fleet.Settlement.Ack`/`Cancellation.Ack` -> worker
 *   worker `Battle.Fleet.FinalAcked` -> authority
 *   authority `Fleet.FinalAcked.Release` -> worker
 *
 * A process cannot send anything by itself, so each of those rides
 * `GET /<pid>~process@1.0/push&slot=N` on the slot that PRODUCED it.
 *
 * On this deployment (production `2xESlFS9…` on `hyperbeam.tylerw.ai`, BOX B
 * 176.9.219.106, measured 2026-09-08) that request **never returns when the
 * slot has a non-empty outbox**:
 *
 *   push game slot 1907 (outbox: acknowledgement)   no response at 300 s
 *   push game slot 1908 (outbox: release)           no response at 180 s
 *   push worker slot 24 (outbox: confirmation)      no response at 120 s
 *   push game slot 1906 (outbox: empty)             200 in 0.395 s
 *   push worker slot 25 (outbox: empty)             200 in 0.392 s
 *
 * The DELIVERY still lands — the worker's head moved 23 -> 24 during the first
 * of those, and the authority's tombstone reached `deliveryConfirmed` during
 * the third. It is the response that is lost, in `dev_push`'s recursive
 * `push_downstream_remote` (`dev_push.erl:386`), which re-enters this node over
 * HTTP for the next hop and does not come back.
 *
 * That single fact broke the fleet in two places at once:
 *
 *  1. `src/lib/hyperbeam.ts` `deliverSlot` takes its verdict from the push's
 *     HTTP status when no `confirm` read is supplied, so the terminal attack
 *     threw `OutboxDeliveryError` at the player on every fleet battle even
 *     though the settlement had landed. Reproduced live on 2026-09-08 with
 *     `verify-battle-fleet.mjs --wallet burner-05`.
 *  2. `reconcile-battle-fleet.mjs` awaited `fetch(push)` with no timeout, so
 *     the operator sweep hung on its first job and never reached the second.
 *
 * ## So the verdict has to come from published state
 *
 * Every function below fires a push WITHOUT waiting for it and then reads the
 * authority's `battlefleetops` and each worker's `fleetstatus` to decide what
 * happened. That is the same rule the rest of the repo already follows for
 * `Rune.Withdraw` (`deliverSlot`'s `confirm` read) and it is the only verdict
 * this node can actually answer.
 *
 * The pure half is separated from the I/O half so `handshake.test.mjs` can pin
 * the decisions without a node.
 */

/** Outbox keys the fleet's terminal chain uses, by the process that emits them. */
export const AUTHORITY_OUTBOX_KEYS = ['acknowledgement', 'release'];
export const WORKER_OUTBOX_KEYS = ['confirmation', 'settlement', 'cancellation'];

/**
 * Decode a published key, honouring the rule that this node answers an absent
 * key with its own HTML landing page AT STATUS 200.
 *
 * Duplicated deliberately rather than imported from `delivery-health.mjs`: that
 * module is the VERDICT logic and this one is the REPAIR, and a repair tool
 * that cannot be run when the health module is mid-edit is a repair tool that
 * is not there when it is needed.
 */
export function decodeBody(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed || trimmed.startsWith('<')) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

/**
 * Which handshake messages are sitting undelivered in one computed slot.
 *
 * `results/outbox` answers with a map keyed by the name the handler used —
 * `fleetReply(base, value, { acknowledgement = ack })` in `game.lua` — plus the
 * envelope's own `commitments`/`status`. HyperBEAM renders a nested value as
 * `<key>+link`, so both spellings have to be recognised: a body carrying
 * `acknowledgement+link` is an undelivered acknowledgement.
 *
 * Returns the plain key names, so a caller can say WHICH hop a slot holds.
 */
export function outboxKeys(body, wanted) {
  const decoded = typeof body === 'string' ? decodeBody(body) : body;
  if (!decoded || typeof decoded !== 'object') return [];
  const present = new Set();
  for (const raw of Object.keys(decoded)) {
    const name = raw.endsWith('+link') ? raw.slice(0, -'+link'.length) : raw;
    if (OUTBOX_ENVELOPE.has(name)) continue;
    if (!wanted || wanted.includes(name)) present.add(name);
  }
  return [...present];
}

/**
 * Keys `results/outbox` carries that are the ENVELOPE, not a message the
 * handler put there. Without this an unfiltered read reports `commitments` as
 * an outbox entry, which is how a "does this slot hold anything" check comes
 * back true for every slot ever computed.
 */
const OUTBOX_ENVELOPE = new Set([
  'commitments', 'status', 'hashpath', 'ao-types', 'priv', 'device',
]);

/**
 * The reservations whose terminal handshake has not closed, and the workers
 * still holding something.
 *
 * `finals` is authoritative for hops 2 and 3: a tombstone with
 * `deliveryConfirmed !== true` means the authority has not heard the worker's
 * receipt back, which is true whether the ACK never arrived or the receipt did
 * not. `workers` covers hop 4 as well — a worker with `pendingConfirmations`
 * above zero is holding a receipt the authority HAS confirmed but never
 * released, and that receipt is never evicted (`maxConfirmations` is a hard
 * bound and admission backpressures instead, see BATTLE_FLEET.md).
 */
export function handshakeOutstanding({ ops, workers = [] } = {}) {
  const finals = (Array.isArray(ops?.finals) ? ops.finals : [])
    .filter((final) => final && final.kind !== 'force' && final.deliveryConfirmed !== true)
    .map((final) => ({
      reservationId: final.reservationId,
      battleId: final.battleId,
      kind: final.kind,
      finalId: final.finalId,
      workerId: final.workerId,
      workerProcessId: final.workerProcessId,
    }));
  const holding = workers
    .filter((w) => w && (Number(w.pendingFinals ?? 0) > 0
      || Number(w.pendingConfirmations ?? 0) > 0))
    .map((w) => ({
      workerId: w.workerId ?? null,
      pendingFinals: Number(w.pendingFinals ?? 0),
      pendingConfirmations: Number(w.pendingConfirmations ?? 0),
    }));
  return { done: finals.length === 0 && holding.length === 0, finals, holding };
}

/** Sleep that a caller can bound. */
const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * Fire one push and DO NOT wait for it to answer.
 *
 * The abort is not a budget, it is a leak stop: the socket cannot answer (see
 * the header), so holding it open past the point where the delivery has landed
 * only pins a file descriptor. It is never retried — a re-push is not a
 * re-delivery guard, it re-executes the outbox, which for a mint is an unbacked
 * mint (`src/lib/hyperbeam.ts` `deliverSlot`). Every slot this module pushes
 * carries exactly one idempotent handshake message and nothing else, and the
 * caller checks published state before pushing again.
 */
export function firePush({ node, process: pid, slot, windowMs = 20_000, onSettled } = {}) {
  const url = `${String(node).replace(/\/$/, '')}/${pid}~process@1.0/push&slot=${slot}`;
  const started = Date.now();
  const task = fetch(url, { signal: AbortSignal.timeout(windowMs) })
    .then((res) => ({ responded: true, status: res.status, ms: Date.now() - started }))
    .catch(() => ({ responded: false, status: null, ms: Date.now() - started }));
  if (onSettled) task.then(onSettled);
  return task;
}

/**
 * Poll a predicate over freshly read state until it holds or the budget runs
 * out. Returns the last state either way, so a failure can be reported with the
 * numbers that were actually seen rather than a bare timeout.
 */
export async function pollUntil(read, predicate, { timeoutMs = 120_000, intervalMs = 3_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  for (;;) {
    last = await read();
    if (predicate(last)) return { ok: true, state: last };
    if (Date.now() >= deadline) return { ok: false, state: last };
    await wait(intervalMs);
  }
}

/**
 * Read a published key. `null` means absent — including the HTML-at-200 case.
 */
export async function readPublished(node, pid, key, { timeoutMs = 60_000 } = {}) {
  try {
    const res = await fetch(`${String(node).replace(/\/$/, '')}/${pid}~process@1.0/now/${key}`, {
      headers: { accept: 'application/json, text/plain' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return decodeBody(await res.text());
  } catch {
    return null;
  }
}

/** The computed head. `null` when the node will not say. */
export async function readHead(node, pid) {
  const value = await readPublished(node, pid, 'at-slot');
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * What one computed slot left in its outbox.
 *
 * Reading `compute&slot=N` is free of a scheduler slot and safe for any slot at
 * or below the computed head; asking for one ABOVE the head makes the node
 * replay to reach it, so callers pass a slot they read from `at-slot`.
 */
export async function readOutbox(node, pid, slot, wanted, { timeoutMs = 60_000 } = {}) {
  try {
    const res = await fetch(
      `${String(node).replace(/\/$/, '')}/${pid}~process@1.0/compute&slot=${slot}/results/outbox`,
      { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) },
    );
    if (!res.ok) return [];
    return outboxKeys(await res.text(), wanted);
  } catch {
    return [];
  }
}

/**
 * Push the head slot of a process when it is holding one of `wanted`, and say
 * what was pushed. Nothing is pushed when the head's outbox is empty or holds
 * something this module does not own — a `Rune.Minted` slot must never be
 * re-pushed from here.
 */
export async function pushHeadIfHolding({ node, process: pid, wanted, windowMs, log = () => {} }) {
  const head = await readHead(node, pid);
  if (head === null) return { pushed: false, reason: 'head unreadable' };
  const keys = await readOutbox(node, pid, head, wanted);
  if (!keys.length) return { pushed: false, reason: `slot ${head} holds none of ${wanted.join('/')}`, slot: head };
  log(`  push ${pid.slice(0, 10)}… slot ${head} (${keys.join(', ')})`);
  firePush({ node, process: pid, slot: head, windowMs });
  return { pushed: true, slot: head, keys };
}

/**
 * Drive the terminal handshake to completion from published state.
 *
 * `retryAck` re-emits an ACK the authority has already produced once — it is
 * `Admin.RetryFleetAck`, owner-signed, and it is the ONLY signed action here.
 * It is supplied by the caller rather than built here so this module needs no
 * wallet and stays testable; `reconcile-battle-fleet.mjs` passes one and
 * `verify-battle-fleet.mjs` can pass `null` to drive only what is already
 * sitting in an outbox.
 *
 * The action is never a replay of the GAME action: an unconfirmed final means
 * the reward has ALREADY been applied exactly once and only its receipt is
 * missing. Re-running the settlement would be the double-spend CLAUDE.md
 * forbids; re-emitting the ACK is idempotent on both sides by construction
 * (`Authority.confirmDelivery` returns the same confirmation for a duplicate,
 * `retainConfirmation` returns the retained one).
 */
export async function driveHandshake({
  node,
  game,
  workerProcessIds = [],
  retryAck = null,
  rounds = 6,
  hopTimeoutMs = 90_000,
  pushWindowMs = 20_000,
  log = () => {},
} = {}) {
  const readState = async () => {
    const ops = await readPublished(node, game, 'battlefleetops');
    const workers = [];
    for (const pid of workerProcessIds) {
      const status = await readPublished(node, pid, 'fleetstatus');
      if (status) workers.push({ ...status, workerProcessId: pid });
    }
    return { ops, workers };
  };

  let state = await readState();
  let outstanding = handshakeOutstanding(state);
  const started = Date.now();
  const acked = new Set();

  for (let round = 0; round < rounds && !outstanding.done; round += 1) {
    log(`round ${round + 1}: ${outstanding.finals.length} unconfirmed final(s), `
      + `${outstanding.holding.length} worker(s) still holding`);

    // Hop 2. The authority's ACK is produced by the slot that computed the
    // worker's terminal notice, which is long past the head by now, so ask the
    // authority to re-emit it at a fresh slot and push THAT.
    if (retryAck) {
      for (const final of outstanding.finals) {
        if (acked.has(final.reservationId)) continue;
        acked.add(final.reservationId);
        const slot = await retryAck(final.reservationId);
        if (slot === null || slot === undefined) continue;
        log(`  Admin.RetryFleetAck ${final.reservationId} -> game slot ${slot}`);
        firePush({ node, process: game, slot, windowMs: pushWindowMs });
      }
      await wait(4_000);
    }

    // Hop 3. A worker that has taken the ACK is holding its receipt.
    for (const pid of workerProcessIds) {
      await pushHeadIfHolding({
        node, process: pid, wanted: WORKER_OUTBOX_KEYS, windowMs: pushWindowMs, log,
      });
    }

    // Hop 4. The authority answers a receipt with a release.
    await pushHeadIfHolding({
      node, process: game, wanted: AUTHORITY_OUTBOX_KEYS, windowMs: pushWindowMs, log,
    });

    const settled = await pollUntil(
      async () => handshakeOutstanding(await readState()),
      (value) => value.done,
      { timeoutMs: hopTimeoutMs, intervalMs: 5_000 },
    );
    outstanding = settled.state;
    if (outstanding.done) break;
  }

  state = await readState();
  outstanding = handshakeOutstanding(state);
  return {
    done: outstanding.done,
    ms: Date.now() - started,
    finals: outstanding.finals,
    holding: outstanding.holding,
    workers: state.workers.map((w) => ({
      workerId: w.workerId,
      pendingFinals: Number(w.pendingFinals ?? 0),
      pendingConfirmations: Number(w.pendingConfirmations ?? 0),
      accepting: w.accepting === true,
    })),
  };
}
