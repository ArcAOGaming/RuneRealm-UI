import {
  Battle, Combatant, CombatantState, Element, Monster, Move, Turn, Tuning,
} from './types';

export type StudioTuning = Tuning & { roundCap: number };

export const STUDIO_TUNING: StudioTuning = {
  attackBase: 1,
  variance: 0.15,
  hpPerHealth: 12,
  shieldPerDefense: 4,
  healPerPoint: 0.04,
  shieldRegenShare: 0.2,
  moveUses: 3,
  struggleDamage: 2,
  baseHitChance: 0.7,
  minHitChance: 0.3,
  maxHitChance: 0.95,
  criticalChance: 0.09,
  criticalMultiplier: 1.6,
  roundCap: 50,
};

const EFFECTIVENESS: Record<Element, Record<Element, number>> = {
  fire: { fire: 1, water: 0.5, air: 2, rock: 1 },
  water: { fire: 2, water: 1, air: 1, rock: 0.5 },
  air: { fire: 0.5, water: 2, air: 1, rock: 1 },
  rock: { fire: 1, water: 1, air: 0.5, rock: 2 },
};

const SPRITE: Record<Element, string> = {
  fire: 'wUo47CacsMRFFizJqUhSj75Rczg3f_MvHs4ytfPtCjQ',
  water: 'p90BYY1O3BS3VVzdZETr-hG6jkA3kwo8l0h3aQ2UFoc',
  air: '0_gQ7rNpxD8S4wZBE_DZs3adWfZMsBIuo8fwvH3SwL0',
  rock: 'Zt8LmHGVIziXhzjqBhEAWLuGetcDitFKbfaJROkyZks',
};

const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const integer = (rng: () => number, low: number, high: number) =>
  low + Math.floor(rng() * (high - low + 1));

function combatant(monster: Monster, side: Combatant['side'], tuning: StudioTuning): Combatant {
  const moves = copy(monster.moves ?? {});
  Object.entries(moves).forEach(([name, move]) => {
    move.name = name;
    move.count = Math.max(1, Math.trunc(move.count || 1) * tuning.moveUses);
  });
  const maxHealthPoints = Math.max(1, monster.health * tuning.hpPerHealth);
  const maxShield = Math.max(0, monster.defense * tuning.shieldPerDefense);
  return {
    side,
    address: side === 'challenger' ? 'studio-challenger' : 'bot',
    name: monster.name,
    image: monster.image,
    sprite: monster.sprite || SPRITE[monster.elementType === 'normal' ? 'fire' : monster.elementType],
    faction: monster.faction,
    elementType: monster.elementType,
    level: monster.level,
    attack: monster.attack,
    defense: monster.defense,
    speed: monster.speed,
    health: monster.health,
    healthPoints: maxHealthPoints,
    maxHealthPoints,
    shield: maxShield,
    maxShield,
    baseAttack: monster.attack,
    baseDefense: monster.defense,
    baseSpeed: monster.speed,
    moves,
  };
}

export function createStudioBattle(
  challenger: Monster,
  accepter: Monster,
  tuning: StudioTuning = STUDIO_TUNING,
  id = `studio-${Date.now()}`,
): Battle {
  return {
    id,
    kind: 'bot',
    status: 'battling',
    round: 0,
    turns: [],
    startedAt: Date.now(),
    challenger: combatant(challenger, 'challenger', tuning),
    accepter: combatant(accepter, 'accepter', tuning),
  };
}

function snapshot(fighter: Combatant): CombatantState {
  return {
    side: fighter.side,
    name: fighter.name,
    healthPoints: fighter.healthPoints,
    maxHealthPoints: fighter.maxHealthPoints,
    shield: fighter.shield,
    maxShield: fighter.maxShield,
    attack: fighter.attack,
    defense: fighter.defense,
    speed: fighter.speed,
    elementType: fighter.elementType,
  };
}

function hitChance(attacker: Combatant, defender: Combatant, tuning: StudioTuning) {
  const diff = Math.max(0, attacker.speed) - Math.max(0, defender.speed);
  const modifier = diff > 0 ? Math.min(0.25, diff * 0.08) : Math.max(-0.4, diff * 0.1);
  return Math.max(tuning.minHitChance, Math.min(tuning.maxHitChance, tuning.baseHitChance + modifier));
}

function struggle(tuning: StudioTuning): Move {
  return {
    name: 'Struggle', type: 'normal', rarity: 0, count: Number.MAX_SAFE_INTEGER,
    damage: tuning.struggleDamage, attack: 0, defense: 0, speed: 0, health: 0,
  };
}

function choose(fighter: Combatant, opponent: Combatant, rng: () => number, tuning: StudioTuning) {
  const available = Object.entries(fighter.moves)
    .filter(([, move]) => move.count > 0)
    .map(([name, move]) => ({ ...move, name }));
  if (!available.length) return struggle(tuning);
  const hurt = fighter.healthPoints <= fighter.maxHealthPoints * 0.35;
  const finishing = opponent.healthPoints <= opponent.maxHealthPoints * 0.25;
  const preferred = available.filter((move) => (
    (finishing && move.damage > 0) || (hurt && !finishing && move.health > 0)
  ));
  const pool = preferred.length ? preferred : available;
  return pool[integer(rng, 0, pool.length - 1)];
}

function damage(target: Combatant, amount: number) {
  const shieldDamage = Math.min(target.shield, amount);
  target.shield -= shieldDamage;
  const healthDamage = Math.max(0, amount - shieldDamage);
  target.healthPoints = Math.max(0, target.healthPoints - healthDamage);
  return { shieldDamage, healthDamage };
}

function act(
  attacker: Combatant,
  defender: Combatant,
  picked: Move,
  round: number,
  rng: () => number,
  tuning: StudioTuning,
): Turn {
  const stored = picked.name ? attacker.moves[picked.name] : undefined;
  if (stored) stored.count = Math.max(0, stored.count - 1);
  const move = stored ? { ...stored, name: picked.name } : picked;
  const turn: Turn = {
    round,
    attacker: attacker.side,
    attackerAddress: attacker.address,
    monsterName: attacker.name,
    move: move.name ?? 'Move',
    moveType: move.type,
    moveRarity: move.rarity,
    missed: false,
    critical: false,
    shieldDamage: 0,
    healthDamage: 0,
    statsChanged: {},
    superEffective: false,
    notEffective: false,
    attackerState: snapshot(attacker),
    defenderState: snapshot(defender),
  };

  if (move.damage > 0 && rng() > hitChance(attacker, defender, tuning)) {
    turn.missed = true;
    return turn;
  }
  if (move.damage > 0) {
    const multiplier = move.type in EFFECTIVENESS && defender.elementType !== 'normal'
      ? EFFECTIVENESS[move.type as Element][defender.elementType] : 1;
    const swing = 1 + ((rng() * 2) - 1) * tuning.variance;
    // Its own roll, after the swing, exactly as battle.lua takes it.
    turn.critical = rng() < tuning.criticalChance;
    const crit = turn.critical ? tuning.criticalMultiplier : 1;
    const amount = Math.max(1, Math.floor(
      move.damage * (tuning.attackBase + attacker.attack) * multiplier * swing * crit,
    ));
    Object.assign(turn, damage(defender, amount));
    turn.superEffective = multiplier > 1;
    turn.notEffective = multiplier < 1;
  }

  const changes: Turn['statsChanged'] = {};
  if (move.attack) { attacker.attack = Math.max(0, attacker.attack + move.attack); changes.attack = move.attack; }
  if (move.speed) { attacker.speed = Math.max(0, attacker.speed + move.speed); changes.speed = move.speed; }
  if (move.defense) {
    attacker.defense = Math.max(0, attacker.defense + move.defense);
    attacker.maxShield = Math.max(attacker.maxShield, attacker.defense * tuning.shieldPerDefense);
    attacker.shield = Math.max(0, attacker.shield + move.defense * tuning.shieldPerDefense);
    changes.defense = move.defense;
  }
  if (move.health) {
    const delta = Math.floor(move.health * tuning.healPerPoint * attacker.maxHealthPoints);
    attacker.healthPoints = delta > 0
      ? Math.min(attacker.maxHealthPoints, attacker.healthPoints + delta)
      : Math.max(1, attacker.healthPoints + delta);
    changes.health = move.health;
  }
  turn.statsChanged = changes;
  turn.attackerState = snapshot(attacker);
  turn.defenderState = snapshot(defender);
  return turn;
}

export function advanceStudioBattle(
  source: Battle,
  tuning: StudioTuning = STUDIO_TUNING,
  seed = source.round + 1,
): Battle {
  const battle = copy(source);
  if (battle.status === 'ended' || !battle.accepter) return battle;
  const a = battle.challenger;
  const b = battle.accepter;
  const rng = random(seed + battle.round * 7919);
  const aMove = choose(a, b, rng, tuning);
  const bMove = choose(b, a, rng, tuning);
  const round = battle.round + 1;
  const aFirst = (a.speed + integer(rng, 1, 5)) > (b.speed + integer(rng, 1, 5));
  const order: Array<[Combatant, Combatant, Move]> = aFirst
    ? [[a, b, aMove], [b, a, bMove]]
    : [[b, a, bMove], [a, b, aMove]];
  const turns: Turn[] = [];
  for (const [attacker, defender, move] of order) {
    if (attacker.healthPoints > 0) turns.push(act(attacker, defender, move, round, rng, tuning));
  }
  battle.round = round;
  battle.turns = [...battle.turns, ...turns].slice(-tuning.roundCap * 2);

  // Only an untouched fighter recovers shield — see battle.lua. A miss is not
  // a hit, and neither is a blow that dealt nothing.
  const hit = new Set<Combatant['side']>();
  for (const t of turns) {
    if (t.missed || t.shieldDamage + t.healthDamage <= 0) continue;
    hit.add(t.attacker === 'challenger' ? 'accepter' : 'challenger');
  }
  for (const fighter of [a, b]) {
    if (fighter.healthPoints <= 0 || hit.has(fighter.side)) continue;
    const regen = Math.ceil(fighter.maxShield * tuning.shieldRegenShare);
    fighter.shield = Math.min(fighter.maxShield, fighter.shield + regen);
  }

  if (a.healthPoints <= 0 || b.healthPoints <= 0) {
    battle.status = 'ended';
    battle.winner = b.healthPoints <= 0 && a.healthPoints > 0 ? 'challenger' : 'accepter';
  } else if (battle.round >= tuning.roundCap) {
    battle.status = 'ended';
    battle.timedOut = true;
    battle.winner = a.healthPoints / a.maxHealthPoints > b.healthPoints / b.maxHealthPoints
      ? 'challenger' : 'accepter';
  }
  return battle;
}

export function simulateMatchup(
  challenger: Monster,
  accepter: Monster,
  tuning: StudioTuning,
  iterations = 250,
) {
  let challengerWins = 0;
  let timeouts = 0;
  let rounds = 0;
  const distribution = new Array(Math.min(20, tuning.roundCap)).fill(0) as number[];
  for (let i = 0; i < iterations; i++) {
    let battle = createStudioBattle(challenger, accepter, tuning, `balance-${i}`);
    while (battle.status !== 'ended') battle = advanceStudioBattle(battle, tuning, 1009 + i * 97 + battle.round);
    if (battle.winner === 'challenger') challengerWins += 1;
    if (battle.timedOut) timeouts += 1;
    rounds += battle.round;
    distribution[Math.min(distribution.length - 1, battle.round - 1)] += 1;
  }
  return {
    iterations,
    challengerWinRate: challengerWins / iterations,
    accepterWinRate: (iterations - challengerWins) / iterations,
    timeoutRate: timeouts / iterations,
    averageRounds: rounds / iterations,
    distribution,
  };
}
