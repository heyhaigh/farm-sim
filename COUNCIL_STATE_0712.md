# Ry Farms — State of the Game (for council critique, 2026-07-12)

**What it is.** A fullscreen isometric pixel-art farm/town sim under a CRT shader. It plays itself: you *watch* a town of 8 "Ry Bots" — farmers grown deterministically from real SuperMemory documents — live, farm, feud, govern, and get raided. Two cultures share one sim: **human towns** and **orc warbands** (same mechanics, orc-flavoured display copy). It's a hackathon entry for SuperMemory (self-hosted), so "little people who remember" is the whole thesis. There is **no direct control** — the player observes, and can occasionally whisper to a farmer.

**Two hard doctrines the whole codebase obeys:**
1. **Determinism.** The sim consumes only seeded rng (per-world + per-farmer) with stable sorted iteration. Same seed ⇒ byte-identical town, twice. No wall-clock/Math.random in the sim loop. A headless harness pins baselines across 4 seeds and asserts same-twice.
2. **Compile-don't-query.** The LLM + SuperMemory are *display/persistence side-channels the sim never reads in its loop* — everything gameplay-affecting is procedural + seeded; LLM output only dresses it in prose. The world layer (cross-town map) is explicitly non-reproducible, but anything crossing into a town's seeded sim goes through a serialized, exactly-once inbox.

---

## Core gameplay systems (current)

**The farmer.** Each is grown from one memory doc: FNV-hash → seeded rng → D&D ability scores (STR/DEX/CON/INT/WIS/CHA, 4d6-drop-lowest biased by archetype + memory keywords) + a 6-axis personality (collaboration/competitiveness/honesty/diligence/curiosity/volatility) with a derived label + creed. Stats drive gameplay: DEX=speed, STR=carry/build, CON=storm-hardiness + HP, INT=crop growth + harvest crits, WIS=weather foresight, CHA≥14=morale aura. XP→levels→+1 stat.

**Work loop.** Farmers till/plant/water/harvest fenced plots (multi-day crop growth), diversify into facilities (pond+koi / chicken coop / livestock pen), forage the wilds (berry/mushroom/herb/root), chop wood, mine ore, hunt game for meat. A priority-based decide() picks each errand from lived state.

**Health economy (just reworked).** Farmers start at full HP. Combat/illness wounds them; **rest mends to ~78%, and the last stretch needs MEAT.** A wounded farmer now *proactively* hunts or barters a neighbour for meat (prioritized over gardening), so the town trends back to full instead of plateauing at ~60%. A framed green→amber→red health bar shows over the wounded.

**Social layer.** Opinions, bonds, grudges (visible heart/X emote tells), a help economy (post a backlog → an idle neighbour walks over and works your plot), barter (surplus-for-want; some drive lopsided deals), recipe-teaching, gossip, low-honesty crop poaching with a witness/reputation system, and "cry-wolf" fake help requests.

**Civic layer.** A town holds NO office for its first 10 days. **On day 10 the whole town gathers at the square (a visible ceremony), deliberates through midday, and by dusk the ballot is read** — a memory-driven vote (each farmer votes from lived impressions + regret over past votes) seats Manager + Watch with a grand spotlight modal. Yearly winter elections handle turnover; rare recalls for genuine collapse; a Watch runs theft trials; roles persist to a town-history doc in SuperMemory.

**Crafting / recipes.** Base remedies (soup/salve/tonic) plus emergent invented recipes: a farmer combines larder goods → a novel recipe (LLM-named + lore, procedurally-effected). The RECIPES tab now shows contents as **ingredient icons + quantity badges with hover tooltips** instead of text.

**Lore / memory.** Farmers carry dreams (arcs that fulfil into public beats), journals they re-read at dawn to set new goals, "tales of the wilds" (rare ingredients grown from the town's own memories, proven-real or myth), and a running **Chronicle** (news/roles/recipes/tales). Profound beats spotlight as grand modals. Lives are written back to SuperMemory tagged `ry-farms`; a force-graph memory portal reads them live.

**Seasons/weather.** Spring→Summer→Fall→Winter (+year), each shifting crop growth, water decay, weather odds, ground palette. Weather: sun/cloud/rain/storm(+lightning CON-saves)/drought/blizzard drives day/night behaviour.

**Cross-town / reconciliation.** A zoom-out world map of every town this browser has grown. Towns encounter each other: rumor→traveler→arrive/lost→awareness, and **raids** (war doctrines comitatus/strandhogg/greatMuster/palisade scale the raid). News of a distant clash propagates to third towns. An honest cross-faction parley earns a belief that begins to overwrite a raider's raid-creed (the "mechanism of hope").

**Raids — just made visible.** Previously a cross-town raid was a text line. Now, when it lands on the *watched* town, a **named orc warband (2–4 raiders) appears at the fence and presses inward**, a grand **"RAIDERS AT THE GATE"** spotlight fires, the whole town is roused, and the Watch + brave rally to drive them off (reusing the encounter-combat + monument system — felling one raises a memorial stone). Dormant towns keep the instant text-callout. Harvest is docked as stores carried off.

---

## This session's changes (all local, verified; determinism holds)
- Founding-vote ceremony (day-10 gather → dusk ballot → grand modal).
- Visible raid spectacle (warband + alarm modal + defenders).
- Health rework (start full; rest-cap 0.6→0.78; proactive hunt/barter-for-meat when wounded; redesigned bar).
- Multi-line saying animation (full sentiment cycles line-by-line vs truncation).
- Recipe icon-slots (icons + quantity badges + tooltips).
- 1-bit-pack UI icons for the top bar + hover tooltips; emote tells (heart/X) swapped to pack icons.

---

## What I want the council to stress-test
1. **Are raids working as a mechanic?** A warband appears, alarms, is fought off, docks stores, can leave a monument. Satisfying/legible loop — or does it need stakes beyond a harvest dock (burned crops, a captured farmer, a revenge arc, player-influenceable defensive prep)? Is spawning at the fence + reusing wilderness-encounter combat coherent, or does a raid need its own distinct feel?
2. **Is the lore layer landing?** Farmers-from-memories + dreams + journals + tales + chronicle + writeback. Does this cohere into *characters you care about*, or a pile of systems that don't add up to legible story? Highest-leverage thing to make "little people who remember" *felt* in 60 seconds of watching?
3. **Do the general mechanics hold together?** Is there a core loop for the *watcher* (observe + occasionally whisper), or is it a screensaver? What's missing to make watching compelling? Anything over-built relative to payoff?
4. **Balance & pacing.** Health plateau just fixed; elections day-10 then yearly; raids gated to live play. Obvious balance traps (death spirals, runaway leaders, empty mid-game)?
5. **Coherence of the vision.** Does "deterministic pixel town grown from your real memories, that you watch live and get raided" hold together as a *thing* — and what's the single most worth building next vs. cutting?
