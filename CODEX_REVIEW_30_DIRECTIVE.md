# Codex Review #30 — Ry Farms: #133/#134 + the Codex-#29 fixes + a UX-fix batch

**Repo:** `/Users/ryanhaigh/ry-farms` (point Codex HERE — not Documents/ry-farm, not portfolio-workspace).
**Scope:** `git diff 71b1fe7..HEAD` — **7 commits** (`f9d0f2f 0a77f51 7af13e5 979fcff 2a13634 3cd8f85 3121429`).
Two jobs, per the owner: **(A) VERIFY the Codex-#29 P1 fixes** (`f9d0f2f`) actually solved their findings and
introduced nothing new; **(B) REVIEW the new work** — #133 (the raid wound + a frozen-roll counterfactual), #134
(the learning arc + its SuperMemory writeback), the all-day watch, and a batch of player-caught fixes (a farming
energy bug, flee destination, HUD dials). Hunt for correctness / determinism / save-replay / lifecycle defects.
Report only real defects, ranked, with `file:line` + a concrete repro + a fix. A near-clean pass is a valid,
useful result — say so plainly.

## The two sacred doctrines
1. **DETERMINISM.** The sim consumes only seeded rng (`world.rand`, per-farmer `this.rand`) + pure position
   hashes; same seed ⇒ byte-identical town, twice. `tests/determinism.mjs` `same-twice` MUST hold, and the four
   baselines were re-pinned this batch to **`cc596997 / 4b2c6cac / a71885da / c897836c`** (seeds
   `20260706 / 42 / 7 / 3`). Two legitimate re-pins happened here: the all-day watch (behavioural) and the
   energy-bug + flee-destination fixes (behavioural). RUN the harness and confirm same-twice + these baselines.
2. **COMPILE-DON'T-QUERY.** The LLM + SuperMemory (`api/*`, `memory-writeback.js`, `congregation.js`) are
   DISPLAY/persistence side-channels the sim never reads in its loop. The raid counterfactual is a display fork.

Report **P0** (determinism break / crash / save-corruption / silent state-loss / double-apply / a raid that never
resolves) and **P1** (a mechanic that misfires, a lifecycle edge that strands state) with a repro + a fix.

---

## A. VERIFY the Codex-#29 fixes (`f9d0f2f`) — did the solves hold?
- **A1 — dormant raids land synchronously.** `applyInbox`'s `raided` branch now lands SYNCHRONOUSLY when
  `!this._live` (on-load recap) and only telegraphs a LIVE-arriving raid. Confirm the original #29-P1 is truly
  closed: a raid consumed on load docks its stores immediately (no fresh 45s ambush on resume) AND a
  synced-but-never-reopened town can't be left un-docked. Regression check: does a raid arriving DURING live play
  still telegraph correctly, and does the back-to-back guard (`if (this.pendingRaid) #landRaid(...)`) still hold
  now that `#landRaid` also runs `#townLearns` (see B2 — could a settle-then-telegraph double-count a raid in
  `raidsSuffered`)?
- **A2 — congregation coverage-first.** `#tickCongregation` prioritises unspoken founders so every founder speaks
  within the fixed window regardless of script length/order, and both the endpoint (`api/ry-farms-congregation.js`)
  and client (`congregation.js`) gate on ≥60% cast coverage. Confirm the #29-P2 is closed: a long or lopsided LLM
  script can no longer strand later founders. Re-check the director can't stall (nobody ready), infinite-loop, or
  double-voice, and that `cs.scriptUsed`/`cs.spokenSet` bookkeeping is sound across a reload mid-congregation
  (`_congState`/`_foundingScript` are not serialised).

## B. #133 — the raid wound + the FROZEN-ROLL COUNTERFACTUAL (`7af13e5`, farm.js) — HIGHEST-RISK, scrutinise
`#resolveRaid` now runs a pure `#scoreRaid` TWICE on the SAME seeded stream (`raidres:rid:seed`) — once with the
guard, once without — and diffs for the guard's marginal effect. The 2nd (counterfactual) run is display-only.
- **B1 — roll-alignment.** The whole point is the two runs consume the SAME rolls so the delta is purely the
  guard, not variance. `#scoreRaid` claims a FIXED-LENGTH roll sequence (n×4 felled rolls + 1 wound + 1 down,
  independent of the guard). VERIFY nothing branches the rng draw on the guard/defenders (e.g. an early `break`,
  a guard-only roll, a `defenders.length`-dependent loop) that would desync the counterfactual and make the
  reported marginal dishonest. Confirm the counterfactual (its own fresh `mulberry32`) can NEVER perturb the
  authoritative outcome or the sim rng (`tests/raid-adversarial.mjs` asserts watched==dormant + same-raid-twice —
  confirm those still pass and actually cover this).
- **B2 — the guard-down + landing path.** `#landRaid` now: computes the bite via the resolver (`defShave`), downs
  the guard if `out.guardDowned` (reuses the foe-down reset: `reviveDay`, `state='downed'`, carried home), AND
  calls `#townLearns` (#134). Trace ordering/idempotency: can a single raid down the guard AND double-count in
  `raidsSuffered`? Can `currentSentry()` (the guard) be a farmer already downed/sick by this tick, or change
  between the two `#scoreRaid` calls? Is the guard-down's `recordEncounter(gu, {kind:'foe',name:'raiders'}, ...)`
  safe (a synthetic def)? Does the frozen counterfactual honestly keep the **zero-delta** case (it must not always
  claim the guard mattered)?
- **B3 — determinism scope.** #133 runs only on a raid (never in the headless harness), so baselines are
  unchanged — confirm no path leaks `this.rand`/wall-clock into `#scoreRaid`/`#resolveRaid`.

## C. #134 — the learning arc + SuperMemory (`2a13634`, `3121429`)
`#townLearns` (called from `#landRaid`): +1 `raidsSuffered`, bumps townsfolk `threatWary.foe`, and at the 2nd raid
sets a STICKY `world.learned` — `townCollab<0.5` → `'defense'` (→ `doctrine()` returns `'palisade'`, world layer
halves the bite) else `'truce'` (→ `townSummary` bakes `envoy.suePeace`, `reconciliation.js` `willParley` honours it).
- **C1 — doctrine() override.** `doctrine()` now returns `'palisade'` whenever `learned==='defense'`, BEFORE the
  leader-based logic. It's read by `#scoreRaid` (wallBonus) AND baked into `townSummary` (the world-layer raid
  bite). Confirm this can't create a feedback loop or a contradiction (a martial Watch-led town forced to
  palisade `commit:0` — it stops raiding others; intended, but confirm no world-layer assumption breaks). Is
  `learned` correctly serialised + restored (`raidsSuffered`, `learned` in serialize/`#restoreFrom`)?
- **C2 — the truce parley wiring.** `envoy.suePeace` (main.js townSummary) → `humanWillParley`/`orcWillParley`
  (reconciliation.js). Confirm a `suePeace` envoy actually reaches the table in `resolveEncounter`, that it can't
  make a town parley when it shouldn't (only when it LEARNED truce), and that a FALSE (low-honesty) sue-for-peace
  envoy can still betray (the honesty-gated betrayal path is untouched).
- **C3 — determinism + the SuperMemory writeback.** `#townLearns` draws no rng (character gate on `townCollab`,
  a stored trait) — confirm. The writeback (`memory-writeback.js` `persistTownHistory` sends `raidsSuffered` +
  `learned`; `api/memory-writeback.js` `townHistoryDoc` renders it) is off-sim/off-digest, best-effort, fires
  even pre-election — confirm nothing there can throw into the sim or block, and the signature change re-writes
  the doc only when the learning actually changes.

## D. The player-caught fixes (`3cd8f85`) + watch/HUD (`0a77f51`) + recovery/tooltips (`979fcff`)
- **D1 — the energy falsy-0 bug.** `#completeWork` was `ACTION_ENERGY[act] || 0.05` — `0 || 0.05 === 0.05`, so
  every table-zero action (till/plant/harvest/clear/collect/tend) silently cost 0.05. Fixed to `?? 0.05`, and
  `till` set to `0.017`. Confirm the fix is complete (no other `|| 0.05`/falsy-0 read of an energy/labor table),
  that the LABOR table reads are unaffected, and reason about the balance shift (farming is now much cheaper —
  does the strain/illness economy still function, or do farmers now ~never tire?). Determinism re-pinned — confirm.
- **D2 — flee to a real refuge.** The `'flee'` state now bolts for CENTER unless `this.plot.built.fence` is up
  (an open plot is no refuge). Confirm this can't strand a farmer (unreachable CENTER), that `#atRefuge`/the
  threat-breaks-off logic still keys off a complete fence, and that fleeing to the plaza composes with the
  encounter/help-rally system. Determinism re-pinned (drove seed 3's drift, then all seeds via D1) — confirm.
- **D3 — all-day watch + the sentry alarm** (`0a77f51`). `#onWatchDuty` dropped the night gate (now hale + housed
  + `currentSentry()===this`); `#faceThreat`/`#takeWatch` call `#soundWatchAlarm` (rate-limited) which rouses the
  town. Confirm the housing guard can't strand an un-roofed sentry, the alarm's `threatAlert` bump is
  deterministic, and a day-time sentry patrolling all day doesn't break survival/sleep branch ordering.
- **D4 — HUD (display-only).** `drawProgressWheel` (planting + build/foundation/co-op via `drawProgressBar`), the
  health bar gated to `<50%`, the watch `drawWatchEye`, `entityUnder` hover tooltips (farmers OUT IN THE OPEN +
  foes), the `RECOVERING X/Y` countdown (`f.downFrom`, serialised, set at all 3 down sites), and the tighter
  balanced `wrapWords` (18-char, shrink-to-fit). Confirm no crash on degenerate inputs (empty/oversized lines, a
  farmer with no plot, a downed farmer with `downFrom` absent on an OLD save → the `?? 3` fallback).

---

## Harnesses (run + extend)
```
node tests/determinism.mjs        # same-twice + baselines cc596997 / 4b2c6cac / a71885da / c897836c; save round-trip
node tests/raid-adversarial.mjs   # telegraph round-trip, dormant-synchronous, #133 counterfactual, #134 learning arc
node tests/encounters.mjs ; node tests/worldindex-bounds.mjs ; node tests/writeback-guards.mjs
node -c farm.js && node -c main.js && node -c reconciliation.js && node -c congregation.js && node -c api/ry-farms-congregation.js && node -c api/memory-writeback.js && node -c memory-writeback.js
```
Highest-value NEW checks to add if a headless World harness is available:
1. **Counterfactual honesty (B1):** two `#scoreRaid` runs (guard in/out) on the same rid consume an identical
   roll count; assert the reported `marginal` equals the actual (auth − cf) and that a no-effect raid reports zero-delta.
2. **learned round-trip (C1):** learn 'defense', serialize→fromSave, assert `doctrine()==='palisade'` persists.
3. **energy audit (D1):** grep for any remaining `|| 0.05` / falsy-0 read of an energy/labor value.

Concentrate on B (the counterfactual fork's roll-alignment and the guard-down/land ordering) and C1 (the
doctrine override feeding the world layer). If those hold and A confirms the #29 fixes, a clean pass is expected —
report it as such, but B1's "are the two runs truly roll-aligned, so the reported marginal is honest?" must get a
definitive answer.
