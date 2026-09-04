# Rune Realm — repo rules

Read [HANDOFF.md](HANDOFF.md) first; it is the map. These are the standing
rules for working in here.

## Everything minted or deployed is prefixed `TEST-`

While the rebuild is unreleased, **every token, process and asset this repo
creates carries a `TEST-` prefix on its name and ticker.** That means the Rune
token is `TEST-Rune` / `TEST-RUNE`, and a spawned process is named
`TEST-<whatever>`.

The reason is that these things are permanent and public. A process spawned on a
public node and a token minted into real wallets cannot be recalled, and the
whole point of the current phase is that we are still moving the ground under
them — the token implementation is not even settled (see HANDOFF §3). Anything
that escapes into a wallet or an explorer during this phase must announce that
it is not the real thing, in the one field every client displays.

Dropping the prefix is a deliberate release step, not a cleanup: it means the
supply, the process ids and the node they live on are all final.

## Numbers are integers, and prove it

Luerl's `tonumber` returns a float and every tag arrives as a string, so an
unnarrowed conversion turns 25 into `25.00000000000` and it is stored that way
forever after. Narrow through `int()` on the way in, and assert on the RAW reply
text in tests — decoding with aos's `json` turns every number into a float on
the way back, so `math.type` on a decoded value proves nothing.

## `Target` is not a usable tag name

An ANS-104 data item carries a lowercase `target` field holding the process id,
and tag names become HTTP headers, which are lowercased. A tag called `Target`
is therefore ambiguous by the time a handler reads it. Use `PlayerId`,
`Account`, `Recipient`, `Opponent` — never `Target`.

## Some names are the platform's, not yours

`Target` is not a usable TAG name (above), and `info` is not a usable published
KEY name: every HyperBEAM device exposes its own `info`, so
`/<pid>~process@1.0/now/info` is answered by the device and your value is never
reached. The node then serves its own HTML landing page **at status 200**, so a
caller that does not check gets a screenful of markup handed to `JSON.parse`.
The token publishes `tokeninfo` for this reason; `ticker`, `minter`,
`totalsupply` and `balances` all resolve fine.

Treat an HTML body at 200 as "key absent" everywhere a published key is read.

## Identity comes from a signature commitment, and only that

`signer()` accepts a commitment whose algorithm is a real signature and nothing
else. Two things it must keep doing:

- Read the algorithm from **`type` OR `alg`**. A live node writes `type` and no
  `alg`; the test harness writes `alg`. Checking one spelling makes the suite
  pass and the deployed process refuse every signed action.
- Never fall back to a tag, and never accept an hmac commitment's committer. An
  hmac names whoever it claims to. Both halves of that have been exploited in
  this codebase — see the regression tests in `game_test.lua` and
  `rune_test.lua`.

## A restore may never take something away

`Admin.Load` is how both the legacynet recovery and a redeploy migration land.
Monotonic counters (wins, losses, quests) take the **max** of what is there and
what arrives; an empty loot box list does **not** replace a full one; an account
keeps its **earliest** known age. An empty account is a real export shape — it
is what `Admin.Unlock` mints for a wallet that never played — and loading one on
top of a real player used to erase them.

## A flow change is a walkthrough change

Screens teach themselves. Each one that has a guided walkthrough declares it in
its **own file** with `useTourSteps` — `COMPANION_TOUR` in `screens/Companion.tsx`,
`ENTRANCE_TOUR`/`LOBBY_TOUR` in `screens/Arena.tsx`, `MARKET_TOUR`,
`HUNT_TOUR` — precisely so that changing what the arena charges and changing
the sentence that says what the arena charges are the same diff.

Those sentences state real numbers and real rules: one Rune for four battles,
25 energy and 25 happiness to enter, +5 from three berries, a 2% seller fee on
the trading floor, one to five Rune to bind and consumed either way. **If you
move any of those, the walkthrough moves with them in the same commit.** A tour
describing rules the game no longer has is worse than no tour: it is
confidently wrong, and the player has no way to tell.

Same rule for the shape of a screen. Steps point at `data-tour` attributes and a
step whose target is missing is silently dropped — so deleting a panel does not
break the tour, it quietly removes a step nobody notices is gone. Check the
walkthrough when you move markup, because nothing will fail if you do not.

## Test before deploying, on a real node

```bash
npm run test:lua      # the game process     (free, unsigned)
npm run test:rune     # the Rune token       (free, unsigned)
npm run recover:verify # the 168 recovered players load and read back
```

All three run on a live `~lua@5.3a` and cost nothing. `node backend/native/e2e.mjs`
signs real ANS-104 items and is the only thing that exercises the real
signature path — run it after any node, scheduler or `signer()` change.

## Process shape is decided by three measured numbers

Measured on a local node from HyperBEAM's own `computed_slot` log; reproduce
with `backend/native/battle-fleet/hblab/` (see `backend/native/BATTLE_FLEET.md`
for the tables).

- **231 microseconds** — a real battle round in Luerl. Compute is free.
- **~100 ms** — one message, end to end, whatever it does. Charged per message,
  not per unit of work.
- **~160 ms** — one extra cross-process hop. A process cannot send anything by
  itself, so a hop is a slot on the sender, a push, and a slot on the receiver.

Nothing here is a compute decision. **Splitting buys throughput and costs
latency**; that is the only trade being made.

**Condense by default.** Accounts, monsters, Rune, inventory, quests and the
leaderboard belong to one authority process. Adding a domain to it costs
231 us against a 100 ms message — effectively nothing. Taking one out costs
~320 ms of hops per session. When in doubt, it goes in.

**A leaderboard, or any derived state, is never sharded.** It is computed over
everything, so N workers each maintaining a copy is N different leaderboards.
Either the authority owns it, or it is computed from the authority on read.

**Fan out only for session-shaped domains, and all three must hold:**

1. the session's state is independent of account state while it runs;
2. the client talks **directly** to the worker for the body of the session — a
   manager assigns and never proxies, because proxying costs ~160 ms per action;
3. there are exactly two authority boundaries **on the critical path** —
   reserve in, settle out. An exactly-once settlement handshake costs more hops
   than that (the battle fleet's is four), and those are counted separately
   because they run after the player is done. Count them anyway.

That is ~320 ms of hops amortised over the session's direct actions: at 1 action
never split, at 5 it is marginal, at 10+ it is fine. A five-round bot battle is
in the marginal band, so **the battle fleet is insurance against serialisation,
not a latency win** — it makes an individual battle slower until the authority's
queue is actually the constraint. That trade has been accepted deliberately for
battles and hunts: ~1 s per session is worth not serialising them behind the
account authority.

Where we currently break these rules is listed in
`backend/native/PROCESS_SHAPE_AUDIT.md`. Keep it current: adding a
cross-process message is adding ~160 ms, and it belongs in that list.

**Never spend a slot on a read.** A read comes from published state
(`/<pid>~process@1.0/now/<key>`, kept current by a patch the handler emits), not
from scheduling a message and waiting for a result.

**Do not batch interactive actions.** Batching only helps where one user intent
genuinely covers many state transitions — auto-resolved bot battles, admin
loads, seeding, migrations. A player picks a move after seeing the last result,
so a battle round is one message by definition, and no amount of batching
changes that.

## Every message pays for all published state, so publish nothing twice

A `~lua@5.3a` slot does not cost what the handler did. It costs the size of the
**whole published map**, five times over, whatever the message was. From
HyperBEAM's own `dev_lua:compute/4`:

1. `hb_cache:ensure_all_loaded(Params)` — "load the entire structure of the
   message into memory". Lazy `{link, ...}` values exist and this defeats all
   of them.
2. `encode/2` — `maps:to_list(maps:map(...))` recursively over the whole base.
3. `luerl:call_function_dec` — that whole term decoded into Luerl tables.
4. `decode(MsgResult)` — the returned map, which **is** `base` plus the edits,
   walked all the way back to Erlang.
5. `hb_cache:write` — `hb_message:id`, `calculate_all_ids`, then a `maps:fold`
   emitting write ops per key.

Two consequences, and neither is negotiable by rearranging keys:

- **Moving a value to its own key buys nothing.** There is no touched-key
  optimisation to reach; `ensure_all_loaded` flattens the distinction before
  Lua is called. Only *deleting bytes* makes a slot faster.
- **A key that grows with the player count makes every action slower for
  everyone.** `player-<address>` is written once per wallet and never removed,
  so slot cost is O(wallets ever seen) and a returning player pays for every
  stranger. This is what the 2026-08-31 soak measured: median action 7.6 s
  early, 18.5 s by the end of 5,061 actions, at ~7 KB of published record per
  wallet.

So, when writing a handler or a view:

**Publish state, never constants.** If a field is a verbatim copy of something
in `constants.lua`, publish the constant ONCE under `catalog` and let the client
join. A move is nine fields and only `count` is state; a companion is ~1,007
bytes of which 499 are the move definitions. `Battle.compactMoves` already
stores them compactly — `playerView` used to hydrate them straight back on the
way out, which is the whole bug in one line.

**Publish a record once.** `p.monster` and `p.monsters[p.activeId]` are the same
Lua table, so the store holds one copy and the JSON encoder writes two. A mirror
that costs nothing in the heap costs its full size in every publication. Publish
the map and the id; let the client index.

**A derived key inherits the size of what it embeds.** A leaderboard row that
carries a whole companion is 1,217 bytes; fifty of them is 61 KB rewritten
whenever the board is dirty. Derived keys are the last place to be generous.

**Bound every list, at the point it is appended.** `MarketHistory` is trimmed to
100 on insert and that is the pattern; a list that is only trimmed on read, or
not at all, is a permanent tax on every future message.

**An `Admin.Load`/export path must round-trip the compact form.** Reading a
published view back in and storing it is how a hydrated field gets written into
the store permanently.

Verify a change with the byte count, not by reasoning about it:

```bash
curl -s "$NODE/$PID~process@1.0/now" -o now.bin   # every key, one multipart body
```

then split on the boundary and sum per `name="..."` part. That is the number
every slot pays.

## Language is not the lever

Rust/WASM was built, deployed and measured against the Lua worker on a real
node. It loses: 20 ms a slot against Lua's 5 ms, because every stock HyperBEAM
builds WAMR in its slowest interpreter mode, and because the `json-iface@1.0`
ABI floor alone (6 ms — a 280-byte module returning a constant) is above Luerl's
entire slot. Module size is free; a JIT is unavailable (WAMR Fast JIT does not
support the `WAMR_BUILD_MEMORY64=1` HyperBEAM requires).

Keep `backend/native/battle-fleet-rust/` as a working second implementation of
the protocol and do not seal it into the fleet. Do not port more Lua to another
language on performance grounds without a measurement showing per-action compute
is no longer a rounding error next to a 100 ms message.
