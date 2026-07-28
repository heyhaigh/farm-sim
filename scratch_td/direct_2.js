// direct_2.js — ARCHETYPE 2: FLAT TOP-PLANE (civic/tower), top-down grammar.
// The volume is made by the VALUE GAP, not the outline: a LIGHT stone top-plane
// (the roof deck seen from above, a gently skewed parallelogram — the oblique cheat)
// sits over a DARK front face; a thin darkest depth-sliver runs down the RIGHT side
// (away from the upper-left LIGHT). Horizontal floor ledges + a repeated GLASS
// window grid band the face into 2.5 stories; a dentil/drip row marks the plane
// break at the eave; crenellated plinth feet seat it. No gable, no apex — the
// flat-top archetype's "trick" is the lit deck reading as a true horizontal plane.
// Laws honored: seatShadow FIRST (fixed <=1 tile); outlineFor() one-step-darker,
// never #000; recess() for every opening; roof overhangs the wall and drops an
// eave-AO line; base row at the canvas BOTTOM, overflow TOP-only; pure fillRect,
// deterministic (no Math.random / Date / drawImage / globalAlpha / arc).
import { makeCanvas, RAMPS, LIGHT, shade, outlineFor, seatShadow, sphereMask, stampCluster, recess, fillDiamond, TILE_W, TILE_H } from '../pixel.js';

export const meta = { name: 'Flat-top Civic Tower (DIRECT)', pm: false };

// deterministic position hash -> 0..1 (texture ticks / snow jitter; never Math.random)
function _phash(a, b) {
    let n = ((a * 73856093) ^ (b * 19349663)) >>> 0;
    n ^= n >>> 15; n = (n * 2246822519) >>> 0; n ^= n >>> 13;
    return (n % 1024) / 1024;
}

// one GLASS window with recess rim, mullion cross, sparkle + sill. w=5, h=7 (or 6).
function _window(ctx, x, y, h, S, G, winter) {
    recess(ctx, x, y, 5, h, G[0], S[0]);
    ctx.fillStyle = winter ? '#b6cdd6' : G[1]; ctx.fillRect(x, y + 1, 5, 3);          // upper pane brighter (sky)
    ctx.fillStyle = winter ? '#e8f4f8' : G[2]; ctx.fillRect(x + 1, y + 1, 1, 1);      // 1px sparkle, light corner
    ctx.fillStyle = S[0]; ctx.fillRect(x + 2, y, 1, h);                               // mullion cross
    ctx.fillStyle = S[0]; ctx.fillRect(x, y + Math.floor(h / 2), 5, 1);
    ctx.fillStyle = S[2]; ctx.fillRect(x - 1, y + h, 7, 1);                           // protruding sill, lit top
    ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(x - 1, y + h + 1, 7, 1);         // sill drop shadow
    if (winter) { ctx.fillStyle = '#eef4f4'; ctx.fillRect(x - 1, y + h, 7, 1); }      // snow-capped sill
}

const _cache = {};
export function makeBuilding(season = 'SUMMER') {
    if (_cache[season]) return _cache[season];
    const [c, ctx] = makeCanvas(64, 70);
    const winter = season === 'WINTER', fall = season === 'FALL';
    const S = RAMPS.STONE, G = RAMPS.GLASS, W = RAMPS.WOOD, R = RAMPS.ROOF_RED;
    const FACE = S[1];                                  // dark front face — the low half of the value gap
    const DECK = S[3];                                  // light top-plane — the high half
    const OLface = outlineFor(FACE);                    // = S[0]
    const OLdeck = outlineFor(DECK);                    // = S[2]
    const OLdark = shade(S[0], 0.8);                    // outline vs the darkest sliver (in-hue, never #000)
    const SNOW_DEEP = '#ffffff', SNOW_MID = '#eef4f4', SNOW_TINT = '#dfeaec';

    // ---- GROUNDING FIRST: the fixed <=1-tile seat shadow (SHADOW LAW) ----
    seatShadow(ctx, { cx: 32, cy: 66, rx: TILE_W / 2, ry: 3 }, { alpha: 0.30 });

    // ---- GEOMETRY ----
    // top-plane deck: skewed parallelogram, far edge shifted LEFT 2px (depth recedes
    // up-left => we glimpse the RIGHT wall as the dark sliver; LIGHT stays upper-left)
    const dY0 = 3, dY1 = 22;                            // deck rows (far -> near lip)
    const dT = (y) => (y - dY0) / (dY1 - dY0);
    const dLx = (y) => Math.round(2 + 2 * dT(y));       // left rake 2 -> 4
    const dRx = (y) => Math.round(57 + 2 * dT(y));      // right rake 57 -> 59
    const wx0 = 7, wx1 = 56, wy0 = 24, wy1 = 61;        // front face (deck overhangs 3px/side)
    const px0 = 2, px1 = 61, py0 = 62, py1 = 64;        // plinth — widest, sacred base

    // ---- FRONT FACE (drawn before the deck so the eave overhangs it) ----
    ctx.fillStyle = OLface; ctx.fillRect(wx0 - 1, wy0, (wx1 - wx0 + 1) + 2, (wy1 - wy0 + 1) + 1);
    ctx.fillStyle = FACE; ctx.fillRect(wx0, wy0, wx1 - wx0 + 1, wy1 - wy0 + 1);
    ctx.fillStyle = S[2]; ctx.fillRect(wx0, wy0, 3, wy1 - wy0 + 1);                   // lit-left strip (upper-left LIGHT)
    // the thin DEPTH-SLIVER down the right side — the wall turning away, darkest
    ctx.fillStyle = shade(FACE, 0.86); ctx.fillRect(53, wy0, 1, wy1 - wy0 + 1);       // corner transition seam
    ctx.fillStyle = S[0]; ctx.fillRect(54, wy0, 3, wy1 - wy0 + 1);
    ctx.fillStyle = OLdark; ctx.fillRect(57, wy0, 1, wy1 - wy0 + 1);                  // silhouette edge vs ground
    // sparse masonry ticks (deterministic; quiet — repetition without noise)
    for (let y = wy0 + 3; y <= wy1 - 2; y++) for (let x = wx0 + 3; x <= 52; x++) {
        const h = _phash(x, y);
        if (h > 0.985) { ctx.fillStyle = shade(FACE, 0.92); ctx.fillRect(x, y, 2, 1); }
        else if (h < 0.008) { ctx.fillStyle = shade(FACE, 1.06); ctx.fillRect(x, y, 2, 1); }
    }

    // ---- TOP-PLANE DECK (roof seen from above): light field, parapet ring, skewed edges ----
    for (let y = dY0; y <= dY1; y++) {
        const lx = dLx(y), rx = dRx(y);
        for (let x = lx; x <= rx; x++) {
            let col = DECK;
            if (y <= 9 && x <= lx + 22 + Math.round(_phash(x >> 2, 5) * 3)) col = S[4];   // lit patch, LIGHT quadrant (upper-left)
            if (y >= dY1 - 2 || x >= rx - 3) col = S[2];                                  // inner AO toward the away quadrant
            ctx.fillStyle = col; ctx.fillRect(x, y, 1, 1);
        }
        ctx.fillStyle = S[4]; ctx.fillRect(lx, y, 1, 1);                              // lit left rake edge
        ctx.fillStyle = S[2]; ctx.fillRect(rx, y, 1, 1);                              // shaded right rake edge
        ctx.fillStyle = OLdeck; ctx.fillRect(lx - 1, y, 1, 1); ctx.fillRect(rx + 1, y, 1, 1);
    }
    ctx.fillStyle = S[2]; ctx.fillRect(dLx(dY0), dY0, dRx(dY0) - dLx(dY0) + 1, 1);    // far parapet lip (back plane, darker)
    ctx.fillStyle = OLdeck; ctx.fillRect(dLx(dY0) - 1, dY0 - 1, dRx(dY0) - dLx(dY0) + 3, 1);  // silhouette cap (overflow-top zone)
    if (winter) {                                                                      // snow settles INSIDE the parapet ring
        for (let y = dY0 + 2; y <= dY1 - 3; y++) {
            const lx = dLx(y) + 2, rx = dRx(y) - 4;
            for (let x = lx; x <= rx; x++) {
                if (_phash(x, y) < 0.06) continue;                                     // deterministic melt speckle
                ctx.fillStyle = (y <= 8 && x <= lx + 20) ? SNOW_DEEP : (y >= dY1 - 5 ? SNOW_TINT : SNOW_MID);
                ctx.fillRect(x, y, 1, 1);
            }
        }
    }
    ctx.fillStyle = shade(S[4], 1.06); ctx.fillRect(dLx(dY1), dY1, dRx(dY1) - dLx(dY1) + 1, 1);   // bright NEAR lip — the plane break crease
    // deck furniture: an access hatch (recessed) + two vent slits, off-center (nothing mirrors)
    recess(ctx, 11, 7, 7, 5, '#2f333b', S[2]);
    ctx.fillStyle = S[1]; ctx.fillRect(46, 8, 3, 1); ctx.fillRect(46, 11, 3, 1);
    ctx.fillStyle = shade(S[4], 1.04); ctx.fillRect(46, 9, 3, 1); ctx.fillRect(46, 12, 3, 1);

    // ---- DENTIL / DRIP ROW — the toothed transition where light plane meets dark face ----
    ctx.fillStyle = S[1]; ctx.fillRect(4, 23, 56, 1);                                 // fascia under the lip
    for (let x = 5; x <= 58; x += 4) { ctx.fillStyle = S[0]; ctx.fillRect(x, 23, 2, 2); }   // teeth drip onto the wall
    ctx.fillStyle = OLdeck; ctx.fillRect(4, 24, 3, 1); ctx.fillRect(57, 24, 3, 1);    // overhang underside at the corners
    ctx.fillStyle = 'rgba(0,0,0,0.10)'; ctx.fillRect(wx0, wy0, wx1 - wx0 + 1, 2);     // eave-AO whisper cast on the wall top

    // ---- FLOOR LEDGES (horizontal bands = the stories) ----
    for (const ly of [37, 51]) {
        ctx.fillStyle = S[2]; ctx.fillRect(wx0 - 1, ly, (wx1 - wx0 + 1) + 2, 1);      // lit ledge top (protrudes 1px)
        ctx.fillStyle = S[0]; ctx.fillRect(wx0 - 1, ly + 1, (wx1 - wx0 + 1) + 2, 1);  // ledge drop shadow
    }

    // ---- WINDOW GRID (same x-rhythm both floors — repetition is the clarity) ----
    for (const x of [11, 22, 33, 44]) _window(ctx, x, 28, 7, S, G, winter);           // floor 3
    for (const x of [11, 22, 33, 44]) _window(ctx, x, 41, 7, S, G, winter);           // floor 2
    _window(ctx, 11, 55, 6, S, G, winter);                                            // ground floor flanks
    _window(ctx, 44, 55, 6, S, G, winter);

    // ---- civic BANNER between the top-floor windows (ties to the town's roof red) ----
    ctx.fillStyle = W[1]; ctx.fillRect(26, 25, 8, 1);                                 // hanging rod
    ctx.fillStyle = R[3]; ctx.fillRect(28, 26, 4, 10);
    ctx.fillStyle = R[4]; ctx.fillRect(28, 26, 1, 10);                                // lit left edge
    ctx.fillStyle = R[2]; ctx.fillRect(31, 26, 1, 10);                                // shaded right edge
    ctx.fillStyle = R[3]; ctx.fillRect(28, 36, 1, 1); ctx.fillRect(31, 36, 1, 1);     // V-notch tail
    ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(32, 27, 1, 9);                   // cast shadow on the wall (away side)

    // ---- PLINTH — the widest base band, crenellated feet ----
    ctx.fillStyle = OLface; ctx.fillRect(px0 - 1, py0, (px1 - px0 + 1) + 2, (py1 - py0 + 1));
    ctx.fillStyle = S[2]; ctx.fillRect(px0, py0, px1 - px0 + 1, 1);                   // lit top course
    ctx.fillStyle = FACE; ctx.fillRect(px0, py0 + 1, px1 - px0 + 1, py1 - py0);
    for (let x = 8; x <= 53; x += 9) { ctx.fillStyle = S[0]; ctx.fillRect(x, 63, 3, 2); }   // dark gaps => feet
    ctx.fillStyle = OLface; ctx.fillRect(px0, py1 + 1, px1 - px0 + 1, 1);             // ground AO — the base row (bottom of art)
    if (winter) for (let x = px0; x <= px1; x++) if (_phash(x, 41) > 0.45) { ctx.fillStyle = _phash(x, 42) > 0.6 ? SNOW_TINT : SNOW_MID; ctx.fillRect(x, py0, 1, 1); }

    // ---- DOOR — recessed civic double door, cut through the plinth to the ground ----
    recess(ctx, 24, 54, 12, 11, '#241c18', S[0]);
    ctx.fillStyle = S[2]; ctx.fillRect(23, 52, 14, 1);                                // stone lintel
    ctx.fillStyle = S[0]; ctx.fillRect(23, 53, 14, 1);
    ctx.fillStyle = W[2]; ctx.fillRect(25, 56, 10, 9);                                // wooden leaves (2 rows of dark = the reveal)
    ctx.fillStyle = W[3]; ctx.fillRect(25, 56, 10, 1);                                // lit door top
    ctx.fillStyle = W[3]; ctx.fillRect(25, 56, 1, 9);                                 // lit left stile
    ctx.fillStyle = W[1]; ctx.fillRect(34, 56, 1, 9);                                 // shaded right stile
    ctx.fillStyle = W[0]; ctx.fillRect(29, 56, 1, 9); ctx.fillRect(30, 56, 1, 9);     // center seam (double door)
    ctx.fillStyle = W[4]; ctx.fillRect(28, 60, 1, 1); ctx.fillRect(31, 60, 1, 1);     // handles
    ctx.fillStyle = 'rgba(0,0,0,0.13)'; ctx.fillRect(24, 64, 12, 1);                  // threshold AO

    // ---- GROUNDING PASS: tufts + season flecks (skip greens in winter) ----
    if (!winter) {
        stampCluster(ctx, 3, 58, 7, RAMPS.FOLIAGE, 1);
        stampCluster(ctx, 55, 59, 11, RAMPS.FOLIAGE, 0);
        if (fall) for (const [col, lx, ly] of [['#c9782a', 6, 64], ['#a8531e', 50, 64], ['#d89a34', 19, 65], ['#b8641a', 41, 65]]) { ctx.fillStyle = col; ctx.fillRect(lx, ly, 1, 1); }
    } else {
        ctx.fillStyle = SNOW_MID; ctx.fillRect(4, 63, 4, 2); ctx.fillRect(55, 63, 4, 2);   // drift at the feet
        ctx.fillStyle = SNOW_DEEP; ctx.fillRect(5, 63, 2, 1); ctx.fillRect(56, 63, 2, 1);
    }

    _cache[season] = c;
    return c;
}
