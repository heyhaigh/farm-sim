# Ry Farms — Codex Review r14 Directive (creeds/beliefs memory system + the crafting arc)

You are reviewing a **static ES-module browser sim** (`~/ry-farms`, no build step, no deps beyond
Node built-ins for the dev server). Scope: the **12 commits `1e8f5c5..HEAD`** (HEAD `41816b4`), all
local + unpushed. **Find where it breaks — don't confirm it works.** Report each finding with a
concrete repro (seed, day, farmer, steps; observed vs expected) and the smallest repro. Do NOT commit
fixes — surface findings first, ranked most-severe first.

```
41816b4 #97 Slice 4: harmful items + covert-crime detection (the gated finale)
a4db9c8 #97 Slice 3: recipe diffusion — heard-of vs known, gossip + teaching
dfc4a9e #91 beliefs: composed + varied, not a few canned lines
f036b6e #91 SuperMemory writeback: persist each farmer's compiled life back to the store
a4ff8fd #91 Tier-2/Tier-3: episodic writeback pressures behaviour via belief consolidation
a055c9a YIELD = crops harvested only (not facility produce / forage / loot)
6042ee4 #96 healer moral agency: principled refusal + the denied farmer's reckoning
5b9143f #91 Slice 2 (unfair deals) + rename keepsakes→creeds + healer/UI fixes
cf0a591 #91 Slice 1: keepsake store (compile, don't query) + memory-attributed refusals
c843179 Town Chronicle: NEWS / ROLES / RECIPES tabs
d6f3eb5 #97 Slice 2: procedural invention + trial-and-error discovery
b37e92f #97 Slice 1: Town Healer + ingredient-gated consumables
```

## How to run

- **Syntax gate:** `node -c farm.js && node -c main.js && node -c dna.js && node -c server.mjs &&
  node -c api/_llm.js && node -c api/knowledge-graph.js && node -c api/memory-writeback.js &&
  node -c api/ry-farms-*.js`. ESM client files: `node --input-type=module --check < memory-writeback.js`.
- **Headless harnesses** (in `tests/`, run with `node tests/<name>.mjs`; they import the sim from
  `~/ry-farms` via absolute path — adjust the import path if your checkout differs):
  - `tests/determinism.mjs` — boots a `World`, `addFarmer`s a fixed cast, ticks `(DAY_LENGTH+NIGHT_LENGTH)*N`,
    hashes farmer+world state across TWO runs of the same seed. **Invariant: same seed → identical twice.**
    Current baseline: `20260706=0e4a884d869f51e4`, `42=1361d4d74e92bd5f`, `7=580c8f2d4b21ba7c`. A
    same-seed run that differs run-to-run is a **P0 determinism bug**.
  - `tests/creed.mjs` (28 assertions) — creeds compile-determinism/relevance/attribution, memory-attributed
    refusals, unfair-deal completion + grievance, healer refusal (alignment gate + town split + both
    introspection paths + belief persistence), Tier-3 consolidation (warm/wary, idempotent, reshape, persist).
  - `tests/invention.mjs` (33 assertions) — invention table/locked-harm, craft conservation, trial-and-error,
    diffusion (heard-of vs known, teach transition, persistence, spread), covert sabotage (plant → deferred
    spring → caught + tried, harm stays locked, persistence).
  - `tests/civic.mjs` (31 assertions) — the #94 role kernel (Manager/Watch/Healer) incl. quorum guard.
  - `tests/harness.mjs` is the shared cast (imported by the others).
- **Browser (UI/LLM):** `node server.mjs 8013` (there's a gitignored `.env` with `OPENAI_API_KEY`) →
  `http://localhost:8013`. Test **fresh towns on a non-8000 port** (`?fresh=1` is fine on 8013, NEVER on
  8000). Debug handle: `window.RYFARMS.world`, `window.RYFARMS.select(i)`.

## Doctrines this must satisfy (violations are P0/P1)

1. **Determinism.** The SIM consumes only `world.rand` + per-farmer `this.rand`; same seed ⇒ same town.
   Features that are PLAYER-driven or DISPLAY-only use DEDICATED `mulberry32` streams that must NOT shift
   the digest: creed compile (`compileCreeds`), belief TEXT composition (`#consolidateBeliefs` uses
   `mulberry32(seed^hashString('belief:'+tag)^day)`). Sim-affecting additions (civic votes, unfair deals,
   healer refusals, belief NUDGES, invention, diffusion, sabotage) legitimately RE-baseline the digest but
   must still self-compare. **Look for:** any new code path that reads `Date.now()`/`Math.random()`, iterates
   a `Map`/object whose order isn't canonical, or lets the belief TEXT stream leak into a sim decision.
2. **Compile-don't-query (#91).** The sim NEVER calls SuperMemory in the loop. Creeds are compiled ONCE at
   generation; the writeback (`api/memory-writeback.js` + `memory-writeback.js`) is a pure SIDE-CHANNEL, and
   the READ side (`knowledge-graph.js` `isGenerated`) must exclude ry-farms-tagged docs so a persisted life
   can't regrow a farmer. **Look for:** any place the sim reads back a written doc; a filter that misses a
   tag shape and lets generated docs into the cast; writeback stamping (`sheet.lifePersisted`) that could
   double-write or block forever.
3. **Personality-guard hierarchy.** core personality > need > relationship > recent event > memory. A creed
   or belief is a COLOUR, never the cause: memory-attributed refusals change only the REASON string (not the
   vote); the unfair-deal DRIVE is personality (thrift creed only sharpens); belief nudges are small + one-
   time. **Look for:** a creed/belief modifier that can dominate or flip a decision, or a belief nudge that
   re-applies (not idempotent) and drifts a trait unbounded.
4. **Conservation.** Recipes consume inputs exactly; nothing is created/destroyed off-ledger
   (`transferGood`/`spendCropStock`). Sabotage crafts a harm item by consuming inputs; harm recipes are
   `locked` and must NEVER be craftable via `canCraft`/`applyInvention`/`#experiment`/`#usefulInvention`.

## Where to look hardest (per feature)

- **Creeds + refusals (cf0a591):** `compileCreeds` determinism vs the doc; `creedFor` tie-break stability;
  the `#considerDirective` refusal path — does quoting a creed EVER change heed/refuse, or only the reason?
- **Unfair deals (5b9143f):** `#wantsLowball` gating (never a friend; personality-primary); `#completeBarter`
  unfair branch — the transfer math when `n<2`, the `gave>got` safety return, double-spend, opinion/rep signs.
- **Healer #96 (6042ee4):** the daily-tend cap (`tendedDay`) — can a patient still be tended twice by two
  different carers same day? the refusal alignment gate + `reckonWithRefusal` personality mutation bounds;
  `healerRefuse` iterating `farmers` (self/victim exclusion). Mercy-can't-soft-lock (illness self-resolves).
- **Tier-2/3 beliefs (a4ff8fd, dfc4a9e):** `#consolidateBeliefs` — idempotence (one per tag, cap), the
  `personalityLabel` re-derive, the belief-TEXT stream isolation from the digest, the cause-name regex on
  arbitrary journal text (injection/empty). Does a belief nudge ever push a trait past [0,1] or re-fire?
- **Writeback (f036b6e):** `api/memory-writeback.js` body reader (size cap, bad JSON), the SuperMemory POST
  shape, the deadline race, partial-write resumability; `knowledge-graph.js` `isGenerated` coverage; the
  client one-shot stamp + retry-while-offline; determinism/gameplay untouched.
- **YIELD split (a055c9a):** `cropsHarvested` incremented ONLY in `#doHarvest` (not producers/forage/poach);
  roster sort + card read it; old saves (no field) read as 0 without crashing.
- **Diffusion (a4db9c8):** heard-of vs known decoupling; `#maybeTeach`/'teach' state (student still wants it
  on arrival, distance, bond/xp); gossip in `#maybeChat` (heard-of only, never grants known); persistence.
- **Sabotage (41816b4):** harm stays locked to open crafting; `plantSabotage` affordability + input consume;
  `#fireSabotage` deferred effect (no crop → no crash); `#investigateSabotage` suspicion math — can an
  INNOCENT be convicted (top-suspect without opportunity)? threshold tuning; `holdTrial` generalization;
  `world.sabotage`/`world.suspicion` persistence; a Watch that IS the perp.

## Report format

For each finding: **severity** (P0 determinism/crash/exploit · P1 correctness · P2 balance/legibility ·
P3 nit), **file:line**, the **smallest repro** (seed/day/farmer/steps, observed vs expected), and the
**root cause**. Empty section is a valid answer — say so rather than inventing findings.
