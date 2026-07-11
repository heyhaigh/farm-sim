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

    // ---- withered: drooping brown husk (any type) ----
    if (withered) {
        const wStem = '#7a5c34', wLeaf = '#8a6a3c', wLeafD = '#654c28';
        soil();
        px(ctx, 5, 5, 2, 6, wStem);        // bent stalk
        px(ctx, 6, 5, 1, 6, wLeafD);
        px(ctx, 2, 7, 3, 2, wLeaf);        // sagging leaves
        px(ctx, 7, 8, 3, 2, wLeaf);
        px(ctx, 4, 5, 2, 2, wLeafD);
        px(ctx, 2, 9, 1, 1, wLeafD);
        px(ctx, 9, 10, 1, 1, wLeafD);
        px(ctx, 5, 4, 2, 1, wLeaf);        // drooping tip
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

// #99b the Mill — a stone grinding house with a big millstone wheel on its face (grinds wheat -> grain)
export function makeMill() {
    const [c, ctx] = makeCanvas(26, 26);
    ctx.fillStyle = '#8a8378'; ctx.fillRect(4, 8, 18, 18);          // stone body
    ctx.fillStyle = '#736c62'; ctx.fillRect(4, 22, 18, 4);         // shaded base course
    ctx.fillStyle = '#5a544c';                                     // stone block seams
    for (let j = 10; j < 24; j += 4) ctx.fillRect(4, j, 18, 1);
    for (let i = 8; i < 22; i += 6) ctx.fillRect(i, 8, 1, 18);
    ctx.fillStyle = '#3a342c'; ctx.fillRect(6, 16, 5, 10);         // doorway
    ctx.fillStyle = '#4a4038'; ctx.fillStyle = '#6b4a2c'; ctx.fillRect(20, 6, 3, 3);   // roof vent
    ctx.fillStyle = '#5a3a22';                                     // dark plank roof
    for (let i = 0; i < 6; i++) ctx.fillRect(2 + i * 2, 8 - i, 22 - i * 4, 2);
    // the millstone wheel on the face
    ctx.fillStyle = '#c8c2b6'; ctx.beginPath(); ctx.arc(16, 17, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#9a948a'; ctx.beginPath(); ctx.arc(16, 17, 5, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#6a645a'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(11, 17); ctx.lineTo(21, 17); ctx.moveTo(16, 12); ctx.lineTo(16, 22); ctx.stroke();   // spokes
    ctx.fillStyle = '#5a544c'; ctx.fillRect(15, 16, 2, 2);        // hub
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
