// main.js — Ry Farms: rendering, camera, input, UI, boot.

import { fetchMemories, generateCrew, mod, fmtMod, STAT_NAMES, TRAIT_NAMES, TRAIT_LABELS, hashString, mulberry32 } from './dna.js';
import { audio } from './audio.js';
import { World, CHUNK, T, DAY_LENGTH, NIGHT_LENGTH, ITEMS, CRAFTABLES, RECIPE_BY_ID, INVENTION_TABLE, RARE_NAME, xpForLevel, obstacleTier, treeVariant, treeIsFruit, SEASONS } from './farm.js';
import {
    TILE_W, TILE_H, makeCanvas, drawText, textWidth,
    makeFarmerSprites, makeCropSprites, makeHouse, makeWell, makeBoard, makeFencePost,
    makeScaffold, makeToolshed, makeWindmill, makeTower, makeLantern,
    makeLilyPad, makeFish, makeChicken, makeCow, makePig, makeGoat, makeSheep, makeCoop, makeBarn, makeMill, makeHatchery, makeTrough,
    makeTree, makeStump, makeWildWheat, makeWildFlowers,
    fillDiamond, strokeDiamond,
} from './pixel.js';
import { CRT } from './crt.js';
import { saveTown, loadTown, wipeTown, undoWipe, loadWorldIndex, registerTownInWorld, saveWorldIndex, updateWorldIndex } from './save.js';
import { computeLayout, detectEncounters, encounterLine, townPos, townReach, townTint } from './worldmap.js';
import { enrichStories } from './dm.js';
import { persistLives, persistTownHistory } from './memory-writeback.js';
import { enrichInventions, persistTownInventions } from './memory-invent.js';
import { whisper } from './conscience.js';

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
let lineagePool = [];       // #1.1 past farmers a reachable store remembers — heirs may be grown from them
let memorySource = 'offline';
// Honest memory-source copy: the town is grown from REAL SuperMemory docs only when a store was reachable;
// otherwise it's the invented fallback crew, and the UI must SAY so rather than claim SuperMemory (Fable
// finding). 'offline' is the transient pre-load state during the boot static.
function memoryTagline() {
    return memorySource === 'invented' ? 'GROWN FROM IMAGINED LIVES'
        : memorySource === 'offline' ? 'TUNING IN'
        : 'GROWN FROM SUPERMEMORY';
}
function memoryCaption() {
    return memorySource === 'invented'
        ? 'INVENTED LIVES - NO SUPERMEMORY CONNECTED YET.'
        : 'EVERY FARMER\'S MEMORIES, LIVE FROM SUPERMEMORY.';
}
const usedMemoryIds = new Set();
let selected = null;
let bootTime = 0;
let booted = false;
let rosterOpen = false;
let rosterScroll = 0;
// CONSCIENCE CHAT (#93): the bottom half of the roster window is a chat with one farmer, where
// the player's lines land as a stray inner voice. State here; the DOM capture input is built lazily.
let chatFarmer = null;            // the farmer currently being whispered to
let chatScroll = 0;               // history scroll (px), independent of the roster list scroll
let chatThinking = false;         // awaiting the classify+reply round-trip (shows a "..." shimmer)
let chatDropdownOpen = false;     // the "switch farmer" picker is expanded over the list
let chatDropRows = [];            // { farmer, y0, y1 } hit regions for the open dropdown
let chatEntryRect = null;         // screen-px rect of the entry row (for click-to-focus + input overlay)
let chatFocused = false;          // is the hidden input focused (blocks world keyboard shortcuts)
let chatInputEl = null;           // the hidden DOM <input> that actually captures keystrokes/IME/paste
let chatViewport = null;          // { x, y, w, h, bodyTop, bodyBot, maxScroll } of the history area
let chronOpen = false;            // town chronicle panel (the settlement's saga)
let chronReadTotal = 0;           // world._chronTotal at last view — the badge shows only for UNREAD beats
let chronScroll = 0;
let followMode = false;           // camera tracks followTarget (F/crosshair toggles; drag/Esc cancels)
let followTarget = null;          // the farmer being trailed — independent of the open card, so closing
                                  // the sheet (X) keeps following; only F / Esc / a pan stops it
let recapSeq = -1;                // last day-recap seq we've seen (to detect a new one)
let dramaSpotlight = null;        // { seed, kind, label, t } — a recent off-camera story beat worth watching (B4)
let lastChronLen = -1;            // chronicle length last frame, to detect NEW beats to spotlight
// which chronicle kinds are dramatic enough to nudge the player to go watch, + their short cue label
const DRAMA_KINDS = { peril: 'peril!', rift: 'a falling-out', crime: 'a theft', hunt: 'a hunt' };
let recapShownAt = -1e9;          // real-time (ms) the current recap appeared; drives its fade-out
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
    for (const b of [ROSTER_BTN, CHRON_BTN, SND_BTN, SETTINGS_BTN, FWD_BTN, FF_BTN, SPEED1_BTN]) if (b.w && inRect(m, b)) return true;
    if (!BOARD_BTN.hidden && inRect(m, BOARD_BTN)) return true;
    if (RECAP_CARD.w && inRect(m, RECAP_CARD)) return true;
    if (activeMoment && MOMENTS_HIT.w) return true;   // #98 a grand Moment is up — the whole screen is "click to continue"
    if (selected) {
        if (inRect(m, SHEET_CLOSE)) return true;
        if (inRect(m, SHEET_FOLLOW)) return true;
        for (const tb of SHEET_TABS) if (inRect(m, tb)) return true;
        if (MEM_PREV.w && inRect(m, MEM_PREV)) return true;
        if (MEM_NEXT.w && inRect(m, MEM_NEXT)) return true;
        for (const sl of sheetSlots) if (sl.y >= sheetBodyY - 2 && sl.y + sl.h <= sheetBodyY + sheetBodyH + 2 && inRect(m, sl)) return true;
    }
    if (!selected && inRect(m, MINIMAP)) return true;
    if (rosterOpen) { for (const r of rosterRows) if (m.y >= r.y0 && m.y < r.y1) return true; }
    if (chronOpen) { for (const r of chronRows) if (m.y >= r.y0 && m.y < r.y1) return true; }
    return !!worldTooltip;   // hovering a building/farmer/merchant that shows a tooltip
}
const ROSTER_BTN = { x: 0, y: 3, w: 44, h: 12 };   // positioned in drawUI
const CHRON_BTN = { x: 0, y: 3, w: 0, h: 12 };     // town chronicle toggle, positioned in drawUI
const MINIMAP = { x: 0, y: 0, w: 46, h: 46 };      // bottom-right legend, positioned in drawMinimap
const SHEET_RECT = { x: 0, y: 0, w: 0, h: 0 };     // detail-card bounds, set in drawSheet (for hit-testing)
const SHEET_CLOSE = { x: 0, y: 0, w: 0, h: 0 };    // card close (X) button, set in drawSheet
const SHEET_FOLLOW = { x: 0, y: 0, w: 0, h: 0 };   // card follow/track toggle, set in drawSheet
const RECAP_CARD = { x: 0, y: 0, w: 0, h: 0 };     // zeroed stub (daily recap removed); callouts/cursor read .w
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
const SETTINGS_BTN = { x: 0, y: 3, w: 15, h: 12 }; // gear cog — opens the settings menu (New Town + volume)
const NEW_BTN = { x: 0, y: 3, w: 30, h: 12 };      // NEW TOWN reset hatch (now lives inside the settings menu)
let settingsOpen = false;                          // settings menu (New Town + music/SFX volume)
// #2 world-of-towns map (the zoom-out camera tier)
let worldMapOpen = false;
let worldMapIdx = null;                            // loaded world index { towns, encounters }
let worldMapNodes = [];                            // computed layout for the current render
let worldMapSel = null;                            // seed of the town whose info card is open
let worldMapHits = [];                             // { seed, x, y, r } node hit-discs, rebuilt each draw
let worldMapVisit = null;                          // VISIT button rect (switch active town)
const WORLD_BTN = { x: 0, y: 3, w: 0, h: 12 };     // top-bar toggle, positioned in drawUI
let settingsHits = null;                           // { music, sfx, musicSlider, sfxSlider, newBtn, close } rects (game px)
let settingsDrag = null;                           // 'music' | 'sfx' while dragging a volume slider
let newConfirmUntil = 0;                           // while now < this, the NEW button reads "SURE?" and a click wipes
let lastSavedDay = 0;                              // last world.day autosaved (rollover-triggered)
let saveFlashAt = -1e9;                            // brief "SAVED" tick in the top bar
let resumeCard = null;                             // "PREVIOUSLY ON RY FARMS" catch-up card (shown once on resume)
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
const millSprite = makeMill();
const hatchSprite = makeHatchery();
const troughSprite = makeTrough();
const stumpSprite = makeStump();
const wheatSprite = makeWildWheat();
const flowerSprite = makeWildFlowers();
// procedural inventory icons for wild-caught + facility goods that have no Supplies.png entry
// (fish/lilies from ponds; eggs/milk/wool/truffle from the coop & pen — the raised by-products)
function makeGoodIcon(draw) {
    const c = document.createElement('canvas'); c.width = 16; c.height = 16;
    const g = c.getContext('2d'); g.imageSmoothingEnabled = false; draw(g); return c;
}
const makeEggIcon = () => makeGoodIcon(g => {                          // two speckled eggs in a nest
    g.fillStyle = '#7a5a34'; g.fillRect(3, 11, 10, 2);                 // straw nest
    for (const [ex, ey] of [[5, 6], [9, 5]]) {
        g.fillStyle = '#f2ead6'; g.fillRect(ex, ey, 4, 6); g.fillRect(ex + 1, ey - 1, 2, 8);
        g.fillStyle = '#fffdf6'; g.fillRect(ex + 1, ey + 1, 1, 2);     // highlight
        g.fillStyle = '#d8cdb2'; g.fillRect(ex + 2, ey + 4, 1, 1); g.fillRect(ex + 1, ey + 2, 1, 1);  // speckle
    }
});
const makeMilkIcon = () => makeGoodIcon(g => {                         // a pail of milk
    g.fillStyle = '#c8ccd4'; g.fillRect(4, 6, 8, 7);                   // pail body
    g.fillStyle = '#e6e9ef'; g.fillRect(4, 5, 8, 2);                   // milk surface / rim
    g.fillStyle = '#aeb3bd'; g.fillRect(4, 12, 8, 1);                  // base shade
    g.fillStyle = '#9aa0aa'; g.fillRect(5, 4, 6, 1);                   // handle
    g.fillStyle = '#fbfcff'; g.fillRect(5, 6, 1, 4);                   // highlight
});
const makeWoolIcon = () => makeGoodIcon(g => {                         // a fluffy wool bundle
    g.fillStyle = '#eef0f2';
    for (const [wx, wy, ww, wh] of [[4, 6, 8, 6], [3, 8, 10, 3], [5, 5, 6, 2]]) g.fillRect(wx, wy, ww, wh);
    g.fillStyle = '#d6d9de'; for (const [dx, dy] of [[5, 8], [8, 7], [10, 9], [6, 10]]) g.fillRect(dx, dy, 2, 2);
    g.fillStyle = '#fbfcff'; g.fillRect(5, 6, 2, 1); g.fillRect(9, 6, 1, 1);
});
const makeTruffleIcon = () => makeGoodIcon(g => {                      // a knobbly dark truffle
    g.fillStyle = '#3c2c22'; g.fillRect(5, 6, 7, 7); g.fillRect(4, 8, 9, 4); g.fillRect(6, 5, 4, 1);
    g.fillStyle = '#584234'; g.fillRect(6, 7, 2, 2); g.fillRect(9, 9, 2, 2);   // knobs
    g.fillStyle = '#6f5443'; g.fillRect(7, 8, 1, 1); g.fillRect(10, 7, 1, 1);  // highlights
});
const makeGrainIcon = () => makeGoodIcon(g => {                       // a tied sack spilling golden grain
    g.fillStyle = '#c9a24a'; g.fillRect(4, 6, 8, 8); g.fillRect(5, 5, 6, 1);   // burlap sack body
    g.fillStyle = '#b08a38'; g.fillRect(4, 12, 8, 2);                          // shaded base
    g.fillStyle = '#8a6a28'; g.fillRect(6, 4, 4, 1); g.fillRect(7, 3, 2, 1);   // tied neck
    g.fillStyle = '#f0d878'; g.fillRect(5, 7, 1, 1); g.fillRect(9, 8, 1, 1); g.fillRect(7, 6, 1, 1);  // grain highlights
    g.fillStyle = '#e8c860'; g.fillRect(11, 12, 1, 1); g.fillRect(12, 13, 1, 1); g.fillRect(10, 13, 1, 1);  // spilled grain
});
const GOOD_ICON = { fish: makeFish(0), lily: makeLilyPad(true), egg: makeEggIcon(), milk: makeMilkIcon(), wool: makeWoolIcon(), truffle: makeTruffleIcon(), grain: makeGrainIcon() };

// A dedicated CARROT inventory icon: its procedural CROP sprite is a leafy green bundle that reads as
// wheat, so for the inventory we hold up an unmistakable orange root with a green top instead.
function makeCarrotIcon() {
    const c = document.createElement('canvas'); c.width = 16; c.height = 16;
    const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
    g.fillStyle = '#4a9a3c';                                          // green fronds
    for (const [fx, fh] of [[5, 3], [7, 5], [9, 5], [11, 3]]) g.fillRect(fx, 6 - fh, 1, fh);
    g.fillRect(6, 3, 4, 1);
    for (let r = 0; r < 9; r++) {                                     // tapered orange root, point down
        const w = Math.max(1, 6 - Math.round(r * 0.62)), x0 = 8 - Math.floor(w / 2);
        g.fillStyle = '#f0801c'; g.fillRect(x0, 6 + r, w, 1);
        g.fillStyle = '#d0600c'; g.fillRect(x0 + w - 1, 6 + r, 1, 1);  // shade the right edge
    }
    g.fillStyle = '#ffb050'; g.fillRect(7, 8, 1, 1); g.fillRect(8, 11, 1, 1);   // highlights
    return c;
}
const CROP_ICON_CANVAS = { carrot: makeCarrotIcon() };   // crops whose inventory icon is a bespoke canvas

// ---------------------------------------------------------------------------
// Real hi-res tree art (CraftPix, iso billboards) — loaded async, with the
// procedural trees below as fallback until the images arrive.
// ---------------------------------------------------------------------------
// WITH-SHADOW tree variants. Trees GROW over time: each TYPE ships 3 sizes — _3 sapling, _2 young,
// _1 mature — chosen by the tree's growth stage (world.treeStage). Only types with all three sizes.
const TREE_ART_BASE = './assets/craftpix-net-385863-free-top-down-trees-pixel-art/PNG/Assets_separately/Trees_shadow/';
const TREE_TYPES = {
    SPRING: ['Tree', 'Fruit_tree', 'Moss_tree'],
    SUMMER: ['Tree', 'Fruit_tree', 'Moss_tree'],
    FALL:   ['Tree', 'Autumn_tree', 'Moss_tree'],
    WINTER: ['Snow_tree'],
};
const TREE_STAGE_SUFFIX = ['3', '2', '1'];   // growth stage 0 sapling -> _3, 1 young -> _2, 2 mature -> _1
// every tree sprite name to preload (all sizes of every type, all seasons)
const TREE_SETS = (() => {
    const out = {};
    for (const s of Object.keys(TREE_TYPES)) out[s] = TREE_TYPES[s].flatMap(b => ['1', '2', '3'].map(n => b + n));
    return out;
})();
// LIVING FOREST: the animated 654184 Trees_animation.png sheet. Trees are FROZEN on frame 0 (perfectly
// still) almost all the time; a tree cycles its animation frames — a real rustle/shake — ONLY while a
// farmer is chopping it (the "surprise reveal"). Winter keeps the static snow trees below. This sheet has
// no ground shadow (accepted tradeoff for the animation). Grid = 9 cols x 13 frames of 64x80: 3 tree
// types (green / apple / pine) x 3 sizes (large=mature / med=young / small=sapling).
const treeAnimSheet = new Image(); let treeAnimReady = false; treeAnimSheet.onload = () => { treeAnimReady = true; }; treeAnimSheet.onerror = () => {};
treeAnimSheet.src = './assets/craftpix-net-654184-main-characters-home-free-top-down-pixel-art-asset/PNG/Trees_animation.png';
// scale MUST stay INTEGER: a fractional nearest-neighbour scale makes the foliage shimmer 1px<->2px
// between frames (reads as horizontal striations). 1x = native 64x80, crisp + stable.
const TREE_ANIM = { cols: 9, rows: 13, fw: 64, fh: 80, scale: 1 };
const choppingTiles = new Set();   // "i,j" of tiles a farmer is actively chopping — rebuilt each frame
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
// side-profile frame per sprite (`row`), which in these packs faces LEFT — so it's mirrored to face
// RIGHT when moving right. The assassin uses the lvl-3 swordsman (the lvl-1 looks like our farmers).
const THREAT_ART = {
    // beasts have clean L/R side profiles (side:true — mirrored by movement); the humanoid foes don't,
    // so they face the camera front-on (side:false — always menacing, never mis-facing).
    fox:      { base: './assets/craftpix-net-789196-free-top-down-hunt-animals-pixel-sprite-pack/Tiled/', file: 'Fox_Idle_with_shadow',  fw: 32, row: 2, side: true },
    boar:     { base: './assets/craftpix-net-789196-free-top-down-hunt-animals-pixel-sprite-pack/Tiled/', file: 'Boar_Idle_with_shadow', fw: 32, row: 2, side: true },
    orc:      { base: './assets/craftpix-net-363992-free-top-down-orc-game-character-pixel-art/Tiled_files/', file: 'orc1_idle_with_shadow', fw: 64, row: 2, side: false },
    assassin: { base: './assets/craftpix-net-180537-free-swordsman-1-3-level-pixel-top-down-sprite-character/Tiled_files/Swordsman3/', file: 'Swordsman_lvl3_Idle_without_shadow', fw: 64, row: 0, side: false },
};
const threatImg = {};
for (const [k, c] of Object.entries(THREAT_ART)) { const im = new Image(); im.src = c.base + c.file + '.png'; threatImg[k] = im; }
// #3.1 orc FARMERS use the shadowless orc idle (the game draws its own foot-shadow — the with-shadow foe sheet
// baked in a second blob). Separate from threatImg.orc (which stays with-shadow for wilderness foes).
const orcFarmerImg = new Image();
orcFarmerImg.src = './assets/craftpix-net-363992-free-top-down-orc-game-character-pixel-art/Tiled_files/orc1_idle_without_shadow.png';

// Roaming WILD PREY sprites (hunted for meat — see world.prey / #tickPrey). All 32x32, 4-frame idle
// cycles; row 2 = side profile. Deer/hare side-frames face LEFT (srcFace -1), the turkey faces RIGHT.
const PREY_ART = {
    deer:   { base: './assets/craftpix-net-789196-free-top-down-hunt-animals-pixel-sprite-pack/PNG/Without_shadow/Deer/', file: 'Deer_Idle', fw: 32, row: 2, srcFace: -1 },
    rabbit: { base: './assets/craftpix-net-789196-free-top-down-hunt-animals-pixel-sprite-pack/PNG/Without_shadow/Hare/', file: 'Hare_Idle', fw: 32, row: 2, srcFace: -1 },
    turkey: { base: './assets/craftpix-net-291971-free-top-down-animals-farm-pixel-art-sprites/PNG/Without_shadow/', file: 'Turkey_animation_without_shadow', fw: 32, row: 2, srcFace: 1 },
};
const preyImg = {};
for (const [k, c] of Object.entries(PREY_ART)) { const im = new Image(); im.src = c.base + c.file + '.png'; preyImg[k] = im; }

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
    sheep:   { file: 'Lamb_animation_without_shadow' },   // the sheeppen's flock — real lamb sprite
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
// The TOWN SILO is rendered as a GUILD HALL (654184... no, 189780 Exterior.png), assembled in pieces as
// the town levels: the centre hall + its roof cap from day one, and at TOWN LV5 it earns its GUILD HALL
// banner + two flanking pennants. Rects into Exterior.png (tuned against the sheet).
const guildExtSheet = new Image(); let guildExtReady = false; guildExtSheet.onload = () => { guildExtReady = true; }; guildExtSheet.onerror = () => {};
guildExtSheet.src = './assets/craftpix-net-189780-free-top-down-pixel-art-guild-hall-asset-pack/Tiled_files/Exterior.png';
const GH_CENTER = { x: 47, y: 49, w: 66, h: 95 };    // the narrow hall walls (windows + door; the gable is capped by the roof)
const GH_ROOF   = { x: 161, y: 9, w: 94, h: 57 };     // the flat roof, rect CENTRED on the roof content (fixes the right-offset)
const GH_LWING  = { x: 8, y: 33, w: 39, h: 111 };     // left wing WITH its sloped roof (L5) — flanks the centre
const GH_RWING  = { x: 113, y: 33, w: 27, h: 111 };   // right wing WITH its sloped roof (L5)
const GH_BANNER = { x: 152, y: 96, w: 96, h: 26 };   // the "GUILD HALL" sign (L5)
const GH_FLAG   = { x: 165, y: 100, w: 15, h: 36 };   // one hanging pennant (L5, one each side)
// small skull (guild-hall Interior_objects.png) floated over a home while a felled farmer recovers
const skullSheet = new Image(); let skullReady = false; skullSheet.onload = () => { skullReady = true; }; skullSheet.onerror = () => {};
skullSheet.src = GUILD_BASE + 'Interior_objects.png';
const SKULL_SRC = { x: 138, y: 57, w: 23, h: 22 };
// a small skull marker, horizontally centred on cx with its top at y (over a recovering farmer's home/head)
function drawSkull(cx, y) {
    if (!skullReady || !skullSheet.naturalWidth) return;
    const s = SKULL_SRC, dw = 11, dh = Math.round(dw * s.h / s.w);
    const sm = ctx.imageSmoothingEnabled; ctx.imageSmoothingEnabled = false;
    ctx.drawImage(skullSheet, s.x, s.y, s.w, s.h, Math.round(cx - dw / 2), Math.round(y), dw, dh);
    ctx.imageSmoothingEnabled = sm;
}
// gold coin (basic RPG-UI Inventory.png) — the "new posts" badge on the Board/Chronicle buttons
const uiSheet = new Image(); let uiSheetReady = false; uiSheet.onload = () => { uiSheetReady = true; }; uiSheet.onerror = () => {};
uiSheet.src = './assets/craftpix-net-255216-free-basic-pixel-art-ui-for-rpg/PNG/Inventory.png';
const COIN_SRC = { x: 243, y: 115, w: 10, h: 10 };
function drawCoin(x, y, size = 8) {
    if (!uiSheetReady || !uiSheet.naturalWidth) return;
    const c = COIN_SRC, sm = ctx.imageSmoothingEnabled; ctx.imageSmoothingEnabled = false;
    ctx.drawImage(uiSheet, c.x, c.y, c.w, c.h, Math.round(x), Math.round(y), size, size);
    ctx.imageSmoothingEnabled = sm;
}
// fantasy 16x16 icon sheet — the sick "blood drop" marker (and, later, hunted-meat icons)
const fantasyIcons = new Image(); let fantasyIconsReady = false; fantasyIcons.onload = () => { fantasyIconsReady = true; }; fantasyIcons.onerror = () => {};
fantasyIcons.src = './assets/craftpix-net-994534-free-basic-pixel-art-fantasy-icons-16x16-for-ui/PNG/Gui_icons2.png';
const SICK_DROP_SRC = { x: 266, y: 7, w: 10, h: 17 };
// hunted-meat inventory icons (same fantasy-icon sheet): small/medium/large red meat (fowl added with #69 2b)
const MEAT_ICONS = { 'meat-s': [528, 177, 14, 13], 'meat-m': [500, 167, 18, 21], 'meat-l': [550, 167, 21, 21] };
// a small blood drop, centred on cx with its top at y (over a sick farmer's home/head)
function drawBloodDrop(cx, y) {
    if (!fantasyIconsReady || !fantasyIcons.naturalWidth) return;
    const s = SICK_DROP_SRC, dw = 6, dh = Math.round(dw * s.h / s.w);
    const sm = ctx.imageSmoothingEnabled; ctx.imageSmoothingEnabled = false;
    ctx.drawImage(fantasyIcons, s.x, s.y, s.w, s.h, Math.round(cx - dw / 2), Math.round(y), dw, dh);
    ctx.imageSmoothingEnabled = sm;
}
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
    pepper: [[11, 112, 12, 14], [40, 105, 19, 21], [101, 96, 22, 30], [68, 96, 23, 30]],   // ripe = red peppers
    carrot: [[9, 141, 13, 10], [39, 140, 19, 14], [102, 138, 22, 17], [70, 138, 22, 17]],  // ripe = leafy head
    grapes: [[9, 9, 13, 37], [41, 9, 13, 37], [100, 9, 24, 37], [68, 9, 24, 37]],          // ripe = purple grape cluster
    pumpkin: [[7, 296, 13, 11], [34, 290, 22, 21], [96, 288, 29, 27], [64, 289, 29, 26]],  // ripe = orange gourd
    wheat: [[9, 371, 11, 10], [39, 363, 14, 18], [39, 363, 14, 18], [68, 353, 22, 28]],    // ripe = grain
    sunflower: [[12, 416, 11, 14], [37, 410, 21, 20], [37, 410, 21, 20], [67, 396, 25, 34]],
};
const CROP_SCALE = ASSET_SCALE;   // crops share the one global asset scale
// Harvested-produce icons in Supplies.png (loose items), shown when a crop is picked / carried.
// Individual harvested-crop sprites from Supplies.png, matched to each crop (pepper=chili,
// grapes, pumpkin=orange gourd, beanstalk=green bean are true matches; carrot/sunflower/wheat
// borrow the nearest produce since the pack has no carrot/sunflower/loose-wheat).
const PRODUCE_ICONS = {
    pepper: [191, 161, 15, 9], grapes: [242, 209, 11, 14], pumpkin: [49, 205, 15, 13],
    beanstalk: [93, 204, 17, 11],                              // beanstalk borrows the green bean
    sunflower: [263, 132, 14, 10],                             // sunflower borrows the yellow squash
    // carrot + wheat deliberately OMITTED: their Supplies.png borrows were mis-cropped (cut off + bled
    // into a neighbour sprite), so they fall back to their own PROCEDURAL ripe sprite (makeCropSprites)
    // like bean stalks do — self-contained and a true match (orange carrot / golden wheat).
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

// #3.1 orc farmers wear the real ORC sprite (the DM's foe pack, already loaded as threatImg.orc) instead of
// the re-skinned human farmer. The pack is a 4x4 grid of 64px frames; we crop the character out of its padded
// cell, scale it to a farmer-ish height (orcs a touch taller), and slice a few idle columns so it still has a
// little life. All facings use the front-menacing pose (row 2), matching how the foe orcs render.
const orcCharCache = new Map();
function orcSpriteReady() { return orcFarmerImg && orcFarmerImg.complete && orcFarmerImg.naturalWidth > 0; }
function orcCharSets(f) {
    const img = orcFarmerImg, FW = 64;
    const cols = Math.max(1, Math.round(img.naturalWidth / FW));
    const rows = Math.max(1, Math.round(img.naturalHeight / FW));
    const row = Math.min(2, rows - 1);
    const sx0 = 14, sy0 = 6, sw = 36, sh = 54;          // crop the orc out of the 64px cell's padding
    const targetH = 28, scale = targetH / sh;
    const dw = Math.max(1, Math.round(sw * scale)), dh = Math.max(1, Math.round(sh * scale));
    const frameCol = (col) => {
        const c = Math.min(col, cols - 1);
        const [out, ox] = makeCanvas(dw, dh); ox.imageSmoothingEnabled = false;
        ox.drawImage(img, c * FW + sx0, row * FW + sy0, sw, sh, 0, 0, dw, dh);
        return out;
    };
    const set = { idle: frameCol(0), walk1: frameCol(1), walk2: frameCol(2), work: frameCol(1), sleep: frameCol(0) };
    return { down: set, side: set, up: set };
}

function farmerSprites(f) {
    if (f.sheet.culture === 'orc' && orcSpriteReady()) {
        let sets = orcCharCache.get(f);
        if (!sets) { sets = orcCharSets(f); orcCharCache.set(f, sets); }
        return sets[f.moveDir] || sets.down;
    }
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

// Proximity work audio: a farmer's chop/hammer, panned by screen position and faded by camera
// distance, so the world sounds busy where you're LOOKING and quiets toward the edges. Driven by
// the renderer (it knows each farmer's screen pos); never touches the sim, so determinism is safe.
const WORK_SFX_KIND = { chop: 'chop', break: 'chop', mine: 'hammer', build: 'hammer',
    coopbuild: 'hammer', housebuild: 'hammer', fencepost: 'hammer', scarecrow: 'hammer' };
const workSfxNext = new Map();   // farmer seed -> next allowed play time (s)
function maybeWorkSfx(f, sx, sy) {
    if (!audio.enabled) return;
    const kind = WORK_SFX_KIND[f.state];
    if (!kind) return;
    const dx = (sx - GW / 2) / (GW / 2), dy = (sy - GH / 2) / (GH / 2);
    const d = Math.hypot(dx, dy);
    if (d > 1.35) return;                                   // well off-screen — silent
    const vol = Math.max(0, Math.min(1, 1 - d * 0.62));     // loud at centre, faint at the edges
    if (vol < 0.06) return;
    const now = performance.now() / 1000;
    if (now < (workSfxNext.get(f.sheet.seed) || 0)) return;
    // per-farmer cadence + jitter so a work gang never thwacks in perfect unison
    workSfxNext.set(f.sheet.seed, now + 0.4 + (f.sheet.seed % 11) * 0.012 + Math.random() * 0.05);
    audio.workSfx(kind, Math.max(-1, Math.min(1, dx)), vol * 0.9);
}
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
        // LIVING FOREST (spring/summer/fall): the animated tree sheet — frozen on frame 0, cycling only
        // while chopped. Winter falls through to the static snow trees below. Type: apple in fruit season,
        // else green or pine by variant; the size column tracks the growth stage (mature ... sapling).
        if (season.name !== 'WINTER' && treeAnimReady && treeAnimSheet.naturalWidth) {
            // ONLY green (cols 0-2) + apple (cols 3-5): those fit their 64px cells. The pine columns (6-8)
            // are ~97px wide and OVERLAP each other + their neighbours in the sheet, so a clean slice cuts
            // their left canopy (the "cut off on the left" bug) — so we don't use them.
            const typeIdx = (treeIsFruit(i, j) && world.isFruitSeason()) ? 1 : 0;
            const sizeCol = 2 - world.treeStage(i, j);   // 0 large(mature) .. 2 small(sapling)
            const w = Math.round(TREE_ANIM.fw * TREE_ANIM.scale), h = Math.round(TREE_ANIM.fh * TREE_ANIM.scale);
            return { treeCol: typeIdx * 3 + sizeCol, w, h, anchor: 0.9, depth: 0.4, seed: hash2(i, j, 73), chopKey: i + ',' + j, leaves: season.name === 'FALL' };
        }
        // pick this tree's species (stable) + current growth SIZE (rises over time); fall back to a
        // smaller loaded size, then any loaded, then the procedural tree.
        const bases = TREE_TYPES[season.name] || TREE_TYPES.SUMMER;
        let base;
        if (treeIsFruit(i, j) && bases.includes('Fruit_tree') && world.isFruitSeason()) base = 'Fruit_tree';   // apples: late summer + fall
        else { const nf = bases.filter(b => b !== 'Fruit_tree'); const pool = nf.length ? nf : bases; base = pool[treeVariant(i, j, pool.length)]; }
        const stage = world.treeStage(i, j);
        let img = null;
        for (let s = stage; s >= 0 && !img; s--) { const c = treeImg[base + TREE_STAGE_SUFFIX[s]]; if (imageLoaded(c)) img = c; }
        if (img) {
            const { w, h } = wildDims(img);
            return { img, w, h, anchor: 0.82, depth: 0.4, leaves: season.name === 'FALL', seed: hash2(i, j, 73), tree: true, chopKey: i + ',' + j };
        }
        const species = TREE_SPECIES[hash2(i, j, 63) % TREE_SPECIES.length];
        const spr = treeSprite(species, season.name);
        return { img: spr, w: spr.width, h: spr.height, anchor: 1, nudgeY: 2, depth: 0.4, leaves: season.name === 'FALL', seed: hash2(i, j, 73), tree: true, chopKey: i + ',' + j };
    }
    if (t === T.FLOWER) {
        const bushSet = BUSH_SETS[season.name] || BUSH_SETS.SUMMER;
        const img = pickTieredImage(bushImg, bushSet, i, j, 64, obstacleTier(i, j));
        if (img) {
            const { w, h } = wildDims(img);
            return { img, w, h, anchor: 0.74, depth: -1 };
        }
        if (season.name === 'WINTER') return null;   // no GREEN bush fallback under the snow
        return { img: flowerSprite, w: flowerSprite.width, h: flowerSprite.height, anchor: 1, nudgeY: 2, depth: -1 };
    }
    if (t === T.WHEAT) {
        if (season.name === 'WINTER') return null;   // wild ferns lie dormant under the snow — no green in winter
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
    // ANIMATED tree sheet: frozen on frame 0 (dead still), cycling its frames only while this tile is
    // being chopped — the tree visibly rustles/shakes as it's felled, then falls.
    if (spec.treeCol != null && treeAnimReady) {
        const A = TREE_ANIM;
        const frame = choppingTiles.has(spec.chopKey) ? (Math.floor(performance.now() / 1000 * 14) % A.rows) : 0;
        ctx.drawImage(treeAnimSheet, spec.treeCol * A.fw, frame * A.fh, A.fw, A.fh,
            Math.floor(x - spec.w / 2), Math.floor(baseY - spec.h * spec.anchor + (spec.nudgeY || 0)), spec.w, spec.h);
        drawLeafDrift(spec, x, baseY);   // ambient autumn drift still applies in fall
        return;
    }
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
            if (t === T.COOP || t === T.BARN || t === T.MILL || t === T.HATCH) col = "#6a5a44";
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
                if (t === T.GRASS && grassDetailsReady && scatter < density && !winter) {   // no green tufts under snow
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
                } else if (patch === 2 && !winter && rand2(i, j, 49) < 0.34) {   // no green grass speckle under snow
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
    // which tiles are being actively chopped right now (so those trees rustle harder)
    choppingTiles.clear();
    for (const f of world.farmers) if ((f.state === 'chop' || f.state === 'break') && f.woodTarget) choppingTiles.add(f.woodTarget.i + ',' + f.woodTarget.j);
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
        const h = p.house, F = 5;   // anchor: h+(F-1)/2 = houseCentre (fixed); sprite sits centred there for every tier
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
                    const hx = Math.floor(sx - dispW / 2), hy = Math.floor(sy + TILE_H - dispH + 13);   // sink ~1 tile so the sprite reads centred in the 5x5
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
                    if (f.downed) {
                        // felled by a foe and recovering: a small skull floats over the home
                        const bob = Math.round(Math.sin(performance.now() / 500));
                        drawSkull(roofX, roofY + bob - 5);
                    } else if (f.state === 'sick') {
                        const bob = Math.round(Math.sin(performance.now() / 400));
                        drawBloodDrop(roofX + 1, roofY + bob);
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
                drawProgressBar(sx, Math.floor(sy - 14), 26, p, '#f0d060');
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
                drawProgressBar(sx, Math.floor(sy - 14), 26, p, building ? '#f0d060' : '#8fc7e8');
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
                const spr = b.kind === 'barn' ? barnSprite : b.kind === 'mill' ? millSprite : b.kind === 'hatchery' ? hatchSprite : coopSprite;
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
        maybeWorkSfx(f, sx, sy);
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

    // roaming wild game (deer/rabbit/turkey) to hunt, y-sorted in
    for (const a of world.prey) {
        if (a.done) continue;
        const sx = cam.x + isoX(a.i, a.j), sy = cam.y + isoY(a.i, a.j);
        list.push({ y: sy + TILE_H * 0.5 + 0.09, draw: () => drawPrey(a, sx, sy) });
    }

    // legend monuments — lasting stones where a raider was felled (#85)
    for (const m of (world.monuments || [])) {
        const sx = cam.x + isoX(m.i, m.j), sy = cam.y + isoY(m.i, m.j);
        list.push({ y: sy + TILE_H * 0.5, draw: () => drawMonument(sx, sy) });
    }

    return list;
}
// A commemorative stone raised where a great deed happened — a small plinth + a gold-plaqued obelisk.
function drawMonument(sx, sy) {
    ctx.imageSmoothingEnabled = false;
    const footY = Math.floor(sy + TILE_H / 2), cx = Math.floor(sx);
    ctx.fillStyle = 'rgba(10,14,10,0.3)'; ctx.fillRect(cx - 6, footY - 1, 12, 3);          // ground shadow
    ctx.fillStyle = '#7a7466'; ctx.fillRect(cx - 5, footY - 4, 10, 4);                      // plinth
    ctx.fillStyle = '#5c574c'; ctx.fillRect(cx - 5, footY - 1, 10, 1);
    ctx.fillStyle = '#9a9484'; ctx.fillRect(cx - 3, footY - 17, 6, 13);                     // stone shaft
    ctx.fillStyle = '#b4ae9c'; ctx.fillRect(cx - 3, footY - 17, 2, 13);                     // lit edge
    ctx.fillStyle = '#6a6458'; ctx.fillRect(cx + 2, footY - 17, 1, 13);                     // shade edge
    ctx.fillStyle = '#8a8474'; ctx.fillRect(cx - 2, footY - 19, 4, 2);                      // pointed cap
    ctx.fillStyle = '#e0b040'; ctx.fillRect(cx - 2, footY - 12, 4, 3);                      // gold plaque
    ctx.fillStyle = '#f6dc88'; ctx.fillRect(cx - 2, footY - 12, 4, 1);
}
// A wild prey animal: a sliced side-profile idle frame of its real sprite, mirrored to face its heading
// (fallback: a small critter blob). Cycles a little faster while bolting from a hunter.
function drawPrey(a, sx, sy) {
    const c = PREY_ART[a.kind], img = preyImg[a.kind];
    ctx.imageSmoothingEnabled = false;
    if (img && img.complete && img.naturalWidth) {
        const fw = c.fw, cols = 4, fps = a.bolt > 0 ? 9 : 3.5;
        const col = Math.floor(performance.now() / 1000 * fps) % cols;
        const disp = Math.round(fw * ASSET_SCALE * (a.def.size || 1));
        const dx = Math.round(sx - disp / 2), dy = Math.round(sy - disp * 0.72);
        const mirror = (a.facing > 0) !== (c.srcFace > 0);   // flip when heading ≠ the source frame's facing
        if (mirror) {
            ctx.save(); ctx.translate(dx + disp, dy); ctx.scale(-1, 1);
            ctx.drawImage(img, col * fw, c.row * fw, fw, fw, 0, 0, disp, disp); ctx.restore();
        } else {
            ctx.drawImage(img, col * fw, c.row * fw, fw, fw, dx, dy, disp, disp);
        }
    } else {
        ctx.fillStyle = a.def.color;
        ctx.beginPath(); ctx.ellipse(sx, sy - 4, 5, 4, 0, 0, Math.PI * 2); ctx.fill();
    }
}
// A wilderness threat: one sliced side-profile frame of its real sprite (fallback: a menace blob).
function drawThreat(e, sx, sy) {
    const c = THREAT_ART[e.kind], img = threatImg[e.kind];
    ctx.imageSmoothingEnabled = false;
    if (img && img.complete && img.naturalWidth > 0) {
        const fw = c.fw, rows = Math.max(1, Math.round(img.naturalHeight / fw));
        const row = Math.min(c.row ?? 2, rows - 1);
        const disp = Math.round(fw * ASSET_SCALE * 1.15);
        const dx = Math.round(sx - disp / 2), dy = Math.round(sy - disp * 0.82);
        if (c.side && e.facing > 0) {   // side-profile source frame faces LEFT; mirror it to face right
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
    const footY = Math.floor(sy + TILE_H);
    if (!guildExtReady || !guildExtSheet.naturalWidth) {   // sheet not loaded — a small stand-in
        ctx.fillStyle = '#c9a24e'; ctx.fillRect(Math.floor(sx - 8), footY - 20, 16, 20);
    } else {
        const sc = ASSET_SCALE * 0.9, blit = (r, dx, dy, s = sc) => {
            const dw = Math.round(r.w * s), dh = Math.round(r.h * s);
            ctx.drawImage(guildExtSheet, r.x, r.y, r.w, r.h, Math.round(dx), Math.round(dy), dw, dh);
            return { dw, dh };
        };
        ctx.imageSmoothingEnabled = false;
        const cw = Math.round(GH_CENTER.w * sc), ch = Math.round(GH_CENTER.h * sc);
        const bx = Math.floor(sx - cw / 2), by = footY - ch;   // hall body: bottom-anchored on the silo tile
        ctx.fillStyle = 'rgba(10,14,10,0.28)'; ctx.fillRect(bx + 4, footY - 2, cw - 8, 3);        // ground shadow
        // L5+ SIDE WINGS (with their own sloped roofs) flank the hall, drawn FIRST so the centre
        // overlaps their inner edges into one wide guild hall. Same footline, contiguous with the centre.
        if (world.townLevel >= 5) {
            const lw = Math.round(GH_LWING.w * sc), lh = Math.round(GH_LWING.h * sc);
            const rwg = Math.round(GH_RWING.w * sc);
            blit(GH_LWING, bx - lw, footY - lh);
            blit(GH_RWING, bx + cw, footY - lh);
        }
        blit(GH_CENTER, bx, by);                                                                  // the narrow hall walls
        // the flat roof caps the walls, fitted to the hall width + small eaves, seated flush on top
        const rw = cw + Math.round(9 * sc), rh = Math.round(GH_ROOF.h * (rw / GH_ROOF.w));
        const roofTop = by - rh + Math.round(3 * sc) + 11;   // seated DOWN onto the hall (user-tuned)
        ctx.drawImage(guildExtSheet, GH_ROOF.x, GH_ROOF.y, GH_ROOF.w, GH_ROOF.h, Math.round(sx - rw / 2) - 1, roofTop, rw, rh);
        var topY = roofTop;
    }
    const tag = `LV ${world.townLevel}`, tw = textWidth(tag), ty = (typeof topY === 'number' ? topY : footY - 20) - 12;
    ctx.fillStyle = 'rgba(20,16,8,0.78)'; ctx.fillRect(Math.floor(sx - tw / 2) - 2, ty, tw + 4, 9);
    drawText(ctx, tag, Math.floor(sx - tw / 2), ty + 1, '#f0d060');
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
    if (f.downed) return f.plot.built.level >= 1;   // felled: recovering inside their home (if they have one)
    if (f.plot.built.level < 1) return false;
    return f.state === 'sleep' || f.state === 'rest' || f.state === 'sick' || f.state === 'shelter';
}

// A compact intent badge above-right of a farmer's head — reads their current DRIVER at a glance
// (hunting / bartering / helping a neighbour) without opening the sheet. Icon-first + colour-coded on a
// dark pill so it's language-free and legible over any terrain.
function drawIntentIcon(kind, cx, y) {
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = 'rgba(14,12,10,0.72)';                                   // rounded dark backing
    ctx.fillRect(cx - 4, y - 3, 9, 7); ctx.fillRect(cx - 3, y - 4, 7, 9);
    if (kind === 'hunt') {                                                   // tan paw print
        ctx.fillStyle = '#e2c69e';
        ctx.fillRect(cx - 1, y + 1, 3, 2);                                                              // pad
        ctx.fillRect(cx - 2, y - 2, 1, 1); ctx.fillRect(cx, y - 2, 1, 1); ctx.fillRect(cx + 2, y - 2, 1, 1);   // toes
    } else if (kind === 'barter') {                                         // gold coin
        ctx.fillStyle = '#e6b83c'; ctx.fillRect(cx - 2, y - 2, 4, 4); ctx.fillRect(cx - 3, y - 1, 6, 2); ctx.fillRect(cx - 1, y - 3, 2, 6);
        ctx.fillStyle = '#f8dc80'; ctx.fillRect(cx - 1, y - 1, 1, 1);                                    // highlight
    } else if (kind === 'help') {                                          // green plus
        ctx.fillStyle = '#6ad86a'; ctx.fillRect(cx - 1, y - 3, 2, 7); ctx.fillRect(cx - 3, y - 1, 7, 2);
    }
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
    // LIMP: a badly-wounded farmer (below ~35% HP) favours a leg — a small uneven vertical hitch on the
    // walk cycle, so the invisible HP economy reads as a visible hobble. Feet/shadow stay grounded (dy).
    const hpFrac = f.maxHp ? f.hp / f.maxHp : 1;
    const dy = py + ((hpFrac < 0.35 && f.state === 'walk' && Math.floor(f.animTime * 5) % 2) ? 1 : 0);

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

    // flip for left/right only on the side view (front/back rows shouldn't mirror). Orc farmers use a single
    // front-facing pose (like the foe orcs) — mirroring it made them face BACKWARDS when walking, so never flip.
    const orcFrame = f.sheet.culture === 'orc' && orcSpriteReady();
    if (!orcFrame && f.facing < 0 && (!charReady() || f.moveDir === 'side')) {
        ctx.save();
        ctx.translate(px + fw, dy);
        ctx.scale(-1, 1);
        ctx.drawImage(frame, 0, 0);
        ctx.restore();
    } else {
        ctx.drawImage(frame, px, dy);
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
    // WOUND bar: a small red health bar over the head whenever a farmer is hurt + up-and-about, so the
    // HP economy (revive frail -> hunt/rest for meat -> mend) is legible at a glance. Hidden while
    // fighting/fleeing (the "!" + hurt-flash already carry the danger) and, of course, while asleep.
    if (hpFrac < 0.9 && f.state !== 'sleep' && f.state !== 'fight' && f.state !== 'flee') {
        const bw = 10, bh = 2, bx = Math.floor(sx - bw / 2), byy = py - 6;
        ctx.fillStyle = '#141010'; ctx.fillRect(bx - 1, byy - 1, bw + 2, bh + 2);   // black stroke (matches #68)
        ctx.fillStyle = '#5a2424'; ctx.fillRect(bx, byy, bw, bh);                    // depleted track
        ctx.fillStyle = hpFrac < 0.35 ? '#e83828' : '#d08a3c';                       // red when critical, amber otherwise
        ctx.fillRect(bx, byy, Math.max(1, Math.round(bw * hpFrac)), bh);
    }
    // INTENT badge: what's driving them right now, readable without the sheet (hunt / barter / help).
    let intent = null;
    if (f.state === 'hunt' || f.huntTarget) intent = 'hunt';
    else if (f.barterDeal || (f.path && f.path.then === 'barter')) intent = 'barter';
    else if (f.helpTask) intent = 'help';
    if (intent && f.state !== 'sleep') drawIntentIcon(intent, sx + 8, py + 1);
    // EMOTE: a transient social tell over the head — a pink heart when a bond forms, a red scowl when
    // recoiling from someone they can't stand. Grudges/bonds you can catch happening (B3). Fades out.
    if (f.emote && f.emoteT > 0 && f.state !== 'sleep') {
        const ex = sx - 8, ey = py + 1;
        ctx.globalAlpha = Math.min(1, f.emoteT);
        ctx.fillStyle = 'rgba(14,12,10,0.6)'; ctx.fillRect(ex - 3, ey - 3, 8, 8);   // faint dark backing
        if (f.emote === 'bond') {
            ctx.fillStyle = '#e8688a';
            ctx.fillRect(ex - 2, ey - 2, 2, 2); ctx.fillRect(ex + 1, ey - 2, 2, 2);       // two bumps
            ctx.fillRect(ex - 2, ey, 5, 2); ctx.fillRect(ex - 1, ey + 2, 3, 1); ctx.fillRect(ex, ey + 3, 1, 1);   // taper to a point
        } else {                                                                          // 'grudge'
            ctx.fillStyle = '#e84438';
            ctx.fillRect(ex - 2, ey + 2, 1, 1); ctx.fillRect(ex + 2, ey + 2, 1, 1); ctx.fillRect(ex - 1, ey + 3, 3, 1);  // frown
            ctx.fillStyle = '#c02820'; ctx.fillRect(ex - 2, ey - 1, 2, 1); ctx.fillRect(ex + 1, ey - 1, 2, 1);           // angry brows
        }
        ctx.globalAlpha = 1;
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
    } else if (f.carryCrop && !PRODUCE_ICONS[f.carryCrop.type]) {
        // a crop with no Supplies.png icon (bean stalks / carrot): hold up its bespoke icon or ripe sprite
        const spr = CROP_ICON_CANVAS[f.carryCrop.type] || makeCropSprites(f.carryCrop.type)[3];
        const bob = Math.round(Math.sin(performance.now() / 200));
        ctx.drawImage(spr, Math.floor(px + fw / 2 - spr.width / 2), Math.floor(py - spr.height - 3 + bob));
    } else if (f.carryTrophy && fantasyIconsReady && MEAT_ICONS[f.carryTrophy.meat]) {
        // B5: a hunter holds their kill aloft on the way home — a little trophy of the catch
        const [ix, iy, iw, ih] = MEAT_ICONS[f.carryTrophy.meat];
        const sc = Math.min(1, 12 / Math.max(iw, ih));
        const dw = Math.max(1, Math.round(iw * sc)), dh = Math.max(1, Math.round(ih * sc));
        const bob = Math.round(Math.sin(performance.now() / 200));
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(fantasyIcons, ix, iy, iw, ih, Math.floor(px + fw / 2 - dw / 2), Math.floor(py - dh - 3 + bob), dw, dh);
    }

    // work progress pips
    if (f.state === 'work' && f.action) {
        const p = 1 - f.action.timer / f.action.total;
        ctx.fillStyle = '#20222c';
        ctx.fillRect(px + 2, py - 4, 12, 2);
        ctx.fillStyle = '#7dd069';
        ctx.fillRect(px + 2, py - 4, Math.floor(12 * p), 2);
    }

    // status icon: sleeping outside (animated Z), sick (+) or worn out / catching breath (~). A
    // RESTING farmer is WAITING for their energy, not asleep — so they get the '~', never the sleep Z.
    if (!f.bubble) {
        if (f.downed) {
            const bob = Math.round(Math.sin(performance.now() / 500));   // felled with no home to recover in
            drawSkull(px + 6, py - 10 + bob);
        } else if (f.state === 'sleep') {
            const zt = Math.floor(f.animTime * 2) % 3;   // Z rising + fading, like the roof sleepers
            drawText(ctx, 'Z', px + 6, py - 8 - zt * 3, `rgba(200,210,255,${1 - zt * 0.25})`);
        } else if (f.health === 'sick') {
            const bob = Math.floor(Math.sin(performance.now() / 400) * 1);
            drawBloodDrop(px + 6, py - 10 + bob);
        } else if (f.tired || f.state === 'rest') {
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
                    : (t === T.HOUSE || t === T.COOP || t === T.BARN || t === T.MILL || t === T.HATCH || t === T.STRUCT || t === T.WELL) ? "#8a8070"
                    : seasonIdx === 3 ? '#8fa0ac' : '#3d5a33';   // open ground (snowy in winter)
            }
            miniCtx.fillStyle = col;
            miniCtx.fillRect(px, py, 1, 1);
        }
    }
}
function drawMinimap() {
    MINIMAP.x = GW - MINIMAP.w - 5;
    MINIMAP.y = GH - MINIMAP.h - 5;   // sits near the bottom edge now the log bar is gone
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
    const corners = [screenToTile(0, 18), screenToTile(GW, 18), screenToTile(GW, GH), screenToTile(0, GH)];
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

    // active battles = pulsing red. In view: a red dot on the threat. Off view: a red arrow pinned to
    // the minimap edge, pointing the way to the fight (its position along the border shows the bearing).
    const blink = Math.floor(performance.now() / 350) % 2;
    for (const e of world.encounters) {
        if (e.done) continue;
        if (inWin(e.i, e.j)) {
            if (blink) { const [px, py] = t2m(e.i, e.j); ctx.fillStyle = '#ff3020'; ctx.fillRect(Math.floor(px), Math.floor(py), 2, 2); }
        } else {
            drawMiniEdgeArrow(mx, my, mw, mh, e.i - ci, e.j - cj);
        }
    }
    ctx.restore();
}
// A red arrow pinned inside the minimap's border, pointing toward an off-window battle. Where the ray
// from centre toward the fight exits the box sets the arrow's spot (corners / mid-edges), and the edge
// it lands on sets its cardinal direction (up/down/left/right).
function drawMiniEdgeArrow(mx, my, mw, mh, dx, dy) {
    const cx = mx + mw / 2, cy = my + mh / 2, inset = 5;
    const halfW = mw / 2 - inset, halfH = mh / 2 - inset;
    const adx = Math.abs(dx) || 1e-6, ady = Math.abs(dy) || 1e-6;
    const onVert = halfW / adx < halfH / ady;            // ray exits a left/right edge first?
    const scale = onVert ? halfW / adx : halfH / ady;
    const ax = Math.round(cx + dx * scale), ay = Math.round(cy + dy * scale);
    ctx.fillStyle = '#ff3020';
    ctx.beginPath();
    const s = 2;
    if (onVert) { const d = dx > 0 ? 1 : -1; ctx.moveTo(ax + d * s, ay); ctx.lineTo(ax - d * s, ay - s); ctx.lineTo(ax - d * s, ay + s); }
    else { const d = dy > 0 ? 1 : -1; ctx.moveTo(ax, ay + d * s); ctx.lineTo(ax - s, ay - d * s); ctx.lineTo(ax + s, ay - d * s); }
    ctx.closePath(); ctx.fill();
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

// The ONE progress bar used everywhere (build sites, foundations, co-ops): a near-black outer stroke
// with the fill inset 1px inside it — so every bar in the game reads the same.
function drawProgressBar(cx, y, w, prog, fill = '#c9a45a') {
    const x = Math.floor(cx - w / 2), p = Math.max(0, Math.min(1, prog));
    ctx.fillStyle = '#0d0f15'; ctx.fillRect(x, y, w, 4);                              // outer black stroke + track
    ctx.fillStyle = fill; ctx.fillRect(x + 1, y + 1, Math.round((w - 2) * p), 2);     // inset fill
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
        const hx = Math.floor(sx - dispW / 2), hy = Math.floor(sy + TILE_H - dispH + 13);   // sink ~1 tile so the sprite reads centred in the 5x5
        const srcH = Math.max(1, Math.round(S.h * prog)), srcY = S.y + S.h - srcH;
        const dH = Math.max(1, Math.round(dispH * prog)), dY = hy + dispH - dH;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(art.img, S.x, srcY, S.w, srcH, hx, dY, dispW, dH);
    }
    drawProgressBar(sx, Math.floor(sy - 10), 26, prog, '#c9a45a');   // floating above the pad
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

// a clean, symmetric gear cog (icon-only) for the settings button — drawn procedurally on a
// 9x9 field so the round body, 8 teeth, and centre hole all stay uniform at pixel scale.
function drawGearIcon(x, y, active) {
    ctx.fillStyle = active ? '#7dd069' : '#c8ccd8';
    const R = 4;   // field is (2R+1)=9 wide, centre at (R,R)
    for (let gy = 0; gy <= 2 * R; gy++) for (let gx = 0; gx <= 2 * R; gx++) {
        const dx = gx - R, dy = gy - R, ax = Math.abs(dx), ay = Math.abs(dy), r = Math.hypot(dx, dy);
        const body = r <= 2.9;                                        // round hub/body
        const tooth = r <= 3.9 && (ax <= 1 || ay <= 1 || ax === ay);  // 8 teeth: 4 cardinal + 4 diagonal
        const hole = r <= 1.25;                                       // centre bore
        if ((body || tooth) && !hole) ctx.fillRect(x + gx, y + gy, 1, 1);
    }
}

function drawUI() {
    // top bar
    ctx.fillStyle = 'rgba(12,14,22,0.92)';
    ctx.fillRect(0, 0, GW, 18);
    ctx.fillStyle = '#20242f';
    ctx.fillRect(0, 18, GW, 1);

    // town name sits in a container that grows to fit its characters; the day/time info starts
    // AFTER it (dynamic, not a fixed x) so a long name like "SEDGEMARCH" never overlaps the clock
    const nameStr = (world.name || 'RY FARMS').toUpperCase();
    const nameW = textWidth(nameStr, 2);
    ctx.fillStyle = 'rgba(125,208,105,0.10)';
    ctx.fillRect(2, 2, nameW + 8, 14);
    drawText(ctx, nameStr, 6, 4, '#7dd069', 2);
    let hx = 6 + nameW + 12;
    ctx.fillStyle = '#2a2f3a'; ctx.fillRect(hx - 6, 4, 1, 10);   // a slim divider between name + clock
    hx += drawText(ctx, `DAY ${world.day}`, hx, 7, '#c8ccd8') + 8;

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
    // settings cog — folds in New Town + music/SFX volume (sound on/off stays a top-bar quick action)
    barIconBtn(SETTINGS_BTN, 15, (x, y) => drawGearIcon(x + 3, y + 1, settingsOpen));

    // speed controls in the corner: > = 5x, >> = 20x; a 1X revert appears while sped up
    const spd = world._speedMult || 1;
    barBtn(FF_BTN, '>>', spd === 20, '#e0a03c', '#221a0e');
    barBtn(FWD_BTN, '>', spd === 5, '#e0a03c', '#221a0e');
    SPEED1_BTN.w = 0;
    // the 1X revert is an ACTION, not the current speed — so it wears the plain ROSTER-style button
    // look (not the red 'selected' fill), which is reserved for the >/>> that IS active.
    if (spd !== 1) barBtn(SPEED1_BTN, '1X', false);

    barBtn(ROSTER_BTN, 'ROSTER', rosterOpen, '#7dd069', '#10240c');
    barBtn(WORLD_BTN, 'WORLD', worldMapOpen, '#c8b0e0', '#160f22');
    barBtn(CHRON_BTN, 'CHRONICLE', chronOpen, '#c8a0e0', '#1a1024');
    if ((world._chronTotal || 0) > chronReadTotal && !chronOpen) drawCoin(CHRON_BTN.x + CHRON_BTN.w - 3, CHRON_BTN.y - 2, 6);   // UNREAD only

    // (NEW TOWN moved into the settings menu.) A quiet "SAVED" tick under the cog whenever the town
    // autosaves — trust that the memory is real.
    if (performance.now() - saveFlashAt < 1500) drawText(ctx, 'SAVED', SETTINGS_BTN.x - 4, 18, '#7dd069');

    BOARD_BTN.hidden = !world.board;   // only exists once the town has built the board
    if (!BOARD_BTN.hidden) {
        const postCount = world.helpBoard.filter(r => r.genuine).length + (world.project ? 1 : 0);
        barBtn(BOARD_BTN, 'BOARD', boardOpen, '#c9a45a', '#221a0e');
        if (postCount > 0 && !boardOpen) drawCoin(BOARD_BTN.x + BOARD_BTN.w - 3, BOARD_BTN.y - 2, 6);
    }


    // (bottom log bar removed — the Moments/callout banners + the chronicle now carry the beats it duplicated)

    if (rosterOpen) drawRoster();
    else if (chronOpen) drawChronicle();
    else if (worldMapOpen) drawWorldMap();
    else { drawMinimap(); if (boardOpen) drawBoard(); else if (selected) drawSheet(selected); }
    if (settingsOpen) drawSettings();
}

// ---------------------------------------------------------------------------
// #2 The WORLD MAP — the zoom-out camera tier: every town this browser has grown, where it sits, which towns
// it descends from (lineage edges = the closed memory loop at world scale), and which have met (encounters).
// ---------------------------------------------------------------------------
async function openWorldMap() {
    worldMapOpen = true;
    rosterOpen = chronOpen = boardOpen = false;
    worldMapSel = world ? world.seed : null;
    if (world) await registerWorld(world);        // make sure the active town is on the map + current
    worldMapIdx = await loadWorldIndex();
}

function drawWorldMap() {
    ctx.fillStyle = 'rgba(6,7,11,0.80)'; ctx.fillRect(0, 18, GW, GH - 18);
    const PW = Math.min(GW - 12, 380), PH = GH - 40, PX = Math.floor((GW - PW) / 2), PY = 22;
    uiPanel(PX, PY, PW, PH);
    drawText(ctx, 'THE WORLD', PX + 7, PY + 5, '#c8b0e0', 1);
    drawText(ctx, 'X', PX + PW - 10, PY + 5, '#c8ccd8');

    const idx = worldMapIdx || { towns: {}, encounters: [] };
    const nodes = computeLayout(idx);
    const enc = idx.encounters || [];
    drawText(ctx, `${nodes.length} town${nodes.length !== 1 ? 's' : ''} - ${enc.length} encounter${enc.length !== 1 ? 's' : ''}`, PX + 7, PY + 14, '#9aa0b4');

    // RESERVE the footer's height (+padding) out of the map region, so the town nodes are always laid out
    // ABOVE the bottom info bar and none is drawn behind it (e.g. Dunton getting clipped).
    const CARD_H = 44, CARD_RESERVE = CARD_H + 12;
    const mapX = PX + 10, mapY = PY + 24, mapW = PW - 20, mapH = PH - 24 - CARD_RESERVE;
    worldMapHits = []; worldMapVisit = null;
    if (!nodes.length) { drawText(ctx, 'The world holds no towns yet - grow one.', mapX + 6, mapY + 20, '#9aa0b4'); return; }

    // fit the town bounding box into the map region (few towns still fill the view)
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    for (const n of nodes) { minX = Math.min(minX, n.x); minY = Math.min(minY, n.y); maxX = Math.max(maxX, n.x); maxY = Math.max(maxY, n.y); }
    const bw = Math.max(1, maxX - minX), bh = Math.max(1, maxY - minY), pad = 26;
    const S = nodes.length === 1 ? 0 : Math.min((mapW - 2 * pad) / bw, (mapH - 2 * pad) / bh);
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const toX = n => mapX + mapW / 2 + (n.x - cx) * S;
    const toY = n => mapY + mapH / 2 + (n.y - cy) * S;
    const bySeed = new Map(nodes.map(n => [String(n.seed), n]));

    // faint memory-tinted reach halos
    for (const n of nodes) { ctx.beginPath(); ctx.arc(toX(n), toY(n), Math.max(4, n.reach * S), 0, Math.PI * 2); ctx.fillStyle = `hsla(${n.tint.h} ${n.tint.s}% 55% / 0.06)`; ctx.fill(); }
    // lineage edges (town -> ancestor town it was founded from)
    ctx.lineWidth = 1;
    for (const n of nodes) for (const a of n.ancestors) {
        const anc = bySeed.get(a); if (!anc) continue;
        ctx.strokeStyle = 'rgba(200,176,224,0.5)';
        ctx.beginPath(); ctx.moveTo(toX(n), toY(n)); ctx.lineTo(toX(anc), toY(anc)); ctx.stroke();
        ctx.fillStyle = 'rgba(200,176,224,0.8)'; ctx.fillRect(toX(anc) - 1, toY(anc) - 1, 2, 2);
    }
    // encounter links — blood-red for a raid/broken parley, WARM GREEN for an honored reconciliation, gold for
    // a same-culture meeting (#3.2/#reconciliation: the frontier's state, readable at a glance).
    for (const e of enc) {
        const A = bySeed.get(String(e.a)), B = bySeed.get(String(e.b)); if (!A || !B) continue;
        ctx.strokeStyle = (e.kind === 'raid' || e.kind === 'betrayed') ? 'rgba(230,80,60,0.6)'
            : e.kind === 'reconciled' ? 'rgba(125,208,105,0.55)' : 'rgba(240,200,120,0.4)';
        ctx.beginPath(); ctx.moveTo(toX(A), toY(A)); ctx.lineTo(toX(B), toY(B)); ctx.stroke();
    }
    // town dots + labels
    for (const n of nodes) {
        const x = toX(n), y = toY(n), r = Math.max(2, Math.min(6, 2 + n.pop * 0.3));
        const active = world && String(n.seed) === String(world.seed);
        const seld = worldMapSel != null && String(n.seed) === String(worldMapSel);
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = n.tint.css; ctx.fill();
        if (active || seld) { ctx.strokeStyle = active ? '#f0e0a0' : '#ffffff'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, r + 2, 0, Math.PI * 2); ctx.stroke(); }
        drawText(ctx, n.name.split(' ')[0], x + r + 2, y - 3, active ? '#f0e0a0' : '#c8ccd8');
        worldMapHits.push({ seed: n.seed, x, y, r: r + 3 });
    }
    // selected-town info bar (fixed footer). The map region above reserves its height, so it never clips a town.
    if (worldMapSel != null) {
        const n = bySeed.get(String(worldMapSel));
        if (n) {
            const cardW = PW - 16, cardH = CARD_H, cardX = PX + 8, cardY = PY + PH - cardH - 4;
            ctx.fillStyle = 'rgba(20,16,28,0.92)'; ctx.fillRect(cardX, cardY, cardW, cardH);
            ctx.strokeStyle = n.tint.css; ctx.strokeRect(cardX + 0.5, cardY + 0.5, cardW - 1, cardH - 1);
            drawText(ctx, n.name.toUpperCase() + (n.culture === 'orc' ? ' - WARBAND' : ''), cardX + 4, cardY + 4, n.tint.css);
            drawText(ctx, `Year ${n.year} - day ${n.day} - ${n.pop} ${n.culture === 'orc' ? 'raiders' : 'settlers'} - ${n.harvestTotal} ${n.culture === 'orc' ? 'plundered' : 'harvested'}`, cardX + 4, cardY + 13, '#b0b6c8');
            if (n.ancestors.length) drawText(ctx, `heir of ${n.ancestors.length} remembered town${n.ancestors.length > 1 ? 's' : ''}`, cardX + 4, cardY + 22, '#c8b0e0');
            if (n.motto) { const ln = wrapText(`"${n.motto}"`, 46)[0]; drawText(ctx, ln, cardX + 4, cardY + 31, '#eef0f4'); }
            const active = world && String(n.seed) === String(world.seed);
            if (!active) {
                const vbw = 42, bx = cardX + cardW - vbw - 3, by = cardY + cardH - 11;
                ctx.fillStyle = 'rgba(125,208,105,0.25)'; ctx.fillRect(bx, by, vbw, 9);
                drawText(ctx, 'VISIT', bx + 9, by + 1, '#7dd069');
                worldMapVisit = { x: bx, y: by, w: vbw, h: 9, seed: n.seed };
            } else drawText(ctx, 'you are here', cardX + cardW - 52, cardY + cardH - 10, '#f0e0a0');
        }
    } else drawText(ctx, 'click a town - lines: lineage - gold: encounters', PX + 8, PY + PH - 11, '#7a8090');
}

// ---------------------------------------------------------------------------
// Settings menu — New Town + music/SFX volume. Opened by the top-bar gear cog.
// ---------------------------------------------------------------------------
function drawSettings() {
    const PW = Math.min(GW - 24, 240), PH = 148;
    const PX = Math.floor((GW - PW) / 2), PY = Math.floor((GH - PH) / 2) - 6;
    ctx.fillStyle = 'rgba(6,7,11,0.72)'; ctx.fillRect(0, 18, GW, GH - 18);
    uiPanel(PX, PY, PW, PH);
    drawText(ctx, 'SETTINGS', PX + 7, PY + 5, '#c8ccd8', 1);
    drawText(ctx, 'X', PX + PW - 10, PY + 5, '#c8ccd8');
    ctx.fillStyle = '#20242f'; ctx.fillRect(PX + 4, PY + 15, PW - 8, 1);

    const IX = PX + 8, TRACK_X = PX + 92, TRACK_W = PW - 92 - 40;
    settingsHits = { close: { x: PX + PW - 14, y: PY, w: 14, h: 12 } };

    // one volume row: label, an on/off toggle chip, a draggable track, and the percentage
    const volRow = (y, label, on, vol, tKey, sKey) => {
        drawText(ctx, label, IX, y + 1, on ? '#e8ecf5' : '#6a6f7c');
        const tog = { x: IX + 46, y: y - 1, w: 20, h: 9 };
        ctx.fillStyle = on ? '#2c5a22' : '#33261a'; ctx.fillRect(tog.x, tog.y, tog.w, tog.h);
        ctx.strokeStyle = on ? '#7dd069' : '#7a6a4a'; ctx.lineWidth = 1; ctx.strokeRect(tog.x + 0.5, tog.y + 0.5, tog.w - 1, tog.h - 1);
        drawText(ctx, on ? 'ON' : 'OFF', tog.x + 3, y + 1, on ? '#7dd069' : '#c8a060');
        // track
        ctx.fillStyle = '#171a22'; ctx.fillRect(TRACK_X, y, TRACK_W, 4);
        ctx.strokeStyle = '#3a3f4c'; ctx.strokeRect(TRACK_X + 0.5, y + 0.5, TRACK_W - 1, 3);
        const fillW = Math.round(TRACK_W * vol);
        ctx.fillStyle = on ? '#7dd069' : '#5a5f6c'; ctx.fillRect(TRACK_X, y, fillW, 4);
        ctx.fillStyle = on ? '#e8ecf5' : '#8a8f9c'; ctx.fillRect(TRACK_X + Math.max(0, Math.min(TRACK_W - 2, fillW - 1)), y - 1, 2, 6);   // knob
        drawText(ctx, `${Math.round(vol * 100)}%`, TRACK_X + TRACK_W + 6, y + 1, '#c8ccd8');
        settingsHits[tKey] = tog;
        settingsHits[sKey] = { x: TRACK_X, y: y - 3, w: TRACK_W, h: 10 };
    };
    volRow(PY + 24, 'MUSIC', audio.musicOn, audio.musicVol, 'music', 'musicSlider');
    volRow(PY + 40, 'SOUND FX', audio.sfxOn, audio.sfxVol, 'sfx', 'sfxSlider');

    ctx.fillStyle = '#20242f'; ctx.fillRect(PX + 4, PY + 56, PW - 8, 1);

    // MEMORY PORTAL — opens the town's SuperMemory graph in a new tab
    const mb = { x: IX, y: PY + 64, w: PW - 16, h: 14 };
    ctx.fillStyle = '#1a1424'; ctx.fillRect(mb.x, mb.y, mb.w, mb.h);
    ctx.strokeStyle = '#c8a0e0'; ctx.strokeRect(mb.x + 0.5, mb.y + 0.5, mb.w - 1, mb.h - 1);
    const mlabel = 'VIEW THE TOWN\'S MEMORY';
    drawText(ctx, mlabel, mb.x + Math.floor((mb.w - textWidth(mlabel)) / 2), mb.y + 4, '#d8b8ee');
    settingsHits.portalBtn = mb;
    drawText(ctx, memoryCaption(), IX, PY + 82, '#5a5f6c');

    ctx.fillStyle = '#20242f'; ctx.fillRect(PX + 4, PY + 92, PW - 8, 1);

    // NEW TOWN — the two-step reset hatch, moved here out of the top bar
    const confirming = performance.now() < newConfirmUntil;
    const nb = { x: IX, y: PY + 100, w: PW - 16, h: 14 };
    ctx.fillStyle = confirming ? '#3a1010' : '#2a0e0e'; ctx.fillRect(nb.x, nb.y, nb.w, nb.h);
    ctx.strokeStyle = '#e05040'; ctx.strokeRect(nb.x + 0.5, nb.y + 0.5, nb.w - 1, nb.h - 1);
    const nlabel = confirming ? 'SURE? - THIS TOWN IS SET ASIDE' : 'START A NEW TOWN';
    drawText(ctx, nlabel, nb.x + Math.floor((nb.w - textWidth(nlabel)) / 2), nb.y + 4, confirming ? '#ff9080' : '#e07868');
    settingsHits.newBtn = nb;
    drawText(ctx, 'A NEW TOWN GROWS A NEW CAST - THIS ONE IS SAVED, NOT LOST.', IX, PY + 120, '#5a5f6c');
    drawText(ctx, 'ESC OR CLICK OUTSIDE TO CLOSE', IX, PY + 134, '#4a4f5c');
    settingsHits.panel = { x: PX, y: PY, w: PW, h: PH };
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
    if (opts.canvas && opts.canvas.width) {
        // a ready procedural canvas (e.g. a crop with no Supplies.png icon) fitted into the slot
        const cv = opts.canvas, fit = sz - 3, sc = fit / Math.max(cv.width, cv.height);
        const dw = Math.max(1, Math.round(cv.width * sc)), dh = Math.max(1, Math.round(cv.height * sc));
        const savedSmooth = ctx.imageSmoothingEnabled; ctx.imageSmoothingEnabled = false;
        ctx.drawImage(cv, x + Math.round((sz - dw) / 2), y + Math.round((sz - dh) / 2), dw, dh);
        ctx.imageSmoothingEnabled = savedSmooth;
    } else if (opts.sprite && opts.sprite.sheet && opts.sprite.sheet.complete && opts.sprite.sheet.naturalWidth) {
        // a sprite-sheet sub-rect (e.g. a harvested-crop icon from Supplies.png) fitted into the slot
        const sp = opts.sprite, fit = sz - 3, sc = fit / Math.max(sp.sw, sp.sh);   // scale to fill the slot (crop icons are small)
        const dw = Math.max(1, Math.round(sp.sw * sc)), dh = Math.max(1, Math.round(sp.sh * sc));
        const savedSmooth = ctx.imageSmoothingEnabled; ctx.imageSmoothingEnabled = false;
        ctx.drawImage(sp.sheet, sp.sx, sp.sy, sp.sw, sp.sh, x + Math.round((sz - dw) / 2), y + Math.round((sz - dh) / 2), dw, dh);
        ctx.imageSmoothingEnabled = savedSmooth;
    } else if (iconImg && iconImg.complete && iconImg.naturalWidth) {
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
    const name = lvl >= 3 ? 'Cottage' : lvl >= 2 ? 'Yurt' : 'Tipi';
    const who = f.sheet.name.split(' ')[0];
    // first line (gold): whose home + type + tier, together — e.g. "Pixel's Tipi - Tier 1"
    const lines = [{ t: `${who}'s ${name} - Tier ${lvl}`, c: TT_G }];
    if (lvl >= 3) { lines.push({ t: 'Estate: up to 560 tiles', c: TT_GR }, { t: 'Livestock + frontier fields', c: TT_GR }, { t: 'Big stores (220 wood / 110 ore)', c: TT_GR }); }
    else if (lvl >= 2) { lines.push({ t: 'Farm grows up to 300 tiles', c: TT_GR }, { t: 'Livestock + stores (140w / 75o)', c: TT_GR }); }
    else { lines.push({ t: 'Small yard (up to 160 tiles)', c: TT_GR }); }
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
      // hover box matches the GUILD-HALL bounds (drawSilo geometry), widening for the L5 wings
      const gsc = ASSET_SCALE * 0.9, gcw = Math.round(GH_CENTER.w * gsc), gch = Math.round(GH_CENTER.h * gsc);
      const gFoot = Math.floor(sy + TILE_H), gby = gFoot - gch;
      const grw = gcw + Math.round(9 * gsc), grh = Math.round(GH_ROOF.h * (grw / GH_ROOF.w));
      const gTop = Math.min(gby, gby - grh + Math.round(3 * gsc) + 11);
      let ghx = Math.floor(sx - gcw / 2), ghw = gcw;
      if (world.townLevel >= 5) { const glw = Math.round(GH_LWING.w * gsc), grwg = Math.round(GH_RWING.w * gsc); ghx -= glw; ghw += glw + grwg; }
      push(ghx - 2, gTop, ghw + 4, gFoot - gTop,
        [{ t: `${(world.name || 'TOWN').toUpperCase()} SILO — LV ${world.townLevel}`, c: TT_G }, { t: world.townCharacter(), c: TT_L },
         { t: 'Settlers give surplus goods here', c: TT_GR },
         { t: maxed ? 'The town is fully grown' : `${world.townXP} / ${world.townXpNeed()} to level ${world.townLevel + 1}`, c: TT_B }]); }
    // legend monuments — hover to read the deed they mark (#85)
    for (const m of (world.monuments || [])) {
        const sx = cam.x + isoX(m.i, m.j), sy = cam.y + isoY(m.i, m.j);
        push(Math.floor(sx - 6), Math.floor(sy + TILE_H / 2 - 19), 12, 21,
            [{ t: 'MONUMENT', c: TT_G }, { t: `${m.hero} felled ${m.foe}`, c: TT_L }, { t: `a stand on day ${m.day}`, c: TT_GR }]);
    }
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
// A one-line "what they're doing + why" for the card — EXPLAINS the symbol hovering over their head on
// the map (wound bar / hunt paw / barter coin / help plus / grudge-scowl or bond-heart / kill trophy),
// falling back to a plain description of their current activity.
// #94: the civic role a farmer currently holds (MANAGER / WATCH), shown on their card.
function farmerRole(f) {
    return (f && f.world && f.world.roleOf) ? f.world.roleOf(f) : null;
}

function currentStatus(f) {
    if (f.downed) return 'RECOVERING AT HOME';
    if (f.carryTrophy) return 'CARRYING HOME A FRESH KILL';
    if (f.state === 'hunt' || f.huntTarget) return 'STALKING WILD GAME FOR MEAT';
    if (f.barterDeal || (f.path && f.path.then === 'barter')) {
        const p = f.barterDeal && f.barterDeal.partner;
        return p ? `OFF TO BARTER WITH ${p.sheet.name.split(' ')[0].toUpperCase()}` : 'OFF TO BARTER GOODS';
    }
    if (f.helpTask) return 'LENDING A NEIGHBOR A HAND';
    if (f.emote === 'grudge') return 'STEERING CLEAR OF SOMEONE THEY DISLIKE';
    if (f.emote === 'bond') return 'WARMING TO A NEIGHBOR';
    const hpFrac = f.maxHp ? f.hp / f.maxHp : 1;
    if (hpFrac < 0.35) return 'BADLY WOUNDED - LIMPING IT OFF';
    if (hpFrac < 0.9) return 'NURSING A WOUND';
    const map = { work: 'TENDING THE FARM', walk: 'ON THE MOVE', chop: 'CHOPPING TIMBER', break: 'GRUBBING A STUMP',
        mine: 'MINING STONE', forage: 'FORAGING THE WILDS', fish: 'FISHING A WILD LAKE', build: 'BUILDING WITH THE TOWN',
        housebuild: 'RAISING THEIR HOME', coopbuild: 'RAISING A COOP', fencepost: 'RAISING A FENCE', craft: 'CRAFTING',
        sleep: 'ASLEEP', rest: 'RESTING UP', sick: 'LAID UP SICK', shelter: 'SHELTERING FROM THE STORM',
        care: 'TENDING A SICK NEIGHBOR', fight: 'STANDING AND FIGHTING', flee: 'FLEEING DANGER',
        donate: 'HAULING SURPLUS TO THE SILO', scarecrow: 'RAISING A SCARECROW' };
    return map[f.state] || (f.thought ? f.thought : 'GOING ABOUT THEIR DAY');
}
function drawSheet(f) {
    const s = f.sheet, p = s.personality;
    const PW = 154, PX = GW - PW - 4, PY = 22;
    const PH = GH - 22 - PY - 3;   // full height, down to just above the bottom log bar
    SHEET_RECT.x = PX; SHEET_RECT.y = PY; SHEET_RECT.w = PW; SHEET_RECT.h = PH;
    uiPanel(PX, PY, PW, PH);
    const IX = PX + 7, IW = PW - 14;
    const eCol = f.downed ? '#e0703c' : f.health === 'sick' ? '#c05840' : f.tired ? '#e0a03c' : '#7dd069';

    // --- close (X) button, top-right corner ---
    SHEET_CLOSE.x = PX + PW - 13; SHEET_CLOSE.y = PY + 3; SHEET_CLOSE.w = 10; SHEET_CLOSE.h = 10;
    ctx.fillStyle = '#3a2c1e'; ctx.fillRect(SHEET_CLOSE.x, SHEET_CLOSE.y, SHEET_CLOSE.w, SHEET_CLOSE.h);
    ctx.fillStyle = '#5a4632'; ctx.fillRect(SHEET_CLOSE.x, SHEET_CLOSE.y, SHEET_CLOSE.w, 1);
    drawText(ctx, 'X', SHEET_CLOSE.x + 3, SHEET_CLOSE.y + 3, '#e8c8a0');

    // --- follow/track toggle (crosshair), just left of the X: camera trails this farmer ---
    SHEET_FOLLOW.x = SHEET_CLOSE.x - 13; SHEET_FOLLOW.y = PY + 3; SHEET_FOLLOW.w = 10; SHEET_FOLLOW.h = 10;
    const following = followMode && followTarget === f;
    ctx.fillStyle = following ? '#1f5a2a' : '#3a2c1e'; ctx.fillRect(SHEET_FOLLOW.x, SHEET_FOLLOW.y, 10, 10);
    ctx.fillStyle = following ? '#7dd069' : '#5a4632'; ctx.fillRect(SHEET_FOLLOW.x, SHEET_FOLLOW.y, 10, 1);
    const cxr = SHEET_FOLLOW.x + 5, cyr = SHEET_FOLLOW.y + 5, rc = following ? '#bff0a8' : '#e8c8a0';
    ctx.fillStyle = rc;
    ctx.fillRect(cxr - 3, cyr, 2, 1); ctx.fillRect(cxr + 2, cyr, 2, 1);   // horizontal reticle ticks
    ctx.fillRect(cxr, cyr - 3, 1, 2); ctx.fillRect(cxr, cyr + 2, 1, 2);   // vertical reticle ticks
    ctx.fillRect(cxr, cyr, 1, 1);                                          // centre dot

    // --- fixed title band (name + archetype/level + health) ---
    ctx.fillStyle = '#2b2016'; ctx.fillRect(IX - 2, PY + 16, IW + 4, 21);
    ctx.fillStyle = SHEET_GOLD; ctx.fillRect(IX - 2, PY + 16, IW + 4, 1); ctx.fillRect(IX - 2, PY + 36, IW + 4, 1);
    drawText(ctx, s.name, IX, PY + 19, '#ffffff', 1);
    // #94: a civic role a farmer holds shows in gold at the end of the name line
    const role = farmerRole(f);
    if (role) drawText(ctx, role, IX + IW - textWidth(role), PY + 19, '#e8c860');
    drawText(ctx, `${s.archetype.toUpperCase()} LV${s.level}`, IX, PY + 28, SHEET_GOLD);
    const hStr = f.downed ? 'RECOVERING' : f.health === 'sick' ? 'SICK' : f.tired ? 'TIRED' : 'WELL';
    drawText(ctx, hStr, IX + IW - textWidth(hStr), PY + 28, eCol);

    // --- tab bar (fixed, below the title band) — the long scroll is now split into four
    //     views so nothing important stays buried below the fold ---
    const TAB_LABELS = ['STATS', 'ACTIVITY', 'TIES', 'STORY'];
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
        // ===== STATS: vitals, personality, abilities, farm, gear. (The creed/course/dream/NOW
        //       narration lives on the ACTIVITY and STORY tabs — no need to repeat it here.)
        const hpFrac = Math.max(0, Math.min(1, f.hp / f.maxHp));
        const hpCol = hpFrac > 0.5 ? '#d05450' : hpFrac > 0.25 ? '#e0a03c' : '#e83828';
        drawText(ctx, 'HP', IX, y, SHEET_LABEL); barFill(IX + 42, y, IW - 42, hpFrac, hpCol); y += 6;
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
        drawText(ctx, 'TRADE', IX, y, SHEET_LABEL); drawText(ctx, f.specialty().slice(0, 22), IX + 32, y, '#8ad0e0'); y += 7;   // the farm's specialty / identity
        const cropMix = (s.crops && s.crops.length ? s.crops : [s.crop]).join(', ');
        drawText(ctx, s.crops && s.crops.length > 1 ? 'CROPS' : 'CROP', IX, y, SHEET_LABEL);
        drawText(ctx, cropMix.slice(0, 24), IX + 32, y, SHEET_VAL); y += 7;
        const facs = ['crops', ...f.plot.facilities.map(fc => FAC_SHORT[fc.type] || fc.type)];
        drawText(ctx, 'HAS', IX, y, SHEET_LABEL); drawText(ctx, facs.join(', ').slice(0, 26), IX + 32, y, SHEET_VAL); y += 7;
        kv(IX, 'LAND', `${f.plot.cells.size}t`); drawText(ctx, 'YIELD', IX + 76, y, SHEET_LABEL); drawText(ctx, String(s.cropsHarvested || 0), IX + 108, y, SHEET_VAL); y += 7;
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
                if (it.crop) {
                    // a crop stack: draw its Supplies.png produce icon (or the procedural ripe sprite
                    // for crops with no icon, e.g. bean stalks) and tag WHERE it came from
                    const pi = PRODUCE_ICONS[it.crop];
                    const sprite = (pi && imageLoaded(suppliesSheet)) ? { sheet: suppliesSheet, sx: pi[0], sy: pi[1], sw: pi[2], sh: pi[3] } : null;
                    const canvas = sprite ? null : (CROP_ICON_CANVAS[it.crop] || makeCropSprites(it.crop)[3]);
                    drawItemSlot(sx, sy, SZ, null, it.count, { sel: selectedSlotKey === key, sprite, canvas });
                    // provenance = how these COLLECTED crops were obtained (never counts what's still
                    // planted — cropStock only fills on harvest/steal/forage). "raised" = harvested from
                    // this farmer's own crop, so it reads as collected, not growing-in-the-field.
                    const src = it.sources, parts = [];
                    if (src.grown) parts.push(`${src.grown} raised`);
                    if (src.stolen) parts.push(`${src.stolen} stolen`);
                    if (src.found) parts.push(`${src.found} foraged`);
                    addSlot(sx, sy, key, { title: it.name, body: parts.join(', ') || `you have ${it.count}` });
                } else if (it.good) {
                    // fish/lily use a procedural sprite; meat uses a fantasy-icon sub-rect
                    const mi = MEAT_ICONS[it.good];
                    const sprite = (mi && fantasyIconsReady) ? { sheet: fantasyIcons, sx: mi[0], sy: mi[1], sw: mi[2], sh: mi[3] } : null;
                    drawItemSlot(sx, sy, SZ, null, it.count, { sel: selectedSlotKey === key, sprite, canvas: sprite ? null : GOOD_ICON[it.good] });
                    addSlot(sx, sy, key, { title: it.name, body: `you have ${it.count}` });
                } else {
                    drawItemSlot(sx, sy, SZ, itemIcon(it.icon), it.count, { sel: selectedSlotKey === key });
                    addSlot(sx, sy, key, { title: it.name, body: it.cap ? `you have ${it.count} / ${it.cap} storage` : `you have ${it.count}` });
                }
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

        // #97 Slice 2 — KNOWN RECIPES: what this farmer has INVENTED (base remedies are universal, so
        // only their own discoveries are worth listing). Wraps to fit; a quiet line when they've made none.
        y = sectionBand(IX, y, IW, 'RECIPES');
        const invented = (f.knownRecipes() || []).filter(id => id.indexOf('inv:') === 0)
            .map(id => (RECIPE_BY_ID[id] && RECIPE_BY_ID[id].name) || id);
        if (!invented.length) { drawText(ctx, 'no discoveries yet', IX, y, SHEET_LABEL); y += 8; }
        else for (const ln of wrapText(invented.join(', '), Math.floor(IW / 4.2))) { drawText(ctx, ln, IX, y, '#ffd24a'); y += 7; }
        y += 2;

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
            : f.state === 'forage' ? 'foraging' : f.state === 'poach' ? 'sneaking'
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

        // ===== MEMORIES (folded in from the old MEMORY tab): the episodic journal, newest
        // first + paginated, below the pinned activity section; then the source doc =====
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
    } else if (sheetTab === 2) {
        // ===== TIES: every meaningful relationship (strongest first) + overheard gossip =====
        const friends = f.allRegard(1), grudges = f.allRegard(-1);
        y = sectionBand(IX, y, IW, 'TOWN TIES');
        if (!friends.length && !grudges.length) { drawText(ctx, 'no strong ties yet', IX + 2, y, SHEET_LABEL); y += 8; }
        for (const fr of friends) {
            drawText(ctx, `Trusts ${fr.who.sheet.name.split(' ')[0]}`, IX + 2, y, '#7dd069'); y += 7;
            const rec = f.opinionReasons && f.opinionReasons.get(fr.who.sheet.seed);
            const r = rec && rec.pos;   // a POSITIVE tie shows why they warmed to them (never a soured memory)
            if (r) for (const line of wrapText(`- ${r}`, 30).slice(0, 1)) { drawText(ctx, line, IX + 6, y, SHEET_LABEL); y += 7; }
        }
        for (const gr of grudges) {
            const verb = gr.v <= -0.35 ? 'Avoids' : 'Wary of';   // strong resentment = active avoidance
            drawText(ctx, `${verb} ${gr.who.sheet.name.split(' ')[0]}`, IX + 2, y, '#c05840'); y += 7;
            const rec = f.opinionReasons && f.opinionReasons.get(gr.who.sheet.seed);
            const r = rec && rec.neg;   // a NEGATIVE tie shows what soured it (never a warm memory)
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
        // ===== STORY (#92a): the DM's 5e-style identity block — background, origin tale,
        // and the classic sheet quartet (ideal / bond / flaw), plus where the dream stands =====
        const st = f.sheet.story;
        if (!st) { drawText(ctx, 'their story is still being written', IX + 2, y, SHEET_LABEL); }
        else {
            y = sectionBand(IX, y, IW, `BACKGROUND: ${st.bg}`);
            for (const ln of wrapText(st.tale, 34)) { drawText(ctx, ln, IX + 2, y, '#c8ccd8'); y += 7; }
            y += 3;
            const quartet = [['IDEAL', st.ideal, '#e8c860'], ['BOND', st.bond, '#8fc7e8'], ['FLAW', st.flaw, '#d08c74']];
            for (const [label, text, col] of quartet) {
                drawText(ctx, label, IX + 2, y, SHEET_LABEL); y += 7;
                for (const ln of wrapText(text, 34)) { drawText(ctx, ln, IX + 4, y, col); y += 7; }
                y += 2;
            }
            y += 1;
            y = sectionBand(IX, y, IW, 'THE DREAM');
            for (const ln of wrapText(f.sheet.dream ? f.sheet.dream.yearn : 'none yet', 34)) { drawText(ctx, ln, IX + 2, y, '#e8c860'); y += 7; }
            drawText(ctx, f.sheet.dreamDone ? `WON ON DAY ${f.sheet.dreamDone}` : 'STILL CHASING IT', IX + 2, y, f.sheet.dreamDone ? '#7dd069' : SHEET_LABEL); y += 8;
            if (f.goal) { drawText(ctx, `COURSE THIS SEASON: ${f.goal.toUpperCase()}`, IX + 2, y, '#d08cc8'); y += 7; }

            // #1.2 LINEAGE / provenance — when this farmer is an HEIR, trace the closed memory loop on the
            // sheet: who they descend from, that forebear's OWN source memory, and (in CREEDS) the creed
            // carried forward. The visible causal chain — passage -> creed -> heir -> new town — made clickable.
            const lin = f.sheet.lineage;
            if (lin) {
                y += 2;
                y = sectionBand(IX, y, IW, 'LINEAGE');
                for (const ln of wrapText(`Heir of ${lin.ofName}${lin.ofTown ? ` of ${lin.ofTown}` : ''}.`, 33)) { drawText(ctx, ln, IX + 2, y, '#e0c8f0'); y += 7; }
                if (lin.sourceTitle) for (const ln of wrapText(`Their forebear grew from: "${lin.sourceTitle}".`, 32)) { drawText(ctx, ln, IX + 2, y, '#b0b6c8'); y += 7; }
                if (lin.dream) for (const ln of wrapText(`Forebear's dream: ${lin.dream}.`, 32)) { drawText(ctx, ln, IX + 2, y, '#b0b6c8'); y += 7; }
                y += 2;
            }

            // #91 CREEDS — the values distilled from this farmer's source memory. These are what the
            // sim quotes when they refuse or hold their ground, so behaviour traces back to the document.
            y += 2;
            y = sectionBand(IX, y, IW, 'CREEDS');
            const ks = f.creeds || [];
            if (!ks.length) { drawText(ctx, 'nothing carried yet', IX + 2, y, SHEET_LABEL); y += 8; }
            else for (const k of ks) {
                const inh = k.theme === 'inherited';               // #1.2 the creed carried from a forebear
                const col = inh ? '#e0c8f0' : '#c8a0e0';
                if (inh && k.inherited && k.inherited.name) { drawText(ctx, `carried from ${String(k.inherited.name).split(' ')[0]}:`, IX + 7, y, '#8a7ca0'); y += 7; }
                ctx.fillStyle = col; ctx.fillRect(IX + 2, y + 2, 2, 2);
                for (const ln of wrapText(k.quote, 33)) { drawText(ctx, ln, IX + 7, y, col); y += 7; }
                y += 2;
            }

            // #91 Tier-3 — BELIEFS: convictions FORMED from lived experience (not inherited like creeds).
            // Only shown once a farmer has actually learned something the hard way (e.g. being denied care).
            const bels = f.beliefs || [];
            if (bels.length) {
                y += 1;
                y = sectionBand(IX, y, IW, 'HARD-WON BELIEFS');
                for (const b of bels) {
                    ctx.fillStyle = '#8fc7e8'; ctx.fillRect(IX + 2, y + 2, 2, 2);
                    for (const ln of wrapText(`"${b.text}" (day ${b.day})`, 33)) { drawText(ctx, ln, IX + 7, y, '#8fc7e8'); y += 7; }
                    y += 2;
                }
            }
        }
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
    return [...world.farmers].sort((a, b) => (b.sheet.cropsHarvested || 0) - (a.sheet.cropsHarvested || 0));
}

function drawRoster() {
    const PW = Math.min(GW - 12, 372);
    const PH = GH - 40;
    const PX = Math.floor((GW - PW) / 2);
    const PY = 22;
    rosterRows = [];

    // dim the world behind
    ctx.fillStyle = 'rgba(6,7,11,0.72)';
    ctx.fillRect(0, 18, GW, GH - 18);

    // panel — shared wood frame (matches the Board + character sheet)
    uiPanel(PX, PY, PW, PH);

    // header
    drawText(ctx, 'TOWN ROSTER', PX + 7, PY + 5, '#7dd069', 1);
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

    // the window splits: the roster LIST is locked to the top, the CONSCIENCE CHAT to the bottom. The list gets
    // the lion's share so the whole cast is visible (was 0.46 — the chat's empty middle wasted rows + clipped
    // the last settler); the chat keeps a compact strip that still holds its prompt + recent lines.
    const splitY = PY + Math.floor(PH * 0.66);

    // scrollable body (clipped) — ends above the split, leaving a line for the hint + divider
    const bodyTop = hy + 11;
    const bodyBot = splitY - 12;
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
        const nameCol = f.downed ? '#e0703c' : f.health === 'sick' ? '#e07868' : f.tired ? '#e0a03c' : '#e8ecf5';
        const nm = (isLeader ? '*' : '') + s.name;
        drawText(ctx, nm.slice(0, 16), colName, ry + 1, nameCol);
        drawText(ctx, String(s.level), colLv, ry + 1, '#7dd069');
        STAT_NAMES.forEach((st, i) => {
            drawText(ctx, String(s.stats[st]).padStart(2), Math.floor(colStats + i * statW), ry + 1, '#c8ccd8');
        });
        drawText(ctx, String(s.cropsHarvested || 0), PX + PW - 22, ry + 1, '#e8c860');
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

    // the bottom half: the conscience chat
    drawConscienceChat(PX, splitY, PW, PY + PH - splitY);

    // if the farmer-switch dropdown is open, it draws LAST so it overlays the list above it
    if (chatDropdownOpen) drawChatDropdown(PX, PW, splitY);
}

// ---------------------------------------------------------------------------
// Conscience chat — the player's whispers to one farmer, locked to the bottom
// half of the roster window. The sim decides what the farmer makes of each
// thought (farm.js conscienceCheck); this only renders the exchange + captures input.
// ---------------------------------------------------------------------------

const VERDICT_GLYPH = { HEED: '~', ALREADY: '=', BARGAIN: '>', DISMISS: '.', QUESTION: '?', DEFY: '!' };
const VERDICT_COL   = { HEED: '#7dd069', ALREADY: '#7db0d0', BARGAIN: '#e8c860', DISMISS: '#8a8f9c', QUESTION: '#c8a0e0', DEFY: '#e0703c' };

// the dropdown caret: a compact 2-row caret (the same shape as the "^" font glyph). `up` draws
// it pointing up (dropdown OPEN); flipped vertically it points down (CLOSED) — one shape, mirrored.
function drawCaret(x, y, up, color) {
    ctx.fillStyle = color;
    const X = Math.round(x), Y = Math.round(y);
    if (up) { ctx.fillRect(X + 1, Y, 1, 1); ctx.fillRect(X, Y + 1, 1, 1); ctx.fillRect(X + 2, Y + 1, 1, 1); }
    else    { ctx.fillRect(X, Y, 1, 1); ctx.fillRect(X + 2, Y, 1, 1); ctx.fillRect(X + 1, Y + 1, 1, 1); }
}

function activeChatFarmer() {
    if (chatFarmer && world.farmers.includes(chatFarmer)) return chatFarmer;
    chatFarmer = (selected && world.farmers.includes(selected)) ? selected : world.farmers[0] || null;
    return chatFarmer;
}

// wrap `text` to `maxChars`-wide lines (the 3x5 font is fixed-width: ~4px/char)
function wrapLine(text, maxChars) {
    const words = String(text).split(' ');
    const out = [];
    let cur = '';
    for (const w of words) {
        if (!cur) cur = w;
        else if ((cur + ' ' + w).length <= maxChars) cur += ' ' + w;
        else { out.push(cur); cur = w; }
        while (cur.length > maxChars) { out.push(cur.slice(0, maxChars)); cur = cur.slice(maxChars); }
    }
    if (cur) out.push(cur);
    return out;
}

function drawConscienceChat(x, y, w, h) {
    const f = activeChatFarmer();
    ctx.fillStyle = '#20242f';
    ctx.fillRect(x + 4, y - 1, w - 8, 1);

    if (!f) { drawText(ctx, 'NO ONE TO TALK TO YET', x + 6, y + 6, '#6a6f7c'); return; }
    const c = f.conscience;

    // header: INSIDE THE HEAD OF: [NAME v]
    const hy = y + 3;
    drawText(ctx, 'INSIDE THE HEAD OF', x + 6, hy, '#9a7fc0');
    const nm = f.sheet.name.split(' ')[0].toUpperCase();
    const nmX = x + 6 + textWidth('INSIDE THE HEAD OF ', 1);
    drawText(ctx, nm, nmX, hy, '#e8ecf5');
    // dropdown caret button
    const caretX = nmX + textWidth(nm + ' ', 1);
    drawCaret(caretX, hy, chatDropdownOpen, '#7dd069');   // '^' open, same caret flipped for closed
    chatNameHit = { x0: nmX - 2, y0: hy - 2, x1: caretX + 8, y1: hy + 8 };
    // stance, quietly, at the right
    drawText(ctx, c.stance.toUpperCase(), x + w - textWidth(c.stance, 1) - 6, hy, '#5a5f6c');
    ctx.fillStyle = '#171a22';
    ctx.fillRect(x + 4, hy + 8, w - 8, 1);

    // history (clipped, scrollable) — build wrapped lines with speaker color
    const bodyTop = hy + 11;
    const entryH = 13;
    const bodyBot = y + h - entryH - 3;
    const maxChars = Math.max(20, Math.floor((w - 16) / 4));
    const lines = [];
    if (!c.log.length) {
        lines.push({ text: 'a stray thought drifts into their', col: '#5a5f6c' });
        lines.push({ text: 'head... whisper something.', col: '#5a5f6c' });
    }
    for (const e of c.log) {
        const isVoice = e.who === 'voice';
        const col = isVoice ? '#c8b060' : (VERDICT_COL[e.verdict] || '#c8ccd8');
        const prefix = isVoice ? '> ' : '  ';
        const glyph = (!isVoice && e.verdict && VERDICT_GLYPH[e.verdict]) ? ' ' + VERDICT_GLYPH[e.verdict] : '';
        const wrapped = wrapLine(prefix + e.text + glyph, maxChars);
        wrapped.forEach((ln, i) => lines.push({ text: (i === 0 ? ln : '  ' + ln), col }));
    }
    if (chatThinking) lines.push({ text: '  ' + '.'.repeat(1 + (Math.floor(Date.now() / 300) % 3)), col: '#7dd069' });

    const lineH = 7;
    const viewH = bodyBot - bodyTop;
    const contentH = lines.length * lineH;
    const maxScroll = Math.max(0, contentH - viewH);
    // keep pinned to the newest unless the player has scrolled up
    if (chatScroll > maxScroll) chatScroll = maxScroll;
    chatScroll = Math.max(0, Math.min(chatScroll, maxScroll));
    chatViewport = { x, y, w, h, bodyTop, bodyBot, maxScroll };

    ctx.save();
    ctx.beginPath();
    ctx.rect(x + 1, bodyTop - 1, w - 2, viewH + 1);
    ctx.clip();
    let ly = bodyTop - Math.round(chatScroll) + Math.max(0, viewH - contentH);
    for (const ln of lines) {
        if (ly + lineH >= bodyTop && ly <= bodyBot) drawText(ctx, ln.text, x + 6, ly, ln.col);
        ly += lineH;
    }
    ctx.restore();

    // entry row
    const ey = y + h - entryH;
    ctx.fillStyle = chatFocused ? 'rgba(125,208,105,0.14)' : 'rgba(255,255,255,0.05)';
    ctx.fillRect(x + 4, ey, w - 8, entryH - 2);
    ctx.strokeStyle = chatFocused ? '#7dd069' : '#3a3f4c';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 4.5, ey + 0.5, w - 9, entryH - 3);
    const val = chatInputEl ? chatInputEl.value : '';
    const shown = val || (chatFocused ? '' : 'WHISPER A THOUGHT...');
    const caret = (chatFocused && Math.floor(Date.now() / 500) % 2 === 0) ? '_' : '';
    drawText(ctx, (val ? shown : (chatFocused ? caret : shown)) + (val ? caret : ''), x + 8, ey + 4, val ? '#e8ecf5' : '#5a5f6c');
    chatEntryRect = { x0: x + 4, y0: ey, x1: x + w - 4, y1: ey + entryH - 2 };
}

let chatNameHit = null;   // { x0,y0,x1,y1 } hit region for the header name/dropdown toggle

function drawChatDropdown(PX, PW, splitY) {
    chatDropRows = [];
    const rowH = 10;
    const list = rosterSorted();
    const maxRows = Math.min(list.length, Math.floor((splitY - 44) / rowH));
    const dw = 120;
    const dx = PX + 6;
    const dh = Math.min(list.length, maxRows) * rowH + 4;
    const dy = splitY + 12;
    ctx.fillStyle = '#0c0e14';
    ctx.fillRect(dx, dy, dw, dh);
    ctx.strokeStyle = '#7dd069';
    ctx.strokeRect(dx + 0.5, dy + 0.5, dw - 1, dh - 1);
    list.slice(0, maxRows).forEach((f, i) => {
        const ry = dy + 2 + i * rowH;
        if (f === chatFarmer) { ctx.fillStyle = 'rgba(125,208,105,0.18)'; ctx.fillRect(dx + 1, ry - 1, dw - 2, rowH); }
        drawText(ctx, f.sheet.name.split(' ')[0].slice(0, 14), dx + 4, ry + 1, f === chatFarmer ? '#7dd069' : '#c8ccd8');
        chatDropRows.push({ farmer: f, y0: ry - 1, y1: ry + rowH - 1, x0: dx, x1: dx + dw });
    });
}

// ---- the hidden DOM input: the real keystroke/IME/paste surface, mirrored onto the canvas ----

function ensureChatInput() {
    if (chatInputEl) return chatInputEl;
    const el = document.createElement('input');
    el.type = 'text';
    el.maxLength = 160;
    el.setAttribute('autocomplete', 'off');
    el.setAttribute('autocorrect', 'off');
    el.setAttribute('spellcheck', 'false');
    // invisible, but real — it captures focus, keys, IME and paste; we render its value ourselves.
    // invisible + click-through (we focus it programmatically from the canvas entry-row click, and
    // render its value ourselves) so it never intercepts pointer events meant for the game/canvas.
    el.style.cssText = 'position:fixed;left:50%;bottom:6%;transform:translateX(-50%);width:60%;height:22px;opacity:0;border:0;padding:0;margin:0;background:transparent;color:transparent;caret-color:transparent;pointer-events:none;z-index:5;';
    el.addEventListener('focus', () => { chatFocused = true; });
    el.addEventListener('blur', () => { chatFocused = false; });
    el.addEventListener('keydown', (e) => {
        e.stopPropagation();   // never let the world shortcuts (W/F/T/arrows) see chat typing
        if (e.key === 'Enter') { e.preventDefault(); submitWhisper(); }
        else if (e.key === 'Escape') { e.preventDefault(); el.blur(); }
    });
    document.body.appendChild(el);
    chatInputEl = el;
    return el;
}

function focusChatInput() { ensureChatInput().focus(); }
function blurChatInput() { if (chatInputEl) chatInputEl.blur(); }

async function submitWhisper() {
    const f = activeChatFarmer();
    const el = chatInputEl;
    if (!f || !el) return;
    const text = el.value.trim();
    if (!text || chatThinking) return;
    el.value = '';
    chatThinking = true;
    chatScroll = 0;   // snap to newest
    try {
        await whisper(world, f, text, () => { if (world) saveTown(world); });
    } catch (err) {
        console.warn('ry-farms: whisper failed', err);
    } finally {
        chatThinking = false;
        chatScroll = 0;
    }
}

// ---------------------------------------------------------------------------
// Town chronicle — the settlement's lasting saga (big beats, grouped by day).
// Town-wide by default; with a farmer selected it narrows to THEIR personal story.
// ---------------------------------------------------------------------------
let chronRows = [];               // { e, y0, y1, farmerSeed } visible hit regions
let chronView = null;             // { x, y, w, h, bodyTop, bodyBot, maxScroll }
let chronTownWide = false;        // force the town-wide chronicle even when a farmer is in focus
let chronScopeHits = null;        // { town, farmer } toggle-chip rects (game px)
let chronTab = 0;                 // 0 NEWS (the event log/saga), 1 ROLES (civic band), 2 RECIPES (discoveries)
let chronTabHits = null;          // [{ x, y, w, h, tab }] tab-chip rects (game px)
const CHRON_TABS = ['NEWS', 'ROLES', 'RECIPES', 'TALES'];
const CHRON_ACCENT = '#c8a0e0';

// The farmer whose SAGA the chronicle is showing (or null for town-wide). Follows the camera focus
// (the farmer you're trailing, else the open card), unless the player toggled to TOWN-WIDE. So
// unfollowing (F) drops back to the town view, and the TOWN/name chips flip it explicitly.
function chronFocusFarmer() {
    if (chronTownWide) return null;
    const f = (followTarget && world.farmers.includes(followTarget)) ? followTarget : selected;
    return (f && world.farmers.includes(f)) ? f : null;
}

function chronEntries() {
    const cf = chronFocusFarmer();
    const sel = cf ? cf.sheet.seed : null;
    const all = world.chronicle;
    return sel != null ? all.filter(e => e.whoSeed === sel || e.otherSeed === sel) : all;
}

// The TOWN HALL band folded into the top of the chronicle: the Manager + their standing, the day's
// directive, and how the town answered it (rallied count + a couple of refusal reasons — the audit
// trail the council asked for). Returns the pixel height drawn (0 if there's no seated Manager).
function drawCivicBand(PX, y, PW) {
    const roles = world.roles, m = world.managerFarmer && world.managerFarmer();
    if (!roles || !m) return 0;
    const IX = PX + 8, RX = PX + PW - 8;
    let ty = y + 1;
    // manager + approval meter
    drawText(ctx, 'MANAGER', IX, ty, '#9a7fc0');
    drawText(ctx, m.sheet.name.split(' ')[0].toUpperCase(), IX + textWidth('MANAGER '), ty, '#e8c860');
    const barW = 46, bx = RX - barW, ap = Math.max(0, Math.min(1, roles.approval));
    drawText(ctx, 'APPROVAL', bx - textWidth('APPROVAL '), ty, '#6a6f7c');
    ctx.fillStyle = '#171a22'; ctx.fillRect(bx, ty, barW, 4);
    ctx.fillStyle = ap > 0.5 ? '#7dd069' : ap > 0.28 ? '#e0a03c' : '#e05040'; ctx.fillRect(bx, ty, Math.round(barW * ap), 4);
    ty += 8;
    // the day's directive
    const dir = roles.directive;
    const call = dir ? dir.text : 'The Manager has no call today.';
    for (const ln of wrapText(call, Math.floor((PW - 24) / 4.2)).slice(0, 2)) { drawText(ctx, ln, IX, ty, '#c8ccd8'); ty += 7; }
    // how the town answered
    if (dir) {
        const heeded = dir.heeders.size;
        drawText(ctx, `RALLIED: ${heeded}`, IX, ty, heeded > 0 ? '#7dd069' : '#6a6f7c');
        const whys = [...dir.refusers.entries()].slice(0, 2).map(([seed, why]) => {
            const f = world.farmers.find(x => x.sheet.seed === seed);
            return f ? `${f.sheet.name.split(' ')[0]}: ${why}` : null;
        }).filter(Boolean);
        if (whys.length) {
            const txt = 'PASSED - ' + whys.join('  -  ');
            drawText(ctx, txt.slice(0, Math.floor((PW - 24) / 4.2 - 12)), IX + textWidth(`RALLIED: ${heeded}  `), ty, '#8a8f9c');
        }
        ty += 8;
    }
    // the Watch (#94 P2), if one is seated: name + their standing with the town
    const wch = world.watchFarmer && world.watchFarmer();
    if (wch) {
        drawText(ctx, 'WATCH', IX, ty, '#9a7fc0');
        drawText(ctx, wch.sheet.name.split(' ')[0].toUpperCase(), IX + textWidth('WATCH '), ty, '#e8c860');
        const wa = Math.max(0, Math.min(1, roles.watchApproval));
        const wbW = 46, wbx = RX - wbW;
        drawText(ctx, 'TRUST', wbx - textWidth('TRUST '), ty, '#6a6f7c');
        ctx.fillStyle = '#171a22'; ctx.fillRect(wbx, ty, wbW, 4);
        ctx.fillStyle = wa > 0.5 ? '#7dd069' : wa > 0.28 ? '#e0a03c' : '#e05040'; ctx.fillRect(wbx, ty, Math.round(wbW * wa), 4);
        ty += 8;
    }
    // the Healer (#97 Slice 1), if one is seated: name + standing, and a herb-call flag when low
    const hlr = world.healerFarmer && world.healerFarmer();
    if (hlr) {
        drawText(ctx, 'HEALER', IX, ty, '#9a7fc0');
        drawText(ctx, hlr.sheet.name.split(' ')[0].toUpperCase(), IX + textWidth('HEALER '), ty, '#e8c860');
        if (roles.healerNeedsHerbs) drawText(ctx, 'NEEDS HERBS', IX + textWidth('HEALER ') + textWidth(hlr.sheet.name.split(' ')[0].toUpperCase() + '  '), ty, '#e0a03c');
        const ha = Math.max(0, Math.min(1, roles.healerApproval));
        const hbW = 46, hbx = RX - hbW;
        drawText(ctx, 'TRUST', hbx - textWidth('TRUST '), ty, '#6a6f7c');
        ctx.fillStyle = '#171a22'; ctx.fillRect(hbx, ty, hbW, 4);
        ctx.fillStyle = ha > 0.5 ? '#7dd069' : ha > 0.28 ? '#e0a03c' : '#e05040'; ctx.fillRect(hbx, ty, Math.round(hbW * ha), 4);
        ty += 8;
    }
    ctx.fillStyle = '#171a22'; ctx.fillRect(PX + 4, ty, PW - 8, 1);
    return ty - y + 2;
}

// ROLES tab (#94): the town's civic offices — Manager + directive, Watch + trust, Healer + trust.
// Reuses the civic band; a clear empty-state before a town has grown enough to seat a chair.
const END_REASON_LABEL = {
    'voted-out': 'voted out', recalled: 'recalled', 'stepped-aside': 'stepped aside',
    elected: 'elected', reelected: 're-elected',
};
function drawChronicleRoles(PX, top, PW, bot) {
    const IX = PX + 8;
    const h = drawCivicBand(PX, top + 2, PW);
    if (!h) { drawText(ctx, 'No offices seated yet — the town is still finding its feet.', IX, top + 4, '#6a6f7c'); return; }
    let y = top + 2 + h + 2;
    const roles = world.roles;

    // #94 P3: this winter's vote, while it's live (nominations -> campaign -> tally)
    const el = roles.election;
    if (el && el.year === world.year + 1) {
        drawText(ctx, `THIS WINTER'S VOTE - YEAR ${el.year}`, IX, y, '#c8a860'); y += 9;
        const nameOf = s => { const f = world.farmers.find(x => x.sheet.seed === s); return f ? f.sheet.name.split(' ')[0] : '?'; };
        const cands = (el.mgrCands || []).map(nameOf).join(', ');
        const status = el.phase === 'tallied'
            ? `The town chose ${el.result ? nameOf(el.result.manager) : '?'} to lead.`
            : `Standing for Manager: ${cands}. The town is deciding.`;
        for (const ln of wrapText(status, Math.floor((PW - 24) / 4.2))) { drawText(ctx, ln, IX + 4, y, '#9aa0b4'); y += 7; }
        y += 3;
    }

    // #94 P3: the town's remembered roll of past office-holders — who served, how long, how it ended
    const hist = roles.history;
    if (hist && hist.length) {
        drawText(ctx, 'PAST OFFICES', IX, y, CHRON_ACCENT); y += 9;
        for (let i = hist.length - 1; i >= 0 && y < bot - 8; i--) {
            const rec = hist[i];
            const first = String(rec.name || '?').split(' ')[0].toUpperCase();
            drawText(ctx, rec.office === 'manager' ? 'MANAGER' : 'WATCH', IX + 4, y, '#9a7fc0');
            drawText(ctx, first, IX + 4 + textWidth('MANAGER '), y, '#e8c860');
            const span = rec.fromYear === rec.toYear ? `Y${rec.fromYear}` : `Y${rec.fromYear}-${rec.toYear}`;
            const tail = `${span} - ${END_REASON_LABEL[rec.endReason] || rec.endReason}`;
            drawText(ctx, tail, PX + PW - 8 - textWidth(tail), y, '#8a8f9c'); y += 7;
            if (rec.why) { for (const ln of wrapText(rec.why, Math.floor((PW - 40) / 4.2))) { drawText(ctx, ln, IX + 10, y, '#6a6f7c'); y += 7; } }
            y += 2;
        }
    } else {
        drawText(ctx, 'The town has held no elections yet — the first comes at winter\'s end.', IX, y, '#6a6f7c');
    }
}

// The elements a recipe is made from, e.g. "2 GRASS + 1 FLOWER" — reads as a formula, not just a name.
// Routes through the registry so GENERATIVE recipes (their canonical example inputs) show too, not just base.
function recipeInputs(id) {
    const r = world.recipeById ? world.recipeById(id) : RECIPE_BY_ID[id];
    if (!r || !r.inputs) return '';
    return Object.entries(r.inputs).map(([g, q]) => `${q} ${g}`).join(' + ').toUpperCase();
}

// RECIPES tab (#97 P6): the town's inventions — each generative discovery shown with its LLM-given name +
// lore, its ingredients, who first worked it out, and who knows it; plus the TALES the town tells of the
// rare ingredients (grown from its memories) and whether they've been proven real.
function drawChronicleRecipes(PX, top, PW, bot) {
    const IX = PX + 8, INGR = '#8ad0a0';
    const maxChars = Math.max(24, Math.floor((PW - 24) / 4.2));
    const known = new Map(), heard = new Map();
    for (const f of world.farmers) {
        for (const id of (f.sheet.recipes || [])) { if (!known.has(id)) known.set(id, []); known.get(id).push(f.sheet.name.split(' ')[0]); }
        for (const id of (f.sheet.heardOf || [])) heard.set(id, (heard.get(id) || 0) + 1);
    }
    // build the FULL content as scrollable rows { h, draw:(y) } so the whole list can be scrolled, not capped
    const rows = [];
    const push = (h, draw) => rows.push({ h, draw: draw || (() => {}) });
    const wrapPush = (text, col, dx) => { for (const ln of wrapText(text, maxChars)) push(7, y => drawText(ctx, ln, IX + dx, y, col)); };

    push(8, y => drawText(ctx, 'EVERYONE KNOWS', IX, y, '#8a8f9c'));
    for (const id of ['soup', 'salve', 'tonic']) {
        const nm = RECIPE_BY_ID[id].name, inp = recipeInputs(id);
        push(7, y => { drawText(ctx, nm, IX + 4, y, '#7dd069'); drawText(ctx, inp, IX + 4 + 66, y, INGR); });
    }
    push(3);

    // discovered recipes — rarest/most-potent first, ALL of them (scrollable)
    push(10, y => { drawText(ctx, 'INVENTED', IX, y, CHRON_ACCENT); const t = `${known.size}`; drawText(ctx, t, PX + PW - 8 - textWidth(t), y, '#9aa0b4'); });
    if (!known.size) push(7, y => drawText(ctx, 'The town has invented nothing yet — give it time.', IX, y, '#6a6f7c'));
    else for (const [id, names] of [...known.entries()].sort((a, b) => ((world.recipeById(b[0])?.tier || 0) - (world.recipeById(a[0])?.tier || 0)))) {
        const nm = world.recipeName ? world.recipeName(id) : ((RECIPE_BY_ID[id] || {}).name || id);
        const inp = recipeInputs(id);
        push(7, y => { drawText(ctx, nm, IX, y, '#ffd24a'); drawText(ctx, inp, IX + 108, y, INGR); });
        const lore = world.recipeLore ? world.recipeLore(id) : null;
        if (lore) wrapPush(lore, '#9a86c0', 4);
        const rec = world.recipes && world.recipes[id];
        const inv = rec && rec.discovererSeed != null ? (world.farmers.find(f => f.sheet.seed === rec.discovererSeed)?.sheet.name.split(' ')[0]) : null;
        const h = heard.get(id) || 0;
        wrapPush((inv ? `invented by ${inv} - ` : '') + 'known by ' + names.join(', ') + (h ? `  (${h} have heard)` : ''), '#8a8f9c', 4);
        push(3);
    }

    chronScrollBody(rows, PX, top, PW, bot);
}

// #99 TALES — its own Chronicle tab (was folded into RECIPES). The town's myths of rare ingredients,
// grown from its memories, and whether they've been proven real.
function drawChronicleTales(PX, top, PW, bot) {
    const IX = PX + 8;
    const maxChars = Math.max(24, Math.floor((PW - 24) / 4.2));
    const rows = [];
    const push = (h, draw) => rows.push({ h, draw: draw || (() => {}) });
    const wrapPush = (text, col, dx) => { for (const ln of wrapText(text, maxChars)) push(7, y => drawText(ctx, ln, IX + dx, y, col)); };

    push(9, y => drawText(ctx, 'TALES OF THE WILDS', IX, y, '#c8a860'));
    push(7, y => drawText(ctx, 'Rumours of rare ingredients, grown from the town\'s own memories.', IX, y, '#6a6f7c'));
    push(3);
    if (!(world.tales || []).length) push(7, y => drawText(ctx, 'No tales have taken root yet.', IX, y, '#6a6f7c'));
    for (const t of (world.tales || [])) {
        const lore = world.taleLore ? world.taleLore(t) : null;
        const nm = (lore && lore.name) || (RARE_NAME && RARE_NAME[t.ingredient]) || t.ingredient;
        const proven = lore ? lore.validated : world.farmers.some(f => f.sheet.rareBelief && f.sheet.rareBelief[t.ingredient] && f.sheet.rareBelief[t.ingredient].state === 'validated');
        const status = proven ? 'PROVEN REAL' : 'STILL A TALE';
        push(8, y => { drawText(ctx, nm.toUpperCase(), IX + 4, y, proven ? '#7dd069' : '#c8a860'); drawText(ctx, status, PX + PW - 8 - textWidth(status), y, proven ? '#7dd069' : '#6a6f7c'); });
        if (lore) {
            wrapPush(`"${lore.saying}"`, '#b6a6d8', 8);            // the rumour, in the town's words (purple)
            wrapPush(lore.origin, '#eef0f4', 8);                   // who first carried it + which memory (white)
            wrapPush(lore.belief, proven ? '#7dd069' : '#7a8194', 8);
        } else {
            wrapPush(t.originTitle ? `a tale from "${String(t.originTitle).slice(0, 34)}"` : "a traveller's tale", '#6a6f7c', 8);
        }
        push(4);
    }
    chronScrollBody(rows, PX, top, PW, bot);
}

// shared scroll+clip+scrollbar body for the RECIPES/TALES tabs (both build scrollable `rows`)
function chronScrollBody(rows, PX, top, PW, bot) {
    let contentH = 0; for (const r of rows) contentH += r.h;
    const viewH = bot - top;
    const maxScroll = Math.max(0, contentH - viewH);
    chronScroll = Math.max(0, Math.min(chronScroll, maxScroll));
    chronView = { x: PX, y: top, w: PW, h: viewH, bodyTop: top, bodyBot: bot, maxScroll };
    ctx.save(); ctx.beginPath(); ctx.rect(PX + 1, top - 1, PW - 2, viewH + 2); ctx.clip();
    let y = top + 2 - Math.round(chronScroll);
    for (const r of rows) { if (y + r.h > top && y < bot) r.draw(y); y += r.h; }
    ctx.restore();
    if (maxScroll > 0) {
        const trackH = viewH, thumbH = Math.max(12, trackH * viewH / contentH), thumbY = top + (trackH - thumbH) * (chronScroll / maxScroll);
        ctx.fillStyle = '#2a2f3a'; ctx.fillRect(PX + PW - 3, top, 2, trackH);
        ctx.fillStyle = '#5a6070'; ctx.fillRect(PX + PW - 3, Math.round(thumbY), 2, Math.round(thumbH));
    }
}

function drawChronicle() {
    chronReadTotal = world._chronTotal || 0;   // reading the chronicle marks all current beats read (clears the badge)
    const PW = Math.min(GW - 12, 372);
    const PH = GH - 40;
    const PX = Math.floor((GW - PW) / 2);
    const PY = 22;
    chronRows = [];

    // dim behind, then the shared wood frame (matches the Board + character sheet)
    ctx.fillStyle = 'rgba(6,7,11,0.72)';
    ctx.fillRect(0, 18, GW, GH - 18);
    uiPanel(PX, PY, PW, PH);

    // header — the panel title reflects the active tab (NEWS can narrow to one Ry's saga)
    const cf = chronTab === 0 ? chronFocusFarmer() : null;
    const title = chronTab === 1 ? 'TOWN ROLES' : chronTab === 2 ? 'TOWN RECIPES' : chronTab === 3 ? 'TALES OF THE WILDS'
        : cf ? `SAGA OF ${cf.sheet.name.split(' ')[0].toUpperCase()}` : 'TOWN CHRONICLE';
    drawText(ctx, title, PX + 7, PY + 5, CHRON_ACCENT, 1);
    const entries = chronEntries();
    drawText(ctx, 'X', PX + PW - 10, PY + 5, '#c8ccd8');
    // scope toggle (NEWS tab only): TOWN / <name> chips so there's always a way back to the town-wide
    // view (and into a saga). Only the active one is lit. Roles/Recipes are always town-wide.
    chronScopeHits = null;
    const scopeFarmer = (followTarget && world.farmers.includes(followTarget)) ? followTarget : selected;
    if (chronTab === 0 && scopeFarmer && world.farmers.includes(scopeFarmer)) {
        const nm = scopeFarmer.sheet.name.split(' ')[0].toUpperCase();
        const chip = (label, x, active) => {
            const w = textWidth(label) + 6;
            ctx.fillStyle = active ? 'rgba(200,160,224,0.22)' : 'rgba(255,255,255,0.05)';
            ctx.fillRect(x, PY + 3, w, 9);
            drawText(ctx, label, x + 3, PY + 5, active ? CHRON_ACCENT : '#8a8f9c');
            return { x, y: PY + 3, w, h: 9 };
        };
        const nmW = textWidth(nm) + 6;
        // keep the chips clear of the close-X hit zone (p.x > cv.x+cv.w-14): end them at -26 so the
        // top-right X always closes and never toggles saga scope by accident (Codex r13 #3).
        const townX = PX + PW - 26 - (textWidth('TOWN') + 6) - 3 - nmW;
        const townR = chip('TOWN', townX, chronTownWide);
        const farmR = chip(nm, townX + (textWidth('TOWN') + 6) + 3, !chronTownWide);
        chronScopeHits = { town: townR, farmer: farmR };
    }
    ctx.fillStyle = '#20242f';
    ctx.fillRect(PX + 4, PY + 15, PW - 8, 1);

    // TAB BAR — NEWS / ROLES / RECIPES. Splitting the (growing) town view into swappable tabs keeps
    // each readable: the story log, the civic offices, and what the town has invented.
    chronTabHits = [];
    let tabX = PX + 8;
    for (let i = 0; i < CHRON_TABS.length; i++) {
        const label = CHRON_TABS[i], tw = textWidth(label) + 8, active = chronTab === i;
        ctx.fillStyle = active ? 'rgba(200,160,224,0.22)' : 'rgba(255,255,255,0.05)';
        ctx.fillRect(tabX, PY + 18, tw, 10);
        drawText(ctx, label, tabX + 4, PY + 20, active ? CHRON_ACCENT : '#8a8f9c');
        chronTabHits.push({ x: tabX, y: PY + 18, w: tw, h: 10, tab: i });
        tabX += tw + 4;
    }
    ctx.fillStyle = '#20242f';
    ctx.fillRect(PX + 4, PY + 30, PW - 8, 1);

    const bodyTop = PY + 33;
    const bodyBot = PY + PH - 11;

    // ROLES + RECIPES render their own (non-scrolling) bodies and return; NEWS falls through below.
    if (chronTab === 1) { drawChronicleRoles(PX, bodyTop, PW, bodyBot); return; }
    if (chronTab === 2) { drawChronicleRecipes(PX, bodyTop, PW, bodyBot); return; }
    if (chronTab === 3) { drawChronicleTales(PX, bodyTop, PW, bodyBot); return; }
    const viewH = bodyBot - bodyTop;
    const IX = PX + 8;
    const maxChars = Math.max(30, Math.floor((PW - 30) / 4.2));
    const H_DAY = 12, H_LINE = 7, GAP_ENTRY = 2;

    // flat render list: newest day first; entries ascending WITHIN each day
    const items = [];
    if (!entries.length) items.push({ type: 'empty' });
    else {
        const days = [], seen = new Set();
        for (let k = entries.length - 1; k >= 0; k--) { const d = entries[k].day; if (!seen.has(d)) { seen.add(d); days.push(d); } }
        for (const d of days) {
            const dayEntries = entries.filter(e => e.day === d);
            items.push({ type: 'day', day: d, season: dayEntries[0].season });
            for (const e of dayEntries) {
                const wrapped = wrapText(e.text, maxChars);
                wrapped.forEach((ln, li) => items.push({ type: 'entry', e, line: ln, first: li === 0, last: li === wrapped.length - 1 }));
            }
        }
    }

    // content height (for scroll clamp)
    let contentH = 0;
    for (const it of items) {
        if (it.type === 'day') contentH += H_DAY;
        else { contentH += H_LINE; if (it.last) contentH += GAP_ENTRY; }
    }
    const maxScroll = Math.max(0, contentH - viewH);
    chronScroll = Math.max(0, Math.min(chronScroll, maxScroll));
    chronView = { x: PX, y: PY, w: PW, h: PH, bodyTop, bodyBot, maxScroll };

    ctx.save();
    ctx.beginPath();
    ctx.rect(PX + 1, bodyTop - 1, PW - 2, viewH + 2);
    ctx.clip();
    let y = bodyTop - Math.round(chronScroll);
    for (const it of items) {
        const vis = y + H_LINE > bodyTop && y < bodyBot;
        if (it.type === 'day') {
            if (y + H_DAY > bodyTop && y < bodyBot) {
                drawText(ctx, `DAY ${it.day}`, IX, y + 3, '#e8ecf5');
                const sd = SEASONS[it.season];
                if (sd) drawText(ctx, sd.name, IX + 42, y + 3, sd.accent);
                ctx.fillStyle = '#20242f'; ctx.fillRect(IX, y + H_DAY - 2, PW - 16, 1);
            }
            y += H_DAY;
        } else if (it.type === 'entry') {
            if (vis) {
                if (it.first) { ctx.fillStyle = it.e.color; ctx.fillRect(IX + 1, y + 2, 2, 2); }
                drawText(ctx, it.line, IX + 7, y, it.e.color);   // wrapped lines keep the beat's own colour (not dimmed)
                if (it.first) chronRows.push({ e: it.e, y0: y, y1: y + H_LINE, farmerSeed: it.e.whoSeed });
                else if (chronRows.length) chronRows[chronRows.length - 1].y1 = y + H_LINE;
            }
            y += H_LINE;
            if (it.last) y += GAP_ENTRY;
        } else {
            drawText(ctx, selected ? 'No chronicle beats for this Ry yet.' : "The story is just beginning...", IX, y, '#6a6f7c');
            y += H_LINE;
        }
    }
    ctx.restore();

    // scrollbar
    if (maxScroll > 0) {
        const thumbH = Math.max(8, viewH * viewH / contentH);
        const thumbY = bodyTop + (viewH - thumbH) * (chronScroll / maxScroll);
        ctx.fillStyle = 'rgba(255,255,255,0.14)';
        ctx.fillRect(PX + PW - 3, bodyTop, 2, viewH);
        ctx.fillStyle = CHRON_ACCENT;
        ctx.fillRect(PX + PW - 3, Math.floor(thumbY), 2, Math.floor(thumbH));
    }

    drawText(ctx, selected ? "ONE RY'S STORY - CLICK A RY IN THE WORLD TO SWITCH" : 'CLICK A BEAT TO FOLLOW THAT RY - SCROLL FOR MORE', PX + 6, PY + PH - 8, '#4a4f5c');
}

// End-of-day RECAP card REMOVED — the day's beats now surface live through the Moments/callout banners and
// persist in the Town Chronicle, so a per-rollover pop-up was redundant. (The "PREVIOUSLY ON" catch-up card
// shown once on RESUME is a separate thing and stays — see drawResumeCard.) RECAP_CARD is kept as a zeroed
// stub because the callout/cursor code reads its .w to know a card is up; it now simply never becomes non-zero.

// ---------------------------------------------------------------------------
// #98 MOMENTS — the celebration/legibility layer. Watches the chronicle for the profound beats (entries
// tagged tier:'grand') and spotlights them: a dim backdrop, a card that SHOWCASES the farmer + the thing
// that happened + WHY (the compiled memory behind it), and a musical sting. Display-only: reads the sim's
// event stream, never writes it. Same events model as the recap (which slices the chronicle by day).
// ---------------------------------------------------------------------------
const seenMoments = new WeakSet();
let momentsPrimed = false;
const momentQueue = [];               // pending grand moments (FIFO)
let activeMoment = null;              // { e, shownAt }
let MOMENT_MS = 4600;   // grand spotlight duration (let, so RYFARMS.momentMs() can hold it open for QA)
const RARE_GEM = { crystal: '#8fd8ff', relic: '#f0d060', emberbloom: '#ff7a4a' };
const MOMENT_LABEL = { find: 'OUT PAST THE FOG', discovery: 'A DISCOVERY', town: 'THE TOWN DECIDES',
    project: 'THE TOWN BUILDS', dream: 'A DREAM FULFILLED', rift: 'A HARD DAY', season: 'THE SEASON TURNS' };
const MOMENTS_HIT = { x: 0, y: 0, w: 0, h: 0 };

function scanMoments() {
    const ch = world.chronicle;
    if (!momentsPrimed) {   // on load, mark existing history seen so only NEW beats spotlight (no backlog flood)
        for (const e of ch) seenMoments.add(e);
        momentsPrimed = true; return;
    }
    // new entries are appended, so the unseen ones form a contiguous tail — scan back until a seen one
    const fresh = [];
    for (let i = ch.length - 1; i >= 0; i--) { const e = ch[i]; if (seenMoments.has(e)) break; seenMoments.add(e); fresh.push(e); }
    for (let i = fresh.length - 1; i >= 0; i--) {
        const e = fresh[i];
        if (e.tier === 'grand') momentQueue.push(e);
        else if (e.tier === 'callout') calloutQueue.push(e);   // shown one-at-a-time by drawCallouts
    }
    if (calloutQueue.length > 6) calloutQueue.splice(0, calloutQueue.length - 6);   // drop the stale backlog
}

// callout tier — a SINGLE lighter toast at a time (never a stack): show the front of the queue briefly,
// then move to the next. Short-lived by design so beats flash past rather than piling up.
const calloutQueue = [];      // chronicle entries waiting to flash
let activeCallout = null;     // { e, shownAt }
let CALLOUT_MS = 1900;        // short: appears and vanishes quickly (let, so RYFARMS.calloutMs() can hold for QA)
function drawCallouts() {
    const nowMs = performance.now();
    if (activeCallout && nowMs - activeCallout.shownAt > CALLOUT_MS) activeCallout = null;
    if (!activeCallout && calloutQueue.length) {
        activeCallout = { e: calloutQueue.shift(), shownAt: nowMs };
        try { audio.moment('neutral'); } catch { /* not ready */ }
    }
    if (!activeCallout) return;
    const y = (RECAP_CARD.w ? RECAP_CARD.y + RECAP_CARD.h + 4 : 22);
    {
        const c = activeCallout;
        const age = nowMs - c.shownAt;
        const fade = Math.min(1, age / 140) * Math.min(1, (CALLOUT_MS - age) / 420);
        const accent = c.e.tone === 'somber' ? '#7a9ade' : c.e.tone === 'triumph' ? '#f0d060' : '#9ad0e0';
        const txt = c.e.text.toUpperCase();
        const w = Math.min(GW - 16, textWidth(txt) + 14), x = Math.floor((GW - w) / 2);
        ctx.save(); ctx.globalAlpha = fade;
        ctx.fillStyle = 'rgba(12,14,22,0.92)'; ctx.fillRect(x, y, w, 12);
        ctx.fillStyle = accent; ctx.fillRect(x, y, 2, 12);
        drawText(ctx, txt.slice(0, Math.floor((w - 10) / 4)), x + 6, y + 3, '#dfe4ee');
        ctx.restore();
    }
}

function drawGem(kind, cx, cy, r, tone) {
    const col = RARE_GEM[kind] || '#e0c060';
    ctx.save();
    // soft glow
    ctx.globalAlpha = 0.5; ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(cx, cy, r * 1.7, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    // faceted diamond
    ctx.beginPath(); ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r * 0.75, cy); ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r * 0.75, cy); ctx.closePath();
    ctx.fillStyle = col; ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';   // top-left highlight facet
    ctx.beginPath(); ctx.moveTo(cx, cy - r); ctx.lineTo(cx - r * 0.75, cy); ctx.lineTo(cx, cy); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.25)';          // bottom shade facet
    ctx.beginPath(); ctx.moveTo(cx, cy + r); ctx.lineTo(cx + r * 0.75, cy); ctx.lineTo(cx, cy); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.fillRect(Math.round(cx - r * 0.3), Math.round(cy - r * 0.35), 1, 1);   // sparkle
    ctx.restore();
}

function drawMoments() {
    if (rosterOpen || chronOpen || boardOpen || settingsOpen) { scanMoments(); return; }   // don't fight a full modal
    scanMoments();
    const nowMs = performance.now();
    if (!activeMoment && momentQueue.length) {
        const e = momentQueue.shift();
        activeMoment = { e, shownAt: nowMs };
        try { audio.moment(e.tone || 'triumph'); } catch { /* audio not ready */ }
    }
    MOMENTS_HIT.w = 0;
    drawCallouts();               // non-blocking toasts (a grand modal, if active, draws over them below)
    if (!activeMoment) return;
    const age = nowMs - activeMoment.shownAt;
    if (age > MOMENT_MS) { activeMoment = null; return; }
    const e = activeMoment.e;
    const fade = Math.min(1, age / 260) * Math.min(1, (MOMENT_MS - age) / 520);
    const pop = 0.86 + 0.14 * Math.min(1, age / 220);   // a small scale-in
    const accent = e.tone === 'somber' ? '#7a9ade' : e.tone === 'neutral' ? '#9ad0e0' : '#f0d060';

    ctx.save();
    ctx.globalAlpha = fade * 0.62; ctx.fillStyle = '#04050a'; ctx.fillRect(0, 18, GW, GH - 18);   // dim the world
    ctx.globalAlpha = fade;

    const PW = Math.round(224 * pop), PH = Math.round(104 * pop);
    const PX = Math.floor((GW - PW) / 2), PY = Math.floor((GH - PH) / 2) - 4;
    MOMENTS_HIT.x = 0; MOMENTS_HIT.y = 0; MOMENTS_HIT.w = GW; MOMENTS_HIT.h = GH;   // click anywhere dismisses
    ctx.fillStyle = 'rgba(12,14,22,0.97)'; ctx.fillRect(PX, PY, PW, PH);
    ctx.fillStyle = accent; ctx.fillRect(PX, PY, PW, 1); ctx.fillRect(PX, PY + PH - 1, PW, 1); ctx.fillRect(PX, PY, 1, PH); ctx.fillRect(PX + PW - 1, PY, 1, PH);

    // header label, centered (each grand beat names its own; falls back to a per-kind default)
    const label = e.label || MOMENT_LABEL[e.kind] || 'A MOMENT';
    drawText(ctx, label, PX + Math.floor((PW - textWidth(label)) / 2), PY + 5, accent, 1);
    ctx.fillStyle = '#2a2e3a'; ctx.fillRect(PX + 4, PY + 14, PW - 8, 1);

    // the FARMER showcase — a WALKING loop, scaled — in a left column, with the object below it in an
    // inventory-style beveled slot (kept clear of the text on the right). Town-wide beats have no farmer.
    const f = world.farmers.find(x => x.sheet.seed === e.whoSeed);
    const hasObject = e.icon && e.icon.indexOf('rare:') === 0;
    const hasLeft = !!f || hasObject;
    const colCX = PX + 38;
    if (f) {
        const fr = farmerSprites(f);
        const spr = (Math.floor(performance.now() / 1000 * 7) % 2) ? fr.walk1 : fr.walk2;   // 2-frame walk cycle
        const S = 2;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(spr, Math.round(colCX - spr.width * S / 2), Math.round(PY + 48 - spr.height * S / 2), spr.width * S, spr.height * S);
    }
    // the object in a beveled square slot (matches the inventory), glow clipped inside the frame
    if (hasObject) {
        const sz = 22, sx = colCX - sz / 2, sy = PY + 70;
        drawItemSlot(sx, sy, sz, null, null, { hi: true });
        ctx.save(); ctx.beginPath(); ctx.rect(sx + 1, sy + 1, sz - 2, sz - 2); ctx.clip();
        drawGem(e.icon.slice(5), sx + sz / 2, sy + sz / 2, 6, e.tone);
        ctx.restore();
    }

    // title (what happened) + the memory WHY — a right column beside the showcase, or full width if none
    const tx = hasLeft ? PX + 78 : PX + 10, tw = Math.floor((PX + PW - 10 - tx) / 4.2);
    let ty = PY + 22;
    for (const ln of wrapText(e.text.toUpperCase(), tw).slice(0, 3)) { drawText(ctx, ln, tx, ty, '#f4ead0'); ty += 8; }
    if (e.why) { ty += 2; for (const ln of wrapText(e.why, tw).slice(0, 4)) { drawText(ctx, ln, tx, ty, '#9a86c0'); ty += 7; } }

    drawText(ctx, 'CLICK TO CONTINUE', PX + PW - textWidth('CLICK TO CONTINUE') - 5, PY + PH - 8, '#5a5f6c');
    ctx.restore();
}

// "PREVIOUSLY ON RY FARMS" — the returning player's catch-up card (#88): the last few
// chronicle beats of the resumed town, held on screen until any click/key. This is also the
// story-emergence instrument: if this card is ever boring, the sim has told us something.
function drawResumeCard() {
    if (!resumeCard || !booted) return;
    const rc = resumeCard;
    if (!rc.shownAt) rc.shownAt = performance.now();
    const alpha = Math.min(1, (performance.now() - rc.shownAt) / 350);

    const lines = [];
    // only the FIRST wrapped line of a beat carries the bullet; continuation lines indent under the text so a
    // multi-line beat reads as ONE item, not several (see #99 chronicle bullet-wrap fix)
    for (const b of rc.beats) { const wr = wrapText(b.text, 42).slice(0, 2); wr.forEach((ln, k) => lines.push({ t: ln, c: b.color, head: k === 0 })); }

    const PW = 224, PX = Math.floor((GW - PW) / 2);
    const headH = 24, PH = headH + Math.max(1, lines.length) * 8 + 20;
    const PY = Math.floor((GH - PH) / 2) - 8;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(6,8,14,0.62)'; ctx.fillRect(0, 0, GW, GH);          // dim the town behind
    ctx.fillStyle = 'rgba(14,16,26,0.97)'; ctx.fillRect(PX, PY, PW, PH);
    ctx.fillStyle = '#e8c860'; ctx.fillRect(PX, PY, PW, 1); ctx.fillRect(PX, PY + PH - 1, PW, 1);
    ctx.fillRect(PX, PY, 1, PH); ctx.fillRect(PX + PW - 1, PY, 1, PH);

    drawText(ctx, `PREVIOUSLY ON ${(world.name || 'RY FARMS').toUpperCase()}`, PX + 6, PY + 6, '#f0d060', 1);
    const sd = SEASONS[rc.season];
    const sub = `DAY ${rc.day} - ${sd ? sd.name : ''} OF YEAR ${rc.year}`;
    drawText(ctx, sub, PX + 6, PY + 15, '#9ad0e0');
    ctx.fillStyle = '#2a2e3a'; ctx.fillRect(PX + 4, PY + 23, PW - 8, 1);

    let y = PY + headH + 3;
    if (!lines.length) drawText(ctx, 'THE TOWN WAITS, ITS STORY UNWRITTEN.', PX + 8, y, '#6a6f7c');
    else for (const ln of lines) { if (ln.head) { ctx.fillStyle = ln.c; ctx.fillRect(PX + 6, y + 2, 2, 2); } drawText(ctx, ln.t, PX + 11, y, ln.c); y += 8; }
    const cue = 'CLICK TO CONTINUE';
    drawText(ctx, cue, PX + Math.floor((PW - textWidth(cue)) / 2), PY + PH - 9, performance.now() % 1000 < 620 ? '#c8ccd8' : '#6a6f7c');
    ctx.restore();
}

// Autosave (#88): the town writes itself to IndexedDB at every day rollover, plus whenever the
// tab hides/closes. Fire-and-forget — a failed write never touches the sim (save.js swallows).
function maybeAutosave() {
    if (!booted || !world || world.day === lastSavedDay) return;
    lastSavedDay = world.day;                       // claim synchronously so a slow write can't double-fire
    saveTown(world).then(d => { if (d != null) saveFlashAt = performance.now(); });
    registerWorld(world);                           // #2.1 keep this town's summary current in the world index
}

// #2.1/#2.3/#2.4 — build this town's compact WORLD summary and merge it into the world index, then check
// whether growth has brought it into another town's reach (an encounter carries a creed between them, #2.4).
// Off the sim loop, best-effort. Runs once per day at rollover.
function townSummary(w) {
    // lineage EDGES: the towns this one descends from (heirs among the founders name their forebear's town)
    const anc = new Set();
    for (const f of w.farmers) { const ln = f.sheet.lineage; if (ln && ln.ofTownSeed != null) anc.add(String(ln.ofTownSeed)); }
    // a representative MOTTO — the creed most shared across the cast (what this town, collectively, lives by)
    const tally = new Map();
    for (const f of w.farmers) for (const c of (f.creeds || [])) { const q = c.quote; if (q) tally.set(q, (tally.get(q) || 0) + 1); }
    let motto = null, best = 0;
    for (const [q, n] of [...tally].sort((a, b) => (a[0] < b[0] ? -1 : 1))) if (n > best) { best = n; motto = q; }
    // memory FINGERPRINT -> tint: a stable hash of the cast's source memories (what the town was grown from)
    const fp = hashString('fp:' + w.farmers.map(f => (f.sheet.memory && f.sheet.memory.id) || f.sheet.seed).sort().join('|'));
    // #reconciliation ENVOY: who represents this town at a frontier meeting — its MOST CURIOUS member (the one
    // who'd approach), seed-tiebroken. Their honesty decides whether an overture they extend is genuine. Baked
    // into the summary because at resolve time the counterpart town isn't loaded (only its summary is).
    let envoy = null, es = -Infinity;
    for (const f of w.farmers) {
        const p = f.sheet.personality || {}, score = p.curiosity || 0;
        if (score > es || (score === es && envoy && f.sheet.seed < envoy.seed)) {
            es = score;
            envoy = { seed: f.sheet.seed, curiosity: +(p.curiosity || 0).toFixed(2), honesty: +(p.honesty || 0).toFixed(2), collaboration: +(p.collaboration || 0).toFixed(2) };
        }
    }
    return {
        seed: w.seed, name: w.name, day: w.day, year: w.year, pop: w.farmers.length,
        harvestTotal: w.harvestTotal || 0, lineage: [...anc], motto, fingerprint: fp >>> 0,
        culture: w.culture || 'human', lineageRoot: w.lineageRoot || String(w.seed), envoy, lastSeen: Date.now(),   // #3.2
    };
}
let _worldBusy = false;
async function registerWorld(w) {
    if (_worldBusy) return; _worldBusy = true;
    try {
        // Codex r20 P1: register THIS town + detect encounters + read its inbox in ONE atomic transaction, so a
        // second tab can't clobber the ledger/inbox. The mutator is synchronous (no awaits inside a live txn).
        let fresh = [], mine = [];
        const idx = await updateWorldIndex(index => {
            index.towns = index.towns || {}; index.encounters = index.encounters || []; index.ledgers = index.ledgers || {};
            const s = townSummary(w);
            const prev = index.towns[s.seed] || {};
            index.towns[s.seed] = { ...prev, ...s, firstSeen: prev.firstSeen || s.lastSeen || Date.now() };
            fresh = detectEncounters(index);                 // resolves raids/parleys, queues inbox
            mine = (index.inbox && index.inbox[String(w.seed)]) || [];
            return index;
        });
        if (!idx) return;
        for (const ev of fresh) if (w === world) world.addLog(encounterLine(ev), '#c8b0e0');   // surface on the town log
        if (mine.length && w === world) await consumeInbox(w, mine);
    } finally { _worldBusy = false; }
}

// #reconciliation exactly-once inbox consumption (Codex r20/r21). apply (idempotent) -> PERSIST the town -> and
// ONLY IF the save succeeded, remove EXACTLY the processed event ids (not the whole slice) atomically. Closes
// three windows r21 found: (P1) a swallowed saveTown failure that used to clear the inbox anyway -> event lost;
// (P1) a concurrent tab appending a new event that a whole-slice `= []` clear used to wipe; (P2) an all-duplicate
// inbox that never got acknowledged because the clear was gated on applyInbox's return count.
const inboxEventId = e => e.id || `${e.pairKey}:${e.ordinal}:${e.kind}`;
async function consumeInbox(w, events) {
    w.applyInbox(events);                          // idempotent: re-delivered events are skipped by applied-id
    const saved = await saveTown(w);               // persist applied effects + applied-ids BEFORE clearing
    if (saved == null) return;                     // save failed -> do NOT clear; the inbox replays next time
    const done = new Set(events.map(inboxEventId));
    await updateWorldIndex(index => {              // remove ONLY the ids we processed, keeping concurrent appends
        const box = index.inbox && index.inbox[String(w.seed)];
        if (box) index.inbox[String(w.seed)] = box.filter(e => !done.has(inboxEventId(e)));
        return index;
    });
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
    // #98 a grand Moment spotlight eats the next click (dismiss it, don't fall through to world/pan)
    if (activeMoment && MOMENTS_HIT.w) { activeMoment = null; mouse.panStart = null; return; }
    // settings volume sliders: press to grab, drag to set
    if (settingsOpen && settingsHits) {
        if (inRect(p, settingsHits.musicSlider)) { settingsDrag = 'music'; audio.setMusicVolume((p.x - settingsHits.musicSlider.x) / settingsHits.musicSlider.w); mouse.panStart = null; return; }
        if (inRect(p, settingsHits.sfxSlider)) { settingsDrag = 'sfx'; audio.setSfxVolume((p.x - settingsHits.sfxSlider.x) / settingsHits.sfxSlider.w); mouse.panStart = null; return; }
    }
    // don't world-pan when the gesture starts on the minimap, the detail card, or the board
    const onUI = !rosterOpen && !chronOpen && (inRect(p, MINIMAP) || (selected && inRect(p, SHEET_RECT)) || (boardOpen && inRect(p, BOARD_RECT)));
    mouse.panStart = (rosterOpen || chronOpen || settingsOpen || onUI) ? null : { x: p.x, y: p.y, camX: cam.x, camY: cam.y };
    mouse.dragging = false;
    try { out.setPointerCapture(e.pointerId); } catch { /* stale/synthetic pointer id — capture is best-effort */ }
});

out.addEventListener('pointermove', (e) => {
    const p = gamePoint(e);
    mouse.x = p.x; mouse.y = p.y;
    if (settingsDrag && settingsHits) {
        const s = settingsDrag === 'music' ? settingsHits.musicSlider : settingsHits.sfxSlider;
        if (s) { const v = (p.x - s.x) / s.w; settingsDrag === 'music' ? audio.setMusicVolume(v) : audio.setSfxVolume(v); }
        return;
    }
    if (mouse.panStart) {
        const dx = p.x - mouse.panStart.x, dy = p.y - mouse.panStart.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) { mouse.dragging = true; followMode = false; followTarget = null; }   // panning breaks follow
        if (mouse.dragging) {
            cam.x = mouse.panStart.camX + dx;
            cam.y = mouse.panStart.camY + dy;
        }
    }
});

function inRect(p, r) { return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h; }

out.addEventListener('pointerup', (e) => {
    const wasDrag = mouse.dragging;
    const wasSlider = settingsDrag;
    settingsDrag = null;
    mouse.panStart = null;
    mouse.dragging = false;
    if (wasSlider) return;   // finished dragging a volume slider — consume the release
    if (wasDrag || !booted) return;
    const p = gamePoint(e);

    // the "previously on" catch-up card swallows the first click (any click dismisses it)
    if (resumeCard) { resumeCard = null; return; }

    // sound quick-mute (stays on the top bar)
    if (inRect(p, SND_BTN)) { audio.ensure(); audio.toggle(); return; }
    // settings cog: open/close the menu (New Town + volume)
    if (SETTINGS_BTN.w && inRect(p, SETTINGS_BTN)) { audio.ensure(); settingsOpen = !settingsOpen; if (settingsOpen) { rosterOpen = chronOpen = boardOpen = false; blurChatInput(); } return; }
    // settings menu interactions
    if (settingsOpen && settingsHits) {
        if (inRect(p, settingsHits.close)) { settingsOpen = false; return; }
        if (inRect(p, settingsHits.music)) { audio.ensure(); audio.toggleMusic(); return; }
        if (inRect(p, settingsHits.sfx)) { audio.ensure(); audio.toggleSfx(); return; }
        if (inRect(p, settingsHits.musicSlider)) { audio.setMusicVolume((p.x - settingsHits.musicSlider.x) / settingsHits.musicSlider.w); return; }
        if (inRect(p, settingsHits.sfxSlider)) { audio.setSfxVolume((p.x - settingsHits.sfxSlider.x) / settingsHits.sfxSlider.w); return; }
        if (inRect(p, settingsHits.portalBtn)) { window.open('/memory-graph.html', '_blank', 'noopener'); return; }
        if (inRect(p, settingsHits.newBtn)) {
            // NEW TOWN: first click arms ("SURE?"), a second within 3s wipes the save + reloads fresh
            if (performance.now() < newConfirmUntil) { newConfirmUntil = 0; wipeTown(world.seed).finally(() => { location.href = location.pathname + '?fresh=1'; }); }
            else newConfirmUntil = performance.now() + 3000;
            return;
        }
        if (!inRect(p, settingsHits.panel)) { settingsOpen = false; return; }   // click outside closes
        return;   // click inside the panel, no-op
    }
    if (inRect(p, ROSTER_BTN)) { rosterOpen = !rosterOpen; if (rosterOpen) { boardOpen = false; chronOpen = false; } else { chatDropdownOpen = false; blurChatInput(); } return; }
    if (CHRON_BTN.w && inRect(p, CHRON_BTN)) { chronOpen = !chronOpen; if (chronOpen) { boardOpen = false; rosterOpen = false; chronScroll = 0; blurChatInput(); chronTownWide = !(followMode && followTarget && world.farmers.includes(followTarget)); } return; }
    if (WORLD_BTN.w && inRect(p, WORLD_BTN)) { if (worldMapOpen) worldMapOpen = false; else openWorldMap(); return; }

    // world-map overlay (modal): X / click-outside closes; a town node selects it; VISIT switches active town
    if (worldMapOpen) {
        const PW = Math.min(GW - 12, 380), PH = GH - 40, PX = Math.floor((GW - PW) / 2), PY = 22;
        if ((p.x > PX + PW - 14 && p.y < PY + 12) || p.x < PX || p.x > PX + PW || p.y < PY || p.y > PY + PH) { worldMapOpen = false; return; }
        if (worldMapVisit && inRect(p, worldMapVisit)) { location.search = '?seed=' + worldMapVisit.seed; return; }
        for (const h of worldMapHits) { const dx = p.x - h.x, dy = p.y - h.y; if (dx * dx + dy * dy <= (h.r + 2) * (h.r + 2)) { worldMapSel = h.seed; return; } }
        return;   // consume all clicks inside the map
    }

    // chronicle overlay (modal) — X or click-outside closes; a beat selects that Ry (its saga)
    if (chronOpen) {
        const cv = chronView;
        if (cv) {
            // tab bar: NEWS / ROLES / RECIPES
            if (chronTabHits) {
                for (const t of chronTabHits) if (inRect(p, t)) { chronTab = t.tab; chronScroll = 0; return; }
            }
            // scope toggle: TOWN switches to the town-wide view, the name chip back to the saga
            if (chronScopeHits) {
                if (inRect(p, chronScopeHits.town)) { chronTownWide = true; chronScroll = 0; return; }
                if (inRect(p, chronScopeHits.farmer)) { chronTownWide = false; chronScroll = 0; return; }
            }
            if ((p.x > cv.x + cv.w - 14 && p.y < cv.y + 12) ||
                p.x < cv.x || p.x > cv.x + cv.w || p.y < cv.y || p.y > cv.y + cv.h) { chronOpen = false; return; }
            for (const row of chronRows) {
                if (p.y >= row.y0 && p.y <= row.y1 && p.x > cv.x && p.x < cv.x + cv.w) {
                    const f = row.farmerSeed != null ? world.farmers.find(x => x.sheet.seed === row.farmerSeed) : null;
                    if (f) { selected = f; chronTownWide = false; sheetScroll = 0; chronScroll = 0; }   // narrow to that Ry's saga
                    return;
                }
            }
        }
        return;
    }

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

    // end-of-day recap card: click anywhere on it to dismiss
    if (RECAP_CARD.w && inRect(p, RECAP_CARD)) { recapShownAt = -1e9; return; }

    // roster overlay (modal) — handle before any world/minimap clicks
    if (rosterOpen) {
        const rv = rosterView;
        // the farmer-switch dropdown, when open, eats clicks first
        if (chatDropdownOpen) {
            for (const row of chatDropRows) {
                if (p.x >= row.x0 && p.x <= row.x1 && p.y >= row.y0 && p.y <= row.y1) {
                    chatFarmer = row.farmer; chatScroll = 0; chatDropdownOpen = false; return;
                }
            }
            chatDropdownOpen = false; return;   // clicking off the list just closes it
        }
        if (rv) {
            // close X / click well outside the panel
            if ((p.x > rv.x + rv.w - 14 && p.y < rv.y + 12) ||
                p.x < rv.x || p.x > rv.x + rv.w || p.y < rv.y || p.y > rv.y + rv.h) { rosterOpen = false; blurChatInput(); return; }
            // chat: header name toggles the switcher
            if (chatNameHit && p.x >= chatNameHit.x0 && p.x <= chatNameHit.x1 && p.y >= chatNameHit.y0 && p.y <= chatNameHit.y1) {
                chatDropdownOpen = !chatDropdownOpen; return;
            }
            // chat: entry row focuses the hidden input
            if (chatEntryRect && p.x >= chatEntryRect.x0 && p.x <= chatEntryRect.x1 && p.y >= chatEntryRect.y0 && p.y <= chatEntryRect.y1) {
                focusChatInput(); return;
            }
            // list rows (top half): open that farmer's detail sheet AND follow them, so picking a
            // name in the roster jumps the camera to that Ry (roster select + follow are one action)
            for (const row of rosterRows) {
                if (p.y >= row.y0 && p.y <= row.y1 && p.x > rv.x && p.x < rv.x + rv.w) {
                    selected = row.farmer; sheetScroll = 0; sheetTab = 0; rosterOpen = false; blurChatInput();
                    followMode = true; followTarget = row.farmer;
                    return;
                }
            }
            // a click elsewhere in the panel drops keyboard focus
            blurChatInput();
        }
        return;
    }

    // detail card: X closes it; clicks anywhere inside it are consumed. Checked BEFORE the
    // minimap because the full-height card is drawn OVER it (Codex: don't click through).
    if (selected && inRect(p, SHEET_FOLLOW)) {
        if (followMode && followTarget === selected) { followMode = false; followTarget = null; }
        else { followMode = true; followTarget = selected; }
        return;
    }
    // closing the card is just dismissing visual noise — it does NOT stop following (only F/Esc/pan do)
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
        followMode = false; followTarget = null;   // tapping the map = "show me elsewhere" — stop trailing the farmer
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
    if (rosterOpen) {
        e.preventDefault();
        // scroll the chat history when the pointer is over its viewport, else the roster list
        const cv = chatViewport;
        if (cv && mouse.y >= cv.bodyTop && mouse.y <= cv.y + cv.h) chatScroll += e.deltaY * 0.5;
        else rosterScroll += e.deltaY * 0.5;
        return;
    }
    if (chronOpen) { e.preventDefault(); chronScroll = Math.max(0, Math.min(chronView ? chronView.maxScroll : 0, chronScroll + e.deltaY * 0.5)); return; }
    if (boardOpen) { e.preventDefault(); boardScroll = Math.max(0, Math.min(boardMaxScroll, boardScroll + e.deltaY * 0.5)); return; }
    if (selected) { e.preventDefault(); sheetScroll = Math.max(0, Math.min(maxSheetScroll, sheetScroll + e.deltaY * 0.5)); }
}, { passive: false });

// T = snap the camera home to town (the plaza well). Plain T, not cmd+T — the browser
// owns cmd+T (new tab) and never lets the page see it.
// The most watch-worthy farmer right now: someone in a fight, fleeing, downed, rushing to help,
// or staking a claim outranks the routine — so 'jump to the action' lands on real drama.
// B4 — witnessable drama: watch the chronicle for a NEW dramatic beat and, if its farmer exists,
// remember them as the current spotlight so we can point the player at the action ('W' to watch).
function updateDramaSpotlight() {
    const ch = world.chronicle;
    if (lastChronLen < 0) { lastChronLen = ch.length; return; }   // ignore the pre-existing backlog on load
    for (let k = lastChronLen; k < ch.length; k++) {
        const b = ch[k];
        if (!DRAMA_KINDS[b.kind] || b.whoSeed == null) continue;
        if (world.farmers.some(x => x.sheet.seed === b.whoSeed))
            dramaSpotlight = { seed: b.whoSeed, kind: b.kind, label: DRAMA_KINDS[b.kind], t: performance.now() };
    }
    lastChronLen = ch.length;
}
function spotlightFarmer() {
    if (!dramaSpotlight || performance.now() - dramaSpotlight.t > 6500) return null;   // cue fades after ~6.5s
    return world.farmers.find(x => x.sheet.seed === dramaSpotlight.seed) || null;
}
// A pulsing arrow + label at the screen edge pointing to an OFF-SCREEN spotlight farmer, with a [W] hint.
// Never grabs the camera — the player chooses to look (observer identity).
function drawDramaCue() {
    const f = spotlightFarmer(); if (!f || (followMode && followTarget === f)) return;
    const fx = cam.x + isoX(f.pos.i, f.pos.j), fy = cam.y + isoY(f.pos.i, f.pos.j);
    const m = 16;
    if (fx > m && fx < GW - m && fy > 24 + m && fy < GH - m) return;   // already on-screen, no cue needed
    const cx = GW / 2, cy = GH / 2, dx = fx - cx, dy = fy - cy;
    const adx = Math.abs(dx) || 1e-6, ady = Math.abs(dy) || 1e-6;
    const sc = Math.min((GW / 2 - m) / adx, (GH / 2 - 24 - m) / ady);
    const ax = Math.round(cx + dx * sc), ay = Math.round(cy + dy * sc);
    const ang = Math.atan2(dy, dx), pulse = 0.55 + 0.45 * Math.sin(performance.now() / 170), s = 6;
    ctx.fillStyle = `rgba(240,200,80,${pulse})`;
    ctx.beginPath();
    ctx.moveTo(ax + Math.cos(ang) * s, ay + Math.sin(ang) * s);
    ctx.lineTo(ax + Math.cos(ang + 2.5) * s, ay + Math.sin(ang + 2.5) * s);
    ctx.lineTo(ax + Math.cos(ang - 2.5) * s, ay + Math.sin(ang - 2.5) * s);
    ctx.closePath(); ctx.fill();
    const label = `${dramaSpotlight.label} - W`, tw = textWidth(label);   // "- W" = press W to watch (font has no brackets)
    const lx = Math.max(4, Math.min(GW - tw - 4, ax - Math.cos(ang) * 10 - tw / 2));
    const ly = Math.max(26, Math.min(GH - 10, ay - Math.sin(ang) * 10 - 4));
    ctx.fillStyle = 'rgba(16,14,10,0.8)'; ctx.fillRect(Math.round(lx) - 2, Math.round(ly) - 1, tw + 4, 8);
    drawText(ctx, label, Math.round(lx), Math.round(ly), '#f0d060');
}
function mostInterestingFarmer() {
    if (!world) return null;
    const pri = { downed: 8, fight: 7, flee: 7, help: 5, care: 5, housebuild: 3, build: 3, coopbuild: 3, fencepost: 2, scarecrow: 2 };
    const spot = spotlightFarmer();
    let best = null, bs = -1;
    for (const f of world.farmers) {
        let s = pri[f.state] || 0;
        if (f.claim && !f.plot.sited) s = Math.max(s, 6);   // travelling out to stake a claim
        if (f.downed) s = Math.max(s, 8);
        if (f === spot) s = Math.max(s, 7.5);               // a fresh dramatic beat pulls the eye
        if (world.leader === f) s += 0.3;
        s += (f.sheet.seed % 97) / 1000;                    // stable tiebreak
        if (s > bs) { bs = s; best = f; }
    }
    return best;
}

window.addEventListener('keydown', (e) => {
    if (chatFocused) return;   // #93: typing a whisper — never fire world shortcuts (W/F/T/arrows)
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (resumeCard) { resumeCard = null; return; }   // any key dismisses the catch-up card
    if ((e.key === 't' || e.key === 'T') && world) {
        followMode = false; followTarget = null;
        cam.x = GW / 2 - isoX(world.well.i, world.well.j);
        cam.y = GH / 2 - isoY(world.well.i, world.well.j) - 20;
    }
    // F — follow: toggle trailing. When starting, follow the open card's farmer, else jump to the action.
    if ((e.key === 'f' || e.key === 'F') && world && booted) {
        if (followMode) { followMode = false; followTarget = null; if (chronOpen) chronTownWide = true; }   // unfollowing drops the chronicle back to town-wide
        else {
            const target = (selected && world.farmers.includes(selected)) ? selected : mostInterestingFarmer();
            if (target) { followMode = true; followTarget = target; selected = target; sheetScroll = 0; sheetTab = 0; rosterOpen = false; chronOpen = false; boardOpen = false; }
        }
    }
    // W — WATCH: jump to follow the current off-screen drama the cue is pointing at
    if ((e.key === 'w' || e.key === 'W') && world && booted) {
        const target = spotlightFarmer();
        if (target) { followMode = true; followTarget = target; selected = target; sheetScroll = 0; sheetTab = 0; rosterOpen = false; chronOpen = false; boardOpen = false; dramaSpotlight = null; }
    }
    // M — toggle the zoom-out WORLD map (the world of towns)
    if ((e.key === 'm' || e.key === 'M') && world && booted) {
        if (worldMapOpen) worldMapOpen = false; else openWorldMap();
    }
    // Esc — stop following AND close the card / any open panel (a clean sweep back to the map)
    if (e.key === 'Escape' && world && booted) {
        followMode = false; followTarget = null;
        selected = null; selectedSlotKey = null;
        rosterOpen = false; chronOpen = false; boardOpen = false; settingsOpen = false; worldMapOpen = false;
        chatDropdownOpen = false; blurChatInput();
    }
    // ← / → — cycle through the whole cast: moves the open card and/or the follow target together
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && world && booted) {
        const anchor = selected || followTarget, arr = world.farmers, idx = anchor ? arr.indexOf(anchor) : -1;
        if (arr.length && idx >= 0) {
            const next = arr[(idx + (e.key === 'ArrowRight' ? 1 : -1) + arr.length) % arr.length];
            if (selected) { selected = next; sheetScroll = 0; selectedSlotKey = null; }
            if (followMode) followTarget = next;
            rosterOpen = false; chronOpen = false; boardOpen = false;
            e.preventDefault();
        }
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

function spawnFarmer(lineage = null) {
    // addFarmer is the authority on room (it lazily opens ring 2 and collision-checks
    // slots) — don't pre-guard on free slots or ring 2 can never open.
    const pick = pickMemory();
    const f = world.addFarmer(pick.memory, pick.mutation, lineage);
    if (f) { terrainDirty = true; selected = f; }
    else world.addLog('No room left! The valley is full.', '#e0a03c');
}

// #1.1 Generational founding — deterministically decide which of the founding cast are HEIRS of a forebear
// a past town wrote back, and which forebear each carries. Blend, not echo: only a fraction (~1/3) inherit,
// capped by how many lives the store actually remembers, and a storeless/first world gets none. Given
// (worldSeed, pool) the plan is identical every run, so a live founding bakes into the save reproducibly and
// the headless harness (no pool) yields exactly the old cast — determinism intact.
function planHeirs(seed, count, pool) {
    const plan = new Map();
    if (!pool || !pool.length) return plan;
    const rand = mulberry32(hashString('heirs:' + (seed >>> 0)));
    const maxHeirs = Math.min(pool.length, Math.max(1, Math.round(count * 0.34)));
    // seeded stable order of forebears so the pairing doesn't depend on array order alone
    const order = pool.map((_, i) => i).sort((a, b) =>
        hashString('lin:' + seed + ':' + a) - hashString('lin:' + seed + ':' + b));
    let used = 0;
    for (let i = 0; i < count && used < maxHeirs; i++) {
        if (rand() < 0.5) plan.set(i, pool[order[used++]]);
    }
    if (used === 0) plan.set(0, pool[order[0]]);   // when a pool exists, at least one heir so the loop is always visible
    return plan;
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

    // camera: trail followTarget, easing toward centre (manual drag cancels — see pointermove)
    if (followMode && followTarget && world.farmers.includes(followTarget) && !mouse.dragging) {
        const tx = GW / 2 - isoX(followTarget.pos.i, followTarget.pos.j);
        const ty = GH / 2 - isoY(followTarget.pos.i, followTarget.pos.j) - 12;
        cam.x += (tx - cam.x) * 0.14; cam.y += (ty - cam.y) * 0.14;
    } else if (followMode && (!followTarget || !world.farmers.includes(followTarget))) {
        followMode = false; followTarget = null;   // nothing left to follow
    }

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
    maybeAutosave();
    // (end-of-day recap card removed — the Moments/callout banners + the chronicle carry the day's beats now;
    // the "PREVIOUSLY ON" catch-up card on RESUME is separate and stays, see drawResumeCard)
    drawMoments();   // #98: spotlight the profound beats on top of the HUD (still under the CRT shader)
    // a quiet indicator while the camera is trailing someone (F, or the sheet's crosshair, toggles it)
    if (followMode && followTarget && world.farmers.includes(followTarget) && !rosterOpen && !chronOpen && !boardOpen) {
        const lbl = `FOLLOWING ${followTarget.sheet.name.split(' ')[0].toUpperCase()} - F TO STOP`;
        // sit the plate near the bottom edge (the log bar is gone) as a floating element
        const tw = textWidth(lbl), bx = Math.floor((GW - tw) / 2), boxTop = GH - 16, cy = GH - 11;
        const pad = 12, bxL = bx - pad, bxW = tw + pad * 2;
        ctx.fillStyle = 'rgba(12,14,22,0.82)';   // legibility: dark plate behind the label (like the bars)
        ctx.fillRect(bxL, boxTop, bxW, 11);
        drawText(ctx, lbl, bx, boxTop + 3, '#7dd069');
        // ◄ / ► cycle affordances (3x5, matched to the font height), flanking the label inside the plate
        ctx.fillStyle = '#7dd069';
        for (let c = 0; c < 3; c++) ctx.fillRect(bxL + 4 + c, cy - c, 1, c * 2 + 1);              // ◄ tip points left
        for (let c = 0; c < 3; c++) ctx.fillRect(bxL + bxW - 5 - c, cy - c, 1, c * 2 + 1);        // ► tip points right
    }

    // building hover tooltip — only when hovering the world (not over a panel, not dragging,
    // and not while an inventory-slot tooltip is already showing on the open sheet)
    let worldHover = false;
    if (booted && mouse.x >= 0 && !mouse.dragging && !rosterOpen && !boardOpen && !chronOpen && !settingsOpen && mouse.y > 18 &&
        !(selected && inRect(mouse, SHEET_RECT)) && !inRect(mouse, MINIMAP)) {
        const info = buildingUnder(mouse.x, mouse.y);
        if (info) { drawInfoBox(mouse.x, mouse.y, info); worldHover = true; }
        else {   // a walking farmer under the cursor is clickable even without a tooltip
            const tile = screenToTile(mouse.x, mouse.y);
            worldHover = world.farmers.some(f => Math.hypot(f.pos.i - tile.i, f.pos.j - tile.j) < 1.6);
        }
    }

    // B4: nudge the player toward a fresh off-screen story beat (drawn above the world, below the cursor)
    updateDramaSpotlight();
    if (booted && !rosterOpen && !chronOpen && !boardOpen) drawDramaCue();

    drawResumeCard();   // the "previously on" catch-up card sits above every panel (only the cursor tops it)

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
        const tagline = memoryTagline();
        drawText(ctx, tagline, GW / 2 - textWidth(tagline) / 2, 140, '#9aa0b4');
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

    // PERSISTENCE (#88): a plain visit RESUMES the last-played town from IndexedDB — the town
    // remembers itself. ?seed=N resumes that seed's save (or founds it fresh if none exists);
    // ?fresh=1 always founds a new town (random seed unless &seed pins it) — the reset hatch
    // and the determinism-test entrance (?fresh=1&seed=42 never loads a save).
    const bootParams = new URLSearchParams(location.search);
    const urlSeed = bootParams.get('seed');
    const wantFresh = bootParams.get('fresh') != null;
    const worldSeed = urlSeed != null && urlSeed !== '' ? (parseInt(urlSeed, 10) >>> 0) : Math.floor(Math.random() * 0x7fffffff);
    const bootCulture = (bootParams.get('orc') != null || bootParams.get('culture') === 'orc') ? 'orc' : 'human';   // #3.1 ?orc=1 raises a warband

    // Grow the cast from a REAL self-hosted SuperMemory corpus if one is reachable; otherwise from
    // INVENTED past lives, seeded by this world so the default town is unique + untethered (no real docs).
    const result = await fetchMemories();
    memories = (result.memories && result.memories.length) ? result.memories : generateCrew(worldSeed);
    memorySource = (result.memories && result.memories.length) ? result.source : 'invented';
    // #1.1 (Codex r20 P1) lineage is INDEPENDENT of the source corpus: even a town whose fresh cast is invented
    // (no /v3 corpus, e.g. v0.0.3) still founds heirs of PRIOR towns read back via /v4/search. Key off the
    // lineage array itself, not memorySource. Empty when no store answered at all.
    lineagePool = Array.isArray(result.lineage) ? result.lineage : [];

    let resumed = false;
    if (!wantFresh) {
        const saved = await loadTown(urlSeed != null && urlSeed !== '' ? worldSeed : undefined);
        if (saved) {
            try { world = World.fromSave(saved); resumed = true; }
            catch (err) { console.warn('ry-farms: save unreadable — founding fresh', err); world = null; }
        }
    }
    if (!world) world = new World(worldSeed, bootCulture);

    // hook tile changes to terrain redraw
    const origSet = world.set.bind(world);
    world.set = (i, j, t) => { origSet(i, j, t); world._tilesChanged = true; };
    world._tilesChanged = true;

    // #reconciliation: apply any world-layer events queued for this town WHILE IT WAS AWAY (a raid on the
    // frontier that docked its stores, a parley honored/broken) before the resume card is built, so they land
    // in the chronicle + the "PREVIOUSLY ON" recap. Deterministic consume; cleared once applied.
    try {
        const widx = await loadWorldIndex();
        const pending = (widx.inbox && widx.inbox[String(world.seed)]) || [];
        if (pending.length) await consumeInbox(world, pending);   // exactly-once (Codex r20/r21)
    } catch (err) { console.warn('ry-farms: inbox consume failed', err); }

    if (resumed) {
        lastSavedDay = world.day;   // don't immediately re-save what we just loaded
        world.addLog(`Welcome back - day ${world.day}, year ${world.year} (seed ${world.seed})`, '#7dd069');
        resumeCard = {
            day: world.day, season: world.season, year: world.year, shownAt: 0,
            beats: world.chronicle.slice(-5).map(c => ({ text: c.text, color: c.color, day: c.day })),
        };
    } else {
        lastSavedDay = world.day;
        world.addLog(`Ry Farms — seed ${worldSeed}`, '#5a6672');
        const heirPlan = planHeirs(worldSeed, 8, lineagePool);   // #1.1 which founders descend from a past town's lives
        for (let i = 0; i < 8; i++) spawnFarmer(heirPlan.get(i) || null);   // start with the full founding eight
        if (heirPlan.size) world.addLog(`${heirPlan.size} of the founders are heirs of a remembered town.`, '#c8b0e0');
        world.ensureFounderVariety();                // guarantee a chaos-agent + a moody farmer among them
        // #reconciliation (Codex r20 P1): this town's lineage ROOT = the earliest origin its heirs descend from
        // (their forebears' roots, looked up in the world index), so the faction-lineage ledger compounds across
        // generations instead of starting fresh at each town. No heirs -> the town is its own root (constructor).
        if (heirPlan.size) {
            try {
                const widx = await loadWorldIndex();
                const roots = [];
                for (const f of world.farmers) {
                    const ln = f.sheet.lineage;
                    if (ln && ln.ofTownSeed != null) { const anc = widx.towns && widx.towns[String(ln.ofTownSeed)]; roots.push(String(anc && anc.lineageRoot ? anc.lineageRoot : ln.ofTownSeed)); }
                }
                if (roots.length) world.lineageRoot = roots.slice().sort()[0];
            } catch (err) { console.warn('ry-farms: lineage-root resolve failed', err); }
        }
    }
    selected = null;

    // the town also saves itself whenever the tab hides or closes (the rollover autosave's backstop)
    const saveOnHide = () => { if (booted && world) saveTown(world); };
    const syncTabHidden = () => { if (world) world._tabHidden = document.hidden; };   // #101 sim reads this to pause the LLM chat
    document.addEventListener('visibilitychange', () => {
        syncTabHidden();
        if (document.visibilityState === 'hidden') saveOnHide();
    });
    window.addEventListener('pagehide', saveOnHide);
    syncTabHidden();

    // center camera on the well
    cam.x = GW / 2 - isoX(world.well.i, world.well.j);
    cam.y = GH / 2 - isoY(world.well.i, world.well.j) - 20;

    world.addLog(`${memories.length} memories loaded from ${memorySource}`, '#8a9ade');
    world.addLog('Click a farmer to read their sheet. Drag to pan.', '#9aa0b4');

    // let the tuning screen breathe for a moment
    setTimeout(() => { booted = true; }, 1400);

    // the LLM chronicler (#92 stage 2): once the town is up, offer the cast's draft tales
    // for a finer telling. One try shortly after boot; the slow recheck catches farmers
    // whose stories only reach composer-generation at the next dawn (older saves migrating)
    // and any later arrivals. Display-only, save-carried, fails silent to procedural text.
    const tryEnrich = async () => {
        if (document.hidden) return;   // #101 a backgrounded/forgotten tab must NOT feed SuperMemory or the LLM
        const w = world;
        if (await enrichStories(w, () => world === w)) saveTown(w);
    };
    setTimeout(tryEnrich, 5000);
    setInterval(tryEnrich, 5 * 60 * 1000);

    // #91 memory writeback: persist each farmer's compiled life (creeds + beliefs + episodic) back to
    // self-hosted SuperMemory. Off the sim loop, best-effort, save-carried stamp. Slower cadence than
    // enrichment so a life is captured with a little history (beliefs form over days); no-ops offline.
    const tryPersist = async () => {
        if (document.hidden) return;   // #101 STALE-TAB GUARD: no memory writeback while the tab is hidden — this
        const w = world;               // is the loop that fed SuperMemory's paid gpt-5.1 extraction from a backgrounded tab
        // #101 the tab can be hidden (or the town replaced) DURING any await below, so every later paid op rechecks —
        // guarding only at the top let three writeback/enrich calls still fire after the tab went to the background.
        const stillActive = () => !document.hidden && world === w;
        if (await persistLives(w, () => world === w)) saveTown(w);
        if (!stillActive()) return;
        // #94 P3: also persist the town's evolving civic record (re-posts only when it changes)
        persistTownHistory(w, () => world === w);
        // #97 P5: name each new invention (LLM flavour -> display shadow) + persist the town's book of inventions
        if (await enrichInventions(w, () => world === w)) saveTown(w);
        if (!stillActive()) return;
        persistTownInventions(w, () => world === w);
    };
    setTimeout(tryPersist, 20000);
    setInterval(tryPersist, 6 * 60 * 1000);

    window.RYFARMS = {  // debug handle
        world, cam, audio,
        select: (i) => { selected = world.farmers[i] || null; },
        speed: (mult) => { world._speedMult = mult; },
        // #98 fire a test Moment: RYFARMS.moment() spotlights farmer 0 finding a star-crystal (with its memory why)
        momentMs: (ms) => { MOMENT_MS = ms; },   // hold a Moment open for QA/screenshots
        calloutMs: (ms) => { CALLOUT_MS = ms; },  // hold callout toasts open for QA
        callout: (txt = 'Rover invented the Emberwarm Poultice.', tone = 'triumph') => world.addChronicle('discovery', txt, world.farmers[0], null, '#ffd24a', { tier: 'callout', tone }),
        moment: (i = 0, kind = 'crystal') => { const f = world.farmers[i]; if (!f) return; world.addChronicle('find',
            `${f.sheet.name.split(' ')[0]} found a ${RARE_NAME[kind] || kind} in the deep wilds.`, f, null, '#8fd8ff',
            { tier: 'grand', tone: 'triumph', why: world.whyRareFind(f, kind), icon: 'rare:' + kind }); },
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
        resumed,                                             // did this boot hydrate a save?
        saveNow: () => saveTown(world),                      // force an autosave (returns the saved day)
        wipeSave: () => wipeTown(world.seed),                // retire this town's slot to backup (no reload)
        undoWipe: () => undoWipe().then(seed => {            // resurrect the last wiped town + resume it
            if (seed == null) { console.log('no wiped town to restore'); return null; }
            location.href = location.pathname + '?seed=' + seed; return seed;
        }),
        dismissCard: () => { resumeCard = null; },
        enrich: tryEnrich,                                   // ask the LLM chronicler now (debug)
        NEW_BTN,                                             // (debug) reset-hatch hitbox, for UI tests
    };
})();
