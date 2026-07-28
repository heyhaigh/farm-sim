# PROCEDURAL_ART.md — the Propagate procedural-sprite rulebook

Single source of truth for every sprite drawn in code (`pixel.js` `makeXxx`, plus the
procedural icons in `main.js`). The quality bar is the CraftPix sheet art under
`assets/craftpix-*` — every rule below is **measured from those sheets** (ImageMagick,
2026-07), not vibes. A new or reworked procedural sprite ships only if it passes the
checklist at the bottom.

Scope guard: DISPLAY ONLY. Sprite builders stay pure and deterministic — no
`Math.random`, no `Date.now`, no reads of sim state inside a builder. Variation comes
from seeds/args passed in.

---

## §S. GOVERNING STRATEGY — the top-down north star (SLYNYRD)

> **This is the governing section. Everything below it — the era canon (§0), the palette
> (§1), light (§4), the building grammar (§6a), the checklist (§8) — SERVES this strategy.**
> Distilled from SLYNYRD (Raymond Schlitter) Pixelblog 51 (city builder), 43 (top-down
> tiles), 44 (top-down trees), 22 (top-down character sprites): his method is not a parts
> list, it is a *system*, and it maps almost 1:1 onto our deterministic `fillRect` + `RAMPS`
> pipeline. Applies to EVERYTHING we draw — buildings, tiles, trees, props, characters.

### §S.0 The unifying idea

**Top-down is a system of coordinated cheats on the tile grid. The grid and the layer/depth
sort do the perspective work; the art just has to not contradict them.** You can never truly
show both the *top* and the *front* of a thing in top-down — so we don't try. Each asset class
picks one honest cheat and commits: characters are front-facing + overhead (depth implied down
the Y axis — "objects lower on the screen are closer"); buildings are roof-from-above + a flat
front wall; trees idealize to a near-pure overhead sphere; tiles fake verticality with a front
face reimagined at the tile angle. Unrealism in service of a *consistent, readable* grid is not
a bug — "no matter how tall the rock wall all shadows are the same length… the effect is
convincing enough."

### §S.1 The pillars (how we approach every asset)

1. **GRID-FIRST · FOOTPRINT-SACRED · OVERFLOW TOP-ONLY.** Every builder declares a tile-unit
   footprint *before* any art. The footprint is collision/placement truth. Pixels may overflow
   the footprint **at the TOP only** (a few px — this top-overlap is what makes the depth sort
   read as height); **never** overflow the bottom or the sides ("do not break foundation along
   the bottom or sides… this will create conflicts with layering order"). X-axis overlap is
   "arbitrary and confusing to the eye" — avoid it.
2. **UNIT → SYSTEM.** Don't author a picture; author a *unit*, then derive the whole from it.
   Perfect one small piece (a leaf bundle, a base ground texture, a shingle tile, a base "nude"
   body) — "if the bundles are well designed it should be possible to create a perfect mass of
   foliage with no extra touch-ups needed" — then compose/derive by **layer · shave · reflect ·
   ramp-swap** (§S.3). Quality lives in the unit; composition becomes cheap, uniform, and
   deterministic. This is the most important idea for *procedural* art: it is already how we
   want to write code.
3. **FORM BEFORE DETAIL.** Silhouette and big shapes first, always; detail is the *middle* pass,
   never the first (roof/wall/opening/shadow/outline/ground — §S order below). A sprite must
   read as one solid, correct black shape before a single interior pixel is placed (§3, §9).
4. **ONE LIGHT · SPHERE-MASK VOLUME · RAMP-SHIFTED COLOR (4–5 per element).** One committed sun,
   **upper-left**, for the entire town — no builder re-lights (`LIGHT`, §4, §0.1 pt.7). Round
   volumes are shaded like a sphere: mid body, a light patch on the light quadrant, a dark
   crescent on the away/underside quadrant (`sphereMask`). Color moves by **hue-shifted ramp**
   (§1a), never a flat multiply-darken; **4–5 colors per element is plenty** (SLYNYRD's own
   budget — matches our `RAMPS`).
5. **IDEALIZE + CONSISTENCY (slight irregularity breaks repetition).** We draw "colorful
   simplifications of real life counterparts" chosen for **recognition + charm**, not realism.
   Readability comes from *consistent, repeated* forms — "repetition of similar forms is key to
   maximize clarity"; a *uniquely* shaped element is what betrays a pattern, so vary within a
   consistent vocabulary and add only "a bit of irregularity to break up" mechanical repeats.
   Small sizes → condense/exaggerate proportions (head ⅓–½ of a character) for legibility.
6. **GROUNDING + BELIEVABLE SCALE (no shrunken huts).** Seating an object in the world is a
   required final pass, not an afterthought: landscaping/props/contact that "flesh out the
   surrounding property," plus every standing object's seat shadow. Infrastructure (roads,
   paths, fences) "provides meaningful structure to the layout" — the composition is defined by
   what connects things, filled by the objects. Keep **believable scale relative to the farmer
   unit** — we reject the shrunken-building trope ("I like my buildings to at least have a
   believable scale in relation to the character sprites"). Cluster and balance for **even
   visual weight**; hide tile repetition with background-free decals layered over any ground.
7. **BUDGET THE BALANCING / INTEGRATION PASS.** Drawing the asset is the small half; making it
   *connect* is the big half ("first draft… in little more than a day, but then it took over a
   week to balance and smooth out all the connections"). Every sprite batch ends with a
   mandatory in-world review at native res under the CRT shader — seams, shadow seating, plane
   breaks, repetition tells, scale against neighbors. Integration is a first-class step, not an
   epilogue (this is what the §8 checklist enforces).

### §S.2 THE LAWS (hard, enforced)

- **SHADOW LAW (governs §4.4 and §6a.7; overturns the iso-era height-proportional shadow).**
  A ground/seat shadow **SEATS an object; it does not render its shape.** Therefore it is
  **FIXED**: (1) it **never exceeds one tile** in length; (2) its size is **UNIFORM regardless
  of the object's height** (a tower and a well throw the same-length seat shadow — SLYNYRD's
  explicit rule); (3) it is **CENTERED under the object** (offset only if the depth sort
  provably absorbs it, e.g. a canopy); (4) it is **one flat translucent tone**, stepped rows,
  no gradient, no arc/AA; (5) **every standing object ≥ farmer height gets one** (no floaters).
  Helper: `seatShadow()`. Shadows *integrate* an object into the ground — they are not a second
  drawing of it.
- **OUTLINE LAW.** Never `#000`, never one global outline hue. A selective 1-px outline is **one
  ramp step below the ADJACENT fill** of that same material (`outlineFor(color)` — index−1 in
  the material's `RAMPS` family, or an in-hue darken if off-ramp). Outline only where the
  silhouette must separate from busy ground (lower half + base); sky-facing edges may stay open.
  Interior lines (seams, courses) use the material's *shadow* step, not the outline color —
  outlines frame, seams texture (§3.2–3.3).
- **DERIVATION MOVES (the only sanctioned ways to make a variant).** **SHAVE** — erase portions
  of a drawn base to get edge/corner/damage variants (`shave`); **REFLECT** — mirror a draw
  routine (+ optional recolor) for an opposite side/branch/walk-frame without `drawImage`
  (`reflect`); **RAMP-SWAP** — redraw the *same* geometry through a different `RAMPS` row for
  season + culture (orc) variants (`rampSwap`). Prefer a derivation over a new bespoke drawing.

### §S.3 The shared helpers (every builder inherits the strategy through these)

Codified in `pixel.js` as pure, deterministic, `fillRect`-only primitives (no
`Math.random`/`Date.now`/`drawImage`/`globalAlpha`). New/reworked builders should reach for
these instead of re-deriving light, volume, outline, or shadow by hand:

| Helper | Strategy pillar it enforces |
|---|---|
| `LIGHT` (exported const) | §S.1.4 one committed sun (upper-left); consumed by the shading/shadow helpers so no builder hardcodes a direction |
| `sphereMask(ctx, region, ramp, opts)` | §S.1.4 volume — mid body + light patch (ramp +1) on the light quadrant + dark crescent (ramp −1) on the away/underside quadrant; drives off `LIGHT` |
| `stampCluster(ctx, x, y, seed, ramp, variant)` | §S.1.2 unit→system — one small geometric leaf-bundle unit in ≤4–5 ramp colors (dark/mid/light via ramp-shift); the reusable ORGANIC primitive (trees, hedges, crops, forage) |
| `outlineFor(color)` | OUTLINE LAW — the ramp step one below the adjacent fill |
| `seatShadow(ctx, region, opts)` | SHADOW LAW — fixed ≤1-tile, uniform, centered, single flat tone |
| `shave` / `reflect` / `rampSwap` | DERIVATION MOVES — the three sanctioned variant operations |

> **Order of operations for a building** (the SLYNYRD sequence, as our code order): footprint →
> roof (from above) → walls → openings → eave/recess drop-shadows → `outlineFor` outline →
> **grounding pass** (path/garden strip + `seatShadow`). Detail is the middle; grounding is a
> real step. Keep the front wall short and the roof dominant (§6a); overflow top-only.

---

## §0. Style North Star / Era Reference — the canon we descend from

Our look is the **16-bit / Game Boy Color 2D pixel lineage**: SNES, Sega Genesis /
Mega Drive, Neo Geo, GBC, and the acclaimed modern pixel art that inherits that
tradition (which is exactly the register the CraftPix sheets are painted in). The
CraftPix sheets are our *proximate* reference; **this era canon is the authority they
themselves descend from**, and it LEADS the intended output. When a rule below and a
sheet measurement seem to disagree, the era principle wins and the sheet is treated
as one (good) data point.

> **Terminology guard.** The human's colloquial "64-bit" means *this rich 2D-pixel
> vibe*, NOT Nintendo 64. True N64 was 3D/low-poly with bilinear-blurred textures —
> its aesthetic does **not** transfer to a 2D iso sprite. Never reference N64
> texture/3D looks. Aim squarely at the top-down/iso **2D-sprite** canon below.

### The exemplars (real, well-known, honestly cited)

Concrete reference targets. When drawing an asset, pull up the named exemplar's
handling of that material and match its *technique*, not its exact hues.

| What we draw | Emulate | Why |
|---|---|---|
| **Overall iso town, ground, readability** | *Stardew Valley*; Sega Genesis *Landstalker* / *Light Crusader* (iso) | The modern top-down-farm and 16-bit-iso benchmarks; chunky, legible, warm |
| **Tree / foliage canopy** | *Secret of Mana* & *Seiken Densetsu 3* (Trials of Mana) trees; *Zelda: A Link to the Past* woods | Layered clumped canopy, hue-shifted green ramps, no per-leaf noise |
| **Barn / shingle & thatch roof** | *A Link to the Past* village rooftops; *Harvest Moon* (SNES) farm buildings | Big confident roof planes with a 4–5 step warm→wine ramp, minimal texture |
| **Stone: well, mill, tower** | *Chrono Trigger* castle/masonry; *Terranigma* stonework | Cool-shifted grey courses, warm top-lit stones, blue-grey shadow seams |
| **Water: pond, well water** | *Chrono Trigger* & *Secret of Mana* water; *Link's Awakening* | 2–3 blue steps + a sparse cyan-white glint, gentle 2-frame shimmer, NOT a smooth gradient |
| **Plaster / cottage wall / canvas tent** | *A Link to the Past* houses; *Seiken Densetsu 3* tents | Warm off-white with a single soft shadow side; the shadow is COLORED, not grey |
| **Metal: tools, lantern, blades** | *Chrono Trigger* weapons; Neo Geo *Metal Slug* hardware | Tight high-contrast ramp, 1-px white-hot spec, cool steel shadow |
| **Cloth: farmer shirts/pants** | *Chrono Trigger* / *FF6* character sprites | 2–3 step fabric ramp, warm-lit fold, cool-shifted crease |
| **Livestock / small creatures** | *Harvest Moon* (SNES) animals; *Stardew* barn animals | Rounded barrel body, one light patch, dark far-leg — our `drawQuadruped` is already this shape |
| **Crops / produce** | *Stardew Valley* crops; *Harvest Moon* | Clear per-stage silhouette; ripe = a saturated fruit that reads instantly at 1× |

### §0.1. The era's actual technique (these LEAD every section below)

1. **Hue-shifted ramps (the single most important era trait).** Masters never just
   darkened a color. Down the ramp toward shadow: **rotate hue toward cooler/deeper
   AND desaturate slightly**; up toward light: **rotate toward warmer AND saturate**.
   Concrete rotation amounts + example hex ramps are in §1 — this is the biggest
   correction to our current `shade()`-multiply code, which does none of it.
2. **Tight, harmonious, shared palettes.** SNES art worked in ~16-color sub-palettes;
   colors were *reused* across materials (a wood shadow doubling as a soil outline).
   Discipline over count. Our shared families (§1) are exactly this.
3. **Selective, limited dithering only.** The era dithered to *stretch* a 16-color
   palette across a gradient (skies, water, soft AO) — always an ordered 2-px+
   pattern on a broad surface, never sprite-edge noise. On small iso sprites the best
   artists mostly *didn't* dither. (§5.)
4. **Chunky, readable silhouettes.** Value-first: a sprite had to read as a solid
   black shape. One clear silhouette beats interior detail. (§3, §9-readability.)
5. **Anti-aliasing is hand-placed and sparse.** A single intermediate pixel on a hard
   curve, chosen by hand — never an engine's alpha-blended edge. (§3.5 bans
   `arc`/`stroke` for exactly this reason.)
6. **Sub-pixel motion + squash/stretch.** Genesis/SNES life came from tiny 1-px
   secondary motion and squash-and-stretch on bounces, not many frames. (§7.)
7. **One committed light source.** The whole scene lit from one direction (ours:
   upper-left), so every sprite agrees and the town reads as one place. (§4.)

Everything from "## 0" down is the era canon made **measurable** against our sheets.

---

## 0. The reference sheets, measured

| Reference asset | Cell | Content bbox | On-screen (×0.76) | Unique colors |
|---|---|---|---|---|
| Swordsman lvl1 walk frame (body+head) | 64×64 | 15×23 | ~11×17 | 25 |
| Bull (side row) | 64×64 | 35×28 | ~27×21 | 25 |
| Chick (side row) | 16×16 | 10×9 | ~8×7 | 12 |
| Cottage (`exterior.png` house) | 137×125 | full | ~104×95 | 46 |
| `Tree1.png` mature tree | 128×128 | 62×78 | ~47×59 | 15 opaque |

Real conventions read off those slices:

- **Light comes from the UPPER-LEFT.** Verified by quadrant luminance on the tree
  canopy (TL 0.71 > TR 0.68 > BL 0.55 > BR 0.55) and the cottage roof (left half
  consistently brighter than right).
- **No pure black, no black outlines.** Darkest pixels are *tinted* darks:
  `#211a1c` (character), `#251c1c` (bull), `#193926` (tree canopy), `#3f1428`
  (roof shadow). The chick's outline is `#59332a` — a deep version of its own
  body color.
- **Ramps hue-shift, they don't just darken.** Tree canopy runs
  `#97ba3a → #87ab3e → #68963d → #4d843b → #357137 → #2d603d → #193926`
  (7 steps: yellow-green in light, blue-green in shadow). The red roof runs
  `#bb4f3c → #9e3931 → #8a2a2a → #741c25 → #6d1924 → #3f1428` (orange-red in
  light, wine-purple in shadow). A straight RGB multiply (our `shade()`) cannot
  produce this — see §3.
- **4–7 shades per major material.** Small creatures: 3–4 per material,
  12–25 colors total. Buildings: 4–6 per material, ~46 total.
- **White is specular only.** 1–3 px glints (`#ffe694` chick crown), never a fill.
- **No checkerboard dithering anywhere.** Texture = clustered darker clumps
  (leaf clumps, bark streaks), always 2+ px blobs, never alternating pixels.
- **Cast shadows are baked, soft, and translucent.** Tree: `rgba(0,0,3,0.25)`;
  cottage: `rgba(53,53,43,0.35)`. Roughly a squashed 2:1 ellipse at the base.

---

## 1. Palette — shared families

All procedural sprites draw from these ramps (ordered shadow → light). Pick the 3–5
consecutive steps a sprite needs; do not invent one-off hues for a material these
already cover. Every ramp is **hue-shifted per the era canon** (§0.1): the shadow end
is cooler/deeper + less saturated, the light end warmer + more saturated. The
"Hue travel" column states the direction and total degrees so the RAMPS table our
code adopts (see §1a) can be built to spec, not multiply-darkened.

| Family | Ramp (shadow → light) | Hue travel (shadow→light) | Use |
|---|---|---|---|
| OUTLINE-WARM | `#211a1c` | — (single) | characters, animals, warm props |
| OUTLINE-GREEN | `#193926` | — (single) | foliage silhouettes |
| OUTLINE-BROWN | `#3a2818` | — (single) | wood, soil, wheat |
| WOOD | `#3a2a1c` `#5a4028` `#7a5433` `#946c46` `#b2854c` | ~20°→~30° (red-brown → warm orange-tan); +sat | fences, troughs, sheds, trunks |
| PLANK-WARM | `#59332a` `#82503f` `#ab7757` `#c9a24a`-tinted | ~14°→~34° (wine-brown → warm tan) | coop/hatchery planking |
| ROOF-RED | `#3f1428` `#6d1924` `#8a2a2a` `#9e3931` `#bb4f3c` | ~336°(-24°)→~11° (wine-magenta → orange-red); ~35° warm-ward | barn/coop roofs (the cottage's own ramp) |
| STONE | `#3f4249` `#4f525d` `#565a65` `#6c7a86` `#8b97a2` | ~220°→~205° (blue-grey shadow → warmer neutral top) | well, mill, tower |
| FOLIAGE | `#193926` `#2d603d` `#357137` `#4d843b` `#68963d` `#87ab3e` `#97ba3a` | ~140°→~76° (blue-green → yellow-green); +sat, +val | canopy, crops, forage |
| SKIN | `#a46f59` `#be865f` `#e1b26e` `#f6ca74` | ~18°→~42° (red-orange shadow → warm yellow light) | farmers |
| GRAIN-GOLD | `#9a5d48` `#c48355` `#dc9a5c` `#eeb05e` `#f9cb69` `#ffe694` | ~16°→~48° (red-brown → pale warm yellow) | wheat, straw, eggs, lantern glow |
| WATER | `#1e3550` `#2c4a6a` `#3c6a8e` `#5a94b4` + spec `#bfe4f0` | ~215°→~200° (deep blue → cyan-lit) | well water, pond accents |
| GLASS-BLUE | `#63609f` `#7b85c3` `#a8b8e0` | ~243°→~223° (violet shadow → sky) | windows (the cottage's own window ramp) |

**These measured hue rotations ARE the era technique** (§0.1 pt.1), confirmed by the
sheet reads in §0 and by 16-bit color practice: shadows rotate cooler/deeper and lose
saturation; lights rotate warmer and gain it. Note the pattern is material-specific —
greens rotate toward blue-green in shadow, reds toward magenta/wine, golds toward
red-brown, greys toward blue — never a uniform "add black."

### §1a. Concrete hue-shift spec (what the code's `shade`/`RAMPS` must do)

Replace the current `shade(hex, f)` **RGB multiply** (which only scales value — the
exact mistake the era masters avoided) with a hue-shifting ramp. For any base color,
each step operates in HSL/HSV:

- **One step toward SHADOW:** Value ×0.80–0.86 · Saturation ×0.90–0.95 ·
  **Hue rotate +8°…+14° toward the material's cool/deep anchor** (green→+toward
  160°, red→−toward 320°/magenta, yellow/gold→−toward red, grey/stone→+toward 220°
  blue).
- **One step toward LIGHT:** Value ×1.12–1.20 · Saturation ×1.05–1.12 ·
  **Hue rotate 6°…10° toward the warm/light anchor** (green→toward 80° yellow-green,
  red→toward 20° orange, gold→toward 55° pale, stone→toward warm neutral).
- **Total ramp hue travel:** 30–65° across a full 4–7 step ramp. Small (3-step)
  ramps: ~20–30°.
- **Preferred:** don't compute at runtime at all for the 3+ step surfaces — ship the
  hand-tuned hex ramps above as a `RAMPS` constant and index into them (the era way:
  authored sub-palettes, not procedural darkening). Keep a hue-shifting `shade()`
  ONLY for 1-px AO/seam accents where a table entry would be overkill.

### §1b. Per-material rendering conventions (era-authentic, with exemplar targets)

| Material | How the era renders it → our rule | Exemplar |
|---|---|---|
| **Wood** (fence, trough, shed, trunk) | Warm ramp, grain as 1-px darker streaks along the length (NOT dots), lit left edge, `OUTLINE-BROWN` base. Root/foot flare gets the darkest step + AO. | ALttP fences; *Terranigma* |
| **Stone** (well, mill, tower) | Cool-grey ramp; blocks lit on their TOP + upper-left face, shadow seams in the blue-grey step between courses; a few stones 1 step off for variation. NO `arc/stroke`. | *Chrono Trigger* masonry |
| **Roof shingle/thatch** (barn, coop) | Big confident planes; ROOF-RED 4–5 step ramp; overlapping shingle rows = 1-px shadow line every 2–3 rows on the SHADOW side only; ridge highlight along the top. | ALttP rooftops; *Harvest Moon* |
| **Plaster/canvas** (walls, tents) | Warm off-white body, ONE soft shadow side in a colored (warm-grey, never pure grey) shadow; corner AO. | ALttP houses; SD3 tents |
| **Water** (pond, well) | 2–3 WATER steps, NOT a smooth gradient; sparse cyan-white glints (≤3 px) that shift on a slow 2-frame cycle; 1-px dark contact ring where water meets rim/land. | *Chrono Trigger* / *Secret of Mana* |
| **Metal** (tools, lantern, blade) | Tight, high-contrast ramp; 1-px white-hot specular; cool steel shadow; warm reflected bounce on the underside. | *Chrono Trigger* weapons; *Metal Slug* |
| **Foliage** (canopy, bush, crop leaf) | Clumped lobes, dark silhouette → mid body up-left → small light patch → dark underside crescent (our `canopyBlob` already does this); texture = a few darker clump dots, never noise. | *Secret of Mana* / SD3 trees |
| **Cloth** (shirt, pants) | 2–3 step fabric ramp; warm-lit fold on the upper-left, cool-shifted crease; collar/seam 1 step darker. | *Chrono Trigger* / *FF6* sprites |
| **Grain/straw** (wheat, thatch, eggs) | GRAIN-GOLD ramp; heads catch a pale warm highlight, undersides a red-brown; awns 1-px. | *Harvest Moon* fields |

Rules:

1. **Shades per element:** ≥3 for any surface ≥6×6 px (shadow / base / light).
   ≥4 for any surface ≥12×12 px. A flat single-color fill is only legal under 6×6.
2. **Ramp construction:** use the §1/§1a hue-shifted ramps — each step darker AND
   hue-rotated toward the material's cool anchor, each lighter step warm-rotated.
   Never build a 3+ step ramp with `shade(base, f)` multiply alone (it flattens the
   era's defining trait); hand-pick from the families or the `RAMPS` table.
3. **Bounds:** nothing darker than the OUTLINE families (no `#000`); nothing
   lighter than `#ffe694`/`#fffdf6` and only as ≤3 px speculars.
4. **Saturation budget:** the CRT/GBC shader (`crt.js`) already lifts saturation.
   Target the reference's measured chroma — if a color looks candy on
   `/sprites.html` it will glow radioactive in-game.
5. **Seasonal variants** swap ONLY the FOLIAGE-family steps (as `TREE_LEAF`
   already does) plus snow caps `#eef4f4`/`#ffffff`. Structure/wood/stone hues do
   not change per season.
6. **Culture (orc) variants** may shift WOOD → ashen (`#4a4038` family) and
   FOLIAGE → fungal, but keep the same ramp lengths, hue-shift discipline, and
   outline rules.

---

## 2. Dimensions & proportion

The **farmer is the unit**: 16×20 px cell, ~18 px visible height (matches the sheet
swordsman's ~17 px on-screen content). `TILE_W=20, TILE_H=10` (2:1 diamond).
Sheet art draws at `ASSET_SCALE = 0.76`; procedural canvases draw 1:1, so a
procedural cell IS its on-screen size.

Canonical size classes (visible content, not canvas padding):

| Class | Height (px) | vs farmer | Members |
|---|---|---|---|
| Hand prop | 5–10 | ≤0.5× | lantern, fence post, trough, good icons (16×16 cell) |
| Small creature | 7–12 | ~0.5× | chicken, fish, chick-scale producers |
| Large creature | 18–24 | ~1.1× | cow, pig, goat, sheep (bull reads 27×21) |
| Ground flora | 10–16 | ~0.7× | crops, forage, flowers, stump |
| Furniture / plaza prop | 22–34 | 1.2–1.8× | well (sheet well ≈29×29), board, scaffold |
| **Farm building** | **42–60** | **2.3–3.3×** | coop, barn, mill, hatchery, toolshed |
| Tall structure | 50–70 | 2.8–3.9× | windmill, tower |
| Tree (mature) | 45–60 | ~2.7× | tree fallback must match the ~47×59 sheet tree |
| Dwelling | 80–100 | ~5× | house fallback (sheet cottage is 104×95) |

Hard rules:

1. **A building must visually own its footprint.** Facility regions are 3×3–4×4
   tiles (60–80 px across in iso). The sprite's base width must be ≥60% of the
   footprint's iso width. A 24-px coop in a 4×4 pen fails.
2. **Relative order is inviolable:** barn > coop/hatchery ≥ mill > well > farmer >
   cow > sheep/pig/goat > chicken > fish. A barn may never read smaller than a
   dwelling of the same tier.
3. **Fallback sprites match their sheet replacement within ±20% of on-screen
   size** so art pop-in doesn't rescale the world (procedural tree at 16×22 vs
   sheet 47×59 fails).
4. Canvas = content + ≤2 px margin. No large dead borders (they break anchor math).
5. **Believable scale vs the farmer unit (§S.1.6).** No shrunken-hut trope — a building
   reads at a plausible size next to the character sprites, per the size classes above. The
   farmer is the yardstick; a dwelling that reads smaller than a large creature fails.
6. **Overflow TOP-ONLY (§S.1.1).** A sprite's pixels may exceed its footprint at the TOP by a
   few px (this top-overlap sells height under the depth sort); they must NEVER exceed the
   footprint at the bottom or the sides (that breaks layering/collision).

---

## 3. Outline & edge

1. **Selective, 1 px, tinted.** Silhouette gets an outline only where it must
   separate from busy ground: the lower half + base of a sprite, and any edge that
   would otherwise vanish against grass. Sky-facing edges may stay open (the sheet
   tree has none on top).
2. **Outline color = one ramp step below the ADJACENT fill of the local material**
   (the §S.2 OUTLINE LAW — use `outlineFor(color)`; chick uses `#59332a`, canopy uses
   `#193926`). Never `#000`, never one global outline hue around different materials.
3. **Interior lines** (plank seams, stone courses, door frames) use the material's
   shadow step, 1 px, never the outline color — outlines frame, seams texture.
4. **Corner rounding:** knock out single corner pixels on any box ≥8 px wide
   (the head-corner `clearRect` trick in `composeFarmer` is the pattern).
5. **No anti-aliasing.** Canvas `arc()`, `stroke()`, `lineTo()` fills are BANNED in
   sprite builders — they emit half-alpha edge pixels (see `makeMill`'s millstone).
   Circles are drawn as stepped fillRect rows (the `canopyBlob` ellipse pattern).

---

## 4. Light & shading — the single-light-source model (governing)

**The model, stated and enforced.** ONE light vector — **upper-left** — governs *every*
procedural asset (buildings, props, tiles, monuments…), so the whole scene reads coherently
lit. Two consequences, applied consistently:

- **(a) Surfaces are toned by how they FACE the light.** Up/left-facing surfaces are lit
  (+ steps); down/right-facing surfaces are shadowed (− steps). This is the two-plane roof
  (lit-left plane / shadow-right plane), the lit front wall vs the shadow side-sliver, the
  three cylinder bands, the canopy sphere — all the same vector.
- **(b) Every RAISED FORM / relief edge gets the PAIR:** a **lit-edge highlight** on its
  light-facing side (top / top-left) **AND** a **drop shadow** on its away side
  (bottom / right). The pair — not just one or the other — is what makes an element read as
  *raised and exacting* rather than drawn-on. Apply it to **every** relief: shingle tiles
  (lit top+left / shadow bottom+seam), wall planks (lit edge / shadow groove), the foundation
  sill, the window frame + mullions, the door frame, the eave/fascia lip, cylinder courses.
  This is the craft the CraftPix cottage has and the level we match.
- **Same vector for ALL assets** — never flip or re-light per object; a consistently-lit
  scene is the point. New buildings/props inherit this automatically.

1. **One sun: upper-left.** Light faces: top + left. Shadow faces: right + bottom.
   Every sprite, no exceptions, all seasons.
2. **Quantities:** top/light face ≈ base +1 ramp step; right/bottom shadow face ≈
   base −1..−2 steps. **Implied / contact shadows are a WHISPER** — a faint translucent
   black (~`rgba(0,0,0,0.06–0.13)`), NOT a hard dark band: the roof-overhang drop shadow on
   the wall, the window-sill bottom shadow, the door threshold. (The cottage's overhang
   shadow is ~5–10% black.) Shadows that are a real EDGE or a cast ground shadow keep their
   contrast (per-tile bottom shadow ~20% black, fascia edge, the ground cast shadow §4.4).
   A 3/4-sphere form (canopy, animal barrel) gets: dark silhouette → mid body nudged up-left
   → small light patch at upper-left (~25%) → darker underside crescent (`canopyBlob`).
3. **AO at contact:** 1 px of the material's darkest step where the sprite meets
   the ground (feet, trunk base, wall base). Already the pattern in
   `trunkFlared` / `makeStump` — mandatory everywhere.
4. **Cast shadow — the FIXED SHADOW LAW (§S.2).** Every standing sprite ≥ farmer height
   gets a seat shadow that SEATS it, not one that redraws it: **≤1 tile, uniform regardless
   of height, centered, a single flat translucent tone** (`seatShadow()`), either baked into
   the sprite as a 2:1 ellipse `rgba(10,14,10,0.30±0.05)` (max 3 rows tall) or drawn by the
   renderer (the farmer's 14×2 foot-shadow). Never scale a shadow with the object's height.
   Buildings with no seat shadow float — fail.
5. **Contrast floor:** silhouette must read at 1× against both summer grass
   (`#4e9438`-family) and winter snow — check both in `/sprites.html` or in-game.

---

## 5. Dithering / texture

Era note (§0.1 pt.3): 16-bit artists dithered to *stretch a 16-color palette across a
gradient* — a soft sky, a water plane, an AO falloff — always an ordered 2-px+ pattern
on a broad surface. They did NOT dither sprite edges or small iso props (those stayed
flat and clean). Our sprites are small, so the default is none.

1. **Default: none.** Flat, confident clusters per the reference and the era.
2. Ordered dithering allowed ONLY to blend two adjacent ramp steps across a broad
   soft transition (a large roof's mid-to-shadow falloff, an AO gradient under a big
   building) on surfaces ≥16 px across, max 2 adjacent ramp steps, in **clusters
   ≥2 px** — never a 1-px checkerboard, never on an edge.
3. Texture budget: ≤15% of a surface's pixels. The reference's roofs are ~90%
   clean fill. Material texture (bark streaks, shingle lines) is 1-px SHADOW-step
   lines, not dither.

---

## 6. Iso conventions

1. **Tile = 2:1 diamond** (`TILE_W=20, TILE_H=10`). Anything covering ground
   aligns to `fillDiamond` geometry.
2. **Anchor = bottom-center.** Draw call is
   `drawImage(spr, sx - w/2, sy + TILE_H - h)`; the sprite's ground-contact row
   must be its bottom canvas row (≤2 px slack). Multi-tile buildings anchor at the
   footprint's front (south) corner ground line.
3. **Depth:** sort key is the anchor's screen `y` (+ the small `depth` biases in
   `wildSpec`). A sprite must not paint below its anchor row (it would overlap the
   tile in front).
4. **Footprint honesty:** visible base ≈ claimed footprint. Kickstands, ramps,
   and root flares may exceed by ≤3 px.
5. Vertical elements (posts, trunks, towers) stay vertical in screen space; only
   ground planes get the 2:1 squash.

---

## §6a. Top-down ¾ BUILDING projection + shape grammar (anchored to the cottage)

**The projection.** The game's BUILDINGS are drawn like the SPRITES — **top-down ¾,
FRONT-FACING, upright** (the ALttP / Stardew / Harvest Moon dialect) — NOT like the floor.
The word "isometric" describes the GROUND (the 2:1 tile grid); a building is **not** a
tilted floor tile. The CraftPix cottage (`exterior.png`) presents its FRONT WALL **flat to
the camera** on a **screen-aligned rectangle**, with a big **gable ROOF seen from above,
tilted down-and-forward, OVERHANGING** the wall and dominating the upper portion. You
**never** see two walls receding to a near-vertical corner, and the footprint is a
rectangle, **not** a rotated diamond. (An earlier pass mis-drew the set corner-on
isometric — matched the floor, not the sprites — see the **Appendix: abandoned corner-on
iso**.) RAMPS / hue-shift / shingle-COURSE texture / seasons / animation all carry over —
they are projection-independent and fold in AFTER this angle is locked.

### Era canon — TOP-DOWN ¾ exemplars (the target)
- **Zelda: A Link to the Past** overworld houses — the exact target: flat front wall + big
  roof-from-above tilted forward + overhang.
- **Stardew Valley** + **Harvest Moon (SNES)** farm buildings (coop / barn / shed).
- **Secret of Mana / Terranigma** town buildings.
- Dropped: *Landstalker / SimCity 2000* — that corner-on iso is what misled us.

### §6a.1 Measured geometry (cottage, top-down)
`exterior.png`, 125×125 content, ×0.76 ≈ 95px on screen:
- **Front wall — a FLAT, screen-aligned RECTANGLE:** a horizontal base line (not a diamond),
  vertical sides, upright; the LOWER ~55–60% of the height; carries the door + windows
  presented square to the camera.
- **Roof — a broad GABLE seen from above:** tilted down toward the viewer, the UPPER ~40%;
  a **GENTLE forward pitch (a soft tilt, NOT a sharp diamond peak)**; a **horizontal ridge**
  near the top (left–right, not a point); the front slope reads as a broad band/trapezoid;
  eaves **widest at ~y46/125 → roof is the top ~37–40%**.
- **Overhang:** the roof eave is ~2–3px WIDER than the front wall each side (eaves stick out
  past the wall), with an eave-shadow (AO) line where roof meets the wall top.
- **Side reveal:** only a SLIVER of one side (the cottage is essentially front + roof).
  Optional 2–3px shaded strip on the shadow (right) side for a hint of depth — never a full
  receding wall.

### §6a.2 Construction (screen-aligned; no diamond)
- **Footprint = a screen-aligned RECTANGLE** (a horizontal front edge), not a 2:1 diamond.
- **Wall** = an upright rectangle, drawn as horizontal/vertical solid fills.
- **Roof** = a trapezoid/gable ABOVE the wall: a horizontal **ridge** segment near the top,
  the front slope rasterized **row-by-row** (width lerps ridge→eave) as solid fills, eave
  **overhanging** the wall. No `arc`/`stroke`/`rotate`; no AA (§3.5). Stepped/aliased curves
  still allowed for round bodies (§6a.4).
- **Light upper-left (kept):** roof left third lighter / right third darker; wall gentle
  lit-left / shadow-right; eave-AO under the overhang; a ridge highlight.
- **Cast shadow:** a soft **screen-aligned ellipse pooled at the BASE** (the feet), barely
  offset — top-down casts down/behind, not a long iso diamond.
- **Anchor:** base-anchored (bottom row = the front wall's ground line on the tile).
- **KILLED (corner-on-iso errors):** diamond footprint · two receding walls · near-vertical
  corner · sharp hip/pyramid peak · "roof rake pitch off the diamond." All abandoned.

### Core rules
1. Buildings are drawn like the SPRITES — **top-down ¾, front-facing, upright:** a flat
   FRONT WALL + a ROOF-from-above tilted forward + overhang, on a screen-aligned rectangle.
2. **Light upper-left**, committed across roof + wall (same sun as every sprite).
3. **Roof dominates the top ~40%** and OVERHANGS the wall ~2–3px; eave-AO under it.
4. Reads at 1× and sits in the **same plane as the CraftPix cottage / trees / character
   sprites** — the one calibration test.

> **Re-basing note.** The technique clauses below (§6a.3 roof-form variety, §6a.4
> curved/round bodies, §6a.5 params, §6a.6 overhang, §6a.7 shadow/container, §6a.8 openings,
> §6a.9 attachments, §6a.10 flecks, §6a.11 cache/orc, §6a.12 honesty) and the whole seasonal
> system (§6b) are **RETAINED as technique**, but their CONSTRUCTION re-bases on THIS
> front-facing, screen-aligned frame (gable ridge horizontal across the front; round bodies
> as upright cylinders seen front-on; roofs tilted forward), **not** the abandoned iso
> diamond. Full reconciliation of the sub-clauses lands once the owner signs off the angle
> (this reset POC). Ignore any "diamond / two-wall / corner / apex" wording in them until then.

### §6a-D. Fine-grain DETAIL conventions (systemic — match the cottage's craft)

Measured up close from the CraftPix cottage (`exterior.png`). These are what give a building
its finish; **every building inherits them** (barn/mill/house/coop…), expressed in our
procedural language (RAMPS + fillRect, deterministic).

**§6a-D.1 Roof = individual shingle TILES (not just course lines).** The cottage roof reads
as discrete scaly tiles, not a flat field of stripes:
- **Tiles in half-offset courses.** Foreshortened courses tighten toward the high ridge
  (§6a.2). Within a course, tiles are ~3–4px wide with a **vertical seam** (gap) between
  them; the seam pattern is **offset half a tile per course** (brickwork).
- **Per-tile HIGHLIGHT + DROP-SHADOW PAIR** (the §4 model — this is what makes each shingle
  read as an exacting little 3-D form). From the single upper-left light: each tile gets a
  **lit edge on its light-facing side** — a **lit top edge** (+1 step) **and a lit left edge**
  (+ a step) — AND a **drop shadow on its away side** — a **bottom drop shadow** (a soft
  ~20% translucent black onto the tile below) **plus the seam gap** (shadow between tiles).
  Highlight *and* shadow, not one alone. Missing the lit edge is what made our early tiles
  read flat.
- **TWO-PLANE light break.** A roof is never one flat field: the plane angle changes (main
  pitch vs the hip/side falloff), so give it a **lit plane (left) vs a shadow plane (right)**
  with a visible step. The **highlight/shadow LOGIC per tile is identical on both planes**,
  just at different levels (shadow-plane tiles are a step down with dimmer highlights) — the
  rule is consistent, never ad-hoc.
- **Roof THICKNESS at the eave** (a 1px darker fascia = the roof slab's edge seen — a real
  edge, keeps contrast) + a sliver of the FAR slope above the ridge (depth). Winter snow rides
  ON the tiles — keep the course-bottom shadows + seams + lit edges showing so **individual
  tiles still read through partial snow**.

**§6a-D.2 Roof OVERHANG drop shadow — a WHISPER.** The overhang casts a **very subtle
darkening on the wall directly under the eave — ~5–10% black** (a translucent
`rgba(0,0,0,0.06–0.10)` over the wall beneath, ~1–2px), just enough to *imply* the overhang,
matching the cottage. **NOT** a heavy graded dark band. Likewise the window-sill bottom shadow
and the door-threshold shadow are whispers (~10–13% black), never hard dark lines (§4.2). Only
real EDGES (fascia) and the ground cast shadow keep full contrast.

**§6a-D.3 WINDOW treatment.** A window is never a flat blue square — it is glass in a frame:
- **Frame + mullions:** a 1px wood frame (RAMPS.WOOD/PLANK); mullions divide the glass into
  panes (the cottage windows are 2×2). Panes ≥2px each.
- **Glass REFLECTION:** a **diagonal light streak** across the panes (bottom-left → top-right,
  RAMPS.GLASS light / near-white), i.e. the glass catching the sky — plus a top-to-bottom
  gradient (lighter top, darker `GLASS[0]` lower). Never a flat fill.
- **TOP-SILL HIGHLIGHT:** a lit pixel row where light hits the top edge of the sill/frame
  (+1 step).
- **BOTTOM-SILL DROP SHADOW:** a shadow row on the wall directly under the sill.
- **Winter:** the panes frost to a pale blue-white; keep the reflection streak (lighter) and
  the sill highlight/shadow.
- **Doors** get the same care where it applies: a **lit top jamb / frame edge**, a plank seam
  or two, a handle glint, and a **threshold drop shadow** on the ground under the door.

### §6a.3 Roof-form grammar (vertex construction + assignment)

For each form, the **eave rectangle** = the wall-top diamond pushed out by `ov`. Apex/ridge
sit `roofH` above the wall-top plane. Visible planes only (front-left + front-right; back
planes hidden).

| Form | Ridge/apex construction | Visible planes | Use on |
|---|---|---|---|
| **hip / pyramid** | single apex `Pk = O+(0,−wallH−roofH)` | left tri `(eaveL, eaveF, Pk)` + right tri `(eaveF, eaveR, Pk)` | small square outbuildings: **coop, hatchery, well canopy** |
| **gable** | a RIDGE segment along ONE ground axis (e.g. the i-axis): `RidgeBack, RidgeFront` at height `roofH`; the front gable end is a **triangle of wall** below the ridge front | two long roof planes (lit/shadow) + a triangular **gable face** (front-on, lit as a wall) | **barn, house, mill** — so the town isn't ten identical diamonds |
| **shed (mono-pitch)** | ridge is one high eave edge; roof is ONE sloped plane down to the opposite low eave | one plane (+ its thin upslope edge) | **lean-tos / toolshed**, attachments (§6a.9) |
| **cone** | apex `Pk` over the footprint centre; the roof is a filled circle-in-perspective with **radial courses** converging on `Pk` | a lit left arc-band + shadow right arc-band (no flat planes) | **tower cap, windmill cap** (§6a.4) |
| **flat** | no ridge; the roof top IS a 2:1 diamond (the eave rectangle) seen from above | the diamond top (brightest surface) | flat-roofed stores/silos where relevant |

**Roof-brightness ranking** (there is no flat "top" on a tilted plane, so rank by facing):
`lit roof plane ≥ lit wall > shadow roof plane > shadow wall`. Concretely: lit roof =
material lit-tone; lit wall = lit-tone −0; shadow roof = base −1; shadow wall = base −2.
Flat-roof tops (facing straight up) are the single brightest surface.

### §6a.4 Curved-plan clause (round forms: silo, tower, windmill turret, well ring)

Round bodies **replace the two-wall split with three vertical bands**: a **LIT band** (left
~⅓) → **mid band** → **core-SHADOW band** (right ~⅓), each a solid vertical fill, stepping
the tone across the cylinder. **Base and top caps are 2:1 ellipses** (stepped, like the
ground shadow). **Conical roofs** use **radial courses** converging on the apex (drawn as
stepped 1px runs from rim to apex, tone by band). **"No arcs" relaxes to "no
ANTI-ALIASING"**: manually aliased / stepped curves are **allowed and required** here — the
ellipse/cylinder edges are stepped by hand (integer runs), never `ctx.arc`. This unblocks
the very buildings on the rollout list.

### §6a.5 Decouple height from footprint — per-building parameter table

Footprint and height are independent. Each building declares:

| param | meaning |
|---|---|
| `footprintTiles` | W×D in tiles → `hw` (screen) |
| `wallH` | wall height in px (independent of `hw`) |
| `roofH` | ridge/apex height in px |
| `roofForm` | hip / gable / shed / cone / flat (§6a.3) |
| `ov` | overhang px (§6a.6) |
| `openings` | door/window specs projected onto wall planes (§6a.8) |
| `culture` | palette set (human / orc, §6a.11) |

**Proportion scaling (chosen conventions, see §6a.12):** the **eave geometry and overhang
are INVARIANT** (a well eave and a barn eave use the same 2:1 slope + proportional
overhang). The **roof FRACTION scales DOWN as `wallH` grows**: a squat outbuilding is
~50–60% roof; a tall structure drops toward **~20–25%** roof so a tower isn't a stump and a
barn isn't a skyscraper. Rule of thumb: `roofH ≈ clamp(0.6·hw, 6, 0.4·wallH+6)`.

### §6a.6 Overhang (proportional)

`ov ≈ 2px per ~20px of wallH` (≈ `round(wallH/10)`, min 1, max 3) — not a flat 2px across a
95px cottage and a 30px well. The roof eave is the wall-top diamond pushed out by `ov`
horizontally + `~1px` down; an **eave-AO line** sits under the overhang where roof meets
wall, and the overhang tip is a solid ≥2px wedge with an unbroken outline.

### §6a.7 Cast shadow (the FIXED SHADOW LAW) + containers

> **SUPERSEDES the iso-era rule.** This clause previously read "height-proportional,
> silhouette-derived" — a 2:1 diamond *sized to the roof eave* whose offset + length *scaled
> with height*. That was inherited from the abandoned corner-on iso phase (see Appendix) and is
> **overturned** by the §S.2 SHADOW LAW. A seat shadow SEATS an object; it does not re-draw its
> silhouette. Do NOT size a building's shadow to its roof or grow it with `wallH`.

- **FIXED, uniform, centered, one flat tone.** The seat shadow **never exceeds one tile** in
  length (`rx ≤ TILE_W/2`, `ry ≤ TILE_H/2`), is the **SAME for every building regardless of
  height** (a tower and a well seat identically), sits **centered under the base** (barely
  offset — top-down casts down/behind, not a long iso diamond), and is a **single flat
  translucent tone**, stepped rows, no arc/AA. Use `seatShadow(ctx, region)`. Every structure
  ≥ farmer height gets exactly one — a building with no seat shadow floats (fail).
- **Container is a PLACEMENT concern, separate from the shadow.** A building's visual silhouette
  (roof overhang, a well's grassy back, a barn's lean-to) may exceed its logical tile footprint,
  so structures still reserve a **CONTAINER** (a tile box ≥ the silhouette; a 3×3 well wants a
  ~5×5 container) that placement/collision honor so buildings + monuments stop overlapping. The
  container governs *spacing*; it does **not** enlarge the shadow (the shadow stays the fixed
  ≤1-tile seat). Sort/anchor stays the front-bottom footprint vertex.

### §6a.8 Openings (projected onto the 2:1 wall planes)

Generalize the coop rule: an opening is a small parallelogram **seated ON a wall plane** —
its bottom edge on the wall's base 2:1 line (door) or a chosen course, its top edge parallel
(following the plane slope), verticals vertical. **Min ~5px; always framed** (1px frame /
lit jamb in the wall's material, +1 value step). **Window** = frame + 2×2+ blue-grey panes
(lower panes −1 step) + exactly **one glint px** — no orphan pixels. **Door** = dark recess,
bottom on the base line, top on the slope, 1px lighter jamb. Doors on the LIT (front-left)
wall, windows on either.

> **Depth-model note — `recess()` is for DOORS, not glazing.** The shared `recess()` helper's
> lit lip (`shade(inner, 1.7)`) is right for a wood/stone reveal but wrong for glass. Windows
> and oculi instead hand-roll their set-in depth per §6a-D.3: a 1px `shade(glass, 0.75)`
> shadow row directly under the top frame, then the reflection streak/gradient. So the rule
> "recess() on openings" formally reads: **`recess()` for doors; §6a-D.3 treatment for glazing.**

### §6a.9 Attachments / protrusions contract

- **Lean-tos attach to the RIGHT (shadow) wall** (keeps the door + lit wall clean); a
  **shed roof** (§6a.3) follows the same 2:1 eave with its own `ov` + eave-AO; **NO outline
  on the shared junction edge** (an internal outline reads as two separate buildings).
- **Draw order / occlusion for protrusions** (mill wheel, windmill blades, chimney): the
  **front-bottom footprint vertex stays the sort key**; a protrusion draws after the body it
  sits on, and is occluded by anything whose anchor sorts in front.
- **Windmill BLADES stay SCREEN-FACING** (the sanctioned era cheat): shearing rotating
  blades into a wall plane at this resolution reads as a broken ellipse, so blades animate
  in screen space over the iso cap. Chimneys are small corner-on boxes with a flat-diamond
  top (snow-capable).

### §6a.10 Determinism for seasonal / procedural flecks

Leaves, icicles, frost, moss, wear: **seed = `hash(buildingId, season, index)`** (a pure
position/id hash — NEVER `Math.random`/`Date.now`). Fixed COUNTS per building+season;
**eligibility masks** decide WHERE (e.g. leaves only within N px of an eave, snow only on
up-facing planes §6b). Same inputs → same pixels, so cached variants stay deterministic.

### §6a.11 Cache key + orc hook

- **Cache key** = `(buildingId, season, sizeTier, material, culture, orientation,
  upgradeLevel, animFrame)` — include only the axes a given builder actually varies (the
  coop caches on `season`; a windmill also on `animFrame`).
- **Orc variant (reserve the hook now; full build-out queued):** the SILHOUETTE may be
  jagged / asymmetric, but **every STRUCTURAL edge still snaps to 2:1 or vertical** — the
  twist comes from **asymmetric massing + spikes / bone / iron**, NOT off-angle lines. Orc
  metal follows §1b (tight high-contrast ramp, a single 1px spec, cool shadow). This keeps
  orc buildings in the same plane as human ones while reading as a distinct culture.

### §6a.12 Honesty note

The proportion ratios here (`hh=hw/2` is exact from the tile; `wallH`, `roofH`, `ov`,
roof-fraction) are **chosen conventions calibrated against the cottage measurement** (roof
top ~37–40% of height, overhang ~2–3px), **not** per-parameter measurements of many sheets.
The cottage is one data point; treat the numbers as tunable defaults, not gospel. (If we
later measure the yurts / guild hall, ground them further.)

### Core rules (unchanged in spirit)

1. **No flat facades** — roof-from-above + ≥2 receding wall planes (or 3 bands for round).
2. **Committed light** upper-left (the §6a.3 brightness ranking); the corner reads from
   lighting, not a saturated post (value accents only, in-ramp).
3. **In-plane texture** — shingle COURSES run along the eave (2:1) with a half-course
   offset (never a 1px diagonal checker — that moirés, §0.1); wall seams vertical.
4. **Reads at 1×** and blends with the CraftPix cottage/trees vantage.

---

## §6b. Seasonality (buildings adapt to `world.season`) — testable

**Display-only, deterministic:** the season is a *read* of `world.season` in the draw path
(no sim write); each season is a **cached variant** (§6a.11), never per-frame rng.

- **SPRING / SUMMER** — base ramps (§1).
- **FALL** — a **warmer CACHED RAMP**, NOT an alpha overlay (an alpha tint blends new
  colours and breaks the solid-fill/no-AA palette discipline): rotate each roof/wall ramp
  tone toward amber (~12–16° hue, +½ step value) into a cached ramp, redraw with it (keeps
  shingle texture + light split intact), + 2–4 **dry-leaf flecks** near the eaves
  (deterministic, §6a.10).
- **WINTER** — snow on up-facing surfaces, itself lit/shadowed so it does NOT flatten the
  light split.

**"Up-facing" is a decidable test, not a judgment call:** a surface is up-facing iff its
outward normal has a **positive up (screen −y) component** — i.e. **roof planes, flat-roof
tops, ridge caps, eave ledges, sills, chimney-cap tops.** Sheer WALL faces (normal
horizontal) and down-facing surfaces get **no snow**.

Snow is **ACCUMULATED, not painted on** — deterministic UNEVEN build-up, never a flat even band.

1. **Uneven thickness / drifts (deterministic).** Snow piles **THICKER where it collects** —
   along the ridge, in valleys where planes meet, at the eave lip, in corners — and is
   **THINNER / patchy elsewhere**, with **individual tiles peeking through unevenly at the
   lower/exposed edges** (NOT a straight horizontal cutoff). Drive the snow "front" per column
   from a **position hash** — `hash(buildingId,'winter',tileX,tileY)` → 0..1 — so the reach
   varies column-to-column (drifts) with occasional isolated patches below the front. **No
   `Math.random`** — stable + reproducible. Thicker/deeper snow (near the ridge) is whiter
   (`#ffffff`), thin snow tinted (`#eef4f4`/`#dbe8ec`).
2. **Snow reads THROUGH.** The tile detail underneath must still read where snow is thin: keep
   the per-tile course-bottom shadows + seams + lit edges visible (faintly) through the snow,
   so it looks like snow *sitting on tiles*, not white paint.
3. **Lumpy silhouette cap.** The top edge of the snow (ridge / cap) is **uneven and mounded** —
   small drifts that bulge the roofline; it's OK for snow to add **+1–2px mounds above the
   ridge** here and there (hash-chosen), so it reads as depth of snow, not a flat fill. (Still
   never a "white cone hat" on cones/apexes — round it.)
4. **Snow is lit per plane:** left-plane snow warmer, right-plane cooler — the light split
   still reads through the snow.
5. **Snow on ALL up-facing LEDGES** (this is what sells "it snowed on the whole building," not
   just the roof): the roof, a lumpy line on the **overhang lip**, a **cap on each window's top
   sill/frame**, snow on the **door lintel + threshold**, and a **dusting on the foundation
   sill** at the base. Every horizontal up-facing ledge collects a little (deterministic,
   lumpy). Keep the pane **frost** (pale blue-white) on windows.
6. **Attachments:** chimney **cap** gets snow (flat top); windmill **blades do NOT** (they
   spin). Icicles ≤2px under an eave, deterministic (§6a.10 / hash).

Snow whites match the CraftPix snow trees (`#eef4f4` / `#ffffff`) so a winter building sits
with the winter forest; readable at 1× — uneven, tiles-through, ledges dusted, never a uniform
white band.

---

## 7. Animation cadence (animated procedural sprites)

Display-only; the renderer picks frames off wall-clock (`performance.now`) —
builders themselves stay static per frame arg.

| Sprite | Frames | Cadence | Rule |
|---|---|---|---|
| Windmill blades | 4 minimum (X, +, and two mids) | 8–10 fps steady | 2-frame X/+ at 350 ms reads as a strobe — fails |
| Fish | 2 (tail flick) | ~3 fps, per-fish phase offset | OK |
| Lily pad | 2 states (bloom) | state-driven, no cycle | OK |
| Producer fallback walk | 2 | 3–6 fps by species | OK (fallback only) |
| Water/glints | ≤2 | ≥500 ms period | subtle; never full-surface flashing |

Rules: frame count 2 for idle ticks, 4+ for anything that rotates or strides;
neighboring instances must be phase-offset by seed so a row of windmills doesn't
metronome; animation may never change the sprite's silhouette footprint (depth
sort stability).

**Era note — sub-pixel motion + squash/stretch (§0.1 pt.6).** Genesis/SNES life came
from *tiny* secondary motion, not many frames. Prefer a 1-px bob, a 1-px squash on the
contact frame of a hop, and a 1-px stretch at the top of a jump over adding frames.
The producer "ready" bob and the farmer walk already do this; keep new animation in the
same register — 1–2 px of movement reads as alive, more reads as jitter. Squash/stretch
must conserve the silhouette's ground-contact row (no footprint drift).

---

## 8. PASS/FAIL checklist — every new/reworked procedural sprite

A sprite ships only if every box ticks:

- [ ] **P1 Palette-family**: every color is from §1's families (or a documented new
      family added there first); no `#000`, no full-white fills.
- [ ] **P2 Ramp depth + hue-shift**: ≥3 shades on every surface ≥6×6; ramps are
      HUE-SHIFTED per §1a (shadow cooler+desaturated, light warmer+saturated,
      30–65° total travel), NOT `shade()`-multiply-darkened.
- [ ] **P2b Era/material fidelity**: material handled per its §1b convention +
      exemplar target (wood grain-as-lines, stone cool courses, water flat steps +
      glint, roof warm→wine planes, etc.); reads as its §0 canon, not generic.
- [ ] **P3 Size class**: content box lands in its §2 class; relative-order rule
      holds against its neighbors (esp. buildings vs dwellings).
- [ ] **P4 Footprint**: base covers ≥60% of the claimed iso footprint; anchor at
      bottom-center with ≤2 px slack.
- [ ] **P5 Outline**: 1 px, tinted per-material, selective; **one ramp step below the
      adjacent fill** (§S.2 OUTLINE LAW / `outlineFor`); no global black ring; no orphaned
      AA pixels (no `arc`/`stroke`).
- [ ] **P6 Light**: upper-left light; +1-step light face, −1..2-step shadow face;
      AO pixel row at ground contact.
- [ ] **P7 Cast shadow**: present for anything ≥ farmer height (baked ellipse or
      renderer-drawn), `alpha 0.25–0.35`; **fixed ≤1 tile, uniform regardless of height,
      centered, one flat tone** (§S.2 SHADOW LAW / `seatShadow`) — never scaled with height.
- [ ] **P8 Texture**: no 1-px checkerboards; texture ≤15% of any surface.
- [ ] **P9 Readability**: silhouette identifiable at 1× on summer grass AND snow;
      key feature (door, wheel, comb…) survives at 1×.
- [ ] **P10 Determinism**: builder is pure — same args, same pixels; variation only
      via seed args; no `Math.random`/`Date.now`/sim reads.
- [ ] **P11 Animation** (if animated): §7 frame count + cadence; silhouette
      footprint stable across frames; seed-phased.
- [ ] **P12 Fallback parity** (if a sheet version exists): on-screen size within
      ±20% of the sheet sprite so pop-in doesn't rescale the scene.

Verification: render it in `/sprites.html` and in-game
(`python3 -m http.server 8055`, `/?fresh=1&seed=909`) at 1×, day + night + winter.
Then hold it beside its §0 exemplar (e.g. the barn beside an ALttP rooftop, the
pond beside *Chrono Trigger* water) — if the exemplar's technique isn't legible in
ours, it hasn't passed regardless of the boxes.

---

## Appendix: ABANDONED — corner-on isometric building projection (the mis-diagnosis)

**Recorded so the lesson isn't repeated.** For several batches the procedural buildings
were drawn **corner-on isometric** (the Landstalker / SimCity dialect): a rotated **2:1
diamond footprint**, **two wall faces receding** to a **near-vertical front corner**
(front-left LIT / front-right SHADOW), and a **sharp diamond hip/pyramid roof** peaking at
a point. The reasoning was "the ground is 2:1 dimetric, so match it."

**Why it was wrong:** the game's BUILDINGS must be drawn like its SPRITES (top-down ¾,
front-facing, upright — the CraftPix cottage/wells/characters), **not** like its FLOOR. The
2:1 diamond is the GROUND grid; a building is not a tilted floor tile. Matching the floor
made the buildings read "too isometric, too sharp diamond roofs, not top-down" — they sat
in a different plane from the cottage and the character sprites. The owner caught it.

**What was salvageable (folded into the top-down §6a as projection-independent technique):**
RAMPS / hue-shift colour, shingle-COURSE texture, the seasonal system (fall warm-ramp /
winter snow / deterministic flecks §6a.10), animation cadence, curved-body 3-band shading +
stepped ellipse/cone caps + curved-stone courses (§6a.4), and the openings/attachments/
determinism/cache/orc clauses — all reused once re-based on the front-facing frame.

**What was killed:** diamond footprint · `hh = hw/2` diamond vertices · two receding wall
faces · the near vertical corner edge · sharp hip/pyramid apex · "roof rakes off the
diamond axes." The corner-on POCs (`makeCoopIso`, `makeWellIso`, `makeWindmillIso`,
`makeMonumentIso`) remain in `pixel.js` as reference only — superseded by the top-down
builders (`makeCoopTD`, …) once the angle is signed off.
