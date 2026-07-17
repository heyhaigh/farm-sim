# Generative Crafting — design plan v3.1 (Ry Farms), post three council rounds

Two council rounds (DeepSeek / Gemini / GPT-5.5 / Grok + independent Claude Fable). Round 1 fixed v1's
output-collapse; round 2 caught that the v2 concentration-tier traded the *volume* exploit for a *purity* one,
that failure-memory was mis-keyed, and that the myth/async layers were specified at intent-level, not as
executable rules. v3 resolves each and locks the algorithms. **The engine (Layer 1) is BUILT + verified;
Layers 2–8 are specified concretely enough to build.**

## Goal
A generative, farmer-driven crafting system: a combinatorial ingredient grammar with a **bounded,
rarity-gated, non-degenerate** output space; farmers who discover novel items by a **non-omniscient folk
process and learn from failure**; rare ingredients that begin as **half-believed tales grown from the town's
own memory documents** and become real only when found; each town's unique inventions persisted to
SuperMemory. Recipes are *discovered and invented*, not unlocked from a list.

## Doctrine (non-negotiable)
1. **Determinism.** Same seed → same town, every run; harness self-compares. Sim-driven → re-baselines
   digests, but **re-baselining is not a determinism proof**: the harness excludes display fields, drains
   async identically, and self-compares. Cross-platform: integer-ish scoring + explicit sorts + fixed
   tie-breaks (no locale/float-order leaks).
2. **Compile-don't-query.** LLM/SuperMemory are DISPLAY/persistence channels with procedural fallbacks; never
   in the decision loop; the sim never reads SuperMemory.
3. **LLM reconciliation, hardened.** LLM invents *flavor* wholesale (name, lore, the story of why the
   ingredients combine) but is **handed the derived effect/tier and must stay consistent** (strict schema,
   banned mechanical claims, server-validated, procedural fallback). All LLM text lives in a **shadow store
   excluded from the sim digest**. Procedural name is the **stable canonical**; LLM name is a cosmetic overlay.

---

## Layer 1 — combinatorial engine (BUILT + verified, commit b15084e)
`deriveInvention(counts)` is pure, order-independent, deterministic.
- **Novelty at the OUTPUT.** Canonical key `gen:<dominant>[-<second>].t<tier>.<qualityCode>` (qualityCode
  `c/f/p` — plain/fine/pristine, distinct so plain≠Pristine). Many combos collapse to one recipe (rediscovery,
  credited, not re-minted) → bounded registry. Verified: 143 distinct items / 143 unique names / 0 collisions
  across the 2–3-ingredient space.
- **Rarity ABSOLUTELY gates the top tiers.** Commons cap at tier 2 (no cheap cure); tier 3 requires a rare
  ingredient, tier 4 more. Concentration only separates t1/t2 within a band. Verified: **0 of 416
  commons-only combos reach tier≥3 or a cure**; rare reaches t3/t4.
- **Quality from rarity only** (never magnitude) so doubling cheap stock can't mint a different item.
- **Procedural names unique per key** (tier-graded form + secondary-essence note), so the sim never gossips
  two items under one name; the LLM name overlays on top.
- Effect derived from dominant+tier: vitality→mendhp (→cure at t3), growth/earthy→growboost, potency→
  workboost, warmth/hearty/sweet→refresh, mystic/luck→charm.

## Layer 2 — ingredient sourcing
- **Foraged (common):** berry, mushroom, herb, root — from wild tiles (extend forage). Some mushrooms carry a
  **bane** essence (Layer 6).
- **Hunted:** meat, hide/bone.
- **Rare (mythical):** crystal, relic, emberbloom — **dedicated new wild spawns** (glowing crystal node,
  mystic bloom, deep wilds) *plus* existing treasure / ancient-relic finds. **Spawn spec:** seeded density
  from world seed; each node **single-use** (consumed on harvest), re-seeds on a long seeded cadence;
  deterministic conflict resolution (nearer-then-seed) with a **claim reservation** so a losing farmer
  retargets before making a wasted multi-hour trip.

## Layer 3 — myth → validation → wonder (concrete + frozen)
Rare ingredients are not known to exist; they are **tales grown from the town's own memories**.
- **Tales snapshotted at town CREATION, frozen in the save, never re-derived** (fixes corpus-drift: the live
  corpus is mutable). At founding, `docLexicon` extracts distinctive lexemes from each founder's SOURCE doc →
  a deterministic `world.tales[]` = which rare ingredient each myth points to + a frozen lexeme set for its
  imagery. Serialized; the live corpus is never read again for this town.
- **Lexeme curation (the dev-notes problem).** The real corpus is dev notes ("Railway", "PR #581"), so raw
  `docLexicon` yields "the Merge-Conflict past the fog." Filter through an **evocative-lexeme allowlist +
  dna.js's existing archetype→keyword mapping**; if a founder's doc yields nothing evocative, fall back to
  the archetype's keyword bank. **Cold-start:** a sparse/empty corpus → tales seeded from archetypes alone.
- **Per-ingredient belief tracks (concrete schema).** Each farmer holds per rare ingredient
  `{ state: unheard|tale|validated, strength: 0..1 }`. Update equations (tunable defaults):
  - Hearing a tale: `state=tale`, `strength = max(strength, 0.35)`.
  - Daily decay while unvalidated: `strength -= 0.01`, floored at `BELIEF_FLOOR=0.15` (never zero — the loop
    can't dead-lock; a floor of hope remains). Skeptics decay faster, wonderers slower (±0.005 by trait).
  - Fruitless deep-wilds trip: `strength -= 0.03` (a real cost) but still floored.
  - A find: that ingredient → `state=validated, strength=1`; the finder gets +0.05 *global curiosity* (openness
    to OTHER tales), capped, decaying — **never validates other ingredients** (no cascade).
- **Gossip propagation (specified, deterministic).** Reuses the gossip channel: when a tale-holder or finder
  converses (existing seeded, personality-gated `#maybeChat`), the listener's belief in *that one* ingredient
  rises `+min(0.15, teller.strength*0.3)`, **capped at one civic-belief bump per listener per day**,
  attenuated by relationship distance. Stable sorted iteration; no new rng streams — piggybacks the existing
  conversation seed. Bounded → no town-wide cascade.
- **A find VALIDATES and lands hard:** strong memory ("I always heard travelers speak of star-glass past the
  fog; today I held a shard — the tales were true"), a wonder belief, they carry it home and tell it.
- **Non-believer finds:** holding a rare thing you never heard tales of lands a *"what IS this?"* beat and
  **retroactively seeds the tale**, making the finder its origin.
- **Tale provenance is surfaced** (or the whole layer is invisible plumbing): the RECIPES/tales UI and the
  validation beat name the founder + quote the SOURCE-doc title the tale grew from ("a tale Pudding carried
  from *the crofts of the high fells*").
- **Tuning target the harness asserts:** median town validates ≥1 tale by year 2 (spawn density + belief
  floor + trip cost tuned to hit it), so the layer is never flavor-text-by-starvation.

## Layer 4 — discovery behavior (non-omniscient, learning, bounded)
- **Folk heuristics, never the essence table.** A farmer forms an intent from OBSERVABLE features only:
  "combine what I hold most of," "pair a rare find with a staple," "try what a neighbor's tale hinted." A
  seeded pick over held ingredients weighted by curiosity/INT. **They never read effect/tier/essences.**
- **Failure memory keyed by INPUT, not output** (council fix). `sheet.triedCombos` = a bounded set of **input
  multiset signatures** (hash of sorted `good×qty`, quantity-bucketed so near-combos coalesce) that returned
  `null` OR a known item — so a farmer won't repeat the *exact* dead combo, WITHOUT consulting the hidden
  derivation (they only know "I tried this basket before"). Capped (~40, FIFO) + decays, so no unbounded
  growth. Success dedup stays at the output-key layer (registry), separate concern.
- **Bounded opportunity cost.** Seeking + experimenting are **discretionary-tier** actions (below survival,
  crops, dreams, urgent work — the civic-directive kernel trick), with a per-farmer daily budget
  (`≤1 experiment + ≤1 seek-trip/day`) and an emergency cutoff (skipped in bad seasons / low stores), so an
  inventive streak can't starve the town, and a too-conservative gate can't make invention invisible (the
  Layer-3 tuning target guards the floor).
- Attempt → `deriveInvention`. A useful + novel (new canonical key) result **crystallizes**, credited to the
  discoverer (chronicle + journal + diffusion). Failure = a small tuned waste + the input-sig into
  `triedCombos`. **Rediscovery:** first to a key is credited; a later converger within a season gets a
  "someone beat me to it" beat.
- **Saturation endgame.** The reachable key space is finite (~150 over 2–3 ingredients; the harness's
  degeneracy analysis emits the exact count). When a town has discovered most of what its ingredient access
  allows, curiosity **redirects** to crafting/teaching/trading known recipes (a soft throttle on the bounded
  space, not the old hard "nothing left" wall) — new ingredients (a first crystal) reopen discovery.

## Layer 5 — dynamic registry + SPLIT state + economy hooks
- **Sim-canonical (in digest):** `world.recipes[key] = { effect, tier, dominant, second, quality,
  exampleInputs, discovererSeed, day, schemaVersion }` — pure, bounded, serialized.
- **Display shadow (EXCLUDED from digest, may be absent):** `world.recipeFlavor[key] = { llmName, lore }`.
  Serialized separately; **never fed to self-compare**; LLM-on ≡ LLM-off in the sim digest. Procedural name
  canonical everywhere in the sim.
- **Fixed craft yield** (council: or the exploit moves to quantity): a craft consumes a fixed ingredient cost
  and produces a **fixed 1–2 units**, never scaling with input volume.
- **Value curve** (for queued barter): `value = base(effect) × tier × qualityMult` — a placeholder so a
  tier-3 cure isn't economically identical to a berry.
- **Save migration:** old v1 `gen:<multiset>` ids remap to canonical keys on load (or fade to lore if
  unmappable); `schemaVersion` gates future derivation changes.
- `world.recipeById(key)` merges static `RECIPE_BY_ID` + `world.recipes`; craft/consume/diffusion route
  through it.

## Layer 6 — harm axis (bane), with an OBSERVABLE tell
A **bane** essence (certain mushrooms, spoiled/rare ingredients) yields **harm items** through the same
grammar. Bane ingredients carry an **observable tell** (discoloration / an "off" sprite + a "smells wrong"
mutter) — folk knowledge, NOT hidden essence metadata — so avoidance/selection reads off the visible property,
not the derivation (no omniscience leak). Open crafting shuns the tell; a **low-honesty grudge-holder** uses it,
feeding the existing `plantSabotage` path. Deterministic; detection/trial unchanged; balance-tested (incidents/
season, antidote availability, no grief-spiral).

## Layer 7 — LLM naming & lore (display-only, constrained, deterministic lifecycle)
- Procedural name canonical + immediate. Async `/api/ry-farms-invent` is **handed the derived effect/tier/
  example-ingredients** and must return schema-valid `{name, lore}` **consistent with that effect** (banned
  claims; server-validated; violation/timeout → procedural).
- **Deterministic async lifecycle** (council: exclusion alone isn't enough): pending jobs have **deterministic
  ids = canonicalKey**; **callbacks NEVER re-enter the sim decision loop or consume world.rand** — they only
  write the shadow store. Name deconfliction is **procedural + content-addressed** (against the sim-canonical
  name set, independent of async arrival order), so LLM-on/off + retry-order never move the digest.
  Content-addressed cache keyed by `canonicalKey + ingredientSig + schemaVersion` → one call per item,
  idempotent. Save/load mid-enrichment: pending jobs re-issue from canonical state on load; no partial sim
  state depends on them.
- The LLM also dresses the **frozen tale lexemes** (Layer 3) — display-only, same constraints.

## Layer 8 — SuperMemory representation (dual, idempotent)
1. **Recipe nodes off the TOWN hub:** a `town-inventions` doc → each *canonical* recipe an amber node
   (**stable node id = canonicalKey**, upsert, never duplicated on retry/enrichment).
2. **A discovery memory on the inventor's node** via the now-fixed farmer-life writeback; diffusion shows as
   more farmers gaining that memory.
- Faded recipes → **"half-remembered" lore nodes** (a feature), never a broken reference; UI/journals handle a
  lore-only recipe explicitly.

## Determinism & tests (strengthened per round 2)
- Seeded via world.rand / per-farmer streams; **stable sorted iteration + explicit tie-breaks** (dominant/
  second ties → lexical key order). Tale bias reads **frozen structured lexemes, never live corpus or LLM prose.**
- Harness: (a) `deriveInvention` purity/order-independence + **degeneracy analysis** (no cheap top-tier — 0/416
  proven; emits reachable-key count); (b) N-year discovery **self-compares across two runs AND save/load
  mid-day / mid-intent / mid-async-enrichment**; (c) input-keyed failure memory (no repeat of a dead combo,
  bounded); (d) myth propagation deterministic + per-ingredient (one find ≠ global validation) + the year-2
  validation-rate target; (e) **LLM callbacks resolve in different orders / fail / timeout after save/load →
  identical sim digest**; (f) SuperMemory unavailable/slow/stale → idempotent, no dup nodes; (g) re-baseline hexes.

## Committed answers (round-2 defects closed)
- **Purity exploit →** rarity absolutely gates tier 3+ (0/416 commons reach it, verified) + fixed craft yield.
- **Failure memory →** keyed by INPUT signature, bounded/decaying, non-omniscient (success dedup separate).
- **Quality identity →** quality is IN the canonical key (distinct codes); no first-writer collision.
- **Name collision →** tier-graded unique procedural names (143/143/0 verified).
- **Corpus drift →** tales snapshotted + frozen at town creation; lexeme allowlist + archetype fallback + cold-start.
- **Myth loop →** concrete per-ingredient belief schema + gossip equations + a belief FLOOR (no dead-lock) + a
  year-2 validation target; "implies more" = a bounded curiosity nudge, never cascade.
- **Async determinism →** deterministic job ids, no-callback-into-sim, order-independent deconfliction, split store.
- **Bane omniscience →** an observable tell, not hidden metadata.
- **Saturation →** curiosity redirects to craft/teach/trade on the bounded space; new ingredients reopen it.

## Round-3 sanity check (v3.1) — the six defects CLOSED; one load-bearing fix DONE + a tightening list
Council round 3 (+ Fable) confirmed the six round-2 defects are structurally closed and the design is
buildable. Fable (reading the code) caught the one load-bearing contradiction the plan didn't see:

- **RESOLVED — the legacy cures undercut the rare economy.** Base `tonic` (grass+flower) instant-cured via
  the Healer and `inv:remedy:0` was `effect:'cure'` — so grass cured fever and nothing gave rarity a pull.
  Fixed (commit `0e13538`): the Healer's commons remedies now EASE/SPEED recovery (a strong tonic hastens it);
  the instant `cure` effect is reserved for rare-gated generative elixirs. Verified: no commons cure remains.

Remaining tightening (executable-spec, folded into the phase specs — NOT architecture changes):
- **P3 — production is rarity-gated, not just discovery.** Crafting a tier-3+ generative recipe CONSUMES its
  canonical rare inputs every time (not just at the discovery roll). Fixed craft yield = a deterministic 1
  unit (tier/quality do not scale yield). **Retire the `HELPFUL_INVENTIONS` throttle** (farm.js) so tinkering
  explores the ~150-key generative space, not the legacy 9; saturation = a consecutive-dry-experiments
  counter redirects curiosity to craft/teach/trade.
- **P3 — failure memory: EXACT input multiset** (sorted good×qty hash), **no quantity bucketing** (bucketing
  can straddle the 0.6 concentration threshold and write off a winning ratio); bounded FIFO(~40) + slow decay.
  Success dedup stays at the output-key/registry layer, separate.
- **P4 — the belief→SEEK action rule** (P2 ships a basic INT-gated seek; P4 makes it belief-driven): a farmer
  ventures out when `belief.strength × curiosity` clears a seeded threshold, discretionary-budgeted.
  **"global curiosity"** = a per-farmer, bounded, decaying trait nudge that weights the seek DECISION only
  (never validates other ingredients). Belief traits (skeptic/wonderer) map onto existing axes
  (low collaboration + high INT ≈ wonderer). Late arrivals derive-and-freeze their own tale at arrival.
- **P4 — new per-farmer state** (`triedCombos`, belief tracks, daily budgets) is **digest-included sim state**
  (tested by save/load mid-intent). The year-2 validation target is a **tuning gate** (may fail during
  phases), promoted to a CI assertion once spawn density is pinned.
- **P5 — bane is a DISTINCT GOOD** (`banemushroom`, its own essence + a visible tell sprite), so the AI reads
  the observable good id, never hidden essence; a bane-dominant brew maps to a harm effect (currently falls to
  `refresh`). Adding it re-verifies the 143/0 counts under a new `schemaVersion`.
- **P5 — async:** unify job-id AND cache-key on `canonicalKey`; LLM-name deconfliction is content-addressed
  (key-derived, order-independent); stale-callback guard = {townId, schemaVersion, key-still-exists}.
- **P8 — SuperMemory node ids** namespaced by town (`townSeed:canonicalKey`); provenance titles get the same
  lexeme allowlist / LLM dressing as tale imagery (raw dev-notes titles aren't evocative).

## Still open (deferred, with reasons)
- **Player-proposed combinations** — future hook (whisper a combo via the conscience channel; same derivation,
  display-safe); out of scope for the first build.
- **Full economy balance matrix** (durations, stacking, cooldowns per effect/tier) — a tuning pass during P3
  once craft/consume is wired and the harness can measure dominance over real play.
