# Codex Review #38 — Ry Farms: THE PUSH GATE (final pre-deploy review, hackathon deadline in hours)

**Repo:** `/Users/ryanhaigh/ry-farms` — the FULL absolute path (NOT `~/Documents/ry-farm`, which is a stale
unrelated repo Codex has wandered into before). HEAD `1d62f1c` on `main`, remote `github.com/heyhaigh/farm-sim`.

**Scope:** `git diff 064977c..HEAD` — **26 commits**. #36 reviewed the first 13, #37 the next 5 and their
fixes landed in `ec7c345`. **Focus on the SIX commits since:**
- `e160322` ONE BEAT — a mid-fight authored moment in the focus duel (stunt shove/taunt + bark; LLM
  `phase:'beat'` via raidcouncil.js `requestDuelBeat`, enum-validated, authored BEAT_BARKS fallback;
  `world._duelBeat` consumed at the duel's midpoint inside `#duelExchange`).
- `ec7c345` the #37 fixes — VERIFY: (1) Inscription waits for `!activeCallout` too; (2) `wipeSave` sets
  `world._retired = true` and every save path (whisper callback, saveOnHide, autos) refuses retired worlds;
  (3) crossing stage-1 hint requires the camera centre in unrevealed dark; (4) `_warCard` stripped from
  serialized pendingRaid.
- `9c65faf` Crossing v3 — the consent ladder's first sign is now WORLD-ANCHORED fog text+arrow
  (`drawFogMarkers`, drawn only over unrevealed tiles), thresholds from `crossThresholds()`
  ({marker R+10, warn max(70,R+30), cross max(95,R+52)}); warn banner needs camera centre in dark.
- `08374b0` Settings NEW TOWN removed (founding lives in the world-map CREATE TOWN; `RYFARMS.wipeSave`
  keeps the `_retired` guard).
- `b637134` **livestock pens** — the meat of this review:
  * farm.js `FACILITY_DEFS`: coop 4x4 / pen 5x4 / sheeppen 4x4, `penned: true`.
  * `#tickProducers`: land animals now clamp to `p.region` (pond-life treatment) with an old-save
    fallback to the plot bbox when `p.region` is missing.
  * `#nearestYardTile(plot, fx, fy, region)` — rescue stays inside the pen; both call sites pass
    `pr.region`.
  * `#rebuildFields` excludes all facility-region cells (crops never grow in a pen).
  * `#findFacilityRegion` now rejects overlap with EXISTING facility regions (mills/hatcheries used to
    land INSIDE the chicken run because pen interiors are plain grass).
  * main.js render pass: inner pen fence (posts + rails via the existing helpers) around each penned
    facility with a deterministic gate gap on the house-facing side + a trampled ground wash
    (`PEN_WASH`), pushed at `y: topSy - 999` so it draws under local entities. Render-only.
  * pixel.js: `[` `]` glyphs added to FONT (the raid marquee's `[W]` hint drew as `?W?`).
  * **Determinism deliberately re-pinned** to `b99cfce8 / cb7b50c8 / da0a209c / aebbd12e` (bigger
    footprints + pen exclusion legitimately shift the trajectory; same-twice verified pre- and
    post-re-pin; raid-adversarial green).
- `0783ba7` orc-vs-orc raids — raiders stamp `art: k % 2 ? 3 : 2` at spawn (plain k parity, NO rand,
  rides only the never-serialized `raidEvent`); drawThreat swaps to `orc2/orc3_idle_with_shadow` sheets
  ONLY when `world.culture === 'orc'`; muster figures carry the same parity; orc TOWNSFOLK scaled
  26px → 34px (`orcCharSets` targetH).

**Two commits landed AFTER this directive was first drafted — review them with the same weight:**
- `aa09ab7` **Kimi-K3 review fixes + battle HP bars** — an independent Kimi-K3 model review found 4 P0s,
  all verified against the full code and fixed: (1) `re.record` = an UNCAPPED battle log feeding the
  SuperMemory doc (display `re.fx` keeps its 64-cap; compiler reads `re.record || re.fx`); (2) the march
  timer is now COMPUTED from the initiative (`14 + totalExchanges * kick*3`, cap 80) — the flat 34s
  decapitated 5-6-duel battles; (3) main.js `_battleWatch` compiles on raidEvent POINTER CHANGE (a second
  raid landing over a live cinematic used to orphan the displaced record); (4) `startRaidRehearsal`
  refuses while a real pendingRaid/raidEvent is live. Plus: displaced un-ended nemesis arcs archive as
  'eclipsed'; duel rolls keyed per raider index; counsel lands only for its own telegraph (identity
  check). HP BARS (player): defenders show their real hp bar force-visible while `raidEvent.struck` and
  in muster/_skirmish; raiders carry `_dhp` (init 1 at duelsAssigned, chunked -0.28/-0.34 on
  HIT!/STAGGERED! taken, floor 0.15, zeroed on FELLED incl. the overrun path) drawn in drawThreat.
  CHECK: `_dhp`/`record` ride only the never-serialized raidEvent; the pointer-change compile can't
  double-compile or compile a never-struck re; the booth-refusal return value (false) is handled by the
  admin panel gracefully.
- `1d62f1c` **THE FARMYARD** — player-reported: facilities were mashed mid-crops. `#findFacilityRegion`
  now scores ALL candidates: adjacency to the farmstead cluster (house rect via `#houseRect` or an
  existing facility, `#rectGap` <= 1) wins as a TIER, nearest-to-house first, cropped tiles claimable at
  +0.6/crop score; `#buildFacility` clears claimed crops; `#rebuildFields` keeps crops a full tile off
  every region; `yardV: 1` save marker + ONE-TIME `#reflowFacilities` migration on pre-yard loads
  (`#moveFacility` moves struct/trough/producers, re-carves pond water, upgrades legacy 3x3 pens to the
  new defs where they fit, falls back to current footprint on ribbon plots, re-seats stranded animals).
  CHECK: reflow idempotence (a reflowed save re-saves with yardV and never reflows again); move
  correctness for ponds (old water fully cleared, no orphan lily/fish regions); `this.crops.delete`
  during restore can't corrupt the crops Map mid-iteration; determinism re-pinned
  (`850c5016/43db4bf8/dbd713b3/eda6bec6`) — confirm same-twice; the migration was verified against a
  copy of the live day-71 save (17 facilities clustered, 0 escapees, 0 crops within a tile of a pen).

**Intent: push all 26 to the live repo immediately after this review.** Rank ruthlessly: P0 =
determinism/ghost break or push-blocker; P1 = fix before push; P2 = note. Player has browser-verified:
pens (chicken run + sheep fold, containment probes clean), orc-vs-orc raid on an orc town (distinct
tribes), the full raid cycle, the portal war sheet.

## Doctrines: determinism baselines now `850c5016 / 43db4bf8 / dbd713b3 / eda6bec6` (re-pinned in
`b637134` then `1d62f1c` — confirm same-twice from the harness, and that `aa09ab7` left them unchanged); compile-don't-query;
the booth's ghost contract.

## Priority checks
- **A. PEN CONTAINMENT vs OLD SAVES.** A pre-pen save deserializes producers with `region` re-attached
  from the fac rect (deserialize maps `region` over each producer) — so old 3x3 facs get 3x3 clamps.
  Confirm: (1) no path leaves `p.region` undefined post-load; (2) the bbox fallback in the wander clamp
  can't fight `#producerCanStand` into an infinite reverse loop on a fully-blocked pen; (3) `#nearestYardTile`
  with a region on a fully-blocked region returns null and the animal stays put without NaN.
- **B. PEN PLACEMENT.** `#findFacilityRegion` overlap rejection: confirm the scan can still place ALL of a
  farm's preference list on a max-size plot (5x4 pen + 4x4 coop + 4x4 fold + 3x3 mill + 3x3 hatchery + pond)
  or degrades gracefully (facility simply not built, intent retried later — no tight retry loop burning rand).
  Also `#rebuildFields` excluding facility regions: any farmer state that assumed a field could exist there
  (planted crop BEFORE the facility was built on the same save — the region scan requires crop-free tiles,
  but a crop planted between intent and build?).
- **C. PEN RENDER.** The pen fence pass runs per-frame per-facility: posts/rails pushed into the y-sorted
  list (bounded — ~40 drawables per pen), the wash at `topSy - 999` — confirm no z-fight with the
  terrain layer or the raid seam, and gate math (`w >> 1` etc.) is stable for even/odd sizes.
- **D. ORC VARIANTS.** `art` stamped in `#stageRaidCinematic` — confirm rehearsal (ghost) raiders get it
  identically, `drawThreat` falls back to orc1 until the variant sheet loads, and the variant does NOT
  apply to human towns (world.culture check). The 34px townsfolk: `orcCharSets` output canvases are
  cached per farmer (orcCharCache keyed by farmer object) — confirm nothing else assumed 26px (roster
  rows, sheet portraits, boat/indoor crops of the farmer frame).
- **E. ONE BEAT.** `world._duelBeat` — set by the LLM callback (display-only), consumed once at the focus
  duel's midpoint, cleaned to null at raid end. Confirm a beat landing AFTER the duel resolved is dropped
  harmlessly, and the authored fallback can't double-fire the beat.
- **F. FONT.** `[`/`]` glyph rows are 15 bits, 3x5, consistent with the table (sanity: no glyph string
  length drift).
- **G. HARNESSES.** Run `node tests/determinism.mjs` + `node tests/raid-adversarial.mjs` + `node --check`
  on farm.js/main.js/pixel.js + `git diff --check`.

Report ranked findings with file:line + repro + fix. A clean pass is a valid outcome — say so plainly.
