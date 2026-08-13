# INSPIRATION — whispers that leave an impression (design, post-council)

> **STATUS (2026-08-12): ALL THREE SLICES BUILT** — slice 1 (seeds, `3e57365`), slice 2
> (germination, `72e00bc`), slice 3 (the voiced white-bear, `9d5e96d`). Awaiting the single
> Codex #124 gate over the whole feature. Remaining by design: **O1 creative reinterpretation**
> needs its own design conversation (URGE_KINDS has no adjacency graph — inventing one is an
> owner decision, not an extension).

Owner ask (2026-08-12): a whisper should leave an impression the way our own thoughts do — acted on,
ignored, or ignored *for now* until the returning thought wins, by personality. Must be (1) more
obvious in the response and (2) potentially connected to real actions.

Council record: `COUNCIL_BRIEF_INSPIRATION_2026-08-12.md` (the brief) + `.council-review.md` (six
external seats) + the code-access seat and adjudication seat reports (in the session log). Seven
seats, unanimous on direction and on the slice order below.

---

## SETTLED BY CONSENSUS (build to this)

### Slice 1 — the PERCEPTION layer (ships first, no germination)

Delivers ask #1 outright and makes slice 2 legible when it lands. Zero decide-loop changes, zero
digest exposure.

1. **Deposits happen on QUESTION only.** DISMISS deposits nothing — if "no" secretly advances the
   idea, refusal becomes the best outcome and the verdict grammar dies (5/6 seats). BARGAIN plants
   a real urge already and must not double-dip. One deposit per (kind, day) — stated explicitly,
   not implied by verdict memoization (the memo stops re-rolls, not re-deposits).
2. **A lapsed, unfulfilled HEED urge deposits too** — the genuinely sad case (the thought TOOK, and
   the days swallowed it) currently leaves no residue; it should leave the strongest.
3. **Impressions are target-bearing**: `{ kind, target, stage/weight, firstDay, lastDay }`. Per-kind
   alone cannot support "that thought about the pond" (all seats), and `visit` urges are inert
   without a target (decide branch requires it — code seat). Storage mechanism: see C4 below.
4. **Not named `impressions`** — `sheet.civic.impressions` already exists (leader impressions).
   Working name: **seeds** (fits the fiction and the sheet line).
5. **Replies get memory.** The reply payload (which already carries a computed `pressure` scalar,
   and rides a server that passes fields through) gains `seed: { stage, days }`; the offline
   templates gain tiers per (verdict × stage). Legibility rule (Grok): the stage must be noticeable
   on the IMMEDIATE reply — the QUESTION reply itself says a seed was planted ("...I'll turn it
   over"), and any later whisper over a live seed reads unmistakably different ("I said no. And yet
   it keeps coming back to me").
6. **A visible seed line on the sheet**, sitting with the goal/course line (the existing
   self-decision surface). Growing/fading state, no numbers.
7. **Save-compat discipline**: the lazy conscience getter does NOT backfill fields on old saves —
   every reader guards (`if (!c.seeds) ...`, the civic pattern), and the test suite gains an
   old-save case copying the `roughStreak`/`nightsExposed` template. Additive only; no
   SAVE_VERSION bump.
8. **Determinism**: slice 1 contains NO new rng — deposits are deterministic writes on the
   whisper path, which never occurs headless. Digest pins cannot move by construction.
9. **Telemetry**: `seed_planted` (and later `seed_germinated`) GA events — this is a perception
   feature and the only real test is whether players notice (council's playtest point).

### Slice 2 — GERMINATION (specced now, built after slice 1 reads well)

10. **The clock is 6.3 real minutes per day at 1x** (DAY 300 + NIGHT 80 sim-seconds), not the ~3
    the brief assumed — all tuning targets below use the corrected clock. Starting targets (GPT's
    concrete proposal, to be verified by an offline sweep harness before shipping): a subtle
    reminder beat ~1 dawn after deposit, germination window 2–3 dawns, expiry ~4 dawns. A
    **rate table per personality archetype** (e.g. high-curiosity ≈ 35% within 2 days,
    low-curiosity ≈ 3%) is a REQUIRED artifact of the slice, not documentation after the fact —
    unverifiable rates are how a dead feature hides behind "that's character."
11. **Germination gets its own budget** — it must never spend the farmer's daily heeds or the
    town urge cap the player's whispers draw on ("the game inspired itself instead of listening
    to me" is worse than no feature). Small, separate, under a shared ceiling; dawn arbitration
    by keyed hash, NOT farmer-array order (the array order gives early-index farmers a permanent
    win — code seat).
12. **The germination roll is a salted keyed stream** — `hashString('germ:' + kind)` folded into
    the seed, per the `#consolidateBeliefs` pattern. Reusing the conscience-roll formula would
    make the dawn draw bit-identical to that day's whisper roll for the same kind (code seat).
13. **Kind coverage is honest**: `plant` and `water` urges have NO decide-loop consumer today —
    germination on those kinds either waits for that wiring or is excluded; `URGE_HEEDED_LINE` /
    `URGE_HEEDED_VERB` need entries for every germinating kind. Fit (`#urgeFit`) is re-evaluated
    AT GERMINATION, not frozen at deposit (watch-fit includes live-raid terms).
14. **Origin-aware follow-through**: `#heededWhisper` currently chronicles every acted urge as
    "heeded a whisper" — a germinated urge must carry `origin: 'inspiration'` and get its own
    line + chronicle beat at every call site. Beat grammar copies the goal/courses tiering (quiet
    log for the moment, chronicle only for a change of heart).
15. **Slot policy**: one urge slot exists and `#plantUrge` REPLACES it. A same-morning whisper
    HEED must not silently delete the sprout, and a sprout must not invisibly eat the player's
    whisper — the collision needs an explicit rule + reply ("my mind is set on the pond today").
16. **Interrupt honesty**: sickness, raids, watch duty, and gatherings preempt every
    urge-consuming branch. A germinated urge that lapses to an interrupt does NOT clear the seed
    (the thought survives the raid week).

## ADJUDICATED CALLS — Fable code-access seat, 2026-08-12 (owner may overrule)

- **C1 — DEFY ZEROES the seed.** Every DEFY gate (low collab/high volatility, pressure ≥ 2, press
  tone) is player-manufacturable, so "defied ideas lodge deepest" turns the white-bear effect into
  the white-bear EXPLOIT — provoking spite becomes the highest-yield deposit route, aimed at
  exactly the farmers whose autonomy is the point. Zeroing gives DEFY teeth and makes nagging a
  gamble, not a strategy: pressure raises DEFY odds, and DEFY wipes your investment. The white-bear
  is banked for slice 3 as a rare, keyed, VOICED beat ("I said no. Why can I still hear it?") —
  the contradiction is only rich when the farmer acknowledges it.
- **C2 — Three surfaces, one mechanism; no persistent glyph.** (1) The germination beat quotes the
  whisper's specifics back in the farmer's voice (the continuity phrase — the only credit a player
  who forgot can parse). (2) The player's own whisper log gets a "took root, day N" marker on the
  original exchange — out-of-fiction bookkeeping in the player's notebook, so no operator-crediting
  in the town. (3) The sheet seed line for opt-in inspection. Gemini's persistent town-view glyph
  is rejected: it's the operator's dashboard and teaches optimizing the hidden bank.
  **OWNER REFINEMENT (2026-08-12): a long whisper germinates as an ABBREVIATED quote** — the
  farmer speaks a trimmed first-clause of the original whisper as they set off to do the thing
  ("...exploring past the northern fog. Today I find out."). Mechanism: `abbreviateWhisper()`
  (conscience.js) strips the conversational runway, cuts at the first clause and a word boundary
  (~42 chars), and stamps `seed.phrase` at deposit time, CLIENT-SIDE — conscienceCheck stays
  text-blind (the sim never reads the raw message; the phrase is display metadata on the
  digest-invisible ledger). Captured from slice 1 onward so every seed already carries its words
  when germination ships; sim-planted seeds (lapsed urges) have no phrase and fall back to the
  kind's verb. The sheet seed line prefers the phrase too.
- **C3 — Two channels, disjoint triggers, ONE interaction rule: pressure damps germination.**
  Pressure fires on repeat asks (already how the fold works); seeds deposit on contact; a nagged
  mind does not sprout. Player-facing sentences — pressure: "push the same thought again and they
  harden against you — and a hardened mind won't let it grow"; seed: "a thought they turned over
  may take root on its own — if you let it rest." Optimal play becomes whisper-once-then-wait:
  Kimi filed that as a bug; it is the owner's fiction made mechanical. Slice-1 replies foreshadow
  the rule ("keep pushing and it'll never take root") so the rhythm is learned before the payoff
  exists.
- **C4 — BUILD THE SMALL LEDGER; never touch the belief machinery.** The decisive finding no
  council seat caught: `#consolidateBeliefs` applies PERSONALITY DRIFT on crystallization
  (farm.js:9810 `#applyDrift`) — threading whisper deposits through beliefs would let the player
  drift a farmer's traits by whispering. That is character editing, not influence; it alone
  settles the question. Also: beliefs are regex-over-journal-text while seeds are structured
  {kind, target, w, day}; the journal evicts faint memories (a 0.5-strength seed is eviction
  fodder); and beliefs are digest-pinned where a conscience-side ledger is digest-invisible by
  construction. The house patterns (keyed stream, dawn fold, decay-floor) are reused — pattern
  reuse is not duplication. The honest coupling to beliefs is the front door: whisper → seed →
  action → LIVED LIFE → maybe a belief. Beliefs answer "who am I"; seeds answer "what might I do."

## OUTLIERS — adjudicated dispositions

- **O1 creative reinterpretation** (mill → dam through dreams): **defer to slice 3** — slice 1's
  job is teaching causal legibility, which payload mutation would sabotage; and URGE_KINDS has no
  adjacency graph, so this is new design, not an extension.
- **O2 positive receptivity channel**: **defer to slice 2 — as a SHIP-BLOCKER for germination.**
  Opus's diagnosis (every cross-day memory is anti-player) is the truest finding in the review;
  germination must not ship without its warmth channel or the game grows a second ratchet against
  its only verb.
- **O3 novelty decay**: **accepted — fixed in slice 1's deposit formula.** Deposit scales on
  weight-HEADROOM (a faded seed accepts a full deposit; a full one accepts little), not a lifetime
  counter — novelty regenerates as the seed decays and the verb never goes monotonically dark.

## EXPLICITLY DEFERRED (slice 3+ / never)

- Multi-stage decay curves per personality axis beyond the basic table; ownership-mystique
  chronicle depth; multi-farmer broadcast reinforcement; whisperer-identity salience (rejected:
  the whisperer is one disembodied voice); LLM-voiced dawn beats (procedural only — $0 doctrine).
