# Codex Review #22 — Ry Farms: names, cross-town travelers, war doctrines, founding election

**Repo:** `/Users/ryanhaigh/ry-farms` (point Codex HERE — not Documents/ry-farm, not portfolio-workspace).
**Scope:** everything built/changed this session (commits since the "Orc landscape / speech" work). Focus your
depth on the **determinism-sensitive world↔sim plumbing** (systems 1–5); systems 6–8 are lighter display-tier checks.

## The two sacred doctrines (every finding is measured against these)
1. **DETERMINISM (the #1 invariant).** The town SIM consumes ONLY seeded rng (`world.rand`, per-farmer
   `this.rand`, `mulberry32(hashString(...))`) with stable, sorted iteration → same seed ⇒ byte-identical town,
   twice. NO `Date.now()` / `Math.random()` / `performance.now()` in sim code. The WORLD layer (`worldmap.js`,
   `save.js`, `main.js` off-sim helpers) MAY be non-deterministic, but ANYTHING that crosses into a town's sim
   must be a PURE seeded function of persisted state, consumed EXACTLY-ONCE via the serialized inbox.
   `tests/determinism.mjs` self-compares + pins baselines; `same-twice` must ALWAYS hold.
2. **COMPILE-DON'T-QUERY.** The LLM (`api/ry-farms-*`) + SuperMemory are NEVER read in the sim loop. All flavor
   is procedural or a display-only side-channel.

Report P0 (breaks determinism / exactly-once / crashes / save-corruption) and P1 (logic bug, migration break,
unbounded growth, doctrine violation) with: file:line, the concrete failing scenario, and a fix. Rank by severity.

---

## System 1 — Unique names  (`dna.js`, `farm.js`, `tests/determinism.mjs`)
**What changed:** farmers get a unique FIRST name within a town; "Ry" retired as the universal surname;
archetype-derived surnames; heirs inherit the forebear surname.
- `dna.js`: `assignFirst(pool, startIdx, used)` (advances on collision, numeral fallback on exhaustion, consumes
  NO rng — the caller passes ONE existing `rand()` draw as the start), `pickSurname(pool, seed)` (seed-hash, no
  rng). `growFarmer` name line, `orcify` (orc first-name de-dup, clan = surname), `growHeir` (inherit surname,
  de-dup first). Expanded `ARCHETYPES[].names`/`.surnames`, `ORC_FIRST`/`ORC_CLAN`.
- `farm.js`: `World._usedFirstNames` (per-town Set), passed through `addFarmer`; `fromSave` rebuilds it from the
  restored roster; `#renameStandout` (the 4 founder standouts keep their de-duped surname + update the used-set).

**Verify:**
- (a) **Per-town, not global.** Is the used-set reset per `World` and seeded ONLY by that town's own seed + its
  stable roster order? Could town-generation ORDER (multiple towns in one session) ever change a town's names?
  (Council's #1 naming concern.)
- (b) **Rng-stream stability.** Confirm `growFarmer`'s name assignment consumes EXACTLY ONE `rand()` (as the old
  single pick did) so crops/colors downstream are byte-identical. The claim is that the digest is UNCHANGED
  (names are display-only) — is that actually true, or did any `rand()` shift? (The baselines were NOT re-pinned
  for names — validate that was correct.)
- (c) **All creation paths covered:** `growFarmer`, `orcify`, `growHeir`, `fromSave`, `#renameStandout`. Any path
  that sets `sheet.name` and bypasses de-dup? Any place a pre-de-dup name was already embedded (chronicle,
  relationship, memory) BEFORE the final name was assigned?
- (d) **Exhaustion / tiny towns:** roster larger than a pool → numeral fallback deterministic + still unique?
  `assignFirst` with a 1-element pool? A town of 1?

## System 2 — Cross-town travelers & news  (`reconciliation.js`, `worldmap.js`, `farm.js`, `main.js`)
**The riskiest system. World→sim crossing.** rumor→traveler→(arrive|lost)→awareness/surprise→reconciliation, plus
news propagation to a third town.
- `reconciliation.js`: `seedTraveler({...})` PURE — decides origin/destination, `fate` (arrives|lost), `lostAt`,
  the arrival SIM-DAY, warning + bearing, from `(pairKey, ordinal, seeds)`. `seedNews`, `newsLine`, `journeyDays`,
  `TRAVELER` tuning.
- `worldmap.js` `detectEncounters`: a RUMOR-radius phase (wider than raid) seeds a traveler once per pair into
  `index.pairs[key]` and queues a `traveler` inbox event (carrier: `payload.type='warning'`) to the DESTINATION
  only (asymmetric). On a cross-faction encounter, a NEWS courier (`payload.type='news'`) goes to the nearest
  third town (`index.news`, capped 40). `WORLD_INDEX_VERSION = 3`. `met` pairs set `state:'met'`.
- `farm.js` `applyInbox`: a `traveler` event with `this.day < e.day` (arrivalDay) is LEFT UNAPPLIED (not
  marked applied) so it lands only on/after arrival; on arrival a WARNING primes `#mostCuriousFarmer()` via
  `hearTraveler()` (+0.12 curiosity + one belief), NEWS is chronicle-only.
- `main.js` `consumeInbox`: clears processed events EXCEPT a future-dated traveler (`e.day > w.day`), which
  lingers. `drawWorldMap` renders traveler + news markers (`performance.now()` pulse — display only).

**Verify (hard):**
- (a) **Arrival is sim-day, not wall-clock.** Confirm the arrival effect fires purely from `this.day >= e.day`
  and NOTHING keys off `performance.now()`/`Date.now()`/animation state. The council's #1 objection was that a
  wall-clock journey could reorder the inbox effect — is that fully closed?
- (b) **Exactly-once across the leave/clear seam.** `applyInbox` skips a future traveler WITHOUT adding its id to
  `_inboxApplied`, and `consumeInbox` retains it via `e.day > w.day`. Walk the seam: reload mid-journey, two
  tabs, a save that fails after `applyInbox`. Can a traveler be (i) consumed twice, (ii) dropped before arrival,
  (iii) applied then re-applied? Is the `hearTraveler` curiosity bump idempotent if the event somehow re-applies?
  (`travelerWarned` belief guards the belief — does it also guard the +0.12 bump? Check for double-bump.)
- (c) **`#mostCuriousFarmer` purity.** Pure seeded pick with an explicit tie-break (seed), matching the
  world-layer envoy selection? Any float-trait tie + iteration-order nondeterminism? Chronicle stamped
  `this.day` (sim day) not the event's `at:`?
- (d) **Determinism of the world-index generation.** `seedTraveler`/`seedNews` must be pure. Confirm no
  `Date.now()`/`Math.random()` in the traveler/news EVENT content (only allowed on encounter `ev.at`, which is
  never a decision input). `detectEncounters` produces byte-identical `pairs`/`news`/`inbox` twice for the same
  index. Scout origin-flip (System 3) — does it keep the `rand()` stream stable (the `roll` is always drawn)?
- (e) **Unbounded growth / GC.** `index.pairs` grows one entry per town-pair ever within rumor range and never
  shrinks (only flips to `state:'met'`). `index.news` is capped 40. A `knownTowns`/pair entry for a town that
  was wiped (`wipeTown`)? Any dangling references in the map render (`bySeed.get` guards)?
- (f) **Migration.** `WORLD_INDEX_VERSION` 2→3: `index.pairs` defaults to `{}`. A pre-v3 index with existing
  `encounters`/`ledgers` — do already-`met` pairs correctly SKIP the rumor scan (no re-introduction of towns
  that already fought)? No gate on raids was added (per Fable), so confirm existing encounters still resolve.

## System 3 — War doctrines v1  (`reconciliation.js`, `farm.js`, `worldmap.js`, `main.js`)
- `reconciliation.js`: `DOCTRINE_DEFS` (comitatus/strandhogg/greatMuster/palisade: `{commit,scouts,biteReduce}`),
  `doctrineDef(id)` (fallback comitatus). `seedTraveler` now takes `aScouts/bScouts` (silent=0 flips origin /
  both-silent forces `lost`; scouts=2 halves lose-odds).
- `farm.js`: `World.doctrine()` — pure fn of culture + martial(`#watchFitness`≥`#managerFitness`·1.05) + cohesion
  + size. `applyInbox` raid: `lost = round(harvestTotal * (e.commit ?? 0.2))`.
- `worldmap.js`: `computeLayout` carries `doctrine`; `detectEncounters` attaches `commit = raider.commit *
  (defender.biteReduce ?? 1)` to the `raided` event; feeds `scouts` to `seedTraveler`.
- `main.js` `townSummary`: bakes `doctrine: w.doctrine()`.

**Verify:**
- (a) **`?? 0.2` fallback.** A `raided` event from a pre-doctrine save (no `commit`) docks EXACTLY the old flat
  20% → byte-identical. Confirm `e.commit` of `0` (palisade never raids, but a `commit:0` could arise) isn't
  swallowed by `??` incorrectly (0 is a valid value; `?? 0.2` treats `undefined` only — is that the intent?).
- (b) **`doctrine()` off-sim.** It's called in `townSummary` (off the sim loop). Confirm it NEVER runs inside the
  seeded sim tick (so it can't affect the digest) — the baselines were NOT re-pinned; validate.
- (c) **Scout origin-flip determinism.** `seedTraveler` draws `originIsA` then may flip on scouts=0. The `roll`
  for fate is always drawn (comment says "keeps the rng stream stable"). Confirm the flip + `bothSilent` override
  don't skip/add an rng draw relative to the no-scout path in a way that desyncs `lostAt`.
- (d) Pre-founding towns (no Manager/Watch) → `doctrine()` returns the culture default without throwing
  (`managerFarmer()`/`watchFarmer()` null-safe)?

## System 4 — Founding election  (`farm.js`)
- `FOUNDING_VOTE_DAY = 10`; `roles.founded` (init false; serialize; `fromSave` defaults PRE-existing saves to
  `true`). `#updateCivic`: before `FOUNDING_VOTE_DAY` the town is ungoverned (`return`, `directive=null`); on/after,
  `#foundingElection()` runs once (reuses `holdElection` for Manager+Watch, seats Healer by fitness, grand beat),
  sets `founded=true`. Yearly winter `#electionCycle` unchanged.

**Verify:**
- (a) **Save migration.** A pre-`founded` save loads with `founded:true` → does NOT strip its existing roles or
  re-run the founding election. A NEW town starts `founded:false`.
- (b) **Exactly-once founding.** Can `#foundingElection` run twice (e.g., save/load exactly on day 10 before
  `founded` persisted)? Is `founded` set BEFORE any early-return so a re-entrant tick can't double-seat?
- (c) **Tiny town / no-quorum.** `holdElection` with <2 voters returns the (null) incumbent → no manager seated;
  does `#foundingElection` still set `founded=true` and not loop, and does the later vacancy auto-seat recover?
- (d) The 10 ungoverned days: anything that assumes a Manager exists (directive, approval, recall, theft trials)
  before day 10 — does it null-guard? (`#updateCivic` returns early, but other call sites?)

## System 5 — Sickness re-tune + baseline re-pins  (`farm.js`, `tests/determinism.mjs`)
- `#dailyHealthCheck`: homeless exposure softened — first 3 roofless nights free, ramp `+2/+4/+6` capped 6,
  risky threshold eased (`energy<0.3`, `sleepDebt>=4`). Baselines re-pinned TWICE (sickness, then founding vote).

**Verify:** the re-pins captured ONLY intended state changes (health tuning + role-seat timing), not a hidden
regression. `same-twice` holds. The digest covers creeds/beliefs/stats/positions — is anything the doctrines/
travelers touch (curiosity bump, doctrine) leaking into a single-town digest it shouldn't?

## Systems 6–8 — lighter (display/render tier)
- **6. Orc landscape** (`main.js` orc asset sets + `wildSpec` orc branch + `drawSilo`/`buildingArt`/`wellArt` +
  `bakeChunk` desert; `farm.js` `T.BONES`). Check: `T.BONES` is impassable (`blocked()`), in NO harvest/chop/mine
  target list, placed via positional `tileRand` (not the sequential stream) and culture-gated → human baselines
  unaffected. Any tile-type iteration (serialize, pathfinding, plot expansion) that mishandles `T.BONES=17`?
- **7. Orc speech** (`farm.js` `ORC_SPEECH` map + `#tr` + `#orcLine` in `say`/`think`; `dna.js` `SHORTS_ORC`).
  Check: pure display, equal-length pools, one rng draw per pick → no digest impact; the `#tr` template helper is
  only called inside the Farmer class (System note: one call site was in World `#scriptedChat`? confirm no
  private-method-out-of-class).
- **8. Misc fixes** — world-map hover-tooltip guard (`!worldMapOpen`), top-bar modal mutual-exclusion, memory
  portal multi-town + legacy `{farmers}` shim + `server.mjs` per-request `/api` hot-reload. Check the hot-reload
  doesn't leak/re-init shared state per request in a harmful way.

## Deliverable
A ranked list of P0/P1 findings (file:line, failing scenario, fix). If a whole system is clean, say so explicitly
so we know it was reviewed. Prioritize System 2 (travelers/news) determinism + exactly-once above all.
