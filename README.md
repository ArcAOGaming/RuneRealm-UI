# Rune Realm

Swear to a faction, raise its companion, send it on quests, and fight in the
arena. A React SPA over a single HyperBEAM process — no legacynet, anywhere.

**Start with [HANDOFF.md](HANDOFF.md).** The setting and writing canon lives in
[LORE.md](LORE.md). [MINTING.md](MINTING.md) documents the parked historical
companion-asset implementation; it is not a release workflow.
[MARKETPLACE.md](MARKETPLACE.md) covers the integrated Gold/companion markets,
Rune AMM, test quote token, and their deployment and verification flow.
[HYPERBEAM.md](HYPERBEAM.md) records platform facts that were verified by
running them rather than read in the docs.
[MONSTER_INDEX.md](MONSTER_INDEX.md) defines the numbered Monster Index, evolution
identity, asset-repository boundary, Phaser atlas contract, and release flow.

---

## Quick start

```bash
npm install
npm run dev                       # http://localhost:5173
```

The app points at a live process by default, so it plays immediately with a
wallet that has access. Copy `.env.example` to `.env.local` to point it
elsewhere.

## The shape of it

```
browser ──ANS-104 signed write──►  game process   (players, factions,
        ◄──── reply, by slot ────      │           companions, items, combat)
        ───unsigned HTTP read────►     │
                                  published state
```

- **A write** is an ANS-104 data item signed by the wallet, POSTed to the
  process's scheduler. A browser cannot produce HyperBEAM's httpsig signature,
  so this is the only option from a page.
- **A read** is a plain unsigned `GET` of state the process publishes. There is
  no `dryrun` and no speculative execution — anything the client polls has to be
  written into the result at the bottom of `game.lua`. Reads are free and never
  prompt the wallet.
- **A reply** is read back *by its own slot*. The process also publishes a
  single "most recent result", and polling that hands you another player's reply
  the moment two people are online.

**Connecting a wallet signs nothing.** Every player is published under their own
address, so an account is one unsigned GET:

```bash
curl "$NODE/$PID~process@1.0/now/player-<address>"   # the whole record, free
```

That is what makes viewing free: connecting grants `ACCESS_ADDRESS`, the address
names a key, and the account appears — companion, inventory, battle in progress
and all. The same read draws any other trainer's card on the leaderboard. A
signature is only ever asked for when the player actually does something.

### Wallet providers

Every Connect button opens the same provider chooser:

- **Wander / a compatible extension.** The detected extension supplies the
  standard `window.arweaveWallet` API. Wander browser, Wander mobile's dApp
  browser, and another extension implementing that API use the same path.
- **Browser wallet.** The app generates a real RSA-4096 Arweave key, stores its
  JWK in origin-scoped IndexedDB, and signs the same ANS-104 messages locally.
  It needs no extension and automatically signs game moves. On creation the
  player can download the standard JSON keyfile for recovery or import into a
  full wallet later.

The local key deliberately is not a cookie. A keyfile is close to the browser's
per-cookie size limit, cookies are attached to requests, and a static site
cannot protect one with `HttpOnly`. Clearing site data removes the IndexedDB
copy, so the recovery download matters. It is a hot play wallet, not the place
to keep a large AR balance.

It also means a player's record is **public**, which is the trade: the data was
already reachable by anyone who could ask the process for it, and the alternative
is a wallet prompt in front of looking at the game.

Combat is **turn-based**: one signed message is one full round. Your swing, the
opponent's answer and the whole new battle come back in the same reply. There is
no clock, no polling loop and nothing to babysit.

## The look

The interface has a thesis and it is enforced, not decorative: **every action is
a signature written where it cannot be taken back**, so the chrome is carved
stone and bone and **the magic is the only colour**. `--rune` (pale bone-gold)
does hairlines and the wordmark and never state; all chroma belongs to one of
the four elements, so colour always means something.

- `src/gfx/aether.ts` — the background: a WebGL2 flow field plus 2,000
  vertex-shader motes that take the player's elemental hue and ripple when a
  blow lands. Raw WebGL, no library, 60fps, stops when the tab is hidden.
- `src/gfx/sigil.ts` — a rune drawn deterministically from a wallet address.
  Your address is your identity here, so it becomes your mark.
- `.panel` — a notched tablet with a hairline inlay. It sets `backdrop-filter`,
  which is why every modal must go through `src/ui/Dialog.tsx` (a portal) — see
  HANDOFF §6.

See HANDOFF.md §6 before changing any of it.

## Layout

| | |
|---|---|
| `src/lib/hyperbeam.ts` | The only file that talks to the network. |
| `src/lib/game.ts` | The game's verbs. Every screen calls these. |
| `src/lib/types.ts` | The shapes `game.lua` actually returns. |
| `src/screens/` | Landing, hidden `/lore` chronicle, combined Factions/Standings, Companion, Arena, Market, Admin. |
| `src/ui/` | Primitives, icons, art, chrome, toasts, dialog, error boundary. |
| `src/gfx/` | The aether field and the sigils. No dependencies. |
| `src/lib/card/` | The card builder. Browser-active; its minter consumer is parked. |
| `src/lib/mint.ts` | Parked source for the old companion-asset chain path. |
| `src/lib/marketplace.ts` | Rune bridge and Rune/quote AMM reads and writes. |
| `src/screens/Marketplace.tsx` | Gold goods order book, finite NPC shop, companion market, and Rune exchange. |
| `src/_hidden/` | Parked features — see the README in there. |
| `backend/native/` | The process, its tests, and the deploy tooling. |
| `backend/native/card/` | The minter's painter: PNG in, PNG out, no dependencies. |
| `backend/native/mint-worker.mjs` | Parked funded-worker source; normal deployments never run it. |

### Responsive contract

Mobile behavior is centralized in the `Responsive contract` section at the end
of `src/index.css`. Keep new screens mobile-first and treat `lg` (1024px) as the
start of the existing desktop composition.

- Mount routes through `Shell`; it supplies safe areas, mobile navigation
  clearance, portrait bottom tabs, and the short-landscape side rail.
- Use the shared `Button`, `Dialog`, drawer, toast, and panel primitives. Their
  touch targets and portal safe areas are already handled.
- Let a new screen stack and scroll below `lg`; add its desktop grid with
  `lg:grid-cols-*`. Do not lock a phone route to the viewport or rotate the app.
- Add a named responsive hook only when content changes shape in landscape, as
  the battle, companion, and customiser do. Keep those rules in the centralized
  responsive section rather than beside unrelated desktop styling.
- Check 320px portrait, a short phone in landscape, a 768px tablet, and 1024px+
  desktop whenever a screen gains a new control or column.

### Installable app contract

Rune Realm is an online-first Progressive Web App. `public/manifest.webmanifest`
owns its install identity and `public/sw.js` owns its small presentation cache.

- Keep wallet calls, process reads, writes, and remote game data out of the
  service worker. Installed players must always see live chain state.
- Cache only same-origin navigation responses and hashed presentation assets.
  The root document stays network-first and is the offline fallback.
- Generate launcher icons from the canonical seal with `tools/gen-icons.py`;
  do not hand-edit copies that can drift from `src/gfx/mark.json`.
- Service-worker registration is production-only. Test installation from the
  compiled preview or an HTTPS deployment, not the development server.

## Working on it

```bash
npm run build                     # type-check + bundle
npm run monster-index:sync             # validate asset repo + regenerate runtime catalog/atlases
npm run monster-index:check            # fail if the two repositories drifted
npm run test:lua                  # the process suite, on a public node, free
npm run test:hunt                 # Hunt process + game bridge, offline
npm run test:marketplace:local    # AMM + quote + Rune suites, offline
node backend/native/e2e.mjs       # play the game through the real client code
```

`npm run test:lua` runs the whole process — handlers, combat engine, auth — on a
public node's `~lua@5.3a`. No wallet, no cost, and a construct Luerl rejects
fails there before it can reach a deployment.

`npm run test:hunt` executes both Hunt authorities against the checked-in aos
runtime: the standalone roaming/battle/capture process and the ownership,
inventory, locking, and settlement bridge in `game.lua`. The production deploy
workflow runs it before any site bundle can be uploaded.

`e2e.mjs` bundles `src/lib/game.ts` with esbuild and drives it against the live
process with a throwaway wallet that produces real ANS-104 signatures. It is the
browser's code path, not a re-implementation of it.

### Fifty-wallet swarm

The multi-account soak harness keeps fifty gitignored burner wallets in
independent worker threads, assigns each a documented role, and drives quests,
care, loot, level-ups, bot battles, and five coordinated PvP pairings through
the app's own client code:

```bash
npm run swarm:wallets                         # local key generation only
npm run swarm:plan                            # all names, roles, descriptions
HB_WALLET=owner.json npm run swarm:unlock     # one explicit live admin write
npm run swarm -- --live --duration 2h         # defaults to 4 writers at once
```

Game actions need no AR funding. See
[`backend/native/swarm/README.md`](backend/native/swarm/README.md) for load
limits, logs, cleanup behavior, role coverage, and the boundary around paid or
permanent asset actions.

## Deploying

Production release is intentionally split into two phases. Redeploy and verify
the contract graph first; publish the site only after the new process ids and
bot smoke checks are accepted. The contract commands use
`arweave-wallet-DA9qhP25.json` when `HB_WALLET` is not set, but never print or
copy the key:

```bash
# Phase 1: free/open contracts with the local 50-wallet bot roster prepared.
npm run deploy:contracts:plan          # inspect only; creates nothing
npm run deploy:contracts:check         # all preflight checks; no chain writes
npm run deploy:contracts               # contracts + linked client build; no site publish
npm run deploy:contracts:resume        # resume an interrupted contract deployment
```

**Every deployment is blank.** No migration from the process being replaced, no
legacynet restore, no paid allow-list — a bare process holding nothing but what
this run puts in it. Seeding is one flag, `--seed`, and it is a final-build
step, because the accounts it creates are permanent and carrying them through
every test deploy is how a chain of half-finished migrations starts:

```bash
npm run deploy:contracts:final:plan    # inspect the seeded deployment
npm run deploy:contracts:final:check   # its preflight, including the 168-player load
npm run deploy:contracts:final         # --seed: the launch build
```

`--seed` migrates the process named by `live-process.txt` (or `--from <pid>`),
restores the 168 recovered legacynet players, and unlocks the paid list.
`--fresh` is the same without the migration. `--resume` only ever picks up a
process recorded as having been born the same way — `seeded` in
`backend/native/deployment-state.json` — so a blank run never adopts a seeded
process, or the reverse. `deploy.mjs` on its own takes the same decision through
`--seed-legacy [file]` and `--paid-list`, both off unless asked for.

The fixed `deploy:contracts*` scripts always enable `--free --with-bots`, never
pass `--seed`, and never pass `--site`. They deploy the integrated game/economy, Rune bridge,
test quote token, AMM, battle workers, and hunt workers; verify the graph; rewrite the frontend
process ids; and create the linked `dist/` bundle. Review
`backend/native/deployment-state.json` after completion. Then commit and push
the rewritten ids: pushing does **not** publish the site.

**Sign-up is free by default.** Any correctly signed wallet may create an
account and play. `--paid-access` (`--no-free`, or `PUBLIC_ACCESS=0`) is the
flag that gates it behind the Eternal Pass allow-list, and it is the only way to
get a closed process — a gate you reach by forgetting a flag is a process nobody
can join, which reads from the client exactly like a broken deploy. `--free`
still works and now asserts the default. The selected value is compiled into the
game process, verified after spawn, printed in the plan and final receipt, and
saved as `publicAccess` in `backend/native/deployment-state.json`. Supplying
both flags is rejected.

Access and the paid allow-list are separate decisions: `--paid-access` says who
may join, `--seed` (via `deploy.mjs --paid-list`) mints the wallets that already
bought a pass into the new process.

`--with-bots` validates all 50 gitignored swarm wallets before the first live
write. In free mode they are admitted normally on their first signed action. In
closed mode the redeploy grants those exact wallets access after the new game
process is verified. It does not start the swarm. In TEST mode it batch-funds
those exact burners to the published 25 Rune / 5 Scroll test minimum; that
action is unavailable after economy activation.

### Open-access deployments

Access is enforced by the game process, not by a frontend-only environment
variable. An open game is what you get by default:

```bash
npm run deploy:contracts
```

That compiles the new game process in public mode and builds the client against
the new process graph without publishing it. It carries no players over; the
build that does is `npm run deploy:contracts:final`. To close registration
instead, add `--paid-access`. An
unknown signed wallet is granted durable access on its first game action. If a
later release closes registration, wallets that already joined stay unlocked.
The process publishes `/now/access`, and the client reads that authoritative
value before showing a new wallet the faction hall.

Running only `npm run build` cannot open a closed process. Likewise, changing a
client environment variable cannot bypass the process's Eternal Pass checks.

Before reading the owner wallet or creating anything, the command runs the
offline game/economy, hunt, AMM, token, adversarial simulation, fuzz, and swarm
suites, then runs the game, Rune, AMM/quote, and recovered-player suites unsigned on a live
`~lua@5.3a`, followed by the app build. Override that free test host with
`--live-test-node <url>` or `LUA_TEST_NODE`.

It migrates from the process currently recorded in `live-process.txt`, deploys
the new game and zero-supply Rune token on the same node, wires both directions,
deploys `TEST-RELIC` and the Rune AMM, verifies every recorded
relationship, rewrites all frontend process ids, and only then creates `dist`.
The final public process graph is saved in
`backend/native/deployment-state.json`; it contains ids and the owner address,
never wallet material.

Phase 2 is the manually dispatched **Upload Rune Realm to Permaweb** GitHub
Actions workflow. It installs from the lock file, runs the offline
game/market/swarm suites, builds once from the committed process ids,
fingerprints that exact `dist/` tree, uploads every file plus an Arweave paths
manifest, prints `MANIFEST_ID=<id>` in the job log, and stores
`site-deployment-state.json` as a workflow artifact. It deliberately does not
change an ANT or ArNS record. After checking the gateway URL in the receipt,
link that manifest id to the desired ArNS name/undername manually.

`DEPLOY_KEY` must contain a base64-encoded private Arweave JWK. No ANT process
secret or ArNS repository variable is read by the workflow. Missing or
malformed upload configuration fails the release instead of producing a
successful workflow that uploaded nothing.

The individual deployment commands remain available for focused work:

```bash
HB_WALLET=path/to/key.json node backend/native/deploy.mjs

# Carry the existing players over to the new process:
HB_WALLET=path/to/key.json node backend/native/deploy.mjs --migrate-from <old-pid>
```

Spawning and compute are free; the wallet signs, it does not pay. Whoever signs
the spawn becomes the process **owner**, and the owner is the only address the
`Admin.*` handlers answer. The new process id lands in `live-process.txt`.

Deploying mints a NEW process, and state is the process — so `deploy.mjs`
re-seeds the paid list from `backend/native/paid.json` every time, and
`--migrate-from` carries the existing players (faction, companion, level,
satchel, record) across. A fight in progress does not survive; everything else
does.

## Parked companion-asset implementation

This path is disabled in the contract, absent from normal UI routes, and never
run by a normal deployment. The source remains as a reference for a future
explicit product decision; the deliberately named commands below are not part
of release or test-bot operation.

```bash
npm run cards                     # render every faction and tier to .cards/
npm run parked:collection -- create
npm run parked:mint:dry           # price only, sign nothing
npm run parked:mint:worker        # explicitly run the parked worker
npm run parked:mint:once          # one explicitly parked pass
```

An asset **is** an Arweave transaction. Its data is the card image; its tags
declare a `token@1.0` process; the asset id, the process id and the image id are
the same 43 characters. Nothing mints the supply — `initial-holder` plus
`total-supply: 1` *is* the mint, and the process is never messaged.

That is why the wallet lives in `mint-worker.mjs` and not in the page. An L1
transaction costs AR, and **a process cannot pay it**: a process id is a
transaction id and nobody holds its private key, so AR sent to one is
unspendable. The process charges runes instead, freezes the companion, and
publishes a queue; the worker signs. A player needs no AR and signs no
transaction.

Coming back is not a burn — the standard has no burn. It is a transfer to the
vault the process publishes, which the worker confirms by reading the asset's own
balances.

The process keeps a **registry** of everything it has ever minted — asset id,
who minted it, and what the creature was at that moment — published whole:

```bash
curl "$NODE/$PID~process@1.0/now/assets"       # the registry, free
curl "$NODE/$PID~process@1.0/now/assetcount"   # how many exist
```

`holder` there is where the PROCESS last saw an asset. Once one is traded the
process is not told, so ownership truth is always the asset's own balances.

**A targeted Arweave transaction needs `quantity: '1'`.** A transaction with a
target, no data and no quantity is a no-op and every node rejects it with a bare
`400 Transaction verification failed` naming nothing. See HANDOFF §9b.

```
Monster.Mint  -> runes charged, companion frozen, job queued
   worker     -> composites the card, signs ONE transaction, Admin.Minted
Monster.Deposit -> after the player transfers the asset to the vault
   worker     -> confirms the balance moved, Admin.Deposited
```

The card is built by `src/lib/card/layout.mjs`, which decides where everything
goes, and two painters that draw it: a canvas in the browser for the preview,
raw bytes in the worker for the mint. One layout, two painters — so the picture
a player approves is the picture that gets signed.

**Everything published is prefixed `TEST-`** while this is being proven out —
asset titles, the collection, and the name on the card itself. It is one
constant, `NAME_PREFIX` in `src/lib/card/naming.mjs`; do not spell it anywhere
else.

## Hard rules

- **No legacynet, in any form.** Not `mu`/`cu.ao-testnet.xyz`, and not
  `~genesis-wasm@1.0` as a destination — it runs a legacy NodeJS CU sidecar. The
  only acceptable use of the old network is reading dead state out of public
  Arweave checkpoints, which is what `recover-unlocked.mjs` does.
- **Target `~lua@5.3a` (Luerl).** No C modules, no `goto`, and `string.format`
  with `%g` is broken — see HANDOFF.md §7.
- **Never commit a keyfile.** `.gitignore` covers `*wallet*.json`, `*.jwk` and
  `.burners/`.
- **A mint is permanent.** The asset id is the image id, so there is no way to
  change a card after it is signed and no update path in the standard. Prefix
  everything `TEST-` until that is the intended outcome.
- **Only released art goes on a card.** `src/assets/Monsters/portraits/` holds
  five families and only `doge` has shipped; the card uses that one and ignores
  the evolution tiers `src/ui/art.ts` shows on screen.
- **Never point a test at a real player's wallet.** Use `burners.mjs`.
