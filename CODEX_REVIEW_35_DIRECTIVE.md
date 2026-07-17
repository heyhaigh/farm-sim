# Codex Review #35 — Ry Farms: multi-town streaming P0+P1 (world map v2, town placement, THE RAID SEAM) — PRE-PUSH GATE

**Repo:** `/Users/ryanhaigh/ry-farms` — point Codex HERE, at the FULL absolute path. (Codex has repeatedly defaulted
to a stale `/Users/ryanhaigh/Documents/ry-farm` @ #97 with UNRELATED history — that is the WRONG repo. The right
one's HEAD is `4d5ed6a` on `main`, remote `github.com/heyhaigh/farm-sim` — review the working checkout directly.)

**Scope:** `git diff 8c1f6ff..HEAD` — **11 commits**, 2 files, ~300 insertions:
`83d9082` world map v2 (legend/tooltips/found-by-culture) · `7db40f5` map polish (clip rings, header) · `4451d2a`+`663c571`
town icons tried & REVERTED (net ~nothing — confirm the revert is clean) · `9a3e650` map fills the gold frame, moments
freeze under modals · `fb39369` **P0 town placement** (rejection-sample the founded seed near an anchor) · `e71e348`+
`2116446`+`35a3284` **P1 THE RAID SEAM** (danger-red overlay in the threat bearing, arrow retire, organic mottle +
alarm heartbeat) · `a9dc5db` **P1 muster** (cosmetic warband figures + `musterSpot` moved to the frontier — the ONE
sim-side behavior change) · `4d5ed6a` chronicle grammar (doubled article).

**Intent: these 11 commits will be PUSHED to the live repo immediately after this review.** This is the pre-deploy
gate. Report only REAL defects, ranked (P0 = blocks the push / P1 = fix before push / P2 = note), each with
`file:line`, a concrete repro, and a fix. If it's clean, say so plainly — that is a valid and expected outcome.

## The two sacred doctrines (unchanged)
1. **DETERMINISM.** The sim draws ONLY from seeded rng + pure position hashes; same seed ⇒ byte-identical, twice.
   `tests/determinism.mjs` `same-twice` MUST hold; baselines are **`b9fdb11b / 49314834 / 246728a5 / 640f109e`**
   (seeds `20260706/42/7/3`) — this whole batch shipped with NO re-pin (the P1 kill criterion: a re-pin during a
   render-only phase means the seam leaked into the sim). Confirm the baselines are genuinely unchanged.
2. **COMPILE-DON'T-QUERY.** LLM/SuperMemory are display/persistence side-channels; the sim never awaits them.
   (Unaffected by this batch — everything here is canvas UI + one seeded-geometry change.)

---

## A. P0 — `foundNewTown` rejection-samples the seed (main.js)
A created town used to hash (`townPos(seed)`) anywhere on the world map → never inside anyone's reach → no raids, no
seam, EVER. Now the seed is rejection-sampled (≤500 tries) so the new town lands in a band
`[max(55, aReach*0.55), aReach+55]` around the ANCHOR (the selected town, else the current one).
- **A1 — the sampler's rng.** This runs in the UI on a button click (then navigates to a fresh `?seed=`), so
  `Math.random` is ACCEPTABLE here — but confirm the sampling draws NOTHING from `world.rand` and touches no sim
  state (the doctrine-1 hazard would be a sampler that advances the live world's seeded stream).
- **A2 — termination + fallback.** 500 failed tries must degrade gracefully (fall back to a random seed, not an
  infinite loop / undefined navigation). Confirm the loop is bounded and the fallback path navigates somewhere sane.
- **A3 — band math.** `townPos`/`townReach` are imported into main.js for this. Confirm the band is computed from
  the ANCHOR's live reach (not a stale constant), distance uses the same metric `worldmap.js` uses for contact, and
  a seed that lands INSIDE the minimum (too close / same cell) is rejected rather than founding a town on top of the
  anchor.
- **A4 — collision with existing towns.** Does the sampler check the candidate against OTHER known towns' positions,
  or can it land a new town exactly on an existing one's coordinates? If it can, is that benign (separate seeds ⇒
  separate saves) or does the world map / encounter detection misbehave on exact overlap?

## B. P1 — `drawRaidSeam` (main.js ~1485): render-only danger overlay
When `world.pendingRaid` (telegraph) or `world.raidEvent` (underway), paints a semi-transparent DANGER-RED gradient
fan into the ground in the threat bearing. Reads ONLY display state; paints AFTER `drawTerrainChunks`.
- **B1 — render-purity (the kill criterion).** Grep the function + its helpers (`seamHash`, the `smooth` reuse,
  `raidMusterFigures`): NO `world.rand`, no mutation of `world.tiles`/`reveal`/farmers/encounters, no Date.now in
  anything that feeds the SIM (wall-clock `performance.now()` is fine for pure display pulse/sway). The harness
  confirms this indirectly (baselines unchanged) — verify by inspection too.
- **B2 — the raidEvent-only path.** With `pendingRaid` null and `raidEvent` set, `dir` derives from
  `raidEvent.raiders[0]`. If `raiders` is empty/undefined mid-phase (e.g. all felled, or the retreat/'flee' phase),
  the function must bail, not throw. Check every phase of `#tickRaidEvent` for a state where `raidEvent` exists but
  `raiders[0]` is gone.
- **B3 — per-frame cost.** The seam loops every visible tile every frame (`iMin..iMax × jMin..jMax`, with
  `world.isRevealed` + a hash per tile in the fan). At typical zoom that's a few thousand tiles ~60fps, on TOP of
  the muster figures and the alarm pulse — is this measurably heavy vs the pre-existing per-frame work (the game
  already bakes terrain to chunks precisely to avoid per-tile per-frame fills)? If it's borderline, propose the
  cheap fix (early-reject rows outside the fan's bounding wedge before the per-tile hash, or skip when alpha ramp
  would be < threshold) — but only flag as P1 if you can show a real hot loop, not a vibe.
- **B4 — alpha math.** `base+pulse` maxes ~0.62; grain multiplies 0.75–1.25; clamped to [0,1] before
  `globalAlpha`. Confirm no path yields a negative/NaN alpha (e.g. `rFull===rIn` div-by-zero is impossible while
  the constants are literals — but confirm they are), and the `a < 0.03` skip keeps the calm-state outer ring from
  painting near-invisible tiles for free cost.

## C. P1 — `raidMusterFigures` (main.js ~1471) + the collectDrawables hook
During the telegraph only (`pendingRaid && !raidEvent`), 6 cosmetic orc figures idle at the map edge in the threat
bearing, drawn via the existing `drawThreat` with `kind:'orc'` and a minimal fake `def`.
- **C1 — cosmetic figures must be INERT.** They are injected into the draw list — confirm they can NOT be picked by
  `entityUnder` (hover tooltips), click-selection, or any code that iterates "threats"/encounters for SIM decisions
  (e.g. `#spotThreat`, farmer flee logic, the sentry alarm). If `entityUnder` CAN match them, what happens on hover
  (their fake shape lacks `sheet`/`foeName` — does the tooltip code throw or render garbage)?
- **C2 — drawThreat contract.** The fake object carries only `{kind, def:{color}, i, j, facing}` — confirm
  `drawThreat` reads nothing else (hp bar? name plate? `e.foeName`?) that would be undefined and either throw or
  draw "undefined" text.
- **C3 — hand-off.** The instant the raid lands (`raidEvent` set), the muster figures stop and the REAL
  `raidEvent.raiders` (spawned at the same bearing) take over — confirm there's no double-draw frame (both sets
  visible) and no one-frame gap where the warband vanishes.

## D. P1 — arrow retire + threat-tell changes (main.js `drawThreatTell`)
The off-map amber arrow now HIDES once the raider edge-spawn point is on-screen (you've panned to the approach
ground); the marquee stays.
- **D1.** The edge-spawn estimate must match where `#stageRaidCinematic` actually spawns raiders (same ray-to-edge
  math) — if they diverge, the arrow retires while the real approach is still off-screen (or vice versa). Compare
  the two computations.
- **D2.** Confirm the on-screen test uses live GW/GH (the internal resolution is derived from window aspect — a
  hardcoded width would misjudge on resize).

## E. THE sim-side change — `musterSpot` at the frontier (farm.js ~5913)
Roused farmers now form up at radius **16 + (h % 6)** from the well toward the threat (was 4 + (h % 3) = the town
square); spread 1.5 → 1.4. Seeded hash per farmer, `nearestOpenTile` fallback, pure geometry.
- **E1 — determinism.** The function draws no rng (hash of `sheet.seed + ':muster'`) — confirm. The harness never
  raids, so this is UNEXERCISED by the baselines (that's why no re-pin was needed) — confirm there is no OTHER
  caller of `musterSpot` that DOES run in the harness.
- **E2 — the frontier can be hostile ground.** Radius 16–22 from the well can land in forest, water, another farm's
  fenced plot, or (culture worlds) terrain that `nearestOpenTile` must resolve. Confirm `nearestOpenTile` handles a
  fully-blocked neighborhood (returns null → the `|| {i:ti,j:tj}` fallback — can that put a farmer ON water/rock,
  and if so does movement code cope or do they jitter forever?).
- **E3 — muster vs the raiders' landing line.** Raiders cross `RAID_STRUCK_RADIUS=16` when the raid lands — the
  muster line at 16–22 sits ON/OUTSIDE that threshold, i.e. defenders now stand where the clash begins. Sanity-check
  the intended interaction: does `#landRaid`/the raid resolver key off farmer POSITIONS at all (it shouldn't — the
  outcome is seeded; positions are cinematic), so the muster move can't change raid outcomes? Confirm by reading
  `#scoreRaid`/`#resolveRaid` inputs.
- **E4 — stragglers.** With the muster 3–4× farther out, a slow/distant farmer may still be walking when the raid
  lands. Confirm the 'muster' state exits cleanly in every raid outcome (landed/passed/standoff) — no farmer stuck
  in 'muster' or walking to a stale spot after `pendingRaid` clears.

## F. P1 look-tune (`35a3284`) — seamHash / smooth / heartbeat
- **F1.** `seamHash` is a new module-scope pure hash; `smooth` REUSES the existing main.js smoothstep (a duplicate
  const briefly shadowed it and killed the whole module with "Identifier 'smooth' has already been declared" — it's
  fixed, but CONFIRM main.js parses clean and there are no other new module-scope names colliding (`node -c main.js`
  + grep the new identifiers: `seamHash`, `RAID_TINT`, `raidMusterFigures`, `drawRaidSeam`).
- **F2.** The heartbeat pulse (`0.14 * pow(0.5+0.5*sin(t/260), 3)`) and calm breathe (`0.04*sin(t/700)`) are
  wall-clock display only — confirm neither feeds anything but `globalAlpha`.

## G. World map v2 + polish (`83d9082`, `7db40f5`, `9a3e650`, icon try+revert)
All display (main.js): KEY legend, hover tooltips w/ reach/rumor rings clipped to the viewport, CREATE TOWN flow
(HUMAN/ORC picker → navigate), map canvas fills the gold frame w/ header/footer as overlays, and moments/toasts no
longer draw over (or expire behind) an open modal.
- **G1 — the shownAt freeze.** While `worldMapOpen`, the active spotlight/callout `shownAt` is re-stamped each frame
  so it doesn't expire behind the modal. Confirm this un-freezes correctly when the modal closes (the moment then
  plays its full duration ONCE — not permanently pinned by some other modal flag), and that the freeze doesn't
  accumulate the queue unboundedly during a long map session (the backlog card / queue caps still apply).
- **G2 — icon try+revert.** `4451d2a` then `663c571` reverted town icons back to tinted dots. Confirm the revert is
  COMPLETE (no dangling icon-loading code fetching `packEmote` assets each frame, no dead constants that reference
  missing files at runtime).
- **G3 — tooltips + rings.** Hover math (`worldMapTravHits`, `worldTip`) — confirm a traveler and a town under the
  same cursor resolve deterministically (no flicker between two tips), and the ring clip (`ctx.rect + clip`) is
  balanced with save/restore (an unbalanced clip would eat the rest of the frame's drawing).
- **G4 — CREATE TOWN input handling.** The picker intercepts clicks while the map is open — confirm clicks on the
  picker don't ALSO fall through to the map beneath (select a town / start a drag), and Escape/close leaves no
  `worldFound` state half-open.

## H. Chronicle grammar (`4d5ed6a`) — trivial, but confirm
`ENCOUNTER_DEFS` names carry their own article ('an orc raider'); three struck-down chronicle templates dropped
their extra 'a'. Confirm no OTHER template in farm.js/main.js still writes `a ${...def.name...}` or
`the ${...def.name...}` (the defs' articles make both wrong), and chronicle text is not part of the determinism
digest (baselines unchanged says it isn't — confirm which fields the digest hashes).

---

## Harnesses (run all)
```
node tests/determinism.mjs        # same-twice + baselines b9fdb11b / 49314834 / 246728a5 / 640f109e — NO re-pin expected
node tests/raid-adversarial.mjs ; node tests/encounters.mjs ; node tests/worldindex-bounds.mjs ; node tests/writeback-guards.mjs
node tests/ablation.mjs ; node tests/llm-chokepoint.mjs
node -c farm.js && node -c main.js && node -c worldmap.js && node -c reconciliation.js
```
Browser spot-check (optional but valuable): `node server.mjs 8013` → `http://localhost:8013/?seed=20260706`, then in
the console inject a telegraph —
`w=RYFARMS.world; w.clock=120; w.pendingRaid={dir:-0.5,dirName:'east',detected:true,landsAt:1e9,detectAt:0,e:{by:'the Rukthrone warband'}}; RYFARMS.goTo(55+Math.cos(-0.5)*46,55+Math.sin(-0.5)*46)`
— the red seam + 6 mustering orcs should appear east; `w.pendingRaid.detected=false` dims it to the calm ember;
`w.pendingRaid=null` clears it.

Highest-value checks, in order: **C1** (cosmetic figures leaking into sim/hover paths), **E2/E4** (frontier muster on
bad ground / stuck state), **B2** (raidEvent-without-raiders crash), **A2** (sampler termination), **G1** (shownAt
freeze never un-freezing). If all hold and the harnesses are green, say CLEAN — the batch pushes as-is.
