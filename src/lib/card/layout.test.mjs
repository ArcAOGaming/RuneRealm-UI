/**
 * The card's move order, which is a fact about a signed artifact.
 *
 * A minted card is an Arweave transaction: whatever order the rows came out in
 * is the order they are in forever. `orderedMoves` therefore has to be a pure
 * function of the companion and nothing else — no clock, no roll, no fact about
 * the fighter that could differ between the preview a player approved and the
 * mint the worker signs.
 *
 * Run with `npm run test:card`. Costs nothing and needs no node.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { orderedMoves } from './layout.mjs';

const monster = (moves) => ({ moves });

test('the rarest move leads', () => {
  const rows = orderedMoves(monster({
    'Scorching Ash': { type: 'fire', rarity: 2 },
    Firenado: { type: 'fire', rarity: 1 },
    Recovery: { type: 'heal', rarity: 2 },
  }));
  assert.deepEqual(rows.map((m) => m.name), ['Firenado', 'Scorching Ash', 'Recovery']);
});

test('a rare NEUTRAL move still leads, over an element move of a commoner tier', () => {
  // The top row is the rarest thing the companion has, not the most elemental.
  // Rarity is what a player chased; the element is just where it came from.
  const rows = orderedMoves(monster({
    Campfire: { type: 'fire', rarity: 3 },
    'Life Surge': { type: 'heal', rarity: 1 },
    'Quick Jab': { type: 'normal', rarity: 2 },
  }));
  assert.deepEqual(rows.map((m) => m.name), ['Life Surge', 'Quick Jab', 'Campfire']);
});

test('inside a tier the element move leads, then the name', () => {
  const rows = orderedMoves(monster({
    'Iron Skin': { type: 'boost', rarity: 2 },
    Whirlpool: { type: 'water', rarity: 2 },
    'Ice Spear': { type: 'water', rarity: 2 },
  }));
  assert.deepEqual(rows.map((m) => m.name), ['Ice Spear', 'Whirlpool', 'Iron Skin']);
});

test('the order does not depend on the order the roster was built in', () => {
  const set = {
    Tornado: { type: 'air', rarity: 1 },
    'Gale Force': { type: 'air', rarity: 3 },
    Regenerate: { type: 'heal', rarity: 2 },
  };
  const forwards = orderedMoves(monster(set));
  const backwards = orderedMoves(monster(Object.fromEntries(Object.entries(set).reverse())));
  assert.deepEqual(forwards, backwards);
});

test('a compact roster, with no rarity to sort on, still renders', () => {
  // `{ count }` and nothing else is what a record carries before `hydrateMoves`
  // joins it against `catalog.movePools`. Every move ties at the common tier and
  // the order falls back to element, then name — never to undefined.
  const rows = orderedMoves(monster({
    Whirlpool: { count: 4 },
    Heal: { count: 3 },
    'Tidal Wave': { count: 3 },
  }));
  assert.equal(rows.length, 3);
  assert.ok(rows.every((m) => typeof m.name === 'string'));
  assert.deepEqual(rows, orderedMoves(monster({
    Heal: { count: 3 },
    'Tidal Wave': { count: 3 },
    Whirlpool: { count: 4 },
  })));
});

test('a roster longer than the card is trimmed, not overflowed', () => {
  // A record written before the slot count moved carries four. The card has
  // three rows; a fourth would be drawn outside the box.
  const rows = orderedMoves(monster({
    Firenado: { type: 'fire', rarity: 1 },
    Inferno: { type: 'fire', rarity: 2 },
    'Power Up': { type: 'boost', rarity: 1 },
    Campfire: { type: 'fire', rarity: 3 },
  }));
  assert.equal(rows.length, 3);
  assert.ok(!rows.some((m) => m.name === 'Campfire'));
});

test('a companion with no moves at all is empty, not a crash', () => {
  assert.deepEqual(orderedMoves(undefined), []);
  assert.deepEqual(orderedMoves({}), []);
  assert.deepEqual(orderedMoves({ moves: {} }), []);
});
