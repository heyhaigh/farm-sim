# Town Roles — v2 build plan (task #94), post-council

Council round (2026-07-09, `.council-review.md`, 4 models) was unanimous: the *ambition* (an
active-driver civic layer) is sound, but v1 was "attractive civic nouns" with no arbitration,
autonomy-protection, legibility, or failure-state specs — four authorities + the player whisper
would collapse "influence not command" into a soft-command marionette theatre. Every reviewer's
fix converged: **build the autonomy-protection kernel first, prove it with ONE role, then layer
the rest onto the proven substrate.** Two decisions taken after the review:

- **Scope:** P1 = the shared **autonomy kernel** + the **Manager** only. Watch, Lorekeeper,
  Secretary follow in later phases onto the proven kernel. All four remain the goal.
- **Player reach:** the **civic layer is player-proof.** The #93 conscience whisper can still
  nudge a farmer's OWN action, but it can NEVER touch a nomination, vote, or justice verdict.
  Civic decisions run on the seeded sim rng, fully isolated from the player channel.

## The doctrine this must satisfy

1. **Determinism.** Unlike #93 (player-driven, so it left digests untouched), town roles are
   SIM-driven — NPCs run the town in headless runs — so this is part of the deterministic core
   and WILL shift the baseline digests. The invariant is **self-consistency**: same seed → same
   town, every time. After building, re-run the harness (self-compare must pass) and record the
   NEW baseline hexes. All civic rng uses `world.rand` / per-farmer streams with **stable
   sorted iteration** (by seed) and a fixed order for simultaneous events.
2. **Influence, never command — now MECHANICAL, not a slogan.** Enforced structurally by where
   a directive sits in the decision ladder (below survival, dreams, and urgent personal work)
   and by a per-farmer civic budget with logged refusals. A directive can only ever redirect a
   farmer's *discretionary* time.
3. **Compile-don't-query.** Any LLM text (a Manager's rallying line later, a Lorekeeper's tale)
   is display-only with a procedural fallback.

---

# P1 — the autonomy kernel + the Manager

## 1. The decision ladder (the arbitration model — the real core)

The existing per-farmer `decide()` loop is already a strict priority ladder (survival/shelter →
urgent crop care → clearing → finite growth goals → facility work → help board → explore/forage/
hunt/barter → idle wander). Civic directives slot in as **one new low tier, just above idle fill
work and below everything personal**:

```
survival (sleep/eat/flee/sick/shelter)                [floor — never overridden]
 └ urgent crop + plot care, storm response
    └ dream / self-set-goal pursuit (grandhouse, outdo, ...)
       └ finite personal growth (expand/build/upgrade)
          └ facility work, help board, communal projects
             └ ►► CIVIC DIRECTIVE (new)  ◄◄
                └ explore / forage / hunt / barter (discretionary)
                   └ idle wander / muse
```

Because a directive is only ever consulted when the farmer would otherwise spend discretionary
time, no directive can pull a hungry, endangered, dream-chasing, or backlogged farmer off what
matters. That placement — not a promise — is what makes "influence not command" true. (This is
the same structural trick as #93's opt-in read points: gated, low, and skippable.)

## 2. The civic budget (concrete, testable numbers)

Per farmer, held on `sheet.civic`:
- **At most 1 active directive considered at a time.** A new higher-weighted directive can
  replace an un-accepted one; an accepted directive runs to completion or expiry (end of day).
- **Acceptance is a seeded check** on a dedicated per-farmer stream
  `mulberry32(world.seed ^ farmer.seed ^ directiveKind ^ day)`:
  `accept if roll < base(0.35) × effCollab × opinionWeight(manager) × taskFit − fatigue`,
  where `opinionWeight = clamp(0.4 + opinionOf(manager), 0..1.3)`, `taskFit` in 0.5..1.2 by how
  the task suits their stats/goal, and `fatigue` rises with recent acceptances.
- **Max 2 accepted civic tasks per in-game day**, then further directives are auto-declined
  (still logged) — a hard cap on how much of a life the town can claim.
- **Refusal is logged + consequential:** a decline writes `{day, kind}` to `civic.refusals`,
  shows a brief tell/thought, and is visible to the Manager (feeds approval, below). A farmer
  who just refused a kind won't reconsider it for a cooldown (1 day).
- **Hard immunities:** a `lone wolf` goal, an active rival relationship to the holder, or
  `opinionOf(manager) < -0.3` → always declines (logged). Loners and enemies are never steered.

## 3. The Manager (P1's proving role)

- **Appointment (founding):** seeded fitness = `CHA-mod + collaboration + (townXP contributed)
  + reputation`, highest scorer holds it; ties broken by seed. One role per farmer.
- **Civic action — ONE directive at a time.** Each cycle (cooldown-gated, ~once/day) the Manager
  reads town state (unlocked project + its material gap, town level, coffers, expansion room) and
  posts the single highest-value **town directive**: e.g. `gather-timber-for(project)`,
  `haul-donation-to-silo`, `build(project)`. It is published like a help-board job but flagged
  civic; idle farmers evaluate it through the kernel (§1–2). Reuses existing project/donation
  execution — no new task-execution paths.
- **Holder bias:** the Manager themselves prioritises town projects/donations over personal fill
  work (one tier bump for the holder only).
- **Approval + self-correction (so P1 isn't "stuck"):** the Manager carries a town **approval**
  value (0..1) that rises when directives are heeded and the town levels, and falls on refusals
  and stalls. Approval is the negative-feedback loop the council demanded BEFORE elections exist:
  - Below a floor for N days → **directive fatigue**: farmers weight the Manager's calls lower.
  - Catastrophic approval → **recall**: the Manager steps down mid-term and the role re-appoints
    by fitness (a chronicle beat + reactions). This keeps P1 dynamic without full elections.
- **Anti-dominance:** the Manager can only *bias discretionary labour*, and the existing communal
  projects already converge farmers on their own — so a great Manager *nudges* growth, doesn't
  algorithmically optimise it. Directive fatigue + the 2/day cap + budget bound the acceleration.

## 4. The one legibility view (committed, not deferred)

A **TOWN HALL** panel (new top-bar button, styled like ROSTER/CHRONICLE):
- **Roles roster:** who holds each role (P1: just Manager), their approval meter, fitness.
- **Live directive:** the current town directive in plain words ("The Manager calls for timber
  for the windmill").
- **Heed / refuse at a glance:** which farmers took it, which declined, and — the council's key
  ask — a one-line **why** for refusals ("Fen: chasing their own dream", "Uzka: no love for the
  Manager"). This is the audit trail that keeps the influence system legible, not spooky.
- **Recent civic beats:** the last few civic chronicle lines.

Everything else stays ambient in the existing chronicle/activity log.

## 5. Determinism + persistence + tests

- Civic rng: `world.rand` for town-level decisions (Manager cadence, appointment ties), a
  dedicated seeded stream per farmer for the acceptance check. **Stable sorted iteration** (by
  `sheet.seed`) everywhere a set of farmers is scanned (candidates, heeders).
- State: `world.roles = { manager: seed, managerApproval, ... }` + per-farmer `sheet.civic =
  { activeDirective, acceptedToday, refusals[], opinionOfHolders{} }`. Rides the existing
  serialize/fromSave (world) + sheet-wholesale (farmer) paths; structuredClone-safe.
- Headless tests (extend the scratchpad harness): (a) a farmer in survival/dream/urgent-backlog
  NEVER diverts to a directive; (b) the 2/day cap + lone-wolf/enemy immunities hold under a
  directive flood; (c) refusals are logged with a reason; (d) approval + recall math triggers a
  re-appointment; (e) self-compare digests deterministic (record the NEW baseline).

---

# Roadmap (later phases, onto the proven kernel — council fixes pre-baked)

- **P2 — Watch + communal justice.** Alarm/rally reuses the storm-convergence pattern. Justice:
  a **witnessed** theft → Watch convenes → seeded town vote weighted by opinion/honesty/severity/
  being-the-victim → escalating outcome **warning → fine → shun (a season)**. **No
  banishment-lite** (council: spatial/save nightmare, cut). Mandatory **exits**: fines are paid,
  shunning expires, reputation recovers, and shunning has **mercy exceptions** (never blocks
  sick-care) so it can't death-spiral. A false/overzealous conviction sours the town on the Watch
  (feeds approval).
- **P3 — Elections (v2, with CIVIC MEMORY — user directive 2026-07-09).** Annual nominate/vote/
  tally in the last days of Winter, tallied on the year rollover, **spread across the days
  approaching rollover** (don't cluster all civic drama at one instant). **Incumbent-fatigue +
  term consideration** so competent-but-popular incumbents don't snowball forever. **Population
  edge cases** committed: < enough eligible → role stays with incumbent / vacant; single candidate
  → acclaimed; dead/absent/sick → doesn't vote (quorum), vacancy re-seats by fitness; everyone-
  hates-the-only-fit-candidate → reluctant win (seated low-approval). Tally is a **pure
  deterministic function** (no holder can bias it). Player-proof: whispers can't touch ballots.

  **The town remembers (the core of v2):**
  1. **Town civic history** — `world.roles.history[]`: one record per completed term {office, seed,
     name, fromYear, fromDay, toDay, endReason (elected/reelected/recalled/voted-out/stepped-aside),
     approvalAtEnd, a one-line human "why"}. Serialized; drives a PAST OFFICES view + the SuperMemory
     town-history doc.
  2. **Per-farmer civic memory drives the ballot** — each farmer holds `sheet.civic.impressions[seed]`
     (a -1..1 impression of that person *as a leader*, distinct from `opinionOf`) built from lived
     civic experience: heeding a directive that paid off (+), one that stalled (−), a fair/unfair
     trial under their Watch, their approval cratering while I bore their calls (−). Plus
     `sheet.civic.voteLog[]` {year, office, forSeed, incumbentSeed, outcome} so a farmer remembers how
     they voted and whether it worked — a successor who proved WORSE warms them back toward the one
     they ousted ("a better option again"). The vote is argmax of
     `pref = 0.4·opinionOf + 0.3·civicImpression + 0.2·normFitness + incumbentEdge − fatigue +
     regretAdjust + selfVote + seededJitter`. **Reads ONLY local sim memory** (compile-don't-query).
  3. **SuperMemory** — civic moments write decaying `journal` episodic entries (already carried by the
     life-writeback), and `world.roles.history` persists as a town-level SuperMemory document (kind
     `town-history`, container `ry-farms`) so the portal + SuperMemory hold the civic record and
     farmers quote these memories in thoughts/gossip. Write-only mirror; the sim never reads it back.

  **Determinism:** impressions/voteLog/history all live in sim state, updated deterministically with
  stable seed-sorted iteration; ballots use a dedicated seeded jitter stream
  `mulberry32(seed ^ voterSeed ^ candSeed ^ officeTag ^ electionYear)`; the tally is a pure count.
  Sim-driven → **re-baselines the digests** (self-compare must pass; record new hexes).

  **Recall re-tuned so tenure is MEANINGFUL (P3 discovery):** with elections doing the ordinary turnover,
  recall becomes the rare emergency removal. The old P1 hair-trigger (approval `<0.25` for 3 days) churned
  a manager every few days in low-collaboration towns (a town too busy/individualist to heed directives),
  producing a meaningless 3-day-tenure history. Fixed: `RECALL_FLOOR=0.12` (recall only on genuine collapse,
  not a seasonal dip → the yearly election stays the primary turnover), `RECALL_DWELL=12` days running
  below it, and at most `MAX_RECALLS_PER_YEAR=2` (reset each election) before the town just waits for the
  ballot. Approval also holds (no decay) on a no-engagement day — a directive nobody weighed in on is no
  signal, not a rejection. Healthy towns now recall 0×/year (serve to the election); struggling ones ≤2×.

  **Approval made READABLE + MEANINGFUL:** it cratered to ~0.1 (a perpetually-red bar) because it jerked
  down on any unheeded day and a low-approval feedback loop starved heeding. Fixed: acceptance base
  `0.6→0.72` with a high `approvalFactor` floor (`0.8 + approval*0.2`, was `0.6+·0.4`) so a dip can't spiral
  heeding to zero, and approval tracks a TREND (sticky `0.85` carry, was `0.7`). Live (browser, 3 years): a
  town ran entirely on elections (3 voted-out, 0 recalls), approval breathing 0.15..0.56.

  **One-role invariant hardened (bug found in P3 browser test):** a farmer could hold two offices (Watch AND
  Healer) — the election handoff only cleared the Manager↔Watch pair and vacancy-fill excluded only the
  Manager. Fixed with `#vacateOtherRoles(seed, keep)` (clears every OTHER office a new holder had, recording
  Manager/Watch as stepped-aside) on every election seating, and Manager/Watch vacancy-fill + recall re-seats
  now exclude ALL other role-holders. Plus a pre-existing latent crash the trajectory change surfaced: the
  'outdo' dream-crisis passed a name STRING where `remember()` expected a farmer.
- **P4 — Lorekeeper + Secretary + depth.** Lorekeeper authors the chronicle + tells tales as a
  **voluntary** gathering (idlers *drawn*, never forced; rest-needing farmers exempt); morale
  lift is capped so it's not an exploitable productivity buff. Secretary redefined to avoid the
  "walking dashboard / Manager overlap" critique — narrower civic identity (ledger of debts +
  standing-share reminders), NOT a second directive firehose. Optional light memory-flavored role
  affinity (kept as flavor, not a hard determinant, to avoid reductive stereotyping).

# Committed answers to the v1 open questions (council-driven)

1. **Puppet risk** → solved structurally: directive tier sits below survival/dream/urgent work +
   a hard per-farmer budget + logged refusals + lone-wolf/enemy immunities. Only ONE authority in
   P1, so the "four-authority stacking" load is deferred until the kernel is proven.
2. **Legibility** → the TOWN HALL panel with the refusal "why" line (§4).
3. **Player vs determinism** → civic is **player-proof**; whispers never reach votes/verdicts.
4. **Pacing/dominance** → approval + directive fatigue + 2/day cap + recall; Manager biases only
   discretionary labour.
5. **Role vs dream conflict** → dream always wins (it's a higher ladder tier); a Manager who
   dreams of the quiet life is a *reluctant* leader — a feature, surfaced in their thoughts.
6. **Scope** → P1 = kernel + Manager only (this doc).
7. **Memory-flavored roles** → deferred to P4, kept as light optional flavor.

# Rejected / deferred from council (with reasons)

- **Banishment-lite** — cut entirely (pathfinding/save edge cases, low yield).
- **Player swaying votes** — rejected by decision: civic is player-proof.
- **All-four-at-once** — deferred; kernel proven with one role first (the council's core rec).
- **Designer telemetry dashboard** (Reviewer C) — out of scope for a personal art project; the
  TOWN HALL refusal-view doubles as the debugging affordance.

# Verification (P1 acceptance)

- Headless: the five tests in §5 pass; digests self-compare deterministic (new baseline recorded).
- Browser: a Manager emerges at founding; posts a directive; some farmers heed and some refuse
  with visible reasons; TOWN HALL reads clearly; a deliberately-tanked approval triggers recall +
  re-appointment; a lone wolf / an enemy of the Manager never diverts; a dreaming/hungry farmer
  never diverts.

---

## FUTURE — the ELECTION as an EVENT, not an at-founding assumption (Ry, 2026-07-11)

Ry's note: it's weird that roles exist *right out of the gate*. A town/warband should live UNGOVERNED for a
while, then hold a real election that the player watches happen. Redesign the FIRST election (and re-use the
shape for the annual ones):

1. **No roles at founding.** The town works ungoverned for a settling-in window (~first 10 days) — the player
   sees who actually performs (harvest, help, morale, brave/steady behavior) before anyone is chosen. The
   civic record / candidacy is EARNED from those 10 days, not assumed at day 0.
2. **A physical CONGREGATION.** When the vote is due, farmers (orcs: warband) walk to a gathering spot on the
   map (the plaza / well / a moot-ground) and DELIBERATE there — a real state/action that COSTS TIME (they stop
   farming and dedicate themselves to it), so the town visibly pauses to decide. New farmer state (e.g. `moot`),
   a gather point, a duration. Deterministic (seeded), same discipline as the existing election tally.
3. **A celebratory REVEAL MOMENT.** When deliberation resolves, a big `tier:'grand'` moment (drawMoments) shows
   ALL the roles at once and who won each — a proper ceremony, not a quiet log line. Much more special than
   silent at-founding roles.
4. **Orc variant:** the congregation is a war-moot / the reckoning (per ORC_BRANDING_NOTES B — power by
   challenge, not civic vote): they gather, and the strongest is backed / challenges are settled, then the
   reveal shows the Warchief/Enforcer/etc.

Determinism: the *when* (day-10 trigger, annual), the deliberation duration, and the tally stay seeded + in-sim
(harness re-baseline). The gather-and-deliberate is new SIM state (farmer state + a moot location), serialized.
Ties into the reconciliation `envoy` standout-selection + the FOE_SIEGE challenge idea for the orc path.
