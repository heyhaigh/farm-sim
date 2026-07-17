# Ry Farms — Independent Review Directive (round 5)

Review everything committed since your last pass. Your round-4 review looked at `1dd54ea` (the
infinite-world commit). This round covers the 8 commits ON TOP of it. HEAD is `bc12db8`.

```
cd ~/ry-farms
git log --oneline 1dd54ea..bc12db8
git diff 1dd54ea bc12db8 -- farm.js main.js dna.js api/ry-farms-chat.js
node --input-type=module --check < farm.js
node --input-type=module --check < main.js
node --input-type=module --check < dna.js
node --check api/ry-farms-chat.js
```

The 8 commits:
- `7ee4dc3` fix round-4 leaks (findPath/birds fog-gen, storage timing) + livestock/crop/tilled tuning
- `de047c0` single upgrading guardian statue + building hover tooltips + summer-night fireflies
- `420112d` personality variety: Chaos Ry (manipulator) + Mercurial Ry (moody) + resentment avoidance
- `20468e5` deepen resentment: physical recoil + social shunning
- `a9d1355` multiple scarecrows per plot
- `fc9b6fd` town gossip (overheard rumors) + sheet section
- `aa6776f` fewer/meaningful chats + reduced exhaustion
- `bc12db8` gossip persists + richer LLM chat payload

Your job is to **find where it breaks**, not confirm it works. Every finding needs a concrete repro
(seed, in-game day, farmer/plot/tile, observed vs expected, smallest reproduction). **Report only —
do NOT commit fixes.**

## How to run (headless is authoritative)
`import { World, DAY_LENGTH, NIGHT_LENGTH, CHUNK, T, PROD } from './farm.js'`; add 8 farmers via
`world.addFarmer({title, content})`; call `world.ensureFounderVariety()` right after (it guarantees +
NAMES the Chaos Ry / Mercurial Ry roles); tick at `dt=1/30`. **Gotchas:** monkey-patch `world.addLog`
BEFORE ticking (log caps at 80). Sick/sleeping/resting/sheltering farmers legitimately don't move. A
day is `DAY_LENGTH+NIGHT_LENGTH` (300+80). Winter is season 3 (~day 45). The world is INFINITE — never
assert an i/j bound. The LLM chat path is INERT headless (no `window`/endpoint), so scripted chat is
what runs; determinism must hold regardless. Write scripts under a scratch dir, never in the repo.

## Areas and invariants to attack

### 1. Round-4 fixes — verify they're truly closed (HIGH)
- **No chunk generation from fog** (`7ee4dc3`): `findPath` now treats unrevealed tiles as impassable
  via a `blk()` that checks `isRevealed` BEFORE `get()`; `#treesNear` (birds) has the same guard.
  Assert: over a 45+ day run, `world.chunks.size` grows ONLY with exploration (roughly tracks
  `exploredTiles`/revealRect), never unbounded (~+40/day was the bug). Call `findPath({i:55,j:55},
  {i:4000,j:4000})` on a fresh world and assert `chunks.size` is UNCHANGED. Confirm birds never
  march into fog. Confirm `nearestOpenTile` also never probes/generates fog.
- **Storage cap after a tick** (`7ee4dc3`): the clamp now runs at the END of `Farmer.tick`. Assert
  NO farmer ever ends a tick with `wood > storageCap().wood` or `ore > storageCap().ore`, sampled
  EVERY tick over 15+ days (this is the exact case round-4 caught — mining adds ore mid-tick).

### 2. Livestock / crop / tilled tuning (`7ee4dc3`)
- **Cow ~1/day, sheep→WOOL ~1/3days**: measure eggs/milk/wool ready-events per producer per day.
  Cow ≈ 1.0 (0.8–1.3), goat ≈ 0.33 (0.25–0.45). `FACILITY_YIELD_NAME.goat === 'wool'`. Chicken still
  ~1 egg/day. No producer exceeds ~1.5 ready-events/day; rooster (rate 0) never becomes ready.
- **Crops dry in ~1 day**: a crop watered to 1.0 under clear spring skies reaches ~0 in ~1 in-game
  day (≈340–400s), not the old ~0.2 day. Confirm crops still GROW (tended farms aren't withering en
  masse) — count withered/day.
- **Tilled decay (5 days)**: a TILLED tile with NO crop reverts to grass after 5 idle days. Attack
  the bookkeeping: `world.tilledAt` is stamped in `set()`, restarted on harvest, and a tile UNDER a
  growing crop must NEVER revert (the `cropAt` exemption). Assert: (a) an unplanted tilled tile
  reverts on day ~6; (b) a planted tile keeps its crop for 7+ days; (c) `tilledAt` stays bounded
  (plot tiles only — never the infinite plane); (d) `#decayTilled` doesn't mutate the map mid-iteration
  (it collects first). Determinism: no RNG in the decay path.

### 3. Single upgrading guardian statue (`de047c0`) — HIGH
The storm-tower chain is now ONE monument (`world.statue`) upgraded in place: a higher tier tears
down the previous tier's sprite + footprint before raising the new one (reusing the old anchor when
the bigger footprint fits, else fresh ground).
- **Invariant:** at NO point in a full multi-year run do two `statue*` structures coexist. Assert
  `world.structures.filter(s => s.type.startsWith('statue')).length <= 1` sampled continuously.
- The old footprint's tiles are returned to grass (no orphan `T.STRUCT`); the new footprint is
  exactly `size×size` solid + `pathBlocked`. `world.statue` always points at the live one.
- Effects SET (not stack): `lightningMult`/`rainBoost` equal the completed tier's values.
- `#statueFits` / `#findStructureSpot(size)` never overlap a plot / well / board / another structure
  (size-aware); no farmer ends up entombed under a 2×2/3×3 base.

### 4. Building hover tooltips (`de047c0`) — browser-only, reason + grep
`buildingUnder(mx,my)` screen-space hit-tests each building's DRAWN sprite box. Verify by review:
no crash when a farmer is homeless (level 0), a facility owner isn't found, or statue art hasn't
loaded (`imageLoaded` guard, `structSprites[type]` may be undefined → the `if (!sp) continue`).
Confirm the tooltip is gated off when hovering a panel (sheet/minimap/roster/board/top-bar) and only
draws over the world. No non-ASCII in tooltip strings (the 3×5 font has no middot/curly quote).

### 5. Fireflies (`de047c0`) — render-only
Summer-night ambience only. Confirm it's gated on `SUMMER && nightA>0.12 && weather not storm/blizzard`
and uses only `Math.random`/`performance.now` (render layer — must NOT touch sim state or determinism).

### 6. Personality: Chaos Ry + Mercurial Ry (`420112d`) — HIGH
New 5th trait `volatility` (TEMPER) in `dna.js` (`TRAIT_NAMES`, keywords, `personalityLabel` adds
Agent of Chaos / Mercurial / Moody). `mood` random-walks nightly (amplitude = volatility); `effCollab()`
= collaboration shifted by mood; help/sick-visit/coop-join now key off `effCollab`.
- **Guarantee:** `ensureFounderVariety()` ALWAYS yields ≥1 farmer with `honesty<0.2` (named "Chaos Ry",
  label "Agent of Chaos") and ≥1 with `volatility>0.72` ("Mercurial Ry", "Mercurial") — across many
  seeds. It uses NO rand (sorted picks) — assert deterministic.
- **Mood swings:** the mercurial's `mood` genuinely ranges wide over days (e.g. spans > 1.2) while an
  even-keeled bot barely moves; `effCollab` stays in [0,1].
- **Manipulator behaves:** Chaos Ry poaches (before its own fill work, ranging to neighbours),
  cries wolf (fake help posts), and distrust-gossip drops the listener's regard. Over 45 days assert
  poaches > 0 and at least one townsfolk resents them. Watch for: the poach loot search / `#pursuePoach`
  never crashing on an infinite map; cry-wolf not flooding (board dedups); `poachCooldown` stays ≥ 0.
- **Determinism** with all of the above (mood, gossip, opinions) in the digest.

### 7. Resentment → avoidance (`420112d`, `20468e5`) — HIGH
Grudge (opinion ≤ -0.35) drives shunning. Force a mutual grudge (`A.adjustOpinion(B,-0.7)` both ways)
and assert: A won't `joinCoop` B's plan; A won't `takeHelp` B's job AND B won't take A's (mutual);
A won't `negotiateWellAccess` at B's well; they cold-shoulder (no chat). Then a LONG organic run:
- **No thrash / no stuck:** the wander-recoil (`#dislikedNear`, in the `walk`-state when `path.then
  === 'wander'`) must ONLY interrupt aimless wandering, never a real errand, and must not livelock
  (cooldown-gated). Assert 0 farmers with non-finite position and every farmer still productive
  (`harvested > 0`); no freeze-watchdog spam.
- Confirm the recoil can't strand a farmer off their plot or on a blocked tile.

### 8. Multiple scarecrows (`a9d1355`)
A plot now raises up to `scarecrowCapFor(plot)` (~1 per 90 tiles, max 6), placing each at the centroid
of still-EXPOSED fields (`exposedScarecrowSpot`).
- Assert: NO plot ever exceeds its cap; a scarecrow is NEVER placed on a crop or on an existing
  `T.STRUCT`; coverage improves for big farms (most field tiles within 9 of some scarecrow). The
  `birdLosses` reset logic can't loop-build. Determinism.

### 9. Town gossip (`fc9b6fd`, `bc12db8`)
`farmer.gossip[]` records overheard rumors ("X warned against Y"), decays ×0.93/night (dropped below
0.2), capped at 16, shown in the sheet's TOWN GOSSIP section.
- **Conservation/bounds:** gossip list never exceeds 16; every kept entry has `strength > 0.2`; no
  entry references self (`from`/`about` never the holder). Determinism (recording is inside the
  rand-gated chat; decay is deterministic).
- Gossip is recorded in the LISTENER on a qualifying encounter (speaker holds a grudge < -0.2, target
  ≠ listener, listener not already resentful). Confirm it doesn't fire when the listener IS the target.

### 10. Chat frequency + exhaustion tuning (`aa6776f`) — behavioral, watch for regressions
Chats are now gated by a `wantToTalk` roll (trust `friendPull` + `infoValue`) with a long post-chat
cooldown; LABOR energy costs cut ~30%, REST/SLEEP recovery raised.
- **Farms still productive:** average `harvested` should be healthy (not collapsed) — the reduced
  exhaustion shouldn't have broken the work loop. Sickness from genuine overexertion (heavy chopping/
  mining while exhausted) must still be REACHABLE (not dead code).
- **Help board still flows:** non-resented farmers still take posted jobs (round-2 once had a "0 jobs
  taken" bug — confirm takes > 0 over 30 days with the new effCollab-gated `takeHelp`).
- The `+1 XP` for chatting a higher-level neighbour can't be farmed into runaway leveling (it's
  cooldown-gated) — sanity-check level growth is sane.

### 11. LLM chat payload (`bc12db8`) — reason + grep (inert headless)
`#chatProfile` now includes mood/temper/traits/level/tilesExplored/trusts/wary/rumorsHeard. Confirm
it can't throw (all fields are simple accessors that exist) and the api handler forwards arbitrary
context (no schema rejects new fields). The scripted fallback still returns valid lines. `tryLlmChat`
still degrades gracefully with no endpoint / on failure (`disabledUntil`, single in-flight, timeout).

### 12. Preserved invariants (the master checks)
- **Determinism:** same seed + same addFarmer inputs + `ensureFounderVariety()` + same dt → identical
  digest (positions, wood, ore, level, mood, opinions, gossip lengths, plot cells, chunks.size,
  statue tier, revealRect). Grep farm.js/dna.js for `Math.random`/`Date.now`/`new Date` — only
  sanctioned uses are audio, LLM request gating, the render layer (main.js fireflies/particles), and
  `performance.now()` in `addLog`. Any in sim state (farm.js/dna.js gen, mood, gossip, decay) is a bug.
- **Crop conservation** via `transferGood`: no duplication / negative produce; lifetime `harvested`
  never decremented by a transfer.
- **All prior-round fixes still hold** on top of these changes: winter never starts with an active
  storm; blizzards only in winter; land animals never end a tick on a blocked/unowned tile (WITH the
  grazing motion); livestock retire inside on stormy nights; `expandPlot` self-guards affordability;
  no stuck lightning bolt; frontier-annex + housing caps + L3 livestock gate intact.

## Deliverable
Per numbered area: PASS, or a concrete FAIL with repro. Prioritize (highest first): determinism
master check; chunk-generation / storage-cap round-4 regressions; single-statue invariant; resentment
thrash/stuck; multiple-scarecrow cap + placement; tilled-decay bookkeeping; and gossip bounds. Surface
findings; do not commit.
