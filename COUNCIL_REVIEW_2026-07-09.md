# Ry Farms — Council Review Target (memory system + crafting arc + civic roles)

**What Ry Farms is.** A fullscreen isometric pixel-art farm sim (pure ES modules, no build step, under
a CRT/Game-Boy-color shader). Every farmer ("Ry Bot") is grown DETERMINISTICALLY from one real
SuperMemory document: a FNV hash of the doc seeds a mulberry32 stream that rolls D&D ability scores
(4d6-drop-lowest, keyword-biased), a 6-axis personality, an archetype, a crop palette, and a multi-
paragraph backstory. Farmers till/plant/water/harvest their own fenced plots; weather, seasons, and a
day/night cycle drive everything. The whole sim is a story engine: a town chronicle turns sim events
into arcs, and the town runs itself (self-playing) while the player watches, follows, or whispers.

**Core doctrines (non-negotiable, all currently upheld):**
- **Determinism.** The sim consumes only `world.rand` + per-farmer `this.rand` (mulberry32). Same seed
  ⇒ identical town, verified by a self-comparing digest harness (boot → tick N days → hash farmer+world
  state twice). Player-driven and display-only features use DEDICATED rng streams so they never shift
  the digest.
- **Compile-don't-query.** LLMs and SuperMemory are DISPLAY/persistence channels only, never in the sim
  decision loop; every LLM path has a procedural fallback. The sim never calls SuperMemory `/search`.
- **Personality-guard hierarchy.** core personality > need > relationship > recent event > retrieved
  memory. Memory can COLOR a decision but never dominate or flip it.

This review covers three systems just shipped (13 commits, pushed):

---

## 1. The memory system (#91) — a three-tier inner life grown from the source document

**Tier 1 — CREEDS (long-term identity, "compile don't query").** At generation, `compileCreeds(doc,
seed)` distills 3–5 weighted `{theme, tags, weight, short, quote}` creeds from the farmer's source
SuperMemory doc via a deterministic keyword pass over title+summary+content (themes: craft, grit,
service, team, guard, wander, quiet, word, + a steady fallback). Cached on the sheet, rides the save.
The SIM reads only the TAGS; the QUOTE is narration. Result: the sweeper (grown from "Ryan's Soccer
Career as a Sweeper Defender") carries *"a sweeper's creed: hold the line, nothing gets past you."*

**Memory-ATTRIBUTED refusals (Path A slice 1).** When a farmer refuses the Town Manager's directive on
conviction, the reason shown + the on-map mutter QUOTES their creed — so behavior traces to the source
document. ATTRIBUTION ONLY: the decision path is byte-identical, digest unchanged (personality never
tips; the creed only names the choice). Acceptance test met: a viewer can guess a farmer's source
memory from one in-game day.

**Memory-attributed UNFAIR deals (Path A slice 2).** A crooked/sharp-trading farmer (personality is the
driver: low honesty, sharp-trader goal, competitiveness — a thrift creed only SHARPENS) may angle for a
lopsided barter (give one less than they take). The partner weighs it (honesty/pride creed/regard);
refusing collapses the deal, swallowing it plants a GRIEVANCE (opinion↓, reputation↓, remembered) and a
"hard bargain" chronicle beat. Rare/emergent (barter itself is infrequent + needs mutual surplus ≥2).

**Tier 2 — EPISODIC writeback.** `adjustOpinion` already journals every kindness/betrayal as a decaying
'person' memory; the new grievances/refusals land there too. The journal decays nightly with a forget
floor; vivid memories survive longest.

**Tier 3 — CONSOLIDATION → BELIEFS.** Each dawn, `#consolidateBeliefs` scans the journal for a recurring
THEME past a threshold; the best-supported un-held one crystallizes into a formed BELIEF — with a
one-time personality NUDGE, so a lived pattern reshapes the farmer (their label re-derives). 8 themes
(wary/kinship/solitude/seeker/grit/thrift/renown/cunning). The belief TEXT is COMPOSED (many phrasings
from a dedicated seeded stream, woven with the CAUSE — the strongest matching memory names who/what:
*"Chaos taught me what a handshake is really worth"*). Beliefs are EARNED from a life (vs creeds
INHERITED from the doc), shown as "HARD-WON BELIEFS" on the card, persist. ~18 distinct beliefs across a
town of 8. Distinct from creeds; the composing stream never touches the sim rng.

**SuperMemory WRITEBACK.** A server endpoint persists each farmer's compiled life (creeds + beliefs +
episodic) back into self-hosted SuperMemory as a TAGGED document; the READ side filters those tagged
docs out so a persisted life can never regrow a farmer (no echo loop). Pure side-channel, one-shot per
farmer (save-carried stamp), best-effort (no-ops offline), sim never reads it back.

---

## 2. The crafting arc (#97) — Healer → invention → diffusion → sabotage

**Slice 1 — Healer + consumables.** A RECIPES layer (soup/salve/tonic) gated on real inventory
(grass/flower/crops — nothing from thin air). A Town HEALER role (seeded by WIS+INT+care fitness,
excludes Manager/Watch; approval/recall) triages the sickest, brews the best remedy their herbs allow,
forages when low, and the town answers herb-calls. One tend per patient per day (no soup-spam). Illness
is CON-gated and self-resolves, so care can never soft-lock.

**Slice 2 — procedural invention (trial and error).** An idle, well-stocked, curious farmer tinkers —
and mostly FAILS: each attempt burns a little stock and nudges `inventSkill`; only a breakthrough roll
(identity-seeded, never inventory-hashed) yields a recipe. ~22% hit rate. Enumerated INVENTION_TABLE
(remedy/tool/utility ×3, harm ×3 LOCKED). Outcome class weighted by personality AND state. Duplicate →
near-miss. Discovered → chronicle beat + KNOWN RECIPES card.

**Slice 3 — diffusion.** Know-OF vs know-HOW are decoupled: gossip conveys HEARD-OF (can't craft it);
only DIRECT TEACHING (an honest, collaborative inventor showing a liked neighbour who's heard of it)
turns heard-of into KNOWN — the crooked HOARD their edge. Cooldown-paced, so a recipe takes seasons to
become common. RECIPES tab shows "(N have heard of it)."

**Slice 4 — harmful items + covert-crime detection.** Harm recipes (blight/poison/weaken) stay LOCKED
to open crafting; the ONLY way they're made is a hostile hand. A deeply crooked farmer with a real
grudge plants a harm item covertly on a victim's farm; the effect is DEFERRED (springs a day or two
later, no live witness). DETECTION is a suspicion trail: OPPORTUNITY (evidence you were there) is a
PREREQUISITE to trial, then MOTIVE (grudge) + PATTERN (repeat) + accrued suspicion decide whether it
crosses the bar → the Watch convenes a P2 justice trial (warn/fine/shun). Weak cases go unsolved and the
trail warms. Recovery reuses existing systems (replant; the Healer cures poison). Motive alone can never
convict an innocent (Codex-fixed).

---

## 3. Civic roles (#94) — active drivers, not decoration

A role kernel seats a MANAGER (posts a daily directive the town heeds/refuses by opinion×personality,
with a quorum guard so a no-quorum day never churns the office), a WATCH (witnessed theft → seeded
public trial → warn/fine/shun, with a shun that never blocks sick-care and hard-exits after a season),
and a HEALER. #96 added healer MORAL AGENCY: mercy is the default, but a hard-hearted healer with a
grudge + a judgmental creed may refuse an outcast — a public choice the town SPLITS on by their own
values, and the denied farmer RECKONS with it (a formed belief; redemption or bitterness). Roles show on
the card + a NEWS/ROLES/RECIPES chronicle tab.

---

## What's verified
Determinism self-compares clean across seeds; headless harnesses: creed 28/28, invention 34/34 (incl.
diffusion + the full sabotage loop + the innocent-conviction regression), civic 31/31. Browser-verified
end to end on real self-hosted docs. Codex reviewed the stack (1 P1, fixed).

## What we're unsure about / want the council to stress-test
- Do these systems land against the identity (living agents grown from REAL memories), or do the
  procedural creeds/beliefs read as generic despite the memory hook?
- Where is it thin, exploitable, or a determinism/economy landmine (invention, diffusion rates,
  sabotage frequency/fairness, belief pacing, the writeback loop)?
- The highest-leverage NEXT additions or fixes.

## Roadmapped, NOT yet built (context, not for review depth)
#94 P4 (elections, lorekeeper, secretary), #95 a memory-graph sitelet, #90 a standing persistent-town
playtest, #61 a sprite/asset component library.
