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

## Test before deploying, on a real node

```bash
npm run test:lua      # the game process     (free, unsigned)
npm run test:rune     # the Rune token       (free, unsigned)
npm run recover:verify # the 168 recovered players load and read back
```

All three run on a live `~lua@5.3a` and cost nothing. `node backend/native/e2e.mjs`
signs real ANS-104 items and is the only thing that exercises the real
signature path — run it after any node, scheduler or `signer()` change.
