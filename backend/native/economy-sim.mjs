#!/usr/bin/env node
/**
 * Hostile-account calibration for ECONOMY_MARKETPLACE_PLAN.md sections 8.7-8.9.
 *
 * This is policy simulation, not a price oracle. Values are deliberately CLI
 * inputs because global Rune emission, qualified-player weighting, the bond,
 * and maximum NPC subsidy remain open launch decisions.
 */
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

export const DEFAULTS = Object.freeze({
  passPriceUsd: 25,
  runeUsd: 0.10,
  accountNetRune30Cap: 20,
  globalRunePer30Days: 2000,
  npcSubsidyRuneEquivalent30: 0,
  genesisPassCount: 168,
  bondRune: 5,
});

const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? Number(argv[index + 1]) : fallback;
};

export function maturityWeight(day) {
  if (day < 7) return 0;
  if (day < 30) return 0.5;
  return 1;
}

export function marginalPassPrice(index, {
  launch = DEFAULTS.passPriceUsd,
  genesis = DEFAULTS.genesisPassCount,
  previous = launch,
  monthlySubsidyUsd = DEFAULTS.accountNetRune30Cap * DEFAULTS.runeUsd,
} = {}) {
  const growth = launch * Math.sqrt(Math.max(1, index / Math.max(1, genesis)));
  const security = 12 * monthlySubsidyUsd;
  return Math.max(previous, growth, security);
}

export function simulate({
  days,
  qualifiedAccounts,
  attackerAccounts = qualifiedAccounts,
  passPriceUsd = DEFAULTS.passPriceUsd,
  runeUsd = DEFAULTS.runeUsd,
  accountNetRune30Cap = DEFAULTS.accountNetRune30Cap,
  globalRunePer30Days = DEFAULTS.globalRunePer30Days,
  npcSubsidyRuneEquivalent30 = DEFAULTS.npcSubsidyRuneEquivalent30,
  genesisPassCount = DEFAULTS.genesisPassCount,
  bondRune = DEFAULTS.bondRune,
}) {
  let globalRune = 0;
  let accountRune = 0;
  for (let day = 0; day < days; day++) {
    const weight = maturityWeight(day);
    const globalDaily = globalRunePer30Days / 30;
    const accountDailyCap = accountNetRune30Cap / 30 * weight;
    const weightedDemand = qualifiedAccounts * accountDailyCap;
    const issued = Math.min(globalDaily, weightedDemand);
    globalRune += issued;
    accountRune += qualifiedAccounts ? Math.min(accountDailyCap, issued / qualifiedAccounts) : 0;
  }
  const attackerShare = Math.min(1, attackerAccounts / Math.max(1, qualifiedAccounts));
  const attackerRuneRewards = globalRune * attackerShare;
  const npcEquivalent = npcSubsidyRuneEquivalent30 * (days / 30) * attackerAccounts;
  const extractedUsd = (attackerRuneRewards + npcEquivalent) * runeUsd;
  let passCostUsd = 0;
  let previous = passPriceUsd;
  for (let index = 0; index < attackerAccounts; index++) {
    previous = marginalPassPrice(genesisPassCount + index, {
      launch: passPriceUsd, genesis: genesisPassCount, previous,
      monthlySubsidyUsd: (accountNetRune30Cap + npcSubsidyRuneEquivalent30) * runeUsd,
    });
    passCostUsd += previous;
  }
  const bondCapitalUsd = attackerAccounts * bondRune * runeUsd;
  return {
    days, qualifiedAccounts, attackerAccounts,
    globalRuneIssued: globalRune,
    perQualifiedAccountRune: accountRune,
    unusedGlobalRune: Math.max(0, globalRunePer30Days * days / 30 - globalRune),
    attackerRuneEquivalent: attackerRuneRewards + npcEquivalent,
    extractedUsd,
    passCostUsd,
    bondCapitalUsd,
    capitalAtRiskUsd: passCostUsd + bondCapitalUsd,
    recoupFraction: passCostUsd ? extractedUsd / passCostUsd : 0,
    modeledPaybackDays: extractedUsd > 0 ? days * passCostUsd / extractedUsd : Infinity,
  };
}

export function selfTest() {
  const low = simulate({ days: 30, qualifiedAccounts: 1, attackerAccounts: 1,
    globalRunePer30Days: 2000 });
  assert.equal(Math.round(low.perQualifiedAccountRune), 8,
    'maturity plus the per-account cap leaves most low-population budget unused');
  assert.ok(low.unusedGlobalRune > 1900, 'unused low-population Rune is not handed to one account');

  const small = simulate({ days: 30, qualifiedAccounts: 100, attackerAccounts: 100 });
  const farm = simulate({ days: 30, qualifiedAccounts: 1000, attackerAccounts: 1000 });
  assert.ok(farm.globalRuneIssued <= DEFAULTS.globalRunePer30Days + 1e-9,
    'adding accounts never enlarges the global Rune budget');
  assert.ok(farm.globalRuneIssued >= small.globalRuneIssued,
    'more qualified demand may use an existing budget, never exceed it');
  assert.equal(marginalPassPrice(168), 25);
  assert.equal(marginalPassPrice(672), 50);
  assert.equal(marginalPassPrice(16800), 250);
}

function report() {
  const config = {
    passPriceUsd: option('pass-usd', DEFAULTS.passPriceUsd),
    runeUsd: option('rune-usd', DEFAULTS.runeUsd),
    accountNetRune30Cap: option('account-rune-30', DEFAULTS.accountNetRune30Cap),
    globalRunePer30Days: option('global-rune-30', DEFAULTS.globalRunePer30Days),
    npcSubsidyRuneEquivalent30: option('npc-rune-equivalent-30', DEFAULTS.npcSubsidyRuneEquivalent30),
    genesisPassCount: option('genesis', DEFAULTS.genesisPassCount),
    bondRune: option('bond-rune', DEFAULTS.bondRune),
  };
  const populations = [1, 50, 168, 1000];
  const horizons = [30, 90, 180, 365];
  console.log('Rune Realm adversarial economy calibration');
  console.log(config);
  for (const population of populations) {
    console.log(`\n${population} hostile qualified account${population === 1 ? '' : 's'}`);
    console.table(horizons.map((days) => {
      const row = simulate({ days, qualifiedAccounts: population,
        attackerAccounts: population, ...config });
      return {
        days,
        globalRune: row.globalRuneIssued.toFixed(1),
        runePerAccount: row.perQualifiedAccountRune.toFixed(2),
        unusedRune: row.unusedGlobalRune.toFixed(1),
        extractedUsd: row.extractedUsd.toFixed(2),
        passCostUsd: row.passCostUsd.toFixed(2),
        recoup: `${(row.recoupFraction * 100).toFixed(1)}%`,
        paybackDays: Number.isFinite(row.modeledPaybackDays)
          ? row.modeledPaybackDays.toFixed(0) : 'never',
      };
    }));
  }
}

selfTest();
if (import.meta.url === pathToFileURL(process.argv[1]).href) report();
