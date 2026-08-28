# Rune Realm marketplace

The marketplace has two settlement paths because the assets already speak two
different protocols. The companion side preserves the native one-unit asset
standard; the Rune side is a dedicated two-token constant-product pool.

## Architecture

### Companions

Every minted companion is already a `token@1.0` process composed with
`arweave-swap@1.0`. Its balance and order book are the authority. A second
contract cannot atomically move that L1 asset, so `marketplace.lua` is a curated
index rather than a custodian:

1. The deployer copies the game's `/now/assets` registry into the index.
2. A holder creates a native `make-offer` on the asset process.
3. The holder signs `Listing.Create` with the permanent offer transaction id
   and its whole-winston AR price.
4. The UI combines indexed creature data with a fresh read of the asset's own
   `/now/balances` and sends the user to its native market action.

The index's `marketinfo` is also the on-chain process registry: it publishes the
game, collection, Rune token, quote token and AMM ids together. The all-in-one
deployer checks that graph against the AMM pair before it builds the app.

An indexed listing always carries `verified: false`. Ownership and offer state
must be checked on the asset process immediately before payment. Companion
sales currently settle in native AR; neither AO nor Rune is substituted by the
index. Any direct asset transaction added later must follow `MINTING.md`: a
targeted transaction uses native `quantity: '1'`, including offers and cancels.

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

- `backend/native/marketplace.lua` — curated asset registry and listing index.
- `backend/native/amm.lua` — Rune/quote AMM, deposits and LP accounting.
- `backend/native/quote.lua` — faucet-backed `TEST-RELIC` token.
- `backend/native/deploy-marketplace.mjs` — spawns and configures the three
  processes, imports the game registry, and writes the frontend ids.
- `src/screens/Marketplace.tsx` — `/market`, companion discovery and Rune swap UI.
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
creates the market processes and performs the final build only after all ids are
written:

```bash
npm run deploy:all -- --plan
npm run deploy:all
```

The full command first exercises the game, Rune, marketplace, AMM, quote, and
recovered-player migration on a live unsigned `~lua@5.3a` endpoint. It only
reads the deployment wallet after that preflight succeeds.

The local deployment wallet already used by the game scripts is the default;
`HB_WALLET` can override it. To publish the linked build too, set
`DEPLOY_ANT_PROCESS` and add `--site`. A failed run can continue from complete
recorded stages with `--resume`.

To deploy only the marketplace against the currently recorded game and Rune
processes:

```bash
HB_WALLET=/path/to/key.json npm run deploy:marketplace
```

The default deployment creates an empty Rune/`TEST-RELIC` pool, faucets 1,000
`TEST-RELIC` to the owner, and creates the companion index. It does not invent
Rune supply. Withdraw earned Rune, transfer both tokens into the AMM, then add
the credited amounts as initial liquidity from `/market`.

To test an existing compatible quote token instead:

```bash
QUOTE_TOKEN=<process-id> QUOTE_TICKER=<ticker> QUOTE_DENOMINATION=<decimals> \
HB_WALLET=/path/to/key.json npm run deploy:marketplace
```

The deployer writes `marketplace-processes.txt`,
`backend/native/marketplace-state.json`, `src/lib/marketplace-config.ts`, and the
six `VITE_*` marketplace variables. Pass `-- --no-env` to leave frontend
configuration untouched.

No marketplace process id in the repository means the contracts have not been
deployed yet; `/market` intentionally shows a safe not-configured state.
