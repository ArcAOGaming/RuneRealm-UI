// The push queue's ordering guarantee, asserted rather than assumed.
//
// A process cannot send anything by itself: a slot's outbox sits undelivered
// until somebody asks the node to push it. `sendMessage` therefore fires a push
// for every accepted write. Those pushes used to race, and a `push&slot=N` for
// a slot above the computed head makes the node REPLAY every intermediate slot
// to reach it -- `dev_process:compute_to_slot/5` recurses over them with no
// per-slot cache read. Measured on the live node before this change: all 75
// racing pushes targeted a slot above the head, each replayed 20.1 slots, and
// the first 400 slots of a fresh process cost 6.38 executions each against 1.00
// in steady state.
//
// So the two properties that matter are ORDER (per process, so each push asks
// for head+1) and DRAIN (a queued push that never runs is an undelivered
// outbox, which is how a withdrawal once destroyed a player's Rune).

import test from 'node:test';
import assert from 'node:assert/strict';
import { queuePush, pendingPushes } from './hbclient.mjs';

const NODE = 'https://node.invalid';

/** `<node>/<pid>~process@1.0/push&slot=<n>` -- all path, no query string. */
function parsePush(url) {
  const m = String(url).match(/\/([A-Za-z0-9_-]{43})~process@1\.0\/push&slot=(\d+)$/);
  if (!m) throw new Error(`unexpected push url: ${url}`);
  return { pid: m[1], slot: Number(m[2]) };
}

/** Let the queue's leading microtask run, so the first push is in flight. */
const tick = () => new Promise((r) => setImmediate(r));

/** Record every push the queue issues, and control when each one finishes. */
function stubFetch({ delayFor = () => 0 } = {}) {
  const started = [];
  const finished = [];
  globalThis.fetch = async (url) => {
    // `push&slot=N` is an AO path SEGMENT, not a query string -- there is no
    // `?`, so `URL.search` is empty and the slot has to come out of the path.
    const { pid, slot } = parsePush(url);
    started.push({ pid, slot });
    await new Promise((r) => setTimeout(r, delayFor(slot)));
    finished.push({ pid, slot });
    return new Response(new ArrayBuffer(0), { status: 200 });
  };
  return { started, finished };
}

test('pushes for one process run in the order their slots were accepted', async () => {
  // The first push is the slowest. Unserialised, slot 3 would finish first and
  // slot 1 would still be in flight -- which is exactly the shape that made the
  // node replay the gap.
  const { started, finished } = stubFetch({ delayFor: (slot) => (slot === 1 ? 40 : 1) });
  const pid = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

  queuePush({ node: NODE, process: pid, slot: 1 });
  queuePush({ node: NODE, process: pid, slot: 2 });
  queuePush({ node: NODE, process: pid, slot: 3 });

  // Nothing beyond the first has even been issued yet: that is the point.
  await tick();
  assert.deepEqual(started.map((s) => s.slot), [1]);

  await pendingPushes({ node: NODE, process: pid });
  assert.deepEqual(finished.map((s) => s.slot), [1, 2, 3]);
});

test('a different process is not held behind another process queue', async () => {
  // Serialising ACROSS processes would only make a deploy slower: two processes
  // have separate heads and separate workers, and neither can make the other
  // replay.
  const { started } = stubFetch({ delayFor: (slot) => (slot === 1 ? 40 : 1) });
  const slow = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
  const other = 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC';

  queuePush({ node: NODE, process: slow, slot: 1 });
  queuePush({ node: NODE, process: slow, slot: 2 });
  queuePush({ node: NODE, process: other, slot: 1 });

  await new Promise((r) => setTimeout(r, 5));
  const pids = started.map((s) => s.pid);
  assert.ok(pids.includes(other), 'the second process should not wait for the first');
  assert.equal(started.filter((s) => s.pid === slow).length, 1);

  await pendingPushes();
});

test('a failing push does not stop the ones behind it, and never rejects', async () => {
  // `pushSlot` is best-effort by contract -- the caller's own message is already
  // accepted. What must not happen is one failed delivery taking the rest of a
  // seeding run with it, or surfacing as an unhandled rejection.
  const seen = [];
  globalThis.fetch = async (url) => {
    const { slot } = parsePush(url);
    seen.push(slot);
    if (slot === 1) throw new Error('connection reset');
    return new Response(new ArrayBuffer(0), { status: 200 });
  };
  const pid = 'DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD';

  queuePush({ node: NODE, process: pid, slot: 1 });
  queuePush({ node: NODE, process: pid, slot: 2 });

  await pendingPushes({ node: NODE, process: pid });
  assert.deepEqual(seen, [1, 2]);
});

test('draining with no arguments waits for every process', async () => {
  const { finished } = stubFetch({ delayFor: () => 5 });
  queuePush({ node: NODE, process: 'EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE', slot: 7 });
  queuePush({ node: NODE, process: 'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF', slot: 9 });

  await pendingPushes();
  assert.equal(finished.length, 2);
});
