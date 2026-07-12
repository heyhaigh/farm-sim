# Ry Farms — War & Movement Doctrines (strategist+historian spec, 2026-07-12)

A town's frontier posture, grown from who it is. **9 doctrines, 4 levers, one exactly-once inbox effect.**
Every hook is a pure/seeded fn of persisted town state; the world layer may compute it non-deterministically,
but the only thing crossing into a town's sim is a data field on the inbox event, consumed once.

## The 4 levers → plug points
- **Scouting** (0/1/2 scouts) → `detectEncounters` rumor block + `seedTraveler`. 0 = silent/surprise, 2 = reliable.
- **Commitment** (fraction of defender's stores a raid takes) → `raided` event `commit` → `applyInbox`.
- **Posture on contact** (ambush/parley/turtle/feign/alliance) → `resolveEncounter` [v2].
- **Who leads** (envoy = watch/manager/curious) → `townSummary` envoy pick [v2].

## The 9 doctrines  `{commit, scouts, biteReduce, posture, leadRole, …}`
- **D1 Comitatus** (Germanic sworn band) — orc default · 0.15 · scouts 1 · ambush · honor-bound (no betray).
- **D2 Strandhǫgg** (Viking shore-snatch) — orc · 0.30 · scouts 0 → surprise.
- **D3 Great Muster** (fyrd/hoplite levy) — both/big · 0.55 · scouts 2 → telegraphed; selfExposure [v2].
- **D4 Impi Horns** (Zulu encircle) — orc · 0.35 · scouts 2 · disciplined (betray=0) [v2].
- **D5 Mourning-War** (Woodlands grief-raid) — both · 0.10 · scouts 1 · redress (ledger-keyed) [v2].
- **D6 Feigned Flight** (Mongol/Parthian) — both · 0.20 · scouts 1 · betrayPref (honesty<0.3) [v2].
- **D7 Palisade** (Pueblo/Swiss turtle) — human default/both · 0 · scouts 2 · biteReduce 0.5.
- **D8 Long House** (Haudenosaunee confederacy) — human · 0 · scouts 2 · alliance · +0.15 honored [v2].
- **D9 Guest-Right** (Greek xenia/trade-peace) — human · 0 · scouts 1 · trade · +0.08 honored [v2].

## Selection (pure/seeded) — `World.doctrine()` in farm.js
- Culture gates the pool + default (orc→Comitatus, human→Palisade).
- **Leader** decides martial vs civic: higher `#watchFitness` vs `#managerFitness` → martial → raids; else holds.
- Cohesion (`townCollab`) + size separate the disciplined muster from the lone smash-and-grab.
- Envoy honesty/curiosity/collaboration pick the flavor (false→feign, open→guest-right, collab→long house) [v2].
- **Ledger refine** [v2]: 3+ grievances-against-me → a martial town turns to Mourning-War, a peaceable one hardens to Palisade.

## SHIPPED — v1 slice
4 doctrines (Comitatus/Strandhǫgg/Great Muster/Palisade), **commitment + scouting** levers only.
- `DOCTRINE_DEFS` + `doctrineDef()` in reconciliation.js; `World.doctrine()` in farm.js; baked as `summary.doctrine`.
- `applyInbox` reads `e.commit ?? 0.2` (pre-doctrine saves byte-identical).
- `detectEncounters`: `commit = raider.commit * (defender.biteReduce ?? 1)` on the `raided` event; `scouts` fed to `seedTraveler`.
- Determinism: doctrine is off-sim (world/display tier); baselines unchanged (no re-pin).
- Verified: orc→greatMuster (0.55), comitatus-vs-palisade → 0.075 (walled) / 0.15; strandhǫgg scouts=0 → surprise.

## DEFERRED — v2+
D4/D5/D6/D8/D9; `resolveEncounter` posture biases (ambush/feign/redress/alliance); envoy `leadRole` rekey;
`refineByLedger` ledger override; `selfExposure` for the muster; per-doctrine chronicle flavor (adopt/act lines,
both voices — see the strategist transcript). All additive: unknown `commit` falls back to 0.2, doctrine field ignored by old readers.
