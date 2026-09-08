/** Inspect and optionally retry overdue battle-fleet recovery operations. */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { sendMessage } from './hbclient.mjs';
import {
  planFinalFleetRecovery, planLiveFleetRecovery,
} from './battle-fleet-recovery.mjs';
import { driveHandshake, firePush } from './battle-fleet/handshake.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const node = (process.env.NODE_URL || 'https://schedule.forward.computer').replace(/\/$/, '');
const game = process.env.BATTLE_GAME_PROCESS || '';
const apply = process.argv.includes('--apply');
if (!/^[A-Za-z0-9_-]{43}$/.test(game)) throw new Error('Set BATTLE_GAME_PROCESS.');
const response = await fetch(`${node}/${game}~process@1.0/now/battlefleetops`);
if (!response.ok) throw new Error(`battlefleetops read failed: ${response.status}`);
const operations = JSON.parse(await response.text());
const now = Date.now();

async function readWorkerBattle(row) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(row.workerProcessId || '')
      || !/^[A-Za-z0-9_-]+$/.test(row.battleId || '')) {
    return { state: 'unavailable', detail: 'invalid authority route' };
  }
  try {
    const read = await fetch(
      `${node}/${row.workerProcessId}~process@1.0/now/battle-${row.battleId}`,
      { headers: { accept: 'application/json, text/plain' } },
    );
    const body = (await read.text()).trim();
    if (!read.ok || !body || /^<!doctype|^<html/i.test(body) || body === 'null') {
      // A clean 404/null is an absent Open outcome. Other HTTP failures are
      // treated as unavailable so an ended settlement is never raced by an
      // unsafe expiry merely because a cache read was transiently unhealthy.
      return read.status === 404 || body === 'null'
        ? { state: 'absent', battle: null }
        : { state: 'unavailable', detail: `${read.status} ${body.slice(0, 120)}` };
    }
    const battle = JSON.parse(body);
    if (battle?.protocol !== operations.protocol || battle?.id !== row.battleId
        || battle?.workerId !== row.workerId) {
      return { state: 'unavailable', detail: 'worker battle identity mismatch' };
    }
    return { state: 'found', battle };
  } catch (error) {
    return { state: 'unavailable', detail: error.message };
  }
}

const liveReads = await Promise.all((operations.live || []).map(async (row) => ({
  row, read: await readWorkerBattle(row),
})));
const jobs = [];
const deferred = [];
for (const { row, read } of liveReads) {
  // Retry Open and an already-pending cancellation are idempotent without a
  // worker read. Expiring an open reservation is deferred if that read failed:
  // it may really be an ended battle with a lost settlement delivery.
  if (read.state === 'unavailable' && row.status !== 'reserved'
      && row.status !== 'cancel-pending') {
    deferred.push({ reservationId: row.reservationId, reason: read.detail });
    continue;
  }
  const job = planLiveFleetRecovery(row, read.battle, now);
  if (job) jobs.push(job);
}
for (const row of operations.finals || []) {
  const job = planFinalFleetRecovery(row, now, Number(operations.replayWindow || 0));
  if (job) jobs.push(job);
}
console.log(JSON.stringify({ game, now, apply, jobs, deferred }, null, 2));
if (!apply || jobs.length === 0) process.exit(0);
if (!/^(1|true|yes)$/i.test(process.env.BATTLE_FLEET_ENABLED || '')) {
  throw new Error('Set BATTLE_FLEET_ENABLED=1 with --apply.');
}
const walletPath = process.env.HB_WALLET || path.join(ROOT, 'arweave-wallet-DA9qhP25.json');
const jwk = JSON.parse(fs.readFileSync(walletPath, 'utf8'));

/*
  The push is fired and NOT awaited, and its HTTP status is not the verdict.

  Measured on production 2026-09-08 (`hyperbeam.tylerw.ai`, BOX B): a
  `push&slot=N` whose slot has a NON-EMPTY outbox never answers — 300 s, 200 s,
  180 s and 120 s with no response, four different slots on two processes —
  while the same request on a slot with an empty outbox returns 200 in 0.39 s.
  The delivery itself lands within seconds; it is `dev_push`'s recursive
  `push_downstream_remote` re-entering this node for the next hop that does not
  come back. `await fetch(push)` here therefore hung this sweep on its FIRST job
  and it never reached the second — which is why an operator run could not
  repair the stall it was written to repair.

  So: fire, then read published state. `driveHandshake` below does the reading.
*/
const fired = [];
for (const job of jobs) {
  const target = job.target === 'game' ? game : job.target;
  const { slot } = await sendMessage({
    node, jwk, process: target, action: job.action, tags: job.tags, push: false,
  });
  firePush({ node, process: target, slot });
  fired.push({ action: job.action, reservationId: job.reservationId, target, slot });
  console.log(`${job.action} ${job.reservationId}: ${target} slot ${slot} pushed (not awaited)`);
}

/*
  Now close the chain. Hops 3 and 4 (`Battle.Fleet.FinalAcked` and
  `Fleet.FinalAcked.Release`) are produced by slots the retries above created,
  and nothing else in the deployment pushes them: the cascade that was supposed
  to carry them dies with the response. `driveHandshake` pushes each producing
  slot and takes its verdict from `battlefleetops` and `fleetstatus`.

  `Admin.RetryFleetAck` is not replayed here — the loop above already sent one
  per stuck final — so `retryAck` is null and the driver only pushes what is
  already sitting in an outbox.
*/
const workerProcessIds = [...new Set([
  ...(operations.finals || []).map((f) => f.workerProcessId),
  ...(operations.live || []).map((f) => f.workerProcessId),
].filter((id) => /^[A-Za-z0-9_-]{43}$/.test(id || '')))];

const closed = await driveHandshake({
  node, game, workerProcessIds, retryAck: null, log: (line) => console.log(line),
});
console.log(JSON.stringify({ fired, handshake: closed }, null, 2));
if (!closed.done) {
  throw new Error(`${closed.finals.length} final(s) still unconfirmed and `
    + `${closed.holding.length} worker(s) still holding after ${closed.ms} ms. `
    + 'Re-run; a busy authority takes several passes.');
}
