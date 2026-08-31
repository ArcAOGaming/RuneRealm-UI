/**
 * What does one process-to-process hop actually cost?
 *
 * A process in AO cannot send anything by itself. A handler that wants to reach
 * another process writes the message into `results.outbox`, and it sits there
 * until something asks the node to push it. So a hop is: a slot on the sender,
 * a push, and a slot on the receiver. That is the cost that decides whether a
 * domain is worth splitting out of the monolith, and until now it was inferred
 * from the mechanism rather than measured.
 *
 * Two processes, one measurement each:
 *
 *   direct  schedule on the receiver, wait for the receiver's slot
 *   hop     schedule on the sender, push, wait for the receiver's slot
 *
 * Same receiver, same work, same client. The difference is the hop.
 *
 *   node measure-hop.mjs [node-url] [samples]
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { spawnProcess, sendMessage, pushSlot } from '../../hbclient.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..', '..');
const node = (process.argv[2] || 'http://localhost:8734').replace(/\/$/, '');
const samples = Number(process.argv[3] || 12);
const jwk = JSON.parse(fs.readFileSync(
  process.env.HB_WALLET || path.join(ROOT, 'arweave-wallet-DA9qhP25.json'), 'utf8'));

const RECEIVER = `
-- Counts what reaches it, so the client can tell a delivered hop from a
-- scheduled slot that merely happened.
Received = Received or 0
function compute(base, req, opts)
  base = base or {}
  Received = Received + 1
  base.received = string.format("%d", Received)
  base.results = { output = { data = string.format('{"received":%d}', Received) } }
  return base
end
`;

const sender = (receiverId) => `
-- Emits one outbox message per compute. Deliberately the smallest possible
-- payload: this measures the hop, not the message.
function compute(base, req, opts)
  base = base or {}
  base.results = {
    output = { data = '{"emitted":true}' },
    outbox = {
      hop = {
        target = "${receiverId}",
        action = "Hop.Land",
        data = "{}",
      },
    },
  }
  return base
end
`;

process.stdout.write('spawning receiver... ');
const receiver = await spawnProcess({ node, jwk, lua: RECEIVER, name: 'TEST-Rune Realm Hop Receiver' });
console.log(receiver);
process.stdout.write('spawning sender...   ');
const senderId = await spawnProcess({ node, jwk, lua: sender(receiver), name: 'TEST-Rune Realm Hop Sender' });
console.log(senderId);

/** Receiver's own count of messages it has computed. */
async function receivedCount() {
  const response = await fetch(`${node}/${receiver}~process@1.0/now/received`,
    { headers: { accept: 'text/plain' }, signal: AbortSignal.timeout(120000) });
  const body = (await response.text()).trim();
  if (!response.ok || /^<!doctype|^<html/i.test(body)) return null;
  return Number(JSON.parse(body).body ?? body);
}

async function waitForCount(target, deadlineMs = 60000) {
  const started = performance.now();
  while (performance.now() - started < deadlineMs) {
    const count = await receivedCount();
    if (count !== null && count >= target) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return false;
}

const direct = [];
const hop = [];

// Warm both paths: a cold process worker start-up would land entirely on
// whichever measurement runs first.
await sendMessage({ node, jwk, process: receiver, action: 'Hop.Land' });
await waitForCount((await receivedCount()) ?? 1);

for (let i = 0; i < samples; i += 1) {
  // Direct: the receiver is scheduled on and computes. No hop involved.
  let base = (await receivedCount()) ?? 0;
  let started = performance.now();
  await sendMessage({ node, jwk, process: receiver, action: 'Hop.Land' });
  if (!(await waitForCount(base + 1))) throw new Error('direct delivery timed out');
  direct.push(performance.now() - started);

  // Hop: the sender is scheduled on, emits to its outbox, the push delivers it.
  base = (await receivedCount()) ?? 0;
  started = performance.now();
  const { slot } = await sendMessage({ node, jwk, process: senderId, action: 'Hop.Go' });
  await pushSlot({ node, process: senderId, slot });
  if (!(await waitForCount(base + 1))) throw new Error('hop delivery timed out');
  hop.push(performance.now() - started);
}

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const p = (values, q) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.ceil(values.length * q) - 1)];

console.log(`\n${samples} samples, ${node}\n`);
console.log(`direct  schedule receiver -> receiver computed : p50 ${median(direct).toFixed(0)} ms  p95 ${p(direct, 0.95).toFixed(0)} ms`);
console.log(`hop     schedule sender -> push -> receiver    : p50 ${median(hop).toFixed(0)} ms  p95 ${p(hop, 0.95).toFixed(0)} ms`);
console.log(`\none hop costs ${(median(hop) - median(direct)).toFixed(0)} ms on top of the message that caused it`);
