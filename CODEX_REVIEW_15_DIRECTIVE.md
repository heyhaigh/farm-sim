# Ry Farms — Codex Review r15 Directive (the full unpushed backlog: memory-depth + the crafting arc + the memory portal)

You are reviewing a **static ES-module browser sim** (`~/ry-farms`, no build step, no bundler; the only
runtime is Node's built-in http server in `server.mjs` plus a handful of `/api/*.js` handlers). This is a
**big review** — it has been a long time since the last one. Scope: **all 29 local, unpushed commits
`14cf059..dd5b9a7`** (origin/main = `14cf059`, HEAD = `dd5b9a7`). These span three intertwined efforts:
memory-depth (creeds/beliefs), the generative **crafting arc** (P1→P6 + folk heuristics + tale lore), and
the **SuperMemory memory portal** (#95) with civic memory (#94 P3).

**Your job is to find where it breaks — not to confirm it works.** Report each finding with a concrete
repro (seed, day, farmer, exact steps; observed vs expected) and the smallest reproduction. **Do NOT commit
fixes** — surface findings first, ranked most-severe first. An empty section is a valid, welcome answer;
say "clean" rather than inventing findings.

---

## The 29 commits (oldest → newest)

```
70ce0e3 #91 W1: document-specific creeds — a per-doc lexicon + varied phrasings
919e7c4 #91 W2: beliefs erode + reverse; personality drift is bounded
72e9f7c Untether default farmers from the initial SuperMemory corpus
473854b #97 W4: trial legibility + no healer-saboteur
0ee8e13 #97 W3: invention throttle + a knowledge observe-valve
c64954c Quick fixes: honest doctrine gate + writeback dedupe
076836d docs: mark memory-depth workstreams W1-W5 + untether shipped
83542c4 SuperMemory local: fix writeback doc shape (metadata must be strings)
4226e42 Add supermemory-start.sh — one-command start for the local memory server
b2a4a55 Add the memory portal (#95): an interactive graph of the town's stored lives
d1c693b Settings: add a "View the town's memory" link to the portal
7f32572 Portal: explode each farmer's memories into satellite nodes
9229b6e Portal: cool the force layout so nodes settle and hold still
4b41465 Portal: reskin in the sim's own aesthetic (bitmap font + CRT shader)
6cf3aec #94 P3: town elections + civic memory (the town remembers who it chose)
ec522f0 Portal: surface the town's civic record as a gold TOWN hub node (#94 P3 / #95)
1e8eb98 Fix SuperMemory writeback: persist LIVED memories, and refresh over time
79741c3 Generative crafting foundation: ingredient essences + combinatorial derivation
b15084e Crafting P1 rework (post-council): rarity-gated tiers + output identity
03f9244 Crafting P2: ingredient sourcing + rare wild spawns
0e13538 Crafting: re-tier the legacy cures so rarity gates the ECONOMY (Fable catch)
4bcc9ea Crafting P3: the discovery loop — farmers invent generatively on their own
13928db Crafting P4: the myth loop — tales grown from memory -> belief -> seek -> validate
3f24d84 Crafting P5: LLM names each invention (shadow store) + SuperMemory recipe nodes
62e3ad6 Crafting P6: RECIPES tab shows the generative inventions + the town's tales
4eec127 RECIPES tab: make it scrollable so all inventions are visible
e5426ff Crafting P3+: folk-heuristic strategies drive invention
a0607ca Memory portal: per-farmer fan-out so every settler is represented
dd5b9a7 Tales: show full lore in the Chronicle, grown from the founder's memory
```

Files touched across the range (diffstat): `farm.js` (+996/-… the sim), `main.js` (render/UI), `dna.js`
(creeds/lexicon/personality), `api/memory-graph.js` **(new)**, `api/memory-writeback.js`, `api/ry-farms-invent.js`
**(new)**, `memory-invent.js` **(new, browser client)**, `memory-writeback.js` (browser client),
`memory-graph.html` **(new)**, `server.mjs`, `supermemory-start.sh` **(new)**, `MEMORY_DEPTH_PLAN.md`.

---

## How to run

**Syntax gate** (must all pass):
```
node -c farm.js && node -c main.js && node -c dna.js && node -c pixel.js && node -c crt.js && \
node -c save.js && node -c conscience.js && node -c dm.js && node -c server.mjs && \
node -c api/_llm.js && node -c api/knowledge-graph.js && node -c api/memory-graph.js && \
node -c api/memory-writeback.js && node -c api/ry-farms-chat.js && node -c api/ry-farms-dm.js && \
node -c api/ry-farms-conscience.js && node -c api/ry-farms-invent.js
# browser-side ES modules:
node --input-type=module --check < memory-invent.js
node --input-type=module --check < memory-writeback.js
```

**Determinism harness** (self-contained — paste to `det.mjs` in the repo root and `node det.mjs`; it imports
the sim by absolute path, adjust if your checkout differs). LLM + SuperMemory are OFF (never imported), which
is exactly the point: **the sim's outcome must not depend on them.**
```js
import { World } from '/Users/ryanhaigh/ry-farms/farm.js';
import { generateCrew, hashString } from '/Users/ryanhaigh/ry-farms/dna.js';
const DT = 1/30, DAYS = 30;
function boot(seed){
  const m = generateCrew(seed); const u = new Set();
  const pick = () => { const un = m.filter(x=>!u.has(x.id)); let b=un[0],bh=0xffffffff;
    for(const x of un){const h=hashString((x.id||x.title||'')+':pick'); if(h<bh){bh=h;b=x;}} u.add(b.id); return b; };
  const w = new World(seed); for(let i=0;i<8;i++) w.addFarmer(pick(),0); w.ensureFounderVariety(); return w;
}
function fnv(s){ let h=0x811c9dc5>>>0; for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,0x01000193)>>>0; } return ('00000000'+h.toString(16)).slice(-8); }
function digest(seed){
  const w = boot(seed); const t = w.day + DAYS; while(w.day<t) w.tick(DT);
  const snap = {
    day:w.day, year:w.year, season:w.season,
    recipes:Object.keys(w.recipes||{}).sort(),
    tales:(w.tales||[]).map(x=>[x.ingredient,x.originSeed]).sort(),
    roles:w.roles?{manager:w.roles.manager?.sheet?.seed??null, watch:w.roles.watch?.sheet?.seed??null}:null,
    farmers:w.farmers.map(f=>({seed:f.sheet.seed, xp:f.sheet.xp, lvl:f.sheet.level,
      inv:(f.sheet.recipes||[]).slice().sort(), belief:f.sheet.rareBelief||{},
      goods:f.sheet.goods||{}, produce:f.sheet.produce||0, i:f.pos.i, j:f.pos.j})),
  };
  return fnv(JSON.stringify(snap));
}
for(const s of [20260706,42,7,3]){ const a=digest(s), b=digest(s); console.log(`seed ${s}: ${a} same-twice=${a===b}`); }
```
**Baseline at HEAD `dd5b9a7`** (30-day run, LLM/SuperMemory off): `20260706=5029b06a`, `42=e763b484`,
`7=74f1658d`, `3=95a3e9cb` — all `same-twice=true`. **A same-seed run that differs run-to-run is a P0
determinism bug.** (These exact hashes are only a fingerprint of this frozen tree; a legitimate sim-affecting
change would re-baseline them, but the same-twice invariant must always hold.)

**Browser (UI + LLM + portal):** `node server.mjs 8013` (a gitignored `.env` supplies `OPENAI_API_KEY`, and
`OPENAI_BASE_URL` may point at a local Ollama) → `http://localhost:8013`. Test **fresh towns on a non-8000
port**: `?fresh=1` is fine on `:8013`, **NEVER on `:8000`** (that's the persisted primary town). Debug handle:
`window.RYFARMS.world`, `window.RYFARMS.select(i)`, `window.RYFARMS.speed(mult)`. The portal is a separate
page: `http://localhost:8013/memory-graph.html` (needs the self-hosted SuperMemory store running on `:6767`;
without it the page shows an offline state — see `supermemory-start.sh`).

---

## Doctrines this must satisfy (violations are P0/P1)

1. **Determinism is the #1 invariant.** The SIM consumes ONLY `world.rand` (`mulberry32(seed)`), per-farmer
   `this.rand`, and pure position hashes — with STABLE, SORTED iteration. Same seed ⇒ identical town, twice.
   DISPLAY-only or PLAYER-only features must use DEDICATED `mulberry32` streams seeded from stable data and
   must NOT advance the sim stream or enter the digest. **Look hardest for:** any new path reading
   `Date.now()`/`new Date()`/`Math.random()`; iteration over a `Map`/plain object whose insertion order
   isn't canonical and that feeds a sim decision; a "flavor" text stream leaking into a gameplay branch.
2. **Compile-don't-query.** The sim NEVER calls SuperMemory or the LLM in its decision loop. Creeds/beliefs
   are compiled at founding; farmers act on the past via IN-SIM memory (`journal`, `opinions`, `beliefs`,
   `civic.impressions`, `rareBelief`, `triedCombos`), read live each tick. SuperMemory (`api/memory-*`) +
   LLM (`api/ry-farms-invent.js`) are pure SIDE-CHANNELS with procedural fallbacks. Invention/tale FLAVOR
   text lives in `world.recipeFlavor` / `world.taleFlavor`, which are EXCLUDED from the digest — **LLM-on
   must be byte-identical to LLM-off in the sim.** **Look for:** any sim read of a written-back doc; the
   knowledge-graph READ side failing to exclude `ry-farms`-tagged generated docs (a persisted life regrowing
   a farmer = a feedback loop that fills the town with echoes of itself); flavor text influencing a decision.
3. **Rarity ABSOLUTELY gates the crafting economy.** Tier comes from CONCENTRATION (dominant essence share)
   **gated by rarity** — commons cap at tier 2; **tier 3+ REQUIRES a rare ingredient** (crystal/relic/
   emberbloom). Quality (plain/fine/pristine) is rarity-only. Instant-cure / strong effects are reserved for
   rare-gated items; the legacy base cures were re-tiered so a cheap pure brew can't shortcut a cure (a
   council/Fable catch — re-verify it stuck). **Look for:** any combo of commons that reaches tier 3+, an
   effect table that lets a cheap mix cure/instant-heal, volume (holding a lot) substituting for concentration.
4. **Folk heuristics read OBSERVABLE state only.** Crafting decisions may read: ingredient identity, held
   amount, foraged goods, nearby sick, season, weather, heard-of recipes, own past successes/failures, and
   the town superstition. They must NEVER read the hidden essence/effect table. `FOLK_ASSOC` (what farmers
   BELIEVE ingredients do) is deliberately imperfect and only loosely rhymes with real effects — that's what
   makes discovery trial-and-error. **Look for:** `#folkCombo`/`#pickStrategy`/`#currentNeed`/`#refineKnown`
   reading `INGREDIENT_ESSENCE`/`ESSENCE_EFFECT`/`deriveInvention` output to steer the pick (an oracle leak).
5. **Personality-guard hierarchy.** core personality > need > relationship > recent event > memory. A creed,
   belief, tale, or superstition is a COLOUR, never the cause. Memory-attributed refusals change only the
   REASON string, not the vote; belief nudges are small + one-time (idempotent, trait stays in [0,1]).
6. **Conservation.** Recipes/experiments consume inputs exactly; nothing created/destroyed off-ledger.
   Every experiment spends real stock even when it fails. Harm/■ items (if any remain locked) must never be
   craftable via `canCraft`/`applyInvention`/`#experiment`.

---

## Where to look hardest — per cluster

### A. Generative crafting engine (79741c3, b15084e, 03f9244, 0e13538 — `farm.js`)
- `deriveInvention(counts)` — is it truly **order-independent** and pure? Canonical key
  `gen:<dominant>[-<second>].t<tier>.<qualityCode>` — can two genuinely different mixes collide to one key,
  or one mix derive two keys? The rarity gate `rare>=4?4 : rare>=2?3 : rare>=1?(share>=.6?3:2) : (share>=.6?2:1)`
  — walk each branch for a commons-only tier-3 escape. `QUALITY_CODE = {plain:'c',fine:'f',pristine:'p'}`
  (the plain/pristine `[0]`-collision fix — confirm no other code still keys off `quality[0]`).
- `applyInvention` / `applyRemedy` — the re-tier where `tonic` SPEEDS recovery
  (`sickDays = max(1, sickDays-3)`) instead of instant-curing; `case 'charm'` bounded expiry
  (`this.day + (1+tier)`); no effect creates stock or heals off-ledger.
- `#consumeCombo` conservation: crops via `produce`, goods via `sheet.goods`; a failed experiment still
  charges; can any good go negative or a nonexistent good be "spent" as a no-op that still yields an item?

### B. Discovery + folk heuristics (4bcc9ea, 0ee8e13, 473854b, e5426ff — `farm.js`)
- `#experiment` — the throttle (`inventCd`, `inventCount`), the `triedCombos` FIFO (bounded 40) keyed by
  `comboSig` (exact-input multiset) — can the same failed mix be retried forever (no dedup) or a *different*
  mix be wrongly suppressed (sig collision)? `dryStreak` saturation and its reset on a rare find.
- `#folkCombo` dispatcher (NEW) — the strategy weights (`staple`/`novelty`/`reach`/`need`/`refine`); the
  weighted draw's `splice` correctness (no index drift, no infinite loop when the pool empties);
  `#refineKnown` — it swaps one ingredient in a known generative recipe and MUST re-validate affordability +
  ≥2 kinds before returning (else it can propose an uncraftable/degenerate combo). `#pickStrategy` reading
  only personality/goal/need. `#currentNeed` reading only observable state (sick radius, season, energy,
  weather). Confirm the whole path is seeded (`roll` from `mulberry32(... inventCount ...)`) and re-runs identically.
- `#larder` stable sort (most-held, then name) — is the tie-break total so iteration can't reorder run-to-run?

### C. The myth loop — tales (13928db, dd5b9a7 — `farm.js` + `main.js`)
- `#seedTales` — frozen at founding from `docLexicon` of founders' source docs; **one tale per rare
  ingredient**; the retroactive-seed path in `harvestRareNode` when a non-believer stumbles on one (no
  duplicate tale, no cascade). `hearTale`/`topRareBelief`/`#decayLore` — decay floored at 0.15 (never zero,
  never >1); a `validated` belief must not decay back to `tale`.
- Rare nodes: `#maybeSpawnRareNode`/`#tickRareNodes`/`nearestRareNode`/`harvestRareNode`/`#spreadTales` —
  spawn cap/cooldown; claim release when a seeker wanders off; validation is **per-ingredient, no cascade**
  (one find doesn't validate every tale). Belief-driven seeking threshold vs decay: confirm tales still get
  ORGANICALLY validated over a multi-year run (the P4 deadlock that was tuned out — re-verify it didn't regress).
- `world.taleLore(t)` (NEW, `farm.js`) — **display-only**: it must use a FRESH `mulberry32` seeded from the
  tale (NOT `this.rand`) and have **no sim side effects** (belief counts are read, never written). Confirm
  it's pure/stable across repeated calls and that `taleFlavor` (optional LLM prose) never enters the digest.
  Render path in `main.js` `drawChronicleRecipes` (see cluster F).

### D. Memory-depth: creeds + beliefs (70ce0e3, 919e7c4, 72e9f7c, c64954c — `dna.js` + `farm.js`)
- `docLexicon` / `compileCreeds` — deterministic vs the source doc; varied phrasing that still self-compares;
  stop-word + short-word filtering; empty/garbage doc (no title/summary/content) doesn't throw or emit `""`.
- Belief erode/reverse + **bounded** personality drift — a nudge is one-time + idempotent, trait stays [0,1],
  and the belief-TEXT stream never leaks into a sim decision. "Untether default farmers from the initial
  corpus" (72e9f7c) — the offline/fallback crew still boots deterministically with no network.
- `c64954c` "honest doctrine gate + writeback dedupe" — the honesty gate on fake-help/poaching; the dedupe
  guard (see cluster E) — confirm neither double-applies.

### E. SuperMemory writeback + civic memory (1e8eb98, 83542c4, 6cf3aec — `api/memory-writeback.js`,
`memory-writeback.js` client, `farm.js`)
- The writeback reads LIVED memories from `f.journal` (NOT the empty `f.sheet.journal`) and refreshes on
  change via a `lifeSig` (1e8eb98). **Re-verify:** the client sends `episodic` from the right field; the
  refresh-on-change stamp can't wedge (never re-write) or thrash (re-write every tick); a partial write is
  resumable (`persisted` seeds stamped exactly).
- Metadata values are all STRINGS, nulls dropped (83542c4) — SuperMemory rejects non-string/null metadata.
  Body reader size cap + bad-JSON handling; the `AbortController` deadline race; POST shape to `/v3/documents`
  with `customId` upsert per (town, farmer) / per town.
- #94 P3 elections + civic memory (6cf3aec) — the **sim-side** vote is a legit re-baseline but must
  self-compare. `RECALL_FLOOR=0.12`, `RECALL_DWELL=12`, `MAX_RECALLS_PER_YEAR=2` (the manager-thrash fix —
  re-verify managers don't churn every few days). The **one-role invariant** (`#vacateOtherRoles`) — can a
  farmer ever hold two roles across an election + a recall in the same window? `world.roles.history[]`
  correctness (every term: who/tenure/end-reason/why); the annual winter vote flow
  (nominations→campaign→tally on the last winter day) is deterministic (seeded ballots from
  `civic.impressions`, deterministic tie-break).

### F. The memory portal (b2a4a55, d1c693b, 7f32572, 9229b6e, 4b41465, ec522f0, a0607ca — `memory-graph.html`,
`api/memory-graph.js`, `main.js`)
- `api/memory-graph.js` is **read-only** (never writes). The NEW **per-farmer fan-out** (a0607ca): it runs a
  broad `/v4/search` (SuperMemory hard-caps `limit` at 100; 300+ returns nothing) to discover the roster,
  then fans out ≤32 parallel per-name searches and merges. **Check:** the `Promise.all` can't reject the
  whole handler (a single failed sub-search must degrade, not 500 — note the inner `try/catch` returns null);
  the roster discovery only counts `kind==='farmer-life'`; dedup is per-text so the merge can't double-count;
  a farmer present in NO search still isn't fabricated. Grouping by NAME merges across town seeds — is that
  intended (stale prior-boot docs inflate a name)? Edge: 0 farmers / SuperMemory offline → clean empty graph.
- `memory-graph.html` — force layout cooled so nodes settle & stay clickable (9229b6e); bitmap-font + CRT
  reskin (4b41465) must not depend on anything the strict page can't load. The gold TOWN hub + civic record
  (ec522f0) and amber invention satellites — click targets vs the settled layout.
- The settings-modal "View the town's memory" link (d1c693b) in `main.js`.

### G. Invention naming + persistence side-channel (3f24d84, 62e3ad6, 4eec127 — `api/ry-farms-invent.js`,
`memory-invent.js`, `main.js`, `api/memory-writeback.js`, `api/memory-graph.js`)
- `api/ry-farms-invent.js` — LLM names an invention from effect/tier/ingredients; the `EFFECT_MEANING`
  constraint + `BANNED` over-claim regex; schema validation + fallback when the LLM is off/malformed. It must
  be display-only: `world.recipeFlavor` fills `name`/`lore` but `recipeName`/`recipeLore` fall back to the
  procedural name, and none of it enters the digest.
- `memory-invent.js` client — `enrichInventions` (content-addressed, only fills missing flavor) +
  `persistTownInventions` (writes the town-inventions doc). The `townInventionsDoc` writeback branch +
  the `memory-graph.js` `inventData` third search (rendered as amber nodes). Cadence: enrich/persist can't
  spam the endpoints every tick.
- RECIPES tab scroll (4eec127) — `drawChronicleRecipes` builds scrollable rows, clamps `chronScroll` to
  `chronView.maxScroll`, clips to the body, draws the thumb; the wheel handler clamps to the same max.
  **Check:** off-by-one at the last row; empty state (no inventions) doesn't divide-by-zero on `contentH`;
  the NEW tale-lore rows (3 wrapped lines each) are inside the scrollable content, not clipped/overflowing.

---

## Report format

For each finding: **severity** (P0 determinism/crash/exploit · P1 correctness · P2 balance/legibility ·
P3 nit), **file:line**, the **smallest repro** (seed/day/farmer/steps, observed vs expected), and the
**root cause**. Rank most-severe first. Empty section → say "clean". Do not commit fixes.
