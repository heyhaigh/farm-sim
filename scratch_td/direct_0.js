// direct_0.js — ARCHETYPE 0: SLAB + CENTRAL DORMER APEX (the cottage archetype).
// Top-down roof grammar (Slynyrd Pixelblog 51 / CraftPix cottage): the roof is a flat
// HORIZONTAL SLAB — lit top strip (sky-facing plane), mid body with shingle courses,
// DARK overhanging eave + fascia underside, beveled top corners. The APEX that stops
// it reading as a flat box is a CENTRAL FORWARD GABLE: a triangle in front of the slab
// with its OWN lit-left / dark-right plane split (the Slynyrd chevron), a round OCULUS
// window in its stone face, and a forward BAY + DOOR beneath it. Sides stay simple and
// symmetric — no competing hip facets. Stone walls, a 2-window grid per side.
// One light (LIGHT, upper-left) · outlineFor() outlines · recess() openings ·
// seatShadow() FIRST · base row at the canvas BOTTOM · overflow TOP-only ·
// pure fillRect, deterministic (no Math.random / Date / drawImage / globalAlpha / arc).
import { makeCanvas, RAMPS, LIGHT, shade, outlineFor, seatShadow, sphereMask, stampCluster, recess, fillDiamond, TILE_W, TILE_H } from '../pixel.js';

export const meta = { name: 'Slab + Central Dormer Cottage (DIRECT)', pm: false };

// deterministic position hash -> 0..1 (module-local; NEVER Math.random / Date). Pure.
function phash(a, b) {
    let n = ((a * 73856093) ^ (b * 19349663)) >>> 0;
    n ^= n >>> 15; n = (n * 2246822519) >>> 0; n ^= n >>> 13;
    return (n % 1024) / 1024;
}
// FALL warms a ramp in-hue via shade() (deterministic; hue-shift lives inside shade).
const warm = (ramp) => ramp.map((c) => shade(c, 1.05));
// stepped circle rows (no arc/AA): fn(x0, y, w) per row, symmetric about cx (=*.5 ok).
function circleRows(cx, cy, r, fn) {
    const R = Math.ceil(r);
    for (let dy = -R; dy <= R; dy++) {
        const f = r * r - dy * dy;
        if (f <= 0) continue;
        const half = Math.sqrt(f);
        const x0 = Math.round(cx - half), x1 = Math.round(2 * cx) - x0; // mirror-exact
        fn(x0, cy + dy, x1 - x0 + 1);
    }
}

const _cache = {};
export function makeBuilding(season = 'SUMMER') {
    if (_cache[season]) return _cache[season];
    const [c, ctx] = makeCanvas(60, 58);
    const winter = season === 'WINTER', fall = season === 'FALL';
    const R = fall ? warm(RAMPS.ROOF_RED) : RAMPS.ROOF_RED;
    const S = RAMPS.STONE;                                   // stone stays cool in fall
    const Wd = fall ? warm(RAMPS.WOOD) : RAMPS.WOOD;
    const G = RAMPS.GLASS;
    const OLroof = outlineFor(R[1]), OLstone = outlineFor(S[1]), OLwood = outlineFor(Wd[1]);
    const SNOW_DEEP = '#ffffff', SNOW_MID = '#eef4f4', SNOW_THIN = '#dbe8ec', SNOW_TINT = '#dfeaec';
    const litLeft = LIGHT.x < 0;                             // ONE sun, from pixel.js — never hardcoded

    const CX = 29.5;                                         // canvas center (cols 0..59); mirror of x is 59-x
    const mir = (x) => 59 - x;

    // ---- GROUNDING FIRST (behind everything): fixed <=1-tile seat shadow ----
    seatShadow(ctx, { cx: CX, cy: 56, rx: 16, ry: 3 }, { alpha: 0.30 });

    // ======================= ROOF: the HORIZONTAL SLAB =======================
    // Lit top strip / mid body / dark eave — the vertical light-dark plane split.
    const SX0 = 2, SX1 = 57;                                 // slab span (wall is 7..52 -> 5px overhang/side)
    const slabTop = 8, bodyTop = 12, bodyBot = 23, fasciaA = 24, fasciaB = 25;
    const seams = new Set([15, 19, 23]);                     // shingle course bottoms
    const courseIdx = (y) => { let n = 0; for (const b of seams) if (b < y) n++; return n; };
    const gradeAt = (y) => {                                 // front slope: ridge-side bright -> eave-side dark
        const t = (y - bodyTop) / (bodyBot - bodyTop);
        return t < 0.35 ? R[3] : t < 0.65 ? shade(R[3], 0.93) : t < 0.9 ? R[2] : shade(R[2], 0.9);
    };
    // beveled top corners (rows 8-9 inset), then the lit sky-facing strip
    ctx.fillStyle = shade(R[4], 1.05); ctx.fillRect(SX0 + 2, slabTop, (SX1 - SX0 + 1) - 4, 1);
    ctx.fillStyle = R[4];              ctx.fillRect(SX0 + 1, slabTop + 1, (SX1 - SX0 + 1) - 2, 1);
    ctx.fillStyle = shade(R[3], 1.12); ctx.fillRect(SX0, slabTop + 2, SX1 - SX0 + 1, 2);
    // mid body with courses (dark seam row, lit course-top row, half-offset shingle ticks)
    for (let y = bodyTop; y <= bodyBot; y++) {
        const isSeam = seams.has(y), isLitTop = seams.has(y - 1), ci = courseIdx(y);
        for (let x = SX0; x <= SX1; x++) {
            let col = gradeAt(y);
            if (!isSeam && ((x + (ci % 2) * 3) % 6 === 0)) col = shade(col, 0.94);
            if (isSeam) col = shade(col, 0.85); else if (isLitTop) col = shade(col, 1.06);
            ctx.fillStyle = col; ctx.fillRect(x, y, 1, 1);
        }
    }
    // DARK overhanging eave: 2-row fascia + outline ends + fascia underside past the wall
    ctx.fillStyle = R[1];              ctx.fillRect(SX0, fasciaA, SX1 - SX0 + 1, 1);
    ctx.fillStyle = shade(R[1], 0.88); ctx.fillRect(SX0, fasciaB, SX1 - SX0 + 1, 1);
    ctx.fillStyle = OLroof;
    ctx.fillRect(SX0 - 1, slabTop + 2, 1, fasciaB - slabTop - 1);  // side silhouettes
    ctx.fillRect(SX1 + 1, slabTop + 2, 1, fasciaB - slabTop - 1);
    ctx.fillRect(SX0, 26, 5, 1); ctx.fillRect(53, 26, 5, 1);       // underside of the overhang

    // ================= APEX: the CENTRAL FORWARD GABLE (dormer) =================
    // A triangle IN FRONT of the slab: chevron peak with lit-left / dark-right roof
    // bands, a stone face carrying the OCULUS, base merging into the eave line.
    const gTop = 0, gBase = 23;
    const halfw = (y) => 1 + 11.5 * (y - gTop) / (gBase - gTop);
    for (let y = gTop; y <= gBase; y++) {
        const lx = Math.round(CX - halfw(y)), rx = mir(lx);
        if (y === gTop) {                                     // dark cap over the very top (back edge, never a bright point)
            ctx.fillStyle = OLroof; ctx.fillRect(lx, y, rx - lx + 1, 1);
            continue;
        }
        ctx.fillStyle = OLroof; ctx.fillRect(lx - 1, y, 1, 1); ctx.fillRect(rx + 1, y, 1, 1);
        if (y < 8) {                                          // chevron head: two roof planes meeting, lit|dark
            for (let x = lx; x <= rx; x++) {
                const onLit = litLeft ? x <= 29 : x >= 30;
                ctx.fillStyle = onLit
                    ? (x === (litLeft ? lx : rx) ? shade(R[4], 1.12) : R[4])
                    : (x === (litLeft ? rx : lx) ? shade(R[1], 0.9) : R[1]);
                ctx.fillRect(x, y, 1, 1);
            }
            continue;
        }
        // rake bands (3px): the gable's own lit and shadow roof planes
        const litX = litLeft ? lx : rx - 2, shX = litLeft ? rx - 2 : lx;
        ctx.fillStyle = R[4];              ctx.fillRect(litX, y, 3, 1);
        ctx.fillStyle = shade(R[4], 1.12); ctx.fillRect(litLeft ? lx : rx, y, 1, 1);
        ctx.fillStyle = R[1];              ctx.fillRect(shX, y, 3, 1);
        ctx.fillStyle = R[2];              ctx.fillRect(litLeft ? rx - 2 : lx + 2, y, 1, 1);
        ctx.fillStyle = shade(R[1], 0.9);  ctx.fillRect(litLeft ? rx : lx, y, 1, 1);
        // stone face between the rakes
        const fx0 = lx + 3, fx1 = rx - 3;
        if (fx1 >= fx0) {
            for (let x = fx0; x <= fx1; x++) {
                ctx.fillStyle = (litLeft ? x <= 29 : x >= 30) ? shade(S[3], 1.04) : shade(S[3], 0.96);
                ctx.fillRect(x, y, 1, 1);
            }
            if (y === 8) { ctx.fillStyle = shade(S[2], 0.9); ctx.fillRect(fx0, y, fx1 - fx0 + 1, 1); } // AO under the chevron
            ctx.fillStyle = shade(S[3], 1.1);  ctx.fillRect(litLeft ? fx0 : fx1, y, 1, 1);  // lit inner sliver
            ctx.fillStyle = shade(S[2], 0.95); ctx.fillRect(litLeft ? fx1 : fx0, y, 1, 1);  // dark rake cast
        }
    }

    // ---- OCULUS: round window centered in the gable face ----
    {
        const oy = 16;
        circleRows(CX, oy, 4.5, (x0, y, w) => { ctx.fillStyle = Wd[2]; ctx.fillRect(x0, y, w, 1); });
        circleRows(CX, oy, 3.3, (x0, y, w) => {
            ctx.fillStyle = winter ? (y < oy ? '#b6cdd6' : '#a2bcc6') : (y < oy ? G[1] : G[0]);
            ctx.fillRect(x0, y, w, 1);
        });
        ctx.fillStyle = winter ? '#e8f4f8' : G[2]; ctx.fillRect(27, 14, 2, 1);              // upper-left spec (toward LIGHT)
        ctx.fillStyle = shade(Wd[3], 1.06); ctx.fillRect(28, oy - 4, 4, 1);                  // lit rim top
        ctx.fillStyle = shade(Wd[1], 0.92); ctx.fillRect(28, oy + 4, 4, 1);                  // rim underside
    }

    // ============================ STONE WALLS ============================
    const wx0 = 7, wx1 = 52, wy0 = 26, wy1 = 55, ww = wx1 - wx0 + 1, wh = wy1 - wy0 + 1;
    ctx.fillStyle = OLstone; ctx.fillRect(wx0 - 1, wy0, 1, wh); ctx.fillRect(wx1 + 1, wy0, 1, wh);
    ctx.fillStyle = S[3]; ctx.fillRect(wx0, wy0, ww, wh);
    ctx.fillStyle = S[4]; ctx.fillRect(litLeft ? wx0 : wx1 - 2, wy0, 3, wh);                 // lit face edge
    ctx.fillStyle = S[2]; ctx.fillRect(litLeft ? wx1 - 5 : wx0, wy0, 6, wh);                 // shadow face edge (wider — 3/4 read)
    ctx.fillStyle = S[1]; ctx.fillRect(litLeft ? wx1 - 1 : wx0, wy0, 2, wh);                 // 2px side reveal
    // stone coursework: mortar seams + offset joint ticks (sparse, deterministic)
    for (const y of [31, 36, 41, 46, 51]) { ctx.fillStyle = shade(S[2], 0.9); ctx.fillRect(wx0, y, ww, 1); }
    for (const y of [28, 33, 38, 43, 48, 53])
        for (let x = wx0 + 2 + ((y >> 2) % 2) * 2; x <= wx1 - 2; x += 5)
            if (phash(x, y) > 0.42) { ctx.fillStyle = S[2]; ctx.fillRect(x, y, 1, 1); }

    // ---- forward BAY beneath the gable (carries the door) ----
    const bx0 = 23, bx1 = 36;
    ctx.fillStyle = shade(S[3], 1.05); ctx.fillRect(bx0, wy0, bx1 - bx0 + 1, wh);
    ctx.fillStyle = S[4];              ctx.fillRect(litLeft ? bx0 : bx1 - 1, wy0, 2, wh);    // bay lit edge
    ctx.fillStyle = shade(S[3], 0.94); ctx.fillRect(litLeft ? bx1 - 1 : bx0, wy0, 1, wh);
    ctx.fillStyle = S[2];              ctx.fillRect(litLeft ? bx1 : bx0, wy0, 1, wh);        // bay away edge
    ctx.fillStyle = shade(S[2], 0.9);  ctx.fillRect(litLeft ? bx0 - 1 : bx1 + 1, wy0, 1, wh); // crevice on the lit side
    for (const y of [31, 36, 41]) { ctx.fillStyle = shade(S[2], 0.95); ctx.fillRect(bx0 + 1, y, bx1 - bx0 - 1, 1); }
    ctx.fillStyle = 'rgba(0,0,0,0.13)';                                                      // bay casts shadow away from LIGHT
    ctx.fillRect(litLeft ? bx1 + 1 : bx0 - 2, wy0, 2, wh);
    // roof overhang casts a dark eave-shadow line across the wall top (wall + bay)
    ctx.fillStyle = 'rgba(0,0,0,0.10)'; ctx.fillRect(wx0, wy0, ww, 2);

    // ---- 2-window grid per side (symmetric, simple sides) ----
    for (const x of [9, 16, 39, 46]) {
        const y = 34;
        recess(ctx, x, y, 5, 8, '#262233', Wd[2]);
        const gx = x + 1, gy = y + 1;
        ctx.fillStyle = winter ? '#b6cdd6' : G[1]; ctx.fillRect(gx, gy, 3, 3);
        ctx.fillStyle = winter ? '#a2bcc6' : G[0]; ctx.fillRect(gx, gy + 3, 3, 3);
        ctx.fillStyle = Wd[1]; ctx.fillRect(gx + 1, gy, 1, 6); ctx.fillRect(gx, gy + 3, 3, 1); // mullion cross
        ctx.fillStyle = winter ? '#e8f4f8' : G[2]; ctx.fillRect(gx, gy, 1, 1);                 // spec toward LIGHT
        ctx.fillStyle = shade(Wd[3], 1.08); ctx.fillRect(x - 1, y + 8, 7, 1);                  // lit sill
        ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(x - 1, y + 9, 7, 1);                  // sill AO
        if (winter) for (let k = -1; k <= 5; k++) {
            const up = phash(x + k, 9) > 0.6 ? 1 : 0;
            ctx.fillStyle = up ? SNOW_DEEP : SNOW_MID; ctx.fillRect(x + k, y - 2 - up, 1, 1 + up);
        }
    }

    // ---- foundation footer ----
    ctx.fillStyle = S[2];              ctx.fillRect(wx0, 54, ww, 1);
    ctx.fillStyle = shade(S[1], 0.95); ctx.fillRect(wx0, 55, ww, 1);
    ctx.fillStyle = OLstone;           ctx.fillRect(wx0, 56, ww, 1);                          // ground AO

    // ---- DOOR at the base of the bay (recessed; bottom ON the base row) ----
    {
        const dx = 25, dy = 44;
        ctx.fillStyle = OLwood;   ctx.fillRect(dx - 1, dy - 1, 12, 13);                       // frame
        ctx.fillStyle = '#241c18'; ctx.fillRect(dx, dy, 10, 12);                              // dark reveal (depth)
        ctx.fillStyle = shade(Wd[3], 1.1); ctx.fillRect(dx, dy, 10, 1);                       // lit lintel
        ctx.fillStyle = Wd[2]; ctx.fillRect(dx + 1, dy + 2, 8, 10);                           // door leaf
        ctx.fillStyle = '#241c18'; ctx.fillRect(dx + 1, dy + 2, 1, 1); ctx.fillRect(dx + 8, dy + 2, 1, 1); // knocked top corners
        ctx.fillStyle = shade(Wd[3], 1.05); ctx.fillRect(litLeft ? dx + 1 : dx + 8, dy + 3, 1, 9); // lit leaf edge
        ctx.fillStyle = Wd[1]; ctx.fillRect(dx + 4, dy + 3, 1, 9); ctx.fillRect(dx + 7, dy + 3, 1, 9); // plank seams
        ctx.fillStyle = shade(Wd[4], 1.15); ctx.fillRect(dx + 7, dy + 6, 1, 1);               // handle
        ctx.fillStyle = 'rgba(0,0,0,0.15)'; ctx.fillRect(dx, 56, 10, 1);                      // threshold AO
        if (winter) for (let k = -1; k <= 10; k++) {
            const up = phash(dx + k, 19) > 0.62 ? 1 : 0;
            ctx.fillStyle = SNOW_MID; ctx.fillRect(dx + k, dy - 2 - up, 1, 1 + up);
        }
    }

    // ======================= SEASON DRESSING =======================
    if (winter) {
        // snow slab on the sky-facing top strip — SKIPS the gable span (the gable is
        // in front of the slab), ragged fringe onto the slope
        for (let y = slabTop; y <= slabTop + 3; y++) {
            const glx = Math.round(CX - halfw(y)) - 1, grx = mir(glx);                        // gable span (+outline)
            const inset = y === slabTop ? 2 : y === slabTop + 1 ? 1 : 0;
            ctx.fillStyle = y < slabTop + 2 ? SNOW_DEEP : y === slabTop + 2 ? SNOW_MID : SNOW_THIN;
            ctx.fillRect(SX0 + inset, y, (glx - 1) - (SX0 + inset) + 1, 1);
            ctx.fillRect(grx + 1, y, (SX1 - inset) - (grx + 1) + 1, 1);
        }
        for (let x = SX0; x <= SX1; x++) {
            const glx = Math.round(CX - halfw(slabTop + 4)) - 1;
            if (x >= glx && x <= mir(glx)) continue;                                          // fringe skips the gable too
            if (phash(x, 5) > 0.45) { ctx.fillStyle = SNOW_THIN; ctx.fillRect(x, slabTop + 4, 1, phash(x, 6) > 0.6 ? 2 : 1); }
        }
        // gable: snow caps the chevron head + dusts the LIT rake down to the slab
        // snow line only (the dark plane sheds — the lit/dark split persists)
        for (let y = 1; y <= 13; y++) {
            const lx = Math.round(CX - halfw(y)), rx = mir(lx);
            const w = y < 8 ? Math.max(1, (litLeft ? 30 - lx : rx - 29)) : 3;
            ctx.fillStyle = y < 10 ? SNOW_DEEP : SNOW_MID;
            ctx.fillRect(litLeft ? lx : (y < 8 ? 30 : rx - 2), y, w, 1);
        }
        for (let y = 15; y <= gBase; y += 2) {                                                // sparse shed flecks lower down the lit rake
            const lx = Math.round(CX - halfw(y)), rx = mir(lx);
            if (phash(3, y) > 0.4) { ctx.fillStyle = SNOW_THIN; ctx.fillRect(litLeft ? lx + 1 : rx - 1, y, 1, 1); }
        }
        for (let x = SX0 + 3; x <= SX1 - 3; x += 3) if (phash(x, 13) > 0.55) {               // clumps on the fascia lip
            ctx.fillStyle = SNOW_MID; ctx.fillRect(x, fasciaA, 2, 1);
        }
        for (let x = wx0 + 1; x <= wx1 - 1; x++) if (phash(x, 41) > 0.35) {                   // drifted base (broken, not a wire)
            ctx.fillStyle = SNOW_TINT; ctx.fillRect(x, 55, 1, 1);
            if (phash(x, 43) > 0.72) { ctx.fillStyle = SNOW_MID; ctx.fillRect(x, 54, 1, 1); }
        }
    }
    // grounding scuffs at the foundation (tufts / snow / dry grass)
    const scuff = (x, col) => {
        ctx.fillStyle = col; ctx.fillRect(x, 53, 1, 2);
        ctx.fillRect(x - 1, 54, 1, 1); ctx.fillRect(x + 1, 54, 1, 1);
    };
    if (winter) { scuff(11, SNOW_MID); scuff(48, SNOW_MID); }
    else {
        const gA = fall ? '#7d6a2c' : RAMPS.FOLIAGE[4], gB = fall ? '#5f5322' : RAMPS.FOLIAGE[3];
        scuff(11, gA); scuff(19, gB); scuff(42, gB); scuff(48, gA);
        ctx.fillStyle = shade(S[1], 0.9);
        for (let x = wx0 + 3; x <= wx1 - 3; x++) if (phash(x, 31) > 0.62) ctx.fillRect(x, 55, 1, 1);
    }
    if (fall) for (const [col, lx, ly] of [['#c9782a', 4, 26], ['#a8531e', 55, 26], ['#d89a34', 10, 25], ['#b8641a', 50, 25]]) {
        ctx.fillStyle = col; ctx.fillRect(lx, ly, 1, 1);
    }

    _cache[season] = c;
    return c;
}
