/** End-to-end local game-authority <-> battle-worker integration test. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AoLoader from '@permaweb/ao-loader';
import {
  BATTLE_FLEET_PROTOCOL, battleFleetLua, validateBattleFleetManifest,
} from './battle-fleet-config.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const WASM = fs.readFileSync(path.join(ROOT, 'Reality', 'process', 'module', 'AOS.wasm'));
const read = (relative) => fs.readFileSync(path.join(HERE, relative), 'utf8');
const id = (prefix, fill) => `${prefix}${fill.repeat(43)}`.slice(0, 43);
const GAME = id('GAME', 'g');
const WORKER = id('WORKER', 'w');
const WRONG_WORKER = id('WRONG', 'x');
const SCHEDULER = id('SCHED', 's');
const OWNER = id('OWNER', 'o');
const ALICE = id('ALICE', 'a');
const NODE = 'https://schedule.forward.computer';

const manifest = validateBattleFleetManifest({
  enabled: true,
  protocol: BATTLE_FLEET_PROTOCOL,
  node: NODE,
  managerMode: 'assign-only',
  workers: [
    { workerId: 'worker-01', workerProcessId: WORKER, runtime: 'lua@5.3a', lifecycle: 'ready' },
    { workerId: 'worker-02', workerProcessId: WRONG_WORKER, runtime: 'lua@5.3a', lifecycle: 'ready' },
  ],
  ticketTtl: 10 * 60 * 1000,
});

const common = [
  'package.loaded[".json"] = require("json")',
  'local C = (function()', read('constants.lua'), 'end)()',
  read('monster-index.generated.lua'),
  'local jsonx = (function()', read('jsonenc.lua'), 'end)()',
  'local encode, jsonObject = jsonx.encode, jsonx.object',
  'Battle = (function()', read('battle.lua'), 'end)()',
  'local EconomyEngine = (function()', read('economy.lua'), 'end)()',
];

const gameSource = (config, bootstrap = false) => [
  ...common,
  bootstrap ? 'BattleFleetBootstrapConfig = { enabled=true }' : 'BattleFleetBootstrapConfig = nil',
  config ? battleFleetLua(config) : 'BattleFleetConfig = nil',
  'BattleFleetAuthority = (function()', read('battle-fleet/authority.lua'), 'end)()',
  read('game.lua'),
  `local TEST_OWNER=${JSON.stringify(OWNER)}`,
  `local TEST_SCHEDULER=${JSON.stringify(SCHEDULER)}`,
  `local TEST_ALICE=${JSON.stringify(ALICE)}`,
  'local TEST_GAME_BASE = {',
  '  ["scheduler-location"] = TEST_SCHEDULER,',
  '  process = { commitments = { owner = { committer=TEST_OWNER, alg="rsa-pss-sha512" } } },',
  '}',
  `function TEST_GAME(raw)
    local call = json.decode(raw)
    local body = {}
    for k,v in pairs(call.tags or {}) do body[k]=v end
    if call.kind == "wallet" then
      body.Address = call.from
    else
      body["from-process"] = call.fromProcess
      body.commitments = {
        scheduler = { committer=call.signer or TEST_SCHEDULER, alg="rsa-pss-sha512" }
      }
      if call.secondSigner then
        body.commitments.other = { committer=call.secondSigner, alg="rsa-pss-sha512" }
      end
    end
    if call.data then body.Data=call.data end
    local result = compute(TEST_GAME_BASE, { body=body, timestamp=call.timestamp }, {})
    local published = result["player-" .. TEST_ALICE]
    return encode({
      output=json.decode(result.results.output.data),
      outbox=result.results.outbox,
      player=published and json.decode(published) or nil,
      fleet=result.battlefleet and json.decode(result.battlefleet) or nil,
      fleetops=result.battlefleetops and json.decode(result.battlefleetops) or nil,
      telemetryFullRebuilds=TelemetryFullRebuilds,
      derived={
        factions=result.factions, leaderboard=result.leaderboard,
        metrics=result.metrics, users=result.users, market=result.market,
        challenges=result.challenges, offerings=result.offerings,
      },
    })
  end
  function TEST_POISON_DERIVED()
    TEST_GAME_BASE.factions="SENTINEL"
    TEST_GAME_BASE.leaderboard="SENTINEL"
    TEST_GAME_BASE.metrics="SENTINEL"
    TEST_GAME_BASE.users="SENTINEL"
    TEST_GAME_BASE.market="SENTINEL"
    TEST_GAME_BASE.challenges="SENTINEL"
    TEST_GAME_BASE.offerings="SENTINEL"
    return tostring(TelemetryFullRebuilds)
  end`,
  'return "game-ready"',
].join('\n');

const workerSource = [
  ...common,
  `BattleFleetConfig = {
    enabled=true, gameProcess=${JSON.stringify(GAME)}, workerId="worker-01",
    capacity=4, maxRetained=20, maxPending=20,
  }`,
  read('battle-fleet/worker.lua'),
  `local TEST_OWNER=${JSON.stringify(OWNER)}`,
  `local TEST_SCHEDULER=${JSON.stringify(SCHEDULER)}`,
  'local TEST_WORKER_BASE = {',
  '  ["scheduler-location"] = TEST_SCHEDULER,',
  '  process = { commitments = { owner = { committer=TEST_OWNER, alg="rsa-pss-sha512" } } },',
  '}',
  `function TEST_WORKER(raw)
    local call = json.decode(raw)
    local body = {}
    for k,v in pairs(call.tags or {}) do body[k]=v end
    if call.kind == "process" then
      body["from-process"] = call.fromProcess
      body.commitments = { scheduler = {
        committer=call.signer or TEST_SCHEDULER, alg="rsa-pss-sha512"
      } }
    else
      body.commitments = { wallet = {
        committer=call.from, alg="rsa-pss-sha512"
      } }
    end
    if call.data then body.data=call.data end
    local result = compute(TEST_WORKER_BASE, { body=body, timestamp=call.timestamp }, {})
    local published = call.battleId and result["battle-" .. call.battleId]
    return encode({
      output=json.decode(result.results.output.data),
      outbox=result.results.outbox,
      battle=published and json.decode(published) or nil,
      status=result.fleetstatus and json.decode(result.fleetstatus) or nil,
    })
  end`,
  'return "worker-ready"',
].join('\n');

class LocalLua {
  constructor(processId, source) {
    this.processId = processId;
    this.source = source;
    this.memory = null;
    this.sequence = 0;
  }

  async init() {
    this.handle = await AoLoader(WASM, {
      format: 'wasm32-unknown-emscripten',
      computeLimit: 9_000_000_000_000,
      memoryLimit: 512 * 1024 * 1024,
    });
    await this.eval(this.source);
    return this;
  }

  async eval(code) {
    const sequence = ++this.sequence;
    const result = await this.handle(this.memory, {
      // Sequence must precede the long process id. Putting it after a 43-char
      // id truncates every Eval to the same message id and makes a local replay
      // look like a security success/failure from another call.
      Id: `eval-${sequence}-${this.processId}`.slice(0, 43).padEnd(43, '_'),
      Target: this.processId,
      Owner: OWNER,
      From: OWNER,
      Tags: [{ name: 'Action', value: 'Eval' }],
      Data: code,
      'Block-Height': String(sequence),
      Timestamp: String(1700000000000 + sequence),
      Module: id('MODULE', 'm'),
      Cron: false,
    }, { Process: {
      Id: this.processId, Owner: OWNER,
      Tags: [
        { name: 'Data-Protocol', value: 'ao' },
        { name: 'Variant', value: 'ao.TN.1' },
        { name: 'Type', value: 'Process' },
      ],
    } });
    if (result.Error) throw new Error(result.Error);
    this.memory = result.Memory;
    const data = result.Output?.data;
    return typeof data === 'string' ? data : data?.output;
  }

  async call(functionName, payload) {
    const encoded = JSON.stringify(JSON.stringify(payload));
    return JSON.parse(await this.eval(`return ${functionName}(${encoded})`));
  }
}

let timestamp = 1700000000000;
const at = () => (timestamp += 1000);
const wallet = (from, tags, data) => ({ kind: 'wallet', from, tags, data, timestamp: at() });
const processNotice = (fromProcess, action, data, extras = {}) => ({
  kind: 'process', fromProcess, tags: { Action: action }, data, timestamp: at(), ...extras,
});

async function seedArena(game) {
  await game.call('TEST_GAME', wallet(OWNER, { Action: 'Stats' }));
  await game.call('TEST_GAME', wallet(OWNER, { Action: 'Admin.Unlock', Addresses: ALICE }));
  await game.call('TEST_GAME', wallet(ALICE, {
    Action: 'Faction.Join', Faction: 'Inferno Blades',
  }));
  // Rune no longer arrives from a per-wallet starter faucet. This integration
  // runs the process in testing mode, so fund its explicit arena fixture through
  // the audited owner path.
  await game.call('TEST_GAME', wallet(OWNER, {
    Action: 'Admin.Grant', PlayerId: ALICE, Item: 'rune', Amount: '5',
  }));
  const begun = await game.call('TEST_GAME', wallet(ALICE, { Action: 'Battle.Begin' }));
  assert.equal(begun.output.battlesRemaining, 4);
  return begun.output;
}

async function completeFinalHandshake({
  game, worker, terminal, route, kind, acknowledgementAction,
}) {
  const acknowledgement = terminal.outbox?.acknowledgement;
  assert.equal(acknowledgement?.action, acknowledgementAction);
  assert.equal(acknowledgement?.target, WORKER);

  const ackedAtWorker = await worker.call('TEST_WORKER', {
    kind: 'process', fromProcess: GAME, tags: acknowledgement,
    battleId: route.battleId, timestamp: at(),
  });
  assert.equal(ackedAtWorker.output.acknowledged, true);
  assert.equal(ackedAtWorker.output.duplicate, false);
  assert.equal(ackedAtWorker.outbox.confirmation.action, 'Battle.Fleet.FinalAcked');
  assert.equal(ackedAtWorker.status.pendingDeliveries, 0);
  assert.equal(ackedAtWorker.status.pendingConfirmations, 1);
  assert.equal(ackedAtWorker.status.availableSlots, ackedAtWorker.status.capacity);
  assert.equal(ackedAtWorker.status.accepting, true);
  const confirmation = JSON.parse(ackedAtWorker.outbox.confirmation.data);
  assert.equal(confirmation.kind, kind);
  assert.equal(confirmation.reservationId, route.reservationId);
  assert.equal(confirmation.battleId, route.battleId);

  const duplicateAck = await worker.call('TEST_WORKER', {
    kind: 'process', fromProcess: GAME, tags: acknowledgement,
    battleId: route.battleId, timestamp: at(),
  });
  assert.equal(duplicateAck.output.duplicate, true);
  assert.equal(
    duplicateAck.outbox.confirmation.data,
    ackedAtWorker.outbox.confirmation.data,
  );

  const confirmedAtGame = await game.call('TEST_GAME', processNotice(
    WORKER,
    ackedAtWorker.outbox.confirmation.action,
    ackedAtWorker.outbox.confirmation.data,
  ));
  assert.equal(confirmedAtGame.output.confirmed, true);
  assert.equal(confirmedAtGame.output.duplicate, false);
  assert.equal(confirmedAtGame.outbox.release.action, 'Fleet.FinalAcked.Release');
  assert.equal(confirmedAtGame.outbox.release.target, WORKER);
  assert.equal(
    confirmedAtGame.outbox.release.ConfirmationId,
    confirmation.confirmationId,
  );
  assert.equal(
    confirmedAtGame.fleetops.finals.find(
      (row) => row.reservationId === route.reservationId,
    )?.deliveryConfirmed,
    true,
  );

  const duplicateConfirmation = await game.call('TEST_GAME', processNotice(
    WORKER,
    duplicateAck.outbox.confirmation.action,
    duplicateAck.outbox.confirmation.data,
  ));
  assert.equal(duplicateConfirmation.output.duplicate, true);
  assert.equal(
    duplicateConfirmation.outbox.release.ConfirmationId,
    confirmation.confirmationId,
  );

  const releasedAtWorker = await worker.call('TEST_WORKER', {
    kind: 'process', fromProcess: GAME, tags: confirmedAtGame.outbox.release,
    battleId: route.battleId, timestamp: at(),
  });
  assert.equal(releasedAtWorker.output.released, true);
  assert.equal(releasedAtWorker.output.duplicate, false);
  assert.equal(releasedAtWorker.status.pendingConfirmations, 0);
  assert.equal(releasedAtWorker.status.availableSlots, releasedAtWorker.status.capacity);
  assert.equal(releasedAtWorker.status.accepting, true);

  const duplicateRelease = await worker.call('TEST_WORKER', {
    kind: 'process', fromProcess: GAME, tags: confirmedAtGame.outbox.release,
    battleId: route.battleId, timestamp: at(),
  });
  assert.equal(duplicateRelease.output.duplicate, true);
  assert.equal(duplicateRelease.status.pendingConfirmations, 0);

  // Released confirmations remain replayable for one ticket window, then are
  // pruned so a succession of completed battles cannot exhaust admission.
  timestamp += ackedAtWorker.status.maxTicketTtl + 1000;
  const afterRetention = await worker.call(
    'TEST_WORKER', wallet(OWNER, { Action: 'Fleet.Status' }),
  );
  assert.equal(afterRetention.status.retainedConfirmations, 0);
  assert.equal(afterRetention.status.pendingConfirmations, 0);
  assert.equal(afterRetention.status.availableSlots, afterRetention.status.capacity);
  assert.equal(afterRetention.status.accepting, true);
}

const disabled = await new LocalLua(id('DISABLED', 'd'), gameSource(null)).init();
await seedArena(disabled);
const monolith = await disabled.call('TEST_GAME', wallet(ALICE, {
  Action: 'Battle.Start', Difficulty: '1',
}));
assert.equal(monolith.output.battle.kind, 'bot');
assert.equal(monolith.outbox, undefined);
assert.equal(monolith.output.battleFleet, undefined);
console.log('PASS  disabled config preserves monolith Battle.Start with no outbox');

const bootstrap = await new LocalLua(id('BOOTSTRAP', 'b'), gameSource(null, true)).init();
await seedArena(bootstrap);
const unconfigured = await bootstrap.call('TEST_GAME', wallet(ALICE, {
  Action: 'Battle.Start', Difficulty: '1',
}));
assert.equal(unconfigured.fleet.enabled, false);
assert.equal(unconfigured.output.battle.kind, 'bot');
assert.equal(unconfigured.outbox, undefined);
const unauthorizedConfig = await bootstrap.call('TEST_GAME', wallet(ALICE, {
  Action: 'Admin.ConfigureBattleFleet',
}, JSON.stringify(manifest)));
assert.equal(unauthorizedConfig.output.error, 'Not authorised');
const malformedConfig = await bootstrap.call('TEST_GAME', wallet(OWNER, {
  Action: 'Admin.ConfigureBattleFleet',
}, JSON.stringify({ enabled: true, protocol: BATTLE_FLEET_PROTOCOL, workers: [] })));
assert.match(malformedConfig.output.error, /Malformed/);
const configured = await bootstrap.call('TEST_GAME', wallet(OWNER, {
  Action: 'Admin.ConfigureBattleFleet',
}, JSON.stringify(manifest)));
assert.equal(configured.output.configured, true, JSON.stringify(configured.output));
assert.equal(configured.output.duplicate, false);
assert.equal(configured.fleet.enabled, true);
const configReplay = await bootstrap.call('TEST_GAME', wallet(OWNER, {
  Action: 'Admin.ConfigureBattleFleet',
}, JSON.stringify(manifest)));
assert.equal(configReplay.output.duplicate, true);
const conflictingManifest = { ...manifest, node: 'https://other.example' };
const configConflict = await bootstrap.call('TEST_GAME', wallet(OWNER, {
  Action: 'Admin.ConfigureBattleFleet',
}, JSON.stringify(conflictingManifest)));
assert.match(configConflict.output.error, /already sealed/);
const conflictingLimits = { ...manifest, ticketTtl: manifest.ticketTtl + 1 };
const limitConflict = await bootstrap.call('TEST_GAME', wallet(OWNER, {
  Action: 'Admin.ConfigureBattleFleet',
}, JSON.stringify(conflictingLimits)));
assert.match(limitConflict.output.error, /already sealed/);
console.log('PASS  unconfigured capability falls back safely and owner seals one manifest once');

const game = await new LocalLua(GAME, gameSource(manifest)).init();
const worker = await new LocalLua(WORKER, workerSource).init();
await seedArena(game);
const started = await game.call('TEST_GAME', wallet(ALICE, {
  Action: 'Battle.Start', Difficulty: '1', StartId: 'start-one',
}));
assert.equal(started.output.battlesRemaining, 3);
assert.equal(started.output.battleFleet.workerProcessId, WORKER);
assert.equal(started.outbox.open.action, 'Battle.Open');
const route = started.output.battleFleet;
console.log('PASS  authority reserves one session battle and emits one routed Battle.Open');

for (const [action, data] of [
  ['Admin.ReleaseBattle', undefined],
  ['Admin.UpdatePlayer', JSON.stringify({ clearBattle: true, account: { battlesRemaining: 99 } })],
  ['Admin.RemoveUser', undefined],
]) {
  const refused = await game.call('TEST_GAME', wallet(OWNER, {
    Action: action, PlayerId: ALICE,
  }, data));
  assert.match(refused.output.error, /Active fleet battle must use/);
  const unchanged = await game.call('TEST_GAME', wallet(ALICE, { Action: 'User.Info' }));
  assert.equal(unchanged.output.battlesRemaining, 3);
  assert.equal(unchanged.output.battleFleet.reservationId, route.reservationId);
}
console.log('PASS  monolith admin release/edit/delete paths cannot corrupt a fleet reservation');

const distinctStart = await game.call('TEST_GAME', wallet(ALICE, {
  Action: 'Battle.Start', Difficulty: '1', StartId: 'start-distinct-while-active',
}));
assert.equal(distinctStart.output.error, 'You are already in a battle');
assert.equal(distinctStart.player.battlesRemaining, 3);
assert.equal(distinctStart.player.battleFleet.reservationId, route.reservationId);
assert.equal(distinctStart.outbox, undefined);
console.log('PASS  distinct StartId cannot reserve over an active fleet route');

const duplicateStart = await game.call('TEST_GAME', wallet(ALICE, {
  Action: 'Battle.Start', Difficulty: '1', StartId: 'start-one',
}));
assert.equal(duplicateStart.output.battlesRemaining, 3);
assert.equal(duplicateStart.output.battleFleet.reservationId, route.reservationId);
assert.equal(duplicateStart.outbox.open.data, started.outbox.open.data);
console.log('PASS  stable StartId re-emits the same assignment without a second reservation');

// Even another manifest worker cannot finalize an assignment it does not own,
// and multiple distinct RSA identities are never resolved by table order.
const forgedOpened = JSON.parse(started.outbox.open.data);
forgedOpened.openedId = 'forged-opened';
forgedOpened.workerId = route.workerId;
const wrongNotice = processNotice(
  WRONG_WORKER, 'Battle.Fleet.Opened', JSON.stringify(forgedOpened),
);
assert.equal(wrongNotice.fromProcess, WRONG_WORKER);
const wrong = await game.call('TEST_GAME', wrongNotice);
assert.match(String(wrong.output?.error), /wrong worker process/, JSON.stringify(wrong));
const ambiguous = await game.call('TEST_GAME', processNotice(
  WORKER, 'Battle.Fleet.Opened', JSON.stringify(forgedOpened), { secondSigner: WRONG_WORKER },
));
assert.match(String(ambiguous.output?.error), /Untrusted battle worker/, JSON.stringify(ambiguous));
console.log('PASS  wrong-worker and ambiguous-RSA notices fail closed');

const opened = await worker.call('TEST_WORKER', {
  kind: 'process', fromProcess: GAME,
  tags: { Action: started.outbox.open.action },
  data: started.outbox.open.data,
  battleId: route.battleId,
  timestamp: at(),
});
assert.equal(opened.output.id, route.battleId);
assert.equal(opened.outbox.opened.action, 'Battle.Fleet.Opened');
// Lose the first Opened notice, then replay the authority-owned immutable
// assignment. The worker must return the same stable Opened tuple.
const retryOpen = await game.call('TEST_GAME', wallet(OWNER, {
  Action: 'Admin.RetryFleetOpen', ReservationId: route.reservationId,
}));
assert.equal(retryOpen.outbox.open.data, started.outbox.open.data);
const reopened = await worker.call('TEST_WORKER', {
  kind: 'process', fromProcess: GAME,
  tags: { Action: retryOpen.outbox.open.action }, data: retryOpen.outbox.open.data,
  battleId: route.battleId, timestamp: at(),
});
assert.equal(reopened.output.duplicate, true);
assert.equal(reopened.outbox.opened.data, opened.outbox.opened.data);
const rebuildsBeforeOpened = Number(await game.eval('return TEST_POISON_DERIVED()'));
const markedOpen = await game.call('TEST_GAME', processNotice(
  WORKER, reopened.outbox.opened.action, reopened.outbox.opened.data,
));
assert.equal(markedOpen.output.battleFleet.status, 'battling');
assert.equal(markedOpen.player.battleFleet.workerProcessId, WORKER);
assert.equal(markedOpen.telemetryFullRebuilds, rebuildsBeforeOpened);
assert.notEqual(markedOpen.derived.users, 'SENTINEL');
assert.equal(markedOpen.derived.factions, 'SENTINEL');
assert.equal(markedOpen.derived.market, 'SENTINEL');
console.log('PASS  lost Opened is replayed exactly and its narrow publish path avoids a full rebuild');

const callsBeforeRounds = game.sequence;
let battle = opened.battle;
let terminal;
for (let guard = 0; guard < 60 && battle.status !== 'ended'; guard++) {
  const move = Object.entries(battle.challenger.moves || {})
    .find(([, value]) => Number(value.count || 0) > 0)?.[0] ?? 'struggle';
  const attacked = await worker.call('TEST_WORKER', {
    kind: 'wallet', from: ALICE,
    tags: {
      Action: 'Battle.Attack', BattleId: route.battleId, Ticket: route.ticket,
      ActionId: `attack-${guard}`, Round: String(battle.round), Move: move,
    },
    battleId: route.battleId,
    timestamp: at(),
  });
  battle = attacked.battle;
  if (battle.status === 'ended') terminal = attacked;
  else assert.equal(attacked.outbox, undefined, 'non-terminal worker round emitted an outbox');
}
assert(terminal?.outbox?.settlement, 'battle did not produce terminal settlement');
assert.equal(game.sequence, callsBeforeRounds, 'worker rounds touched game authority');
console.log('PASS  direct rounds bypass game and only the terminal round emits an outbox');

// Simulate a lost terminal-slot push. The owner retry is deterministic and
// produces the original settlement, which is then delivered once.
const terminalPayload = JSON.parse(terminal.outbox.settlement.data);
const settlementRetry = await worker.call('TEST_WORKER', wallet(OWNER, {
  Action: 'Fleet.Settlement.Retry', SettlementId: terminalPayload.settlementId,
}));
assert.equal(settlementRetry.outbox.settlement.data, terminal.outbox.settlement.data);
const rebuildsBeforeSettle = Number(await game.eval('return TEST_POISON_DERIVED()'));
const settled = await game.call('TEST_GAME', processNotice(
  WORKER, settlementRetry.outbox.settlement.action, settlementRetry.outbox.settlement.data,
));
assert.equal(settled.output.activeBattleId, undefined);
assert.equal(settled.output.battlesRemaining, 3);
assert.equal(settled.outbox.acknowledgement.action, 'Fleet.Settlement.Ack');
assert.equal(settled.telemetryFullRebuilds, rebuildsBeforeSettle);
assert.notEqual(settled.derived.users, 'SENTINEL');
assert.notEqual(settled.derived.factions, 'SENTINEL');
assert.notEqual(settled.derived.metrics, 'SENTINEL');
assert.equal(settled.derived.market, 'SENTINEL');
const winsAfter = settled.output.wins;
const lossesAfter = settled.output.losses;
const replay = await game.call('TEST_GAME', processNotice(
  WORKER, terminal.outbox.settlement.action, terminal.outbox.settlement.data,
));
assert.equal(replay.output.wins, winsAfter);
assert.equal(replay.output.losses, lossesAfter);
assert.equal(replay.output.fleetDuplicate, true);
console.log('PASS  authority applies settlement reward exactly once and acknowledges replay');

// Operators can replay the exact authoritative ACK without recreating any
// outcome. The worker then confirms durable receipt, the game marks its compact
// tombstone delivered, and only then releases the worker's retained receipt.
const retryAck = await game.call('TEST_GAME', wallet(OWNER, {
  Action: 'Admin.RetryFleetAck', ReservationId: route.reservationId,
}));
assert.equal(retryAck.outbox.acknowledgement.action, 'Fleet.Settlement.Ack');
assert.equal(
  retryAck.outbox.acknowledgement.reference,
  settled.outbox.acknowledgement.reference,
);
assert.equal(retryAck.outbox.acknowledgement.target, WORKER);
const workerAcked = await worker.call('TEST_WORKER', {
  kind: 'process', fromProcess: GAME,
  tags: retryAck.outbox.acknowledgement,
  battleId: route.battleId,
  timestamp: at(),
});
assert.equal(workerAcked.output.acknowledged, true);
assert.equal(workerAcked.outbox.confirmation.action, 'Battle.Fleet.FinalAcked');
const rebuildsBeforeFinalAck = Number(await game.eval('return TEST_POISON_DERIVED()'));
const gameConfirmed = await game.call('TEST_GAME', processNotice(
  WORKER, workerAcked.outbox.confirmation.action, workerAcked.outbox.confirmation.data,
));
assert.equal(gameConfirmed.output.confirmed, true);
assert.equal(gameConfirmed.output.duplicate, false);
assert.equal(gameConfirmed.outbox.release.action, 'Fleet.FinalAcked.Release');
assert.equal(
  gameConfirmed.outbox.release.ConfirmationId,
  workerAcked.output.confirmationId,
);
assert.equal(
  gameConfirmed.fleetops.finals.find(
    (row) => row.reservationId === route.reservationId,
  )?.deliveryConfirmed,
  true,
);
assert.equal(gameConfirmed.telemetryFullRebuilds, rebuildsBeforeFinalAck);
assert.equal(gameConfirmed.derived.factions, 'SENTINEL');
assert.equal(gameConfirmed.derived.market, 'SENTINEL');

// Lose the first Release after the authority confirmed delivery. Replaying the
// exact ACK regenerates FinalAcked and therefore the same Release.
const retryConfirmedAck = await game.call('TEST_GAME', wallet(OWNER, {
  Action: 'Admin.RetryFleetAck', ReservationId: route.reservationId,
}));
const retryConfirmedAtWorker = await worker.call('TEST_WORKER', {
  kind: 'process', fromProcess: GAME, tags: retryConfirmedAck.outbox.acknowledgement,
  battleId: route.battleId, timestamp: at(),
});
assert.equal(retryConfirmedAtWorker.output.duplicate, true);
const retryConfirmedAtGame = await game.call('TEST_GAME', processNotice(
  WORKER, retryConfirmedAtWorker.outbox.confirmation.action,
  retryConfirmedAtWorker.outbox.confirmation.data,
));
assert.equal(retryConfirmedAtGame.output.duplicate, true);
assert.equal(retryConfirmedAtGame.outbox.release.ConfirmationId,
  gameConfirmed.outbox.release.ConfirmationId);
const workerReleased = await worker.call('TEST_WORKER', {
  kind: 'process', fromProcess: GAME,
  tags: retryConfirmedAtGame.outbox.release,
  battleId: route.battleId,
  timestamp: at(),
});
assert.equal(workerReleased.output.released, true);
assert.equal(workerReleased.output.duplicate, false);
const replayWorkerAck = await worker.call('TEST_WORKER', {
  kind: 'process', fromProcess: GAME,
  tags: settled.outbox.acknowledgement,
  battleId: route.battleId,
  timestamp: at(),
});
assert.equal(replayWorkerAck.output.duplicate, true);
const replayConfirmation = await game.call('TEST_GAME', processNotice(
  WORKER,
  replayWorkerAck.outbox.confirmation.action,
  replayWorkerAck.outbox.confirmation.data,
));
assert.equal(replayConfirmation.output.duplicate, true);
const releaseReplay = await worker.call('TEST_WORKER', {
  kind: 'process', fromProcess: GAME,
  tags: gameConfirmed.outbox.release,
  battleId: route.battleId,
  timestamp: at(),
});
assert.equal(releaseReplay.output.duplicate, true);
console.log('PASS  stable ACK retry recovers a lost Release and completes exactly once');

const nextAfterFinal = await game.call('TEST_GAME', wallet(ALICE, {
  Action: 'Battle.Start', Difficulty: '1', StartId: 'start-after-final-cleanup',
}));
assert.equal(nextAfterFinal.output.battlesRemaining, 2);
assert.notEqual(nextAfterFinal.output.battleFleet.reservationId, route.reservationId);
assert.equal(nextAfterFinal.outbox.open.action, 'Battle.Open');
console.log('PASS  trusted terminal cleanup permits the next fleet reservation');

// Fresh authority/worker pair: deliver a valid Open after its ticket expires.
// The worker's stable rejection returns the one reserved session credit once.
timestamp += 100000;
const rejectedGame = await new LocalLua(id('REJECTGAME', 'r'), gameSource(manifest)).init();
const rejectedWorker = await new LocalLua(id('REJECTWORK', 'q'), workerSource).init();
await seedArena(rejectedGame);
const pending = await rejectedGame.call('TEST_GAME', wallet(ALICE, {
  Action: 'Battle.Start', Difficulty: '1', StartId: 'start-expired',
}));
timestamp += 11 * 60 * 1000;
const rejected = await rejectedWorker.call('TEST_WORKER', {
  kind: 'process', fromProcess: GAME,
  tags: { Action: pending.outbox.open.action },
  data: pending.outbox.open.data,
  battleId: pending.output.battleFleet.battleId,
  timestamp: at(),
});
assert(rejected.outbox.rejection);
// Lose the rejection, replay the immutable Open, and deliver the worker's
// stable duplicate rejection instead.
const rejectedRoute = pending.output.battleFleet;
const retryRejectedOpen = await rejectedGame.call('TEST_GAME', wallet(OWNER, {
  Action: 'Admin.RetryFleetOpen', ReservationId: rejectedRoute.reservationId,
}));
assert.equal(retryRejectedOpen.outbox.open.data, pending.outbox.open.data);
const rejectedAgainAtWorker = await rejectedWorker.call('TEST_WORKER', {
  kind: 'process', fromProcess: GAME,
  tags: { Action: retryRejectedOpen.outbox.open.action },
  data: retryRejectedOpen.outbox.open.data,
  battleId: rejectedRoute.battleId, timestamp: at(),
});
assert.equal(rejectedAgainAtWorker.output.duplicate, true);
assert.equal(rejectedAgainAtWorker.outbox.rejection.data, rejected.outbox.rejection.data);
const rebuildsBeforeRejected = Number(await rejectedGame.eval('return TEST_POISON_DERIVED()'));
const refunded = await rejectedGame.call('TEST_GAME', processNotice(
  WORKER, rejectedAgainAtWorker.outbox.rejection.action,
  rejectedAgainAtWorker.outbox.rejection.data,
));
assert.equal(refunded.output.battlesRemaining, 4);
assert.equal(refunded.output.activeBattleId, undefined);
assert.equal(refunded.outbox.acknowledgement.action, 'Fleet.OpenRejected.Ack');
assert.equal(refunded.telemetryFullRebuilds, rebuildsBeforeRejected);
assert.notEqual(refunded.derived.users, 'SENTINEL');
assert.equal(refunded.derived.factions, 'SENTINEL');
const refundedAgain = await rejectedGame.call('TEST_GAME', processNotice(
  WORKER, rejected.outbox.rejection.action, rejected.outbox.rejection.data,
));
assert.equal(refundedAgain.output.battlesRemaining, 4);
await completeFinalHandshake({
  game: rejectedGame,
  worker: rejectedWorker,
  terminal: refunded,
  route: rejectedRoute,
  kind: 'rejection',
  acknowledgementAction: 'Fleet.OpenRejected.Ack',
});
console.log('PASS  lost OpenRejected refunds once and completes its final receipt handshake');

// Player leave is a cancellation request, not a local refund. Once Opened, it
// is a forfeit: the reserved attempt remains consumed and the authority applies
// the loss plan exactly once after the worker's trusted Cancelled notice.
const cancelGame = await new LocalLua(id('CANCELGAME', 'c'), gameSource(manifest)).init();
const cancelWorker = await new LocalLua(id('CANCELWORK', 'v'), workerSource).init();
await seedArena(cancelGame);
const cancelStart = await cancelGame.call('TEST_GAME', wallet(ALICE, {
  Action: 'Battle.Start', Difficulty: '1', StartId: 'start-cancel',
}));
const cancelRoute = cancelStart.output.battleFleet;
const cancelOpen = await cancelWorker.call('TEST_WORKER', {
  kind: 'process', fromProcess: GAME, tags: { Action: 'Battle.Open' },
  data: cancelStart.outbox.open.data, battleId: cancelRoute.battleId, timestamp: at(),
});
await cancelGame.call('TEST_GAME', processNotice(
  WORKER, cancelOpen.outbox.opened.action, cancelOpen.outbox.opened.data,
));
const leavePending = await cancelGame.call('TEST_GAME', wallet(ALICE, { Action: 'Battle.Leave' }));
assert.equal(leavePending.output.battlesRemaining, 3);
assert.equal(leavePending.output.battleFleet.status, 'cancel-pending');
assert.equal(leavePending.outbox.cancellation.action, 'Battle.Cancel');
const cancelledAtWorker = await cancelWorker.call('TEST_WORKER', {
  kind: 'process', fromProcess: GAME,
  tags: leavePending.outbox.cancellation,
  battleId: cancelRoute.battleId,
  timestamp: at(),
});
assert(cancelledAtWorker.outbox.cancellation);
const lossBeforeForfeit = leavePending.output.losses;
const expBeforeForfeit = leavePending.output.monster.exp;
const rebuildsBeforeCancelled = Number(await cancelGame.eval('return TEST_POISON_DERIVED()'));
const cancelledAtGame = await cancelGame.call('TEST_GAME', processNotice(
  WORKER, cancelledAtWorker.outbox.cancellation.action,
  cancelledAtWorker.outbox.cancellation.data,
));
assert.equal(cancelledAtGame.output.battlesRemaining, 3);
assert.equal(cancelledAtGame.output.activeBattleId, undefined);
assert.equal(cancelledAtGame.output.losses, lossBeforeForfeit + 1);
assert.equal(cancelledAtGame.output.monster.exp, expBeforeForfeit + 1);
assert.equal(cancelledAtGame.output.fleetCancelled.disposition, 'forfeit');
assert.equal(cancelledAtGame.telemetryFullRebuilds, rebuildsBeforeCancelled);
assert.notEqual(cancelledAtGame.derived.users, 'SENTINEL');
assert.notEqual(cancelledAtGame.derived.factions, 'SENTINEL');
assert.notEqual(cancelledAtGame.derived.metrics, 'SENTINEL');
assert.equal(cancelledAtGame.derived.market, 'SENTINEL');
const cancelledReplay = await cancelGame.call('TEST_GAME', processNotice(
  WORKER, cancelledAtWorker.outbox.cancellation.action,
  cancelledAtWorker.outbox.cancellation.data,
));
assert.equal(cancelledReplay.output.battlesRemaining, 3);
assert.equal(cancelledReplay.output.losses, lossBeforeForfeit + 1);
assert.equal(cancelledReplay.output.monster.exp, expBeforeForfeit + 1);
assert.equal(cancelledReplay.output.fleetDuplicate, true);
await completeFinalHandshake({
  game: cancelGame,
  worker: cancelWorker,
  terminal: cancelledAtGame,
  route: cancelRoute,
  kind: 'cancellation',
  acknowledgementAction: 'Fleet.Cancellation.Ack',
});
console.log('PASS  opened player leave forfeits once and completes its final receipt handshake');

const recoveryGame = await new LocalLua(id('RECOVERY', 'z'), gameSource(manifest)).init();
await seedArena(recoveryGame);
const recoveryStart = await recoveryGame.call('TEST_GAME', wallet(ALICE, {
  Action: 'Battle.Start', Difficulty: '1', StartId: 'start-recovery',
}));
const recoveryRoute = recoveryStart.output.battleFleet;
const unauthorizedForce = await recoveryGame.call('TEST_GAME', wallet(ALICE, {
  Action: 'Admin.ForceResolveFleetBattle',
}, JSON.stringify({
  reservationId: recoveryRoute.reservationId, battleId: recoveryRoute.battleId,
  playerId: ALICE, workerId: recoveryRoute.workerId,
  workerProcessId: recoveryRoute.workerProcessId,
  resolutionId: 'resolution-1', reason: 'worker-inspected-dead', evidence: 'incident-123',
})));
assert.equal(unauthorizedForce.output.error, 'Not authorised');
const forcePayload = {
  reservationId: recoveryRoute.reservationId, battleId: recoveryRoute.battleId,
  playerId: ALICE, workerId: recoveryRoute.workerId,
  workerProcessId: recoveryRoute.workerProcessId,
  resolutionId: 'resolution-1', reason: 'worker-inspected-dead', evidence: 'incident-123',
};
const forced = await recoveryGame.call('TEST_GAME', wallet(OWNER, {
  Action: 'Admin.ForceResolveFleetBattle',
}, JSON.stringify(forcePayload)));
assert.equal(forced.output.battlesRemaining, 4);
const forcedReplay = await recoveryGame.call('TEST_GAME', wallet(OWNER, {
  Action: 'Admin.ForceResolveFleetBattle',
}, JSON.stringify(forcePayload)));
assert.equal(forcedReplay.output.battlesRemaining, 4);
assert.equal(forcedReplay.output.fleetDuplicate, true);
console.log('PASS  owner-only evidence-backed force resolution is idempotent');

const expiryGame = await new LocalLua(id('EXPIRY', 'e'), gameSource(manifest)).init();
const expiryWorker = await new LocalLua(id('EXPWORK', 'h'), workerSource).init();
await seedArena(expiryGame);
const expiryStart = await expiryGame.call('TEST_GAME', wallet(ALICE, {
  Action: 'Battle.Start', Difficulty: '1', StartId: 'start-expiry',
}));
const expiryRoute = expiryStart.output.battleFleet;
const expiryOpened = await expiryWorker.call('TEST_WORKER', {
  kind: 'process', fromProcess: GAME, tags: { Action: 'Battle.Open' },
  data: expiryStart.outbox.open.data, battleId: expiryRoute.battleId, timestamp: at(),
});
await expiryGame.call('TEST_GAME', processNotice(
  WORKER, expiryOpened.outbox.opened.action, expiryOpened.outbox.opened.data,
));
timestamp += 11 * 60 * 1000;
const expiry = await expiryGame.call('TEST_GAME', wallet(OWNER, {
  Action: 'Admin.ExpireFleetBattle',
  ReservationId: expiryRoute.reservationId,
  Reason: 'overdue-open',
}));
assert.equal(expiry.output.battleFleet.status, 'cancel-pending');
assert.equal(expiry.outbox.cancellation.action, 'Battle.Expire');
assert.equal(expiry.output.battlesRemaining, 3);
const expiredAtWorker = await expiryWorker.call('TEST_WORKER', {
  kind: 'process', fromProcess: GAME, tags: expiry.outbox.cancellation,
  battleId: expiryRoute.battleId, timestamp: at(),
});
const expiredAtGame = await expiryGame.call('TEST_GAME', processNotice(
  WORKER, expiredAtWorker.outbox.cancellation.action,
  expiredAtWorker.outbox.cancellation.data,
));
assert.equal(expiredAtGame.output.battlesRemaining, 3);
assert.equal(expiredAtGame.output.losses, 1);
assert.equal(expiredAtGame.output.fleetCancelled.disposition, 'forfeit');
const expiredReplay = await expiryGame.call('TEST_GAME', processNotice(
  WORKER, expiredAtWorker.outbox.cancellation.action,
  expiredAtWorker.outbox.cancellation.data,
));
assert.equal(expiredReplay.output.battlesRemaining, 3);
assert.equal(expiredReplay.output.losses, 1);
await completeFinalHandshake({
  game: expiryGame,
  worker: expiryWorker,
  terminal: expiredAtGame,
  route: expiryRoute,
  kind: 'cancellation',
  acknowledgementAction: 'Fleet.Cancellation.Ack',
});
console.log('PASS  opened operational expiry forfeits once and completes its final receipt handshake');

// If Cancel reaches a worker before its original Open, it initially has no
// record. RetryFleetOpen carries the same Open Data plus the authority's stable
// cancel intent; the worker terminalizes it without ever emitting Opened, so
// the trusted cancellation is a genuine pre-open refund and late replay cannot
// create an attackable battle.
const lostOpenGame = await new LocalLua(id('LOSTOPEN', 'l'), gameSource(manifest)).init();
const lostOpenWorker = await new LocalLua(id('LOSTWORK', 'k'), workerSource).init();
await seedArena(lostOpenGame);
const lostOpenStart = await lostOpenGame.call('TEST_GAME', wallet(ALICE, {
  Action: 'Battle.Start', Difficulty: '1', StartId: 'start-lost-before-cancel',
}));
const lostOpenRoute = lostOpenStart.output.battleFleet;
const lostOpenLeave = await lostOpenGame.call('TEST_GAME', wallet(ALICE, {
  Action: 'Battle.Leave',
}));
const missingCancel = await lostOpenWorker.call('TEST_WORKER', {
  kind: 'process', fromProcess: GAME, tags: lostOpenLeave.outbox.cancellation,
  battleId: lostOpenRoute.battleId, timestamp: at(),
});
assert.equal(missingCancel.output.error, 'Battle not found');
const recoverLostOpen = await lostOpenGame.call('TEST_GAME', wallet(OWNER, {
  Action: 'Admin.RetryFleetOpen', ReservationId: lostOpenRoute.reservationId,
}));
assert.equal(recoverLostOpen.outbox.open.data, lostOpenStart.outbox.open.data);
assert.equal(recoverLostOpen.outbox.open['cancel-id'], lostOpenLeave.outbox.cancellation.cancelid);
const preOpenCancelled = await lostOpenWorker.call('TEST_WORKER', {
  kind: 'process', fromProcess: GAME, tags: recoverLostOpen.outbox.open,
  data: recoverLostOpen.outbox.open.data,
  battleId: lostOpenRoute.battleId, timestamp: at(),
});
assert.equal(preOpenCancelled.output.preOpen, true);
assert.equal(preOpenCancelled.outbox.opened, undefined);
assert.equal(preOpenCancelled.outbox.cancellation.action, 'Battle.Fleet.Cancelled');
const preOpenRefunded = await lostOpenGame.call('TEST_GAME', processNotice(
  WORKER, preOpenCancelled.outbox.cancellation.action,
  preOpenCancelled.outbox.cancellation.data,
));
assert.equal(preOpenRefunded.output.battlesRemaining, 4);
assert.equal(preOpenRefunded.output.losses, 0);
assert.equal(preOpenRefunded.output.fleetCancelled.disposition, 'refund');
const lateOpenReplay = await lostOpenWorker.call('TEST_WORKER', {
  kind: 'process', fromProcess: GAME, tags: recoverLostOpen.outbox.open,
  data: recoverLostOpen.outbox.open.data,
  battleId: lostOpenRoute.battleId, timestamp: at(),
});
assert.equal(lateOpenReplay.output.duplicate, true);
assert.equal(lateOpenReplay.outbox.opened, undefined);
assert.equal(lateOpenReplay.outbox.cancellation.data,
  preOpenCancelled.outbox.cancellation.data);
await completeFinalHandshake({
  game: lostOpenGame,
  worker: lostOpenWorker,
  terminal: preOpenRefunded,
  route: lostOpenRoute,
  kind: 'cancellation',
  acknowledgementAction: 'Fleet.Cancellation.Ack',
});
console.log('PASS  pre-open cancel refunds once and completes its final receipt handshake');

console.log('\nfleet integration contracts passed, 0 failed');
