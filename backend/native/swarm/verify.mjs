#!/usr/bin/env node
/**
 * verify.mjs — read a swarm run's log and say whether the process behaved.
 *
 *   node backend/native/swarm/verify.mjs               # the newest run
 *   node backend/native/swarm/verify.mjs <run-id>
 *   node backend/native/swarm/verify.mjs --all
 *
 * Why the checking is here and not in the worker
 * ----------------------------------------------
 * Fifty wallets act concurrently against one process, so no actor can judge its
 * own result at the time it gets it. "The listing I tried to buy was gone" is a
 * correct outcome if somebody else bought it a moment earlier and a bug if
 * nobody did, and the actor cannot tell those apart — it does not know what the
 * other forty-nine did. The log does. Every judgement that needs to compare two
 * actors is therefore made afterwards, over the whole run, where the ordering
 * is settled.
 *
 * What it asserts
 * ---------------
 *   * every deliberately illegal probe was refused, and refused for a reason
 *     rather than by a transport failure that would refuse anything;
 *   * a listing was sold at most once, and only ever after it was listed;
 *   * a seller never bought their own listing;
 *   * the number of companions each actor holds only ever changes for a reason
 *     the log can name;
 *   * failures are separated into the ones a concurrent run is entitled to
 *     produce and the ones it is not.
 *
 * And it reports the compute picture: latency by action, where the tail is, and
 * whether the node got slower as the run went on — which is the difference
 * between "the process is wrong" and "the process is loaded".
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const RUNS = path.join(ROOT, '.swarm', 'runs');

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const named = argv.find((arg) => !arg.startsWith('--'));

/**
 * Refusals a concurrent run is entitled to produce.
 *
 * These are not "errors we tolerate" — each one is a race that fifty
 * independent wallets against one serial process will genuinely create, and
 * treating them as failures would bury the real ones. Anything not on this list
 * is reported.
 */
const BENIGN = [
  /No such listing/i,
  /already have a companion/i,
  /companion is busy/i,
  /Finish your battle first/i,
  /roster is full/i,
  /No such companion in your (roster|collection)/i,
  /cannot buy your own listing/i,
  /and you hold/i,                       // outbid: the runes went elsewhere first
  /Not enough energy|Not happy enough/i,
  /No battles remaining/i,
  /already in a battle/i,
  /Enter the arena first/i,
  /not your turn|round/i,
  /Daily.*(claimed|not ready)/i,
];
const isBenign = (message) => BENIGN.some((pattern) => pattern.test(String(message ?? '')));

function readRun(runId) {
  const file = path.join(RUNS, runId, 'events.jsonl');
  if (!fs.existsSync(file)) throw new Error(`no event log at ${file}`);
  const events = [];
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { events.push(JSON.parse(line)); } catch { /* a torn last line on Ctrl+C */ }
  }
  return events;
}

function quantile(values, at) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * at))];
}

function verify(runId) {
  const events = readRun(runId);
  const findings = [];
  const finding = (severity, kind, message, detail) =>
    findings.push({ severity, kind, message, ...detail });

  const actions = events.filter((event) => event.type === 'action');
  const errors = events.filter((event) => event.type === 'error');
  const runEnd = [...events].reverse().find((event) => event.type === 'run.end');

  if (runEnd?.economy) {
    if (runEnd.economy.ok !== true) {
      finding('critical', 'economy-invariant', 'the final published economy did not reconcile',
        { economy: runEnd.economy });
    }
  } else {
    finding('major', 'economy-audit-missing', 'the run recorded no final published economy audit', {});
  }
  for (const event of actions) {
    if (Number(event.state?.gold ?? 0) < 0 || Number(event.state?.runes ?? 0) < 0
        || Number(event.state?.berries ?? 0) < 0) {
      finding('critical', 'negative-balance', `${event.wallet} published a negative holding after ${event.action}`,
        { wallet: event.wallet, action: event.action, state: event.state });
    }
  }

  // -- The probes ----------------------------------------------------------
  const probes = actions.filter((event) => typeof event.probe === 'string');
  const byProbe = new Map();
  for (const event of probes) {
    const seen = byProbe.get(event.probe) ?? { attempted: 0, refused: 0, allowed: [] };
    seen.attempted++;
    if (event.refused) seen.refused++;
    else seen.allowed.push(event);
    byProbe.set(event.probe, seen);
  }
  for (const [name, seen] of byProbe) {
    for (const event of seen.allowed) {
      finding('critical', 'illegal-op-accepted',
        `${event.wallet} (${event.callSign}) ran ${name} and it was ALLOWED — ${event.rule}`,
        { probe: name, wallet: event.wallet, tags: event.tags });
    }
  }

  // -- The marketplace, reconstructed from the log -------------------------
  //
  // A listing can be created once, and then either cancelled or bought, once.
  // The log carries both sides, so the whole lifecycle is checkable without
  // asking the process anything.
  const listed = new Map();
  const settled = new Map();
  for (const event of actions) {
    if (event.action === 'market.list' && event.listingId) {
      if (listed.has(event.listingId)) {
        finding('critical', 'listing-id-reused',
          `listing ${event.listingId} was issued twice`, { listing: event.listingId });
      }
      listed.set(event.listingId, event);
    }
    if (event.action === 'market.buy' || event.action === 'market.cancel') {
      const id = event.listingId;
      if (!id) continue;
      const previous = settled.get(id);
      if (previous) {
        finding('critical', 'listing-settled-twice',
          `listing ${id} was ${previous.action.split('.')[1]} by ${previous.wallet} `
          + `and then ${event.action.split('.')[1]} by ${event.wallet}`,
          { listing: id });
      }
      settled.set(id, event);
      const origin = listed.get(id);
      if (event.action === 'market.buy' && origin && origin.wallet === event.wallet) {
        finding('critical', 'bought-own-listing',
          `${event.wallet} bought its own listing ${id}`, { listing: id });
      }
      // A run may legitimately settle a listing created by an earlier run, so
      // an unknown id is only worth noting when the run created listings at all.
      if (!origin && listed.size > 0) {
        finding('info', 'settled-foreign-listing',
          `${event.wallet} settled ${id}, which this run never created`, { listing: id });
      }
    }
  }

  // -- Companion population, per actor -------------------------------------
  //
  // Every state sample carries the roster and collection counts, so a change
  // between two consecutive samples for the same wallet has to be explained by
  // what that wallet did in between. Anything else is a companion appearing or
  // disappearing on its own.
  const holdings = new Map();
  for (const event of actions) {
    const state = event.state;
    if (!state || state.roster === undefined) continue;
    const held = (state.roster ?? 0) + (state.collection ?? 0);
    const last = holdings.get(event.wallet);
    holdings.set(event.wallet, { held, action: event.action });
    if (!last) continue;
    const delta = held - last.held;
    if (delta === 0) continue;
    // Growing by one is a retrieve-from-nothing, a purchase, a gift received,
    // or an adoption. Shrinking by one is a sale, a gift given, or a mint.
    // More than one at a time is not something any single verb does.
    if (Math.abs(delta) > 1) {
      finding('major', 'holding-jumped',
        `${event.wallet} went from ${last.held} companions to ${held} across one action `
        + `(${last.action} then ${event.action})`,
        { wallet: event.wallet, from: last.held, to: held });
    }
    if (delta > 0 && event.action === 'monster.store') {
      finding('critical', 'store-created-a-companion',
        `${event.wallet} gained a companion by storing one`, { wallet: event.wallet });
    }
    if (delta < 0 && event.action === 'monster.retrieve') {
      finding('critical', 'retrieve-lost-a-companion',
        `${event.wallet} lost a companion by retrieving one`, { wallet: event.wallet });
    }
  }

  // -- Roster cap ----------------------------------------------------------
  for (const event of actions) {
    const state = event.state;
    if (!state?.rosterMax) continue;
    if ((state.roster ?? 0) > state.rosterMax) {
      finding('critical', 'roster-over-cap',
        `${event.wallet} held ${state.roster} active companions after ${event.action}, `
        + `cap is ${state.rosterMax}`,
        { wallet: event.wallet });
    }
    if ((state.roster ?? 0) > 0 && !state.activeId) {
      finding('major', 'no-active-companion',
        `${event.wallet} held ${state.roster} companions and none was active after ${event.action}`,
        { wallet: event.wallet });
    }
  }

  // -- Failures ------------------------------------------------------------
  const hostile = errors.filter((event) => !isBenign(event.error));
  const raced = errors.length - hostile.length;
  const byMessage = new Map();
  for (const event of hostile) {
    const key = String(event.error).replace(/\b[A-Za-z0-9_-]{43}\b/g, '<address>').slice(0, 160);
    const seen = byMessage.get(key) ?? { count: 0, wallets: new Set() };
    seen.count++;
    seen.wallets.add(event.wallet);
    byMessage.set(key, seen);
  }
  for (const [message, seen] of byMessage) {
    finding(seen.count > 3 ? 'major' : 'info', 'unexplained-failure',
      `${seen.count}x across ${seen.wallets.size} wallet(s): ${message}`,
      { count: seen.count });
  }

  // -- Compute -------------------------------------------------------------
  const durations = actions
    .map((event) => event.durationMs)
    .filter((value) => Number.isFinite(value));
  const byAction = new Map();
  for (const event of actions) {
    if (!Number.isFinite(event.durationMs)) continue;
    const bucket = byAction.get(event.action) ?? [];
    bucket.push(event.durationMs);
    byAction.set(event.action, bucket);
  }
  // Did it get slower? Compare the first and last thirds of the run, which is
  // the shape a compute queue that is falling behind actually makes.
  const third = Math.floor(durations.length / 3);
  const early = quantile(durations.slice(0, third), 0.5);
  const late = quantile(durations.slice(-third), 0.5);
  if (third > 20 && late > early * 2 && late - early > 1000) {
    finding('major', 'degrading-under-load',
      `median response went from ${early}ms early in the run to ${late}ms at the end`,
      { early, late });
  }

  return {
    runId,
    events: events.length,
    actions: actions.length,
    errors: errors.length,
    racedFailures: raced,
    probes: Object.fromEntries([...byProbe].map(([name, seen]) =>
      [name, { attempted: seen.attempted, refused: seen.refused, allowed: seen.allowed.length }])),
    listings: { created: listed.size, settled: settled.size },
    latency: {
      p50Ms: quantile(durations, 0.5),
      p90Ms: quantile(durations, 0.9),
      p99Ms: quantile(durations, 0.99),
      maxMs: durations.length ? Math.max(...durations) : 0,
      earlyMedianMs: early,
      lateMedianMs: late,
      slowest: [...byAction]
        .map(([action, values]) => ({ action, p99Ms: quantile(values, 0.99), count: values.length }))
        .sort((a, b) => b.p99Ms - a.p99Ms)
        .slice(0, 8),
    },
    findings,
  };
}

// ---------------------------------------------------------------------------

if (!fs.existsSync(RUNS)) {
  console.error(`No swarm runs yet. ${RUNS} does not exist.`);
  process.exit(1);
}
const available = fs.readdirSync(RUNS).sort();
if (!available.length) {
  console.error('No swarm runs to verify.');
  process.exit(1);
}
const chosen = flag('all') ? available : [named ?? available.at(-1)];

let worst = 0;
for (const runId of chosen) {
  const report = verify(runId);
  fs.writeFileSync(path.join(RUNS, runId, 'verify.json'),
    JSON.stringify(report, null, 2) + '\n');

  console.log(`\n=== ${runId} ===`);
  console.log(`${report.actions} actions, ${report.errors} failures `
    + `(${report.racedFailures} of them the expected consequence of concurrency)`);
  console.log(`listings    ${report.listings.created} created, ${report.listings.settled} settled`);
  console.log(`latency     p50 ${report.latency.p50Ms}ms  p90 ${report.latency.p90Ms}ms  `
    + `p99 ${report.latency.p99Ms}ms  max ${report.latency.maxMs}ms`);
  console.log(`under load  median ${report.latency.earlyMedianMs}ms early `
    + `-> ${report.latency.lateMedianMs}ms late`);
  if (report.latency.slowest.length) {
    console.log('slowest     ' + report.latency.slowest
      .map((row) => `${row.action}=${row.p99Ms}ms`).join('  '));
  }

  const probeNames = Object.entries(report.probes);
  if (probeNames.length) {
    const allowed = probeNames.filter(([, seen]) => seen.allowed > 0);
    const total = probeNames.reduce((sum, [, seen]) => sum + seen.attempted, 0);
    console.log(`probes      ${total} illegal attempts across ${probeNames.length} rules, `
      + `${allowed.length ? `${allowed.length} RULE(S) NOT ENFORCED` : 'all refused'}`);
  } else {
    console.log('probes      none in this run (an older run, or --limit excluded them)');
  }

  const counts = report.findings.reduce((totals, entry) => {
    totals[entry.severity] = (totals[entry.severity] ?? 0) + 1;
    return totals;
  }, {});
  if (!report.findings.length) {
    console.log('\nNothing to report: every illegal attempt was refused, every listing '
      + 'settled once, and no wallet gained or lost a companion without doing something.');
  } else {
    console.log(`\n${report.findings.length} finding(s): `
      + Object.entries(counts).map(([key, value]) => `${value} ${key}`).join(', '));
    for (const entry of report.findings) {
      console.log(`  [${entry.severity}] ${entry.kind}: ${entry.message}`);
    }
  }
  console.log(`\nreport      ${path.join(RUNS, runId, 'verify.json')}`);

  const rank = { critical: 3, major: 2, info: 0 };
  for (const entry of report.findings) worst = Math.max(worst, rank[entry.severity] ?? 0);
}
if (worst >= 2) process.exitCode = 1;
