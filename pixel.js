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
function shade(hex, f) {
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
function recess(ctx, x, y, w, h, inner, rim) {
    ctx.fillStyle = rim;   ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = inner; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = shade(inner, 1.7);  ctx.fillRect(x + 1, y, w - 1, 1);     // lit inner top lip
    ctx.fillStyle = shade(inner, 0.66); ctx.fillRect(x, y + h - 1, w, 1);     // inner base AO (kept above the outline floor)
}

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

// #85 legend MEMORIAL — a small gold-plaqued stone raised where a raider was felled
// (accumulates across a war, permanent on the battlefield). Tiny-sprite discipline:
// STONE-ramp shaft (lit-left/shadow-right + ashlar-lite block tones + a mortar seam),
// a pointed lit cap, a plinth with a lit course + ground AO, and a hue-shifted GRAIN
// plaque with a spec glint. 12×21, cached. Anchor: cap at top, shadow at the base. (§1b)
let _monument = null;
export function makeMonument() {
    if (_monument) return _monument;
    const [c, ctx] = makeCanvas(12, 21);
    const S = RAMPS.STONE, G = RAMPS.GRAIN, OL = RAMPS.OUTLINE.warm, cx = 6;
    groundShadow(ctx, cx, 19, 6, 2, 0.32);                       // soft 2-layer ground shadow
    // plinth (base block): body + lit top course + shaded lower course + ground AO
    ctx.fillStyle = OL;  ctx.fillRect(1, 14, 10, 5);
    ctx.fillStyle = S[2]; ctx.fillRect(1, 15, 10, 3);
    ctx.fillStyle = S[3]; ctx.fillRect(1, 15, 10, 1);           // lit top course
    ctx.fillStyle = S[1]; ctx.fillRect(1, 17, 10, 1);           // shaded lower course
    ctx.fillStyle = shade(OL, 0.9); ctx.fillRect(1, 18, 10, 1); // ground-contact AO
    // shaft — STONE ramp, lit-left / shadow-right, ashlar-lite blocks + a mortar seam
    const sx0 = 3, sw = 6, sTop = 2, sBot = 14;
    ctx.fillStyle = OL;   ctx.fillRect(sx0 - 1, sTop, sw + 2, sBot - sTop);
    ctx.fillStyle = S[2]; ctx.fillRect(sx0, sTop, sw, sBot - sTop);
    ctx.fillStyle = S[3]; ctx.fillRect(sx0, sTop, 2, sBot - sTop);              // sunlit left
    ctx.fillStyle = shade(S[4], 1.05); ctx.fillRect(sx0, sTop, 1, sBot - sTop); // brightest left edge
    ctx.fillStyle = S[1]; ctx.fillRect(sx0 + sw - 1, sTop, 1, sBot - sTop);     // shadow right
    ctx.fillStyle = shade(S[2], 1.08); ctx.fillRect(sx0 + 1, sTop + 1, 3, 3);   // lighter block
    ctx.fillStyle = shade(S[2], 0.9);  ctx.fillRect(sx0 + 2, sTop + 8, 3, 3);   // darker block
    ctx.fillStyle = S[0]; ctx.fillRect(sx0, sTop + 6, sw, 1);                   // mortar seam
    ctx.fillStyle = shade(S[3], 1.08); ctx.fillRect(sx0, sTop + 7, sw, 1);      // lit under-seam course
    // pointed CAP with a lit top
    ctx.fillStyle = OL;  ctx.fillRect(cx - 3, 1, 6, 1);
    ctx.fillStyle = S[3]; ctx.fillRect(cx - 2, 1, 4, 1);
    ctx.fillStyle = shade(S[4], 1.1); ctx.fillRect(cx - 1, 0, 2, 1);            // lit pointed peak
    ctx.fillStyle = S[1]; ctx.fillRect(cx + 1, 1, 1, 1);                        // cap shadow corner
    // gold PLAQUE — GRAIN ramp shadow->lit + recessed frame + spec glint + engraving
    ctx.fillStyle = OL;  ctx.fillRect(cx - 3, 6, 6, 5);                         // recessed frame
    ctx.fillStyle = G[1]; ctx.fillRect(cx - 2, 7, 4, 3);                        // plaque body (shadow gold)
    ctx.fillStyle = G[3]; ctx.fillRect(cx - 2, 7, 4, 1);                        // lit top
    ctx.fillStyle = G[4]; ctx.fillRect(cx - 2, 7, 2, 1);                        // brighter lit-left
    ctx.fillStyle = shade(G[1], 0.82); ctx.fillRect(cx - 2, 9, 4, 1);          // shaded bottom
    ctx.fillStyle = shade(G[0], 0.9); ctx.fillRect(cx - 1, 8, 2, 1);           // engraved line
    ctx.fillStyle = '#fffdf6'; ctx.fillRect(cx - 2, 7, 1, 1);                   // spec glint
    _monument = c;
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
export function makeBarn() {
    const [c, ctx] = makeCanvas(64, 60);
    const R = RAMPS.ROOF_RED, W = RAMPS.WOOD, S = RAMPS.STONE, OL = RAMPS.OUTLINE.warm;
    const trim = '#e8e0d0', trimLo = '#b9ae95', trimHi = '#fffdf6';
    groundShadow(ctx, 32, 57, 28, 7, 0.32);
    const bx0 = 12, bx1 = 52, wy0 = 27, wy1 = 55;
    // barn-red walls with weathered planks + form self-shadow (via drawWall)
    drawWall(ctx, bx0, bx1, wy0, wy1, { base: R[3], hi: R[4], lo: R[2], ol: OL }, 7);
    // stone foundation: course band with a lit top edge + ground AO
    ctx.fillStyle = S[1]; ctx.fillRect(bx0 - 1, wy1 - 2, bx1 - bx0 + 3, 2);
    ctx.fillStyle = shade(S[2], 1.1); ctx.fillRect(bx0 - 1, wy1 - 2, bx1 - bx0 + 3, 1);   // foundation top relief
    ctx.fillStyle = S[0]; ctx.fillRect(bx0 - 1, wy1 + 1, bx1 - bx0 + 3, 1);               // ground AO
    // gambrel roof: shallow upper slope (y8–14), steep lower slope (y14–27), overhanging eaves
    drawRoof(ctx, 32, 8, 27, (y) => (y <= 14 ? 5 + (y - 8) * 1.5 : 14 + (y - 14) * 1.0),
        { base: R[1], hi: R[3], lo: R[0], ol: OL });
    // ridge cupola: louvered box (lit-left/shadow-right), cap, vent, base shadow onto roof
    ctx.fillStyle = OL; ctx.fillRect(28, 3, 8, 6);
    ctx.fillStyle = R[2]; ctx.fillRect(29, 4, 6, 4);
    ctx.fillStyle = R[4]; ctx.fillRect(29, 4, 2, 4);                // lit left
    ctx.fillStyle = R[1]; ctx.fillRect(33, 4, 2, 4);                // shadow right
    ctx.fillStyle = shade(R[1], 0.82); ctx.fillRect(30, 5, 4, 1); ctx.fillRect(30, 7, 4, 1);  // louver slats
    ctx.fillStyle = '#241c18'; ctx.fillRect(31, 5, 2, 1);          // vent slit
    ctx.fillStyle = trim; ctx.fillRect(27, 2, 10, 1);               // cap
    ctx.fillStyle = shade(R[0], 0.85); ctx.fillRect(28, 9, 8, 1);   // cupola base shadow on roof
    // hayloft: recessed opening with baled hay + a pulley beam
    recess(ctx, 29, 29, 7, 7, '#241c14', OL);
    ctx.fillStyle = RAMPS.GRAIN[2]; ctx.fillRect(30, 32, 5, 3);     // hay bale inside
    ctx.fillStyle = RAMPS.GRAIN[4]; ctx.fillRect(30, 32, 3, 1);     // lit straw
    ctx.fillStyle = W[3]; ctx.fillRect(31, 26, 2, 3);              // pulley beam
    ctx.fillStyle = W[1]; ctx.fillRect(31, 26, 1, 3);
    ctx.fillStyle = '#2a2620'; ctx.fillRect(31, 29, 1, 1);        // pulley
    // big white DOORS — recessed, framed planks, beveled X-braces, hinges, threshold AO
    const dx0 = 25, dx1 = 39, dy0 = 37, dy1 = 55, dw = dx1 - dx0, dh = dy1 - dy0;
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
    return c;
}

// #99b the Mill — a stone grinding house with a big millstone wheel on its face
// (grinds wheat -> grain). Cool-shifted stone courses; wheel rings are stepped
// fillRects (no arc/AA). ~52px tall. Exemplar: Chrono Trigger masonry. (§1b, §3.5)
export function makeMill() {
    const [c, ctx] = makeCanvas(52, 58);
    const S = RAMPS.STONE, W = RAMPS.WOOD, F = RAMPS.FOLIAGE, OL = RAMPS.OUTLINE.warm;
    groundShadow(ctx, 26, 55, 23, 6, 0.3);
    const bx0 = 8, bx1 = 44, wy0 = 18, wy1 = 54, bw = bx1 - bx0 + 1, bh = wy1 - wy0 + 1;
    ctx.fillStyle = OL;   ctx.fillRect(bx0 - 1, wy0, bw + 2, bh + 1);   // silhouette
    ctx.fillStyle = S[2]; ctx.fillRect(bx0, wy0, bw, bh);
    // HAND-LAID ASHLAR: running-bond blocks, tone by horizontal position (light UL) with
    // deterministic per-block jitter + occasional moss; each block a lit top bevel + base
    // mortar AO so the wall reads as stacked stone, not a flat face. (§1b Chrono-Trigger)
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
            ctx.fillStyle = shade(S[idx], 1.14); ctx.fillRect(gx, y, w2, 1);           // block top bevel
            ctx.fillStyle = shade(S[idx], 0.78); ctx.fillRect(gx, y + h2 - 1, w2, 1);  // base mortar AO
            if (hsh % 11 === 0) { ctx.fillStyle = F[3]; ctx.fillRect(gx + 1, y + 1, 2, 1); ctx.fillStyle = F[4]; ctx.fillRect(gx + 1, y + 1, 1, 1); }  // moss
        }
    }
    // vertical mortar seams between blocks
    ctx.fillStyle = S[0];
    for (let ci = 0, y = wy0; y < wy1; y += CH, ci++) {
        const off = (ci % 2) * (BW >> 1);
        for (let x = bx0 - off + BW; x < bx1; x += BW) if (x > bx0 && x < bx1) ctx.fillRect(x - 1, y, 1, Math.min(CH, wy1 - y));
    }
    // overall form: a soft right-face shadow wash + a bright sunlit left edge
    ctx.fillStyle = 'rgba(20,26,34,0.24)'; ctx.fillRect(bx1 - 10, wy0, 11, bh);
    ctx.fillStyle = shade(S[4], 1.14);     ctx.fillRect(bx0, wy0, 1, bh);
    ctx.fillStyle = shade(S[0], 0.9);      ctx.fillRect(bx0, wy0, bw, 1);   // eave AO
    ctx.fillStyle = shade(OL, 0.9);        ctx.fillRect(bx0 - 1, wy1 + 1, bw + 2, 1);   // ground AO
    // dark plank pitched roof + a vent
    drawRoof(ctx, 26, 4, 18, (y) => 3 + (y - 4) / 14 * 19, { base: W[1], hi: W[3], lo: RAMPS.OUTLINE.brown, ol: OL });
    ctx.fillStyle = W[0]; ctx.fillRect(33, 8, 3, 4); ctx.fillStyle = RAMPS.GRAIN[2]; ctx.fillRect(33, 8, 3, 1);  // vent
    // upper window — recessed with a glint + a lintel stone
    ctx.fillStyle = S[4]; ctx.fillRect(23, 21, 8, 1);            // lintel stone (lit)
    recess(ctx, 24, 22, 6, 6, '#161a20', S[0]);
    ctx.fillStyle = RAMPS.GLASS[1]; ctx.fillRect(25, 23, 4, 4);
    ctx.fillStyle = RAMPS.GLASS[2]; ctx.fillRect(25, 23, 2, 2);
    ctx.fillStyle = shade(RAMPS.GLASS[2], 1.25); ctx.fillRect(25, 23, 1, 1);   // glint
    // doorway — recessed with a plank door, seams, handle, threshold AO + lintel
    ctx.fillStyle = S[4]; ctx.fillRect(10, 42, 9, 1);           // door lintel
    recess(ctx, 11, 43, 7, 11, '#161310', S[0]);
    ctx.fillStyle = W[1]; ctx.fillRect(12, 44, 5, 10);          // plank door
    ctx.fillStyle = shade(W[1], 1.1); ctx.fillRect(12, 44, 1, 10);
    ctx.fillStyle = shade(W[0], 0.9); ctx.fillRect(14, 44, 1, 10); ctx.fillRect(16, 44, 1, 10);   // door seams
    ctx.fillStyle = '#2a2620'; ctx.fillRect(15, 49, 1, 1);     // handle
    ctx.fillStyle = shade(S[0], 0.7); ctx.fillRect(10, 54, 9, 1);   // threshold AO
    // MILLSTONE wheel on the face — stepped rings, inner groove, cross spokes, lit top, hub (no arc)
    const mcx = 32, mcy = 37, mr = 9;
    for (let dy = -mr; dy <= mr; dy++) {
        const half = Math.round(Math.sqrt(mr * mr - dy * dy));
        if (half < 1) continue;
        ctx.fillStyle = dy < -3 ? S[4] : dy > 3 ? S[1] : S[3];     // lit top / shaded bottom
        ctx.fillRect(mcx - half, mcy + dy, half * 2, 1);
        ctx.fillStyle = S[0]; ctx.fillRect(mcx - half, mcy + dy, 1, 1); ctx.fillRect(mcx + half - 1, mcy + dy, 1, 1);  // rim
    }
    for (let dy = -6; dy <= 6; dy++) {                              // inner ring groove
        const half = Math.round(Math.sqrt(36 - dy * dy));
        if (half < 1) continue;
        ctx.fillStyle = shade(S[2], 0.84); ctx.fillRect(mcx - half, mcy + dy, 1, 1); ctx.fillRect(mcx + half - 1, mcy + dy, 1, 1);
    }
    ctx.fillStyle = S[0];
    ctx.fillRect(mcx - mr + 1, mcy, mr * 2 - 2, 1);               // horizontal spoke
    ctx.fillRect(mcx, mcy - mr + 1, 1, mr * 2 - 2);               // vertical spoke
    ctx.fillStyle = shade(S[4], 1.1); ctx.fillRect(mcx - mr + 1, mcy - 1, 4, 1);   // lit top spoke edge
    ctx.fillStyle = '#2a2620'; ctx.fillRect(mcx - 1, mcy - 1, 2, 2);               // hub
    ctx.fillStyle = shade(S[4], 1.2); ctx.fillRect(mcx - 1, mcy - 1, 1, 1);        // hub glint
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
