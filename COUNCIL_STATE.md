# Ry Farms — Design State & Where Next (for council review, round 2)

## What the game IS (its identity)
A fullscreen isometric pixel farm sim under a CRT shader. The hook: **every farmer is grown
deterministically from a real SuperMemory document** — the memory's text biases D&D stats
(STR/DEX/CON/INT/WIS/CHA) and a 6-trait personality (collaboration, competitiveness, honesty,
diligence, volatility, curiosity). They're *agents*, not scripted NPCs: episodic journals, dawn
reflections that set a life "course," resentments → avoidance, gossip, reputation, an infinite
fog-of-war world they chart, a town that levels on donations, a housing ladder, livestock/crops/
facilities, weather + seasons. **North star:** you watch a town of little people who each have an
inner life and remember things, and *stories emerge* (a readable chronicle turns events into a saga).

## What we shipped since the last council pass (their whole verdict, actioned)
The last council said the systems added sim *surface* without expressing the agents, and to make the
inner life LEGIBLE (B) before making trade characterful (A). We did all of B + more:
- **Legible inner life (Path B):** wounds show (HP bar + limp); an intent icon reads each farmer's
  driver at a glance (hunt / barter / help); off-screen drama surfaces as an edge cue you can press
  **W** to watch; grudges/bonds flash as emotes in the moment; hunters hold up a kill on return +
  recover with a visible perk-up; and the character card has a "NOW:" line explaining any symbol.
- **Personality-textured failure** (#86): the same event reads differently per farmer — proud hands
  overextend a hunt, the timid bail, an honest streak makes a thief confess + give it back, a volatile
  hand escalates a grudge into a public blow-up.
- **Theft has social teeth** (#87): a witnessed theft spreads to onlookers, and distrust freezes a
  thief out of trade + help — provenance is no longer inert.
- **Town identity affects behavior** (#84): the town's averaged character (close-knit / loners /
  driven / hot-tempered) nudges how much it helps, barters, clusters, and grinds — not just a label.
- **Legends & monuments** (#85): felling a raider raises a permanent stone + a chronicle epic —
  transient events become lasting town history.
- **Barter economy** (#60b, earlier): farms specialize into niches + swap surplus, value-fair, scored
  by reward × risk × personality, sealing bonds.
Everything is determinism-safe and reviewed (two Codex rounds; findings fixed).

## What's NEXT — Path A: memory-driven trade + RAG memories per farmer
This is the piece we deliberately held. The plan: **associate real SuperMemory documents with each
farmer as RAG-retrievable memories**, and let those memories actually shape behavior — starting with
TRADE (characterful bargaining) but reaching further:
- Each farmer carries a set of their source memories (retrievable by relevance).
- Trade becomes characterful AND memory-shaped: a manipulator lowballs, an honest hand trades fair,
  friends give favorable rates, a remembered bad deal is refused — and *which goods a farmer favors,
  fears, or fixates on* can be colored by their memory content.
- Longer arc: memories continuously pressure desires/affinities/routines (not just seed the stats
  once), and journal-worthy events could be interpreted through a farmer's own remembered themes.

## The core questions for the council
1. **Did the work land?** Given the identity (memory-grown living agents; emergent story is the point),
   do Path B + #86/#87/#84/#85 actually make the town feel more alive and legibly story-generating —
   or did we polish the surface while the depth (memory as an ongoing pressure) is still ahead in A?
2. **Is Path A (SuperMemory RAG per farmer) the right next bet, and how should it be scoped?** What's
   the highest-leverage, lowest-risk first slice — and what failure modes should we guard against
   (RAG making agents feel random/incoherent, latency/determinism if retrieval is live, memory content
   overwhelming personality, the "so what" problem if retrieved memories don't visibly change behavior)?
3. **Is there meaningful NON-A work we're undervaluing** before or alongside A — anything the town
   still lacks to be compelling that isn't "more memory"?
4. **What should we NOT build?** (Last council killed player verbs + decorative memory-wildlife + more
   raw economy. Does that still hold, and is there anything new to add to the do-not-build list?)
