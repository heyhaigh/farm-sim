# Codex Review #36 — Ry Farms: the DM's-battle vertical + admin booth + P2 crossing (PRE-PUSH GATE)

**Repo:** `/Users/ryanhaigh/ry-farms` — point Codex HERE, at the FULL absolute path. (Codex has repeatedly defaulted
to a stale `/Users/ryanhaigh/Documents/ry-farm` — that is the WRONG repo. The right one's HEAD is `86a33b2` on
`main`, remote `github.com/heyhaigh/farm-sim`.)

**Scope:** `git diff 064977c..HEAD` — **13 commits**, ~1200 insertions across farm.js / main.js / audio.js /
raidcouncil.js / memory-writeback.js / api/(memory-writeback, ry-farms-raid-council) / server.mjs / tests:
`f67b268` Admin Control Center (ghost rehearsals: raid + vote) · `b94e83d`+`9e79d8d` two-movement raid score,
clash-at-the-line, militia talk, longer UNDER RAID · `c2d8526` turn-based duels v1 + alarm interrupt + sentry
joins + LLM raid council · `2147bc0` P2 cursor-crossing (in-place World swap) · `e1dda59` duels v2 (footwork /
stagger / pursuit / gang-up) · `f943ab8` global battle INITIATIVE (one exchange at a time) + review outcome ·
`9f5c92f`+`41412b9` THE NEMESIS (deterministic named-war arc) + ghost probe · `ea289a4` Book of Wars + battle
docs → SuperMemory · `8a94a14`+`2577622` QA raid-hook fixes (stable pairKey; watermark ordinals + unique ids) ·
`86a33b2` raid feel v3 (screen compass, townRadius standoff, seam double-fade, message gating, 4-direction orc
rows, staggered stand-down + music ladder, LLM debrief).

**Intent: push to the live repo after this review — and the SuperMemory HACKATHON DEADLINE is ~12h away**, so
rank ruthlessly: P0 = blocks push / breaks determinism or the ghost contract; P1 = fix before push; P2 = note.
**Static-analysis weighting note:** P2 crossing, duels v2, initiative, and the v3 batch have NOT been
browser-verified end-to-end (the player held the only live tab) — weight code-path reasoning accordingly and
say explicitly which findings a 5-minute browser check would settle.

## The two sacred doctrines (unchanged)
1. **DETERMINISM.** Seeded rng + pure hashes only; same seed ⇒ byte-identical, twice. Baselines
   **`b9fdb11b / 49314834 / 246728a5 / 640f109e`** (seeds 20260706/42/7/3) — the ENTIRE batch shipped with NO
   re-pin. Confirm genuinely unchanged + same-twice holds.
2. **COMPILE-DON'T-QUERY.** LLM/SuperMemory are display/persistence side-channels; the sim never awaits/reads
   them. New surfaces this batch: raid council + debrief scripts (world._raidScript, bubbles only), battle
   docs (persistBattle), Book of Wars (townHistory payload).

## Priority checks (ranked)
- **A. THE GHOST CONTRACT (admin booth).** `world.rehearsal` / rehearsal-flagged pendingRaid/raidEvent must
  write NOTHING: no chronicle/log, no stores/wounds/monuments, no nemesis advancement (probe exists), no
  SuperMemory (persistBattle guarded by `!re.rehearsal`; requestRaidDebrief runs for ghosts — bubbles only —
  confirm the debrief path can't write). serialize() strips rehearsal pendingRaid. Hunt for ANY leak,
  including `_debrief`/`_raidScript`/`_standAt`/fx/`_battleWatch` lifecycles across cancel/supersede edges.
- **B. THE NEMESIS ARC (farm.js).** Deterministic advancement sites only (applyInbox raided/reconciled,
  #applyRaidOutcome, #archiveNemesis). Edges: arc ends then a SAME-pair raid arrives (new arc founds for the
  same pairKey — intended? check for weirdness); `e.foe` stamped at raidCount>=2 but sworeAgainst set on raid
  1 (chronicle names him on raid 1's "swore against" line — acceptable?); nemesisLog cap; save round-trip of
  in-flight arcs; the rehearsal read-only `raidCount + 1` display preview.
- **C. THE INITIATIVE + DUEL STATE MACHINE (#tickRaidEvent).** One exchange per 1.1s beat round-robin;
  duels close via scripted endings; `settled` condition (every raider fell OR done+looted) vs the 34s timer
  backstop; pursuit (pursuedBy) and gang-up (_freed/_flankAt) lifecycles; the STAND-DOWN stagger (_standAt)
  + debrief window (_debrief.until, extended by a late LLM script) — can a farmer be stuck in 'muster'
  forever (e.g. debrief until keeps racing forward, or _standAt set while a NEW telegraph arrives)? Can the
  initiative stall with all pairs >1.7 apart (nobody ever closes)?
- **D. P2 CURSOR-CROSSING (main.js switchTown).** The module-lens reset list — find ANY per-town state NOT
  reset (grep module `let`s against the reset block; chronReadTotal/lastChronLen/recapSeq/moment queues/
  minimap+chunk caches/whisper/raidFx/dramaSpotlight/crossHint are covered — what's missed? worldMapNodes?
  boardScroll? sheetScroll? congregation/council dedup keys?). The async swap during crossFx: double-cross
  re-entry (_switching + crossFx guards), a raid arriving mid-swap, autosave firing mid-swap, saveOnHide
  during _switching. URL replaceState vs the boot's ?fresh handling.
- **E. SUPERMEMORY WRITE PATHS.** persistBattle one-shot dedup (battlesSent unbounded per session — fine?);
  the battle branch's customId sanitization; Book of Wars in historySignature (arc changes re-fire the
  townHistory upsert — rev staleness interplay with the server's monotonic-rev guard); wars payload nameOf
  lookups on dead/absent farmers.
- **F. THE v3 BATCH.** screenCompass math (project a few known angles: does grid-east now label south-east?
  spot-check against COMPASS order); townRadius cache (this._townRad on time — dormant fast-forward OK?);
  the seam's unclamped tile loop cost + isRevealed guarded off-grid; the 4-direction row pick (mvI/mvJ
  stamped at all 5 raider sites + wilderness foes + muster figures — any drawThreat caller left without mv,
  e.g. FELLED corpses keep last row?); the audio exit ladder (this._raidStepAt vs ctx null before ensure());
  message gating (raid-hot freeze can't starve moments forever — they resume at raid end?).
- **G. HARNESSES.** Run everything: determinism, raid-adversarial (nemesis + ghost probes), encounters,
  worldindex-bounds, writeback-guards, ablation, llm-chokepoint + all syntax checks + `git diff --check`.

Report findings ranked with file:line + concrete repro + fix. A clean pass is a valid outcome — say so plainly.
