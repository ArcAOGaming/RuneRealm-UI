/**
 * concurrency-ramp.mjs — how many signed messages a second, before a success
 * takes longer than two seconds to come back?
 *
 * `lane1-ramp.mjs` asked whether throughput plateaus or collapses, from ONE
 * wallet through the bundled app client. This asks the launch question instead:
 * with N players acting at once, what is the sustained rate and where does the
 * round trip cross the threshold a person notices. So it differs in three ways
 * that matter:
 *
 *   - every virtual client signs with its OWN burner wallet, because one wallet
 *     is one signer and one signer is not fifty players;
 *   - it counts HTTP 429 apart from every other failure. HyperBEAM rate-limits
 *     per IP (dev_rate_limit, 1000 req/60s), so a level that 429s has measured
 *     the limiter, NOT the node, and reporting it as capacity is how a load
 *     test lies;
 *   - the verdict is a rate, not a shape: the highest level whose p95 round
 *     trip stays under the budget, and what that level sustained.
 *
 * A round trip is post -> scheduled slot -> the handler's own reply read back
 * from `compute&slot=N`. That is the whole thing a player waits for, and it is
 * the ONLY latency this harness reports (CLAUDE.md, "Latency means ROUND TRIP").
 * The one-way POST is ~140 ms and stays ~140 ms while the round trip goes to
 * ninety seconds, so printing it next to the verdict says the system is healthy
 * at exactly the moment it is not. The phase split is kept in the JSON report
 * for diagnosis and is deliberately absent from the table.
 *
 * Measure with a MUTATION, not a read. `Stats` costs a whole slot and a whole
 * round trip, so it times the message path honestly -- but its reply proves
 * nothing changed. `Sprite.Update` is the cheap repeatable write whose reply IS
 * the changed player record, so ACTION defaults to it.
 *
 * ## What this harness got wrong, and what it now reports instead
 *
 * Five defects, all of them making the node look worse than it is while being
 * invisible in the output. They are fixed here and each is pinned by a test in
 * `harness-instrumentation.test.mjs`:
 *
 *   - it slept 200 ms before the FIRST read of the reply, and charged that to
 *     the node -- ~29% of the 693 ms concurrency-1 round trip. The first read
 *     is now immediate; `PRE_POLL_MS=200` reproduces the old behaviour;
 *   - it ran every lane in one thread against a connection pool of 8, so at
 *     concurrency 50, 7,797 ms of a 9,839 ms per-request time never left the
 *     client. The pool is now sized at 2 per lane; `HB_CONNECTIONS` overrides;
 *   - it took every percentile over `results.filter(r => r.ok)`, so a level
 *     looked FASTER the more of it timed out. Timeouts are now censored samples
 *     at `>= DEADLINE_MS` and take part in the ordering; the survivors-only
 *     numbers are still in the JSON as `p50OkMs`/`p95OkMs`, labelled;
 *   - it divided throughput by a wall that included the post-level drain, so it
 *     was understated at exactly the levels that were failing. It is now
 *     divided by the window work was OFFERED in (`issueWindowMs`);
 *   - it counted two HTTP requests per message when the real cost is three:
 *     `sendMessage` queues a `push&slot=N` GET that nothing counted. The count
 *     now comes from `hbclient.mjs`, at the one place every request goes out.
 *
 * And two more, found by running it. `sendMessage` fires its `push&slot=N`
 * CONCURRENTLY with the reply read of the same slot, and the two interlock: the
 * read is held open for exactly as long as the push runs (round trip 15,161-
 * 15,290 ms against a 15 s push cap, 60,300 ms against a 60 s cap; 556-2,034 ms
 * when the push is fired after the read instead). The push is off here because
 * `Sprite.Update` has no outbox for it to deliver.
 *
 * And the default payload was the OLD outfit shape, so every round trip was
 * answered `{"error":"Missing character layer Hair"}` -- a full slot and a full
 * round trip that changed nothing, scored as a success. A reply that is an
 * error is now its own failure reason.
 *
 *   NODE_URL=... PID=... node backend/native/concurrency-ramp.mjs
 *   LEVELS=1,10,25,50,100 PER_LEVEL=120 BUDGET_MS=2000 node ...
 *   PRE_POLL_MS=200 HB_CONNECTIONS=8 node ...   # the pre-fix behaviour, for A/B
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { sendMessage, pendingPushes, httpRequestCount, resetHttpRequestCount } from './hbclient.mjs';
import { listBurners } from './burners.mjs';
import { useKeepAlive, connectionLimit } from './keepalive.mjs';
import { assertLiveGraph, resolveLiveGraph } from './live-config.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

const graph = assertLiveGraph(resolveLiveGraph({ root: ROOT }));
const NODE = process.env.NODE_URL || graph.node;
const PID = process.env.PID || graph.game;
const BOX_IP = process.env.BOX_IP || null;
const LEVELS = (process.env.LEVELS || '1,5,10,25,50,75,100')
  .split(',').map((n) => Number(n.trim())).filter((n) => Number.isFinite(n) && n > 0);
const BUDGET_MS = Number(process.env.BUDGET_MS || 2000);
const ACTION = process.env.ACTION || 'Sprite.Update';
// Sprite.Update with a body rewrites the player's outfit and replies with the
// changed record. Any valid outfit works; this is the shape `normaliseOutfit`
// accepts, and rewriting it to the same value is still a real state write.
//
// It has to be the CURRENT shape. An outfit used to be a six-element array of
// style names; it is now six {style, color} pairs keyed by layer
// (`CHARACTER_CATEGORIES` in game.lua), and the array form is answered with
// `{"error":"Missing character layer Hair"}`. That reply is a full round trip
// and a full slot, so the harness went on reporting latency happily -- while
// measuring the validation path of a message that changed nothing. A probe that
// is not a mutation is against the rule this harness exists to keep
// (CLAUDE.md: the probe has to be a MUTATION whose reply is the changed
// record), so the payload is checked as well as sent -- see `roundTrip`.
const OUTFIT = {
  Hair: { style: 'Long', color: '#3b2a1a' },
  Hat: { style: 'Beanie', color: '#2f4f4f' },
  Shirt: { style: 'Shirt', color: '#7a1f1f' },
  Pants: { style: 'Skirt', color: '#1f2f5a' },
  Gloves: { style: 'Gloves', color: '#404040' },
  Shoes: { style: 'Shoes', color: '#20202a' },
};
const DATA_OVERRIDE = process.env.DATA;
let mutationSerial = Date.now() & 0xffffff;

function mutationPayload() {
  if (ACTION !== 'Sprite.Update') {
    return { data: DATA_OVERRIDE, expectedOutfit: null };
  }
  if (DATA_OVERRIDE !== undefined) {
    let expectedOutfit = null;
    try { expectedOutfit = JSON.parse(DATA_OVERRIDE); } catch { /* scored as a rejection */ }
    return { data: DATA_OVERRIDE, expectedOutfit };
  }
  // Give every write a distinct, valid colour. Reusing one fixed recipe lets a
  // successful reply prove assignment but not an observable state transition.
  mutationSerial = (mutationSerial + 1) & 0xffffff;
  const expectedOutfit = {
    ...OUTFIT,
    Hair: { ...OUTFIT.Hair, color: `#${mutationSerial.toString(16).padStart(6, '0')}` },
  };
  return { data: JSON.stringify(expectedOutfit), expectedOutfit };
}

function returnedChangedRecord(body, expectedOutfit) {
  let value;
  try { value = JSON.parse(body); } catch {
    return { ok: false, error: 'reply was not JSON' };
  }
  if (value && typeof value === 'object' && typeof value.error === 'string') {
    return { ok: false, rejected: true, error: JSON.stringify(value).slice(0, 160) };
  }
  if (ACTION !== 'Sprite.Update') return { ok: true };
  if (!expectedOutfit || !value?.outfit) {
    return { ok: false, error: 'Sprite.Update reply did not contain the changed outfit record' };
  }
  for (const category of Object.keys(OUTFIT)) {
    const want = expectedOutfit?.[category];
    const got = value.outfit?.[category];
    if (!want || got?.style !== want.style || got?.color !== String(want.color).toLowerCase()) {
      return { ok: false, error: `Sprite.Update reply did not echo changed ${category}` };
    }
  }
  return { ok: true };
}
// Enough samples that a p95 means something, and enough per client that the
// level reaches steady state rather than measuring fifty cold starts.
const PER_LEVEL = Number(process.env.PER_LEVEL || 0);
const SETTLE_MS = Number(process.env.SETTLE_MS || 5000);
// A level is bounded by TIME as well as by count, because the process it is
// measuring may already be tens of seconds deep in queue. Without this, one
// level either times out entirely (deadline too short) or runs for twenty
// minutes (deadline long enough, count unreachable) and the ramp stops being a
// ramp. Lanes stop starting new round trips at LEVEL_MS; the ones in flight are
// still awaited, so no sample is discarded for finishing late.
const LEVEL_MS = Number(process.env.LEVEL_MS || 60_000);
// How long one round trip may take before it is scored as a timeout. This is
// NOT the budget: the budget is the pass mark for p95, the deadline is how long
// the harness is willing to watch. Under a saturated queue they are far apart,
// and conflating them scores a queued success as a failure.
const DEADLINE_MS = Number(process.env.DEADLINE_MS || 45_000);
// How long to wait before the FIRST read of the reply. Zero, and that is a
// correction rather than a tuning choice: this used to sleep 200 ms before
// looking, which is ~29% of the 693 ms concurrency-1 round trip and ~39% of the
// throughput at that level -- the harness charging the node for the harness's
// own nap. `compute&slot=N` blocks server-side (measured: single curl calls
// returning at 27.1 / 48.5 / 76.8 / 119.0 s, exactly as `at-slot` reached the
// target), so the immediate read is not a wasted request in the common case; it
// is the read. Set PRE_POLL_MS=200 to reproduce the old numbers.
const PRE_POLL_MS = Number(process.env.PRE_POLL_MS || 0);
// Backoff between SUBSEQUENT reads, once the immediate one has missed.
const POLL_MS = Number(process.env.POLL_MS || 200);
const POLL_MAX_MS = Number(process.env.POLL_MAX_MS || 600);
// How many sockets undici may hold open to the node. One thread runs every
// lane here, so a pool smaller than the lane count makes this file the
// bottleneck rather than the node: at concurrency 50 with the old default of 8,
// 7,797 ms of a 9,839 ms per-request time never left the client. Default is
// 2 x the widest level; HB_CONNECTIONS overrides for an A/B sweep.
const CONNECTIONS = Number(process.env.HB_CONNECTIONS) || 0;
// `sendMessage` queues a `push&slot=N` GET immediately after every POST so a
// handler's outbox is delivered. OFF here, and this is the single largest
// correction in the file.
//
// `Sprite.Update` writes no outbox (`reply()` in game.lua never touches
// `results.outbox`), so the push can deliver nothing. What it DOES do is race
// the `compute&slot=N` read of the same slot, and the two interlock. Measured
// on one process, alternating shapes, n=4 each:
//
//     push fired right after the POST   round trip 15290 / 15163 / 15161 / 15192 ms
//                                       push itself aborted at the 15000 ms cap
//     push fired after the reply read   round trip   556 /  850 / 2034 /  592 ms
//                                       push 200 in 134-150 ms
//
// The round trip in the racing arm is the push timeout, to within 300 ms, four
// times out of four -- and at a 60 s cap it was 60,300 ms. The read is held
// open for exactly as long as the push is, and answers the instant the push is
// abandoned. Median 15,177 ms against 721 ms: a 21x interlock.
//
// Be precise about what that costs THIS harness, because it is less than the
// number above and the difference matters. `queuePush` allows one push in
// flight per process, so within a level only the FIRST message meets the
// interlock; every push queued behind it is still waiting when the level ends.
// That is visible in the report as `httpRequestsPerMessage` 2.0 with
// `pushesDrained: false` -- the third request per message exists in intent and
// never reaches the wire. So the push is worth roughly one stalled round trip
// per level here, not 21x per message.
//
// It is worth more than that everywhere else. Those undelivered pushes are
// undelivered OUTBOXES, which is the failure `queuePush` was written to
// prevent: a game that has already deducted a player's Rune while the token's
// mint sits unpushed. Any tool that writes through `sendMessage` under load is
// dropping them. `PUSH=1` reproduces the harness side of it.
const PUSH = process.env.PUSH === '1';
// How long to wait for a level's queued pushes before moving on.
const DRAIN_MS = Number(process.env.DRAIN_MS || 3_000);
const OUT = process.env.OUT
  || path.join(ROOT, '.test-tmp', `concurrency-ramp-${Date.now()}.json`);

const quantile = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]);
};

/**
 * A percentile over the SURVIVORS is not the percentile of the experiment.
 *
 * The published "p50 8,978 ms at concurrency 50" was the median of the eleven
 * round trips that came back out of forty attempted; the true median never came
 * back at all. Filtering the failures out is exactly the wrong direction: the
 * samples that are missing are missing BECAUSE they were slow, so dropping them
 * makes a level look better the worse it gets, and the number peaks right at
 * collapse.
 *
 * A timeout is not a missing sample, it is a right-censored one: it is known to
 * be at least DEADLINE_MS. So it takes part in the ordering at its own elapsed
 * time, and if the order statistic that comes out is itself a censored sample,
 * the answer is reported as a lower bound (">= 45000") rather than as a number.
 * A POST failure and a 429 are genuinely not latency samples -- nothing was
 * waited for -- and they stay out of both, counted in their own columns.
 */
const censoredQuantile = (samples, p) => {
  if (!samples.length) return { ms: null, censored: false };
  const sorted = [...samples].sort((a, b) => a.ms - b.ms);
  const pick = sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  return { ms: Math.round(pick.ms), censored: pick.censored };
};
const showCensored = (q) => (q.ms === null ? '-' : `${q.censored ? '>=' : ''}${q.ms}`);
const mean = (values) => (values.length
  ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null);

/**
 * Every poll this harness makes. The posts and their queued pushes are counted
 * inside `hbclient.mjs` instead, at the one place every request goes through --
 * counting them here is how the ramp came to report two HTTP requests per
 * message when the real cost is three. The node's limiter counts requests, so a
 * level's req/s is the number that trips it while msg/s is the number the game
 * cares about; reporting only one hides the wall.
 */
let pollCount = 0;

/**
 * One player action, timed the way the player experiences it.
 *
 * The reply read is polled rather than awaited once: `compute&slot=N` answers
 * before the head reaches N, and a node that has not computed the slot yet
 * hands back its own HTML landing page at status 200 (CLAUDE.md). Treating
 * that as a reply would score a miss as a 40 ms success.
 */
async function roundTrip(jwk, deadlineMs) {
  const started = performance.now();
  let slot = null;
  const { data, expectedOutfit } = mutationPayload();
  try {
    const sent = await sendMessage({
      node: NODE, jwk, process: PID, action: ACTION, data, push: PUSH,
    });
    slot = sent?.slot ?? null;
  } catch (error) {
    return { ok: false, reason: error?.status === 429 ? 'rate-limited' : 'post',
      status: error?.status ?? null,
      error: String(error?.message || error), totalMs: performance.now() - started };
  }
  if (slot === null || slot === undefined) {
    return { ok: false, reason: 'no-slot', totalMs: performance.now() - started };
  }
  const posted = performance.now();
  const url = `${NODE}/${PID}~process@1.0/compute&slot=${slot}/results/output/data`;
  let lastStatus = null;
  let reads = 0;
  // The FIRST read is immediate. Anything slept before it is charged to the
  // node, and `compute&slot=N` blocks server-side anyway, so in the common case
  // the immediate read IS the answer rather than a wasted request.
  //
  // Subsequent reads back off, and that is a measurement decision, not
  // politeness. The node limits by REQUEST, not by message (dev_rate_limit), so
  // a tight poll loop at fifty lanes spends the whole budget on asking "are we
  // there yet" and reports the limiter as the game's ceiling. Every request is
  // counted so the report can say which number was the wall.
  let wait = PRE_POLL_MS;
  while (performance.now() - started < deadlineMs) {
    if (wait > 0) await new Promise((done) => setTimeout(done, wait));
    const remainingMs = Math.max(1, Math.floor(deadlineMs - (performance.now() - started)));
    const response = await fetch(url, {
      headers: { accept: 'text/plain' },
      signal: AbortSignal.timeout(remainingMs),
    }).catch(() => null);
    pollCount += 1;
    reads += 1;
    lastStatus = response?.status ?? null;
    if (response?.status === 429) {
      return { ok: false, reason: 'rate-limited', status: 429, slot, reads,
        postMs: posted - started, totalMs: performance.now() - started };
    }
    if (response?.ok) {
      const body = (await response.text()).trim();
      if (body && !/^<!DOCTYPE html|^<html/i.test(body)) {
        // A reply arrived. Whether it is a SUCCESS is a separate question, and
        // one this harness used to skip: the contract answers a rejected write
        // with `{"error": ...}` at the same cost and the same shape as an
        // accepted one, so a stale payload scored 100% ok while changing
        // nothing. A rejection is reported in its own column rather than
        // silently inflating the success rate.
        const verdict = returnedChangedRecord(body, expectedOutfit);
        return { ok: verdict.ok,
          reason: verdict.ok ? undefined : (verdict.rejected ? 'rejected' : 'invalid-reply'),
          error: verdict.ok ? undefined : verdict.error,
          slot, reads, postMs: posted - started,
          readMs: performance.now() - posted, totalMs: performance.now() - started };
      }
    }
    wait = wait > 0 ? Math.min(POLL_MAX_MS, Math.round(wait * 1.4)) : POLL_MS;
  }
  return { ok: false, reason: 'timeout', status: lastStatus, slot, reads,
    postMs: posted - started, totalMs: performance.now() - started };
}

async function runLevel(concurrency, wallets) {
  const target = PER_LEVEL > 0 ? PER_LEVEL : Math.max(40, concurrency * 4);
  const results = [];
  let issued = 0;
  pollCount = 0;
  resetHttpRequestCount();
  const startedAt = Date.now();
  const startedAtIso = new Date(startedAt).toISOString();
  const issueUntil = startedAt + LEVEL_MS;
  // When the last round trip was STARTED. Everything after that instant is the
  // level draining, not the level running.
  let lastIssuedAt = startedAt;
  await Promise.all(Array.from({ length: concurrency }, async (_unused, lane) => {
    // Each lane keeps its own wallet for the whole level: swapping signers
    // mid-level would measure key setup, and two lanes sharing a wallet is the
    // single-signer case this harness exists to avoid.
    const jwk = wallets[lane % wallets.length];
    for (;;) {
      const index = issued;
      issued += 1;
      if (index >= target || Date.now() >= issueUntil) return;
      lastIssuedAt = Date.now();
      results.push(await roundTrip(jwk, DEADLINE_MS));
    }
  }));
  // Every lane has stopped. This is the end of the level's WORK; everything
  // after it is bookkeeping and must stay out of the throughput divisor.
  const workedMs = Date.now() - startedAt;
  // The pushes are queued, not awaited, so the request total is only true once
  // they have run. Draining also stops one level's deliveries from landing in
  // the next level's count.
  //
  // Bounded, because a push can block for minutes on this process and they are
  // serialised one in flight per process: an unbounded drain turns a level into
  // a wait for the node rather than a measurement of it. `pushesDrained` says
  // whether the request total is complete or a lower bound.
  const drained = await Promise.race([
    pendingPushes().then(() => true).catch(() => true),
    new Promise((done) => setTimeout(() => done(false), DRAIN_MS)),
  ]);
  const wallMs = Date.now() - startedAt;
  // Throughput is a RATE, so it must be divided by the window the work was
  // offered in, not by a wall that includes waiting for the stragglers of a
  // level that has stopped issuing. At the failing levels those are the same
  // requests that make the level fail, so the old wall-clock divisor understated
  // throughput at exactly the levels being judged.
  //
  // Two things have to come off the wall. The push drain above is bookkeeping.
  // And when a level is bounded by TIME rather than by count, lanes stop
  // starting new round trips at LEVEL_MS but the ones already in flight run on
  // for up to DEADLINE_MS -- so the wall carries a straggler tail that no work
  // was offered in, and it is longest at exactly the levels that are failing.
  // Capping at LEVEL_MS is the offered window in that case; below it, the level
  // ran out of messages and the whole closed-loop wall IS the window.
  const issueWindowMs = Math.max(1, Math.min(LEVEL_MS, workedMs));
  const httpRequests = pollCount + httpRequestCount();
  const ok = results.filter((r) => r.ok);
  const timedOut = results.filter((r) => r.reason === 'timeout');
  const rateLimited = results.filter((r) => r.reason === 'rate-limited').length;
  const totals = ok.map((r) => r.totalMs);
  // Successes at their real time, timeouts at their elapsed time and flagged as
  // a lower bound. See `censoredQuantile`.
  const censored = [
    ...ok.map((r) => ({ ms: r.totalMs, censored: false })),
    ...timedOut.map((r) => ({ ms: Math.max(r.totalMs, DEADLINE_MS), censored: true })),
  ];
  return {
    concurrency,
    startedAt: startedAtIso,
    endedAt: new Date().toISOString(),
    attempted: results.length,
    succeeded: ok.length,
    failed: results.length - ok.length,
    timedOut: timedOut.length,
    rateLimited,
    failureReasons: results.filter((r) => !r.ok).reduce((acc, r) => {
      acc[r.reason] = (acc[r.reason] || 0) + 1;
      return acc;
    }, {}),
    wallMs,
    workedMs,
    issueWindowMs,
    lastIssuedAtMs: lastIssuedAt - startedAt,
    throughputPerSec: Number((ok.length / (issueWindowMs / 1000)).toFixed(3)),
    // What the pre-fix code printed: successes over the whole closed-loop
    // wall including the straggler tail. Kept so a before/after table has
    // the old number to compare against.
    throughputWallPerSec: Number((ok.length / (workedMs / 1000)).toFixed(3)),
    httpRequests,
    httpRequestsPerMessage: results.length
      ? Number((httpRequests / results.length).toFixed(2)) : null,
    pushEnabled: PUSH,
    pushesDrained: drained,
    requestsPerSec: Number((httpRequests / (issueWindowMs / 1000)).toFixed(3)),
    // Survivors only. Kept because it is what every earlier report printed, and
    // a before/after table needs the old number to compare against -- but it is
    // NOT the median of the experiment and is labelled so everywhere it shows.
    p50OkMs: quantile(totals, 0.5),
    p95OkMs: quantile(totals, 0.95),
    maxOkMs: quantile(totals, 1),
    meanOkMs: mean(totals),
    // The honest ones: timeouts counted at >= DEADLINE_MS.
    p50: censoredQuantile(censored, 0.5),
    p95: censoredQuantile(censored, 0.95),
    max: censoredQuantile(censored, 1),
    censoredSamples: timedOut.length,
    rejections: [...new Set(results.filter((r) => r.reason === 'rejected')
      .map((r) => r.error))].slice(0, 3),
    postP50Ms: quantile(ok.map((r) => r.postMs), 0.5),
    readP50Ms: quantile(ok.map((r) => r.readMs), 0.5),
    readsP50: quantile(ok.map((r) => r.reads), 0.5),
    slotSpan: ok.length
      ? Math.max(...ok.map((r) => r.slot)) - Math.min(...ok.map((r) => r.slot)) + 1
      : 0,
  };
}

const burners = await listBurners();
if (!burners.length) throw new Error('no burner wallets: run `npm run swarm:wallets` first');
const wallets = burners.map((b) => b.jwk);

const LANES = Math.max(...LEVELS);
const keepAliveApplied = await useKeepAlive({
  quiet: true, connections: CONNECTIONS || undefined, lanes: LANES,
});

const digest = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sourceVersions = {
  ramp: digest(fileURLToPath(import.meta.url)),
  hbclient: digest(path.join(HERE, 'hbclient.mjs')),
  keepalive: digest(path.join(HERE, 'keepalive.mjs')),
};
const rampStartedAt = new Date().toISOString();

console.log(`concurrency ramp against ${PID}`);
console.log(`node    ${NODE}`);
if (BOX_IP) console.log(`box     ${BOX_IP}`);
console.log(`action  ${ACTION}   wallets ${wallets.length}   budget p95 <= ${BUDGET_MS} ms\n`);
console.log(`version ${sourceVersions.ramp}`);
console.log(`pool    ${connectionLimit()} connections (${keepAliveApplied ? 'active' : 'unavailable'})   pre-poll ${PRE_POLL_MS} ms   `
  + `push ${PUSH ? 'on' : 'off'}`);
console.log('');
console.log(`     |                       | ROUND TRIP, timeouts counted at >=${DEADLINE_MS} ms |       |       |`);
console.log('conc |   ok  time  429 fail |      p50        p95        max | msg/s | req/s | slots');
console.log('-----+-----------------------+--------------------------------+-------+-------+------');

const levels = [];
for (const concurrency of LEVELS) {
  const row = await runLevel(concurrency, wallets);
  levels.push(row);
  const otherFail = row.failed - row.timedOut - row.rateLimited;
  console.log(
    `${String(row.concurrency).padStart(4)} |`
    + `${String(row.succeeded).padStart(5)}${String(row.timedOut).padStart(6)}`
    + `${String(row.rateLimited).padStart(5)}${String(otherFail).padStart(5)} |`
    + `${showCensored(row.p50).padStart(9)}${showCensored(row.p95).padStart(11)}`
    + `${showCensored(row.max).padStart(11)} |`
    + `${row.throughputPerSec.toFixed(2).padStart(6)} |`
    + `${row.requestsPerSec.toFixed(2).padStart(6)} |${String(row.slotSpan).padStart(6)}`,
  );
  // Let the scheduler drain before the next level, or level N+1 starts behind
  // level N's backlog and every number after the first is a queue measurement.
  await new Promise((done) => setTimeout(done, SETTLE_MS));
}

// The verdict. A level only counts as sustainable if it stayed under the budget
// AND was not rate-limited: 429s mean the limiter answered, not the node.
// The p95 that decides the verdict is the CENSORED one. A level where most
// round trips never came back cannot pass on the strength of the few that did.
const clean = levels.filter((row) => row.rateLimited === 0 && row.succeeded > 0);
const within = clean.filter((row) => row.p95.ms !== null && !row.p95.censored
  && row.p95.ms <= BUDGET_MS);
const best = within.reduce((a, b) => (a === null || b.throughputPerSec > a.throughputPerSec ? b : a), null);
const firstOver = clean.find((row) => row.p95.ms !== null
  && (row.p95.censored || row.p95.ms > BUDGET_MS)) ?? null;

console.log('');
if (best) {
  console.log(`sustained  ${best.throughputPerSec.toFixed(2)} msg/s at concurrency `
    + `${best.concurrency} (p95 ${best.p95.ms} ms, under the ${BUDGET_MS} ms budget)`);
} else {
  console.log(`sustained  nothing stayed under ${BUDGET_MS} ms — the lowest level already exceeded it`);
}
if (firstOver) {
  console.log(`breaks at  concurrency ${firstOver.concurrency}: p95 ${showCensored(firstOver.p95)} ms, `
    + `${firstOver.throughputPerSec.toFixed(2)} msg/s, ${firstOver.failed} failed`);
}
// Say out loud what the old survivors-only number would have claimed, wherever
// it differs. This is the defect that made the concurrency-50 row publishable.
// A rejection is not a slow message, it is the wrong message. Say so first:
// every number below it is timing a validation error rather than a write.
const rejecting = levels.filter((row) => (row.failureReasons.rejected || 0) > 0);
if (rejecting.length) {
  const sample = levels.flatMap((row) => row.rejections).find(Boolean);
  console.log(`REJECTED   the contract refused ${rejecting.reduce((n, r) => n + r.failureReasons.rejected, 0)}`
    + ` writes — ${sample}`);
  console.log('           this is not latency: fix ACTION/DATA before believing any row above');
}
const biased = levels.filter((row) => row.censoredSamples > 0 && row.p50OkMs !== null);
for (const row of biased) {
  console.log(`survivor bias  conc ${row.concurrency}: ok-only p50 ${row.p50OkMs} ms over `
    + `${row.succeeded}/${row.attempted} samples; censored p50 ${showCensored(row.p50)} ms`);
}
const limited = levels.filter((row) => row.rateLimited > 0);
if (limited.length) {
  console.log(`rate limit  ${limited.map((r) => `${r.concurrency}:${r.rateLimited}`).join(' ')}`
    + '  — these levels measured dev_rate_limit, not node capacity');
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, `${JSON.stringify({
  process: PID, node: NODE, boxIp: BOX_IP, action: ACTION, budgetMs: BUDGET_MS,
  deadlineMs: DEADLINE_MS, connections: connectionLimit(), prePollMs: PRE_POLL_MS,
  keepAliveApplied, push: PUSH, wallets: wallets.length, startedAt: rampStartedAt,
  endedAt: new Date().toISOString(), sourceVersions,
  levels, verdict: { sustained: best, breaksAt: firstOver },
}, null, 2)}\n`);
console.log(`\nreport     ${OUT}`);
