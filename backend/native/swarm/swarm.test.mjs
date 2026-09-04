import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildSwarmClient } from './build-client.mjs';
import { Actor } from './actor.mjs';
import { failureEventFields, structuredErrorFields } from './error-fields.mjs';
import {
  createGatedDispatcher, createTokenBucket, resolveLoadPolicy, responseOutcomeCounts,
  inspectTerminations, settledRejections, settledValuesOrThrow,
} from './load-control.mjs';
import {
  FACTIONS, PROFILES, ROLE_DEFINITIONS, ROUTINE_ACTIONS, profileFor, pvpPairs,
} from './profiles.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');

assert.equal(PROFILES.length, 50, 'there must be exactly fifty stable profiles');
assert.equal(new Set(PROFILES.map((profile) => profile.wallet)).size, 50, 'wallet names must be unique');
assert.equal(new Set(PROFILES.map((profile) => profile.callSign)).size, 50, 'call signs must be unique');
assert.deepEqual(PROFILES.map((profile) => profile.wallet),
  Array.from({ length: 50 }, (_, index) => `burner-${String(index + 1).padStart(2, '0')}`));

for (const profile of PROFILES) {
  assert.ok(ROLE_DEFINITIONS[profile.role], `${profile.wallet} has a known role`);
  assert.ok(FACTIONS.includes(profile.faction), `${profile.wallet} has a real faction`);
  assert.ok(profile.description.length >= 30, `${profile.wallet} has a useful description`);
  assert.equal(Object.values(profile.statPlan).reduce((sum, value) => sum + value, 0), 10,
    `${profile.wallet} allocates exactly ten level-up points`);
  assert.ok(Object.values(profile.statPlan).every((value) => value >= 0 && value <= 5),
    `${profile.wallet} respects the per-stat allocation limit`);
  assert.equal(profileFor(profile.wallet), profile);
}

for (const [role, definition] of Object.entries(ROLE_DEFINITIONS)) {
  assert.deepEqual(Object.keys(definition.weights).sort(), [...ROUTINE_ACTIONS].sort(),
    `${role} explicitly configures every routine fleet action`);
}
for (const action of ROUTINE_ACTIONS) {
  assert.ok(Object.values(ROLE_DEFINITIONS).some((role) => role.weights[action] > 0),
    `${action} is enabled for at least one fleet role`);
}

const pairs = pvpPairs();
assert.equal(pairs.length, 5, 'ten duelists should form five pairs');
for (const pair of pairs) {
  assert.ok(pair.challenger, `${pair.name} has a challenger`);
  assert.ok(pair.accepter, `${pair.name} has an accepter`);
  assert.notEqual(pair.challenger.wallet, pair.accepter.wallet);
  assert.equal(pair.challenger.role, 'duelist');
  assert.equal(pair.accepter.role, 'duelist');
}

assert.equal(pvpPairs(PROFILES.slice(0, 26)).length, 0,
  'a limit that selects only half a pair must not create an invalid pair');

/*
 * The seeder must swear each wallet to the faction its profile names.
 *
 * `seed-monsters.mjs` used to draw the faction at random, which put 32 of the
 * 50 wallets somewhere other than their plan. Swearing is irreversible — the
 * process answers `You have already sworn to X` — so that could only be undone
 * by redeploying, and it breaks two things at once: `bootstrap` treats a
 * faction that disagrees with the plan as fatal and refuses to start the run,
 * and the five PvP pairs stop being the element matchups they were built as.
 *
 * Asserting the seeder against the profiles here is cheap and catches the
 * disagreement before it is signed rather than after.
 */
for (const profile of PROFILES) {
  assert.equal(profileFor(profile.wallet)?.faction, profile.faction,
    `${profile.wallet} resolves to its planned faction`);
}
const seedSource = fs.readFileSync(
  path.join(ROOT, 'backend', 'native', 'seed-monsters.mjs'), 'utf8');
assert.ok(/profileFor\(/.test(seedSource),
  'seed-monsters.mjs must take each wallet\'s faction from profiles.mjs, not from the dice');

/*
 * And it must look before it leaps, then check what it did.
 *
 * Swearing cannot be undone, so the seeder reads the process first and refuses
 * to commit an oath that disagrees with the plan. It also reads every account
 * back at the end, because `sendMessage` returns the slot a message landed in
 * and nothing about what the handler decided — the run that mis-swore 32
 * wallets reported "50 pledged, 50 adopted" and was wrong about every one.
 *
 * These are shallow checks on purpose: a real one would need a live process.
 * They exist so that removing the guards is a visible act rather than a quiet
 * one, on the single step in this whole harness that cannot be retried.
 */
assert.ok(/reading the process before writing to it/.test(seedSource),
  'seed-monsters.mjs must read the live population before swearing anything');
assert.ok(/ALREADY SWORN/.test(seedSource),
  'seed-monsters.mjs must refuse to seed a wallet already sworn to another faction');
assert.ok(/verifying\.\.\./.test(seedSource),
  'seed-monsters.mjs must verify the population it produced');
assert.ok(/scheduled/.test(seedSource),
  'seed-monsters.mjs must report scheduled messages as scheduled, not as successes');

const built = await buildSwarmClient({
  root: ROOT,
  pid: 'A'.repeat(43),
  node: 'https://example.invalid',
  outDir: path.join(ROOT, '.swarm', 'test-generated'),
});
const api = await import(pathToFileURL(built.file).href + `?test=${Date.now()}`);
for (const verb of ['login', 'joinFaction', 'adopt', 'feed', 'startPlay', 'startQuest', 'claim',
  'openLootbox', 'claimDaily', 'levelUp', 'spriteUpdate', 'storeMonster', 'retrieveMonster',
  'setActiveMonster', 'transferMonster', 'listMonster', 'cancelListing', 'buyListing',
  'readEconomy', 'placeGoldOrder', 'cancelGoldOrder', 'tradeGameShop',
  'beginHunt', 'readHunt', 'huntSearch', 'huntAttack', 'huntDeclineCapture', 'huntCapture',
  'huntRetrySettlement', 'huntEnd', 'enterArena', 'leaveArena', 'startBotBattle', 'challenge',
  'acceptChallenge', 'attack', 'battleInfo']) {
  assert.equal(typeof api[verb], 'function', `the bundled client exports ${verb}`);
}

const originalFetch = globalThis.fetch;
const originalSetTimeout = globalThis.setTimeout;
const originalWallet = globalThis.arweaveWallet;
try {
  /*
   * The happy path is ONE request: the compute pull is both the request for
   * computation and the read of its reply. `at-slot` is a recovery-only signal
   * and must never be probed first — on an idle process it is stale by
   * construction, and on a stock node it makes `now` compute, doubling the work
   * of every write. The `setTimeout` trap below also proves the completed slot
   * returns without ever waiting for a future player action.
   */
  const reads = [];
  globalThis.fetch = async (url) => {
    reads.push(String(url));
    if (String(url).endsWith('/now/at-slot')) {
      throw new Error('the happy path must not probe the cached head before pulling its slot');
    }
    if (String(url).includes('/compute&slot=7/')) {
      return new Response(JSON.stringify({ ok: true, slot: 7 }));
    }
    throw new Error(`unexpected idle-slot request: ${url}`);
  };
  globalThis.setTimeout = () => {
    throw new Error('readSlot waited for a later slot after its own slot completed');
  };
  assert.deepEqual(
    await api.rawReadSlot(7, {
      process: 'P'.repeat(43), node: 'https://node.test', attempts: 2, delayMs: 10_000,
    }),
    { ok: true, slot: 7 },
  );
  assert.equal(reads.length, 1, 'a completed slot needs one compute read');
  assert.match(reads[0], /\/compute&slot=7\/results\/output\/data$/,
    'the single happy-path request is the slot\'s own compute pull');

  globalThis.setTimeout = originalSetTimeout;

  let computeRequests = 0;
  let headPolls = 0;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.endsWith('/now/at-slot')) {
      headPolls += 1;
      return new Response('6');
    }
    if (target.includes('/compute&slot=7/')) {
      computeRequests += 1;
      return new Response(JSON.stringify({ ok: true, slot: 7 }));
    }
    throw new Error(`unexpected pending-slot request: ${target}`);
  };
  assert.deepEqual(
    await api.rawReadSlot(7, {
      process: 'P'.repeat(43), node: 'https://node.test', attempts: 4, delayMs: 0,
    }),
    { ok: true, slot: 7 },
  );
  assert.equal(headPolls, 0, 'a pending slot is never probed first');
  assert.equal(computeRequests, 1, 'a pending slot is pulled immediately exactly once');

  computeRequests = 0;
  headPolls = 0;
  let advanced = false;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.endsWith('/now/at-slot')) {
      headPolls += 1;
      if (headPolls >= 3) advanced = true;
      return new Response(advanced ? '7' : '6');
    }
    if (target.includes('/compute&slot=7/')) {
      computeRequests += 1;
      if (!advanced) return new Response('connection lost', { status: 503 });
      return new Response(JSON.stringify({ ok: true, recovered: true }));
    }
    throw new Error(`unexpected recovery request: ${target}`);
  };
  assert.deepEqual(
    await api.rawReadSlot(7, {
      process: 'P'.repeat(43), node: 'https://node.test', attempts: 4, delayMs: 0,
    }),
    { ok: true, recovered: true },
  );
  assert.equal(computeRequests, 2,
    'a lost pull response is followed by one cached result read after completion');
  assert.equal(headPolls, 3, 'recovery polls the cached head until the slot completes');

  computeRequests = 0;
  headPolls = 0;
  let injectedBusyPulls = 0;
  let injectedUnparsableHeads = 0;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.endsWith('/now/at-slot')) {
      headPolls += 1;
      if (headPolls === 1) return new Response('6');
      injectedUnparsableHeads += 1;
      return new Response('not-a-slot');
    }
    if (target.includes('/compute&slot=7/')) {
      computeRequests += 1;
      injectedBusyPulls += 1;
      return new Response('busy', { status: 503 });
    }
    throw new Error(`unexpected exhausted-recovery request: ${target}`);
  };
  await assert.rejects(
    api.rawReadSlot(7, {
      process: 'P'.repeat(43), node: 'https://node.test', attempts: 3, delayMs: 0,
    }),
    /one compute request/,
  );
  assert.equal(injectedBusyPulls, 1,
    'the 503 on the compute pull must actually be served, or this tests nothing');
  assert.equal(injectedUnparsableHeads, 2,
    'the unparsable cached head must actually be served on every poll after the first');
  assert.equal(computeRequests, 1, 'recovery never repeats an uncomputed-slot request');
  assert.equal(headPolls, 3, 'recovery polling remains bounded');

  const preReadAbort = new AbortController();
  const preReadReason = new Error('cancel read before it starts');
  preReadAbort.abort(preReadReason);
  let cancelledReadFetches = 0;
  globalThis.fetch = async () => {
    cancelledReadFetches += 1;
    throw new Error('an already-cancelled read must not fetch');
  };
  await assert.rejects(
    api.rawReadSlot(7, {
      process: 'P'.repeat(43), node: 'https://node.test', signal: preReadAbort.signal,
    }),
    (error) => error === preReadReason,
  );
  assert.equal(cancelledReadFetches, 0, 'a custom pre-abort reason stops before the first read');

  const delayedReadAbort = new AbortController();
  const delayedReadReason = new DOMException('read recovery timed out', 'TimeoutError');
  headPolls = 0;
  let cancelledBusyPulls = 0;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.endsWith('/now/at-slot')) {
      headPolls += 1;
      return new Response('6');
    }
    if (target.includes('/compute&slot=7/')) {
      cancelledBusyPulls += 1;
      return new Response('busy', { status: 503 });
    }
    throw new Error(`unexpected cancelled-recovery request: ${target}`);
  };
  const cancelledRecovery = api.rawReadSlot(7, {
    process: 'P'.repeat(43), node: 'https://node.test', attempts: 4, delayMs: 10_000,
    signal: delayedReadAbort.signal,
  });
  originalSetTimeout(() => delayedReadAbort.abort(delayedReadReason), 10);
  await assert.rejects(cancelledRecovery, (error) => error === delayedReadReason);
  assert.equal(cancelledBusyPulls, 1,
    'the failed compute pull that puts this read into recovery must actually be served');
  assert.equal(headPolls, 1, 'cancellation interrupts recovery before another cached poll');

  const signedItems = [];
  globalThis.arweaveWallet = {
    async signDataItem(item) {
      signedItems.push(item);
      return Uint8Array.of(1, 2, 3).buffer;
    },
  };

  let scheduleCalls = 0;
  globalThis.fetch = async () => {
    scheduleCalls += 1;
    return new Response('maybe accepted', { status: 500 });
  };
  await assert.rejects(
    api.rawSendMessage({ process: 'P'.repeat(43), tags: [{ name: 'Action', value: 'User.Login' }] }),
    (error) => error.name === 'AmbiguousWriteError'
      && error.scheduledUnknown === true
      && /do not retry/i.test(error.message),
  );
  assert.equal(scheduleCalls, 1, 'a 5xx schedule response must never replay the signed item');

  scheduleCalls = 0;
  globalThis.fetch = async () => {
    scheduleCalls += 1;
    throw new TypeError('socket reset');
  };
  await assert.rejects(
    api.rawSendMessage({ process: 'P'.repeat(43), tags: [{ name: 'Action', value: 'User.Login' }] }),
    (error) => error.name === 'AmbiguousWriteError' && error.scheduledUnknown === true,
  );
  assert.equal(scheduleCalls, 1, 'an ambiguous network failure must not fall through to another node');

  scheduleCalls = 0;
  globalThis.fetch = async () => {
    scheduleCalls += 1;
    throw new DOMException('aborted after request started', 'AbortError');
  };
  await assert.rejects(
    api.rawSendMessage({ process: 'P'.repeat(43), tags: [], signal: new AbortController().signal }),
    (error) => error.name === 'AmbiguousWriteError' && error.scheduledUnknown === true,
  );
  assert.equal(scheduleCalls, 1, 'an abort after POST begins is an ambiguous write and is not replayed');

  scheduleCalls = 0;
  const preAborted = new AbortController();
  preAborted.abort();
  await assert.rejects(
    api.rawSendMessage({ process: 'P'.repeat(43), tags: [], signal: preAborted.signal }),
    (error) => error.name === 'AbortError',
  );
  assert.equal(scheduleCalls, 0, 'a signal aborted before POST begins is definitively cancelled');

  scheduleCalls = 0;
  globalThis.fetch = async () => {
    scheduleCalls += 1;
    if (scheduleCalls === 1) return new Response('route unavailable', { status: 429 });
    return new Response('', { status: 200, headers: { slot: '4', id: 'fallback-id' } });
  };
  const fallback = await api.rawSendMessage({
    process: 'P'.repeat(43), tags: [{ name: 'Action', value: 'User.Login' }],
  });
  assert.equal(scheduleCalls, 2, 'a definitive pre-acceptance rejection may use the configured fallback');
  assert.equal(fallback.slot, 4);
  assert.equal(fallback.action, 'user.login');

  scheduleCalls = 0;
  globalThis.fetch = async () => {
    scheduleCalls += 1;
    return new Response('', { status: 200, headers: { slot: 'not-a-slot' } });
  };
  await assert.rejects(
    api.rawSendMessage({ process: 'P'.repeat(43), tags: [{ name: 'Action', value: 'User.Login' }] }),
    (error) => error.name === 'AmbiguousWriteError' && /invalid slot/.test(error.message),
  );
  assert.equal(scheduleCalls, 1, 'an accepted response with an invalid slot cannot be safely replayed');

  let scheduledSlot = 10;
  const pushes = [];
  let computedReply = { ok: true };
  let computeStatus = 200;
  let reportedHead = null;
  /*
   * Cancels the correlated reply READ, mid-flight, on a write that the
   * scheduler has already durably accepted.
   *
   * This used to be keyed on `now/at-slot`, because `readSlot` probed the
   * cached head before pulling its own slot. It no longer does — the happy path
   * is one request, the compute pull — so that key silently stopped injecting
   * anything and the three blocks below stopped testing the accepted-but-unread
   * contract. `abortedReadPulls` is asserted at each of them so a future change
   * to the request shape fails loudly instead of quietly passing.
   */
  let abortReadController = null;
  let abortedReadPulls = 0;
  const pushStatuses = [];
  let publishedPlayerReply = null;
  let publishedPlayerReplies = [];
  let publishedFleetConfig = null;
  const publishedWorkerBattles = new Map();
  const transportEvents = [];
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    transportEvents.push(target);
    if (/\/now\/player-/.test(target)) {
      const value = publishedPlayerReplies.length
        ? publishedPlayerReplies.shift() : publishedPlayerReply;
      return value ? new Response(JSON.stringify(value)) : new Response('', { status: 404 });
    }
    if (target.endsWith('/now/battlefleet')) {
      return publishedFleetConfig
        ? new Response(JSON.stringify(publishedFleetConfig)) : new Response('', { status: 404 });
    }
    const workerBattleId = target.match(/\/now\/battle-([^/?]+)$/)?.[1];
    if (workerBattleId) {
      const value = publishedWorkerBattles.get(workerBattleId);
      return value ? new Response(JSON.stringify(value)) : new Response('', { status: 404 });
    }
    if (target.includes('/schedule?')) {
      scheduledSlot += 1;
      return new Response('', { status: 200, headers: { slot: String(scheduledSlot), id: `id-${scheduledSlot}` } });
    }
    if (target.endsWith('/now/at-slot')) {
      return new Response(String(reportedHead ?? scheduledSlot));
    }
    if (target.includes('/compute&slot=')) {
      if (abortReadController) {
        abortedReadPulls += 1;
        abortReadController.abort();
        throw abortReadController.signal.reason;
      }
      return new Response(JSON.stringify(computedReply), { status: computeStatus });
    }
    if (target.includes('/push&slot=')) {
      pushes.push({ target, method: init.method ?? 'GET' });
      return new Response('push', { status: pushStatuses.shift() ?? 200 });
    }
    throw new Error(`unexpected outbox request: ${target}`);
  };

  await api.rawSend([{ name: 'Action', value: 'Monster.Feed' }], {
    process: 'P'.repeat(43), node: 'https://node.test',
  });
  assert.equal(pushes.length, 0, 'ordinary gameplay writes must not trigger recursive outbox delivery');

  const beforeFleetGating = pushes.length;
  computedReply = { id: 'fb1', status: 'battling' };
  await api.rawSend([{ name: 'Action', value: 'Battle.Attack' }], {
    process: 'W'.repeat(43), node: 'https://node.test',
    requiredOutbox: (reply) => reply.status === 'ended',
  });
  assert.equal(pushes.length, beforeFleetGating,
    'a non-terminal fleet round must not trigger recursive outbox delivery');

  computedReply = { id: 'fb1', status: 'ended' };
  await api.rawSend([{ name: 'Action', value: 'Battle.Attack' }], {
    process: 'W'.repeat(43), node: 'https://node.test',
    requiredOutbox: (reply) => reply.status === 'ended',
  });
  assert.equal(pushes.length, beforeFleetGating + 1,
    'the terminal fleet round must deliver its settlement outbox');

  computedReply = { address: 'A'.repeat(43), battleFleet: { battleId: 'fb2' } };
  await api.rawSend([{ name: 'Action', value: 'Battle.Start' }], {
    process: 'P'.repeat(43), node: 'https://node.test', requiredOutbox: true,
  });
  assert.equal(pushes.length, beforeFleetGating + 2,
    'an explicitly fleet-routed Battle.Start delivers Battle.Open');

  await api.rawSend([
    { name: 'Action', value: 'Rune.Withdraw' },
    { name: 'aCtIoN', value: 'Monster.Feed' },
  ], { process: 'P'.repeat(43), node: 'https://node.test' });
  assert.equal(pushes.length, beforeFleetGating + 2,
    'outbox gating must use the last canonical Action field that was actually signed');

  // A push is NEVER retried. Measured on the live node: re-pushing an
  // already-delivered game slot re-executes the outbox and mints again
  // (totalsupply 233 -> 234 -> 235 across two re-pushes, no second in-game
  // deduction), which is how a soak turned 80 deducted Rune into 224 minted.
  // A failed delivery is therefore reported, never re-attempted.
  const beforeSinglePush = pushes.length;
  pushStatuses.push(503);
  await assert.rejects(
    api.rawSend([{ name: 'ACTION', value: 'RuNe.WiThDrAw' }], {
      process: 'P'.repeat(43), node: 'https://node.test',
    }),
    (error) => error.name === 'OutboxDeliveryError' && error.pushStatus === 503,
  );
  assert.equal(pushes.length, beforeSinglePush + 1,
    'a failed required delivery is pushed exactly once - a retry is a second mint');
  assert.match(pushes[beforeSinglePush].target, /push&slot=16$/);

  // The bug this file exists to pin: on the live node a withdrawal whose mint
  // LANDED answers the push with HTTP 500 every single time (the node crashes
  // caching the push result, after both hops are delivered). A confirmation
  // read of the recipient's token balance is the verdict; the status is not.
  const beforeConfirmed500 = pushes.length;
  let confirmReads = 0;
  pushStatuses.push(500);
  const confirmedWithdrawal = await api.rawSend([{ name: 'Action', value: 'Rune.Withdraw' }], {
    process: 'P'.repeat(43), node: 'https://node.test',
    deliveryOptions: {
      confirmIntervalMs: 0,
      confirm: async () => { confirmReads += 1; return confirmReads >= 2; },
    },
  });
  assert.deepEqual(confirmedWithdrawal, computedReply,
    'a 500 push whose delivery is confirmed must return the reply, not an error');
  assert.equal(pushes.length, beforeConfirmed500 + 1,
    'a confirmed delivery still pushes exactly once');
  assert.ok(confirmReads >= 2, 'the confirmation read is polled until it proves delivery');

  // And the other half: a 200 push proves nothing when a confirm exists, so an
  // unconfirmed delivery is still a loud, non-retryable failure.
  const beforeUnconfirmed200 = pushes.length;
  pushStatuses.push(200);
  await assert.rejects(
    api.rawSend([{ name: 'Action', value: 'Rune.Withdraw' }], {
      process: 'P'.repeat(43), node: 'https://node.test',
      deliveryOptions: {
        confirmIntervalMs: 0, confirmTimeoutMs: 1, confirm: async () => false,
      },
    }),
    (error) => error.name === 'OutboxDeliveryError'
      && error.confirmed === false
      && /do not retry the game action/i.test(error.message),
  );
  assert.equal(pushes.length, beforeUnconfirmed200 + 1,
    'an unconfirmed delivery is reported, not re-pushed');

  computedReply = { error: 'not enough runes' };
  const rejected = await api.rawSend([{ name: 'Action', value: 'Rune.Withdraw' }], {
    process: 'P'.repeat(43), node: 'https://node.test',
  });
  assert.deepEqual(rejected, { error: 'not enough runes' });
  assert.equal(pushes.length, beforeUnconfirmed200 + 1,
    'a rejected withdrawal cannot have an outbox and must preserve its real handler reply');

  // The pull 503s and the cached head is pinned one slot BEHIND the slot this
  // write is about to be given (`scheduledSlot` increments inside the schedule
  // branch), so recovery polls a head that never catches up and exhausts. The
  // `one compute request` match on the cause is what proves that: the message
  // for a head that DID catch up reads `Could not read the cached reply`.
  computedReply = { ok: true };
  reportedHead = scheduledSlot;
  computeStatus = 503;
  const pushesBeforeReadTimeout = pushes.length;
  await assert.rejects(
    api.rawSend([{ name: 'Action', value: 'Rune.Withdraw' }], {
      process: 'P'.repeat(43), node: 'https://node.test',
      readOptions: { attempts: 1, delayMs: 0 },
    }),
    (error) => error.name === 'AcceptedWriteError'
      && error.accepted === true
      && error.durable === true
      && error.completed === null
      && error.slot === scheduledSlot
      && error.action === 'rune.withdraw'
      && /do not retry/i.test(error.message)
      && /one compute request/.test(error.cause?.message ?? ''),
  );
  assert.equal(pushes.length, pushesBeforeReadTimeout + 1,
    'a read timeout must not prevent required outbox delivery from being attempted');

  computeStatus = 200;
  reportedHead = null;
  abortReadController = new AbortController();
  const abortedPullsBeforeReadAbort = abortedReadPulls;
  const pushesBeforeReadAbort = pushes.length;
  await assert.rejects(
    api.rawSend([{ name: 'Action', value: 'Rune.Withdraw' }], {
      process: 'P'.repeat(43), node: 'https://node.test', signal: abortReadController.signal,
    }),
    (error) => error.name === 'AcceptedWriteError'
      && error.slot === scheduledSlot
      && error.action === 'rune.withdraw'
      && error.cause?.name === 'AbortError'
      && /do not retry/i.test(error.message),
  );
  assert.equal(abortedReadPulls, abortedPullsBeforeReadAbort + 1,
    'the caller abort must actually land on the reply pull, or this asserts nothing');
  assert.equal(pushes.length, pushesBeforeReadAbort + 1,
    'caller abort after scheduling does not strand a withdrawal outbox');
  abortReadController = null;

  reportedHead = null;
  const pushesBeforeExhaustion = pushes.length;
  pushStatuses.push(503);
  await assert.rejects(
    api.rawSend([{ name: 'Action', value: 'Rune.Withdraw' }], {
      process: 'P'.repeat(43), node: 'https://node.test',
    }),
    (error) => error.name === 'OutboxDeliveryError'
      && error.action === 'rune.withdraw'
      && error.slot === scheduledSlot
      && error.completed === true
      && error.confirmed === null
      && /do not retry the game action/i.test(error.message),
  );
  assert.equal(pushes.length, pushesBeforeExhaustion + 1,
    'a failed required delivery is observable after exactly one push');

  const pushesBeforeFleetLeave = pushes.length;
  computedReply = {
    address: 'Q'.repeat(43),
    activeBattleId: 'leave-battle',
    battleFleet: {
      protocol: 'runerealm-battle-fleet/1', status: 'cancel-pending', battleId: 'leave-battle',
      reservationId: 'leave-reservation', assignmentId: 'leave-assignment', ticket: 'leave-ticket',
      workerId: 'worker-01', workerProcessId: 'W'.repeat(43), node: 'https://worker.test',
    },
  };
  publishedPlayerReply = { address: 'Q'.repeat(43), battlesRemaining: 4 };
  const leaveEventStart = transportEvents.length;
  const completedLeave = await api.leaveArena();
  assert.equal(completedLeave.battleFleet, undefined);
  assert.equal(pushes.length, pushesBeforeFleetLeave + 1,
    'fleet leave pushes without a fallible pre-read');
  const leaveEvents = transportEvents.slice(leaveEventStart);
  assert.ok(leaveEvents.findIndex((url) => url.includes('/push&slot='))
    < leaveEvents.findIndex((url) => url.includes('/now/player-')),
  'fleet leave reads settlement only after delivering its cancellation');
  computedReply = { address: 'Q'.repeat(43), battlesRemaining: 0 };
  await api.leaveArena();
  assert.equal(pushes.length, pushesBeforeFleetLeave + 2,
    'the cross-process-capable leave contract remains safe on monolith empty outboxes');

  abortReadController = new AbortController();
  const abortedPullsBeforeUnreadLeave = abortedReadPulls;
  const pushesBeforeUnreadFleetLeave = pushes.length;
  await assert.rejects(
    api.leaveArena(),
    (error) => error.name === 'AcceptedWriteError' && error.action === 'battle.leave',
  );
  // Two, not one: `send` answers a failed reply read with one patient re-read
  // before giving up, and this caller passes no signal of its own, so the
  // recovery read is not short-circuited by cancellation and pulls again. The
  // count stays exact rather than becoming a lower bound, so a change to the
  // request shape that stopped injecting here still fails loudly.
  assert.equal(abortedReadPulls, abortedPullsBeforeUnreadLeave + 2,
    'the unread Battle.Leave must actually have had its reply pull cancelled');
  assert.equal(pushes.length, pushesBeforeUnreadFleetLeave + 1,
    'accepted unread Battle.Leave still delivers a possible cancellation outbox');
  abortReadController = null;

  // A page reload validates the authority route against the sealed manifest,
  // reads the assigned worker cache, and reconstructs player.battle. The next
  // round must be signed to that worker and never pass through the game.
  const workerProcessId = 'W'.repeat(43);
  const playerAddress = 'Q'.repeat(43);
  const route = {
    protocol: 'runerealm-battle-fleet/1', status: 'battling',
    battleId: 'reload-battle', reservationId: 'reload-reservation',
    assignmentId: 'reload-assignment', ticket: 'reload-ticket',
    workerId: 'worker-01', workerProcessId, node: 'https://worker.test',
  };
  const combatant = (side, address) => ({ side, address, moves: { struggle: { count: 1 } } });
  const workerBattle = {
    id: route.battleId, kind: 'bot', status: 'battling', round: 4, turns: [],
    protocol: 'runerealm-battle-fleet/1', workerId: route.workerId,
    challenger: combatant('challenger', playerAddress),
    accepter: combatant('accepter', 'npc'),
  };
  publishedFleetConfig = {
    enabled: true, protocol: 'runerealm-battle-fleet/1', node: 'https://worker.test',
    workers: [{ workerId: route.workerId, workerProcessId }],
  };
  publishedPlayerReply = {
    address: playerAddress, activeBattleId: route.battleId, battleFleet: route,
  };
  publishedWorkerBattles.set(route.battleId, workerBattle);
  const reloaded = await api.readPlayer(playerAddress);
  assert.equal(reloaded.battle.id, route.battleId,
    'mid-fight reload attaches the validated worker battle to the player');
  computedReply = { ...workerBattle, round: 5 };
  const signedBeforeReloadRound = signedItems.length;
  const routedRound = await api.attack(route.battleId, 'struggle', 4, 'attack-reload-4');
  assert.equal(routedRound.battle.id, route.battleId);
  const directItem = signedItems[signedBeforeReloadRound];
  assert.equal(directItem.target, workerProcessId,
    'reload-hydrated attack targets the assigned worker directly');
  const directTags = Object.fromEntries(directItem.tags.map((tag) => [tag.name, tag.value]));
  assert.equal(directTags.action, 'Battle.Attack');
  assert.equal(directTags.battleid, route.battleId);
  assert.equal(directTags.ticket, route.ticket);
  assert.equal(directTags.actionid, 'attack-reload-4');
  assert.equal(directTags.round, '4');
  assert.equal(pushes.length, pushesBeforeUnreadFleetLeave + 1,
    'a reload-hydrated non-terminal round still has no recursive push');

  const terminalRoute = { ...route, battleId: 'terminal-battle', reservationId: 'terminal-reservation' };
  const terminalBattle = {
    ...workerBattle, id: terminalRoute.battleId, status: 'ended', round: 7, winner: 'challenger',
  };
  publishedWorkerBattles.set(terminalRoute.battleId, terminalBattle);
  publishedPlayerReply = {
    address: playerAddress, activeBattleId: terminalRoute.battleId, battleFleet: terminalRoute,
  };
  const terminalPending = await api.readPlayer(playerAddress);
  assert.equal(terminalPending.battle.status, 'ended',
    'terminal worker state remains renderable while authority settlement is pending');

  // The worker slot may be accepted and terminal while its correlated reply
  // read times out. Cache visibility proves terminal, so attack delivers that
  // exact accepted slot and returns the settled authority account rather than
  // rethrowing AcceptedWriteError.
  publishedPlayerReply = { address: playerAddress, battlesRemaining: 3, wins: 1 };
  abortReadController = new AbortController();
  const abortedPullsBeforeUnreadTerminal = abortedReadPulls;
  const pushesBeforeUnreadTerminal = pushes.length;
  const acceptedTerminal = await api.attack(
    terminalRoute.battleId, 'struggle', 7, 'attack-terminal-unread',
  );
  abortReadController = null;
  // Two for the same reason as the unread Battle.Leave above: the first pull
  // and `send`'s one patient re-read.
  assert.equal(abortedReadPulls, abortedPullsBeforeUnreadTerminal + 2,
    'the terminal round\'s reply pull must actually be cancelled — otherwise this '
    + 'exercises the ordinary computed-reply path, not the accepted-unread one');
  assert.equal(acceptedTerminal.wins, 1);
  assert.equal(acceptedTerminal.result, 'win');
  assert.equal(pushes.length, pushesBeforeUnreadTerminal + 1,
    'accepted unread terminal attack pushes its exact worker slot once');

  publishedPlayerReplies = [
    { address: playerAddress, activeBattleId: terminalRoute.battleId, battleFleet: terminalRoute },
    { address: playerAddress, battlesRemaining: 3, wins: 1 },
  ];
  const terminalSettled = await api.readPlayer(playerAddress);
  assert.equal(terminalSettled.battle, undefined);
  assert.equal(terminalSettled.battleFleet, undefined);
  assert.equal(terminalSettled.wins, 1,
    'terminal reload prefers the re-read settled authority account over a stale route');

  const rejectedRoute = {
    ...route, battleId: 'rejected-battle', reservationId: 'rejected-reservation',
    assignmentId: 'rejected-assignment', ticket: 'rejected-ticket',
  };
  computedReply = {
    address: playerAddress, activeBattleId: rejectedRoute.battleId, battleFleet: rejectedRoute,
  };
  publishedPlayerReply = { address: playerAddress, battlesRemaining: 4 };
  await assert.rejects(api.startBotBattle(1), /rejected.*safe to try/i,
    'OpenRejected is detected from authority cache instead of waiting for a nonexistent worker key');

  // A push socket that never settles is still bounded. The real ceiling is 90 s
  // - a live push measured 11.7-27.5 s and aborting one early is what strands a
  // withdrawal - so this drives the same guard with an explicit tiny window.
  let hungPushSignal;
  globalThis.fetch = async (_url, init = {}) => {
    hungPushSignal = init.signal;
    return new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    });
  };
  const hungPush = await api.rawDeliverSlot(99, {
    process: 'P'.repeat(43), node: 'https://node.test', timeoutMs: 10,
  });
  assert.deepEqual(hungPush,
    { delivered: false, confirmed: null, status: null, responded: false },
    'a push fetch that never settles is bounded and reports that nothing was delivered');
  assert.equal(hungPushSignal.aborted, true, 'the timed-out push fetch is aborted');
} finally {
  globalThis.fetch = originalFetch;
  globalThis.setTimeout = originalSetTimeout;
  if (originalWallet === undefined) delete globalThis.arweaveWallet;
  else globalThis.arweaveWallet = originalWallet;
}

assert.deepEqual(resolveLoadPolicy({ walletCount: 50 }), {
  mode: 'soak', concurrency: 3, actionsPerSecond: 1, burst: 1,
}, 'normal soak mode must default below the measured single-process ceiling');
assert.deepEqual(resolveLoadPolicy({ mode: 'stress', walletCount: 50 }), {
  mode: 'stress', concurrency: 50, actionsPerSecond: null, burst: 1,
}, 'stress mode must explicitly expose unthrottled fifty-wallet saturation');
assert.deepEqual(resolveLoadPolicy({
  mode: 'stress', walletCount: 50, concurrency: '12', actionsPerSecond: '2.5', burst: '3',
}), {
  mode: 'stress', concurrency: 12, actionsPerSecond: 2.5, burst: 3,
}, 'stress runs can be staged at a controlled arrival rate');

assert.deepEqual(responseOutcomeCounts({
  successfulDurations: [10, 20], failedDurations: [30], failedCount: 2,
}), {
  attempted: 4, succeeded: 2, failed: 2, timedFailures: 1,
}, 'response totals count failures even when one has no duration sample');

const orchestrationError = new Error('pair returned no battle id');
assert.throws(
  () => settledValuesOrThrow([
    { status: 'fulfilled', value: 'routine-ok' },
    { status: 'rejected', reason: orchestrationError },
  ], 'cycle pair'),
  (error) => error === orchestrationError,
  'cycle/mapLimit orchestration must rethrow a captured pair rejection',
);
const terminationAudit = settledRejections([
  { status: 'fulfilled', value: 0 },
  { status: 'rejected', reason: 'termination timed out' },
], 'worker termination');
assert.equal(terminationAudit.length, 1,
  'final allSettled termination inspection must surface every rejection');
assert.equal(terminationAudit[0].index, 1);
assert.match(terminationAudit[0].error.message, /termination timed out/);
const recordedTerminations = [];
const terminationInspection = inspectTerminations([
  { status: 'fulfilled', value: 0 },
  { status: 'rejected', reason: new Error('cannot confirm stop') },
], (error, index) => recordedTerminations.push({ error, index }));
assert.deepEqual({
  fatal: terminationInspection.fatal,
  failureCount: terminationInspection.failureCount,
  recorded: recordedTerminations.length,
}, { fatal: true, failureCount: 1, recorded: 1 },
'a rejected final termination is recorded and marks the run audit fatal');

let fakeNow = 0;
const waits = [];
const acquire = createTokenBucket({
  actionsPerSecond: 2,
  burst: 2,
  now: () => fakeNow,
  sleep: async (delayMs) => {
    waits.push(delayMs);
    fakeNow += delayMs;
  },
});
await acquire();
await acquire();
await acquire();
await acquire();
assert.deepEqual(waits, [500, 500], 'a 2 action/s bucket allows its burst, then spaces dispatches');
fakeNow += 1_000;
await acquire();
await acquire();
assert.deepEqual(waits, [500, 500], 'idle time refills the configured burst capacity');

const concurrentWaits = [];
const releases = [];
const acquireConcurrently = createTokenBucket({
  actionsPerSecond: 2,
  burst: 1,
  now: () => 0,
  sleep: (delayMs) => new Promise((resolve) => {
    concurrentWaits.push(delayMs);
    releases.push(resolve);
  }),
});
const concurrentReservations = [
  acquireConcurrently(), acquireConcurrently(), acquireConcurrently(), acquireConcurrently(),
];
assert.deepEqual(concurrentWaits, [500, 1_000, 1_500],
  'concurrent callers reserve successive token times instead of waking as a burst');
for (const release of releases) release();
assert.deepEqual(await Promise.all(concurrentReservations), [0, 500, 1_000, 1_500]);

let deadlineRelease;
const deadlineBucket = createTokenBucket({
  actionsPerSecond: 2,
  burst: 1,
  now: () => 0,
  sleep: () => new Promise((resolve) => { deadlineRelease = resolve; }),
});
assert.equal(await deadlineBucket({ deadline: 900 }), 0);
const insideDeadline = deadlineBucket({ deadline: 900 });
assert.equal(await deadlineBucket({ deadline: 900 }), null,
  'the bucket must refuse a reservation whose token arrives outside the gameplay window');
deadlineRelease();
assert.equal(await insideDeadline, 500);

let allowAfterToken = true;
let releaseToken;
let postTokenRuns = 0;
const postTokenDispatcher = createGatedDispatcher({
  concurrency: 1,
  acquire: () => new Promise((resolve) => { releaseToken = resolve; }),
});
const stoppedAfterToken = postTokenDispatcher(
  async () => { postTokenRuns += 1; },
  { shouldStart: () => allowAfterToken },
);
allowAfterToken = false;
releaseToken(0);
assert.deepEqual(await stoppedAfterToken, { started: false });
assert.equal(postTokenRuns, 0, 'gameplay stopped while rate-limited must not reach its worker');

let releaseInFlight;
let secondAllowed = true;
let queuedRuns = 0;
const postLimitDispatcher = createGatedDispatcher({ concurrency: 1 });
const inFlight = postLimitDispatcher(() => new Promise((resolve) => {
  releaseInFlight = resolve;
}));
await Promise.resolve();
await Promise.resolve();
const stoppedBehindLimit = postLimitDispatcher(
  async () => { queuedRuns += 1; },
  { shouldStart: () => secondAllowed },
);
await Promise.resolve();
secondAllowed = false;
releaseInFlight('done');
assert.deepEqual(await inFlight, { started: true, value: 'done' });
assert.deepEqual(await stoppedBehindLimit, { started: false });
assert.equal(queuedRuns, 0, 'gameplay stopped behind concurrency must not reach its worker');

let dispatchNow = 0;
let releaseSlow;
const startTimes = [];
const startRate = createTokenBucket({
  actionsPerSecond: 1,
  burst: 1,
  now: () => dispatchNow,
  sleep: async (delayMs) => { dispatchNow += delayMs; },
});
const startLimited = createGatedDispatcher({ concurrency: 1, acquire: startRate });
const slow = startLimited(() => {
  startTimes.push(dispatchNow);
  return new Promise((resolve) => { releaseSlow = resolve; });
});
while (!releaseSlow) await Promise.resolve();
const maturedBehindSlow = startLimited(async () => { startTimes.push(dispatchNow); });
const queuedBehindMatured = startLimited(async () => { startTimes.push(dispatchNow); });
dispatchNow = 5_000;
releaseSlow('done');
await Promise.all([slow, maturedBehindSlow, queuedBehindMatured]);
assert.deepEqual(startTimes, [0, 5_000, 6_000],
  'rate permits are acquired at command start and cannot mature behind slow concurrency');

class FakeWorker extends EventEmitter {
  constructor(termination) {
    super();
    this.posts = [];
    this.termination = termination;
    this.terminateCalls = 0;
  }

  postMessage(message) { this.posts.push(message); }

  terminate() {
    this.terminateCalls += 1;
    return this.termination;
  }
}

const structuredWorker = new FakeWorker(Promise.resolve(0));
const structuredActor = new Actor({
  profile: { wallet: 'burner-structured-error' },
  burner: { file: 'unused.json', address: 'E'.repeat(43) },
  clientFile: 'unused.mjs', runId: 'test', seed: 1, timeoutMs: 500, peers: [],
  workerFactory: () => structuredWorker,
});
structuredWorker.emit('message', { type: 'ready' });
const structuredCall = structuredActor.call('tick').catch((error) => error);
while (!structuredWorker.posts.length) await Promise.resolve();
structuredWorker.emit('message', {
  id: structuredWorker.posts[0].id,
  ok: false,
  error: {
    name: 'AcceptedWriteError', message: 'accepted; do not retry', durationMs: 42,
    accepted: true, durable: true, slot: 77, action: 'monster.feed',
    completed: null, status: 503,
  },
});
const structuredFailure = await structuredCall;
assert.deepEqual(structuredErrorFields(structuredFailure), {
  name: 'AcceptedWriteError', accepted: true, durable: true, slot: 77,
  action: 'monster.feed', completed: null, status: 503, durationMs: 42,
}, 'worker-to-parent errors preserve known structured transport metadata');
assert.deepEqual(failureEventFields(structuredFailure), {
  error: 'accepted; do not retry', durationMs: 42, name: 'AcceptedWriteError',
  accepted: true, durable: true, slot: 77, action: 'monster.feed',
  completed: null, status: 503,
}, 'failure events retain structured transport metadata for reconciliation');
await structuredActor.terminate();

let resolveTermination;
const fakeWorker = new FakeWorker(new Promise((resolve) => { resolveTermination = resolve; }));
const actorTimers = new Map();
let timerSequence = 0;
let actorNow = 100;
const actor = new Actor({
  profile: { wallet: 'burner-timeout' },
  burner: { file: 'unused.json', address: 'A'.repeat(43) },
  clientFile: 'unused.mjs', runId: 'test', seed: 1, timeoutMs: 50, peers: [],
  workerFactory: () => fakeWorker,
  setTimer: (fn) => { const id = ++timerSequence; actorTimers.set(id, fn); return id; },
  clearTimer: (id) => actorTimers.delete(id),
  now: () => actorNow,
});
fakeWorker.emit('message', { type: 'ready' });
const timedCall = actor.call('tick');
await Promise.resolve();
assert.equal(fakeWorker.posts.length, 1);
actorNow = 160;
assert.equal(actorTimers.size, 1);
[...actorTimers.values()][0]();
let timedCallSettled = false;
const timedOutcome = timedCall.then(
  () => { timedCallSettled = true; return null; },
  (error) => { timedCallSettled = true; return error; },
);
await Promise.resolve();
assert.equal(fakeWorker.terminateCalls, 1, 'a timed-out actor terminates its worker');
assert.equal(timedCallSettled, false,
  'the timed-out call keeps dispatcher capacity until worker termination completes');
await assert.rejects(actor.call('tick'), /timed out after 50ms/);
assert.equal(fakeWorker.posts.length, 1, 'a retired actor is never reused for another command');
resolveTermination(1);
const timedError = await timedOutcome;
assert.match(timedError.message, /timed out after 50ms/);
assert.equal(timedError.durationMs, 60);

let rejectTermination;
const rejectingWorker = new FakeWorker(new Promise((_, reject) => { rejectTermination = reject; }));
const rejectingTimers = new Map();
let rejectingTimerId = 0;
let rejectingNow = 0;
const rejectingActor = new Actor({
  profile: { wallet: 'burner-rejecting-termination' },
  burner: { file: 'unused.json', address: 'C'.repeat(43) },
  clientFile: 'unused.mjs', runId: 'test', seed: 1, timeoutMs: 50,
  terminationTimeoutMs: 1_000, peers: [], workerFactory: () => rejectingWorker,
  setTimer: (fn, ms) => {
    const id = ++rejectingTimerId;
    rejectingTimers.set(id, { fn, ms });
    return id;
  },
  clearTimer: (id) => rejectingTimers.delete(id),
  now: () => rejectingNow,
});
rejectingWorker.emit('message', { type: 'ready' });
const rejectingCall = rejectingActor.call('tick').catch((error) => error);
while (!rejectingWorker.posts.length) await Promise.resolve();
rejectingNow = 75;
[...rejectingTimers.values()].find((timer) => timer.ms === 50).fn();
while (!rejectingWorker.terminateCalls) await Promise.resolve();
rejectTermination(new Error('terminate denied'));
const retirementFailure = await rejectingCall;
assert.equal(retirementFailure.name, 'ActorRetirementError');
assert.equal(retirementFailure.fatalRetirement, true);
assert.equal(retirementFailure.terminationConfirmed, false);
assert.equal(retirementFailure.durationMs, 75,
  'fatal retirement preserves the duration of the invocation that timed out');
assert.match(retirementFailure.message, /termination could not be confirmed/);
await assert.rejects(rejectingActor.call('tick'), /termination could not be confirmed/);
assert.equal(rejectingWorker.posts.length, 1,
  'an actor whose termination rejected is fatal and never reused');

const hangingTerminationWorker = new FakeWorker(new Promise(() => {}));
const hangingTerminationTimers = new Map();
let hangingTerminationTimerId = 0;
const hangingTerminationActor = new Actor({
  profile: { wallet: 'burner-hanging-termination' },
  burner: { file: 'unused.json', address: 'D'.repeat(43) },
  clientFile: 'unused.mjs', runId: 'test', seed: 1, timeoutMs: 50,
  terminationTimeoutMs: 100, peers: [], workerFactory: () => hangingTerminationWorker,
  setTimer: (fn, ms) => {
    const id = ++hangingTerminationTimerId;
    hangingTerminationTimers.set(id, { fn, ms });
    return id;
  },
  clearTimer: (id) => hangingTerminationTimers.delete(id),
});
hangingTerminationWorker.emit('message', { type: 'ready' });
const hangingTerminationCall = hangingTerminationActor.call('tick').catch((error) => error);
while (!hangingTerminationWorker.posts.length) await Promise.resolve();
[...hangingTerminationTimers.values()].find((timer) => timer.ms === 50).fn();
while (![...hangingTerminationTimers.values()].some((timer) => timer.ms === 100)) {
  await Promise.resolve();
}
[...hangingTerminationTimers.values()].find((timer) => timer.ms === 100).fn();
const confirmationTimeout = await hangingTerminationCall;
assert.equal(confirmationTimeout.name, 'ActorRetirementError');
assert.match(confirmationTimeout.cause?.message ?? '', /did not terminate within 100ms/);
assert.equal(hangingTerminationTimers.size, 0,
  'a hanging worker termination is bounded and clears its confirmation timer');

const exitedWorker = new FakeWorker(Promise.resolve(0));
const exitedActor = new Actor({
  profile: { wallet: 'burner-exited' },
  burner: { file: 'unused.json', address: 'B'.repeat(43) },
  clientFile: 'unused.mjs', runId: 'test', seed: 1, timeoutMs: 50, peers: [],
  workerFactory: () => exitedWorker,
});
exitedWorker.emit('exit', 0);
await assert.rejects(exitedActor.call('tick'), /worker exited 0/);
assert.equal(exitedWorker.posts.length, 0,
  'an actor that exits before ready rejects promptly and is permanently retired');

console.log('swarm: profiles, client slot/outbox behavior, and safe/stress load controls — valid');
