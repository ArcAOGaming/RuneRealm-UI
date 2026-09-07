/**
 * cli.mjs — render a card to a file, without a wallet or a network.
 *
 *   node backend/native/card/cli.mjs --element fire --level 7 --out card.png
 *   node backend/native/card/cli.mjs --player <address> --out card.png
 *   node backend/native/card/cli.mjs --all --out cards/
 *
 * `--player` pulls the live record straight off the process, which is a plain
 * unsigned GET, so this is also the fastest way to see what a given wallet
 * would actually mint. `--all` renders the four factions at three tiers — the
 * sheet to look at after touching layout or art.
 */
import fs from 'node:fs';
import path from 'node:path';

import { renderCardPng } from './render.mjs';

/** Levels worth eyeballing: fresh, mid, and deep enough for three digits. */
const SAMPLE_LEVELS = [1, 9, 27];

const NODE = process.env.NODE_URL || 'https://schedule.forward.computer';
const PROCESS = process.env.GAME_PROCESS || 'OsXIDsSqe_G6GXahPzPjJFGWcDdoMXwhnzW8sj6S1K8';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const has = (name) => argv.includes(`--${name}`);

const FACTION = {
  // Three moves as [name, type, rarity], and the first of each is that species'
  // own `basicMove` from the monster index -- the slot `Battle.rollMoves`
  // guarantees, so a sample carrying anything else is a companion the game
  // cannot issue.
  //
  // The rarity is here because the card orders its rows by it: a fixture that
  // omits it renders in a different order from every real companion, which is
  // the one thing an offline preview must not do. The types used to be guessed
  // from a hardcoded list of four heal names, which had already gone stale.
  fire: { name: 'FireFox', moves: [['Scorching Ash', 'fire', 2], ['Firenado', 'fire', 1], ['Recovery', 'heal', 2]] },
  water: { name: 'WaterDoge', moves: [['Whirlpool', 'water', 2], ['Tidal Wave', 'water', 1], ['Iron Skin', 'boost', 2]] },
  air: { name: 'Airbud', moves: [['Wind Slash', 'air', 2], ['Tornado', 'air', 1], ['Regenerate', 'heal', 2]] },
  rock: { name: 'Rockpup', moves: [['Boulder Crush', 'rock', 1], ['Earth Shield', 'rock', 3], ['Life Surge', 'heal', 1]] },
};

/** A record shaped like the one the process publishes, for offline rendering. */
function sample(element, level) {
  const f = FACTION[element];
  const moves = {};
  for (const [name, type, rarity] of f.moves) moves[name] = { type, rarity };
  return {
    name: f.name, elementType: element, level,
    attack: 12 + level, speed: 9 + level, defense: 11 + level, health: 40 + level * 3,
    moves,
  };
}

/**
 * A player record, straight off the process.
 *
 * Plain GET, no `accept` header: asking for JSON gets the node's own envelope
 * with the record as a STRING inside it, and the companion then reads as
 * missing on a wallet that plainly has one.
 */
async function readPlayer(address) {
  const url = `${NODE}/${PROCESS}~process@1.0/now/player-${address}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`read ${address}: ${res.status}`);
  const text = (await res.text()).trim();
  if (!text || text === 'null') throw new Error(`${address} has no record`);
  const record = JSON.parse(text);
  // The published record no longer carries `monster`: it was the same object as
  // `monsters[activeId]` and the encoder wrote it twice, 14% of every published
  // player byte on a map every message pays for five times. `activeId` is
  // published beside it, so the active companion is a pure function of what did
  // arrive. A record from a process deployed before that change still has it.
  const active = record?.monster ?? record?.monsters?.[record?.activeId];
  if (!active) throw new Error(`${address} has no companion`);
  return { monster: active, inventory: record.inventory ?? {} };
}

const out = flag('out', 'card.png');

/**
 * `--extended` widens the card to 1065 and adds the side panel. It is NOT what
 * gets minted — the mint stays the portrait card — so this is here to look at
 * the panel, not to produce one.
 */
const CARD_OPTS = { extended: has('extended') };

/** A satchel to show off the panel when there is no live player to read. */
const SAMPLE_BAG = {
  fire_berry: 18, water_berry: 9, air_berry: 21, rock_berry: 18,
  fire_berry: 6, scroll: 2, rune: 9,
};

if (has('all')) {
  fs.mkdirSync(out, { recursive: true });
  for (const element of Object.keys(FACTION)) {
    for (const level of SAMPLE_LEVELS) {
      const file = path.join(out, `${element}-${level}.png`);
      fs.writeFileSync(file, renderCardPng(sample(element, level), { ...CARD_OPTS, inventory: SAMPLE_BAG }));
      console.log(file);
    }
  }
} else if (has('player')) {
  const { monster, inventory } = await readPlayer(flag('player'));
  fs.writeFileSync(out, renderCardPng(monster, { ...CARD_OPTS, inventory }));
  console.log(`${out}  ${monster.name} lvl ${monster.level}`);
} else {
  const png = renderCardPng(sample(flag('element', 'fire'), Number(flag('level', 1))),
    { ...CARD_OPTS, inventory: SAMPLE_BAG });
  fs.writeFileSync(out, png);
  console.log(`${out}  ${png.length} bytes`);
}
