# Ry Farms — State of the Project (design review target)

## What it is

A fullscreen isometric pixel-art farm sim under a CRT/Game-Boy-Color shader. Every farmer ("Ry Bot") is
**grown deterministically from one real memory document** pulled from a self-hosted SuperMemory store. A
farmer's source memory seeds D&D-style ability scores (STR/DEX/CON/INT/WIS/CHA, 4d6-drop-lowest), a 6-axis
personality (collaboration/competitiveness/honesty/diligence/curiosity + derived label & creed), a dream, and
a set of creeds/beliefs distilled from the document's text. Farmers then live emergent lives: they till/plant/
water/harvest, raise chickens/cows/goats and tend ponds, forage and chop wood, build communal projects, help
and barter and occasionally cheat each other, fall sick and nurse each other, hold elections and remember who
they chose, invent new recipes by trial-and-error, and chase half-believed myths of rare ingredients grown
from the town's own memories. Weather, seasons, and a day/night cycle drive all of it. Pure ES modules, no
build step. ~1 MB of `farm.js` is the sim; `main.js` renders; `dna.js` grows farmers; `api/*` are Node
side-channels.

It is a **SuperMemory hackathon entry**: the pitch is "your memories, alive as a little society." The town
reads from SuperMemory at founding and writes each farmer's lived life, the town's civic record, and its book
of inventions back — visible in an interactive memory-graph portal reskinned in the sim's own aesthetic.

## The two load-bearing doctrines

**1. Determinism.** The sim consumes ONLY seeded RNG (`world.rand = mulberry32(seed)`, per-farmer `this.rand`,
pure position hashes) with stable, sorted iteration. Same seed ⇒ byte-identical town, verified by a headless
harness that self-compares two runs. This is the #1 invariant; three rounds of adversarial (Codex) review
were oriented around never breaking it. Any display- or player-only randomness uses a dedicated `mulberry32`
stream that is excluded from the determinism digest.

**2. Compile-don't-query.** The sim NEVER calls SuperMemory or an LLM inside its decision loop. Everything a
farmer needs to act was compiled at founding into in-sim memory (`journal`, `opinions`, `beliefs`,
`civic.impressions`, `rareBelief`, `triedCombos`), which is read live every tick. SuperMemory and the LLM are
pure SIDE-CHANNELS: SuperMemory is the archive (read once at founding, written continuously); the LLM only
dresses inventions/tales in evocative names/lore, stored in a shadow map (`recipeFlavor`/`taleFlavor`) that is
excluded from the digest — so LLM-on is byte-identical to LLM-off. The claim: this keeps the sim reproducible,
offline-capable, and cheap, while still being "memory-driven" and "AI-flavored."

## The systems, briefly

- **Crafting (generative).** A pure `deriveInvention(counts)` turns any ingredient multiset into a canonical
  recipe keyed by dominant essence + tier + quality. Rarity ABSOLUTELY gates tiers (commons cap at tier 2;
  tier 3+ needs a rare ingredient). Farmers discover recipes by trial-and-error using **folk heuristics** —
  they reason only from observable state (what they hold, past successes, situational need, town superstition),
  never the hidden essence table. A myth loop layers on top: rare ingredients start as half-believed *tales*
  grown from founders' memories, spread by gossip, drive seeking, and get *validated* when someone finds one.
- **Society.** Help economy, bartering, crop-share deals, poaching with witnesses/trials, a healer with moral
  agency, sickness/soup, bonds, gossip, reputation. Annual winter elections with civic memory (the town
  remembers terms, recalls, why). Communal build projects.
- **Memory portal.** A force-directed graph reading live from SuperMemory: farmer hubs with creed/belief/
  memory satellites, a gold TOWN hub with the civic record, amber invention nodes.

## Known tensions / open questions (please stress-test)

1. **Is "compile-don't-query" a feature or a dodge?** For a *memory* hackathon, the sim deliberately never
   consults memory live. I argue this is correct (determinism + offline + cost), and that farmers still act on
   the past via compiled in-sim memory. But a skeptic could say the headline ("memories alive") oversells what
   is really a one-time seed + a cosmetic write-back. Is the distinction honest and compelling, or a rationalization?
2. **Generativity vs. legibility.** Fully generative crafting + folk heuristics + myth loop is deep, but a
   player watching for 3 minutes may see only "farmers wander and occasionally sparkle." Is the emergent depth
   *legible* enough to land in a demo, or is it depth no one can perceive?
3. **Scope sprawl.** The feature list is large (crafting, myths, elections, healer morality, barter, poaching,
   seasons, livestock, portal, LLM naming). For a hackathon, is this impressively complete or diffuse? What
   would you CUT to sharpen the pitch?
4. **The SuperMemory integration's actual weight.** Founding reads real docs; writeback persists lives. But
   the sim runs fine offline with a fallback crew. Does the integration *earn* the "SuperMemory-powered"
   framing, or is it bolted on? What would make memory feel load-bearing rather than decorative?
5. **Determinism vs. life.** Perfect reproducibility is elegant, but does a town that plays identically every
   time from a seed undercut the "living" promise? Is there a case for controlled nondeterminism (a per-session
   entropy seed) that would make it feel more alive without sacrificing the testable core?
6. **What's most worth building next?** Candidates: richer memory-driven flavor (crop/farmer speech quoting
   source memories), a "narrator" that turns a day into a story, deeper trading/crafting economy, multiplayer/
   shared towns, or polish + a tight demo script. Which single thing most raises the ceiling?

## Current status

32 commits just pushed to `github.com/heyhaigh/farm-sim`. Three rounds of adversarial code review (5 P1s found
and fixed, final round clean). Determinism harness green. The sim is stable and demoable today.
