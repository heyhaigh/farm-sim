# Ry Farms — Independent Review Directive (round 8)

Review everything committed since your last pass. Round 7 reviewed up to `9617f33`. This round covers
the 6 commits ON TOP of it. HEAD is `599ba25`.

```
cd ~/ry-farms
git log --oneline 9617f33..599ba25
git diff 9617f33 599ba25 -- farm.js dna.js main.js
node --input-type=module --check < farm.js
node --input-type=module --check < dna.js
node --input-type=module --check < main.js
```

The 6 commits:
- `8a7a343` slow progression — exponential leveling + a year-long, level-gated cottage
- `d13d850` statue upgrades rise in place over the monument (no orphan scaffold)
- `e3ad332` town level system — a donation silo that gates the town's growth
- `bcaf5bd` winter freezes the pond (render-only)
- `88a6a4e` sheep livestock — a flock at the yurt for a level-15 hand
- `599ba25` free-will settlement — farmers homestead by personality + solo wells

Your job is to **find where it breaks**, not confirm it works. Every finding needs a concrete repro
(seed, in-game day, farmer/plot/tile, observed vs expected, smallest reproduction). **Report only —
do NOT commit fixes.**

## How to run (headless is authoritative)
`import { World, DAY_LENGTH, NIGHT_LENGTH, CENTER, GRID, T, xpForLevel, townXpForLevel } from './farm.js'`;
add 8 farmers via `world.addFarmer({title, content})`; call `world.ensureFounderVariety()` right after
(**placement now happens INSIDE ensureFounderVariety — a world whose farmers you never `ensureFounderVariety`
keeps them at their provisional ring spots**); tick at `dt=1/30`. **Gotchas:** monkey-patch `world.addLog`
BEFORE ticking. Sick/sleeping/resting farmers legitimately don't move. A day is `DAY_LENGTH+NIGHT_LENGTH`
(380s); a YEAR is 60 days (SEASON_LENGTH 15 × 4). Winter is season 3. `world.tiles` is the flat GRID×GRID
(110×110) founding valley; `world.chunks` holds Uint8Array chunks beyond it. `main.js` is render/UI only —
its `Math.random`/`performance.now` are fine; only farm.js + dna.js sim state must stay deterministic.
Write scripts under a scratch dir, never in the repo.

**Known non-bugs (don't flag):** several `well2` structures in a mature town are neighbour/solo wells reusing
the well2 sprite tag, not duplicate town projects. `#statueFits` is now dead code (left dormant intentionally).
The sheep sprite + frozen-ice pond visuals are known-unverified and will be revisited — judge them for
correctness/crashes only, not aesthetics.

## Areas and invariants to attack

### 1. Exponential leveling + level-gated houses (`8a7a343`) — HIGH
`xpForLevel(L)=round(12*1.29^(L-1))`; `gainXP` carries overflow and can multi-level on a low-level windfall.
HOUSE_TIERS gained a `minLevel` and much larger costs; `canBuild` now also checks `sheet.level >= minLevel`.
Storage caps raised (yurt 140w/75o, cottage 220w/110o) specifically so a tier can bank the NEXT tier's cost.
Facilities gate on house tier (FACILITY_MIN_LEVEL: coop 2, pond/pen 3).
- **Curve sanity:** `xpForLevel` is strictly increasing, finite, never 0/NaN for L≥1; `gainXP` never loops
  forever or leaves `xp` negative; a single huge XP grant levels correctly (carry, not reset-to-0).
- **No unbuildable tier / no savings livelock (the bug that WAS here):** every tier's `wood`/`ore` cost must
  be ≤ the PRIOR tier's storage cap, or a farmer saving for it spins forever on a capped resource. Assert
  cottage cost (120/60) ≤ yurt cap (140/75) and yurt cost (30/12) ≤ tipi cap (45/22). Over long runs, farmers
  actually reach the cottage (don't get stuck wanting-upgrade with capped wood).
- **Pacing holds:** houses no longer pop in a week — first cottage lands late (roughly a year); the XP bar in
  main.js uses `xpForLevel` (not the old `level*12`).
- **Determinism** (levels, xp, house tiers, facilities) for a fixed seed.

### 2. Statue in-place upgrades (`d13d850`)
A statue UPGRADE always sites on the existing `world.statue` tiles; the FIRST statue reserves a 3x3 footprint
(`#findStructureSpot(3)`, falling back to `def.size`).
- Force a statue2→statue3 upgrade and assert `project.site == world.statue` (never a fresh remote scaffold);
  the first statue's 3x3 footprint is clear/reserved so later tiers fit; only ONE statue ever in `structures`
  (old torn down on completion). No crash if the 3x3 reserve can't be found (fallback path).

### 3. Town level system (`e3ad332`) — HIGH, attack hardest
The town levels on donations. `world.townLevel/townXP`, `townXpForLevel(L)=round(45*1.5^(L-1))`,
`TOWN_MAX_LEVEL=10`, a `world.silo` fixture (a T.STRUCT tile). `addTownXP` rolls level-ups; `#pursueDonation`
sends civic farmers to haul surplus timber (or cut some to give); `#maybeStartProject` now gates on
`townLevel >= def.townLvl` (board 2, toolshed 3, windmill 4, statue1/well2 5, statue2 6, statue3 7);
merchant spawns only at `townLevel >= MERCHANT_TOWN_LVL (3)`.
- **XP/level conservation:** `townXP` never negative/NaN; `addTownXP` can't infinite-loop; at
  `TOWN_MAX_LEVEL` XP stops accruing (no overflow); level-ups consume exactly `townXpForLevel` each.
- **DONATION conservation:** `#completeDonate` deducts EXACTLY the wood it credits — `coffers.wood +=`,
  `townXP += give*DONATE_XP.wood`, farmer.wood -= give, never negative, never credits XP without spending
  wood. A farmer saving for a build (wantUpgrade) only donates surplus BEYOND the build cost (they never
  starve their own cottage savings); the cut-timber-to-give branch is gated (collab>0.5, no pending goal,
  cooldown) and can't livelock.
- **Gating actually holds:** a level-1 town builds NOTHING but has its well+silo (no board/toolshed/windmill
  on day one); each project starts only at/after its `townLvl`; merchant never visits below town L3. The
  townLvl gate composes correctly with the still-present harvestTotal `at` gate, storm-acceleration, and
  statue `lvlReq` (a build needs ALL of them). The silo tile is avoided by structure siting / merchant stall.
- **Determinism** (townLevel, townXP, coffers, per-farmer donateCooldown, unlock days) for a fixed seed;
  `townLevelFlash` is UI-only (decremented in tick) and must not feed any sim decision.

### 4. Free-will settlement + solo wells (`599ba25`) — HIGH
After founder-variety nudges, `#resettleByPersonality` repositions every (still-pristine) plot by
`#ventureOf` (collaboration + curiosity): sociable near the plaza (~r14-30), lone wolves/curious to the far
valley corners (~r55-64). A LONE-WOLF founder (Nomad Ry, collab~0.14) is guaranteed. Each plot reveals a fog
patch. A too-isolated settler (no neighbour within 34) sinks a PRIVATE well (`soloCandidate`/`digSoloWell`);
`#pursueCoop` was restructured so a member always builds their existing well (even lone wolves).
- **No overlap / in-bounds / reachable:** across many seeds, no two plots overlap (buffer respected), EVERY
  plot stays inside the valley (`#candidateBlockers` bounds: x,y ≥ 2 and x+w,y+h ≤ GRID-2), and `#relocatePlot`
  rebuilds cells/fields/house/pos + reveals correctly. `#findHomestead` always terminates (returns a spot or
  null); a null result must not crash addFarmer/ensureFounderVariety.
- **Placement is PERSONALITY-DRIVEN + deterministic:** low-collaboration/high-curiosity settle farther than
  the sociable for a fixed roster; identical world for a fixed seed (no `Math.random`/`Date` in the new
  path — it uses personality + `sheet.seed` only). The resettle order (venture asc, seed tiebreak) is stable.
- **Far settlers stay VIABLE:** over a long run no farmer ends with a non-finite position; far loners still
  homestead (reach a tipi/yurt) and `harvested>0` — being isolated must not strand or livelock them (walk
  stuck-timer, decide loop). Pathfinding still treats fog as impassable and does NOT generate chunks when a
  loner is boxed in a fog island.
- **SOLO WELL conservation + no livelock:** `digSoloWell` makes a one-member coop at stage 'gather' that the
  lone builder hauls to and completes; assert wood/ore deducted == deposited (no duplication), the well
  finishes and appears once in `structures`/`wells`, the "one coop plan town-wide" invariant still holds
  (a solo dig and a shared dig can't both be active), and a lone wolf with a solo coop actually BUILDS it
  (the restructured `#pursueCoop` no longer bails before building for a lone-wolf goal). Shared co-op wells
  still work for the sociable (join/rally/gather/build/complete) exactly as before.
- **Determinism** of the full settled world (plot positions, wells dug, structures) for a fixed seed.

### 5. Sheep livestock (`88a6a4e`)
New `sheeppen` facility (produce wool) gated at house L2 (yurt) AND farmer level 15 via
`facilityUnlocked(type, houseLevel, farmerLevel)` (`FACILITY_MIN_LEVEL.sheeppen=2`,
`FACILITY_MIN_FARMER_LEVEL.sheeppen=15`). `PROD.sheep` config; `#buildFacility` shares the pen branch with
kind 'sheep'; every archetype's `facilityPrefs` gets 'sheeppen' after 'coop'.
- **Gate correctness:** a sheep pen appears ONLY when house≥2 AND level≥15 — never below 15, never before the
  yurt; cow/pig/goat pens still require the cottage (house 3). `farmerHasUnbuiltFacility` /
  `farmerHasLockedFacility` correctly split level/tier-locked facilities (a sheeppen locked only by LEVEL must
  not, e.g., wrongly force a cottage-savings plan in a way that livelocks).
- **Producer safety:** `PROD.sheep` exists so `#tickProducers` never reads `cfg` undefined (the crash that
  WAS here); sheep behave as a normal land animal (roam, feed, shear wool ~every 3 days); no NaN yields.
- **Determinism** (which farmers build sheep pens, when) for a fixed seed.

### 6. Winter pond (`bcaf5bd`) — render-only, reason + grep
`drawProducer` returns early for pad/fish in winter; T.WATER bakes as pale ice + shine/crack.
- Confirm PURELY presentational — no farm.js/dna.js change, no sim/determinism impact; the terrain re-bakes on
  the season change; the pad/fish producers still TICK (only their draw is skipped), so pond yields aren't
  silently frozen off unless that's intended (it's render-only — the sim is unchanged).

### 7. Master regression
- **Determinism:** same seed + same addFarmer inputs + `ensureFounderVariety()` + same dt → identical digest
  (plot positions/cells, wood/ore, level/xp, townLevel/townXP/coffers, house tier, facilities, structures,
  wells, statue tier, weather sequence, projectIndex, gossip/opinions). Any `Math.random`/`Date.now`/`new Date`
  in farm.js or dna.js SIM state is a bug (render/audio fine).
- **All prior-round invariants still hold** on top of this work: no fog-chunk generation (findPath/expeditions/
  nearestWood/fenceRing/settlement); storage cap never exceeded at tick end; ONE guardian statue max; merchant
  goods/ore conservation in `doTrade`; stump wood conservation; weather season-gating; resentment avoidance
  never thrashes; housing caps; crop/goods conservation. No crash over 70+ day runs across several seeds.

## Deliverable
Per numbered area: PASS, or a concrete FAIL with repro. Prioritize (highest first): determinism master check;
town-level XP/donation conservation + gating; settlement overlap/in-bounds/viability + solo-well conservation;
house savings-livelock (cost ≤ prior cap); sheep gate + producer-config crash; statue in-place. Surface
findings; do not commit.
