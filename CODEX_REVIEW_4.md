# Ry Farms — Independent Review Directive (round 4: the infinite world)

Review the single large commit that turned the fixed 110×110 stage into an INFINITE
procedurally-generated, fog-of-war world. HEAD is `1dd54ea`; the whole change is that one
commit on top of `2f37206`. Diff it:

```
cd ~/ry-farms
git diff 2f37206 1dd54ea -- farm.js main.js
node --input-type=module --check < farm.js
node --input-type=module --check < main.js
node --input-type=module --check < audio.js
```

Your job is to **find where it breaks**, not to confirm it works. Every finding needs a concrete
repro: seed, in-game day, farmer/plot/tile, observed vs expected, and the smallest reproduction.
**Report only — do NOT commit fixes.**

## How to run
Drive the sim headless: `import { World, DAY_LENGTH, NIGHT_LENGTH, CHUNK, T } from './farm.js'`,
add 8 farmers (`world.addFarmer({title, content})` — content keywords bias stats/personality),
tick at `dt = 1/30`. Write test scripts under the scratchpad dir, NOT the repo.

**Gotchas:** `world.log` caps at 80 — monkey-patch `world.addLog` BEFORE ticking to capture events.
Sick/sleeping/resting/sheltering farmers legitimately don't move. A day is `DAY_LENGTH+NIGHT_LENGTH`
(300+80). Winter is season 3 (~day 45). The world has NO edges now — never assert an i/j bound.
Useful state: `world.chunks` (Map "cx,cy"→Uint8Array), `world.fog`, `world.revealRect`,
`world.exploredTiles`, `world.dirtyChunks`, `world.isRevealed(i,j)`, `world.reveal(i,j,r)`.

## What changed and the invariants to attack

### 1. Infinite chunk generation — PURITY & DETERMINISM (HIGHEST PRIORITY)
Tiles outside the founding valley (`0..GRID`) are generated lazily by `#chunk`/`#genTile`/
`#wildTreeAt` from `tileRand`/`tileNoise` (pure hash noise of position + `this.seed`). The
absolute rule: **generation must be a PURE function of (i, j, seed)** — no `world.rand()`,
`Math.random`, `Date.now`, and NO dependence on visit order.
- **Purity:** for many far tiles (incl. negatives like (-300,200), and large like (4000,4000)),
  assert `worldA.get(i,j) === worldB.get(i,j)` across two fresh same-seed worlds, AND that reading
  a tile twice, or reading its neighbors first, never changes it. Try reading a chunk's tiles in
  scrambled order vs sequential — identical result required.
- **Valley seam:** tiles just outside the valley boundary (i or j near 0 or GRID=110) must not
  double-generate or leave a hard discontinuity — `#chunk` writes `T.GRASS` for in-valley cells of
  a boundary chunk and `get()` must route those to the flat array, never the chunk. Verify a
  boundary chunk's in-valley cells read from `tiles`, its out-of-valley cells from the chunk.
- **Determinism end-to-end:** same seed + same addFarmer inputs + same dt → identical digest
  including `exploredTiles`, `revealRect`, `chunks.size`, farmer positions/wood/ore/level/discovered,
  and plot cell counts. Grep farm.js for `Math.random`/`Date.now`/`new Date` — the ONLY sanctioned
  hit is `performance.now()` in `addLog` (display only). Any RNG in `#genTile`/`#wildTreeAt`/
  `reveal`/`#chunk` is a determinism bug.
- **Tree lattice:** `#wildTreeAt` places trees on a jittered screen-space lattice for spacing.
  Confirm two wild trees never land on the exact same tile pathological-clumped, and that the
  parity fix keeps (i,j) integral (no half-tile trees).

### 2. Fog of war
Per-chunk reveal bitmaps (`world.fog`); `reveal(i,j,r)` uncovers a circle, grows `revealRect`,
dirties chunks; farmers reveal r≈5 each tick they change tile; town starts with `reveal(CENTER,CENTER,42)`.
- **No farmer ever stands in fog:** over 40+ days assert every non-indoor farmer's current tile is
  `isRevealed`. (The per-tick self-reveal should guarantee this — verify it actually runs before any
  logic that could place them.)
- **Monotonic reveal:** fog only ever lifts, never re-covers; `exploredTiles` and `revealRect`
  never shrink. `reveal` returns the NEWLY-revealed count — assert it's correct (no double-count).
- **Determinism of reveal:** same seed → identical `revealRect`/`exploredTiles` at each day.
- **Bounds:** `revealRect` genuinely extends past the valley (i0<0 or j0<0 or i1≥110 or j1≥110)
  within ~30 days, proving farmers explore.

### 3. Unbounded systems — no full-world scans, no infinite loops (HIGH PRIORITY)
Every old `for j<GRID for i<GRID` scan is gone. Attack the replacements:
- **findPath:** now searches a start/goal bbox+30 margin window with a node cap (1800). Assert it
  (a) still finds normal paths, (b) NEVER hangs, (c) returns null gracefully for far/blocked goals,
  (d) the caller straight-line fallback still works. Key change: keys are strings `"i,j"` (coords can
  be negative) — verify no collision/negative-index bug. Try a path whose straight line crosses a
  pond → must route around, not through (pathBlocked respected except when escaping).
- **spiralFind** (nearestWood/nearestRock/nearestForage): rings outward over REVEALED tiles only,
  bounded radius. Confirm it never scans unrevealed/ungenerated tiles (which would force generation
  of scenery nobody walked to — a perf + determinism landmine), and returns null past its radius.
- **Ambient sims:** `#allTrees` (crows), `#regrowWild`, `#encroach`, `#maybeSpawnTreasure` now
  operate over `revealRect`/per-plot boxes, capped. Assert none iterate an unbounded region or force
  chunk generation far outside explored land. Over a long run, does `chunks.size` grow only with
  actual exploration, or does something quietly generate the whole plane? (A runaway `chunks.size`
  with little exploration = a bug — find what's touching far tiles.)

### 4. Exploration AI
`wanderlust` (personality-derived), `#frontierTarget` (compass bearing toward fog), `explore`
state → `#completeExplore` (XP, journal, find-type read, rare `spawnFrontierTreasure`). Sits in
`#decide` above fill-work on a long cooldown.
- **No stranding:** a farmer that sets out to explore always returns to normal behavior — never
  stuck walking forever, never freeze-watchdog spam. Assert exploreCooldown actually gates frequency
  (a few treks/day at most, not every tick).
- **Doesn't starve the farm:** crops still get watered/harvested; exploration doesn't cause mass
  crop wither or abandoned facilities. Count withered/day with and against a no-wanderlust baseline.
- **Frontier target validity:** `#frontierTarget` returns a walkable, reachable tile (or null); a
  farmer never targets a permanently-blocked spot and loops.

### 5. Frontier annex fields (build-anywhere)
`#pursueFrontierField`/`#scoutAnnexSite`/`#completeAnnex`/`World.annexCells`: an L3, land-capped,
boxed-in farmer stakes a DETACHED 4×4 field in charted country and pays the full new fence via
`fenceDelta`.
- **Crop/fence conservation:** `annexCells` must charge the correct wood (`removed - added` clamped
  ≥0) and NEVER let wood go negative or expand for free. Re-validate at `#completeAnnex` (world moved
  while walking — every cell still legal, still affordable).
- **Detached correctness:** annexed cells become owned, off every other plot (+buffer), on charted
  land; `#rebuildFields`/bounds/fence outline handle a disconnected cell set without crashing.
- **Gate:** only L3 farmers annex, only up to `tierCellCap`. Assert an L1/L2 farmer never annexes.
- Force the boxed-in condition (`world.expansionInfo = () => ({state:'blocked'})`) to exercise it.

### 6. Renderer (browser-only — reason + grep; can't pixel-test headless)
Per-chunk baked ground canvases (`bakeChunk`/`drawTerrainChunks`), invalidated by `world.dirtyChunks`
+ season change, evicted past 420. Minimap is a camera-window (`MINI_SPAN=84`) with cached base.
`T` key homes the camera; `RYFARMS.goTo/GW/GH`.
- Grep for hazards: does `bakeChunk` ever read tiles for UNREVEALED cells (it must NOT — fog cells
  bake without calling `world.get`)? Does the dirty-chunk set get cleared each frame so it can't
  grow unbounded? Does chunk-cache eviction (`>420`) risk thrashing at normal zoom (how many chunks
  does one viewport touch)? Does the minimap base cache key (`ci/4,cj/4:explored:season`) rebuild
  too often or leak?
- Confirm `T` uses plain key (browser owns cmd+T) and doesn't fire while typing in any field (there
  are no text inputs, but confirm modifier guard).

### 7. Guardian statues (replace storm tower)
3-tier communal chain (`statue1` head 1×1 / `statue2` fox 2×2 / `statue3` mother 3×3), `lvlReq`
8/16/26, exponential `wood/ore` cost, `size×size` footprint, `lightning`+`rain` perks. Materials are
HAULED (`projectNeedsMaterials`/`depositProject`/`projdrop`) before carving (`contributeBuild` no-ops
until stocked).
- **Level gate:** a statue project never STARTS until someone in town meets `lvlReq`. Assert
  `projectIndex` doesn't advance early and the tier waits.
- **Materials conservation:** builders' wood/ore never negative; `depositProject` transfers exactly;
  carving (`points`) never accrues while `projectNeedsMaterials` is true (no free statue).
- **Footprint:** every tile of the `size×size` base becomes `T.STRUCT` and `pathBlocked`; `#protectedTile`
  and `#findStructureSpot` respect the multi-tile size (no statue overlapping a plot/well/another
  structure; farmers path around the whole base, none entombed under a 2×2/3×3).
- **Effects supersede + curve:** completing tier N sets `lightningMult`/`rainBoost` to that tier's
  values (not multiply-stack). Confirm `rainBoost` actually (a) raises rain-weather odds in
  `#rollWeather` and (b) deepens crop soak in `#tickCrops`, and that lightning strikes fall off. Sanity
  the exponential feel: at Stone Mother (`lightningMult` 0.12) are storms basically harmless? Flag if
  it reads as trivializing weather (design note, not a correctness bug).

### 8. Housing ladder
`World.tierCellCap(level)` 200/360/560; `Farmer.storageCap()` 40/20→80/40→160/80 (clamped in `tick`);
livestock (all facilities via `#milestones` + `#pursueGrowth`) and frontier annexes gated behind L3;
blocked ambition → `wantUpgrade` active savings drive; `HOUSE_TIERS` rebalanced.
- **Caps never exceeded:** across 45 days assert no plot's `cells.size` exceeds its tier cap
  (watch the `expandPlot` trim-to-room), and no farmer's wood/ore exceeds `storageCap` after any tick.
  The storage clamp runs every tick — confirm it's deterministic (no RNG in the clamp path) and
  can't silently swallow a legitimate spend.
- **Livestock strictly L3:** ZERO facilities exist on any plot whose `built.level < 3`, ever.
- **The pull works, no deadlock:** blocked farmers actually reach L2 then L3 (don't stall forever
  saving); `wantUpgrade` clears correctly; a farmer who can't afford the upgrade keeps farming (not
  frozen). Confirm the savings drive doesn't cause a livelock with the craft/expand pursuits.
- **Storage vs economy:** does the storage cap ever starve a legitimate need (e.g. a farmer needs 55
  wood for a cottage but the tipi caps at 40)? Trace whether the ladder is actually completable — is
  there a wood/ore deadlock where the cap < the next tier's cost? (L1 cap 40 wood vs yurt cost 24 —
  ok; L2 cap 80 vs cottage 55 — ok; verify.)

### 9. Preserved invariants (everything from prior rounds must STILL hold)
- **Determinism** across the FULL new feature set (the master check).
- **Crop conservation** (`transferGood`): no duplication/negative produce; lifetime `harvested`
  never decremented by a transfer.
- **Prior Codex/Opus fixes intact:** winter never starts with an active storm; blizzards only in
  winter; land animals never end a tick on a blocked/unowned tile (now with the new grazing motion
  AND the infinite map — re-verify 0); livestock retire inside on stormy nights; `expandPlot`
  self-guards affordability; scarecrow 9-tile; no stuck lightning bolt.
- **New grazing motion:** cattle/sheep/pigs dwell long and step slowly, chickens still dart — but
  neither escapes the yard or lands on a blocked tile.

## Deliverable
Per numbered area: PASS, or a concrete FAIL with repro. Prioritize (highest first): generation
purity/determinism, unbounded-scan / runaway-`chunks.size` / findPath-hang, farmers-in-fog, housing
caps + livestock-L3 gate, fence/material conservation (annex + statues), and the full-determinism
master check. Surface findings; do not commit.
