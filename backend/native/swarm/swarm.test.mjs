import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildSwarmClient } from './build-client.mjs';
import { FACTIONS, PROFILES, ROLE_DEFINITIONS, profileFor, pvpPairs } from './profiles.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');

assert.equal(PROFILES.length, 50, 'there must be exactly fifty stable profiles');
assert.equal(new Set(PROFILES.map((profile) => profile.wallet)).size, 50, 'wallet names must be unique');
assert.equal(new Set(PROFILES.map((profile) => profile.callSign)).size, 50, 'call signs must be unique');
assert.deepEqual(PROFILES.map((profile) => profile.wallet),
  Array.from({ length: 50 }, (_, index) => `burner-${String(index + 1).padStart(2, '0')}`));

for (const profile of PROFILES) {
  assert.ok(ROLE_DEFINITIONS[profile.role], `${profile.wallet} has a known role`);
  assert.ok(FACTIONS.includes(profile.faction), `${profile.wallet} has a real faction`);
  assert.ok(profile.description.length >= 30, `${profile.wallet} has a useful description`);
  assert.equal(Object.values(profile.statPlan).reduce((sum, value) => sum + value, 0), 10,
    `${profile.wallet} allocates exactly ten level-up points`);
  assert.ok(Object.values(profile.statPlan).every((value) => value >= 0 && value <= 5),
    `${profile.wallet} respects the per-stat allocation limit`);
  assert.equal(profileFor(profile.wallet), profile);
}

const pairs = pvpPairs();
assert.equal(pairs.length, 5, 'ten duelists should form five pairs');
for (const pair of pairs) {
  assert.ok(pair.challenger, `${pair.name} has a challenger`);
  assert.ok(pair.accepter, `${pair.name} has an accepter`);
  assert.notEqual(pair.challenger.wallet, pair.accepter.wallet);
  assert.equal(pair.challenger.role, 'duelist');
  assert.equal(pair.accepter.role, 'duelist');
}

assert.equal(pvpPairs(PROFILES.slice(0, 26)).length, 0,
  'a limit that selects only half a pair must not create an invalid pair');

const built = await buildSwarmClient({
  root: ROOT,
  pid: 'A'.repeat(43),
  node: 'https://example.invalid',
  outDir: path.join(ROOT, '.swarm', 'test-generated'),
});
const api = await import(pathToFileURL(built.file).href + `?test=${Date.now()}`);
for (const verb of ['login', 'joinFaction', 'adopt', 'startQuest', 'openLootbox',
  'levelUp', 'enterArena', 'startBotBattle', 'challenge', 'acceptChallenge', 'attack']) {
  assert.equal(typeof api[verb], 'function', `the bundled client exports ${verb}`);
}

console.log('swarm: 50 wallets, 7 roles, 5 PvP pairs, real client bundle — valid');
