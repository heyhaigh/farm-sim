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
};

export function drawText(ctx, str, x, y, color, scale = 1) {
    ctx.fillStyle = color;
    let cx = x;
    for (const raw of String(str).toUpperCase()) {
        const glyph = FONT[raw] || FONT['?'];
        for (let i = 0; i < 15; i++) {
            if (glyph[i] === '1') {
                ctx.fillRect(cx + (i % 3) * scale, y + Math.floor(i / 3) * scale, scale, scale);
            }
        }
        cx += 4 * scale;
    }
    return cx - x;
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

function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.max(0, Math.min(255, Math.round(((n >> 16) & 255) * f)));
    const g = Math.max(0, Math.min(255, Math.round(((n >> 8) & 255) * f)));
    const b = Math.max(0, Math.min(255, Math.round((n & 255) * f)));
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
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
    tomato: { fruit: '#e04838', leaf: '#4a9840', form: 'bush' },
    sunflower: { fruit: '#f8d020', leaf: '#58a050', form: 'tall' },
    pumpkin: { fruit: '#e88820', leaf: '#4a8848', form: 'ground' },
    rose: { fruit: '#e05878', leaf: '#487840', form: 'bush' },
    wheat: { fruit: '#e8c860', leaf: '#88a850', form: 'tall' },
};

const cropCache = {};

export function makeCropSprites(type) {
    if (cropCache[type]) return cropCache[type];
    const style = CROP_STYLES[type] || CROP_STYLES.carrot;
    const sprites = [];

    for (let stage = 0; stage <= 3; stage++) {
        const [c, ctx] = makeCanvas(12, 14);
        drawCropStage(ctx, style, stage, false);
        sprites.push(c);
    }
    const [wc, wctx] = makeCanvas(12, 14);
    drawCropStage(wctx, style, 2, true);
    sprites.push(wc); // index 4 = withered
    cropCache[type] = sprites;
    return sprites;
}

function drawCropStage(ctx, style, stage, withered) {
    const leaf = withered ? '#907850' : style.leaf;
    const fruit = withered ? '#786048' : style.fruit;
    const stem = withered ? '#807050' : '#3e7038';
    const base = 13;

    if (stage === 0) {
        // seed mound
        ctx.fillStyle = '#584028';
        ctx.fillRect(4, base - 2, 4, 2);
        ctx.fillStyle = '#88b060';
        ctx.fillRect(5, base - 3, 1, 1);
        return;
    }
    if (stage === 1) {
        ctx.fillStyle = stem;
        ctx.fillRect(5, base - 4, 2, 4);
        ctx.fillStyle = leaf;
        ctx.fillRect(3, base - 5, 2, 2);
        ctx.fillRect(7, base - 5, 2, 2);
        return;
    }
    if (style.form === 'tall') {
        const h = stage === 2 ? 7 : 10;
        ctx.fillStyle = stem;
        ctx.fillRect(5, base - h, 2, h);
        ctx.fillStyle = leaf;
        ctx.fillRect(2, base - h + 3, 3, 2);
        ctx.fillRect(7, base - h + 4, 3, 2);
        if (stage === 3) {
            ctx.fillStyle = fruit;
            ctx.fillRect(3, 0, 6, 5);
            ctx.fillStyle = withered ? '#605040' : '#805828';
            ctx.fillRect(5, 1, 2, 2);
        } else if (!withered) {
            ctx.fillStyle = fruit;
            ctx.fillRect(4, base - h - 2, 4, 3);
        }
    } else if (style.form === 'bush') {
        const s = stage === 2 ? 3 : 5;
        ctx.fillStyle = leaf;
        ctx.fillRect(6 - s, base - 2 - s, s * 2, s + 2);
        ctx.fillStyle = stem;
        ctx.fillRect(5, base - 2, 2, 2);
        if (stage === 3) {
            ctx.fillStyle = fruit;
            ctx.fillRect(3, base - 6, 2, 2);
            ctx.fillRect(8, base - 7, 2, 2);
            ctx.fillRect(5, base - 4, 2, 2);
        }
    } else { // ground
        ctx.fillStyle = leaf;
        ctx.fillRect(4, base - 5, 4, 3);
        ctx.fillRect(2, base - 4, 2, 2);
        ctx.fillRect(8, base - 4, 2, 2);
        if (stage === 3) {
            ctx.fillStyle = fruit;
            ctx.fillRect(3, base - 3, 6, 3);
            ctx.fillStyle = leaf;
            ctx.fillRect(5, base - 4, 2, 1);
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

export function makeToolshed() {
    const [c, ctx] = makeCanvas(26, 24);
    ctx.fillStyle = '#8a6844';
    ctx.fillRect(3, 10, 20, 12);
    ctx.fillStyle = '#68503c';
    ctx.fillRect(10, 14, 6, 8);
    ctx.fillStyle = '#586068';
    for (let i = 0; i < 6; i++) ctx.fillRect(1 + i * 2, 10 - i, 24 - i * 4, 2);
    // tools leaning
    ctx.fillStyle = '#c8ac80';
    ctx.fillRect(5, 12, 1, 9);
    ctx.fillRect(19, 13, 1, 8);
    ctx.fillStyle = '#9aa0ac';
    ctx.fillRect(4, 11, 3, 2);
    ctx.fillRect(18, 12, 3, 1);
    return c;
}

export function makeWindmill(frame = 0) {
    const [c, ctx] = makeCanvas(28, 34);
    // tower
    ctx.fillStyle = '#c8ac80';
    ctx.fillRect(10, 14, 8, 20);
    ctx.fillStyle = '#a8906a';
    ctx.fillRect(10, 30, 8, 4);
    ctx.fillStyle = '#68503c';
    ctx.fillRect(12, 26, 4, 8);
    // cap
    ctx.fillStyle = '#8a5c3c';
    ctx.fillRect(9, 11, 10, 4);
    // blades (two frames = X vs +)
    ctx.fillStyle = '#e8e0d0';
    const cx = 14, cy = 13;
    if (frame === 0) {
        ctx.fillRect(cx - 1, cy - 11, 2, 10);
        ctx.fillRect(cx - 1, cy + 2, 2, 10);
        ctx.fillRect(cx - 12, cy - 1, 10, 2);
        ctx.fillRect(cx + 3, cy - 1, 10, 2);
    } else {
        for (let d = 2; d < 10; d++) {
            ctx.fillRect(cx + d - 1, cy + d - 1, 2, 2);
            ctx.fillRect(cx - d, cy + d - 1, 2, 2);
            ctx.fillRect(cx + d - 1, cy - d, 2, 2);
            ctx.fillRect(cx - d, cy - d, 2, 2);
        }
    }
    ctx.fillStyle = '#584838';
    ctx.fillRect(cx - 1, cy - 1, 2, 2);
    return c;
}

export function makeTower() {
    const [c, ctx] = makeCanvas(18, 32);
    ctx.fillStyle = '#787e8c';
    ctx.fillRect(5, 10, 8, 22);
    ctx.fillStyle = '#9aa0ac';
    ctx.fillRect(4, 8, 10, 3);
    ctx.fillStyle = '#586068';
    ctx.fillRect(7, 24, 4, 8);
    // rod + orb
    ctx.fillStyle = '#c8ccd8';
    ctx.fillRect(8, 1, 2, 8);
    ctx.fillStyle = '#f0d060';
    ctx.fillRect(7, 0, 4, 3);
    return c;
}

export function makeFencePost() {
    const [c, ctx] = makeCanvas(4, 10);
    ctx.fillStyle = '#8a6844';
    ctx.fillRect(1, 0, 2, 10);
    ctx.fillStyle = '#68503c';
    ctx.fillRect(1, 8, 2, 2);
    return c;
}

// ---------------------------------------------------------------------------
// Facilities: pond life + animals + their buildings
// ---------------------------------------------------------------------------

export function makeLilyPad(bloom) {
    const [c, ctx] = makeCanvas(14, 12);
    // giant Victoria-style pad: green disc with a reddish rim + center notch
    ctx.fillStyle = '#3a6e3a';
    ctx.fillRect(2, 4, 10, 5);
    ctx.fillRect(1, 5, 12, 3);
    ctx.fillStyle = '#5aa048';
    ctx.fillRect(3, 4, 8, 4);
    ctx.fillRect(2, 5, 10, 2);
    ctx.fillStyle = '#7dc060';
    ctx.fillRect(4, 5, 6, 1);
    ctx.fillStyle = '#8a4a4a';      // rim
    ctx.fillRect(1, 4, 1, 4); ctx.fillRect(12, 4, 1, 4);
    ctx.fillStyle = '#2e5230';      // center seam
    ctx.fillRect(6, 4, 1, 5);
    if (bloom) {
        ctx.fillStyle = '#f0e0ec';   // white/pink flower
        ctx.fillRect(6, 1, 2, 2);
        ctx.fillStyle = '#e880a8';
        ctx.fillRect(5, 2, 1, 1); ctx.fillRect(8, 2, 1, 1); ctx.fillRect(6, 0, 2, 1);
        ctx.fillStyle = '#f0d040';
        ctx.fillRect(6, 2, 2, 1);
    }
    return c;
}

export function makeFish(frame) {
    const [c, ctx] = makeCanvas(8, 5);
    ctx.fillStyle = '#e08040';       // koi orange
    ctx.fillRect(1, 1, 5, 3);
    ctx.fillRect(2, 0, 3, 1);
    ctx.fillStyle = '#f0a860';
    ctx.fillRect(2, 1, 3, 1);
    ctx.fillStyle = '#e08040';       // tail flicks
    if (frame) { ctx.fillRect(6, 0, 2, 2); ctx.fillRect(6, 3, 2, 1); }
    else { ctx.fillRect(6, 1, 2, 1); ctx.fillRect(6, 0, 2, 1); ctx.fillRect(6, 3, 2, 1); }
    ctx.fillStyle = '#20242c';
    ctx.fillRect(2, 1, 1, 1);        // eye
    return c;
}

export function makeChicken(frame) {
    const [c, ctx] = makeCanvas(9, 9);
    const legY = frame ? 8 : 7;
    ctx.fillStyle = '#f4f0e8';       // body
    ctx.fillRect(2, 3, 5, 4);
    ctx.fillRect(3, 2, 3, 1);
    ctx.fillStyle = '#e8e0d4';
    ctx.fillRect(2, 5, 5, 2);
    ctx.fillStyle = '#f4f0e8';       // head
    ctx.fillRect(5, 1, 3, 3);
    ctx.fillStyle = '#e05040';       // comb
    ctx.fillRect(6, 0, 2, 1);
    ctx.fillStyle = '#f0a030';       // beak
    ctx.fillRect(8, 2, 1, 1);
    ctx.fillStyle = '#20242c';       // eye
    ctx.fillRect(6, 2, 1, 1);
    ctx.fillStyle = '#f0a030';       // legs
    ctx.fillRect(3, 7, 1, legY - 7 + 1);
    ctx.fillRect(5, 7, 1, (frame ? 6 : 8) - 7 + 1 < 1 ? 1 : 1);
    ctx.fillRect(5, 7, 1, 1);
    return c;
}

function animalSprite(body, dark, spots, frame) {
    const [c, ctx] = makeCanvas(14, 11);
    const legY = 8, legH = frame ? 2 : 3;
    ctx.fillStyle = body;
    ctx.fillRect(2, 3, 9, 5);        // body
    ctx.fillRect(10, 3, 3, 3);       // head
    ctx.fillStyle = dark;
    ctx.fillRect(2, 6, 9, 2);
    if (spots) {                     // cow patches
        ctx.fillStyle = dark;
        ctx.fillRect(4, 4, 2, 2); ctx.fillRect(8, 3, 2, 2);
    }
    ctx.fillStyle = '#20242c';
    ctx.fillRect(12, 4, 1, 1);       // eye
    ctx.fillStyle = dark;            // legs
    ctx.fillRect(3, legY, 1, legH); ctx.fillRect(6, legY, 1, legH + (frame ? 1 : -1));
    ctx.fillRect(8, legY, 1, legH); ctx.fillRect(10, legY, 1, legH + (frame ? -1 : 1));
    ctx.fillStyle = dark;            // tail
    ctx.fillRect(1, 3, 1, 4);
    return c;
}

export function makeCow(frame) { return animalSprite('#f0ece4', '#3a3630', true, frame); }
export function makePig(frame) { return animalSprite('#e8a0a8', '#c07880', false, frame); }
export function makeGoat(frame) {
    const c = animalSprite('#d8d0c4', '#8a8078', false, frame);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#6a6058';       // horns
    ctx.fillRect(11, 2, 1, 1); ctx.fillRect(12, 1, 1, 1);
    ctx.fillStyle = '#e8e0d4';       // beard
    ctx.fillRect(12, 6, 1, 2);
    return c;
}

export function makeCoop() {
    const [c, ctx] = makeCanvas(24, 22);
    ctx.fillStyle = '#c07850';       // red coop body
    ctx.fillRect(3, 10, 18, 12);
    ctx.fillStyle = '#a86040';
    ctx.fillRect(3, 18, 18, 2);
    ctx.fillStyle = '#3a2e28';       // door hole
    ctx.fillRect(9, 14, 6, 8);
    ctx.fillStyle = '#e8c060';       // ramp
    ctx.fillRect(8, 21, 8, 1);
    ctx.fillStyle = '#8a4a3a';       // roof
    for (let i = 0; i < 6; i++) ctx.fillRect(1 + i * 2, 10 - i, 22 - i * 4, 2);
    ctx.fillStyle = '#f0f0f0';       // little window
    ctx.fillRect(16, 13, 3, 3);
    return c;
}

export function makeBarn() {
    const [c, ctx] = makeCanvas(30, 26);
    ctx.fillStyle = '#b85040';       // classic red barn
    ctx.fillRect(3, 10, 24, 16);
    ctx.fillStyle = '#9a4436';
    ctx.fillRect(3, 22, 24, 4);
    ctx.fillStyle = '#e8e0d0';       // white trim doors
    ctx.fillRect(11, 15, 8, 11);
    ctx.fillStyle = '#7a3628';
    ctx.fillRect(14, 15, 2, 11);
    ctx.fillStyle = '#e8e0d0';       // X on doors
    ctx.fillStyle = '#5a2e22';       // roof
    for (let i = 0; i < 7; i++) ctx.fillRect(1 + i * 2, 10 - i * 1, 28 - i * 4, 2);
    ctx.fillStyle = '#e8e0d0';       // hayloft
    ctx.fillRect(13, 4, 4, 4);
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

// Seasonal leaf ramps for deciduous canopies (dark, mid, light[, blossom])
const LEAF_SEASON = {
    SPRING: ['#2e6a2c', '#4e9438', '#74bc54', '#f0a8cc'],
    SUMMER: ['#286026', '#3e8630', '#5aa844', null],
    FALL:   ['#8a4a1e', '#c07828', '#e0a83c', null],
    WINTER: null,   // bare / snow handled specially
};

function treeTrunk(ctx, x, birch) {
    if (birch) {
        ctx.fillStyle = '#d8d8d0'; ctx.fillRect(x, 15, 3, 6);
        ctx.fillStyle = '#20242c';                      // birch bark dashes
        ctx.fillRect(x, 16, 2, 1); ctx.fillRect(x + 1, 18, 2, 1);
    } else {
        ctx.fillStyle = '#6a4a2c'; ctx.fillRect(x, 15, 3, 6);
        ctx.fillStyle = '#503a22'; ctx.fillRect(x + 2, 15, 1, 6);
    }
}

// makeTree(species, seasonName) — oak | pine | birch | bush, drawn seasonally.
export function makeTree(species = 'oak', season = 'SUMMER') {
    const [c, ctx] = makeCanvas(16, 22);
    const winter = season === 'WINTER';
    const leaf = LEAF_SEASON[season] || LEAF_SEASON.SUMMER;

    if (species === 'pine') {
        treeTrunk(ctx, 7, false);
        const g = winter ? ['#1e4a24', '#2e6030'] : season === 'FALL' ? ['#2e5a26', '#3e7030'] : ['#215024', '#316834'];
        for (let k = 0; k < 3; k++) {
            const y = 3 + k * 4, w = 4 + k * 3, x = 8 - w;
            ctx.fillStyle = g[0]; ctx.fillRect(x, y, w * 2, 4);
            ctx.fillStyle = g[1]; ctx.fillRect(x + 1, y, w * 2 - 2, 2);
            if (winter) { ctx.fillStyle = '#e8f0f0'; ctx.fillRect(x + 1, y, w * 2 - 3, 1); }  // snow on boughs
        }
        ctx.fillStyle = g[1]; ctx.fillRect(7, 1, 2, 2);
        return c;
    }

    if (species === 'bush') {
        if (winter) {                                   // snow-dusted shrub
            ctx.fillStyle = '#3a5236'; ctx.fillRect(4, 14, 8, 5);
            ctx.fillStyle = '#e8f0f0'; ctx.fillRect(4, 13, 8, 2);
        } else {
            ctx.fillStyle = leaf[0]; ctx.fillRect(3, 13, 10, 6);
            ctx.fillStyle = leaf[1]; ctx.fillRect(4, 12, 8, 4);
            ctx.fillStyle = leaf[2]; ctx.fillRect(5, 12, 4, 2);
            if (leaf[3]) { ctx.fillStyle = leaf[3]; ctx.fillRect(5, 13, 1, 1); ctx.fillRect(9, 14, 1, 1); }
        }
        return c;
    }

    // oak / birch: trunk + rounded canopy (or bare branches in winter)
    treeTrunk(ctx, 7, species === 'birch');
    if (winter) {
        ctx.strokeStyle = species === 'birch' ? '#b8b8b0' : '#5a4230';
        ctx.fillStyle = species === 'birch' ? '#c8c8c0' : '#5a4230';
        ctx.fillRect(6, 8, 1, 7); ctx.fillRect(4, 9, 2, 1); ctx.fillRect(10, 10, 2, 1);
        ctx.fillRect(8, 7, 1, 6); ctx.fillRect(9, 8, 2, 1); ctx.fillRect(3, 11, 2, 1);
        ctx.fillStyle = '#e8f0f0'; ctx.fillRect(5, 8, 2, 1); ctx.fillRect(9, 9, 2, 1);   // snow
        return c;
    }
    const narrow = species === 'birch';
    const [x0, w0] = narrow ? [4, 8] : [2, 12];
    ctx.fillStyle = leaf[0];
    ctx.fillRect(x0, 6, w0, 8); ctx.fillRect(x0 + 1, 8, w0 - 2, 5); ctx.fillRect(x0 + 2, 4, w0 - 4, 3);
    ctx.fillStyle = leaf[1];
    ctx.fillRect(x0 + 1, 6, w0 - 3, 5); ctx.fillRect(x0, 8, w0 - 5, 3);
    ctx.fillStyle = leaf[2];
    ctx.fillRect(x0 + 2, 5, 4, 2); ctx.fillRect(x0 + 1, 7, 2, 2);
    if (leaf[3]) {                                       // spring blossoms
        ctx.fillStyle = leaf[3];
        ctx.fillRect(x0 + 3, 6, 1, 1); ctx.fillRect(x0 + w0 - 4, 7, 1, 1); ctx.fillRect(x0 + 5, 9, 1, 1);
    }
    ctx.fillStyle = leaf[0];                             // underside shade
    ctx.fillRect(x0, 12, w0, 2);
    return c;
}

export function makeStump() {
    const [c, ctx] = makeCanvas(12, 10);
    ctx.fillStyle = '#6a4a2c';
    ctx.fillRect(3, 4, 6, 4);
    ctx.fillStyle = '#503a22';
    ctx.fillRect(3, 7, 6, 1);
    ctx.fillStyle = '#8a6640';          // cut top
    ctx.fillRect(3, 3, 6, 2);
    ctx.fillStyle = '#a07850';          // rings
    ctx.fillRect(5, 3, 2, 1);
    ctx.fillStyle = '#3a2a18';          // roots
    ctx.fillRect(2, 7, 1, 1); ctx.fillRect(9, 7, 1, 1);
    return c;
}

export function makeWildWheat() {
    const [c, ctx] = makeCanvas(12, 12);
    ctx.fillStyle = '#7a6a2a';           // stalks
    for (const x of [3, 6, 9]) ctx.fillRect(x, 5, 1, 6);
    ctx.fillStyle = '#d8c050';           // heads
    ctx.fillRect(2, 2, 3, 4); ctx.fillRect(5, 1, 3, 4); ctx.fillRect(8, 3, 3, 4);
    ctx.fillStyle = '#f0e090';           // highlights
    ctx.fillRect(3, 2, 1, 2); ctx.fillRect(6, 1, 1, 2); ctx.fillRect(9, 3, 1, 2);
    ctx.fillStyle = '#b09838';           // shade
    ctx.fillRect(2, 5, 3, 1); ctx.fillRect(5, 4, 3, 1); ctx.fillRect(8, 6, 3, 1);
    return c;
}

export function makeWildFlowers() {
    const [c, ctx] = makeCanvas(12, 10);
    // little clump of mixed blossoms on green
    ctx.fillStyle = '#4a8038';                          // leaves
    ctx.fillRect(2, 6, 8, 2); ctx.fillRect(4, 5, 4, 1);
    ctx.fillStyle = '#3a6a2c';
    ctx.fillRect(5, 7, 1, 2); ctx.fillRect(8, 6, 1, 2);
    const blooms = [[2, 2, '#e85888'], [5, 1, '#f0d048'], [8, 3, '#8a6ae0'], [4, 4, '#e8e8f0'], [9, 5, '#e878b0']];
    for (const [x, y, col] of blooms) {
        ctx.fillStyle = col;
        ctx.fillRect(x, y, 2, 2);
        ctx.fillStyle = '#f0e060';                      // pollen center
        ctx.fillRect(x, y, 1, 1);
    }
    return c;
}

export function makeLantern() {
    const [c, ctx] = makeCanvas(6, 8);
    ctx.fillStyle = '#584838';
    ctx.fillRect(2, 0, 2, 1);      // handle top
    ctx.fillRect(1, 1, 1, 1); ctx.fillRect(4, 1, 1, 1);
    ctx.fillStyle = '#6a5844';
    ctx.fillRect(1, 2, 4, 1);      // cap
    ctx.fillStyle = '#f0d040';
    ctx.fillRect(1, 3, 4, 4);      // glass glow
    ctx.fillStyle = '#fff2b0';
    ctx.fillRect(2, 4, 2, 2);      // flame
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
