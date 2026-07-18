# Codex Review #42 — Ry Farms: POST-FIX re-check of the #41 findings + the raid regression fixes

**Repo:** `/Users/ryanhaigh/ry-farms` — the FULL absolute path (NOT `~/Documents/ry-farm`, a stale unrelated
repo). Branch `main`, HEAD `7df525f`. **These commits are LOCAL / UNPUSHED**; `origin/main` = `8584570`.
Codex runs in a separate checkout with no origin, so the review surface is the attached **`review.diff`**
(`git diff 8584570..7df525f -- main.js farm.js`, ~497 lines) plus this directive. There is no PR.

This is a **post-fix pass**, like #39 was for #38. Two things to verify: (A) that the four #41 findings are
genuinely fixed and the fixes introduced nothing new; (B) that the newer **regression fixes** — committed
AFTER the #41 review and therefore NOT yet seen by Codex — are correct and determinism-safe.

## Commit map (range 8584570..7df525f)
- `3d02655`…`44c5997` — the raid-visual batch **already reviewed in #41** (VS card, seam, orc walk, alert
  restructure). Re-scan only where the fixes below touch them.
- `4e57823` — **NEW since #41 — regression fixes** (review these fresh):
  seam rebound to a **clamped RADIAL band**; admin "STAGE A RAID" timing; `maybeFaceoff` rehearsal handling.
- `7df525f` — **the #41 fixes** (verify each finding is closed):
  freeze-race, long-name hard-wrap, mid-whisper dismiss, `_warCard` serialize cleanup.

## A. Verify the four #41 findings are CLOSED

- **A1 (was P1: freeze can begin after the raid advanced).** The tick batch is now
  `while (!faceoff && simAccumulator >= FIXED_DT && steps < 800)`, and `maybeFaceoff()` is called the tick a
  raid is BORN (`!hadRaid && world.raidEvent`) INSIDE the loop. Confirm: (1) at 20x, a raid born mid-batch
  raises the card and the `!faceoff` guard EXITS the batch that same iteration — no further ticks run, so the
  raid is caught at `approach` (never advanced/struck behind the freeze); (2) the leftover `simAccumulator` is
  PRESERVED (not drained) across the frozen frames, and on dismissal the catch-up is bounded (≤ one frame's
  worth, since the freeze adds 0 to the accumulator — no wall-clock backlog); (3) the interp snapshot/restore
  invariant still holds when the loop exits early (raiders/farmers restored before autosave / next tick); (4)
  no double-fire: `maybeFaceoff()` is idempotent via `faceoffSeenEvent`, so calling it inside the loop AND
  after it can't raise two cards.

- **A2 (was P1: long single-token name overrun).** `faceoffWrap` now hard-splits a token wider than `maxW`
  via `faceoffSplitWord` (measured glyph width). Confirm a 30-char single token wraps to lines that each fit
  the ~104px centre gap, and that `faceoffSplitWord` can't loop forever / drop characters on a pathological
  input (single char wider than maxW → it still emits that char alone).

- **A3 (was P1: mid-whisper dismissal).** `maybeFaceoff` now calls `blurChatInput()` when it raises the card.
  Confirm this reaches the window keydown handler (so a raid landing while composing a whisper doesn't have
  its dismissal keys eaten), and that blurring mid-compose has no other side effect (no lost draft state that
  matters, no re-focus loop).

- **A4 (was P2: dangling `_warCard`).** serialize() now clones the pending raid directly
  (`{ ...this.pendingRaid, e: { ...this.pendingRaid.e } }`) with no `_warCard` reference. Confirm the clone is
  still a plain, structured-clone-safe copy that shares no live ref with the sim (nested `e` copied), and that
  a real (non-rehearsal) telegraph still round-trips through a save (a rehearsal telegraph still serializes as
  `null`).

## B. Review the regression fixes (`4e57823`) fresh

- **B1. The seam — clamped RADIAL band (`drawRaidSeam`, main.js).** The prior per-tile edge approach washed
  the whole screen in a well-explored town (it painted interior fog pockets). It's replaced by a radial band
  at the per-angle frontier, each sample `Math.min(frontierDist(a), medR + 8)` (corridor clamp), with a tight
  depth falloff (`SEAM_BLEED` into fog, short revealed lip). Confirm: (1) purely a DISPLAY read
  (`pendingRaid`, `frontierDist`, `isRevealed`) — no sim/determinism reach, bails once `raidEvent` exists;
  (2) the median sampling can't NaN/throw on a fresh tiny town (fallback `medR = 26`); (3) interior fog
  pockets can NOT light up (the band is radial around the clamped frontier, not per-edge) — the wash is truly
  gone; (4) cost is the on-screen tile loop, bounded.

- **B2. Admin raid timing (`startRaidRehearsal`, farm.js).** An admin-staged raid now sets
  `detectAt = this.time` and `landsAt = this.time + 12` (was `time + LEAD` / `time + LEAD - RALLY`). Confirm:
  (1) this is REHEARSAL-only (the real-gameplay `#decide`/telegraph path is untouched); (2) a rehearsal
  `pendingRaid` is never serialized (serialize() returns `null` for it), so the timing never rides a save or
  perturbs determinism; (3) `detectAt = this.time` fires detection on the next tick (immediate shader) with no
  off-by-one that skips the alarm cry / muster.

- **B3. `maybeFaceoff` rehearsal handling (main.js).** The card now keys on the raidEvent OBJECT identity
  (`re === faceoffSeenEvent`) and no longer excludes rehearsals. Confirm: (1) one card per raid (real or
  rehearsed), reset on town-switch (`faceoffSeenEvent = null`); (2) a rehearsal raidEvent (`re.rehearsal`,
  display-only, never serialized) driving the card + the sim FREEZE is acceptable — it pauses the town while
  the preview card is up, resuming on dismiss, with no record written; (3) no null-deref when `re.e`/`re.e.foe`
  is absent.

## C. Determinism / doctrine (should still hold)
- `tests/determinism.mjs` baselines **`76f81ef4 / 20d5f94e / 64f39c7d / 3b8b9a8b`** are UNCHANGED (supplied
  info — a full checkout run confirms them; can't run from the patch). Confirm nothing in this range draws
  `world.rand` or writes serialized/digest state from a display path.
- The only farm.js changes are the rehearsal timing (display-only, unserialized) and the serialize clone
  (structurally identical output — `_warCard` was never present). Confirm both are determinism-inert.
- Compile-don't-query: the card/shader/seam read world+display state, never awaiting the LLM/SuperMemory.

Report ranked findings (P0 = determinism/persistence/crash; P1 = fix; P2 = note) with file:line + repro +
fix. A clean pass is the expected, welcome outcome — say so plainly if the #41 findings are closed and the
regression fixes are sound. Call out explicitly whether the freeze-race fix (A1) is watertight, since it's
the subtle one.
