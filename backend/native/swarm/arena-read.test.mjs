import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { resolveArenaBattle } from './arena-read.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');

test('a live fight on the account record is read without a message', () => {
  const battle = { id: 'b1', status: 'battling', round: 3 };
  const player = { address: 'A'.repeat(43), activeBattleId: 'b1', battle };
  assert.deepEqual(resolveArenaBattle(player, 'b1'), { battle },
    'the published record already carries the battle; asking the process for it costs a slot');
});

test('an ended fight still named by the account is handed back, not called terminal', () => {
  // Settlement clears `activeBattleId`, so this is the window before it. The
  // caller distinguishes "ended, settle it" from "gone, reconcile it" and the
  // two produce different swarm events; collapsing them here would lose the
  // settlement receipt.
  const battle = { id: 'b1', status: 'ended', winner: 'A'.repeat(43) };
  const player = { activeBattleId: 'b1', battle };
  assert.deepEqual(resolveArenaBattle(player, 'b1'), { battle });
});

test('an account that no longer names the battle is terminal, with no message sent', () => {
  assert.deepEqual(resolveArenaBattle({ activeBattleId: null }, 'b1'), { terminal: true });
  assert.deepEqual(resolveArenaBattle({ activeBattleId: 'b2', battle: { id: 'b2' } }, 'b1'),
    { terminal: true }, 'a DIFFERENT active battle is not this battle');
  assert.deepEqual(resolveArenaBattle(null, 'b1'), { terminal: true });
  assert.deepEqual(resolveArenaBattle({ activeBattleId: 'b1' }, null), { terminal: true });
});

test('only a record that cannot answer falls back to the signed read', () => {
  assert.deepEqual(resolveArenaBattle({ activeBattleId: 'b1' }, 'b1'), { needsMessage: true },
    'locked to the id but carrying no battle table — a fleet-routed fight');
  assert.deepEqual(
    resolveArenaBattle({ activeBattleId: 'b1', battle: { id: 'b9' } }, 'b1'),
    { needsMessage: true },
    'a record carrying somebody else\'s battle must never be moved against');
});

test('the PvP round path reads the battle before it will send Battle.Info', () => {
  // The regression this pins is a whole authority slot per round, per side.
  // Production's own slot log measured it: 2,877 `Battle.Info` against 2,891
  // `Battle.Attack` on the game authority. `Battle.Info` may still appear in
  // `pvpMove`, but only AFTER `resolveArenaBattle` has been consulted.
  const worker = fs.readFileSync(path.join(HERE, 'worker.mjs'), 'utf8');
  const pvp = worker.slice(worker.indexOf('async function pvpMove('));
  assert.ok(pvp.startsWith('async function pvpMove('), 'pvpMove still exists');
  const body = pvp.slice(0, pvp.indexOf('\nasync function '));
  const resolveAt = body.indexOf('resolveArenaBattle(');
  const messageAt = body.indexOf('api.battleInfo(');
  assert.ok(resolveAt > -1, 'pvpMove resolves the battle from published state');
  assert.ok(messageAt === -1 || resolveAt < messageAt,
    'the signed read is a fallback, never the first thing pvpMove does');
  assert.equal(body.split('api.battleInfo(').length - 1, messageAt === -1 ? 0 : 1,
    'exactly one fallback call site, so a second cannot creep back in unreviewed');
});

test('the browser client exports no signed read that published state answers', () => {
  // `stats()` -> `readMetrics()`, `listFactions()` -> `readFactions()`,
  // `listChallenges()` -> `readChallenges()`. All three were dead exports that
  // scheduled a message to fetch a key `/now/` already serves; an export that
  // costs a slot is an export somebody eventually calls in a poll.
  const client = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'game.ts'), 'utf8');
  for (const action of ['Stats', 'Faction.List', 'Battle.OpenChallenges', 'Leaderboard']) {
    assert.equal(client.includes(`Action: '${action}'`), false,
      `${action} is published state; scheduling it costs a full slot for a value already on the wire`);
  }
  for (const reader of ['readMetrics', 'readFactions', 'readChallenges', 'readLeaderboard']) {
    assert.ok(new RegExp(`export const ${reader}\\b`).test(client),
      `${reader} is the free replacement and must stay exported`);
  }
});
