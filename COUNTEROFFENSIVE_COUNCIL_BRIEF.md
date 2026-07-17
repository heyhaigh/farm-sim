# Ry Farms — THE COUNTER-OFFENSIVE: a town that strikes back (council pressure-test)

**What this is for:** a `/council` pass (+ an independent Fable sub-agent) on the design of the
**counter-offensive** — the moment a town that's been raided one too many times resolves to take the fight
to its aggressor. It's the most compelling *trigger* for the already-designed P2.5 **outbound war-party**
(see MULTITOWN_STREAMING_BRIEF.md). Return: a ranked answer to the hard questions below, a phased build
order, and the hard-decision calls. **Author's stance:** committed to building this; solve *how*, don't
re-litigate *whether*. Weight GPT's engineering calls and Fable's story calls highest.

## The game in three lines
A CRT-shaded isometric pixel farm-sim where every farmer is grown deterministically from a real SuperMemory
document (D&D stats, personalities, elections, grudges). Orc warbands raid across a world map of towns;
raids already resolve in BOTH directions at the world layer, but only the INBOUND half is *witnessed*
(telegraph → red fog-boundary seam → muster → defense → duels → aftermath debrief → the war is chronicled
and written back to SuperMemory). When your town is the AGGRESSOR, nothing shows. Two sacred doctrines:
(1) DETERMINISM — the sim draws only from a seeded rng; render-only phases must NOT re-pin baselines
(kill criterion); (2) COMPILE-DON'T-QUERY — the local LLM + SuperMemory are display/persistence
side-channels the sim never awaits.

## What already exists (reuse verbatim)
- **The nemesis war** (`world.nemesis`): a named foe (e.g. "Gruk One-Tusk") accumulates across raids; the
  arc is deterministic data; the marquee/chronicle/debrief voice it. Ends honestly (band broken =
  "the war ends at Cricket's feet"; reconciliation = the parley table).
- **The learning arc** (grievance ledger + `world.learned`): repeated raids that get away deepen the town's
  grievance; the town reaches for a learned response — **stronger defense** (more watch, walls) OR a
  **negotiated truce**. A doctrine system already shifts palisade/comitatus/greatMuster posture.
- **The witnessed-raid stagecraft**: fog-boundary seam wedge in a bearing, muster figures at the frontier,
  the "X CLOSES FROM THE {DIR}" marquee, the initiative duels on the music grid, the aftermath debrief
  (now role- + lore-aware), the admin ghost booth, battle docs persisted to SuperMemory.
- **The P2.5 war-party arc (designed, not built)**: on an OUTBOUND raid, 3-4 seeded hale farmers get a
  `sortie` state → muster at the frontier in the target's bearing → march out past the fog edge (hidden
  while "gone") → marquee "A WAR PARTY RIDES ON {TARGET}" → return at a monotonic `returnAt` deadline →
  spoils + chronicle land at the silo. Rides the save like the inbound telegraph; resolves identically
  watched or dormant. Booth row: STAGE A WAR PARTY. Render/telegraph layer first (zero re-pin).

## The counter-offensive, as I imagine it
A town raided repeatedly by the same nemesis — grievance past a threshold, having chosen the DEFENSE branch
of the learning arc rather than truce — resolves to **strike back**. It musters a war party and rides on the
aggressor's town. If they win, they take back stores (or spoils) and the chronicle records the town turning
from prey to aggressor; the nemesis war may shift or end at the enemy's gate. If they lose, they come home
bloodied and the war deepens. It's the emotional turn of the whole raid loop: *now we take matters into our
own hands.*

## The hard questions (answer ranked, be concrete)
1. **The trigger.** What fires a counter-offensive, and who decides? Candidates: (a) grievance ledger past a
   threshold + DEFENSE doctrine, fully emergent/deterministic; (b) an explicit **town vote** ("do we ride
   on Gruk's people?") using the existing election/civic machinery; (c) a Manager directive the town heeds
   or refuses. Which best serves both determinism AND the felt story? Is a vote worth the complexity, or
   does emergent-from-grievance read as more organic?
2. **Coupling to the nemesis war.** Should a counter-offensive's OUTCOME advance/alter/END the nemesis arc
   (win at the gate = the war ends there; loss = raidCount deepens), or stay a parallel event? If it can end
   the war, that's a powerful payoff — but it makes an outbound act authoritative over the shared arc, which
   must resolve identically watched-vs-dormant. Worth it, or keep the arc driven only by inbound raids?
3. **Stakes on the party.** Do sortie losses **down** farmers (the existing 3-day downed state, real cost)
   or only wound them (chronicle color, no downing — the P2.5 v1 stance)? Downing raises the stakes and the
   drama but can gut a small town; wounding is safer. Where's the line for v1?
4. **Does it change the town?** After a successful counter-offensive, does the town's DOCTRINE/government
   shift (emboldened → more aggressive posture, elects war-minded leaders), or does it revert to farming?
   The learning arc already shifts posture defensively; should victory shift it *offensively*, creating a
   town that becomes a raider itself? (This is a strong long-arc, but a big behavioral surface.)
5. **The world-layer honesty.** The counter-offensive resolves a raid the OTHER town will witness inbound
   (P3 "follow the raid home"). Does v1 need the target town to actually receive the raid (real cross-town
   inbox), or can v1 be render-only on the aggressor side (spoils faked deterministically) with the true
   cross-town hand-off gated to P3? The kill criterion says: ship render-first with zero re-pin.
6. **Determinism.** Everything above must not re-pin baselines in a render-only phase. Where does the
   sim-side line fall — is the `sortie` muster behavior a seeded #131-style edge (safe), and is the spoils
   apply a deadline-authoritative act that's byte-identical watched-or-dormant? Name any place the seam
   could LEAK into the sim.
7. **Demo/impact.** For the SuperMemory thesis (memory → farmers → named wars → written back), does the
   counter-offensive deepen the loop meaningfully (the town's turn from victim to actor, chronicled and
   persisted), or is it spectacle that doesn't touch memory? What's the ONE beat that makes it land?

## RESOLVED CALLS (post-council + Fable, user-approved 2026-07-17)
Council (GPT-5.6-sol, Kimi-K3, DeepSeek, Gemini, Grok) + Fable synthesized; user ratified:
1. **Trigger** — grievance threshold = deterministic ELIGIBILITY (accrual/decay/**consume+cooldown**, one-shot);
   a **FAILABLE, seeded, LLM-free VOTE** = authorization (Fable+Kimi's human beat, per user); the **sworn-against
   hero calls it**. The vote authorizes an already-eligible proposal — it is NOT the trigger itself.
2. **Spoils** — **RECLAIMED from recorded `harvestLost`** (the grievance ledger), capped. NEVER fabricated
   (Kimi's doctrine violation: faked spoils chronicled to SuperMemory = the system's first dishonest memory).
3. **Nemesis** — **DEEPEN in v1** (Fable's better common case: victory with the foe ESCAPED = escalation you
   chose). The rare, somber **gate-ending waits for P3's real cross-town hand-off** (per user).
4. **Stakes** — ≤1 downed behind a minimum-viable-workforce FLOOR; **the hero is NOT exempt** (per user);
   cost legible in crops. **Kimi's gem (per user): an inbound raid landing while the party is AWAY leaves the
   town undefended** — the real stakes mechanic.
5. **Town change** — resilience default + a doctrine SCAR + **the vote remembered** (can cost an election);
   the victim-becomes-raider arc only as a RARE EMERGENT tip, never scripted.
6. **Determinism** — the telegraph/render phase is render-only (zero re-pin); the **sim-side sortie is a
   DELIBERATE re-pin** (like #131) + a **watched-vs-dormant determinism TEST GATE**, not just doctrine.
7. **The beat** — the **reversed telegraph** ("FOR THE FIRST TIME, IT IS {TOWN} THAT CLOSES FROM THE {DIR}")
   + the **grievance ledger read aloud as the declaration** (memory made CAUSAL, not write-only).

**BUILD ORDER (approved):** **Phase 0 (build now)** — the booth-staged war-party STAGECRAFT alone
(muster → march out through the fog → reversed-telegraph marquee → return → debrief), render-only, zero
consequence-web — delivers most demo value at near-zero risk (Kimi+GPT's foreclosed finding, per user).
**Phase 1** — deterministic trigger + failable vote. **Phase 2** — sim-side sortie (accept re-pin + test
gate, reclaimed spoils, away-party stakes). **Phase 3 (deferred)** — real cross-town hand-off + gate-ending.

## Deliverable
Ranked findings on the 7 questions, a phased build order (render-first → sim-side → cross-town), and the
hard-decision calls (trigger mechanism, nemesis coupling, downing-vs-wounding, town-change yes/no). A clean
"build it as v1 render-first, defer X to P3" is a valid, welcome answer — say so plainly.
