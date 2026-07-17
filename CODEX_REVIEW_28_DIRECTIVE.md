# Codex Review #28 — Ry Farms: VERIFY the #27 fixes (2 P0s + 1 P1)

**Repo:** `/Users/ryanhaigh/ry-farms` (point Codex HERE — not Documents/ry-farm, not portfolio-workspace).
**Scope:** `git diff 3854af9..HEAD` — one commit, `ee2d939` (the #27 fix set). **Verification + regression**: for
each fix, (1) does it ACTUALLY resolve the #27 finding, and (2) did it introduce a NEW bug? These are narrow,
targeted fixes (marker clearing, legacy-backup migration, cap-eviction skip) — the review should be equally
narrow. Report only INCOMPLETE / INCORRECT fixes or NEW problems, ranked by severity. Prior rounds (#24–#27)
verified the surrounding machinery — don't re-litigate unless #27 regressed it.

## The two sacred doctrines
1. **DETERMINISM.** Sim consumes only seeded rng; same seed ⇒ byte-identical town, twice. `tests/determinism.mjs`
   `same-twice` holds and the four baselines `7d142951 / 8e2c2899 / 60e50036 / ea4bc356` must NOT move. RNG is
   re-seeded on load, so reload fixes are BEHAVIORAL fidelity, not stream-identity.
2. **COMPILE-DON'T-QUERY.** The LLM + SuperMemory (`api/*`) are never read in the sim loop.

Report **P0** (determinism / exactly-once / crash / save-corruption / silent state-loss) and **P1** with
`file:line`, a concrete repro, and a fix. Committed harnesses under `tests/` — RUN them and extend.

---

## Fix 1 — #27-1 clear interpolation markers on restore  (`main.js`)
`restoreFarmerInterp()` now sets `f._trueI = f._trueJ = undefined` after restoring, so a farmer carries a marker
only while actually mutated THIS pass (a partial-apply throw next frame can't rewrite un-touched farmers with
stale coords). `_riI/_riJ` (the interpolation "from") are SEPARATE and intentionally persist. **Verify:**
- (a) **Partial-apply safety actually holds now.** Repro the original bug post-fix: run one good frame, then make
  `applyFarmerInterp` throw after farmer 0 on the next frame — confirm farmers 1..n keep their newly-advanced sim
  positions (no marker set for them this frame → finally skips them). Confirm the earlier repro (positions
  `[1,0,0]`) no longer reproduces.
- (b) **No OTHER reader of `_trueI/_trueJ`.** Clearing them to `undefined` between frames must not break anything
  that expected them to persist. Grep for every read of `_trueI/_trueJ` — is `restoreFarmerInterp` the only one?
- (c) **`_riI` interplay.** `_riI` is set in the tick loop (pre-tick snapshot) and lazily in `applyFarmerInterp`
  (`if (_riI === undefined)`). Clearing `_trueI` doesn't touch `_riI` — confirm interpolation still uses the
  correct "from" across a 0-tick frame, a multi-tick frame, and a freshly-spawned farmer (heir arrival) that has
  neither marker yet.

## Fix 2 — #27-2 legacy 3-key backup migration  (`save.js`)
`undoWipe` now also reads `backup:town`/`backup:latest`/`backup:worldslice`, migrates them into the coherent
`{seed,snap,latest,slice}` shape when `backup:wipe` is absent, and deletes ALL backup keys on restore; a new
saved wipe deletes the legacy keys once it writes `backup:wipe`. (Browser-verified: a legacy backup migrates +
restores; all keys consumed.) **Verify:**
- (a) **Migration edge cases.** A legacy backup with a MISSING piece — `backup:worldslice` absent (older pre-#24-2
  build) so `lgSlice` is undefined, or `backup:latest` absent. Does the reconstruct `{seed:lgTown.seed, snap:lgTown,
  latest:lgLatest, slice:lgSlice}` + the `if (slice)` guard + the latest fallback all degrade cleanly (restore the
  town without throwing)?
- (b) **Mixed/stale state.** Can `backup:wipe` AND legacy keys ever COEXIST (e.g. a legacy backup present, then an
  UNSAVED wipe that writes no `backup:wipe` and doesn't delete legacy, then a SAVED wipe that writes `backup:wipe`
  and deletes legacy)? Trace whether any sequence leaves a stale legacy key that a later undo could wrongly prefer
  or that leaks. Confirm undo consuming all four keys can't delete a key belonging to a DIFFERENT pending
  generation.
- (c) **Atomicity retained.** The added legacy reads are issued in the same transaction before `rWorld`; confirm
  they're all set when `rWorld.onsuccess` runs (issue-order), and the whole undo is still ONE readwrite txn.

## Fix 3 — #27-3 cap eviction skips in-flight ids  (`api/memory-writeback.js`)
Eviction now iterates `revRegistry.keys()` and deletes the oldest id NOT in `writeChains`; if all are active it
overflows temporarily. **Verify:**
- (a) **The reserved-in-flight id survives.** Confirm the harness case (an in-flight rev-50 survives a
  cap-overflow eviction; a later stale rev-40 is rejected) is sound, and that eviction can't skip PAST the true
  target to delete a still-needed inactive id whose rev another in-flight write depends on (it shouldn't — an
  inactive id has no in-flight dependent — but confirm).
- (b) **Overflow bound.** If MANY writes are concurrently in-flight (all in `writeChains`), eviction finds no
  inactive id and the registry overflows past `REV_CAP`. Is that bounded in practice (each write settles via the
  8s fetch deadline, releasing its chain entry), or can a stuck/never-resolving fetch pin an entry forever and
  let the registry grow? For a local single-user self-host, is the concurrent-in-flight count ever large?
- (c) **Insertion-order churn.** #27 skipped active ids but did NOT refresh insertion order on reserve, so a
  FREQUENTLY-written id that's usually inactive between writes stays "old" and is a repeated eviction target,
  losing its reservation between writes. Is that a correctness issue (a stale write could slip for a hot id
  right after its reservation is evicted) or merely churn? If correctness, propose refreshing order on reserve.
- (d) **Determinism/scope sanity.** This is off-sim, off-digest — confirm nothing here touches the sim loop.

---

## Harnesses (run + extend)
```
node tests/determinism.mjs        # baselines UNCHANGED + round-trip (15 cooldowns + lightningTimer + assembleT)
node tests/encounters.mjs         # ledger counters + exact-ordinal idempotency
node tests/worldindex-bounds.mjs  # cap, no re-detection, ledger equivalence, inbox prune
node tests/writeback-guards.mjs   # origin/identity/coercion/stale-rev/concurrent/reload/CAP-eviction
node -c main.js && node -c save.js && node -c api/memory-writeback.js
```
Wipe/undo + interpolation are browser-verified (legacy migration restores + consumes all keys; interpolation
markers cleared between frames). If `fake-indexeddb` is available, port the wipe/undo migration + the
partial-apply-throw interpolation repro to headless harnesses; otherwise reason about them directly. Highest-value
new checks: the partial-apply-throw repro (Fix 1a) and the mixed legacy/coherent backup state (Fix 2b).

If this round finds nothing material, say so plainly — the persistence + render surface has been through four
converging rounds and may have bottomed out; a clean pass is a valid and useful result.
