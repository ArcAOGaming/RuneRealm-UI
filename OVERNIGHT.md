# Overnight run — 2026-08-31, 03:24 → 09:24 UTC

Deploy is up, the 6-hour soak ran to completion, and every unit test passes.
The run also produced one unambiguous negative result, which is the useful part.

## The graph

Blank deploy (`--blank --free --with-bots`), exit 0, `hyperbeam.tylerw.ai`,
still `TEST-` prefixed.

| | |
|---|---|
| game | `IAPvo71VwaYTodNgGybfaIKx_i9le8dZxjg27on2Tsw` |
| rune | `pmXfvk2UZCEgASFF8klo2DvW7zXPnzDi8bWFVs6nCo4` |
| AMM | `W3dLFN83B4U8CEsslRAqmc78pCsfoutG-NuwCOdJ9Yk` |
| quote | `PL9ZwQSRBMi6nIcoOD3zmGuhSLv-xOFXv3Tu0BqlNMk` |

## Unit tests — 949 passing, 0 failing

| suite | result |
|---|---|
| game (`test:lua:local`) | 615 / 0 |
| hunt (`test:hunt`) | 22 + 27 / 0 |
| marketplace (`test:marketplace:local`) | 20 + 11 + 71 / 0 |
| battle fleet (`test:battle-fleet`) | 110 + 16 + 5 + 9 + 36 / 0 |
| turbo (`test:turbo`) | 7 / 0 |
| swarm (`test:swarm`) | valid |
| `e2e.mjs` (real signatures, pre-soak) | 56 / 0 |

## The soak — ran the full 6.14 h, exited 1

`swarm.mjs` ran 22,113 s, completed its cleanup phase, and **exited 1**: 546
errors, 522 tolerated, **24 untolerated**. It did not crash — it finished and
then reported failure, which is the correct behaviour.

Authoritative numbers from `summary.json` (not the console log — the log's line
count is not the action count):

| | |
|---|---|
| attempted | 5,061 |
| succeeded | 4,516 |
| failed | 545 (**10.8%**) |
| elapsed | 22,113 s |

**Latency of the actions that SUCCEEDED:**

| p50 | p90 | p99 | max |
|---|---|---|---|
| **11.7 s** | 35.6 s | 143 s | 268 s |

Failed actions: p50 28.7 s, p99 300 s (the timeout ceiling).

The bots genuinely played: 790 bot battles, 568 PvP attacks, 206 hunt attacks,
46 hunt searches, 119 market listings, 110 buys, 119 lootboxes, 93 level-ups,
68 transfers.

The verifier flagged the trend on its own:

> `[major] degrading-under-load: median response went from 7614ms early in the
> run to 18516ms at the end`

But the whole-run p50 of 11.7 s is the honest headline — half of every
successful action took over eleven seconds. Early actions ran ~2.6 s; by cycle
96 they were 90-140 s, and four wallets hit the 300 s `pvpMove` ceiling.
Published read latency tracked it: p50 396 ms, p95 18.8 s, max 28.8 s.

## Errors: 546 of 5,061 attempted (10.8%)

| count | error | verdict |
|---|---|---|
| 261 | `Policy-epoch supply-flow limit reached` | economy guard doing its job — expected under sustained bot load, but worth confirming the epoch budget is sized for real traffic |
| 215 | hunt `outbox delivery could not be confirmed` (163 retrysettlement, 34 begin, 12 end, 6 capture) | **real bug.** The action lands, the cross-process push to the hunt worker never confirms. 163 settlement retries against only 46 searches means hunts are churning on settlement |
| 21 | `No such listing` | benign list/buy race between bots |
| 8 | HyperBEAM `scheduler_timeout` | node giving up under the backlog |

## What I changed and then un-changed

I cut the battle turn log to `keep = 10`, deployed it, and it broke the game —
`e2e` caught it at round six. A round appends one entry **per combatant**, so the
log stops growing after five rounds, and clients detect a resolved round by the
log getting longer. Reverted (`aa566a3`), redeployed, e2e green at 56/0.

The 1276 ms → 578 ms measurement was real but measured the pathological case:
`run-profile.sh` drives one battle to fifty rounds. A median fight is seven
rounds, ~14 entries, ~8.7 KB. If an attack must get cheaper, shrink the
per-entry cost, not the count.

## Also worth fixing

- **`seed-monsters` verifies before compute catches up** and reports most of the
  fleet as unseeded. False alarm both times — re-reading after the head caught
  up showed 50/50. It should pull compute to the head before checking.
- **AMM trading still untested by bots.** `src/lib/marketplace.ts` has read
  helpers only, so there are no write verbs for the swarm to call.
  `amm-load.mjs` remains a separate tool.
- **Bot logic is still weighted-random**, not goal-directed.
- Site upload not run. Turbo credits healthy (3.15 AR / 0.258 GiB).

## Artefacts

- swarm events: `.swarm/runs/2026-08-31T03-23-56-679Z/events.jsonl`
- verifier report: `.swarm/runs/2026-08-31T03-23-56-679Z/verify.json`
- tracker samples: `.ladder/overnight-2026-08-31T03-24-02-172Z.jsonl` + `.md`
