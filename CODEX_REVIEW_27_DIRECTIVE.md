# Codex Review #27 — Ry Farms: VERIFY the #26 fixes (2 P0s + 3 P1s)

**Repo:** `/Users/ryanhaigh/ry-farms` (point Codex HERE — not Documents/ry-farm, not portfolio-workspace).
**Scope:** `git diff 7c2fa41..HEAD` — one commit, `3854af9` (the #26 fix set). **Verification + regression**: for
each fix, (1) does it ACTUALLY resolve the #26 finding, and (2) did the fix — which restructured the render
frame's control flow, the wipe/undo backup scheme, and the writeback concurrency model — introduce a NEW bug?
Report only INCOMPLETE / INCORRECT fixes or NEW problems, ranked by severity. The prior fixes it builds on
(#25-1/2/3/4, #24-*) were verified in earlier rounds — don't re-litigate those unless #26 regressed them.

## The two sacred doctrines
1. **DETERMINISM.** Sim consumes only seeded rng; same seed ⇒ byte-identical town, twice. `tests/determinism.mjs`
   `same-twice` holds and the four baselines `7d142951 / 8e2c2899 / 60e50036 / ea4bc356` must NOT move. RNG is
   DELIBERATELY re-seeded on load (`randSeed`), so reload fixes are BEHAVIORAL fidelity, not stream-identity.
2. **COMPILE-DON'T-QUERY.** The LLM + SuperMemory (`api/*`) are never read in the sim loop.

Report **P0** (determinism / exactly-once / crash / save-corruption / silent state-loss) and **P1** with
`file:line`, a concrete repro, and a fix. Committed harnesses under `tests/` — RUN them and extend.

---

## Fix 1 — #26-1 widened interpolation try/finally  (`main.js`)
The `try` now begins BEFORE `applyFarmerInterp` and spans `audio.update`, the raid-detection block, the
raid/camera easing, the snap, and the whole world draw; the `finally` runs `restoreFarmerInterp()` and, gated on
`_snapped`, the camera restore. `_camFx/_camFy/_snapped` are declared before the try; the snap sets all three.
**Verify:**
- (a) **Restore covers EVERY throw site now.** Walk each statement inside the try (applyFarmerInterp, audio,
  anyBuilding scan, raid detection incl. `audio.raidSting()`, camera easing, whisper preload, shake, snap, bg,
  terrain, hover `screenToTile`, collectDrawables, the draw loop, drawWeather) — for a throw at each, is `f.pos`
  always restored (finally runs) and is the camera left correct (`_snapped` true only after the snap, so a
  pre-snap throw leaves the eased float untouched — confirm `_camFx` isn't read when `_snapped` is false)?
- (b) **Error propagation is acceptable.** The try has NO `catch` — a throw runs the finally then propagates out
  of `frame()`, skipping `drawUI`/`maybeAutosave`/`drawMoments`/`crt.render` for that frame. `requestAnimationFrame(frame)`
  was already scheduled at the top, so the next frame still fires. Confirm this degrades gracefully (a transient
  draw error self-recovers; sim state stays clean) and that NOTHING that MUST run every frame (e.g. an ack the
  sim relies on) lives after the try and could be starved by a persistent throw.
- (c) **No double-restore / stale `_trueI`.** `applyFarmerInterp` sets `_trueI` per farmer; `restoreFarmerInterp`
  restores any farmer with `_trueI` set. If `applyFarmerInterp` throws PART-way (a malformed farmer), the finally
  restores exactly the farmers already mutated — confirm, and confirm a farmer removed between apply and restore
  (death mid-frame — can that happen off the sim tick?) can't leave a dangling `_trueI` that writes onto a
  recycled object.

## Fix 2 — #26-2 coherent one-deep backup  (`save.js`)
Wipe now writes a single `backup:wipe = {seed, snap, latest, slice}`, only when a snapshot exists; an unsaved
wipe prunes the town from the index but leaves the previous backup intact. Undo reads `backup:wipe`, restores
all of it, and deletes that one key. (Browser-verified: wipe A → unsaved B → wipe B → undo restores A coherently.)
**Verify:**
- (a) **Backward-compat / orphaned old backups.** A wipe performed by the PREVIOUS (3-key) build leaves
  `backup:town`/`backup:latest`/`backup:worldslice`; the new `undoWipe` reads only `backup:wipe`, so that pending
  undo is now unreachable (returns null) and the three old keys leak forever. Is a one-time migration/cleanup
  warranted, or is silently abandoning a pre-upgrade undo acceptable? Also confirm the new wipe never leaves the
  old keys behind for a NEW wipe (it doesn't write them — confirm nothing reads them either).
- (b) **Unsaved-wipe index hygiene.** When wiping an unsaved town B (no snapshot), the town IS pruned from the
  index (towns/inbox/pairs/metPairs/news/encounters for B) but no backup is written. Confirm B is fully removed
  (no zombie summary/metPairs) and that A's untouched `backup:wipe` still round-trips.
- (c) **Single-transaction integrity retained.** The consolidation didn't reintroduce a multi-transaction seam —
  confirm the whole wipe (reads + prune + backup) and undo (reads + restore + delete) are each still ONE
  readwrite transaction, and the `rWorld.onsuccess` reads `snap`/`latest`/`backup` set by earlier requests in
  the same txn (issue-order guarantee).

## Fix 3 — #26-3/#26-4 writeback rev registry hardening  (`api/memory-writeback.js`)
Registry + write-chains hoisted to `globalThis` (survive the dev server's per-request `require.cache` clear);
per-customId promise-chain serialization; rev RESERVED before the fetch and ROLLED BACK on failure; registry
capped (oldest-evicted). **Verify:**
- (a) **Serialization + reserve actually prevent the race.** Two concurrent requests to the same customId (rev 11
  and stale rev 10): confirm only the newer lands and the registry can't regress to 10. Also the reverse arrival
  order (10 first, then 11) — does 10 write then 11 write (both, ordered), leaving the store at 11? Is a
  transiently-written-then-superseded stale doc acceptable (SuperMemory has no conditional write, so ordering is
  the best we get)?
- (b) **Rollback correctness.** On a FAILED fetch the reservation is rolled back only if the registry still holds
  MY rev. Trace: reserve 11 (prev undefined) → fetch fails → rollback deletes the entry → a chained rev 10 then
  sees no entry and is accepted (writes 10). Is that the intended "newest SUCCESSFUL wins, retries recover"
  behavior, or a hole (a failed-then-lower write regresses content)? Any case where rollback restores a WRONG
  prev (e.g. the cap evicted the id mid-flight)?
- (c) **Chain-map leak.** `writeChains.set(id, run); run.finally(() => if tail === run delete)`. Confirm a steady
  stream of writes to the same id can't leak chain entries, and that a rejected `run` still cleans up (the
  finally runs on rejection). Does the cap on `revRegistry` (4096) have a counterpart worry for `writeChains`
  (it self-cleans, but confirm)?
- (d) **globalThis correctness.** `||=` creates the Map once per process. Confirm the reloaded handler reads the
  SAME Map (browser/harness showed a re-import still rejects a stale rev). Note the residual: per-process only —
  a server restart or a second worker starts empty. Is the endpoint EVER multi-worker/serverless, or strictly
  the single long-running local self-host? (If the latter, this is adequate; if not, flag it.)

## Fix 4 — #26-5 assembleT persistence  (`farm.js`)
`assembleT` (founding-assembly deliberation cadence, gates a `rand()` draw) added to farmer serialize/restore.
**Verify:** it round-trips (the harness covers it), defaults safely for old saves (`?? f.assembleT`, and the
handler uses `assembleT || 0`), and — now that #24-5/#25-5/#26-5 have swept many timers — whether ANY rng-gating
or authoritative-action timer STILL resets on reload (e.g. `huntTimer`/`huntTarget`, `barterDeal`, a
merchant/treasure/rare world timer, an election/role cadence). Classify each remaining one.

---

## Harnesses (run + extend)
```
node tests/determinism.mjs        # baselines UNCHANGED + round-trip (15 cooldowns + lightningTimer + assembleT) + drift-fails
node tests/encounters.mjs         # ledger counters + exact-ordinal idempotency
node tests/worldindex-bounds.mjs  # cap, no re-detection, ledger equivalence, inbox prune
node tests/writeback-guards.mjs   # origin/identity/coercion/stale-rev + CONCURRENT + reload-survival
node -c main.js && node -c save.js && node -c farm.js && node -c api/memory-writeback.js
```
Wipe/undo is IndexedDB-only — browser-verified (coherent backup, metPairs survive, 0 re-minted). Reason about
the single-transaction atomicity + issue-order guarantee directly, or drive fake-indexeddb if available. The
highest-value new checks: the widened-try throw-coverage (Fix 1a/c) and the rev-registry rollback edge (Fix 3b).
NOTE: the diagonal-scroll shimmer (interpolation + camera snap) is confirmed resolved by the user — treat those
render changes as validated; focus on correctness, not feel.
