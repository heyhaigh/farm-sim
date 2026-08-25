# Running and testing

## Run the game

```sh
OPENAI_API_KEY= node server.mjs 8123      # then open http://localhost:8123
```

The blank key keeps the LLM endpoints in fallback so nothing bills. **Do not use
`python3 -m http.server`** — it serves stale modules, which has cost real debugging time.

Useful boot flags: `?seed=424242` (a specific town), `?play=1` (resume the last one), `?orc=1` (the orc
biome), `?fresh=1` (found new — refuses over an occupied slot). No parameters at all gives the start screen,
whose town is a non-persisting backdrop.

`window.RYFARMS` is the debug surface: `world`, `speed(n)`, `saveNow()`, `peekSave()`, `restoreSave()`,
`demoFaceoff()`, `demoRaid()`, `goTo(i,j)`, `wipeSave()`, `undoWipe()`.

## The suite — all `node tests/<name>.mjs`

Run them all before pushing. Several protect properties that no amount of care at the call site will.

| file | protects | speed |
|---|---|---|
| **`compat.mjs`** | **save compatibility** — terrain generation, the per-tile hash families (sim *and* render), the order of every save-referenced table, and the migration chain | 0.5s |
| **`seo.mjs`** | **public discovery contract** — canonical URL, metadata, entity graph, crawler files, and `/index.html` canonicalization | fast |
| `determinism.mjs` | the #1 invariant: same seed ⇒ byte-identical town, twice. Four pinned digests + a save round-trip | ~90s |
| `paddock.mjs` | facilities, ponds and footprints — what `determinism.mjs` structurally cannot reach, because facilities gate on house tier and no farm reaches one inside its 30-day window | ~30s |
| `worldindex-bounds.mjs` | the world index stays bounded and prunes correctly | fast |
| `encounters.mjs` | world-layer determinism (cross-town reconciliation) | fast |
| `writeback-guards.mjs` | the memory writeback cannot re-enter as a source memory | fast |
| `lineage.mjs` | a founder's past life is re-sited at a town that really stood | fast |
| `llm-chokepoint.mjs` | **cost safety** — fails if any file other than `api/_llm.js` reaches a model endpoint | fast |
| `counteroffensive.mjs` | the grievance ledger and the hero-called vote | fast |
| `ablation.mjs` | memory is load-bearing: same seed, different memory sources ⇒ observably different societies | slow |
| `raid-adversarial.mjs` | raid resolution under adversarial inputs | slow |
| `gate-loop.mjs` | the mobile gate never forks a second render loop — a throw leaves a backoff pending, and a context loss+restore before it fires used to start a duplicate that ran forever (61 vs 122 renders/sec) | fast |
| `gate-layout.mjs` | the **mobile gate's** geometry across real device sizes — the one screen most first-time visitors see, and otherwise unreachable by the suite (it needs a canvas and a matching media query) | fast |
| `postcard.mjs` | the **share link is the town**: minted URL shape (incl. the `&orc=1` an orc link must carry), seed coercion mirroring the boot, and OG injection against the real `index.html` | fast |
| `inspiration.mjs` | the **seeds ledger**: QUESTION-only deposits (once per kind/day, target kept), DEFY zeroing, headroom scaling, dawn decay/floor, lapsed-urge residue, old-save guard, and whisper-gating (no seeds headless) | fast |

## Reading a failure

**`compat.mjs`** reports per part, so a drift names itself:

- `tiles` — the founding valley changed
- `frontier` — the generated wilderness changed (this is the one that seams against a player's already-explored chunks)
- `attrs` — a sim-side per-tile hash changed (`obstacleTier`, `forageIngredient`, `treeStageAt`)
- `look` — a render-side one changed (`grassPatch`, `pickIndex`, jitter and its spreads)
- `content tables` — a save-referenced list changed. The digest hashes whole arrays, so this moves on a safe
  **append** as well as a destructive **reorder** — check which you did before re-pinning. It covers the `T`
  enum, `PROJECT_DEFS` order, `HOUSE_TIERS` names, `FACILITY_DEFS` keys, `CRAFTABLES` ids and
  `FORAGE_INGREDIENTS`; it does NOT cover `struct.kind`, `producer.kind`, crop ids or `sheet.seed`

`attrs` and `look` take no seed: they are a property of the code, not of any world, so they are pinned once.

**Any of these moving is a compatibility event, not a routine re-baseline.** If you genuinely intended it,
re-pin deliberately and say why in the commit.

The digests depend on floating point (`Math.hypot`, `exp`, `sin`, `cos` in the generation path), which
ECMAScript leaves implementation-approximated. The canonical runtime is recorded beside the baselines, and a
failure prints the current one — **if every part moves at once and the runtime also changed, suspect the
runtime before the code.**

## Verifying by hand

Some things only a browser shows. Drive the real game rather than trusting a unit test:

- Serve, boot a junk seed, and watch. The float bug — farmers sliding with no walk cycle — was found by eye,
  not by a harness.
- For save/slot behaviour, `import('./save.js')` from the console and call the API directly; craft a fake
  writer with a chosen `(gen, rev)` to prove a refusal actually refuses.
- To induce a storage failure without exhausting real storage, monkey-patch `IDBObjectStore.prototype.put` to
  throw `QuotaExceededError` for the key you care about. No production seam needed.

## When a test claims coverage it does not have

This has happened repeatedly in this project, and it is worth knowing the shape:

> **Mutation-test each callsite separately.** Break the thing the test is supposed to catch, one change at a
> time, and confirm the test fails *and* that the mutation actually applied. Assert the mutation landed.

Three separate versions of `compat.mjs` passed mutation tests they should have failed — sampling tree stages
at a day where every tree was already mature; a lattice that stepped over a 4-tile ring; a sample too sparse
to contain a 0.01 slice in a distribution's tail. Each looked like coverage. If a case is genuinely
untestable, write that down rather than faking it.
