# Codex Review #24 — Ry Farms: WIDE persistence-adversarial + doctrine re-sweep

**Repo:** `/Users/ryanhaigh/ry-farms` (point Codex HERE — not Documents/ry-farm, not portfolio-workspace).
**Why this exists.** Review #23 (raid resolver + speech) surfaced **four P0s that are all the SAME bug class**:
(1) autosave mid-raid marks the inbox event applied but never persists the pending outcome → reload silently
drops it; (2) back-to-back events in one batch clobber the single in-flight slot → lost outcome + orphaned
state; (3) the *watched* path consumes extra `this.rand()` + mutates authoritative arrays → a watched town
diverges from a dormant one; (4) a new serialized array bypasses the growth cap. **We have never hunted that
class across the OTHER stateful systems.** This review does.

**Scope.** The full arc since #22: `git diff daf8b2b..HEAD`. The **raid resolver + weather speech + memory
surfacing + whisper ripple are OWNED by #23** — do NOT re-report those (fixes are in progress). #24 instead
GENERALIZES the four failure modes to every OTHER persisted/stateful system, and does a doctrine pass on the
`api/*` self-host surfaces that prior reviews never focused on.

## The two sacred doctrines
1. **DETERMINISM.** Sim consumes ONLY seeded rng (`world.rand`, `this.rand`, `mulberry32(hashString(...))`),
   stable sorted iteration → same seed ⇒ byte-identical town, twice. World/display layer may be
   non-deterministic; anything crossing INTO a town's sim must be a pure seeded function of persisted state,
   consumed EXACTLY-ONCE via the serialized inbox. `tests/determinism.mjs` `same-twice` must ALWAYS hold.
2. **COMPILE-DON'T-QUERY.** The LLM (`api/ry-farms-*`, `api/_llm.js`) + SuperMemory (`api/knowledge-graph.js`,
   `api/memory-graph.js`, `api/memory-writeback.js`) are NEVER read in the sim loop; all flavor is procedural
   or a display-only / persistence-only side-channel.

Report **P0** (determinism / exactly-once / crash / save-corruption / silent state-loss) and **P1** (logic bug,
doctrine violation, unbounded growth, migration break, security) with `file:line`, the concrete failing
scenario (ideally a save→reload or back-to-back repro), and a fix. Rank by severity.

---

## THE FOUR FAILURE MODES — apply each to EVERY system below
- **FM-A (save-mid-flight state-loss):** an event/process is marked done/applied/consumed, but the STATE it
  should produce isn't persisted atomically with that acknowledgement. Autosave in the window → reload → the
  effect is silently gone (and can't be re-delivered, because it reads as already-applied).
- **FM-B (back-to-back / single-slot clobber):** two of the same event (or two triggers) in one tick/batch
  overwrite a single in-flight slot; the first is marked handled but its effect never lands; leftover
  presentational/transient state is orphaned.
- **FM-C (watched-vs-dormant divergence):** a WATCHED (`_live`/foreground) town runs extra code — draws
  `this.rand()`, mutates authoritative arrays (`encounters`, `monuments`, fog `reveal`), or times effects on a
  cinematic clock — so its digest-visible state diverges from the same town resolved dormant/headless.
- **FM-D (unbounded serialized growth):** a `.push()` into a serialized array with no cap → save size +
  render cost grow without bound over a long-lived town / many years.

## System 1 — Inbox exactly-once across ALL event kinds  (`farm.js applyInbox` ~1602)
Kinds: `traveler` (future-dated, left unapplied until arrival), `raided` (→#23), `reconciled`, `betrayed`,
`news`. The ledger (`_inboxApplied`, capped 200) + per-pairKey `_inboxWatermark` gate exactly-once.
**Verify (FM-A / FM-B):**
- (a) For `reconciled` / `betrayed`: is ALL their effect (opinion, earned cross-faction belief, chronicle)
  applied SYNCHRONOUSLY inside `applyInbox` (no deferred/animated tail that a mid-flight save could drop)?
- (b) **Ledger-cap vs watermark durability:** `_inboxApplied` is capped at 200 (FIFO). If a town accretes >200
  applied ids, can an OLD id be evicted and its event re-delivered and re-applied? The watermark is meant to
  cover this — confirm EVERY kind carries a `pairKey`+`ordinal` (or stable id) so the watermark actually
  guards it. Any kind with `pairKey == null` falls back to the id-list only → re-apply risk after 200.
- (c) **Future-dated traveler durability:** a traveler with `arrivalDay > day` is left unapplied and must
  linger in the inbox across saves/reloads until its day. Confirm `main.js consumeInbox` does NOT clear it and
  `serialize` persists the un-consumed inbox (or the world index re-seeds it deterministically). Repro: seed a
  traveler, save before arrival, reload, advance to arrival — does it still land exactly once?

## System 2 — Town roles / elections / directives / civic memory  (`farm.js`, serialize ~2459)
Serialized: `roles.{manager,watch,healer, *Approval, *LowDays, directive{heeders,refusers}, directiveSeq,
cooldown, caseSeq, managerTerms, watchTerms, history[]}`. Recall (`~319`), day-10 founding, annual winter
elections, one-role invariant (`#vacateOtherRoles`).
**Verify:**
- (a) **FM-A across a live election / founding ceremony.** Nominations→campaign→tally span multiple sim
  days/steps. Save DURING the ceremony (assemble state, partial ballot) → reload → does it resume and tally
  the SAME winner, exactly once? Any tally state held only in memory (not serialized) that a reload resets or
  double-counts? Is a directive's `heeders`/`refusers` (Sets → arrays) rebuilt correctly in `fromSave`?
- (b) **FM-D on term history.** `managerTerms`/`watchTerms`/`roles.history[]` append one entry per term/handoff
  and are serialized. Over many in-game years is there ANY cap? (The raid-monument P1 was exactly this.) If
  uncapped, that's a P1 — propose a cap or a rollup.
- (c) **One-role invariant + recall determinism.** Confirm `#vacateOtherRoles` can't leave a farmer in two
  roles across a reload, and that recall/approval math draws only seeded rng and reads only persisted fields
  (no `Date.now`, no wall-clock, no display-tier read).
- (d) **Dead/departed office-holder:** a `roles.manager` seed whose farmer died/left — does `fromSave`
  re-resolve it to a live farmer, or can it dangle (crash on the next `roles.manager.sheet` read)?

## System 3 — Reconciliation: creed-overwrite & cross-faction belief  (`reconciliation.js`, `farm.js`)
The creed-vs-belief war: an envoy EARNS cross-faction belief that overwrites their raid-creed (creed `weight`
+ belief `strength` are DIGEST-VISIBLE — see `tests/determinism.mjs` `creeds`/`beliefs`).
**Verify:**
- (a) The overwrite mutation draws only seeded rng and is a pure function of persisted state — no wall-clock,
  no display read. Same seed ⇒ same creed weights, twice.
- (b) **Exactly-once earning.** `earnCrossFaction` is driven by a `reconciled` inbox event — can a redelivery
  (or a back-to-back pair, FM-B) double-apply the belief bump? Is it idempotent per `pairKey`?
- (c) Bounds: can creed `weight` / belief `strength` run past their intended clamp over many reconciliations?

## System 4 — War doctrines determinism  (`reconciliation.js`, `farm.js`, `worldmap.js`)
Towns/warbands adopt a strategy that scales raid commitment + scouting.
**Verify:** the doctrine chosen and the raid `commit`/scout cadence are pure seeded functions of persisted town
state (not of visitation order or wall-clock). Two towns generated in a different SESSION ORDER must pick the
same doctrines. The `commit` value that feeds a `raided` event must be deterministic and persisted/re-derivable
(it sets the harvest bite — a non-deterministic commit would desync the loss on reload).

## System 5 — Health / energy economy  (`farm.js`, incl. commit `5b67386`)
Sleep debt cap + halved illness-DC weight, homeless-exposure softening, dawn CON save.
**Verify:** the sick-out / illness roll draws only `this.rand()` (digest-visible: it changes positions/xp), is
a pure function of persisted energy/sleep-debt/health, and the `5b67386` cap can't drive energy/hp/health to
NaN or an unbounded sleep-debt counter. Confirm this tweak was intended to change the sim (it legitimately
re-pins baselines — see System 8) rather than sneak a change into a "display-only" claim.

## System 6 — Self-host SuperMemory + LLM side-channels  (`api/*`) — COMPILE-DON'T-QUERY + SECURITY
`knowledge-graph.js` (read farmers from self-hosted SuperMemory :6767), `memory-graph.js` (portal graph),
`memory-writeback.js` (persist farmer lives / town history back), `_llm.js` (universal Chat Completions honoring
`OPENAI_BASE_URL`), `ry-farms-chat/conscience/dm/invent.js`.
**Verify:**
- (a) **No sim reads.** Confirm NOTHING in `world.tick`'s path awaits or reads these — they're display/boot/
  persistence only. A town must simulate byte-identically with the network fully offline.
- (b) **Writeback exactly-once + no corruption.** `memory-writeback.js` persisting a farmer's life / town
  history: can a double-invocation (two tabs, a retry) create duplicate SuperMemory docs or clobber a newer
  record? Is it keyed idempotently?
- (c) **Graceful offline.** Every `api/*` fetch: does a 500 / timeout / self-host-down degrade cleanly (fall
  back to the embedded crew / skip the portal) rather than throw into the render loop or block boot?
- (d) **Security.** Loopback-only assumptions, no secret/API-key leaked to the client bundle, no unsanitized
  memory text injected into a prompt or into `innerHTML` in the portal (`memory-graph.html`).

## System 7 — Persistence plumbing & save/version  (`save.js`, `farm.js serialize/fromSave`, `World.SAVE_VERSION=1`)
Cross-tab CAS (`_rev`), IndexedDB readwrite serialization, the inbox ledger/watermark, wiped-town GC.
**Verify:**
- (a) **Round-trip completeness.** Diff `serialize()` against every field the sim MUTATES: is anything the sim
  relies on (a Set/Map, a counter, an in-flight timer, `raidEvent`, a ceremony's partial tally) missing from
  the snapshot or lost in the Set→array flattening? (The raid P0 was a missing-from-snapshot field.)
- (b) **Migration.** `SAVE_VERSION=1` with no `migrate` seen — if an OLD save (pre-roles, pre-tales,
  pre-doctrine) loads, do the new fields default safely, or does `fromSave` throw / produce a corrupt town?
- (c) **CAS correctness.** The cross-tab compare-and-swap on `_rev`: two tabs saving concurrently — can one
  silently clobber the other's applied-inbox ledger (re-opening an exactly-once hole)?
- (d) **FM-D global pass.** Enumerate EVERY serialized array (`monuments`, `tales`, `managerTerms`,
  `watchTerms`, `roles.history`, `_inboxApplied`, `dangerZones`, journals, chronicle) and confirm each has a
  cap or a bounded lifetime. Flag every uncapped one as P1.

## System 8 — Baselines & the determinism harness  (`tests/determinism.mjs`)
Baselines were re-pinned this arc (`2adc7767/...` → `7d142951/...`). #23 flagged this.
**Verify:** identify EXACTLY which commit(s) legitimately changed the sim (candidates: `5b67386` health,
founding election, war doctrines, names) vs. any change that was claimed display-only but actually moved a
hash. Is the CURRENT baseline reproducible from a clean `boot(seed)` (no hidden wall-clock/order dependence)?
Should the harness snapshot MORE fields (roles, monuments count, inbox-ledger length) to catch the classes
above that the current digest can't see?

---

## Adversarial harness to actually RUN (don't just read)
```
node tests/determinism.mjs                      # same-twice for all four seeds
node -e "…boot(seed); tick to mid-<event>; serialize; fromSave; assert state survived"   # FM-A repros
node -c farm.js && node -c main.js && node -c save.js && node -c reconciliation.js && node -c worldmap.js
```
For each of Systems 1–5, script a **save-mid-flight → reload → assert-outcome-survived** probe and a
**back-to-back-event** probe — the two probes that caught the raid P0s. A system that has no such repro
because it applies everything synchronously is a PASS; say so explicitly.
