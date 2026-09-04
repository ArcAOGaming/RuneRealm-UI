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
 *   --seed-legacy [file]                DO restore the legacynet players (OFF by
 *                                       default; an optional path replaces
 *                                       legacy-players.json)
 *   --no-seed-legacy                    explicit off — already the default
 *   --paid-list                         DO unlock the paid allow-list (OFF by
 *                                       default; PAID_LIST=<file> implies it)
 *   --no-paid                           explicit off — already the default
 *   --no-env                            do NOT point the app at the new process
 *   --public-access / --free            explicit free sign-up — already the default
 *   --paid-access / --no-free           gate sign-up behind the Eternal Pass
 *
 * A successful deploy writes the new id into `src/lib/hyperbeam.ts`,
 * `.env.example` and `.env.local`, because a deploy that does not is
 * indistinguishable from every player losing their account.
 *
 * A DEPLOY IS BLANK BY DEFAULT: no legacynet restore, no paid allow-list, no
 * migration. Every one of those is opt-in (`--seed-legacy`, `--paid`,
 * `--migrate-from`) and belongs to a final build, because the accounts they
 * create are permanent and carrying them through every test deploy is how a
 * chain of half-finished migrations starts.
 *
 * When they ARE asked for, the legacynet restore runs BEFORE `--migrate-from`
 * so that a live deployment's state always wins over a February 2026
 * checkpoint — see the note on that block, because the order is load-bearing.
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
import { spawnProcess, sendMessage, jwkToAddress, transportNode } from './hbclient.mjs';
import { minifyLua } from './lua-minify.mjs';
import { gameModuleSources } from './game-bundle.mjs';

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
const REQUEST_NODE = transportNode(NODE);
const WALLET = process.env.HB_WALLET || path.join(ROOT, 'arweave-wallet-DA9qhP25.json');
/**
 * Sign-up is FREE by default; gating it is the deliberate act.
 *
 * It used to be the other way round, and that made the Eternal Pass allow-list
 * the thing you got by forgetting a flag — a process nobody can join, which
 * looks from the client exactly like a broken deploy. Anyone who wants the
 * gate asks for it: `--paid-access` (`--no-free`, `PUBLIC_ACCESS=0`).
 */
const freeEnabled = process.argv.includes('--free')
  || process.argv.includes('--public-access');
const freeDisabled = process.argv.includes('--no-free')
  || process.argv.includes('--no-public-access')
  || process.argv.includes('--paid-access');
if (freeEnabled && freeDisabled) {
  throw new Error('Choose one access mode: --free (the default) or --paid-access, not both');
}
const PUBLIC_ACCESS = freeEnabled ? true : !(
  freeDisabled || /^(0|false|no|off)$/i.test(process.env.PUBLIC_ACCESS || '')
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
// other than what ships. `minifyLua` below is the one permitted difference: it
// deletes comments and layout and nothing else, so the suite and the module are
// the same program.
//
// The list itself lives in `game-bundle.mjs` rather than here, because
// `lua-minify.test.mjs` measures the assembled module against the deploy
// ceiling and used to re-declare the list by hand. Two copies drifted apart
// once already; one copy cannot.
const sources = gameModuleSources({
  publicAccess: PUBLIC_ACCESS,
  hyperAos: process.env.HYPER_AOS || null,
});

/**
 * Strip the comments out of the module — not out of the sources.
 *
 * The module reaches the scheduler as ONE signed message, and a public
 * scheduler drops an oversized one with `500 scheduler_timeout`: no useful
 * error, just a spawn that never happened. The cliff was bracketed on both
 * hyperbeam.tylerw.ai and schedule.forward.computer — 524,452 B spawns in
 * 10.9 s, 540,836 B fails — and the assembled bundle was 539,904 B. That is
 * why this could not be deployed to any public node at all.
 *
 * About a third of those bytes were comments and indentation. They belong in
 * the source files, which are where the reasoning for every rule in CLAUDE.md
 * actually lives, and they do not belong in a scheduler message. `minifyLua`
 * is a lexer rather than a regex, because both traps here are context: `--`
 * inside a string is not a comment and `]]` inside a long string ends nothing.
 * It preserves every token, name, number and string byte for byte, so `int()`
 * narrowing, the published key names and the balance constants are untouched.
 */
const sourceBytes = Buffer.byteLength(sources);
const lua = minifyLua(sources);
const moduleBytes = Buffer.byteLength(lua);

/**
 * Refuse to spawn a module that is close to the cliff, rather than finding out
 * from the scheduler.
 *
 * The bracket is a bracket: the real limit is somewhere in a 16 KB gap, it is
 * the scheduler's rather than ours, and it can move. The bundle also grows
 * every time a handler is added. Failing here costs a re-run and names the
 * problem; failing at the scheduler leaves no process, a 500, and nothing that
 * says what was wrong.
 */
const MODULE_BYTE_CEILING = 480_000;
if (moduleBytes > MODULE_BYTE_CEILING) {
  throw new Error(
    `module is ${moduleBytes} bytes, over the ${MODULE_BYTE_CEILING} B ceiling `
    + `(${sourceBytes} B of source). A public scheduler answers 500 scheduler_timeout above `
    + '~524 KB and spawns nothing. Delete bytes — dead handlers, duplicated tables, constants '
    + 'that the client can join from `catalog`. Moving them between files does not help.',
  );
}

console.log(`node:   ${NODE}`);
console.log(`owner:  ${owner}`);
console.log(`access: ${PUBLIC_ACCESS ? 'public (new wallets may join)' : 'Eternal Pass allow-list'}`);
console.log('fleet:  unconfigured (monolith; staged one-time fleet seal available)');
console.log(`module: ${moduleBytes} bytes (${sourceBytes} B of source, comments stripped)`);

let t = Date.now();
const pid = await spawnProcess({ node: NODE, jwk, lua, name: 'TEST-Rune Realm Game' });
console.log(`spawn:  ${Date.now() - t} ms`);
console.log(`pid:    ${pid}\n`);

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
      const r = await fetch(`${REQUEST_NODE}/${pid}~process@1.0/now/${k}`, { headers: { accept: 'text/plain' } });
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

/**
 * Read the result produced by one exact scheduled message.
 *
 * `results/output/data` under `/now` is process-global and can be overwritten
 * by an automatic push, a concurrent bot, or any later message. Deployment
 * acknowledgements must therefore be read at the slot returned by the write.
 */
const readSlot = async (node, processId, slot, {
  attempts = 60, delayMs = 2000,
} = {}) => {
  let last = '(no answer)';
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetch(
        `${transportNode(node)}/${processId}~process@1.0/compute&slot=${slot}/results/output/data`,
        { headers: { accept: 'text/plain' } },
      );
      const body = (await response.text()).trim();
      if (response.ok && body && !/^<!DOCTYPE html|^<html/i.test(body)) return body;
      last = response.ok ? 'HTML/empty reply' : `status ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return `(${last})`;
};

const sendAndRead = async (message, what) => {
  const sent = await sendMessage(message);
  const slot = sent && (sent.slot ?? sent.Slot);
  if (slot === undefined || slot === null) {
    return { error: `${what} did not report a compute slot` };
  }
  const body = await readSlot(message.node, message.process, slot);
  try {
    return JSON.parse(body);
  } catch {
    return { error: `${what} slot ${slot} returned ${body.slice(0, 180) || '(nothing)'}` };
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
  // The largest 25-player legacy payload is ~23 KB. This stays comfortably
  // below the relay/node limits while avoiding 17 slow scheduler round trips.
  const BATCH = 25;
  for (let i = 0; i < rows.length; i += BATCH) {
    const reply = await sendAndRead({
      node: NODE, jwk, process: pid, action: 'Admin.Load',
      data: JSON.stringify({ players: rows.slice(i, i + BATCH) }),
    }, 'load');
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
 * OFF BY DEFAULT, and asked for once. `legacy-players.json` is committed and
 * holds the 168 who played on legacynet — their faction, companion, level,
 * stats, loot boxes and berries. `--seed-legacy` (or `SEED_LEGACY=<file>`)
 * restores them; a path after the flag reads a different file.
 *
 * It is opt-in because those 168 accounts are the real thing. Under a test
 * process they are someone else's history sitting beneath whatever the run is
 * measuring, and every deploy that carries them forward is another chance to
 * carry them forward WRONG. They are restored onto the process that actually
 * launches, once.
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
const legacyOff = process.env.SEED_LEGACY === '0' || process.argv.includes('--no-seed-legacy');
// SEED_LEGACY may name a file or simply say yes; both mean "restore".
const legacyEnv = !legacyOff && process.env.SEED_LEGACY
  ? (/^(1|true|yes|on)$/i.test(process.env.SEED_LEGACY)
    ? 'legacy-players.json'
    : process.env.SEED_LEGACY)
  : null;
const seedLegacy = legacyOff
  ? null
  : (legacyPath || legacyEnv || (legacyArg !== -1 ? 'legacy-players.json' : null));

if (seedLegacy) {
  const file = path.isAbsolute(seedLegacy) ? seedLegacy : path.join(HERE, seedLegacy);
  if (!fs.existsSync(file)) {
    // The restore is opt-in now, so getting here means it was asked for by name
    // and is not on disk. That is a failed deploy, never a quiet skip.
    console.log(`No ${path.relative(ROOT, file)} — no legacynet players restored.`);
    console.log('  npm run recover:state && npm run recover:build\n');
    process.exit(1);
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
      const reply = await sendAndRead({
        node: NODE, jwk, process: pid, action: 'Admin.Load',
        data: JSON.stringify({
          offerings: parsed.offerings,
          checkins: parsed.checkins ?? {},
          players: [],
        }),
      }, 'load-offerings');
      if (reply.error) throw new Error(`offering migration failed: ${reply.error}`);
      const tally = Object.entries(parsed.offerings)
        .map(([f, n]) => `${f} ${n}`).join(', ');
      console.log(`  faction offerings restored: ${tally}`);
      const days = Object.keys(parsed.checkins ?? {}).length;
      if (days) console.log(`  ${days} days of worship history restored`);
    }
    console.log('');
  }
} else {
  console.log('blank: no legacynet restore (--seed-legacy restores them)');
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
      const got = await sendAndRead({
        node: migrateNode, jwk, process: migrateFrom, action: 'Admin.Export',
        tags: { Action: 'Admin.Export', Offset: String(offset), Limit: '25' },
      }, 'player export');
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
        monsterIndexOverrides: chunk.monsterIndexOverrides ?? {},
        monsterIndexRevision: chunk.monsterIndexRevision ?? 1,
        battlesCompleted: chunk.battlesCompleted ?? 0,
        withdrawals: chunk.withdrawals ?? {},
        withdrawSeq: chunk.withdrawSeq ?? 0,
        deposits: chunk.deposits ?? {},
        runeToken: chunk.runeToken ?? '',
        // The allow-list, which is in NO page of players.
        //
        // `Admin.Unlock` no longer mints a record for the addresses it admits
        // — an empty account is ~6 live Lua tables swept quadratically by every
        // message from every player, forever — so an admitted wallet that has
        // not logged in yet exists only as a string in the old process. Drop it
        // here and the redeploy locks out every paid holder who had not played.
        unlockedAddresses: chunk.unlockedAddresses ?? [],
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
   * `Admin.Unlock` USED to call `getPlayer`, which minted a record for every
   * address on a paid list — unlocked, and empty in every other respect. Export
   * those and they look identical to a real player who has nothing. It now
   * admits an address as a string instead (see `Unlocked` in game.lua), so a
   * process deployed after that change produces no such rows; this filter stays
   * because the process being migrated FROM may predate it, and because an
   * account can still be emptied by other means.
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
    const historyReply = await sendAndRead({
      node: NODE, jwk, process: pid, action: 'Admin.Load',
      data: JSON.stringify({ ...carriedHistory, players: [] }),
    }, 'load-history');
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
      const got = await sendAndRead({
        node: migrateNode, jwk, process: migrateFrom, action: 'Admin.Export',
        tags: { Action: 'Admin.Export', Section: 'market',
                Offset: String(marketOffset), Limit: '25' },
      }, 'market export');
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
      const reply = await sendAndRead({
        node: NODE, jwk, process: pid, action: 'Admin.Load',
        data: JSON.stringify({
          players: [],
          market: listings.slice(i * BATCH, (i + 1) * BATCH),
          marketSeq,
          ...(i === 0 && marketHistory ? { marketHistory } : {}),
        }),
      }, 'load-market');
      if (reply.error) throw new Error(`market migration failed: ${reply.error}`);
    }
    console.log(`  carried ${listings.length} listing(s) out of escrow`);
  }

  // Gold, fungible-item and loot-box ledgers, Gold orders/escrow, finite shop
  // reserves, bounded histories and pending policy changes are one durable
  // state object. Load it LAST: its bucket totals describe the complete player
  // and order population, so loading it before paged players would make an
  // intermediate partial world look like a reconciliation correction.
  const economyExport = await sendAndRead({
    node: migrateNode, jwk, process: migrateFrom, action: 'Admin.Export',
    tags: { Action: 'Admin.Export', Section: 'economy' },
  }, 'economy export');
  if (economyExport?.section === 'economy' && economyExport.economy) {
    const economyReply = await sendAndRead({
      node: NODE, jwk, process: pid, action: 'Admin.Load',
      data: JSON.stringify({ players: [], economy: economyExport.economy }),
    }, 'load-economy');
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

// The paid allow-list is OFF unless this deploy asks for it (`--paid-list`).
//
// This is not the access mode — that is `--paid-access`, and it decides whether
// an unknown wallet may join at all. This decides whether the wallets that
// already bought a pass are minted into the new process.
//
// `Admin.Unlock` admits each address as a STRING and mints nothing, so
// unlocking the 168 paid wallets permits them without creating 168 accounts.
// That is what `--paid` (or `PAID_LIST=<file>`) is for. It no longer moves
// `users` or any leaderboard denominator — the admitted count is published
// separately as `allowlisted` — and under `--free` it buys nothing anyway,
// because public access already admits any wallet.
const paidEnv = process.env.PAID_LIST && process.env.PAID_LIST !== '0'
  ? process.env.PAID_LIST
  : null;
const skipPaid = process.argv.includes('--no-paid')
  || process.env.PAID_LIST === '0'
  || !(process.argv.includes('--paid-list') || paidEnv);
const paidFile = paidEnv && !/^(1|true|yes|on)$/i.test(paidEnv)
  ? paidEnv
  : path.join(HERE, 'paid.json');
if (skipPaid) {
  console.log('blank: no paid allow-list (--paid-list unlocks it)');
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
    const reply = await sendAndRead({
      node: NODE, jwk, process: pid, action: 'Admin.Unlock',
      data: JSON.stringify({ addresses: chunk }),
    }, 'unlock');
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

// Publish the canonical process pointer LAST. A partially seeded process must
// never become the target of the app, operators, or a watcher-driven bot run.
// `redeploy.mjs` waits for this child to exit before reading the file, so it
// does not need the id earlier.
fs.writeFileSync(path.join(ROOT, 'live-process.txt'), `${pid}\n${NODE}\n${owner}\n`);

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
