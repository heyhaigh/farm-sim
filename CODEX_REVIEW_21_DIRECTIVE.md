# Codex Review #21 — verify the r20 fixes (re-review)

**Repo:** `/Users/ryanhaigh/ry-farms` (point Codex HERE). Pure ES-module farm-sim, no build.

**What to review:** the current **unpushed diff vs `origin/main`** — the same coherent body reviewed in r20,
now with the six r20 findings fixed (fix commit `9176a87`):

```
git diff origin/main..HEAD
git show 9176a87 --stat        # the r20-fix commit specifically
git log --oneline origin/main..HEAD
```

This is a **RE-REVIEW**. Two jobs: (1) confirm each of the six r20 findings is **actually resolved and
regression-free**, then (2) adversarially scrutinize the **new fix code** (atomic RMW, inbox idempotency,
lineage-root propagation, the ablation digest) for anything the fixes introduced. Rank **P0 → P1 → P2**, cite
`file:line`, give a concrete failing scenario + `verdict` (CONFIRMED/PLAUSIBLE) per finding. If clean, say so.

The invariants still bind: **determinism** (seeded rng + stable sorted iteration; same seed ⇒ same town twice;
`tests/determinism.mjs` baselines `{20260706:'ba358e06',42:'5e868c14',7:'55efd73b',3:'da9f09e4'}`),
**compile-don't-query** (`tests/llm-chokepoint.mjs`), **the world-layer→sim boundary is the inbox only**, and
`tests/encounters.mjs` + `tests/ablation.mjs`.

---

## The six r20 findings — verify each is closed AND regression-free

### 1. (was P1) Lineage discarded when the source corpus is empty — `dna.js` `fetchMemories` / `main.js`
**Fix:** extract `lineage` BEFORE the empty-docs bail; throw only if BOTH docs and lineage are empty; return
`memories: docs.length ? docs : null`; `main.js` sets `lineagePool = Array.isArray(result.lineage) ? … : []`
(independent of `memorySource`).
**Verify:** on a v0.0.3-shaped response (docs empty, lineage non-empty) the loop now closes — heirs are planned.
Confirm: no path where `memories: null` + lineage present breaks the caller (`generateCrew` fallback still runs;
`memorySource` still reads `'invented'`; the honesty caption is still truthful). Does an ENTIRELY empty response
(both empty → throw → catch) still yield the invented fallback with `lineage: []`?

### 2. (was P1) Racy world-index read-modify-write — `save.js` `updateWorldIndex` / `main.js` `registerWorld`
**Fix:** `updateWorldIndex(mutator)` does get+mutate+put in ONE IndexedDB readwrite transaction; `registerWorld`
runs register + `detectEncounters` + inbox-read inside the mutator.
**Verify — this is the sharpest new-code check:**
- **The mutator MUST be synchronous** — any `await` inside would let the IDB txn auto-close and the put be lost.
  Confirm `registerWorld`'s mutator (townSummary + detectEncounters + inbox read) contains **no await** and
  nothing async. `townSummary` uses `Date.now()`/`hashString` (sync) — ok. `detectEncounters` is sync — ok.
- Two concurrent `updateWorldIndex` calls: IDB serializes readwrite txns on a store, so the second sees the
  first's committed value. Confirm there's no remaining non-atomic write path for the ledger/inbox
  (`saveWorldIndex` still exists — is it still used anywhere in a way that could clobber? e.g. memory-graph.js,
  the world-map open path).
- The `tx.abort()` on a throwing mutator — does it reject cleanly (caller gets `null`, never a half-write)?

### 3. (was P1) Non-atomic inbox / exactly-once — `farm.js` `applyInbox` / `worldmap.js` `queueInbox` / `main.js`
**Fix:** every inbox event gets a stable `id = pairKey:ordinal:kind`; `applyInbox` skips ids already in
`this._inboxApplied` (serialized, capped at 200); consumption order is **apply → `saveTown` → clear inbox
atomically** (boot + `registerWorld`).
**Verify:**
- **The 200-cap eviction edge:** if `_inboxApplied` is trimmed to the last 200 and an OLD event id is still
  sitting in an uncleared inbox (e.g. a town dormant a very long time), could that evicted id be re-applied →
  a double raid-dock? Is 200 safely larger than any plausible uncleared-inbox backlog? Flag if this is a real
  double-charge window.
- **Ordering correctness:** walk the crash cases — (a) crash after `applyInbox` before `saveTown` (town reverts,
  inbox uncleared → re-apply → idempotent skip? but the applied-id was in-memory only, not saved — so on reload
  the id is GONE and the event re-applies for real; is that correct? the harvest dock also reverted, so
  re-applying once is right — confirm it's exactly-once, not zero or twice); (b) crash after `saveTown` before
  clear (id saved, inbox uncleared → re-apply → skip — good); (c) `updateWorldIndex` clear returns null (inbox
  uncleared → next boot skip via saved id — good). Confirm all three land exactly-once.
- `applyInbox` returns a truthy count only when it applied something — the `&& w.applyInbox(mine)` guard in
  `registerWorld` gates the saveTown+clear on that. If every event was a duplicate (returns 0), the inbox is
  NOT cleared — is that a leak (stale duplicates linger forever)? Should a fully-duplicate inbox still be cleared?

### 4. (was P1) Lineage root not propagated — `reconciliation.js` `factionLineage` + `farm.js` + `main.js`
**Fix:** `world.lineageRoot` (constructor = own seed; serialized; `fromSave` restored), resolved at founding
from heirs' forebears via the world index (`min` of `anc.lineageRoot ?? ofTownSeed`); `townSummary` +
`computeLayout` carry it; `factionLineage` uses it (fallback to ancestor/own-seed for legacy summaries).
**Verify:**
- A 3-generation chain (town A → heir town B → heir town C) now shares ONE `factionLineage` key against a given
  orc lineage. Trace: does C's root resolve to A's seed (via B's stored `lineageRoot`), not B's?
- **Degradation when the forebear town isn't in the LOCAL world index** (heir grown from a forebear read out of
  SuperMemory that was played on a different browser/store): the resolver falls back to `ofTownSeed` (a fresh
  root, not the true origin). Is that acceptable graceful degradation, or does it silently fragment ledgers in
  a common case? (Note it; the writeback doesn't carry the root, by design.)
- Determinism: `lineageRoot` resolution reads the world index (off-sim) at FOUNDING only, and the harness founds
  without heirs → `lineageRoot = seed` → no behavior change. Confirm the harness baselines are legitimately
  unchanged and nothing in the sim tick reads `lineageRoot`.

### 5. (was P2) Cross-endpoint lineage dedup — `api/knowledge-graph.js`
**Fix:** dedup by `lifeKey = (townSeed, farmerSeed)` in the search-merge, not the incompatible ids.
**Verify:** a forebear returned by BOTH the legacy `/v3` loop and `/v4/search` now enters once. Does `lifeKey`
have a safe fallback when `farmerSeed`/`townSeed` are missing (it uses `name ?? id`)? Any collision risk (two
distinct forebears with the same name and no seeds)?

### 6. (was P2) Ablation test proved nothing — `tests/ablation.mjs`
**Fix:** the digest dropped `seed`/`pos` (identity, differs by source doc regardless of behavior) and now
fingerprints the identity-independent society (sorted archetype mix + aggregate stats + XP + harvest).
**Verify:** would the test now FAIL if memory were made inert (e.g. archetype forced constant)? I.e. is the
divergence assertion actually load-bearing, or can archMix/statTotals still differ from something identity-ish?
Confirm each source still self-compares (determinism) AND the three diverge for the RIGHT reason.

---

## Also confirm (regression sweep)
- **Subsystem C (orc towns)** was clean in r20 — the r20-fix commit touched `farm.js`/`main.js`/`dna.js`; confirm
  it didn't regress culture serialization, orc naming/dreams, or the sprite path.
- **Serialization round-trip** of the NEW save fields: `culture`, `lineageRoot`, `inboxApplied` all survive
  save→`fromSave`; an OLD save (missing them) loads with safe defaults (culture human, root = seed, applied []).
- **No sim-path `Date.now`/`Math.random`** introduced by the fixes (the new clocks are in `save.js`/`main.js`
  off-sim paths only).

## What I ran (confirm independently)
`node -c` clean on all; `node tests/determinism.mjs` (baselines above, same-twice); `node tests/encounters.mjs`;
`node tests/ablation.mjs` (still diverges); `node tests/llm-chokepoint.mjs`; browser boot clean through the
reworked atomic-inbox/founding path (no console errors).

## Output
Per finding: `P0/P1/P2 — file:line — defect — failing scenario → wrong result — verdict`. Then: are the six r20
findings **RESOLVED**? Any NEW findings from the fixes (esp. the mutator-sync / 200-cap / duplicate-inbox-clear
edges)? One-line verdict per subsystem.
