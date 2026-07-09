# Ry Farms

A fullscreen, isometric **pixel-art farming simulation** where every farmer — a
"Ry Bot" — is procedurally grown from a real memory in Ryan's
[SuperMemory](https://supermemory.ai) knowledge graph. Each one gets a D&D-style
character sheet, its own thoughts, and the drive to build a farm. They till,
plant, water, and harvest; they ask each other for help; they raise communal
buildings together; and their farms — and the town itself — grow over time.
The whole thing renders through a CRT shader.

No build step. Pure ES modules + Canvas 2D + a WebGL post-process.

## Run

```bash
# from this directory — static files + the optional LLM endpoints
node server.mjs            # http://localhost:8000  (node server.mjs 8001 for another port)

# or any static server (game fully works; LLM channels just fall back)
python3 -m http.server 8000
```

The page fetches memories from the live `https://heyhaigh.ai/api/knowledge-graph`
endpoint (open CORS); if that's unreachable it falls back to a small embedded
crew so it always runs.

### Optional LLM channels (expressive only — never in the sim loop)

With `OPENAI_API_KEY` in the environment or a gitignored `.env` next to
`server.mjs` (deployed: on the serverless host), two out-of-band channels wake:

- `api/ry-farms-chat.js` — farmers generate contextual two-line conversations
  from their goals, memories, relationships, weather, and town state.
- `api/ry-farms-dm.js` — the chronicler: a 5e-DM/fantasy-writer rewrites each
  farmer's procedural origin tale as richer prose, once per town, cached on the
  sheet and carried by the save (`dm.js` is the client side).
- `api/ry-farms-conscience.js` — the conscience channel (see below): a two-stage
  call that CLASSIFIES a player's whisper into one bounded urge, then writes the
  farmer's in-character REACTION to the verdict the sim decided (`conscience.js`
  is the client side). Offline it falls back to a keyword classifier + templates.

`RY_FARMS_LLM_MODEL` can override the model. Both channels are display-text
only and fall back to the procedural versions on any failure, so the seeded
sim stays deterministic with or without them.

## How a farmer is made

Every farmer is **deterministic**: the same memory always grows the same farmer
(until you mutate it).

1. A SuperMemory document is hashed (FNV-1a) into a seed for a `mulberry32` RNG.
2. Keyword clustering sorts the memory into an **archetype** — Voice Herald,
   Athlete, Designer, Builder, Homebody, or Greeter — which sets crop, hat, and
   palette.
3. Six ability scores (**STR / DEX / CON / INT / WIS / CHA**) are rolled
   4d6-drop-lowest, then nudged by keywords in the memory text and the
   archetype's bias.

Those stats drive real behavior:

| Stat | Effect in the sim |
|------|-------------------|
| **STR** | Water-carrying capacity (4 vs 2 pails) and build speed |
| **DEX** | Walk and work speed |
| **CON** | Keeps working through storms; crops roll the owner's CON to survive lightning (DC 12); resists illness |
| **INT** | "Green thumb" growth bonus + the harvest d20 (natural 20 = ×3 crit yield) |
| **WIS** | Harvests ripe crops before a storm hits; waters early in a drought |
| **CHA** | 14+ radiates a morale aura: +15% work speed to farmers within 6 tiles |

Farmers earn XP from work and level up, gaining +1 to a random stat.

## Personality — who a farmer *chooses* to be

Where stats decide how *well* a farmer works, four personality axes (also read
from the memory) decide *how they behave*. Each is a 0–1 value, and their blend
produces a named identity and a one-line creed (Pillar, Cutthroat, Schemer,
Lone Wolf, Workaholic, Free Spirit, Straight Shooter, and more):

- **Teamwork (collaboration)** — high: readily answers the help board, joins
  town projects, checks on sick neighbors. Low: keeps to their own fence line.
- **Drive (competitiveness)** — high: chases the top of the harvest
  leaderboard, works later when behind, won't help their direct rival.
- **Honesty** — high: only asks for help when truly needed, always reciprocates,
  calls out thieves. Low (manipulative): posts *fake* help requests to farm free
  labor, and will quietly **poach a ripe crop** from a neighbor when nobody's
  watching — losing reputation if an honest neighbor catches them.
- **Work ethic (diligence)** — sets how late they'll stay up (see below).

Every farmer also carries a **reputation** that helping raises and cheating
lowers; low-reputation farmers get help less readily.

## Energy, sleep & sickness — nobody's on the same clock

Work drains energy; sleeping in one's own house restores it. Crucially, **each
farmer picks their own bedtime** from their work ethic and competitiveness — a
Free Spirit turns in the moment night falls, while a Workaholic (or someone
trailing the leaderboard) burns the midnight oil, working by lantern-light long
after the others are asleep. Tired farmers move and work slower and fumble
harvests more.

But there's a cost to overwork: chronic late nights build **sleep debt**, and
each dawn an exhausted farmer must make a CON save or **fall ill**. A sick
farmer stays home in bed, works at a crawl, and recovers over a few days —
faster if a kind-hearted neighbor brings them soup.

## Seasons

The year loops **Spring → Summer → Fall → Winter** (a few days each). Seasons
retint the ground, shift the weather odds (summer brings droughts, winter brings
storms and snow), and change how fast crops grow — winter nearly freezes growth,
while summer races it. Watch for drifting snow and falling autumn leaves.

## The agent layer

Farmers aren't on fixed scripts — each runs a small decision loop every tick:

- **Thoughts.** A farmer narrates what it's doing (and, when idle, muses —
  sometimes quoting the memory it was grown from). Shown on the character sheet
  and surfaced as speech bubbles.
- **A help economy.** A farmer swamped in a task it's *bad* at posts to the town
  help board. Idle neighbors who are *good* at that task walk over, work the
  requester's fields (the harvest credits the owner), and the two form a
  **bond**.
- **Communal projects.** As the town's total harvest grows, projects unlock one
  at a time — Toolshed, Windmill, Storm Tower, Second Well — each granting a
  town-wide buff. Farmers converge on the scaffold and build it together.
- **Growth.** Farms expand their fence line at harvest milestones, and when the
  first ring of homesteads fills up, a new ring opens farther out and the town
  grows.

## The conscience — whispering to a farmer

In the bottom half of the ROSTER window you can **whisper a thought** to any
farmer. You are not a character they can see; you're a stray inner voice. What
happens next is decided by the *sim*, not the words:

1. The whisper is **classified** into one bounded urge (chop, plant, explore,
   build, rest, hunt, trade, visit someone, or nothing).
2. A **deterministic check** — seeded by the farmer, the urge, and the day, never
   by the message — returns one of six verdicts: **HEED** (takes it up as their
   own idea), **ALREADY** (they were going to anyway), **BARGAIN** (later, once
   the work's in), **DISMISS**, **QUESTION** (wonders where the thought came
   from), or **DEFY** (bristles and does the opposite).
3. The farmer **replies** in character, coloured by a fixed *stance* toward the
   voice (skeptic / believer / bargainer / unbothered).

Because the roll is seeded by the *kind* of thing you ask and the day — not the
sentence — **asking fifty times won't change a mind.** A heeded urge only ever
*nudges* a decision (capped below the pull of their lifelong dream), expires by
the next day, and is bounded by a daily and town-wide budget so the voice can
never turn the town into a puppet show. Whispers stay private: they never leak
into gossip, the chronicle, or farmer-to-farmer chat. The whole conversation is
saved with the town.

## Controls

- **Drag** to pan the camera.
- **Click** a farmer to open their character sheet (personality traits, energy &
  health, stats, current thought, bonds, reputation, farm size, and the memory
  they were grown from).
- **ROSTER** (top-right) opens a scrollable town-wide list — every Ry's level
  and stats at a glance, sorted by yield. Click a row to jump to their sheet.
  The bottom half is the **CONSCIENCE CHAT**: whisper a thought to any farmer
  (pick who with the name dropdown) and they'll act on it, ignore it, or wonder
  where it came from — never simply obey. See below.
- **+RY** (top-right) grows a new farmer from an unused memory.

## Files

| File | Role |
|------|------|
| `dna.js` | Fetches memories, hashes seeds, classifies archetypes, rolls stats, builds farmer sheets |
| `farm.js` | The simulation: world grid, crops, weather, day/night, the farmer agent loop, help board, communal builds, expansion |
| `pixel.js` | All procedural pixel art — farmers, crops, buildings, props, and a 3×5 bitmap font |
| `crt.js` | WebGL CRT post-process (scanlines, RGB mask, chromatic aberration, corner vignette, flicker) |
| `main.js` | Rendering, camera, input, HUD, boot, and the roster/conscience-chat UI |
| `conscience.js` | Client for the conscience channel — classify, sim check, reply, offline fallbacks |
| `v1-3d/` | A preserved first experiment: Three.js SDF smooth-min creatures with seamless blended bodies |

## Credits

Built by Ryan Haigh with Claude Code as an expression of his "virtual self" —
worker Ryans drawn from his own stored memories. Intended to eventually live on
[heyhaigh.ai](https://heyhaigh.ai).
