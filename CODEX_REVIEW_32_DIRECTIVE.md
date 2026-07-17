# Codex Review #32 — Ry Farms: the WATCH/FOE polish batch (+ #135, toast)

**Repo:** `/Users/ryanhaigh/ry-farms` — point Codex HERE, at the FULL absolute path. (Codex has repeatedly
defaulted to a stale `/Users/ryanhaigh/Documents/ry-farm` @ #97 with UNRELATED history — that is the WRONG repo.
The right one's HEAD is `1baa52f` on `main`, NO git remote configured locally — review the working checkout
directly, do NOT try to fetch/pull.)
**Scope:** `git diff 0c7d7e2..HEAD` — **3 commits**, 3 files (`farm.js`, `main.js`, `tests/determinism.mjs`):
- `0ce2e99` — Discovery toasts +1.5x duration (CALLOUT_MS 3800→5700). Display-only, trivial.
- `a2cdbfd` — #135 reconciliation's MIDDLE ACT (a `reckon` memory-echo when a raid-creed is near-crossover). Display-only.
- `1baa52f` — the WATCH/FOE polish batch (the bulk; SIM state, drove a determinism re-pin). **Highest risk — focus here.**

Hunt for correctness / determinism / save-replay / lifecycle / SOFTLOCK defects. Report only REAL defects, ranked,
each with `file:line` + a concrete repro + a fix. A near-clean pass is a valid, expected result — say so plainly if so.

## The two sacred doctrines
1. **DETERMINISM.** The sim consumes ONLY seeded rng (`world.rand`, per-farmer `this.rand`) + pure position hashes
   with stable, sorted iteration. Same seed ⇒ byte-identical town, twice. `tests/determinism.mjs` `same-twice` MUST
   hold, and the four baselines were re-pinned this batch to **`d124375d / 1bbd99f8 / af6ef44f / c3368191`** (seeds
   `20260706 / 42 / 7 / 3`). RUN the harness and confirm same-twice + these baselines. The re-pin is legitimate (the
   foe-cadence gate, sentry-engages, flee-to-guard, sick hand-off, and the "no one came" bystander-filter all touch
   day-2+ sim state). A same-twice BREAK is a P0; an unexplained baseline DRIFT on an unrelated file is a regression.
2. **COMPILE-DON'T-QUERY.** LLM + SuperMemory (`api/*`, `memory-writeback.js`, `congregation.js`) are display/
   persistence side-channels the sim never reads in its loop. #135's `reckon` echo + the toast are display-only.

Report **P0** (determinism break / crash / save-corruption / silent state-loss / SOFTLOCK) and **P1** (a mechanic
that misfires, a lifecycle edge that strands state) + a fix.

---

## A. FOE CADENCE (`farm.js` — `#tickDM`, `#spawnEncounter`, new `FOE_COOLDOWN`/`FOE_JITTER`/`foeCooldown`)
Lethal foes (orc/assassin) now spawn only when a separate long, jittered `this.foeCooldown` has elapsed; otherwise
the encounter downgrades to a beast (fox/boar). When a foe DOES spawn, the gate re-arms (`FOE_COOLDOWN + rand*JITTER`).
- **A1 — rng-draw alignment.** `#spawnEncounter` draws `r = this.rand()` ONCE unconditionally, then the kind branch
  reads it; a foe spawn draws a SECOND `this.rand()` for the cooldown. Confirm the draw count is a deterministic
  function of seed state only (no branch consumes a different number of draws in a way that desyncs a later tick) —
  same-seed-twice must hold (the harness says it does; verify the reasoning).
- **A2 — save round-trip.** `foeCooldown` is serialized (`serialize`) + restored (`fromSave`, `|| 0`) + initialized
  in the ctor (240). Confirm an OLD save WITHOUT `foeCooldown` restores to 0 (foe eligible immediately — acceptable)
  and can't wedge. Confirm it can't go negative unboundedly (it's `Math.max(0, ...)` each tick — verify).
- **A3 — starvation / never-spawn.** Could the gate ever PERMANENTLY suppress foes (e.g. `foeCooldown` re-armed but
  the beast branch keeps firing so it never counts down enough)? It decrements every `#tickDM` regardless of spawn —
  confirm. Is `MAX_ENCOUNTERS`/`dmCooldown` interplay unchanged (no double-suppression that stalls ALL encounters)?

## B. SENTRY STANDS AT ARMS (`farm.js` — `#takeWatch` threat branch, `_watcherCharged`)
On spotting a foe on a townsfolk (target≠self, fit, in `world.farmers`) OR in the village, the sentry joins
`threat.helpers`, sets `combatStance='fight'`, and charges (`#goTo`/`state='fight'`) instead of falling back.
- **B1 — SOFTLOCK / termination.** The sentry now leaves the beat to fight. Trace exits: does this ever prevent the
  encounter from terminating (the old fall-back was passive)? A sentry charging a foe that then flees to the plaza —
  do they resolve (clash timer / `e.life` cap / foe felled)? Can the sentry orbit the foe at `dist~1.3` forever
  without the clash firing? Can two encounters make the sentry thrash between targets frame-to-frame?
- **B2 — `_watcherCharged` lifecycle.** It's a one-shot cry flag, reset to `false` on the no-threat path
  (`this._watcherCharged = false` after the threat block). Confirm it's reset reliably (a sentry who charges then the
  threat ends → re-armed for the next alarm), never gets stuck true (suppressing the cry forever) or false (spamming
  the cry every tick). Is it serialized? Does it NEED to be (it's cosmetic — a stuck value only affects one bark)?
- **B3 — is `_watcherCharged` a DIGEST-AFFECTING field?** It's a farmer property set in a sim method. Confirm it is
  NOT in the determinism snapshot (it's display-only) AND that adding a sentry to `threat.helpers` (which IS sim
  state — changes `#resolveClash` fighters) is the intended, re-pinned behavioural change (not an accidental one).

## C. FLEE TO THE GUARD (`farm.js` — `case 'flee'`, `#handleEncounter` flee say)
Vs a foe, the flee refuge becomes the fit `currentSentry()` (if not self/downed); the fleeing farmer shouts the
guard's name; a sentry who is the quarry never counts home safe (`!(foe && (wary || this===sentry))`).
- **C1 — thrash / convergence.** The victim flees TO the guard while the guard (per B) charges the FOE — which may be
  near the victim. Can the victim + guard + foe collapse into a stable non-terminating orbit? Does the victim ever
  flee INTO the foe (guard is standing on/near the foe)? Confirm the flee still ends (`fleeTimer` → `decide` → re-eval).
- **C2 — guard identity stability within a tick.** `currentSentry()` is called in BOTH the flee-target calc and the
  say. Confirm it returns the SAME farmer both times (no rng, pure) so the shout name matches the flee target.
- **C3 — sentry-as-quarry.** When the fleeing farmer IS the sentry: `guard` is null (self excluded), `homeSafe` false
  vs foe (the `this===sentry` term) → flee to CENTER. Confirm this is the intended "run for help, don't hide" and
  can't loop (they reach the plaza, no guard to run to, re-flee → still CENTER — bounded by `e.life`?).

## D. SICK-WATCHER HAND-OFF (`farm.js` — `World.#watchFit`, `#rotationWatcher`, `currentSentry`, `currentWatcher`)
`currentSentry()` = watchPost → watchFarmer → `#rotationWatcher()`, each only if `#watchFit` (not dead/sick/felled).
- **D1 — never-dark vs correctly-dark.** A sick seated Watch hands to the rotation; if EVERY rotation member is unfit,
  `#rotationWatcher` returns null (no sentry — acceptable, town in bad shape). Confirm nothing downstream assumes
  `currentSentry()` non-null (e.g. `#onWatchDuty`, `#soundWatchAlarm`, the flee `guard`, the "no one came" branch all
  null-guard it). Confirm `#rotationWatcher` reads `roles.watchRotation` which may contain DEAD seeds (the `find`
  returns undefined → `#watchFit(undefined)` false → skips — verify no throw).
- **D2 — display vs function split.** `currentWatcher()` keeps its pre-election `roles.watch != null → null` guard
  (used for the ROLES "keeps watch today" display); `currentSentry` uses `#rotationWatcher` for the functional
  fallback. Confirm the ROLES panel (`drawChronicleRoles`, now hosted in the ROSTER) still calls `currentWatcher`
  and reads sensibly when a seated Watch is sick (it shows the seated Watch, not the stand-in — acceptable? or should
  it reflect the hand-off? flag if misleading, don't fix).
- **D3 — determinism.** `#watchFit` reads `f.health` (lived state) — no rng. `#rotationWatcher` is day-math + seed
  order. Confirm no wall-clock / rng leaked into the sentry resolution.

## E. "NO ONE CAME" SOFTENING (`farm.js` — `#downFarmer` else-branch)
If a fit `currentSentry()` (≠ the felled farmer) existed, the chronicle reads "{sentry} could not reach them in time"
and the sentry is excluded from the resented `bystanders`.
- **E1 — opinion/memory determinism.** The bystander filter now excludes `x !== sentry`, changing which farmers get
  `adjustOpinion`/`remember` — this IS digest-affecting (re-pinned). Confirm it's deterministic (sentry identity is
  pure) and the chronicle `who=sentry` reference is a valid farmer (not null/stale).
- **E2 — the felled-WITH-helpers path is unchanged** (the `rescuers.length` branch above). Confirm E only touches the
  no-rescuers else, and that a sentry who charged (B) but the target still fell lands in the RIGHT branch (if the
  sentry is a non-downed helper → `rescuers.length>0` → "pulled back" branch, NOT the E branch — is that copy still
  right when the target was actually DOWNED? pre-existing, but flag if B made it worse/more frequent).

## F. DISPLAY-ONLY — drama cue + roster/roles tabs + toast + #135 (`main.js`, `farm.js`)
- **F1 — drama cue** (`drawDramaCue`, `DRAMA_KINDS`, new `drawCueEmblem`). `rift` removed from `DRAMA_KINDS`.
  Confirm nothing else keys off `DRAMA_KINDS.rift` (a chronicle still LOGS rifts; only the watch-cue nudge is gone).
  `drawCueEmblem` is pure canvas — confirm no crash on an unknown kind (falls to the `else` peril emblem). The W
  keycap hit: the cue is non-interactive (press W, never a click) — confirm no phantom hit-rect introduced.
- **F2 — ROSTER/ROLES tabs** (`drawRoster`, `rosterTab`, `rosterTabHits`, `CHRON_TABS` renumber). The Chronicle went
  from `['NEWS','ROLES','RECIPES','TALES']` to `['NEWS','RECIPES','TALES']` and the dispatch/title/openChron were
  renumbered (roles→1 recipes, 2 tales). Hunt for an OFF-BY-ONE: any remaining `chronTab === 1/2/3` literal that
  still means the OLD tab (search all of main.js), any code that opens the chronicle to the old ROLES index, the
  `chronTabHits` click mapping (`t.tab`), and the roster tab click (`rosterTabHits`). Confirm `drawChronicleRoles`
  hosted in the roster panel renders within its rect (no overflow into the stat list / off the panel) and its
  internal empty-states still fire. Confirm `rosterScroll` reset on tab switch doesn't strand the stat-list scrollbar.
- **F3 — #135 reckon echo** (`farm.js` `applyCreedOverwrite`, `ECHO_TEMPLATES.reckon`). Display-only. Confirm the
  near-crossover gate (`!overwritten && n>=1 && authority <= nextStrongest+0.15`) can't fire every tick (it's behind
  `surfaceMemory`'s cooldown) and the template array is indexed safely (no `a`/`b` undefined on a 1-arg call).

---

## Harnesses (run + extend)
```
node tests/determinism.mjs        # same-twice + baselines d124375d / 1bbd99f8 / af6ef44f / c3368191; save round-trip
node tests/raid-adversarial.mjs   # telegraph / dormant / #133 counterfactual / #134 learning arc
node tests/encounters.mjs ; node tests/worldindex-bounds.mjs ; node tests/writeback-guards.mjs
node -c farm.js && node -c main.js && node -c worldmap.js && node -c reconciliation.js
```
Highest-value NEW checks if a headless World harness is available:
1. **Foe-fence/sentry termination (B1/C1):** force a foe onto a non-sentry farmer with a fit sentry present; assert the
   encounter resolves within a bounded tick budget (sentry charges → clash → end), never orbits forever.
2. **Sick hand-off (D1):** seat an elected Watch, set `health='sick'`, assert `currentSentry()` returns a DIFFERENT
   fit founder (or null only if ALL unfit), and never throws on a rotation with dead/missing seeds.
3. **Foe cadence (A):** run ~40 days; assert lethal-foe spawns are spaced (≈1 per 3-4 days), never near-daily, and
   `foeCooldown` never goes negative.

Concentrate on **B/C (softlocks — the sentry now leaves the beat to fight, and victims flee toward a guard who may be
on the foe)** and **F2 (the CHRON_TABS renumber off-by-one)**. If B1/C1 terminate and F2 has no stale index, a clean
pass is expected — but give the "can the sentry/victim/foe now fail to terminate?" question a definitive answer.
