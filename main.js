// main.js — Ry Farms: rendering, camera, input, UI, boot.

import { fetchMemories, mod, fmtMod, STAT_NAMES, TRAIT_NAMES, TRAIT_LABELS, hashString } from './dna.js';
import { World, GRID, CENTER, T, DAY_LENGTH, NIGHT_LENGTH } from './farm.js';
import {
    TILE_W, TILE_H, makeCanvas, drawText, textWidth,
    makeFarmerSprites, makeCropSprites, makeHouse, makeWell, makeSign, makeFencePost,
    makeScaffold, makeToolshed, makeWindmill, makeTower, makeLantern,
    makeLilyPad, makeFish, makeChicken, makeCow, makePig, makeGoat, makeCoop, makeBarn, makeTrough,
    makeTree, makeStump, makeWildWheat, makeWildFlowers,
    fillDiamond, strokeDiamond,
} from './pixel.js';
import { CRT } from './crt.js';

// ---------------------------------------------------------------------------
// Canvases
// ---------------------------------------------------------------------------

// internal game resolution — height is fixed, width follows the window aspect
// so fullscreen never stretches pixels
let GW = 400, GH = 300;
const [game, ctx] = makeCanvas(GW, GH);

const out = document.getElementById('tv');
const crt = new CRT(out, game);

function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    out.width = out.clientWidth * dpr;
    out.height = out.clientHeight * dpr;
    const aspect = out.clientWidth / Math.max(out.clientHeight, 1);
    GH = 300;
    GW = Math.max(320, Math.min(760, Math.round((GH * aspect) / 2) * 2));
    if (game.width !== GW || game.height !== GH) {
        game.width = GW; game.height = GH;
        ctx.imageSmoothingEnabled = false;
    }
}
window.addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let world = null;
let memories = [];
let memorySource = 'offline';
const usedMemoryIds = new Set();
let selected = null;
let bootTime = 0;
let booted = false;
let rosterOpen = false;
let rosterScroll = 0;
const ROSTER_BTN = { x: 0, y: 3, w: 44, h: 12 };   // positioned in drawUI
const MINIMAP = { x: 0, y: 0, w: 46, h: 46 };      // bottom-right legend, positioned in drawMinimap

const cam = { x: 0, y: 0 };
const mouse = { x: -1, y: -1, downX: 0, downY: 0, dragging: false, panStart: null };

const spriteCache = new Map();   // farmer -> frames
const houseCache = new Map();    // roofColor -> canvas
const wellSprite = makeWell();
const signSprite = makeSign();
const fencePost = makeFencePost();
const scaffoldSprite = makeScaffold();
const lanternSprite = makeLantern();
const structSprites = {
    toolshed: makeToolshed(),
    windmill: [makeWindmill(0), makeWindmill(1)],
    tower: makeTower(),
    well2: wellSprite,
};

// facility sprites
const coopSprite = makeCoop();
const barnSprite = makeBarn();
const troughSprite = makeTrough();
const stumpSprite = makeStump();
const wheatSprite = makeWildWheat();
const flowerSprite = makeWildFlowers();

// ---------------------------------------------------------------------------
// Real hi-res tree art (CraftPix, iso billboards) — loaded async, with the
// procedural trees below as fallback until the images arrive.
// ---------------------------------------------------------------------------
const TREE_ART_BASE = './assets/craftpix-net-385863-free-top-down-trees-pixel-art/PNG/Assets_separately/Trees/';
const TREE_SETS = {
    SPRING: ['Tree1', 'Tree2', 'Tree3', 'Flower_tree1', 'Flower_tree2', 'Fruit_tree1'],
    SUMMER: ['Tree1', 'Tree2', 'Tree3', 'Fruit_tree2', 'Moss_tree1', 'Moss_tree2'],
    FALL: ['Autumn_tree1', 'Tree1', 'Autumn_tree2', 'Moss_tree1', 'Autumn_tree3', 'Tree2', 'Tree3'],
    WINTER: ['Snow_tree1', 'Snow_tree2', 'Snow_tree3', 'Snow_tree1', 'Snow_tree2', 'Snow_tree3', 'Snow_christmass_tree1', 'Christmas_tree1'],
};
const BUSH_ART_BASE = './assets/craftpix-net-141354-free-top-down-bushes-pixel-art/PNG/Assets/';
const BUSH_SETS = {
    SPRING: ['Bush_pink_flowers1', 'Bush_pink_flowers2', 'Bush_blue_flowers1', 'Bush_pink_flowers3'],
    SUMMER: ['Bush_orange_flowers1', 'Bush_red_flowers1', 'Bush_pink_flowers2', 'Bush_blue_flowers2'],
    FALL: ['Autumn_bush1', 'Autumn_bush2', 'Autumn_bush3', 'Bush_orange_flowers2'],
    WINTER: ['Snow_bush1', 'Snow_bush2', 'Snow_bush3'],
    _fern: ['Fern1_1', 'Fern1_2', 'Fern2_1', 'Fern2_2'],   // for wild-wheat/grass forage
};
const FERN_NAMES = ['Fern1_1', 'Fern1_2', 'Fern2_1', 'Fern2_2'];
const ROCK_ART_BASE = './assets/craftpix-net-974061-free-rocks-and-stones-top-down-pixel-art/PNG/Objects_separately/';
const ROCK_NAMES = [
    'Rock1_grass_shadow1', 'Rock1_grass_shadow2', 'Rock1_grass_shadow3', 'Rock1_grass_shadow4', 'Rock1_grass_shadow5',
    'Rock2_grass_shadow1', 'Rock2_grass_shadow2', 'Rock2_grass_shadow3', 'Rock2_grass_shadow4', 'Rock2_grass_shadow5',
    'Rock4_grass_shadow1', 'Rock4_grass_shadow2', 'Rock4_grass_shadow3', 'Rock4_grass_shadow4', 'Rock4_grass_shadow5',
    'Rock5_grass_shadow1', 'Rock5_grass_shadow2', 'Rock5_grass_shadow3', 'Rock5_grass_shadow4', 'Rock5_grass_shadow5',
    'Rock6_grass_shadow1', 'Rock6_grass_shadow2', 'Rock6_grass_shadow3', 'Rock6_grass_shadow4', 'Rock6_grass_shadow5',
];

// Shared async image-set loader: fills `store` and flips `readyFlag` (+ redraws
// terrain) once every image in the sets has loaded. Falls back to procedural
// sprites until then.
const treeImg = {}; let treeArtReady = false;
const bushImg = {}; let bushArtReady = false;
const rockImg = {}; let rockArtReady = false;
function loadImageSet(base, sets, store, onReady) {
    const names = new Set();
    for (const s of Object.values(sets)) s.forEach(n => names.add(n));
    let pending = names.size;
    const done = () => { if (--pending <= 0) { onReady(); terrainDirty = true; } };
    for (const n of names) {
        const img = new Image();
        img.assetName = n;
        img.onload = done;
        img.onerror = done;
        img.src = base + n + '.png';
        store[n] = img;
    }
}
// Animal walk-sheets: 6 cols x 8 rows grids. We slice the side-profile row.
const ANIMAL_ART_BASE = './assets/craftpix-net-291971-free-top-down-animals-farm-pixel-art-sprites/PNG/Without_shadow/';
const ANIMAL_SHEETS = {
    cow:     { file: 'Bull_animation_without_shadow', fw: 64, fh: 64, disp: 62 },
    pig:     { file: 'Piglet_animation_without_shadow', fw: 32, fh: 32, disp: 42 },
    goat:    { file: 'Sheep_animation_without_shadow', fw: 32, fh: 32, disp: 42 },
    chicken: { file: 'Rooster_animation_without_shadow', fw: 32, fh: 32, disp: 30 },
};
const ANIMAL_COLS = 6;
let ANIMAL_SIDE_ROW = 5;   // side-profile (right-facing) row; tuned by eye
const animalImg = {};
let animalArtReady = false;
function loadAnimalArt() {
    const kinds = Object.keys(ANIMAL_SHEETS);
    let pending = kinds.length;
    const done = () => { if (--pending <= 0) animalArtReady = true; };
    for (const k of kinds) {
        const img = new Image();
        img.onload = done;
        img.onerror = done;
        img.src = ANIMAL_ART_BASE + ANIMAL_SHEETS[k].file + '.png';
        animalImg[k] = img;
    }
}

// Home/exterior tileset — we slice the detailed house from the top-left.
const HOME_BASE = './assets/craftpix-net-654184-main-characters-home-free-top-down-pixel-art-asset/PNG/';
const homeSheet = new Image();
let homeReady = false;
const HOUSE_SRC = { x: 2, y: 5, w: 137, h: 125 };   // house within exterior.png (trimmed of the stone-wall row below)
const SMOKE_ENABLED = false;   // chimney smoke off until per-house (sheet-row) alignment is nailed
const smokeSheet = new Image();
let smokeReady = false;
const birdJumpSheet = new Image();
let birdJumpReady = false;

// grass/dirt detail decals scattered on the ground for texture
const grassDetailsImg = new Image();
let grassDetailsReady = false;
const GRASS_DECALS = [    // source rects into ground_grass_details.png (green tufts + a dirt patch)
    { x: 6, y: 156, w: 32, h: 26 }, { x: 74, y: 176, w: 32, h: 26 },
    { x: 150, y: 206, w: 32, h: 26 }, { x: 214, y: 150, w: 32, h: 26 },
    { x: 250, y: 232, w: 36, h: 26 }, { x: 40, y: 244, w: 32, h: 24 },
];
const DIRT_DECALS = [
    { x: 10, y: 14, w: 34, h: 26 }, { x: 96, y: 40, w: 34, h: 26 }, { x: 210, y: 70, w: 34, h: 26 },
];

// Garden crops from CraftPix Plants.png / Supplies.png (left half of Plants is a duplicate).
const PLANTS_BASE = './assets/craftpix-net-200380-free-pixel-art-plants-for-farm/PNG/';
const plantsSheet = new Image(); let plantsReady = false;
const suppliesSheet = new Image(); let suppliesReady = false;
// Growth-stage source rects into Plants.png. Order matches crop.stage 0..3:
// [seed, sprout, mature-foliage, ripe-with-fruit]  (measured from the sheet)
const CROP_FRAMES = {
    tomato: [[11, 112, 12, 14], [40, 105, 19, 21], [101, 96, 22, 30], [68, 96, 23, 30]],   // ripe = red
    carrot: [[9, 141, 13, 10], [39, 140, 19, 14], [102, 138, 22, 17], [70, 138, 22, 17]],  // ripe = leafy head
    rose: [[9, 9, 13, 37], [41, 9, 13, 37], [100, 9, 24, 37], [68, 9, 24, 37]],            // ripe = purple cluster
    pumpkin: [[7, 296, 13, 11], [34, 290, 22, 21], [96, 288, 29, 27], [64, 289, 29, 26]],  // ripe = orange gourd
    wheat: [[9, 371, 11, 10], [39, 363, 14, 18], [39, 363, 14, 18], [68, 353, 22, 28]],    // ripe = grain
    sunflower: [[12, 416, 11, 14], [37, 410, 21, 20], [37, 410, 21, 20], [67, 396, 25, 34]],
};
const CROP_SCALE = 0.72;   // shrink sheet plants to sit nicely on a 20px tile
// Harvested-produce icons in Supplies.png (loose items), shown when a crop is picked / carried.
const PRODUCE_ICONS = {
    tomato: [195, 147, 9, 9], carrot: [147, 210, 11, 11], rose: [242, 209, 11, 14],
    pumpkin: [85, 166, 20, 17], wheat: [1, 176, 13, 15], sunflower: [244, 132, 10, 9],
};

function loadAssetArt() {
    loadImageSet(TREE_ART_BASE, TREE_SETS, treeImg, () => { treeArtReady = true; });
    loadImageSet(BUSH_ART_BASE, BUSH_SETS, bushImg, () => { bushArtReady = true; });
    loadImageSet(ROCK_ART_BASE, { ROCKS: ROCK_NAMES }, rockImg, () => { rockArtReady = true; });
    loadAnimalArt();
    homeSheet.onload = () => { homeReady = true; };
    homeSheet.onerror = () => {};
    homeSheet.src = HOME_BASE + 'exterior.png';
    if (SMOKE_ENABLED) {
        smokeSheet.onload = () => { smokeReady = true; };
        smokeSheet.onerror = () => {};
        smokeSheet.src = HOME_BASE + 'Smoke_animation.png';
    }
    birdJumpSheet.onload = () => { birdJumpReady = true; };
    birdJumpSheet.onerror = () => {};
    birdJumpSheet.src = HOME_BASE + 'bird_jump_animation.png';
    grassDetailsImg.onload = () => { grassDetailsReady = true; terrainDirty = true; };
    grassDetailsImg.onerror = () => {};
    grassDetailsImg.src = HOME_BASE + 'ground_grass_details.png';
    plantsSheet.onload = () => { plantsReady = true; };
    plantsSheet.onerror = () => {};
    plantsSheet.src = PLANTS_BASE + 'Plants.png';
    suppliesSheet.onload = () => { suppliesReady = true; };
    suppliesSheet.onerror = () => {};
    suppliesSheet.src = PLANTS_BASE + 'Supplies.png';
}

// Draw a crop at tile-screen (sx,sy): real sheet frame when available, else procedural fallback.
function drawCropSprite(crop, sx, sy) {
    const frames = CROP_FRAMES[crop.type];
    if (plantsReady && imageLoaded(plantsSheet) && frames && !crop.withered) {
        const f = frames[Math.min(crop.stage, 3)];
        const w = Math.max(1, Math.round(f[2] * CROP_SCALE)), h = Math.max(1, Math.round(f[3] * CROP_SCALE));
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(plantsSheet, f[0], f[1], f[2], f[3], Math.floor(sx - w / 2), Math.floor(sy + 7 - h), w, h);
        return;
    }
    const sprites = makeCropSprites(crop.type);
    const spr = crop.withered ? sprites[4] : sprites[crop.stage];
    ctx.drawImage(spr, Math.floor(sx - 6), Math.floor(sy - 7));
}

// draw a sliced side-profile animal frame at (px,py); returns false if not ready
function drawAnimal(p, px, py) {
    const cfg = ANIMAL_SHEETS[p.kind], img = animalImg[p.kind];
    if (!cfg || !img || !img.complete || !img.naturalWidth) return false;
    const moving = Math.abs(p.vx) + Math.abs(p.vy) > 0.05;
    const col = moving ? Math.floor(p.anim * 6) % ANIMAL_COLS : 0;
    const disp = cfg.disp, top = Math.floor(py - disp * 0.86);
    ctx.imageSmoothingEnabled = false;
    if (p.flip < 0) {
        ctx.save();
        ctx.translate(Math.floor(px + disp / 2), top);
        ctx.scale(-1, 1);
        ctx.drawImage(img, col * cfg.fw, ANIMAL_SIDE_ROW * cfg.fh, cfg.fw, cfg.fh, 0, 0, disp, disp);
        ctx.restore();
    } else {
        ctx.drawImage(img, col * cfg.fw, ANIMAL_SIDE_ROW * cfg.fh, cfg.fw, cfg.fh, Math.floor(px - disp / 2), top, disp, disp);
    }
    ctx.imageSmoothingEnabled = false;
    return true;
}

// trees vary by species AND season; pre-render + cache each combination (fallback)
const TREE_SPECIES = ['oak', 'pine', 'birch', 'oak', 'bush', 'birch'];
const treeCache = new Map();
function treeSprite(species, season) {
    const k = `${species}:${season}`;
    if (!treeCache.has(k)) treeCache.set(k, makeTree(species, season));
    return treeCache.get(k);
}
const lilyPadSprites = [makeLilyPad(false), makeLilyPad(true)];
const producerSprites = {
    fish: [makeFish(0), makeFish(1)],
    chicken: [makeChicken(0), makeChicken(1)],
    cow: [makeCow(0), makeCow(1)],
    pig: [makePig(0), makePig(1)],
    goat: [makeGoat(0), makeGoat(1)],
};
// bobbing "ready to collect" product icon colors
const PRODUCT_ICON = { pad: '#e880a8', fish: '#e08040', chicken: '#f4f0e8', cow: '#ffffff', pig: '#d8b088', goat: '#ffffff' };

function farmerSprites(f) {
    if (!spriteCache.has(f)) spriteCache.set(f, makeFarmerSprites(f.sheet));
    return spriteCache.get(f);
}
function houseSprite(color) {
    if (!houseCache.has(color)) houseCache.set(color, makeHouse(color));
    return houseCache.get(color);
}

// iso transforms
function isoX(i, j) { return (i - j) * (TILE_W / 2); }
function isoY(i, j) { return (i + j) * (TILE_H / 2); }
function screenToTile(sx, sy) {
    const gx = sx - cam.x, gy = sy - cam.y;
    const i = gx / TILE_W + gy / TILE_H;
    const j = gy / TILE_H - gx / TILE_W;
    return { i, j };
}

function imageLoaded(img) {
    return !!img && img.complete && img.naturalWidth > 0;
}
function pickLoadedImage(store, names, i, j, seed = 0) {
    const start = hash2(i * 31 + j * 17, j * 29 - i * 13, seed) % names.length;
    for (let n = 0; n < names.length; n++) {
        const img = store[names[(start + n) % names.length]];
        if (imageLoaded(img)) return img;
    }
    return null;
}
// ONE scale for every real-asset wild billboard. Never scale sprites individually:
// each is drawn at its native pixel size * WILD_SCALE, so the pixel grid is identical
// across all of them. Variety comes from different source images + position, not resizing.
const WILD_SCALE = 0.42;
function wildDims(img) { return { w: Math.round(img.naturalWidth * WILD_SCALE), h: Math.round(img.naturalHeight * WILD_SCALE) }; }
function wildSpec(i, j, t, season) {
    if (t === T.TREE) {
        const treeSet = TREE_SETS[season.name] || TREE_SETS.SUMMER;
        const img = pickLoadedImage(treeImg, treeSet, i, j, 61);
        if (img) {
            const { w, h } = wildDims(img);
            return { img, w, h, anchor: 0.82, depth: 0.4, leaves: season.name === 'FALL', seed: hash2(i, j, 73) };
        }
        const species = TREE_SPECIES[hash2(i, j, 63) % TREE_SPECIES.length];
        const spr = treeSprite(species, season.name);
        return { img: spr, w: spr.width, h: spr.height, anchor: 1, nudgeY: 2, depth: 0.4, leaves: season.name === 'FALL', seed: hash2(i, j, 73) };
    }
    if (t === T.FLOWER) {
        const bushSet = BUSH_SETS[season.name] || BUSH_SETS.SUMMER;
        const img = pickLoadedImage(bushImg, bushSet, i, j, 64);
        if (img) {
            const { w, h } = wildDims(img);
            return { img, w, h, anchor: 0.74, depth: -1 };
        }
        return { img: flowerSprite, w: flowerSprite.width, h: flowerSprite.height, anchor: 1, nudgeY: 2, depth: -1 };
    }
    if (t === T.WHEAT) {
        const img = pickLoadedImage(bushImg, FERN_NAMES, i, j, 66);
        if (img) {
            const { w, h } = wildDims(img);
            return { img, w, h, anchor: 0.72, depth: -1 };
        }
        return { img: wheatSprite, w: wheatSprite.width, h: wheatSprite.height, anchor: 1, nudgeY: 2, depth: -1 };
    }
    if (t === T.STUMP) {
        return { img: stumpSprite, w: stumpSprite.width, h: stumpSprite.height, anchor: 1, nudgeY: 2, depth: -0.5 };
    }
    if (t === T.ROCK) {
        const img = pickLoadedImage(rockImg, ROCK_NAMES, i, j, 68);
        if (!img) return null;
        const { w, h } = wildDims(img);
        return { img, w, h, anchor: 0.86, depth: -0.25 };
    }
    return null;
}
function wildJitter(i, j, t) {
    const xSpread = t === T.TREE ? 32 : t === T.ROCK ? 5 : t === T.STUMP ? 4 : 7;
    const ySpread = t === T.TREE ? 18 : t === T.ROCK ? 3 : 4;
    return {
        x: Math.round((rand2(i, j, 71) - 0.5) * xSpread),
        y: Math.round((rand2(i, j, 72) - 0.5) * ySpread),
    };
}
function drawWild(spec, x, baseY) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
        spec.img,
        Math.floor(x - spec.w / 2),
        Math.floor(baseY - spec.h * spec.anchor + (spec.nudgeY || 0)),
        spec.w,
        spec.h
    );
    drawLeafDrift(spec, x, baseY);
}
function drawLeafDrift(spec, x, baseY) {
    if (!spec.leaves || world.weather === 'rain' || world.weather === 'storm') return;
    const now = performance.now() / 1700;
    const colors = ['#e0803c', '#c85838', '#d8a038', '#a86828'];
    for (let n = 0; n < 3; n++) {
        const phase = (now + ((spec.seed >>> (n * 7)) & 255) / 255 + n * 0.29) % 1;
        const sway = Math.sin(phase * Math.PI * 2 + n * 1.7);
        const lx = x + sway * spec.w * 0.22 + (n - 1) * spec.w * 0.13;
        const ly = baseY - spec.h * 0.72 + phase * spec.h * 0.52;
        ctx.fillStyle = colors[(spec.seed + n) % colors.length];
        ctx.fillRect(Math.floor(lx), Math.floor(ly), phase > 0.55 ? 2 : 1, 1);
    }
}
function addWildDrawable(list, i, j) {
    const t = world.get(i, j);
    if (t !== T.TREE && t !== T.STUMP && t !== T.WHEAT && t !== T.FLOWER && t !== T.ROCK) return;
    const spec = wildSpec(i, j, t, world.seasonDef);
    if (!spec) return;
    const jitter = wildJitter(i, j, t);
    const x = cam.x + isoX(i, j) + jitter.x;
    const baseY = cam.y + isoY(i, j) + TILE_H + jitter.y;
    const margin = Math.max(spec.w, spec.h) + 24;
    if (x < -margin || x > GW + margin || baseY < -margin || baseY > GH + margin) return;
    list.push({
        y: baseY + spec.depth,
        layer: t === T.TREE ? -2 : t === T.ROCK ? -1 : -3,
        x,
        draw: () => drawWild(spec, x, baseY),
    });
}

function drawSmoke(hx, hy, dispW, dispH, seed = 0) {
    if (!smokeReady || !imageLoaded(smokeSheet)) return;
    const frame = (Math.floor(performance.now() / 150 + seed) % 6);
    const row = seed % 3;
    const sx = frame * 48;
    const sy = row * 16;
    const w = Math.round(dispW * 0.26);
    const h = Math.round(w / 3);
    // Chimney mouth (measured from exterior.png crop): center 26.6% across, top 7.2% down.
    // The puff is off-center within its 48x16 cell AND differs per sheet row (measured):
    // row0 center ~0.39, row1 ~0.59, row2 ~0.63; base is at the cell bottom for every frame.
    const puffCx = [0.39, 0.59, 0.63][row];
    const bob = Math.round(Math.sin(performance.now() / 450 + seed) * 1);
    const x = hx + Math.round(dispW * 0.266 - w * puffCx);   // align this row's puff center to the mouth
    const y = hy + Math.round(dispH * 0.072 - h) - bob;      // sit the puff base on the mouth, rising up
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = 0.85;
    ctx.drawImage(smokeSheet, sx, sy, 48, 16, x, y, w, h);
    ctx.globalAlpha = 1;
}

function addBirds(list) {
    if (!birdJumpReady || !imageLoaded(birdJumpSheet)) return;
    const t = performance.now() / 1000;
    for (let k = 0; k < 4; k++) {
        const phase = t * 0.55 + k * 1.7;
        const active = (phase % 9) < 3.6;
        if (!active) continue;
        const a = k * 1.9 + Math.floor(phase / 9) * 0.7;
        const ri = CENTER + Math.cos(a) * (18 + k * 3);
        const rj = CENTER + Math.sin(a * 0.9 + 0.6) * (14 + k * 2);
        const sx = cam.x + isoX(ri, rj);
        const sy = cam.y + isoY(ri, rj) - 38 - Math.sin((phase % 3.6) / 3.6 * Math.PI) * 12;
        if (sx < -30 || sx > GW + 30 || sy < 18 || sy > GH - 32) continue;
        const frame = Math.floor((phase % 3.6) / 0.15) % 24;
        const tileId = frame < 12 ? frame * 2 : 20 + (frame - 12) * 2;
        const srcX = (tileId % 40) * 16;
        const srcY = Math.floor(tileId / 40) * 16;
        list.push({
            y: sy + 10,
            layer: 4,
            x: sx,
            draw: () => {
                ctx.imageSmoothingEnabled = false;
                ctx.drawImage(birdJumpSheet, srcX, srcY, 32, 16, Math.floor(sx - 10), Math.floor(sy), 20, 10);
            },
        });
    }
}

// ---------------------------------------------------------------------------
// Terrain pre-render (redrawn only when tiles change)
// ---------------------------------------------------------------------------

const TERRAIN_OX = (GRID * TILE_W) / 2;
const [terrain, tctx] = makeCanvas(GRID * TILE_W + TILE_W, GRID * TILE_H + TILE_H);
let terrainDirty = true;

const PATH_C = '#8a7a58';

function hash2(i, j, seed = 0) {
    let h = Math.imul(i | 0, 374761393) ^ Math.imul(j | 0, 668265263) ^ Math.imul(seed | 0, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (h ^ (h >>> 16)) >>> 0;
}
function rand2(i, j, seed = 0) {
    return hash2(i, j, seed) / 4294967296;
}
function lerp(a, b, t) { return a + (b - a) * t; }
function smooth(t) { return t * t * (3 - 2 * t); }
function noise2(i, j, scale, seed = 0) {
    const x = i / scale, y = j / scale;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const tx = smooth(x - x0), ty = smooth(y - y0);
    const a = rand2(x0, y0, seed);
    const b = rand2(x0 + 1, y0, seed);
    const c = rand2(x0, y0 + 1, seed);
    const d = rand2(x0 + 1, y0 + 1, seed);
    return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
}
function pickTile(list, i, j, seed = 0) {
    return list[hash2(i * 31 + j * 17, j * 29 - i * 13, seed) % list.length];
}

function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.max(0, Math.min(255, Math.round(((n >> 16) & 255) * f)));
    const g = Math.max(0, Math.min(255, Math.round(((n >> 8) & 255) * f)));
    const b = Math.max(0, Math.min(255, Math.round((n & 255) * f)));
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

// low-frequency noise -> which grass "patch" a tile belongs to (0..3)
function grassPatch(i, j) {
    const n = noise2(i, j, 8, 12) * 0.55 + noise2(i + 31, j - 17, 19, 13) * 0.35 + rand2(i, j, 14) * 0.1;
    if (n < 0.24) return 1;   // shaded meadow
    if (n > 0.78) return 2;   // sunlit patch
    if (n > 0.55) return 3;   // wildflower / tufted patch
    return 0;                 // plain
}

function redrawTerrain() {
    const season = world.seasonDef;
    const [GRASS_A, GRASS_B] = season.ground;
    const TILLED_C = season.tilled;
    const winter = season.name === 'WINTER';
    const flower = winter ? '#e8eef4' : season.name === 'FALL' ? '#c89040' : season.name === 'SUMMER' ? '#f0d84a' : '#e8709a';
    tctx.fillStyle = '#2a3438';
    tctx.fillRect(0, 0, terrain.width, terrain.height);

    // ground pass
    for (let j = 0; j < GRID; j++) {
        for (let i = 0; i < GRID; i++) {
            const t = world.get(i, j);
            const sx = TERRAIN_OX + isoX(i, j) - TILE_W / 2;
            const sy = isoY(i, j);
            const grassy = t === T.GRASS || t === T.TREE || t === T.STUMP || t === T.WHEAT || t === T.FLOWER || t === T.ROCK;
            let col = (i + j) % 2 ? GRASS_A : GRASS_B;
            let patch = 0;
            if (grassy) {
                patch = grassPatch(i, j);
                if (patch === 1) col = shade(col, 0.88);
                else if (patch === 2) col = shade(col, 1.08);
            }
            if (t === T.TILLED) col = TILLED_C;
            if (t === T.PATH) col = PATH_C;
            if (t === T.HOUSE) col = '#5a5044';
            if (t === T.WATER) col = winter ? '#5a7590' : ((i + j) % 2 ? '#2a5a72' : '#26506a');
            if (t === T.COOP || t === T.BARN) col = '#6a5a44';
            fillDiamond(tctx, sx, sy, col);

            if (t === T.WATER) {
                tctx.fillStyle = winter ? '#8aa8c0' : '#3a6e86';
                tctx.fillRect(sx + 5 + ((i * 5 + j) % 6), sy + 3 + ((i + j) % 3), 2, 1);
            } else if (t === T.TILLED) {
                tctx.fillStyle = winter ? '#b8c0c8' : '#584028';
                tctx.fillRect(sx + 6, sy + 4, 8, 1);
                tctx.fillRect(sx + 6, sy + 6, 8, 1);
            } else if (grassy) {
                const scatter = rand2(i, j, 41);
                const density = patch === 3 ? 0.34 : patch === 2 ? 0.24 : 0.15;
                if (t === T.GRASS && grassDetailsReady && scatter < density) {
                    const useDirt = rand2(i, j, 42) < 0.18;
                    const set = useDirt ? DIRT_DECALS : GRASS_DECALS;
                    const d = pickTile(set, i, j, 43);
                    const scale = 0.44 + rand2(i, j, 44) * 0.24;
                    const dw = Math.round(d.w * scale), dh = Math.round(d.h * scale);
                    const ox = Math.round((rand2(i, j, 45) - 0.5) * 8);
                    const oy = Math.round((rand2(i, j, 46) - 0.5) * 4);
                    tctx.drawImage(grassDetailsImg, d.x, d.y, d.w, d.h,
                        sx + Math.floor(TILE_W / 2 - dw / 2) + ox,
                        sy + Math.floor(TILE_H / 2 - dh / 2) + oy, dw, dh);
                }
                // subtle procedural speckle on non-decal tiles
                else if (patch === 3) {
                    tctx.fillStyle = flower;
                    tctx.fillRect(sx + 5 + Math.floor(rand2(i, j, 47) * 10), sy + 2 + Math.floor(rand2(i, j, 48) * 6), 1, 1);
                } else if (patch === 2 && rand2(i, j, 49) < 0.34) {
                    tctx.fillStyle = shade(GRASS_A, 1.16);
                    tctx.fillRect(sx + 6 + Math.floor(rand2(i, j, 50) * 8), sy + 3 + Math.floor(rand2(i, j, 51) * 4), 1, 2);
                }
            }
        }
    }
    terrainDirty = false;
}

// ---------------------------------------------------------------------------
// Weather particles
// ---------------------------------------------------------------------------

const rain = [];
for (let i = 0; i < 140; i++) rain.push({ x: Math.random() * GW, y: Math.random() * GH, s: 2.4 + Math.random() * 2 });

// season particles: drifting snow / leaves
const drift = [];
for (let i = 0; i < 90; i++) drift.push({ x: Math.random() * GW, y: Math.random() * GH, s: 0.5 + Math.random(), ph: Math.random() * 6.28 });

const LEAF_COLORS = ['#e0803c', '#c85838', '#d8a038', '#a86828'];

function drawWeather(dt, t) {
    const w = world.weather;
    if (w === 'rain' || w === 'storm') {
        const n = w === 'storm' ? 140 : 80;
        ctx.fillStyle = w === 'storm' ? 'rgba(150,180,230,0.7)' : 'rgba(130,170,220,0.55)';
        for (let i = 0; i < n; i++) {
            const p = rain[i];
            p.y += p.s * dt * 60;
            p.x -= dt * 30;
            if (p.y > GH) { p.y = -4; p.x = Math.random() * (GW + 40); }
            ctx.fillRect(Math.floor(p.x), Math.floor(p.y), 1, 3);
        }
    }

    // seasonal drift particles (skip during rain to avoid clutter)
    const sName = world.seasonName;
    if ((sName === 'WINTER' || sName === 'FALL') && w !== 'rain' && w !== 'storm') {
        const isSnow = sName === 'WINTER';
        const n = isSnow ? 90 : 55;
        for (let i = 0; i < n; i++) {
            const p = drift[i];
            p.y += p.s * dt * 60 * (isSnow ? 0.6 : 1);
            p.x += Math.sin(t * 1.5 + p.ph) * dt * (isSnow ? 14 : 24);
            if (p.y > GH) { p.y = -4; p.x = Math.random() * GW; }
            if (isSnow) { ctx.fillStyle = 'rgba(240,246,252,0.9)'; ctx.fillRect(Math.floor(p.x), Math.floor(p.y), 1, 1); }
            else { ctx.fillStyle = LEAF_COLORS[i % LEAF_COLORS.length]; ctx.fillRect(Math.floor(p.x), Math.floor(p.y), 2, 1); }
        }
    }

    // tints
    if (w === 'storm') { ctx.fillStyle = 'rgba(30,34,60,0.32)'; ctx.fillRect(0, 0, GW, GH); }
    else if (w === 'cloud') { ctx.fillStyle = 'rgba(60,66,80,0.16)'; ctx.fillRect(0, 0, GW, GH); }
    else if (w === 'drought') { ctx.fillStyle = 'rgba(230,150,50,0.12)'; ctx.fillRect(0, 0, GW, GH); }
    // gentle cool cast over winter
    if (sName === 'WINTER') { ctx.fillStyle = 'rgba(150,190,230,0.10)'; ctx.fillRect(0, 0, GW, GH); }

    if (world.lightningFlash > 0) {
        ctx.fillStyle = `rgba(240,245,255,${world.lightningFlash * 0.55})`;
        ctx.fillRect(0, 0, GW, GH);
    }

    // day/night tint
    const cycle = world.clock;
    let nightA = 0;
    if (cycle > DAY_LENGTH) {
        const nt = (cycle - DAY_LENGTH) / NIGHT_LENGTH;
        nightA = 0.5 * Math.min(nt * 4, 1) * Math.min((1 - nt) * 4, 1) + (nt > 0.2 && nt < 0.8 ? 0.5 : 0);
        nightA = Math.min(nightA, 0.5);
    } else if (cycle > DAY_LENGTH - 8) {
        // dusk
        const dt2 = (cycle - (DAY_LENGTH - 8)) / 8;
        ctx.fillStyle = `rgba(240,120,50,${dt2 * 0.14})`;
        ctx.fillRect(0, 0, GW, GH);
        nightA = dt2 * 0.18;
    }
    if (nightA > 0) {
        ctx.fillStyle = `rgba(16,22,60,${nightA})`;
        ctx.fillRect(0, 0, GW, GH);
    }
}

// ---------------------------------------------------------------------------
// World rendering
// ---------------------------------------------------------------------------

// Trace the fence outline (boundary corners = posts, boundary edges = rails) of a plot's
// cell set. Cached per plot.rev so the topology is only recomputed when the plot grows.
function plotOutline(plot) {
    if (plot._outline && plot._outlineRev === plot.rev) return plot._outline;
    const cells = plot.cells, rails = [], postSet = new Set();
    const addPost = (ci, cj) => postSet.add(ci + ',' + cj);
    for (const key of cells) {
        const c = key.indexOf(','), i = +key.slice(0, c), j = +key.slice(c + 1);
        if (!cells.has(i + ',' + (j - 1))) { rails.push(i, j, i + 1, j); addPost(i, j); addPost(i + 1, j); }
        if (!cells.has((i + 1) + ',' + j)) { rails.push(i + 1, j, i + 1, j + 1); addPost(i + 1, j); addPost(i + 1, j + 1); }
        if (!cells.has(i + ',' + (j + 1))) { rails.push(i, j + 1, i + 1, j + 1); addPost(i, j + 1); addPost(i + 1, j + 1); }
        if (!cells.has((i - 1) + ',' + j)) { rails.push(i, j, i, j + 1); addPost(i, j); addPost(i, j + 1); }
    }
    const posts = [];
    for (const k of postSet) { const c = k.indexOf(','); posts.push(+k.slice(0, c), +k.slice(c + 1)); }
    plot._outline = { posts, rails }; plot._outlineRev = plot.rev;
    return plot._outline;
}

function collectDrawables() {
    const list = [];

    // Wild foliage has height, so it participates in the same footline sort as
    // farmers and buildings instead of being baked flat into the terrain.
    for (let j = 0; j < GRID; j++) {
        for (let i = 0; i < GRID; i++) addWildDrawable(list, i, j);
    }
    addBirds(list);

    // fences: trace the outline of each plot's cell set (works for any shape, incl.
    // L-shapes). The topology is cached per plot.rev so we don't recompute it each frame.
    for (const plot of world.plots) {
        const o = plotOutline(plot);
        for (let k = 0; k < o.posts.length; k += 2) list.push(post(o.posts[k], o.posts[k + 1]));
        for (let k = 0; k < o.rails.length; k += 4) list.push(rail(o.rails[k], o.rails[k + 1], o.rails[k + 2], o.rails[k + 3]));
    }
    function post(i, j) {
        const sx = cam.x + isoX(i, j), sy = cam.y + isoY(i, j);
        return { y: sy, draw: () => ctx.drawImage(fencePost, Math.floor(sx - 2), Math.floor(sy - 8)) };
    }
    function rail(i0, j0, i1, j1) {
        const ax = cam.x + isoX(i0, j0), ay = cam.y + isoY(i0, j0);
        const bx = cam.x + isoX(i1, j1), by = cam.y + isoY(i1, j1);
        return {
            y: (ay + by) / 2 - 1,      // sort just behind the posts it connects
            draw: () => {
                const steps = Math.max(Math.abs(bx - ax), Math.abs(by - ay), 1);
                // two rails across the upper half of the posts
                for (const [off, col] of [[-6, '#9a7452'], [-1, '#7a5c3c']]) {
                    ctx.fillStyle = col;
                    for (let s = 0; s <= steps; s++) {
                        const t = s / steps;
                        ctx.fillRect(Math.round(ax + (bx - ax) * t) - 1, Math.round(ay + off + (by - ay) * t), 2, 2);
                    }
                }
            },
        };
    }

    // houses
    for (const f of world.farmers) {
        const h = f.plot.house;
        const sx = cam.x + isoX(h.i + 1, h.j + 1);
        const sy = cam.y + isoY(h.i + 1, h.j + 1);
        const spr = houseSprite(f.sheet.colors.hatColor);
        const night = world.isNight();
        const indoors = isIndoors(f);
        list.push({
            y: sy + TILE_H, draw: () => {
                let roofY;
                if (homeReady) {
                    const dispW = 104, dispH = Math.round(dispW * HOUSE_SRC.h / HOUSE_SRC.w);
                    const hx = Math.floor(sx - dispW / 2), hy = Math.floor(sy + TILE_H - dispH + 3);
                    ctx.imageSmoothingEnabled = false;
                    ctx.drawImage(homeSheet, HOUSE_SRC.x, HOUSE_SRC.y, HOUSE_SRC.w, HOUSE_SRC.h, hx, hy, dispW, dispH);
                    if (SMOKE_ENABLED) drawSmoke(hx, hy, dispW, dispH, f.sheet.seed % 9);
                    if (night) {
                        ctx.fillStyle = indoors ? 'rgba(255,220,120,0.5)' : 'rgba(255,220,120,0.22)';
                        ctx.fillRect(hx + Math.floor(dispW * 0.24), hy + Math.floor(dispH * 0.5), 5, 5);
                        ctx.fillRect(hx + Math.floor(dispW * 0.55), hy + Math.floor(dispH * 0.5), 5, 5);
                    }
                    roofY = hy - 6;
                } else {
                    ctx.drawImage(spr, Math.floor(sx - 17), Math.floor(sy - 22));
                    if (night) {
                        ctx.fillStyle = indoors ? '#f0d060' : 'rgba(240,208,96,0.35)';
                        ctx.fillRect(Math.floor(sx - 17) + 7, Math.floor(sy - 22) + 17, 4, 4);
                        ctx.fillRect(Math.floor(sx - 17) + 23, Math.floor(sy - 22) + 17, 4, 4);
                    }
                    roofY = Math.floor(sy - 30);
                }
                // indoor status floating over the roof
                const roofX = Math.floor(sx);
                if (indoors) {
                    if (f.state === 'sick') {
                        const bob = Math.round(Math.sin(performance.now() / 400));
                        drawText(ctx, '+', roofX - 1, roofY + bob, '#c05840');
                    } else if (f.state === 'shelter') {
                        drawText(ctx, '!', roofX - 1, roofY, '#e0a03c');
                    } else {
                        const zt = Math.floor(f.animTime * 2) % 3;
                        drawText(ctx, 'Z', roofX - 1, roofY - zt * 3, `rgba(200,210,255,${1 - zt * 0.25})`);
                    }
                }
                // selection marker over the house if the selected farmer is inside
                if (selected === f && indoors) {
                    const bounce = Math.floor(Math.abs(Math.sin(performance.now() / 250)) * 3);
                    ctx.fillStyle = '#7dd069';
                    ctx.fillRect(roofX - 2, roofY - 8 - bounce, 4, 2);
                    ctx.fillRect(roofX - 1, roofY - 6 - bounce, 2, 2);
                }
            }
        });
    }

    // well + sign
    {
        const w = world.well;
        const sx = cam.x + isoX(w.i, w.j) , sy = cam.y + isoY(w.i, w.j);
        list.push({ y: sy + TILE_H, draw: () => ctx.drawImage(wellSprite, Math.floor(sx - 10 + TILE_W / 2 - 10), Math.floor(sy - 14)) });
        const s = world.sign;
        const sx2 = cam.x + isoX(s.i, s.j), sy2 = cam.y + isoY(s.i, s.j);
        list.push({ y: sy2 + TILE_H, draw: () => ctx.drawImage(signSprite, Math.floor(sx2 + TILE_W / 2 - 9 - 10), Math.floor(sy2 - 8)) });
    }

    // completed structures
    for (const st of world.structures) {
        const sx = cam.x + isoX(st.i, st.j), sy = cam.y + isoY(st.i, st.j);
        let spr = structSprites[st.type];
        if (st.type === 'windmill') spr = spr[Math.floor(performance.now() / 350) % 2];
        list.push({
            y: sy + TILE_H, draw: () =>
                ctx.drawImage(spr, Math.floor(sx - spr.width / 2), Math.floor(sy + TILE_H - spr.height))
        });
    }

    // active build site: scaffold + progress bar + label
    if (world.project) {
        const pr = world.project;
        const sx = cam.x + isoX(pr.site.i, pr.site.j), sy = cam.y + isoY(pr.site.i, pr.site.j);
        list.push({
            y: sy + TILE_H, draw: () => {
                ctx.drawImage(scaffoldSprite, Math.floor(sx - 12), Math.floor(sy + TILE_H - 22));
                const p = Math.min(pr.points / pr.needed, 1);
                ctx.fillStyle = '#20222c';
                ctx.fillRect(Math.floor(sx - 13), Math.floor(sy - 14), 26, 4);
                ctx.fillStyle = '#f0d060';
                ctx.fillRect(Math.floor(sx - 12), Math.floor(sy - 13), Math.floor(24 * p), 2);
                const lbl = pr.label;
                drawText(ctx, lbl, Math.floor(sx - textWidth(lbl) / 2), Math.floor(sy - 22), '#f0d060');
            }
        });
    }

    // crops
    for (const crop of world.crops.values()) {
        const sx = cam.x + isoX(crop.i, crop.j), sy = cam.y + isoY(crop.i, crop.j);
        list.push({
            y: sy + TILE_H * 0.5, draw: () => {
                if (crop.water > 0.45 && !crop.withered) {
                    fillDiamondAlpha(sx - TILE_W / 2 + TILE_W / 2 - 10, sy, 'rgba(40,28,16,0.5)');
                }
                drawCropSprite(crop, sx, sy);
                if (crop.stage === 3 && !crop.withered) {
                    // ready sparkle
                    const tt = performance.now() / 300;
                    if (Math.floor(tt) % 2 === 0) {
                        ctx.fillStyle = '#fff8c0';
                        ctx.fillRect(Math.floor(sx + TILE_W / 2 - 10 + 10), Math.floor(sy - 4), 1, 1);
                    }
                }
            }
        });
    }

    // facilities: buildings, pond life, animals
    for (const plot of world.plots) {
        for (const fac of plot.facilities) {
            // building (coop / barn) + feed trough
            if (fac.struct) {
                const b = fac.struct;
                const bx = cam.x + isoX(b.i + 0.5, b.j + 0.5), by = cam.y + isoY(b.i + 0.5, b.j + 0.5);
                const spr = b.kind === 'barn' ? barnSprite : coopSprite;
                list.push({ y: by + TILE_H, draw: () => ctx.drawImage(spr, Math.floor(bx - spr.width / 2), Math.floor(by + TILE_H - spr.height)) });
            }
            if (fac.trough) {
                const tr = fac.trough;
                const tx = cam.x + isoX(tr.i + 0.5, tr.j + 0.5), ty = cam.y + isoY(tr.i + 0.5, tr.j + 0.5);
                list.push({ y: ty + TILE_H * 0.4, draw: () => ctx.drawImage(troughSprite, Math.floor(tx - 6), Math.floor(ty - 1)) });
            }
            // producers
            for (const p of fac.producers) {
                const px = cam.x + isoX(p.fx, p.fy), py = cam.y + isoY(p.fx, p.fy);
                list.push({ y: py + TILE_H * 0.5, draw: () => drawProducer(p, px, py) });
            }
        }
    }

    // lightning strike marker
    if (world.struckTile) {
        const st = world.struckTile;
        const sx = cam.x + isoX(st.i, st.j), sy = cam.y + isoY(st.i, st.j);
        list.push({
            y: sy + 999, draw: () => {
                ctx.fillStyle = `rgba(255,250,180,${st.t})`;
                ctx.fillRect(Math.floor(sx + TILE_W / 2 - 1 - 10), 0, 2, Math.floor(sy + TILE_H / 2));
            }
        });
    }

    // farmers (skip anyone tucked inside their house)
    for (const f of world.farmers) {
        if (isIndoors(f)) continue;
        const sx = cam.x + isoX(f.pos.i, f.pos.j);
        const sy = cam.y + isoY(f.pos.i, f.pos.j);
        list.push({ y: sy + TILE_H * 0.5 + 0.1, draw: () => drawFarmer(f, sx, sy) });
    }

    return list;
}

function fillDiamondAlpha(sx, sy, color) {
    fillDiamond(ctx, Math.floor(sx), Math.floor(sy), color);
}

function drawProducer(p, px, py) {
    if (p.kind === 'pad') {
        const spr = lilyPadSprites[p.ready ? 1 : 0];
        ctx.drawImage(spr, Math.floor(px - 7), Math.floor(py - 5));
        return;
    }
    // real animal sheets for livestock/poultry
    if (p.kind !== 'fish' && drawAnimal(p, px, py)) {
        if (p.ready) {
            const bob = Math.round(Math.sin(performance.now() / 250 + p.anim) * 1);
            ctx.fillStyle = PRODUCT_ICON[p.kind] || '#fff';
            const iy = Math.floor(py - (ANIMAL_SHEETS[p.kind].disp * 0.86) - 4 + bob);
            ctx.fillRect(Math.floor(px - 1), iy, 2, 2);
            ctx.fillRect(Math.floor(px - 2), iy + 1, 4, 1);
        }
        return;
    }
    const frame = Math.floor(p.anim * (p.kind === 'chicken' ? 6 : 3)) % 2;
    const sprSet = producerSprites[p.kind];
    if (!sprSet) return;
    const spr = sprSet[frame];
    const hop = p.hop > 0 ? Math.round(Math.sin((0.35 - p.hop) / 0.35 * Math.PI) * 2) : 0;
    const w = spr.width;

    if (p.kind === 'fish') {
        // fish shimmer just under the surface
        ctx.globalAlpha = 0.85;
    }
    if (p.flip < 0) {
        ctx.save();
        ctx.translate(Math.floor(px + w / 2), Math.floor(py - spr.height / 2 - hop));
        ctx.scale(-1, 1);
        ctx.drawImage(spr, 0, 0);
        ctx.restore();
    } else {
        ctx.drawImage(spr, Math.floor(px - w / 2), Math.floor(py - spr.height / 2 - hop));
    }
    ctx.globalAlpha = 1;

    // ready-to-collect product bobbing above
    if (p.ready) {
        const bob = Math.round(Math.sin(performance.now() / 250 + p.anim) * 1);
        const iy = Math.floor(py - spr.height / 2 - 6 + bob);
        ctx.fillStyle = PRODUCT_ICON[p.kind] || '#fff';
        ctx.fillRect(Math.floor(px - 1), iy, 2, 2);
        ctx.fillRect(Math.floor(px - 2), iy + 1, 4, 1);
    }
}

// Is this farmer tucked inside their house (asleep / resting / ill / sheltering)?
function isIndoors(f) {
    return f.state === 'sleep' || f.state === 'rest' || f.state === 'sick' || f.state === 'shelter';
}

function drawFarmer(f, sx, sy) {
    const frames = farmerSprites(f);
    let frame = frames.idle;
    if (f.state === 'walk') {
        frame = Math.floor(f.animTime * 7) % 2 ? frames.walk1 : frames.walk2;
    } else if (f.state === 'work' || f.state === 'build' || f.state === 'chop' || f.state === 'break' || f.state === 'forage') {
        frame = Math.floor(f.animTime * 5) % 2 ? frames.work : frames.idle;
    } else if (f.state === 'sleep') {
        frame = frames.sleep;
    }

    const fw = frame.width, fh = frame.height;
    const px = Math.floor(sx - fw / 2);
    const py = Math.floor(sy + TILE_H / 2 - fh + 2);
    const footY = py + fh - 2;

    // lantern glow for anyone up and about at night
    const awakeAtNight = world.isNight() && f.state !== 'sleep' && f.state !== 'shelter';
    if (awakeAtNight) {
        const flick = 0.5 + 0.12 * Math.sin(f.animTime * 9);
        const g = ctx.createRadialGradient(sx, py + 10, 2, sx, py + 10, 22);
        g.addColorStop(0, `rgba(245,215,90,${0.45 * flick})`);
        g.addColorStop(1, 'rgba(245,215,90,0)');
        ctx.fillStyle = g;
        ctx.fillRect(sx - 22, py - 12, 44, 44);
    }

    // tiny shadow
    ctx.fillStyle = 'rgba(10,14,10,0.35)';
    ctx.fillRect(px + 4, footY, fw - 8, 2);

    if (f.facing < 0) {
        ctx.save();
        ctx.translate(px + fw, py);
        ctx.scale(-1, 1);
        ctx.drawImage(frame, 0, 0);
        ctx.restore();
    } else {
        ctx.drawImage(frame, px, py);
    }

    // sick tint overlay
    if (f.health === 'sick' && f.state !== 'sleep') {
        ctx.fillStyle = 'rgba(120,200,120,0.28)';
        ctx.fillRect(px + 4, py + 3, fw - 8, 8);
    }

    // carried lantern when working at night
    if (awakeAtNight && (f.state === 'work' || f.state === 'walk' || f.state === 'build')) {
        ctx.drawImage(lanternSprite, px + (f.facing < 0 ? -3 : fw - 1), py + 9);
    }

    // carrying water indicator
    if (f.carryWater > 0 && f.state !== 'sleep') {
        ctx.fillStyle = '#5a8ac8';
        ctx.fillRect(px + (f.facing < 0 ? -2 : fw), py + 11, 2, 3);
    }

    // freshly-picked produce held up above the head (real Supplies.png icon)
    if (f.carryCrop && suppliesReady && imageLoaded(suppliesSheet) && PRODUCE_ICONS[f.carryCrop.type]) {
        const [ix, iy, iw, ih] = PRODUCE_ICONS[f.carryCrop.type];
        const sc = Math.min(1, 11 / Math.max(iw, ih));
        const dw = Math.max(1, Math.round(iw * sc)), dh = Math.max(1, Math.round(ih * sc));
        const bob = Math.round(Math.sin(performance.now() / 200));
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(suppliesSheet, ix, iy, iw, ih, Math.floor(px + fw / 2 - dw / 2), Math.floor(py - dh - 3 + bob), dw, dh);
    }

    // work progress pips
    if (f.state === 'work' && f.action) {
        const p = 1 - f.action.timer / f.action.total;
        ctx.fillStyle = '#20222c';
        ctx.fillRect(px + 2, py - 4, 12, 2);
        ctx.fillStyle = '#7dd069';
        ctx.fillRect(px + 2, py - 4, Math.floor(12 * p), 2);
    }

    // status icon: sick (+) or worn out (~) while out and about, unless a bubble shows
    if (!f.bubble) {
        if (f.health === 'sick') {
            const bob = Math.floor(Math.sin(performance.now() / 400) * 1);
            drawText(ctx, '+', px + 6, py - 8 + bob, '#c05840');
        } else if (f.tired) {
            drawText(ctx, '~', px + 6, py - 7, '#e0a03c');
        }
    }

    // speech bubble
    if (f.bubble) {
        const w = textWidth(f.bubble.text) + 4;
        const bx = Math.floor(sx - w / 2);
        const by = py - 10;
        ctx.fillStyle = 'rgba(16,18,26,0.85)';
        ctx.fillRect(bx, by, w, 9);
        drawText(ctx, f.bubble.text, bx + 2, by + 2, f.bubble.color);
    }

    // sparkles (level up / crit)
    if (f.sparkle > 0) {
        ctx.fillStyle = '#f0d060';
        for (let i = 0; i < 5; i++) {
            const a = f.animTime * 6 + i * 1.3;
            ctx.fillRect(
                Math.floor(sx + Math.cos(a) * 9),
                Math.floor(py + 6 + Math.sin(a * 1.4) * 8),
                1, 1);
        }
    }

    // selection marker
    if (selected === f) {
        const bounce = Math.floor(Math.abs(Math.sin(performance.now() / 250)) * 3);
        ctx.fillStyle = '#7dd069';
        const ax = Math.floor(sx - 1);
        const ay = py - 8 - bounce;
        ctx.fillRect(ax - 1, ay, 4, 2);
        ctx.fillRect(ax, ay + 2, 2, 2);
    }
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

const BTN = { x: GW - 34, y: 3, w: 30, h: 12 };

// Minimap legend (bottom-right): faint land/buildings, bright farmer dots, a viewport box.
// Click it to jump the camera. Buildings are low-contrast; a home = 4 dots, a well = 1.
function drawMinimap() {
    MINIMAP.x = GW - MINIMAP.w - 5;
    MINIMAP.y = GH - 22 - MINIMAP.h - 5;
    const { x: mx, y: my, w: mw, h: mh } = MINIMAP;
    const t2m = (i, j) => [mx + (i / GRID) * mw, my + (j / GRID) * mh];
    const dot = (i, j, col, s = 1) => { const [px, py] = t2m(i, j); ctx.fillStyle = col; ctx.fillRect(Math.floor(px), Math.floor(py), s, s); };

    ctx.fillStyle = 'rgba(10,11,15,0.9)';
    ctx.fillRect(mx - 3, my - 3, mw + 6, mh + 6);
    ctx.fillStyle = 'rgba(34,36,42,0.92)';            // dark-gray field
    ctx.fillRect(mx, my, mw, mh);
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.strokeRect(mx - 2.5, my - 2.5, mw + 5, mh + 5);

    ctx.save();
    ctx.beginPath(); ctx.rect(mx, my, mw, mh); ctx.clip();

    // owned land (very low contrast)
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    for (const p of world.plots) {
        const [px, py] = t2m(p.x, p.y);
        ctx.fillRect(Math.floor(px), Math.floor(py), Math.max(1, Math.round(p.w / GRID * mw)), Math.max(1, Math.round(p.h / GRID * mh)));
    }
    // wells + sign = 1 low-contrast dot each
    for (const wl of world.wells) dot(wl.i, wl.j, 'rgba(120,170,210,0.7)', 1);
    dot(world.sign.i, world.sign.j, 'rgba(180,150,110,0.7)', 1);
    // communal structures = 2px low-contrast
    for (const s of world.structures) dot(s.i, s.j, 'rgba(160,160,180,0.7)', 2);
    // facilities (coop/barn) low-contrast
    for (const p of world.plots) for (const fac of p.facilities) if (fac.struct) dot(fac.struct.i, fac.struct.j, 'rgba(150,120,90,0.7)', 2);
    // homes = a 4-dot (2x2) low-contrast grey cluster
    ctx.fillStyle = 'rgba(150,156,168,0.75)';
    for (const p of world.plots) { const [px, py] = t2m(p.house.i, p.house.j); ctx.fillRect(Math.floor(px), Math.floor(py), 2, 2); }

    // current viewport (the on-screen diamond)
    const corners = [screenToTile(0, 18), screenToTile(GW, 18), screenToTile(GW, GH - 22), screenToTile(0, GH - 22)];
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    corners.forEach((c, k) => { const [px, py] = t2m(c.i, c.j); k ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
    ctx.closePath(); ctx.stroke();

    // farmers = bright high-contrast dots (on top)
    for (const f of world.farmers) {
        const col = f === selected ? '#ffffff' : (f.sheet.colors.hatColor || '#f0d060');
        const [px, py] = t2m(f.pos.i, f.pos.j);
        if (f === selected) { ctx.fillStyle = '#000'; ctx.fillRect(Math.floor(px) - 1, Math.floor(py) - 1, 4, 4); }
        ctx.fillStyle = col; ctx.fillRect(Math.floor(px), Math.floor(py), 2, 2);
    }
    ctx.restore();
}

function drawUI() {
    BTN.x = GW - 34;
    // top bar
    ctx.fillStyle = 'rgba(12,14,22,0.92)';
    ctx.fillRect(0, 0, GW, 18);
    ctx.fillStyle = '#20242f';
    ctx.fillRect(0, 18, GW, 1);

    drawText(ctx, 'RY FARMS', 4, 4, '#7dd069', 2);
    let hx = 74;
    hx += drawText(ctx, `DAY ${world.day}`, hx, 7, '#c8ccd8') + 8;

    // season (color-coded)
    const season = world.seasonDef;
    hx += drawText(ctx, season.name, hx, 7, season.accent) + 8;

    // weather (blink on storm)
    const wl = world.weatherLabel;
    const blink = world.weather === 'storm' && Math.floor(performance.now() / 300) % 2 === 0;
    const wcol = { sun: '#f0d060', cloud: '#9aa0b4', rain: '#6a9ade', storm: '#e05840', drought: '#e0a03c' }[world.weather];
    if (!blink) drawText(ctx, wl, hx, 7, wcol);
    hx += textWidth(wl) + 8;

    hx += drawText(ctx, `CROPS ${world.harvestTotal}`, hx, 7, '#e8c860') + 8;
    hx += drawText(ctx, `MEM ${memories.length}`, hx, 7, '#9aa0b4') + 8;

    // night indicator
    if (world.isNight()) hx += drawText(ctx, 'NIGHT', hx, 7, '#8a9ade') + 6;

    // open help requests
    if (world.helpBoard.length) {
        if (Math.floor(performance.now() / 500) % 2 === 0) drawText(ctx, `HELP!X${world.helpBoard.length}`, hx, 7, '#e0a03c');
    }

    // roster nav button (left of +RY)
    ROSTER_BTN.x = BTN.x - ROSTER_BTN.w - 6;
    ctx.fillStyle = rosterOpen ? '#7dd069' : 'rgba(255,255,255,0.08)';
    ctx.fillRect(ROSTER_BTN.x, ROSTER_BTN.y, ROSTER_BTN.w, ROSTER_BTN.h);
    ctx.fillStyle = rosterOpen ? '#7dd069' : 'rgba(255,255,255,0.2)';
    if (!rosterOpen) { ctx.strokeStyle = 'rgba(255,255,255,0.2)'; }
    drawText(ctx, 'ROSTER', ROSTER_BTN.x + 5, ROSTER_BTN.y + 4, rosterOpen ? '#10240c' : '#c8ccd8');

    // spawn button
    const full = !world.slots.some(s => !s.used);
    ctx.fillStyle = full ? '#3a3f4c' : '#7dd069';
    ctx.fillRect(BTN.x, BTN.y, BTN.w, BTN.h);
    drawText(ctx, '+RY', BTN.x + 9, BTN.y + 4, full ? '#6a6f7c' : '#10240c');

    // bottom log
    ctx.fillStyle = 'rgba(12,14,22,0.92)';
    ctx.fillRect(0, GH - 22, GW, 22);
    ctx.fillStyle = '#20242f';
    ctx.fillRect(0, GH - 23, GW, 1);
    const logs = world.log.slice(-2);
    logs.forEach((l, i) => {
        let text = l.text.toUpperCase();
        if (text.length > 96) text = text.slice(0, 96);
        drawText(ctx, text, 4, GH - 19 + i * 8, l.color);
    });

    if (rosterOpen) drawRoster();
    else { if (selected) drawSheet(selected); drawMinimap(); }
}

function wrapText(str, maxChars) {
    const words = String(str).split(' ');
    const lines = [];
    let cur = '';
    for (const w of words) {
        if ((cur + ' ' + w).trim().length > maxChars) {
            if (cur) lines.push(cur.trim());
            cur = w;
        } else cur += ' ' + w;
    }
    if (cur.trim()) lines.push(cur.trim());
    return lines;
}

const TRAIT_COLORS = {
    collaboration: '#7dd069', competitiveness: '#e0803c', honesty: '#6a9ade', diligence: '#f0d060',
};
const FAC_SHORT = { pond: 'pond', coop: 'coop', pen: 'pen' };
const ACT_WORD = { collect: 'gathering', tend: 'tending', harvest: 'harvesting', water: 'watering', plant: 'planting', till: 'tilling', clear: 'clearing' };

function barFill(x, y, w, frac, color, bg = '#20242f') {
    ctx.fillStyle = bg;
    ctx.fillRect(x, y, w, 3);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, Math.max(0, Math.floor(w * Math.min(frac, 1))), 3);
}

function drawSheet(f) {
    const s = f.sheet;
    const p = s.personality;
    const PW = 142, PX = GW - PW - 4, PY = 22;
    const memLines = wrapText(s.memory.title, 33).slice(0, 3);
    const thinkLines = wrapText(f.thought, 33).slice(0, 2);
    const creedLines = wrapText(p.creed, 33).slice(0, 2);
    const PH = 230 + (memLines.length + thinkLines.length + creedLines.length) * 7;

    ctx.fillStyle = 'rgba(12,14,24,0.95)';
    ctx.fillRect(PX, PY, PW, PH);
    const border = f.health === 'sick' ? '#c05840' : '#7dd069';
    ctx.fillStyle = border;
    ctx.fillRect(PX, PY, PW, 1);
    ctx.fillRect(PX, PY + PH - 1, PW, 1);
    ctx.fillRect(PX, PY, 1, PH);
    ctx.fillRect(PX + PW - 1, PY, 1, PH);

    let y = PY + 5;
    drawText(ctx, s.name, PX + 5, y, '#fff', 1); y += 8;
    drawText(ctx, `${p.label.toUpperCase()} - ${s.archetype} LV${s.level}`, PX + 5, y, '#7dd069'); y += 7;
    for (const line of creedLines) { drawText(ctx, `"${line}"`, PX + 5, y, '#9aa0b4'); y += 7; }

    // xp bar
    barFill(PX + 5, y, PW - 10, Math.min(s.xp / (s.level * 12), 1), '#5a8ac8'); y += 7;

    // energy + health line
    const eCol = f.health === 'sick' ? '#c05840' : f.tired ? '#e0a03c' : '#7dd069';
    drawText(ctx, 'ENERGY', PX + 5, y, '#9aa0b4');
    barFill(PX + 42, y, PW - 82, f.energy, eCol);
    const hStr = f.health === 'sick' ? 'SICK' : f.tired ? 'TIRED' : 'WELL';
    drawText(ctx, hStr, PX + PW - 32, y, eCol);
    y += 9;

    // personality trait bars
    TRAIT_NAMES.forEach((tn) => {
        drawText(ctx, TRAIT_LABELS[tn], PX + 5, y, '#9aa0b4');
        barFill(PX + 58, y, PW - 66, p[tn], TRAIT_COLORS[tn]);
        y += 7;
    });
    y += 3;

    // stats, two columns
    const cols = [PX + 5, PX + 74];
    STAT_NAMES.forEach((st, i) => {
        const cx = cols[i % 2];
        const cy = y + Math.floor(i / 2) * 8;
        drawText(ctx, st.toUpperCase(), cx, cy, '#9aa0b4');
        drawText(ctx, String(s.stats[st]).padStart(2), cx + 17, cy, '#fff');
        drawText(ctx, fmtMod(s.stats[st]), cx + 29, cy, mod(s.stats[st]) >= 0 ? '#7dd069' : '#e05840');
    });
    y += 26;

    drawText(ctx, `CROP:${s.crop} FARM ${f.plot.w}X${f.plot.h}`, PX + 5, y, '#e8c860'); y += 8;
    // facilities the farm has diversified into
    const facs = ['crops', ...f.plot.facilities.map(fc => FAC_SHORT[fc.type] || fc.type)];
    drawText(ctx, `HAS: ${facs.join(' + ')}`.slice(0, 34), PX + 5, y, '#7dd0c0'); y += 8;
    const rep = Math.round(f.reputation * 100);
    drawText(ctx, `YIELD:${s.harvested} WOOD:${f.wood} REP:${rep}`, PX + 5, y, '#e8c860'); y += 8;
    drawText(ctx, `BONDS:${world.bondCount(f)}${f.wantExpand ? '  (WANTS LAND)' : f.wantFacility ? '  (WANTS TO BUILD)' : ''}`, PX + 5, y, '#e8c860'); y += 8;
    const helping = f.helpTask ? ` ${f.helpTask.requester.sheet.name.split(' ')[0]}` : '';
    const actWord = f.action ? (ACT_WORD[f.action.task?.act] || f.action.task?.act || 'working') : '';
    const doing = f.state === 'work' ? actWord + helping
        : f.state === 'chop' ? 'chopping wood'
        : f.state === 'break' ? 'clearing a stump'
        : f.state === 'forage' ? 'foraging wheat'
        : f.state === 'poach' ? 'sneaking'
        : f.state === 'build' ? 'building'
        : f.state === 'care' ? 'tending sick'
        : f.state === 'sick' ? 'recovering'
        : f.state === 'rest' ? 'napping'
        : f.state === 'decide-help' || (f.state === 'walk' && f.helpTask) ? 'helping' + helping
        : f.state === 'sleep' ? 'sleeping'
        : f.state === 'shelter' ? 'sheltering'
        : f.state === 'walk' ? 'walking' : 'thinking';
    drawText(ctx, `NOW: ${doing}`, PX + 5, y, '#c8ccd8'); y += 10;

    drawText(ctx, 'THINKS:', PX + 5, y, '#9aa0b4'); y += 7;
    for (const line of thinkLines) { drawText(ctx, `"${line}"`, PX + 5, y, '#c8ccd8'); y += 7; }
    y += 3;

    drawText(ctx, 'GROWN FROM MEMORY:', PX + 5, y, '#9aa0b4'); y += 7;
    for (const line of memLines) { drawText(ctx, line, PX + 5, y, '#8a9ade'); y += 7; }
}

// ---------------------------------------------------------------------------
// Roster — a simplified stat list of every farmer, sorted by yield
// ---------------------------------------------------------------------------

let rosterRows = [];              // { farmer, y0, y1 } hit regions (screen px)
let rosterView = null;            // { x, y, w, h, bodyTop, bodyBot, rowH, maxScroll }

function rosterSorted() {
    return [...world.farmers].sort((a, b) => b.sheet.harvested - a.sheet.harvested);
}

function drawRoster() {
    const PW = Math.min(GW - 24, 300);
    const PH = GH - 40;
    const PX = Math.floor((GW - PW) / 2);
    const PY = 22;
    rosterRows = [];

    // dim the world behind
    ctx.fillStyle = 'rgba(6,7,11,0.72)';
    ctx.fillRect(0, 18, GW, GH - 40);

    // panel
    ctx.fillStyle = 'rgba(12,14,24,0.97)';
    ctx.fillRect(PX, PY, PW, PH);
    ctx.fillStyle = '#7dd069';
    ctx.fillRect(PX, PY, PW, 1); ctx.fillRect(PX, PY + PH - 1, PW, 1);
    ctx.fillRect(PX, PY, 1, PH); ctx.fillRect(PX + PW - 1, PY, 1, PH);

    // header
    drawText(ctx, 'TOWN ROSTER', PX + 6, PY + 5, '#7dd069', 1);
    drawText(ctx, `${world.farmers.length} RYS`, PX + PW - 40, PY + 5, '#9aa0b4');
    // close X
    drawText(ctx, 'X', PX + PW - 10, PY + 5, '#c8ccd8');

    // column header
    const hy = PY + 16;
    const colName = PX + 6;
    const colStats = PX + 78;
    const statW = (PW - 78 - 30) / 6;
    drawText(ctx, 'NAME', colName, hy, '#6a6f7c');
    drawText(ctx, 'LV', PX + 60, hy, '#6a6f7c');
    ['ST', 'DE', 'CO', 'IN', 'WI', 'CH'].forEach((c, i) =>
        drawText(ctx, c, Math.floor(colStats + i * statW), hy, '#6a6f7c'));
    drawText(ctx, 'YLD', PX + PW - 22, hy, '#6a6f7c');
    ctx.fillStyle = '#20242f';
    ctx.fillRect(PX + 4, hy + 8, PW - 8, 1);

    // scrollable body (clipped)
    const bodyTop = hy + 11;
    const bodyBot = PY + PH - 5;
    const rowH = 11;
    const rows = rosterSorted();
    const maxScroll = Math.max(0, rows.length * rowH - (bodyBot - bodyTop));
    rosterScroll = Math.max(0, Math.min(rosterScroll, maxScroll));
    rosterView = { x: PX, y: PY, w: PW, h: PH, bodyTop, bodyBot, rowH, maxScroll };

    ctx.save();
    ctx.beginPath();
    ctx.rect(PX + 1, bodyTop - 1, PW - 2, bodyBot - bodyTop + 1);
    ctx.clip();

    rows.forEach((f, idx) => {
        const ry = bodyTop + idx * rowH - rosterScroll;
        if (ry + rowH < bodyTop || ry > bodyBot) return;   // off-screen
        const s = f.sheet;
        const isLeader = world.leader === f;
        if (selected === f) { ctx.fillStyle = 'rgba(125,208,105,0.16)'; ctx.fillRect(PX + 2, ry - 1, PW - 4, rowH); }
        // health-tinted name; leader gets a star
        const nameCol = f.health === 'sick' ? '#e07868' : f.tired ? '#e0a03c' : '#e8ecf5';
        const nm = (isLeader ? '*' : '') + s.name.replace(' Ry', '');
        drawText(ctx, nm.slice(0, 14), colName, ry + 1, nameCol);
        drawText(ctx, String(s.level), PX + 60, ry + 1, '#7dd069');
        STAT_NAMES.forEach((st, i) => {
            drawText(ctx, String(s.stats[st]).padStart(2), Math.floor(colStats + i * statW), ry + 1, '#c8ccd8');
        });
        drawText(ctx, String(s.harvested), PX + PW - 22, ry + 1, '#e8c860');
        rosterRows.push({ farmer: f, y0: ry, y1: ry + rowH });
    });
    ctx.restore();

    // scrollbar
    if (maxScroll > 0) {
        const trackH = bodyBot - bodyTop;
        const thumbH = Math.max(8, trackH * trackH / (rows.length * rowH));
        const thumbY = bodyTop + (trackH - thumbH) * (rosterScroll / maxScroll);
        ctx.fillStyle = 'rgba(255,255,255,0.14)';
        ctx.fillRect(PX + PW - 3, bodyTop, 2, trackH);
        ctx.fillStyle = '#7dd069';
        ctx.fillRect(PX + PW - 3, Math.floor(thumbY), 2, Math.floor(thumbH));
    }

    drawText(ctx, 'CLICK A RY FOR DETAILS - SCROLL TO SEE MORE', PX + 6, PY + PH - 9, '#4a4f5c');
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

function gamePoint(e) {
    const rect = out.getBoundingClientRect();
    return crt.screenToGame(e.clientX - rect.left, e.clientY - rect.top);
}

out.addEventListener('pointerdown', (e) => {
    const p = gamePoint(e);
    mouse.downX = p.x; mouse.downY = p.y;
    // don't world-pan when the gesture starts on the minimap
    const onMap = !rosterOpen && inRect(p, MINIMAP);
    mouse.panStart = (rosterOpen || onMap) ? null : { x: p.x, y: p.y, camX: cam.x, camY: cam.y };
    mouse.dragging = false;
    out.setPointerCapture(e.pointerId);
});

out.addEventListener('pointermove', (e) => {
    const p = gamePoint(e);
    mouse.x = p.x; mouse.y = p.y;
    if (mouse.panStart) {
        const dx = p.x - mouse.panStart.x, dy = p.y - mouse.panStart.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) mouse.dragging = true;
        if (mouse.dragging) {
            cam.x = mouse.panStart.camX + dx;
            cam.y = mouse.panStart.camY + dy;
        }
    }
});

function inRect(p, r) { return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h; }

out.addEventListener('pointerup', (e) => {
    const wasDrag = mouse.dragging;
    mouse.panStart = null;
    mouse.dragging = false;
    if (wasDrag || !booted) return;
    const p = gamePoint(e);

    // roster toggle button
    if (inRect(p, ROSTER_BTN)) { rosterOpen = !rosterOpen; return; }

    // roster overlay interactions
    if (rosterOpen) {
        const rv = rosterView;
        if (rv) {
            // close X (top-right of panel) or clicking outside the panel closes it
            if ((p.x > rv.x + rv.w - 14 && p.y < rv.y + 12) ||
                p.x < rv.x || p.x > rv.x + rv.w || p.y < rv.y || p.y > rv.y + rv.h) {
                rosterOpen = false;
                return;
            }
            // row click -> select that farmer, keep roster open for browsing
            for (const row of rosterRows) {
                if (p.y >= row.y0 && p.y <= row.y1 && p.x > rv.x && p.x < rv.x + rv.w) {
                    selected = row.farmer;
                    rosterOpen = false;   // jump to their detail sheet
                    return;
                }
            }
        }
        return;
    }

    // minimap: jump the camera to the clicked spot
    if (inRect(p, MINIMAP)) {
        const ti = (p.x - MINIMAP.x) / MINIMAP.w * GRID;
        const tj = (p.y - MINIMAP.y) / MINIMAP.h * GRID;
        cam.x = GW / 2 - isoX(ti, tj);
        cam.y = GH / 2 - isoY(ti, tj);
        return;
    }

    // spawn button
    if (inRect(p, BTN)) { spawnFarmer(); return; }

    // farmer?
    let best = null, bestD = 1.6;
    const tile = screenToTile(p.x, p.y);
    for (const f of world.farmers) {
        const d = Math.hypot(f.pos.i - tile.i + 0.0, f.pos.j - tile.j);
        if (d < bestD) { bestD = d; best = f; }
    }
    selected = best;
});

// wheel scrolls the roster
out.addEventListener('wheel', (e) => {
    if (!rosterOpen) return;
    e.preventDefault();
    rosterScroll += e.deltaY * 0.5;
}, { passive: false });

// ---------------------------------------------------------------------------
// Spawning
// ---------------------------------------------------------------------------

function pickMemory() {
    const unused = memories.filter(m => !usedMemoryIds.has(m.id));
    const pool = unused.length ? unused : memories;
    // Deterministic pick: stable order by hashed id, so the same seed + docs always
    // grow the same roster (reproducible cast of Ry Bots each load).
    let best = pool[0], bestH = 0xffffffff;
    for (const m of pool) {
        const h = hashString((m.id || m.title || '') + ':pick');
        if (h < bestH) { bestH = h; best = m; }
    }
    usedMemoryIds.add(best.id);
    return best;
}

function spawnFarmer() {
    if (!world.slots.some(s => !s.used)) {
        world.addLog('No plots left! The valley is full.', '#e0a03c');
        return;
    }
    const f = world.addFarmer(pickMemory());
    if (f) { terrainDirty = true; selected = f; }
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

let last = performance.now();

function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    const t = now / 1000;

    if (!booted) {
        drawBootScreen(t);
        crt.render(t);
        return;
    }

    world.tick(dt * (world._speedMult || 1));

    // background
    ctx.fillStyle = '#2a3438';
    ctx.fillRect(0, 0, GW, GH);

    if (terrainDirty || world._tilesChanged) {
        world._tilesChanged = false;
        redrawTerrain();
    }
    ctx.drawImage(terrain, Math.floor(cam.x - TERRAIN_OX), Math.floor(cam.y));

    // hover tile highlight
    if (mouse.x >= 0 && !mouse.dragging) {
        const tile = screenToTile(mouse.x, mouse.y);
        const ti = Math.floor(tile.i), tj = Math.floor(tile.j);
        if (ti >= 0 && tj >= 0 && ti < GRID && tj < GRID) {
            strokeDiamond(ctx, Math.floor(cam.x + isoX(ti, tj) - TILE_W / 2 + TILE_W / 2 - 10), Math.floor(cam.y + isoY(ti, tj)), 'rgba(255,255,255,0.35)');
        }
    }

    // y-sorted world objects
    const drawables = collectDrawables();
    drawables.sort((a, b) => (a.y - b.y) || ((a.layer || 0) - (b.layer || 0)) || ((a.x || 0) - (b.x || 0)));
    for (const d of drawables) d.draw();

    drawWeather(dt, t);
    drawUI();

    crt.setPalette(hexPalette(world.seasonDef.dmg));
    crt.render(t);
}

// convert a season's 4 hex shades into [r,g,b] 0..1 arrays for the shader
const _palCache = {};
function hexPalette(hexes) {
    const key = hexes.join(',');
    if (_palCache[key]) return _palCache[key];
    const pal = hexes.map(h => {
        const n = parseInt(h.slice(1), 16);
        return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    });
    _palCache[key] = pal;
    return pal;
}

// boot screen: static + title card
function drawBootScreen(t) {
    bootTime += 1 / 60;
    // static noise
    const img = ctx.createImageData(GW, GH);
    for (let i = 0; i < img.data.length; i += 4) {
        const v = Math.random() * 110;
        img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    if (bootTime > 0.7) {
        ctx.fillStyle = 'rgba(10,12,18,0.88)';
        ctx.fillRect(0, 0, GW, GH);
        drawText(ctx, 'RY FARMS', GW / 2 - textWidth('RY FARMS', 3) / 2, 110, '#7dd069', 3);
        drawText(ctx, 'GROWN FROM SUPERMEMORY', GW / 2 - textWidth('GROWN FROM SUPERMEMORY') / 2, 140, '#9aa0b4');
        const dots = '.'.repeat(1 + (Math.floor(t * 3) % 3));
        drawText(ctx, `TUNING CHANNEL${dots}`, GW / 2 - textWidth('TUNING CHANNEL...') / 2, 158, '#6a9ade');
    }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

(async function boot() {
    requestAnimationFrame(frame);
    loadAssetArt();

    const result = await fetchMemories();
    memories = result.memories;
    memorySource = result.source;

    world = new World(20260705);
    // hook tile changes to terrain redraw
    const origSet = world.set.bind(world);
    world.set = (i, j, t) => { origSet(i, j, t); world._tilesChanged = true; };

    for (let i = 0; i < 5; i++) spawnFarmer();
    selected = null;

    // center camera on the well
    cam.x = GW / 2 - isoX(world.well.i, world.well.j);
    cam.y = GH / 2 - isoY(world.well.i, world.well.j) - 20;

    world.addLog(`${memories.length} memories loaded from ${memorySource}`, '#8a9ade');
    world.addLog('Click a farmer to read their sheet. Drag to pan.', '#9aa0b4');

    // let the tuning screen breathe for a moment
    setTimeout(() => { booted = true; }, 1400);

    window.RYFARMS = {  // debug handle
        world, cam,
        select: (i) => { selected = world.farmers[i] || null; },
        speed: (mult) => { world._speedMult = mult; },
        animalRow: (n) => { ANIMAL_SIDE_ROW = n; },
    };
})();
