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
// Farmer sprites — 12x16, generated per character sheet
// ---------------------------------------------------------------------------

// S skin, H hair, T shirt, P pants, O outline/shoes, W eye white, E eye dark
const FARMER_FRAMES = {
    idle: [
        '............',
        '...HHHHHH...',
        '..HHHHHHHH..',
        '..HSSSSSSH..',
        '..SSESSESS..',
        '..SSSSSSSS..',
        '...SSSSSS...',
        '..TTTTTTTT..',
        '.STTTTTTTTS.',
        '.STTTTTTTTS.',
        '..TTTTTTTT..',
        '...PPPPPP...',
        '...PP..PP...',
        '...PP..PP...',
        '...OO..OO...',
        '............',
    ],
    walk1: [
        '............',
        '...HHHHHH...',
        '..HHHHHHHH..',
        '..HSSSSSSH..',
        '..SSESSESS..',
        '..SSSSSSSS..',
        '...SSSSSS...',
        '..TTTTTTTT..',
        '.STTTTTTTT..',
        '.STTTTTTTTS.',
        '..TTTTTTTTS.',
        '...PPPPPP...',
        '...PP..PP...',
        '..PP....PP..',
        '..OO....OO..',
        '............',
    ],
    walk2: [
        '............',
        '...HHHHHH...',
        '..HHHHHHHH..',
        '..HSSSSSSH..',
        '..SSESSESS..',
        '..SSSSSSSS..',
        '...SSSSSS...',
        '..TTTTTTTT..',
        '..TTTTTTTTS.',
        '.STTTTTTTTS.',
        '.STTTTTTTT..',
        '...PPPPPP...',
        '....PPPP....',
        '...PP..PP...',
        '...OO..OO...',
        '............',
    ],
    work: [
        '.........S..',
        '...HHHHHHS..',
        '..HHHHHHHH..',
        '..HSSSSSSH..',
        '..SSESSESS..',
        '..SSSSSSSS..',
        '...SSSSSS...',
        '..TTTTTTTT..',
        '.STTTTTTTT..',
        '.STTTTTTTT..',
        '..TTTTTTTT..',
        '...PPPPPP...',
        '...PP..PP...',
        '...PP..PP...',
        '...OO..OO...',
        '............',
    ],
    sleep: [
        '............',
        '............',
        '............',
        '............',
        '............',
        '...HHHHHH...',
        '..HHHHHHHH..',
        '..HSSSSSSH..',
        '..S-S--S-S..',
        '..SSSSSSSS..',
        '..TTTTTTTTT.',
        '.TTTTTTTTTTT',
        '.TTTTTTTTTTT',
        '..OO....OO..',
        '............',
        '............',
    ],
};

function drawHat(ctx, hat, hatColor) {
    ctx.fillStyle = hatColor;
    switch (hat) {
        case 'strawhat':
            ctx.fillRect(1, 2, 10, 1);
            ctx.fillRect(3, 0, 6, 2);
            break;
        case 'hardhat':
            ctx.fillRect(3, 0, 6, 1);
            ctx.fillRect(2, 1, 8, 2);
            break;
        case 'cap':
            ctx.fillRect(3, 0, 6, 2);
            ctx.fillRect(2, 2, 10, 1);
            break;
        case 'beret':
            ctx.fillRect(2, 0, 7, 2);
            ctx.fillRect(8, 0, 2, 1);
            break;
        case 'headband':
            ctx.fillRect(2, 3, 8, 1);
            break;
        case 'headset':
            ctx.fillRect(2, 1, 8, 1);
            ctx.fillRect(1, 3, 1, 3);
            ctx.fillRect(10, 3, 1, 3);
            ctx.fillRect(1, 6, 2, 1);
            break;
    }
}

export function makeFarmerSprites(sheet) {
    const c = sheet.colors;
    const key = {
        'S': c.skin, 'H': c.hair, 'T': c.shirt, 'P': c.pants,
        'O': '#20222c', 'E': '#20222c', '-': '#20222c',
    };
    const out = {};
    for (const [name, rows] of Object.entries(FARMER_FRAMES)) {
        const sprite = spriteFromMap(rows, key);
        const ctx = sprite.getContext('2d');
        if (name !== 'sleep') drawHat(ctx, sheet.hat, c.hatColor);
        out[name] = sprite;
    }
    return out;
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
