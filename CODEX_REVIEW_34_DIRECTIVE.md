# Codex Review #34 — Ry Farms: VERIFY the #33 P1 fixes (post-push confirmation)

**Repo:** `/Users/ryanhaigh/ry-farms` — point Codex HERE, at the FULL absolute path. (Codex has repeatedly defaulted
to a stale `/Users/ryanhaigh/Documents/ry-farm` @ #97 with UNRELATED history — that is the WRONG repo. The right
one's HEAD is `8c1f6ff` on `main`, remote `github.com/heyhaigh/farm-sim` — review the working checkout directly.)
**Scope:** `git diff 7b1fe03..HEAD` — **1 commit** (`8c1f6ff`), 2 files, ~21 lines: `farm.js` + `tests/determinism.mjs`.

This is a TIGHT verification pass: confirm the two Codex-#33 P1 fixes actually resolve their findings and introduce
NOTHING new (the fixes are already pushed — this is a fix-forward confirmation, so flag anything that would warrant a
follow-up commit). Report only REAL defects, ranked, with `file:line` + a concrete repro + a fix. A clean pass is the
expected result — say so plainly.

## The two sacred doctrines (unchanged)
1. **DETERMINISM.** Seeded rng + pure hashes only; same seed ⇒ byte-identical, twice. `tests/determinism.mjs`
   `same-twice` MUST hold; baselines are **`b9fdb11b / 49314834 / 246728a5 / 640f109e`** (seeds `20260706/42/7/3`).
   These fixes did NOT re-pin (the legacy-save + downed-watcher edges don't occur in a fresh harness run) — CONFIRM
   the baselines are genuinely unchanged and same-twice holds, i.e. the fixes are inert on the deterministic core.
2. **COMPILE-DON'T-QUERY.** Unaffected here (both fixes are in the sim's save/health path, not the LLM/persistence side).

---

## A. FIX 1 — legacy-save `nightsExposed` default (`farm.js` fromSave, ~line 2841)
The bug: a SECOND raw assignment `f.nightsExposed = fd.nightsExposed` overwrote the new `|| 0` fallback, so an old
save lacking the field restored it to `undefined` → `undefined + 1 = NaN` at the next dawn, permanently disabling the
homelessness-exposure + shelter-pressure comparisons. The fix: that line is now `f.nightsExposed = fd.nightsExposed ?? 0`,
and the redundant `f.nightsExposed = fd.nightsExposed || 0` in the health-field block (~line 2830) was DROPPED.
- **A1.** Confirm there is now EXACTLY ONE assignment of `f.nightsExposed` in `fromSave` (no third one lurking), and
  it defaults a missing field to `0`, not `undefined`. Confirm a CURRENT save (field present, possibly a legit `0`)
  round-trips its real value (`?? 0` preserves `0` and any positive count; only null/undefined → 0).
- **A2.** Trace the consequence: after restore + one dawn (`#dailyHealthCheck` does `f.nightsExposed = homeless ?
  f.nightsExposed + 1 : 0`), `nightsExposed` stays a FINITE number for both an old save (was missing) and a current
  save. Confirm no OTHER field added this batch (`roughStreak`) has the same double-assignment hazard (it's only
  assigned once, `|| 0`, in the health block — confirm no raw duplicate elsewhere).
- **A3.** The new regression test (`determinism.mjs`, end of the round-trip section) deletes both fields from a
  serialized farmer, restores, advances one dawn, and asserts finite/0. Confirm the test actually EXERCISES the bug
  (i.e. it would FAIL against the pre-fix code — a raw `fd.nightsExposed` would make it NaN) and isn't a tautology.

## B. FIX 2 — `stoodWatch` cleared before early `continue`s (`farm.js` `#dailyHealthCheck`)
The bug: `stoodWatch` (the sentry's nightly illness-exemption) was cleared only at the END of the loop body, but the
`downed` and `sick` branches `continue` BEFORE it — so a watcher downed/sicked overnight kept the flag through
recovery and wrongly skipped their first later illness roll. The fix: capture `const stoodWatch = f.stoodWatch;
f.stoodWatch = false;` at the TOP of each farmer iteration (before any `continue`), and the `atRisk` check now reads
the captured `stoodWatch` (not `f.stoodWatch`).
- **B1 — clear-before-continue.** Confirm the capture+clear is above BOTH the `downed` and `sick` early-`continue`s,
  so the flag is reset EVERY dawn for EVERY farmer regardless of branch, and can never persist across a night.
- **B2 — the captured value is used, and the end-of-body clear is gone.** Confirm `atRisk` reads the local
  `stoodWatch`, and that there is no longer a duplicate `f.stoodWatch = false` at the bottom (a leftover would be
  harmless but confirm the diff removed it). Confirm nothing between the capture and the `atRisk` check re-sets
  `f.stoodWatch` (it shouldn't — `#takeWatch` only runs in the sim tick, not inside the dawn health check).
- **B3 — semantics preserved for the healthy path.** For a farmer who is NOT downed/sick, is `!stoodWatch` (captured
  at top) EQUIVALENT to the old `!f.stoodWatch` (read where `atRisk` sits)? It must be — nothing mutates it in
  between — so the healthy-farmer digest is unchanged (which the baselines confirm). Sanity-check that reasoning.
- **B4 — no new exemption hole.** Could the capture+clear now WRONGLY clear a flag that should have carried (e.g. a
  farmer who legitimately stood watch and is healthy)? No — they're exempted THIS dawn via the captured value, and
  the flag SHOULD reset for the next night (it's re-set by `#takeWatch` if they stand watch again). Confirm the flag
  is genuinely per-night (set each night on the beat, consumed+cleared each dawn), not something that needs to persist.

---

## Harnesses (run all)
```
node tests/determinism.mjs        # same-twice + baselines b9fdb11b / 49314834 / 246728a5 / 640f109e; incl. the NEW old-save round-trip test
node tests/raid-adversarial.mjs ; node tests/encounters.mjs ; node tests/worldindex-bounds.mjs ; node tests/writeback-guards.mjs
node -c farm.js && node -c main.js && node -c worldmap.js && node -c reconciliation.js
```
Highest-value check: confirm the NEW round-trip assertions in `determinism.mjs` PASS on the fixed tree AND would FAIL
on the pre-fix tree (i.e. they pin the bug). If both fixes hold, the baselines are unchanged, and all harnesses pass,
this is a clean confirmation — nothing further to push.
