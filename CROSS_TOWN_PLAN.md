# Ry Farms — Unique Names + Cross-Town Awareness ("the whisper in the wind") — v2

v2 rewrite after a 4-model council review + a Fable taste review. Council verdict on v1: unanimous "not fit
for implementation" — all four flagged (a) wall-clock arrival breaking determinism, (b) a second overlapping
"towns are near" system, (c) save migration, (d) belief mislabeled as narrative, (e) global name-dedup Set
breaking per-town reproducibility, (f) traveler-death deadlock. Fable verdict: "ship with one structural
amendment" (traveler death + surprise-contact fallback) and supplied the elegant resolutions folded in below.
Every council objection is answered here or explicitly deferred.

---

## Feature 1 — Every character has a unique name

### Problem
Humans are `${arch.names[rand]} Ry` (6 archetypes × 5 first names = 30, surname always "Ry"). Orcs are
`ORC_FIRST(16) × ORC_CLAN(10)` but the roster shows the FIRST name. Small pools + skewed archetype mix →
constant within-town collisions ("Echo Ry" ×3, "Grok" ×3), which read as bugs on the multi-town chart.

### Decisions (from review)
- **De-dup PER TOWN, seeded from that town's own seed + its stable roster order — never a global cross-town
  Set** (council A/B/C/D: a world-level Set makes town-generation *order* change names, destroying per-town
  reproducibility). Cross-town first-name repetition *with different surnames* is fine lore, not confusion
  (Fable Q2) — no global registry.
- **Surnames are memory/archetype-derived, compiled like creeds — NOT a flat fantasy list** (Fable rec 4:
  the soul is the voice — a designer's `Kerning/Bezier`, a builder's `Girder/Hex`; a builder-family surname
  should read forge-ish). "Ry" is **retired as the universal surname** (user) but **preserved as the founding
  lineage's surname / origin town name** so the "everyone is a fragment of one person" origin stays legible.
- **Heirs inherit the forebear's SURNAME, de-dup only the FIRST name** (Fable Q3): surname becomes the
  generational thread the memory graph can render.
- **Names finalized at BIRTH, before any content references them** (council C): dedup happens inside the
  grow path so chronicles/relationships/memories never embed a pre-dedup name.
- **Every creation path participates** (council C): `growFarmer`, `growHeir`, and `orcify` all route through
  one `assignName(pool, usedFirstNames, seed)` helper; save-hydration keeps stored names verbatim (already
  unique) and rebuilds the used-set.

### Approach
1. Expand pools: each archetype 5 → ~18 first names; add a per-archetype **surname pool** (~12 each);
   `ORC_FIRST` 16 → ~40, keep `ORC_CLAN` as the orc "surname/lineage".
2. `assignName(firstPool, used, seed)`: pick `firstPool[seed % len]`; if taken, advance `(seed+k) % len`
   deterministically until unused; the town passes its accumulating `used` Set (built in stable roster order,
   seeded only by town+farmer seeds — reproducible for a given town regardless of *other* towns).
3. Re-pin `tests/determinism.mjs` baselines (names change; still deterministic). Add a **targeted invariant
   test** (council C): renaming changes only `sheet.name`/`shortName`, never ids/seeds/memory-keys/decisions.

### Deferred / won't-do
- Global cross-town uniqueness (violates town independence for no chart gain — two Echos with different
  surnames is good lore).

---

## Feature 2 — Cross-town awareness: the weary traveler

### The arc (soul, from Fable)
`unknown → rumored → traveler en route → aware → encountering(raid|parley) → reconciliation`, with a second
ending: **the warning that didn't arrive**. A traveler is the first, usually-peaceful contact; but its fate
is sealed the moment it sets out, and if it dies (or the towns collide before it lands) the first meeting is
**surprise contact** — "they came upon each other without warning." Two real endings = the frontier stays
surprising, not a loading bar. The chronicle records which one you got.

### ONE pair-state machine (resolves council #2 + Q9; Fable rec 2)
NO second radius subsystem. Extend the existing single `detectEncounters` scan into a state machine on the
**pair record** (in the world index, keyed on the faction-lineage `pairKey` already used by the ledger):

    unknown → rumored      when pair enters the (wider) RUMOR radius
    rumored → enRoute       a traveler event is seeded (origin, destination, fate, arrivalDay all decided NOW)
    enRoute → aware         the destination consumes the traveler inbox event on/after arrivalDay
    (any) → encountering    when pair enters the (tighter) RAID radius:
                              • if destination already `aware`  → normal raid/parley (existing path)
                              • else                            → SURPRISE CONTACT (first-meeting variant)

One loop, two radii thresholds, one durable record. `met`/ledger stay the authority for "have they clashed."

### Determinism (resolves the #1 council objection; Fable Q8 + doctrine flags)
- **Arrival is a sim-DAY computed UPFRONT**, not wall-clock. At `rumored→enRoute`, a pure fn
  `seedTraveler(pairKey, ordinal, seedA, seedB)` returns `{ origin, destination, fate:'arrives'|'lost',
  arrivalDay, warning }`. `arrivalDay = discoveryDay + journeyDays(distance)`; `journeyDays` is a pure fn of
  map distance (quantized). The world-map marker merely **interpolates toward a pre-decided arrival**; the
  animation NEVER decides anything.
- The mechanical effect lands ONLY when the destination town, during its own deterministic sim, reaches a day
  `>= arrivalDay` and consumes the `traveler` inbox event (exactly-once, id-deduped — the existing
  `queueInbox`/stable-id/Codex-r20 machinery). Wall-clock, reloads, tabs, background all cannot move it.
- **Ordinal allocation** reuses the ledger's existing per-pair ordinal (atomic `updateWorldIndex` mutator,
  same as raids) — no new concurrency surface.
- **Farmer selection at consumption** = pure seeded fn over the town's stable roster with an explicit
  tie-break on farmer seed (never float-trait ties + iteration order). **Chronicle day = sim day at
  consumption**, never the event's world-layer `at:` timestamp.

### v1 effect — chronicle + belief, mechanically alive for FREE (resolves council #4; Fable rec 3)
Not "narrative-only" (council rightly called that mislabel), but **no new balance surface**:
- A **chronicle beat** on arrival ("a traveler staggered in from the wastes — orcs are near, beyond the
  eastern ridge").
- A **belief seed** planted (via inbox, deterministically) in the destination's seeded most-curious farmer.
  Because `resolveEncounter` ALREADY gates parley on envoy curiosity (`> 0.6`), that belief flowing into the
  curious farmer — who preferentially becomes the envoy — is literally what makes the first **parley**
  possible instead of a raid. The traveler's peaceful contact *earns* reconciliation through machinery that
  already exists. Zero new nudge code.
- **NO behavior nudges** (fortify/scout) in v1 — council + Fable agree they're the least memorable, highest
  balance risk. Deferred, possibly forever.

### Migration (resolves council #3/#4)
On `WORLD_INDEX_VERSION` bump: **derive** each pair's state from existing data, don't reset to "unknown":
any pair with a reconciliation-ledger entry or a prior `met`/encounter → seed `aware` (they've clearly
already met). Absent history + out of radius → `unknown`. So ongoing raids/relationships never halt.

### Asymmetric awareness (Fable Q7)
The weary traveler is NOT the origin's emissary — only the **destination** learns; the origin stays oblivious
(dramatic irony, visible on the map). Encounters unlock when **either** side is aware **or** surprise contact
forces it — never require mutual awareness (doubles delay for nothing). A reverse-direction traveler (its own
ordinal) can later close the loop.

### General carrier primitive (Fable rec 5 — the SuperMemory showpiece seed)
Model the event as `{ kind:'traveler', payload:{ type:'warning'|'news', ... } }` even though v1 only ships
`warning`. Post-v1, a traveler carrying `news` (of a raid, a death, an invention) to a THIRD town is memory
literally travelling the world, visible on the chart — the actual hackathon showpiece. Costs one event-shape
decision now; retrofitting later costs a migration.

### The map must show pair state (Fable's missing beat)
World map renders each pair's state (rumored / traveler en route w/ interpolating marker / aware / met) so
the gap between a marker "arriving" and a dormant town's awareness (which only lands next time it's played,
exactly like raids) reads as intentional, not broken.

### Open questions that survive to build-time
- OQ1. `journeyDays` curve — linear in distance, or capped band (short/long)? (Balance, tune in Slice B.)
- OQ2. Rumor radius vs raid radius exact multipliers (how much lead time a warning gets). Tune in Slice B.
- OQ3. Fate odds (arrives vs lost) — start ~80/20? Seeded; tune for how often surprise contact fires.

---

## Rollout (unchanged order; council + Fable both endorse)
- **Slice A — Names.** DONE (2026-07-12). Per-town dedup, derived surnames, heir surname inheritance,
  invariant test, re-pin baselines.
- **Slice B — Plumbing.** Pair-state machine in `detectEncounters`; `seedTraveler` (fate + arrivalDay upfront);
  `traveler` inbox event shape (carrier primitive); world-map state rendering + interpolating marker; NO sim
  effect yet. Prove determinism (identical seeds + different wall-clock/tab interleavings → identical sim).
- **Slice C — Arrival.** Consume `traveler` at `day >= arrivalDay`: chronicle beat + seeded belief into the
  curious farmer; wire surprise-contact fallback; migration deriving awareness from the ledger.
- **Slice D — later/maybe.** Behavior nudges (if ever), richer viz, `news` payloads (rumor propagation).
