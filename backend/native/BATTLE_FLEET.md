# RuneRealm concurrency architecture

Status: feature-gated test implementation. The current game monolith remains
the default. Local verification does not modify a live process; the explicitly
labelled deployment commands below do spawn public remote test processes.

## Decision

AO serializes actions within one process. We will scale by making the smallest
useful consistency boundaries separate processes, beginning with bot battles.
The Phase-1 fleet is a fixed, pre-provisioned worker pool. The game/account
authority reserves costs and grants a ticket, a worker owns combat rounds, and
the game/account authority alone settles the result.

Account sharding is explicitly paused. The approved architecture keeps one
game/account authority for every player and separates only dissimilar domains
whose state does not need to commit with ordinary account gameplay. Do not
implement wallet routing, account-shard manifests, or cross-shard sagas unless
this decision is revisited after battle-fleet measurements.

The manager is an assigner, never a round proxy. Once assigned, a signed client
talks directly to its worker. That property is an invariant: putting round
traffic through an allocator simply moves the sequential bottleneck.

An entire TypeScript/Lua rewrite is not part of this plan. Lua remains the
control-plane and account implementation. The clean-test pool now supports an
explicit A/B topology of two Lua workers and two experimental Rust/WASM
workers; Rust is adopted beyond that test only if it beats Lua at the
end-to-end action path. Frontend language does not affect AO compute throughput.

## Goals and non-goals

Phase 1 must:

- execute unrelated bot battles concurrently across N AO processes;
- preserve one account authority for Rune, energy, sessions, companions, and
  rewards;
- authenticate opens as scheduler-attested deliveries from one configured game
  process;
- authenticate attacks from the participant's RSA signature commitment;
- make open, attack, and settlement retries idempotent;
- retain compact open/rejection outcomes through the ticket deadline even when
  full battle/rejection views churn beyond retention;
- seed every random choice from authority-assigned ticket material;
- expose cheap worker status and one published key per retained battle;
- drain without cron and without interrupting active fights; and
- bound completed battle, replay-key, and settlement state.

Phase 1 does not handle PvP, cross-worker combat, marketplace purchases, player
inventory, or global leaderboards. It does not migrate in-progress fights.

## Implemented package

| File | Responsibility |
| --- | --- |
| `battle-fleet/worker.lua` | Standalone AO worker, published state, trust checks, replay protection, drain and settlement outbox |
| `game.lua` | Feature-gated account authority integration, deterministic sealed-manifest routing, reservation accounting, exactly-once reward/refund/forfeit application, recovery handlers, and monolith fallback |
| `src/lib/game.ts` | Client route validation, worker-cache hydration, direct attacks, terminal-only delivery, settlement refresh, and reload recovery |
| `battle-fleet/authority.lua` | Reservation, lifecycle, confirmation, cancellation/forfeit, and exactly-once settlement transitions used by `game.lua` |
| `battle-fleet/allocator.mjs` | Unwired reference/advisory status-selection policy; `game.lua` does not consult it for routing |
| `battle-fleet/bundle.mjs` | Builds the exact Lua worker module from shared constants and battle engine |
| `battle-fleet/deploy-workers.mjs` | Explicitly gated fixed-pool deployment and verified manifest creation |
| `battle-fleet/runtime.mjs` | Deterministic two-Lua/two-Rust worker plan and runtime allowlist |
| `battle-fleet/manifest.mjs` | Atomic no-overwrite/resume/replace manifest transitions |
| `battle-fleet-config.mjs` | Strict manifest normalization, immutable Lua injection, and exact sealed-config comparison |
| `configure-battle-fleet.mjs` | Owner-only one-time manifest seal with correlated reply and published-config verification |
| `reconcile-battle-fleet.mjs` | Dry-run/apply recovery for lost opens, terminal settlements, cancellations, ACKs, confirmations, and releases |
| `battle-fleet-recovery.mjs` | Pure recovery ordering used by the reconciler so terminal settlement wins over expiry/cancel |
| `battle-fleet-integration.mjs` | Two-VM game/worker integration, fault-injection, routing, exact-once, fallback, and recovery tests |
| `battle-fleet/worker_test.lua` | Protocol, security, replay, drain, retention and settlement suite |
| `battle-fleet/retention_test.lua` | Focused `maxRetained=1` pending-final/backpressure regression suite |
| `battle-fleet/outcome_limit_test.lua` | Focused replay-outcome watermark and expiry-recovery suite |
| `battle-fleet/confirmation_limit_test.lua` | FinalAcked loss recovery, retention bound, and release suite |
| `battle-fleet/run-local-test.mjs` | Runs the Lua suite twice in fresh AO VMs and compares transcripts |
| `battle-fleet-rust/` | Host-tested Rust combat/protocol worker, verified JSON-Iface C-string ABI, and canonical WASM build |
| `battle-fleet/mixed-runtime-contract.test.mjs` | Runtime/image/ABI/stack/readiness and resume-contract tests |
| `battle-fleet/allocator.test.mjs` | Allocator/manager contract tests |
| `battle-fleet/manifest.test.mjs` | Crash persistence, atomic update, and overwrite-policy tests |

The deployment command refuses to run unless `BATTLE_FLEET_ENABLED=1`.
Workers also compile the same flag into their source, defaulting to disabled
when no configuration is injected. All spawned names retain the required
`TEST-` prefix.

## Ownership model

```text
game/account authority             worker selected for this battle
----------------------             -------------------------------
player balance/session             combatants and move counts
companion roster                    current HP/shield/stats
unique reservation                 round and bounded turn log
authoritative reward plan          attack replay ids
settlement dedupe ledger            stable settlement payload
```

The account authority reserves before opening. The worker cannot mint a reward,
change an inventory, or choose a reward plan at settlement time. The worker
echoes the reserved plan for audit, while `Authority.settle` deliberately uses
the plan held in the authority's reservation.

Every reservation separates `workerId`, a logical fleet label such as
`battle-worker-01`, from `workerProcessId`, the 43-character AO identity proven
by the scheduler-attested `from-process` envelope. A label is never process
authentication. New and duplicate Opened, OpenRejected, settlement,
cancellation, and owner-recovery transitions revalidate both identities and
the full reservation tuple before returning an effect.

## Phase-1 flow

```text
1. client --signed Battle.Start--> game/account authority
2. authority reserves cost and chooses the next worker by deterministic
   round-robin over the sealed manifest
3. authority --outbox Battle.Open--> worker
4. worker --outbox Battle.Fleet.Opened/OpenRejected--> authority
5. authority --> client {workerProcessId, battleId, ticket, reservationId}
6. client --signed Battle.Attack--------------------------------> worker
7. client --signed Battle.Attack--------------------------------> worker
8. worker --outbox Battle.Fleet.Settle--> game/account authority
9. authority applies reward once --outbox Fleet.Settlement.Ack--> worker
10. worker --outbox Battle.Fleet.FinalAcked--> authority
11. authority marks delivery confirmed --outbox Fleet.FinalAcked.Release--> worker
```

Steps 2 and 3 occur in the same authority action: a reservation exists before
the open can be delivered. A client may begin attacking only after the worker's
`battle-<battleId>` key exists. The authority must return the chosen worker to
the client; the allocator module is not contacted in the implemented path.

Accepted opens emit a stable `Battle.Fleet.Opened` reference; exact replay
re-emits it. Valid-but-rejected requests create a stable
`Battle.Fleet.OpenRejected` tombstone, so a drain/capacity failure cannot later
turn into an accepted battle after the authority refunded it.
`Authority.markOpened` refuses to revive `cancel-pending`, while
`Authority.rejectOpen` refunds once after authenticating the worker process and
full reservation identity.

`Battle.Open` resolves an existing `assignmentId` before any timestamp,
monster, difficulty, capacity, or drain validation that could create a new
rejection. An exact successful retry re-emits the same Opened notice. A
malformed or valid-but-conflicting retry against a retained full battle fails
without writing any rejection or changing the opened outcome. Once the full
view is pruned, the compact identity tombstone still returns the prior Opened
outcome and never executes mutable request data it can no longer compare. An
identity-matching rejected retry remains rejected. This is required for
recovery when the worker committed an open but the authority lost its first
Opened delivery.

Rejected-open tombstones have game acknowledgement and owner retry actions.
At the pending-delivery limit the worker cannot retain another tombstone and
returns a plain error. The current game authority deliberately does not use a
live `accepting`/capacity sample when routing; drain, capacity, and delivery
backpressure therefore remain normal serialized Open rejections and flow
through the authenticated refund/recovery protocol, never an inferred refund.

Every terminal delivery uses the same bounded confirmation handshake.
Settlement, cancellation, and rejected-open ACK handlers emit a stable
`Battle.Fleet.FinalAcked` receipt, including on duplicate ACK. The authority
does not time-prune that finalized reservation until `confirmDelivery` has
authenticated the worker process and full final tuple. If the receipt is lost,
the authority retries its exact ACK and the worker re-emits the same receipt.
After confirmation, `Fleet.FinalAcked.Release` marks the worker's compact
receipt releasable; it is accepted only from the scheduler-attested configured
game process and ages out only after its protection horizon. Owner-signed
`Fleet.FinalAcked.Retry` provides an operational resend, but the owner cannot
release a receipt or claim the authority received it. Unreleased receipts
are never evicted: `maxConfirmations` is a hard bound and admission backpressures
instead.

HyperBEAM outboxes require a push of the producing slot. The transport must push
the authority's successful `Battle.Start`, the worker's `Battle.Open` or
cancel/expiry response, and a terminal worker attack so their corresponding
Open, Opened/OpenRejected, Cancelled, or settlement message is delivered.
It must also push the authority ACK and worker FinalAcked slots so the
confirmation and release legs are delivered.
Empty/non-terminal round pushes should remain gated off. A queued outbox is
durable state, but the fleet is incomplete if callers only poll output.

## Protocol v1

The protocol string is `runerealm-battle-fleet/1`.

### `Battle.Open`

Target: selected worker process. Origin: configured game/account process only.
The worker accepts it only when its own scheduler's RSA commitment attests the
`from-process` field. A wallet signature, hmac, foreign scheduler, or another
source process is rejected. Signature selection is unambiguous: zero valid RSA
committers fails, one distinct committer succeeds, and two different valid RSA
committers fail closed even if one is otherwise trusted.

The live transport gate must inspect the actual computed worker input, not just
the sender-side message: `from-process` must equal the configured game process;
the normalized `Action` must be `Battle.Open`; `Data` must be the exact JSON
reservation object; and the delivered commitment must expose
`type=rsa-pss-sha512` (or the supported sha256 form) and the worker scheduler as
`committer`. The local suite covers those exact `from-process`, `Action`,
`Data`, nested tag-map, `type`, and `committer` representations. A live node
capture is still a release gate because transport normalization is external to
the Lua process.

The outbox message has scalar routing fields and JSON `data`:

```json
{
  "target": "<worker process id>",
  "action": "Battle.Open",
  "data": {
    "protocol": "runerealm-battle-fleet/1",
    "battleId": "battle-1042",
    "ticket": "ticket-1042",
    "reservationId": "reservation-1042",
    "assignmentId": "assignment-1042",
    "playerId": "<43-char wallet>",
    "issuedAt": 1700000000000,
    "expiresAt": 1700000600000,
    "difficulty": 1,
    "monster": { "...": "reserved companion snapshot" },
    "rewardPlan": { "lootbox": 1, "winExperience": 1 }
  }
}
```

`battleId`, `ticket`, and `reservationId` are independently unique on the
worker. Repeating byte-equivalent normalized reservation data returns the
existing battle. Reusing any identifier for different data fails closed.
Tickets are correlation/replay identifiers, not bearer authentication; a valid
participant signature is still mandatory.

The worker validates and narrows the companion rather than storing arbitrary
authority JSON. Unknown moves, fractional/unbounded stats, malformed ids, and
expired tickets are rejected. It constructs the NPC after seeding the engine
from `ticket/assignmentId/open`.

Ticket lifetime is capped by `maxTicketTtl` (one hour by default). A successful
or rejected assignment leaves a compact fixed-field outcome containing only
its identifiers, player, deadline, stable notice id, and rejection reason.
Full monster, reward, combat, and attack state is excluded. Full retained views
may be pruned, but this outcome and its ticket/reservation/battle indexes remain
through `expiresAt`; replay then returns the stable prior outcome and can never
start a second battle. After the deadline, a monotonic worker timestamp can
prune the compact outcome because any unseen replay is independently expired.
`maxOutcomes` is a hard admission watermark: the worker does not evict any
unexpired outcome and stops accepting assignments before the map can grow past
the configured bound. Expiry pruning releases slots and restores admission.

### `Battle.Attack`

Target: the assigned worker directly. Origin: the reserved participant's RSA
signature commitment.

Required scalar fields:

```text
action=Battle.Attack
battleid=<battle id>
ticket=<ticket>
actionid=<unique client action id>
round=<zero-based current round>
move=<move name>
```

The signer, ticket and current round must match the reservation. One accepted
round uses the RNG seed `ticket/assignmentId/round:<n>`; changing `actionId`
cannot reroll a fight. An exact `actionId` retry returns the current battle view
plus a compact replay receipt and does not advance or emit settlement again.
Reusing it with different fields is rejected. An old round cannot become the
next round after a double-click. Persistent replay state keeps only the
fingerprint, accepted/result round, terminal flag, and settlement id—never one
full growing battle view per round.

The reply contains the full renderable battle view. The same view is published
at `battle-<battleId>`. Internal ticket, open fingerprint, attack replay map,
and reserved reward data are not in that public view.

### `Battle.Fleet.Settle`

The first action that ends a battle emits exactly one normal outbox item:

```json
{
  "target": "<game process id>",
  "action": "Battle.Fleet.Settle",
  "protocol": "runerealm-battle-fleet/1",
  "reference": "<worker id>-<battle id>",
  "worker-id": "battle-worker-01",
  "battle-id": "battle-1042",
  "reservation-id": "reservation-1042",
  "player-id": "<wallet>",
  "result": "win",
  "rounds": "7",
  "data": "<canonical JSON settlement payload>"
}
```

There is no custom `Target` tag; lowercase `target` is only the outbox route.
The settlement id is stable across replay and operator retry. The account
authority must scheduler-attest the worker origin, match every reservation
field, and insert `settlementId` into its dedupe ledger before applying the
returned account effect. `authority.lua` implements that transition and ignores
the worker's echoed reward plan in favor of the reserved authority copy.

The game acknowledges with scheduler-attested
`Fleet.Settlement.Ack(settlementId)`. Duplicate acknowledgements are harmless.
An owner may use `Fleet.Settlement.Retry`; it emits the exact same id/payload,
so the account dedupe invariant still prevents double rewards.

The worker's payload carries logical `workerId`; the receiving authority obtains
`workerProcessId` only from the scheduler-attested delivery envelope. The
payload never gets to claim its own authenticated process identity.

### `Battle.Fleet.FinalAcked`

All three worker ACK handlers (`Fleet.Settlement.Ack`,
`Fleet.Cancellation.Ack`, and `Fleet.OpenRejected.Ack`) emit the unified receipt:

```json
{
  "protocol": "runerealm-battle-fleet/1",
  "confirmationId": "battle-worker-01-final-acked-settlement-<settlementId>",
  "kind": "settlement",
  "finalId": "<settlementId>",
  "workerId": "battle-worker-01",
  "battleId": "battle-1042",
  "assignmentId": "assignment-1042",
  "reservationId": "reservation-1042",
  "ticket": "ticket-1042",
  "playerId": "<wallet>"
}
```

`kind` is exactly `settlement`, `cancellation`, or `rejection`.
`Authority.deliveryAck(state, reservationId)` reconstructs the stable worker
ACK for first delivery or owner-triggered retry. Scheduler-attested receipt
handling calls
`Authority.confirmDelivery(state, payload, sourceWorkerProcessId, timestamp)`
(alias `confirmAck`), which returns `(effect, duplicate)`. It revalidates the
source process, logical worker, battle, assignment, reservation, ticket,
player, kind, final id, and deterministic confirmation id before setting
`deliveryConfirmed=true`. The returned `effect.release` is the exact
game-process `Fleet.FinalAcked.Release(ConfirmationId)` outbox item; a wallet or
owner signature cannot substitute for its scheduler-attested process origin. A duplicate ACK always
re-emits FinalAcked, so a lost receipt self-heals without replaying account
effects.

## Worker lifecycle and routing

`fleetstatus` and `Fleet.Status` expose:

- immutable `gameProcess` authority binding plus logical `workerId` and
  protocol identity;
- `lifecycle` (`disabled`, `unconfigured`, `draining`, or `ready`) plus
  `enabled`, `configured`, `draining`, and `accepting`;
- `active`, `retainedEnded`, `capacity`, and `availableSlots`;
- pending settlement, cancellation, rejected-open and total delivery counts,
  plus their limit and admission backpressure reason;
- retained replay outcomes, `outcomeLimit`, and the finite ticket TTL;
- retained/pending final confirmations and `confirmationLimit`;
- `assignmentWeight` for allocation; and
- the explicit `managerMode=assign-only`, `managerProxiesRounds=false`
  contract.

Implemented routing in `game.lua` uses the authority's durable monotonic
reservation sequence: `(sequence - 1) % workerCount` selects the next entry in
the immutable, ordered, sealed manifest. It does not fetch `fleetstatus`, does
not consult `accepting` or `availableSlots`, and does not call
`battle-fleet/allocator.mjs`. This makes a reservation's assignment
deterministic under replay and keeps a status-read dependency out of the
serialized account action.

`battle-fleet/allocator.mjs` is an unwired reference/advisory policy. It shows
how a future off-chain allocator could filter exact manifest identities,
`lifecycle:"ready"`, `accepting=true`, and available capacity, but its result is
not authoritative in the implemented path. Today `fleetstatus` is for
deployment verification and operator/load-control decisions. Any sample would
be stale by the time Open executes anyway: the worker's serialized Open result
is authoritative, and capacity, drain, outcome, or delivery-backpressure
rejection flows through stable OpenRejected/refund handling.

`Fleet.Drain(true)` requires the worker owner's RSA signature. It immediately
stops worker admission, rejects new opens, and continues existing attacks and
settlements. The current authority's sealed round-robin does not consume live
status, so assignments routed to a drained worker produce stable
OpenRejected/refund outcomes until a fresh game is sealed with a replacement
manifest. No cron is used. Operational drain is:

1. sign `Fleet.Drain(true)`;
2. poll `fleetstatus` until `active == 0`;
3. retain the worker until every pending final/rejection is acknowledged or safely
   replayed;
4. pause new fleet starts or accept deterministic OpenRejected/refund responses
   for assignments that round-robin to the drained worker; and
5. deploy a replacement and seal a fresh clean-test game manifest rather than
   pretending the existing immutable authority config changed.

Acknowledged completed records are FIFO-retained up to `maxRetained`. Pruning removes the
battle, ticket, reservation, settlement lookup, replay keys, and published
`battle-*` key together. Unacknowledged settlements and cancellations are never
pruned, including with `maxRetained=1`. Admission stops at `maxPending`; fights
already active may finish, so pending state is bounded by `maxPending +
capacity`. Pruning runs again after every ack. Bounded ack tombstones keep
immediate duplicate acknowledgements idempotent after battle pruning.
`retainedOutcomes`, `outcomeLimit`, and `maxTicketTtl` make the separate replay
horizon visible in status. Its size is hard-bounded by `maxOutcomes`, independent
of `maxRetained`; reaching the watermark reports
`outcome-replay-backpressure` rather than discarding unexpired protection.
FinalAcked receipts use the same rule: an unreleased receipt is never pruned;
at `maxConfirmations` the worker reports
`confirmation-replay-backpressure`. A final whose ACK cannot reserve a receipt
remains unacknowledged and counts toward existing pending-final backpressure.

The authority likewise separates live reservations from compact finalized
tombstones. Finalization removes the monster, reward plan, and full reservation
and keeps a fixed identity/outcome/dedupe record only until the greater of the
reservation deadline and configured replay window. `maxEntries` bounds live
plus compact records and secondary indexes. Every reservation consumes a
durable, authority-issued monotonic `sequence`; `lastSequence` survives
tombstone pruning, so an old authority action cannot recreate aged-out state.
For a new reservation, `sequence` must equal `lastSequence + 1` exactly. Gaps,
old values, and `math.maxinteger` fail closed; an exact existing-record retry
remains idempotent. The reservation generator must allocate the next sequence
transactionally in the same authority action and must never accept a
client-selected sequence.
Authority reservations enforce the same finite `maxTicketTtl` as workers, so a
malformed far-future deadline cannot pin the bounded replay ledger forever.
Non-force finalized tombstones ignore their time horizon until
`deliveryConfirmed=true`; `maxEntries` is therefore also the authority's hard
backpressure bound for lost confirmations. Confirmation extends the replay
window from the receipt time before pruning becomes eligible. Owner-evidenced
dead-worker `forceResolve` finals are marked confirmed by that audited recovery
itself because no worker ACK can exist.

## Failure recovery

| Failure | Recovery/invariant |
| --- | --- |
| Client never sees `Battle.Start` reply | Retry the same signed authority action id; return the same reservation and worker |
| Open delivery repeats | Assignment outcome is checked first; exact data returns stable Opened, while invalid/conflicting data fails without creating a rejection |
| Valid open is rejected | Stable OpenRejected is delivered; authority authenticates the process/tuple and refunds once |
| Cancel arrives before the worker ever saw Open | Reconciler retries the immutable Open with the authority's stable cancel intent; an unseen worker terminalizes it without emitting Opened, so the trusted cancellation refunds and late Open replay stays cancelled |
| Client attacks before open computes | Poll `battle-<id>` and resend the same attack id after it exists |
| Attack response is lost | Resend the identical `actionId`; no second round is computed |
| Player leaves an active battle | Authority records `player-left`, sends scheduler-attested `Battle.Cancel`, and applies the authenticated worker cancellation as a loss/forfeit with no refund |
| Operational expiry/cancel | Authority marks the reservation cancel-pending and sends scheduler-attested `Battle.Expire` after its deadline; authenticated opened proof consumes the attempt as a loss, while a never-opened outcome refunds |
| Worker dies before settlement | Reservation remains held; operator cancels/refunds after explicit worker inspection; never infer a refund from elapsed wall time alone |
| Settlement delivery repeats | Authority dedupes `settlementId` before account mutation |
| Settlement delivery is uncertain | Owner calls retry; stable reference makes repeated delivery safe |
| Authority ACK is lost | Final remains worker-pending; retry `Authority.deliveryAck` output |
| FinalAcked receipt is lost | Authority tombstone remains unconfirmed; retry the same ACK and worker re-emits the identical receipt |
| FinalAcked release is lost | Retry ACK/confirm to regenerate the same release, or owner retries the retained confirmation |
| Ack is repeated | Settlement, cancellation, rejection, FinalAcked, and release paths are idempotent |
| Cancel request repeats before ack | Worker re-emits the same `Battle.Fleet.Cancelled` reference; after ack it returns duplicate success without another outbox |
| Worker must be replaced | Drain; do not migrate active test fights; opened cancellations forfeit and never-opened rejections/cancellations refund; spawn a fresh `TEST-` pool and game manifest |
| Worker status is unavailable | Implemented round-robin is unchanged because it does not consume live status; serialized Open remains the admission decision |

`Battle.Cancel` and `Battle.Expire` require the configured game's
scheduler-attested origin plus matching battle, reservation, and ticket ids.
`Battle.Expire` also rejects requests before the reservation deadline. The
worker serially selects cancellation or settlement, releases active capacity,
and emits stable `Battle.Fleet.Cancelled(cancelId)` data. For a battle it
accepted, that payload includes the deterministic `openedId`; together with the
scheduler-attested worker origin it proves the assignment was opened even if
the earlier Opened notice was lost. For a cancel-pending reservation whose Open
was never observed, `Admin.RetryFleetOpen` preserves the original Open Data and
adds the authority's stable cancel intent. An unseen worker creates a retained,
non-attackable cancellation outcome without emitting Opened, so `openedId` is
absent and late replay cannot start combat. `Authority.finalizeCancel` owns the
disposition and requires the payload reason to equal the reason recorded by
`requestCancel`; a worker cannot rename the authority's cancellation.

Disposition depends only on authenticated opened proof, never on reason text.
Any opened cancellation—including `player-left` and operational expiry—has a
first terminal effect shaped like:

```json
{
  "cancelId": "<stable id>",
  "reservationId": "<reservation id>",
  "battleId": "<battle id>",
  "playerId": "<wallet>",
  "reason": "player-left",
  "openedId": "<worker id>-opened-<assignment id>",
  "disposition": "forfeit",
  "forfeit": true,
  "result": "loss",
  "rewardPlan": { "loss": "<authority-owned loss plan>" }
}
```

There is no `refund` field. The account applies the authority-owned loss plan
once. A pre-open rejection or cancellation instead has
`disposition:"refund"`, `forfeit:false`, and the authority-owned `refund`,
regardless of whether its recorded reason was player leave or an operator path.
Duplicate finalization returns only the compact stable identity/disposition and
never another reward/refund mutation plan. The authority then sends
`Fleet.Cancellation.Ack`; an owner can replay the exact notice with
`Fleet.Cancellation.Retry`. This is the no-cron abandoned-battle recovery path.

For a worker proven permanently unavailable, `Authority.forceResolve` is an
owner-only refund requiring matching logical/process identities, reservation,
player, battle, idempotency id, reason, and incident evidence. It writes a
bounded audit row and returns a stable compact acknowledgement on exact replay,
without another refund plan. It is not timeout automation: elapsed wall time
alone does not prove a late settlement impossible.

For the current clean-test phase there is no zero-downtime or in-progress
battle migration. There is no production state to carry. The cutover procedure
is intentionally: fresh game/account authority, fresh worker pool, test data,
then enable the client flag.

## Deployment and test gate

Local verification:

```powershell
npm run test:battle-fleet
```

Clean test deployment is deliberately staged `game -> workers -> one-time
configure`, because immutable workers must know the new game process id while
the game must ultimately seal the verified worker ids.

Stage 1 — deploy a fresh game without a pre-sealed manifest. An unconfigured
game remains on the monolith path. This command still performs a remote
mutation: it spawns a public remote test process and updates `live-process.txt`
to that new process id. `SKIP_SMOKE=1` skips the post-spawn smoke run; it does
not make deployment local or read-only:

```powershell
$env:NODE_URL = "https://schedule.forward.computer"
$env:HB_WALLET = "$PWD\arweave-wallet-DA9qhP25.json"
$env:SKIP_SMOKE = "1"
Remove-Item Env:BATTLE_FLEET_MANIFEST -ErrorAction SilentlyContinue
npm run deploy:process -- --no-seed-legacy --no-paid --no-env
$env:BATTLE_GAME_PROCESS = (Get-Content .\live-process.txt -First 1).Trim()
```

Stage 2 — pre-provision and verify the workers against that exact game id:

Build the Rust worker on a machine with `wasm32-unknown-unknown` and
`wasm-tools`, then publish it. **No node operator is involved.**

```powershell
rustup target add wasm32-unknown-unknown
# wasm-tools 1.258 needs rustc >= 1.85. Against the audited 1.83 toolchain:
cargo install wasm-tools --version 1.246.2 --locked
npm run test:battle-rust
npm run build:battle-rust
npm run publish:battle-image -- --post   # once per distinct binary
```

`deploy:battle-fleet` does this for itself, so the explicit publish is only for
seeing the id up front. Either way it is keyed on the build's sha256 and
recorded in `battle-fleet-rust/published.json`: republishing an unchanged binary
costs nothing and returns the same id, and changing one byte of the worker
changes the id with it.

**How the module reaches the node.** `dev_wasm:init/3` resolves `image` with
`hb_cache:read(Id)` and then reads the `body` key of the result. That last word
is the whole problem, and it took three dead process definitions to find.

An Arweave transaction id looks like it should work, and half of it does: the
node's store falls back to `hb_store_gateway`, fetches the transaction, and
serves the bytes. But it decodes them into a message whose payload sits under
`data`, not `body`. So the read succeeds, `body` is `not_found`, and `dev_wasm`
calls `hb_beamr:start(not_found, wasm)` — a bare `function_clause` naming
nothing. Measured on `hyperbeam.tylerw.ai` for our own published module and for
the aos module `Do_Uc2Sju_ffp6Ev0AnLVdPtot15rvMjP-a9VVaA5fM` alike:
`GET /<id>/data` serves the bytes, `GET /<id>/body` 404s.

`dev_wasm:cache_wasm_image/2` puts the module in as `#{body => Bin}`, which is
the right shape, by reading a file off the NODE's own disk. Its HTTP equivalent
`/~cache@1.0/write` answers `403 Not authorized to write to the cache.` to
anyone outside `cache_writers`, and on that node `cache_writers` is the node's
own address and nobody else.

What works, with no privilege at all: **schedule the module as a signed
message.** A message posted as `{ body: <bytes> }` is stored by the scheduler in
the node's main store with its `body` intact, which is exactly what `dev_wasm`
wants, and the id is the message's own — still content-addressed, still changing
with the binary. `image.mjs` parks these on one dedicated holder process
(recorded in `published.json`); nothing ever computes it, so the slots cost only
scheduler storage.

The Arweave publish is kept and is now opt-in (`BATTLE_RUST_ARCHIVE=1`, or
`npm run publish:battle-image -- --post --archive`). It is the permanent,
independently verifiable copy of exactly what the fleet runs; it is not the
`image` and no spawn depends on it, so an iteration loop does not pay AR per
rebuild for a copy nothing reads.

The image is verified before any worker is spawned: the node must serve that id
with a sha256 equal to the built file. An unresolvable or mismatched image fails
the deploy rather than producing workers that die at init.

Then deploy the fixed two-plus-two plan:

```powershell
$env:BATTLE_FLEET_ENABLED = "1"
$env:BATTLE_FLEET_MANIFEST = "$PWD\backend\native\battle-fleet\manifest.local.json"
$env:BATTLE_FLEET_SIZE = "4"
$env:BATTLE_FLEET_LUA = "2"
$env:BATTLE_FLEET_RUST = "2"
# Optional: pin a known image. Omit it and the deploy publishes/reuses one
# itself. A pin is still verified against the built bytes, so a stale pin
# fails the deploy rather than spawning last week's worker.
# $env:BATTLE_RUST_IMAGE_ID = "<43-character transaction id>"
$env:BATTLE_WORKER_CAPACITY = "32"
$env:BATTLE_WORKER_RETAINED = "100"
$env:BATTLE_WORKER_PENDING = "100"
$env:BATTLE_WORKER_TICKET_TTL = "3600000"
$env:BATTLE_WORKER_OUTCOMES = "10000"
$env:BATTLE_WORKER_CONFIRMATIONS = "10000"
npm run deploy:battle-fleet
```

Workers 01â€“02 are `lua@5.3a`; workers 03â€“04 are `rust-wasm@1`. Deployment
persists runtime and image identity before each remote spawn and refuses an
incompatible resume. A Rust entry becomes `ready` only after that exact process
executes `Fleet.Status` and publishes the expected runtime, cached image id,
JSON-Iface ABI, trusted-game clock mode, game binding, and all configured
limits. Spawned-but-unready processes are never eligible for the one-time game
seal.

The Rust stack is `json-iface@1.0`, `wasm-64@1.0`, `multipass@1.0`, and
`patch@1.0`, **lowercase**. Device names are matched byte for byte against the
node's registry and every name in it is lowercase, so `JSON-Iface@1.0` is a
different string from `json-iface@1.0` and resolves to nothing. The process then
dies at init with

```
{error,{device_not_loadable,<<"JSON-Iface@1.0">>,<<"device-name-not-resolvable">>}}
```

which reads as "this node has no JSON interface" and is not that at all. It cost
two abandoned worker processes and a paragraph in this file asserting the node
lacked the capability. `npm run probe:battle-devices` settles it in one call: a
registered device answers `/~<name>/keys` with 200, an unresolvable one answers
that same 500.

`wasi@1.0` is registered on that node too — the earlier reading that it was not
was the same casing bug — but the stack still omits it, correctly: the module is
self-contained with zero imports and does not need the adapter.

`patch-from` is `/results/outbox`, not `/results/patches`.
`dev_json_iface:json_to_message/2` builds the outbox as a numbered map from
`Messages` and leaves `patches` a plain list, while `dev_patch:move/4` folds its
source with `maps:fold/3`. Pointing at `patches` therefore crashes every reply
with `{badmap,[]}` on an empty list or `{badmap,[#{...}]}` on a full one. The
worker publishes by appending a PATCH-tagged entry to `Messages` — last, so real
outbox messages keep keys `1..N` — and `dev_patch` lifts it out before anything
is pushed.

A process definition is immutable, so a worker spawned with any of the above
wrong is dead permanently: do not `--resume` it. Start a fresh manifest/pool with
`npm run deploy:battle-fleet -- --replace`, verify every worker reaches `ready`,
and only then run `npm run configure:battle-fleet`. Abandoned public test
processes remain inert and are never included in the sealed routes.

`npm run probe:battle-rust` spawns a single throwaway Rust worker and reports
what it published, which is the cheapest way to check a node before committing a
fleet to it.

Stage 3 — seal that ready manifest into the game exactly once:

```powershell
npm run configure:battle-fleet
```

`configure:battle-fleet` verifies protocol, node, game id, unique logical and
process ids, and `lifecycle:"ready"`, schedules owner-only
`Admin.ConfigureBattleFleet`, reads the correlated action result, and verifies
the published canonical routes and every sealed authority limit. A game that
has already sealed an enabled manifest rejects replacement; deploy a fresh
clean-test game to change fleet identity.

Recovery inspection is read-only by default. It reads each routed worker battle
and reports immutable Open replays, pending terminal-settlement retries,
cancel/expiry work, unconfirmed final ACKs, and confirmed finals whose Release
may have been lost:

```powershell
$env:NODE_URL = "https://schedule.forward.computer"
$env:BATTLE_GAME_PROCESS = (Get-Content .\live-process.txt -First 1).Trim()
npm run reconcile:battle-fleet
```

Review the printed jobs before applying them. Apply requires the owner wallet
and the explicit feature gate; each scheduled recovery slot is pushed:

```powershell
$env:HB_WALLET = "$PWD\arweave-wallet-DA9qhP25.json"
$env:BATTLE_FLEET_ENABLED = "1"
npm run reconcile:battle-fleet -- --apply
```

Deployment refuses to overwrite an existing manifest unless `--resume` or
`--replace` is explicit. It creates the parent directory, writes through an
atomic same-directory rename, and persists a deterministic
`{workerId, operationId, lifecycle:"spawn-intent"}` before calling the remote
spawn endpoint. A successful return immediately advances that same entry with
`workerProcessId` and `lifecycle:"spawned"`, before initialization or status
reads. The current `hbclient` spawn operation supplies no server idempotency
key. Therefore a crash after the remote call but before its result is recorded
is explicitly ambiguous: `--resume` preserves the intent and fails closed; it
never retries the spawn. An operator must reconcile the operation id with node
records, or use explicit `--replace` only after accounting for a possible
orphan process. `--resume` otherwise validates immutable config and continues
from a known process id; `--replace` starts a new manifest without deleting old
public processes. Ready status is persisted only after the exact queried worker
publishes the requested logical `workerId`, runtime, immutable `gameProcess`,
protocol-v1 assign-only contract, `configured:true`, `lifecycle:"ready"`, and
every requested bound. Rust additionally binds the cached image id, ABI,
trusted-clock mode, and the process's actual immutable image/stack fields.
`accepting` is intentionally not part of this identity gate
because it is a stale capacity sample and serialized Open admission remains
authoritative. Do not enable client routing until the following live-node gate
passes:

1. captured delivery proves the exact `from-process`, `Action`, `Data`, and RSA
   commitment representation; wallet/hmac/foreign/multi-RSA opens fail;
2. a signed direct attack advances exactly one round;
3. the same attack id advances zero additional rounds;
4. one settlement changes the reserved account exactly once;
5. retrying settlement changes it zero additional times;
6. drain rejects opens and permits an existing fight to finish;
7. 4 workers under load achieve materially more aggregate actions/sec than one
   monolith without growing per-worker queue age; and
8. a disabled/missing manifest keeps all traffic on the existing monolith.

Game, worker, client-route, FinalAcked, and two-VM integration coverage is now
implemented and included in `npm run test:battle-fleet`. The safe default is
still unchanged: a game with no sealed manifest reports the fleet disabled and
uses the existing monolith battle path. Only the owner-only one-time configure
step enables fleet routing for that game process.

Initial load policy: cap client outstanding actions per worker at a small
number, rate-limit new reservations to no more than measured fleet capacity,
and treat high-concurrency swarm traffic as a stress mode rather than the soak
default. Concurrency limits outstanding work; it is not itself an arrival-rate
control.

## Active no-account-sharding topology

The approved clean-test topology keeps these dissimilar responsibilities
separate:

| Process/domain | Initial count | Role |
| --- | ---: | --- |
| Game/account authority | 1 | All player-owned state, economy, companions, activities, PvP authority, and final reward settlement |
| Bot-battle workers | 4 | Parallel combat computation; no authority to mint rewards or change accounts |
| Canonical Rune token | 1 | External Rune supply and transfers |
| Rune/quote AMM | 1 | Atomic swaps between the two token processes |
| Quote token | 1 | Marketplace quote asset |

At the initial fleet size this is eight configured process identities.
Companion mint/export/import and collection deployment are parked. The browser
router, deploy tools, swarm, and reconciler are clients or
operators, not AO processes.

The game/account authority deliberately remains one consistency boundary. Do
not split player inventory, companions, Rune accounting, activities, quests,
factions, PvP state, or reward application into multiple copies. The only
replicated compute lane is bot combat, whose immutable result is settled once
by the game authority. A later PvP worker fleet or asynchronous read projection
may be considered independently only after the bot fleet passes the live-node
load gate; neither requires account sharding.

## Archived option: account sharding (paused)

This section is retained only as design research. It is not an active package,
roadmap item, or authorization to implement or deploy account shards. No
account-shard code exists. Revisit it only if measured battle separation and
dissimilar-process boundaries still cannot meet load targets.

### Boundary

Use 8 clean account shards initially. A stable manifest maps
`hash(wallet) % shardCount` to a shard generation and process id. A shard owns
the player's profile, companion roster, gameplay inventory, activity timers,
daily claims, quests, battle reservations, and settlement ledger. Operations
owned by one wallet never visit another shard.

Routing is enforced server-side, not trusted from the browser. Each shard is
configured with immutable `generation`, `shardCount`, `shardId`, routing hash
version, and the complete logical/process manifest. For every wallet action it
recomputes the expected shard and rejects a wallet, claimed generation, or
target that does not map to itself. The client router is advisory only. A new
generation means new immutable shard processes; messages between generations
fail unless an explicit migration protocol authorizes that wallet.

Do not dynamically change the modulus. A new generation is an explicit routing
manifest; clean test deployments may reset. A future data-bearing migration
would export one wallet at a time and prove source/target counts before routing
that wallet to the new generation.

### Exact deliverables

Create:

- `backend/native/account-shards/shard.lua` with the player-owned handlers;
- `backend/native/account-shards/router.mjs` with stable wallet routing;
- `backend/native/account-shards/manifest.schema.json`;
- `backend/native/account-shards/transfers.lua` for the `Monster.Transfer`
  lock/accept/finalize saga;
- `backend/native/account-shards/pvp.lua` plus
  `backend/native/pvp-fleet/worker.lua` for challenge state and isolated PvP
  battle instances;
- `backend/native/account-shards/rune-gateway.lua` for token deposit/withdraw
  intents and acknowledgements;
- `backend/native/mint-worker/worker.lua` and
  `backend/native/asset-registry/registry.lua` for idempotent mint/deposit and
  canonical companion-asset identity;
- `backend/native/projections/event-log.lua`, `batcher.lua`, and domain reducer
  processes; `projection.lua` remains only a reference/rebuild oracle;
- `backend/native/account-shards/deploy-shards.mjs` with the same explicit
  `TEST-`/feature gates as the battle pool;
- `src/lib/account-router.ts` that selects one shard once per connected wallet;
  and
- local and live-node suites for route stability, cross-wallet isolation,
  duplicate actions, settlement replay, shard drain, manifest rollback, every
  cross-shard saga, projection gap recovery, and asset conservation.

The shard protocol must include `generation`, `shardId`, `wallet`, `actionId`,
and `expectedAccountVersion`. Every successful mutation increments one account
version. Separately, every shard owns one contiguous shard-global
`eventSequence`; a mutation can emit zero or more events with identity
`<generation>:<shardId>:<eventSequence>:<wallet>:<accountVersion>:<ordinal>:<actionId>`.
`accountVersion` is wallet-local and is never used as a shard watermark.
Optimistic-version mismatch returns the current version; it never guesses or
applies an action twice. Event append and `eventSequence` increment are part of
the account mutation, while remote projection delivery is not.

### Cross-shard protocols

`Monster.Transfer` is a source-owned saga with stable `transferId`, generation,
source/target shard process ids, source/target wallets, asset id, and source
account version. The source locks the companion and emits
`Monster.Transfer.Offer`; the target scheduler-authenticates the source shard,
checks its immutable generation allowlist and registry asset id, then records
exactly one accept or reject. `Accepted` causes the source to finalize removal;
`Rejected` unlocks it. The target exposes the companion only after its accept
is durable. Duplicate/reordered Offer, Accepted, Rejected, Finalized, and Ack
messages cannot create two owners. Timeout alone cannot unlock; lost messages
use stable retries, and dead-shard recovery requires owner evidence.

PvP uses `Pvp.Challenge`, `Pvp.Accept`, direct signed `Pvp.Attack`, and
`Pvp.Leave`. Challenge locks the challenger's battle lease and chosen asset;
Accept atomically locks the opponent on its own shard before a dedicated PvP
worker is assigned. The worker ticket includes both generation-bound shard
process ids, wallets, asset snapshots, reservation ids, and the settlement
target for each participant. Attacks go directly to that worker. Leave before
activation cancels; leave during combat is a deterministic forfeit. The worker
emits one idempotent result to each shard and both use the FinalAcked handshake.
No shard may settle the other wallet and no PvP manager proxies rounds.

After sharding, battle trust must be explicit. The recommended clean-test
topology is one battle fleet per account shard, configured to exactly one shard
process. If a shared fleet is later measured necessary, every worker instead
holds an immutable generation-bound shard allowlist and each ticket carries
`reservationAuthorityProcessId` plus `settlementTargetProcessId`; the scheduler
origin must match the former and final outboxes can target only the latter.
Logical shard ids or client-provided targets never authenticate settlement.

Rune uses the canonical token process plus per-shard custody accounting.
`Rune.Deposit.Intent` is keyed by token transfer id; only a scheduler-attested
canonical-token credit notice can increase deposited balance. Withdrawal
transitions are `Requested -> TokenSent -> Confirmed` (or owner-audited
`Failed/Refunded`) with stable `withdrawalId`; the shard debits/locks once before
emitting a token transfer and never infers success from time. Wrong generation,
wallet, token process, amount, or duplicate/conflicting references fail closed.

Minting is off the gameplay response path. A shard records `Mint.Requested`
with stable asset intent id; the mint worker creates at most one asset and the
asset registry records immutable `assetProcessId`, content hash, mint intent,
current custody process, and registry version. `Monster.Deposit` is credited by
a shard only after scheduler-attested registry validation and custody transfer;
client metadata cannot mint or choose identity. Retries return the same asset,
and conflicting mint/deposit claims quarantine the intent for operator review.

### Global projections

Leaderboard, faction totals, audit aggregates, and operational metrics become
eventually consistent read models. A successful gameplay action appends to its
shard-local event log/aggregate but does not push one remote projection message
inside the user response path. Separate flush actions asynchronously send
bounded, coalesced batches with `firstSequence`, `lastSequence`, event ids, and
an aggregate checksum. No cron is required; an operator/relayer drives flushes.

Reducers scheduler-authenticate the configured shard process and generation.
They accept only contiguous sequences, dedupe exact batches/events, expose a
per-shard contiguous watermark, and report gaps instead of advancing past them;
the batcher replays the requested local-log range. Domain-partitioned reducers
(leaderboard partitions, faction partitions, audit/metrics partitions) merge
through hierarchical rollups, so no single `projection.lua` receives every
gameplay write. That file may be a deterministic reference implementation and
full-rebuild oracle only, never the scale target. UI `asOf` values include each
source shard watermark and measured lag.

Projection lag/backpressure is observable as queued event count, oldest event
age, last flush sequence, reducer gap, and batch retry count. A projection
failure never blocks account writes; bounded local checkpoints plus archived
event batches support replay/rebuild. Tests cover reordered/overlapping batches,
exact duplicates, missing ranges, false generation/origin, reducer restart,
hierarchical equality, full rebuild from shard exports, and equality between
incremental and rebuilt totals. No projection may authorize or settle gameplay.

### Marketplace atomicity

Do not split purchases across player shards. The single game/account authority
owns companion custody, Gold/Rune balances, goods escrow, matching, and NPC
reserves, so listing, buyer debit, seller credit, fees, and ownership all change
in one game-process action. There is no marketplace deposit/withdraw saga.
Tests inject partial fills, cancellation, expiry, replays, rounding, and limits
and prove conservation of Gold, Rune, items, loot boxes, and companions.

Marketplace timeout alone never refunds, unlocks custody, or returns a listed
companion. Before acceptance, only an authenticated marketplace rejection may
unlock the initiating side. After acceptance, recovery requires a completed,
idempotent reverse transfer acknowledged by the current custody authority.
Once either rejection/refund outcome is retained, a late acceptance is
deterministically rejected by the stable intent tombstone rather than reopening
the saga. Fault tests must delay Acceptance beyond every timeout boundary,
replay it before and after reverse transfer, and prove that neither Rune nor a
companion is duplicated, unlocked early, or owned by two processes.

### Archived acceptance criteria

- Two wallets on different shards execute in parallel without a shared game
  process action.
- A wallet and all its owned state resolve to exactly one shard generation.
- Direct requests to the wrong shard/generation fail even when the client asks
  for that route.
- Battle settlement mutates the account once under delivery replay.
- Monster transfer, PvP leave/forfeit, Rune deposit/withdraw, and mint/deposit
  fault suites prove unique ownership and Rune conservation under duplicate,
  lost, reordered, conflicting, and dead-process notices.
- Rebuilding projections produces the same totals as incremental delivery.
- Projection soak keeps per-shard sequence gaps at zero after recovery and p95
  projection lag below the declared SLO without reducing shard gameplay
  throughput by more than 5% versus projection delivery disabled.
- Marketplace conservation/property tests pass under fault injection.
- Eight-shard soak sustains at least 5x the measured single-account-process
  action throughput while p95 queue age stays bounded.

## Package 2: Rust/WASM benchmark gate

This is an experiment on the isolated worker, not authorization for a codebase
rewrite. The repository contains the host-tested Rust worker, canonical WASM
build, runtime/image-bound deploy adapter, static mixed-fleet contract tests,
and two benchmarks: `bench-workers.mjs` for the live action path and
`bench-runtimes.mjs` for offline handler compute.

### What has actually been measured

A Rust worker now runs on `hyperbeam.tylerw.ai`. It boots, parses its immutable
config, computes, and publishes `fleetstatus` through `patch@1.0`. Getting there
took four fixes, each recorded above and in the code: lowercase device names, an
image the node can read as a message `body`, reading `scheduler-location` and
`image` from JSON-Iface's `Tags` rather than as top-level Process fields, and
publishing through the outbox instead of `results/patches`.

**Handler compute, offline** (`npm run bench:battle-runtimes -- 120`; both
runtimes under Node's WASM engine, 246 actions and 126 rounds each, identical
protocol): Lua `18.7 ms/action`, Rust `0.18 ms/action` — Rust roughly 100x
faster, flat in state size on both sides.

**Live, on the node.** A `Fleet.Status` slot, measured one worker at a time so
nothing contends, split into scheduling, computing, and re-reading an
already-computed slot. That last column is the same HTTP request answered from
cache, so it is transport plus serving the answer with no VM work in it at all;
subtracting it from `compute` leaves the VM work.

| worker | module | schedule | compute | re-read | VM work |
|---|---|---|---|---|---|
| `lua@5.3a` | worker.lua | 185 ms | 288 ms | 225 ms | **62 ms** |
| `rust-wasm@1` | the real worker, 354 KB | 166 ms | 380 ms | 243 ms | **137 ms** |
| control | 275-byte WAT, returns a constant | 179 ms | 298 ms | 241 ms | **57 ms** |
| control | 360 KB of inert WAT, returns a constant | 175 ms | 299 ms | 243 ms | **56 ms** |

The two controls are the point. Both satisfy the JSON-Iface C-string ABI and do
nothing else; one is a thousand times bigger than the other. They cost the same,
and they cost what Lua costs.

So:

- **the device stack is not the problem.** Encoding the Process message into the
  VM and decoding the results out, twice per slot, costs about 57 ms — the same
  as a whole Lua slot. Real, but not the gap.
- **module size is not the problem.** 275 bytes and 360 KB instantiate
  identically, so nothing is paying to load 354 KB per slot.
- **the gap is our module executing**: 137 - 57 = about **80 ms** of actual work,
  for something that takes **0.18 ms natively**. That is roughly 450x slower than
  native, which is the signature of an interpreter.

And it is. `GET /~meta@1.0/info/wasm-allow-aot` on that node answers **`false`**,
so `dev_wasm` loads every module in `wasm` mode and WAMR interprets it. Luerl,
its competition, is compiled Erlang running natively on the BEAM.

### What that means for adopting Rust

Rust is not worse at this. It is being interpreted while Lua is not.

But fixing it does not win the argument either, and the table says why. Perfect
Rust execution would be ~0 ms of the 137, leaving ~57 ms of stack overhead
against Lua's 62 ms. **The ceiling is a tie**, because the per-slot floor is the
device stack and the transport, not the language. Out of a ~380 ms slot, ~240 ms
is transport and ~57 ms is the ABI; the language is fighting over the rest.

This is the same conclusion the stress ladder reached from the other direction:
throughput fell as concurrency rose (351 actions at 10, 149 at 50), which is
queueing, not CPU. The fleet's value is the parallelism. Four worker processes
help; a faster engine inside one worker does not.

Rust becomes worth revisiting only where per-action compute stops being a
rounding error — much larger battle state, much longer round resolution — or if
the JSON-Iface encode/decode per slot can be avoided.

### Why it is interpreted, exactly

Not a node setting. It is how HyperBEAM builds WAMR, in its own `Makefile`:

```
-DWAMR_BUILD_INTERP=1          # classic interpreter, on
-DWAMR_BUILD_FAST_INTERP=0     # fast interpreter, OFF
-DWAMR_BUILD_JIT=0             # LLVM JIT, off
-DWAMR_BUILD_FAST_JIT=0        # fast JIT, off
-DWAMR_BUILD_AOT=1             # AOT loading, ON
-DWAMR_DISABLE_HW_BOUND_CHECK=1     # bounds checks in software
-DWAMR_BUILD_AOT_STACK_FRAME=1
-DWAMR_BUILD_MEMORY_PROFILING=1
-DWAMR_BUILD_DUMP_CALL_STACK=1      # kept in the Release build
```

So every `.wasm` on every stock HyperBEAM node runs under WAMR's **slowest**
execution mode, with software bounds checks and call-stack/profiling
instrumentation left on. 450x off native is exactly what that predicts.

`wasm-allow-aot` is a smaller flag than it looks. `dev_wasm` uses it only to
decide whether to pass the string `aot` to `hb_beamr:start/2`, and
`native/hb_beamr/hb_wasm.c` **ignores that argument** — the
`wasm_runtime_set_default_running_mode` call is commented out. It calls
`wasm_module_new` on the bytes, and WAMR decides from the file's magic number.

### Ways to execute faster without writing a device

Four, in increasing order of what they cost you.

**1. Ship an AOT module.** `WAMR_BUILD_AOT=1` means the runtime can already
execute `wamrc` output — real native machine code — and because the format is
detected from the bytes rather than the mode string, this needs no node change
at all, not even `wasm_allow_aot`. Cost: the image is compiled for that node's
architecture and WAMR version (x86-64 Linux, WAMR 2.2.0, matching memory64 and
tail-call flags), so it stops being the same portable bytes anywhere. Untested
here; it is the experiment worth running.

**2. Rebuild WAMR on the node.** One line each, and it speeds up *every* module
in *every* language on that node: `WAMR_BUILD_FAST_INTERP=1` (WAMR's own docs
claim roughly 2x over the classic interpreter, at some memory cost), or
`WAMR_BUILD_FAST_JIT=1` / `WAMR_BUILD_JIT=1` (needs LLVM). Dropping
`MEMORY_PROFILING`, `DUMP_CALL_STACK` and `AOT_STACK_FRAME` from Release is free.
Cost: the node diverges from stock HyperBEAM.

**3. `delegated-compute@1.0` pointed at your own CU.** Not a device — it is an
existing one, aimed at an HTTP endpoint that speaks `POST /compute` with the
AOS2 assignment format. That endpoint can be a native binary in any language,
with no WASM anywhere. Cost: the node no longer computes the result, it trusts
one, which gives up the property HyperBEAM exists to provide.

**4. `genesis-wasm@1.0`** is the literal legacynet path, and it is configured on
`hyperbeam.tylerw.ai` (`genesis-wasm-import-authorities` has an entry). It
delegates to the bundled legacy AO CU, which is Node, where **V8 JITs the
WASM**. Worth being precise about why legacynet's compiled-C modules felt fast:
not because the C was native, but because V8 compiled the WASM and WAMR
interprets it. Cost: legacy AO module shape, and the same trusted-CU tradeoff
as 3.

### Measured on a local node, from the node's own clock

Everything above this line was timed across the internet, and it was wrong in
detail: a round trip to the node is ~172 ms against a ~380 ms slot, so the
numbers were mostly network. `hblab/` builds the node in a container from the
same branch it runs, and `hblab/harvest.mjs` reads HyperBEAM's own
`computed_slot` log -- `prep_ms`, `execution_ms`, `store_ms` -- which is
measured inside the node and owes nothing to the client. External timing of the
same four processes disagreed with itself by 2.5x run to run; these do not.

Four processes, all answering the same trivial `Fleet.Status`, 30 slots each,
median:

| worker | exec (stock) | exec (fast interp) | store | bytes per slot |
|---|---|---|---|---|
| the Lua worker, `lua@5.3a` | 3 ms | 2 ms | 2 ms | 969,791 |
| the Rust worker, `wasm-64@1.0` | 17 ms | 10 ms | 3 ms | 8,796 |
| control: 280-byte WAT, returns a constant | 6 ms | 6 ms | 1 ms | 4,741 |
| control: 360 KB inert WAT, same constant | 6 ms | 6 ms | 1 ms | 4,735 |

What that settles:

- **Module size is free.** 280 bytes and 360 KB cost the same to the
  millisecond, so nothing re-instantiates the module per slot and shrinking the
  binary buys nothing. (Timed from outside, size appeared to cost 24 ms a slot.
  That was noise, and it is exactly the sort of thing a local node exists to
  kill.)
- **The ABI floor is 6 ms, and no interpreter setting touches it.** A module
  that returns one constant string still costs 6 ms of "execution": that is
  `json-iface@1.0` encoding the whole Process message into the VM and decoding
  the results back out, every slot.
- **Our Rust module's own work is 11 ms interpreted** (17 - 6), against 0.18 ms
  native. About 60x off, which is what a classic interpreter does.
- **Rust cannot beat Lua on this path, and now the reason is exact.** The best
  case is the floor: ~7 ms a slot, against Luerl's 5 ms for the whole worker.
  The ABI alone costs twice Lua's entire execution. This is a ceiling, not a
  tuning problem.
- **Lua writes 969 KB per slot; Rust writes 8.8 KB.** `store_ms` is 2-3 ms
  either way so it is not hurting yet, but at ~12 slots/sec the Lua path is
  ~11 MB/s of writes, and it is the one axis where Rust wins by two orders of
  magnitude. Worth watching before it is worth acting on.

### What a battle round actually costs in Lua

Every Lua figure above came from `Fleet.Status`, which is a read. So
`hblab/seed-luabench.mjs` puts the real `battle.lua` in a `lua@5.3a` process
where one message plays N complete battles -- `makeOpponent`, `new`,
`chooseNpcMove`, `resolveRound` -- and `measure-luabench.mjs` reads
`execution_ms` from the node's own log across several N. One count could not
separate the fixed cost from the work; the slope across counts can.

| battles per message | rounds played | execution_ms |
|---|---|---|
| 1 | 5 | 3 ms |
| 5 | 21 | 8 ms |
| 20 | 103 | 27 ms |
| 60 | 279 | 67 ms |

Dead linear: **231 microseconds per battle round**, on a 2.6 ms per-slot floor.

That number ends the language question for good. A round is a quarter of a
millisecond in Luerl, inside a slot that costs ~2.6 ms of Lua execution and
40-55 ms end to end. To make execution speed matter at all, a single slot would
have to play **more than two hundred rounds**. Interactive play never will.

It also prices the monolith honestly. Cross-process work in AO is not free: a
process cannot send anything by itself, so every hop costs a slot on each side
plus an outbox push (see `pushSlot` in `hbclient.mjs`). Splitting a domain that
did not need splitting buys queue capacity nobody is using and pays ~100 ms of
extra hops for it. (That hop cost is inferred from the mechanism, not yet
measured; measure it before leaning on the figure.)

So the shape is:

- **Monolith by default, for everything that must be atomic.** Accounts, monster
  ownership, Rune balances, and the leaderboard belong to one authority. They
  are not slow -- combat is 231 us -- and they are exactly the state that goes
  wrong when two processes each keep a copy.
- **Split only a domain that is genuinely independent AND queue-bound.** Bot
  battles qualify: each is self-contained and settles back to the one authority.
  This is the decision already recorded at the top of this file, arrived at
  again from measurements.
- **A leaderboard must never be sharded.** It is derived state over everything.
  Either the authority owns it, or it is computed from the authority on read.
  N workers each maintaining a copy is N different leaderboards.

### What a hop costs, measured

`hblab/measure-hop.mjs` spawns two Lua processes and times the same delivery two
ways: scheduling directly on the receiver, versus scheduling on a sender that
emits to its outbox and pushing that. Same receiver, same client, same work.

| path | p50 | p95 |
|---|---|---|
| direct: schedule receiver -> receiver computed | 99-100 ms | 109-195 ms |
| hop: schedule sender -> push -> receiver computed | 243-277 ms | 312-558 ms |

**One hop costs 145-177 ms** across two runs -- call it ~160 ms. It more than
doubles the cost of the action that caused it, and that is on a local node with
22 ms of round trip; every leg pays its own latency, so it is worse remotely.

This is the price of AO's delivery model, not a defect: a process cannot send
anything by itself, so a hop is a slot on the sender, a push, and a slot on the
receiver. `sendMessage` fires the push best-effort after every write, so this is
the real production path and not a synthetic one.

### Build style: what condenses, what fans out

Three measured facts decide every case:

- compute is **231 us** per battle round -- free;
- a message costs **~100 ms** whatever it does -- per message, not per work;
- a hop costs **~160 ms** more.

So splitting is never a compute decision. It buys **throughput** and it costs
**latency**, and the only reason to pay is that one process is serialising work
that did not need to be ordered together.

**Condense: one authority process.** Accounts, monsters, Rune, inventory,
quests, leaderboard. Everything that must commit together belongs to a single
writer, and putting more domains in costs essentially nothing, because compute
is 231 us against a 100 ms message. Adding a domain to the monolith is close to
free; taking one out costs ~320 ms of hops per session. The default is in.

A leaderboard specifically must **never** be sharded. It is derived state over
everything; N workers each maintaining a copy is N different leaderboards.
Either the authority owns it, or it is computed from the authority on read.

**Fan out: only session-shaped, independent domains.** The pattern that pays has
three properties, and all three are required:

1. session state is independent of account state while the session runs;
2. the client talks **directly** to the worker for the body of the session --
   the manager assigns and never proxies, which is already an invariant at the
   top of this file and now has a price on it: proxying costs ~160 ms per
   action;
3. exactly two authority boundaries -- reserve in, settle out.

That is two hops, ~320 ms, amortised across the session's direct actions:

| direct actions per session | hop overhead per action |
|---|---|
| 1 | ~320 ms -- never split |
| 5 | ~64 ms -- marginal |
| 10 | ~32 ms |
| 20 | ~16 ms |

**A five-round bot battle is in the marginal band.** Which is worth saying
plainly: the battle fleet is not a latency win and was never going to be. It is
insurance against serialisation, and it makes each individual battle slower
until the authority's queue is actually the constraint. Deploy it when queue
depth says so -- the stress ladder is the instrument -- not before.

**Applying it to a new domain, e.g. hunts:** if a hunt is a session with many
player actions and its own state, it fits the fleet pattern exactly and should
reuse it. If a hunt is one action that mutates account state -- hunt once, get
loot -- it belongs in the authority. Splitting it would pay ~320 ms of hops to
save 231 us of compute.

The rule in one line: **split a domain when its actions are frequent enough to
saturate one process, and self-contained enough that a client can talk to the
worker directly. Otherwise condense it into the authority.**

### Verdict, under the constraint that any stock node can run us

The constraint decides it. Portable across stock HyperBEAM means no custom
device, no custom node build, no trusted external compute unit, no
architecture-pinned image. That removes every lever that helps WASM:

| lever | why it is out |
|---|---|
| `WAMR_BUILD_FAST_INTERP=1` | needs a custom node build; other operators run stock |
| `WAMR_BUILD_FAST_JIT=1` | does not work at all with `WAMR_BUILD_MEMORY64=1` |
| AOT image via `wamrc` | pinned to one architecture and WAMR version |
| `delegated-compute@1.0` to a native CU | the node trusts a result instead of computing it |
| a purpose-built device | not portable, and out of scope by definition |

**So: stay on `lua@5.3a`.** It is not a compromise, it is the fastest execution
device a stock node offers us -- 5 ms a slot against the Rust worker's 20 ms --
and the WASM ABI floor of 6-7 ms is above Lua's entire slot. There is no
configuration of the Rust worker that wins. Keep it as a tested, working
artifact and a second implementation of the protocol; do not put it in the
sealed fleet.

**Then stop optimising the language, because the cost is per MESSAGE.** Node-side
work for a Lua slot is 5 ms (3 ms Luerl, 2 ms store) while an actual battle
round is a fraction of a millisecond. Draining a queue measured 40-55 ms a slot
locally against that 5 ms of compute, so roughly 35-50 ms per slot is spent
outside `computed_slot` entirely -- HTTP, RSA commitment verification, scheduler
assignment, cache lookups. That has not been attributed further and should be
before anyone tunes it, but its shape is already clear: **it is charged per
message, not per unit of work.**

Which makes the ranked list short, and none of it needs a node's permission:

1. **Put more work in each message, WHERE ONE INTENT COVERS MANY TRANSITIONS.**
   This is narrower than it first looks and is not a general answer. An
   interactive battle round cannot be batched: the player picks a move after
   seeing the last result, so one action is one message by definition. It
   applies to auto-resolved bot battles, admin loads, seeding, and migrations --
   and it is only worth doing when the queue is actually the constraint, which
   at current user counts it is not.
2. **Spend slots only on writes.** Reads should come from published state
   (`now/<key>`, via the patch already emitted) and never from scheduling a
   message. The fleet already does this for `fleetstatus`; hold that line.
3. **Add worker processes.** Confirmed by the stress ladder from the other
   direction: throughput fell as concurrency rose (351 actions/sec at 10, 149 at
   50), which is queueing. Processes are the unit of parallelism in AO.

Rust becomes worth revisiting only if per-action compute stops being a rounding
error next to a ~5 ms slot -- battle state or round resolution one to two orders
of magnitude heavier than today's -- or if a future HyperBEAM ships a JIT that
works with memory64.

### What the flags actually do, tested rather than assumed

Both alternative WAMR builds were built and run, not reasoned about:

- **`WAMR_BUILD_FAST_INTERP=1` works and is free.** Rust execution 17 ms -> 10 ms
  (the module's own share, 11 ms -> 4 ms: 2.7x). One line in HyperBEAM's
  Makefile, no change to any module, and it speeds up every WASM process on the
  node. It does not move the 6 ms ABI floor, because that floor is Erlang-side.
- **`WAMR_BUILD_FAST_JIT=1` compiles and then fails at runtime.** Every module
  dies with `Exception: failed to compile fast jit function`: WAMR's Fast JIT
  does not support `WAMR_BUILD_MEMORY64=1`, which HyperBEAM requires. The LLVM
  JIT is likely to hit the same wall. This is the flag that looked most
  promising on paper and it is unavailable.

So the honest ranking of what is left, for the battle worker specifically:
turning on the fast interpreter is worth doing for the whole node and gets Rust
from 20 ms to 13 ms a slot; it still loses to Lua's 5 ms, and nothing available
closes a gap whose floor is the ABI.

### Why it is interpreted, exactly

Not a node setting. It is how HyperBEAM builds WAMR, in its own `Makefile`:

```
-DWAMR_BUILD_INTERP=1          # classic interpreter, on
-DWAMR_BUILD_FAST_INTERP=0     # fast interpreter, OFF
-DWAMR_BUILD_JIT=0             # LLVM JIT, off
-DWAMR_BUILD_FAST_JIT=0        # fast JIT, off
-DWAMR_BUILD_AOT=1             # AOT loading, ON
-DWAMR_DISABLE_HW_BOUND_CHECK=1     # bounds checks in software
-DWAMR_BUILD_AOT_STACK_FRAME=1
-DWAMR_BUILD_MEMORY_PROFILING=1
-DWAMR_BUILD_DUMP_CALL_STACK=1      # kept in the Release build
```

So every `.wasm` on every stock HyperBEAM node runs under WAMR's **slowest**
execution mode, with software bounds checks and call-stack/profiling
instrumentation left on. 450x off native is exactly what that predicts.

`wasm-allow-aot` is a smaller flag than it looks. `dev_wasm` uses it only to
decide whether to pass the string `aot` to `hb_beamr:start/2`, and
`native/hb_beamr/hb_wasm.c` **ignores that argument** — the
`wasm_runtime_set_default_running_mode` call is commented out. It calls
`wasm_module_new` on the bytes, and WAMR decides from the file's magic number.

### Ways to execute faster without writing a device

Four, in increasing order of what they cost you.

**1. Ship an AOT module.** `WAMR_BUILD_AOT=1` means the runtime can already
execute `wamrc` output — real native machine code — and because the format is
detected from the bytes rather than the mode string, this needs no node change
at all, not even `wasm_allow_aot`. Cost: the image is compiled for that node's
architecture and WAMR version (x86-64 Linux, WAMR 2.2.0, matching memory64 and
tail-call flags), so it stops being the same portable bytes anywhere. Untested
here; it is the experiment worth running.

**2. Rebuild WAMR on the node.** One line each, and it speeds up *every* module
in *every* language on that node: `WAMR_BUILD_FAST_INTERP=1` (WAMR's own docs
claim roughly 2x over the classic interpreter, at some memory cost), or
`WAMR_BUILD_FAST_JIT=1` / `WAMR_BUILD_JIT=1` (needs LLVM). Dropping
`MEMORY_PROFILING`, `DUMP_CALL_STACK` and `AOT_STACK_FRAME` from Release is free.
Cost: the node diverges from stock HyperBEAM.

**3. `delegated-compute@1.0` pointed at your own CU.** Not a device — it is an
existing one, aimed at an HTTP endpoint that speaks `POST /compute` with the
AOS2 assignment format. That endpoint can be a native binary in any language,
with no WASM anywhere. Cost: the node no longer computes the result, it trusts
one, which gives up the property HyperBEAM exists to provide.

**4. `genesis-wasm@1.0`** is the literal legacynet path, and it is configured on
`hyperbeam.tylerw.ai` (`genesis-wasm-import-authorities` has an entry). It
delegates to the bundled legacy AO CU, which is Node, where **V8 JITs the
WASM**. Worth being precise about why legacynet's compiled-C modules felt fast:
not because the C was native, but because V8 compiled the WASM and WAMR
interprets it. Cost: legacy AO module shape, and the same trusted-CU tradeoff
as 3.

### Throughput, which is the number that matters under load

Per-slot latency is the wrong denominator: ~172 ms of it is network RTT to that
node (a bare `GET /~meta@1.0/info/address` is `p50 172 ms`), and every client
pays that in parallel. Queue 12 messages at one process first, then time the
drain, and the RTT overlaps away:

| process | drain | throughput | node-side per slot |
|---|---|---|---|
| `lua@5.3a` worker | 1.01 s | **11.9 slots/sec** | 84 ms |
| 275-byte WAT that returns a constant | 1.05 s | **11.4 slots/sec** | 88 ms |
| `rust-wasm@1` worker | 1.87 s | **6.4 slots/sec** | 156 ms |

**Read the middle row twice.** A module that does nothing at all — no parsing,
no state, one constant string — runs at the same speed as Luerl running the
entire Lua worker. So the per-slot cost of a HyperBEAM process is not the
language and not the ABI: it is the process machinery around both, about 85 ms
of scheduler read, hashpath resolution, commitment checking, cache write, dedup
and patch, every slot, for everyone.

Our Rust module adds 156 - 88 = about **68 ms** of interpreted execution on top
of that floor. That is what makes it, today, **half of Lua's throughput**.

And it bounds the upside precisely: **AOT, JIT, a faster interpreter, a smaller
module — every one of them is a race to that 88 ms floor**, which is Lua's
current number. The ceiling for making Rust faster inside
`wasm-64@1.0` + `json-iface@1.0` is a tie.

If the goal is a large multiple rather than parity, the language is the wrong
variable. Only two things move an 85 ms fixed cost per slot:

- **do more per slot.** The cost is per message, not per unit of work. Batching
  N attacks into one message divides it by N, in either language, today.
- **run more processes.** Which is what the fleet already is, and what the
  stress ladder said the constraint was (351 actions/sec at 10 concurrent, 149
  at 50 — queueing, not CPU).

Rust remains worth having only for the case where per-action compute stops being
small next to 85 ms. Offline it is 0.18 ms against Lua's 18.7 ms, so that case
needs battle state or round resolution one to two orders of magnitude heavier
than today's.

None of this is BATTLE_FLEET.md gate 4 yet: that asks for warm p95 compute per
battle round on the node, and the live number above is a status read, not a
battle round. A game-origin `Battle.Open` requires `Message.Owner ==
Process.scheduler`, which only the game process's own outbox push produces, so
timing real rounds live needs the sealed authority path.

The current JSON-Iface forwards assignment `Block-Height` but not the trusted
assignment timestamp used by the native Lua device. Rust game-origin actions
therefore require both the scheduler/game identity tuple and an
`Authority-Timestamp` emitted by the authenticated game process. Player
messages cannot advance this clock. This preserves trusted expiry/pruning
inputs, but an original Open delayed beyond its deadline is not independently
recognized as late until a newer game control reaches the worker. The account
authority still refuses a settlement after authoritative cancellation. Treat
this as a clean-test limitation; exact time parity requires a source-pinned
JSON adapter that also forwards scheduler assignment time.

First verify the intended node exposes the required devices and can
persist/replay its state — `npm run probe:battle-devices` for the names,
`npm run probe:battle-rust` for a single live worker. Device naming and
availability are operational facts to test against that build, never assumed
from a document, and never inferred from a failure message that names a device.


Adopt Rust only if all gates pass:

1. every deterministic vector has the same winner, round count, move counts,
   health/shield state, and settlement fields;
2. duplicate/open/attack/settlement security tests have equivalent results;
3. 100 consecutive snapshot/replay cycles diverge zero times;
4. warm p95 compute per battle round is at most 50% of Lua;
5. saturated end-to-end worker throughput improves at least 2x and p95 action
   latency improves at least 30% after scheduler/network overhead;
6. retained-state snapshot bytes are no more than 2x Lua; and
7. deployment, observability, and operator retry remain supported; and
8. the real node proves the C-string ABI, patch publication, authenticated
   game clock, image-cache identity, snapshot restore, and forged-From denial.

If those gates fail, keep Lua and scale by process count. If they pass, port
only the compute worker first. Account and marketplace authorities benefit more
from auditable state transitions than from a speculative whole-system rewrite.
