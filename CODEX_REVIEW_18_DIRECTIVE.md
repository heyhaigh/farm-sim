# Codex Review #18 — Hatch House (#100) + Stale-Tab Cost Safety (#101)

**Repo:** `~/ry-farms` (public remote `github.com/heyhaigh/farm-sim`). Pure ES-module farm sim, no build.
**What to review:** the current **uncommitted working tree vs `HEAD` (`49f1ad1`)**. Four files:

```
git diff HEAD -- farm.js main.js memory-writeback.js pixel.js
```

Two feature batches are bundled in this diff:
- **#100 Hatch House / livestock feeding + Mill** — `farm.js` (mill + hatchery + feeding logic), `pixel.js` (`makeMill`/`makeHatchery`/`makeGrainIcon`), plus the mill/hatch sprite wiring, TALES-tab colour, and unread-badge bits in `main.js`.
- **#101 Stale-tab cost safety** — `main.js` (tab-visibility guards), `farm.js` (`tryLlmChat` guard), `memory-writeback.js` (writeback throttle).

This is a **hackathon entry** (SuperMemory-hosted). Please review at your normal depth and return findings ranked **P0 (breaks/costs money) → P1 (real bug) → P2 (nit)**. Cite `file:line` and give a concrete failing scenario for each. If a batch is clean, say so explicitly.

---

## Non-negotiable invariants — verify the diff upholds ALL of these

1. **DETERMINISM (#1 doctrine).** The sim must use ONLY seeded rng (`world.rand = mulberry32(seed)`, per-farmer `this.rand`) with stable, sorted iteration. Same seed ⇒ byte-identical town. **No `Date.now()` / `Math.random()` / `new Date()` in sim code** (`farm.js` sim paths, `pixel.js`). `Date.now()` is allowed ONLY in the off-sim I/O layer (`memory-writeback.js`, server `api/*`). The committed harness `tests/determinism.mjs` self-compares + pins baselines `{20260706:'19d53747', 42:'bc8b8504', 7:'2b9d51b5', 3:'2ce57075'}`. **Confirm the Hatch House / feeding logic introduces no unseeded randomness or unstable iteration order** (e.g. `#hatchClutches`, flock scaling, mill production). Flag any `for...in`/`Object.keys` over a map that feeds sim state without a stable sort.

2. **COMPILE-DON'T-QUERY / display-only side channels.** The seeded world must NEVER read LLM or SuperMemory output back into sim state — those are presentation/persistence only. Verify nothing in this diff makes the sim branch on `recipeFlavor`/`taleFlavor`/writeback results.

3. **FAIL-CLOSED COST SAFETY (this is the point of #101).** After a $27→$31 unexpected-billing incident, the rule is: **a backgrounded/forgotten browser tab must cost $0.** Two paid paths existed: (a) the game's own LLM chat, and (b) SuperMemory's extraction fed by the game's memory **writeback**. Verify #101 actually closes both from a hidden tab (details below). Also confirm the existing `tests/llm-chokepoint.mjs` guard still passes — no new file reaches a model endpoint outside `api/_llm.js`.

---

## #101 — scrutinize this logic specifically

### A. Tab-visibility guards (`main.js`)
- `tryEnrich` and `tryPersist` (both on `setInterval`) now early-return when `document.hidden`. **`setInterval` keeps firing in a hidden tab** (unlike rAF) — confirm these guards are the thing that stops the writeback loop that fed SuperMemory's paid extraction. Is `document.hidden` the correct predicate (vs `visibilityState`)? Any path where the interval callback still does paid work before the guard?
- `syncTabHidden()` sets `world._tabHidden = document.hidden` on `visibilitychange` and once at boot. **Edge case to check:** the world reference can be REPLACED (new town / `?fresh`). If `world` is reassigned after boot, does `_tabHidden` get re-synced on the new world before the sim reads it? (It's set on `visibilitychange` and boot — is there a window where a freshly-created world has `_tabHidden === undefined`? Undefined is falsy → chat allowed → acceptable while visible, but confirm no hidden-tab gap.)

### B. Chat guard (`farm.js` `tryLlmChat`)
- `if (this._tabHidden) return false;` added before the inflight/cooldown checks. Confirm `this._tabHidden` is the SAME object main.js writes to (`world._tabHidden`). The sim runs headless in tests where `_tabHidden` is `undefined` → falsy → no behaviour change → determinism safe. Verify that reasoning holds.

### C. Writeback throttle (`memory-writeback.js`)
- `worthPersisting(life)` = `beliefs.length >= 1 || episodic.length >= 3`. Intent: don't ingest thin day-one lives (kills the fresh-boot 16-way fan-out). **Check:** does this permanently STARVE a legitimately sparse farmer who never forms a belief and has <3 memories? Is that acceptable (they're genuinely not worth a doc) or a data-loss bug for the portal?
- `if (pending.length > MAX_PER_PASS) pending.length = MAX_PER_PASS;` (cap 4/pass). Confirm truncating a JS array via `.length =` is intended and that the dropped farmers are simply re-evaluated next pass (their `sheet.lifeSig` was NOT stamped, so they remain pending — verify the stamp only happens for lives that actually `landed`). Any risk the SAME 4 always win and a 5th never persists? (Iteration is `world.farmers` order — stable, but is it FAIR?)
- The change-gate (`sig === f.sheet.lifeSig` skip) + `lifeSig` carried in the save means a same-town reload re-posts nothing. Confirm the throttle didn't break the stamp/settle logic below it.

---

## #100 — scrutinize this logic specifically

- **Mill economy:** `MILL_WHEAT_IN=2 → MILL_GRAIN_OUT=10`, `MILL_GRAIN_STOCK=24`. Grain feeds chicken/fish (`FEED_GOOD`). A 400-day balance test moved grain-eaters from avg-fed 0.02 → 0.42. Check the mill can't produce grain from nothing (must consume wheat via `#spendWheat`), and that a mill owner with no wheat + no barter path doesn't deadlock or spin.
- **Hatch House:** `HATCH_EGGS_PER_CHICK=2`, `HATCH_CLUTCH=3`, `HATCH_DAYS=4`, `FLOCK_CAP=12`. `#hatchClutches()` runs on day-rollover and uses `f.rand()` (seeded — confirm). Verify: eggs are actually consumed to hatch; the flock can't exceed `FLOCK_CAP`; a clutch in flight serializes/deserializes correctly (`fac.clutch` in save/`fromSave`) so a mid-incubation reload doesn't drop or double a clutch.
- **Feeding gate:** `#hasFeedFor` / `#wheatOnHand` / `cropForField` flock-scaled wheat (`wheatFields = clamp(ceil(eaters/3), 2, 6)`). Confirm no divide-by-zero when `eaters === 0` and no unbounded field growth.
- **By-products:** `#doCollect` credits `ownerSheet.goods[name]` (eggs/milk) instead of `payHarvestShares`. Confirm helpers still credit the OWNER (not the helper) and that goods can't go negative.
- **Rendering only (low risk):** mill/hatch sprite selection in `collectDrawables`, `T.HATCH` in the terrain colour maps, TALES wrapped-line colour (`it.e.color`), unread-badge `_chronTotal`. Confirm `T.HATCH` was added to every place `T.MILL`/`T.COOP`/`T.BARN` are enumerated (grep for omissions — a missed enum = an unpainted or mis-picked tile).

---

## What I already verified locally (please independently confirm, don't take on faith)
- `node -c` clean on all four files.
- `node tests/determinism.mjs` → all 4 seeds self-compare identical, baselines unchanged (no drift from this diff).
- `node tests/llm-chokepoint.mjs` → intact (every model call still routes through `api/_llm.js`).
- SuperMemory reconfigured to local Ollama (`OPENAI_MODEL=qwen2.5:7b`, `OPENAI_BASE_URL=127.0.0.1:11434`, dummy key) — extraction proven to hit Ollama, 3 memories extracted + searchable, zero OpenAI. **NOTE:** this config lives in `~/.supermemory/env` (OUTSIDE the repo, gitignored) — not part of this code diff, but relevant context for why the writeback path is now free even when it does fire.

## Output format
For each finding: `P0/P1/P2 — file:line — one-line defect — concrete failing scenario → wrong result`. Then a one-line verdict per batch (#100 ship-ready? #101 ship-ready?).
