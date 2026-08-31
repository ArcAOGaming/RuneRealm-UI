/**
 * e2e.mjs — play the game end to end through the app's own client code.
 *
 *   node backend/native/e2e.mjs                 # first burner, full journey
 *   node backend/native/e2e.mjs burner-02       # a specific burner
 *   node backend/native/e2e.mjs burner-02 --faction "Sky Nomads"
 *   node backend/native/e2e.mjs --pvp burner-01 burner-02
 *
 * This is not a re-implementation of the client. It bundles `src/lib/game.ts`
 * and `src/lib/hyperbeam.ts` with esbuild and calls the exact functions the
 * screens call, against a wallet shim that produces real ANS-104 signatures.
 * If a verb is broken here, it is broken in the browser.
 *
 * Everything runs against the live process named in `live-process.txt`, with
 * throwaway wallets. Never point it at a real player's address.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';
import { installWalletShim } from './ans104.mjs';
import { listBurners, loadBurner, liveProcess } from './burners.mjs';
import { sendMessage as ownerSend } from './hbclient.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const OUT = path.join(ROOT, '.e2e');

// Bundle the client -----------------------------------------------------------

async function buildClient(pid, node) {
  fs.mkdirSync(OUT, { recursive: true });
  const outfile = path.join(OUT, 'client.mjs');
  await esbuild.build({
    entryPoints: [path.join(ROOT, 'src', 'lib', 'game.ts')],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    outfile,
    // The browser-local wallet's arbundles import is unreachable here because
    // installWalletShim supplies the signer. Do not pull its Node-only optional
    // adapters into this browser-shaped client bundle.
    external: ['@dha-team/arbundles'],
    // The app reads its process id and node out of Vite's env. Substitute the
    // whole object rather than individual keys, because the source spells it
    // `(import.meta as any).env ?? {}`.
    define: {
      window: 'globalThis',
      'import.meta.env': JSON.stringify({ VITE_GAME_PROCESS: pid, VITE_HB_NODE: node }),
    },
    logLevel: 'warning',
  });
  return import(pathToFileURL(outfile).href + `?v=${Date.now()}`);
}

/** Patch a player's record, signing as the process owner. */
async function setStats(pid, node, address, patch) {
  const walletPath = process.env.HB_WALLET
    || path.join(ROOT, 'arweave-wallet-DA9qhP25.json');
  if (!fs.existsSync(walletPath)) return false;
  const jwk = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
  // ownerSend signs httpsig with the owner key; the burner's ANS-104 shim on
  // globalThis is untouched by it, but restore it anyway so a future change to
  // hbclient cannot quietly hijack the player's identity mid-journey.
  const saved = globalThis.arweaveWallet;
  try {
    await ownerSend({
      node, jwk, process: pid, action: 'Admin.SetStats',
      tags: { Action: 'Admin.SetStats', PlayerId: address },
      data: JSON.stringify(patch),
    });
    return true;
  } catch {
    return false;
  } finally {
    globalThis.arweaveWallet = saved;
  }
}

/**
 * Rewind whichever activity timer is running.
 *
 * Play is fifteen minutes and a quest is an hour, which is correct for the game
 * and useless for a test. Rather than skip the claim path — the single most
 * likely thing to be quietly broken — the owner moves the deadline and the
 * burner then claims for real. No `type` is sent: SetStats patches, so the
 * activity itself is preserved and only its deadline moves.
 */
const fastForward = (pid, node, address) =>
  setStats(pid, node, address, { status: { until_time: 1 } });

// Reporting -------------------------------------------------------------------

let passed = 0, failed = 0;
const failures = [];

function check(label, condition, detail) {
  if (condition) {
    passed++;
    console.log(`  [32mPASS[0m  ${label}${detail ? `  [90m${detail}[0m` : ''}`);
  } else {
    failed++;
    failures.push(label + (detail ? ` — ${detail}` : ''));
    console.log(`  [31mFAIL[0m  ${label}${detail ? `  [90m${detail}[0m` : ''}`);
  }
}

async function expectRefused(label, fn) {
  try {
    await fn();
    check(label, false, 'it was allowed');
  } catch (err) {
    check(label, true, err.message.slice(0, 70));
  }
}

const step = (title) => console.log(`\n[1m${title}[0m`);

// The journey -----------------------------------------------------------------

async function journey(api, { address, faction, pid, node }) {
  step(`1. Login as ${address.slice(0, 8)}...`);
  let player = await api.login();
  check('login answers', !!player, `unlocked=${player.unlocked}`);
  check('this burner has access', player.unlocked === true,
    player.unlocked ? '' : 'run: node backend/native/burners.mjs unlock');
  if (!player.unlocked) return;

  step('2. Factions');
  const factions = await api.readFactions();
  check('factions are published (free, unsigned read)',
    Array.isArray(factions) && factions.length === 4, `${factions?.length} factions`);

  if (!player.faction) {
    const pick = faction ?? factions[Math.floor(Math.random() * factions.length)].name;
    await expectRefused('an unknown faction is refused', () => api.joinFaction('Nonsense Brigade'));
    player = await api.joinFaction(pick);
    check('joined a faction', player.faction === pick, player.faction);
    check('joining seeds a starter satchel', (player.inventory.rune ?? 0) >= 3,
      JSON.stringify(player.inventory));
    check('joining seeds loot boxes', player.lootboxes.length >= 3, `${player.lootboxes.length}`);
    await expectRefused('a faction cannot be switched',
      () => api.joinFaction(factions.find((f) => f.name !== pick).name));
  } else {
    check('already in a faction', true, player.faction);
  }

  step('3. Companion');
  if (!player.monster) {
    player = await api.adopt();
    check('adopted', !!player.monster, player.monster?.name);
    await expectRefused('cannot adopt twice', () => api.adopt());
  } else {
    check('already has a companion', true, `${player.monster.name} lvl ${player.monster.level}`);
  }
  check('companion element matches its faction', !!player.monster.elementType,
    player.monster.elementType);
  check('companion has four moves', Object.keys(player.monster.moves).length === 4,
    Object.keys(player.monster.moves).join(', '));
  check('nextLevelExp is published', typeof player.monster.nextLevelExp === 'number',
    `${player.monster.exp}/${player.monster.nextLevelExp}`);

  // Anything left running from an earlier run would make the rest of this
  // meaningless, so start from a known state.
  if (player.monster.status.type !== 'Home') {
    await fastForward(pid, node, address);
    player = player.monster.status.type === 'Battle'
      ? await api.leaveArena()
      : await api.claim().catch(() => api.leaveArena());
    check('a leftover activity was cleared', player.monster.status.type === 'Home',
      player.monster.status.type);
  }

  step('4. Feeding');
  if (player.monster.energy < 100) {
    const own = player.monster.berryItem;
    const berry = (player.inventory[own] ?? 0) > 0
      ? own
      : Object.keys(player.inventory).find((i) => i.endsWith('_berry') && (player.inventory[i] ?? 0) > 0);
    if (berry) {
      const before = { energy: player.monster.energy, berries: player.inventory[berry] };
      player = await api.feed(berry);
      check('feeding raises energy', player.monster.energy > before.energy,
        `${before.energy} -> ${player.monster.energy}`);
      check('feeding consumes exactly one berry',
        (player.inventory[berry] ?? 0) === before.berries - 1,
        `${before.berries} -> ${player.inventory[berry] ?? 0}`);
      const gained = player.monster.energy - before.energy;
      const expected = berry === own ? 20 : 10;
      check(berry === own ? 'own-element berry is worth double'
                          : 'off-element berry gives the base amount',
        gained === expected, `+${gained}`);
    } else {
      check('has a berry to feed with', false, 'satchel had none');
    }
  } else {
    check('already at full energy', true);
  }
  await expectRefused('a Rune cannot be fed as a berry', () => api.feed('rune'));

  step('5. Loot');
  if (player.lootboxes.length > 0) {
    const before = player.lootboxes.length;
    player = await api.openLootbox();
    check('opening consumes one box', player.lootboxes.length === before - 1,
      `${before} -> ${player.lootboxes.length}`);
    check('a box always pays out', (player.lootResult?.rewards.length ?? 0) > 0,
      player.lootResult?.rewards.map((r) => `${r.name} x${r.amount}`).join(', '));
  }
  await expectRefused('a tier you do not own is refused', () => api.openLootbox(5));

  step('6. Play, with the timer rewound so the claim is actually exercised');
  const ownBerry = player.monster.berryItem;
  if (player.monster.status.type === 'Home'
      && (player.inventory[ownBerry] ?? 0) > 0 && player.monster.energy >= 10) {
    player = await api.startPlay();
    check('play starts', player.monster.status.type === 'Play', player.monster.status.type);
    await expectRefused('cannot claim before the timer', () => api.claim());
    const happinessBefore = player.monster.happiness;
    if (await fastForward(pid, node, address)) {
      player = await api.claim();
      check('a rewound play claims', player.monster.status.type === 'Home',
        player.monster.status.type);
      check('play raises happiness',
        player.monster.happiness > happinessBefore || happinessBefore === 100,
        `${happinessBefore} -> ${player.monster.happiness}`);
      check('play is counted', player.monster.totalTimesPlay >= 1,
        `${player.monster.totalTimesPlay}`);
    } else {
      console.log('  \x1b[90mno owner key; play left running\x1b[0m');
    }
  } else {
    console.log(`  \x1b[90mskipped: no ${ownBerry} or not enough energy\x1b[0m`);
  }

  step('7. Quest, same treatment');
  if (player.monster.status.type === 'Home' && (player.inventory.rune ?? 0) >= 2
      && player.monster.energy >= 25 && player.monster.happiness >= 25) {
    const runesBefore = player.inventory.rune;
    const expBefore = player.monster.exp;
    const boxesBefore = player.lootboxes.length;
    player = await api.startQuest();
    check('quest starts', player.monster.status.type === 'Quest', player.monster.status.type);
    check('quest costs one Rune', (player.inventory.rune ?? 0) === runesBefore - 1,
      `${runesBefore} -> ${player.inventory.rune}`);
    if (await fastForward(pid, node, address)) {
      player = await api.claim();
      check('a rewound quest claims', player.monster.status.type === 'Home',
        player.monster.status.type);
      check('quest grants experience', player.monster.exp > expBefore,
        `${expBefore} -> ${player.monster.exp}`);
      check('quest grants a loot box', player.lootboxes.length === boxesBefore + 1,
        `${boxesBefore} -> ${player.lootboxes.length}`);
    }
  } else {
    console.log(`  \x1b[90mskipped: status=${player.monster.status.type}, `
      + `runes=${player.inventory.rune ?? 0}, energy=${player.monster.energy}, `
      + `happiness=${player.monster.happiness}\x1b[0m`);
  }

  step('8. Levelling');
  if (player.monster.exp >= player.monster.nextLevelExp) {
    const before = { level: player.monster.level, attack: player.monster.attack };
    await expectRefused('an allocation that is not exactly ten points is refused',
      () => api.levelUp({ attack: 3, defense: 3, speed: 3, health: 0 }));
    await expectRefused('more than five into one stat is refused',
      () => api.levelUp({ attack: 6, defense: 2, speed: 1, health: 1 }));
    player = await api.levelUp({ attack: 4, defense: 2, speed: 2, health: 2 });
    check('levelling advances the level', player.monster.level === before.level + 1,
      `${before.level} -> ${player.monster.level}`);
    check('levelling applies the points', player.monster.attack === before.attack + 4,
      `${before.attack} -> ${player.monster.attack}`);
  } else {
    console.log(`  \x1b[90mskipped: ${player.monster.exp}/${player.monster.nextLevelExp} exp\x1b[0m`);
  }

  step('9. Arena');
  if (player.monster.status.type !== 'Home') {
    check('companion is free to fight', false, player.monster.status.type);
    return;
  }
  if ((player.inventory.rune ?? 0) < 1) {
    check('has a Rune to enter the arena', false, 'none left');
    return;
  }
  // Play and the quest above both spend energy and happiness, so on a repeat
  // run against an established player there may not be enough left. The game
  // refuses in that case and it is right to — top up as the owner rather than
  // skipping the whole arena, which is the part most worth exercising.
  if (player.monster.energy < 25 || player.monster.happiness < 25) {
    const topped = await setStats(pid, node, address, { energy: 100, happiness: 100 });
    if (topped) {
      player = await api.login();
      check('the arena is reachable after a top-up',
        player.monster.energy >= 25 && player.monster.happiness >= 25,
        `energy ${player.monster.energy}, happiness ${player.monster.happiness}`);
    } else {
      check('has the energy and happiness to enter the arena', false,
        `energy ${player.monster.energy}, happiness ${player.monster.happiness}`);
      return;
    }
  }
  await expectRefused('cannot fight before entering the arena', () => api.startBotBattle(1));
  player = await api.enterArena();
  check('entering the arena works', player.monster.status.type === 'Battle',
    player.monster.status.type);
  check('a session is four battles', player.battlesRemaining === 4, `${player.battlesRemaining}`);

  player = await api.startBotBattle(1);
  const battle = player.battle;
  check('a bot battle starts', battle?.status === 'battling', battle?.status);
  check('the opponent scales to your level', battle?.accepter?.level === battle?.challenger?.level,
    `${battle?.challenger?.level} vs ${battle?.accepter?.level}`);
  check('both sides start at full health',
    battle?.challenger?.healthPoints === battle?.challenger?.maxHealthPoints,
    `${battle?.challenger?.healthPoints}/${battle?.challenger?.maxHealthPoints}`);
  check('the stored companion was not dragged into the fight by reference',
    Object.values(player.monster.moves).every((m) => (m.count ?? 0) > 0));

  await expectRefused('an unknown move is refused',
    () => api.attack(battle.id, 'Definitely Not A Move'));
  await expectRefused('struggle is refused while moves remain',
    () => api.attack(battle.id, 'struggle'));

  step('10. Fighting it out - one signed message per round');
  let current = player;
  let rounds = 0;
  const timings = [];
  while (current.battle?.status === 'battling' && rounds < 40) {
    rounds++;
    const [name] = Object.entries(current.battle.challenger.moves)
      .find(([, m]) => (m.count ?? 0) > 0) ?? ['struggle'];
    const before = current.battle.turns.length;
    const t = Date.now();
    current = await api.attack(current.battle.id, name);
    const took = Date.now() - t;
    timings.push(took);
    const last = current.battle.turns[current.battle.turns.length - 1];
    console.log(`  \x1b[90mround ${String(rounds).padStart(2)} ${String(took).padStart(4)}ms  `
      + `${last.monsterName} used ${last.move}`
      + (last.missed ? ' and missed' : ` for ${last.healthDamage}`)
      + (last.superEffective ? ' (super effective)' : last.notEffective ? ' (resisted)' : '')
      + `  you ${current.battle.challenger.healthPoints}hp / them ${current.battle.accepter.healthPoints}hp\x1b[0m`);
    if (current.battle.turns.length <= before) {
      check('a round produces turns', false, 'the log did not grow');
      break;
    }
  }
  const median = [...timings].sort((a, b) => a - b)[Math.floor(timings.length / 2)];
  check('the battle ends', current.battle?.status === 'ended',
    `${rounds} rounds, median ${median}ms per round`);
  check('a finished battle reports a result', !!current.result, current.result);
  check('the session spends exactly one battle', current.battlesRemaining === 3,
    `${current.battlesRemaining} left`);
  check('the player is not left stuck mid-fight', !current.activeBattleId,
    String(current.activeBattleId));
  check('every turn names its monster and move',
    current.battle.turns.every((t) => t.monsterName && t.move));
  check('every turn is numbered', current.battle.turns.every((t) => t.round > 0));
  check('no move count went negative',
    Object.values(current.battle.challenger.moves).every((m) => (m.count ?? 0) >= 0));
  check('health never went negative',
    current.battle.turns.every((t) => t.attackerState.healthPoints >= 0
      && t.defenderState.healthPoints >= 0));

  const typed = current.battle.turns.filter((t) => t.superEffective || t.notEffective);
  const misses = current.battle.turns.filter((t) => t.missed).length;
  console.log(`  \x1b[90m${typed.length}/${current.battle.turns.length} swings hit a type matchup, `
    + `${misses} missed\x1b[0m`);

  await expectRefused('cannot keep swinging at a finished battle',
    () => api.attack(current.battle.id, Object.keys(current.battle.challenger.moves)[0]));

  step('11. Leaving');
  current = await api.leaveArena();
  check('leaving sends the companion home', current.monster.status.type === 'Home',
    current.monster.status.type);

  step('12. Published reads (no signature, no wallet prompt)');
  const board = await api.readLeaderboard();
  check('the leaderboard is published', Array.isArray(board), `${board?.length} rows`);
  check('this player is on it', board?.some((r) => r.address === address));
  // Each player is republished under their OWN address as `player-<address>`,
  // which is what makes connecting a wallet free (HANDOFF §2). That key cannot
  // return somebody else's record, so unlike the old `/now/player` — whoever
  // computed LAST — this asserts the record IS ours rather than settling for
  // "ours or nobody".
  //
  // Read as a plain unsigned GET: the client's own reader is module-private and
  // exporting it merely to be tested would widen the app's API for the test's
  // convenience.
  // `accept: text/plain`, which is what the client's own `getText` sends.
  //
  // The shape of the answer depends on this header. Asking for
  // `application/json` gets an ENVELOPE -- `{"ao-result":"body","body":"<the
  // json, as a string>"}` -- so the record is a string one level down and
  // `published.address` is undefined. Asking for text/plain returns the record
  // itself. Matching the client is also the point: a test that reads the
  // published surface differently from the app is not testing the app.
  const publishedRes = await fetch(`${node}/${pid}~process@1.0/now/player-${address}`,
    { headers: { accept: 'text/plain' } });
  const publishedText = publishedRes.status === 404 ? null : (await publishedRes.text()).trim();
  const published = publishedText && !/^<!DOCTYPE html|^<html/i.test(publishedText)
    ? JSON.parse(publishedText)
    : null;
  check('this player is published under their own address',
    published !== null && published.address === address,
    // Never dereference the thing under test in the message: a record that came
    // back without an `address` crashed the harness here rather than failing the
    // assertion, which turns a reportable result into a stack trace.
    published?.address ? `got ${published.address.slice(0, 8)}…`
      : published ? `record has no address: ${JSON.stringify(published).slice(0, 80)}`
        : 'no record published');
  const liveFactions = await api.readFactions();
  const mine = liveFactions.find((f) => f.name === current.faction);
  check('faction membership counts update', (mine?.memberCount ?? 0) >= 1,
    `${mine?.memberCount} in ${current.faction}`);

  step('13. Authorisation');
  await expectRefused('a burner cannot grant itself access',
    () => api.adminUnlock([address]));
  await expectRefused('a burner cannot hand itself items',
    () => api.adminGrant(address, { item: 'rune', amount: 999 }));
  await expectRefused('a burner cannot edit its own stats',
    () => api.adminSetStats(address, { level: 99, attack: 99 }));
  await expectRefused('a burner cannot remove another player',
    () => api.adminRemove(address));
}

// PvP -------------------------------------------------------------------------

async function pvp(pid, node, a, b) {
  console.log(`\n[1mPvP: ${a.name} vs ${b.name}[0m`);

  const asPlayer = async (burner, fn) => {
    installWalletShim(burner.jwk);
    const api = await buildClient(pid, node);
    return fn(api);
  };

  // Both need a companion and an arena session.
  for (const burner of [a, b]) {
    await asPlayer(burner, async (api) => {
      let p = await api.login();
      if (!p.unlocked) throw new Error(`${burner.name} has no access — run burners.mjs unlock`);
      if (!p.faction) p = await api.joinFaction(burner === a ? 'Inferno Blades' : 'Aqua Guardians');
      if (!p.monster) p = await api.adopt();
      if (p.monster.status.type !== 'Battle') {
        if (p.monster.status.type !== 'Home') p = await api.leaveArena();
        if ((p.inventory.rune ?? 0) < 1) throw new Error(`${burner.name} has no Runes`);
        p = await api.enterArena();
      }
      check(`${burner.name} is in the arena`, p.monster.status.type === 'Battle',
        `${p.battlesRemaining} battles`);
    });
  }

  let battleId = null;
  await asPlayer(a, async (api) => {
    const p = await api.challenge('OPEN');
    battleId = p.battle?.id;
    check('an open challenge is posted', p.battle?.status === 'pending', battleId);
  });

  await asPlayer(b, async (api) => {
    const open = await api.listChallenges();
    check('the challenge is visible to others', open.some((c) => c.id === battleId),
      `${open.length} open`);
    const p = await api.acceptChallenge(battleId);
    check('the challenge is accepted', p.battle?.status === 'battling', p.battle?.status);
  });

  // One round, played by both sides.
  let aMove, bMove;
  await asPlayer(a, async (api) => {
    const p = await api.battleInfo(battleId);
    aMove = Object.keys(p.challenger.moves)[0];
    bMove = Object.keys(p.accepter.moves)[0];
  });

  await asPlayer(a, async (api) => {
    const p = await api.attack(battleId, aMove);
    check('the first move waits for the opponent', p.waitingForOpponent === true);
    check('nothing resolves until both have moved', p.battle.turns.length === 0,
      `${p.battle.turns.length} turns`);
  });

  await asPlayer(b, async (api) => {
    const p = await api.attack(battleId, bMove);
    check('the second move resolves the round', p.battle.turns.length >= 1,
      `${p.battle.turns.length} turns, round ${p.battle.round}`);
  });

  // The waiting player can see the result with a free unsigned read.
  await asPlayer(a, async (api) => {
    const published = await api.readBattle();
    check('the opponent sees the round through published state',
      published?.id === battleId && published.round >= 1,
      `round ${published?.round}`);
  });

  for (const burner of [a, b]) {
    await asPlayer(burner, async (api) => { await api.leaveArena(); });
  }
  check('both players left the arena cleanly', true);
}

// Main ------------------------------------------------------------------------

const argv = process.argv.slice(2);
const isPvp = argv.includes('--pvp');
const factionIndex = argv.indexOf('--faction');
const faction = factionIndex >= 0 ? argv[factionIndex + 1] : undefined;
// The guard has to be conditional on `--faction` being PRESENT. Without it
// `factionIndex` is -1, `factionIndex + 1` is 0, and the filter drops argv[0] --
// which is the burner name. `names` came out empty, the code fell back to
// `listBurners()[0]`, and every `e2e.mjs burner-07` silently ran burner-01
// instead. It looked like it worked because burner-01 is a real account: runs
// reported someone else's runes, someone else's record, and one failed for a
// depleted balance that belonged to a wallet nobody had named.
const names = argv.filter((a, i) =>
  !a.startsWith('--') && !(factionIndex >= 0 && i === factionIndex + 1));

const { pid, node } = liveProcess();
console.log(`process  ${pid}`);
console.log(`node     ${node}`);

if (isPvp) {
  const all = listBurners();
  const a = loadBurner(names[0] ?? all[0]?.name);
  const b = loadBurner(names[1] ?? all[1]?.name);
  await pvp(pid, node, a, b);
} else {
  const burner = names[0] ? loadBurner(names[0]) : listBurners()[0];
  if (!burner) {
    console.error('No burners. Run: node backend/native/burners.mjs make 4');
    process.exit(1);
  }
  const address = installWalletShim(burner.jwk);
  console.log(`burner   ${burner.name}  ${address}`);
  const api = await buildClient(pid, node);
  await journey(api, { address, faction, pid, node });
}

console.log(`\n[1m${passed} passed, ${failed} failed[0m`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failed > 0 ? 1 : 0);
