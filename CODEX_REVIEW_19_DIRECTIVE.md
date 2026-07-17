# Codex Review #19 — verify r18 fixes (Hatch House #100 + stale-tab cost safety #101)

**Repo:** `/Users/ryanhaigh/ry-farms` (public remote `github.com/heyhaigh/farm-sim`). Pure ES-module farm sim, no build.
**What to review:** the current **uncommitted working tree vs `HEAD` (`49f1ad1`)**:

```
git diff HEAD -- farm.js main.js memory-writeback.js pixel.js
```

This is a **re-review**. Round 18 found 1 P0 + 2 P1; all three have been fixed in the working tree. Your job: (1) **confirm each of the three is actually resolved** and the fix introduced no regression, then (2) do a fresh adversarial pass over the whole diff for anything new. Return findings ranked **P0 → P1 → P2** with `file:line` + a concrete failing scenario. If clean, say so explicitly per batch.

---

## The three r18 findings — verify each is closed AND regression-free

### 1. (was P0) Hidden-tab guard only checked before the first await — `main.js` `tryPersist`
**Fix applied:** a `const stillActive = () => !document.hidden && world === w;` guard is now re-checked after each `await` — after `persistLives` (before `persistTownHistory` + `enrichInventions`) and after `enrichInventions` (before `persistTownInventions`).
**Verify:** background the tab (or swap the town) at each await boundary and confirm NO later paid op (`persistTownHistory`, `enrichInventions`, `persistTownInventions`) starts. Confirm the `world === w` half also correctly aborts on a town swap mid-flight. Any remaining await after which a paid call runs without a recheck?

### 2. (was P1) Fixed-prefix truncation starved later farmers — `memory-writeback.js` `persistLives`
**Fix applied:** added module state `writeAttemptGen: Map<seed, pass#>` + `writeGen`. `pending` is now sorted by least-recently-submitted (`writeAttemptGen.get(seed) ?? -1`, seed tiebreak) BEFORE the `MAX_PER_PASS` cap; the chosen are stamped with the new `writeGen` (on attempt, not just success).
**Verify:** with farmers 0–3 acquiring new journal entries every pass, confirm farmer 4+ now eventually get submitted (round-robin progress, no permanent starvation). Confirm stamping on *attempt* (not success) is correct when the store is offline — does any farmer get skipped indefinitely? Confirm `writeAttemptGen` growth is bounded/harmless (it's keyed by a fixed farmer set). Does the sort + stamp interact correctly with the existing `sig`/`lifeSig` change-gate and the success-stamp (`f.sheet.lifeSig = sig`) further down?

### 3. (was P1) Helper funded requester's mill/hatch/tend from the helper's own stash — `farm.js`
**Fix applied:** new `#plotOwner(plot)` (returns `this` for own plot, else `world.farmers.find(f => f.plot === plot) || this`). Resources now route through the OWNER:
- `#wheatOnHand(who = this)` / `#spendWheat(n, who = this)` take a target farmer.
- Eligibility: `#millToWork`, `#wantsToHatch`, `#hasFeedFor(p, plot)` check the OWNER's wheat/eggs/grain/feed.
- Completion (`#completeWork`): `mill` grinds the owner's wheat → owner's grain; `hatch` spends the owner's eggs; `tend` consumes the owner's feed good. `owner` = `helping ? this.helpTask?.requester : this` (unchanged, line ~8779).

**Verify:**
- A helper with eggs/grain/wheat working a requester's plot no longer spends the helper's goods; the requester's stores fund and receive everything; chicks/grain land in the requester's facilities.
- Eligibility and completion resolve the SAME owner. `#plotOwner(plot)` (via `world.farmers.find`) during eligibility vs `this.helpTask?.requester` during completion — are these guaranteed identical for a help task? Any case where `#nextTaskOnPlot` is called with a plot whose `#plotOwner` ≠ the help requester (e.g. a communal/ownerless plot → fallback `this`), causing a check/spend mismatch or a spend against the wrong farmer?
- Own-plot behavior must be byte-identical (that's why the determinism baselines didn't move) — confirm `#plotOwner(this.plot) === this` and `who = this` defaults preserve the old path exactly.
- I removed the now-unused `const s = this.sheet` from `#completeWork` — confirm no case still referenced it.
- **Determinism check:** `#plotOwner` uses `world.farmers.find(...)` inside the SIM. `farmers` array order is stable/seeded and each plot has one owner, so `find` is deterministic — confirm there's no unstable iteration or unseeded randomness introduced.

---

## Invariants (unchanged from r18 — must still hold)
1. **Determinism**: seeded rng only, stable sorted iteration, no `Date.now()`/`Math.random()` in sim (`farm.js` sim paths, `pixel.js`); `Date.now()` allowed only off-sim (`memory-writeback.js`, `api/*`). Harness `tests/determinism.mjs` pins `{20260706:'19d53747', 42:'bc8b8504', 7:'2b9d51b5', 3:'2ce57075'}`.
2. **Compile-don't-query**: the seeded world never reads LLM/SuperMemory output back into sim state.
3. **Fail-closed cost safety**: a hidden tab costs $0; `tests/llm-chokepoint.mjs` — no model endpoint outside `api/_llm.js`.

## What I verified locally (confirm independently)
- `node -c` clean on all files.
- `node tests/determinism.mjs` → all 4 seeds self-compare identical, baselines unchanged (own-plot path unaffected, as expected).
- `node tests/llm-chokepoint.mjs` → intact.

## Output
Per finding: `P0/P1/P2 — file:line — defect — failing scenario → wrong result`. Then: are r18's three findings **RESOLVED**? Any NEW findings? One-line verdict per batch (#100 / #101 ship-ready?).
