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
# from this directory
python3 -m http.server 8000
# then open http://localhost:8000
```

Any static file server works. The page fetches memories from the live
`https://heyhaigh.ai/api/knowledge-graph` endpoint (open CORS); if that's
unreachable it falls back to a small embedded crew so it always runs.

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
| **CON** | Keeps working through storms; crops roll the owner's CON to survive lightning (DC 12) |
| **INT** | "Green thumb" growth bonus + the harvest d20 (natural 20 = ×3 crit yield) |
| **WIS** | Harvests ripe crops before a storm hits; waters early in a drought |
| **CHA** | 14+ radiates a morale aura: +15% work speed to farmers within 6 tiles |

Farmers earn XP from work and level up, gaining +1 to a random stat.

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

## Controls

- **Drag** to pan the camera.
- **Click** a farmer to open their character sheet (stats, current thought,
  bonds, farm size, and the memory they were grown from).
- **+RY** (top-right) grows a new farmer from an unused memory.

## Files

| File | Role |
|------|------|
| `dna.js` | Fetches memories, hashes seeds, classifies archetypes, rolls stats, builds farmer sheets |
| `farm.js` | The simulation: world grid, crops, weather, day/night, the farmer agent loop, help board, communal builds, expansion |
| `pixel.js` | All procedural pixel art — farmers, crops, buildings, props, and a 3×5 bitmap font |
| `crt.js` | WebGL CRT post-process (scanlines, RGB mask, chromatic aberration, corner vignette, flicker) |
| `main.js` | Rendering, camera, input, HUD, and boot |
| `v1-3d/` | A preserved first experiment: Three.js SDF smooth-min creatures with seamless blended bodies |

## Credits

Built by Ryan Haigh with Claude Code as an expression of his "virtual self" —
worker Ryans drawn from his own stored memories. Intended to eventually live on
[heyhaigh.ai](https://heyhaigh.ai).
