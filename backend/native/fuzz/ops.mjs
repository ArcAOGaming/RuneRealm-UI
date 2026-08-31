/**
 * The op catalogue: what the fuzzer tries, and what it expects back.
 *
 * Half of this file describes actions that MUST be refused. That is the point
 * of it. A soak that only ever does legal things proves the happy path and
 * nothing else, and every interesting bug in a roster-and-marketplace model is
 * on the other side of a rule: selling a companion that is mid-quest, buying
 * one twice, cancelling somebody else's listing, retrieving into a full roster.
 * Those are generated as deliberately as the legal ones, and AN ILLEGAL OP THAT
 * SUCCEEDS is the loudest failure this tool can report.
 *
 * Every generator returns `null` when the world is not in a state where it
 * could produce its case honestly. An illegal-because-the-roster-is-full op
 * needs a full roster to actually be illegal; manufacturing one against an
 * empty roster would assert the wrong refusal and pass for the wrong reason.
 */
import { World, collectionIds, rosterIds, runes, itemCount, fingerprint } from './world.mjs';

const pick = (rng, list) => (list.length ? list[Math.floor(rng() * list.length)] : null);

/** A well-formed Arweave address that is nobody. */
const NOBODY = 'ZZZZnobodyzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz';
/** Well formed as a string, and not 43 characters. The check is a length check. */
const MALFORMED = 'too-short';
/** Ids are issued as `m<n>` from a per-player counter, so this is out of range. */
const UNKNOWN_ID = 'm999999';

const isHome = (monster) => monster?.status?.type === 'Home';
const busy = (view) => Object.values(view?.monsters ?? {}).filter((m) => !isHome(m));
const homely = (view) => Object.values(view?.monsters ?? {}).filter(isHome);

// ---------------------------------------------------------------------------
// Legal moves
// ---------------------------------------------------------------------------

function storeValid(rng, world, actor) {
  const view = world.view(actor);
  if (!view?.unlocked || view.activeBattleId) return null;
  const monster = pick(rng, homely(view));
  if (!monster || runes(view) < 1) return null;
  return {
    name: 'monster.store', legal: true, actor,
    tags: { Action: 'Monster.Store', MonsterId: monster.id },
    precondition: (view) => runes(view) >= 1 && Boolean(view?.monsters?.[monster.id]),
    verify({ before, after }) {
      const problems = [];
      if (after.monsters?.[monster.id]) problems.push('stored companion is still in the roster');
      if (!after.collection?.[monster.id]) problems.push('stored companion did not reach the collection');
      const spent = runes(before) - runes(after);
      if (spent !== 1) problems.push(`storing cost ${spent} runes, expected exactly 1`);
      if (after.activeId && !after.monsters?.[after.activeId]) {
        problems.push('activeId points at a companion that is no longer in the roster');
      }
      return problems;
    },
  };
}

function retrieveValid(rng, world, actor) {
  const view = world.view(actor);
  if (!view?.unlocked) return null;
  if (rosterIds(view).length >= world.rosterMax) return null;
  const id = pick(rng, collectionIds(view));
  if (!id) return null;
  return {
    name: 'monster.retrieve', legal: true, actor,
    tags: { Action: 'Monster.Retrieve', MonsterId: id },
    precondition: (view) => rosterIds(view).length < world.rosterMax
      && Boolean(view?.collection?.[id]),
    verify({ before, after }) {
      const problems = [];
      if (!after.monsters?.[id]) problems.push('retrieved companion is not in the roster');
      if (after.collection?.[id]) problems.push('retrieved companion is still in the collection');
      if (runes(before) !== runes(after)) problems.push('retrieving charged runes; it is meant to be free');
      const back = after.monsters?.[id];
      if (back && back.status?.type !== 'Home') {
        problems.push(`retrieved companion came back ${back.status?.type}, expected Home`);
      }
      return problems;
    },
  };
}

function setActiveValid(rng, world, actor) {
  const view = world.view(actor);
  if (!view?.unlocked || view.activeBattleId) return null;
  if (!isHome(view.monster)) return null;
  const id = pick(rng, collectionIds(view).filter((candidate) => isHome(view.collection?.[candidate])));
  if (!id) return null;
  return {
    name: 'monster.set-active', legal: true, actor,
    tags: { Action: 'Monster.SetActive', MonsterId: id },
    verify({ after }) {
      const problems = [];
      if (after.activeId !== id) problems.push(`activeId is ${after.activeId}, expected ${id}`);
      if (after.monster?.id !== id) {
        problems.push(`the active companion is ${after.monster?.id}, expected ${id}`);
      }
      return problems;
    },
  };
}

function transferValid(rng, world, actor, ctx) {
  const view = world.view(actor);
  if (!view?.unlocked) return null;
  const id = pick(rng, collectionIds(view));
  if (!id) return null;
  const recipient = pick(rng, ctx.actors.filter((address) => address !== actor));
  if (!recipient) return null;
  const print = fingerprint(view.collection[id]);
  return {
    name: 'monster.transfer', legal: true, actor, counterparty: recipient,
    tags: { Action: 'Monster.Transfer', MonsterId: id, Recipient: recipient },
    async verify({ after, read, readFresh, note }) {
      const problems = [];
      if (after.collection?.[id]) problems.push('transferred companion is still with the sender');
      if (after.monsters?.[id]) problems.push('transferred companion appeared in the sender roster');
      const holds = (view) => Object.values(view?.collection ?? {})
        .some((monster) => fingerprint(monster) === print);
      // Read the published key BEFORE forcing a republish, or the staleness
      // this is looking for is the thing the check just repaired.
      const published = holds(await read(recipient));
      if (!holds(await readFresh(recipient))) {
        problems.push('transferred companion never reached the recipient collection');
      } else if (!published) {
        // It arrived, but only the sender's record was republished. The
        // receiving player polls their own key and sees nothing until they
        // send a message of their own.
        note('stale-published-key',
          `a transfer reached ${recipient} but did not republish their record`);
      }
      return problems;
    },
  };
}

function listValid(rng, world, actor) {
  const view = world.view(actor);
  if (!view?.unlocked) return null;
  const id = pick(rng, collectionIds(view));
  if (!id) return null;
  // Skewed low so that a fuzz buyer can usually afford one. The bounds are
  // covered by the illegal price cases rather than by grinding the ceiling.
  const price = 1 + Math.floor(rng() * rng() * 60);
  const print = fingerprint(view.collection[id]);
  return {
    name: 'market.list', legal: true, actor,
    tags: { Action: 'Market.List', MonsterId: id, Price: String(price) },
    verify({ before, after, market, reply }) {
      const problems = [];
      if (after.collection?.[id]) problems.push('listed companion is still in the seller collection');
      // The listing rides on the REPLY only. The published player record is an
      // ordinary player view, so looking for it there would always fail.
      const listing = reply?.listing;
      if (!listing) problems.push('the reply carried no listing');
      else {
        if (Number(listing.price) !== price) {
          problems.push(`listing price is ${listing.price}, asked for ${price}`);
        }
        if (listing.seller !== actor) problems.push('the listing names the wrong seller');
        if (fingerprint(listing.monster) !== print) {
          problems.push('the listing is holding a different companion than the one listed');
        }
        if (market && !market[listing.id]) problems.push('the new listing is not on the published market');
      }
      if (runes(before) !== runes(after)) problems.push('listing moved runes; it is meant to be free');
      return problems;
    },
  };
}

function cancelValid(rng, world, actor) {
  const view = world.view(actor);
  if (!view?.unlocked) return null;
  const listing = pick(rng, world.listingsBy(actor));
  if (!listing) return null;
  const print = fingerprint(listing.monster);
  return {
    name: 'market.cancel', legal: true, actor,
    tags: { Action: 'Market.Cancel', ListingId: listing.id },
    verify({ after, market }) {
      const problems = [];
      if (market?.[listing.id]) problems.push('a cancelled listing is still on the market');
      const home = Object.values(after.collection ?? {})
        .some((monster) => fingerprint(monster) === print);
      if (!home) problems.push('the cancelled companion did not return to the seller collection');
      return problems;
    },
  };
}

function buyValid(rng, world, actor) {
  const view = world.view(actor);
  if (!view?.unlocked) return null;
  const listing = pick(rng, world.affordableListings(actor));
  if (!listing) return null;
  const price = Number(listing.price);
  const print = fingerprint(listing.monster);
  const seller = listing.seller;
  return {
    name: 'market.buy', legal: true, actor, counterparty: seller,
    tags: { Action: 'Market.Buy', ListingId: listing.id },
    precondition: (view) => runes(view) >= price,
    async verify({ before, after, market, read, readFresh, counterpartyBefore, note }) {
      const problems = [];
      const paid = runes(before) - runes(after);
      if (paid !== price) problems.push(`the buyer paid ${paid}, the listing asked ${price}`);
      if (market?.[listing.id]) problems.push('a sold listing is still on the market');
      const owned = Object.values(after.collection ?? {})
        .some((monster) => fingerprint(monster) === print);
      if (!owned) problems.push('the bought companion is not in the buyer collection');

      // The published key first, then the forced republish: asking the other
      // way round repairs the staleness before looking for it.
      const published = await read(seller);
      const sellerAfter = await readFresh(seller);
      if (counterpartyBefore) {
        const credited = runes(sellerAfter) - runes(counterpartyBefore);
        if (credited !== price) {
          problems.push(`the seller was credited ${credited}, the listing asked ${price}`);
        }
        if (published && runes(published) !== runes(sellerAfter)) {
          // The sale settled, but only the buyer's record was republished, so
          // the seller polls their own key and does not see the payment.
          note('stale-published-key',
            `a sale credited ${seller} but did not republish their record`);
        }
      }
      const stillTheirs = [
        ...Object.values(sellerAfter?.collection ?? {}),
        ...Object.values(sellerAfter?.monsters ?? {}),
      ].some((monster) => fingerprint(monster) === print);
      if (stillTheirs) problems.push('the seller still holds the companion they sold');
      return problems;
    },
  };
}

function shopSellValid(rng, world, actor) {
  const view = world.view(actor);
  if (!view?.unlocked || !world.economy?.desks) return null;
  const candidates = ['fire_berry', 'water_berry', 'air_berry', 'rock_berry']
    .filter((item) => itemCount(view, item) > 0
      && world.economy.desks[item] && !world.economy.desks[item].pause?.sell);
  const item = pick(rng, candidates);
  if (!item) return null;
  return {
    name: 'economy.shop.sell', legal: true, actor,
    tags: { Action: 'Economy.Shop.Trade', Side: 'sell', Item: item, Quantity: '1' },
    verify({ before, after }) {
      const problems = [];
      if (itemCount(before, item) - itemCount(after, item) !== 1) {
        problems.push('NPC sale did not move exactly one item out of player inventory');
      }
      if (Number(after.gold ?? 0) <= Number(before.gold ?? 0)) {
        problems.push('NPC sale did not pay Gold from its reserve');
      }
      return problems;
    },
  };
}

function goldSellOrderValid(rng, world, actor) {
  const view = world.view(actor);
  if (!view?.unlocked || Number(view.gold ?? 0) < 1 || !world.economy) return null;
  const item = pick(rng, ['fire_berry', 'water_berry', 'air_berry', 'rock_berry']
    .filter((id) => itemCount(view, id) > 0));
  if (!item) return null;
  return {
    name: 'economy.order.sell', legal: true, actor,
    tags: { Action: 'Economy.Order.Place', Side: 'sell', Item: item,
      Price: '10', Quantity: '1' },
    verify({ before, after }) {
      const problems = [];
      if (itemCount(before, item) - itemCount(after, item) !== 1) {
        problems.push('Gold sell order did not move exactly one item into escrow or settlement');
      }
      if (Number(after.gold ?? 0) < Number(before.gold ?? 0) - 1) {
        problems.push('Gold sell order lost more than its one-Gold creation cost');
      }
      return problems;
    },
  };
}

function goldBuyOrderValid(rng, world, actor) {
  const view = world.view(actor);
  const gold = Number(view?.gold ?? 0);
  if (!view?.unlocked || gold < 11 || !world.economy?.orders) return null;
  const order = pick(rng, world.economy.orders.filter((candidate) =>
    candidate.side === 'sell' && candidate.account !== actor
      && candidate.price * candidate.remaining >= 10
      && candidate.price * candidate.remaining + 1 <= gold));
  if (!order) return null;
  const minimum = Math.max(1, Math.ceil(10 / order.price));
  const quantity = Math.min(order.remaining, minimum);
  if (order.price * quantity < 10) return null;
  return {
    name: 'economy.order.buy', legal: true, actor, counterparty: order.account,
    tags: { Action: 'Economy.Order.Place', Side: 'buy', Item: order.item,
      Price: String(order.price), Quantity: String(quantity) },
    verify({ before, after }) {
      const problems = [];
      if (itemCount(after, order.item) - itemCount(before, order.item) !== quantity) {
        problems.push('crossing Gold buy order did not receive the exact item quantity');
      }
      if (Number(before.gold ?? 0) - Number(after.gold ?? 0) > order.price * quantity + 1) {
        problems.push('Gold buy order spent more than commitment plus creation cost');
      }
      return problems;
    },
  };
}

// ---------------------------------------------------------------------------
// Moves that must be refused
// ---------------------------------------------------------------------------
//
// Each carries the `rule` it is probing, so a run that reports "an illegal op
// was accepted" also says in one line which rule stopped being enforced.

function illegalStoreBusy(rng, world, actor) {
  const view = world.view(actor);
  if (!view?.unlocked) return null;
  const monster = pick(rng, busy(view));
  if (!monster || runes(view) < 1) return null;
  return {
    name: 'monster.store', legal: false, actor, variant: 'busy-companion',
    rule: 'a companion mid-activity cannot be parked to cancel the outcome',
    tags: { Action: 'Monster.Store', MonsterId: monster.id },
    precondition: (view) => runes(view) >= 1
      && view?.monsters?.[monster.id]?.status?.type !== 'Home',
    verify({ before, after }) {
      return runes(after) < runes(before)
        ? ['a refused store still charged the storage rune'] : [];
    },
  };
}

function illegalStoreCollection(rng, world, actor) {
  const view = world.view(actor);
  if (!view?.unlocked) return null;
  const id = pick(rng, collectionIds(view));
  if (!id || runes(view) < 1) return null;
  return {
    name: 'monster.store', legal: false, actor, variant: 'already-stored',
    rule: 'storing something already in the collection must not re-store or duplicate it',
    tags: { Action: 'Monster.Store', MonsterId: id },
    precondition: (view) => runes(view) >= 1 && Boolean(view?.collection?.[id]),
    verify({ before, after }) {
      return runes(after) < runes(before)
        ? ['a refused store still charged the storage rune'] : [];
    },
  };
}

function illegalStoreUnknown(rng, world, actor) {
  const view = world.view(actor);
  if (!view?.unlocked || runes(view) < 1) return null;
  return {
    name: 'monster.store', legal: false, actor, variant: 'unknown-id',
    rule: 'an id nobody has issued names no companion',
    tags: { Action: 'Monster.Store', MonsterId: UNKNOWN_ID },
  };
}

function illegalRetrieveFull(rng, world, actor) {
  const view = world.view(actor);
  if (!view?.unlocked) return null;
  if (rosterIds(view).length < world.rosterMax) return null;
  const id = pick(rng, collectionIds(view));
  if (!id) return null;
  return {
    name: 'monster.retrieve', legal: false, actor, variant: 'roster-full',
    rule: `the roster cap of ${world.rosterMax} is a cap`,
    tags: { Action: 'Monster.Retrieve', MonsterId: id },
    precondition: (view) => rosterIds(view).length >= world.rosterMax
      && Boolean(view?.collection?.[id]),
    verify({ after }) {
      return rosterIds(after).length > world.rosterMax
        ? [`the roster holds ${rosterIds(after).length}, over the cap of ${world.rosterMax}`] : [];
    },
  };
}

function illegalRetrieveRoster(rng, world, actor) {
  const view = world.view(actor);
  if (!view?.unlocked) return null;
  const id = pick(rng, rosterIds(view));
  if (!id) return null;
  return {
    name: 'monster.retrieve', legal: false, actor, variant: 'already-active',
    rule: 'retrieving a roster companion must not clone it into the roster twice',
    tags: { Action: 'Monster.Retrieve', MonsterId: id },
  };
}

function illegalSetActiveCollection(rng, world, actor) {
  const view = world.view(actor);
  if (!view?.unlocked) return null;
  const id = pick(rng, collectionIds(view));
  if (!id || !view.monster || isHome(view.monster)) return null;
  return {
    name: 'monster.set-active', legal: false, actor, variant: 'active-companion-busy',
    rule: 'a busy active companion cannot be swapped into collection to escape its activity',
    tags: { Action: 'Monster.SetActive', MonsterId: id },
  };
}

function illegalSetActiveUnknown(rng, world, actor) {
  const view = world.view(actor);
  if (!view?.unlocked) return null;
  return {
    name: 'monster.set-active', legal: false, actor, variant: 'unknown-id',
    rule: 'an id nobody has issued names no companion',
    tags: { Action: 'Monster.SetActive', MonsterId: UNKNOWN_ID },
  };
}

function illegalSetActiveMidBattle(rng, world, actor) {
  const view = world.view(actor);
  if (!view?.unlocked || !view.activeBattleId) return null;
  const id = pick(rng, collectionIds(view));
  if (!id) return null;
  return {
    name: 'monster.set-active', legal: false, actor, variant: 'mid-battle',
    rule: 'the companion fighting a battle cannot be swapped out from under it',
    tags: { Action: 'Monster.SetActive', MonsterId: id },
  };
}

function illegalTransferRoster(rng, world, actor, ctx) {
  const view = world.view(actor);
  if (!view?.unlocked) return null;
  const id = pick(rng, rosterIds(view));
  const recipient = pick(rng, ctx.actors.filter((address) => address !== actor));
  if (!id || !recipient) return null;
  return {
    name: 'monster.transfer', legal: false, actor, variant: 'from-roster',
    rule: 'only a companion in the collection changes hands',
    tags: { Action: 'Monster.Transfer', MonsterId: id, Recipient: recipient },
  };
}

function illegalTransferSelf(rng, world, actor) {
  const view = world.view(actor);
  if (!view?.unlocked) return null;
  const id = pick(rng, collectionIds(view));
  if (!id) return null;
  return {
    name: 'monster.transfer', legal: false, actor, variant: 'to-self',
    rule: 'a self-transfer must not reissue an id or duplicate the record',
    tags: { Action: 'Monster.Transfer', MonsterId: id, Recipient: actor },
  };
}

function illegalTransferMalformed(rng, world, actor) {
  const view = world.view(actor);
  if (!view?.unlocked) return null;
  const id = pick(rng, collectionIds(view));
  if (!id) return null;
  return {
    name: 'monster.transfer', legal: false, actor, variant: 'bad-recipient',
    rule: 'a recipient that is not an Arweave address is not a destination',
    tags: { Action: 'Monster.Transfer', MonsterId: id, Recipient: MALFORMED },
  };
}

/**
 * Naming another player's monster id.
 *
 * Ids are PER PLAYER, so `m1` exists in nearly every account and an id copied
 * out of somebody else's published record is well formed, plausible, and
 * points at their creature. Whatever this does, it must not reach into the
 * account the id came from.
 */
function illegalTransferOthers(rng, world, actor, ctx) {
  const view = world.view(actor);
  if (!view?.unlocked) return null;
  const victim = pick(rng, ctx.actors.filter((address) => address !== actor));
  const theirs = world.view(victim);
  const id = pick(rng, collectionIds(theirs));
  if (!id || view.collection?.[id]) return null;
  return {
    name: 'monster.transfer', legal: false, actor, variant: 'someone-elses-id',
    rule: 'a per-player id from another account must not reach into that account',
    tags: { Action: 'Monster.Transfer', MonsterId: id, Recipient: NOBODY },
    async verify({ readFresh }) {
      const after = await readFresh(victim);
      return after?.collection?.[id]
        ? []
        : [`naming another player's id removed ${id} from ${victim}`];
    },
  };
}

function illegalListFromRoster(rng, world, actor) {
  const view = world.view(actor);
  if (!view?.unlocked) return null;
  const id = pick(rng, rosterIds(view));
  if (!id) return null;
  return {
    name: 'market.list', legal: false, actor, variant: 'from-roster',
    rule: 'selling a companion the game is acting on is not a state worth having',
    tags: { Action: 'Market.List', MonsterId: id, Price: '10' },
  };
}

function illegalListPrice(rng, world, actor) {
  const view = world.view(actor);
  if (!view?.unlocked) return null;
  const id = pick(rng, collectionIds(view));
  if (!id) return null;
  const price = pick(rng, [
    '0', '-5', String(world.minPrice - 1), String(world.maxPrice + 1),
    'free', '1.5', '', '1e9', '99999999999999999999',
  ]);
  return {
    name: 'market.list', legal: false, actor,
    variant: `price:${price === '' ? '(empty)' : price}`,
    rule: `an asking price outside ${world.minPrice}..${world.maxPrice} is not a price`,
    tags: { Action: 'Market.List', MonsterId: id, Price: price },
    verify({ after }) {
      return after.collection?.[id] ? [] : ['a refused listing still took the companion into escrow'];
    },
  };
}

function illegalListTwice(rng, world, actor) {
  const view = world.view(actor);
  if (!view?.unlocked) return null;
  const listing = pick(rng, world.listingsBy(actor));
  if (!listing) return null;
  // The id the companion carried before it went into escrow. Nothing holds it
  // any more, so listing it again must find nothing rather than escrow a ghost.
  const id = listing.monster?.id;
  if (!id || view.collection?.[id]) return null;
  return {
    name: 'market.list', legal: false, actor, variant: 'already-listed',
    rule: 'a companion in escrow is in nobody’s collection and cannot be listed again',
    tags: { Action: 'Market.List', MonsterId: id, Price: '15' },
  };
}

function illegalCancelOthers(rng, world, actor) {
  const view = world.view(actor);
  if (!view?.unlocked) return null;
  const listing = pick(rng, [...world.market.values()].filter((entry) => entry.seller !== actor));
  if (!listing) return null;
  return {
    name: 'market.cancel', legal: false, actor, variant: 'not-mine',
    rule: 'a listing can only be withdrawn by its seller',
    tags: { Action: 'Market.Cancel', ListingId: listing.id },
    verify({ market }) {
      return market && !market[listing.id]
        ? [`${actor} cancelled ${listing.seller}'s listing ${listing.id}`] : [];
    },
  };
}

function illegalCancelUnknown(rng, world, actor) {
  const view = world.view(actor);
  if (!view?.unlocked) return null;
  return {
    name: 'market.cancel', legal: false, actor, variant: 'unknown-listing',
    rule: 'a listing id that was never issued names no listing',
    tags: { Action: 'Market.Cancel', ListingId: `L${900000 + Math.floor(rng() * 1000)}` },
  };
}

function illegalBuyOwn(rng, world, actor) {
  const view = world.view(actor);
  if (!view?.unlocked) return null;
  const listing = pick(rng, world.listingsBy(actor));
  if (!listing) return null;
  return {
    name: 'market.buy', legal: false, actor, variant: 'own-listing',
    rule: 'buying your own listing would be a free round trip out of escrow',
    tags: { Action: 'Market.Buy', ListingId: listing.id },
    verify({ before, after, market }) {
      const problems = [];
      if (runes(after) !== runes(before)) problems.push('a refused self-purchase moved runes');
      if (market && !market[listing.id]) problems.push('a refused self-purchase removed the listing');
      return problems;
    },
  };
}

function illegalBuyPoor(rng, world, actor) {
  const view = world.view(actor);
  if (!view?.unlocked) return null;
  const held = runes(view);
  const listing = pick(rng, [...world.market.values()]
    .filter((entry) => entry.seller !== actor && Number(entry.price) > held));
  if (!listing) return null;
  return {
    name: 'market.buy', legal: false, actor, variant: 'cannot-afford',
    rule: 'a purchase must not proceed on runes the buyer does not hold',
    tags: { Action: 'Market.Buy', ListingId: listing.id },
    precondition: (view) => runes(view) < Number(listing.price),
    verify({ before, after, market }) {
      const problems = [];
      if (runes(after) < runes(before)) {
        problems.push(`a refused purchase still moved ${runes(before) - runes(after)} runes`);
      }
      if (market && !market[listing.id]) problems.push('a refused purchase removed the listing');
      return problems;
    },
  };
}

function illegalBuyUnknown(rng, world, actor) {
  const view = world.view(actor);
  if (!view?.unlocked) return null;
  return {
    name: 'market.buy', legal: false, actor, variant: 'unknown-listing',
    rule: 'a listing id that was never issued names no listing',
    tags: { Action: 'Market.Buy', ListingId: `L${900000 + Math.floor(rng() * 1000)}` },
  };
}

function illegalAdoptSecond(rng, world, actor) {
  const view = world.view(actor);
  if (!view?.unlocked || !view.faction || view.adopted !== true) return null;
  return {
    name: 'monster.adopt', legal: false, actor, variant: 'second-companion',
    rule: 'adoption is one per account, or the companion supply is unbounded and free',
    tags: { Action: 'Monster.Adopt' },
    precondition: (fresh) => fresh?.adopted === true,
  };
}

/**
 * Drawing another starter after giving everything away.
 *
 * The rule was once "you may take one when you hold nothing", and emptiness is
 * a state anyone can return to on purpose: sell, transfer or give away the only
 * companion you hold and the door opens again. Two wallets passing one creature
 * back and forth could draw a fresh one out of the process every round for the
 * price of the storage rune.
 *
 * The oath now carries the starter, so `Monster.Adopt` is only a door for an
 * account that swore under an older build — but it is still a door, and this
 * is the shape of the mistake, so it stays probed.
 *
 * The account is EMPTY when this fires, so nothing about what it holds can
 * refuse it. The only thing that can is the account remembering that it has
 * already adopted, which is exactly the property under test -- and the reason
 * the run keeps drawing this case rather than trusting one scenario to cover
 * it, since the flag has to survive being sold out of, migrated, and reloaded.
 */
function illegalAdoptAgain(rng, world, actor, ctx) {
  const view = world.view(actor);
  if (!view?.unlocked || !view.faction) return null;
  const everAdopted = view.adopted === true || ctx.adopted?.has(actor);
  if (!everAdopted) return null;
  if (view.monster || collectionIds(view).length > 0) return null;
  return {
    name: 'monster.adopt', legal: false, actor, variant: 'refill-after-giving-away',
    rule: 'adoption is once per account; an emptied account must not be able to draw another',
    tags: { Action: 'Monster.Adopt' },
    precondition: (fresh) => !fresh?.monster && collectionIds(fresh).length === 0,
  };
}

/**
 * Swearing again.
 *
 * The oath is irreversible and it is now also the thing that hands over the
 * starter, so a second one accepted would not merely change a label — it would
 * mint a companion and re-seed the satchel. Both halves are checked, because a
 * rule that refuses the faction change while still running the rest of the
 * handler is exactly the shape this would take.
 */
function illegalSwearAgain(rng, world, actor) {
  const view = world.view(actor);
  if (!view?.unlocked || !view.faction) return null;
  const other = ['Sky Nomads', 'Aqua Guardians', 'Inferno Blades', 'Stone Titans']
    .filter((name) => name !== view.faction);
  return {
    name: 'faction.join', legal: false, actor, variant: 'already-sworn',
    rule: 'an account swears once; the oath is irreversible and carries the starter',
    tags: { Action: 'Faction.Join', Faction: pick(rng, other) },
    precondition: (fresh) => Boolean(fresh?.faction),
    verify({ before, after }) {
      const problems = [];
      if (after.faction !== before.faction) {
        problems.push(`a refused oath still moved the account to ${after.faction}`);
      }
      const held = (view_) => rosterIds(view_).length + collectionIds(view_).length;
      if (held(after) > held(before)) {
        problems.push('a refused oath still handed over a companion');
      }
      if (runes(after) > runes(before)) {
        problems.push('a refused oath still re-seeded the starter satchel');
      }
      return problems;
    },
  };
}

function illegalSwearNonsense(rng, world, actor) {
  const view = world.view(actor);
  if (!view?.unlocked) return null;
  return {
    name: 'faction.join', legal: false, actor,
    variant: 'no-such-faction',
    rule: 'a faction that does not exist has no companion to hand over',
    tags: { Action: 'Faction.Join', Faction: pick(rng, ['', 'Nonsense Brigade', 'inferno blades ']) },
  };
}

/**
 * A player signing an owner-only verb.
 *
 * Not a roster rule, but the roster and market work added new admin surfaces,
 * and an authorisation check that quietly regressed would show up in none of
 * the checks above.
 */
function illegalAdmin(rng, world, actor, ctx) {
  const view = world.view(actor);
  if (!view) return null;
  const victim = pick(rng, ctx.actors.filter((address) => address !== actor)) ?? actor;
  const theirs = world.view(victim);
  const stealable = pick(rng, [...collectionIds(theirs), ...rosterIds(theirs)]);
  const attempt = pick(rng, [
    { Action: 'Admin.AdjustInventory', PlayerId: actor, Item: 'rune', Amount: '10000' },
    { Action: 'Admin.Grant', PlayerId: actor, Item: 'rune', Amount: '10000' },
    { Action: 'Admin.Unlock', Addresses: actor },
    { Action: 'Admin.SetStats', PlayerId: actor },
    { Action: 'Admin.RemoveUser', PlayerId: victim },
    { Action: 'Admin.Lock', PlayerId: victim },
    { Action: 'Admin.Load' },
    // The three admin doors the roster work added. A player who can reach any
    // of these can mint companions out of nothing, delete somebody else's, or
    // move one into their own account without paying for it -- so each is
    // probed by name rather than trusting that "Admin.*" is checked uniformly.
    { Action: 'Admin.CreateMonster', PlayerId: actor, Faction: 'Inferno Blades', Into: 'collection' },
    ...(stealable ? [
      { Action: 'Admin.DeleteMonster', PlayerId: victim, MonsterId: stealable },
      { Action: 'Admin.MoveMonster', PlayerId: victim, MonsterId: stealable, Recipient: actor },
    ] : []),
  ]);
  return {
    name: 'admin.forged', legal: false, actor, variant: attempt.Action,
    rule: 'Admin.* is owner-only, and a player is not the owner',
    tags: attempt,
    async verify({ before, after, readFresh }) {
      const problems = [];
      if (runes(after) > runes(before)) {
        problems.push(`${attempt.Action} from a player granted ${runes(after) - runes(before)} runes`);
      }
      if (attempt.Action === 'Admin.CreateMonster'
        && collectionIds(after).length > collectionIds(before).length) {
        problems.push('a player forged Admin.CreateMonster and got a companion');
      }
      if (stealable && attempt.PlayerId === victim) {
        const victimAfter = await readFresh(victim);
        const stillThere = victimAfter?.collection?.[stealable] || victimAfter?.monsters?.[stealable];
        if (!stillThere) problems.push(`${attempt.Action} from a player removed ${stealable} from ${victim}`);
      }
      return problems;
    },
  };
}

// ---------------------------------------------------------------------------
// Routine play
// ---------------------------------------------------------------------------
//
// The roster verbs are only interesting against companions that are moving.
// A store that is only ever attempted on an idle creature never reaches the
// "your companion is busy" branch, and a roster that never changes level never
// exercises the per-entry `nextLevelExp` the view computes.
//
// Outcomes here are rolled, so these ops predict nothing: `legal: null` means
// "either answer is acceptable", and they are held to the invariant sweep only.

function routine(rng, world, actor) {
  const view = world.view(actor);
  if (!view?.unlocked || !view.monster) return null;
  const monster = view.monster;
  const status = monster.status?.type;
  const berry = monster.berryItem;
  const held = (item) => Number(view.inventory?.[item] ?? 0);

  if (status === 'Play' || status === 'Quest') {
    return { name: 'routine.claim', legal: null, actor, tags: { Action: 'Monster.Claim' } };
  }
  const options = [];
  if (Number(view.dailyReadyAt ?? 0) === 0) options.push({ Action: 'Daily.Claim' });
  if ((view.lootboxes?.length ?? 0) > 0 && status === 'Home') options.push({ Action: 'Lootbox.Open' });
  if (held(berry) > 0 && monster.energy < 100) options.push({ Action: 'Monster.Feed', Item: berry });
  if (status === 'Home' && held(berry) > 0 && monster.energy >= 10) options.push({ Action: 'Monster.Play' });
  if (status === 'Home' && runes(view) >= 1 && monster.energy >= 25 && monster.happiness >= 25) {
    options.push({ Action: 'Monster.Quest' });
  }
  if (status === 'Home' && monster.exp >= monster.nextLevelExp) {
    options.push({ Action: 'Monster.LevelUp', Attack: '3', Defense: '3', Speed: '2', Health: '2' });
  }
  const tags = pick(rng, options);
  if (!tags) return null;
  return { name: `routine.${tags.Action}`, legal: null, actor, tags };
}

function illegalGoldOrderZero(rng, world, actor) {
  const view = world.view(actor);
  if (!view?.unlocked) return null;
  return {
    name: 'economy.order.buy', legal: false, actor, variant: 'zero-quantity',
    rule: 'Gold order quantities are positive integers',
    tags: { Action: 'Economy.Order.Place', Side: 'buy', Item: 'air_berry',
      Price: '10', Quantity: '0' },
  };
}

function illegalGoldSelfTrade(rng, world, actor) {
  const view = world.view(actor);
  if (!view?.unlocked || Number(view.gold ?? 0) < 11 || !world.economy?.orders) return null;
  const own = pick(rng, world.economy.orders.filter((order) =>
    order.account === actor && order.side === 'sell' && order.price * order.remaining >= 10));
  if (!own) return null;
  const quantity = Math.max(1, Math.ceil(10 / own.price));
  if (quantity > own.remaining || own.price * quantity + 1 > Number(view.gold ?? 0)) return null;
  return {
    name: 'economy.order.buy', legal: false, actor, variant: 'self-trade',
    rule: 'a wallet cannot match its own Gold order',
    tags: { Action: 'Economy.Order.Place', Side: 'buy', Item: own.item,
      Price: String(own.price), Quantity: String(quantity) },
  };
}

function illegalLegendaryShop(rng, world, actor) {
  const view = world.view(actor);
  if (!view?.unlocked) return null;
  return {
    name: 'economy.shop.sell', legal: false, actor, variant: 'legendary-p2p-only',
    rule: 'Legendary Scroll has no NPC desk at launch',
    tags: { Action: 'Economy.Shop.Trade', Side: 'sell', Item: 'legendary_scroll', Quantity: '1' },
  };
}

// ---------------------------------------------------------------------------

export const LEGAL_GENERATORS = [
  { weight: 10, gen: storeValid },
  { weight: 10, gen: retrieveValid },
  { weight: 6, gen: setActiveValid },
  { weight: 7, gen: transferValid },
  { weight: 12, gen: listValid },
  { weight: 5, gen: cancelValid },
  { weight: 12, gen: buyValid },
  { weight: 10, gen: shopSellValid },
  { weight: 7, gen: goldSellOrderValid },
  { weight: 7, gen: goldBuyOrderValid },
];

export const ILLEGAL_GENERATORS = [
  { weight: 4, gen: illegalStoreBusy },
  { weight: 4, gen: illegalStoreCollection },
  { weight: 2, gen: illegalStoreUnknown },
  { weight: 4, gen: illegalRetrieveFull },
  { weight: 4, gen: illegalRetrieveRoster },
  { weight: 3, gen: illegalSetActiveCollection },
  { weight: 2, gen: illegalSetActiveUnknown },
  { weight: 3, gen: illegalSetActiveMidBattle },
  { weight: 4, gen: illegalTransferRoster },
  { weight: 3, gen: illegalTransferSelf },
  { weight: 2, gen: illegalTransferMalformed },
  { weight: 4, gen: illegalTransferOthers },
  { weight: 5, gen: illegalListFromRoster },
  { weight: 5, gen: illegalListPrice },
  { weight: 4, gen: illegalListTwice },
  { weight: 5, gen: illegalCancelOthers },
  { weight: 2, gen: illegalCancelUnknown },
  { weight: 4, gen: illegalBuyOwn },
  { weight: 5, gen: illegalBuyPoor },
  { weight: 2, gen: illegalBuyUnknown },
  { weight: 3, gen: illegalAdoptSecond },
  { weight: 6, gen: illegalAdoptAgain },
  { weight: 5, gen: illegalSwearAgain },
  { weight: 2, gen: illegalSwearNonsense },
  { weight: 4, gen: illegalAdmin },
  { weight: 4, gen: illegalGoldOrderZero },
  { weight: 4, gen: illegalGoldSelfTrade },
  { weight: 3, gen: illegalLegendaryShop },
];

export const ROUTINE_GENERATORS = [{ weight: 1, gen: routine }];

/**
 * Draw one op.
 *
 * `illegalShare` is the fraction of draws that deliberately break a rule. It
 * defaults high because refusals are cheap and are where the coverage is: a
 * legal op that gets skipped comes back on the next tick, while a rule probed
 * once every hundred ops is effectively untested.
 *
 * A generator that cannot honestly produce its case is dropped from the draw
 * and another is tried, so a starved pool falls through to the next one rather
 * than wasting the tick.
 */
export function nextOp(rng, world, ctx, { illegalShare = 0.4, routineShare = 0.25 } = {}) {
  const roll = rng();
  const pools = roll < illegalShare
    ? [ILLEGAL_GENERATORS, LEGAL_GENERATORS]
    : roll < illegalShare + routineShare
      ? [ROUTINE_GENERATORS, LEGAL_GENERATORS]
      : [LEGAL_GENERATORS, ILLEGAL_GENERATORS];

  for (const pool of pools) {
    const candidates = [...pool];
    while (candidates.length) {
      const total = candidates.reduce((sum, entry) => sum + entry.weight, 0);
      let target = rng() * total;
      let index = 0;
      for (; index < candidates.length - 1; index++) {
        target -= candidates[index].weight;
        if (target <= 0) break;
      }
      const chosen = candidates[index];
      const actor = pick(rng, ctx.actors);
      const op = actor ? chosen.gen(rng, world, actor, ctx) : null;
      if (op) return op;
      candidates.splice(index, 1);
    }
  }
  return null;
}

export { World, pick, NOBODY, UNKNOWN_ID, MALFORMED };
