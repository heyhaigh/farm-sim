# Codex Review #31 — Ry Farms: VERIFY the #30 fixes + review the foe/watch behaviour batch

**Repo:** `/Users/ryanhaigh/ry-farms` — point Codex HERE, at the FULL absolute path. (Last round it defaulted to a
stale `/Users/ryanhaigh/Documents/ry-farm` @ #97 with unrelated history; that is the WRONG repo. The right one's
HEAD is `06768bb` on `main`, no git remote — review the working checkout directly, don't try to fetch.)
**Scope:** `git diff 3121429..HEAD` — **5 commits** (`14bd960 dab8e31 12c3d38 a9bd45c 06768bb`).

Two jobs: **(A) VERIFY the Codex-#30 P1 fixes** (`14bd960`) actually resolved their findings and introduced nothing
new; **(B) REVIEW the new behaviour work** — the foe-vs-fence rework and the all-day watcher-priority change are
the highest-risk NEW surface (both mutate sim state and drove determinism re-pins); the bubble + toast changes are
display-only. Hunt for correctness / determinism / save-replay / lifecycle / softlock defects. Report only real
defects, ranked, with `file:line` + a concrete repro + a fix. A near-clean pass is a valid result — say so plainly.

## The two sacred doctrines
1. **DETERMINISM.** Sim consumes only seeded rng + pure position hashes; same seed ⇒ byte-identical, twice.
   `tests/determinism.mjs` `same-twice` MUST hold, and the four baselines were re-pinned this batch to
   **`6dbe689c / d1c4c480 / 35c98309 / f93e50f5`** (seeds `20260706 / 42 / 7 / 3`). Two legitimate re-pins: the
   all-day watcher-priority change, and the foe-vs-fence rework (foes bash fences + farmers flee differently).
   RUN the harness and confirm same-twice + these baselines.
2. **COMPILE-DON'T-QUERY.** LLM + SuperMemory (`api/*`, `memory-writeback.js`, `congregation.js`) are display/
   persistence side-channels the sim never reads in its loop.

Report **P0** (determinism break / crash / save-corruption / silent state-loss / SOFTLOCK — an encounter or fleeing
farmer that never resolves) and **P1** (a mechanic that misfires, a lifecycle edge that strands state) + a fix.

---

## A. VERIFY the Codex-#30 fixes (`14bd960`)
- **A1 — the palisade "phantom raid" standoff** (`worldmap.js`). A zero-commit (palisade) raider now short-circuits
  to a `standoff` event BEFORE `applyOutcome`/`queueInbox`, leaving the ledger/tier untouched. Confirm: the pair is
  still marked MET (line ~127) so it isn't re-resolved every tick; NO grievance/inbox/monument is produced; the
  `standoff` event renders (encounterLine) and propagates no news. Regression: a NON-zero-commit raid still raids;
  a palisade HUMAN town (its natural doctrine) that was never the aggressor isn't affected (only the aggressor's
  commit gates the standoff — confirm the aggressor is always `orc` here and commit is read from the right side).
- **A2 — consumeInbox republishes the learned summary** (`main.js`). After applyInbox (a raid the town learns
  from) + a successful save, `consumeInbox` now upserts a fresh rev-guarded summary in the same txn that clears
  the inbox. Confirm: (i) the rev-guard matches `registerWorld`'s (never regresses a newer tab's summary); (ii) no
  re-entrancy hazard — `consumeInbox` runs INSIDE `registerWorld` under `_worldBusy`, and this adds a second
  `updateWorldIndex` txn; is that still safe (no nested detectEncounters, no lost `firstSeen`)? (iii) the summary
  captured is synchronous with the just-saved state (the sim can't interleave).
- **A3 — congregation coverage state survives reload** (`farm.js`). `_congState` (order/rr/nextAt/turns/last +
  the three Sets flattened to arrays) is serialized + restored. Confirm: an OLD save without `congState` restores
  to `null` cleanly; a reload MID-congregation continues covering the UNSPOKEN founders (not replaying spoken
  ones) and completes within the window; a save AFTER congregation (foundingPhase cleared) doesn't carry stale
  `_congState` that could misbehave. `_foundingScript` is NOT serialized — confirm the reloaded director falls to
  the procedural pools and still covers everyone.

## B. #foe-vs-fence (`a9bd45c`, farm.js) — HIGHEST-RISK, scrutinise for SOFTLOCKS + runaway state
A FOE (orc/assassin) no longer breaks off at the target's own fenced plot (break-off is now `beast &&
#onOwnFencedPlot`); it presses in, and `#foeBashFence` knocks a fence post out per ~1.5s of breaching, setting
`built.fence=false` once `fencePosts < fenceTarget`. Farmers flee to CENTER vs a foe (a wary one always; a naive
one until the fence breaks).
- **B1 — can a chase ever SOFTLOCK?** Before, a foe broke off when the farmer reached their fence — a guaranteed
  terminator. Now it presses in. Trace every exit: does the encounter still ALWAYS end (life timer `e.life<=0`;
  the farmer downed/rescued; the foe felled)? A farmer who flees to CENTER with a foe chasing — the foe follows
  into the village (threatInVillage) where defenders rally; confirm it resolves and can't orbit the target
  forever at `dist ~1.2` without the clash timer firing. A target standing ON their own fenced plot with the foe
  outside a still-complete fence: the foe slows to 0.4x ON the fence and bashes it down over ~1.5s, THEN reaches
  and clashes — confirm the bash actually opens the path (does `built.fence=false` make `tileInFencedPlot` false
  so the foe stops being slowed / the movement proceeds?), and that `e.bashT` accumulates correctly (it's per-
  encounter, reset per post) and can't stall if the foe oscillates on/off the fence tile.
- **B2 — runaway / wrong property destruction.** `#foeBashFence` is gated to `e.target.plot` only. Confirm a foe
  can't damage a BYSTANDER's fence it merely crosses while chasing to the plaza, can't drive `fencePosts` below 0,
  and that `built.fence=false`+`fencePosts` decrement + `p.rev++` correctly re-renders a DAMAGED fence (not a
  glitch/duplicate) and rides the save. Once breached, does the plot ever get its fence back (the owner re-raises
  posts via the normal build loop — confirm `built.fence=false` + `p.building=null` doesn't wedge the rebuild)?
- **B3 — the flee split (naive vs wary).** `wary = threatWary.foe >= 1`. Confirm the naive→realize→plaza transition
  actually fires (once the foe breaks the fence, `homeSafe` flips false → the flee target becomes CENTER on the
  next tick) and can't thrash (home↔plaza) frame-to-frame. Determinism: `threatWary.foe` is seeded/lived state,
  no rng in the flee branch — confirm.
- **B4 — determinism scope.** Foes/fences run in the headless harness (day 2+), which drove the re-pin. Confirm
  no `this.rand`/wall-clock leaked into `#foeBashFence` or the encounter changes (the bash uses a dt accumulator).

## C. #watcher-priority (`dab8e31`, farm.js) — behavioural, drove a re-pin
`#onWatchDuty` dropped the housing guard: the day's sentry now stands the beat day+night even unhoused (kept the
sick/downed + `plot.sited` guards).
- **C1 — survival / exposure.** An unhoused watcher who patrols all day+night on their rotation day instead of
  building — can they get permanently stranded (never build a house, accrue exposure/illness)? It's 1 day in ~8
  (the rotation), and patrolling regains energy (no drain), and survival branches sit ABOVE the watch branch —
  confirm a sick/exhausted watcher still rests, and an unhoused watcher isn't blocked from building on their
  NON-watch days. Any town where the rotation + this change measurably stalls early development?
- **C2 — ordering.** The watch branch preempts farming/building; confirm it still sits AFTER genuine survival
  (sick/exhaustion) and the muster/rally branches, so a raid alarm or a wilderness threat still pulls the watcher.

## D. Display-only — bubble + toast (`12c3d38` superseded by `a9bd45c`; `06768bb`)
- **D1 — bubble.** The render is back to ONE line at a time (typewriter within the line), paging through ALL lines
  (no 4-line cap, dots removed); `say()` t0 = `lines * SAY_LINE_SEC + 0.4`, `charSec` on the bubble. Confirm no
  crash on degenerate input (empty/oversized line, a single very long word, `f.memoryEcho` precedence) and that a
  long saying's t0 keeps the congregation director's cadence sane (director reads `bubble.t0`). NB `12c3d38` was a
  brief all-lines-at-once experiment reverted by `a9bd45c` — review the NET result at HEAD, not the intermediate.
- **D2 — toast.** `CALLOUT_MS` 1900→3800; a dismiss `X` with `CALLOUT_CLOSE` hit-rect set each frame + consumed in
  the `pointerdown` handler. Confirm the rect is cleared when no toast is up (so a stale click can't dismiss a
  phantom), the X hit maps correctly through the CRT (it's a top HUD element), and clicking the bar (not the X)
  still falls through.

---

## Harnesses (run + extend)
```
node tests/determinism.mjs        # same-twice + baselines 6dbe689c / d1c4c480 / 35c98309 / f93e50f5; save round-trip
node tests/raid-adversarial.mjs   # telegraph / dormant / #133 counterfactual / #134 learning arc
node tests/encounters.mjs ; node tests/worldindex-bounds.mjs ; node tests/writeback-guards.mjs
node -c farm.js && node -c main.js && node -c worldmap.js && node -c reconciliation.js
```
Highest-value NEW checks if a headless World harness is available:
1. **Foe-fence termination (B1):** a foe targeting a farmer on their own COMPLETE fence — assert the encounter
   resolves within a bounded number of ticks (bash → breach → clash → end), never orbits forever.
2. **Fence bash bounds (B2):** assert `fencePosts` never goes < 0, `built.fence` flips false exactly once, and a
   bystander plot the foe crosses is untouched.
3. **congState reload (A3):** save mid-congregation → fromSave → tick to the window's end → assert every founder spoke.

Concentrate on **B (softlocks + runaway fence destruction)** and **A2 (the consumeInbox re-entrancy)**. If those
hold and A confirms the #30 fixes, a clean pass is expected — but B1's "can a foe/farmer chase now fail to
terminate?" must get a definitive answer, since the old fence break-off was a guaranteed terminator we removed.
