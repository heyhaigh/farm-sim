# Ry Farms — Codex Review r12 Directive (#93 Conscience Chat)

You are reviewing a **static ES-module browser sim** (`~/ry-farms`, no build step). The feature
under review is **#93 CONSCIENCE CHAT** — the player whispers to a farmer as a stray inner voice;
the farmer heeds, ignores, or wonders at the thought but never simply obeys. It shipped in commit
`00ed50f` (HEAD), the newest of 8 local-unpushed commits on `main` (range `81279ea..HEAD`; the
earlier seven — #88 persistence, #89 dreams, wipe-undo, #92a/#92 story, tab fold — have NOT had a
Codex pass either, so widen to them if you have budget, but #93 is the priority).

**Your job is to find where it breaks, not to confirm it works.** Report each finding with a
concrete repro (seed, farmer, kind, day, steps; observed vs expected) and the smallest repro. Do
NOT commit fixes — surface findings first.

## The design contract you are checking against

The feature's honesty rests on four invariants. A violation of any is a P0 finding:

1. **Determinism is sacred.** The sim consumes ONLY `world.rand` (+ each farmer's own
   `this.rand`, seeded from the sheet). The conscience check must consume NEITHER — it uses a
   **dedicated `mulberry32` created per call**, seeded `(world.seed ^ farmer.seed ^
   urgeKindSeed(kind) ^ (world.day * 0x1f1f))`. Whispers only happen on player action (never in a
   headless harness), so the headless digests must stay **UNCHANGED**:
   `20260706=701de12837550b63`, `42=ffd7a8603e50ee08`, `7=84c5819b308383d8`.
   The `urgeBias()` read points added to the decide loop must be **no-ops when no urge is
   active** (return 0, touch no rng). Hunt for any path where a whisper, an active urge, or the
   check advances `world.rand`/`this.rand` and thereby shifts what the rest of the sim rolls.
2. **You cannot reroll a mind.** The check is seeded by `(world, farmer, kind, day)` — NOT by the
   message text and NOT by how many times you ask. So rephrasing or re-asking the *same kind on
   the same day* MUST return the *same verdict*. Repetition may only *lower* the heed odds via
   pressure, never raise them.
3. **The voice cannot command the town.** Budgets: max 1 active urge/farmer, max 2 HEED/BARGAIN
   per farmer per day, ~4 active urges town-wide; a heeded urge's weight (`URGE_WEIGHT = 0.07`)
   must stay **below** the dream levers (0.08–0.12) and below urgent-need priority; urges expire
   at `day+1`.
4. **Containment.** A whisper/verdict must NEVER enter gossip, farmer-to-farmer chat, or the
   chronicle. The only journal entries it may create are a QUESTION musing (cap 1/day/farmer) and
   a heeded-urge outcome framed as the farmer's own choice. Confirm no `addChronicle` /
   `hearGossip` / `applyChatLines` path is reachable from a whisper.

## Files in scope

| File | What to scrutinize |
|---|---|
| `farm.js` | `conscienceCheck`, `activeUrge`, `urgeBias`, `#plantUrge`, `#urgeMatchesIntent`, `#urgeFit`, `#hasUrgentBacklog`, `#defySafe`, `deriveStance`, `URGE_*` consts; the ~6 decide-loop read points; the reflect() pressure-ebb + urge-expiry block; the BARGAIN-arming block |
| `conscience.js` | client orchestrator `whisper()`, offline keyword classifier, offline reply templates, `characterView`/`snapshotOf` (knowledge hygiene), timeout/fallback |
| `api/ry-farms-conscience.js` | two-stage handler (classify enum-clamping + visit-target resolution; reply verdict/stance guides; `cleanReply` ASCII/sentence trim; strict json_schema) |
| `main.js` | `drawConscienceChat`, `drawChatDropdown`, `drawCaret`, hidden-input lifecycle (`ensureChatInput`/`focus`/`blur`), `submitWhisper`, roster split + click/wheel routing, `chatFocused` keyboard-shortcut suppression |
| `pixel.js` | the added `^` FONT glyph |
| `server.mjs` | the mounted `/api/ry-farms-conscience` route |

## How to run

- **Syntax gate:** `node -c farm.js && node -c main.js && node -c conscience.js && node -c api/ry-farms-conscience.js`
- **Determinism harness (must stay green):** a self-comparing digest over seeds
  `20260706/42/7`. Boot a `World`, `addFarmer` 8 memories, tick `(DAY_LENGTH+NIGHT_LENGTH)*20`,
  hash farmer/world state. (Reference harness lives in the session scratchpad;
  `scratchpad/determinism.mjs`.) If any digest moves, the read points or the check are leaking
  rng — that's the top-priority bug.
- **Conscience contract harness:** drive `farmer.conscienceCheck(kind, target, tone)` directly
  (no DOM, no LLM). Assert: (a) same `(farmer,kind,day)` ⇒ same verdict across independent
  worlds; (b) 50 same-kind asks never all HEED and late asks heed ≤ early asks; (c) no farmer
  exceeds 2 heeds/day and town active urges ≤ 4; (d) whisper "rest" to a spent/sick contrary
  farmer never yields a DEFY (unsafe); (e) `urgeBias(k)` is 0 without an urge and `URGE_WEIGHT`
  after a HEED. (Reference: `scratchpad/conscience.mjs`, currently 11/11 — try to break it with
  more seeds and adversarial inputs.)
- **Browser (UI/LLM):** serve with `node server.mjs 8013` (has `OPENAI_API_KEY` via gitignored
  `.env`) and open `http://localhost:8013`. **Test fresh towns on a non-8000 port** — never
  `?fresh=1` on :8000 (it steals the standing town's `latest` IndexedDB pointer). Hard-reload
  (cmd+shift+r) after edits. Debug handle: `window.RYFARMS.world`.

## What to attack (concrete)

**Determinism / rng leakage (P0)**
- Does `conscienceCheck` (or anything it calls — `#hasUrgentBacklog` → `#nextTaskOnPlot`,
  `#urgeMatchesIntent`, `#urgeFit`, the town-cap `activeUrge` sweep) ever call `world.rand()` or
  `this.rand()`? It must not.
- With an urge active, do the read points change the *number* of rng draws in a tick (vs merely
  the comparison outcome)? A HEED changing which branch executes is fine (it's player-driven and
  outside the harness); a HEED changing draw *count* on a path the harness exercises is not.
- Is `sheet.conscience` ever created during a headless run (it shouldn't be — the getter is only
  reached via whisper/urgeBias/activeUrge, and `activeUrge` reads `sheet.conscience` directly
  without creating it)? Confirm `urgeBias`/`activeUrge` never lazily instantiate state.

**Verdict logic / free will**
- Can pressure ever *raise* heed odds (sign error in `pressurePenalty`)? Can `chance` exceed the
  0.9 clamp or go negative?
- ALREADY is checked before the roll and before budget — confirm it can't consume a daily heed or
  plant an urge. Does `#urgeMatchesIntent` ever falsely fire (making the voice feel ignored) or
  falsely miss?
- BARGAIN: does the `condition:'backlog'` urge ever arm at the wrong time, arm after expiry, or
  never arm (starving the deferral)? Does `activeUrge()` correctly hide a disarmed BARGAIN?
- DEFY: is `#defySafe` sufficient? Find an input where a DEFY produces a self-harming or
  incoherent action.
- QUESTION: is the 1/day cap enforced (`_questionedDay`)? Note `_questionedDay` is a transient
  field NOT in serialize — confirm that's harmless (worst case: one extra QUESTION journal after a
  reload) and not a dupe/leak.

**Persistence**
- `sheet.conscience` rides the save because the whole sheet is serialized wholesale. Round-trip a
  world through `serialize()` → `structuredClone` → `fromSave()` and confirm `stance`, `log`,
  `pressure`, `heededDay`, and `urge` all survive intact, and that a persisted `urge` still
  biases/expire correctly on the restored world. Any non-clonable value on `conscience` would
  throw at save time — verify none can appear.

**LLM channel robustness (must degrade, never freeze the sim)**
- No key / no server / 500 / malformed JSON / aborted (timeout) → `whisper()` falls back to
  keyword classify + templates, appends a coherent line, no unhandled promise rejection, no
  console error. The sim keeps ticking during the round-trip.
- classify: does enum-clamping hold for garbage `kind`? Does a `visit` with a name NOT in the
  town collapse to `none` (both server-side `classify_normalize` and offline)? Case-insensitive
  match only to real short names?
- reply: is every returned line ASCII-safe for the 3×5 bitmap font (no glyph that renders as
  `?`/garbage), and always a COMPLETE sentence (the `cleanReply` sentence-trim) under the cap?
  Try to get it to emit a dangling clause or a non-ASCII char that reaches `drawText`.
- Knowledge hygiene: does `characterView` ever leak another farmer's private state, raw stat
  internals, or sim constants into the prompt?

**UI / input**
- Hidden `<input>` is `pointer-events:none` and focused programmatically on entry-row click.
  Confirm it never intercepts world/canvas clicks, and that clicking elsewhere blurs it.
- `chatFocused` must suppress ALL world shortcuts (W/F/T/arrows/Esc-handling) while typing;
  the input's own keydown `stopPropagation` + the `if (chatFocused) return` guard are belt-and-
  braces. Find any key that still leaks to the game while the field is focused.
- Coordinate mapping is CRT-curve-based (`crt.screenToGame`); the panel resizes with the window.
  Try resizing mid-session and confirm the entry/dropdown/list hit-rects still match what's drawn.
- Dropdown: switching farmer swaps history correctly; per-farmer histories don't bleed; scroll
  (`chatScroll` vs `rosterScroll`) routes to the pane under the pointer; long replies wrap and
  clip inside the viewport without overflowing the panel.
- Verdict glyph suffixes (`~ = > . ? !`) and colors render; the closed/open caret (`drawCaret`)
  flips correctly.

**Edge cases**
- Empty/whitespace whisper (should no-op). A whisper to a farmer who is sick/downed/sleeping.
  Town reset (NEW TOWN) mid-request — `whisper` captured `world`/`farmer` by reference; confirm a
  late-landing reply can't corrupt the new town (it appends to the OLD sheet's log, which is
  discarded — verify no crash, no cross-town write).
- A farmer with `dream: null` or `story: null` (offline crew / freshly-grown) — `characterView`
  and `deriveStance` must not throw.

## Deliverable

A short report: for each area above, PASS or a concrete FAIL (seed, farmer, kind, day, observed
vs expected, smallest repro). **Prioritize, in order:** (1) any rng leak that moves a determinism
digest; (2) any way to reliably force a verdict by repetition/rephrasing; (3) budget-cap or
containment escapes (whisper reaching gossip/chronicle, or a mind turned into a puppet); (4)
unhandled promise rejection / sim freeze from the LLM path; (5) persistence round-trip loss.
