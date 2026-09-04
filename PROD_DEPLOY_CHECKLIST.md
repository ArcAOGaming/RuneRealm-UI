# Prod deploy readiness

Status 2026-09-03, after the store re-baseline that took the game from 16 s to
520 ms round trips. This is the gate list for a production deploy. Items are
grouped by whether they are **done**, **safe hardening** (reversible, do before
launch), or **the release gate** (irreversible, needs a human decision).

## Done

- **Root-cause perf fix.** `process-snapshot-slots: 1 → 50` and
  `store-all-signed: false`. Measured: game write 16 s → ~520 ms, primary store
  177 GB → 64 MB, spawn 23 s → 1.8 s. See `backend/native/hbfast/` and
  memory `module-size-is-the-12s`.
- **Deploy pipeline verified end to end.** A clean `redeploy --blank` stood up
  game + Rune + bridge + AMM + hunt fleet and re-pointed the app in one run.
- **Recovery/seed tooling.** 168 paid wallets restore from
  `legacy-players.json`; nine legacynet processes revive from Arweave
  checkpoints (HANDOFF §3).
- **6-hour soak running** (50 bots) to prove latency stays flat under sustained
  load — the thing that regressed before. Baseline store 64 MB captured.

## Safe hardening — before launch, reversible

Each restarts the node briefly, so schedule around the soak.

1. **Set a production rate limit.** Currently **unset** → HyperBEAM default
   1000 req/60 s = 16.7/s *per IP*, which is the unlocalized 429 storm. Set
   explicit values in `node-config.json`:
   ```json
   "rate-limit-requests": 6000, "rate-limit-period": 60,
   "rate-limit-max": 6000, "rate-limit-min": 0
   ```
   `min: 0` matters — the default −1000 turns a burst into a 2-minute lockout.
   Tune the number to expected per-player request rate; 6000/60 s = 100/s per IP
   is generous headroom for one player and still throttles a scraper.
2. **Version the node config.** `node-config.json` exists only on the box and is
   unversioned. A node rebuild would silently lose `snapshot-slots: 50` — i.e.
   the entire speedup. Commit a canonical copy to the repo (e.g.
   `backend/native/node-config.prod.json`) and have deploy/rebuild copy it into
   place.
3. **Install the store watchdog.** `backend/native/hbfast/store-watch.sh` on the
   existing `hyperbeam-maintain.timer` — alerts at 20/60 GB primary so growth is
   a planned re-baseline, never a surprise. The timer is currently **paused**
   (stopped during the store work); re-enable it.
4. **Delete the 177 GB backup.** `cache-mainnet/lmdb.OLD-177G` on the box, once
   the soak confirms the fresh store is healthy. Frees ~177 GB.
5. **Confirm the scheduler async-upload patch is live.** tylerw.ai schedules a
   small module in ~180 ms (patched); verify it survived the `edge-local`
   rebuild, or writes serialise behind Arweave uploads again under load.

## The release gate — irreversible, needs decisions

Per CLAUDE.md, dropping `TEST-` means the supply, the process ids and the node
are all **final**. Do not cross this line until every item is a deliberate yes.

1. **Is the token implementation settled?** CLAUDE.md explicitly gates the
   release on this ("the token implementation is not even settled"). A permanent
   token minted into real wallets cannot be recalled. **This is the top
   blocker.** — DECISION NEEDED.
2. **Real names.** `TEST-` is hardcoded in five places, no release flag:
   `deploy.mjs` (`TEST-Rune Realm Game`), `deploy-hunt.mjs`, `deploy-rune.mjs`
   (`TEST-Rune`/`TEST-RUNE`), `deploy-marketplace.mjs` (`TEST-RELIC`,
   `TEST-RUNE`), `amm.lua` (`TEST-RUNE`, `TEST-Rune Realm Swap`).
   `redeploy.mjs:634` warns if the token is not TEST-prefixed. — NEEDS the final
   name + ticker, then a one-time edit of those five.
3. **Node finality.** Is `hyperbeam.tylerw.ai` the permanent production node?
   Dropping `TEST-` fixes the node the processes live on. — DECISION NEEDED.
4. **Seed source.** Prod deploys with the real 168 paid wallets
   (`redeploy --seed`), not `--blank`. Reconcile the owner's own paid list first
   if it exists (`merge-paid.mjs`).
5. **Battle fleet.** Currently monolith (`battlefleet enabled:false`). Seal the
   fleet for launch, or keep the monolith? With the snapshot fix the monolith is
   fast; the fleet is insurance against serialisation at scale, not a latency
   win. — DECISION.
6. **Module size (optional).** 355 KB is above the ~266 KB perf cliff *measured
   on a bloated store* — on the small production store it runs at 520 ms, so
   this is not urgent. Revisit only if a store grows large between re-baselines.

## Suggested sequence

1. Finish/read the 6-hour soak. Confirm flat latency + bounded store growth.
2. Do all **safe hardening** (1–5). Redeploy once more, blank, to prove the
   hardened config is clean.
3. Resolve the **release-gate decisions** (token, names, node, seed, fleet).
4. Edit the five `TEST-` strings to the final names.
5. `redeploy --seed` (real players) onto the final node. Verify sub-second.
6. Delete the old backup, arm the watchdog, and record the final process ids.
