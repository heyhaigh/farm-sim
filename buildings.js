// buildings.js — procedural TOP-DOWN buildings, drawn to the §S laws in PROCEDURAL_ART.md.
//
// This is the canonical home for code-drawn structures. It matters more than it looks:
// assets/ is gitignored (CraftPix licensing), so on a git-based deploy the sheet art is
// absent and these procedural builders are what players actually see.
//
// scratch_td/direct_1.js — ARCHETYPE 1 · GABLE (center-peak apex), top-down 3/4.
// The Slynyrd A-frame: the gable END faces the camera, so the ridge recedes and
// projects as a VERTICAL center line — the apex that breaks the horizontal roof.
// Two slope planes fan down-outward from it as a chevron band: HARD lit-left /
// dark-right split at the ridge (plane separation IS the volume — not outline).
// The band's bottom rake is the overhanging eave (dark fascia + AO whisper on
// the wall), and the timber gable-end wall shows beneath with a door + two
// windows + a small attic light under the peak. Pure fillRect, deterministic,
// cached per season. One light: imported LIGHT (upper-left) picks the lit slope.
//
// ROOF DEPTH: top-down exaggerates form, so the roof carries a tall foreshortened
// band (DEPTH) — a shallow band reads as a shed, not a house with interior volume.
import {
    makeCanvas, RAMPS, LIGHT, shade, outlineFor, seatShadow, sphereMask,
    stampCluster, recess, fillDiamond, TILE_W, TILE_H,
} from './pixel.js';

// Approved 2026-07-27. The canonical procedural top-down dwelling.

// deterministic position hash -> 0..1 (snow drift / scuff jitter; never Math.random).
function phash(a, b) {
    let n = ((a * 73856093) ^ (b * 19349663)) >>> 0;
    n ^= n >>> 15; n = (n * 2246822519) >>> 0; n ^= n >>> 13;
    return (n % 1024) / 1024;
}

// MASSING RULE (§S.2c): a SINGLE-STOREY building takes the FLAT wing (extPitch 0) — a
// pitched wing competes with a small gable. A TWO-STOREY or taller building can carry the
// PITCHED wing (~0.22): enough mass above for the slope to read as subordinate.
//   extPitch: side-wing roof slope (main roof is 0.6; 0 = a dead-flat lean-to)
//   extSide:  1 right · -1 left · 0 BOTH
const DEFAULTS = { extPitch: 0, extSide: 1 };

const _cache = {};
export function makeGableHouse(season = 'SUMMER', opts = {}) {
    const TUNE = { ...DEFAULTS, ...opts };
    const key = season + ':' + TUNE.extPitch + ':' + TUNE.extSide;
    if (_cache[key]) return _cache[key];
    const EXT_LEN = 18, EXT_ON = true;
    const extRight = EXT_ON && TUNE.extSide >= 0;
    const extLeft  = EXT_ON && TUNE.extSide <= 0;
    const SX = extLeft ? EXT_LEN : 0;                  // shift right to make room for a LEFT wing
    const [c, ctx] = makeCanvas(74 + (extLeft ? EXT_LEN : 0), 56);
    if (SX) ctx.translate(SX, 0);                      // integer translate — pixels are unchanged, just offset
    const winter = season === 'WINTER', fall = season === 'FALL';
    // fall = a gentle in-hue warm/brighten of the same ramps (shade(f>1) rotates warm)
    const warm = (f) => (col) => shade(col, f);
    const R = fall ? RAMPS.ROOF_RED.map(warm(1.05)) : RAMPS.ROOF_RED;
    const P = fall ? RAMPS.PLANK.map(warm(1.04)) : RAMPS.PLANK;
    const W = fall ? RAMPS.WOOD.map(warm(1.04)) : RAMPS.WOOD;
    const G = RAMPS.GLASS;
    const OLroof = outlineFor(RAMPS.ROOF_RED[1]);
    const OLwall = outlineFor(RAMPS.PLANK[1]);
    const OLwood = outlineFor(RAMPS.WOOD[1]);
    const SNOW_DEEP = '#ffffff', SNOW_MID = '#eef4f4', SNOW_THIN = '#dbe8ec';

    // ---- GEOMETRY — the chevron gable ----
    // Ridge recedes from the camera -> vertical apex line between columns 27|28.
    // Each plane: top edge = FAR rake, bottom edge = NEAR rake (the eave over the
    // front). Band depth (foreshortened roof run front->back) is constant.
    const CXL = 27, CXR = 28;
    const dOf = (x) => (x <= CXL ? CXL - x : x - CXR);   // distance from the ridge
    const HALF = 23;                                     // eave half-extent -> roof x 4..51, leaving MARGIN either side.
                                                         // (was 26 = x 1..54, flush against the canvas: the outer tiles had
                                                         // nowhere to jut, so the silhouette got cut into a hard vertical wall.)
    const DEPTH = 22;                                    // foreshortened band thickness — a TALL roof; top-down exaggerates, and depth is what separates "house" from "shed"
    // SIDE WING = a CONTINUATION of the roof, not a separate mass. The band simply KINKS
    // to a shallower pitch past the break: DEPTH is unchanged, so the far rake AND the eave
    // both carry straight on, and because the course grid is measured off the rake, the
    // shingle pattern runs unbroken from the gable into the wing (a catslide / saltbox).
    const EXT = { on: EXT_ON, side: TUNE.extSide, len: EXT_LEN, pitch: TUNE.extPitch };
    const ACTIVE_SIDES = [extRight ? 1 : null, extLeft ? -1 : null].filter((v) => v !== null);
    const MAIN_PITCH = 0.6;
    const topAt = (d) => (d <= HALF
        ? 3 + Math.floor(d * MAIN_PITCH)
        : 3 + Math.floor(HALF * MAIN_PITCH) + Math.floor((d - HALF) * EXT.pitch));
    const botAt = (d) => topAt(d) + DEPTH;               // near rake (eave) — same offset, so it continues too
    const extSide = (x) => (x > CXR ? 1 : -1);
    const hasWing = (x) => (extSide(x) > 0 ? extRight : extLeft);
    const maxD = (x) => (hasWing(x) ? HALF + EXT.len : HALF);
    const litLeft = LIGHT.x < 0;                         // the sun picks the lit slope
    const WX0 = 7, WX1 = 48, WY1 = 53;                   // wall extents; base at canvas bottom
    const WX1E = WX1 + (extRight ? EXT.len : 0);   // wall carries on beneath each wing
    const WX0E = WX0 - (extLeft ? EXT.len : 0);
    const RX0 = CXL - (HALF + (extLeft ? EXT.len : 0)) - 1;      // roof-loop bounds (may go negative; the translate covers it)
    const RX1 = CXR + (HALF + (extRight ? EXT.len : 0)) + 1;
    // EDGE TREATMENT — three edges, three jobs (settled after getting it wrong twice):
    //   TOP (far rake)      -> CLEAN straight line. No jitter.
    //   BOTTOM (near eave)  -> CLEAN straight line. Structural.
    //   LEFT/RIGHT OVERHANG -> stepped in whole COURSE BANDS. Keying the stagger to each
    //      column's OWN course origin (which slides along the rake) made the steps drift
    //      out of register with the visible tile courses — it read as noise. Keying it to
    //      a GLOBAL row band instead makes every step a clean 4-row block, so the ends
    //      read as courses of tile setting differently.
    // The cottage's rake edge is NOT a straight line with chunks carved out (that read as
    // damage). It is the SHINGLES' OWN SILHOUETTE: every tile is a rounded scallop, so the
    // edge bulges across a tile's body and tucks back between tiles — a regular ~2px
    // rhythm locked to the courses, not random noise. This profile is one tile's rounded
    // end, repeated down the rake.
    // Profile of ONE tile's rounded end: tucked at the seams, proud through the belly.
    // [0,0,1,2] was a sawtooth (flush straight to 2px) and read HARSH — the eye saw
    // notches. Bulging 1px through the middle instead gives a soft scallop.
    const SCALLOP = [1, 0, 0, 1];                                 // APPROVED profile: 1px deep, tucked at both seams
    const edgeInset = (y) => SCALLOP[((y % SCALLOP.length) + SCALLOP.length) % SCALLOP.length];
    const onRoof = (x) => dOf(x) <= maxD(x);                         // straight outer bound; the per-course stagger is applied per pixel

    // ---- grounding FIRST (behind): fixed <=1-tile seat shadow (SHADOW LAW) ----
    // NO SEAT SHADOW on buildings. The SHADOW LAW clamps it to <=1 tile (rx = TILE_W/2),
    // which correctly seats a PROP but renders a 20px smudge floating under the centre of
    // a ~90px building — unrelated to the footprint, so it reads as a stray line. The base
    // outline + the building's own eave shadows do the grounding instead. Revisit a proper
    // footprint-width shadow when buildings are wired into real terrain.

    // ---- FRONT WALL — the gable-end pentagon under the roof's near rake ----
    for (let x = WX0E; x <= WX1E; x++) {
        const d = dOf(x);
        const yTop = botAt(d) + 1;                       // wall shows below the eave
        const h = WY1 - yTop + 1;
        if (h <= 0) continue;
        let col = P[2];
        if (litLeft ? x <= WX0 + 2 : x >= WX1 - 2) col = shade(P[2], 1.14);       // lit edge — warm tan, not gold (cottage timber ~#94614a)
        else if (litLeft ? x >= WX1 - 5 : x <= WX0 + 5) col = P[1];               // shadow band
        if (litLeft ? x >= WX1 - 1 : x <= WX0 + 1) col = P[0];                    // side reveal
        ctx.fillStyle = col; ctx.fillRect(x, yTop, 1, h);
    }
    // PLANK SEAMS — texture, so (like the rafter tails) they must darken/lighten the wall
    // PROPORTIONALLY. These were absolute tones — the lit companion line shade(P[2],1.12)
    // in particular sat too bright on the mid-wall regardless of what was underneath.
    // A translucent pair scales with the surface and stays subordinate to it everywhere.
    for (const sx of [17, 21, 33]) {
        const yTop = botAt(dOf(sx)) + 3, hgt = 49 - yTop;
        ctx.fillStyle = 'rgba(0,0,0,0.16)';           ctx.fillRect(sx, yTop, 1, hgt);
        ctx.fillStyle = 'rgba(255,238,210,0.07)';     ctx.fillRect(sx + 1, yTop, 1, hgt);
    }
    // foundation sill + ground AO (base row at the BOTTOM — never broken)
    // The base ran as ONE flat tone with a uniformly bright top row straight across the
    // whole footprint — the only element on the building not obeying the light. Grade it
    // along the sun so the left (lit) end is warmest and it falls off to the right.
    {
        const bx0 = WX0E - 1, bx1 = WX1E + 1;
        for (let x = bx0; x <= bx1; x++) {
            const t = (x - bx0) / Math.max(1, bx1 - bx0);       // 0 at the lit end .. 1 at the shadow end
            const base = shade(W[1], 1.07 - t * 0.15);
            ctx.fillStyle = base;                ctx.fillRect(x, 51, 1, 3);
            ctx.fillStyle = shade(base, 1.10);   ctx.fillRect(x, 51, 1, 1);   // top edge catches the light
        }
    }
    // Base outline: terminates the silhouette against the terrain. With the seat shadow
    // gone this is what grounds the building, so it earns its place.
    ctx.fillStyle = OLwood; ctx.fillRect(WX0E, 54, WX1E - WX0E + 1, 1);
    // wall side outlines (lower half + base per OUTLINE LAW; sky edges stay open)
    ctx.fillStyle = OLwall;
    ctx.fillRect(WX0E - 1, botAt(dOf(WX0E)) + 1, 1, 53 - botAt(dOf(WX0E)));
    ctx.fillRect(WX1E + 1, botAt(dOf(WX1E)) + 1, 1, 53 - botAt(dOf(WX1E)));

    // ---- OPENINGS (recessed; framed; whisper shadows) ----
    // door — centered under the apex, seated on the foundation
    // A door has to MEET THE GROUND. This one stopped at y50 while the base band runs to
    // y53, so the foundation crossed in front of it and the door read as floating above
    // a planter. It now runs all the way down to the base line; the foundation simply
    // stops either side of it.
    ctx.fillStyle = OLwood; ctx.fillRect(24, 40, 8, 14);
    ctx.fillStyle = W[2]; ctx.fillRect(25, 41, 6, 13);
    ctx.fillStyle = shade(W[3], 1.06); ctx.fillRect(25, 41, 1, 13);   // lit jamb
    ctx.fillStyle = shade(W[1], 0.9); ctx.fillRect(30, 41, 1, 13);    // shadow jamb
    ctx.fillStyle = shade(W[2], 1.1); ctx.fillRect(25, 41, 6, 1);     // lit lintel
    ctx.fillStyle = W[1]; ctx.fillRect(28, 42, 1, 12);                // leaf seam
    ctx.fillStyle = shade(W[4], 1.1); ctx.fillRect(29, 46, 1, 1);     // handle
    ctx.fillStyle = 'rgba(0,0,0,0.16)'; ctx.fillRect(25, 53, 6, 1);   // contact shadow where it meets the ground
    // two windows flanking the door — frame + 2x2 panes + streak (§6a-D.3)
    for (const wx of [12, 37]) {
        ctx.fillStyle = OLwood; ctx.fillRect(wx - 1, 38, 9, 9);
        ctx.fillStyle = W[2]; ctx.fillRect(wx, 39, 7, 7);
        ctx.fillStyle = shade(W[3], 1.1); ctx.fillRect(wx, 38, 7, 1);        // top-sill highlight
        recess(ctx, wx + 1, 40, 5, 5, winter ? '#a2bcc6' : G[0], W[1]);
        ctx.fillStyle = winter ? '#b6cdd6' : G[1]; ctx.fillRect(wx + 1, 40, 5, 2);   // sky-lit top
        ctx.fillStyle = winter ? '#e8f4f8' : G[2];                            // diagonal streak
        ctx.fillRect(wx + 1, 43, 1, 1); ctx.fillRect(wx + 2, 42, 1, 1); ctx.fillRect(wx + 3, 41, 1, 1);
        ctx.fillStyle = W[1];                                                 // mullion cross
        ctx.fillRect(wx + 3, 40, 1, 5); ctx.fillRect(wx + 1, 42, 5, 1);
        ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(wx - 1, 47, 9, 1);   // bottom-sill whisper
    }
    // attic light in the gable peak, just under the apex
    ctx.fillStyle = OLwood; ctx.fillRect(25, 29, 6, 6);
    ctx.fillStyle = W[2]; ctx.fillRect(26, 30, 4, 4);
    ctx.fillStyle = winter ? '#b6cdd6' : G[1]; ctx.fillRect(27, 31, 2, 2);
    ctx.fillStyle = winter ? '#e8f4f8' : G[2]; ctx.fillRect(27, 32, 1, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.10)'; ctx.fillRect(25, 35, 6, 1);

    // ---- WING FACADE — its own openings, so the addition reads as used, not blank ----
    for (const dir of ACTIVE_SIDES) {
        const wingMid = dir > 0 ? WX1 + 10 : WX0 - 10;
        const wallTopAt = (x) => botAt(dOf(x)) + 1;
        // ARCHED BARN DOOR (a different doorway to the main house's square one)
        const bdx = wingMid - 1, bdw = 9;
        const bdTop = wallTopAt(bdx) + 4, bdBot = 53;      // down to the base line, not stopping above it
        for (let k = 0; k < bdw; k++) {
            const x = bdx + k;
            // arch: shoulders tucked in 2 rows, crown flat
            const inset = (k === 0 || k === bdw - 1) ? 2 : (k === 1 || k === bdw - 2) ? 1 : 0;
            const yTop = bdTop + inset;
            ctx.fillStyle = OLwood; ctx.fillRect(x, yTop, 1, bdBot - yTop + 1);
            ctx.fillStyle = (k === 0 || k === bdw - 1) ? shade(W[1], 0.9) : W[1];
            ctx.fillRect(x, yTop + 1, 1, bdBot - yTop - 1);
        }
        ctx.fillStyle = shade(W[2], 1.08); ctx.fillRect(bdx + 1, bdTop + 1, 1, bdBot - bdTop - 1);  // lit jamb
        ctx.fillStyle = shade(W[0], 0.9); ctx.fillRect(bdx + bdw - 2, bdTop + 1, 1, bdBot - bdTop - 1); // shadow jamb
        for (let k = 2; k < bdw - 2; k += 2) { ctx.fillStyle = shade(W[1], 0.82); ctx.fillRect(bdx + k, bdTop + 3, 1, bdBot - bdTop - 3); } // plank seams
        ctx.fillStyle = shade(W[3], 1.1); ctx.fillRect(bdx + 2, bdTop + 2, bdw - 4, 1);   // lit lintel across the arch
        ctx.fillStyle = 'rgba(0,0,0,0.16)'; ctx.fillRect(bdx + 1, 53, bdw - 2, 1);        // contact shadow at the ground
        // small square window on the far side of the wing
        const wwx = dir > 0 ? bdx + bdw + 3 : bdx - 8;
        if (wwx > WX0E && wwx + 5 < WX1E) {
            const wy = wallTopAt(wwx) + 5;
            ctx.fillStyle = OLwood; ctx.fillRect(wwx - 1, wy - 1, 7, 7);
            ctx.fillStyle = W[2]; ctx.fillRect(wwx, wy, 5, 5);
            recess(ctx, wwx + 1, wy + 1, 3, 3, winter ? '#a2bcc6' : G[0], W[1]);
            ctx.fillStyle = winter ? '#b6cdd6' : G[1]; ctx.fillRect(wwx + 1, wy + 1, 3, 1);
            ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(wwx - 1, wy + 6, 7, 1);
        }
    }

    // ---- ROOF — two slope planes fanning from the vertical ridge apex ----
    //
    // BACK-POCKET (do not delete): the "chevron zigzag" texture — a bold herringbone
    // wave, too mechanical for a cottage but a striking look worth reusing on a
    // civic/temple roof or an orc structure. Recipe:
    //     const course = (y - top) + (d % 2);
    //     if (course % 3 === 0)      col = shade(col, 0.8);    // seam
    //     else if (course % 3 === 1) col = shade(col, 1.06);   // lit lip, BOTH planes
    //
    for (let x = RX0; x <= RX1; x++) {
        const d = dOf(x);
        if (!onRoof(x)) continue;
        const t0 = topAt(d), b0 = botAt(d);              // the TRUE rake — shading + courses anchor here
        // JITTERED silhouette — only the edge goes ragged. top is clamped to 1 so the
        // far-rake outline at top-1 always lands ON the canvas (at 3px jitter it was
        // resolving to y=-1 at the ridge and getting clipped away).
        // The notch RAMPS IN with distance from the ridge. A flat clamp at the peak
        // instead flattened the apex into a 6px plateau (the proud tiles ate all the
        // headroom); tying the depth to d/3 keeps the peak tapering while the outer
        // rake — where the eye actually reads the edge — gets the full notch.
        const top = t0, bot = b0;                        // BOTH rakes clean + straight
        const side = x <= CXL ? 0 : 1;
        const lit = (x <= CXL) === litLeft;              // which plane this column is on
        let firstY = -1;
        for (let y = top; y <= bot; y++) {
            // the OVERHANGING end steps back in whole course bands
            if (d > maxD(x) - edgeInset(y)) continue;   // scallop applies at the TRUE outer edge (the wing's end), not the main half-extent
            // CLEAN upper-left split: the whole LEFT plane is lit, the whole RIGHT plane is
            // shadow. No ridge-distance gradient (that mirrored the value on both sides and
            // read as an inconsistent light). One tone per plane + a consistent VERTICAL grade.
            let col = lit ? R[3] : R[1];
            // WING PLANE base: a shallower pitch tips toward the sky, so it lifts OUT of the
            // main roof's shadow (the cottage does exactly this). Flat = brightest. This must
            // be the BASE tone — applied after the course shading it just flattened the wing
            // into a solid block.
            const onWing = d > HALF;
            if (onWing) col = (EXT.pitch <= 0.06 ? R[3] : R[2]);
            const f = (y - t0) / Math.max(1, b0 - t0);                         // 0 = far rake (ridge) .. 1 = eave (anchored, so jitter never smears the grade)
            if (f < 0.12) col = shade(col, lit ? 1.08 : 1.03);                 // ridge lip catches sky-light; muted on the shadow plane
            else if (f > 0.85) col = shade(col, 0.86);                         // deepen toward the eave
            // SCALLOPED SHINGLES — individual overlapping TILES (the cottage's read):
            // chunky scales ~5px wide in 4-row courses, brick-staggered so their tips
            // overlap. Per tile: a lit top edge, a dark bottom lip (the shadow the course
            // above throws onto it), knocked bottom corners so the tip reads ROUND rather
            // than square, and a sparse whole-tile tone shift so the field weathers
            // organically instead of repeating. The lit lip fires only on the LIT plane —
            // the shadow plane stays committed to shadow (upper-left light, unambiguous).
            const CH = 4, TWs = 5;
            const row = y - t0;                                                 // course grid anchored to the true rake — the tile field stays coherent
            const ci = Math.floor(row / CH), rr = ((row % CH) + CH) % CH;
            const stag = (ci % 2) * 2;                                          // brick offset every other course
            const tcol = (x + stag) % TWs;
            const tid = Math.floor((x + stag) / TWs);
            if (rr === CH - 1) col = shade(col, lit ? 0.78 : 0.87);            // overlap shadow beneath the scale
            else if (rr === 0 && (lit || onWing)) col = shade(col, 1.1);                   // lit top edge of the scale
            if (tcol === 0) col = shade(col, 0.9);                              // seam between neighbouring tiles
            if (rr === CH - 1 && (tcol === 0 || tcol === TWs - 1)) col = shade(col, 0.84);   // knocked corners -> rounded tip
            if (phash(tid, ci) > 0.86) col = shade(col, 0.95);                  // sparse weathered tile (organic variety)
            // ---- SLYNYRD LIGHTING PASS (57-House, frames ~170 -> 190) ----
            // He lays FLAT dull tile work, then lights the whole plane in ONE pass:
            //   (a) a per-tile DIAGONAL highlight stroke — the biggest single source of
            //       visual density (courses alone read as stripes);
            //   (b) a BROAD gradient across the plane that IGNORES tile boundaries;
            //   (c) a value lift so the plane reads lit rather than merely pale.
            {
                const strokeA = onWing ? 1.12 : lit ? 1.10 : 1.05;
                const strokeB = onWing ? 1.05 : lit ? 1.04 : 1.02;
                if ((tcol + rr) % 4 === 1) col = shade(col, strokeA);      // (a) stroke across the tile face
                else if ((tcol + rr) % 4 === 2) col = shade(col, strokeB); //     softer trailing edge
                const gv = (y - t0) / Math.max(1, b0 - t0);                // 0 at the rake .. 1 at the eave
                if (onWing) {
                    // LATERAL falloff follows the WORLD LIGHT (upper-left), NOT distance from
                    // the house — that was mirror-symmetric and therefore wrong on one side.
                    // A RIGHT wing runs AWAY from the sun -> darkens outward. A LEFT wing runs
                    // TOWARD the sun -> it is the most intensely lit plane on the whole
                    // building and must BRIGHTEN outward. Universal rule for every left-hand
                    // extension, inherited from the one light the sprites already establish.
                    const gx = (d - HALF) / Math.max(1, EXT.len);
                    const lateral = extSide(x) < 0 ? +gx * 0.10 : -gx * 0.16;
                    col = shade(col, 1.10 + lateral - gv * 0.10);          // (b)+(c)
                } else {
                    // main gable planes: brightest at the ridge, easing toward the outer rake
                    const gd = d / HALF;
                    col = shade(col, (lit ? 1.05 : 1.0) - gd * (lit ? 0.08 : 0.05) - gv * 0.06);
                }
            }
            if (y === bot) col = onWing ? shade(R[1], 0.92) : lit ? shade(R[1], 0.8) : R[0];                // near-rake FASCIA — the dark overhanging eave edge
            if (firstY < 0) firstY = y;
            ctx.fillStyle = col; ctx.fillRect(x, y, 1, 1);
        }
        // outline sits above whatever actually got drawn (the per-course stagger means
        // the topmost drawn row varies), never over empty space
        if (firstY >= 0) { ctx.fillStyle = OLroof; ctx.fillRect(x, firstY - 1, 1, 1); }
    }
    // the APEX — vertical ridge crease: bright on the lit side, deep on the dark side
    const ridgeTop = topAt(0), ridgeBot = botAt(0);
    ctx.fillStyle = shade(R[4], 1.08);
    ctx.fillRect(litLeft ? CXL : CXR, ridgeTop, 1, DEPTH);
    ctx.fillStyle = R[0];
    ctx.fillRect(litLeft ? CXR : CXL, ridgeTop, 1, DEPTH + 1);
    ctx.fillStyle = OLroof; ctx.fillRect(CXL, ridgeTop - 1, 2, 1);             // apex cap pixel pair
    // eave AO on the wall directly under the overhang — deepened to ~13% so the roof
    // reads as genuinely casting onto the wall; follows the jittered tile tips.
    ctx.fillStyle = 'rgba(0,0,0,0.13)';
    for (let x = WX0E; x <= WX1E; x++) ctx.fillRect(x, botAt(dOf(x)) + 1, 1, 2);
    // overhang undersides beyond the wall (the eave tips) — a 1px outline stepping
    // down the near rake so the tips read as a slab edge, not a floating line
    ctx.fillStyle = OLroof;
    for (let x = RX0; x < WX0E; x++) if (onRoof(x)) ctx.fillRect(x, botAt(dOf(x)) + 1, 1, 1);
    for (let x = WX1E + 1; x <= RX1; x++) if (onRoof(x)) ctx.fillRect(x, botAt(dOf(x)) + 1, 1, 1);

    // ---- WING EAVE: SOFFIT SHADOW (not a lit beam) ----
    // The eave OVERHANGS, so whatever sits directly beneath it is in SHADOW. The first
    // version put a LIT timber highlight (#a27b4a) hard against the dark fascia — a
    // light-on-dark band that read as neither a drop shadow nor a beam, just a stripe.
    // Now: the roofline casts a genuine graded shadow onto the wall, and the only timber
    // left is a few dark beam-END ticks poking below it, which read as structure.
    for (const dir of ACTIVE_SIDES) {
        const bx0 = dir > 0 ? WX1 + 1 : WX0E;
        const bx1 = dir > 0 ? WX1E : WX0 - 1;
        for (let x = bx0; x <= bx1; x++) {
            const y = botAt(dOf(x)) + 1;
            ctx.fillStyle = 'rgba(0,0,0,0.30)'; ctx.fillRect(x, y, 1, 1);       // darkest right at the roofline
            ctx.fillStyle = 'rgba(0,0,0,0.16)'; ctx.fillRect(x, y + 1, 1, 1);   // easing out of shadow
            // RAFTER TAILS — texture, so they must darken the wall PROPORTIONALLY rather
            // than stamp an absolute near-black on it. The fixed W[0] tone read as harsh
            // striations, worst on the LEFT wing where the wall is lit and the contrast
            // jump was largest. A translucent wash scales with whatever it lands on, so
            // one value now works on both the lit and the shadowed flank.
            if ((x - bx0) % 5 === 2) {
                ctx.fillStyle = 'rgba(0,0,0,0.15)'; ctx.fillRect(x, y + 2, 1, 2);
                ctx.fillStyle = 'rgba(255,238,210,0.07)'; ctx.fillRect(x + 1, y + 2, 1, 2);   // faint lit edge gives the tail form
            }
        }
    }

    // ---- WINTER — snow rides the planes from the ridge out; fascia + seams read through ----
    if (winter) {
        for (let x = RX0; x <= RX1; x++) {
            const d = dOf(x);
            if (!onRoof(x)) continue;
            const top = topAt(d), bot = botAt(d);
            const lit = (x <= CXL) === litLeft;
            const reach = 15 + Math.floor(phash(x, 5) * 5);        // jittered snow line down the slope
            if (d > reach) continue;
            ctx.fillStyle = lit ? (d < 8 ? SNOW_DEEP : SNOW_MID) : SNOW_THIN;   // planes still separate under snow
            ctx.fillRect(x, top, 1, bot - top);                    // keep the fascia row dark
            if (d > 2 && d % 5 === 0) { ctx.fillStyle = 'rgba(0,0,0,0.07)'; ctx.fillRect(x, top, 1, bot - top); }
            if (d === reach) { ctx.fillStyle = 'rgba(0,0,0,0.10)'; ctx.fillRect(x, top, 1, bot - top); }   // melt edge
        }
        ctx.fillStyle = SNOW_DEEP; ctx.fillRect(litLeft ? CXL : CXR, ridgeTop, 1, DEPTH);
        ctx.fillStyle = SNOW_THIN; ctx.fillRect(litLeft ? CXR : CXL, ridgeTop, 1, DEPTH);
        for (const wx of [11, 36]) for (let k = 0; k < 9; k++) {   // sill snow ticks
            const up = phash(wx + k, 17) > 0.62 ? 1 : 0;
            ctx.fillStyle = SNOW_MID; ctx.fillRect(wx + k, 37 - up, 1, 1 + up);
        }
        for (let k = 0; k < 8; k++) if (phash(24 + k, 19) > 0.55) { ctx.fillStyle = SNOW_MID; ctx.fillRect(24 + k, 39, 1, 1); }
    }

    // ---- GROUNDING scuffs at the foundation (landscape contact, §S.1.6) ----
    const scuff = (x, col) => {
        ctx.fillStyle = col;
        ctx.fillRect(x, 50, 1, 2); ctx.fillRect(x - 1, 51, 1, 1); ctx.fillRect(x + 1, 51, 1, 1);
    };
    if (winter) { scuff(10, SNOW_MID); scuff(45, SNOW_MID); ctx.fillStyle = SNOW_THIN; ctx.fillRect(18, 52, 20, 1); }
    else {
        const gA = fall ? '#7d6a2c' : RAMPS.FOLIAGE[4], gB = fall ? '#5f5322' : RAMPS.FOLIAGE[3];
        scuff(10, gA); scuff(15, gB); scuff(40, gB); scuff(45, gA);
        // (removed) A scatter of absolute-dark pixels along y52 in front of the door,
        // meant as worn threshold dirt. It ran in the grounding pass AFTER the doors, so
        // once the doors reached the ground it strewed debris across their base — and it
        // fought the graded base line. Ground wear belongs in the terrain, not stamped
        // over the building's own footprint.
    }
    if (fall) for (const [col, lx, ly] of [['#c9782a', 3, 37], ['#a8531e', 52, 37], ['#d89a34', 6, 36], ['#b8641a', 49, 36]]) {
        ctx.fillStyle = col; ctx.fillRect(lx, ly, 1, 1);
    }

    _cache[key] = c;
    return c;
}
