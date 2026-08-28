#!/usr/bin/env node
/**
 * Fifty-wallet Rune Realm swarm.
 *
 *   node backend/native/swarm.mjs plan
 *   node backend/native/swarm.mjs wallets
 *   node backend/native/swarm.mjs run --live --cycles 10 --concurrency 4
 *   node backend/native/swarm.mjs run --live --duration 2h --concurrency 4
 *
 * `run` bundles and calls src/lib/game.ts, so every action uses the same
 * ANS-104 signature, scheduling, slot correlation, and response handling as the
 * browser. Each wallet lives in its own worker thread so global wallet state can
 * never bleed between concurrent actors.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { ensureBurners, listBurners, liveProcess } from './burners.mjs';
import { buildSwarmClient } from './swarm/build-client.mjs';
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

function durationMs(value) {
  if (!value) return null;
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(String(value));
  if (!match) throw new Error('--duration must look like 30s, 15m, or 2h');
  const unit = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000 }[match[2]];
  return Number(match[1]) * unit;
}

function selectedProfiles() {
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

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function runner() {
    while (true) {
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

class Actor {
  constructor({ profile, burner, clientFile, runId, seed, timeoutMs }) {
    this.profile = profile;
    this.burner = burner;
    this.timeoutMs = timeoutMs;
    this.sequence = 0;
    this.pending = new Map();
    this.worker = new Worker(new URL('./swarm/worker.mjs', import.meta.url), {
      workerData: {
        profile,
        walletFile: burner.file,
        address: burner.address,
        clientFile,
        runId,
        seed,
      },
    });
    this.ready = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`${profile.wallet} worker did not start`)), 30_000);
      this.worker.on('message', (message) => {
        if (message.type === 'ready') {
          clearTimeout(timeout);
          resolve(message);
          return;
        }
        const pending = this.pending.get(message.id);
        if (!pending) return;
        clearTimeout(pending.timeout);
        this.pending.delete(message.id);
        if (message.ok) pending.resolve(message.value);
        else {
          const error = new Error(message.error.message);
          error.name = message.error.name;
          error.durationMs = message.error.durationMs;
          pending.reject(error);
        }
      });
      this.worker.once('error', reject);
    });
    this.worker.on('error', (error) => this.rejectPending(error));
    this.worker.on('exit', (code) => {
      if (code !== 0) this.rejectPending(new Error(`${profile.wallet} worker exited ${code}`));
    });
  }

  rejectPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }

  async call(command, payload) {
    await this.ready;
    const id = `${this.profile.wallet}:${++this.sequence}`;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${this.profile.wallet} ${command} timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      this.worker.postMessage({ id, command, payload });
    });
  }

  terminate() {
    return this.worker.terminate();
  }
}

function quantile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

async function runLive() {
  const profiles = selectedProfiles();
  if (!flag('live')) {
    printPlan(profiles);
    console.log('\nTo mutate the configured game process, rerun with --live.');
    return;
  }

  const concurrency = integerOption('concurrency', 4, { min: 1, max: 50 });
  const cycles = integerOption('cycles', 10, { min: 1, max: 1_000_000 });
  const runFor = durationMs(option('duration', null));
  const tickMs = integerOption('tick-ms', 1_000, { min: 0, max: 3_600_000 });
  const timeoutMs = integerOption('timeout-ms', 120_000, { min: 5_000, max: 600_000 });
  const seed = integerOption('seed', Date.now() & 0x7fffffff, { min: 0, max: 0x7fffffff });
  if (concurrency > 4) {
    console.warn(`WARNING: ${concurrency} concurrent writers exceeds the measured safe default of 4.`);
  }

  const burners = new Map(listBurners().map((burner) => [burner.name, burner]));
  const missing = profiles.filter((profile) => !burners.has(profile.wallet));
  if (missing.length) {
    throw new Error(`Missing ${missing.length} wallets. Run: npm run swarm:wallets`);
  }
  const addresses = profiles.map((profile) => burners.get(profile.wallet).address);
  if (new Set(addresses).size !== addresses.length) throw new Error('Burner addresses are not unique');

  const { pid, node } = liveProcess();
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
  }));
  const byWallet = new Map(actors.map((actor) => [actor.profile.wallet, actor]));
  const timings = new Map();
  const failures = [];
  let actionCount = 0;
  let stopping = false;
  let interrupted = false;
  let fatalError = null;

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
    const duration = outcome.durationMs ?? 0;
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

  const failed = (actor, phase, error) => {
    const entry = { wallet: actor.profile.wallet, callSign: actor.profile.callSign,
      phase, error: error.message, durationMs: error.durationMs ?? null };
    failures.push(entry);
    console.error(`${actor.profile.wallet.padEnd(9)} ${actor.profile.callSign.padEnd(12)} ERROR ${phase}: ${error.message}`);
    record({ type: 'error', ...entry });
  };

  const invoke = async (actor, phase, command, payload) => {
    try {
      return observe(actor, phase, await actor.call(command, payload));
    } catch (error) {
      failed(actor, phase, error);
      throw error;
    }
  };

  const pairs = pvpPairs(profiles).map((pair) => ({ ...pair, stage: 'prepare', battleId: null, rounds: 0 }));
  const pairedWallets = new Set(pairs.flatMap((pair) => [pair.challenger.wallet, pair.accepter.wallet]));
  const routineActors = actors.filter((actor) => !pairedWallets.has(actor.profile.wallet));

  async function advancePair(pair, cycle) {
    const challenger = byWallet.get(pair.challenger.wallet);
    const accepter = byWallet.get(pair.accepter.wallet);
    if (pair.stage === 'prepare') {
      const prepared = await Promise.allSettled([
        invoke(challenger, `cycle.${cycle}.pvp.prepare`, 'preparePvp'),
        invoke(accepter, `cycle.${cycle}.pvp.prepare`, 'preparePvp'),
      ]);
      if (prepared.some((entry) => entry.status === 'rejected')) return;
      const [left, right] = prepared.map((entry) => entry.value);
      if (left.occupied || right.occupied) {
        await Promise.allSettled([
          invoke(challenger, `cycle.${cycle}.pvp.recover`, 'cleanup'),
          invoke(accepter, `cycle.${cycle}.pvp.recover`, 'cleanup'),
        ]);
        return;
      }
      if (!left.ready || !right.ready) return;
      const challenged = await invoke(
        challenger, `cycle.${cycle}.pvp.challenge`, 'challenge', accepter.burner.address,
      );
      pair.battleId = challenged.battleId;
      if (!pair.battleId) throw new Error(`${pair.name} challenge returned no battle id`);
      await invoke(accepter, `cycle.${cycle}.pvp.accept`, 'accept', pair.battleId);
      pair.stage = 'battle';
      pair.rounds = 0;
      return;
    }

    const moved = await Promise.allSettled([
      invoke(challenger, `cycle.${cycle}.pvp.round`, 'pvpMove', pair.battleId),
      invoke(accepter, `cycle.${cycle}.pvp.round`, 'pvpMove', pair.battleId),
    ]);
    pair.rounds++;
    const outcomes = moved.filter((entry) => entry.status === 'fulfilled').map((entry) => entry.value);
    const ended = outcomes.some((outcome) => outcome.action === 'pvp.ended'
      || outcome.state?.battle?.status === 'ended'
      || outcome.battle?.status === 'ended');
    if (ended) {
      record({ type: 'pvp.settled', pair: pair.name, battleId: pair.battleId, rounds: pair.rounds });
      pair.stage = 'prepare';
      pair.battleId = null;
      pair.rounds = 0;
    } else if (pair.rounds >= 55 || moved.every((entry) => entry.status === 'rejected')) {
      await Promise.allSettled([
        invoke(challenger, `cycle.${cycle}.pvp.abort`, 'cleanup'),
        invoke(accepter, `cycle.${cycle}.pvp.abort`, 'cleanup'),
      ]);
      pair.stage = 'prepare';
      pair.battleId = null;
      pair.rounds = 0;
    }
  }

  const startedAt = Date.now();
  // A timed soak measures actual play. First-time onboarding can take several
  // minutes for fifty wallets on a serial compute queue, so start the requested
  // duration only after every actor has successfully bootstrapped.
  let deadline = null;
  record({ type: 'run.start', runId, pid, node, seed, concurrency,
    cycles: runFor === null ? cycles : null, durationMs: runFor, wallets: manifestRows(profiles) });
  console.log(`Rune Realm swarm ${runId}`);
  console.log(`process     ${pid}`);
  console.log(`node        ${node}`);
  console.log(`actors      ${actors.length} (${pairs.length} fixed PvP pairs)`);
  console.log(`concurrency ${concurrency}`);
  console.log(`seed        ${seed}`);
  console.log(`events      ${eventsFile}\n`);

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

    if (runFor !== null) {
      deadline = Date.now() + runFor;
      record({ type: 'soak.start', durationMs: runFor, deadline: new Date(deadline).toISOString() });
      console.log(`\nSoak window started; running gameplay for ${Math.round(runFor / 60_000)} minute(s).`);
    }

    const cycleLimit = runFor === null ? cycles : Number.MAX_SAFE_INTEGER;
    for (let cycle = 1; !stopping && cycle <= cycleLimit
      && (deadline === null || Date.now() < deadline); cycle++) {
      console.log(`\n--- cycle ${cycle} ---`);
      await mapLimit(routineActors, concurrency, (actor) =>
        invoke(actor, `cycle.${cycle}`, 'tick'));
      if (pairs.length && !stopping) {
        await mapLimit(pairs, Math.max(1, Math.floor(concurrency / 2)), (pair) =>
          advancePair(pair, cycle));
      }
      if (!stopping && tickMs > 0 && cycle < cycleLimit
          && (deadline === null || Date.now() + tickMs < deadline)) {
        await new Promise((resolve) => setTimeout(resolve, tickMs));
      }
    }
  } catch (error) {
    fatalError = error;
    const entry = { wallet: null, callSign: null, phase: 'run',
      error: error.message, durationMs: null };
    failures.push(entry);
    console.error(`\nRUN ERROR: ${error.message}`);
    record({ type: 'error', ...entry });
  } finally {
    // Never leave a targeted challenge or live PvP fight blocking its partner.
    if (pairs.length) {
      console.log('\nCleaning up PvP sessions...');
      const pvpActors = actors.filter((actor) => pairedWallets.has(actor.profile.wallet));
      await mapLimit(pvpActors, concurrency, async (actor) => {
        try { await invoke(actor, 'cleanup', 'cleanup'); } catch { /* already logged */ }
      });
    }
    if (flag('cleanup-all')) {
      console.log('Cleaning up all arena sessions...');
      await mapLimit(actors, concurrency, async (actor) => {
        try { await invoke(actor, 'cleanup-all', 'cleanup'); } catch { /* already logged */ }
      });
    }
    await Promise.allSettled(actors.map((actor) => actor.terminate()));
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }

  const summary = {
    runId,
    pid,
    node,
    seed,
    walletCount: actors.length,
    actionCount,
    failureCount: failures.length,
    elapsedMs: Date.now() - startedAt,
    actions: Object.fromEntries([...timings].map(([action, values]) => [action, {
      count: values.length,
      p50Ms: quantile(values, 0.5),
      p90Ms: quantile(values, 0.9),
      maxMs: Math.max(...values),
    }])),
    failures,
  };
  const summaryFile = path.join(runDir, 'summary.json');
  fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2) + '\n');
  record({ type: 'run.end', ...summary });
  await new Promise((resolve) => stream.end(resolve));
  console.log(`\n${actionCount} actions, ${failures.length} errors, ${Math.round(summary.elapsedMs / 1000)}s`);
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
  console.error('usage: swarm.mjs [plan | wallets | run --live] [options]');
  process.exitCode = 1;
}
