/**
 * How an actor gets hold of the fight it is in, without spending a slot on it.
 *
 * A read is charged exactly what a write is. `dev_lua` loads, encodes, decodes
 * and writes the WHOLE published map five times per message whatever that
 * message did (CLAUDE.md, "Every message pays for all published state"), so
 * `Battle.Info` measured 598 ms of `execution_ms` on the live node to hand back
 * a table that was already on the wire. The production authority's own slot log
 * shows what that cost inside the PvP loop: 2,877 `Battle.Info` against 2,891
 * `Battle.Attack`, one wasted slot per round, per side.
 *
 * It was never necessary. `playerView` attaches the live fight to
 * `player-<address>` whenever `activeBattleId` still points at it, and `compute`
 * republishes the PvP OPPONENT's record on every round -- so both halves of a
 * duel can see the round land from an unsigned GET. `botRound` has always read
 * the battle off the player record; this is the same rule for the other side of
 * the arena, factored out here so it can be tested without a worker thread.
 *
 * Three outcomes, and the caller must handle all three:
 *
 *   * `{ battle }`          -- read for free, go and move.
 *   * `{ terminal: true }`  -- the account no longer names this battle, which
 *                             is what `playerView` writes when the fight ended
 *                             or was released. That is exactly the answer the
 *                             scheduled read used to give ("Battle not found" /
 *                             "that battle is over"), so it takes the same
 *                             reconciliation path.
 *   * `{ needsMessage: true }` -- locked to this id but carrying no battle
 *                             table. The published record cannot answer, so the
 *                             signed read is still the fallback and nothing
 *                             that used to work stops working. A fleet-routed
 *                             fight is the shape that lands here.
 */
export function resolveArenaBattle(player, battleId) {
  if (!battleId) return { terminal: true };
  if (!player || player.activeBattleId !== battleId) return { terminal: true };
  const battle = player.battle;
  // An id that matches but no table: the caller must ask the process. Guard on
  // the ID rather than truthiness alone -- a record carrying somebody else's
  // battle under `battle` would otherwise be moved against, which is the bug a
  // published singleton `/now/battle` key used to make possible.
  if (!battle || (battle.id !== undefined && battle.id !== battleId)) {
    return { needsMessage: true };
  }
  // An ended battle is published while `activeBattleId` still names it only in
  // the window before settlement clears the id. Hand it back rather than
  // calling it terminal here: the caller distinguishes "ended, settle it" from
  // "gone, reconcile it", and those produce different swarm events.
  return { battle };
}
