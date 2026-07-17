# Codex Review #40 — Ry Farms: the LINEAGE / DEAD-TOWNS feature + the dispersal-voice fix

**Repo:** `/Users/ryanhaigh/ry-farms` — the FULL absolute path (NOT `~/Documents/ry-farm`, a stale unrelated
repo). Branch `main`, HEAD `5a4af71`, remote `github.com/heyhaigh/farm-sim` (already pushed). This work was
NOT covered by #38/#39 — it was built after and merits its own pass.

**Scope — TWO commits, only the lineage + dispersal parts of them:**
- `276f208` **Lineage: farmers hail from your REAL dead towns** (the whole commit).
- `5a4af71` — review ONLY its dispersal-voice part (`#disperseLine` + the `#seekHomestead` change); the
  duel-beat part of that commit was already reviewed in #39.

`git show 276f208` and `git show 5a4af71 -- farm.js` are the surface.

## What the feature is (the SuperMemory hackathon thesis, made literal)
The world index (IndexedDB `'world'` key, `save.js`) already remembers every town that ever stood. A NEW
town now grows its founders OUT OF those remembered towns: a founder's invented past life can be sited at a
town that truly existed in this world's history ("keeping the letters at Duskvale" naming a real prior town,
not flavour), two souls out of the same town recognise it when they befriend, and `sheet.origin` records the
provenance. It sprang from the player noticing a farmer reference a real former town.

## The determinism contract (the crux — verify it holds)
The ENTIRE safety argument is: **all origin logic lives in the LIVE boot path (`main.js spawnFarmer` /
`originFor`), gated on `world.rememberedTowns`, using PURE seed-hashes (`hashString`), never `world.rand`.**
The headless determinism harness (`tests/determinism.mjs`) builds founders via `w.addFarmer(pick(), 0)` —
it NEVER calls `spawnFarmer`/`originFor` and has NO world index, so `world.rememberedTowns` is empty there
and no `sheet.origin` is ever assigned. Therefore the baselines `850c5016 / 43db4bf8 / dbd713b3 / eda6bec6`
are UNCHANGED. CONFIRM all of this from the diffs + a harness run:
- `originFor` and the re-site draw NO `world.rand` (only `hashString` + a parsed seed). Verify.
- `generateMemory(seed, placeOverride)` (dna.js): the place roll is STILL consumed (`rolledPlace`) before
  the override is applied, so `life` and `yrs` are byte-identical whether or not a real town is supplied —
  a re-sited soul keeps the SAME trade + years, only the place changes. Verify the seed stream can't fork.
- `world.rememberedTowns` is empty on a first/headless world → the feature is fully dormant → nothing in the
  sim trajectory changes. Confirm the harness stays green with the four pinned hashes + same-twice.

## Priority checks
- **A. Origin assignment (`main.js originFor` + `spawnFarmer`).** (1) An HEIR uses `lineage.ofTownSeed` to
  find their forebear town in the roster (real descent); confirm the fallback when the forebear isn't in the
  roster (uses `lineage.ofTownName`) is sound. (2) A non-heir picks deterministically, keyed on
  `memory.id + ':' + mutation` — verify a THIN offline corpus (all founders reusing one `life:<seed>`
  memory with incrementing mutation, which the browser test hit) still yields VARIED origins and doesn't all
  collapse to one town. (3) The re-site only fires for `life:`-prefixed ids: `parseInt(id.slice(5))` —
  confirm a non-numeric or real-SuperMemory-doc id is guarded (`Number.isFinite`) so a real doc gets a
  `sheet.origin` but is NOT rewritten (its content stays its own).
- **B. Re-site correctness (`generateMemory` + growth).** The re-sited memory is generated BEFORE
  `addFarmer`, so the whole farmer (archetype, stats, creeds, lexicon) grows consistently from the real
  place. Confirm the place is not a stat-driving keyword (only `life.kw` drives archetype) so re-siting
  can't silently flip a farmer's class; note any lexicon/creed shift as expected, not a bug.
- **C. Persistence.** `world.rememberedTowns` is serialized + restored (farm.js). `sheet.origin` rides the
  save because farmers serialize `sheet` whole. Confirm a save/reload round-trips both, and that a RESUMED
  town does NOT re-derive `rememberedTowns` from a since-changed index (it must keep the roster it founded
  with — the origins are baked). Verify the boot only SETS `rememberedTowns` in the founding branch, never
  on resume.
- **D. Index read.** `world.rememberedTowns` is built at boot from `worldMapIdx.towns` (every OTHER town,
  filtered to those with a name, sorted by seed for index-order independence). Confirm best-effort (a
  missing/failed index → empty roster → feature dormant, no throw) and that the current town excludes
  itself.
- **E. Shared-origin bond (farm.js friendship stir).** When two befriending farmers share
  `origin.seed`, a distinct chronicle line + a spoken greeting fire (once per pair, via the existing
  `_chronBonds` guard). Confirm no null-deref when either origin is absent, and that it's display-only.
- **F. Dispersal voice (`#disperseLine` + `#seekHomestead`).** The day-1 dispersal used to have every
  founder `think('SCOUTING FOR GOOD GROUND TO SETTLE')` in unison. Now each thinks `#disperseLine()` (a
  per-seed, personality- and origin-flavoured pick; a fraction reach back to their remembered town).
  **Determinism note to verify:** `think()` DRAWS `this.rand()` (the `thoughtBubbleTimer` reset), so the
  fix deliberately keeps the SAME every-tick `think()` call pattern and only varies the TEXT (`#disperseLine`
  is pure `hashString`, no rand) — so the rng trajectory is untouched and the harness baselines hold.
  Confirm `#disperseLine` draws no rand and the call cadence is unchanged from the original.
- **G. Harnesses.** `node tests/determinism.mjs` (four pinned hashes + same-twice), `node
  tests/raid-adversarial.mjs`, `node --check` on farm.js/main.js/dna.js.

Report ranked findings (P0 = determinism/persistence break; P1 = fix; P2 = note) with file:line + repro +
fix. A clean pass is a valid outcome — say so plainly. Note explicitly whether the determinism contract
(live-path-only, no `world.rand`, harness-dormant) genuinely holds, since the whole feature rests on it.
