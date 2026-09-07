import assert from 'node:assert/strict';
import test from 'node:test';

import { chooseProgressionAction } from './strategy.mjs';

const profile = { role: 'quester' };
const player = (patch = {}) => ({
  inventory: { rune: 50, air_berry: 5, water_berry: 5, fire_berry: 5, rock_berry: 5 },
  lootboxes: [], gold: 500, rosterMax: 3, monsters: { m1: {} }, collection: {},
  monster: { energy: 60, happiness: 60, level: 1, exp: 0, nextLevelExp: 50 },
  ...patch,
});
const choices = (...names) => names.map((name) => ({ name, weight: 1 }));

test('ready worship wins over random and coverage choices', () => {
  const decision = chooseProgressionAction({
    candidates: choices('bot', 'daily', 'quest'), player: player(), profile,
    random: () => 0.99, prefer: 'bot',
  });
  assert.deepEqual(decision, { action: 'daily', reason: 'claim-ready-worship' });
});

test('hard care needs restore the companion before discretionary progression', () => {
  const energy = chooseProgressionAction({
    candidates: choices('quest', 'feed', 'bot'),
    player: player({ monster: { energy: 10, happiness: 60 } }), profile,
    random: () => 0.99, prefer: 'bot',
  });
  assert.equal(energy.action, 'feed');

  const happiness = chooseProgressionAction({
    candidates: choices('quest', 'play', 'bot'),
    player: player({ monster: { energy: 60, happiness: 10 } }), profile,
    random: () => 0.99,
  });
  assert.equal(happiness.action, 'play');
});

test('fighters earn Gold before selecting another arena session', () => {
  const fighter = { role: 'arena', weights: { bot: 14 } };
  const broke = player({ gold: 5 });
  assert.deepEqual(chooseProgressionAction({
    candidates: choices('bot', 'quest', 'shop_trade'), player: broke,
    profile: fighter, random: () => 0.99, arenaMinEntry: 10,
  }), { action: 'shop_trade', reason: 'sell-surplus-for-arena-stake' });
  assert.deepEqual(chooseProgressionAction({
    candidates: choices('bot', 'quest'), player: broke,
    profile: fighter, random: () => 0.99, arenaMinEntry: 10,
  }), { action: 'quest', reason: 'quest-for-arena-stake' });
});

test('coverage direction is honored only when the requested action is legal', () => {
  assert.equal(chooseProgressionAction({
    candidates: choices('quest', 'feed'), player: player(), profile,
    random: () => 0.5, prefer: 'feed',
  }).action, 'feed');
  assert.notEqual(chooseProgressionAction({
    candidates: choices('quest'), player: player(), profile,
    random: () => 0.5, prefer: 'trade',
  }).action, 'trade');
});

test('normal turns use progression utility but retain an exploration lane', () => {
  const progressionRolls = [0.5, 0.5];
  const progression = chooseProgressionAction({
    candidates: choices('quest', 'probe'),
    player: player({ monster: { energy: 60, happiness: 60, exp: 40, nextLevelExp: 50 } }),
    profile, random: () => progressionRolls.shift() ?? 0.5,
  });
  assert.equal(progression.action, 'quest');
  assert.equal(progression.reason, 'progression-weighted');

  const explorationRolls = [0, 0.99];
  const exploration = chooseProgressionAction({
    candidates: [{ name: 'quest', weight: 1 }, { name: 'bot', weight: 9 }],
    player: player(), profile, explorationRate: 1,
    random: () => explorationRolls.shift() ?? 0.5,
  });
  assert.equal(exploration.action, 'bot');
  assert.equal(exploration.reason, 'role-weighted-exploration');
});

test('hunt and stored-companion utility paths are ranked', () => {
  const hunt = chooseProgressionAction({
    candidates: choices('hunt'), player: player(), profile,
    random: () => 0.5,
  });
  assert.equal(hunt.action, 'hunt');

  const swap = chooseProgressionAction({
    candidates: choices('swap'),
    player: player({ collection: { m2: { level: 9 } } }),
    profile, random: () => 0.5,
  });
  assert.equal(swap.action, 'swap');
});
