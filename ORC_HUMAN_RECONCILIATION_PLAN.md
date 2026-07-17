# Human ↔ Orc: Grievance, Parley & the Un-writing of a Creed — Build Plan **v2 (post-council)**

Turns `ORC_HUMAN_LORE.md` into systems. **North star:** *memory made the war; memory can end it.* The same
inheritance that reissues a grievance whole can reissue a single un-betrayed trust the same way. We build the
machinery that lets an inherited **creed** of hatred be slowly overwritten by a **belief** someone dared to
earn — deterministic, traceable, persisted.

> **Reviewed 2026-07-11 by a 4-voice council** (Fable holistic + systems/determinism + balance/pacing +
> narrative/legibility; the external OpenRouter council CLI was unavailable — no key in env — so an equivalent
> panel of reviewer subagents stood in). v2 folds in the consensus. The reviews agreed the *vision is strong
> and buildable on the existing belief/creed engine*, but that v1 as first written had **two structural flaws
> and one invisibility flaw** that had to be fixed before building. Those fixes are now Slice 0 / the re-scope.

---

## The THREE things the council forced (non-negotiable, do first)

**F1 — Ledger keys on LINEAGE-PAIR, not town-pair.** (balance R1) Town-pairs meet exactly **once** ever — the
world layer's `detectEncounters` is idempotent (`met.has(key) → continue`). A single town cannot be raided in
gen 1 and parley in gen 3; there is no second meeting. So the reconciliation arc is **structurally impossible**
at the town-pair level. Key the ledger on the **faction-lineage pair** (a human lineage ↔ an orc lineage).
Town-pairs stay one-shot; each new frontier founding is a fresh *roll against the accumulated lineage ledger*.
This is the only structure where grievance and reconciliation **compound across generations** — and it is
exactly what makes "born wary near an old grievance" real.

**F2 — World-layer determinism + a town INBOX.** (systems R1/R2/R6, Fable R1/R2) The world layer is by its own
code comments **off-sim, non-reproducible, `Date.now()`-stamped, unsorted, and un-harnessed**
(`worldmap.js`: "Nothing here feeds a town's seeded sim"; `save.js`: "client-authoritative, non-reproducible";
`tests/determinism.mjs` never boots it). v1 put its most consequential decision (raid/parley/betray) there and
piped the result back into the digest-harnessed town sim — which would ship same-twice violations. Fix:
- **Conditional determinism** for the world layer: an outcome is a **pure function of
  `(lineagePairKey, per-pair encounter ordinal, townA.seed, townB.seed, ledger state)`** — and *nothing else*.
  **Banned inputs:** `Date.now()`, `ev.at`, `lastSeen`, `world.rand`, any LLM text, node array index, and any
  `day`-derived float. Detection geometry, if it ever becomes outcome-bearing, uses `dx*dx+dy*dy > r*r` (exact
  in doubles), never `Math.hypot`. Total order over ledger entries is always `(day, lineagePairKey, kind)`,
  never `at`.
- **Town INBOX** for world→sim crossings: world-layer resolutions **append structured events to the town's
  serialized save**; the town consumes its inbox **deterministically at dawn** (sorted `(day, pairKey, kind)`)
  and the digest covers the *post-consumption* state. Determinism becomes the honest, testable claim
  *"same seed + same inbox ⇒ same town."* The town tick NEVER reaches into the world index directly.

**F3 — Legibility is a first-class deliverable, and stakes are real.** (narrative all + balance R2) v1 asserted
"openly at war / traceable / point at the encounter" against sheet surfaces that **do not exist** (no
creed↔belief pairing, no authority indicator, no hit-regions, no dual-record view) — and a raid currently
**deducts nothing** (`bCarried` is a display string). A viewer watching minutes cannot be made to care which
branch fired when neither moves a number on screen. So: **every branch moves something visible**, and the
overwrite gets a real UI. *"If you fix only one thing, fix raid stakes."*

---

## Doctrine (reinforced with the council's guards)
1. **Determinism** — seeded rng + stable **sorted** iteration; same seed (+ inbox) ⇒ same town. Guard against
   float non-associativity by quantizing weights (`+w.toFixed(3)`, as `compileCreeds` already does) and folding
   **integer counts**, never running float accumulators.
2. **Compile-don't-query** — LLM + SuperMemory decorate/persist, never decide. **Compute-then-swap** ordering
   (cite `#applyVerdict` farm.js:2853 + whisper `submitWhisper`): the seeded outcome is computed and the ledger
   written **synchronously, before any `await`**; LLM prose is a later in-place swap on a `flavor` shadow field.
   **Structured rail for inheritance:** the persisted reconciliation's *mechanical* payload is
   structured fields read verbatim at founding (the `growHeir` `lineage.creed` rail) — **never** LLM prose that
   `compileCreeds` would keyword-scan (Fable R4: else the LLM decides an heir's creed weights one gen removed).
3. **Creed (inherited) vs Belief (earned)** — the spine. "Overwritten" has a concrete, computable meaning:
   the decayed raid-creed's authority falls **below the next-strongest relevant creed**, so `creedFor`
   (farm.js:6064) stops selecting it. There is a visible crossover day.
4. **Memory is load-bearing** — grievances AND reconciliations persist + are inherited; a future heir can carry
   the grudge OR the exception.

## Existing machinery to reuse (verify before touching — don't grow parallel systems)
- **Belief engine:** `formBelief` (dedup by text — so key on procedural id, not text), `#reviseBeliefs`
  (count-based strength re-derivation at dawn — the pattern to copy), `#consolidateBeliefs`, `#applyDrift`,
  `BELIEF_FLOOR 0.35`, `BELIEF_DECAY 0.045`, strength cap 1.5, `DRIFT_CAP 0.2`. The cross-faction belief is a
  `BELIEF_THEMES`-style citizen with an extra `contradicts: creedTheme` + `source: parley|spared` field — NOT a
  new species.
- **Creeds:** `compileCreeds` (weights `min(1, hits*0.3+rand*0.25)`, quantized `toFixed(3)`), `orcify` raid-creed
  at weight **1.0**, `creedFor` (tag-match then weight). Both raid & inherited creeds are 1.0; memory creeds
  typically <0.7 — so authority decay has a real target to fall below.
- **Recall-tuning lesson (#94):** a 3-day hair-trigger churned managers until floors + `RECALL_DWELL=12` were
  added. Reuse that medicine for disposition thrash.
- **Lineage/heirs** (`growHeir`, `fetchMemories` lineage read baked at founding), **world index** (`save.js`),
  **encounters/tints** (`worldmap.js`), **personality traits**, **culture/orcify**, **chronicle tiers**
  (`grand`→`drawMoments` w/ purple `why`; `callout`→toast), **PAST OFFICES** (`world.roles.history` render — the
  template for a persisted ledger view), **`recipeFlavor`/`taleFlavor`** (the display-shadow contract).

---

## Slices (re-scoped per council)

### Slice 0 — Determinism foundation (PREREQUISITE — build first, it gates everything)
- **Extend the determinism digest** (systems R3, Fable, narrative — unanimous): `tests/determinism.mjs`
  snapshot currently hashes `rareBelief` only — NOT `f.sheet.beliefs` nor `f.creeds`. Add
  `creeds: f.creeds.map(c=>[c.theme, c.weight])` and `beliefs:(f.sheet.beliefs||[]).map(b=>[b.tag,b.strength])`;
  re-baseline the four digests deliberately. Without this the overwrite is invisible to the harness.
- **Lineage-pair ledger data model** (F1): top-level in the world index (sibling of `index.encounters`), keyed
  by `lineagePairKey`, each = `{ grievances[], reconciliations[], disposition, firstTrustDone, lastTierChange }`.
  **Idempotent append** (the `met`-set discipline), a **version stamp + migration** (existing `bCarried` string
  events → structured, like `World.SAVE_VERSION` guards the town snapshot).
- **Town inbox** (F2): `save`d `world.inbox[]`; consumed at dawn, sorted `(day, pairKey, kind)`.
- **World-layer harness** `tests/encounters.mjs` (systems R9): fixed synthetic index (fixed seeds/days, **no
  Date.now**), resolve twice → byte-identical; enrich-off vs stubbed-on → **same outcome** (proves compute-then-
  swap). New dedicated test, required for A/B/D.

### Slice A — Disposition (lineage-pair, count-based, read-once-at-founding)
Disposition `D ∈ [−1,+1]` per lineage-pair, a **pure fold over the pair ledger only** (town memory);
individual creeds/beliefs modulate only the *envoy's branch weights* later (resolves v1's Slice-A
inconsistency; answers open-Q2). Numbers (from balance, grounded in existing constants):
- Fresh human↔orc frontier **D = −0.6** (deep inherited hostility, headroom left).
- grievance **−0.12**; honored reconciliation **+0.08**; betrayal **−0.25** (≈3 grievances to undo; softening
  slower than hardening = negativity bias).
- Tiers with **hysteresis deadband**: → **open** at `D > +0.15`; fall back below `D < −0.05`; open→hostile only
  at `D < −0.35`. **Dwell:** tier changes at most once per **8 foundings** on that frontier.
- **Local & non-generalizing** (attractor guard): Oakhollow-line ↔ Emberton-warband peace does NOT extend to
  Ashfang-warband. Peace is a patchwork of specific frontiers, never a global flip.
- Read **once at founding** (born-wary/born-open baked into the founding cast + seed via a **dedicated salt
  stream** — never mutating the base seed, or `orcify` names shift; systems R10). Never re-read in tick/register.

### Slice B — Encounter resolution (3 branches; **real stakes**; LLM off in v1)
When a human town and an orc warband meet, resolve through a seeded model (`mulberry32(hashString(
lineagePairKey + ':' + ordinal + ':' + quantizedDisposition + ':' + envoyDigest))`). **Three** legible outcomes
(cut "rejected-as-trick" to v2 — it reads identically to a raid on screen; balance R6):
1. **Raid** — hostile. **STAKES:** docks the victim town's `harvestTotal` + freezes/shrinks its reach; the
   town's map circle visibly contracts/dims. Writes a grievance both sides remember (populate **both**
   `aCarried` + `bCarried` with each faction's honest reading — the contested record).
2. **Parley → honored** — both keep faith. Crosses a creed across the faction line (reuse same-culture
   `meeting` creed-swap); draws a persistent **warm thread**; queues a reconciliation into both towns' inboxes;
   envoys earn a cross-faction belief (Slice C).
3. **Parley → betrayed** — a false extender (attempting envoy `honesty < 0.3`) uses the overture as cover.
   **STAKES:** kills the *named* counterpart envoy (a death is the most legible stake in this sim); writes a
   **sharp** grievance marked "born of a broken parley," and — the cruelest turn — the martyr's death is
   written as *proof the other side can't be trusted* (a grand, named beat).
- **Parley is attempted** only if a peacemaker envoy is fielded: human `curiosity>0.6 OR collaboration>0.6`;
  orc `curiosity>0.6 AND honesty>0.45` (tighter — orc honesty is −0.2). Else auto-raid.
- **Envoy** (systems R4, Fable): a **seeded digest baked into `townSummary` at register time** — the standout
  candidate's seed + the 2–3 relevant trait values, chosen with a **`(score desc, seed asc)` tie-break**. (The
  counterpart town isn't loaded at resolve time, so personalities can't be read live.)
- **Compute-then-persist synchronously**, then (v2) LLM swaps the words.

### Slice C — Cross-faction earned belief & creed overwrite (count-based re-derivation)
- The earned belief is a `BELIEF_THEMES` citizen: `{ tag, contradicts: <raid-creed theme>, source: parley|spared,
  pairKey, born: 0.5 }`. Born at strength **0.5** (> FLOOR 0.35, < cap 1.5).
- **Re-derive, don't accumulate** (Fable — mirror `#reviseBeliefs`): at dawn,
  `beliefStrength = pure fn(confirmCount)` (+0.15 per independent confirmation), and
  `creedAuthority = pure fn(confirmCount, betrayCount)` = `1.0 − 0.12·beliefStrength·confirms + 0.3·min(2,betrayals)`
  clamped **[0.25, 1.0]** (never zero from finite events — "an eon isn't unmade by a handshake"). Integer counts
  serialize cleanly + are order-insensitive.
- **"Overwritten"** = `creedAuthority` drops below the farmer's next-strongest relevant creed → `creedFor`
  stops selecting the raid-creed. **Fire a chronicled event at the crossover** ("{name} no longer quotes the old
  fear") — the emotional payoff must be a beat, not a silent threshold.
- **Independence** (anti-exploit): a confirmation must be a distinct `(pairKey, encounter-ordinal)` with a
  per-pair cooldown; oscillating towns can't farm parleys.
- **Hysteresis + dwell** on re-hardening (a fresh betrayal re-inflates `creedAuthority`): the creed reasserts
  through `creedFor` only after crossing back **above the challenger by ~0.1**, at most once per season.
- **Persisted structured + inherited:** when `creedAuthority < 0.5`, an heir-founding inherits the **exception**
  (structured block, verbatim rail) with probability `(0.5 − creedAuthority)/0.5`. State stored on
  `sheet.creeds`/`sheet.beliefs` (serialized wholesale) — never a transient field.

### Slice D — First-trust (gate hard, fire generously, once ever)
- **Gate:** both envoys `curiosity > 0.7` + peacemaker thread + disposition currently **wary-or-hostile** (must
  cross *under pressure*) + **no betrayal in the recent window** for the lineage-pair (recency, NOT a permanent
  lock — Fable/balance: a permanent lock is demo-killing; the ledger still *displays* every entry).
- **Fire:** seeded probability **0.35** given the gate (gate hard, fire generously — a tiny conditional never
  fires in a demo). **One per lineage-pair, ever**; a betrayal permanently forecloses the *grand* moment
  (ordinary reconciliation can still occur).
- **Surface:** `tier:'grand'` → `drawMoments` (full-screen, purple `why`) + a **permanent** world-history entry
  (PAST-OFFICES roll) + a **permanent** world-map landmark that later foundings inherit openness from.

### Slice E — Legibility (first-class; NO LLM prose in v1)
The overwrite must be **seeable**, not just computable (narrative verdict "not yet"):
- **Creed↔belief duel widget** (sheet): pair the raid-creed and the contradicting belief **adjacently**; show a
  HATRED authority bar ticking down + a CROSS-FAITH bar ticking up; strike-through/fade the creed past crossover;
  a provenance line "→ parley with {warband}, Y{year}". (The single largest new UI surface — budget it.)
- **Named, clickable encounter anchor** (reuse `chronRows`+`whoSeed`): every grievance/reconciliation gets a
  **stable procedural name**; the chronicle beat is the pointable surface ("point at it" = click the named beat).
- **Both-sides contested record:** clicking a grievance shows **both** factions' honest readings side by side
  ("They came to take" / "They shut the gate on us") — the tragic symmetry (lore §II).
- **RELATIONS panel** (a new chronicle tab or "THE WORLD" extension) — *this one view is the thesis*: a
  disposition bar (hostile→wary→open) that visibly **moves**, a two-column ledger (grievances red /
  reconciliations warm), and the most-overwritten creed's authority meter on top.
- **Disposition change is a beat** (callout + map thread warms on each threshold crossing).
- **Curated demo seed + frontier ticker** (balance R3): a seed where a frontier is pre-primed (a grievance + one
  prior honored parley) so the *second confirmation* + an heir carrying the exception land inside a minutes-long
  window; a "Gen1 raid · Gen2 parley · Gen3 first trust" ticker makes the arc legible at a glance.

### Slice F — LLM flavor (DEFERRED to v2; cut from demoable v1)
Least load-bearing, biggest determinism-risk surface (balance). When added: LLM **names** grievances/
reconciliations (generate **once**, persist, inherit **verbatim** — narrative G10), speaks the **parley words**,
tells the **first-trust** + writes **both voices of the contested first blow**. Never touches outcomes, meters,
thresholds, or per-tick narration (reserve prose for the *rare* beats or the chronicle becomes spam). The
procedural fallback must ship the **complete** meaning; LLM only upgrades diction.

## Symmetry — asymmetric coefficients, ONE engine (Fable + balance)
Each side is offered what it fears losing. Humans fear the raid (lost accumulation) → a parley that credibly
promises *no raid*. Orcs fear **being forgotten** (an unwritten debt) → **the reconciliation writeback you're
already building IS the thing orcs want** — being written into the town's record is itself the payment, so it
weights orc-side acceptance higher, nearly free to build. Implement as **one resolve function with two
side-flavored coefficient sets** (which fear the offer addresses + slightly different trait weights) — never two
engines.

## Build order (balance-prioritized): stakes > panel+seed > branches > prose
`Slice 0 (digest → lineage ledger + inbox + harness)` → `Slice A disposition` → **`raid STAKES`** →
`creed↔belief panel + curated seed` → `parley branches (honored, betrayed)` → `Slice C overwrite` →
`Slice D first-trust` → `Slice E remaining legibility` → `Slice F LLM prose (v2)`. Each: build → `node -c` →
determinism + chokepoint + `tests/encounters.mjs` → commit. Hold push (user away; standing no-auto-push).

## Success criteria
- A viewer can **watch** a centuries-old creed of hatred begin to be overwritten by a belief someone earned,
  and **click** the encounter that did it — inside a demo window (curated seed).
- Determinism holds (same seed + inbox, LLM-off, headless); the LLM never changes an outcome; the digest now
  *covers* the mechanic.
- The world settles to an **interesting patchwork** (a few reconciled frontiers, most hostile, fresh ones
  re-seeding) — never all-peace or all-war. Neither people is the villain; both are reasonable-and-wrong.

## Council appendix — where each reviewer's high-signal findings landed
- **systems/determinism:** F2 world-layer seeding + banned-inputs; compute-then-swap; digest extension (Slice 0);
  envoy-has-no-data (Slice B); ledger round-trip/version (Slice 0); dedicated salt stream (Slice A); new harness.
- **Fable:** F2 inbox; count-based re-derivation (Slice C); LLM-leak-via-compileCreeds → structured rail;
  first-trust recency window; cut Slice B to fewer branches; symmetric machinery/asymmetric params.
- **balance/pacing:** F1 lineage-pair key; **raid stakes**; attractor guards (local, non-generalizing +
  hostility source); negativity bias + hysteresis + dwell; concrete numbers; curated seed; cut rejected-as-trick
  + LLM prose from v1; asymmetric-via-writeback.
- **narrative/legibility:** F3 the 6 visible beats; duel widget; named/clickable anchor; both-sides record;
  RELATIONS panel; chronicled crossover; LLM should/shouldn't split.
