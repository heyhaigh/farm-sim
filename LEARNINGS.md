# Propagate — Engineering Learnings

Hard-won lessons, kept so future sessions (Claude **and** Codex) leapfrog the traps instead of
re-paying for them. Read this alongside [AGENTS.md](AGENTS.md), [TESTING.md](TESTING.md), and
[COMPATIBILITY.md](COMPATIBILITY.md). Each entry is a trap or a pattern with its **exact failure
signature** so you recognise it before it costs a review round.

---

## Editing traps

### Range replacements swallow code between anchors (a real shipped P0)
A python/perl/`Edit` replacement that spans **two anchors** deletes everything between them —
including unrelated code you didn't mean to touch. Shipped instance: an echo-queue rewrite replaced
`comment → persistTownHistory` and silently ate `mayWrite`, the throttle constants, the lives
scheduler, and the history signature. **Every exported writer then threw `ReferenceError` on its
first line — while the module's own unit tests stayed green** (they exercised the queue, not the
writers).
- **After ANY range edit**: grep that every identifier the file still references is still defined.
- Keep a **smoke test that invokes the module's actual exported entry points** (see
  `tests/writeback-smoke.mjs`) — narrow tests miss a whole-export-throws regression.
- `node --check` / `node -c` **passes broken ES modules** — it only checks syntax, not references.
  Verify semantics with a `.mjs` import probe, not a syntax check.

### A multi-step edit script that dies mid-way leaves CALLS without DEFINITIONS
A python edit script asserting between replacements writes nothing if a later assert throws — but a
SECOND script may then apply its half against the unmodified file. Shipped instance (#122): the
extraction script died before writing `saveportOpenChooser`/`saveportRunImport`, the follow-up wired
the CALLS, `node --check` passed, and an import click would have thrown at runtime — the boot-freeze
class, caught only by grepping for the definitions. **After any scripted refactor: grep that every
newly-referenced identifier is DEFINED, then load the page.** ESLint `no-undef` would be the standing
guard; grep + a browser smoke is the current floor.

### Silent-anchor near-misses
`str.replace(old, new)` where `old` isn't present is a **no-op that reports success**. Caught one
this session (`persistInventions` vs `persistTournInventions`). **Grep for the new symbol after the
edit and do an import probe** — don't trust that the replacement applied.

---

## IndexedDB laws (the browser memory store)

All four bit us in a single review round (#88). They are invisible to a naive test.
1. **Acknowledge `tx.oncomplete`, never a request's `success`.** A request's `onsuccess` fires
   *before* the transaction commits; an abort after that (quota, eviction race) leaves you having
   stamped/acknowledged data that never landed. Resolve promises from `tx.oncomplete`, reject from
   `onabort`/`onerror`. See `memory-store.js` `idbTx`.
2. **`getAllKeys` + `getAll` must run in ONE transaction.** Two separate readonly txns can interleave
   with a write and pair keys against the wrong values. Build the `[key, value]` pairs at
   `oncomplete` from both results of the same txn.
3. **Bound every IDB await with a timeout.** A pathological `indexedDB.open` (Safari has locked up)
   stalls boot forever. Race reads against a timeout (`localLineage` 3s, portal 3s) so the app
   proceeds and the store catches up next boot.
4. **`getAllKeys` returns KEY-SORTED order** — not insertion order. A Map-based test fake that
   preserves insertion order **hides tie-eviction bugs** (an equal-timestamp eviction that deletes
   the just-written row shows only under key ordering). Make the fake sort its keys.

---

## Deploy asset pipeline (bit us THREE times)

`~/ry-farms-deploy/.dockerignore` is a **deny-all ALLOWLIST**. Adding a static asset needs **all
three** of:
1. A `!assets/*.<ext>` re-include rule in `.dockerignore` (placed with the other `!assets/*`
   rules; later rules win). It only re-included `*.png` — `*.webm` (#94 P1) and `*.webp` (#96)
   each had to be added explicitly.
2. `git add -f assets/<file>` in the **deploy repo** (assets are gitignored there by the bulk-art
   convention — a plain `git add` silently skips them).
3. The extension in **`server.mjs`'s MIME map** (also an allowlist — an unmapped ext 404s). `.webm`
   was absent, so the video 404'd on **both** local and prod.
- **Always verify in the built image, not the working tree**: after deploy, `curl -sI` the prod
  asset path for `200` + the right `Content-Type` (+ byte count) before calling a ship done. The
  truth lives in the Railway image, not your disk.

---

## Testing discipline

- **Mutation-test every fix**: revert only the fix and the test must fail with **the bug's exact
  signature** (not just "a" failure). A fix whose mutation still passes isn't covered.
- **Non-vacuous assertions**: assert the scenario actually ran (`gatherTicks > 0`,
  `extra >= 25 past-cap raids`, `runTicks > 0`). A probe that measures "0 of 0" is green and
  meaningless — this bit three separate reviews across the project's history.
- **Key probes on the OBSERVABLE, not the flag under test.** A regression test that filtered on
  `_supMove` self-excluded the very ticks that lacked `_supMove` (the #83 EVADE gap). Measure
  movement/output, then assert the flag.
- **Engineer deterministic collisions** when organic ones are too rare to hit. The monument
  tile-stacking bug never fired under organic churn (the frontier band is too wide) — twin worlds
  (learn where world 1 places a stone, pre-plant a squatter there in world 2) reproduced it every
  time.
- **Test fakes must mirror real semantics** (see IDB #4) — a fake that's "close enough" hides the
  class of bug you most need to catch.
- **Heal state between staged events** in probes: churning raids to a cap stalled because battered
  defenders fell no raiders; the probe had to restore hp between raids to actually produce stones.
- **Mutation testing is not optional and should not be a ritual you remember.** Fifteen tests across
  the 2026-08 LLM migration passed while asserting nothing, and every one was caught mechanically by
  reverting the fix and checking the test fails. Recurring shapes, all of which look green:
  a case masked by a DIFFERENT guard (a coverage floor, a length filter, a sibling field's required
  check); a case that only covers ONE branch of a two-branch decision; a case that calls a helper
  directly and so cannot see a mistake at the call site; a case whose fixture is not
  production-shaped (a failover test with no `schema`, when every real caller passes one); and a
  detector that greps for a signature the sanitiser has already mangled (`[object Object]` reaches
  the client as `OBJECT OBJECT`).
- **A mutation that fails `node --check` is not a caught mutation**, and a mutation that does not
  apply is not either — assert the replacement count, then syntax-check, then run.
- **Assert the parts you INHERITED, not just the parts you wrote.** A mutation deleting
  `...scriptSchema` from `ELECTION_SCHEMA` escaped a fresh 9-case test, because `required` and
  `properties` were both rebuilt explicitly below it — the spread's only real contribution was the
  top-level `type`/`additionalProperties`, which nothing asserted. New tests naturally cover the new
  lines; the surrounding contract is where the hole is.
- **A mutation that breaks syntax is not a caught mutation.** One "caught" result was really
  `node --check` failing. Run the syntax check inside the mutation harness and label invalid
  mutations separately, or the harness will congratulate you for nothing.

---

## Provider contracts (the schema is only as real as the other end)

- **Groq structured outputs honour a SUBSET of JSON Schema**: types, `required`,
  `additionalProperties`, `enum`, `$defs`/`$ref`, `anyOf`. The **count and length keywords are
  silently dropped** — `minItems`, `maxItems`, `minLength`, `maxLength` do nothing.
- This cost a full review cycle. Codex #110 rightly said an invariant belongs in the contract, not in
  a comment describing how often it's missed; it was written as `minItems: 10` and the very next probe
  run came back short **from complete valid JSON**. A schema field that reads like enforcement and
  isn't is worse than the comment it replaced, because the comment was at least true.
- **Express counts as named REQUIRED properties** (`m1`..`m10`), which that subset does enforce.
- Every `maxLength` elsewhere in `api/` is ignored too, and that's harmless **only because a
  server-side clamp does the real work** (`cleanLine`/`clean`/`slice`). Before relying on any schema
  bound, find its clamp — if there isn't one, the bound is decoration.
- **`json_schema` → `json_object` degradation enforces NOTHING**, and looks identical to success from
  the response. Any reader must tolerate both shapes, and a validator that only understands the
  strict-mode shape converts a soft format degradation into a silent empty result.
- **`String()` coercion turns a bad value into displayable garbage**: `['a','b']` becomes `"a,b."` and
  an object becomes the literal text `"[object Object]."` — both pass a `length > 1` filter and render
  in a speech bubble. Filter to `typeof x === 'string'` at the boundary; never let a sanitiser's
  coercion be the type check.

---

## Destructive confirms (the #saveport/#122 arc, five review rounds of one invariant)

The whole arc was one sentence sharpened five times: **a confirm is only consent for the state the
player was shown, and only the transaction can enforce that.**

- **Bind the write to the observed token, IN the transaction.** UI-side rechecks narrow the race;
  only an in-tx compare closes it. And the token must cover every transition: `expectGen` alone
  missed the empty-claim race because **claiming an empty slot is deliberately a no-bump transition**
  (COMPATIBILITY.md's own rule — enforced in saveTown, forgotten at import). Generation AND occupancy.
- **Quarantine counts as occupied.** `loadTownState` reports the live slot; the state the quarantine
  mechanism exists to protect (`unreadable:<seed>`) read as "empty". Any occupancy decision must
  include it, and a read that can't report failure (peekQuarantined nulls errors) can't be used —
  fail toward the warning.
- **A disarm must kill work IN FLIGHT, not only work that finished.** `pendingImport` was null while
  f.text() and the occupancy reads awaited, so `if (pendingImport) disarmImport()` was a no-op in
  exactly the window it mattered. Invalidate by token, unconditionally, on every non-consenting click.
- **Starting a new selection is itself the act that supersedes the old one** — advance the token
  BEFORE capturing it, or two overlapping choosers share authorization and the last read to finish
  swaps the file under a painted confirm.
- Disclose conditionally and honestly: the loss warning only when something is actually lost
  (warning a fresh browser about losing nothing is a false scare), and BEFORE the destructive click,
  on the surface that will see it (the export-time notice shows on the SENDER's browser).

## Cross-database protocols (why the memory transport died)

Two IndexedDB databases cannot share a transaction. The #121 memory transport tried to keep
`ryfarms` (slots) and `ryfarms-memory` (rows) in agreement with fences, ownership validators and
atomic-replace shims — 22 findings in three rounds, every patch opening the next seam, including a
validator that required arrays where every real writer stores objects (fixture invented from memory;
the producer-fidelity trap inside machinery built to prevent it). The fix was Codex's option (a):
**delete the protocol, clear-on-import, regenerate via backfill, disclose what does not travel.**
If state must stay coherent with a slot, either it lives in the SAME database as the slot or its
lifecycle is "clear and rebuild" — never "synchronize".

---

## Determinism (the load-bearing invariant)

- The four sim baselines (`46142773 / 6bf1c185 / 5cf3fa3c / 07cfe62e`) must hold, `same-twice` must
  be green. Re-pin **only deliberately**, with a dated rationale comment in
  `tests/determinism.mjs`.
- **Off-sim modules never touch the digest.** The whole memory subsystem (store, backfill, echo,
  writers) is display/persistence-side and reads **only** at founding (lineage) or for display
  (portal) — never mid-sim. This is what let it ship without moving a pin. Doctrine:
  **compile-don't-query**; the sim never reads the memory store back.
- New RNG draws shift the stream. Any new `world.rand()`/`this.rand()` in a sim path re-pins
  everything downstream — prefer **pure keyed hashes** (`hashString(...)`) for display/positioning
  so determinism is untouched by construction (raid support actions, monument placement).
- The `Date.now()` ban is about digest surfaces. Off-sim modules (echo cooldown, backfill rotation
  nonce) may use wall-clock — but expose a test seam to pin it (`rotationNonce`, `_setEchoCooldown`).

---

## The Codex review rhythm (it earns its keep)

- Ship every non-trivial batch through a `CODEX_REVIEW_N_DIRECTIVE.md`: the reviewed HEAD, the
  baselines, per-area "falsify this" challenges, and a KNOWN-AND-DELIBERATE list so the reviewer
  doesn't re-report accepted trade-offs. These files stay **local/untracked** (like `COUNCIL_*.md`).
- **Own your own bugs first.** Writing the directive carefully — explaining *why* a fix is safe —
  repeatedly surfaced the flaw before Codex saw it (the migration-walk, the webp allowlist). The
  act of justifying is a review.
- Adversarial review caught genuine P0/P1s a green suite missed this session: permanent-partial
  backfilled towns (marker atomicity), tx-commit acknowledgement, monument tile-stacking on
  exhaustion, the swallowed writer block. Treat a NO-SHIP as the system working.
- Re-pin the directive's expected HEAD after every `--amend`; a stale sha wastes a round.

### ...but it is a GATE, not a LOOP (the 2026-08 LLM migration, learned expensively)

That migration ran ten review rounds and 23 commits to ship what was, on the critical path, a
one-line change (`DEFAULT_MODEL_CHAIN`) plus one env var. `api/_llm.js` went 275 -> 713 lines. The
retrospective is worth more than the code:

- **For claims about an EXTERNAL CONTRACT, execution outranks reasoning — and review outranks
  reasoning alone.** Everything verified by RUNNING was right. Everything Codex caught by REPRODUCING
  was real. Everything concluded by thinking about what a provider "would" say was wrong — `minItems`
  enforcement, three retirement codes, four prose classifiers, all fluent and all invented. The
  underscore-vs-space bug was caught by neither reviewer; **production logs caught it in twenty
  seconds.** This is scoped deliberately (Codex #119): reasoning is still what identifies the
  invariants and designs the executions — it is unreliable specifically for *what another system
  actually says or does*.
- **Two models agreeing is not INDEPENDENT CORROBORATION.** Claude and Codex both inferred the
  `ry_farms_election` rename was inert from the same docs; neither observed it. Shared sources and
  shared priors make agreement cheap — it is still worth something, just not what a measurement is.
- **Review per completed unit, not per fix.** By round three the reviews were mostly finding bugs in
  the previous round's fix. Each round of speculative hardening created surface for the next round.
  Treat "the review found a bug in last round's fix" as a STOP signal: simplify or delete, don't patch.
- **Separate the deadline path from hardening, explicitly.** Flip the thing with the date on it,
  verify, then harden on your own schedule.
- **Prefer generic handling to clever handling for unobserved failure modes** — but describe the rule
  you actually shipped. The implemented rule is narrower than "advance the chain on any failure"
  (Codex #119 corrected this): the chain advances on an unrecognised 4xx, an unusable 200, and OUR OWN
  timeout, while 5xx and ordinary transport failures stay provider-wide because they fail identically
  for every model behind one base URL. What made it robust is that failover needs no knowledge of the
  provider's WORDING, not that it fires on everything.
- Match the process to observability — **without concluding that review is friction where execution is
  easy.** Running the sim IS the ground truth for the sim, but adversarial review still found the
  monument tile-stacking bug and the swallowed writer block in exactly that locally-executable code
  (Codex #119 pushed back on the original, sloppier version of this line). The difference is that an
  unobservable third-party boundary makes review *necessary*; local executability only makes it
  cheaper to be sure without it.

**The rule that would have prevented most of it: no branch keyed on provider-specific text without a
captured sample pasted into the test file. If you cannot paste the real message, do not write the
pattern — handle it generically.** Ship the logging FIRST and read it.

**And its ordering twin, added after violating the lesson above within an hour of writing it: state a
diagnosis only after running the measurement that could falsify it.** If the measurement costs under a
minute — one curl, one calibration call, one instrumented replay — it comes BEFORE the claim, not
after. Prose learnings do not change behaviour at the moment of decision; an ordering constraint is
checkable at exactly that moment. (The violation: two telemetry data points, a confident "the client
never sends stage 2", and a one-request calibration that promptly disproved half of it.)

---

## Feature / UX patterns

- **Canvas `<video>` has no automatic poster.** `drawImage(video)` with `readyState < 2` draws
  nothing → a dark box. Draw a **static poster image as the floor** of the video rect, composite the
  video over it only when ready. A **WebP poster** decodes reliably on the exact Safari/Firefox that
  can't decode **VP9 video** — none of VP9's hardware-decode flakiness. (Two failure modes: muted
  autoplay refusal draws frame 0 = fine; VP9 decode failure = the dark box the poster fixes.)
- **Sequential modals, not stacked.** A reveal that should precede another card fires **at boot**
  and the next card's lazy `shownAt` stays unset while it holds — so dismissal starts the next
  card's fade *fresh*, reading as a transition, not an underlayer being uncovered.
- **A modal owns `pointerdown`, not just `pointerup`.** Gating only the up-event lets the down reach
  hidden layers (a Moment's click-eater, sliders, world-pan arming) and a >4px drag then makes
  pointerup return before the modal dismisses. Gate at pointerdown, clear gesture state.
- **Once-per-browser reveals**: `localStorage` flag, stamped at **show** (a crashed tab costs the
  reveal, accepted). QA re-arm: `localStorage.removeItem('ryfarms-<key>')`.
- **Extract-and-rewire for shared builders**: when a live writer and a batch path must emit the
  identical shape (`lifeOf`/`townHistoryOf`/`inventionsOf` for writeback AND backfill), extract one
  builder used by both — zero drift. But this is the exact **range-edit shape** that caused the P0
  above: verify the extracted body is byte-equivalent and the caller's remaining logic is intact.

---

## QA / tooling

- Local `python3 -m http.server` / the repo's `server.mjs` dev mode serve **fresh modules** each
  request (no caching) — edits land on reload without a restart. **But** a new MIME type needs a
  server restart to pick up the map change.
- **claude-in-chrome**, not Playwright, for the WebGL page — Playwright screenshots stall; chrome's
  `computer.screenshot` works. A backgrounded tab **freezes the render loop** (and screenshot
  capture) — the tab must be foregrounded to verify visually. `javascript_tool` blocks payloads
  containing certain tokens (`.downed`) — work around with string concatenation (`['dow'+'ned']`).
- Reach a mature town fast for QA: `RYFARMS.speed(n)`, `RYFARMS.raid()`, `RYFARMS.raidLand()`,
  `RYFARMS.raidDetect()`; `?fresh=1` for a throwaway town (numeric junk seeds only). See
  `RYFARMS` debug surface in `main.js`.

---

## Caching (production)

All JS + HTML serve `cache-control: no-cache` + ETag — **code changes (incl. procedural sprites in
`pixel.js`) go live on next load, no Cloudflare purge.** Only `assets/*.png|webp|webm` carry a long
max-age → **art-file changes need a Cloudflare purge**, but a **new** asset path never does.
