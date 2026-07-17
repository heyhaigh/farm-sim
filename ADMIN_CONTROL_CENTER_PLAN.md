# Admin Control Center — director's booth for triggering experiences (spec v1, 2026-07-16)

**What (user):** an Admin panel inside the SETTINGS modal — a selected state with toggles/activators — for triggering
particular experiences on demand, in ANY town (human or orc), for making videos and stress-testing. First two:

1. **TRIGGER RAID** — the full cycle: telegraph → seam → muster → approach → strike → clash → resolution VISUALS.
2. **TRIGGER ELECTION** — the full voting phase + all its visuals (nominations → campaign → tally beats), WITHOUT
   changing the day (no jump to the winter vote date).

**The prime rule — REHEARSALS ARE GHOSTS.** An admin-triggered experience:
- is NEVER written to the town log / chronicle / records,
- is NEVER persisted to SuperMemory (no writeback of any kind),
- NEVER changes standing state: no role handoffs, no roles.history entries, no stores docked, no wounds/downs that
  persist, no monuments, no grievance/ledger movement, no learning arc, no opinion/impression/voteLog mutations.
- It DOES override what the town is doing in the moment (farmers muster, flee, gather to vote — that's the show).
  That's the accepted sacrifice. When the rehearsal ends, the town returns to its business as if nothing happened.
- **The two supersede one another** — activating one cancels the other (and re-triggering restarts cleanly).

## Doctrine hazards to design around (the actual engineering)
- **H1 — the rng stream.** A rehearsal must NEVER call `world.rand()` (or any seeded stream the real sim draws
  from). One admin raid that advances the shared stream = the town's entire future diverges from what it would have
  been = a silent determinism break that no harness catches (the harness never runs the admin path). Rehearsal
  randomness comes from its OWN ad-hoc stream (hash of `'admin:' + wall-clock nonce`) — it's allowed to be
  non-deterministic; it's a screening, not the sim.
- **H2 — the write chokepoints.** The clean way to enforce ghost-ness is a single `world.rehearsal` flag checked at
  the few chokepoints where drama becomes record: `addChronicle`, `addLog` (or let log lines through with a
  `[REHEARSAL]` tint — decide), the SuperMemory writeback client (`persistTownHistory` etc.), `#applyRaidOutcome`,
  the election's apply/handoff step, `remember()`/`adjustOpinion` calls made INSIDE rehearsal-driven branches.
  Prefer gating at these sinks over threading a param through every call.
- **H3 — the save file.** A save taken MID-rehearsal must not serialize ghost state (pendingRaid/raidEvent/election
  phase objects marked rehearsal, farmers in 'muster'/'confer' states caused by it). Either strip rehearsal-marked
  state in `toSave`, or block/queue autosave while a rehearsal is active (simpler, probably fine).
- **H4 — restoration.** When the rehearsal ends (completes or is superseded), every farmer it hijacked returns to
  `#decide` naturally (their states already exit on raid-clear / vote-end paths — verify no stuck 'muster'/'flee'/
  'vote' states when the trigger was synthetic). Energy/positions changed during the show are acceptable drift
  (the user accepts "override in the moment"); recorded facts are not.
- **H5 — health.** A rehearsal raid should not DOWN a farmer for 3 real days (that's standing state). Options:
  clash visuals with foes felled but farmers taking no lasting wounds (plot armor), or restore downFrom/health at
  rehearsal end. Plot armor is simpler and reads fine for a screening.

## Shape of the build
- **UI:** settings modal → new ADMIN section (maybe gated behind a `?admin=1` param or a triple-click on the title —
  decide; default visible is fine for a personal build). Two rows: RAID and ELECTION, each with an activate button;
  active row shows a LIVE/REHEARSAL badge + a cancel. Activating one cancels the other (supersede rule).
- **Raid trigger:** synthesize a `pendingRaid` (marked `rehearsal: true`) via the existing telegraph path with a
  plausible neighbor name (real neighbor if one exists, else a stock warband), seeded bearing from the admin stream.
  It flows through detect → alarm → seam → muster → approach → strike → clash exactly as #131/#108 built, but
  resolution routes to a rehearsal-safe outcome (visuals + toast, no `#applyRaidOutcome` writes, no chronicle).
- **Election trigger:** invoke the election sequence's PHASES (nomination beats, campaign bubbles, tally gathering,
  the announcement moment) driven off current sentiment for flavor, but the tally result is DISPLAY-ONLY — no role
  change, no history push, no civic mutations, no persistence. Day/date untouched.
- **QA hooks:** `RYFARMS.admin.raid()` / `.election()` / `.cancel()` console equivalents (the panel calls these).

## Status — ✅ BUILT 2026-07-16 (commits f67b268 admin center + b94e83d raid score, LOCAL)
- Settings → ADMIN section (STAGE A RAID / STAGE THE VOTE, live-state = amber CANCEL row; gold dot on the gear
  while live) + `RYFARMS.admin.{raid,election,cancel,active}`.
- Raid = rehearsal-flagged `pendingRaid` through the REAL #131/#108 machinery; `#landRaid` forks to
  `#landRehearsalRaid` (same pure scorer + cinematic, applied nowhere). Vote = `foundingGathering()` borrow +
  `#tickRehearsal` stage director (gather/speeches w/ STUMP_LINES/tally/announce) + `#ghostOffice` (winter-vote
  ballot math minus every write) + a synthesized 'THE TOWN DECIDES' spotlight (never chronicled).
- Ghost contract browser-verified 3x (monuments/downs/roles/raidsSuffered/learned/voteLogs identical, zero
  records); serialize strips ghost pendingRaid; real raid supersedes; cancel clean, no stuck states.
- Deviations from spec v1: saves are NOT blocked mid-rehearsal — serialize-stripping covers H3 with fewer moving
  parts; H5 resolved as plot armor (no wounds at all). H1 nonce = wall-clock passed from main.js (farm.js stays
  Date/Math.random-free for the encounters.mjs purity grep).
- BONUS (same session, user report from watching the rehearsal): #raid-score — war music (ORC 'Muster' for human
  towns / 'Gorging' for orc towns) takes over from alarm to last-raider-gone, overriding the night hush.
- P2.5 outbound expeditions can reuse all of this (a third row in the panel triggers an OUTBOUND war party).
