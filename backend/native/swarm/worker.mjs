import fs from 'node:fs';
import { parentPort, workerData } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import { installWalletShim, jwkToAddress } from '../ans104.mjs';
import { structuredErrorFields } from './error-fields.mjs';
import { makeBridge } from './bridge.mjs';
import { useKeepAlive } from '../keepalive.mjs';
import { chooseProgressionAction } from './strategy.mjs';
import { resolveArenaBattle } from './arena-read.mjs';

if (!parentPort) throw new Error('swarm worker must run in a worker thread');

// Before the client module is imported, so its very first request is warm.
// `globalThis` is per THREAD, so the parent runner doing this would do nothing
// for the fifty actors that make every request the soak measures.
await useKeepAlive();

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
const ARENA_STAKE = Number(api.SWARM_ARENA_STAKE);
const ARENA_MIN_ENTRY = Number(api.SWARM_ARENA_MIN_ENTRY);
if (!Number.isSafeInteger(ARENA_STAKE) || ARENA_STAKE <= 0
    || !Number.isSafeInteger(ARENA_MIN_ENTRY) || ARENA_MIN_ENTRY < ARENA_STAKE) {
  throw new Error('generated swarm client has invalid arena Gold terms');
}
// A wallet that can fight must not escrow its last stake on a trading venue.
// PvE sessions charge once per battle; PvP charges each side before round one.
const arenaGoldReserve = (profile.weights?.bot ?? 0) > 0 || profile.role === 'duelist'
  ? ARENA_MIN_ENTRY : 0;
const acceptedDelivery = (error) => error instanceof api.OutboxDeliveryError
  || (error?.accepted === true && error?.durable === true);
const missingListing = (error) => /no such listing/i.test(
  error instanceof Error ? error.message : String(error),
);
const staleOrder = (error) => /no such order|that order has expired|post-only order may not cross|price is (?:below|above) the .*price band/i.test(
  error instanceof Error ? error.message : String(error),
);
const staleShop = (error) => /shop stock cap reached|desk is out of stock|desk gold reserve exhausted|global 20-hour quantity limit reached|policy-epoch supply-flow limit reached/i.test(
  error instanceof Error ? error.message : String(error),
);
async function settleOrAccept(call) {
  try { return { value: await call(), accepted: false, slot: null }; }
  catch (error) {
    if (!acceptedDelivery(error)) throw error;
    return { value: null, accepted: true, slot: error.slot ?? null };
  }
}

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

// The Rune bridge, built against the same client and the
// same wallet as every other verb this actor calls.
const bridge = makeBridge({ api, address, result, random });
let lastPlayer = null;
let decisionReason = null;
let tradePlan = null;

const berryIds = ['fire_berry', 'water_berry', 'air_berry', 'rock_berry'];
const goodsIds = [...berryIds, 'scroll', 'legendary_scroll', 'rune'];
const canPayHuntEntry = (player) => berryIds.every((item) => (
  (player.inventory?.[item] ?? 0) >= 2
));

const ids = (record) => Object.keys(record ?? {});

// The character creator ------------------------------------------------------
//
// Every actor dresses itself exactly once per run, at a randomly chosen one of
// its first few ticks. Once, because the point is coverage: `Sprite.Update` is
// the one player-facing write no other verb reaches, and a run where nobody
// sent one proves nothing about it. Randomly placed rather than pinned to
// bootstrap, because a write that only ever lands on a fresh account is a write
// only ever measured against a cold record -- a real player changes their hair
// in the middle of everything else, and that is the slot cost worth measuring.
//
// It is deliberately NOT gated on the companion being idle, or on the actor not
// already having an outfit. The contract asks for neither, so a harness that
// asks for both would be testing a rule the game does not have.

const CHARACTER_ORDER = ['Hair', 'Hat', 'Shirt', 'Pants', 'Gloves', 'Shoes'];

/**
 * The layer art, read from `src/assets/` — the same folders the browser globs.
 *
 * A literal list here would be a second source of truth for the wardrobe, and
 * the way it fails is silent: the actor saves `style: "Trilby"`, the contract
 * accepts it (it validates the shape of a name, not its membership), and the
 * broken avatar only appears when somebody opens that wallet in the client.
 * Reading the folder cannot drift.
 */
function characterCatalogue() {
  const root = new URL('../../../src/assets/', import.meta.url);
  const catalogue = {};
  for (const category of CHARACTER_ORDER) {
    let names = [];
    try {
      names = fs.readdirSync(new URL(`${category}/`, root))
        .filter((file) => file.toLowerCase().endsWith('.png'))
        .map((file) => file.slice(0, -4));
    } catch {
      names = [];
    }
    // `None` is a real option in every category and the only safe fallback: a
    // wardrobe that came back empty still produces a legal recipe rather than
    // an actor that cannot save at all.
    catalogue[category] = names.length ? names : ['None'];
  }
  return catalogue;
}

const CHARACTER_CATALOGUE = characterCatalogue();

/** `hsl` in 0..1 saturation/lightness, out as `#rrggbb`. Mirrors `lib/sprites`. */
function hsl(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const hex = (v) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`;
}

/**
 * One outfit, from this actor's seeded stream so a replayed run dresses alike.
 *
 * The hue spread is the client's: one base hue with the garments placed around
 * the wheel from it, rather than six independent colours. It matters here only
 * because a screenshot of a fifty-wallet soak should look like fifty people
 * and not like fifty test fixtures.
 */
function randomOutfit() {
  const base = random() * 360;
  const spread = [0, 172, 28, 200, 14, 340];
  const outfit = {};
  CHARACTER_ORDER.forEach((category, index) => {
    const options = CHARACTER_CATALOGUE[category];
    const wearable = options.filter((name) => name.toLowerCase() !== 'none');
    const pick = wearable.length && random() < 0.82
      ? wearable[Math.floor(random() * wearable.length)]
      : options.find((name) => name.toLowerCase() === 'none') ?? options[0];
    outfit[category] = {
      style: pick,
      color: hsl(
        (base + spread[index % spread.length]) % 360,
        0.28 + random() * 0.34,
        0.30 + random() * 0.26,
      ),
    };
  });
  return outfit;
}

// Which tick this actor dresses on, and whether it has. Drawn once per worker,
// so fifty actors spread their `Sprite.Update` writes over the opening minutes
// instead of sending fifty of them into the same slot.
const characterTick = Math.floor(random() * 4);
let ticks = 0;
let characterSaved = false;
let characterAttempts = 0;

async function customizeIfDue(player, tickNumber, detail = {}) {
  if (characterSaved || tickNumber < characterTick || characterAttempts >= 3) return null;
  characterAttempts += 1;
  const outfit = randomOutfit();
  const updated = await api.spriteUpdate(outfit);
  characterSaved = true;
  return result('character.save', updated, {
    ...detail,
    outfit: CHARACTER_ORDER.map((category) =>
      `${category}:${outfit[category].style}`).join(','),
  });
}

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

/**
 * The economy, as one object, out of the two keys it is published in.
 *
 * `economy` is the flow half (ledgers, Gold, policy, invariants) and
 * `economybook` is the orderbook half (`market`, `desks`, `orders`, `fills`) --
 * split so that feeding a companion stops rebuilding seven price ladders. This
 * worker reads the book half on nearly every draw, so it wants both; merging
 * here keeps every call site below reading one view.
 *
 * A process from before the split publishes no `economybook`, and the flow key
 * still carries every field, so the merge is a no-op against one.
 */
async function economy() {
  try {
    const [flow, book] = await Promise.all([
      api.rawReadJSON('economy').catch(() => null),
      api.rawReadJSON('economybook').catch(() => null),
    ]);
    if (!flow) return null;
    return book ? { ...flow, ...book } : flow;
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
    arenaLast: player.arenaLast ? {
      tier: player.arenaLast.tier,
      stake: player.arenaLast.stake,
      pot: player.arenaLast.pot,
      paid: player.arenaLast.paid,
      base: player.arenaLast.base,
      won: player.arenaLast.won === true,
    } : null,
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
  return {
    action, state: summarize(player),
    ...(decisionReason ? { decision: decisionReason } : {}),
    ...detail,
  };
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
 * A boost costs three of one kind. The arena's Gold is charged per battle, not
 * at entry, so a wallet with two berries enters unboosted rather than spending
 * its turns repeatedly asking for a boost it cannot pay for.
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

/**
 * How an actor quotes: how wide, how hard it competes, how deep it goes.
 *
 * Fifty wallets running one strategy is one trader with fifty hands, and a
 * book with one opinion in it never moves. These are the differences that make
 * a spread: a collector quotes tight and improves on the touch nearly every
 * time, a caretaker quotes wide and sits, and chaos does neither predictably.
 *
 * `aggression` is the probability of stepping INSIDE the current best rather
 * than resting at this actor's own fair-value edge. That single number is the
 * competitive loop -- it is what makes fifty actors converge a spread instead
 * of fifty of them stacking at the same price -- and it is bounded by fair
 * value, so the convergence stops where the trade stops being worth doing.
 */
const MAKER_STYLE = {
  quester: { edgeBps: 900, aggression: 0.35, depth: 4 },
  caretaker: { edgeBps: 1300, aggression: 0.2, depth: 3 },
  arena: { edgeBps: 700, aggression: 0.5, depth: 4 },
  duelist: { edgeBps: 1100, aggression: 0.3, depth: 3 },
  collector: { edgeBps: 400, aggression: 0.75, depth: 8 },
  progression: { edgeBps: 600, aggression: 0.55, depth: 5 },
  chaos: { edgeBps: 1800, aggression: 0.85, depth: 6 },
};

const style = () => MAKER_STYLE[profile.role] ?? MAKER_STYLE.progression;

/**
 * What this item is worth, from every source that has an opinion.
 *
 * Three independent readings, averaged: what it has actually traded at, where
 * the realm's desk is quoting, and where the players are quoting. Averaging
 * them is the point -- any one of them alone is walkable. The realm's desk
 * never observes the market, so its half cannot be moved by two wallets
 * printing a fake median; the median cannot be moved by a desk running out of
 * stock; and the book's own mid is ignored entirely when it is one-sided.
 */
function fairValue(stats, desk) {
  const readings = [];
  if (stats?.median7d > 0) readings.push(Number(stats.median7d));
  const houseBid = Number(stats?.houseBid ?? desk?.bid ?? 0);
  const houseAsk = Number(stats?.houseAsk ?? desk?.ask ?? 0);
  if (houseBid > 0 && houseAsk > 0) readings.push((houseBid + houseAsk) / 2);
  const p2pBid = Number(stats?.p2pBid ?? 0);
  const p2pAsk = Number(stats?.p2pAsk ?? 0);
  if (p2pBid > 0 && p2pAsk > 0) readings.push((p2pBid + p2pAsk) / 2);
  if (!readings.length) return 0;
  return readings.reduce((sum, value) => sum + value, 0) / readings.length;
}

/** Keep a price inside the corridor the process will actually accept. */
function inBand(price, band) {
  if (!Number.isFinite(price)) return 0;
  let value = Math.max(1, Math.round(price));
  if (band?.low > 0) value = Math.max(value, Math.ceil(band.low));
  if (band?.high > 0) value = Math.min(value, Math.floor(band.high));
  return value;
}

/**
 * Walk a published ladder and work out what an immediate order would take.
 *
 * The same arithmetic the order ticket does, for the same reason: the process
 * refuses an unpriced order, so a taker has to name the worst price its sweep
 * needs. `rows` are price levels, best-first, and they already include the
 * realm's desk -- which is the whole point of the desk quoting into the book.
 */
function sweepLadder(rows, want) {
  let units = 0; let cost = 0; let limit = 0;
  for (const row of rows ?? []) {
    const price = Number(row.price) || 0;
    const available = Number(row.quantity) || 0;
    if (price <= 0 || available <= 0) continue;
    const room = want.gold !== undefined
      ? Math.min(available, Math.floor((want.gold - cost) / price))
      : Math.min(available, Math.max(0, (want.units ?? 0) - units));
    if (room <= 0) break;
    units += room; cost += room * price; limit = price;
    if (want.units !== undefined && units >= want.units) break;
  }
  return { units, cost, limit, average: units ? cost / units : 0 };
}

/**
 * Where this actor wants its quote, on one side, right now.
 *
 * Fair value, pushed out by this actor's own edge, pushed further by whichever
 * way its inventory is lopsided, then -- sometimes -- improved to just inside
 * the best price a player is showing. The improvement is bounded by fair value
 * on both sides: an actor will undercut an ask while there is still edge in
 * doing so and stop when there is not, which is what makes a spread converge
 * somewhere rather than to zero.
 *
 * It can never cross. A quote that crosses is a taker order wearing a maker's
 * clothes -- it pays the fee, loses the queue position and, sent as PostOnly,
 * is simply refused and wastes the message.
 */
function quotePrice(side, stats, fair, skewBps) {
  const mine = style();
  const jitter = 0.7 + random() * 0.6;
  const edge = mine.edgeBps * jitter;
  const offset = side === 'buy' ? -(edge + skewBps) : (edge - skewBps);
  let price = Math.round(fair * (1 + offset / 10000));
  const bestP2P = Number((side === 'buy' ? stats?.p2pBid : stats?.p2pAsk) ?? 0);
  if (bestP2P > 0 && random() < mine.aggression) {
    // Step inside the touch, but only while the trade is still worth doing.
    // Undercutting past fair value is how a market maker converts a spread
    // into a loss, and fifty of them doing it is how a book prints nonsense.
    const improved = side === 'buy' ? bestP2P + 1 : bestP2P - 1;
    const worthIt = side === 'buy' ? improved < fair : improved > fair;
    if (worthIt) price = improved;
  }
  const bestAsk = Number(stats?.bestAsk ?? 0);
  const bestBid = Number(stats?.bestBid ?? 0);
  if (side === 'buy' && bestAsk > 0) price = Math.min(price, bestAsk - 1);
  if (side === 'sell' && bestBid > 0) price = Math.max(price, bestBid + 1);
  price = inBand(price, stats?.band);
  /* The corridor can push a quote back across the touch -- a narrow band with
     the house sitting on its edge leaves no room to rest inside it. There is
     no maker price here, and saying so is better than sending a PostOnly order
     the process will refuse and charge a message for. */
  if (side === 'buy' && bestAsk > 0 && price >= bestAsk) return 0;
  if (side === 'sell' && bestBid > 0 && price <= bestBid) return 0;
  return price;
}

function tradeIntelligence(player, view) {
  if (!view) return null;
  const gold = Number(player.gold ?? 0);
  const spendableGold = Math.max(0, gold - arenaGoldReserve);
  /* The caller's own orders come off the PLAYER record now. `view.orders` is a
     copy of the whole book, and reading all of it to find one wallet's handful
     is the shape the process is trying to stop paying for. The published book
     is still there and still read for prices; it is no longer read for
     identity. */
  const ownOrders = (player.openOrders ?? [])
    .map((order) => ({ ...order, account: address }))
    .concat((view.orders ?? []).filter((order) => order.account === address
      && !(player.openOrders ?? []).some((own) => own.id === order.id)));
  const needs = [];
  const excess = [];
  const arbitrage = [];
  const quotes = [];

  for (const item of goodsIds) {
    const held = player.inventory?.[item] ?? 0;
    const target = targetHolding(player, item);
    const stats = view.market?.[item] ?? {};
    const desk = view.desks?.[item];
    const fair = fairValue(stats, desk);
    const band = stats.band;
    const asks = stats.depth?.asks ?? [];
    const bids = stats.depth?.bids ?? [];
    const liveHere = ownOrders.filter((order) => order.item === item);
    /*
      The ladder ALREADY has the realm's desk in it.

      This used to compare two venues by hand -- the desk's `ask` against the
      best P2P order -- because the shop and the floor were two prices and a
      taker had to pick. They are one ladder now: a taker gets whichever of
      desk-or-P2P is better without choosing, so the honest thing for an actor
      to read is the ladder, and the desk's own fields are only worth reading
      to know whether the house is quoting at all.
    */
    if (held < target && asks.length) {
      const want = Math.min(target - held, style().depth);
      const plan = sweepLadder(asks, { units: want });
      // Cheap against fair value, or simply needed. Both are real reasons to
      // take, and separating them is what stops an actor paying up for a berry
      // it has twenty of.
      const cheap = fair > 0 && plan.average > 0 && plan.average <= fair * 0.98;
      if (plan.units > 0 && spendableGold > plan.cost + 1) {
        needs.push({ item, held, target, plan, fair, cheap, band,
          urgent: held * 2 < target });
      }
    }
    if (held > target && bids.length) {
      const plan = sweepLadder(bids, { units: Math.min(held - target, style().depth) });
      const rich = fair > 0 && plan.average >= fair * 1.02;
      excess.push({ item, held, target, quantity: held - target, plan, fair, rich,
        stats, desk, band });
    }

    /*
      A crossed market between the house and the book, which is a real thing
      now and was not before.

      The desk does not REST an order -- it quotes when a taker arrives. So a
      player's bid can sit above the desk's ask indefinitely with nothing to
      close it, and the actor that notices buys from the house and sells into
      that bid. This is the arbitrage that survives the desk joining the
      ladder; the old shop-versus-floor one is closed by the engine itself.
    */
    const houseBid = Number(stats.houseBid ?? 0);
    const houseAsk = Number(stats.houseAsk ?? 0);
    const p2pBid = Number(stats.p2pBid ?? 0);
    const p2pAsk = Number(stats.p2pAsk ?? 0);
    if (houseAsk > 0 && p2pBid > houseAsk && spendableGold > houseAsk + 1) {
      arbitrage.push({ item, direction: 'house-to-p2p', buy: houseAsk, sell: p2pBid, band });
    }
    if (houseBid > 0 && p2pAsk > 0 && houseBid > p2pAsk && spendableGold > p2pAsk + 1) {
      arbitrage.push({ item, direction: 'p2p-to-house', buy: p2pAsk, sell: houseBid, band });
    }

    // Where this actor's own two-sided quote should be, and whether what it
    // already has resting is close enough to leave alone.
    if (fair > 0) {
      const skewBps = Math.max(-600, Math.min(600,
        Math.round(((held - target) / Math.max(1, target)) * 300)));
      for (const side of ['buy', 'sell']) {
        const wanted = quotePrice(side, stats, fair, skewBps);
        if (wanted <= 0) continue;
        const live = liveHere.find((order) => order.side === side);
        const drift = live ? Math.abs(Number(live.price) - wanted) : Infinity;
        quotes.push({ item, side, price: wanted, fair, live, drift, band,
          held, target, stats });
      }
    }
  }

  /*
    What is worth pulling: about to expire, priced where it can no longer
    trade, or drifted so far from fair value that it is a gift to whoever takes
    it. The band check is new and it matters -- an order the corridor has moved
    away from is not refused, it just stops being reachable, and it holds
    escrow while it does nothing.
  */
  const stale = ownOrders.filter((order) => {
    if ((order.expiresAt ?? 0) - Date.now() < 24 * 3600_000) return true;
    const stats = view.market?.[order.item] ?? {};
    const band = stats.band;
    if (band?.low > 0 && order.price < band.low) return true;
    if (band?.high > 0 && order.price > band.high) return true;
    const fair = fairValue(stats, view.desks?.[order.item]);
    if (!fair) return false;
    if (order.side === 'sell' && order.price > fair * 1.5) return true;
    if (order.side === 'buy' && order.price < fair * 0.6) return true;
    return false;
  });
  return { gold, spendableGold, ownOrders, needs, excess, arbitrage, quotes, stale };
}

const affordableOrderQuantity = (price, wanted, gold) => {
  const minimum = Math.max(1, Math.ceil(10 / Math.max(1, price)));
  const affordable = Math.floor(Math.max(0, gold - 1) / Math.max(1, price));
  return Math.max(0, Math.min(Math.max(minimum, wanted), affordable, 20));
};

/** How many units this actor can legally and affordably show at `price`. */
function quoteSize(quote, player, gold) {
  const minimum = Math.max(1, Math.ceil(10 / Math.max(1, quote.price)));
  const appetite = Math.max(minimum, Math.min(style().depth, Math.max(1, quote.target)));
  if (quote.side === 'sell') {
    const spare = (player.inventory?.[quote.item] ?? 0) - Math.floor(quote.target / 2);
    return Math.max(0, Math.min(appetite, spare));
  }
  const affordable = Math.floor(Math.max(0, gold - 1) / Math.max(1, quote.price));
  return Math.max(0, Math.min(appetite, affordable, Math.max(0, quote.target - quote.held)));
}

async function economicAction(action, player, view, intel) {
  const choose = (list) => list[Math.floor(random() * list.length)];

  if (action === 'goods_cancel_all') {
    const updated = await api.cancelGoldOrders();
    return result('goods.order.cancel-all', updated, {
      expected: intel.ownOrders.length, strategy: 'batch-withdraw-all',
    });
  }

  if (action === 'goods_maintain') {
    await api.maintainGoldOrders(25);
    const updated = await refresh();
    return result('goods.order.maintain', updated, { limit: 25 });
  }

  if (action === 'goods_cancel') {
    /* Leaving is one intent, however many quotes it touches. Three or more
       stale orders in one market is exactly the case batch cancel exists for:
       one message instead of three, and no window in which half of a maker's
       book has been pulled and half has not. */
    const byItem = new Map();
    for (const order of intel.stale) {
      byItem.set(order.item, (byItem.get(order.item) ?? 0) + 1);
    }
    const worst = [...byItem.entries()].sort((a, b) => b[1] - a[1])[0];
    if (worst && worst[1] >= 3) {
      const updated = await api.cancelGoldOrders({ item: worst[0] });
      return result('goods.order.cancel-all', updated,
        { item: worst[0], expected: worst[1], strategy: 'batch-withdraw' });
    }
    const order = choose(intel.stale.length ? intel.stale : intel.ownOrders);
    if (!order) return result('idle.no-economic-opportunity', player, { requested: action });
    let updated;
    try { updated = await api.cancelGoldOrder(order.id); }
    catch (error) {
      if (!staleOrder(error)) throw error;
      return result('idle.order-race', await refresh().catch(() => player), {
        orderId: order.id, venue: 'game', outcome: 'order-cleared-before-cancel',
      });
    }
    return result('goods.order.cancel', updated, { orderId: order.id, item: order.item });
  }

  if (action === 'goods_amend') {
    /* Moving a quote, in ONE message.

       This is the action the book did not have, and its absence is why a maker
       either quoted stale prices or paid twice to move: cancel-and-replace is
       two slots, two creation costs, and the back of a queue it was near the
       front of. Shrinking at the same price keeps the queue place; a new price
       re-queues, and the process says which in `requeued`. */
    const moving = intel.quotes
      .filter((quote) => quote.live && quote.drift >= 1)
      .sort((a, b) => b.drift - a.drift)[0];
    if (moving) {
      const size = Math.max(1, Math.min(Number(moving.live.remaining) || 1,
        quoteSize(moving, player, intel.spendableGold) || Number(moving.live.remaining) || 1));
      let updated;
      try {
        updated = await api.amendGoldOrder(moving.live.id,
          { price: moving.price, quantity: size });
      } catch (error) {
        if (!staleOrder(error)) throw error;
        return result('idle.order-race', await refresh().catch(() => player), {
          orderId: moving.live.id, venue: 'game', outcome: 'order-cleared-before-amend',
        });
      }
      return result('goods.order.amend', updated, {
        orderId: moving.live.id, item: moving.item, side: moving.side,
        from: moving.live.price, to: moving.price, quantity: size,
        fair: Math.round(moving.fair), strategy: 'reprice-to-fair',
      });
    }
  }

  if (action === 'shop_trade') {
    /* The Shop tab still exists and is still the right place to trade at the
       desk deliberately -- a fixed price, filled immediately, with none of the
       book's uncertainty. An actor uses it when it needs Gold now or wants to
       dump inventory the book is not bidding for. */
    const sellable = intel.excess.filter(({ desk, quantity }) => desk && !desk.pause?.sell
      && quantity > 0 && desk.stock < desk.stockCap && desk.goldReserve > 0);
    if (intel.gold < 20 && sellable.length) {
      const opportunity = choose(sellable);
      const quantity = Math.max(1, Math.min(3, opportunity.quantity,
        opportunity.desk.stockCap - opportunity.desk.stock));
      let updated;
      try { updated = await api.tradeGameShop('sell', opportunity.item, quantity); }
      catch (error) {
        if (!staleShop(error)) throw error;
        return result('idle.shop-race', await refresh().catch(() => player), {
          item: opportunity.item, side: 'sell', outcome: 'desk-moved-before-trade',
        });
      }
      return result('shop.sell', updated, { item: opportunity.item, quantity,
        expectedUnitPrice: opportunity.desk.bid, counterparty: 'NPC' });
    }
    const deskNeeds = intel.needs.filter(({ item }) => {
      const desk = view.desks?.[item];
      return desk && !desk.pause?.buy && Number(desk.stock ?? 0) > 0;
    });
    if (deskNeeds.length) {
      const opportunity = choose(deskNeeds);
      const desk = view.desks[opportunity.item];
      // Never ask for more than is on the shelf: a desk holding one refuses a
      // request for three outright rather than filling what it can.
      const quantity = Math.max(1, Math.min(3, opportunity.target - opportunity.held,
        Math.floor(intel.spendableGold / Math.max(1, Number(desk.ask) || 1)),
        Number(desk.stock) || 1));
      let updated;
      try { updated = await api.tradeGameShop('buy', opportunity.item, quantity); }
      catch (error) {
        if (!staleShop(error)) throw error;
        return result('idle.shop-race', await refresh().catch(() => player), {
          item: opportunity.item, side: 'buy', outcome: 'desk-moved-before-trade',
        });
      }
      return result('shop.buy', updated, { item: opportunity.item, quantity,
        expectedUnitPrice: desk.ask, counterparty: 'NPC' });
    }
    const opportunity = sellable[0];
    if (opportunity) {
      let updated;
      try { updated = await api.tradeGameShop('sell', opportunity.item, 1); }
      catch (error) {
        if (!staleShop(error)) throw error;
        return result('idle.shop-race', await refresh().catch(() => player), {
          item: opportunity.item, side: 'sell', outcome: 'desk-moved-before-trade',
        });
      }
      return result('shop.sell', updated, { item: opportunity.item, quantity: 1,
        expectedUnitPrice: opportunity.desk.bid, counterparty: 'NPC' });
    }
  }

  if (action === 'goods_take') {
    /* Taking is an IOC now, which is what a market order actually is: sweep
       the ladder at a limit computed from the ladder, and cancel whatever the
       book could not fill instead of leaving a stray resting order behind at a
       price this actor chose for a different reason.

       Occasionally it is a FOK instead. An actor that only ever sends one time
       in force is an actor that never tests the others, and all-or-none is the
       one whose failure path has to be free -- so it is worth exercising even
       though it is the rarer real-world choice. */
    const opportunities = intel.needs
      .filter(({ cheap, urgent }) => cheap || urgent)
      .sort((a, b) => a.plan.average - b.plan.average);
    const opportunity = opportunities[0] ?? choose(intel.needs);
    if (opportunity?.plan?.units > 0) {
      const quantity = affordableOrderQuantity(opportunity.plan.limit,
        opportunity.plan.units, intel.spendableGold);
      if (quantity > 0) {
        const allOrNone = random() < 0.15 && quantity <= opportunity.plan.units;
        const tif = allOrNone ? 'FOK' : 'IOC';
        const updated = await api.placeGoldOrder('buy', opportunity.item,
          opportunity.plan.limit, quantity, { tif });
        return result('goods.order.buy', updated, {
          item: opportunity.item, price: opportunity.plan.limit, quantity, tif,
          fair: Math.round(opportunity.fair),
          strategy: opportunity.cheap ? 'take-below-fair' : 'take-to-cover-deficit',
        });
      }
    }
  }

  if (action === 'goods_make') {
    /* Quoting, as a maker rather than as somebody dumping stock.

       PostOnly is not decoration: it is the difference between adding
       liquidity and accidentally paying to remove it. The price is already
       held off the touch by `quotePrice`, so the tag is the belt to that
       braces -- if the book moved between the read and the write, the order is
       refused instead of quietly crossing at a price this actor never chose.

       And when there is already a quote on this side, this MOVES it rather
       than adding a second one. Twenty stacked quotes from one wallet is not
       liquidity, it is the per-account cap being burned. */
    const candidates = intel.quotes
      .filter((quote) => quoteSize(quote, player, intel.spendableGold) > 0)
      .filter((quote) => quote.price * quoteSize(quote, player, intel.spendableGold) >= 10);
    const fresh = candidates.filter((quote) => !quote.live);
    const quote = fresh.length ? choose(fresh) : candidates.find((entry) => entry.drift >= 1);
    if (quote) {
      const size = quoteSize(quote, player, intel.spendableGold);
      if (quote.live) {
        let updated;
        try {
          updated = await api.amendGoldOrder(quote.live.id,
            { price: quote.price, quantity: size });
        } catch (error) {
          if (!staleOrder(error)) throw error;
          return result('idle.order-race', await refresh().catch(() => player), {
            orderId: quote.live.id, venue: 'game', outcome: 'order-cleared-before-amend',
          });
        }
        return result('goods.order.amend', updated, {
          orderId: quote.live.id, item: quote.item, side: quote.side,
          from: quote.live.price, to: quote.price, quantity: size,
          strategy: 'requote-existing-side',
        });
      }
      let updated;
      try {
        updated = await api.placeGoldOrder(quote.side, quote.item, quote.price, size,
          { tif: 'PostOnly' });
      } catch (error) {
        if (!staleOrder(error)) throw error;
        return result('idle.order-race', await refresh().catch(() => player), {
          item: quote.item, side: quote.side, venue: 'game',
          outcome: 'book-moved-before-post-only',
        });
      }
      return result(quote.side === 'sell' ? 'goods.order.sell' : 'goods.order.bid', updated, {
        item: quote.item, price: quote.price, quantity: size, tif: 'PostOnly',
        fair: Math.round(quote.fair), skew: quote.held - quote.target,
        strategy: 'two-sided-maker',
      });
    }
  }

  if (action === 'arbitrage') {
    if (tradePlan) {
      const plan = tradePlan;
      tradePlan = null;
      const available = player.inventory?.[plan.item] ?? 0;
      const quantity = Math.min(plan.quantity, available);
      if (quantity > 0) {
        if (plan.destination === 'npc') {
          const updated = await api.tradeGameShop('sell', plan.item, quantity);
          return result('arbitrage.sell.npc', updated, { ...plan, quantity, counterparty: 'NPC' });
        }
        // Sold back into the book as an IOC: the resting bid this actor is
        // hitting is the whole reason the trade exists, so anything that does
        // not fill against it should not be left behind as a quote.
        const updated = await api.placeGoldOrder('sell', plan.item, plan.sell, quantity,
          { tif: 'IOC' });
        return result('arbitrage.sell.p2p', updated, { ...plan, quantity, tif: 'IOC' });
      }
    }
    // The ordinary maker stays inside the touch, so intentionally create the
    // one real crossed quote the desk design permits: an NPC desk does not rest
    // an order, and a P2P bid may sit one tick above its ask. Another actor can
    // then buy from the house and sell into that bid.
    if (!intel.arbitrage.length) {
      const setup = goodsIds.map((item) => {
        const stats = view.market?.[item] ?? {};
        return { item, ask: Number(stats.houseAsk ?? 0),
          high: Number(stats.band?.high ?? 0) };
      }).find(({ ask, high }) => ask >= 10 && intel.spendableGold > ask + 2
        && (!high || ask + 1 <= high));
      if (setup) {
        const price = setup.ask + 1;
        try {
          const updated = await api.placeGoldOrder('buy', setup.item, price, 1,
            { tif: 'PostOnly' });
          return result('goods.order.bid', updated, {
            item: setup.item, price, quantity: 1, tif: 'PostOnly',
            purpose: 'arbitrage-liquidity-bootstrap',
          });
        } catch (error) {
          if (!staleOrder(error)) throw error;
          const message = error instanceof Error ? error.message : String(error);
          if (/post-only order may not cross/i.test(message)) {
            return result('arbitrage.prevented-cross', await refresh().catch(() => player), {
              item: setup.item, side: 'buy', venue: 'game', price,
              outcome: 'npc-desk-keeps-the-book-uncrossed', refusal: message,
            });
          }
          return result('idle.order-race', await refresh().catch(() => player), {
            item: setup.item, side: 'buy', venue: 'game',
            outcome: 'arbitrage-bootstrap-book-moved',
          });
        }
      }
    }
    const opportunity = intel.arbitrage.sort((a, b) => (b.sell - b.buy) - (a.sell - a.buy))[0];
    if (opportunity) {
      const quantity = affordableOrderQuantity(opportunity.buy, 2, intel.spendableGold);
      if (quantity > 0) {
        if (opportunity.direction === 'house-to-p2p') {
          // Buying from the house THROUGH the book, not through the Shop tab:
          // the desk is in this ladder, so an IOC at its ask takes it, and the
          // same message takes any player who happens to be cheaper.
          const updated = await api.placeGoldOrder('buy', opportunity.item,
            opportunity.buy, quantity, { tif: 'IOC' });
          tradePlan = { item: opportunity.item, quantity, destination: 'p2p',
            buy: opportunity.buy, sell: opportunity.sell };
          return result('arbitrage.buy.house', updated, { ...tradePlan, tif: 'IOC' });
        }
        const updated = await api.placeGoldOrder('buy', opportunity.item,
          opportunity.buy, quantity, { tif: 'IOC' });
        tradePlan = { item: opportunity.item, quantity, destination: 'npc',
          buy: opportunity.buy, sell: opportunity.sell };
        return result('arbitrage.buy.p2p', updated, { ...tradePlan, tif: 'IOC' });
      }
    }
  }
  return result('idle.no-economic-opportunity', player, { requested: action });
}

/** Turn surplus inventory into the next arena stake without gambling on a bid. */
async function recoverArenaGold(player) {
  const goldBefore = Number(player.gold ?? 0);
  if (goldBefore >= ARENA_MIN_ENTRY) return null;
  const view = await economy();
  const intel = tradeIntelligence(player, view);
  if (!view || !intel) return null;
  const opportunity = intel.excess
    .filter(({ desk, quantity }) => desk && !desk.pause?.sell
      && quantity > 0 && Number(desk.stock ?? 0) < Number(desk.stockCap ?? 0)
      && Number(desk.goldReserve ?? 0) > 0 && Number(desk.bid ?? 0) > 0)
    .sort((left, right) => Number(right.desk.bid) - Number(left.desk.bid))[0];
  if (!opportunity) return null;

  const unitPrice = Number(opportunity.desk.bid);
  const capacity = Math.min(
    Number(opportunity.quantity),
    Number(opportunity.desk.stockCap) - Number(opportunity.desk.stock),
    Math.floor(Number(opportunity.desk.goldReserve) / unitPrice),
  );
  const quantity = Math.min(capacity,
    Math.max(1, Math.ceil((ARENA_MIN_ENTRY - goldBefore) / unitPrice)));
  if (quantity <= 0) return null;

  let updated;
  try { updated = await api.tradeGameShop('sell', opportunity.item, quantity); }
  catch (error) {
    if (!staleShop(error)) throw error;
    return result('idle.shop-race', await refresh().catch(() => player), {
      item: opportunity.item, side: 'sell', outcome: 'arena-recovery-desk-moved',
    });
  }
  return result('shop.sell', updated, {
    item: opportunity.item,
    quantity,
    expectedUnitPrice: unitPrice,
    counterparty: 'NPC',
    purpose: 'arena-stake-recovery',
    goldBefore,
    goldAfter: Number(updated.gold ?? goldBefore),
  });
}

function arenaSettlement(before, after, battleId) {
  if (!before || before.activeBattleId !== battleId || after?.activeBattleId === battleId) {
    return null;
  }
  return after?.arenaLast ?? null;
}

function arenaSettlementDetail(receipt, before, after, battleId, detail = {}) {
  return {
    ...detail,
    battleId,
    arena: receipt,
    goldBefore: Number(before?.gold ?? 0),
    goldAfter: Number(after?.gold ?? 0),
  };
}

// The two custody venues -----------------------------------------------------

const venueProgress = { internal: new Set(), external: new Set() };
const actorNumber = Number(profile.wallet.slice('burner-'.length)) || 1;
const makerSide = actorNumber % 2 === 1 ? 'sell' : 'buy';
const asAmount = (value) => {
  try { return BigInt(String(value ?? '0')); } catch { return 0n; }
};

async function internalVenueAction(player) {
  const process = api.INTERNAL_VENUE_PROCESS;
  const [position, book] = await Promise.all([
    api.readVenuePosition(process, address), api.readVenueBook(process),
  ]);
  const marketView = book?.['fire_berry/gold'];
  if (!marketView || marketView.status !== 'open') {
    return result('idle.venue-internal-closed', player);
  }
  const freeGold = Number(position.free?.gold ?? 0);
  const freeBerry = Number(position.free?.fire_berry ?? 0);
  const orders = position.orders ?? [];
  const own = orders.find((order) => order.item === 'fire_berry' && order.side === makerSide);
  const internalDistance = [0, 1, 2, 3, 4][actorNumber % 5];
  const internalTargetPrice = makerSide === 'sell'
    ? Math.min(15, Math.max(Number(marketView.bestBid ?? 0) + 1, 10 + internalDistance))
    : Math.max(5, Math.min(
      Number(marketView.bestAsk ?? 10) > 1 ? Number(marketView.bestAsk ?? 10) - 1 : 9,
      9 - internalDistance,
    ));

  // A completed fill changes the other side's account too. Once it is visible,
  // prove the exit path before putting that value back to work.
  if ((position.fills?.length ?? 0) > 0 && !venueProgress.internal.has('withdraw')) {
    const asset = makerSide === 'sell' ? 'gold' : 'fire_berry';
    const available = Number(position.free?.[asset] ?? 0);
    if (available > 0) {
      venueProgress.internal.add('withdraw');
      let receipt;
      try {
        receipt = await api.withdrawFromVenue(process, asset, Math.min(available, 2));
      } catch (error) {
        if (!acceptedDelivery(error)) throw error;
        return result('venue.internal.withdraw', player, {
          asset, quantity: Math.min(available, 2), deliveryState: 'accepted-delivery-unconfirmed',
          slot: error.slot ?? null,
        });
      }
      return result('venue.internal.withdraw', player, {
        asset, quantity: Math.min(available, 2), withdrawal: receipt.withdrawal?.id ?? null,
      });
    }
  }

  // Custody first. Odd-numbered wallets supply berries; even-numbered wallets
  // supply Gold, creating natural two-sided flow without one fifty-handed bot.
  if (makerSide === 'sell' && freeBerry < 4) {
    const held = Number(player.inventory?.fire_berry ?? 0);
    if (held >= 4) {
      let updated;
      try {
        updated = await api.sendToVenue('fire_berry', Math.min(8, held));
      } catch (error) {
        if (!acceptedDelivery(error)) throw error;
        return result('venue.internal.deposit', player, {
          asset: 'fire_berry', quantity: Math.min(8, held), side: makerSide,
          deliveryState: 'accepted-delivery-unconfirmed', slot: error.slot ?? null,
        });
      }
      return result('venue.internal.deposit', updated, {
        asset: 'fire_berry', quantity: Math.min(8, held), side: makerSide,
      });
    }
  }
  if (makerSide === 'buy' && freeGold < 40) {
    const held = Number(player.gold ?? 0);
    const spendable = Math.max(0, held - arenaGoldReserve);
    if (spendable >= 40) {
      const quantity = Math.min(100, spendable);
      let updated;
      try {
        updated = await api.sendToVenue('gold', quantity);
      } catch (error) {
        if (!acceptedDelivery(error)) throw error;
        return result('venue.internal.deposit', player, {
          asset: 'gold', quantity, side: makerSide,
          deliveryState: 'accepted-delivery-unconfirmed', slot: error.slot ?? null,
        });
      }
      return result('venue.internal.deposit', updated, {
        asset: 'gold', quantity, side: makerSide,
      });
    }
  }

  if (own && !venueProgress.internal.has('amend') && Number(own.remaining) > 0) {
    venueProgress.internal.add('amend');
    let receipt;
    try {
      receipt = await api.amendVenueOrder(process, own.id,
        { price: internalTargetPrice, quantity: Math.max(1, Number(own.remaining) - 1) });
    } catch (error) {
      if (!staleOrder(error)) throw error;
      return result('idle.order-race', player, {
        orderId: own.id, venue: 'internal', outcome: 'order-cleared-before-amend',
      });
    }
    return result('venue.internal.order.amend', player, {
      orderId: own.id, side: own.side, price: internalTargetPrice,
      quantity: Math.max(1, Number(own.remaining) - 1),
      account: receipt.account?.account,
    });
  }
  if (own && venueProgress.internal.has('amend')
      && !venueProgress.internal.has('cancel') && actorNumber % 4 === 1) {
    venueProgress.internal.add('cancel');
    try { await api.cancelVenueOrder(process, own.id); }
    catch (error) {
      if (!staleOrder(error)) throw error;
      return result('idle.order-race', player, {
        orderId: own.id, venue: 'internal', outcome: 'order-cleared-before-cancel',
      });
    }
    return result('venue.internal.order.cancel', player, { orderId: own.id, side: own.side });
  }

  const asks = marketView.depth?.asks ?? [];
  const bids = marketView.depth?.bids ?? [];
  // Some wallets cross, some provide depth. The former all crossed the same
  // best ask, which proved fills but collapsed the entire book to 9/10.
  if (makerSide === 'buy' && actorNumber % 4 === 0
      && asks.length && freeGold >= Number(asks[0].price)) {
    const price = Number(asks[0].price);
    const receipt = await api.placeVenueOrder(process, 'buy', 'fire_berry', price, 1,
      { tif: 'IOC' });
    const fills = receipt.order?.fills ?? [];
    return result(fills.length ? 'venue.internal.order.fill' : 'venue.internal.order.take-empty',
      player, { side: 'buy', price, quantity: 1, fills: fills.length });
  }
  if (makerSide === 'sell' && actorNumber % 4 === 3 && bids.length && freeBerry >= 1) {
    const price = Number(bids[0].price);
    const receipt = await api.placeVenueOrder(process, 'sell', 'fire_berry', price, 1,
      { tif: 'IOC' });
    const fills = receipt.order?.fills ?? [];
    return result(fills.length ? 'venue.internal.order.fill' : 'venue.internal.order.take-empty',
      player, { side: 'sell', price, quantity: 1, fills: fills.length });
  }

  if (!own) {
    const price = internalTargetPrice;
    const quantity = makerSide === 'sell'
      ? Math.min(4, freeBerry)
      : Math.min(4, Math.floor(freeGold / Math.max(1, price)));
    if (quantity > 0) {
      let receipt;
      try {
        receipt = await api.placeVenueOrder(process, makerSide, 'fire_berry', price,
          quantity, { tif: 'PostOnly' });
      } catch (error) {
        if (!staleOrder(error)) throw error;
        return result('idle.order-race', player, {
          side: makerSide, venue: 'internal', outcome: 'book-moved-before-post-only',
        });
      }
      const orderId = receipt.order?.order?.id ?? null;
      if (orderId && actorNumber % 4 === 1 && !venueProgress.internal.has('cancel')) {
        await api.cancelVenueOrder(process, orderId);
        venueProgress.internal.add('cancel');
        return result('venue.internal.order.cancel', player, {
          orderId, side: makerSide, placedForCancellation: true,
        });
      }
      return result(`venue.internal.order.${makerSide === 'sell' ? 'ask' : 'bid'}`, player, {
        side: makerSide, price, quantity, orderId,
      });
    }
  }
  return result('idle.venue-internal-waiting', player, {
    side: makerSide, freeGold, freeBerry, orders: orders.length,
  });
}

async function externalVenueAction(player) {
  const process = api.EXTERNAL_VENUE_PROCESS;
  const [position, book] = await Promise.all([
    api.readVenuePosition(process, address), api.readVenueBook(process),
  ]);
  const marketView = book?.['rune/relic'];
  if (!marketView || marketView.status !== 'open') {
    return result('idle.venue-external-closed', player);
  }
  const freeRune = asAmount(position.free?.rune);
  const freeRelic = asAmount(position.free?.relic);
  const orders = position.orders ?? [];
  const own = orders.find((order) => order.item === 'rune' && order.side === makerSide);
  const externalDistance = [0, 10_000, 25_000, 50_000, 100_000, 175_000, 300_000, 500_000]
    [actorNumber % 8];
  const externalTargetPrice = makerSide === 'sell'
    ? Math.min(3_000_000, Math.max(
      Number(marketView.bestBid ?? 0) + 1_000, 2_000_000 + externalDistance,
    ))
    : Math.max(1_000_000, Math.min(
      Number(marketView.bestAsk ?? 2_000_000) > 1_000
        ? Number(marketView.bestAsk ?? 2_000_000) - 1_000 : 1_900_000,
      1_900_000 - externalDistance,
    ));

  if ((position.fills?.length ?? 0) > 0 && !venueProgress.external.has('withdraw')) {
    const asset = makerSide === 'sell' ? 'relic' : 'rune';
    const available = asAmount(position.free?.[asset]);
    const quantity = available > 1_000_000n ? 1_000_000n : available;
    if (quantity > 0n) {
      venueProgress.external.add('withdraw');
      let receipt;
      try {
        receipt = await api.withdrawFromVenue(process, asset, quantity.toString());
      } catch (error) {
        if (!acceptedDelivery(error)) throw error;
        return result('venue.external.withdraw', player, {
          asset, quantity: quantity.toString(), deliveryState: 'accepted-delivery-unconfirmed',
          slot: error.slot ?? null,
        });
      }
      return result('venue.external.withdraw', player, {
        asset, quantity: quantity.toString(), withdrawal: receipt.withdrawal?.id ?? null,
      });
    }
  }

  if (makerSide === 'sell' && freeRune < 2_000_000n) {
    const walletRune = asAmount(await api.readTokenBalance(api.RUNE_PROCESS, address));
    if (walletRune < 2_000_000n) {
      const gameRune = Number(player.inventory?.rune ?? 0);
      const reserve = targetHolding(player, 'rune');
      if (gameRune > reserve + 2) {
        const amount = Math.min(3, gameRune - reserve);
        try {
          const updated = await api.withdrawRune(amount);
          return result('rune.withdraw', updated?.address ? updated : player, {
            amount, purpose: 'external-venue', state: updated?.withdrawal?.state ?? 'pending',
          });
        } catch (error) {
          if (!acceptedDelivery(error)) throw error;
          return result('rune.withdraw', player, {
            amount, purpose: 'external-venue', deliveryState: 'accepted-delivery-unconfirmed',
            slot: error.slot ?? null,
          });
        }
      }
    } else {
      const quantity = (walletRune > 4_000_000n ? 4_000_000n : walletRune).toString();
      try {
        await api.depositTokenToVenue(api.RUNE_PROCESS, process, quantity);
      } catch (error) {
        if (!acceptedDelivery(error)) throw error;
        return result('venue.external.deposit.rune', player, {
          asset: 'rune', quantity, deliveryState: 'accepted-delivery-unconfirmed',
          slot: error.slot ?? null,
        });
      }
      return result('venue.external.deposit.rune', player, { asset: 'rune', quantity });
    }
  }

  if (makerSide === 'buy' && freeRelic < 4_000_000n) {
    const walletRelic = asAmount(await api.readTokenBalance(api.QUOTE_PROCESS, address));
    if (walletRelic < 4_000_000n) {
      const receipt = await api.claimQuoteFaucet();
      return result('venue.external.faucet', player, { balance: receipt?.Balance ?? null });
    }
    const quantity = (walletRelic > 5_000_000n ? 5_000_000n : walletRelic).toString();
    try {
      await api.depositTokenToVenue(api.QUOTE_PROCESS, process, quantity);
    } catch (error) {
      if (!acceptedDelivery(error)) throw error;
      return result('venue.external.deposit.relic', player, {
        asset: 'relic', quantity, deliveryState: 'accepted-delivery-unconfirmed',
        slot: error.slot ?? null,
      });
    }
    return result('venue.external.deposit.relic', player, { asset: 'relic', quantity });
  }

  if (own && !venueProgress.external.has('amend') && Number(own.remaining) > 0) {
    venueProgress.external.add('amend');
    try {
      await api.amendVenueOrder(process, own.id, {
        price: externalTargetPrice, quantity: Math.max(1, Number(own.remaining) - 1),
      });
    } catch (error) {
      if (!staleOrder(error)) throw error;
      return result('idle.order-race', player, {
        orderId: own.id, venue: 'external', outcome: 'order-cleared-before-amend',
      });
    }
    return result('venue.external.order.amend', player, {
      orderId: own.id, side: own.side, price: externalTargetPrice,
      quantity: Math.max(1, Number(own.remaining) - 1),
    });
  }
  if (own && venueProgress.external.has('amend')
      && !venueProgress.external.has('cancel') && actorNumber % 4 === 1) {
    venueProgress.external.add('cancel');
    try { await api.cancelVenueOrder(process, own.id); }
    catch (error) {
      if (!staleOrder(error)) throw error;
      return result('idle.order-race', player, {
        orderId: own.id, venue: 'external', outcome: 'order-cleared-before-cancel',
      });
    }
    return result('venue.external.order.cancel', player, { orderId: own.id, side: own.side });
  }

  const asks = marketView.depth?.asks ?? [];
  const bids = marketView.depth?.bids ?? [];
  if (makerSide === 'buy' && actorNumber % 4 === 0 && asks.length) {
    const price = Number(asks[0].price);
    const required = BigInt(price) + ((BigInt(price) * 30n) / 10_000n) + 1n;
    if (freeRelic >= required) {
      const receipt = await api.placeVenueOrder(process, 'buy', 'rune', price, 1,
        { tif: 'IOC' });
      const fills = receipt.order?.fills ?? [];
      return result(fills.length ? 'venue.external.order.fill' : 'venue.external.order.take-empty',
      player, { side: 'buy', price, quantity: 1, fills: fills.length });
    }
  }
  if (makerSide === 'sell' && actorNumber % 4 === 3
      && bids.length && freeRune >= 1_000_000n) {
    const price = Number(bids[0].price);
    const receipt = await api.placeVenueOrder(process, 'sell', 'rune', price, 1,
      { tif: 'IOC' });
    const fills = receipt.order?.fills ?? [];
    return result(fills.length ? 'venue.external.order.fill' : 'venue.external.order.take-empty',
      player, { side: 'sell', price, quantity: 1, fills: fills.length });
  }

  if (!own) {
    const price = externalTargetPrice;
    const quantity = makerSide === 'sell'
      ? Math.min(3, Number(freeRune / 1_000_000n))
      : Math.min(2, Number(freeRelic / BigInt(Math.max(1, price))));
    if (quantity > 0) {
      let receipt;
      try {
        receipt = await api.placeVenueOrder(process, makerSide, 'rune', price, quantity,
          { tif: 'PostOnly' });
      } catch (error) {
        if (!staleOrder(error)) throw error;
        return result('idle.order-race', player, {
          side: makerSide, venue: 'external', outcome: 'book-moved-before-post-only',
        });
      }
      return result(`venue.external.order.${makerSide === 'sell' ? 'ask' : 'bid'}`, player, {
        side: makerSide, price, quantity, orderId: receipt.order?.order?.id ?? null,
      });
    }
  }
  return result('idle.venue-external-waiting', player, {
    side: makerSide, freeRune: freeRune.toString(), freeRelic: freeRelic.toString(),
    orders: orders.length,
  });
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
      return result('monster.retrieve', player, { recovery: 'empty-roster' });
    }
    const runes = player.inventory?.rune ?? 0;
    const affordable = Object.values(await market())
      .filter((entry) => entry.seller !== address && Number(entry.price) <= runes);
    if (affordable.length) {
      const listing = affordable[Math.floor(random() * affordable.length)];
      try {
        player = await api.buyListing(listing.id);
      } catch (error) {
        if (!missingListing(error)) throw error;
        player = await refresh().catch(() => player);
        return result('idle.market-race', player, {
          listingId: listing.id, outcome: 'listing-cleared-before-buy',
        });
      }
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
  const landed = await settleOrAccept(() => api.attack(battle.id, move, battle.round));
  const refreshed = landed.value ?? await refresh().catch(() => player);
  const updated = refreshed?.address ? refreshed : player;
  const receipt = arenaSettlement(player, updated, battle.id);
  const delivery = landed.accepted
    ? { deliveryState: 'accepted-delivery-unconfirmed', slot: landed.slot } : {};
  if (receipt) {
    return result('battle.settle.bot', updated,
      arenaSettlementDetail(receipt, player, updated, battle.id, { move, ...delivery }));
  }
  return result('battle.attack.bot', updated, { move, ...delivery });
}

/** Drive a whole Hunt worker session instead of stopping after Hunt.Begin. */
async function huntTick(player, prefer) {
  const route = player.hunt;
  if (!route) return result('idle.hunt-route', player);
  let run;
  try { run = await api.readHunt(route); }
  catch (error) {
    if (!/hunt not found/i.test(error instanceof Error ? error.message : String(error))) throw error;
    run = null;
  }
  if (!run) {
    // `Hunt.Begin` is explicitly idempotent while a route is opening: it does
    // not charge twice and re-emits the same Hunt.Open. This is the safe retry
    // for an accepted game write whose first downstream push never landed.
    const landed = await settleOrAccept(() => api.beginHunt(route.monsterId));
    return result('hunt.retry-open', landed.value?.address ? landed.value : player, {
      runId: route.runId,
      ...(landed.accepted ? { deliveryState: 'accepted-delivery-unconfirmed',
        slot: landed.slot } : {}),
    });
  }

  if (run.status === 'opening') {
    try {
      const updated = await api.beginHunt(route.monsterId);
      return result('hunt.retry-open', updated, { runId: route.runId });
    } catch (error) {
      if (!acceptedDelivery(error)) throw error;
      return result('hunt.retry-open', player, { runId: route.runId,
        deliveryState: 'accepted-delivery-unconfirmed', slot: error.slot ?? null });
    }
  }
  if (run.status === 'roaming') {
    // Leave completed runs often enough to exercise release settlement, while
    // still allowing repeated encounters during longer soaks.
    if ((run.encounterCount ?? 0) > 0 && (prefer === 'hunt' || random() < 0.35)) {
      const landed = await settleOrAccept(() => api.huntEnd(route));
      const updated = await refresh();
      return result('hunt.end', updated, { runId: route.runId,
        ...(landed.accepted ? { deliveryState: 'accepted-delivery-unconfirmed', slot: landed.slot } : {}) });
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
    const landed = await settleOrAccept(() => api.huntAttack(route, move, run.battle.round));
    const next = landed.value ?? run;
    return result('hunt.attack', player, {
      runId: route.runId, move, round: run.battle.round, huntStatus: next.status,
      ...(landed.accepted ? { deliveryState: 'accepted-delivery-unconfirmed', slot: landed.slot } : {}),
    });
  }
  if (run.status === 'defeated') {
    const spendableRune = Math.max(0,
      (player.inventory?.rune ?? 0) - targetHolding(player, 'rune'));
    // A Scroll IS required now, and this comment used to say the opposite.
    //
    // It was right when it was written: `hunt.lua` had no such rule, the swarm
    // had invented one, and two runs burned 45 hunts and 900 berries for zero
    // captures because of it. The game has since given the Scroll a job --
    // `C.HUNT.capture.scrollCost`, the only thing in the game that consumes
    // one -- so the requirement is real and a bot without a Scroll must DECLINE
    // rather than attempt, or every capture is a refused settlement.
    const canCapture = spendableRune > 0 && (player.inventory?.scroll ?? 0) >= 1;
    // Collectors and chaos actors lean into capture; everybody else still
    // takes that branch sometimes, leaving deliberate decline coverage too.
    const tryCapture = canCapture
      && (['collector', 'chaos'].includes(profile.role) ? random() < 0.8 : random() < 0.35);
    if (tryCapture) {
      // The bid ceiling is 3, not 5. Bidding above it is refused by both the
      // worker and the game, so a stale 5 here is a run of wasted captures.
      const bid = Math.max(1, Math.min(3, spendableRune));
      const landed = await settleOrAccept(() => api.huntCapture(route, bid));
      const next = landed.value ?? run;
      return result('hunt.capture', player, {
        runId: route.runId, runes: bid, huntStatus: next.status,
        success: next.lastCapture?.success ?? null,
        ...(landed.accepted ? { deliveryState: 'accepted-delivery-unconfirmed', slot: landed.slot } : {}),
      });
    }
    const landed = await settleOrAccept(() => api.huntDeclineCapture(route));
    const next = landed.value ?? run;
    return result('hunt.decline', player, { runId: route.runId, huntStatus: next.status,
      ...(landed.accepted ? { deliveryState: 'accepted-delivery-unconfirmed', slot: landed.slot } : {}) });
  }
  if (run.status === 'settling') {
    // The Hunt -> Game half of capture can settle durably while the recursive
    // Game -> Hunt acknowledgement misses the push deadline. The authority's
    // published route proves that exact state: it is already `roaming` and
    // carries the immutable settlement receipt, while the worker is still
    // `settling`. Restart at the authority so only one idempotent hop remains.
    if (player.hunt?.status === 'roaming' && player.hunt?.lastCapture?.settlementId) {
      const landed = await settleOrAccept(() => api.retryHuntAcknowledgement());
      const next = await api.readHunt(route).catch(() => run);
      return result('hunt.retry-ack', player, {
        runId: route.runId, huntStatus: next.status,
        ...(landed.accepted ? { deliveryState: 'accepted-delivery-unconfirmed', slot: landed.slot } : {}),
      });
    }
    const landed = await settleOrAccept(() => api.huntRetrySettlement(route));
    const next = landed.value ?? run;
    return result('hunt.retry-settlement', player, {
      runId: route.runId, huntStatus: next.status,
      ...(landed.accepted ? { deliveryState: 'accepted-delivery-unconfirmed', slot: landed.slot } : {}),
    });
  }
  if (run.status === 'lost' || run.status === 'ended') {
    const landed = await settleOrAccept(() => api.huntEnd(route));
    const updated = await refresh();
    return result('hunt.end', updated, { runId: route.runId, outcome: run.status,
      ...(landed.accepted ? { deliveryState: 'accepted-delivery-unconfirmed', slot: landed.slot } : {}) });
  }
  return result(`idle.hunt-${run.status}`, player, { runId: route.runId });
}

async function tradingTick(player, tickNumber) {
  // Offset by wallet number so fifty actors do not all hammer the same venue
  // on the same second. This focus deliberately excludes gameplay, monster
  // listings and the Rune bridge: internal venue, external venue, NPC shop.
  const walletNumber = Number(String(profile.wallet).match(/\d+/)?.[0] ?? 0);
  const lane = (tickNumber + walletNumber) % 4;
  if (lane === 0) return internalVenueAction(player);
  if (lane === 1) return externalVenueAction(player);
  if (lane === 2) {
    const economyView = await economy();
    const intelligence = tradeIntelligence(player, economyView);
    return economicAction('shop_trade', player, economyView, intelligence);
  }

  // Monster exchange: cheap listings are meant to clear, and every operation
  // is real custody. Prefer a purchase, then supply, then cancellation so the
  // thousand-interaction run produces sales instead of a wall of fake quotes.
  const listings = await market();
  const all = Object.values(listings);
  const affordable = all.filter((entry) => entry.seller !== address
    && Number(entry.price) <= Number(player.inventory?.rune ?? 0));
  const collection = ids(player.collection);
  const mine = all.filter((entry) => entry.seller === address);
  if (affordable.length) {
    const listing = affordable[Math.floor(random() * affordable.length)];
    try {
      const updated = await api.buyListing(listing.id);
      return result('market.buy', updated, {
        listingId: listing.id, price: Number(listing.price), seller: listing.seller,
      });
    } catch (error) {
      if (!missingListing(error)) throw error;
      return result('idle.market-race', await refresh().catch(() => player), {
        listingId: listing.id, outcome: 'listing-cleared-before-buy',
      });
    }
  }
  if (collection.length) {
    const monsterId = collection[Math.floor(random() * collection.length)];
    const price = 1 + ((walletNumber + tickNumber) % 20);
    const updated = await api.listMonster(monsterId, price);
    return result('market.list', updated, {
      monsterId, price, listingId: updated.listing?.id ?? null,
    });
  }
  if (mine.length) {
    const listing = mine[Math.floor(random() * mine.length)];
    try {
      const updated = await api.cancelListing(listing.id);
      return result('market.cancel', updated, { listingId: listing.id });
    } catch (error) {
      if (!missingListing(error)) throw error;
      return result('idle.market-race', await refresh().catch(() => player), {
        listingId: listing.id, outcome: 'listing-cleared-before-cancel',
      });
    }
  }
  return result('idle.market-no-inventory', player);
}

async function tick({ prefer, focus } = {}) {
  const tickNumber = ticks++;
  let player = await refresh();
  if (!player?.unlocked) return result('blocked.access', player, { blocked: true });
  if (!player.faction || !player.monster) return bootstrap();
  if (focus === 'trading') return tradingTick(player, tickNumber);

  // Worship is a 20-hour opportunity and seeds the next care/economy loop
  // with a box. An intelligent player does not gamble it against a market
  // action, and the handler is account-level so an away companion is no bar.
  if ((player.dailyReadyAt ?? 0) <= Date.now()) {
    decisionReason = 'claim-ready-worship';
    player = await api.claimDaily();
    return result('daily.claim', player);
  }

  // Before the status branches, not after them: an outfit is saved on the
  // account and not on the companion, so a companion away on a quest or frozen
  // in a hunt is no reason to skip the one write that guarantees this verb is
  // exercised at all. Placing it below would mean a busy actor never dressed.
  // Marked done only once the write came back. A refusal or dropped outbox is
  // retried, but only three times so a broken verb cannot consume the run.
  const customized = await customizeIfDue(player, tickNumber);
  if (customized) return customized;

  if (player.hunt) return huntTick(player, prefer);

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
      if (Number(player.gold ?? 0) < ARENA_STAKE) {
        const recovered = await recoverArenaGold(player);
        if (recovered) return recovered;
        const goldBefore = Number(player.gold ?? 0);
        player = await api.leaveArena();
        return result('arena.leave.insufficient-gold', player, {
          goldBefore,
          requiredGold: ARENA_STAKE,
          recovery: 'quest-or-shop-required',
        });
      }
      const goldBefore = Number(player.gold ?? 0);
      try {
        player = await api.startBotBattle(profile.botDifficulty);
        return result('battle.start.bot', player, {
          difficulty: profile.botDifficulty,
          goldBefore,
          goldAfter: Number(player.gold ?? 0),
          stakeGold: goldBefore - Number(player.gold ?? 0),
          potGold: Number(player.battle?.arena?.pot ?? 0),
        });
      } catch (error) {
        if (!acceptedDelivery(error)) throw error;
        const accepted = await refresh().catch(() => player);
        const goldAfter = Number(accepted.gold ?? goldBefore);
        const confirmed = goldBefore - goldAfter === ARENA_STAKE
          && accepted.activeBattleId;
        return result(confirmed ? 'battle.start.bot' : 'battle.start.bot.accepted-unconfirmed',
          accepted, {
            difficulty: profile.botDifficulty,
            goldBefore,
            goldAfter,
            stakeGold: goldBefore - goldAfter,
            deliveryState: 'accepted-delivery-unconfirmed',
            slot: error.slot ?? null,
          });
      }
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
  const [listings, economyView] = await Promise.all([market(), economy()]);
  const mine = Object.values(listings).filter((entry) => entry.seller === address);
  const affordable = Object.values(listings)
    .filter((entry) => entry.seller !== address && Number(entry.price) <= runes);
  const intelligence = tradeIntelligence(player, economyView);
  const runeReserve = targetHolding(player, 'rune');

  // The bridge is only reachable on a deployment that actually has the token
  // processes wired. A blank or --no-market deploy leaves the ids unset, and an
  // actor should skip those verbs there rather than sign a message at a
  // placeholder process id.
  const exchangeReady = api.exchangeConfigured();
  // The wallet-side TEST-RUNE balance -- what a settled withdrawal produced,
  // and the only thing `deposit` can burn back into the game.
  const tokenBalance = exchangeReady
    ? await api.readTokenBalance(api.RUNE_PROCESS, address)
      .then(asAmount).catch(() => 0n)
    : 0n;

  add('daily', (player.dailyReadyAt ?? 0) <= Date.now());
  add('loot', (player.lootboxes?.length ?? 0) > 0 && status === 'Home');
  add('feed', !!berry && monster.energy <= 80 && status !== 'Battle');
  add('play', status === 'Home' && !!playBerry && monster.energy >= 10);
  // Quests are timer-gated, not currency-gated. Economy v2 removed their Rune
  // cost; retaining the old reserve check here made a zero-Rune player stop
  // testing a core free loop even though the shipped client could start it.
  add('quest', status === 'Home'
    && monster.energy >= 25 && monster.happiness >= 25);
  // Entry itself is free, but the contract requires enough Gold to stake one
  // battle. Rune is advancement currency and is deliberately not a gate here.
  add('bot', status === 'Home' && profile.role !== 'duelist'
    && monster.energy >= 25 && monster.happiness >= 25
    && Number(player.gold ?? 0) >= ARENA_MIN_ENTRY);

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
  // A one-slot roster can still exercise a reversible store: put the active
  // companion into storage, then bootstrap retrieves one on the next tick.
  // Require another stored companion for the directed one-slot case so the bot
  // can never strand an already-adopted account with no recoverable creature.
  add('store', !player.activeBattleId && status === 'Home'
    && (idleInRoster.length > 1
      || (idleInRoster.length === 1 && collection.length > 0)));
  add('retrieve', collection.length > 0 && roster.length < rosterMax);
  add('swap', collection.length > 0 && status === 'Home' && !player.activeBattleId);

  // The marketplace. A listing is custody, so only a stored companion can go
  // up, and an actor that has listed everything keeps at least one back.
  add('list', collection.length > 0);
  add('cancel', mine.length > 0 || collection.length > 0);
  add('buy', affordable.length > 0);
  add('give', collection.length > 0 && (workerData.peers?.length ?? 0) > 0);
  // Quoting is gated on having somewhere to quote, not on having spare stock.
  // The old gate was `excess.length`, which meant an actor only ever showed an
  // ASK -- fifty wallets with nothing to sell produced a book with no bids in
  // it at all, and the desk was the only thing on that side of every ladder.
  // One Gold, not eleven: an ASK costs only the creation fee, and gating the
  // whole verb on being able to fund a BID is how an actor that has run its
  // Gold down stops quoting at all -- exactly when it most wants to be selling.
  add('goods_make', Boolean(intelligence?.quotes.some((quote) => !quote.live))
    && (player.gold ?? 0) >= 1);
  add('goods_amend', Boolean(intelligence?.quotes.some((quote) => quote.live && quote.drift >= 1)));
  add('goods_take', Boolean(intelligence?.needs.some(({ plan }) => plan.units > 0)));
  add('goods_cancel', Boolean(intelligence?.ownOrders.length));
  add('goods_cancel_all', (intelligence?.ownOrders.length ?? 0) >= 2);
  add('goods_maintain', (economyView?.orders?.length ?? 0) > 0);
  add('shop_trade', Boolean(intelligence?.excess.length || intelligence?.needs.length));
  add('arbitrage', Boolean(tradePlan || intelligence?.arbitrage.length)
    || prefer === 'arbitrage');
  add('venue_internal', api.internalVenueConfigured());
  add('venue_external', api.externalVenueConfigured() && exchangeReady);

  // The Rune bridge.
  //
  // `withdraw` spends the game balance, so it is held above the same reserve
  // every other Rune sink respects -- an actor that bridged itself broke would
  // stop questing and fighting and drop out of every other measurement here.
  // `deposit` is gated on actually holding the token, which only a settled
  // withdrawal produces, so the pair naturally runs in order the first time.
  add('withdraw', runes > runeReserve + 1 && exchangeReady);
  add('deposit', tokenBalance >= 1_000_000n && exchangeReady);

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
  // `goods_take`/`arbitrage` need a resting order, so until somebody opens each
  // market NONE of those actions can do anything -- and the actions that would
  // open them are ordinary weighted candidates competing with twenty others.
  // Measured over a twelve-minute fifty-wallet run: one p2p order placed. The
  // pricing was never the problem; the market simply never got opened.
  //
  // So an actor that CAN open an empty market does that first, exactly the way
  // a pending level-up and a half-finished arbitrage already jump the queue.
  //
  // The token pair used to be bootstrapped here too, by funding a pool. There
  // is no pool: what trades TEST-RUNE against TEST-RELIC is an order book, and
  // when its process exists it gets opened the same way the internal book does
  // -- by resting an order on a side that has none.
  // A market with no PLAYER on one side of it.
  //
  // The realm's desk quotes into every ladder now, so `bestAsk` is almost
  // never empty and the old emptiness test -- which read `bestAsk` -- stopped
  // firing the moment the house arrived. What still needs bootstrapping is a
  // side of the book with no player on it: `p2pBid`/`p2pAsk` are published
  // separately for exactly this reason, and a book that is only ever the house
  // is a book that proves nothing about the matching engine.
  const unquoted = (intelligence?.quotes ?? []).filter((quote) => {
    if (quote.live) return false;
    const shown = quote.side === 'buy' ? quote.stats?.p2pBid : quote.stats?.p2pAsk;
    return !(Number(shown) > 0)
      && quoteSize(quote, player, intelligence.spendableGold) > 0;
  });
  if (unquoted.length > 0 && (profile.weights.goods_make ?? 0) > 0 && (player.gold ?? 0) >= 1) {
    return economicAction('goods_make', player, economyView,
      { ...intelligence, quotes: unquoted });
  }

  // A lived-in run is coverage-directed without becoming scripted. The parent
  // gives different actors different missing adapters; a worker honors its
  // preference only when that action is legal in the state it just read, then
  // falls back to its normal role weights. Dependencies and races therefore
  // remain real while rare paths stop being left entirely to luck.
  const decision = tradePlan && intelligence
    ? { action: 'arbitrage', reason: 'complete-open-arbitrage' }
    : chooseProgressionAction({
      candidates, player, profile, random, prefer, arenaMinEntry: ARENA_MIN_ENTRY,
    });
  decisionReason = decision.reason;
  const action = decision.action;
  const choose = (list) => list[Math.floor(random() * list.length)];
  let detail = {};

  if (action === 'daily') player = await api.claimDaily();
  else if (action === 'loot') player = await api.openLootbox();
  else if (action === 'feed') { player = await api.feed(berry); detail = { item: berry }; }
  else if (action === 'play') player = await api.startPlay();
  else if (action === 'quest') player = await api.startQuest();
  else if (action === 'bot') {
    // Sometimes buy the boost, sometimes do not. Both are real player choices
    // and they exercise different code: the plain entry only opens the session;
    // the boosted entry spends three berries and writes `arenaBoost`,
    // which the battle then folds into the temporary combatant. Choosing only
    // one of them would leave the other unexercised in every soak.
    const boost = boostBerry && random() < 0.5 ? boostBerry : undefined;
    player = await api.enterArena(boost);
    detail = boost ? { berry: boost } : {};
  } else if (action === 'hunt') {
    const target = player.activeId ?? roster[0];
    try {
      player = await api.beginHunt(target);
    } catch (error) {
      if (!acceptedDelivery(error)) throw error;
      player = await refresh().catch(() => player);
      detail = { monsterId: target, deliveryState: 'accepted-delivery-unconfirmed',
        slot: error.slot ?? null };
      return result('hunt.begin', player, detail);
    }
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
    if (!listing) {
      const id = choose(collection);
      // Create the fixture and remove it in the SAME actor command. Leaving a
      // million-Rune listing behind until a later random turn polluted the
      // live marketplace with absurd prices for hours.
      const protectedPrice = 1_000;
      player = await api.listMonster(id, protectedPrice);
      const listingId = player.listing?.id ?? null;
      if (!listingId) throw new Error('protected cancellation fixture returned no listing id');
      player = await api.cancelListing(listingId);
      return result('market.cancel', player, {
        monsterId: id, price: protectedPrice,
        listingId,
        purpose: 'protected-cancel-coverage',
      });
    }
    try {
      player = await api.cancelListing(listing.id);
    } catch (error) {
      if (!missingListing(error)) throw error;
      player = await refresh().catch(() => player);
      return result('idle.market-race', player, {
        listingId: listing.id, outcome: 'listing-cleared-before-cancel',
      });
    }
    detail = { listingId: listing.id };
  } else if (action === 'buy') {
    const listing = choose(affordable);
    try {
      player = await api.buyListing(listing.id);
    } catch (error) {
      if (!missingListing(error)) throw error;
      player = await refresh().catch(() => player);
      return result('idle.market-race', player, {
        listingId: listing.id, seller: listing.seller,
        outcome: 'listing-cleared-before-buy',
      });
    }
    detail = { listingId: listing.id, price: Number(listing.price), seller: listing.seller };
  } else if (action === 'give') {
    const id = choose(collection);
    const recipient = choose(workerData.peers);
    player = await api.transferMonster(id, recipient);
    detail = { monsterId: id, recipient };
  } else if (['goods_make', 'goods_amend', 'goods_take', 'goods_cancel', 'goods_cancel_all',
    'goods_maintain', 'shop_trade', 'arbitrage'].includes(action)) {
    return economicAction(action, player, economyView, intelligence);
  } else if (action === 'venue_internal') {
    return internalVenueAction(player);
  } else if (action === 'venue_external') {
    return externalVenueAction(player);
  } else if (action === 'withdraw') {
    // One at a time. A withdrawal is a queued mint, and the point is to watch
    // the queue drain rather than to move a large balance.
    return bridge.withdraw(player, Math.min(2, runes - runeReserve));
  } else if (action === 'deposit') {
    // The token has six decimals while the game accepts whole Rune only.
    // Burn one or two complete 1,000,000-atom units, never one or two atoms.
    const atoms = tokenBalance >= 2_000_000n ? 2_000_000n : 1_000_000n;
    return bridge.deposit(player, atoms.toString());
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
  const tickNumber = ticks++;
  let player = await refresh();
  if (!player?.unlocked) return result('blocked.access', player, { ready: false });
  if (!player.faction || !player.monster) {
    const setup = await bootstrap();
    return { ...setup, ready: false };
  }
  if ((player.dailyReadyAt ?? 0) <= Date.now()) {
    decisionReason = 'claim-ready-worship';
    player = await api.claimDaily();
    return result('daily.claim', player, { ready: false });
  }
  // Duelists are coordinated outside the routine tick loop, so this must live
  // here too or all ten PvP actors would be the only bots never customized.
  const customized = await customizeIfDue(player, tickNumber, { ready: false });
  if (customized) return customized;
  if (player.hunt) {
    await settleOrAccept(() => api.huntEnd(player.hunt));
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
    if (Number(player.gold ?? 0) < ARENA_STAKE) {
      const recovered = await recoverArenaGold(player);
      if (recovered) return { ...recovered, ready: false };
      const goldBefore = Number(player.gold ?? 0);
      player = await api.leaveArena();
      return result('arena.leave.insufficient-gold', player, {
        ready: false,
        goldBefore,
        requiredGold: ARENA_STAKE,
        recovery: 'quest-or-shop-required',
      });
    }
    return result('pvp.ready', player, {
      ready: (player.battlesRemaining ?? 0) > 0,
      availableGold: Number(player.gold ?? 0),
      requiredGold: ARENA_STAKE,
    });
  }

  // PvP actors do not enter the routine dispatcher, so they need the same
  // spend-XP priority here. Entry costs no Rune, but the next challenge does
  // require the Gold stake exported into the generated worker client.
  const levelRuneCost = Math.max(1, Math.floor(((monster.level ?? 0) + 4) / 4));
  if (monster.exp >= monster.nextLevelExp
      && (player.inventory?.rune ?? 0) >= levelRuneCost) {
    decisionReason = 'spend-xp-before-next-duel';
    player = await api.levelUp(profile.statPlan);
    return result('monster.level-up', player, { ready: false, allocation: profile.statPlan });
  }

  const berryStock = berryIds.reduce((sum, item) =>
    sum + Number(player.inventory?.[item] ?? 0), 0);
  if ((player.lootboxes?.length ?? 0) > 0 && berryStock < 8) {
    decisionReason = 'open-loot-for-care-supplies';
    player = await api.openLootbox();
    return result('lootbox.open', player, { ready: false });
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
    // ANY berry, and pass it. game.lua:2345-2352 refuses to require an element
    // match -- 'Any berry is accepted' -- but this asked ownBerry() for the
    // faction berry and then called startPlay() with no argument, so the
    // process fell back to the faction berry anyway. Two reasons for the same
    // deadlock: all ten duelists froze at happiness 0 / 11 berries for 4.99
    // hours, emitting 700 pvp.needs-happiness events -- 14.8% of the entire
    // run -- and only 16 duels ever settled instead of ~200.
    const berry = availableBerry(player);
    if (berry && monster.energy >= 10) {
      player = await api.startPlay(undefined, berry);
      return result('activity.start.play', player, { ready: false, item: berry });
    }
    return result('pvp.needs-happiness', player, { ready: false });
  }
  if (Number(player.gold ?? 0) < ARENA_MIN_ENTRY) {
    const recovered = await recoverArenaGold(player);
    if (recovered) return { ...recovered, ready: false };
    player = await api.startQuest();
    return result('activity.start.quest', player, {
      ready: false,
      purpose: 'arena-stake-recovery',
      requiredGold: ARENA_MIN_ENTRY,
    });
  }
  player = await api.enterArena();
  return result('arena.enter.pvp', player, { ready: false });
}

async function challenge(target) {
  const before = await refresh();
  const player = await api.challenge(target);
  const goldBefore = Number(before.gold ?? 0);
  const goldAfter = Number(player.gold ?? 0);
  return result('pvp.challenge', player, {
    battleId: player.battle?.id ?? null,
    goldBefore,
    goldAfter,
    stakeGold: goldBefore - goldAfter,
    potGold: Number(player.battle?.arena?.pot ?? 0),
  });
}

async function accept(battleId) {
  const before = await refresh();
  const player = await api.acceptChallenge(battleId);
  const goldBefore = Number(before.gold ?? 0);
  const goldAfter = Number(player.gold ?? 0);
  return result('pvp.accept', player, {
    battleId,
    goldBefore,
    goldAfter,
    stakeGold: goldBefore - goldAfter,
    potGold: Number(player.battle?.arena?.pot ?? 0),
  });
}

async function withdrawPvp() {
  const before = await refresh();
  const battleId = before.activeBattleId ?? before.battle?.id ?? null;
  const landed = await settleOrAccept(() => api.leaveArena());
  const updated = landed.value ?? await refresh().catch(() => before);
  const goldBefore = Number(before.gold ?? 0);
  const goldAfter = Number(updated.gold ?? goldBefore);
  const refundedGold = goldAfter - goldBefore;
  const confirmed = updated.withdrawn === true
    || (battleId && updated.activeBattleId !== battleId && refundedGold === ARENA_STAKE);
  return result(confirmed ? 'pvp.challenge.refund' : 'pvp.challenge.refund-unconfirmed',
    updated, {
      battleId,
      goldBefore,
      goldAfter,
      refundedGold,
      ...(landed.accepted
        ? { deliveryState: 'accepted-delivery-unconfirmed', slot: landed.slot } : {}),
    });
}

async function pvpMove(battleId) {
  const before = await refresh();
  const reconcileTerminal = async (error, phase) => {
    const message = error instanceof Error ? error.message : String(error);
    if (!/battle not found|that battle is over/i.test(message)) throw error;
    const player = await refresh();
    // Still locked to this id means authoritative state really is missing; do
    // not hide that as an ordinary last-round race.
    if (player?.activeBattleId === battleId) throw error;
    const receipt = arenaSettlement(before, player, battleId);
    if (receipt) {
      return result('battle.settle.pvp', player,
        arenaSettlementDetail(receipt, before, player, battleId, {
          battle: { id: battleId, status: 'ended', winner: null },
          outcome: `battle-cleared-before-${phase}`,
        }));
    }
    return result('pvp.ended', player, {
      battle: { id: battleId, status: 'ended', winner: null },
      outcome: `battle-cleared-before-${phase}`,
    });
  };
  // The battle is ALREADY in the record `refresh()` just read. See
  // `resolveArenaBattle` for why that matters and what the three answers mean:
  // this used to send `Battle.Info` as a signed message for the same table, and
  // a read costs a whole authority slot.
  const resolved = resolveArenaBattle(before, battleId);
  let battle = resolved.battle;
  if (resolved.terminal) {
    return reconcileTerminal(new Error('Battle not found'), 'read');
  }
  if (resolved.needsMessage) {
    try { battle = await api.battleInfo(battleId); }
    catch (error) { return reconcileTerminal(error, 'read'); }
  }
  if (battle.status === 'ended') {
    const player = await refresh();
    const receipt = arenaSettlement(before, player, battleId);
    if (receipt) {
      return result('battle.settle.pvp', player,
        arenaSettlementDetail(receipt, before, player, battleId, { battle: {
          id: battle.id, status: battle.status, round: battle.round,
          winner: battle.winner ?? null,
        } }));
    }
    return result('pvp.ended', player, { battle: {
      id: battle.id, status: battle.status, round: battle.round, winner: battle.winner ?? null,
    } });
  }
  const move = chooseMove(battle);
  let player;
  try { player = await api.attack(battleId, move, battle.round); }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/that round has already resolved/i.test(message)) {
      return result('pvp.round-race', await refresh(), {
        battle: { id: battleId, status: 'battling' },
        submittedRound: battle.round, outcome: 'opponent-resolved-round-first',
      });
    }
    return reconcileTerminal(error, 'attack');
  }
  const receipt = arenaSettlement(before, player, battleId);
  if (receipt) {
    return result('battle.settle.pvp', player,
      arenaSettlementDetail(receipt, before, player, battleId, { move }));
  }
  return result('battle.attack.pvp', player, { move });
}

async function cleanup() {
  let player = await refresh();
  if (player?.hunt) {
    let run = await api.readHunt(player.hunt).catch(() => null);
    if (run?.status === 'settling' && player.hunt.status === 'roaming'
        && player.hunt.lastCapture?.settlementId) {
      await settleOrAccept(() => api.retryHuntAcknowledgement());
      run = await api.readHunt(player.hunt).catch(() => run);
      player = await refresh().catch(() => player);
    }
    if (run?.status === 'settling') {
      throw new Error('Hunt acknowledgement recovery left the run settling');
    }
    const landed = await settleOrAccept(() => api.huntEnd(player.hunt));
    const updated = await refresh();
    return result('cleanup.hunt-end', updated, landed.accepted
      ? { deliveryState: 'accepted-delivery-unconfirmed', slot: landed.slot } : {});
  }
  if (player?.monster?.status?.type !== 'Battle') return result('cleanup.noop', player);
  const landed = await settleOrAccept(() => api.leaveArena());
  const refreshed = landed.value ?? await refresh().catch(() => player);
  const updated = refreshed?.address ? refreshed : player;
  return result('cleanup.arena-leave', updated, landed.accepted
    ? { deliveryState: 'accepted-delivery-unconfirmed', slot: landed.slot } : {});
}

const handlers = {
  bootstrap, tick, preparePvp, challenge, accept, withdrawPvp, pvpMove, cleanup,
};

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
      decisionReason = null;
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
