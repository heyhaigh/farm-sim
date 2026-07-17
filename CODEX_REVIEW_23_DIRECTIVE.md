# Codex Review #23 — Ry Farms: raid resolver + cinematics, weather-aware speech, legibility slices

**Repo:** `/Users/ryanhaigh/ry-farms` (point Codex HERE — not Documents/ry-farm, not portfolio-workspace).
**Scope:** the two commits since #22's review — `4cc5837` (legibility slices + naming) and `975cc4e`
(raid cinematics + weather-aware speech). Concretely: `git diff a4b369c..975cc4e`. Put your DEPTH on the
determinism-sensitive `farm.js` systems (1–3); systems 4–6 are display-tier (`main.js`/`audio.js`) checks.

## The two sacred doctrines (every finding is measured against these)
1. **DETERMINISM (the #1 invariant).** The town SIM consumes ONLY seeded rng (`world.rand`, per-farmer
   `this.rand`, `mulberry32(hashString(...))`) with stable, sorted iteration → same seed ⇒ byte-identical town,
   twice. NO `Date.now()` / `Math.random()` / `performance.now()` in sim code. The WORLD/DISPLAY layer
   (`main.js` render loop, `audio.js`) MAY be non-deterministic, but ANYTHING that crosses into a town's sim
   must be a PURE seeded function of persisted state, consumed EXACTLY-ONCE via the serialized inbox.
   `tests/determinism.mjs` self-compares + pins baselines `20260706:7d142951 / 42:8e2c2899 / 7:60e50036 /
   3:ea4bc356`; `same-twice` must ALWAYS hold and the four hashes must NOT change (this session's claim is that
   NONE of the new work re-pinned them — everything sim-visible is unchanged; everything new is display-only).
2. **COMPILE-DON'T-QUERY.** The LLM (`api/ry-farms-*`) + SuperMemory are NEVER read in the sim loop. All flavor
   is procedural or a display-only side-channel.

Report **P0** (breaks determinism / exactly-once / crashes / save-corruption) and **P1** (logic bug, doctrine
violation, unbounded growth, migration break) with: `file:line`, the concrete failing scenario, and a fix.
Rank by severity. If a claimed invariant actually holds, say so briefly — don't invent P2 noise.

---

## System 1 — Authoritative raid resolver + watched choreography  (`farm.js`) — HIGHEST RISK
**What it is.** A raid arrives via the world→sim inbox (`applyInbox`, `e.kind === 'raided'`, `farm.js:1633`).
There is now ONE authoritative, pure-seeded outcome that is IDENTICAL whether the town is being watched (live)
or resolved silently (headless/dormant):
- `#resolveRaid(e, lost)` (`5325`): PURE. Seeds `mulberry32(hashString('raidres:'+rid+':'+this.seed))`, weighs
  defender power vs raiders + doctrine, caps `felled` at 2 with harder rolls, returns
  `{harvestLost,n,felled,felledNames,woundSeeds,heroSeed,clan}`.
- `#applyRaidOutcome(out, e, spots)` (`5358`): the state mutation — pushes monuments for the felled, wounds the
  `woundSeeds` farmers to ~45% hp, writes the result chronicle line. `spots` (felled raiders' tiles) is
  live-only cosmetic placement.
- `#spawnRaid(out, e)` (`5383`): live-only. Spawns `out.n` `presentational:true` raiders and sets
  `this.raidEvent = {out, e, raiders, phase:'march', timer:9}`.
- `#tickRaidEvent(dt)` (`5411`): live-only choreography. March ~9s → at timeout calls `#applyRaidOutcome` with
  the felled raiders' actual `spots` → survivors flee 2.8s → cleanup, `raidEvent=null`.
- Inbox branch (`1639–1645`): `const out = this.#resolveRaid(e, lost); if (this._live) this.#spawnRaid(out,e);
  else this.#applyRaidOutcome(out,e);`

**Verify:**
- (a) **live == dormant, byte-identically.** The claim is that a WATCHED raid and a DORMANT raid produce the
  SAME sim outcome (same felled, same wound set, same harvest loss, same monuments). `#spawnRaid` draws
  `this.rand()` for cosmetic angles/generic names (`5385`, `5395`) — does the LIVE path therefore consume
  MORE `this.rand()` draws than the dormant path, shifting that town's subsequent rng timeline? If a watched
  town and an unwatched town diverge in rng consumption, determinism across the world index is broken. Confirm
  the felling/wounds/harvest all come from `#resolveRaid`'s SEPARATE `raidres:` stream (not `this.rand`), and
  assess whether `#spawnRaid`'s `this.rand()` cosmetic draws can perturb sim state that the digest sees.
  (NOTE: the headless determinism harness leaves `_live=false`, so it can't catch a live-only rng divergence —
  reason about it directly.)
- (b) **`spots` vs resolver felled-count coherence.** `#tickRaidEvent` (`5422`) slices
  `active.slice(0, re.out.felled)` for monument spots. If fewer raiders are still `active` than `out.felled`
  (some removed/`done` early), do the monument count and the wound count stay consistent with the dormant path
  (which uses `#applyRaidOutcome(out,e)` with no spots)? Any path where felled monuments double-count or the
  wound set differs?
- (c) **exactly-once + no double-resolve.** `raidEvent` is `null`-initialized (`662`) and per the comment
  "never serialized". Confirm a save mid-raid (during march/flee) can't, on reload, either (i) re-run
  `#resolveRaid` (double harvest-dock / double wounds) via the inbox, or (ii) leave a dangling `raidEvent`.
  Cross-check against `applyInbox`'s applied-id/watermark idempotency for the `raided` event.
- (d) **presentational raiders are truly inert to the sim.** `#advanceEncounter` early-returns on
  `e.presentational` (`5439`); `#maybeRallyToThreat` skips them (`7973`). Is there ANY other loop over
  `this.encounters` (combat resolution, guardian aggro, threat scan, danger-zone marking, XP award) that could
  treat a `presentational` raider as a real foe — awarding XP, moving a farmer, or drawing `this.rand()` — and
  thus leak the cosmetic raid into sim state?
- (e) **cleanup.** `#tickRaidEvent` filters `this.encounters` on `done`. Any leak if the flee phase's raiders
  are also removed by another path first? Unbounded `monuments`/`encounters` growth over many raids?

## System 2 — Weather / context-aware speech (#117)  (`farm.js`)
**What changed.** Farmers now speak to the weather and their state. The CLAIM is that ALL of it is display-only
and consumes ZERO `this.rand()` draws, so the digest and baselines are byte-identical.
- `#scriptedChat` (`8073`): a new **blizzard** speaker branch added into the weather cluster (`~8143`) and the
  listener weather condition extended to include `blizzard` (`~8168`). Claim: DRAW-NEUTRAL, because those
  weather branches are pure `w.weather === …` checks placed AFTER the last `this.rand()`-gated condition (the
  grudge gate), and `blizzard` previously fell through to the final `else`, which also does exactly one
  `#pickLine` draw.
- A **display-only overlay** appended right before `#scriptedChat`'s `return` (`~8280`): builds a SEPARATE
  stream `mulberry32(hashString('chatwx:'+seed+':'+otherSeed+':'+day+':'+round(clock)))` and may REWRITE the
  display `speakerLine` for severe weather / winter / low mood / low energy — but only when `!relational`
  (never over a reunion/threat/rivalry/leader line). Claim: it draws ONLY from that local stream, never
  `this.rand()`, and only mutates the returned display strings.
- `#wakeLine()` (`8210`) + `#shelterExitLine()` (`8223`): weather/season-coloured lines chosen from their OWN
  `mulberry32(hashString('wake:'+seed+':'+day))` / `'shelterout:…'` streams. Wired into the state machine at
  `10341` (`sleep`→wake `this.say(this.#wakeLine(),…)`) and `10344` (`shelter`-exit `this.say(this.#shelterExitLine(),…)`).

**Verify:**
- (a) **draw-neutrality of the blizzard branch.** Trace the `#scriptedChat` if/else chain for `weather==='blizzard'`
  BEFORE and AFTER: is the number and order of `this.rand()` draws (the `&& this.rand() < X` gates on vivid /
  project / board / goal / grudge, plus the single `#pickLine`) provably identical? If the new branch is reached
  via a DIFFERENT number of evaluated gates than the old fall-through, draws shift and the baseline breaks. (The
  test passed — but confirm the REASONING, not just the hash, in case the blizzard path isn't exercised in the
  30-day baseline run.)
- (b) **overlay purity.** Confirm the overlay's gates (`dr() < 0.75` etc.) and picks use ONLY the local `dr`
  stream — no stray `this.rand()`, no read-then-mutate of a sim field. Confirm it ONLY writes `speakerLine` /
  `speakerColor` (display), never opinions/bonds/journal (those are applied later in `applyChatLines` from
  `op`/`rop`, which the overlay must NOT influence).
- (c) **`say()` draws no rng; `think()` does.** `say()` (`7336`) only sets `this.bubble` (display). The wake/
  shelter wiring uses `say()`, not `think()` (which draws `this.rand()` at `7346`). Confirm neither `#wakeLine`
  nor `#shelterExitLine` nor their callsites route through `think()` or otherwise draw the sim stream, and that
  the `sleep`→`decide` / `shelter`→`decide` STATE TRANSITIONS are byte-identical to before (only a display
  `say()` was added).
- (d) **digest-invisibility.** `tests/determinism.mjs` `digest()` snapshots day/season/recipes/roles + per-farmer
  seed/xp/lvl/inv/belief/goods/produce/pos/creeds/beliefs — NOT bubble/thought/mood/energy/state. Confirm none
  of the new speech changes a field the digest reads (positions, xp, goods…) as a side effect.
- (e) **seed collisions / stability.** The `chatwx:`/`shelterout:` seeds fold in `Math.round(w.clock)`. Is
  `w.clock` deterministic and stable across a reload at the same sim instant (so the SAME line is chosen)? Any
  NaN/undefined risk (`this.mood`, `this.energy`, `w.season`, `w.clock` all defined on every farmer/world)?

## System 3 — Memory surfacing (Slice 1) + whisper ripple (Slice 2)  (`farm.js`, `main.js`)
- `weaveEcho` (`576`) + `surfaceMemory(context)` (`7354`): sets a DISPLAY-ONLY `this.memoryEcho` from the
  farmer's source doc via its OWN `mulberry32(hashString('echo:'+seed+':'+context+':'+n))` stream + a soft
  `memEchoCd` cooldown. Hooked at charged beats: crop/facility crit (`9745`,`9771`), dream fulfilled (`7136`),
  bond formed (`2395`), recovery (`10074`).
- `#heededWhisper(kind)` (`6468`): when a farmer ACTS on an active whisper-urge, fires a `say()` + a
  `world.addChronicle('whisper', …)`. Hooked at 5 decide branches (`8550` rest, `8701` build/chop, `8805`
  explore, `8869` hunt, `8883` trade).

**Verify:**
- (a) `surfaceMemory` + `weaveEcho` draw ONLY the `echo:` stream (never `this.rand()`), set ONLY display fields
  (`memoryEcho`, `memEchoCd`, `memEchoN`, `_echoWords`) — none read by the digest. Confirm `docLexicon(mem,seed)`
  is pure and the `memEchoN` counter can't desync a reload (it's display-only, so drift is harmless — confirm).
- (b) **`#heededWhisper` side-effects.** It calls `world.addChronicle` and sets `this.sparkle`. Does
  `addChronicle` draw `this.rand()`/`world.rand`, mutate a digest-visible field, or grow unbounded? `u.acted`
  idempotence: can one whisper be "heeded" twice (double chronicle) across the 5 hooks? Is `activeUrge()` /
  the urge's `armed`/`acted` state itself sim-deterministic, or does the whisper (a non-deterministic player
  input) leak into the sim rng timeline anywhere?
- (c) The whisper is a PLAYER input (non-deterministic). Confirm it only ever biases DISPLAY + already-existing
  `urgeBias` machinery and never becomes a hidden sim-rng input that would make a whispered town diverge from
  an un-whispered one in a digest-visible way. (If whispers CAN change sim state, that's expected/allowed as a
  player action — but flag whether that's intended and reproducible on reload.)

## System 4 — Raid cinematics (display-tier)  (`main.js`, `audio.js`)
- State `raidFx/raidShake/raidFocus/_lastRaidEvent` (`96–99`). Frame hooks (`5434–5466`): fire on the
  `world.raidEvent` null→set edge, kick shake, snap `raidFocus`, `audio.raidSting()`. Camera eases to
  `raidFocus` (`5449`); shake offsets `cam` for the world pass and RESTORES it before `drawUI` (`5464` +
  the restore before `drawUI`). `drawRaidFx()` (`4726`) draws the flash/bands/callout/vignette, advanced at
  `5500`. W re-focus (`5307`); drag releases the lock (`5013`). `audio.raidSting()` (`audio.js:421`).
- Debug hook `RYFARMS.raid(commit)` (`5734`): stages a raid via `world.applyInbox`.

**Verify:**
- (a) **no sim mutation from the display layer.** Confirm the raidFx trigger only READS `world.raidEvent` and
  never mutates sim state; the shake `cam.x/cam.y += … ; cam.x/cam.y -= …` restore is EXACT (no drift that
  accumulates into the camera or, worse, into any sim read). `Math.sin(t*…)` shake is display-time — fine.
- (b) **trigger correctness.** `world.raidEvent !== _lastRaidEvent` fires once per staged raid; `!world.raidEvent
  → _lastRaidEvent=null` re-arms. Edge: two raids back-to-back (new object each `#spawnRaid`) — does each fire
  exactly once? A resumed save (raidEvent never serialized ⇒ null on load) — no spurious fire? `raidFx.t += dt`
  with a huge `dt` after a tab-throttle — does the transition just clamp (`Math.min(1,…)`) and end cleanly?
- (c) **the debug `raid()` hook writes the SAVE.** It calls `applyInbox`, which pushes to `_inboxApplied`
  (which rides the save) and docks `harvestTotal`. It's behind the `RYFARMS` debug handle, but flag whether an
  accidental invocation could corrupt/advance a real town's persisted state, and whether that's acceptable for a
  debug-only hook (or should be guarded / not dock stores).
- (d) `audio.raidSting()` uses `Math.random()` freely — confirm audio is fully display-tier and never on a sim
  path (it is called from the render loop, not `world.tick`).

## System 5 — Speech-bubble polish + timing (display-tier)  (`main.js`)
Max-width bubble plate (no per-line reflow), crossfade with `easeInOutCubic`, `SAY_LINE_SEC = 0.75`,
`CHAT_LINE_MAX = 120`, memory-echo bubble render, whisper tell + widget, roster chat removal.
**Verify (light):** any unbounded work per frame (the crossfade clip/measure), NaN in the width/clip math for
empty or single-line bubbles, and that removing the roster chat left no dangling click handler / dead state.

## System 6 — Icon system + top-bar (display-tier)  (`main.js`)
`makeMaskIcon`/`makePngIcon` PNG-mask icons, WORLD reordered after ROSTER, cursor-anchored tooltips,
`RECIPE_GOOD_ICON` slots. **Verify (light):** async image-load races (icon used before `img.complete`), and the
top-bar hit-rects match the redrawn order (no click landing on the wrong button).

---

## Determinism harness (run these)
```
node tests/determinism.mjs        # must print all-seeds identical + the four UNCHANGED hashes
node -c farm.js && node -c main.js && node -c audio.js
```
If any of the four baseline hashes CHANGED, that is a **P0** — the session's core claim (all new work is
display-only) is false and something perturbed the sim rng timeline.
