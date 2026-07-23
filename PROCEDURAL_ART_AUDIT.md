# PROCEDURAL_ART_AUDIT.md — every live procedural sprite, graded

Companion to `PROCEDURAL_ART.md` (the rulebook). Grades: A (meets the CraftPix bar),
B (minor drift), C (clearly below bar), D (multiple rule failures), F (fails the rule
outright). `n/a` = rule doesn't apply. Audit date 2026-07; sources: `pixel.js`
builders + `main.js` draw sites.

## Live-vs-dead inventory

**PRIMARY** (the shipped look — no sheet version exists, always on screen when relevant):
`makeFencePost`, `makeCoop`, `makeBarn`, `makeMill`, `makeHatchery`, `makeTrough`,
`makeToolshed`, `makeWindmill`, `makeTower`, `makeLilyPad`, `makeFish`,
`makeLantern`, `makeCropSprites` (primary for the **withered** stage of every crop,
all stages of **beanstalk** — no `CROP_FRAMES` entry — and the carried-produce icon
for carrot/wheat), plus the `main.js` good icons (`makeEggIcon`/`makeMilkIcon`/
`makeWoolIcon`/`makeTruffleIcon`/`makeGrainIcon`/`makeCarrotIcon`; `GOOD_ICON.fish`
and `.lily` reuse `makeFish`/`makeLilyPad`). The 3×5 bitmap font is primary UI.

**FALLBACK** (drawn only until local sheets finish loading — briefly at boot, or if an
asset 404s): `makeFarmerSprites` (swordsman parts / orc sheets supersede),
`makeHouse` (yurts/cottage), `makeWell` (exterior.png well), `makeBoard` (guild-hall
board), `makeScaffold` (crate sheet), `makeTree` (animated sheet → static sheets →
procedural, 3rd in line), `makeStump` (Broken_tree sheets), `makeWildWheat` (ferns),
`makeWildFlowers` (bushes), `makeChicken`/`makeCow`/`makePig`/`makeGoat`/`makeSheep`
(farm-animal walk sheets). `producerSprites.fish` is the one producer with **no**
sheet — fish stays primary.

**DEAD** (exported from `pixel.js`, imported nowhere — candidates for deletion or
revival, not audited): `makeSign`, `makeFallenLog`, `makeBush`.

## Grades

| Sprite (cell) | Role | Palette | Proportion | Outline | Light | Detail | Iso-fit | Anim | Worst specific issues |
|---|---|---|---|---|---|---|---|---|---|
| makeCoop (24×22) | PRIMARY | C | **F** | D | C | C | **F** | n/a | 24 px wide inside a 4×4-tile (~80 px) pen — reads as a toy; 2 shades/material, multiply-darkened; no outline, no cast shadow; roof has zero left/right light split |
| makeBarn (30×26) | PRIMARY | C | **F** | D | C | D | **F** | n/a | Smaller than the farmer's cottage (104×95) and barely 1.4× the farmer; the door "X" is dead code (fillStyle set, nothing drawn); flat `#b85040` walls (2 shades); no shadow |
| makeMill (26×26) | PRIMARY | C | **F** | **F** | C | C | **F** | n/a | Uses `ctx.arc()`+`stroke()` for the millstone — anti-aliased half-alpha edge pixels, the only AA violation in the game's pixel art; also undersized for a 3×3 region |
| makeHatchery (24×22) | PRIMARY | B | **F** | D | C | B | **F** | n/a | Best palette of the four facility buildings (warm planks, egg glints) but same toy scale, no outline/shadow |
| makeToolshed (26×24) | PRIMARY | D | D | D | D | D | C | n/a | Flat single-color walls + roof (2 flat fills), tools are 1-px sticks; no light split at all |
| makeWindmill (28×34) | PRIMARY | C | D | D | C | C | C | **F** | 2 frames (X/+) at 350 ms strobes instead of rotating (rulebook wants 4f @ 8–10 fps); tower is a flat rect, blades pure `#e8e0d0` planes |
| makeTower (18×32) | PRIMARY | D | C | D | D | D | C | n/a | 4 flat fills, no stone courses, no shading on the shaft, gold orb is a plain rect; no shadow |
| makeTrough (12×6) | PRIMARY | C | A | C | C | B | A | n/a | Right size; feed is 2 flat colors, no end-cap shading, no AO line |
| makeFencePost (4×10) | PRIMARY | C | A | B | D | C | A | n/a | The single most-drawn sprite in the game: 2 colors, no lit left edge, no top cap highlight — reads as a brown stick at 1× |
| makeLilyPad (14×12) | PRIMARY | B | A | B | B | B | B | A | Decent 3-shade pad + rim; bloom highlight fine; missing a 1-px water-contact dark ring so it floats on the pond at 1× |
| makeFish (8×5) | PRIMARY | B | A | C | B | B | A | A | Reads well; eye + body share 1-px scale, could use a belly light row; no dorsal shade step |
| makeLantern (6×8) | PRIMARY | A | A | B | B | A | A | n/a | Closest to bar of all primaries — hot core → amber → rim ramp is right; only the handle lacks a shade step |
| makeCropSprites (12×14) | PRIMARY (withered + beanstalk + carrot/wheat icons), else fallback | B | B | B | B | B | B | n/a | Solid stage work; withered husk is a 3-color mush at 1×; `beanstalk` hits the generic wheat `default` branch — the one crop with NO bespoke ripe art is the one that never gets sheet art; soil mound ramp is good |
| Good icons (16×16, main.js) | PRIMARY | B | A | B | B | B | n/a | n/a | Egg/milk/wool/truffle/grain/carrot read fine in slots; wool and milk are near-monochrome (2 close greys) |
| makeFarmerSprites (16×20) | fallback | B | A | B | B | B | A | B | Good bones (seeded heads/hair/eyes); `shade()` multiply ramps only; shirt/pants flat 2-step |
| makeHouse (34×30) | fallback | C | D | D | D | C | B | n/a | Roof is ONE flat color (the farmer's hatColor — arbitrary hue vs the measured 5-step ROOF-RED ramp); 34×30 vs the 104×95 cottage it stands in for (−70% pop-in rescale) |
| makeWell (20×22) | fallback | C | C | C | C | C | B | n/a | 20×22 vs sheet well ~29×29; water is 1 flat `#2c4a6a`; stone 2 shades |
| makeBoard (26×22) | fallback | B | B | C | C | B | B | n/a | Passable; notes+tacks nice; cork/frame ramp is multiply-flat |
| makeScaffold (24×22) | fallback | D | B | D | D | **F** | B | n/a | 2 flat browns, abstract rects — doesn't read as anything at 1×; crate sheet mercifully replaces it |
| makeTree (16×22) | 3rd-line fallback | B | **F** | B | A | B | B | n/a | `canopyBlob` is rulebook-correct shading (only builder with a real hue ramp via TREE_LEAF); but 16×22 vs the ~47×59 sheet tree = massive pop-in rescale (P12 fail) |
| makeStump (12×10) | fallback | B | B | B | A | B | A | n/a | Good AO + root flare; fine |
| makeWildWheat (12×12) | fallback | B | C | B | B | B | B | n/a | Nice fan construction; half the size of the ferns it stands in for |
| makeWildFlowers (12×10) | fallback | B | C | B | B | B | B | n/a | Good bloom variety; same undersize-vs-bush issue |
| makeChicken (9×9) | fallback | A | A | B | A | A | A | B | Comb/wattle/beak all read at 9×9 — the reference-quality procedural sprite |
| makeCow/Pig/Goat/Sheep (14×11) | fallback | B | C | B | B | B | A | B | Shared quadruped is solid (far-leg darkening, spine light); 14×11 vs the bull sheet's 27×21 (undersized ~50%, visible for the boot seconds) |

Cross-cutting failures (apply to nearly every builder):

1. **`shade(hex, f)` multiply ramps everywhere** — no hue shift; the reference's
   defining trait (warm light → cool shadow) is absent from all primaries except
   `TREE_LEAF`. (Rulebook §1.2.)
2. **No cast shadows on any procedural building** — coop/barn/mill/hatchery/
   toolshed/windmill/tower all float; every CraftPix neighbor has a baked
   `~0.3-alpha` ground ellipse. (§4.4.)
3. **No outlines on props/buildings** — silhouettes bleed into terrain at 1×. (§3.)

---

## PRIORITIZED FIX LIST

Ranked by (player-view impact × distance from style bar). "Quick win" = one sitting,
no layout changes; "refactor" = new dimensions and/or draw-site anchor updates.

1. **Facility buildings: `makeCoop`, `makeBarn`, `makeHatchery`, `makeMill` — redraw at 42–60 px with ROOF-RED/PLANK ramps, outlines, cast shadows.** *(refactor — new cell sizes touch only the sprite + its centered anchor)* — Permanent fixtures on every developed farm, sitting directly beside sheet-art houses and animals; currently the single loudest quality gap in the player's view.
2. **`makeMill` AA millstone: replace `arc()`/`stroke()` with stepped fillRect rings.** *(quick win — can land inside fix 1)* — The only anti-aliased pixels in the sprite set; visibly fuzzy under the CRT shader.
3. **`makeWindmill`: 4-frame blade rotation @ ~9 fps + shaded tower; `makeTower` + `makeToolshed`: stone/wood ramps, light split, shadows.** *(windmill anim = quick win; redraws = refactor)* — Town-plaza landmarks every player pans past; the 2-frame strobe is the most noticeable motion flaw in the game.
4. **`makeFencePost`: 4-shade wood ramp, lit left edge, top-cap highlight, AO base pixel.** *(quick win — 4×10 px, zero layout risk)* — Drawn hundreds of times per screen; the cheapest total-screen-quality purchase available.
5. **Withered crop stage + beanstalk ripe art in `makeCropSprites`.** *(quick win)* — These are the crop states with NO sheet art ever, so they're the permanent look of drought/neglect and of an entire crop type; bespoke drooping-pod beanstalk + per-type withered tint.
6. **Pond pair `makeLilyPad`/`makeFish`: water-contact dark ring, one extra ramp step each.** *(quick win)* — Primary art on every water garden; small polish closes it to bar.
7. **`makeTrough` + good icons (wool, milk): one more shade step + AO.** *(quick win)* — Minor, visible in pens and inventory daily.
7b. **`drawMonument` (legend memorial stones, in `main.js` ~2503): rework to the STONE ramp + ashlar-lite form (lit-left / shade-right edges, contact AO, a couple of block-tone variations) and a hue-shifted gold-plaque ramp.** *(quick win — ~12×19 px procedural prop, flat literal colors today, no RAMPS)* — A LASTING landmark placed where each raider falls, so it accumulates across a war and sits permanently on the battlefield; player pans past it often. **NOT** the guardian statues (`statue1/2/3`) — those are CraftPix PNG assets already at bar, out of scope.
8. **Fallback size parity: `makeTree` → ~44×56, `makeHouse` → ~3-tier 60–90 px with ROOF-RED ramp, `makeWell` → ~28×28, quadrupeds → ~20×16, forage → ~1.5×.** *(refactor, low urgency)* — Only visible for boot seconds or on asset 404, but the current −50–70% size pop-in makes loading feel broken; parity makes the swap invisible.
9. **Delete or revive the dead exports `makeSign`, `makeFallenLog`, `makeBush`.** *(housekeeping, no art)* — `makeBush`/`makeFallenLog` are decent sprites worth wiring in as decor; `makeSign` is superseded by the town-sign flow. Decide, don't carry corpses.
10. **`makeScaffold`: retire (crate sheet is primary) or redraw as real lashed poles.** *(low)* — Fallback-only and rarely seen; lowest return.

Sequencing note: land the rulebook's shared ramp constants first (a `RAMPS` table in
`pixel.js` built to the §1/§1a hue-shifted hexes) + a hue-shifting replacement for
`shade()`, then fixes 1–4 consume them — otherwise each fix re-invents hexes and
drifts again.

## Re-confirmation under the enriched era authority (PROCEDURAL_ART.md §0)

The era-canon pass does NOT reorder the fix list — impact × off-style ranking holds —
but it sharpens *why* and elevates one root cause to the front:

- **The `shade()`-multiply → hue-shifted `RAMPS` foundation is now the true #0.** The
  era study makes explicit that flat value-darkening (what all our primaries do
  except `TREE_LEAF`) is the single largest deviation from the SNES/Genesis canon.
  It was already the sequencing note; treat it as the gating prerequisite that fixes
  1–8 all depend on. Building it first retroactively lifts every sprite's palette
  grade.
- **Fixes 1–4 unchanged in order**, but each now also owes its §1b material
  convention + exemplar: barn/coop roofs → ALttP warm→wine shingle planes (not flat
  `#b85040`); mill/tower/well → *Chrono Trigger* cool stone courses; fence posts →
  *Terranigma* warm wood with lit left edge.
- **Fix 6 (pond) gains specificity**: match *Chrono Trigger*/*Secret of Mana* water —
  flat 2–3 blue steps + sparse cyan glint, not a gradient.
- **Fix 3 windmill** anim is reaffirmed (era pt.6: prefer few frames + real rotation
  over a 2-frame strobe; sub-pixel life elsewhere).
- **Checklist consistency:** P2 now demands hue-shift explicitly and a new **P2b**
  demands per-material/exemplar fidelity — both align with this list; no fix conflicts
  with a checklist item. P1–P12 remain the ship gate.

No priorities dropped or added; the enrichment tightens execution guidance, not scope.
