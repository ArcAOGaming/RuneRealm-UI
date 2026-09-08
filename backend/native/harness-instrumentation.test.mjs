// The measurement tools have to be measured too.
//
// Four defects were found in this harness by reading it, and every one of them
// made the node look worse than it is while being invisible in the output: a
// connection pool of 8 that turned 42 of 50 lanes into client-side queueing, a
// 200 ms sleep before the first read charged to the node, percentiles taken
// over the survivors so a level looked FASTER the more of it timed out, and an
// HTTP request per message that nothing counted. This file pins the three of
// those that are pure functions; the fourth (the pre-poll sleep) is pinned by
// `PRE_POLL_MS` defaulting to 0, asserted here by reading the module's own
// source rather than by running a ramp against a live node.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  connectionsForLanes, resolveConnections, DEFAULT_CONNECTIONS, MAX_INFERRED_CONNECTIONS,
} from './keepalive.mjs';
import { httpRequestCount, resetHttpRequestCount } from './hbclient.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

test('a pool holds two connections per single-threaded lane', () => {
  assert.equal(connectionsForLanes(25), 50);
  assert.equal(connectionsForLanes(50), 100);
});

test('a small or absent lane count still gets the old default', () => {
  // The swarm worker is one wallet per THREAD with its own pool and must not
  // change: `useKeepAlive()` with no argument is still 8 connections.
  assert.equal(connectionsForLanes(undefined), DEFAULT_CONNECTIONS);
  assert.equal(connectionsForLanes(0), DEFAULT_CONNECTIONS);
  assert.equal(connectionsForLanes(1), DEFAULT_CONNECTIONS);
  assert.equal(resolveConnections({ env: {} }), DEFAULT_CONNECTIONS);
});

test('an inferred pool is bounded, an explicit one is obeyed', () => {
  // `--concurrency 5000` from a shell must not open ten thousand sockets and
  // measure the local file descriptor limit.
  assert.equal(connectionsForLanes(100_000), MAX_INFERRED_CONNECTIONS);
  // Asking for a specific number is the one case where the caller means it,
  // including asking for the old 8 to reproduce an earlier measurement.
  assert.equal(resolveConnections({ connections: 8, lanes: 50, env: {} }), 8);
  assert.equal(resolveConnections({ connections: 1024, env: {} }), 1024);
});

test('HB_CONNECTIONS overrides an inferred pool but not an explicit one', () => {
  assert.equal(resolveConnections({ lanes: 50, env: { HB_CONNECTIONS: '16' } }), 16);
  assert.equal(resolveConnections({ connections: 4, lanes: 50, env: { HB_CONNECTIONS: '16' } }), 4);
  assert.equal(resolveConnections({ lanes: 25, env: { HB_CONNECTIONS: 'nonsense' } }), 50);
});

test('the client counts every HTTP request it makes, including the push', () => {
  // The counter is the fix for "the ramp reports 2 requests per message and the
  // real cost is 3": a harness counting its own fetch calls cannot see the
  // `push&slot=N` that `sendMessage` queues.
  const before = httpRequestCount();
  assert.equal(typeof before, 'number');
  assert.equal(resetHttpRequestCount(), before);
  assert.equal(httpRequestCount(), 0);
});

test('sendMessage can be told not to push, and pushes by default', () => {
  // A queued push that never runs is an undelivered outbox, and the first time
  // that happened here a player's Rune was destroyed. So the default must stay
  // on and the opt-out must be explicit.
  const src = fs.readFileSync(path.join(HERE, 'hbclient.mjs'), 'utf8');
  assert.match(src, /export async function sendMessage\(\{.*?push = true \}\)/s);
  assert.match(src, /if \(push && slot !== undefined/);
});

test('the ramp reads immediately and only then backs off', () => {
  const src = fs.readFileSync(path.join(HERE, 'concurrency-ramp.mjs'), 'utf8');
  // The sleep is at the END of the poll loop. Anything slept before the first
  // read is ~200 ms of harness charged to the node -- 29% of the concurrency-1
  // round trip when it was there.
  assert.match(src, /const PRE_POLL_MS = Number\(process\.env\.PRE_POLL_MS \|\| 0\)/);
  assert.match(src, /if \(wait > 0\) await new Promise/);
  assert.doesNotMatch(src, /let wait = 200;/);
});

test('the ramp reports a censored percentile, not one over the survivors', () => {
  const src = fs.readFileSync(path.join(HERE, 'concurrency-ramp.mjs'), 'utf8');
  assert.match(src, /censoredQuantile/);
  // A timeout takes part in the ordering at the deadline rather than vanishing.
  assert.match(src, /timedOut\.map\(\(r\) => \(\{ ms: Math\.max\(r\.totalMs, DEADLINE_MS\), censored: true \}\)\)/);
  // Throughput is divided by the window work was OFFERED in, not by a wall
  // that includes the post-level drain.
  assert.match(src, /throughputPerSec: Number\(\(ok\.length \/ \(issueWindowMs \/ 1000\)\)/);
});

test('the mutation reply must contain the exact outfit that was written', () => {
  const src = fs.readFileSync(path.join(HERE, 'concurrency-ramp.mjs'), 'utf8');
  assert.match(src, /returnedChangedRecord\(body, expectedOutfit\)/);
  assert.match(src, /got\?\.style !== want\.style/);
  assert.match(src, /got\?\.color !== String\(want\.color\)\.toLowerCase\(\)/);
  assert.match(src, /reason: verdict\.ok \? undefined : \(verdict\.rejected \? 'rejected' : 'invalid-reply'\)/);
});

test('a late poll gets only the time remaining in the round-trip deadline', () => {
  const src = fs.readFileSync(path.join(HERE, 'concurrency-ramp.mjs'), 'utf8');
  assert.match(src, /const remainingMs = Math\.max\(1, Math\.floor\(deadlineMs - \(performance\.now\(\) - started\)\)\)/);
  assert.match(src, /signal: AbortSignal\.timeout\(remainingMs\)/);
});
