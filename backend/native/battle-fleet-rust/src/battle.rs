use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const ROUND_CAP: u32 = 50;
const BASE_HIT_CHANCE: f64 = 0.70;
const MIN_HIT_CHANCE: f64 = 0.30;
const MAX_HIT_CHANCE: f64 = 0.95;
const ATTACK_BASE: i64 = 1;
const VARIANCE: f64 = 0.15;
/// Critical hits, mirroring `Battle.TUNING` in battle.lua exactly. The roll is
/// taken from the same stream in the same position as the Lua side, so a worker
/// and the game process resolve an identical round from an identical seed.
const CRITICAL_CHANCE: f64 = 0.09;
const CRITICAL_MULTIPLIER: f64 = 1.6;
const HP_PER_HEALTH: i64 = 12;
const SHIELD_PER_DEFENSE: i64 = 4;
const HEAL_PER_POINT: f64 = 0.04;
/// Share of its cap a shield recovers at the end of a round in which its owner
/// took no damage. Mirrors `shieldRegenShare` in battle.lua.
const SHIELD_REGEN_SHARE: f64 = 0.20;
const MOVE_USES: i64 = 3;
const STRUGGLE_DAMAGE: i64 = 2;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct StoredMove {
    pub count: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Monster {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sprite: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub faction: Option<String>,
    pub element_type: String,
    pub level: i64,
    pub attack: i64,
    pub defense: i64,
    pub speed: i64,
    pub health: i64,
    pub moves: BTreeMap<String, StoredMove>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Move {
    pub name: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub rarity: i64,
    pub count: i64,
    pub damage: i64,
    pub attack: i64,
    pub speed: i64,
    pub defense: i64,
    pub health: i64,
    #[serde(skip)]
    struggle: bool,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Combatant {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sprite: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub faction: Option<String>,
    pub element_type: String,
    pub level: i64,
    pub attack: i64,
    pub defense: i64,
    pub speed: i64,
    pub health: i64,
    pub moves: BTreeMap<String, Move>,
    pub side: String,
    pub address: String,
    pub max_health_points: i64,
    pub health_points: i64,
    pub max_shield: i64,
    pub shield: i64,
    pub base_attack: i64,
    pub base_defense: i64,
    pub base_speed: i64,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub side: String,
    pub name: String,
    pub health_points: i64,
    pub max_health_points: i64,
    pub shield: i64,
    pub max_shield: i64,
    pub attack: i64,
    pub defense: i64,
    pub speed: i64,
    pub element_type: String,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Turn {
    pub attacker: String,
    pub attacker_address: String,
    pub monster_name: String,
    #[serde(rename = "move")]
    pub move_name: String,
    pub move_type: String,
    pub move_rarity: i64,
    pub missed: bool,
    pub critical: bool,
    pub shield_damage: i64,
    pub health_damage: i64,
    pub stats_changed: BTreeMap<String, i64>,
    pub super_effective: bool,
    pub not_effective: bool,
    pub attacker_state: Snapshot,
    pub defender_state: Snapshot,
    pub round: u32,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Battle {
    pub id: String,
    pub kind: String,
    pub status: String,
    pub round: u32,
    pub turns: Vec<Turn>,
    pub started_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cancelled_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub winner: Option<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub timed_out: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub turns_trimmed: bool,
    pub challenger: Combatant,
    pub accepter: Combatant,
}

#[derive(Clone, Debug)]
pub struct Rng(u32);

impl Rng {
    pub fn seeded(material: &str) -> Self {
        let mut seed = 104_729_u64;
        for byte in material.bytes() {
            seed = (seed.wrapping_mul(131).wrapping_add(u64::from(byte))) % 2_147_483_647;
        }
        Self(seed as u32)
    }

    fn next(&mut self) -> u32 {
        let mut x = self.0;
        if x == 0 {
            x = 0x6d2b_79f5;
        }
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.0 = x;
        x
    }

    pub fn range(&mut self, low: i64, high: i64) -> i64 {
        if high <= low {
            return low;
        }
        low + (self.next() % ((high - low + 1) as u32)) as i64
    }
}

#[allow(clippy::too_many_arguments)]
fn move_value(
    name: &str,
    kind: &str,
    rarity: i64,
    count: i64,
    damage: i64,
    attack: i64,
    speed: i64,
    defense: i64,
    health: i64,
) -> Move {
    Move {
        name: name.to_owned(),
        kind: kind.to_owned(),
        rarity,
        count,
        damage,
        attack,
        speed,
        defense,
        health,
        struggle: false,
    }
}

#[allow(clippy::too_many_lines)]
pub fn move_def(name: &str) -> Option<Move> {
    let values = match name {
        "Firenado" => ("fire", 1, 2, 5, 0, 2, -1, 0),
        "Campfire" => ("fire", 2, 3, 0, 2, -1, 3, 3),
        "Inferno" => ("fire", 2, 1, 6, 3, -1, -2, 0),
        "Flame Shield" => ("fire", 3, 2, 2, -1, 0, 4, 2),
        "Scorching Ash" => ("fire", 3, 2, 3, 1, 1, -2, 1),
        "Phoenix Burst" => ("fire", 3, 1, 4, 0, 2, 0, -2),
        "Tidal Wave" => ("water", 1, 2, 4, 2, 1, -1, 0),
        "Whirlpool" => ("water", 2, 3, 2, 0, 3, 2, -2),
        "Ice Spear" => ("water", 2, 1, 6, 2, 2, -1, 0),
        "Ocean Mist" => ("water", 3, 2, 0, 0, 2, 4, 2),
        "Frostbite" => ("water", 3, 2, 3, -1, 1, 2, 0),
        "Deep Current" => ("water", 3, 1, 3, 1, 3, -1, -1),
        "Tornado" => ("air", 1, 2, 4, 1, 4, -1, 0),
        "Wind Slash" => ("air", 2, 3, 2, 2, 3, -1, 0),
        "Storm Cloud" => ("air", 2, 1, 5, 2, 2, -1, 0),
        "Breeze" => ("air", 3, 2, 0, -1, 4, 2, 2),
        "Lightning Bolt" => ("air", 3, 2, 4, 2, -1, 0, -2),
        "Gale Force" => ("air", 3, 1, 3, 0, 5, -2, 0),
        "Boulder Crush" => ("rock", 1, 2, 5, 3, -2, 2, 0),
        "Stone Wall" => ("rock", 2, 3, 0, -1, -2, 6, 2),
        "Rock Slide" => ("rock", 2, 1, 7, 2, -1, -2, 0),
        "Earth Shield" => ("rock", 3, 2, 2, 0, -1, 5, 2),
        "Seismic Slam" => ("rock", 3, 2, 4, 3, 0, -1, -1),
        "Granite Barrier" => ("rock", 3, 1, 1, 0, -2, 6, 3),
        "Power Up" => ("boost", 1, 2, 0, 5, 2, -2, 0),
        "Iron Skin" => ("boost", 2, 2, 0, -1, 0, 5, 2),
        "Swift Wind" => ("boost", 2, 2, 0, 2, 5, -1, -1),
        "Battle Cry" => ("boost", 3, 2, 0, 4, 3, -2, -1),
        "Warrior's Resolve" => ("boost", 3, 2, 0, 3, 2, 0, -2),
        "Adrenaline Surge" => ("boost", 3, 1, 0, 6, -1, 0, -3),
        "Heal" => ("heal", 1, 2, 0, -1, 0, 0, 6),
        "Regenerate" => ("heal", 2, 3, 0, -2, 0, 2, 5),
        "Life Surge" => ("heal", 2, 1, 0, 1, 0, 0, 8),
        "Recovery" => ("heal", 3, 2, 0, 0, 2, 0, 5),
        "Vital Essence" => ("heal", 3, 2, 0, 0, -2, 4, 7),
        "Healing Winds" => ("heal", 3, 1, 0, 1, 3, 0, 4),
        "Body Slam" => ("normal", 1, 2, 5, 3, 0, 1, 0),
        "Quick Jab" => ("normal", 2, 3, 3, 2, 4, -1, 0),
        "Heavy Strike" => ("normal", 2, 1, 6, 4, -2, 2, 0),
        "Guard Break" => ("normal", 3, 2, 4, 2, -1, -2, 1),
        "Frenzy Blows" => ("normal", 3, 2, 2, 3, 2, -1, -1),
        "Momentum Shift" => ("normal", 3, 1, 0, 0, 5, -3, 3),
        _ => return None,
    };
    Some(move_value(
        name, values.0, values.1, values.2, values.3, values.4, values.5, values.6, values.7,
    ))
}

pub fn move_names(kind: &str) -> Vec<&'static str> {
    match kind {
        "fire" => vec![
            "Campfire",
            "Firenado",
            "Flame Shield",
            "Inferno",
            "Phoenix Burst",
            "Scorching Ash",
        ],
        "water" => vec![
            "Deep Current",
            "Frostbite",
            "Ice Spear",
            "Ocean Mist",
            "Tidal Wave",
            "Whirlpool",
        ],
        "air" => vec![
            "Breeze",
            "Gale Force",
            "Lightning Bolt",
            "Storm Cloud",
            "Tornado",
            "Wind Slash",
        ],
        "rock" => vec![
            "Boulder Crush",
            "Earth Shield",
            "Granite Barrier",
            "Rock Slide",
            "Seismic Slam",
            "Stone Wall",
        ],
        "boost" => vec![
            "Adrenaline Surge",
            "Battle Cry",
            "Iron Skin",
            "Power Up",
            "Swift Wind",
            "Warrior's Resolve",
        ],
        "heal" => vec![
            "Heal",
            "Healing Winds",
            "Life Surge",
            "Recovery",
            "Regenerate",
            "Vital Essence",
        ],
        "normal" => vec![
            "Body Slam",
            "Frenzy Blows",
            "Guard Break",
            "Heavy Strike",
            "Momentum Shift",
            "Quick Jab",
        ],
        _ => Vec::new(),
    }
}

pub fn validate_monster(monster: &Monster) -> Result<(), String> {
    if monster.name.is_empty() || monster.name.len() > 80 {
        return Err("monster.name is invalid".into());
    }
    if !matches!(
        monster.element_type.as_str(),
        "fire" | "water" | "air" | "rock" | "boost" | "heal" | "normal"
    ) {
        return Err("monster.elementType is invalid".into());
    }
    let stats = [
        monster.level,
        monster.attack,
        monster.defense,
        monster.speed,
    ];
    if stats.iter().any(|value| !(0..=100_000).contains(value))
        || !(1..=100_000).contains(&monster.health)
    {
        return Err("monster stats must be bounded integers".into());
    }
    if monster.moves.is_empty() || monster.moves.len() > 8 {
        return Err("monster must have between one and eight moves".into());
    }
    for (name, stored) in &monster.moves {
        if move_def(name).is_none() {
            return Err("monster contains an unknown move".into());
        }
        if !(1..=1000).contains(&stored.count) {
            return Err("monster move counts must be bounded integers".into());
        }
    }
    Ok(())
}

fn combatant(monster: &Monster, side: &str, address: &str) -> Combatant {
    let mut moves = BTreeMap::new();
    for (name, stored) in &monster.moves {
        if let Some(mut value) = move_def(name) {
            value.count = stored.count.max(1) * MOVE_USES;
            moves.insert(name.clone(), value);
        }
    }
    let max_health_points = monster.health.max(1) * HP_PER_HEALTH;
    let max_shield = monster.defense.max(0) * SHIELD_PER_DEFENSE;
    Combatant {
        name: monster.name.clone(),
        image: monster.image.clone(),
        sprite: monster.sprite.clone(),
        faction: monster.faction.clone(),
        element_type: monster.element_type.clone(),
        level: monster.level,
        attack: monster.attack,
        defense: monster.defense,
        speed: monster.speed,
        health: monster.health,
        moves,
        side: side.into(),
        address: address.into(),
        max_health_points,
        health_points: max_health_points,
        max_shield,
        shield: max_shield,
        base_attack: monster.attack,
        base_defense: monster.defense,
        base_speed: monster.speed,
    }
}

fn faction(
    name: &str,
) -> (
    &'static str,
    &'static str,
    &'static str,
    &'static str,
    &'static str,
) {
    match name {
        "Sky Nomads" => (
            "Sky Nomads",
            "air",
            "Airbud",
            "XD4tSBeekM1ETZMflAANDfkW6pVWaQIXgSdSiwfwVqw",
            "0_gQ7rNpxD8S4wZBE_DZs3adWfZMsBIuo8fwvH3SwL0",
        ),
        "Aqua Guardians" => (
            "Aqua Guardians",
            "water",
            "WaterDoge",
            "w_-mPdemSXZ1G-Q6fMEu6wTDJYFnJM9XePjGf_ZChgo",
            "p90BYY1O3BS3VVzdZETr-hG6jkA3kwo8l0h3aQ2UFoc",
        ),
        "Inferno Blades" => (
            "Inferno Blades",
            "fire",
            "FireFox",
            "lnYr9oTtkRHiheQFwH4ns50mrQE6AQR-8Bvl4VfXb0o",
            "wUo47CacsMRFFizJqUhSj75Rczg3f_MvHs4ytfPtCjQ",
        ),
        _ => (
            "Stone Titans",
            "rock",
            "Rockpup",
            "WhdcUkIGYZG4M5kq00TnUwaIt5OCGz3Q4u6_fZNktvQ",
            "Zt8LmHGVIziXhzjqBhEAWLuGetcDitFKbfaJROkyZks",
        ),
    }
}

fn choose(items: &[&'static str], rng: &mut Rng) -> &'static str {
    items[(rng.range(0, items.len() as i64 - 1)) as usize]
}

fn roll_moves(element: &str, rng: &mut Rng) -> BTreeMap<String, StoredMove> {
    let elemental = move_names(element);
    let mut selected = Vec::new();
    let first = choose(&elemental, rng);
    selected.push(first);
    if rng.range(1, 100) <= 25 {
        let remaining: Vec<_> = elemental
            .into_iter()
            .filter(|name| *name != first)
            .collect();
        selected.push(choose(&remaining, rng));
        let mut support = vec!["boost", "heal", "normal"];
        for _ in 0..2 {
            let index = rng.range(0, support.len() as i64 - 1) as usize;
            let kind = support.remove(index);
            selected.push(choose(&move_names(kind), rng));
        }
    } else {
        for kind in ["boost", "heal", "normal"] {
            selected.push(choose(&move_names(kind), rng));
        }
    }
    if !selected
        .iter()
        .any(|name| move_def(name).is_some_and(|value| value.damage > 0))
    {
        let mut hitters: Vec<_> = move_names(element)
            .into_iter()
            .chain(move_names("normal"))
            .filter(|name| move_def(name).is_some_and(|value| value.damage > 0))
            .collect();
        hitters.sort_unstable();
        let replacement = choose(&hitters, rng);
        let worst = selected
            .iter()
            .enumerate()
            .max_by_key(|(_, name)| move_def(name).map_or(0, |value| value.rarity))
            .map_or(0, |(index, _)| index);
        selected[worst] = replacement;
    }
    selected
        .into_iter()
        .filter_map(|name| {
            move_def(name).map(|value| (name.to_owned(), StoredMove { count: value.count }))
        })
        .collect()
}

pub fn make_opponent(
    level: i64,
    difficulty: f64,
    requested: Option<&str>,
    rng: &mut Rng,
) -> Monster {
    let faction_names = [
        "Sky Nomads",
        "Aqua Guardians",
        "Inferno Blades",
        "Stone Titans",
    ];
    let selected = requested
        .filter(|name| faction_names.contains(name))
        .unwrap_or_else(|| choose(&faction_names, rng));
    let (faction_name, element, monster_name, image, sprite) = faction(selected);
    let level = level.max(0);
    let budget = ((10.0 + level as f64 * 2.0) * difficulty).floor().max(4.0) as i64;
    let mut stats = [1_i64; 4];
    for _ in 0..(budget - 4) {
        stats[rng.range(0, 3) as usize] += 1;
    }
    Monster {
        name: monster_name.into(),
        image: Some(image.into()),
        sprite: Some(sprite.into()),
        faction: Some(faction_name.into()),
        element_type: element.into(),
        level,
        attack: stats[0],
        defense: stats[1],
        speed: stats[2],
        health: stats[3],
        moves: roll_moves(element, rng),
    }
}

pub fn new_battle(
    id: &str,
    challenger: &Monster,
    player_id: &str,
    opponent: &Monster,
    timestamp: i64,
) -> Battle {
    Battle {
        id: id.into(),
        kind: "bot".into(),
        status: "battling".into(),
        round: 0,
        turns: Vec::new(),
        started_at: timestamp,
        ended_at: None,
        cancelled_at: None,
        winner: None,
        timed_out: false,
        turns_trimmed: false,
        challenger: combatant(challenger, "challenger", player_id),
        accepter: combatant(opponent, "accepter", "npc"),
    }
}

fn struggle() -> Move {
    let mut value = move_value(
        "Struggle",
        "normal",
        0,
        i64::MAX,
        STRUGGLE_DAMAGE,
        0,
        0,
        0,
        0,
    );
    value.struggle = true;
    value
}

fn has_moves_left(monster: &Combatant) -> bool {
    monster.moves.values().any(|value| value.count > 0)
}

pub fn select_move(monster: &Combatant, name: &str) -> Result<Move, String> {
    if matches!(name, "struggle" | "Struggle") {
        return if has_moves_left(monster) {
            Err("Cannot struggle while other moves remain".into())
        } else {
            Ok(struggle())
        };
    }
    let value = monster
        .moves
        .get(name)
        .ok_or_else(|| format!("Unknown move '{name}'"))?;
    if value.count <= 0 {
        return Err(format!("'{name}' has no uses remaining"));
    }
    Ok(value.clone())
}

fn choose_npc_move(npc: &Combatant, opponent: &Combatant, rng: &mut Rng) -> Move {
    let available: Vec<_> = npc
        .moves
        .values()
        .filter(|value| value.count > 0)
        .cloned()
        .collect();
    if available.is_empty() {
        return struggle();
    }
    let hurt = npc.health_points as f64 <= npc.max_health_points as f64 * 0.35;
    let finishing = opponent.health_points as f64 <= opponent.max_health_points as f64 * 0.25;
    let preferred: Vec<_> = available
        .iter()
        .filter(|value| (finishing && value.damage > 0) || (hurt && !finishing && value.health > 0))
        .cloned()
        .collect();
    let pool = if preferred.is_empty() {
        &available
    } else {
        &preferred
    };
    pool[rng.range(0, pool.len() as i64 - 1) as usize].clone()
}

fn snapshot(monster: &Combatant) -> Snapshot {
    Snapshot {
        side: monster.side.clone(),
        name: monster.name.clone(),
        health_points: monster.health_points,
        max_health_points: monster.max_health_points,
        shield: monster.shield,
        max_shield: monster.max_shield,
        attack: monster.attack,
        defense: monster.defense,
        speed: monster.speed,
        element_type: monster.element_type.clone(),
    }
}

pub fn effectiveness(move_type: &str, defender: &str) -> f64 {
    match (move_type, defender) {
        ("fire", "water") | ("water", "rock") | ("air", "fire") | ("rock", "air") => 0.5,
        ("fire", "air") | ("water", "fire") | ("air", "water") | ("rock", "rock") => 2.0,
        _ => 1.0,
    }
}

pub fn hit_chance(attacker_speed: i64, defender_speed: i64) -> f64 {
    let diff = attacker_speed.max(0) - defender_speed.max(0);
    let modifier = if diff > 0 {
        (diff as f64 * 0.08).min(0.25)
    } else {
        (diff as f64 * 0.10).max(-0.40)
    };
    (BASE_HIT_CHANCE + modifier).clamp(MIN_HIT_CHANCE, MAX_HIT_CHANCE)
}

fn use_move(attacker: &mut Combatant, selected: &Move) {
    if !selected.struggle {
        if let Some(value) = attacker.moves.get_mut(&selected.name) {
            value.count = (value.count - 1).max(0);
        }
    }
}

fn act(attacker: &mut Combatant, defender: &mut Combatant, selected: &Move, rng: &mut Rng) -> Turn {
    use_move(attacker, selected);
    let mut missed = false;
    let mut critical = false;
    let mut shield_damage = 0;
    let mut health_damage = 0;
    let mut super_effective = false;
    let mut not_effective = false;
    let mut stats_changed = BTreeMap::new();
    if selected.damage > 0
        && rng.range(1, 100) as f64 > hit_chance(attacker.speed, defender.speed) * 100.0
    {
        missed = true;
    } else {
        if selected.damage > 0 {
            let multiplier = effectiveness(&selected.kind, &defender.element_type);
            let raw = selected.damage * (ATTACK_BASE + attacker.attack.max(0));
            let swing = 1.0 + ((rng.range(0, 200) - 100) as f64 / 100.0) * VARIANCE;
            // Drawn immediately after the swing, as in Lua, so the two runtimes
            // stay in step on the RNG stream as well as on the arithmetic.
            critical = rng.range(1, 100) <= (CRITICAL_CHANCE * 100.0).floor() as i64;
            let crit = if critical { CRITICAL_MULTIPLIER } else { 1.0 };
            let mut damage = ((raw as f64) * multiplier * swing * crit)
                .floor()
                .max(1.0) as i64;
            shield_damage = damage.min(defender.shield.max(0));
            defender.shield -= shield_damage;
            damage -= shield_damage;
            if damage > 0 {
                // Lua reports the attempted post-shield damage even when it
                // overkills; only the resulting HP is clamped to zero.
                health_damage = damage;
                defender.health_points = (defender.health_points - damage).max(0);
            }
            super_effective = multiplier > 1.0;
            not_effective = multiplier < 1.0;
        }
        if selected.attack != 0 {
            attacker.attack = (attacker.attack + selected.attack).max(0);
            stats_changed.insert("attack".into(), selected.attack);
        }
        if selected.speed != 0 {
            attacker.speed = (attacker.speed + selected.speed).max(0);
            stats_changed.insert("speed".into(), selected.speed);
        }
        if selected.defense != 0 {
            attacker.defense = (attacker.defense + selected.defense).max(0);
            attacker.max_shield = attacker
                .max_shield
                .max(attacker.defense * SHIELD_PER_DEFENSE);
            attacker.shield = (attacker.shield + selected.defense * SHIELD_PER_DEFENSE).max(0);
            stats_changed.insert("defense".into(), selected.defense);
        }
        if selected.health != 0 {
            let delta =
                (selected.health as f64 * HEAL_PER_POINT * attacker.max_health_points as f64)
                    .floor() as i64;
            attacker.health_points = if delta > 0 {
                (attacker.health_points + delta).min(attacker.max_health_points)
            } else {
                (attacker.health_points + delta).max(1)
            };
            stats_changed.insert("health".into(), selected.health);
        }
    }
    Turn {
        attacker: attacker.side.clone(),
        attacker_address: attacker.address.clone(),
        monster_name: attacker.name.clone(),
        move_name: selected.name.clone(),
        move_type: selected.kind.clone(),
        move_rarity: selected.rarity,
        missed,
        critical,
        shield_damage,
        health_damage,
        stats_changed,
        super_effective,
        not_effective,
        attacker_state: snapshot(attacker),
        defender_state: snapshot(defender),
        round: 0,
    }
}

pub fn resolve_round(battle: &mut Battle, player_move: &str, rng: &mut Rng) -> Result<(), String> {
    let challenger_move = select_move(&battle.challenger, player_move)?;
    let npc_move = choose_npc_move(&battle.accepter, &battle.challenger, rng);
    let a_roll = battle.challenger.speed + rng.range(1, 5);
    let b_roll = battle.accepter.speed + rng.range(1, 5);
    let challenger_first = if a_roll == b_roll {
        rng.range(1, 2) == 1
    } else {
        a_roll > b_roll
    };
    let mut entries = Vec::with_capacity(2);
    if challenger_first {
        entries.push(act(
            &mut battle.challenger,
            &mut battle.accepter,
            &challenger_move,
            rng,
        ));
        if battle.accepter.health_points > 0 {
            entries.push(act(
                &mut battle.accepter,
                &mut battle.challenger,
                &npc_move,
                rng,
            ));
        }
    } else {
        entries.push(act(
            &mut battle.accepter,
            &mut battle.challenger,
            &npc_move,
            rng,
        ));
        if battle.challenger.health_points > 0 {
            entries.push(act(
                &mut battle.challenger,
                &mut battle.accepter,
                &challenger_move,
                rng,
            ));
        }
    }
    battle.round += 1;
    for mut entry in entries {
        entry.round = battle.round;
        battle.turns.push(entry);
    }
    // Only an untouched fighter recovers shield, exactly as in battle.lua: a
    // miss is not a hit, and a blow that dealt nothing is not a hit either.
    let mut challenger_hit = false;
    let mut accepter_hit = false;
    for entry in battle.turns.iter().filter(|t| t.round == battle.round) {
        if entry.missed || entry.shield_damage + entry.health_damage <= 0 {
            continue;
        }
        if entry.attacker == "challenger" {
            accepter_hit = true;
        } else {
            challenger_hit = true;
        }
    }
    for (monster, was_hit) in [
        (&mut battle.challenger, challenger_hit),
        (&mut battle.accepter, accepter_hit),
    ] {
        if monster.health_points > 0 && !was_hit {
            let regen = (monster.max_shield as f64 * SHIELD_REGEN_SHARE).ceil() as i64;
            monster.shield = (monster.shield + regen).min(monster.max_shield);
        }
    }
    if battle.challenger.health_points <= 0 || battle.accepter.health_points <= 0 {
        battle.status = "ended".into();
        battle.winner = Some(
            if battle.accepter.health_points <= 0 && battle.challenger.health_points > 0 {
                "challenger"
            } else {
                "accepter"
            }
            .into(),
        );
    } else if battle.round >= ROUND_CAP {
        battle.status = "ended".into();
        battle.timed_out = true;
        let challenger_share = battle.challenger.health_points as f64
            / battle.challenger.max_health_points.max(1) as f64;
        let accepter_share =
            battle.accepter.health_points as f64 / battle.accepter.max_health_points.max(1) as f64;
        battle.winner = Some(
            if challenger_share > accepter_share {
                "challenger"
            } else {
                "accepter"
            }
            .into(),
        );
    }
    let keep = ROUND_CAP as usize * 2;
    if battle.turns.len() > keep {
        battle.turns.drain(0..battle.turns.len() - keep);
        battle.turns_trimmed = true;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_monster() -> Monster {
        Monster {
            name: "FireFox".into(),
            image: None,
            sprite: None,
            faction: Some("Inferno Blades".into()),
            element_type: "fire".into(),
            level: 2,
            attack: 4,
            defense: 3,
            speed: 2,
            health: 4,
            moves: BTreeMap::from([
                ("Firenado".into(), StoredMove { count: 2 }),
                ("Heal".into(), StoredMove { count: 2 }),
            ]),
        }
    }

    #[test]
    fn all_lua_moves_are_ported() {
        let total: usize = ["fire", "water", "air", "rock", "boost", "heal", "normal"]
            .iter()
            .map(|kind| move_names(kind).len())
            .sum();
        assert_eq!(total, 42);
        for kind in ["fire", "water", "air", "rock", "boost", "heal", "normal"] {
            for name in move_names(kind) {
                assert_eq!(move_def(name).unwrap().kind, kind);
            }
        }
    }

    #[test]
    fn effectiveness_and_speed_match_lua_rules() {
        assert_eq!(effectiveness("fire", "air"), 2.0);
        assert_eq!(effectiveness("fire", "water"), 0.5);
        assert_eq!(effectiveness("boost", "water"), 1.0);
        assert_eq!(hit_chance(20, 1), 0.95);
        assert_eq!(hit_chance(1, 20), 0.30);
    }

    #[test]
    fn xorshift32_vector_matches_lua_fleet_stream() {
        let mut rng = Rng::seeded("ticket/assignment/open");
        assert_eq!(rng.next(), 2_552_783_038);
        assert_eq!(rng.next(), 331_529_857);
        assert_eq!(rng.next(), 3_326_422_408);
        assert_eq!(rng.next(), 494_375_474);
        assert_eq!(rng.next(), 151_326_954);
    }

    #[test]
    fn battle_is_bounded_and_deterministic() {
        let monster = test_monster();
        let mut open_rng = Rng::seeded("ticket/assignment/open");
        let opponent = make_opponent(monster.level, 1.0, Some("Aqua Guardians"), &mut open_rng);
        let mut left = new_battle("battle-1", &monster, "player", &opponent, 10);
        let mut right = left.clone();
        for round in 0..ROUND_CAP {
            if left.status == "ended" {
                break;
            }
            let move_name = left
                .challenger
                .moves
                .iter()
                .find(|(_, value)| value.count > 0)
                .map_or("struggle", |(name, _)| name.as_str())
                .to_owned();
            let mut left_rng = Rng::seeded(&format!("ticket/assignment/round:{round}"));
            let mut right_rng = Rng::seeded(&format!("ticket/assignment/round:{round}"));
            resolve_round(&mut left, &move_name, &mut left_rng).unwrap();
            resolve_round(&mut right, &move_name, &mut right_rng).unwrap();
            assert_eq!(left, right);
        }
        assert_eq!(left.status, "ended");
        assert!(left.round <= ROUND_CAP);
        assert!(left.turns.len() <= ROUND_CAP as usize * 2);
    }
}
