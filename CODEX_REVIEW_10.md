# Ry Farms — Independent Review Directive (round 10)

Review everything committed since your last pass. Round 9 reviewed up to `97a419d`. This round
covers the **32 commits** on top of it. HEAD is `34c5740`.

```bash
cd ~/ry-farms
git log --oneline 97a419d..HEAD
git diff 97a419d HEAD -- farm.js dna.js main.js audio.js
node --input-type=module --check < farm.js
node --input-type=module --check < dna.js
node --input-type=module --check < main.js
```

Your job is to **find where it breaks**, not to confirm it works. Every finding needs a concrete
repro (seed, in-game day, farmer/plot/tile, observed vs expected, smallest reproduction).
**Report only — do NOT commit fixes.**

Split by priority:
- **Priority A** — this session's fresh, unproven work (`ff1fc8c..HEAD`, 25 commits): the HUNTING
  loop (#69) and the BARTER economy (#60b) are the two big new SIM systems — deepest review there.
- **Priority B** — the earlier overnight batch that was due for round 10 but never formally reviewed
  (`97a419d..ff1fc8c`, 7 commits): fishing bounty, farm-specialty label, change-of-heart chronicle,
  proximity audio, bean stalks, inventory-crops-by-type, fence/plot scaling. Targeted sweep.

## How to run (headless is authoritative)

```js
import { World, DAY_LENGTH, NIGHT_LENGTH, T, ALL_CROPS } from './farm.js';
const w = new World(20260708);
const mems = [ /* 8x { id, title, summary } — summary keywords bias stats + personality */ ];
for (let k = 0; k < 8; k++) w.addFarmer(mems[k], (k / mems.length) | 0);
w.ensureFounderVariety();               // REQUIRED — settlement placement happens in here
const dt = 1/30;
for (let s = 0; s < (DAY_LENGTH+NIGHT_LENGTH)*60/dt; s++) w.tick(dt);
```

- **Determinism is the load-bearing invariant.** Same seed + same `addFarmer` inputs + same `dt`
  sequence ⇒ byte-identical state. Build two worlds with the same seed, tick both, compare a digest of
  `{positions, levels, plot.cells.size, reputation, opinions, chronicle, prey, goods}`. Any divergence
  is a P0. The NEW sim systems (prey, hunt, barter) ALL use `world.rand`/seeded hashes only — verify
  that independently. The only permitted non-determinism is audio.js + the opt-in LLM chat gating.
- If `Math.random` / `Date.now()` / `new Date()` touches **sim** state in `farm.js` or `dna.js`, that's
  a bug. In `main.js` they're fine (render/UI/animation timing — prey sprite frame-cycling, tree chop
  animation, and the guild-hall render all use `performance.now()` on purpose; that's display, not sim).
- **Gotcha:** `world.log` caps at 80, `world.chronicle` at 240 — monkey-patch `addLog`/`addChronicle`
  before ticking if you need every event.
- Browser (render/input/audio): serve at `http://localhost:8000`; **hard-reload (cmd+shift+r)** after
  any edit (no cache headers — stale ES modules load otherwise). Debug handle:
  `window.RYFARMS = { world, cam, audio, select(i), speed(mult), runSteps(n), goTo(i,j) }`.

---

# PRIORITY A — this session's work (`ff1fc8c..HEAD`)

## A1. Roaming wild prey (`09437ed`, farm.js/main.js)
- `world.prey` (cap `MAX_PREY = 4`) spawned by `#tickPrey`/`#spawnPrey` every `PREY_SPAWN_INTERVAL(75)
  + rand*PREY_SPAWN_JITTER(95)` sec. `PREY_DEFS` = rabbit/turkey/deer with `wary` (spook distance),
  `shy` (distance from CENTER it keeps: rabbit `WILD_RADIUS-9`, turkey `+5`, deer `+8`), `meat`, `evade`.
  `#advancePrey` flees the nearest threat within `wary`, else grazes on a slowly-turning heading, tethered
  to `home` (±14) and shy of the plaza; despawns on `life<=0` or drifting into unrevealed fog.
  - **Assert determinism:** prey spawn kind/position, movement, and despawn are pure `world.rand`. Two
    same-seed 60-day runs must have identical `prey` history (kinds, spawn tiles, count-over-time).
  - **Break it:** `#spawnPrey` tries 8 bearings then gives up — confirm it NEVER hard-loops and never
    spawns on `pathBlocked`/unrevealed tiles. Can a prey's `i/j` go NaN (division by a zero-length flee
    vector when a farmer stands exactly on it)? Can `home` drift so a prey oscillates forever at the shy
    boundary? Confirm `MAX_PREY` is honoured and dead prey are filtered (no unbounded `prey` growth).
  - **Sanity (matches design):** over 60 days, rabbits should range ~`WILD_RADIUS-9`..`+` from the plaza,
    deer/turkey stay deeper (34-64); NO prey should sit inside the settled core for long, and none should
    materialise within `wary+5` of a farmer.

## A2. Hunt AI + the kill (`b5f6d93`, farm.js)
- `#decide` block 5b-3: a bot out past `WILD_RADIUS-5`, energy>0.35, near prey (`nearestPrey`, ≤11) may
  give chase, gated by a `knack` (DEX + competitiveness + curiosity + a hurt bonus). Sets
  `huntTarget`/`a.hunter`, `huntTimer=9`, `state='hunt'`. `nearestPrey` skips prey already being run down.
- The `'hunt'` state (self-contained, like `flee`): re-steers at the moving prey each tick at 1.12×speed;
  drains energy; gives up on `huntTimer<=0 || energy<0.12 || dist>16`. In range (≤1.2) `#resolveHunt`
  rolls `d20(DEX + max(0,WIS))` vs `def.evade` → hit = meat-by-size into `goods` + XP + chronicle; miss =
  prey darts 2.5 tiles clear (`bolt`), `huntTimer` capped to 4.
  - **Break it:** force a hunt then REMOVE the prey (`a.done=true`) or the hunter's plot mid-chase — does
    `huntTarget`/`a.hunter` dangle, or the camera/`facing` NaN? Confirm the state exits cleanly (guard:
    `!world.prey.includes(a)`). Can two farmers lock onto the same animal (should be blocked by the
    `a.hunter && state==='hunt'` skip in `nearestPrey`)? Can a hunter chase indefinitely (huntTimer/energy
    must bound it)? Does a fumble ever push a prey onto a blocked/fog tile or off-map?
  - **Assert:** meat only ever enters `goods` via a *successful* `#resolveHunt` or a beast defeat
    (`#defeatThreat`) — never on a miss. Determinism of every hunt outcome across same-seed runs.

## A3. HP economy — frail revive + rest cap + meat heal (`9890693`, `3d9b98e`, farm.js)
- Revive now returns a downed farmer at `max(1, round(maxHp*0.25))` (was full). Rest/sleep mends only to
  `HP_REST_CAP` (0.6·maxHp), never higher; `#maybeEatMeat` (checked in `#decide` right after combat) eats
  the smallest meat when `hp < 0.6·maxHp`, healing `MEAT_HEAL` fraction of maxHp.
  - **Break it (the big risk = a death spiral):** run 80+ days with frequent encounters. Can a farmer get
    permanently stuck downed, or oscillate downed→revive-25%→downed with no path to recovery? Confirm hp
    never goes <0 or >maxHp; confirm the rest cap never DROPS hp already above 0.6 (the `hp < cap` guard).
    Confirm `#maybeEatMeat` can't loop-eat below the eat threshold or eat meat the farmer doesn't have.
  - **Assert:** the eat threshold (0.6) lines up with the cap (0.6) so a rested farmer plateaus and HOARDS
    meat rather than burning it — verify meat isn't drained to zero town-wide just to top off HP.

## A4. Barter economy + glut-aware specialisation (`34c5740`, farm.js) — DEEPEST
- `goodValue(good)` is now **quantity-aware**: `base(meat 1.5 / made 0.7 / lacked 1.15) - min(0.5,
  have*0.03)`, floored 0.4. `producedGoods()` = crops + facility yields (cached by facility count).
  `buildNextFacility` biases toward the facility whose good FEW farms make (× competitiveness) so the town
  spreads across niches. `#findBarter` scores nearby neighbours for a mutually-good swap (I'm long on
  something I value ≤0.85 that they want ≥1.0; they're long on something I want); `#completeBarter` walks
  there (`'barter'` errand) and does a fair 3-for-3 with `transferGood`, bond + opinion + XP + chronicle.
  - **Assert CONSERVATION (P0-class):** `transferGood` must never create or destroy goods — total town
    stock of each good is conserved across a barter (sum over farmers of `goods[g]` + `produce` is
    invariant except for production/consumption events). Verify the "hand-back" branch (partner had
    nothing to give) returns exactly what was taken — no duplication, no loss.
  - **Break it:** partner with `<3` of the get-good — does `transferGood`'s min-clamp leave an asymmetric
    trade (I gave 3, got 1)? Is that intended, or should it abort? Partner walks away / gets downed / goes
    sick before arrival — `#completeBarter` guards on `includes` + distance ≤3.5; confirm no dangling
    `barterDeal` and no crash. Can `goodValue` go negative or NaN (huge `have`)? Can `#findBarter` pick a
    swap where `give === get`, or trade a good the farmer will immediately want back (thrash: A→B then
    B→A forever)? Watch a 60-day run for a barter ping-pong between two farmers.
  - **Assert determinism:** `#findBarter` iterates `world.farmers` + `Object.keys(goods)` — key order is
    insertion order (stable), so the pick must be identical across same-seed runs. Confirm.
  - **Sanity:** with the glut-aware facility choice, do farms actually DIFFERENTIATE (not all end up
    poultry+wool)? Barter frequency scales with differentiation — confirm it's >0 in a normal run and that
    the chronicle beats name real goods ("bartered egg for X's fish").

## A5. Inventory provenance + wheat merge + carrot icon (`09437ed`, `1bae6af`, `4746592`, farm.js/main.js)
- `inventoryItems`: foraged wild-wheat (`goods.wheat`) is FOLDED into the wheat crop stack as "foraged"
  (one "Wheat" entry, sources `{grown,stolen,found+wildWheat}`); tooltip wording is raised/stolen/foraged.
  Carrot uses a bespoke `makeCarrotIcon()` canvas (its crop sprite read as wheat); carrot+wheat dropped
  from `PRODUCE_ICONS` (mis-cropped borrows) → procedural fallback.
  - **Break it:** a farmer with `goods.wheat` but no wheat cropStock — does the folded entry still render
    (count = wildWheat, sources.found = wildWheat)? Any crop whose `makeCropSprites(type)[3]` is undefined
    (no sprite) now that carrot/wheat use the fallback? Confirm counts add up (grown+stolen+found === total).

## A6. Guild-hall silo + animated chop-trees + minimap (`6f559a4`..`1c368eb`, `be4d9ce`, main.js) — render/input, lighter
- Silo renders as the 189780 guild hall (narrow centre + roof; L5 adds side wings); the hover hitbox
  (`buildingUnder`) was resized to the guild-hall bounds. Trees render from the 654184 animated sheet,
  frozen on frame 0, cycling only while chopped; PINE columns (6-8) are dropped (they overlap in the sheet
  → left-cut). Minimap tap now clears `followMode`/`followTarget`.
  - **Spot-check (render math, no determinism risk):** the guild-hall hover box vs the drawn sprite at L1
    and L5 (does the L5 wing width match the hitbox?); the tree slice never reads outside the sheet
    (`treeCol*64` for cols 0-5 only). Minimap: follow a farmer (F), tap the minimap — camera must stay put,
    not snap back. Confirm winter still uses the static snow trees (animated sheet is non-winter only).

---

# PRIORITY B — overnight batch (`97a419d..ff1fc8c`), targeted sweep

Same rules (headless, determinism, repro-per-finding):

- **Wild-water fishing** (`66766c0`): `nearestFishingSpot` + `#completeFish` (WIS check → 1-3 fish, a
  lily 40%); a spot rests `FISH_COOLDOWN(4)` days (`world.fishedAt`). Break it: can `fishedAt` grow
  unbounded (leak)? Does the shore-adjacency check ever let a farmer fish from an unreachable tile?
- **Farm specialty label** (`7edcfdd`): `specialty()` — pure derived from facilities+crops. Confirm it
  never throws on a facility-less / crop-less farm and the sheet TRADE line clamps to 22 chars.
- **Change-of-heart chronicle** (`ff1fc8c`): a genuine goal flip lands one chronicle beat. Confirm it
  fires only on a real change (not every reflect) and is deterministic.
- **Proximity chop/hammer audio** (`2932d28`, audio.js/main.js): per-farmer, panned + camera-distance
  volume; louder chop now (`3d9b98e` region raised 0.15→0.21). Audio-only — browser spot-check it's not
  clipping/obtrusive at the plaza with several farmers building. No sim impact.
- **Bean stalks** (`8476487`): fast-grow (0.5×) half-value crop. Confirm `ALL_CROPS` includes it, its
  ripe worth is `max(1, round(yieldN*0.5))`, and no renderer chokes on the type.
- **Inventory crops-by-type + provenance** (`6b2f381`): superseded/extended by A5 — confirm the
  grown/stolen/found tallies never disagree with the displayed count.
- **Fence cost + starter-plot scaling** (`b4a111c`): fence = 2 wood/tile from inventory; starter plots
  9×9 scaling per house tier. Confirm a farmer can't fence with wood they don't have (no negative wood),
  and plot scaling stays within `tierCellCap`.

---

## Deliverable
A short report. For each area (A1–A6, then B), PASS or a concrete FAIL with (seed, day, farmer/tile,
observed vs expected, smallest repro). **Rank by severity.** Prioritise, in order: (1) any determinism
divergence in the new sim systems (prey/hunt/barter), (2) a goods-conservation break in barter — goods
created or destroyed (A4), (3) an HP death-spiral / stuck-downed farmer (A3), (4) a hunt/prey NaN or
dangling target (A1/A2), (5) a barter thrash / dangling `barterDeal` (A4). Do not commit fixes — surface
findings first.
