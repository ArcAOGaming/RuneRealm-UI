/**
 * soak-game.mjs -- why does a slot get slower as a game process ages?
 *
 * Spawns REAL game processes on a LOCAL node and drives them, then reads the
 * node's own `computed_slot` log (prep_ms / execution_ms / store_ms /
 * computed_slot_size) rather than timing from outside. See
 * `backend/native/SLOT_LATENCY_INVESTIGATION.md` for why external timing
 * cannot answer this: a round trip to the live node is ~172 ms of a ~380 ms
 * slot and swung 2.5x between identical runs.
 *
 *   node soak-game.mjs [--node http://localhost:8734] [--container hb-stock]
 *                      [--grow 600] [--probe 12] [--arms control,reads,wallets,battles]
 *
 * Four arms, each a freshly spawned process so nothing is shared, each probed
 * identically before and after its growth phase. The spec asks for one
 * "matured" arm; four are used because they separate the candidate axes
 * instead of confounding them:
 *
 *   control   probe, nothing, probe        -- the null result
 *   reads     probe, +N User.Info from a
 *             FIXED five wallets, probe    -- O(messages) with no new state
 *   wallets   probe, +N accounts, probe    -- O(wallets ever seen)
 *   battles   probe, +N messages of real
 *             bot battles, probe           -- O(retained battles + turn logs)
 *
 * Growth that shows up in `reads` is per-message accumulation; in `wallets` it
 * is the per-account record; in `battles` it is what a fight leaves behind.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { spawnProcess, sendMessage } from '../../hbclient.mjs';
import { listBurners } from '../../burners.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NATIVE = path.resolve(HERE, '..', '..');
const ROOT = path.resolve(NATIVE, '..', '..');

const opt = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
};
const NODE = (opt('--node', process.env.NODE_URL || 'http://localhost:8734')).replace(/\/$/, '');
const CONTAINER = opt('--container', 'hb-stock');
const GROW = Number(opt('--grow', '600'));
const PROBE = Number(opt('--probe', '12'));
const ARMS = String(opt('--arms', 'control,reads,wallets,battles')).split(',').map((s) => s.trim());
const OUT = path.join(HERE, `soak-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);

const jwk = JSON.parse(fs.readFileSync(
  process.env.HB_WALLET || path.join(ROOT, 'arweave-wallet-DA9qhP25.json'), 'utf8'));

const burners = listBurners();
if (burners.length < 6) throw new Error('need at least 6 burners: node backend/native/burners.mjs make 6');

const read = (name) => fs.readFileSync(path.join(NATIVE, name), 'utf8');

/** The one line the `-nopub` arms remove. `result` IS `base`, so this key
 * survives into every later slot: one per wallet, forever. */
const PUBLISH_PLAYER = 'result["player-" .. tostring(address)] = encodedPlayerView(address)';

/** The one line the `-nogc` arms remove: a full Luerl mark-sweep at the end of
 * every message. It is there for a good reason (see the comment above it in
 * game.lua -- without it nothing is ever collected and the snapshot was 900x),
 * so this variant is a MEASUREMENT of what it costs, not a proposal. */
const COLLECT = 'collectgarbage("collect")';

/** The bundle, patched by a list of one-line variants.
 *
 * Each patch is one line, so an arm pair differs by exactly that line and the
 * difference in its numbers has one cause. None of these is a proposed contract
 * change: `nopub` takes away the client's free unsigned read of its own
 * account, and `nogc` is here to price the collect, not to remove it. */
function bundle(variants) {
  let game = read('game.lua');
  // Only the bare statement at the end of `compute` is patched, which is the
  // LAST occurrence; every earlier one is inside the comment block explaining
  // why it is there. Located at patch time, not once up front: an earlier
  // variant shortens the file, and a stale offset splices into the middle of a
  // token and produces a bundle that spawns and then answers every message with
  // nothing.
  const replaceCollect = (lua) => {
    const at = game.lastIndexOf(COLLECT);
    if (at === -1) throw new Error('the collectgarbage call is not where COLLECT says');
    return `${game.slice(0, at)}${lua}${game.slice(at + COLLECT.length)}`;
  };
  for (const variant of variants) {
    if (variant === 'stock') continue;
    if (variant === 'nopub') {
      if (!game.includes(PUBLISH_PLAYER)) {
        throw new Error('publishPlayer no longer looks like this; update PUBLISH_PLAYER');
      }
      game = game.replace(PUBLISH_PLAYER, 'local _ = encodedPlayerView and address');
      continue;
    }
    if (variant === 'nogc') { game = replaceCollect('local _ = "nogc variant"'); continue; }
    // Amortise the mark-sweep instead of removing it: still a real collect,
    // still the last statement and still outside any pcall, but one message in
    // N pays for N. `GcTick` is an ordinary global and the Luerl state persists
    // in the process message's `priv` between slots, so the counter survives.
    const everyN = /^gc(\d+)$/.exec(variant);
    if (everyN) {
      game = replaceCollect(
        `GcTick = (GcTick or 0) + 1 if GcTick % ${everyN[1]} == 0 then ${COLLECT} end`);
      continue;
    }
    throw new Error(`unknown bundle variant "${variant}"`);
  }
  return [
    read('json.lua'),
    'local C = (function()', read('constants.lua'), 'end)()',
    read('monster-index.generated.lua'),
    'C.PUBLIC_ACCESS = true',
    'local jsonx = (function()', read('jsonenc.lua'), 'end)()',
    'local encode, jsonObject = jsonx.encode, jsonx.object',
    'Battle = (function()', read('battle.lua'), 'end)()',
    'local EconomyEngine = (function()', read('economy.lua'), 'end)()',
    'BattleFleetBootstrapConfig = { enabled = true }',
    'BattleFleetConfig = nil',
    'BattleFleetAuthority = (function()', read('battle-fleet/authority.lua'), 'end)()',
    game,
  ].join('\n');
}

/** Compute a slot and return how long the node took to hand it back.
 *
 * This is the call the client makes and the one that costs 19 s in production;
 * it is also what forces the node to compute, which is what emits the
 * `computed_slot` log line this whole script exists to read. */
async function drain(pid, slot) {
  const t0 = Date.now();
  // The node drops the connection on a long compute -- a 40-minute run died at
  // `UND_ERR_SOCKET: other side closed` after reading 8.8 MB, with every slot
  // it had already computed still sitting in the cache. Retrying costs nothing
  // (a computed slot comes back in ~0.4 s) and a dropped socket is not a result.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    for (const suffix of ['results/output/data', 'results/data']) {
      try {
        const r = await fetch(`${NODE}/${pid}~process@1.0/compute&slot=${slot}/${suffix}`,
          { headers: { accept: 'application/json, text/plain' }, signal: AbortSignal.timeout(900000) });
        const body = await r.text();
        if (r.ok && !/^<!doctype|^<html/i.test(body.trim())) {
          return { ms: Date.now() - t0, body };
        }
      } catch (err) {
        if (attempt === 3) throw err;
      }
    }
  }
  return { ms: Date.now() - t0, body: null };
}

async function send(pid, signer, action, tags = {}, data) {
  const { slot } = await sendMessage({ node: NODE, jwk: signer, process: pid, action, tags, data });
  return Number(slot);
}

/** Schedule and compute one message, timed end to end. */
async function act(pid, signer, action, tags = {}, data) {
  const slot = await send(pid, signer, action, tags, data);
  const { ms, body } = await drain(pid, slot);
  return { slot, ms, body };
}

const FACTIONS = ['Sky Nomads', 'Aqua Guardians', 'Inferno Blades', 'Stone Titans'];

/** Get one wallet from nothing to a player with a companion.
 *
 * Every step is checked, because the failure mode is silent: a wrong faction
 * name leaves `adopted` false, `Monster.Feed` then answers `{"error":"No
 * companion"}` in ~1 ms, and the probe measures the error path instead of a
 * real write. */
async function onboard(pid, burner, i) {
  // No `Monster.Adopt`: joining a faction adopts for you, and calling it after
  // a join answers "You have already adopted".
  const steps = [
    ['User.Login', {}],
    ['Faction.Join', { Faction: FACTIONS[i % FACTIONS.length] }],
  ];
  let last = null;
  for (const [action, tags] of steps) {
    const r = await act(pid, burner.jwk, action, tags);
    if (!r.body || /"error"/.test(r.body)) {
      throw new Error(`onboard ${burner.name}: ${action} -> ${String(r.body).slice(0, 200)}`);
    }
    last = r.body;
  }
  if (!/"adopted":true/.test(last)) {
    throw new Error(`onboard ${burner.name}: adopt did not stick -> ${String(last).slice(0, 200)}`);
  }
}

/** The fixed measurement. Same wallet, same verbs, same count, both arms.
 *
 * `User.Login` rather than a gameplay write: it always succeeds, so the probe
 * cannot silently start measuring an error path as a player's energy, berries
 * or session credits run out mid-run. What a handler DOES is not the axis under
 * test -- the whole published map is marshalled either way. */
async function probeArm(pid, burner, label) {
  const rows = [];
  for (let i = 0; i < PROBE; i += 1) {
    const verb = i % 2 === 0 ? 'User.Info' : 'User.Login';
    const r = await act(pid, burner.jwk, verb);
    rows.push({ label, verb, slot: r.slot, ms: r.ms });
  }
  return rows;
}

/** A realistic session, the way `OVERNIGHT.md`'s run actually looked.
 *
 * The other arms each isolate ONE axis, which is what makes them decisive and
 * also what makes them unrepresentative: the live process reached 19 s with 51
 * accounts and ~5,000 mixed actions, and no single-axis arm reproduces that.
 * This one drives the mix instead — feed, play, quest, the altar, loot boxes and
 * fights, across a real population — so "something accumulates per action" can
 * be reproduced before anything is rewritten to fix it. */
const MIXED_VERBS = [
  'Monster.Feed', 'Monster.Play', 'Monster.Feed', 'Monster.Quest',
  'Daily.Claim', 'Lootbox.Open', 'Monster.Feed', 'User.Info',
];

/** Owner-side top-up so a player can keep entering the arena. */
async function restock(pid, address) {
  await act(pid, jwk, 'Admin.Grant', { PlayerId: address, Item: 'rune', Amount: 8 });
  await act(pid, jwk, 'Admin.SetStats', { PlayerId: address }, JSON.stringify({
    energy: 100, happiness: 100, status: { type: 'Home', since: 0, until_time: 0 },
  }));
}

/** One bot battle, fought to the end. Battles + their turn logs are the first
 * suspect in the brief, so this arm exists to grow exactly that. */
async function fightOne(pid, burner) {
  const begin = await act(pid, burner.jwk, 'Battle.Begin');
  if (!begin.body || /"error"/.test(begin.body)) return { messages: 1, ok: false, why: begin.body };
  let messages = 1;
  for (let session = 0; session < 4; session += 1) {
    const start = await act(pid, burner.jwk, 'Battle.Start');
    messages += 1;
    if (!start.body || /"error"/.test(start.body)) break;
    for (let round = 0; round < 12; round += 1) {
      const hit = await act(pid, burner.jwk, 'Battle.Attack', { Move: String(round % 4) });
      messages += 1;
      if (!hit.body || /"error"/.test(hit.body)) break;
      if (/"status":"ended"/.test(hit.body)) break;
    }
  }
  await act(pid, burner.jwk, 'Battle.Leave');
  return { messages: messages + 1, ok: true };
}

/** 43-character synthetic address; never a real wallet. */
const synth = (n) => `SOAK${String(n).padStart(6, '0')}${'x'.repeat(40)}`.slice(0, 43);

function median(values) {
  const clean = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (!clean.length) return NaN;
  const o = [...clean].sort((a, b) => a - b);
  return o[Math.floor(o.length / 2)];
}

/** When this run started, so `docker logs --since` does not replay days of a
 * long-lived container into a 512 MB buffer. */
const STARTED_AT = new Date().toISOString();

/** Every `computed_slot` line the node logged for these processes. */
function harvest(runs) {
  const logs = spawnSync('docker', ['logs', '--timestamps', '--since', STARTED_AT, CONTAINER],
    { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, shell: process.platform === 'win32' });
  const text = `${logs.stdout || ''}${logs.stderr || ''}`;
  const byArm = new Map(runs.map((r) => [`${r.pid.slice(0, 5)}..${r.pid.slice(-5)}`, r.arm]));
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line.includes('computed_slot,')) continue;
    const m = /proc_id: (\S+?),/.exec(line);
    if (!m || !byArm.has(m[1])) continue;
    const f = (name) => {
      const hit = new RegExp(`${name}: (\\d+)`).exec(line);
      return hit ? Number(hit[1]) : null;
    };
    const action = /action: (\S+)/.exec(line);
    rows.push({
      arm: byArm.get(m[1]),
      slot: f('slot'),
      prep: f('prep_ms'),
      exec: f('execution_ms'),
      store: f('store_ms'),
      size: f('computed_slot_size'),
      action: action ? action[1] : '?',
      at: line.slice(0, 30),
    });
  }
  return rows;
}

function report(runs) {
  const rows = harvest(runs);
  fs.writeFileSync(OUT.replace(/\.json$/, '-slots.json'), `${JSON.stringify(rows, null, 2)}\n`);

  console.log('\n== node-measured, per arm (medians of the node own computed_slot log) ==\n');
  console.log(`${'arm'.padEnd(9)} ${'phase'.padEnd(8)} ${'n'.padStart(5)} ${'prep'.padStart(7)} `
    + `${'exec'.padStart(7)} ${'store'.padStart(7)} ${'total'.padStart(7)} ${'size'.padStart(10)} ${'client'.padStart(9)}`);
  for (const run of runs) {
    const slots = rows.filter((r) => r.arm === run.arm);
    for (const [phase, probe] of [['cold', run.before], ['matured', run.after]]) {
      const want = new Set(probe.map((p) => p.slot));
      const hit = slots.filter((s) => want.has(s.slot));
      console.log(`${run.arm.padEnd(9)} ${phase.padEnd(8)} ${String(hit.length).padStart(5)} `
        + `${String(median(hit.map((h) => h.prep))).padStart(7)} ${String(median(hit.map((h) => h.exec))).padStart(7)} `
        + `${String(median(hit.map((h) => h.store))).padStart(7)} `
        + `${String(median(hit.map((h) => h.prep + h.exec + h.store))).padStart(7)} `
        + `${String(median(hit.map((h) => h.size))).padStart(10)} `
        + `${`${median(probe.map((p) => p.ms))}ms`.padStart(9)}`);
    }
  }

  // Per-action, across everything the arm did. The node stamps `action:` on the
  // log line, so attributing cost to a handler needs no extra instrumentation.
  console.log('\n== per action, all slots, medians ==\n');
  console.log(`${'arm'.padEnd(9)} ${'action'.padEnd(22)} ${'n'.padStart(5)} ${'prep'.padStart(6)} `
    + `${'exec'.padStart(6)} ${'store'.padStart(6)} ${'size'.padStart(10)} ${'d-size/msg'.padStart(11)}`);
  for (const run of runs) {
    const slots = rows.filter((r) => r.arm === run.arm);
    const actions = [...new Set(slots.map((s) => s.action))].sort();
    for (const action of actions) {
      const hit = slots.filter((s) => s.action === action);
      if (hit.length < 3) continue;
      const ordered = [...hit].sort((a, b) => a.slot - b.slot);
      const growth = (ordered[ordered.length - 1].size - ordered[0].size)
        / Math.max(1, ordered[ordered.length - 1].slot - ordered[0].slot);
      console.log(`${run.arm.padEnd(9)} ${action.padEnd(22)} ${String(hit.length).padStart(5)} `
        + `${String(median(hit.map((h) => h.prep))).padStart(6)} ${String(median(hit.map((h) => h.exec))).padStart(6)} `
        + `${String(median(hit.map((h) => h.store))).padStart(6)} `
        + `${String(median(hit.map((h) => h.size))).padStart(10)} ${growth.toFixed(0).padStart(11)}`);
    }
  }

  // The one curve the whole question is about: snapshot size against slot.
  console.log('\n== snapshot size across the run ==\n');
  for (const run of runs) {
    const ordered = rows.filter((r) => r.arm === run.arm).sort((a, b) => a.slot - b.slot);
    if (!ordered.length) continue;
    const first = ordered[0];
    const last = ordered[ordered.length - 1];
    console.log(`${run.arm.padEnd(9)} slot ${String(first.slot).padStart(5)} -> ${String(last.slot).padStart(5)}   `
      + `${(first.size / 1e6).toFixed(2)} MB -> ${(last.size / 1e6).toFixed(2)} MB   `
      + `(+${((last.size - first.size) / Math.max(1, last.slot - first.slot)).toFixed(0)} bytes/slot)`);
  }
}

async function main() {
  const runs = [];
  for (const arm of ARMS) {
    console.log(`\n=== arm: ${arm} ===`);
    process.stdout.write('spawn... ');
    // `<shape>[-<variant>...]`: the same growth phase against a patched bundle,
    // e.g. `wallets-nopub-gc10`. The shape is whatever is left once every
    // recognised variant suffix is taken off, so a suffix the patcher does not
    // know stays part of the shape and fails loudly as an unknown arm, rather
    // than being silently dropped -- `-nogc` was once accepted by the patcher
    // and not by this split, and the arm reported "grew 0" while still printing
    // a full-looking table.
    const parts = arm.split('-');
    const variants = [];
    while (parts.length > 1 && /^(nopub|nogc|gc\d+)$/.test(parts[parts.length - 1])) {
      variants.unshift(parts.pop());
    }
    const shape = parts.join('-');
    const pid = await spawnProcess({
      node: NODE, jwk, lua: bundle(variants), name: `TEST-Rune Realm Soak [${arm}]`,
    });
    console.log(pid);

    const probeWallet = burners[0];
    await onboard(pid, probeWallet, 0);
    const before = await probeArm(pid, probeWallet, 'cold');
    console.log(`cold probe:    median ${median(before.map((r) => r.ms))} ms`);

    const t0 = Date.now();
    let grown = 0;
    if (shape === 'mixed') {
      // The whole burner set, playing. Population and action mix together,
      // which is the combination the live process actually ran.
      const players = burners.slice(1);
      for (let i = 0; i < players.length; i += 1) await onboard(pid, players[i], i + 1);
      for (let n = 0; grown < GROW; n += 1) {
        const who = players[n % players.length];
        // Energy, happiness and berries all run out, and an exhausted player
        // answers errors in a millisecond -- which would quietly turn this into
        // a no-op arm. Top up once per pass over the population.
        if (n % players.length === 0) {
          await restock(pid, who.address);
          await act(pid, jwk, 'Admin.Grant',
            { PlayerId: who.address, Item: 'fire_berry', Amount: 20 });
          grown += 3;
        }
        if (n % (players.length * 6) === players.length * 6 - 1) {
          grown += (await fightOne(pid, who)).messages;
        } else {
          await act(pid, who.jwk, MIXED_VERBS[n % MIXED_VERBS.length]);
          grown += 1;
        }
      }
    } else if (shape === 'wallets') {
      // Accounts, and nothing else. Admin.Unlock MINTS a record per address,
      // so this grows the account table with no other traffic at all.
      const BATCH = 50;
      let last = 0;
      for (let n = 0; n < GROW; n += BATCH) {
        const chunk = [];
        for (let k = 0; k < BATCH && n + k < GROW; k += 1) chunk.push(synth(n + k));
        last = await send(pid, jwk, 'Admin.Unlock', {}, JSON.stringify({ addresses: chunk }));
        grown += chunk.length;
        if ((n / BATCH) % 4 === 3) await drain(pid, last);
      }
      await drain(pid, last);
    } else if (shape === 'reads') {
      // Messages, no new accounts, no new game state. Whatever still grows here
      // grows per MESSAGE -- telemetry, checkins, activity counters.
      const players = burners.slice(1, 6);
      let last = 0;
      for (let n = 0; n < GROW; n += 1) {
        last = await send(pid, players[n % players.length].jwk, 'User.Info');
        grown += 1;
        // Compute periodically so the walk never gets absurdly long and the
        // per-slot log lands steadily rather than in one burst at the end.
        if (n % 25 === 24) await drain(pid, last);
      }
      await drain(pid, last);
    } else if (shape === 'battles') {
      // Real bot battles from five fixed wallets: the first suspect in the
      // brief is retained `Battles` and their per-round turn log.
      const players = burners.slice(1, 6);
      for (let i = 0; i < players.length; i += 1) await onboard(pid, players[i], i + 1);
      while (grown < GROW) {
        for (const who of players) {
          await restock(pid, who.address);
          const r = await fightOne(pid, who);
          grown += r.messages + 2;
          if (!r.ok) console.log(`  battle refused: ${String(r.why).slice(0, 140)}`);
          if (grown >= GROW) break;
        }
      }
    }
    const growMs = Date.now() - t0;
    console.log(`grew ${grown} in ${(growMs / 1000).toFixed(1)}s`);

    const after = await probeArm(pid, probeWallet, 'matured');
    console.log(`matured probe: median ${median(after.map((r) => r.ms))} ms`);

    runs.push({ arm, pid, grown, growMs, before, after });
    report(runs);
    fs.writeFileSync(OUT, `${JSON.stringify({ node: NODE, container: CONTAINER, grow: GROW, probe: PROBE, runs }, null, 2)}\n`);
  }

  report(runs);
  console.log(`\nwrote ${OUT}`);
}

await main();
