/**
 * deploy.mjs — spawn the RuneRealm game process on HyperBEAM and seed it.
 *
 *   HB_WALLET=path/to/key.json node backend/native/deploy.mjs
 *
 * Optional:
 *   NODE_URL=https://jonny-ringo.xyz    which node to spawn on
 *   PAID_LIST=backend/native/paid.json  addresses to unlock (see below)
 *   SKIP_SMOKE=1                        spawn and seed, skip the scenario
 *   --migrate-from <old-pid>            carry players over from a previous
 *                                       deployment (see below)
 *   --migrate-node <url>                which node hosts that old process,
 *                                       when moving between nodes. Defaults to
 *                                       what live-process.txt recorded.
 *   --no-seed-legacy                    do NOT restore the legacynet players
 *   --seed-legacy <file>                restore them from a different file
 *   --no-env                            do NOT point the app at the new process
 *   --public-access / --free            let any signed wallet create an account
 *   --no-free                           force Eternal Pass access for this deploy
 *
 * A successful deploy writes the new id into `src/lib/hyperbeam.ts`,
 * `.env.example` and `.env.local`, because a deploy that does not is
 * indistinguishable from every player losing their account.
 *
 * Every deploy restores the recovered legacynet players by default, from
 * `legacy-players.json`. It runs BEFORE `--migrate-from` so that a live
 * deployment's state always wins over a February 2026 checkpoint — see the note
 * on that block, because the order is load-bearing.
 *
 * The paid list may be either a JSON array of addresses, a JSON object with an
 * `addresses` array, or a plain text file with one address per line.
 *
 * Spawning and compute are free — the wallet signs, it does not pay. Whoever
 * signs the spawn becomes the process owner, and the owner is the only address
 * the Admin.* handlers will answer.
 *
 * The process id is written to live-process.txt and is what
 * VITE_GAME_PROCESS should be set to.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnProcess, sendMessage, jwkToAddress } from './hbclient.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
/**
 * The same node the client defaults to (`HB_NODE` in src/lib/hyperbeam.ts).
 *
 * It used to default to jonny-ringo.xyz, which is a different node from the one
 * the app talks to — so a deploy spawned the process somewhere the client would
 * then have to be told about, and `--migrate-from` could not read the old
 * process at all, since a process is only servable by a node that hosts it.
 * jonny-ringo also answered 500 through a seeding run during this work.
 */
const NODE = process.env.NODE_URL || 'https://schedule.forward.computer';
const WALLET = process.env.HB_WALLET || path.join(ROOT, 'arweave-wallet-DA9qhP25.json');
const freeEnabled = process.argv.includes('--free')
  || process.argv.includes('--public-access');
const freeDisabled = process.argv.includes('--no-free')
  || process.argv.includes('--no-public-access');
if (freeEnabled && freeDisabled) {
  throw new Error('Choose one access mode: --free or --no-free, not both');
}
const PUBLIC_ACCESS = freeDisabled ? false : (
  freeEnabled || /^(1|true|yes)$/i.test(process.env.PUBLIC_ACCESS || '')
);

if (!fs.existsSync(WALLET)) {
  console.error(`No keyfile at ${WALLET}. Set HB_WALLET=path/to/key.json`);
  process.exit(1);
}
const jwk = JSON.parse(fs.readFileSync(WALLET, 'utf8'));
const owner = jwkToAddress(jwk);

/**
 * The deployment being replaced, read BEFORE this one overwrites the record.
 *
 * `live-process.txt` is rewritten moments after the spawn below, so anything
 * that reads it later sees the NEW pairing. The migration needs the OLD one —
 * specifically which node hosts the process being migrated FROM, since a
 * process is bound to its scheduler and moving between nodes means reading from
 * one and writing to the other.
 */
const PREVIOUS = (() => {
  const f = path.join(ROOT, 'live-process.txt');
  if (!fs.existsSync(f)) return {};
  const [pid, node] = fs.readFileSync(f, 'utf8').trim().split(/\r?\n/);
  return { pid, node };
})();

const read = (f) => fs.readFileSync(path.join(HERE, f), 'utf8');

// A fresh process id is unknowable until spawn returns, while every worker is
// immutably bound to a game process id. Pre-sealing here can therefore only bind
// a new game to workers for some older game. Always spawn unconfigured, deploy
// verified workers against the returned pid, then seal once with
// configure-battle-fleet.mjs. game.lua still supports preinjected manifests for
// deterministic/manual bundlers that genuinely know their process id.
const fleetManifestPath = process.env.BATTLE_FLEET_MANIFEST;
if (fleetManifestPath) {
  throw new Error('BATTLE_FLEET_MANIFEST cannot be pre-sealed by deploy.mjs because the new game '
    + 'process id is not known yet. Deploy the game first, deploy workers with BATTLE_GAME_PROCESS, '
    + 'then run npm run configure:battle-fleet.');
}

// The bundle must match run-test.sh exactly, or the suite is testing something
// other than what ships.
const lua = [
  // `json.lua` alone, not all of hyper-aos: this process defines its own
  // `compute` and uses nothing else aos provides. Set HYPER_AOS to bundle the
  // full runtime instead -- it registers `.json` the same way.
  read(process.env.HYPER_AOS ? path.basename(process.env.HYPER_AOS) : 'json.lua'),
  'local C = (function()',     read('constants.lua'), 'end)()',
  `C.PUBLIC_ACCESS = ${PUBLIC_ACCESS ? 'true' : 'false'}`,
  'local jsonx = (function()', read('jsonenc.lua'),   'end)()',
  'local encode, jsonObject = jsonx.encode, jsonx.object',
  'Battle = (function()',      read('battle.lua'),    'end)()',
  'local EconomyEngine = (function()', read('economy.lua'), 'end)()',
  'BattleFleetBootstrapConfig = { enabled = true }',
  'BattleFleetConfig = nil',
  'BattleFleetAuthority = (function()',
  read('battle-fleet/authority.lua'),
  'end)()',
  read('game.lua'),
].join('\n');

console.log(`node:   ${NODE}`);
console.log(`owner:  ${owner}`);
console.log(`access: ${PUBLIC_ACCESS ? 'public (new wallets may join)' : 'Eternal Pass allow-list'}`);
console.log('fleet:  unconfigured (monolith; staged one-time fleet seal available)');
console.log(`module: ${Buffer.byteLength(lua)} bytes`);

let t = Date.now();
const pid = await spawnProcess({ node: NODE, jwk, lua, name: 'TEST-Rune Realm Game' });
console.log(`spawn:  ${Date.now() - t} ms`);
console.log(`pid:    ${pid}\n`);
fs.writeFileSync(path.join(ROOT, 'live-process.txt'), `${pid}\n${NODE}\n${owner}\n`);

/**
 * Read a published key, retrying a node that is having a moment.
 *
 * A single 500 used to end the whole deploy — mid-seed, ten players in, with a
 * `SyntaxError: Unexpected token '(', "(500)" is not valid JSON` stack trace,
 * because the failure was returned as the STRING "(500)" and then handed
 * straight to `JSON.parse`. That leaves a half-populated process behind and
 * says nothing about what went wrong. A read that has to wait out a backlog is
 * ordinary here; give it a few seconds before calling it a failure.
 */
const readKey = async (k, { attempts = 6, delayMs = 1000 } = {}) => {
  let status = 0;
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(`${NODE}/${pid}~process@1.0/now/${k}`, { headers: { accept: 'text/plain' } });
      if (r.ok) {
        const body = (await r.text()).trim();
        // A missing key is not always a 404: the node serves its own Hyperbuddy
        // landing page, at status 200, and that HTML then goes to JSON.parse.
        // Treat a page as an absent value and keep waiting.
        if (/^<!DOCTYPE html|^<html/i.test(body)) { status = '200 but HTML (key absent)'; }
        else return body;
      }
      status = r.status;
      // 404 is "not computed yet" and always worth waiting out; so is a 5xx
      // from a node under load. A 4xx that is not 404 will not improve.
      if (r.status !== 404 && r.status < 500) break;
    } catch (err) {
      status = status || `network: ${err.message}`;
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return `(${status})`;
};
const out = () => readKey('results/output/data');

/**
 * `out()`, parsed — and a readable error rather than a parse crash when the
 * node hands back something that is not a reply at all.
 */
const outJson = async (what) => {
  const body = await out();
  try {
    return JSON.parse(body);
  } catch {
    console.error(`\n  ${what} failed: node ${NODE} answered ${body || '(nothing)'}`);
    console.error(`  the process is up at ${pid} but is NOT fully seeded; re-run the deploy.`);
    console.error('  if this is a 500 or 502, try NODE_URL=https://schedule.forward.computer');
    return { error: `unreadable reply: ${body}` };
  }
};

// Bulk player loading --------------------------------------------------------

/**
 * Walk whole player records into the new process, a few at a time.
 *
 * `Admin.Load` writes per address and is idempotent, so a later call overwrites
 * an earlier one for the same wallet and leaves everyone else alone. Both the
 * legacynet restore and the deployment-to-deployment migration go through here,
 * in that order, which is what makes the ordering below safe.
 */
async function loadPlayers(rows, label) {
  let loaded = 0;
  const BATCH = 10;   // whole player records are large; keep the message small
  for (let i = 0; i < rows.length; i += BATCH) {
    await sendMessage({
      node: NODE, jwk, process: pid, action: 'Admin.Load',
      data: JSON.stringify({ players: rows.slice(i, i + BATCH) }),
    });
    const reply = await outJson('load');
    if (reply.error) {
      console.error(`\n  load failed: ${reply.error}`);
      console.error('  (only the process OWNER can load; check HB_WALLET)');
      break;
    }
    loaded += reply.loaded ?? 0;
    process.stdout.write(`\r  ${label} ${Math.min(i + BATCH, rows.length)}/${rows.length}`);
  }
  console.log('');
  return loaded;
}

// Restore the legacynet players ----------------------------------------------

/**
 * The old game's own players, recovered from its Arweave checkpoints.
 *
 * ON BY DEFAULT. `legacy-players.json` is committed, so every deploy from here
 * on restores the 168 who played on legacynet — their faction, companion,
 * level, stats, loot boxes and berries — rather than handing them an empty
 * account. `--no-seed-legacy` (or `SEED_LEGACY=0`) turns it off; a path after
 * `--seed-legacy` reads a different file.
 *
 * `--migrate-from` carries one HyperBEAM deployment to the next by asking the
 * old process to export itself. That is impossible for legacynet: those
 * processes cannot be messaged at all any more. So the state was excavated from
 * their public checkpoints instead — see `recover-state.mjs` — and mapped into
 * loadable rows by `build-legacy.mjs`. This walks those rows through the same
 * `Admin.Load` door.
 *
 * THIS RUNS BEFORE `--migrate-from`, and the order is the whole point. Both
 * write by address, so whichever runs last wins for a wallet in both. The
 * legacy rows are a February 2026 checkpoint and can only ever be the older
 * truth; a live HyperBEAM deployment is always the newer one. Running legacy
 * first means a returning player is seeded once and then immediately overwritten
 * by whatever they have actually done since — and a player who never came back
 * still gets their companion. Reversing these two would quietly reset every
 * active player to their legacynet self on the next redeploy.
 */
const legacyArg = process.argv.indexOf('--seed-legacy');
const legacyPath = legacyArg !== -1 && (process.argv[legacyArg + 1] ?? '').match(/^[^-]/)
  ? process.argv[legacyArg + 1]
  : null;
const seedLegacy = (process.env.SEED_LEGACY === '0' || process.argv.includes('--no-seed-legacy'))
  ? null
  : (legacyPath || process.env.SEED_LEGACY || 'legacy-players.json');

if (seedLegacy) {
  const file = path.isAbsolute(seedLegacy) ? seedLegacy : path.join(HERE, seedLegacy);
  if (!fs.existsSync(file)) {
    // Explicitly asked for and missing is an error; the default being absent is
    // not — a fresh checkout that has not run the recovery still deploys.
    const asked = legacyArg !== -1 || process.env.SEED_LEGACY;
    console.log(`No ${path.relative(ROOT, file)} — no legacynet players restored.`);
    console.log('  npm run recover:state && npm run recover:build\n');
    if (asked) process.exit(1);
  } else {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    const rows = Array.isArray(parsed) ? parsed : (parsed.players ?? []);
    console.log(`restoring ${rows.length} legacynet players from ${path.relative(ROOT, file)}`);
    if (parsed.from?.prempass) {
      console.log(`  checkpoint ${parsed.from.prempass.checkpoint} (${parsed.from.prempass.at})`);
    }
    const loaded = await loadPlayers(rows, 'restored');
    console.log(`  restored ${loaded} players`);

    // The Alter's faction tally is process-global, so it goes in a message of
    // its own rather than riding on an arbitrary batch of players.
    if (parsed.offerings && Object.keys(parsed.offerings).length) {
      await sendMessage({
        node: NODE, jwk, process: pid, action: 'Admin.Load',
        data: JSON.stringify({
          offerings: parsed.offerings,
          checkins: parsed.checkins ?? {},
          players: [],
        }),
      });
      const tally = Object.entries(parsed.offerings)
        .map(([f, n]) => `${f} ${n}`).join(', ');
      console.log(`  faction offerings restored: ${tally}`);
      const days = Object.keys(parsed.checkins ?? {}).length;
      if (days) console.log(`  ${days} days of worship history restored`);
    }
    console.log('');
  }
}

// Carry a previous deployment across ------------------------------------------

/**
 * State IS the process, so a redeploy mints a new one and everything players
 * have earned since the last deploy is gone. This walks the old process's
 * player table out and loads it into the new one.
 *
 * Runs AFTER the legacynet restore on purpose — see the note above.
 *
 * Battles are deliberately not carried: a fight in progress cannot survive a
 * redeploy, and restoring somebody into a battle that no longer exists would
 * strand them. Anyone mid-fight comes back standing at home.
 */
const migrateFrom = process.env.MIGRATE_FROM
  || (process.argv.includes('--migrate-from')
      ? process.argv[process.argv.indexOf('--migrate-from') + 1]
      : null);

/**
 * Which node hosts the OLD process — not necessarily the one being deployed to.
 *
 * A process is bound to the scheduler it was spawned on, so moving between
 * nodes means the export is read from the old node while the load is written to
 * the new one. Reading it through the new node's URL cannot work and does not
 * fail helpfully: a node that cannot fetch the process answers
 * `necessary_message_not_found`, which reads like a malformed message rather
 * than "wrong node".
 *
 * Defaults to whatever `live-process.txt` recorded for it, which is exactly
 * where the previous deploy wrote the pairing.
 */
const migrateNode = process.env.MIGRATE_NODE
  || (process.argv.includes('--migrate-node')
      ? process.argv[process.argv.indexOf('--migrate-node') + 1]
      : (PREVIOUS.pid === migrateFrom && PREVIOUS.node) ? PREVIOUS.node : NODE);

if (migrateFrom) {
  console.log(`carrying players across from ${migrateFrom}`);
  if (migrateNode !== NODE) console.log(`  reading it from ${migrateNode}`);
  const readOld = async () => {
    const r = await fetch(
      `${migrateNode}/${migrateFrom}~process@1.0/now/results/output/data`,
      { headers: { accept: 'text/plain' } },
    );
    const body = (await r.text()).trim();
    if (!r.ok) return { error: `${migrateNode} answered ${r.status} for ${migrateFrom}: ${body.slice(0, 160)}` };
    try {
      return JSON.parse(body);
    } catch {
      return { error: `unreadable export from ${migrateFrom}: ${body.slice(0, 160) || '(nothing)'}` };
    }
  };

  /**
   * Read the old player table out, page by page.
   *
   * A page is RETRIED rather than abandoned. This loop used to treat any
   * unreadable chunk as the end of the table — `if (chunk.done || !chunk.count)
   * break` — so one flaky read ended the migration silently and everything past
   * it was dropped. That happened on a real deploy: `read 75/173`, then a chunk
   * with no `count`, and 98 players' progress went missing with nothing in the
   * output calling it an error.
   *
   * Ending short of `total` is now a hard failure. A partial migration is worse
   * than none: it looks like it worked, and the players it lost only find out
   * when they log in.
   */
  const carried = [];
  let carriedHistory = null;
  let expected = null;
  let offset = 0;
  let complete = false;

  for (let page = 0; page < 200 && !complete; page++) {
    let chunk = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      await sendMessage({
        node: migrateNode, jwk, process: migrateFrom, action: 'Admin.Export',
        tags: { Action: 'Admin.Export', Offset: String(offset), Limit: '25' },
      });
      const got = await readOld();
      if (!got.error && Number.isFinite(got.count)) { chunk = got; break; }
      if (got.error && /not authorised/i.test(got.error)) {
        console.error(`\n  export refused: ${got.error}`);
        console.error('  (only the process OWNER can export; check HB_WALLET)');
        break;
      }
      process.stdout.write(`\r  read ${carried.length}/${expected ?? '?'}` +
        `  (page at ${offset} retrying, ${attempt + 1}/4)`);
      await new Promise((r) => setTimeout(r, 1500));
    }
    if (!chunk) {
      console.error(`\n  export stopped at offset ${offset} after 4 attempts.`);
      break;
    }

    if (expected === null && Number.isFinite(chunk.total)) expected = chunk.total;
    if (offset === 0) {
      carriedHistory = {
        offerings: chunk.offerings ?? {},
        checkins: chunk.checkins ?? {},
        metrics: chunk.metrics ?? {},
        audit: chunk.audit ?? [],
        battlesCompleted: chunk.battlesCompleted ?? 0,
        withdrawals: chunk.withdrawals ?? {},
        withdrawSeq: chunk.withdrawSeq ?? 0,
        deposits: chunk.deposits ?? {},
        runeToken: chunk.runeToken ?? '',
      };
    }
    carried.push(...(chunk.players ?? []));
    offset += chunk.count;
    process.stdout.write(`\r  read ${carried.length}/${expected ?? '?'}          `);
    if (chunk.done || chunk.count === 0) complete = true;
  }
  console.log('');

  if (expected !== null && carried.length < expected) {
    console.error(`\n  MIGRATION INCOMPLETE: read ${carried.length} of ${expected} players.`);
    console.error(`  The new process ${pid} has the legacynet restore but NOT the`);
    console.error('  current state of everyone who has played since. Loading a partial');
    console.error('  set would look like success and silently lose the rest, so nothing');
    console.error('  further has been written. Re-run the same command.');
    process.exit(1);
  }

  /**
   * Drop the accounts that exist but were never played.
   *
   * `Admin.Unlock` calls `getPlayer`, so seeding a paid list MINTS a record for
   * every address on it — unlocked, and empty in every other respect. Export
   * those and they look identical to a real player who has nothing.
   *
   * That matters because `Admin.Load` is not uniformly additive. It guards
   * `faction` and `monster` behind a presence check and merges `inventory`, but
   * it RESETS `lootboxes` to whatever the row carries and takes `wins`,
   * `losses`, `questsCompleted` and `joinedAt` unconditionally. So an empty stub
   * landing on top of a restored legacynet player silently strips their loot
   * boxes and zeroes their quest count — and that hits all 168 of them, because
   * the paid list had already minted a stub for every one.
   *
   * A row with nothing in it has nothing to carry: `unlocked` is the only thing
   * it asserts, and both the legacy restore and the paid list assert that too.
   * So skip it and let the older-but-real record stand.
   */
  const untouched = (p) => !p.monster && !p.faction
    && !(p.lootboxes ?? []).length
    && !Number(p.gold)
    && !Object.values(p.inventory ?? {}).some((n) => Number(n) > 0)
    && !Number(p.wins) && !Number(p.losses) && !Number(p.questsCompleted);

  const played = carried.filter((p) => !untouched(p));
  const skipped = carried.length - played.length;
  if (skipped) {
    console.log(`  ${skipped} of ${carried.length} were empty accounts, not carried`);
    console.log("    (an empty row would strip a restored player's loot boxes)");
  }

  const loaded = await loadPlayers(played, 'loaded');
  if (carriedHistory) {
    await sendMessage({
      node: NODE, jwk, process: pid, action: 'Admin.Load',
      data: JSON.stringify({ ...carriedHistory, players: [] }),
    });
    const historyReply = await outJson('load-history');
    if (historyReply.error) throw new Error(`history migration failed: ${historyReply.error}`);
  }

  /**
   * The marketplace, which is custody rather than an index.
   *
   * A companion that is listed for sale lives in `Market` and in NOBODY's
   * collection — that is the whole point of the escrow — so it is not in any
   * player row and walking only the player table does not merely forget the
   * listings, it destroys the creatures inside them. There is nowhere else to
   * recover one from.
   *
   * It pages separately from the players because each entry holds a whole
   * companion and there is no bound on how many people are selling at once.
   * Failing to carry it is fatal for the same reason a partial player
   * migration is: it looks like it worked, and the loss surfaces later as a
   * seller whose companion is simply gone.
   */
  const listings = [];
  let marketSeq = 0;
  let marketHistory = null;
  let marketTotal = null;
  let marketOffset = 0;
  let marketDone = false;
  for (let page = 0; page < 200 && !marketDone; page++) {
    let chunk = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      await sendMessage({
        node: migrateNode, jwk, process: migrateFrom, action: 'Admin.Export',
        tags: { Action: 'Admin.Export', Section: 'market',
                Offset: String(marketOffset), Limit: '25' },
      });
      const got = await readOld();
      // A process deployed before the market existed does not know this
      // section and answers with an ordinary player page. That is not a
      // failure to retry — there is simply nothing to carry.
      //
      // This test has to come FIRST, and a market page has to be identified by
      // carrying a `market` array rather than merely by having a `count`. A
      // player page has a finite `count` too, so the old order accepted one as
      // a market chunk: `marketTotal` was then the PLAYER total, no listing was
      // ever accumulated, and the guard below aborted a healthy deploy with
      // "read 0 of 51" — 51 being the number of players. The fallback branch
      // was unreachable, so the case it was written for never once ran.
      if (got && Array.isArray(got.players) && !Array.isArray(got.market)) {
        marketDone = true;
        break;
      }
      if (!got.error && Number.isFinite(got.count) && Array.isArray(got.market)) {
        chunk = got;
        break;
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    if (marketDone) break;
    if (!chunk) {
      console.error(`\n  market export stopped at offset ${marketOffset} after 4 attempts.`);
      console.error('  Companions in escrow would be destroyed by continuing. Re-run.');
      process.exit(1);
    }
    if (marketTotal === null) marketTotal = chunk.total ?? 0;
    if (marketOffset === 0) {
      marketSeq = chunk.marketSeq ?? 0;
      marketHistory = chunk.marketHistory ?? null;
    }
    listings.push(...(chunk.market ?? []));
    marketOffset += chunk.count;
    if (chunk.done || chunk.count === 0) marketDone = true;
  }

  if (marketTotal !== null && listings.length < marketTotal) {
    console.error(`\n  MARKET MIGRATION INCOMPLETE: read ${listings.length} of ${marketTotal}.`);
    console.error('  Every unread listing is a companion that exists nowhere else.');
    process.exit(1);
  }

  if (listings.length || marketHistory) {
    const BATCH = 10;
    for (let i = 0; i < Math.max(1, Math.ceil(listings.length / BATCH)); i++) {
      await sendMessage({
        node: NODE, jwk, process: pid, action: 'Admin.Load',
        data: JSON.stringify({
          players: [],
          market: listings.slice(i * BATCH, (i + 1) * BATCH),
          marketSeq,
          ...(i === 0 && marketHistory ? { marketHistory } : {}),
        }),
      });
      const reply = await outJson('load-market');
      if (reply.error) throw new Error(`market migration failed: ${reply.error}`);
    }
    console.log(`  carried ${listings.length} listing(s) out of escrow`);
  }

  // Gold, fungible-item and loot-box ledgers, Gold orders/escrow, finite shop
  // reserves, bounded histories and pending policy changes are one durable
  // state object. Load it LAST: its bucket totals describe the complete player
  // and order population, so loading it before paged players would make an
  // intermediate partial world look like a reconciliation correction.
  await sendMessage({
    node: migrateNode, jwk, process: migrateFrom, action: 'Admin.Export',
    tags: { Action: 'Admin.Export', Section: 'economy' },
  });
  const economyExport = await readOld();
  if (economyExport?.section === 'economy' && economyExport.economy) {
    await sendMessage({
      node: NODE, jwk, process: pid, action: 'Admin.Load',
      data: JSON.stringify({ players: [], economy: economyExport.economy }),
    });
    const economyReply = await outJson('load-economy');
    if (economyReply.error) throw new Error(`economy migration failed: ${economyReply.error}`);
    console.log('  carried Gold, item, loot-box, order, shop and policy state');
  } else {
    console.log('  predecessor has no economy export; bootstrapped ledgers from restored holdings');
  }

  console.log(`  carried ${loaded} players across\n`);
}

// Seed the paid list ---------------------------------------------------------

function loadPaidList(file) {
  const raw = fs.readFileSync(file, 'utf8').trim();
  if (raw.startsWith('[') || raw.startsWith('{')) {
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : (parsed.addresses || []);
    // Tolerate [{address: "..."}] as well as ["..."].
    return list.map((e) => (typeof e === 'string' ? e : e.address)).filter(Boolean);
  }
  return raw.split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith('#'));
}

// The paid allow-list is skipped on a --no-paid deploy.
//
// `Admin.Unlock` MINTS a record for every address it is given, so unlocking the
// 168 paid wallets does not merely permit them, it creates 168 accounts. On a
// real deployment that is exactly right. On a test process it is 168 empty
// players sitting under whatever the run is measuring, inflating `users` and
// every leaderboard denominator — and under `--free` it buys nothing anyway,
// because public access already admits any wallet.
const skipPaid = process.argv.includes('--no-paid')
  || process.env.PAID_LIST === '0';
const paidFile = process.env.PAID_LIST || path.join(HERE, 'paid.json');
if (skipPaid) {
  console.log('skipping the paid allow-list (--no-paid)');
} else if (fs.existsSync(paidFile)) {
  const all = [...new Set(loadPaidList(paidFile))];
  // 43-character base64url is what an Arweave address looks like. Anything else
  // is a paste artefact and would otherwise become a permanently unlockable
  // ghost account.
  const valid = all.filter((a) => /^[A-Za-z0-9_-]{43}$/.test(a));
  const rejected = all.filter((a) => !valid.includes(a));
  if (rejected.length) {
    console.log(`skipping ${rejected.length} entries that are not Arweave addresses:`);
    for (const r of rejected.slice(0, 5)) console.log(`  ${JSON.stringify(r)}`);
  }
  console.log(`unlocking ${valid.length} paid addresses from ${path.relative(ROOT, paidFile)}`);

  // Batched: one message carrying 400 addresses is rejected outright, which
  // would silently leave people locked out.
  const BATCH = Number(process.env.BATCH || 50);
  let unlocked = 0;
  for (let i = 0; i < valid.length; i += BATCH) {
    const chunk = valid.slice(i, i + BATCH);
    await sendMessage({
      node: NODE, jwk, process: pid, action: 'Admin.Unlock',
      data: JSON.stringify({ addresses: chunk }),
    });
    const reply = await outJson('unlock');
    if (reply.error) {
      console.error(`\n  unlock failed: ${reply.error}`);
      break;
    }
    unlocked += reply.added ?? 0;
    process.stdout.write(`\r  ${Math.min(i + BATCH, valid.length)}/${valid.length}`);
  }
  console.log(`\n  ${unlocked} newly unlocked\n`);
} else {
  console.log(`No ${path.relative(ROOT, paidFile)} — nobody is unlocked yet.`);
  console.log(`Create it, then: PAID_LIST=... node backend/native/deploy.mjs\n`);
}

// Point the app at it -------------------------------------------------------

/**
 * A deploy that does not update the frontend leaves the site talking to the
 * process this one just replaced, which looks exactly like "everybody lost
 * their account" and is the single easiest thing to forget. So the new id is
 * written everywhere it is read from:
 *
 *   src/lib/hyperbeam.ts   the baked-in default — what a CI build with no env
 *                          set actually ships, so this one is not optional
 *   .env.example           the documented value
 *   .env.local             the local override, created if absent (gitignored)
 *
 * `--no-env` skips all three, for standing up a throwaway process to test
 * against without moving the app off the live one.
 */
function syncEnv(newPid) {
  if (process.argv.includes('--no-env')) {
    console.log('\nNOT updating the app config (--no-env). Point it yourself:');
    console.log(`  VITE_GAME_PROCESS=${newPid}`);
    console.log(`  VITE_HB_NODE=${NODE}`);
    console.log(`  VITE_GAME_OWNER=${owner}\n`);
    return;
  }

  const edits = [];
  const rewrite = (rel, mutate) => {
    const file = path.join(ROOT, rel);
    const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    const after = mutate(before);
    if (after === null || after === before) return;
    fs.writeFileSync(file, after);
    edits.push(rel + (before === null ? ' (created)' : ''));
  };

  // The default in the source. Matched on the surrounding expression rather
  // than on the outgoing id, so this keeps working after the first time.
  const DEFAULT_PID = /(env\.VITE_GAME_PROCESS \|\| ')[A-Za-z0-9_-]{43}(')/;
  const DEFAULT_NODE = /(env\.VITE_HB_NODE \|\| ')[^']+(')/;
  const DEFAULT_OWNER = /(env\.VITE_GAME_OWNER \|\| ')[A-Za-z0-9_-]{43}(')/;
  rewrite('src/lib/hyperbeam.ts', (text) => {
    if (text === null) return null;
    if (!DEFAULT_PID.test(text) || !DEFAULT_NODE.test(text) || !DEFAULT_OWNER.test(text)) {
      console.log('  ! could not find all game defaults in src/lib/hyperbeam.ts');
      console.log(`  ! set VITE_GAME_PROCESS=${newPid}, VITE_HB_NODE=${NODE}, VITE_GAME_OWNER=${owner}`);
      return null;
    }
    return text
      .replace(DEFAULT_PID, `$1${newPid}$2`)
      .replace(DEFAULT_NODE, `$1${NODE}$2`)
      .replace(DEFAULT_OWNER, `$1${owner}$2`);
  });

  const setVar = (text, key, value) => {
    const line = `${key}=${value}`;
    if (text === null) return line + '\n';
    const existing = new RegExp(`^${key}=.*$`, 'm');
    return existing.test(text) ? text.replace(existing, line) : `${text.trimEnd()}\n${line}\n`;
  };

  const setGameVars = (text) => setVar(
    setVar(setVar(text, 'VITE_GAME_PROCESS', newPid), 'VITE_HB_NODE', NODE),
    'VITE_GAME_OWNER', owner,
  );
  rewrite('.env.example', (text) => text === null ? null : setGameVars(text));
  rewrite('.env.local', (text) => setGameVars(
    text ?? '# Local overrides — gitignored. Not committed.\n'));

  if (edits.length) {
    console.log(`\nupdated ${edits.join(', ')} -> ${newPid}`);
    console.log('  the site itself only moves on its next build and deploy');
  } else {
    console.log(`\napp config already points at ${newPid}`);
  }
}

syncEnv(pid);

// Smoke test -----------------------------------------------------------------

if (process.env.SKIP_SMOKE) {
  console.log(`LIVE PROCESS: ${pid}\nNODE: ${NODE}`);
  process.exit(0);
}

console.log('--- smoke: the owner plays through the loop ---');
const scenario = [
  ['Stats',            { Action: 'Stats' }],
  ['Admin.Unlock self',{ Action: 'Admin.Unlock', Addresses: owner }],
  ['Faction.Join',     { Action: 'Faction.Join', Faction: 'Inferno Blades' }],
  ['Monster.Adopt',    { Action: 'Monster.Adopt' }],
  ['Monster.Feed',     { Action: 'Monster.Feed' }],
  ['Lootbox.Open',     { Action: 'Lootbox.Open' }],
  ['Battle.Begin',     { Action: 'Battle.Begin' }],
  ['Battle.Start',     { Action: 'Battle.Start' }],
];
for (const [label, tags] of scenario) {
  let w = Date.now();
  try {
    await sendMessage({ node: NODE, jwk, process: pid, action: tags.Action, tags });
  } catch (e) {
    console.log(`${label.padEnd(19)} FAILED  ${e.message.slice(0, 70)}`);
    continue;
  }
  w = Date.now() - w;
  let r = Date.now();
  const body = await out();
  r = Date.now() - r;
  console.log(`${label.padEnd(19)} write ${String(w).padStart(4)}ms  read ${String(r).padStart(4)}ms  ${body.slice(0, 90)}`);
}

// Fight the whole battle out, one signed message per round.
console.log('\n--- smoke: a full bot battle, one message per round ---');
/**
 * No battle is a normal outcome here, not a failure.
 *
 * The scenario above only reaches the arena from a fresh account; re-run against
 * a process that carried the owner across and `Battle.Begin` answers "Not happy
 * enough", nothing publishes `battle`, and the key 404s. That used to end the
 * deploy on `SyntaxError: Unexpected token '('` — AFTER the process was built,
 * seeded and wired into the app, so a completely successful deploy exited 1 and
 * read as a failure.
 */
const battleKey = await readKey('battle', { attempts: 1 });
let battle = battleKey.startsWith('(') ? null : JSON.parse(battleKey || 'null');
if (!battle) console.log('  no battle to fight (the owner never made it into the arena)');
let round = 0;
while (battle && battle.status === 'battling' && round < 40) {
  round++;
  const move = Object.entries(battle.challenger.moves).find(([, m]) => (m.count ?? 0) > 0);
  const t0 = Date.now();
  await sendMessage({
    node: NODE, jwk, process: pid, action: 'Battle.Attack',
    tags: { Action: 'Battle.Attack', BattleId: battle.id, Move: move ? move[0] : 'struggle' },
  });
  const reply = await outJson('battle round');
  if (reply.error) { console.log(`  round ${round}: ${reply.error}`); break; }
  battle = reply.battle;
  const last = battle.turns[battle.turns.length - 1];
  console.log(`  round ${String(round).padStart(2)}  ${String(Date.now() - t0).padStart(4)}ms  ` +
    `${last.monsterName} used ${last.move}` +
    (last.missed ? ' and missed' : ` for ${last.healthDamage} (+${last.shieldDamage} shield)`) +
    `  | you ${battle.challenger.healthPoints}hp  them ${battle.accepter.healthPoints}hp`);
}
if (battle) console.log(`  battle ${battle.status}, winner: ${battle.winner ?? '-'}`);

console.log(`\nLIVE PROCESS: ${pid}\nNODE: ${NODE}\nOWNER: ${owner}`);
console.log(`\nPoint the app at it:  VITE_GAME_PROCESS=${pid}`);
