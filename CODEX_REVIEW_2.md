# Ry Farms — Independent Review Directive (round 2)

Review the work committed since your last pass. HEAD is `5132539`. The new commits to scrutinize:

- `0e34fd9` livestock sprites + pond/pathfinding entrapment + your prior findings #1/#2/#3
- `0be3513` farm-economy rebalance (energy, decide-order, help, clearing, aquatic collection)
- `dae250f` expansion unblock (growth above facility collection)
- `5132539` animals yield ~1/day + watering tax trim

Your job is to **find where it breaks**, not confirm it works. Every finding needs a concrete repro:
seed, in-game day, farmer name, observed vs expected, and the smallest reproduction. **Report only —
do not commit fixes.**

## How to run
Headless is authoritative for logic:
```
cd ~/ry-farms
node --input-type=module --check < farm.js
node --input-type=module --check < main.js
node --check api/ry-farms-chat.js
```
Drive the sim directly: `import { World, DAY_LENGTH, NIGHT_LENGTH, T } from './farm.js'`, add 8 farmers
(`world.addFarmer({title, content})` — content keywords bias stats/personality), tick at `dt = 1/30`.
**Gotcha:** `world.log` caps at 80 (addLog shifts) — monkey-patch `world.addLog` BEFORE ticking to
capture events. Sick/sleeping/resting farmers legitimately don't move — exclude those states before
flagging a farmer as "stuck." A day is `DAY_LENGTH + NIGHT_LENGTH`.

## What changed and the invariants to attack

### 1. Pathfinding escape (farm.js findPath / nearestOpenTile / decide) — HIGH PRIORITY
A build (pond/facility/scarecrow) can turn the tile a farmer is standing on solid. Fix: `findPath`
now allows stepping OUT of a blocked tile (fromBlocked), `nearestOpenTile` is the top decide priority,
and a walk freeze-watchdog redecides after 4s of zero movement.
- **Invariant A (no permanent entrapment):** run 30+ days until ponds/pens exist, then 3 more days;
  no farmer whose state is NOT in {sick, sleep, rest, shelter} may end a tick standing on a
  `world.pathBlocked` tile, and each such farmer's cumulative displacement over the window must be
  non-trivial. Try multiple seeds. This was your Finding #1 — verify it's truly closed, including a
  scarecrow/facility built adjacent to a house/well/fence corner.
- **Invariant B (no wall-cutting):** the escape must NOT let normal pathing route THROUGH water or
  buildings from open ground. Construct a case where the straight line between two land tiles crosses
  a pond and assert the returned path never steps onto a `pathBlocked` tile except when the start
  itself is blocked. If normal paths cut through ponds, that's a regression.
- Freeze-watchdog: confirm `_freezeT`/`_freezePos` actually fire a redecide, and that a legitimately
  stationary working farmer (state 'work', timer counting) is NOT redecided out of its task.

### 2. Aquatic collection from shore (farm.js #pursue)
Fish/lily producers sit on pond water; `#pursue` now retargets to `nearestOpenTile` when the producer
tile is blocked.
- **Invariant:** across a long run, a farmer that completes a fish/lily 'collect' is never standing on
  `T.WATER` at completion. Also confirm the collect STILL succeeds (produce is credited) when the
  farmer stands adjacent rather than on the producer — i.e. the yield didn't silently drop to zero.

### 3. Decide priority + starvation (farm.js #decide, #nextTaskOnPlot skipFacilities)
New order: urgent CROP care → clear own plot (0.85) → grow homestead (finite) → facility collection
(infinite) → coop → poach → grind → help/forage/mine → fill. `#nextTaskOnPlot(..., skipFacilities)`
splits time-sensitive crop work from facility collection.
- **Help board:** was 0 takes/30d. Assert takes > 0 over 30 days now. But also check the inverse — a
  farm with heavy facility load shouldn't NEVER collect (produce shouldn't pile up unbounded); confirm
  facility produce is still collected within a reasonable window.
- **Overgrowth bound:** count tiles on plot cells that are T.TREE/STUMP/FLOWER/WHEAT/ROCK across 40
  days; it should hold roughly steady (~10-20), not climb monotonically. If it climbs past ~50 and
  keeps rising, clearing is losing to encroachment again.
- **Expansion:** land (sum of plot.cells.size) should grow over 40 days and `farmers.filter(wantExpand)`
  should fall toward 0 (ambitions satisfied), NOT sit pinned at 8. Verify a farmer that genuinely can't
  expand (boxed in / at MAX_PLOT) stops re-requesting rather than looping forever.
- **Crop-care starvation check:** ripe/thirsty crops must still be served promptly — confirm crops
  aren't withering en masse because clearing/expansion jumped the queue. Count withered crops/day.

### 4. Energy economy (farm.js AWAKE_DRAIN, ACTION_ENERGY, LABOR, workSpeed)
No passive drain; till/plant/harvest/collect/tend = 0; water = 0.008; build 0.055; chop/mine/fence/
break/scarecrow/forage drain via LABOR.
- **Day/night rhythm intact:** farmers must still SLEEP at night (state 'sleep' a meaningful fraction of
  night ticks) — confirm zero passive drain didn't turn them into 24/7 grinders.
- **Energy sanity:** energy stays in [0,1]; a farmer that only tends crops (never chops/builds) should
  not drop to exhaustion from farming alone. A farmer doing heavy labor (expansion chopping) still can.
- **Sickness not eliminated:** the overwork→illness path should still be reachable for genuine
  overexertion + roofless exposure — confirm it's rarer, not dead code.

### 5. Production ~1/day (farm.js PROD)
Rates dropped ~8x; chicken yieldLo=yieldHi=1; feedDecay slowed.
- **Invariant:** eggs per chicken per day ≈ 1 (0.8–1.3 acceptable), and a chicken 'collect' yields
  exactly 1. Verify no producer ever exceeds ~1.5 ready-events/day. Confirm the rooster (rate 0) never
  becomes `ready` / never yields.

### 6. Regressions from your round-1 findings
- #2: `fetchwater` arrival now requires `well.ready === true` — reconstruct the unready-listed-well case
  and assert `carryWater` stays 0.
- #3: a `lone wolf` never takes a help job even for a liked farmer — reconstruct and assert takeHelp
  returns null / doesn't remove the request.

### 7. Preserved invariants (should still hold after the reorder)
- **Crop conservation:** harvest-share and water-toll payouts move crops via `transferGood` — payer's
  `sheet.produce` down exactly what payee's is up; `sheet.produce >= 0`; lifetime `sheet.harvested`
  never decremented by a transfer.
- **Determinism:** same seed + same addFarmer inputs + same dt sequence → identical sim digest. The only
  sanctioned non-determinism is audio.js and the LLM chat request gating. If `Math.random`/`Date.now()`
  influences farm.js sim state, that's a bug.

### 8. Sprites (main.js drawAnimal) — best-effort headless
Frame size now derives from `img.naturalWidth / ANIMAL_COLS`; side-walk row = 2; ANIMAL_ROWS = 8. You
can't see pixels headlessly, but you CAN assert the source-rect math never samples outside the sheet
for any (kind, col in 0..5, row 2), given the known sheet dimensions (Chick 96×128, Sheep/Piglet/Rooster
192×256, Bull 384×512). Flag any off-sheet read.

## Deliverable
Per numbered area: PASS, or a concrete FAIL with repro. Prioritize: pathfinding entrapment (Invariant A)
and wall-cutting (Invariant B), aquatic-collection yield-not-dropped, expansion actually satisfying
ambitions, day/night sleep intact, and crop conservation. Surface findings; do not commit.
