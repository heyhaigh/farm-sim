# Ry Farms — Independent Review Directive (round 9)

Review everything committed since your last pass. Round 8 reviewed up to `599ba25`. This round
covers the **41 commits** on top of it. HEAD is `97a419d`.

```bash
cd ~/ry-farms
git log --oneline 599ba25..HEAD
git diff 599ba25 HEAD -- farm.js dna.js main.js
node --input-type=module --check < farm.js
node --input-type=module --check < dna.js
node --input-type=module --check < main.js
```

Your job is to **find where it breaks**, not to confirm it works. Every finding needs a concrete
repro (seed, in-game day, farmer/plot/tile, observed vs expected, smallest reproduction).
**Report only — do NOT commit fixes.**

That's a big backlog, so it's split into two priorities:
- **Priority A** — this session's fresh, unproven work (`ba7f9db..HEAD`, 8 commits). Deep review.
- **Priority B** — the earlier unreviewed batch (`599ba25..ba7f9db`): Dungeon Master/combat,
  size tiers, legibility layer, tree growth, guardians, winter, sheep. Targeted sweep.

## How to run (headless is authoritative)

```js
import { World, DAY_LENGTH, NIGHT_LENGTH, T, ALL_CROPS } from './farm.js';
const w = new World(20260708);
const mems = [ /* 8x { id, title, summary } — summary keywords bias stats + personality */ ];
for (let k = 0; k < 8; k++) w.addFarmer(mems[k], (k / mems.length) | 0);
w.ensureFounderVariety();               // REQUIRED — settlement placement happens in here
const dt = 1/30;
for (let s = 0; s < (DAY_LENGTH+NIGHT_LENGTH)*40/dt; s++) w.tick(dt);
```

- **Determinism is the load-bearing invariant.** Same seed + same `addFarmer` inputs + same `dt`
  sequence ⇒ byte-identical state. Build two worlds with the same seed, tick both, and compare a
  digest of `{positions, levels, plot.cells.size, reputation, opinions, chronicle}`. Any divergence
  is a P0. The ONLY permitted non-determinism is audio.js and the opt-in LLM chat gating.
- If you find `Math.random` / `Date.now()` / `new Date()` influencing **sim** state in `farm.js` or
  `dna.js`, that's a bug. (In `main.js` they're fine — render/UI only. Note: the day-recap timing and
  camera-follow easing use `performance.now()` in `main.js` on purpose — that's display, not sim.)
- **Gotcha:** `world.log` caps at 80 (`addLog` shifts). The new `world.chronicle` caps at 240.
  Monkey-patch before ticking if you need every event; don't index after the fact.
- Browser (render/input/audio): serve at `http://localhost:8000`; **hard-reload (cmd+shift+r)** after
  any edit — no cache headers, stale ES modules will load. Debug handle:
  `window.RYFARMS = { world, cam, audio, select(i), speed(mult), runSteps(n), goTo(i,j) }`.

---

# PRIORITY A — this session's work (`ba7f9db..HEAD`)

## A1. Cottage 7×7 footprint + plot-expansion gate (`ba7f9db`, farm.js/main.js)
- `HOUSE_TIERS[3].footprint` is now 7 (tipi 3 / yurt 5 / cottage 7). `World.HOUSE_FT` stays 5 (the
  reserve ANCHOR); `houseCentre` is a FIXED point (`plot.house + 2`); footprints expand symmetrically
  around it via `houseFt >> 1`.
  - **Assert:** for a level-3 plot, `houseFt` returns 7 and the 7×7 reserve (`houseCentre ± 3`) never
    escapes the plot rect or overlaps a neighbour plot / fence / well / structure. Try dense towns
    (seeds where plots pack tight) and confirm no cottage reserve collides.
  - `raiseBuilding` blocks only a 3×3 core (`off = (HOUSE_FT-3)>>1 = 1`) centred on `houseCentre` —
    verify a 7×7 cottage's blocking core still lines up under the sprite and the door
    (`houseDoor`, `houseCentre + (ft>>1)+1`) sits clear of it.
- New `World.COTTAGE_MIN_CELLS = 200` gate in `#maybeUpgradeHome`: a farmer who can AFFORD a cottage
  (`canBuild(3)`) but whose `plot.cells.size < 200` must set `wantExpand` and grow the plot FIRST —
  UNLESS `expansionInfo(p).state === 'blocked'` (terrain-boxed), in which case the cottage is allowed
  anyway so nobody deadlocks.
  - **Break it:** find a farmer who can afford the cottage, is under 200 cells, and is boxed in such
    that `expansionInfo` flips between `blocked` and non-blocked — does the cottage ever get stuck
    forever (never builds across 60+ days)? Does a farmer thrash between "expand" and "build"?
  - **Assert:** every cottage that DID rise either had `cells.size ≥ 200` at build time or was
    terrain-blocked. Instrument the `raiseBuilding(level=3)` call site.

## A2. Town Chronicle (`5a51099`, farm.js/main.js)
- `world.chronicle` (cap 240) records story beats via `addChronicle(kind, text, who, other, color)`.
  Beats: `found / build / town / peril / bond / rift / find / season / crime`. Stamped with in-sim
  `day/season/year` only. `addChronicle` sanitizes em/en-dashes → hyphen (bitmap font has no long dash).
  Fire-once sets: `_chronBonds`, `_chronRifts` (per pair-key).
  - **Assert determinism:** the chronicle contents (kinds, days, order) must be identical across two
    same-seed runs. It's part of sim state now.
  - **Break it:** can a bond beat and a rift beat both fire for the same pair and then flip-flop
    forever? (`_chronBonds`/`_chronRifts` should each fire once.) Can `addChronicle` be called with a
    null `who`/`other` and still render? Feed a farmer with no journal/relationships.
  - UI (`drawChronicle`, main.js): CHRONICLE top-bar button opens a scroll panel; with a farmer
    selected it filters to THAT farmer's saga. **Try:** open it with an empty chronicle (day 1),
    with a farmer who has zero personal beats, and scroll past both ends — any crash or clipping bug?
    Confirm clicking a beat selects that farmer.

## A3. Settlement as a social choice (`7c8669b`, farm.js)
- `#scoutCandidates(f, ...)` now scores each spot as `groundQuality + #socialEval(f, cx, cy).bias`
  (bias clamped to ±4). `#socialEval` sums the pull of every COMMITTED neighbour (reserved or sited):
  friends/trusted draw in, rivals/distrusted push away, lone wolves are crowd-averse, the gregarious
  welcome company. `#instinct(f, o)` gives founders (no history yet) an immediate read from `o`'s
  honesty + collaboration, so a low-honesty manipulator (Chaos) gets shunned. `#claimReason` leads
  with the social driver ("settling near X", "keeping my distance from X", "far from everyone").
  - **Assert:** a farmer ALWAYS finds a homestead — social bias is added to the score, never a hard
    filter, so `#scoutCandidates` must still return candidates even when every neighbour repels.
    Confirm no founder is left unsited after `ensureFounderVariety` + a few days of travel.
  - **Assert determinism:** placement depends on which neighbours are committed WHEN each farmer
    scouts (founders resolve in `#ventureOf` order). Two same-seed runs must place everyone identically.
  - **Sanity:** across seeds, does collaboration correlate with nearest-neighbour distance (loners far,
    sociable close)? Does an honest witness's later gossip actually shift a rival's rapport (see A5)?

## A4. Attention UI — day recap + follow-agent (`3ffed9f`, `c4adcc1`, `f6c9d0e`, main.js/farm.js)
- `world.dayRecap` is rebuilt each rollover from `world.chronicle` (beats of the day that ended) +
  the day's harvest delta (`harvestTotal - _dayHarvestStart`) + downed count. **Assert it's pure
  derived state** — it must never feed back into any sim decision (grep for reads of `dayRecap`
  outside the recap card). Determinism: `dayRecap.{day,harvest,downed,beats.length}` identical across
  same-seed runs. Confirm the harvest delta can't go negative and `_dayHarvestStart` tracks correctly
  across many days.
- Recap card (`drawDayRecap`, main.js): auto-fades ~7s real-time, click-to-dismiss, skipped at 20×.
  **Try:** does a new recap arriving while one is showing replace it cleanly? At 20× does it correctly
  NOT show but still advance `recapSeq` (so slowing down shows the NEXT day, not a stale one)?
- Follow (`followMode` + `followTarget`, decoupled from `selected`): F toggles; with nothing selected
  F jumps to `mostInterestingFarmer()` (fight/flee/downed/help/claim outrank routine); the sheet
  crosshair toggles it; ← / → cycle the cast (moving card + follow target together); **X closes the
  card but KEEPS following**; **Esc stops following AND closes card/panels**; a manual pan cancels
  follow. **Break it:** follow a farmer, then let them get downed/reset or otherwise leave
  `world.farmers` — does `followTarget` dangle or the camera NaN? (Guard: frame clears follow if the
  target isn't in `world.farmers`.) Cycle arrows with nobody selected but following — does it still
  cycle the follow target? Hold an arrow at the array ends (wrap-around)?

## A5. Gossip carries actionable reputation (`6b8d89d`, farm.js/main.js)
- The chat gossip aside now lands by the WARNER'S CREDIBILITY in the listener's eyes:
  `cred = other.opinionOf(this)*0.5 + (this.reputation-0.5) + (this.p.honesty-0.4)`. `cred > 0.12` ⇒
  the listener lowers opinion of the offender (bite scales with grudge severity × credibility, capped
  0.22); `cred < -0.15` ⇒ the smear backfires on the smearer. Reputation now also feeds `#socialEval`
  rapport (`+ (o.reputation-0.55)*0.6`), so an ill-reputed name is shunned as a neighbour.
  Chronicle: a `crime` beat when a thief is caught in the act; a one-time `name is mud in town` beat
  (`_mudFlag`) when reputation crosses ≤ 0.25.
  - **Assert clamps:** `reputation` stays in [0,1]; every `adjustOpinion` result stays in [-1,1] even
    after stacked gossip. The `mud` beat fires at most once per farmer.
  - **Break it / verify propagation:** force a persistent thief (`f.p.honesty = 0.08;
    f.poachCooldown = 0` each tick) and run 40 days. Confirm: reputation collapses, the `mud` beat
    fires, and DISTRUST reaches farmers who never witnessed the theft (via credible gossip) — not just
    direct victims. Then confirm a KNOWN LIAR badmouthing someone does NOT move opinions (and may
    backfire). Watch for a feedback loop where reputation + gossip drive everyone's opinion to the
    floor (town-wide -1 spiral).

## A6. Diverse crop mix — no more mono-culture (`30ea598`, dna.js/farm.js/main.js)
- `dna.js buildCropPalette(rand, signature, personality)` gives each farm 1–4 crops from `ALL_CROPS`
  (`['sunflower','carrot','grapes','pumpkin','pepper','wheat']`): signature + a curiosity-sized spread
  (diligence tightens it). `World.cropForField(owner, i, j)` picks from `sheet.crops` by a stable tile
  hash; the plant task + "SOWING X" thought use it.
  - **Assert determinism:** `sheet.crops` is a pure function of the seeded `rand`; `cropForField` is a
    pure function of `(seed, i, j)` — a tile keeps its crop across replantings. Two same-seed runs plant
    identical crop types on identical tiles.
  - **Break it:** `cropForField` with an empty/missing `sheet.crops` must fall back to `[sheet.crop]`
    (no divide-by-zero / undefined type). Confirm every planted `crop.type` is one of the 6 valid
    sprite types (no type a renderer can't draw). Confirm palette size honours 1–4 bounds for extreme
    curiosity/diligence rolls.

## A7. Timber yield + felling effort by stage (`97a419d`, farm.js)
- `TREE_WOOD = [1,3,5]` (sapling/young/mature) and `TREE_CHOPS = [1,3,5]` (chops to fell, hence
  exhaustion, proportionate to yield); `WOOD_STUMP = 3`, `STUMP_CHOPS = 3`. `#completeChop` uses a
  `rockWork` hit counter keyed by tile for BOTH trees (fell) and stumps (grub).
  - **Assert:** felling yields exactly 1/3/5 by stage and a stump 3; a tree takes 1/3/5 chops and a
    stump 3. The `rockWork` counter is deleted on completion (tree→stump reuses the same tile key —
    confirm the stump's grub starts fresh at 0, no carryover from the fell).
  - **Break it:** a farmer who runs out of energy (≤0.12) mid-fell drops out — does the partial
    `rockWork` persist correctly so resuming continues, and does an abandoned partial ever wedge the
    tile or leak counters? Determinism of the chop count across runs.

---

# PRIORITY B — earlier unreviewed batch (`599ba25..ba7f9db`), targeted sweep

Same rules (headless, determinism, repro-per-finding). These are older but never formally reviewed:

- **Dungeon Master / combat** (`c36c442`, `3673a3f`, `a10988d`, `9c0da33`, `dcddbcf`, `9ba87d7`):
  encounters spawn on farmers ≥16 tiles from home; fight/flee keys on a physical power gap (STR+CON,
  not farming level) + wariness; **downed = 25% harvest loss + 3-day reset, NOT death.** Break it:
  can HP go negative / a downed farmer act while `state==='downed'`? Can an encounter's `def` ever be
  malformed (`def.name`/`def.hp` undefined) and crash `#faceThreat`/`#spawnEncounter`? Does harvest
  ever go negative on the 25% docking? Are helpers/rescuers always cleaned up (`#endEncounter`)?
  Determinism across a 40-day run with frequent encounters.
- **Size tiers** (`9f19c1c`, `8fb5ca9`, `9774e81`): rocks/trees/bushes come in size tiers
  (`obstacleTier`), and clearing exhaustion + wood/ore yield scale with the sprite you SEE (no
  artificial scaling). Break it: does a founder actually avoid staking around a big boulder? Any tile
  where the drawn size and the gameplay size disagree?
- **Legibility layer** (`60ae6f7`, `e3157be`, `f4a33e1`, `f8f41a2`): settlement + fight/flee decisions
  voice their WHY; founders survey → reject a worse spot → choose. Break it: the reject-then-claim
  itinerary (`scoutList`) — can a founder get stuck mid-survey and never stake? Does a voiced reason
  ever reference a neighbour/foe that no longer exists?
- **Tree growth + apples + pacing** (`e0d2092`, `faa1c94`, `e2a7812`): trees grow sapling→young→mature
  (8d/12d); apple trees bear only late-summer→fall; crops sprout ~48h, ripen ~day 6. Break it:
  `treeStageAt` with `treePlanted` — does a regrown tree's stage ever go backwards or a founding-forest
  tree render a missing sprite? Is fruit-drop gated correctly by `isFruitSeason()`?
- **Misc** (`4172500` guardians at town L2/L4, `bf79f7d` winter foliage hidden, `e8c4394` sheep Lamb
  sprite, `a4d0258` crop rename, `4b60bee` no-roof-no-sleep, `7bcdff3` structure footprint clear):
  quick spot-checks — winter shows zero green; sheep use the Lamb sheet not the procedural fallback;
  crop rename is consistent (pepper/grapes) across dna/pixel/main.

---

## Deliverable
A short report. For each area (A1–A6, then B), PASS or a concrete FAIL with (seed, day, farmer/tile,
observed vs expected, smallest repro). **Rank by severity.** Prioritise, in order: (1) any determinism
divergence, (2) a cottage/expansion deadlock (A1), (3) a reputation/opinion clamp break or town-wide
-1 spiral (A5), (4) a follow-target dangle / camera NaN (A4), (5) a combat crash or negative-harvest
(B, DM). Do not commit fixes — surface findings first.
