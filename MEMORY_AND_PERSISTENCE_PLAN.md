# Ry Farms — Persistence + Memory Architecture Plan

Council round 2 (weighted: **Fable first, then GPT-5.5**). Two headline directives:
1. **Persistence is the glaring gap** — a town whose thesis is "little people who *remember*" forgets
   everything on reload. Build this FIRST (Fable's #1: small, design-risk-free, multiplies everything).
2. **Path A = compile, don't query.** No live RAG in the sim loop. Distill stable "keepsakes" at
   generation; live retrieval only in the existing expressive channel (llmChat). Cut goods-affinity.

---

## PART 1 — PERSISTENCE (build now)

**Why:** LLM-chat opinion deltas mean the world can't be reconstructed by seed-replay — lived state
must be SERIALIZED. Emergent stories only matter if they accumulate across sessions.

**What to persist** (the non-derivable, lived state):
- **World:** seed, day/season/year/clock, weather, townLevel/townXP/coffers, town traits, chronicle,
  log, bonds (Map), fishedAt (Map), monuments, silo/board/wells/project state, town-level flags.
- **The discovered map:** revealRect + the revealed-tile set + the tile grid mutations (crops planted,
  structures, facilities, stumps, cleared obstacles) — anything that diverged from the seeded terrain.
- **Farmers (per farmer):** identity (seed/mem id so we can regrow the base), pos, hp, energy, level,
  xp, stats, mood/caution, plot (built tier, cells, fence, facilities, fields, house), sheet (produce,
  goods, cropStock, harvested, journal, gossip, opinions, reputation, goal), state-ish resume hints.
- **NOT persisted / re-derived:** seeded terrain (regenerate from seed + apply the stored diffs),
  transient render/audio, in-flight timers (resume to a safe 'decide').

**Mechanism:**
- `world.serialize()` → a plain JSON snapshot (Maps/Sets → arrays; class instances → data). Determinism
  isn't required here — this is a save, not a replay.
- `World.hydrate(data)` / `world.restore(data)` → rebuild instances + Maps/Sets + the tile grid.
- **Save:** on the day rollover + on `beforeunload` / `visibilitychange:hidden`, debounced, to
  **IndexedDB** (localStorage is too small for the map). Keyed by save-slot (seed).
- **Load:** on boot, if a save exists for the current seed, hydrate instead of a fresh gen; a **"PREVIOUSLY
  ON RY FARMS"** catch-up card summarizes the last few chronicle beats (Fable) before resuming.
- **Versioned schema** (a `v` field) + a graceful fallback to fresh-gen if the schema can't be read.

**Guardrails:** save is best-effort (never blocks the sim); a corrupt/absent save → clean fresh start;
a "new town" / reset affordance to wipe the slot. Keep the writer OUT of the tick loop.

---

## PART 2 — MEMORY ARCHITECTURE (SuperMemory storage — start tomorrow)

The user's frame (endorsed): we react to SHORT-term vs LONG-term memories differently. Map that onto
three tiers, aligned with the council's "compile, don't query" + "writeback":

### Tier 1 — LONG-TERM: keepsakes (identity core)
- At generation, distill **3–5 weighted "keepsake" themes/quotes** from the farmer's source SuperMemory
  document (a one-time, cached, deterministic compile pass — NOT live retrieval). These are stable,
  always-available, and define VALUES / SPEECH / REFUSALS (the strong link; goods-affinity is OUT).
- The sim reads only the derived scalars/tags; the raw quote text is used only for narration (say-lines,
  journal, dawn reflections) via the existing llmChat expressive channel (timeout/fallback/clamped).
- **SuperMemory's role:** the store of record for the source documents + the compiled keepsake objects
  per farmer. (Storage + a place for the objects — no live per-decision querying.)

### Tier 2 — SHORT-TERM: episodic (recent lived events)
- Already exists: the **episodic journal** (lesson/person/job/event/chat) with nightly decay
  (0.995…0.90) and a forget floor (0.12). These are recent, situational, FADING — exactly short-term.
- Path A "writeback": new town events (a betrayal, a rescue, the monument, a bad trade) enter this pool
  so origin memories + lived history interact and pressure *recent* behavior.

### Tier 3 — CONSOLIDATION: short → long
- A short-term memory that RECURS or hits high strength graduates into a semi-permanent "formed belief"
  (the existing reflect()→course/goal system is the seed of this: "burned too often → lone wolf").
- Extend it: a repeatedly-reinforced episodic theme can be promoted to a keepsake-adjacent belief that
  then narrates like a long-term memory. This is the psychological bridge the user asked for.

### SuperMemory storage design (tomorrow)
- Per farmer: `{ sourceDocId, keepsakes:[{quote, theme, weight, tags}], episodic:[…decaying…],
  beliefs:[…consolidated…] }`.
- Store keepsakes + accumulated episodic/beliefs in SuperMemory so a farmer's remembered life persists
  and travels with them (and feeds PART 1's save). Retrieval is COMPILE-TIME (keepsakes) or the
  bounded expressive channel (narration) — never the sim decision loop.

---

## PART 3 — Revised Path A first slice (after persistence + SuperMemory storage)
Per the council's convergence (Fable + GPT-5.5):
- **Slice 1 — memory-ATTRIBUTED refusals/remarks.** When a barter completes / is refused / a thief is
  frozen out, the say-line or card QUOTES the farmer's keepsake ("Rivet won't budge — twelve years of
  zero-to-one taught him nothing's free"). One decision type, already on-camera (B2 icon + NOW line),
  memory NAMED so behaviour traces to document. **Acceptance test: can a viewer watching one in-game
  day guess which memory a farmer came from?**
- **Slice 2 (only if slice 1 lands) — memory-attributed UNFAIR deals** (personality/keepsake-driven
  lowballs → grievances), which fixes the "value-fair barter is story-inert" problem through CHARACTER,
  not economics.
- **Guard personality:** hierarchy (core personality > need > relationship > recent event > retrieved
  memory) + a hard cap (no memory modifier larger than an existing personality modifier).

## Deferred / NOT building (council)
- Live per-decision RAG in the sim loop; memory-shaped goods affinities as any early slice; open-ended
  or live-LLM freeform bargaining; a "talk to a farmer" chat backdoor (observer → user); markets/
  currency; any NEW over-head iconography (the icon budget is spent — consolidate, don't stack).
- Watched: attention-economy noise; averaging/failure-templates flattening the cast; the stakes ceiling
  (downed = reset, not death) — the town may eventually need one "one-way door", and cast churn from the
  unused-document pool (more memories become people) — both future, not now.
