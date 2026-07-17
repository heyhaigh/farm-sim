# Ry Farms — Independent Review Directive (round 7)

Review everything committed since your last pass. Round 6 reviewed up to `5707744`. This round covers
the 8 commits ON TOP of it. HEAD is `9617f33`.

```
cd ~/ry-farms
git log --oneline 5707744..9617f33
git diff 5707744 9617f33 -- farm.js dna.js main.js audio.js
node --input-type=module --check < farm.js
node --input-type=module --check < dna.js
node --input-type=module --check < main.js
node --input-type=module --check < audio.js
```

The 8 commits:
- `15c95fc` curiosity trait — a 6th personality axis driving who ventures out
- `45ece5f` stumps worth a full tree's wood — foundation for demand-driven grubbing
- `281405b` fence-building walks the line post-by-post, in place (like tilling)
- `74b067c` farmers learn from lightning losses and rally to raise the guardian
- `840be1e` speed buttons 2x→5x, 10x→20x
- `10ef089` tabbed farmer detail sheet (STATS/ACTIVITY/TIES/MEMORY)
- `c727b19` remove the rooster crow SFX for now
- `9617f33` custom pixel cursor (arrow default, gold hand on hover)

Your job is to **find where it breaks**, not confirm it works. Every finding needs a concrete repro
(seed, in-game day, farmer/tile/plot, observed vs expected, smallest reproduction). **Report only —
do NOT commit fixes.**

## How to run (headless is authoritative)
`import { World, DAY_LENGTH, NIGHT_LENGTH, CENTER, T, GRID } from './farm.js'`; add 8 farmers via
`world.addFarmer({title, content})`; call `world.ensureFounderVariety()` right after; tick at `dt=1/30`.
**Gotchas:** monkey-patch `world.addLog` BEFORE ticking (log caps at 80). Sick/sleeping/resting farmers
legitimately don't move. A day is `DAY_LENGTH+NIGHT_LENGTH` (380s). Winter is season 3 (~day 45). The
world is INFINITE — never assert an i/j bound. `world.tiles` is the flat GRID×GRID founding valley;
`world.chunks` holds Uint8Array chunks beyond it (scan BOTH to count tiles of a type). `main.js`/
`audio.js` are render/UI/audio, NOT sim state — their `Math.random`/`performance.now` are fine; only
farm.js + dna.js sim state must stay deterministic. Write scripts under a scratch dir, never in the repo.

**Known non-bug (don't flag):** a mature town shows several `well2` entries in `world.structures` —
those are neighbour co-op shared wells (farm.js `type:'well2'` at the coop-well completion), which
legitimately reuse the well2 sprite tag; it is NOT a duplicated town project.

## Areas and invariants to attack

### 1. Curiosity trait (`15c95fc`) — dna.js + farm.js
A 6th personality axis (`curiosity`) with keyword biasing; `personalityLabel` gains Wanderer (cu>0.72)
and Homebody (cu<0.24); `recomputeWanderlust()` derives `wanderlust` from curiosity (+ a competitiveness
term + a seed jitter), called in the Farmer ctor and again for all founders after `ensureFounderVariety`
nudges (which now also guarantees a 'Rover Ry' wanderer with curiosity≈0.86).
- **Bounds:** `wanderlust` always in [0.05, 0.95]; every farmer has a finite `p.curiosity` in the trait
  range; `TRAIT_NAMES` includes `curiosity` and every consumer (sheet render colors, labels) has an
  entry so nothing renders `undefined`.
- **Founder guarantee:** for many seeds, exactly the intended named archetypes exist AND all founders
  end with a recomputed wanderlust consistent with their (possibly nudged) curiosity — no founder left
  with a stale wanderlust from before the nudge.
- **Determinism:** curiosity, wanderlust, labels, and exploration behavior identical for a fixed seed;
  the more-curious founder discovers ≥ as many tiles as the least-curious over a long run.
- Grep dna.js + farm.js for `Math.random`/`Date.now`/`new Date` in the new code.

### 2. Stumps foundation (`45ece5f`) — conservation + determinism
`WOOD_STUMP` is now 3 (=`WOOD_TREE`); the `break` LABOR entry equals `chop` (time+energy); grubbing a
stump grants XP like a fell; `nearestWood(pos, restrict?)` now returns the nearest tile of EITHER kind
(tree or stump) instead of strictly preferring trees. There is deliberately NO scripted fell-then-grub —
grubbing must remain the farmer's own decision (driven later by wood demand).
- **Wood conservation:** wood is granted ONLY when a tile is actually felled (TREE→STUMP, +3) or grubbed
  (STUMP→GRASS, +3); a `#completeChop` on any other tile grants nothing; no path grants wood twice for
  one tile or leaves a STUMP that yields wood on re-scan without state change.
- **No livelock:** `nearestWood` returning a stump can't strand a farmer (the `restrict` scan and the
  spiralFind both terminate; a null result degrades gracefully). Over long runs assert farmers still
  chop/build and `harvested>0`.
- **Determinism** (positions, wood, stump counts, chunks.size) for a fixed seed.

### 3. Fence-building in place (`281405b`) — geometry + render sync
`fenceRing(plot)` orders the border cells as a perimeter walk (angle around the plot centroid, ties by
radius then i,j), cached per `plot.rev`. `fencePostTarget = max(8, ring.length)`; `fencePostSpot(idx) =
ring[idx % len]`. In main.js `plotOutline` now emits posts/rails in the SAME angular order so the
under-construction reveal tracks the builder.
- **Contiguity + coverage:** consecutive `fencePostSpot` cells are adjacent (Chebyshev ≤ 1) for a fresh
  13×13 plot; every border cell is a valid plot cell the farmer can stand on; the ring is stable across
  ticks while `rev` is unchanged and rebuilds when `rev` bumps.
- **Fences still complete:** over a normal game every settler reaches `built.fence` then a house; the
  `fenceSkip` unreachable-post path still lets a fence finish; no farmer loops forever on one post.
- **Render-only, ordered reveal:** `plotOutline`'s reordering is presentational — assert it doesn't
  change sim state or hit-tests, that post/rail counts are unchanged (only order differs), and that the
  angular sort has no NaN (a 1-cell or degenerate plot centroid must not divide by zero).
- **Determinism** of the ring + fence progress for a fixed seed. Confirm expansion re-fencing (instant,
  not post-by-post) is unaffected.

### 4. Storm-learning → guardian (`74b067c`) — HIGH, attack hardest
On an unsaved lightning strike while `lightningMult > 0.25`, both `world.stormLosses` and the struck
farmer's `stormLosses` increment and `recordStormLoss` leaves a throttled 'lesson' memory. `#maybeStartProject`
lowers a STATUE project's harvest gate: `at = max(def.at - stormLosses*6, def.at*0.5)` (non-statue projects
unchanged). Completing a statue decays both tallies (×0.4); a farmer's personal tally decays ×0.85 at dawn.
The old inline project-contribution block was extracted into `#pursueProject()`, and a new decide-step
(right after urgent crop care, gated by `#stormDrivenStatue`) sends storm-struck farmers to raise the
monument ahead of routine chores.
- **Extraction equivalence:** `#pursueProject()` must behave identically to the old inline block for the
  NORMAL path (haul stored mats → gather missing wood/ore → expedition → carve when stocked; returns
  true iff it committed an action). No double-return, no state left set (mineTarget/woodTarget) on a
  false return that would mislead the next step.
- **Acceleration can't break invariants:** a statue never starts before its `lvlReq` (someone in town
  must have the level) regardless of stormLosses; projects still run in strict `projectIndex` order (the
  gate only lowers the harvest threshold, never reorders or skips); `at` never below `def.at*0.5`; a
  non-statue project's threshold is never lowered. Force heavy losses and confirm the guardian is pulled
  forward but nothing else is.
- **No crop-care starvation / no livelock:** the storm-statue decide-step sits BELOW urgent crop care
  (thirsty/ripe/withered) — verify a battered town still waters/harvests and doesn't let every farmer
  livelock at the monument with no reachable materials (a false `#pursueProject` must fall through to
  normal chores).
- **Counters sane:** stormLosses never negative/NaN; the personal decay floors to 0 (no perpetual tiny
  float keeping `>=1` true forever); losses stop accruing once a full ward (`lightningMult` at min) stands.
- **Determinism** with storms in the mix (stormLosses, project start day, positions) for a fixed seed.

### 5. Speed buttons (`840be1e`) — trivial, grep
`>`=5x, `>>`=20x, `1X` revert. Confirm no stale `=== 2`/`=== 10` speed comparisons remain, the highlight
active-states match the new values, and 20x can't overrun the sim loop (the `steps < 800` cap holds; at
20x ≈ 10 sim steps/frame). Sim-loop change is main.js only — no determinism impact.

### 6. Tabbed farmer sheet (`10ef089`) — render/UI only, reason + grep
The detail card is now four tabs (STATS/ACTIVITY/TIES/MEMORY) with a fixed tab bar; body renders only
the active tab; scroll resets on tab switch; selecting a new farmer resets to STATS + scroll 0.
- **Hit-rects can't go stale:** `sheetSlots` is populated ONLY on STATS, `MEM_PREV/NEXT` set ONLY on
  MEMORY (both zeroed each frame at the top of the body); confirm you can't click a phantom inventory
  slot or pager arrow while on another tab (the click handler guards on the rebuilt rects).
- **Click routing order:** close → tab bar → mem pager → sheet-body/slots; switching tabs resets scroll
  and clears `selectedSlotKey`; the scroll clamp (`maxSheetScroll`) is recomputed per active tab so a
  short tab can't keep a tall tab's scroll offset.
- Confirm PURELY presentational — no sim/determinism impact; grep the diff for any farm.js/dna.js change
  (there should be none).

### 7. Rooster removal (`c727b19`) — audio only, grep
The dawn cue no longer calls `#crow()`; the `#crow()`/`playCrow()` synth is left dormant. Confirm nothing
else calls `#crow` in normal play, `playCrow()` is still guarded by `this.ctx`, and `hasRooster` plumbing
(still passed from main.js) is harmless/unused for the crow. No sim impact.

### 8. Custom cursor (`9617f33`) — render/UI only, reason + grep
`out.style.cursor='none'`; `drawCursor` blits an arrow (default) or gold hand (`cursorIsHot`) into the
game canvas each frame before `crt.render`. Hotspot correctness is visual (out of scope for headless).
- **No crashes from hit-testing:** `cursorIsHot` reads button rects (some `.w===0`/`.hidden` when their
  control is absent), `SHEET_TABS`/`sheetSlots`/`MEM_*` (empty when no sheet), `rosterRows` (y0/y1), and
  `worldHover`. Confirm it can't throw when panels are closed / rects zeroed / arrays empty, and that
  `buildingUnder` is invoked at most once per frame (reused as `worldHover`), not doubled.
- No sim/determinism impact (render only); grep the diff for farm.js/dna.js changes (none expected).

### 9. Master regression
- **Determinism:** same seed + same addFarmer inputs + `ensureFounderVariety()` + same dt → identical
  digest (positions, wood, ore, stormLosses, level, mood, opinions, gossip lengths, plot cells + ring,
  chunks.size, statue tier, weather sequence, projectIndex). Any `Math.random`/`Date.now`/`new Date` in
  farm.js or dna.js SIM state is a bug (render/audio are fine).
- **All prior-round invariants still hold** on top of this work: no fog-chunk generation (findPath/
  expeditions/nearestWood/fenceRing); storage cap never exceeded at tick end; ONE guardian statue max
  (upgraded in place); merchant lifecycle + goods/ore conservation in `doTrade`; treasure single-open +
  relic depth; weather season-gating (blizzards winter-only, storms never in winter); resentment
  avoidance never thrashes/strands; scarecrow cap per plot; housing caps + gates. No crash over 70+ day
  runs across several seeds.

## Deliverable
Per numbered area: PASS, or a concrete FAIL with repro. Prioritize (highest first): determinism master
check; storm-learning acceleration/invariants + `#pursueProject` extraction equivalence; stump wood
conservation; fence ring contiguity + fences-still-complete; tabbed-sheet stale hit-rects. Surface
findings; do not commit.
