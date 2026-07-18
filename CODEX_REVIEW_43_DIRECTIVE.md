# Codex Review #43 — Ry Farms: the COUNTER-OFFENSIVE (grievance vote → real multi-day sortie)

**Repo:** `/Users/ryanhaigh/ry-farms` — FULL absolute path (NOT `~/Documents/ry-farm`, a stale unrelated repo).
Branch `main`, HEAD `fa2a17b`. **These commits are LOCAL / UNPUSHED**; `origin/main` = `eb5502b`. Codex runs in
a separate checkout with no origin, so the review surface is the attached **`review.diff`**
(`git diff eb5502b..fa2a17b -- farm.js main.js tests/counteroffensive.mjs`, ~703 lines) plus this directive.
No PR. This is a fresh feature review (not a re-check).

## What this is
The town that gets raided too often by one named nemesis resolves to **strike back**. The full arc, all NEW:
grievance accrues when the nemesis ESCAPES → past a threshold the **sworn-against hero calls a reckoning** →
the town **gathers at the square and argues** (a within-day ceremony) → a **failable ballot** at dusk → on a
YES a real **war party musters, marches to the frontier, and rides out for 1–3 days** — the **town is left
undefended** while they're gone → they **return with reclaimed spoils and/or a casualty** and the nemesis
**deepens**. Two sacred doctrines: (1) DETERMINISM — the sim draws only seeded rng + pure hashes; (2)
COMPILE-DON'T-QUERY — the LLM/SuperMemory are display/persistence side-channels the sim never awaits.

## Commit map (range eb5502b..fa2a17b)
- `445b08e` **Phase 1** — grievance ledger + eligibility + the failable hero-called vote.
- `ca9a0eb` Phase 1.5 — render-only "they ride" bridge (SUPERSEDED by P2; the render trigger was replaced).
- `887240d` **Phase 2 sim core** — real party leaves, gone 1–3 days, town undefended, spoils/casualty/deepen.
- `24c4d27` **Phase 2 ceremony** — the vote becomes a within-day town-square gathering (assemble + argue).
- `fa2a17b` **Phase 2 departure** — the visible muster-march to a frontier rally, then off-field.
- `3658b77`, `ac91653` — **render-only** fog-label legibility + the new VS-card busts/flip. Quick-scan only.

Focus your effort on `farm.js` (the sim). `main.js` is render-only here.

## A. THE DETERMINISM CRUX (the strong claim — verify hard)
The whole arc is claimed to draw **ZERO `world.rand` / `this.rand()`** (only `hashString` + `mulberry32(hash)`),
and to be **dormant in the 30-day harness** (it fires only on an eligible nemesis war), so `tests/determinism.mjs`
baselines **`76f81ef4 / 20d5f94e / 64f39c7d / 3b8b9a8b` are UNCHANGED (no re-pin)**. Confirm:
- Grep every new method for `this.rand`/`world.rand`: `#tickCounterOffensive`, `#counterEligible`,
  `#tickCounterCeremony`, `#tallyCounterVote`, `#counterBallot`, `#warStanceThought`, `#launchCounterSortie`,
  `#sortieRally`, `#tickCounterSortie`, `#resolveCounterSortie`. The vote/sortie ROLLS must be
  `mulberry32(hashString(...))` keyed on stable seeds (this.seed, pairKey, farmer seed, day, Math.round(leftAt)).
- BUT: the CEREMONY makes farmers ASSEMBLE and `think()` (which DOES draw `this.rand`), and the MUSTER makes
  riders walk + `think()`. That's a legitimate sim trajectory change WHEN IT FIRES. Confirm it fires only on an
  eligible war (never in the harness), so the pinned digests genuinely hold — and that the fire path is itself
  deterministic (a full-checkout run of `tests/counteroffensive.mjs` asserts `same seed+config → identical war
  party`). Is the "unchanged baselines" claim honest, or is something that SHOULD perturb the digest silently
  not firing? Name any path where the arc could draw rng in a normal (non-war) 30-day run.
- WATCHED vs DORMANT: the arc lives entirely in the day-rollover + tick (no `_live` gating on any SIM state —
  only the removed render ghost was `_live`-gated). Confirm the sim outcome (vote, party, spoils, casualty,
  nemesis) is byte-identical watched-or-dormant (the harness asserts `watched === dormant`).

## B. SAVE-SAFETY
New serialized state: world `grievance / counterVote / counterAuthorized / counterCooldownUntil / counterSortie`;
per-farmer `onSortie / mustering`. Confirm: (1) all round-trip through `serialize()` → `structuredClone` →
`fromSave` (nested `foe`/`party`/`rally` are copied, not shared refs); (2) a save taken MID-CEREMONY (vote
`called`/`gather`), MID-MUSTER, and MID-AWAY each resumes correctly (the harness covers away + a saved-then-
loaded sortie resolving the same — is mid-muster / mid-ceremony also safe?); (3) old saves without these fields
default cleanly (`|| null` / `|| 0` / `|| false`).

## C. THE VOTE (eligibility, failability, ceremony)
- **Eligibility** (`#counterEligible`): named + PATTERNED (2+) + ESCAPED nemesis, DEFENSE branch, grievance ≥
  threshold, a present un-sick hero, ≥ `COUNTER_MIN_TOWN` able bodies. The harness gates each precondition.
  Anything missing (e.g. `nemesis.ended`, a truce-branch town) that could still fire it?
- **Failability** (`#counterBallot`): a "war is grave" −0.35 default that aggression + grievance + hero-regard
  must overcome; a DOVE holds at moderate grievance, RIDES when it's deep; a HAWK rides readily; a pure per-voter
  hash waver. Confirm it can't become a rubber-stamp (or an always-fail) across plausible towns, and that sick/
  downed abstain.
- **Ceremony** (`#tickCounterCeremony` + `counterGathering()` + the `#decide`/`assemble` routing): called at
  dawn → `gather` at midday → tally at dusk, clock-gated like `#tickFounding`. Confirm: the tally FIRES exactly
  once at dusk (no double-tally, no stuck `gather` if dusk is missed); a town-switch or a real RAID landing
  mid-ceremony doesn't strand farmers in `assemble`/`gather`; `#tickCounterOffensive` no longer tallies (only
  calls).

## D. THE SORTIE (the riskiest surface)
- **Party pick** (`#launchCounterSortie`): hero first (NOT exempt), then strongest hale, keeping
  `SORTIE_WORKFORCE_FLOOR` able bodies home; mandate consumed. Confirm the floor math can't send the town below
  the floor, and the sortie can't launch with < the floor available (the mandate lapses).
- **Muster → depart** (`#tickCounterSortie` + the `sortie` state + `#decide` kickoff + `#sortieRally`): a ~3s
  HOLD, then riders (still ON-FIELD, `mustering`) march to the rally, then flip OFF-FIELD (`onSortie`) with an
  anti-stall `SORTIE_MUSTER_MAX`. Confirm: a rider who CAN'T path to the rally still departs (the max fires); the
  `sortie` state can't trap a farmer if `counterSortie` clears out from under them; `Farmer.tick` early-returns
  for `onSortie` but NOT `mustering` (mustering farmers tick/render normally).
- **Undefended stakes**: `#resolveRaid` defenders now exclude `onSortie` (NOT `mustering`). Confirm a raid
  during the AWAY window genuinely hits a thinner defence, and a raid during MUSTER still counts them (they
  haven't left) — is that the intended seam, and does anything double-count?
- **Return** (`#resolveCounterSortie`): deterministic verdict (party strength vs foe); a WIN reclaims
  `min(cap-share, nemesis.harvestLost)` into `harvestTotal` (spoils NEVER fabricated — `nemesis.harvestLost`
  accrues per raid in `#applyRaidOutcome`); a hard fight DOWNS one rider (hero not exempt, floor already kept);
  the nemesis DEEPENS (`lastOutcome='escaped'`). Confirm: no double-spend of `harvestLost`; the casualty can't
  drop the town below survivability; riders un-`onSortie` and walk home; the verdict is stable (no rng).
- **CIVIC / ROLE interaction (call this out):** what if the Manager / Watch / Healer / current sentry is on the
  sortie (off-field for days) — do the role/recall/election/leaderboard systems misbehave with an off-field
  holder, or reference an `onSortie` farmer as present? Same for a `mustering` farmer. This is the most likely
  place an off-field farmer leaks a bug.

## E. Harnesses
`node tests/counteroffensive.mjs` (26 probes: eligibility gating, failability, determinism, watched===dormant,
muster/away/undefended/return, save round-trip), `node tests/raid-adversarial.mjs`, `node tests/determinism.mjs`
(four pinned hashes + same-twice), `node --check` on farm.js + main.js.

Report ranked findings (P0 = determinism/persistence/crash; P1 = fix; P2 = note) with file:line + repro + fix.
A clean pass is a welcome, valid outcome — say so plainly. Call out explicitly whether (A) the "zero rng / no
re-pin" determinism claim is watertight and (D) the off-field-farmer civic interaction is safe, since those are
the two places a real bug most likely hides.
