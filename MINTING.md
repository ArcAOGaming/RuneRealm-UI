# Minting — state of play

> **PARKED:** companion mint/export/import, collection deployment, the funded
> worker, creator, and customiser are disabled and excluded from normal routes
> and deploys by `ECONOMY_MARKETPLACE_PLAN.md`. This file preserves historical
> implementation facts only. Do not use it as a release checklist.

One page for whoever builds the marketplace. Everything below is verified on
chain unless it says otherwise. Depth is in [HANDOFF.md](HANDOFF.md) §9b.

## What exists right now

| | |
|---|---|
| Game process | `Z8K9S_0rtJjTDaXqwfbE3y6GqK0Btx-VR0P1EORR4xg` |
| Collection | `FLpgYCuzLQt-wevwCvuTh9oJ89r_geDO3JWjNaXdQKc` |
| First asset | `BbKbzXwM_Im7V3TIzj2QSEjaWe9YUwS71JCsH9-Cllg` — TEST-Rockpup, lvl 10 |
| Minter / vault / process owner | `DA9qhP25ZPz6MHIhO-7aNHDN3LsTAL7yCKYIkqr13Z8` |

Everything published is prefixed `TEST-` — one constant, `NAME_PREFIX` in
`src/lib/card/naming.mjs`.

## The registry — read this, not the player records

The process publishes every asset it has ever minted:

```bash
NODE=https://schedule.forward.computer
PID=Z8K9S_0rtJjTDaXqwfbE3y6GqK0Btx-VR0P1EORR4xg

curl "$NODE/$PID~process@1.0/now/assets"      # the whole registry, by asset id
curl "$NODE/$PID~process@1.0/now/assetcount"
```

Each row: `assetId, minter, holder, state, mintedAt, seq, name, element,
faction, level, attack, defense, speed, health` — enough to draw and sort a
listing without touching a player record. `state` is `minted` or `returned`;
rows are never deleted. Client helpers: `readAssetRegistry()` and
`readAssetCount()` in `src/lib/game.ts`.

**`holder` is only where the PROCESS last saw it.** Once an asset trades, the
process is never told. Ownership truth is always the asset's own balances:

```bash
curl -H 'accept: application/json' \
  "https://hb.arweave.net/<assetId>~process@1.0/now/balances"   # {"<addr>":1}
```

Use `hb.arweave.net`. `schedule.forward.computer` answers 500 for every one of
these — it does not index the chain, and the error looks like a broken asset
rather than the wrong node.

## What an asset is

A base-layer Arweave transaction whose DATA is the card image and whose TAGS
declare a HyperBEAM process. **The asset id, the process id and the image id are
the same 43 characters.** Nothing mints the supply — `initial-holder` plus
`total-supply: 1` IS the mint, and the process is never messaged. Tag set:
`backend/native/asset.mjs`.

Image: `https://arweave.net/<assetId>`.

## The one rule that will cost you a day

**Any transaction with a `target` needs `quantity: '1'`.** Not `'0'`.

A transaction with a target, no data and zero quantity is a no-op, and every
node rejects it with a bare `400 Transaction verification failed` naming
nothing. Ruled out first, against two nodes: the reward (dust through 2x and the
full quote), attaching data, and all three anchor forms. Bazar's uploader does
the same:

```js
request.target ? { data, target: request.target, quantity: '1' } : { data }
```

This applies to transfers, offers, cancels — every contract interaction.

**Second rule — the wallet-generation fee.** The FIRST transaction ever sent to
an address pays a premium; every later one is dust. It is protocol, documented
("An extra fee is taken for the first transaction sent to a new wallet address.
This is intentional and to discourage wallet spam"), and defined in
`ar_pricing.hrl` as `WALLET_GEN_FEE_USD {1, 10}` — meant to be **ten cents**.

It converts through Arweave's own internal AR price estimate, which lags the
market, so today it bills **0.2216 AR (~$0.49 at $2.20/AR)** — as if AR were
$0.45. Expect that to drift.

What it means here, and the emphasis matters:

| | AR | approx |
|---|---|---|
| Mint a card — no target, so NO premium | 0.00294 | $0.006 |
| First transfer of an asset (bring-home, or a sale) | 0.2216 | $0.49 |
| Every transfer after | 0.000036 | — |

**Minting is cheap and can be done freely with fresh art every time.** The
premium lands on a token transfer because a transfer targets the ASSET'S OWN
process address, which is new for every freshly minted asset. Reusing one asset
per companion would pay it once — but that freezes the artwork, since the image
IS the transaction, so it was rejected on purpose.

**So the minter seeds each asset with one winston** (`seedAsset` in
mint-worker.mjs), paying the premium at issue time so no player ever meets it.
This is what Bazar does too, and its own history proves it — every transaction
ever sent to the Dumdumz asset `6eUukseoYZijjttx6u1E7OvFJFe80Pjs7puhLK9SiNg`:

```
block 1984705   fee 0.228287 AR   quantity 1   (no action tag)   <- the seed
block 1984750   fee 0.000037 AR   quantity 0   action=transfer   <- a listing
```

A collector never sees the premium because it was paid before the asset reached
them. Check any address with `/wallet/<addr>/balance`: a seeded one holds a
winston or two and quotes dust; an unseeded one holds zero and quotes ~0.22 AR.
All in, an asset costs the minter about 0.23 AR — the card is under a cent and
the seed is the rest.

`/price/0` is 0.000036 AR; `/price/0/<address>` quotes the premium, and
arweave-js prices with the target automatically — which is how a collection
update quietly became 91% of everything spent proving this out.

## The write API

`transfer`, `make-offer`, `cancel-order`, `register-interest` — that is all of
it. **There is no burn.** Returning an asset means transferring it to an address
you control.

Working example: `transferAsset()` in `src/lib/mint.ts` (browser, wallet-signed)
and `signAndPost()` in `backend/native/asset.mjs` (Node, JWK).

## The mint loop

```
Monster.Mint      player signs; charges 10 runes, freezes the companion, queues it
  worker          reads /now/mintqueue, composites the card, signs ONE tx
Admin.Minted      owner-only; companion leaves the game, registry row written
Monster.Deposit   player transfers the asset to /now/mintvault, then says so
Admin.Deposited   owner-only; companion returns, row marked `returned`
```

The worker (`backend/native/mint-worker.mjs`) is the only thing holding a funded
key, and it IS the process owner. Run `npm run mint:once` or `npm run mint:dry`.

The card is built by `src/lib/card/layout.mjs` — one layout, two painters
(canvas in the browser, raw bytes in the worker). `cardPlan(monster, {extended,
inventory})` gives 648x1065 plain or 1044x1065 with the side panel.

## Not verified yet

- **No player has ever clicked Mint.** The queue path is tested end to end in
  the Lua suite and the worker has run against the live process, but the two
  have never met with a real player.
- **The deposit path has never run.** Its transaction shape is now verified
  (`quantity: '1'`, accepted, tx `nG5jnqoZWCVLEmS-8VkWWaxcJfYWOf5VZA2q1rMpnFM`),
  but no companion has come home.
- **Settled:** the MINTER seeds every asset with one winston at mint time, so a
  player's transfer always costs dust. See `seedAsset` in the worker.
- **Unresolved:** a real Bazar transfer exists on chain with `quantity: 0` and a
  dust fee, to an asset process the price endpoint still quotes at the premium.
  Five attempts to reproduce that shape were rejected. If deposit cost ever
  becomes a blocker, that is the thread to pull — it would make transfers free.

## Bazar

Asset route takes TWO segments: `#/asset/<collection>/<asset>`. One segment
silently redirects to the front page and reads as an invalid asset. Use
`created-assets` for anything not in a listed collection — `bazarUrl()` in
`src/lib/mint.ts` does this.

Bazar's client is the only specification for this standard; `token@1.0`,
`carrier@1.0`, `arweave-scheduler@1.0` and `arweave-swap@1.0` are not in
HyperBEAM's published device docs at all. Read `permaweb/bazar`
(`src/api/asset-mint.ts`, `asset-uploader.ts`, `asset-transactions.ts`).
