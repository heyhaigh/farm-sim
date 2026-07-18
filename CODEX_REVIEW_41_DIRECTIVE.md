# Codex Review #41 — Ry Farms: the RAID-VISUAL overhaul (VS card, seam, orc walk, alert sequence)

**Repo:** `/Users/ryanhaigh/ry-farms` — the FULL absolute path (NOT `~/Documents/ry-farm`, a stale unrelated
repo). Branch `main`, HEAD `44c5997`, remote `github.com/heyhaigh/farm-sim`. **These commits are LOCAL /
UNPUSHED** — the whole batch is this review's surface. All prior work (through `a58af48`, Codex #40) is
already reviewed + pushed; do NOT re-review it.

**Scope — five commits, in order:**
- `8584570` Counter-offensive Phase 0 (booth war party) — *already conceptually reviewed via the council
  brief; include only for context. Focus your effort on the four below.*
- `3d02655` Telegraph-seam softening, drop battle red, add the post-raid VS face-off card.
- `5258388` Orc walk fix (walk/idle STROBE latch + raider position INTERPOLATION) + red seam rebound to the
  fog BOUNDARY only.
- `dbaf34a` Remove the WAR SO FAR modal + restructure the alert sequence (INCOMING RAID shader → detection;
  VS card → landing with a sim-FREEZE gate; VS layout/wrap/scale/banner).
- `44c5997` Drop the now-dead `_debrief.foeName` field.

`git diff a58af48..HEAD -- main.js farm.js` is the surface. It is **almost entirely render-only in main.js**;
`farm.js` has only ONE net change across the batch (the `_debrief.foeName` field was added in `3d02655` and
removed again in `44c5997` — net zero), so `farm.js` at HEAD is byte-identical to `a58af48` except nothing.
Confirm that.

## The two sacred doctrines (the crux — verify they hold)
1. **DETERMINISM.** Every change here must draw only from display state, never the seeded sim. Verify:
   - `tests/determinism.mjs` baselines **`76f81ef4 / 20d5f94e / 64f39c7d / 3b8b9a8b`** are UNCHANGED
     (same-twice + pinned). Run it.
   - The **raider interpolation** (`5258388`, `applyFarmerInterp`/`restoreFarmerInterp` + the tick-loop
     snapshot) mutates `raidEvent.raiders[].i/.j` ONLY between `world.tick` calls and RESTORES the true pos
     in the `finally` before anything reads or serializes. `raidEvent` is never serialized and never in the
     digest. Confirm the sim can NEVER observe an interpolated raider pos (the restore is unconditional, in
     the same `try/finally` as the farmer interp, and the teleport-guard `>4` matches the farmer path).
   - The **sim-FREEZE while the VS card is up** (`dbaf34a`, `simAccumulator += (_switching || faceoff) ? 0
     : ...`) merely withholds ticks — it must not skip, double-apply, or reorder any tick. Confirm resume is
     clean (no accumulator blowup: `steps < 800` cap already guards a long freeze; verify a 10s freeze then
     resume doesn't fast-forward 300 ticks in one frame in a way that matters — the cap should clamp it).
   - The `_debrief.foeName` removal: confirm nothing reads it (only `debriefLineFor` reads `_debrief`, via
     `d.foe`/`d.clan`). Confirm `_debrief` is still not serialized/digested.

2. **COMPILE-DON'T-QUERY.** The VS card / shader read display state (`world.raidEvent`, `world.nemesis`,
   `world.pendingRaid.detected`) and never await the LLM/SuperMemory. Confirm.

## Priority checks

- **A. VS card trigger (`maybeFaceoff`, main.js).** Fires once per raid on the `raidEvent` birth (landing),
  keyed by `rid = e.id || \`${e.pairKey}:${e.ordinal}\``, guarded against rehearsals (`re.rehearsal`).
  Verify: (1) it can't double-fire for one raid (rid stored in `faceoffSeenRid`); (2) it DOES fire again for
  the NEXT raid (new ordinal → new rid); (3) a booth REHEARSAL raid raises NO card; (4) `faceoffSeenRid` +
  `faceoff` are reset on town-switch (the reset line) so a card can't leak across a crossing; (5) no
  null-deref when `re.e`/`re.e.foe` is absent (non-nemesis raid → falls back to `e.foeName` → generic).

- **B. VS card render (`drawFaceoff` + `faceoffWrap`, main.js).** (1) The name wraps within `maxW = gap*2-12`
  and drops from scale 2 → 1 only if a single word exceeds `maxW`; confirm an absurdly long single token
  (e.g. a 30-char name) still renders inside the face gap and never overruns the busts. (2) The centered
  vertical stack math (`blockH`, the running `y`) stays on-screen for the max case (2 name lines + 2 context
  lines + scale-6 VS) at the min internal height (`GH ≈ 300`). (3) `drawFaceoffBust` with `imageSmoothingEnabled
  = true` is save/restored so it doesn't leak smoothing into later pixel draws. (4) The full-width yellow
  banner blink (`performance.now() % 900 < 560`) — confirm it's purely cosmetic and the card is dismissable
  by click AND key (the pointerup + keydown `if (faceoff) { faceoff = null; return; }` guards), plus the
  ~10.6s safety auto-continue so a passive session can't soft-lock behind a frozen sim.

- **C. Orc walk STROBE latch (`drawThreat`, main.js `5258388`).** The walk state is now latched on sim-time
  (`if (moved > 0.0006) e._lastStepAt = world.time; walking = e._lastStepAt != null && (world.time -
  e._lastStepAt) < 0.14`). Confirm: (1) `world.time` is frozen between renders (only advances on ticks) so
  the latch genuinely holds `walking` true across the 2–3 render frames per tick — killing the idle-frame-0
  flicker; (2) a raider that STOPS (duelling/struck) releases to idle after ~0.14s; (3) `e._lastStepAt` is a
  display-scratch on the never-serialized raider — no determinism reach; (4) the same latch applies to
  wilderness encounters (`world.encounters`) which flow through `drawThreat` too — no regression there.

- **D. Raid seam → fog boundary (`drawRaidSeam`, main.js `5258388`).** Now paints only revealed EDGE tiles
  (bordering fog) + a one-tile fog lip, in the bearing fan, with a MEDIAN reveal-radius distance-fade.
  Confirm: (1) it reads `world.pendingRaid` only and bails once `raidEvent` exists (no battle wash); (2) the
  median-radius sampling (`frontierDist` at 16 angles) can't throw / NaN on a fresh tiny town (fallback
  `medR = 26`); (3) no town-interior paint (the `allNbrRev` continue) and no deep-fog paint (median fade);
  (4) it's O(visible tiles) — the per-frame cost is bounded by the on-screen tile loop, acceptable.

- **E. Alert sequence restructure (`dbaf34a`).** (1) The INCOMING-RAID shader fires ONCE on the detection
  edge (`pr.detected && !_raidDetected`), resets when `!pr` — confirm it can't re-fire mid-telegraph and
  resets for the next raid + on town-switch. (2) The strike block no longer sets `raidFx` (keeps `raidShake`
  + audio) — confirm `raidFx.stings` refire logic (main loop) still works with the sole 'incoming' source.
  (3) The WAR SO FAR removal left no dangling refs (`_warCard`, `WAR SO FAR`) — confirm. (4) `drawRaidFx`
  headline fit loop (`while (scale > 2 && textWidth(big, scale) > GW*0.9) scale--`) can't underflow.

- **F. Harnesses.** `node tests/determinism.mjs` (four pinned hashes + same-twice), `node
  tests/raid-adversarial.mjs`, `node --check` on farm.js + main.js.

Report ranked findings (P0 = determinism/persistence/crash; P1 = fix; P2 = note) with file:line + repro +
fix. A clean pass is a valid, welcome outcome — say so plainly. Since this batch is render-heavy, explicitly
confirm whether the determinism contract (interp restored before any read, freeze withholds-not-skips,
display-scratch fields only) genuinely holds — that is the one thing that must not be wrong.
