# Codex Review #26 — Ry Farms: VERIFY the #25 fixes + the render-smoothing changes

**Repo:** `/Users/ryanhaigh/ry-farms` (point Codex HERE — not Documents/ry-farm, not portfolio-workspace).
**Scope:** `git diff d3f19ac..HEAD` — five commits: `e153a80` whisper preload, `afb5e7b` render interpolation,
`f4ec40e` camera pixel-snap, `9eebf34` the #25 fix set (4 P0s + 4 P1s), `7c2fa41` the try/finally hardening of the
interpolation restore (self-caught; verify it in Fix 1a). This is a **verification + regression**
pass: for each fix, (1) does it ACTUALLY resolve the #25 finding, and (2) did the fix — which touched
persistence-critical code (single-transaction wipe/undo, synchronous summary capture, the rev registry, ledger
idempotency) — introduce a NEW bug? Report only INCOMPLETE / INCORRECT fixes or NEW problems, ranked by severity.

## The two sacred doctrines
1. **DETERMINISM.** Sim consumes only seeded rng; same seed ⇒ byte-identical town, twice. `tests/determinism.mjs`
   `same-twice` holds and the four baselines `7d142951 / 8e2c2899 / 60e50036 / ea4bc356` must NOT move. RNG is
   DELIBERATELY re-seeded on load (`randSeed`), so reload fixes are BEHAVIORAL fidelity, not stream-identity.
   Raids/world-index/writeback are NOT exercised headless — reason about them directly.
2. **COMPILE-DON'T-QUERY.** The LLM + SuperMemory (`api/*`) are never read in the sim loop.

Report **P0** (determinism / exactly-once / crash / save-corruption / silent state-loss) and **P1** with
`file:line`, a concrete repro, and a fix. Committed harnesses under `tests/` — RUN them and extend with the
harder cases below.

---

## Fix 1 — Render interpolation  (`main.js`; `afb5e7b`)
The sim ticks at 30Hz but rendering is 60/120Hz, so farmers stuttered. `applyFarmerInterp(alpha)` stashes each
farmer's TRUE pos and moves `pos` to `lerp(pre-tick, sim, alpha)` for the camera + world draw; `restoreFarmerInterp()`
restores it before weather/UI/autosave. A `>2`-tile delta snaps (teleport). `_riI/_riJ` snapshot before each tick.
**Verify (this is the RISKIEST new code — it mutates then restores live sim state mid-frame):**
- (a) **Restore is guaranteed.** The world-draw pass is now wrapped in `try { … } finally { restoreFarmerInterp();
  cam.x=_camFx; cam.y=_camFy; }` so a throw mid-draw can't leave `f.pos` fractional for `maybeAutosave` to
  serialize. VERIFY the try spans EVERYTHING that runs while pos/cam are temporary (does the camera-easing block +
  `audio.update`, which run BEFORE the `try`, touch pos? they read interpolated `followTarget.pos` — a throw there
  is still unguarded, though those are arithmetic-only). Confirm `drawables` (now `const` inside the try) isn't
  referenced after, and that the finally can't itself throw.
- (b) **Autosave can't see interpolated pos.** Confirm `maybeAutosave()` runs strictly AFTER `restoreFarmerInterp()`
  every frame, and that NOTHING inside the draw pass (moments, chronicle, a Slice callback) serializes/persists or
  reads `f.pos` expecting the true sim value.
- (c) **Snapshot correctness.** `_riI` is set before each `world.tick`; after the loop it's the pre-last-tick pos.
  Confirm the alpha math (`simAccumulator / FIXED_DT`) yields continuous motion across the 0-tick, 1-tick, and
  multi-tick frames, and that a farmer removed/added mid-loop (death, heir arrival) can't read a stale `_riI` or
  leave `_trueI` set so `restoreFarmerInterp` writes a bogus pos onto a different farmer.
- (d) Does interpolation touch the CAMERA follow target correctly (it reads `followTarget.pos`, now interpolated)?
  Any place that reads `f.pos` for HIT-TESTING or click-mapping during the interpolated window (mouse handlers run
  outside it — confirm) that would mis-target by the ≤1-tile interpolation offset?

## Fix 2 — Camera pixel-snap  (`main.js`; `f4ec40e`)
`cam.x = Math.round(cam.x) + shake` for the world pass, restored to the float after. Paired with interpolation.
**Verify:** (a) same try/finally concern as Fix 1 — if a draw throws, `cam.x/cam.y` are left rounded (minor vs
Fix 1, but note it). (b) Input/hover mapping DURING the snapped window (`screenToTile` at the hover-highlight)
uses the snapped cam while click handlers use the float — is the ≤0.5px discrepancy ever tile-significant? (c)
Confirm the snap+interpolation actually eliminates the reported diagonal shimmer and doesn't reintroduce the
"whole-screen wobble" the earlier snap-on-stuttering-motion caused (it was reverted; this one rides interpolation).

## Fix 3 — #25-1 world registration of committed state only  (`main.js`; `9eebf34`)
`registerWorld(w, summary)` now takes a pre-captured summary; `maybeAutosave` captures `townSummary(w)`
synchronously with the save and stamps `summary.rev = w._rev` after commit; `openWorldMap` saves first and
registers on success. **Verify:**
- (a) **`w._rev` is the COMMITTED rev at stamp time.** `saveTown` sets `world._rev = data._rev` on success before
  resolving. Between `saveTown` resolving and the `.then` reading `w._rev`, could a SECOND autosave (or the
  openWorldMap save) have advanced `w._rev`, so the stamped rev doesn't match the summary's captured state?
- (b) **The `_worldBusy` drop.** `registerWorld` early-returns if `_worldBusy`. If an autosave's registration and
  `openWorldMap`'s registration overlap, one is silently DROPPED — does that skip encounter detection / inbox
  consumption for a real save, stranding an inbox? Should it queue/await instead?
- (c) The equal-rev path still upserts (`< prev.rev` skips; `=== prev.rev` merges). With the synchronous capture,
  is an equal-rev summary now guaranteed to carry identical authoritative fields, or can two same-rev summaries
  still differ (e.g., openWorldMap capturing a different tick than the autosave that committed that rev)?

## Fix 4 — #25-2/#25-3 single-transaction wipe/undo + metPairs  (`save.js`; `9eebf34`)
Both rewritten as ONE `readwrite` transaction; `metPairs` incident keys captured/deleted/restored.
**Verify:**
- (a) **IDB request-ordering assumption.** The code relies on `rSnap`/`rLatest`/`rSlice` `onsuccess` firing BEFORE
  `rWorld.onsuccess` (so `snap`/`latest`/`slice` are set when the world mutation runs). Is that ordering
  guaranteed by IndexedDB for requests issued against the same transaction in that order? Cite the guarantee or
  flag it as fragile.
- (b) **undo's early `return`.** In `undoWipe`, `rWorld.onsuccess` does `if (!snap) return;` — confirm the txn
  still completes and resolves `null` cleanly (no dangling), and that with a backup present every branch
  (`store.put`/`delete`) is issued inside this one txn (no await splits it).
- (c) **metPairs restore vs a wiped neighbor.** If the OTHER endpoint of a restored met-pair is not in
  `index.towns` (that neighbor was also wiped), the next `detectEncounters` GC drops the restored key again — is
  that acceptable (the neighbor's gone) or a re-detection hole? Also: does restoring a pair whose neighbor is
  present, but whose PRESENTATION encounter aged out of the 120-cap, leave the map log inconsistent (dedup ok,
  but no visible encounter)?
- (d) **Backup lifecycle.** A wipe with no world index yet, or an undo when `backup:worldslice` is missing but
  `backup:town` exists (older backup from before #24-2). Do both degrade cleanly?

## Fix 5 — #25-4 ledger exact-ordinal idempotency  (`reconciliation.js`; `9eebf34`)
`applyOutcome` now requires `meta.ordinal === ledgerCount(ledger)`. **Verify:**
- (a) The ONLY production caller (`worldmap.js` detectEncounters) computes `ordinal = ledgerCount(led)` then calls
  `applyOutcome(led, res.outcome, { ordinal })` with no mutation between — so ordinal always equals count. Confirm
  there is no other caller (or a retry/redelivery path) that could pass a non-matching ordinal and now SILENTLY
  drop a legitimate outcome (the old `< total` was lenient; `=== ` is strict — did that strictness break a real
  flow?).
- (b) Migration: a legacy ARRAY-shaped ledger loaded from an old save — `applyOutcome`/`foldDisposition`/`ledgerCount`
  all branch on `raidN != null`. Confirm the first `applyOutcome` on a legacy ledger derives counts correctly and
  the derived `ledgerCount` equals the legacy array length (so the ordinal matches and the append lands).

## Fix 6 — #25-6 writeback rev registry  (`api/memory-writeback.js`; `9eebf34`)
An in-process `Map` refuses `rev <= highest committed rev` per customId (recorded on success). **Verify:**
- (a) **Unbounded growth.** `revRegistry` never evicts — a long-running server accreting many towns/farmers grows
  it without bound. Bound it (LRU / cap) or note the ceiling.
- (b) **Legitimate same-rev update dropped.** If `world._rev` did NOT advance between two writebacks (content
  changed — new episodic memories — but no save bumped rev), the second is refused. How often can rev stay equal
  across two writeback calls in the real client flow? Is the lost update acceptable?
- (c) Serverless caveat: on Vercel (per-invocation process) the registry is empty each call → no protection. Is
  the endpoint ever deployed serverless, or is it strictly the long-running local self-host? State the exposure.

## Fix 7 — #25-5 remaining cooldown persistence  (`farm.js`; `9eebf34`)
Added lightningTimer (world) + helpCooldown/wellAskCooldown/oreExpedCooldown/annexCooldown/thoughtBubbleTimer/
wanderTimer (farmer). **Verify:** is the sweep NOW complete, or are there STILL per-farmer or world timers that
reset on reload and gate a `this.rand()`/`world.rand` draw or an authoritative action on the next tick — e.g.
`barterDeal`/`huntTimer`/`huntTarget`, a merchant/treasure/rare timer, `assembleT`, any election/role cadence
counter? For each remaining one, classify (already-serialized / display-only / genuine miss). The round-trip
harness covers the 14 named — extend it to any newly-found gate.

## Fix 8 — #25-7 strict identity + #25-8 test repair  (`api/memory-writeback.js`, `tests/encounters.mjs`; `9eebf34`)
`numOrNull` accepts only non-negative safe integers / canonical integer strings; `encounters.mjs` updated to the
counter shape. **Verify:** (a) `numOrNull` rejects everything non-canonical (leading zeros `'01'`, `'+1'`, `'1e3'`,
`' 1'`, huge > 2^53) — confirm the regex/`isSafeInteger` combo is airtight and doesn't reject a legitimate large
seed (seeds are `>>> 0`, so ≤ 2^32 — fine). (b) `encounters.mjs` now asserts counters + `ledgerCount` and retains
the repeated-and-gapped ordinal cases; confirm it would FAIL if #25-4 regressed.

## Fix 9 — Whisper preload  (`main.js`; `e153a80`)  — light
While following with the whisper COLLAPSED, `chatFarmer = followTarget` each frame; never when open.
**Verify (light):** the guard `!chatWidgetOpen` is the only gate; opening then closing re-arms cleanly; no stale
`chatFarmer` pointer to a farmer that has since died/left (it reads `world.farmers.includes(followTarget)`).

---

## Harnesses (run + extend)
```
node tests/determinism.mjs        # baselines UNCHANGED + round-trip (14 cooldowns + lightningTimer) + drift-fails
node tests/encounters.mjs         # ledger counters + exact-ordinal idempotency (#25-4/#25-8)
node tests/worldindex-bounds.mjs  # cap, no re-detection, ledger equivalence, inbox prune
node tests/writeback-guards.mjs   # origin/identity/coercion/stale-rev (#25-6/#25-7)
node -c main.js && node -c save.js && node -c farm.js && node -c reconciliation.js && node -c api/memory-writeback.js
```
Wipe/undo + metPairs is IndexedDB-only (browser-verified: metPairs survives wipe→undo, 0 re-minted). If you can
drive a headless IDB (fake-indexeddb), port that repro; else reason about the single-transaction atomicity + the
request-ordering guarantee directly. The interpolation restore-on-throw (Fix 1a) is the highest-value new check.
