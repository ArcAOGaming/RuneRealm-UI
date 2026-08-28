import fs from 'node:fs';
import { parentPort, workerData } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import { installWalletShim, jwkToAddress } from '../ans104.mjs';

if (!parentPort) throw new Error('swarm worker must run in a worker thread');

const jwk = JSON.parse(fs.readFileSync(workerData.walletFile, 'utf8'));
const address = jwkToAddress(jwk);
if (address !== workerData.address) {
  throw new Error(`wallet address changed for ${workerData.profile.wallet}`);
}
installWalletShim(jwk);

const api = await import(
  pathToFileURL(workerData.clientFile).href
    + `?wallet=${encodeURIComponent(workerData.profile.wallet)}&run=${workerData.runId}`
);
const profile = workerData.profile;

function hashSeed(text) {
  let value = 2166136261;
  for (const character of text) {
    value ^= character.charCodeAt(0);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

const random = mulberry32(hashSeed(`${workerData.seed}:${profile.wallet}`));
let lastPlayer = null;

const berryIds = ['fire_berry', 'water_berry', 'air_berry', 'rock_berry'];

function summarize(player) {
  if (!player) return null;
  const monster = player.monster;
  return {
    address: player.address ?? address,
    unlocked: player.unlocked === true,
    faction: player.faction ?? null,
    level: monster?.level ?? null,
    exp: monster?.exp ?? null,
    nextLevelExp: monster?.nextLevelExp ?? null,
    energy: monster?.energy ?? null,
    happiness: monster?.happiness ?? null,
    status: monster?.status?.type ?? null,
    until: monster?.status?.until_time ?? null,
    runes: player.inventory?.rune ?? 0,
    berries: berryIds.reduce((total, item) => total + (player.inventory?.[item] ?? 0), 0),
    lootboxes: player.lootboxes?.length ?? 0,
    wins: player.wins ?? 0,
    losses: player.losses ?? 0,
    battlesRemaining: player.battlesRemaining ?? 0,
    activeBattleId: player.activeBattleId ?? null,
    battle: player.battle ? {
      id: player.battle.id,
      kind: player.battle.kind,
      status: player.battle.status,
      round: player.battle.round,
      winner: player.battle.winner ?? null,
    } : null,
  };
}

async function refresh() {
  const published = await api.readPlayer(address);
  lastPlayer = published ?? await api.login();
  return lastPlayer;
}

function result(action, player = lastPlayer, detail = {}) {
  if (player?.address) lastPlayer = player;
  return { action, state: summarize(player), ...detail };
}

function weightedChoice(candidates) {
  const total = candidates.reduce((sum, candidate) => sum + candidate.weight, 0);
  if (total <= 0) return null;
  let roll = random() * total;
  for (const candidate of candidates) {
    roll -= candidate.weight;
    if (roll <= 0) return candidate.name;
  }
  return candidates.at(-1)?.name ?? null;
}

function availableBerry(player) {
  const own = player.monster?.berryItem;
  if (own && (player.inventory?.[own] ?? 0) > 0) return own;
  return berryIds.find((item) => (player.inventory?.[item] ?? 0) > 0) ?? null;
}

function ownBerry(player) {
  const item = player.monster?.berryItem;
  return item && (player.inventory?.[item] ?? 0) > 0 ? item : null;
}

function chooseMove(battle) {
  const combatant = battle?.challenger?.address === address
    ? battle.challenger
    : battle?.accepter?.address === address
      ? battle.accepter
      : null;
  const available = Object.entries(combatant?.moves ?? {})
    .filter(([, move]) => (move.count ?? 0) > 0);
  if (!available.length) return 'struggle';
  if (profile.role === 'chaos') {
    return available[Math.floor(random() * available.length)][0];
  }
  available.sort((a, b) => {
    const score = ([, move]) => (move.damage ?? 0) * 10
      + (move.attack ?? 0) * 2 + (move.speed ?? 0) + (move.health ?? 0);
    return score(b) - score(a);
  });
  // Usually play the strongest legal move, but leave enough variation to
  // exercise boosts, healing, move exhaustion, and struggle.
  const pool = random() < 0.75 ? available.slice(0, 2) : available;
  return pool[Math.floor(random() * pool.length)][0];
}

async function bootstrap() {
  // Re-runs should not add fifty redundant User.Info writes to the compute
  // queue. The public player record is authoritative; login only when that key
  // has never been published for this address.
  let player = await refresh();
  if (!player?.unlocked) {
    return result('blocked.access', player, {
      blocked: true,
      reason: 'wallet is not unlocked on this game process',
    });
  }
  if (!player.faction) player = await api.joinFaction(profile.faction);
  if (!player.monster) player = await api.adopt();
  return result('bootstrap', player);
}

async function botRound(player) {
  const battle = player.battle;
  if (!battle || battle.kind !== 'bot' || battle.status !== 'battling') {
    return result('idle.battle-state', player);
  }
  const move = chooseMove(battle);
  const updated = await api.attack(battle.id, move, battle.round);
  return result('battle.attack.bot', updated, { move });
}

async function tick() {
  let player = await refresh();
  if (!player?.unlocked) return result('blocked.access', player, { blocked: true });
  if (!player.faction || !player.monster) return bootstrap();

  const monster = player.monster;
  const status = monster.status.type;

  if ((status === 'Play' || status === 'Quest')
      && monster.status.until_time <= Date.now()) {
    player = await api.claim();
    return result(`activity.claim.${status.toLowerCase()}`, player);
  }
  if (status === 'Minting') return result('idle.minting', player);

  if (status === 'Battle') {
    if (player.battle?.kind === 'bot' && player.battle.status === 'battling') {
      return botRound(player);
    }
    if (player.activeBattleId) return result('idle.pvp-managed', player);
    if (profile.role === 'duelist') return result('idle.awaiting-pvp', player);
    if ((player.battlesRemaining ?? 0) > 0 && (profile.weights.bot ?? 0) > 0) {
      player = await api.startBotBattle(profile.botDifficulty);
      return result('battle.start.bot', player, { difficulty: profile.botDifficulty });
    }
    player = await api.leaveArena();
    return result('arena.leave', player);
  }

  const candidates = [];
  const add = (name, allowed) => {
    const weight = profile.weights[name] ?? 0;
    if (allowed && weight > 0) candidates.push({ name, weight });
  };
  const berry = availableBerry(player);
  const playBerry = ownBerry(player);
  add('daily', (player.dailyReadyAt ?? 0) <= Date.now());
  add('loot', (player.lootboxes?.length ?? 0) > 0 && status === 'Home');
  add('feed', !!berry && monster.energy < 100 && status !== 'Battle');
  add('play', status === 'Home' && !!playBerry && monster.energy >= 10);
  add('quest', status === 'Home' && (player.inventory?.rune ?? 0) >= 1
    && monster.energy >= 25 && monster.happiness >= 25);
  add('bot', status === 'Home' && profile.role !== 'duelist'
    && (player.inventory?.rune ?? 0) >= 1
    && monster.energy >= 25 && monster.happiness >= 25);

  // Level-up is intentionally a priority rather than a random candidate: an
  // account eligible to level should exercise that path before spending more.
  if (status === 'Home' && monster.exp >= monster.nextLevelExp) {
    player = await api.levelUp(profile.statPlan);
    return result('monster.level-up', player, { allocation: profile.statPlan });
  }

  const action = weightedChoice(candidates);
  if (action === 'daily') player = await api.claimDaily();
  else if (action === 'loot') player = await api.openLootbox();
  else if (action === 'feed') player = await api.feed(berry);
  else if (action === 'play') player = await api.startPlay();
  else if (action === 'quest') player = await api.startQuest();
  else if (action === 'bot') player = await api.enterArena();
  else return result(status === 'Home' ? 'idle.no-eligible-action' : `idle.${status.toLowerCase()}`, player);

  const names = {
    daily: 'daily.claim',
    loot: 'lootbox.open',
    feed: 'monster.feed',
    play: 'activity.start.play',
    quest: 'activity.start.quest',
    bot: 'arena.enter',
  };
  return result(names[action], player, berry && action === 'feed' ? { item: berry } : {});
}

async function preparePvp() {
  let player = await refresh();
  if (!player?.unlocked) return result('blocked.access', player, { ready: false });
  if (!player.faction || !player.monster) {
    const setup = await bootstrap();
    return { ...setup, ready: false };
  }

  const monster = player.monster;
  const status = monster.status.type;
  if ((status === 'Play' || status === 'Quest') && monster.status.until_time <= Date.now()) {
    player = await api.claim();
    return result(`activity.claim.${status.toLowerCase()}`, player, { ready: false });
  }
  if (status === 'Play' || status === 'Quest' || status === 'Minting') {
    return result(`idle.${status.toLowerCase()}`, player, { ready: false });
  }
  if (status === 'Battle') {
    if (player.activeBattleId) {
      return result('pvp.occupied', player, { ready: false, occupied: true });
    }
    return result('pvp.ready', player, { ready: (player.battlesRemaining ?? 0) > 0 });
  }

  if ((player.inventory?.rune ?? 0) < 1 && (player.dailyReadyAt ?? 0) <= Date.now()) {
    player = await api.claimDaily();
    return result('daily.claim', player, { ready: false });
  }
  if (monster.energy < 25) {
    const berry = availableBerry(player);
    if (berry) {
      player = await api.feed(berry);
      return result('monster.feed', player, { ready: false, item: berry });
    }
    return result('pvp.needs-energy', player, { ready: false });
  }
  if (monster.happiness < 25) {
    const berry = ownBerry(player);
    if (berry && monster.energy >= 10) {
      player = await api.startPlay();
      return result('activity.start.play', player, { ready: false });
    }
    return result('pvp.needs-happiness', player, { ready: false });
  }
  if ((player.inventory?.rune ?? 0) < 1) {
    return result('pvp.needs-rune', player, { ready: false });
  }
  player = await api.enterArena();
  return result('arena.enter.pvp', player, { ready: false });
}

async function challenge(target) {
  const player = await api.challenge(target);
  return result('pvp.challenge', player, { battleId: player.battle?.id ?? null });
}

async function accept(battleId) {
  const player = await api.acceptChallenge(battleId);
  return result('pvp.accept', player, { battleId });
}

async function pvpMove(battleId) {
  const battle = await api.battleInfo(battleId);
  if (battle.status === 'ended') {
    return result('pvp.ended', lastPlayer, { battle: {
      id: battle.id, status: battle.status, round: battle.round, winner: battle.winner ?? null,
    } });
  }
  const move = chooseMove(battle);
  const player = await api.attack(battleId, move, battle.round);
  return result('battle.attack.pvp', player, { move });
}

async function cleanup() {
  const player = await refresh();
  if (player?.monster?.status?.type !== 'Battle') return result('cleanup.noop', player);
  const updated = await api.leaveArena();
  return result('cleanup.arena-leave', updated);
}

const handlers = { bootstrap, tick, preparePvp, challenge, accept, pvpMove, cleanup };

function errorMessage(error) {
  const parts = [];
  const seen = new Set();
  let current = error;
  while (current && !seen.has(current) && parts.length < 4) {
    seen.add(current);
    parts.push(current.message ?? String(current));
    current = current.cause;
  }
  return parts.join(': caused by ');
}

let queue = Promise.resolve();
parentPort.on('message', (message) => {
  queue = queue.then(async () => {
    const started = Date.now();
    try {
      const handler = handlers[message.command];
      if (!handler) throw new Error(`unknown worker command: ${message.command}`);
      const value = await handler(message.payload);
      parentPort.postMessage({
        id: message.id,
        ok: true,
        value: { ...value, durationMs: Date.now() - started },
      });
    } catch (error) {
      parentPort.postMessage({
        id: message.id,
        ok: false,
        error: {
          name: error?.name ?? 'Error',
          message: errorMessage(error),
          durationMs: Date.now() - started,
        },
      });
    }
  });
});

parentPort.postMessage({ type: 'ready', wallet: profile.wallet, address });
