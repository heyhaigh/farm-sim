import { makeCanvas, RAMPS, LIGHT, shade, outlineFor, seatShadow, sphereMask, stampCluster, recess, fillDiamond, TILE_W, TILE_H } from './pixel.js';

// ===========================================================================
// topdown_styles.js — FOUNDATION STUDY: four distinct top-down building FORMS,
// authored with the SLYNYRD city-builder order (roof → wall → openings → drop
// shadows → outline → ground; PROCEDURAL_ART.md §S). The camera is
// above-and-slightly-front, so every roof is a broad SLAB you look DOWN onto:
//   · a DARK far-slope sliver glimpsed OVER the ridge (the topmost silhouette
//     rows are the back plane — never a bright cap),
//   · a bright ridge crease (dark-above / bright-below = two planes meeting),
//   · a dominant near slope with a vertical ridge→eave grade + compressed
//     shingle courses (never a left-to-right facade gradient),
//   · rakes that stay NEAR-VERTICAL on gables (ridge ≈ 90% of the eave — a
//     taper to a point is what reads as a tent),
//   · a dark eave FASCIA on the widest row, overhanging a SHORT front wall
//     (3px step per side) with an AO whisper beneath it.
// Light is the one committed sun (LIGHT, upper-left) — lit bands/edges follow
// it, never a hardcoded side. Colors come from RAMPS families only. Pure
// fillRect; deterministic; cached per (style, season). SUMMER is the faithful
// render; FALL falls back to it; WINTER adds a trivial snow cap on the
// top-facing plane. Base row sits at the canvas bottom (bottom-center anchor);
// art never breaks the bottom or sides of the footprint — only the top.
// ===========================================================================

const R = RAMPS.ROOF_RED, P = RAMPS.PLANK, W = RAMPS.WOOD, S = RAMPS.STONE, G = RAMPS.GLASS;
const SNOW_DEEP = '#ffffff', SNOW_MID = '#eef4f4', SNOW_THIN = '#dbe8ec';

// deterministic position hash → 0..1 (texture ticks; NEVER Math.random). Pure.
function hash2(a, b) {
    let n = ((a * 73856093) ^ (b * 19349663)) >>> 0;
    n ^= n >>> 15; n = (n * 2246822519) >>> 0; n ^= n >>> 13;
    return (n % 1024) / 1024;
}

// ---------------------------------------------------------------------------
// Shared UNITS (§S.1.2 — author the unit once, derive every form from it)
// ---------------------------------------------------------------------------

// Vertical ridge→eave tone on the dominant near slope (§6a.3): brightest just
// under the ridge (most sky-facing), stepping down toward the eave as the
// plane tilts away from the sun. f = 0 at ridge → 1 at eave.
function slopeTone(ramp, f) {
    return f < 0.16 ? shade(ramp[3], 1.12)
        : f < 0.38 ? ramp[3]
        : f < 0.6 ? shade(ramp[3], 0.92)
        : f < 0.82 ? ramp[2]
        : shade(ramp[2], 0.9);
}

// Shingle decoration for one slope band: darker course bottoms, lit course
// tops, half-offset vertical seam ticks. `bottoms` compress toward the ridge
// (2px pitch) and open toward the eave (3px) — the forward tilt made visible.
function shingleFn(ramp, fAt, bottoms) {
    const seam = new Set(bottoms);
    const idx = (y) => { let n = 0; for (const b of bottoms) if (b < y) n++; return n; };
    return (x, y) => {
        let col = slopeTone(ramp, fAt(y));
        if (!seam.has(y) && ((x + (idx(y) % 2) * 3) % 6 === 0)) col = shade(col, 0.95);
        if (seam.has(y)) col = shade(col, 0.88);
        else if (seam.has(y - 1)) col = shade(col, 1.05);
        return col;
    };
}

// Paint the slope rows between two per-row rakes; colFn(x, y) picks the tone,
// OL pixels frame the silhouette (OUTLINE LAW — one ramp step darker, no black).
function slopeRows(ctx, y0, y1, lxAt, rxAt, colFn, OL) {
    for (let y = y0; y <= y1; y++) {
        const lx = lxAt(y), rx = rxAt(y);
        for (let x = lx; x <= rx; x++) { ctx.fillStyle = colFn(x, y); ctx.fillRect(x, y, 1, 1); }
        ctx.fillStyle = OL; ctx.fillRect(lx - 1, y, 1, 1); ctx.fillRect(rx + 1, y, 1, 1);
    }
}

// Lit rake edge on the sun side of the dominant plane (drives off LIGHT).
function litRake(ctx, ramp, y0, y1, lxAt, rxAt) {
    ctx.fillStyle = shade(ramp[3], 1.08);
    for (let y = y0; y <= y1; y++) ctx.fillRect(LIGHT.x < 0 ? lxAt(y) : rxAt(y), y, 1, 1);
}

// FAR-SLOPE SLIVER — the back plane glimpsed OVER the ridge. The topmost
// silhouette rows are DARK; dark-above / bright-below at the ridge crease is
// the #1 "seen from above" cue (and the #1 anti-tent cue).
function farSliver(ctx, ramp, x0, x1, y0, y1) {
    for (let y = y0; y <= y1; y++) {
        const i = y - y0;
        ctx.fillStyle = y === y1 ? shade(ramp[1], 0.92) : ramp[0];
        ctx.fillRect(x0 + i, y, (x1 - i) - (x0 + i) + 1, 1);
    }
    ctx.fillStyle = outlineFor(ramp[1]);
    ctx.fillRect(x0 - 1, y0 - 1, (x1 - x0) + 3, 1);   // dark silhouette cap over the top
}

// Bright ridge crease between the far and near planes.
function ridgeCrease(ctx, ramp, l, r, y) {
    ctx.fillStyle = shade(ramp[4], 1.06); ctx.fillRect(l, y, r - l + 1, 1);
}

// EAVE — the WIDEST row of the sprite: dark fascia (the slab's front edge),
// outline caps, and the overhang UNDERSIDE outside the wall span (the real
// drop shadow that says "this roof floats out over the wall").
function eaveRow(ctx, ramp, l, r, y, wx0, wx1) {
    const OL = outlineFor(ramp[1]);
    ctx.fillStyle = shade(ramp[1], 0.85); ctx.fillRect(l, y, r - l + 1, 1);
    ctx.fillStyle = OL;
    ctx.fillRect(l - 1, y, 1, 1); ctx.fillRect(r + 1, y, 1, 1);
    ctx.fillRect(l, y + 1, wx0 - l, 1); ctx.fillRect(wx1 + 1, y + 1, r - wx1, 1);
}

// FRONT WALL unit — one short vertical plane UNDER the eave: outline box, mid
// body, a lit band on the LIGHT side, a wider shadow band + 2px side reveal on
// the away side (the ¾ camera), a WOOD foundation sill + ground AO, and the
// eave-AO whisper across the top rows.
function wallFront(ctx, x0, y0, x1, y1, ramp, opts = {}) {
    const w = x1 - x0 + 1, h = y1 - y0 + 1, litL = LIGHT.x < 0;
    ctx.fillStyle = outlineFor(ramp[1]); ctx.fillRect(x0 - 1, y0, w + 2, h + 1);
    ctx.fillStyle = ramp[2]; ctx.fillRect(x0, y0, w, h);
    ctx.fillStyle = ramp[3]; ctx.fillRect(litL ? x0 : x1 - 2, y0, 3, h);
    ctx.fillStyle = ramp[1]; ctx.fillRect(litL ? x1 - 5 : x0, y0, 6, h);
    ctx.fillStyle = ramp[0]; ctx.fillRect(litL ? x1 - 1 : x0, y0, 2, h);
    if (opts.sill !== false) {
        ctx.fillStyle = W[1]; ctx.fillRect(x0 - 1, y1 - 1, w + 2, 2);
        ctx.fillStyle = shade(W[2], 1.1); ctx.fillRect(x0 - 1, y1 - 1, w + 2, 1);
        ctx.fillStyle = outlineFor(W[1]); ctx.fillRect(x0, y1 + 1, w, 1);   // ground AO
    }
    if (opts.eaveAO !== false) { ctx.fillStyle = 'rgba(0,0,0,0.08)'; ctx.fillRect(x0, y0, w, 2); }
}

// Plank seams (paired dark/lit verticals) — quiet wall texture, off-center.
function plankSeams(ctx, xs, y0, h, ramp) {
    for (const x of xs) {
        ctx.fillStyle = shade(ramp[1], 0.85); ctx.fillRect(x, y0 + 2, 1, h - 3);
        ctx.fillStyle = shade(ramp[3], 1.05); ctx.fillRect(x + 1, y0 + 2, 1, h - 3);
    }
}

// Stone coursing: horizontal seams every 4 rows + staggered vertical joints.
function stoneCourses(ctx, x0, y0, x1, y1) {
    for (let y = y0 + 3; y < y1 - 1; y += 4) {
        ctx.fillStyle = shade(S[1], 0.95); ctx.fillRect(x0 + 1, y, x1 - x0 - 1, 1);
        ctx.fillStyle = shade(S[1], 0.9);
        for (let x = x0 + 2 + ((y >> 2) % 2) * 3; x < x1 - 1; x += 6)
            if (hash2(x, y) > 0.35) ctx.fillRect(x, y - 3, 1, 3);
    }
}

// Window: real recessed depth via recess(), WOOD rim, GLASS panes, mullion
// cross, one spec on the light corner, drop shadow under the sill.
function windowAt(ctx, x, y, sz, winter) {
    recess(ctx, x, y, sz, sz, winter ? '#b6cdd6' : G[1], W[2]);
    ctx.fillStyle = W[1];
    ctx.fillRect(x + (sz >> 1), y, 1, sz); ctx.fillRect(x, y + (sz >> 1), sz, 1);
    ctx.fillStyle = winter ? '#e8f4f8' : G[2]; ctx.fillRect(x + 1, y + 1, 1, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(x - 1, y + sz + 1, sz + 2, 1);
}

// Door: recessed gap + wooden leaf, lit lintel/jamb, handle spec, base shadow.
function doorAt(ctx, x, y, w, h) {
    ctx.fillStyle = outlineFor(W[1]); ctx.fillRect(x - 1, y - 1, w + 2, h + 1);
    ctx.fillStyle = '#241c18'; ctx.fillRect(x, y, w, h);                        // recess gap
    ctx.fillStyle = W[2]; ctx.fillRect(x + 1, y + 1, w - 2, h - 1);             // leaf
    ctx.fillStyle = W[3]; ctx.fillRect(x + 1, y + 1, 1, h - 1);                 // lit jamb side
    ctx.fillStyle = W[1]; ctx.fillRect(x + w - 2, y + 1, 1, h - 1);             // shadow side
    ctx.fillStyle = shade(W[2], 1.08); ctx.fillRect(x - 1, y - 1, w + 2, 1);    // lit lintel
    ctx.fillStyle = shade(W[3], 1.15); ctx.fillRect(x + w - 3, y + (h >> 1), 1, 1); // handle
    ctx.fillStyle = 'rgba(0,0,0,0.13)'; ctx.fillRect(x - 1, y + h, w + 2, 1);   // base shadow
}

// Grounding scuffs at the foundation (grass tufts + dirt flecks; snow in winter).
function groundScuffs(ctx, x0, x1, gy, winter) {
    if (winter) {
        ctx.fillStyle = SNOW_MID; ctx.fillRect(x0 + 2, gy, 2, 1); ctx.fillRect(x1 - 4, gy, 2, 1);
        return;
    }
    ctx.fillStyle = RAMPS.FOLIAGE[4]; ctx.fillRect(x0 + 2, gy - 1, 1, 2); ctx.fillRect(x1 - 2, gy - 1, 1, 2);
    ctx.fillStyle = RAMPS.FOLIAGE[3]; ctx.fillRect(x0 + 5, gy, 1, 1); ctx.fillRect(x1 - 5, gy, 1, 1);
    ctx.fillStyle = shade(W[1], 0.9);
    for (let x = x0 + 8; x <= x1 - 8; x++) if (hash2(x, 31) > 0.6) ctx.fillRect(x, gy, 1, 1);
}

// Trivial WINTER cap: snow loads the sky-facing upper part of the slope
// (f ≤ cut) and sheds toward the eave; the far sliver stays dark above it.
function snowCap(ctx, y0, y1, lxAt, rxAt, fAt, cut = 0.4) {
    for (let y = y0; y <= y1; y++) {
        const f = fAt(y); if (f > cut) break;
        ctx.fillStyle = f < 0.18 ? SNOW_DEEP : f < 0.32 ? SNOW_MID : SNOW_THIN;
        ctx.fillRect(lxAt(y), y, rxAt(y) - lxAt(y) + 1, 1);
    }
}

// ---------------------------------------------------------------------------
// FORM A — ONE-STORY GABLE (48×42). The baseline house/coop form.
// Ridge 38px vs 42px eave (90%): the near slope projects as a wide RECTANGLE
// with near-vertical rakes — a slab you look down on, structurally incapable
// of the taper-to-a-point tent read.
// ---------------------------------------------------------------------------
function renderA(season) {
    const winter = season === 'WINTER';
    const [c, ctx] = makeCanvas(48, 42);
    const OL = outlineFor(R[1]);

    // ground first (behind): fixed ≤1-tile seat shadow (SHADOW LAW)
    seatShadow(ctx, { cx: 24, cy: 40, rx: TILE_W / 2, ry: TILE_H / 3 }, { alpha: 0.3 });

    const eaveY = 24, eaveL = 3, eaveR = 44;    // widest row — roof band y6..24 ≈ 58% of the silhouette
    const ridgeY = 9, ridgeL = 5, ridgeR = 42;  // BROAD ridge: 90% of the eave (gable-from-front = rectangle)
    const wx0 = 6, wx1 = 41, wy0 = 25, wy1 = 38; // short wall; eave overhangs 3px/side
    const fAt = (y) => (y - ridgeY) / (eaveY - ridgeY);
    const lxAt = (y) => Math.round(ridgeL + (eaveL - ridgeL) * fAt(y));
    const rxAt = (y) => Math.round(ridgeR + (eaveR - ridgeR) * fAt(y));

    // wall (painted first so the fascia + overhang shadow land ON it)
    wallFront(ctx, wx0, wy0, wx1, wy1, P);
    plankSeams(ctx, [wx0 + 25, wx0 + 29], wy0, wy1 - wy0 + 1, P);

    // roof: far sliver → ridge crease → near slope → eave fascia
    farSliver(ctx, R, 8, 39, 6, 8);
    ridgeCrease(ctx, R, ridgeL, ridgeR, ridgeY);
    slopeRows(ctx, ridgeY + 1, eaveY - 1, lxAt, rxAt, shingleFn(R, fAt, [12, 14, 16, 19, 22]), OL);
    litRake(ctx, R, ridgeY + 1, eaveY - 1, lxAt, rxAt);
    eaveRow(ctx, R, eaveL, eaveR, eaveY, wx0, wx1);
    if (winter) snowCap(ctx, ridgeY, eaveY - 1, lxAt, rxAt, fAt);

    // openings — off-center door + one window (nothing mirrors)
    doorAt(ctx, 14, 28, 7, 10);
    windowAt(ctx, 29, 29, 6, winter);

    // grounding pass
    groundScuffs(ctx, wx0, wx1, 39, winter);
    if (!winter) {
        stampCluster(ctx, 7, wy1 - 4, 5, RAMPS.FOLIAGE, 1);
        stampCluster(ctx, 37, wy1 - 4, 9, RAMPS.FOLIAGE, 0);
    }
    return c;
}

// ---------------------------------------------------------------------------
// FORM B — HIP ROOF (52×42). A LOW trapezoid top plane: ridge ≈ 46% of the
// eave, but the band is only 14 rows over a 48px eave, and the two hip-end
// facets are shaded ASYMMETRICALLY off LIGHT (left facet lit, right in
// shadow) with explicit lit/dark hip creases — a slab turning away at both
// ends, not a symmetric pyramid.
// ---------------------------------------------------------------------------
function renderB(season) {
    const winter = season === 'WINTER';
    const [c, ctx] = makeCanvas(52, 42);
    const OL = outlineFor(R[1]);

    seatShadow(ctx, { cx: 26, cy: 40, rx: TILE_W / 2, ry: TILE_H / 3 }, { alpha: 0.3 });

    const eaveY = 24, eaveL = 2, eaveR = 49;
    const ridgeY = 10, ridgeL = 15, ridgeR = 36;
    const wx0 = 5, wx1 = 46, wy0 = 25, wy1 = 38;
    const fAt = (y) => (y - ridgeY) / (eaveY - ridgeY);
    const lerp = (a, b, t) => Math.round(a + (b - a) * t);
    const lxAt = (y) => lerp(13, eaveL, fAt(y));
    const rxAt = (y) => lerp(38, eaveR, fAt(y));
    const lHipAt = (y) => lerp(ridgeL, wx0 + 3, fAt(y));   // hip creases run to points
    const rHipAt = (y) => lerp(ridgeR, wx1 - 3, fAt(y));   // INSIDE the eave corners

    wallFront(ctx, wx0, wy0, wx1, wy1, S);
    stoneCourses(ctx, wx0, wy0, wx1, wy1);

    farSliver(ctx, R, 18, 33, 8, 9);
    ridgeCrease(ctx, R, ridgeL, ridgeR, ridgeY);
    const shingle = shingleFn(R, fAt, [13, 15, 17, 19, 22]);
    const litFacet = shade(R[3], 1.06), darkFacet = R[1], darkDeep = shade(R[1], 0.9);
    slopeRows(ctx, ridgeY + 1, eaveY - 1, lxAt, rxAt, (x, y) => {
        if (x < lHipAt(y)) return litFacet;                        // sun-side hip facet: flat lit
        if (x > rHipAt(y)) return fAt(y) > 0.6 ? darkDeep : darkFacet; // away facet: flat dark
        return shingle(x, y);                                      // dominant front slope
    }, OL);
    for (let y = ridgeY + 1; y <= eaveY - 1; y++) {                // hip creases: lit / dark
        ctx.fillStyle = shade(R[3], 1.12); ctx.fillRect(lHipAt(y), y, 1, 1);
        ctx.fillStyle = shade(R[1], 0.85); ctx.fillRect(rHipAt(y), y, 1, 1);
    }
    eaveRow(ctx, R, eaveL, eaveR, eaveY, wx0, wx1);
    if (winter) snowCap(ctx, ridgeY, eaveY - 1, lxAt, rxAt, fAt);

    doorAt(ctx, 18, 28, 8, 10);
    windowAt(ctx, 8, 29, 6, winter);
    windowAt(ctx, 36, 29, 6, winter);

    groundScuffs(ctx, wx0, wx1, 39, winter);
    if (!winter) stampCluster(ctx, 28, wy1 - 4, 11, RAMPS.FOLIAGE, 2);
    return c;
}

// ---------------------------------------------------------------------------
// FORM C — TWO-STORY GABLE (52×58). The cottage test: the SAME slab roof as A
// over a TALLER wall built as two stacked story bands — cream/timber upper
// (window band 1) on a stone ground floor (door + window band 2), separated
// by a WOOD floor trim that throws its own drop shadow.
// ---------------------------------------------------------------------------
function renderC(season) {
    const winter = season === 'WINTER';
    const [c, ctx] = makeCanvas(52, 58);
    const OL = outlineFor(R[1]);

    seatShadow(ctx, { cx: 26, cy: 56, rx: TILE_W / 2, ry: TILE_H / 3 }, { alpha: 0.3 });

    const eaveY = 23, eaveL = 3, eaveR = 48;
    const ridgeY = 8, ridgeL = 5, ridgeR = 46;
    const wx0 = 6, wx1 = 45;
    const upY0 = 24, upY1 = 37, loY0 = 40, loY1 = 54;   // trim band at y38–39
    const fAt = (y) => (y - ridgeY) / (eaveY - ridgeY);
    const lxAt = (y) => Math.round(ridgeL + (eaveL - ridgeL) * fAt(y));
    const rxAt = (y) => Math.round(ridgeR + (eaveR - ridgeR) * fAt(y));

    // stories: STONE ground floor, CREAM (lightened PLANK) upper floor
    wallFront(ctx, wx0, loY0, wx1, loY1, S, { eaveAO: false });
    stoneCourses(ctx, wx0, loY0, wx1, loY1);
    const CREAM = [P[1], P[2], P[3], shade(P[3], 1.12)];
    wallFront(ctx, wx0, upY0, wx1, upY1, CREAM, { sill: false });
    ctx.fillStyle = W[1];                                // half-timber posts + studs
    for (const x of [wx0, 19, 30, wx1]) ctx.fillRect(x, upY0 + 1, 1, upY1 - upY0);
    ctx.fillStyle = W[1]; ctx.fillRect(wx0 - 1, 38, wx1 - wx0 + 3, 2);          // floor trim
    ctx.fillStyle = shade(W[2], 1.1); ctx.fillRect(wx0 - 1, 38, wx1 - wx0 + 3, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.1)'; ctx.fillRect(wx0, 40, wx1 - wx0 + 1, 1); // trim drop shadow

    // roof — identical grammar to A (broad slab, 90% ridge, dark fascia)
    farSliver(ctx, R, 8, 43, 5, 7);
    ridgeCrease(ctx, R, ridgeL, ridgeR, ridgeY);
    slopeRows(ctx, ridgeY + 1, eaveY - 1, lxAt, rxAt, shingleFn(R, fAt, [11, 13, 15, 18, 21]), OL);
    litRake(ctx, R, ridgeY + 1, eaveY - 1, lxAt, rxAt);
    eaveRow(ctx, R, eaveL, eaveR, eaveY, wx0, wx1);
    if (winter) snowCap(ctx, ridgeY, eaveY - 1, lxAt, rxAt, fAt);

    // openings — TWO window bands (the vertical story stack), door on stone
    windowAt(ctx, 11, 27, 6, winter);
    windowAt(ctx, 33, 27, 6, winter);
    doorAt(ctx, 22, 44, 8, 10);
    windowAt(ctx, 10, 45, 6, winter);
    windowAt(ctx, 36, 45, 6, winter);

    groundScuffs(ctx, wx0, wx1, 55, winter);
    return c;
}

// ---------------------------------------------------------------------------
// FORM D — GAMBREL / BARN (50×48). A clearly different silhouette: two pitches
// per side meeting at a bright KNEE crease. The upper (shallow, sky-facing)
// band stays in the LIGHT half of the roof grade; the lower (steep) band
// drops into the DARK half and flares outward — two stacked planes at one
// break, unmistakably a roof volume seen from above-and-front.
// ---------------------------------------------------------------------------
function renderD(season) {
    const winter = season === 'WINTER';
    const [c, ctx] = makeCanvas(50, 48);
    const OL = outlineFor(R[1]);

    seatShadow(ctx, { cx: 25, cy: 46, rx: TILE_W / 2, ry: TILE_H / 3 }, { alpha: 0.3 });

    const eaveY = 26, eaveL = 3, eaveR = 46;
    const ridgeY = 9, ridgeL = 13, ridgeR = 36;
    const kneeY = 17;                                    // the gambrel break
    const wx0 = 6, wx1 = 43, wy0 = 27, wy1 = 44;
    const lerp = (a, b, t) => Math.round(a + (b - a) * t);
    const fU = (y) => (y - ridgeY) / (kneeY - ridgeY);
    const fL = (y) => (y - kneeY) / (eaveY - kneeY);
    const lxAt = (y) => y <= kneeY ? lerp(ridgeL, 9, fU(y)) : lerp(9, eaveL, fL(y));
    const rxAt = (y) => y <= kneeY ? lerp(ridgeR, 40, fU(y)) : lerp(40, eaveR, fL(y));
    // upper band lives in the light half of the grade, lower in the dark half
    const fAt = (y) => y <= kneeY ? fU(y) * 0.45 : 0.55 + fL(y) * 0.45;

    wallFront(ctx, wx0, wy0, wx1, wy1, P);
    plankSeams(ctx, [wx0 + 4, wx1 - 8], wy0, wy1 - wy0 + 1, P);

    farSliver(ctx, R, 16, 33, 6, 8);
    ridgeCrease(ctx, R, ridgeL, ridgeR, ridgeY);
    const shingle = shingleFn(R, fAt, [12, 14, 16, 20, 23]);
    slopeRows(ctx, ridgeY + 1, eaveY - 1, lxAt, rxAt, (x, y) =>
        y === kneeY ? shade(R[3], 1.1)          // bright knee crease (plane break)
        : y === kneeY + 1 ? shade(R[2], 0.85)   // dark row under the knee
        : shingle(x, y), OL);
    litRake(ctx, R, ridgeY + 1, eaveY - 1, lxAt, rxAt);
    eaveRow(ctx, R, eaveL, eaveR, eaveY, wx0, wx1);
    // snow loads the shallow upper band and sheds at the knee
    if (winter) snowCap(ctx, ridgeY, eaveY - 1, lxAt, rxAt, (y) => y <= kneeY ? fU(y) * 0.5 : 1, 0.45);

    // big recessed double barn door (center jamb splits the leaves) + window
    doorAt(ctx, 18, 33, 14, 11);
    ctx.fillStyle = W[0]; ctx.fillRect(24, 34, 2, 10);                   // center jamb
    ctx.fillStyle = shade(W[3], 1.15); ctx.fillRect(21, 38, 1, 1);       // left-leaf handle
    windowAt(ctx, 8, 33, 6, winter);

    groundScuffs(ctx, wx0, wx1, 45, winter);
    if (!winter) stampCluster(ctx, 36, wy1 - 4, 13, RAMPS.FOLIAGE, 1);
    return c;
}

// ---------------------------------------------------------------------------
// Public builders — cached per (style, season). FALL falls back to SUMMER.
// ---------------------------------------------------------------------------
const _cache = {};
function cached(style, season, fn) {
    const s = season === 'WINTER' ? 'WINTER' : 'SUMMER';
    const key = style + '|' + s;
    if (!_cache[key]) _cache[key] = fn(s);
    return _cache[key];
}
function makeStyleA(season = 'SUMMER') { return cached('A', season, renderA); }
function makeStyleB(season = 'SUMMER') { return cached('B', season, renderB); }
function makeStyleC(season = 'SUMMER') { return cached('C', season, renderC); }
function makeStyleD(season = 'SUMMER') { return cached('D', season, renderD); }

export const TD_STYLES = [
    { name: 'A — One-story gable', note: 'Ridge kept at 90% of the eave so the near slope is a wide RECTANGLE slab (near-vertical rakes) under a dark far-slope sliver — no taper, no tent.', make: makeStyleA },
    { name: 'B — Hip roof', note: 'Low 14-row trapezoid top plane; the two hip facets are shaded asymmetrically off LIGHT (lit left / dark right) with lit-vs-dark hip creases, so it reads as a slab turning away, not a pyramid.', make: makeStyleB },
    { name: 'C — Two-story gable', note: 'Same slab roof as A over a stacked story build-up: cream/timber upper band on a stone ground floor with a floor-trim drop shadow — the cottage stone+cream test.', make: makeStyleC },
    { name: 'D — Gambrel barn', note: 'Two pitches meeting at a bright knee crease: shallow upper band held in the light half of the grade, steep lower band in the dark half, flaring to the eave — a broken slab, distinct silhouette.', make: makeStyleD },
];
