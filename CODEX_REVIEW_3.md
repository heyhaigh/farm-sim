# Ry Farms — Independent Review Directive (round 3)

Review the work committed this session. HEAD is `b11e82b`. Commits to scrutinize (oldest→newest):

- `bc1ee1f` crafting/inventory + winter season + livestock roaming
- `90993af` more vibrant night lanterns
- `b11e82b` fence teardown/rebuild wood economy on expansion

Your job is to **find where it breaks**, not to confirm it works. Every finding needs a concrete
repro: seed, in-game day, farmer/plot, observed vs expected, and the smallest reproduction.
**Report only — do NOT commit fixes.**

## How to run
Headless is authoritative for logic:
```
cd ~/ry-farms
node --input-type=module --check < farm.js
node --input-type=module --check < main.js
node --input-type=module --check < audio.js
```
Drive the sim: `import { World, DAY_LENGTH, NIGHT_LENGTH, SEASON_LENGTH, ITEMS, CRAFTABLES } from './farm.js'`,
add 8 farmers (`world.addFarmer({title, content})` — content keywords bias stats/personality), tick at
`dt = 1/30`. **Gotchas:** `world.log` caps at 80 (monkey-patch `world.addLog` BEFORE ticking to capture
events). Sick/sleeping/resting/sheltering farmers legitimately don't move — exclude those states before
flagging "stuck". A day is `DAY_LENGTH + NIGHT_LENGTH` (300 + 80). Winter is season index 3; each season
is `SEASON_LENGTH` (15) days, so winter starts ~day 45. Farmers reach LV10 ~day 14, LV15 ~day 32.

## What changed and the invariants to attack

### 1. Crafting + tools (farm.js) — HIGH PRIORITY
`ITEMS`/`CRAFTABLES` registries; each farmer has `this.tools` (Set). Recipes: `wateringCan` (reqLevel 10,
6 ore + 2 wood, waters 3), `sprinkler` (reqLevel 15, 12 ore + 4 wood, requires wateringCan, waters 5).
Flow: `#maybeCraft` (in `#decide`, step "1c.5") walks home to a `craft` state → `#completeCraft`. When
leveled but ore-short, farmers actively MINE toward the tool. `#waterExtra` tops up nearby thirsty crops
on the `water` action based on `waterReach()`.
- **No double-craft:** a farmer must never own two of the same tool, and craft-log events must equal the
  count of owned tools across the town (no wasted material spend). Reconstruct and assert.
- **Material conservation:** `ore`/`wood` never go negative from crafting; a craft only fires when
  `level >= reqLevel && ore >= cost.ore && wood >= cost.wood && !hasTool && (requires ? hasTool(requires) : true)`.
  Check the arrival-time re-validation in `#completeCraft` (materials could be spent between decide and arrival).
- **Watering reach:** with a wateringCan/sprinkler, one `water` action must wet at most `waterReach()`
  crops total (target + reach-1 extras), only thirsty non-withered stage<3 crops on the OWN plot, and must
  not double-charge water/energy. Sprinkler should PREFER a straight line but must still work if none exists.
- **No starvation:** the craft/mine-for-tool pursuit sits above facility collection but below urgent crop
  care + clearing + growth — confirm it doesn't stall crop care or make farmers abandon ripe crops.

### 2. Inventory UI + tooltips (main.js) — verify no crashes, correct hit-testing
`drawItemSlot`, `drawSlotTooltip`, `sheetSlots`, `selectedSlotKey`, `sheetBodyY/H`, icon loader
(`itemIcon`). Hover shows a tooltip; click pins a select-ring + `> NAME` label. This is browser-only, but
you can still reason about it and grep for hazards:
- `inventoryItems()` returns only non-zero stacks (wood/ore/crops(produce)/wheat/flower); assert it never
  emits a phantom stack and that counts match `farmer.wood`/`ore`/`sheet.produce`/`sheet.goods`.
- `selectedSlotKey` must clear on farmer-switch and sheet-close, and auto-clear when the pinned stack
  empties (the `sheetSlots.find` fallback). Confirm no stale-key render.
- Slot click/hover hit-testing only accepts slots within the scrollable body (`sheetBodyY/H`) — a slot
  scrolled behind the title band must not be clickable. Confirm.
- No crash when: journal empty, no tools yet, all tools crafted, inventory empty.

### 3. Winter season (farm.js) — HIGH PRIORITY
`canGarden()` (season !== 3), `isWinter()`. At winter onset `#advanceSeason` withers all standing crops.
`#tickCrops` skips growth when `!canGarden()`. `#tickProducers` freezes aquatic (`fish`/`pad`): `ready=false`,
no movement, `prod` capped. `#nextTaskOnPlot` returns null for sow/till in winter; the competitive "grind"
branch is gated by `canGarden()`.
- **No gardening in winter:** assert 0 `plant`/`till` actions occur while season===3, and crops never grow
  (stage never advances). Confirm farmers still DO other work (livestock/forage/chop/craft/help) — not idle.
- **Frozen pond:** fish + lily producers never reach `ready` in winter and don't wander; anything mid-ready
  at freeze is locked (not collectable). Confirm they THAW and resume in spring (season 0).
- **Crop kill:** at the winter rollover every non-withered crop becomes withered exactly once; the log
  count matches. Withered crops still get cleared by farmers (not stuck).
- **Regression:** confirm crops grow normally again in spring/summer/fall and facilities (non-aquatic) keep
  producing through winter (~1/day) — winter must not freeze chickens/cows/pigs/goats.

### 4. Blizzards (farm.js + main.js + audio.js)
New `blizzard` weather state. Winter sets `storm:0, blizzard:2.5`; other seasons `blizzard:0`. `#rollWeather`
hard-excludes any state whose season bias is exactly 0 (with a `cloud` fallback). `#tickLightning` gives
blizzard soft whiteout gusts (flash≈0.5, NO crop strikes). Farmers with CON<15 shelter; shelter exits when
weather is neither storm nor blizzard.
- **Season gating:** assert BLIZZARD only ever occurs in winter and STORM never occurs in winter, across a
  multi-year run + multiple seeds. Assert `#rollWeather` never divides by zero / never leaves `weather`
  invalid (the fallback path).
- **No crop strikes in blizzard:** `struckTile` / crop damage must never trigger from a blizzard (only storm).
- **Shelter:** farmers actually shelter and RESUME afterward (no permanent shelter lock); confirm a blizzard
  doesn't strand anyone. Thunder SFX must not fire on blizzard gusts (flash stays ≤0.9 threshold).

### 5. Livestock roaming + night sheltering (farm.js + main.js)
Land animals (chicken/rooster/cow/pig/goat) roam the whole fenced yard by day and retire into their
coop/barn at night (`p.inside=true`, parked at `fac.struct`), out in the morning. `#producerCanStand`
gates movement to owned, non-`pathBlocked` tiles. Fish/pad stay in their pond `region`. Renderer skips
`p.inside`.
- **Containment:** across a long run, no land animal may end a tick on a non-owned cell or a
  `pathBlocked` tile (water/building/rock), and none may leave the plot bbox. Try multiple seeds.
- **Night/day cycle:** at deep night ALL land animals with a `fac.struct` are `inside`; by midday all are
  `inside===false`. Fish/pad never set `inside`. Confirm overnight egg/milk production still accrues while
  inside (they lay in the coop) and is collectable next morning.
- **Aquatic unaffected by roam code:** fish/pad still bounce within their pond region and never walk onto land.
- **Determinism:** roaming uses only `world.rand()` — confirm no `Math.random`/`Date.now`.

### 6. Fence teardown/rebuild economy (farm.js) — HIGH PRIORITY
`FENCE_POST_WOOD=1`; `#fenceEdgeSet(cells)` keys each boundary edge by its two sorted tiles; `fenceDelta`
diffs before/after an annex → `{removed, added, net}`; `fenceDeltaForNext` predicts the next expansion's
cost. `expandPlot` now applies `wood += removed - added` (clamped ≥0) and logs teardown; `#pursueGrowth`
gates on `net`. `expandCost` was removed.
- **Wood conservation / non-negative:** across 55+ days assert no farmer's `wood` goes negative and the
  reclaim/cost is internally consistent (`removed` = old edges now interior, `added` = new perimeter edges).
  Verify the clamp to 0 can't silently swallow a real debit that should have blocked the expansion.
- **Gate correctness:** a farmer must not expand unless `wood >= net`; confirm `expandPlot` and
  `fenceDeltaForNext` agree on the SAME next expansion (both call `expansionInfo` — is there a TOCTOU where
  the predicted delta differs from the committed one? e.g. state changes between the gate check and commit).
- **Progress, no deadlock:** farms still grow over 40–55 days; `wantExpand` farmers aren't pinned forever;
  a boxed-in / MAX_PLOT farm stops requesting. Facility-driven expansion (no room → grow) still works.
- **Edge math:** a straight full-side annex on a rectangle should give removed≈W, added≈W+2, net≈2;
  a concave pocket-fill can have removed>added (net 0, wood refund). Sanity-check on real plots.

### 7. Preserved invariants (must still hold)
- **Determinism:** same seed + same addFarmer inputs + same dt → identical sim digest. `Math.random` /
  `Date.now` / `new Date` must NOT influence farm.js sim state (audio.js + LLM chat gating are the only
  sanctioned non-determinism; `performance.now()` in `addLog` is display-only). Grep farm.js and confirm.
- **Crop conservation:** harvest-share / water-toll payouts still move produce via `transferGood` with no
  duplication or negative balances; lifetime `harvested` never decremented by a transfer.
- **No entrapment regressions:** the pathfinding escape (findPath/nearestOpenTile) and walk freeze-watchdog
  still hold with the new craft/roam states in the mix.

## Deliverable
Per numbered area: PASS, or a concrete FAIL with repro. Prioritize: crafting double-spend/negative
materials, fence wood conservation + gate TOCTOU, winter no-grow / frozen-pond / blizzard-season-gating,
livestock containment + night cycle, and determinism. Surface findings; do not commit.
