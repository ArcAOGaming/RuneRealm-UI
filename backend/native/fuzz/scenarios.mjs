/**
 * Adversarial sequences that must always run.
 *
 * The random phase covers breadth: it will eventually put a companion in every
 * place and try every verb against it. What it will not reliably do is arrive
 * at a specific hostile ORDER — sell the thing, then have the seller cancel the
 * listing the buyer now owns; empty an account completely and adopt again; take
 * a state export and load it back over the account it came from. Those need a
 * particular sequence of five or six steps, and waiting for a seeded shuffle to
 * produce one is not a test strategy.
 *
 * So they are written down. Each scenario builds its own situation from scratch
 * against fresh accounts, makes its claim, and reports through the same finding
 * sink as the fuzz loop. They run before the random phase and cost a few
 * hundred messages in total.
 *
 * A scenario asserts BEHAVIOUR, not implementation. "A sold listing cannot be
 * cancelled by the seller" stays true however the marketplace is rewritten;
 * "Market[id] is nil afterwards" would not.
 */
import { rosterIds, collectionIds, runes, fingerprint } from './world.mjs';

/** Distinct from the fuzz-loop addresses, so a scenario never disturbs the soak. */
const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
export function scenarioAddress(tag, index) {
  const stem = `SCEN${tag}${index}`.slice(0, 12);
  let out = stem;
  let n = (index + 1) * 2246822519;
  for (const character of stem) n = (n ^ character.charCodeAt(0)) * 16777619 >>> 0;
  while (out.length < 43) {
    n = (n * 1103515245 + 12345) >>> 0;
    out += ALPHABET[n % ALPHABET.length];
  }
  return out.slice(0, 43);
}

const FACTIONS = ['Sky Nomads', 'Aqua Guardians', 'Inferno Blades', 'Stone Titans'];

/**
 * A scenario's toolkit.
 *
 * `refused` and `accepted` are the whole vocabulary. Everything a scenario
 * claims is one of those two about one message, or a statement about state read
 * back afterwards — which keeps a failing scenario readable as a sentence.
 */
function toolkit(ctx, scenario) {
  const claims = [];
  const claim = (ok, message, detail) => {
    claims.push({ ok, message });
    if (!ok) ctx.finding('critical', 'scenario', `${scenario}: ${message}`, { scenario, detail });
    return ok;
  };
  return {
    claim,
    async refused(label, from, tags) {
      const reply = await ctx.send(from, tags);
      return claim(Boolean(reply.body?.error), `${label} must be refused`,
        { got: reply.body?.error ?? 'accepted' });
    },
    async accepted(label, from, tags) {
      const reply = await ctx.send(from, tags);
      claim(!reply.body?.error, `${label} must be allowed`, { got: reply.body?.error });
      return reply;
    },
    claims,
  };
}

/**
 * Bring `count` fresh accounts online with a companion and some runes.
 *
 * One message each. Swearing hands over the starter in the same turn, so there
 * is no separate adoption step any more — and there is no longer a state in
 * which an account belongs to a faction and holds nothing, which is exactly
 * why the two were merged.
 */
async function cast(ctx, tag, count, { runes: runeCount = 200 } = {}) {
  const people = [];
  for (let index = 0; index < count; index++) {
    const address = scenarioAddress(tag, index);
    await ctx.send(ctx.owner, { Action: 'Admin.Unlock', Addresses: address });
    const sworn = await ctx.send(address,
      { Action: 'Faction.Join', Faction: FACTIONS[index % FACTIONS.length] });
    if (sworn.body?.monster) ctx.created(1);
    await ctx.send(ctx.owner, {
      Action: 'Admin.AdjustInventory', PlayerId: address, Item: 'rune',
      Amount: String(runeCount),
    });
    people.push(address);
  }
  return people;
}

/** Put a companion of `who`'s in the collection, returning its id. */
async function intoCollection(ctx, who) {
  const before = await ctx.readFresh(who);
  const id = rosterIds(before)[0];
  if (!id) return collectionIds(before)[0] ?? null;
  await ctx.send(who, { Action: 'Monster.Store', MonsterId: id });
  return id;
}

// ---------------------------------------------------------------------------

/**
 * Adoption is meant to be once per account.
 *
 * The handler enforces that by checking the roster and the collection are both
 * empty, which is a different rule: give the only companion away and both are
 * empty again. Two wallets passing one creature back and forth would then draw
 * a fresh one every round for the price of the storage rune, which is exactly
 * the unbounded free supply the handler's own comment says must not exist.
 */
async function adoptRefill(ctx) {
  const t = toolkit(ctx, 'adopt-refill');
  const [giver, taker] = await cast(ctx, 'AR', 2);
  const id = await intoCollection(ctx, giver);
  await t.accepted('giving the only companion away', giver,
    { Action: 'Monster.Transfer', MonsterId: id, Recipient: taker });

  const emptied = await ctx.readFresh(giver);
  t.claim(rosterIds(emptied).length === 0 && collectionIds(emptied).length === 0,
    'the giver should now hold nothing');

  const again = await ctx.send(giver, { Action: 'Monster.Adopt' });
  if (!again.body?.error) {
    ctx.created(1);
    t.claim(false, 'an emptied account adopted a second companion — '
      + 'two wallets can pass one creature back and forth and draw a new one every round');
  } else {
    t.claim(true, 'an emptied account cannot adopt again');
  }

  // Being GIVEN a companion is not the same as having spent your one.
  //
  // The starter now comes with the oath, so the account that has not spent its
  // adoption is one that has NOT SWORN yet — an address that has been unlocked
  // and nothing more. Handing it a companion first must not consume the oath,
  // because an earlier version of this rule refused anyone currently holding
  // anything, which quietly confiscated the starter of a player who happened to
  // be given a creature before they got round to swearing.
  const newcomer = scenarioAddress('ARN', 1);
  await ctx.send(ctx.owner, { Action: 'Admin.Unlock', Addresses: newcomer });
  await ctx.send(ctx.owner, {
    Action: 'Admin.AdjustInventory', PlayerId: taker, Item: 'rune', Amount: '10',
  });
  const held = await ctx.readFresh(taker);
  const gift = collectionIds(held)[0];
  if (gift) {
    await t.accepted('handing the gift on to somebody who has not sworn yet', taker,
      { Action: 'Monster.Transfer', MonsterId: gift, Recipient: newcomer });
    const receiver = await ctx.readFresh(newcomer);
    t.claim(receiver?.adopted !== true,
      'receiving a companion must not mark the newcomer as having adopted');
    t.claim(collectionIds(receiver).length > 0, 'and they must actually have it');
    t.claim(!receiver?.faction,
      'and it must not have sworn them to a faction on their behalf');

    const sworn = await ctx.send(newcomer,
      { Action: 'Faction.Join', Faction: 'Inferno Blades' });
    if (sworn.body?.monster) ctx.created(1);
    t.claim(!sworn.body?.error, 'a holder of a gift may still swear');
    t.claim(Boolean(sworn.body?.monster),
      'and swearing must still hand them their own starter');
    t.claim(sworn.body?.adopted === true, 'which spends the oath');

    // And the old door stays shut behind them.
    t.claim(Boolean((await ctx.send(newcomer, { Action: 'Monster.Adopt' })).body?.error),
      'after which Monster.Adopt is refused');
    t.claim(Boolean((await ctx.send(newcomer,
      { Action: 'Faction.Join', Faction: 'Sky Nomads' })).body?.error),
      'and the oath cannot be sworn twice');
  }
  return t.claims;
}

/**
 * Swearing is the whole of onboarding.
 *
 * It used to be two messages with a gap between them, and the gap was a real
 * state: an account sworn to a faction, holding nothing, able to do none of the
 * things the game is about. Everything that reads a player had to handle it.
 * This asserts the gap is gone — not that the two messages both work, but that
 * there is only one, and that what comes back from it can immediately play.
 */
async function swearingIsArrival(ctx) {
  const t = toolkit(ctx, 'swearing-is-arrival');
  const address = scenarioAddress('SW', 1);
  await ctx.send(ctx.owner, { Action: 'Admin.Unlock', Addresses: address });

  const blank = await ctx.readFresh(address);
  t.claim(!blank?.faction && !blank?.monster,
    'an unlocked address starts with no faction and no companion');
  t.claim(Boolean((await ctx.send(address, { Action: 'Monster.Quest' })).body?.error),
    'and cannot play before swearing');

  const sworn = await ctx.send(address, { Action: 'Faction.Join', Faction: 'Aqua Guardians' });
  if (sworn.body?.monster) ctx.created(1);
  t.claim(!sworn.body?.error, 'swearing is accepted');
  const view = sworn.body ?? {};
  t.claim(view.faction === 'Aqua Guardians', 'the oath is recorded');
  t.claim(Boolean(view.monster), 'and the companion arrives in the same reply');
  t.claim(view.adopted === true, 'and the oath is marked spent');
  t.claim(view.activeId && view.monsters?.[view.activeId],
    'the companion is a roster entry, not a loose record');
  t.claim(view.monster?.elementType === 'water',
    'and it matches the faction that was sworn to');

  // Rune may never multiply with wallet count. Arrival includes ordinary
  // starter play, but the fixed global Rune budget is a separate policy.
  t.claim(Number(view.inventory?.rune ?? 0) === 0, 'without a per-wallet Rune faucet');
  t.claim((view.lootboxes?.length ?? 0) > 0, 'and loot boxes to open');
  const loot = await ctx.send(address, { Action: 'Lootbox.Open' });
  t.claim(!loot.body?.error,
    `and can open starter loot on the very next message (${loot.body?.error ?? 'ok'})`);

  t.claim(Boolean((await ctx.send(address,
    { Action: 'Faction.Join', Faction: 'Stone Titans' })).body?.error),
    'a second oath is refused');
  return t.claims;
}

/**
 * A listed companion is in escrow and in nobody's collection.
 *
 * Everything that acts on a companion by id has to agree about that, or the
 * same creature is both for sale and in use.
 */
async function escrowExclusivity(ctx) {
  const t = toolkit(ctx, 'escrow-exclusivity');
  const [seller] = await cast(ctx, 'EX', 1);
  const id = await intoCollection(ctx, seller);
  const listed = await t.accepted('listing a stored companion', seller,
    { Action: 'Market.List', MonsterId: id, Price: '30' });
  const listingId = listed.body?.listing?.id;
  t.claim(Boolean(listingId), 'listing must come back with an id');

  await t.refused('retrieving a listed companion', seller,
    { Action: 'Monster.Retrieve', MonsterId: id });
  await t.refused('storing a listed companion', seller,
    { Action: 'Monster.Store', MonsterId: id });
  await t.refused('making a listed companion active', seller,
    { Action: 'Monster.SetActive', MonsterId: id });
  await t.refused('transferring a listed companion', seller,
    { Action: 'Monster.Transfer', MonsterId: id, Recipient: scenarioAddress('EX', 9) });
  await t.refused('listing it a second time', seller,
    { Action: 'Market.List', MonsterId: id, Price: '40' });

  const held = await ctx.readFresh(seller);
  t.claim(!held.collection?.[id] && !held.monsters?.[id],
    'a listed companion must be in neither the roster nor the collection');

  const cancelled = await t.accepted('cancelling the listing', seller,
    { Action: 'Market.Cancel', ListingId: listingId });
  t.claim(collectionIds(cancelled.body).length === 1,
    'cancelling must return exactly one companion to the collection');
  return t.claims;
}

/** A companion can only be sold once, and only the runes for one sale move. */
async function doubleSpend(ctx) {
  const t = toolkit(ctx, 'double-spend');
  const [seller, first, second] = await cast(ctx, 'DS', 3);
  const id = await intoCollection(ctx, seller);
  const listed = await t.accepted('listing', seller,
    { Action: 'Market.List', MonsterId: id, Price: '25' });
  const listingId = listed.body?.listing?.id;

  const buyerBefore = await ctx.readFresh(second);
  await t.accepted('the first buyer', first, { Action: 'Market.Buy', ListingId: listingId });
  await t.refused('the second buyer on the same listing', second,
    { Action: 'Market.Buy', ListingId: listingId });

  const buyerAfter = await ctx.readFresh(second);
  t.claim(runes(buyerAfter) === runes(buyerBefore),
    'a buyer who lost the race must not be debited');
  t.claim(collectionIds(buyerAfter).length === collectionIds(buyerBefore).length,
    'a buyer who lost the race must not receive a companion');

  await t.refused('the seller cancelling a listing that has sold', seller,
    { Action: 'Market.Cancel', ListingId: listingId });
  const sellerAfter = await ctx.readFresh(seller);
  t.claim(collectionIds(sellerAfter).length === 0,
    'a sold companion must not come back to the seller');
  return t.claims;
}

/** The roster cap is a cap, from every direction that can fill it. */
async function rosterCap(ctx) {
  const t = toolkit(ctx, 'roster-cap');
  const [player] = await cast(ctx, 'RC', 1);
  const view = await ctx.readFresh(player);
  const cap = Number(view.rosterMax ?? 1);

  // Fill the roster through the owner door, then top the collection up so
  // there is always something left to try to retrieve.
  for (let n = rosterIds(view).length; n < cap; n++) {
    await ctx.send(ctx.owner, {
      Action: 'Admin.CreateMonster', PlayerId: player,
      Faction: 'Stone Titans', Into: 'roster',
    });
    ctx.created(1);
  }
  await ctx.send(ctx.owner, {
    Action: 'Admin.CreateMonster', PlayerId: player,
    Faction: 'Stone Titans', Into: 'collection',
  });
  ctx.created(1);

  const full = await ctx.readFresh(player);
  t.claim(rosterIds(full).length === cap, `the roster should hold exactly ${cap}`);
  const spare = collectionIds(full)[0];
  await t.refused('retrieving into a full roster', player,
    { Action: 'Monster.Retrieve', MonsterId: spare });

  const after = await ctx.readFresh(player);
  t.claim(rosterIds(after).length === cap, 'a refused retrieve must not grow the roster');
  t.claim(Boolean(after.collection?.[spare]),
    'a refused retrieve must leave the companion in the collection');
  return t.claims;
}

/** A companion in a fight cannot be swapped out or filed away mid-round. */
async function battleSwap(ctx) {
  const t = toolkit(ctx, 'battle-swap');
  const [player] = await cast(ctx, 'BS', 1);
  await ctx.send(ctx.owner, {
    Action: 'Admin.CreateMonster', PlayerId: player, Faction: 'Inferno Blades', Into: 'roster',
  });
  ctx.created(1);

  const ready = await ctx.readFresh(player);
  if (collectionIds(ready).length < 1) {
    t.claim(false, 'the scenario needs a collection companion to swap to');
    return t.claims;
  }
  const entered = await ctx.send(player, { Action: 'Battle.Begin' });
  if (entered.body?.error) {
    t.claim(false, `entering the arena failed: ${entered.body.error}`);
    return t.claims;
  }
  const started = await ctx.send(player, { Action: 'Battle.Start', Difficulty: '1' });
  if (started.body?.error) {
    t.claim(false, `starting a bot battle failed: ${started.body.error}`);
    return t.claims;
  }

  const fighting = await ctx.readFresh(player);
  const other = collectionIds(fighting)[0];
  await t.refused('swapping the active companion mid-battle', player,
    { Action: 'Monster.SetActive', MonsterId: other });
  await t.refused('storing the companion that is fighting', player,
    { Action: 'Monster.Store', MonsterId: fighting.activeId });

  const still = await ctx.readFresh(player);
  t.claim(still.activeId === fighting.activeId,
    'the companion in the fight must still be the active one');
  await ctx.send(player, { Action: 'Battle.Leave' });
  return t.claims;
}

/**
 * A companion sent to an address that has never played.
 *
 * `Monster.Transfer` mints a record for whatever address it is handed, so this
 * is allowed. It must still be a MOVE: the creature has to be somewhere
 * afterwards, and the population has to be unchanged.
 */
async function transferToStranger(ctx) {
  const t = toolkit(ctx, 'transfer-to-stranger');
  const [giver] = await cast(ctx, 'TS', 1);
  const stranger = scenarioAddress('TSX', 1);
  const id = await intoCollection(ctx, giver);
  const before = await ctx.readFresh(giver);
  const print = fingerprint(before.collection?.[id]);

  await t.accepted('handing a companion to an address that has never played', giver,
    { Action: 'Monster.Transfer', MonsterId: id, Recipient: stranger });

  const theirs = await ctx.readFresh(stranger);
  const arrived = Object.values(theirs?.collection ?? {})
    .some((monster) => fingerprint(monster) === print);
  t.claim(arrived, 'the companion must exist in the stranger account, not vanish');
  const mine = await ctx.readFresh(giver);
  t.claim(!mine.collection?.[id], 'the sender must not still hold it');
  return t.claims;
}

/**
 * A state migration must not lose or duplicate anything.
 *
 * `Admin.Export` and `Admin.Load` are how a redeploy carries players onto a new
 * process, and a redeploy is not a rare event here. Loading an export back over
 * the accounts it came from is the strongest cheap check available: nothing has
 * changed in between, so every roster, every collection and every listing must
 * come back identical. Anything the export does not carry shows up as a
 * companion that was there before the load and is not there after.
 */
async function exportReload(ctx) {
  const t = toolkit(ctx, 'export-reload');
  const [owner1, owner2] = await cast(ctx, 'ER', 2);
  // One in the roster, one in the collection, one in escrow: the three places
  // a companion can be, so a migration that only knows about one is caught.
  await ctx.send(ctx.owner, {
    Action: 'Admin.CreateMonster', PlayerId: owner1, Faction: 'Aqua Guardians', Into: 'collection',
  });
  ctx.created(1);
  const stored = await intoCollection(ctx, owner2);
  const listed = await ctx.send(owner2, { Action: 'Market.List', MonsterId: stored, Price: '12' });
  const listingId = listed.body?.listing?.id;

  const before = {
    one: await ctx.readFresh(owner1),
    two: await ctx.readFresh(owner2),
  };
  const beforeCounts = {
    one: rosterIds(before.one).length + collectionIds(before.one).length,
    two: rosterIds(before.two).length + collectionIds(before.two).length,
  };

  // The export is paged and sorted by address, and a run has more accounts
  // than one page holds. Walk it rather than assuming these two land on the
  // first page — which they will, right up until somebody adds a wallet.
  const mine = [];
  for (let offset = 0; offset < 2000; offset += 50) {
    const page = await ctx.send(ctx.owner, {
      Action: 'Admin.Export', Offset: String(offset), Limit: '50',
    });
    const rows = page.body?.players;
    if (!Array.isArray(rows)) {
      t.claim(false, `Admin.Export did not return players: ${page.body?.error ?? 'no rows'}`);
      return t.claims;
    }
    for (const row of rows) {
      if (row.address === owner1 || row.address === owner2) mine.push(row);
    }
    if (page.body.done || rows.length === 0) break;
  }
  t.claim(mine.length === 2, 'the export must contain both scenario accounts');
  if (mine.length !== 2) return t.claims;

  const carries = (row) => row && (row.monsters || row.collection);
  t.claim(mine.every(carries),
    'an exported row must carry the roster and the collection, or a redeploy '
    + 'restores every player with whatever single companion `monster` happened to hold');

  await ctx.send(ctx.owner, { Action: 'Admin.Load' }, JSON.stringify({ players: mine }));

  const after = {
    one: await ctx.readFresh(owner1),
    two: await ctx.readFresh(owner2),
  };
  const afterCounts = {
    one: rosterIds(after.one).length + collectionIds(after.one).length,
    two: rosterIds(after.two).length + collectionIds(after.two).length,
  };
  t.claim(afterCounts.one === beforeCounts.one,
    `loading an export back changed ${owner1} from ${beforeCounts.one} companions `
    + `to ${afterCounts.one}`);
  t.claim(afterCounts.two === beforeCounts.two,
    `loading an export back changed ${owner2} from ${beforeCounts.two} companions `
    + `to ${afterCounts.two}`);
  t.claim(Boolean(ctx.market()?.[listingId]),
    'a companion in escrow must still be listed after a state load');

  // A load replaces `monster` wholesale. If it does not also replace the
  // matching roster entry, the two stop being one object: the ids still agree,
  // so nothing looks wrong until the companion is fed and only one of them
  // gains the energy.
  const active = after.one.activeId;
  await ctx.send(ctx.owner, {
    Action: 'Admin.AdjustInventory', PlayerId: owner1,
    Item: after.one.monster?.berryItem ?? 'water_berry', Amount: '5',
  });
  await ctx.send(owner1, { Action: 'Monster.Feed' });
  const fed = await ctx.readFresh(owner1);
  if (fed.monster && fed.monsters?.[active]) {
    t.claim(fed.monster.energy === fed.monsters[active].energy,
      'after a state load, feeding must move the roster entry too — '
      + `the companion shows ${fed.monster.energy} energy and the roster entry `
      + `${fed.monsters[active].energy}`);
  }
  return t.claims;
}

// ---------------------------------------------------------------------------

export const SCENARIOS = [
  { name: 'swearing-is-arrival', run: swearingIsArrival },
  { name: 'adopt-refill', run: adoptRefill },
  { name: 'escrow-exclusivity', run: escrowExclusivity },
  { name: 'double-spend', run: doubleSpend },
  { name: 'roster-cap', run: rosterCap },
  { name: 'battle-swap', run: battleSwap },
  { name: 'transfer-to-stranger', run: transferToStranger },
  { name: 'export-reload', run: exportReload },
];
