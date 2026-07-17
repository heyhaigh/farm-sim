# Ry Farms → A World of Towns — Forward Plan

> **STATUS (2026-07-11): Phases 0.4, 1, 2, 3 SHIPPED (local commits, unpushed).**
> - **0.4** README reframed (living world / reproducible substrate) — commit `124bb5b`.
> - **1.1/1.2** Generational founding + provenance: lineage read back via `/v4/search` (GET `/v3/documents`
>   is 404 on self-hosted v0.0.3 — corpus read now soft-fails, lineage rides search); `growHeir` grafts an
>   inherited creed; sheet LINEAGE section — `124bb5b`. Live loop verified (22 forebears read back, heirs founded).
> - **1.3** Ablation harness `tests/ablation.mjs` (real/shuffled/fallback diverge) — `ab624e0`.
> - **2** World index (`save.js`) + `worldmap.js` + zoom-out map (WORLD btn / M): memory-tinted town dots,
>   lineage edges, reach-overlap encounters, cross-town motto exchange, VISIT — `aa6da39`. Browser-verified.
> - **3** Orc culture (`dna.js` `orcify`, per-town `culture`, `?orc=1`) + world-layer raids (ashen tint,
>   human↔orc = raid, victim remembers) — `b9e195c`. Browser-verified (warband EMBERTON).
>   **⚠️ PROVISIONAL — orc towns get a MUCH different design later (Ry, 2026-07-11).** What shipped is an
>   MVP: an orc warband still runs the *human farming sim*, just re-skinned (war-role labels, guttural names,
>   ashen palette, raid-creeds) with conflict only at the world layer. The real orc design is a rework, not a
>   re-skin — likely its own facility/economy set (war-camp not farm: raiding, plunder, martial roles instead
>   of crops/livestock), a distinct AI loop, and in-town siege (ties into `FOE_SIEGE_PLAN.md`). Treat the
>   current `orcify`/`culture` layer as a placeholder to build ON, not the final shape.
>   **Also (Ry, 2026-07-11): orc TALES + RECIPES need their own treatment.** The generative crafting system
>   (`CRAFTING_*_PLAN.md`) and the wild-ingredient TALES grown from memories are farmer-shaped — cultivate,
>   forage, lily/fish/egg/milk. An orc warband's should be inverted the same way `orcify` inverts creeds: recipes
>   are war-gear / trophies / plunder-craft (not soup + garden produce); tales are raid-legends and blood-debts
>   (not harvest-lore + half-believed rare herbs). Same generative engine, an orc lens over the ingredient
>   grammar + tale themes. Part of the orc redesign, not the current placeholder.
>   **Also (Ry, 2026-07-11): orc TOWN ROLES need orc names + likely a different power structure.** The civic
>   system (#94: Manager, Town Watch, annual winter election, civic memory) is human. Orc equivalents: Warchief/
>   Warboss (not Manager), Enforcer/Bonebreaker (not Watch), and power taken by *challenge / might-makes-right*
>   rather than a civic vote — the "election" is a contest. Role NAMES are a quick culture-aware rename (like the
>   orc town names/creeds already shipped); the power-structure change is deeper. Part of the orc redesign.
> - Determinism (4 seeds) + ablation + LLM chokepoint all hold throughout; human default byte-identical.
> - **NEXT (not built):** Phase 4 (narrator/demo seed), Phase 5 (memory-derived shader grade). In-town orc
>   siege combat lives in `FOE_SIEGE_PLAN.md`. Deeper 2.4 (a migrant literally seeds a creed into another
>   town's founding) and 1.2's full clickable causality timeline are follow-ups.


Synthesized from the r-council review (DeepSeek / Gemini / GPT-5.6 Sol / Grok) + an independent Claude Fable
code-review, and Ry's future vision. Where the council and Fable disagreed, we side with Fable (noted inline).

## The one insight that reconciles everything

The council's near-unanimous verdict: *the engine is strong, but "compile-don't-query" makes SuperMemory a
seed + a write-only archive nothing reads — so the "memories alive" pitch doesn't land, and the depth is
invisible in a 3-minute demo.* Their #1 recommendation: **close the memory loop** — let what the town writes
back re-enter the world.

Ry's vision: **not one town, but a persistent WORLD of towns that live forever, venture outward, and one day
run into each other — including ORC towns in tension with the human farmers — viewable by zooming out.**

These are the same arc. A new town (or orc warband) **founded from a previous town's written-back lives + civic
record** is the closed memory loop, at world scale. That single move:

- makes SuperMemory **load-bearing** (the world is literally grown from what prior towns remembered) —
  answers council consensus #1 + #4 and the "does the integration earn it" question;
- makes the demo **legible** — zoom-out + human/orc conflict is visible drama, unlike subtle crafting depth
  (consensus #2);
- reframes **determinism** correctly (below) — a per-town deterministic founding, but a living, non-identical
  *world* layer on top.

**North-star pitch line:** *"This farmer was grown from a memory the world itself wrote. This orc remembers a
farmer his grandfather raided."* Memory stops being a save destination and becomes the ground the world stands on.

---

## Phase 0 — Truth & foundations (cheap, high-integrity, do first)

These are the concrete fixes the review surfaced; they cost little and remove the "the pitch outruns the wiring"
honesty risk before we build on top.

0.1 **[DONE — commit `e2f6565`] Honesty: UI reflects the ACTUAL memory source.** (Fable, verified) Boot screen
+ settings caption now read from `memorySource`: real store → "GROWN FROM SUPERMEMORY"; invented fallback →
"GROWN FROM IMAGINED LIVES" / "INVENTED LIVES - NO SUPERMEMORY CONNECTED YET." No more false claim on a
storeless clone.

0.2 **[DONE — commit `79b0d4c`] Commit the determinism harness** (`tests/determinism.mjs`). (Fable) The #1
invariant now has committed, runnable verification (`node tests/determinism.mjs`) with pinned baselines;
`same-twice=false` exits non-zero. README documents it.

0.3 **[DONE — commit `6139e33`] LLM chat is now PRESENTATION-ONLY.** The council's crux (flagged twice) +
Fable's verified finding: `tryLlmChat` drew `this.rand()` only when enabled, and the LLM's async
`relationshipDelta` wrote opinions/bonds — so "LLM-on ≡ LLM-off" was false. **Decision (resolving the council's
"is LLM output replayable-input / presentation-only / sim-state?"): presentation-only.** The deterministic
scripted outcome (`#scriptedChat`) IS the sim state, applied synchronously at chat time; the LLM only swaps the
speech-bubble prose async, drawing no sim rng and writing no sim state. LLM-off baselines unchanged; LLM-on now
byte-identical in the sim. This is the correct, permanent boundary for the whole project (same as
`recipeFlavor`/`taleFlavor`): **the LLM decorates, it never decides.**

0.4 **Re-frame determinism everywhere (agree with Fable: keep the core, drop the headline).** Determinism is
the **reproducible, testable substrate** (per-town, LLM-off, headless) — not the product's headline and not a
promise of byte-identity across machines/timestamps/async. Copy, README, and the pitch stop leading with
"byte-identical" and lead with "a living world." The world layer (encounters, expressive chat, cross-town
migration) is explicitly alive and not required to be reproducible.

---

## Phase 1 — Close the memory loop (make memory load-bearing)

The council's single highest-leverage move, and the primitive the whole world vision needs.

1.1 **Generational founding.** A town persists its lives + civic record to SuperMemory (already does). A NEW
town can be founded by **reading those back** — heirs/lineage: a founder can be "grown from" a prior town's
farmer (inherits a creed, a grudge, a myth they half-believe) blended with a fresh document. Solve the
"echo-chamber" fear (why `knowledge-graph.js` filters generated docs today) with a **lineage tag** + a blend
ratio, not a blanket exclude — so writeback re-enters deliberately, not accidentally.

1.2 **Visible causal chain / provenance.** (Council consensus #4, C's explicit rec) Every compiled artifact
(creed, belief, myth, stat) keeps a pointer to the source passage. A viewer can click a farmer's decision and
trace it back: *passage → belief → decision → event → writeback → reuse in a later town.* This is the
"inspectable memory-causality timeline" C asked for and the load-bearing proof judges want.

1.3 **Ablation proof.** (Outlier — C/D; Ry said do all) A tiny mode that founds three towns — real-memory,
shuffled-memory, fallback — and shows they diverge *observably*, not just in labels. This is both a dev test
and a demo beat ("watch the same seed grow a different society from different memories").

---

## Phase 2 — The world of towns (Ry's vision)

2.1 **Persistent multi-town world.** Towns are first-class, SuperMemory-archived entities that persist and keep
living. The world holds several at once.

2.2 **Zoom-out world view / map.** A camera tier above the town: see multiple towns as living dots/clusters on
a world map, zoom into any one. This is the single biggest **legibility** win — "farms wandering" becomes "a
living world of societies" at a glance (directly answers consensus #2).

2.3 **Venturing + distance-based encounters.** Towns expand outward (the fence/expansion system already grows
rings). Give the world a coordinate space and a distance metric; towns that grow toward each other **eventually
meet**. Encounters trigger: trade caravans, migration (a farmer carries their memories to a neighbor), border
friction.

2.4 **Cross-town memory exchange.** When towns meet, memories travel — a farmer who migrates seeds a belief or
a tale in the new town; a trade spreads a recipe. This makes the *world* itself a memory-propagation medium,
not just each town internally.

## Phase 3 — Orc towns & the human/orc tension

3.1 **Orc archetype.** A town grown from the same memory substrate but through an **inverted/alternate mapping**
— different creeds (raid vs. cultivate), different facility set (war-camp vs. farm), different personality
weighting. Same SuperMemory source, different lens: a strong demo point about interpretation.

3.2 **Legible conflict.** Human farming towns vs. orc towns produces the *visible* drama the council said the
demo lacks: raids, defense, uneasy truces, a farmer who remembers being raided, an orc who spares a town his
kin once burned (memory-driven, traceable via Phase 1.2). This is the emotional hook.

## Phase 4 — Legibility & demo layer (cross-cutting, consensus #2)

4.1 **Narrator / causal ticker.** Surface *why* — the town's notable events as a readable feed tied to
provenance ("Bram raided Oakhollow — he remembers them turning his father away"). Partly exists via thoughts;
make it a first-class, demo-facing layer.

4.2 **Curated demo seed + time-skip.** (Council "missing": no demo script) A known seed + a fast-forward that
reliably produces a discovery, a tale validation, an election, and a **town encounter** inside the demo window.

## Phase 5 — Shader as artform (memory-driven atmosphere)

The display layer is the ONE place the project can be pure artform without touching a doctrine — a shader
reads the deterministic sim + the memory fingerprint and never writes back, the same boundary as the LLM's
`recipeFlavor`/`taleFlavor` side-channel. The discipline downstairs (determinism, compile-don't-query) is
exactly what frees unbounded expressiveness upstairs. We already have `crt.js` (WebGL fullscreen quad —
scanlines, aperture mask, chromatic aberration, GBC LCD grade), and the memory portal already imports it as
the connective aesthetic, so this is an extension of what exists, not a new genre.

5.1 **Memory-derived color grade (the elegant, non-decorative core).** Grow the SHADER from memory the way we
grow farmers. Derive a town's palette/grain/bloom/contrast from the emotional/semantic fingerprint of its
founding memories: warm nostalgic docs → golden and soft; stark technical notes → cold and high-contrast; an
orc warband grown from conflict → ashen and red. The shader becomes a *visualization of the memories* — a
second, purely-aesthetic answer to "memory is decorative": memory doesn't just seed behavior, it colors the
world. Plumbing is half-built already: `crt.setPalette` + the unused `SEASONS[].dmg` palette hooks.

5.2 **World map as a shader canvas** (threads into Phase 2). The zoom-out world view is atmospheric by nature
— distance fog, day/night sweeping across the map, weather visible from above, each town glowing in its own
memory-derived grade. Doubles as the biggest legibility win (consensus #2).

5.3 **Human vs. orc rendered as atmosphere** (threads into Phase 3). Verdant/golden farmland against ashen/red
orc territory — the tension made *visible at a glance*, which is the demo legibility the council said was missing.

5.4 **Encounter/raid moments as shader beats.** A bloom flare, desaturation, or aberration punch when towns
meet or a raid lands — shaders as the camera *language* of drama.

**Invariant:** everything in Phase 5 is strictly DISPLAY-only — it consumes sim + memory state, never feeds
back, and (like the LLM flavor layer) is excluded from the determinism digest. Shader-on ≡ shader-off in the sim.

## Cross-cutting — carry through every phase

- **Privacy / consent / redaction.** (Outlier — C; Ry said do all) Turning personal documents into public
  characters, beliefs, conflicts, and now a *persistent shared world* raises real stakes. Add: a consent/opt-in
  step, a redaction pass (strip names/PII from surfaced text), a "fictional interpretation, not a claim about
  the author" disclaimer, and retention/delete handling. Gates before anything is shown publicly.
- **Crafting semantic depth.** (Outlier — C) Address "combinatorial, not meaningfully generative": give
  inventions **bounded but mechanically distinct** effects (not just tiered names), so the output space is
  small-but-meaningful rather than many-names-same-thing.

---

## Sequencing & rationale

Phase 0 first (honesty + foundations — never build on a false claim). Phase 1 next: it's both the council's #1
ask AND the primitive Phase 2 depends on (a world of persistent towns IS generational founding at scale) — so
it's not a detour, it's the shared substrate. Phase 2 delivers Ry's world + the legibility win. Phase 3 adds
the tension/drama. Phase 4 makes it all demo-legible. Phase 5 (shader/atmosphere) is not a late add-on — its
memory-derived grade (5.1) can start early and cheap on the single town, then its world-map/orc/encounter
beats (5.2–5.4) light up *with* Phases 2–3 rather than after them. Privacy + crafting-depth ride along throughout.

Each phase should ship behind the existing determinism discipline (per-town founding stays reproducible +
harnessed) while the world/encounter/expressive layers are explicitly the living, non-identical tier.

## Open questions to resolve before Phase 2 build

- Does a "world" run all towns' full sims at once (expensive), or tick distant towns coarsely / on-demand?
- World persistence: one SuperMemory container per world, or per town with a world index?
- Encounter model: continuous shared coordinate space, or a graph of towns with a "distance" scalar?
- Orc mapping: a second `dna.js` interpretation layer, or a per-town "culture" parameter over the same mapping?
