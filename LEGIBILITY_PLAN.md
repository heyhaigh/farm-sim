# Ry Farms — "Legible Inner Life" Work Plan (Path B)

## Why this, why now
Council verdict (unanimous): the new systems added sim *breadth* faster than *readable inner life* —
hunting/HP/barter run on generic stats the player can't SEE as memory- or personality-shaped. Their
top consensus fixes cluster into two moves: **A — characterful trade** and **B — map-legible inner
life**. Reviewer C's argument won the ordering: *A only matters once the player can see WHY a trade
happened.* So **B goes first**. (Path A — memory-driven trade — is HELD; the user has a separate
strategy for the memory layer.)

The goal of Path B: a player skimming the map should be able to read a farmer's **wants, wounds,
grudges, and decisions without opening a sheet** — and should be able to *witness* the dramatic
moments the sim already generates instead of only reading them after the fact in the chronicle.

## Guardrails (what we are NOT doing — council consensus)
- **No player verbs / god-hand** (candidate C). Unanimous kill — it breaks the observer identity.
- **No new sim/economy systems** until the existing ones express the agents.
- **Defer legends/monuments** (F) until day-to-day stories are visibly generated.
- **Defer memory-themed wildlife** (D) — decorative.
- This is a RENDER/UX + light-hook pass (mostly main.js, small farm.js state exposure). Determinism
  must stay untouched — legibility reads sim state, never feeds back into it.

---

## The B pass — 5 pieces, in build order

### B1. Wounded is visible (fixes "HP stakes are invisible") — highest value
A farmer hurt below the rest-cap should LOOK hurt, so the HP economy reads on the map.
- **What:** a farmer with `hp < maxHp` while up-and-about shows a small red wound pip / heart over
  their head that empties as HP drops; a badly-hurt farmer (< ~35%) also *limps* — a slower, hitched
  walk (halve the bob cadence + a slight vertical stutter in `drawFarmer`).
- **Where:** `main.js` farmer render (reuse the skull/blood-drop marker system already used for
  downed/sick); read `f.hp / f.maxHp`. No sim change.
- **Why:** the council's #1 "med" gripe across A/B/C. Turns "revive frail → hunt for meat" from an
  invisible number into a visible arc.

### B2. Intent at a glance (fixes "why is this happening?")
A compact ICON-tag above the head for the farmer's current DRIVER, readable without the sheet.
- **What:** a tiny icon that reflects state/thought — e.g. a bow/paw for `hunt`, a coin/handshake for
  a `barter` errand, a broken-heart/frown when detouring from a rival, a `!` for fight/flee, a `+` for
  helping. Fades in/out like the existing thought bubble; icon-first so it's language-free.
- **Where:** `main.js`, above the farmer, keyed off `f.state` + `f.thought`/`f.barterDeal`/
  `f.huntTarget`. Builds on the existing think-bubble cadence (#65).
- **Why:** the council wants motives legible in real time, not just as chronicle prose.

### B3. Grudges & bonds shown in the act (fixes "provenance/relationships are inert outputs")
Make the social sim *witnessable* at the moment it bites.
- **What:** when a farmer recoils/detours from a disliked neighbour (the existing `#dislikedNear`
  recoil in the walk state) they flash a frown/`!` emote; when they choose to settle/work near a
  friend they flash a warm emote. Optional: a brief "grudge line" drawn between two farmers who just
  had a rift/theft, fading over a second.
- **Where:** `main.js` emote layer; hook the existing recoil + bond/rift events. No sim change.
- **Why:** turns "opinions/bonds" from sheet numbers into behaviour the player catches happening.

### B4. Witnessable drama (fixes "the dramatic loop happens off-camera") — high value
Surface off-screen high-stakes beats so the player can choose to watch them.
- **What:** when a peril/hunt-kill/rift/downed beat fires off-screen, show a subtle directional
  indicator at the map edge (reuse the existing off-screen threat arrow) + fold it into the
  `mostInterestingFarmer()` follow pick, and optionally a one-tap "watch" prompt on the day-recap /
  a keypress to snap to it. Never auto-yank the camera (respect the observer).
- **Where:** `main.js` — extend the existing off-screen threat-arrow + follow/attention UI (#76).
- **Why:** all four reviewers flagged remote hunting as wasted drama; this reuses machinery we have.

### B5. Public micro-rituals (fixes "no witnessed success/recovery arcs")
Small, witnessable moments that close a loop on-screen.
- **What:** a hunter returning to their plot with a kill briefly holds up the meat (a trophy pose +
  a "brought home a deer" chronicle beat that names the animal); a farmer who recovers past the
  rest-cap gives a small perk-up sparkle. Keep it to 2-3 beats — no ceremony bloat.
- **Where:** `main.js` render + a couple of `farm.js` chronicle hooks at hunt-return / recovery.
- **Why:** the council wants the "hurt → hunt → return → changed" arc to have visible punctuation.

---

## Sequencing
1. **B1 (wounded visible)** — self-contained, highest identity payoff, easiest win.
2. **B2 (intent tags)** — makes every other system legible; pairs naturally with B1.
3. **B4 (witnessable drama)** — reuses the threat-arrow/follow UI; unlocks the hunting payoff.
4. **B3 (grudges in the act)** and **B5 (micro-rituals)** — polish that deepens once B1/B2/B4 land.

Each ships as its own commit, browser-verified, determinism digest unchanged (render-only). After B,
**Path A (characterful, memory-driven trade)** picks up on the user's strategy — now that the player
can see the reasons a trade would express.

---

## Full post-council backlog & ordering
The council's candidate moves were A–F plus several "Missing" enhancements. Ordered:

1. **Path B — legible inner life** (#79–83): B1 wound/limp → B2 intent tags → B4 witnessable drama →
   B3 grudge/bond emotes → B5 micro-rituals. *(this doc, above — do first)*
2. **Personality-textured failure states** (#86): cowards bail, proud overextend, honest confess,
   volatile escalate — pairs naturally with B (same "see who they are" goal).
3. **Theft & unfairness get social teeth** (#87): victims remember, gossip spreads, trust drops,
   cooperation refused — extends existing gossip/reputation to goods (NOT the trade-bargaining logic).
4. **E — town identity affects behavior** (#84): loner vs collaborative vs competitive towns act
   differently (aid, trade, gossip density), not just look different.
5. **F — legends & monuments** (#85): deeds/deaths become permanent map marks + chronicle epics —
   deliberately AFTER B, so there's legible story worth memorializing.
6. **Path A — characterful, memory-driven trade** (HELD): the user has a separate memory strategy;
   B makes the player able to SEE why a trade would express, so A lands last of the features.
7. **#61 — sprite/component library**: the final housekeeping pass, per the standing "last thing" rule.

### Deliberately NOT built (council consensus)
- **C — player verbs / god-hand:** unanimously killed; breaks the observer identity.
- **D — memory-themed wildlife (named animals / memory-colored forage):** killed as decorative; only
  reconsider if it drives BEHAVIOR, not symbolism.

### Open balance notes (watch, don't task yet)
- Meat as both currency AND health-potion risks becoming a generic utility token (reviewer C).
- The housing/town-level ladder may pull toward progression grind, away from the people (reviewer C).
