# Ry Farms — State of the Game, Re-Review (2026-07-14)

**This is a follow-up review.** Two days ago a 4-model council + a Fable taste pass reviewed this project and
found it "an intricate screensaver, not a game." This doc restates what it is, then maps **each prior concern to
what we actually shipped**, and asks you to judge: *given the changes, where do we stand — and was our chosen
direction (below) right?*

---

## What it is
A fullscreen isometric pixel-art farm/town sim under a CRT shader. It **plays itself** — you *watch* a town of 8
"Ry Bots," farmers grown deterministically from real SuperMemory documents, live/farm/feud/govern/get raided.
Two cultures share one sim: **human towns** and **orc warbands**. Hackathon entry for self-hosted SuperMemory, so
"little people who remember" is the whole thesis. No direct control — you observe, and can **whisper** to a farmer.

**Two hard doctrines:** (1) **Determinism** — the sim consumes only seeded rng, same seed ⇒ byte-identical town;
anything crossing in from the cross-town world layer arrives via a serialized, **exactly-once** inbox (the town's
trajectory = seed + its ordered inbox). (2) **Compile-don't-query** — the LLM + SuperMemory are display/persistence
side-channels the sim never reads in its loop.

---

## The prior review split — and the fork we took
The two voices **disagreed on cut-vs-add**:
- **The council** (esp. GPT-5.6-sol / Grok) pushed **ADD**: the raid is a shallow resource tax; give the watcher
  player-influenceable **defensive prep** — visible threat level, watch assignments, fortifications, store
  concealment, diplomacy, opportunity costs.
- **Fable** pushed **SURFACE, don't add**: the depth already exists but is *invisible*; make the memory→farmer
  link legible, make the whisper's ripple visible, make the raid resolver authoritative — **zero new balance
  surface**. Fable's #1 was **persistence** ("little people who *remember* forgets everything on reload — build
  this first; small, design-risk-free, multiplies everything"), and Fable explicitly deferred behavior-nudge
  mechanics (fortify/scout) as *"the least memorable, highest balance risk — deferred, possibly forever."*

**We followed Fable.** Everything below is legibility + persistence + correctness, NOT new tactical mechanics.

---

## What we shipped since the last review (all verified; determinism baselines byte-identical throughout)

**Legibility slices (the direct response to "screensaver / invisible memory"):**
1. **Memory surfacing** — at charged beats (a crop crit, a bond forming, a dream fulfilled, a recovery) a farmer
   surfaces its **source memory** as a distinct bubble: *"GROWN FROM {document title}"* woven with words from that
   doc. The memory→behavior link is now visible on the board, not buried in a tab.
2. **The whisper, defined + given a visible ripple** — the whisper is now a real mechanic: a bottom-left widget,
   you whisper to a chosen farmer, it **biases that farmer's urge** (rest/build/explore/hunt/trade/…), and when
   they act on it a **"heeded a whisper"** chronicle beat + a gold tell fire. It's a display/urge side-channel —
   it never perturbs the seeded digest, so player input and determinism coexist.
3. **Authoritative raid resolver** — ONE resolver produces the outcome; a **watched** raid and a **dormant** raid
   are now proven **byte-identical** (harvest/wounds/monuments/fog/rng). The watched raid is a display layer over
   the already-resolved outcome.

**Raid presentation (still no new tactical mechanic — per Fable):**
- A full **"UNDER RAID" battle-transition** (Pokémon-style war-band wipe + red flash + screen shake), the camera
  **snaps to the warband**, a **W** shortcut re-focuses it, an audio sting. The Watch **mechanically** matters
  (it adds defense power and supplies the avenging hero in the resolver). Felling a raider raises a monument;
  harvest is docked; defenders are wounded; it's written to the chronicle. All of it **persists** across reload.

**Weather/context-aware speech** — farmers now speak to the world (weather, season, mood, exhaustion) instead of
generic idle lines; display-only, determinism-safe.

**Persistence + determinism hardening — Fable's #1, made real (six adversarial review rounds):**
- The whole town now **survives reload** — a farmer's lived state, the discovered map, bonds, chronicle,
  monuments, civic roles, and every rng-gating cooldown persist (so a reload doesn't silently re-roll behavior).
- Cross-town raids/travelers/parleys cross in **exactly-once** (watermarked inbox); wipe/undo is a single atomic
  transaction that preserves pending cross-town state; the world index is bounded; the memory-writeback endpoint
  is hardened. A committed regression suite (determinism + save round-trip + raid adversarial + world-index +
  writeback) locks it in. **The reviewers' #1 technical fear — "cross-town raids break byte-identical" — is now
  architecturally answered and verified, not asserted.**

---

## What we deliberately did NOT do (following Fable)
- **No defensive-prep / fortify / scout mini-game** (the council's headline ask). Fable called this the least
  memorable, highest-risk direction; we deferred it.
- **No burned crops / captured farmers / revenge arcs** (deepening an unproven loop before legibility lands).
- **No cut of cross-town breadth** — instead of freezing it (council C's alt), we made it *correct + legible +
  persistent*.

---

## The questions for this re-review
1. **Did the legibility slices resolve the "screensaver / invisible memory" verdict?** Is "little people who
   remember" now *felt* — a farmer surfacing its source doc, a whisper you gave being heeded, a raid that fells
   someone whose arc you were following? Or is the memory connection still not legible enough in 60 seconds?
2. **Was following Fable (surface, don't add) the right call over the council (add defensive agency)?** With the
   raid now authoritative + a spectacle + persistent + the Watch mattering — but with **no player-influenceable
   prep** — is a raid a *meaningful* beat, or does the absence of pre-raid agency still leave it a "watch it
   resolve" event? Who was right?
3. **Is the raid/orc/reconciliation arc legible as a story?** unknown→rumored→traveler→encounter(raid|parley)→
   reconciliation, with asymmetric awareness (only the destination learns — dramatic irony). Reconciliation is
   still a belief that begins to overwrite a raid-creed. Does the arc *read*, or is reconciliation a flag-flip?
4. **Now that persistence + determinism are hardened (Fable's #1, six rounds deep), what's the single
   highest-leverage next thing** — a further *surfacing* move (make an existing system legible/resonant), or has
   the surfacing bottomed out such that the council's *add-a-mechanic* view is now the right next step?
5. **Coherence.** Does "deterministic pixel town grown from your real memories, that you watch live and get
   raided" hold together as a *thing* — and what would you cut?
