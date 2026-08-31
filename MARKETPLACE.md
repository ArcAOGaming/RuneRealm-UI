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
same authority, and wallet Rune/TEST-RELIC trade through the external AMM.

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

`amm.lua` is a constant-product Rune/quote pool with integer arithmetic and a
configurable fee (30 basis points by default). Transfers between processes are
asynchronous, so a trade is deliberately two signed steps:

1. Transfer the input token to the AMM. Its token process emits a
   `Credit-Notice`; only a notice attested as coming from one of the configured
   token processes creates a deposit.
2. Sign `Swap` against that credited deposit with a minimum output and deadline.
   The pool updates atomically, then queues the output-token transfer through
   `process-outbox@1.0`.

Unused deposits can be refunded. Liquidity follows the same deposit-first
model. Off-ratio excess remains credited and refundable rather than becoming a
donation. Credit-notice ids are replay protected, and the product calculation
does not construct an overflowing `reserve * amount` intermediate.

`quote.lua` supplies `TEST-RELIC`, a six-decimal faucet token for integration
testing. It is intentionally not called AO. A real quote token is compatible
only if it emits standard credit notices on transfer and accepts an attested
process-origin transfer from the AMM's own balance. Verify that full path on the
target node before configuring AO.

## Files

- `backend/native/game.lua` — authoritative monster collection, escrow, Rune
  payment, cancellations, and sale history. The only companion market that runs.
- `backend/native/marketplace.lua` — parked minted-asset index source, not
  deployed or included in normal preflight; see the TODO above.
- `backend/native/amm.lua` — Rune/quote AMM, deposits and LP accounting.
- `backend/native/quote.lua` — faucet-backed `TEST-RELIC` token.
- `backend/native/deploy-marketplace.mjs` — spawns and configures quote and AMM
  external processes and writes their frontend ids; it never creates an index
  or companion collection.
- `src/screens/Marketplace.tsx` — `/market`, monster trading, Rune bridge,
  Gold goods/P2P/NPC trading, TEST-RELIC faucet, liquidity, charts, and swaps.
- `src/lib/marketplace.ts` — reads, signed actions and exact decimal conversion.

## Test and deploy

The offline runner uses the checked-in aos WASM and needs no node or wallet:

```bash
npm run test:marketplace:local
npm run build
```

The authoritative Luerl compatibility suite runs on a live HyperBEAM Lua
device when one is reachable:

```bash
npm run test:marketplace
```

The recommended deployment is the serialized full-stack command. It reads the
current game from `live-process.txt`, migrates it, creates and wires Rune, then
creates the quote/AMM processes and performs the final build only after all ids are
written:

```bash
npm run deploy:all -- --plan
npm run deploy:all
```

The full command first exercises the game/economy, Rune, AMM, quote, and
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

The default deployment creates an empty Rune/`TEST-RELIC` pool and faucets test
inventory to the owner. It no longer spawns a companion index. The deployment
does not invent Rune supply: withdraw earned Rune, transfer both tokens into
the AMM, then add the credited amounts as initial liquidity from `/market`.

To test an existing compatible quote token instead:

```bash
QUOTE_TOKEN=<process-id> QUOTE_TICKER=<ticker> QUOTE_DENOMINATION=<decimals> \
HB_WALLET=/path/to/key.json npm run deploy:exchange
```

The deployer writes `marketplace-processes.txt`,
`backend/native/marketplace-state.json`, `src/lib/marketplace-config.ts`, and the
four exchange `VITE_*` variables. Pass `-- --no-env` to leave frontend
configuration untouched.

The Rune desk requires configured Rune, quote, and AMM process ids. Monster
trading requires only the configured game process.
