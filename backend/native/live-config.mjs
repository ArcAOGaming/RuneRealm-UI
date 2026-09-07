/**
 * One resolver for every live-test process id.
 *
 * A Rune Realm deployment is a graph, not just a game pid. Historically the
 * test tools read that graph from six different places: live-process.txt,
 * hunt-process.txt, rune-process.txt, marketplace-processes.txt, two JSON
 * receipts, and the defaults baked into the browser client. Overriding only
 * GAME_PROCESS could therefore send game actions to one deployment and Hunt
 * or exchange actions to another. This module makes that state explicit and refuses
 * to join receipts which do not name the selected game and node.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ROOT = path.resolve(HERE, '..', '..');
export const PROCESS_ID_RE = /^[A-Za-z0-9_-]{43}$/;

const clean = (value) => String(value ?? '').trim();
const cleanNode = (value) => clean(value).replace(/\/$/, '');

function lines(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).map(clean).filter(Boolean);
}

function json(file, issues) {
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) {
    issues.errors.push(`${path.basename(file)} is not valid JSON: ${error.message}`);
    return null;
  }
}

function huntReceipt(file) {
  const value = lines(file);
  const nodeAt = value.findIndex((entry) => /^https?:\/\//i.test(entry));
  if (nodeAt < 1) return null;
  return {
    process: value[0],
    workers: value.slice(0, nodeAt),
    node: cleanNode(value[nodeAt]),
    game: value[nodeAt + 1] ?? '',
  };
}

/**
 * The marketplace receipt, read by SHAPE rather than by position.
 *
 * It used to lead with the AMM pool id, so the file on disk is five lines and a
 * freshly written one is four. Reading it as fixed fields shifted every value
 * by one and made the resolver report that matching receipts disagreed on the
 * Rune process -- which made every backend tool refuse to start. So find the
 * node URL the way `huntReceipt` does and read the ids in front of it: two is
 * (rune, quote), three is a legacy file whose first line is the dead pool.
 */
function marketReceipt(file) {
  const value = lines(file);
  const nodeAt = value.findIndex((entry) => /^https?:\/\//i.test(entry));
  if (nodeAt < 2) return null;
  const ids = value.slice(0, nodeAt);
  const [rune, quote] = ids.length >= 3 ? ids.slice(-2) : ids;
  return { rune, quote, node: cleanNode(value[nodeAt]), owner: value[nodeAt + 1] ?? '' };
}

function textReceipt(file, fields) {
  const value = lines(file);
  if (!value.length) return null;
  return Object.fromEntries(fields.map((field, index) => [field, value[index] ?? '']));
}

function provided(overrides, env, key, aliases, issues) {
  const direct = clean(overrides[key]);
  if (direct) return { value: key.endsWith('Node') || key === 'node' ? cleanNode(direct) : direct,
    source: `override.${key}` };
  const entries = aliases.map((name) => [name, clean(env[name])]).filter(([, value]) => value);
  const distinct = [...new Set(entries.map(([, value]) => (
    key.endsWith('Node') || key === 'node' ? cleanNode(value) : value
  )))];
  if (distinct.length > 1) {
    issues.errors.push(`Conflicting ${key} variables: ${entries.map(([name, value]) => `${name}=${value}`).join(', ')}`);
  }
  if (!entries.length) return null;
  const [name, value] = entries[0];
  return { value: key.endsWith('Node') || key === 'node' ? cleanNode(value) : value,
    source: `env.${name}` };
}

function choose(explicit, candidates, fallback = '') {
  if (explicit) return explicit;
  const found = candidates.find((candidate) => clean(candidate?.value));
  return found ?? { value: fallback, source: fallback ? 'default' : 'unset' };
}

function rejectReceiptConflict(name, choice, candidates, issues) {
  if (/^(override|env)\./.test(choice.source)) return;
  const values = [...new Set(candidates
    .map((value) => typeof value === 'string' ? clean(value) : '')
    .filter(Boolean))];
  if (values.length > 1) {
    issues.errors.push(`Matching receipts disagree on ${name}: ${values.join(' vs ')}`);
  }
}

/**
 * Resolve a complete test graph without making a network request.
 *
 * Precedence is: explicit overrides, canonical/legacy environment aliases,
 * matching deployment receipts, then the small text receipts. Optional
 * receipts are ignored when they belong to another game or node.
 */
export function resolveLiveGraph({
  root = DEFAULT_ROOT,
  env = process.env,
  overrides = {},
} = {}) {
  const native = path.join(root, 'backend', 'native');
  const issues = { errors: [], warnings: [] };
  const live = textReceipt(path.join(root, 'live-process.txt'), ['game', 'node', 'owner']);
  const deployment = json(path.join(native, 'deployment-state.json'), issues);
  const market = json(path.join(native, 'marketplace-state.json'), issues);
  const venue = json(path.join(native, 'venue-state.json'), issues);
  const marketText = marketReceipt(path.join(root, 'marketplace-processes.txt'));
  const runeText = textReceipt(path.join(root, 'rune-process.txt'), ['rune', 'node', 'owner']);
  const hunt = huntReceipt(path.join(root, 'hunt-process.txt'));
  const battle = json(path.join(native, 'battle-fleet', 'manifest.local.json'), issues);

  const gameChoice = choose(
    provided(overrides, env, 'game', ['GAME_PROCESS', 'VITE_GAME_PROCESS'], issues),
    [
      live && { value: live.game, source: 'live-process.txt' },
      deployment?.processes?.game && { value: deployment.processes.game, source: 'deployment-state.json' },
    ],
  );
  const explicitNode = provided(overrides, env, 'node',
    ['NODE_URL', 'HB_NODE', 'VITE_HB_NODE'], issues);
  const nodeChoice = choose(
    explicitNode,
    [
      live && { value: cleanNode(live.node), source: 'live-process.txt' },
      deployment?.node && { value: cleanNode(deployment.node), source: 'deployment-state.json' },
    ],
  );
  const game = clean(gameChoice.value);
  const node = cleanNode(nodeChoice.value);

  // NODE_URL may be the local browser relay. In that case it is a transport
  // endpoint, not evidence that every matching receipt belongs elsewhere.
  // The game id still binds the graph, and the explicit transport is applied
  // to every component unless that component has its own node override.
  const nodeMatches = (receiptNode) => Boolean(explicitNode)
    || !receiptNode || cleanNode(receiptNode) === node;
  const deploymentMatches = deployment?.processes?.game === game
    && nodeMatches(deployment?.node);
  const liveMatches = live?.game === game && nodeMatches(live?.node);
  const marketMatches = market?.game === game && nodeMatches(market?.node);
  const receiptRune = deploymentMatches ? deployment?.processes?.rune
    : (marketMatches ? market?.rune : '');
  const receiptQuote = deploymentMatches ? deployment?.processes?.quote
    : (marketMatches ? market?.quote : '');
  const venueMatches = venue?.game === game && (!receiptRune || venue?.rune === receiptRune)
    && (!receiptQuote || venue?.quote === receiptQuote)
    && nodeMatches(venue?.node);
  const huntMatches = hunt?.game === game && nodeMatches(hunt?.node);
  const battleMatches = battle?.gameProcess === game && nodeMatches(battle?.node);

  if (deployment && !deploymentMatches) {
    issues.warnings.push('deployment-state.json belongs to another game or node and was not joined');
  }
  if (market && !marketMatches) {
    issues.warnings.push('marketplace-state.json belongs to another game or node and was not joined');
  }
  if (venue && !venueMatches) {
    issues.warnings.push('venue-state.json belongs to another game, token pair or node and was not joined');
  }
  if (hunt && !huntMatches) {
    issues.warnings.push('hunt-process.txt belongs to another game or node and was not joined');
  }
  if (battle && !battleMatches) {
    issues.warnings.push('battle-fleet/manifest.local.json belongs to another game or node and was not joined');
  }

  const ownerChoice = choose(
    provided(overrides, env, 'owner', ['GAME_OWNER', 'VITE_GAME_OWNER'], issues),
    [
      live && { value: live.owner, source: 'live-process.txt' },
      deploymentMatches && { value: deployment.owner, source: 'deployment-state.json' },
    ],
  );
  const runeChoice = choose(
    provided(overrides, env, 'rune', ['RUNE_PROCESS', 'RUNE_TOKEN', 'VITE_RUNE_PROCESS'], issues),
    [
      deploymentMatches && { value: deployment.processes?.rune, source: 'deployment-state.json' },
      marketMatches && { value: market.rune, source: 'marketplace-state.json' },
      marketMatches && marketText && nodeMatches(marketText.node)
        ? { value: marketText.rune, source: 'marketplace-processes.txt' } : null,
      liveMatches && runeText && nodeMatches(runeText.node)
        ? { value: runeText.rune, source: 'rune-process.txt' } : null,
    ],
  );
  const quoteChoice = choose(
    provided(overrides, env, 'quote', ['QUOTE_PROCESS', 'QUOTE_TOKEN', 'VITE_QUOTE_PROCESS'], issues),
    [
      deploymentMatches && { value: deployment.processes?.quote, source: 'deployment-state.json' },
      marketMatches && { value: market.quote, source: 'marketplace-state.json' },
      marketMatches && marketText && nodeMatches(marketText.node)
        ? { value: marketText.quote, source: 'marketplace-processes.txt' } : null,
    ],
  );
  const marketNodeChoice = choose(
    provided(overrides, env, 'marketNode', ['MARKET_NODE', 'VITE_MARKET_NODE'], issues),
    [
      explicitNode && { value: node, source: nodeChoice.source },
      marketMatches && { value: cleanNode(market.node), source: 'marketplace-state.json' },
      { value: node, source: nodeChoice.source },
    ],
  );
  const internalVenueChoice = choose(
    provided(overrides, env, 'internalVenue',
      ['INTERNAL_VENUE_PROCESS', 'VITE_INTERNAL_VENUE_PROCESS'], issues),
    [
      deploymentMatches && { value: deployment.processes?.internalVenue,
        source: 'deployment-state.json' },
      venueMatches && { value: venue.internal, source: 'venue-state.json' },
    ],
  );
  const externalVenueChoice = choose(
    provided(overrides, env, 'externalVenue',
      ['EXTERNAL_VENUE_PROCESS', 'VITE_EXTERNAL_VENUE_PROCESS'], issues),
    [
      deploymentMatches && { value: deployment.processes?.externalVenue,
        source: 'deployment-state.json' },
      venueMatches && { value: venue.external, source: 'venue-state.json' },
    ],
  );
  const venueNodeChoice = choose(
    provided(overrides, env, 'venueNode', ['VENUE_NODE', 'VITE_VENUE_NODE'], issues),
    [
      explicitNode && { value: node, source: nodeChoice.source },
      deploymentMatches && { value: cleanNode(deployment.nodes?.venue),
        source: 'deployment-state.json' },
      venueMatches && { value: cleanNode(venue.node), source: 'venue-state.json' },
      { value: node, source: nodeChoice.source },
    ],
  );
  const huntChoice = choose(
    provided(overrides, env, 'hunt', ['HUNT_PROCESS', 'VITE_HUNT_PROCESS'], issues),
    [
      deploymentMatches && { value: deployment.processes?.hunt, source: 'deployment-state.json' },
      huntMatches && { value: hunt.process, source: 'hunt-process.txt' },
    ],
  );
  const huntNodeChoice = choose(
    provided(overrides, env, 'huntNode', ['HUNT_NODE', 'VITE_HUNT_NODE'], issues),
    [
      explicitNode && { value: node, source: nodeChoice.source },
      deploymentMatches && { value: cleanNode(deployment.nodes?.hunt), source: 'deployment-state.json' },
      huntMatches && { value: hunt.node, source: 'hunt-process.txt' },
      { value: node, source: nodeChoice.source },
    ],
  );

  rejectReceiptConflict('Rune process', runeChoice, [
    deploymentMatches && deployment.processes?.rune,
    marketMatches && market.rune,
    marketMatches && marketText?.rune,
    liveMatches && runeText?.rune,
  ], issues);
  rejectReceiptConflict('quote process', quoteChoice, [
    deploymentMatches && deployment.processes?.quote,
    marketMatches && market.quote,
    marketMatches && marketText?.quote,
  ], issues);
  rejectReceiptConflict('internal venue', internalVenueChoice, [
    deploymentMatches && deployment.processes?.internalVenue,
    venueMatches && venue.internal,
  ], issues);
  rejectReceiptConflict('external venue', externalVenueChoice, [
    deploymentMatches && deployment.processes?.externalVenue,
    venueMatches && venue.external,
  ], issues);
  rejectReceiptConflict('Hunt process', huntChoice, [
    deploymentMatches && deployment.processes?.hunt,
    huntMatches && hunt?.process,
  ], issues);

  const huntWorkers = deploymentMatches && deployment.processes?.huntWorkers?.length
    ? deployment.processes.huntWorkers.map(clean).filter(Boolean)
    : (huntMatches ? (hunt?.workers ?? []).map(clean).filter(Boolean) : []);
  const battleWorkers = deploymentMatches && deployment.processes?.battleWorkers?.length
    ? deployment.processes.battleWorkers.map(clean).filter(Boolean)
    : (battleMatches
      ? (battle?.workers ?? [])
        .map((worker) => clean(typeof worker === 'string' ? worker
          : (worker.workerProcessId || worker.processId || worker.id)))
        .filter(Boolean)
      : []);

  const graph = {
    game,
    node,
    owner: clean(ownerChoice.value),
    rune: clean(runeChoice.value),
    quote: clean(quoteChoice.value),
    marketNode: cleanNode(marketNodeChoice.value),
    internalVenue: clean(internalVenueChoice.value),
    externalVenue: clean(externalVenueChoice.value),
    venueNode: cleanNode(venueNodeChoice.value),
    hunt: clean(huntChoice.value),
    huntNode: cleanNode(huntNodeChoice.value),
    huntWorkers,
    battleWorkers,
    // Where each id came from, so a surprising graph can be explained rather
    // than guessed at. This is the whole point of resolving in one place.
    // `provenance` is the name the swarm's graph table reads; `sources` is the
    // name the rest of the tooling uses. One object, both spellings, because a
    // renamed field that only shows up when a tool is RUN is exactly the kind
    // of break a passing test suite hides.
    sources: {
      game: gameChoice.source, node: nodeChoice.source, owner: ownerChoice.source,
      rune: runeChoice.source, quote: quoteChoice.source,
      marketNode: marketNodeChoice.source,
      internalVenue: internalVenueChoice.source,
      externalVenue: externalVenueChoice.source, venueNode: venueNodeChoice.source,
      hunt: huntChoice.source, huntNode: huntNodeChoice.source,
    },
    errors: issues.errors,
    warnings: issues.warnings,
  };
  graph.provenance = graph.sources;

  // The exchange is a PAIR. Half of one is not a usable configuration, and
  // silently carrying the half that resolved is how a test ends up pointing at
  // one deployment's Rune and another's quote.
  if (graph.quote && !graph.rune) {
    graph.errors.push('the external exchange must provide both a Rune and a quote process id');
  }
  if (Boolean(graph.internalVenue) !== Boolean(graph.externalVenue)) {
    graph.errors.push('the venue graph must provide both internal and external process ids');
  }
  for (const [key, value] of Object.entries({
    game: graph.game, rune: graph.rune, quote: graph.quote,
    hunt: graph.hunt, owner: graph.owner,
    internalVenue: graph.internalVenue, externalVenue: graph.externalVenue,
  })) {
    if (value && !PROCESS_ID_RE.test(value)) {
      graph.errors.push(`${key} is not a 43-character process id: ${value}`);
    }
  }
  return graph;
}

/**
 * The same graph, but refuse to hand back one that is unusable.
 *
 * `resolveLiveGraph` collects rather than throws, because a caller printing a
 * diagnosis wants every problem at once. Every other caller wants the graph or
 * an exception, and getting that wrong means a tool runs against half a
 * deployment. The `require*` flags say which optional components this caller
 * genuinely needs, so a game-only tool is not blocked by an absent Hunt fleet.
 */
export function assertLiveGraph(graph, {
  requireHunt = false, requireExchange = false, requireVenues = false,
  requireBattleFleet = false,
} = {}) {
  const errors = [...graph.errors];
  if (!PROCESS_ID_RE.test(graph.game ?? '')) {
    errors.push('a game process id is required but was not configured');
  }
  if (!graph.node) errors.push('a node URL is required but was not configured');
  if (requireExchange
      && ![graph.rune, graph.quote].every((id) => PROCESS_ID_RE.test(id ?? ''))) {
    errors.push('Rune/quote exchange is required but not configured');
  }
  if (requireVenues
      && ![graph.internalVenue, graph.externalVenue]
        .every((id) => PROCESS_ID_RE.test(id ?? ''))) {
    errors.push('both internal and external venues are required but not configured');
  }
  if (requireHunt && !PROCESS_ID_RE.test(graph.hunt ?? '')) {
    errors.push('a Hunt process is required but not configured');
  }
  if (requireBattleFleet && !graph.battleWorkers?.length) {
    errors.push('a battle fleet is required but no workers are configured');
  }
  if (errors.length) {
    throw new Error(`live configuration is unusable:\n  ${errors.join('\n  ')}`);
  }
  return graph;
}

/**
 * The graph as the browser bundle's environment.
 *
 * Only ids that resolved are emitted: an empty `VITE_*` is worse than an absent
 * one, because the client cannot tell "not configured" from "configured to
 * nothing" and will happily address a process id of "".
 */
export function viteEnvForGraph(graph) {
  const env = {
    VITE_GAME_PROCESS: graph.game,
    VITE_HB_NODE: graph.node,
    VITE_GAME_OWNER: graph.owner,
  };
  if (graph.hunt) {
    env.VITE_HUNT_PROCESS = graph.hunt;
    env.VITE_HUNT_NODE = graph.huntNode || graph.node;
  }
  if (graph.rune) env.VITE_RUNE_PROCESS = graph.rune;
  if (graph.quote) env.VITE_QUOTE_PROCESS = graph.quote;
  if (graph.rune || graph.quote) env.VITE_MARKET_NODE = graph.marketNode || graph.node;
  if (graph.internalVenue) env.VITE_INTERNAL_VENUE_PROCESS = graph.internalVenue;
  if (graph.externalVenue) env.VITE_EXTERNAL_VENUE_PROCESS = graph.externalVenue;
  if (graph.internalVenue || graph.externalVenue) {
    env.VITE_VENUE_NODE = graph.venueNode || graph.node;
  }
  return env;
}

/** One published key, parsed, or undefined if it is not really there. */
async function published(node, pid, key, fetchImpl, timeoutMs) {
  const url = `${cleanNode(node)}/${pid}~process@1.0/now/${key}`;
  const controller = timeoutMs ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetchImpl(url, controller ? { signal: controller.signal } : undefined);
    if (!res.ok) return undefined;
    const text = (await res.text()).trim();
    // An HTML body at status 200 is this node saying "key absent" with its own
    // landing page. Treat it as absent everywhere a published key is read.
    if (!text || /^<!DOCTYPE html|^<html/i.test(text)) return undefined;
    try { return JSON.parse(text); } catch { return text; }
  } catch {
    return undefined;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Ask the live processes whether they agree with the graph.
 *
 * Both directions, deliberately: a game naming a Rune token that does not name
 * it back is a half-wired deployment, and it reads as working until the first
 * withdrawal.
 */
export async function verifyLiveGraph(graph, {
  fetchImpl = fetch, timeoutMs = 15_000,
  requireHunt = false, requireExchange = false, requireVenues = false,
  requireBattleFleet = false,
} = {}) {
  const checks = [];
  const errors = [];
  const check = (name, ok, detail) => {
    checks.push({ name, ok, detail });
    if (!ok) errors.push(`${name}: ${detail}`);
  };
  const tasks = [];
  if (graph.rune || requireExchange) {
    tasks.push((async () => {
      const wired = await published(graph.node, graph.game, 'runetoken', fetchImpl, timeoutMs);
      const minter = await published(graph.marketNode || graph.node, graph.rune, 'minter',
        fetchImpl, timeoutMs);
      check('game -> Rune', wired === graph.rune, `published ${wired || '(empty)'}`);
      check('Rune -> game', minter === graph.game, `published ${minter || '(empty)'}`);
    })());
  }
  if (graph.internalVenue || graph.externalVenue || requireVenues) {
    tasks.push((async () => {
      const venueNode = graph.venueNode || graph.node;
      const [wired, internalInfo, externalInfo, internalMarkets, externalMarkets] =
        await Promise.all([
          published(graph.node, graph.game, 'venueprocess', fetchImpl, timeoutMs),
          published(venueNode, graph.internalVenue, 'venueinfo', fetchImpl, timeoutMs),
          published(venueNode, graph.externalVenue, 'venueinfo', fetchImpl, timeoutMs),
          published(venueNode, graph.internalVenue, 'markets', fetchImpl, timeoutMs),
          published(venueNode, graph.externalVenue, 'markets', fetchImpl, timeoutMs),
        ]);
      check('game -> internal venue', wired === graph.internalVenue,
        `published ${wired || '(empty)'}`);
      check('internal venue -> game', internalInfo?.Mode === 'internal'
        && internalInfo?.Sealed === true && internalInfo?.GameProcess === graph.game,
      `published ${internalInfo?.Mode || '(empty)'}/${internalInfo?.GameProcess || '(empty)'}`);
      check('external venue token pair', externalInfo?.Mode === 'external'
        && externalInfo?.Sealed === true
        && externalInfo?.Assets?.rune?.process === graph.rune
        && externalInfo?.Assets?.relic?.process === graph.quote,
      `published ${externalInfo?.Assets?.rune?.process || '(empty)'} / ${externalInfo?.Assets?.relic?.process || '(empty)'}`);
      const internalRows = Object.values(internalMarkets ?? {});
      const externalRows = Object.values(externalMarkets ?? {});
      check('venue markets launched', internalRows.length === 7
        && internalRows.every((row) => row?.status === 'open')
        && externalRows.length === 1 && externalRows[0]?.status === 'open',
      `published ${internalRows.filter((row) => row?.status === 'open').length}/7 internal, `
        + `${externalRows.filter((row) => row?.status === 'open').length}/1 external`);
    })());
  }
  if (graph.hunt) {
    tasks.push((async () => {
      const value = await published(graph.node, graph.game, 'huntconfig', fetchImpl, timeoutMs);
      const workers = (value?.workers ?? []).map((worker) => typeof worker === 'string' ? worker
        : (worker.processId || worker.workerProcessId || worker.id));
      check('game -> Hunt', value?.enabled === true && value?.processId === graph.hunt,
        `published ${value?.processId || '(disabled)'}`);
      if (graph.huntWorkers?.length) {
        check('Hunt fleet roster', graph.huntWorkers.every((id) => workers.includes(id)),
          `published ${workers.length}/${graph.huntWorkers.length} configured workers`);
      }
    })());
  }
  if (graph.battleWorkers?.length) {
    tasks.push((async () => {
      const value = await published(graph.node, graph.game, 'battlefleet', fetchImpl, timeoutMs);
      const workers = (value?.workers ?? []).map((worker) => typeof worker === 'string' ? worker
        : (worker.processId || worker.workerProcessId || worker.id));
      check('battle fleet roster', value?.enabled === true
        && graph.battleWorkers.every((id) => workers.includes(id)),
      `published ${workers.length}/${graph.battleWorkers.length} configured workers`);
    })());
  }
  const settled = await Promise.allSettled(tasks);
  for (const outcome of settled) {
    if (outcome.status === 'rejected') errors.push(outcome.reason?.message ?? String(outcome.reason));
  }
  return { ok: errors.length === 0, checks, errors };
}

/**
 * The graph as it goes into a run record: ids and nodes, no local bookkeeping.
 *
 * `sources`, `errors` and `warnings` describe where THIS machine read its
 * receipts, which is noise in a soak log and would differ between two machines
 * driving the same deployment.
 */
export function publicLiveGraph(graph) {
  return {
    game: graph.game, node: graph.node, owner: graph.owner,
    rune: graph.rune, quote: graph.quote, marketNode: graph.marketNode,
    internalVenue: graph.internalVenue, externalVenue: graph.externalVenue,
    venueNode: graph.venueNode,
    hunt: graph.hunt, huntNode: graph.huntNode,
    huntWorkers: [...(graph.huntWorkers ?? [])],
    battleWorkers: [...(graph.battleWorkers ?? [])],
  };
}
