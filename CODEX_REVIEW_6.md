# Ry Farms — Independent Review Directive (round 6)

Review everything committed since your last pass. Round 5 reviewed up to `bc12db8`. This round covers
the 9 commits ON TOP of it. HEAD is `5707744`.

```
cd ~/ry-farms
git log --oneline bc12db8..5707744
git diff bc12db8 5707744 -- farm.js main.js audio.js pixel.js
node --input-type=module --check < farm.js
node --input-type=module --check < main.js
node --input-type=module --check < audio.js
node --input-type=module --check < pixel.js
```

The 9 commits:
- `954acf3` ore expeditions — venture to the highlands when local stone runs out
- `22912ca` wandering merchant — trades surplus goods for ore at a plaza stall
- `1759a8f` richer frontier finds — varied loot + distance-scaled rewards
- `8f53342` weather settles in — day-spanning, randomized-duration spells with streaks
- `8f1479d` merchant variety — a different trader each visit + a hover tooltip
- `4d03981` rebalance guardian statues — gentler tiers
- `0258cdb` fix CRT shimmer/blur on scroll — snap text/content to integer pixels
- `c1c928b` rooster crow rework (5-syllable) + `5707744` pitch raise

Your job is to **find where it breaks**, not confirm it works. Every finding needs a concrete repro
(seed, in-game day, farmer/tile/merchant, observed vs expected, smallest reproduction). **Report only —
do NOT commit fixes.**

## How to run (headless is authoritative)
`import { World, DAY_LENGTH, NIGHT_LENGTH, CENTER, T } from './farm.js'`; add 8 farmers via
`world.addFarmer({title, content})`; call `world.ensureFounderVariety()` right after; tick at `dt=1/30`.
**Gotchas:** monkey-patch `world.addLog` BEFORE ticking (log caps at 80). Sick/sleeping/resting farmers
legitimately don't move. A day is `DAY_LENGTH+NIGHT_LENGTH` (380s). Winter is season 3 (~day 45). The
world is INFINITE — never assert an i/j bound. `audio.js`/`pixel.js`/render paths are NOT sim state —
their `Math.random`/`performance.now` are fine; only farm.js + dna.js sim state must stay deterministic.
Write scripts under a scratch dir, never in the repo.

## Areas and invariants to attack

### 1. Ore expeditions (`954acf3`) — HIGH
`#seekOreAfar(name)` is wired into all three ore sinks (tool crafting, home upgrade, town/statue
project) where `nearestRock` used to give up. It first mines any outcrop within a findPath-safe reach
(55), else `#outwardFrontierTarget` heads a fog-edge tile on the bearing AWAY from CENTER (rising r =
richer ore), charting via the 'explore' arrival. Paced by `oreExpedCooldown`.
- **No pathfinding blowups / no stuck:** over long runs, assert 0 farmers with non-finite position and
  everyone still productive (`harvested > 0`); the direct-mine reach (55) must stay within findPath's
  1800-expansion cap (a mine-walk that returns null shouldn't strand them). Force local depletion (strip
  every revealed T.ROCK within ~60 of a farmer who needs a tool) and confirm they trek OUTWARD (r rises)
  and eventually obtain ore — without livelock.
- **No fog-chunk generation** (the round-2/3 regression class): `#outwardFrontierTarget` /
  `#seekOreAfar` must not balloon `world.chunks.size`. Sample it over 60+ days — it should track
  exploration, not grow per-tick.
- **Determinism** with expeditions in the mix (positions, ore, wood, discovered).

### 2. Wandering merchant (`22912ca`, `8f1479d`) — HIGH
`world.merchant` state machine (arriving/trading/leaving) in `#tickMerchant`; visits every
~MERCHANT_INTERVAL(6)+jitter days, walks in via `findPath` (`#moveMerchant`), stalls ~1.3d, leaves,
reschedules. Each visit is one of MERCHANT_TYPES (name/spriteIdx/rate/stock). `doTrade(f)` swaps surplus
goods → ore at the merchant's rate; `#pursueMerchant`/`#completeTrade` + `tradeCooldown`.
- **GOODS/ORE CONSERVATION (attack hardest):** in `doTrade`, the farmer must pay EXACTLY `oreGained *
  rate` goods and receive EXACTLY `oreGained` ore, with `merchant.stock` reduced by the same — no
  goods deducted without ore granted, no ore minted beyond stock, no negative goods. Verify the
  "spend most-plentiful stacks first" loop can't over- or under-spend when a stack runs dry mid-pay.
  Assert town-wide (Σ farmer ore gained this visit) == (merchant.stock consumed).
- **Merchant never stuck / never off-map:** it always reaches its stall (arriving) and its exit
  (leaving) and despawns → reschedules; `#moveMerchant` returning null (unreachable) must degrade
  gracefully (snap + arrive), not freeze the state machine. Assert every spawn eventually departs;
  merchant.pos always finite; the stall spot is never on the well/board/statue/a plot.
- **Spawn gating:** only spawns in daytime when a valid revealed plaza spot exists; only ONE merchant
  at a time; `merchantNextDay` advances so visits don't stack.
- **Trade decision sanity:** `#pursueMerchant` fires only when trading + reachable + the farmer has
  spare goods and low-ish ore; `tradeCooldown` prevents ping-ponging; a resented/edge case can't loop.
- **Rate/stock variety** is deterministic per visit; rate defaults to MERCHANT_RATE if absent.
- **Determinism** with merchant + trades (note: richer treasures change farmer goods → trade counts
  shift per change but must stay identical for a FIXED code+seed).

### 3. Richer frontier finds (`1759a8f`)
Treasure now carries `kind` (cache/timber/goods/lode/relic) + `depth` (from CENTER), rolled at spawn;
`openTreasure` branches per kind with reward × (1+depth); relic grants +1 to a random ability stat.
- **Reward conservation / bounds:** opening once flips `opened` and can't be re-opened (no double
  reward); each kind lands only in its intended buckets; no negative/NaN rewards; the relic stat bump
  is exactly +1 to ONE stat and only fires for relics.
- **Depth invariants:** `relic` only spawns at depth > 0.7; deeper finds pay strictly more (a depth-1.4
  lode > a depth-0 lode); frontier spawn odds scale with depth (0.14→~0.38) and never exceed 1.
- **Determinism** (rewards, stat bumps, kinds) for a fixed seed.

### 4. Weather streaks (`8f53342`)
Durations are now WIDE, day-spanning ranges; each state carries a self-weight in `next`; the
50%/day forced reroll was REMOVED.
- **Season gating still holds:** blizzards ONLY in winter, storms NEVER in winter — sample every tick
  over a full year. `#advanceSeason` must still reroll a season-excluded current weather.
- **No permanent lock:** weather always eventually changes (timer expiry); no NaN/undefined weather;
  `#rollWeather` fallback ('cloud') still reachable if a season excludes everything in the table.
- **Streak sanity:** run-length distribution shows both brief and multi-day spells; nothing runs
  absurdly long (e.g. a spell > ~6 days should be rare, not the norm). Determinism on the weather
  sequence for a fixed seed.

### 5. Statue rebalance (`4d03981`) — cross-file consistency
`PROJECT_DEFS` statue1/2/3 now lightning ×0.82/0.55/0.25, rain ×1.1/1.3/1.6.
- The `perk` strings in farm.js AND the `STRUCT_INFO` tooltip strings in main.js must MATCH the numeric
  mults (−18/−45/−75% lightning, +10/+30/+60% rain). The mults must actually apply (a built statue
  reduces lightning strikes / raises rain odds by the stated amount; the single-monument upgrade still
  swaps effects in place, not stacks).

### 6. CRT / crispness fix (`0258cdb`) — render-only, reason + grep
`drawText` now rounds x/y to integer pixels; the sheet/roster/board round their scroll offset.
- Confirm this is PURELY presentational (no sim/determinism impact; `pixel.js`/`main.js` render only).
- Confirm rounding didn't break layout math that consumed `drawText`'s return width, or shift
  hit-test rects (scroll clamping still uses the fractional value; only the DRAW offset is rounded).
  Text should never be drawn off by more than a pixel from before.

### 7. Rooster crow (`c1c928b`, `5707744`) — audio-only, reason + grep
Pure Web Audio synthesis behind a dawn trigger + `playCrow()` debug hook.
- Confirm it can't throw at runtime (valid node graph, no divide-by-zero, `Math.max(90, …)` guards the
  exp ramp target > 0). Confirm it touches NO sim state and runs only when audio is enabled. `Math.random`
  via `#noiseBuffer` is audio-only (fine).

### 8. Preserved invariants (master regression checks)
- **Determinism:** same seed + same addFarmer inputs + `ensureFounderVariety()` + same dt → identical
  digest (positions, wood, ore, level, mood, opinions, gossip lengths, plot cells, `chunks.size`,
  statue tier, merchant state/stock/nextDay, weather sequence, treasure kinds). Grep farm.js + dna.js
  for `Math.random`/`Date.now`/`new Date` — any in SIM state is a bug (render/audio/LLM-gating are fine).
- **All prior-round invariants still hold** on top of this work: no fog-chunk generation (findPath/
  birds/nearestOpenTile/expeditions); storage cap never exceeded at tick end; ONE guardian statue max
  (upgraded in place); resentment avoidance never thrashes/strands; scarecrow cap per plot; gossip
  bounded (≤16, strength>0.2, no self); livestock never end a tick blocked/unowned; winter never opens
  with an active storm; blizzards winter-only; housing caps + L3 livestock/annex gate; crop/goods
  conservation via `transferGood`/`doTrade` (no duplication, `harvested` never decremented by a trade).

## Deliverable
Per numbered area: PASS, or a concrete FAIL with repro. Prioritize (highest first): determinism master
check; merchant goods/ore CONSERVATION in doTrade; merchant/expedition stuck-or-fog-gen; treasure
double-open + relic-depth; weather season-gating; statue cross-file value match. Surface findings; do
not commit.
