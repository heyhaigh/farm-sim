# Codex Review #37 — Ry Farms: the final-hours polish wave (PRE-PUSH GATE, hackathon deadline ~10h)

**Repo:** `/Users/ryanhaigh/ry-farms` — the FULL absolute path (NOT `~/Documents/ry-farm`, which is a stale
unrelated repo Codex has wandered into before). HEAD `d1a7668` on `main`, remote `github.com/heyhaigh/farm-sim`.

**Scope:** `git diff 064977c..HEAD` — **18 commits total**, of which #36 already reviewed the first 13
(`f67b268..86a33b2` — booth, raid score/feel v1-3, duels+initiative, nemesis, Book of Wars, P2 crossing, QA
hooks). **Focus on the FIVE new commits** + verify the #36 fixes landed correctly:
`52080e4` final-hours batch 1 (Inscription write-receipt card + aftermath sequencing; kick-grid accelerando +
fermata + focus-duel +2 rounds; 3-stage crossing consent via revealRadius; WAR SO FAR card; RYFARMS.demoRaid) ·
`0b6fa2c` the #36 fixes (atomic crossing sim-freeze, whisper town capture, wall-clock audio ladder,
falls-priority pairing + scripted overrun, name-debut discipline) · `fefd72f` portal wars (list-api battle
discovery + whole-doc fetch; red WAR hubs + battle satellites + fought-threads in memory-graph.html) ·
`cc34130` playtest-3 polish (card iconography foe:orc:<n>/town; single narrator channel — toasts hold under
cards + counterfactual now chronicle-only; camera rides the focus duel; W answers the telegraph + [W] marquee
hint; musterSpot capped ~26) · `d1a7668` synth-card icons.

**Intent: push all 18 to the live repo right after this review.** Rank ruthlessly: P0 = determinism/ghost
break or a push-blocker; P1 = fix before push; P2 = note. The player HAS now browser-verified the raid cycle,
the Inscription card, and the portal war sheet live; the newest polish (camera-ride, W-jump, card art, single
narrator, muster cap) has NOT had a live pass yet — say which findings a 5-minute browser check settles.

## Doctrines (unchanged): determinism baselines `b9fdb11b / 49314834 / 246728a5 / 640f109e` shipped UNCHANGED
across all 18 commits — confirm; compile-don't-query for all LLM/SuperMemory surfaces; the admin booth's
ghost contract (zero record incl. SuperMemory + the new Inscription card).

## Priority checks
- **A. #36 FIX VERIFICATION.** (1) `_switching` sim-freeze: frame loop skips accumulation while switching —
  confirm `_switching` can never be left true (every switchTown exit path hits the finally), and that a
  crossing during an ACTIVE raid/rehearsal behaves (cancelRehearsal is called; a real pendingRaid on the
  OUTGOING town rides its save — confirm no double-land on return). (2) whisper `const w = world` capture —
  confirm the callback can't resurrect a wiped town (wipeTown then whisper-completion: saveTown(w) recreates
  the deleted save?). (3) audio ladder wall-clock — confirm no NaN/regression when update() runs pre-ensure.
  (4) falls-priority + scripted overrun — an unpaired faller now fells at transition; confirm the fx-then-
  filter same-frame removal reads acceptably (the FELLED! text floats after the body vanishes — pre-existing
  behavior for duel-felled too, but confirm no crash when re.fx is missing (duelsAssigned inits it — is
  there ANY path to the transition without duelsAssigned running?). (5) name-debut: raid-1 oath says "their
  warleader" — confirm nem.raidCount is 1 at that point on the first raid (order of increments).
- **B. THE INSCRIPTION LIFECYCLE.** pendingInscription: set on persistBattle RESOLVE (async, possibly
  seconds later), consumed only when momentQueue AND calloutQueue are empty and no activeMoment — confirm it
  cannot be starved indefinitely (continuous organic beats?) and cannot fire for a GHOST raid (set only in
  the !rehearsal branch — verify). Cleared on switchTown. The moments freeze now extends through
  `world._debrief` (until - 6) — `_debrief` is never nulled, only time-expired: confirm nothing else reads
  it and a save/load mid-debrief is clean (it's transient, not serialized — confirm). Confirm the
  freeze can't deadlock with the debrief `until` extension when the LLM script lands late.
- **C. INITIATIVE TEMPO.** Kick-grid beats (60/132 × {3,2,1.5}) + the four-kick fermata: the fermata does
  `re.turnIdx--` then replays — confirm no infinite fermata (the _fermata flag is per-duel), no negative
  index math, and the `!acted || this.time >= re.turnAt` beat-reset can't double-schedule. Focus-duel +2
  rounds: applied once at assignment — confirm rehearsals get it too and the 34s timer still bounds the
  longest possible battle (6+2 rounds × max beat + fermata + pursuit).
- **D. CROSSING CONSENT.** revealRadius(): O(GRID²) scan cached per exploredTiles — during active scouting
  exploredTiles changes often; is the scan per-CHANGE cost acceptable in-frame (12k hypots) or should it be
  throttled? Stage thresholds (hint R-4 / warn R+26 / cross R+46, mins 42/66/88): confirm stage-1 can't
  fire while the camera is still over revealed ground in a LARGE explored world, and the crossing still
  works at all when revealRadius approaches the neighbor distance. `pendingRaid._warCard` display scratch
  now rides the serialized pendingRaid spread — benign or strip it?
- **E. SINGLE NARRATOR + CAMERA.** drawCallouts holds while activeMoment (freeze via shownAt) — confirm no
  starvation loop (cards → callouts → Inscription ordering terminates) and CALLOUT_CLOSE stale-hitbox stays
  cleared. Camera-rides-focus mutates raidFocus every frame while struck — confirm the pan-break
  (raidFocus=null) wins over the ride (it checks truthiness), W re-snap works during 'flee', and the ride
  doesn't fight the pre-struck 62%-toward-raiders easing.
- **F. PORTAL.** List-api discovery (2 pages × 100) + whole-doc GET fan-out (≤24): bounded, best-effort,
  no unhandled rejection paths; the html war build (byName regex per battle × farmer — cost fine?); the
  war sheet renders battle docs with `\n` splits — confirm wrap() handles the numbered round lines.
- **G. HARNESSES.** Run the full battery + syntax + `git diff --check`.

Report ranked findings with file:line + repro + fix. A clean pass is a valid outcome — say so plainly.
