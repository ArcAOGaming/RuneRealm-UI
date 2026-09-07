/**
 * Observable proof that a soak left the whole realm active.
 *
 * Requirements name successful worker outcomes, never requests. A bot asking
 * to trade while a desk is empty does not count as trade coverage; the event
 * must say that the corresponding state transition actually completed.
 */
import fs from 'node:fs';
import path from 'node:path';
export const LIVED_IN_REQUIREMENTS = Object.freeze([
  { id: 'onboarding', label: 'accounts sworn and companions present', match: /^bootstrap(?:\.|$)/ },
  { id: 'worship', label: 'daily worship claimed', prefer: 'daily', match: /^daily\.claim$/ },
  { id: 'loot', label: 'loot box opened', prefer: 'loot', match: /^lootbox\.open$/ },
  { id: 'feed', label: 'companion fed berries', prefer: 'feed', match: /^monster\.feed$/ },
  { id: 'play', label: 'companion play started', prefer: 'play', match: /^activity\.start\.play$/ },
  { id: 'quest', label: 'quest started', prefer: 'quest', match: /^activity\.start\.quest$/ },
  { id: 'claim', label: 'timed companion activity claimed', match: /^activity\.claim\.(play|quest)$/ },
  { id: 'level', label: 'companion levelled and stats allocated', match: /^monster\.level-up$/ },
  { id: 'character', label: 'character outfit saved', match: /^character\.save$/ },
  { id: 'pve-start', label: 'PvE arena session entered', prefer: 'bot', match: /^arena\.enter$/ },
  { id: 'pve-stake', label: 'PvE battle Gold staked', match: /^battle\.start\.bot$/ },
  { id: 'pve-round', label: 'PvE battle round played', prefer: 'bot', match: /^battle\.(?:attack|settle)\.bot$/ },
  { id: 'pve-settlement', label: 'PvE stake settled with a receipt', match: /^battle\.settle\.bot$/ },
  { id: 'pvp-challenge', label: 'PvP challenge posted', match: /^pvp\.challenge$/ },
  { id: 'pvp-refund', label: 'unaccepted PvP challenge stake refunded', match: /^pvp\.challenge\.refund$/ },
  { id: 'pvp-accept', label: 'PvP challenge accepted', match: /^pvp\.accept$/ },
  { id: 'pvp-round', label: 'both sides of PvP rounds played', match: /^battle\.(?:attack|settle)\.pvp$/ },
  { id: 'pvp-settlement', label: 'PvP stakes settled with a receipt', match: /^battle\.settle\.pvp$/ },
  { id: 'hunt-begin', label: 'Hunt opened', prefer: 'hunt', match: /^hunt\.(begin|retry-open)$/ },
  { id: 'hunt-search', label: 'Hunt searched', prefer: 'hunt', match: /^hunt\.search$/ },
  { id: 'hunt-combat', label: 'Hunt combat round played', prefer: 'hunt', match: /^hunt\.attack$/ },
  { id: 'hunt-resolution', label: 'Hunt capture decision made', prefer: 'hunt', match: /^hunt\.(capture|decline)$/ },
  { id: 'hunt-end', label: 'Hunt released or ended', prefer: 'hunt', match: /^hunt\.end$/ },
  { id: 'roster-store', label: 'companion stored', prefer: 'store', match: /^monster\.store$/ },
  { id: 'roster-retrieve', label: 'companion retrieved', prefer: 'retrieve', match: /^monster\.retrieve$/ },
  { id: 'roster-active', label: 'active companion changed', prefer: 'swap', match: /^monster\.set-active$/ },
  { id: 'roster-transfer', label: 'companion transferred between bots', prefer: 'give', match: /^monster\.transfer$/ },
  { id: 'monster-list', label: 'companion listed for Rune', prefer: 'list', match: /^market\.list$/ },
  { id: 'monster-buy', label: 'companion bought from another bot', prefer: 'buy', match: /^market\.buy$/ },
  { id: 'monster-cancel', label: 'companion listing cancelled', prefer: 'cancel', match: /^market\.cancel$/ },
  { id: 'goods-make', label: 'Gold order-book quote placed', prefer: 'goods_make', match: /^goods\.order\.(bid|sell)$/ },
  { id: 'goods-amend', label: 'Gold order amended', prefer: 'goods_amend', match: /^goods\.order\.amend$/ },
  { id: 'goods-take', label: 'Gold order-book liquidity taken', prefer: 'goods_take', match: /^goods\.order\.buy$/ },
  { id: 'goods-cancel', label: 'Gold order cancelled', prefer: 'goods_cancel', match: /^goods\.order\.cancel(?:-all)?$/ },
  { id: 'goods-cancel-all', label: 'Gold orders batch-cancelled', prefer: 'goods_cancel_all', match: /^goods\.order\.cancel-all$/ },
  { id: 'goods-maintain', label: 'expired Gold orders maintained', prefer: 'goods_maintain', match: /^goods\.order\.maintain$/ },
  { id: 'shop-buy', label: 'item bought from NPC shop', prefer: 'shop_trade', match: /^shop\.buy$/ },
  { id: 'shop-sell', label: 'item sold to NPC shop', prefer: 'shop_trade', match: /^shop\.sell$/ },
  { id: 'arbitrage', label: 'P2P/NPC arbitrage route executed or proven uncrossable', prefer: 'arbitrage', match: /^arbitrage\./ },
  { id: 'internal-venue-deposit', label: 'game assets deposited into the internal venue', prefer: 'venue_internal', match: /^venue\.internal\.deposit$/ },
  { id: 'internal-venue-place', label: 'internal venue resting order placed', prefer: 'venue_internal', match: /^venue\.internal\.order\.(ask|bid)$/ },
  { id: 'internal-venue-amend', label: 'internal venue order amended', prefer: 'venue_internal', match: /^venue\.internal\.order\.amend$/ },
  { id: 'internal-venue-fill', label: 'internal venue order filled', prefer: 'venue_internal', match: /^venue\.internal\.order\.fill$/ },
  { id: 'internal-venue-cancel', label: 'internal venue order cancelled', prefer: 'venue_internal', match: /^venue\.internal\.order\.cancel$/ },
  { id: 'internal-venue-withdraw', label: 'assets withdrawn from the internal venue', prefer: 'venue_internal', match: /^venue\.internal\.withdraw$/ },
  { id: 'external-venue-faucet', label: 'external quote-token faucet claimed', prefer: 'venue_external', match: /^venue\.external\.faucet$/ },
  { id: 'external-venue-deposit', label: 'tokens deposited into the external venue', prefer: 'venue_external', match: /^venue\.external\.deposit\.(rune|relic)$/ },
  { id: 'external-venue-place', label: 'external venue resting order placed', prefer: 'venue_external', match: /^venue\.external\.order\.(ask|bid)$/ },
  { id: 'external-venue-amend', label: 'external venue order amended', prefer: 'venue_external', match: /^venue\.external\.order\.amend$/ },
  { id: 'external-venue-fill', label: 'external Rune/Relic order filled', prefer: 'venue_external', match: /^venue\.external\.order\.fill$/ },
  { id: 'external-venue-cancel', label: 'external venue order cancelled', prefer: 'venue_external', match: /^venue\.external\.order\.cancel$/ },
  { id: 'external-venue-withdraw', label: 'tokens withdrawn from the external venue', prefer: 'venue_external', match: /^venue\.external\.withdraw$/ },
  { id: 'rune-withdraw', label: 'Rune withdrawn to token', prefer: 'withdraw', match: /^rune\.withdraw$/ },
  { id: 'rune-deposit', label: 'token Rune deposited into game', prefer: 'deposit', match: /^rune\.deposit$/ },
  { id: 'refusal-probe', label: 'well-formed illegal action refused', prefer: 'probe', match: /^probe\./ },
]);

/** Actions deliberately outside randomized/repeated bot play. */
export const EXPLICIT_ONLY_ACTIONS = Object.freeze([
  { actions: ['Monster.Mint', 'Monster.Deposit'],
    reason: 'parked companion-asset path; creates or moves permanent paid L1 assets' },
  { actions: ['Pass.SetRecovery', 'Pass.Recover'],
    reason: 'changes account control and invalidates the burner identity running the actor' },
  { actions: ['Pass.ClaimPromise'],
    reason: 'one-use genesis entitlement requiring an explicitly provisioned claim id' },
  { actions: ['Pass.Bond', 'Pass.BeginUnbond', 'Pass.CompleteUnbond'],
    reason: 'policy-gated capital lock with a long real-time unbonding delay' },
  { actions: ['Admin.*'],
    reason: 'owner operations are setup/audit scenarios; ordinary bots probe that they are refused' },
]);

export function livedInCoverage(actions) {
  const names = Array.from(actions ?? [], String);
  const requirements = LIVED_IN_REQUIREMENTS.map((requirement) => {
    const hits = names.filter((action) => requirement.match.test(action)).length;
    return { id: requirement.id, label: requirement.label, hits, covered: hits > 0 };
  });
  const missing = requirements.filter((row) => !row.covered);
  return {
    complete: missing.length === 0,
    covered: requirements.length - missing.length,
    total: requirements.length,
    requirements,
    missing: missing.map(({ id, label }) => ({ id, label })),
  };
}

/**
 * Adapters the scheduler should favor next. Repeated preferences are removed:
 * one successful Hunt naturally drives search/combat/settlement on later ticks.
 */
export function missingCoveragePreferences(actions, { historicalActions = [] } = {}) {
  const names = Array.from(actions ?? [], String);
  const history = Array.from(historicalActions ?? [], String);
  const missing = LIVED_IN_REQUIREMENTS
    .filter((requirement) => requirement.prefer
      && !names.some((action) => requirement.match.test(action)))
    .sort((left, right) => {
      const leftSeen = history.some((action) => left.match.test(action));
      const rightSeen = history.some((action) => right.match.test(action));
      return Number(leftSeen) - Number(rightSeen);
    });
  return [...new Set(missing.map((requirement) => requirement.prefer))];
}

export function assignCoveragePreferences(actors, actions, options = {}) {
  const missing = missingCoveragePreferences(actions, options);
  if (!missing.length) return new Map();
  const assigned = new Map();
  let cursor = 0;
  for (const actor of actors) {
    for (let checked = 0; checked < missing.length; checked += 1) {
      const prefer = missing[(cursor + checked) % missing.length];
      if ((actor.profile.weights?.[prefer] ?? 0) > 0) {
        assigned.set(actor.profile.wallet, prefer);
        cursor = (cursor + checked + 1) % missing.length;
        break;
      }
    }
  }
  return assigned;
}

export function loadCoverageLedger(file) {
  if (!fs.existsSync(file)) return { version: 1, runs: 0, actions: {} };
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (value?.version !== 1 || !value.actions || typeof value.actions !== 'object') {
      throw new Error('unsupported coverage ledger shape');
    }
    return value;
  } catch (error) {
    throw new Error(`Cannot read eventual-coverage ledger ${file}: ${error.message}`);
  }
}

/** Persist successful outcomes only; a requested or refused action is no proof. */
export function updateCoverageLedger(file, { runId, actions, at = new Date().toISOString() }) {
  const ledger = loadCoverageLedger(file);
  ledger.runs = Number(ledger.runs ?? 0) + 1;
  ledger.lastRunId = runId;
  ledger.updatedAt = at;
  for (const action of actions ?? []) {
    const name = String(action ?? '');
    if (!name) continue;
    const row = ledger.actions[name] ?? { hits: 0, firstSeenAt: at, firstRunId: runId };
    row.hits += 1;
    row.lastSeenAt = at;
    row.lastRunId = runId;
    ledger.actions[name] = row;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(ledger, null, 2)}\n`);
  return ledger;
}
