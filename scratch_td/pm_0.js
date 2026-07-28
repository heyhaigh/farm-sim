// pm_0.js — ARCHETYPE 0: SLAB + CENTRAL DORMER APEX (the cottage archetype) — PM-QA pass.
// Roof grammar per SLYNYRD Pixelblog 51 + the CraftPix cottage: the roof is a flat
// HORIZONTAL SLAB — a bright sky-facing TOP STRIP (lightly beveled corners), a mid body
// of half-offset shingle courses, then a DARK overhanging EAVE band with a fascia
// underside seen where the slab sticks out past the wall. The APEX that stops the slab
// reading as a flat box is a CENTRAL FORWARD GABLE: an inverted-V chevron band punched
// down THROUGH the slab, LIT LEFT facet / DARK-WINE RIGHT facet (its own plane split),
// framing a stone gable face with a round OCULUS window, over a projecting BAY + DOOR.
// Sides stay simple and symmetric — two matching windows per side, NO competing hip
// facets arguing with the middle. STONE walls tie it to the cottage.
// Laws honored: ONE light from LIGHT (upper-left) · outlineFor() outlines (never #000) ·
// recess() depth model for openings · seatShadow() FIRST, <=1 tile · roof overhangs the
// wall + eave-AO whisper on the wall top · base row at the canvas BOTTOM, overflow
// TOP-only · pure fillRect, deterministic (no Math.random / Date / drawImage /
// globalAlpha / arc).
import { makeCanvas, RAMPS, LIGHT, shade, outlineFor, seatShadow, recess, TILE_W } from '../pixel.js';

export const meta = { name: 'Slab + Central Dormer Cottage (PM-QA)', pm: true };

// deterministic position hash -> 0..1 (snow raggedness / mortar ticks). Pure, no rng.
function phash(a, b) {
    let n = ((a * 73856093) ^ (b * 19349663)) >>> 0;
    n ^= n >>> 15; n = (n * 2246822519) >>> 0; n ^= n >>> 13;
    return (n % 1024) / 1024;
}
// FALL variant = ramp-swap toward amber (§6b: ~12-16deg hue travel + value lift). shade(c,1.14)
// gives ~7.7deg of hue rotation plus a half-step value push — readable under the CRT shader,
// where the old 1.05 (~2.75deg) was imperceptible. Cached once per season, not per frame.
const warm = (ramp) => ramp.map((c) => shade(c, 1.14));
// stepped circle rows, mirror-exact about a *.5 center (no arc/AA). fn(x0, y, w).
function circleRows(cx, cy, r, fn) {
    const R = Math.ceil(r);
    for (let dy = -R; dy <= R; dy++) {
        const f = r * r - dy * dy;
        if (f <= 0) continue;
        const half = Math.sqrt(f);
        const x0 = Math.round(cx - half), x1 = Math.round(2 * cx) - x0;
        fn(x0, cy + dy, x1 - x0 + 1);
    }
}

const _cache = {};
export function makeBuilding(season = 'SUMMER') {
    if (_cache[season]) return _cache[season];
    const [c, ctx] = makeCanvas(60, 56);
    const winter = season === 'WINTER', fall = season === 'FALL';
    const R = fall ? warm(RAMPS.ROOF_RED) : RAMPS.ROOF_RED;
    const S = RAMPS.STONE;                                    // stone stays cool year-round
    const Wd = fall ? warm(RAMPS.WOOD) : RAMPS.WOOD;
    const G = RAMPS.GLASS;
    const OLroof = outlineFor(R[1]), OLstone = outlineFor(S[1]), OLwood = outlineFor(Wd[1]);
    const SNOW_DEEP = '#ffffff', SNOW_MID = '#eef4f4', SNOW_THIN = '#dbe8ec';
    const SPEC = RAMPS.GRAIN[5];                              // the 1px glint color (never a fill)
    const litLeft = LIGHT.x < 0;                              // one sun, imported — never hardcoded
    const CX = 29.5, mir = (x) => 59 - x;                     // symmetric sides mirror about CX

    // =================== GROUNDING FIRST: fixed <=1-tile seat shadow ===================
    seatShadow(ctx, { cx: CX, cy: 54, rx: TILE_W / 2, ry: 3 }, { alpha: 0.30 });   // cy=54: the ellipse's two WIDEST rows peek below the base line and seat the building

    // =================== GEOMETRY ===================
    const wx0 = 8, wx1 = 51, wy0 = 27, wy1 = 52;              // front wall: screen-aligned rect; ground AO on 53, seat-shadow spill pools on the last rows
    const SX0 = 5, SX1 = 54;                                  // slab span — 3px overhang per side = round(wallH/10) cap (§6a.6)
    const slabTop = 10, stripBot = 13, bodyTop = 14, bodyBot = 23, eaveA = 24, eaveB = 25, fasciaY = 26;
    const seams = [16, 19, 23];                               // shingle course bottoms — 2/3/4-row courses tightening toward the high ridge (§6a-D.1 foreshortening)
    const seamSet = new Set(seams);
    const courseIdx = (y) => { let n = 0; for (const b of seams) if (b < y) n++; return n; };
    // central dormer chevron: apex overflows the TOP only; band runs down through the eave
    const apexY = 2, dEaveY = 26;
    const outerAt = (y) => Math.round(1 + 7 * ((y - apexY) / (dEaveY - apexY)));   // half-width 1 -> 8 (~3px/side over the 12px bay, §6a.6)
    const BAND = 4;                                           // chevron facet thickness (horizontal px)
    const bx0 = 24, bx1 = 35;                                 // the forward bay under the dormer

    // =================== FRONT WALL (stone; drawn so the slab overhangs it) ===================
    ctx.fillStyle = OLstone; ctx.fillRect(wx0 - 1, wy0, (wx1 - wx0 + 1) + 2, (wy1 - wy0 + 1) + 1);
    ctx.fillStyle = S[2]; ctx.fillRect(wx0, wy0, wx1 - wx0 + 1, wy1 - wy0 + 1);
    // gentle lit-left / shadow-right plane split (§6a.3 ranking: lit wall > shadow wall)
    ctx.fillStyle = S[3]; ctx.fillRect(litLeft ? wx0 : wx1 - 2, wy0, 3, wy1 - wy0 + 1);
    ctx.fillStyle = S[1]; ctx.fillRect(litLeft ? wx1 - 3 : wx0, wy0, 4, wy1 - wy0 + 1);
    ctx.fillStyle = S[0]; ctx.fillRect(litLeft ? wx1 - 1 : wx0, wy0, 2, wy1 - wy0 + 1);   // 2px shadow side reveal — never a receding wall
    // outline is per-ADJACENT-fill: the column beside the LIT S[3] band uses outlineFor(S[3]);
    // the shadow-side column + base row keep the darker OLstone (adjacent fill is S[0]/S[1])
    ctx.fillStyle = outlineFor(S[3]); ctx.fillRect(litLeft ? wx0 - 1 : wx1 + 1, wy0, 1, wy1 - wy0 + 1);
    // mortar courses, half-offset like brickwork (interior seams use the shadow step, not outline)
    for (let ci = 0; ci < 6; ci++) {
        const y = 31 + ci * 4;
        if (y > wy1 - 2) break;
        ctx.fillStyle = shade(S[2], 0.9);
        for (let x = wx0 + 1; x <= wx1 - 2; x++) if (phash(x, y) > 0.42) ctx.fillRect(x, y, 1, 1);
        for (let x = wx0 + 2 + (ci % 2) * 3; x <= wx1 - 2; x += 6) ctx.fillRect(x, y - 2, 1, 2);   // vertical joints, offset per course
    }
    ctx.fillStyle = S[3];                                     // sparse warm-lit stone flecks
    for (let x = wx0 + 2; x <= wx1 - 3; x += 5) if (phash(x, 5) > 0.62) ctx.fillRect(x, 30 + ((x * 7) % 20), 2, 1);
    // foundation course + ground AO (base at the BOTTOM of the canvas)
    ctx.fillStyle = S[1]; ctx.fillRect(wx0, wy1 - 1, wx1 - wx0 + 1, 2);
    ctx.fillStyle = shade(S[2], 1.08); ctx.fillRect(wx0, wy1 - 1, wx1 - wx0 + 1, 1);   // lit top of the plinth
    ctx.fillStyle = OLstone; ctx.fillRect(wx0, wy1 + 1, wx1 - wx0 + 1, 1);
    if (winter) for (let x = wx0; x <= wx1; x++) if (phash(x, 51) > 0.5) { ctx.fillStyle = phash(x, 52) > 0.6 ? SNOW_THIN : SNOW_MID; ctx.fillRect(x, wy1 - 1, 1, 1); }

    // =================== THE FORWARD BAY (projects toward camera; reads via light, not outline) ===================
    ctx.fillStyle = S[2]; ctx.fillRect(bx0, wy0, bx1 - bx0 + 1, wy1 - wy0);
    ctx.fillStyle = S[3]; ctx.fillRect(litLeft ? bx0 : bx1, wy0, 1, wy1 - wy0);        // its own lit edge...
    ctx.fillStyle = S[1]; ctx.fillRect(litLeft ? bx1 : bx0, wy0, 1, wy1 - wy0);        // ...and shadow edge
    ctx.fillStyle = S[1]; ctx.fillRect(bx0, wy1 - 1, bx1 - bx0 + 1, 2);                // bay shares the plinth course
    ctx.fillStyle = shade(S[2], 1.08); ctx.fillRect(bx0, wy1 - 1, bx1 - bx0 + 1, 1);

    // =================== TWO WINDOWS PER SIDE (symmetric; the 2-window grid) ===================
    const drawWindow = (x, y) => {                            // 6x7: wood frame, 2x2 panes, sky glint
        const sz = 6, ht = 7, gx = x + 1, gy = y + 1, gw = 4, gh = 5;
        ctx.fillStyle = OLwood; ctx.fillRect(x - 1, y - 1, sz + 2, ht + 2);
        ctx.fillStyle = Wd[2]; ctx.fillRect(x, y, sz, ht);
        ctx.fillStyle = shade(Wd[3], 1.1); ctx.fillRect(x, y, sz, 1);                  // top-sill highlight (§6a-D.3)
        ctx.fillStyle = winter ? '#b6cdd6' : G[1]; ctx.fillRect(gx, gy, gw, gh);
        ctx.fillStyle = winter ? '#a2bcc6' : G[0]; ctx.fillRect(gx, gy + 3, gw, gh - 3);   // darker lower glass
        ctx.fillStyle = shade(winter ? '#a2bcc6' : G[0], 0.75); ctx.fillRect(gx, gy, gw, 1);   // recess: 1px set-in shadow under the top frame (before the streak)
        ctx.fillStyle = winter ? '#e8f4f8' : G[2];                                     // diagonal reflection streak (BL -> TR)
        ctx.fillRect(gx, gy + 3, 1, 1); ctx.fillRect(gx + 1, gy + 2, 1, 1); ctx.fillRect(gx + 2, gy + 1, 1, 1); ctx.fillRect(gx + 3, gy, 1, 1);
        ctx.fillStyle = Wd[1]; ctx.fillRect(gx + 2, gy, 1, gh); ctx.fillRect(gx, gy + 2, gw, 1);   // mullion cross
        ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(x, y + ht + 1, sz, 1);        // bottom-sill drop shadow (a whisper)
        if (winter) {                                                                  // §6b.5: sills collect snow — 1px SNOW_MID cap on the top frame row, phash-gated per column
            ctx.fillStyle = SNOW_MID;
            for (let sx = x - 1; sx <= x + sz; sx++) if (phash(sx, y) > 0.35) ctx.fillRect(sx, y - 1, 1, 1);
        }
    };
    for (const x of [9, 17]) { drawWindow(x, 34); drawWindow(mir(x) - 5, 34); }        // mirrored pairs about CX
    ctx.fillStyle = 'rgba(0,0,0,0.10)';                                                // bay casts a whisper on the wall away from the light — AFTER the windows so the inner frame can't bury it
    ctx.fillRect(litLeft ? bx1 + 1 : bx0 - 2, wy0 + 1, 2, wy1 - wy0 - 1);

    // =================== ROOF: the HORIZONTAL SLAB ===================
    // bright sky-facing top strip (the single brightest surface), corners lightly beveled
    for (let y = slabTop; y <= stripBot; y++) {
        const bev = y === slabTop ? 2 : y === slabTop + 1 ? 1 : 0;
        ctx.fillStyle = shade(R[4], 1.05);
        ctx.fillRect(SX0 + bev, y, (SX1 - SX0 + 1) - bev * 2, 1);
        // §6a.2 plane split: the strip field beyond the chevron AWAY from the light drops to
        // shade(R[4],0.96) — the dormer divides a lit field from a shadow field (cottage read)
        ctx.fillStyle = shade(R[4], 0.96);
        if (litLeft) ctx.fillRect(30 + outerAt(y) + 1, y, Math.max(0, (SX1 - bev) - (30 + outerAt(y))), 1);
        else ctx.fillRect(SX0 + bev, y, Math.max(0, (29 - outerAt(y)) - (SX0 + bev)), 1);
    }
    ctx.fillStyle = R[3]; ctx.fillRect(SX0 + 2, slabTop - 1, (SX1 - SX0 + 1) - 4, 1);   // silhouette cap — R[3] per-ADJACENT-fill beside the brightest strip (sky-facing edges may stay open, §3.1)
    ctx.fillStyle = R[4]; ctx.fillRect(SX0, bodyTop, SX1 - SX0 + 1, 1);                    // crease: strip -> pitched body
    // mid body: shingle courses, half-offset seams, lit tops + shadow bottoms (§6a-D.1).
    // §6a.2 + §6a-D.1 plane split: the slab is TWO light fields divided by the chevron —
    // the field toward the light keeps the bright base, the field away drops one ramp step
    // (R[3]->R[2], shade(R[3],0.92)->R[2], R[2]->shade(R[2],0.90)); the per-course
    // lit-top/shadow-bottom logic is IDENTICAL on both fields, so it reads dimmer over there.
    for (let y = bodyTop + 1; y <= bodyBot; y++) {
        const f = (y - bodyTop) / (bodyBot - bodyTop);
        const litBase = f < 0.34 ? R[3] : f < 0.67 ? shade(R[3], 0.92) : R[2];
        const shBase = f < 0.67 ? R[2] : shade(R[2], 0.90);
        const isBot = seamSet.has(y), isLitTop = seamSet.has(y - 1), ci = courseIdx(y);
        const xL = 29 - outerAt(y), xR = 30 + outerAt(y);
        for (let x = SX0; x <= SX1; x++) {
            const base = (litLeft ? x > xR : x < xL) ? shBase : litBase;
            let col = base;
            const ph = (x + (ci % 2) * 3) % 6;
            if (!isBot && ph === 0) col = shade(base, 0.95);       // vertical shingle seam, brickwork offset
            if (!isBot && ph === 1) col = shade(base, 1.05);       // lit LEFT edge right of each seam — completes the raised-tile highlight/shadow pair (§6a-D.1)
            if (isBot) col = shade(base, 0.88); else if (isLitTop) col = shade(base, 1.05);
            ctx.fillStyle = col; ctx.fillRect(x, y, 1, 1);
        }
    }
    // DARK overhanging eave band + fascia underside (the slab's visible thickness)
    ctx.fillStyle = R[1]; ctx.fillRect(SX0, eaveA, SX1 - SX0 + 1, 1);
    ctx.fillStyle = R[0];                                          // the eave carries the plane split too — shadow field drops to R[0]
    if (litLeft) ctx.fillRect(30 + outerAt(eaveA) + 1, eaveA, Math.max(0, SX1 - (30 + outerAt(eaveA))), 1);
    else ctx.fillRect(SX0, eaveA, Math.max(0, (29 - outerAt(eaveA)) - SX0), 1);
    ctx.fillStyle = shade(R[1], 0.9); ctx.fillRect(SX0, eaveB, SX1 - SX0 + 1, 1);
    ctx.fillStyle = R[0]; ctx.fillRect(SX0, fasciaY, SX1 - SX0 + 1, 1);
    // slab side outlines — per-ADJACENT-fill like the wall: rows beside the R[3]/R[2] body
    // take outlineFor(R[3]); only the eave/fascia rows 24-26 keep the darker OLroof.
    // Start one row below the bevel so no pixel floats (P5); bevel corners stay open (§3.1)
    ctx.fillStyle = outlineFor(R[3]);
    ctx.fillRect(SX0 - 1, slabTop + 2, 1, eaveA - slabTop - 2); ctx.fillRect(SX1 + 1, slabTop + 2, 1, eaveA - slabTop - 2);
    ctx.fillStyle = OLroof;
    ctx.fillRect(SX0 - 1, eaveA, 1, fasciaY - eaveA + 1); ctx.fillRect(SX1 + 1, eaveA, 1, fasciaY - eaveA + 1);
    ctx.fillRect(SX0, wy0, wx0 - SX0, 1); ctx.fillRect(wx1 + 1, wy0, SX1 - wx1, 1);   // overhang underside seen past the wall
    ctx.fillStyle = 'rgba(0,0,0,0.08)'; ctx.fillRect(wx0, wy0, wx1 - wx0 + 1, 2);      // eave-AO whisper on the wall top (§6a-D.2)

    // =================== THE APEX: central forward gable (chevron + stone face) ===================
    for (let y = apexY; y <= dEaveY; y++) {
        const outer = outerAt(y), inner = Math.max(0, outer - BAND);
        const xL = 29 - outer, xR = 30 + outer;
        const tf = (y - apexY) / (dEaveY - apexY);
        // gable FACE between the facets (in FRONT of the slab): quiet stone, lit-left
        if (inner >= 1) {
            ctx.fillStyle = S[2]; ctx.fillRect(29 - inner + 1, y, inner * 2, 1);
            ctx.fillStyle = S[3]; ctx.fillRect(litLeft ? 29 - inner + 1 : 30 + inner - 1, y, 1, 1);
            ctx.fillStyle = S[1]; ctx.fillRect(litLeft ? 30 + inner - 1 : 29 - inner + 1, y, 1, 1);
        }
        // LIT facet toward the sun, DARK-WINE facet away — the gable's own plane split
        // §6a.3: the sky-facing slab strip is THE brightest — the lit facet's top band shares
        // its shade(R[4],1.05), never exceeds it (only the 1px apex glint is the spec exception)
        const litC = tf < 0.45 ? shade(R[4], 1.05) : tf < 0.78 ? R[4] : R[3];
        const dkC = tf < 0.5 ? R[1] : R[0];
        ctx.fillStyle = litLeft ? litC : dkC; ctx.fillRect(xL, y, (29 - inner) - xL + 1, 1);
        ctx.fillStyle = litLeft ? dkC : litC; ctx.fillRect(30 + inner, y, xR - (30 + inner) + 1, 1);
        ctx.fillStyle = R[4]; ctx.fillRect(litLeft ? xL : xR, y, 1, 1);                // lit outer rake edge on the sun-side facet (plain R[4], stays under the strip)
        ctx.fillStyle = OLroof; ctx.fillRect(xL - 1, y, 1, 1); ctx.fillRect(xR + 1, y, 1, 1);   // rake outlines
        if (winter) {                                                                  // snow loads the LIT facet (solid, ragged melt line); the dark one carries only a thin dusting
            const reach = 0.62 + phash(y, 9) * 0.2;
            if (tf < reach) {
                ctx.fillStyle = tf < 0.35 ? SNOW_DEEP : tf < 0.65 ? SNOW_MID : SNOW_THIN;
                const sx = litLeft ? xL : 30 + inner, sw = (29 - inner) - xL + 1;
                ctx.fillRect(sx, y, sw, 1);
            }
            if (tf < 0.30 + phash(y, 11) * 0.15) {                                     // §6b.4: the plane split reads THROUGH the snow — SNOW_THIN only, shorter reach, dark facet
                ctx.fillStyle = SNOW_THIN;
                const dx0 = litLeft ? 30 + inner : xL, dw = (29 - inner) - xL + 1;
                ctx.fillRect(dx0, y, dw, 1);
            }
        }
    }
    ctx.fillStyle = OLroof; ctx.fillRect(28, apexY - 1, 4, 1);                         // apex cap — dark silhouette, never a bright point
    ctx.fillStyle = shade(R[4], 1.1); ctx.fillRect(litLeft ? 29 : 30, apexY, 1, 1);    // 1px apex crease glint on the lit side
    // dormer drop shadow onto the bay (the band's bottom row already lands on the R[0] fascia)
    ctx.fillStyle = 'rgba(0,0,0,0.10)'; ctx.fillRect(bx0, wy0, bx1 - bx0 + 1, 2);

    // =================== OCULUS — the round window in the gable face ===================
    // APEX INTEGRITY: surround r=3.0 @ cy=22 sits inside the gable face; every ring row is
    // also CLAMPED to the face span at that y, so it can never notch the chevron rake lines.
    // cy=22 (not 21) so the face is wide enough (inner>=3) on all glass rows 21-23 and the
    // S[1] ring closes around the glass — including the upper shoulders.
    const faceSpan = (y) => { const inn = Math.max(0, outerAt(y) - BAND); return [29 - inn + 1, 30 + inn - 1]; };
    circleRows(CX, 22, 3.0, (x, y, w) => {                                               // stone surround ring
        const [f0, f1] = faceSpan(y);
        const x0 = Math.max(x, f0), x1 = Math.min(x + w - 1, f1);
        if (x1 < x0) return;
        ctx.fillStyle = S[1]; ctx.fillRect(x0, y, x1 - x0 + 1, 1);
    });
    circleRows(CX, 22, 2.0, (x, y, w) => {                                               // glass disc (rows 21-23, x28-31)
        ctx.fillStyle = winter ? '#a2bcc6' : G[0]; ctx.fillRect(x, y, w, 1);
    });
    circleRows(litLeft ? 29 : 30, 21, 1.2, (x, y, w) => {                                // lit glass biased toward LIGHT (up-left), clipped to the glass disc
        if (y < 21 || y > 23) return;
        const x0 = Math.max(x, 28), x1 = Math.min(x + w - 1, 31);
        if (x1 < x0) return;
        ctx.fillStyle = winter ? '#b6cdd6' : G[1]; ctx.fillRect(x0, y, x1 - x0 + 1, 1);
    });
    ctx.fillStyle = shade(winter ? '#a2bcc6' : G[0], 0.75); ctx.fillRect(28, 21, 4, 1);  // recess: 1px set-in shadow at the glass top row
    ctx.fillStyle = winter ? '#e8f4f8' : G[2]; ctx.fillRect(litLeft ? 28 : 31, 20, 1, 1);       // single sky glint on the lit ring shoulder
    ctx.fillStyle = shade(S[2], 1.1); ctx.fillRect(litLeft ? 28 : 30, 19, 2, 1);                // lit top of the surround (light side)
    ctx.fillStyle = 'rgba(0,0,0,0.10)'; ctx.fillRect(27, 26, 6, 1);                              // ring base whisper (inner=4 at row 26 — inside the face)

    // =================== DOOR (in the bay, under the oculus) ===================
    {
        const dx = 26, dy = 39, dw = 8, dh = 13;
        recess(ctx, dx, dy, dw, dh, Wd[1], OLwood);                                    // the shared depth model: rim, dark inner, lit lip, base AO
        ctx.fillStyle = Wd[2]; ctx.fillRect(dx + 1, dy + 1, dw - 2, dh - 2);           // plank leaf
        ctx.fillStyle = Wd[1]; ctx.fillRect(dx + 3, dy + 1, 1, dh - 2); ctx.fillRect(dx + 5, dy + 1, 1, dh - 2);   // plank seams
        ctx.fillStyle = shade(Wd[3], 1.08); ctx.fillRect(dx + 1, dy + 1, dw - 2, 1);   // lit top jamb
        ctx.fillStyle = S[1]; ctx.fillRect(dx, dy, 1, 1); ctx.fillRect(dx + dw - 1, dy, 1, 1);   // shouldered arch corners
        ctx.fillStyle = SPEC; ctx.fillRect(litLeft ? dx + dw - 3 : dx + 2, dy + 7, 1, 1);        // handle glint (1px specular)
        ctx.fillStyle = shade(S[3], 1.05); ctx.fillRect(dx - 1, wy1, dw + 2, 1);       // stone step
        ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(dx - 1, wy1 + 1, dw + 2, 1);  // threshold drop shadow
        if (winter) {                                                                  // §6b.5: the lintel collects snow too — 1px SNOW_MID cap, phash-gated per column
            ctx.fillStyle = SNOW_MID;
            for (let sx = dx - 1; sx <= dx + dw; sx++) if (phash(sx, dy) > 0.35) ctx.fillRect(sx, dy - 1, 1, 1);
        }
    }

    // =================== WINTER: snow slab riding ON the roof (tiles read through) ===================
    if (winter) {
        for (let y = slabTop; y <= bodyTop + 3; y++) {
            const bev = y === slabTop ? 2 : y === slabTop + 1 ? 1 : 0;
            for (let x = SX0 + bev; x <= SX1 - bev; x++) {
                const reach = 0.68 + phash(x >> 1, 3) * 0.3;                            // ragged melt line
                const f = (y - slabTop) / (bodyTop + 3 - slabTop);
                if (f > reach) continue;
                if (Math.abs(x - 29.5) < outerAt(y) + 2 && y >= apexY) continue;        // chevron owns its own snow
                ctx.fillStyle = y <= stripBot ? SNOW_DEEP : y === bodyTop ? SNOW_MID : SNOW_THIN;
                ctx.fillRect(x, y, 1, 1);
            }
        }
        for (const b of seams) {                                                        // course shadows read through partial snow
            ctx.fillStyle = 'rgba(0,0,0,0.07)';
            for (let x = SX0; x <= SX1; x += 2) if (phash(x, b) > 0.55) ctx.fillRect(x, b, 1, 1);
        }
        // §6b.5: the overhang lip collects a broken 1px dusting along the eave row —
        // phash-gated per column, skipping the chevron span (it owns its own snow)
        for (let x = SX0; x <= SX1; x++) {
            if (Math.abs(x - 29.5) < outerAt(eaveA) + 2) continue;
            if (phash(x, 24) > 0.45) {
                ctx.fillStyle = phash(x, 25) > 0.7 ? SNOW_THIN : SNOW_MID;
                ctx.fillRect(x, eaveA, 1, 1);
            }
        }
        // §6b.3: a few hash-chosen +1px mounds humping over the silhouette cap row 9
        for (let x = SX0 + 4; x <= SX1 - 4; x += 9) {
            if (Math.abs(x - 29.5) < outerAt(slabTop) + 3) continue;
            if (phash(x, 6) > 0.35) {
                ctx.fillStyle = SNOW_DEEP; ctx.fillRect(x, slabTop - 1, 3, 1);
                ctx.fillStyle = SNOW_MID; ctx.fillRect(x + 1, slabTop - 2, 1, 1);
            }
        }
    }

    _cache[season] = c;
    return c;
}
