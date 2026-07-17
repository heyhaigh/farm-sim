# Codex Review #39 — Ry Farms: POST-FIX re-check of the #38 findings (push gate, hackathon deadline)

**Repo:** `/Users/ryanhaigh/ry-farms` — the FULL absolute path (NOT `~/Documents/ry-farm`, a stale unrelated
repo). Branch `main`. **NOTE: history was rewritten since #38** (see finding #2 below) — the SHAs `064977c..HEAD`
changed. A backup of the pre-rewrite branch exists at `backup-pre-cleanup-2f078d7`, and `.git/refs/original/`
holds filter-branch's automatic backup.

**Context:** #38 returned HOLD with 2 P0s + 2 P1s + 2 P2s. All six are addressed in one code commit
(`Codex #38 fixes: retire-guard, reflow overlap/legacy, duel-beat keying, booth feedback`) plus a history
rewrite for the payload P0. **This review VERIFIES those six fixes and the rewrite** — nothing else changed.
Scope: `git diff 064977c..HEAD` (28 commits; the base `064977c` is unchanged/pre-session).

## The six #38 findings and how each was addressed — verify each

1. **[was P0] Wiped town recreated by ordinary save paths.** FIX in `save.js` `saveTown()`: a centralized
   `if (world._retired) return null;` at the TOP, a second check INSIDE the transaction (`g.onsuccess` sets
   `retired = true` and skips the `put`; `tx.oncomplete` resolves `!ahead && !retired`), and a post-await
   `if (world._retired) return null;`. VERIFY: `await RYFARMS.wipeSave()` then `await RYFARMS.saveNow()`
   leaves `town:<seed>` deleted; a wipe landing mid-transaction can't slip a put past the in-txn guard;
   the guard covers autosave, saveNow(), and late whisper/debrief callbacks (all route through saveTown).

2. **[was P0] Bloated commit (1,690 files / 1,604 binaries) + full-range whitespace gate failed.** FIX:
   the payload (`component-library/` icon pack — confirmed NOT referenced at runtime, only in a main.js
   comment and its own self-contained `component-library/index.html`; `.agents/` `.claude/`
   `skills-lock.json` personal skill config; `.council-*.md` + `KIMI_REVIEW_PACKET.md` review scratch) was
   purged from ALL session commits via `git filter-branch --index-filter` over `064977c..HEAD`, and added
   to `.gitignore`. VERIFY: `git ls-files | wc -l` is now 112 (was ~1690); `git ls-files | grep -E
   'component-library|\.agents|\.claude|skills-lock|\.council|KIMI_REVIEW'` is EMPTY; `git diff --check
   064977c..HEAD` PASSES (the only prior offenders were the 4 `.council-review*.md` files); the working
   tree still has the files on disk (untracked + ignored) so nothing local broke; the actual game files
   (index.html, farm.js, main.js, pixel.js, audio.js, crt.js, dna.js, save.js, server.mjs,
   memory-graph.html, api/, tests/) are all still tracked. CONFIRM no game/runtime file was lost in the
   rewrite and the determinism baselines are unchanged by it (they are content hashes of the world, not git).

3. **[was P1] Farmyard migration froze legacy/overlapping facilities.** FIX in `farm.js`
   `#reflowFacilities`: a facility is only left in place if `home.has(fac) && !isLegacy(fac) &&
   !overlaps(fac)`; otherwise it relocates (def-size first, current-footprint fallback). `isLegacy` = size
   differs from `FACILITY_DEFS[type]`; `overlaps` = rect-intersects a sibling. VERIFY: a legacy 3x3 coop
   overlapping a mill near the house now relocates on the one-time `yardV` migration; a proper right-sized
   non-overlapping yard facility is still left alone (no churn); no infinite loop (each facility considered
   once; moves reduce overlaps for later ones). This path runs ONLY on pre-`yardV` saves via fromSave, so
   it never runs headless — determinism baselines unaffected. Was verified against a copy of the live
   day-71 save previously; re-confirm the logic.

4. **[was P1] Async duel beat could attach to the wrong raid.** FIX: `raidcouncil.js` STAMPS the beat with
   its raid id (`rid = pr.e.id || pr.e.pairKey+':'+pr.e.ordinal`) and only assigns `world._duelBeat` if
   that id equals the CURRENT raid's id (no more `|| world.raidEvent` accepting any active raid); `farm.js`
   `#duelExchange` only plays a beat whose `rid` matches the live raid's `rid`; `#stageRaidCinematic`
   clears `this._duelBeat = null` so a stale beat never carries into a new raid. VERIFY: raid A's late
   response cannot bark at raid B's focus duel; the seeded house beat still carries when no valid beat.

5. **[was P2] Admin raid refusal closed the panel silently.** FIX in `main.js`: the handler only sets
   `settingsOpen = false` when `startRaidRehearsal()` returns truthy; on `false` it sets a transient
   `adminNote` ("A REAL RAID IS UNDER WAY - REHEARSAL HELD") rendered in the settings panel. VERIFY: the
   panel stays open with the note on refusal; normal staging still closes it; `adminNote` is display-only.

6. **[was P2] Demo script claimed 5-6 duels; party caps at 4.** FIX: `DEMO_SCRIPT.md` now says the party
   caps at 4 (matches `farm.js` `const n = Math.min(4, 2 + Math.round(commit * 4))`).

## Doctrines (unchanged): determinism baselines `850c5016 / 43db4bf8 / dbd713b3 / eda6bec6` (seeds
20260706/42/7/3), same-twice + pinned — confirm from the harness; compile-don't-query; the ghost contract.

## Priority checks
- Re-confirm the two former P0s are genuinely closed (retire guard covers EVERY save caller incl. the
  concurrent-wipe race; the tree/history carry none of the purged payload and the full-range gate passes).
- Run the full battery: `node tests/determinism.mjs`, `node tests/raid-adversarial.mjs`, `node --check` on
  farm.js/main.js/pixel.js/raidcouncil.js/save.js, `git diff --check 064977c..HEAD`.
- Sanity: the rewrite didn't drop a tracked game/API/test file (diff the tracked file SET pre/post against
  `backup-pre-cleanup-2f078d7` minus the intentionally-purged paths).

**Intent: push immediately if this passes.** Rank ruthlessly; a clean pass is a valid outcome — say so plainly.
