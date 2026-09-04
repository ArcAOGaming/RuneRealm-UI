#!/usr/bin/env node
/**
 * Fifty-wallet Rune Realm swarm.
 *
 *   node backend/native/swarm.mjs plan
 *   node backend/native/swarm.mjs wallets
 *   node backend/native/swarm.mjs run --live --mode soak --duration 2h
 *   node backend/native/swarm.mjs run --live --mode stress --limit 50
 *
 * `run` bundles and calls src/lib/game.ts, so every action uses the same
 * ANS-104 signature, scheduling, slot correlation, and response handling as the
 * browser. Each wallet lives in its own worker thread so global wallet state can
 * never bleed between concurrent actors.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureBurners, listBurners, liveProcess } from './burners.mjs';
import { Actor } from './swarm/actor.mjs';
import { buildSwarmClient } from './swarm/build-client.mjs';
import { failureEventFields } from './swarm/error-fields.mjs';
import {
  createGatedDispatcher, createTokenBucket, resolveLoadPolicy,
  inspectTerminations, responseOutcomeCounts, SAFE_ACTIONS_PER_SECOND, SAFE_CONCURRENCY,
  settledValuesOrThrow,
} from './swarm/load-control.mjs';
import { PROFILES, ROLE_DEFINITIONS, pvpPairs } from './swarm/profiles.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const BURNER_DIR = process.env.BURNER_DIR || path.join(ROOT, '.burners');
const OUT_DIR = path.join(ROOT, '.swarm');
const argv = process.argv.slice(2);
const command = argv.find((arg) => !arg.startsWith('--')) ?? 'plan';

function flag(name) {
  return argv.includes(`--${name}`);
}

function option(name, fallback) {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : fallback;
}

function integerOption(name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const value = Number(option(name, fallback));
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`--${name} must be an integer from ${min} to ${max}`);
  }
  return value;
}

function optionalNumberOption(name) {
  const value = option(name, undefined);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`--${name} must be a number greater than zero`);
  }
  return parsed;
}

function durationMs(value) {
  if (!value) return null;
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(String(value));
  if (!match) throw new Error('--duration must look like 30s, 15m, or 2h');
  const unit = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000 }[match[2]];
  return Number(match[1]) * unit;
}

/**
 * Unwrap a published key that the node returned inside a result envelope.
 *
 * A published read can come back either as the value itself or wrapped as
 * `{ status, "ao-result": "body", body }`, where `body` holds the value and is
 * sometimes still a JSON string. Reading the outer object as if it were the
 * value does not fail loudly — every field simply reads `undefined`, so an
 * invariant check on it reports a violation that never happened. That is
 * exactly what the 2026-09-02 soak did: it ended on a false "economy invariant
 * failed" while the live `economy` key had `invariants.ok = true` and every
 * asset balanced.
 */
function unwrapPublished(value) {
  if (!value || typeof value !== 'object') return value;
  if (value.body === undefined || value.invariants !== undefined) return value;
  if (typeof value.body !== 'string') return value.body;
  try { return JSON.parse(value.body); } catch { return value; }
}

async function readEconomyAudit(node, pid) {
  try {
    const response = await fetch(`${node}/${pid}~process@1.0/now/economy`, {
      headers: { accept: 'application/json' }, signal: AbortSignal.timeout(90_000),
    });
    const text = (await response.text()).trim();
    if (!response.ok || /^<!DOCTYPE html|^<html/i.test(text)) {
      return { ok: false, error: `economy read ${response.status}` };
    }
    const value = unwrapPublished(JSON.parse(text));
    return {
      ok: value?.invariants?.ok === true,
      mode: value?.mode,
      invariants: value?.invariants,
      gold: value?.gold,
      openOrders: value?.orders?.length ?? 0,
      fillsRetained: value?.fills?.length ?? 0,
      desks: Object.fromEntries(Object.entries(value?.desks ?? {}).map(([item, desk]) => [
        item, { stock: desk.stock, stockCap: desk.stockCap, goldReserve: desk.goldReserve,
          pause: desk.pause },
      ])),
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Which actors run. `--limit N` takes the first N; `--only a,b` names them.
 *
 * `--limit` alone cannot express "one actor that keeps finding work", because
 * the profile order is grouped by role and the first eight are all quest
 * runners. A single quest runner exhausts what it can usefully do and then
 * spins `idle.no-economic-opportunity` forever — measured 2026-09-03, a
 * 15-minute window with ZERO signed writes, which makes a latency run collect
 * nothing at all. Naming the actor is the difference between a long run that
 * measures something and one that idles.
 */
function selectedProfiles() {
  const only = option('only', null);
  if (only !== null) {
    const wanted = String(only).split(',').map((name) => name.trim()).filter(Boolean);
    if (!wanted.length) throw new Error('--only needs at least one wallet name');
    return wanted.map((name) => {
      const profile = PROFILES.find((candidate) => candidate.wallet === name);
      if (!profile) throw new Error(`--only: no such wallet profile '${name}'`);
      return profile;
    });
  }
  const limit = integerOption('limit', PROFILES.length, { min: 1, max: PROFILES.length });
  return PROFILES.slice(0, limit);
}

function manifestRows(profiles = PROFILES) {
  const burners = new Map(listBurners().map((burner) => [burner.name, burner]));
  return profiles.map((profile) => {
    const burner = burners.get(profile.wallet);
    return {
      wallet: profile.wallet,
      address: burner?.address ?? null,
      callSign: profile.callSign,
      role: profile.role,
      roleLabel: profile.roleLabel,
      faction: profile.faction,
      description: profile.description,
      ...(profile.pvpPair ? { pvpPair: profile.pvpPair, pvpSide: profile.pvpSide } : {}),
    };
  });
}

function writeManifest() {
  fs.mkdirSync(BURNER_DIR, { recursive: true });
  const file = path.join(BURNER_DIR, 'manifest.json');
  const body = {
    version: 1,
    generatedAt: new Date().toISOString(),
    warning: 'Throwaway test identities. Private JWK files stay in this gitignored directory.',
    wallets: manifestRows(),
  };
  fs.writeFileSync(file, JSON.stringify(body, null, 2) + '\n', { mode: 0o600 });
  return file;
}

function printPlan(profiles = selectedProfiles()) {
  const addresses = new Map(listBurners().map((burner) => [burner.name, burner.address]));
  console.log(`Rune Realm swarm plan — ${profiles.length} independent test actors\n`);
  console.table(profiles.map((profile) => ({
    wallet: profile.wallet,
    callSign: profile.callSign,
    role: profile.roleLabel,
    faction: profile.faction,
    pair: profile.pvpPair ?? '',
    address: addresses.get(profile.wallet) ?? '(not generated)',
    description: profile.description,
  })));
  const counts = {};
  for (const profile of profiles) counts[profile.role] = (counts[profile.role] ?? 0) + 1;
  console.log('Role mix:', Object.entries(counts)
    .map(([role, count]) => `${count} ${ROLE_DEFINITIONS[role].label.toLowerCase()}${count === 1 ? '' : 's'}`)
    .join(', '));
  console.log('\nPlanning is read-only. Live writes require the explicit --live flag.');
}

async function mapLimit(items, limit, fn, shouldStart = () => true) {
  const results = new Array(items.length);
  let next = 0;
  async function runner() {
    while (true) {
      if (!shouldStart()) return;
      const index = next++;
      if (index >= items.length) return;
      try {
        results[index] = { status: 'fulfilled', value: await fn(items[index], index) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
  return results;
}

function quantile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

function timingStats(values) {
  const valid = values.filter((value) => Number.isFinite(value) && value >= 0);
  return {
    count: valid.length,
    p50Ms: quantile(valid, 0.5),
    p90Ms: quantile(valid, 0.9),
    p99Ms: quantile(valid, 0.99),
    maxMs: valid.length ? Math.max(...valid) : 0,
  };
}

/**
 * Percentiles for every phase of a signed write, over a run.
 *
 * The phases are reported separately because they fail for unrelated reasons
 * and are fixed in unrelated places: signing is local CPU, the POST is the
 * scheduler admitting the item, and the reply read is pull-based compute over
 * the published state. A single round-trip number hides which one moved, which
 * is the only thing a regression here needs to say.
 */
function transportStats(samples) {
  const ok = samples.filter((sample) => sample.ok);
  const phase = (name, from = ok) => timingStats(from.map((sample) => sample[name]));
  const withRead = ok.filter((sample) => Number.isFinite(sample.readMs));
  return {
    writes: samples.length,
    ok: ok.length,
    failed: samples.length - ok.length,
    // Sign and POST are the two the client controls and the node answers.
    buildMs: phase('buildMs'),
    signMs: phase('signMs'),
    postMs: phase('postMs'),
    sendMs: phase('sendMs'),
    // Reading the computed reply. Charged separately because it is compute,
    // not scheduling, and it is the half that grows with published state.
    readMs: phase('readMs', withRead),
    roundTripMs: timingStats(withRead.map((s) => s.sendMs + s.readMs)),
    computeAttempts: timingStats(withRead.map((s) => s.attempts ?? 1)),
    bytes: timingStats(ok.map((sample) => sample.bytes)),
    // Failures carry no phase split worth averaging, but their count over time
    // is how a node outage reads in the record.
    failuresByError: samples.filter((sample) => !sample.ok).reduce((acc, sample) => {
      const key = sample.error ?? 'unknown';
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {}),
  };
}

function formatPhase(label, stats) {
  return `  ${label.padEnd(16)} n=${String(stats.count).padStart(5)}`
    + ` p50 ${String(Math.round(stats.p50Ms)).padStart(6)}ms`
    + ` p90 ${String(Math.round(stats.p90Ms)).padStart(6)}ms`
    + ` p99 ${String(Math.round(stats.p99Ms)).padStart(6)}ms`
    + ` max ${String(Math.round(stats.maxMs)).padStart(6)}ms`;
}

function printTransport(stats, title) {
  console.log(`\n${title}  (${stats.ok} ok, ${stats.failed} failed)`);
  console.log(formatPhase('build', stats.buildMs));
  console.log(formatPhase('sign', stats.signMs));
  console.log(formatPhase('POST -> slot', stats.postMs));
  console.log(formatPhase('send subtotal', stats.sendMs));
  console.log(formatPhase('reply read', stats.readMs));
  console.log(formatPhase('round trip', stats.roundTripMs));
}

async function runLive() {
  const profiles = selectedProfiles();
  if (!flag('live')) {
    printPlan(profiles);
    console.log('\nTo mutate the configured game process, rerun with --live.');
    return;
  }

  if (flag('stress') && option('mode', undefined) !== undefined) {
    throw new Error('Use either --stress or --mode, not both');
  }
  const mode = flag('stress') ? 'stress' : option('mode', 'soak');
  const policy = resolveLoadPolicy({
    mode,
    walletCount: profiles.length,
    concurrency: option('concurrency', undefined),
    actionsPerSecond: optionalNumberOption('actions-per-second'),
    burst: option('burst', undefined),
  });
  const { concurrency, actionsPerSecond, burst } = policy;
  const cycles = integerOption('cycles', 10, { min: 1, max: 1_000_000 });
  const runFor = durationMs(option('duration', null));
  // How often a long run prints its phase split. Only meaningful for a timed
  // run: a short cycle run finishes before the first interval would fire.
  const reportEvery = runFor === null && !option('report', null)
    ? null
    : durationMs(option('report', '5m'));
  const cleanupOnly = flag('cleanup-only');
  if (cleanupOnly && runFor !== null) {
    throw new Error('--cleanup-only cannot be combined with --duration');
  }
  const tickMs = integerOption('tick-ms', 1_000, { min: 0, max: 3_600_000 });
  // Bootstrap may perform login, faction choice, and adoption sequentially;
  // each scheduled slot gets its own one-minute compute window in the shipped
  // client. Keep the actor envelope above that combined worst case.
  const timeoutMs = integerOption('timeout-ms', 300_000, { min: 5_000, max: 600_000 });
  const seed = integerOption('seed', Date.now() & 0x7fffffff, { min: 0, max: 0x7fffffff });
  const burners = new Map(listBurners().map((burner) => [burner.name, burner]));
  const missing = profiles.filter((profile) => !burners.has(profile.wallet));
  if (missing.length) {
    throw new Error(`Missing ${missing.length} wallets. Run: npm run swarm:wallets`);
  }
  const addresses = profiles.map((profile) => burners.get(profile.wallet).address);
  if (new Set(addresses).size !== addresses.length) throw new Error('Burner addresses are not unique');

  const configured = liveProcess();
  const pid = option('pid', configured.pid);
  const node = option('node', configured.node);
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = path.join(OUT_DIR, 'runs', runId);
  fs.mkdirSync(runDir, { recursive: true });
  const eventsFile = path.join(runDir, 'events.jsonl');
  const stream = fs.createWriteStream(eventsFile, { flags: 'a' });
  const record = (event) => stream.write(JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n');
  const client = await buildSwarmClient({ root: ROOT, pid, node, outDir: path.join(OUT_DIR, 'generated') });
  const actors = profiles.map((profile) => new Actor({
    profile,
    burner: burners.get(profile.wallet),
    clientFile: client.file,
    runId,
    seed,
    timeoutMs,
    peers: profiles
      .filter((other) => other.wallet !== profile.wallet)
      .map((other) => burners.get(other.wallet).address),
  }));
  const byWallet = new Map(actors.map((actor) => [actor.profile.wallet, actor]));
  const timings = new Map();
  // Every signed write's phase split, successes and failures alike, in the
  // order the transport reported them.
  const transportSamples = [];
  const successfulResponseDurations = [];
  const failedResponseDurations = [];
  const acquireDispatchToken = actionsPerSecond === null
    ? async () => 0
    : createTokenBucket({ actionsPerSecond, burst });
  const dispatch = createGatedDispatcher({ concurrency, acquire: acquireDispatchToken });
  // Cleanup is operational recovery, not part of the offered stress load. Give
  // it its own conservative gate even when gameplay deliberately runs all
  // fifty actors without a rate limit.
  const cleanupConcurrency = Math.min(SAFE_CONCURRENCY, actors.length);
  const cleanupDispatch = createGatedDispatcher({
    concurrency: cleanupConcurrency,
    acquire: createTokenBucket({ actionsPerSecond: SAFE_ACTIONS_PER_SECOND, burst: 1 }),
  });
  const failures = [];
  let actionCount = 0;
  // Rejections a soak absorbed rather than died on. Reported with the run
  // totals so a tolerant run cannot quietly hide a rising failure rate.
  let tolerated = 0;
  let failedResponseCount = 0;
  let stopping = false;
  let interrupted = false;
  let fatalError = null;
  let deadline = null;

  const canDispatchGameplay = () => !stopping
    && (deadline === null || Date.now() < deadline);

  const onSignal = () => {
    if (interrupted) process.exit(130);
    interrupted = true;
    stopping = true;
    console.log('\nStopping after in-flight actions; press Ctrl+C again to force exit.');
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  const observe = (actor, phase, outcome) => {
    actionCount++;
    if (Array.isArray(outcome.transport)) transportSamples.push(...outcome.transport);
    const duration = outcome.durationMs ?? 0;
    successfulResponseDurations.push(duration);
    const bucket = timings.get(outcome.action) ?? [];
    bucket.push(duration);
    timings.set(outcome.action, bucket);
    const state = outcome.state;
    const suffix = state
      ? ` ${state.status ?? '-'} L${state.level ?? '-'} ${state.runes}r ${state.lootboxes}box`
      : '';
    console.log(`${actor.profile.wallet.padEnd(9)} ${actor.profile.callSign.padEnd(12)} ${outcome.action.padEnd(26)} ${String(duration).padStart(6)}ms${suffix}`);
    record({ type: 'action', phase, wallet: actor.profile.wallet,
      callSign: actor.profile.callSign, role: actor.profile.role,
      address: actor.burner.address, ...outcome });
    return outcome;
  };

  const failed = (actor, phase, error, { response = true } = {}) => {
    if (response) failedResponseCount++;
    const entry = { wallet: actor.profile.wallet, callSign: actor.profile.callSign,
      phase, ...failureEventFields(error) };
    if (Array.isArray(entry.transport)) transportSamples.push(...entry.transport);
    failures.push(entry);
    if (response && Number.isFinite(error.durationMs)) {
      failedResponseDurations.push(error.durationMs);
    }
    console.error(`${actor.profile.wallet.padEnd(9)} ${actor.profile.callSign.padEnd(12)} ERROR ${phase}: ${entry.error}`);
    record({ type: 'error', ...entry });
  };

  const invokeVia = async (gate, actor, phase, command, payload, {
    shouldStart = () => true, dispatchDeadline = null,
  } = {}) => {
    try {
      const dispatched = await gate(() => actor.call(command, payload), {
        shouldStart, deadline: dispatchDeadline,
      });
      if (!dispatched.started) return null;
      return observe(actor, phase, dispatched.value);
    } catch (error) {
      failed(actor, phase, error);
      if (error?.fatalRetirement === true) {
        stopping = true;
        fatalError = fatalError ?? error;
      }
      throw error;
    }
  };
  const invoke = (actor, phase, command, payload, options) =>
    invokeVia(dispatch, actor, phase, command, payload, options);
  const invokeCleanup = (actor, phase, command, payload) =>
    invokeVia(cleanupDispatch, actor, phase, command, payload);
  const invokeGameplay = (actor, phase, command, payload) => invoke(
    actor, phase, command, payload,
    { shouldStart: canDispatchGameplay, dispatchDeadline: deadline },
  );

  const pairs = pvpPairs(profiles).map((pair) => ({ ...pair, stage: 'prepare', battleId: null, rounds: 0 }));
  const pairedWallets = new Set(pairs.flatMap((pair) => [pair.challenger.wallet, pair.accepter.wallet]));
  const routineActors = actors.filter((actor) => !pairedWallets.has(actor.profile.wallet));

  async function advancePair(pair, cycle) {
    if (!canDispatchGameplay()) return;
    const challenger = byWallet.get(pair.challenger.wallet);
    const accepter = byWallet.get(pair.accepter.wallet);
    if (pair.stage === 'prepare') {
      const prepared = await Promise.allSettled([
        invokeGameplay(challenger, `cycle.${cycle}.pvp.prepare`, 'preparePvp'),
        invokeGameplay(accepter, `cycle.${cycle}.pvp.prepare`, 'preparePvp'),
      ]);
      const [left, right] = settledValuesOrThrow(prepared, `${pair.name} prepare`);
      if (!left || !right) return;
      if (left.occupied || right.occupied) {
        settledValuesOrThrow(await Promise.allSettled([
          invokeCleanup(challenger, `cycle.${cycle}.pvp.recover`, 'cleanup'),
          invokeCleanup(accepter, `cycle.${cycle}.pvp.recover`, 'cleanup'),
        ]), `${pair.name} recovery cleanup`);
        return;
      }
      if (!left.ready || !right.ready) return;
      if (!canDispatchGameplay()) return;
      const challenged = await invokeGameplay(
        challenger, `cycle.${cycle}.pvp.challenge`, 'challenge', accepter.burner.address,
      );
      if (!challenged) return;
      pair.battleId = challenged.battleId;
      if (!pair.battleId) throw new Error(`${pair.name} challenge returned no battle id`);
      // A challenge that began inside the soak window can publish after the
      // deadline. Cancel it instead of starting another gameplay write late.
      if (!canDispatchGameplay()) {
        settledValuesOrThrow(await Promise.allSettled([
          invokeCleanup(challenger, `cycle.${cycle}.pvp.deadline-cleanup`, 'cleanup'),
          invokeCleanup(accepter, `cycle.${cycle}.pvp.deadline-cleanup`, 'cleanup'),
        ]), `${pair.name} deadline cleanup`);
        pair.stage = 'prepare';
        pair.battleId = null;
        pair.rounds = 0;
        return;
      }
      const accepted = await invokeGameplay(
        accepter, `cycle.${cycle}.pvp.accept`, 'accept', pair.battleId,
      );
      if (!accepted) return;
      pair.stage = 'battle';
      pair.rounds = 0;
      return;
    }

    const moved = settledValuesOrThrow(await Promise.allSettled([
      invokeGameplay(challenger, `cycle.${cycle}.pvp.round`, 'pvpMove', pair.battleId),
      invokeGameplay(accepter, `cycle.${cycle}.pvp.round`, 'pvpMove', pair.battleId),
    ]), `${pair.name} round`);
    pair.rounds++;
    const outcomes = moved.filter(Boolean);
    const ended = outcomes.some((outcome) => outcome.action === 'pvp.ended'
      || outcome.state?.battle?.status === 'ended'
      || outcome.battle?.status === 'ended');
    if (ended) {
      record({ type: 'pvp.settled', pair: pair.name, battleId: pair.battleId, rounds: pair.rounds });
      pair.stage = 'prepare';
      pair.battleId = null;
      pair.rounds = 0;
    } else if (pair.rounds >= 55) {
      settledValuesOrThrow(await Promise.allSettled([
        invokeCleanup(challenger, `cycle.${cycle}.pvp.abort`, 'cleanup'),
        invokeCleanup(accepter, `cycle.${cycle}.pvp.abort`, 'cleanup'),
      ]), `${pair.name} abort cleanup`);
      pair.stage = 'prepare';
      pair.battleId = null;
      pair.rounds = 0;
    }
  }

  const startedAt = Date.now();
  // A timed soak measures actual play. First-time onboarding can take several
  // minutes for fifty wallets on a serial compute queue, so start the requested
  // duration only after every actor has successfully bootstrapped.
  record({ type: 'run.start', runId, pid, node, seed, mode, concurrency,
    actionsPerSecond, burst,
    cycles: runFor === null ? cycles : null, durationMs: runFor, wallets: manifestRows(profiles) });
  console.log(`Rune Realm swarm ${runId}`);
  console.log(`process     ${pid}`);
  console.log(`node        ${node}`);
  console.log(`actors      ${actors.length} (${pairs.length} fixed PvP pairs)`);
  console.log(`mode        ${mode}`);
  console.log(`concurrency ${concurrency}`);
  console.log(`start rate  ${actionsPerSecond === null ? 'unlimited' : `${actionsPerSecond} worker command(s)/s, burst ${burst}`}`);
  console.log(`seed        ${seed}`);
  console.log(`events      ${eventsFile}\n`);

  // A long run that reports only at the end is not observable while it matters.
  // Every interval, print the phase split for the writes since the last one and
  // put the same numbers in the event log, so a node that degrades or drops out
  // partway through is visible as a change rather than only as a worse average.
  let reportedThrough = 0;
  const reportTransport = () => {
    const window = transportSamples.slice(reportedThrough);
    reportedThrough = transportSamples.length;
    if (!window.length) {
      console.log(`\n[${new Date().toISOString()}] no signed writes in the last interval`);
      record({ type: 'transport.progress', writes: 0 });
      return;
    }
    const stats = transportStats(window);
    printTransport(stats, `[${new Date().toISOString()}] last ${window.length} signed writes`);
    record({ type: 'transport.progress', elapsedMs: Date.now() - startedAt, ...stats });
  };
  const reportTimer = reportEvery === null ? null : setInterval(reportTransport, reportEvery);
  reportTimer?.unref?.();

  try {
    const bootstrapped = await mapLimit(actors, concurrency, (actor) =>
      invoke(actor, 'bootstrap', 'bootstrap'));
    const locked = bootstrapped.filter((entry) => entry.status === 'fulfilled'
      && entry.value.state?.unlocked !== true);
    if (locked.length) {
      throw new Error(`${locked.length} wallet(s) are locked. Run: npm run swarm:unlock`);
    }
    if (bootstrapped.some((entry) => entry.status === 'rejected')) {
      throw new Error('One or more wallets failed to bootstrap; see the event log');
    }
    const blocked = bootstrapped.filter((entry) => entry.status === 'fulfilled'
      && entry.value.blocked === true);
    if (blocked.length && !cleanupOnly) {
      // Sit them out; do not abandon the run.
      //
      // A blocked wallet is one sworn to a faction that is not its plan, which
      // is permanent — the process refuses a second oath. Aborting the whole
      // run made a handful of such wallets fatal to all fifty, and the only
      // remedy on offer was a redeploy. That is the wrong trade for a process
      // somebody is already using: the other actors are still valid load and
      // still measure the thing being measured.
      //
      // What is genuinely lost is narrow and worth stating: a PvP pair whose
      // partner is excluded cannot duel, so PvP coverage drops for those pairs.
      // `verify.mjs` reads the event log, where every exclusion is recorded.
      //
      // `--strict-plan` restores the abort, for a fresh deployment where a
      // mismatch means the seeding step went wrong and should be fixed first.
      if (flag('strict-plan')) {
        throw new Error(`${blocked.length} wallet(s) do not match their test plan; `
          + 'see the event log');
      }
      const excluded = new Set(blocked.map((entry) => entry.value.wallet));
      for (let i = actors.length - 1; i >= 0; i -= 1) {
        if (excluded.has(actors[i].profile.wallet)) actors.splice(i, 1);
      }
      record({ type: 'plan.excluded', wallets: [...excluded] });
      console.log(`\n${excluded.size} wallet(s) sworn off-plan and excluded: `
        + `${[...excluded].join(', ')}`);
      console.log(`Running with ${actors.length}. --strict-plan aborts instead.`);
    }

    if (runFor !== null && !cleanupOnly) {
      deadline = Date.now() + runFor;
      record({ type: 'soak.start', durationMs: runFor, deadline: new Date(deadline).toISOString() });
      console.log(`\nSoak window started; running gameplay for ${Math.round(runFor / 60_000)} minute(s).`);
    }

    const cycleLimit = cleanupOnly
      ? 0
      : runFor === null ? cycles : Number.MAX_SAFE_INTEGER;
    for (let cycle = 1; !stopping && cycle <= cycleLimit
      && (deadline === null || Date.now() < deadline); cycle++) {
      console.log(`\n--- cycle ${cycle} ---`);
      const batches = [mapLimit(routineActors, routineActors.length, (actor) =>
        invokeGameplay(actor, `cycle.${cycle}`, 'tick'), canDispatchGameplay)];
      if (pairs.length && canDispatchGameplay()) batches.push(
        mapLimit(pairs, pairs.length, (pair) => advancePair(pair, cycle), canDispatchGameplay),
      );
      const cycleResults = await Promise.all(batches);
      for (const results of cycleResults) {
        // A soak absorbs an actor's rejection; a cycle run still fails loudly.
        //
        // Every rejection here is already recorded against its actor, and most
        // of them are the run being concurrent rather than the game being
        // wrong: an actor picks its action from published state, and by the
        // time the message lands the companion has started a quest, the daily
        // is already claimed, or the listing is gone. "Your companion is busy:
        // Quest" ended a SIX HOUR soak after 133 seconds.
        //
        // This is the split the harness is built on — the swarm writes down
        // what happened, `verify.mjs` decides afterwards whether it was
        // allowed, because only the whole log can tell an entitled failure from
        // a real one. Aborting mid-run throws away the evidence needed to make
        // that call. `--fail-fast` restores the abort.
        if (runFor === null || flag('fail-fast')) {
          settledValuesOrThrow(results, `cycle ${cycle}`);
        } else {
          for (const entry of results) {
            if (entry.status === 'rejected') tolerated += 1;
          }
        }
      }
      if (!stopping && tickMs > 0 && cycle < cycleLimit
          && (deadline === null || Date.now() + tickMs < deadline)) {
        await new Promise((resolve) => setTimeout(resolve, tickMs));
      }
    }
  } catch (error) {
    fatalError = error;
    const entry = { wallet: null, callSign: null, phase: 'run',
      ...failureEventFields(error) };
    failures.push(entry);
    console.error(`\nRUN ERROR: ${error.message}`);
    record({ type: 'error', ...entry });
  } finally {
    if (reportTimer) clearInterval(reportTimer);
    // Timed runs have a definite stop, so leave no bot or PvP arena session
    // waiting for an actor that is no longer running. Cycle runs preserve bot
    // progress unless --cleanup-all is explicit, while PvP is always released.
    const cleanEveryArena = cleanupOnly || runFor !== null || flag('cleanup-all');
    const cleanupActors = cleanEveryArena
      ? actors
      : actors.filter((actor) => pairedWallets.has(actor.profile.wallet));
    if (cleanupActors.length) {
      console.log(`\nCleaning up ${cleanEveryArena ? 'all arena' : 'PvP'} sessions...`);
      await mapLimit(cleanupActors, cleanupActors.length, async (actor) => {
        try {
          await invokeCleanup(actor, cleanEveryArena ? 'cleanup-all' : 'cleanup', 'cleanup');
        } catch { /* already logged */ }
      });
    }
    const terminations = await Promise.allSettled(actors.map((actor) => actor.terminate()));
    const terminationAudit = inspectTerminations(terminations, (error, index) => {
      failed(actors[index], 'terminate', error, { response: false });
    });
    if (terminationAudit.fatal) {
      fatalError = fatalError ?? terminationAudit.firstError;
      stopping = true;
    }
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }

  const economyAudit = await readEconomyAudit(node, pid);
  if (!economyAudit.ok) {
    failures.push({ wallet: 'system', callSign: 'Economy audit', phase: 'final',
      error: economyAudit.error ?? 'published economy invariant failed' });
  }
  const summary = {
    runId,
    pid,
    node,
    seed,
    walletCount: actors.length,
    mode,
    concurrency,
    actionsPerSecond,
    burst,
    actionCount,
    failureCount: failures.length,
    elapsedMs: Date.now() - startedAt,
    responses: {
      ...responseOutcomeCounts({
        successfulDurations: successfulResponseDurations,
        failedDurations: failedResponseDurations,
        failedCount: failedResponseCount,
      }),
      successLatencyMs: timingStats(successfulResponseDurations),
      failureLatencyMs: timingStats(failedResponseDurations),
    },
    actions: Object.fromEntries([...timings].map(([action, values]) => [action, timingStats(values)])),
    transport: transportStats(transportSamples),
    failures,
    economy: economyAudit,
  };
  const summaryFile = path.join(runDir, 'summary.json');
  fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2) + '\n');
  record({ type: 'run.end', ...summary });
  await new Promise((resolve) => stream.end(resolve));
  console.log(`\n${actionCount} actions, ${failures.length} errors`
    + `${tolerated ? ` (${tolerated} tolerated, run continued)` : ''}`
    + `, ${Math.round(summary.elapsedMs / 1000)}s`);
  if (summary.transport.writes) printTransport(summary.transport, 'Signed write, by phase');
  console.log(`summary     ${summaryFile}`);
  if (interrupted) process.exitCode = 130;
  else if (failures.length || fatalError) process.exitCode = 1;
}

if (command === 'wallets') {
  const count = integerOption('count', PROFILES.length, { min: PROFILES.length, max: PROFILES.length });
  const made = ensureBurners(count);
  const manifest = writeManifest();
  console.log(`\n${made.length ? `Created ${made.length} wallet(s); ` : ''}${count} wallet(s) ready.`);
  console.log(`Keys      ${BURNER_DIR}`);
  console.log(`Manifest  ${manifest}`);
  console.log('No live process was changed and no wallet was funded.');
} else if (command === 'plan' || command === 'profiles') {
  printPlan();
} else if (command === 'run') {
  await runLive();
} else {
  console.error('usage: swarm.mjs [plan | wallets | run --live --mode soak|stress] [options]');
  process.exitCode = 1;
}
