/** Inspect and optionally retry overdue battle-fleet recovery operations. */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { sendMessage } from './hbclient.mjs';
import {
  planFinalFleetRecovery, planLiveFleetRecovery,
} from './battle-fleet-recovery.mjs';

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
for (const job of jobs) {
  const target = job.target === 'game' ? game : job.target;
  const { slot } = await sendMessage({
    node, jwk, process: target, action: job.action, tags: job.tags,
  });
  const pushed = await fetch(`${node}/${target}~process@1.0/push&slot=${slot}`);
  if (!pushed.ok) throw new Error(`${job.action} slot ${slot} push failed: ${pushed.status}`);
  console.log(`${job.action} ${job.reservationId}: ${target} slot ${slot} pushed`);
}
