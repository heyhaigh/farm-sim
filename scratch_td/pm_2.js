// pm_2.js — ARCHETYPE 2: FLAT TOP-PLANE (civic/tower). PM-QA pass.
//
// STATUS: an EXERCISE, not a shipping asset. Owner: "I don't think we'd ever actually use
// this flat building in-game." Its value was proving the §S laws transfer to a second
// archetype — they do. Warmed out of corporate-grey into the fantasy family (MOSS_STONE,
// arched timber-lintelled bays, half-timbered posts, a guild banner).
// KNOWN ISSUES if it is ever revived:
//   1. the banner is drawn BEFORE the front face, so the face paints over it — move it
//      after the face/window block;
//   2. three even storeys of identical arched bays still read townhouse, not guild hall;
//      it wants varied storey heights or a stepped/gabled crown instead of a flat deck.
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
// a warm lit step above MOSS_STONE[4]; the cold #a3aeb4 read as corporate glass-and-steel
const STONE_LIT = '#cdbfa4';   // warm lit step above MOSS_STONE[4] — lichened rock, not steel

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
    const S = RAMPS.MOSS_STONE, G = RAMPS.GLASS, W = RAMPS.WOOD, R = RAMPS.ROOF_RED;
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

    // NO SEAT SHADOW (§S.2). The <=1-tile clamp seats a prop; under a building it renders a
    // ~20px smudge unrelated to the footprint. The plinth + base outline do the grounding.

    // ---- DECK — the light TOP-PLANE (roof from above) with a parapet rim ----
    const deckLit = STONE_LIT, deckMid = S[4], deckAway = S[3];                       // ramp steps, no plane multiplies (§1a)
    for (let y = dTop; y <= dBot; y++) {
        const lx = dL(y), rx = dR(y), t = (y - dTop) / (dBot - dTop);
        const lipX = litLeft ? lx + 1 : rx - 1;                                       // lit inner lip hugs the LIGHT side
        const farX = litLeft ? rx : lx;                                               // rim edge away from LIGHT
        for (let x = lx; x <= rx; x++) {
            let col, isRim = false;
            if (x === lx || x === rx || y === dTop) { col = S[3]; isRim = true; }      // parapet rim
            else if (y === dTop + 1 || x === lipX) col = deckLit;                     // lit inner lip toward LIGHT
            else {
                const towardSun = litLeft ? x < lx + (rx - lx) * 0.4 : x > rx - (rx - lx) * 0.4;
                col = t > 0.72 ? deckAway : (towardSun && t < 0.45 ? deckLit : deckMid);
            }
            if (!isRim) {
                // §S.2b LIGHTING PASS — the deck was flat tile work with no diagonal stroke
                // and no broad gradient, which is exactly what makes a flat plane read dead.
                const ci = Math.floor((y - dTop) / 4), rr = ((y - dTop) % 4 + 4) % 4;
                const tcol = (x + (ci % 2) * 2) % 5;
                if ((tcol + rr) % 4 === 1) col = shade(col, 1.07);                     // (a) diagonal stroke
                else if ((tcol + rr) % 4 === 2) col = shade(col, 1.03);
                const gx = litLeft ? (x - lx) / Math.max(1, rx - lx)
                                   : 1 - (x - lx) / Math.max(1, rx - lx);              // 0 toward the sun .. 1 away
                col = shade(col, 1.05 - gx * 0.11 - t * 0.07);                         // (b)+(c) broad falloff + lift
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

    // ---- BANNER — a guild pennant hung from the fascia. One warm red note ties the civic
    // block to the red-roofed houses; a mythic hall flies colours, an office does not. ----
    const banX = 20;
    ctx.fillStyle = R[1]; ctx.fillRect(banX, 27, 7, 16);
    ctx.fillStyle = R[2]; ctx.fillRect(banX, 27, 3, 16);                              // lit half (toward LIGHT)
    ctx.fillStyle = shade(R[0], 0.95); ctx.fillRect(banX + 6, 27, 1, 16);             // away edge
    ctx.fillStyle = shade(W[3], 1.06); ctx.fillRect(banX - 1, 26, 9, 1);              // hanging rail
    for (let k = 0; k < 7; k++) {                                                     // swallow-tail hem
        const cut = (k === 3) ? 0 : (k === 2 || k === 4) ? 1 : (k === 1 || k === 5) ? 2 : 3;
        ctx.clearRect(banX + k, 43 - cut, 1, cut + 1);
    }
    ctx.fillStyle = shade(R[3], 1.08); ctx.fillRect(banX + 2, 32, 3, 3);              // emblem
    ctx.fillStyle = R[0]; ctx.fillRect(banX + 3, 33, 1, 1);

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
    // §S.2b broad gradient across the FACE, keyed to LIGHT and applied as a translucent
    // wash so it scales with the lit strip, the mid field and the sliver alike (§S.2).
    for (let x = wx0; x <= wx1; x++) {
        const gx = litLeft ? (x - wx0) / ww : 1 - (x - wx0) / ww;                     // 0 toward the sun .. 1 away
        ctx.fillStyle = `rgba(0,0,0,${(0.11 * gx).toFixed(3)})`;
        ctx.fillRect(x, wy0, 1, wy1 - wy0 + 1);
    }
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
        if (r > 0.82) { ctx.fillStyle = 'rgba(0,0,0,0.11)'; ctx.fillRect(x, y, 2, 1); }
        else if (r < 0.08) { ctx.fillStyle = 'rgba(255,238,210,0.07)'; ctx.fillRect(x, y, 1, 1); }
    }

    // ---- FLOOR BANDS — horizontal cornice ledges splitting the face into stories ----
    const bands = [40, 53];
    for (const by of bands) {
        ctx.fillStyle = S[4]; ctx.fillRect(wx0, by, ww, 1);                           // ledge top catches the light (ramp step, not a multiply)
        ctx.fillStyle = S[1]; ctx.fillRect(wx0, by + 1, ww, 1);                       // ledge underside
        ctx.fillStyle = 'rgba(0,0,0,0.08)'; ctx.fillRect(wx0, by + 2, ww, 1);         // drop-shadow whisper
        ctx.fillStyle = S[1]; ctx.fillRect(sliverX, by, 2, 2);                        // sliver runs THROUGH the ledge (depth continuity)
    }

    // ---- WINDOW BAYS — ARCHED and timber-lintelled. The 8-slit colonnade per storey read
    // as an office block; a mythic hall wants fewer, larger, arched openings. ----
    const paneCol = winter ? SNOW_THIN : G[1];
    const glintCol = winter ? SNOW_MID : G[2];
    function archWindow(x, y, w, h) {
        ctx.fillStyle = shade(W[1], 0.9); ctx.fillRect(x - 1, y - 1, w + 2, h + 2);       // timber surround
        ctx.fillStyle = paneCol; ctx.fillRect(x, y, w, h);
        for (const k of [0, w - 1]) { ctx.fillStyle = shade(W[1], 0.9); ctx.fillRect(x + k, y, 1, 1); }   // knock the top corners -> ARCH
        ctx.fillStyle = G[0]; ctx.fillRect(x, y + h - 1, w, 1);                            // darker bottom
        ctx.fillStyle = W[1]; ctx.fillRect(x + (w >> 1), y + 1, 1, h - 2);                 // mullion
        ctx.fillStyle = glintCol; ctx.fillRect(x + 1, y + 1, 1, 1);                        // one glint
        ctx.fillStyle = shade(W[2], 1.08); ctx.fillRect(x - 2, y - 2, w + 4, 1);           // lit timber lintel over the arch
        ctx.fillStyle = 'rgba(0,0,0,0.13)'; ctx.fillRect(x - 1, y + h + 1, w + 2, 1);      // sill drop shadow
        if (winter) { ctx.fillStyle = SNOW_MID; ctx.fillRect(x - 1, y + h, w + 2, 1); }
    }
    for (const wy of [31, 44]) {
        for (let k = 0; k < 4; k++) archWindow(13 + 11 * k, wy, 7, 8);
    }
    // half-timbered posts between the bays — ties the civic to the timber family
    for (const px of [11, 22, 33, 44, 55]) {
        ctx.fillStyle = 'rgba(0,0,0,0.13)'; ctx.fillRect(px, wy0 + 3, 1, wy1 - wy0 - 3);
        ctx.fillStyle = 'rgba(255,238,210,0.06)'; ctx.fillRect(px + 1, wy0 + 3, 1, wy1 - wy0 - 3);
    }

    // ---- GROUND STORY — slit windows (the DOOR is drawn after the plinth, below) ----
    for (const x of [14, 43]) archWindow(x, 57, 7, 7);                                // ground bays, same arched grammar

    // ---- FOUNDATION PLINTH + base outline (lower half only, per the OUTLINE LAW) ----
    ctx.fillStyle = S[1]; ctx.fillRect(wx0, py0, ww, py1 - py0 + 1);
    ctx.fillStyle = S[3]; ctx.fillRect(wx0, py0, ww, 1);                              // plinth top lit course (ramp step, not a multiply)
    ctx.fillStyle = 'rgba(0,0,0,0.14)';
    for (let x = wx0 + 3; x <= wx1 - 3; x += 6) ctx.fillRect(x, py0 + 1, 1, 2);       // plinth block seams (proportional, §S.2)
    ctx.fillStyle = outlineFor(S[3]);                                                 // lit column sits against the S[3] lit strip — one step, not three
    ctx.fillRect(litLeft ? wx0 - 1 : wx1 + 1, 44, 1, py1 - 44 + 1);                   // side outline (lit side), lower half down
    ctx.fillStyle = OL;
    ctx.fillRect(litLeft ? wx1 + 1 : wx0 - 1, 44, 1, py1 - 44 + 1);                   // side outline (shadow side) — adjacent fill IS the S[1] sliver
    ctx.fillRect(wx0, py1 + 1, ww, 1);                                                // ground AO row

    // ---- DOOR — drawn AFTER the plinth so it RUNS THROUGH it to the ground (§S.2).
    // Previously it ended at y67 and the plinth was then painted over its base, so the
    // doorway both stopped short of the ground AND got clipped by the foundation.
    { const dx = 27, dyT = 55, dw = 10, dBottom = py1, dh = dBottom - dyT + 1;
      ctx.fillStyle = '#3a2818'; ctx.fillRect(dx - 1, dyT - 1, dw + 2, dh + 1);       // WOOD-family surround (§3.2)
      ctx.fillStyle = '#3a2818'; ctx.fillRect(dx, dyT, dw, dh);                       // dark interior
      ctx.fillStyle = shade(W[2], 1.08); ctx.fillRect(dx - 1, dyT - 1, dw + 2, 1);    // lit wood lintel
      ctx.fillStyle = W[2]; ctx.fillRect(dx, dyT, 1, dh); ctx.fillRect(dx + dw - 1, dyT, 1, dh);   // jamb posts
      ctx.fillStyle = W[1]; ctx.fillRect(dx + dw / 2, dyT + 1, 1, dh - 1);            // center seam (double door)
      ctx.fillStyle = shade(W[3], 1.1); ctx.fillRect(dx + 3, dyT + 6, 1, 1); ctx.fillRect(dx + 6, dyT + 6, 1, 1);   // handles
      ctx.fillStyle = 'rgba(0,0,0,0.16)'; ctx.fillRect(dx, dBottom, dw, 1);           // contact shadow where it meets the ground
    }

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
