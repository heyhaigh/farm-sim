// pm_1.js — ARCHETYPE 1: GABLE (CENTER-PEAK APEX). Front-gabled A-frame cottage,
// the CraftPix-cottage / Slynyrd chevron read: the ridge runs AWAY from the camera,
// so on screen it is a VERTICAL center seam — the APEX — from the peak down to the
// front-gable point. Two roof slopes hang off it as diagonal BANDS: the LEFT plane is
// HARD-LIT (toward LIGHT, upper-left), the RIGHT plane is HARD-DARK — the light/dark
// plane split does the volume, not the outline. The bands overhang the timber front
// wall (dark fascia underside + an eave-AO whisper on the wall). Coherent symmetric
// sides — one lit plane, one shadow plane, NO competing hip facets. Front wall:
// PLANK timber with a recessed door + two framed 2x2 windows + a tiny gable vent.
// One light (LIGHT) · outlineFor() outlines (never #000) · recess() openings ·
// seatShadow() FIRST (<=1 tile) · base row at the canvas BOTTOM · overflow TOP-only ·
// pure fillRect, deterministic (no Math.random / Date / drawImage / globalAlpha / arc).
import { makeCanvas, RAMPS, LIGHT, shade, outlineFor, seatShadow, sphereMask, stampCluster, recess, fillDiamond, TILE_W, TILE_H } from '../pixel.js';

export const meta = { name: 'A-Frame Gable Cottage (PM-QA)', pm: true };

// deterministic position hash -> 0..1 (module-local; NEVER Math.random / Date). Pure.
function phash(a, b) {
    let n = ((a * 73856093) ^ (b * 19349663)) >>> 0;
    n ^= n >>> 15; n = (n * 2246822519) >>> 0; n ^= n >>> 13;
    return (n % 1024) / 1024;
}
// FALL warms a ramp in-hue via shade() (deterministic; the hue-shift lives in shade).
const warm = (ramp) => ramp.map((c) => shade(c, 1.05));

const _cache = {};
export function makeBuilding(season = 'SUMMER') {
    if (_cache[season]) return _cache[season];
    const [c, ctx] = makeCanvas(56, 56);
    const winter = season === 'WINTER', fall = season === 'FALL';
    const R = fall ? warm(RAMPS.ROOF_RED) : RAMPS.ROOF_RED;
    const P = fall ? warm(RAMPS.PLANK) : RAMPS.PLANK;
    const W = fall ? warm(RAMPS.WOOD) : RAMPS.WOOD;
    const G = RAMPS.GLASS;
    const OLroof = outlineFor(RAMPS.ROOF_RED[1]);
    const OLwall = outlineFor(RAMPS.PLANK[1]);
    const OLwood = outlineFor(RAMPS.WOOD[1]);
    const SNOW_DEEP = '#ffffff', SNOW_MID = '#eef4f4', SNOW_THIN = '#d3e2e8', SNOW_TINT = '#dfeaec';

    // ---- GEOMETRY — the A-frame chevron ----
    // Apex at top-center; ridge = the VERTICAL 2px seam (26|27) from apexY down to the
    // gable peak (gableY); below that the two slope BANDS spread to the eave corners
    // while the front-gable WALL fills the widening notch between their undersides.
    const cxL = 27, cxR = 28;                    // ridge seam columns (lit side | dark side)
    const apexY = 3, gableY = 13, eaveY = 34;    // peak / gable point / eave (widest) rows
    const M = 0.78;                              // rake slope (dx per dy) — both sides, symmetric
    const half = (y) => Math.round((y - apexY) * M);       // outer silhouette half-width
    const ihalf = (y) => Math.round((y - gableY) * M);     // inner (gable-notch) half-width
    const outerL = (y) => cxL - half(y), outerR = (y) => cxR + half(y);
    const innerL = (y) => cxL - ihalf(y), innerR = (y) => cxR + ihalf(y);
    const wx0 = 7, wx1 = 48, wy1 = 52;           // wall box below the eave; base row at the BOTTOM
    const ww = wx1 - wx0 + 1;
    // lit side follows LIGHT (upper-left => left plane lit); never hardcode a sun
    const litLeft = LIGHT.x < 0;

    // ---- grounding FIRST (behind everything): fixed <=1-tile seat shadow ----
    seatShadow(ctx, { cx: 28, cy: 53, rx: 16, ry: 2.5 }, { alpha: 0.30 });

    // ---- FRONT WALL (gable triangle above the eave + full box below) ----
    for (let y = gableY + 1; y <= wy1; y++) {
        const a = y <= eaveY ? Math.max(wx0, innerL(y) + 1) : wx0;
        const b = y <= eaveY ? Math.min(wx1, innerR(y) - 1) : wx1;
        if (b < a) continue;
        ctx.fillStyle = P[2]; ctx.fillRect(a, y, b - a + 1, 1);
    }
    ctx.fillStyle = OLwall; ctx.fillRect(wx0 - 1, eaveY + 1, 1, wy1 - eaveY); // wall side outlines
    ctx.fillStyle = OLwall; ctx.fillRect(wx1 + 1, eaveY + 1, 1, wy1 - eaveY);
    ctx.fillStyle = shade(P[2], 1.1); ctx.fillRect(wx0, eaveY + 2, 2, wy1 - eaveY - 1);   // lit-left strip (in-ramp warm, not gold)
    ctx.fillStyle = P[1]; ctx.fillRect(wx1 - 4, eaveY + 2, 5, wy1 - eaveY - 1); // shadow-right
    ctx.fillStyle = P[0]; ctx.fillRect(wx1 - 1, eaveY + 2, 2, wy1 - eaveY - 1); // side-reveal sliver
    for (const x of [wx0 + 14]) {                                             // plank seam pair, clear of the openings
        ctx.fillStyle = shade(P[1], 0.85); ctx.fillRect(x, eaveY + 3, 1, wy1 - eaveY - 3);
        ctx.fillStyle = shade(P[2], 1.05); ctx.fillRect(x + 1, eaveY + 3, 1, wy1 - eaveY - 3);
    }
    // gable king-beam under the ridge end (timber charm; 2px, lit-left)
    ctx.fillStyle = W[1]; ctx.fillRect(cxR, gableY + 2, 1, 8);
    ctx.fillStyle = W[3]; ctx.fillRect(cxL, gableY + 2, 1, 8);
    // tiny gable vent (recessed) under the beam
    recess(ctx, 26, 24, 4, 4, '#241c18', W[1]);
    // foundation sill + ground AO (base row bottoms the canvas footprint)
    ctx.fillStyle = W[1]; ctx.fillRect(wx0 - 1, wy1 - 1, ww + 2, 2);
    ctx.fillStyle = shade(W[2], 1.1); ctx.fillRect(wx0 - 1, wy1 - 1, ww + 2, 1);
    ctx.fillStyle = OLwood; ctx.fillRect(wx0, wy1 + 1, ww, 1);
    if (winter) for (let x = wx0; x <= wx1; x++) if (phash(x, 23) > 0.5) { ctx.fillStyle = phash(x, 24) > 0.6 ? SNOW_TINT : SNOW_MID; ctx.fillRect(x, wy1 - 1, 1, 1); }

    // ---- ROOF — two slope bands off the vertical ridge apex, HARD lit|dark ----
    const litBase = (y) => { const f = (y - apexY) / (eaveY - apexY); return f < 0.22 ? shade(R[3], 1.08) : f < 0.6 ? R[3] : shade(R[3], 0.95); };
    const darkBase = (y) => { const f = (y - apexY) / (eaveY - apexY); return f < 0.22 ? R[2] : f < 0.6 ? R[1] : shade(R[1], 0.92); };
    for (let y = apexY; y <= eaveY; y++) {
        const oL = outerL(y), oR = outerR(y);
        const iL = y > gableY ? innerL(y) : cxL, iR = y > gableY ? innerR(y) : cxR;
        // LEFT band (outer rake -> inner underside): the LIT plane
        for (let x = oL; x <= iL; x++) {
            const d = x - oL;                                     // depth from the rake edge
            let col = litLeft ? litBase(y) : darkBase(y);
            if (d % 3 === 2) col = shade(col, 0.9);               // down-slope shingle seams
            else if ((y + ((d / 3) | 0) * 2) % 4 === 0) col = shade(col, litLeft ? 1.06 : 1.03); // lit course tops, half-offset
            if (d === 0) col = litLeft ? shade(R[3], 1.12) : shade(R[1], 1.04);  // rake edge catches (or loses) the sun
            ctx.fillStyle = col; ctx.fillRect(x, y, 1, 1);
        }
        // RIGHT band: the SHADOW plane (identical logic, a step down — never ad-hoc)
        for (let x = iR; x <= oR; x++) {
            const d = oR - x;
            let col = litLeft ? darkBase(y) : litBase(y);
            if (d % 3 === 2) col = shade(col, 0.88);
            else if ((y + ((d / 3) | 0) * 2) % 4 === 0) col = shade(col, litLeft ? 1.03 : 1.06);
            if (d === 0) col = litLeft ? shade(R[1], 1.04) : shade(R[3], 1.12);
            ctx.fillStyle = col; ctx.fillRect(x, y, 1, 1);
        }
        // the APEX seam: bright lit ridge column | first dark column (the hard plane break)
        if (y <= gableY) {
            ctx.fillStyle = shade(R[4], 1.06); ctx.fillRect(litLeft ? cxL : cxR, y, 1, 1);
            ctx.fillStyle = R[0]; ctx.fillRect(litLeft ? cxR : cxL, y, 1, 1);
        }
        // silhouette outlines on both rakes (one ramp step darker — never #000)
        ctx.fillStyle = OLroof; ctx.fillRect(oL - 1, y, 1, 1); ctx.fillRect(oR + 1, y, 1, 1);
        // band UNDERSIDE fascia (the roof slab's edge) + eave-AO whisper on the gable wall
        if (y > gableY + 1 && y < eaveY) {
            ctx.fillStyle = shade(R[1], 0.8); ctx.fillRect(iL, y, 1, 1); ctx.fillRect(iR, y, 1, 1);
            ctx.fillStyle = 'rgba(0,0,0,0.08)'; ctx.fillRect(iL + 1, y, 1, 1); ctx.fillRect(iR - 1, y, 1, 1);
        }
    }
    // apex cap + gable-peak AO
    ctx.fillStyle = OLroof; ctx.fillRect(cxL - 1, apexY - 1, 4, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.10)'; ctx.fillRect(cxL - 1, gableY + 1, 4, 1);
    // EAVE — the widest row: dark overhanging fascia over each band + underside outline
    for (const [a, b] of [[outerL(eaveY), innerL(eaveY)], [innerR(eaveY), outerR(eaveY)]]) {
        ctx.fillStyle = shade(R[1], 0.82); ctx.fillRect(a, eaveY, b - a + 1, 1);
    }
    ctx.fillStyle = OLroof;
    ctx.fillRect(outerL(eaveY) - 1, eaveY + 1, wx0 - outerL(eaveY), 1);       // overhang underside, left
    ctx.fillRect(wx1 + 1, eaveY + 1, outerR(eaveY) - wx1 + 1, 1);             // overhang underside, right
    ctx.fillStyle = 'rgba(0,0,0,0.09)'; ctx.fillRect(wx0, eaveY + 1, ww, 2);  // eave-AO whisper on the wall

    // ---- WINTER snow: rides the top of BOTH planes, brighter on the lit one;
    // seams/courses still read through (partial-snow law) ----
    if (winter) {
        for (let y = apexY; y < eaveY; y++) {
            const f = (y - apexY) / (eaveY - apexY);
            const oL = outerL(y), oR = outerR(y);
            const iL = y > gableY ? innerL(y) : cxL, iR = y > gableY ? innerR(y) : cxR;
            for (let x = oL; x <= oR; x++) {
                if (x > iL && x < iR) continue;                    // gable wall notch
                const onLit = (x <= iL) === litLeft;
                const reach = (onLit ? 0.68 : 0.5) + phash(x >> 1, 5) * 0.1;
                if (f > reach) continue;
                ctx.fillStyle = onLit ? (f < 0.3 ? SNOW_DEEP : SNOW_MID) : SNOW_THIN;
                ctx.fillRect(x, y, 1, 1);
                const d = x <= iL ? x - oL : oR - x;
                if (d % 3 === 2) { ctx.fillStyle = 'rgba(0,0,0,0.07)'; ctx.fillRect(x, y, 1, 1); }
            }
        }
        ctx.fillStyle = SNOW_DEEP; ctx.fillRect(cxL, apexY, 2, gableY - apexY + 1);   // white apex seam
    }

    // ---- OPENINGS (front wall): two framed 2x2 windows + a recessed door ----
    for (const x of [11, 35]) {                                   // window outer 9x9 at (x,39)
        const y = 39, gx = x + 1, gy = y + 1, gs = 7;
        ctx.fillStyle = OLwood; ctx.fillRect(x - 1, y - 1, 11, 11);
        ctx.fillStyle = W[2]; ctx.fillRect(x, y, 9, 9);
        ctx.fillStyle = shade(W[3], 1.1); ctx.fillRect(x, y, 9, 1);           // top-sill highlight
        ctx.fillStyle = shade(W[3], 1.06); ctx.fillRect(x, y, 1, 9);
        ctx.fillStyle = shade(W[1], 0.9); ctx.fillRect(x + 8, y, 1, 9);
        ctx.fillStyle = winter ? '#a2bcc6' : G[0]; ctx.fillRect(gx, gy, gs, gs);
        ctx.fillStyle = winter ? '#b6cdd6' : G[1];                            // diagonal sky streak, BL->TR
        for (let k = 0; k < gs; k++) { const sx = gx + k, sy = gy + gs - 1 - k; ctx.fillRect(sx, sy, 1, 1); if (k < gs - 1) ctx.fillRect(sx + 1, sy, 1, 1); }
        ctx.fillStyle = winter ? '#e8f4f8' : G[2]; ctx.fillRect(gx + 1, gy + 1, 2, 1); ctx.fillRect(gx + 1, gy + 2, 1, 1); // top-left glint
        ctx.fillStyle = W[1]; ctx.fillRect(gx + 3, gy, 1, gs); ctx.fillRect(gx, gy + 3, gs, 1);   // mullion cross -> 2x2 panes
        ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(x, y + 9, 9, 1);     // bottom-sill drop shadow (whisper)
        if (winter) { for (let k = 0; k < 9; k++) { const up = phash(x + k, 17) > 0.62 ? 1 : 0; ctx.fillStyle = SNOW_MID; ctx.fillRect(x + k, y - 1 - up, 1, 1 + up); } ctx.fillStyle = SNOW_DEEP; ctx.fillRect(x + 1, y - 1, 3, 1); }
    }
    // door — recessed, bottom seated on the ground line
    recess(ctx, 25, 42, 6, 9, '#241c18', OLwood);
    ctx.fillStyle = shade(W[2], 1.05); ctx.fillRect(25, 43, 1, 8);            // lit inner jamb (quiet wood, not gold)
    ctx.fillStyle = shade(W[1], 0.85); ctx.fillRect(28, 43, 1, 8);            // door plank seam
    ctx.fillStyle = W[4]; ctx.fillRect(29, 46, 1, 1);                         // handle
    ctx.fillStyle = 'rgba(0,0,0,0.13)'; ctx.fillRect(24, 52, 8, 1);           // threshold whisper
    if (winter) for (let k = 0; k < 8; k++) { const up = phash(24 + k, 19) > 0.6 ? 1 : 0; ctx.fillStyle = SNOW_MID; ctx.fillRect(24 + k, 41 - up, 1, 1 + up); }

    // ---- GROUNDING scuff at the foundation ----
    const scuff = (x, col) => { ctx.fillStyle = col; ctx.fillRect(x, 51, 1, 2); ctx.fillRect(x - 1, 52, 1, 1); ctx.fillRect(x + 1, 52, 1, 1); };
    if (winter) { scuff(10, SNOW_MID); scuff(45, SNOW_MID); ctx.fillStyle = SNOW_TINT; ctx.fillRect(17, 53, 22, 1); }
    else {
        const gA = fall ? '#7d6a2c' : RAMPS.FOLIAGE[4], gB = fall ? '#5f5322' : RAMPS.FOLIAGE[3];
        scuff(10, gA); scuff(14, gB); scuff(42, gB); scuff(45, gA);
        ctx.fillStyle = shade(W[1], 0.9); for (let x = 18; x <= 38; x++) if (phash(x, 31) > 0.55) ctx.fillRect(x, 53, 1, 1);
    }
    // FALL dry-leaf flecks near the eave corners
    if (fall) for (const [col, lx, ly] of [['#c9782a', 4, 33], ['#a8531e', 51, 33], ['#d89a34', 9, 32], ['#b8641a', 46, 33]]) { ctx.fillStyle = col; ctx.fillRect(lx, ly, 1, 1); }

    _cache[season] = c;
    return c;
}
