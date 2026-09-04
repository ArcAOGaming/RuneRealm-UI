/**
 * concurrency.mjs -- is the wait compute, or is it queueing?
 *
 *   node concurrency.mjs <process-id> [--node http://localhost:8734]
 *
 * A process computes its slots one at a time, in order. So the latency ONE
 * player sees is not the cost of their message -- it is the cost of every
 * message queued in front of it. That distinction is invisible to a probe that
 * sends one action at a time, which is how every other instrument here works,
 * and it is the difference between "the contract is slow" and "the contract is
 * fine and the process is saturated".
 *
 * It matters because the numbers stopped adding up. A faithful local
 * reproduction of the live process -- 49 players, 5,000 mixed actions -- answers
 * a read in 412 ms, and the live process with 51 players answers in 19,022 ms.
 * The contract cannot explain a 46x gap. Offered load can: `OVERNIGHT.md`'s run
 * had 50 bots on one process, and its latency climbed 7.6 s -> 18.5 s across the
 * run, which is the shape of a queue growing rather than a handler slowing down.
 *
 * So: drive C players at once, all doing the same cheap read, and watch what one
 * player's wait does as C rises. Flat means there is headroom. Linear in C means
 * the process is saturated and the wait is other people's messages -- in which
 * case no amount of shrinking the handler helps until throughput does.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { sendMessage, postSigned } from '../../hbclient.mjs';
import { listBurners } from '../../burners.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..', '..');

const opt = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
};
const NODE = (opt('--node', process.env.NODE_URL || 'http://localhost:8734')).replace(/\/$/, '');
const pid = process.argv[2];
if (!pid) throw new Error('usage: node concurrency.mjs <process-id>');

const jwk = JSON.parse(fs.readFileSync(
  process.env.HB_WALLET || path.join(ROOT, 'arweave-wallet-DA9qhP25.json'), 'utf8'));
const burners = listBurners();

/** Schedule WITHOUT the best-effort push `sendMessage` fires for every message.
 *
 * That push asks the node to compute and deliver the slot, and the client's own
 * `compute` request asks for the same slot a moment later. Both start a walk,
 * and the node was measured recomputing each slot 2.79 times. Since throughput
 * is 1/(slot cost x times each slot is computed), that is most of the capacity.
 * `--no-push` exists to find out how much of it comes back. */
async function scheduleOnly(signer) {
  const res = await postSigned(NODE, `/${pid}~process@1.0/schedule`, {
    target: pid,
    type: 'Message',
    subject: 'self',
    action: 'User.Info',
    'random-seed': String(Math.floor(Math.random() * 1e9)),
  }, signer);
  if (res.status !== 200) throw new Error(`schedule returned ${res.status}`);
  return res.headers.slot;
}

const NO_PUSH = process.argv.includes('--no-push');

/** One player's whole round trip: sign, schedule, wait for the answer. */
async function oneAction(signer) {
  const t0 = Date.now();
  const { slot } = NO_PUSH
    ? { slot: await scheduleOnly(signer) }
    : await sendMessage({ node: NODE, jwk: signer, process: pid, action: 'User.Info' });
  for (const suffix of ['results/output/data', 'results/data']) {
    try {
      const r = await fetch(`${NODE}/${pid}~process@1.0/compute&slot=${Number(slot)}/${suffix}`,
        { headers: { accept: 'application/json, text/plain' }, signal: AbortSignal.timeout(900000) });
      const body = await r.text();
      if (r.ok && !/^<!doctype|^<html/i.test(body.trim())) return Date.now() - t0;
    } catch { /* try the other shape, then give up below */ }
  }
  return Date.now() - t0;
}

const median = (values) => {
  const o = [...values].sort((a, b) => a - b);
  return o[Math.floor(o.length / 2)];
};

console.log(`node ${NODE}\nprocess ${pid}\n`);
console.log(`${'in flight'.padStart(10)} ${'p50'.padStart(9)} ${'p90'.padStart(9)} `
  + `${'max'.padStart(9)} ${'actions/s'.padStart(10)}`);

for (const concurrency of [1, 2, 5, 10, 25, 49]) {
  const players = burners.slice(1, 1 + concurrency);
  if (players.length < concurrency) break;
  const t0 = Date.now();
  // Every player acts at the same instant, which is what a bot fleet does and
  // what a one-at-a-time probe can never show.
  const waits = await Promise.all(players.map((p) => oneAction(p.jwk)));
  const elapsed = (Date.now() - t0) / 1000;
  const ordered = [...waits].sort((a, b) => a - b);
  console.log(`${String(concurrency).padStart(10)} `
    + `${`${median(waits)}ms`.padStart(9)} `
    + `${`${ordered[Math.floor(0.9 * ordered.length)]}ms`.padStart(9)} `
    + `${`${ordered[ordered.length - 1]}ms`.padStart(9)} `
    + `${(concurrency / elapsed).toFixed(1).padStart(10)}`);
}

console.log('\nFlat p50 means headroom. p50 rising with the number in flight means'
  + '\nthe process is saturated and the wait is the queue, not the handler.');
