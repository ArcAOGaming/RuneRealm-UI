# Rune Realm marketplace

> **Note (2026-08-30):** `marketplace.lua` is **no longer deployed**. It indexes
> one-unit `token@1.0` companion assets that settle in native AR, and monsters
> are no longer minted as those, so it would index nothing. Companion trading
> lives in `game.lua` and is paid in in-game Rune — which it already did; the
> index was a second surface the UI never read.
>
> **TODO — revisit only if monster minting is re-enabled.** The file and its
> suite remain as parked source outside normal deployment/preflight. Two things
> to know before bringing it back: it was never wired to the UI, so restoring it
> means building that too; and it is an *index*, not a settlement authority —
> the asset process still owns custody and payment.
>
> The integrated Gold/P2P/NPC implementation follows
> [ECONOMY_MARKETPLACE_PLAN.md](ECONOMY_MARKETPLACE_PLAN.md).

The market has three user-facing surfaces. Gold goods orders and the finite NPC
shop settle inside the game authority, companion sales use in-game Rune in that
same authority. Wallet Rune/TEST-RELIC will trade on the external order book.

## Architecture

### Monsters

Monsters are game records, not newly minted NFTs. The game process is both the
ownership authority and the market escrow, which keeps a sale to one atomic
state transition:

1. `Market.List` accepts only a monster in the seller's collection.
2. Listing moves the complete monster record out of that collection and into
   `Market[listingId]` escrow.
3. `Market.Buy` debits the buyer's in-game Rune, credits the seller, and moves
   the monster into the buyer's collection in one handler.
4. `Market.Cancel` returns an unsold monster to the seller's collection.

There is no external order id, AR price, ownership re-check, or NFT mint in this
path, and there is no longer a second index process that could disagree with it.
Mint/export/import is absent from the companion screen and refused by the
normal contract configuration. Legacy registry data remains readable only.

### Rune exchange

**There is no AMM.** `amm.lua` -- a constant-product Rune/quote pool -- has been
deleted. It was spawned once, never configured, never held a reserve or an LP
share, and this game does not trade on a curve. Two order books do the trading:
the internal one on in-game goods priced in Gold, and an external one on the
token pair. They are the same `orderbook.lua` engine; the only
difference is what funds them.

Both custody venues are implemented by `venue.lua`, deployed once in internal
mode and once in external mode. External custody is deposit-first: transfer the token in, the token process emits a
`Credit-Notice`, and only a notice attested as coming from a configured token
process creates a credited balance -- and its payouts leave through
`process-outbox@1.0`. That shape is modelled on `game.lua`'s `Burn-Notice`
(mandatory `Reference`, a `seen` short-circuit, quarantine rather than refusal),
NOT on the deleted pool's version, which fell back to a tag for identity and
failed closed before crediting. Fourteen atoms of TEST-RUNE are stranded at the
old pool address as a result, and they are not recoverable.

The always-fills-now counterparty is the in-game **Shop**, and it is not a market
maker: it is a supply-policy desk inside `game.lua`, quoting an anchored, banded
price that answers to the issuance ledger. A book with no resting order simply
does not fill, which is correct.

`quote.lua` supplies `TEST-RELIC`, a six-decimal faucet token for integration
testing. It is intentionally not called AO. A real quote token is compatible
only if it emits standard credit notices on transfer and accepts an attested
process-origin transfer from an exchange process's own balance. Verify that full
path on the target node before configuring AO.

## Files

- `backend/native/game.lua` — authoritative monster collection, escrow, Rune
  payment, cancellations, and sale history. The only companion market that runs.
- `backend/native/marketplace.lua` — parked minted-asset index source, not
  deployed or included in normal preflight; see the TODO above.
- `backend/native/quote.lua` — faucet-backed `TEST-RELIC` token.
- `backend/native/venue.lua` — the shared internal/external custody venue.
- `backend/native/deploy-venue.mjs` — deploys, seals, and optionally launches
  both order books.
- `backend/native/deploy-marketplace.mjs` — spawns and configures the quote token
  external processes and writes their frontend ids; it never creates an index
  or companion collection.
- `src/screens/Marketplace.tsx` — `/market`, monster trading, Rune bridge,
  Gold goods/P2P/NPC trading, TEST-RELIC faucet, liquidity, charts, and swaps.
- `src/lib/marketplace.ts` — reads, signed actions and exact decimal conversion.
- `src/lib/venue.ts` — shared order, custody, and published-position client.

## Test and deploy

The offline runner uses the checked-in aos WASM and needs no node or wallet:

```bash
npm run test:marketplace:local
npm run test:venue:local
npm run build
```

The authoritative Luerl compatibility suite runs on a live HyperBEAM Lua
device when one is reachable:

```bash
npm run test:marketplace
npm run test:venue
```

The recommended deployment is the serialized full-stack command. It reads the
current game from `live-process.txt`, creates and wires Rune, creates the quote
token and both venues, seals and launches all eight markets, and performs the final build only after all ids are
written:

```bash
npm run deploy:all -- --plan
npm run deploy:all
```

The full command first exercises the game/economy, Rune, quote, both venues, and
recovered-player migration on a live unsigned `~lua@5.3a` endpoint. It only
reads the deployment wallet after that preflight succeeds.

The local deployment wallet already used by the game scripts is the default;
`HB_WALLET` can override it. Add `--site` to upload the linked build and print
its Permaweb manifest id. This does not update ArNS; link the printed id
manually after verifying its gateway URL. A failed contract run can continue
from complete recorded stages with `--resume`.

To deploy only the external exchange against the currently recorded game and Rune
processes:

```bash
HB_WALLET=/path/to/key.json npm run deploy:exchange
```

The default deployment creates a `TEST-RELIC` faucet token and both empty
order-book venues. It no longer spawns a companion index. The deployment
does not invent Rune supply: withdraw earned Rune, transfer both tokens into
an exchange process. There is no pool to seed: liquidity is resting orders.

To test an existing compatible quote token instead:

```bash
QUOTE_TOKEN=<process-id> QUOTE_TICKER=<ticker> QUOTE_DENOMINATION=<decimals> \
HB_WALLET=/path/to/key.json npm run deploy:exchange
```

The deployer writes `marketplace-processes.txt`,
`backend/native/marketplace-state.json`, `src/lib/marketplace-config.ts`, and the
four exchange `VITE_*` variables. Pass `-- --no-env` to leave frontend
configuration untouched.

The Rune desk requires configured Rune and quote process ids. Monster
trading requires only the configured game process.
