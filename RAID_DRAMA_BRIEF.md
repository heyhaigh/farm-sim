# Ry Farms — THE DUNGEON MASTER'S BATTLE: brief for council + fable review (2026-07-16)

## REVIEW OUTCOME (2026-07-16) — council (GPT-5.6, Gemini 3.1, Grok 4.3, DeepSeek v4) + independent Fable.
**Weighting (designer's call): GPT + Fable carry tiebreaks; others corroborate.**
**Verdicts:** Fable GO-WITH-CHANGES ("the brief's ranking is backwards — story-felt is continuity, not
choreography") · GPT not-fit-until-decided (authority boundary + latency realism must be nailed) · Gemini
narrative-side-channels-only · DeepSeek gate-L2-on-a-prototype · **UNANIMOUS: L4 is rejected outright.**

**THE AGREED PLAN (weighted synthesis):**
- **Phase 0 — PACING, not suppression (DESIGNER OVERRIDE of Fable's text cuts).** The designer rejects
  removing combat text ("it makes the battle feel more alive — it's a matter of pacing"): instead the
  battle runs on a GLOBAL INITIATIVE ORDER, D&D-style — ONE exchange resolves at a time, round-robin
  across the live duels on a ~1.1s beat, every exchange keeping its floating text. Only one text is ever
  born at a time; the fight reads as turns, not four simultaneous tickers, and the battle is naturally
  drawn out (~22 sequential exchanges). KEPT from Fable: the focus-duel concept survives as the CAMERA/
  STORY subject (nemesis machinery, the withheld flank, the one DM beat) — just not as a text gate — and
  war-cries fire at first contact then go quiet so speech and combat text don't fight.
- **Phase 1 — THE NEMESIS (L3 as deterministic data, LLM voices only).** GPT's authority catch is binding:
  who returns and whom they target are GAME-WORLD FACTS → a nemesis registry in the world-index
  side-channel, seeded from existing ledger ordinals: `{ foeName, raidCount, sworeAgainst: farmerSeed,
  lastOutcome }`. ONE nemesis at a time (Fable: "two Kruls is zero Kruls"). Telegraph names the return
  ("KRUL THE HOWLER RETURNS — the third raid of his war"); the raid-council prompt is fed the grudge; the
  named foe duels his sworn target as the focus duel. Ghost rehearsals NEVER write the registry.
- **Phase 2 — THE CHRONICLER (L1, one surface).** Post-battle tale from the exchange transcript + verdict.
  PRIMARY SURFACE = the resume/"WHILE YOU WERE AWAY" card (Gemini: a tab is functionally invisible; GPT:
  make ONE surfacing call). GPT's guards are binding: raid-ID + acceptance deadline on every generation
  (a late answer attaches to nothing), serialize LLM requests (council + chronicler share one Ollama),
  authored fallback template with the SAME structure so degradation is parity not absence. Dormant raids:
  hash choreography instantly, tale-only enrichment after.
- **Phase 3 — ONE BEAT (Fable's starved L2, prototype-gated).** A single DM-chosen stunt + bark for the
  NEMESIS duel only (shove-into-fence / the withheld flank "NO. he's mine."), semantically validated
  against the scripted ending. DeepSeek's gate applies if this ever grows: <80% schema validity or >30s
  median on the 3B model → cancel choreography forever.
- **L4 — never.** Unenforceable against the resolver; invisible at 16×20px.

**THE SCENE TEST (acceptance):** the vertical is done when the booth can rehearse Fable's "third raid of
Krul's war" scene end-to-end: named telegraph → history-aware council lines → three quiet duels + one
carrying the text → the shove → the withheld gang-up → the seeded verdict landing EITHER way ("Krul's war
ends at Cricket's feet" / "he will come again") → next session's tale on the resume card.

**KILL-CRITERIA (both binding):** (1) any generated bark/stunt/tale detail that contradicts the seeded
outcome = the seam leaked — ship the fallback (GPT/Gemini). (2) if a playtester can't name the returning
foe and who he was after, unprompted, after his second raid — the feature failed; cut the DM from battle
and keep authored telegraphs (Fable).

**Also adopted (GPT hygiene):** write the display-determinism boundary down explicitly (the byte-identical
contract covers SIM state; display/audio/LLM text are excluded and tested separately — this is existing
practice, now doctrine); sanitize/provenance-tag any generated text that persists; measurement plan =
Fable's recall test + tale-open rate.
---


**The ask (from the player/designer):** raids now have turn-based duels, but they should become the game's
signature set-piece — and "this might be where the DM agent needs to come in and help us build this
interaction out so it doesn't feel one-note." Review what exists, then tell us where the maximum impact per
effort lies in involving an LLM Dungeon Master in battles. Return a phased build order with hard-decision
calls, not a survey.

## The game in one paragraph
Ry Farms is a fullscreen isometric pixel farm sim under a CRT shader. Every farmer is grown deterministically
from a real memory document, with D&D stats, personalities, dreams, grudges, elections, and a chronicle.
Towns live on a shared world map; orc warbands raid human towns (and vice versa) through a seeded world layer.
The two sacred doctrines: (1) **DETERMINISM** — the sim draws only from seeded rng + pure position hashes;
same seed ⇒ byte-identical, twice; `tests/determinism.mjs` pins baselines. (2) **COMPILE-DON'T-QUERY** — the
LLM (local Ollama llama3.2:3b via api/_llm.js) and SuperMemory are display/persistence side-channels; the sim
NEVER awaits or reads them. Any LLM failure must degrade to authored offline pools, invisibly.

## What EXISTS today (the raid vertical, as of commit e1dda59)
- **The telegraph** (~45 sim-s): "a warband is massing to the north" marquee + minimap marker; a red danger
  SEAM bleeds into the ground from the threat bearing with cosmetic orc muster figures assembling on it; a
  farmer working near the gathering point SIGHTS it and raises the alarm early.
- **The alarm interrupts**: every hale farmer drops their task and forms a line at the frontier (16–22 tiles
  out, facing the threat) within seconds; the sentry stands down from the beat and joins. The line talks —
  an LLM "raid council" writes bespoke urgent strategy/nerve dialogue per telegraph (speech-floor paced,
  authored MUSTER_TALK pools as fallback).
- **Two-movement war score**: "The Gathering Dark" (low-drone buildup + lone frame-drum) from the moment the
  warband gathers; hard-cut to "Iron at the Gate" (132bpm, kick every beat) when the raid lands. Audibility
  floor so it lands even with the music slider low.
- **The landing**: UNDER RAID slam (3.2s covered hold, war-horn ×3) fires on first blade-contact with the line.
- **Turn-based duels (v2)**: each raider is PAIRED with a defender; exchanges on a 1.15s beat over a five-way
  outcome table (MISS / PARRY! / DODGE! / HIT! / STAGGERED!-forfeits-next-turn), with footwork — knockback,
  press, recoil, sidestep — so duels drift and circle. 5–7 rounds each. Floating combat text + per-outcome
  clash SFX + lunge animations. Every duel's ENDING is scripted to the seeded resolver verdict (#resolveRaid
  decided who falls / what's lost BEFORE the show): the doomed take the finishing blow at the line (FELLED!),
  survivors BREAK OFF — and are then PURSUED (harried with swings at their back to the silo and out, seen off
  at the wilds), while defenders freed by a kill flank the nearest live duel (the gang-up).
- **Honest chronicle**: raids write grand beats incl. a frozen-roll counterfactual of the guard's marginal
  effect; the town LEARNS after repeated raids (defense doctrine or truce-seeking); reconciliation ledger +
  parley exist at the world layer.
- **The Admin booth**: ghost rehearsals (full raid cycle, zero record) for videos/stress-tests — the review
  harness for all of this.
- **Existing LLM side-channels** (all fire-and-forget, schema-validated, fallback-pooled): day-1 founding
  congregation script, the raid council above, conscience whispers, inventions, story enrichment.

## The CONCEPT under review: where should the DM (LLM) enter the battle?
A key reframe discovered while building: the determinism kill-criterion binds only the AUTHORITATIVE outcome
(who falls, stores lost, wounds — all seeded in #resolveRaid). The CHOREOGRAPHY between those fixed endpoints
is display-layer — currently pure-hash rolls — and could legitimately be LLM-authored without touching the
sim, exactly like the raid-council dialogue. Latency is the real constraint: the ~45s telegraph window is the
natural generation budget (the raid council already generates inside it).

Candidate levels of DM involvement (not mutually exclusive — rank them):
- **L1 — The Chronicler (post-battle narration).** After a real raid, the DM writes the battle report as a
  TALE from the exchange transcript + cast + outcome ("Krul pressed Lyric to the fence-line before the hoe
  found his knee...") into the Chronicle's TALES tab (a side-channel, not the deterministic chronicle).
  Cheap, safe, additive. Risk: nobody reads tales; impact depends on surfacing.
- **L2 — The Fight Director (pre-scripted choreography).** During the telegraph, the DM writes each duel's
  BEAT SHEET within guardrails: an exchange list per pairing chosen from a stunt vocabulary the engine can
  stage (shove into the fence, disarm-and-recover, a taunt mid-duel, a rescue when a neighbour's flank
  arrives, terrain use), threaded with one-line barks tied to the combatants' actual personalities/grudges.
  The engine still forces the scripted ENDING (seeded verdict); the LLM only owns the middle. Fallback = the
  current hash table. Risk: 3B-model script quality; stunt vocabulary is real engine work; more fx noise.
- **L3 — The Campaign DM (continuity across raids).** Named foes persist and RETURN (Krul, scarred from last
  time, goes for the farmer who felled him); the DM maintains grudge/callback state in the persistence
  side-channel and threads it into telegraphs, barks, and tales ("the third raid of Krul's war"). This is
  what makes battles STORY — arcs, not episodes. Risk: state plumbing; the world layer already has ledgers/
  ordinals that could carry it.
- **L4 — The Tactician (DM picks the battle SHAPE).** From the situation (defenders, doctrine, weather,
  night/day, terrain), the DM selects a battle TEMPLATE (pincer from two bearings, a feint at the silo while
  two slip to the coop, a champion's challenge — one duel while both sides watch, a fighting retreat) that
  the engine stages deterministically. Highest spectacle ceiling; highest engine cost; the resolver's
  outcome must still bind (a "feint" that steals from an untouched granary contradicts the seeded bite).

## Hard questions (answer these, ranked)
1. Which level(s) deliver the most FELT impact for the build cost, in what order? What's the 80/20?
2. What makes a battle MEMORABLE vs merely busy? The current fx (floating text every 1.15s × 4 duels) may
   already be near the noise ceiling — what should be REMOVED or focused when the DM enters?
3. L2/L4 specifics: what's the minimal stunt vocabulary (≤8 verbs) that reads on 16×20px sprites? Which
   stunts are wasted at this resolution?
4. L3 specifics: what continuity state is worth persisting (named-foe registry? per-farmer nemesis links?)
   and where does it live so determinism is untouched (world-index side-channel vs SuperMemory)?
5. The 3B-model problem: llama3.2:3b writes the scripts. What schema/vocabulary constraints make a small
   model reliable here (the congregation/council pattern works — does a beat sheet)? When it fails, is the
   hash fallback INVISIBLE or does the seam show?
6. Latency: telegraph is ~45s; a real raid can also land UNTELEGRAPHED on load (dormant consume). What's the
   graceful story for battles the DM never saw coming?
7. Surfacing: tales/reports need readers. Where do they land so the player actually meets them (TALES tab,
   the resume card, the moment spotlight, SuperMemory writeback for the portal)?
8. What's the kill-criterion for this vertical (the streaming review's was "any det re-pin in a render phase
   = the seam leaked")? Propose one.

## Non-negotiables
- Determinism: no LLM output may influence who falls, what's lost, or any serialized state. Ever.
- Offline-first: every DM feature must have an authored fallback that ships the same scene at lower fidelity.
- Bitmap font/ASCII display; lines ≤ ~110 chars; no stage directions the engine can't stage.
- The admin booth must be able to rehearse whatever is built (ghost = zero record).
- One vertical at a time: this review is about BATTLE drama; the multi-town streaming plan (P2.5 war party,
  P3 migration) continues separately — but note where they intersect (a war party's away-battle is a natural
  L1 tale; a returning named foe is L3 across towns).
