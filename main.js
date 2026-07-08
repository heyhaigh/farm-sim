// main.js — Ry Farms: rendering, camera, input, UI, boot.

import { fetchMemories, mod, fmtMod, STAT_NAMES, TRAIT_NAMES, TRAIT_LABELS, hashString } from './dna.js';
import { audio } from './audio.js';
import { World, CHUNK, T, DAY_LENGTH, NIGHT_LENGTH, ITEMS, CRAFTABLES, xpForLevel, obstacleTier } from './farm.js';
import {
    TILE_W, TILE_H, makeCanvas, drawText, textWidth,
    makeFarmerSprites, makeCropSprites, makeHouse, makeWell, makeBoard, makeFencePost,
    makeScaffold, makeToolshed, makeWindmill, makeTower, makeLantern,
    makeLilyPad, makeFish, makeChicken, makeCow, makePig, makeGoat, makeSheep, makeCoop, makeBarn, makeTrough,
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
out.style.cursor = 'none';   // the OS pointer is replaced by an in-world pixel hand (drawCursor)

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
let sheetScroll = 0;              // scroll offset for the selected-farmer detail card
let sheetContentH = 0;           // measured content height (for clamping the scroll)
let maxSheetScroll = 0;          // clamp bound, set each draw
let sheetTab = 0;                // active detail-sheet tab: 0 STATS, 1 ACTIVITY, 2 TIES, 3 MEMORY

// Reusable RPG-menu panel (wood frame + dark interior + corner rivets), styled after the
// craftpix basic-UI kit, so cards read as framed panels instead of floating text.
function uiPanel(x, y, w, h) {
    ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(x + 2, y + 3, w, h);   // drop shadow
    ctx.fillStyle = '#231a10'; ctx.fillRect(x, y, w, h);                    // outer edge
    ctx.fillStyle = '#6d5334'; ctx.fillRect(x + 1, y + 1, w - 2, h - 2);    // wood frame
    ctx.fillStyle = '#8a6b44'; ctx.fillRect(x + 1, y + 1, w - 2, 1);        // top highlight
    ctx.fillStyle = '#4a3824'; ctx.fillRect(x + 1, y + h - 2, w - 2, 1);    // bottom shade
    ctx.fillStyle = '#191410'; ctx.fillRect(x + 4, y + 4, w - 8, h - 8);    // interior
    ctx.fillStyle = '#c9a45a';
    for (const [rx, ry] of [[x + 2, y + 2], [x + w - 4, y + 2], [x + 2, y + h - 4], [x + w - 4, y + h - 4]]) ctx.fillRect(rx, ry, 2, 2);
}
function sectionBand(x, y, w, title) {
    ctx.fillStyle = '#2b2016'; ctx.fillRect(x, y, w, 9);
    ctx.fillStyle = '#4a3824'; ctx.fillRect(x, y + 9, w, 1);
    drawText(ctx, title, x + 3, y + 2, '#c9a45a');
    return y + 12;
}
// Custom pixel-art cursors, drawn INTO the game canvas each frame so the CRT shader warps them to
// land under the physical pointer (mouse.x/y are already curve-mapped via crt.screenToGame). The
// DEFAULT is a classic arrow; over anything clickable / tooltip-bearing it swaps to a gold pointing
// glove (the web arrow→hand convention). 'o' = dark outline, '#' = fill; ' ' = transparent.
// CURSOR_ARROW hotspot = the top-left tip (0,0); CURSOR_HAND hotspot = the fingertip (col 1, row 0).
const CURSOR_ARROW = [
    'o         ',
    'oo        ',
    'o#o       ',
    'o##o      ',
    'o###o     ',
    'o####o    ',
    'o#####o   ',
    'o######o  ',
    'o#######o ',
    'o####oooo ',
    'o#o##o    ',
    'oo o##o   ',
    'o   o##o  ',
    '    o##o  ',
    '     ooo  ',
];
const CURSOR_HAND = [
    ' oo      ',
    'o##o     ',
    'o##o     ',
    'o##o     ',
    'o##ooo   ',
    'o#####oo ',
    'o#######o',
    'o#######o',
    'o#######o',
    'o#######o',
    ' o#####o ',
    ' o#####o ',
    '  ooooo  ',
];
function blitCursor(bmp, ox, oy, fill) {
    ctx.fillStyle = 'rgba(0,0,0,0.30)';   // soft drop shadow (whole mask, +1px) for depth over busy terrain
    for (let r = 0; r < bmp.length; r++) { const row = bmp[r];
        for (let c = 0; c < row.length; c++) if (row[c] !== ' ') ctx.fillRect(ox + c + 1, oy + r + 1, 1, 1); }
    for (let r = 0; r < bmp.length; r++) { const row = bmp[r];
        for (let c = 0; c < row.length; c++) { const ch = row[c]; if (ch === ' ') continue;
            ctx.fillStyle = ch === 'o' ? '#1a120a' : fill; ctx.fillRect(ox + c, oy + r, 1, 1); } }
}
function drawCursor(mx, my, hot) {
    const x = Math.round(mx), y = Math.round(my);
    if (hot) {
        blitCursor(CURSOR_HAND, x - 1, y, '#f6d24e');   // gold pointing glove; fingertip at the pointer
        ctx.fillStyle = 'rgba(246,210,78,0.22)';         // faint gold halo so "clickable" reads at a glance
        ctx.fillRect(x - 2, y + 5, 1, 6); ctx.fillRect(x + 8, y + 6, 1, 5);
    } else {
        blitCursor(CURSOR_ARROW, x, y, '#f4f0e6');       // arrow; tip at the pointer
    }
}
// True when the pointer is over something clickable — swaps the cursor to its gold "pointer" look.
function cursorIsHot(worldTooltip) {
    const m = mouse;
    if (m.x < 0) return false;
    for (const b of [ROSTER_BTN, SND_BTN, FWD_BTN, FF_BTN, SPEED1_BTN]) if (b.w && inRect(m, b)) return true;
    if (!BOARD_BTN.hidden && inRect(m, BOARD_BTN)) return true;
    if (selected) {
        if (inRect(m, SHEET_CLOSE)) return true;
        for (const tb of SHEET_TABS) if (inRect(m, tb)) return true;
        if (MEM_PREV.w && inRect(m, MEM_PREV)) return true;
        if (MEM_NEXT.w && inRect(m, MEM_NEXT)) return true;
        for (const sl of sheetSlots) if (sl.y >= sheetBodyY - 2 && sl.y + sl.h <= sheetBodyY + sheetBodyH + 2 && inRect(m, sl)) return true;
    }
    if (!selected && inRect(m, MINIMAP)) return true;
    if (rosterOpen) { for (const r of rosterRows) if (m.y >= r.y0 && m.y < r.y1) return true; }
    return !!worldTooltip;   // hovering a building/farmer/merchant that shows a tooltip
}
const ROSTER_BTN = { x: 0, y: 3, w: 44, h: 12 };   // positioned in drawUI
const MINIMAP = { x: 0, y: 0, w: 46, h: 46 };      // bottom-right legend, positioned in drawMinimap
const SHEET_RECT = { x: 0, y: 0, w: 0, h: 0 };     // detail-card bounds, set in drawSheet (for hit-testing)
const SHEET_CLOSE = { x: 0, y: 0, w: 0, h: 0 };    // card close (X) button, set in drawSheet
const MEM_PREV = { x: 0, y: 0, w: 0, h: 0 };       // memories pager arrows, set in drawSheet
const MEM_NEXT = { x: 0, y: 0, w: 0, h: 0 };
let SHEET_TABS = [];                               // tab-bar hit-rects {x,y,w,h,tab}, rebuilt in drawSheet
let sheetMemPage = 0;                              // current MEMORIES page (0 = newest)
let sheetLastSel = null;                           // reset pager when the selection changes
let sheetSlots = [];                               // inventory/tool slot hit-rects+tooltips, rebuilt each drawSheet
let selectedSlotKey = null;                        // clicked item/tool slot (persists a name label + border)
let sheetBodyY = 0, sheetBodyH = 0;                // scrollable-body bounds, for slot hit-testing
const MEM_KIND_COLORS = { lesson: '#c9a45a', chat: '#8a9ade', job: '#e8c860', person: '#d08cc8', event: '#7dd069' };
let boardOpen = false;                             // town bulletin board panel
let boardScroll = 0, boardMaxScroll = 0;
const boardScreen = { x: 0, y: 0, w: 0, h: 0 };    // board sprite screen rect (click to open)
const BOARD_BTN = { x: 0, y: 3, w: 40, h: 12 };    // top-bar button, positioned in drawUI
const SND_BTN = { x: 0, y: 3, w: 30, h: 12 };      // sound on/off toggle, positioned in drawUI
const BOARD_CLOSE = { x: 0, y: 0, w: 0, h: 0 };
const BOARD_RECT = { x: 0, y: 0, w: 0, h: 0 };

const cam = { x: 0, y: 0 };
const mouse = { x: -1, y: -1, downX: 0, downY: 0, dragging: false, panStart: null };

const spriteCache = new Map();   // farmer -> frames
const houseCache = new Map();    // roofColor -> canvas
const wellSprite = makeWell();
const boardSprite = makeBoard();
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
// Real cut-down stumps (Broken_tree, plain-shadow) so felled trees transition naturally.
const STUMP_ART_BASE = './assets/craftpix-net-385863-free-top-down-trees-pixel-art/PNG/Assets_separately/Trees_shadow/';
const STUMP_NAMES = ['Broken_tree1', 'Broken_tree2', 'Broken_tree5'];
const ROCK_ART_BASE = './assets/craftpix-net-974061-free-rocks-and-stones-top-down-pixel-art/PNG/Objects_separately/';
// Only the Rock4 variants, plain-shadow versions (no grass_shadow / no_shadow).
const ROCK_NAMES = ['Rock4_1', 'Rock4_2', 'Rock4_3', 'Rock4_4', 'Rock4_5'];

// The Dungeon Master's wilderness threats. Each sheet is a directional frame GRID; we slice one
// side-profile frame (row 2, like the farm-animal pack). Frame size divides the sheet evenly.
const THREAT_ART = {
    fox:      { base: './assets/craftpix-net-789196-free-top-down-hunt-animals-pixel-sprite-pack/Tiled/', file: 'Fox_Idle_with_shadow',  fw: 32 },
    boar:     { base: './assets/craftpix-net-789196-free-top-down-hunt-animals-pixel-sprite-pack/Tiled/', file: 'Boar_Idle_with_shadow', fw: 32 },
    orc:      { base: './assets/craftpix-net-363992-free-top-down-orc-game-character-pixel-art/Tiled_files/', file: 'orc1_idle_with_shadow', fw: 64 },
    assassin: { base: './assets/craftpix-net-180537-free-swordsman-1-3-level-pixel-top-down-sprite-character/PNG/Swordsman_lvl1/Without_shadow/', file: 'Swordsman_lvl1_Idle_without_shadow', fw: 64 },
};
const threatImg = {};
for (const [k, c] of Object.entries(THREAT_ART)) { const im = new Image(); im.src = c.base + c.file + '.png'; threatImg[k] = im; }

// Shared async image-set loader: fills `store` and flips `readyFlag` (+ redraws
// terrain) once every image in the sets has loaded. Falls back to procedural
// sprites until then.
const treeImg = {}; let treeArtReady = false;
const bushImg = {}; let bushArtReady = false;
const rockImg = {}; let rockArtReady = false;
const stumpImg = {}; let stumpArtReady = false;
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
// ONE global scale for EVERY real CraftPix asset (house, trees, bushes, ferns, rocks,
// animals, crops). They share the same source-library dimensions, so a single modifier
// keeps every sprite at the same pixel density; relative sizes come from native art.
const ASSET_SCALE = 0.76;
// A dwelling RESERVES a 5x5 footprint (nothing else may encroach) but the sprite keeps its normal
// size — it just sits centred in that footprint with dead space around it.
const HOUSE_ART_SCALE = ASSET_SCALE;

// Animal walk-sheets: 6 cols x 8 rows grids. We slice the side-profile row.
const ANIMAL_ART_BASE = './assets/craftpix-net-291971-free-top-down-animals-farm-pixel-art-sprites/PNG/Without_shadow/';
// Every sheet in this pack is a uniform 6-col x 8-row grid (frame size = naturalW/6);
// rows 0-1 face front/back, rows 2-3 are the full 6-frame LEFT-facing side walk, rows
// 4-7 are truncated 4-frame poses. We render row 2 (side) and flip for right-facing.
// Frame PIXEL size differs per animal (Chick 16, most 32, Bull 64) so it's derived at
// draw time from the image, never hardcoded.
const ANIMAL_SHEETS = {
    cow:     { file: 'Bull_animation_without_shadow' },
    pig:     { file: 'Piglet_animation_without_shadow' },
    goat:    { file: 'Sheep_animation_without_shadow' },
    chicken: { file: 'Chick_animation_without_shadow' },
    rooster: { file: 'Rooster_animation_without_shadow' },
};
const ANIMAL_COLS = 6, ANIMAL_ROWS = 8;
let ANIMAL_SIDE_ROW = 2;   // full 6-frame side-profile walk row (rows 4-7 are only 4 frames)
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
// Tiered dwellings: L1 tipi (Yurt2), L2 round yurt (Yurt1), L3 = the cottage above.
// Each is a 128x128 sheet; the trimmed content box keeps the base anchored to the tile.
const ROCKY_BASE = './assets/craftpix-net-639143-free-rocky-area-objects-pixel-art/PNG/Objects_separately/';
const yurtL1 = new Image(); let yurtL1Ready = false; yurtL1.onload = () => { yurtL1Ready = true; }; yurtL1.onerror = () => {};
const yurtL2 = new Image(); let yurtL2Ready = false; yurtL2.onload = () => { yurtL2Ready = true; }; yurtL2.onerror = () => {};
yurtL1.src = ROCKY_BASE + 'Yurt2_grass_shadow.png';
yurtL2.src = ROCKY_BASE + 'Yurt1_grass_shadow.png';
// the three guardian statues (lightning wards) — carved tier by tier on the town square
const statueImgs = {
    statue1: new Image(), statue2: new Image(), statue3: new Image(),
};
statueImgs.statue1.src = ROCKY_BASE + 'Rock_statue_head_ground_shadow.png';
statueImgs.statue2.src = ROCKY_BASE + 'Rock_statue_fox_ground_shadow.png';
statueImgs.statue3.src = ROCKY_BASE + 'Rock_statue_mother_ground_shadow.png';
for (const img of Object.values(statueImgs)) img.onerror = () => {};
const STATUE_DRAW_W = { statue1: 46, statue2: 80, statue3: 134 };   // grander tiers loom larger
const YURT_L1_SRC = { x: 26, y: 20, w: 75, h: 87 };   // trim of Yurt2_grass_shadow.png
const YURT_L2_SRC = { x: 24, y: 26, w: 80, h: 76 };   // trim of Yurt1_grass_shadow.png
function buildingArt(level) {
    if (level >= 3) return { img: homeSheet, src: HOUSE_SRC, ready: homeReady };
    if (level === 2) return { img: yurtL2, src: YURT_L2_SRC, ready: yurtL2Ready };
    return { img: yurtL1, src: YURT_L1_SRC, ready: yurtL1Ready };
}
// Town bulletin board (guild-hall pack): empty when no postings, papered when jobs are up.
// Fantasy 16x16 item icons for the inventory grid — one tiny PNG per icon index,
// loaded lazily for the handful of indices ITEMS/CRAFTABLES actually reference.
const ITEM_ICON_BASE = './assets/craftpix-net-994534-free-basic-pixel-art-fantasy-icons-16x16-for-ui/PNG/Separately/Icon';
const itemIcons = {};   // icon index -> <img>
function itemIcon(idx) {
    if (!idx) return null;
    let img = itemIcons[idx];
    if (!img) { img = new Image(); img.onerror = () => {}; img.src = `${ITEM_ICON_BASE}${idx}_1.png`; itemIcons[idx] = img; }
    return img;
}
// preload the icons we know we'll draw
for (const it of Object.values(ITEMS)) itemIcon(it.icon);
for (const r of CRAFTABLES) itemIcon(r.icon);

const boardSheet = new Image(); let boardReady = false; boardSheet.onload = () => { boardReady = true; }; boardSheet.onerror = () => {};
boardSheet.src = './assets/craftpix-net-189780-free-top-down-pixel-art-guild-hall-asset-pack/PNG/Interior_objects.png';
const BOARD_EMPTY_SRC = { x: 0, y: 156, w: 41, h: 62 };
const BOARD_FULL_SRC = { x: 48, y: 156, w: 41, h: 62 };
const CHEST_CLOSED_SRC = { x: 248, y: 357, w: 20, h: 20 };   // treasure chest (same guild-hall sheet)
const CHEST_OPEN_SRC = { x: 276, y: 358, w: 23, h: 20 };
// the chest's glow is tinted by what's inside, so a keen eye can read the find from afar
const TREASURE_GLOW = { cache: '245,220,110', timber: '198,150,86', goods: '230,182,86', lode: '176,196,224', relic: '250,214,96' };
// stacked wooden crates — the "under construction" marker for town projects (board/toolshed/…)
const crateSheet = new Image(); let crateReady = false; crateSheet.onload = () => { crateReady = true; }; crateSheet.onerror = () => {};
crateSheet.src = './assets/craftpix-net-654184-main-characters-home-free-top-down-pixel-art-asset/Tiled_files/Interior.png';
const CRATES_SRC = { x: 69, y: 60, w: 26, h: 29 };   // just the two crates — stop before the next sprite
// the wandering merchant — a DIFFERENT guild-hall character each visit (32x32 frames, 6-col walk,
// 4 dir rows [down,up,left,right]). Idle/trading uses walk frame 0, so no separate idle sheet needed.
const GUILD_BASE = './assets/craftpix-net-189780-free-top-down-pixel-art-guild-hall-asset-pack/PNG/';
const MERCHANT_SHEETS = ['Citizen1_Walk', 'Citizen2_Walk', 'Fighter2_Walk'].map(f => {
    const img = new Image(); img.onerror = () => {}; img.src = GUILD_BASE + f + '.png'; return img;
});
// facing (0=down,1=left,2=right,3=up) -> sheet row. The Citizen sheet rows run [down, up, left, right].
const MERCHANT_ROW = [0, 2, 3, 1];
const WELL_SRC = { x: 48, y: 498, w: 38, h: 38 };    // grass-base stone well in exterior.png
const SCARECROW_SRC = { x: 4, y: 547, w: 52, h: 53 };   // scarecrow in exterior.png
const SMOKE_ENABLED = false;   // chimney smoke off until per-house (sheet-row) alignment is nailed
const smokeSheet = new Image();
let smokeReady = false;
const birdJumpSheet = new Image();
let birdJumpReady = false;
const birdFlySheet = new Image();
let birdFlyReady = false;

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
const CROP_SCALE = ASSET_SCALE;   // crops share the one global asset scale
// Harvested-produce icons in Supplies.png (loose items), shown when a crop is picked / carried.
const PRODUCE_ICONS = {
    tomato: [195, 147, 9, 9], carrot: [147, 210, 11, 11], rose: [242, 209, 11, 14],
    pumpkin: [85, 166, 20, 17], wheat: [1, 176, 13, 15], sunflower: [244, 132, 10, 9],
};

function loadAssetArt() {
    loadImageSet(TREE_ART_BASE, TREE_SETS, treeImg, () => { treeArtReady = true; });
    loadImageSet(BUSH_ART_BASE, BUSH_SETS, bushImg, () => { bushArtReady = true; });
    loadImageSet(ROCK_ART_BASE, { ROCKS: ROCK_NAMES }, rockImg, () => { rockArtReady = true; });
    loadImageSet(STUMP_ART_BASE, { STUMPS: STUMP_NAMES }, stumpImg, () => { stumpArtReady = true; });
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
    birdFlySheet.onload = () => { birdFlyReady = true; };
    birdFlySheet.onerror = () => {};
    birdFlySheet.src = HOME_BASE + 'bird_fly_animation.png';
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
    const fw = img.naturalWidth / ANIMAL_COLS, fh = img.naturalHeight / ANIMAL_ROWS;
    const moving = Math.abs(p.vx) + Math.abs(p.vy) > 0.05;
    const col = moving ? Math.floor(p.anim * 6) % ANIMAL_COLS : 0;
    const disp = Math.round(fh * ASSET_SCALE), top = Math.floor(py - disp * 0.86);
    ctx.imageSmoothingEnabled = false;
    // the CraftPix animal sheets face LEFT by default, so mirror when moving RIGHT (flip > 0)
    if (p.flip > 0) {
        ctx.save();
        ctx.translate(Math.floor(px + disp / 2), top);
        ctx.scale(-1, 1);
        ctx.drawImage(img, col * fw, ANIMAL_SIDE_ROW * fh, fw, fh, 0, 0, disp, disp);
        ctx.restore();
    } else {
        ctx.drawImage(img, col * fw, ANIMAL_SIDE_ROW * fh, fw, fh, Math.floor(px - disp / 2), top, disp, disp);
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
    sheep: [makeSheep(0), makeSheep(1)],
};
// bobbing "ready to collect" product icon colors
const PRODUCT_ICON = { pad: '#e880a8', fish: '#e08040', chicken: '#f4f0e8', cow: '#ffffff', pig: '#d8b088', goat: '#ffffff', sheep: '#f0eee6', rooster: '#e05840' };

// ---- Real character sprites (CraftPix swordsman: body + head layers, sword skipped) -------
// Every farmer is the same character, differentiated by hue-shifting the non-skin pixels
// (hair + clothing) per farmer, seeded from their memory.
const CHAR_BASE = './assets/craftpix-net-180537-free-swordsman-1-3-level-pixel-top-down-sprite-character/PNG/Swordsman_lvl1/Parts/';
const charBody = new Image(), charHead = new Image();
let charBodyReady = false, charHeadReady = false;
charBody.onload = () => { charBodyReady = true; }; charBody.onerror = () => {};
charHead.onload = () => { charHeadReady = true; }; charHead.onerror = () => {};
charBody.src = CHAR_BASE + 'Swordsman_lvl1_Walk_body.png';
charHead.src = CHAR_BASE + 'Swordsman_lvl1_Walk_head.png';
const CHAR_FW = 64, CHAR_NCOLS = 6;
const CHAR_DIRS = { down: 0, side: 2, up: 3 };   // sheet rows by facing (row0 front, row3 back, row2 3/4-side)
let charBox = null;   // shared content bbox across ALL rows (keeps every direction aligned)
function charReady() { return charBodyReady && charHeadReady && charBody.naturalWidth > 0; }
function composeCharCell(col, row) {
    const [cv, cx] = makeCanvas(CHAR_FW, CHAR_FW);
    cx.imageSmoothingEnabled = false;
    cx.drawImage(charBody, col * CHAR_FW, row * CHAR_FW, CHAR_FW, CHAR_FW, 0, 0, CHAR_FW, CHAR_FW);
    cx.drawImage(charHead, col * CHAR_FW, row * CHAR_FW, CHAR_FW, CHAR_FW, 0, 0, CHAR_FW, CHAR_FW);
    return [cv, cx];
}
function computeCharBox() {
    let x0 = 99, x1 = -1, y0 = 99, y1 = -1;
    for (const row of Object.values(CHAR_DIRS)) for (let col = 0; col < CHAR_NCOLS; col++) {
        const [, cx] = composeCharCell(col, row);
        const d = cx.getImageData(0, 0, CHAR_FW, CHAR_FW).data;
        for (let y = 0; y < CHAR_FW; y++) for (let x = 0; x < CHAR_FW; x++)
            if (d[(y * CHAR_FW + x) * 4 + 3] > 16) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    charBox = { x: x0, y: y0, w: Math.max(1, x1 - x0 + 1), h: Math.max(1, y1 - y0 + 1) };
}
function hslToRgb(h, s, l) {
    if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const hk = (t) => { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
    return [Math.round(hk(h + 1 / 3) * 255), Math.round(hk(h) * 255), Math.round(hk(h - 1 / 3) * 255)];
}
// Hue-rotate opaque pixels. hairOnly=true (head layer) leaves lighter skin/face pixels alone
// and shifts only the dark hair, so faces never recolor.
function tintPixels(cx, w, h, hueDeg, hairOnly) {
    const img = cx.getImageData(0, 0, w, h), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 8) continue;
        const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
        if (hairOnly && l > 0.4) continue;   // skin/face — leave it
        let s = 0, hh = 0;
        if (mx !== mn) { const dd = mx - mn; s = l > 0.5 ? dd / (2 - mx - mn) : dd / (mx + mn); if (mx === r) hh = (g - b) / dd + (g < b ? 6 : 0); else if (mx === g) hh = (b - r) / dd + 2; else hh = (r - g) / dd + 4; hh /= 6; }
        let nh = (hh + hueDeg / 360) % 1; if (nh < 0) nh += 1;
        const [nr, ng, nb] = hslToRgb(nh, s, l); d[i] = nr; d[i + 1] = ng; d[i + 2] = nb;
    }
    cx.putImageData(img, 0, 0);
}
// Compose one frame at (col,row): body (clothing) fully recolored, head with only hair recolored.
function tintedCharCell(col, row, hue) {
    const [bc, bcx] = makeCanvas(CHAR_FW, CHAR_FW); bcx.imageSmoothingEnabled = false;
    bcx.drawImage(charBody, col * CHAR_FW, row * CHAR_FW, CHAR_FW, CHAR_FW, 0, 0, CHAR_FW, CHAR_FW);
    tintPixels(bcx, CHAR_FW, CHAR_FW, hue, false);
    const [hc, hcx] = makeCanvas(CHAR_FW, CHAR_FW); hcx.imageSmoothingEnabled = false;
    hcx.drawImage(charHead, col * CHAR_FW, row * CHAR_FW, CHAR_FW, CHAR_FW, 0, 0, CHAR_FW, CHAR_FW);
    tintPixels(hcx, CHAR_FW, CHAR_FW, hue, true);
    const [out, ox] = makeCanvas(CHAR_FW, CHAR_FW); ox.imageSmoothingEnabled = false;
    ox.drawImage(bc, 0, 0); ox.drawImage(hc, 0, 0);
    return out;
}
const charCache = new Map();   // farmer -> { down, side, up } each a frame set
function buildCharSets(f) {
    if (!charBox) computeCharBox();
    const bx = charBox;
    const hueSeed = f.sheet.seed != null ? f.sheet.seed : hashString((f.sheet.memory && f.sheet.memory.id) || f.sheet.name);
    const hue = (hueSeed % 300) + 30;
    const dw = Math.max(1, Math.round(bx.w * ASSET_SCALE)), dh = Math.max(1, Math.round(bx.h * ASSET_SCALE));
    const frameFor = (col, row) => {
        const cell = tintedCharCell(col, row, hue);
        const [out, ox] = makeCanvas(dw, dh); ox.imageSmoothingEnabled = false;
        ox.drawImage(cell, bx.x, bx.y, bx.w, bx.h, 0, 0, dw, dh);
        return out;
    };
    const setForRow = (row) => ({ idle: frameFor(0, row), walk1: frameFor(1, row), walk2: frameFor(4, row), work: frameFor(2, row), sleep: frameFor(0, row) });
    return { down: setForRow(CHAR_DIRS.down), side: setForRow(CHAR_DIRS.side), up: setForRow(CHAR_DIRS.up) };
}
function characterSprites(f) {
    let sets = charCache.get(f);
    if (!sets) { sets = buildCharSets(f); charCache.set(f, sets); }
    return sets[f.moveDir] || sets.down;   // pick the row matching current facing
}

function farmerSprites(f) {
    if (charReady()) return characterSprites(f);
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
// Group a variant set into size buckets (ascending) by the loaded sprites' NATURAL width — the assets
// ship at 16/32/64/128 px, so this recovers small/medium/big classes with no hard-coded tables.
const _sizeBucketCache = new Map();
function sizeBuckets(store, names) {
    const loadedNames = names.filter(n => imageLoaded(store[n]));
    const key = names.join(',');
    const cached = _sizeBucketCache.get(key);
    if (cached && cached._n === loadedNames.length) return cached;
    const bySize = {};
    for (const n of loadedNames) { const px = store[n].naturalWidth; (bySize[px] = bySize[px] || []).push(n); }
    const groups = Object.keys(bySize).map(Number).sort((a, z) => a - z).map(px => bySize[px]);
    const b = { groups, _n: loadedNames.length };
    _sizeBucketCache.set(key, b);
    return b;
}
// Pick a variant whose NATURAL size matches an obstacle's size tier (0/1/2) — the sim's tier chooses
// which real sprite is drawn (a big tile gets the big boulder/old tree), so the size you SEE is the
// size the sim charges energy for, with every sprite at the one shared ASSET_SCALE (no scaling).
function pickTieredImage(store, names, i, j, seed, tier) {
    const b = sizeBuckets(store, names);
    if (!b.groups.length) return null;
    const gi = Math.floor(tier * (b.groups.length - 1) / 2);   // 3-size sets map 0/1/2; 2-size sets: big only at tier 2
    const group = b.groups[Math.min(gi, b.groups.length - 1)];
    const start = hash2(i * 31 + j * 17, j * 29 - i * 13, seed) % group.length;
    for (let n = 0; n < group.length; n++) {
        const img = store[group[(start + n) % group.length]];
        if (imageLoaded(img)) return img;
    }
    return pickLoadedImage(store, names, i, j, seed);
}
// Wild billboards use the shared ASSET_SCALE (defined up top) like everything else.
function wildDims(img) { return { w: Math.round(img.naturalWidth * ASSET_SCALE), h: Math.round(img.naturalHeight * ASSET_SCALE) }; }
function wildSpec(i, j, t, season) {
    if (t === T.TREE) {
        const treeSet = TREE_SETS[season.name] || TREE_SETS.SUMMER;
        const img = pickTieredImage(treeImg, treeSet, i, j, 61, obstacleTier(i, j));
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
        const img = pickTieredImage(bushImg, bushSet, i, j, 64, obstacleTier(i, j));
        if (img) {
            const { w, h } = wildDims(img);
            return { img, w, h, anchor: 0.74, depth: -1 };
        }
        return { img: flowerSprite, w: flowerSprite.width, h: flowerSprite.height, anchor: 1, nudgeY: 2, depth: -1 };
    }
    if (t === T.WHEAT) {
        const img = pickTieredImage(bushImg, FERN_NAMES, i, j, 66, obstacleTier(i, j));
        if (img) {
            const { w, h } = wildDims(img);
            return { img, w, h, anchor: 0.72, depth: -1 };
        }
        return { img: wheatSprite, w: wheatSprite.width, h: wheatSprite.height, anchor: 1, nudgeY: 2, depth: -1 };
    }
    if (t === T.STUMP) {
        const img = pickLoadedImage(stumpImg, STUMP_NAMES, i, j, 26);
        if (img) { const { w, h } = wildDims(img); return { img, w, h, anchor: 0.9, nudgeY: 2, depth: -0.5 }; }
        return { img: stumpSprite, w: stumpSprite.width, h: stumpSprite.height, anchor: 1, nudgeY: 2, depth: -0.5 };
    }
    if (t === T.ROCK) {
        const img = pickTieredImage(rockImg, ROCK_NAMES, i, j, 68, obstacleTier(i, j));
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
    if (world.isNight()) return;   // crows aren't out at night
    const t = performance.now() / 1000;
    const CENTER_X = TILE_W / 2 - 10;   // align iso tile centering used elsewhere
    for (const b of world.birds) {
        const baseSx = cam.x + isoX(b.i, b.j) + CENTER_X;
        const baseSy = cam.y + isoY(b.i, b.j);
        const flying = b.state === 'fly';
        // elevation: perched up in the canopy, arcing while in flight, low while pecking
        let elev = 2;
        if (flying) elev = 14 + Math.sin(b.hopT * Math.PI) * 16;
        else if (b.state === 'perch') elev = 20;
        const sx = Math.floor(baseSx), sy = Math.floor(baseSy - elev);
        if (sx < -40 || sx > GW + 40 || sy < -30 || sy > GH + 30) continue;
        const flip = b.facing < 0;
        list.push({
            y: baseSy + 8, layer: 4, x: sx,
            draw: () => {
                ctx.imageSmoothingEnabled = false;
                ctx.save();
                ctx.translate(sx, sy);
                if (flip) ctx.scale(-1, 1);
                if (flying && birdFlyReady && imageLoaded(birdFlySheet)) {
                    // fly sheet: 144x64 cells, 3 cols. Rows 9-10 hold the big wing-spread birds;
                    // crop TIGHT to that content (was cropping a mostly-empty 100x62 box, so the
                    // bird rendered as a tiny off-center speck) and alternate them to flap.
                    const col = b.seed % 3;
                    const row = (Math.floor(t * 8 + b.seed) % 2) ? 9 : 10;
                    ctx.drawImage(birdFlySheet, col * 144 + 14, row * 64 + 6, 72, 50, -16, -13, 32, 22);
                } else {
                    // jump sheet: 32x32 cells, 20 cols x 3 rows — draw the WHOLE cell so no hop
                    // frame gets cut off.
                    const row = b.seed % 3;
                    const col = b.state === 'peck' ? (Math.floor(t * 8) % 20) : (Math.floor(t * 4 + b.seed) % 20);
                    ctx.drawImage(birdJumpSheet, col * 32, row * 32, 32, 32, -13, -18, 26, 26);
                }
                ctx.restore();
            },
        });
    }
}

// ---------------------------------------------------------------------------
// Terrain: chunked ground canvases (the world is INFINITE — baked chunk by chunk,
// on demand, and re-baked only when their tiles or fog change)
// ---------------------------------------------------------------------------

// one chunk's diamond of tiles fits in this bounding box (plus a tile of slack)
const CHUNK_PX_W = (2 * CHUNK - 1) * (TILE_W / 2) + TILE_W;
const CHUNK_PX_H = (2 * CHUNK - 1) * (TILE_H / 2) + TILE_H;
const chunkCanvases = new Map();   // "cx,cy" -> { canvas, ox, oy } in world-iso pixels
let terrainDirty = true;           // legacy "everything changed" flag -> clears the whole cache

// world-iso pixel origin of chunk (cx,cy)'s canvas: leftmost tile is (i0, j0+C-1),
// topmost is (i0, j0)
function chunkOrigin(cx, cy) {
    const i0 = cx * CHUNK, j0 = cy * CHUNK;
    return { x: isoX(i0, j0 + CHUNK - 1) - TILE_W / 2, y: isoY(i0, j0) };
}

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

// Bake ONE chunk's ground into a cached canvas. Unrevealed tiles bake as fog (a near-black
// diamond with a faint hash weave — no tile data is read for them, so rendering never
// forces the world to generate scenery nobody has walked to). Revealed tiles on the fog
// frontier get a soft dark rim so the boundary reads as a receding veil, not a hard cut.
function bakeChunk(cx, cy) {
    const [cv, bctx] = makeCanvas(CHUNK_PX_W, CHUNK_PX_H);
    const org = chunkOrigin(cx, cy);
    const season = world.seasonDef;
    const [GRASS_A, GRASS_B] = season.ground;
    const TILLED_C = season.tilled;
    const winter = season.name === 'WINTER';
    const flower = winter ? '#e8eef4' : season.name === 'FALL' ? '#c89040' : season.name === 'SUMMER' ? '#f0d84a' : '#e8709a';
    const i0 = cx * CHUNK, j0 = cy * CHUNK;
    for (let j = j0; j < j0 + CHUNK; j++) {
        for (let i = i0; i < i0 + CHUNK; i++) {
            const sx = isoX(i, j) - TILE_W / 2 - org.x;
            const sy = isoY(i, j) - org.y;
            if (!world.isRevealed(i, j)) {
                // fog of war: untrodden country
                fillDiamond(bctx, sx, sy, (i + j) % 2 ? '#0c1016' : '#0a0e13');
                if (rand2(i, j, 91) < 0.16) {
                    bctx.fillStyle = 'rgba(90,110,140,0.10)';
                    bctx.fillRect(sx + 6 + Math.floor(rand2(i, j, 92) * 18), sy + 3 + Math.floor(rand2(i, j, 93) * 9), 2, 1);
                }
                continue;
            }
            const t = world.get(i, j);
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
            // a FINISHED dwelling sits on plain grass (the sprite covers its core) — the only gray
            // footprint is the foundation pad shown WHILE it's under construction (drawFoundation).
            // (T.HOUSE keeps its grass colour here.)
            // winter freezes the pond to pale, two-tone ice (vs deep liquid blue the rest of the year)
            if (t === T.WATER) col = winter ? ((i + j) % 2 ? '#aecad8' : '#a0bccc') : ((i + j) % 2 ? '#2a5a72' : '#26506a');
            if (t === T.COOP || t === T.BARN) col = '#6a5a44';
            fillDiamond(bctx, sx, sy, col);

            if (t === T.WATER) {
                if (winter) {   // a bright shine + a faint crack line so the ice reads as frozen, not just pale water
                    bctx.fillStyle = '#dcecf4';
                    bctx.fillRect(sx + 5 + ((i * 5 + j) % 6 + 6) % 6, sy + 3 + ((i + j) % 3 + 3) % 3, 3, 1);
                    if ((i * 3 + j) % 4 === 0) { bctx.fillStyle = '#c2d8e4'; bctx.fillRect(sx + 7, sy + 5, 4, 1); bctx.fillRect(sx + 9, sy + 6, 2, 1); }
                } else {
                    bctx.fillStyle = '#3a6e86';
                    bctx.fillRect(sx + 5 + ((i * 5 + j) % 6 + 6) % 6, sy + 3 + ((i + j) % 3 + 3) % 3, 2, 1);
                }
            } else if (t === T.TILLED) {
                bctx.fillStyle = winter ? '#b8c0c8' : '#584028';
                bctx.fillRect(sx + 6, sy + 4, 8, 1);
                bctx.fillRect(sx + 6, sy + 6, 8, 1);
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
                    bctx.drawImage(grassDetailsImg, d.x, d.y, d.w, d.h,
                        sx + Math.floor(TILE_W / 2 - dw / 2) + ox,
                        sy + Math.floor(TILE_H / 2 - dh / 2) + oy, dw, dh);
                }
                // subtle procedural speckle on non-decal tiles
                else if (patch === 3) {
                    bctx.fillStyle = flower;
                    bctx.fillRect(sx + 5 + Math.floor(rand2(i, j, 47) * 10), sy + 2 + Math.floor(rand2(i, j, 48) * 6), 1, 1);
                } else if (patch === 2 && rand2(i, j, 49) < 0.34) {
                    bctx.fillStyle = shade(GRASS_A, 1.16);
                    bctx.fillRect(sx + 6 + Math.floor(rand2(i, j, 50) * 8), sy + 3 + Math.floor(rand2(i, j, 51) * 4), 1, 2);
                }
            }
            // the veil's edge: revealed ground next to fog dims toward it
            if (!world.isRevealed(i + 1, j) || !world.isRevealed(i - 1, j) ||
                !world.isRevealed(i, j + 1) || !world.isRevealed(i, j - 1)) {
                fillDiamond(bctx, sx, sy, 'rgba(8,10,16,0.42)');
            }
        }
    }
    return { canvas: cv, ox: org.x, oy: org.y };
}

// The set of chunk canvases intersecting the viewport, baked on demand.
function drawTerrainChunks() {
    if (terrainDirty) { chunkCanvases.clear(); terrainDirty = false; }
    for (const k of world.dirtyChunks) chunkCanvases.delete(k);
    world.dirtyChunks.clear();
    if (chunkCanvases.size > 420) chunkCanvases.clear();   // roam far enough and old bakes just fall away

    const cs = [screenToTile(0, 0), screenToTile(GW, 0), screenToTile(GW, GH), screenToTile(0, GH)];
    let iMin = Infinity, iMax = -Infinity, jMin = Infinity, jMax = -Infinity;
    for (const c of cs) { if (c.i < iMin) iMin = c.i; if (c.i > iMax) iMax = c.i; if (c.j < jMin) jMin = c.j; if (c.j > jMax) jMax = c.j; }
    const cx0 = Math.floor((iMin - 2) / CHUNK), cx1 = Math.floor((iMax + 2) / CHUNK);
    const cy0 = Math.floor((jMin - 2) / CHUNK), cy1 = Math.floor((jMax + 2) / CHUNK);
    for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) {
            const org = chunkOrigin(cx, cy);
            const dx = Math.floor(cam.x + org.x), dy = Math.floor(cam.y + org.y);
            if (dx > GW || dy > GH || dx + CHUNK_PX_W < 0 || dy + CHUNK_PX_H < 0) continue;
            const key = cx + ',' + cy;
            let entry = chunkCanvases.get(key);
            if (!entry) { entry = bakeChunk(cx, cy); chunkCanvases.set(key, entry); }
            ctx.drawImage(entry.canvas, dx, dy);
        }
    }
}

// ---------------------------------------------------------------------------
// Weather particles
// ---------------------------------------------------------------------------

const rain = [];
for (let i = 0; i < 140; i++) rain.push({ x: Math.random() * GW, y: Math.random() * GH, s: 2.4 + Math.random() * 2 });

// fireflies: warm blinking motes that drift the fields on summer nights (render-only ambience)
const fireflies = [];
for (let i = 0; i < 64; i++) fireflies.push({ x: Math.random() * GW, y: Math.random() * GH, ph: Math.random() * 6.28, sp: 0.5 + Math.random() * 0.8, drift: Math.random() * 6.28 });

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

    // blizzard: a driving whiteout — dense wind-blown snow streaking sideways
    if (w === 'blizzard') {
        ctx.fillStyle = 'rgba(244,250,255,0.95)';
        for (let i = 0; i < 140; i++) {
            const p = rain[i];
            p.y += p.s * dt * 60 * 0.85;
            p.x -= dt * 95;   // hard wind
            if (p.y > GH || p.x < -4) { p.y = -Math.random() * GH * 0.5; p.x = GW + Math.random() * 40; }
            ctx.fillRect(Math.floor(p.x), Math.floor(p.y), 2, 1);
        }
    }

    // seasonal drift particles (skip during rain/blizzard to avoid clutter)
    const sName = world.seasonName;
    if ((sName === 'WINTER' || sName === 'FALL') && w !== 'rain' && w !== 'storm' && w !== 'blizzard') {
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
    else if (w === 'blizzard') { ctx.fillStyle = 'rgba(188,210,238,0.30)'; ctx.fillRect(0, 0, GW, GH); }
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

    // fireflies drift and blink over the fields on warm SUMMER nights (drawn over the night
    // tint so they read as little glows). Clear/cloud only — no fireflies out in a storm.
    if (sName === 'SUMMER' && nightA > 0.12 && w !== 'storm' && w !== 'blizzard') {
        const glow = Math.min(1, (nightA - 0.12) / 0.28);   // fade in as dusk deepens into night
        const now = performance.now() / 1000;
        for (let i = 0; i < fireflies.length; i++) {
            const f = fireflies[i];
            f.drift += dt * 0.7;
            f.x += Math.cos(f.drift) * dt * 9;
            f.y += Math.sin(f.drift * 0.7) * dt * 5 - dt * 3.5;   // gentle upward wander
            if (f.y < -4) f.y = GH + 4; if (f.y > GH + 4) f.y = -4;
            if (f.x < -4) f.x = GW + 4; if (f.x > GW + 4) f.x = -4;
            const blink = 0.5 + 0.5 * Math.sin(now * f.sp * 3 + f.ph);
            const a = blink * blink * glow * 0.85;
            if (a < 0.06) continue;
            const fx = Math.floor(f.x), fy = Math.floor(f.y);
            ctx.fillStyle = `rgba(206,255,150,${a})`;
            ctx.fillRect(fx, fy, 1, 1);
            if (blink > 0.72) {   // a soft glow cross at peak brightness
                ctx.fillStyle = `rgba(180,255,120,${a * 0.4})`;
                ctx.fillRect(fx - 1, fy, 3, 1); ctx.fillRect(fx, fy - 1, 1, 3);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// World rendering
// ---------------------------------------------------------------------------

// Trace the fence outline (boundary corners = posts, boundary edges = rails) of a plot's
// cell set. Cached per plot.rev so the topology is only recomputed when the plot grows.
function plotOutline(plot) {
    if (plot._outline && plot._outlineRev === plot.rev) return plot._outline;
    const cells = plot.cells, railSegs = [], postSet = new Set();
    const addPost = (ci, cj) => postSet.add(ci + ',' + cj);
    let cx = 0, cy = 0, n = 0;
    for (const key of cells) {
        const c = key.indexOf(','), i = +key.slice(0, c), j = +key.slice(c + 1);
        cx += i; cy += j; n++;
        if (!cells.has(i + ',' + (j - 1))) { railSegs.push([i, j, i + 1, j]); addPost(i, j); addPost(i + 1, j); }
        if (!cells.has((i + 1) + ',' + j)) { railSegs.push([i + 1, j, i + 1, j + 1]); addPost(i + 1, j); addPost(i + 1, j + 1); }
        if (!cells.has(i + ',' + (j + 1))) { railSegs.push([i, j + 1, i + 1, j + 1]); addPost(i, j + 1); addPost(i + 1, j + 1); }
        if (!cells.has((i - 1) + ',' + j)) { railSegs.push([i, j, i, j + 1]); addPost(i, j); addPost(i, j + 1); }
    }
    if (n) { cx /= n; cy /= n; }
    // Order posts and rails as a perimeter walk (angle around the plot centre) so the under-
    // construction reveal (drawn as a fraction of this list) grows in the SAME direction the
    // farmer walks the fence line — the fence rises right where they're standing, not top-down.
    const ang = (i, j) => Math.atan2(j - cy, i - cx);
    const postArr = [];
    for (const k of postSet) { const c = k.indexOf(','); postArr.push({ i: +k.slice(0, c), j: +k.slice(c + 1) }); }
    postArr.sort((a, b) => ang(a.i, a.j) - ang(b.i, b.j) || (a.i - b.i) || (a.j - b.j));
    railSegs.sort((a, b) => ang((a[0] + a[2]) / 2, (a[1] + a[3]) / 2) - ang((b[0] + b[2]) / 2, (b[1] + b[3]) / 2) || (a[0] - b[0]) || (a[1] - b[1]));
    const posts = [];
    for (const p of postArr) posts.push(p.i, p.j);
    const rails = [];
    for (const s of railSegs) rails.push(s[0], s[1], s[2], s[3]);
    plot._outline = { posts, rails }; plot._outlineRev = plot.rev;
    return plot._outline;
}

function collectDrawables() {
    const list = [];

    // Wild foliage has height, so it participates in the same footline sort as
    // farmers and buildings instead of being baked flat into the terrain.
    // Viewport-cull: only scan tiles that can reach the screen (the visible (i,j)
    // diamond + a margin for tall sprites drawn from tiles just off the bottom edge).
    {
        const cs = [screenToTile(0, 0), screenToTile(GW, 0), screenToTile(GW, GH), screenToTile(0, GH)];
        const M = 12;
        let iMin = Infinity, iMax = -Infinity, jMin = Infinity, jMax = -Infinity;
        for (const c of cs) { if (c.i < iMin) iMin = c.i; if (c.i > iMax) iMax = c.i; if (c.j < jMin) jMin = c.j; if (c.j > jMax) jMax = c.j; }
        iMin = Math.floor(iMin) - M; iMax = Math.ceil(iMax) + M;   // no world edges to clamp to anymore
        jMin = Math.floor(jMin) - M; jMax = Math.ceil(jMax) + M;
        for (let j = jMin; j <= jMax; j++) {
            for (let i = iMin; i <= iMax; i++) {
                if (!world.isRevealed(i, j)) continue;   // flora under fog stays hidden (and ungenerated)
                addWildDrawable(list, i, j);
            }
        }
    }
    addBirds(list);

    // fences: trace the outline of each plot's cell set (works for any shape, incl.
    // L-shapes). The topology is cached per plot.rev so we don't recompute it each frame.
    for (const plot of world.plots) {
        // fence is raised post-by-post: draw only the built fraction while under construction
        const prog = plot.built.fence ? 1 : (plot.fenceTarget ? Math.min(1, plot.fencePosts / plot.fenceTarget) : 0);
        if (prog <= 0) continue;
        const o = plotOutline(plot);
        const nPosts = Math.round((o.posts.length / 2) * prog), nRails = Math.round((o.rails.length / 4) * prog);
        for (let k = 0; k < nPosts * 2; k += 2) list.push(post(o.posts[k], o.posts[k + 1]));
        for (let k = 0; k < nRails * 4; k += 4) list.push(rail(o.rails[k], o.rails[k + 1], o.rails[k + 2], o.rails[k + 3]));
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

    // houses (tiered: L1 tipi -> L2 round yurt -> L3 cottage)
    for (const f of world.farmers) {
        const p = f.plot, level = p.built.level;
        const h = p.house, F = 5;   // 5x5 footprint (World.HOUSE_FT); sprite sits centred within it
        const sx = cam.x + isoX(h.i + (F - 1) / 2, h.j + (F - 1) / 2);   // footprint centre
        const sy = cam.y + isoY(h.i + (F - 1) / 2, h.j + (F - 1) / 2);
        if (p.building) {   // under construction: gray foundation pad + a house rising by progress
            const b = p.building, prog = Math.min(1, b.points / b.needed), art = buildingArt(b.level);
            const ft = world.houseFt(p);
            list.push({ y: sy + TILE_H, draw: () => drawFoundation(h, sx, sy, art, prog, ft) });
            continue;
        }
        if (level < 1) continue;   // homeless — nothing to draw
        const spr = houseSprite(f.sheet.colors.hatColor);
        const art = buildingArt(level);
        const night = world.isNight();
        const indoors = isIndoors(f);
        list.push({
            y: sy + TILE_H, draw: () => {
                let roofY;
                if (art.ready) {
                    const S = art.src;
                    const dispW = Math.round(S.w * HOUSE_ART_SCALE), dispH = Math.round(dispW * S.h / S.w);
                    const hx = Math.floor(sx - dispW / 2), hy = Math.floor(sy + TILE_H - dispH + 3);
                    ctx.imageSmoothingEnabled = false;
                    ctx.drawImage(art.img, S.x, S.y, S.w, S.h, hx, hy, dispW, dispH);
                    if (SMOKE_ENABLED && level >= 3) drawSmoke(hx, hy, dispW, dispH, f.sheet.seed % 9);
                    if (night) {
                        ctx.fillStyle = indoors ? 'rgba(255,220,120,0.5)' : 'rgba(255,220,120,0.22)';
                        if (level >= 3) {
                            ctx.fillRect(hx + Math.floor(dispW * 0.24), hy + Math.floor(dispH * 0.5), 5, 5);
                            ctx.fillRect(hx + Math.floor(dispW * 0.55), hy + Math.floor(dispH * 0.5), 5, 5);
                        } else {
                            ctx.fillRect(hx + Math.floor(dispW * 0.42), hy + Math.floor(dispH * 0.55), 5, 5);   // yurt doorway glow
                        }
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
        const sx = cam.x + isoX(w.i, w.j), sy = cam.y + isoY(w.i, w.j);
        const wdw = Math.round(WELL_SRC.w * ASSET_SCALE), wdh = Math.round(WELL_SRC.h * ASSET_SCALE);
        list.push({
            y: sy + TILE_H, draw: () => {
                if (homeReady && imageLoaded(homeSheet)) {
                    ctx.imageSmoothingEnabled = false;
                    ctx.drawImage(homeSheet, WELL_SRC.x, WELL_SRC.y, WELL_SRC.w, WELL_SRC.h,
                        Math.floor(sx + TILE_W / 2 - wdw / 2 - 10), Math.floor(sy + TILE_H - wdh + 2), wdw, wdh);
                } else ctx.drawImage(wellSprite, Math.floor(sx - 10 + TILE_W / 2 - 10), Math.floor(sy - 14));
            }
        });
        // town silo — donation heart of the plaza, present from day one; shows the town level
        {
            const s = world.silo;
            const ssx = cam.x + isoX(s.i, s.j), ssy = cam.y + isoY(s.i, s.j);
            list.push({ y: ssy + TILE_H, draw: () => drawSilo(ssx, ssy) });
        }
        if (world.board) {   // only once the town has built the bulletin board
            const b = world.board;
            const bx = cam.x + isoX(b.i, b.j), by = cam.y + isoY(b.i, b.j);
            if (boardReady) {
                const src = world.helpBoard.some(r => r.genuine) ? BOARD_FULL_SRC : BOARD_EMPTY_SRC;
                const dispW = Math.round(src.w * ASSET_SCALE), dispH = Math.round(src.h * ASSET_SCALE);
                boardScreen.x = bx + TILE_W / 2 - dispW / 2; boardScreen.y = by + TILE_H - dispH; boardScreen.w = dispW; boardScreen.h = dispH;
                list.push({
                    y: by + TILE_H, draw: () => {
                        ctx.imageSmoothingEnabled = false;
                        ctx.drawImage(boardSheet, src.x, src.y, src.w, src.h, Math.floor(boardScreen.x), Math.floor(boardScreen.y), dispW, dispH);
                    }
                });
            } else {
                boardScreen.x = bx + TILE_W / 2 - 13; boardScreen.y = by - 14; boardScreen.w = 26; boardScreen.h = 26;
                list.push({ y: by + TILE_H, draw: () => ctx.drawImage(boardSprite, Math.floor(boardScreen.x), Math.floor(boardScreen.y)) });
            }
        } else { boardScreen.w = 0; boardScreen.h = 0; }   // no board -> nothing to click
    }

    // rare treasure chest (glints while unopened to catch the eye)
    if (world.treasure && boardReady && imageLoaded(boardSheet)) {
        const tr = world.treasure;
        const src = tr.opened ? CHEST_OPEN_SRC : CHEST_CLOSED_SRC;
        const dw = Math.round(src.w * ASSET_SCALE), dh = Math.round(src.h * ASSET_SCALE);
        const sx = cam.x + isoX(tr.i, tr.j) + TILE_W / 2 - 10, sy = cam.y + isoY(tr.i, tr.j);
        list.push({
            y: sy + TILE_H, layer: 2, draw: () => {
                ctx.imageSmoothingEnabled = false;
                const t = performance.now() / 1000;
                const rgb = TREASURE_GLOW[tr.kind] || TREASURE_GLOW.cache;
                const rare = tr.kind === 'relic' || tr.kind === 'lode';   // deep finds glow bigger & brighter
                if (!tr.opened) {   // glow + twinkle, tinted by the loot within
                    const pulse = (rare ? 0.5 : 0.35) + 0.25 * Math.sin(t * (rare ? 5 : 4));
                    const rad = rare ? 20 : 16;
                    const g = ctx.createRadialGradient(sx, sy, 1, sx, sy, rad);
                    g.addColorStop(0, `rgba(${rgb},${pulse})`); g.addColorStop(1, `rgba(${rgb},0)`);
                    ctx.fillStyle = g; ctx.fillRect(sx - rad, sy - rad, rad * 2, rad * 2);
                }
                ctx.drawImage(boardSheet, src.x, src.y, src.w, src.h, Math.floor(sx - dw / 2), Math.floor(sy + TILE_H - dh), dw, dh);
                if (!tr.opened && Math.floor(t * 3) % 2) drawText(ctx, '*', Math.floor(sx + 4), Math.floor(sy + TILE_H - dh - 5), `rgba(${rgb},1)`);
            }
        });
    }

    // scarecrows (raid-driven farm builds; the 6-tile scare radius lives in farm.js)
    if (homeReady && imageLoaded(homeSheet)) {
        for (const sc of world.scarecrows) {
            const sx = cam.x + isoX(sc.i, sc.j), sy = cam.y + isoY(sc.i, sc.j);
            const dw = Math.round(SCARECROW_SRC.w * ASSET_SCALE), dh = Math.round(SCARECROW_SRC.h * ASSET_SCALE);
            list.push({
                y: sy + TILE_H, draw: () => {
                    ctx.imageSmoothingEnabled = false;
                    ctx.drawImage(homeSheet, SCARECROW_SRC.x, SCARECROW_SRC.y, SCARECROW_SRC.w, SCARECROW_SRC.h,
                        Math.floor(sx + TILE_W / 2 - dw / 2 - 10), Math.floor(sy + TILE_H - dh + 2), dw, dh);
                }
            });
        }
    }

    // completed structures
    for (const st of world.structures) {
        const sx = cam.x + isoX(st.i, st.j), sy = cam.y + isoY(st.i, st.j);
        if (st.type === 'well2' && homeReady && imageLoaded(homeSheet)) {
            // extra wells (town second well, neighborhood shared wells) use the real well sprite
            const wdw = Math.round(WELL_SRC.w * ASSET_SCALE), wdh = Math.round(WELL_SRC.h * ASSET_SCALE);
            list.push({
                y: sy + TILE_H, draw: () => {
                    ctx.imageSmoothingEnabled = false;
                    ctx.drawImage(homeSheet, WELL_SRC.x, WELL_SRC.y, WELL_SRC.w, WELL_SRC.h,
                        Math.floor(sx + TILE_W / 2 - wdw / 2 - 10), Math.floor(sy + TILE_H - wdh + 2), wdw, wdh);
                }
            });
            continue;
        }
        if (st.type.startsWith('statue') && imageLoaded(statueImgs[st.type])) {
            // guardian statues: anchored to the CENTER of their size x size footprint,
            // feet on the far corner's ground line so they sort correctly with walkers
            const img = statueImgs[st.type], size = st.size || 1;
            const cxT = st.i + size / 2 - 0.5, cyT = st.j + size / 2 - 0.5;
            const bx = cam.x + isoX(cxT, cyT);
            const by = cam.y + isoY(st.i + size - 1, st.j + size - 1) + TILE_H;
            const dw = STATUE_DRAW_W[st.type] || 46;
            const dh = Math.round(dw * img.naturalHeight / img.naturalWidth);
            list.push({
                y: by, draw: () => {
                    ctx.imageSmoothingEnabled = false;
                    ctx.drawImage(img, Math.floor(bx - dw / 2), Math.floor(by - dh + 4), dw, dh);
                }
            });
            continue;
        }
        let spr = structSprites[st.type];
        if (st.type === 'windmill') spr = spr[Math.floor(performance.now() / 350) % 2];
        if (!spr) continue;   // unknown structure type (e.g. statue art still loading)
        list.push({
            y: sy + TILE_H, draw: () =>
                ctx.drawImage(spr, Math.floor(sx - spr.width / 2), Math.floor(sy + TILE_H - spr.height))
        });
    }

    // active build site: scaffold + progress bar + label
    if (world.project && world.project.site) {
        const pr = world.project;
        const sx = cam.x + isoX(pr.site.i, pr.site.j), sy = cam.y + isoY(pr.site.i, pr.site.j);
        list.push({
            y: sy + TILE_H, draw: () => {
                if (crateReady && imageLoaded(crateSheet)) {
                    ctx.imageSmoothingEnabled = false;
                    const dw = Math.round(CRATES_SRC.w * ASSET_SCALE), dh = Math.round(CRATES_SRC.h * ASSET_SCALE);
                    ctx.drawImage(crateSheet, CRATES_SRC.x, CRATES_SRC.y, CRATES_SRC.w, CRATES_SRC.h, Math.floor(sx - dw / 2), Math.floor(sy + TILE_H - dh), dw, dh);
                } else {
                    ctx.drawImage(scaffoldSprite, Math.floor(sx - 12), Math.floor(sy + TILE_H - 22));
                }
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

    // neighborhood co-op sites (farmer-proposed shared wells): same crate marker, blue
    // while rallying/gathering materials, gold once the digging starts
    for (const coop of world.coops) {
        const sx = cam.x + isoX(coop.site.i, coop.site.j), sy = cam.y + isoY(coop.site.i, coop.site.j);
        list.push({
            y: sy + TILE_H, draw: () => {
                if (crateReady && imageLoaded(crateSheet)) {
                    ctx.imageSmoothingEnabled = false;
                    const dw = Math.round(CRATES_SRC.w * ASSET_SCALE), dh = Math.round(CRATES_SRC.h * ASSET_SCALE);
                    ctx.drawImage(crateSheet, CRATES_SRC.x, CRATES_SRC.y, CRATES_SRC.w, CRATES_SRC.h, Math.floor(sx - dw / 2), Math.floor(sy + TILE_H - dh), dw, dh);
                } else {
                    ctx.drawImage(scaffoldSprite, Math.floor(sx - 12), Math.floor(sy + TILE_H - 22));
                }
                const building = coop.stage === 'build';
                const p = building ? Math.min(coop.points / coop.needed, 1)
                    : Math.min((coop.wood + coop.ore) / (coop.needWood + coop.needOre), 1);
                ctx.fillStyle = '#20222c';
                ctx.fillRect(Math.floor(sx - 13), Math.floor(sy - 14), 26, 4);
                ctx.fillStyle = building ? '#f0d060' : '#8fc7e8';
                ctx.fillRect(Math.floor(sx - 12), Math.floor(sy - 13), Math.floor(24 * p), 2);
                const lbl = coop.stage === 'rally' ? `${coop.label}?` : coop.label;
                drawText(ctx, lbl, Math.floor(sx - textWidth(lbl) / 2), Math.floor(sy - 22), building ? '#f0d060' : '#8fc7e8');
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
            // producers (animals tucked inside their coop/barn at night aren't drawn)
            for (const p of fac.producers) {
                if (p.inside) continue;
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

    // wandering merchant + their market stall (both y-sorted into the scene)
    const m = world.merchant;
    if (m) {
        if (m.state === 'trading') {
            const ssx = cam.x + isoX(m.stall.i, m.stall.j), ssy = cam.y + isoY(m.stall.i, m.stall.j);
            list.push({ y: ssy + TILE_H * 0.5 - 0.1, draw: () => drawStall(ssx, ssy) });
        }
        const sx = cam.x + isoX(m.pos.i, m.pos.j), sy = cam.y + isoY(m.pos.i, m.pos.j);
        list.push({ y: sy + TILE_H * 0.5 + 0.12, draw: () => drawMerchant(m, sx, sy) });
    }

    // wilderness threats (the Dungeon Master's beasts + foes), y-sorted into the scene
    for (const e of world.encounters) {
        if (e.done) continue;
        const sx = cam.x + isoX(e.i, e.j), sy = cam.y + isoY(e.i, e.j);
        list.push({ y: sy + TILE_H * 0.5 + 0.11, draw: () => drawThreat(e, sx, sy) });
    }

    return list;
}
// A wilderness threat: one sliced side-profile frame of its real sprite (fallback: a menace blob).
function drawThreat(e, sx, sy) {
    const c = THREAT_ART[e.kind], img = threatImg[e.kind];
    ctx.imageSmoothingEnabled = false;
    if (img && img.complete && img.naturalWidth > 0) {
        const fw = c.fw, rows = Math.max(1, Math.round(img.naturalHeight / fw));
        const row = Math.min(2, rows - 1);
        const disp = Math.round(fw * ASSET_SCALE * 1.15);
        const dx = Math.round(sx - disp / 2), dy = Math.round(sy - disp * 0.82);
        if (e.facing < 0) {   // the side-profile source frame faces RIGHT; mirror it to face left
            ctx.save(); ctx.translate(dx + disp, dy); ctx.scale(-1, 1);
            ctx.drawImage(img, 0, row * fw, fw, fw, 0, 0, disp, disp);
            ctx.restore();
        } else {
            ctx.drawImage(img, 0, row * fw, fw, fw, dx, dy, disp, disp);
        }
    } else {
        ctx.fillStyle = e.def.color;
        ctx.beginPath(); ctx.ellipse(sx, sy - 6, 7, 9, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#1a1414'; ctx.fillRect(Math.round(sx - 3), Math.round(sy - 9), 2, 2); ctx.fillRect(Math.round(sx + 1), Math.round(sy - 9), 2, 2);
    }
}

// the merchant's stall: the crate stack with a little striped awning + a coin banner above
function drawStall(sx, sy) {
    if (crateReady && imageLoaded(crateSheet)) {
        const dw = Math.round(CRATES_SRC.w * ASSET_SCALE), dh = Math.round(CRATES_SRC.h * ASSET_SCALE);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(crateSheet, CRATES_SRC.x, CRATES_SRC.y, CRATES_SRC.w, CRATES_SRC.h, Math.floor(sx - dw / 2), Math.floor(sy + TILE_H - dh), dw, dh);
    }
    // a striped awning above the crates
    const ax = Math.floor(sx - 12), ay = Math.floor(sy + TILE_H - 30);
    for (let k = 0; k < 6; k++) { ctx.fillStyle = k % 2 ? '#d05a48' : '#f0e8d8'; ctx.fillRect(ax + k * 4, ay, 4, 5); }
    ctx.fillStyle = '#8a5a3a'; ctx.fillRect(ax, ay + 5, 24, 1);
    // a small floating coin so the player spots the market
    const bob = Math.round(Math.sin(performance.now() / 300) * 1.5);
    ctx.fillStyle = '#f0c850'; ctx.fillRect(Math.floor(sx - 2), ay - 9 + bob, 4, 4);
    ctx.fillStyle = '#c89830'; ctx.fillRect(Math.floor(sx - 1), ay - 8 + bob, 1, 2);
}

// The town silo — a grain bin at the plaza where settlers donate surplus to level the town.
// Procedural (no asset): tan cylinder + hooped bands + conical roof, with a floating TOWN LV tag.
function drawSilo(sx, sy) {
    const w = 16, h = 22;
    const x = Math.floor(sx - w / 2), footY = Math.floor(sy + TILE_H), topY = footY - h;
    ctx.fillStyle = 'rgba(10,14,10,0.30)'; ctx.fillRect(x - 1, footY - 1, w + 2, 3);            // shadow
    ctx.fillStyle = '#c9a24e'; ctx.fillRect(x, topY + 6, w, h - 6);                              // body
    ctx.fillStyle = '#e0c072'; ctx.fillRect(x + 1, topY + 6, 3, h - 6);                          // left highlight
    ctx.fillStyle = '#b3893c'; ctx.fillRect(x + w - 5, topY + 6, 5, h - 6);                      // right shade
    ctx.fillStyle = '#8a6a34'; for (let k = 0; k < 3; k++) ctx.fillRect(x, topY + 10 + k * 4, w, 1); // hoops
    for (let r = 0; r <= 6; r++) { ctx.fillStyle = '#7a5230'; ctx.fillRect(x + r, topY + 6 - r, w - r * 2, 1);   // conical roof
        ctx.fillStyle = '#93643a'; ctx.fillRect(x + r, topY + 6 - r, Math.max(1, (w - r * 2) >> 1), 1); }        // roof highlight
    ctx.fillStyle = '#5a3c22'; ctx.fillRect(Math.floor(sx) - 1, topY - 1, 2, 2);                 // cap
    ctx.fillStyle = '#3a2814'; ctx.fillRect(x - 1, topY + 6, 1, h - 6); ctx.fillRect(x + w, topY + 6, 1, h - 6); ctx.fillRect(x - 1, footY, w + 2, 1); // outline
    const tag = `LV ${world.townLevel}`, tw = textWidth(tag);                                    // town-level tag
    ctx.fillStyle = 'rgba(20,16,8,0.78)'; ctx.fillRect(Math.floor(sx - tw / 2) - 2, topY - 12, tw + 4, 9);
    drawText(ctx, tag, Math.floor(sx - tw / 2), topY - 11, '#f0d060');
}

function drawMerchant(m, sx, sy) {
    const walking = m.state === 'arriving' || m.state === 'leaving';
    const img = MERCHANT_SHEETS[m.spriteIdx] || MERCHANT_SHEETS[0];
    if (!img || !imageLoaded(img)) {   // sprite not loaded — a small stand-in figure
        ctx.fillStyle = '#7a5a8a'; ctx.fillRect(Math.floor(sx - 3), Math.floor(sy + TILE_H / 2 - 12), 6, 12);
        return;
    }
    const cols = Math.max(1, Math.round(img.naturalWidth / 32)), rows = 4;
    const fw = img.naturalWidth / cols, fh = img.naturalHeight / rows;
    const row = MERCHANT_ROW[m.facing] ?? 0;
    const col = walking ? (m.frame % cols) : 0;   // stands (frame 0) while trading
    const disp = Math.round(fh * ASSET_SCALE);
    const px = Math.floor(sx - disp / 2), py = Math.floor(sy + TILE_H / 2 - disp + 2);
    ctx.fillStyle = 'rgba(10,14,10,0.35)';
    ctx.fillRect(Math.floor(px + disp * 0.25), py + disp - 3, Math.floor(disp * 0.5), 2);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, col * fw, row * fh, fw, fh, px, py, disp, disp);
}

function fillDiamondAlpha(sx, sy, color) {
    fillDiamond(ctx, Math.floor(sx), Math.floor(sy), color);
}

function drawProducer(p, px, py) {
    // winter freezes the pond over: lily pads wither off and the fish sink out of sight until spring
    if ((p.kind === 'pad' || p.kind === 'fish') && world.isWinter()) return;
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
            const img = animalImg[p.kind];
            const disp = img && img.naturalHeight ? Math.round(img.naturalHeight / ANIMAL_ROWS * ASSET_SCALE) : 24;
            const iy = Math.floor(py - disp * 0.86 - 4 + bob);
            ctx.fillRect(Math.floor(px - 1), iy, 2, 2);
            ctx.fillRect(Math.floor(px - 2), iy + 1, 4, 1);
        }
        return;
    }
    const frame = Math.floor(p.anim * (p.kind === 'chicken' || p.kind === 'rooster' ? 6 : 3)) % 2;
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
// Homeless settlers have no house yet, so they're always shown out in the open.
function isIndoors(f) {
    if (f.plot.built.level < 1) return false;
    return f.state === 'sleep' || f.state === 'rest' || f.state === 'sick' || f.state === 'shelter';
}

function drawFarmer(f, sx, sy) {
    const frames = farmerSprites(f);
    let frame = frames.idle;
    if (f.state === 'walk' || f.state === 'flee') {
        frame = Math.floor(f.animTime * (f.state === 'flee' ? 11 : 7)) % 2 ? frames.walk1 : frames.walk2;
    } else if (f.state === 'work' || f.state === 'build' || f.state === 'coopbuild' || f.state === 'housebuild' || f.state === 'chop' || f.state === 'break' || f.state === 'forage' || f.state === 'mine' || f.state === 'fencepost' || f.state === 'scarecrow' || f.state === 'fight') {
        frame = Math.floor(f.animTime * (f.state === 'fight' ? 8 : 5)) % 2 ? frames.work : frames.idle;
    } else if (f.state === 'sleep') {
        frame = frames.sleep;
    }

    const fw = frame.width, fh = frame.height;
    const px = Math.floor(sx - fw / 2);
    const py = Math.floor(sy + TILE_H / 2 - fh + 2);
    const footY = py + fh - 2;

    // lantern glow for anyone up and about at night — a warm pool of light cast additively
    // over the scene (reads as EMITTED light, not a flat overlay) with a hot flickering core.
    const awakeAtNight = world.isNight() && f.state !== 'sleep' && f.state !== 'shelter';
    if (awakeAtNight) {
        const carrying = f.state === 'work' || f.state === 'walk' || f.state === 'build';
        const flick = 0.82 + 0.18 * Math.sin(f.animTime * 9) + 0.06 * Math.sin(f.animTime * 23);
        const lx = sx + (carrying ? (f.facing < 0 ? -3 : 3) : 0);   // anchor on the held lantern
        const ly = py + (carrying ? 12 : 10);
        const R = carrying ? 34 : 26;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        // wide warm falloff
        const g = ctx.createRadialGradient(lx, ly, 1, lx, ly, R);
        g.addColorStop(0, `rgba(255,244,200,${0.55 * flick})`);
        g.addColorStop(0.35, `rgba(250,200,90,${0.34 * flick})`);
        g.addColorStop(0.7, `rgba(230,150,50,${0.14 * flick})`);
        g.addColorStop(1, 'rgba(230,150,50,0)');
        ctx.fillStyle = g;
        ctx.fillRect(lx - R, ly - R, R * 2, R * 2);
        // tight hot core
        const core = ctx.createRadialGradient(lx, ly, 0, lx, ly, 7);
        core.addColorStop(0, `rgba(255,252,235,${0.75 * flick})`);
        core.addColorStop(1, 'rgba(255,240,180,0)');
        ctx.fillStyle = core;
        ctx.fillRect(lx - 7, ly - 7, 14, 14);
        ctx.restore();
    }

    // tiny shadow
    ctx.fillStyle = 'rgba(10,14,10,0.35)';
    ctx.fillRect(px + 4, footY, fw - 8, 2);

    // flip for left/right only on the side view (front/back rows shouldn't mirror)
    if (f.facing < 0 && (!charReady() || f.moveDir === 'side')) {
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

    // struck by a threat: a red flash. In danger: a blinking red "!" over their head.
    if (f.hurtFlash > 0) {
        ctx.fillStyle = `rgba(224,64,48,${Math.min(0.55, f.hurtFlash * 0.5)})`;
        ctx.fillRect(px + 3, py + 2, fw - 6, fh - 4);
    }
    if (f.threatAlert > 0 && Math.floor(f.threatAlert * 6) % 2) {
        ctx.fillStyle = '#e83828'; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center';
        ctx.fillText('!', sx, py - 3); ctx.textAlign = 'left';
    }

    // carried lantern when working at night
    if (awakeAtNight && (f.state === 'work' || f.state === 'walk' || f.state === 'build')) {
        ctx.drawImage(lanternSprite, px + (f.facing < 0 ? -3 : fw - 1), py + 9);
    }

    // held hoe by day when doing farm work (so they read as farmers, not swordsmen)
    const toolStates = f.state === 'work' || f.state === 'chop' || f.state === 'mine' || f.state === 'forage';
    if (toolStates && !awakeAtNight) {
        const dir = f.facing < 0 ? -1 : 1;
        const hx = f.facing < 0 ? px + 1 : px + fw - 2;
        const hy = py + Math.floor(fh * 0.46);
        ctx.fillStyle = '#7a5632'; ctx.fillRect(hx, hy - 5, 1, 12);             // handle
        ctx.fillStyle = '#6a4a2a'; ctx.fillRect(hx, hy - 5, 1, 2);
        ctx.fillStyle = '#b6bcc8'; ctx.fillRect(hx + (dir < 0 ? -3 : 1), hy - 6, 3, 2);  // hoe blade
        ctx.fillStyle = '#8a909c'; ctx.fillRect(hx + (dir < 0 ? -3 : 1), hy - 5, 3, 1);
    }

    // carrying water indicator
    if (f.carryWater > 0 && f.state !== 'sleep') {
        ctx.fillStyle = '#5a8ac8';
        ctx.fillRect(px + (f.facing < 0 ? -2 : fw), py + 11, 2, 3);
    }

    // freshly-picked produce held up above the head. This is a HUD/inventory icon (a held
    // item badge), not a world sprite, so it's intentionally sized-to-fit (~11px) and exempt
    // from the global ASSET_SCALE world-sprite rule.
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

    // status icon: sleeping outside (animated Z), sick (+) or worn out (~), unless a bubble shows
    if (!f.bubble) {
        if (f.state === 'sleep' || f.state === 'rest') {
            const zt = Math.floor(f.animTime * 2) % 3;   // Z rising + fading, like the roof sleepers
            drawText(ctx, 'Z', px + 6, py - 8 - zt * 3, `rgba(200,210,255,${1 - zt * 0.25})`);
        } else if (f.health === 'sick') {
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

const FWD_BTN = { x: 0, y: 3, w: 0, h: 12 };      // 5x speed
const FF_BTN = { x: 0, y: 3, w: 0, h: 12 };       // 20x speed
const SPEED1_BTN = { x: 0, y: 3, w: 0, h: 12 };   // revert to 1x (visible while sped up)

// Minimap legend (bottom-right): faint land/buildings, bright farmer dots, a viewport box.
// Click it to jump the camera. Buildings are low-contrast; a home = 4 dots, a well = 1.
// The minimap is a WINDOW that follows the camera across the ever-growing map — it starts
// on the town (the camera does) and pans with the main view. Terrain base layer is cached
// and rebuilt only when the window moves meaningfully or the fog recedes.
const MINI_SPAN = 84;                       // tiles the window shows edge-to-edge
const [miniBase, miniCtx] = makeCanvas(46, 46);
let miniKey = '';
function minimapWindow() {
    const c = screenToTile(GW / 2, GH / 2);   // the camera's current focus tile
    return { ci: Math.round(c.i), cj: Math.round(c.j) };
}
function rebuildMiniBase(ci, cj) {
    const step = MINI_SPAN / 46;
    const seasonIdx = world.season;
    for (let py = 0; py < 46; py++) {
        for (let px = 0; px < 46; px++) {
            const i = Math.round(ci - MINI_SPAN / 2 + px * step);
            const j = Math.round(cj - MINI_SPAN / 2 + py * step);
            let col = '#15171d';                       // fog
            if (world.isRevealed(i, j)) {
                const t = world.get(i, j);
                col = t === T.WATER ? '#2a5a72'
                    : t === T.TREE ? (seasonIdx === 3 ? '#4a5a52' : '#2f5a30')
                    : t === T.ROCK ? '#6a6f78'
                    : t === T.TILLED ? '#5e4830'
                    : (t === T.HOUSE || t === T.COOP || t === T.BARN || t === T.STRUCT || t === T.WELL) ? '#8a8070'
                    : seasonIdx === 3 ? '#8fa0ac' : '#3d5a33';   // open ground (snowy in winter)
            }
            miniCtx.fillStyle = col;
            miniCtx.fillRect(px, py, 1, 1);
        }
    }
}
function drawMinimap() {
    MINIMAP.x = GW - MINIMAP.w - 5;
    MINIMAP.y = GH - 22 - MINIMAP.h - 5;
    const { x: mx, y: my, w: mw, h: mh } = MINIMAP;
    const { ci, cj } = minimapWindow();
    const t2m = (i, j) => [mx + ((i - ci) / MINI_SPAN + 0.5) * mw, my + ((j - cj) / MINI_SPAN + 0.5) * mh];
    const inWin = (i, j) => Math.abs(i - ci) <= MINI_SPAN / 2 && Math.abs(j - cj) <= MINI_SPAN / 2;
    const dot = (i, j, col, s = 1) => { if (!inWin(i, j)) return; const [px, py] = t2m(i, j); ctx.fillStyle = col; ctx.fillRect(Math.floor(px), Math.floor(py), s, s); };
    MINIMAP._ci = ci; MINIMAP._cj = cj;   // for click-to-jump mapping

    // cached terrain base — rebuilt when the window drifts, the fog recedes, or seasons turn
    const key = `${Math.round(ci / 4)},${Math.round(cj / 4)}:${world.exploredTiles}:${world.season}`;
    if (key !== miniKey) { miniKey = key; rebuildMiniBase(ci, cj); }

    ctx.fillStyle = 'rgba(10,11,15,0.9)';
    ctx.fillRect(mx - 3, my - 3, mw + 6, mh + 6);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(miniBase, mx, my, mw, mh);
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.strokeRect(mx - 2.5, my - 2.5, mw + 5, mh + 5);

    ctx.save();
    ctx.beginPath(); ctx.rect(mx, my, mw, mh); ctx.clip();

    // owned land (very low contrast) — actual flex cells, not the bounding box (cached per rev)
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    for (const p of world.plots) {
        if (p._miniRev !== p.rev) {
            p._miniCells = [...p.cells].map(k => { const c = k.indexOf(','); return [+k.slice(0, c), +k.slice(c + 1)]; });
            p._miniRev = p.rev;
        }
        for (const [ci, cj] of p._miniCells) { const [px, py] = t2m(ci, cj); ctx.fillRect(Math.floor(px), Math.floor(py), 1, 1); }
    }
    // wells + board = 1 low-contrast dot each
    for (const wl of world.wells) dot(wl.i, wl.j, 'rgba(120,170,210,0.7)', 1);
    if (world.board) dot(world.board.i, world.board.j, 'rgba(180,150,110,0.7)', 1);
    // communal structures = 2px low-contrast
    for (const s of world.structures) dot(s.i, s.j, 'rgba(160,160,180,0.7)', 2);
    // facilities (coop/barn) low-contrast
    for (const p of world.plots) for (const fac of p.facilities) if (fac.struct) dot(fac.struct.i, fac.struct.j, 'rgba(150,120,90,0.7)', 2);
    // homes = a 4-dot (2x2) low-contrast grey cluster
    ctx.fillStyle = 'rgba(150,156,168,0.75)';
    for (const p of world.plots) { if (p.built.level < 1) continue; const [px, py] = t2m(p.house.i, p.house.j); ctx.fillRect(Math.floor(px), Math.floor(py), 2, 2); }

    // current viewport (the on-screen diamond)
    const corners = [screenToTile(0, 18), screenToTile(GW, 18), screenToTile(GW, GH - 22), screenToTile(0, GH - 22)];
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    corners.forEach((c, k) => { const [px, py] = t2m(c.i, c.j); k ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
    ctx.closePath(); ctx.stroke();

    // farmers = bright uniform yellow dots (selected = white), on top
    for (const f of world.farmers) {
        const col = f === selected ? '#ffffff' : '#f5d020';
        const [px, py] = t2m(f.pos.i, f.pos.j);
        if (f === selected) { ctx.fillStyle = '#000'; ctx.fillRect(Math.floor(px) - 1, Math.floor(py) - 1, 4, 4); }
        ctx.fillStyle = col; ctx.fillRect(Math.floor(px), Math.floor(py), 2, 2);
    }
    ctx.restore();
}

// Derive what a farmer most needs a hand with, for the board postings.
function helpNeed(f) {
    const plot = f.plot;
    let ripe = 0, dry = 0;
    for (const c of world.crops.values()) {
        if (c.owner !== f || c.withered) continue;
        if (c.stage === 3) ripe++;
        else if (c.water < 0.3) dry++;
    }
    let ready = 0, readyKind = null;
    for (const fac of plot.facilities) for (const pr of (fac.producers || [])) if (pr.ready) { ready++; readyKind = fac.struct ? fac.struct.kind : pr.kind; }
    let toTill = 0, toPlant = 0;
    for (const fld of plot.fields) {
        const t = world.get(fld.i, fld.j);
        if (t === T.GRASS) toTill++;
        else if (t === T.TILLED && !world.cropAt(fld.i, fld.j)) toPlant++;
    }
    if (ripe) return `harvesting ${ripe} ripe ${f.sheet.crop}`;
    if (dry) return `watering ${dry} thirsty crop${dry > 1 ? 's' : ''}`;
    if (ready) return `collecting from the ${readyKind || 'pen'}`;
    if (toPlant) return `sowing ${toPlant} empty bed${toPlant > 1 ? 's' : ''}`;
    if (toTill) return `breaking ground (${Math.min(toTill, 99)} tiles)`;
    return 'general farm chores';
}

// Town bulletin board: what the bots have posted — the communal project, help requests,
// and build ambitions. A left-side scrollable kit panel.
function drawBoard() {
    const PW = 188, PX = 6, PY = 22, PH = GH - 22 - PY - 3;
    BOARD_RECT.x = PX; BOARD_RECT.y = PY; BOARD_RECT.w = PW; BOARD_RECT.h = PH;
    uiPanel(PX, PY, PW, PH);
    const IX = PX + 7, IW = PW - 14;

    BOARD_CLOSE.x = PX + PW - 13; BOARD_CLOSE.y = PY + 3; BOARD_CLOSE.w = 10; BOARD_CLOSE.h = 10;
    ctx.fillStyle = '#3a2c1e'; ctx.fillRect(BOARD_CLOSE.x, BOARD_CLOSE.y, 10, 10);
    ctx.fillStyle = '#5a4632'; ctx.fillRect(BOARD_CLOSE.x, BOARD_CLOSE.y, 10, 1);
    drawText(ctx, 'X', BOARD_CLOSE.x + 3, BOARD_CLOSE.y + 3, '#e8c8a0');

    ctx.fillStyle = '#2b2016'; ctx.fillRect(IX - 2, PY + 16, IW + 4, 12);
    ctx.fillStyle = SHEET_GOLD; ctx.fillRect(IX - 2, PY + 16, IW + 4, 1); ctx.fillRect(IX - 2, PY + 27, IW + 4, 1);
    drawText(ctx, 'TOWN BOARD', IX, PY + 19, '#ffffff', 1);

    const bodyY = PY + 32, bodyH = PH - 32 - 5;
    ctx.save(); ctx.beginPath(); ctx.rect(IX - 3, bodyY, IW + 6, bodyH); ctx.clip();
    let y = bodyY - Math.round(boardScroll);
    const wrap = (t, col, ind = 0) => { for (const ln of wrapText(t, 30 - ind)) { drawText(ctx, ln, IX + ind, y, col); y += 7; } };

    // --- Town project ---
    y = sectionBand(IX, y, IW, 'TOWN PROJECT');
    if (world.project) {
        const pr = world.project;
        drawText(ctx, pr.label, IX, y, SHEET_VAL); y += 7;
        barFill(IX, y, IW, Math.min(pr.points / pr.needed, 1), '#7dd069');
        drawText(ctx, `${Math.floor(pr.points)}/${pr.needed}`, IX + IW - 26, y - 1, SHEET_LABEL); y += 7;
        wrap(pr.perk, SHEET_LABEL);
    } else { drawText(ctx, 'no project underway', IX, y, SHEET_LABEL); y += 7; }
    y += 4;

    // --- Neighborhood plans (farmer-proposed co-ops) ---
    if (world.coops.length) {
        y = sectionBand(IX, y, IW, 'NEIGHBORHOOD PLANS');
        for (const c of world.coops) {
            drawText(ctx, c.label, IX, y, SHEET_VAL); y += 7;
            wrap(`${c.proposer.sheet.name}'s idea - ${c.members.size} signed on`, SHEET_LABEL);
            if (c.stage === 'rally') wrap('needs one more pair of hands', '#8fc7e8');
            else if (c.stage === 'gather') wrap(`materials: ${c.wood}/${c.needWood} wood, ${c.ore}/${c.needOre} ore`, '#8fc7e8');
            else {
                barFill(IX, y, IW, Math.min(c.points / c.needed, 1), '#8fc7e8');
                drawText(ctx, `${Math.floor(c.points)}/${c.needed}`, IX + IW - 26, y - 1, SHEET_LABEL); y += 7;
            }
        }
        y += 4;
    }

    // --- Help wanted ---
    const reqs = world.helpBoard.filter(r => r.genuine);
    y = sectionBand(IX, y, IW, `HELP WANTED (${reqs.length})`);
    if (reqs.length) {
        for (const r of reqs) {
            const nm = r.farmer.sheet.name;
            drawText(ctx, '-', IX, y, '#e0a03c');
            drawText(ctx, nm, IX + 7, y, SHEET_VAL);
            const stat = r.farmer.state === 'sleep' ? 'asleep' : r.farmer.tired ? 'worn out' : 'swamped';
            drawText(ctx, stat, IX + IW - textWidth(stat), y, SHEET_LABEL); y += 7;
            for (const ln of wrapText('needs a hand ' + helpNeed(r.farmer), 30)) { drawText(ctx, ln, IX + 7, y, SHEET_LABEL); y += 7; }
            const pay = r.reward ? `offers ${r.reward.offer} ${r.reward.good}` : 'offers only thanks';
            drawText(ctx, pay, IX + 7, y, '#e8c860'); y += 9;
        }
    } else { drawText(ctx, 'nobody needs help right now', IX, y, SHEET_LABEL); y += 7; }
    y += 4;

    // --- Ambitions ---
    const ambitions = world.farmers.filter(f => f.wantExpand || f.wantFacility);
    y = sectionBand(IX, y, IW, `AMBITIONS (${ambitions.length})`);
    if (ambitions.length) {
        for (const f of ambitions) {
            const what = f.wantExpand ? 'wants more land' : 'wants to build';
            drawText(ctx, '-', IX, y, '#c9a45a');
            drawText(ctx, f.sheet.name, IX + 7, y, SHEET_VAL); y += 7;
            drawText(ctx, what, IX + 7, y, SHEET_LABEL); y += 8;
        }
    } else { drawText(ctx, 'everyone is content', IX, y, SHEET_LABEL); y += 7; }
    y += 6;

    ctx.restore();
    const contentH = (y + boardScroll) - bodyY;
    boardMaxScroll = Math.max(0, contentH - bodyH);
    if (boardScroll > boardMaxScroll) boardScroll = boardMaxScroll;
    if (boardMaxScroll > 0) {
        const thumbH = Math.max(12, bodyH * bodyH / contentH);
        const thumbY = bodyY + (boardScroll / boardMaxScroll) * (bodyH - thumbH);
        ctx.fillStyle = 'rgba(201,164,90,0.55)'; ctx.fillRect(PX + PW - 5, Math.floor(thumbY), 2, Math.floor(thumbH));
    }
}

// A dwelling under construction: a gray foundation pad staked over the 5x5 footprint, with the
// house sprite RISING from the ground (revealed bottom-up by build progress) + a progress bar.
function drawFoundation(h, sx, sy, art, prog, ft = 5) {
    const ci = h.i + 2, cj = h.j + 2, half = ft >> 1;   // footprint centred on the house centre
    for (let dj = -half; dj <= half; dj++) for (let di = -half; di <= half; di++) {   // gray foundation pad
        const dx = cam.x + isoX(ci + di, cj + dj) - 10, dy = cam.y + isoY(ci + di, cj + dj);
        fillDiamond(ctx, Math.floor(dx), Math.floor(dy), ((di + dj) & 1) ? '#615c53' : '#6b665c');
    }
    if (art && art.ready && prog > 0) {   // the house rising, revealed from the bottom up
        const S = art.src;
        const dispW = Math.round(S.w * HOUSE_ART_SCALE), dispH = Math.round(dispW * S.h / S.w);
        const hx = Math.floor(sx - dispW / 2), hy = Math.floor(sy + TILE_H - dispH + 3);
        const srcH = Math.max(1, Math.round(S.h * prog)), srcY = S.y + S.h - srcH;
        const dH = Math.max(1, Math.round(dispH * prog)), dY = hy + dispH - dH;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(art.img, S.x, srcY, S.w, srcH, hx, dY, dispW, dH);
    }
    const barY = Math.floor(sy - 10), bw = 26;   // progress bar floating above the pad
    ctx.fillStyle = '#20222c'; ctx.fillRect(Math.floor(sx - bw / 2), barY, bw, 4);
    ctx.fillStyle = '#c9a45a'; ctx.fillRect(Math.floor(sx - bw / 2), barY, Math.round(bw * prog), 4);
}

// A small pixel speaker for the sound toggle: driver + cone pointing right, green sound-waves when
// on, a red X when muted. Drawn in a ~8x8 area at (x,y).
function drawSpeakerIcon(x, y, on) {
    ctx.fillStyle = '#c8ccd8';
    ctx.fillRect(x, y + 2, 2, 4);        // driver/neck
    ctx.fillRect(x + 2, y + 1, 1, 6);    // cone mid
    ctx.fillRect(x + 3, y, 1, 8);        // cone mouth (tallest)
    if (on) {
        ctx.fillStyle = '#7dd069';
        ctx.fillRect(x + 5, y + 3, 1, 2);
        ctx.fillRect(x + 6, y + 2, 1, 1); ctx.fillRect(x + 6, y + 5, 1, 1);
        ctx.fillRect(x + 7, y + 1, 1, 1); ctx.fillRect(x + 7, y + 6, 1, 1);
    } else {
        ctx.fillStyle = '#c05840';       // muted: a small X
        ctx.fillRect(x + 5, y + 2, 1, 1); ctx.fillRect(x + 6, y + 3, 1, 1); ctx.fillRect(x + 7, y + 4, 1, 1);
        ctx.fillRect(x + 7, y + 2, 1, 1); ctx.fillRect(x + 5, y + 4, 1, 1);
    }
}

function drawUI() {
    // top bar
    ctx.fillStyle = 'rgba(12,14,22,0.92)';
    ctx.fillRect(0, 0, GW, 18);
    ctx.fillStyle = '#20242f';
    ctx.fillRect(0, 18, GW, 1);

    drawText(ctx, 'RY FARMS', 4, 4, '#7dd069', 2);
    let hx = 74;
    hx += drawText(ctx, `DAY ${world.day}`, hx, 7, '#c8ccd8') + 8;

    // town level — a shared progress badge (pulses gold briefly on a level-up)
    {
        const flash = (world.townLevelFlash || 0) > 0 && Math.floor(performance.now() / 160) % 2 === 0;
        hx += drawText(ctx, `TOWN LV ${world.townLevel}`, hx, 7, flash ? '#ffffff' : '#e0b84a') + 8;
    }

    // time of day — always shown (morning / afternoon / evening / night)
    {
        let tod, tcol;
        if (world.isNight()) { tod = 'NIGHT'; tcol = '#8a9ade'; }
        else {
            const fr = Math.min(0.999, Math.max(0, world.clock / DAY_LENGTH));
            if (fr < 0.34) { tod = 'MORNING'; tcol = '#e6c85a'; }
            else if (fr < 0.67) { tod = 'AFTERNOON'; tcol = '#f0d060'; }
            else { tod = 'EVENING'; tcol = '#e0956a'; }
        }
        hx += drawText(ctx, tod, hx, 7, tcol) + 8;
    }

    // season (color-coded)
    const season = world.seasonDef;
    hx += drawText(ctx, season.name, hx, 7, season.accent) + 8;

    // weather (blink on storm/blizzard)
    const wl = world.weatherLabel;
    const blink = (world.weather === 'storm' || world.weather === 'blizzard') && Math.floor(performance.now() / 300) % 2 === 0;
    const wcol = { sun: '#f0d060', cloud: '#9aa0b4', rain: '#6a9ade', storm: '#e05840', blizzard: '#bcd8ec', drought: '#e0a03c' }[world.weather];
    if (!blink) drawText(ctx, wl, hx, 7, wcol);
    hx += textWidth(wl) + 8;

    // merchant-in-town banner (blinks coin-gold) so the player heads over to trade
    if (world.merchant) {
        const ml = world.merchant.state === 'trading' ? 'MERCHANT IN TOWN' : 'MERCHANT ARRIVING';
        const mblink = Math.floor(performance.now() / 420) % 2 === 0;
        drawText(ctx, ml, hx, 7, mblink ? '#f0c850' : '#b8902f');
        hx += textWidth(ml) + 8;
    }

    // (help requests now surface on the Town Board, not the top bar)

    // top-right button strip, laid out right-to-left with uniform inner padding
    const BPAD = 5, BGAP = 6;
    let bx = GW - 4;
    const barBtn = (rect, label, active, activeBg, activeFg) => {
        rect.w = textWidth(label) + BPAD * 2; rect.h = 12; rect.y = 3;
        bx -= rect.w; rect.x = bx; bx -= BGAP;
        ctx.fillStyle = active ? activeBg : 'rgba(255,255,255,0.08)';
        ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
        drawText(ctx, label, rect.x + BPAD, rect.y + 4, active ? activeFg : '#c8ccd8');
    };
    // a small icon-only button in the same right-to-left strip (used for the sound toggle)
    const barIconBtn = (rect, w, drawIcon) => {
        rect.w = w; rect.h = 12; rect.y = 3;
        bx -= rect.w; rect.x = bx; bx -= BGAP;
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
        drawIcon(rect.x, rect.y);
    };

    // sound toggle — RIGHTMOST (drawn first), a speaker icon (with an X when muted), no text
    barIconBtn(SND_BTN, 15, (x, y) => drawSpeakerIcon(x + 3, y + 2, audio.enabled));

    // speed controls in the corner: > = 5x, >> = 20x; a 1X revert appears while sped up
    const spd = world._speedMult || 1;
    barBtn(FF_BTN, '>>', spd === 20, '#e0a03c', '#221a0e');
    barBtn(FWD_BTN, '>', spd === 5, '#e0a03c', '#221a0e');
    SPEED1_BTN.w = 0;
    if (spd !== 1) barBtn(SPEED1_BTN, '1X', true, '#c05840', '#ffffff');

    barBtn(ROSTER_BTN, 'ROSTER', rosterOpen, '#7dd069', '#10240c');

    BOARD_BTN.hidden = !world.board;   // only exists once the town has built the board
    if (!BOARD_BTN.hidden) {
        const postCount = world.helpBoard.filter(r => r.genuine).length + (world.project ? 1 : 0);
        barBtn(BOARD_BTN, 'BOARD', boardOpen, '#c9a45a', '#221a0e');
        if (postCount > 0 && !boardOpen) { ctx.fillStyle = '#e0a03c'; ctx.fillRect(BOARD_BTN.x + BOARD_BTN.w - 4, BOARD_BTN.y - 1, 4, 4); }
    }


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
    else { drawMinimap(); if (boardOpen) drawBoard(); else if (selected) drawSheet(selected); }
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
    volatility: '#c87ad0', curiosity: '#40c8c0',
};
const FAC_SHORT = { pond: 'pond', coop: 'coop', pen: 'pen', sheeppen: 'sheep' };
const ACT_WORD = { collect: 'gathering', tend: 'tending', harvest: 'harvesting', water: 'watering', plant: 'planting', till: 'tilling', clear: 'clearing' };

function barFill(x, y, w, frac, color, bg = '#20242f') {
    ctx.fillStyle = bg;
    ctx.fillRect(x, y, w, 3);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, Math.max(0, Math.floor(w * Math.min(frac, 1))), 3);
}

// One inventory/tool cell: beveled dark slot + 16px icon + count/lock badge. Matches the
// wood panel look rather than the lighter RPG parchment so it stays cohesive with the sheet.
function drawItemSlot(x, y, sz, iconImg, count, opts = {}) {
    ctx.fillStyle = '#0e0b08'; ctx.fillRect(x, y, sz, sz);
    ctx.fillStyle = opts.locked ? '#1c160f' : '#241a11'; ctx.fillRect(x + 1, y + 1, sz - 2, sz - 2);
    ctx.fillStyle = '#3a2c1c'; ctx.fillRect(x + 1, y + 1, sz - 2, 1);   // top bevel
    if (opts.hi) { ctx.fillStyle = '#c9a45a'; ctx.fillRect(x, y, sz, 1); ctx.fillRect(x, y, 1, sz); ctx.fillRect(x + sz - 1, y, 1, sz); ctx.fillRect(x, y + sz - 1, sz, 1); }
    if (opts.sel) {   // clicked/selected: a bright white ring so it reads as "picked"
        ctx.fillStyle = '#fff4d0';
        ctx.fillRect(x, y, sz, 1); ctx.fillRect(x, y, 1, sz); ctx.fillRect(x + sz - 1, y, 1, sz); ctx.fillRect(x, y + sz - 1, sz, 1);
    }
    if (iconImg && iconImg.complete && iconImg.naturalWidth) {
        const s = sz - 2, off = 1;
        ctx.save();
        if (opts.locked) ctx.globalAlpha = 0.35;
        ctx.drawImage(iconImg, x + off, y + off, s, s);
        ctx.restore();
    }
    if (count != null) {
        const str = String(count);
        const bw = textWidth(str) + 2;
        ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.fillRect(x + sz - bw - 1, y + sz - 7, bw + 1, 7);
        drawText(ctx, str, x + sz - bw, y + sz - 6, '#ffe08a');
    }
    if (opts.lockText) drawText(ctx, opts.lockText, x + 2, y + 2, '#c9a45a');
}

// A small floating label for a hovered/selected inventory slot — since the icons carry
// no text, this is how the player learns what each one is. Clamped to stay on screen.
function drawSlotTooltip(slot) {
    const lines = [{ t: slot.tip.title, c: '#ffe08a' }, { t: slot.tip.body, c: '#c8ccd8' }];
    if (slot.tip.req) lines.push({ t: slot.tip.req, c: '#e0a860' });
    const pad = 3, lh = 7;
    const w = Math.max(...lines.map(l => textWidth(l.t))) + pad * 2;
    const h = lines.length * lh + pad * 2 - 1;
    let bx = slot.x + slot.w + 3, by = slot.y - 2;
    if (bx + w > GW - 2) bx = slot.x - w - 3;        // flip to the left if it would overflow
    if (bx < 2) bx = Math.max(2, Math.min(GW - w - 2, slot.x));
    by = Math.max(2, Math.min(GH - h - 2, by));
    ctx.fillStyle = 'rgba(0,0,0,0.85)'; ctx.fillRect(bx - 1, by - 1, w + 2, h + 2);
    ctx.fillStyle = '#2b2016'; ctx.fillRect(bx, by, w, h);
    ctx.fillStyle = '#c9a45a'; ctx.fillRect(bx, by, w, 1); ctx.fillRect(bx, by + h - 1, w, 1);
    let ty = by + pad;
    for (const l of lines) { drawText(ctx, l.t, bx + pad, ty, l.c); ty += lh; }
}

// ---------------------------------------------------------------------------
// Building hover tooltips — hover any structure to read its name, tier, and what
// it does for the town, mirroring the inventory item tooltips.
// ---------------------------------------------------------------------------
const TT_G = '#ffe08a', TT_L = '#8f8570', TT_GR = '#7dd069', TT_B = '#8ad0e0';
function drawInfoBox(ax, ay, lines) {
    const pad = 3, lh = 7;
    const w = Math.max(...lines.map(l => textWidth(l.t))) + pad * 2;
    const h = lines.length * lh + pad * 2 - 1;
    let bx = ax + 11, by = ay + 6;
    if (bx + w > GW - 2) bx = ax - w - 8;
    bx = Math.max(2, Math.min(GW - w - 2, bx));
    by = Math.max(2, Math.min(GH - h - 2, by));
    ctx.fillStyle = 'rgba(0,0,0,0.85)'; ctx.fillRect(bx - 1, by - 1, w + 2, h + 2);
    ctx.fillStyle = '#2b2016'; ctx.fillRect(bx, by, w, h);
    ctx.fillStyle = '#c9a45a'; ctx.fillRect(bx, by, w, 1); ctx.fillRect(bx, by + h - 1, w, 1);
    let ty = by + pad;
    for (const l of lines) { drawText(ctx, l.t, bx + pad, ty, l.c); ty += lh; }
}
function houseLines(f, lvl) {
    const name = lvl >= 3 ? 'COTTAGE' : lvl >= 2 ? 'YURT' : 'TIPI';
    const who = f.sheet.name.split(' ')[0];
    const lines = [{ t: name, c: TT_G }, { t: `${who}'s home - tier ${lvl}`, c: TT_L }];
    if (lvl >= 3) { lines.push({ t: 'Estate: up to 560 tiles', c: TT_GR }, { t: 'Livestock + frontier fields', c: TT_GR }, { t: 'Big stores (160 wood / 80 ore)', c: TT_GR }); }
    else if (lvl >= 2) { lines.push({ t: 'Bigger farm (up to 360 tiles)', c: TT_GR }, { t: 'Bigger stores (80 wood / 40 ore)', c: TT_GR }, { t: 'Upgrade unlocks livestock', c: TT_L }); }
    else { lines.push({ t: 'Small yard (up to 200 tiles)', c: TT_GR }, { t: 'Upgrade for more land + stores', c: TT_L }); }
    return lines;
}
const STRUCT_INFO = {
    toolshed: ['TOOLSHED', 'Town structure', 'All farm work +12% faster', TT_GR],
    windmill: ['WINDMILL', 'Town structure', 'Crops grow +15% faster', TT_GR],
    well2: ['WELL', 'Water source', 'Shorter water runs', TT_B],
    statue1: ['GUARDIAN HEAD', 'Guardian statue - tier 1', 'Lightning -18% - Rain +10%', TT_B],
    statue2: ['FOX SENTINEL', 'Guardian statue - tier 2', 'Lightning -45% - Rain +30%', TT_B],
    statue3: ['STONE MOTHER', 'Guardian statue - tier 3', 'Lightning -75% - Rain +60%', TT_B],
};
function structLines(s) {
    const m = STRUCT_INFO[s.type] || [String(s.type).toUpperCase(), 'Structure', '', TT_GR];
    const lines = [{ t: m[0], c: TT_G }, { t: m[1], c: TT_L }];
    if (m[2]) lines.push({ t: m[2], c: m[3] });
    return lines;
}
const FAC_INFO = {
    coop: ['CHICKEN COOP', 'Hens lay an egg a day'],
    pen: ['LIVESTOCK PEN', 'Cows/pigs/goats, tended daily'],
    sheeppen: ['SHEEP PEN', 'A flock shorn for wool'],
    pond: ['WATER GARDEN', 'Fish & lilies (frozen in winter)'],
};
function facLines(fac, owner) {
    const m = FAC_INFO[fac.type] || [String(fac.type).toUpperCase(), ''];
    const who = owner ? owner.sheet.name.split(' ')[0] + "'s " : '';
    const lines = [{ t: m[0], c: TT_G }, { t: `${who}facility`, c: TT_L }];
    if (m[1]) lines.push({ t: m[1], c: TT_GR });
    return lines;
}
// Screen-space hit test against each building's DRAWN sprite box (accurate for tall
// iso sprites, where the ground tile under the cursor isn't the building's tile).
function buildingUnder(mx, my) {
    const rects = [];
    const push = (x, y, w, h, lines) => rects.push({ x, y, w, h, lines });
    for (const f of world.farmers) {
        if (f.plot.built.level < 1) continue;
        const h = f.plot.house, lvl = f.plot.built.level, F = 5;
        const sx = cam.x + isoX(h.i + (F - 1) / 2, h.j + (F - 1) / 2);
        const sy = cam.y + isoY(h.i + (F - 1) / 2, h.j + (F - 1) / 2);
        const art = buildingArt(lvl);
        if (art && art.ready) {
            const S = art.src, bw = Math.round(S.w * HOUSE_ART_SCALE), bh = Math.round(bw * S.h / S.w);
            push(Math.floor(sx - bw / 2), Math.floor(sy + TILE_H - bh + 3), bw, bh, houseLines(f, lvl));
        } else push(Math.floor(sx - 17), Math.floor(sy - 22), 34, 30, houseLines(f, lvl));
    }
    for (const s of world.structures) {
        const sx = cam.x + isoX(s.i, s.j), sy = cam.y + isoY(s.i, s.j);
        if (String(s.type).startsWith('statue') && imageLoaded(statueImgs[s.type])) {
            const img = statueImgs[s.type], size = s.size || 1;
            const bx0 = cam.x + isoX(s.i + size / 2 - 0.5, s.j + size / 2 - 0.5);
            const by0 = cam.y + isoY(s.i + size - 1, s.j + size - 1) + TILE_H;
            const dw = STATUE_DRAW_W[s.type] || 46, dh = Math.round(dw * img.naturalHeight / img.naturalWidth);
            push(Math.floor(bx0 - dw / 2), Math.floor(by0 - dh + 4), dw, dh, structLines(s));
        } else if (s.type === 'well2') {
            const wdw = Math.round(WELL_SRC.w * ASSET_SCALE), wdh = Math.round(WELL_SRC.h * ASSET_SCALE);
            push(Math.floor(sx + TILE_W / 2 - wdw / 2 - 10), Math.floor(sy + TILE_H - wdh + 2), wdw, wdh, structLines(s));
        } else {
            const spr = structSprites[s.type], sp = Array.isArray(spr) ? spr[0] : spr;
            if (sp) push(Math.floor(sx - sp.width / 2), Math.floor(sy + TILE_H - sp.height), sp.width, sp.height, structLines(s));
        }
    }
    { const wl = world.well, sx = cam.x + isoX(wl.i, wl.j), sy = cam.y + isoY(wl.i, wl.j);
      const wdw = Math.round(WELL_SRC.w * ASSET_SCALE), wdh = Math.round(WELL_SRC.h * ASSET_SCALE);
      push(Math.floor(sx + TILE_W / 2 - wdw / 2 - 10), Math.floor(sy + TILE_H - wdh + 2), wdw, wdh,
        [{ t: 'TOWN WELL', c: TT_G }, { t: 'Water source', c: TT_L }, { t: 'Water for the whole town', c: TT_B }]); }
    { const s = world.silo, sx = cam.x + isoX(s.i, s.j), sy = cam.y + isoY(s.i, s.j);
      const maxed = world.townLevel >= 10;
      push(Math.floor(sx - 9), Math.floor(sy + TILE_H - 22), 18, 24,
        [{ t: `TOWN SILO — LV ${world.townLevel}`, c: TT_G }, { t: 'The town levels on donations', c: TT_L },
         { t: 'Settlers give surplus goods here', c: TT_GR },
         { t: maxed ? 'The town is fully grown' : `${world.townXP} / ${world.townXpNeed()} to level ${world.townLevel + 1}`, c: TT_B }]); }
    if (world.board && boardScreen.w) push(boardScreen.x, boardScreen.y, boardScreen.w, boardScreen.h,
        [{ t: 'BULLETIN BOARD', c: TT_G }, { t: 'Town structure', c: TT_L }, { t: 'Farmers post & take jobs', c: TT_GR }]);
    for (const p of world.plots) for (const fac of p.facilities) {
        const cxT = fac.x + fac.w / 2 - 0.5, cyT = fac.y + fac.h / 2 - 0.5;
        const sx = cam.x + isoX(cxT, cyT), sy = cam.y + isoY(cxT, cyT);
        const halfw = (fac.w + fac.h) * (TILE_W / 4), halfh = (fac.w + fac.h) * (TILE_H / 4);
        push(Math.floor(sx - halfw), Math.floor(sy - halfh + TILE_H / 2), Math.floor(halfw * 2), Math.floor(halfh * 2),
            facLines(fac, world.farmers.find(fm => fm.plot === p)));
    }
    // the wandering merchant, while their stall is open
    const mch = world.merchant;
    if (mch && mch.state === 'trading') {
        const sx = cam.x + isoX(mch.pos.i, mch.pos.j), sy = cam.y + isoY(mch.pos.i, mch.pos.j);
        const disp = Math.round(32 * ASSET_SCALE);
        push(Math.floor(sx - disp / 2), Math.floor(sy + TILE_H / 2 - disp + 2), disp, disp, [
            { t: mch.name.replace(/^an? /, '').toUpperCase(), c: TT_G },
            { t: 'Wandering trader', c: TT_L },
            { t: 'Trades surplus goods for ore', c: TT_GR },
            { t: `1 ore per ${mch.rate} goods`, c: TT_B },
            { t: `${mch.stock} ore in stock`, c: TT_GR },
        ]);
    }

    // most specific match = the drawn box whose center is nearest the cursor
    let best = null, bestD = Infinity;
    for (const r of rects) {
        if (mx < r.x || mx > r.x + r.w || my < r.y || my > r.y + r.h) continue;
        const d = (mx - (r.x + r.w / 2)) ** 2 + (my - (r.y + r.h / 2)) ** 2;
        if (d < bestD) { bestD = d; best = r; }
    }
    return best ? best.lines : null;
}

const SHEET_LABEL = '#8f8570', SHEET_VAL = '#e8e0cc', SHEET_GOLD = '#c9a45a';
function drawSheet(f) {
    const s = f.sheet, p = s.personality;
    const PW = 154, PX = GW - PW - 4, PY = 22;
    const PH = GH - 22 - PY - 3;   // full height, down to just above the bottom log bar
    SHEET_RECT.x = PX; SHEET_RECT.y = PY; SHEET_RECT.w = PW; SHEET_RECT.h = PH;
    uiPanel(PX, PY, PW, PH);
    const IX = PX + 7, IW = PW - 14;
    const eCol = f.health === 'sick' ? '#c05840' : f.tired ? '#e0a03c' : '#7dd069';

    // --- close (X) button, top-right corner ---
    SHEET_CLOSE.x = PX + PW - 13; SHEET_CLOSE.y = PY + 3; SHEET_CLOSE.w = 10; SHEET_CLOSE.h = 10;
    ctx.fillStyle = '#3a2c1e'; ctx.fillRect(SHEET_CLOSE.x, SHEET_CLOSE.y, SHEET_CLOSE.w, SHEET_CLOSE.h);
    ctx.fillStyle = '#5a4632'; ctx.fillRect(SHEET_CLOSE.x, SHEET_CLOSE.y, SHEET_CLOSE.w, 1);
    drawText(ctx, 'X', SHEET_CLOSE.x + 3, SHEET_CLOSE.y + 3, '#e8c8a0');

    // --- fixed title band (name + archetype/level + health) ---
    ctx.fillStyle = '#2b2016'; ctx.fillRect(IX - 2, PY + 16, IW + 4, 21);
    ctx.fillStyle = SHEET_GOLD; ctx.fillRect(IX - 2, PY + 16, IW + 4, 1); ctx.fillRect(IX - 2, PY + 36, IW + 4, 1);
    drawText(ctx, s.name, IX, PY + 19, '#ffffff', 1);
    drawText(ctx, `${s.archetype.toUpperCase()} LV${s.level}`, IX, PY + 28, SHEET_GOLD);
    const hStr = f.health === 'sick' ? 'SICK' : f.tired ? 'TIRED' : 'WELL';
    drawText(ctx, hStr, IX + IW - textWidth(hStr), PY + 28, eCol);

    // --- tab bar (fixed, below the title band) — the long scroll is now split into four
    //     views so nothing important stays buried below the fold ---
    const TAB_LABELS = ['STATS', 'ACTIVITY', 'TIES', 'MEMORY'];
    const tabY = PY + 39, tabH = 12, tseg = (IW + 4) / TAB_LABELS.length;
    SHEET_TABS = [];
    for (let t = 0; t < TAB_LABELS.length; t++) {
        const tx0 = Math.round(IX - 2 + t * tseg), tw = Math.round(IX - 2 + (t + 1) * tseg) - tx0;
        const active = sheetTab === t;
        ctx.fillStyle = active ? '#3a2c1e' : '#20180f';
        ctx.fillRect(tx0, tabY, tw - 1, tabH);
        if (active) { ctx.fillStyle = SHEET_GOLD; ctx.fillRect(tx0, tabY, tw - 1, 1); }
        else { ctx.fillStyle = '#4a3824'; ctx.fillRect(tx0, tabY + tabH - 1, tw - 1, 1); }
        const lbl = TAB_LABELS[t];
        drawText(ctx, lbl, tx0 + Math.max(1, Math.floor((tw - 1 - textWidth(lbl)) / 2)), tabY + 3, active ? '#ffe08a' : SHEET_LABEL);
        SHEET_TABS.push({ x: tx0, y: tabY, w: tw - 1, h: tabH, tab: t });
    }

    // --- scrollable body (per active tab) ---
    const bodyY = PY + 41 + tabH, bodyH = PH - (41 + tabH) - 5;
    sheetBodyY = bodyY; sheetBodyH = bodyH;
    if (sheetLastSel !== f) { sheetLastSel = f; sheetMemPage = 0; sheetTab = 0; sheetScroll = 0; }
    ctx.save();
    ctx.beginPath(); ctx.rect(IX - 3, bodyY, IW + 6, bodyH); ctx.clip();
    let y = bodyY - Math.round(sheetScroll);   // integer offset keeps bars/icons crisp while scrolling

    sheetSlots = [];   // rebuilt every frame for hover/click (STATS tab only); tested in screen space
    MEM_PREV.w = 0; MEM_NEXT.w = 0;
    const SZ = 18, PITCH = 20, PER_ROW = 7;
    const addSlot = (sx, sy, key, tip) => sheetSlots.push({ x: sx, y: sy, w: SZ, h: SZ, key, tip });

    if (sheetTab === 0) {
        // ===== STATS: who they are — creed, energy, personality, abilities, farm, gear =====
        for (const line of wrapText(p.creed, 32).slice(0, 2)) { drawText(ctx, `"${line}"`, IX, y, SHEET_LABEL); y += 7; }
        if (f.goal) { drawText(ctx, `> course: ${f.goal.toUpperCase()}`, IX, y, '#d08cc8'); y += 7; }
        y += 2;
        drawText(ctx, 'ENERGY', IX, y, SHEET_LABEL); barFill(IX + 42, y, IW - 42, f.energy, eCol); y += 6;
        drawText(ctx, 'XP', IX, y, SHEET_LABEL); barFill(IX + 42, y, IW - 42, Math.min(s.xp / xpForLevel(s.level), 1), '#5a8ac8'); y += 10;

        y = sectionBand(IX, y, IW, 'PERSONALITY');
        TRAIT_NAMES.forEach((tn) => { drawText(ctx, TRAIT_LABELS[tn], IX, y, SHEET_LABEL); barFill(IX + 58, y, IW - 58, p[tn], TRAIT_COLORS[tn]); y += 7; });
        y += 4;

        y = sectionBand(IX, y, IW, 'ABILITIES');
        const cols = [IX, IX + 74];
        STAT_NAMES.forEach((st, i) => {
            const cxp = cols[i % 2], cyp = y + Math.floor(i / 2) * 8;
            drawText(ctx, st.toUpperCase(), cxp, cyp, SHEET_LABEL);
            drawText(ctx, String(s.stats[st]).padStart(2), cxp + 20, cyp, SHEET_VAL);
            drawText(ctx, fmtMod(s.stats[st]), cxp + 33, cyp, mod(s.stats[st]) >= 0 ? '#7dd069' : '#e05840');
        });
        y += 28;

        y = sectionBand(IX, y, IW, 'FARM');
        const kv = (lx, label, val, vcol = SHEET_VAL) => { drawText(ctx, label, lx, y, SHEET_LABEL); drawText(ctx, String(val), lx + 32, y, vcol); };
        kv(IX, 'CROP', s.crop); y += 7;
        const facs = ['crops', ...f.plot.facilities.map(fc => FAC_SHORT[fc.type] || fc.type)];
        drawText(ctx, 'HAS', IX, y, SHEET_LABEL); drawText(ctx, facs.join(', ').slice(0, 26), IX + 32, y, SHEET_VAL); y += 7;
        kv(IX, 'LAND', `${f.plot.cells.size}t`); drawText(ctx, 'YIELD', IX + 76, y, SHEET_LABEL); drawText(ctx, String(s.harvested), IX + 108, y, SHEET_VAL); y += 7;
        kv(IX, 'REP', Math.round(f.reputation * 100)); drawText(ctx, 'BONDS', IX + 76, y, SHEET_LABEL); drawText(ctx, String(world.bondCount(f)), IX + 108, y, SHEET_VAL); y += 8;
        if (f.wantExpand || f.wantFacility) { drawText(ctx, f.wantExpand ? '> wants more land' : '> wants to build', IX, y, SHEET_GOLD); y += 8; }
        y += 2;

        y = sectionBand(IX, y, IW, 'INVENTORY');
        // item grid: one beveled slot per non-empty stack, 7 across
        const items = f.inventoryItems();
        const slotCount = Math.max(items.length, 7);   // always show at least one row of slots
        for (let k = 0; k < slotCount; k++) {
            const col = k % PER_ROW, row = Math.floor(k / PER_ROW);
            const sx = IX + col * PITCH, sy = y + row * PITCH;
            const it = items[k];
            if (it) {
                const key = `inv:${it.id}`;
                drawItemSlot(sx, sy, SZ, itemIcon(it.icon), it.count, { sel: selectedSlotKey === key });
                addSlot(sx, sy, key, { title: it.name, body: it.cap ? `you have ${it.count} / ${it.cap} storage` : `you have ${it.count}` });
            } else drawItemSlot(sx, sy, SZ, null, null);
        }
        y += Math.ceil(slotCount / PER_ROW) * PITCH + 2;

        // tools: owned crafted tools as bright slots, then the next locked unlock with its
        // level/ore requirement so the player can see what a farmer is working toward.
        y = sectionBand(IX, y, IW, 'TOOLS');
        let tx = IX, drewTool = false;
        for (const r of CRAFTABLES) {
            if (!f.hasTool(r.id)) continue;
            const key = `tool:${r.id}`;
            drawItemSlot(tx, y, SZ, itemIcon(r.icon), null, { hi: true, sel: selectedSlotKey === key });
            addSlot(tx, y, key, { title: r.name, body: r.desc });
            tx += PITCH; drewTool = true;
        }
        const next = f.nextUnlock();
        if (next) {
            const locked = f.sheet.level < next.reqLevel || f.ore < next.ore || f.wood < next.wood;
            const key = `tool:${next.id}`;
            drawItemSlot(tx, y, SZ, itemIcon(next.icon), null, { locked, sel: selectedSlotKey === key });
            const reqParts = [];
            if (f.sheet.level < next.reqLevel) reqParts.push(`LV${next.reqLevel}`);
            reqParts.push(`${next.ore}ore`, `${next.wood}wd`);
            addSlot(tx, y, key, { title: `${next.name} (locked)`, body: next.desc, req: `needs ${reqParts.join(' ')}` });
            tx += PITCH;
            drawText(ctx, next.name, tx + 3, y + 1, locked ? SHEET_LABEL : '#8ad0e0');
            drawText(ctx, reqParts.join(' '), tx + 3, y + 8, locked ? '#c07050' : '#7dd069');
            y += PITCH;
        } else if (drewTool) {
            drawText(ctx, 'all tools crafted', tx + 3, y + 6, SHEET_LABEL); y += PITCH;
        } else {
            drawText(ctx, 'no tools yet', tx, y + 6, SHEET_LABEL); y += PITCH;
        }
        // clicked-slot label line + a hover/selected tooltip drawn on top at the very end of drawSheet
        if (selectedSlotKey) {
            const sel = sheetSlots.find(s => s.key === selectedSlotKey);
            if (sel) { drawText(ctx, `> ${sel.tip.title}`, IX, y, '#ffe08a'); y += 8; }
            else selectedSlotKey = null;   // the selected stack emptied out
        }
        y += 2;
    } else if (sheetTab === 1) {
        // ===== ACTIVITY: what they're doing right now, and the lessons that shape it =====
        y = sectionBand(IX, y, IW, 'ACTIVITY');
        const helping = f.helpTask ? ` ${f.helpTask.requester.sheet.name.split(' ')[0]}` : '';
        const actWord = f.action ? (ACT_WORD[f.action.task?.act] || f.action.task?.act || 'working') : '';
        const doing = f.state === 'work' ? actWord + helping
            : f.state === 'chop' ? 'chopping wood' : f.state === 'break' ? 'clearing a stump'
            : f.state === 'forage' ? 'foraging wheat' : f.state === 'poach' ? 'sneaking'
            : f.state === 'build' ? 'building' : f.state === 'care' ? 'tending sick'
            : f.state === 'sick' ? 'recovering' : f.state === 'rest' ? 'napping'
            : f.state === 'decide-help' || (f.state === 'walk' && f.helpTask) ? 'helping' + helping
            : f.state === 'sleep' ? 'sleeping' : f.state === 'shelter' ? 'sheltering'
            : f.state === 'walk' ? 'walking' : 'thinking';
        drawText(ctx, 'NOW', IX, y, SHEET_LABEL); drawText(ctx, doing, IX + 32, y, SHEET_VAL); y += 9;
        drawText(ctx, 'THINKING', IX, y, SHEET_LABEL); y += 7;
        for (const line of wrapText(f.thought, 32).slice(0, 3)) { drawText(ctx, `"${line}"`, IX + 2, y, '#c8ccd8'); y += 7; }
        y += 3;
        if (f.illnesses > 0) {
            y = sectionBand(IX, y, IW, 'LESSONS LEARNED');
            const lesson = f.caution >= 3 ? `Fell ill ${f.illnesses}x - now paces carefully, won't overwork.`
                : f.caution >= 1 ? `Fell ill ${f.illnesses}x - learning to rest before burning out.`
                : `Fell ill ${f.illnesses}x.`;
            for (const line of wrapText(lesson, 32).slice(0, 3)) { drawText(ctx, line, IX + 2, y, '#c9a45a'); y += 7; }
            y += 3;
        }
    } else if (sheetTab === 2) {
        // ===== TIES: every meaningful relationship (strongest first) + overheard gossip =====
        const friends = f.allRegard(1), grudges = f.allRegard(-1);
        y = sectionBand(IX, y, IW, 'TOWN TIES');
        if (!friends.length && !grudges.length) { drawText(ctx, 'no strong ties yet', IX + 2, y, SHEET_LABEL); y += 8; }
        for (const fr of friends) {
            drawText(ctx, `Trusts ${fr.who.sheet.name.split(' ')[0]}`, IX + 2, y, '#7dd069'); y += 7;
            const r = f.opinionReasons && f.opinionReasons.get(fr.who.sheet.seed);
            if (r) for (const line of wrapText(`- ${r}`, 30).slice(0, 1)) { drawText(ctx, line, IX + 6, y, SHEET_LABEL); y += 7; }
        }
        for (const gr of grudges) {
            const verb = gr.v <= -0.35 ? 'Avoids' : 'Wary of';   // strong resentment = active avoidance
            drawText(ctx, `${verb} ${gr.who.sheet.name.split(' ')[0]}`, IX + 2, y, '#c05840'); y += 7;
            const r = f.opinionReasons && f.opinionReasons.get(gr.who.sheet.seed);
            if (r) for (const line of wrapText(`- ${r}`, 30).slice(0, 1)) { drawText(ctx, line, IX + 6, y, SHEET_LABEL); y += 7; }
        }
        y += 3;
        // rumors this farmer has OVERHEARD about others, separate from first-hand memories
        if (f.gossip && f.gossip.length) {
            y = sectionBand(IX, y, IW, `TOWN GOSSIP (${f.gossip.length})`);
            const heard = [...f.gossip].reverse().slice(0, 5);
            for (const g of heard) {
                const col = g.strength > 0.6 ? '#c8a86a' : g.strength > 0.4 ? '#9a8a5a' : '#6a5f45';
                drawText(ctx, `d${g.day}`, IX, y, '#a08050');
                for (const line of wrapText(`${g.from}: don't trust ${g.about}`, 27).slice(0, 2)) { drawText(ctx, line, IX + 17, y, col); y += 7; }
                y += 1;
            }
            y += 3;
        }
    } else {
        // ===== MEMORY: the episodic journal (newest first, paginated) + the source doc =====
        if (f.journal.length) {
            const perPage = 6;
            const pages = Math.ceil(f.journal.length / perPage);
            if (sheetMemPage >= pages) sheetMemPage = pages - 1;
            y = sectionBand(IX, y, IW, `MEMORIES (${f.journal.length})`);
            const entries = [...f.journal].reverse().slice(sheetMemPage * perPage, (sheetMemPage + 1) * perPage);
            for (const m of entries) {
                const col = m.strength > 0.8 ? '#c8ccd8' : m.strength > 0.45 ? '#8a8fa0' : '#5a5f6e';
                drawText(ctx, `d${m.day}`, IX, y, MEM_KIND_COLORS[m.kind] || SHEET_LABEL);
                for (const line of wrapText(m.text, 27).slice(0, 2)) { drawText(ctx, line, IX + 17, y, col); y += 7; }
                y += 1;
            }
            if (pages > 1) {
                const rowY = y;
                const lbl = `PAGE ${sheetMemPage + 1}/${pages}`;
                drawText(ctx, lbl, IX + Math.floor((IW - textWidth(lbl)) / 2), rowY, SHEET_LABEL);
                const visible = rowY >= bodyY - 2 && rowY <= bodyY + bodyH - 6;
                if (sheetMemPage > 0) {
                    drawText(ctx, '<<', IX + 2, rowY, SHEET_GOLD);
                    if (visible) { MEM_PREV.x = IX - 2; MEM_PREV.y = rowY - 3; MEM_PREV.w = 16; MEM_PREV.h = 11; }
                }
                if (sheetMemPage < pages - 1) {
                    drawText(ctx, '>>', IX + IW - 10, rowY, SHEET_GOLD);
                    if (visible) { MEM_NEXT.x = IX + IW - 14; MEM_NEXT.y = rowY - 3; MEM_NEXT.w = 16; MEM_NEXT.h = 11; }
                }
                y += 8;
            }
            y += 3;
        } else { y = sectionBand(IX, y, IW, 'MEMORIES (0)'); drawText(ctx, 'no memories yet', IX + 2, y, SHEET_LABEL); y += 8; }

        drawText(ctx, 'FROM MEMORY', IX, y, SHEET_LABEL); y += 7;
        for (const line of wrapText(s.memory.title, 32).slice(0, 3)) { drawText(ctx, line, IX + 2, y, '#8a9ade'); y += 7; }
        y += 5;
    }

    ctx.restore();

    // item tooltip (drawn unclipped, on top): hovered slot wins, else the clicked/selected one.
    // Only slots currently within the scrollable body are eligible.
    const inBody = (s) => s.y >= bodyY - 2 && s.y + s.h <= bodyY + bodyH + 2;
    let tipSlot = sheetSlots.find(s => inBody(s) && inRect(mouse, s));
    if (!tipSlot && selectedSlotKey) tipSlot = sheetSlots.find(s => s.key === selectedSlotKey && inBody(s));
    if (tipSlot) drawSlotTooltip(tipSlot);

    sheetContentH = (y + sheetScroll) - bodyY;
    maxSheetScroll = Math.max(0, sheetContentH - bodyH);
    if (sheetScroll > maxSheetScroll) sheetScroll = maxSheetScroll;

    // scrollbar thumb
    if (maxSheetScroll > 0) {
        const thumbH = Math.max(12, bodyH * bodyH / sheetContentH);
        const thumbY = bodyY + (sheetScroll / maxSheetScroll) * (bodyH - thumbH);
        ctx.fillStyle = 'rgba(201,164,90,0.55)';
        ctx.fillRect(PX + PW - 5, Math.floor(thumbY), 2, Math.floor(thumbH));
    }
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
    const PW = Math.min(GW - 12, 372);
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
    const colLv = PX + 86;
    const colStats = PX + 106;
    const statW = (PW - 106 - 26) / 6;
    drawText(ctx, 'NAME', colName, hy, '#6a6f7c');
    drawText(ctx, 'LV', colLv, hy, '#6a6f7c');
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
        const ry = bodyTop + idx * rowH - Math.round(rosterScroll);
        if (ry + rowH < bodyTop || ry > bodyBot) return;   // off-screen
        const s = f.sheet;
        const isLeader = world.leader === f;
        if (selected === f) { ctx.fillStyle = 'rgba(125,208,105,0.16)'; ctx.fillRect(PX + 2, ry - 1, PW - 4, rowH); }
        // health-tinted name; leader gets a star
        const nameCol = f.health === 'sick' ? '#e07868' : f.tired ? '#e0a03c' : '#e8ecf5';
        const nm = (isLeader ? '*' : '') + s.name;
        drawText(ctx, nm.slice(0, 16), colName, ry + 1, nameCol);
        drawText(ctx, String(s.level), colLv, ry + 1, '#7dd069');
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
    audio.ensure();   // browsers only allow audio to start on a user gesture
    const p = gamePoint(e);
    mouse.downX = p.x; mouse.downY = p.y;
    // don't world-pan when the gesture starts on the minimap, the detail card, or the board
    const onUI = !rosterOpen && (inRect(p, MINIMAP) || (selected && inRect(p, SHEET_RECT)) || (boardOpen && inRect(p, BOARD_RECT)));
    mouse.panStart = (rosterOpen || onUI) ? null : { x: p.x, y: p.y, camX: cam.x, camY: cam.y };
    mouse.dragging = false;
    try { out.setPointerCapture(e.pointerId); } catch { /* stale/synthetic pointer id — capture is best-effort */ }
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
    if (inRect(p, SND_BTN)) { audio.ensure(); audio.toggle(); return; }
    if (inRect(p, ROSTER_BTN)) { rosterOpen = !rosterOpen; if (rosterOpen) boardOpen = false; return; }

    // board toggle button (only when the board has been built)
    if (!BOARD_BTN.hidden && inRect(p, BOARD_BTN)) { boardOpen = !boardOpen; if (boardOpen) { selected = null; rosterOpen = false; boardScroll = 0; } return; }

    // board panel interactions (X or click-outside closes; clicks inside are consumed)
    if (boardOpen) {
        if (inRect(p, BOARD_CLOSE) || !inRect(p, BOARD_RECT)) boardOpen = false;
        return;
    }

    // spawn button (top-right)
    if (inRect(p, FWD_BTN)) { world._speedMult = world._speedMult === 5 ? 1 : 5; return; }
    if (inRect(p, FF_BTN)) { world._speedMult = world._speedMult === 20 ? 1 : 20; return; }
    if (SPEED1_BTN.w && inRect(p, SPEED1_BTN)) { world._speedMult = 1; return; }

    // roster overlay (modal) — handle before any world/minimap clicks
    if (rosterOpen) {
        const rv = rosterView;
        if (rv) {
            if ((p.x > rv.x + rv.w - 14 && p.y < rv.y + 12) ||
                p.x < rv.x || p.x > rv.x + rv.w || p.y < rv.y || p.y > rv.y + rv.h) { rosterOpen = false; return; }
            for (const row of rosterRows) {
                if (p.y >= row.y0 && p.y <= row.y1 && p.x > rv.x && p.x < rv.x + rv.w) {
                    selected = row.farmer; sheetScroll = 0; rosterOpen = false; return;
                }
            }
        }
        return;
    }

    // detail card: X closes it; clicks anywhere inside it are consumed. Checked BEFORE the
    // minimap because the full-height card is drawn OVER it (Codex: don't click through).
    if (selected && inRect(p, SHEET_CLOSE)) { selected = null; selectedSlotKey = null; return; }
    // tab bar: switch view (reset scroll so the new view starts at the top)
    if (selected) { for (const tb of SHEET_TABS) if (inRect(p, tb)) { if (sheetTab !== tb.tab) { sheetTab = tb.tab; sheetScroll = 0; selectedSlotKey = null; } return; } }
    if (selected && MEM_PREV.w && inRect(p, MEM_PREV)) { sheetMemPage = Math.max(0, sheetMemPage - 1); return; }
    if (selected && MEM_NEXT.w && inRect(p, MEM_NEXT)) { sheetMemPage++; return; }
    if (selected && inRect(p, SHEET_RECT)) {
        // click an inventory/tool slot to pin its name label + select ring; click empty space to clear
        const hit = sheetSlots.find(s => s.y >= sheetBodyY - 2 && s.y + s.h <= sheetBodyY + sheetBodyH + 2 && inRect(p, s));
        if (hit) selectedSlotKey = selectedSlotKey === hit.key ? null : hit.key;
        else selectedSlotKey = null;
        return;
    }

    // minimap: jump the camera (only interactive when visible — hidden under the card).
    // The map is a camera-following WINDOW now, so clicks map through its center.
    if (!selected && inRect(p, MINIMAP)) {
        const ci = MINIMAP._ci ?? world.well.i, cj = MINIMAP._cj ?? world.well.j;
        const ti = ci + ((p.x - MINIMAP.x) / MINIMAP.w - 0.5) * MINI_SPAN;
        const tj = cj + ((p.y - MINIMAP.y) / MINIMAP.h - 0.5) * MINI_SPAN;
        cam.x = GW / 2 - isoX(ti, tj);
        cam.y = GH / 2 - isoY(ti, tj);
        return;
    }

    // clicking the bulletin-board structure in the world opens the board
    if (inRect(p, boardScreen)) { boardOpen = true; selected = null; boardScroll = 0; return; }

    // farmer?
    let best = null, bestD = 1.6;
    const tile = screenToTile(p.x, p.y);
    for (const f of world.farmers) {
        const d = Math.hypot(f.pos.i - tile.i + 0.0, f.pos.j - tile.j);
        if (d < bestD) { bestD = d; best = f; }
    }
    if (best !== selected) { sheetScroll = 0; selectedSlotKey = null; }
    selected = best;
});

// wheel scrolls whichever panel is open (roster or the detail card)
out.addEventListener('wheel', (e) => {
    if (rosterOpen) { e.preventDefault(); rosterScroll += e.deltaY * 0.5; return; }
    if (boardOpen) { e.preventDefault(); boardScroll = Math.max(0, Math.min(boardMaxScroll, boardScroll + e.deltaY * 0.5)); return; }
    if (selected) { e.preventDefault(); sheetScroll = Math.max(0, Math.min(maxSheetScroll, sheetScroll + e.deltaY * 0.5)); }
}, { passive: false });

// T = snap the camera home to town (the plaza well). Plain T, not cmd+T — the browser
// owns cmd+T (new tab) and never lets the page see it.
window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if ((e.key === 't' || e.key === 'T') && world) {
        cam.x = GW / 2 - isoX(world.well.i, world.well.j);
        cam.y = GH / 2 - isoY(world.well.i, world.well.j) - 20;
    }
});

// ---------------------------------------------------------------------------
// Spawning
// ---------------------------------------------------------------------------

let reuseIdx = 0;
// Deterministic pick: stable order by hashed id, so the same seed + docs always grow the
// same roster. Once every memory is used, cycle through them in that stable order with an
// increasing mutation each lap, so a small doc pool still yields distinct farmers (not the
// same lowest-hash memory forever).
function pickMemory() {
    const unused = memories.filter(m => !usedMemoryIds.has(m.id));
    if (unused.length) {
        let best = unused[0], bestH = 0xffffffff;
        for (const m of unused) {
            const h = hashString((m.id || m.title || '') + ':pick');
            if (h < bestH) { bestH = h; best = m; }
        }
        usedMemoryIds.add(best.id);
        return { memory: best, mutation: 0 };
    }
    const ordered = memories
        .map(m => ({ m, h: hashString((m.id || m.title || '') + ':pick') }))
        .sort((a, b) => a.h - b.h).map(o => o.m);
    const memory = ordered[reuseIdx % ordered.length];
    const mutation = 1 + Math.floor(reuseIdx / ordered.length);
    reuseIdx++;
    return { memory, mutation };
}

function spawnFarmer() {
    // addFarmer is the authority on room (it lazily opens ring 2 and collision-checks
    // slots) — don't pre-guard on free slots or ring 2 can never open.
    const pick = pickMemory();
    const f = world.addFarmer(pick.memory, pick.mutation);
    if (f) { terrainDirty = true; selected = f; }
    else world.addLog('No room left! The valley is full.', '#e0a03c');
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

let last = performance.now();
// Fixed-step sim clock: the simulation advances in uniform FIXED_DT increments regardless of
// the frame schedule, so its evolution is deterministic (same seed + same number of steps ->
// identical state). Real frame time only decides HOW MANY steps to run this frame.
const FIXED_DT = 1 / 30;
let simAccumulator = 0;

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

    simAccumulator += dt * (world._speedMult || 1);
    let steps = 0;
    while (simAccumulator >= FIXED_DT && steps < 800) { world.tick(FIXED_DT); simAccumulator -= FIXED_DT; steps++; }

    // soundtrack follows the sim: seasonal theme by day, crickets/owls at night,
    // rain/thunder by weather, and a rooster crow at dawn once the town has one
    const anyBuilding = world.farmers.some(f => f.state === 'housebuild' || f.state === 'fencepost' || f.state === 'build' || f.state === 'coopbuild' || f.state === 'scarecrow');
    audio.update({ isNight: world.isNight(), weather: world.weather, flash: world.lightningFlash, season: world.season, hasRooster: world.hasRooster(), building: anyBuilding });
    // at extreme speeds keep a bounded backlog (spread over coming frames) rather than dropping
    // all the leftover time, but cap it so we never spiral.
    if (steps >= 800) simAccumulator = Math.min(simAccumulator, 800 * FIXED_DT);

    // background
    ctx.fillStyle = '#2a3438';
    ctx.fillRect(0, 0, GW, GH);

    world._tilesChanged = false;   // chunk-level dirt now drives rebakes
    if (world._seasonChanged) { chunkCanvases.clear(); world._seasonChanged = false; }
    drawTerrainChunks();

    // hover tile highlight (only over charted ground — the fog keeps its secrets)
    if (mouse.x >= 0 && !mouse.dragging) {
        const tile = screenToTile(mouse.x, mouse.y);
        const ti = Math.floor(tile.i), tj = Math.floor(tile.j);
        if (world.isRevealed(ti, tj)) {
            strokeDiamond(ctx, Math.floor(cam.x + isoX(ti, tj) - TILE_W / 2 + TILE_W / 2 - 10), Math.floor(cam.y + isoY(ti, tj)), 'rgba(255,255,255,0.35)');
        }
    }

    // y-sorted world objects
    const drawables = collectDrawables();
    drawables.sort((a, b) => (a.y - b.y) || ((a.layer || 0) - (b.layer || 0)) || ((a.x || 0) - (b.x || 0)));
    for (const d of drawables) d.draw();

    drawWeather(dt, t);
    drawUI();

    // building hover tooltip — only when hovering the world (not over a panel, not dragging,
    // and not while an inventory-slot tooltip is already showing on the open sheet)
    let worldHover = false;
    if (booted && mouse.x >= 0 && !mouse.dragging && !rosterOpen && !boardOpen && mouse.y > 18 &&
        !(selected && inRect(mouse, SHEET_RECT)) && !inRect(mouse, MINIMAP)) {
        const info = buildingUnder(mouse.x, mouse.y);
        if (info) { drawInfoBox(mouse.x, mouse.y, info); worldHover = true; }
        else {   // a walking farmer under the cursor is clickable even without a tooltip
            const tile = screenToTile(mouse.x, mouse.y);
            worldHover = world.farmers.some(f => Math.hypot(f.pos.i - tile.i, f.pos.j - tile.j) < 1.6);
        }
    }

    // custom pixel hand cursor, on top of everything (dragging = pressed/gold too)
    if (mouse.x >= 0) drawCursor(mouse.x, mouse.y, mouse.dragging || cursorIsHot(worldHover));

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

    // A RANDOM seed each page load, so every visit lays the town out differently (the cast is the
    // same — grown from the same memories — but who settles where, and the weather, vary). Pass
    // ?seed=N in the URL to reproduce a specific town (handy for sharing / debugging).
    const urlSeed = new URLSearchParams(location.search).get('seed');
    const worldSeed = urlSeed != null && urlSeed !== '' ? (parseInt(urlSeed, 10) >>> 0) : Math.floor(Math.random() * 0x7fffffff);
    world = new World(worldSeed);
    world.addLog(`Ry Farms — seed ${worldSeed}`, '#5a6672');
    // hook tile changes to terrain redraw
    const origSet = world.set.bind(world);
    world.set = (i, j, t) => { origSet(i, j, t); world._tilesChanged = true; };

    for (let i = 0; i < 8; i++) spawnFarmer();   // start with the full founding eight
    world.ensureFounderVariety();                // guarantee a chaos-agent + a moody farmer among them
    selected = null;

    // center camera on the well
    cam.x = GW / 2 - isoX(world.well.i, world.well.j);
    cam.y = GH / 2 - isoY(world.well.i, world.well.j) - 20;

    world.addLog(`${memories.length} memories loaded from ${memorySource}`, '#8a9ade');
    world.addLog('Click a farmer to read their sheet. Drag to pan.', '#9aa0b4');

    // let the tuning screen breathe for a moment
    setTimeout(() => { booted = true; }, 1400);

    window.RYFARMS = {  // debug handle
        world, cam, audio,
        select: (i) => { selected = world.farmers[i] || null; },
        speed: (mult) => { world._speedMult = mult; },
        animalRow: (n) => { ANIMAL_SIDE_ROW = n; },
        // deterministic stepping for reproducibility tests: N uniform FIXED_DT sim ticks
        runSteps: (n) => { for (let k = 0; k < n; k++) world.tick(FIXED_DT); },
        FIXED_DT,
        // center the camera on a tile (uses the REAL internal resolution — external camera
        // math can only guess GW/GH from the window aspect and lands wide of the mark)
        goTo: (i, j) => { cam.x = GW / 2 - isoX(i, j); cam.y = GH / 2 - isoY(i, j); },
        get GW() { return GW; }, get GH() { return GH; },
        get mouse() { return { x: mouse.x, y: mouse.y, drag: mouse.dragging }; },
        buildingUnder: (x, y) => buildingUnder(x ?? mouse.x, y ?? mouse.y),
    };
})();
