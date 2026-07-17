# Conscience Chat — v2 design (task #93), post-council

Council round 3 (2026-07-09, `.council-review.md`): all four reviewers endorsed the
core (sim-decides / LLM-narrates, pressure-not-compliance, conscience fiction) and
unanimously attacked the same seams. v2 folds in the five fixes below. v1 history is
in git-less prose: the seams were (1) keyword parser vs LLM-reply desync ("magic
words command console"), (2) unspecified nudge caps, (3) latency desync, (4) thin
verdict taxonomy, (5) exploitable repetition, (6) canvas text input risk, (7) the
voice leaking into the social fabric.

## Context (unchanged)

Ry Farms: fullscreen iso pixel farm sim. Farmers grown deterministically from
SuperMemory docs — D&D stats, 6-trait personality, 5e identity block (BACKGROUND /
tale / IDEAL / BOND / FLAW), a DREAM with real behavior levers, journals, dawn
reflections, gossip, moods, town chronicle. World persists to IndexedDB.

Doctrines: (1) the sim consumes ONLY `world.rand` — same seed, same town, verified
by headless digest harnesses; (2) LLMs are display-text-only expressive channels
with procedural fallbacks (existing: `/api/ry-farms-chat` conversations,
`/api/ry-farms-dm` chronicler; both mounted by `server.mjs`, key in gitignored
`.env`, model default gpt-4.1-mini).

## The feature

Chat with each farmer, docked to the BOTTOM HALF of the roster window (top half
stays the list). Scrollable history, entry field, dropdown to switch farmer (each
farmer keeps a separate history). The player is NOT a character in the world —
their messages arrive as a CONSCIENCE, a stray inner voice. The farmer may act on
it, ignore it, or wonder about it. Hard requirement: asking 50 times must not
reliably change a mind. Influence, not command.

## Pipeline per whisper (v2)

1. **CLASSIFY (LLM, stage 1)** — a small strict-schema call maps the player's FULL
   sentence onto the bounded urge enum:
   `chop / plant / water / rest / explore / build / visit <farmerName> / trade /
   hunt / none`, plus a `tone` tag (`suggest / observe / press / praise / meta`).
   Temperature 0, tiny prompt, ~1s. This replaces the v1 keyword parser as the
   primary path — what the sim hears is now the same reading the narrator gives,
   killing the desync AND the magic-words meta. The keyword matcher survives ONLY
   as the offline fallback.
   (Council: consensus fix #1. The purity cost — LLM upstream of one bounded enum —
   is accepted; player chat is already outside the deterministic core, like clicks.)

2. **CONSCIENCE CHECK (sim-side, deterministic)** — d20-style roll on a dedicated
   stream seeded per **(world.seed ^ farmer.seed ^ urgeKind ^ day)** — NOT
   world.rand (headless digests untouched), and NOT the message text: rephrasing
   or re-asking the same kind on the same day returns the SAME verdict. Kills
   reroll-fishing outright. Modifiers:
   - dream alignment (urge matches their yearning: strong bonus; opposes: penalty)
   - personality fit (per-kind mapping from the 6 traits + ability mods)
   - current state (mood, energy, health, season, what the farm actually needs)
   - repetition pressure (below)

3. **VERDICT (six, was three)**:
   - **HEED** — gains a bounded urge nudge (budget below).
   - **ALREADY** — the urge matches what they intended anyway; costs nothing,
     reply acknowledges it ("I was already going to."). Checked BEFORE the roll
     by inspecting current goal/needs. (GPT-5.5's best add.)
   - **BARGAIN** — deferred heed: the nudge is stored with a condition
     ("when the beans are in" = activates when current urgent backlog clears,
     else expires). Personality: diligent + collaborative lean here.
   - **DISMISS** — shrugged off.
   - **QUESTION** — interrogates the thought itself; private journal entry
     (cap: 1/day/farmer) that can surface in their own dawn reflection.
   - **DEFY** — rare, gated on (low collaboration OR high volatility) AND high
     pressure, AND sanity-gated: the spite action must pass the same safety
     checks as any decision (never self-destructive — no defying "rest" at 5%
     energy by working). Doing the opposite out of spite, at most once/day.

4. **REPLY (LLM, stage 2)** — `/api/ry-farms-conscience` (same serverless pattern)
   receives: a CURATED knowledge view (below), chat history tail (last ~12
   messages), the player text, the urge + tone, the verdict, pressure level, and a
   **whisper-time snapshot** (day/season/weather/state/goal at the moment of
   sending). The reply is written against that snapshot, so a world that moved on
   during generation can't contradict it; verdict effects were applied at whisper
   time. In-character, 1-3 short sentences, bitmap-font ASCII, they/them.
   Offline fallback: procedural verdict x personality template lines.

## Influence budget (published numbers — council fix #3)

- Max **1 active urge per farmer** (a new HEED replaces the old one).
- Nudge weight is capped **below the dream levers** — the voice must never
  outmuscle who they are (dreams cap at ~0.12-0.15 effect scale; urge caps at
  ~0.10) — and far below urgent-need priority: the existing urgent task order
  (collect/harvest/water/tend, safety, sleep) always outranks it.
- Read points in the decision code are few and opt-in: fill-work task preference
  (chop vs till vs plant bias), visit/chat target preference, a wanderlust bump
  for `explore`, a rest inclination for `rest`. No new control paths.
- Expiry: end of the NEXT day.
- Daily heed budget: max **2 HEED/BARGAIN per farmer per day** — further asks can
  still ALREADY/DISMISS/QUESTION/DEFY but not produce new nudges.
- Anti-town-manager: a global cap of ~4 active urges across all farmers at once;
  beyond that, new whispers can converse but verdicts cap at DISMISS/QUESTION.

## Repetition pressure (v2)

Per farmer per urge-KIND (classification output, so rephrasing doesn't reset it):
each same-kind ask within the window raises pressure; pressure LOWERS the heed
chance and shifts reply tone (consideration → "that thought again" → irritation
→ DEFY eligibility). Decay: -1 kind-pressure per in-game day, modulated by
temperament (volatile farmers hold it longer). Pressure never increases heed
chance; the only concession path is BARGAIN, and only at low pressure. Asking
once at the right moment strictly dominates nagging.

## Containment (council fix #5 — the voice stays out of the social fabric, v1)

- Whispers/verdicts NEVER enter gossip, farmer-to-farmer chat, or the chronicle.
- Journal entries only from QUESTION (private musing, capped 1/day) and from a
  HEEDED urge's outcome (the farmer remembers doing the thing, framed as their
  own choice: "thinned the north trees - the thought had been nagging me").
- **The stance question (contested Q3), decided light-touch**: at first contact
  each farmer derives a fixed STANCE toward the voice from personality —
  the Skeptic (high wis/int: "a trick of tired ears"), the Believer (high
  curiosity/low volatility: quiet awe), the Bargainer (low honesty: negotiates),
  the Unbothered (high diligence: "thoughts don't till fields"). One line in the
  reply prompt, stored on the sheet, never an evolving metaphysics arc. Charm
  without navel-gazing.

## Knowledge hygiene

The reply prompt gets a curated view: name, trade, background, tale summary,
ideal/bond/flaw, dream (+rival), stance, mood word, energy/health words, current
goal/state, their OWN recent journal lines (not others'), bonds/grudges by name
only, the snapshot. NOT sent: raw stats internals, other farmers' private state,
sim constants, anything they couldn't know. Prompt instructs: never promise
mechanical outcomes beyond the verdict, never reveal the roll.

## UI

- Roster window splits: list locked to top half (existing behavior, shorter
  viewport), conscience chat locked to bottom half.
- Header row: "INSIDE THE HEAD OF: [FARMER NAME v]" — dropdown expands over the
  list to switch; per-farmer history.
- History: scrollable (wheel), player lines right-tinted, farmer lines in their
  text color, verdict whispered as a subtle suffix glyph (nothing that reads as
  an order-acknowledged icon — council warned legibility can backfire into
  command-console feel; keep it understated).
- Entry: **hidden DOM input as the capture surface** (invisible, positioned over
  the entry row) mirrored into the bitmap-font canvas render with caret —
  IME/paste/repeat for free, CRT look intact. (Council fix: 3 reviewers flagged
  pure-canvas input as a time-sink.)
- "..." thinking shimmer while stage 1+2 run; sim keeps running.
- ESC or clicking the world closes roster as today; typing focus never leaks
  keys to game shortcuts (W, arrows, etc.) while the input is focused.

## Persistence

On the sheet (rides existing save wholesale): `conscience = { stance,
log: [{who: 'voice'|'ry', text, day, verdict?}] (cap ~40, FIFO), pressure:
{kind: n}, heededDay: {day, count}, urge: {kind, target, weight, expiresDay,
condition?} }`. Transcripts are SAVED TEXT — never regenerated on load (answers
DeepSeek's caching worry). Save-version bump not needed (additive field;
World.serialize copies sheet wholesale — verify urge field survives fromSave
transient-reset rules: the urge itself SHOULD persist, it's a want not a task).

## Explicitly rejected from council (with reasons)

- LLM reply caching for replay (DeepSeek): transcripts are persisted text;
  nothing regenerates.
- Whispers as formal replay-harness input events (GPT-5.5): chat sits outside
  the deterministic core by design, same as camera input. Digests run headless.
- i18n / accessibility audit / moderation policy / telemetry suite (GPT-5.5):
  out of scope for a personal art project; revisit if it ever ships publicly.
- Farmer-initiated whispers, multi-farmer voice propagation: v2 material at most.

## Build map

| Piece | File | Notes |
|---|---|---|
| Urge/check/verdict/pressure/budget machinery | `farm.js` | new Farmer fields + `conscienceCheck()`, ~4 opt-in read points in decision code; own mulberry32 stream |
| Classify + reply endpoints | `api/ry-farms-conscience.js` | two actions in one handler (`{stage:'classify'}` / `{stage:'reply'}`), strict schemas, same shape as chat/dm |
| Client channel | `conscience.js` (new) | snapshot capture, two-stage calls, offline keyword+template fallback, timeout/cooldown like dm.js |
| Roster split + chat UI + hidden input | `main.js` | drawRoster bottom half, dropdown, history scroll, DOM input mirror |
| Docs | `README.md` | third LLM channel note |

## Verification

- Headless: digests self-compare unchanged (no world.rand consumption); a node
  test drives `conscienceCheck` directly — same (farmer, kind, day) = same
  verdict; pressure monotonically lowers heed rate; DEFY never fires through
  safety gates; budget caps hold under 50-ask spam.
- Browser (on :8001, never ?fresh on :8000): full whisper → classify → verdict →
  reply loop; nag the same farmer 10x and watch tone shift + no compliance;
  ALREADY on a task they're mid-way to; save/reload carries transcript + urge;
  offline (kill key) fallback works.
