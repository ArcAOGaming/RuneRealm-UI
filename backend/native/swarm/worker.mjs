import fs from 'node:fs';
import { parentPort, workerData } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import { installWalletShim, jwkToAddress } from '../ans104.mjs';
import { structuredErrorFields } from './error-fields.mjs';
import { makeBridge } from './bridge.mjs';

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

/**
 * Phase timings for the signed writes this actor made, collected per command.
 *
 * One worker command is often several signed writes — a tick can refresh, join
 * a faction and then act — so a single duration for the command cannot say
 * which write was slow, or whether the time went to signing, to the scheduler
 * accepting the item, or to reading the computed reply back. The transport
 * reports each write here and the buffer is drained onto the command's result,
 * which puts them in the run's events.jsonl beside everything else.
 */
let transportBuffer = [];
api.setTransportObserver((timing) => { transportBuffer.push(timing); });

function drainTransport() {
  const collected = transportBuffer;
  transportBuffer = [];
  return collected;
}

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

// The Rune bridge and the AMM pair, built against the same client and the
// same wallet as every other verb this actor calls.
const bridge = makeBridge({ api, address, result, random });
let lastPlayer = null;
let tradePlan = null;

const berryIds = ['fire_berry', 'water_berry', 'air_berry', 'rock_berry'];
const goodsIds = [...berryIds, 'scroll', 'legendary_scroll', 'rune'];
const canPayHuntEntry = (player) => berryIds.every((item) => (
  (player.inventory?.[item] ?? 0) >= 5
));

const ids = (record) => Object.keys(record ?? {});

/**
 * The market, read unsigned.
 *
 * Every actor reads it for itself rather than being handed a copy by the
 * parent. A shared snapshot passed down at the top of a cycle would be stale
 * for forty-nine of the fifty by the time they used it, and "the listing I was
 * told about had already sold" is exactly the race this harness is supposed to
 * find rather than design around.
 */
async function market() {
  try {
    return await api.rawReadJSON('market') ?? {};
  } catch {
    return {};
  }
}

async function economy() {
  try {
    return await api.rawReadJSON('economy') ?? null;
  } catch {
    return null;
  }
}

/**
 * The AMM pair, read unsigned.
 *
 * Null on a deployment with no exchange wired, which is a normal state for a
 * --blank or --no-market deploy rather than a failure.
 */
async function ammPool() {
  if (!api.exchangeConfigured()) return null;
  try {
    return await api.readAmmPool();
  } catch {
    return null;
  }
}

function summarize(player) {
  if (!player) return null;
  const monster = player.monster;
  return {
    address: player.address ?? address,
    unlocked: player.unlocked === true,
    faction: player.faction ?? null,
    roster: ids(player.monsters).length,
    collection: ids(player.collection).length,
    rosterMax: player.rosterMax ?? null,
    adopted: player.adopted === true,
    activeId: player.activeId ?? null,
    outfit: player.outfit ? Object.values(player.outfit).map((piece) => piece.style).join('|') : null,
    level: monster?.level ?? null,
    exp: monster?.exp ?? null,
    nextLevelExp: monster?.nextLevelExp ?? null,
    energy: monster?.energy ?? null,
    happiness: monster?.happiness ?? null,
    status: monster?.status?.type ?? null,
    until: monster?.status?.until_time ?? null,
    runes: player.inventory?.rune ?? 0,
    gold: player.gold ?? 0,
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
    hunt: player.hunt ? {
      runId: player.hunt.runId,
      status: player.hunt.status,
      processId: player.hunt.processId,
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

/**
 * A berry this wallet can actually afford to burn for the arena boost.
 *
 * Entering costs three of one kind, on top of the Rune for the session, so a
 * wallet with two berries must enter unboosted rather than be refused. The
 * process checks the berry BEFORE it spends the Rune precisely so that refusal
 * is free — but an actor that keeps asking for a boost it cannot pay for spends
 * its turns on refusals instead of on gameplay.
 */
function boostableBerry(player) {
  const own = player.monster?.berryItem;
  if (own && (player.inventory?.[own] ?? 0) >= 3) return own;
  return berryIds.find((item) => (player.inventory?.[item] ?? 0) >= 3) ?? null;
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
  const opponent = combatant === battle?.challenger ? battle?.accepter : battle?.challenger;
  const chart = {
    fire: { water: 0.5, air: 2 }, water: { fire: 2, rock: 0.5 },
    air: { fire: 0.5, water: 2 }, rock: { air: 0.5, rock: 2 },
  };
  const hurt = (combatant?.healthPoints ?? 1) / Math.max(1, combatant?.maxHealthPoints ?? 1) < 0.42;
  const finishing = (opponent?.healthPoints ?? 1) / Math.max(1, opponent?.maxHealthPoints ?? 1) < 0.3;
  available.sort((a, b) => {
    const score = ([, move]) => {
      const multiplier = chart[move.type]?.[opponent?.elementType] ?? 1;
      const damage = (move.damage ?? 0) * multiplier * 10;
      const healing = hurt ? Math.max(0, move.health ?? 0) * 5 : (move.health ?? 0);
      const finisher = finishing && (move.damage ?? 0) > 0 ? 18 : 0;
      const selfHarm = hurt && (move.health ?? 0) < 0 ? (move.health ?? 0) * 8 : 0;
      return damage + healing + finisher + selfHarm
        + (move.attack ?? 0) * 2 + (move.speed ?? 0) + (move.defense ?? 0);
    };
    return score(b) - score(a);
  });
  // Usually play the strongest legal move, but leave enough variation to
  // exercise boosts, healing, move exhaustion, and struggle.
  const pool = random() < 0.88 ? available.slice(0, 2) : available;
  return pool[Math.floor(random() * pool.length)][0];
}

function targetHolding(player, item) {
  if (item === 'rune') {
    if (profile.role === 'arena' || profile.role === 'duelist') return 8;
    if (profile.role === 'quester' || profile.role === 'progression') return 6;
    return 4;
  }
  if (item === 'scroll') return ['collector', 'progression'].includes(profile.role) ? 5 : 2;
  if (item === 'legendary_scroll') return profile.role === 'collector' ? 1 : 0;
  if (item === player.monster?.berryItem) return profile.role === 'caretaker' ? 24 : 16;
  return 5;
}

function tradeIntelligence(player, view) {
  if (!view) return null;
  const gold = player.gold ?? 0;
  const ownOrders = (view.orders ?? []).filter((order) => order.account === address);
  const needs = [];
  const excess = [];
  const arbitrage = [];
  for (const item of goodsIds) {
    const held = player.inventory?.[item] ?? 0;
    const target = targetHolding(player, item);
    const stats = view.market?.[item] ?? {};
    const desk = view.desks?.[item];
    if (held < target) {
      const p2p = Number(stats.bestAsk ?? 0);
      const npc = !desk?.pause?.buy ? Number(desk?.ask ?? 0) : 0;
      const cheapest = [p2p, npc].filter((price) => price > 0).sort((a, b) => a - b)[0];
      if (cheapest && gold > cheapest) needs.push({ item, held, target, p2p, npc, cheapest });
    }
    if (held > target) {
      excess.push({ item, held, target, quantity: held - target, stats, desk });
    }
    const bestAsk = Number(stats.bestAsk ?? 0);
    const bestBid = Number(stats.bestBid ?? 0);
    const npcBid = !desk?.pause?.sell ? Number(desk?.bid ?? 0) : 0;
    const npcAsk = !desk?.pause?.buy ? Number(desk?.ask ?? 0) : 0;
    if (bestAsk > 0 && npcBid > bestAsk && gold > bestAsk + 1) {
      arbitrage.push({ item, direction: 'p2p-to-npc', buy: bestAsk, sell: npcBid, desk });
    }
    if (npcAsk > 0 && bestBid > npcAsk && gold >= npcAsk) {
      arbitrage.push({ item, direction: 'npc-to-p2p', buy: npcAsk, sell: bestBid, desk });
    }
  }
  const stale = ownOrders.filter((order) => {
    if ((order.expiresAt ?? 0) - Date.now() < 24 * 3600_000) return true;
    const stats = view.market?.[order.item] ?? {};
    if (order.side === 'sell' && stats.bestAsk && order.price > stats.bestAsk * 1.5) return true;
    if (order.side === 'buy' && stats.bestBid && order.price < stats.bestBid * 0.67) return true;
    return false;
  });
  return { gold, ownOrders, needs, excess, arbitrage, stale };
}

const affordableOrderQuantity = (price, wanted, gold) => {
  const minimum = Math.max(1, Math.ceil(10 / Math.max(1, price)));
  const affordable = Math.floor(Math.max(0, gold - 1) / Math.max(1, price));
  return Math.max(0, Math.min(Math.max(minimum, wanted), affordable, 20));
};

async function economicAction(action, player, view, intel) {
  const choose = (list) => list[Math.floor(random() * list.length)];
  if (action === 'goods_cancel') {
    const order = choose(intel.stale.length ? intel.stale : intel.ownOrders);
    const updated = await api.cancelGoldOrder(order.id);
    return result('goods.order.cancel', updated, { orderId: order.id, item: order.item });
  }
  if (action === 'shop_trade') {
    const sellable = intel.excess.filter(({ desk, quantity }) => desk && !desk.pause?.sell
      && quantity > 0 && desk.stock < desk.stockCap && desk.goldReserve > 0);
    if (intel.gold < 20 && sellable.length) {
      const opportunity = choose(sellable);
      const quantity = Math.max(1, Math.min(3, opportunity.quantity,
        opportunity.desk.stockCap - opportunity.desk.stock));
      const updated = await api.tradeGameShop('sell', opportunity.item, quantity);
      return result('shop.sell', updated, { item: opportunity.item, quantity,
        expectedUnitPrice: opportunity.desk.bid, counterparty: 'NPC' });
    }
    const npcNeeds = intel.needs.filter(({ npc }) => npc > 0);
    if (npcNeeds.length) {
      const opportunity = choose(npcNeeds.sort((a, b) => a.npc - b.npc).slice(0, 2));
      const quantity = Math.max(1, Math.min(3, opportunity.target - opportunity.held,
        Math.floor(intel.gold / opportunity.npc)));
      const updated = await api.tradeGameShop('buy', opportunity.item, quantity);
      return result('shop.buy', updated, { item: opportunity.item, quantity,
        expectedUnitPrice: opportunity.npc, counterparty: 'NPC' });
    }
    const opportunity = sellable[0];
    if (opportunity) {
      const updated = await api.tradeGameShop('sell', opportunity.item, 1);
      return result('shop.sell', updated, { item: opportunity.item, quantity: 1,
        expectedUnitPrice: opportunity.desk.bid, counterparty: 'NPC' });
    }
  }
  if (action === 'goods_take') {
    const opportunities = intel.needs.filter(({ p2p }) => p2p > 0)
      .sort((a, b) => a.p2p - b.p2p);
    const opportunity = opportunities[0];
    if (opportunity) {
      const quantity = affordableOrderQuantity(opportunity.p2p,
        opportunity.target - opportunity.held, intel.gold);
      if (quantity > 0) {
        const updated = await api.placeGoldOrder('buy', opportunity.item, opportunity.p2p, quantity);
        return result('goods.order.buy', updated, { item: opportunity.item,
          price: opportunity.p2p, quantity, strategy: 'take-cheapest-deficit' });
      }
    }
  }
  if (action === 'goods_make') {
    const opportunities = intel.excess.filter(({ quantity }) => quantity > 0 && intel.gold >= 1);
    const opportunity = choose(opportunities);
    if (opportunity) {
      const market = opportunity.stats;
      const reference = Number(market.bestAsk ?? opportunity.desk?.ask ?? market.median7d ?? 5);
      const floor = Number(market.bestBid ?? opportunity.desk?.bid ?? 1);
      const price = Math.max(1, floor + 1, reference - 1);
      const minimum = Math.max(1, Math.ceil(10 / price));
      const quantity = Math.min(opportunity.quantity, Math.max(minimum, Math.min(5, opportunity.quantity)));
      if (price * quantity >= 10) {
        const updated = await api.placeGoldOrder('sell', opportunity.item, price, quantity);
        return result('goods.order.sell', updated, { item: opportunity.item,
          price, quantity, strategy: 'inside-spread-maker' });
      }
    }
  }
  if (action === 'arbitrage') {
    if (tradePlan) {
      const plan = tradePlan;
      tradePlan = null;
      if (plan.destination === 'npc') {
        const available = player.inventory?.[plan.item] ?? 0;
        const quantity = Math.min(plan.quantity, available);
        if (quantity > 0) {
          const updated = await api.tradeGameShop('sell', plan.item, quantity);
          return result('arbitrage.sell.npc', updated, { ...plan, quantity, counterparty: 'NPC' });
        }
      } else {
        const available = player.inventory?.[plan.item] ?? 0;
        const quantity = Math.min(plan.quantity, available);
        if (quantity > 0) {
          const updated = await api.placeGoldOrder('sell', plan.item, plan.sell, quantity);
          return result('arbitrage.sell.p2p', updated, { ...plan, quantity });
        }
      }
    }
    const opportunity = intel.arbitrage.sort((a, b) => (b.sell - b.buy) - (a.sell - a.buy))[0];
    if (opportunity) {
      if (opportunity.direction === 'p2p-to-npc') {
        const quantity = affordableOrderQuantity(opportunity.buy, 1, intel.gold);
        if (quantity > 0) {
          const updated = await api.placeGoldOrder('buy', opportunity.item, opportunity.buy, quantity);
          tradePlan = { item: opportunity.item, quantity, destination: 'npc',
            buy: opportunity.buy, sell: opportunity.sell };
          return result('arbitrage.buy.p2p', updated, { ...tradePlan });
        }
      } else {
        const quantity = Math.max(1, Math.min(3,
          Math.floor(intel.gold / opportunity.buy), opportunity.desk?.stock ?? 0));
        if (quantity > 0) {
          const updated = await api.tradeGameShop('buy', opportunity.item, quantity);
          tradePlan = { item: opportunity.item, quantity, destination: 'p2p',
            buy: opportunity.buy, sell: opportunity.sell };
          return result('arbitrage.buy.npc', updated, { ...tradePlan, counterparty: 'NPC' });
        }
      }
    }
  }
  return result('idle.no-economic-opportunity', player, { requested: action });
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
  if (player.faction && player.faction !== profile.faction) {
    return result('blocked.faction-plan', player, {
      blocked: true,
      reason: `expected ${profile.faction}, found ${player.faction}`,
      expectedFaction: profile.faction,
      actualFaction: player.faction,
    });
  }
  if (!player.faction) player = await api.joinFaction(profile.faction);

  // Adoption is once per account, EVER — so an actor that has sold or given
  // away its last active companion cannot simply adopt another, and calling
  // adopt every tick would spend the whole run collecting the same refusal.
  // The recovery is the one a player has: take one back out of storage, or buy
  // one. An actor with neither has genuinely run itself out of companions,
  // which is a legitimate end state and is reported rather than papered over.
  if (!player.monster) {
    if (player.adopted !== true) {
      player = await api.adopt();
      return result('bootstrap', player);
    }
    const stored = ids(player.collection);
    if (stored.length) {
      player = await api.retrieveMonster(stored[Math.floor(random() * stored.length)]);
      return result('bootstrap.retrieved', player);
    }
    const runes = player.inventory?.rune ?? 0;
    const affordable = Object.values(await market())
      .filter((entry) => entry.seller !== address && Number(entry.price) <= runes);
    if (affordable.length) {
      const listing = affordable[Math.floor(random() * affordable.length)];
      player = await api.buyListing(listing.id);
      const bought = ids(player.collection);
      if (bought.length) player = await api.retrieveMonster(bought[0]);
      return result('bootstrap.bought', player, { listingId: listing.id });
    }
    return result('idle.no-companion', player, {
      reason: 'adopted already, nothing in storage, and nothing affordable on the market',
    });
  }
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

/** Drive a whole Hunt worker session instead of stopping after Hunt.Begin. */
async function huntTick(player) {
  const route = player.hunt;
  if (!route) return result('idle.hunt-route', player);
  const run = await api.readHunt(route);
  if (!run) return result('idle.hunt-opening', player, { runId: route.runId });

  if (run.status === 'opening') {
    const updated = await api.beginHunt(route.monsterId);
    return result('hunt.retry-open', updated, { runId: route.runId });
  }
  if (run.status === 'roaming') {
    // Leave completed runs often enough to exercise release settlement, while
    // still allowing repeated encounters during longer soaks.
    if ((run.encounterCount ?? 0) > 0 && random() < 0.35) {
      await api.huntEnd(route);
      const updated = await refresh();
      return result('hunt.end', updated, { runId: route.runId });
    }
    const cooldown = 3_000;
    if (run.lastSearchAt && run.lastSearchAt + cooldown > Date.now()) {
      return result('idle.hunt-search-cooldown', player, { runId: route.runId });
    }
    const next = await api.huntSearch(route);
    return result('hunt.search', player, {
      runId: route.runId, huntStatus: next.status, encounterId: next.encounter?.id ?? null,
    });
  }
  if (run.status === 'battle' && run.battle) {
    const move = chooseMove(run.battle);
    const next = await api.huntAttack(route, move, run.battle.round);
    return result('hunt.attack', player, {
      runId: route.runId, move, round: run.battle.round, huntStatus: next.status,
    });
  }
  if (run.status === 'defeated') {
    const spendableRune = Math.max(0,
      (player.inventory?.rune ?? 0) - targetHolding(player, 'rune'));
    const canCapture = (player.inventory?.scroll ?? 0) > 0
      && spendableRune > 0;
    // Collectors and chaos actors lean into capture; everybody else still
    // takes that branch sometimes, leaving deliberate decline coverage too.
    const tryCapture = canCapture
      && (['collector', 'chaos'].includes(profile.role) ? random() < 0.8 : random() < 0.35);
    if (tryCapture) {
      const bid = Math.max(1, Math.min(5, spendableRune));
      const next = await api.huntCapture(route, bid);
      return result('hunt.capture', player, {
        runId: route.runId, runes: bid, huntStatus: next.status,
        success: next.lastCapture?.success ?? null,
      });
    }
    const next = await api.huntDeclineCapture(route);
    return result('hunt.decline', player, { runId: route.runId, huntStatus: next.status });
  }
  if (run.status === 'settling') {
    const next = await api.huntRetrySettlement(route);
    return result('hunt.retry-settlement', player, {
      runId: route.runId, huntStatus: next.status,
    });
  }
  if (run.status === 'lost' || run.status === 'ended') {
    await api.huntEnd(route);
    const updated = await refresh();
    return result('hunt.end', updated, { runId: route.runId, outcome: run.status });
  }
  return result(`idle.hunt-${run.status}`, player, { runId: route.runId });
}

async function tick() {
  let player = await refresh();
  if (!player?.unlocked) return result('blocked.access', player, { blocked: true });
  if (!player.faction || !player.monster) return bootstrap();
  if (player.hunt) return huntTick(player);

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
  const boostBerry = boostableBerry(player);
  const runes = player.inventory?.rune ?? 0;
  const roster = ids(player.monsters);
  const collection = ids(player.collection);
  const rosterMax = player.rosterMax ?? 1;
  const idleInRoster = Object.values(player.monsters ?? {})
    .filter((m) => m.status?.type === 'Home');
  const [listings, economyView, pool] = await Promise.all([market(), economy(), ammPool()]);
  const mine = Object.values(listings).filter((entry) => entry.seller === address);
  const affordable = Object.values(listings)
    .filter((entry) => entry.seller !== address && Number(entry.price) <= runes);
  const intelligence = tradeIntelligence(player, economyView);
  const runeReserve = targetHolding(player, 'rune');

  // The bridge and the pair are only reachable on a deployment that actually
  // has them wired. A blank or --no-market deploy leaves the ids unset, and an
  // actor should skip those verbs there rather than sign a message at a
  // placeholder process id.
  const exchangeReady = api.exchangeConfigured();
  // The wallet-side TEST-RUNE balance -- what a settled withdrawal produced,
  // and the only thing `deposit` can burn back into the game.
  const tokenBalance = exchangeReady
    ? Number(await api.readTokenBalance(api.RUNE_PROCESS, address).catch(() => 0)) || 0
    : 0;

  add('daily', (player.dailyReadyAt ?? 0) <= Date.now());
  add('loot', (player.lootboxes?.length ?? 0) > 0 && status === 'Home');
  add('feed', !!berry && monster.energy <= 80 && status !== 'Battle');
  add('play', status === 'Home' && !!playBerry && monster.energy >= 10);
  add('quest', status === 'Home' && runes > runeReserve
    && monster.energy >= 25 && monster.happiness >= 25);
  add('bot', status === 'Home' && profile.role !== 'duelist'
    && runes > runeReserve && monster.energy >= 25 && monster.happiness >= 25);

  // Hunting freezes the companion on a separate worker process and holds it
  // until the run settles, so it is gated like any other activity that takes
  // the lead: idle, at home, not mid-battle. It is legal to attempt on a
  // deployment where hunting is not configured — the authority answers
  // "Hunting is not configured yet" and the actor records the refusal, which
  // is worth having in the log rather than silently skipping the whole verb.
  add('hunt', status === 'Home' && !player.activeBattleId && !player.hunt
    && roster.length > 0 && canPayHuntEntry(player));

  // Roster and collection. Storing costs a rune and needs an idle companion;
  // retrieving is free and needs roster room. Keeping one companion out of
  // storage at all times is deliberate — an actor with an empty roster stops
  // being able to quest, feed or fight, and would drop out of every other
  // measurement this harness takes.
  add('store', runes > runeReserve && idleInRoster.length > 1 && !player.activeBattleId);
  add('retrieve', collection.length > 0 && roster.length < rosterMax);
  add('swap', collection.length > 0 && status === 'Home' && !player.activeBattleId);

  // The marketplace. A listing is custody, so only a stored companion can go
  // up, and an actor that has listed everything keeps at least one back.
  add('list', collection.length > 0);
  add('cancel', mine.length > 0);
  add('buy', affordable.length > 0);
  add('give', collection.length > 0 && (workerData.peers?.length ?? 0) > 0);
  add('goods_make', Boolean(intelligence?.excess.length) && (player.gold ?? 0) >= 1);
  add('goods_take', Boolean(intelligence?.needs.some(({ p2p }) => p2p > 0)));
  add('goods_cancel', Boolean(intelligence?.ownOrders.length));
  add('shop_trade', Boolean(intelligence?.excess.length || intelligence?.needs.length));
  add('arbitrage', Boolean(tradePlan || intelligence?.arbitrage.length));

  // The Rune bridge and the AMM pair.
  //
  // `withdraw` spends the game balance, so it is held above the same reserve
  // every other Rune sink respects -- an actor that bridged itself broke would
  // stop questing and fighting and drop out of every other measurement here.
  // `deposit` is gated on actually holding the token, which only a settled
  // withdrawal produces, so the pair naturally runs in order the first time.
  add('withdraw', runes > runeReserve + 1 && exchangeReady);
  add('deposit', tokenBalance > 0 && exchangeReady);
  add('liquidity', exchangeReady);
  add('trade', exchangeReady);

  // Deliberately illegal. See `probe` below.
  add('probe', true);

  // Level-up is intentionally a priority rather than a random candidate: an
  // account eligible to level should exercise that path before spending more.
  const levelRuneCost = Math.max(1, Math.floor(((monster.level ?? 0) + 4) / 4));
  if (status === 'Home' && monster.exp >= monster.nextLevelExp
      && runes - levelRuneCost >= runeReserve) {
    player = await api.levelUp(profile.statPlan);
    return result('monster.level-up', player, { allocation: profile.statPlan });
  }

  // Bootstrapping beats sampling.
  //
  // `trade` needs reserves and `goods_take`/`arbitrage` need a resting order,
  // so until somebody opens each market NONE of those actions can do anything
  // -- and the actions that would open them are ordinary weighted candidates
  // competing with twenty others. Measured over a twelve-minute fifty-wallet
  // run: one p2p order placed, zero liquidity added, and every one of the four
  // swap attempts skipped for want of reserves. The pricing was never the
  // problem; the market simply never got opened.
  //
  // So an actor that CAN open an empty market does that first, exactly the way
  // a pending level-up and a half-finished arbitrage already jump the queue.
  // Once the market exists this is inert, because the condition is emptiness.
  const poolEmpty = exchangeReady && pool?.configured && !pool.paused
    && (Number(pool.reserveBase ?? 0) <= 0 || Number(pool.reserveQuote ?? 0) <= 0);
  // Opening the pair is a FLEET bootstrap, not a role preference, so this
  // deliberately ignores `weights.liquidity`. Thirty-seven of the fifty actors
  // carry a weight of zero for it -- a sane steady-state choice, and the reason
  // an empty pool stayed empty: the wallets that bridged were mostly not the
  // wallets permitted to provide. While there are no reserves at all, anyone
  // holding spare Rune should be willing to open the market. Once reserves
  // exist this whole branch is unreachable and the weights govern again.
  if (poolEmpty) {
    // The pair is TEST-RUNE against TEST-RELIC, and only ONE of those can be
    // conjured: the quote token has a public faucet, the base token does not.
    // TEST-RUNE exists solely as the output of a settled `Rune.Withdraw`, so an
    // actor holding none can fund the quote side, fund nothing on the base side
    // and skip -- which is what eleven straight attempts did, every one of them
    // reporting `base=0 quote=2000000`.
    //
    // So bridge first and add liquidity on a later tick, once the mint has
    // settled. That makes the cycle self-sufficient per wallet instead of
    // depending on the same actor happening to roll withdraw before liquidity.
    if (tokenBalance <= 0) {
      if (runes > runeReserve + 1) {
        return bridge.withdraw(player, Math.min(2, runes - runeReserve));
      }
      return result('amm.liquidity.skipped', player, {
        reason: 'no TEST-RUNE and no spare game Rune to bridge for it',
      });
    }
    return bridge.liquidity(player);
  }
  // An item this actor holds spare that nobody is offering at any price. The
  // maker prices it against the NPC desk, so the first order lands one Gold
  // inside the shop rather than at a number pulled out of the air.
  const unquoted = (intelligence?.excess ?? []).filter(({ item, quantity }) =>
    quantity > 0 && !(economyView?.market?.[item]?.bestAsk > 0)
    && (economyView?.desks?.[item]?.ask ?? 0) > 0);
  if (unquoted.length > 0 && (profile.weights.goods_make ?? 0) > 0 && (player.gold ?? 0) >= 1) {
    return economicAction('goods_make', player, economyView,
      { ...intelligence, excess: unquoted });
  }

  const action = tradePlan && intelligence ? 'arbitrage' : weightedChoice(candidates);
  const choose = (list) => list[Math.floor(random() * list.length)];
  let detail = {};

  if (action === 'daily') player = await api.claimDaily();
  else if (action === 'loot') player = await api.openLootbox();
  else if (action === 'feed') { player = await api.feed(berry); detail = { item: berry }; }
  else if (action === 'play') player = await api.startPlay();
  else if (action === 'quest') player = await api.startQuest();
  else if (action === 'bot') {
    // Sometimes buy the boost, sometimes do not. Both are real player choices
    // and they exercise different code: the plain entry spends one Rune, the
    // boosted entry additionally spends three berries and writes `arenaBoost`,
    // which the battle then folds into the temporary combatant. Choosing only
    // one of them would leave the other unexercised in every soak.
    const boost = boostBerry && random() < 0.5 ? boostBerry : undefined;
    player = await api.enterArena(boost);
    detail = boost ? { berry: boost } : {};
  } else if (action === 'hunt') {
    const target = player.activeId ?? roster[0];
    player = await api.beginHunt(target);
    detail = { monsterId: target };
  } else if (action === 'store') {
    // Never the last idle companion: an actor with nothing active drops out of
    // every other measurement in the run.
    const target = choose(idleInRoster.filter((m) => m.id !== player.activeId))
      ?? idleInRoster[0];
    player = await api.storeMonster(target.id);
    detail = { monsterId: target.id };
  } else if (action === 'retrieve') {
    const id = choose(collection);
    player = await api.retrieveMonster(id);
    detail = { monsterId: id };
  } else if (action === 'swap') {
    const id = choose(collection);
    player = await api.setActiveMonster(id);
    detail = { monsterId: id };
  } else if (action === 'list') {
    const id = choose(collection);
    // Skewed low so the other actors can actually afford it. A market that
    // never clears measures listing and nothing else.
    const price = 1 + Math.floor(random() * random() * 40);
    player = await api.listMonster(id, price);
    detail = { monsterId: id, price, listingId: player.listing?.id ?? null };
  } else if (action === 'cancel') {
    const listing = choose(mine);
    player = await api.cancelListing(listing.id);
    detail = { listingId: listing.id };
  } else if (action === 'buy') {
    const listing = choose(affordable);
    player = await api.buyListing(listing.id);
    detail = { listingId: listing.id, price: Number(listing.price), seller: listing.seller };
  } else if (action === 'give') {
    const id = choose(collection);
    const recipient = choose(workerData.peers);
    player = await api.transferMonster(id, recipient);
    detail = { monsterId: id, recipient };
  } else if (['goods_make', 'goods_take', 'goods_cancel', 'shop_trade', 'arbitrage'].includes(action)) {
    return economicAction(action, player, economyView, intelligence);
  } else if (action === 'withdraw') {
    // One at a time. A withdrawal is a queued mint, and the point is to watch
    // the queue drain rather than to move a large balance.
    return bridge.withdraw(player, Math.min(2, runes - runeReserve));
  } else if (action === 'deposit') {
    return bridge.deposit(player, Math.min(2, tokenBalance));
  } else if (action === 'liquidity') {
    return bridge.liquidity(player);
  } else if (action === 'trade') {
    return bridge.trade(player);
  } else if (action === 'probe') {
    return probe(player, listings);
  } else {
    return result(status === 'Home' ? 'idle.no-eligible-action' : `idle.${status.toLowerCase()}`, player);
  }

  const names = {
    daily: 'daily.claim',
    loot: 'lootbox.open',
    feed: 'monster.feed',
    play: 'activity.start.play',
    quest: 'activity.start.quest',
    bot: 'arena.enter',
    hunt: 'hunt.begin',
    store: 'monster.store',
    retrieve: 'monster.retrieve',
    swap: 'monster.set-active',
    list: 'market.list',
    cancel: 'market.cancel',
    buy: 'market.buy',
    give: 'monster.transfer',
  };
  return result(names[action], player, detail);
}

/**
 * Try something the process must refuse, and report whether it did.
 *
 * A soak that only does legal things measures the happy path. These are the
 * other half: well-formed, plausible messages that each break exactly one rule.
 * A garbage message would be rejected by the action lookup and prove nothing,
 * so every one of these names a real verb with real arguments and differs from
 * a legal call in one respect.
 *
 * The worker does not decide whether the answer was right — it reports what it
 * attempted, what it expected, and what came back, and `verify.mjs` reads the
 * event log afterwards. That split matters because these run live and
 * concurrently: an actor cannot know that the listing it is probing was not
 * bought by somebody else a moment ago, and a judgement made here would be a
 * judgement made on stale state.
 */
async function probe(player, listings) {
  const collection = ids(player.collection);
  const roster = ids(player.monsters);
  const runes = player.inventory?.rune ?? 0;
  const others = Object.values(listings).filter((entry) => entry.seller !== address);
  const mine = Object.values(listings).filter((entry) => entry.seller === address);
  const choose = (list) => list[Math.floor(random() * list.length)];

  const cases = [
    { probe: 'unknown-monster', rule: 'an id nobody has issued names no companion',
      tags: [{ name: 'Action', value: 'Monster.Store' }, { name: 'MonsterId', value: 'm999999' }] },
    { probe: 'set-active-unknown', rule: 'an id nobody has issued names no companion',
      tags: [{ name: 'Action', value: 'Monster.SetActive' }, { name: 'MonsterId', value: 'm999999' }] },
    { probe: 'swear-again', rule: 'an account swears once, and the oath carries the starter',
      when: () => Boolean(player.faction),
      tags: () => [{ name: 'Action', value: 'Faction.Join' },
        { name: 'Faction', value: choose(['Sky Nomads', 'Aqua Guardians',
          'Inferno Blades', 'Stone Titans'].filter((f) => f !== player.faction)) }] },
    { probe: 'swear-nonsense', rule: 'a faction that does not exist has no companion to hand over',
      tags: [{ name: 'Action', value: 'Faction.Join' },
        { name: 'Faction', value: 'Nonsense Brigade' }] },
    { probe: 'adopt-again', rule: 'adoption is once per account, ever',
      when: () => player.adopted === true,
      tags: [{ name: 'Action', value: 'Monster.Adopt' }] },
    { probe: 'forged-admin-grant', rule: 'Admin.* is owner-only',
      tags: [{ name: 'Action', value: 'Admin.AdjustInventory' },
        { name: 'PlayerId', value: address }, { name: 'Item', value: 'rune' },
        { name: 'Amount', value: '100000' }] },
    { probe: 'forged-admin-create', rule: 'Admin.* is owner-only',
      tags: [{ name: 'Action', value: 'Admin.CreateMonster' },
        { name: 'PlayerId', value: address }, { name: 'Into', value: 'collection' }] },
    { probe: 'forged-admin-unlock', rule: 'Admin.* is owner-only',
      tags: [{ name: 'Action', value: 'Admin.Unlock' }, { name: 'Addresses', value: address }] },
    { probe: 'forged-gold-release', rule: 'Gold authorization and release are owner-only',
      tags: [{ name: 'Action', value: 'Admin.Economy.ReleaseGold' },
        { name: 'Item', value: 'rune' }, { name: 'Amount', value: '100000' },
        { name: 'Reason', value: 'forged' }] },
    { probe: 'gold-order-zero', rule: 'Gold order quantity must be a positive integer',
      tags: [{ name: 'Action', value: 'Economy.Order.Place' },
        { name: 'Side', value: 'buy' }, { name: 'Item', value: 'air_berry' },
        { name: 'Price', value: '10' }, { name: 'Quantity', value: '0' }] },
    { probe: 'gold-order-below-minimum', rule: 'Gold orders must carry at least ten Gold of value',
      tags: [{ name: 'Action', value: 'Economy.Order.Place' },
        { name: 'Side', value: 'buy' }, { name: 'Item', value: 'air_berry' },
        { name: 'Price', value: '1' }, { name: 'Quantity', value: '1' }] },
    { probe: 'npc-zero-quantity', rule: 'NPC trades require a positive integer quantity',
      tags: [{ name: 'Action', value: 'Economy.Shop.Trade' },
        { name: 'Side', value: 'sell' }, { name: 'Item', value: 'air_berry' },
        { name: 'Quantity', value: '0' }] },
    { probe: 'legendary-npc-desk', rule: 'Legendary Scroll is P2P-only at launch',
      tags: [{ name: 'Action', value: 'Economy.Shop.Trade' },
        { name: 'Side', value: 'sell' }, { name: 'Item', value: 'legendary_scroll' },
        { name: 'Quantity', value: '1' }] },
    { probe: 'list-from-roster', rule: 'only a stored companion can be listed',
      when: () => roster.length > 0,
      tags: () => [{ name: 'Action', value: 'Market.List' },
        { name: 'MonsterId', value: choose(roster) }, { name: 'Price', value: '10' }] },
    { probe: 'list-price-zero', rule: 'a price of zero is not a price',
      when: () => collection.length > 0,
      tags: () => [{ name: 'Action', value: 'Market.List' },
        { name: 'MonsterId', value: choose(collection) }, { name: 'Price', value: '0' }] },
    { probe: 'list-price-nonsense', rule: 'a price that is not a number is not a price',
      when: () => collection.length > 0,
      tags: () => [{ name: 'Action', value: 'Market.List' },
        { name: 'MonsterId', value: choose(collection) }, { name: 'Price', value: 'free' }] },
    { probe: 'transfer-to-self', rule: 'a companion cannot be transferred to its own owner',
      when: () => collection.length > 0,
      tags: () => [{ name: 'Action', value: 'Monster.Transfer' },
        { name: 'MonsterId', value: choose(collection) }, { name: 'Recipient', value: address }] },
    { probe: 'transfer-bad-recipient', rule: 'a recipient must be an Arweave address',
      when: () => collection.length > 0,
      tags: () => [{ name: 'Action', value: 'Monster.Transfer' },
        { name: 'MonsterId', value: choose(collection) }, { name: 'Recipient', value: 'not-an-address' }] },
    { probe: 'transfer-from-roster', rule: 'only a stored companion changes hands',
      when: () => roster.length > 0 && (workerData.peers?.length ?? 0) > 0,
      tags: () => [{ name: 'Action', value: 'Monster.Transfer' },
        { name: 'MonsterId', value: choose(roster) },
        { name: 'Recipient', value: choose(workerData.peers) }] },
    { probe: 'cancel-someone-elses', rule: 'a listing can only be withdrawn by its seller',
      when: () => others.length > 0,
      tags: () => [{ name: 'Action', value: 'Market.Cancel' },
        { name: 'ListingId', value: choose(others).id }] },
    { probe: 'cancel-unknown', rule: 'a listing id that was never issued names no listing',
      tags: [{ name: 'Action', value: 'Market.Cancel' }, { name: 'ListingId', value: 'L9999999' }] },
    { probe: 'buy-own-listing', rule: 'you cannot buy your own listing',
      when: () => mine.length > 0,
      tags: () => [{ name: 'Action', value: 'Market.Buy' },
        { name: 'ListingId', value: choose(mine).id }] },
    { probe: 'buy-unaffordable', rule: 'a purchase must not proceed on runes not held',
      when: () => others.some((entry) => Number(entry.price) > runes),
      tags: () => [{ name: 'Action', value: 'Market.Buy' },
        { name: 'ListingId', value: choose(others.filter((entry) => Number(entry.price) > runes)).id }] },
    { probe: 'buy-unknown', rule: 'a listing id that was never issued names no listing',
      tags: [{ name: 'Action', value: 'Market.Buy' }, { name: 'ListingId', value: 'L9999999' }] },
  ];

  const eligible = cases.filter((entry) => !entry.when || entry.when());
  if (!eligible.length) return result('idle.no-eligible-probe', player);
  const chosen = choose(eligible);
  const tags = typeof chosen.tags === 'function' ? chosen.tags() : chosen.tags;

  // The raw transport, because the typed client will not build an illegal
  // message: `listMonster` clamps a price of zero up to one, which is right
  // for the app and would make this probe assert nothing.
  let refused = false;
  let refusal = null;
  try {
    const reply = await api.rawSend(tags);
    refused = Boolean(reply?.error);
    refusal = reply?.error ?? null;
  } catch (error) {
    // A process-level refusal arrives as a thrown client error, which is still
    // a refusal — the message did not take effect.
    refused = true;
    refusal = error?.message ?? String(error);
  }

  const after = await refresh();
  return result(`probe.${chosen.probe}`, after, {
    probe: chosen.probe, rule: chosen.rule, expected: 'refused',
    refused, refusal, tags: Object.fromEntries(tags.map((t) => [t.name, t.value])),
  });
}

async function preparePvp() {
  let player = await refresh();
  if (!player?.unlocked) return result('blocked.access', player, { ready: false });
  if (!player.faction || !player.monster) {
    const setup = await bootstrap();
    return { ...setup, ready: false };
  }
  if (player.hunt) {
    await api.huntEnd(player.hunt);
    player = await refresh();
    return result('cleanup.hunt-end', player, { ready: false });
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
  if (player?.hunt) {
    await api.huntEnd(player.hunt);
    const updated = await refresh();
    return result('cleanup.hunt-end', updated);
  }
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
        value: { ...value, durationMs: Date.now() - started, transport: drainTransport() },
      });
    } catch (error) {
      parentPort.postMessage({
        id: message.id,
        ok: false,
        error: {
          ...structuredErrorFields(error),
          name: error?.name ?? 'Error',
          message: errorMessage(error),
          durationMs: Date.now() - started,
          // A failed command still made signed writes, and the timings of the
          // ones that failed are the point of measuring at all.
          transport: drainTransport(),
        },
      });
    }
  });
});

parentPort.postMessage({ type: 'ready', wallet: profile.wallet, address });
