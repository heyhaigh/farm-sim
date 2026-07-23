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

---

## 3. Outline & edge

1. **Selective, 1 px, tinted.** Silhouette gets an outline only where it must
   separate from busy ground: the lower half + base of a sprite, and any edge that
   would otherwise vanish against grass. Sky-facing edges may stay open (the sheet
   tree has none on top).
2. **Outline color = darkest ramp step of the local material** (chick uses
   `#59332a`, canopy uses `#193926`). Never `#000`, never one global outline hue
   around different materials.
3. **Interior lines** (plank seams, stone courses, door frames) use the material's
   shadow step, 1 px, never the outline color — outlines frame, seams texture.
4. **Corner rounding:** knock out single corner pixels on any box ≥8 px wide
   (the head-corner `clearRect` trick in `composeFarmer` is the pattern).
5. **No anti-aliasing.** Canvas `arc()`, `stroke()`, `lineTo()` fills are BANNED in
   sprite builders — they emit half-alpha edge pixels (see `makeMill`'s millstone).
   Circles are drawn as stepped fillRect rows (the `canopyBlob` ellipse pattern).

---

## 4. Light & shading

1. **One sun: upper-left.** Light faces: top + left. Shadow faces: right + bottom.
   Every sprite, no exceptions, all seasons.
2. **Quantities:** top/light face ≈ base +1 ramp step; right/bottom shadow face ≈
   base −1..−2 steps. A 3/4-sphere form (canopy, animal barrel) gets: dark
   silhouette → mid body nudged up-left → small light patch at upper-left
   (~25% of the area) → darker underside crescent (`canopyBlob` implements this).
3. **AO at contact:** 1 px of the material's darkest step where the sprite meets
   the ground (feet, trunk base, wall base). Already the pattern in
   `trunkFlared` / `makeStump` — mandatory everywhere.
4. **Cast shadow:** every standing sprite ≥ farmer height gets a ground shadow —
   either baked into the sprite as a 2:1 ellipse `rgba(10,14,10,0.30±0.05)`
   (max 3 rows tall), or drawn by the renderer (the farmer's 14×2 foot-shadow).
   Buildings with no cast shadow float — fail.
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
- [ ] **P5 Outline**: 1 px, tinted per-material, selective; no global black ring;
      no orphaned AA pixels (no `arc`/`stroke`).
- [ ] **P6 Light**: upper-left light; +1-step light face, −1..2-step shadow face;
      AO pixel row at ground contact.
- [ ] **P7 Cast shadow**: present for anything ≥ farmer height (baked ellipse or
      renderer-drawn), `alpha 0.25–0.35`.
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
