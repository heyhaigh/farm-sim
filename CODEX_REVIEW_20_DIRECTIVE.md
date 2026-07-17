# Codex Review #20 — Memory loop, World of Towns, Orc towns, Reconciliation foundation

**Repo:** `/Users/ryanhaigh/ry-farms` (point Codex HERE — not `Documents/ry-farm` or `portfolio-workspace`).
Pure ES-module pixel farm-sim, no build. Public remote `github.com/heyhaigh/farm-sim`.

**What to review:** the entire **unpushed diff** — 10 commits, ~1,127 insertions / 11 files:

```
git diff 46ad7d8..HEAD        # 46ad7d8 == origin/main; HEAD == 58fc1a7
git log --oneline 46ad7d8..HEAD
```

This is a large, coherent body of work spanning five subsystems. It is a **DEEP, COMPREHENSIVE implementation
review** — go at high effort. Rank findings **P0 (breaks / corrupts saves / costs money / breaks determinism)
→ P1 (real bug) → P2 (nit)**, cite `file:line`, give a concrete failing scenario for each, and set a `verdict`
(CONFIRMED / PLAUSIBLE) per finding. If a subsystem is clean, say so explicitly.

**Note on prior review:** the RECONCILIATION *plan* (`ORC_HUMAN_RECONCILIATION_PLAN.md` v2) was already
stress-tested by a 4-voice design council — you are reviewing the **code that implements its foundation**, not
the plan. The other four subsystems (memory loop, world of towns, orc towns, orc branding) have had **no prior
review** — scrutinize them fresh.

---

## The non-negotiable invariants (verify the WHOLE diff upholds ALL of these)

1. **DETERMINISM (#1).** Sim code (`farm.js` sim paths, `dna.js`, `pixel.js`) uses ONLY seeded rng
   (`world.rand`/per-farmer `this.rand`/`mulberry32(hashString(...))`) + stable **sorted** iteration. Same seed
   ⇒ byte-identical town, twice. **No `Date.now()`/`Math.random()`/`new Date()` in sim code** — allowed ONLY in
   the off-sim layers (`worldmap.js`, `save.js`, `api/*`, `memory-writeback.js`). Committed harness
   `node tests/determinism.mjs` self-compares + pins baselines `{20260706:'ba358e06', 42:'5e868c14', 7:'55efd73b',
   3:'da9f09e4'}` (re-baselined this batch when the digest gained creeds+beliefs). `node tests/encounters.mjs`
   is the NEW world-layer harness. **Confirm both pass and that the digest change was a legitimate re-baseline
   (same-twice held), not a masked regression.**
2. **COMPILE-DON'T-QUERY.** The seeded sim NEVER reads LLM or SuperMemory output back into sim state — those are
   founding-time (baked into the save) or display/persistence side-channels. `node tests/llm-chokepoint.mjs`
   must stay green (no model endpoint outside `api/_llm.js`).
3. **FAIL-CLOSED COST SAFETY** (from the prior #101 work — must still hold after this batch): a hidden tab costs
   $0; the writeback throttle + `document.hidden` guards in `main.js` are intact.
4. **CREED (inherited) vs BELIEF (earned)** is a real distinction the new code leans on.

---

## Subsystem A — Close the memory loop (commit `124bb5b`, Phase 0.4/1.1/1.2)
Files: `dna.js` (`growFarmer` seedSalt, `growHeir`), `api/knowledge-graph.js` (lineage read), `farm.js`
(`addFarmer` heir path, heir chronicle), `main.js` (`planHeirs`, sheet LINEAGE section), `README.md`.

- **`growFarmer(memory, mutation, seedSalt, culture)`** — the new `seedSalt` folds an extra term into the seed.
  Verify **empty salt (`''`) reproduces the pre-change farmer byte-identically** (non-heir founding must be
  unchanged — this is why the harness baselines only moved for the digest change, not for founding).
- **`growHeir`** grafts ONE inherited creed at the front + a `f.lineage` provenance block, folding the forebear
  into the seed via salt `heir:${lineage.id}`. Confirm the whole heir (stats/personality/name/creeds) derives
  from one consistent seed; that creeds are capped at 6; that a plain farmer has no `lineage`.
- **`api/knowledge-graph.js` lineage read** — `GET /v3/documents` 404s on self-hosted SuperMemory v0.0.3, so the
  corpus read now **soft-fails** (a `try/catch` around the pagination loop) and lineage rides **`POST /v4/search`**
  (`searchLineage`, `parseLineageFromSearch`, `creedFromFact`, `cleanCreed`). Scrutinize: does a corpus-read
  failure correctly still return lineage? Any unhandled shape from `/v4/search` (it returns extracted-fact
  chunks, grouped per forebear by `(townSeed, farmerSeed)`) that throws? Is the dedup (`seenLife`) correct?
- **`planHeirs(seed, count, pool)`** (`main.js`) — deterministic heir selection (seeded, blend ratio ~1/3,
  capped, ≥1 when a pool exists). Confirm the **determinism harness never has a lineage pool** (it founds via
  `generateCrew`/`addFarmer` with no lineage), so heirs never occur headless → baselines unaffected by heir logic.
- **`tests/ablation.mjs`** (commit `ab624e0`) — is the divergence assertion sound (real/shuffled/fallback digests
  all differ AND each self-compares)? Any way it could pass vacuously?

## Subsystem B — World of Towns (commit `aa6da39`, Phase 2)
Files: `save.js` (world index), `worldmap.js` (NEW model), `main.js` (`townSummary`, `registerWorld`, world-map UI).

- **World-index persistence** (`save.js`: `loadWorldIndex`, `registerTownInWorld`, `saveWorldIndex`) — the merge
  is `{...prev, ...summary}` preserving `firstSeen`. Confirm no lost fields on upsert; best-effort (never throws
  into the sim); IndexedDB round-trip is sound.
- **`worldmap.js`** — `townPos`/`townReach`/`townTint`/`computeLayout` are pure + deterministic (seed-derived).
  Confirm the layout/encounter math has no `Math.random`. `Date.now()` here is display-layer (allowed) — but
  verify it NEVER feeds an outcome (see Subsystem D).
- **World-map UI** (`main.js` `drawWorldMap`, input) — the footer padding + `- WARBAND` glyph + VISIT (reloads
  to `?seed=`). Any hit-region / clamp bug? `worldMapVisit` reachable only when set?

## Subsystem C — Orc towns (commits `b9e195c`, `44ef32b`, `58fc1a7`, Phase 3 + branding)
Files: `dna.js` (`orcify`, `ORC_*`, `growFarmer` culture), `farm.js` (`this.culture`, serialize/`fromSave`,
`ensureFounderVariety` orc names, `generateTownName` culture, `DREAM_DEFS` orc variants), `main.js` (orc sprite
`farmerSprites`/`orcCharSets`, orc UI copy), `worldmap.js`/`main.js` (orc tint + raids).

- **`orcify(sheet, rand)`** — re-skins a finished human sheet. Its rng is `mulberry32(hashString('orc:'+seed))`
  — a **dedicated salt stream**, NOT the base farmer seed. Confirm it does NOT perturb the base rolls (stats,
  personality, memory creeds) — an orc must be the same underlying person, re-skinned; and confirm `culture`
  round-trips through save/`fromSave` (pre-culture saves default to `'human'`).
- **`generateTownName(seed, culture)`** + **`DREAM_DEFS` oyearn/ofulfil** + **`ORC_CREEDS`** + `ensureFounderVariety`
  orc standout names — all **display-only, ids/weights unchanged**. Confirm the human path is byte-identical
  (default `'human'`), so determinism baselines are unaffected. The dream `id`/`aff` must be untouched (only
  `yearn`/`fulfil` prose flips).
- **Orc sprite** (`main.js` `farmerSprites` orc branch → `orcCharSets` slices `threatImg.orc`) — confirm it
  falls back to the procedural farmer when the orc image isn't loaded; the per-farmer cache is keyed correctly;
  no crash if `threatImg.orc` is absent.

## Subsystem D — Reconciliation foundation (commits `a3799c4`, `affa6a3`, `b33cc01`) — SCRUTINIZE HARDEST
Files: `tests/determinism.mjs` (digest), `reconciliation.js` (NEW pure model), `tests/encounters.mjs` (NEW
harness), `worldmap.js` (`detectEncounters` rework), `farm.js` (`World.applyInbox`), `main.js` (envoy digest +
inbox wiring + map link colors).

This is the determinism-critical subsystem. The design guard is: **world-layer decisions are pure functions of
`(lineagePairKey, ordinal, quantized disposition, envoy digests)` — NEVER `Date.now`/`ev.at`/`world.rand`/LLM
text/array index — and the ONLY way a world-layer event touches the seeded town is the town INBOX, consumed
deterministically.** Verify every part of that:

1. **`reconciliation.js` purity** — `lineagePairKey`/`factionLineage` (root = min ancestor seed else own seed;
   is the pair key stable + symmetric?), `foldDisposition` (integer count-based, quantized `toFixed(3)` — any
   float-accumulation or order dependence?), `dispositionTier` (hysteresis — can it thrash at a boundary?),
   `resolveEncounter` (seed drawn ONLY from the allowed inputs — grep for any leak; the betrayal/attend gate
   logic: attendance on curiosity, betrayal on `honesty<0.3` — is it internally consistent?), `applyOutcome`
   (idempotent per ordinal). **`tests/encounters.mjs` scans the module for `Date.now`/`Math.random`** — confirm.
2. **`worldmap.js detectEncounters`** — now resolves cross-faction meetings through the model + maintains
   `index.ledgers[lpk]` + queues `index.inbox[townSeed]`. Scrutinize:
   - The geometry changed to `dx*dx+dy*dy > rr*rr` (exact) — correct?
   - The **ordinal** is `led.grievances.length + led.reconciliations.length` — does that stay consistent across
     the idempotent `applyOutcome`, and is it stable if the same pair somehow re-enters (the `met` set should
     prevent it — confirm)?
   - The **envoy** is read from the town SUMMARY (`human.envoy`/`orc.envoy`), baked by `townSummary`. Is there a
     safe fallback (`{seed}`) when a summary predates the envoy field (old world index)?
   - `index.v = WORLD_INDEX_VERSION (2)` — is there a **migration** concern? An old v1 index has string-only
     `encounters` and no `ledgers`/`inbox`. Confirm the new code tolerates a v1 index without corruption
     (defaults `ledgers={}`, `inbox={}`).
3. **`farm.js World.applyInbox(events)`** — the world→sim crossing. Confirm: events are **sorted**
   `(day, pairKey, kind, ordinal)` before applying (determinism given the inbox); the **raid stake** dock
   (`harvestTotal * 0.2`) can't go negative and doesn't break anything downstream that reads `harvestTotal`
   (reach on the map, roster yield, milestones/expansion triggers — does any expansion/level gate read
   harvestTotal and misbehave when it drops?); reconcile/betray only `remember()` + chronicle (no belief-machinery
   mutation yet — confirm they don't push into `sheet.beliefs` in a way `#reviseBeliefs` would choke on).
4. **`main.js` inbox wiring** — consumed at **boot** (before the resume card, so while-away raids show in
   "PREVIOUSLY ON") and after each `registerWorld` encounter pass; each consumption **clears** the town's inbox
   slice and saves the index. Confirm: no double-consumption (cleared after apply); the `w === world` guard;
   failure is swallowed (never breaks boot/sim).
5. **THE determinism claim** — the harness (`tests/determinism.mjs`) founds ONE `World` and ticks; it never
   boots the world layer or calls `applyInbox`, so the town stays reproducible. **Confirm the harness genuinely
   cannot see any inbox/world-layer state** — i.e. `applyInbox` is only ever called from `main.js` (browser),
   never from a sim path the harness exercises. If any sim tick path calls into the world index, that's a **P0**.
6. **Digest extension** (`tests/determinism.mjs`) — snapshot now includes `creeds:[theme,weight]` +
   `beliefs:[tag,strength]` in natural order. Confirm these are the right fields and that natural (unsorted)
   order is intentional (catches an ordering bug) and deterministic.

## Cross-cutting
- **Serialization round-trip:** every new piece of persisted state must survive save→`fromSave`: `this.culture`
  (farm.js), `sheet.lineage` + inherited creed (rides `sheet`), the world-index `ledgers`/`inbox`/`v`
  (save.js). What would a builder have forgotten to serialize?
- **No sim-path clock/rng:** grep the sim files (`farm.js`, `dna.js`, `pixel.js`) for `Date.now`/`Math.random`
  introduced in this diff.
- **Save/version safety:** a player with an OLD town save or OLD world index must load without corruption
  (culture defaults human; index defaults ledgers/inbox empty; digest fields default empty).

## What I already ran (confirm independently, don't take on faith)
`node -c` clean on all files; `node tests/determinism.mjs` (4 seeds, same-twice, baselines above);
`node tests/encounters.mjs` (world-layer model); `node tests/llm-chokepoint.mjs`; `node tests/ablation.mjs`;
browser boot clean (no console errors) incl. the inbox-consume path.

## Output
Per finding: `P0/P1/P2 — file:line — one-line defect — concrete failing scenario → wrong result — verdict`.
Then a one-line verdict per subsystem (A memory-loop / B world-of-towns / C orc-towns / D reconciliation —
ship-ready?), and a special call on **Subsystem D's determinism claim** (is the world-layer→sim boundary
actually airtight, or can a world-layer non-determinism leak into a harnessed town?).
