# Ry Farms — Independent Review Directive (round 11)

Review everything committed since your last pass. Round 10 reviewed up to `34c5740` (and its 3
findings were fixed in `edea917`, in scope below). This round covers the **10 commits** on top of it.
HEAD is `becd44c`.

```bash
cd ~/ry-farms
git log --oneline 34c5740..HEAD
git diff 34c5740 HEAD -- farm.js dna.js main.js
node --input-type=module --check < farm.js
node --input-type=module --check < main.js
```

Your job is to **find where it breaks**, not to confirm it works. Every finding needs a concrete
repro (seed, in-game day, farmer/plot/tile, observed vs expected, smallest reproduction).
**Report only — do NOT commit fixes.**

This round is the council-driven "make the systems express the agents" pass: a LEGIBILITY layer
(mostly render/UI in main.js) plus new SIM behaviour (#86 failures, #87 theft teeth, #84 town
character, #85 legends) and the round-10 fixes. Split:
- **Priority A** — the SIM behaviour + the sim hooks inside the legibility commits. Deepest review.
- **Priority B** — the render/UI legibility (B1/B2/B4/B3/B5, monument sprite): confirm it's pure-derived
  and never feeds the sim; light determinism + crash sweep.

## How to run (headless is authoritative)

```js
import { World, DAY_LENGTH, NIGHT_LENGTH, T, ALL_CROPS } from './farm.js';
const w = new World(20260708);
const mems = [ /* 8x { id, title, summary } */ ];
for (let k = 0; k < 8; k++) w.addFarmer(mems[k], (k / mems.length) | 0);
w.ensureFounderVariety();
const dt = 1/30;
for (let s = 0; s < (DAY_LENGTH+NIGHT_LENGTH)*80/dt; s++) w.tick(dt);
```

- **Determinism is load-bearing.** Same seed + same addFarmer inputs + same dt ⇒ byte-identical state.
  Every NEW sim field this round is dt-decremented, seeded, or a daily average — `f.emote`/`f.emoteT`,
  `f.carryTrophy`, `f._wasHurt`, the recovery beat, `huntTimer` (competitiveness-scaled), poach remorse,
  volatile escalation, the barter distrust skip, the theft "word travels" spread, `world.townCollab/
  townCompete/townVolatile` (recomputed each rollover), `world.monuments`. Build two same-seed worlds,
  tick both, diff a digest of `{positions, levels, hp, reputation, opinions, bonds, gossip, chronicle,
  goods, cropStock, prey, monuments, townCollab}`. Any divergence is a P0. The MILD default crew rarely
  triggers #86/#87/#85 — FORCE the extremes: `f.p.honesty = 0.08` (persistent thief) and `f.p.volatility
  = 0.9` + seeded mutual dislike (blow-ups), and drive frequent foe encounters (monuments). Re-run the
  digest with those forced and confirm it STILL matches across two identical forced runs.
- `Math.random`/`Date.now`/`new Date` in **sim** (farm.js/dna.js) = bug. main.js render may use
  `performance.now()` (wound-bar/emote/intent/trophy bobs, the B4 drama cue, monument/tree draws) — display only.

---

# PRIORITY A — new sim behaviour

## A1. Round-10 fixes held (`edea917`)
- **Barter fairness:** `#completeBarter` swaps a symmetric `n = min(3, my give stock, their get stock)`.
  Break it: a partner whose stock drops to 1 en route → 1-for-1 (or aborts at n<=0), never asymmetric;
  the safety branch returns any excess. Assert goods CONSERVATION across a barter (town totals invariant).
- **Crop-stock spend:** `spendCropStock` runs wherever the produce wallet is debited (transferGood 'crops'
  + #spendGood 'crops'). Confirm the by-type inventory can't exceed current holdings after trades/
  donations, drains largest-type-first deterministically, never negative. Known asymmetry: crops RECEIVED
  via trade land in `produce` (untyped) not `cropStock` — verify that's the only discrepancy and can't go
  negative.
- **fishedAt pruning:** entries older than FISH_COOLDOWN drop at the day rollover. Confirm bounded over 80
  days and pruning never removes a still-active cooldown.

## A2. Personality-textured failures (`42bb2a1`)
- **Hunt persistence:** `huntTimer = 6 + competitiveness*8` at start; after a miss capped to
  `2 + competitiveness*5`. Assert low-competitiveness bots give up sooner than high, and neither chases
  unboundedly (huntTimer + energy still terminate 'hunt').
- **Poach remorse** (`#completePoach`): a poacher with `rand < honesty*1.4` gives the crop back —
  `victim.produce += 1`, thief `cropStock[type].stolen -= 1`, `harvested -= 1`, `harvestTotal -= 1`,
  `carryCrop = null`, opinion/reputation partly restored, a 'bond' beat. **Break it hard:** can it
  DOUBLE-refund or create/destroy a crop (check `harvestTotal` + town crop totals across many remorse
  events — the crop is world-deleted on steal, then materialised as victim produce: conserved)? Can
  `cropStock[type]`/`harvested`/`harvestTotal` go NEGATIVE with odd state (carryCrop set but cropStock
  entry missing)? Only fires for crop loot — confirm producer-loot theft is unaffected.
- **Volatile escalation:** on a dislike-recoil, `volatility > 0.66` adds a sharper grudge + a 20% public
  blow-up (mutual opinion hit + 'rift' beat). Assert opinions stay clamped [-1,1] after stacked blow-ups;
  no town-wide -1 spiral; the 20% roll is seeded.

## A3. Theft social teeth (`8576059`)
- **Word travels:** a WITNESSED theft drops opinion (-0.12) + files a rumor for every farmer within 10
  tiles. Assert clamps hold; the loop skips self/witness/victim/downed; stable iteration order. Break it:
  a dense plaza theft hitting many onlookers — any unbounded drop or a -1 spiral over 60 days with a
  persistent thief?
- **Barter refuses distrust:** `#findBarter` skips a partner where either side's opinion <= -0.2. Confirm
  it can't deadlock barter in a low-trust town (barter just doesn't happen — fine) and correctly freezes
  out a thief. Determinism of the pick with the new skip.

## A4. Town identity affects behaviour (`a0dcd8a`, #84)
- `world.townCollab/townCompete/townVolatile` = daily averages of the settlers' traits
  (`#recomputeTownTraits` at the rollover). `effCollab()` gains `+((townCollab-0.5)*0.3)`, and the
  behind-the-leader grind bar shifts by `(townCompete-0.5)*0.4`. `townCharacter()` returns a label for
  the silo tooltip.
  - **Assert determinism:** the averages are pure functions of the (deterministic) trait set; behaviour
    that reads them stays identical across same-seed runs. Confirm `townCollab` defaults sanely (0.5)
    before the first rollover and `#recomputeTownTraits` handles an empty/one-farmer town (no NaN /
    div-by-zero).
  - **Assert clamps:** `effCollab()` still clamps to [0,1] after the nudge (so a hyper-collaborative town
    can't push it >1 or a loner town <0 in a way that breaks downstream `< 0.2` gates).
  - **Sanity / no runaway:** the nudge reads the AVERAGE, which each farmer also feeds — confirm there's
    no feedback loop (town character shifting behaviour that then shifts the trait average). Traits are
    fixed per farmer, so the average should be stable day-to-day barring births/deaths; verify it doesn't
    drift. Forced collaborative vs loner crews should diverge sharply in help/barter (expected), not
    oscillate.

## A5. Legends & monuments (`becd44c`, #85)
- Felling a FOE (`e.def.kind === 'foe'`) in `#defeatThreat` pushes to `world.monuments`
  (`{i,j,heroSeed,hero,foe,day,party}`, capped 40), grants party XP, reveals the tile, and adds a
  'legend' chronicle beat.
  - **Assert determinism:** monuments are pushed at a seeded combat outcome with in-sim data only (no
    real-time) — identical list across same-seed runs. Include `monuments` in the digest.
  - **Break it:** can a monument spawn on a blocked/occupied tile (it uses the hero's rounded pos — does
    it ever overlap a house/well/another monument, and does that matter for the hover hitbox)? Is the cap
    (40) enforced (a 200-day war-torn run)? Does the 'legend' beat ever fire for a BEAST (should be foes
    only)? Confirm `heroSeed` always resolves to a real farmer for the hover.

---

# PRIORITY B — legibility render/UI + monument sprite, sweep

Pure-derived display; concern is (a) never mutates sim state, (b) no crash/NaN, (c) determinism of any
sim FIELD it introduced (covered in A). Spot-check:
- **B1 wound bar + limp** (`ef3e956`): reads `f.hp/f.maxHp` only. `maxHp === 0` guard? Shadow stays put
  under the limp? Hidden while asleep/fighting.
- **B2 intent icons** (`18ea72b`): read-only off f.state/huntTarget/barterDeal/helpTask.
- **B4 witnessable drama** (`4c47050`): spotlight diffs `world.chronicle.length` each frame — no sim
  write, handles the 240 cap without mis-indexing, edge-cue math never NaNs at screen centre. The
  `#resolveHunt` hunt chronicle beat IS sim state (digest it).
- **B3 emotes / B5 trophy+recovery / card "NOW:"** (`1bd2c7d`, `909fffb`): timers are sim (A-reviewed).
  `currentStatus()` never throws (missing partner / null thought); recovery beat armed only after <=40%.
- **#85 monument sprite + hover** (`becd44c`, main.js `drawMonument` + `buildingUnder`): pure render;
  confirm the hover hitbox lines up with the drawn obelisk and doesn't swallow clicks meant for a farmer.

---

## Deliverable
A short report. For each area (A1–A5, then B), PASS or a concrete FAIL with (seed, day, farmer/tile,
observed vs expected, smallest repro). **Rank by severity**, in order: (1) any determinism divergence in
the new sim fields, (2) a crop/goods conservation break or negative stock in poach-remorse (A2) or barter
(A1), (3) an opinion/reputation clamp break or town-wide -1 spiral from word-travels / volatile
escalation (A2/A3), (4) an effCollab clamp break or feedback loop in town character (A4), (5) a monument
on a bad tile / cap or beast/foe mixup (A5), (6) a render NaN/crash (B). Do not commit fixes — surface
findings first.
