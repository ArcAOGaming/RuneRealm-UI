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
  fire: { name: 'FireFox', moves: ['Firenado', 'Flame Shield', 'Power Up', 'Recovery'] },
  water: { name: 'WaterDoge', moves: ['Tidal Wave', 'Ocean Mist', 'Iron Skin', 'Heal'] },
  air: { name: 'Airbud', moves: ['Tornado', 'Breeze', 'Battle Cry', 'Regenerate'] },
  rock: { name: 'Rockpup', moves: ['Boulder Crush', 'Stone Wall', 'Swift Wind', 'Life Surge'] },
};

/** A record shaped like the one the process publishes, for offline rendering. */
function sample(element, level) {
  const f = FACTION[element];
  const moves = {};
  for (const name of f.moves) {
    moves[name] = { type: name in { Heal: 1, Recovery: 1, Regenerate: 1, 'Life Surge': 1 } ? 'heal' : 'boost' };
  }
  // The first two are the element's own; the layout puts those in the top row.
  moves[f.moves[0]] = { type: element };
  moves[f.moves[1]] = { type: element };
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
  if (!record?.monster) throw new Error(`${address} has no companion`);
  return { monster: record.monster, inventory: record.inventory ?? {} };
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
  emerald: 1, scroll: 2, rune: 9,
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
