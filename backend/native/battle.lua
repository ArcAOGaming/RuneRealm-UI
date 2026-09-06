--- battle.lua — RuneRealm combat, as pure functions over a battle table.
---
--- Rewritten from RuneRealm-LUA/Lua/frontend/battle/{attacklogic,MultiBattle}.lua.
--- No handlers and no globals live here so the whole engine can be exercised by
--- battle_test.lua on a public node's ~lua@5.3a for free, with no wallet.
---
--- Bugs in the original that this fixes — all of them were live:
---
---   1. Attacks could not miss.  `local hits = move.damage > 0 and
---      doesAttackHit(a, d) or true` is `(damage>0 and hit) or true`: when the
---      roll said miss, `false or true` evaluated to true. Speed did nothing.
---
---   2. Type effectiveness never applied. See constants.lua — the chart was
---      keyed "Fire" while every move type was "fire".
---
---   3. `getRandom(#availableMoves)` passed one argument to a two-argument
---      wrapper, so picking a bot's move raised "bad argument #2" whenever the
---      bot had any moves left. Bots only ever struggled.
---
---   4. The turn log read `action.name` and `action.moveName`, neither of which
---      processAttack returned, so every entry the client rendered had a nil
---      monster name and a nil move name.
---
---   5. Shield regeneration was skipped for a side that had *ever* struggled,
---      which is not what "struggle" means anywhere else in the game.
---
---   6. A depleted move was decremented before the "no uses remaining" check in
---      one path and after it in another, so counts could go negative.
---
--- Bundled as:  local Battle = (function() ... end)()

local Battle = {}

--- Tuning.
---
--- Damage, health, shields and healing have to scale together or the game has a
--- different shape at every level. The original scaled only health: damage was
--- `move.damage * 5 + random(0, attack)`, flat, while HP grew with the health
--- stat forever. With type effectiveness switched back on that made 13-23% of
--- low-level fights end on the first swing, and 12% of level-20 fights run past
--- thirty rounds.
---
--- These are a table rather than locals so `balance.lua` can sweep them on a
--- live node and pick the numbers by measurement. Change one, then re-run
--- `./run-balance.sh` — it reports median rounds, first-round knockouts and
--- grinds at every level.
Battle.TUNING = {
  baseHitChance = 0.70,
  minHitChance = 0.30,
  maxHitChance = 0.95,
  --- How far the speed stat may move the hit chance, as a SHARE of the gap
  --- between the two fighters rather than as a count of stat points.
  ---
  --- The original modifier was `diff * 0.08` upward and `diff * 0.10` down,
  --- clamped at +0.25 and -0.40. Both clamps are reached at a gap of four
  --- points, which means two things and both of them are wrong once a player is
  --- past level one:
  ---
  ---   * speed is a DEAD stat above the fourth point. Speed 5 and speed 100
  ---     are the same number against a speed-1 opponent, so every point after
  ---     the fourth buys nothing but the turn order.
  ---   * and it is a SWITCH. A build that bought no speed sits pinned at the
  ---     0.30 floor while the one that did sits at 0.95 -- a 3.2x swing in
  ---     landed damage, larger than the 2.4x that a 60-point attack lead
  ---     delivers. It is the single biggest reason a defensive build won 3% of
  ---     its level-20 games against a balanced one.
  ---
  --- A share is smooth and has no saturation point, so the fifth point of speed
  --- is worth something at level 20 the way it is at level 1, and the extremes
  --- stop being a coin flip.
  ---
  --- ON, at 0.3. It was zero, and leaving it there is what made the MOVE
  --- catalog unbalanceable rather than merely unbalanced.
  ---
  --- Measured with `./run-balance.sh rank<pool>5`, which plays a roster
  --- carrying one move under test against an identical roster carrying a plain
  --- 4-damage attack instead. At `speedSwing = 0` the ranking was not a ranking
  --- of moves at all, it was a ranking of SPEED RIDERS:
  ---
  ---   Gale Force   (+5 spd, 3 damage)  68%     Vital Essence (-2 spd)  12%
  ---   Breeze       (+4 spd, 0 damage)  65%     Stone Wall    (-2 spd)  12%
  ---   Healing Winds(+3 spd, heal 4)    63%     Granite Barrier(-2 spd) 16%
  ---
  --- Both clamps on the old curve are reached at a gap of four points, so ONE
  --- +5 rider pinned the user at the 0.95 ceiling and the opponent at the 0.30
  --- floor -- a 3.2x swing in landed damage out of a single move, larger than
  --- any damage number in the game can buy. No assignment of damage values
  --- fixes that; it can only be priced around, by giving every speed rider a
  --- value the rest of the catalog has to be deflated to match.
  ---
  --- A share has no saturation point, so a speed rider is worth about what it
  --- says it is worth and the catalog can be priced on damage again.
  --- 0.45. It was zero, and leaving it there is what made the MOVE catalog
  --- unbalanceable rather than merely unbalanced.
  ---
  --- Measured with `./run-balance.sh rank<pool>5`, which plays a roster
  --- carrying one move under test against an identical roster carrying a plain
  --- 4-damage attack instead. At zero the ranking was not a ranking of moves at
  --- all, it was a ranking of SPEED RIDERS:
  ---
  ---   Gale Force   (+5 spd, 3 damage)  68%     Vital Essence (-2 spd)  12%
  ---   Breeze       (+4 spd, 0 damage)  65%     Stone Wall    (-2 spd)  12%
  ---   Healing Winds(+3 spd, heal 4)    63%     Granite Barrier(-2 spd) 16%
  ---
  --- Both clamps on the old curve are reached at a gap of four points, so ONE
  --- +5 rider pinned the user at the 0.95 ceiling and the opponent at the 0.30
  --- floor -- a 3.2x swing in landed damage out of a single move, larger than
  --- any damage number in the game can buy. No assignment of damage values
  --- fixes that; it can only be priced around, by deflating the whole catalog
  --- to match whatever a speed rider is worth.
  ---
  --- A share has no saturation point, so a speed rider is worth about what it
  --- says it is worth and the catalog can be priced on damage again. 0.45
  --- rather than the 0.3 the 2026-08 sweep found, because the pools are bigger
  --- now: a larger health pool makes a health point worth more, and the speed
  --- build goes under unless speed rises with it. Chosen on the matrix
  --- (`./run-balance.sh sp5a` against `sp5b`).
  speedSwing = 0.45,

  --- damage = move.damage * (attackBase + attacker.attack)
  --- `attackBase` is small on purpose: attack has to MULTIPLY, or a stat point
  --- stops mattering by level 10.
  attackBase = 1,
  --- A FLOOR under the attack stat, so that damage grows with a companion even
  --- when its owner never buys attack.
  ---
  --- Health and defense are multiplied on the way into a fight -- twelve HP and
  --- four shield per point -- and a player is handed ten points at every level.
  --- Damage is multiplied by nothing except the attack stat itself, so a build
  --- that spends all ten on health and defense grows an HP pool by 160 a level
  --- against damage that never grows at all. Two of those meet and neither can
  --- finish the other: measured at a 43-round median and a 100% exhaustion rate
  --- at level 20, which is both rosters spent and the rest of the fight decided
  --- by struggling at two damage a swing. That is the fight players report as
  --- unwinnable, and it is what these two exist to end.
  ---
  --- There are two ways to express the floor and only one of them is safe.
  ---
  --- `attackPerLevel` keys it on the LEVEL. It fixes PvP and destroys the bot
  --- ladder, because a player is handed ten points a level while
  --- `Battle.makeOpponent` builds a bot on `10 + level*2` -- about 210 points
  --- against 50 at level 20. A floor sized for the player's pool one-shots the
  --- bot's: measured at 50% first-round knockouts at level 10. It stays at
  --- zero, and stays at all only because the measurement is worth reproducing.
  ---
  --- `attackPerStatPoint` keys it on the fighter's OWN stat budget, frozen in
  --- `Battle.combatant` before a move's +attack rider can feed back into it. It
  --- is therefore large exactly where the health pools are large, which makes
  --- it correct on both curves at once. At 0.2, together with the shield regen
  --- below, every build matchup lands at a 4-14 round median and the level-10
  --- tank mirror drops from 29 rounds to 14.
  ---
  --- Zero reproduces the pre-2026-08-31 behaviour for either. Re-measure with
  --- `./run-balance.sh players` and `./run-balance.sh balance`.
  attackPerLevel = 0,
  --- 0.1, down from 0.2, because the rider fix above took over its job.
  ---
  --- This floor exists so that a build which never bought attack still deals
  --- damage. Riders now do that better: they are measured against a quarter of
  --- the fighter's whole budget rather than against the stat they move, so
  --- Power Up is worth the same to a tank as to a bruiser and a tank can buy
  --- its way out of having no attack, at the cost of the turns it takes.
  ---
  --- Keeping the floor high on top of that made every high-level fight short,
  --- because the floor grows with the budget and so does the attack stat: at
  --- 0.2 a level-20 even build swings for `5 x (39 + 61)`, and the even mirror
  --- measured two rounds. Halving it puts the mirror back at five to six.
  --- Swept with `./run-balance.sh capgrowa` / `capgrowb`.
  attackPerStatPoint = 0.1,
  --- The budget the floor is measured FROM, not from zero.
  ---
  --- Every companion in the game -- a starter, a capture, a bot at level 0 --
  --- begins on ten points. Sizing the floor against the whole budget therefore
  --- tripled damage at level 1, where the health pools are 33 points deep, and
  --- put 18% of bot fights on the ladder at a first-round knockout. Measured
  --- against how far a companion has GROWN, the floor is nothing at level 1 and
  --- forty at a level-20 player, which is the whole point of it.
  attackBudgetBaseline = 10,
  variance = 0.15,          -- +/- this fraction on every swing

  --- Critical hits.
  ---
  --- The counterpart to a miss, and deliberately rarer than one: a miss is the
  --- floor of a swing and this is its ceiling, so a round has an upside worth
  --- watching as well as a downside. Rolled AFTER the hit check and only on
  --- damaging moves — a heal cannot crit, and a swing that missed never got as
  --- far as a damage number to multiply.
  ---
  --- Kept modest on purpose. At 1.6x a crit is a bad round for whoever takes
  --- it, not a coin flip that decides the fight: the median fight is seven
  --- rounds of roughly twelve swings, so about one swing in a fight lands as
  --- one, and two in a row is rare rather than routine.
  criticalChance = 0.09,
  criticalMultiplier = 1.6,

  --- How much of a swing the defense stat takes off, at most.
  ---
  --- Attack and defense are not symmetrical and never were. Attack MULTIPLIES:
  --- it applies to every swing a fighter gives, so its value grows with the
  --- length of the fight. Health and defense buy a POOL, which is spent once.
  --- Over a twelve-swing fight that makes an attack point worth about four
  --- health points, and the win-rate matrix says so out loud -- a pure
  --- defensive build won 8% of its level-10 games against a balanced one and 3%
  --- at level 20, while being the build most new players reach for.
  ---
  --- Raising `hpPerHealth` does not fix that. It scales both builds' pools by
  --- the same factor and leaves the ratio exactly where it was; all it buys is
  --- longer fights. The only thing that changes the ratio is giving the
  --- defensive stats something that multiplies too, which is this.
  ---
  --- Measured against the SHARE of a fighter's stat budget that sits in
  --- defense rather than against the raw number, so it is level-free by
  --- construction and does not need re-tuning every time the level cap moves.
  --- A build with half its points in defense earns the whole reduction; one
  --- with a fifth earns two fifths of it. Zero disables the mechanic.
  --- 0.3, and it had never once been switched on.
  ---
  --- The note above says exactly why it exists and the measurement finally
  --- forced the issue: with the catalog priced and the pools sized, `bruiser`
  --- (attack and health) sat at 65% at level 20 while `even` sat at 35%, and no
  --- pool size moved it -- `hpPerHealth` scales both sides of that ratio and
  --- leaves it where it was.
  ---
  --- Turning it on puts every build row at 45-57% and every cell at 38-63%, at
  --- level 5 and level 20 alike, with a 5-9 round median. Compare
  --- `./run-balance.sh sp20a` (off) against `mit20a` (on).
  ---
  --- 0.3 rather than 0.5: the larger value balances the builds just as well but
  --- takes the tank matchups to 14-20 rounds, and a fight that is fair because
  --- neither side can finish it is not the same thing as a fair fight.
  defenseMitigationMax = 0.3,
  --- The share of its budget a fighter needs in defense to earn the whole
  --- reduction. Half is what an all-in defensive build actually reaches, the
  --- other half having gone to health.
  defenseMitigationFullShare = 0.5,

  --- The pools, and they had to move when the move catalog did.
  ---
  --- 12 and 4 were right for a roster that carried ONE damaging move: the old
  --- four-slot roll drew a single element move and then a boost, a heal and a
  --- neutral, and four of the twenty-four element moves dealt no damage at all.
  --- A three-slot roster whose every element move hits carries one to three,
  --- so the damage arriving per round roughly doubled. Measured at the old
  --- pools with the new catalog: a median of 2-4 rounds against a target of
  --- seven, and up to 32% of fights decided on the first swing.
  ---
  --- Chosen against the fight that actually exists. `./run-balance.sh
  --- hpsweepa|hpsweepb|hpsweepc` sweeps these against `makeOpponent` versus
  --- `makeOpponent`, and that is the LEAST relevant of the three fights in the
  --- game: a bot carries `10 + level*2` stat points and a player carries
  --- `10 + level*10`, so bot-versus-bot at level 20 is fifty points against
  --- fifty when the fight players have is two hundred and ten against fifty, or
  --- against each other. Sized for paper monsters the pools made the tank
  --- mirror unfinishable -- 50 rounds, 100% exhausted, at every level from five
  --- up.
  ---
  --- So they are swept against real growth instead (`./run-balance.sh
  --- growsweepb|growsweepc|growsweepd`, then `capgrowa` once the per-stat cap
  --- moved) and chosen on the acceptance matrix (`./run-balance.sh mit5b`,
  --- `mit20b`), which is the test that says whether a BUILD is worth playing
  --- rather than whether a fight is the right length.
  ---
  --- 32 and 6, together with `speedSwing` 0.45 and `defenseMitigationMax` 0.3.
  --- Every build row, and the median rounds behind them:
  ---
  ---   level 5    tank 52  bruiser 52  glass 48  even 48   (5-9 rounds)
  ---   level 20   tank 51  bruiser 57  glass 48  even 45   (6-9 rounds)
  ---
  --- Every cell is 38-63%, which is the acceptance test at the head of the
  --- build matrix: no row is a dominant build and none is a trap. What was
  --- deployed before this work had a pure defensive build at 3% against a
  --- balanced one at level 20.
  hpPerHealth = 32,         -- max HP = health stat * this
  shieldPerDefense = 6,     -- max shield = defense stat * this
  healPerPoint = 0.03,      -- one health point on a move = this share of max HP

  --- What one point of a move's attack/speed/defense rider is worth, as a
  --- SHARE of the stat it moves.
  ---
  --- Riders used to be flat: `+5 attack` meant five points whoever used it.
  --- That is the same defect `healPerPoint` exists to fix one field further
  --- down -- "a flat heal is a full reset at level 0 and a rounding error at
  --- level 20" -- and nobody had carried the lesson across to the other three
  --- stats. An even build holds about 2 per stat at level 0 and about 52 at
  --- level 20, so a flat +5 was +250% of a starting companion and +10% of a
  --- grown one. Every rider in the catalog was therefore two different moves
  --- depending on who used it, and no single number could be right for both.
  ---
  --- A share is level-free by construction: +5 is about +22% of whatever the
  --- user brought, at every level. Rounded away from zero so a rider is never a
  --- no-op at level 0, where a fraction of a 2-point stat would floor away.
  ---
  --- 0.045, down from 0.06, and the reason is the miss rule. Riders used to be
  --- dropped along with the damage when a swing whiffed; they land now (see the
  --- note in `act`), which made every rider in the catalog worth more without a
  --- number changing. Measured: the boost half of the neutral pool went to
  --- 89% against a plain attack. Scaling the whole rider system down by a
  --- quarter is the correction, because the change that caused it applied to
  --- every rider equally.
  riderPerPoint = 0.045,

  --- How far riders may move a stat in total, as a share of what the fighter
  --- entered the fight with.
  ---
  --- Riders are PERMANENT for the rest of the fight -- nothing reverts them --
  --- so without a ceiling they compound: at the old `moveUses = 3` a companion
  --- holding Swift Wind could spend six turns on it for +30 speed, which is
  --- more speed than a level-20 build owns. The measured consequence was that
  --- the strongest moves in the game were the ones with the biggest riders and
  --- no damage at all.
  ---
  --- At 1.0 a stat may move by one yardstick -- a quarter of the fighter's
  --- whole budget -- in either direction, which leaves a rider worth using two
  --- or three times and never worth spamming. Health is deliberately NOT capped
  --- here: it is hit points rather than a stat, it is already bounded by the
  --- fighter's own pool, and it is spent again the moment it is healed.
  riderCapShare = 1.0,
  --- What a shield recovers at the end of a round in which its owner was NOT
  --- hit, as a share of its cap. Take a single point of damage and you recover
  --- nothing that round.
  ---
  --- A share of the CAP is a share of a number that grows with the defense
  --- stat, so this is the one recovery in the game that gets stronger the less
  --- it is needed: at 0.20 a level-20 defensive build recovered 82 shield a
  --- round, which is more than most swings against it removed. Lowered to 0.08
  --- alongside the attack floor above -- the pair is what the `players` profile
  --- was measured against, and neither of them alone clears the tank mirror.
  shieldRegenShare = 0.08,

  --- How many times each move can be used, as a multiple of its printed count.
  ---
  --- ONE, and the printed counts carry the whole number now. It was three
  --- against printed counts of 1-3, which is 3-9 uses of every move in a fight
  --- whose median is seven rounds: no move ever ran out, so `count` was not a
  --- balance axis at all and a burst move cost exactly what a sustain move
  --- cost. Printed counts are 2-6 in the rebuilt catalog and the multiplier is
  --- gone, so a three-slot roster carries 10-14 uses against ~7 rounds of
  --- which two can be spent on the free actions. There is slack, and a
  --- high-damage move genuinely runs dry before the fight does, which is what
  --- makes `count` the price of `damage`.
  moveUses = 1,
  --- Struggle has to be able to finish somebody, or an exhausted fight never
  --- ends. It is still much worse than any real move.
  struggleDamage = 2,

  --- What a trainer bot is built on, as a share of what a PLAYER of the same
  --- level would be carrying.
  ---
  --- `makeOpponent` used to size a bot at `10 + level*2` while a player grows
  --- on `10 + level*10`, and the comment on it said that was so "a level 12 pet
  --- is not handed a level 1 punching bag". It made the player the one holding
  --- the punching bag, and nothing in this file measured it: `balance` plays
  --- bot against bot and the matrix plays player against player, so the arena
  --- -- the most common fight in the game, and the one a session is spent on --
  --- went unmeasured until `./run-balance.sh arena5` existed.
  ---
  --- What it measured was a 100% win rate for every build at every level, in
  --- two to five rounds. Not a hard fight won; a fight that could not be lost.
  ---
  --- A share of the player's own curve fixes it by construction and cannot
  --- drift the way a second formula does. 0.8 is measured, not guessed: see
  --- `./run-balance.sh botsweep`. `difficulty` still multiplies on top, so a
  --- harder trainer is a real choice again rather than a bigger walkover.
  botBudgetShare = 0.8,

  --- How many turns an NPC will spend on SETUP -- a move that neither hits
  --- nor heals -- in one fight. See `Battle.chooseNpcMove`.
  ---
  --- Two, because riders are capped at one yardstick per stat and two uses of
  --- a strong one reaches that ceiling. A third buff is a wasted turn by
  --- construction, and a bot that takes it is not playing the game the way
  --- the move is priced.
  npcSetupTurns = 2,

  --- How long a PvP round waits for the other player before it can be forced.
  ---
  --- Without this a fight stalls forever the moment somebody closes their
  --- laptop: their half of the round never arrives, and the player who did move
  --- can only forfeit — losing the win and the paid session to someone who
  --- simply stopped playing.
  pvpMoveDeadline = 3 * 60 * 1000,

  --- A fight that reaches this many rounds is decided on remaining health.
  ---
  --- Without it a fight can genuinely run forever: two defensive companions
  --- regenerate more shield per round than a struggle can remove, and both
  --- sides sit at full health indefinitely. Measured at over two thousand
  --- rounds with no end in sight. The only escape was forfeiting the whole
  --- paid session.
  roundCap = 50,
}

local T = Battle.TUNING

--- C is injected rather than required so the test harness can supply a stub.
local C

--- Every move in the game, by name, built on first use.
---
--- Move names are unique across the pools, which is what makes a name a
--- sufficient key for a stored move -- see `Battle.compactMoves`.
local MOVE_BY_NAME = nil

--- The monster index, keyed by entry number. Built on first use like the move
--- index above, and reset by `configure` for the same reason: the test harness
--- swaps `C` between suites.
local INDEX_BY_NO = nil

function Battle.configure(constants)
  C = constants
  MOVE_BY_NAME = nil
  INDEX_BY_NO = nil
end

-- Helpers -------------------------------------------------------------------

local function clone(t)
  if type(t) ~= "table" then return t end
  local out = {}
  for k, v in pairs(t) do out[k] = clone(v) end
  return out
end
Battle.clone = clone

-- Stored moves --------------------------------------------------------------
--
-- A move is nine fields, and eight of them -- type, rarity, damage, attack,
-- speed, defense, health, and the name itself -- are a verbatim copy of the
-- entry in `C.MOVE_POOLS`. Only `count`, the uses remaining, ever differs from
-- the definition.
--
-- Companions used to carry the whole thing. Half of every companion record was
-- therefore a duplicate of a constant: 511 bytes of 1025, measured, multiplied
-- by every companion in the process, sitting in the Lua heap that the node
-- photographs on every slot.
--
-- So the store keeps `{ count = n }` keyed by name, and the definition is put
-- back at the two doors where a move is actually needed: `Battle.combatant`,
-- which builds the fighter a round is resolved against, and the view layer,
-- which hands a companion to a client. Nothing between those doors reads a
-- move's numbers.

local function moveIndex()
  if MOVE_BY_NAME then return MOVE_BY_NAME end
  MOVE_BY_NAME = {}
  for _, pool in pairs((C or {}).MOVE_POOLS or {}) do
    for name, def in pairs(pool) do MOVE_BY_NAME[name] = def end
  end
  return MOVE_BY_NAME
end

--- The definition behind a move name, or nil if the pools do not know it.
function Battle.moveDef(name) return moveIndex()[name] end

--- One stored move, expanded into the shape everything else expects.
function Battle.hydrateMove(name, stored)
  local def = moveIndex()[name]
  local out = def and clone(def) or {}
  -- An unrecognised name keeps whatever was stored under it rather than
  -- becoming an empty move: a pool renamed in a later build must not silently
  -- disarm every companion that rolled from it.
  if not def and type(stored) == "table" then out = clone(stored) end
  out.name = name
  local count = type(stored) == "table" and stored.count or nil
  out.count = math.tointeger(tonumber(count)) or math.tointeger(tonumber(out.count)) or 0
  return out
end

--- A whole moveset, expanded. Always a NEW table: callers mutate what they get.
function Battle.hydrateMoves(moves)
  local out = {}
  for name, stored in pairs(moves or {}) do
    out[name] = Battle.hydrateMove(name, stored)
  end
  return out
end

--- A whole moveset, reduced to what actually varies.
---
--- Accepts either shape, so it doubles as the migration: a record written by an
--- older build arrives carrying full moves and is compacted on the way in.
function Battle.compactMoves(moves)
  local out = {}
  for name, stored in pairs(moves or {}) do
    if moveIndex()[name] then
      local count = type(stored) == "table" and stored.count or nil
      out[name] = { count = math.tointeger(tonumber(count)) or 0 }
    else
      out[name] = clone(stored)
    end
  end
  return out
end

--- A stored roster, brought into line with the CURRENT rules.
---
--- Every restore path lands here: a legacynet export, a redeploy migration, a
--- snapshot from the previous deployment, an admin fixture. All of them can be
--- carrying a four-move roster drawn from pools that no longer exist as pools,
--- because that is what the game issued until the slot count changed.
---
--- Trimming is not "a restore taking something away" -- the rule CLAUDE.md
--- states -- because the alternative is worse in both directions: a four-move
--- companion has a move its own card cannot print, and it fights with a third
--- more roster than anything issued today. What the rule actually forbids is
--- an arbitrary loss, so the trim is ordered: the species signature is kept
--- first, then the rarest, and a damaging move outranks a support move at equal
--- rarity so a trim can never disarm a companion.
---
--- A roster SHORTER than the slot count is left alone. An admin fixture with
--- one move is a real shape, and inventing two more would be the restore adding
--- something, which is the same rule from the other side.
function Battle.normaliseRoster(moves, element, opts)
  opts = opts or {}
  local slots = math.max(1, math.tointeger((C or {}).MOVE_SLOTS) or 3)
  local compact = Battle.compactMoves(moves)

  local names = {}
  for name in pairs(compact) do names[#names + 1] = name end
  if #names <= slots then return compact end
  table.sort(names)

  local signature = Battle.signatureMove(element, opts)
  local function rank(name)
    if name == signature then return -1 end
    local def = Battle.moveDef(name)
    if not def then return 99 end                      -- unknown: drop first
    -- Rarity 1 is the rare tier, so a smaller number sorts earlier. The half
    -- point is the tie-break: at equal rarity a move that hits is kept over one
    -- that does not.
    return (def.rarity or 3) + ((def.damage or 0) > 0 and 0 or 0.5)
  end

  -- Insertion sort by rank, then by name, because Luerl's `table.sort` does not
  -- take a comparator.
  for i = 2, #names do
    local held = names[i]
    local heldRank = rank(held)
    local j = i - 1
    while j >= 1 and (rank(names[j]) > heldRank
      or (rank(names[j]) == heldRank and names[j] > held)) do
      names[j + 1] = names[j]
      j = j - 1
    end
    names[j + 1] = held
  end

  local out = {}
  for i = 1, slots do out[names[i]] = compact[names[i]] end
  return out
end

-- The isolated fleet uses this explicit 32-bit stream so Lua and Rust execute
-- byte-for-byte reproducible combat without depending on Luerl/Erlang's host
-- PRNG implementation. The monolith keeps its existing math.random stream
-- unless a caller opts in with seedDeterministic.
local RNG_STATE = nil
function Battle.seedDeterministic(value)
  local seed = math.tointeger(tonumber(value)) or 1
  seed = seed & 0xffffffff
  if seed == 0 then seed = 0x6d2b79f5 end
  RNG_STATE = seed
end

local function nextDeterministic()
  local x = RNG_STATE
  x = (x ~ ((x << 13) & 0xffffffff)) & 0xffffffff
  x = (x ~ (x >> 17)) & 0xffffffff
  x = (x ~ ((x << 5) & 0xffffffff)) & 0xffffffff
  RNG_STATE = x
  return x
end

local function rand(low, high)
  low = math.tointeger(low) or 0
  high = math.tointeger(high) or low
  if high <= low then return low end
  if RNG_STATE ~= nil then
    return low + (nextDeterministic() % (high - low + 1))
  end
  return math.random(low, high)
end
Battle.rand = rand

local function effectiveness(moveType, defenderElement)
  if not moveType or not defenderElement then return 1.0 end
  local row = C.EFFECTIVENESS[moveType]
  if not row then return 1.0 end          -- boost / heal / normal are neutral
  return row[defenderElement] or 1.0
end
Battle.effectiveness = effectiveness

--- Faster attackers land more; slower ones are punished harder than they are
--- rewarded, which is what makes the speed stat worth buying.
local function hitChance(attackerSpeed, defenderSpeed)
  local a = math.max(0, attackerSpeed or 0)
  local d = math.max(0, defenderSpeed or 0)
  local modifier
  if T.speedSwing > 0 then
    -- The gap as a share of the two speeds together: -1 when the attacker has
    -- none of the speed in the fight, +1 when it has all of it, and every
    -- point in between actually moves it.
    local total = a + d
    modifier = total > 0 and ((a - d) / total) * T.speedSwing or 0
  else
    local diff = a - d
    if diff > 0 then
      modifier = math.min(0.25, diff * 0.08)
    else
      modifier = math.max(-0.40, diff * 0.10)
    end
  end
  local chance = T.baseHitChance + modifier
  return math.max(T.minHitChance, math.min(T.maxHitChance, chance))
end
Battle.hitChance = hitChance

-- Combatants ----------------------------------------------------------------

--- Turn a monster record into a combatant: a working copy with battle-only
--- fields. The source monster is never mutated — the original passed the live
--- record straight in, so a fight permanently drained the pet's move counts.
function Battle.combatant(monster, side, address)
  local m = clone(monster)
  m.side = side
  m.address = address
  m.maxHealthPoints = math.max(1, (m.health or 1) * T.hpPerHealth)
  m.healthPoints = m.maxHealthPoints
  m.maxShield = math.max(0, (m.defense or 0) * T.shieldPerDefense)
  m.shield = m.maxShield
  -- Base stats are kept so the client can show how far a buff has drifted.
  m.baseAttack, m.baseDefense, m.baseSpeed = m.attack, m.defense, m.speed
  -- Everything the companion has been given, frozen before the fight moves it.
  m.statBudget = (m.attack or 0) + (m.defense or 0) + (m.speed or 0) + (m.health or 0)
  -- The fighter gets the FULL moves, rebuilt from the pools. This is the door
  -- combat comes through -- `act` reads damage, type and rarity off what is
  -- here -- and it is a copy, which is what keeps a fight from draining the
  -- pet's own counts.
  m.moves = Battle.hydrateMoves(monster.moves)
  for name, move in pairs(m.moves) do
    move.name = name
    move.count = math.max(1, (math.tointeger(move.count) or 1) * T.moveUses)
  end
  -- The two actions every companion has and no companion carries. Tracked as
  -- "spent" flags on the FIGHTER rather than as moves on the record: they cost
  -- no slot, they are identical for everybody, and storing them per companion
  -- would put two more names into a published map that every message pays for
  -- five times over.
  m.freeUsed = {}
  return m
end

-- Free actions --------------------------------------------------------------
--
-- Every companion in the game can Rally and can Mend, once each per battle,
-- without either one occupying one of its three move slots.
--
-- They exist because three slots is not enough room to carry a whole game. A
-- rolled roster used to have to contain its own answer to being low on health,
-- and about one companion in twelve simply did not roll one -- measured on the
-- old four-slot roll, which drew from `boost`, `heal` and `normal` and skipped
-- one of the three a quarter of the time. At three slots that hole would have
-- been much bigger, and the fix cannot be "guarantee a heal in the roll"
-- without spending a third of every roster on the same move.
--
-- So the baseline is universal and the POOLS are free to be interesting. A
-- drawn heal no longer has to be the thing that stops you dying; it has to be
-- better than Mend, which is a much easier thing to price.
--
-- They are opposed on purpose, and neither is strictly good:
--
--   Rally  attack and speed up, health down   -- pay life for tempo
--   Mend   health and defense up, speed down  -- pay tempo for life
--
-- The real cost of both is the ROUND. Spending a turn on Rally is a turn you
-- did not spend on damage, and that is the whole price; it needs no other.
--
-- The definitions live in `constants.lua` so the catalog publishes them and the
-- client can draw them from the same source the engine reads.

--- The free action of this name, ready to resolve, or nil if it is not one.
function Battle.freeAction(name)
  local defs = (C or {}).FREE_ACTIONS
  local def = defs and defs[name]
  if not def then return nil end
  local out = clone(def)
  out.name = name
  out.free = true
  out.count = math.maxinteger
  return out
end

--- Whether a fighter still has this free action. Unknown names are not free
--- actions and answer false rather than raising.
function Battle.freeActionReady(monster, name)
  if not Battle.freeAction(name) then return false end
  return not (monster.freeUsed or {})[name]
end

--- What an absent player does. No damage, no riders, no cost — it is a pass,
--- not a punishment, so forcing a round is fair to whoever wandered off.
function Battle.hesitate()
  return {
    name = "Hesitated",
    type = "normal",
    rarity = 0,
    count = math.maxinteger,
    damage = 0, attack = 0, speed = 0, defense = 0, health = 0,
  }
end

function Battle.struggle(monster)
  return {
    name = "Struggle",
    type = "normal",
    rarity = 0,
    count = math.maxinteger,
    damage = T.struggleDamage, attack = 0, speed = 0, defense = 0, health = 0,
  }
end

function Battle.hasMovesLeft(monster)
  for _, move in pairs(monster.moves or {}) do
    if (math.tointeger(move.count) or 0) > 0 then return true end
  end
  return false
end

--- Pick a move for an NPC. Prefers damage when the opponent is nearly dead and
--- healing when it is itself hurt, so bot fights are not pure coin flips.
function Battle.chooseNpcMove(npc, opponent)
  local hurt = npc.healthPoints <= npc.maxHealthPoints * 0.35
  local finishing = opponent.healthPoints <= opponent.maxHealthPoints * 0.25

  -- What a move is FOR, read off its own numbers: anything that hits is an
  -- attack, anything that restores health is for being hurt, and anything that
  -- does neither is setup. Classified by SHAPE rather than by name, so adding a
  -- move -- or a third free action in `constants.lua` -- does not mean editing
  -- the engine.
  --
  -- The roster is filtered BEFORE it is picked from, and that is the whole
  -- change here. The chooser used to offer every move with a use left and then
  -- pick uniformly, which on a three-slot roster holding two support moves
  -- meant two turns in three spent not attacking. Measured, that put every
  -- boost move in the game at 9-34% against a plain attack
  -- (`./run-balance.sh rankboost5`) -- which is a statement about the bot, not
  -- about the move. A buff is worth a turn once and worth nothing the fourth
  -- time; a heal is worth a turn when you are losing and not before.
  --
  -- It matters twice over: it is the bot every arena and hunt fight is played
  -- against, and it is the player-substitute every balance number in this file
  -- was measured through.
  local setupsLeft = math.max(0, (T.npcSetupTurns or 2) - (npc.setupsUsed or 0))

  local available = {}
  local function offer(move, name)
    move.name = name or move.name
    if (move.damage or 0) > 0 then
      available[#available + 1] = move
    elseif (move.health or 0) > 0 then
      if hurt and not finishing then available[#available + 1] = move end
    elseif setupsLeft > 0 and not hurt and not finishing then
      available[#available + 1] = move
    end
  end

  local availableNames = {}
  for name, move in pairs(npc.moves or {}) do
    if (math.tointeger(move.count) or 0) > 0 then
      availableNames[#availableNames + 1] = name
    end
  end
  table.sort(availableNames)
  for _, name in ipairs(availableNames) do offer(npc.moves[name], name) end

  -- The free actions, offered on the turns they are for. A bot that ignored
  -- them would hand every player a two-action head start.
  local freeNames = {}
  for name in pairs((C or {}).FREE_ACTIONS or {}) do freeNames[#freeNames + 1] = name end
  table.sort(freeNames)
  for _, name in ipairs(freeNames) do
    if Battle.freeActionReady(npc, name) then offer(Battle.freeAction(name), name) end
  end

  -- Nothing worth doing and nothing free left: struggle. Checked after the free
  -- actions so a spent roster can still Mend, and after the filter so a bot
  -- holding only a buff it should not use still swings.
  if #available == 0 then
    for _, name in ipairs(availableNames) do
      local move = npc.moves[name]
      move.name = name
      available[#available + 1] = move
    end
  end
  if #available == 0 then return Battle.struggle(npc) end

  local preferred = {}
  for _, move in ipairs(available) do
    if finishing and move.damage > 0 then
      preferred[#preferred + 1] = move
    elseif hurt and not finishing and move.health > 0 then
      preferred[#preferred + 1] = move
    end
  end
  local pool = #preferred > 0 and preferred or available
  local chosen = pool[rand(1, #pool)]
  if (chosen.damage or 0) <= 0 and (chosen.health or 0) <= 0 then
    npc.setupsUsed = (npc.setupsUsed or 0) + 1
  end
  return chosen
end

-- Resolution ----------------------------------------------------------------

local function applyDamage(target, amount)
  local shieldDamage = 0
  if target.shield > 0 then
    shieldDamage = math.min(amount, target.shield)
    target.shield = target.shield - shieldDamage
    amount = amount - shieldDamage
  end
  local healthDamage = 0
  if amount > 0 then
    healthDamage = amount
    target.healthPoints = math.max(0, target.healthPoints - healthDamage)
  end
  return shieldDamage, healthDamage
end

--- The yardstick a rider is measured against: one stat's worth of the
--- fighter's whole budget.
---
--- NOT the stat the rider moves, and that distinction is the whole design.
--- Measuring `+8 attack` against the user's own attack means a build that left
--- attack at 1 gets +1 from it, which is the opposite of what a boost move is
--- for -- the move that exists to answer a hole in a build must not be worth
--- least to the build that has the hole. Measured against the budget it is
--- worth the same to everybody, so Power Up is the tank's answer to having no
--- attack, at the price of the two turns it takes.
---
--- It is still level-free, which is the reason riders stopped being flat: an
--- even build holds about 2 per stat at level 0 and about 52 at level 20, so a
--- flat `+5` was +250% of a starting companion and +10% of a grown one, and no
--- single number could be right for both. The budget grows with the companion,
--- so a share of it does too.
local function riderYardstick(user)
  return math.max(1, math.floor((math.tointeger(user.statBudget) or 4) / 4))
end

--- One rider point, in stat points. Rounded away from zero so a printed rider
--- is never a no-op: 0.06 of a level-0 yardstick floors to nothing, and a move
--- whose rider does nothing is a lie on the card.
local function riderPoints(points, yardstick)
  if points == 0 then return 0 end
  local size = math.max(1, math.floor(math.abs(points) * T.riderPerPoint * yardstick + 0.5))
  return points > 0 and size or -size
end

--- Apply one rider, clamped by `TUNING.riderCapShare`.
---
--- The clamp is on the TOTAL distance from the stat the fighter entered with,
--- not on the single move, so two uses of a strong rider and six uses of a weak
--- one run into the same wall. Returns the delta actually applied, which is
--- what the turn log reports -- a move that hit the ceiling has to be able to
--- say it did, or the client draws a buff that did not happen.
local function applyRider(user, key, baseKey, points)
  local yardstick = riderYardstick(user)
  local delta = riderPoints(points, yardstick)
  if delta == 0 then return 0 end
  local base = user[baseKey] or 0
  local room = math.floor(yardstick * T.riderCapShare)
  local ceiling = base + room
  local floor = math.max(0, base - room)
  local before = user[key] or 0
  local after = math.max(floor, math.min(ceiling, before + delta))
  user[key] = after
  return after - before
end

--- Stat riders apply to whoever used the move. Defense also moves the shield,
--- and health is a heal or a cost in HP, never a change to the base stat.
local function applyStatChanges(user, move)
  local changed = {}
  if move.attack ~= 0 then
    local delta = applyRider(user, "attack", "baseAttack", move.attack)
    if delta ~= 0 then changed.attack = delta end
  end
  if move.speed ~= 0 then
    local delta = applyRider(user, "speed", "baseSpeed", move.speed)
    if delta ~= 0 then changed.speed = delta end
  end
  if move.defense ~= 0 then
    local delta = applyRider(user, "defense", "baseDefense", move.defense)
    if delta ~= 0 then
      -- The shield moves with the stat that sizes it, by the points actually
      -- applied rather than the points printed on the move.
      user.maxShield = math.max(user.maxShield, user.defense * T.shieldPerDefense)
      user.shield = math.max(0, user.shield + delta * T.shieldPerDefense)
      changed.defense = delta
    end
  end
  if move.health ~= 0 then
    -- Healing is a fraction of the user's own pool, not a flat number. A flat
    -- heal is a full reset at level 0 and a rounding error at level 20.
    local delta = math.floor(move.health * T.healPerPoint * user.maxHealthPoints)
    if delta > 0 then
      user.healthPoints = math.min(user.maxHealthPoints, user.healthPoints + delta)
    else
      -- A self-cost can bring you low but never kills you outright.
      user.healthPoints = math.max(1, user.healthPoints + delta)
    end
    changed.health = move.health
  end
  return changed
end

--- The constant a move's power is multiplied against, before the attack stat.
--- See `TUNING.attackPerLevel` for why it is not simply `attackBase`.
local function attackFloor(attacker)
  local level = math.max(0, math.tointeger(attacker.level) or 0)
  -- The budget is read from the stats the fighter ENTERED with, so a move's own
  -- +attack rider cannot feed back into the floor and compound itself.
  local budget = math.max(0,
    (math.tointeger(attacker.statBudget) or 0) - T.attackBudgetBaseline)
  return T.attackBase + T.attackPerLevel * level + T.attackPerStatPoint * budget
end

--- What fraction of a swing survives the defender's defense stat.
--- One when the mechanic is off, so the multiplication is a no-op.
---
--- Measured from the defense the fighter ENTERED with, not the one it has now,
--- for the same reason `attackFloor` reads a frozen `statBudget`: the budget in
--- the denominator is frozen, so reading a live numerator against it lets a
--- rider buy mitigation the build never paid for. It compounds, too -- a
--- defense rider already adds shield, and it was silently buying damage
--- reduction on top.
---
--- Measured with `./run-balance.sh rankrock5`: reading the live stat made
--- `Stone Wall` -- 3 damage, +4 defense -- the single best move in the game at
--- 86.8%, above every signature. Reading the base puts it back in its tier.
--- This is a property of the BUILD; the shield is the part a rider moves.
local function mitigation(defender)
  if T.defenseMitigationMax <= 0 then return 1.0 end
  local budget = math.max(1, math.tointeger(defender.statBudget) or 1)
  local full = math.max(0.01, T.defenseMitigationFullShare)
  local base = defender.baseDefense or defender.defense or 0
  local share = math.min(1.0, (base / budget) / full)
  return 1.0 - T.defenseMitigationMax * share
end

--- One monster acts. Returns the log entry the client renders.
local function act(attacker, defender, move)
  if move.free then
    -- A free action is spent on the FIGHTER, not decremented on a stored move:
    -- there is no stored move to decrement.
    attacker.freeUsed = attacker.freeUsed or {}
    attacker.freeUsed[move.name] = true
  elseif move.count ~= math.maxinteger then
    move.count = math.max(0, (math.tointeger(move.count) or 0) - 1)
  end

  local entry = {
    attacker = attacker.side,
    attackerAddress = attacker.address,
    monsterName = attacker.name,
    move = move.name,
    moveType = move.type,
    moveRarity = move.rarity or 0,
    missed = false,
    critical = false,
    shieldDamage = 0,
    healthDamage = 0,
    statsChanged = {},
    superEffective = false,
    notEffective = false,
  }

  -- A miss is a blow that did not connect. It is NOT the fighter failing to do
  -- anything: the stat riders still apply, and the move is still spent.
  --
  -- That used to be the same statement, because only damaging moves could whiff
  -- and a heal or a buff always landed. Then the support half of the neutral
  -- pool was given two damage -- a rider-only move measured 27-50% against a
  -- plain attack, a whole slot of a three-slot roster that cannot win a fight
  -- on its own -- and two damage was enough to make every buff in the game
  -- missable. A Power Up that whiffs and grants nothing is a wasted turn out of
  -- a resource the player only has four of, decided by a roll they cannot see,
  -- on a move whose damage is not the point of it.
  --
  -- So the roll gates the DAMAGE and nothing else. The riders on a real attack
  -- are small enough that this is worth almost nothing to them, and it is worth
  -- everything to a move whose rider is the reason to draw it.
  local missed = move.damage > 0
    and rand(1, 100) > hitChance(attacker.speed, defender.speed) * 100
  entry.missed = missed

  if move.damage > 0 and not missed then
    local mult = effectiveness(move.type, defender.elementType)
    -- Attack multiplies rather than adds, so a stat point stays worth something
    -- at level 20. Variance is a flat percentage band for the same reason.
    local raw = move.damage * (attackFloor(attacker) + (attacker.attack or 0))
    local swing = 1.0 + (rand(0, 200) - 100) / 100 * T.variance
    -- The crit roll is its own roll, taken after the swing is known to land.
    -- Folding it into `variance` would have made every swing slightly bigger
    -- instead of one swing in eleven much bigger, which is the whole point.
    entry.critical = rand(1, 100) <= math.floor(T.criticalChance * 100)
    local crit = entry.critical and T.criticalMultiplier or 1.0
    local damage = math.max(1, math.floor(raw * mult * swing * crit * mitigation(defender)))
    entry.shieldDamage, entry.healthDamage = applyDamage(defender, damage)
    entry.superEffective = mult > 1.0
    entry.notEffective = mult < 1.0
  end

  entry.statsChanged = applyStatChanges(attacker, move)
  entry.attackerState = Battle.snapshot(attacker)
  entry.defenderState = Battle.snapshot(defender)
  return entry
end

function Battle.snapshot(m)
  return {
    side = m.side,
    name = m.name,
    healthPoints = m.healthPoints,
    maxHealthPoints = m.maxHealthPoints,
    shield = m.shield,
    maxShield = m.maxShield,
    attack = m.attack,
    defense = m.defense,
    speed = m.speed,
    elementType = m.elementType,
  }
end

--- Who swings first: speed plus a d5, coin flip on a tie.
local function challengerFirst(a, b)
  local ra = (a.speed or 0) + rand(1, 5)
  local rb = (b.speed or 0) + rand(1, 5)
  if ra == rb then return rand(1, 2) == 1 end
  return ra > rb
end

--- Resolve a move name against a combatant, or return nil plus a reason.
function Battle.selectMove(monster, moveName)
  -- Checked BEFORE the struggle rule and before the roster, so a free action is
  -- usable whether or not the roster still has uses in it. A companion that has
  -- spent every move may still Mend; that is the point of it not being a move.
  local free = Battle.freeAction(moveName)
  if free then
    if (monster.freeUsed or {})[moveName] then
      return nil, "'" .. moveName .. "' is already spent this battle"
    end
    return free
  end
  if moveName == "struggle" or moveName == "Struggle" then
    if Battle.hasMovesLeft(monster) then
      return nil, "Cannot struggle while other moves remain"
    end
    return Battle.struggle(monster)
  end
  local move = monster.moves[moveName]
  if not move then return nil, "Unknown move '" .. tostring(moveName) .. "'" end
  if (math.tointeger(move.count) or 0) <= 0 then
    return nil, "'" .. moveName .. "' has no uses remaining"
  end
  move.name = moveName
  return move
end

--- Play one full round. Both moves resolve; a monster reduced to 0 HP does not
--- get to answer. Returns the log entries for the round.
function Battle.resolveRound(battle, challengerMove, accepterMove)
  local a, b = battle.challenger, battle.accepter
  local entries = {}

  local first, second, firstMove, secondMove
  if challengerFirst(a, b) then
    first, second, firstMove, secondMove = a, b, challengerMove, accepterMove
  else
    first, second, firstMove, secondMove = b, a, accepterMove, challengerMove
  end

  entries[#entries + 1] = act(first, second, firstMove)
  if second.healthPoints > 0 then
    entries[#entries + 1] = act(second, first, secondMove)
  end

  battle.round = (battle.round or 0) + 1
  battle.turns = battle.turns or {}
  for _, e in ipairs(entries) do
    e.round = battle.round
    battle.turns[#battle.turns + 1] = e
  end

  -- Shields recover only for a fighter that came through the round untouched.
  --
  -- "Untouched" means no blow LANDED on them: a miss is not a hit, and neither
  -- is a move that dealt nothing. Whoever took so much as a point recovers
  -- nothing that round, which is what stops this from healing the fighter being
  -- beaten on, and what keeps two defensive companions from regenerating past
  -- each other into a fight that cannot end.
  --
  -- That stalemate is why the old unconditional trickle had to be capped below
  -- a struggle's damage. Making the regen conditional removes the stalemate at
  -- the source, so the number itself no longer has to be tiny to be safe.
  local wasHit = { challenger = false, accepter = false }
  for _, e in ipairs(entries) do
    if not e.missed and (e.shieldDamage + e.healthDamage) > 0 then
      wasHit[e.attacker == "challenger" and "accepter" or "challenger"] = true
    end
  end

  for _, m in ipairs({ a, b }) do
    if m.healthPoints > 0 and not wasHit[m.side] then
      local regen = math.ceil(m.maxShield * T.shieldRegenShare)
      m.shield = math.min(m.maxShield, m.shield + regen)
    end
  end

  if a.healthPoints <= 0 or b.healthPoints <= 0 then
    battle.status = "ended"
    -- Both down in the same round is a loss for the challenger; the defender
    -- survives a mutual knockout.
    battle.winner = (b.healthPoints <= 0 and a.healthPoints > 0) and "challenger" or "accepter"
  elseif battle.round >= T.roundCap then
    -- Time. Whoever is in better shape takes it; a dead-level draw goes to the
    -- defender, same as a mutual knockout.
    battle.status = "ended"
    battle.timedOut = true
    local aShare = a.healthPoints / math.max(1, a.maxHealthPoints)
    local bShare = b.healthPoints / math.max(1, b.maxHealthPoints)
    battle.winner = aShare > bShare and "challenger" or "accepter"
  end

  -- The log is published on every message and grows about a kilobyte a round,
  -- so only the recent history is kept. The full fight is still visible round
  -- by round as it happens; what is dropped is the far past of a long one.
  --
  -- `roundCap * 2` is not a guess and must not be "optimised" down: a round
  -- appends one entry PER COMBATANT, so a fight that runs to the cap produces
  -- exactly this many. The bound therefore never fires in a legal fight -- it
  -- is a safety net, and the log grows monotonically for the whole battle.
  --
  -- That monotonicity is load-bearing. Clients (and e2e) detect "a new round
  -- resolved" by the log getting longer; a smaller keep makes it stop growing
  -- mid-fight and the round reads as never having happened. Tried at 10 and it
  -- broke the battle at round six, exactly when 6*2 crossed it.
  --
  -- The size this is blamed for is also worst-case only. A profiler run drives
  -- one battle to fifty rounds and lands at ~62 KB; the median fight is seven
  -- rounds, about fourteen entries and ~8.7 KB, which is what players actually
  -- pay. Shrink the PER-ENTRY cost if this needs to be cheaper, not the count.
  local keep = T.roundCap * 2
  if #battle.turns > keep then
    local trimmed = {}
    for i = #battle.turns - keep + 1, #battle.turns do
      trimmed[#trimmed + 1] = battle.turns[i]
    end
    battle.turns = trimmed
    battle.turnsTrimmed = true
  end

  return entries
end

-- Construction --------------------------------------------------------------

--- Build an NPC scaled to the player, so a level 12 pet is not handed a level 1
--- punching bag and a level 0 pet is not executed. The original always spawned
--- a level 1 monster with randomly rolled stats regardless of who it faced.
function Battle.makeOpponent(playerLevel, opts)
  opts = opts or {}
  local factions = C.FACTIONS
  local faction = opts.faction and C.FACTION_BY_NAME[opts.faction]
    or factions[rand(1, #factions)]

  local level = math.max(0, math.tointeger(playerLevel) or 0)
  local difficulty = opts.difficulty or 1.0
  -- Stats track the PLAYER'S curve -- ten at level 0 and `C.LEVEL_UP_POINTS`
  -- more every level -- taken at `botBudgetShare` of it. The old formula was a
  -- second, much flatter curve (`10 + level*2`), which is how the arena became
  -- a fight nobody could lose without anything noticing.
  local perLevel = math.tointeger((C or {}).LEVEL_UP_POINTS) or 10
  local budget = math.max(4,
    math.floor((10 + level * perLevel) * T.botBudgetShare * difficulty))
  local stats = { attack = 1, defense = 1, speed = 1, health = 1 }
  local names = { "attack", "defense", "speed", "health" }
  local remaining = budget - 4
  while remaining > 0 do
    local pick = names[rand(1, 4)]
    stats[pick] = stats[pick] + 1
    remaining = remaining - 1
  end

  local monster = {
    entryNo = faction.monster.entryNo,
    name = faction.monster.name,
    image = faction.monster.image,
    sprite = faction.monster.sprite,
    elementType = faction.element,
    faction = faction.name,
    level = level,
    attack = stats.attack,
    defense = stats.defense,
    speed = stats.speed,
    health = stats.health,
    moves = Battle.rollMoves(faction.element, { entryNo = faction.monster.entryNo }),
  }
  return monster
end

--- The moves a companion is born with.
---
--- THREE slots, and the first of them is not a roll.
---
--- What the old four-slot roll did was draw one element move, then one each
--- from `boost`, `heal` and `normal` -- except a quarter of the time, when it
--- drew a second element move and dropped one of the three support pools. That
--- shape had three problems and all of them are measurable:
---
---   * SPECIES DID NOTHING. Every fire companion drew from the same six fire
---     moves, so a FireFox and any other fire creature differed by artwork and
---     nothing else. The monster index has carried a `basicMove` and an
---     `advancedMove` for every one of its ninety-three entries the whole time,
---     published to the catalog, read by `BattleScene` to choose the signature
---     attack animation -- and never once read by the roller. A companion could
---     go a whole fight without performing its own signature move, because it
---     had no way to have drawn it.
---
---   * RARITY WAS DECORATION. The pick inside a pool was uniform, so the
---     `rarity` printed on the card and shown in the move grid was a label with
---     nothing behind it. Measured with `./run-balance.sh rank<pool>5`: the best
---     move in the water pool was rarity 2, the best in the heal pool was
---     rarity 3, and rarity 1 `Heal` came fourth of six at 23.5%.
---
---   * THE POOL WAS THE SLOT. Drawing exactly one boost and exactly one heal
---     means every companion has the same shape, so the only thing a roll could
---     say about a creature was which of six it got in each fixed category.
---
--- So: slot one is the SPECIES' own move, taken from the monster index and
--- always damaging. Slots two and three are drawn from the element pool or the
--- merged neutral pool, weighted by rarity, with no per-pool quota at all --
--- which is what lets a roster come out three-attacks aggressive, or one attack
--- and two support, rather than always being one of each.
---
--- That is only safe because Rally and Mend are free (see `Battle.freeAction`).
--- A roll may spend all three slots on attacks precisely because it is no
--- longer responsible for supplying the companion's only heal.
function Battle.rollMoves(element, opts)
  opts = opts or {}
  local slots = math.max(1, math.tointeger((C or {}).MOVE_SLOTS) or 3)
  -- An element with no pool would raise here. It can only arrive via an admin
  -- write, but a bad admin write should be an error message, not a dead
  -- process.
  local elementPool = C.MOVE_POOLS[element] and element or nil
  local chosen, order = {}, {}

  local function take(name)
    if not name or chosen[name] then return false end
    local def = Battle.moveDef(name)
    if not def then return false end
    chosen[name] = clone(def)
    chosen[name].name = name
    order[#order + 1] = name
    return true
  end

  -- Slot one: the species' signature, guaranteed.
  take(Battle.signatureMove(element, opts))

  -- Slots two and three. The element pool is drawn from `MOVE_ELEMENT_BIAS`
  -- percent of the time and the neutral pool the rest, so a companion reads as
  -- its element without every slot being spent on proving it.
  --
  -- `advancedMove` is not guaranteed the way `basicMove` is -- that would spend
  -- two of three slots on the index and leave a single roll -- but its weight is
  -- multiplied by `MOVE_SIGNATURE_BOOST`, so a companion showing BOTH of its
  -- signature moves is a roll worth having rather than an impossibility.
  local boost = nil
  local entry = Battle.indexEntry(opts.entryNo)
  if entry then boost = entry.advancedMove end
  local guard = 0
  while #order < slots and guard < 100 do
    guard = guard + 1
    local from = "neutral"
    if elementPool and rand(1, 100) <= ((C or {}).MOVE_ELEMENT_BIAS or 40) then
      from = elementPool
    end
    if not C.MOVE_POOLS[from] then from = elementPool or "neutral" end
    take(Battle.drawMove(from, chosen, boost))
  end

  -- A moveset with nothing that deals damage is a dead end: two such companions
  -- cannot hurt each other until every move is spent and both are reduced to
  -- struggling for two damage a swing. The signature is damaging by
  -- construction, so this cannot fire for any companion the index knows about.
  -- It is here for the ones it does not -- a bot built from a faction, and
  -- anything an admin writes by hand.
  local armed = false
  for _, move in pairs(chosen) do
    if (move.damage or 0) > 0 then armed = true break end
  end
  if not armed and #order > 0 then
    local replacement = Battle.drawMove(elementPool or "neutral", nil, nil, true)
    if replacement then
      -- Displace whichever move is cheapest to lose: the highest rarity number
      -- is the most common one.
      local worst, worstRarity = order[1], -1
      for name, move in pairs(chosen) do
        if (move.rarity or 0) > worstRarity then worst, worstRarity = name, move.rarity or 0 end
      end
      chosen[worst] = nil
      take(replacement)
    end
  end

  -- Rolled whole, because the roll itself weighs rarity, and stored compact:
  -- from here on only the uses remaining are worth keeping.
  return Battle.compactMoves(chosen)
end

--- What a level-up does to a roster.
---
--- The old behaviour was `m.moves = Battle.rollMoves(...)` every third level: a
--- complete, silent, random replacement. Three things were wrong with it, and
--- the rebuilt catalog makes all three worse rather than better.
---
---   * IT COULD TAKE. Rarity means something now -- a rarity-1 move is about a
---     one-in-twenty draw -- so a full reroll is a mechanic that confiscates the
---     rare thing a player was given, on a schedule, without asking. That is the
---     opposite of every other progression rule in this codebase; see the note
---     on `Admin.Load` in CLAUDE.md.
---   * IT ERASED THE SPECIES. A reroll drew a fresh signature, so the move the
---     monster index says this creature knows was replaced by whatever came up.
---   * IT WAS INVISIBLE. Nothing told the player it had happened.
---
--- So a level-up now RELEARNS: the signature slot is re-derived from the index,
--- which is how an evolution hands over its new signature move, and each of the
--- other slots draws a candidate that is kept only if it is at least as rare as
--- what is already there. A roster can improve and cannot regress.
---
--- That makes the third level a thing to look forward to rather than a thing to
--- dread, and it makes a rare move a keepsake rather than a rental. It also
--- converges: over the six relearns between level 0 and level 20 a companion
--- drifts upward, which is the intended shape of a creature you have raised
--- against one you just caught.
---
--- Returns the new compact moveset and the list of names that changed, so the
--- caller can tell the player what it learned.
function Battle.relearn(moves, element, opts)
  opts = opts or {}
  local slots = math.max(1, math.tointeger((C or {}).MOVE_SLOTS) or 3)
  local signature = Battle.signatureMove(element, opts)

  -- Everything the companion already has, minus the signature slot, in a fixed
  -- order: `pairs` is not ordered and a relearn has to be reproducible from a
  -- seed like every other roll in this file.
  local held = {}
  for name in pairs(moves or {}) do
    if name ~= signature then held[#held + 1] = name end
  end
  table.sort(held)

  local chosen, order, learned = {}, {}, {}
  local function take(name, isNew)
    if not name or chosen[name] then return false end
    local def = Battle.moveDef(name)
    if not def then return false end
    chosen[name] = clone(def)
    chosen[name].name = name
    order[#order + 1] = name
    if isNew then learned[#learned + 1] = name end
    return true
  end

  take(signature, moves == nil or moves[signature] == nil)

  local boost = nil
  local entry = Battle.indexEntry(opts.entryNo)
  if entry then boost = entry.advancedMove end

  local elementPool = C.MOVE_POOLS[element] and element or nil
  local index, guard = 1, 0
  while #order < slots and guard < 100 do
    guard = guard + 1
    local from = "neutral"
    if elementPool and rand(1, 100) <= ((C or {}).MOVE_ELEMENT_BIAS or 40) then
      from = elementPool
    end
    if not C.MOVE_POOLS[from] then from = elementPool or "neutral" end

    local candidate = Battle.drawMove(from, chosen, boost)
    local current = held[index]
    index = index + 1

    -- A slot with nothing in it takes whatever came up: a companion restored
    -- from an old export, or one an admin wrote short, is being filled rather
    -- than upgraded.
    if not current or not Battle.moveDef(current) then
      take(candidate, true)
    else
      -- Rarity 1 is the RARE tier, so "at least as rare" is "not a larger
      -- number". A tie goes to the new move, which is what stops a relearn from
      -- being a no-op for a companion already sitting on two commons.
      local currentDef = Battle.moveDef(current)
      local candidateDef = candidate and Battle.moveDef(candidate)
      local keepCurrent = true
      if candidateDef and not chosen[candidate] then
        keepCurrent = (candidateDef.rarity or 3) > (currentDef.rarity or 3)
      end
      if keepCurrent then take(current, false) else take(candidate, true) end
    end
  end

  -- Whatever the loop could not fill -- an element with a pool smaller than the
  -- slot count -- keeps what was already there rather than leaving a hole.
  for _, name in ipairs(held) do
    if #order >= slots then break end
    take(name, false)
  end

  return Battle.compactMoves(chosen), learned
end

--- The monster index entry for an entry number, or nil.
---
--- Built once and cached: `rollMoves` runs on every wild monster a hunt
--- generates and the index is ninety-three entries long.
function Battle.indexEntry(entryNo)
  local no = math.tointeger(tonumber(entryNo))
  if not no then return nil end
  if not INDEX_BY_NO then
    INDEX_BY_NO = {}
    for _, entry in ipairs((C or {}).MONSTER_INDEX or {}) do
      INDEX_BY_NO[entry.entryNo] = entry
    end
  end
  return INDEX_BY_NO[no]
end

--- The move slot one is always filled with.
---
--- In order: an explicit override, then the species' `basicMove` from the
--- index, then -- for a companion the index does not know, meaning a bot or an
--- admin write -- a damaging move drawn from the element pool. The result
--- always deals damage, and that is the guarantee the rest of the roll rests
--- on.
function Battle.signatureMove(element, opts)
  opts = opts or {}
  if opts.signature and Battle.moveDef(opts.signature) then return opts.signature end
  local entry = Battle.indexEntry(opts.entryNo)
  if entry and entry.basicMove and Battle.moveDef(entry.basicMove) then
    return entry.basicMove
  end
  local pool = C.MOVE_POOLS[element] and element or "neutral"
  return Battle.drawMove(pool, nil, nil, true)
end

--- One name drawn from a pool, weighted by rarity.
---
--- Rarity 1 is the rare tier and rarity 3 the common one, so the weights in
--- `C.MOVE_RARITY_WEIGHT` run the other way: the rarer the tier, the smaller
--- its share of the draw. `exclude` is the roster so far, so a slot cannot
--- duplicate one already filled; `boostName` is the species' advanced move,
--- whose weight is multiplied; `damagingOnly` restricts the draw to moves that
--- actually hit, which is what the signature fallback and the armed guard need.
---
--- `pairs()` order varies between runs, so the candidates are sorted before
--- anything is drawn: a seed has to reproduce a roll.
function Battle.drawMove(poolName, exclude, boostName, damagingOnly)
  local pool = C.MOVE_POOLS[poolName]
  if not pool then return nil end
  local weights = (C or {}).MOVE_RARITY_WEIGHT or {}
  local names = {}
  for name, def in pairs(pool) do
    local skip = false
    if exclude and exclude[name] then skip = true end
    if damagingOnly and (def.damage or 0) <= 0 then skip = true end
    if not skip then names[#names + 1] = name end
  end
  table.sort(names)
  if #names == 0 then return nil end

  local function weightOf(name)
    local def = pool[name]
    local w = math.tointeger(weights[def.rarity or 3]) or 1
    if boostName and name == boostName then
      w = w * (math.tointeger((C or {}).MOVE_SIGNATURE_BOOST) or 1)
    end
    return math.max(1, w)
  end

  local total = 0
  for _, name in ipairs(names) do total = total + weightOf(name) end
  local roll = rand(1, total)
  local cursor = 0
  for _, name in ipairs(names) do
    cursor = cursor + weightOf(name)
    if roll <= cursor then return name end
  end
  return names[#names]
end

--- A battle the client can render. `id` is supplied by the caller so it can be
--- derived from the message rather than a clock.
function Battle.new(id, challengerMonster, challengerAddress, accepterMonster, accepterAddress, opts)
  opts = opts or {}
  local battle = {
    id = tostring(id),
    kind = opts.kind or "bot",
    status = "battling",
    round = 0,
    turns = {},
    startedAt = opts.timestamp or 0,
    challenger = Battle.combatant(challengerMonster, "challenger", challengerAddress),
    accepter = Battle.combatant(accepterMonster, "accepter", accepterAddress),
  }
  return battle
end

--- What the client is shown. Everything is passed through whole — dumverse's
--- port learned this the hard way: a `publicView` that dropped fields caused
--- three separate crashes in screens that read them.
--- What a client is allowed to see.
---
--- A pending PvP challenge has a challenger and no accepter yet, so neither
--- side can be assumed to exist here — publishing one is what surfaces the
--- challenge in the lobby before anybody has taken it.
---
--- `pendingMoves` is REMOVED, and that is the whole point of this function
--- existing rather than the battle going out raw. PvP resolves both moves
--- together, which is only meaningful if neither player can see the other's
--- choice first. It was going out on the wire — in the reply, in `/now/battle`
--- and in the player record — so whoever moved second could read the first
--- player's committed move and counter it. That is not simultaneous turns; it
--- is a game decided by who clicks later.
function Battle.view(battle)
  local v = clone(battle)
  v.pendingMoves = nil
  -- Who has moved is fine to know; what they picked is not.
  v.waitingOn = {}
  if battle.pendingMoves then
    v.waitingOn.challenger = battle.pendingMoves.challenger ~= nil
    v.waitingOn.accepter = battle.pendingMoves.accepter ~= nil
  end
  v.challengerAddress = battle.challenger and battle.challenger.address or nil
  v.accepterAddress = battle.accepter and battle.accepter.address or nil
  return v
end

return Battle
