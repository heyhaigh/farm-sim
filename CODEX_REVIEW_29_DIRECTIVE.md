# Codex Review #29 — Ry Farms: the WATCH/RAID vertical (#131, #132) + conversation & onboarding polish

**Repo:** `/Users/ryanhaigh/ry-farms` (point Codex HERE — not Documents/ry-farm, not portfolio-workspace).
**Scope:** `git diff 85ceac7..HEAD` — **8 commits** (`af4fbb0 f5b1c39 c211dc5 182cf45 00cde31 11fe2ae 444852f 71b1fe7`).
This is a FEATURE round, not a fix-verification round: new mechanics (the telegraphed raid + muster, the
whisper-to-watch lobby, an LLM-authored founding conversation) plus targeted fixes (a stuck-bubble crash-adjacent
render bug, a day-1 grace period, raider facing/spawn). Hunt for **correctness, determinism, save/replay, and
lifecycle** problems the way earlier rounds did. Report only real defects — ranked, with `file:line` + a concrete
repro + a fix. A clean pass on a surface is a valid result; say so plainly.

## The two sacred doctrines
1. **DETERMINISM.** The sim consumes only seeded rng (`world.rand`, per-farmer `this.rand`) + pure position
   hashes; same seed ⇒ byte-identical town, twice. `tests/determinism.mjs` `same-twice` MUST hold, and the four
   baselines were deliberately re-pinned this round to **`a665fee5 / 271a2e20 / 1b8ee52e / 2f26a7fe`** (seeds
   `20260706 / 42 / 7 / 3`). Two legitimate re-pins happened here (the day-1 congregation no longer draws the old
   assemble scramble; the DM draws no rng on day 1). RUN the harness and confirm same-twice + these baselines.
2. **COMPILE-DON'T-QUERY.** The LLM + SuperMemory (`api/*`, `congregation.js`, `conscience.js`) are DISPLAY/
   persistence side-channels the sim never reads in its loop. All dialogue (congregation lines, whisper tells) is
   transient `say()` bubble text — never serialized, never in the digest. Confirm no new sim-loop read of any of it.

Report **P0** (determinism break / crash / save-corruption / silent state-loss / a raid that never resolves) and
**P1** (a mechanic that misfires, a lifecycle edge that strands state) with a repro and a fix.

---

## 1. #131 — the telegraphed raid (`af4fbb0`, `farm.js` + `main.js`) — HIGHEST-RISK, scrutinize hard
A raid no longer resolves the instant its inbox event is consumed. `applyInbox`'s `raided` branch now stages a
seeded `world.pendingRaid` (`{e, landsAt, detectAt, dir, dirName, detected}`), and `#tickPendingRaid()` fires the
sentry's alarm at `detectAt` and calls `#landRaid()` at `landsAt`. Timing is measured on **`this.time`
(monotonic)**, NOT `this.clock` (which resets to 0 each day). `pendingRaid` is serialized (roles-adjacent, in
`serialize()`/`#restoreFrom`). `#landRaid` recomputes `lost` from the harvest AS IT STANDS AT LANDING.

**Verify, in priority order:**
- **(a) The dormant/on-load raid — the big one.** Before this change (#Codex23), a `raided` inbox event resolved
  SYNCHRONOUSLY on consume, for BOTH a watched and a dormant town, so a raid that landed while the town was away
  became a "PREVIOUSLY ON" recap line at load. Now consuming that event only STAGES a pendingRaid; it lands via
  `#tickPendingRaid`, which runs only inside `tick()`. Trace the load path (`main.js` `consumeInbox` at boot,
  ~L5794, BEFORE `world._live = true` ~L5800): a raid consumed on load now telegraphs and lands ~`RAID_LEAD`
  time-units INTO the resumed session, playing as a fresh incoming raid rather than a past event. **Is that the
  intended semantics, or a regression** of the "raid-while-dormant is a recap, not an ambush on resume" guarantee?
  And critically: **can a town ever consume a `raided` event and then NOT tick to landing** (e.g. a town that
  syncs its inbox but is never the watched/live town, or is closed before `landsAt`)? If so the stores are never
  docked. (Note pendingRaid IS serialized, so a close→reopen should resume it — confirm the round-trip lands it,
  and that a never-reopened town isn't left with a permanently-un-docked raid.)
- **(b) Watched vs dormant divergence.** #Codex23's whole point was the authoritative outcome is identical whether
  watched or not. `#landRaid` now docks `lost` from the harvest at LANDING time (later than the old apply time),
  and `#resolveRaid` is seeded on the raid id. Confirm the outcome (stores lost, felled, wounds, monuments) is
  still a pure function of the seed + the harvest-at-landing, and that nothing in the telegraph/muster path (which
  runs only when live) feeds back into `#resolveRaid`'s inputs — i.e. a watched town and a headless-ticked town
  fed the same inbox at the same `time`/harvest still resolve byte-identically.
- **(c) Back-to-back raids.** The `raided` branch, if `this.pendingRaid` already exists, calls `#landRaid` on the
  in-flight one immediately, THEN telegraphs the new. Confirm this can't (i) double-apply, (ii) drop a raid, or
  (iii) land a raid whose `landsAt` hadn't arrived (is landing it early acceptable, vs queueing?). Also: two
  `raided` events in ONE `applyInbox` batch — does the first telegraph then the second immediately land the first?
- **(d) `time` vs `clock`.** Confirm `landsAt/detectAt` on `this.time` survive a day rollover (clock resets, time
  doesn't) and a save/reload (both `time` and `pendingRaid` are serialized). A pendingRaid whose `detectAt` is
  already in the past on restore (stored while away) — does it fire the alarm immediately and land correctly?
- **(e) The muster branch** (`#decide`, above the sleep branch): every hale non-sentry farmer forms up while
  `pendingRaid.detected`. Confirm it can't strand a farmer (a `'muster'` state that never returns to `decide`
  — check the `case 'muster'` exit and the `#goTo(..,'muster')` arrival), can't fight the sleep branch into a
  flip-flop at night, and correctly excludes the sentry via `#onWatchDuty()`. Does a farmer with NO sited plot,
  sick, or downed get handled? Determinism: the branch reads `pendingRaid.detected` (a seeded `time` edge) — is
  it truly rng-free so a headless raid (if one were injected) stays reproducible?

## 2. #131b — raid cinematic: approach + facing (`c211dc5`, `f5b1c39`) — DISPLAY-ONLY
Raiders spawn at the fog/map edge and stream in during a new `'approach'` phase; crossing `RAID_STRUCK_RADIUS`
flips to `'march'` and sets `raidEvent.struck`, the edge `main.js` watches to fire the UNDER-RAID flash. Facing is
now by screen-x `(dx - dy) >= 0`.
- **(a)** The spawn distance (`min(tx,ty)` ray-to-grid-edge, floored at `WILD_RADIUS+6`): can it ever land a
  raider ON a solid/off-grid tile, or so far the `'approach'` never reaches `STRUCK_RADIUS` (a stall)? Confirm the
  cinematic always terminates (`raidEvent` → null) even if a raider can't path (it's pure lerp, no pathing —
  confirm).
- **(b)** `main.js` `_raidStruck` fires the flash exactly once per raid and resets on `!world.raidEvent`; the
  approach camera-tracking supersedes cleanly on strike. Any way to double-fire or miss the strike (e.g. `struck`
  set and cleared within one throttled frame)?
- **(c)** Facing: confirm `(dx-dy)` matches `isoX=(i-j)` for both march and flee, and the initial `facing:1` at
  spawn self-corrects on the first tick. (Sanity only — this was the reported fix.)

## 3. #132 — the whisper-to-watch lobby (`444852f`, `farm.js` + `conscience.js` + `api/ry-farms-conscience.js`)
New bounded urge kind `'watch'` (appended LAST in `URGE_KINDS` so existing kinds keep their `urgeKindSeed` index —
confirm nothing else indexes the array positionally). A heeded watch urge drives `#pursueWatchWhisper`: straight to
the watch pre-election / when they ARE the Manager / when the alarm is up; else walk to the Manager and confer,
`managerApprovesWatch` (a DEDICATED seeded stream, not `world.rand`) posts them or turns them back. A post sets a
one-day `world.roles.watchPost {seed,day,via}` that `currentSentry()` honors (relieves the rotation/Watch, max one).
- **(a) The confer loop.** `#pursueWatchWhisper` chases `mgr.pos` (a MOVING target) each tick with
  `#goTo(..,'confer')` until within 2.6, then resolves. Can this loop indefinitely if the Manager keeps moving
  away (equal speeds), or if the Manager becomes unreachable / sick / downed / leaves mid-walk? There's no
  timeout — confirm it always terminates (the `'confer'` arrival state routes to `decide`, and `#goTo` returning
  false falls through to resolve). What if the Manager dies while the volunteer is en route?
- **(b) `watchPost` lifecycle.** It's day-stamped (`wp.day === this.day`) so it lapses, but is serialized and
  never cleared — a stale past-day `watchPost` persists in `roles` forever (cruft). Harmless, or can a wrap/edge
  make a stale post wrongly match? Confirm it can't stack (a second post REPLACES). Confirm `currentSentry()`
  honoring it composes correctly with an elected Watch AND the pre-election rotation (`currentWatcher`).
- **(c) Determinism.** `managerApprovesWatch` and the whole watch path run only with an active whisper urge
  (absent in the headless harness) — confirm no `world.rand` draw leaks into the sim from any of it, and the
  baseline is genuinely unaffected (it was — verify).
- **(d) conscienceCheck.** `'watch'` skips the BARGAIN branch (`kind !== 'watch'`). Confirm the memoization,
  budget caps, DEFY/QUESTION/DISMISS paths, and `#urgeFit('watch')` all behave for the new kind, and that
  `#urgeMatchesIntent('watch')` (already-sentry / already-Watch → ALREADY) is correct.

## 4. #132b — the founding conversation: director + LLM (`00cde31`, `11fe2ae`)
The day-1 congregation is voiced by `#tickCongregation` (world director: seeded speaking order, one voice at a
time, everyone speaks, no dead air, no repeats via `cs.used`), preferring an LLM script `world._foundingScript`
(from `api/ry-farms-congregation.js` via client `congregation.js`, kicked at boot) and falling back to authored
pools `CONG_LINES`. `_congState`/`_foundingScript` are NOT serialized.
- **(a) Reload mid-congregation.** Day 1, save + reload during the congregation: `_congState` is null → director
  re-inits (`cs.spoken/used/ptr` reset), `_foundingScript` is gone → procedural fallback. Does this replay lines
  / restart the exchange cleanly, or double-speak / desync? Is `foundingPhase === 'congregate'` correctly
  restored so the scene resumes at all? (Acceptable degradation is fine — confirm it's not broken.)
- **(b) The script honoring speakers.** The director plays `_foundingScript` in order, voicing the named founder;
  if that founder isn't gathered yet it waits (while <2 present) or SKIPS the line. Confirm a script whose named
  speakers never all gather can't stall the scene, and that mapping speaker-name→seed (client `congregation.js`)
  degrades cleanly on a name the model invents (dropped — confirm).
- **(c) Endpoint safety.** `api/ry-farms-congregation.js` is new + routed in `server.mjs`. Confirm it's fail-closed
  (returns `{fallback:true}` on any error / no LLM), sanitizes to bitmap-ASCII, bounds the script length, and can
  never affect the sim. It's only reachable server-side; the client swallows all failures.
- **(d) Timing coupling.** The director's `cs.nextAt = clock + max(1.2, beat + 0.15)` now waits a bubble's full
  duration; the `say()` tail dropped 0.9→0.4. Confirm no overlap/pile-up and that a very long LLM line (multi-
  wrapped) still advances (the `beat` is `bubble.t0`, which scales with line count).

## 5. Fixes — verify no regression
- **Black bar (`182cf45`, `farm.js` `tick`).** A downed farmer's `tick()` now ticks its bubble down + nulls
  `_pendingSay` before the early return, so a cry set as they go down doesn't freeze as a black plate. Confirm the
  downed path still early-returns everything else (no unintended sim work while down), and that clearing
  `_pendingSay` can't drop a line a NON-downed path expected. Repro the original: down a farmer with an active
  bubble, confirm it fades instead of sticking.
- **Day-1 grace (`71b1fe7`, `#tickDM`).** `if (this.day < 2) return` at the TOP of `#tickDM` — this also skips
  advancing existing encounters + the cooldown decrement on day 1. Confirm no encounter can exist on day 1 to be
  stranded (nothing spawns it), and that an OLD save mid-day-1 with an in-flight encounter (from a pre-fix build)
  degrades sanely. This drove a determinism re-pin — confirm the drift is ONLY the day-1 DM rng and same-twice holds.
- **Typewriter bubbles (`71b1fe7`, `main.js` render).** Per-char reveal, plate pre-sized to the widest line,
  blinking caret. Check degenerate lines: a 1-char line, a line longer than the plate, a word wider than
  `SAY_LINE_CHARS`, a multi-line saying's line advance, and `f.memoryEcho` still taking precedence. Display-only.

---

## Harnesses (run + extend)
```
node tests/determinism.mjs        # same-twice + baselines a665fee5 / 271a2e20 / 1b8ee52e / 2f26a7fe; save round-trip
node tests/encounters.mjs
node tests/worldindex-bounds.mjs
node tests/writeback-guards.mjs
node -c farm.js && node -c main.js && node -c congregation.js && node -c api/ry-farms-congregation.js && node -c api/ry-farms-conscience.js
```
Highest-value NEW checks to add if `fake-indexeddb` / a headless World harness is available:
1. **Raid telegraph round-trip (§1a/d):** inject a `raided` inbox event, `applyInbox`, serialize mid-telegraph,
   `fromSave`, tick past `landsAt` — assert the raid lands EXACTLY once and docks the same `lost` as an un-saved
   run; and assert a town that consumes the event but is never ticked to `landsAt` doesn't silently lose the raid.
2. **Watch confer termination (§3a):** an active `'watch'` urge with the Manager walking away / dying — assert
   `#pursueWatchWhisper` resolves within bounded ticks.
3. **Congregation reload (§4a):** save mid-congregation, reload, tick — assert no crash and the scene completes.

The persistence/render core has bottomed out over rounds #24–#28; the NEW surface here is the raid lifecycle
(§1) and the two conversational side-channels (§3–§4). Concentrate there. If §1a turns out to be intended
(telegraph-on-resume is the desired feel) and everything else holds, a near-clean pass is the expected result —
report it as such, but §1a's "can a consumed raid ever fail to land" question must get a definitive answer.
