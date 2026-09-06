import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

import {
  assertLiveGraph, resolveLiveGraph, verifyLiveGraph, viteEnvForGraph,
} from './live-config.mjs';

const id = (letter) => letter.repeat(43);
const fixtureRoots = [];
after(() => {
  for (const root of fixtureRoots) fs.rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runerealm-live-config-'));
  fixtureRoots.push(root);
  const native = path.join(root, 'backend', 'native');
  fs.mkdirSync(path.join(native, 'battle-fleet'), { recursive: true });
  const node = 'https://node.test';
  fs.writeFileSync(path.join(root, 'live-process.txt'), `${id('G')}\n${node}\n${id('O')}\n`);
  fs.writeFileSync(path.join(root, 'rune-process.txt'), `${id('R')}\n${node}\n${id('O')}\n`);
  fs.writeFileSync(path.join(root, 'hunt-process.txt'),
    `${id('H')}\n${id('I')}\n${node}\n${id('G')}\n`);
  fs.writeFileSync(path.join(root, 'marketplace-processes.txt'),
    `${id('R')}\n${id('Q')}\n${node}\n${id('O')}\n`);
  fs.writeFileSync(path.join(native, 'deployment-state.json'), JSON.stringify({
    version: 2, node, owner: id('O'),
    processes: { game: id('G'), rune: id('R'), quote: id('Q'),
      hunt: id('H'), huntWorkers: [id('H'), id('I')], battleWorkers: [id('B')] },
    nodes: { game: node, hunt: node, market: node, battle: node },
  }));
  fs.writeFileSync(path.join(native, 'marketplace-state.json'), JSON.stringify({
    game: id('G'), rune: id('R'), quote: id('Q'), node,
  }));
  fs.writeFileSync(path.join(native, 'battle-fleet', 'manifest.local.json'), JSON.stringify({
    gameProcess: id('G'), node, workers: [{ workerProcessId: id('B') }],
  }));
  return root;
}

test('matching receipts resolve into one complete graph', () => {
  const root = fixture();
  const graph = assertLiveGraph(resolveLiveGraph({ root, env: {} }), {
    requireHunt: true, requireExchange: true, requireBattleFleet: true,
  });
  assert.deepEqual({ game: graph.game, hunt: graph.hunt, rune: graph.rune,
    quote: graph.quote }, {
    game: id('G'), hunt: id('H'), rune: id('R'), quote: id('Q'),
  });
  assert.deepEqual(graph.huntWorkers, [id('H'), id('I')]);
  assert.deepEqual(graph.battleWorkers, [id('B')]);
  assert.deepEqual(viteEnvForGraph(graph), {
    VITE_GAME_PROCESS: id('G'), VITE_HB_NODE: 'https://node.test',
    VITE_GAME_OWNER: id('O'), VITE_HUNT_PROCESS: id('H'),
    VITE_HUNT_NODE: 'https://node.test', VITE_RUNE_PROCESS: id('R'),
    VITE_QUOTE_PROCESS: id('Q'),
    VITE_MARKET_NODE: 'https://node.test',
  });
});

test('overriding only the game cannot leak optional processes from another deployment', () => {
  const root = fixture();
  const graph = resolveLiveGraph({ root, env: {}, overrides: { game: id('X') } });
  assert.equal(graph.game, id('X'));
  assert.equal(graph.hunt, '');
  assert.equal(graph.rune, '');
  assert.equal(graph.quote, '');
  assert.deepEqual(graph.battleWorkers, []);
  assert.ok(graph.warnings.some((warning) => warning.includes('another game or node')));
  assert.throws(() => assertLiveGraph(graph, { requireExchange: true }),
    /exchange is required/);
});

test('explicit complete graph overrides stale receipts as one unit', () => {
  const root = fixture();
  const graph = assertLiveGraph(resolveLiveGraph({ root, env: {}, overrides: {
    game: id('X'), node: 'https://other.test/', owner: id('Z'), hunt: id('J'),
    huntNode: 'https://hunt.test/', rune: id('S'), quote: id('T'),
    marketNode: 'https://market.test/',
  } }), { requireHunt: true, requireExchange: true });
  assert.equal(graph.node, 'https://other.test');
  assert.equal(graph.huntNode, 'https://hunt.test');
  assert.equal(graph.marketNode, 'https://market.test');
  assert.equal(graph.rune, id('S'));
});

test('a transport-node override carries the matching graph through a browser relay', () => {
  const root = fixture();
  const graph = assertLiveGraph(resolveLiveGraph({ root, env: {
    GAME_PROCESS: id('G'), NODE_URL: 'http://127.0.0.1:43111/',
  } }), { requireHunt: true, requireExchange: true, requireBattleFleet: true });
  assert.equal(graph.node, 'http://127.0.0.1:43111');
  assert.equal(graph.huntNode, 'http://127.0.0.1:43111');
  assert.equal(graph.marketNode, 'http://127.0.0.1:43111');
  assert.equal(graph.hunt, id('H'));
  assert.deepEqual(graph.battleWorkers, [id('B')]);
});

test('conflicting environment aliases are an error, not silent precedence', () => {
  const root = fixture();
  const graph = resolveLiveGraph({ root, env: {
    GAME_PROCESS: id('G'), VITE_GAME_PROCESS: id('X'), NODE_URL: 'https://node.test',
  } });
  assert.match(graph.errors.join('\n'), /Conflicting game variables/);
  assert.throws(() => assertLiveGraph(graph), /Conflicting game variables/);
});

test('matching receipts may not silently disagree on a component id', () => {
  const root = fixture();
  const file = path.join(root, 'backend', 'native', 'marketplace-state.json');
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  state.rune = id('X');
  fs.writeFileSync(file, JSON.stringify(state));
  const graph = resolveLiveGraph({ root, env: {} });
  assert.match(graph.errors.join('\n'), /Matching receipts disagree on Rune process/);
  assert.throws(() => assertLiveGraph(graph), /disagree on Rune process/);
});

test('a malformed JSON receipt is a configuration error', () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, 'backend', 'native', 'deployment-state.json'), '{broken');
  const graph = resolveLiveGraph({ root, env: {} });
  assert.match(graph.errors.join('\n'), /deployment-state\.json is not valid JSON/);
  assert.throws(() => assertLiveGraph(graph), /not valid JSON/);
});

test('online verification checks both directions and every worker roster', async () => {
  const root = fixture();
  const graph = assertLiveGraph(resolveLiveGraph({ root, env: {} }), {
    requireHunt: true, requireExchange: true, requireBattleFleet: true,
  });
  const values = {
    runetoken: id('R'), minter: id('G'),
    huntconfig: { enabled: true, processId: id('H'), workers: [id('H'), id('I')] },
    battlefleet: { enabled: true, workers: [{ workerProcessId: id('B') }] },
  };
  const fetchImpl = async (url) => {
    const key = String(url).split('/').pop();
    return new Response(JSON.stringify(values[key]));
  };
  const audit = await verifyLiveGraph(graph, {
    fetchImpl, requireHunt: true, requireExchange: true, requireBattleFleet: true,
  });
  assert.equal(audit.ok, true);
  assert.equal(audit.checks.length, 5);

  // A game naming a Rune token that does not name it back is a half-wired
  // deployment, and it reads as working right up to the first withdrawal.
  values.minter = id('X');
  const broken = await verifyLiveGraph(graph, { fetchImpl, requireExchange: true });
  assert.equal(broken.ok, false);
  assert.match(broken.errors.join('\n'), /Rune -> game/);
});
