/**
 * delivery-health.mjs — is the fleet's TERMINAL handshake actually completing?
 *
 * WHY THIS EXISTS
 *
 * A fleet battle is six hops and `verify-battle-fleet.mjs` used to stop after
 * three of them. Its own header says the settlement is "four of the six hops"
 * and "a break there looks exactly like nothing at all" — and then it declared
 * PASS at the first of those four, the moment the account's win counter moved.
 *
 * On 2026-09-08 that gap was measured on production
 * (`2xESlFS9AwACNgQQviiyp9krhhbr-d1gBLkVEkjMxow`, node `hyperbeam.tylerw.ai`).
 * Every terminal ever produced by the live fleet was stuck:
 *
 *   - the worker's `Battle.Fleet.Settle`/`Battle.Fleet.Cancelled` reached the
 *     authority, the reward was applied, the player saw the fight end;
 *   - the authority's `Fleet.Settlement.Ack` was NEVER computed by any worker.
 *     `Fleet.Settlement.Ack`, `Fleet.Cancellation.Ack`, `Battle.Fleet.FinalAcked`
 *     and `Fleet.FinalAcked.Release` had zero slots across all three workers;
 *   - so every authority tombstone read `deliveryConfirmed:false` and every
 *     worker held its final forever.
 *
 * That is not cosmetic. `BATTLE_FLEET.md`: "Unacknowledged settlements and
 * cancellations are never pruned" and "Admission stops at `maxPending`". At
 * `pendingLimit` 100 each worker refuses every new `Battle.Open` after 100
 * finished fights and the fleet stops accepting battles — silently, because
 * nothing published a number anybody was reading.
 *
 * The cause is transport, not protocol. HyperBEAM's `dev_push` cascade only
 * runs while somebody holds the push request open, and the client stops after
 * the leg it needs. An unsigned `GET /<pid>~process@1.0/push&slot=N` on the
 * producing slot completes the whole remaining chain: measured 10.5 s for a
 * stuck settlement (Ack 15 ms, FinalAcked 119 ms, Release 9 ms) and 45-58 s
 * for a stuck cancellation, on a busy authority.
 *
 * So the numbers below have to be a GATE, not a footnote. These functions are
 * pure so they can be pinned by `delivery-health.test.mjs` without a node.
 */

/**
 * Decode a published key, honouring the rule that this node answers an absent
 * key with its own HTML landing page AT STATUS 200.
 *
 * Returns `null` for absent/HTML/unparseable, never throws. Every caller that
 * reads `/<pid>~process@1.0/now/<key>` has to go through something shaped like
 * this or it hands a screenful of markup to `JSON.parse`.
 */
export function decodePublished(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed || trimmed.startsWith('<')) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

/** Finals the authority holds that no worker has confirmed receiving. */
export function unconfirmedFinals(ops) {
  const finals = Array.isArray(ops?.finals) ? ops.finals : [];
  return finals.filter((final) => final && final.deliveryConfirmed !== true);
}

/**
 * Has this one reservation's terminal been confirmed all the way back?
 *
 * `true` only when the authority's compact tombstone says the worker's
 * `Battle.Fleet.FinalAcked` receipt arrived. A reservation that is still live,
 * or that the authority has never finalized, is `false` — not an error, because
 * the caller is usually polling for it.
 */
export function finalConfirmed(ops, reservationId) {
  const finals = Array.isArray(ops?.finals) ? ops.finals : [];
  const final = finals.find((entry) => entry && entry.reservationId === reservationId);
  return { found: !!final, confirmed: final?.deliveryConfirmed === true, final: final ?? null };
}

/**
 * Per-worker admission headroom.
 *
 * `pendingFinals` is what backpressures admission; `pendingLimit` is the hard
 * wall. `headroom` is how many more finished battles this worker can hold
 * before it starts rejecting opens. A worker with `pendingFinals > 0` and no
 * traffic is a worker whose handshake has stalled — a healthy one drains to
 * zero on its own.
 */
export function workerHeadroom(status) {
  const pending = Number(status?.pendingFinals ?? 0);
  const limit = Number(status?.pendingLimit ?? 0);
  const retained = Number(status?.retainedConfirmations ?? 0);
  const confirmationLimit = Number(status?.confirmationLimit ?? 0);
  return {
    workerId: status?.workerId ?? null,
    pendingFinals: pending,
    pendingSettlements: Number(status?.pendingSettlements ?? 0),
    pendingCancellations: Number(status?.pendingCancellations ?? 0),
    pendingLimit: limit,
    headroom: limit > 0 ? Math.max(0, limit - pending) : null,
    retainedConfirmations: retained,
    confirmationLimit,
    accepting: status?.accepting === true,
  };
}

/**
 * The verdict.
 *
 * - `jammed`  — a worker is at or under `warnAt` remaining admissions, or has
 *               already stopped accepting. New battles are being refused, or
 *               are about to be.
 * - `stalled` — terminals exist that nobody has confirmed. Nothing is broken
 *               for the player yet; the wall is `headroom` battles away.
 * - `ok`      — every terminal round-tripped.
 *
 * `warnAt` defaults to a tenth of the smallest configured `pendingLimit`,
 * because the limit is a deployment choice and a fixed constant here would be
 * wrong on the next fleet.
 */
export function deliveryHealth({ ops, workers = [], warnAt = null } = {}) {
  const stuck = unconfirmedFinals(ops);
  const headrooms = workers.map(workerHeadroom);
  const limits = headrooms.map((w) => w.pendingLimit).filter((n) => n > 0);
  const threshold = warnAt ?? (limits.length ? Math.max(1, Math.floor(Math.min(...limits) / 10)) : 1);

  const jammedWorkers = headrooms.filter((w) => (
    (!w.accepting && w.pendingFinals > 0)
    || (w.headroom !== null && w.headroom <= threshold)
  ));

  let verdict = 'ok';
  if (jammedWorkers.length) verdict = 'jammed';
  else if (stuck.length || headrooms.some((w) => w.pendingFinals > 0)) verdict = 'stalled';

  return {
    verdict,
    warnAt: threshold,
    unconfirmed: stuck.map((f) => ({
      reservationId: f.reservationId,
      battleId: f.battleId,
      kind: f.kind,
      finalId: f.finalId,
      workerProcessId: f.workerProcessId,
    })),
    workers: headrooms,
    jammed: jammedWorkers.map((w) => w.workerId),
  };
}

/**
 * The recovery a caller should run, cheapest first.
 *
 * A plain unsigned push of the slot that PRODUCED the stuck message completes
 * the remaining chain and costs no signature and no owner wallet — that is what
 * repaired production. It needs the slot number, which only the sender or a log
 * has; when that is unavailable the owner-signed retries the reconciler already
 * emits (`Fleet.Settlement.Retry`, `Fleet.Cancellation.Retry`,
 * `Admin.RetryFleetAck`) are the fallback, at one extra authority slot each.
 */
export function recoveryHint(health) {
  if (health.verdict === 'ok') return null;
  return {
    free: 'GET /<producing pid>~process@1.0/push&slot=<producing slot> — completes the whole remaining chain, no signature',
    signed: 'npm run reconcile:battle-fleet -- --apply (owner wallet; one extra authority slot per stuck final)',
    stuck: health.unconfirmed.length,
    jammed: health.jammed,
  };
}
