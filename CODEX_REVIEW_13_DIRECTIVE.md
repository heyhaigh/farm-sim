# Ry Farms — Codex Review r13 Directive (civic roles, self-hosting, town names, UI)

You are reviewing a **static ES-module browser sim** (`~/ry-farms`, no build step). Scope: the
**seven commits `9c22fe0..HEAD`** (HEAD `ffb290b`), which #93's r12 review does NOT cover. All are
local + unpushed. **Find where it breaks — don't confirm it works.** Report each finding with a
concrete repro (seed, day, farmer, steps; observed vs expected) and the smallest repro. Do NOT
commit fixes — surface findings first.

```
ffb290b #94 P2: the Town Watch + communal justice (trials, verdicts, shunning)
25f4cc0 Fix chronicle scope: tie the saga view to following + add a TOWN/name toggle
380d86a Each town gets its own generated name; roster select now follows
fc1e7a1 #94 P1: TOWN HALL legibility band folded into the Chronicle
832b5ae #94 Town roles P1: the Town Manager (autonomy kernel) + forage rework + polish
51dd384 Top-bar cleanup: settings cog (New Town + volume), trim stats tab, tidy house tooltip
f544cab Self-host the memory + LLM: SuperMemory-local corpus + any OpenAI-compatible endpoint
```

## How to run

- **Syntax gate:** `node -c farm.js && node -c main.js && node -c dna.js && node -c audio.js &&
  node -c api/_llm.js && node -c api/knowledge-graph.js && node -c api/ry-farms-*.js`
- **Determinism (must stay self-consistent):** a self-comparing digest harness boots a `World`,
  `addFarmer`s a fixed cast, ticks `(DAY_LENGTH+NIGHT_LENGTH)*20`, and hashes farmer/world state
  across two runs of the same seed. This batch is SIM-DRIVEN (civic votes, forage yields, town
  naming) so the digest VALUES changed on purpose; the invariant is **same seed → identical twice**.
  Current baseline: `20260706=300ef7751bdd1416`, `42=17b19e627672e694`, `7=35677e80db47709e`.
  If a same-seed run differs run-to-run, that's a P0 determinism bug.
- **Civic contracts (headless):** a node harness drives the civic kernel directly — 19 assertions
  (P1: appointment, directive weigh-in, budget cap, Manager exemption, immunity, recall, persistence;
  P2: Watch seating, trial + verdict + effects, verdict determinism, shun mercy/exit, persistence).
- **Browser (UI/LLM):** `node server.mjs 8013` (has `OPENAI_API_KEY` in a gitignored `.env`) →
  `http://localhost:8013`. Test **fresh towns on a non-8000 port** (`?fresh=1` is fine on 8013, NEVER
  on 8000 — it steals the standing town's IndexedDB `latest` pointer). Debug handle:
  `window.RYFARMS.world`.

## The doctrines this must satisfy (violations are P0)

1. **Determinism:** the sim consumes only `world.rand` + per-farmer `this.rand`; same seed ⇒ same
   town. Town names + the conscience whisper use DEDICATED streams (must NOT shift the digest); the
   civic votes/directives + forage DO feed the sim (digest re-baselines, but stays self-consistent).
2. **Compile-don't-query:** the corpus is pulled ONCE at founding via the server-side proxy; the sim
   NEVER calls SuperMemory's `/v4/search`. LLM channels are display-only with procedural fallbacks.
3. **Influence, never command (civic):** a role-holder biases discretionary time only — never
   overrides survival/dream/urgent work; bounded by budget + logged refusals.

---

## 1. #94 civic kernel — the biggest new logic (farm.js, main.js) — scrutinize hardest

**Autonomy kernel (P1, Manager):**
- `#considerDirective(dir)` caches ONE decision per directive on `sheet.civic.decided` and rolls
  `this.rand` exactly once per (farmer, directive). Confirm: re-deciding the same directive never
  re-rolls or re-spends the daily budget; the decide-loop block only runs when a directive is up.
- The decide-loop TOWN-WORK block replaced the old project/donation lines with a unified router
  (`isManager → pursue`; `else if dir → considerDirective`; `else → legacy collab-gated`). Verify a
  Manager always pitches in, a refuser genuinely doesn't do the town task that pass, and the change
  didn't regress the communal-project build loop (a project should still get built — heeders work it
  freely all day, uncapped per-action; the 2/day cap is per DIRECTIVE not per action).
- Placement invariant: a hungry / sleeping / dream-chasing / urgent-backlogged farmer must NEVER
  divert to a directive. Try to construct a state where the directive block fires above a real need.
- Budgets: `acceptedDay` cap (2/day), lone-wolf + enemy(opinion<-0.3) immunities, refusal logging.
- Approval + recall: `#updateCivic` folds heed-rate into approval, recalls at `lowDays>=3 &
  approval<0.25`. Can a normal, well-liked Manager get recalled by churn? Can a hated one NEVER be
  recalled (approval stuck ≥0.25)? Check the `heedRate = heeders/max(weighed, expect)` math for
  divide-by-zero, tiny towns, and everyone-sick days.

**Watch + justice (P2, farm.js):**
- `holdTrial(thief, victim, name)` is PUBLIC (called from `Farmer#completePoach`). Confirm it's only
  reachable via a WITNESSED theft, guards `jurors.length < 2`, and never tries the Watch themselves.
- The vote uses `mulberry32(seed ^ thiefSeed ^ day*0x51ed ^ caseId)`. `caseId` is `++roles.caseSeq`
  — a MUTABLE counter. Does the caseSeq increment happen deterministically in headless runs (theft
  order stable)? Two identical worlds hitting the same theft must produce the same verdict — verify,
  and check save/load mid-nothing doesn't desync caseSeq.
- Verdict ladder: `warn` (share<0.4 & first offence) / `fine` (transferGood 3 crops to victim, else
  the Watch) / `shun` (repeat + clear majority). Confirm a FIRST offence can never be a shun, a fine
  actually conserves crops (thief.produce down == payee.produce up, by-type ledger intact — this was
  a prior Codex finding on transferGood), and `crimes` increments once per trial.
- **Shun exits (council's death-spiral guard):** `isShunned(f)` gates `takeHelp` (op<0.5) and
  `#findBarter` but sick-care must ALWAYS ignore it (mercy). Verify: a shunned + SICK farmer still
  gets soup/care; the shun clears after `SEASON_LENGTH`; reputation isn't driven to an
  unrecoverable floor. Try to build a shun→isolation→more-crime spiral and confirm it can't persist.
- Watch approval/recall: `watchApproval` drifts to town regard + trial nudges. Is it ever NaN
  (empty juror pool, single-farmer town)? Can the Watch and Manager end up the same farmer (they
  must not — `#bestFor(..., this.managerFarmer())`)?

**Persistence (both):** `world.roles` (manager/watch/approval/lowDays/directive Set+Map/caseSeq) +
per-sheet `civic` / `shunUntil` / `crimes`. Round-trip a mid-trial, mid-directive world through
`serialize()`→`structuredClone`→`fromSave()`; confirm the directive's heeders `Set`/refusers `Map`
rebuild, a pre-roles save resumes with an unseated chair (guarded), and nothing throws at save time.

**Legibility (main.js):** `drawCivicBand` (chronicle) + `roleOf`/`farmerRole` card label. Check the
band renders only town-wide (not in a saga), the refusal "why" line doesn't overflow the panel, and
approval/trust bars clamp.

## 2. Self-hosting: the LLM refactor + corpus proxy (api/, dna.js, server.mjs)

- **`api/_llm.js` (new shared client):** all three channels (chat/dm/conscience) were moved off
  OpenAI's Responses API onto **Chat Completions**. Regression-check EACH channel still returns valid
  JSON via OpenAI (`node server.mjs 8013`, curl each). The json_schema→json_object→plain fallback
  loop: does it correctly stop on a non-400/422 error, and does `parseJson` still recover a wrapped
  object? "Configured" now means `OPENAI_API_KEY` **or** `OPENAI_BASE_URL` — confirm a keyless local
  base URL is accepted and a fully-unset env still returns `{fallback:true}` (never a 500 that breaks
  the client's fallback).
- **`api/knowledge-graph.js` (new proxy):** normalizes `/v3/documents` → `{id,title,summary,content}`,
  dedupes, **sorts by id** (determinism of the cast for a given corpus). Attack: a doc missing
  id/title; a bare-array response vs `{documents:[]}`; pagination that never terminates (MAX_PAGES
  backstop); a 500 from SuperMemory → must return `{documents:[]}` (200) so `dna.js` falls back to
  the offline crew, NEVER a hang or unhandled rejection. `dna.js` now fetches the RELATIVE
  `/api/knowledge-graph` — confirm it still falls back offline under a plain static server (404) and
  that dropping the heyhaigh.ai host didn't strand anything.

## 3. Town names (farm.js, main.js, dm.js)

- `generateTownName(seed)` on `mulberry32(seed^0x7047)` — a DEDICATED stream. Confirm it consumes no
  `world.rand` (digests unchanged by naming) and same seed ⇒ same name. `world.name` rides the save
  (`serialize`/`fromSave` guarded for pre-name saves — regenerates from seed, same value). Any place
  still hardcoding "RY FARMS" that should be the town name (or vice-versa: the boot splash SHOULD
  stay the app brand)?

## 4. UI batch (main.js, audio.js)

- **Settings cog + volume (audio.js):** all SFX + ambience were re-routed through a new `sfxBus`;
  music volume folds into the day/night crossfade. Verify NO sound path still connects straight to
  `master` (bypassing the SFX slider), the sliders/toggles persist to localStorage and re-apply on
  next `ensure()`, and a `0` stored volume isn't misread as the default. The hidden `<input>` era
  is gone here — the New Town two-step confirm now lives in the menu; confirm the old top-bar NEW
  hit-rect can't still fire a wipe from a stale rect.
- **Chronicle scope (25f4cc0):** `chronFocusFarmer()` ties the saga to `followTarget`; unfollow (F)
  drops to town-wide; TOWN/name chips toggle. Check: opening while following shows the saga, the
  chip hit-rects don't collide with the X-close, and clicking a beat still narrows.
- **Roster select-follows + "CLICK A RY FOR DETAILS" removed:** confirm clicking a roster name
  selects + follows + jumps the camera, and no dangling reference to the removed label.

## 5. Forage rework (farm.js) — rename consistency

The forage good was renamed `wheat → grass` and bushes now yield grass + 0–2 / 0–4 flowers. Grep for
any surviving `'wheat'`/`'wildflowers'`/`'wild wheat'` good-KEY (distinct from the wheat CROP) in
barter (`goodValue`, `DONATE_XP`, `producedGoods`), treasure pools, and the inventory display —
confirm `grass`/`flower` are consistent end-to-end and the inventory no longer folds a phantom
`goods.wheat` into the wheat crop. Verify the flower roll can be 0 (a bush needn't yield flowers) and
`harvested` accounting still matches goods added.

## Deliverable

For each numbered area: PASS or a concrete FAIL (seed, day, farmer, observed vs expected, smallest
repro). **Prioritize:** (1) any run-to-run determinism divergence; (2) a civic path that puppets a
farmer past a real need, or a Manager/Watch that can't be recalled / gets churned; (3) a justice
death-spiral or a fine that dupes/loses crops; (4) an LLM-channel regression or an unhandled
rejection from the proxy/channels; (5) persistence round-trip loss; (6) forage good-key mismatches.
