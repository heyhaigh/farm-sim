# Ry Farms — Codex Review r17 Directive (final pass: verify the r16 fixes, re-scan the full unpushed range)

You are reviewing a **static ES-module browser sim** (`~/ry-farms`, no build step, no bundler; runtime is
Node's built-in http server in `server.mjs` plus `/api/*.js` handlers). Scope: **all 32 local, unpushed
commits `14cf059..c629245`** (origin/main = `14cf059`, HEAD = `c629245`).

This is the **final re-review before push**. Two prior passes found and fixed 5 P1 issues (r15: 3; r16: 2).
**Your first job is to adversarially verify the most-recent fix commit (`c629245`, the r16 batch) is correct
AND complete** — the r16 fixes themselves fixed regressions introduced by an earlier fix, so the bar here is:
did *this* round introduce anything, and is the whole 32-commit range coherent? Then re-scan for anything two
passes missed.

**Find where it breaks — don't confirm it works.** Each finding: concrete repro (seed, day, farmer, steps;
observed vs expected) + smallest reproduction, ranked most-severe first. **Do NOT commit fixes.** An empty
report is a valid, welcome outcome — this range has been scrubbed twice; "clean" is a real possible answer.

---

## FIRST: verify the r16 fix commit (`c629245`)

### r16 fix 1 — facility collection decoupled from crop-share deals (`farm.js` `#doCollect`)
History: the by-product commit (`2eb332c`) credited eggs/milk/wool/truffle to `sheet.goods` but still called
`payHarvestShares`, which only transfers `'crops'` → a payer with by-products but no crops had a share tick
consumed, `transferGood('crops')` failed, payee soured (-0.08 "behind on our harvest share"). Fix: **removed
the `payHarvestShares` call from `#doCollect` entirely**, because a share deal is "1 CROP per N harvests"
(`#coopRecruit`, settled from `#doHarvest`). **Verify:**
- `#doHarvest` STILL calls `payHarvestShares` (crops still settle shares) — confirm the crop path is intact.
- No other caller relied on `#doCollect` advancing `shareDeals`; the share `count`/`per`/expiry bookkeeping
  (`4211`-ish `payHarvestShares`, the deal-expiry sweep) is unaffected.
- The semantic shift ("N harvests" now means N CROP harvests, not crop+facility) doesn't break any deal that
  can now NEVER reach `per` for a pure-livestock farm — is a share deal ever struck against a farm that only
  produces by-products (so the payee waits forever)? If so, is the expiry sweep the safety net?
- Determinism: facility collection no longer touching `shareDeals` legitimately re-baselines seeds whose
  towns strike deals + run facilities (3, 20260706 moved; 42, 7 did not) — but must self-compare.

### r16 fix 2 — active-town civic/invention fetched by townSeed filter (`api/memory-graph.js`)
History: the r15 town-scope filtered the civic/invention searches AFTER their hard-capped (24), semantically-
ranked results returned, so an older town's docs could crowd the active town's civic/invention doc out and
blank the hub. Fix: the civic + invention searches now run **after** `activeTown` is computed and are passed
a `/v4/search` metadata filter `{AND:[{key:kind},{key:townSeed:activeTown}]}`. **Verify hardest:**
- **Ordering / await:** the handler now does broad-farmer-search → per-farmer fan-out → compute `activeTown`
  → civic+invention fetch. Confirm nothing reads `civicData`/`inventData` before they're assigned, and the
  extra sequential round-trip can't blow the overall response past a reasonable time (it's after the fan-out).
- **Filter semantics:** does `/v4/search` treat an unknown/typo filter key as "match none" (blanking) or
  "ignore"? If `townSeed` is stored as a String but the filter value must match exactly, confirm `activeTown`
  (a String) matches the stored `String(townSeed)`. A town whose farmer docs predate townSeed metadata →
  `activeTown === ''` → the filter `{townSeed:''}` — does that match those docs or match none?
- **Fallback:** `activeTown == null` (no farmer-life rows) → unfiltered kind-only search. Confirm that path
  still returns a civic record for a store that has one, and that a failed sub-search degrades to `{results:[]}`
  (the `.catch(()=>({results:[]}))`) rather than rejecting the `Promise.all` / 500-ing the handler.
- **Consistency:** civic/invention are now town-filtered at the SOURCE; the later `inActiveTown` guard in the
  loops is now redundant — confirm it's harmless (not double-filtering something valid out).

---

## The full 32 commits (oldest → newest)

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
b1fe138 Codex r15: fix 3 P1 correctness findings
2eb332c Facility by-products are real goods (eggs/milk/…)
c629245 Codex r16: fix 2 P1 regressions from the last batch   <-- verify
```

Files touched: `farm.js`, `main.js`, `dna.js`, `api/memory-graph.js` **(new)**, `api/memory-writeback.js`,
`api/ry-farms-invent.js` **(new)**, `memory-invent.js` **(new)**, `memory-writeback.js` (browser client),
`memory-graph.html` **(new)**, `server.mjs`, `supermemory-start.sh` **(new)**.

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

**Determinism harness** (paste to `det.mjs`, `node det.mjs`; LLM + SuperMemory OFF):
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
**Baseline at HEAD `c629245`** (30-day run): `20260706=1a9ed3cf`, `42=d008a231`, `7=1f9c9964`, `3=084d1b89`
— all `same-twice=true`. **A same-seed run that differs run-to-run is a P0.** (Hashes fingerprint this tree;
the r16 fix re-baselined seeds 3 + 20260706 vs r16, left 42 + 7 unchanged — the always-hold invariant is same-twice.)

**Browser + portal:** `node server.mjs 8013` (gitignored `.env` has `OPENAI_API_KEY`; `OPENAI_BASE_URL` may
point at Ollama) → `http://localhost:8013`. Fresh towns on a non-8000 port only (`?fresh=1` on `:8013`, NEVER
`:8000`). Debug: `window.RYFARMS.world` / `.select(i)` / `.speed(mult)`. Portal:
`http://localhost:8013/memory-graph.html` (needs self-hosted SuperMemory on `:6767`; see `supermemory-start.sh`).

---

## Doctrines (violations are P0/P1)

1. **Determinism is #1.** The SIM consumes ONLY `world.rand`, per-farmer `this.rand`, pure position hashes,
   with STABLE SORTED iteration; same seed ⇒ identical town twice. DISPLAY/PLAYER-only features use dedicated
   `mulberry32` streams that must NOT advance the sim stream or enter the digest (`world.taleLore` uses a
   fresh tale-seeded rng, no side effects). Hunt: `Date.now()`/`new Date()`/`Math.random()`; non-canonical
   Map/object iteration feeding a sim decision; flavor text leaking into a gameplay branch.
2. **Compile-don't-query.** The sim NEVER calls SuperMemory/LLM in its loop; farmers act on the past via
   in-sim memory read live each tick. `api/memory-*` + `api/ry-farms-invent.js` are side-channels with
   procedural fallbacks; `recipeFlavor`/`taleFlavor` excluded from the digest → LLM-on ≡ LLM-off. Hunt: a sim
   read of a written doc; the knowledge-graph READ side failing to exclude `ry-farms`-tagged generated docs.
3. **Rarity ABSOLUTELY gates the crafting economy.** Tier from CONCENTRATION gated by rarity — commons cap at
   tier 2; tier 3+ REQUIRES a rare; quality rarity-only; strong/instant effects rare-gated. Hunt: commons-only
   tier 3+, a cheap mix that cures/instant-heals, volume substituting for concentration.
4. **Folk heuristics read OBSERVABLE state only** (`#folkCombo`/`#pickStrategy`/`#currentNeed`/`#refineKnown`):
   never the hidden `INGREDIENT_ESSENCE`/`ESSENCE_EFFECT`/`deriveInvention` output. `FOLK_ASSOC` is a
   deliberately-imperfect belief map.
5. **Personality-guard hierarchy:** core personality > need > relationship > recent event > memory. A creed/
   belief/tale/superstition is a COLOUR, never the cause; nudges small, one-time, idempotent, trait ∈ [0,1].
6. **Conservation.** Recipes/experiments consume inputs exactly (every experiment spends stock even on
   failure/repeat); facility collection credits exactly one good; nothing created/destroyed off-ledger.

---

## Where to look hardest — full-range surfaces (all still fair game)

- **Crafting** `deriveInvention` order-independence + key collisions; rarity-gate branches; `QUALITY_CODE`;
  `applyInvention`/`applyRemedy` re-tier; `#consumeCombo` conservation; `#experiment` throttle + `triedCombos`
  FIFO/sig collisions + `dryStreak`; `#folkCombo` weighted-draw `splice`; `#refineKnown` affordability + ≥2
  kinds; `#larder` total-order sort.
- **Myth loop** `#seedTales` (probe covers all rare kinds, ≥3 founders; <3 founders safe); `hearTale`/
  `#decayLore` floor 0.15 + no validated→tale regression; rare-node spawn/claim/validation per-ingredient
  no-cascade; `taleLore` purity.
- **By-products** `#doCollect` credits one good, no double-count, rooster (yield 0) credits nothing; poach
  path pockets the good; `inventoryItems` surfaces egg/milk/wool/truffle; `cropsHarvested` still crops-only;
  storage/`goodValue` behaviour with large stacks.
- **Memory-depth** `docLexicon`/`compileCreeds` determinism + empty-doc; bounded belief drift + text-stream
  isolation; honesty gate; writeback dedupe.
- **Writeback + civic** `f.journal` not `f.sheet.journal`; `lifeSig` refresh not wedge/thrash; string-only
  metadata; deadline race; #94 P3 recall floor/dwell/cap, one-role invariant `#vacateOtherRoles`, deterministic
  winter tally + `world.roles.history`.
- **Portal** `api/memory-graph.js` read-only + fan-out + town partition + the NEW townSeed-filtered civic/
  invention fetch; `memory-graph.html` settled/clickable layout; civic gold hub + amber invention nodes.
- **Naming + persistence** `api/ry-farms-invent.js` `EFFECT_MEANING`/`BANNED` + fallback; `memory-invent.js`
  enrich/persist cadence; RECIPES tab scroll clamp/empty-state/tale-lore rows.

## Report format

Each finding: **severity** (P0 determinism/crash/exploit · P1 correctness · P2 balance/legibility · P3 nit),
**file:line**, **smallest repro** (seed/day/farmer/steps, observed vs expected), **root cause**. Rank
most-severe first; empty section → "clean"; do not commit fixes.
