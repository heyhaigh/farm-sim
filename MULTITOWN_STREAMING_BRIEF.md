# Ry Farms — Multi-Town Streaming: design brief for council + fable review

---
## REVIEW OUTCOME (2026-07-15) — council (3) + fable. UNANIMOUS: build it, but in this order.
**Verdicts:** determinism-architect GO-WITH-CHANGES · gameplay GO-WITH-CHANGES · scope-skeptic PROCEED-WITH-GUARDRAILS · fable ONLY-IF (seam = a stage for witnessed drama, not traversal).

**The pivotal finding (determinism architect):** the world is ALREADY infinite and terrain past the founding valley
is pure position-hash noise (`farm.js:741-745`, never `world.rand`, order-independent). So there is **no coordinate
wall at the seam** and the biome blend needs zero rng — this defuses the scope-skeptic's #1 fear (a GRID/CENTER
refactor). Two `World`s tick back-to-back WITHOUT interleaving (determinism is a same-`World` property); the ONLY
real risk is a `this.rand()` decision reading the NEIGHBOR's live entities → so the projected neighbor must live
OUTSIDE the `World` instance (guarded like the LLM side-channel), and the only cross-seam coupling is the inbox.

**Agreed architecture:** one town live at a time (never dual-tick); neighbor = render-only projection of its saved
edge; **pair-hash for the static seam GROUND, inbox-mirror (egress-watermark, enqueue-to-B-before-remove-from-A) for
AGENTS**; pure integer per-pair seam offset from `townPos` bearing quantized to the 8 compass dirs (same as raids).

**Agreed phasing (revised from the brief's):**
- **P0 — FIX TOWN PLACEMENT FIRST (precondition, cheap).** `foundNewTown` picks a RANDOM seed → `townPos` hashes it
  anywhere → a founded orc town lands nowhere near you → **no raid, no seam, ever**. Rejection-sample the seed so a
  created town lands within reach-SOON distance of an anchor (or "found by placement": click a spot, sample a seed
  that hashes near it). Without this, streaming has nothing to stream to. UI-only, no determinism impact.
- **P1 — "THE RAID SEAM" (render-only, zero re-pin).** NOT the static backdrop (that's wallpaper). When a raid is
  inbound (`pendingRaid`/`raidEvent`), render the orc neighbor's biome WEDGE in the threat direction (`pr.dir`) and
  stage the mustering warband ON it during RAID_LEAD, then the EXISTING approach phase (`#stageRaidCinematic`) walks
  them across into the muster line. Reuses #131 (telegraph) + #108 (live warband) verbatim. Delivers the payoff
  moment ("the tell made flesh") in milestone 1. Plus fable's theater: the lost-traveler marker in the strip.
- **P2 — cursor-only crossing.** Camera crosses; the live `World` swaps A→B via `loadTown(B.seed)`; NO farmers
  migrate. Proves coordinate continuity + the save-swap with zero handoff complexity.
- **P3 — entity migration + parley-on-neutral-ground + "follow the raid home".** The inbox-mirror hand-off. **GATE
  on fable's Scene 4** (following a raid home to see your stolen grain in their storehouse) — the ONE moment that
  requires crossing. If crossing doesn't deliver that, it's a corridor; don't build it.
- **P2.5 v1 DESIGN (2026-07-16, ready to build — the WAR PARTY slice).** Data gap confirmed: worldmap.js
  queues `'raided'` to the VICTIM only; the aggressor's raid resolves into nothing. Build order:
  (1) worldmap.js: on outcome==='raid', ALSO `queueInbox(orc.seed, { kind:'raidReturn', pairKey, ordinal,
  day, target: human.name, commit })` — exactly-once ids as today. (2) farm.js applyInbox 'raidReturn'
  branch: dormant = apply synchronously (spoils `harvestTotal += round(commit*90)` + grand chronicle "the
  warband came home from {target} heavy with spoils"); live = stage `world.pendingSortie` (rides the save,
  monotonic `returnAt` deadline like #131's pendingRaid — authoritative apply at deadline watched or
  dormant, so no divergence). (3) The WITNESSED arc while pendingSortie: 3-4 seeded hale farmers get a
  'sortie' state — muster at the frontier in the seeded bearing, march out past the fog edge (hidden like
  isIndoors while "gone"), marquee "A WAR PARTY RIDES ON {TARGET}", then walk back in at returnAt, spoils +
  chronicle land at the silo. Party losses: seeded 'sortie:' hash → 0-1 come home hurt (chronicle color, no
  downing in v1). (4) Booth row 3: STAGE A WAR PARTY (rehearsal-flagged pendingSortie, zero record). (5)
  Search party + revolt = later rows (travelers already exist; revolt is internal-muster stagecraft).
  Harness: raid-adversarial probe for raidReturn exactly-once + dormant/watched equivalence; expect a
  determinism re-pin ONLY if the harness ever runs cross-town raids (it doesn't — same as #131).
- **P2.5 — OUTBOUND EXPEDITIONS (added 2026-07-16, user).** The symmetric gap: the world layer already resolves
  raids in BOTH directions, but only the INBOUND half is observable (telegraph → seam → muster → defense). When the
  town you're watching is the AGGRESSOR, nothing shows — the raid resolves invisibly in the inbox. Every outbound
  world-layer act needs its witnessed arc: **war party** (muster at the frontier → march out through the seam →
  town holds its breath → return with loot/wounds/nothing, chronicled honestly), **search party** (a lost traveler /
  missing farmer sends a party out the same way), and **revolt/unrest** as an internally-visible moment (a faction
  musters against the Manager, not at the seam). Reuses the P1 stagecraft verbatim (seam wedge in the OUTBOUND
  bearing, muster figures, marquee) — the seam becomes a two-way door. Slots after P2 (cursor-cross makes "follow
  them out" meaningful) and feeds P3's follow-the-raid-home. Render/telegraph layer first (zero re-pin), any
  sim-side muster behavior seeded like #131's.

**KILL CRITERION (unanimous):** any determinism baseline re-pin during a render-only phase = the seam LEAKED into the
sim → stop and ship the fallback (painted seam + existing raids). Fallback delivers ~80% of the felt value.
---



**Status:** direction chosen (Option **B**, true streaming — not a transition screen). This brief is for a **council
pass + a fable sub-agent** to pressure-test the architecture and return a phased plan + the hard-decision calls.
**Author's stance:** committed to B. Do NOT re-litigate B-vs-A; assume streaming is the goal and solve *how*.

## The vision (from the user)
The world map is proximity-based: towns sit in a shared coordinate space and their influence **reaches** overlap.
The user wants that proximity to become *playable* — walk your cursor from the edge of one town **into** a neighbour
when they're close enough, with the ground **transitioning** from a human town's green grass to an orc town's
desert wasteland at the seam. Different colonies, real crossover, a world that feels continuous rather than a set of
isolated instances. Cross-town orc **raids** (already modelled) should land meaningfully on the town you're playing,
now that the watch/raid vertical exists to support them.

## What ALREADY EXISTS (the substrate — build on it, don't rebuild)
- **Spatial world model** (`worldmap.js`): every town has a fixed world position (`townPos(seed)` on a 1000×640
  plane), a growing **reach** radius (`townReach`), and towns **meet** when reaches overlap. Proximity is real.
- **Cross-town encounters + raids** end-to-end: `detectEncounters` → `resolveEncounter` (raid / parley / betrayal) →
  per-town **inbox** consumed deterministically at load/dawn, plus a **live** raid path (`#108`) that stages a
  visible warband on the watched town. Travelers/rumor/news couriers already animate between towns.
- **Both biomes are built**: `world.culture === 'orc'` already renders the *entire* playable map as a desert
  wasteland (ground decals, fungal/dead trees, magma rock, orc well/totem, orc sprites, "UNDER SIEGE").
- **Per-town saves + a world index** (`save.js`): each town is its own IndexedDB save (seed-keyed); the world index
  is the shared cross-town layer (towns, pairs, ledgers, inbox, encounters).
- **Visit-by-reload + found-by-culture** (new, `83d9082`): you can jump to another town (full reload to its seed)
  and now **found** a human or orc town from the world map. So orc neighbours can finally exist to stream to.
- **Determinism doctrine**: each town's sim consumes ONLY seeded rng (`world.rand`, per-farmer `this.rand`) + pure
  position hashes with stable, sorted iteration. Same seed ⇒ byte-identical, twice (`tests/determinism.mjs`). The
  LLM + SuperMemory + world index are display/persistence side-channels the sim never reads in its loop.

## The core problem
Today the runtime is **one `World` instance per town**, loaded in isolation, on a **local** grid (a 56×56-ish plane
around a fixed `CENTER`, seasons/terrain/entities all local). "Visiting" is a hard reload to another seed's save.
**Streaming** means: when two towns are adjacent, both are simultaneously live (or the neighbour's border region is),
sharing a **seam** the player can walk across, with the terrain blending grass→desert — while determinism and the
per-town save model survive.

## The hard questions the review must answer (ranked)
1. **Determinism across a live seam.** Two towns = two independent seeded rng streams + two `this.time`/`clock`. If a
   farmer walks across the seam, does it become the neighbour's entity (whose rng, whose save)? Can two live sims
   run in the same tick without their draws interleaving non-reproducibly? Options to weigh: (a) only ONE town is
   fully live; the neighbour's seam strip is a *shallow* render-only projection (its saved edge tiles/entities drawn
   but not ticked) until you cross, then ownership flips; (b) a dedicated **seam/borderland** region owned by
   neither town's rng, generated by a pure hash of the town-pair; (c) both fully live with a strict, ordered,
   partitioned tick. Recommend (a) or (b) — full dual-live (c) likely breaks the doctrine.
2. **Save-boundary ownership.** Each town is a seed-keyed save. Who owns the seam tiles + any entity standing on
   them? What happens to a farmer mid-seam at autosave/quit? Propose the ownership rule + the crossing hand-off
   (entity serialized out of town A's save, into town B's, exactly once — mirror the inbox exactly-once pattern).
3. **Coordinate space.** Each town's grid is local (CENTER-relative). Streaming needs a world→local mapping so two
   towns' grids abut at the seam. `townPos` gives world coords for the *map*; the *playable* grids need a shared
   frame + a seam offset derived from the pair's relative world positions (direction of approach).
4. **The biome seam.** Grass→cracked-earth→sand gradient across the boundary: terrain generation + art. Is it a
   fixed-width designed strip, or a procedural blend weighted by distance to each town centre? How does it read
   under the CRT shader? (Both biomes' tiles exist; the *transition* tiles are the net-new art.)
5. **Performance.** Two live sims (or one + a projected strip) + double terrain + more drawables + the seam. The sim
   already caps `steps < 800`/tick and pre-renders terrain to an offscreen canvas — does the seam fit that budget?
6. **Scope / MVP phasing.** What is the *smallest* shippable slice that delivers the fantasy? Candidate: **Phase 1 —**
   render the adjacent town's saved edge as a static, un-ticked backdrop past a seam you can walk up to but not
   cross (proves the visual + the biome blend, zero determinism risk). **Phase 2 —** allow crossing with an
   ownership hand-off (one town live at a time; crossing flips which is live). **Phase 3 —** live raids across the
   seam (an orc neighbour's warband physically crosses into your town). Reviewers: challenge/replace this phasing.

## What good output looks like
- A recommended answer to Q1 + Q2 (the determinism + save-ownership model) — this gates everything.
- A concrete Phase-1 MVP definition (files touched, the seam data model, the biome-blend approach) small enough to
  build and verify against `tests/determinism.mjs` without a re-pin (Phase 1 should be render-only → no sim change).
- A flagged list of everything that would force a determinism re-pin, and how to keep the doctrine intact.
- The fable sub-agent: assess whether streaming *earns its complexity* — does crossing a seam into a desert warband's
  town create a materially richer game than visit-by-reload, or is the juice not worth the architectural squeeze?
  Be adversarial about scope.

## Non-negotiables (constraints the design must respect)
- Determinism same-twice MUST hold; a legitimate sim change re-pins baselines, an accidental one is a bug.
- Compile-don't-query: the sim loop never reads the LLM/SuperMemory/world-index side-channels.
- Per-town saves stay the unit of persistence (don't collapse the world into one mega-save).
- The existing cross-town raid/inbox/traveler machinery is the spine — extend it, don't replace it.
