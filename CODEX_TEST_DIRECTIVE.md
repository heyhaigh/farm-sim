# Ry Farms — Test Directive (2026-07-06 feature batch)

You are testing a static ES-module browser sim (`~/ry-farms`, no build step). Everything
below shipped in the last session and is committed locally up to HEAD `ad99f6a`. Your job is
to **find where it breaks**, not to confirm it works. Report bugs with a concrete repro
(seed, day, farmer, steps) — don't just say "looks fine."

## How to run

- **Headless / deterministic (preferred for logic):** the sim is pure JS and runs under Node.
  ```bash
  cd ~/ry-farms
  node --input-type=module --check < farm.js     # syntax gate
  node --input-type=module --check < main.js
  node --check api/ry-farms-chat.js
  ```
  Drive the sim directly (no DOM needed):
  ```js
  import { World, DAY_LENGTH, NIGHT_LENGTH } from './farm.js';
  const w = new World(20260706);
  const mems = [...8 objects: { title, content }...];   // content keywords bias stats/personality
  for (const m of mems) w.addFarmer(m);
  const dt = 1/30;
  for (let t = 0; t < (DAY_LENGTH+NIGHT_LENGTH)*40; t += dt) w.tick(dt);
  ```
  **Gotcha:** `world.log` is capped at 80 entries (`addLog` shifts). To capture every event,
  monkey-patch `world.addLog` BEFORE ticking — do not index into `world.log` after the fact.
- **Browser (rendering / audio / input):** serve with the Node server (it also serves the
  `/api/ry-farms-chat` route) at `http://localhost:8000`. A plain `python3 -m http.server`
  works for everything EXCEPT the LLM chat route. After editing any module, **hard-reload
  (cmd+shift+r)** — `http.server` sends no cache headers and stale modules will load.
- Debug handle in the browser: `window.RYFARMS = { world, cam, audio, select(i), speed(mult), runSteps(n) }`.

## What changed this batch (test these)

### 1. Scarecrows (farm.js)
- A crow raid (`#birdEat`) increments the crop owner's `birdLosses` and journals it.
- At `birdLosses >= SCARECROW_LOSSES` (2), the farmer gathers `SCARECROW_WOOD` (3) and builds
  a scarecrow mid-field (`#pursueScarecrow` / `#completeScarecrow`). It pushes to
  `world.scarecrows`, sets the tile to `T.STRUCT` (solid), and feeds the existing 6-tile bird
  deterrent (`#scarecrowNear`).
- **Regression that was just fixed — re-verify it stays fixed:** the build tile turns SOLID;
  a builder that finished standing on it used to be entombed (couldn't move, ever). Fix:
  build from an adjacent tile, plus a walk-clamp escape hatch (`standingSolid ⇒ movement
  always allowed`). **Test:** run until ≥5 scarecrows exist, then confirm across 2 more days
  that every farmer's cumulative daytime displacement is non-trivial (>3 tiles) and none ends
  a tick standing on a `pathBlocked` tile. Try multiple seeds. Also try to force the pathing
  edge cases: a scarecrow built adjacent to a house/well/fence corner.
- Verify birds actually stop eating crops within the scare radius (crops near a scarecrow
  should survive; `#birdCropTarget` must skip them).

### 2. Harvest-share recruitment + water tolls (farm.js)
- Neighborhood wells (`world.coops`) are proposed by a far-from-water farmer; if no one joins
  out of shared need, `#coopRecruit` sweetens the deal: a watered neighbor joins for a
  harvest share (`world.shareDeals`: 1 crop per 3 or per 5 harvests; free for friends /
  `good neighbor` goal). Shares pay from real harvests (`payHarvestShares`, hooked in
  `#doHarvest` and `#doCollect`) and expire after 2 seasons.
- Finished coop wells are OWNED (`well.owners` Set of seeds) and carry `ready:true`.
- Water rights: an outsider closer to a private well negotiates access
  (`negotiateWellAccess`): friends draw free, others pay a per-N-draws crop toll
  (`payWellToll`), lone wolves refuse. **Unfinished digs must NEVER be a water source**
  (`canDraw` checks `ready`; there's also a fetch-arrival guard). This was a user-reported
  bug — re-verify: assert no farmer ever fills water from a `well` object that isn't in
  `world.wells` or has `ready !== true`.
- **Test:** conservation of crops. When a share/toll pays out, the payer's `sheet.produce`
  must go DOWN by exactly what the payee's goes UP by (via `transferGood`). No crop
  duplication or negative balances. Run 40+ days and assert `sheet.produce >= 0` for all and
  that `harvested` (lifetime) is never decremented by any transfer.

### 3. Conversations (farm.js + api/ry-farms-chat.js)
- `#maybeChat` builds an agent-workspace payload and, if `world.llmChat.enabled`, POSTs to
  `/api/ry-farms-chat`; otherwise it uses the procedural fallback (`#scriptedChat`). The LLM
  path is opt-in and must degrade gracefully.
- **Test the live path (you have `OPENAI_API_KEY`):** run in the browser against the Node
  server on :8000 and watch real generated chat land in speech bubbles + journals. Confirm
  requests are gated (cooldown, single in-flight, ~random sampling) so it doesn't fire on
  every passing pair, and that a slow/aborted request never freezes the sim (6.5s timeout).
- **Test with NO server / no `OPENAI_API_KEY`:** the sim must run identically to before (chat
  falls back, no unhandled promise rejections, no console errors). Confirm `world.llmChat`
  disables itself after failures (`disabledUntil`) and stops hammering the endpoint.
- **Test the route in isolation:** `node` a request against `api/ry-farms-chat.js` with (a) no
  key set → should return a fallback signal, not a 500; (b) a mocked OpenAI response → should
  return two bubble-safe lines + a memory. Verify generated lines are sanitized
  (`cleanChatText`: uppercased, ≤34 chars, no unstable punctuation) so they can't break the
  speech-bubble render.
- Memory-quoting: a bot with a vivid (`strength>0.5`, non-`chat`) journal memory about the
  other should sometimes reference it. Confirm it doesn't crash when the journal is empty.

### 4. Episodic memory + self-set goals (farm.js) — regression guard
- `farmer.journal` entries decay nightly by kind and are forgotten below `JOURNAL_FORGET`
  (0.12); cap is `JOURNAL_MAX` (160), faintest-old dropped first. **Assert:** no entry ever
  sits at strength ≤ 0.12 after a night rollover; journal length never exceeds 160.
- `reflect()` each dawn can set `farmer.goal` from journal evidence. Assert goals only take
  documented values (`lone wolf` / `good neighbor` / `harvest king` / `sharp trader` /
  `master farmer` / null) and that a `lone wolf` never posts/joins/takes help.

### 5. Top bar + speed (main.js)
- +RY button is GONE; town is fixed at 8 farmers (`MAX_FARMERS`). `canAddFarmer` / `addFarmer`
  must both refuse past 8.
- Speed buttons: `>` toggles `world._speedMult` 1↔2, `>>` toggles 1↔10, and a `1X` button
  appears only while sped up and resets to 1. **Test:** click each in the browser, confirm the
  sim clock advances ~2×/10× and that at 10× nothing desyncs or throws (bounded backlog in the
  `frame()` accumulator, cap 800 steps). Confirm button hit-rects match their drawn positions
  (they're laid out right-to-left from `GW-4` with equal padding — a mismatch means clicks land
  on the wrong button).

### 6. Audio (audio.js) — browser only
- Four seasonal songs switch on `world.season` (0-3). Night ambience: 4 panned crickets
  (spring/summer/fall), 1-2 owls in winter (`season===3`). Rooster crow at the night→day edge
  when `world.hasRooster()`.
- Roosters: a coop with ≥2 hens may hatch one (`#maybeHatchRooster`, one per coop). Rooster is
  a `rate:0` producer — it must NEVER become collectable (`p.ready` stays false; no yield).
  **Assert headless:** over 45 days, `PROD.rooster` producers never reach `ready`, and
  `FACILITY_YIELD_NAME` never credits a rooster.
- **Test:** toggle SND/MUTE — master gain must actually go to 0. Confirm no audio nodes leak
  (the scheduler runs on an interval; long runs shouldn't accumulate). AudioContext only starts
  on a real user gesture — a synthetic `pointerdown` leaves it `suspended`, which is expected.

## Determinism check (important)
The sim must be reproducible: same seed + same `addFarmer` inputs + same `dt` sequence ⇒
identical state. Audio and the LLM chat are the ONLY allowed sources of non-determinism
(`Math.random` lives only in audio.js and the chat request gating). If you find `Math.random`
or `Date.now()` / `new Date()` influencing sim state in farm.js, that's a bug — report it.

## Deliverable
A short report: for each numbered area, PASS or a concrete FAIL with (seed, day, farmer,
observed vs expected, and the smallest repro). Prioritize: entombment regressions, crop-count
conservation, water-from-unfinished-well, and any unhandled promise rejection from the chat
path. Do not commit fixes unless asked — surface findings first.
