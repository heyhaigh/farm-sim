# Propagate

> ### 🧠 Built on SuperMemory
> A living world where every inhabitant is **grown from a real memory** — and every
> life they go on to live is **written back as a new one**. Propagate closes the loop
> on a **self-hosted [SuperMemory](https://github.com/supermemoryai/supermemory)**
> instance: *memories in, a society out, lives back in.*

Propagate is a fullscreen, isometric **pixel-art farming simulation** where every
farmer is procedurally grown from a document in a self-hosted
SuperMemory knowledge graph. Each gets a D&D-style character sheet, its own thoughts,
relationships, and the drive to build a farm; together they raise a town that grows,
remembers, and finds other towns. The whole thing renders through a CRT shader, with
no build step — pure ES modules + Canvas 2D + a WebGL post-process.

### ▶ Play the live demo — **[farm-sim-rosy.vercel.app](https://farm-sim-rosy.vercel.app/)**

One click, nothing to install. (Drag to pan · click a farmer for their sheet ·
**M** for the world map · **ROSTER** to whisper to a farmer.)

## SuperMemory, end to end

The substrate is a **self-hosted SuperMemory** instance (`npx supermemory local`,
`http://localhost:6767`) — local-first, never the cloud. Propagate uses it as a full
**read → compile → write → re-read loop**, not a one-time data dump:

1. **Grow from memory (read).** `api/knowledge-graph.js` lists the instance's
   `/v3/documents` with a Bearer key that never reaches the browser; each doc is
   FNV-hashed into the seed that grows one deterministic farmer — archetype, stats,
   personality, and creed all fall out of that memory's content.
2. **Memory is load-bearing (proof).** `node tests/ablation.mjs` founds three towns
   from the *same seed* but different memory sources (real corpus / shuffled / invented)
   and shows they grow into **observably different societies**. Same seed, different
   memories ⇒ a different town: the integration *changes the world, it doesn't decorate it.*
3. **Write lives back (write).** `api/memory-writeback.js` persists each farmer's
   *compiled inner life* — and the town's political history — back into SuperMemory,
   tagged (`ry-farms` container) so those generated life-docs are filtered OUT on read
   and never contaminate the source corpus. A farmer's remembered life outlives any save.
4. **Walk the graph (portal).** The memory portal (`memory-graph.html`) reads the living
   graph back through `/v4/search` and renders it in the sim's own CRT aesthetic —
   farmer hubs orbited by their creed, beliefs, and the source memories they grew from.

**Compile-don't-query.** The *sim itself* pulls its corpus ONCE at town founding and
never calls SuperMemory again mid-tick — memory-derived content is frozen into a seeded,
reproducible substrate. The whole read/write loop lives *around* the sim (founding,
writeback, portal), never inside its hot path, so the world stays deterministic and testable.

## Run it locally

**Just play it — zero setup.** Serve the folder and open it. No build, no keys, no
accounts. The CRT world, farmers, crops, and buildings are all procedural, and it
founds a town from an embedded offline crew, so it's fully playable out of the box:

```bash
node server.mjs            # http://localhost:8000  (node server.mjs 8001 for another port)
# ...or any static server:
python3 -m http.server 8000
```

> **Environment art (trees, rocks, wildlife, orc biome) comes from free CraftPix
> packs that their license doesn't allow redistributing, so they're not in this repo**
> (`assets/` is gitignored). The game **degrades gracefully** without them — the
> procedural farmers, crops, and buildings still render (that's what the
> [live demo](https://farm-sim-rosy.vercel.app/) currently shows). For the full
> CraftPix look, download the free packs listed under [Credits](#credits) into `assets/`.

Everything below is **optional** — each integration falls back cleanly if it's absent.

### Memory: grow farmers from your own SuperMemory

Point it at a self-hosted [SuperMemory](https://github.com/supermemoryai/supermemory)
instance in `.env` (copy `.env.example`). Without one, the town founds from the
embedded crew:

```bash
SUPERMEMORY_URL=http://localhost:6767      # npx supermemory local
SUPERMEMORY_API_KEY=sm_...                 # printed on the instance's first boot
```

Compile-don't-query: the corpus is pulled ONCE at town founding; the sim never calls
SuperMemory mid-tick — memory-derived content is frozen at founding.

### Optional LLM channels (expressive only — never in the sim loop)

The expressive channels run against **any OpenAI-compatible endpoint** — OpenAI by
default, or a local model for a fully self-contained stack. Set in the environment
or a gitignored `.env`:

```bash
OPENAI_API_KEY=sk-...                       # blank is fine for most local servers
OPENAI_BASE_URL=http://localhost:11434/v1   # e.g. Ollama — omit to use OpenAI
RY_FARMS_LLM_MODEL=gpt-4.1-mini             # or a local model id
```

**Local + free via [Ollama](https://ollama.com)** (no key, nothing leaves your machine):

```bash
# 1. install Ollama         — https://ollama.com  (macOS: `brew install ollama`)
# 2. pull any chat model
ollama pull gpt-oss:20b     # or llama3.2 / qwen2.5 — smaller = faster
# 3. Ollama serves an OpenAI-compatible API on :11434; in .env point Propagate at it:
#      OPENAI_BASE_URL=http://localhost:11434/v1
#      RY_FARMS_LLM_MODEL=gpt-oss:20b
```

Or just set `OPENAI_API_KEY` and leave `OPENAI_BASE_URL` unset to use OpenAI. With
either configured, three out-of-band channels wake (all share `api/_llm.js`, so all
are endpoint-portable):

- `api/ry-farms-chat.js` — farmers generate contextual two-line conversations
  from their goals, memories, relationships, weather, and town state.
- `api/ry-farms-dm.js` — the chronicler: a 5e-DM/fantasy-writer rewrites each
  farmer's procedural origin tale as richer prose, once per town, cached on the
  sheet and carried by the save (`dm.js` is the client side).
- `api/ry-farms-conscience.js` — the conscience channel (see below): a two-stage
  call that CLASSIFIES a player's whisper into one bounded urge, then writes the
  farmer's in-character REACTION to the verdict the sim decided (`conscience.js`
  is the client side). Offline it falls back to a keyword classifier + templates.

`RY_FARMS_LLM_MODEL` can override the model. Both channels — and the in-town
conversation LLM — are **display-text only**: they decorate the words on screen
but never draw sim RNG or write sim state, so the seeded sim is byte-identical
with or without them (the LLM decorates, it never decides).

## A living world on a reproducible substrate

Propagate is **a living world** first — towns that grow, remember, and (soon) find
each other. Underneath that world is a **reproducible substrate**: a single town's
*founding and sim* are deterministic — same seed ⇒ the same town, twice — so the
whole thing stays testable and honest. That reproducibility is a substrate property,
not the pitch: the world layer above it (expressive chat, encounters, cross-town
migration, memories written back and re-entering as new lineage) is explicitly
**alive and non-identical** — it's *meant* to diverge. Determinism is what we test;
a living world is what we build.

The substrate is checked by a committed headless harness (sim only, LLM +
SuperMemory off):

```
node tests/determinism.mjs
```

It boots the founder cast, ticks 30 days, and hashes farmer + world state across
two runs of each seed. `same-twice=false` is a P0 bug. The harness also pins
baseline digests; a legitimate sim change re-baselines them (update the constant),
but the same-twice property must always hold. (Cross-machine byte-identity is **not**
promised — the guarantee is per-town, LLM-off, headless reproducibility.)

**Memory is load-bearing** — proven by the ablation harness:

```
node tests/ablation.mjs
```

It founds three towns from the *same seed* but different memory sources — a real
corpus, that corpus shuffled, and the invented fallback — ticks each 30 days, and
shows they grow into **observably different societies** (different archetype mix,
different creeds, different lived outcomes). Same seed, different memories ⇒ a
different town: the SuperMemory integration changes the world, it doesn't decorate it.

## A world of towns

A town is the reproducible substrate; the **world** is the living layer on top. Every
town this browser grows is remembered in a world index and shown on a zoom-out map
(the **WORLD** button, or press **M**): towns as memory-tinted dots, lines tracing which
town each was **founded from** (the closed memory loop at world scale), and gold links
where two towns have grown into each other's reach. Click a town to inspect it; **VISIT**
switches to it.

**Orc warbands.** Add `?orc=1` to grow a town from the *same* SuperMemory substrate
through an inverted lens: the same memory that makes a Designer makes a **Runecarver**;
cultivate-creeds become raid-creeds; personalities weight to competitiveness and temper.
On the world map an orc warband is ashen and blood-red, and when it grows into a human
town's reach the encounter is a **raid**, not a trade — and the raided town *remembers*.

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
| `api/knowledge-graph.js` | **SuperMemory read** — server-side proxy that lists `/v3/documents` (Bearer key never reaches the browser) and normalizes the corpus that grows the town |
| `api/memory-writeback.js` | **SuperMemory write** — persists each farmer's compiled life + the town's history back to SuperMemory, tagged so it never re-enters as a source memory |
| `api/memory-graph.js` + `memory-graph.html` | **The memory portal** — reads the living graph via `/v4/search` and renders it in the sim's CRT aesthetic |
| `tests/ablation.mjs` | **Proof memory is load-bearing** — same seed, different memory sources ⇒ observably different societies |
| `v1-3d/` | A preserved first experiment: Three.js SDF smooth-min creatures with seamless blended bodies |

## Credits

Built by Ryan Haigh with Claude Code as an expression of his "virtual self" —
worker farmers drawn from his own stored memories. Intended to live on
[heyhaigh.ai](https://heyhaigh.ai).

- **Memory** — [SuperMemory](https://github.com/supermemoryai/supermemory), self-hosted; the genome every farmer is grown from.
- **Local LLM** — [Ollama](https://ollama.com) powers the offline expressive channels (chat / chronicler / conscience).
- **Environment art** — free top-down pixel-art packs from **[CraftPix](https://craftpix.net)**, used under their free license and **not redistributed here** (download them into `assets/` for the full look). Packs used: top-down trees, bushes, rocks & stones, forest objects, rocky-area objects, hunt-animals, farm-animals, plants-for-farm, guild-hall, the "main characters home" set, the orc character pack, the swordsman (lvl 1–3) set, and the basic RPG UI + 16×16 fantasy-icon sets.
- The **procedural** farmers, crops, buildings, CRT shader, and bitmap font are original (`pixel.js` / `crt.js`); character and tile variety takes cues from Brandon James Greer's pixel-art breakdowns.
