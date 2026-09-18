#!/usr/bin/env node
/**
 * Records the SwarmMonitor fixture.
 *
 *   node src/screens/admin/swarm/fixture/generate.mjs
 *
 * Writes a seeded, synthetic eight-minute event log for 100 wallets in event
 * schema v1 (REDESIGN.md §6.2), replays it through the real `aggregate.mjs`,
 * and saves exactly what `GET /snapshot` would answer (plus `live`). Nothing here talks to a node: every pid is a `TEST-fixture-*`
 * placeholder, and the numbers are shaped to look like a run, not measured.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createAggregator } from '../../../../../../../backend/native/swarm/aggregate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUN = '2026-09-16T14-00-00-000Z';
const START = Date.UTC(2026, 8, 16, 14, 0, 0);
const DURATION_MS = 8 * 60_000;
const WALLETS = 100;

let seed = 0x5eed1e55;
const random = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const between = (lo, hi) => lo + (hi - lo) * random();
const int = (lo, hi) => Math.floor(between(lo, hi + 1));
const pick = (list) => list[Math.floor(random() * list.length)];
const lognormal = (median, spread = 0.35) => {
  const u = Math.max(1e-9, random());
  const v = random();
  return median * Math.exp(spread * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v));
};

const pid = (name) => `TEST-fixture-${name}`.padEnd(43, '0');
const PIDS = {
  game: pid('game'),
  rune: pid('rune'),
  quote: pid('quote'),
  'venue.internal': pid('venue-internal'),
  'venue.external': pid('venue-external'),
  battle: [pid('battle-1'), pid('battle-2'), pid('battle-3')],
  hunt: [pid('hunt-1'), pid('hunt-2'), pid('hunt-3')],
};

/** Median round trip by role; the authority slows as the run goes on. */
function roundTrip(role, elapsedMs) {
  const minutes = elapsedMs / 60_000;
  switch (role) {
    case 'game': return lognormal(7_000 + 900 * minutes);
    case 'battle.worker': return lognormal(1_400);
    case 'hunt.worker': return lognormal(1_700 + 60 * minutes);
    case 'venue.internal': return lognormal(9_500 + 400 * minutes, 0.45);
    case 'venue.external': return lognormal(4_200, 0.4);
    default: return lognormal(650, 0.3);
  }
}

const PROFILE_SHARE = [
  ['grinder', 25], ['ranked', 15], ['hunter', 25], ['merchant', 15], ['caretaker', 10], ['collector', 10],
];
const PLAN = {
  grinder: [['battle.start', 'game', 'P2E_BATTLE', 3], ['battle.attack', 'battle.worker', 'P2E_BATTLE', 6], ['monster.feed', 'game', 'HOME', 1], ['battle.begin', 'game', 'ARENA_SESSION', 1]],
  ranked: [['battle.matchmake', 'game', 'RATED_QUEUE', 2], ['battle.attack', 'game', 'RATED_BATTLE', 4], ['battle.start', 'game', 'P2E_BATTLE', 1], ['battle.attack', 'battle.worker', 'P2E_BATTLE', 3]],
  hunter: [['hunt.search', 'hunt.worker', 'HUNT', 6], ['hunt.attack', 'hunt.worker', 'HUNT', 3], ['hunt.capture', 'hunt.worker', 'HUNT_SETTLING', 1], ['hunt.begin', 'game', 'HUNT', 1]],
  merchant: [['order.place', 'venue.internal', 'TRADE', 3], ['order.place', 'venue.external', 'TRADE', 2], ['order.cancel', 'venue.internal', 'TRADE', 1], ['transfer', 'rune', 'TRADE', 1], ['transfer', 'quote', 'TRADE', 1], ['venue.send', 'game', 'TRADE', 1], ['withdraw', 'venue.internal', 'TRADE', 0.5], ['withdraw', 'venue.external', 'TRADE', 0.3], ['rune.withdraw', 'game', 'TRADE', 0.4], ['burn', 'rune', 'TRADE', 0.3], ['hunt.search', 'hunt.worker', 'HUNT', 2]],
  caretaker: [['monster.play', 'game', 'PLAY_WAIT', 2], ['monster.quest', 'game', 'QUEST_WAIT', 2], ['monster.claim', 'game', 'HOME', 2], ['daily.claim', 'game', 'HOME', 1]],
  collector: [['lootbox.open', 'game', 'HOME', 3], ['market.buy', 'game', 'HOME', 1], ['monster.setactive', 'game', 'HOME', 1], ['transfer', 'rune', 'HOME', 1], ['hunt.search', 'hunt.worker', 'HUNT', 3]],
};
const INTERVAL_MUL = { caretaker: 1.5 };
/** The companion status a brain state implies, for the acct row's `activity`. */
const ACTIVITY = {
  HOME: 'Home', TRADE: 'Home', RATED_QUEUE: 'Home', PLAY_WAIT: 'Play', QUEST_WAIT: 'Quest',
  ARENA_SESSION: 'Battle', P2E_BATTLE: 'Battle', RATED_BATTLE: 'Battle', HUNT: 'Hunt', HUNT_SETTLING: 'Hunt',
};
const COMPANIONS = [['Cindermaw', 'fire'], ['Brookling', 'water'], ['Zephyrkin', 'air'], ['Pebblehorn', 'rock']];
const MARKETS = ['fire_berry/gold', 'water_berry/gold', 'scroll/gold'];
/** Quote asset atoms per whole unit: internal Gold 100, external Relic 1e6. */
const QUOTE_SCALE = { internal: 100, external: 1_000_000 };

/**
 * The pinned custody fields (`flow`, `asset`, `qty` in whole units, `to` on a
 * peer send) for a write that moves value, and the intent the trader logs.
 * A collector's Rune transfer goes to another wallet; a merchant's is a deposit.
 */
function custody(action, pidRole, profile, index) {
  const deposit = (flow, asset, qty) => ({ intent: `trade.deposit.${asset}`, flow, asset, qty });
  if (action === 'venue.send') return deposit('game->venue', pick(['scroll', 'gold', 'fire_berry', 'water_berry']), int(1, 12));
  if (action === 'withdraw' && pidRole === 'venue.internal') return { intent: 'trade.close.withdraw', flow: 'venue->game', asset: pick(['scroll', 'gold']), qty: int(1, 8) };
  if (action === 'withdraw') return { intent: 'trade.close.withdraw', flow: 'venue->token', asset: 'rune', qty: int(1, 6) };
  if (action === 'rune.withdraw') return { intent: 'trade.bridge.rune-out', flow: 'game->token', asset: 'rune', qty: int(2, 10) };
  if (action === 'burn') return { intent: 'trade.close.bridge-rune-in', flow: 'token->game', asset: 'rune', qty: int(1, 6) };
  if (action === 'transfer' && pidRole === 'quote') return deposit('token->venue', 'relic', int(1, 20));
  if (action === 'transfer' && profile === 'merchant') return deposit('token->venue', 'rune', int(1, 8));
  if (action === 'transfer') {
    const peer = (index + int(1, WALLETS - 1)) % WALLETS;
    return { intent: 'gift.peer', flow: 'wallet->wallet', asset: 'rune', qty: int(1, 5), to: `burner-${String(peer + 1).padStart(2, '0')}` };
  }
  return { intent: action };
}

const weighted = (plan) => {
  const total = plan.reduce((sum, row) => sum + row[3], 0);
  let roll = random() * total;
  for (const row of plan) {
    roll -= row[3];
    if (roll <= 0) return row;
  }
  return plan[plan.length - 1];
};

const profiles = PROFILE_SHARE.flatMap(([name, count]) => Array(count).fill(name));
for (let i = profiles.length - 1; i > 0; i -= 1) {
  const j = Math.floor(random() * (i + 1));
  [profiles[i], profiles[j]] = [profiles[j], profiles[i]];
}

const events = [];
const end = START + DURATION_MS;
const resolvedByPid = new Map();

for (let index = 0; index < WALLETS; index += 1) {
  const wallet = `burner-${String(index + 1).padStart(2, '0')}`;
  const profile = profiles[index];
  const lane = index % 3;
  const plan = PLAN[profile];
  const meanGap = 20_000 * (INTERVAL_MUL[profile] ?? between(0.7, 1.2));
  const account = {
    level: int(1, 6), exp: int(0, 40), moves: 3, roster: int(1, 4), collection: int(0, 3),
    energy: int(40, 100), happiness: int(40, 100), gold: int(400, 600), runes: int(40, 60),
    scrolls: int(8, 12), wins: 0, losses: 0, rating: 1000, quests: 0, captures: 0,
    openOrders: 0, pnlGold: 0, msgs: 0, errs: 0, tokensWasted: 0,
  };
  let state = 'HOME';
  let free = START + between(0, 20_000);
  let nextAcct = free + between(0, 60_000);
  let t = free;
  const [monsterName, element] = COMPANIONS[index % COMPANIONS.length];
  const snapshotAcct = (at) => {
    const activity = ACTIVITY[state] ?? 'Home';
    events.push({
      v: 1, k: 'acct', at: Math.round(at), wallet, state, level: account.level, exp: account.exp, moves: account.moves,
      pendingMove: account.level % 5 === 0 ? 'ember_lash' : null, roster: account.roster, collection: account.collection,
      energy: account.energy, happiness: account.happiness, gold: account.gold, runes: account.runes, scrolls: account.scrolls,
      berries: { fire_berry: int(20, 40), water_berry: int(20, 40), air_berry: int(20, 40), rock_berry: int(20, 40) },
      lootboxes: int(0, 4), wins: account.wins, losses: account.losses, rating: account.rating, quests: account.quests,
      captures: account.captures, openOrders: account.openOrders,
      activity, activityUntil: activity === 'Play' || activity === 'Quest' ? Math.round(at) + 90_000 : null, monsterName, element,
      pnlGold: account.pnlGold, msgs: account.msgs,
      errs: account.errs, tokensWasted: account.tokensWasted,
    });
  };
  snapshotAcct(START + between(0, 2_000));

  while (true) {
    t += -Math.log(Math.max(1e-9, random())) * meanGap;
    const late = t < free;
    if (late) {
      // The previous write is still out: the token banks, or is wasted past three.
      if (random() < 0.08) account.tokensWasted += 1;
      t = free;
    }
    if (t >= end) break;
    const [action, pidRole, nextState] = weighted(plan);
    const target = pidRole === 'battle.worker' ? PIDS.battle[lane]
      : pidRole === 'hunt.worker' ? PIDS.hunt[lane] : PIDS[pidRole];
    const t0 = Math.round(t);
    const roll = random();
    let outcome = 'ok';
    let rtMs = Math.round(roundTrip(pidRole, t0 - START));
    if (roll < 0.03) outcome = 'rejected';
    else if (roll < 0.04) { outcome = 'timeout'; rtMs = 60_000; }
    else if (roll < 0.045) { outcome = 'post-failed'; rtMs = int(150, 400); }
    const t1 = t0 + rtMs;
    const id = `${wallet}:${t0}:${account.msgs + 1}`;
    events.push({ v: 1, k: 'send', at: t0, id, acct: wallet, pid: target, pidRole, verb: action });
    // Still waiting when the recording stops: the send stays open.
    if (t1 > end) break;
    const signMs = int(4, 18);
    const postMs = int(110, 220);
    const pushMs = /capture|order|transfer|send|withdraw|burn/.test(action) && outcome === 'ok' ? int(300, 1_800) : 0;
    const attempts = outcome === 'ok' ? int(1, 3) : 1;
    events.push({
      v: 1, k: 'msg', id, run: RUN, t0, t1, wallet, profile, pid: target, pidRole, action, ...custody(action, pidRole, profile, index), slot: 0,
      bytes: int(400, 1_400), rtMs, signMs, postMs, readMs: Math.max(0, rtMs - signMs - postMs - pushMs), pushMs,
      attempts, late, outcome,
      err: outcome === 'ok' ? null : outcome === 'rejected' ? 'Not enough energy' : outcome,
    });
    account.msgs += 1;
    if (outcome !== 'ok') account.errs += 1;
    resolvedByPid.set(target, [...(resolvedByPid.get(target) ?? []), t1]);
    for (let read = 0; read < attempts; read += 1) {
      const status = random() < 0.02 ? 'html200' : 'ok';
      events.push({
        v: 1, k: 'read', at: t1 - read * 400, wallet, pid: target, pidRole, key: `player-${wallet}`, ms: int(60, 260), status,
      });
    }
    if (outcome === 'ok') {
      if (nextState !== state) {
        events.push({ v: 1, k: 'state', at: t1 + 1, wallet, from: state, to: nextState, reason: `${profile}.utility` });
        state = nextState;
      }
      account.exp += int(1, 8);
      if (account.exp >= 20 + account.level * 4) {
        account.exp = 0;
        account.level += 1;
        account.runes = Math.max(0, account.runes - Math.floor(((account.level) ** 2 + 15) / 16));
      }
      if (action === 'battle.attack' && random() < 0.25) {
        if (random() < 0.6) { account.wins += 1; account.gold += 12; account.rating += 8; } else { account.losses += 1; account.gold -= 10; account.rating -= 8; }
      }
      if (action === 'monster.claim') account.quests += 1;
      if (action === 'hunt.capture') { account.captures += 1; account.collection += 1; account.scrolls -= 1; account.runes -= int(1, 3); }
      if (action === 'order.place') {
        const venue = pidRole === 'venue.internal' ? 'internal' : 'external';
        const market = venue === 'internal' ? pick(MARKETS) : 'rune/relic';
        const side = random() < 0.5 ? 'buy' : 'sell';
        const taker = random() < 0.4;
        // `px` is whole quote units (Gold, or Relic per Rune), `pxAtoms` the venue's raw price.
        const pxAtoms = venue === 'internal' ? int(80, 140) * QUOTE_SCALE.internal : int(400_000, 600_000);
        const px = pxAtoms / QUOTE_SCALE[venue];
        const qty = int(1, 6);
        const filled = taker ? qty : (random() < 0.3 ? int(1, qty) : 0);
        account.openOrders = Math.min(4, Math.max(0, account.openOrders + (taker ? 0 : 1) - (filled ? 1 : 0)));
        account.pnlGold += filled ? int(-12, 18) : 0;
        events.push({
          v: 1, k: 'trade', at: t1 + 2, wallet, venue, market, side, tif: taker ? 'IOC' : 'GTC',
          liq: taker ? 'taker' : 'maker', px, pxAtoms, qty, filled, fillPx: filled ? [px] : [],
          orderId: `TEST-order-${wallet}-${t0}`, reservation: pxAtoms + (side === 'buy' ? 4 : -4), R: pxAtoms,
        });
      }
      if (action === 'order.cancel') account.openOrders = Math.max(0, account.openOrders - 1);
    }
    free = t1;
    while (nextAcct < t1) {
      snapshotAcct(nextAcct);
      nextAcct += between(50_000, 70_000);
    }
  }
}

// Coarse `at-slot` sampler, every 10 s per pid: signed writes plus hops and
// outside traffic, so received minus sent is visibly positive for the authority.
const HOP = { [PIDS.game]: 1.45 };
for (const [target, times] of resolvedByPid) {
  const role = Object.entries(PIDS).find(([, value]) => value === target || (Array.isArray(value) && value.includes(target)))?.[0];
  const pidRole = role === 'battle' ? 'battle.worker' : role === 'hunt' ? 'hunt.worker' : role;
  let atSlot = int(1_000, 40_000);
  for (let at = START + 10_000; at <= end; at += 10_000) {
    const own = times.filter((time) => time > at - 10_000 && time <= at).length;
    const dSlots = Math.round(own * (HOP[target] ?? 1.05)) + (random() < 0.3 ? 1 : 0);
    atSlot += dSlots;
    events.push({ v: 1, k: 'slot', at, pid: target, pidRole, atSlot, dSlots, dtMs: 10_000 });
  }
}

// Published `now` size, every 5 minutes per pid; the authority grows with each wallet it has seen.
for (const [role, value] of Object.entries(PIDS)) {
  const pidRole = role === 'battle' ? 'battle.worker' : role === 'hunt' ? 'hunt.worker' : role;
  for (const target of [value].flat()) {
    let bytes = pidRole === 'game' ? int(380_000, 420_000) : int(4_000, 40_000);
    for (let at = START + 30_000; at <= end; at += 5 * 60_000) {
      events.push({ v: 1, k: 'bytes', at, pid: target, pidRole, bytes });
      bytes += pidRole === 'game' ? int(20_000, 40_000) : int(0, 800);
    }
  }
}

// Pre-clock funding: admin writes, counted apart from play.
for (let index = 0; index < 12; index += 1) {
  const t0 = START - 60_000 + index * 2_000;
  events.push({
    v: 1, k: 'msg', run: RUN, t0, t1: t0 + 1_500, wallet: 'admin', pid: PIDS.game, pidRole: 'admin',
    action: 'Admin.Economy.Fund', rtMs: 1_500, outcome: 'ok',
  });
}

// The clock starts: the run publishes its planned end (a 12-hour run, recorded eight minutes in).
events.push({ v: 1, k: 'run.start', at: START, run: RUN, until: START + 12 * 3_600_000, durationMs: 12 * 3_600_000 });

// A send sorts at its t0, before the msg that closes it.
const time = (rec) => (rec.k === 'msg' ? rec.t1 : rec.at);
events.sort((a, b) => time(a) - time(b));

const aggregator = createAggregator({ run: RUN });
for (const rec of events) aggregator.ingestLine(JSON.stringify(rec));
const snapshot = {
  ...aggregator.snapshot(end),
  live: RUN,
};
fs.writeFileSync(path.join(HERE, 'snapshot.json'), JSON.stringify(snapshot));
console.log(`${events.length} events, ${snapshot.accounts.length} accounts, ${snapshot.processes.length} processes, `
  + `${(fs.statSync(path.join(HERE, 'snapshot.json')).size / 1024).toFixed(0)} KB`);
