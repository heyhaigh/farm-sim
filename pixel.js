// pixel.js — procedural pixel-art: farmer sprites, crops, props, tiles,
// and a tiny bitmap font. Everything is drawn into offscreen canvases once
// and blitted, so the sim stays cheap.

export const TILE_W = 20;
export const TILE_H = 10;

export function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    return [c, ctx];
}

// ---------------------------------------------------------------------------
// Tiny 3x5 bitmap font
// ---------------------------------------------------------------------------

const FONT = {
    'A': '010101111101101', 'B': '110101110101110', 'C': '011100100100011',
    'D': '110101101101110', 'E': '111100110100111', 'F': '111100110100100',
    'G': '011100101101011', 'H': '101101111101101', 'I': '111010010010111',
    'J': '001001001101010', 'K': '101110100110101', 'L': '100100100100111',
    'M': '101111111101101', 'N': '101111111111101', 'O': '010101101101010',
    'P': '110101110100100', 'Q': '010101101011001', 'R': '110101110110101',
    'S': '011100010001110', 'T': '111010010010010', 'U': '101101101101011',
    'V': '101101101010010', 'W': '101101111111101', 'X': '101010010010101',
    'Y': '101101010010010', 'Z': '111001010100111',
    '0': '010101101101010', '1': '010110010010111', '2': '110001010100111',
    '3': '110001010001110', '4': '101101111001001', '5': '111100110001110',
    '6': '011100110101010', '7': '111001010010010', '8': '010101010101010',
    '9': '010101011001110',
    ' ': '000000000000000', '.': '000000000000010', ',': '000000000010100',
    ':': '000010000010000', '!': '010010010000010', '?': '110001010000010',
    '+': '000010111010000', '-': '000000111000000', '/': '001001010100100',
    "'": '010010000000000', '(': '001010010010001', ')': '100010010010100',
    '%': '101001010100101', '=': '000111000111000', '"': '101101000000000',
    '<': '001010100010001', '>': '100010001010100', '*': '101010111010101',
    '_': '000000000000111', '&': '010101010101011', '#': '101111101111101',
    '^': '010101000000000', '~': '000011110000000',
    '[': '110100100100110', ']': '011001001001011',   // the raid marquee's [W] hint rendered as ?W? without these
};

export function drawText(ctx, str, x, y, color, scale = 1) {
    ctx.fillStyle = color;
    // snap to integer source pixels so glyphs never land on a half-pixel (which the browser would
    // anti-alias into a blur — the cause of the shimmer when a panel is scrolled by a fractional amount)
    let cx = Math.round(x); const yy = Math.round(y);
    // fold typographic characters the 3x5 font lacks onto plain equivalents (em/en-dash -> hyphen,
    // curly quotes -> straight, ellipsis -> "...") so a stray "—" never shows up as a "?" over a head
    const norm = String(str).toUpperCase().replace(/[—–]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...');
    for (const raw of norm) {
        const glyph = FONT[raw] || FONT['?'];
        for (let i = 0; i < 15; i++) {
            if (glyph[i] === '1') {
                ctx.fillRect(cx + (i % 3) * scale, yy + Math.floor(i / 3) * scale, scale, scale);
            }
        }
        cx += 4 * scale;
    }
    return cx - Math.round(x);
}

export function textWidth(str, scale = 1) {
    return String(str).length * 4 * scale - scale;
}

// ---------------------------------------------------------------------------
// Sprite-from-string-map helper
// ---------------------------------------------------------------------------

function spriteFromMap(rows, colorKey) {
    const h = rows.length, w = rows[0].length;
    const [c, ctx] = makeCanvas(w, h);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const ch = rows[y][x];
            if (ch === '.' || ch === ' ') continue;
            const col = colorKey[ch];
            if (!col) continue;
            ctx.fillStyle = col;
            ctx.fillRect(x, y, 1, 1);
        }
    }
    return c;
}

// ---------------------------------------------------------------------------
// Farmer sprites — 16x20 characters composed procedurally, GBC full color.
// Each Ry's head shape, hairstyle, eye style and build are seeded from their
// memory so the town reads as a crowd of individuals (à la the Pokémon
// head+eye-shape variety breakdown).
// ---------------------------------------------------------------------------

export const FARM_SPRITE_W = 16;
export const FARM_SPRITE_H = 20;
const OUTLINE = '#1c2028';

// --- colour helpers (pure) for the hue-shifting shade() -------------------
function _hexToRgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function _rgbToHex(r, g, b) {
    r = Math.max(0, Math.min(255, Math.round(r)));
    g = Math.max(0, Math.min(255, Math.round(g)));
    b = Math.max(0, Math.min(255, Math.round(b)));
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}
function _rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0, s = 0; const l = (max + min) / 2;
    if (d > 0) {
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h *= 60;
    }
    return [h, s, l];
}
function _hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else { r = c; b = x; }
    return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}
// rotate hue `h` toward `target` along the shortest arc, by at most `deg` degrees
function _hueToward(h, target, deg) {
    const diff = ((target - h + 540) % 360) - 180;
    return h + Math.max(-deg, Math.min(deg, diff));
}

// Hue-shifting shade (PROCEDURAL_ART.md §1a). Value still tracks the old RGB-multiply
// so existing builders keep their brightness; on top of that, darkening (f<1) rotates
// hue toward a cool blue shadow anchor and DESATURATES, lightening (f>1) rotates toward
// a warm anchor and SATURATES — the era's hue-shift, not a flat darken. Pure/deterministic.
// For surfaces with 3+ steps prefer the authored RAMPS table over stacking shade() calls.
export function shade(hex, f) {
    let [r, g, b] = _hexToRgb(hex);
    r = Math.min(255, r * f); g = Math.min(255, g * f); b = Math.min(255, b * f);   // preserve prior value
    let [h, s, l] = _rgbToHsl(r, g, b);
    const mag = Math.min(0.3, Math.abs(1 - f));
    if (f < 1) { h = _hueToward(h, 250, mag * 70); s = Math.max(0, s * (1 - mag * 0.5)); }        // shadow: cooler + less sat
    else if (f > 1) { h = _hueToward(h, 48, mag * 55); s = Math.min(1, s * (1 + mag * 0.5)); }     // light: warmer + more sat
    [r, g, b] = _hslToRgb(h, s, l);
    return _rgbToHex(r, g, b);
}

// Authored sub-palettes (PROCEDURAL_ART.md §1) — the era way: index into hand-tuned,
// hue-shifted ramps rather than runtime-darkening. Each array is ordered SHADOW -> LIGHT.
export const RAMPS = {
    OUTLINE:  { warm: '#211a1c', green: '#193926', brown: '#3a2818' },
    WOOD:     ['#3a2a1c', '#5a4028', '#7a5433', '#946c46', '#b2854c'],
    PLANK:    ['#59332a', '#82503f', '#ab7757', '#c9a24a'],
    ROOF_RED: ['#3f1428', '#6d1924', '#8a2a2a', '#9e3931', '#bb4f3c'],
    STONE:    ['#3f4249', '#4f525d', '#565a65', '#6c7a86', '#8b97a2'],
    MOSS_STONE: ['#463f39', '#5e564a', '#7a7060', '#988c78', '#b8ab92'],   // WARM weathered/lichened rock (mythic relics — not cold steel-gray)
    FOLIAGE:  ['#193926', '#2d603d', '#357137', '#4d843b', '#68963d', '#87ab3e', '#97ba3a'],
    SKIN:     ['#a46f59', '#be865f', '#e1b26e', '#f6ca74'],
    GRAIN:    ['#9a5d48', '#c48355', '#dc9a5c', '#eeb05e', '#f9cb69', '#ffe694'],
    WATER:    ['#1e3550', '#2c4a6a', '#3c6a8e', '#5a94b4'],
    WATER_SPEC: '#bfe4f0',
    GLASS:    ['#63609f', '#7b85c3', '#a8b8e0'],
};

// Baked translucent ground shadow: a 2:1 ellipse of stepped rows (no arc/AA), drawn
// under a building so it doesn't float (PROCEDURAL_ART.md §4.4). Two layers — a soft
// outer halo + a denser core — so the far edge feathers instead of hard-cutting. Pure.
function groundShadow(ctx, cx, cy, rx, ry, alpha = 0.3) {
    const ell = (RX, RY, a) => {
        ctx.fillStyle = `rgba(12,16,12,${a})`;
        for (let dy = -RY; dy <= RY; dy++) {
            const t = dy / RY;
            const half = Math.round(RX * Math.sqrt(Math.max(0, 1 - t * t)));
            if (half < 1) continue;
            ctx.fillRect(Math.round(cx - half), Math.round(cy + dy), half * 2, 1);
        }
    };
    ell(rx + 3, ry + 1, alpha * 0.45);   // soft outer halo
    ell(rx, ry, alpha);                  // denser core
}

// A recessed opening (door / window / nest): a rim, a dark interior, a faint lit top
// lip + a deeper base AO so the eye reads real DEPTH behind the hole. (§1b, §4.2)
export function recess(ctx, x, y, w, h, inner, rim) {
    ctx.fillStyle = rim;   ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = inner; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = shade(inner, 1.7);  ctx.fillRect(x + 1, y, w - 1, 1);     // lit inner top lip
    ctx.fillStyle = shade(inner, 0.66); ctx.fillRect(x, y + h - 1, w, 1);     // inner base AO (kept above the outline floor)
}

// ===========================================================================
// STRATEGY HELPERS  (PROCEDURAL_ART.md §S — the SLYNYRD top-down strategy).
// Shared, deterministic, fillRect-only primitives so EVERY builder can inherit the
// north-star discipline: one committed light, sphere-mask volume, the cluster-unit
// organic primitive, the darker-adjacent OUTLINE LAW, the fixed SEAT-SHADOW LAW, and
// the three derivation MOVES (shave / reflect / rampSwap). These are ADDITIVE — no
// existing builder is refactored to use them yet (that lands next, starting with the
// coop). Purity contract: no Math.random / Date.now / drawImage / globalAlpha.
// ===========================================================================

// §S.1.4 — ONE committed light vector for the whole town: UPPER-LEFT. Every shading
// and shadow helper CONSUMES this so no builder hardcodes its own sun (ties §4 / §0.1
// pt.7). Screen space is +x RIGHT, +y DOWN, and (x,y) points TOWARD the light source:
// upper-left => (-1,-1). Shadows / dark crescents fall on the opposite (away) quadrant.
// NOTE: SLYNYRD's tree example happened to light from the upper-RIGHT; we standardize
// on upper-LEFT to agree with the rest of our canon, and drive it from THIS constant so
// nothing is hardcoded either way.
export const LIGHT = Object.freeze({
    x: -1, y: -1,        // unit-ish direction TOWARD the sun (screen space)
    label: 'upper-left',
    awayX: 1, awayY: 1,  // opposite quadrant — where seat shadows + dark crescents fall
});

// inscribed-ellipse view of a region: accepts {cx,cy,rx,ry} or a box {x,y,w,h}.
function _asEllipse(region) {
    if (region.rx != null && region.ry != null)
        return { cx: region.cx, cy: region.cy, rx: region.rx, ry: region.ry };
    const w = region.w, h = region.h;
    return { cx: region.x + w / 2, cy: region.y + h / 2, rx: w / 2, ry: h / 2 };
}

// stepped 2:1-safe ellipse, row by row (no arc/AA, §3.5). fn(xLeft, y, width).
function _ellipseRows(cx, cy, rx, ry, fn) {
    const RY = Math.round(ry);
    for (let dy = -RY; dy <= RY; dy++) {
        const t = ry ? dy / ry : 0, f = 1 - t * t;
        if (f <= 0) continue;
        const half = Math.round(rx * Math.sqrt(f));
        if (half < 1) continue;
        fn(Math.round(cx - half), Math.round(cy + dy), half * 2);
    }
}

// §S.1.4 SPHERE-MASK — the reusable "shade a circle like a sphere" volume shader
// (SLYNYRD's trees + our canopyBlob, generalized). Paints an ellipse `region` with a
// MID body, a LIGHT patch (ramp +lift) on the light-facing quadrant, and a DARK crescent
// (ramp −deepen) on the away/underside quadrant — the tone chosen per pixel by the sphere
// normal's dot with LIGHT. Stepped, fillRect-only, pure. For canopies, bushes, rounded
// roofs, animal barrels. `ramp` = a shadow→light RAMPS array; opts {mid,lift,deepen,band}.
function sphereMask(ctx, region, ramp, opts = {}) {
    const { cx, cy, rx, ry } = _asEllipse(region);
    const mid = opts.mid != null ? opts.mid : (ramp.length >> 1);
    const at = (i) => ramp[Math.max(0, Math.min(ramp.length - 1, i))];
    const baseC = at(mid), litC = at(mid + (opts.lift ?? 1)), darkC = at(mid - (opts.deepen ?? 1));
    const band = opts.band ?? 0.45;                        // dot threshold for the two shifts
    const Lx = LIGHT.x, Ly = LIGHT.y, Ln = Math.hypot(Lx, Ly) || 1;
    const RY = Math.round(ry);
    for (let dy = -RY; dy <= RY; dy++) {
        const ty = ry ? dy / ry : 0, f = 1 - ty * ty;
        if (f <= 0) continue;
        const half = Math.round(rx * Math.sqrt(f));
        for (let dx = -half; dx <= half; dx++) {
            const nx = rx ? dx / rx : 0, ny = ry ? dy / ry : 0;   // outward sphere normal
            const dot = (nx * Lx + ny * Ly) / Ln;                 // >0 faces the light
            ctx.fillStyle = dot > band ? litC : dot < -band ? darkC : baseC;
            ctx.fillRect(Math.round(cx + dx), Math.round(cy + dy), 1, 1);
        }
    }
}
export { sphereMask };

// §S.1.2 STAMP-CLUSTER — the reusable ORGANIC unit (SLYNYRD's "bundle o' leaves"): one
// small geometric leaf-bundle in ≤4–5 ramp colors, dark/mid/light via ramp-shift, lit
// per LIGHT. Trees, hedges, crops, forage = a DETERMINISTIC scatter of these stamps
// (dark variants low, light variants high). `seed` drives shape/size jitter (pure hash,
// no rng); `variant` (0 square · 1 trapezoid · 2 round) overrides the seed's pick.
function stampCluster(ctx, x, y, seed, ramp, variant) {
    const s = seed >>> 0;
    const v = ((variant == null ? s : variant) >>> 0) % 3;
    const at = (i) => ramp[Math.max(0, Math.min(ramp.length - 1, i))];
    const mid = ramp.length >> 1;
    const rim = at(mid - 2), dark = at(mid - 1), base = at(mid), light = at(mid + 1);
    const w = 5 + (s % 2), h = 4 + ((s >>> 1) % 2);
    const litCol = LIGHT.x < 0 ? 0 : w - 1;          // lit column (toward light)
    const shCol = LIGHT.awayX > 0 ? w - 1 : 0;       // shadow column (away)
    const litRow = LIGHT.y < 0 ? 0 : h - 1;
    if (v === 2) {                                    // round bundle → little sphere
        sphereMask(ctx, { cx: x + w / 2, cy: y + h / 2, rx: w / 2, ry: h / 2 }, ramp, { mid });
        px(ctx, x, y + h - 1, 1, 1, rim);             // seat the underside
        return;
    }
    if (v === 1) {                                    // trapezoid (wide base, narrow top)
        px(ctx, x + 1, y, w - 2, 1, base);
        px(ctx, x, y + 1, w, h - 1, base);
    } else {                                          // rounded square
        px(ctx, x, y, w, h, base);
        px(ctx, x, y, 1, 1, rim); px(ctx, x + w - 1, y, 1, 1, rim);   // knock top corners (no AA)
    }
    px(ctx, x, y + h - 1, w, 1, dark);                // shadow underside
    px(ctx, x + shCol, y + 1, 1, h - 1, dark);        // shadow side
    px(ctx, x + litCol, y + litRow, 1, 1, light);     // lit corner spec
}
export { stampCluster };

// §S.2 OUTLINE LAW — the selective outline is ONE ramp step below the ADJACENT fill of
// the same material, never #000. If `color` is a member of a RAMPS family array, return
// the next-darker step (index−1, clamped); otherwise darken IN-HUE via shade() (still a
// tinted dark, never black). Pure/deterministic.
export function outlineFor(color) {
    const c = String(color).toLowerCase();
    for (const key in RAMPS) {
        const fam = RAMPS[key];
        if (Array.isArray(fam)) {
            const i = fam.indexOf(c);
            if (i >= 0) return fam[Math.max(0, i - 1)];
        }
    }
    return shade(c, 0.72);   // off-ramp fill → in-hue darken, clamped off pure black
}

// §S.2 SHADOW LAW — the fixed SEAT shadow (supersedes the iso-era height-proportional
// shadow). A seat shadow SEATS an object; it does not redraw it. Therefore: length
// NEVER exceeds one tile, size is UNIFORM regardless of the object's height, it is
// CENTERED under the object, and it is ONE flat translucent tone (stepped rows, no arc).
// `region` = {cx,cy[,rx,ry]} or a box {x,y,w,h}; rx/ry are clamped to the 1-tile ceiling.
function seatShadow(ctx, region, opts = {}) {
    const r = _asEllipse(region);
    const rx = Math.min(r.rx != null ? r.rx : TILE_W / 2, TILE_W / 2);   // ≤ 1 tile in length
    const ry = Math.min(r.ry != null ? r.ry : TILE_H / 2, TILE_H / 2);
    const a = opts.alpha ?? 0.28;
    ctx.fillStyle = `rgba(12,16,12,${a})`;
    _ellipseRows(r.cx, r.cy, rx, ry, (x, y, w) => ctx.fillRect(x, y, w, 1));
}
export { seatShadow };

// §S.2 DERIVATION MOVE 1 — SHAVE: erase a rectangular portion of an already-drawn base to
// derive an edge / corner / damage variant (SLYNYRD builds tile side + corner variants by
// "shaving off portions of the base texture"). fillRect-family (clearRect), pure.
export function shave(ctx, x, y, w, h) { ctx.clearRect(x, y, w, h); }

// §S.2 DERIVATION MOVE 2 — REFLECT: mirror a draw routine horizontally about `axisX`
// WITHOUT drawImage (banned) by wrapping ctx so fillRect/clearRect x-coords flip. Optional
// `recolor(color)→color` remaps fills (e.g. an opposite-lit side, or a rampSwap map). The
// era way to get an opposite wall / branch / walk-frame from ONE authored source. Because
// our builders are fillRect-only, the proxy only needs fillStyle + fillRect + clearRect.
export function reflect(ctx, axisX, drawFn, recolor) {
    let _fs = null;
    const proxy = {
        set fillStyle(v) { _fs = recolor ? recolor(v) : v; ctx.fillStyle = _fs; },
        get fillStyle() { return _fs; },
        fillRect(x, y, w, h) { ctx.fillRect(Math.round(2 * axisX - x - w), y, w, h); },
        clearRect(x, y, w, h) { ctx.clearRect(Math.round(2 * axisX - x - w), y, w, h); },
    };
    drawFn(proxy);
    return proxy;
}

// §S.2 DERIVATION MOVE 3 — RAMPSWAP: same geometry, DIFFERENT ramp row. Returns a
// recolor(color) mapping any member of `fromRamp` to the SAME index of `toRamp`
// (index-preserving), passing non-members through unchanged. The basis for SEASON and
// CULTURE (orc) variants: redraw the same builder through a swapped ramp — no new
// geometry. Compose with reflect(...,recolor) or apply standalone. Pure/deterministic.
export function rampSwap(fromRamp, toRamp) {
    const from = fromRamp.map((c) => String(c).toLowerCase());
    return (color) => {
        const i = from.indexOf(String(color).toLowerCase());
        return i >= 0 ? toRamp[Math.min(i, toRamp.length - 1)] : color;
    };
}

// ===========================================================================
// §S.2b/§6b0 SHARED TOP-DOWN BUILDING HELPERS — the laws, inherited not re-typed.
// Every code-drawn structure should route its roof through these so the lighting
// pass, the proportional-texture rule and the seasonal treatments stay identical
// across the set (and future buildings get them for free). Pure, deterministic,
// fillRect-only. See PROCEDURAL_ART.md §S.2, §S.2b, §S.2d, §6b0.
// ===========================================================================

// deterministic 2-axis hash. HASH THE AXES SEPARATELY — a linear combination like
// (x*3 + y) is CONSTANT along a line of that slope and paints diagonal streaks.
export function hash2d(a, b) {
    let n = ((a * 73856093) ^ (b * 19349663)) >>> 0;
    n ^= n >>> 15; n = (n * 2246822519) >>> 0; n ^= n >>> 13;
    return (n % 1024) / 1024;
}

// §S.2b THE LIGHTING PASS — flat tile work first, then light the WHOLE plane in one
// pass. Returns the lit colour for one roof pixel. Three components:
//   (a) a per-tile DIAGONAL highlight stroke — the biggest source of visual density;
//   (b) a BROAD gradient that ignores tile boundaries;
//   (c) a value lift so the plane reads lit, not merely pale.
// MUST be applied as base+overlay, never as a final overwrite (that flattens the
// plane into a solid block). `across` / `down` are 0..1 across the plane.
export function roofLightPass(col, tcol, rr, across, down, opts = {}) {
    const strokeA = opts.strokeA ?? 1.10, strokeB = opts.strokeB ?? 1.04;
    if ((tcol + rr) % 4 === 1) col = shade(col, strokeA);
    else if ((tcol + rr) % 4 === 2) col = shade(col, strokeB);
    const lift = opts.lift ?? 1.05, fallX = opts.fallX ?? 0.10, fallY = opts.fallY ?? 0.07;
    return shade(col, lift - across * fallX - down * fallY);
}

// §S.2b shingle COURSE shading for one roof pixel: chunky scallop tiles in staggered
// courses — lit lip on the exposed top row, dark overlap beneath, a seam between
// neighbours, knocked corners for a rounded tip, and a sparse weathered tile.
// Returns {col, tcol, rr} so the caller can hand tcol/rr straight to roofLightPass.
export function shingleTile(col, x, row, lit, opts = {}) {
    const CH = opts.courseH ?? 4, TW = opts.tileW ?? 5;
    const ci = Math.floor(row / CH), rr = ((row % CH) + CH) % CH;
    const stag = (ci % 2) * 2;
    const tcol = ((x + stag) % TW + TW) % TW, tid = Math.floor((x + stag) / TW);
    if (rr === CH - 1) col = shade(col, lit ? 0.78 : 0.87);          // overlap shadow
    else if (rr === 0 && lit) col = shade(col, 1.10);                // lit lip
    if (tcol === 0) col = shade(col, 0.90);                          // seam
    if (rr === CH - 1 && (tcol === 0 || tcol === TW - 1)) col = shade(col, 0.84);   // rounded tip
    if (hash2d(tid, ci) > 0.86) col = shade(col, 0.95);              // weathered tile
    return { col, tcol, rr };
}

// §S.2d the ONLY edge that should be irregular: the left/right OVERHANG, scalloped as
// the shingles' own silhouette. Far rake and near eave stay CLEAN. Never subtract
// chunks from a straight edge — at this scale that reads as damage.
const SCALLOP_PROFILE = [1, 0, 0, 1];
export function overhangInset(y) {
    const n = SCALLOP_PROFILE.length;
    return SCALLOP_PROFILE[((y % n) + n) % n];
}

// §6b0 SNOW — bands that FOLLOW THE SHINGLE COURSES. Snow catches on each course's
// exposed lip and slides off the tilted face below, so it stacks as horizontal bands
// with the roof showing through between them; the form stays legible and the read is
// top-down. Coverage thins downslope and by PITCH: flat holds, steep sheds.
// Call per roof column. `tone` = {deep, mid, thin}.
export function snowCourses(ctx, x, top, bot, opts = {}) {
    const tone = opts.tone || { deep: '#ffffff', mid: '#eef4f4', thin: '#dbe8ec' };
    const band = bot - top;
    // ADAPTIVE COURSE HEIGHT. On a SHORT band a 4-row course leaves only ~3 courses, so the
    // taper compresses and the 1px gaps between bands stop reading — the mill's 13-row flat
    // roof came out as a near-solid slab. Finer courses on short roofs keep the alternation
    // legible; tall roofs keep the 4-row course that matches the shingle grid.
    const CH = opts.courseH ?? (band >= 18 ? 4 : 3);
    // a gentle size nudge on top (the adaptive course height now does most of the work)
    const sizeBoost = Math.max(0, (22 - band) * 0.01);
    const frac = (opts.frac ?? 0.6) + sizeBoost;       // flat ~0.86 · lit slope ~0.60 · shadow ~0.50
    // the drift edge must UNDULATE SMOOTHLY — per-column random cuts it into vertical
    // TEETH, which read as icicles and kill the top-down illusion
    const cell = Math.floor(x / 6), tw = (x % 6) / 6;
    const dA = hash2d(cell, 5), dB = hash2d(cell + 1, 5);
    const drift = Math.round((dA + (dB - dA) * tw) * 2) - 1;
    const courses = Math.max(1, Math.ceil(band / CH));
    for (let ci = 0; ci < courses; ci++) {
        const tDown = ci / Math.max(1, courses - 1);
        let cover = Math.round((frac - tDown * 0.75) * CH * 1.4) + drift;
        cover = Math.max(0, Math.min(CH, cover));
        for (let rr = 0; rr < cover; rr++) {
            const y = top + ci * CH + rr;
            if (y > bot) break;
            let col = opts.bright ? tone.mid : tone.thin;
            if (rr === 0) col = tone.deep;                            // exposed lip
            else if (rr === cover - 1) col = shade(col, 0.86);        // slips off the tilted face
            ctx.fillStyle = col; ctx.fillRect(x, y, 1, 1);
        }
        if (cover > 0 && cover < CH) {
            const wy = top + ci * CH + cover;
            if (wy <= bot) { ctx.fillStyle = 'rgba(0,0,0,0.10)'; ctx.fillRect(x, wy, 1, 1); }
        }
    }
}

// §6b0 ICICLES BELONG AT THE EAVE, never the ridge — meltwater runs down and refreezes
// at the edge. At the ridge they destroy the top-down read outright.
export function eaveIcicles(ctx, x, eaveY, tone = { mid: '#eef4f4', thin: '#dbe8ec' }) {
    if (hash2d(x, 31) <= 0.74) return;
    const len = 1 + (hash2d(x, 37) > 0.55 ? 1 : 0) + (hash2d(x, 41) > 0.86 ? 1 : 0);
    for (let k = 1; k <= len; k++) {
        ctx.fillStyle = k === len ? tone.thin : tone.mid;
        ctx.fillRect(x, eaveY + k, 1, 1);
    }
}

// §6b0 FALL — leaves gather in DRIFTS, not as an even sprinkle. Seeds clusters on a
// coarse grid and grows a clump outward from each, denser toward the eave. A ~5% warm
// ramp alone is invisible at this scale; fall needs material ON the roof.
const LEAF_PALETTE = ['#c9782a', '#a8531e', '#d89a34', '#b8641a', '#8f4a1c'];
export function leafDrift(ctx, x0, x1, topAt, botAt, inside, opts = {}) {
    const step = opts.step ?? 3, base = opts.density ?? 0.74;
    for (let gx = x0; gx <= x1; gx += step) {
        if (!inside(gx)) continue;
        const tG = topAt(gx), bG = botAt(gx);
        for (let gy = tG + 1; gy <= bG; gy += step) {
            const down = (gy - tG) / Math.max(1, bG - tG);
            if (hash2d(gx, gy) <= base - down * 0.30) continue;       // they pile at the eave
            const n = 3 + Math.floor(hash2d(gx, gy + 7) * 5);
            for (let k = 0; k < n; k++) {
                const lx = gx + Math.floor(hash2d(gx + k, gy) * 5) - 2;
                const ly = gy + Math.floor(hash2d(gx, gy + k * 3) * 4) - 1;
                if (!inside(lx) || ly < topAt(lx) || ly > botAt(lx)) continue;
                ctx.fillStyle = LEAF_PALETTE[(lx * 2 + ly + k) % LEAF_PALETTE.length];
                ctx.fillRect(lx, ly, 1, 1);
            }
        }
    }
}

// §S.2 PROPORTIONAL TEXTURE — seams/striations/wear must darken or lighten the surface
// RELATIVE to whatever is under them. An absolute tone is calibrated to one lighting
// condition and breaks the moment it crosses a boundary (harsh on a lit wall, invisible
// on a shadowed one). These are the two washes the whole set should use.
export const TEX_DARK = 'rgba(0,0,0,0.15)';
export const TEX_LIGHT = 'rgba(255,238,210,0.07)';

// HAND-LAID ASHLAR tower body — the mill's masonry treatment, generalized to a
// (possibly tapered) tower: running-bond blocks, per-block tone by horizontal
// position + deterministic ±1-step jitter, mortar relief (lit top bevel + base AO),
// moss flecks, a soft right-face form wash + bright sunlit left edge, eave + ground
// AO. Pure/deterministic (seeded scatter, no rng). S = STONE ramp. (§1b Chrono-Trigger)
function ashlarBody(ctx, cx, yTop, yBot, halfTop, halfBot, S, OL) {
    const F = RAMPS.FOLIAGE;
    const halfAt = (y) => halfTop + (halfBot - halfTop) * (y - yTop) / Math.max(1, yBot - yTop);
    const hwT = Math.round(halfTop);
    // outline silhouette (per row, follows the taper) + ridge cap
    ctx.fillStyle = OL;
    for (let y = yTop; y <= yBot; y++) { const hw = Math.round(halfAt(y)); ctx.fillRect(cx - hw - 1, y, (hw + 1) * 2, 1); }
    ctx.fillRect(cx - hwT - 1, yTop - 1, (hwT + 1) * 2, 1);
    // base fill
    ctx.fillStyle = S[2];
    for (let y = yTop; y <= yBot; y++) { const hw = Math.round(halfAt(y)); ctx.fillRect(cx - hw, y, hw * 2, 1); }
    // ashlar blocks, running bond
    const CH = 5, BW = 8;
    for (let ci = 0, y = yTop; y <= yBot; y += CH, ci++) {
        const off = (ci % 2) * (BW >> 1), hw = Math.round(halfAt(y + CH / 2)), L = cx - hw, Rr = cx + hw;
        for (let x = L - off; x < Rr; x += BW) {
            const gx = Math.max(L, x), gxe = Math.min(Rr - 1, x + BW - 1), w2 = gxe - gx + 1;
            if (w2 < 2) continue;
            const lf = hw > 0 ? (gx - L) / (hw * 2) : 0.5;
            let idx = lf < 0.34 ? 3 : lf > 0.66 ? 1 : 2;
            const hsh = ((gx * 73856093) ^ (y * 19349663)) >>> 0, jit = hsh % 5;
            if (jit === 0) idx = Math.min(4, idx + 1); else if (jit === 1) idx = Math.max(0, idx - 1);
            const h2 = Math.min(CH, yBot - y + 1);
            ctx.fillStyle = S[idx]; ctx.fillRect(gx, y, w2, h2);
            ctx.fillStyle = shade(S[idx], 1.14); ctx.fillRect(gx, y, w2, 1);
            ctx.fillStyle = shade(S[idx], 0.78); ctx.fillRect(gx, y + h2 - 1, w2, 1);
            if (hsh % 11 === 0) { ctx.fillStyle = F[3]; ctx.fillRect(gx + 1, y + 1, 2, 1); ctx.fillStyle = F[4]; ctx.fillRect(gx + 1, y + 1, 1, 1); }
        }
    }
    // vertical mortar seams
    ctx.fillStyle = S[0];
    for (let ci = 0, y = yTop; y <= yBot; y += CH, ci++) {
        const off = (ci % 2) * (BW >> 1), hw = Math.round(halfAt(y + CH / 2)), L = cx - hw, Rr = cx + hw;
        for (let x = L - off + BW; x < Rr; x += BW) if (x > L && x < Rr) ctx.fillRect(x - 1, y, 1, Math.min(CH, yBot - y + 1));
    }
    // form: soft right-face shadow wash + bright sunlit left edge
    for (let y = yTop; y <= yBot; y++) {
        const hw = Math.round(halfAt(y));
        ctx.fillStyle = 'rgba(20,26,34,0.22)'; ctx.fillRect(cx + Math.round(hw * 0.34), y, Math.ceil(hw * 0.66), 1);
        ctx.fillStyle = shade(S[4], 1.14); ctx.fillRect(cx - hw, y, 1, 1);
    }
    ctx.fillStyle = shade(S[0], 0.9); ctx.fillRect(cx - hwT, yTop, hwT * 2, 1);                          // eave AO
    const hwB = Math.round(halfBot);
    ctx.fillStyle = shade(OL, 0.9); ctx.fillRect(cx - hwB - 1, yBot + 1, (hwB + 1) * 2, 1);              // ground AO
}

// derive appearance traits deterministically from the seed (unsigned shifts!)
function look(seed) {
    const s = seed >>> 0;
    return {
        head: (s >>> 0) % 3,          // 0 round, 1 oval, 2 wide
        hair: (s >>> 2) % 7,          // 0 short,1 bowl,2 spiky,3 tuft,4 bun,5 long,6 bald
        eyes: (s >>> 5) % 4,          // 0 dots,1 beady,2 happy,3 sleepy
        build: (s >>> 8) % 2,         // 0 slim, 1 stocky
        brow: (s >>> 10) % 2,
    };
}

function px(ctx, x, y, w, h, col) { ctx.fillStyle = col; ctx.fillRect(x, y, w, h); }

function drawHead(ctx, L, C, yOff) {
    // head box per shape
    let x0, x1, y0, y1;
    if (L.head === 0) { x0 = 4; x1 = 11; y0 = 2; y1 = 9; }         // round
    else if (L.head === 1) { x0 = 5; x1 = 10; y0 = 1; y1 = 9; }    // oval (tall)
    else { x0 = 3; x1 = 12; y0 = 3; y1 = 9; }                      // wide
    y0 += yOff; y1 += yOff;
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    px(ctx, x0, y0, w, h, C.skin);
    // rounded corners
    px(ctx, x0, y0, 1, 1, 'rgba(0,0,0,0)'); ctx.clearRect(x0, y0, 1, 1);
    ctx.clearRect(x1, y0, 1, 1); ctx.clearRect(x0, y1, 1, 1); ctx.clearRect(x1, y1, 1, 1);
    // soft cheek shade + chin outline
    px(ctx, x0, y1 - 1, w, 1, shade(C.skin, 0.82));
    px(ctx, x0 + 1, y1 + 1, w - 2, 1, shade(C.skin, 0.7));
    return { x0, x1, y0, y1 };
}

function drawHair(ctx, L, C, hb) {
    const { x0, x1, y0 } = hb;
    const hair = C.hair, hairD = shade(C.hair, 0.7);
    const w = x1 - x0 + 1;
    if (L.hair === 6) return;   // bald
    // base cap over the crown
    px(ctx, x0, y0 - 1, w, 2, hair);
    px(ctx, x0 - 1, y0, 1, 2, hair); px(ctx, x1 + 1, y0, 1, 2, hair);
    px(ctx, x0, y0 - 1, w, 1, shade(hair, 1.15));   // top highlight
    switch (L.hair) {
        case 0: /* short */ px(ctx, x0, y0 + 1, 1, 2, hair); px(ctx, x1, y0 + 1, 1, 2, hair); break;
        case 1: /* bowl */ px(ctx, x0 - 1, y0 + 1, 1, 3, hair); px(ctx, x1 + 1, y0 + 1, 1, 3, hair); px(ctx, x0, y0 + 1, w, 1, hairD); break;
        case 2: /* spiky */ for (let i = 0; i < w; i += 2) px(ctx, x0 + i, y0 - 2, 1, 1, hair); break;
        case 3: /* tuft */ px(ctx, x0 + Math.floor(w / 2) - 1, y0 - 3, 2, 2, hair); break;
        case 4: /* bun */ px(ctx, x0 + Math.floor(w / 2) - 1, y0 - 3, 3, 2, hair); px(ctx, x0 + Math.floor(w / 2), y0 - 3, 1, 1, hairD); break;
        case 5: /* long */ px(ctx, x0 - 1, y0 + 1, 1, 5, hair); px(ctx, x1 + 1, y0 + 1, 1, 5, hair); px(ctx, x0 - 1, y0 + 5, 1, 1, hairD); px(ctx, x1 + 1, y0 + 5, 1, 1, hairD); break;
    }
}

function drawEyes(ctx, L, C, hb, sleeping) {
    const { x0, x1, y0 } = hb;
    const ey = y0 + 3;
    const lx = x0 + 1, rx = x1 - 2;
    if (sleeping || L.eyes === 3) {
        px(ctx, lx, ey + 1, 2, 1, OUTLINE); px(ctx, rx, ey + 1, 2, 1, OUTLINE); return;
    }
    if (L.eyes === 2) { // happy ^ ^
        px(ctx, lx, ey + 1, 1, 1, OUTLINE); px(ctx, lx + 1, ey, 1, 1, OUTLINE);
        px(ctx, rx + 1, ey + 1, 1, 1, OUTLINE); px(ctx, rx, ey, 1, 1, OUTLINE);
        return;
    }
    if (L.eyes === 1) { // beady with white
        px(ctx, lx, ey, 2, 2, '#ffffff'); px(ctx, rx, ey, 2, 2, '#ffffff');
        px(ctx, lx, ey, 1, 2, OUTLINE); px(ctx, rx + 1, ey, 1, 2, OUTLINE);
        return;
    }
    // dots
    px(ctx, lx + 1, ey, 1, 2, OUTLINE); px(ctx, rx, ey, 1, 2, OUTLINE);
    if (L.brow) { px(ctx, lx, ey - 1, 2, 1, shade(C.hair, 0.6)); px(ctx, rx, ey - 1, 2, 1, shade(C.hair, 0.6)); }
}

function drawHat2(ctx, hat, hatColor, hb) {
    const { x0, x1, y0 } = hb; const w = x1 - x0 + 1; const hd = shade(hatColor, 0.75);
    px(ctx, 0, 0, 0, 0, hatColor);
    switch (hat) {
        case 'strawhat': px(ctx, x0 - 2, y0 - 1, w + 4, 1, hatColor); px(ctx, x0, y0 - 3, w, 2, hatColor); px(ctx, x0, y0 - 1, w, 1, hd); break;
        case 'hardhat': px(ctx, x0, y0 - 3, w, 1, hatColor); px(ctx, x0 - 1, y0 - 2, w + 2, 2, hatColor); px(ctx, x0 - 1, y0, w + 2, 1, hd); break;
        case 'cap': px(ctx, x0, y0 - 3, w, 2, hatColor); px(ctx, x1 - 1, y0 - 1, 4, 1, hatColor); px(ctx, x0, y0 - 1, w, 1, hd); break;
        case 'beret': px(ctx, x0, y0 - 3, w - 1, 2, hatColor); px(ctx, x1, y0 - 3, 1, 1, hatColor); break;
        case 'headband': px(ctx, x0 - 1, y0 + 1, w + 2, 1, hatColor); break;
        case 'headset': px(ctx, x0, y0 - 2, w, 1, OUTLINE); px(ctx, x0 - 1, y0 + 1, 1, 3, OUTLINE); px(ctx, x1 + 1, y0 + 1, 1, 3, OUTLINE); px(ctx, x0 - 1, y0 + 4, 2, 1, hatColor); break;
    }
}

function drawBody(ctx, L, C, pose, frame) {
    const shirt = C.shirt, shirtD = shade(C.shirt, 0.78);
    const pants = C.pants, pantsD = shade(C.pants, 0.78);
    const bx0 = L.build ? 4 : 5, bx1 = L.build ? 11 : 10;
    const bw = bx1 - bx0 + 1;
    const ty = 10;
    // torso
    px(ctx, bx0, ty, bw, 5, shirt);
    px(ctx, bx0, ty + 3, bw, 2, shirtD);
    px(ctx, bx0 + Math.floor(bw / 2), ty, 1, 5, shade(shirt, 0.9)); // collar seam
    // arms
    const armUp = pose === 'work';
    px(ctx, bx0 - 1, ty, 1, 4, shirt);
    px(ctx, bx1 + 1, ty, 1, 4, shirt);
    if (armUp) { px(ctx, bx1 + 1, ty - 3, 1, 3, C.skin); px(ctx, bx1 + 1, ty - 4, 1, 1, C.skin); } // raised hand/tool
    else { px(ctx, bx0 - 1, ty + 4, 1, 1, C.skin); px(ctx, bx1 + 1, ty + 4, 1, 1, C.skin); } // hands
    // legs + shoes, animated
    let l1 = 6, r1 = 8;
    if (pose === 'walk1') { l1 = 5; r1 = 9; }
    else if (pose === 'walk2') { l1 = 6; r1 = 8; }
    px(ctx, l1, 15, 2, 3, pants); px(ctx, r1, 15, 2, 3, pants);
    px(ctx, l1, 17, 2, 1, pantsD); px(ctx, r1, 17, 2, 1, pantsD);
    px(ctx, l1, 18, 2, 1, '#3a2e28'); px(ctx, r1, 18, 2, 1, '#3a2e28');   // shoes
}

function composeFarmer(sheet, pose) {
    const [c, ctx] = makeCanvas(FARM_SPRITE_W, FARM_SPRITE_H);
    const C = sheet.colors;
    const L = look(sheet.seed >>> 0);
    const sleeping = pose === 'sleep';

    if (sleeping) {
        // lying down: shift the whole body downward, eyes closed, no hat
        ctx.translate(0, 4);
        drawBody(ctx, L, C, 'idle', 0);
        const hb = drawHead(ctx, L, C, 0);
        drawHair(ctx, L, C, hb);
        drawEyes(ctx, L, C, hb, true);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        return c;
    }

    drawBody(ctx, L, C, pose, 0);
    const hb = drawHead(ctx, L, C, 0);
    drawHair(ctx, L, C, hb);
    drawEyes(ctx, L, C, hb, false);
    drawHat2(ctx, sheet.hat, C.hatColor, hb);
    return c;
}

export function makeFarmerSprites(sheet) {
    return {
        idle: composeFarmer(sheet, 'idle'),
        walk1: composeFarmer(sheet, 'walk1'),
        walk2: composeFarmer(sheet, 'walk2'),
        work: composeFarmer(sheet, 'work'),
        sleep: composeFarmer(sheet, 'sleep'),
    };
}

// ---------------------------------------------------------------------------
// Crops — 12x14 sprites, 4 growth stages + withered, per crop type
// ---------------------------------------------------------------------------

const CROP_STYLES = {
    carrot: { fruit: '#f08030', leaf: '#5aa848', form: 'ground' },
    pepper: { fruit: '#e04838', leaf: '#4a9840', form: 'bush' },
    sunflower: { fruit: '#f8d020', leaf: '#58a050', form: 'tall' },
    pumpkin: { fruit: '#e88820', leaf: '#4a8848', form: 'ground' },
    grapes: { fruit: '#8a5aa8', leaf: '#487840', form: 'bush' },
    wheat: { fruit: '#e8c860', leaf: '#88a850', form: 'tall' },
    beanstalk: { fruit: '#5ac85a', leaf: '#3f8a3f', form: 'tall' },   // a tall green climbing vine of pods
};

const cropCache = {};

export function makeCropSprites(type) {
    if (cropCache[type]) return cropCache[type];
    const style = CROP_STYLES[type] || CROP_STYLES.carrot;
    const sprites = [];

    for (let stage = 0; stage <= 3; stage++) {
        const [c, ctx] = makeCanvas(12, 14);
        drawCropStage(ctx, style, type, stage, false);
        sprites.push(c);
    }
    const [wc, wctx] = makeCanvas(12, 14);
    drawCropStage(wctx, style, type, 3, true); // index 4 = withered
    sprites.push(wc);

    cropCache[type] = sprites;
    return sprites;
}

function drawCropStage(ctx, style, type, stage, withered) {
    const leaf = style.leaf;
    const leafD = shade(leaf, 0.66);
    const leafL = shade(leaf, 1.24);
    const fruit = style.fruit;
    const fruitD = shade(fruit, 0.72);
    const fruitL = shade(fruit, 1.28);
    const stem = '#4a7a38';
    const stemD = '#356028';

    // little soil mound the plant roots into
    const soil = () => {
        px(ctx, 3, 11, 6, 2, '#5a4028');   // mid dirt
        px(ctx, 4, 11, 4, 1, '#6d5034');   // sunlit crest
        px(ctx, 3, 13, 6, 1, '#3a2818');   // 1px dark underside
    };

    // ---- withered: a WILTED plant (drought/neglect) — dried-straw browns + THIS crop's
    // own desaturated leaf/fruit, drooping to the right. Per-type tint, not just darkened. ----
    if (withered) {
        const dry = RAMPS.GRAIN[1], dryD = RAMPS.GRAIN[0], dryL = RAMPS.GRAIN[2];   // dried straw-brown ramp
        const sick = shade(style.leaf, 0.6), sickD = shade(style.leaf, 0.45);       // sickly desaturated green-brown
        const shrivel = shade(style.fruit, 0.55);                                   // shriveled fruit remnant (per-type hue)
        soil();
        // bent stalk arcing right as it collapses
        px(ctx, 5, 4, 2, 3, dry); px(ctx, 6, 6, 2, 3, dryD); px(ctx, 7, 9, 2, 2, dry);
        px(ctx, 5, 4, 1, 3, dryL);         // sunlit left of the stalk
        px(ctx, 5, 3, 1, 1, dryL);         // curled dry tip
        // sagging sickly leaves hanging down
        px(ctx, 2, 6, 3, 1, sick); px(ctx, 2, 7, 2, 2, sickD);
        px(ctx, 8, 8, 2, 1, sick); px(ctx, 9, 9, 1, 2, sickD);
        // a shriveled fruit clinging (fruiting crops only), per-type colour
        if (style.form !== 'tall') { px(ctx, 6, 8, 2, 2, shrivel); px(ctx, 6, 8, 1, 1, shade(shrivel, 1.2)); }
        // fallen dry flecks on the soil
        px(ctx, 3, 10, 1, 1, dryD); px(ctx, 8, 11, 1, 1, dryD);
        return;
    }

    // ---- stage 0: seed mound with a single germinating tip ----
    if (stage === 0) {
        soil();
        px(ctx, 5, 10, 2, 1, stem);        // tiny sprout
        px(ctx, 5, 9, 1, 1, leafL);
        return;
    }

    // ---- stage 1: small sprout, two seed leaves ----
    if (stage === 1) {
        soil();
        px(ctx, 5, 7, 2, 4, stem);         // stem
        px(ctx, 6, 7, 1, 4, stemD);
        px(ctx, 3, 6, 2, 2, leaf);         // left leaf
        px(ctx, 7, 6, 2, 2, leaf);         // right leaf
        px(ctx, 3, 6, 1, 1, leafL);
        px(ctx, 8, 6, 1, 1, leafL);
        px(ctx, 5, 5, 2, 2, leaf);         // crown bud
        return;
    }

    // stages 2 (leafy) and 3 (ripe) diverge per crop type.
    soil();

    switch (type) {
        // ---------------------------------------------------------------
        case 'carrot': { // feathery fronds; ripe = orange shoulders poking up
            if (stage === 2) {
                px(ctx, 5, 4, 2, 7, stem);
                px(ctx, 6, 4, 1, 7, stemD);
                px(ctx, 3, 6, 2, 3, leaf); px(ctx, 7, 6, 2, 3, leaf);
                px(ctx, 4, 3, 1, 4, leafL); px(ctx, 7, 3, 1, 4, leafL);
                px(ctx, 5, 2, 2, 3, leaf);
                px(ctx, 3, 8, 1, 1, leafD); px(ctx, 8, 8, 1, 1, leafD);
            } else {
                // orange root shoulders
                px(ctx, 4, 9, 4, 3, fruit);
                px(ctx, 5, 12, 2, 1, fruit);      // taper into soil
                px(ctx, 4, 9, 4, 1, fruitL);      // top highlight
                px(ctx, 7, 9, 1, 3, fruitD);      // side shade
                px(ctx, 3, 10, 1, 1, fruitD);
                // green frond crown
                px(ctx, 4, 5, 4, 4, leaf);
                px(ctx, 5, 2, 2, 3, leaf);
                px(ctx, 3, 6, 1, 2, leafL); px(ctx, 8, 6, 1, 2, leafL);
                px(ctx, 4, 5, 3, 1, leafL);
                px(ctx, 4, 8, 4, 1, leafD);
            }
            break;
        }
        // ---------------------------------------------------------------
        case 'pepper': { // leafy bush on a stake; ripe = red peppers
            px(ctx, 8, 4, 1, 7, '#9a7a4a');      // support stake
            if (stage === 2) {
                px(ctx, 3, 6, 6, 5, leafD);
                px(ctx, 3, 5, 6, 4, leaf);
                px(ctx, 4, 4, 4, 3, leaf);
                px(ctx, 4, 5, 3, 2, leafL);
                px(ctx, 5, 4, 2, 1, leafL);
            } else {
                px(ctx, 3, 5, 6, 6, leafD);
                px(ctx, 3, 4, 6, 4, leaf);
                px(ctx, 4, 4, 3, 2, leafL);
                // ripe fruit clusters
                px(ctx, 3, 8, 2, 2, fruit); px(ctx, 3, 8, 1, 1, fruitL); px(ctx, 4, 9, 1, 1, fruitD);
                px(ctx, 7, 7, 2, 2, fruit); px(ctx, 7, 7, 1, 1, fruitL); px(ctx, 8, 8, 1, 1, fruitD);
                px(ctx, 5, 10, 2, 2, fruit); px(ctx, 5, 10, 1, 1, fruitL); px(ctx, 6, 11, 1, 1, fruitD);
            }
            break;
        }
        // ---------------------------------------------------------------
        case 'sunflower': { // tall stalk; ripe = big yellow head, brown center
            if (stage === 2) {
                px(ctx, 5, 4, 2, 7, stem);
                px(ctx, 6, 4, 1, 7, stemD);
                px(ctx, 2, 7, 3, 2, leaf); px(ctx, 7, 6, 3, 2, leaf);
                px(ctx, 2, 7, 1, 1, leafL); px(ctx, 9, 6, 1, 1, leafL);
                px(ctx, 4, 3, 4, 2, leafD);          // green bud
                px(ctx, 5, 2, 2, 2, leaf);
            } else {
                px(ctx, 5, 7, 2, 5, stem);           // stalk
                px(ctx, 6, 7, 1, 5, stemD);
                px(ctx, 2, 9, 3, 2, leaf); px(ctx, 7, 9, 3, 2, leaf);
                px(ctx, 2, 9, 1, 1, leafL); px(ctx, 9, 9, 1, 1, leafL);
                // petal ring
                px(ctx, 3, 1, 6, 6, fruit);
                px(ctx, 2, 2, 8, 4, fruit);
                px(ctx, 4, 0, 1, 1, fruitL); px(ctx, 7, 0, 1, 1, fruitL);
                px(ctx, 3, 1, 6, 1, fruitL);         // sunlit top petals
                px(ctx, 2, 5, 8, 1, fruitD);         // shaded bottom petals
                // seed disc
                px(ctx, 4, 3, 4, 3, '#6b4423');
                px(ctx, 4, 3, 3, 1, '#835331');
                px(ctx, 5, 4, 2, 1, '#4a2e17');
            }
            break;
        }
        // ---------------------------------------------------------------
        case 'pumpkin': { // sprawling leaves; ripe = big ribbed orange gourd
            if (stage === 2) {
                px(ctx, 2, 7, 8, 4, leafD);
                px(ctx, 3, 6, 6, 4, leaf);
                px(ctx, 2, 7, 3, 2, leafL);
                px(ctx, 5, 5, 3, 2, leaf);
                px(ctx, 5, 5, 1, 1, leafL);
                px(ctx, 2, 10, 8, 1, leafD);
            } else {
                px(ctx, 8, 5, 3, 2, leaf);           // leaf peeking behind
                px(ctx, 8, 5, 1, 1, leafL);
                // gourd body
                px(ctx, 2, 8, 8, 4, fruit);
                px(ctx, 3, 7, 6, 1, fruit);
                px(ctx, 2, 8, 8, 1, fruitL);         // top highlight
                px(ctx, 2, 11, 8, 1, fruitD);        // dark underside
                px(ctx, 4, 8, 1, 4, fruitD);         // ribs
                px(ctx, 7, 8, 1, 4, fruitD);
                px(ctx, 5, 6, 2, 2, stem);           // stubby stem
                px(ctx, 5, 6, 1, 2, stemD);
            }
            break;
        }
        // ---------------------------------------------------------------
        case 'grapes': { // leafy bush; ripe = purple grape clusters
            if (stage === 2) {
                px(ctx, 3, 6, 6, 5, leafD);
                px(ctx, 3, 5, 6, 4, leaf);
                px(ctx, 4, 4, 4, 3, leaf);
                px(ctx, 4, 5, 3, 2, leafL);
                px(ctx, 5, 3, 2, 2, leaf);           // rising stem tip
            } else {
                px(ctx, 3, 7, 6, 4, leafD);
                px(ctx, 3, 6, 6, 3, leaf);
                px(ctx, 4, 8, 3, 2, leafL);
                // pink blooms
                px(ctx, 2, 3, 3, 3, fruit); px(ctx, 2, 3, 3, 1, fruitL); px(ctx, 3, 4, 1, 1, fruitD); px(ctx, 3, 3, 1, 1, '#f8b0cc');
                px(ctx, 7, 4, 3, 3, fruit); px(ctx, 7, 4, 3, 1, fruitL); px(ctx, 8, 5, 1, 1, fruitD);
                px(ctx, 5, 5, 2, 2, fruitD);         // lower bloom in shade
                px(ctx, 5, 5, 1, 1, fruit);
            }
            break;
        }
        // ---------------------------------------------------------------
        case 'beanstalk': { // a tall climbing vine; ripe = drooping green bean pods
            const vine = RAMPS.FOLIAGE[3], vineD = RAMPS.FOLIAGE[1], vineL = RAMPS.FOLIAGE[5];
            const pod = fruit, podD = shade(pod, 0.72), podL = shade(pod, 1.25);
            if (stage === 2) {
                px(ctx, 5, 3, 2, 8, vine); px(ctx, 6, 3, 1, 8, vineD);   // twisting stalk
                px(ctx, 5, 3, 1, 8, vineL);                              // sunlit left
                px(ctx, 3, 6, 2, 2, vine); px(ctx, 7, 8, 2, 2, vine);    // climbing leaves
                px(ctx, 3, 6, 1, 1, vineL); px(ctx, 7, 8, 1, 1, vineL);
                px(ctx, 4, 5, 1, 1, vine); px(ctx, 7, 7, 1, 1, vine);    // tendrils
                px(ctx, 5, 2, 2, 2, vineL);                              // growing tip
            } else {
                px(ctx, 5, 2, 2, 9, vine); px(ctx, 6, 2, 1, 9, vineD);   // tall stalk
                px(ctx, 5, 2, 1, 9, vineL);                              // sunlit left
                px(ctx, 3, 4, 2, 1, vine); px(ctx, 7, 6, 2, 1, vine);    // leaves
                px(ctx, 4, 3, 2, 2, vineL);                              // crown leaves
                // drooping pods (lit top, shaded tip)
                px(ctx, 3, 5, 1, 3, pod); px(ctx, 3, 5, 1, 1, podL); px(ctx, 3, 8, 1, 1, podD);
                px(ctx, 8, 4, 1, 3, pod); px(ctx, 8, 4, 1, 1, podL); px(ctx, 8, 7, 1, 1, podD);
                px(ctx, 6, 8, 1, 3, pod); px(ctx, 6, 8, 1, 1, podL); px(ctx, 6, 11, 1, 1, podD);
            }
            break;
        }
        // ---------------------------------------------------------------
        case 'wheat':
        default: { // upright blades; ripe = golden grain heads
            if (stage === 2) {
                px(ctx, 3, 5, 1, 6, stem); px(ctx, 6, 4, 1, 7, stem); px(ctx, 8, 5, 1, 6, stem);
                px(ctx, 6, 4, 1, 4, stemD);
                px(ctx, 2, 6, 2, 1, leaf); px(ctx, 7, 6, 2, 1, leaf); px(ctx, 4, 5, 2, 1, leaf);
                px(ctx, 6, 3, 1, 2, leafL);
                px(ctx, 3, 8, 1, 1, leafD); px(ctx, 8, 8, 1, 1, leafD);
            } else {
                const straw = '#a8863a';
                px(ctx, 3, 6, 1, 6, straw); px(ctx, 6, 5, 1, 7, straw); px(ctx, 9, 6, 1, 6, straw);
                // grain heads
                px(ctx, 2, 2, 3, 4, fruit); px(ctx, 5, 1, 3, 4, fruit); px(ctx, 8, 3, 3, 4, fruit);
                px(ctx, 3, 2, 1, 2, fruitL); px(ctx, 6, 1, 1, 2, fruitL); px(ctx, 9, 3, 1, 2, fruitL);
                px(ctx, 2, 5, 3, 1, fruitD); px(ctx, 5, 4, 3, 1, fruitD); px(ctx, 8, 6, 3, 1, fruitD);
                px(ctx, 3, 0, 1, 1, fruit); px(ctx, 6, 0, 1, 1, fruit); // awns
            }
            break;
        }
    }
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export function makeHouse(roofColor) {
    const [c, ctx] = makeCanvas(34, 30);
    // walls
    ctx.fillStyle = '#c8ac80';
    ctx.fillRect(4, 14, 26, 12);
    ctx.fillStyle = '#a8906a';
    ctx.fillRect(4, 24, 26, 2);
    // door
    ctx.fillStyle = '#68503c';
    ctx.fillRect(14, 17, 6, 9);
    ctx.fillStyle = '#f0d060';
    ctx.fillRect(18, 21, 1, 1);
    // window
    ctx.fillStyle = '#a8d8e8';
    ctx.fillRect(7, 17, 4, 4);
    ctx.fillRect(23, 17, 4, 4);
    ctx.fillStyle = '#68503c';
    ctx.fillRect(8, 17, 1, 4); ctx.fillRect(24, 17, 1, 4);
    // roof
    ctx.fillStyle = roofColor;
    for (let i = 0; i < 8; i++) {
        ctx.fillRect(2 + i * 2, 14 - i * 2, 30 - i * 4, 2);
    }
    // chimney
    ctx.fillStyle = '#8a7060';
    ctx.fillRect(24, 2, 4, 6);
    return c;
}

export function makeWell() {
    const [c, ctx] = makeCanvas(20, 22);
    // roof
    ctx.fillStyle = '#8a5c3c';
    ctx.fillRect(2, 2, 16, 3);
    ctx.fillRect(4, 0, 12, 2);
    // posts
    ctx.fillStyle = '#68503c';
    ctx.fillRect(3, 5, 2, 10);
    ctx.fillRect(15, 5, 2, 10);
    // stone ring
    ctx.fillStyle = '#9aa0ac';
    ctx.fillRect(2, 14, 16, 6);
    ctx.fillStyle = '#787e8c';
    ctx.fillRect(2, 18, 16, 2);
    ctx.fillStyle = '#2c4a6a';
    ctx.fillRect(5, 15, 10, 3);
    // crank
    ctx.fillStyle = '#584838';
    ctx.fillRect(9, 6, 2, 8);
    return c;
}

export function makeSign() {
    const [c, ctx] = makeCanvas(18, 16);
    ctx.fillStyle = '#a8875c';
    ctx.fillRect(1, 1, 16, 9);
    ctx.fillStyle = '#68503c';
    ctx.fillRect(8, 10, 2, 6);
    ctx.fillStyle = '#584428';
    drawText(ctx, 'RY', 5, 3, '#584428');
    return c;
}

export function makeBoard() {
    const [c, ctx] = makeCanvas(26, 22);
    // posts
    ctx.fillStyle = '#6b4f30'; ctx.fillRect(3, 12, 2, 10); ctx.fillRect(21, 12, 2, 10);
    // board frame + cork
    ctx.fillStyle = '#7a5a38'; ctx.fillRect(1, 1, 24, 14);
    ctx.fillStyle = '#5a4228'; ctx.fillRect(1, 1, 24, 1); ctx.fillRect(1, 14, 24, 1);
    ctx.fillStyle = '#b89a6c'; ctx.fillRect(3, 3, 20, 10);
    // little roof
    ctx.fillStyle = '#8a5a3a'; ctx.fillRect(0, 0, 26, 2);
    // pinned notes with red tacks
    const notes = [[4, 4], [12, 4], [18, 5], [5, 9], [13, 9]];
    for (const [nx, ny] of notes) { ctx.fillStyle = '#efe7d2'; ctx.fillRect(nx, ny, 4, 3); ctx.fillStyle = '#c05840'; ctx.fillRect(nx + 1, ny, 1, 1); }
    return c;
}

export function makeScaffold() {
    const [c, ctx] = makeCanvas(24, 22);
    ctx.fillStyle = '#a8875c';
    ctx.fillRect(2, 6, 2, 16);
    ctx.fillRect(20, 6, 2, 16);
    ctx.fillRect(2, 8, 20, 2);
    ctx.fillRect(2, 16, 20, 2);
    ctx.fillStyle = '#8a6844';
    ctx.fillRect(6, 10, 2, 6);
    ctx.fillRect(14, 12, 4, 4);
    return c;
}

// The TOOLSHED — a weathered-plank lean-to with a mono-pitch shingle roof, an open
// recessed bay of hanging tools (rake / hoe / spade) and a closed plank door. A town
// build. Exemplar: Harvest Moon outbuildings. (§2 farm-building class, §1b timber)
export function makeToolshed() {
    const [c, ctx] = makeCanvas(48, 44);
    const W = RAMPS.WOOD, S = RAMPS.STONE, OL = RAMPS.OUTLINE.brown;
    const bx0 = 8, bx1 = 40, wy0 = 16, wy1 = 40;
    groundShadow(ctx, 24, 41, 21, 5, 0.3);
    // weathered plank walls + form self-shadow (drawWall)
    drawWall(ctx, bx0, bx1, wy0, wy1, { base: W[2], hi: W[3], lo: W[1], ol: OL }, 6);
    ctx.fillStyle = shade(W[1], 1.1); ctx.fillRect(bx0 - 1, wy1 - 2, bx1 - bx0 + 3, 1);   // sill relief
    ctx.fillStyle = shade(OL, 0.85); ctx.fillRect(bx0 - 1, wy1 + 1, bx1 - bx0 + 3, 1);     // ground AO
    // MONO-PITCH (lean-to) roof — slopes up to the LEFT (light side); shingled slab with
    // an overhang. Per-column top y descends left→right; drawn as stepped plank rows.
    const rL = bx0 - 3, rR = bx1 + 3, topL = 6, topR = 16, th = 5;
    for (let x = rL; x <= rR; x++) {
        const ty = Math.round(topL + (topR - topL) * (x - rL) / (rR - rL));
        ctx.fillStyle = OL; ctx.fillRect(x, ty - 1, 1, 1);                       // top outline edge
        for (let d = 0; d < th; d++) {
            const col = d === 0 ? shade(W[3], 1.06) : d < 2 ? W[2] : d < th - 1 ? W[1] : shade(W[0], 0.9);
            ctx.fillStyle = col; ctx.fillRect(x, ty + d, 1, 1);
        }
        if ((x - rL) % 5 === 2) { ctx.fillStyle = shade(W[0], 0.85); ctx.fillRect(x, ty + 1, 1, th - 1); }   // shingle seams
        ctx.fillStyle = shade(W[0], 0.7); ctx.fillRect(x, ty + th, 1, 1);        // eave underside shadow
    }
    ctx.fillStyle = shade(OL, 0.8); ctx.fillRect(bx0, wy0, bx1 - bx0 + 1, 1);    // eave AO band on wall
    // open BAY (left) — a recessed dark interior with a back wall + hanging tools
    recess(ctx, 11, 22, 13, 17, '#1a1611', OL);
    ctx.fillStyle = shade(W[0], 1.2); ctx.fillRect(12, 23, 11, 1);               // faint back-wall top light
    // rake: shaft + tines
    ctx.fillStyle = W[3]; ctx.fillRect(14, 24, 1, 13); ctx.fillStyle = shade(W[3], 0.85); ctx.fillRect(15, 24, 1, 13);
    ctx.fillStyle = S[3]; ctx.fillRect(12, 36, 5, 1); for (let t = 12; t <= 16; t += 2) ctx.fillRect(t, 37, 1, 2);
    // hoe: shaft + angled head
    ctx.fillStyle = W[3]; ctx.fillRect(19, 24, 1, 12); ctx.fillStyle = shade(W[3], 0.85); ctx.fillRect(20, 25, 1, 11);
    ctx.fillStyle = S[4]; ctx.fillRect(18, 35, 1, 1); ctx.fillStyle = S[3]; ctx.fillRect(17, 36, 3, 2);
    // spade leaning in the corner: shaft + blade
    ctx.fillStyle = W[2]; ctx.fillRect(22, 25, 1, 9);
    ctx.fillStyle = S[3]; ctx.fillRect(21, 34, 3, 3); ctx.fillStyle = shade(S[4], 1.1); ctx.fillRect(21, 34, 1, 1);
    // closed plank DOOR (right) with hinges + handle
    recess(ctx, 27, 24, 9, 15, '#20190f', OL);
    ctx.fillStyle = W[2]; ctx.fillRect(28, 25, 7, 13);
    ctx.fillStyle = W[3]; ctx.fillRect(28, 25, 1, 13);                            // lit board
    ctx.fillStyle = shade(W[0], 0.9); ctx.fillRect(30, 25, 1, 13); ctx.fillRect(33, 25, 1, 13);   // plank seams
    ctx.fillStyle = '#2a2620'; ctx.fillRect(28, 27, 2, 1); ctx.fillRect(28, 35, 2, 1);            // hinges
    ctx.fillStyle = shade(S[4], 1.05); ctx.fillRect(34, 31, 1, 1);                // handle
    return c;
}

// ---------------------------------------------------------------------------
// ISOMETRIC BUILDING projection (PROCEDURAL_ART.md §6a) — POC helpers + coop.
// A building sits in the 2:1 dimetric plane: a diamond footprint, two receding wall
// faces (front-left LIT / front-right SHADOW) at a near vertical corner, and a hip roof
// seen from ABOVE (two visible planes meeting at a peak, overhanging the eaves). Every
// non-vertical edge is 2:1 (2 across:1 down); faces rasterize column-by-column as solid
// vertical fills → no anti-aliasing. Seasonal: WINTER caps up-facing roof/eaves in snow.
// ---------------------------------------------------------------------------

// translucent 2:1 diamond ground shadow (offset toward lower-right; light upper-left)
function isoDiamondShadow(ctx, cx, cy, hw, hh, a) {
    ctx.fillStyle = `rgba(12,16,12,${a})`;
    for (let dy = -hh; dy <= hh; dy++) {
        const half = Math.round(hw * (1 - Math.abs(dy) / hh));
        if (half < 1) continue;
        ctx.fillRect(cx - half, cy + dy, half * 2, 1);
    }
}
// scanline a triangle by COLUMNS, calling cb(x, yTop, yBot) per column (solid spans, no AA)
function isoTriSpan(p1, p2, p3, cb) {
    const xs = [p1[0], p2[0], p3[0]], x0 = Math.min(...xs), x1 = Math.max(...xs);
    const edges = [[p1, p2], [p2, p3], [p3, p1]];
    for (let x = x0; x <= x1; x++) {
        let lo = Infinity, hi = -Infinity;
        for (const [[ax, ay], [bx, by]] of edges) {
            if (ax === bx) { if (x === ax) { lo = Math.min(lo, ay, by); hi = Math.max(hi, ay, by); } continue; }
            if (x >= Math.min(ax, bx) && x <= Math.max(ax, bx)) {
                const y = ay + (by - ay) * (x - ax) / (bx - ax);
                lo = Math.min(lo, y); hi = Math.max(hi, y);
            }
        }
        if (lo <= hi) cb(x, Math.round(lo), Math.round(hi));
    }
}
// 1px 2:1-aware edge line via integer DDA (no AA)
function isoEdge(ctx, a, b, col) {
    const dx = b[0] - a[0], dy = b[1] - a[1], n = Math.max(Math.abs(dx), Math.abs(dy)) || 1;
    ctx.fillStyle = col;
    for (let i = 0; i <= n; i++) ctx.fillRect(Math.round(a[0] + dx * i / n), Math.round(a[1] + dy * i / n), 1, 1);
}
// ---- §6a.4 curved-plan helpers (round forms) — stepped (manually aliased), never ctx.arc ----
// filled 2:1 ellipse (a round cap/base seen from above); stepped rows, no AA
function isoEllipseFill(ctx, cx, cy, hw, hh, col) {
    ctx.fillStyle = col;
    for (let dy = -hh; dy <= hh; dy++) {
        const half = Math.round(hw * Math.sqrt(Math.max(0, 1 - (dy / hh) * (dy / hh))));
        if (half < 1) continue;
        ctx.fillRect(cx - half, cy + dy, half * 2, 1);
    }
}
// 3-BAND cylinder body between a top ellipse (centre cyTop) and bottom ellipse (centre cyBot),
// half-width hw, ellipse half-height hh. Vertical fills; tone steps by horizontal position
// (LIT left band → mid → core-SHADOW right band, +bright/dark edges for roundness). ramp = 5-tone.
function isoCylinderBody(ctx, cx, cyTop, cyBot, hw, hh, ramp) {
    for (let x = cx - hw; x <= cx + hw; x++) {
        const dx = (x - cx) / hw;
        const ey = Math.round(hh * Math.sqrt(Math.max(0, 1 - dx * dx)));   // front-arc offset at this column
        const yTop = cyTop + ey, yBot = cyBot + ey;
        const idx = dx < -0.66 ? 4 : dx < -0.2 ? 3 : dx < 0.33 ? 2 : dx < 0.72 ? 1 : 0;   // lit-left → shadow-right
        ctx.fillStyle = ramp[idx];
        ctx.fillRect(x, yTop, 1, yBot - yTop + 1);
    }
}
// CONE cap (windmill/tower/canopy) — radial courses converging on the apex; tone by band,
// stepped. baseCy = centre y of the base ellipse, apexY above it; ramp = 5-tone.
function isoConeCap(ctx, cx, baseCy, hw, hh, apexY, ramp) {
    for (let x = cx - hw; x <= cx + hw; x++) {
        const dx = (x - cx) / hw;
        const ey = Math.round(hh * Math.sqrt(Math.max(0, 1 - dx * dx)));   // base front-arc at this column
        const yBase = baseCy + ey;
        const idx = dx < -0.5 ? 4 : dx < 0 ? 3 : dx < 0.5 ? 2 : dx < 0.8 ? 1 : 0;
        ctx.fillStyle = ramp[idx];
        ctx.fillRect(x, apexY, 1, yBase - apexY + 1);                      // radial run apex → rim
    }
    // a couple of stepped ridge courses (concentric) for texture
    ctx.fillStyle = ramp[1];
    for (let r = 0.4; r < 1; r += 0.3) {
        for (let x = cx - Math.round(hw * r); x <= cx + Math.round(hw * r); x++) {
            const dx = (x - cx) / (hw * r);
            const ey = Math.round(hh * r * Math.sqrt(Math.max(0, 1 - dx * dx)));
            ctx.fillRect(x, Math.round(apexY + (baseCy - apexY) * r) + ey, 1, 1);
        }
    }
}
// CURVED-STONE COURSES (§6a.4 texture convention for stone cylinders — silo/tower/well/
// windmill): coursed-masonry lines that BOW with the 2:1 curvature (sag toward the viewer
// at centre so they read as rings on a round body, not straight bands) + staggered vertical
// block joints (brickwork offset). Rides ON the 3-band shading — thin mortar lines only, so
// the lit/mid/shadow structure stays intact. hwAt(y) = half-width at level y (supports taper).
function curvedStoneCourses(ctx, cx, yTop, yBot, hwAt, mortar, litLip) {
    let ci = 0;
    for (let yl = yBot - 2; yl >= yTop + 3; yl -= 5, ci++) {
        const hw = hwAt(yl), ehh = Math.min(3, Math.max(1, Math.round(hw * 0.4)));
        for (let x = cx - hw + 1; x <= cx + hw - 1; x++) {
            const dx = (x - cx) / hw, bow = Math.round(ehh * (1 - Math.sqrt(Math.max(0, 1 - dx * dx))));
            ctx.fillStyle = mortar; ctx.fillRect(x, yl - bow, 1, 1);                        // course seam (bows down at centre)
            if (litLip && x < cx) { ctx.fillStyle = litLip; ctx.fillRect(x, yl - bow - 1, 1, 1); }  // faint lit lip above, on the lit half only
        }
        const stag = (ci % 2) * 3;                                                          // brickwork offset per course
        for (let jx = cx - hw + 3 + stag; jx < cx + hw - 2; jx += 6) {
            const dx = (jx - cx) / hw, bow = Math.round(ehh * (1 - Math.sqrt(Math.max(0, 1 - dx * dx))));
            ctx.fillStyle = mortar; ctx.fillRect(jx, yl - bow - 4, 1, 4);                   // vertical block joint up to the next course
        }
    }
}
// rounded BOULDER / stacked stone (mythical monument) — layered offset ellipses, lit UL,
// lichen fleck (deterministic by seed). ramp = 5-tone warm stone.
function boulder(ctx, cx, cy, rx, ry, ramp, seed) {
    const OL = RAMPS.OUTLINE.warm, F = RAMPS.FOLIAGE;
    const ell = (ox, oy, rrx, rry, col) => {
        if (rrx < 1 || rry < 1) return;
        for (let dy = -rry; dy <= rry; dy++) {
            const half = Math.round(rrx * Math.sqrt(Math.max(0, 1 - (dy / rry) * (dy / rry))));
            if (half < 1) continue;
            ctx.fillRect(Math.round(cx + ox - half), Math.round(cy + oy + dy), half * 2, 1);
        }
    };
    ctx.fillStyle = OL;      ell(0, 0, rx + 1, ry + 1, OL);                                   // outline
    ctx.fillStyle = ramp[2]; ell(0, 0, rx, ry, ramp[2]);                                      // base
    ctx.fillStyle = ramp[1]; ell(Math.round(rx * 0.24), Math.round(ry * 0.3), rx - 1, ry - 1, ramp[1]);   // lower-right shade
    ctx.fillStyle = ramp[3]; ell(-Math.round(rx * 0.28), -Math.round(ry * 0.32), Math.round(rx * 0.6), Math.round(ry * 0.55), ramp[3]);  // lit cap
    ctx.fillStyle = ramp[4]; ell(-Math.round(rx * 0.34), -Math.round(ry * 0.44), Math.max(1, Math.round(rx * 0.34)), Math.max(1, Math.round(ry * 0.32)), ramp[4]);  // hot cap
    ctx.fillStyle = shade(OL, 0.9); ctx.fillRect(cx - rx + 1, cy + ry, rx * 2 - 2, 1);        // base contact AO
    const h = ((seed * 2654435761) >>> 0);                                                    // deterministic lichen
    ctx.fillStyle = F[3]; ctx.fillRect(cx - Math.round(rx * 0.3) + (h % 3), cy + Math.round(ry * 0.15), 1, 1);
    ctx.fillStyle = F[5]; ctx.fillRect(cx + Math.round(rx * 0.15) - (h % 2), cy - Math.round(ry * 0.05), 1, 1);
}
// a soft mystic glow halo (translucent, stepped) — an FX layer, like the tower orb / cast shadow
function mysticHalo(ctx, cx, cy, r, a, rgb) {
    ctx.fillStyle = `rgba(${rgb},${a})`;
    for (let dy = -r; dy <= r; dy++) {
        const half = Math.round(r * Math.sqrt(Math.max(0, 1 - (dy / r) * (dy / r))));
        if (half < 1) continue;
        ctx.fillRect(cx - half, cy + dy, half * 2, 1);
    }
}

// A warm-shifted CACHED ramp (for FALL) — pure hue rotation toward amber + a small
// value/sat lift, per tone. NOT an alpha overlay (that would blend colours + break the
// solid-fill/no-AA palette discipline); this stays a set of authored solid tones. Pure.
function warmRamp(ramp, deg, satF, valF) {
    return ramp.map(hex => {
        const [r, g, b] = _hexToRgb(hex);
        let [h, s, l] = _rgbToHsl(r, g, b);
        h = _hueToward(h, 32, deg); s = Math.min(1, s * satF); l = Math.min(1, l * valF);
        const [R2, G2, B2] = _hslToRgb(h, s, l);
        return _rgbToHex(R2, G2, B2);
    });
}

// POC (corrected, §6a/§6b): the CHICKEN COOP in the iso plane, per season. A 2:1 diamond
// footprint, two receding wall faces (front-left LIT / front-right SHADOW) at a near
// vertical corner, and a hip roof from above (two planes → apex, overhanging), with a
// crisp lower-RIGHT diamond shadow, shingle COURSES (not checker), a committed light
// split, framed openings, a warm cached FALL ramp, and rounded WINTER snow. Cached per
// season. Exemplars: ALttP/Harvest Moon/Stardew ¾ coops + Landstalker box geometry.
const _coopIso = {};
export function makeCoopIso(season = 'SUMMER') {
    if (_coopIso[season]) return _coopIso[season];
    const [c, ctx] = makeCanvas(48, 46);
    const winter = season === 'WINTER', fall = season === 'FALL';
    // FALL = warmer CACHED ramps (fix #4); other seasons use the base ramps
    const P = fall ? warmRamp(RAMPS.PLANK, 12, 1.05, 1.05) : RAMPS.PLANK;
    const R = fall ? warmRamp(RAMPS.ROOF_RED, 16, 1.04, 1.06) : RAMPS.ROOF_RED;
    const OL = RAMPS.OUTLINE.brown, F = RAMPS.FOLIAGE;
    const corner = '#cdb890';                              // value accent in the wood family (fix #5 — not gold)
    const cx = 24, gy = 32, hw = 20, hh = 10, wallH = 14, roofH = 10;   // peak dropped (fix #9)
    const L = [cx - hw, gy], Rr = [cx + hw, gy], Fr = [cx, gy + hh];
    const Lp = [cx - hw, gy - wallH], Rp = [cx + hw, gy - wallH], Fp = [cx, gy + hh - wallH];
    const RL = [cx - hw - 2, gy - wallH + 1], RR = [cx + hw + 2, gy - wallH + 1], RF = [cx, gy + hh - wallH + 2];
    const Pk = [cx, gy - wallH - roofH];

    // ---- CAST SHADOW: crisp 2:1 diamond, two stacked layers (~0.28), offset lower-RIGHT (fix #1) ----
    isoDiamondShadow(ctx, cx + 3, gy + 2, hw, hh, 0.14);
    isoDiamondShadow(ctx, cx + 2, gy + 2, hw - 3, hh - 1, 0.18);

    // ---- WALLS: committed light split (fix #3) — front-left LIT (+1), front-right SHADOW (−2) ----
    const wallFace = (gA, gB, tone, seam) => {
        const x0 = Math.min(gA[0], gB[0]), x1 = Math.max(gA[0], gB[0]);
        for (let x = x0; x <= x1; x++) {
            const t = (x - gA[0]) / (gB[0] - gA[0]);
            const yb = Math.round(gA[1] + (gB[1] - gA[1]) * t), yt = yb - wallH;
            ctx.fillStyle = tone; ctx.fillRect(x, yt, 1, wallH);
            ctx.fillStyle = shade(tone, 0.82); ctx.fillRect(x, yb - 1, 1, 1);      // base AO
            if ((x - x0) % 5 === 2) { ctx.fillStyle = seam; ctx.fillRect(x, yt + 1, 1, wallH - 2); }
        }
    };
    wallFace(L, Fr, P[3], P[2]);      // front-left LIT
    wallFace(Fr, Rr, P[1], P[0]);     // front-right SHADOW (2 full steps down, seams too)

    // ---- ROOF: two planes, shingle COURSES (fix #2), plane split under the texture ----
    const roofPlane = (a, b, base, snowTone, snowLit) => isoTriSpan(a, b, Pk, (x, yt, yb) => {
        for (let y = yt; y <= yb; y++) {
            const above = yb - y, course = Math.floor(above / 3);
            let col = base;
            if (above % 3 === 2) col = shade(base, 0.8);                          // course seam — a 2:1 line parallel to the eave
            else if ((x + course * 2) % 4 === 0) col = shade(base, 0.9);          // offset shingle divisions (half-course brickwork)
            ctx.fillStyle = col; ctx.fillRect(x, y, 1, 1);
        }
        ctx.fillStyle = shade(base, 1.14); ctx.fillRect(x, yt, 1, 1);             // ridge-lit top
        ctx.fillStyle = shade(base, 0.72); ctx.fillRect(x, yb, 1, 1);            // eave-shadow lip
        if ((x * 7 + yt * 5) % 13 === 0 && yb - yt > 3) { ctx.fillStyle = shade(base, 1.1); ctx.fillRect(x, yt + 2, 1, 1); }   // sparse highlight
        if (winter) {                                                            // snow on the upper band, itself lit/shadowed per plane
            const cap = Math.max(1, Math.round((yb - yt) * 0.4));
            for (let y = yt; y < yt + cap; y++) { ctx.fillStyle = snowTone; ctx.fillRect(x, y, 1, 1); }
            ctx.fillStyle = snowLit; ctx.fillRect(x, yt, 1, 1);
            ctx.fillStyle = shade(snowTone, 0.9); ctx.fillRect(x, yt + cap - 1, 1, 1);   // snow underside
        }
    });
    roofPlane(RL, RF, R[3], '#eef4f4', '#ffffff');   // left plane LIT — snow warmer
    roofPlane(RF, RR, R[1], '#dbe8ec', '#eef4f4');   // right plane SHADOW — snow cooler

    // rounded apex cap + finial so the peak is never a bare point (fix #9); WINTER rounds it (fix #7)
    ctx.fillStyle = shade(R[2], 1.12); ctx.fillRect(cx - 2, Pk[1] + 1, 4, 1);
    ctx.fillStyle = R[3]; ctx.fillRect(cx - 1, Pk[1], 2, 1);
    if (winter) { ctx.fillStyle = '#f4fafa'; ctx.fillRect(cx - 2, Pk[1], 4, 2); ctx.fillStyle = '#ffffff'; ctx.fillRect(cx - 1, Pk[1], 2, 1); }

    // ---- eave-AO line (roof meets wall) + WINTER snow-ledge 1px above it, along BOTH eaves (fix #7) ----
    isoEdge(ctx, RL, RF, shade(OL, 1.0)); isoEdge(ctx, RF, RR, shade(OL, 1.0));
    if (winter) {
        for (let x = RL[0]; x <= RF[0]; x++) { const t = (x - RL[0]) / (RF[0] - RL[0]); ctx.fillStyle = '#eef4f4'; ctx.fillRect(x, Math.round(RL[1] + (RF[1] - RL[1]) * t) - 1, 1, 1); }
        for (let x = RF[0]; x <= RR[0]; x++) { const t = (x - RF[0]) / (RR[0] - RF[0]); ctx.fillStyle = '#dbe8ec'; ctx.fillRect(x, Math.round(RF[1] + (RR[1] - RF[1]) * t) - 1, 1, 1); }
    }

    // ---- near vertical CORNER edge (value accent, wood family) ----
    isoEdge(ctx, Fp, Fr, corner);

    // ---- DOOR on the front-left LIT wall: bottom ON the base 2:1 line, top follows the slope, lit jambs (fix #6) ----
    for (let x = 12; x <= 19; x++) {
        const t = (x - L[0]) / (Fr[0] - L[0]);
        const yb = Math.round(gy + (Fr[1] - gy) * t);
        const jamb = (x === 12 || x === 19);
        ctx.fillStyle = jamb ? shade(P[3], 1.08) : '#1c1510';
        ctx.fillRect(x, yb - 9, 1, jamb ? 9 : 8);
    }
    // ---- WINDOW on the front-right SHADOW wall: 1px wood frame + blue-grey panes + one glint, no orphans (fix #6) ----
    for (let x = 30; x <= 35; x++) {
        const t = (x - Fr[0]) / (Rr[0] - Fr[0]);
        const yb = Math.round((gy + hh) + (gy - (gy + hh)) * t), top = yb - 10;
        if (x === 30 || x === 35) { ctx.fillStyle = shade(P[1], 1.14); ctx.fillRect(x, top, 1, 6); continue; }
        ctx.fillStyle = shade(P[1], 1.14); ctx.fillRect(x, top, 1, 1); ctx.fillRect(x, top + 5, 1, 1);   // frame top+sill
        ctx.fillStyle = winter ? '#bcd4dc' : RAMPS.GLASS[1]; ctx.fillRect(x, top + 1, 1, 2);              // upper panes
        ctx.fillStyle = winter ? '#a9c4ce' : RAMPS.GLASS[0]; ctx.fillRect(x, top + 3, 1, 2);              // lower panes (shadow)
    }
    { const x = 31, t = (x - Fr[0]) / (Rr[0] - Fr[0]), yb = Math.round((gy + hh) + (gy - (gy + hh)) * t);
      ctx.fillStyle = winter ? '#e8f4f8' : RAMPS.GLASS[2]; ctx.fillRect(x, yb - 9, 1, 1); }               // single glint / frost

    // ---- silhouette outline (crisp box; clean overhang wedges, fix #8) ----
    isoEdge(ctx, L, Fr, OL); isoEdge(ctx, Fr, Rr, OL);          // wall bottoms
    isoEdge(ctx, L, RL, OL); isoEdge(ctx, Rr, RR, OL);          // outer side edges (wall → roof overhang tip)
    isoEdge(ctx, RL, Pk, OL); isoEdge(ctx, Pk, RR, OL);         // roof ridges

    // ---- FALL dry-leaf flecks near the eaves (deterministic: seeded by index, no rng) ----
    if (fall) {
        const leaves = [['#c9782a', 6, 26], ['#a8531e', 40, 26], ['#d89a34', 15, 30], ['#b8641a', 33, 31]];
        for (const [col, lx, ly] of leaves) { ctx.fillStyle = col; ctx.fillRect(lx, ly, 1, 1); }
    }

    _coopIso[season] = c;
    return c;
}

// makeCoopTD — the coop in TOP-DOWN ¾ / FRONT-FACING projection (ALttP / Stardew /
// Harvest Moon) — round 6: LOWER, FLATTER, GENUINELY OBLIQUE. Round 5 passed the
// flip-test checklist on paper (horizontal ridge, low widest eave, 2px overhang)
// but the reviewer still read a tall bilaterally-symmetric pyramid seen HEAD-ON:
// the topmost rows sat near the sprite's center axis, the hip form kept two
// mirror-ish flanker wedges, and the roof band ran 30 rows (~65%) — a TENT, not
// a roof slab seen from above AND from an angle. Round 6 reworks the MASSING,
// the reviewer's items 1–5 in order:
//   (1) SYMMETRY KILLED STRUCTURALLY — the LEFT hip wedge is DELETED: the broad
//       lit front slope runs all the way out to the left silhouette rake, one
//       LONG SHALLOW diagonal (16px of run over 21 rows — the dominant plane's
//       own foreshortened edge), while the RIGHT hip-end survives as the single
//       visible SIDE PLANE: a narrow FLAT SHADED sliver behind a steep short
//       rake (8px of run). Ridge (14px, x21..34, center 27.5) sits 4px RIGHT of
//       the eave center (23.5). Two genuinely different edges + ONE visible
//       side facet = "a roof seen at an angle", structurally not a pyramid.
//   (2) FAR-SLOPE SLIVER over the top — 2 rows of the DARKEST roof tones
//       (y8–9, skewed with the ridge) ABOVE the +1 bright ridge crease (y10):
//       the topmost silhouette pixels are the BACK plane glimpsed over the top,
//       dark — never the ridge highlight. Dark-above / bright-below = two
//       planes at a crease, and the strip visually caps the height.
//   (3) LOWER + FLATTER — roof band cut 30 → 25 rows (~61% of the y7..47
//       silhouette, inside the 55–62% target): the top drops from y2 to y7,
//       the ridge widens 12 → 14px, and the eave pulls in 1px/side (x5..42) so
//       both rakes are GENTLER. Wall stays 12 rows (~29%, at the cap). A broad
//       low slab you look down on, not a steep tent.
//   (4) COURSE COMPRESSION — 2px pitch under the ridge OPENING to 3px at the
//       eave (bottoms 12,14,16,18,21,24,27,30): the forward tilt made visible.
//   (5) KEPT what worked — exact 2px overhang step per side, continuous 1px
//       dark fascia at the eave, eave-AO whisper on the wall beneath it, short
//       quiet wall with off-center openings, and the WINTER snow-load slab
//       sitting on the top-facing plane (it helps the from-above read).
// Surface light per §6a.3 (lit roof ≥ lit wall > shadow roof > shadow wall):
// vertical ridge→eave grade on the dominant slope (never a left-to-right facade
// gradient), a lit 1px left-rake edge, and a flat darkest right facet — red-on-
// red variety comes from the grade + course lit-tops/undersides + seam ticks.
// Pure fillRect, cached per season.
// deterministic position hash → 0..1 (snow drifts / flecks; NEVER Math.random / Date). Pure.
function _phash(a, b) {
    let n = ((a * 73856093) ^ (b * 19349663)) >>> 0;
    n ^= n >>> 15; n = (n * 2246822519) >>> 0; n ^= n >>> 13;
    return (n % 1024) / 1024;
}
const _coopTD = {};
export function makeCoopTD(season = 'SUMMER', opts = {}) {
    const _k = season + ':' + (opts.eggs ?? 2);
    if (_coopTD[_k]) return _coopTD[_k];
    // REBUILT on the approved GABLE grammar (buildings.js · makeGableHouse), scaled down to
    // a farm outbuilding. The previous version was the "broad oblique slab" experiment that
    // predates the projection being settled. Everything law-shaped now comes from the shared
    // helpers so the coop, the house and every later structure stay identical in treatment.
    const [c, ctx] = makeCanvas(52, 46);
    const winter = season === 'WINTER', fall = season === 'FALL';
    const P = fall ? warmRamp(RAMPS.PLANK, 12, 1.05, 1.05) : RAMPS.PLANK;
    const R = fall ? warmRamp(RAMPS.ROOF_RED, 16, 1.04, 1.06) : RAMPS.ROOF_RED;
    const W = fall ? warmRamp(RAMPS.WOOD, 12, 1.04, 1.05) : RAMPS.WOOD;
    const G = RAMPS.GLASS;
    const OLwall = outlineFor(P[1]), OLwood = outlineFor(W[1]), OLroof = outlineFor(R[1]);
    const SNOW = { deep: '#ffffff', mid: '#eef4f4', thin: '#dbe8ec' };

    // ---- GEOMETRY — gable end to camera; the ridge recedes as a vertical apex ----
    const CXL = 25, CXR = 26;
    const dOf = (x) => (x <= CXL ? CXL - x : x - CXR);
    const HALF = 18, DEPTH = 18;                      // a TALL band: depth is what separates a house from a shed
    const topAt = (d) => 3 + Math.floor(d * 0.6);
    const botAt = (d) => topAt(d) + DEPTH;
    const litLeft = LIGHT.x < 0;
    const WX0 = 11, WX1 = 40, WY1 = 43;
    const onRoof = (x) => dOf(x) <= HALF;

    // ---- WALL (drawn first; the eave overhangs it) ----
    for (let x = WX0; x <= WX1; x++) {
        const yTop = botAt(dOf(x)) + 1, h = WY1 - yTop + 1;
        if (h <= 0) continue;
        let col = P[2];
        if (litLeft ? x <= WX0 + 2 : x >= WX1 - 2) col = shade(P[2], 1.14);
        else if (litLeft ? x >= WX1 - 5 : x <= WX0 + 5) col = P[1];
        if (litLeft ? x >= WX1 - 1 : x <= WX0 + 1) col = P[0];
        ctx.fillStyle = col; ctx.fillRect(x, yTop, 1, h);
    }
    for (const sx of [17, 33]) {                      // plank seams — PROPORTIONAL (§S.2)
        const yTop = botAt(dOf(sx)) + 3, hgt = WY1 - 3 - yTop;
        if (hgt <= 0) continue;
        ctx.fillStyle = TEX_DARK;  ctx.fillRect(sx, yTop, 1, hgt);
        ctx.fillStyle = TEX_LIGHT; ctx.fillRect(sx + 1, yTop, 1, hgt);
    }
    // base, graded along the sun (§S.2) — no seat shadow on buildings
    for (let x = WX0 - 1; x <= WX1 + 1; x++) {
        const t = (x - (WX0 - 1)) / Math.max(1, (WX1 + 1) - (WX0 - 1));
        const base = shade(W[1], 1.07 - t * 0.15);
        ctx.fillStyle = base;              ctx.fillRect(x, 41, 1, 3);
        ctx.fillStyle = shade(base, 1.10); ctx.fillRect(x, 41, 1, 1);
    }
    ctx.fillStyle = OLwood; ctx.fillRect(WX0, 44, WX1 - WX0 + 1, 1);
    ctx.fillStyle = OLwall;
    ctx.fillRect(WX0 - 1, botAt(dOf(WX0)) + 1, 1, WY1 - botAt(dOf(WX0)));
    ctx.fillRect(WX1 + 1, botAt(dOf(WX1)) + 1, 1, WY1 - botAt(dOf(WX1)));

    // ---- COOP FURNITURE — what makes it read as a COOP and not a small house ----
    // A chicken POP-HOLE is small and low, with a plank ramp up to it. Seen top-down the
    // ramp is a short vertical shape rising from the ground into the hole, its rungs
    // reading as horizontal ticks.
    { const hx = 23, hyT = 35, hw = 5, hyB = 39;                                     // small chicken-scale hole
      ctx.fillStyle = OLwood; ctx.fillRect(hx - 1, hyT - 1, hw + 2, (hyB - hyT) + 3);
      ctx.fillStyle = '#1c1510'; ctx.fillRect(hx, hyT, hw, hyB - hyT + 1);           // dark interior
      for (const k of [0, hw - 1]) { ctx.fillStyle = OLwood; ctx.fillRect(hx + k, hyT, 1, 1); }   // arched shoulders
      ctx.fillStyle = shade(W[2], 1.10); ctx.fillRect(hx - 1, hyT - 1, hw + 2, 1);   // lit lintel
      ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(hx, hyB, hw, 1);              // shadow in the mouth
      // RAMP: rises from the ground into the hole
      const rx = hx, rw = hw;                                                    // ramp spans the FULL hole width
      ctx.fillStyle = W[2]; ctx.fillRect(rx, hyB + 1, rw, 43 - hyB);
      ctx.fillStyle = shade(W[3], 1.08); ctx.fillRect(rx, hyB + 1, 1, 43 - hyB);     // lit edge (upper-left)
      ctx.fillStyle = TEX_DARK; ctx.fillRect(rx + rw - 1, hyB + 1, 1, 43 - hyB);     // away edge
      for (let ry = hyB + 2; ry < 43; ry += 2) { ctx.fillStyle = TEX_DARK; ctx.fillRect(rx, ry, rw, 1); }   // rungs across the full width
      ctx.fillStyle = 'rgba(0,0,0,0.16)'; ctx.fillRect(rx, 43, rw, 1);               // contact with the ground
    }
    // NEST BOXES — one either side of the pop-hole. Wide-and-low cubbies under a lit
    // ledge with straw spilling over the lip: no glass, lower than a window would sit,
    // and the straw is what makes them read as nesting rather than glazing. The earlier
    // framed squares at window height simply read as WINDOWS.
    // An egg shows ONLY when one is actually harvestable (driven by opts.eggs, which the
    // game feeds from the coop's ready producers) — so the sprite reports real state.
    { const eggs = Math.max(0, Math.min(2, opts.eggs ?? 0));
      const GRN = RAMPS.GRAIN;
      const nestBox = (bx0, hasEgg) => {
          const bw = 8, ledgeY = 32, bodyY = 33, bodyB = 39;
          ctx.fillStyle = OLwood; ctx.fillRect(bx0 - 1, ledgeY, bw + 2, (bodyB - ledgeY) + 2);
          ctx.fillStyle = shade(W[3], 1.08); ctx.fillRect(bx0 - 1, ledgeY, bw + 2, 1);   // lit ledge
          ctx.fillStyle = W[1]; ctx.fillRect(bx0, bodyY, bw, (bodyB - bodyY) + 1);
          ctx.fillStyle = '#1c1510'; ctx.fillRect(bx0 + 1, bodyY + 1, bw - 2, 5);        // the cubby
          ctx.fillStyle = TEX_DARK;  ctx.fillRect(bx0 + 1, bodyY + 1, bw - 2, 1);        // shadow under the lip
          for (let k = 0; k < bw - 2; k++) {                                             // ragged straw over the front lip
              const h = 1 + (hash2d(bx0 + k, 3) > 0.55 ? 1 : 0);
              ctx.fillStyle = GRN[3 + (k % 2)];
              ctx.fillRect(bx0 + 1 + k, bodyY + 6 - h, 1, h);
          }
          ctx.fillStyle = GRN[5]; ctx.fillRect(bx0 + 2, bodyY + 5, 1, 1);
          if (hasEgg) {                                                                  // only when one is ready to collect
              const ex = bx0 + 3;
              ctx.fillStyle = '#efe4cf'; ctx.fillRect(ex, bodyY + 3, 2, 2);
              ctx.fillStyle = '#fffaf0'; ctx.fillRect(ex, bodyY + 3, 1, 1);              // lit upper-left
              ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fillRect(ex, bodyY + 5, 2, 1);     // seats it in the straw
          }
          ctx.fillStyle = 'rgba(0,0,0,0.14)'; ctx.fillRect(bx0, bodyB + 1, bw, 1);       // the box's shadow on the wall
      };
      nestBox(12, eggs >= 1);        // LEFT of the pop-hole (the window used to sit here)
      nestBox(32, eggs >= 2);        // RIGHT
    }

    // ---- ROOF — committed upper-left split + shingle courses + the §S.2b lighting pass ----
    for (let x = 1; x <= 50; x++) {
        if (!onRoof(x)) continue;
        const d = dOf(x), t0 = topAt(d), b0 = botAt(d);
        const lit = (x <= CXL) === litLeft;
        let firstY = -1;
        for (let y = t0; y <= b0; y++) {
            if (d > HALF - overhangInset(y)) continue;          // §S.2d only the overhang is irregular
            let col = lit ? R[3] : R[1];
            const f = (y - t0) / Math.max(1, b0 - t0);
            if (f < 0.12) col = shade(col, lit ? 1.08 : 1.03);
            else if (f > 0.85) col = shade(col, 0.86);
            const sh = shingleTile(col, x, y - t0, lit);
            col = roofLightPass(sh.col, sh.tcol, sh.rr, d / HALF, f,
                                { strokeA: lit ? 1.10 : 1.05, strokeB: lit ? 1.04 : 1.02,
                                  lift: lit ? 1.05 : 1.0, fallX: lit ? 0.08 : 0.05, fallY: 0.06 });
            if (y === b0) col = lit ? shade(R[1], 0.8) : R[0];   // eave fascia
            if (firstY < 0) firstY = y;
            ctx.fillStyle = col; ctx.fillRect(x, y, 1, 1);
        }
        if (firstY >= 0) { ctx.fillStyle = OLroof; ctx.fillRect(x, firstY - 1, 1, 1); }
    }
    // apex crease + cap
    const ridgeTop = topAt(0);
    ctx.fillStyle = shade(R[4], 1.08); ctx.fillRect(litLeft ? CXL : CXR, ridgeTop, 1, DEPTH);
    ctx.fillStyle = R[0];              ctx.fillRect(litLeft ? CXR : CXL, ridgeTop, 1, DEPTH + 1);
    ctx.fillStyle = OLroof;            ctx.fillRect(CXL, ridgeTop - 1, 2, 1);
    // graded soffit shadow under the overhang (§S.2c) + eave tips
    for (let x = WX0; x <= WX1; x++) {
        ctx.fillStyle = 'rgba(0,0,0,0.13)'; ctx.fillRect(x, botAt(dOf(x)) + 1, 1, 2);
    }
    ctx.fillStyle = OLroof;
    for (let x = 1; x < WX0; x++) if (onRoof(x)) ctx.fillRect(x, botAt(dOf(x)) + 1, 1, 1);
    for (let x = WX1 + 1; x <= 50; x++) if (onRoof(x)) ctx.fillRect(x, botAt(dOf(x)) + 1, 1, 1);

    // ---- SEASONS (§6b0) — both inherited from the shared helpers ----
    if (winter) {
        for (let x = 1; x <= 50; x++) {
            if (!onRoof(x)) continue;
            const d = dOf(x), lit = (x <= CXL) === litLeft;
            snowCourses(ctx, x, topAt(d), botAt(d), { frac: lit ? 0.66 : 0.56, bright: lit, tone: SNOW });
            eaveIcicles(ctx, x, botAt(d), SNOW);
        }
        ctx.fillStyle = SNOW.deep; ctx.fillRect(CXL, ridgeTop, 2, 3);
        ctx.fillStyle = SNOW.mid;  ctx.fillRect(CXL, ridgeTop + 3, 2, 2);
    }
    if (fall) leafDrift(ctx, 1, 50, (x) => topAt(dOf(x)), (x) => botAt(dOf(x)), onRoof);

    // (no grounding tufts) — they sat directly beneath the nest boxes and cluttered the
    // one part of the frontage that has to stay readable, since the straw and the egg
    // are what report the coop's state. Ground planting belongs in the terrain anyway.

    _coopTD[_k] = c;
    return c;
}

// GATE-3 POC · WELL (round, small) — validates §6a.4 curved-plan (3-band stone cylinder +
// 2:1 ellipse rim/base caps), §6a.7 footprint→CONTAINER (a small well seated in a larger
// seasonal ground patch) + silhouette shadow, and §6b snow on a round form. Cached per
// season; pure fillRect. The grassy back seasons (green / autumn / snow) so it sits right.
const _wellIso = {};
export function makeWellIso(season = 'SUMMER') {
    if (_wellIso[season]) return _wellIso[season];
    const [c, ctx] = makeCanvas(40, 44);
    const winter = season === 'WINTER', fall = season === 'FALL';
    const S = RAMPS.STONE, WAT = RAMPS.WATER, OL = RAMPS.OUTLINE.warm, F = RAMPS.FOLIAGE;
    const W = fall ? warmRamp(RAMPS.WOOD, 12, 1.04, 1.05) : RAMPS.WOOD;
    const Rr = fall ? warmRamp(RAMPS.ROOF_RED, 16, 1.04, 1.06) : RAMPS.ROOF_RED;
    const cx = 20;

    // ---- CONTAINER: the seasonal ground patch (the grassy back) — bigger than the well (§6a.7) ----
    const gnd = winter ? ['#b6c6cc', '#d2dee2', '#eef4f4'] : fall ? ['#5a4028', '#79603f', '#94733f'] : ['#2d603d', '#3f7a34', '#4f9438'];
    isoEllipseFill(ctx, cx, 37, 17, 8, gnd[0]);
    isoEllipseFill(ctx, cx - 1, 36, 15, 7, gnd[1]);
    isoEllipseFill(ctx, cx - 2, 35, 9, 4, gnd[2]);                     // lit upper-left patch
    // seasonal ground flecks (deterministic: fixed positions, §6a.10)
    const flecks = fall ? [['#c9782a', 6, 39], ['#a8531e', 30, 40], ['#d89a34', 13, 41]]
        : winter ? [['#ffffff', 8, 39], ['#ffffff', 28, 40], ['#e8f0f2', 15, 41]]
            : [['#e85888', 7, 39], ['#f0c838', 29, 40], ['#eef0f8', 14, 41]];
    for (const [col, fx, fy] of flecks) { ctx.fillStyle = col; ctx.fillRect(fx, fy, 1, 1); }

    // ---- cast shadow (sized to the SILHOUETTE, offset lower-right) ----
    isoDiamondShadow(ctx, cx + 3, 38, 12, 6, 0.14);
    isoDiamondShadow(ctx, cx + 2, 38, 9, 5, 0.18);

    // ---- STONE RING cylinder body (3-band) + coursed masonry (§6a.4 curved-stone texture) ----
    isoCylinderBody(ctx, cx, 22, 32, 9, 4, S);
    curvedStoneCourses(ctx, cx, 24, 34, () => 9, S[0], S[4]);
    // side outline + base contact
    isoEdge(ctx, [cx - 9, 22], [cx - 9, 32], OL); isoEdge(ctx, [cx + 9, 22], [cx + 9, 32], OL);
    isoEllipseFill(ctx, cx, 33, 9, 4, 'rgba(12,16,12,0.0)');           // (base seat handled by shadow)
    ctx.fillStyle = shade(OL, 0.95); for (let x = cx - 8; x <= cx + 8; x++) { const dx = (x - cx) / 9, ey = Math.round(4 * Math.sqrt(Math.max(0, 1 - dx * dx))); ctx.fillRect(x, 32 + ey, 1, 1); }

    // ---- top RIM (2:1 ellipse of stone) + water / ice ----
    isoEllipseFill(ctx, cx, 22, 9, 4, S[3]);                           // rim stone (up-facing → lit)
    isoEllipseFill(ctx, cx - 1, 21, 6, 3, S[4]);                       // lit upper-left of the rim
    ctx.fillStyle = OL; for (let dy = -4; dy <= 4; dy++) { const half = Math.round(9 * Math.sqrt(Math.max(0, 1 - (dy / 4) * (dy / 4)))); if (half < 1) continue; ctx.fillRect(cx - half, 22 + dy, 1, 1); ctx.fillRect(cx + half - 1, 22 + dy, 1, 1); }  // rim outline ring
    isoEllipseFill(ctx, cx, 22, 6, 3, winter ? '#c2d4da' : WAT[1]);    // water (ice in winter)
    isoEllipseFill(ctx, cx - 1, 21, 3, 2, winter ? '#dfeced' : WAT[3]); // water/ice highlight
    if (winter) { ctx.fillStyle = '#eef4f4'; for (let dy = -4; dy <= 4; dy++) { const half = Math.round(9 * Math.sqrt(Math.max(0, 1 - (dy / 4) * (dy / 4)))); if (half < 3) continue; ctx.fillRect(cx - half, 22 + dy - 1, 1, 1); ctx.fillRect(cx + half - 1, 22 + dy - 1, 1, 1); } }  // snow on the rim ledge

    // ---- posts + a small hip CANOPY (roof fraction modest on this short body) ----
    ctx.fillStyle = W[1]; ctx.fillRect(10, 12, 2, 9); ctx.fillRect(28, 12, 2, 9);
    ctx.fillStyle = W[2]; ctx.fillRect(10, 12, 1, 9); ctx.fillRect(28, 12, 1, 9);        // lit post edges
    const RL = [8, 12], RRt = [32, 12], RF = [cx, 16], Pk = [cx, 3];
    const canopy = (a, b, base) => isoTriSpan(a, b, Pk, (x, yt, yb) => {
        for (let y = yt; y <= yb; y++) { const above = yb - y; ctx.fillStyle = (above % 3 === 2) ? shade(base, 0.8) : base; ctx.fillRect(x, y, 1, 1); }
        ctx.fillStyle = shade(base, 1.14); ctx.fillRect(x, yt, 1, 1);
        if (winter) { const cap = Math.max(1, Math.round((yb - yt) * 0.4)); ctx.fillStyle = base === Rr[3] ? '#eef4f4' : '#dbe8ec'; ctx.fillRect(x, yt, 1, cap); ctx.fillStyle = '#ffffff'; ctx.fillRect(x, yt, 1, 1); }
    });
    canopy(RL, RF, Rr[3]); canopy(RF, RRt, Rr[1]);                     // lit + shadow canopy planes
    ctx.fillStyle = shade(OL, 1.0); isoEdge(ctx, RL, RF, shade(OL, 1.0)); isoEdge(ctx, RF, RRt, shade(OL, 1.0));   // eave AO
    isoEdge(ctx, RL, Pk, OL); isoEdge(ctx, Pk, RRt, OL);              // ridges
    ctx.fillStyle = Rr[3]; ctx.fillRect(cx - 1, Pk[1], 2, 1);        // finial
    if (winter) { ctx.fillStyle = '#f4fafa'; ctx.fillRect(cx - 1, Pk[1], 2, 2); }

    _wellIso[season] = c;
    return c;
}

// GATE-3 POC · WINDMILL (tall, round, animated) — validates §6a.5 height-decoupling (tall
// body, roof/cap fraction ~20–25%), §6a.4 round 3-band tapered tower + iso CONE cap, and
// §6a.9 SCREEN-FACING blades (the sanctioned era cheat). PRESERVATION MANDATE: the loved
// animated sails are KEPT VERBATIM from makeWindmill — only the BODY moves into the iso
// plane. Cached per (season, frame); pure fillRect. season affects only the wood/cap ramp.
const _windmillIso = {};
export function makeWindmillIso(season = 'SUMMER', frame = 0) {
    const key = season + ':' + (frame | 0);
    if (_windmillIso[key]) return _windmillIso[key];
    const [c, ctx] = makeCanvas(44, 64);
    const winter = season === 'WINTER', fall = season === 'FALL';
    const S = RAMPS.STONE, OL = RAMPS.OUTLINE.warm;
    const W = fall ? warmRamp(RAMPS.WOOD, 12, 1.04, 1.05) : RAMPS.WOOD;
    const cx = 22, hubY = 20;

    // cast shadow (silhouette-sized, offset lower-right)
    isoDiamondShadow(ctx, cx + 4, 61, 13, 6, 0.16);
    isoDiamondShadow(ctx, cx + 3, 61, 10, 5, 0.2);

    // ---- ROUND 3-BAND tapered TOWER (row-based so it can taper: wider at the base) ----
    const tTop = 24, tBot = 60, hwTop = 7, hwBot = 10;
    for (let y = tTop; y <= tBot; y++) {
        const hwY = Math.round(hwTop + (hwBot - hwTop) * (y - tTop) / (tBot - tTop));
        for (let x = cx - hwY; x <= cx + hwY; x++) {
            const dx = (x - cx) / hwY;
            const idx = dx < -0.66 ? 4 : dx < -0.2 ? 3 : dx < 0.33 ? 2 : dx < 0.72 ? 1 : 0;
            ctx.fillStyle = S[idx]; ctx.fillRect(x, y, 1, 1);
        }
    }
    // coursed masonry (§6a.4 curved-stone texture) — bowing courses + staggered joints ride on the 3 bands
    curvedStoneCourses(ctx, cx, tTop, tBot, (y) => Math.round(hwTop + (hwBot - hwTop) * (y - tTop) / (tBot - tTop)), S[0], S[4]);
    // side outline + base front-arc
    for (let y = tTop; y <= tBot; y++) { const hwY = Math.round(hwTop + (hwBot - hwTop) * (y - tTop) / (tBot - tTop)); ctx.fillStyle = OL; ctx.fillRect(cx - hwY, y, 1, 1); ctx.fillRect(cx + hwY, y, 1, 1); }
    isoEllipseFill(ctx, cx, tBot, hwBot, 5, 'rgba(0,0,0,0)'); ctx.fillStyle = shade(OL, 0.95); for (let x = cx - hwBot; x <= cx + hwBot; x++) { const dx = (x - cx) / hwBot, ey = Math.round(5 * Math.sqrt(Math.max(0, 1 - dx * dx))); ctx.fillRect(x, tBot + ey, 1, 1); }

    // door + window (recesses read on the round front)
    ctx.fillStyle = S[4]; ctx.fillRect(cx - 4, 50, 8, 1);
    recess(ctx, cx - 3, 51, 6, 9, '#171310', S[0]);
    ctx.fillStyle = W[1]; ctx.fillRect(cx - 2, 52, 4, 8); ctx.fillStyle = shade(W[0], 0.9); ctx.fillRect(cx, 52, 1, 8);
    recess(ctx, cx - 2, 38, 4, 4, '#161a20', S[0]); ctx.fillStyle = RAMPS.GLASS[1]; ctx.fillRect(cx - 2, 38, 4, 4); ctx.fillStyle = shade(RAMPS.GLASS[2], 1.2); ctx.fillRect(cx - 2, 38, 1, 1);

    // ---- iso CONE cap (radial courses → apex), overhanging the tower top; winter snow-capped ----
    isoConeCap(ctx, cx, 24, 9, 4, 9, W);
    ctx.fillStyle = OL; for (let x = cx - 9; x <= cx + 9; x++) { const dx = (x - cx) / 9, ey = Math.round(4 * Math.sqrt(Math.max(0, 1 - dx * dx))); ctx.fillRect(x, 24 + ey, 1, 1); }   // eave rim
    ctx.fillStyle = shade(W[3], 1.1); ctx.fillRect(cx - 1, 9, 2, 1);         // apex finial
    if (winter) {
        for (let x = cx - 8; x <= cx + 8; x++) { const dx = (x - cx) / 9, top = Math.round(9 + (24 - 9) * 0); const ey = Math.round(4 * Math.sqrt(Math.max(0, 1 - dx * dx)));
            const yBase = 24 + ey, snow = Math.max(1, Math.round((yBase - 9) * 0.4));
            ctx.fillStyle = dx < 0 ? '#eef4f4' : '#dbe8ec'; ctx.fillRect(x, 9, 1, snow); }
        ctx.fillStyle = '#f4fafa'; ctx.fillRect(cx - 1, 9, 2, 2);            // rounded snow apex (never a cone hat)
    }

    // ---- SAILS (KEPT VERBATIM from makeWindmill — the loved screen-facing animation; §6a.9) ----
    const cloth = '#e8e0d0', spar = W[1], sparHi = W[3];
    const len = 18, baseAng = (frame | 0) * (Math.PI / 8);
    for (let k = 0; k < 4; k++) {
        const a = baseAng + k * (Math.PI / 2), dx = Math.cos(a), dy = Math.sin(a), nx = -dy, ny = dx;
        for (let r = 2; r <= len; r += 0.5) {
            ctx.fillStyle = spar; ctx.fillRect(Math.round(cx + dx * r), Math.round(hubY + dy * r), 1, 1);
            ctx.fillStyle = sparHi; ctx.fillRect(Math.round(cx + dx * r + nx), Math.round(hubY + dy * r + ny), 1, 1);
        }
        for (let r = 4; r <= len; r += 0.5) {
            const wsail = 1 + Math.floor((r / len) * 3);
            for (let w = 1; w <= wsail; w++) { ctx.fillStyle = cloth; ctx.fillRect(Math.round(cx + dx * r + nx * w), Math.round(hubY + dy * r + ny * w), 1, 1); }
            if (Math.round(r) % 3 === 0) { for (let w = 1; w <= wsail; w++) { ctx.fillStyle = shade(cloth, 0.82); ctx.fillRect(Math.round(cx + dx * r + nx * w), Math.round(hubY + dy * r + ny * w), 1, 1); } }
        }
        ctx.fillStyle = '#fffdf6'; ctx.fillRect(Math.round(cx + dx * len), Math.round(hubY + dy * len), 1, 1);
    }
    ctx.fillStyle = W[0]; ctx.fillRect(cx - 2, hubY - 2, 4, 4);
    ctx.fillStyle = shade(W[2], 1.1); ctx.fillRect(cx - 2, hubY - 2, 2, 1);
    ctx.fillStyle = '#2a2620'; ctx.fillRect(cx - 1, hubY - 1, 2, 2);

    _windmillIso[key] = c;
    return c;
}

// GATE-3 POC · MONUMENT (roofless, non-architectural) — validates §6a.7 silhouette shadow
// (no roof) + §6b snow on LEDGES ONLY (a form with no roof planes). Folds in the halted
// MYTHICAL redesign: NOT monolithic steel-gray sharp angles — ROUNDED mossy boulders +
// a glowing GEM/orb marker. kind 'human' = warm mossy stone + cyan gem; 'orc' = ashen
// boulders + BONES + a violet gem. Cached per (kind, season); pure fillRect.
const _monIso = {};
export function makeMonumentIso(kind = 'human', season = 'SUMMER') {
    const key = kind + ':' + season;
    if (_monIso[key]) return _monIso[key];
    const [c, ctx] = makeCanvas(24, 30);
    const winter = season === 'WINTER', orc = kind === 'orc';
    const cx = 12;
    const stone = orc ? ['#2a2824', '#3c3833', '#4e4842', '#635c54', '#7a7168'] : RAMPS.MOSS_STONE;
    const gem = orc ? { d: '#3a1c4a', m: '#7a3a9a', l: '#b878d8', c: '#e8c0f8', rgb: '170,90,220' }
        : { d: '#1c6e7a', m: '#2fb0c0', l: '#7fe0ec', c: '#d0f6fa', rgb: '120,230,245' };

    // ---- cast shadow (silhouette diamond, offset lower-right; no roof, so from the stones) ----
    isoDiamondShadow(ctx, cx + 3, 27, 9, 4, 0.16);
    isoDiamondShadow(ctx, cx + 2, 27, 6, 3, 0.2);

    // ---- stacked ROUNDED boulders (roofless mythical cairn) ----
    const stack = [[8, 22, 5, 4], [16, 23, 4, 3], [11, 18, 5, 4], [12, 13, 4, 3]];
    for (let i = 0; i < stack.length; i++) { const [bx, by, rx, ry] = stack[i]; boulder(ctx, bx, by, rx, ry, stone, i + 1); }

    // ---- orc: BONES + a skull at the base ----
    if (orc) {
        const bone = '#d8d0bc', boneHi = '#efe8d4', boneLo = '#a89a80';
        ctx.fillStyle = bone; ctx.fillRect(4, 15, 1, 8); ctx.fillRect(3, 14, 2, 1); ctx.fillRect(4, 23, 2, 1);   // a long bone leaning
        ctx.fillStyle = boneHi; ctx.fillRect(4, 15, 1, 1);
        ctx.fillStyle = bone; ctx.fillRect(18, 22, 3, 3); ctx.fillRect(19, 21, 1, 1);                            // skull lump
        ctx.fillStyle = '#241c18'; ctx.fillRect(19, 23, 1, 1); ctx.fillRect(21, 23, 1, 1);                       // eye sockets
        ctx.fillStyle = boneLo; ctx.fillRect(18, 24, 3, 1);
    }

    // ---- WINTER: snow on the up-facing TOP of each boulder (ledges only — no roof) ----
    if (winter) {
        for (const [bx, by, rx, ry] of stack) {
            ctx.fillStyle = '#eef4f4';
            for (let x = bx - Math.round(rx * 0.55); x <= bx + Math.round(rx * 0.35); x++) ctx.fillRect(x, by - ry, 1, 1);
            ctx.fillStyle = '#ffffff'; ctx.fillRect(bx - Math.round(rx * 0.3), by - ry, 1, 1);
        }
    }

    // ---- the glowing GEM / orb marker (enchanted; a soft pulsing glow is added in main.js) ----
    const gx = 12, gy = 10, sz = 2;
    mysticHalo(ctx, gx, gy, sz + 2, winter ? 0.16 : 0.13, gem.rgb);
    mysticHalo(ctx, gx, gy, sz + 1, 0.22, gem.rgb);
    for (let dy = -sz; dy <= sz; dy++) { const half = sz - Math.abs(dy); if (half < 0) continue; ctx.fillStyle = gem.m; ctx.fillRect(gx - half, gy + dy, half * 2 + 1, 1); }
    ctx.fillStyle = gem.l; ctx.fillRect(gx - 1, gy - sz, 1, sz + 1);      // lit-left facet
    ctx.fillStyle = gem.d; ctx.fillRect(gx + 1, gy, 1, sz);              // shadow-right facet
    ctx.fillStyle = gem.c; ctx.fillRect(gx - 1, gy - 1, 1, 1);           // core
    ctx.fillStyle = '#ffffff'; ctx.fillRect(gx - 1, gy - sz, 1, 1);      // spec glint

    _monIso[key] = c;
    return c;
}

// #85/#7d legend MEMORIAL SERIES — a stone raised where a raider fell, its GRANDEUR
// scaling with the battle it marks (tier 1..5, stamped deterministically in farm.js):
//   1 Cairn (rough stone pile) · 2 Marker Stone (obelisk + gold plaque — the clean stand)
//   3 Sworded Stele (taller stone + planted blade + laurel — defenders wounded)
//   4 Cenotaph (twin/stepped + broken shield & helm + scorched earth — heavy losses)
//   5 War Barrow (mound + obelisk cluster + crossed shattered weapon + blackened ground)
// Tiny-sprite discipline throughout: STONE ramp, lit-left/shadow-right, ground AO, reads
// at 1×. Each tier cached once. All BASE-anchored (bottom row = ground) so main.js can
// drop any tier on the same spot. (§1b)
const _monuments = {};
export function makeMonument(tier = 2) {
    tier = Math.max(1, Math.min(5, tier | 0));
    if (_monuments[tier]) return _monuments[tier];
    const S = RAMPS.STONE, G = RAMPS.GRAIN, F = RAMPS.FOLIAGE, W = RAMPS.WOOD, OL = RAMPS.OUTLINE.warm;
    const steel = '#8a94a2', steelHi = '#b6c0cc', steelLo = '#5a626e';   // muted weapon metal
    let c, ctx;
    // small lit-left / shadow-right stone block (top bevel + base AO)
    const block = (x, y, w, h, idx) => {
        ctx.fillStyle = OL; ctx.fillRect(x - 1, y, w + 2, h + 1);
        ctx.fillStyle = S[idx]; ctx.fillRect(x, y, w, h);
        ctx.fillStyle = shade(S[idx], 1.14); ctx.fillRect(x, y, w, 1);          // lit top bevel
        ctx.fillStyle = shade(S[idx], 1.08); ctx.fillRect(x, y, 1, h);          // sunlit left
        ctx.fillStyle = shade(S[idx], 0.82); ctx.fillRect(x + w - 1, y, 1, h);  // shadow right
        ctx.fillStyle = shade(OL, 0.9); ctx.fillRect(x, y + h, w, 1);           // base AO
    };

    if (tier === 1) {                 // CAIRN — a low pile of rough field stones
        [c, ctx] = makeCanvas(12, 14);
        groundShadow(ctx, 6, 12, 5, 2, 0.3);
        block(2, 8, 5, 4, 2); block(6, 9, 4, 3, 1); block(4, 5, 4, 4, 3); block(5, 2, 3, 3, 2);
        ctx.fillStyle = F[3]; ctx.fillRect(3, 11, 1, 1); ctx.fillRect(8, 10, 1, 1);   // lichen flecks

    } else if (tier === 2) {          // MARKER STONE — obelisk + gold plaque (the original sprite)
        [c, ctx] = makeCanvas(12, 21);
        const cx = 6;
        groundShadow(ctx, cx, 19, 6, 2, 0.32);
        ctx.fillStyle = OL;  ctx.fillRect(1, 14, 10, 5);
        ctx.fillStyle = S[2]; ctx.fillRect(1, 15, 10, 3);
        ctx.fillStyle = S[3]; ctx.fillRect(1, 15, 10, 1);
        ctx.fillStyle = S[1]; ctx.fillRect(1, 17, 10, 1);
        ctx.fillStyle = shade(OL, 0.9); ctx.fillRect(1, 18, 10, 1);
        const sx0 = 3, sw = 6, sTop = 2, sBot = 14;
        ctx.fillStyle = OL;   ctx.fillRect(sx0 - 1, sTop, sw + 2, sBot - sTop);
        ctx.fillStyle = S[2]; ctx.fillRect(sx0, sTop, sw, sBot - sTop);
        ctx.fillStyle = S[3]; ctx.fillRect(sx0, sTop, 2, sBot - sTop);
        ctx.fillStyle = shade(S[4], 1.05); ctx.fillRect(sx0, sTop, 1, sBot - sTop);
        ctx.fillStyle = S[1]; ctx.fillRect(sx0 + sw - 1, sTop, 1, sBot - sTop);
        ctx.fillStyle = shade(S[2], 1.08); ctx.fillRect(sx0 + 1, sTop + 1, 3, 3);
        ctx.fillStyle = shade(S[2], 0.9);  ctx.fillRect(sx0 + 2, sTop + 8, 3, 3);
        ctx.fillStyle = S[0]; ctx.fillRect(sx0, sTop + 6, sw, 1);
        ctx.fillStyle = shade(S[3], 1.08); ctx.fillRect(sx0, sTop + 7, sw, 1);
        ctx.fillStyle = OL;  ctx.fillRect(cx - 3, 1, 6, 1);
        ctx.fillStyle = S[3]; ctx.fillRect(cx - 2, 1, 4, 1);
        ctx.fillStyle = shade(S[4], 1.1); ctx.fillRect(cx - 1, 0, 2, 1);
        ctx.fillStyle = S[1]; ctx.fillRect(cx + 1, 1, 1, 1);
        ctx.fillStyle = OL;  ctx.fillRect(cx - 3, 6, 6, 5);
        ctx.fillStyle = G[1]; ctx.fillRect(cx - 2, 7, 4, 3);
        ctx.fillStyle = G[3]; ctx.fillRect(cx - 2, 7, 4, 1);
        ctx.fillStyle = G[4]; ctx.fillRect(cx - 2, 7, 2, 1);
        ctx.fillStyle = shade(G[1], 0.82); ctx.fillRect(cx - 2, 9, 4, 1);
        ctx.fillStyle = shade(G[0], 0.9); ctx.fillRect(cx - 1, 8, 2, 1);
        ctx.fillStyle = '#fffdf6'; ctx.fillRect(cx - 2, 7, 1, 1);

    } else if (tier === 3) {          // SWORDED STELE — taller stone + a blade planted point-down + laurel
        [c, ctx] = makeCanvas(12, 24);
        const cx = 6;
        groundShadow(ctx, cx, 22, 6, 2, 0.32);
        ctx.fillStyle = OL;  ctx.fillRect(1, 18, 10, 4);              // plinth
        ctx.fillStyle = S[2]; ctx.fillRect(1, 19, 10, 2);
        ctx.fillStyle = S[3]; ctx.fillRect(1, 19, 10, 1);
        ctx.fillStyle = shade(OL, 0.9); ctx.fillRect(1, 21, 10, 1);
        const sx0 = 3, sw = 6, sTop = 3, sBot = 18;                   // taller shaft
        ctx.fillStyle = OL;   ctx.fillRect(sx0 - 1, sTop, sw + 2, sBot - sTop);
        ctx.fillStyle = S[2]; ctx.fillRect(sx0, sTop, sw, sBot - sTop);
        ctx.fillStyle = S[3]; ctx.fillRect(sx0, sTop, 2, sBot - sTop);
        ctx.fillStyle = shade(S[4], 1.05); ctx.fillRect(sx0, sTop, 1, sBot - sTop);
        ctx.fillStyle = S[1]; ctx.fillRect(sx0 + sw - 1, sTop, 1, sBot - sTop);
        ctx.fillStyle = S[0]; ctx.fillRect(sx0, sTop + 7, sw, 1);     // seam
        ctx.fillStyle = shade(S[2], 1.08); ctx.fillRect(sx0 + 1, sTop + 1, 3, 3);
        ctx.fillStyle = OL;  ctx.fillRect(cx - 2, 1, 4, 2);           // rounded top
        ctx.fillStyle = S[3]; ctx.fillRect(cx - 2, 2, 4, 1);
        ctx.fillStyle = shade(S[4], 1.1); ctx.fillRect(cx - 1, 1, 2, 1);
        // planted SWORD in front, point-down into the plinth (hilt up)
        ctx.fillStyle = steelLo; ctx.fillRect(cx, 9, 1, 11);
        ctx.fillStyle = steel;   ctx.fillRect(cx - 1, 9, 1, 11);
        ctx.fillStyle = steelHi; ctx.fillRect(cx - 1, 9, 1, 6);       // lit upper blade
        ctx.fillStyle = W[1]; ctx.fillRect(cx - 2, 7, 4, 1);          // crossguard (bronze/wood)
        ctx.fillStyle = W[3]; ctx.fillRect(cx - 2, 7, 1, 1);
        ctx.fillStyle = W[2]; ctx.fillRect(cx - 1, 4, 1, 3);          // grip
        ctx.fillStyle = G[3]; ctx.fillRect(cx - 1, 3, 1, 1);          // pommel (gold)
        // small laurel sprigs at the base
        ctx.fillStyle = F[3]; ctx.fillRect(1, 16, 2, 1); ctx.fillRect(2, 15, 1, 1); ctx.fillRect(9, 16, 2, 1); ctx.fillRect(9, 15, 1, 1);
        ctx.fillStyle = F[5]; ctx.fillRect(1, 16, 1, 1); ctx.fillRect(10, 16, 1, 1);

    } else if (tier === 4) {          // CENOTAPH — twin/stepped memorial + broken shield & helm + scorched earth
        [c, ctx] = makeCanvas(14, 22);
        const cx = 7;
        ctx.fillStyle = 'rgba(30,22,16,0.5)';                         // scorched-earth speckle
        for (const [x, y] of [[1, 19], [3, 20], [11, 19], [12, 20], [5, 21], [9, 20], [2, 18]]) ctx.fillRect(x, y, 1, 1);
        groundShadow(ctx, cx, 19, 7, 2, 0.32);
        block(1, 15, 12, 3, 1); block(2, 12, 10, 3, 2);              // stepped base (2 courses)
        block(3, 4, 3, 9, 3); block(8, 6, 3, 7, 2);                  // twin pillars (tall + short)
        ctx.fillStyle = OL; ctx.fillRect(3, 2, 8, 1);                // lintel
        ctx.fillStyle = S[3]; ctx.fillRect(3, 3, 8, 2);
        ctx.fillStyle = shade(S[4], 1.1); ctx.fillRect(3, 3, 8, 1);
        ctx.fillStyle = G[1]; ctx.fillRect(5, 3, 4, 1); ctx.fillStyle = G[3]; ctx.fillRect(5, 3, 2, 1);   // plaque
        // broken shield at the foot-left (cracked, boss)
        ctx.fillStyle = W[1]; ctx.fillRect(1, 16, 3, 3); ctx.fillStyle = W[2]; ctx.fillRect(1, 16, 2, 1);
        ctx.fillStyle = steel; ctx.fillRect(2, 17, 1, 1);
        ctx.fillStyle = OL; ctx.fillRect(2, 16, 1, 3);               // crack
        // helm at the foot-right (visor slit)
        ctx.fillStyle = steelLo; ctx.fillRect(10, 17, 3, 2); ctx.fillStyle = steel; ctx.fillRect(10, 16, 3, 1);
        ctx.fillStyle = steelHi; ctx.fillRect(10, 16, 1, 1);
        ctx.fillStyle = OL; ctx.fillRect(11, 17, 1, 2);

    } else {                          // 5 · WAR BARROW — mound + obelisk cluster + crossed shattered weapon + blackened ground
        [c, ctx] = makeCanvas(16, 24);
        const cx = 8;
        ctx.fillStyle = 'rgba(24,18,14,0.55)';                       // blackened ground
        for (const [x, y] of [[1, 21], [3, 22], [5, 21], [7, 22], [9, 21], [11, 22], [13, 21], [14, 22], [2, 20], [12, 20]]) ctx.fillRect(x, y, 1, 1);
        groundShadow(ctx, cx, 21, 8, 2, 0.34);
        for (let dy = 0; dy < 5; dy++) { const hw = 7 - dy; ctx.fillStyle = W[1]; ctx.fillRect(cx - hw, 16 + dy, hw * 2, 1); }   // earth barrow mound
        ctx.fillStyle = W[2]; ctx.fillRect(cx - 6, 16, 5, 1);        // lit mound crest
        ctx.fillStyle = W[0]; ctx.fillRect(cx - 7, 20, 14, 1);       // mound base shadow
        ctx.fillStyle = F[3]; ctx.fillRect(cx - 4, 16, 1, 1); ctx.fillRect(cx + 2, 17, 1, 1);   // grass tufts
        block(1, 13, 2, 4, 1); block(13, 14, 2, 3, 1); block(4, 12, 2, 3, 2);   // small markers per life lost
        block(cx - 2, 3, 4, 14, 2);                                  // central obelisk
        ctx.fillStyle = shade(S[4], 1.05); ctx.fillRect(cx - 2, 3, 1, 14);
        ctx.fillStyle = OL; ctx.fillRect(cx - 2, 1, 4, 2); ctx.fillStyle = S[3]; ctx.fillRect(cx - 1, 1, 2, 1);   // cap
        // crossed SHATTERED weapons (broken swords, an X with a gap in the middle)
        ctx.fillStyle = steel;
        for (let d = 0; d < 6; d++) { if (d === 2 || d === 3) continue; ctx.fillRect(cx - 3 + d, 6 + d, 1, 1); ctx.fillRect(cx + 2 - d, 6 + d, 1, 1); }
        ctx.fillStyle = steelHi; ctx.fillRect(cx - 3, 6, 1, 1); ctx.fillRect(cx + 2, 6, 1, 1);   // lit tips
        ctx.fillStyle = G[1]; ctx.fillRect(cx - 2, 12, 4, 2); ctx.fillStyle = G[3]; ctx.fillRect(cx - 2, 12, 4, 1);   // plaque
        ctx.fillStyle = '#fffdf6'; ctx.fillRect(cx - 2, 12, 1, 1);
    }
    _monuments[tier] = c;
    return c;
}

// A Dutch windmill: an ashlar stone tower + a timber cap, with FOUR lattice sails that
// truly ROTATE across the 4 frames (22.5°/frame; the 4-fold symmetry makes the cycle
// loop seamlessly at ~9fps — see main.js). Sails are plotted pixel-by-pixel along the
// rotated arm (no ctx.rotate/arc → no anti-aliasing). frame = 0..3. (§7, §P11)
export function makeWindmill(frame = 0) {
    const [c, ctx] = makeCanvas(44, 64);
    const S = RAMPS.STONE, W = RAMPS.WOOD, OL = RAMPS.OUTLINE.warm;
    const cx = 22, hubY = 20;
    groundShadow(ctx, 22, 61, 15, 4, 0.3);
    // stone tower, gently tapered (wider at the base)
    ashlarBody(ctx, cx, 26, 62, 9, 13, S, OL);
    // door + window recesses
    ctx.fillStyle = S[4]; ctx.fillRect(cx - 4, 50, 8, 1);            // door lintel
    recess(ctx, cx - 3, 51, 6, 11, '#171310', S[0]);
    ctx.fillStyle = W[1]; ctx.fillRect(cx - 2, 52, 4, 10);          // plank door
    ctx.fillStyle = shade(W[0], 0.9); ctx.fillRect(cx, 52, 1, 10);
    recess(ctx, cx - 2, 36, 4, 4, '#161a20', S[0]);                 // small window
    ctx.fillStyle = RAMPS.GLASS[1]; ctx.fillRect(cx - 2, 36, 4, 4);
    ctx.fillStyle = shade(RAMPS.GLASS[2], 1.2); ctx.fillRect(cx - 2, 36, 1, 1);
    // timber CAP (the rotating boat-cap that carries the sails) — overhangs the tower top
    ctx.fillStyle = OL; ctx.fillRect(cx - 9, 21, 18, 6);
    ctx.fillStyle = W[2]; ctx.fillRect(cx - 8, 22, 16, 4);
    ctx.fillStyle = W[3]; ctx.fillRect(cx - 8, 22, 16, 1);          // lit ridge
    ctx.fillStyle = shade(W[1], 0.85); ctx.fillRect(cx - 8, 25, 16, 1);   // under-cap shadow (eave AO on tower)
    ctx.fillStyle = W[1]; ctx.fillRect(cx - 9, 19, 3, 3);          // finial stub
    // ---- four lattice SAILS, rotated for this frame (plotted, not transformed) ----
    const cloth = '#e8e0d0', spar = W[1], sparHi = W[3];
    const len = 18, baseAng = frame * (Math.PI / 8);   // 22.5° per frame
    for (let k = 0; k < 4; k++) {
        const a = baseAng + k * (Math.PI / 2), dx = Math.cos(a), dy = Math.sin(a), nx = -dy, ny = dx;
        // stock (spar): 2px, hub -> tip, stepped finely so the diagonal has no gaps
        for (let r = 2; r <= len; r += 0.5) {
            const x = Math.round(cx + dx * r), y = Math.round(hubY + dy * r);
            ctx.fillStyle = spar; ctx.fillRect(x, y, 1, 1);
            ctx.fillStyle = sparHi; ctx.fillRect(Math.round(cx + dx * r + nx), Math.round(hubY + dy * r + ny), 1, 1);
        }
        // sail cloth on the +perp side of each stock, widening toward the tip, with slats
        for (let r = 4; r <= len; r += 0.5) {
            const wsail = 1 + Math.floor((r / len) * 3);
            for (let w = 1; w <= wsail; w++) {
                ctx.fillStyle = cloth;
                ctx.fillRect(Math.round(cx + dx * r + nx * w), Math.round(hubY + dy * r + ny * w), 1, 1);
            }
            if (Math.round(r) % 3 === 0) {   // perpendicular lattice slat
                for (let w = 1; w <= wsail; w++) { ctx.fillStyle = shade(cloth, 0.82); ctx.fillRect(Math.round(cx + dx * r + nx * w), Math.round(hubY + dy * r + ny * w), 1, 1); }
            }
        }
        ctx.fillStyle = '#fffdf6'; ctx.fillRect(Math.round(cx + dx * len), Math.round(hubY + dy * len), 1, 1);   // bright tip
    }
    // hub cap over the sail roots
    ctx.fillStyle = W[0]; ctx.fillRect(cx - 2, hubY - 2, 4, 4);
    ctx.fillStyle = shade(W[2], 1.1); ctx.fillRect(cx - 2, hubY - 2, 2, 1);
    ctx.fillStyle = '#2a2620'; ctx.fillRect(cx - 1, hubY - 1, 2, 2);
    return c;
}

// The lightning-ward TOWER — a tapered ashlar obelisk with a carved rune band, a
// battlemented crown, a steel rod and a glowing amber orb finial (soft halo). A
// town-plaza landmark. Exemplar: Chrono Trigger / Terranigma stonework. (§2, §1b)
export function makeTower() {
    const [c, ctx] = makeCanvas(28, 56);
    const S = RAMPS.STONE, W = RAMPS.WOOD, G = RAMPS.GRAIN, OL = RAMPS.OUTLINE.warm;
    const cx = 14;
    groundShadow(ctx, 14, 53, 11, 4, 0.3);
    // tapered stone obelisk
    ashlarBody(ctx, cx, 16, 54, 5, 8, S, OL);
    // battlemented crown (crenellations) over the top course
    ctx.fillStyle = OL; ctx.fillRect(cx - 6, 13, 12, 4);
    ctx.fillStyle = S[3]; ctx.fillRect(cx - 5, 14, 10, 3);
    ctx.fillStyle = shade(S[4], 1.1); ctx.fillRect(cx - 5, 14, 10, 1);        // lit merlon tops
    ctx.fillStyle = S[1]; ctx.fillRect(cx - 3, 14, 2, 2); ctx.fillRect(cx + 1, 14, 2, 2);   // crenel gaps (shadowed)
    // carved rune band mid-shaft — a recessed groove with lit glyph flecks
    ctx.fillStyle = shade(S[0], 0.95); ctx.fillRect(cx - 6, 32, 12, 3);
    ctx.fillStyle = shade(S[4], 1.15); ctx.fillRect(cx - 6, 32, 12, 1);       // lit top lip of the groove
    ctx.fillStyle = G[4]; ctx.fillRect(cx - 4, 33, 1, 1); ctx.fillRect(cx - 1, 33, 1, 1); ctx.fillRect(cx + 3, 33, 1, 1);   // glyph glints
    // arched ward-door recess at the base
    ctx.fillStyle = S[4]; ctx.fillRect(cx - 3, 44, 6, 1);
    recess(ctx, cx - 2, 45, 4, 9, '#161310', S[0]);
    // steel rod up to the finial
    ctx.fillStyle = OL; ctx.fillRect(cx - 1, 4, 3, 10);
    ctx.fillStyle = S[4]; ctx.fillRect(cx - 1, 4, 1, 10);                     // lit rod edge
    ctx.fillStyle = S[1]; ctx.fillRect(cx + 1, 4, 1, 10);                     // shaded rod edge
    // glowing amber orb — soft translucent halo (2 layers) then the solid bead + glint
    ctx.fillStyle = 'rgba(240,200,80,0.16)'; ctx.fillRect(cx - 5, 0, 12, 10);
    ctx.fillStyle = 'rgba(248,214,110,0.28)'; ctx.fillRect(cx - 3, 0, 8, 7);
    ctx.fillStyle = G[3]; ctx.fillRect(cx - 3, 1, 6, 5); ctx.fillRect(cx - 2, 0, 4, 7);   // orb body
    ctx.fillStyle = G[5]; ctx.fillRect(cx - 2, 1, 3, 2);                      // hot core
    ctx.fillStyle = '#fffdf6'; ctx.fillRect(cx - 2, 1, 1, 1);                 // spec glint
    ctx.fillStyle = shade(G[2], 0.9); ctx.fillRect(cx - 2, 5, 4, 1);          // orb underside
    return c;
}

// The most-drawn sprite in the game (hundreds per screen) — so it's pure ramp + form,
// no detail: 4-shade WOOD ramp, sunlit-left / shadow-right, a top-cap highlight, and a
// 1px ground-contact AO. Light upper-left, consistent with every building. (§1b, §4)
export function makeFencePost() {
    const [c, ctx] = makeCanvas(4, 10);
    const W = RAMPS.WOOD, OL = RAMPS.OUTLINE.brown;
    ctx.fillStyle = W[2]; ctx.fillRect(1, 1, 2, 8);              // post body
    ctx.fillStyle = W[3]; ctx.fillRect(1, 1, 1, 8);             // sunlit left edge
    ctx.fillStyle = W[1]; ctx.fillRect(2, 1, 1, 8);             // shadow right edge
    ctx.fillStyle = W[4]; ctx.fillRect(1, 0, 2, 1);             // top-cap highlight (sun on the cut top)
    ctx.fillStyle = shade(W[3], 1.12); ctx.fillRect(1, 0, 1, 1); // brightest top-left nub
    ctx.fillStyle = shade(W[1], 0.85); ctx.fillRect(2, 4, 1, 1); // grain knot on the shadow side
    ctx.fillStyle = OL; ctx.fillRect(1, 9, 2, 1);              // ground-contact AO
    return c;
}

// ---------------------------------------------------------------------------
// Facilities: pond life + animals + their buildings
// ---------------------------------------------------------------------------

export function makeLilyPad(bloom) {
    const [c, ctx] = makeCanvas(14, 12);
    const F = RAMPS.FOLIAGE;
    // water-contact shadow — a dark translucent ring so the pad sits IN the water, not on it
    ctx.fillStyle = 'rgba(18,40,52,0.42)';
    ctx.fillRect(1, 7, 12, 1); ctx.fillRect(2, 8, 10, 2); ctx.fillRect(3, 10, 8, 1);
    // pad disc — FOLIAGE ramp, lit upper-left, shaded underside crescent
    ctx.fillStyle = F[2]; ctx.fillRect(2, 3, 10, 5); ctx.fillRect(1, 4, 12, 3);   // dark silhouette
    ctx.fillStyle = F[4]; ctx.fillRect(3, 3, 8, 4); ctx.fillRect(2, 4, 10, 2);    // mid body
    ctx.fillStyle = F[5]; ctx.fillRect(3, 3, 6, 1); ctx.fillRect(2, 4, 4, 1);     // sunlit upper-left
    ctx.fillStyle = F[6]; ctx.fillRect(3, 3, 3, 1);                               // spec highlight
    ctx.fillStyle = F[0]; ctx.fillRect(1, 6, 12, 1);                              // shaded underside crescent
    ctx.fillStyle = shade(F[2], 0.7); ctx.fillRect(6, 3, 1, 5);                   // center V-notch seam
    if (bloom) {
        ctx.fillStyle = '#f0e0ec'; ctx.fillRect(6, 1, 2, 2);                      // white/pink flower
        ctx.fillStyle = '#e880a8'; ctx.fillRect(5, 2, 1, 1); ctx.fillRect(8, 2, 1, 1); ctx.fillRect(6, 0, 2, 1);
        ctx.fillStyle = '#f0d040'; ctx.fillRect(6, 2, 2, 1);                      // pollen centre
        ctx.fillStyle = '#fffdf6'; ctx.fillRect(6, 1, 1, 1);                      // petal glint
    }
    return c;
}

export function makeFish(frame) {
    const [c, ctx] = makeCanvas(8, 5);
    const body = '#e08040', dark = shade(body, 0.74), light = '#f4b070', spec = '#fff0dc';
    // water-contact shadow so the koi sits under the surface (keeps its ~0.85 draw alpha in-game)
    ctx.fillStyle = 'rgba(18,40,52,0.4)'; ctx.fillRect(2, 4, 4, 1);
    ctx.fillStyle = body; ctx.fillRect(1, 1, 5, 3); ctx.fillRect(2, 0, 3, 1);   // body
    ctx.fillStyle = light; ctx.fillRect(2, 1, 3, 1);        // sunlit back
    ctx.fillStyle = dark;  ctx.fillRect(1, 3, 5, 1);        // shaded belly
    ctx.fillStyle = '#f6ece0'; ctx.fillRect(3, 2, 1, 1);    // koi white patch
    ctx.fillStyle = spec;  ctx.fillRect(4, 1, 1, 1);        // spec glint on the back
    // tail flicks (frame)
    ctx.fillStyle = body;
    if (frame) { ctx.fillRect(6, 0, 2, 2); ctx.fillRect(6, 3, 2, 1); }
    else { ctx.fillRect(6, 1, 2, 1); ctx.fillRect(6, 0, 2, 1); ctx.fillRect(6, 3, 2, 1); }
    ctx.fillStyle = dark; ctx.fillRect(6, frame ? 1 : 2, 1, 1);   // tail-root shade
    ctx.fillStyle = '#20242c'; ctx.fillRect(2, 1, 1, 1);          // eye
    return c;
}

// Shared quadruped body: rounded barrel + 3/4-lit shading + a 2-frame walk.
// The near legs (frame arg) swing opposite the far legs so the stride reads.
function drawQuadruped(ctx, o, frame) {
    const body = o.body;
    const dark = o.dark;
    const light = o.light;
    const legCol = o.legCol;
    const hoof = o.hoof;
    const face = o.face || body;
    const faceDark = shade(face, 0.8);
    const farLeg = shade(dark, 0.86);

    // Leg stride: [x, top, w, h]. far pair drawn behind (darker), near in front.
    const legs = frame === 0
        ? { far: [[4, 8, 1, 2], [8, 8, 1, 3]], near: [[3, 8, 1, 3], [9, 8, 1, 2]] }
        : { far: [[3, 8, 1, 3], [9, 8, 1, 2]], near: [[4, 8, 1, 2], [8, 8, 1, 3]] };

    // far legs first (behind the body)
    for (const [x, y, w, h] of legs.far) {
        px(ctx, x, y, w, h, farLeg);
        px(ctx, x, y + h - 1, w, 1, hoof);
    }

    // barrel body ------------------------------------------------------------
    px(ctx, 2, 4, 9, 4, body);        // main mass
    px(ctx, 3, 3, 6, 1, body);        // rounded back
    px(ctx, 3, 3, 5, 1, light);       // sunlit spine highlight
    px(ctx, 2, 7, 9, 1, dark);        // belly / underside shade
    px(ctx, 2, 4, 1, 3, dark);        // shaded rump edge (rear-left)
    px(ctx, 10, 4, 1, 3, shade(body, 0.9)); // shoulder seam into neck

    if (o.woolly) {
        // cloud-bump wool along the top & rump for a fleecy silhouette
        for (const [x, y] of [[2, 3], [4, 2], [6, 3], [8, 2], [2, 4], [3, 7], [6, 8]]) {
            px(ctx, x, y, 1, 1, x % 2 ? body : light);
        }
        px(ctx, 1, 5, 1, 2, body);    // fluffy rump tuft
        px(ctx, 1, 4, 1, 1, light);
    }

    // head + muzzle ----------------------------------------------------------
    px(ctx, 9, 3, 4, 4, face);        // head block
    px(ctx, 10, 2, 2, 1, face);       // crown
    px(ctx, 9, 6, 4, 1, faceDark);    // jaw shadow
    px(ctx, 12, 4, 1, 2, face);       // muzzle pushed forward
    px(ctx, 12, 3, 1, 1, shade(face, 1.1)); // nose-bridge glint

    // near legs on top -------------------------------------------------------
    for (const [x, y, w, h] of legs.near) {
        px(ctx, x, y, w, h, legCol);
        px(ctx, x, y + h - 1, w, 1, hoof);
    }

    // eye
    px(ctx, 11, 4, 1, 1, o.eye || '#20242c');
}

// Cow — cream Holstein with dark patches, stubby horns, pink muzzle.
export function makeCow(frame) {
    const [c, ctx] = makeCanvas(14, 11);
    const patch = '#4a4038';
    drawQuadruped(ctx, {
        body: '#f4f0e8', dark: '#cdbfa8', light: '#ffffff',
        legCol: '#d8cdbb', hoof: '#3a332c',
    }, frame);
    // dark hide patches
    px(ctx, 3, 4, 3, 2, patch);
    px(ctx, 4, 3, 1, 1, patch);
    px(ctx, 7, 5, 2, 2, patch);
    // stubby horns + tufted ear
    px(ctx, 10, 1, 1, 1, '#efe7d2'); px(ctx, 11, 1, 1, 1, '#d8cdb8');
    px(ctx, 9, 2, 1, 1, '#cdbfa8'); // ear
    // pink muzzle + nostril
    px(ctx, 12, 5, 1, 1, '#e79aa0');
    px(ctx, 13, 4, 1, 2, '#e79aa0');
    px(ctx, 13, 5, 1, 1, '#b26e74');
    // pink udder
    px(ctx, 6, 7, 1, 1, '#e79aa0');
    // tail with dark switch
    px(ctx, 1, 4, 1, 3, '#cdbfa8'); px(ctx, 1, 7, 1, 2, '#4a4038');
    return c;
}

// Pig — round pink body, snout with nostrils, floppy ear, curly tail.
export function makePig(frame) {
    const [c, ctx] = makeCanvas(14, 11);
    drawQuadruped(ctx, {
        body: '#eb9fab', dark: '#cd7f8b', light: '#f6c2ca',
        legCol: '#cd7f8b', hoof: '#8a5560', eye: '#20242c',
    }, frame);
    // snout disc pushed forward with two nostrils
    px(ctx, 13, 4, 1, 2, '#e58c99');
    px(ctx, 13, 4, 1, 1, '#a5636e');
    px(ctx, 12, 4, 1, 1, '#f6c2ca'); // snout highlight
    // floppy ear over the brow
    px(ctx, 10, 2, 2, 2, '#cd7f8b');
    px(ctx, 11, 4, 1, 1, '#b26e79');
    // curly tail (little corkscrew at the rear)
    px(ctx, 1, 4, 1, 1, '#eb9fab');
    px(ctx, 0, 5, 1, 1, '#cd7f8b');
    px(ctx, 1, 6, 1, 1, '#eb9fab');
    return c;
}

// Goat — pale tan body, back-swept horns, chin beard, perky ear.
export function makeGoat(frame) {
    const [c, ctx] = makeCanvas(14, 11);
    drawQuadruped(ctx, {
        body: '#ded8ca', dark: '#b3ab98', light: '#f2eee2',
        legCol: '#b3ab98', hoof: '#4a4238',
    }, frame);
    // back-swept horns rising off the crown
    px(ctx, 10, 1, 1, 1, '#7a7060');
    px(ctx, 9, 0, 1, 1, '#8a8070');
    px(ctx, 11, 1, 1, 1, '#7a7060');
    // perky ear
    px(ctx, 9, 3, 1, 1, '#b3ab98');
    // chin beard
    px(ctx, 11, 7, 1, 2, '#f2eee2');
    px(ctx, 11, 8, 1, 1, '#cfc9ba');
    // dark muzzle tip
    px(ctx, 13, 5, 1, 1, '#8a8070');
    // short upright tail
    px(ctx, 1, 3, 1, 2, '#ded8ca');
    return c;
}

// Sheep — NEW. Fleecy cream body with a dark face + legs, fluffy tail.
export function makeSheep(frame) {
    const [c, ctx] = makeCanvas(14, 11);
    drawQuadruped(ctx, {
        body: '#f0eadc', dark: '#d2cbb8', light: '#ffffff',
        legCol: '#55493d', hoof: '#2e2620',
        face: '#6f6455', eye: '#0e1014', woolly: true,
    }, frame);
    // little dark ear off the woolly face
    px(ctx, 9, 3, 1, 1, '#574d40');
    // white glint on the dark eye so it reads
    px(ctx, 11, 3, 1, 1, '#efe9db');
    // pale muzzle tip
    px(ctx, 13, 5, 1, 1, '#a89a86');
    return c;
}

// Chicken — polished 9x9 hen: plump white body, wing, tail, comb + wattle.
export function makeChicken(frame) {
    const [c, ctx] = makeCanvas(9, 9);
    const body = '#f6f2ea', dark = '#ddd6c8', light = '#ffffff';
    // tail feathers (rear-left, angled up)
    px(ctx, 0, 2, 2, 3, body);
    px(ctx, 0, 4, 2, 1, dark);
    px(ctx, 0, 2, 1, 1, light);
    // plump body
    px(ctx, 2, 3, 5, 4, body);
    px(ctx, 3, 2, 3, 1, body);        // rounded back
    px(ctx, 3, 2, 2, 1, light);       // spine highlight
    px(ctx, 2, 6, 5, 1, dark);        // belly shade
    // folded wing
    px(ctx, 3, 4, 3, 2, dark);
    px(ctx, 3, 4, 3, 1, '#e9e2d4');
    // head
    px(ctx, 5, 1, 3, 3, body);
    px(ctx, 5, 1, 3, 1, light);
    // red comb + wattle
    px(ctx, 6, 0, 2, 1, '#e0483c');
    px(ctx, 5, 0, 1, 1, '#c73a30');
    px(ctx, 6, 4, 1, 1, '#e0483c');   // wattle under the beak
    // beak
    px(ctx, 8, 2, 1, 1, '#f0a030');
    px(ctx, 8, 3, 1, 1, '#cf7f1e');
    // eye
    px(ctx, 6, 2, 1, 1, '#20242c');
    // orange legs with a 2-frame step
    const legs = frame === 0 ? [[3, 7, 2], [5, 7, 2]] : [[4, 7, 2], [6, 7, 2]];
    for (const [x, y, h] of legs) {
        px(ctx, x, y, 1, h, '#e08820');
        px(ctx, x, y + h - 1, 1, 1, '#b8641a'); // foot
    }
    return c;
}

// Front-elevation billboard WALL. Depth stack (light upper-left): base, weathered
// boards, a TWO-step shaded right face (form self-shadow), a bright sunlit left edge,
// plank seams (shadow + lit edge), an eave-AO band along the top (roof-overhang shadow
// on the wall) and a ground-contact AO row. cols = { base, hi, lo, ol }. (§1b, §3, §4)
function drawWall(ctx, x0, x1, y0, y1, cols, seamStep) {
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    ctx.fillStyle = cols.ol;   ctx.fillRect(x0 - 1, y0, w + 2, h + 1);       // silhouette outline (sides + base)
    ctx.fillStyle = cols.base; ctx.fillRect(x0, y0, w, h);
    // weathered boards: a couple of subtly off-tone planks + a knot each (deterministic)
    if (seamStep) {
        let bi = 0;
        for (let x = x0 + 3; x < x1 - 6; x += seamStep) {
            if (bi % 3 === 1) { ctx.fillStyle = shade(cols.base, 0.93); ctx.fillRect(x, y0 + 2, Math.min(seamStep - 1, x1 - 6 - x), h - 4); }
            if (bi % 4 === 2) { ctx.fillStyle = shade(cols.lo, 0.72); ctx.fillRect(x + 1, y0 + Math.floor(h * 0.55), 1, 1); }   // knot
            bi++;
        }
    }
    // two-step shaded RIGHT face — reads as a solid turning form, not a flat panel
    ctx.fillStyle = cols.lo;              ctx.fillRect(x1 - 5, y0, 6, h);
    ctx.fillStyle = shade(cols.lo, 0.84); ctx.fillRect(x1 - 1, y0, 2, h);
    // sunlit LEFT column + bright edge
    ctx.fillStyle = cols.hi;              ctx.fillRect(x0, y0, 3, h);
    ctx.fillStyle = shade(cols.hi, 1.08); ctx.fillRect(x0, y0, 1, h);
    // plank seams: shadow groove + lit edge on the sunlit side of each board
    if (seamStep) {
        for (let x = x0 + seamStep; x < x1 - 2; x += seamStep) {
            ctx.fillStyle = shade(cols.lo, 0.8);  ctx.fillRect(x, y0 + 1, 1, h - 2);
            ctx.fillStyle = shade(cols.hi, 1.05); ctx.fillRect(x + 1, y0 + 1, 1, h - 2);
        }
    }
    ctx.fillStyle = shade(cols.lo, 0.7);  ctx.fillRect(x0, y0, w, 1);        // eave AO band (overhang shadow)
    ctx.fillStyle = shade(cols.ol, 0.88); ctx.fillRect(x0, y1, w, 1);        // ground-contact AO
}

// Pitched/gambrel ROOF as stepped rows. halfAt(y) -> half-width at row y (gambrel = a
// custom profile). Depth: a fully lit LEFT slope + shaded RIGHT slope (committed UL
// light), a bright ridge-left edge + dark eave-right edge, a neutral crown, shingle
// COURSE lines every 2nd row (varied light/shadow so rows don't repeat), a ridge
// highlight, and an eave-underside shadow along the overhang. No arc/stroke. (§1b, §4)
function drawRoof(ctx, cx, yTop, yBot, halfAt, cols) {
    const rows = [];
    for (let y = yTop; y <= yBot; y++) rows.push([y, Math.max(1, Math.round(halfAt(y)))]);
    ctx.fillStyle = cols.ol;
    for (const [y, half] of rows) ctx.fillRect(cx - half - 1, y, (half + 1) * 2, 1);   // side silhouette
    ctx.fillRect(cx - rows[0][1] - 1, yTop - 1, (rows[0][1] + 1) * 2, 1);              // ridge cap
    const rowF = [1.0, 1.06, 0.95, 1.02, 0.97];   // per-course tone jitter so no two shingle rows repeat
    for (let k = 0; k < rows.length; k++) {
        const [y, half] = rows[k];
        const rf = rowF[k % rowF.length];
        ctx.fillStyle = shade(cols.base, rf); ctx.fillRect(cx - half, y, half * 2, 1);
        ctx.fillStyle = shade(cols.hi, rf);   ctx.fillRect(cx - half, y, half, 1);         // lit left slope (varied)
        ctx.fillStyle = shade(cols.hi, 1.12); ctx.fillRect(cx - half, y, 2, 1);            // bright ridge-left edge
        ctx.fillStyle = shade(cols.lo, rf);   ctx.fillRect(cx, y, half, 1);                // shaded right slope (varied)
        ctx.fillStyle = shade(cols.lo, 0.82); ctx.fillRect(cx + half - 2, y, 2, 1);        // dark eave-right edge
        ctx.fillStyle = shade(cols.base, rf); ctx.fillRect(cx - 1, y, 2, 1);               // crown ridge
        if (k % 2 === 1) {                                                                 // shingle course line
            ctx.fillStyle = shade(cols.lo, 0.8);  ctx.fillRect(cx + 1, y, half - 1, 1);
            ctx.fillStyle = shade(cols.hi, 0.98); ctx.fillRect(cx - half + 2, y, half - 2, 1);   // lit-edge highlight on the course
        }
    }
    ctx.fillStyle = shade(cols.hi, 1.1); ctx.fillRect(cx - rows[0][1], yTop, rows[0][1] * 2, 1);   // ridge highlight
    const last = rows[rows.length - 1];
    ctx.fillStyle = shade(cols.lo, 0.72); ctx.fillRect(cx - last[1], last[0], last[1] * 2, 1);     // eave-underside shadow
}

// The chicken run — warm plank body + red pitched roof, chicken door + ramp, coop
// window + nest box. ~46px tall (§2 farm-building class). Exemplar: Harvest Moon coop.
export function makeCoop() {
    const [c, ctx] = makeCanvas(54, 52);
    const P = RAMPS.PLANK, R = RAMPS.ROOF_RED, W = RAMPS.WOOD, G = RAMPS.GRAIN, OL = RAMPS.OUTLINE.brown;
    groundShadow(ctx, 27, 49, 23, 5, 0.3);
    const bx0 = 10, bx1 = 44, wy0 = 24, wy1 = 46;
    // weathered plank walls + form self-shadow (via drawWall)
    drawWall(ctx, bx0, bx1, wy0, wy1, { base: P[2], hi: P[3], lo: P[1], ol: OL }, 6);
    // foundation sill with a lit top edge + ground AO
    ctx.fillStyle = W[1]; ctx.fillRect(bx0 - 1, wy1 - 2, bx1 - bx0 + 3, 2);
    ctx.fillStyle = shade(W[2], 1.1); ctx.fillRect(bx0 - 1, wy1 - 2, bx1 - bx0 + 3, 1);
    ctx.fillStyle = shade(OL, 0.85); ctx.fillRect(bx0 - 1, wy1 + 1, bx1 - bx0 + 3, 1);
    // roof
    drawRoof(ctx, 27, 6, 24, (y) => 4 + (y - 6) / 18 * 21, { base: R[3], hi: R[4], lo: R[2], ol: OL });
    // chicken door — recessed, with a roost bar inside + threshold AO
    recess(ctx, 23, 34, 9, 12, '#1c1510', OL);
    ctx.fillStyle = W[2]; ctx.fillRect(24, 40, 7, 1);                   // roost bar
    ctx.fillStyle = shade(W[1], 0.8); ctx.fillRect(24, 41, 7, 1);
    // warm slatted ramp
    ctx.fillStyle = G[3]; ctx.fillRect(21, 46, 13, 3);
    ctx.fillStyle = G[1]; ctx.fillRect(21, 48, 13, 1);
    ctx.fillStyle = shade(G[1], 0.8); ctx.fillRect(25, 46, 1, 3); ctx.fillRect(29, 46, 1, 3);   // slats
    ctx.fillStyle = shade(P[1], 0.7); ctx.fillRect(22, 46, 11, 1);      // door threshold AO
    // framed window with a mullion cross + glint + shadow-side pane
    ctx.fillStyle = OL; ctx.fillRect(34, 27, 9, 9);
    ctx.fillStyle = RAMPS.GLASS[1]; ctx.fillRect(35, 28, 7, 7);
    ctx.fillStyle = RAMPS.GLASS[2]; ctx.fillRect(35, 28, 3, 3);         // lit pane
    ctx.fillStyle = RAMPS.GLASS[0]; ctx.fillRect(39, 28, 3, 7);         // shadow-side pane
    ctx.fillStyle = OL; ctx.fillRect(38, 28, 1, 7); ctx.fillRect(35, 31, 7, 1);   // mullion cross
    ctx.fillStyle = shade(RAMPS.GLASS[2], 1.25); ctx.fillRect(36, 29, 1, 1);      // glint
    // nest box off the left wall — lit lid, lid-shadow line, nail glint, recessed hole
    ctx.fillStyle = OL; ctx.fillRect(6, 31, 6, 10);
    ctx.fillStyle = W[2]; ctx.fillRect(7, 32, 4, 8);
    ctx.fillStyle = W[3]; ctx.fillRect(7, 32, 4, 1);                   // lit lid
    ctx.fillStyle = shade(W[1], 0.8); ctx.fillRect(7, 34, 4, 1);       // lid shadow line
    ctx.fillStyle = '#1c1510'; ctx.fillRect(8, 36, 3, 3);             // nest hole
    ctx.fillStyle = shade(W[1], 0.5); ctx.fillRect(8, 38, 3, 1);      // hole base AO
    ctx.fillStyle = shade(W[3], 1.15); ctx.fillRect(10, 33, 1, 1);    // nail glint
    return c;
}

// Classic gambrel RED BARN — the town's biggest farm building; must not read smaller
// than the cottage. White cross-plank doors, hayloft, ridge cupola. ~58px tall.
// Exemplar: ALttP / Harvest Moon barns (warm→wine shingle planes). (§2 relative-order)
const _barn = {};
export function makeBarn(season = 'SUMMER') {
    if (_barn[season]) return _barn[season];
    const [c, ctx] = makeCanvas(76, 60);   // widened for the hay bay on the right
    const winter = season === 'WINTER', fall = season === 'FALL';
    const S = RAMPS.STONE, OL = RAMPS.OUTLINE.warm, GRN = RAMPS.GRAIN;
    const R = fall ? warmRamp(RAMPS.ROOF_RED, 16, 1.04, 1.06) : RAMPS.ROOF_RED;
    const W = fall ? warmRamp(RAMPS.WOOD, 12, 1.04, 1.05) : RAMPS.WOOD;
    const SNOW = { deep: '#ffffff', mid: '#eef4f4', thin: '#dbe8ec' };
    const trim = '#e8e0d0', trimLo = '#b9ae95', trimHi = '#fffdf6';
    // NO ground/seat shadow (§S.2) — a 28px-radius ellipse under a building reads as a smudge.
    const bx0 = 12, bx1 = 52, wy0 = 27, wy1 = 55;
    // ---- ROOF GEOMETRY (declared first: the WALL follows the roofline) ----
    // The wall used to be a plain rectangle from wy0, but the gable end is a CHEVRON, so
    // its eave sits higher at the centre than at the flanks — leaving a wedge of empty
    // canvas between roof and wall. The wall is now a pentagon whose top tracks the eave,
    // the same as the house and the coop.
    const CXLb = 31, CXRb = 32, BHALF = 24, BDEPTH = 25, KNEE = 0.44;   // deeper band: at 18 the roof read short against a tall barn wall
    const EXT_LEN = 15, EXT_PITCH = 0.12;                  // the HAY BAY: an open-sided lean-to
    const dOfB = (x) => (x <= CXLb ? CXLb - x : x - CXRb);
    // §S.2c the roof KINKS to a shallower pitch past the break rather than the bay having a
    // roof of its own: same band depth, so the rake, the eave and the courses carry through.
    const bTop = (d) => (d <= BHALF
        ? 8 + Math.floor(d * 0.38)
        : 8 + Math.floor(BHALF * 0.38) + Math.floor((d - BHALF) * EXT_PITCH));
    const bBot = (d) => bTop(d) + BDEPTH;
    const litLeftB = LIGHT.x < 0;
    const maxDB = (x) => (x > CXRb ? BHALF + EXT_LEN : BHALF);   // the bay is on the RIGHT flank
    const onRoofB = (x) => dOfB(x) <= maxDB(x);
    const bayX0 = bx1 + 1, bayX1 = CXRb + BHALF + EXT_LEN;       // open bay: no wall, posts + hay
    const OLroofB = outlineFor(R[1]);
    // ---- HAY BAY — an open-sided lean-to on the right: posts, stacked bales, no wall.
    // This is where the hayloft went. Buried in the facade it read as a dark smudge; as an
    // open bay under the continued roofline the bales are the feature. ----
    for (let x = bayX0; x <= bayX1; x++) {
        const yTop = bBot(dOfB(x)) + 1, h = 55 - yTop + 1;
        if (h <= 0) continue;
        ctx.fillStyle = 'rgba(0,0,0,0.30)'; ctx.fillRect(x, yTop, 1, h);          // the bay is in shade
    }
    { // STACKED BALES — three courses filling the bay, offset like real stacking, with a
      // hint of plank back-wall behind them so the bay reads as a shaded interior rather
      // than a black void.
      for (let x = bayX0 + 2; x <= bayX1 - 2; x++) {                              // back wall behind the stack
          const yTop = bBot(dOfB(x)) + 2;
          ctx.fillStyle = shade(R[1], 0.72); ctx.fillRect(x, yTop, 1, 55 - yTop);
          if ((x - bayX0) % 4 === 0) { ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fillRect(x, yTop, 1, 55 - yTop); }
      }
      const baleW = 8, baleH = 5;
      const bale = (bxp, by, w) => {
          if (bxp < bayX0 + 1 || bxp + w - 1 > bayX1) return;
          ctx.fillStyle = GRN[2]; ctx.fillRect(bxp, by, w, baleH);
          ctx.fillStyle = GRN[4]; ctx.fillRect(bxp, by, w, 1);                    // lit top
          ctx.fillStyle = GRN[1]; ctx.fillRect(bxp, by + baleH - 1, w, 1);        // shaded underside
          ctx.fillStyle = GRN[0]; ctx.fillRect(bxp + w - 1, by, 1, baleH);        // away edge
          for (const t of [2, w - 3]) { ctx.fillStyle = TEX_DARK; ctx.fillRect(bxp + t, by, 1, baleH); }   // twine
          for (let k = 1; k < w - 1; k += 3) { ctx.fillStyle = GRN[5]; ctx.fillRect(bxp + k, by + 1, 1, 1); }  // straw glints
          ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(bxp, by + baleH, w, 1);   // seats on the one below
      };
      // three courses: two full, then a part course on top so the stack has a silhouette
      bale(bayX0 + 1, 49, baleW); bale(bayX0 + 10, 49, baleW);                   // bottom course, full width
      bale(bayX0 + 2, 44, baleW); bale(bayX0 + 11, 44, baleW);                    // middle course, offset
      bale(bayX0 + 4, 39, baleW); bale(bayX0 + 13, 39, 6);                        // top course, part-stacked
      ctx.fillStyle = GRN[3];                                                     // loose straw spilling at the foot
      for (let k = 0; k < 10; k++) {
          const lx = bayX0 + 2 + k, h = hash2d(lx, 11) > 0.5 ? 2 : 1;
          if (lx > bayX1 - 1) break;
          ctx.fillRect(lx, 55 - h, 1, h);
      }
    }
    for (const px of [bayX0 + 1, bayX1 - 1]) {                                     // support posts
        const yTop = bBot(dOfB(px)) + 1;
        ctx.fillStyle = W[2]; ctx.fillRect(px, yTop, 2, 55 - yTop + 1);
        ctx.fillStyle = shade(W[3], 1.08); ctx.fillRect(px, yTop, 1, 55 - yTop + 1);
        ctx.fillStyle = TEX_DARK; ctx.fillRect(px + 1, yTop, 1, 55 - yTop + 1);
    }
    ctx.fillStyle = shade(OL, 0.9); ctx.fillRect(bayX0, 56, bayX1 - bayX0 + 1, 1); // bay ground line

    // ---- WALL — barn red, top following the eave ----
    for (let x = bx0; x <= bx1; x++) {
        const yTop = bBot(dOfB(x)) + 1, h = wy1 - yTop + 1;
        if (h <= 0) continue;
        let col = R[3];
        if (litLeftB ? x <= bx0 + 3 : x >= bx1 - 3) col = R[4];              // lit flank
        else if (litLeftB ? x >= bx1 - 7 : x <= bx0 + 7) col = R[2];         // shadow band
        if (litLeftB ? x >= bx1 - 1 : x <= bx0 + 1) col = R[1];              // side reveal
        ctx.fillStyle = col; ctx.fillRect(x, yTop, 1, h);
    }
    for (const sx of [18, 24, 42, 48]) {                                     // plank seams, proportional (§S.2)
        const yTop = bBot(dOfB(sx)) + 3, hgt = wy1 - 3 - yTop;
        if (hgt <= 0) continue;
        ctx.fillStyle = TEX_DARK;  ctx.fillRect(sx, yTop, 1, hgt);
        ctx.fillStyle = TEX_LIGHT; ctx.fillRect(sx + 1, yTop, 1, hgt);
    }
    ctx.fillStyle = OL;
    ctx.fillRect(bx0 - 1, bBot(dOfB(bx0)) + 1, 1, wy1 - bBot(dOfB(bx0)));
    ctx.fillRect(bx1 + 1, bBot(dOfB(bx1)) + 1, 1, wy1 - bBot(dOfB(bx1)));
    // stone foundation: course band with a lit top edge + ground AO
    ctx.fillStyle = S[1]; ctx.fillRect(bx0 - 1, wy1 - 2, bx1 - bx0 + 3, 2);
    ctx.fillStyle = shade(S[2], 1.1); ctx.fillRect(bx0 - 1, wy1 - 2, bx1 - bx0 + 3, 1);   // foundation top relief
    ctx.fillStyle = S[0]; ctx.fillRect(bx0 - 1, wy1 + 1, bx1 - bx0 + 3, 1);               // ground AO
    // ---- GAMBREL ROOF — the barn's signature two-pitch form, rebuilt on the shared
    // grammar (§S.2b/§S.2d). The KNEE is expressed as two sub-planes within one band:
    // the upper slope is shallower so it tips further skyward and reads BRIGHTER, the
    // lower slope is steeper and darker, with a lit crease where they meet.
    for (let x = 1; x <= 74; x++) {
        if (!onRoofB(x)) continue;
        const d = dOfB(x), t0 = bTop(d), b0 = bBot(d);
        const lit = (x <= CXLb) === litLeftB;
        let firstY = -1;
        for (let y = t0; y <= b0; y++) {
            if (d > maxDB(x) - overhangInset(y)) continue;
            const f = (y - t0) / Math.max(1, b0 - t0);
            const onBay = d > BHALF;
            const upper = f < KNEE;                                   // the gambrel's two planes
            // The committed lit-left / shadow-right split comes FIRST; the gambrel knee then
            // MODULATES within each side. Picking tones per sub-plane instead made the shadow
            // side's upper slope the same value as the lit side's lower slope, so the top half
            // of the right gable stopped reading as shadow at all.
            // THE BAY is near-flat, so it tips toward the SKY and reads BRIGHT whichever flank
            // it sits on — the same rule the house's flat wings follow (§S.2c). Basing it on
            // the shadow ramp (because it happens to be the right-hand side) made the bay roof
            // as dark as the gable's shadow slope, which is exactly what a flat plane is not.
            let col;
            if (onBay) col = EXT_PITCH <= 0.15 ? R[3] : R[2];
            else { col = lit ? R[3] : R[1]; if (!upper) col = shade(col, 0.86); }
            if (f < 0.10) col = shade(col, 1.08);
            else if (f > 0.86) col = shade(col, 0.86);
            const sh = shingleTile(col, x, y - t0, lit || onBay);
            // a RIGHT-hand extension runs AWAY from the sun, so it darkens outward (§S.2)
            const across = onBay ? Math.min(1, (d - BHALF) / EXT_LEN) : d / BHALF;
            col = roofLightPass(sh.col, sh.tcol, sh.rr, across, f,
                                { strokeA: (lit || onBay) ? 1.10 : 1.05, strokeB: (lit || onBay) ? 1.04 : 1.02,
                                  lift: onBay ? 1.06 : lit ? 1.05 : 1.0,
                                  fallX: onBay ? 0.14 : lit ? 0.08 : 0.05, fallY: 0.05 });
            const kneeY = t0 + Math.round((b0 - t0) * KNEE);
            if (!onBay && y === kneeY) col = shade(col, 1.14);        // lit crease at the gambrel's pitch break
            else if (!onBay && y === kneeY + 1) col = shade(col, 0.82);
            if (y === b0) col = lit ? shade(R[1], 0.8) : R[0];        // eave fascia
            if (firstY < 0) firstY = y;
            ctx.fillStyle = col; ctx.fillRect(x, y, 1, 1);
        }
        if (firstY >= 0) { ctx.fillStyle = OLroofB; ctx.fillRect(x, firstY - 1, 1, 1); }
    }
    const bRidge = bTop(0);
    // Ridge crease. At BDEPTH 25 the old shade(R[4],1.08) ran as a long BRIGHT pole down
    // the roof, and with the cupola sitting across it the lower half read as a stem
    // dangling from the box. Toned to a subtle ridge: it should mark the apex, not draw
    // the eye down the whole roof.
    ctx.fillStyle = shade(R[3], 1.05); ctx.fillRect(litLeftB ? CXLb : CXRb, bRidge, 1, BDEPTH);
    ctx.fillStyle = shade(R[1], 0.9);  ctx.fillRect(litLeftB ? CXRb : CXLb, bRidge, 1, BDEPTH + 1);
    ctx.fillStyle = OLroofB;           ctx.fillRect(CXLb, bRidge - 1, 2, 1);
    // graded soffit shadow where the eave overhangs the wall (§S.2c)
    for (let x = bx0; x <= bx1; x++) {
        const ey = bBot(dOfB(x)) + 1;
        ctx.fillStyle = 'rgba(0,0,0,0.30)'; ctx.fillRect(x, ey, 1, 1);
        ctx.fillStyle = 'rgba(0,0,0,0.16)'; ctx.fillRect(x, ey + 1, 1, 1);
    }
    // HOIST — the loft opening moved out to the hay bay, so the facade keeps only the
    // pulley beam and its block, which reads as the barn's working gear.
    { const hy = bBot(dOfB(31)) + 2;
      ctx.fillStyle = W[3]; ctx.fillRect(30, hy, 3, 3);
      ctx.fillStyle = shade(W[4], 1.08); ctx.fillRect(30, hy, 3, 1);
      ctx.fillStyle = '#2a2620'; ctx.fillRect(31, hy + 3, 1, 2);                  // rope
      ctx.fillStyle = W[1]; ctx.fillRect(30, hy + 5, 3, 2);                       // block
      ctx.fillStyle = TEX_DARK; ctx.fillRect(31, hy + 5, 1, 2); }
    // big white DOORS — recessed, framed planks, beveled X-braces, hinges, threshold AO
    // 1px left of centre: lines the doors up with the ridge crease (x31|32)
    const dx0 = 24, dx1 = 38, dy0 = 37, dy1 = 55, dw = dx1 - dx0, dh = dy1 - dy0;
    ctx.fillStyle = OL; ctx.fillRect(dx0 - 1, dy0 - 1, dw + 3, dh + 2);
    ctx.fillStyle = trim; ctx.fillRect(dx0, dy0, dw + 1, dh + 1);
    ctx.fillStyle = trimHi; ctx.fillRect(dx0, dy0, dw + 1, 1);                     // lit lintel
    ctx.fillStyle = trimLo; ctx.fillRect(dx0, dy1, dw + 1, 1);                     // shaded sill
    ctx.fillStyle = shade(trimLo, 0.85); ctx.fillRect(dx1 - 1, dy0, 2, dh + 1);    // right-door shadow face
    ctx.fillStyle = trimLo; for (let x = dx0 + 3; x < dx1; x += 4) ctx.fillRect(x, dy0 + 1, 1, dh - 1);   // plank seams
    ctx.fillStyle = shade(OL, 1.12); ctx.fillRect((dx0 + dx1) >> 1, dy0, 1, dh + 1);   // centre gap where doors meet
    // beveled X-braces (both diagonals): a shadow stroke with a lit top edge = raised timber
    for (let i = 0; i <= dw; i++) {
        const ya = dy0 + Math.round(i * dh / dw), yb = dy0 + Math.round((dw - i) * dh / dw);
        ctx.fillStyle = shade(trimLo, 0.8); ctx.fillRect(dx0 + i, ya, 1, 1); ctx.fillRect(dx0 + i, yb, 1, 1);
        ctx.fillStyle = trimHi;             ctx.fillRect(dx0 + i, ya - 1, 1, 1); ctx.fillRect(dx0 + i, yb - 1, 1, 1);
    }
    ctx.fillStyle = '#2a2620'; ctx.fillRect(dx0 + 1, dy0 + 3, 2, 1); ctx.fillRect(dx0 + 1, dy1 - 3, 2, 1);   // hinges
    ctx.fillStyle = shade(trimLo, 0.6); ctx.fillRect(dx0 - 1, dy1 + 1, dw + 3, 1);   // threshold ground AO

    // ---- SEASONS (§6b0) — the barn had none ----
    if (winter) {
        for (let x = 1; x <= 74; x++) {
            if (!onRoofB(x)) continue;
            const d = dOfB(x), lit = (x <= CXLb) === litLeftB;
            const bay = d > BHALF;
            snowCourses(ctx, x, bTop(d), bBot(d), { frac: bay ? 0.80 : lit ? 0.62 : 0.52, bright: bay || lit, tone: SNOW });
            eaveIcicles(ctx, x, bBot(d), SNOW);
        }
        ctx.fillStyle = SNOW.deep; ctx.fillRect(CXLb, bRidge, 2, 3);
        ctx.fillStyle = SNOW.mid;  ctx.fillRect(27, 8, 10, 1);                    // snow lying on the cap's top plane
        ctx.fillStyle = SNOW.deep; ctx.fillRect(30, 8, 5, 1);
    }
    if (fall) leafDrift(ctx, 1, 74, (x) => bTop(dOfB(x)), (x) => bBot(dOfB(x)), onRoofB);

    // ---- RIDGE CUPOLA — drawn LAST, after the season passes ----
    // A small CUBE per the SLYNYRD top-down reference: a LIGHT TOP PLANE over a DARK FRONT
    // FACE, the value gap doing the volume. Halved from the first cube, which was still
    // reading as a chest rather than a vent box.
    // ORDER MATTERS: the snow/leaf passes sweep every roof column, so with the cupola drawn
    // before them the weather landed ON TOP of it — snow and leaves floating over a vertical
    // face. Drawing it after the seasons, with its own snow cap, is the correct layering.
    { const cx0 = 29, cx1 = 34, topY = 15, midY = 17, botY = 21;
      const OLc = outlineFor(W[1]);
      ctx.fillStyle = OLc; ctx.fillRect(cx0 - 1, topY - 1, (cx1 - cx0) + 3, (botY - topY) + 3);
      for (let x = cx0; x <= cx1; x++) {                                             // TOP PLANE, tipped to the sky
          const t = (x - cx0) / (cx1 - cx0);
          for (let y = topY; y < midY; y++) { ctx.fillStyle = shade(W[4], 1.16 - t * 0.12); ctx.fillRect(x, y, 1, 1); }
      }
      ctx.fillStyle = shade(W[4], 1.22); ctx.fillRect(cx0, topY, (cx1 - cx0) + 1, 1);  // lit deck rim
      for (let x = cx0; x <= cx1; x++) {                                             // FRONT FACE, markedly darker
          const litC = (x <= ((cx0 + cx1) >> 1)) === (LIGHT.x < 0);
          for (let y = midY; y <= botY; y++) { ctx.fillStyle = litC ? W[1] : shade(W[0], 0.94); ctx.fillRect(x, y, 1, 1); }
      }
      ctx.fillStyle = 'rgba(0,0,0,0.34)'; ctx.fillRect(cx0, midY, (cx1 - cx0) + 1, 1);   // plane break in shadow
      ctx.fillStyle = '#241c18'; ctx.fillRect(cx0 + 2, midY + 1, 2, 2);                  // vent slot
      ctx.fillStyle = shade(W[3], 1.10); ctx.fillRect(cx0 + 2, midY + 1, 2, 1);          // lit lintel
      ctx.fillStyle = 'rgba(0,0,0,0.30)'; ctx.fillRect(cx0 - 1, botY + 1, (cx1 - cx0) + 3, 1);  // shadow on the roof
      if (winter) {                                                                  // its OWN cap, on the top plane only
          ctx.fillStyle = SNOW.mid;  ctx.fillRect(cx0, topY, (cx1 - cx0) + 1, 1);
          ctx.fillStyle = SNOW.deep; ctx.fillRect(cx0 + 1, topY, (cx1 - cx0) - 1, 1);
      }
    }

    _barn[season] = c;
    return c;
}

// #99b the Mill — a stone grinding house with a big millstone wheel on its face
// (grinds wheat -> grain). Cool-shifted stone courses; wheel rings are stepped
// fillRects (no arc/AA). ~52px tall. Exemplar: Chrono Trigger masonry. (§1b, §3.5)
const _mill = {};
export function makeMill(season = 'SUMMER') {
    if (_mill[season]) return _mill[season];
    // SHORTER body + a FLAT roof (the pitched cap read as a hat perched on a tall box),
    // and a real WATER WHEEL in place of the flat millstone disc.
    const [c, ctx] = makeCanvas(52, 52);
    const winter = season === 'WINTER', fall = season === 'FALL';
    const S = RAMPS.STONE, F = RAMPS.FOLIAGE, OL = RAMPS.OUTLINE.warm;
    const W = fall ? warmRamp(RAMPS.WOOD, 12, 1.04, 1.05) : RAMPS.WOOD;
    const R = fall ? warmRamp(RAMPS.ROOF_RED, 16, 1.04, 1.06) : RAMPS.ROOF_RED;
    const SNOW = { deep: '#ffffff', mid: '#eef4f4', thin: '#dbe8ec' };
    // NO ground/seat shadow (§S.2) — a prop-scale ellipse under a building reads as a smudge.

    const bx0 = 9, bx1 = 43, wy0 = 17, wy1 = 46, bw = bx1 - bx0 + 1, bh = wy1 - wy0 + 1;
    ctx.fillStyle = OL;   ctx.fillRect(bx0 - 1, wy0, bw + 2, bh + 1);
    ctx.fillStyle = S[2]; ctx.fillRect(bx0, wy0, bw, bh);
    // HAND-LAID ASHLAR (unchanged — the masonry was already to the bar): running-bond
    // blocks, tone by horizontal position, deterministic jitter, moss, bevel + mortar AO.
    const CH = 5, BW = 9;
    for (let ci = 0, y = wy0; y < wy1; y += CH, ci++) {
        const off = (ci % 2) * (BW >> 1), h2 = Math.min(CH, wy1 - y);
        for (let x = bx0 - off; x < bx1; x += BW) {
            const gx = Math.max(bx0, x), gxe = Math.min(bx1, x + BW - 1), w2 = gxe - gx + 1;
            if (w2 < 2) continue;
            const lf = (gx - bx0) / bw;
            let idx = lf < 0.34 ? 3 : lf > 0.66 ? 1 : 2;
            const hsh = ((gx * 73856093) ^ (y * 19349663)) >>> 0, jit = hsh % 5;
            if (jit === 0) idx = Math.min(4, idx + 1); else if (jit === 1) idx = Math.max(0, idx - 1);
            ctx.fillStyle = S[idx]; ctx.fillRect(gx, y, w2, h2);
            ctx.fillStyle = shade(S[idx], 1.14); ctx.fillRect(gx, y, w2, 1);
            ctx.fillStyle = shade(S[idx], 0.78); ctx.fillRect(gx, y + h2 - 1, w2, 1);
            // (moss flecks removed — saturated green on grey read as stray pixels, most
            // obviously around the wheel. Lichen belongs on relics, not a working mill.)
        }
    }
    ctx.fillStyle = S[0];
    for (let ci = 0, y = wy0; y < wy1; y += CH, ci++) {
        const off = (ci % 2) * (BW >> 1);
        for (let x = bx0 - off + BW; x < bx1; x += BW) if (x > bx0 && x < bx1) ctx.fillRect(x - 1, y, 1, Math.min(CH, wy1 - y));
    }
    ctx.fillStyle = 'rgba(20,26,34,0.24)'; ctx.fillRect(bx1 - 10, wy0, 11, bh);   // right-face form wash
    ctx.fillStyle = shade(S[4], 1.14);     ctx.fillRect(bx0, wy0, 1, bh);         // sunlit left edge
    ctx.fillStyle = shade(OL, 0.9);        ctx.fillRect(bx0 - 1, wy1 + 1, bw + 2, 1);   // base outline

    // ---- FLAT ROOF — a top plane seen from above (§S.2b/§S.2c): the flattest plane tips
    // toward the sky, so it is the BRIGHTEST surface, and it overhangs the body 3px/side.
    const rx0 = 6, rx1 = 46, rTop = 3, rBot = 16;   // centred on the body (9..43): 3px overhang BOTH sides
    for (let x = rx0; x <= rx1; x++) {
        const edge = Math.min(x - rx0, rx1 - x);
        if (edge < overhangInset(x)) continue;                    // §S.2d scalloped ends only
        let firstY = -1;
        for (let y = rTop; y <= rBot; y++) {
            let col = R[3];
            const f = (y - rTop) / (rBot - rTop);
            if (f < 0.12) col = shade(col, 1.08);
            else if (f > 0.85) col = shade(col, 0.88);
            const sh = shingleTile(col, x, y - rTop, true);
            col = roofLightPass(sh.col, sh.tcol, sh.rr, (x - rx0) / (rx1 - rx0), f,
                                { strokeA: 1.12, strokeB: 1.05, lift: 1.04, fallX: 0.08, fallY: 0.06 });
            if (y === rBot) col = shade(R[1], 0.8);               // dark fascia along the front edge
            if (firstY < 0) firstY = y;
            ctx.fillStyle = col; ctx.fillRect(x, y, 1, 1);
        }
        if (firstY >= 0) { ctx.fillStyle = outlineFor(R[1]); ctx.fillRect(x, firstY - 1, 1, 1); }
    }
    // graded soffit drop shadow — the roof overhangs, so what sits under it is in shadow
    ctx.fillStyle = 'rgba(0,0,0,0.34)'; ctx.fillRect(bx0, rBot + 1, bw, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.20)'; ctx.fillRect(bx0, rBot + 2, bw, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.10)'; ctx.fillRect(bx0, rBot + 3, bw, 1);
    // roof vent
    ctx.fillStyle = W[0]; ctx.fillRect(16, 7, 4, 4);
    ctx.fillStyle = shade(W[2], 1.10); ctx.fillRect(16, 7, 4, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.20)'; ctx.fillRect(16, 11, 4, 1);

    // ---- WATER WHEEL — the mill's signature. The old millstone was a flat grey disc that
    // read as a decal; a spoked wheel with paddles round the rim reads as machinery.
    const wcx = 31, wcy = 31, wr = 10;
    // CAST SHADOW FIRST, offset into the away quadrant (LIGHT.awayX/Y) so the wheel reads
    // as standing PROUD of the wall rather than painted onto it.
    // Offset only 1px: the wheel is mounted flush against the wall, not standing off it.
    // At 2px the shadow separated from the rim and read as a second wheel behind the first.
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    for (let dy = -wr; dy <= wr; dy++) {
        const half = Math.round(Math.sqrt(Math.max(0, wr * wr - dy * dy)));
        if (half < 1) continue;
        const sy = wcy + dy + LIGHT.awayY;
        if (sy < wy0 || sy > wy1) continue;
        const sx0 = Math.max(bx0, wcx - half + LIGHT.awayX);
        const sx1 = Math.min(bx1, wcx + half + LIGHT.awayX);
        if (sx1 >= sx0) ctx.fillRect(sx0, sy, sx1 - sx0 + 1, 1);
    }
    const Lx = LIGHT.x, Ly = LIGHT.y, Ln = Math.hypot(Lx, Ly) || 1;
    for (let dy = -wr; dy <= wr; dy++) {
        for (let dx = -wr; dx <= wr; dx++) {
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > wr) continue;
            let col = null;
            if (dist >= wr - 1.6) col = W[2];                                     // outer rim
            else if (dist >= wr - 4.2) {                                          // PADDLE band
                const seg = Math.floor((Math.atan2(dy, dx) + Math.PI) / (Math.PI * 2) * 12);
                col = (seg % 2) ? W[1] : W[3];
            } else if (dist >= 4.2 && dist < 5.4) col = W[2];                     // inner rim
            else if (dist < 1.8) col = W[0];                                      // hub
            if (!col) continue;
            // §S.1.4 shade off the ONE light via the surface normal — not a hardcoded diagonal
            const dot = ((dx / wr) * Lx + (dy / wr) * Ly) / Ln;                   // >0 faces the light
            if (dot > 0.42) col = shade(col, 1.16);
            else if (dot > 0.14) col = shade(col, 1.06);
            else if (dot < -0.42) col = shade(col, 0.80);
            else if (dot < -0.14) col = shade(col, 0.90);
            if (dist >= wr - 1.6 && dot < -0.6) col = shade(col, 0.86);           // rim's away arc reads darkest
            ctx.fillStyle = col; ctx.fillRect(wcx + dx, wcy + dy, 1, 1);
        }
    }
    for (let a = 0; a < 8; a++) {                                                 // spokes, lit per the same law
        const th = a * Math.PI / 4;
        for (let r = 2; r <= 5.4; r += 0.4) {
            const ux = Math.cos(th), uy = Math.sin(th);
            const px = Math.round(wcx + ux * r), py = Math.round(wcy + uy * r);
            const dot = (ux * Lx + uy * Ly) / Ln;
            ctx.fillStyle = dot > 0.2 ? shade(W[2], 1.12) : dot < -0.2 ? shade(W[1], 0.86) : W[1];
            ctx.fillRect(px, py, 1, 1);
        }
    }
    ctx.fillStyle = shade(W[4], 1.18); ctx.fillRect(wcx - 1, wcy - 1, 1, 1);      // hub glint, toward the light

    // ---- DOOR — reaches the ground (§S.2) ----
    { const dx = 12, dyT = 34;
      ctx.fillStyle = S[4]; ctx.fillRect(dx - 1, dyT - 1, 9, 1);                  // lintel stone
      ctx.fillStyle = OL; ctx.fillRect(dx - 1, dyT, 9, wy1 - dyT + 1);
      ctx.fillStyle = W[1]; ctx.fillRect(dx, dyT + 1, 7, wy1 - dyT);
      ctx.fillStyle = shade(W[2], 1.08); ctx.fillRect(dx, dyT + 1, 1, wy1 - dyT);
      ctx.fillStyle = TEX_DARK; ctx.fillRect(dx + 3, dyT + 1, 1, wy1 - dyT);
      ctx.fillStyle = '#2a2620'; ctx.fillRect(dx + 5, dyT + 7, 1, 1);             // handle
      ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(dx, wy1, 7, 1);            // contact
    }
    // ---- upper window ----
    ctx.fillStyle = S[4]; ctx.fillRect(13, 20, 8, 1);
    recess(ctx, 14, 21, 6, 6, '#161a20', S[0]);
    ctx.fillStyle = RAMPS.GLASS[1]; ctx.fillRect(15, 22, 4, 4);
    ctx.fillStyle = RAMPS.GLASS[2]; ctx.fillRect(15, 22, 2, 2);
    ctx.fillStyle = shade(RAMPS.GLASS[2], 1.25); ctx.fillRect(15, 22, 1, 1);

    // ---- SEASONS (§6b0) ----
    if (winter) {
        for (let x = rx0; x <= rx1; x++) {
            const edge = Math.min(x - rx0, rx1 - x);
            if (edge < overhangInset(x)) continue;
            snowCourses(ctx, x, rTop, rBot, { frac: 0.55, bright: true, tone: SNOW });   // a flat roof holds a lot, but 0.86 + the small-band size boost exceeded FULL coverage and collapsed the banding into a slab
            eaveIcicles(ctx, x, rBot, SNOW);
        }
        ctx.fillStyle = SNOW.mid; ctx.fillRect(13, 19, 8, 1);                     // ledge snow on the lintel
    }
    if (fall) leafDrift(ctx, rx0, rx1, () => rTop, () => rBot, (x) => x >= rx0 && x <= rx1);

    _mill[season] = c;
    return c;
}

// #100 the Hatch House — a warm brooder hut with a straw nest + eggs in the doorway
// and a warming chimney. ~44px tall. Warm plank walls (GRAIN/PLANK), red roof. (§1b)
export function makeHatchery() {
    const [c, ctx] = makeCanvas(48, 48);
    const P = RAMPS.PLANK, R = RAMPS.ROOF_RED, G = RAMPS.GRAIN, W = RAMPS.WOOD, OL = RAMPS.OUTLINE.brown;
    const brick = '#9a5a44';
    groundShadow(ctx, 24, 45, 20, 5, 0.3);
    const bx0 = 8, bx1 = 40, wy0 = 18, wy1 = 44;
    // weathered plank walls + form self-shadow (via drawWall)
    drawWall(ctx, bx0, bx1, wy0, wy1, { base: P[2], hi: P[3], lo: P[1], ol: OL }, 5);
    // base course with a lit top edge + ground AO
    ctx.fillStyle = W[1]; ctx.fillRect(bx0 - 1, wy1 - 2, bx1 - bx0 + 3, 2);
    ctx.fillStyle = shade(W[2], 1.1); ctx.fillRect(bx0 - 1, wy1 - 2, bx1 - bx0 + 3, 1);
    ctx.fillStyle = shade(OL, 0.85); ctx.fillRect(bx0 - 1, wy1 + 1, bx1 - bx0 + 3, 1);
    // warm red roof
    drawRoof(ctx, 24, 4, 18, (y) => 3 + (y - 4) / 14 * 19, { base: R[3], hi: R[4], lo: R[2], ol: OL });
    // BRICK chimney — mortar courses, lit-left/shadow-right, warm mouth glow
    ctx.fillStyle = OL; ctx.fillRect(32, 5, 6, 9);
    ctx.fillStyle = brick; ctx.fillRect(33, 6, 4, 7);
    ctx.fillStyle = shade(brick, 1.12); ctx.fillRect(33, 6, 1, 7);   // lit left
    ctx.fillStyle = shade(brick, 0.8);  ctx.fillRect(36, 6, 1, 7);   // shadow right
    ctx.fillStyle = shade(brick, 0.68); ctx.fillRect(33, 8, 4, 1); ctx.fillRect(33, 11, 4, 1);   // mortar courses
    ctx.fillStyle = G[5]; ctx.fillRect(33, 5, 4, 1);               // hot mouth
    ctx.fillStyle = G[4]; ctx.fillRect(34, 6, 2, 1);
    // nest doorway — DEEP recess, layered straw, three shaded eggs, speckle
    recess(ctx, 18, 30, 10, 14, '#1a130d', OL);
    ctx.fillStyle = shade(P[1], 0.7); ctx.fillRect(17, 44, 12, 1);   // threshold AO
    ctx.fillStyle = G[0]; ctx.fillRect(18, 40, 10, 4);             // straw nest (layered)
    ctx.fillStyle = G[1]; ctx.fillRect(18, 40, 10, 2);
    ctx.fillStyle = G[3]; ctx.fillRect(19, 40, 6, 1);             // lit straw wisps
    ctx.fillStyle = shade(G[0], 0.8); ctx.fillRect(18, 43, 10, 1);
    const egg = (ex, ey) => {   // body, UL glint, shadow side, contact AO into straw, speckle
        ctx.fillStyle = '#efe6d0'; ctx.fillRect(ex, ey, 3, 4); ctx.fillRect(ex + 1, ey - 1, 1, 6);
        ctx.fillStyle = '#fffdf6'; ctx.fillRect(ex, ey, 1, 1);
        ctx.fillStyle = '#cfc4a8'; ctx.fillRect(ex + 2, ey + 2, 1, 2);
        ctx.fillStyle = shade('#cfc4a8', 0.7); ctx.fillRect(ex, ey + 4, 3, 1);
        ctx.fillStyle = '#d8cdb2'; ctx.fillRect(ex + 1, ey + 3, 1, 1);
    };
    egg(20, 39); egg(23, 40); egg(24, 37);
    return c;
}

export function makeTrough() {
    const [c, ctx] = makeCanvas(12, 6);
    ctx.fillStyle = '#8a6844';
    ctx.fillRect(0, 2, 12, 3);
    ctx.fillStyle = '#68503c';
    ctx.fillRect(0, 4, 12, 1);
    ctx.fillStyle = '#d8c060';       // feed
    ctx.fillRect(2, 1, 8, 2);
    return c;
}

// ---------------------------------------------------------------------------
// Woodland + wild forage
// ---------------------------------------------------------------------------

// Seasonal canopy ramps: dark base, mid body, light highlight, optional blossom.
const TREE_LEAF = {
    SPRING: { dark: '#2f6d2b', mid: '#4faa3c', light: '#79c657', blossom: '#f4b8d8' },
    SUMMER: { dark: '#256022', mid: '#3d8a30', light: '#61b048', blossom: null },
    FALL:   { dark: '#8a4218', mid: '#c9782a', light: '#eaa83e', blossom: '#f2d24a' },
    WINTER: null, // bare branches / snow — handled specially
};

// A soft rounded canopy: layered ellipses (dark → mid → light) lit from the
// upper-left, with a darker underside crescent so it reads as a 3/4 sphere.
function canopyBlob(ctx, cx, cy, rx, ry, ramp, blossom) {
    const ellipse = (ox, oy, rrx, rry, col) => {
        for (let y = -rry; y <= rry; y++) {
            const t = y / rry;
            const half = Math.round(rrx * Math.sqrt(Math.max(0, 1 - t * t)));
            if (half < 1) continue;
            px(ctx, cx + ox - half, cy + oy + y, half * 2, 1, col);
        }
    };
    // 1) full dark silhouette
    ellipse(0, 0, rx, ry, ramp.dark);
    // 2) darker underside crescent (bottom two rows of the sphere)
    const under = shade(ramp.dark, 0.7);
    for (let y = ry - 2; y <= ry; y++) {
        const t = y / ry;
        const half = Math.round(rx * Math.sqrt(Math.max(0, 1 - t * t)));
        if (half < 1) continue;
        px(ctx, cx - half, cy + y, half * 2, 1, under);
    }
    // 3) mid body, nudged up-left
    ellipse(-1, -1, rx - 1, ry - 2, ramp.mid);
    // 4) light highlight, small, upper-left
    ellipse(-Math.round(rx * 0.35), -Math.round(ry * 0.42),
        Math.max(1, Math.round(rx * 0.5)), Math.max(1, Math.round(ry * 0.42)), ramp.light);
    // 5) a couple of dark leaf-clump dots for texture on the shadow side
    px(ctx, cx + Math.round(rx * 0.35), cy + 1, 1, 1, ramp.dark);
    px(ctx, cx + Math.round(rx * 0.15), cy + Math.round(ry * 0.4), 1, 1, ramp.dark);
    // 6) blossoms / fruit dots, deterministic scatter
    if (blossom) {
        const spots = [
            [-rx + 2, -1], [rx - 3, -2], [-1, -ry + 2],
            [Math.round(rx * 0.4), Math.round(ry * 0.3)],
            [-Math.round(rx * 0.5), Math.round(ry * 0.25)],
            [Math.round(rx * 0.1), -Math.round(ry * 0.2)],
        ];
        for (const [dx, dy] of spots) {
            px(ctx, cx + dx, cy + dy, 1, 1, blossom);
            px(ctx, cx + dx, cy + dy, 1, 1, blossom);
        }
    }
}

// Root-flared trunk. Sits at the base of the sprite; widens into little roots.
function trunkFlared(ctx, cx, topY, botY, birch) {
    const barkD = birch ? '#b9b9b1' : '#523a23';
    const bark  = birch ? '#e2e2da' : '#7a5433';
    const barkL = birch ? '#f3f3ed' : '#946c46';
    const h = botY - topY + 1;
    // shaft (3 wide) with left highlight + right shadow
    px(ctx, cx - 1, topY, 3, h, bark);
    px(ctx, cx - 1, topY, 1, h, barkL);
    px(ctx, cx + 1, topY, 1, h, barkD);
    // root flare — widen the last two rows into feet
    px(ctx, cx - 2, botY - 1, 5, 2, bark);
    px(ctx, cx - 2, botY - 1, 1, 2, barkL);
    px(ctx, cx + 2, botY - 1, 1, 2, barkD);
    // 1px darker underside / ground contact
    px(ctx, cx - 2, botY, 5, 1, shade(barkD, 0.8));
    px(ctx, cx - 3, botY, 1, 1, shade(barkD, 0.8));
    px(ctx, cx + 3, botY, 1, 1, shade(barkD, 0.8));
    if (birch) {
        px(ctx, cx - 1, topY + 1, 2, 1, '#2a2c30'); // bark dashes
        px(ctx, cx, topY + 3, 2, 1, '#2a2c30');
        px(ctx, cx - 1, topY + 5, 1, 1, '#2a2c30');
    }
}

// makeTree(species, seasonName) — 'oak' | 'pine' | 'birch' | 'bush', seasonal.
export function makeTree(species = 'oak', season = 'SUMMER') {
    const [c, ctx] = makeCanvas(16, 22);
    const winter = season === 'WINTER';
    const ramp = TREE_LEAF[season] || TREE_LEAF.SUMMER;
    const cx = 8;

    // ---- PINE / spruce: soft tiered cone, stays green, snow-capped in winter
    if (species === 'pine') {
        trunkFlared(ctx, cx, 16, 21, false);
        const dark = winter ? '#1f4a26' : season === 'FALL' ? '#245222' : '#20502a';
        const mid  = winter ? '#2f6234' : season === 'FALL' ? '#356e2c' : '#2f6c3a';
        const light = winter ? '#3f7a44' : '#43854c';
        // three overlapping rounded tiers, widest at the bottom
        const tiers = [[16, 7, 3], [11, 6, 3], [6, 4, 3]];
        for (const [baseY, w, hh] of tiers) {
            for (let row = 0; row < hh + 2; row++) {
                const yy = baseY - row;
                const half = Math.round(w * (row) / (hh + 1));
                const hw = w - half;
                if (hw < 1) continue;
                px(ctx, cx - hw, yy, hw * 2, 1, dark);
            }
            // mid + light on the sunlit left of each tier
            for (let row = 1; row < hh + 1; row++) {
                const yy = baseY - row;
                const half = Math.round(w * row / (hh + 1));
                const hw = w - half;
                px(ctx, cx - hw + 1, yy, Math.max(1, hw), 1, mid);
                px(ctx, cx - hw + 1, yy, Math.max(1, hw - 2), 1, light);
            }
            if (winter) { px(ctx, cx - w + 1, baseY - hh, (w - 1) * 2 - 1, 1, '#eef4f4'); }
        }
        px(ctx, cx - 1, 2, 2, 2, dark);      // tip
        px(ctx, cx - 1, 2, 1, 1, light);
        if (winter) px(ctx, cx - 1, 1, 2, 1, '#eef4f4');
        return c;
    }

    // ---- BUSH: low rounded shrub, no real trunk
    if (species === 'bush') {
        if (winter) {
            canopyBlob(ctx, cx, 15, 6, 4, { dark: '#3a5236', mid: '#4c6a46', light: '#5c7a55' }, null);
            px(ctx, cx - 5, 12, 10, 2, '#eef4f4'); // snow cap
            px(ctx, cx - 4, 11, 7, 1, '#ffffff');
        } else {
            canopyBlob(ctx, cx, 15, 6, 4, ramp, ramp.blossom);
            // tiny ground shadow contact
            px(ctx, cx - 4, 19, 8, 1, shade(ramp.dark, 0.7));
        }
        return c;
    }

    // ---- OAK / BIRCH ------------------------------------------------------
    const birch = species === 'birch';
    trunkFlared(ctx, cx, birch ? 12 : 14, 21, birch);

    if (winter) {
        // bare branch fan
        const wood = birch ? '#d0d0c8' : '#5a4230';
        const woodD = birch ? '#a8a8a0' : '#452f1f';
        px(ctx, cx - 1, 6, 2, 9, wood);
        px(ctx, cx + 1, 6, 1, 9, woodD);
        px(ctx, cx - 4, 9, 3, 1, wood); px(ctx, cx - 5, 8, 2, 1, wood);
        px(ctx, cx + 2, 8, 3, 1, wood); px(ctx, cx + 4, 6, 2, 1, wood);
        px(ctx, cx - 2, 5, 1, 3, wood); px(ctx, cx + 1, 4, 1, 3, wood);
        px(ctx, cx - 5, 7, 1, 1, woodD); px(ctx, cx + 5, 5, 1, 1, woodD);
        // dabs of snow resting on the boughs
        px(ctx, cx - 4, 8, 2, 1, '#eef4f4');
        px(ctx, cx + 3, 7, 2, 1, '#eef4f4');
        px(ctx, cx - 1, 4, 2, 1, '#eef4f4');
        return c;
    }

    if (birch) {
        // narrower, taller oval canopy
        canopyBlob(ctx, cx, 7, 5, 6, ramp, ramp.blossom);
    } else {
        // big round oak crown
        canopyBlob(ctx, cx, 8, 7, 7, ramp, ramp.blossom);
    }
    return c;
}

// A cleaner tree stump with cut rings and root flare.
export function makeStump() {
    const [c, ctx] = makeCanvas(12, 10);
    const bark = '#6a4a2c', barkD = '#4b3420', barkL = '#835c38';
    // body
    px(ctx, 3, 4, 6, 4, bark);
    px(ctx, 3, 4, 1, 4, barkL);
    px(ctx, 8, 4, 1, 4, barkD);
    px(ctx, 3, 7, 6, 1, barkD); // underside
    // cut top (ellipse-ish rings)
    px(ctx, 3, 3, 6, 2, '#a9814f');
    px(ctx, 4, 2, 4, 1, '#b98f58');
    px(ctx, 5, 3, 2, 1, '#7a5836'); // inner ring
    px(ctx, 5, 2, 2, 1, '#c69a63');
    // root flare feet
    px(ctx, 2, 7, 1, 1, bark); px(ctx, 9, 7, 1, 1, bark);
    px(ctx, 1, 8, 2, 1, barkD); px(ctx, 9, 8, 2, 1, barkD);
    px(ctx, 3, 8, 6, 1, shade(barkD, 0.85)); // ground shadow
    return c;
}

// A mossy fallen log lying across the tile (matches the reference's logs).
export function makeFallenLog() {
    const [c, ctx] = makeCanvas(20, 9);
    const bark = '#6a4a2c', barkD = '#4b3420', barkL = '#835c38';
    // long horizontal trunk
    px(ctx, 2, 3, 16, 4, bark);
    px(ctx, 2, 3, 16, 1, barkL);   // top highlight
    px(ctx, 2, 6, 16, 1, barkD);   // underside
    px(ctx, 2, 7, 16, 1, shade(barkD, 0.8)); // ground shadow
    // bark grain streaks
    px(ctx, 5, 4, 4, 1, shade(bark, 0.85));
    px(ctx, 11, 5, 5, 1, shade(bark, 0.85));
    // cut end (rings) on the right
    px(ctx, 17, 3, 2, 4, '#a9814f');
    px(ctx, 18, 4, 1, 2, '#c69a63');
    px(ctx, 17, 4, 1, 2, '#7a5836');
    // knot on the left end
    px(ctx, 1, 4, 1, 2, barkD);
    // patches of moss
    px(ctx, 6, 3, 3, 1, '#4f8a3c');
    px(ctx, 7, 3, 1, 1, '#6fb054');
    px(ctx, 12, 3, 2, 1, '#4f8a3c');
    return c;
}

// makeWildWheat() — a lush golden tuft that fans out of a small grassy base.
export function makeWildWheat() {
    const [c, ctx] = makeCanvas(12, 12);

    const grain = '#e8c24e';                 // mid golden
    const grainL = '#f6e6a2';                // sun highlight
    const grainD = '#b08a2e';                // shaded underside
    const stem = '#a8862e';
    const stemD = '#856616';

    // little green foraging base so it reads as a wild clump, not just wheat
    px(ctx, 3, 10, 6, 2, '#3a6a2c');
    px(ctx, 4, 9, 4, 1, '#4e9438');
    px(ctx, 2, 11, 8, 1, shade('#3a6a2c', 0.8));

    // five stalks fanning from the base center (6,10) to spread heads.
    // [headX, headY]
    const heads = [[1, 3], [3, 1], [6, 0], [9, 1], [10, 4]];
    const bx = 6, by = 10;

    for (let i = 0; i < heads.length; i++) {
        const [hx, hy] = heads[i];
        // stem: step from base to just under the head, leaning outward
        const topY = hy + 3;
        for (let y = by; y >= topY; y--) {
            const t = (by - y) / (by - topY);
            const sx = Math.round(bx + (hx - bx) * t);
            px(ctx, sx, y, 1, 1, stem);
            if (y > topY) px(ctx, sx, y, 1, 1, y % 2 ? stem : stemD); // subtle segment
        }

        // grain head: a small teardrop cluster of kernels
        px(ctx, hx, hy, 2, 4, grain);            // core
        px(ctx, hx - 1, hy + 1, 1, 2, grain);    // left kernels
        px(ctx, hx + 2, hy + 1, 1, 2, grain);    // right kernels
        px(ctx, hx, hy - 1, 1, 1, grain);        // tip
        px(ctx, hx, hy, 1, 2, grainL);           // lit face
        px(ctx, hx, hy - 1, 1, 1, grainL);
        px(ctx, hx + 1, hy + 3, 1, 1, grainD);   // shaded underside
        px(ctx, hx - 1, hy + 2, 1, 1, grainD);
    }
    return c;
}

// makeWildFlowers() — a colorful blossom clump on a rounded green mound.
export function makeWildFlowers() {
    const [c, ctx] = makeCanvas(12, 10);

    const leaf = '#4e9438', leafD = '#2e6a2c', leafL = '#74bc54';

    // rounded leafy mound (dark silhouette -> mid -> a couple lit tufts)
    const mound = [[6, 3, 6], [7, 2, 8], [8, 3, 7], [9, 4, 5]];
    for (const [y, x, w] of mound) px(ctx, x, y, w, 1, leafD);
    px(ctx, 3, 7, 6, 1, leaf);
    px(ctx, 4, 6, 4, 1, leaf);
    px(ctx, 4, 6, 2, 1, leafL);                  // tuft highlight
    px(ctx, 8, 7, 1, 1, leafL);
    px(ctx, 2, 9, 8, 1, shade(leafD, 0.78));     // 1px darker underside

    // mixed blossoms, each a tiny 3x3 flower: 4 petals + pollen center.
    // [cx, cy, petal, highlight]
    const blooms = [
        [2, 2, '#e85888', '#f6a0c0'],   // pink
        [5, 1, '#f0c838', '#fbe79a'],   // yellow
        [8, 2, '#8a6ae0', '#bfa8f2'],   // purple
        [4, 4, '#eef0f8', '#ffffff'],   // white
        [9, 4, '#e04860', '#f28a9a'],   // red
    ];
    for (const [cx, cy, petal, hi] of blooms) {
        // tiny stem down into the mound
        px(ctx, cx, cy + 1, 1, 2, leafD);
        // petals
        px(ctx, cx - 1, cy, 1, 1, petal);
        px(ctx, cx + 1, cy, 1, 1, petal);
        px(ctx, cx, cy - 1, 1, 1, petal);
        px(ctx, cx, cy + 1, 1, 1, petal);
        px(ctx, cx - 1, cy - 1, 1, 1, hi);       // top-left lit petal
        // pollen center
        px(ctx, cx, cy, 1, 1, '#f6e27a');
    }
    return c;
}

// makeBush(variant) — decorative round shrub for scatter. ~12x10.
//   variant 0 = plain green, 1 = berry bush, 2 = blue-flowering bush
export function makeBush(variant = 0) {
    const [c, ctx] = makeCanvas(12, 10);

    const leafD = '#2e6a2c', leaf = '#4e9438', leafL = '#74bc54';

    // full rounded silhouette (dark base) — [y, x, w]
    const sil = [
        [1, 4, 4],
        [2, 2, 8],
        [3, 1, 10],
        [4, 1, 10],
        [5, 1, 10],
        [6, 2, 9],
        [7, 3, 6],
    ];
    for (const [y, x, w] of sil) px(ctx, x, y, w, 1, leafD);

    // mid-green body, inset so the dark rim reads as an outline
    const body = [
        [2, 3, 6],
        [3, 2, 8],
        [4, 2, 7],
        [5, 3, 6],
        [6, 4, 5],
    ];
    for (const [y, x, w] of body) px(ctx, x, y, w, 1, leaf);

    // bright top-left lobes (three tone highlight, suggests clumped leaves)
    px(ctx, 3, 2, 3, 1, leafL);
    px(ctx, 3, 3, 2, 1, leafL);
    px(ctx, 7, 3, 2, 1, leafL);
    px(ctx, 5, 4, 2, 1, leafL);

    // 1px darker underside
    px(ctx, 3, 7, 6, 1, shade(leafD, 0.78));
    px(ctx, 2, 6, 1, 1, shade(leafD, 0.78));
    px(ctx, 10, 6, 1, 1, shade(leafD, 0.78));

    if (variant === 1) {
        // berry bush — plump red berries with a lit dot
        const berry = '#e0402c', berryL = '#f47a54';
        const spots = [[3, 3], [6, 2], [8, 4], [4, 5], [9, 5], [6, 6]];
        for (const [x, y] of spots) {
            px(ctx, x, y, 2, 2, berry);
            px(ctx, x, y, 1, 1, berryL);         // shine
        }
    } else if (variant === 2) {
        // blue-flowering bush — small blue blossoms with pale centers
        const petal = '#5878d8', petalL = '#9db4f0';
        const flowers = [[3, 2], [7, 3], [5, 5], [9, 4], [2, 5]];
        for (const [cx, cy] of flowers) {
            px(ctx, cx - 1, cy, 1, 1, petal);
            px(ctx, cx + 1, cy, 1, 1, petal);
            px(ctx, cx, cy - 1, 1, 1, petal);
            px(ctx, cx, cy + 1, 1, 1, petal);
            px(ctx, cx, cy - 1, 1, 1, petalL);   // lit petal
            px(ctx, cx, cy, 1, 1, '#eef2ff');    // pale center
        }
    } else {
        // plain green — a few extra lit specks for leafy texture
        px(ctx, 4, 3, 1, 1, leafL);
        px(ctx, 8, 4, 1, 1, leafL);
        px(ctx, 6, 5, 1, 1, leafL);
    }
    return c;
}

export function makeLantern() {
    const [c, ctx] = makeCanvas(6, 8);
    ctx.fillStyle = '#6a5844';
    ctx.fillRect(2, 0, 2, 1);      // handle top
    ctx.fillRect(1, 1, 1, 1); ctx.fillRect(4, 1, 1, 1);
    ctx.fillStyle = '#7c6a50';
    ctx.fillRect(1, 2, 4, 1);      // cap
    ctx.fillStyle = '#ffb020';
    ctx.fillRect(1, 3, 4, 4);      // glass glow (hot amber)
    ctx.fillStyle = '#ffe07a';
    ctx.fillRect(1, 3, 4, 1); ctx.fillRect(1, 3, 1, 4); ctx.fillRect(4, 3, 1, 4);  // bright rim
    ctx.fillStyle = '#fffbe8';
    ctx.fillRect(2, 4, 2, 2);      // white-hot flame core
    ctx.fillStyle = '#584838';
    ctx.fillRect(1, 7, 4, 1);      // base
    return c;
}

// ---------------------------------------------------------------------------
// Iso tile helpers
// ---------------------------------------------------------------------------

export function fillDiamond(ctx, sx, sy, color) {
    // sx,sy = top corner of the diamond
    ctx.fillStyle = color;
    const hw = TILE_W / 2, hh = TILE_H / 2;
    for (let row = 0; row < TILE_H; row++) {
        const dy = row < hh ? row : TILE_H - 1 - row;
        const half = Math.round((dy + 1) * (hw / hh));
        ctx.fillRect(sx + hw - half, sy + row, half * 2, 1);
    }
}

export function strokeDiamond(ctx, sx, sy, color) {
    ctx.fillStyle = color;
    const hw = TILE_W / 2, hh = TILE_H / 2;
    for (let row = 0; row < TILE_H; row++) {
        const dy = row < hh ? row : TILE_H - 1 - row;
        const half = Math.round((dy + 1) * (hw / hh));
        ctx.fillRect(sx + hw - half, sy + row, 1, 1);
        ctx.fillRect(sx + hw + half - 1, sy + row, 1, 1);
    }
}
