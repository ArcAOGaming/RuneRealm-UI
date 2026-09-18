/**
 * SwarmMonitor acceptance (REDESIGN.md §8 W9):
 *
 *   node --test src/screens/admin/swarm/monitor.test.mjs
 *
 * Bundles the real view with esbuild, renders the recorded fixture to static
 * markup and checks it: 100 account rows and 100 wallet tiles, processes grouped,
 * round trip first and largest on the fleet strip and every group card. The tick/acct/trade folds are checked against the real aggregator, so
 * a drift in W8's snapshot or tick shape fails here.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

// The aggregator lives in the super repo. A standalone RuneRealm-UI checkout
// (its own CI) still renders the fixture, but skips the drift checks against it.
const AGGREGATE = new URL('../../../../../../backend/native/swarm/aggregate.mjs', import.meta.url);
const { createAggregator } = fs.existsSync(AGGREGATE) ? await import(AGGREGATE.href) : {};
const withAggregator = createAggregator ? {} : { skip: 'backend/native/swarm/aggregate.mjs is only in the super repo' };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..', '..');
const fixture = JSON.parse(fs.readFileSync(path.join(HERE, 'fixture', 'snapshot.json'), 'utf8'));

const ENTRY = `
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StatusBar, SwarmMonitorView } from './View';
import SwarmMonitor from '../SwarmMonitor';
import { AccountDrawer } from './Accounts';
export * as model from './model';
export * as charts from './charts';
import { TradingPanel } from './Trading';
export const renderTrading = (data) => renderToStaticMarkup(createElement(TradingPanel, { data }));
export const render = (data) => renderToStaticMarkup(createElement(SwarmMonitorView, { data }));
export const renderStatus = (status, data = null, now = 0) => renderToStaticMarkup(createElement(StatusBar, { status, data, now }));
export const renderPage = () => renderToStaticMarkup(createElement(SwarmMonitor));
export const renderDrawer = (account) => renderToStaticMarkup(createElement(AccountDrawer, { account, onClose() {} }));
`;

async function loadView() {
  const result = await build({
    stdin: { contents: ENTRY, resolveDir: HERE, loader: 'tsx', sourcefile: 'entry.tsx' },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    absWorkingDir: ROOT,
    logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}' },
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-monitor-'));
  const file = path.join(dir, 'view.cjs');
  fs.writeFileSync(file, result.outputFiles[0].text);
  return createRequire(import.meta.url)(file);
}

const view = await loadView();

const SIZE_PX = {
  'text-xs': 12, 'text-sm': 14, 'text-base': 16, 'text-lg': 18, 'text-xl': 20,
  'text-2xl': 24, 'text-3xl': 30, 'text-4xl': 36, 'text-5xl': 48,
};
function fontPx(className) {
  let size = null;
  for (const token of className.split(/\s+/)) {
    const arbitrary = /^text-\[(\d+(?:\.\d+)?)px\]$/.exec(token);
    const px = arbitrary ? Number(arbitrary[1]) : SIZE_PX[token];
    if (px !== undefined) size = Math.max(size ?? 0, px);
  }
  return size;
}

/** Every opening tag in `html` with its attributes. */
function tags(html) {
  return [...html.matchAll(/<([a-z0-9]+)((?:\s+[a-zA-Z-]+="[^"]*")*)\s*\/?>/g)].map(([, name, attrs]) => ({
    name,
    attrs: Object.fromEntries([...attrs.matchAll(/([a-zA-Z-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value])),
  }));
}

/** Splits markup into card chunks, each running to the next `data-card`. */
function cards(html, kind) {
  const marker = `data-card="${kind}"`;
  const parts = html.split(/(?=<div[^>]*data-card=")/);
  return parts.filter((part) => part.slice(0, part.indexOf('>')).includes(marker));
}

function assertRoundTripLeads(chunk, label) {
  const figures = tags(chunk).filter((tag) => tag.attrs['data-figure']);
  assert.ok(figures.length > 0, `${label}: has figures`);
  assert.equal(figures[0].attrs['data-figure'], 'round-trip', `${label}: round trip is the first figure`);
  // Tagged or not, no number may come before it; only the card's own name and pid may carry digits.
  const before = chunk.slice(0, chunk.indexOf('data-figure="round-trip"'))
    .replace(/<([a-z0-9]+)[^>]*data-identity[^>]*>[^<]*<\/\1>/g, '')
    .replace(/<[^>]*>/g, ' ');
  assert.doesNotMatch(before, /\d/, `${label}: a number comes before round trip: ${before.replace(/\s+/g, ' ').trim()}`);
  const rtPx = fontPx(figures[0].attrs.class ?? '');
  assert.ok(rtPx, `${label}: round trip has a font size`);
  for (const tag of tags(chunk).slice(1)) {
    if (tag === figures[0]) continue;
    const px = fontPx(tag.attrs.class ?? '');
    if (px === null) continue;
    assert.ok(px < rtPx || tag.attrs['data-figure'] === 'round-trip',
      `${label}: <${tag.name} class="${tag.attrs.class}"> (${px}px) is not smaller than round trip (${rtPx}px)`);
  }
}

test('the fixture is a real aggregator snapshot with 100 wallets', withAggregator, () => {
  const aggregator = createAggregator();
  aggregator.ingest({ v: 1, k: 'msg', t0: 1_000, t1: 2_000, wallet: 'w', pid: 'p', pidRole: 'game', outcome: 'ok' });
  const shape = aggregator.snapshot(10_000);
  assert.deepEqual(Object.keys(fixture).filter((key) => key !== 'live').sort(), Object.keys(shape).sort());
  assert.deepEqual(Object.keys(fixture.processes[0]).sort(), Object.keys(shape.processes[0]).sort());
  assert.deepEqual(Object.keys(fixture.accounts[0]).sort(), Object.keys(shape.accounts[0]).sort());
  assert.equal(fixture.accounts.length, 100);
  assert.equal(fixture.processes.length, 11);
});

test('renders the recorded fixture with 100 account rows', () => {
  const html = view.render(fixture);
  const rows = html.match(/<tr[^>]*data-account="/g) ?? [];
  assert.equal(rows.length, 100);
  const wallets = [...html.matchAll(/<tr[^>]*data-account="([^"]+)"/g)].map(([, wallet]) => wallet);
  assert.equal(wallets[0], 'burner-01');
  assert.equal(wallets[99], 'burner-100');
  assert.doesNotMatch(html, /DUEL|duelist|pvpPair/i);
});

const LIVE_ROLES = ['game', 'rune', 'quote', 'venue.internal', 'venue.external', 'battle.worker', 'hunt.worker', 'admin'];
const groupCard = (html, id) => cards(html, 'group').find((chunk) => chunk.includes(`data-group="${id}"`));

test('round trip is the first and largest figure on the fleet strip and every group card', () => {
  const html = view.render(fixture);
  const fleet = cards(html, 'fleet');
  assert.equal(fleet.length, 1);
  assertRoundTripLeads(fleet[0], 'fleet strip');
  const groups = cards(html, 'group');
  assert.deepEqual(groups.map((chunk) => /data-group="([^"]+)"/.exec(chunk)[1]), ['game', 'battle', 'hunt', 'venues', 'tokens']);
  for (const chunk of groups) assertRoundTripLeads(chunk, /data-group="([^"]+)"/.exec(chunk)[1]);
  assert.equal(cards(html, 'process').length, 0, 'no per-process cards any more');
  // Every process is listed once, inside its group.
  const members = [...html.matchAll(/data-member="([^"]+)"/g)].map(([, pid]) => pid).sort();
  assert.deepEqual(members, fixture.processes.map((process) => process.pid).sort());
  assert.match(groups[1], /Battle workers \(3\)/);
  assert.match(groups[2], /Hunt workers \(3\)/);
});

test('every pidRole lands in exactly one group, and an unknown role in Other', () => {
  const { GROUPS, OTHER_GROUP, groupOf, buildGroups } = view.model;
  for (const role of LIVE_ROLES) {
    const owners = GROUPS.filter((group) => group.roles.includes(role));
    assert.equal(owners.length, 1, `${role} has one group`);
    assert.equal(groupOf(role).id, owners[0].id);
  }
  assert.equal(groupOf('unknown').id, OTHER_GROUP.id);
  assert.equal(groupOf('lottery.worker').id, 'other');

  const data = structuredClone(fixture);
  const stray = { ...structuredClone(fixture.processes[0]), pid: 'TEST-fixture-stray', pidRole: 'lottery.worker' };
  data.processes.push(stray);
  const groups = buildGroups(data);
  const placed = groups.flatMap((group) => group.members.map((member) => member.pid));
  assert.equal(placed.length, data.processes.length, 'no process vanishes');
  assert.equal(new Set(placed).size, placed.length, 'no process is listed twice');
  assert.equal(groups.at(-1).def.id, 'other');
  assert.deepEqual(groups.at(-1).members.map((member) => member.pid), [stray.pid]);
  const html = view.render(data);
  assert.equal(cards(html, 'group').length, 6);
  assertRoundTripLeads(groupCard(html, 'other'), 'other');
});

/** The fixture with the last hunt worker made slow and nearly idle. */
function withUnevenWorker(source) {
  const data = structuredClone(source);
  const odd = data.processes.filter((process) => process.pidRole === 'hunt.worker').sort((a, b) => a.pid.localeCompare(b.pid))[2];
  odd.current.rt = { ...odd.current.rt, p50: 9_000 };
  odd.current.sentPerS = 0.01;
  return { data, pid: odd.pid };
}

test('group totals are the sum and merge of their members', () => {
  const { buildGroups } = view.model;
  const close = (a, b, label) => assert.ok(Math.abs(a - b) < 1e-9, `${label}: ${a} != ${b}`);
  for (const data of [fixture, withUnevenWorker(fixture).data]) {
    for (const group of buildGroups(data)) {
      const { members } = group;
      const label = group.def.id;
      close(group.sentPerS, members.reduce((sum, m) => sum + m.current.sentPerS, 0), `${label} sent`);
      close(group.resolvedPerS, members.reduce((sum, m) => sum + m.current.resolvedPerS, 0), `${label} resolved`);
      assert.equal(group.inFlight, members.reduce((sum, m) => sum + m.current.inFlight, 0), `${label} in flight`);
      const outcomes = {};
      for (const m of members) for (const [k, n] of Object.entries(m.current.outcomes)) outcomes[k] = (outcomes[k] ?? 0) + n;
      assert.deepEqual(group.outcomes, outcomes, `${label} outcomes`);
      const resolved = Object.values(outcomes).reduce((a, b) => a + b, 0);
      assert.equal(group.errorRate, resolved ? (resolved - (outcomes.ok ?? 0) - (outcomes.rejected ?? 0)) / resolved : null);
      assert.equal(group.rejectedRate, resolved ? (outcomes.rejected ?? 0) / resolved : null);
      for (const point of group.series) {
        const sum = members.reduce((total, m) => total + (m.series.find((row) => row.t === point.t)?.sentPerS ?? 0), 0);
        close(point.sentPerS, sum, `${label} series at ${point.t}`);
      }
      // Percentiles do not add: one role is the aggregator's pooled figure, several are the slowest role's.
      const roles = [...new Set(members.map((m) => m.pidRole))].map((role) => data.roles.find((r) => r.pidRole === role));
      if (roles.length === 1) {
        assert.equal(group.rtBasis, 'pooled');
        assert.deepEqual(group.rt, roles[0].current.rt);
      } else {
        assert.equal(group.rtBasis, 'slowest');
        assert.equal(group.rt.p50, Math.max(...roles.map((r) => r.current.rt.p50 ?? -Infinity)));
        assert.equal(group.rt.p95, Math.max(...roles.map((r) => r.current.rt.p95 ?? -Infinity)));
        assert.equal(group.rt.n, roles.reduce((sum, r) => sum + r.current.rt.n, 0));
      }
    }
  }
});

test('an uneven worker is flagged on its row', () => {
  const { data, pid } = withUnevenWorker(fixture);
  const hunt = groupCard(view.render(data), 'hunt');
  const flags = [...hunt.matchAll(/data-member="([^"]+)" data-flag="([^"]+)"/g)].map(([, member, flag]) => [member, flag]);
  assert.deepEqual(flags, [[pid, 'slow']]);
  assert.doesNotMatch(cards(view.render(fixture), 'group').join(''), /data-flag=/);
});

test('what wallets are doing: every wallet counted once, by activity', () => {
  const { activityCounts, activityOf } = view.model;
  const counts = activityCounts(fixture.accounts);
  assert.equal(counts.reduce((sum, entry) => sum + entry.count, 0), fixture.accounts.length);
  const byId = Object.fromEntries(counts.map((entry) => [entry.activity.id, entry.count]));
  const states = fixture.fleet.states;
  assert.equal(byId.battling, ['ARENA_SESSION', 'P2E_BATTLE', 'RATED_QUEUE', 'RATED_BATTLE'].reduce((sum, s) => sum + (states[s] ?? 0), 0));
  assert.equal(byId.hunting, (states.HUNT ?? 0) + (states.HUNT_SETTLING ?? 0));
  assert.equal(byId.trading, states.TRADE ?? 0);
  assert.equal(activityOf('SOMETHING_NEW').id, 'unreported');
  const strip = cards(view.render(fixture), 'activity')[0];
  const segments = tags(strip).filter((tag) => tag.attrs['data-activity-segment']);
  assert.deepEqual(segments.map((tag) => tag.attrs['data-activity-segment']), counts.filter((e) => e.count).map((e) => e.activity.id));
  const widths = segments.map((tag) => Number(/width:([\d.]+)%/.exec(tag.attrs.style)[1]));
  assert.ok(Math.abs(widths.reduce((a, b) => a + b, 0) - 100) < 1e-6, 'the bar splits the whole fleet');
  assert.match(strip, new RegExp(`data-activity-count="hunting".*?>${byId.hunting}</span>Hunting<`));
});

/** The markup of one wallet's tile. */
function tile(html, wallet) {
  const at = html.indexOf(`data-tile="${wallet}"`);
  assert.ok(at > 0, `${wallet} has a tile`);
  const start = html.lastIndexOf('<button', at);
  return html.slice(start, html.indexOf('</button>', at) + '</button>'.length);
}

const COMPANION_KEYS = ['activity', 'activityUntil', 'monsterName', 'element'];

test('the wallet grid renders one square tile per wallet, 100 in 10 columns, in wallet order', () => {
  const { activityOf } = view.model;
  const html = view.render(fixture);
  const grid = cards(html, 'wallet-grid');
  assert.equal(grid.length, 1);
  const container = tags(grid[0]).find((tag) => tag.attrs['data-grid'] === 'wallets');
  const classes = container.attrs.class.split(/\s+/);
  assert.ok(classes.includes('grid') && classes.includes('grid-cols-10'), 'ten columns at every width');
  assert.ok(classes.includes('lg:w-4/5') && classes.includes('w-full'), 'four fifths of the width on desktop, all of it on a phone');
  const tiles = tags(grid[0]).filter((tag) => tag.attrs['data-tile']);
  assert.equal(tiles.length, 100);
  for (const entry of tiles) assert.ok(entry.attrs.class.split(/\s+/).includes('aspect-square'), `${entry.attrs['data-tile']} is square`);
  assert.equal(tiles[0].attrs['data-tile'], 'burner-01');
  assert.equal(tiles[9].attrs['data-tile'], 'burner-10');
  assert.equal(tiles[99].attrs['data-tile'], 'burner-100');
  for (const account of fixture.accounts) {
    const entry = tiles.find((candidate) => candidate.attrs['data-tile'] === account.wallet);
    assert.equal(entry.attrs['data-activity'], activityOf(account.state).id, `${account.wallet} wears its activity`);
  }
  assert.ok(grid[0].indexOf('data-legend="battling"') < grid[0].indexOf('data-grid="wallets"'), 'the legend is above the grid');
});

test('pending lanes come from open sends: verb, wait, amber when long, several stacked', () => {
  const { pendingLanes, LONG_WAIT_MS } = view.model;
  const waiting = fixture.accounts.filter((account) => account.pending.length);
  assert.ok(waiting.length > 0, 'the fixture records writes still in flight');
  const html = view.render(fixture);
  for (const account of fixture.accounts) {
    const chunk = tile(html, account.wallet);
    assert.match(chunk, new RegExp(`data-pending="${pendingLanes(account, fixture.at).length}"`));
    const chips = tags(chunk).filter((tag) => tag.attrs['data-lane']).map((tag) => tag.attrs['data-lane']);
    assert.deepEqual(chips, account.pending.map((open) => open.pidRole), account.wallet);
    for (const open of account.pending) assert.ok(chunk.includes(`>${open.verb}<`), `${account.wallet} names ${open.verb}`);
  }
  assert.equal(fixture.fleet.current.inFlight, waiting.reduce((sum, account) => sum + account.pending.length, 0),
    'every write the fleet counts in flight is on some tile');

  const data = structuredClone(fixture);
  const account = data.accounts.find((entry) => entry.wallet === 'burner-07');
  account.pending = [
    { id: 'g', t0: data.at - 72_000, pid: 'TEST-g', pidRole: 'game', verb: 'battle.start' },
    { id: 'v', t0: data.at - 8_000, pid: 'TEST-v', pidRole: 'venue.internal', verb: 'order.place' },
    { id: 'old', t0: data.at - 11 * 60_000, pid: 'TEST-g', pidRole: 'game', verb: 'expired.write' },
  ];
  const chunk = tile(view.render(data), 'burner-07');
  const chips = tags(chunk).filter((tag) => tag.attrs['data-lane']);
  assert.deepEqual(chips.map((tag) => tag.attrs['data-lane']), ['game', 'venue.internal'], 'two lanes stacked; an expired send is gone');
  assert.equal(chips[0].attrs['data-long'], 'true');
  assert.match(chips[0].attrs.class, /text-warn/);
  assert.equal(chips[1].attrs['data-long'], undefined);
  // The whole verb on a large tile, its last word on a smaller one, then the wait.
  assert.match(chunk, />battle\.start<\/span><span[^>]*>start<\/span><span[^>]*>72s</);
  assert.match(chunk, />order\.place<\/span><span[^>]*>place<\/span><span[^>]*>8s</);
  assert.ok(72_000 >= LONG_WAIT_MS && 8_000 < LONG_WAIT_MS);

  // A stream started before the aggregator listed open sends: no chips, and the grid says so.
  const old = structuredClone(fixture);
  for (const entry of old.accounts) delete entry.pending;
  const grid = cards(view.render(old), 'wallet-grid')[0];
  assert.doesNotMatch(grid, /data-lane=/);
  assert.match(grid, /does not list waiting writes/);
});

test('open sends fold into pending lanes the way the aggregator lists them', withAggregator, () => {
  const { applyAcct, applySend, applyMsg } = view.model;
  const aggregator = createAggregator({ run: 'r' });
  const records = [
    { v: 1, k: 'acct', at: 1_000, wallet: 'burner-1', state: 'HOME' },
    { v: 1, k: 'acct', at: 1_000, wallet: 'burner-2', state: 'HUNT' },
    { v: 1, k: 'send', at: 2_000, id: 'a', acct: 'burner-1', pid: 'g', pidRole: 'game', verb: 'battle.start' },
    { v: 1, k: 'send', at: 2_500, id: 'b', acct: 'burner-2', pid: 'h', pidRole: 'hunt.worker', verb: 'hunt.search' },
    { v: 1, k: 'msg', id: 'a', t0: 2_000, t1: 9_000, wallet: 'burner-1', pid: 'g', pidRole: 'game', action: 'battle.start', rtMs: 7_000, outcome: 'ok' },
    { v: 1, k: 'send', at: 9_500, id: 'c', acct: 'burner-1', pid: 'v', pidRole: 'venue.internal', verb: 'order.place' },
    { v: 1, k: 'send', at: 9_600, id: 'x', acct: 'burner-9', pid: 'g', pidRole: 'game', verb: 'daily.claim' },
    // A game write and a venue write wait at once; the next game send replaces only the game one.
    { v: 1, k: 'send', at: 9_700, id: 'd', acct: 'burner-1', pid: 'g', pidRole: 'game', verb: 'hunt.begin' },
    { v: 1, k: 'send', at: 9_800, id: 'e', acct: 'burner-1', pid: 'g', pidRole: 'game', verb: 'monster.feed' },
  ];
  let snapshot = aggregator.snapshot(0);
  for (const rec of records) {
    aggregator.ingest(rec);
    snapshot = rec.k === 'acct' ? applyAcct(snapshot, rec) : rec.k === 'send' ? applySend(snapshot, rec) : applyMsg(snapshot, rec);
  }
  const pick = (list) => Object.fromEntries(list.map(({ wallet, pending }) => [wallet, pending]));
  assert.deepEqual(pick(snapshot.accounts), pick(aggregator.snapshot(10_000).accounts));
  assert.deepEqual(pick(snapshot.accounts)['burner-1'].map((open) => open.verb), ['order.place', 'monster.feed']);
});

test('a tile shows PnL with its sign, in green or red', () => {
  const { fmtPnl } = view.model;
  assert.equal(fmtPnl(42), '+42');
  assert.equal(fmtPnl(-13), '−13');
  assert.equal(fmtPnl(0.4), '0');
  assert.equal(fmtPnl(1_234), '+1.2k');
  assert.equal(fmtPnl(-25_600), '−26k');
  assert.equal(fmtPnl(null), '—');
  const data = structuredClone(fixture);
  const set = (wallet, pnlGold) => { data.accounts.find((entry) => entry.wallet === wallet).acct.pnlGold = pnlGold; };
  set('burner-01', 42);
  set('burner-02', -13);
  set('burner-03', 0);
  set('burner-04', null);
  const html = view.render(data);
  const pnl = (wallet) => tags(tile(html, wallet)).find((tag) => tag.attrs['data-pnl']);
  assert.equal(pnl('burner-01').attrs['data-pnl'], 'up');
  assert.match(pnl('burner-01').attrs.class, /text-good/);
  assert.match(tile(html, 'burner-01'), /data-pnl="up"[^>]*>\+42</);
  assert.equal(pnl('burner-02').attrs['data-pnl'], 'down');
  assert.match(pnl('burner-02').attrs.class, /text-bad/);
  assert.match(tile(html, 'burner-02'), /data-pnl="down"[^>]*>−13</);
  assert.equal(pnl('burner-03').attrs['data-pnl'], 'flat');
  assert.equal(pnl('burner-04').attrs['data-pnl'], 'none');
});

test("a tile shows the companion's activity, and the brain state when the acct row lacks it", () => {
  const { stateLabel } = view.model;
  const data = structuredClone(fixture);
  const questing = data.accounts.find((entry) => entry.wallet === 'burner-05');
  Object.assign(questing.acct, { activity: 'Quest', activityUntil: data.at + 3 * 60_000, level: 7, energy: 20, happiness: 80 });
  questing.state = 'QUEST_WAIT';
  const bare = data.accounts.find((entry) => entry.wallet === 'burner-06');
  for (const key of COMPANION_KEYS) delete bare.acct[key];
  bare.state = 'TRADE';
  const html = view.render(data);

  const withActivity = tile(html, 'burner-05');
  assert.match(withActivity, /data-monster="monster"[^>]*><span[^>]*>Quest<\/span><span[^>]*>3m<\/span><span[^>]*>L7</);
  assert.match(withActivity, /data-doing[^>]*><span[^>]*>Questing</, 'the brain state still shows beside it');
  assert.match(withActivity, /title="energy 20"><span class="[^"]*bg-bad/, 'energy under 25 is red');

  const fallback = tile(html, 'burner-06');
  assert.match(fallback, new RegExp(`data-monster="state"[^>]*><span[^>]*>${stateLabel('TRADE')}<`));
  assert.doesNotMatch(fallback, /data-doing[^>]*><span[^>]*>Trading</, 'the state is not shown twice');

  // The live run today: no acct row carries a companion status, and the grid says why.
  const old = structuredClone(fixture);
  for (const entry of old.accounts) for (const key of COMPANION_KEYS) delete entry.acct[key];
  const grid = cards(view.render(old), 'wallet-grid')[0];
  assert.equal((grid.match(/data-monster="state"/g) ?? []).length, 100);
  assert.match(grid, /until the swarm is restarted with companion status/);
});

test('headline, groups, wallet grid and money flow come first; everything else is behind one closed More detail', () => {
  const html = view.render(fixture);
  assert.match(tile(html, 'burner-01'), /aria-pressed="false"/);
  const order = ['data-card="fleet"', 'data-card="activity"', 'data-card="group"', 'data-card="wallet-grid"', 'data-card="money-flow"', 'data-more-detail']
    .map((marker) => html.indexOf(marker));
  assert.ok(order.every((at) => at >= 0), `every section renders: ${order}`);
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'in this order');
  const details = [...html.matchAll(/<details([^>]*)>/g)].filter(([, attrs]) => attrs.includes('data-more-detail'));
  assert.equal(details.length, 1, 'one disclosure');
  assert.doesNotMatch(details[0][1], /\bopen\b/, 'closed by default');
  const more = html.indexOf('data-more-detail');
  for (const card of ['charts', 'trading-now', 'money-flow-detail', 'buy-sell', 'trading', 'accounts']) {
    assert.ok(html.indexOf(`data-card="${card}"`) > more, `${card} is under More detail`);
  }
  assert.doesNotMatch(cards(html, 'fleet')[0], /data-figure="(in-flight|errors)"/, 'the headline is only what it needs');
});

test('trading headline counts the last 15 minutes of held writes and trades', () => {
  const { tradingNow } = view.model;
  const now = 20 * 60_000;
  const write = (t0, action) => ({ t0, t1: t0 + 1_000, action, pid: 'p', pidRole: 'game', rtMs: 1_000, outcome: 'ok', late: false, err: null });
  const accounts = [{
    timeline: [write(1_000, 'order.place'), write(6 * 60_000, 'order.place'), write(7 * 60_000, 'hunt.search'),
      write(8 * 60_000, 'economy.shop.trade'), write(9 * 60_000, 'venue.send')],
    trades: [{ at: 1_000, filled: 1 }, { at: 8 * 60_000, filled: 2 }, { at: 9 * 60_000, filled: 0 }],
  }, {
    timeline: [write(10 * 60_000, 'monster.feed'), write(11 * 60_000, 'order.amend')],
    trades: [{ at: 11 * 60_000, filled: 1 }],
  }];
  assert.deepEqual(tradingNow(accounts, now), {
    windowMs: 15 * 60_000, writes: 6, tradingWrites: 4, share: 4 / 6, ordersPlaced: 1, fills: 2,
  });
  assert.equal(tradingNow([], now).share, null);
  assert.match(cards(view.render(fixture), 'trading-now')[0], /Trading, last 15 min/);
});

/** The live fixture's status bar, `agoMs` after its last event. */
const liveBar = (data, agoMs = 2_000) => {
  const now = data.lastEventAt + agoMs;
  return cards(view.renderStatus(view.model.monitorStatus('open', data, now), data, now), 'status')[0];
};
const live = { ...fixture, active: true };
/** The status bar's one sentence, as a person reads it. */
const statusText = (bar) => {
  const chunk = bar.slice(bar.indexOf('data-figure="status"'));
  return chunk.slice(chunk.indexOf('>') + 1, chunk.indexOf('</span></span>')).replace(/<[^>]*>/g, '');
};
const statusClass = (bar) => tags(bar).find((tag) => tag.attrs['data-figure'] === 'status').attrs.class;

test('the status bar says exactly one of five things', () => {
  const { monitorStatus } = view.model;
  const now = fixture.lastEventAt + 5_000;
  const say = (connection, data) => {
    const status = monitorStatus(connection, data, now);
    const bar = cards(view.renderStatus(status, data, now), 'status')[0];
    assert.equal((bar.match(/data-figure="status"/g) ?? []).length, 1);
    return { kind: status.kind, text: statusText(bar) };
  };
  assert.deepEqual(say('connecting', null), { kind: 'connecting', text: 'Connecting…' });
  assert.deepEqual(say('unreachable', live), { kind: 'unreachable', text: 'Stream not reachable — retrying' },
    'a vanished stream is not shown as the run it last served');
  assert.deepEqual(say('open', null), { kind: 'idle', text: 'No swarm running — start it with npm run swarm:keep -- --for 12h' });
  assert.deepEqual(say('open', { ...fixture, active: false }), say('open', null), 'an inactive run is no swarm');
  assert.deepEqual(say('open', fixture), say('open', null), 'a snapshot the stream did not call active is no swarm');
  const launching = { ...live, launch: { step: 'fund', note: 'funding 100 wallet(s)', at: now - 1_000, done: false } };
  assert.deepEqual(say('open', launching), { kind: 'launching', text: 'Launching: fund — funding 100 wallet(s)' });
  assert.deepEqual(say('open', { ...launching, launch: { ...launching.launch, done: true } }), { kind: 'live', text: 'Live · last event 5s ago' });
  // A stream from before launch records: active, but nothing written yet.
  assert.equal(say('open', { ...live, lastEventAt: null }).kind, 'launching');
  assert.deepEqual(say('open', live), { kind: 'live', text: 'Live · last event 5s ago' });

  const page = view.renderPage();
  assert.doesNotMatch(page, /npm run dev/);
});

test('live turns amber after a minute without an event, and carries the run clock, outage and halt', () => {
  const fresh = liveBar(live, 59_000);
  assert.match(fresh, /data-status="live"/);
  assert.equal(statusText(fresh), 'Live · last event 59s ago');
  assert.match(statusClass(fresh), /text-good/);
  assert.match(fresh, /animate-pulse/);
  const quiet = liveBar(live, 61_000);
  assert.match(quiet, /data-quiet="true"/);
  assert.equal(statusText(quiet), 'Live · last event 61s ago');
  assert.match(statusClass(quiet), /text-warn/);
  assert.doesNotMatch(quiet, /animate-pulse/);

  const { runStartedAt, fmtDuration } = view.model;
  assert.equal(runStartedAt('2026-09-16T19-07-52-033Z'), Date.UTC(2026, 8, 16, 19, 7, 52, 33));
  assert.equal(runStartedAt('dry-2026-09-16T19-07-52-033Z'), Date.UTC(2026, 8, 16, 19, 7, 52, 33));
  assert.equal(runStartedAt('not-a-run'), null);
  assert.equal(fmtDuration(95_000), '1 min');
  assert.equal(fmtDuration(3 * 3_600_000 + 5 * 60_000), '3 h 05 min');
  const bar = liveBar(live);
  assert.match(bar, />\d+ min<\/span> elapsed/);
  assert.match(bar, /data-figure="remaining"[^>]*>, <span[^>]*>11 h 52 min<\/span> remaining/, 'the fixture\'s run.start plans twelve hours');
  assert.doesNotMatch(liveBar({ ...live, endsAt: null }), /remaining/);
  const planned = liveBar({ ...live, endsAt: fixture.at + 2 * 3_600_000 + 7 * 60_000 });
  assert.match(planned, /data-figure="remaining"[^>]*>, <span[^>]*>2 h 07 min<\/span> remaining/);
  const tick = { ...fixture, fleet: { ...fixture.fleet, buckets: [] }, processes: [], roles: [], at: fixture.at + 5_000, endsAt: 42 };
  assert.equal(view.model.applyTick(fixture, tick).endsAt, 42, 'a tick carries the planned end');
  // Only live shows the run's facts.
  assert.doesNotMatch(cards(view.renderStatus({ kind: 'idle' }, live, fixture.at), 'status')[0], /elapsed/);
});

test('the page is live only: no run picker, no replay, and nothing but the status bar until a run is live', () => {
  const page = view.renderPage();
  assert.match(page, /data-status="connecting"/);
  assert.match(page, /Connecting…/);
  assert.doesNotMatch(page, /<select/);
  assert.doesNotMatch(page, /Recorded|replay|Reload|Check stream/i);
  assert.doesNotMatch(page, /data-card="fleet"/, 'no view before the stream answers');
});

test('launch records fold the way the aggregator ingests them, and a tick carries the launch', withAggregator, () => {
  const { applyFrame, applyTick } = view.model;
  const aggregator = createAggregator({ run: 'r' });
  let snapshot = { ...aggregator.snapshot(0), active: false };
  const records = [
    { v: 1, k: 'launch', at: 1_000, run: 'r', step: 'begin', note: 'resuming 100 wallet(s)' },
    { v: 1, k: 'launch', at: 2_000, run: 'r', step: 'node', note: 'not answering; retrying in 30s' },
  ];
  for (const rec of records) {
    aggregator.ingest(rec);
    snapshot = applyFrame(snapshot, { kind: 'launch', rec });
  }
  assert.deepEqual(snapshot.launch, aggregator.snapshot(3_000).launch);
  assert.equal(snapshot.active, true, 'a launching run is active, as the stream counts it');
  assert.equal(applyFrame(snapshot, { kind: 'launch', rec: { ...records[1], run: 'other', step: 'x' } }).launch.step, 'node',
    'another run\'s launch is not folded in');
  aggregator.ingest({ v: 1, k: 'run.start', at: 4_000, run: 'r', until: 60_000 });
  const tick = JSON.parse(JSON.stringify(aggregator.takeTick(5_000)));
  assert.deepEqual(applyTick(snapshot, tick).launch, { ...snapshot.launch, done: true });
});

test('a censored percentile renders as a lower bound', () => {
  const data = structuredClone(fixture);
  data.fleet.current.rt = { ...data.fleet.current.rt, p50: 12_345, p50Censored: true };
  const html = view.render(data);
  assert.match(cards(html, 'fleet')[0], /≥12\.3 s/);
  const game = structuredClone(fixture);
  game.roles.find((role) => role.pidRole === 'game').current.rt.p50Censored = true;
  const card = groupCard(view.render(game), 'game');
  assert.match(card.slice(card.indexOf('data-figure="round-trip"')), /^[^<]*>≥/);
});

test('charts are SVG, one colour per group, and every account drawer section renders', () => {
  const html = view.render(fixture);
  const charts = cards(html, 'charts')[0];
  assert.equal((charts.match(/<svg/g) ?? []).length, 4);
  // Stacked writes and round-trip lines both draw each group in the colour its card wears.
  for (const [id, slot] of [['game', 1], ['battle', 2], ['hunt', 3], ['venues', 4], ['tokens', 5]]) {
    const colour = `rgb(var(--sw-${slot}))`;
    assert.ok(charts.includes(`fill="${colour}"`), `${id} bars`);
    assert.ok(charts.includes(`stroke="${colour}"`), `${id} line`);
    assert.ok(groupCard(html, id).includes(`background:${colour}`), `${id} card`);
  }
  const account = fixture.accounts.find((entry) => entry.trades.length && entry.timeline.length);
  const drawer = view.renderDrawer(account);
  assert.match(drawer, /Messages/);
  assert.match(drawer, /States/);
  assert.match(drawer, /Trades/);
  assert.equal((drawer.match(/<svg/g) ?? []).length, 2);
});

test('a tick folded into a snapshot equals a fresh snapshot', withAggregator, () => {
  const { applyTick } = view.model;
  const aggregator = createAggregator({ run: 'r' });
  const msg = (t0, rt, pid, pidRole, outcome = 'ok') => ({
    v: 1, k: 'msg', run: 'r', t0, t1: t0 + rt, wallet: `burner-${t0 % 7}`, pid, pidRole, rtMs: rt, outcome, postMs: 150,
  });
  for (let t = 10_000; t < 60_000; t += 700) aggregator.ingest(msg(t, 3_000, 'game-pid', 'game'));
  const before = aggregator.snapshot(62_000);
  aggregator.takeTick(62_000);
  // A late reply revises old buckets, and a new process appears.
  aggregator.ingest(msg(20_000, 45_000, 'game-pid', 'game', 'timeout'));
  for (let t = 60_000; t < 90_000; t += 900) aggregator.ingest(msg(t, 1_200, 'hunt-pid', 'hunt.worker'));
  aggregator.ingest({ v: 1, k: 'slot', at: 80_000, pid: 'game-pid', pidRole: 'game', atSlot: 9, dSlots: 20, dtMs: 10_000 });
  const tick = JSON.parse(JSON.stringify(aggregator.takeTick(93_000)));
  const after = aggregator.snapshot(93_000);
  const folded = applyTick(before, tick);
  assert.deepEqual(folded.fleet.series, after.fleet.series);
  assert.deepEqual(folded.fleet.current, after.fleet.current);
  const byPid = (list) => Object.fromEntries(list.map(({ pid, series, current, saturation }) => [pid, { series, current, saturation }]));
  assert.deepEqual(byPid(folded.processes), byPid(after.processes));
  const byRole = (list) => Object.fromEntries(list.map(({ pidRole, series, current }) => [pidRole, { series, current }]));
  assert.deepEqual(byRole(folded.roles), byRole(after.roles));
});

test('acct and trade events fold the way the aggregator ingests them', withAggregator, () => {
  const { applyAcct, applyTrade } = view.model;
  const aggregator = createAggregator({ run: 'r' });
  const records = [
    { v: 1, k: 'acct', at: 1_000, wallet: 'burner-1', state: 'HUNT', level: 2, gold: 500, runes: 50 },
    { v: 1, k: 'acct', at: 5_000, wallet: 'burner-1', state: 'HUNT', level: 2, gold: 480, runes: 50 },
    { v: 1, k: 'acct', at: 30_000, wallet: 'burner-1', state: 'HOME', level: 3, gold: 470, runes: 48 },
    { v: 1, k: 'trade', at: 31_000, wallet: 'burner-2', venue: 'internal', market: 'scroll/gold', side: 'buy', liq: 'taker', px: 90, qty: 1, filled: 1, fillPx: [90] },
    { v: 1, k: 'trade', at: 32_000, wallet: 'burner-2', venue: 'internal', market: 'scroll/gold', side: 'sell', liq: 'maker', px: 95, qty: 1, filled: 0, fillPx: [] },
  ];
  let snapshot = aggregator.snapshot(0);
  for (const rec of records) {
    aggregator.ingest(rec);
    snapshot = rec.k === 'acct' ? applyAcct(snapshot, rec) : applyTrade(snapshot, rec);
  }
  const fresh = aggregator.snapshot(40_000);
  const pick = (list) => Object.fromEntries(list.map(({ wallet, state, acct, series, trades, fills }) => [wallet, { state, acct, series, trades, fills }]));
  assert.deepEqual(pick(snapshot.accounts), pick(fresh.accounts));
});

test('msg events fold the way the aggregator ingests them, admin writes excluded', withAggregator, () => {
  const { applyMsg } = view.model;
  const aggregator = createAggregator({ run: 'r' });
  const records = [
    { v: 1, k: 'msg', t0: 1_000, t1: 4_000, wallet: 'burner-1', profile: 'hunter', pid: 'g', pidRole: 'game', action: 'hunt.begin', rtMs: 3_000, outcome: 'ok' },
    { v: 1, k: 'msg', t0: 5_000, t1: 5_300, wallet: 'burner-1', pid: 'h', pidRole: 'hunt.worker', action: 'hunt.search', outcome: 'rejected', err: 'no energy' },
    { v: 1, k: 'msg', t0: 6_000, t1: 66_000, wallet: 'burner-2', pid: 'g', pidRole: 'game', action: 'monster.feed', outcome: 'timeout', late: true },
    { v: 1, k: 'msg', t0: 7_000, t1: 8_000, wallet: 'admin', pid: 'g', pidRole: 'admin', action: 'Admin.Economy.Fund', outcome: 'ok' },
  ];
  let snapshot = aggregator.snapshot(0);
  for (const rec of records) {
    aggregator.ingest(rec);
    snapshot = applyMsg(snapshot, rec);
  }
  assert.deepEqual(snapshot.accounts, aggregator.snapshot(70_000).accounts);
  // Replayed onto a snapshot that already holds it, a write is not counted twice.
  assert.deepEqual(applyMsg(snapshot, records[0]).accounts, snapshot.accounts);
});

test('frames that arrive while a snapshot is fetched are replayed onto it without loss or double counts', withAggregator, () => {
  const { applyFrame } = view.model;
  const aggregator = createAggregator({ run: 'r' });
  const msg = (t0) => ({ v: 1, k: 'msg', run: 'r', t0, t1: t0 + 900, wallet: 'burner-1', pid: 'g', pidRole: 'game', rtMs: 900, outcome: 'ok' });
  for (let t = 10_000; t < 100_000; t += 1_000) aggregator.ingest(msg(t));
  const trade = { v: 1, k: 'trade', at: 99_000, wallet: 'burner-1', venue: 'internal', market: 'scroll/gold', side: 'buy', px: 90, qty: 1, filled: 1, fillPx: [90], orderId: 'o1' };
  aggregator.ingest(trade);
  const staleTick = JSON.parse(JSON.stringify(aggregator.takeTick(100_000)));
  const acct = { v: 1, k: 'acct', at: 100_500, wallet: 'burner-1', gold: 480 };
  aggregator.ingest(acct);
  const body = aggregator.snapshot(103_000);
  // Bucket 20 closes after the snapshot was built; its tick lands before the response is applied.
  for (let t = 100_000; t < 106_000; t += 1_000) aggregator.ingest(msg(t));
  const tick = JSON.parse(JSON.stringify(aggregator.takeTick(105_000)));
  const buffered = [
    { kind: 'tick', rec: staleTick },
    { kind: 'trade', rec: trade },
    { kind: 'acct', rec: { ...acct, at: 50_000, gold: 999 } },
    { kind: 'tick', rec: tick },
  ];
  const folded = buffered.reduce(applyFrame, body);
  const fresh = aggregator.snapshot(105_000);
  assert.deepEqual(folded.fleet.series, fresh.fleet.series);
  assert.ok(folded.fleet.series.some((row) => row.t === 100_000), 'the bucket that closed mid-fetch is kept');
  const [account] = folded.accounts;
  assert.equal(account.trades.length, 1);
  assert.equal(account.fills, 1);
  assert.equal(account.acct.gold, 480, 'an older acct does not roll the wallet back');
});

test('the Brake tile is gone and a latched halt is shown', withAggregator, () => {
  const clear = view.render(fixture);
  assert.doesNotMatch(clear, /Brake/);
  assert.doesNotMatch(clear, /data-figure="halt"/);
  const data = structuredClone(fixture);
  data.fleet.halt = { at: fixture.at, reason: 'pendingFinals 84% of cap', pid: fixture.processes[0].pid };
  const { applyHalt } = view.model;
  const aggregator = createAggregator({ run: 'r' });
  const rec = { v: 1, k: 'halt', at: 9_000, reason: 'node down', pid: 'g' };
  aggregator.ingest(rec);
  assert.deepEqual(applyHalt(fixture, rec).fleet.halt, aggregator.snapshot(10_000).fleet.halt);
  const halted = liveBar({ ...data, active: true });
  assert.match(halted, /data-figure="halt" class="[^"]*text-bad[^"]*">halted /);
  assert.match(halted, /pendingFinals 84% of cap/);
});

test('published bytes and the admin count come from the aggregator', () => {
  const html = view.render(fixture);
  assert.match(groupCard(html, 'game'), /published \d+(\.\d)? KB at /);
  assert.ok(fixture.fleet.admin.msgs > 0);
  assert.match(cards(html, 'admin')[0], new RegExp(`admin ${fixture.fleet.admin.msgs} kept out`));
  assert.doesNotMatch(cards(html, 'fleet')[0], /admin/);
});

test('a sampled series is averaged over its samples, not over the empty buckets between them', () => {
  const { presentMean } = view.charts;
  const rows = [{ v: 2 }, { v: null }, { v: 4 }, { v: null }];
  assert.equal(presentMean(rows, (row) => row.v), 3);
  assert.equal(presentMean([{ v: null }], (row) => row.v), null);
});

test('the cross-check keeps counting ok writes after their buckets leave the ring', () => {
  const { okWritesSince } = view.model;
  const counts = new Map();
  const at = (rows) => ({ roles: [{ pidRole: 'game', series: rows.map(([t, ok]) => ({ t, outcomes: { ok } })) }] });
  assert.equal(okWritesSince(counts, at([[0, 9], [5_000, 2], [10_000, 3]]), 'game', 5_000), 5);
  // The ring moved on and a late reply revised bucket 10 000.
  assert.equal(okWritesSince(counts, at([[10_000, 4], [15_000, 1]]), 'game', 5_000), 7);
});

test('trading summary: last fill price, fills/min by side, maker/taker', () => {
  const { marketRows, openOrders } = view.model;
  const accounts = [{
    wallet: 'a',
    acct: { openOrders: 3 },
    trades: [
      { at: 100_000, venue: 'internal', market: 'scroll/gold', side: 'buy', liq: 'taker', px: 90, filled: 1, fillPx: [91] },
      { at: 200_000, venue: 'internal', market: 'scroll/gold', side: 'sell', liq: 'maker', px: 99, filled: 1, fillPx: [] },
      { at: 250_000, venue: 'internal', market: 'scroll/gold', side: 'sell', liq: 'maker', px: 120, filled: 0 },
    ],
  }, { wallet: 'b', acct: { openOrders: 1 }, trades: [] }];
  const [row] = marketRows(accounts, 300_000, 150_000);
  assert.equal(row.lastPx, 99);
  // A sell sweeping three bids fills high to low; its last price is the lowest.
  const sweep = [{ wallet: 'c', trades: [{ at: 1, venue: 'internal', market: 'scroll/gold', side: 'sell', filled: 3, fillPx: [100, 98, 95] }] }];
  assert.equal(marketRows(sweep, 2, 150_000)[0].lastPx, 95);
  assert.equal(row.buyFillsPerMin, 0);
  assert.equal(row.sellFillsPerMin, 1 / 2.5);
  assert.equal(row.maker, 2);
  assert.equal(row.taker, 1);
  assert.equal(openOrders(accounts), 4);
});

test('prices render in whole quote units, fractions kept', () => {
  const data = structuredClone(fixture);
  data.accounts = [{
    ...data.accounts[0],
    trades: [{ at: data.at - 1_000, venue: 'external', market: 'rune/relic', side: 'buy', liq: 'taker', px: 0.5, pxAtoms: 500_000, qty: 1, filled: 1, fillPx: [0.5] }],
  }];
  const html = view.renderTrading(data);
  assert.match(html, />0\.5</);
  assert.doesNotMatch(html, /500,000/);
  assert.match(html, /cap 2,000 per venue/);
});

test('a node outage folds the way the aggregator ingests it, and is shown beside the run status', withAggregator, () => {
  const { applyAlert, nodeDown } = view.model;
  const aggregator = createAggregator({ run: 'r' });
  let snapshot = aggregator.snapshot(0);
  const down = { v: 1, k: 'alert', at: 5_000, reason: 'node-down', node: 'http://node', since: 3_000 };
  aggregator.ingest(down);
  snapshot = applyAlert(snapshot, down);
  assert.deepEqual(snapshot.fleet.nodeStatus, { ...aggregator.snapshot(9_000).fleet.nodeStatus, downMs: null },
    'the aggregator adds how long it has been down at the snapshot');
  assert.deepEqual(nodeDown({ ...snapshot, at: 9_000 }), { since: 3_000, downMs: 6_000, node: 'http://node' });
  const up = { v: 1, k: 'alert', at: 12_000, reason: 'node-up', node: 'http://node', downMs: 9_000 };
  aggregator.ingest(up);
  snapshot = applyAlert(snapshot, up);
  assert.deepEqual(snapshot.fleet.nodeStatus, aggregator.snapshot(13_000).fleet.nodeStatus);
  assert.equal(nodeDown(snapshot), null);

  const data = { ...structuredClone(fixture), active: true };
  assert.doesNotMatch(liveBar(data), /data-figure="node-down"/);
  data.fleet.nodeStatus = { up: false, since: data.at - 90_000, downMs: 90_000, node: 'http://node' };
  const status = liveBar(data);
  assert.match(status, /data-figure="node-down" class="[^"]*text-bad[^"]*"[^>]*>Node down since [^<]*, 1 min so far</);
});

test('a wallet can wait on a game write and a venue write at once, and each reply closes its own', () => {
  const { applySend, applyMsg, pendingLanes } = view.model;
  let data = structuredClone(fixture);
  const wallet = 'burner-07';
  data.accounts.find((account) => account.wallet === wallet).pending = [];
  const at = data.at;
  data = applySend(data, { at: at - 30_000, id: 'g1', acct: wallet, pid: 'TEST-g', pidRole: 'game', verb: 'battle.start' });
  data = applySend(data, { at: at - 5_000, id: 'v1', acct: wallet, pid: 'TEST-v', pidRole: 'venue.internal', verb: 'order.place' });
  const held = () => data.accounts.find((account) => account.wallet === wallet);
  assert.deepEqual(pendingLanes(held(), at).map((lane) => lane.id), ['g1', 'v1']);
  assert.deepEqual(tags(tile(view.render(data), wallet)).filter((tag) => tag.attrs['data-lane']).map((tag) => tag.attrs['data-lane']),
    ['game', 'venue.internal'], 'two chips stacked');
  data = applyMsg(data, { id: 'v1', t0: at - 5_000, t1: at - 1_000, wallet, pid: 'TEST-v', pidRole: 'venue.internal', action: 'order.place', outcome: 'ok' });
  assert.deepEqual(held().pending.map((open) => open.id), ['g1'], 'the venue reply closes only the venue write');
  data = applySend(data, { at: at - 1_000, id: 'g2', acct: wallet, pid: 'TEST-g', pidRole: 'game', verb: 'battle.move' });
  assert.deepEqual(held().pending.map((open) => open.id), ['g2'], 'a new write on the same contract replaces the one left open');
});

test('a backlogged group says so on its own card', () => {
  const { buildGroups } = view.model;
  const data = structuredClone(fixture);
  const game = data.processes.find((process) => process.pidRole === 'game');
  game.current.inFlight = 60;
  game.current.sentPerS = 0.5;
  data.roles.find((role) => role.pidRole === 'game').saturation.rtSlopeMsPerMin = 0;
  assert.equal(buildGroups(data).find((entry) => entry.def.id === 'game').status, 'backlog');
  assert.match(groupCard(view.render(data), 'game'), />backlog</);
});

test('a group card leads its totals with messages received, and names the contract behind a slowest round trip', () => {
  const { buildGroups, fmtRate } = view.model;
  const html = view.render(fixture);
  const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const group of buildGroups(fixture).filter((entry) => !entry.def.secondary)) {
    const card = groupCard(html, group.def.id);
    const totals = card.slice(card.indexOf('data-figure="totals"'));
    assert.match(totals, new RegExp(`^[^>]*><div[^>]*><dd[^>]*>${escape(fmtRate(group.receivedSlotsPerS))}</dd><dt[^>]*>received/s<`),
      `${group.def.id}: received/s is the first total`);
    if (group.rtBasis !== 'slowest') continue;
    const source = group.rtSource.p50;
    assert.equal(group.rt.p50, fixture.roles.find((role) => role.pidRole === source.pidRole).current.rt.p50);
    assert.match(card, new RegExp(
      `data-rt-source="${escape(source.pidRole)}"[^>]*>slowest of 2 contracts: <span[^>]*>${escape(source.label)}</span>, ${source.n} ok`,
    ));
  }
  assert.match(groupCard(html, 'hunt'), />writes\/s<\/span><span[^>]*>p50</, 'member columns have a header');
});

test('a phone-sized tile keeps its PnL as a green or red bar', () => {
  const data = structuredClone(fixture);
  data.accounts.find((entry) => entry.wallet === 'burner-01').acct.pnlGold = 42;
  data.accounts.find((entry) => entry.wallet === 'burner-02').acct.pnlGold = -13;
  data.accounts.find((entry) => entry.wallet === 'burner-03').acct.pnlGold = 0;
  const html = view.render(data);
  assert.match(tile(html, 'burner-01'), /data-pnl-bar="up" class="[^"]*bg-good/);
  assert.match(tile(html, 'burner-02'), /data-pnl-bar="down" class="[^"]*bg-bad/);
  assert.doesNotMatch(tile(html, 'burner-03'), /data-pnl-bar/);
  const grid = cards(html, 'wallet-grid')[0];
  const legend = grid.slice(grid.indexOf('aria-label="Tile colours"'), grid.indexOf('data-grid="wallets"'));
  assert.match(legend, /data-legend="battling"/);
  assert.doesNotMatch(legend.slice(0, legend.indexOf('</ul>')), />\d+</, 'the legend is swatches only; counts live in the header');
  assert.match(grid, /Tap a tile for the rest/);
});

test('money flow lanes show every flow the aggregator counted, both ways, with quantities', () => {
  const { FLOW_LANES, fmtQty } = view.model;
  const html = view.render(fixture);
  const panel = cards(html, 'money-flow')[0];
  assert.ok(panel, 'the money flow panel renders');
  assert.ok(html.indexOf('data-card="money-flow"') < html.indexOf('data-card="charts"'), 'above the charts');
  assert.equal((panel.match(/data-lane="/g) ?? []).length, FLOW_LANES.length);
  // The fixture is eight minutes long, so the default 15 min window is the whole log.
  for (const lane of FLOW_LANES) {
    for (const flow of [lane.forward, lane.back].filter(Boolean)) {
      const row = fixture.fleet.flows[flow];
      assert.ok(row?.msgs > 0, `the fixture exercises ${flow}`);
      assert.ok(panel.includes(`data-flow="${flow.replace('>', '&gt;')}" data-msgs="${row.msgs}"`), flow);
      assert.ok(panel.includes(fmtQty(row.qty)), `${flow} quantity`);
    }
  }
  assert.doesNotMatch(panel, /data-figure="flow-(uncounted|derived)"/);
  assert.equal((panel.match(/<svg/g) ?? []).length, 0, 'the lanes stand alone');
  assert.equal((cards(html, 'money-flow-detail')[0].match(/<svg/g) ?? []).length, 1, 'one flows/min chart, under More detail');
});

test('a window summed from buckets equals the whole-log totals when the ring holds the whole log', () => {
  const { flowWindow } = view.model;
  const all = flowWindow(fixture, null);
  const summed = flowWindow(fixture, 60 * 60_000);
  assert.deepEqual(summed.flows, all.flows);
  assert.deepEqual(summed.markets, all.markets);
  assert.ok(flowWindow(fixture, 60_000).flows['wallet->wallet'] === undefined
    || flowWindow(fixture, 60_000).flows['wallet->wallet'].msgs <= all.flows['wallet->wallet'].msgs);
});

test('buy vs sell flags a one-sided market; a stream without flow totals says so and reads trades instead', () => {
  const { marketBalance } = view.model;
  const side = (orders, maker, taker, qty, filled) => ({ orders, maker, taker, qty, filled, fills: filled ? 1 : 0 });
  const [lopsided, even] = marketBalance({
    'internal:fire_berry/gold': { venue: 'internal', market: 'fire_berry/gold', buy: side(2, 0, 2, 6, 6), sell: side(40, 40, 0, 300, 0) },
    'internal:scroll/gold': { venue: 'internal', market: 'scroll/gold', buy: side(30, 2, 28, 50, 20), sell: side(35, 5, 30, 60, 5) },
  });
  assert.equal(lopsided.oneSided, 'sell');
  assert.equal(lopsided.buyFillRate, 1);
  assert.equal(lopsided.sellFillRate, 0);
  assert.equal(even.oneSided, null);
  const strips = cards(view.render(fixture), 'buy-sell')[0];
  for (const key of Object.keys(fixture.fleet.markets)) assert.ok(strips.includes(`data-market="${key}"`), key);

  const old = structuredClone(fixture);
  delete old.fleet.flows;
  delete old.fleet.markets;
  for (const bucket of old.fleet.series) { delete bucket.flows; delete bucket.markets; }
  const html = view.render(old);
  const panel = cards(html, 'money-flow')[0];
  assert.match(panel, /data-figure="flow-uncounted"/);
  assert.doesNotMatch(panel, /data-lane=/);
  assert.match(cards(html, 'buy-sell')[0], /data-market="internal:scroll\/gold"/, 'markets still come from held trades');
});

test('writes read from verb names are counted and flagged as having no quantity', withAggregator, () => {
  const aggregator = createAggregator({ run: 'r' });
  aggregator.ingest({ v: 1, k: 'msg', t0: 1_000, t1: 2_000, wallet: 'burner-1', pid: 'g', pidRole: 'game', action: 'venue.send', intent: 'trade.deposit.scroll', outcome: 'ok' });
  const panel = cards(view.render(aggregator.snapshot(10_000)), 'money-flow')[0];
  assert.match(panel, /data-figure="flow-derived"/);
  assert.ok(panel.includes('data-flow="game-&gt;venue" data-msgs="1"'));
});

test('a peer token send folds onto sender and recipient the way the aggregator ingests it', withAggregator, () => {
  const { applyMsg, recentPeer } = view.model;
  const aggregator = createAggregator({ run: 'r' });
  const peer = (fields) => ({
    v: 1, k: 'msg', pid: 'r', pidRole: 'rune', action: 'transfer', flow: 'wallet->wallet', asset: 'rune', ...fields,
  });
  const records = [
    peer({ id: 'a', t0: 1_000, t1: 2_000, wallet: 'burner-1', to: 'burner-2', qty: 4, outcome: 'ok' }),
    peer({ id: 'b', t0: 3_000, t1: 3_500, wallet: 'burner-1', to: 'burner-3', qty: 2, outcome: 'rejected' }),
    peer({ id: 'c', t0: 4_000, t1: 4_900, wallet: 'burner-2', to: 'burner-1', qty: 1, outcome: 'ok' }),
    { v: 1, k: 'msg', t0: 5_000, t1: 5_400, wallet: 'burner-3', pid: 'g', pidRole: 'game', action: 'venue.send', flow: 'game->venue', asset: 'scroll', qty: 2, outcome: 'ok' },
  ];
  let snapshot = aggregator.snapshot(0);
  for (const rec of records) {
    aggregator.ingest(rec);
    snapshot = applyMsg(snapshot, rec);
  }
  const fresh = aggregator.snapshot(10_000);
  assert.deepEqual(snapshot.accounts, fresh.accounts);
  assert.deepEqual(applyMsg(snapshot, records[0]).accounts, snapshot.accounts, 'a replayed send is not counted twice');
  const one = fresh.accounts.find((account) => account.wallet === 'burner-1');
  assert.equal(recentPeer(one, 10_000), 'both');
  assert.equal(recentPeer(one, 10_000 + 10 * 60_000), null);

  // A tick carries the whole-log flow totals.
  const tick = JSON.parse(JSON.stringify(aggregator.takeTick(10_000)));
  assert.deepEqual(view.model.applyTick(snapshot, tick).fleet.flows, fresh.fleet.flows);
});

test('a tile marks a recent peer send, and the drawer lists peer transfers', () => {
  const data = structuredClone(fixture);
  const sender = data.accounts.find((entry) => entry.wallet === 'burner-05');
  sender.peer = { sent: 3, received: 0, lastSentAt: data.at - 30_000, lastReceivedAt: null };
  sender.transfers = [{ id: 'x', at: data.at - 30_000, dir: 'sent', peer: 'burner-06', asset: 'rune', qty: 7, outcome: 'ok' }];
  const quiet = data.accounts.find((entry) => entry.wallet === 'burner-04');
  quiet.peer = { sent: 1, received: 0, lastSentAt: data.at - 20 * 60_000, lastReceivedAt: null };
  const html = view.render(data);
  assert.match(tile(html, 'burner-05'), /data-peer="sent"/);
  assert.match(tile(html, 'burner-05'), /data-peer-mark/);
  assert.doesNotMatch(tile(html, 'burner-04'), /data-peer=/, 'an old send is not recent');
  const drawer = view.renderDrawer(sender);
  assert.match(drawer, /Peer transfers/);
  assert.match(drawer, /3 sent · 0 received/);
  assert.match(drawer, /data-transfer="sent"/);
  assert.match(drawer, />burner-06</);
});
