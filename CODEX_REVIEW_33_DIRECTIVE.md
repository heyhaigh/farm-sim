# Codex Review #33 — Ry Farms: VERIFY the #32 P1 fix + review the 2nd polish round

**Repo:** `/Users/ryanhaigh/ry-farms` — point Codex HERE, at the FULL absolute path. (Codex has repeatedly
defaulted to a stale `/Users/ryanhaigh/Documents/ry-farm` @ #97 with UNRELATED history — that is the WRONG repo.
The right one's HEAD is `7b1fe03` on `main`, NO git remote configured locally — review the working checkout
directly, do NOT try to fetch/pull.)
**Scope:** `git diff 1baa52f..HEAD` — **5 commits**, 3 files (`farm.js`, `main.js`, `tests/determinism.mjs`):
- `06b2cb7` — the Codex-#32 P1 FIX (the sentry couldn't FIGHT while the quarry fled). **VERIFY this first — highest risk.**
- `1c9888d` — sleep-out SICKNESS reworked (sentry exempt; no illness from one calm night). SIM state, re-pinned.
- `0c7bc77` — watch-lines time-specific. Display-only, trivial.
- `02c2141` — shared `drawTabBar` component (Roster + Chronicle). Display-only.
- `7b1fe03` — "WHILE YOU WERE AWAY" backlog card. Display-only.

**This review's goal is a GO/NO-GO to PUSH all 8 local commits** (`0ce2e99..7b1fe03`, ahead of `origin/main 0c7d7e2`).
So: verify the #32 fix truly resolved its P1 without regressing, and vet the new sim surface (sickness) + the clash
change for correctness / determinism / save-replay / lifecycle / SOFTLOCK. Report only REAL defects, ranked, each
with `file:line` + a concrete repro + a fix. A clean pass is the expected, valid result — say so plainly if so.

## The two sacred doctrines
1. **DETERMINISM.** Sim consumes ONLY seeded rng (`world.rand`, per-farmer `this.rand`) + pure position hashes with
   stable, sorted iteration. Same seed ⇒ byte-identical, twice. `tests/determinism.mjs` `same-twice` MUST hold, and
   the four baselines were re-pinned this round to **`b9fdb11b / 49314834 / 246728a5 / 640f109e`** (seeds
   `20260706 / 42 / 7 / 3`). RUN the harness; confirm same-twice + these baselines. Two legitimate re-pins in scope:
   the clash-trigger/`#resolveClash` change (`06b2cb7`) and the sickness rework (`1c9888d`). A same-twice BREAK is a
   P0; an unexplained baseline DRIFT on an unrelated file/path is a regression to investigate.
2. **COMPILE-DON'T-QUERY.** LLM + SuperMemory (`api/*`, `memory-writeback.js`, `congregation.js`) are display/
   persistence side-channels the sim never reads in its loop. All the `main.js` changes here are display-only.

Report **P0** (determinism break / crash / save-corruption / silent state-loss / SOFTLOCK — an encounter that never
resolves) and **P1** (a mechanic that misfires, a lifecycle edge that strands state) + a fix.

---

## A. VERIFY the #32 P1 fix (`06b2cb7`, farm.js) — the HIGHEST-RISK change, scrutinise for SOFTLOCKS
The sentry-defends change was inert while the quarry fled. Two coupled fixes:
- **`#resolveClash`**: adjacent helpers (`this.farmers.includes(h) && dist < 2.2`) now swing even when the TARGET
  flees; the target joins the `fighters` only if `combatStance === 'fight'`. If NO fighter is in reach, it falls back
  to the old lone-target DEX save. The foe swings back at a random FIGHTER (so a shielded fleeing quarry is spared).
- **`#advanceEncounter`**: a new `guarded` flag — a standing defender (`combatStance === 'fight' && !downed && dist
  < 2.2`) HALTS the foe's chase (`if (dist > 1.2 && !guarded)` gates the movement branch) and forces the clash.
- **A1 — SOFTLOCK / termination (answer definitively).** Before, the foe only clashed when it CAUGHT the fleeing
  target; now a defender halts it. Trace EVERY exit: does the encounter still ALWAYS terminate? Consider: (i) a foe
  halted by a defender who then FLEES/goes down — does `guarded` correctly flip false so the foe resumes/re-acquires
  (no frozen foe stuck forever at `dist>1.2` with no one in range)? (ii) a defender oscillating on/off the 2.2
  boundary frame-to-frame — can `guarded` thrash so the foe neither advances nor clashes and the clash timer never
  fires? (iii) the `e.life` 45s cap is unchanged and still a guaranteed terminator — confirm it isn't bypassed by the
  new halt (the halt doesn't reset `e.life`). (iv) a foe halted forever by a defender who can never LAND a hit (all
  misses) — `e.life` still expires, right?
- **A2 — draw-count / determinism.** `#resolveClash`: the no-fighter fallback draws exactly 1 (target dodge) as
  before; the fighters path draws N attack + (0/1) victim-dodge as before — only the flee+adjacent-helper case newly
  routes through the fighters path. Confirm the draw count is a deterministic function of seed state (no branch
  consuming a variable number of `this.rand()` in a way that desyncs later ticks). `guarded` uses only geometry +
  lived `combatStance` — no rng. Confirm.
- **A3 — bystander / wrong-target damage.** The foe swings back at `fighters[Math.floor(this.rand()*len)]` — confirm
  a FLEEING non-fighter target can't be selected (it's only in `fighters` when standing), and `fighters[0].say`
  never throws (fighters is non-empty in that branch). Can a defender be added to `e.helpers` for one encounter but
  be geometrically adjacent to a DIFFERENT encounter's foe (double-count)? (helpers are per-encounter — confirm.)

## B. SICKNESS REWORK (`1c9888d`, farm.js `#dailyHealthCheck`) — the biggest NEW sim surface
A single calm rough night no longer rolls; illness needs `roughStreak>=2` OR roofless `exposure>0` OR a rough night
in inclement weather (`inclement>=3`). The on-duty SENTRY is exempt via a `stoodWatch` flag (set in `#takeWatch`
when `isNight()`). New serialized farmer fields `roughStreak` + `nightsExposed`.
- **B1 — the `stoodWatch` lifecycle.** Set in `#takeWatch` when `w.isNight()`; read + CLEARED at the end of the
  `#dailyHealthCheck` per-farmer body (`f.stoodWatch = false`). Confirm: (i) it's cleared EVERY dawn even for a
  farmer who is `downed`/`sick` (those branches `continue` BEFORE the clear — does a downed/sick farmer's stale
  `stoodWatch` matter? it only gates a roll they don't reach, so probably harmless — but confirm it can't get stuck
  true and wrongly exempt them a later night). (ii) It is NOT serialized — confirm that's fine (a transient nightly
  flag; worst case a reload mid-night misses one exemption). (iii) Is `stoodWatch` a DIGEST field? It must NOT be in
  the determinism snapshot; confirm it's display/lived-only and doesn't leak into the hash.
- **B2 — no NEVER-sick regression.** The exposure path (homeless past the 3-night grace) MUST still eventually sicken
  a roofless settler (the "raise a tipi" pressure). Confirm `exposure>0 → atRisk` still fires for the homeless and
  the DC still scales. Confirm a chronic overworker (streak climbing) still eventually rolls. Is there any state
  where `atRisk` can NEVER be true for a genuinely at-risk farmer (e.g. a permanently-`stoodWatch` elected Watch who
  is also homeless — do they get stranded, never pressured to build)? Flag if so; judge whether it's reachable.
- **B3 — no MASS sick-out / not-too-rare.** The old flat `DC=10+debt` risked town-wide sick-outs; the new DC is
  `9 + (roughStreak-1)*2 + exposure + inclement + (energy<0.15?2:0)`. Sanity-check the numbers: a 2nd rough night for
  an average CON (mod ~0-1) sits near a coin-flip — intended. Confirm `roughStreak` is capped (`Math.min(6, ...)`)
  so the DC can't run away, and that it RESETS on a non-rough night AND on falling ill. Any seed where the town
  still sick-spirals, or conversely where illness effectively never happens?
- **B4 — save round-trip.** `roughStreak` + `nightsExposed` are now serialized (farmer map) + restored (`|| 0`) +
  ctor-initialised. Confirm an OLD save lacking them restores to 0 cleanly (nightsExposed was previously LOST on
  reload — this fixes a real bug; confirm the fix doesn't itself break the round-trip test). Run `determinism.mjs`'s
  round-trip section.
- **B5 — determinism of the roll.** `inclement` reads `this.weather` (seeded lived state). `roughNight`/`roughStreak`
  read lived farmer state. The `d20`/`fallIll` draws are `this.rand`. Confirm no wall-clock / `Math.random` leaked.

## C. DISPLAY-ONLY — watch-lines, tab component, backlog card
- **C1 — `#watchLine` (`0c7bc77`).** Day/night pools per culture, indexed by `hashString(seed + ':watch:' +
  floor(clock/4)) % pool.length` (pure, no rng). Confirm every pool is non-empty (no modulo-by-zero) and it's a
  `think()` line only (not in the digest). Trivial — a glance suffices.
- **C2 — `drawTabBar` / `hexA` (`02c2141`, main.js).** Extracted shared tab bar (the roster's underline style).
  `hexA('#rrggbb', a)` → rgba. Confirm: (i) both call sites pass a valid 6-digit hex accent (`'#7dd069'` roster,
  `CHRON_ACCENT='#c8a0e0'` chronicle) — hexA does `parseInt(hex.slice(1),16)`, so a 3-digit or named color would
  mis-parse; confirm neither call passes one. (ii) `rosterTabHits`/`chronTabHits` are ASSIGNED the return (not left
  stale) and the click handlers still map `t.tab` correctly. (iii) The chronicle's tab bar moved from a hand-rolled
  loop to `drawTabBar` — confirm no visual/hit regression (the CHRON_TABS renumber from #32 is unaffected) and the
  divider line below still lands right.
- **C3 — the backlog card (`7b1fe03`, main.js `scanMoments` + `drawResumeCard`).** When `momentQueue.length > 3` and
  no `resumeCard` is up, it folds `[activeMoment?.e, ...momentQueue, ...calloutQueue]` into a `resumeCard` with
  `title:'WHILE YOU WERE AWAY'`, then clears all three. Confirm: (i) it can't clobber the on-LOAD "PREVIOUSLY ON"
  card (`!resumeCard` guard) or fire in a loop (once set, `resumeCard` truthy blocks re-entry until dismissed).
  (ii) `drawResumeCard` uses `rc.title || 'PREVIOUSLY ON …'` — an on-load card (no title) still reads "PREVIOUSLY
  ON". (iii) Clearing `activeMoment = null` mid-spotlight is safe (no dangling reference elsewhere). (iv) `beats`
  entries have `.text`/`.color`/`.day` (chronicle shape) — no undefined-field crash in the wrap/draw. (v) Threshold
  semantics: `> 3` = folds on the 4th+ — matches "more than 3". During NORMAL 1× play the queue rarely exceeds 3, so
  it won't spuriously interrupt — confirm the queue doesn't transiently spike past 3 every rollover.

---

## Harnesses (run + extend)
```
node tests/determinism.mjs        # same-twice + baselines b9fdb11b / 49314834 / 246728a5 / 640f109e; save round-trip
node tests/raid-adversarial.mjs   # telegraph / dormant / #133 counterfactual / #134 learning arc
node tests/encounters.mjs ; node tests/worldindex-bounds.mjs ; node tests/writeback-guards.mjs
node -c farm.js && node -c main.js && node -c worldmap.js && node -c reconciliation.js
```
Highest-value NEW checks if a headless World harness is available:
1. **Clash termination (A1):** force a foe onto a fleeing non-sentry with a fit sentry present; assert (a) the foe
   takes damage / is driven off within a bounded tick budget, and (b) the encounter ALWAYS ends (never a frozen
   foe halted forever with no one landing a hit — `e.life` must still expire).
2. **Sickness bounds (B2/B3):** over ~60 days assert 0 sentry-sickenings on their watch night, a homeless settler
   still eventually falls ill (exposure path intact), and the town-wide sick rate is bounded (no mass sick-out).
3. **Backlog fold (C3):** inject >3 grand chronicle beats; assert one `resumeCard` (title "WHILE YOU WERE AWAY")
   with the queues cleared, and that it does NOT fire with ≤3.

Concentrate on **A1 (does the new foe-halt ever fail to terminate?)** and **B (the sickness rework — save round-trip
+ no never-sick / no mass sick-out)**. If A1 terminates in all traces and B's round-trip + rates hold, this is a GO.
