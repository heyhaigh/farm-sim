# Ry Farms — Codex Review r16 Directive (re-review: r15 fixes + facility by-products, over the full unpushed range)

You are reviewing a **static ES-module browser sim** (`~/ry-farms`, no build step, no bundler; runtime is
Node's built-in http server in `server.mjs` plus `/api/*.js` handlers). Scope: **all 31 local, unpushed
commits `14cf059..2eb332c`** (origin/main = `14cf059`, HEAD = `2eb332c`).

This is a **re-review**. A prior pass (r15) found 3 P1 correctness issues; **all three are now fixed** (commit
`b1fe138`), and a separate inventory bug was fixed (`2eb332c`). **Your first job is to adversarially verify
those fixes are correct AND complete — a fix that trades one bug for another, or misses a sibling code path,
is the highest-value find here.** Then re-scan the whole range for anything the last pass missed.

**Find where it breaks — don't confirm it works.** Each finding: concrete repro (seed, day, farmer, steps;
observed vs expected) + smallest reproduction, ranked most-severe first. **Do NOT commit fixes.** An empty
section is a valid, welcome answer.

---

## FIRST: verify the 5 most-recent commits (the fixes)

### r15 fix 1 — founding tales collision (`b1fe138`, `farm.js` `#seedTales`)
Was: three founders hashed into 3 rare slots; a collision was `continue`-skipped, so a rare kind could get
no founding tale (repro seed 0 → only emberbloom+relic). Now: each founder linear-probes to the next free
`RARE_KINDS` slot; `used` Set guards. **Verify:** with ≥3 founders EVERY seed covers all 3 rare kinds (I
checked 0/3/7/42/20260706/101/999 — try to find a seed that doesn't). With <3 founders it must not crash or
double-assign. Is the probe order deterministic and independent of farmer *iteration* order (it sorts by
seed first — confirm the sort is total)? Does `hearTale`/the ambient-lore loop still run once per tale?

### r15 fix 2 — free repeated experiments (`b1fe138`, `farm.js` `#experiment`)
Was: the `triedCombos` early-return fired BEFORE `#consumeCombo`, so re-mixing a known combo was free +
still granted XP. Now: `#consumeCombo(combo)` runs BEFORE the recognition return. **Verify:** a repeat now
spends stock exactly once (not double — confirm the later consume was removed, not duplicated); the
larder/affordability still holds between `#folkCombo` building the combo and consuming it; a farmer can't be
driven negative on a good; the XP-for-recognition is intended. Does consuming-then-recognizing ever let a
farmer burn their LAST unit of a rare on a combo they already know is a dud (waste loop)? Is that acceptable?

### r15 fix 3 — portal town-merge (`b1fe138`, `api/memory-graph.js`)
Was: farmer-life rows grouped by name only; recurring names across `?fresh` boots merged into one inflated
node (the "newest town wins" comment described nonexistent behavior). Now: partition farmer-life rows by
`townSeed`, compute each town's latest `updatedAt`, keep only the newest (tie-break by larger townSeed
string); civic record + inventions scoped to that same town via `inActiveTown`. **Verify:** the newest-town
pick is stable (deterministic tie-break); a town whose docs lack `updatedAt` (`Date.parse→0`) or `townSeed`
degrades sanely (the `''` bucket); scoping civic/inventions to the active town can't wrongly BLANK them when
the active town legitimately has a civic doc that simply ranked outside the civic search's top-24 (is that a
real miss, or acceptable?); read-only + the fan-out `Promise.all` still can't 500 the handler.

### by-products are goods (`2eb332c`, `farm.js` `#doCollect` + poach path + `inventoryItems`, `main.js` GOOD_ICON)
Was: collecting a coop/pen/pond producer credited the generic crops `produce` scalar, so eggs/milk/wool/
truffle never entered `sheet.goods`, never showed in inventory, weren't tradable, and inflated the crop
stockpile (desyncing `produce` from `cropStock`). Now: `#doCollect` credits `ownerSheet.goods[<by-product>]`
(name from `FACILITY_YIELD_NAME`); producer-poach pockets the by-product too; `inventoryItems()` surfaces
egg/milk/wool/truffle; procedural icons added. **Verify hardest:**
- **Conservation / double-count:** is the yield now credited to exactly ONE place (goods), or does anything
  downstream still read facility yield from `produce`? Does `payHarvestShares` (still called) now try to pay
  a crop share the farmer can't cover because the yield went to goods not produce — spurious grievance?
- **`FACILITY_YIELD_NAME[kind]` as a good KEY:** it doubles as display name AND the `goods` key
  (egg/milk/wool/truffle/fish/lily). Confirm every producer kind maps to a key the barter/donate/
  `producedGoods` systems agree on (e.g. `pen`+goat → `wool`, `pen`+pig → `truffle`, cow → `milk`) — any kind
  whose yield name ≠ its tradable good would mis-file stock. Rooster (`yield 0`) must never credit anything.
- **Balance:** by-products now accumulate unbounded in `goods` (I saw ~1600-1800/town over 80 days). Is
  there any storage cap or is that fine? Does the barter surplus/`goodValue` logic behave with big stacks?
- **YIELD stat:** confirm `cropsHarvested` (roster YIELD) is still crops-only and `#doCollect` didn't start
  feeding it; `harvested`/`harvestTotal` (town growth) unchanged.

---

## The full 31 commits (oldest → newest)

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
b1fe138 Codex r15: fix 3 P1 correctness findings          <-- verify
2eb332c Facility by-products are real goods (eggs/milk/…)  <-- verify
```

Files touched: `farm.js` (the sim), `main.js` (render/UI), `dna.js` (creeds/lexicon/personality),
`api/memory-graph.js` **(new)**, `api/memory-writeback.js`, `api/ry-farms-invent.js` **(new)**,
`memory-invent.js` **(new)**, `memory-writeback.js` (browser client), `memory-graph.html` **(new)**,
`server.mjs`, `supermemory-start.sh` **(new)**.

---

## How to run

**Syntax gate:**
```
node -c farm.js && node -c main.js && node -c dna.js && node -c pixel.js && node -c crt.js && \
node -c save.js && node -c conscience.js && node -c dm.js && node -c server.mjs && \
node -c api/_llm.js && node -c api/knowledge-graph.js && node -c api/memory-graph.js && \
node -c api/memory-writeback.js && node -c api/ry-farms-chat.js && node -c api/ry-farms-dm.js && \
node -c api/ry-farms-conscience.js && node -c api/ry-farms-invent.js
node --input-type=module --check < memory-invent.js
node --input-type=module --check < memory-writeback.js
```

**Determinism harness** (paste to `det.mjs` in the repo root, `node det.mjs`; LLM + SuperMemory OFF — the
sim's outcome must not depend on them):
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
**Baseline at HEAD `2eb332c`** (30-day run): `20260706=ef70b6e7`, `42=d008a231`, `7=1f9c9964`, `3=19ff40a3`
— all `same-twice=true`. **A same-seed run that differs run-to-run is a P0.** (Hashes fingerprint this tree;
the two fixes legitimately re-baselined them vs r15 — the invariant that must always hold is same-twice.)

**Browser + portal:** `node server.mjs 8013` (gitignored `.env` has `OPENAI_API_KEY`; `OPENAI_BASE_URL` may
point at Ollama) → `http://localhost:8013`. Fresh towns on a non-8000 port only (`?fresh=1` on `:8013`, NEVER
`:8000`). Debug: `window.RYFARMS.world` / `.select(i)` / `.speed(mult)`. Portal:
`http://localhost:8013/memory-graph.html` (needs self-hosted SuperMemory on `:6767`; see `supermemory-start.sh`).

---

## Doctrines (violations are P0/P1)

1. **Determinism is #1.** The SIM consumes ONLY `world.rand`, per-farmer `this.rand`, pure position hashes —
   with STABLE, SORTED iteration; same seed ⇒ identical town twice. DISPLAY/PLAYER-only features use
   dedicated `mulberry32` streams that must NOT advance the sim stream or enter the digest. Hunt for:
   `Date.now()`/`new Date()`/`Math.random()`; iteration over a `Map`/object whose order isn't canonical and
   feeds a sim decision; flavor text leaking into a gameplay branch. (`world.taleLore` uses a FRESH tale-
   seeded rng — confirm it never touches `this.rand` and has no side effects.)
2. **Compile-don't-query.** The sim NEVER calls SuperMemory or the LLM in its loop. Farmers act on the past
   via IN-SIM memory (`journal`/`opinions`/`beliefs`/`civic.impressions`/`rareBelief`/`triedCombos`), read
   live each tick. `api/memory-*` + `api/ry-farms-invent.js` are pure side-channels with procedural
   fallbacks; `world.recipeFlavor`/`world.taleFlavor` are EXCLUDED from the digest → LLM-on ≡ LLM-off. Hunt
   for: a sim read of a written doc; the knowledge-graph READ side failing to exclude `ry-farms`-tagged
   generated docs (a persisted life regrowing a farmer = feedback loop).
3. **Rarity ABSOLUTELY gates the crafting economy.** Tier from CONCENTRATION gated by rarity — commons cap
   at tier 2; **tier 3+ REQUIRES a rare** (crystal/relic/emberbloom); quality is rarity-only; strong/instant
   effects reserved for rare-gated items. Hunt for: any commons-only combo reaching tier 3+, a cheap mix
   that cures/instant-heals, volume substituting for concentration.
4. **Folk heuristics read OBSERVABLE state only** (`#folkCombo`/`#pickStrategy`/`#currentNeed`/`#refineKnown`):
   ingredient identity, held amount, foraged goods, nearby sick, season, weather, heard-of recipes, own past
   successes/failures, town superstition — NEVER the hidden `INGREDIENT_ESSENCE`/`ESSENCE_EFFECT`/
   `deriveInvention` output. `FOLK_ASSOC` is a deliberately-imperfect belief map, not the real table.
5. **Personality-guard hierarchy:** core personality > need > relationship > recent event > memory. A creed/
   belief/tale/superstition is a COLOUR, never the cause. Nudges are small, one-time, idempotent, trait ∈ [0,1].
6. **Conservation.** Recipes/experiments consume inputs exactly; every experiment spends stock even on
   failure/repeat; facility collection credits exactly one good; nothing created/destroyed off-ledger.

---

## Where to look hardest — per cluster (unchanged surfaces from r15, still fair game)

- **Crafting engine** (`deriveInvention` order-independence + key collisions; the rarity-gate branches;
  `QUALITY_CODE`; `applyInvention`/`applyRemedy` re-tier; `#consumeCombo` conservation).
- **Discovery + folk heuristics** (`#experiment` throttle + `triedCombos` FIFO/sig collisions + `dryStreak`;
  `#folkCombo` weighted-draw `splice` correctness; `#refineKnown` re-validating affordability + ≥2 kinds;
  `#larder` total-order sort).
- **Myth loop** (`#seedTales`; `hearTale`/`topRareBelief`/`#decayLore` floor 0.15 + no validated→tale
  regression; rare-node spawn/claim/validation per-ingredient no-cascade; `taleLore` purity).
- **Memory-depth** (`docLexicon`/`compileCreeds` determinism + empty-doc; bounded belief drift + text-stream
  isolation; honesty gate; writeback dedupe).
- **Writeback + civic** (`f.journal` not `f.sheet.journal`; `lifeSig` refresh not wedge/thrash; string-only
  metadata; deadline race; #94 P3 recall floor/dwell/cap, one-role invariant `#vacateOtherRoles`,
  deterministic winter tally + `world.roles.history`).
- **Portal** (`api/memory-graph.js` read-only + the fan-out + the NEW town partition; `memory-graph.html`
  settled/clickable layout; civic gold hub + amber invention nodes).
- **Naming + persistence** (`api/ry-farms-invent.js` `EFFECT_MEANING`/`BANNED` + fallback; `memory-invent.js`
  enrich/persist cadence; RECIPES tab scroll clamp/empty-state/tale-lore rows).

## Report format

Each finding: **severity** (P0 determinism/crash/exploit · P1 correctness · P2 balance/legibility · P3 nit),
**file:line**, **smallest repro** (seed/day/farmer/steps, observed vs expected), **root cause**. Rank
most-severe first; empty section → "clean"; do not commit fixes.
