# Codex Review #25 — Ry Farms: VERIFY the #23 + #24 fixes (and hunt the regressions they may have introduced)

**Repo:** `/Users/ryanhaigh/ry-farms` (point Codex HERE — not Documents/ry-farm, not portfolio-workspace).
**Scope:** the two FIX commits that resolve reviews #23 and #24 — `git diff 975cc4e..HEAD`
(`02f5586` raid resolver, `2c28789` persistence/bounds/hardening). This is a **verification + regression**
pass: for EACH fix, answer two questions — (1) does it ACTUALLY resolve the finding it claims, and (2) did the
fix introduce a NEW bug (a fix is a change, and changes regress). Do not re-report the original #23/#24 findings
as open; report only where a fix is INCOMPLETE, INCORRECT, or created a new problem.

## The two sacred doctrines
1. **DETERMINISM.** Sim consumes only seeded rng (`world.rand`/`this.rand`/`mulberry32(hashString(...))`), stable
   sorted iteration → same seed ⇒ byte-identical town, twice. `tests/determinism.mjs` `same-twice` must hold and
   the four baselines `7d142951 / 8e2c2899 / 60e50036 / ea4bc356` must NOT move (raids/world-index/writeback are
   NOT exercised by the single-town headless harness, so reason about them directly). RNG is DELIBERATELY
   re-seeded on load (`randSeed` in `serialize()`), so reload continuation is deterministic-but-fresh, NOT a
   stream continuation — judge reload fixes as BEHAVIORAL fidelity, not stream-identity.
2. **COMPILE-DON'T-QUERY.** The LLM + SuperMemory (`api/*`) are never read in the sim loop.

Report **P0** (determinism / exactly-once / crash / save-corruption / silent state-loss) and **P1** (logic bug,
doctrine violation, unbounded growth, security) with `file:line`, a concrete repro, and a fix. Rank by severity.
A verification harness exists for most of these — run/extend it, don't just eyeball.

---

## Fix 1 — Raid resolver: synchronous outcome + display-only cinematic  (`farm.js`, `main.js`; commit 02f5586)
The live path no longer defers the outcome. The inbox `raided` branch now: docks harvest, writes ONE grand
"RAIDERS AT THE GATE" chronicle, logs, then `#applyRaidOutcome(out,e)` (wounds + deterministic seeded
monuments via `#addMonument` 40-cap + result line + `threatAlert` rousing the WHOLE town) SYNCHRONOUSLY for both
live and dormant, and only THEN, if `_live`, `#stageRaidCinematic(out,e,monSpots)` builds display-only raiders
(in `raidEvent.raiders`, NOT `this.encounters`, no `reveal()`, private `raidfx:` stream). `#tickRaidEvent`
moves only those display objects; `main.js collectDrawables` renders them.
**Verify:**
- (a) **The claimed P0s are truly closed.** A save during the ~9s cinematic keeps the full outcome (harvest/
  wounds/monuments) on reload; two `raided` events in one batch BOTH fully apply (no single-slot clobber); a
  watched town's serialized state is byte-identical to a dormant one (harvest/monuments/wounds/**fog**/rng — the
  live path draws no `this.rand()` now). A harness at `<scratch>/raid-adversarial.mjs` asserts all of this —
  re-run + stress it (more raids, `felled=0` and `felled=2`, save during the FLEE phase, back-to-back of 3+).
- (b) **NEW behavior change — dormant towns now rouse + wound synchronously.** Previously a DORMANT raided town
  applied the outcome silently; now `#applyRaidOutcome` sets `threatAlert=1.5` on EVERY farmer + wounds the
  ranked defenders in BOTH paths. Is that a legitimate, intended sim change (it makes watched==dormant), or does
  rousing a dormant town with NO raider encounters to rally to cause a farmer to path toward a non-existent
  threat / soft-lock / draw rng differently than before? Trace `threatAlert`'s consumers (`#maybeRallyToThreat`,
  flee/shelter) for a dormant town with `raidEvent===null`.
- (c) **Monument placement moved** from `WILD_RADIUS-4` to a seeded 7-10 tiles from CENTER (`raidmon:`/`raidmd:`
  hashes). Confirm `nearestOpenTile` can't loop/return a blocked tile there, monuments still don't collide with
  farmer pathing, and `#addMonument`'s 40-cap `shift()` can't drop a monument another structure references.
- (d) **Display raiders are truly inert.** They're not in `this.encounters` — confirm NOTHING else iterates
  `raidEvent.raiders` as sim state, the two now-dead `presentational` guards (`farm.js` ~5443, ~7977) are
  harmless, and `#tickRaidEvent` cleans up (`raidEvent=null`) with no leak if the town is left mid-cinematic and
  re-saved (raidEvent is never serialized — confirm a reload mid-cinematic is clean, outcome already applied).

## Fix 2 — World-index CAS gate + rev guard  (`main.js`; commit 2c28789, #24-1)
`maybeAutosave` now registers the summary only inside `saveTown(...).then(d => if d!=null)`; `townSummary` adds
`rev: w._rev`; `registerWorld`'s mutator keeps the newer summary when `prev.rev != null && s.rev < prev.rev`.
**Verify:**
- (a) Does gating `registerWorld` on save success DELAY encounter detection / inbox consumption on the FIRST day
  a town is played (when the save may be the very first)? `registerWorld` is where `detectEncounters` +
  `consumeInbox` run — if a save is ever refused early, does the town stop detecting/consuming until a later
  successful save? Any path where the town now NEVER registers (e.g., persistent CAS refusal) and silently
  drops its inbox?
- (b) The rev guard skips the summary upsert for a stale rev but STILL runs `detectEncounters`/`consumeInbox` on
  the newer index — correct? An OLD summary with no `rev` field (`prev.rev == null`) falls through to a normal
  upsert — is that the intended migration (a legacy summary is freely overwritten once)?
- (c) `_rev` semantics: `saveTown` increments `world._rev` on commit BEFORE `registerWorld` reads it — confirm
  the summary carries the COMMITTED rev, not the pre-increment one.

## Fix 3 — wipe→undo restores the world-index slice  (`save.js`; commit 2c28789, #24-2)
`wipeTown` captures `{town,inbox,pairs,news,encounters}` for the seed inside the delete mutator, then puts it to
`backup:worldslice`; `undoWipe` restores it (dedup on encounters/news) and consumes all three backups.
(Browser-verified: traveler/pair/encounter survive.) **Verify:**
- (a) **Non-atomic seams.** The slice is captured inside `updateWorldIndex` but WRITTEN to `backup:worldslice`
  in a SEPARATE txn after; `undoWipe` restores then deletes backups in separate txns. Is there a crash window
  that leaves a half-restored index or an un-consumed backup that a second undo would wrongly re-apply?
- (b) **Restore correctness.** `index.pairs[k]=v` / `index.inbox[sk]=slice.inbox` OVERWRITE — could that clobber
  a NEWER pair/inbox created between wipe and undo (e.g., the neighbor re-detected the wiped town in that
  window)? The encounter/news dedup keys (`a:b:kind:day:ordinal`, `origin:destination:ordinal`) — do they match
  the real record shape, and can a missing field collide two distinct records into one?
- (c) Consuming the backup means undo is now ONE-SHOT — confirm nothing relied on repeatable undo, and that a
  fresh wipe correctly re-arms it.

## Fix 4 — World-index growth bounds  (`worldmap.js`, `reconciliation.js`; commit 2c28789, #24-4)
`metPairs` (durable compact dedup) split from `index.encounters` (capped 120 presentation); empty/wiped inbox
buckets pruned; ledgers compacted to `raidN/betrayalN/reconcileN` + bounded `recent`, ordinal via `ledgerCount`.
**Verify:**
- (a) **The cap can't cause re-detection.** metPairs is the dedup now — confirm EVERY path that used to rely on
  `encounters` for "have they met" reads metPairs, and that metPairs is seeded (migrated) from legacy encounters
  BEFORE the first cap could truncate them. A harness at `<scratch>/worldindex-bounds.mjs` asserts no
  re-detection after the cap — re-run it.
- (b) **Ledger compaction is determinism-preserving.** `foldDisposition` + `ordinal` are count-based, so counters
  must equal the old array lengths EXACTLY through migration. Confirm the migration (legacy arrays → counters) is
  lossless, the monotonic-ordinal idempotency (`meta.ordinal < total → no-op`) matches the old per-ordinal
  `has()` guard, and NOTHING else reads `led.grievances`/`led.reconciliations` (now gone). The harness checks
  disposition/ordinal equivalence — extend it to a longer mixed sequence.
- (c) **Inbox pruning safety.** `detectEncounters` now deletes inbox buckets for towns not in `index.towns` or
  that are empty. Confirm an inbox recipient is ALWAYS a registered town (both encounter endpoints come from
  `computeLayout(index.towns)`), so a legitimately-pending event for a dormant-but-known town is never dropped.
  Is there ANY queueInbox target that isn't in `index.towns`?
- (d) metPairs is GC'd for non-live towns (same as pairs) — confirm a WIPED town's metPairs entry is dropped so a
  legitimately-new town at a reused position isn't wrongly deduped, while a dormant-but-known town keeps its
  met-state.

## Fix 5 — reload-gating cooldowns serialized  (`farm.js`; commit 2c28789, #24-5)
Serialize/restore `healSeekCd, chatCooldown, poachCooldown, teachCooldown, sabotageCooldown, barterCooldown,
tradeCooldown, coopCooldown` (default 0 on old saves). **Verify:**
- (a) Did the sweep MISS any rng-gating cooldown/timer that resets on reload and draws `this.rand()` on the first
  post-load tick (e.g., `thoughtBubbleTimer`, `wanderTimer`, `lightningTimer`, `barterDeal`, world-level
  `merchantNextDay`/`preyCooldown`/`dmCooldown`)? For each, is it (i) already serialized, (ii) display-only, or
  (iii) a genuine miss? The round-trip harness in `tests/determinism.mjs` covers the named set — extend it.
- (b) Are all eight fields safe as `undefined` on a fresh (non-reloaded) farmer (the `> 0` gates treat undefined
  as 0), so ADDING them to serialize didn't change the fresh-run baseline? (It didn't move — confirm WHY.)

## Fix 6 — memory-writeback hardening  (`api/memory-writeback.js`, `memory-writeback.js`; commit 2c28789, #24-3)
Loopback-origin guard, numeric town+farmer identity required, monotonic `rev` stamp; client sends `rev`.
**Verify:**
- (a) **Does the origin guard reject LEGITIMATE traffic?** It allows only `localhost`/`127.0.0.1`/`::1` Origins
  (and no-Origin). If Ry Farms is ever served from a real host (Vercel prod, a LAN dev box, `0.0.0.0`), the
  game's own writeback would be refused. Is that acceptable (self-host-only by design), or does it silently break
  a deployed instance? Note the failure mode.
- (b) **Does requiring numeric `townSeed` break any existing caller?** Both client callers send `world.seed`
  (numeric) — confirm no other caller (a test, a script) posts without it and now 400s. Farmers without a numeric
  seed are SKIPPED — confirm that can't silently drop a legitimate farmer whose seed is a numeric STRING.
- (c) The `rev` stamp records a version but there's NO server-side compare (SuperMemory has no get-by-customId) —
  is the residual "a stale client still overwrites a newer doc" risk actually mitigated by the client's
  stale/hidden-tab guard, or is it still open? State the residual honestly; don't over-claim the fix.

## Fix 7 — determinism harness stricter  (`tests/determinism.mjs`; commit 2c28789, #24-6)
Fails CI on baseline DRIFT (not only same-twice); added a save round-trip section. **Verify:**
- (a) Could failing-on-drift cause a FALSE CI failure (e.g., a legitimate re-pin the author forgot, or a
  platform-dependent hash)? The four hashes are pure JS integer math — confirm no `Date`/`Math.random`/locale/
  float-formatting dependence that could drift across Node versions or OS.
- (b) The round-trip section forces a raid + stamps cooldowns then compares fields — confirm it actually EXERCISES
  the reload path it claims (fromSave via `structuredClone`, mimicking IndexedDB) and would FAIL if a covered
  field stopped being serialized.

---

## Harnesses to run (committed under `tests/` — RUN them, don't just read the diff)
```
node tests/determinism.mjs                       # baselines UNCHANGED + round-trip + drift-fails-CI
node tests/raid-adversarial.mjs                  # #23 P0s: save-mid-raid, back-to-back, watched==dormant, cap
node tests/worldindex-bounds.mjs                 # #24-4: cap, no re-detection, ledger equivalence, inbox prune
node tests/writeback-guards.mjs                  # #24-3: origin/identity/rev guards (fetch mocked)
node -c farm.js && node -c main.js && node -c save.js && node -c worldmap.js && node -c reconciliation.js && node -c api/memory-writeback.js
```
These are STARTING points — extend each with the harder cases in the per-fix checklists (flee-phase save, 3+
back-to-back raids, longer mixed ledger sequences, the un-swept cooldowns). The point is to EXECUTE a repro that
tries to BREAK the fix, not to trust that it works.
