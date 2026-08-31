#!/usr/bin/env node
/**
 * fuzz.mjs — randomized valid-and-invalid soak over the roster, the collection
 * and the marketplace.
 *
 *   node backend/native/fuzz.mjs --ops 4000
 *   node backend/native/fuzz.mjs --ops 20000 --wallets 50 --seed 20260829
 *   node backend/native/fuzz.mjs --ops 500 --verbose
 *
 * What makes this different from `game_test.lua`
 * ----------------------------------------------
 * The suite asserts the cases somebody thought of. This asserts the RULES, and
 * then throws tens of thousands of randomly ordered situations at them, most of
 * which nobody would think to write down: sell the companion you just retrieved
 * while a quest you forgot about is still running, then try to cancel the
 * listing from the account that bought it.
 *
 * Roughly two in five attempts are deliberately illegal, and they are not
 * garbage — a garbage message is refused by the action lookup and proves
 * nothing. They are well-formed, plausible, and break exactly one rule each:
 * store a companion that is mid-quest, buy your own listing, retrieve into a
 * full roster, name another player's monster id, sign an `Admin.*` verb as a
 * player. An illegal op that SUCCEEDS is the loudest thing this can report.
 *
 * What is checked, on every single op
 * -----------------------------------
 *   * the accept/reject prediction, made from published state before sending;
 *   * the specific state transition, for the ops whose outcome is not rolled
 *     (a store costs exactly one rune, a sale credits the seller exactly the
 *     asking price, a cancelled listing comes home to the seller);
 *   * that a refusal changed NOTHING — the commonest real bug in an escrow
 *     model is a rule that refuses the action after it has already taken the
 *     payment;
 *   * integers, asserted against the RAW reply bytes, because decoding turns
 *     every number into a float and would launder the defect.
 *
 * And on every sweep: companion conservation. Storing, retrieving, listing,
 * buying and transferring all MOVE a companion, so the population may only
 * change when something creates or destroys one. A population that drifted is
 * a companion duplicated or lost, which is the only bug in this feature that
 * mints value out of nothing.
 *
 * This runs the state machine locally and does NOT exercise signing, Luerl, or
 * node scheduling. Those are `npm run test:lua`, `e2e.mjs`, and the live swarm.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createLocalBackend } from './fuzz/local.mjs';
import { World, rosterIds, collectionIds, runes, fingerprint } from './fuzz/world.mjs';
import { nextOp } from './fuzz/ops.mjs';
import { SCENARIOS } from './fuzz/scenarios.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const OUT_DIR = path.join(ROOT, '.fuzz', 'runs');

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const option = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : fallback;
};
const integer = (name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const value = Number(option(name, fallback));
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`--${name} must be an integer from ${min} to ${max}`);
  }
  return value;
};
const fraction = (name, fallback) => {
  const value = Number(option(name, fallback));
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`--${name} must be a number from 0 to 1`);
  }
  return value;
};

// ---------------------------------------------------------------------------

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

/**
 * Test addresses that look like Arweave addresses.
 *
 * Length is load-bearing: `Monster.Transfer` decides whether a recipient is an
 * address by checking for exactly 43 characters, so a 20-character stand-in
 * would make every transfer in the run refuse for the wrong reason.
 */
const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
function address(index) {
  const stem = `FUZZ${String(index).padStart(3, '0')}`;
  let out = stem;
  let n = index * 2654435761;
  while (out.length < 43) {
    n = (n * 1103515245 + 12345) >>> 0;
    out += ALPHABET[n % ALPHABET.length];
  }
  return out.slice(0, 43);
}

const FACTIONS = ['Sky Nomads', 'Aqua Guardians', 'Inferno Blades', 'Stone Titans'];

/**
 * Numbers that must never come back with a decimal point.
 *
 * Asserted against the raw reply text on purpose. `tonumber` in Luerl returns a
 * float and every tag arrives as a string, so an unnarrowed conversion stores
 * 25 as 25.00000000000 forever after — and decoding the reply here would turn
 * it straight back into 25 and hide it. See the repo rule on integers.
 */
const INTEGER_KEYS = [
  'price', 'level', 'exp', 'attack', 'defense', 'speed', 'health', 'energy',
  'happiness', 'rune', 'amount', 'listedAt', 'soldAt', 'bornAt', 'since',
  'until_time', 'wins', 'losses', 'questsCompleted', 'battlesRemaining',
  'rosterMax', 'dailyStreak', 'count', 'rarity', 'totalTimesFed',
  'totalTimesPlay', 'totalTimesQuest',
];
const FLOAT_LEAK = new RegExp(`"(${INTEGER_KEYS.join('|')})"\\s*:\\s*-?\\d+\\.`, 'g');

function floatLeaks(raw) {
  if (typeof raw !== 'string') return [];
  return [...new Set((raw.match(FLOAT_LEAK) ?? []).map((hit) => hit.trim()))];
}

// ---------------------------------------------------------------------------

async function main() {
  const ops = integer('ops', 4000, { min: 1, max: 5_000_000 });
  const walletCount = integer('wallets', 50, { min: 2, max: 500 });
  const seed = integer('seed', Date.now() & 0x7fffffff, { min: 0, max: 0x7fffffff });
  const illegalShare = fraction('illegal-share', 0.4);
  const routineShare = fraction('routine-share', 0.25);
  const sweepEvery = integer('sweep-every', 250, { min: 1, max: 1_000_000 });
  const maxMonsters = integer('max-monsters', 5, { min: 1, max: 20 });
  const verbose = flag('verbose');
  const stopOnFail = flag('bail');

  const rng = mulberry32(seed);
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = path.join(OUT_DIR, runId);
  fs.mkdirSync(runDir, { recursive: true });
  const stream = fs.createWriteStream(path.join(runDir, 'events.jsonl'), { flags: 'a' });
  const record = (event) => stream.write(JSON.stringify(event) + '\n');

  console.log(`Rune Realm fuzz ${runId}`);
  console.log(`ops         ${ops}`);
  console.log(`wallets     ${walletCount}`);
  console.log(`seed        ${seed}`);
  console.log(`illegal     ${Math.round(illegalShare * 100)}% of draws`);
  console.log(`events      ${path.join(runDir, 'events.jsonl')}\n`);

  const backend = await createLocalBackend();
  const world = new World();
  const actors = Array.from({ length: walletCount }, (_, index) => address(index));

  // -- Findings -------------------------------------------------------------
  //
  // A finding is a claim about the process, not a log line. Each one records
  // the op that produced it so a failing run can be replayed from the seed and
  // the step number alone.
  const findings = [];
  const finding = (severity, kind, message, context) => {
    const entry = { severity, kind, message, ...context };
    findings.push(entry);
    record({ type: 'finding', ...entry });
    const mark = severity === 'critical' ? 'CRITICAL' : severity.toUpperCase();
    console.error(`  ${mark}  ${kind}: ${message}`);
    if (stopOnFail && severity !== 'warning') throw new Error(`--bail: ${kind}: ${message}`);
  };

  const latencies = new Map();
  const outcomes = new Map();
  const coverage = new Map();
  const bump = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);

  /** Expected number of companions in existence, maintained by the model. */
  let population = 0;

  const send = async (from, tags, data) => {
    const result = await backend.send(from, tags, data);
    world.observe(result.body);
    world.observeMarket(result.market);
    world.observeEconomy(result.economy);
    const action = tags.Action ?? 'none';
    const bucket = latencies.get(action) ?? [];
    // os.clock() inside the module has coarse resolution and reports 0 for a
    // fast message, so fall back to the wall clock around the call. Neither is
    // a node measurement -- that is the live swarm; this is relative cost
    // between actions on the same machine.
    bucket.push(result.computeMs || result.latencyMs);
    latencies.set(action, bucket);
    const leaks = floatLeaks(result.raw);
    if (leaks.length) {
      finding('major', 'float-leak',
        `${action} published a float where an integer belongs: ${leaks.join(', ')}`,
        { action, sample: leaks });
    }
    return result;
  };

  // -- Setup ----------------------------------------------------------------
  //
  // Seeding uses the owner-side verbs deliberately. Adoption is one per account
  // and every other way to hold a second companion is a trade, so an account
  // holding three cannot be produced by playing the game from empty — and a
  // marketplace with nothing in it tests nothing.
  console.log('Seeding wallets...');
  const seedStarted = Date.now();
  for (let start = 0; start < actors.length; start += 25) {
    const chunk = actors.slice(start, start + 25);
    await send(backend.owner, { Action: 'Admin.Unlock', Addresses: chunk.join(',') });
  }
  // The same arrival `seed-monsters.mjs` performs against the live process:
  // swear, which now hands over the starter in the same turn, then be gifted
  // extras into the COLLECTION. Matching it matters — the population this run
  // starts from should be the shape the fifty live wallets are actually in, or
  // the fuzz explores a distribution nobody will ever be in.
  for (const [index, actor] of actors.entries()) {
    const faction = FACTIONS[index % FACTIONS.length];
    const joined = await send(actor, { Action: 'Faction.Join', Faction: faction });
    if (joined.body?.error) {
      finding('major', 'seed-failed',
        `Faction.Join refused for ${actor}: ${joined.body.error}`, { actor });
    } else if (joined.body?.monster) {
      // Swearing is what creates the starter now. `Monster.Adopt` is still a
      // door, but only for an account that swore under an older build, so it
      // is not part of the arrival any more.
      population++;
    } else {
      finding('critical', 'swear-gave-nothing',
        `Faction.Join left ${actor} sworn to ${faction} holding no companion`, { actor });
    }
    // One to five companions each, as a seeded wallet holds. Extras go to the
    // collection, exactly as the live seeding does: it is the half with no cap,
    // it leaves the roster with room for a retrieve to be legal, and it is the
    // only place a listing can be created from.
    const extra = Math.floor(rng() * maxMonsters);
    for (let n = 0; n < extra; n++) {
      const reply = await send(backend.owner, {
        Action: 'Admin.CreateMonster',
        PlayerId: actor,
        // Gifts cross factions on purpose: that is how an account ends up
        // holding a creature it could never have sworn its way to, which is
        // the whole reason the market exists.
        Faction: FACTIONS[Math.floor(rng() * FACTIONS.length)],
        Into: 'collection',
      });
      if (reply.body?.error) {
        finding('major', 'seed-failed',
          `Admin.CreateMonster refused for ${actor}: ${reply.body.error}`, { actor });
      } else {
        population++;
      }
    }
    // Runes, so buying is possible at all. Without a float the market never
    // clears and every buy op is skipped as unaffordable.
    await send(backend.owner, {
      Action: 'Admin.AdjustInventory', PlayerId: actor, Item: 'rune',
      Amount: String(40 + Math.floor(rng() * 120)),
    });
  }
  console.log(`Seeded ${actors.length} wallets holding ${population} companions `
    + `in ${Math.round((Date.now() - seedStarted) / 1000)}s\n`);

  // -- Scenarios ------------------------------------------------------------
  //
  // The hostile ORDERS, run before the random phase so they are in every run
  // rather than in the runs that happened to shuffle their way.
  if (!flag('no-scenarios')) {
    console.log('Scenarios...');
    for (const scenario of SCENARIOS) {
      const started = Date.now();
      let claims = [];
      try {
        claims = await scenario.run({
          owner: backend.owner,
          send,
          read: (who) => backend.readPlayer(who),
          readFresh: (who) => backend.readPlayerAuthoritative(who),
          market: () => Object.fromEntries(world.market),
          created: (n) => { population += n; },
          finding,
        }) ?? [];
      } catch (error) {
        finding('major', 'scenario-crashed',
          `${scenario.name} threw: ${error.message}`, { scenario: scenario.name });
      }
      const failed = claims.filter((claim) => !claim.ok).length;
      console.log(`  ${failed ? 'FAIL' : 'ok  '}  ${scenario.name.padEnd(22)} `
        + `${claims.length - failed}/${claims.length} claims  ${Date.now() - started}ms`);
      record({ type: 'scenario', name: scenario.name, claims });
    }
    console.log('');
  }

  // -- Invariants -----------------------------------------------------------

  const sweep = async (step) => {
    // Read the records, not the published keys. A published key is only as
    // current as the last message that touched that account, so counting
    // companions from them would report a drift that is really just a stale
    // read — and the cheap way to freshen them all is an admin write, which
    // re-encodes the entire table.
    // Every account, not just the fuzz actors: the scenarios create their own
    // people, and a companion handed to an address that has never played is
    // still a companion. Counting only the actors would report those as lost.
    const views = [];
    for (const account of await backend.allAddresses()) {
      const view = await backend.readPlayerAuthoritative(account);
      if (view) { views.push(view); if (actors.includes(account)) world.observe(view); }
    }

    for (const view of views) {
      const roster = rosterIds(view);
      const collection = collectionIds(view);
      const both = roster.filter((id) => collection.includes(id));
      if (both.length) {
        finding('critical', 'in-two-places',
          `${view.address} holds ${both.join(', ')} in the roster AND the collection`,
          { step, actor: view.address });
      }
      if (roster.length > world.rosterMax) {
        finding('critical', 'roster-over-cap',
          `${view.address} has ${roster.length} active companions, cap is ${world.rosterMax}`,
          { step, actor: view.address });
      }
      if (view.activeId && !view.monsters?.[view.activeId]) {
        finding('major', 'dangling-active',
          `${view.address} activeId ${view.activeId} names nothing in the roster`,
          { step, actor: view.address });
      }
      if (roster.length > 0 && !view.activeId) {
        finding('major', 'no-active',
          `${view.address} holds ${roster.length} companions and none is active`,
          { step, actor: view.address });
      }
      if (view.monster && view.monster.id !== view.activeId) {
        finding('major', 'mirror-drift',
          `${view.address} publishes companion ${view.monster.id} as active but activeId is ${view.activeId}`,
          { step, actor: view.address });
      }
      // `monster` is documented as the SAME record as `monsters[activeId]`,
      // not a copy, and every existing verb mutates through the mirror. If
      // anything ever replaces one of the two instead of both, the two stop
      // being one object and a companion that is fed gains energy in the
      // record the client shows and not in the one the roster holds. The ids
      // still agree at that point, so only the values catch it.
      const mirrored = view.monster && view.monsters?.[view.activeId];
      if (mirrored) {
        const diverged = ['energy', 'happiness', 'exp', 'level', 'attack', 'defense',
          'speed', 'health']
          .filter((field) => view.monster[field] !== mirrored[field]);
        if (diverged.length || view.monster.status?.type !== mirrored.status?.type) {
          finding('critical', 'mirror-detached',
            `${view.address}: the active companion and its roster entry disagree on `
            + `${[...diverged, ...(view.monster.status?.type !== mirrored.status?.type ? ['status'] : [])].join(', ')}`
            + ' — they are meant to be one record',
            { step, actor: view.address });
        }
      }
      for (const id of [...roster, ...collection]) {
        const monster = view.monsters?.[id] ?? view.collection?.[id];
        if (monster && monster.id !== id) {
          finding('major', 'id-mismatch',
            `${view.address} files ${monster.id} under the key ${id}`,
            { step, actor: view.address });
        }
      }
      for (const monster of Object.values(view.collection ?? {})) {
        if (monster.status && monster.status.type !== 'Home') {
          finding('major', 'busy-in-storage',
            `${view.address} has a ${monster.status.type} companion sitting in the collection`,
            { step, actor: view.address });
        }
      }
    }

    for (const listing of world.market.values()) {
      if (!listing.monster) {
        finding('critical', 'empty-escrow',
          `listing ${listing.id} holds no companion`, { step, listing: listing.id });
      }
      const price = Number(listing.price);
      if (!Number.isInteger(price) || price < world.minPrice || price > world.maxPrice) {
        finding('major', 'listing-price',
          `listing ${listing.id} is priced ${listing.price}`, { step, listing: listing.id });
      }
    }

    const { total, duplicates } = world.countPopulation(views);
    if (total !== population) {
      finding(total > population ? 'critical' : 'critical', 'population-drift',
        `${total} companions exist, the model expected ${population} `
        + `(${total > population ? 'something was duplicated' : 'something was destroyed'})`,
        { step, observed: total, expected: population });
      // Re-anchor so one drift does not report on every later sweep.
      population = total;
    }
    for (const duplicate of duplicates) {
      finding('warning', 'fingerprint-collision',
        `the same companion appears to be held by ${duplicate.owners.join(' and ')}`,
        { step, ...duplicate });
    }
    record({ type: 'sweep', step, population: total, listings: world.market.size });
  };

  // -- The loop -------------------------------------------------------------

  console.log('Fuzzing...');
  const startedAt = Date.now();
  let executed = 0;
  let skipped = 0;

  // Accounts the run has watched adopt. Adoption is meant to be once per
  // account, and the handler enforces that by checking the account is empty
  // rather than by remembering — so the model has to remember instead.
  const adopted = new Set(actors);

  for (let step = 1; step <= ops; step++) {
    const op = nextOp(rng, world, { actors, adopted }, { illegalShare, routineShare });
    if (!op) { skipped++; continue; }

    // Read both sides fresh rather than trusting the mirror. A message
    // republishes only the record it touched, so an account that somebody
    // else's action changed still has last slot's key — and a `before` taken
    // from that would make every delta in this step wrong.
    const before = await backend.readPlayerAuthoritative(op.actor) ?? world.view(op.actor);
    world.observe(before);
    const counterpartyBefore = op.counterparty
      ? await backend.readPlayerAuthoritative(op.counterparty)
      : null;
    if (counterpartyBefore) world.observe(counterpartyBefore);
    // The op was drawn against the mirror; `before` is the truth. Anything
    // whose legality turns on a balance or a count says so here, and a draw
    // that stopped being the case it meant to be is dropped rather than
    // asserted against — a stale prediction is not a finding about the
    // process, it is a finding about this file.
    if (op.precondition && !op.precondition(before)) {
      bump(outcomes, 'stale-draw');
      skipped++;
      continue;
    }

    const label = op.legal === false ? `${op.name}!${op.variant}` : op.name;
    bump(coverage, label);

    let result;
    try {
      result = await send(op.actor, op.tags);
    } catch (error) {
      finding('critical', 'process-crash',
        `${label} raised inside game.lua: ${error.message}`,
        { step, op: label, actor: op.actor, tags: op.tags });
      continue;
    }
    executed++;

    const refused = Boolean(result.body?.error);
    const after = await backend.readPlayerAuthoritative(op.actor) ?? result.body;
    world.observe(after);

    if (op.legal === true && refused) {
      bump(outcomes, 'unexpected-refusal');
      finding('major', 'legal-op-refused',
        `${label} was predicted legal and came back "${result.body.error}"`,
        { step, op: label, actor: op.actor, tags: op.tags });
    } else if (op.legal === false && !refused) {
      bump(outcomes, 'illegal-accepted');
      finding('critical', 'illegal-op-accepted',
        `${label} succeeded, but ${op.rule}`,
        { step, op: label, actor: op.actor, tags: op.tags, rule: op.rule });
    } else {
      bump(outcomes, op.legal === false ? 'refused-as-expected'
        : op.legal === true ? 'accepted-as-expected' : 'routine');
    }

    // Population moves only when something is CREATED or DESTROYED.
    //
    // Storing, retrieving, listing, buying and transferring are all moves, so
    // the count must not follow them. What does create a companion is a matter
    // of which verbs the game gives out, and that changed underneath this: the
    // starter now arrives with the oath rather than a message later, so keying
    // the count on `Monster.Adopt` alone under-counted every account that swore
    // and made the next sweep report a duplication that had not happened.
    //
    // So the creation is read off the ACCOUNT rather than guessed from the
    // verb: `adopted` flips false to true exactly once per account, whichever
    // door did it. An accepted op still counts even when this run considers it
    // a rule violation — the finding is reported separately, and the count has
    // to follow reality or every later sweep reports a drift caused by the
    // bookkeeping instead of by the process.
    if (!refused) {
      if (before?.adopted !== true && after?.adopted === true) {
        population++;
        adopted.add(op.actor);
      }
      // The owner-side doors, which say nothing about `adopted`.
      if (op.tags.Action === 'Admin.CreateMonster') population++;
      if (op.tags.Action === 'Admin.DeleteMonster') population--;
    }

    if (op.verify) {
      try {
        const problems = await op.verify({
          before, after, reply: result.body, market: result.market, counterpartyBefore,
          // What an unsigned client sees.
          read: (who) => backend.readPlayer(who),
          // What the process actually holds.
          readFresh: (who) => backend.readPlayerAuthoritative(who),
          // A remark that is true but is not a rule violation.
          note: (kind, message) => finding('warning', kind, message,
            { step, op: label, actor: op.actor }),
        }) ?? [];
        for (const problem of problems) {
          finding(op.legal === false ? 'critical' : 'major', 'state-wrong',
            `${label}: ${problem}`,
            { step, op: label, actor: op.actor, tags: op.tags });
        }
      } catch (error) {
        finding('major', 'verify-failed',
          `${label}: the check itself threw: ${error.message}`, { step, op: label });
      }
    }

    // A message republishes only the record it touched, so the other side of a
    // trade is now stale in the mirror. Refresh it here or the next op drawn
    // for that account is drawn against a balance it no longer has.
    if (op.counterparty) {
      world.observe(await backend.readPlayerAuthoritative(op.counterparty));
    }

    record({
      type: 'op', step, name: op.name, variant: op.variant ?? null,
      legal: op.legal, actor: op.actor, tags: op.tags,
      refused, error: result.body?.error ?? null,
      computeMs: result.computeMs, latencyMs: result.latencyMs,
    });
    if (verbose) {
      console.log(`${String(step).padStart(6)}  ${label.padEnd(38)} `
        + `${refused ? 'refused' : 'ok     '}  ${result.body?.error ?? ''}`);
    }

    if (step % sweepEvery === 0) {
      await sweep(step);
      const rate = Math.round(step / Math.max(1, (Date.now() - startedAt) / 1000));
      console.log(`  ${step}/${ops} ops  ${world.market.size} listings  `
        + `${population} companions  ${rate} ops/s  ${findings.length} findings`);
    }
  }

  await sweep(ops);

  if (!world.economy?.invariants?.ok) {
    finding('critical', 'economy-invariant', 'published Gold/item/loot-box/Rune equations do not reconcile',
      { invariants: world.economy?.invariants ?? null });
  }

  // -- Report ---------------------------------------------------------------

  const elapsedMs = Date.now() - startedAt;
  const quantile = (values, at) => {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * at))];
  };
  const allLatencies = [...latencies.values()].flat();
  const summary = {
    runId, seed, ops, executed, skipped, walletCount, illegalShare, routineShare,
    elapsedMs,
    opsPerSecond: Math.round(executed / Math.max(1, elapsedMs / 1000)),
    population,
    listings: world.market.size,
    economy: world.economy ? {
      invariants: world.economy.invariants,
      gold: world.economy.gold,
      orders: world.economy.orders?.length ?? 0,
      fills: world.economy.fills?.length ?? 0,
    } : null,
    outcomes: Object.fromEntries(outcomes),
    coverage: Object.fromEntries([...coverage].sort((a, b) => b[1] - a[1])),
    compute: {
      p50Ms: quantile(allLatencies, 0.5),
      p90Ms: quantile(allLatencies, 0.9),
      p99Ms: quantile(allLatencies, 0.99),
      maxMs: allLatencies.length ? Math.max(...allLatencies) : 0,
      byAction: Object.fromEntries([...latencies].map(([action, values]) => [action, {
        count: values.length,
        p50Ms: quantile(values, 0.5),
        p99Ms: quantile(values, 0.99),
        maxMs: Math.max(...values),
      }])),
    },
    findings,
  };
  fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  record({ type: 'run.end', ...summary });
  await new Promise((resolve) => stream.end(resolve));

  const bySeverity = findings.reduce((counts, entry) => {
    counts[entry.severity] = (counts[entry.severity] ?? 0) + 1;
    return counts;
  }, {});

  console.log(`\n${executed} ops in ${Math.round(elapsedMs / 1000)}s `
    + `(${summary.opsPerSecond}/s), ${skipped} draws had no legal case`);
  console.log(`companions  ${population}   listings ${world.market.size}`);
  console.log(`compute     p50 ${summary.compute.p50Ms}ms  p99 ${summary.compute.p99Ms}ms  `
    + `max ${summary.compute.maxMs}ms`);

  // Admin writes used to republish every player key, which made their cost grow
  // with the table while a player action's did not. Only the bulk verbs do that
  // now, so this is a standing check that the gap has stayed closed rather than
  // a description of a known problem.
  const median = (rows) => quantile(rows.flatMap(([, values]) => values), 0.5);
  const adminActions = [...latencies].filter(([action]) => action.startsWith('Admin.'));
  const playerActions = [...latencies].filter(([action]) => !action.startsWith('Admin.'));
  if (adminActions.length && playerActions.length) {
    console.log(`admin cost  an Admin.* write takes ${median(adminActions)}ms against `
      + `${median(playerActions)}ms for a player action, at ${population} companions `
      + `across ${(await backend.allAddresses()).length} accounts`);
  }
  console.log('outcomes   ', Object.entries(summary.outcomes)
    .map(([key, count]) => `${key}=${count}`).join('  '));

  const untried = [...new Set([...coverage.keys()])];
  console.log(`coverage    ${untried.length} distinct cases exercised`);

  if (!findings.length) {
    console.log('\nNo findings. Every legal op was accepted, every illegal op was refused,');
    console.log('and the companion population is exactly what the model expected.');
  } else {
    console.log(`\n${findings.length} finding(s): `
      + Object.entries(bySeverity).map(([key, count]) => `${count} ${key}`).join(', '));
    const seen = new Set();
    for (const entry of findings) {
      const key = `${entry.severity}:${entry.kind}:${entry.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      console.log(`  [${entry.severity}] ${entry.kind}: ${entry.message}`);
    }
    console.log(`\nReplay with: node backend/native/fuzz.mjs --seed ${seed} `
      + `--ops ${ops} --wallets ${walletCount}`);
  }
  console.log(`\nsummary     ${path.join(runDir, 'summary.json')}`);

  if (findings.some((entry) => entry.severity !== 'warning')) process.exitCode = 1;
}

await main();
