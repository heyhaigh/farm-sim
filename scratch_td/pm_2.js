// pm_2.js — ARCHETYPE 2: FLAT TOP-PLANE (civic/tower). PM-QA pass.
//
// The trick here is NOT an apex — the flat-top archetype earns its volume purely
// from the VALUE GAP between two planes (the grey-tower zoom crop, 4.42.39 PM):
//   * a LIGHT stone DECK (the roof seen from above) — a straight-sided slab
//     whose eave line OVERHANGS the wall 2px per side (screen-aligned, no splay),
//   * over a DARK front FACE banded into three stories,
//   * plus a 2px darkest DEPTH-SLIVER down the RIGHT side (away from LIGHT),
//     the only hint of the third dimension.
// The plane break is marked the reference's way: a dark fascia (the roof slab's
// edge), a row of dentil teeth dropping onto the wall, and an eave-AO whisper.
// Laws: seatShadow FIRST (fixed <=1 tile); outlineFor() one-step-darker, never
// #000 (lower half + base only — sky edges stay open); recess() for openings;
// base row at the canvas BOTTOM, overflow TOP-only; STONE + GLASS ramps; pure
// fillRect, deterministic (no Math.random / Date / drawImage / globalAlpha / arc).
import { makeCanvas, RAMPS, LIGHT, shade, outlineFor, seatShadow, recess } from '../pixel.js';

export const meta = { name: 'Flat-top Civic Block (PM-QA)', pm: true };

// side choices DERIVE from the light constant — the builder can't silently disagree with it
const litLeft = LIGHT.x < 0;
// hand-tuned warm-rotated step ABOVE the STONE ramp (§1a: no shade()-multiply on big planes):
// S[4] #8b97a2 (~205deg) rotated toward warm neutral + value lift (~200deg)
const STONE_LIT = '#a3aeb4';

// deterministic position hash -> 0..1 (brick ticks / snow jitter; never Math.random)
function _h(a, b) {
    let n = ((a * 374761393) ^ (b * 668265263)) >>> 0;
    n ^= n >>> 15; n = (n * 2246822519) >>> 0; n ^= n >>> 13;
    return (n & 0xffff) / 0x10000;
}

const _cache = {};

export function makeBuilding(season = 'SUMMER') {
    if (_cache[season]) return _cache[season];
    const [c, ctx] = makeCanvas(64, 74);
    const winter = season === 'WINTER', fall = season === 'FALL';
    const S = RAMPS.STONE, G = RAMPS.GLASS, W = RAMPS.WOOD;
    const OL = outlineFor(S[1]);                       // one ramp step below the adjacent dark fill — never #000
    const SNOW_DEEP = '#ffffff', SNOW_MID = '#eef4f4', SNOW_THIN = '#dbe8ec';

    // ---- geometry (screen-aligned; straight-sided slab like the reference tower) ----
    const wx0 = 8, wx1 = 55, ww = wx1 - wx0 + 1;       // front face x-span (48px)
    const wy0 = 27, wy1 = 67;                          // face top (under the fascia) .. plinth top
    const py0 = 68, py1 = 70;                          // foundation plinth rows
    const dTop = 3, dBot = 25;                         // deck rows ~35% incl. fascia (ref tower ~40%)
    const dL = () => 6;                                // constant width — eave overhangs wall 2px/side
    const dR = () => 57;                               // (no camera splay; screen-aligned per 6a.2)
    const cx = 32;

    // ---- grounding FIRST (behind): fixed <=1-tile seat shadow, rows 72-73 peek below the plinth ----
    seatShadow(ctx, { cx, cy: 71, rx: 10, ry: 3 }, { alpha: 0.30 });

    // ---- DECK — the light TOP-PLANE (roof from above) with a parapet rim ----
    const deckLit = STONE_LIT, deckMid = S[4], deckAway = S[3];                       // ramp steps, no plane multiplies (§1a)
    for (let y = dTop; y <= dBot; y++) {
        const lx = dL(y), rx = dR(y), t = (y - dTop) / (dBot - dTop);
        const lipX = litLeft ? lx + 1 : rx - 1;                                       // lit inner lip hugs the LIGHT side
        const farX = litLeft ? rx : lx;                                               // rim edge away from LIGHT
        for (let x = lx; x <= rx; x++) {
            let col;
            if (x === lx || x === rx || y === dTop) col = S[3];                       // parapet rim
            else if (y === dTop + 1 || x === lipX) col = deckLit;                     // lit inner lip toward LIGHT
            else {
                const towardSun = litLeft ? x < lx + (rx - lx) * 0.4 : x > rx - (rx - lx) * 0.4;
                col = t > 0.72 ? deckAway : (towardSun && t < 0.45 ? deckLit : deckMid);
            }
            ctx.fillStyle = col; ctx.fillRect(x, y, 1, 1);
        }
        ctx.fillStyle = shade(S[2], 0.92); ctx.fillRect(farX, y, 1, 1);               // rim's away side — 1px seam accent
    }
    // sparse lighter deck-tile ticks (hashed, deterministic)
    for (let x = 12; x <= 50; x += 3) for (let y = 7; y <= 22; y += 3)
        if (_h(x, y) > 0.7) { ctx.fillStyle = deckLit; ctx.fillRect(x, y, 2, 1); }
    // roof furniture: a recessed HATCH (upper-left) + a vent block (right)
    recess(ctx, 13, 7, 7, 5, shade(S[0], 0.85), S[2]);
    ctx.fillStyle = S[3]; ctx.fillRect(44, 9, 5, 4);                                  // vent body
    ctx.fillStyle = STONE_LIT; ctx.fillRect(44, 9, 5, 1);                             // lit top
    ctx.fillStyle = S[1]; ctx.fillRect(48, 10, 1, 3);                                 // away side
    ctx.fillStyle = shade(S[3], 0.88); ctx.fillRect(45, 13, 5, 1);                    // its own contact shadow (falls away from LIGHT)

    // ---- FASCIA — the roof slab's edge seen head-on (a real edge, full contrast) ----
    ctx.fillStyle = S[1]; ctx.fillRect(dL(dBot), dBot + 1, dR(dBot) - dL(dBot) + 1, 1);
    ctx.fillStyle = OL; ctx.fillRect(dL(dBot) - 1, dBot + 1, 1, 1); ctx.fillRect(dR(dBot) + 1, dBot + 1, 1, 1);

    // ---- FRONT FACE — the dark plane (the value gap IS the volume) ----
    const litStripX = litLeft ? wx0 : wx1 - 2;                                        // 3px lit strip on the LIGHT side
    const shadowBandX = litLeft ? wx1 - 5 : wx0 + 2;                                  // 4px shadow band away from it
    const sliverX = litLeft ? wx1 - 1 : wx0;                                          // 2px depth sliver, away edge
    ctx.fillStyle = S[2]; ctx.fillRect(wx0, wy0, ww, wy1 - wy0 + 1);
    ctx.fillStyle = S[3]; ctx.fillRect(litStripX, wy0, 3, wy1 - wy0 + 1);             // lit strip toward LIGHT
    ctx.fillStyle = shade(S[2], 0.9); ctx.fillRect(shadowBandX, wy0, 4, wy1 - wy0 + 1); // shadow band
    ctx.fillStyle = S[1]; ctx.fillRect(sliverX, wy0, 2, wy1 - wy0 + 1);               // 2px DEPTH-SLIVER (away from LIGHT) — never a receding wall
    // overhang underside: the deck sticks 2px past the wall each side
    ctx.fillStyle = OL; ctx.fillRect(dL(dBot), wy0, wx0 - dL(dBot), 1); ctx.fillRect(wx1 + 1, wy0, dR(dBot) - wx1, 1);
    // eave-AO whisper on the wall under the overhang
    ctx.fillStyle = 'rgba(0,0,0,0.09)'; ctx.fillRect(wx0, wy0, ww, 2);
    // dentil teeth dropping from the fascia — the fascia's OWN tone dropping tabs (flat S[1], no multiply)
    ctx.fillStyle = S[1];
    for (let x = wx0 + 2; x <= wx1 - 3; x += 5) ctx.fillRect(x, wy0, 2, 2);
    // sparse stone brick ticks (hashed; the openings paint over them)
    for (let x = wx0 + 1; x <= wx1 - 3; x += 2) for (let y = wy0 + 3; y <= wy1 - 2; y += 3) {
        const r = _h(x, y);
        if (r > 0.82) { ctx.fillStyle = shade(S[2], 0.9); ctx.fillRect(x, y, 2, 1); }
        else if (r < 0.08) { ctx.fillStyle = shade(S[2], 1.07); ctx.fillRect(x, y, 1, 1); }
    }

    // ---- FLOOR BANDS — horizontal cornice ledges splitting the face into stories ----
    const bands = [40, 53];
    for (const by of bands) {
        ctx.fillStyle = S[4]; ctx.fillRect(wx0, by, ww, 1);                           // ledge top catches the light (ramp step, not a multiply)
        ctx.fillStyle = S[1]; ctx.fillRect(wx0, by + 1, ww, 1);                       // ledge underside
        ctx.fillStyle = 'rgba(0,0,0,0.08)'; ctx.fillRect(wx0, by + 2, ww, 1);         // drop-shadow whisper
        ctx.fillStyle = S[1]; ctx.fillRect(sliverX, by, 2, 2);                        // sliver runs THROUGH the ledge (depth continuity)
    }

    // ---- WINDOW GRID — slit COLONNADE: 8 narrow teal slits per story (the tower's grammar) ----
    const winW = 2, winH = 6;
    const paneCol = winter ? SNOW_THIN : G[1];                                        // winter pane frost (§6b.5)
    const glintCol = winter ? SNOW_MID : G[2];                                        // reflection stays, lighter under frost
    for (const wy of [30, 43]) {
        ctx.fillStyle = S[3];                                                          // ONE continuous string-course, not per-slit lintels
        ctx.fillRect(wx0 + 3, wy - 2, (wx1 - 6) - (wx0 + 3) + 1, 1);
        for (let k = 0; k < 8; k++) {
            const x = 12 + 5 * k;                                                      // 12..47; rims reach x11..x49
            recess(ctx, x, wy, winW, winH, paneCol, S[1]);
            ctx.fillStyle = G[0]; ctx.fillRect(x, wy + winH - 1, winW, 1);             // one darker bottom row
            ctx.fillStyle = glintCol; ctx.fillRect(x, wy, 1, 1);                       // exactly ONE glint px (§6a.8)
            ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(x - 1, wy + winH + 1, winW + 2, 1);  // sill drop shadow
            if (winter) { ctx.fillStyle = SNOW_MID; ctx.fillRect(x - 1, wy + winH, winW + 2, 1); } // snow on the sill
        }
    }

    // ---- GROUND STORY — a tall recessed double door + two slit windows ----
    { const dx = 27, dyT = 55, dw = 10, dh = 13;
      ctx.fillStyle = '#3a2818'; ctx.fillRect(dx - 1, dyT - 1, dw + 2, dh + 2);       // WOOD-family surround (§3.2: never a stone outline around wood)
      ctx.fillStyle = '#3a2818'; ctx.fillRect(dx, dyT, dw, dh);                       // dark interior (never below OUTLINE-BROWN)
      ctx.fillStyle = shade(W[2], 1.08); ctx.fillRect(dx - 1, dyT - 1, dw + 2, 1);    // lit wood lintel
      ctx.fillStyle = W[2]; ctx.fillRect(dx, dyT, 1, dh); ctx.fillRect(dx + dw - 1, dyT, 1, dh);   // jamb posts
      ctx.fillStyle = W[1]; ctx.fillRect(dx + dw / 2, dyT + 1, 1, dh - 1);            // center seam (double door)
      ctx.fillStyle = shade(W[3], 1.1); ctx.fillRect(dx + 3, dyT + 6, 1, 1); ctx.fillRect(dx + 6, dyT + 6, 1, 1);   // handles
      ctx.fillStyle = 'rgba(0,0,0,0.13)'; ctx.fillRect(dx - 1, dyT + dh + 1, dw + 2, 1);   // threshold whisper
    }
    for (const x of [14, 44]) {                                                       // ground slits
        recess(ctx, x, 57, 4, 5, paneCol, S[1]);                                      // frosted in winter like the upper glass
        ctx.fillStyle = G[0]; ctx.fillRect(x, 60, 4, 1);
        ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(x, 63, 4, 1);
        if (winter) { ctx.fillStyle = SNOW_MID; ctx.fillRect(x - 1, 62, 6, 1); }      // sill snow, same as the upper windows
    }

    // ---- FOUNDATION PLINTH + base outline (lower half only, per the OUTLINE LAW) ----
    ctx.fillStyle = S[1]; ctx.fillRect(wx0, py0, ww, py1 - py0 + 1);
    ctx.fillStyle = S[3]; ctx.fillRect(wx0, py0, ww, 1);                              // plinth top lit course (ramp step, not a multiply)
    ctx.fillStyle = shade(S[1], 0.9);
    for (let x = wx0 + 3; x <= wx1 - 3; x += 6) ctx.fillRect(x, py0 + 1, 1, 2);       // plinth block seams
    ctx.fillStyle = 'rgba(0,0,0,0.13)'; ctx.fillRect(26, 68, 12, 1);                  // re-stamp the door threshold OVER the plinth (breaks the lit course under the doorway)
    ctx.fillStyle = outlineFor(S[3]);                                                 // lit column sits against the S[3] lit strip — one step, not three
    ctx.fillRect(litLeft ? wx0 - 1 : wx1 + 1, 44, 1, py1 - 44 + 1);                   // side outline (lit side), lower half down
    ctx.fillStyle = OL;
    ctx.fillRect(litLeft ? wx1 + 1 : wx0 - 1, 44, 1, py1 - 44 + 1);                   // side outline (shadow side) — adjacent fill IS the S[1] sliver
    ctx.fillRect(wx0, py1 + 1, ww, 1);                                                // ground AO row

    // ---- SEASONS ----
    if (winter) {
        // snow slab on the deck interior — the rim, hatch, and vent stay dark so the plane still reads
        for (let y = dTop + 2; y <= dBot - 1; y++) {
            const lx = dL(y) + 2, rx = dR(y) - 2;
            for (let x = lx; x <= rx; x++) {
                if (x >= 12 && x <= 20 && y >= 6 && y <= 12) continue;                // keep the hatch clear
                if (x >= 43 && x <= 49 && y >= 8 && y <= 13) continue;                // keep the vent clear
                if (_h(x, y + 40) > 0.88) continue;                                    // stone peeks through
                const b1 = dTop + 4 + (Math.floor(_h(x, dTop + 4 + 40) * 3) - 1);      // tone boundaries jitter +/-1 per column
                const b2 = dBot - 4 + (Math.floor(_h(x, dBot - 4 + 40) * 3) - 1);      // (no banned flat bands)
                ctx.fillStyle = y <= b1 ? SNOW_DEEP : (y <= b2 ? SNOW_MID : SNOW_THIN);
                ctx.fillRect(x, y, 1, 1);
            }
        }
        for (let x = dL(dBot) + 1; x <= dR(dBot) - 1; x++)                            // lumpy snow on the eave lip (fascia top, y25)
            if (_h(x, dBot + 40) > 0.35) { ctx.fillStyle = SNOW_MID; ctx.fillRect(x, dBot, 1, 1); }
        for (let x = 26; x <= 37; x++)                                                // snow perched on the door lintel
            if (_h(x, 54 + 40) > 0.4) { ctx.fillStyle = SNOW_MID; ctx.fillRect(x, 54, 1, 1); }
        for (const by of bands) for (let x = wx0; x <= wx1 - 2; x++)                  // snow perched on the ledges
            if (_h(x, by) > 0.42) { ctx.fillStyle = SNOW_MID; ctx.fillRect(x, by, 1, 1); }
        for (let x = wx0; x <= wx1; x++)                                              // drifted ground line
            if (_h(x, 66) > 0.45) { ctx.fillStyle = _h(x, 67) > 0.6 ? SNOW_THIN : SNOW_MID; ctx.fillRect(x, py1, 1, 1); }
    } else if (fall) {
        for (const [col, lx, ly] of [['#c9782a', 7, 66], ['#a8531e', 52, 67], ['#d89a34', 11, 70], ['#b8641a', 47, 70], ['#c9782a', 20, 71]]) {
            ctx.fillStyle = col; ctx.fillRect(lx, ly, 1, 1);                          // dry-leaf flecks pooled at the base
        }
    } else {
        const gA = RAMPS.FOLIAGE[4], gB = RAMPS.FOLIAGE[3];                           // grass scuffs seat the plinth
        for (const [x, col] of [[10, gA], [19, gB], [40, gB], [50, gA]]) {
            ctx.fillStyle = col; ctx.fillRect(x, py1 - 1, 1, 2); ctx.fillRect(x + 1, py1, 1, 1);
        }
    }

    _cache[season] = c;
    return c;
}
