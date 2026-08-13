// main.js — Propagate: rendering, camera, input, UI, boot.

import { fetchMemories, generateCrew, mod, fmtMod, STAT_NAMES, TRAIT_NAMES, TRAIT_LABELS, hashString, mulberry32 } from './dna.js';
import { localLineage, mergeLineage, localLifeCount } from './memory-store.js';
import { backfillMemory } from './memory-backfill.js';
import { audio } from './audio.js';
import { World, CHUNK, T, GRID, CENTER, DAY_LENGTH, NIGHT_LENGTH, ITEMS, CRAFTABLES, RECIPE_BY_ID, INVENTION_TABLE, RARE_NAME, xpForLevel, obstacleTier, treeVariant, treeIsFruit, SEASONS, seedStage } from './farm.js';
import {
    TILE_W, TILE_H, makeCanvas, drawText, textWidth,
    makeFarmerSprites, makeCropSprites, makeHouse, makeWell, makeBoard, makeFencePost,
    makeScaffold, makeToolshed, makeWindmill, makeTower, makeLantern, makeMonument,
    makeLilyPad, makeFish, makeChicken, makeCow, makePig, makeGoat, makeSheep, makeCoop, makeCoopTD, makeBarn, makeMill, makeHatchery, makeTrough,
    makeTree, makeStump, makeWildWheat, makeWildFlowers,
    fillDiamond, strokeDiamond,
} from './pixel.js';
// `smooth` is used by the watch-fan falloff; `lerp` and `noise2` have no callers left in main.js now that
// noise2's only user (grassPatch) moved into the shared module, so they are deliberately not imported.
import { tileHash as hash2, tileRand as rand2, smooth,
         pickIndex, grassPatch, tileJitter } from './tilehash.js';
import { CRT } from './crt.js';
import { TITLE_SHEET, drawTitleArt as drawTitleSheet, isTitleSettled } from './title-anim.js';
import { saveTown, loadTownState, wipeTown, undoWipe, loadWorldIndex, updateWorldIndex, quarantineTown, peekQuarantined, restoreQuarantined, requestPersistentStorage, buildTownExport, importTownFile, quarantineState } from './save.js';
import { computeLayout, detectEncounters, encounterLine, townPos, townReach, townTint } from './worldmap.js';
import { enrichStories } from './dm.js';
import { requestCongregation, requestElectionScene } from './congregation.js';
import { requestRaidCouncil, requestRaidDebrief, requestDuelBeat } from './raidcouncil.js';
import { persistLives, persistTownHistory, persistBattle } from './memory-writeback.js';
import { enrichInventions, persistTownInventions } from './memory-invent.js';
import { whisper, whisperLog } from './conscience.js';
import { cultureWord } from './culture.js';   // #3.1 orc-vs-human display copy
import { track, trackOnce, resetFunnel } from './analytics.js';   // #funnel display-side GA4 events
import { buildPostcard, queryTown } from './postcard.js';   // #postcard the share link + copy line, and THE ?seed/?orc reading (off-sim)
import { voiceOf, wordDelay, KEY_VARIANTS, VOICE_VARIANTS, DEFAULT_KEY_VARIANT, DEFAULT_VOICE_VARIANT } from './whisper-fx.js';   // #whisper-fx key pops + animalese
import { revealLine, DEFAULT_VARIANT } from './speech-anim.js';   // #bubble-reveal how a spoken line arrives

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
let localMemoryCount = 0;   // #local-memory lives held in THIS BROWSER's store (refreshed at boot + settings-open)
function memoryTagline() {
    if (memorySource === 'offline') return 'TUNING IN';
    if (memorySource !== 'invented') return 'GROWN FROM SUPERMEMORY';
    // #local-memory honest copy: an invented cast that carries heirs of the player's OWN past towns
    // has closed the loop locally — say that, not "no memory".
    return lineagePool.length ? 'A WORLD THAT REMEMBERS ITSELF' : 'GROWN FROM IMAGINED LIVES';
}
function memoryCaption() {
    // Codex #88 P2 — the caption never claims memory that doesn't exist: a spectator backdrop
    // writes nothing, and an empty store has remembered nothing YET (future-facing copy only).
    if (world && world._persistenceDisabled) return 'A PASSING VIEW - NOTHING IS SET DOWN.';
    if (memorySource !== 'invented') return 'EVERY FARMER\'S MEMORIES, LIVE FROM SUPERMEMORY.';
    if (localMemoryCount > 0) return `THIS BROWSER REMEMBERS ${localMemoryCount} LIVES FROM YOUR TOWNS.`;
    return 'YOUR TOWNS WILL SET THEIR LIVES DOWN HERE AS THEY LIVE.';
}
const usedMemoryIds = new Set();
let selected = null;
let bootT0 = null;   // #Codex-VS first-boot-frame timestamp (seconds) → refresh-rate-independent boot timing
let booted = false;
let startScreen = false;                            // #START the launch menu is up (drawn into the canvas, CRT-shaded)
let startPage = 'title';                            // 'title' (Start Game / View) → 'choose' (human / orc / view / back)
let startHits = null;
// #start-icons the WATCH glyph — owner pick 2026-08-12: 24 (the paired-lens binoculars) over the
// 83 camera and 169 scope candidates. RYFARMS.watchIcon(n) still swaps it live for future sweeps.
let START_WATCH_ICON = 24;                              // button rects (game px), set each frame by drawStartScreen (keys vary by page)
let _startScreenErr = false;                        // #START logged-once guard for a menu-draw failure (never black the game)
let rosterOpen = false;
let rosterScroll = 0;
// CONSCIENCE CHAT (#93): the bottom half of the roster window is a chat with one farmer, where
// the player's lines land as a stray inner voice. State here; the DOM capture input is built lazily.
let chatFarmer = null;            // the farmer currently being whispered to
let chatScroll = 0;               // history scroll (px), independent of the roster list scroll
let chatThinking = false;         // awaiting the classify+reply round-trip (shows a "..." shimmer)
// #whisper-fx — which key-pop / animalese variant plays (owner-picked via the compare harness or
// RYFARMS.keySound()/.voiceSound(); persisted per browser; 'off' silences that half).
const storedFx = (k, list, dflt) => { try { const v = localStorage.getItem('ryf.' + k); return v === 'off' || list.some(x => x.id === v) ? v : dflt; } catch { return dflt; } };
let whisperKeyFx = storedFx('keyfx', KEY_VARIANTS, DEFAULT_KEY_VARIANT);
let whisperVoiceFx = storedFx('voicefx', VOICE_VARIANTS, DEFAULT_VOICE_VARIANT);
let chatReveal = null;            // #whisper-voice { c, text, progress, spoken, voice, last } — the newest reply writing itself out
// #inspiration (Codex #124 r3) — the pre-verdict seed snapshot, held from SUBMIT until the reply
// reveal finishes: conscienceCheck can DEFY-delete a seed seconds before the reply arrives, and
// the anchored exchange must not vanish while the panel still shows the pending shimmer — the
// farmer's words land before their consequence.
let chatFreeze = null;            // { c, seeds }
let chatDropdownOpen = false;     // the "switch farmer" picker is expanded over the list
let chatDropRows = [];            // { farmer, y0, y1 } hit regions for the open dropdown
let chatEntryRect = null;         // screen-px rect of the entry row (for click-to-focus + input overlay)
let chatFocused = false;          // is the hidden input focused (blocks world keyboard shortcuts)
let chatInputEl = null;           // the hidden DOM <input> that actually captures keystrokes/IME/paste
let chatWidgetOpen = false;       // #legibility Slice 2 — the whisper widget elevated to the primary screen
const CHAT_BTN = { x: 0, y: 0, w: 0, h: 0 };    // minimized whisper button (bottom-left), set in drawChatWidget
const CHAT_CLOSE = { x: 0, y: 0, w: 0, h: 0 };  // the widget's minimize (_) hit, set in drawChatWidget
const CHAT_PANEL = { x: 0, y: 0, w: 0, h: 0 };  // the expanded widget bounds (for pan-block + click-consume)
let chatViewport = null;          // { x, y, w, h, bodyTop, bodyBot, maxScroll } of the history area
let chronOpen = false;            // town chronicle panel (the settlement's saga)
// #raidfx — the fullscreen "UNDER RAID" battle-transition (war-bands slam shut, a hit-flash + screen shake,
// the camera snaps to the raiders). Fires when world.raidEvent is newly staged. Display-only.
let raidFx = null;                // { t } while the transition plays
let raidShake = 0;                // decaying screen-shake magnitude
let raidFocus = null;             // { i, j } the camera eases to while a raid is on (the fence/well the warband hits)
let _lastRaidEvent = null;        // dedupe the camera snap (fire once per staged raid)
let _raidStruck = false;          // #131b fire the UNDER RAID beat once, when the warband crosses into town
let _raidDetected = false;        // #incoming fire the "INCOMING RAID" shader once, at the sentry's alarm (detection edge)
let chronReadTotal = 0;           // world._chronTotal at last view — the badge shows only for UNREAD beats
let chronScroll = 0;
let followMode = false;           // camera tracks followTarget (F/crosshair toggles; drag/Esc cancels)
let specTarget = null;            // #START launch-page spectator camera: the townsfolk it's drifting between
let specNextSwitch = 0;           // wall-clock ms for the next spectator-camera target rotation
let menuMuted = true;             // #START the start-screen volume button state (starts muted; click to hear the theme)
let followTarget = null;          // the farmer being trailed — independent of the open card, so closing
                                  // the sheet (X) keeps following; only F / Esc / a pan stops it
// #firstwatch Following is the game's most useful camera verb and nothing teaches it. The DAY-1 founding
// congregation is the place to: the founders gather at the centre, confer about how they'll live, and agree
// to share a rotating watch — so the moment they scatter there is already one named person with a job to do
// tonight. The camera takes hold of whoever holds that first watch, and the FOLLOWING banner carries the
// instructions on its own. It is an INTRODUCTION, so it happens once, at the start, and never again — the
// day-10 election and every winter election after it leave the camera alone.
// EDGE-TRIGGERED on the congregation dispersing, deliberately: it fires only for a player who is there to
// see it. Load a save from any later point and the congregation is long over, so there is no edge and no
// hijack of a camera the player has since put somewhere on purpose. Display-only — no sim state, no rng.
let sawCongregating = null;       // last observed world.congregating() (null until the first frame with a world)
let recapSeq = -1;                // last day-recap seq we've seen (to detect a new one)
let dramaSpotlight = null;        // { seed, kind, label, t } — a recent off-camera story beat worth watching (B4)
let lastChronLen = -1;            // chronicle length last frame, to detect NEW beats to spotlight
// which chronicle kinds are dramatic enough to nudge the player to go watch, + their short cue label
// #drama-cue only beats with SUSTAINED, watchable action get a "jump to watch" nudge — a 'rift' (a falling-out) is
// over by the time the camera arrives (nothing to see), so it's scrubbed from the cues (it still logs a chronicle).
// Each surviving kind carries a DISTINCT emblem (drawn in the cue) so they read at a glance, not four identical "- W"s.
const DRAMA_KINDS = { peril: 'peril', crime: 'a theft', hunt: 'a hunt' };
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
    if (memoryIntro) return true;   // #memory-intro the whole reveal is clickable
    if (UPDATE_NUDGE.w && inRect(m, UPDATE_NUDGE)) return true;   // #update-nudge — the pill is a button; the glove says so
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
    // #credits — the settings panel's CraftPix link (and its other buttons) wear the gold glove
    if (settingsOpen && settingsHits) { for (const k of ['close', 'music', 'sfx', 'portalBtn', 'shareBtn', 'craftpix']) if (settingsHits[k] && inRect(m, settingsHits[k])) return true; }
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
const FOLLOW_PREV = { x: 0, y: 0, w: 0, h: 0 };    // FOLLOWING-banner ◄ cycle arrow, set in drawUI's banner
const FOLLOW_NEXT = { x: 0, y: 0, w: 0, h: 0 };    // FOLLOWING-banner ► cycle arrow, set in drawUI's banner
const AWAY_BAR = { x: 0, y: 0, w: 0, h: 0 };       // #away-banner strip under the top bar; hover = homecoming ETA
// #update-nudge — a deploy lands while sessions are in flight: the loaded modules never change mid-run, so
// the only road to the new build is a reload. Remember the server's build rev at boot, re-check on a slow
// clock + whenever the tab returns to view (a player coming back is already at a natural pause), and when
// it moves raise a quiet persistent pill: click = save, then reload. Never auto-reloads; never blocks play.
// Display-side only — no sim reads/writes. Offline/local (no /api/build) the fetch fails and it stays dark.
const UPDATE_NUDGE = { x: 0, y: 0, w: 0, h: 0 };
let _bootRev = null;          // the build rev this session loaded under (null until the first sighting)
let _updateReady = false;     // a newer build is live — the pill is up
let _updateReloading = false; // click received: saving, then reloading (guards double-clicks)
async function checkBuildRev() {
    if (_updateReady) return;
    try {
        const j = await (await fetch('/api/build', { cache: 'no-store' })).json();
        if (!j || !j.rev) return;
        if (_bootRev === null) { _bootRev = j.rev; return; }   // first sighting = our own generation
        if (j.rev !== _bootRev) _updateReady = true;
    } catch { /* offline or local dev — the nudge never fires */ }
}
setInterval(checkBuildRev, 5 * 60 * 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkBuildRev(); });
checkBuildRev();
if (new URLSearchParams(location.search).has('nudge')) _updateReady = true;   // QA: preview the pill on load, survives refresh
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
let worldMapTravHits = [];                         // traveler/courier hover discs { x, y, r, ...meta }, rebuilt each draw
let worldMapKeyOpen = false;                        // legend overlay toggle (the map's visual language, explained)
let worldMapFoundOpen = false;                      // "found a town" culture picker toggle (human / orc)
let worldMapUiHits = null;                          // { key, found, human, orc } world-map button rects
const WORLD_BTN = { x: 0, y: 3, w: 0, h: 12 };     // top-bar toggle, positioned in drawUI
// #adminbooth The director's booth (staged rehearsals) is for recording videos and stress-tests — it was
// never meant to face players, and it shipped to production visible to everyone (owner caught it on launch
// day). Gated on ?admin=1 in the URL: no param, no booth — the rows are never drawn, so their hit rects are
// never registered and the click handlers' `settingsHits.admX &&` guards go inert. The RYFARMS console API
// keeps its rehearsal hooks; dev tools are already past any UI gate.
const ADMIN_BOOTH = new URLSearchParams(location.search).has('admin');
let settingsHits = null;
// #saveport — the import flow's one-beat confirm: a parsed file waits here for a second click, so a
// mis-tap cannot replace a town. { parsed, town, day, seed } while confirming; null otherwise.
let pendingImport = null;
let saveportNote = null;   // { text, until } — result/error line under the town-file row
// Every close path bumps this token, and a file picked under an older token is DISCARDED when its
// async read lands (Codex #121): f.text() resolving after a close used to re-arm the confirm on a
// closed panel, so reopening presented an unrelated second click as consent.
let importPickGen = 0;
const disarmImport = () => { pendingImport = null; importPickGen++; };

// ONE import flow for both surfaces (settings, start menu) — two implementations of a destructive
// confirm is how one of them drifts. The chooser arms pendingImport; the confirm click calls
// saveportRunImport. `occupied` drives the disclosure: battle tales are only LOST when a town at
// that seed is being replaced, and warning a fresh browser about losing nothing is a false scare.
function saveportOpenChooser() {
    // A NEW chooser supersedes the old one FIRST (Codex #122 r3): while chooser A awaits f.text()
    // and the occupancy reads, pendingImport is still null and the rung looks idle — so chooser B
    // could open under the SAME token, and whichever read finished last replaced the pending file,
    // possibly between the last paint and the confirming click. Advancing the token here means at
    // most one selection is ever authorized: the newest.
    disarmImport();
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    const myGen = importPickGen;   // any close OR newer chooser invalidates this selection
    input.onchange = () => {
        const f = input.files && input.files[0];
        if (!f) return;
        f.text().then(async (txt) => {
            if (myGen !== importPickGen) return;   // surface closed while the file was reading — stale
            let parsed;
            try { parsed = JSON.parse(txt); } catch { saveportNote = { text: 'NOT A TOWN FILE (BAD JSON)', until: performance.now() + 6000 }; return; }
            if (!parsed || parsed.format !== 'propagate-town') { saveportNote = { text: 'NOT A PROPAGATE TOWN FILE', until: performance.now() + 6000 }; return; }
            // occupancy decides the disclosure — and QUARANTINE counts (Codex #122): a town preserved
            // under unreadable:<seed> looks empty to loadTownState, yet import clears its memory rows
            // and irreconstructible battle tales. Any unreadable state discloses (fail toward warning).
            let occupied = true, slotGen = null;
            try {
                const st = await loadTownState(parsed.seed);
                const q = await quarantineState(parsed.seed);
                occupied = !st.ok || !!st.snap || !q.ok || !!q.rec;
                if (st.ok) slotGen = st.gen;
            } catch { occupied = true; }
            if (myGen !== importPickGen) return;   // closed during the occupancy read
            pendingImport = { parsed, town: parsed.town, day: parsed.day, seed: parsed.seed, occupied, slotGen };
        }).catch(() => { saveportNote = { text: 'COULD NOT READ THE FILE', until: performance.now() + 6000 }; });
    };
    input.click();
}
async function saveportRunImport() {
    const pend = pendingImport;
    pendingImport = null;
    if (!pend || !pend.parsed) return;
    const parsed = pend.parsed;
    saveportNote = { text: 'IMPORTING...', until: performance.now() + 60000 };
    // RE-VERIFY the disclosure before acting on it (Codex #122): another tab can occupy the slot
    // between the chooser's read and this click. If the player confirmed the EMPTY-slot wording and
    // the slot is no longer empty, that consent does not cover what the import would now do —
    // re-arm with the destructive warning instead of importing.
    let freshGen = null;
    try {
        const st = await loadTownState(parsed.seed);
        const q = await quarantineState(parsed.seed);
        const nowOccupied = !st.ok || !!st.snap || !q.ok || !!q.rec;
        if (st.ok) freshGen = st.gen;
        if (!pend.occupied && nowOccupied) {
            pendingImport = { ...pend, occupied: true, slotGen: freshGen };
            saveportNote = { text: 'THE SAVE SLOT CHANGED - CONFIRM AGAIN', until: performance.now() + 8000 };
            return;
        }
    } catch { /* unreadable — the in-transaction expectGen below is the backstop */ }
    importTownFile(parsed, (snap) => World.fromSave(snap), { expectGen: freshGen ?? undefined, expectEmpty: !pend.occupied }).then((r) => {
        if (!r.ok) {
            saveportNote = { text: r.slotChanged ? 'THE SAVE SLOT CHANGED - PICK THE FILE AGAIN' : `IMPORT REFUSED: ${String(r.error || '').toUpperCase().slice(0, 34)}`, until: performance.now() + 8000 };
            return;
        }
        // A failed clear does NOT heal on its own — the active backfill preserves existing keys.
        const uncleared = !!r.memoryError;
        saveportNote = { text: uncleared ? 'IMPORTED - OLD MEMORIES COULD NOT BE CLEARED' : 'IMPORTED - MEMORIES WILL REGROW HERE', until: performance.now() + 60000 };
        // NAVIGATE TO THE IMPORTED SEED (Codex #121 r4 P1): reload kept ?fresh/?seed and booted the
        // wrong town. The superseded world stops persisting for the gap.
        world._persistenceDisabled = true;
        setTimeout(() => { location.href = `/?seed=${r.seed}`; }, uncleared ? 2600 : 1400);
    }).catch(() => { saveportNote = { text: 'IMPORT FAILED', until: performance.now() + 6000 }; });
}                           // { music, sfx, musicSlider, sfxSlider, portalBtn, admRaid, admVote, close } rects (game px)
let adminNote = null;                               // #Codex38 P2-5 transient booth feedback { text, until } (ms)
let settingsDrag = null;                           // 'music' | 'sfx' while dragging a volume slider
// (the settings NEW TOWN reset hatch is gone — founding lives on the world map; RYFARMS.wipeSave remains for QA)
let lastSavedDay = 0;                              // last world.day autosaved (rollover-triggered)
let saveFlashAt = -1e9;                            // brief "SAVED" tick in the top bar
let _whisperNudged = false;                        // #curate one whisper-nudge toast per page load (localStorage gates per browser)
let _heldToasted = false;                          // #fresh-held one refused-?fresh explanation toast per page load
let _postcardArrival = false;                      // #postcard this boot FOUNDED a town from a shared ?pc=1 link (set once resume is settled)
let _postcardToasted = false;                      // ...and greeted the recipient (once per page load)
let _voteWindowWas = false;                        // #vote-panel edge-detects the gathering opening (replaces the detail card once)
let resumeCard = null;                             // "PREVIOUSLY ON PROPAGATE" catch-up card (shown once on resume)
// #memory-intro — the ONE-TIME feature reveal for EXISTING players (owner: introduce the browser
// memory to people who already have worlds, not to new players — a first-town founder grows up
// with it naturally). Shown once per browser (localStorage), ABOVE the resume card: dismissing it
// reveals the "PREVIOUSLY ON" catch-up beneath. The memory-web animation (the portal's living
// graph, from heyhaigh.ai) plays via a muted looping <video> drawn into the canvas each frame —
// so it wears the CRT like everything else.
let memoryIntro = null;                            // { shownAt, video, hits: {view, cont, close} }
function openMemoryIntro() {
    // the POSTER is the reliable floor of the video box (owner): a static webp decodes on every
    // modern Safari/Firefox/Chrome, so even where VP9 video can't play (older Safari, hardware
    // decode quirks) the card shows the memory graph — never a dark box. The video draws OVER it
    // only once it is genuinely decoding.
    const poster = new Image();
    poster.src = '/assets/memory-web-poster.webp';
    const video = document.createElement('video');
    video.src = '/assets/memory-web.webm';
    video.muted = true; video.loop = true; video.playsInline = true;
    video.play().catch(() => { /* muted autoplay refused (Low Power / site setting): the poster stands in */ });
    memoryIntro = { shownAt: performance.now(), video, poster, hits: {} };
    try { localStorage.setItem('ryfarms-memory-intro', '1'); } catch { /* private mode — it may show again */ }
}
function dismissMemoryIntro() {
    if (memoryIntro && memoryIntro.video) { try { memoryIntro.video.pause(); memoryIntro.video.src = ''; } catch {} }
    memoryIntro = null;
}
let faceoff = null;                                // #faceoff the pre-battle VS card raised when the warband lands (render-only)
let faceoffSeenEvent = null;                       // the raidEvent object we've raised a faceoff for (one card per raid; identity-keyed)
const BOARD_CLOSE = { x: 0, y: 0, w: 0, h: 0 };
const BOARD_RECT = { x: 0, y: 0, w: 0, h: 0 };

const cam = { x: 0, y: 0 };
const mouse = { x: -1, y: -1, downX: 0, downY: 0, dragging: false, panStart: null };
// #touch Long-press = the hover that touch doesn't have: hold a finger still over a farmer or building and
// the same tooltip the mouse gets on hover appears (the held point simply stays in mouse.x/y, which is all
// hover ever reads). The release of a long-press is NOT a click — it was an inspect gesture.
let touchHoldTimer = 0, touchHoldActive = false;
// #Codex67-3 one pointer owns the gesture. Every pointer shares panStart/dragging/settingsDrag/the hold
// timer, so a second finger down mid-drag used to overwrite the first finger's origin — the camera jumped
// to the new finger's frame of reference, and either release could phantom-click for the other. Non-active
// IDs are ignored outright until the owner releases. null = no gesture; hover moves always flow.
let activePointerId = null;
let _seenSettleEpoch = 0;    // Codex #76-3 — lens reset after an in-place rehearsal settle (farm.js bumps world._settleEpoch)
let _hadRehearsal = false;   // #Codex67-1 edge-detects the curtain falling (rehearsal -> null)
// #continue The menu's CONTINUE offer: the latest-played town in THIS browser, read from the same 'latest'
// pointer ?play=1 resumes. null until the async read lands (the menu draws without it, then it appears) —
// and stays null for a first-time visitor, whose menu is unchanged.
let startContinue = null;   // { name, day, seed }
const TOUCH_HOLD_MS = 450;

const spriteCache = new Map();   // farmer -> frames
const houseCache = new Map();    // roofColor -> canvas
const wellSprite = makeWell();
const boardSprite = makeBoard();
const fencePost = makeFencePost();
const scaffoldSprite = makeScaffold();
const lanternSprite = makeLantern();
const structSprites = {
    toolshed: makeToolshed(),
    windmill: [makeWindmill(0), makeWindmill(1), makeWindmill(2), makeWindmill(3)],
    tower: makeTower(),
    well2: wellSprite,
};

// facility sprites
const coopSprite = makeCoop();   // legacy flat coop (fallback)
// top-down ¾ coop — season-dependent AND egg-state-dependent. The nest boxes show an egg
// only when one is actually harvestable, so the building reports real production state at a
// glance instead of decoratively always holding eggs. Cached per (season, eggs);
// display-only and deterministic — reads sim state, never writes it.
const coopTDCache = new Map();
function coopTDSprite(seasonName, eggs = 0) {
    const key = seasonName + ':' + eggs;
    if (!coopTDCache.has(key)) coopTDCache.set(key, makeCoopTD(seasonName, { eggs }));
    return coopTDCache.get(key);
}
// how many of this facility's producers are ready to collect (0..2 — one egg per nest box)
function readyEggCount(fac) {
    let n = 0;
    for (const p of fac.producers) if (p.ready) { n++; if (n >= 2) break; }
    return n;
}
// barn is season-aware now — cache one variant per season
const barnCache = new Map();
function barnSprite_(seasonName) {
    if (!barnCache.has(seasonName)) barnCache.set(seasonName, makeBarn(seasonName));
    return barnCache.get(seasonName);
}
// mill is season-aware now (roof snow / fall leaves) — cache one variant per season
const millCache = new Map();
function millSprite_(seasonName) {
    if (!millCache.has(seasonName)) millCache.set(seasonName, makeMill(seasonName));
    return millCache.get(seasonName);
}
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
// #firstframe LOAD PRIORITY. Every image below is requested at module scope, so the browser starts all 176
// together and the tail queues behind the head — which is why a 2KB sprite could take 2.1s on a cold visit.
// `fetchPriority` does not change WHAT loads, it changes the order the connection serves them: the art the
// first frame is blocked on goes first, and the heavy things nobody can see yet get out of its way. The three
// portraits alone are 592KB — 29% of the cold payload — for art that only appears on a raid faceoff.
const PRIO = (img, p) => { try { img.fetchPriority = p; } catch { /* older engines ignore it */ } return img; };
const treeAnimSheet = new Image(); let treeAnimReady = false; treeAnimSheet.onload = () => { treeAnimReady = true; }; treeAnimSheet.onerror = () => {};
PRIO(treeAnimSheet, 'low').src = './assets/craftpix-net-654184-main-characters-home-free-top-down-pixel-art-asset/PNG/Trees_animation.png';
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

// #94 ORC BIOME — a rocky, fungal wasteland. These sets are used ONLY when world.culture === 'orc'
// (see the orc branch in wildSpec). Trees become dead trees / mushroom-trees / chanterelles; the green
// foliage becomes ground mushrooms; rocks become glowing magma boulders; and rare dragon skeletons litter
// the land as impassable decor. Loaded lazily like the human sets; pure display, no sim/determinism effect.
// Assets_no_shadow (NOT Assets/ or the texture-shadow dirs): the with-shadow variants bake a GREEN grass
// tuft under each sprite, which reads wrong on the orc desert — the shadowless cut sits clean on the sand.
const ORC_FOREST_BASE = './assets/craftpix-net-505052-free-forest-objects-top-down-pixel-art/PNG/Assets_no_shadow/';
const ORC_TREE_NAMES = ['White_tree1', 'White_tree2', 'White-red_mushroom1', 'White-red_mushroom2', 'White-red_mushroom3'];   // chanterelles dropped per request
const ORC_BURNED_BASE = './assets/craftpix-net-385863-free-top-down-trees-pixel-art/PNG/Assets_separately/Trees/';
const ORC_BURNED_NAMES = ['Burned_tree1', 'Burned_tree2', 'Burned_tree3'];   // charred dead trees, a third of the orc canopy
const ORC_ROCKY_BASE = './assets/craftpix-net-639143-free-rocky-area-objects-pixel-art/PNG/Objects_separately/';
const ORC_FLOWER_NAMES = ['Black_mushrooms1_ground_shadow', 'Black_mushrooms2_ground_shadow'];
const ORC_WHEAT_NAMES = ['Orange_mushrooms1_ground_shadow', 'Orange_mushrooms2_ground_shadow'];
const ORC_BONE_NAMES = ['Dragon_bones_full_ground_shadow', 'Dragon_bones_body_ground_shadow', 'Dragon_bones_tail_ground_shadow', 'Dragon_bones_wing1_ground_shadow', 'Dragon_bones_wing2_ground_shadow'];
const ORC_ROCK_NAMES = ['Rock7_1', 'Rock7_2', 'Rock7_3', 'Rock7_4', 'Rock7_5'];   // grey boulders (Rock8 magma dropped per request)
// The ONLY green in the wastes: cacti (bushes pack, plain Assets/ — no grass tuft), sprinkled among the foliage.
const ORC_CACTUS_BASE = './assets/craftpix-net-141354-free-top-down-bushes-pixel-art/PNG/Assets/';
const ORC_CACTUS_NAMES = ['Cactus1_1', 'Cactus1_2', 'Cactus1_3', 'Cactus2_1', 'Cactus2_2', 'Cactus2_3'];
const orcTreeImg = {}, orcRockyImg = {}, orcRockImg = {}, orcCactusImg = {}, orcBurnedImg = {};
// Codex #62-2 — these sets were loaded with EMPTY ready callbacks, so the first-frame gate had nothing
// orc-side to wait on and a cold `?orc=1` boot revealed on human/procedural stand-ins and bare tiles.
let orcTreeArtReady = false, orcRockyArtReady = false, orcRockArtReady = false,
    orcCactusArtReady = false, orcBurnedArtReady = false;

// The Dungeon Master's wilderness threats. Each sheet is a directional frame GRID; we slice one
// side-profile frame per sprite (`row`), which in these packs faces LEFT — so it's mirrored to face
// RIGHT when moving right. The assassin uses the lvl-3 swordsman (the lvl-1 looks like our farmers).
const THREAT_ART = {
    // beasts have clean L/R side profiles (side:true — mirrored by movement); the humanoid foes don't,
    // so they face the camera front-on (side:false — always menacing, never mis-facing).
    fox:      { base: './assets/craftpix-net-789196-free-top-down-hunt-animals-pixel-sprite-pack/Tiled/', file: 'Fox_Idle_with_shadow',  fw: 32, row: 2, side: true },
    boar:     { base: './assets/craftpix-net-789196-free-top-down-hunt-animals-pixel-sprite-pack/Tiled/', file: 'Boar_Idle_with_shadow', fw: 32, row: 2, side: true },
    // #raid-feel the orc sheet is a FULL 4-direction set (measured: row0 = front/down, row1 = back/up,
    // row2 = left, row3 = right) — we'd only ever drawn row 2, so orcs faced screen-left forever (player:
    // "I've never seen the upward sprite"). rows4 lets drawThreat pick by movement.
    orc:      { base: './assets/craftpix-net-363992-free-top-down-orc-game-character-pixel-art/Tiled_files/', file: 'orc1_idle_with_shadow', fw: 64, row: 2, side: false, rows4: { down: 0, up: 1, left: 2, right: 3 } },
    assassin: { base: './assets/craftpix-net-180537-free-swordsman-1-3-level-pixel-top-down-sprite-character/Tiled_files/Swordsman3/', file: 'Swordsman_lvl3_Idle_without_shadow', fw: 64, row: 0, side: false },
};
const threatImg = {};
for (const [k, c] of Object.entries(THREAT_ART)) { const im = new Image(); im.src = c.base + c.file + '.png'; threatImg[k] = im; }
// #3.1 orc FARMERS use the shadowless orc idle (the game draws its own foot-shadow — the with-shadow foe sheet
// baked in a second blob). Separate from threatImg.orc (which stays with-shadow for wilderness foes).
const orcFarmerImg = new Image();
orcFarmerImg.src = './assets/craftpix-net-363992-free-top-down-orc-game-character-pixel-art/Tiled_files/orc1_idle_without_shadow.png';
// #orc-vs-orc: when ORCS raid an ORC town, the raiders draw from the OTHER orc tribes' sheets (orc2/orc3,
// with shadow like all foes) so attacker and defender never share a face. Human towns keep orc1 raiders.
const orcVariantImg = {};
for (const v of [2, 3]) {
    const im = new Image();
    im.src = `./assets/craftpix-net-363992-free-top-down-orc-game-character-pixel-art/Tiled_files/orc${v}_idle_with_shadow.png`;
    orcVariantImg[v] = im;
}
// #sprite the 8-frame ATTACK-SWING sheets (same 64px 4-directional-row layout as idle) — drawn while a
// raider is mid-swing in a duel (e._swingAt), so they actually SWING a blade instead of lunging in an idle
// pose. orc1 for human-town raids; orc2/orc3 for the orc-vs-orc variant raiders. Falls back to idle if
// the sheet hasn't loaded. Display-only — no sim/determinism impact.
const orcAttackImg = {};
const orcHurtImg = {};
const orcWalkImg = {};
const orcDeathImg = {};
const ORC_TF = './assets/craftpix-net-363992-free-top-down-orc-game-character-pixel-art/Tiled_files/';
for (const v of [1, 2, 3]) {
    const mk = (suf) => { const im = new Image(); im.src = `${ORC_TF}orc${v}_${suf}_with_shadow.png`; return im; };
    orcAttackImg[v] = mk('attack'); orcHurtImg[v] = mk('hurt'); orcWalkImg[v] = mk('walk'); orcDeathImg[v] = mk('death');
}
// #anim-migrate orc FARMER activity sheets — the SHADOWLESS variants (the game draws its own foot shadow;
// the with-shadow foe sheets bake in a blob). walk 6f / run 8f / attack 8f / hurt 6f / death 8f, same 4-row
// 64px layout as the idle sheet. A sheet that hasn't loaded just falls back to the idle-sheet frames.
const orcFarmerAnim = {};
for (const k of ['walk', 'run', 'attack', 'hurt', 'death']) {
    const im = new Image(); im.onerror = () => {};
    im.src = `${ORC_TF}orc1_${k}_without_shadow.png`;
    orcFarmerAnim[k] = im;
}
// #sprite the assassin (lvl-3 swordsman) gets its own attack/hurt/death — a lone duelist that swings, flinches, falls
const ASSN_TF = './assets/craftpix-net-180537-free-swordsman-1-3-level-pixel-top-down-sprite-character/Tiled_files/Swordsman3/';
const mkA = (suf) => { const im = new Image(); im.src = ASSN_TF + suf; return { 0: im }; };
const assassinAttackImg = mkA('Swordsman_lvl3_attack_with_shadow.png');
const assassinHurtImg = mkA('Swordsman_lvl3_Hurt_with_shadow.png');
const assassinDeathImg = mkA('Swordsman_lvl3_Death_with_shadow.png');
// #START the launch choose-screen HUMAN walker — the Swordsman lvl1 WALK sheet (384x256 = 6 cols x 4 rows of
// 64px cells, same layout as the orc walk sheet; side row faces RIGHT natively). Menu-display only.
const menuHumanWalkImg = new Image();
menuHumanWalkImg.src = './assets/craftpix-net-180537-free-swordsman-1-3-level-pixel-top-down-sprite-character/PNG/Swordsman_lvl1/With_shadow/Swordsman_lvl1_Walk_with_shadow.png';
const SWING_DUR = 0.36, HURT_DUR = 0.34, DEATH_DUR = 0.7;   // display windows for the attack/hurt/death animations
const WALK_STRIDE = 0.42;   // tiles travelled per walk-frame step (drives the gait off DISTANCE, so it reads right at any speed)

// #faceoff the VS-card PORTRAITS — big illustrated busts (transparent cutouts, all 1300x1300, all facing LEFT)
// for the fighting-game face-off. The DEFENDER (townsfolk) sits LEFT and is FLIPPED to face right; the RAIDER
// sits RIGHT facing left (no flip). human-farmer = a human town's defender; orc-raider = the orc raider on a
// human town AND the orc-town DEFENDER (orc farmers look the same); orc-raider-2 = the warband that raids an
// orc town. Purely a display card (drawFaceoff), no sim/determinism impact.
const humanPortraitImg = new Image(); let humanPortraitReady = false;
humanPortraitImg.onload = () => { humanPortraitReady = true; }; humanPortraitImg.onerror = () => {};
PRIO(humanPortraitImg, 'low').src = './assets/human-farmer.png';
const orcPortraitImg = new Image(); let orcPortraitReady = false;
orcPortraitImg.onload = () => { orcPortraitReady = true; }; orcPortraitImg.onerror = () => {};
PRIO(orcPortraitImg, 'low').src = './assets/orc-raider.png';
const orcRaider2Img = new Image(); let orcRaider2Ready = false;
orcRaider2Img.onload = () => { orcRaider2Ready = true; }; orcRaider2Img.onerror = () => {};
PRIO(orcRaider2Img, 'low').src = './assets/orc-raider-2.png';

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
        img.fetchPriority = 'high';   // #firstframe flora/rock art gates the reveal — ahead of the rest
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
// House within exterior.png — the EXACT content box (alpha-scanned), not an eyeballed trim. The old
// rect {2,5,137,125} started 5 rows BELOW the ridge and stopped 6 columns SHORT of the right eave, so
// the cottage rendered with its peak and its right roof slope sliced off (visible in-game and in the
// sprite library). It also carried 12px of dead padding on the left, which pushed the sprite off-centre
// since the draw centres on the rect. Content is x 14..144, y 0..127; the stone-wall strip starts at 128.
const HOUSE_SRC = { x: 14, y: 0, w: 131, h: 128 };
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
// #94 orc dwellings — cave mouths carved into the rock: L2 a plain cave, L3 a great skull-cave. The 64px
// sprites are scaled up (via art.scale) so they read as dwellings, not scenery. L1 keeps the tipi (war-tent).
const orcCaveL2 = new Image(); let orcCaveL2Ready = false; orcCaveL2.onload = () => { orcCaveL2Ready = true; }; orcCaveL2.onerror = () => {};
const orcCaveL3 = new Image(); let orcCaveL3Ready = false; orcCaveL3.onload = () => { orcCaveL3Ready = true; }; orcCaveL3.onerror = () => {};
orcCaveL2.src = ROCKY_BASE + 'Cave_entrance3_ground_shadow.png';   // plain cave mouth -> L2
orcCaveL3.src = ROCKY_BASE + 'Cave_entrance2_ground_shadow.png';   // SKULL cave -> L3 (eyes glow at night)
const ORC_CAVE_SRC = { x: 0, y: 0, w: 64, h: 64 };
// #94 orc TOWN SILO (the WAR-HOARD): a carved ent-idol totem, upgrading to a great living-tree gazebo at
// town LV5 — the orc parallel to the human guild hall earning its wings.
const orcSilo = new Image(); let orcSiloReady = false; orcSilo.onload = () => { orcSiloReady = true; }; orcSilo.onerror = () => {};
orcSilo.src = ROCKY_BASE + 'Cave_entrance1_ground_shadow.png';
const orcSilo5 = new Image(); let orcSilo5Ready = false; orcSilo5.onload = () => { orcSilo5Ready = true; }; orcSilo5.onerror = () => {};
orcSilo5.src = ORC_FOREST_BASE + 'Living gazebo1.png';
// content trim boxes (the 128px frames have transparent padding) — drawing from these centres the sprite on
// its tile and lets the LV label sit right above the VISIBLE art, not the empty frame top.
const ORC_SILO_SRC = { x: 23, y: 16, w: 82, h: 96 };
const ORC_SILO5_SRC = { x: 11, y: 10, w: 106, h: 107 };
function buildingArt(level) {
    if (typeof world !== 'undefined' && world && world.culture === 'orc') {
        if (level >= 3) return { img: orcCaveL3, src: ORC_CAVE_SRC, ready: orcCaveL3Ready, scale: 1.6 };
        if (level === 2) return { img: orcCaveL2, src: ORC_CAVE_SRC, ready: orcCaveL2Ready, scale: 1.6 };
        // L1 falls through to the tipi below (a small war-tent reads fine for a fresh orc)
    }
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

// #107 recipe INGREDIENT icons. The RECIPES tab shows a recipe's contents as imagery + a quantity badge
// instead of a wall of words. Goods that already have a PROCEDURAL icon (GOOD_ICON above: fish/lily/egg/milk/
// wool/truffle/grain) reuse it for consistency with the inventory; the rest map to a hand-picked CraftPix icon
// (star-crystal, ember, scroll-relic, etc.); anything left falls back to a 3-letter chip. Hover names the good.
const RECIPE_GOOD_ICON = {
    crops: 73, grass: 45, flower: 79, wood: 75, ore: 47,       // (match ITEMS)
    herb: 95, mushroom: 83, root: 85, berry: 90,                // forage
    crystal: 81, emberbloom: 111, relic: 119,                   // rare (star / ember / scroll)
    fowl: 91, 'meat-s': 71, 'meat-m': 66, 'meat-l': 70, meat: 66,   // hunt / livestock
};
for (const n of Object.values(RECIPE_GOOD_ICON)) itemIcon(n);
const GOOD_LABEL = {
    crops: 'crops', grass: 'grass', flower: 'flower', herb: 'herb', mushroom: 'mushroom', root: 'root',
    berry: 'berry', crystal: 'star-crystal', emberbloom: 'emberbloom', relic: "traveller's relic",
    fish: 'fish', fowl: 'fowl', 'meat-s': 'small game', 'meat-m': 'red meat', 'meat-l': 'prime cut', meat: 'meat',
    wool: 'wool', egg: 'egg', milk: 'milk', lily: 'lily', wood: 'wood', ore: 'ore', truffle: 'truffle', grain: 'grain',
};
// Draw one ingredient as a slot: the good's icon (procedural canvas, else CraftPix, else a 3-letter chip)
// + a quantity badge. Returns the slot's screen rect so the caller can register it for a hover tooltip.
function drawGoodSlot(x, y, sz, good, qty) {
    const canv = GOOD_ICON[good];   // existing procedural canvases (fish/lily/egg/milk/wool/truffle/grain)
    if (canv && canv.width) drawItemSlot(x, y, sz, null, qty, { canvas: canv });
    else if (RECIPE_GOOD_ICON[good]) drawItemSlot(x, y, sz, itemIcon(RECIPE_GOOD_ICON[good]), qty);
    else { drawItemSlot(x, y, sz, null, qty); drawText(ctx, String(good).slice(0, 3).toUpperCase(), x + 2, y + 2, '#c8ccd8'); }
    return { x, y, w: sz, h: sz, label: (GOOD_LABEL[good] || good).toUpperCase() };
}

const boardSheet = new Image(); let boardReady = false; boardSheet.onload = () => { boardReady = true; }; boardSheet.onerror = () => {};
boardSheet.src = './assets/craftpix-net-189780-free-top-down-pixel-art-guild-hall-asset-pack/PNG/Interior_objects.png';
const BOARD_EMPTY_SRC = { x: 0, y: 156, w: 41, h: 62 };
const BOARD_FULL_SRC = { x: 48, y: 156, w: 41, h: 62 };
const CHEST_CLOSED_SRC = { x: 248, y: 357, w: 20, h: 20 };   // treasure chest (same guild-hall sheet)
// #109 the 1-bit icon pack as a spritesheet (20x20 grid of 9x9), for the small over-head EMOTE tells so they
// match the new UI icon style. packEmote(n) blits icon n (1-based) tinted to a colour, supersampled+downscaled
// once per (n,size,colour) then cached — same clean-at-small pipeline as the top-bar icons. Returns null until
// the sheet loads (callers fall back to the hand-drawn glyph).
const packSheet = new Image(); let packReady = false;
packSheet.onload = () => { packReady = true; }; packSheet.onerror = () => {};
packSheet.src = './assets/icons/1bit-sheet.png';
const _packTints = {};
function packEmote(n, size, color) {
    if (!packReady || !packSheet.naturalWidth) return null;
    const key = n + ':' + size + ':' + color; let cv = _packTints[key];
    if (!cv) {
        const sx = ((n - 1) % 20) * 9, sy = Math.floor((n - 1) / 20) * 9, SS = size * 4;
        const [big, bx] = makeCanvas(SS, SS);
        bx.imageSmoothingEnabled = false; bx.drawImage(packSheet, sx, sy, 9, 9, 0, 0, SS, SS);
        bx.globalCompositeOperation = 'source-in'; bx.fillStyle = color; bx.fillRect(0, 0, SS, SS);
        const [c, cx] = makeCanvas(size, size);
        cx.imageSmoothingEnabled = true; cx.imageSmoothingQuality = 'high'; cx.drawImage(big, 0, 0, size, size);
        _packTints[key] = cv = c;
    }
    return cv;
}

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
const ORC_WELL_SRC = { x: 1, y: 497, w: 34, h: 41 };   // #94 the grass-FREE stone well (brown dirt base) for orc towns
function wellArt() {
    // orc towns always use the grass-FREE well; also use it in FALL/WINTER so the grass-base
    // well (WELL_SRC) doesn't clash with the autumn/snow ground in human towns (to-do #2).
    const w = (typeof world !== 'undefined') ? world : null;
    if (!w) return WELL_SRC;
    const season = w.seasonDef && w.seasonDef.name;
    if (w.culture === 'orc' || season === 'FALL' || season === 'WINTER') return ORC_WELL_SRC;
    return WELL_SRC;
}
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
// #94 orc desert: only the GROUND details (dirt specks, pebble + rock clusters — the TOP half of
// ground_grass_details.png), never the grass tufts. An assortment for character on the bare sand.
const ORC_GROUND_DECALS = [
    { x: 10, y: 14, w: 34, h: 26 }, { x: 96, y: 40, w: 34, h: 26 }, { x: 210, y: 70, w: 34, h: 26 },
    { x: 6, y: 96, w: 46, h: 32 }, { x: 120, y: 100, w: 46, h: 32 }, { x: 200, y: 106, w: 46, h: 30 },
    { x: 30, y: 40, w: 34, h: 26 }, { x: 250, y: 40, w: 40, h: 24 },
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
    // #94 orc biome sets (dead/fungal trees, ground mushrooms + bones, magma rocks)
    loadImageSet(ORC_FOREST_BASE, { ORCTREES: ORC_TREE_NAMES }, orcTreeImg, () => { orcTreeArtReady = true; });
    loadImageSet(ORC_ROCKY_BASE, { ORCROCKY: ORC_FLOWER_NAMES.concat(ORC_WHEAT_NAMES, ORC_BONE_NAMES) }, orcRockyImg, () => { orcRockyArtReady = true; });
    loadImageSet(ROCK_ART_BASE, { ORCROCKS: ORC_ROCK_NAMES }, orcRockImg, () => { orcRockArtReady = true; });
    loadImageSet(ORC_CACTUS_BASE, { ORCCACTI: ORC_CACTUS_NAMES }, orcCactusImg, () => { orcCactusArtReady = true; });
    loadImageSet(ORC_BURNED_BASE, { ORCBURNED: ORC_BURNED_NAMES }, orcBurnedImg, () => { orcBurnedArtReady = true; });
    loadAnimalArt();
    homeSheet.onload = () => { homeReady = true; };
    homeSheet.onerror = () => {};
    PRIO(homeSheet, 'high').src = HOME_BASE + 'exterior.png';
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
    PRIO(grassDetailsImg, 'high').src = HOME_BASE + 'ground_grass_details.png';
    plantsSheet.onload = () => { plantsReady = true; };
    plantsSheet.onerror = () => {};
    plantsSheet.src = PLANTS_BASE + 'Plants.png';
    suppliesSheet.onload = () => { suppliesReady = true; };
    suppliesSheet.onerror = () => {};
    suppliesSheet.src = PLANTS_BASE + 'Supplies.png';
}

// Draw a crop at tile-screen (sx,sy): real sheet frame when available, else procedural fallback.
// Crops stand STILL. There was a wind sway here — the top ~45% of every mature plant leaning ±1px on a
// performance.now sine phased by tile position — and it read as jitter rather than wind: at this sprite
// scale a 1px lean is a large fraction of the plant, and slicing the sprite in two to do it left a visible
// seam across the stem. A still field is the better picture (owner's call).
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
PRIO(charBody, 'high').src = CHAR_BASE + 'Swordsman_lvl1_Walk_body.png';
PRIO(charHead, 'high').src = CHAR_BASE + 'Swordsman_lvl1_Walk_head.png';
// #anim-migrate the RUN (8f) + IDLE (12f) tintable Parts — full activity cycles for the in-game farmers.
// Same 64px 4-row layout as the Walk parts. Loaded tolerant: until a sheet is ready its cycle is null and
// the renderer falls back to the walk-based frames (never throws, never blacks the game).
const charRunBody = new Image(), charRunHead = new Image(), charIdleBody = new Image(), charIdleHead = new Image();
for (const im of [charRunBody, charRunHead, charIdleBody, charIdleHead]) im.onerror = () => {};
charRunBody.src = CHAR_BASE + 'Swordsman_lvl1_Run_body.png';
charRunHead.src = CHAR_BASE + 'Swordsman_lvl1_Run_head.png';
charIdleBody.src = CHAR_BASE + 'Swordsman_lvl1_Idle_body.png';
charIdleHead.src = CHAR_BASE + 'Swordsman_lvl1_Idle_head.png';
const CHAR_FW = 64, CHAR_NCOLS = 6;
const CHAR_DIRS = { down: 0, side: 2, up: 3 };   // sheet rows by facing (row0 front, row3 back, row2 3/4-side)
let charBox = null;   // shared content bbox across ALL rows (keeps every direction aligned)
let charBoxGen = -1;  // which sheet-readiness generation the box was computed at
function charReady() { return charBodyReady && charHeadReady && charBody.naturalWidth > 0; }
const sheetOk = (im) => !!(im && im.complete && im.naturalWidth > 0);
// readiness generation: bumps as the run/idle sheets finish loading, so cached per-farmer frame sets
// (and the shared bbox) rebuild once per arrival instead of every frame.
function charGen() {
    return (charReady() ? 1 : 0) | (sheetOk(charRunBody) && sheetOk(charRunHead) ? 2 : 0)
         | (sheetOk(charIdleBody) && sheetOk(charIdleHead) ? 4 : 0);
}
function composeCharCell(col, row, body = charBody, head = charHead) {
    const [cv, cx] = makeCanvas(CHAR_FW, CHAR_FW);
    cx.imageSmoothingEnabled = false;
    cx.drawImage(body, col * CHAR_FW, row * CHAR_FW, CHAR_FW, CHAR_FW, 0, 0, CHAR_FW, CHAR_FW);
    cx.drawImage(head, col * CHAR_FW, row * CHAR_FW, CHAR_FW, CHAR_FW, 0, 0, CHAR_FW, CHAR_FW);
    return [cv, cx];
}
function computeCharBox() {
    let x0 = 99, x1 = -1, y0 = 99, y1 = -1;
    // UNION across every loaded peace sheet (walk + run + idle) so all activities share one crop —
    // every frame the same size, feet on the same line, zero jitter switching gaits.
    const sheets = [[charBody, charHead]];
    if (sheetOk(charRunBody) && sheetOk(charRunHead)) sheets.push([charRunBody, charRunHead]);
    if (sheetOk(charIdleBody) && sheetOk(charIdleHead)) sheets.push([charIdleBody, charIdleHead]);
    for (const [body, head] of sheets) {
        const ncols = Math.max(1, Math.round(body.naturalWidth / CHAR_FW));
        for (const row of Object.values(CHAR_DIRS)) for (let col = 0; col < ncols; col++) {
            const [, cx] = composeCharCell(col, row, body, head);
            const d = cx.getImageData(0, 0, CHAR_FW, CHAR_FW).data;
            for (let y = 0; y < CHAR_FW; y++) for (let x = 0; x < CHAR_FW; x++)
                if (d[(y * CHAR_FW + x) * 4 + 3] > 16) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        }
    }
    charBox = { x: x0, y: y0, w: Math.max(1, x1 - x0 + 1), h: Math.max(1, y1 - y0 + 1) };
    charBoxGen = charGen();
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
function tintedCharCell(col, row, hue, body = charBody, head = charHead) {
    const [bc, bcx] = makeCanvas(CHAR_FW, CHAR_FW); bcx.imageSmoothingEnabled = false;
    bcx.drawImage(body, col * CHAR_FW, row * CHAR_FW, CHAR_FW, CHAR_FW, 0, 0, CHAR_FW, CHAR_FW);
    tintPixels(bcx, CHAR_FW, CHAR_FW, hue, false);
    const [hc, hcx] = makeCanvas(CHAR_FW, CHAR_FW); hcx.imageSmoothingEnabled = false;
    hcx.drawImage(head, col * CHAR_FW, row * CHAR_FW, CHAR_FW, CHAR_FW, 0, 0, CHAR_FW, CHAR_FW);
    tintPixels(hcx, CHAR_FW, CHAR_FW, hue, true);
    const [out, ox] = makeCanvas(CHAR_FW, CHAR_FW); ox.imageSmoothingEnabled = false;
    ox.drawImage(bc, 0, 0); ox.drawImage(hc, 0, 0);
    return out;
}
const charCache = new Map();   // farmer -> { down, side, up } each a frame set (rebuilt when new sheets load)
function buildCharSets(f) {
    const gen = charGen();
    if (!charBox || charBoxGen !== gen) computeCharBox();
    const bx = charBox;
    const hueSeed = f.sheet.seed != null ? f.sheet.seed : hashString((f.sheet.memory && f.sheet.memory.id) || f.sheet.name);
    const hue = (hueSeed % 300) + 30;
    const dw = Math.max(1, Math.round(bx.w * ASSET_SCALE)), dh = Math.max(1, Math.round(bx.h * ASSET_SCALE));
    const frameFor = (col, row, body, head) => {
        const cell = tintedCharCell(col, row, hue, body, head);
        const [out, ox] = makeCanvas(dw, dh); ox.imageSmoothingEnabled = false;
        ox.drawImage(cell, bx.x, bx.y, bx.w, bx.h, 0, 0, dw, dh);
        return out;
    };
    // #anim-migrate full activity CYCLES (walk 6f / run 8f / idle 12f), tinted + cached per farmer, built
    // LAZILY per activity on first request so a whole town spawning doesn't tint 78 frames per head at once.
    const CYCLE_SHEETS = {
        walk: [charBody, charHead],
        run: [charRunBody, charRunHead],
        idle: [charIdleBody, charIdleHead],
    };
    const setForRow = (row) => {
        const set = { idle: frameFor(0, row, charBody, charHead), walk1: frameFor(1, row, charBody, charHead),
                      walk2: frameFor(4, row, charBody, charHead), work: frameFor(2, row, charBody, charHead),
                      sleep: frameFor(0, row, charBody, charHead) };
        const built = {};
        set.cycle = (k) => {
            if (built[k] !== undefined) return built[k];
            const sh = CYCLE_SHEETS[k];
            if (!sh || !sheetOk(sh[0]) || !sheetOk(sh[1])) return (built[k] = null);
            const n = Math.max(1, Math.round(sh[0].naturalWidth / CHAR_FW));
            const arr = []; for (let c = 0; c < n; c++) arr.push(frameFor(c, row, sh[0], sh[1]));
            return (built[k] = arr);
        };
        return set;
    };
    const sets = { down: setForRow(CHAR_DIRS.down), side: setForRow(CHAR_DIRS.side), up: setForRow(CHAR_DIRS.up) };
    sets._gen = gen;
    return sets;
}
function characterSprites(f) {
    let sets = charCache.get(f);
    if (!sets || sets._gen !== charGen()) { sets = buildCharSets(f); charCache.set(f, sets); }
    return sets[f.moveDir] || sets.down;   // pick the row matching current facing
}

// #sprite THE FARMERS ARE SWORDSMEN with the blade stripped for peacetime (they hold a hoe by day). In
// BATTLE we bring the sword BACK + the 8-frame attack swing, so a duel is a real exchange of blades. Layered
// parts: body (clothing tint) + head (hair tint) + sword (untinted); the back-sword sits BEHIND the body
// when facing away (up row). Same feet-anchored crop as the walk sprite, so the body stays aligned.
const BATTLE_PARTS = {};
['Idle_body', 'Idle_head', 'Idle_sword', 'Idle_sword_back', 'attack_body', 'attack_head', 'attack_sword', 'attack_sword_back',
 'Hurt_red', 'Hurt_sword', 'Hurt_sword_back', 'Death_body', 'Death_head', 'Death_sword', 'Death_sword_back']
    .forEach(n => { const im = new Image(); im.onerror = () => {}; im.src = CHAR_BASE + 'Swordsman_lvl1_' + n + '.png'; BATTLE_PARTS[n] = im; });
function battleReady() { const b = BATTLE_PARTS; return b.attack_body.complete && b.attack_body.naturalWidth > 0 && b.Idle_body.complete && b.Idle_body.naturalWidth > 0; }
// #anim-migrate readiness generation for the battle sheets (the Death parts can land after attack/idle) —
// cached battle sets rebuild once when a late sheet arrives, so the death cycle is never permanently missing.
function battleGen() {
    // #anim-migrate P2 (Codex): a cached battle set also consumes the attack/idle HEADS and every SWORD layer,
    // which can finish loading AFTER the bodies on a cold start. Keying the generation off a LOADED-COUNT of
    // EVERY battle part (loads are monotonic absent→present, so the count only rises) bumps the gen when any
    // late layer lands, so the set rebuilds once and a fighter is never left permanently headless/unarmed.
    const b = BATTLE_PARTS; let n = 0;
    for (const k in b) if (sheetOk(b[k])) n++;
    return n;
}
let battleBox = null, battleBoxGen = -1;
function battleCellRaw(prefix, col, row) {   // untinted composite (for the shared bbox)
    const [cv, cx] = makeCanvas(CHAR_FW, CHAR_FW); cx.imageSmoothingEnabled = false;
    const up = row === CHAR_DIRS.up, sword = up ? BATTLE_PARTS[prefix + '_sword_back'] : BATTLE_PARTS[prefix + '_sword'];
    const put = (part) => part && part.naturalWidth > 0 && cx.drawImage(part, col * CHAR_FW, row * CHAR_FW, CHAR_FW, CHAR_FW, 0, 0, CHAR_FW, CHAR_FW);
    if (up) put(sword);
    put(BATTLE_PARTS[prefix + '_body']); put(BATTLE_PARTS[prefix + '_head']);
    if (!up) put(sword);
    return cx;
}
function computeBattleBox() {
    let x0 = 99, x1 = -1, y0 = 99, y1 = -1;
    const rows = [CHAR_DIRS.down, CHAR_DIRS.side, CHAR_DIRS.up];
    const scan = (prefix, cols) => { for (const row of rows) for (let col = 0; col < cols; col++) {
        const d = battleCellRaw(prefix, col, row).getImageData(0, 0, CHAR_FW, CHAR_FW).data;
        for (let y = 0; y < CHAR_FW; y++) for (let x = 0; x < CHAR_FW; x++)
            if (d[(y * CHAR_FW + x) * 4 + 3] > 16) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    } };
    scan('Idle', 1); scan('attack', 8);
    if (sheetOk(BATTLE_PARTS.Death_body)) scan('Death', Math.max(1, Math.round(BATTLE_PARTS.Death_body.naturalWidth / CHAR_FW)));
    battleBox = { x: x0, y: y0, w: Math.max(1, x1 - x0 + 1), h: Math.max(1, y1 - y0 + 1) };
    battleBoxGen = battleGen();
}
function tintedBattleCell(prefix, col, row, hue) {
    const up = row === CHAR_DIRS.up, sword = up ? BATTLE_PARTS[prefix + '_sword_back'] : BATTLE_PARTS[prefix + '_sword'];
    const layer = (part, tint, hairOnly) => {
        const [c, cx] = makeCanvas(CHAR_FW, CHAR_FW); cx.imageSmoothingEnabled = false;
        if (part && part.naturalWidth > 0) cx.drawImage(part, col * CHAR_FW, row * CHAR_FW, CHAR_FW, CHAR_FW, 0, 0, CHAR_FW, CHAR_FW);
        if (tint) tintPixels(cx, CHAR_FW, CHAR_FW, hue, hairOnly);
        return c;
    };
    const [out, ox] = makeCanvas(CHAR_FW, CHAR_FW); ox.imageSmoothingEnabled = false;
    if (up && sword) ox.drawImage(layer(sword, false, false), 0, 0);
    ox.drawImage(layer(BATTLE_PARTS[prefix + '_body'], true, false), 0, 0);
    ox.drawImage(layer(BATTLE_PARTS[prefix + '_head'], true, true), 0, 0);
    if (!up && sword) ox.drawImage(layer(sword, false, false), 0, 0);
    return out;
}
const battleCache = new Map();
function buildBattleSets(f) {
    const gen = battleGen();
    if (!battleBox || battleBoxGen !== gen) computeBattleBox();
    if (!charBox || charBoxGen !== charGen()) computeCharBox();   // the rig the battle frames align to
    const bx = battleBox;
    const hueSeed = f.sheet.seed != null ? f.sheet.seed : hashString((f.sheet.memory && f.sheet.memory.id) || f.sheet.name);
    const hue = (hueSeed % 300) + 30;
    const dw = Math.max(1, Math.round(bx.w * ASSET_SCALE)), dh = Math.max(1, Math.round(bx.h * ASSET_SCALE));
    // #anim-migrate battle frames are drawn RIG-ALIGNED as the farmer's main body (not just an overlay):
    // each frame carries the offset from the peace-walk crop (charBox) to its own crop (battleBox), so
    // drawFarmer can anchor by the normal walk rig and the body never jitters when steel comes out.
    const rig = {
        dx: Math.round((bx.x - charBox.x) * ASSET_SCALE), dy: Math.round((bx.y - charBox.y) * ASSET_SCALE),
        w: Math.max(1, Math.round(charBox.w * ASSET_SCALE)), h: Math.max(1, Math.round(charBox.h * ASSET_SCALE)),
    };
    const frameFor = (prefix, col, row) => {
        const cell = tintedBattleCell(prefix, col, row, hue);
        const [out, ox] = makeCanvas(dw, dh); ox.imageSmoothingEnabled = false;
        ox.drawImage(cell, bx.x, bx.y, bx.w, bx.h, 0, 0, dw, dh);
        out._rig = rig;
        return out;
    };
    // the HURT flinch = the pre-reddened Hurt_red silhouette + the sword (the red flash, as a real pose)
    const hurtFrameFor = (col, row) => {
        const up = row === CHAR_DIRS.up, sword = up ? BATTLE_PARTS.Hurt_sword_back : BATTLE_PARTS.Hurt_sword;
        const [cell, cx] = makeCanvas(CHAR_FW, CHAR_FW); cx.imageSmoothingEnabled = false;
        const put = (part) => part && part.naturalWidth > 0 && cx.drawImage(part, col * CHAR_FW, row * CHAR_FW, CHAR_FW, CHAR_FW, 0, 0, CHAR_FW, CHAR_FW);
        if (up) put(sword); put(BATTLE_PARTS.Hurt_red); if (!up) put(sword);
        const [out, ox] = makeCanvas(dw, dh); ox.imageSmoothingEnabled = false;
        ox.drawImage(cell, bx.x, bx.y, bx.w, bx.h, 0, 0, dw, dh);
        out._rig = rig;
        return out;
    };
    // #anim-migrate the Hurt_red sheet's first 2 columns are EMPTY (measured) — the flinch starts at col 2.
    // Including them would draw a floating sword with no body (Hurt_sword IS populated there), so only
    // columns where the red silhouette itself has pixels make the cycle.
    const hurtCols = [];
    if (BATTLE_PARTS.Hurt_red.naturalWidth > 0) {
        const hc = Math.round(BATTLE_PARTS.Hurt_red.naturalWidth / CHAR_FW);
        for (let c = 0; c < hc; c++) {
            // check the whole 4-row column strip for silhouette pixels
            let has = false;
            for (let r = 0; r < 4 && !has; r++) {
                const [, cx] = makeCanvas(CHAR_FW, CHAR_FW); cx.imageSmoothingEnabled = false;
                cx.drawImage(BATTLE_PARTS.Hurt_red, c * CHAR_FW, r * CHAR_FW, CHAR_FW, CHAR_FW, 0, 0, CHAR_FW, CHAR_FW);
                const d = cx.getImageData(0, 0, CHAR_FW, CHAR_FW).data;
                for (let i = 3; i < d.length; i += 4) if (d[i] > 16) { has = true; break; }
            }
            if (has) hurtCols.push(c);
        }
    }
    if (!hurtCols.length) hurtCols.push(0);
    const setForRow = (row) => {
        const ac = Math.max(1, Math.round(BATTLE_PARTS.attack_body.naturalWidth / CHAR_FW));
        const atk = []; for (let c = 0; c < ac; c++) atk.push(frameFor('attack', c, row));
        // #anim-migrate P2 (Codex): only build a hurt cycle when the Hurt_red silhouette is actually loaded —
        // otherwise leave it NULL so drawFarmer keeps the normal pose + red-flash fallback. Without this, an
        // unloaded/404'd Hurt_red still yields a truthy array of TRANSPARENT frames (hurtCols falls back to [0]),
        // and drawFarmer would draw that empty frame + suppress the fallback → the farmer vanishes on a hit.
        const hurt = sheetOk(BATTLE_PARTS.Hurt_red) ? hurtCols.map(c => hurtFrameFor(c, row)) : null;
        // the DEATH fall (7f, sword clattering with them) — held on the last frame while downed
        let death = null;
        if (sheetOk(BATTLE_PARTS.Death_body) && sheetOk(BATTLE_PARTS.Death_head)) {
            const dc = Math.max(1, Math.round(BATTLE_PARTS.Death_body.naturalWidth / CHAR_FW));
            death = []; for (let c = 0; c < dc; c++) death.push(frameFor('Death', c, row));
        }
        return { idle: frameFor('Idle', 0, row), atk, hurt, death };
    };
    const sets = { down: setForRow(CHAR_DIRS.down), side: setForRow(CHAR_DIRS.side), up: setForRow(CHAR_DIRS.up) };
    sets._gen = gen;
    return sets;
}
function battleSprites(f) {
    let s = battleCache.get(f);
    if (!s || s._gen !== battleGen()) { s = buildBattleSets(f); battleCache.set(f, s); }
    return s[f.moveDir] || s.down;
}
// is this (human) farmer fighting? then they draw their sword — a raid duel (mustered on a struck line) OR
// a wilderness clash with a foe/beast (combatStance/fight).
function farmerInBattle(f) {
    if (f.sheet.culture === 'orc' || !charReady() || !battleReady()) return false;
    if (world.raidEvent && world.raidEvent.struck && (f._skirmish || f.state === 'muster')) return true;
    return f.state === 'fight' || f.combatStance === 'fight';
}

// #3.1 orc farmers wear the real ORC sprite (the DM's foe pack, already loaded as threatImg.orc) instead of
// the re-skinned human farmer. The pack is a 4x4 grid of 64px frames; we crop the character out of its padded
// cell, scale it to a farmer-ish height (orcs a touch taller), and slice a few idle columns so it still has a
// little life. Facings are directional off the sheet rows (down=0, up/back=1, side/left=2, right=3).
const orcCharCache = new Map();
function orcSpriteReady() { return orcFarmerImg && orcFarmerImg.complete && orcFarmerImg.naturalWidth > 0; }
// readiness generation for the orc activity sheets — cached sets rebuild once per late-arriving sheet
function orcGen() {
    return (orcSpriteReady() ? 1 : 0) | (sheetOk(orcFarmerAnim.walk) ? 2 : 0) | (sheetOk(orcFarmerAnim.run) ? 4 : 0)
         | (sheetOk(orcFarmerAnim.attack) ? 8 : 0) | (sheetOk(orcFarmerAnim.hurt) ? 16 : 0) | (sheetOk(orcFarmerAnim.death) ? 32 : 0);
}
function orcCharSets(f) {
    const img = orcFarmerImg, FW = 64;
    const cols = Math.max(1, Math.round(img.naturalWidth / FW));
    // Directional (256x256 sheet = 4 rows): ROW 0 = front (down), ROW 1 = BACK view (up — orcs face away as they
    // walk up), ROW 2 = side profile facing LEFT (mirrored by facing in drawFarmer), ROW 3 = right. Crop the body
    // with the feet near the bottom edge so there's no empty gap (the orc foot-shadow is disabled anyway).
    const sx0 = 12, sy0 = 8, sw = 40, sh = 40;
    // #orc-scale player: orc TOWNSFOLK looked like children beside the raiders (26px vs the foes'
    // ~35px). Orcs are big — draw them at raider scale so an orc town reads as an orc town.
    const targetH = 34, scale = targetH / sh;
    const dw = Math.max(1, Math.round(sw * scale)), dh = Math.max(1, Math.round(sh * scale));
    const frameCol = (col, row) => {
        const c = Math.min(col, cols - 1);
        const [out, ox] = makeCanvas(dw, dh); ox.imageSmoothingEnabled = false;
        ox.drawImage(img, c * FW + sx0, row * FW + sy0, sw, sh, 0, 0, dw, dh);
        return out;
    };
    // #anim-migrate full activity cycles off the REAL orc sheets (walk 6f / run 8f / attack 8f / hurt 6f /
    // death 8f + a 4f idle breathe). Composed from the FULL 64px cell (an axe swing overflows the idle crop)
    // and rig-stamped back to the idle crop so drawFarmer anchors them without jitter. Lazy per activity.
    const cellD = Math.max(1, Math.round(FW * scale));
    const rig = { dx: Math.round(-sx0 * scale), dy: Math.round(-sy0 * scale), w: dw, h: dh };
    const cellFrame = (src, col, row) => {
        const [out, ox] = makeCanvas(cellD, cellD); ox.imageSmoothingEnabled = false;
        ox.drawImage(src, col * FW, row * FW, FW, FW, 0, 0, cellD, cellD);
        out._rig = rig;
        return out;
    };
    const CYCLE_SRC = { idle: img, walk: orcFarmerAnim.walk, run: orcFarmerAnim.run,
                        attack: orcFarmerAnim.attack, hurt: orcFarmerAnim.hurt, death: orcFarmerAnim.death };
    const setRow = (row) => {
        const set = { idle: frameCol(0, row), walk1: frameCol(1, row), walk2: frameCol(2, row), work: frameCol(1, row), sleep: frameCol(0, row) };
        const built = {};
        set.cycle = (k) => {
            if (built[k] !== undefined) return built[k];
            const src = CYCLE_SRC[k];
            if (!sheetOk(src)) return (built[k] = null);
            const n = Math.max(1, Math.round(src.naturalWidth / FW));
            const arr = []; for (let c = 0; c < n; c++) arr.push(cellFrame(src, c, row));
            return (built[k] = arr);
        };
        return set;
    };
    const sets = { down: setRow(0), side: setRow(2), up: setRow(1) };   // #anim-migrate row1 = back/up (row3 is right) — see the orc mapping at the DM foe config
    sets._gen = orcGen();
    return sets;
}

function farmerSprites(f) {
    if (f.sheet.culture === 'orc' && orcSpriteReady()) {
        let sets = orcCharCache.get(f);
        if (!sets || sets._gen !== orcGen()) { sets = orcCharSets(f); orcCharCache.set(f, sets); }
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

// #card-anim (owner, task #8) — the SHOWCASE walker for popup cards: the improved full walk cycle
// (6f orc sheets / 6f human side rows; graceful 2-frame fallback), always FACING RIGHT, rig-aware.
// One helper so every sprite-featuring modal shares the same look.
function showcaseWalkFrames(f, mode = 'walk') {
    let sets = null;
    if (f.sheet.culture === 'orc' && orcSpriteReady()) {
        sets = orcCharCache.get(f);
        if (!sets || sets._gen !== orcGen()) { sets = orcCharSets(f); orcCharCache.set(f, sets); }
    } else if (charReady()) {
        sets = charCache.get(f);
        if (!sets || sets._gen !== charGen()) { sets = buildCharSets(f); charCache.set(f, sets); }
    }
    // Codex #74-6 — the two sheets DISAGREE on which way "side" faces: the ORC side row faces LEFT
    // (mirror for right), the HUMAN side row already faces RIGHT (drawFarmer's documented contract —
    // mirroring it made human showcase walkers march backwards out of the card).
    const side = sets && (sets.side || sets.left);
    if (side) {
        const mirror = f.sheet.culture === 'orc';
        // #card-state (owner) — a DOWNED farmer's card shows the laying pose (the death cycle's final
        // frame, exactly what the field renderer holds); brink/walk use the walk cycle (brink adds the
        // red injury flash at draw). Falls through to walking frames when a cycle sheet isn't loaded.
        if (mode === 'downed') {
            const death = f.sheet.culture === 'orc'
                ? (side.cycle && side.cycle('death'))
                : ((charReady() && battleReady()) ? (battleSprites(f) || {}).death : null);
            if (death && death.length && death[death.length - 1]) return { frames: [death[death.length - 1]], mirror };
        }
        const cyc = side.cycle && side.cycle('walk');
        if (cyc && cyc.length && cyc[0]) return { frames: cyc, mirror };
        const two = [side.walk1, side.walk2].filter(Boolean);
        if (two.length) return { frames: two, mirror };
    }
    if (!spriteCache.has(f)) spriteCache.set(f, makeFarmerSprites(f.sheet));
    const s = spriteCache.get(f);
    return { frames: [s.walk1, s.walk2].filter(Boolean), mirror: false };
}
// Draw the showcase CENTRED on (cx, centerY) — vertical centring is the caller's contract (owner: the
// walker sat too low when callers guessed a nominal body height). Returns the anchor box {x,y,w,h}
// so callers can hang overlays — e.g. a discovered object — off it. `mode`: 'walk' | 'downed' (laying,
// held on the death cycle's last frame) | 'brink' (walk + the field renderer's red injury flash).
function drawShowcaseWalker(f, cx, centerY, S = 1.6, fps = 7, mode = 'walk') {
    const { frames, mirror } = showcaseWalkFrames(f, mode);
    if (!frames.length || !frames[0]) return null;
    const fr = frames[Math.floor(performance.now() / 1000 * fps) % frames.length];
    const rig = fr._rig;
    const bw = (rig ? rig.w : fr.width) * S, bh = (rig ? rig.h : fr.height) * S;
    const ax = Math.round(cx - bw / 2), ay = Math.round(centerY - bh / 2);
    ctx.imageSmoothingEnabled = false;
    if (mirror) {
        ctx.save(); ctx.translate(ax + bw, ay); ctx.scale(-1, 1);
        ctx.drawImage(fr, rig ? Math.round(rig.dx * S) : 0, rig ? Math.round(rig.dy * S) : 0, Math.round(fr.width * S), Math.round(fr.height * S));
        ctx.restore();
    } else {
        ctx.drawImage(fr, ax + (rig ? Math.round(rig.dx * S) : 0), ay + (rig ? Math.round(rig.dy * S) : 0), Math.round(fr.width * S), Math.round(fr.height * S));
    }
    // #card-state 'brink' — the exact red flash the field uses for the badly hurt, pulsing so a
    // "pulled back from the brink" card reads as fragile, not fine
    if (mode === 'brink' && Math.floor(performance.now() / 280) % 2) {
        ctx.fillStyle = 'rgba(224,64,48,0.42)';
        ctx.fillRect(ax + 2, ay + 2, Math.round(bw) - 4, Math.round(bh) - 4);
    }
    return { x: ax, y: ay, w: bw, h: bh };
}
// #card-close (owner, task #8) — the shared X button for dismissable cards: hover plate so it reads
// as a button. Clicking anywhere still dismisses (unchanged behaviour); the X is the visible door.
function drawCardClose(rx, ry) {
    const hot = inRect(mouse, { x: rx - 2, y: ry - 2, w: 13, h: 13 });
    if (hot) { ctx.fillStyle = 'rgba(220,120,110,0.28)'; ctx.fillRect(rx - 2, ry - 2, 13, 13); }
    drawText(ctx, 'X', rx + 1, ry + 1, hot ? '#f0b0a8' : '#b08078');
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
    // #94 ORC BIOME: swap the whole living forest for a dead, fungal, rocky wasteland. Returns early with
    // orc art when it's loaded; if an orc asset hasn't loaded yet we return null (a bare tile) rather than
    // fall through to a GREEN human sprite — the orc land never flashes green.
    if (world.culture === 'orc') {
        if (t === T.TREE) {
            // ~1/3 charred burned trees, the rest dead white trees + pink mushroom-trees
            const img = (hash2(i, j, 63) % 3 === 2)
                ? pickLoadedImage(orcBurnedImg, ORC_BURNED_NAMES, i, j, 65)
                : pickTieredImage(orcTreeImg, ORC_TREE_NAMES, i, j, 63, obstacleTier(i, j));
            if (!img) return null;
            const { w, h } = wildDims(img);
            return { img, w, h, anchor: 0.82, depth: 0.4, seed: hash2(i, j, 73), tree: true, chopKey: i + ',' + j };
        }
        if (t === T.FLOWER) {
            // mostly black ground mushrooms, with the occasional CACTUS — the only green in the wastes
            const cactus = (hash2(i, j, 77) % 4) === 0;
            const img = cactus ? pickLoadedImage(orcCactusImg, ORC_CACTUS_NAMES, i, j, 78)
                               : pickLoadedImage(orcRockyImg, ORC_FLOWER_NAMES, i, j, 64);
            if (!img) return null;
            const { w, h } = wildDims(img);
            return { img, w, h, anchor: cactus ? 0.82 : 0.72, depth: -1 };
        }
        if (t === T.WHEAT) {
            const img = pickLoadedImage(orcRockyImg, ORC_WHEAT_NAMES, i, j, 66);
            if (!img) return null;
            const { w, h } = wildDims(img);
            return { img, w, h, anchor: 0.72, depth: -1 };
        }
        if (t === T.ROCK) {
            const img = pickTieredImage(orcRockImg, ORC_ROCK_NAMES, i, j, 68, obstacleTier(i, j));
            if (!img) return null;
            const { w, h } = wildDims(img);
            return { img, w, h, anchor: 0.86, depth: -0.25 };
        }
        if (t === T.BONES) {   // rare dragon skeleton — scaled to ~half so the 256px full sheet reads as a landmark, not a wall
            const img = pickLoadedImage(orcRockyImg, ORC_BONE_NAMES, i, j, 61);
            if (!img) return null;
            const { w, h } = wildDims(img);
            return { img, w: Math.round(w * 0.5), h: Math.round(h * 0.5), anchor: 0.62, depth: -0.4 };
        }
        // T.STUMP falls through to the shared stump art below (a chopped remnant reads fine either way)
    }
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
// Only the T-enum -> semantic-name mapping stays here; the spread VALUES moved into tilehash.js, because
// they decide persistent sprite placement and so belong behind the compatibility fingerprint (Codex #57).
function wildJitter(i, j, t) {
    return tileJitter(i, j, t === T.TREE ? 'tree' : t === T.ROCK ? 'rock' : t === T.STUMP ? 'stump' : 'other');
}
// #banding PRE-SCALED SPRITE CACHE. drawWild used to nearest-neighbour downscale every wild sprite to
// ASSET_SCALE (0.76) on EVERY FRAME. At a fractional ratio NN drops source rows unevenly, which is literally
// "lines running through" a sprite — and because the CRT shader lays its scanlines in SCREEN space while that
// artefact lives in SPRITE space, the two beat against each other the moment the camera moves. That is why it
// reads as banding while following a farmer and is easy to miss while dragging.
//
// Scaling ONCE into a cache fixes both halves: the resample happens with smoothing (rows are averaged, not
// dropped) and the per-frame blit becomes a 1:1 integer copy, so there is nothing left to beat. It is also
// less work per frame — the downscale stops being redone 60 times a second for every bush on screen.
//
// Keyed by source + target size. The wild set is ~50 images at one size each, so this stays small; it is
// cleared with the terrain cache when art lands, so a late-arriving sheet cannot leave a stale scale behind.
const _scaledSprites = new Map();
// Codex #62-3 — procedural fallback sources are CANVASES, which have neither `assetName` nor `src`, so they
// all keyed as `undefined|WxH`. Every procedural tree species and season is 16x22, so in an art-less or
// failed-load session they collapsed onto whichever tree was cached first — one tree, repeated everywhere.
// Canvases get an identity token from a WeakMap instead (no leak: the entry dies with the canvas); Images
// keep their URL/name key so two Images of the same art still share one scaled copy.
let _spriteIdSeq = 0;
const _spriteIds = new WeakMap();
function spriteKey(src) {
    if (src.assetName) return 'n:' + src.assetName;
    if (src.src) return 'u:' + src.src;
    let id = _spriteIds.get(src);
    if (id === undefined) { id = ++_spriteIdSeq; _spriteIds.set(src, id); }
    return 'c:' + id;
}
function scaledSprite(img, w, h) {
    const key = spriteKey(img) + '|' + w + 'x' + h;
    let c = _scaledSprites.get(key);
    if (!c) {
        const [cv, cx] = makeCanvas(w, h);
        cx.imageSmoothingEnabled = true;
        cx.imageSmoothingQuality = 'high';
        cx.drawImage(img, 0, 0, w, h);
        _scaledSprites.set(key, cv);
        c = cv;
    }
    return c;
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
    // 1:1 integer blit of a sprite scaled once — see scaledSprite above.
    ctx.drawImage(
        scaledSprite(spec.img, spec.w, spec.h),
        Math.floor(x - spec.w / 2),
        Math.floor(baseY - spec.h * spec.anchor + (spec.nudgeY || 0))
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
    if (t !== T.TREE && t !== T.STUMP && t !== T.WHEAT && t !== T.FLOWER && t !== T.ROCK && t !== T.BONES) return;
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

// bird_fly_animation.png: 432x1024 = 3 duplicate columns x 16 rows of 144x64 cells.
// It's a "fly away" cinematic — the bird GROWS from a speck (rows 1-4) then flaps
// up-right and FADES OUT over the last rows. Measured peak (max) alpha per row of
// the col-0 cell: rows 4-12 are SOLID (max alpha = 1.0), rows 13/14/15 fade to
// 0.70/0.40/0.25 (ghosts). So the flap MUST come from solid rows only.
// We use adjacent rows 9/10/11 (all max-alpha 1.0, ~17px wide → consistent crow
// size, so it flaps without visibly growing) as a clean upstroke/glide/downstroke
// cycle. These are the MEASURED bird-only content boxes (green grass specks that
// are baked into the sheet excluded); all frames face RIGHT.
const BIRD_FLY_FRAMES = [
    { sx: 67, sy: 10 * 64 + 8, w: 17, h: 15 },    // row 10 — wings raised (upstroke)
    { sx: 72, sy: 11 * 64 + 6, w: 19, h: 12 },    // row 11 — wings spread level (glide)
    { sx: 62, sy:  9 * 64 + 9, w: 17, h: 12 },    // row 9  — wings swept down (downstroke)
];
const BIRD_FLY_SCALE = 0.7;   // ~17-19px frame -> ~12-13px on screen — MATCHES the perched crow (14px content
                              // drawn to ~11px effective) and stays SMALLER than a 16px farmer. (1.5 rendered the
                              // whole bird ~29px = bigger than a farmer, so the crow looked enormous in flight.)

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
                    // draw one measured, uncropped flap frame (see BIRD_FLY_FRAMES),
                    // bird-bbox-centered just above the anchor so no wing ever clips.
                    // (The sheet's 3 columns are pixel-identical for these rows.)
                    const f = BIRD_FLY_FRAMES[Math.floor(t * 12 + b.seed) % BIRD_FLY_FRAMES.length];
                    const dw = Math.round(f.w * BIRD_FLY_SCALE), dh = Math.round(f.h * BIRD_FLY_SCALE);
                    ctx.drawImage(birdFlySheet, f.sx, f.sy, f.w, f.h, -Math.round(dw / 2), -2 - Math.round(dh / 2), dw, dh);
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

// hash2/rand2/noise2 were a verbatim duplicate of farm.js's tileHash/tileRand/tileNoise (numerically
// identical over 40k samples). They now come from the shared tilehash.js — same functions, same salts, so
// nothing renders differently — and the aliases keep every call site below unchanged. The point of sharing
// them is that tests/compat.mjs can fingerprint a DOM-free module, which it could never do for main.js.
function pickTile(list, i, j, seed = 0) {
    return list[pickIndex(i, j, seed, list.length)];
}

function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.max(0, Math.min(255, Math.round(((n >> 16) & 255) * f)));
    const g = Math.max(0, Math.min(255, Math.round(((n >> 8) & 255) * f)));
    const b = Math.max(0, Math.min(255, Math.round((n & 255) * f)));
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}


// Bake ONE chunk's ground into a cached canvas. Unrevealed tiles bake as fog (a near-black
// diamond with a faint hash weave — no tile data is read for them, so rendering never
// forces the world to generate scenery nobody has walked to). Revealed tiles on the fog
// frontier get a soft dark rim so the boundary reads as a receding veil, not a hard cut.
function bakeChunk(cx, cy) {
    const [cv, bctx] = makeCanvas(CHUNK_PX_W, CHUNK_PX_H);
    const org = chunkOrigin(cx, cy);
    const season = world.seasonDef;
    const winter = season.name === 'WINTER';
    // #94 orc lands are a rocky, scorched DESERT — no grass, no green. Override the seasonal ground palette
    // with warm sun-baked earth (a touch redder in summer, dust-bleached in winter) and swap the floral
    // speckle for dusty pebbles; the green grass decals are skipped below.
    const orc = world.culture === 'orc';
    let [GRASS_A, GRASS_B] = season.ground;
    let TILLED_C = season.tilled;
    let flower = winter ? '#e8eef4' : season.name === 'FALL' ? '#c89040' : season.name === 'SUMMER' ? '#f0d84a' : '#e8709a';
    if (orc) {
        const DESERT = {
            SPRING: ['#9d7448', '#8f6a40'], SUMMER: ['#ab7440', '#9c683b'],
            FALL:   ['#946a44', '#87603e'], WINTER: ['#8c7a62', '#7f6d58'],
        }[season.name] || ['#9d7448', '#8f6a40'];
        GRASS_A = DESERT[0]; GRASS_B = DESERT[1];
        TILLED_C = winter ? '#6b5946' : '#5d4229';
        flower = winter ? '#c6baa6' : '#7c6852';   // dusty pebble specks, never floral
    }
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
                if (t === T.GRASS && grassDetailsReady && scatter < density && !winter) {   // no tufts under snow
                    // orc desert scatters ONLY ground details (dirt/pebble/rock); human ground mixes grass + dirt
                    const set = orc ? ORC_GROUND_DECALS : (rand2(i, j, 42) < 0.18 ? DIRT_DECALS : GRASS_DECALS);
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
    if (terrainDirty) { chunkCanvases.clear(); _scaledSprites.clear(); terrainDirty = false; }
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

// #P1 THE RAID SEAM (render-only) — when a raid is telegraphed or underway, the orc neighbour's DESERT bleeds into
// the fog in the threat direction: the ground the warband musters on and marches across. It reads ONLY display
// state (pendingRaid.dir / raidEvent), paints over FOG tiles only (never touches world.tiles / reveal / farmers),
// and draws no world.rand — so the sim + determinism are untouched. It gives "a warband gathers to the north" a
// place to actually look: the unexplored dark in that bearing becomes their scorched land, and the raiders (which
// already spawn at the map edge along the same bearing) march out of it.
// #P1 cosmetic MUSTER figures — the orc warband ASSEMBLING on the red approach zone during the raid telegraph,
// before it crosses. PURE DISPLAY: they exist nowhere in the sim (not encounters, not raidEvent), draw through the
// same drawThreat as the real raiders, and hand straight off to raidEvent.raiders the instant the raid lands. The
// positions are a pure fn of the seeded bearing + a wall-clock idle sway (display only) — no world.rand touched.
function raidMusterFigures(pr) {
    const dir = pr.dir, n = 6, t = performance.now(), out = [];
    // #fog-adaptive muster right at the REVEALED FRONTIER — each figure uses ITS OWN angle's frontier and
    // stands a couple tiles INSIDE the revealed edge, so the warband masses ON KNOWN GROUND at the border
    // (full opacity, plainly visible) rather than sunk in the deep fog where the low-opacity rule hides them.
    for (let k = 0; k < n; k++) {
        const ang = dir + (k - (n - 1) / 2) * 0.26;
        const co = Math.cos(ang), si = Math.sin(ang);
        const fr = world.frontierDist ? world.frontierDist(ang) : (world.townRadius ? world.townRadius() + 14 : 30);
        const d = fr - 3 + 0.6 * Math.sin(t / 640 + k * 1.7);   // just inside the revealed edge, restless
        const i = CENTER + co * d, j = CENTER + si * d;
        out.push({ kind: 'orc', def: { color: '#6f8f3f' }, i, j, facing: (i - j) > 0 ? -1 : 1,
                   mvI: -co, mvJ: -si,      // face in toward the town (mv picks the 4-direction sheet row)
                   art: k % 2 ? 3 : 2 });   // #orc-vs-orc same variant parity as the real raiders they become
    }
    return out;
}

const RAID_TINT = { A: '224,72,56', B: '196,56,44' };   // a danger RED, keyed to the "RAIDERS CLOSING" toast
const SEAM_BLEED = 3;   // #seam how many tiles the danger red bleeds INTO the fog past the revealed edge (the band's thickness)
const seamHash = (i, j) => { let h = (i * 374761393 + j * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };   // pure position hash, 0..1
function drawRaidSeam() {
    // #seam-warning-only the red danger seam belongs to the INITIAL RAID WARNING alone — the telegraph phase,
    // while a warband gathers past the fog and closes on the town. The moment it LANDS (world.raidEvent) the
    // fight itself is the drama; NO red wash over the battlefield. So we key off pendingRaid only and bail once
    // the raid has arrived.
    const pr = world.pendingRaid;
    if (!pr) return;
    const dir = pr.dir;
    // a low ember while a warband merely GATHERS; brighter once the alarm has sounded (detected).
    // kept SEMI-TRANSPARENT (the terrain reads through) so it's a danger overlay, like the toast — not a repaint.
    const hot = !!pr.detected;
    const base = hot ? 0.36 : 0.22;   // #seam clearly-visible danger band once the alarm sounds (a low ember while it merely gathers)
    // the ALARM PULSE: while merely gathering the seam barely breathes; once the alarm sounds it throbs —
    // a sharp heartbeat (fast attack, slow decay) rather than a sine shimmer, so it reads as the alarm itself.
    const tNow = performance.now();
    const pulse = hot
        ? 0.14 * Math.pow(0.5 + 0.5 * Math.sin(tNow / 260), 3)   // ~1.6s heartbeat, spiky
        : 0.04 * Math.sin(tNow / 700);                            // faint slow breathing
    const half = 0.85;   // fan half-angle (raiders fan ~±0.5; a touch wider so it reads as "their land", not a beam)
    // #seam a clean, thick danger BAND at the town's OUTER fog frontier in the bearing. It's placed RADIALLY at
    // the per-angle revealed frontier (so it follows the disc's rim), but every sample is CLAMPED near the median
    // reveal radius so a scouted corridor can't drag the band deep into the black (the old "region 2"), and it's
    // kept TIGHT so it never tapers back over open ground to the square (the old "region 3"). Being radial around
    // the rim — not per-tile edge detection — interior fog pockets in a well-explored town DON'T light up into a
    // red wash (the bug that painted the whole screen). The median is sampled around the WHOLE circle so one long
    // corridor can't skew it.
    let medR = 26;
    if (world.frontierDist) {
        const s2 = [];
        for (let a = 0; a < 6.2832; a += 6.2832 / 16) s2.push(world.frontierDist(a));
        s2.sort((x, y) => x - y);
        medR = s2[Math.floor(s2.length / 2)] || 26;
    }
    const capR = medR + 8;                                        // the band never sits further out than this (corridor guard)
    const SAMP = 24;
    const fr = new Float32Array(SAMP + 1);                        // per-angle frontier across the fan, each clamped to capR
    for (let s = 0; s <= SAMP; s++) {
        const a = dir - half + (2 * half) * (s / SAMP);
        fr[s] = Math.min(world.frontierDist ? world.frontierDist(a) : medR, capR);
    }
    const cs = [screenToTile(0, 0), screenToTile(GW, 0), screenToTile(GW, GH), screenToTile(0, GH)];
    let iMin = Infinity, iMax = -Infinity, jMin = Infinity, jMax = -Infinity;
    for (const c of cs) { iMin = Math.min(iMin, c.i); iMax = Math.max(iMax, c.i); jMin = Math.min(jMin, c.j); jMax = Math.max(jMax, c.j); }
    iMin = Math.floor(iMin); iMax = Math.ceil(iMax); jMin = Math.floor(jMin); jMax = Math.ceil(jMax);
    for (let j = jMin; j <= jMax; j++) {
        for (let i = iMin; i <= iMax; i++) {
            const di = i - CENTER, dj = j - CENTER, r = Math.hypot(di, dj) || 1;
            let da = Math.atan2(dj, di) - dir; da = Math.atan2(Math.sin(da), Math.cos(da));   // wrap to [-pi, pi]
            const h = seamHash(i, j);
            const hj = half + (h - 0.5) * 0.14;                       // ragged fan sides
            if (Math.abs(da) > hj) continue;                          // outside the threat bearing
            // this tile's DEPTH past the (clamped) local frontier: a tight band straddling the rim — a short lip
            // on the revealed side, fading SEAM_BLEED tiles into the fog. That's the whole band; nothing else paints.
            const idx = (da + half) / (2 * half) * SAMP, i0 = Math.max(0, Math.min(SAMP - 1, Math.floor(idx)));
            const frA = fr[i0] + (fr[i0 + 1] - fr[i0]) * (idx - i0);
            const depth = r - frA + (h - 0.5) * 2;                    // >0 = fog side; +grain for a ragged shoreline
            let prox;
            if (depth >= 0) prox = 1 - depth / (SEAM_BLEED + 0.5);    // fade into the dark
            else prox = 1 + depth / 2.5;                              // a short lip back onto revealed ground
            if (prox <= 0.03) continue;
            const ang = smooth(1 - Math.abs(da) / hj);                // soften toward the fan's sides
            const grain = 0.82 + h * 0.36;
            const a = Math.max(0, Math.min(0.42, (base + pulse) * ang * prox * grain));
            if (a < 0.02) continue;
            const sx = cam.x + isoX(i, j) - TILE_W / 2, sy = cam.y + isoY(i, j);
            ctx.save(); ctx.globalAlpha = a;
            fillDiamond(ctx, sx, sy, `rgb(${h < 0.5 ? RAID_TINT.A : RAID_TINT.B})`);
            ctx.restore();
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

let farmerBubbles = [];   // #bubble-overlay: {f, sx} per on-screen farmer this frame, drawn on top post-sort
function collectDrawables() {
    const list = [];
    farmerBubbles = [];   // rebuilt each frame alongside the y-sorted list
    // Codex #44 P1 [EFFICIENCY] — cull off-screen dynamic objects (crops/facilities) BEFORE allocating a draw
    // closure and entering the per-frame y-sort. A large town has hundreds of crops far outside the viewport; only
    // the on-screen neighbourhood needs to be built + sorted. Generous pad so a tall sprite whose footline sits just
    // past the bottom edge (it's drawn UPWARD from there) is never clipped. Uses live GW/GH (they change on resize).
    const CULL = 100;
    const offScreen = (sx, sy) => sx < -CULL || sx > GW + CULL || sy < -CULL || sy > GH + CULL;

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

    // #pens dedicated livestock enclosures — an inner fence around each animal facility's region,
    // with a gate gap on the house-facing side, plus a trampled-ground wash. Render-only (draw math
    // uses no world.rand); the sim-side containment lives in farm.js #tickProducers.
    // Trampled ground under a pen: ONE earth tone for all three, varying only in how hard the ground is
    // worked. These used to be tinted by what lived on them — straw-yellow (196,168,90) for the coop and
    // a wool cream (214,206,178) for the fold, against this brown for the cattle pen — which meant two of
    // the three paddocks came out LIGHTER than the surrounding grass and one darker, so a row of pens read
    // as a row of mismatched floor swatches rather than as worn earth. Livestock chew a yard down hardest;
    // hens scratch it lightest.
    const PEN_WASH = { coop: 'rgba(122,88,56,0.13)', pen: 'rgba(122,88,56,0.18)', sheeppen: 'rgba(122,88,56,0.16)' };
    for (const plot of world.plots) {
        if (!plot.built.fence) continue;
        for (const fac of plot.facilities) {
            const wash = PEN_WASH[fac.type];
            if (!wash) continue;   // pond/mill/hatchery aren't pens
            const { x, y, w, h } = fac;
            // ground wash first (sorted far behind everything local, i.e. on the ground)
            const topSy = cam.y + isoY(x, y);
            list.push({
                y: topSy - 999,
                draw: () => {
                    ctx.fillStyle = wash;
                    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) {
                        const cxp = cam.x + isoX(i + 0.5, j + 0.5), cyp = cam.y + isoY(i + 0.5, j + 0.5);
                        ctx.beginPath();
                        ctx.moveTo(cxp, cyp - TILE_H / 2); ctx.lineTo(cxp + TILE_W / 2, cyp);
                        ctx.lineTo(cxp, cyp + TILE_H / 2); ctx.lineTo(cxp - TILE_W / 2, cyp);
                        ctx.closePath(); ctx.fill();
                    }
                },
            });
            // gate on the side facing the house: skip that side's middle rail segment
            const hc = plot.house ? { x: plot.house.i + 2.5, y: plot.house.j + 2.5 } : { x: plot.x + plot.w / 2, y: plot.y + plot.h / 2 };
            const dx = hc.x - (x + w / 2), dy = hc.y - (y + h / 2);
            const gateSide = Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? 'W' : 'E') : (dy < 0 ? 'N' : 'S');
            const gateAt = { N: x + (w >> 1), S: x + (w >> 1), W: y + (h >> 1), E: y + (h >> 1) }[gateSide];
            // #paddock A pen sitting in its own annexed paddock is ALREADY fenced on its outward sides by
            // the plot outline — the paddock is part of plot.cells, so plotOutline traces right around it.
            // Drawing the full pen rect on top of that gave a doubled, thickened fence line. So an inner
            // rail is drawn only where the edge is INTERIOR to the homestead: the tile on the far side is
            // land the plot also owns. For a paddock that's the single shared edge with the yard (which is
            // exactly where the gate belongs); for a legacy pen sitting inside the yard, all four sides
            // qualify and it fences exactly as it always did.
            const owns = (i, j) => plot.cells.has(i + ',' + j);
            const postSet = new Set();
            const seg = (i0, j0, i1, j1, side, pos, oi, oj) => {
                if (!owns(oi, oj)) return;                              // outer boundary — the plot outline has it
                if (side === gateSide && pos === gateAt) return;        // the gate gap
                list.push(rail(i0, j0, i1, j1));
                postSet.add(i0 + ',' + j0); postSet.add(i1 + ',' + j1);
            };
            for (let i = x; i < x + w; i++) {
                seg(i, y, i + 1, y, 'N', i, i, y - 1);
                seg(i, y + h, i + 1, y + h, 'S', i, i, y + h);
            }
            for (let j = y; j < y + h; j++) {
                seg(x, j, x, j + 1, 'W', j, x - 1, j);
                seg(x + w, j, x + w, j + 1, 'E', j, x + w, j);
            }
            for (const k of postSet) { const c = k.indexOf(','); list.push(post(+k.slice(0, c), +k.slice(c + 1))); }
        }
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
                    const dispW = Math.round(S.w * HOUSE_ART_SCALE * (art.scale || 1)), dispH = Math.round(dispW * S.h / S.w);
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
        const wdw = Math.round(wellArt().w * ASSET_SCALE), wdh = Math.round(wellArt().h * ASSET_SCALE);
        list.push({
            y: sy + TILE_H, draw: () => {
                if (homeReady && imageLoaded(homeSheet)) {
                    ctx.imageSmoothingEnabled = false;
                    ctx.drawImage(homeSheet, wellArt().x, wellArt().y, wellArt().w, wellArt().h,
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
            const wdw = Math.round(wellArt().w * ASSET_SCALE), wdh = Math.round(wellArt().h * ASSET_SCALE);
            list.push({
                y: sy + TILE_H, draw: () => {
                    ctx.imageSmoothingEnabled = false;
                    ctx.drawImage(homeSheet, wellArt().x, wellArt().y, wellArt().w, wellArt().h,
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
        if (st.type === 'windmill') spr = spr[Math.floor(performance.now() / 110) % 4];   // ~9fps sweep (display-time; never sim/seed)
        if (!spr) continue;   // unknown structure type (e.g. statue art still loading)
        const isTower = st.type === 'tower';   // lightning ward gets the pulsing orb
        list.push({
            y: sy + TILE_H, draw: () => {
                const dx = Math.floor(sx - spr.width / 2), dy = Math.floor(sy + TILE_H - spr.height);
                ctx.drawImage(spr, dx, dy);
                if (isTower) {
                    // lightning-ward amber orb: a slow breathing glow (~2s), display-time only
                    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 1000 * 3.0);
                    const ox = dx + 14, oy = dy + 3, rad = 5 + pulse * 4.5;   // orb sits top-centre of the 28×56 sprite
                    const g = ctx.createRadialGradient(ox, oy, 0, ox, oy, rad);
                    g.addColorStop(0, `rgba(250,214,110,${0.3 + pulse * 0.4})`);
                    g.addColorStop(1, 'rgba(250,214,110,0)');
                    ctx.fillStyle = g; ctx.fillRect(ox - rad, oy - rad, rad * 2, rad * 2);
                    ctx.fillStyle = `rgba(255,246,232,${0.35 + pulse * 0.5})`;   // hot core bead
                    ctx.fillRect(ox - 1, oy - 1, 2, 2);
                }
            }
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
        if (offScreen(sx, sy)) continue;   // Codex #44 P1 — skip crops outside the viewport (no closure, no sort entry)
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
                // Anchor on b.cx/cy — the paddock's true centre, carried as a float so an odd footprint in
                // an even cell still draws dead centre rather than half a tile off (the solid footprint
                // b.i/j/w/h has to snap to whole tiles; where the sprite is DRAWN does not). Pre-footprint
                // saves carry neither, and fall back to the old one-tile anchor unchanged.
                const acx = b.cx != null ? b.cx : b.i + (b.w || 1) / 2;
                const acy = b.cy != null ? b.cy : b.j + (b.h || 1) / 2;
                const bx = cam.x + isoX(acx, acy), by = cam.y + isoY(acx, acy);
                if (!offScreen(bx, by)) {   // Codex #44 P1 — cull off-screen facility buildings
                    const spr = b.kind === 'barn' ? barnSprite_(world.seasonDef.name) : b.kind === 'mill' ? millSprite_(world.seasonDef.name) : b.kind === 'hatchery' ? hatchSprite
                        : coopTDSprite(world.seasonDef.name, readyEggCount(fac));
                    list.push({ y: by + TILE_H, draw: () => {
                        const dx = Math.floor(bx - spr.width / 2), dy = Math.floor(by + TILE_H - spr.height);
                        ctx.drawImage(spr, dx, dy);
                        // chimney smoke drifts up from the hatchery brooder + the mill's roof vent
                        if (b.kind === 'hatchery') drawChimneySmoke(dx + 35, dy + 5, b.i * 7 + b.j * 13);
                        else if (b.kind === 'mill') drawChimneySmoke(dx + 34, dy + 8, b.i * 7 + b.j * 13);
                        // Pennant planted ON the ridge, not hovering over the barn. The rebuilt cupola sits at
                        // canvas y 14..21 (halved from the first cube), so the old -5 left the 9px pole ending
                        // well clear of the roof — a flag floating in mid-air. +2 sets the pole's base into the
                        // ridge with the cloth just clear of it (picked by A/B'ing offsets -5..+14 side by side).
                        else if (b.kind === 'barn') drawRoofPennant(dx + 32, dy + 2, b.i * 5 + b.j * 11);
                    } });
                }
            }
            if (fac.trough) {
                const tr = fac.trough;
                const tx = cam.x + isoX(tr.i + 0.5, tr.j + 0.5), ty = cam.y + isoY(tr.i + 0.5, tr.j + 0.5);
                if (!offScreen(tx, ty)) list.push({ y: ty + TILE_H * 0.4, draw: () => ctx.drawImage(troughSprite, Math.floor(tx - 6), Math.floor(ty - 1)) });
            }
            // producers (animals tucked inside their coop/barn at night aren't drawn)
            for (const p of fac.producers) {
                if (p.inside) continue;
                const px = cam.x + isoX(p.fx, p.fy), py = cam.y + isoY(p.fx, p.fy);
                if (offScreen(px, py)) continue;   // Codex #44 P1 — cull off-screen animals/pond life
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
        if (f.onSortie) continue;   // #counteroffensive PHASE 2 — away with the war party, off-field (not drawn at home)
        const sx = cam.x + isoX(f.pos.i, f.pos.j);
        const sy = cam.y + isoY(f.pos.i, f.pos.j);
        maybeWorkSfx(f, sx, sy);
        // #speaker-forward (owner: a talker "blinking in and out of view") — the gatherings pack the
        // cast so tightly that bodies eclipse each other, and a hidden farmer WITH A LIVE BUBBLE reads
        // as a vanishing speaker. Scene-scoped: during the day-1 congregation and the vote-day
        // gathering, whoever holds a bubble sorts to the very front of the scene (+1e6) so the voice
        // always has a visible body. Everyday occlusion stays honest everywhere else.
        const gathering = world.congregating() || world.foundingGathering();
        const lift = gathering && f.bubble ? 1e6 : 0;
        list.push({ y: sy + TILE_H * 0.5 + 0.1 + lift, draw: () => drawFarmer(f, sx, sy) });
        farmerBubbles.push({ f, sx });   // #bubble-overlay: drawn on top after the sort loop (never occluded)
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

    // #Codex23 the raid cinematic's warband — display-only raiders that live in world.raidEvent (NOT in
    // world.encounters), so they're y-sorted in here alongside the real threats
    if (world.raidEvent && world.raidEvent.raiders) {
        for (const r of world.raidEvent.raiders) {
            const sx = cam.x + isoX(r.i, r.j), sy = cam.y + isoY(r.i, r.j);
            list.push({ y: sy + TILE_H * 0.5 + 0.11, draw: () => drawThreat(r, sx, sy) });
        }
    } else if (world.pendingRaid) {
        // #P1 the warband MUSTERING on the red approach during the telegraph — before it crosses. Cosmetic
        // (nowhere in the sim), y-sorted in, and it hands straight off to raidEvent.raiders the instant it lands.
        for (const r of raidMusterFigures(world.pendingRaid)) {
            const sx = cam.x + isoX(r.i, r.j), sy = cam.y + isoY(r.i, r.j);
            list.push({ y: sy + TILE_H * 0.5 + 0.11, draw: () => drawThreat(r, sx, sy) });
        }
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
        list.push({ y: sy + TILE_H * 0.5, draw: () => drawMonument(sx, sy, m.tier) });
    }

    return list;
}
// A commemorative stone raised where a raider fell — the procedural gold-plaqued obelisk
// (pixel.js makeMonument, RAMPS.STONE + GRAIN). Anchored: cap at the top of the sprite,
// shadow at its base, centred on the tile (matches the 12×21 hover hit-rect below).
// #7d the tiered memorial set (1 Cairn .. 5 War Barrow) — pre-built + cached; the tier
// is stamped deterministically in farm.js, old saves default to 2. All base-anchored.
const monumentTiers = [null, makeMonument(1), makeMonument(2), makeMonument(3), makeMonument(4), makeMonument(5)];
function monumentSpr(tier) { return monumentTiers[Math.max(1, Math.min(5, tier || 2))]; }
function drawMonument(sx, sy, tier) {
    ctx.imageSmoothingEnabled = false;
    const spr = monumentSpr(tier);
    const baseY = Math.floor(sy + TILE_H / 2 + 2);          // shared ground line across all tiers
    ctx.drawImage(spr, Math.floor(sx - spr.width / 2), baseY - spr.height);
}
// Procedural chimney smoke: 2–3 soft grey puffs that rise, drift on a sine, grow and
// fade over a performance.now cycle. Phase is offset by `seed` (a tile-position hash,
// NOT rng) so neighbouring chimneys don't puff in lockstep. Display-only — no sim/seed.
function drawChimneySmoke(ox, oy, seed) {
    const now = performance.now() / 2200;
    for (let n = 0; n < 3; n++) {
        const ph = (now + n / 3 + (seed & 7) / 8) % 1;
        const alpha = Math.sin(ph * Math.PI) * 0.4;              // fade in then out
        if (alpha <= 0.03) continue;
        const drift = Math.sin(ph * Math.PI * 2 + n * 1.7 + (seed & 3)) * 3;
        const sz = 1 + Math.round(ph * 2);                       // grows as it rises
        const px = Math.round(ox + drift), py = Math.round(oy - 2 - ph * 16);
        ctx.fillStyle = `rgba(206,208,214,${alpha})`;
        ctx.fillRect(px - sz, py - sz, sz * 2, sz * 2);
        ctx.fillStyle = `rgba(230,232,238,${alpha * 0.7})`;      // lighter core
        const cs = Math.max(1, sz - 1);
        ctx.fillRect(px - cs + 1, py - cs + 1, cs, cs);
    }
}
// A little pennant on a pole that ripples in the wind — a tapering triangle whose tip
// waves more than its root, on a performance.now sine (phase offset by `seed`). Reads as
// a small flag at 1×. Display-only — no sim/seed.
function drawRoofPennant(px, topY, seed) {
    ctx.fillStyle = '#5a4028'; ctx.fillRect(px, topY, 1, 9);        // pole
    ctx.fillStyle = '#7a5433'; ctx.fillRect(px, topY, 1, 1);       // lit pole top
    const t = performance.now() / 300 + (seed & 7);
    for (let fx = 1; fx <= 5; fx++) {
        const yoff = Math.round(Math.sin(t + fx * 0.6) * (fx / 5) * 1.6);   // ripple grows toward the tip
        const fh = Math.max(1, 3 - (fx >> 1));                              // taper to a point
        ctx.fillStyle = fx <= 2 ? '#e0603c' : '#c0402c';                    // lit near the pole, deeper red at the fly
        ctx.fillRect(px + fx, topY + 1 + yoff, 1, fh);
    }
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
    const c = THREAT_ART[e.kind];
    let img = threatImg[e.kind];
    // #orc-vs-orc raiders attacking an ORC town wear another tribe's colors (orc2/orc3, `art` stamped at
    // spawn) so they read as invaders, not neighbors. Falls back to orc1 until the variant sheet loads.
    if (e.kind === 'orc' && e.art && world && world.culture === 'orc') {
        const vi = orcVariantImg[e.art];
        if (vi && vi.complete && vi.naturalWidth > 0) img = vi;
    }
    // #sprite pick the animation STATE + frame. hurt (took a blow) beats swing (dealing one) beats idle;
    // each advances through its own sheet's frame columns over its display window. Falls back to the idle
    // sheet (column 0) whenever an animation sheet isn't loaded. orc-vs-orc variants animate from their tribe.
    const swinging = e._swingAt != null && world && world.time - e._swingAt < SWING_DUR;
    const hurting = e._hurtAt != null && world && world.time - e._hurtAt < HURT_DUR;
    let sheet = img, frameCol = 0, walkBob = 0;
    // #sprite animation banks per foe kind: orc banks are per-variant ([1..3], for orc-vs-orc); the assassin
    // is a single sheet under key 0. death > hurt > swing > walk > idle. Every entry falls back to the idle
    // sheet (frame 0) until its animation sheet has loaded.
    const banks = e.kind === 'orc'
        ? { atk: orcAttackImg, hurt: orcHurtImg, walk: orcWalkImg, death: orcDeathImg, v: (e.art && world && world.culture === 'orc') ? e.art : 1 }
        : e.kind === 'assassin'
        ? { atk: assassinAttackImg, hurt: assassinHurtImg, death: assassinDeathImg, v: 0 }
        : null;
    if (banks && world) {
        const v = banks.v;
        // distance travelled drives the WALK cadence (display-only accumulator on the never-serialized foe)
        const moved = e._pi != null ? Math.hypot(e.i - e._pi, e.j - e._pj) : 0;
        e._pi = e.i; e._pj = e.j; e._walkPhase = (e._walkPhase || 0) + moved;
        const useAnim = (im2, at, dur, loop) => {
            if (!im2 || !im2.complete || !im2.naturalWidth) return false;
            sheet = im2;
            const frames = Math.max(1, Math.round(im2.naturalWidth / c.fw));
            const raw = Math.floor(((world.time - at) / dur) * frames);
            frameCol = loop ? (((raw % frames) + frames) % frames) : Math.min(frames - 1, raw);
            return true;
        };
        if (e.fell && banks.death) {                                   // a FELLED foe plays its death animation, holds the corpse
            if (e._fellAt == null) e._fellAt = world.time;
            useAnim(banks.death[v], e._fellAt, DEATH_DUR, false);
        } else if (!e.fell) {
            // #sprite-strobe the sim steps a foe at 30Hz but we render at 60-120Hz, so `moved` is 0 on the
            // 2-3 render frames BETWEEN sim ticks. Gating `walking` on per-frame movement therefore flips the
            // sprite back to the IDLE pose (arms down) on those frames and to a WALK frame (arm swung) on the
            // step frame — a rapid two-pose strobe that reads as a shaky, VIBRATING orc with a semi-opaque
            // "ghost arm" (the display blends the two arm positions). Latch the walk state on SIM-TIME, which
            // is frozen between renders, so the walk frame HOLDS between steps and only advances on a real step.
            if (moved > 0.0006) e._lastStepAt = world.time;
            const walking = e._lastStepAt != null && (world.time - e._lastStepAt) < 0.14 && !hurting && !swinging;
            if (hurting) useAnim((banks.hurt || {})[v], e._hurtAt, HURT_DUR, false);
            else if (swinging) useAnim((banks.atk || {})[v], e._swingAt, SWING_DUR, false);
            else if (walking && banks.walk) {
                const wk = banks.walk[v];
                if (wk && wk.complete && wk.naturalWidth) {
                    sheet = wk;
                    const frames = Math.max(1, Math.round(wk.naturalWidth / c.fw));
                    frameCol = Math.floor(e._walkPhase / WALK_STRIDE) % frames;   // distance-driven gait
                    // #sprite a GAIT BOB — most visible for the BACK (up) view, where the legs hide behind the
                    // body and the walk otherwise reads as FLOATING (player). Screen-up = negative screen-y.
                    const sym = (e.mvI + e.mvJ) / 2, sxm = e.mvI - e.mvJ;
                    const up = Math.abs(sym) > Math.abs(sxm) * 0.85 && sym < 0;
                    walkBob = Math.abs(Math.sin(e._walkPhase / WALK_STRIDE * Math.PI)) * (up ? 2.4 : 0.8);
                }
            }
        }
    }
    // #raid-feel duel lunge: a swinging raider snaps toward their opponent and eases back (display timer set
    // by #duelExchange); a FELLED raider sinks and darkens where the line stopped them.
    if (swinging) {
        const k = Math.sin(Math.PI * Math.min(1, (world.time - e._swingAt) / SWING_DUR));
        const n = Math.hypot(e._swingI || 0, e._swingJ || 0) || 1;
        sx += ((e._swingI - e._swingJ) / n) * 3.5 * k;
        sy += ((e._swingI + e._swingJ) / n) * 1.75 * k;
    }
    ctx.imageSmoothingEnabled = false;
    // #fog a foe is FAINT in the fog of war — ~5% opacity deep in the dark, brightening toward the revealed
    // edge (max ~15%), and only FULLY solid once it steps onto revealed land. They loom out of the dark as
    // they cross the frontier. (Depth = tiles to the nearest revealed ground toward town — cheap inward scan.)
    let fogA = 1;
    if (world && world.isRevealed && !world.isRevealed(Math.round(e.i), Math.round(e.j))) {
        const ci = CENTER - e.i, cj = CENTER - e.j, nn = Math.hypot(ci, cj) || 1;
        let depth = 12;
        for (let st = 1; st <= 12; st++) {
            if (world.isRevealed(Math.round(e.i + ci / nn * st), Math.round(e.j + cj / nn * st))) { depth = st; break; }
        }
        fogA = Math.max(0.05, 0.16 - depth * 0.011);   // ~0.15 one tile out, floors at 0.05 deep in
    }
    const dimmed = e.fell || fogA < 1;
    // #sprite a felled foe plays its death animation in full colour, then settles into a darkened corpse
    if (dimmed) ctx.save();
    if (e.fell) { const done = e._fellAt == null || world.time - e._fellAt > DEATH_DUR; ctx.globalAlpha = (done ? 0.72 : 0.95) * fogA; ctx.filter = done ? 'brightness(0.58)' : 'none'; sy += 3; }
    else if (fogA < 1) ctx.globalAlpha = fogA;
    if (sheet && sheet.complete && sheet.naturalWidth > 0) {
        const fw = c.fw, rows = Math.max(1, Math.round(sheet.naturalHeight / fw));
        // #raid-feel 4-direction sheets pick their row from the last MOVEMENT, projected to screen space
        // (mvI/mvJ set wherever the sim moves the threat): walking screen-up shows the BACK of the orc.
        let dirRow = c.row ?? 2;
        if (c.rows4 && (e.mvI || e.mvJ)) {
            const sxm = e.mvI - e.mvJ, sym = (e.mvI + e.mvJ) / 2;
            if (Math.abs(sym) > Math.abs(sxm) * 0.85) dirRow = sym > 0 ? c.rows4.down : c.rows4.up;
            else dirRow = sxm >= 0 ? c.rows4.right : c.rows4.left;
        }
        const row = Math.min(dirRow, rows - 1);
        const disp = Math.round(fw * ASSET_SCALE * 1.15);
        const dx = Math.round(sx - disp / 2), dy = Math.round(sy - disp * 0.82 - walkBob);
        if (c.side && e.facing > 0) {   // side-profile source frame faces LEFT; mirror it to face right
            ctx.save(); ctx.translate(dx + disp, dy); ctx.scale(-1, 1);
            ctx.drawImage(sheet, frameCol * fw, row * fw, fw, fw, 0, 0, disp, disp);
            ctx.restore();
        } else {
            ctx.drawImage(sheet, frameCol * fw, row * fw, fw, fw, dx, dy, disp, disp);
        }
    } else {
        ctx.fillStyle = e.def.color;
        ctx.beginPath(); ctx.ellipse(sx, sy - 6, 7, 9, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#1a1414'; ctx.fillRect(Math.round(sx - 3), Math.round(sy - 9), 2, 2); ctx.fillRect(Math.round(sx + 1), Math.round(sy - 9), 2, 2);
    }
    if (dimmed) ctx.restore();
    // #hp-bars a raider's display-HP (chunked by the exchanges it takes — farm.js #duelExchange) rides
    // over its head from the UNDER RAID beat until it falls or flees off the field.
    if (e._dhp != null && !e.fell && world && world.raidEvent && world.raidEvent.struck) {
        const bw = 13, bh = 2, bx = Math.round(sx - bw / 2), byy = Math.round(sy - 34);
        ctx.fillStyle = '#08080a'; ctx.fillRect(bx - 1, byy - 1, bw + 2, bh + 2);
        ctx.fillStyle = '#3a1e1e'; ctx.fillRect(bx, byy, bw, bh);
        ctx.fillStyle = e._dhp < 0.35 ? '#e83828' : e._dhp < 0.6 ? '#e0a83c' : '#5cc850';
        ctx.fillRect(bx, byy, Math.max(1, Math.round(bw * e._dhp)), bh);
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

// #silo the humble START — the SAME stacked-wooden-crates sprite the town uses for its build sites and
// shared-well sites (crateSheet/CRATES_SRC), not a bespoke shape: one stack at L1, two side-by-side at L2,
// before the guild hall rises at L3. Bottom-anchored on the silo tile; returns the top Y for the LV tag.
function drawSiloBarrels(sx, footY, lvl) {
    if (crateReady && imageLoaded(crateSheet)) {
        ctx.imageSmoothingEnabled = false;
        const dw = Math.round(CRATES_SRC.w * ASSET_SCALE), dh = Math.round(CRATES_SRC.h * ASSET_SCALE);
        const blit = (cx) => ctx.drawImage(crateSheet, CRATES_SRC.x, CRATES_SRC.y, CRATES_SRC.w, CRATES_SRC.h, Math.round(cx - dw / 2), footY - dh, dw, dh);
        if (lvl <= 1) {
            ctx.fillStyle = 'rgba(10,14,10,0.28)'; ctx.fillRect(Math.round(sx - dw / 2), footY - 2, dw, 3);
            blit(sx);
        } else {   // two stacks for a fuller store (back-left drawn first, front-right overlaps)
            ctx.fillStyle = 'rgba(10,14,10,0.28)'; ctx.fillRect(Math.round(sx - dw + 3), footY - 2, dw * 2 - 6, 3);
            ctx.drawImage(crateSheet, CRATES_SRC.x, CRATES_SRC.y, CRATES_SRC.w, CRATES_SRC.h, Math.round(sx - dw + 2), footY - dh - 2, dw, dh);
            blit(sx + Math.round(dw * 0.45));
        }
        return footY - dh;
    }
    ctx.fillStyle = '#7a5230'; ctx.fillRect(Math.floor(sx - 8), footY - 16, 16, 16);   // stand-in until the sheet loads
    return footY - 16;
}

// The town silo — a grain bin at the plaza where settlers donate surplus to level the town.
// Procedural (no asset): tan cylinder + hooped bands + conical roof, with a floating TOWN LV tag.
function drawSilo(sx, sy) {
    const footY = Math.floor(sy + TILE_H);
    // #silo LEVEL 0 — the humble START: a raw crate stockpile (both cultures). The silo HOUSE (human guild
    // hall / orc war-hoard) rises at level 1, once the first donations have grown the town.
    if (world.townLevel <= 0) {
        const topY = drawSiloBarrels(sx, footY, 0);
        const tag = 'LV 0', tw = textWidth(tag), ty = topY - 12;
        ctx.fillStyle = 'rgba(20,16,8,0.78)'; ctx.fillRect(Math.floor(sx - tw / 2) - 2, ty, tw + 4, 9);
        drawText(ctx, tag, Math.floor(sx - tw / 2), ty + 1, '#f0d060');
        return;
    }
    if (world.culture === 'orc') {   // #94 the WAR-HOARD: ent-idol totem, or the living-tree gazebo at LV5+
        const big = world.townLevel >= 5;
        const img = big ? orcSilo5 : orcSilo, ready = big ? orcSilo5Ready : orcSiloReady;
        const src = big ? ORC_SILO5_SRC : ORC_SILO_SRC;
        let topY = footY - 20;
        if (ready && img.naturalWidth) {
            ctx.imageSmoothingEnabled = false;
            const s = ASSET_SCALE * (big ? 1.05 : 0.95);
            const dw = Math.round(src.w * s), dh = Math.round(src.h * s);
            const dx = Math.floor(sx - dw / 2), dy = footY - dh + 8;   // content centred on the tile, base seated
            ctx.fillStyle = 'rgba(10,14,10,0.28)'; ctx.fillRect(dx + Math.round(dw * 0.30), footY - 2, Math.round(dw * 0.40), 3);
            ctx.drawImage(img, src.x, src.y, src.w, src.h, dx, dy, dw, dh);
            topY = dy;
        } else { ctx.fillStyle = '#7a5a3a'; ctx.fillRect(Math.floor(sx - 8), footY - 20, 16, 20); }
        const tag = `LV ${world.townLevel}`, tw = textWidth(tag), ty = topY - 4;
        ctx.fillStyle = 'rgba(20,16,8,0.78)'; ctx.fillRect(Math.floor(sx - tw / 2) - 2, ty, tw + 4, 9);
        drawText(ctx, tag, Math.floor(sx - tw / 2), ty + 1, '#f0d060');
        return;
    }
    // the human silo HOUSE — the guild hall, from level 1 (barrels were the level-0 start, handled above)
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
        // gentle ±1px bob on the water (phase by world position so pads don't bob in unison)
        const bob = Math.round(Math.sin(performance.now() / 700 + (p.fx + p.fy) * 0.9));
        ctx.drawImage(spr, Math.floor(px - 7), Math.floor(py - 5 + bob));
        // a faint shimmer speck drifting on the water beside the pad (display-time only)
        const t = performance.now() / 900 + (p.fx - p.fy);
        const shim = 0.22 + 0.2 * Math.sin(t * 2);
        if (shim > 0.05) {
            ctx.fillStyle = `rgba(191,228,240,${shim})`;
            ctx.fillRect(Math.round(px + Math.cos(t) * 7), Math.round(py + 4 + Math.sin(t) * 2), 1, 1);
        }
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

// #hud a small filling DIAL for action progress (tilling/planting/watering/harvesting) — deliberately a RADIAL
// wheel, NOT a horizontal bar, so it can never be mistaken for the (now rare, red) health bar. Fills clockwise
// from the top; a dark hub reads it as a dial. Display-only.
function drawProgressWheel(cx, cy, p, r = 4, color = '#e0c24a') {
    cx = Math.round(cx); cy = Math.round(cy); p = Math.max(0, Math.min(1, p));
    ctx.save();
    ctx.fillStyle = 'rgba(10,12,18,0.82)';
    ctx.beginPath(); ctx.arc(cx, cy, r + 1, 0, Math.PI * 2); ctx.fill();         // dark disc backing
    ctx.fillStyle = 'rgba(74,80,96,0.55)';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();             // depleted track
    if (p > 0) {                                                                 // filled pie slice, from 12 o'clock clockwise
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p); ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = 'rgba(10,12,18,0.95)';
    ctx.beginPath(); ctx.arc(cx, cy, 1.4, 0, Math.PI * 2); ctx.fill();           // hub → reads as a dial
    ctx.restore();
}

// #watch a small EYE over the current sentry's head — signifies "keeping watch today" at a glance (matches the
// ROLES panel), so you can spot who's on the beat without opening a sheet. A dark pill, an almond white, and a
// pupil that drifts slowly side to side so it reads as actively watching. Display-only.
function drawWatchEye(cx, cy) {
    cx = Math.round(cx); cy = Math.round(cy);
    ctx.fillStyle = 'rgba(10,14,20,0.72)'; ctx.fillRect(cx - 5, cy - 3, 11, 6);          // dark backing pill
    ctx.fillStyle = '#e8e4cc';                                                            // eye white (almond)
    ctx.fillRect(cx - 3, cy - 1, 7, 3); ctx.fillRect(cx - 2, cy - 2, 5, 1); ctx.fillRect(cx - 2, cy + 2, 5, 1);
    const look = Math.round(Math.sin(performance.now() / 900) * 2);                       // pupil drifts (watching)
    ctx.fillStyle = '#33507a'; ctx.fillRect(cx - 1 + look, cy - 1, 2, 2);
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
    // #anim-migrate every activity now plays its PROPER multi-frame cycle from the real sheets (walk 6f,
    // run 8f, idle 12f, attack 8f, hurt 5-6f, death 7-8f per culture), with the old 2-frame logic kept as
    // the graceful fallback for sheets that haven't loaded (and the procedural pre-sheet sprites).
    let frame = null, swordBaked = false, hurtPose = false;
    const battling = farmerInBattle(f);
    const isOrc = f.sheet.culture === 'orc';
    {
        const frames = farmerSprites(f);
        const cyc = frames.cycle || (() => null);
        // human battle frames (tinted body+head+SWORD composites) — fetched lazily, null until sheets ready
        let _bat;
        const bat = () => (_bat !== undefined ? _bat : (_bat = (!isOrc && charReady() && battleReady()) ? battleSprites(f) : null));
        const loop = (arr, fps) => (arr && arr.length ? arr[Math.floor(f.animTime * fps) % arr.length] : null);
        const byProgress = (arr, p) => (arr && arr.length ? arr[Math.floor(Math.max(0, Math.min(0.999, p)) * arr.length)] : null);
        // stand-and-fight beats: a raid line under the blow, or a wilderness clash
        const struckLine = world.raidEvent && world.raidEvent.struck && (f._skirmish || f.state === 'muster');
        // TRAVELLING BEATS POSING. A defender closing on a raider is state 'walk' with combatStance still
        // 'fight' (#goTo(..., 'fight') keeps the stance across the approach), so the stand-and-fight pose used
        // to win here and they SLID across the ground in an attack pose — the same FLOAT the foe gait-bob
        // fixes, seen chasing the band toward the hall and again as it withdrew. Melee frames are for holding
        // ground; the moment they're covering distance it's the walk/run cycle.
        const fighting = f.state !== 'walk' && (f.state === 'fight' || f.combatStance === 'fight' || struckLine);
        const swinging = f._swingAt != null && world.time - f._swingAt < 0.42;
        // RUN when hurrying to support in battle: mustering to the defense line (walk→'muster'), riding to a
        // counter-sortie / search-party rally (f.mustering / walk→'sortie'), or charging a threat
        // (walk→'fight'). Only while actually TRAVELLING — standing in formation reads as guard/fight,
        // never a run-in-place.
        const battleRush = f.state === 'walk' && (f.mustering || (f.path && (f.path.then === 'muster' || f.path.then === 'sortie' || f.path.then === 'fight')));

        if (f.downed) {
            if (f._deathAnimAt == null) f._deathAnimAt = world.time;   // display-only timer (render field, like f._by)
            const arr = isOrc ? cyc('death') : (bat() ? bat().death : null);
            frame = byProgress(arr, (world.time - f._deathAnimAt) / 0.8);   // play the fall once, hold the last frame
            if (frame && !isOrc) swordBaked = true;
        } else if (f._deathAnimAt != null) f._deathAnimAt = null;

        if (!frame && f.hurtFlash > 0.04) {
            // struck: the HURT flinch plays across the flash window (hurtFlash decays 1 → 0)
            const arr = isOrc ? cyc('hurt') : (bat() ? bat().hurt : null);
            frame = byProgress(arr, 1 - Math.min(1, f.hurtFlash));
            if (frame) { hurtPose = true; if (!isOrc) swordBaked = true; }
        }
        if (!frame && fighting) {
            const atk = isOrc ? cyc('attack') : (bat() ? bat().atk : null);
            if (swinging) frame = byProgress(atk, (world.time - f._swingAt) / 0.42);   // the full swing on the duel beat
            else if (f.state === 'fight' || f.combatStance === 'fight') frame = loop(atk, 10);   // sustained melee
            if (frame && !isOrc) swordBaked = true;
            // a line-holder between swings falls through → armed guard (idle breathe + the sword overlay below)
        }
        if (!frame && (f.state === 'walk' || f.state === 'flee' || f._supMove)) {   // #raid-allhands a mustered supporter relocating mid-battle runs, not glides
            const run = (f.state === 'flee' || battleRush || f._supMove) ? cyc('run') : null;
            if (run) frame = loop(run, f.state === 'flee' ? 15 : 12);
            else {
                const walk = cyc('walk');
                frame = walk ? loop(walk, f.state === 'flee' ? 14 : 9)
                             : (Math.floor(f.animTime * (f.state === 'flee' ? 11 : 7)) % 2 ? frames.walk1 : frames.walk2);
            }
        }
        // #chop the woodcutter's swing: felling a tree (chop) and grubbing the stump (break) now SWING THE
        // BLADE on the same attack cycle a duel uses — a real overhand chop, not the old up/down bounce.
        // Looped at the sustained-melee cadence; falls through to the labour beat if the attack/battle sheets
        // haven't loaded yet (orc: cyc('attack'); human: the tinted body+head+SWORD composite).
        if (!frame && (f.state === 'chop' || f.state === 'break')) {
            const atk = isOrc ? cyc('attack') : (bat() ? bat().atk : null);
            frame = loop(atk, 10);
            if (frame) swordBaked = true;   // #Codex-VS BOTH cultures: the attack frame already holds the blade/axe → suppress the hoe (null cold-load frame still falls through to the hoe pose)
        }
        if (!frame && (f.state === 'work' || f.state === 'build' || f.state === 'coopbuild' || f.state === 'housebuild' || f.state === 'chop' || f.state === 'break' || f.state === 'forage' || f.state === 'mine' || f.state === 'fencepost' || f.state === 'scarecrow')) {
            frame = Math.floor(f.animTime * 5) % 2 ? frames.work : frames.idle;   // the labour beat (the hoe overlay rides it)
        }
        if (!frame && f.state === 'sleep') frame = frames.sleep;
        if (!frame) frame = loop(cyc('idle'), 8) || frames.idle;   // idle breathe (12f) — or the old still pose
    }

    // #raid-feel duel lunge: a defender landing their swing snaps toward the raider and eases back (display
    // timer set by #duelExchange — the same treatment the raiders get in drawThreat).
    if (f._swingAt != null && world.time - f._swingAt < 0.32) {
        const k = Math.sin(Math.PI * Math.min(1, (world.time - f._swingAt) / 0.32));
        const n = Math.hypot(f._swingI || 0, f._swingJ || 0) || 1;
        sx += ((f._swingI - f._swingJ) / n) * 3.5 * k;
        sy += ((f._swingI + f._swingJ) / n) * 1.75 * k;
    }
    // #anim-migrate rig-aligned frames (battle/death/orc-activity cells) carry a _rig: anchor by the normal
    // walk-crop dims and draw the wider cell at its stamped offset — the body never shifts between activities.
    const rig = frame._rig;
    const fw = rig ? rig.w : frame.width, fh = rig ? rig.h : frame.height;
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

    const orcFrame = f.sheet.culture === 'orc' && orcSpriteReady();

    // tiny foot-shadow — SKIPPED for orcs (the orc crop leaves the rect floating below the feet as a "drop shadow")
    if (!orcFrame) { const shW = Math.min(fw - 8, 14); ctx.fillStyle = 'rgba(10,14,10,0.35)'; ctx.fillRect(Math.round(sx - shW / 2), footY, shW, 2); }   // #sprite cap width so a drawn sword doesn't stretch the shadow into a line

    // flip for left/right on the side view so they face their movement. Humans mirror when facing<0 (their
    // source faces right); the ORC side row faces LEFT, so mirror when facing>0. Front/back rows never mirror.
    const flip = orcFrame ? (f.moveDir === 'side' && f.facing > 0)
                          : (f.facing < 0 && (!charReady() || f.moveDir === 'side'));
    const rdx = rig ? rig.dx : 0, rdy = rig ? rig.dy : 0;
    if (flip) {
        ctx.save();
        ctx.translate(px + fw, dy);
        ctx.scale(-1, 1);
        ctx.drawImage(frame, rdx, rdy);
        ctx.restore();
    } else {
        ctx.drawImage(frame, px + rdx, dy + rdy);
    }

    // #sprite BATTLE SWORD — the blade as a LAYER over the normal body, aligned to its rig (so the walk
    // cycle + shadow are untouched). Swings through the attack-sword frames on the duel beat (f._swingAt),
    // else an idle guard; the back-sword when facing away. Untinted — it's steel.
    if (battling && !swordBaked && charReady() && battleReady() && charBox) {   // #anim-migrate skip when the frame already holds the blade
        const row = CHAR_DIRS[f.moveDir] ?? CHAR_DIRS.down, up = row === CHAR_DIRS.up;
        const SW = 0.42, swinging = f._swingAt != null && world.time - f._swingAt < SW;
        const part = swinging ? (up ? BATTLE_PARTS.attack_sword_back : BATTLE_PARTS.attack_sword)
                              : (up ? BATTLE_PARTS.Idle_sword_back : BATTLE_PARTS.Idle_sword);
        if (part && part.naturalWidth) {
            const cols = Math.max(1, Math.round(part.naturalWidth / CHAR_FW));
            const col = swinging ? Math.min(cols - 1, Math.floor(((world.time - f._swingAt) / SW) * cols)) : 0;
            const sc = ASSET_SCALE, cellD = Math.round(CHAR_FW * sc);
            const ox = Math.round(charBox.x * sc), oy = Math.round(charBox.y * sc);
            ctx.imageSmoothingEnabled = false;
            if (flip) {
                ctx.save(); ctx.translate(px + fw, dy); ctx.scale(-1, 1);
                ctx.drawImage(part, col * CHAR_FW, row * CHAR_FW, CHAR_FW, CHAR_FW, -ox, -oy, cellD, cellD);
                ctx.restore();
            } else {
                ctx.drawImage(part, col * CHAR_FW, row * CHAR_FW, CHAR_FW, CHAR_FW, px - ox, dy - oy, cellD, cellD);
            }
        }
    }

    // sick tint overlay
    if (f.health === 'sick' && f.state !== 'sleep') {
        ctx.fillStyle = 'rgba(120,200,120,0.28)';
        ctx.fillRect(px + 4, py + 3, fw - 8, 8);
    }

    // struck by a threat: a red flash. In danger: a blinking red "!" over their head.
    // (#anim-migrate the rect flash is the FALLBACK — skipped when a real hurt-flinch frame is playing)
    if (f.hurtFlash > 0 && !hurtPose) {
        ctx.fillStyle = `rgba(224,64,48,${Math.min(0.55, f.hurtFlash * 0.5)})`;
        ctx.fillRect(px + 3, py + 2, fw - 6, fh - 4);
    }
    if (f.threatAlert > 0 && Math.floor(f.threatAlert * 6) % 2) {
        ctx.fillStyle = '#e83828'; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center';
        ctx.fillText('!', sx, py - 3); ctx.textAlign = 'left';
    }
    // WOUND bar: a small red health bar over the head ONLY when a farmer is genuinely IN THE RED (hurt enough to
    // matter) — not the constant 90%-and-below noise it used to be. Full/lightly-scuffed farmers show nothing;
    // you read exact HP on the sheet when you follow one. Hidden while fighting/fleeing (the "!" + hurt-flash
    // carry the danger) and while asleep. (#hud legibility — reduce always-on visual clutter over every head.)
    // #hp-bars (player): from the UNDER RAID beat every combatant fights under a visible bar — the whole
    // line AND the warband — so the battle reads like the D&D encounter it is. Full bars show too.
    const inBattle = world.raidEvent && world.raidEvent.struck && (f.state === 'muster' || f._skirmish);
    if ((hpFrac < 0.5 || inBattle) && f.state !== 'sleep' && (inBattle || (f.state !== 'fight' && f.state !== 'flee'))) {
        const bw = 13, bh = 2, bx = Math.floor(sx - bw / 2), byy = py - 6;   // #sprite universal HP-bar width (matches the orc bar exactly)
        // a clearly-framed HEALTH bar: green (mending) -> amber (hurt) -> red (critical). The old gold-amber
        // fill read as a stray yellow icon over the head and the thin stroke washed out under the CRT; a full
        // dark frame + the green/red ramp make it unmistakably a health bar (fix: #110).
        ctx.fillStyle = '#08080a'; ctx.fillRect(bx - 1, byy - 1, bw + 2, bh + 2);   // solid dark frame
        ctx.fillStyle = '#3a1e1e'; ctx.fillRect(bx, byy, bw, bh);                    // depleted track
        ctx.fillStyle = hpFrac < 0.35 ? '#e83828' : hpFrac < 0.6 ? '#e0a83c' : '#5cc850';
        ctx.fillRect(bx, byy, Math.max(1, Math.round(bw * hpFrac)), bh);
    }
    // #watch the current sentry wears an eye while up-and-about (all day on their watch day) — who's on the beat
    // is legible at a glance, matching "keeps watch today" in ROLES. Not while asleep/felled (they're not watching).
    if (world.currentSentry && world.currentSentry() === f && !f.downed && f.state !== 'sleep' && f.state !== 'sleepwalk') {
        drawWatchEye(sx, py - 15);
    }
    // INTENT badge: what's driving them right now, readable without the sheet (hunt / barter / help).
    let intent = null;
    if (f.state === 'hunt' || f.huntTarget) intent = 'hunt';
    else if (f.barterDeal || (f.path && f.path.then === 'barter')) intent = 'barter';
    else if (f.helpTask) intent = 'help';
    if (intent && f.state !== 'sleep') drawIntentIcon(intent, sx + 8, py + 1);
    // EMOTE: a transient social tell over the head — a pink heart when a bond forms, a red X when recoiling
    // from someone they can't stand. #109: drawn from the 1-bit icon pack (heart=1, X=19) so the tells match
    // the new UI icon style; falls back to the hand-drawn glyph until the sheet loads. Fades out.
    if (f.emote && f.emoteT > 0 && f.state !== 'sleep') {
        const ex = sx - 8, ey = py + 1;
        ctx.globalAlpha = Math.min(1, f.emoteT);
        ctx.fillStyle = 'rgba(14,12,10,0.6)'; ctx.fillRect(ex - 3, ey - 3, 8, 8);   // faint dark backing
        const bond = f.emote === 'bond';
        const ic = packEmote(bond ? 1 : 19, 8, bond ? '#e8688a' : '#e84438');
        if (ic) { ctx.imageSmoothingEnabled = false; ctx.drawImage(ic, ex - 3, ey - 3); }
        else if (bond) {   // fallback: the hand-drawn heart
            ctx.fillStyle = '#e8688a';
            ctx.fillRect(ex - 2, ey - 2, 2, 2); ctx.fillRect(ex + 1, ey - 2, 2, 2);
            ctx.fillRect(ex - 2, ey, 5, 2); ctx.fillRect(ex - 1, ey + 2, 3, 1); ctx.fillRect(ex, ey + 3, 1, 1);
        } else {           // fallback: the hand-drawn scowl
            ctx.fillStyle = '#e84438';
            ctx.fillRect(ex - 2, ey + 2, 1, 1); ctx.fillRect(ex + 2, ey + 2, 1, 1); ctx.fillRect(ex - 1, ey + 3, 3, 1);
            ctx.fillStyle = '#c02820'; ctx.fillRect(ex - 2, ey - 1, 2, 1); ctx.fillRect(ex + 1, ey - 1, 2, 1);
        }
        ctx.globalAlpha = 1;
    }

    // carried lantern when working at night
    if (awakeAtNight && (f.state === 'work' || f.state === 'walk' || f.state === 'build')) {
        ctx.drawImage(lanternSprite, px + (f.facing < 0 ? -3 : fw - 1), py + 9);
    }

    // held hoe by day when doing farm work (so they read as farmers, not swordsmen)
    const toolStates = (f.state === 'work' || f.state === 'chop' || f.state === 'mine' || f.state === 'forage') && !swordBaked;   // #chop no hoe over a swung blade
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

    // work progress DIAL — a filling wheel (not a bar) beside the head, so tilling/planting/watering reads
    // instantly as "an action in progress" and never as a health bar.
    if (f.state === 'work' && f.action) {
        drawProgressWheel(sx + 8, py - 4, 1 - f.action.timer / f.action.total);
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

    // #bubble-overlay — the memory + speech bubbles are NOT drawn here in the y-sorted sprite pass: a building,
    // silo or war-post the farmer stands behind would draw OVER the words (worst during the day-1 congregation,
    // when the whole town clusters at the well). We stash the anchor and draw ALL bubbles in a dedicated overlay
    // pass after every sprite + structure, so speech is never occluded. See drawFarmerBubble (called post-sort).
    f._by = py;

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

// #bubble-overlay — draw a farmer's memory + speech bubbles ON TOP of the whole y-sorted scene (every sprite +
// structure), so words are never occluded by a building/silo the farmer stands behind. Runs in its own pass
// after the sort loop; `sx` is the farmer's screen-x from that pass and `f._by` the sprite-top anchor it stashed.
function drawFarmerBubble(f, sx) {
    const py = f._by;
    if (py == null) return;

    // #legibility Slice 1 — the SOURCE MEMORY surfacing at a charged beat: a distinct GOLD "memory" bubble (the
    // mid-tier register between an ambient saying and a screen-stopping grand modal) — the farmer's woven line
    // + a "GROWN FROM {title}" receipt, so the watcher sees a real memory surface. Fades in/out; held ~5.5s.
    if (f.memoryEcho && f.state !== 'sleep') {
        const me = f.memoryEcho, lines = wrapText(me.line, 24), attr = `GROWN FROM "${me.title.toUpperCase()}"`;
        const aw = textWidth(attr), lw = Math.max(aw, ...lines.map(l => textWidth(l)));
        const w = lw + 8, h = lines.length * 6 + 11, bx = Math.floor(sx - w / 2), by = py - 9 - h;
        const fade = Math.min(1, (me.t0 - me.t) / 0.4) * Math.min(1, me.t / 0.7);
        ctx.save(); ctx.globalAlpha = fade;
        ctx.fillStyle = 'rgba(240,208,120,0.15)'; ctx.fillRect(bx - 2, by - 2, w + 4, h + 4);   // soft gold glow
        ctx.fillStyle = 'rgba(20,16,10,0.93)'; ctx.fillRect(bx, by, w, h);
        ctx.fillStyle = '#c9a45a'; ctx.fillRect(bx, by, w, 1); ctx.fillRect(bx, by + h - 1, w, 1);   // gold rules
        let ty = by + 3;
        for (const ln of lines) { drawText(ctx, ln, bx + 4, ty, '#f0d88a'); ty += 6; }
        drawText(ctx, attr, Math.floor(sx - aw / 2), ty + 1, '#9a835a');
        ctx.restore();
    }

    // speech bubble — #bubble-reveal: the saying is shown ONE LINE AT A TIME (advancing every
    // b.lineSec). It pages through EVERY line — a 9-line saying shows all 9, one after the other (no
    // 4-line cap, and no progress dots that made it read as capped). The plate is pre-sized to the
    // widest line so it never resizes as lines advance.
    //
    // HOW a line arrives lives in speech-anim.js, not here, so `speech_anim_compare.html` judges the
    // real thing rather than a reimplementation of it. Shipping treatment (owner, 2026-08-06):
    // per WORD, grown outward from the CENTRE, each new word fading in. Replaced the left-to-right
    // per-letter typewriter, whose reveal ended at the right edge and made the eye sweep back across
    // the full plate on every line.
    //
    // `lineSec` is passed so the reveal is FITTED to the line's on-screen time — a guarantee for any
    // caller, NOT a fix for a past defect. say() wraps every line to SAY_LINE_CHARS (18) and a reveal
    // only overruns the 0.85s budget past ~28 characters, so no production line has ever been cut
    // off. An earlier revision of this comment claimed otherwise on the strength of synthetic
    // samples production cannot produce; see the scope note in speech-anim.js.
    if (f.bubble && !f.memoryEcho) {
        const b = f.bubble, lines = b.lines || [b.text];
        const elapsed = (b.t0 || 0) - b.t, lineSec = b.lineSec || 0.85, charSec = b.charSec || 0.03;
        const idx = Math.min(lines.length - 1, Math.max(0, Math.floor(elapsed / lineSec)));
        const line = lines[idx] || '';
        const w = Math.max(...lines.map(l => textWidth(l))) + 4;
        const bx = Math.floor(sx - w / 2), by = py - 10;
        ctx.fillStyle = 'rgba(16,18,26,0.85)';
        ctx.fillRect(bx, by, w, 9);
        const lineElapsed = elapsed - idx * lineSec;
        const rv = revealLine(DEFAULT_VARIANT, line, lineElapsed, { plateW: w, charSec, lineSec });
        for (const seg of rv.segments) {
            ctx.globalAlpha = seg.alpha;
            drawText(ctx, seg.text, bx + seg.x, by + 2, b.color);
        }
        ctx.globalAlpha = 1;   // MUST reset — every later draw in this frame would inherit the fade
        if (rv.caretX !== null && (Math.floor(elapsed * 8) % 2)) {   // left-anchored variants only
            ctx.fillStyle = b.color; ctx.fillRect(bx + rv.caretX, by + 2, 1, 5);
        }
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
    // #raid-feel the RAID on the minimap (user report: the toast fired but nothing marked the map): during the
    // telegraph, a pulsing red mark at the warband's gathering point (the seeded edge spot in pr.dir); once the
    // raid is live, on the raiders themselves. Same edge-arrow treatment when it's outside the window.
    {
        const pr = world.pendingRaid, re = world.raidEvent;
        let ti = null, tj = null;
        if (pr) {
            const co = Math.cos(pr.dir), si = Math.sin(pr.dir), m = 4;
            const tx = co > 0 ? (GRID - m - CENTER) / co : co < 0 ? (m - CENTER) / co : Infinity;
            const ty = si > 0 ? (GRID - m - CENTER) / si : si < 0 ? (m - CENTER) / si : Infinity;
            const d = Math.max(40, Math.min(tx, ty)) - 3;
            ti = CENTER + co * d; tj = CENTER + si * d;
        } else if (re && re.raiders.length) {
            ti = re.raiders.reduce((s, r) => s + r.i, 0) / re.raiders.length;
            tj = re.raiders.reduce((s, r) => s + r.j, 0) / re.raiders.length;
        }
        if (ti != null) {
            if (inWin(ti, tj)) {
                if (blink) { const [px, py] = t2m(ti, tj); ctx.fillStyle = '#ff3020'; ctx.fillRect(Math.floor(px) - 1, Math.floor(py) - 1, 3, 3); }
            } else if (blink) drawMiniEdgeArrow(mx, my, mw, mh, ti - ci, tj - cj);
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
    drawText(ctx, cultureWord(world.culture, 'board.title'), IX, PY + 19, '#ffffff', 1);

    const bodyY = PY + 32, bodyH = PH - 32 - 5;
    ctx.save(); ctx.beginPath(); ctx.rect(IX - 3, bodyY, IW + 6, bodyH); ctx.clip();
    let y = bodyY - Math.round(boardScroll);
    const wrap = (t, col, ind = 0) => { for (const ln of wrapText(t, 30 - ind)) { drawText(ctx, ln, IX + ind, y, col); y += 7; } };

    // --- Town project ---
    y = sectionBand(IX, y, IW, cultureWord(world.culture, 'board.project'));
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
        y = sectionBand(IX, y, IW, cultureWord(world.culture, 'board.plans'));
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
    y = sectionBand(IX, y, IW, `${cultureWord(world.culture, 'board.help')} (${reqs.length})`);
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

// #hud all build/foundation/co-op PROGRESS now reads as a radial DIAL (matching the planting dial) — the
// horizontal bar shape is reserved for HEALTH, so nothing in the world uses a bar to mean "progress" any more.
// Same call signature (build sites, foundations, co-ops), so every construction site reads the same.
function drawProgressBar(cx, y, w, prog, fill = '#c9a45a') {
    drawProgressWheel(cx, y + 2, prog, 5, fill);
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

// Pixel icons rasterized once to a small field and TINTED per state by masking a colour rect through the
// image's alpha (source-in). Source is either an inline SVG data-URI (CSP-safe, no fetch) or a 1-bit PNG from
// the icon pack — the alpha shape is all that matters, so the PNG's own colour is irrelevant.
function makeMaskIcon(img) {
    let ready = false; const tints = {};
    const mark = () => { ready = !!img.naturalWidth; };
    img.onload = mark; img.onerror = () => {};
    if (img.complete) mark();   // already-cached/synchronous decode: onload may have fired before we attached
    return (size, color) => {
        if (!ready || !img.naturalWidth) return null;
        const key = size + ':' + color; let c = tints[key];
        if (!c) {
            // SUPERSAMPLE: render + tint at 4x, then ONE high-quality anti-aliased downscale to the target size.
            // Beats both a direct tiny render (loses detail -> mush) and a 1-bit threshold (blocky when the CRT
            // upscales it). The clean AA holds a complex glyph (globe grid, 3-person users) far better small.
            const S = size * 4;
            const [big, bx] = makeCanvas(S, S);
            bx.drawImage(img, 0, 0, S, S);
            bx.globalCompositeOperation = 'source-in'; bx.fillStyle = color; bx.fillRect(0, 0, S, S);
            const [cv, cx] = makeCanvas(size, size);
            cx.imageSmoothingEnabled = true; cx.imageSmoothingQuality = 'high';
            cx.drawImage(big, 0, 0, size, size);
            tints[key] = c = cv;
        }
        return c;
    };
}
function makeSvgIcon(svg) { const img = new Image(); img.src = 'data:image/svg+xml,' + encodeURIComponent(svg); return makeMaskIcon(img); }
// #firstframe the mask PNGs are ~100 bytes each but they are still a NETWORK FETCH, and `makeMaskIcon`
// returns null until one lands — which is why the top bar renders its inline-SVG fallbacks first and then
// SWAPS to the real icons. The fallback is right to exist (the bar must never be empty, and inline SVG needs
// no network); what was wrong was showing that swap to the player. Counted here so the boot gate can wait.
let _uiIconsPending = 0, _uiIconsLoaded = 0;
function uiIconsReady() { return _uiIconsPending > 0 && _uiIconsLoaded >= _uiIconsPending; }
function makePngIcon(src) {
    const img = new Image();
    _uiIconsPending++;
    const settle = () => { _uiIconsLoaded++; };
    img.addEventListener('load', settle, { once: true });
    img.addEventListener('error', settle, { once: true });   // a dead icon must not hold the boot forever
    img.fetchPriority = 'high';                              // tiny, and the first frame shows them
    img.src = src;
    if (img.complete) { /* cached: the listeners above still fire, or already have */ }
    return makeMaskIcon(img);
}
const COG_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="m21,10v-1h-1v-2h1v-2h-1v-1h-1v-1h-2v1h-2v-1h-1V1h-4v2h-1v1h-2v-1h-2v1h-1v1h-1v2h1v2h-1v1H1v4h2v1h1v2h-1v2h1v1h1v1h2v-1h2v1h1v2h4v-2h1v-1h2v1h2v-1h1v-1h1v-2h-1v-2h1v-1h2v-4h-2Zm-11,0v-1h4v1h1v4h-1v1h-4v-1h-1v-4h1Z"/></svg>';
const GLOBE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="9" y="1" width="1" height="1"/><polygon points="9 2 9 3 8 3 8 5 7 5 7 8 2 8 2 7 3 7 3 5 4 5 4 4 5 4 5 3 7 3 7 2 9 2"/><polygon points="13 2 14 2 14 4 15 4 15 6 16 6 16 8 8 8 8 6 9 6 9 4 10 4 10 2 11 2 11 1 13 1 13 2"/><rect x="14" y="1" width="1" height="1"/><polygon points="22 7 22 8 17 8 17 5 16 5 16 3 15 3 15 2 17 2 17 3 19 3 19 4 20 4 20 5 21 5 21 7 22 7"/><polygon points="17 10 17 14 16 14 16 15 8 15 8 14 7 14 7 10 8 10 8 9 16 9 16 10 17 10"/><polygon points="1 9 7 9 7 10 6 10 6 14 7 14 7 15 1 15 1 9"/><polygon points="23 9 23 15 17 15 17 14 18 14 18 10 17 10 17 9 23 9"/><polygon points="22 16 22 17 21 17 21 19 20 19 20 20 19 20 19 21 17 21 17 22 15 22 15 21 16 21 16 19 17 19 17 16 22 16"/><rect x="9" y="22" width="1" height="1"/><polygon points="9 21 9 22 7 22 7 21 5 21 5 20 4 20 4 19 3 19 3 17 2 17 2 16 7 16 7 19 8 19 8 21 9 21"/><rect x="14" y="22" width="1" height="1"/><polygon points="14 22 13 22 13 23 11 23 11 22 10 22 10 20 9 20 9 18 8 18 8 16 16 16 16 18 15 18 15 20 14 20 14 22"/></svg>';
const BANK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><polygon points="23 20 23 22 22 22 22 23 2 23 2 22 1 22 1 20 3 20 3 19 4 19 4 10 6 10 6 19 8 19 8 10 10 10 10 19 14 19 14 10 16 10 16 19 18 19 18 10 20 10 20 19 21 19 21 20 23 20"/><path d="m20,5v-1h-2v-1h-2v-1h-2v-1h-4v1h-2v1h-2v1h-2v1H1v2h1v1h1v1h18v-1h1v-1h1v-2h-3Zm-9,2v-1h-1v-2h1v-1h2v1h1v2h-1v1h-2Z"/></svg>';
const USERS_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><polygon points="2 13 2 12 1 12 1 10 2 10 2 9 7 9 7 12 8 12 8 13 2 13"/><polygon points="5 7 4 7 4 5 5 5 5 4 7 4 7 5 8 5 8 6 7 6 7 8 5 8 5 7"/><polygon points="8 7 9 7 9 6 10 6 10 5 14 5 14 6 15 6 15 7 16 7 16 11 15 11 15 12 14 12 14 13 10 13 10 12 9 12 9 11 8 11 8 7"/><polygon points="19 18 20 18 20 21 19 21 19 22 5 22 5 21 4 21 4 18 5 18 5 17 6 17 6 16 8 16 8 15 16 15 16 16 18 16 18 17 19 17 19 18"/><polygon points="23 10 23 12 22 12 22 13 16 13 16 12 17 12 17 9 22 9 22 10 23 10"/><polygon points="17 6 16 6 16 5 17 5 17 4 19 4 19 5 20 5 20 7 19 7 19 8 17 8 17 6"/></svg>';
const cogIconFn = makeSvgIcon(COG_SVG), globeIconFn = makeSvgIcon(GLOBE_SVG), bankIconFn = makeSvgIcon(BANK_SVG), usersIconFn = makeSvgIcon(USERS_SVG);
// hand-picked from the 1-bit pack (component-library): 56=globe/world, 98=crowd/roster, 92=chronicle.
// Tinted through the same source-in pipeline, so they wear the light/dark button colours like the SVG icons.
const worldIconFn = makePngIcon('./assets/icons/ui-world.png');
const rosterIconFn = makePngIcon('./assets/icons/ui-roster.png');
const chronIconFn = makePngIcon('./assets/icons/ui-chronicle.png');
const boardIconFn = makePngIcon('./assets/icons/ui-board.png');       // 214 = bulletin board
const settingsIconFn = makePngIcon('./assets/icons/ui-settings.png'); // 137 = settings emblem
function drawGearIcon(x, y, active) {   // SETTINGS button — icon 137 from the 1-bit pack (green when open)
    const col = active ? '#7dd069' : '#c8ccd8';
    const icon = settingsIconFn(8, col) || cogIconFn(8, col);
    if (icon) { ctx.imageSmoothingEnabled = false; ctx.drawImage(icon, x, y); return; }
    // fallback (until the SVG rasterizes): the procedural gear on a 9x9 field
    ctx.fillStyle = col;
    const R = 4;
    for (let gy = 0; gy <= 2 * R; gy++) for (let gx = 0; gx <= 2 * R; gx++) {
        const dx = gx - R, dy = gy - R, ax = Math.abs(dx), ay = Math.abs(dy), r = Math.hypot(dx, dy);
        const body = r <= 2.9, tooth = r <= 3.9 && (ax <= 1 || ay <= 1 || ax === ay), hole = r <= 1.25;
        if ((body || tooth) && !hole) ctx.fillRect(x + gx, y + gy, 1, 1);
    }
}
function drawGlobeIcon(x, y, active) {   // the WORLD button — icon 56 from the 1-bit pack (globe/orb)
    const icon = worldIconFn(8, active ? '#160f22' : '#c8ccd8') || globeIconFn(8, active ? '#160f22' : '#c8ccd8');
    if (icon) { ctx.imageSmoothingEnabled = false; ctx.drawImage(icon, x, y); return; }
    ctx.fillStyle = active ? '#160f22' : '#c8ccd8'; ctx.fillRect(x + 2, y + 2, 6, 6);   // tiny fallback blob
}
function drawBankIcon(x, y, active) {   // the CHRONICLE / THE SAGA button — icon 92 (paired figures)
    const icon = chronIconFn(8, active ? '#1a1024' : '#c8ccd8') || bankIconFn(8, active ? '#1a1024' : '#c8ccd8');
    if (icon) { ctx.imageSmoothingEnabled = false; ctx.drawImage(icon, x, y); return; }
    ctx.fillStyle = active ? '#1a1024' : '#c8ccd8'; ctx.fillRect(x + 2, y + 3, 6, 5);
}
function drawUsersIcon(x, y, active) {   // the ROSTER / WARBAND button — icon 98 (a crowd)
    const icon = rosterIconFn(8, active ? '#10240c' : '#c8ccd8') || usersIconFn(8, active ? '#10240c' : '#c8ccd8');
    if (icon) { ctx.imageSmoothingEnabled = false; ctx.drawImage(icon, x, y); return; }
    ctx.fillStyle = active ? '#10240c' : '#c8ccd8'; ctx.fillRect(x + 2, y + 3, 6, 5);
}
function drawBoardIcon(x, y, active) {   // the BOARD / WAR-POST button — icon 214 (a bulletin board)
    const icon = boardIconFn(8, active ? '#221a0e' : '#c8ccd8');
    if (icon) { ctx.imageSmoothingEnabled = false; ctx.drawImage(icon, x, y); return; }
    ctx.fillStyle = active ? '#221a0e' : '#c8ccd8'; ctx.fillRect(x + 2, y + 3, 6, 5);
}

function drawUI() {
    // top bar
    ctx.fillStyle = 'rgba(12,14,22,0.92)';
    ctx.fillRect(0, 0, GW, 18);
    ctx.fillStyle = '#20242f';
    ctx.fillRect(0, 18, GW, 1);

    // #away-banner — a persistent, screen-wide strip under the top bar while ANY soul is off-field with
    // an expedition (war party / search party). The departure beat is easy to miss (another tab, a
    // distracted minute), and an off-field rider is undrawable — this keeps the absence visible for the
    // whole ride, in both directions. Click = trail the first rider (the follow banner then narrates).
    AWAY_BAR.w = 0;
    {
        const away = world.farmers.filter(f => f.onSortie);
        if (away.length && !startScreen) {
            const cs = world.counterSortie, sp = world.searchParty;
            const isWar = !!(cs && cs.party && away.some(f => cs.party.includes(f.sheet.seed)));
            const isSearch = !isWar && !!(sp && sp.party && away.some(f => sp.party.includes(f.sheet.seed)));
            const names = away.slice(0, 3).map(f => f.sheet.name.split(' ')[0].toUpperCase()).join(', ') + (away.length > 3 ? ' +' + (away.length - 3) : '');
            const lbl = isWar ? `THE WAR PARTY RIDES - ${names} ${away.length === 1 ? 'IS' : 'ARE'} FAR FROM ${world.culture === 'orc' ? 'THE HOLD' : 'HOME'}`
                : isSearch ? `THE SEARCH PARTY IS OUT - ${names}`
                : `RIDES BEYOND THE FOG - ${names} PUSH${away.length === 1 ? 'ES' : ''} BEYOND THE FOG OF WAR`;
            const pulse = 0.75 + 0.25 * Math.sin(performance.now() / 500);
            ctx.fillStyle = 'rgba(52,18,16,0.85)'; ctx.fillRect(0, 19, GW, 10);            // ember-dark strip
            ctx.fillStyle = `rgba(224,120,60,${(0.5 * pulse).toFixed(3)})`; ctx.fillRect(0, 28, GW, 1);   // pulsing ember rule
            drawText(ctx, lbl, Math.floor((GW - textWidth(lbl)) / 2), 21, '#f0be96');
            AWAY_BAR.x = 0; AWAY_BAR.y = 19; AWAY_BAR.w = GW; AWAY_BAR.h = 10;
            // hover ETA (owner call: no click affordance — the strip informs, it doesn't navigate):
            // returnAt is the expedition's monotonic homecoming once the away phase begins; before that
            // (still mustering at the rally) `days` is the planned length of the road.
            if (inRect(mouse, AWAY_BAR)) {
                const exp = isWar ? cs : isSearch ? sp : (cs || sp);
                let eta = 'THE ROAD IS UNCHARTED';
                if (exp && exp.returnAt > 0) {
                    const d = (exp.returnAt - world.time) / (DAY_LENGTH + NIGHT_LENGTH);
                    eta = d <= 0.05 ? 'BACK ANY MOMENT' : d < 1 ? 'BACK WITHIN A DAY' : `BACK IN ~${Math.ceil(d)} DAYS`;
                } else if (exp && exp.days) eta = exp.days > 1 ? `${exp.days} DAYS' RIDE AHEAD` : "A DAY'S RIDE AHEAD";
                const tw2 = textWidth(eta), tx2 = Math.floor((GW - tw2) / 2);
                ctx.fillStyle = 'rgba(12,14,22,0.92)'; ctx.fillRect(tx2 - 5, 31, tw2 + 10, 11);
                ctx.fillStyle = 'rgba(224,120,60,0.6)'; ctx.fillRect(tx2 - 5, 31, 2, 11);
                drawText(ctx, eta, tx2, 34, '#f0be96');
            }
        }
    }

    // town name sits in a container that grows to fit its characters; the day/time info starts
    // AFTER it (dynamic, not a fixed x) so a long name like "SEDGEMARCH" never overlaps the clock
    const nameStr = (world.name || 'PROPAGATE').toUpperCase();
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
        const ml = world.merchant.state === 'trading' ? cultureWord(world.culture, 'boot.merchant') : cultureWord(world.culture, 'boot.merchantArriving');
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
    // a small icon-only button in the same right-to-left strip (sound toggle, settings cog, world globe).
    // Optional active/activeBg gives it the same highlighted-when-open look as the text buttons.
    const barIconBtn = (rect, w, drawIcon, active, activeBg) => {
        rect.w = w; rect.h = 12; rect.y = 3;
        bx -= rect.w; rect.x = bx; bx -= BGAP;
        ctx.fillStyle = active ? activeBg : 'rgba(255,255,255,0.08)';
        ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
        drawIcon(rect.x, rect.y, active);
    };

    // sound toggle — RIGHTMOST (drawn first), a speaker icon (with an X when muted), no text
    barIconBtn(SND_BTN, 12, (x, y) => drawSpeakerIcon(x + 2, y + 2, audio.enabled));
    // settings cog — folds in New Town + music/SFX volume (sound on/off stays a top-bar quick action)
    barIconBtn(SETTINGS_BTN, 12, (x, y) => drawGearIcon(x + 2, y + 2, settingsOpen));   // green icon = active, no bg swap
    // #admin a small amber dot on the gear while a ghost rehearsal is live — the booth's only permanent tell
    // (deliberately subtle: the show itself should read clean for the camera).
    if (world.rehearsal) { ctx.fillStyle = '#f0c860'; ctx.fillRect(SETTINGS_BTN.x + SETTINGS_BTN.w - 3, SETTINGS_BTN.y, 3, 3); }

    // speed controls in the corner: > = 5x, >> = 20x; a 1X revert appears while sped up
    const spd = world._speedMult || 1;
    barBtn(FF_BTN, '>>', spd === 20, '#e0a03c', '#221a0e');
    barBtn(FWD_BTN, '>', spd === 5, '#e0a03c', '#221a0e');
    SPEED1_BTN.w = 0;
    // the 1X revert is an ACTION, not the current speed — so it wears the plain ROSTER-style button
    // look (not the red 'selected' fill), which is reserved for the >/>> that IS active.
    if (spd !== 1) barBtn(SPEED1_BTN, '1X', false);

    // strip lays out right-to-left, so drawing WORLD before ROSTER places it to ROSTER's RIGHT (i.e. AFTER
    // roster/warband in reading order — zoom out from "the town's people" to "the world of towns").
    barIconBtn(WORLD_BTN, 12, (x, y, act) => drawGlobeIcon(x + 2, y + 2, act), worldMapOpen, '#c8b0e0');   // globe icon (was 'WORLD' text)
    barIconBtn(ROSTER_BTN, 12, (x, y, act) => drawUsersIcon(x + 2, y + 2, act), rosterOpen, '#7dd069');   // users icon (was ROSTER/WARBAND text)
    barIconBtn(CHRON_BTN, 12, (x, y, act) => drawBankIcon(x + 2, y + 2, act), chronOpen, '#c8a0e0');   // bank icon (was CHRONICLE/THE SAGA text)
    if ((world._chronTotal || 0) > chronReadTotal && !chronOpen) drawCoin(CHRON_BTN.x + CHRON_BTN.w - 3, CHRON_BTN.y - 2, 6);   // UNREAD only

    // (NEW TOWN moved into the settings menu.) #save-badge (owner) — a GREEN BADGE with black text,
    // letters typing in one by one so the eye catches it, fading out at the tail. Trust made visible.
    {
        const saveAge = performance.now() - saveFlashAt;
        if (saveAge < 2400) {
            const label = 'GAME SAVED';
            const shown = Math.min(label.length, Math.ceil(saveAge / 30));   // owner: type-in 2x faster
            const bw = textWidth(label) + 10;
            const bx = SETTINGS_BTN.x - bw + 8, by = 21;
            ctx.save();
            ctx.globalAlpha = saveAge > 2000 ? Math.max(0, (2400 - saveAge) / 400) : 1;
            ctx.fillStyle = '#7dd069'; ctx.fillRect(bx, by, bw, 11);
            ctx.fillStyle = '#4a8a3c'; ctx.fillRect(bx, by + 10, bw, 1);   // grounded lower rim
            drawText(ctx, label.slice(0, shown), bx + 5, by + 3, '#0c0e16');
            ctx.restore();
        }
    }

    BOARD_BTN.hidden = !world.board;   // only exists once the town has built the board
    if (!BOARD_BTN.hidden) {
        const postCount = world.helpBoard.filter(r => r.genuine).length + (world.project ? 1 : 0);
        barIconBtn(BOARD_BTN, 12, (x, y, act) => drawBoardIcon(x + 2, y + 2, act), boardOpen, '#c9a45a');   // icon 214 (was BOARD/WAR-POST text)
        if (postCount > 0 && !boardOpen) drawCoin(BOARD_BTN.x + BOARD_BTN.w - 3, BOARD_BTN.y - 2, 6);
    }


    // (bottom log bar removed — the Moments/callout banners + the chronicle now carry the beats it duplicated)

    if (rosterOpen) drawRoster();
    else if (chronOpen) drawChronicle();
    else if (worldMapOpen) drawWorldMap();
    // #vote-panel — while the vote window holds it OWNS the sheet slot outright: even a programmatic
    // selection (spotlight jump, follow cycling) can't cover the tally (live-found: the follow machinery
    // re-selected a farmer right after the edge cleared one). The selection survives underneath and the
    // sheet returns at dusk.
    else { drawMinimap(); if (boardOpen) drawBoard(); else if (voteWindowActive()) drawVotePanel(); else if (selected) drawSheet(selected); }
    if (settingsOpen) drawSettings();

    drawChatWidget();    // #legibility Slice 2 — the whisper button/panel, bottom-left (hidden under full panels)
    // (drawBarTooltips moved to the frame's true tail — after drawMoments — so hover labels sit above
    // the TOASTS too, not just the panels; owner-reported z-order gap.)
}

// hover tooltips for the top-bar buttons — the icon-only ones (sound/settings/roster/world/chronicle) gave
// players no way to tell what they do; a small name label under the hovered button fixes that. Drawn LAST in
// drawUI so it renders on top of the chronicle/roster/world panels (which otherwise cover it). Culture-aware
// where the panel has an orcish name (WARBAND / THE SAGA / WAR-POST).
function drawBarTooltips() {
    if (mouse.x < 0 || mouse.dragging || mouse.y > 16) return;
    const cw = id => cultureWord(world.culture, id);
    const tips = [
        [SND_BTN, audio.enabled ? 'SOUND' : 'MUTED'],
        [SETTINGS_BTN, 'SETTINGS'],
        [FF_BTN, 'SPEED 20X'], [FWD_BTN, 'SPEED 5X'], [SPEED1_BTN, 'NORMAL SPEED'],
        [ROSTER_BTN, cw('panel.roster')], [WORLD_BTN, 'WORLD'], [CHRON_BTN, cw('panel.chronicle')],
    ];
    if (!BOARD_BTN.hidden) tips.push([BOARD_BTN, cw('panel.board')]);
    for (const [rect, label] of tips) {
        if (!rect.w || !inRect(mouse, rect)) continue;
        const tw = textWidth(label), pad = 3, w = tw + pad * 2, h = 11;
        // anchor to the CURSOR, not the button: centered under the pointer and BELOW the 13px pixel-hand, so
        // the hand never sits on top of the label (it did when the tooltip was pinned under the button).
        let tx = Math.round(mouse.x - w / 2);
        tx = Math.max(2, Math.min(GW - w - 2, tx));
        const ty = Math.round(mouse.y) + 15;
        ctx.fillStyle = 'rgba(12,10,20,0.92)';
        ctx.fillRect(tx, ty, w, h);
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fillRect(tx, ty, w, 1);
        drawText(ctx, label, tx + pad, ty + 3, '#e8e4d8');
        break;
    }
}

// ---------------------------------------------------------------------------
// #2 The WORLD MAP — the zoom-out camera tier: every town this browser has grown, where it sits, which towns
// it descends from (lineage edges = the closed memory loop at world scale), and which have met (encounters).
// ---------------------------------------------------------------------------
// #Codex35-2: ONE closer for the world map — every close path (X, outside click, M, Esc, other panels opening)
// must also drop the sub-overlays (KEY legend / CREATE TOWN picker), or a half-open picker greets the next open.
function closeWorldMap() { worldMapOpen = false; worldMapFoundOpen = false; worldMapKeyOpen = false; }
async function openWorldMap() {
    worldMapOpen = true;
    worldMapFoundOpen = false; worldMapKeyOpen = false;   // never inherit a stale overlay from a prior session
    rosterOpen = chronOpen = boardOpen = false;
    worldMapSel = world ? world.seed : null;
    // #Codex25-1: opening the map must not publish UNCOMMITTED town state into the shared index. Persist first;
    // register the committed summary only if the save actually landed. Otherwise just DISPLAY the existing index.
    if (world) {
        const w = world, summary = townSummary(w);
        const d = await saveTown(w);
        if (d != null) { summary.rev = w._rev; await registerWorld(w, summary); }
    }
    worldMapIdx = await loadWorldIndex();
}

function drawWorldMap() {
    ctx.fillStyle = 'rgba(6,7,11,0.80)'; ctx.fillRect(0, 18, GW, GH - 18);
    const PW = Math.min(GW - 12, 380), PH = GH - 40, PX = Math.floor((GW - PW) / 2), PY = 22;
    uiPanel(PX, PY, PW, PH);

    const idx = worldMapIdx || { towns: {}, encounters: [] };
    const nodes = computeLayout(idx);
    const enc = idx.encounters || [];
    worldMapHits = []; worldMapVisit = null; worldMapTravHits = []; worldMapUiHits = {};

    // The map CANVAS fills the modal to its gold frame — content clips to the FRAME INTERIOR (uiPanel's inner
    // #191410 fill is x+4..w-8), NOT an inset box — so halos/rings bleed to the stroke with no "collapsed" padding.
    // The header (top) + footer info bar (bottom) are OVERLAYS drawn ON TOP of the canvas below.
    const inX = PX + 4, inY = PY + 4, inW = PW - 8, inH = PH - 8;
    // town LAYOUT still reserves the header + footer bands so dots/labels never sit under the overlays.
    const CARD_H = 44, CARD_RESERVE = CARD_H + 12;
    const mapX = PX + 10, mapY = PY + 24, mapW = PW - 20, mapH = PH - 24 - CARD_RESERVE;

    let toX = null, toY = null, S = 0, bySeed = new Map();
    let hovT = null, hovTrav = null;
    if (nodes.length) {
        // fit the town bounding box into the reserved map region (few towns still fill the view)
        let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
        for (const n of nodes) { minX = Math.min(minX, n.x); minY = Math.min(minY, n.y); maxX = Math.max(maxX, n.x); maxY = Math.max(maxY, n.y); }
        const bw = Math.max(1, maxX - minX), bh = Math.max(1, maxY - minY), pad = 26;
        S = nodes.length === 1 ? 0 : Math.min((mapW - 2 * pad) / bw, (mapH - 2 * pad) / bh);
        const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
        toX = n => mapX + mapW / 2 + (n.x - cx) * S;
        toY = n => mapY + mapH / 2 + (n.y - cy) * S;
        bySeed = new Map(nodes.map(n => [String(n.seed), n]));

    // === MAP CONTENT — clipped to the frame interior (fills the modal to the gold stroke). ===
    ctx.save(); ctx.beginPath(); ctx.rect(inX, inY, inW, inH); ctx.clip();

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
    // Slice B: TRAVELERS en route — a faint dashed path + a marker interpolating origin->destination by the
    // DESTINATION town's progress toward the pre-decided arrival day (Fable's "show pair state" beat). A traveler
    // heading to a dormant town sits frozen until that town is next played, exactly like the raid inbox.
    const pairs = idx.pairs || {};
    for (const key in pairs) {
        const p = pairs[key]; if (p.state !== 'enRoute') continue;
        const O = bySeed.get(String(p.origin)), D = bySeed.get(String(p.destination)); if (!O || !D) continue;
        const span = Math.max(1, p.arrivalDay - p.discoveryDay);
        const prog = Math.max(0, Math.min(1, ((D.day || 0) - p.discoveryDay) / span));
        const ox = toX(O), oy = toY(O), dsx = toX(D), dsy = toY(D);
        ctx.strokeStyle = 'rgba(220,200,150,0.20)'; ctx.setLineDash([2, 3]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(dsx, dsy); ctx.stroke(); ctx.setLineDash([]);
        // Slice D: a LOST traveler falls at its seeded point — show a dim '×' there, not a live pulsing dot.
        const lost = p.fate === 'lost', lostAt = p.lostAt || 1;
        const eff = lost ? Math.min(prog, lostAt) : prog;
        const mx = ox + (dsx - ox) * eff, my = oy + (dsy - oy) * eff;
        if (lost && prog >= lostAt) {
            ctx.strokeStyle = 'rgba(150,150,150,0.65)'; ctx.lineWidth = 0.7;
            ctx.beginPath(); ctx.moveTo(mx - 2, my - 2); ctx.lineTo(mx + 2, my + 2); ctx.moveTo(mx + 2, my - 2); ctx.lineTo(mx - 2, my + 2); ctx.stroke();
        } else {
            const col = p.fromCulture === 'orc' ? '#e0806a' : '#8fd070';   // whose traveler it is
            const pulse = 1.5 + Math.sin(performance.now() / 300) * 0.5;
            ctx.fillStyle = col; ctx.beginPath(); ctx.arc(mx, my, pulse, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 0.5; ctx.stroke();
            worldMapTravHits.push({ x: mx, y: my, r: 4, kind: 'scout', fromCulture: p.fromCulture,
                origin: O.name, destination: D.name, arrivalDay: p.arrivalDay });
        }
    }
    // Slice D — NEWS couriers: amber markers carrying word of a distant clash to a third town (memory across the
    // graph). Retire on delivery (prog>=1); a lost courier leaves a faint '×'.
    for (const nw of (idx.news || [])) {
        const O = bySeed.get(String(nw.origin)), D = bySeed.get(String(nw.destination)); if (!O || !D) continue;
        const span = Math.max(1, nw.arrivalDay - nw.discoveryDay);
        const prog = Math.max(0, Math.min(1, ((D.day || 0) - nw.discoveryDay) / span));
        const lost = nw.fate === 'lost', lostAt = nw.lostAt || 1;
        if (!lost && prog >= 1) continue;                        // delivered — retire
        const ox = toX(O), oy = toY(O), dsx = toX(D), dsy = toY(D);
        ctx.strokeStyle = 'rgba(224,200,96,0.16)'; ctx.setLineDash([1, 3]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(dsx, dsy); ctx.stroke(); ctx.setLineDash([]);
        const eff = lost ? Math.min(prog, lostAt) : prog;
        const mx = ox + (dsx - ox) * eff, my = oy + (dsy - oy) * eff;
        if (lost && prog >= lostAt) {
            ctx.strokeStyle = 'rgba(150,150,150,0.6)'; ctx.lineWidth = 0.7;
            ctx.beginPath(); ctx.moveTo(mx - 1.6, my - 1.6); ctx.lineTo(mx + 1.6, my + 1.6); ctx.moveTo(mx + 1.6, my - 1.6); ctx.lineTo(mx - 1.6, my + 1.6); ctx.stroke();
        } else {
            ctx.fillStyle = '#e0c060'; ctx.beginPath(); ctx.arc(mx, my, 1.4, 0, Math.PI * 2); ctx.fill();
            worldMapTravHits.push({ x: mx, y: my, r: 4, kind: 'news', origin: O.name, destination: D.name, arrivalDay: nw.arrivalDay });
        }
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
    // hover detection (uses the worldMapHits/TravHits just populated) + REACH/RUMOR rings — drawn INSIDE the map
    // canvas's interior clip, so the rings mask to the gold frame like everything else.
    const overlayUp = worldMapKeyOpen || worldMapFoundOpen;
    if (!overlayUp && mouse.x >= 0 && !mouse.dragging) {
        for (const h of worldMapHits) { const dx = mouse.x - h.x, dy = mouse.y - h.y; if (dx * dx + dy * dy <= (h.r + 2) * (h.r + 2)) { hovT = bySeed.get(String(h.seed)); break; } }
        if (!hovT) for (const h of worldMapTravHits) { const dx = mouse.x - h.x, dy = mouse.y - h.y; if (dx * dx + dy * dy <= h.r * h.r) { hovTrav = h; break; } }
    }
    if (hovT) {
        const RUMOR = 1.9;   // == reconciliation.js TRAVELER.rumorMult — a scout sets out when reaches drift within reach-sum*this
        const hx = toX(hovT), hy = toY(hovT);
        ctx.strokeStyle = `hsla(${hovT.tint.h} ${hovT.tint.s}% 62% / 0.55)`; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(hx, hy, Math.max(4, hovT.reach * S), 0, Math.PI * 2); ctx.stroke();     // REACH (influence)
        ctx.strokeStyle = `hsla(${hovT.tint.h} ${hovT.tint.s}% 62% / 0.26)`; ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.arc(hx, hy, Math.max(6, hovT.reach * S * RUMOR), 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);   // RUMOR
    }
    ctx.restore();   // end the map-canvas interior clip
    }   // end if (nodes.length)

    // === OVERLAYS drawn ON TOP of the map canvas (so halos/rings never obscure them) ===
    // header: title + X + KEY / CREATE TOWN chips
    drawText(ctx, 'THE WORLD', PX + 7, PY + 5, '#c8b0e0', 1);
    drawText(ctx, 'X', PX + PW - 10, PY + 5, '#c8ccd8');
    {
        let bx = PX + 7; const by = PY + 13;
        const chip = (label, active, accent) => {
            const w = textWidth(label) + 8, b = { x: bx, y: by, w, h: 9 };
            ctx.fillStyle = active ? hexA(accent, 0.20) : 'rgba(255,255,255,0.05)';
            ctx.fillRect(b.x, b.y, w, 9);
            if (active) { ctx.fillStyle = accent; ctx.fillRect(b.x, b.y + 8, w, 1); }
            drawText(ctx, label, b.x + 4, b.y + 2, active ? accent : '#9aa0b4');
            bx += w + 4;
            return b;
        };
        worldMapUiHits.key = chip('KEY', worldMapKeyOpen, '#c8b0e0');
        worldMapUiHits.found = chip('CREATE TOWN', worldMapFoundOpen, '#7dd069');
    }
    if (!nodes.length) { drawText(ctx, 'The world holds no towns yet - grow one.', mapX + 6, mapY + 20, '#9aa0b4'); return; }

    // selected-town info bar (fixed footer) — an overlay at the bottom edge (map layout reserved its band).
    if (worldMapSel != null) {
        const n = bySeed.get(String(worldMapSel));
        if (n) {
            const cardW = PW - 16, cardH = CARD_H, cardX = PX + 8, cardY = PY + PH - cardH - 4;
            ctx.fillStyle = 'rgba(20,16,28,0.92)'; ctx.fillRect(cardX, cardY, cardW, cardH);
            ctx.strokeStyle = n.tint.css; ctx.strokeRect(cardX + 0.5, cardY + 0.5, cardW - 1, cardH - 1);
            const nameStr = n.name.toUpperCase() + (n.culture === 'orc' ? ' - WARBAND' : '');
            drawText(ctx, nameStr, cardX + 4, cardY + 4, n.tint.css);
            drawText(ctx, `Year ${n.year} - day ${n.day} - ${n.pop} ${n.culture === 'orc' ? 'raiders' : 'settlers'} - ${n.harvestTotal} ${n.culture === 'orc' ? 'plundered' : 'harvested'}`, cardX + 4, cardY + 13, '#b0b6c8');
            if (n.ancestors.length) drawText(ctx, `heir of ${n.ancestors.length} remembered town${n.ancestors.length > 1 ? 's' : ''}`, cardX + 4, cardY + 22, '#c8b0e0');
            if (n.motto) { const ln = wrapText(`"${n.motto}"`, 46)[0]; drawText(ctx, ln, cardX + 4, cardY + 31, '#eef0f4'); }
            const active = world && String(n.seed) === String(world.seed);
            const tagX = cardX + 4 + textWidth(nameStr) + 6;   // sit the action right after the town name
            if (!active) {
                const vbw = 42, bx = tagX, by = cardY + 1;
                ctx.fillStyle = 'rgba(125,208,105,0.25)'; ctx.fillRect(bx, by, vbw, 9);
                drawText(ctx, 'VISIT', bx + Math.round((vbw - textWidth('VISIT')) / 2), by + 2, '#7dd069');
                worldMapVisit = { x: bx, y: by, w: vbw, h: 9, seed: n.seed };
            } else drawText(ctx, 'you are here', tagX, cardY + 4, '#f0e0a0');
        }
    } else {
        // colour-keyed legend so the lines explain themselves (each word in its own line colour)
        let lx = PX + 8; const ly = PY + PH - 11;
        const seg = (t, c) => { drawText(ctx, t, lx, ly, c); lx += textWidth(t + ' '); };
        seg('LINEAGE', '#c8a0e0'); seg('RAID', '#e6503c'); seg('PEACE', '#7dd069'); seg('MEETING', '#e6c878'); seg('- KEY explains the map', '#7a8090');
    }

    // a boxed multi-line tooltip near the cursor, clamped inside the panel
    const worldTip = (lines, accent) => {
        const w = Math.max(...lines.map(l => textWidth(l))) + 8, h = lines.length * 8 + 4;
        let tx = Math.round(mouse.x + 9), ty = Math.round(mouse.y + 9);
        tx = Math.max(PX + 3, Math.min(tx, PX + PW - w - 3)); ty = Math.max(PY + 3, Math.min(ty, PY + PH - h - 3));
        ctx.fillStyle = 'rgba(10,12,20,0.96)'; ctx.fillRect(tx, ty, w, h);
        ctx.strokeStyle = accent; ctx.lineWidth = 1; ctx.strokeRect(tx + 0.5, ty + 0.5, w - 1, h - 1);
        let yy = ty + 3; for (let i = 0; i < lines.length; i++) { drawText(ctx, lines[i], tx + 4, yy, i === 0 ? accent : '#c8ccd8'); yy += 8; }
    };
    if (hovT) {
        const orc = hovT.culture === 'orc';
        worldTip([hovT.name.toUpperCase() + (orc ? ' - WARBAND' : ''),
            orc ? `${hovT.pop} raiders - day ${hovT.day}` : `${hovT.pop} settlers - day ${hovT.day}`,
            `reach ${Math.round(hovT.reach)} - towns MEET when reaches overlap`,
            `rumor ~${Math.round(hovT.reach * 1.9)} - scouts venture out this far`], hovT.tint.css);
    } else if (hovTrav) {
        const o = String(hovTrav.origin).split(' ')[0], d = String(hovTrav.destination).split(' ')[0];
        if (hovTrav.kind === 'news') worldTip(['NEWS COURIER', `${o} -> ${d}`, 'word of a distant clash', `arrives ~day ${hovTrav.arrivalDay}`], '#e0c060');
        else worldTip(['SCOUT (en route)', `${o} -> ${d}`, `${hovTrav.fromCulture === 'orc' ? 'an orc' : 'a human'} town's traveler`, 'delivers word so they meet forewarned', `arrives ~day ${hovTrav.arrivalDay}`], hovTrav.fromCulture === 'orc' ? '#e0806a' : '#8fd070');
    }

    if (worldMapKeyOpen) drawWorldKey(PX, PY, PW, PH);
    if (worldMapFoundOpen) drawWorldFound(PX, PY, PW, PH);
}

// The MAP KEY — every glyph on the world map, explained. Reach vs rumor, scouts vs couriers, the line colours.
function drawWorldKey(PX, PY, PW, PH) {
    const w = Math.min(PW - 24, 260), h = 150, x = PX + Math.floor((PW - w) / 2), y = PY + Math.floor((PH - h) / 2);
    ctx.fillStyle = 'rgba(10,12,20,0.97)'; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#c8b0e0'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    drawText(ctx, 'MAP KEY', x + 6, y + 5, '#c8b0e0', 1);
    drawText(ctx, 'X', x + w - 10, y + 5, '#c8ccd8');
    let ry = y + 18; const IX = x + 8, TX = x + 26;
    const row = (draw, label, desc) => {
        draw(IX + 6, ry + 3);
        drawText(ctx, label, TX, ry, '#e8ecf5'); drawText(ctx, desc, TX + textWidth(label + ' '), ry, '#8a8f9c');
        ry += 11;
    };
    row((cx, cy) => { ctx.fillStyle = '#8fd070'; ctx.beginPath(); ctx.arc(cx, cy, 3, 0, 6.283); ctx.fill(); }, 'TOWN', '- size=pop, colour=culture');
    row((cx, cy) => { ctx.strokeStyle = 'rgba(200,200,210,0.7)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, 4, 0, 6.283); ctx.stroke(); }, 'REACH', '- influence, towns MEET on overlap');
    row((cx, cy) => { ctx.strokeStyle = 'rgba(200,200,210,0.5)'; ctx.setLineDash([2, 2]); ctx.beginPath(); ctx.arc(cx, cy, 4, 0, 6.283); ctx.stroke(); ctx.setLineDash([]); }, 'RUMOR', '- wider, a scout sets out here');
    row((cx, cy) => { ctx.fillStyle = '#8fd070'; ctx.beginPath(); ctx.arc(cx, cy, 2, 0, 6.283); ctx.fill(); }, 'SCOUT', '- traveler (green human/red orc)');
    row((cx, cy) => { ctx.fillStyle = '#e0c060'; ctx.beginPath(); ctx.arc(cx, cy, 2, 0, 6.283); ctx.fill(); }, 'NEWS', '- courier of a distant clash');
    row((cx, cy) => { ctx.strokeStyle = '#9a9a9a'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(cx - 2, cy - 2); ctx.lineTo(cx + 2, cy + 2); ctx.moveTo(cx + 2, cy - 2); ctx.lineTo(cx - 2, cy + 2); ctx.stroke(); }, 'LOST', '- a traveler that never arrived');
    ry += 2; ctx.fillStyle = '#20242f'; ctx.fillRect(x + 6, ry, w - 12, 1); ry += 5;
    let lx = IX; const seg = (t, c) => { drawText(ctx, t, lx, ry, c); lx += textWidth(t + ' '); };
    drawText(ctx, 'LINES:', lx, ry, '#8a8f9c'); lx += textWidth('LINES: ');
    seg('LINEAGE', '#c8a0e0'); seg('RAID', '#e6503c'); seg('PEACE', '#7dd069'); seg('MEETING', '#e6c878');
    worldMapUiHits = worldMapUiHits || {};
    worldMapUiHits.keyClose = { x, y, w, h };
}

// FOUND A TOWN — birth a new colony of a chosen kind. Human FARMERS (grass) or an Orc WARBAND (desert). The
// current town is autosaved; this navigates to a fresh seed with the culture set, so the world gains a real,
// visitable town of that type (and orc towns finally exist to meet + raid).
function drawWorldFound(PX, PY, PW, PH) {
    const w = Math.min(PW - 24, 232), h = 96, x = PX + Math.floor((PW - w) / 2), y = PY + Math.floor((PH - h) / 2);
    ctx.fillStyle = 'rgba(10,12,20,0.97)'; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#7dd069'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    drawText(ctx, 'FOUND A NEW TOWN', x + 6, y + 5, '#7dd069', 1);
    drawText(ctx, 'X', x + w - 10, y + 5, '#c8ccd8');
    const bw = w - 16, hb = { x: x + 8, y: y + 18, w: bw, h: 16 }, ob = { x: x + 8, y: y + 38, w: bw, h: 16 };
    ctx.fillStyle = 'rgba(125,208,105,0.16)'; ctx.fillRect(hb.x, hb.y, hb.w, hb.h);
    ctx.strokeStyle = '#7dd069'; ctx.strokeRect(hb.x + 0.5, hb.y + 0.5, hb.w - 1, hb.h - 1);
    drawText(ctx, 'HUMAN FARMERS - a green settlement', hb.x + 6, hb.y + 5, '#b6e8a0');
    ctx.fillStyle = 'rgba(224,128,106,0.16)'; ctx.fillRect(ob.x, ob.y, ob.w, ob.h);
    ctx.strokeStyle = '#e0806a'; ctx.strokeRect(ob.x + 0.5, ob.y + 0.5, ob.w - 1, ob.h - 1);
    drawText(ctx, 'ORC WARBAND - a desert wasteland', ob.x + 6, ob.y + 5, '#f0b0a0');
    drawText(ctx, 'This town is saved. A new one grows fresh.', x + 8, y + 60, '#6a6f7c');
    drawText(ctx, 'You travel there to found it.', x + 8, y + 72, '#5a5f6c');
    worldMapUiHits = worldMapUiHits || {};
    worldMapUiHits.foundHuman = hb; worldMapUiHits.foundOrc = ob; worldMapUiHits.foundClose = { x, y, w, h };
}

// Birth a new town of a chosen culture: navigate to a FRESH seed with the culture set. The current town is
// autosaved (the navigation triggers a tab-hide/unload save) and stays in the world index — not lost.
//
// #P0 PLACEMENT (council precondition): a town's world position is townPos(seed) — a pure hash — so a purely random
// seed lands ANYWHERE, its reach never overlaps yours, and it never interacts (no meeting, no raid, no seam). So we
// REJECTION-SAMPLE the seed: keep the one whose townPos lands in a target BAND around the anchor town (the one
// selected on the map, else the one we're in), just inside its reach so their circles MEET within a session — a
// created orc warband then actually shows up to raid. Math.random is fine here: UI picking a seed, never the sim.
function foundNewTown(culture) {
    const idx = worldMapIdx || { towns: {} };
    const anchorSeed = worldMapSel != null ? worldMapSel : (world ? world.seed : null);
    let seed = Math.floor(Math.random() * 0x7fffffff);
    if (anchorSeed != null) {
        const a = townPos(anchorSeed);
        const aSum = (idx.towns || {})[String(anchorSeed)];
        const aReach = aSum ? townReach(aSum) : 140;
        const minD = Math.max(55, aReach * 0.55), maxD = aReach + 55;   // just inside the anchor's reach → they meet soon
        let best = seed, bestErr = Infinity;
        for (let i = 0; i < 500; i++) {
            const s = Math.floor(Math.random() * 0x7fffffff);
            const p = townPos(s), d = Math.hypot(p.x - a.x, p.y - a.y);
            const err = d < minD ? minD - d : d > maxD ? d - maxD : 0;
            if (err < bestErr) { bestErr = err; best = s; if (err === 0) break; }
        }
        seed = best;
    }
    location.href = location.pathname + '?seed=' + seed + (culture === 'orc' ? '&culture=orc' : '');
}

// ---------------------------------------------------------------------------
// Settings menu — New Town + music/SFX volume. Opened by the top-bar gear cog.
// ---------------------------------------------------------------------------
function drawSettings() {
    const PW = Math.min(GW - 24, 240), PH = ADMIN_BOOTH ? 242 : 158;   // +26 town-file row, +18 share row   // the booth rows only exist under ?admin=1; coach line removed
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
    // (NEW TOWN removed — founding lives on the world map's CREATE TOWN now; the wipe hatch stays as RYFARMS.wipeSave)

    // #saveport — TOWN FILE: export the current town to a file / import one back. Import shows the
    // file's own name+day and takes a second click, and the replaced town lands in the same
    // 'backup:wipe' object a wipe uses, so RYFARMS.undoWipe() reverses a mistaken import too.
    {
        const half = Math.floor((PW - 20) / 2);
        const eb = { x: IX, y: PY + 100, w: half, h: 14 };
        const ib = { x: IX + half + 4, y: PY + 100, w: half, h: 14 };
        ctx.fillStyle = '#141e18'; ctx.fillRect(eb.x, eb.y, eb.w, eb.h);
        ctx.strokeStyle = '#69b077'; ctx.strokeRect(eb.x + 0.5, eb.y + 0.5, eb.w - 1, eb.h - 1);
        const el = 'EXPORT TOWN';
        drawText(ctx, el, eb.x + Math.floor((eb.w - textWidth(el)) / 2), eb.y + 4, '#8fd09b');
        const confirming = !!pendingImport;
        ctx.fillStyle = confirming ? '#2e2410' : '#141824'; ctx.fillRect(ib.x, ib.y, ib.w, ib.h);
        ctx.strokeStyle = confirming ? '#e0b040' : '#5a6f9c'; ctx.strokeRect(ib.x + 0.5, ib.y + 0.5, ib.w - 1, ib.h - 1);
        const il = confirming ? 'CLICK TO CONFIRM' : 'IMPORT TOWN...';
        drawText(ctx, il, ib.x + Math.floor((ib.w - textWidth(il)) / 2), ib.y + 4, confirming ? '#f0c860' : '#9ab8e8');
        settingsHits.exportBtn = eb; settingsHits.importBtn = ib;

        // #postcard — SHARE: mints a ?seed link + copy line onto the clipboard. Determinism is the
        // product here: the recipient's browser grows this very town from the seed alone.
        const sb = { x: IX, y: PY + 118, w: PW - 16, h: 14 };
        ctx.fillStyle = '#0f2026'; ctx.fillRect(sb.x, sb.y, sb.w, sb.h);
        ctx.strokeStyle = '#5aa8c0'; ctx.strokeRect(sb.x + 0.5, sb.y + 0.5, sb.w - 1, sb.h - 1);
        const sl = 'SHARE THIS TOWN';
        drawText(ctx, sl, sb.x + Math.floor((sb.w - textWidth(sl)) / 2), sb.y + 4, '#9ad8ec');
        settingsHits.shareBtn = sb;

        // The battle-tale loss is disclosed HERE, before the confirming click (Codex #121 r4 P1):
        // the export-time notice appeared on the SENDING browser, and this one may never have seen
        // it. Import clears the target seed's rows and battle tales are irreconstructible — that is
        // the destructive fact, and it must precede the click that commits it.
        // (One note line under all three rows — share results land here too.)
        const note = pendingImport
            ? (pendingImport.occupied
                ? `GETS ${String(pendingImport.town || 'TOWN').slice(0, 12)} D${pendingImport.day || '?'} - OLD BATTLE TALES LOST FOREVER`
                : `GETS ${String(pendingImport.town || 'TOWN').slice(0, 12)} DAY ${pendingImport.day || '?'} - CLICK TO CONFIRM`)
            : (saveportNote && performance.now() < saveportNote.until ? saveportNote.text : 'A TOWN FILE MOVES YOUR SAVE BETWEEN BROWSERS');
        drawText(ctx, note, IX, PY + 136, pendingImport ? '#e0a850' : '#5a5f6c');
    }

    // #credits — CraftPix character sprites (licence: deployed-game use OK). Click opens their pack page.
    {
        // owner: only the "CRAFTPIX.NET" tail is the link — the prefix is plain caption text
        const cPrefix = 'CERTAIN SPRITES ARE CREATED BY ';
        const cLink = 'CRAFTPIX.NET';
        const pw2 = textWidth(cPrefix), lw = textWidth(cLink);
        const cb = { x: IX + pw2, y: PY + 141, w: lw + 2, h: 9 };
        const chov = inRect(mouse, cb);
        drawText(ctx, cPrefix, IX, PY + 143, '#5a5f6c');
        drawText(ctx, cLink, IX + pw2, PY + 143, chov ? '#9ad0e0' : '#8a8f9c');
        ctx.fillStyle = chov ? '#9ad0e0' : '#3a3f4c'; ctx.fillRect(IX + pw2, PY + 149, lw, 1);   // underline: only the link
        settingsHits.craftpix = cb;
    }

    // #admin THE DIRECTOR'S BOOTH — stage a ghost rehearsal (raid / the vote) for videos and stress-tests.
    // Nothing a rehearsal does is recorded (no chronicle, no roles, no SuperMemory, stripped from saves).
    // #adminbooth ?admin=1 only — see the flag's comment at module scope.
    if (ADMIN_BOOTH) {
        const rh = world.rehearsal;
        drawText(ctx, 'ADMIN - REHEARSALS (GHOST RUNS, NOTHING RECORDED)', IX, PY + 156, '#8a6fae');
        const admRow = (y, key, live, liveLabel, idleLabel) => {
            const b = { x: IX, y, w: PW - 16, h: 14 };
            ctx.fillStyle = live ? '#2e2410' : '#141824'; ctx.fillRect(b.x, b.y, b.w, b.h);
            ctx.strokeStyle = live ? '#e0b040' : '#5a6f9c'; ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
            const label = live ? liveLabel : idleLabel;
            drawText(ctx, label, b.x + Math.floor((b.w - textWidth(label)) / 2), b.y + 4, live ? '#f0c860' : '#9ab8e8');
            settingsHits[key] = b;
        };
        admRow(PY + 166, 'admRaid', rh && rh.kind === 'raid', 'RAID REHEARSAL LIVE - CANCEL', 'STAGE A RAID');
        admRow(PY + 184, 'admVote', rh && rh.kind === 'election', 'VOTE REHEARSAL LIVE - CANCEL', 'STAGE THE VOTE');
        admRow(PY + 202, 'admSortie', rh && rh.kind === 'sortie', 'WAR PARTY LIVE - CANCEL', 'STAGE A WAR PARTY');   // #counteroffensive

        // #Codex38 P2-5: the booth REFUSES to stage over a real raid — say so, instead of silently closing
        if (adminNote && performance.now() < adminNote.until) drawText(ctx, adminNote.text, IX, PY + 218, '#e0a850');
    }
    // (the "ESC OR CLICK OUTSIDE TO CLOSE" coach line is gone — owner call, the affordance is universal)
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
    const label = cultureWord(world.culture, 'fac.' + fac.type);   // orc-aware; falls back to the human label
    const who = owner ? owner.sheet.name.split(' ')[0] + "'s " : '';
    const lines = [{ t: (label === 'fac.' + fac.type ? m[0] : label), c: TT_G }, { t: `${who}facility`, c: TT_L }];
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
            const wdw = Math.round(wellArt().w * ASSET_SCALE), wdh = Math.round(wellArt().h * ASSET_SCALE);
            push(Math.floor(sx + TILE_W / 2 - wdw / 2 - 10), Math.floor(sy + TILE_H - wdh + 2), wdw, wdh, structLines(s));
        } else {
            const spr = structSprites[s.type], sp = Array.isArray(spr) ? spr[0] : spr;
            if (sp) push(Math.floor(sx - sp.width / 2), Math.floor(sy + TILE_H - sp.height), sp.width, sp.height, structLines(s));
        }
    }
    { const wl = world.well, sx = cam.x + isoX(wl.i, wl.j), sy = cam.y + isoY(wl.i, wl.j);
      const wdw = Math.round(wellArt().w * ASSET_SCALE), wdh = Math.round(wellArt().h * ASSET_SCALE);
      push(Math.floor(sx + TILE_W / 2 - wdw / 2 - 10), Math.floor(sy + TILE_H - wdh + 2), wdw, wdh,
        [{ t: cultureWord(world.culture, 'struct.well'), c: TT_G }, { t: 'Water source', c: TT_L }, { t: 'Water for the whole town', c: TT_B }]); }
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
        [{ t: `${(world.name || 'TOWN').toUpperCase()} ${cultureWord(world.culture, 'struct.silo')} — LV ${world.townLevel}`, c: TT_G }, { t: world.townCharacter(), c: TT_L },
         { t: cultureWord(world.culture, 'struct.siloDesc'), c: TT_GR },
         { t: maxed ? 'The town is fully grown' : `${world.townXP} / ${world.townXpNeed()} to level ${world.townLevel + 1}`, c: TT_B }]); }
    // legend monuments — hover to read the deed they mark (#85)
    for (const m of (world.monuments || [])) {
        const sx = cam.x + isoX(m.i, m.j), sy = cam.y + isoY(m.i, m.j);
        const spr = monumentSpr(m.tier), tg = m.tier ?? 2, bY = Math.floor(sy + TILE_H / 2 + 2);
        const grav = tg >= 5 ? `a war remembered · day ${m.day}` : tg === 4 ? `a grievous day · day ${m.day}`
            : tg === 3 ? `a costly stand · day ${m.day}` : `a stand · day ${m.day}`;
        push(Math.floor(sx - spr.width / 2), bY - spr.height, spr.width, spr.height,
            [{ t: 'MONUMENT', c: TT_G }, { t: `${m.hero} felled ${m.foe}`, c: TT_L }, { t: grav, c: TT_GR }]);
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

// #hover — the farmer or foe directly under the cursor, for a quick NAME tooltip. Farmers only when OUT IN THE
// OPEN (not tucked inside a home) — you hover to ID someone moving around, or a felled soul lying out with no
// roof yet; a housed recovering farmer is inside and out of sight. Foes always name themselves (the raid warband
// + wilderness orcs/assassins/beasts). Returns drawInfoBox lines, or null.
function entityUnder(mx, my) {
    const tile = screenToTile(mx, my);
    let best = null, bd = 1.4;
    for (const f of world.farmers) {
        if (isIndoors(f)) continue;
        const d = Math.hypot(f.pos.i - tile.i, f.pos.j - tile.j);
        if (d < bd) { bd = d; best = { kind: 'farmer', f }; }
    }
    for (const e of world.encounters) {
        if (e.done || e.presentational || !e.def) continue;
        const d = Math.hypot(e.i - tile.i, e.j - tile.j);
        if (d < bd) { bd = d; best = { kind: 'foe', e }; }
    }
    if (world.raidEvent && world.raidEvent.raiders) for (const r of world.raidEvent.raiders) {
        const d = Math.hypot(r.i - tile.i, r.j - tile.j);
        if (d < bd) { bd = d; best = { kind: 'raider', r }; }
    }
    if (!best) return null;
    if (best.kind === 'farmer') {
        const f = best.f, nm = f.sheet.name.split(' ')[0].toUpperCase();
        if (f.downed) return [{ t: nm, c: '#e0703c' }, { t: 'recovering', c: '#c8a090' }];
        const role = farmerRole(f), lines = [{ t: nm, c: '#e8ecf5' }];
        if (role) lines.push({ t: role, c: '#e8c860' });
        return lines;
    }
    const foe = best.kind === 'foe' ? best.e : best.r;
    const isBeast = foe.def && foe.def.kind === 'beast';
    const nm = (foe.foeName || (foe.def && foe.def.name) || 'orc raider').toUpperCase();
    return isBeast ? [{ t: nm, c: '#c8a060' }] : [{ t: nm, c: '#e08850' }, { t: 'raider', c: '#c8a090' }];
}

function currentStatus(f) {
    const orc = !!(f.world && f.world.culture === 'orc');   // #3.1 orc warband status flavour
    if (f.downed) return orc ? 'LICKING WOUNDS IN THE DEN' : 'RECOVERING AT HOME';
    if (f.carryTrophy) return 'CARRYING HOME A FRESH KILL';
    if (f.state === 'hunt' || f.huntTarget) return 'STALKING WILD GAME FOR MEAT';
    if (f.barterDeal || (f.path && f.path.then === 'barter')) {
        const p = f.barterDeal && f.barterDeal.partner;
        return p ? `OFF TO ${orc ? 'TRADE SPOILS WITH' : 'BARTER WITH'} ${p.sheet.name.split(' ')[0].toUpperCase()}` : (orc ? 'OFF TO TRADE SPOILS' : 'OFF TO BARTER GOODS');
    }
    if (f.helpTask) return orc ? 'ANSWERING THE WAR-HORN' : 'LENDING A NEIGHBOR A HAND';
    if (f.emote === 'grudge') return 'STEERING CLEAR OF SOMEONE THEY DISLIKE';
    if (f.emote === 'bond') return orc ? 'SWEARING A BLOOD-BOND' : 'WARMING TO A NEIGHBOR';
    const hpFrac = f.maxHp ? f.hp / f.maxHp : 1;
    if (hpFrac < 0.35) return 'BADLY WOUNDED - LIMPING IT OFF';
    if (hpFrac < 0.9) return 'NURSING A WOUND';
    const map = { work: 'TENDING THE FARM', walk: 'ON THE MOVE', chop: 'CHOPPING TIMBER', break: 'GRUBBING A STUMP',
        mine: 'MINING STONE', forage: 'FORAGING THE WILDS', fish: 'FISHING A WILD LAKE', build: 'BUILDING WITH THE TOWN',
        housebuild: 'RAISING THEIR HOME', coopbuild: 'RAISING A COOP', fencepost: 'RAISING A FENCE', craft: 'CRAFTING',
        sleep: 'ASLEEP', rest: 'RESTING UP', sick: 'LAID UP SICK', shelter: 'SHELTERING FROM THE STORM',
        care: 'TENDING A SICK NEIGHBOR', fight: 'STANDING AND FIGHTING', flee: 'FLEEING DANGER',
        donate: 'HAULING SURPLUS TO THE SILO', scarecrow: 'RAISING A SCARECROW' };
    if (orc) Object.assign(map, { work: 'MINDING THE CAMP', chop: 'HEWING TIMBER FOR THE PALISADE',
        forage: 'SCAVENGING THE WILDS', build: 'RAISING THE PALISADE', housebuild: 'THROWING UP A DEN',
        coopbuild: 'RAISING A CROW-ROOST', fencepost: 'RAISING THE PALISADE', care: 'TENDING A WOUNDED ORC',
        donate: 'HAULING PLUNDER TO THE HOARD', scarecrow: 'RAISING A WARDING-SKULL' });
    return map[f.state] || (f.thought ? f.thought : 'GOING ABOUT THEIR DAY');
}
// #vote-panel (owner: "a screen of votes... so you get a sense of where things are heading") — the
// live tally, in the detail sheet's slot, while the founding gathering holds. Reads the sim's pure
// electionPreview (the same ballot math the dusk reading runs); votes reveal progressively, the
// leader glows gold, and the panel yields to any farmer sheet the moment the vote ends.
function voteWindowActive() {
    return !!(world && !world._spectator && world.roles && world.roles.foundingPhase === 'gathering');
}
function drawVotePanel() {
    const pv = world.electionPreview && world.electionPreview();
    if (!pv) return;
    const PW = 154, PX = GW - PW - 4, PY = 22;
    const PH = GH - 22 - PY - 3;
    uiPanel(PX, PY, PW, PH);
    const IX = PX + 7, IW = PW - 14;
    const orc = world.culture === 'orc';
    // title band, matching the sheet's
    ctx.fillStyle = '#2b2016'; ctx.fillRect(IX - 2, PY + 6, IW + 4, 21);
    ctx.fillStyle = '#e8c860'; ctx.fillRect(IX - 2, PY + 6, IW + 4, 1); ctx.fillRect(IX - 2, PY + 26, IW + 4, 1);
    drawText(ctx, orc ? 'THE WARBAND CHOOSES' : 'THE TOWN DECIDES', IX, PY + 10, '#ffffff', 1);
    drawText(ctx, 'THE BALLOT IS READ AT DUSK', IX, PY + 19, '#8a7ca0');
    let y = PY + 34;
    const OFFICE_LABEL = { manager: orc ? 'WARCHIEF' : 'MANAGER', watch: 'THE WATCH' };
    for (const off of pv.offices) {
        ctx.fillStyle = '#3a2c10'; ctx.fillRect(IX - 2, y, IW + 4, 9);
        drawText(ctx, OFFICE_LABEL[off.office] || off.office.toUpperCase(), IX + 1, y + 2, '#e8c860');
        y += 12;
        const rows = [...off.rows].sort((a, b) => b.votes - a.votes || (a.seed - b.seed));
        const maxV = Math.max(1, ...rows.map(r => r.votes));
        for (const r of rows) {
            const col = r.leader ? '#f0d060' : '#c8ccd8';
            drawText(ctx, r.name.slice(0, 12), IX + 1, y, col);
            const vs = String(r.votes);
            drawText(ctx, vs, IX + IW - textWidth(vs) - 1, y, col);
            // vote bar under the name — filled share of the current max
            ctx.fillStyle = '#20242f'; ctx.fillRect(IX + 1, y + 6, IW - 2, 2);
            ctx.fillStyle = r.leader ? '#f0d060' : '#5a6f8c';
            ctx.fillRect(IX + 1, y + 6, Math.max(r.votes > 0 ? 2 : 0, Math.round((IW - 2) * (r.votes / maxV))), 2);
            y += 11;
        }
        y += 4;
    }
    y += 2;
    if (pv.revealed <= 0) {
        drawText(ctx, 'THE SPEECHES HOLD THE FLOOR', IX, y, '#6a6f7c');
        drawText(ctx, 'VOTES FOLLOW SOON', IX, y + 7, '#6a6f7c');
    } else {
        drawText(ctx, `${pv.revealed}/${pv.total} VOTES CAST`, IX, y, '#7dd069');
        if (pv.revealed < pv.total) drawText(ctx, 'STILL COMING IN...', IX, y + 7, '#6a6f7c');
        else drawText(ctx, 'ALL VOICES HEARD', IX, y + 7, '#8a7ca0');
    }
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
    // #recovery a felled farmer shows how far along their mend is — "RECOVERING 1/3" (day X of Y) — so you can
    // see, at a glance, when they'll be back on their feet. Y = reviveDay - downFrom; X = today's day within it.
    let hStr = f.downed ? 'RECOVERING' : f.health === 'sick' ? 'SICK' : f.tired ? 'TIRED' : 'WELL';
    if (f.downed && f.reviveDay) {
        const total = (f.downFrom ? f.reviveDay - f.downFrom : 3) || 3;
        const dayOf = Math.max(1, Math.min(total, f.downFrom ? (world.day - f.downFrom + 1) : total - (f.reviveDay - world.day) + 1));
        hStr = `RECOVERING ${dayOf}/${total}`;
    }
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
        kv(IX, 'LAND', `${f.plot.cells.size}t`); drawText(ctx, cultureWord(world.culture, 'stat.yield'), IX + 76, y, SHEET_LABEL); drawText(ctx, String(s.cropsHarvested || 0), IX + 108, y, SHEET_VAL); y += 7;
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
            // #inspiration slice 1 — the strongest live seed, beside the course line (the sheet's
            // self-decision surface). Opt-in inspection only: no numbers, just the thought's life.
            {
                const seeds = f.sheet.conscience?.seeds;
                if (seeds) {
                    // a STIRRING seed (sprouted, its self-sown urge live, act pending) outranks
                    // the strongest — it is the one whose story is happening right now
                    const cc = f.sheet.conscience;
                    const stirring = Object.keys(seeds).find(k => seeds[k].sprouted && cc.urge && cc.urge.origin === 'inspiration' && cc.urge.kind === k && !cc.urge.resolved && world.day <= cc.urge.expiresDay);   // !resolved (Codex #124 r3)
                    let bk = stirring || null;
                    if (!bk) for (const k of Object.keys(seeds)) if (!bk || seeds[k].w > seeds[bk].w) bk = k;
                    if (bk) {
                        const s = seeds[bk];
                        const st = stirring ? 'stirring' : seedStage(s, world.day);
                        // the farmer's own remembered phrasing of the whisper when it exists (C2 —
                        // the same words they'll speak if it ever germinates); kind/target otherwise
                        const what = s.phrase ? `'${String(s.phrase).slice(0, 24)}'`
                            : (s.target ? `${bk} (${String(s.target).split(' ')[0]})` : bk);
                        const word = st === 'stirring' ? 'STIRRING' : st === 'fresh' ? 'PLANTED' : st === 'turning' ? 'TAKING ROOT' : 'FADING';
                        for (const ln of wrapText(`A SEED: ${what.toUpperCase()} - ${word}`, 34)) { drawText(ctx, ln, IX + 2, y, st === 'fading' ? '#8a8f9c' : st === 'stirring' ? '#7dd069' : '#c8b060'); y += 7; }
                    }
                }
            }

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
                const ow = k.overwritten;                          // #reconciliation: a hard-won belief has outgrown it
                const col = ow ? '#6b6b74' : (inh ? '#e0c8f0' : '#c8a0e0');
                if (inh && k.inherited && k.inherited.name) { drawText(ctx, `carried from ${String(k.inherited.name).split(' ')[0]}:`, IX + 7, y, '#8a7ca0'); y += 7; }
                ctx.fillStyle = col; ctx.fillRect(IX + 2, y + 2, 2, 2);
                for (const ln of wrapText(k.quote, 33)) {
                    drawText(ctx, ln, IX + 7, y, col);
                    if (ow) { ctx.fillStyle = '#6b6b74'; ctx.fillRect(IX + 7, y + 2, textWidth(ln), 1); }   // struck through — no longer quoted
                    y += 7;
                }
                if (ow) { drawText(ctx, 'outgrown - a belief won out', IX + 7, y, '#c9a45a'); y += 7; }
                y += 2;
            }

            // #91 Tier-3 — BELIEFS: convictions FORMED from lived experience (not inherited like creeds).
            // Only shown once a farmer has actually learned something the hard way (e.g. being denied care).
            // #reconciliation: a crossfaction belief is the one at WAR with a raid-creed — flag it warm + say so.
            const bels = f.beliefs || [];
            if (bels.length) {
                y += 1;
                y = sectionBand(IX, y, IW, 'HARD-WON BELIEFS');
                for (const b of bels) {
                    const xf = b.tag === 'crossfaction';
                    const bcol = xf ? '#7dd069' : '#8fc7e8';
                    ctx.fillStyle = bcol; ctx.fillRect(IX + 2, y + 2, 2, 2);
                    for (const ln of wrapText(`"${b.text}" (day ${b.day})`, 33)) { drawText(ctx, ln, IX + 7, y, bcol); y += 7; }
                    if (xf) {
                        const won = (f.creeds || []).some(c => c.overwritten && c.theme === b.contradicts);
                        drawText(ctx, won ? 'outgrew the raid-creed' : 'at war with an old creed', IX + 7, y, '#c9a45a'); y += 7;
                    }
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
let rosterTab = 0;                // 0 PLAYER STATS (the cast stat list), 1 ROLES (civic offices — moved out of Chronicle)
let rosterTabHits = null;         // [{ x, y, w, h, tab }] roster tab-chip rects (game px)

function rosterSorted() {
    return [...world.farmers].sort((a, b) => (b.sheet.cropsHarvested || 0) - (a.sheet.cropsHarvested || 0));
}

// ── Shared tab bar ───────────────────────────────────────────────────────────
// The roster's tab style — a filled active chip topped by an underline accent — reads better than the old flat
// chronicle chips, so it's now the ONE tab component every modal uses. Draws chips left→right from (x,y) and RETURNS
// the [{ x, y, w, h, tab }] hit rects (assign them to the panel's *TabHits for click routing). `accent` is the active
// color — green in the roster, purple in the chronicle — so each modal keeps its identity while sharing the shape.
const TABBAR_H = 10;
function hexA(hex, a) {   // '#rrggbb' -> 'rgba(r,g,b,a)' — a low-alpha wash for the active chip fill
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
function drawTabBar(x, y, labels, activeIndex, accent) {
    const hits = [];
    let tx = x;
    for (let i = 0; i < labels.length; i++) {
        const label = labels[i], tw = textWidth(label) + 8, active = i === activeIndex;
        ctx.fillStyle = active ? hexA(accent, 0.18) : 'rgba(255,255,255,0.05)';
        ctx.fillRect(tx, y, tw, TABBAR_H);
        if (active) { ctx.fillStyle = accent; ctx.fillRect(tx, y + TABBAR_H - 1, tw, 1); }   // the underline accent
        drawText(ctx, label, tx + 4, y + 2, active ? accent : '#8a8f9c');
        hits.push({ x: tx, y, w: tw, h: TABBAR_H, tab: i });
        tx += tw + 3;
    }
    return hits;
}

function drawRoster() {
    const PW = Math.min(GW - 12, 372);
    const PH = GH - 40;
    const PX = Math.floor((GW - PW) / 2);
    const PY = 22;
    rosterRows = []; rosterTabHits = [];

    // dim the world behind
    ctx.fillStyle = 'rgba(6,7,11,0.72)';
    ctx.fillRect(0, 18, GW, GH - 18);

    // panel — shared wood frame (matches the Board + character sheet)
    uiPanel(PX, PY, PW, PH);

    // header
    drawText(ctx, cultureWord(world.culture, 'panel.rosterTitle'), PX + 7, PY + 5, '#7dd069', 1);
    drawText(ctx, `${world.farmers.length} ${cultureWord(world.culture, 'noun.settlers')}`, PX + PW - 40, PY + 5, '#9aa0b4');
    // close X
    drawText(ctx, 'X', PX + PW - 10, PY + 5, '#c8ccd8');

    // TAB BAR — PLAYER STATS / ROLES. Roles moved here from the Chronicle (it's about the individuals, so it lives
    // with the roster). The stat list and the civic offices are two views of the same cast, swapped by these chips.
    const RT_LABELS = ['PLAYER STATS', cultureWord(world.culture, 'panel.rolesTitle')];
    const tabY = PY + 15;
    rosterTabHits = drawTabBar(PX + 6, tabY, RT_LABELS, rosterTab, '#7dd069');

    // ROLES view — the civic offices, hosted here (drawChronicleRoles is self-contained, no external scroll).
    if (rosterTab === 1) {
        const rTop = tabY + 14, rBot = PY + PH - 10;
        drawChronicleRoles(PX, rTop, PW, rBot);
        rosterView = { x: PX, y: PY, w: PW, h: PH, bodyTop: rTop, bodyBot: rBot, rowH: 11, maxScroll: 0 };
        return;
    }

    // column header
    const hy = tabY + 14;
    const colName = PX + 6;
    const colLv = PX + 86;
    const colStats = PX + 106;
    const statW = (PW - 106 - 26) / 6;
    drawText(ctx, 'NAME', colName, hy, '#6a6f7c');
    drawText(ctx, 'LV', colLv, hy, '#6a6f7c');
    ['ST', 'DE', 'CO', 'IN', 'WI', 'CH'].forEach((c, i) =>
        drawText(ctx, c, Math.floor(colStats + i * statW), hy, '#6a6f7c'));
    drawText(ctx, cultureWord(world.culture, 'stat.yld'), PX + PW - 22, hy, '#6a6f7c');
    ctx.fillStyle = '#20242f';
    ctx.fillRect(PX + 4, hy + 8, PW - 8, 1);

    // the window splits: the roster LIST is locked to the top, the CONSCIENCE CHAT to the bottom. The list gets
    // the lion's share so the whole cast is visible (was 0.46 — the chat's empty middle wasted rows + clipped
    // the last settler); the chat keeps a compact strip that still holds its prompt + recent lines.
    // scrollable body (clipped) — the roster list now uses the WHOLE panel; the whisper chat moved out to the
    // standalone bottom-left widget (drawChatWidget), so the roster is purely the cast list.
    const bodyTop = hy + 11;
    const bodyBot = PY + PH - 10;
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
    // (the conscience chat moved to the standalone bottom-left whisper widget — see drawChatWidget)
}

// ---------------------------------------------------------------------------
// Conscience chat — the player's whispers to one farmer, locked to the bottom
// half of the roster window. The sim decides what the farmer makes of each
// thought (farm.js conscienceCheck); this only renders the exchange + captures input.
// ---------------------------------------------------------------------------

// (the verdict color/glyph alphabet is gone — the owner watched himself misread it as canned-vs-live on
// launch night; if the designer can't decode a private alphabet, players never will. Replies are plain.)

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

// #legibility Slice 2 — an 8x8 speech-bubble glyph for the whisper widget (the 1-bit pack had no clean chat
// icon at this size, so it's hand-drawn): a rounded bubble with two "text" lines and a little tail.
function drawChatIcon(x, y, active) {
    ctx.fillStyle = active ? '#7dd069' : '#c8ccd8';
    const body = ['.#####.', '#######', '#######', '#######', '.#####.'];
    for (let r = 0; r < body.length; r++) for (let c = 0; c < 7; c++) if (body[r][c] === '#') ctx.fillRect(x + c, y + r, 1, 1);
    ctx.fillRect(x + 1, y + 5, 1, 1);   // tail dropping from the bottom-left
    ctx.fillStyle = active ? '#12300d' : '#242833';   // two dark "text" lines inside the bubble
    ctx.fillRect(x + 2, y + 1, 3, 1); ctx.fillRect(x + 2, y + 3, 3, 1);
}

// #legibility Slice 2 — the WHISPER, elevated to the primary screen: a minimized bottom-left button that
// expands into the conscience chat (transcript + the [NAME v] character picker + input). Hidden while a full
// panel owns the screen (the roster carries its own copy of the chat there). Reuses drawConscienceChat.
function drawChatWidget() {
    CHAT_BTN.w = CHAT_CLOSE.w = CHAT_PANEL.w = 0;
    if (!booted || !world || rosterOpen || chronOpen || boardOpen || settingsOpen || worldMapOpen) return;
    if (!chatWidgetOpen) {
        // 15x14 (odd width) so the 7x6 glyph centers EXACTLY: 4px margin on every side (4+7+4=15, 4+6+4=14).
        const bw = 15, bh = 14, bx = 6, by = GH - bh - 6;
        CHAT_BTN.x = bx; CHAT_BTN.y = by; CHAT_BTN.w = bw; CHAT_BTN.h = bh;
        ctx.fillStyle = 'rgba(12,14,22,0.85)'; ctx.fillRect(bx, by, bw, bh);
        ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.fillRect(bx, by, bw, 1);
        drawChatIcon(bx + 4, by + 4, false);
        // hover tooltip — ABOVE the cursor (the button hugs the bottom edge, so a below-cursor label would clip)
        if (mouse.x >= 0 && !mouse.dragging && inRect(mouse, CHAT_BTN)) {
            const lbl = 'WHISPER', w = textWidth(lbl) + 6;
            const tx = Math.max(2, Math.min(GW - w - 2, Math.round(mouse.x - w / 2))), ty = Math.round(mouse.y) - 12;
            ctx.fillStyle = 'rgba(12,10,20,0.95)'; ctx.fillRect(tx, ty, w, 10);
            ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(tx, ty, w, 1);
            drawText(ctx, lbl, tx + 3, ty + 2, '#e8e4d8');
        }
        return;
    }
    const w = 172, h = 140, x = 6, y = GH - h - 6;
    CHAT_PANEL.x = x; CHAT_PANEL.y = y; CHAT_PANEL.w = w; CHAT_PANEL.h = h;
    ctx.fillStyle = 'rgba(8,9,13,0.93)'; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#3a3f4c'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    drawChatIcon(x + 5, y + 3, false);                 // white in the expanded state (owner call)
    drawText(ctx, 'WHISPER', x + 15, y + 4, '#c8ccd8');
    CHAT_CLOSE.x = x + w - 12; CHAT_CLOSE.y = y; CHAT_CLOSE.w = 12; CHAT_CLOSE.h = 11;
    // minimize: a hover plate so it reads as a BUTTON, not furniture
    const minHot = mouse.x >= 0 && inRect(mouse, CHAT_CLOSE);
    if (minHot) { ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(CHAT_CLOSE.x, CHAT_CLOSE.y + 1, CHAT_CLOSE.w - 1, CHAT_CLOSE.h - 2); }
    drawText(ctx, '_', x + w - 9, y + 3, minHot ? '#ffffff' : '#c8ccd8');   // minimize back to the button
    drawConscienceChat(x, y + 12, w, h - 12);          // header([NAME v]) + transcript + input, sets the hit-rects
    if (chatDropdownOpen) drawChatDropdown(x, w, y + 12);
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
    const caretX = nmX + textWidth(nm + ' ', 1);
    chatNameHit = { x0: nmX - 2, y0: hy - 2, x1: caretX + 8, y1: hy + 8 };
    // name + caret hover as ONE shape — it is one control (the farmer picker), so it lights as one
    const nameHot = mouse.x >= chatNameHit.x0 && mouse.x <= chatNameHit.x1 && mouse.y >= chatNameHit.y0 && mouse.y <= chatNameHit.y1;
    if (nameHot) { ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.fillRect(chatNameHit.x0, chatNameHit.y0, chatNameHit.x1 - chatNameHit.x0, chatNameHit.y1 - chatNameHit.y0); }
    drawText(ctx, nm, nmX, hy, nameHot ? '#ffffff' : '#e8ecf5');
    drawCaret(caretX, hy, chatDropdownOpen, nameHot ? '#ffffff' : '#7dd069');   // '^' open, same caret flipped for closed
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
    // #whisper-voice — the NEWEST reply writes itself out word by word, each word chirped in the
    // farmer's animalese as it lands. Progress advances only while the panel is drawn (dt-capped),
    // so a minimized widget holds the line rather than letting it silently catch up; the first word
    // lands with the reply so there is never an empty beat after the "..." shimmer.
    // #inspiration — the newest QUESTION exchange per kind carries the seed's stateful line
    // (computed before the render loop that reads it)
    const lastQuestionFor = {};
    for (const e of c.log) if (e.who !== 'voice' && e.verdict === 'QUESTION' && e.kind) lastQuestionFor[e.kind] = e;
    let revealEntry = null, revealText = '';
    if (chatReveal && chatReveal.c === c) {
        const last = c.log[c.log.length - 1];
        // Codex #123-2: a reveal held across a day boundary would chirp a line the display loop
        // below no longer shows (or shows dimmed) — the moment has passed, stand down and render
        // plain. age < 1 keeps the reveal strictly a today thing.
        const age = last ? world.day - (last.day ?? world.day) : 0;
        if (last && last.who !== 'voice' && last.text === chatReveal.text && age < 1) {
            const now = performance.now();
            // A gap over 500ms means the panel was hidden or the tab slept — rebase to a ZERO
            // delta instead of granting the capped 0.1s (Codex #123-2: `last` kept its stale
            // timestamp while hidden, so every reopen silently advanced a tenth of a second).
            const dt = chatReveal.last && (now - chatReveal.last) < 500 ? Math.min(0.1, (now - chatReveal.last) / 1000) : 0;
            chatReveal.last = now; chatReveal.progress += dt;
            const wordsAll = String(last.text).split(' ');
            let tAcc = 0, count = 1;   // word 0 is free
            for (let i = 1; i < wordsAll.length; i++) {
                tAcc += wordDelay(wordsAll[i], chatReveal.voice);
                if (chatReveal.progress >= tAcc) count = i + 1; else break;
            }
            while (chatReveal.spoken < count) { if (whisperVoiceFx !== 'off') audio.speakWord(chatReveal.voice, wordsAll[chatReveal.spoken], whisperVoiceFx); chatReveal.spoken++; }
            if (count >= wordsAll.length) { chatReveal = null; chatFreeze = null; }   // fully out — render plain, release the frozen anchors
            else { revealEntry = last; revealText = wordsAll.slice(0, count).join(' '); }
        } else if (!last || last.who !== 'voice') { chatReveal = null; chatFreeze = null; }   // log moved on, or the entry aged past today — stand down (only an armed-and-awaiting 'voice' tail keeps it)
    }
    // #inspiration (Codex #124 r2 P1) — the age-2 fade removed the QUESTION exchange at EXACTLY
    // GERM_MIN_AGE, so the original exchange could show PLANTED and TAKING HOLD but never
    // STIRRING, FADING or TOOK ROOT: the payoff aged out before it could arrive. A seed-anchor
    // exchange (the newest QUESTION per kind) now lives as long as its STORY does — while the
    // seed exists, and for two days after it takes root — and its paired voice line stays with it.
    // seed lookup that honors the pre-verdict freeze: while a reply is pending/revealing, a seed
    // the verdict just destroyed still anchors and still shows its pre-verdict stage
    const seedFor = (k) => (c.seeds && c.seeds[k]) || (chatFreeze && chatFreeze.c === c && chatFreeze.seeds[k]) || null;
    const storyAlive = (e) => {
        if (e.who === 'voice' || e.verdict !== 'QUESTION' || !e.kind || e !== lastQuestionFor[e.kind]) return false;
        if (seedFor(e.kind)) return true;                                  // planted/turning/stirring/fading — still living (or frozen mid-reveal)
        return e.rooted != null && world.day - e.rooted < 2;               // took root — linger two days, then rest
    };
    for (let ei = 0; ei < c.log.length; ei++) {
        const e = c.log[ei];
        // thoughts FADE: yesterday's dim, older than that leave the panel entirely (the stored log keeps
        // its 40-entry cap for the LLM's memory — this is display hygiene, not amnesia)
        const age = world.day - (e.day ?? world.day);
        const next = c.log[ei + 1];
        const anchored = storyAlive(e) || (e.who === 'voice' && next && storyAlive(next));   // keep the question with its reply
        if (age >= 2 && !anchored) continue;
        const isVoice = e.who === 'voice';
        const col = age >= 1 ? '#6a6f7c' : (isVoice ? '#c8b060' : '#c8ccd8');   // gold = your thought, white = their reply, grey = yesterday
        // #inspiration — a QUESTION reply is the seed verdict: mark it in the player's own log
        // (out-of-fiction bookkeeping, adjudication C2) with a small gold sprout glyph.
        const prefix = isVoice ? '> ' : (e.verdict === 'QUESTION' ? '* ' : '  ');
        const wrapped = wrapLine(prefix + (e === revealEntry ? revealText : e.text), maxChars);
        wrapped.forEach((ln, i) => lines.push({ text: (i === 0 ? ln : '  ' + ln), col }));
        // #inspiration C2 (owner: the loop must not feel hidden) — a STATEFUL seed line in the
        // transcript itself, under the newest QUESTION exchange per kind, reflecting the ledger's
        // live truth: green while the seed lives (planted -> taking hold -> fading), gold once it
        // took root. Derived, never stored — the capped log and the LLM history stay clean — and
        // it waits for the reveal to finish so the reply lands before its consequence.
        if (!isVoice && e.verdict === 'QUESTION' && e.kind && e === lastQuestionFor[e.kind] && e !== revealEntry) {
            // e.rooted is stamped on the EXACT entry at the sprout moment (Codex #124 P2 — a
            // kind+day lookup let a later same-day QUESTION inherit an earlier sprout's credit)
            // the status dims by ITS OWN freshness, never the exchange's age — an anchored old
            // exchange is exactly where TOOK ROOT lands, and it must land gold
            const seed = seedFor(e.kind);
            if (e.rooted != null) {
                lines.push({ text: `  * TOOK ROOT DAY ${e.rooted}`, col: world.day - e.rooted >= 1 ? '#6a6f7c' : '#c8b060' });
            } else if (seed) {
                const stirring = seed.sprouted && c.urge && c.urge.origin === 'inspiration' && c.urge.kind === e.kind && !c.urge.resolved && world.day <= c.urge.expiresDay;   // !resolved: a refused sprout is not stirring (Codex #124 r3)
                const st = stirring ? 'stirring' : seedStage(seed, world.day);
                const txt = st === 'stirring' ? '* THE SEED IS STIRRING' : st === 'fresh' ? '* A SEED IS PLANTED' : st === 'turning' ? '* THE SEED IS TAKING HOLD' : '* THE SEED IS FADING';
                lines.push({ text: '  ' + txt, col: st === 'fading' ? '#8a8f9c' : '#7dd069' });
            }
        }
    }
    if (chatThinking) lines.push({ text: '  ' + '.'.repeat(1 + (Math.floor(Date.now() / 300) % 3)), col: '#7dd069' });

    const lineH = 7;
    const viewH = bodyBot - bodyTop;
    const contentH = lines.length * lineH;
    const maxScroll = Math.max(0, contentH - viewH);
    // chatScroll counts UP from the bottom: 0 = pinned to the NEWEST line. The old math anchored the TOP
    // at scroll 0, so once the transcript overflowed, every new reply rendered below the clip — a full
    // panel looked like whispering had stopped working (owner-found bug).
    chatScroll = Math.max(0, Math.min(chatScroll, maxScroll));
    chatViewport = { x, y, w, h, bodyTop, bodyBot, maxScroll };

    ctx.save();
    ctx.beginPath();
    ctx.rect(x + 1, bodyTop - 1, w - 2, viewH + 1);
    ctx.clip();
    let ly = bodyTop + (viewH - contentH) + Math.round(chatScroll);
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
    const caret = (chatFocused && Math.floor(Date.now() / 500) % 2 === 0) ? '_' : '';
    // clip to the field: show only the TAIL that fits (so a long whisper scrolls with the caret instead of
    // overflowing the box). ~4px per glyph in the 3x5 font; leave a char of room for the caret.
    const maxInput = Math.max(4, Math.floor((w - 18) / 4));
    if (val) {
        const tail = val.length > maxInput ? val.slice(val.length - maxInput) : val;
        drawText(ctx, tail + caret, x + 8, ey + 4, '#e8ecf5');
    } else {
        drawText(ctx, chatFocused ? caret : 'WHISPER A THOUGHT...', x + 8, ey + 4, '#5a5f6c');
    }
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
        const hot = mouse.x >= dx + 1 && mouse.x <= dx + dw - 1 && mouse.y >= ry - 1 && mouse.y < ry - 1 + rowH;
        if (f === chatFarmer) { ctx.fillStyle = 'rgba(125,208,105,0.18)'; ctx.fillRect(dx + 1, ry - 1, dw - 2, rowH); }
        else if (hot) { ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.fillRect(dx + 1, ry - 1, dw - 2, rowH); }
        drawText(ctx, f.sheet.name.split(' ')[0].slice(0, 14), dx + 4, ry + 1, f === chatFarmer ? '#7dd069' : (hot ? '#ffffff' : '#c8ccd8'));
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
    // #whisper-fx — a pop per typed character. The 'input' event (not keydown) so modifiers and
    // dead keys stay silent, IME/paste count once, and backspace/space get their own lower voices.
    el.addEventListener('input', (e) => {
        if (whisperKeyFx === 'off') return;
        const it = e.inputType || '';
        if (it.startsWith('delete')) audio.keyPop('delete', whisperKeyFx);
        else if (it === 'insertText' && e.data === ' ') audio.keyPop('space', whisperKeyFx);
        else if (it.startsWith('insert')) audio.keyPop('insert', whisperKeyFx);
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
    // `|| chatReveal` (Codex #124 r4): chatThinking clears when the request RETURNS, but the
    // reply may still be writing itself out — a second Enter mid-reveal overwrote chatFreeze
    // with post-verdict state and cut the first reveal short. While the farmer is speaking,
    // Enter waits its turn (the typed text stays in the box).
    if (!text || chatThinking || chatReveal) return;
    el.value = '';
    chatThinking = true;
    chatScroll = 0;   // snap to newest
    try {
        // #Codex36 P1-2: capture the town the whisper belongs to — the callback fires up to 20s later, and a
        // crossing in between would otherwise save the DESTINATION town and lose the whisper on the source.
        const w = world;
        chatScroll = 0;   // a new exchange snaps the transcript to the newest line
        chatFreeze = { c: f.conscience, seeds: structuredClone(f.conscience.seeds || {}) };   // hold the pre-verdict anchors through the reveal
        // #funnel — the whisper is the game's only verb, so "did they ever use it" is the funnel's
        // hinge step. Fired on SEND, not on reply: a whisper that 429s into the fallback template
        // is still the player having used the verb, and gating on a successful LLM round-trip would
        // under-report exactly the sessions where the breaker was tripped.
        // funnelPlayed(), not bare trackOnce (Codex #97 P1-2): "Watch a Wild Town" leaves an
        // interactive spectator backdrop, and a whisper to it would spend the durable flag before
        // the player ever founds a real town — whose genuine first whisper then never records.
        if (funnelPlayed()) trackOnce('first_whisper');
        const r = await whisper(w, f, text, () => { if (w && !w._retired) saveTown(w); });   // #Codex37 P1-2: a retired (wiped) town stays wiped
        // #whisper-voice — arm the write-out: the reply arrives word by word, each word voiced in
        // the farmer's own animalese pitch (stable per farmer; orcs low and slow). Display-only.
        if (r && r.reply) {
            chatReveal = {
                c: f.conscience, text: r.reply, progress: 0, spoken: 0, last: 0,
                voice: voiceOf(f.sheet.seed, w.culture, f.sheet.personality?.competitiveness ?? 0.5),
            };
        }
        // #inspiration telemetry — a perception feature's only real test is whether players meet
        // it; seed_planted per QUESTION verdict (germination adds seed_germinated in slice 2).
        if (r && r.verdict === 'QUESTION') track('seed_planted', { seed: w.seed, kind: r.kind });
    } catch (err) {
        console.warn('ry-farms: whisper failed', err);
    } finally {
        chatThinking = false;
        chatScroll = 0;
        if (!chatReveal) chatFreeze = null;   // no reveal to protect — release the pre-verdict anchors now
    }
}

// ---------------------------------------------------------------------------
// Town chronicle — the settlement's lasting saga (big beats, grouped by day).
// Town-wide by default; with a farmer selected it narrows to THEIR personal story.
// ---------------------------------------------------------------------------
let chronRows = [];               // { e, y0, y1, farmerSeed } visible hit regions
let chronView = null;             // { x, y, w, h, bodyTop, bodyBot, maxScroll } — the SCROLL BODY (below tabs)
let chronPanel = null;            // { x, y, w, h } — the WHOLE modal (title+tabs+body); used for click-outside close
let chronTownWide = false;        // force the town-wide chronicle even when a farmer is in focus
let chronScopeHits = null;        // { town, farmer } toggle-chip rects (game px)
let chronTab = 0;                 // 0 NEWS (the event log/saga), 1 RECIPES (discoveries), 2 TALES (ROLES → Roster)
let chronTabHits = null;          // [{ x, y, w, h, tab }] tab-chip rects (game px)
const CHRON_TABS = ['NEWS', 'RECIPES', 'TALES'];   // ROLES moved to the Roster panel (it's about the individuals)
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
    const mgrLabel = cultureWord(world.culture, 'role.manager');
    drawText(ctx, mgrLabel, IX, ty, '#9a7fc0');
    drawText(ctx, m.sheet.name.split(' ')[0].toUpperCase(), IX + textWidth(mgrLabel + ' '), ty, '#e8c860');
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
        const wLabel = cultureWord(world.culture, 'role.watch');
        drawText(ctx, wLabel, IX, ty, '#9a7fc0');
        drawText(ctx, wch.sheet.name.split(' ')[0].toUpperCase(), IX + textWidth(wLabel + ' '), ty, '#e8c860');
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
        const hLabel = cultureWord(world.culture, 'role.healer');
        drawText(ctx, hLabel, IX, ty, '#9a7fc0');
        drawText(ctx, hlr.sheet.name.split(' ')[0].toUpperCase(), IX + textWidth(hLabel + ' '), ty, '#e8c860');
        if (roles.healerNeedsHerbs) drawText(ctx, 'NEEDS HERBS', IX + textWidth(hLabel + ' ') + textWidth(hlr.sheet.name.split(' ')[0].toUpperCase() + '  '), ty, '#e0a03c');
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
    const roles = world.roles;
    const h = drawCivicBand(PX, top + 2, PW);
    let y;
    if (!h) {
        // No ELECTED chairs yet — but a fresh town self-organizes a fair ROTATING WATCH at its founding
        // congregation, so surface whose watch it is today (it turns as the rotation cycles) before the
        // empty state. Once the town elects its first officers the civic band above takes over.
        const wr = world.currentWatcher && world.currentWatcher();
        if (wr) {
            drawText(ctx, cultureWord(world.culture, 'role.watch').toUpperCase() + ' — ROTATING', IX, top + 4, '#c8a860');
            const nm = wr.sheet.name.split(' ')[0].toUpperCase();
            drawText(ctx, nm, IX + 4, top + 14, '#e8c860');
            drawText(ctx, 'keeps watch today', IX + 4 + textWidth(nm + ' '), top + 14, '#8a8f9c');
            let yy = top + 23;
            for (const ln of wrapText('The founders share the watch on a fair rotation until the town elects its first officers.', Math.floor((PW - 24) / 4.2))) { drawText(ctx, ln, IX + 4, yy, '#6a6f7c'); yy += 7; }
            y = yy + 3;
        } else {
            drawText(ctx, 'No offices seated yet — the town is still finding its feet.', IX, top + 4, '#6a6f7c');
            return;
        }
    } else {
        y = top + 2 + h + 2;
    }

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
            drawText(ctx, cultureWord(world.culture, rec.office === 'manager' ? 'role.manager' : 'role.watch'), IX + 4, y, '#9a7fc0');
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
let recipeSlotRects = [];   // #107 hover-tooltip registry for the ingredient icon-slots (screen rects, per frame)
function drawChronicleRecipes(PX, top, PW, bot) {
    const IX = PX + 8;
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
    // #107 an INGREDIENT ROW — the recipe's contents as icon-slots (icon + quantity badge) instead of words.
    // Each slot registers its rect for the hover tooltip that names the good.
    const recipeInputList = (id) => { const r = world.recipeById ? world.recipeById(id) : RECIPE_BY_ID[id]; return (r && r.inputs) ? Object.entries(r.inputs) : []; };
    const pushIngredients = (id) => {
        const ings = recipeInputList(id);
        if (!ings.length) return;
        push(16, y => { let sx = IX + 8; for (const [g, q] of ings) { recipeSlotRects.push(drawGoodSlot(sx, y + 1, 13, g, q)); sx += 16; } });
    };
    recipeSlotRects = [];   // rebuilt from the rows that actually draw this frame (in-view only)

    push(8, y => drawText(ctx, 'EVERYONE KNOWS', IX, y, '#8a8f9c'));
    for (const id of ['soup', 'salve', 'tonic']) {
        push(8, y => drawText(ctx, RECIPE_BY_ID[id].name, IX + 4, y, '#7dd069'));
        pushIngredients(id);
    }
    push(4);

    // discovered recipes — rarest/most-potent first, ALL of them (scrollable)
    push(10, y => { drawText(ctx, 'INVENTED', IX, y, CHRON_ACCENT); const t = `${known.size}`; drawText(ctx, t, PX + PW - 8 - textWidth(t), y, '#9aa0b4'); });
    if (!known.size) push(7, y => drawText(ctx, 'The town has invented nothing yet — give it time.', IX, y, '#6a6f7c'));
    else for (const [id, names] of [...known.entries()].sort((a, b) => ((world.recipeById(b[0])?.tier || 0) - (world.recipeById(a[0])?.tier || 0)))) {
        const nm = world.recipeName ? world.recipeName(id) : ((RECIPE_BY_ID[id] || {}).name || id);
        push(8, y => drawText(ctx, nm, IX, y, '#ffd24a'));
        pushIngredients(id);
        const lore = world.recipeLore ? world.recipeLore(id) : null;
        if (lore) wrapPush(lore, '#9a86c0', 4);
        const rec = world.recipes && world.recipes[id];
        const inv = rec && rec.discovererSeed != null ? (world.farmers.find(f => f.sheet.seed === rec.discovererSeed)?.sheet.name.split(' ')[0]) : null;
        const h = heard.get(id) || 0;
        wrapPush((inv ? `invented by ${inv} - ` : '') + 'known by ' + names.join(', ') + (h ? `  (${h} have heard)` : ''), '#8a8f9c', 4);
        push(4);
    }

    chronScrollBody(rows, PX, top, PW, bot);

    // #107 hover tooltip: name the ingredient under the pointer (only within the scroll viewport)
    for (const r of recipeSlotRects) {
        if (mouse.x >= r.x && mouse.x < r.x + r.w && mouse.y >= r.y && mouse.y < r.y + r.h && mouse.y >= top && mouse.y < bot) {
            const w = textWidth(r.label) + 6;
            const tx = Math.max(2, Math.min(GW - w - 2, Math.round(r.x + r.w / 2 - w / 2)));
            let ty = r.y - 10; if (ty < top) ty = r.y + r.h + 1;   // flip below when it'd clip the panel header
            ctx.fillStyle = 'rgba(12,10,20,0.95)'; ctx.fillRect(tx, ty, w, 9);
            ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(tx, ty, w, 1);
            drawText(ctx, r.label, tx + 3, ty + 2, '#e8e4d8');
            break;
        }
    }
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
    chronPanel = { x: PX, y: PY, w: PW, h: PH };   // whole-modal bounds for click-outside close (title incl.)

    // dim behind, then the shared wood frame (matches the Board + character sheet)
    ctx.fillStyle = 'rgba(6,7,11,0.72)';
    ctx.fillRect(0, 18, GW, GH - 18);
    uiPanel(PX, PY, PW, PH);

    // header — the panel title reflects the active tab (NEWS can narrow to one Ry's saga)
    const cf = chronTab === 0 ? chronFocusFarmer() : null;
    const title = chronTab === 1 ? cultureWord(world.culture, 'panel.recipesTitle') : chronTab === 2 ? cultureWord(world.culture, 'panel.talesTitle')
        : cf ? `SAGA OF ${cf.sheet.name.split(' ')[0].toUpperCase()}` : cultureWord(world.culture, 'panel.chronicleTitle');
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

    // TAB BAR — NEWS / RECIPES / TALES. Now uses the shared drawTabBar (the roster's underline-accent style), in the
    // chronicle's purple. (ROLES lives in the Roster now.)
    chronTabHits = drawTabBar(PX + 8, PY + 18, CHRON_TABS, chronTab, CHRON_ACCENT);
    ctx.fillStyle = '#20242f';
    ctx.fillRect(PX + 4, PY + 30, PW - 8, 1);

    const bodyTop = PY + 33;
    const bodyBot = PY + PH - 11;

    // RECIPES + TALES render their own (non-scrolling) bodies and return; NEWS falls through below. (ROLES moved
    // to the Roster panel.)
    if (chronTab === 1) { drawChronicleRecipes(PX, bodyTop, PW, bodyBot); return; }
    if (chronTab === 2) { drawChronicleTales(PX, bodyTop, PW, bodyBot); return; }
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
    // #catchup a BACKLOG of grand spotlights means the player looked away (or ran fast-forward, which spawns beats
    // far faster than the 4.6s-each spotlights can drain) — and would otherwise face a gauntlet of pop-ups to click
    // through on return. Once more than 3 have piled up, FOLD the lot — plus any active spotlight + queued callouts —
    // into ONE "WHILE YOU WERE AWAY" summary card (the resume-card format) and clear the queues, so coming back is a
    // single calm read. Skips if a resume card is already up (don't clobber the on-load "PREVIOUSLY ON").
    if (!resumeCard && momentQueue.length > 3) {
        const src = [...(activeMoment ? [activeMoment.e] : []), ...momentQueue, ...calloutQueue];
        resumeCard = {
            title: 'WHILE YOU WERE AWAY', day: world.day, season: world.season, year: world.year, shownAt: 0,
            beats: src.slice(-8).map(e => ({ text: e.text, color: e.color || '#c8ccd8', day: e.day })),
        };
        momentQueue.length = 0; calloutQueue.length = 0; activeMoment = null;
    }
}

// callout tier — a SINGLE lighter toast at a time (never a stack): show the front of the queue briefly,
// then move to the next. Short-lived by design so beats flash past rather than piling up.
const calloutQueue = [];      // chronicle entries waiting to flash
let activeCallout = null;     // { e, shownAt }
let CALLOUT_MS = 5700;        // #callout longer still (1900 -> 3800 -> 5700, +1.5x) — a discovery toast lingers to read + dismiss
const CALLOUT_CLOSE = { x: 0, y: 0, w: 0, h: 0 };   // the toast's X hit-rect (set each frame one is up; cleared otherwise)
function drawCallouts() {
    const nowMs = performance.now();
    // ONE narrator at a time (player: "too much stuff to keep up with and dismiss"): while a spotlight CARD
    // is up, the toast channel holds — the active toast freezes and the queue waits its turn.
    if (activeMoment) { if (activeCallout) activeCallout.shownAt = nowMs; CALLOUT_CLOSE.w = 0; return; }
    if (activeCallout && nowMs - activeCallout.shownAt > CALLOUT_MS) activeCallout = null;
    if (!activeCallout && calloutQueue.length) {
        activeCallout = { e: calloutQueue.shift(), shownAt: nowMs };
        try { audio.moment('neutral'); } catch { /* not ready */ }
    }
    if (!activeCallout) { CALLOUT_CLOSE.w = 0; return; }
    // a full-screen modal panel is ON TOP — don't draw the toast over it (the timer above still advances, so it
    // expires behind the modal instead of popping stale when it closes).
    if (worldMapOpen || rosterOpen || chronOpen || boardOpen || settingsOpen) { CALLOUT_CLOSE.w = 0; return; }
    // #away-banner — toasts STACK BELOW the persistent away strip instead of landing on top of it
    // (owner call); the recap card, when present, still wins the lower anchor.
    const y = Math.max(RECAP_CARD.w ? RECAP_CARD.y + RECAP_CARD.h + 4 : 0, AWAY_BAR.w ? AWAY_BAR.y + AWAY_BAR.h + 2 : 0, 22);
    {
        const c = activeCallout;
        const age = nowMs - c.shownAt;
        const fade = Math.min(1, age / 140) * Math.min(1, (CALLOUT_MS - age) / 420);
        const accent = c.e.tone === 'somber' ? '#7a9ade' : c.e.tone === 'triumph' ? '#f0d060' : '#9ad0e0';
        const txt = c.e.text.toUpperCase();
        const XW = 10;   // room for the dismiss X on the right
        const w = Math.min(GW - 16, textWidth(txt) + 14 + XW), x = Math.floor((GW - w) / 2);
        ctx.save(); ctx.globalAlpha = fade;
        ctx.fillStyle = 'rgba(12,14,22,0.92)'; ctx.fillRect(x, y, w, 12);
        ctx.fillStyle = accent; ctx.fillRect(x, y, 2, 12);
        drawText(ctx, txt.slice(0, Math.floor((w - 10 - XW) / 4)), x + 6, y + 3, '#dfe4ee');
        drawText(ctx, 'X', x + w - 7, y + 3, 'rgba(210,150,150,0.95)');   // click to dismiss
        ctx.restore();
        CALLOUT_CLOSE.x = x + w - 10; CALLOUT_CLOSE.y = y; CALLOUT_CLOSE.w = 10; CALLOUT_CLOSE.h = 12;   // full-height, easy to tap
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

// #raidfx — the "UNDER RAID" battle-transition. A hit-flash, then jagged war-bands slam shut from
// alternating edges (staggered so they cascade), a big "UNDER RAID" callout while the screen is
// covered, then the bands snap open to reveal the raid already underway. Display-only; drawn under
// the CRT shader (so it gets the scanline/aberration treatment for free).
// #raid-feel the transition now LINGERS (1.25s → 3.2s: user note — "it just disappears, doesn't feel as
// triumphant as it can be"): a fast slam, a LONG covered hold with the callout up, then the reveal — and the
// war-horn sting sounds THREE times across it (fired from the ticker at t 0 / 1.05 / 2.1, see the main loop).
const RAIDFX_DUR = 3.2;
function drawRaidFx() {
    const p = Math.min(1, raidFx.t / RAIDFX_DUR);

    // A — impact flash: a red slam with a white core at the very first instant
    if (p < 0.08) {
        ctx.fillStyle = `rgba(196,32,24,${(1 - p / 0.08) * 0.72})`;
        ctx.fillRect(0, 0, GW, GH);
        if (p < 0.02) { ctx.fillStyle = `rgba(255,238,228,${(1 - p / 0.02) * 0.6})`; ctx.fillRect(0, 0, GW, GH); }
    }

    // B — war-bands slam shut FAST (0.04→0.20), HOLD covered long (0.20→0.72 ≈ 1.7s), open (0.72→1.0)
    const bands = 8, bandH = Math.ceil(GH / bands);
    for (let k = 0; k < bands; k++) {
        const fromLeft = (k % 2) === 0;
        let c;   // 0 = fully open, 1 = fully covering
        const cs = 0.04 + k * 0.008;
        if (p < 0.20) c = Math.min(1, Math.max(0, (p - cs) / (0.20 - cs)));
        else if (p < 0.72) c = 1;
        else { const os = 0.72 + k * 0.008; c = 1 - Math.min(1, Math.max(0, (p - os) / (1.0 - os))); }
        if (c <= 0) continue;
        const e = c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;   // easeInOutCubic
        const w = Math.round(GW * e);
        const y = k * bandH;
        const x = fromLeft ? 0 : GW - w;
        ctx.fillStyle = (k % 2) ? '#35110d' : '#480f0a';
        ctx.fillRect(x, y, w, bandH);
        // torn bright leading edge, jagged per row
        const edge = fromLeft ? w : GW - w;
        ctx.fillStyle = '#b02218';
        for (let r = 0; r < bandH; r += 2) {
            const jag = ((k * 13 + r * 7) % 5) - 2;
            ctx.fillRect(edge - 3 + (fromLeft ? jag : -jag), y + r, 3, 2);
        }
    }

    // C — the "INCOMING RAID..." callout: punch in early, HOLD through the covered stretch, fade with the reveal.
    // (This shader now fires at the SENTRY'S ALARM — the warband has been spotted closing, not yet arrived.)
    if (p > 0.12 && p < 0.95) {
        const q = Math.min(1, (p - 0.12) / 0.05);                 // punch-in 0→1
        const fade = p > 0.86 ? Math.max(0, 1 - (p - 0.86) / 0.09) : 1;
        const big = 'INCOMING RAID...';
        let scale = 4; while (scale > 2 && textWidth(big, scale) > GW * 0.9) scale--;   // fit the longer headline
        const bw = textWidth(big, scale);
        const bx = Math.floor((GW - bw) / 2), by = Math.floor(GH / 2 - scale * 5);
        ctx.save(); ctx.globalAlpha = fade;
        drawText(ctx, big, bx + 1, by + 1, '#1a0605', scale);     // drop shadow
        drawText(ctx, big, bx, by, q < 1 ? '#ffe6b0' : '#ff5a3c', scale);
        const sub = `${(world.name || 'THE TOWN').toUpperCase()} — TO ARMS`;
        const sx = Math.floor((GW - textWidth(sub, 1)) / 2);
        drawText(ctx, sub, sx, by + scale * 6 + 4, '#e8c9a0', 1);
        ctx.restore();
    }

    // D — a lingering red vignette as the world comes back
    if (p > 0.68) {
        const g = ctx.createRadialGradient(GW / 2, GH / 2, GH * 0.3, GW / 2, GH / 2, GH * 0.75);
        const a = Math.max(0, 1 - (p - 0.68) / 0.32) * 0.5;
        g.addColorStop(0, 'rgba(120,10,6,0)'); g.addColorStop(1, `rgba(120,10,6,${a})`);
        ctx.fillStyle = g; ctx.fillRect(0, 0, GW, GH);
    }
}

// ============================================================================
// #P2 CURSOR-CROSSING — walk the camera across the frontier into a neighbour town.
// Pan far enough from the well toward a town you've MET (reaches touching in the world plane) and an edge
// cue names it; keep going and the channel CHANGES — a beat of CRT static, then you arrive on the far
// town's frontier, entering from the side you left by. One live World at a time (the council's P2 shape):
// the current town SETTLES + SAVES first (same discipline as opening the world map), then the neighbour's
// save loads via the exact boot path (World.fromSave -> set-hook -> exactly-once inbox consume -> _live).
// No farmers migrate; nothing crosses but the camera. Determinism: the sim can't tell this from a reload.
// ============================================================================
let _battleWatch = null;   // #nemesis last-seen raidEvent — its END triggers the battle-record writeback
let pendingInscription = null;   // #inscription the write-receipt card, shown once the SuperMemory doc actually lands
let crossFx = null;        // { t, phase:'out'|'in', name, seed, ang } — the channel-change static
let crossHint = null;      // { seed, name, ang, k } — this frame's edge cue (rebuilt each frame)
let _switching = false;    // one swap at a time

const CROSS_CONE = 0.6;    // radians of slack around a neighbour's bearing
// #P2 crossing consent v3 (player direction): the first sign of a neighbour is a WORLD-ANCHORED marker —
// literal gray text + an arrow sitting OUT IN THE FOG along the neighbour's bearing, scrolling with the
// map, never overlapping revealed ground. You only meet it by panning into the dark. The pulsing WARN
// banner and the crossing itself sit progressively deeper beyond it.
function crossThresholds() {
    const R = world && world.revealRadius ? world.revealRadius() : 40;
    return { marker: R + 10, warn: Math.max(70, R + 30), cross: Math.max(95, R + 52) };
}

// Known neighbours whose reach TOUCHES ours (the met/meeting pairs), with their world-plane bearing mapped
// onto the local grid (i = plane-x, j = plane-y — the same mapping everywhere a bearing is drawn).
function crossNeighbors() {
    if (!worldMapIdx || !worldMapIdx.towns || !world) return [];
    const me = worldMapIdx.towns[String(world.seed)];
    const A = townPos(world.seed), aReach = me ? townReach(me) : 60;
    const out = [];
    for (const t of Object.values(worldMapIdx.towns)) {
        if (String(t.seed) === String(world.seed)) continue;
        const B = townPos(t.seed);
        const dist = Math.hypot(B.x - A.x, B.y - A.y);
        if (dist > aReach + townReach(t)) continue;   // the seam only exists where reaches meet
        out.push({ seed: t.seed >>> 0, name: t.name || `town ${t.seed}`, culture: t.culture, ang: Math.atan2(B.y - A.y, B.x - A.x), dist });
    }
    return out;
}

// Per-frame: is the camera out on a frontier that leads somewhere? (No cue mid-drama or in menus — and a
// FOLLOWED farmer never drags the player across a border; only a deliberate pan crosses.)
function updateCrossing() {
    crossHint = null;
    if (!booted || !world || _switching || crossFx || followMode) return;
    if (rosterOpen || chronOpen || boardOpen || settingsOpen || worldMapOpen) return;
    if (world.pendingRaid || world.raidEvent || world.rehearsal) return;
    const c = screenToTile(GW / 2, GH / 2);
    const di = c.i - CENTER, dj = c.j - CENTER, r = Math.hypot(di, dj);
    const T = crossThresholds();
    // the pulsing WARN banner + the crossing require the camera centre DEEP in the dark (never over
    // revealed ground — the fog markers below handle everything before this point, in the world itself)
    const ci2 = Math.round(c.i), cj2 = Math.round(c.j);
    const inDark = ci2 < 0 || cj2 < 0 || ci2 >= GRID || cj2 >= GRID || !world.isRevealed(ci2, cj2);
    if (!inDark || r < T.warn) return;
    const ang = Math.atan2(dj, di);
    let best = null, bd = Infinity;
    for (const n of crossNeighbors()) {
        let da = ang - n.ang; da = Math.atan2(Math.sin(da), Math.cos(da));
        if (Math.abs(da) > CROSS_CONE) continue;
        if (Math.abs(da) < bd) { bd = Math.abs(da); best = n; }
    }
    if (!best) return;
    crossHint = { ...best, stage: 2, k: Math.min(1, Math.max(0, (r - T.warn) / (T.cross - T.warn))) };
    if (r >= T.cross) { crossFx = { t: 0, phase: 'out', name: best.name, seed: best.seed, ang: best.ang }; crossHint = null; }
}

// The edge cue: a pulsing chevron + the neighbour's name, pinned toward the screen edge in its direction.
// #P2 v3 — the FOG MARKERS: each met neighbour plants literal gray text + an arrow OUT IN THE DARK along
// its bearing (world-anchored, scrolls with the map). Drawn only over unrevealed ground, so it never sits
// on trees or farmland — you meet it by panning to the edge of what you've explored. Static, no pulse.
function drawFogMarkers() {
    if (crossFx || followMode || !worldMapIdx) return;
    if (rosterOpen || chronOpen || boardOpen || settingsOpen || worldMapOpen) return;
    const T = crossThresholds();
    for (const n of crossNeighbors()) {
        const label = `${n.name.toUpperCase()} LIES THIS WAY`;
        const half = textWidth(label) / 2;
        // #fog-label the label must sit on the DARK fog, not the revealed green (gray-on-green is illegible). Push
        // the marker OUTWARD along the bearing until the WHOLE label width (sampled across its screen span → tiles)
        // is unrevealed. Recomputed each frame, so as land is revealed the text re-plants deeper in the dark.
        let md = T.marker, wi, wj, sx = 0, sy = 0, clear = false;
        for (let step = 0; step < 26 && !clear; step++, md += 3) {
            wi = CENTER + Math.cos(n.ang) * md; wj = CENTER + Math.sin(n.ang) * md;
            sx = cam.x + isoX(wi, wj); sy = cam.y + isoY(wi, wj);
            clear = true;
            for (const off of [-half, -half * 0.5, 0, half * 0.5, half]) {
                const t = screenToTile(sx + off, sy - 2), ti = Math.round(t.i), tj = Math.round(t.j);
                if (ti >= 0 && tj >= 0 && ti < GRID && tj < GRID && world.isRevealed(ti, tj)) { clear = false; break; }
            }
        }
        if (!clear) continue;   // no fully-dark spot within reach on this bearing — nothing legible to show
        if (sx < 60 || sx > GW - 60 || sy < 30 || sy > GH - 24) continue;   // its clear spot is off-screen — find it there
        ctx.save(); ctx.globalAlpha = 0.8;
        drawText(ctx, label, Math.round(sx - half), Math.round(sy - 4), '#6a7080');
        // a small gray arrow beneath, pointing deeper into the dark (screen-space bearing)
        const sdx = Math.cos(n.ang) - Math.sin(n.ang), sdy = (Math.cos(n.ang) + Math.sin(n.ang)) / 2;
        const nn = Math.hypot(sdx, sdy) || 1, ax = sx, ay = sy + 8;
        ctx.fillStyle = '#6a7080';
        ctx.beginPath();
        ctx.moveTo(ax + (sdx / nn) * 5, ay + (sdy / nn) * 5);
        ctx.lineTo(ax - (sdy / nn) * 3.2, ay + (sdx / nn) * 3.2);
        ctx.lineTo(ax + (sdy / nn) * 3.2, ay - (sdx / nn) * 3.2);
        ctx.closePath(); ctx.fill();
        ctx.restore();
    }
}

function drawCrossHint() {
    if (!crossHint || crossFx) return;
    const sdx = Math.cos(crossHint.ang) - Math.sin(crossHint.ang);
    const sdy = (Math.cos(crossHint.ang) + Math.sin(crossHint.ang)) / 2;
    const n = Math.hypot(sdx, sdy) || 1;
    const ex = Math.max(30, Math.min(GW - 30, GW / 2 + (sdx / n) * (GW / 2 - 40)));
    const ey = Math.max(34, Math.min(GH - 30, GH / 2 + (sdy / n) * (GH / 2 - 40)));
    // the WARN banner only (the calm first sign is the world-anchored fog marker, drawn separately)
    const label = crossHint.k > 0.55 ? `KEEP GOING - CROSS INTO ${crossHint.name.toUpperCase()}` : `THE ${crossHint.name.toUpperCase()} BORDER - PRESS ON TO CROSS`;
    const col = crossHint.culture === 'orc' ? '#e07050' : '#7dd069';
    const wpx = textWidth(label);
    ctx.save(); ctx.globalAlpha = 0.55 + 0.45 * Math.abs(Math.sin(performance.now() / 320));
    ctx.fillStyle = 'rgba(8,9,14,0.82)';
    ctx.fillRect(Math.round(ex - wpx / 2) - 4, Math.round(ey) - 3, wpx + 8, 12);
    drawText(ctx, label, Math.round(ex - wpx / 2), Math.round(ey), col);
    // a small chevron pointing the way (screen-space direction)
    const cx = ex + (sdx / n) * (wpx / 2 + 12), cy = ey + 3 + (sdy / n) * 8;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(cx + (sdx / n) * 4, cy + (sdy / n) * 4);
    ctx.lineTo(cx - (sdy / n) * 3, cy + (sdx / n) * 3);
    ctx.lineTo(cx + (sdy / n) * 3, cy - (sdx / n) * 3);
    ctx.closePath(); ctx.fill();
    ctx.restore();
}

// The channel change: static swells over the world, the destination card shows, static clears on arrival.
function drawCrossFx() {
    const a = crossFx.phase === 'out' ? Math.min(1, crossFx.t / 0.4) : Math.max(0, 1 - crossFx.t / 0.55);
    ctx.fillStyle = `rgba(5,6,9,${(0.9 * a).toFixed(3)})`; ctx.fillRect(0, 0, GW, GH);
    const grains = Math.floor(1400 * a);
    for (let k = 0; k < grains; k++) {
        const v = 30 + Math.random() * 100;
        ctx.fillStyle = `rgb(${v},${v},${v})`;
        ctx.fillRect((Math.random() * GW) | 0, (Math.random() * GH) | 0, 2, 1);
    }
    if (a > 0.55) {
        const title = 'CROSSING THE FRONTIER';
        drawText(ctx, title, Math.floor((GW - textWidth(title, 2)) / 2), Math.floor(GH / 2) - 14, '#9aa0b4', 2);
        const sub = `> ${String(crossFx.name).toUpperCase()}`;
        drawText(ctx, sub, Math.floor((GW - textWidth(sub)) / 2), Math.floor(GH / 2) + 6, '#7dd069');
    }
}

// The in-place World swap. Saves + registers the town you leave, loads the neighbour's save through the
// boot path, then resets every per-town lens this module holds. A neighbour with NO save falls back to URL
// navigation (a full boot founds it properly — only ever hit via QA, since crossing targets known towns).
async function switchTown(seed, ang) {
    if (_switching) return false;
    _switching = true;
    try {
        const s32 = seed >>> 0;
        // Codex #57-1/#57-2 — snapshot AND generation from one readonly transaction, so the crossed-into world
        // writes back under the generation it was read with.
        const crossState = await loadTownState(s32);
        // Codex #58 — a failed observation must not be read as "no town there". Navigating on a real URL change
        // re-boots, which re-observes the slot and fails closed there if storage is still unreadable; silently
        // treating it as empty here would found a savable town over a neighbour we never managed to look at.
        if (!crossState.ok) { console.error('ry-farms: could not read the neighbour slot — navigating instead of crossing'); location.search = '?seed=' + s32; return true; }
        const saved = crossState.snap, crossGen = crossState.gen;
        if (!saved) { location.search = '?seed=' + s32; return true; }
        if (world) {
            try { world.cancelRehearsal(); } catch { /* pre-admin saves */ }
            const summary = townSummary(world);
            const d = await saveTown(world);
            if (d != null) { summary.rev = world._rev; await registerWorld(world, summary); }
        }
        let next;
        try { next = World.fromSave(saved); }
        catch (err) { console.warn('ry-farms: neighbour save unreadable - navigating', err); location.search = '?seed=' + s32; return true; }
        // Codex #57-2 — adopt the DESTINATION slot's generation. Without this the crossed-into world ran as
        // generation 0, so if that slot had ever been quarantined, restored, wiped or undone, every save after
        // the crossing was refused and the session's progress was lost on the next reload — silently, since a
        // refusal only warns to the console. `crossGen` was read in the SAME transaction as this snapshot
        // (loadTownState), so the pair is coherent.
        next._gen = crossGen;
        const origSet = next.set.bind(next);
        next.set = (i, j, t) => { origSet(i, j, t); next._tilesChanged = true; };
        next._tilesChanged = true;
        try {
            const widx = await loadWorldIndex();
            const pending = (widx.inbox && widx.inbox[String(s32)]) || [];
            if (pending.length) await consumeInbox(next, pending);   // exactly-once, same as boot
            worldMapIdx = widx;
        } catch (err) { console.warn('ry-farms: inbox consume failed on cross', err); }
        next._live = true;
        next._tabHidden = document.hidden;
        world = next;
        lastSavedDay = world.day;
        resetTownLenses();
        // arrive on the frontier you entered by — the side facing the town you left — looking inward
        const ea = (ang != null ? ang : 0);
        const ei = CENTER - Math.cos(ea) * 44, ej = CENTER - Math.sin(ea) * 44;
        cam.x = GW / 2 - isoX(ei, ej); cam.y = GH / 2 - isoY(ei, ej);
        world.addLog(`You cross the frontier into ${world.name} - day ${world.day}, year ${world.year}`, '#7dd069');
        resumeCard = {   // the arrival payoff: what's been happening in the town you just walked into
            day: world.day, season: world.season, year: world.year, shownAt: 0,
            beats: world.chronicle.slice(-5).map(c => ({ text: c.text, color: c.color, day: c.day })),
        };
        try { history.replaceState(null, '', '?seed=' + s32); } catch { /* sandboxed contexts */ }
        return true;
    } finally { _switching = false; }
}

// #admin best-effort villain casting for a raid rehearsal: the first known town of the OTHER culture from
// the world index (if the map has been opened this session), else null -> farm.js's stock phantom warband.
function adminFoeName() {
    try {
        const towns = Object.values((worldMapIdx && worldMapIdx.towns) || {});
        const foe = towns.find(t => t && t.culture && t.culture !== world.culture && String(t.seed) !== String(world.seed));
        return foe && foe.name ? `the ${foe.name} warband` : null;
    } catch { return null; }
}

function drawMoments() {
    // #admin the election rehearsal's tally lands as a REAL spotlight card (the authentic election visual) —
    // but synthesized here, display-only: the entry never enters world.chronicle, so nothing is recorded.
    const rh = world.rehearsal;
    if (rh && rh.kind === 'election' && rh.result && !rh._carded) {
        rh._carded = true;   // rehearsal object is transient scratch — safe to mark
        activeMoment = { e: { label: 'THE TOWN DECIDES', kind: 'town', tone: 'triumph', color: '#f0d060',
            text: `${rh.result.managerName} would carry the town - and ${rh.result.watchName} the watch - if the vote were held today.`,
            whoSeed: rh.result.manager, day: world.day, season: world.season, year: world.year }, shownAt: performance.now() };
    }
    // A full-screen modal is ON TOP: don't draw the spotlight/toasts over it — but FREEZE the active ones (bump
    // their shownAt each frame) so they don't expire behind the modal; they resume, viewable, once it's dismissed.
    // #raid-feel a HOT raid owns the screen (player: "way too many messages on top of one another"): while
    // the alarm is up or the warband is on the field, spotlights + toasts FREEZE exactly like under a modal —
    // they resume once the fight is over (the raid's own grand beats then land as the aftermath reading).
    // ...and the freeze HOLDS through the debrief (council: the counterfactual toast + grand card + debrief
    // were three narrators claiming the same ten seconds). Order now: the line talks first, THEN the cards.
    const raidHot = world.raidEvent || (world.pendingRaid && world.pendingRaid.detected) ||
                    (world._debrief && world.time < world._debrief.until - 6);
    if (rosterOpen || chronOpen || boardOpen || settingsOpen || worldMapOpen || raidHot) {
        scanMoments();
        const now = performance.now();
        if (activeMoment) activeMoment.shownAt = now;
        if (activeCallout) activeCallout.shownAt = now;
        MOMENTS_HIT.w = 0; CALLOUT_CLOSE.w = 0;   // stale hitboxes would let clicks dismiss the frozen moment BEHIND the modal
        return;
    }
    scanMoments();
    const nowMs = performance.now();
    if (!activeMoment && momentQueue.length) {
        const e = momentQueue.shift();
        activeMoment = { e, shownAt: nowMs };
        try { audio.moment(e.tone || 'triumph'); } catch { /* audio not ready */ }
    } else if (!activeMoment && !activeCallout && !momentQueue.length && !calloutQueue.length && pendingInscription) {   // #Codex37 P1-1: the LAST toast finishes before the Inscription takes the stage
        // #inscription LAST in the aftermath order (debrief -> counterfactual -> grand card -> THIS): the
        // town visibly sets the battle down in its memory — the write-receipt, shown only once the
        // SuperMemory document actually landed. Synthesized display card; never enters the chronicle.
        const p = pendingInscription; pendingInscription = null;
        activeMoment = { e: { label: 'SET DOWN IN THE TOWN RECORD', kind: 'town', tone: 'neutral', color: '#9ad0e0',
            icon: p.foe ? 'foe:orc:1' : 'town',
            text: p.text, why: p.why, day: world.day, season: world.season, year: world.year }, shownAt: nowMs };
        try { audio.moment('neutral'); } catch { /* audio not ready */ }
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
    // #card-art (player: "show that foe, along with who raided with him") — raid cards carry the warband:
    // the foe front-and-center with his band ranked small beside him; town beats carry the gold TOWN diamond.
    const foeM = /^foe:orc(?::(\d+))?$/.exec(e.icon || '');
    const hasTownIcon = e.icon === 'town';
    const hasLeft = !!f || hasObject || !!foeM || hasTownIcon;
    const colCX = PX + 38;
    if (foeM && !f) {
        const img = threatImg.orc;
        if (img && img.complete && img.naturalWidth > 0) {
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(img, 0, 0, 64, 64, Math.round(colCX - 22), Math.round(PY + 22), 44, 44);   // row 0 = facing the camera
            const band = Math.max(0, Math.min(4, (parseInt(foeM[1] || '1', 10) || 1) - 1));
            for (let k = 0; k < band; k++)
                ctx.drawImage(img, 0, 0, 64, 64, Math.round(colCX - (band * 18) / 2 + k * 18 - 9), Math.round(PY + 64), 20, 20);
        }
    }
    if (hasTownIcon && !f) {   // the gold TOWN diamond, same mark as the world map + the memory portal
        const r = 13, tcx = colCX, tcy = PY + 46;
        ctx.fillStyle = '#e8c860'; ctx.beginPath();
        ctx.moveTo(tcx, tcy - r); ctx.lineTo(tcx + r, tcy); ctx.lineTo(tcx, tcy + r); ctx.lineTo(tcx - r, tcy); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#8a6b44'; ctx.lineWidth = 1.5; ctx.stroke();
        drawText(ctx, 'TOWN', Math.round(tcx - textWidth('TOWN') / 2), tcy - 2, '#3a2c10');
        const nm2 = (world.name || '').toUpperCase().slice(0, 10);
        if (nm2) drawText(ctx, nm2, Math.round(tcx - textWidth(nm2) / 2), tcy + r + 4, '#e8c860');
    }
    // #card-anim (owner, task #8) — the improved right-facing walk cycle at 80% of the old scale,
    // with the discovered object OVERLAPPING the walker's upper-right shoulder, frameless (no slot,
    // no stroke) — the find rides with the finder instead of sitting in a box below them.
    // #card-align (owner: "characters and text feel ill-aligned") — both columns centre on the same
    // vertical midline of the content band (between the header rule and the bottom border).
    const cTop = PY + 16, cBot = PY + PH - 5, cMid = Math.floor((cTop + cBot) / 2);
    let sprBox = null;
    if (f) {
        // #card-state — the pose tells the truth: downed farmers lay where they fell, the barely-saved
        // flash red (the brink threshold matches the field renderer's badly-wounded limp at 35% HP)
        const mode = f.downed ? 'downed' : ((f.maxHp && f.hp / f.maxHp < 0.35) ? 'brink' : 'walk');
        sprBox = drawShowcaseWalker(f, colCX, cMid, 1.6, 7, mode);
    }   // nominal ~54px body — feet ride below the midline
    if (hasObject) {
        if (sprBox) drawGem(e.icon.slice(5), Math.round(sprBox.x + sprBox.w - 1), Math.round(sprBox.y + 5), 5, e.tone);
        else drawGem(e.icon.slice(5), colCX, cMid, 7, e.tone);
    }

    // title (what happened) + the memory WHY — a right column beside the showcase, vertically centred
    const tx = hasLeft ? PX + 78 : PX + 10, tw = Math.floor((PX + PW - 10 - tx) / 4.2);
    const tLines = wrapText(e.text.toUpperCase(), tw).slice(0, 3);
    const wLines = e.why ? wrapText(e.why, tw).slice(0, 4) : [];
    const blockH = tLines.length * 8 + (wLines.length ? 2 + wLines.length * 7 : 0);
    let ty = Math.max(cTop + 1, Math.floor(cMid - blockH / 2) + 1);
    for (const ln of tLines) { drawText(ctx, ln, tx, ty, '#f4ead0'); ty += 8; }
    if (wLines.length) { ty += 2; for (const ln of wLines) { drawText(ctx, ln, tx, ty, '#9a86c0'); ty += 7; } }

    drawCardClose(PX + PW - 11, PY + 3);   // #card-close (owner, task #8): the X replaces "CLICK TO CONTINUE"
    ctx.restore();
}

// "PREVIOUSLY ON PROPAGATE" — the returning player's catch-up card (#88): the last few
// chronicle beats of the resumed town, held on screen until any click/key. This is also the
// story-emergence instrument: if this card is ever boring, the sim has told us something.
function drawMemoryIntro() {
    if (!memoryIntro || !booted) return;
    const mi = memoryIntro;
    const alpha = Math.min(1, (performance.now() - mi.shownAt) / 350);
    const PW = 232, PX = Math.floor((GW - PW) / 2);
    const VW = PW - 16, VH = Math.round(VW * 480 / 720);            // the webm's own 3:2
    const PH = 30 + VH + 58, PY = Math.floor((GH - PH) / 2) - 6;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(6,8,14,0.7)'; ctx.fillRect(0, 0, GW, GH);
    ctx.fillStyle = 'rgba(14,16,26,0.97)'; ctx.fillRect(PX, PY, PW, PH);
    ctx.fillStyle = '#c8a0e0'; ctx.fillRect(PX, PY, PW, 1); ctx.fillRect(PX, PY + PH - 1, PW, 1);   // the portal's violet
    drawText(ctx, 'YOUR WORLD NOW REMEMBERS ITSELF', PX + 6, PY + 6, '#d8b8ee', 1);
    drawText(ctx, 'X', PX + PW - 10, PY + 6, '#c8ccd8');
    mi.hits.close = { x: PX + PW - 14, y: PY + 2, w: 12, h: 11 };
    // the living memory graph: dark base -> POSTER floor (always, once decoded) -> live video on top
    const vx = PX + 8, vy = PY + 18;
    ctx.fillStyle = '#08060e'; ctx.fillRect(vx, vy, VW, VH);
    try { if (mi.poster && mi.poster.complete && mi.poster.naturalWidth) ctx.drawImage(mi.poster, vx, vy, VW, VH); } catch { /* poster not ready */ }
    try { if (mi.video && mi.video.readyState >= 2) ctx.drawImage(mi.video, vx, vy, VW, VH); } catch { /* VP9 undecodable — the poster stands */ }
    ctx.strokeStyle = 'rgba(200,160,224,0.5)'; ctx.strokeRect(vx + 0.5, vy + 0.5, VW - 1, VH - 1);
    let ty = vy + VH + 5;
    for (const ln of wrapText('EVERY LIFE IN YOUR TOWNS - NAMES, CREEDS, BONDS, BATTLES - IS NOW SET DOWN IN THIS BROWSER, AND HEIRS OF YOUR FALLEN MAY RETURN IN TOWNS TO COME.', 54)) {
        drawText(ctx, ln, PX + 8, ty, '#c8ccd8'); ty += 8;
    }
    // buttons: VIEW MEMORIES (portal) + SKIP — both with hover states (owner)
    const bY = PY + PH - 18;
    const vLabel = 'VIEW MEMORIES', cLabel = 'SKIP';
    const vw2 = textWidth(vLabel) + 10, cw2 = textWidth(cLabel) + 10;
    const vbx = PX + 8, cbx = PX + PW - 8 - cw2;
    mi.hits.view = { x: vbx, y: bY, w: vw2, h: 13 };
    mi.hits.cont = { x: cbx, y: bY, w: cw2, h: 13 };
    const vHov = inRect(mouse, mi.hits.view), cHov = inRect(mouse, mi.hits.cont);
    ctx.fillStyle = vHov ? '#2c2140' : '#1a1424'; ctx.fillRect(vbx, bY, vw2, 13);
    ctx.strokeStyle = vHov ? '#e8d0f8' : '#c8a0e0'; ctx.strokeRect(vbx + 0.5, bY + 0.5, vw2 - 1, 12);
    drawText(ctx, vLabel, vbx + 5, bY + 4, vHov ? '#f0e4fa' : '#d8b8ee');
    ctx.fillStyle = cHov ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.08)'; ctx.fillRect(cbx, bY, cw2, 13);
    if (cHov) { ctx.strokeStyle = '#8a8f9c'; ctx.strokeRect(cbx + 0.5, bY + 0.5, cw2 - 1, 12); }
    drawText(ctx, cLabel, cbx + 5, bY + 4, cHov ? '#f0f2f8' : '#c8ccd8');
    ctx.restore();
}

function drawResumeCard() {
    if (!resumeCard || !booted) return;
    if (memoryIntro) return;   // #memory-intro SEQUENTIAL, not stacked (owner): the recap waits its turn —
                               // its lazy shownAt keeps the fade unfired, so dismissal TRANSITIONS into it
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

    drawText(ctx, rc.title || `PREVIOUSLY ON ${(world.name || 'PROPAGATE').toUpperCase()}`, PX + 6, PY + 6, '#f0d060', 1);
    const sd = SEASONS[rc.season];
    const sub = `DAY ${rc.day} - ${sd ? sd.name : ''} OF YEAR ${rc.year}`;
    drawText(ctx, sub, PX + 6, PY + 15, '#9ad0e0');
    ctx.fillStyle = '#2a2e3a'; ctx.fillRect(PX + 4, PY + 23, PW - 8, 1);

    let y = PY + headH + 3;
    if (!lines.length) drawText(ctx, cultureWord(world.culture, 'boot.unwritten'), PX + 8, y, '#6a6f7c');
    else for (const ln of lines) { if (ln.head) { ctx.fillStyle = ln.c; ctx.fillRect(PX + 6, y + 2, 2, 2); } drawText(ctx, ln.t, PX + 11, y, ln.c); y += 8; }
    drawCardClose(PX + PW - 11, PY + 3);   // #card-close (owner, task #8): the X replaces the blinking cue
    ctx.restore();
}

// #faceoff — the fighting-game VS card raised the moment the warband LANDS and starts moving inward (the
// raidEvent's birth), BEFORE the clash: the town's defender bust squared off against the orc leading the raid,
// the aggressor's NAME centred between them, and the WAR CONTEXT (raid count + how the last one went — the
// memory read that used to live in the removed "WAR SO FAR" card). Reads the display-only world.raidEvent
// (never serialized, never in the digest) — no sim/determinism reach. One-shot per raid via the rid.
function maybeFaceoff() {
    const re = world && world.raidEvent;
    if (!re) return;                                         // no raid on the field
    if (re === faceoffSeenEvent) return;                     // already raised for THIS raidEvent (object identity —
    faceoffSeenEvent = re;                                   // robust for real AND booth-rehearsed raids alike)
    const e = re.e || {}, foe = e.foe;
    const name = (foe && foe.name) || e.foeName || 'an orc warband';
    let swornName = null;
    if (foe && foe.sworeAgainst != null) { const s = world.farmers.find(x => x.sheet.seed === foe.sworeAgainst); if (s) swornName = s.sheet.name.split(' ')[0]; }
    faceoff = { at: performance.now(), name: String(name).toUpperCase(),
                raidCount: (foe && foe.raidCount) | 0,
                escaped: !!(world.nemesis && world.nemesis.lastOutcome === 'escaped'), swornName,
                // #faceoff-info the encounter facts that fill the centre column (display-only, off the sim)
                raiders: (re.raiders && re.raiders.length) || 0,
                clan: e.by ? String(e.by).toUpperCase() : null,
                defenders: world.farmers.filter(x => !x.downed && x.health !== 'dead' && x.health !== 'sick').length };
    // #Codex41-P1 a raid landing MID-WHISPER must not have its dismissal keys eaten by the (now-obscured) chat
    // input — blur it so keydowns reach the window handler (which dismisses the card).
    blurChatInput();
}

const faceoffOrdinal = (n) => { const s = ['TH', 'ST', 'ND', 'RD'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };

// draw one illustrated bust. side=-1 sits it to the LEFT with its INNER (right) edge at anchorX; side=+1 to
// the RIGHT with its inner (left) edge at anchorX. `flip` mirrors it horizontally (an orc-town defender uses
// the orc art turned to face inward). xoff slides it during the entrance. Smoothing ON: these are detailed
// 1024px illustrations, so a nearest-neighbour 0.25x downscale would shimmer — the CRT pass re-pixelates anyway.
function drawFaceoffBust(img, ready, flip, anchorX, cy, h, side, xoff) {
    if (!ready || !img.naturalWidth) return;
    const w = h * (img.naturalWidth / img.naturalHeight);
    const x = (side < 0 ? anchorX - w : anchorX) + xoff;
    const y = Math.floor(cy - h / 2);
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    if (flip) { ctx.translate(Math.floor(x + w), y); ctx.scale(-1, 1); ctx.drawImage(img, 0, 0, Math.floor(w), Math.floor(h)); }
    else ctx.drawImage(img, Math.floor(x), y, Math.floor(w), Math.floor(h));
    ctx.restore();
}

// split ONE word into chunks that each fit `maxW` at `scale` (for a token too long for the column — #Codex41 P1)
function faceoffSplitWord(word, scale, maxW) {
    const out = []; let cur = '';
    for (const ch of String(word)) {
        if (cur && textWidth(cur + ch, scale) > maxW) { out.push(cur); cur = ch; }
        else cur += ch;
    }
    if (cur) out.push(cur);
    return out;
}

// wrap `str` into lines that each fit `maxW` at `scale` (greedy on spaces; a single word too wide for the
// column is HARD-SPLIT by measured width so it can never overrun the portraits — no lone over-long line)
function faceoffWrap(str, scale, maxW) {
    const words = String(str).split(' '), lines = [];
    let cur = '';
    for (const w of words) {
        if (textWidth(w, scale) > maxW) {                        // a single oversized token — flush, then hard-split it
            if (cur) { lines.push(cur); cur = ''; }
            for (const chunk of faceoffSplitWord(w, scale, maxW)) lines.push(chunk);
            continue;
        }
        const t = cur ? cur + ' ' + w : w;
        if (!cur || textWidth(t, scale) <= maxW) cur = t;
        else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    return lines;
}

// a HUD-style block nameplate for the faceoff header (like the top-bar town name): a SUBTLE fill colour (no
// outer stroke) with big centred text. Returns nothing; the caller lays plates out in a row.
function faceoffPlate(x, y, w, h, text, scale, textCol, fillCol) {
    ctx.fillStyle = fillCol; ctx.fillRect(x, y, w, h);
    const tw = textWidth(text, scale);
    drawText(ctx, text, Math.round(x + (w - tw) / 2), Math.round(y + (h - 5 * scale) / 2), textCol, scale);
}

function drawFaceoff() {
    if (!faceoff || !booted) return;
    const f = faceoff;
    const el = performance.now() - f.at;
    const HOLD = 10000, FADE = 600;                          // generous safety auto-continue; a click/key closes it sooner
    if (el > HOLD + FADE) { faceoff = null; return; }
    const inA = Math.min(1, el / 340);
    const outA = el > HOLD ? Math.max(0, 1 - (el - HOLD) / FADE) : 1;
    ctx.save();
    ctx.globalAlpha = inA * outA;
    ctx.fillStyle = 'rgba(5,6,10,0.94)'; ctx.fillRect(0, 0, GW, GH);   // near-opaque stage — the busts are the whole show

    const cx = Math.floor(GW / 2), cy = Math.floor(GH / 2);
    const slide = (1 - inA) * 42;                             // busts glide in from their own sides
    const gap = 58;                                           // clear centre column so text never runs onto the faces
    const banH = 16, banY = GH - banH;                        // the yellow bottom banner (drawn later, ON TOP of the busts)
    const orcTown = world.culture === 'orc';
    // DEFENDER (townsfolk, LEFT): a human town fields human-farmer; an orc town fields orc-raider (orc farmers look
    // the same). RAIDER (RIGHT): an orc-raider warband hits a human town; orc-raider-2 hits an orc town. All busts
    // face LEFT as authored, so the defender is FLIPPED to face right and the raider is drawn as-is (faces left).
    const defImg = orcTown ? orcPortraitImg : humanPortraitImg;
    const defReady = orcTown ? orcPortraitReady : humanPortraitReady;
    const raiderImg = orcTown ? orcRaider2Img : orcPortraitImg;
    const raiderReady = orcTown ? orcRaider2Ready : orcPortraitReady;

    // a soft dark column down the middle so the centre facts read cleanly over the two faces
    const grad = ctx.createLinearGradient(cx - 112, 0, cx + 112, 0);
    grad.addColorStop(0, 'rgba(6,7,12,0)'); grad.addColorStop(0.5, 'rgba(6,7,12,0.92)'); grad.addColorStop(1, 'rgba(6,7,12,0)');
    ctx.fillStyle = grad; ctx.fillRect(cx - 112, 0, 224, GH);

    // ===== TOP HEADER: [TOWN  VS.]  [ATTACKER] in HUD-style plates (subtle fill, no stroke), in the band above the
    // busts. Town + "VS." share ONE plate (yellow text); the raider gets its own red plate. Sized to always fit on
    // ONE line within a comfortable margin — the scale steps DOWN (never wraps/truncates).
    const town = (world.name || 'THE TOWN').toUpperCase();
    let atk = f.name;
    const left = `${town} VS.`;
    const padX = 6, padY = 4, hgap = 8;
    const rowW = (s) => (textWidth(left, s) + padX * 2) + hgap + (textWidth(atk, s) + padX * 2);
    let hs = 4; while (hs > 1 && rowW(hs) > GW - 24) hs--;    // biggest scale (≤4) that fits with a margin
    // #Codex-VS hard-fit at min scale: real names fit at ≥scale 3, but the demoFaceoff QA hook accepts arbitrary
    // strings — a huge one would overflow scale 1 and centre the row to a NEGATIVE x, clipping both plates. Trim
    // the attacker name (the variable part) with a terminal dot (the 3×5 font has no ellipsis glyph) so it fits.
    if (rowW(hs) > GW - 24) {
        const avail = (GW - 24) - (textWidth(left, hs) + padX * 2) - hgap - padX * 2;
        while (atk.length > 1 && textWidth(`${atk}.`, hs) > avail) atk = atk.slice(0, -1);
        atk += '.';
    }
    const plateH = 5 * hs + padY * 2, topY = 8;
    const leftW = textWidth(left, hs) + padX * 2, atkW = textWidth(atk, hs) + padX * 2;
    let hx = Math.round(cx - (leftW + hgap + atkW) / 2);
    faceoffPlate(hx, topY, leftW, plateH, left, hs, '#f4d868', 'rgba(22,38,20,0.82)'); hx += leftW + hgap;   // town + VS.: yellow text
    faceoffPlate(hx, topY, atkW, plateH, atk, hs, '#ffffff', 'rgba(184,40,32,0.92)');                        // raider: red fill, white letters

    // ===== CENTRE: the ENCOUNTER FACTS — clan · warband size · defenders · the war so far — fill the gap with
    // meaningful info, stacked + vertically centred. The FIRST line (the headline) is white; every following
    // detail line is the soft HUD grey (matching the weather label), so the eye lands on the headline first.
    const maxW = gap * 2 - 10;
    const lines = [];
    if (f.clan) lines.push(f.clan);
    if (f.raiders) lines.push(`${f.raiders} RAIDER${f.raiders === 1 ? '' : 'S'} STRONG`);
    if (f.defenders != null) lines.push(`${f.defenders} DEFENDER${f.defenders === 1 ? '' : 'S'} STAND`);
    if (f.raidCount >= 2) lines.push(`${faceoffOrdinal(f.raidCount)} RAID OF THE WAR`);
    if (f.escaped) lines.push('HE BROKE OFF LAST TIME');
    else if (f.swornName) lines.push(`HE SWORE AGAINST ${f.swornName}`);
    else if (f.raidCount < 2) lines.push('A WARBAND STRIKES');
    const rendered = [];
    lines.forEach((t, i) => { const c = i === 0 ? '#ffffff' : '#9aa0b4'; for (const w of faceoffWrap(t, 1, maxW)) rendered.push({ t: w, c }); });
    let sy = cy - Math.floor((rendered.length * 9) / 2);
    for (const r of rendered) { drawText(ctx, r.t, cx - Math.floor(textWidth(r.t, 1) / 2), sy, r.c, 1); sy += 9; }

    // ===== BUSTS ON TOP (top of the z-order) — near full-height, BOTTOM-anchored so they overflow under the banner
    // (which clips them → NO gap at the bottom) while the top rises into the header (the raider's hair over the text).
    // Drawn 10% OVER the canvas height: the faces were sitting too far below the title plate, because two of the
    // three portraits carry ~24% empty space above the head (human-farmer 317px of 1300, orc-raider 293px) — so a
    // full-height draw still lands the face low. The extra 10% pushes the heads up to meet the header.
    // bustCy is then derived from the BOTTOM rather than the centre, which is what the paragraph above always
    // claimed: the bottom edge stays 2px under the canvas, so the banner keeps clipping it and no chin, tusk or
    // beard is lost, and the whole overflow is spent upward into the header where that empty padding lives. Derived
    // rather than a magic offset so any future change to the 10% keeps the bottom bleed correct for free.
    const PHt = Math.round((GH - 4) * 1.10);
    const bustCy = (GH + 2) - Math.round(PHt / 2);
    drawFaceoffBust(defImg, defReady, true, cx - gap, bustCy, PHt, -1, -slide);          // defender, LEFT, FLIPPED → faces right/inward
    drawFaceoffBust(raiderImg, raiderReady, false, cx + gap, bustCy, PHt, +1, +slide);   // raider, RIGHT, faces left/inward

    // ===== full-width YELLOW banner along the bottom (the card's footer rule; the cue text is gone —
    // #card-close (owner, task #8): the X in the top corner is the door now)
    ctx.fillStyle = '#e8c650'; ctx.fillRect(0, banY, GW, banH);
    ctx.fillStyle = '#7a5e12'; ctx.fillRect(0, banY, GW, 1);                       // thin darker lip on top
    drawCardClose(GW - 14, 26);
    ctx.restore();
}

// Autosave (#88): the town writes itself to IndexedDB at every day rollover, plus whenever the
// tab hides/closes. Fire-and-forget — a failed write never touches the sim (save.js swallows).
function maybeAutosave() {
    if (!booted || !world || world._persistenceDisabled || world.day === lastSavedDay) return;   // never persists
    lastSavedDay = world.day;                       // claim synchronously so a slow write can't double-fire
    // #Codex24-1/#Codex25-1: register the world summary ONLY after a SUCCESSFUL save, and register an IMMUTABLE
    // summary captured SYNCHRONOUSLY with the save (same world state — the sim can't interleave between these two
    // synchronous calls), stamped with the COMMITTED rev afterward. This closes both a stale tab pushing
    // uncommitted state AND the callback re-reading a world that the sim mutated after the snapshot.
    const w = world, summary = townSummary(w);
    saveTown(w).then(d => { if (d != null) { saveFlashAt = performance.now(); summary.rev = w._rev; registerWorld(w, summary); } });
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
    // #134 the learning arc's TRUCE path: a town that resolved to sue for peace sends its envoy to the frontier
    // WILLING to talk (the world layer's willParley reads this), so the next cross-faction meeting parleys.
    if (envoy && w.learned === 'truce') envoy.suePeace = true;
    return {
        seed: w.seed, name: w.name, day: w.day, year: w.year, pop: w.farmers.length,
        harvestTotal: w.harvestTotal || 0, lineage: [...anc], motto, fingerprint: fp >>> 0,
        culture: w.culture || 'human', lineageRoot: w.lineageRoot || String(w.seed), envoy, lastSeen: Date.now(),   // #3.2
        doctrine: w.doctrine(),   // #doctrine (strategist v1) — the town's war/movement posture, read by detectEncounters
        rev: w._rev || 0,   // #Codex24-1: the committed save revision — the index rejects an upsert older than the stored summary
    };
}
let _worldBusy = false;
async function registerWorld(w, summary) {
    if (_worldBusy) return; _worldBusy = true;
    try {
        // Codex r20 P1: register THIS town + detect encounters + read its inbox in ONE atomic transaction, so a
        // second tab can't clobber the ledger/inbox. The mutator is synchronous (no awaits inside a live txn).
        // #Codex25-1: `summary` is captured by the caller SYNCHRONOUSLY with the save (same world state) and
        // stamped with the COMMITTED rev — so we never publish a summary built from state newer than what was
        // actually persisted. Fall back to a live read only for direct callers that don't pass one.
        // Codex #60-2 — the captured summary is REQUIRED. The fallback was unsafe in a way the fence cannot
        // catch: the world advances in memory after its last save WITHOUT `_rev` changing, so townSummary(w)
        // could describe newer, unpersisted doctrine/day/envoy state while carrying the still-current stored
        // revision — and an exact-pair fence accepts it, because the pair is genuinely current. Every caller
        // already captures synchronously with saveTown and stamps the committed rev.
        if (!summary) { console.error('ry-farms: registerWorld requires the summary captured with the save — refusing'); return; }
        const s = summary;
        let fresh = [], mine = [];
        // Codex #58/#59 — FENCED on the full slot pair. Everything this mutator writes is derived from `w`:
        // its summary, the encounters resolved from that summary, its inbox. A superseded occupant publishing
        // any of it is how a dead town kept a ghost entry on the world map — and generation alone was not
        // enough, because a DELAYED publication of rev N could still land after the snapshot reached N+1 and
        // let detectEncounters resolve raids from stale doctrine. `s.rev` is the COMMITTED rev the caller
        // stamped synchronously with the save, which is exactly the snapshot this summary describes.
        const fence = { seed: w.seed, gen: w._gen || 0, rev: s.rev || 0 };
        const idx = await updateWorldIndex(index => {
            index.towns = index.towns || {}; index.encounters = index.encounters || []; index.ledgers = index.ledgers || {};
            const prev = index.towns[s.seed] || {};
            // #Codex24-1: never let an OLDER revision regress the shared summary (belt-and-suspenders with the
            // save-success gate in maybeAutosave). A stale upsert only refreshes liveness; the newest tab's
            // day/harvest/envoy/doctrine — the fields reach detection reads — always win.
            if (prev.rev != null && (s.rev || 0) < prev.rev) index.towns[s.seed] = { ...prev, lastSeen: s.lastSeen };
            else index.towns[s.seed] = { ...prev, ...s, firstSeen: prev.firstSeen || s.lastSeen || Date.now() };
            fresh = detectEncounters(index);                 // resolves raids/parleys, queues inbox
            mine = (index.inbox && index.inbox[String(w.seed)]) || [];
            return index;
        }, fence);
        if (!idx) return;                                // fenced or failed — nothing was published
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
    // Codex #61-3 — the policy lives HERE, at the mutation boundary, not at each call site. Consuming means
    // ACKNOWLEDGING events, and a session that cannot persist must not claim them. Placed before applyInbox
    // so a future caller cannot apply the effects locally and only discover the refusal when saveTown declines.
    // Note this is about the DESTINATION world, not the caller: switchTown passes a freshly observed,
    // persistence-enabled town and should consume normally.
    if (w._persistenceDisabled) return;
    w.applyInbox(events);                          // idempotent: re-delivered events are skipped by applied-id
    // #Codex30/#Codex31 P1 — applyInbox may have changed this town's DOCTRINE/ENVOY (a raid it LEARNED from: #134
    // defence -> palisade, or truce -> envoy.suePeace); republish its summary so another tab can't resolve an
    // encounter against the stale pre-raid posture. Capture the summary NOW, SYNCHRONOUSLY with saveTown's own
    // serialize (both run before the first await), so it reflects exactly the saved snapshot — NOT newer state the
    // sim advanced into while saveTown awaited IndexedDB. The committed rev is stamped after the save succeeds.
    const summary = townSummary(w);
    const saved = await saveTown(w);               // persist applied effects + applied-ids BEFORE clearing
    if (saved == null) return;                     // save failed -> do NOT clear; the inbox replays next time
    summary.rev = w._rev;                          // stamp the COMMITTED rev (as maybeAutosave does)
    // clear everything we processed — EXCEPT a traveler still en route (arrivalDay in the future): it must
    // linger in the inbox until the sim reaches its day, when Slice C consumes it. (applyInbox leaves it too.)
    const done = new Set(events.filter(e => !(e.kind === 'traveler' && (e.day || 0) > w.day)).map(inboxEventId));
    // Codex #58 — fenced for the same reason: the ids being cleared and the summary being republished are both
    // derived from this occupant. A superseded one must not acknowledge events on the live town's behalf.
    await updateWorldIndex(index => {              // remove ONLY the ids we processed, keeping concurrent appends
        const box = index.inbox && index.inbox[String(w.seed)];
        if (box) index.inbox[String(w.seed)] = box.filter(e => !done.has(inboxEventId(e)));
        // rev-guarded summary refresh (same guard as registerWorld — never regress a newer tab's summary)
        index.towns = index.towns || {};
        const prev = index.towns[summary.seed] || {};
        if (!(prev.rev != null && (summary.rev || 0) < prev.rev)) index.towns[summary.seed] = { ...prev, ...summary, firstSeen: prev.firstSeen || summary.lastSeen || Date.now() };
        return index;
    }, { seed: w.seed, gen: w._gen || 0, rev: summary.rev || 0 });   // #59 full pair; summary.rev is the committed rev
}

// reset every per-town lens in this module (anything keyed to a town being swapped out) — shared by the
// border crossing and the rehearsal rewind (#Codex67-1), so the two swap paths cannot drift
function resetTownLenses() {
    if (window.RYFARMS) window.RYFARMS.world = world;   // the debug handle tracks every swap, not just crossings
    selected = null; selectedSlotKey = null; followMode = false; followTarget = null;
    raidFocus = null; dramaSpotlight = null; _lastRaidEvent = null; _raidStruck = false; _raidDetected = false; raidFx = null; raidShake = 0;
    faceoff = null; faceoffSeenEvent = null;
    _battleWatch = null; pendingInscription = null; simAccumulator = 0;   // #Codex36 P1-1: no cross-town battle finalization, fresh sim clock
    chatFarmer = null; chatWidgetOpen = false; chatDropdownOpen = false; blurChatInput();
    momentQueue.length = 0; calloutQueue.length = 0; activeMoment = null; activeCallout = null; momentsPrimed = false;
    chronReadTotal = world._chronTotal || 0; lastChronLen = -1; recapSeq = -1;
    sawCongregating = null;   // #firstwatch re-observe the new town before edge-detecting
    miniKey = null; chunkCanvases.clear();
    worldMapSel = world.seed;
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

// #Codex67-1 THE REWIND. A rehearsal's actors are the real farmers — they really walked, explored, burned
// timers. serialize() already refuses to persist any of that (it returns the pre-curtain snapshot while a
// show is live); this makes the world itself agree the moment the show ends: rebuild from the snapshot,
// exactly the way a border crossing installs a neighbour. The admin sees the town snap back to the instant
// before the curtain — which is the promise "GHOST RUNS, NOTHING RECORDED" made all along.
function rewindFromRehearsal() {
    const snap = world && world._rehearsalSnapshot;
    if (!snap) return;
    let next;
    try { next = World.fromSave(structuredClone(snap)); }   // structured clone, same semantics as IndexedDB — the snapshot carries Maps/Sets
    catch (err) { console.error('ry-farms: rehearsal rewind failed - keeping live state', err); world._rehearsalSnapshot = null; return; }
    next._gen = world._gen; next._rev = world._rev;
    next._spectator = world._spectator; next._persistenceDisabled = world._persistenceDisabled; next._retired = world._retired;
    const origSet = next.set.bind(next);
    next.set = (i, j, t) => { origSet(i, j, t); next._tilesChanged = true; };
    next._tilesChanged = true;
    next._live = world._live; next._tabHidden = document.hidden;
    world = next;
    lastSavedDay = world.day;
    resetTownLenses();
}

function gamePoint(e) {
    const rect = out.getBoundingClientRect();
    return crt.screenToGame(e.clientX - rect.left, e.clientY - rect.top);
}

out.addEventListener('pointerdown', (e) => {
    if (activePointerId !== null && e.pointerId !== activePointerId) return;   // #Codex67-3 second finger: ignored
    activePointerId = e.pointerId;
    audio.ensure();   // browsers only allow audio to start on a user gesture
    const p = gamePoint(e);
    mouse.noCursor = false;   // Codex #69-3 a fresh press re-engages the cursor (next tap may re-pin)
    mouse.downX = p.x; mouse.downY = p.y;
    if (startScreen) { mouse.panStart = null; return; }   // #START the menu owns the canvas — never pan the town behind it
    // #memory-intro (Codex #94 P2) — the reveal owns the PRESS too: without this, pointerdown reached
    // the hidden layers (a Moment's click-eater, the update-reload pill, a settings slider grab, the
    // world-pan arming) and a >4px drag made pointerup return before the reveal's own dismiss.
    if (memoryIntro) { mouse.panStart = null; mouse.dragging = false; return; }
    // #98 a grand Moment spotlight eats the next click (dismiss it, don't fall through to world/pan)
    if (activeMoment && MOMENTS_HIT.w) { activeMoment = null; mouse.panStart = null; return; }
    // #callout the X on a discovery toast dismisses it (only the X — clicking the bar itself falls through)
    if (activeCallout && CALLOUT_CLOSE.w && inRect(p, CALLOUT_CLOSE)) { activeCallout = null; mouse.panStart = null; return; }
    // #update-nudge — click the pill: save first, then reload into the new build (reload proceeds even if
    // the save path rejects — the tab-hide handler is the second net, and a retired town has nothing to save)
    if (UPDATE_NUDGE.w && inRect(p, UPDATE_NUDGE) && !_updateReloading) {
        _updateReloading = true;
        const go = () => location.reload();
        if (world && !world._retired && !world._persistenceDisabled) saveTown(world).then(go, go);
        else go();
        mouse.panStart = null; return;
    }
    // settings volume sliders: press to grab, drag to set
    if (settingsOpen && settingsHits) {
        if (inRect(p, settingsHits.musicSlider)) { settingsDrag = 'music'; audio.setMusicVolume((p.x - settingsHits.musicSlider.x) / settingsHits.musicSlider.w); mouse.panStart = null; return; }
        if (inRect(p, settingsHits.sfxSlider)) { settingsDrag = 'sfx'; audio.setSfxVolume((p.x - settingsHits.sfxSlider.x) / settingsHits.sfxSlider.w); mouse.panStart = null; return; }
    }
    // don't world-pan when the gesture starts on the minimap, the detail card, the board, or the whisper widget
    const onChat = (CHAT_BTN.w && inRect(p, CHAT_BTN)) || (CHAT_PANEL.w && inRect(p, CHAT_PANEL));
    const onUI = !rosterOpen && !chronOpen && (inRect(p, MINIMAP) || (selected && inRect(p, SHEET_RECT)) || (boardOpen && inRect(p, BOARD_RECT)) || onChat);
    mouse.panStart = (rosterOpen || chronOpen || settingsOpen || worldMapOpen || onUI) ? null : { x: p.x, y: p.y, camX: cam.x, camY: cam.y };   // #Codex35-3: the world map is a full-screen modal too — a drag on its picker must not pan the hidden town camera
    mouse.dragging = false;
    // #touch a finger has no prior hover position — seed it, so the frame's hover logic sees the held point;
    // then arm the long-press (world gestures only: panStart is null when the press began on a panel)
    if (e.pointerType === 'touch') {
        mouse.x = p.x; mouse.y = p.y;
        clearTimeout(touchHoldTimer); touchHoldActive = false;
        if (mouse.panStart) touchHoldTimer = setTimeout(() => { touchHoldActive = true; }, TOUCH_HOLD_MS);
    }
    try { out.setPointerCapture(e.pointerId); } catch { /* stale/synthetic pointer id — capture is best-effort */ }
});

out.addEventListener('pointermove', (e) => {
    if (activePointerId !== null && e.pointerId !== activePointerId) return;   // #Codex67-3 (hover: null -> flows)
    const p = gamePoint(e);
    mouse.x = p.x; mouse.y = p.y;
    mouse.noCursor = false;   // Codex #69-3 a live pointer always shows the hand again
    if (settingsDrag && settingsHits) {
        const s = settingsDrag === 'music' ? settingsHits.musicSlider : settingsHits.sfxSlider;
        if (s) { const v = (p.x - s.x) / s.w; settingsDrag === 'music' ? audio.setMusicVolume(v) : audio.setSfxVolume(v); }
        return;
    }
    if (mouse.panStart) {
        const dx = p.x - mouse.panStart.x, dy = p.y - mouse.panStart.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) { mouse.dragging = true; followMode = false; followTarget = null; raidFocus = null; clearTimeout(touchHoldTimer); touchHoldActive = false; }   // panning breaks follow (incl. the raid lock) and cancels a pending long-press
        if (mouse.dragging) {
            cam.x = mouse.panStart.camX + dx;
            cam.y = mouse.panStart.camY + dy;
        }
    }
});

function inRect(p, r) { return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h; }

out.addEventListener('pointerup', (e) => {
    if (activePointerId !== null && e.pointerId !== activePointerId) return;   // #Codex67-3
    activePointerId = null;
    const wasDrag = mouse.dragging;
    const wasSlider = settingsDrag;
    const wasHold = touchHoldActive;   // #touch captured before reset — the late cleanup listener parks the pointer
    clearTimeout(touchHoldTimer); touchHoldActive = false;
    settingsDrag = null;
    mouse.panStart = null;
    mouse.dragging = false;
    if (wasSlider) return;   // finished dragging a volume slider — consume the release
    if (wasDrag || !booted) return;
    if (wasHold) return;     // #touch a long-press was an INSPECT (name shown while held), not a click
    const p = gamePoint(e);

    // #START the launch menu owns every click while it's up: a button acts, anything else is swallowed
    if (startScreen) {
        const H = startHits || {};
        if (H.sound && inRect(p, H.sound)) { menuMuted = !menuMuted; audio.ensure(); audio.setMuted(menuMuted); disarmImport(); return; }   // #START universal mute; UNCONDITIONAL disarm — a selection still reading (f.text/occupancy) must not arm after this click (Codex #122 r2)
        if (startPage === 'title') {
            if (H.importFile && inRect(p, H.importFile)) {
                if (pendingImport) { saveportRunImport(); } else { saveportOpenChooser(); }
                return;
            }
            // any OTHER title click disarms UNCONDITIONALLY (Codex #122 r2): pendingImport is null
            // while f.text() and the occupancy reads are still in flight, so a conditional disarm
            // left importPickGen unchanged and the stale selection armed AFTER the click.
            disarmImport();
            if (H.continue && inRect(p, H.continue)) { location.search = '?play=1'; return; }   // #continue resume the latest town via the tested boot path
            if (H.start && inRect(p, H.start)) { startPage = 'choose'; return; }     // → the choose screen
            if (H.view && inRect(p, H.view)) { startScreen = false; audio.ensure(); audio.setMenuMode(false); audio.setMuted(false); return; }   // dismiss → spectate the town behind (this click is a gesture: unlock the audio ctx + lift the menu mute so game audio — chops, music — plays)
        } else {
            if (H.human && inRect(p, H.human)) { location.search = '?fresh=1'; return; }
            if (H.orc && inRect(p, H.orc)) { location.search = '?fresh=1&orc=1'; return; }
            if (H.view && inRect(p, H.view)) { startScreen = false; audio.ensure(); audio.setMenuMode(false); audio.setMuted(false); return; }   // dismiss → spectate the town behind (this click is a gesture: unlock the audio ctx + lift the menu mute so game audio — chops, music — plays)
            if (H.back && inRect(p, H.back)) { startPage = 'title'; return; }         // ‹ back to the title screen
        }
        return;
    }

    // the "previously on" catch-up card swallows the first click (any click dismisses it)
    if (memoryIntro) {   // #memory-intro the reveal owns the click; the resume card stays for the NEXT click
        const mh = memoryIntro.hits || {};
        if (mh.view && inRect(p, mh.view)) { window.open('/memory-graph.html', '_blank', 'noopener'); dismissMemoryIntro(); return; }
        if ((mh.cont && inRect(p, mh.cont)) || (mh.close && inRect(p, mh.close))) { dismissMemoryIntro(); return; }
        dismissMemoryIntro(); return;   // click anywhere dismisses, like the cards
    }
    if (resumeCard) { resumeCard = null; return; }
    // #faceoff the post-raid VS card swallows a click too (dismiss and return to the aftermath)
    if (faceoff) { faceoff = null; return; }

    // #legibility Slice 2 — the WHISPER widget (bottom-left): open from the minimized button, and while open
    // handle its own chat interactions (minimize, [NAME v] picker, input focus) so it works off the roster.
    // Opening the widget IS the intent to type (owner) — hand over the caret immediately, same
    // focus call the entry-row click makes, so no second tap is ever needed.
    if (CHAT_BTN.w && inRect(p, CHAT_BTN)) { chatWidgetOpen = true; audio.ensure(); focusChatInput(); return; }
    if (chatWidgetOpen && CHAT_PANEL.w && inRect(p, CHAT_PANEL)) {
        if (CHAT_CLOSE.w && inRect(p, CHAT_CLOSE)) { chatWidgetOpen = false; chatDropdownOpen = false; blurChatInput(); return; }
        if (chatDropdownOpen) {
            for (const row of chatDropRows) if (p.y >= row.y0 && p.y <= row.y1 && p.x >= row.x0 && p.x <= row.x1) { chatFarmer = row.farmer; chatScroll = 0; chatDropdownOpen = false; return; }
            chatDropdownOpen = false; return;
        }
        if (chatNameHit && p.x >= chatNameHit.x0 && p.x <= chatNameHit.x1 && p.y >= chatNameHit.y0 && p.y <= chatNameHit.y1) { chatDropdownOpen = !chatDropdownOpen; return; }
        if (chatEntryRect && p.x >= chatEntryRect.x0 && p.x <= chatEntryRect.x1 && p.y >= chatEntryRect.y0 && p.y <= chatEntryRect.y1) { focusChatInput(); return; }
        blurChatInput(); return;   // a click elsewhere in the widget is consumed (never falls through to world)
    }

    // sound quick-mute (stays on the top bar)
    if (inRect(p, SND_BTN)) { audio.ensure(); audio.toggle(); return; }
    // settings cog: open/close the menu (New Town + volume)
    if (SETTINGS_BTN.w && inRect(p, SETTINGS_BTN)) { audio.ensure(); settingsOpen = !settingsOpen; disarmImport(); if (settingsOpen) { rosterOpen = chronOpen = boardOpen = false; blurChatInput(); localLifeCount().then(n => { localMemoryCount = n; }).catch(() => {}); } return; }
    // settings menu interactions
    if (settingsOpen && settingsHits) {
        if (inRect(p, settingsHits.close)) { settingsOpen = false; disarmImport(); return; }
        if (inRect(p, settingsHits.music)) { audio.ensure(); audio.toggleMusic(); return; }
        if (inRect(p, settingsHits.sfx)) { audio.ensure(); audio.toggleSfx(); return; }
        if (inRect(p, settingsHits.musicSlider)) { audio.setMusicVolume((p.x - settingsHits.musicSlider.x) / settingsHits.musicSlider.w); return; }
        if (inRect(p, settingsHits.sfxSlider)) { audio.setSfxVolume((p.x - settingsHits.sfxSlider.x) / settingsHits.sfxSlider.w); return; }
        if (inRect(p, settingsHits.portalBtn)) { window.open('/memory-graph.html', '_blank', 'noopener'); return; }
        // #saveport — EXPORT: the current world, as a downloadable tagged-JSON file
        if (settingsHits.exportBtn && inRect(p, settingsHits.exportBtn)) {
            saveportNote = { text: 'PACKING THE TOWN FILE...', until: performance.now() + 10000 };
            buildTownExport(world).then((file) => {
                if (!file) { saveportNote = { text: 'THIS SESSION IS NOT SAVING - NOTHING TO EXPORT', until: performance.now() + 4000 }; return; }
                const stamp = `${String(file.town || 'town').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'town'}-day${file.day}`;
                const blob = new Blob([JSON.stringify(file)], { type: 'application/json' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `propagate-${stamp}.json`;
                a.click();
                setTimeout(() => URL.revokeObjectURL(a.href), 5000);
                saveportNote = { text: 'DOWNLOADED - MEMORIES REGROW ON IMPORT, BATTLE TALES STAY', until: performance.now() + 6000 };
            }).catch(() => { saveportNote = { text: 'EXPORT FAILED', until: performance.now() + 5000 }; });
            return;
        }
        // #saveport — IMPORT: pick a file, then a SECOND click confirms. The confirm beat is armed by
        // the file parse below; this branch is both the picker and the confirm depending on state.
        if (settingsHits.importBtn && inRect(p, settingsHits.importBtn)) {
            if (pendingImport) { saveportRunImport(); return; }
            saveportOpenChooser();
            return;
        }
        // #postcard — SHARE: copy the postcard line + link. world.culture, not _bootIsOrc (a resumed
        // orc town's URL drops ?orc, and the LINK must carry it or the recipient founds a human town
        // on the same seed). Clipboard API first; the execCommand textarea is the no-permission
        // fallback (we are inside the user gesture here, which is all execCommand needs).
        if (settingsHits.shareBtn && inRect(p, settingsHits.shareBtn)) {
            const card = buildPostcard({ seed: world.seed, name: world.name, day: world.day, year: world.year, culture: world.culture, origin: location.origin });
            const copied = () => {
                saveportNote = { text: 'POSTCARD COPIED - PASTE IT TO A FRIEND', until: performance.now() + 6000 };
                track('postcard_copied', { seed: world.seed });
            };
            const legacyCopy = () => {
                try {
                    const ta = document.createElement('textarea');
                    ta.value = card.text; ta.style.position = 'fixed'; ta.style.opacity = '0';
                    document.body.appendChild(ta); ta.select();
                    const ok = document.execCommand('copy');
                    ta.remove();
                    if (ok) copied(); else throw new Error('execCommand refused');
                } catch { saveportNote = { text: 'COULD NOT COPY THE LINK IN THIS BROWSER', until: performance.now() + 6000 }; }
            };
            if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(card.text).then(copied).catch(legacyCopy);
            else legacyCopy();
            return;
        }
        // #credits — the CraftPix attribution link
        if (settingsHits.craftpix && inRect(p, settingsHits.craftpix)) {
            window.open('https://craftpix.net/freebies/free-swordsman-1-3-level-pixel-top-down-sprite-character-pack/', '_blank', 'noopener');
            return;
        }
        // #admin the director's booth: stage/cancel a ghost rehearsal (raid / the vote). The wall-clock nonce
        // is the rehearsal's ONLY randomness (farm.js keys pure hashes off it — the sim's rng is never touched).
        if (settingsHits.admRaid && inRect(p, settingsHits.admRaid)) {
            if (world.rehearsal && world.rehearsal.kind === 'raid') world.cancelRehearsal();
            // #Codex38 P2-5: only close on success; a refusal (a real raid is under way) keeps the panel
            // open with a reason instead of closing as though the rehearsal staged.
            else if (world.startRaidRehearsal((performance.now() * 31) >>> 0 || 1, adminFoeName())) settingsOpen = false;
            else adminNote = { text: 'A REAL RAID IS UNDER WAY - REHEARSAL HELD', until: performance.now() + 3000 };
            return;
        }
        if (settingsHits.admVote && inRect(p, settingsHits.admVote)) {
            if (world.rehearsal && world.rehearsal.kind === 'election') world.cancelRehearsal();
            else if (world.startElectionRehearsal((performance.now() * 31) >>> 0 || 1)) settingsOpen = false;
            return;
        }
        if (settingsHits.admSortie && inRect(p, settingsHits.admSortie)) {   // #counteroffensive
            if (world.rehearsal && world.rehearsal.kind === 'sortie') world.cancelRehearsal();
            else if (world.startSortieRehearsal((performance.now() * 31) >>> 0 || 1)) settingsOpen = false;
            else adminNote = { text: 'A REAL RAID IS UNDER WAY - WAR PARTY HELD', until: performance.now() + 3000 };
            return;
        }
        if (!inRect(p, settingsHits.panel)) { settingsOpen = false; disarmImport(); return; }   // click outside closes
        return;   // click inside the panel, no-op
    }
    if (inRect(p, ROSTER_BTN)) { rosterOpen = !rosterOpen; if (rosterOpen) { boardOpen = false; chronOpen = false; closeWorldMap(); } else { chatDropdownOpen = false; blurChatInput(); } return; }
    if (CHRON_BTN.w && inRect(p, CHRON_BTN)) { chronOpen = !chronOpen; if (chronOpen) { boardOpen = false; rosterOpen = false; closeWorldMap(); chronScroll = 0; blurChatInput(); chronTownWide = !(followMode && followTarget && world.farmers.includes(followTarget)); } return; }
    if (WORLD_BTN.w && inRect(p, WORLD_BTN)) { if (worldMapOpen) closeWorldMap(); else openWorldMap(); return; }

    // world-map overlay (modal): X / click-outside closes; a town node selects it; VISIT switches active town
    if (worldMapOpen) {
        const PW = Math.min(GW - 12, 380), PH = GH - 40, PX = Math.floor((GW - PW) / 2), PY = 22;
        const U = worldMapUiHits || {};
        // FOUND overlay (drawn on top) — handle its buttons first, then X / click-outside closes it
        if (worldMapFoundOpen) {
            if (U.foundHuman && inRect(p, U.foundHuman)) { foundNewTown('human'); return; }
            if (U.foundOrc && inRect(p, U.foundOrc)) { foundNewTown('orc'); return; }
            if (U.foundClose && ((p.x > U.foundClose.x + U.foundClose.w - 12 && p.y < U.foundClose.y + 12) || !inRect(p, U.foundClose))) { worldMapFoundOpen = false; }
            return;
        }
        // KEY overlay — X / click-outside closes it
        if (worldMapKeyOpen) {
            if (U.keyClose && ((p.x > U.keyClose.x + U.keyClose.w - 12 && p.y < U.keyClose.y + 12) || !inRect(p, U.keyClose))) { worldMapKeyOpen = false; }
            return;
        }
        // header chips
        if (U.key && inRect(p, U.key)) { worldMapKeyOpen = true; worldMapFoundOpen = false; return; }
        if (U.found && inRect(p, U.found)) { worldMapFoundOpen = true; worldMapKeyOpen = false; return; }
        if ((p.x > PX + PW - 14 && p.y < PY + 12) || p.x < PX || p.x > PX + PW || p.y < PY || p.y > PY + PH) { closeWorldMap(); return; }
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
            // close ONLY on the top-right X or a click OUTSIDE the whole modal — test the FULL panel rect
            // (chronPanel), not the scroll body (chronView), whose top sits BELOW the title/tabs. Using the body
            // rect made a click on the title bar (above the body, e.g. "TALES OF THE WILDS") read as "outside".
            const cp = chronPanel || cv;
            if ((p.x > cp.x + cp.w - 14 && p.y < cp.y + 14) ||
                p.x < cp.x || p.x > cp.x + cp.w || p.y < cp.y || p.y > cp.y + cp.h) { chronOpen = false; return; }
            for (const row of chronRows) {
                if (p.y >= row.y0 && p.y <= row.y1 && p.x > cv.x && p.x < cv.x + cv.w) {
                    const f = row.farmerSeed != null ? world.farmers.find(x => x.sheet.seed === row.farmerSeed) : null;
                    // "CLICK A BEAT TO FOLLOW THAT RY": narrow the saga to them AND trail them in the world, so
                    // the camera moves, the FOLLOWING banner shows once the chronicle closes, and ←/→ (which only
                    // move the camera while followMode is on) cycle both the sheet and the camera together.
                    if (f) { selected = f; followMode = true; followTarget = f; chronTownWide = false; sheetScroll = 0; chronScroll = 0; funnelFollow(); }
                    return;
                }
            }
        }
        return;
    }

    // board toggle button (only when the board has been built)
    if (!BOARD_BTN.hidden && inRect(p, BOARD_BTN)) { boardOpen = !boardOpen; if (boardOpen) { selected = null; rosterOpen = false; chronOpen = false; closeWorldMap(); boardScroll = 0; } return; }

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
        if (rv) {
            // close X / click well outside the panel
            if ((p.x > rv.x + rv.w - 14 && p.y < rv.y + 12) ||
                p.x < rv.x || p.x > rv.x + rv.w || p.y < rv.y || p.y > rv.y + rv.h) { rosterOpen = false; return; }
            // tab chips: PLAYER STATS / ROLES
            if (rosterTabHits) { for (const t of rosterTabHits) if (inRect(p, t)) { rosterTab = t.tab; rosterScroll = 0; return; } }
            // list rows: open that farmer's detail sheet AND follow them (roster select + follow are one action)
            for (const row of rosterRows) {
                if (p.y >= row.y0 && p.y <= row.y1 && p.x > rv.x && p.x < rv.x + rv.w) {
                    selected = row.farmer; sheetScroll = 0; sheetTab = 0; rosterOpen = false;
                    followMode = true; followTarget = row.farmer; funnelFollow();
                    return;
                }
            }
        }
        return;
    }

    // detail card: X closes it; clicks anywhere inside it are consumed. Checked BEFORE the
    // minimap because the full-height card is drawn OVER it (Codex: don't click through).
    if (selected && inRect(p, SHEET_FOLLOW)) {
        if (followMode && followTarget === selected) { followMode = false; followTarget = null; }
        else { followMode = true; followTarget = selected; funnelFollow(); }
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

    // FOLLOWING-banner ◄/► — cycle the trailed farmer; the camera AND the open sheet move together.
    if (followMode && FOLLOW_PREV.w && (inRect(p, FOLLOW_PREV) || inRect(p, FOLLOW_NEXT))) {
        const dir = inRect(p, FOLLOW_NEXT) ? 1 : -1, arr = world.farmers, idx = arr.indexOf(followTarget);
        if (idx >= 0) { const next = arr[(idx + dir + arr.length) % arr.length]; followTarget = next; if (selected) { selected = next; sheetScroll = 0; selectedSlotKey = null; } }
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
    // #vote-panel (owner) — while the vote window holds, clicking farmers is NEUTRALIZED so the detail
    // card can't cover the live tally (hover names still work; every top-bar surface stays clickable).
    if (voteWindowActive()) return;
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
// #touch runs AFTER the main pointerup (registration order): once a finger lifts there is no cursor, so
// park the pointer offscreen — otherwise the last touch point keeps a phantom hover tooltip and the pixel
// hand painted on screen. Mouse users are untouched (their position keeps flowing from pointermove).
out.addEventListener('pointerup', (e) => {
    // #Codex67-3 activePointerId === null here means the OWNER just released (the main handler, which runs
    // first, cleared it). An ignored second finger's release leaves the owner's id in place — parking then
    // would yank the held tooltip out from under the finger that still owns the gesture.
    if (e.pointerType !== 'touch' || activePointerId !== null) return;
    // #tap-to-pin — a tap INSIDE the open detail card keeps the hover seeded at the tap point, so its
    // hover-only affordances (inventory/tool slot tooltips, crafting ingredient names) show on tap for
    // touch players. World taps still park offscreen — the phantom-tooltip/painted-cursor fix stands.
    // Codex #69-3: the pin keeps POSITION only — noCursor suppresses the painted hand until a real
    // pointer moves again (there is no finger on the glass; a hand there is a phantom).
    const p = gamePoint(e);
    if (selected && inRect(p, SHEET_RECT)) { mouse.noCursor = true; return; }
    mouse.x = -1; mouse.y = -1;
});
// #touch pointercancel was previously UNHANDLED: the browser stealing a gesture (system edge swipe,
// notification pull) would strand panStart mid-drag and the next finger would teleport the camera.
out.addEventListener('pointercancel', (e) => {
    if (activePointerId !== null && e.pointerId !== activePointerId) return;   // #Codex67-3
    activePointerId = null;
    clearTimeout(touchHoldTimer); touchHoldActive = false;
    settingsDrag = null; mouse.panStart = null; mouse.dragging = false;
    if (e.pointerType === 'touch') { mouse.x = -1; mouse.y = -1; }
});

out.addEventListener('wheel', (e) => {
    // the standalone whisper widget scrolls its transcript — previously only the roster-embedded chat did,
    // so the widget's history was unreachable once it overflowed
    if (chatWidgetOpen && chatViewport && inRect(mouse, { x: chatViewport.x, y: chatViewport.y, w: chatViewport.w, h: chatViewport.h })) {
        e.preventDefault();
        chatScroll -= e.deltaY * 0.5;   // wheel up = back in time; clamped in the draw
        return;
    }
    if (rosterOpen) {
        e.preventDefault();
        // scroll the chat history when the pointer is over its viewport, else the roster list
        const cv = chatViewport;
        if (cv && mouse.y >= cv.bodyTop && mouse.y <= cv.y + cv.h) chatScroll -= e.deltaY * 0.5;
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
    // [emblem] label [W] — the emblem says WHAT the beat is at a glance (distinct per kind), the keycap says how to
    // jump to it. Layout: 9px emblem + gap, the label, a gap, a small bordered W keycap.
    const txt = dramaSpotlight.label, tw = textWidth(txt);
    const EMB = 10, KEY = 9, boxW = EMB + tw + 3 + KEY;
    const lx = Math.max(4, Math.min(GW - boxW - 4, ax - Math.cos(ang) * 10 - boxW / 2));
    const ly = Math.max(26, Math.min(GH - 11, ay - Math.sin(ang) * 10 - 4));
    const bx = Math.round(lx), by = Math.round(ly);
    ctx.fillStyle = 'rgba(16,14,10,0.82)'; ctx.fillRect(bx - 2, by - 2, boxW + 3, 10);
    drawCueEmblem(dramaSpotlight.kind, bx, by - 1);
    drawText(ctx, txt, bx + EMB, by, '#f0d060');
    // the W keycap (a hairline box so it reads as a KEY, not a letter in the phrase)
    const kx = bx + EMB + tw + 3;
    ctx.fillStyle = 'rgba(240,208,96,0.6)'; ctx.strokeStyle = 'rgba(240,208,96,0.6)';
    ctx.fillRect(kx - 1, by - 2, KEY, 9);
    drawText(ctx, 'W', kx, by, '#16120a');
}
// #drama-cue a tiny (≈8px) per-kind emblem so the edge cue reads at a glance — like the watcher's eye.
// peril = a red danger spike; a hunt = a tan paw; a theft = a masked/hooded face. Pure fillRect for crisp low-res.
function drawCueEmblem(kind, x, y) {
    if (kind === 'hunt') {                       // tan paw: pad + three toes
        ctx.fillStyle = '#d8b070';
        ctx.fillRect(x + 2, y + 3, 4, 3);
        ctx.fillRect(x + 1, y + 1, 1, 1); ctx.fillRect(x + 3, y, 1, 1); ctx.fillRect(x + 5, y + 1, 1, 1);
    } else if (kind === 'crime') {               // theft: a dark hood with two pale eye-slits
        ctx.fillStyle = '#6a4a80'; ctx.fillRect(x + 1, y, 6, 6);
        ctx.fillStyle = '#e8e0f0'; ctx.fillRect(x + 2, y + 2, 1, 1); ctx.fillRect(x + 5, y + 2, 1, 1);
    } else {                                     // peril: a red danger spike (triangle) with a dark notch
        ctx.fillStyle = '#e8484c';
        ctx.beginPath(); ctx.moveTo(x + 4, y - 1); ctx.lineTo(x + 8, y + 6); ctx.lineTo(x, y + 6); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#16120a'; ctx.fillRect(x + 3, y + 1, 1, 3); ctx.fillRect(x + 3, y + 5, 1, 1);
    }
}
// #131 THE THREAT TELL — a top-center marquee while a raid is telegraphed (world.pendingRaid), plus a pulsing
// arrow at the screen edge pointing to the flank the warband comes from. Two beats: "A WARBAND GATHERS" while
// the town still has slack (the player's intel edge — you saw it coming), then a hotter "RAIDERS CLOSING —
// RALLY!" once the sentry's alarm has sounded. Pure display over sim-produced state (null→set edge only).
// #counteroffensive PHASE 0 — the OUTBOUND war party stagecraft (booth ghost, render-only). Cosmetic human
// figures muster at the frontier, ride OUT through the fog toward the target, hold (abroad), then return; the
// marquee carries the beat (the town, for once, on the attack). The figures live nowhere in the sim.
let sortieFigs = null, sortieFigsRid = null;
function sortiePartyFigures(s) {
    if (sortieFigsRid !== s.rid) {
        sortieFigsRid = s.rid; sortieFigs = [];
        for (let k = 0; k < s.n; k++) {
            const seed = hashString('sortiefig:' + s.rid + ':' + k) >>> 0;
            sortieFigs.push({ sheet: { seed, culture: 'human' }, moveDir: 'up', facing: 1, animTime: 0, state: 'walk', off: k - (s.n - 1) / 2 });
        }
    }
    return sortieFigs;
}
function drawSortieFigure(fig, sx, sy, fogA) {
    const frames = characterSprites(fig);
    const frame = fig.state === 'walk' ? (Math.floor(fig.animTime * 7) % 2 ? frames.walk1 : frames.walk2) : frames.idle;
    const fw = frame.width, fh = frame.height;
    const px = Math.floor(sx - fw / 2), py = Math.floor(sy + TILE_H / 2 - fh + 2), footY = py + fh - 2;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    if (fogA < 1) ctx.globalAlpha = fogA;
    const shW = Math.min(fw - 8, 14); ctx.fillStyle = 'rgba(10,14,10,0.35)'; ctx.fillRect(Math.round(sx - shW / 2), footY, shW, 2);
    const flip = fig.facing < 0 && fig.moveDir === 'side';
    if (flip) { ctx.translate(px + fw, py); ctx.scale(-1, 1); ctx.drawImage(frame, 0, 0); }
    else ctx.drawImage(frame, px, py);
    // they ride ARMED — the sword layer over the body (reuses BATTLE_PARTS, aligned to the char rig)
    if (battleReady() && charBox) {
        const row = CHAR_DIRS[fig.moveDir] ?? CHAR_DIRS.down, up = row === CHAR_DIRS.up;
        const part = up ? BATTLE_PARTS.Idle_sword_back : BATTLE_PARTS.Idle_sword;
        if (part && part.naturalWidth) {
            const sc = ASSET_SCALE, cellD = Math.round(CHAR_FW * sc), ox = Math.round(charBox.x * sc), oy = Math.round(charBox.y * sc);
            if (flip) ctx.drawImage(part, 0, row * CHAR_FW, CHAR_FW, CHAR_FW, -ox, -oy, cellD, cellD);
            else ctx.drawImage(part, 0, row * CHAR_FW, CHAR_FW, CHAR_FW, px - ox, py - oy, cellD, cellD);
        }
    }
    ctx.restore();
}
function drawSortie() {
    const s = world.sortie; if (!s) return;
    const dir = s.dir, el = world.time - s.at;
    const frontier = world.frontierDist ? world.frontierDist(dir) : 40;
    let baseD = null, moving = true;
    if (s.phase === 'muster') { baseD = frontier - 5; moving = false; }
    else if (s.phase === 'march') baseD = (frontier - 5) + Math.min(1, el / 8) * 26;   // ride OUT past the fog
    else if (s.phase === 'gone') baseD = null;                                          // abroad — off-field
    else if (s.phase === 'return') baseD = (frontier + 21) - Math.min(1, el / 7) * 26;  // ride back IN
    if (baseD != null && charReady()) {
        const returning = s.phase === 'return';
        for (const fig of sortiePartyFigures(s)) {
            const ang = dir + fig.off * 0.13, co = Math.cos(ang), si = Math.sin(ang);
            const i = CENTER + co * baseD, j = CENTER + si * baseD;
            const mvI = returning ? -co : co, mvJ = returning ? -si : si;   // out = away from town; home = toward it
            const sxm = mvI - mvJ, sym = (mvI + mvJ) / 2;
            fig.moveDir = Math.abs(sym) > Math.abs(sxm) * 0.85 ? (sym > 0 ? 'down' : 'up') : 'side';
            fig.facing = sxm >= 0 ? 1 : -1;
            fig.state = moving ? 'walk' : 'idle';
            if (moving) fig.animTime += 0.016;
            let fogA = 1;
            if (!world.isRevealed(Math.round(i), Math.round(j))) {
                const ci = CENTER - i, cj = CENTER - j, nn = Math.hypot(ci, cj) || 1;
                let depth = 12; for (let st = 1; st <= 12; st++) { if (world.isRevealed(Math.round(i + ci / nn * st), Math.round(j + cj / nn * st))) { depth = st; break; } }
                fogA = Math.max(0.08, 0.24 - depth * 0.013);   // a touch brighter than raiders — they're OUR people
            }
            drawSortieFigure(fig, cam.x + isoX(i, j), cam.y + isoY(i, j), fogA);
        }
    }
    // the marquee — the town, for once, on the attack (the reversed telegraph is the march-phase beat)
    const T = (world.name || 'THE TOWN').toUpperCase(), TG = (s.target || 'THE CAMP').toUpperCase(), D = (s.dirName || 'dark').toUpperCase();
    const line = s.phase === 'muster' ? `A WAR PARTY MUSTERS — ${T} RIDES ON ${TG}`
        : s.phase === 'march' ? `FOR THE FIRST TIME, ${T} CLOSES ON ${TG} FROM THE ${D}`
        : s.phase === 'gone' ? `THE WAR PARTY IS ABROAD — ${T} HOLDS ITS BREATH`
        : `THE WAR PARTY RIDES HOME`;
    const tw = textWidth(line), bx = Math.round(GW / 2 - tw / 2), by = 22, pulse = 0.6 + 0.4 * Math.sin(performance.now() / 300);
    ctx.fillStyle = 'rgba(20,14,8,0.74)'; ctx.fillRect(bx - 5, by - 2, tw + 10, 11);
    ctx.fillStyle = `rgba(224,160,64,${0.5 + 0.5 * pulse})`; ctx.fillRect(bx - 5, by - 2, tw + 10, 1); ctx.fillRect(bx - 5, by + 8, tw + 10, 1);
    drawText(ctx, line, bx, by, '#f0c060');
}

function drawThreatTell() {
    const pr = world.pendingRaid; if (!pr) return;
    const hot = pr.detected;
    const pulse = 0.6 + 0.4 * Math.sin(performance.now() / (hot ? 120 : 260));
    // #nemesis a NAMED return lands like a bell — the marquee carries the war, not just the weather
    const foe = pr.e && pr.e.foe;
    const label = (foe
        ? (hot ? `${foe.name.toUpperCase()} CLOSES FROM THE ${pr.dirName.toUpperCase()} - RALLY` : `${foe.name.toUpperCase()} RETURNS - RAID ${foe.raidCount} OF HIS WAR`)
        : (hot ? `RAIDERS CLOSING FROM THE ${pr.dirName.toUpperCase()} - RALLY` : `A WARBAND GATHERS TO THE ${pr.dirName.toUpperCase()}`)) + ' [W]';   // W jumps the camera there
    const tw = textWidth(label), bx = Math.round(GW / 2 - tw / 2), by = 22;
    ctx.fillStyle = `rgba(20,10,8,${0.7 + 0.15 * pulse})`;
    ctx.fillRect(bx - 5, by - 2, tw + 10, 11);
    ctx.fillStyle = hot ? `rgba(224,80,64,${0.5 + 0.5 * pulse})` : `rgba(224,160,64,${0.5 + 0.5 * pulse})`;
    ctx.fillRect(bx - 5, by - 2, tw + 10, 1);
    ctx.fillRect(bx - 5, by + 8, tw + 10, 1);
    drawText(ctx, label, bx, by, hot ? '#ffb0a0' : '#f0c060');

    // POSITIONING AWARENESS: the edge arrow only makes sense while the approach is OFF-screen. Compute the raiders'
    // edge-spawn point in the bearing (the same geometry #stageRaidCinematic uses) and, once the player has panned
    // so that ground is in view, skip the arrow — it has nothing to point at anymore.
    {
        const co = Math.cos(pr.dir), si = Math.sin(pr.dir), m = 4;   // RAID_SPAWN_MARGIN
        const tx = co > 0 ? (GRID - m - CENTER) / co : co < 0 ? (m - CENTER) / co : Infinity;
        const ty = si > 0 ? (GRID - m - CENTER) / si : si < 0 ? (m - CENTER) / si : Infinity;
        const d = Math.max(36, Math.min(tx, ty));
        const px = cam.x + isoX(CENTER + co * d, CENTER + si * d), py = cam.y + isoY(CENTER + co * d, CENTER + si * d);
        if (px > -24 && px < GW + 24 && py > 18 && py < GH + 24) return;   // the approach is on-screen — the arrow retires
    }

    // an arrow at the screen edge in the warband's bearing (world.pendingRaid.dir), so the eye knows where to look
    const cx = GW / 2, cy = GH / 2 + 6;
    const dx = Math.cos(pr.dir), dy = Math.sin(pr.dir) * 0.5;   // halved-y for the iso feel
    const m = 20, sc = Math.min((GW / 2 - m) / (Math.abs(dx) || 1e-6), (GH / 2 - m) / (Math.abs(dy) || 1e-6));
    const ax = Math.round(cx + dx * sc), ay = Math.round(cy + dy * sc);
    const ang = Math.atan2(dy, dx), s = 7;
    ctx.fillStyle = hot ? `rgba(224,80,64,${pulse})` : `rgba(224,160,64,${pulse})`;
    ctx.beginPath();
    ctx.moveTo(ax + Math.cos(ang) * s, ay + Math.sin(ang) * s);
    ctx.lineTo(ax + Math.cos(ang + 2.5) * s, ay + Math.sin(ang + 2.5) * s);
    ctx.lineTo(ax + Math.cos(ang - 2.5) * s, ay + Math.sin(ang - 2.5) * s);
    ctx.closePath(); ctx.fill();
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
    if (startScreen) return;   // #START the launch menu owns input — no world shortcuts drive the backdrop
    if (memoryIntro) { dismissMemoryIntro(); return; }   // #memory-intro (Codex #94 P2) any key dismisses — even ahead of a focused whisper box
    if (chatFocused) return;   // #93: typing a whisper — never fire world shortcuts (W/F/T/arrows)
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (resumeCard) { resumeCard = null; return; }   // any key dismisses the catch-up card
    if (faceoff) { faceoff = null; return; }          // #faceoff any key dismisses the post-raid VS card
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
            if (target) { followMode = true; followTarget = target; selected = target; sheetScroll = 0; sheetTab = 0; rosterOpen = false; chronOpen = false; boardOpen = false; funnelFollow(); }
        }
    }
    // W — WATCH: jump to follow the current off-screen drama the cue is pointing at
    if ((e.key === 'w' || e.key === 'W') && world && booted) {
        // a live raid outranks the spotlight — W snaps (or re-snaps) the camera to the warband
        if (world.raidEvent) {
            const rr = world.raidEvent.raiders || [];
            const fr = (world.raidEvent.focus && !world.raidEvent.focus.fell) ? world.raidEvent.focus : rr[0];
            const spot = fr ? { i: fr.i, j: fr.j } : (world.well ? { i: world.well.i, j: world.well.j } : null);
            if (spot) { raidFocus = spot; followMode = false; followTarget = null; rosterOpen = false; chronOpen = false; boardOpen = false; }
        } else if (world.pendingRaid) {
            // #raid-feel the TELEGRAPH answers W too (player: "hit W to go there"): jump to where the
            // warband is gathering — the seeded edge point in pr.dir the muster figures stand on.
            const pr = world.pendingRaid, co = Math.cos(pr.dir), si = Math.sin(pr.dir), m = 4;
            const tx = co > 0 ? (GRID - m - CENTER) / co : co < 0 ? (m - CENTER) / co : Infinity;
            const ty = si > 0 ? (GRID - m - CENTER) / si : si < 0 ? (m - CENTER) / si : Infinity;
            const d = Math.max(40, Math.min(tx, ty)) - 6;
            followMode = false; followTarget = null; rosterOpen = false; chronOpen = false; boardOpen = false;
            cam.x = GW / 2 - isoX(CENTER + co * d, CENTER + si * d);
            cam.y = GH / 2 - isoY(CENTER + co * d, CENTER + si * d);
        } else {
            const target = spotlightFarmer();
            if (target) { followMode = true; followTarget = target; selected = target; sheetScroll = 0; sheetTab = 0; rosterOpen = false; chronOpen = false; boardOpen = false; dramaSpotlight = null; funnelFollow(); }
        }
    }
    // M — toggle the zoom-out WORLD map (the world of towns)
    if ((e.key === 'm' || e.key === 'M') && world && booted) {
        if (worldMapOpen) closeWorldMap(); else openWorldMap();
    }
    // Esc — stop following AND close the card / any open panel (a clean sweep back to the map)
    if (e.key === 'Escape' && world && booted) {
        followMode = false; followTarget = null;
        selected = null; selectedSlotKey = null;
        rosterOpen = false; chronOpen = false; boardOpen = false; settingsOpen = false; disarmImport(); closeWorldMap();
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
    // #lineage a soul hails from a REAL remembered town (their forebear's, if an heir; else a seeded pick).
    const origin = originFor(pick.memory, pick.mutation, lineage);
    // Grow from the ORIGINAL memory — its id/seed/vocation/stats are untouched (#Codex40 P0: regenerating
    // collapsed every founder to one identity; #Codex40 P1: classifyMemory reads content, so the place must
    // not enter growth). AFTER growth we re-site only the DISPLAYED past life (title/summary) at the real
    // town, on a COPY, so "keeping the letters at Duskvale" names a town that truly stood here — as flavour
    // over an unchanged farmer. The real place still surfaces on the sheet + in memory echoes.
    const f = world.addFarmer(pick.memory, pick.mutation, lineage);
    if (f) {
        if (origin) {
            f.sheet.origin = { seed: origin.seed, name: origin.name };
            const mem = f.sheet.memory;
            if (mem && mem.place && mem.place !== origin.name && typeof mem.title === 'string') {
                f.sheet.memory = {
                    ...mem,
                    title: mem.title.split(mem.place).join(origin.name),
                    summary: typeof mem.summary === 'string' ? mem.summary.split(mem.place).join(origin.name) : mem.summary,
                    place: origin.name,   // content stays ORIGINAL — stats/archetype never move
                };
            }
        }
        terrainDirty = true; selected = f;
    } else world.addLog('No room left! The valley is full.', '#e0a03c');
}

// #lineage which remembered town a founder hails from: their forebear's town if they're an heir (real
// descent), else a per-seed deterministic pick from the roster. null when the world remembers nothing.
function originFor(memory, mutation, lineage) {
    const roster = world.rememberedTowns;
    if (!roster || !roster.length) return null;
    if (lineage && lineage.ofTownSeed != null) {
        const t = roster.find(x => String(x.seed) === String(lineage.ofTownSeed));
        if (t) return t;
        if (lineage.ofTownName) return { seed: lineage.ofTownSeed, name: lineage.ofTownName };
    }
    // key on id + mutation so reused memories (a thin offline corpus) don't all hail from one town
    const key = ((memory && (memory.id || memory.title)) || 'anon') + ':' + (mutation || 0);
    return roster[hashString('origin:' + key) % roster.length];
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

// #interp — render-only position interpolation (see the tick loop). applyFarmerInterp stashes each farmer's
// TRUE sim pos and moves pos to lerp(pre-tick, sim, alpha) for the draw pass; restoreFarmerInterp puts the true
// pos back. A large delta (a teleport/respawn, not a walk step) snaps to the true pos so we never slide a
// farmer across the map. Never call one without the other, and always restore before anything serializes pos.
function applyFarmerInterp(alpha) {
    for (const f of world.farmers) {
        if (f._riI === undefined) { f._riI = f.pos.i; f._riJ = f.pos.j; }   // freshly spawned — no prior step
        f._trueI = f.pos.i; f._trueJ = f.pos.j;
        const di = f._trueI - f._riI, dj = f._trueJ - f._riJ;
        if (di * di + dj * dj > 4) continue;   // teleport (> 2 tiles in one tick) — don't interpolate
        f.pos.i = f._riI + di * alpha; f.pos.j = f._riJ + dj * alpha;
    }
    // #interp the raid warband (display-only .i/.j) — same lerp so raiders glide between 30Hz steps instead of
    // teleporting each tick (the "really shaky" walk). A phase-jump (approach->march->flee) exceeds the gate and snaps.
    const re = world.raidEvent;
    if (re && re.raiders) for (const r of re.raiders) {
        if (r._riI === undefined) { r._riI = r.i; r._riJ = r.j; }
        r._trueI = r.i; r._trueJ = r.j;
        const di = r._trueI - r._riI, dj = r._trueJ - r._riJ;
        if (di * di + dj * dj > 4) continue;
        r.i = r._riI + di * alpha; r.j = r._riJ + dj * alpha;
    }
}
function restoreFarmerInterp() {
    // #Codex27-1 CLEAR the markers after restoring, so a farmer only carries `_trueI` while it is actually mutated
    // THIS pass. Otherwise, if applyFarmerInterp throws part-way through the next frame, the finally would rewrite
    // the newly-advanced sim positions of farmers it never touched this frame with LAST frame's stale coordinates.
    for (const f of world.farmers) if (f._trueI !== undefined) { f.pos.i = f._trueI; f.pos.j = f._trueJ; f._trueI = f._trueJ = undefined; }
    const re = world.raidEvent;   // #interp restore the raiders' TRUE pos before the next tick / any read
    if (re && re.raiders) for (const r of re.raiders) if (r._trueI !== undefined) { r.i = r._trueI; r.j = r._trueJ; r._trueI = r._trueJ = undefined; }
}

let _funnelDead = false;   // first funnel-poll failure disables the poll outright (warn once, run never again)
// #funnel — TWO mid-session steps, detected by POLLING observable UI state (`chronOpen`,
// `world.day`). Polling cannot miss a path, which is why it is used where it can be.
//
// `first_follow` is deliberately NOT here. It was polled, and that credited a passive player with an
// interaction, because the day-one sentry handoff sets `followMode` automatically (Codex #97 P1-3).
// It now fires from `funnelFollow()` at the player-initiated call sites only — and that trade is
// real and permanent: **any future way to follow a farmer MUST call funnelFollow() or it will go
// uncounted.** Polling's can't-miss-a-path property does not protect that event any more.
//
// trackOnce short-circuits on an in-memory Set after the first spend and bails before any storage
// read on a dark host, so the steady-state cost here is two Set lookups per frame.
function funnelTick() {
    // `_startModeBoot`, NOT `startMode`: the latter is a const declared INSIDE boot() and this
    // function runs at module scope from frame(). Referencing it here is a ReferenceError that
    // parsing does not catch — it throws before the frame draws, freezing the canvas on the boot
    // screen forever. The mirror at the top of this file exists for exactly this reason.
    if (!funnelPlayed()) return;
    // #funnel first_follow is NOT polled — Codex #97 P1-3. The day-one sentry handoff sets
    // followMode automatically, so polling the state credited a passive player with an
    // interaction. It is now fired from the click paths only (see funnelFollow).
    if (chronOpen) trackOnce('chronicle_opened');
    if (world.day >= 10) trackOnce('day10_reached', { seed: world.seed });
}

// #funnel — is this a REAL played session? `_startModeBoot` alone is not enough: "Watch a Wild
// Town" dismisses the menu while the world stays a non-persisting spectator backdrop, and a
// spectator who whispers would otherwise burn a durable flag that the player's first real town can
// then never fire (Codex #97 P1-2). `world._spectator` is the flag the rest of main.js already
// gates on — eight other call sites use it.
function funnelPlayed() {
    return !!(world && !_startModeBoot && !world._spectator);
}

// #funnel — the player CHOSE to follow someone. Called from the click paths rather than polled, so
// an automatic camera handoff can never count as engagement. Trade-off accepted knowingly: unlike
// the poll, this can miss a future follow path, so any new way to follow a farmer must call it.
function funnelFollow() {
    if (funnelPlayed()) trackOnce('first_follow');
}

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

    // #funnel — WRAPPED, and not defensively-for-the-sake-of-it: this call sits upstream of every
    // draw in the frame, so anything it throws freezes the canvas on whatever was last painted and
    // the game is simply dead. Analytics must never be able to do that. A funnel step lost to a
    // swallowed error costs a data point; an unwrapped throw here costs the whole game.
    // Codex #97 P2-5: the first failure DISABLES the poll. Warning once while still calling the
    // broken function turns a permanent defect into ~60 caught exceptions a second, and makes the
    // log message ("disabled for this session") a lie.
    if (!_funnelDead) {
        try { funnelTick(); }
        catch (err) { _funnelDead = true; console.warn('ry-farms: funnel poll failed — analytics disabled for this session', err); }
    }

    // #Codex36 P1-1: while a crossing is in flight the OUTGOING town has already been snapshotted — ticking
    // it further would do work the save never sees (lost at 20x + slow IndexedDB). Freeze the sim; display
    // still draws the last state under the crossing static.
    // #faceoff FREEZE the sim while the pre-battle VS card is up — a true "VS → click → FIGHT" gate: the
    // warband holds at the fog edge until dismissed, then charges in. (Display-only pause; determinism resumes.)
    simAccumulator += (_switching || faceoff) ? 0 : dt * (world._speedMult || 1);
    let steps = 0;
    // #faceoff #Codex41-P1 gate the batch on !faceoff too (not only the accumulator add): while the card is up a
    // preserved backlog must NOT drain, or a raid born mid-batch at 20x could advance/strike BEHIND the freeze.
    while (!faceoff && simAccumulator >= FIXED_DT && steps < 800) {
        for (const f of world.farmers) { f._riI = f.pos.i; f._riJ = f.pos.j; }   // #interp snapshot the PRE-tick pos as the "from"
        const _re = world.raidEvent;   // #interp raiders (display-only, 30Hz) get the SAME smoothing so they don't jump/shake — AND the pre-tick raid identity
        if (_re && _re.raiders) for (const r of _re.raiders) { r._riI = r.i; r._riJ = r.j; }
        world.tick(FIXED_DT); simAccumulator -= FIXED_DT; steps++;
        // #Codex42-P1 raise the pre-battle card the moment world.raidEvent changes IDENTITY — both a fresh raid
        // (null→event) AND a pointer REPLACEMENT (a new raid landing over a long-running cinematic). A boolean
        // "did a raid exist" would miss the replacement and let the new raid advance behind the freeze at 20x.
        // The `!faceoff` guard then exits the batch, preserving the leftover accumulator for the post-dismiss resume.
        if (world.raidEvent && world.raidEvent !== _re) maybeFaceoff();
    }
    maybeFaceoff();   // #faceoff also covers a raid already present at frame start (e.g. right after a load)
    // #vote-voice — kick the election-scene generation the moment the REAL day-10 gathering opens, so the
    // stump script has the walk-in window to land before the candidates take the floor. Self-guarded (once
    // per seed+day, rehearsals excluded) so the per-frame call costs two compares.
    if (world && !world._spectator && world.roles && world.roles.foundingPhase === 'gathering') requestElectionScene(world);
    // #fresh-held — a ?fresh request that found the ground occupied resumed the LIVING town instead
    // (by design); say so once, visibly, instead of only in the console.
    if (!_heldToasted && !startScreen && world && new URLSearchParams(location.search).has('held')) {
        _heldToasted = true;
        calloutQueue.push({ text: 'This ground already holds a living town - resumed it. Start a new town from the menu to begin again', tone: 'neutral' });
    }
    // #inspiration slice 2 — germination telemetry pickup: the sim stamps a transient event at
    // the dawn beat (display-side field, like lightningFlash); the funnel counts it here.
    if (world && world._germEvent) {
        const g = world._germEvent; world._germEvent = null;
        track('seed_germinated', { seed: world.seed, kind: g.kind, day: g.day });
    }
    // #postcard — greet the recipient of a shared link, once, on the founding boot (flag set beside
    // town_created, where `resumed` is settled).
    if (_postcardArrival && !_postcardToasted && !startScreen && world) {
        _postcardToasted = true;
        calloutQueue.push({ text: 'A postcard town - someone shared this very land with you, and from here it grows as your own', tone: 'neutral' });
    }
    // #vote-panel edge (owner) — when the vote window OPENS it replaces the farmer detail card (and
    // only that: settings/chronicle/roster/board live above and are untouched); while it holds,
    // clicking farmers is neutralized (see the pointerup gate) though hover names still work.
    if (voteWindowActive() && !_voteWindowWas) { selected = null; selectedSlotKey = null; }
    _voteWindowWas = voteWindowActive();
    // #curate whisper nudge (council) — the game's ONE verb, named once, early, then never again: a
    // single toast ~50s into a fresh town's day 1, once per BROWSER (returning players know). Display-only.
    if (!_whisperNudged && !startScreen && world && !world._spectator && world.day === 1 && world.clock > 50 && world.clock < 200) {
        _whisperNudged = true;
        try {
            if (!localStorage.getItem('ryfarms-whisper-nudge')) {
                localStorage.setItem('ryfarms-whisper-nudge', '1');
                calloutQueue.push({ text: 'You are a quiet presence here - click a farmer and whisper a thought into their head', tone: 'neutral' });
            }
        } catch { /* private mode - skip */ }
    }
    // #firstwatch the day-1 congregation has just broken up, having agreed a shared watch: take hold of the
    // founder standing it tonight. The first frame with a world only RECORDS the state (no edge), so loading
    // any save from later never triggers this. A player already trailing someone, or mid-raid, keeps what
    // they chose. Fires once per town, at the very start — nothing later ever grabs the camera.
    {
        // SUSPEND across a frontier crossing, and suspend without CONSUMING. switchTown clears _switching
        // as soon as the destination world is installed, but crossFx keeps running its 0.7s phase-in with
        // the sim already live — so a day-one town you cross into could pass clock 38 underneath the
        // transition, taking the camera and drawing the coach line over the crossing graphic, and the edge
        // would be spent. Skipping the whole block (rather than updating sawCongregating) leaves the
        // pending true→false intact, so it fires on the first frame after the crossing settles.
        if (!crossFx) {
            const congregating = !!(world.congregating && world.congregating());
            if (sawCongregating === null) sawCongregating = congregating;   // first observation: record, never fire
            else if (sawCongregating && !congregating) {
                const sentry = world.currentSentry && world.currentSentry();
                if (sentry && !followMode && !world.raidEvent && !startScreen && !world._spectator) {
                    followMode = true; followTarget = sentry; selected = sentry;
                    sheetScroll = 0; sheetTab = 0; rosterOpen = false; chronOpen = false; boardOpen = false;
                    dramaSpotlight = null; raidFocus = null;
                }
            }
            sawCongregating = congregating;
        }
    }
    // #incoming the SENTRY'S ALARM (detection edge) fires the fullscreen shader — headline "INCOMING RAID..." —
    // moved here from the strike. Once per telegraph; display-only, so no determinism reach.
    {
        const pr = world.pendingRaid;
        if (pr && pr.detected && !_raidDetected) {
            _raidDetected = true;
            raidFx = { t: 0, stings: 1, kind: 'incoming' };
            raidShake = 5;
            if (audio.raidSting) audio.raidSting();
        } else if (!pr) { _raidDetected = false; }   // reset for the next telegraph
    }
    // #interp — the sim ticks at 30Hz (FIXED_DT) but we render at 60/120Hz, so a farmer's pos only advances every
    // 2nd/4th frame → its motion (and the follow camera tracking it) STUTTERS. Fix: render each farmer BETWEEN its
    // last two sim positions by the leftover-accumulator fraction. Display-only — we stash the TRUE pos, draw at
    // the interpolated pos, and restore it before weather/UI/autosave, so nothing that reads or SERIALIZES pos
    // ever sees the interpolated value (determinism + saves untouched).
    const _interpAlpha = Math.min(1, simAccumulator / FIXED_DT);
    // #Codex26-1: EVERYTHING that runs while pos/cam are in their temporary (interpolated/snapped) state is inside
    // ONE try — applyFarmerInterp itself, audio.update, the raid/camera easing, the snap, and the whole draw — so a
    // throw ANYWHERE still hits the finally that restores them. A fractional interpolated pos must never survive
    // into maybeAutosave (save corruption / determinism fork). _snapped gates the cam restore (false if we threw
    // before snapping, in which case cam is still the correctly-eased float and needs no restore).
    let _camFx = 0, _camFy = 0, _snapped = false;
    try {
    applyFarmerInterp(_interpAlpha);

    // soundtrack follows the sim: seasonal theme by day, crickets/owls at night,
    // rain/thunder by weather, and a rooster crow at dawn once the town has one
    const anyBuilding = world.farmers.some(f => f.state === 'housebuild' || f.state === 'fencepost' || f.state === 'build' || f.state === 'coopbuild' || f.state === 'scarecrow');
    audio.update({ isNight: world.isNight(), weather: world.weather, flash: world.lightningFlash, season: world.season, culture: world.culture, hasRooster: world.hasRooster(), building: anyBuilding,
        raidPhase: world.raidEvent ? 2 : world.pendingRaid ? 1 : 0 });   // #raid-score 1 = buildup from the moment a warband gathers · 2 = battle once it lands (rehearsals included)
    // #raid-council a telegraphed raid asks the LLM (fire-and-forget, deduped per telegraph) to write the
    // muster counsel — the line's own urgent strategy talk. Offline/slow = the authored pools carry it.
    if (world.pendingRaid && !world.raidEvent) {
        requestRaidCouncil(world);
        requestDuelBeat(world);   // #one-beat the DM's single staged moment for the marquee duel (named foes only)
    }
    // #nemesis THE BATTLE RECORD → SuperMemory: the frame a REAL raid's show ends, compile the round-by-round
    // record from the fx stream + the verdict and persist it as one battle document. Side-channel only (the
    // show is display; dormant raids had no show and get no doc); rehearsals are ghosts and never fire this.
    // #Kimi P0-3: compile on POINTER CHANGE, not only the set->null edge — a second raid landing (or a
    // rehearsal staged) over a live cinematic used to orphan the displaced battle's record forever.
    if (world.raidEvent !== _battleWatch) {
        const re = _battleWatch; _battleWatch = world.raidEvent;
        if (re && re.struck && re.out && re.e) {
            const nameOf = seed => { const f = world.farmers.find(x => x.sheet.seed === seed); return f ? f.sheet.name.split(' ')[0] : null; };
            const battle = {
                rid: re.e.id || `${re.e.pairKey}:${re.e.ordinal}`,
                day: world.day, year: world.year,
                clan: (re.out && re.out.clan) || (re.e.by || 'a warband'),
                nemesis: re.e.foe ? { name: re.e.foe.name, raidCount: re.e.foe.raidCount, sworeAgainst: re.e.foe.sworeAgainst != null ? nameOf(re.e.foe.sworeAgainst) : null } : null,
                outcome: { felled: re.out.felled, n: re.out.n, harvestLost: re.out.harvestLost },
                hero: re.out.heroSeed != null ? nameOf(re.out.heroSeed) : null,
                wounded: (re.out.woundSeeds || []).map(nameOf).filter(Boolean),
                rounds: (re.record || re.fx || []).map(x => ({ who: x.who || null, text: x.text })),   // #Kimi P0-1 the uncapped record
            };
            requestRaidDebrief(world, battle);                    // the aftermath counsel (bubbles — ghosts included)
            if (!re.rehearsal) {
                // #inscription the record — REAL raids only (ghost contract) — and when the write actually
                // LANDS, the town says so on screen: the memory-loop's payoff made visible (council, unanimous:
                // "your point is followed by silence"). The card queues BEHIND the aftermath cards.
                const w = world;
                // #60 belt-and-braces with the module's own guard: a non-persisting session must not inscribe
                // a battle into the shared store, and this path had no guard at all.
                if (!w._persistenceDisabled) persistBattle(w, battle).then(ok => {
                    if (!ok || w !== world) return;
                    const rid = String(battle.rid).replace(/[^\w:.-]/g, '_').slice(0, 80);
                    pendingInscription = {
                        foe: !!battle.nemesis,
                        text: battle.nemesis
                            ? `${battle.nemesis.name}'s raid - the battle of day ${battle.day}, year ${battle.year} - is set down in ${w.name}'s memory, blow by blow, as it happened.`
                            : `The battle of day ${battle.day}, year ${battle.year} is set down in ${w.name}'s memory, blow by blow, as it happened.`,
                        why: `town record: battle:${w.seed}:${rid}`,   // Codex #88 P2: never claim a server write for local success
                    };
                });
            }
        }
    }
    // at extreme speeds keep a bounded backlog (spread over coming frames) rather than dropping
    // all the leftover time, but cap it so we never spiral.
    if (steps >= 800) simAccumulator = Math.min(simAccumulator, 800 * FIXED_DT);

    // #Codex67-1 curtain watcher: the show ended (booth cancel OR the election's natural curtain inside
    // farm.js, which main.js otherwise never sees) -> rewind to the pre-curtain snapshot. Edge-triggered so
    // chained shows (cancel -> immediately stage another, same frame) never rewind mid-session: the frame
    // never observes the intermediate null.
    if (_hadRehearsal && world && !world.rehearsal && world._rehearsalSnapshot) rewindFromRehearsal();
    _hadRehearsal = !!(world && world.rehearsal);
    // Codex #76-3 — an IN-PLACE settle (canonical inbox ended a rehearsal inside farm.js) replaced every
    // farmer object without the watcher above firing (snapshot already nulled): the settle epoch is the
    // signal to run the same lens reset the normal rewind does, so selection/follow/raid caches never
    // point at obsolete ghosts.
    if (world && (world._settleEpoch || 0) !== _seenSettleEpoch) {
        _seenSettleEpoch = world._settleEpoch || 0;
        resetTownLenses();
    }

    // #raidfx / #131b — a raid now plays in two beats. On STAGE the warband is still out at the fog edge
    // ('approach'): snap the camera to the well so the player watches them stream in out of the dark — but hold
    // the battle-transition. Only when the lead raider CROSSES INTO TOWN (world.raidEvent.struck) does the
    // "UNDER RAID" flash + screen-shake + sting fire. Display-only, so no determinism impact (we observe sim
    // edges: null→set for the camera, struck false→true for the blow).
    if (world.raidEvent && world.raidEvent !== _lastRaidEvent) {
        _lastRaidEvent = world.raidEvent;
        _raidStruck = false;
        raidFocus = world.well ? { i: world.well.i, j: world.well.j } : { i: 55, j: 55 };   // frame the town; raiders walk in from off-screen
        followMode = false; followTarget = null;   // the raid outranks any farmer we were trailing
    }
    // #raid-feel THE CAMERA RIDES THE FOCUS DUEL (player: "they ran to the treeline and I couldn't see any
    // of the exchanges"): once struck, the lens tracks the story pairing wherever the line formed — not the
    // well. (A manual pan still breaks the lock, and W re-snaps it.)
    if (world.raidEvent && world.raidEvent.struck && raidFocus) {
        const fr = (world.raidEvent.focus && !world.raidEvent.focus.fell) ? world.raidEvent.focus
                 : (world.raidEvent.raiders || []).find(r => !r.fell);
        if (fr) { raidFocus.i = fr.i; raidFocus.j = fr.j; }
    }
    if (world.raidEvent && world.raidEvent.struck && !_raidStruck) {
        _raidStruck = true;
        // #incoming the fullscreen shader now plays at the ALARM (detection), not here — the strike keeps just
        // the physical IMPACT: a screen-shake + the war-horn sting as the lead raider crosses the line.
        raidShake = 7;
        const e = world.raidEvent.e || {};
        raidFocus = (e.i != null && e.j != null) ? { i: e.i, j: e.j } : (world.well ? { i: world.well.i, j: world.well.j } : raidFocus);
        if (audio.raidSting) audio.raidSting();     // audio takeover (music shift groundwork)
    }
    // #131b during the approach, keep the incoming band on-screen: ease the camera to a point between the town
    // and the nearest raider (biased outward toward them) so the player watches them stream in out of the fog.
    // On strike this is superseded by the well/target focus above.
    if (world.raidEvent && world.raidEvent.phase === 'approach' && world.raidEvent.raiders.length && world.well) {
        let lead = world.raidEvent.raiders[0], bd = Infinity;
        for (const r of world.raidEvent.raiders) { const d = Math.hypot(r.i - world.well.i, r.j - world.well.j); if (d < bd) { bd = d; lead = r; } }
        raidFocus = { i: world.well.i + (lead.i - world.well.i) * 0.62, j: world.well.j + (lead.j - world.well.j) * 0.62 };
    }
    if (!world.raidEvent) { _lastRaidEvent = null; _raidStruck = false; raidFocus = null; }   // raid over — release the camera
    if (raidShake > 0) raidShake = Math.max(0, raidShake - dt * 11);

    // camera: while a raid is live, ride the raidFocus; otherwise trail followTarget
    // #START launch-page spectator drift — the camera gently trails a random townsperson, rotating to a new one
    // every ~15s, purely for ambient life behind the menu (display-only; never opens a card).
    if (startScreen && world._spectator && world.farmers.length) {
        const nowMs = performance.now();
        if (!specTarget || !world.farmers.includes(specTarget) || nowMs >= specNextSwitch) {
            specTarget = world.farmers[Math.floor(Math.random() * world.farmers.length)];
            specNextSwitch = nowMs + 15000;
        }
        const tx = GW / 2 - isoX(specTarget.pos.i, specTarget.pos.j);
        const ty = GH / 2 - isoY(specTarget.pos.i, specTarget.pos.j) - 12;
        cam.x += (tx - cam.x) * 0.05; cam.y += (ty - cam.y) * 0.05;   // slow, dreamy drift
    } else if (raidFocus) {
        const tx = GW / 2 - isoX(raidFocus.i, raidFocus.j);
        const ty = GH / 2 - isoY(raidFocus.i, raidFocus.j) - 12;
        if (!mouse.dragging) { cam.x += (tx - cam.x) * 0.16; cam.y += (ty - cam.y) * 0.16; }
    } else if (followMode && followTarget && world.farmers.includes(followTarget) && !mouse.dragging) {
        // #follow-away — an on-sortie rider is OFF-FIELD (the draw pass skips them); their pos froze at
        // the departure edge, so trailing it parks the camera on empty ground ("my farmer disappeared",
        // owner-reported with the rally banner in frame). Hold on their homestead until they ride home —
        // the FOLLOWING banner names where they've gone, and the return resumes the trail seamlessly.
        const at = followTarget.onSortie ? world.houseDoor(followTarget.plot) : followTarget.pos;
        const tx = GW / 2 - isoX(at.i, at.j);
        const ty = GH / 2 - isoY(at.i, at.j) - 12;
        cam.x += (tx - cam.x) * 0.14; cam.y += (ty - cam.y) * 0.14;
    } else if (followMode && (!followTarget || !world.farmers.includes(followTarget))) {
        followMode = false; followTarget = null;   // nothing left to follow
    }

    // #whisper-preload: while TRAILING someone with the whisper widget COLLAPSED, quietly aim the (hidden) chat
    // at them, so opening it drops you straight into their head — a seamless follow→whisper handoff. Never touch
    // it while the widget is OPEN: an open chat means the player has deliberately chosen who they're talking to,
    // and re-pointing it at the follow target would hijack that conversation.
    if (!chatWidgetOpen && followMode && followTarget && world.farmers.includes(followTarget)) chatFarmer = followTarget;

    // #raidfx — jolt the WORLD (not the UI) while the shake is hot (integer offsets, folded into the snap below).
    let _shakeX = 0, _shakeY = 0;
    if (raidShake > 0.1) {
        const s = raidShake;
        _shakeX = Math.round((Math.sin(t * 91) * 0.6 + Math.sin(t * 47) * 0.4) * s);
        _shakeY = Math.round((Math.sin(t * 83) * 0.6 + Math.sin(t * 59) * 0.4) * s);
    }
    // #camera-snap — now that motion is INTERPOLATED (smooth), snap the render camera to whole pixels so the
    // terrain chunks stop tearing against each other as the world scrolls — the residual "diagonal shimmer"
    // (worst diagonally, where cam.x AND cam.y are both fractional at once). The camera still EASES as a float
    // (restored after the world pass), so following stays smooth; sprites already step by whole pixels (pixel
    // art), so the followed target is unaffected. This only helps ON smooth motion — on the earlier stuttering
    // motion it amplified the jitter, which is why it's paired with the interpolation, not used alone.
    _camFx = cam.x; _camFy = cam.y; _snapped = true;   // capture the eased float, then snap (finally restores it)
    cam.x = Math.round(cam.x) + _shakeX; cam.y = Math.round(cam.y) + _shakeY;

    // background
    ctx.fillStyle = '#2a3438';
    ctx.fillRect(0, 0, GW, GH);

    world._tilesChanged = false;   // chunk-level dirt now drives rebakes
    if (world._seasonChanged) { chunkCanvases.clear(); world._seasonChanged = false; }
    drawTerrainChunks();
    drawRaidSeam();   // #P1 the orc neighbour's desert bleeding in from the threat direction during a raid (render-only)

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
    // #bubble-overlay — words on top of the whole scene, so a farmer standing behind the silo/war-post/house
    // (or clustered at the well during the day-1 congregation) is never speaking from behind the building.
    if (!startScreen) for (const fb of farmerBubbles) drawFarmerBubble(fb.f, fb.sx);   // #START no speech bubbles behind the menu

    // #raid-feel floating COMBAT TEXT (MISS / PARRY! / HIT! / FELLED! / BREAKS OFF) from the duel exchanges —
    // rises and fades over ~1.2s of sim time; also the trigger for the clash SFX (each new entry plays once).
    if (world.raidEvent && Array.isArray(world.raidEvent.fx)) {
        for (const x of world.raidEvent.fx) {
            const age = world.time - x.at, dur = x.dur || 1.2;   // #one-beat barks linger longer than combat text
            if (age < 0 || age > dur) continue;
            if (!x._heard) { x._heard = true; if (audio.clash) audio.clash(x.text); }
            const sx2 = cam.x + isoX(x.i, x.j), sy2 = cam.y + isoY(x.i, x.j) - 24 - age * (10 / dur);
            ctx.save(); ctx.globalAlpha = Math.max(0, 1 - Math.max(0, age - dur * 0.5) / (dur * 0.5));
            const wpx = textWidth(x.text);
            ctx.fillStyle = 'rgba(8,9,14,0.72)'; ctx.fillRect(Math.round(sx2 - wpx / 2) - 2, Math.round(sy2) - 2, wpx + 4, 9);
            drawText(ctx, x.text, Math.round(sx2 - wpx / 2), Math.round(sy2), x.color || '#e8ecf5');
            ctx.restore();
        }
    }

    drawWeather(dt, t);
    } finally {
        // always-run restore: TRUE sim pos back before autosave serializes it, and (if we snapped) the float cam
        restoreFarmerInterp();
        if (_snapped) { cam.x = _camFx; cam.y = _camFy; }
    }
    if (!startScreen) drawUI();   // #START the launch pages are a pure view-portal — no top bar / controls / minimap
    maybeAutosave();
    // (end-of-day recap card removed — the Moments/callout banners + the chronicle carry the day's beats now;
    // the "PREVIOUSLY ON" catch-up card on RESUME is separate and stays, see drawResumeCard)
    if (!startScreen) drawMoments();   // #98: spotlight the profound beats on top of the HUD (still under the CRT shader)
    if (!startScreen) drawBarTooltips();   // TRUE top of z-order (owner): tooltips above toasts, panels, cards — everything but the cursor
    if (raidFx) {   // #raidfx battle-transition, topmost in-game layer; the war-horn sounds three times across it
        drawRaidFx(); raidFx.t += dt;
        if (raidFx.stings < 3 && raidFx.t >= raidFx.stings * 1.05) { raidFx.stings++; if (audio.raidSting) audio.raidSting(); }
        if (raidFx.t >= RAIDFX_DUR) raidFx = null;
    }
    if (crossFx) {   // #P2 the channel change: static out -> swap the live World -> static in on the far frontier
        drawCrossFx(); crossFx.t += dt;
        if (crossFx.phase === 'out' && crossFx.t >= 0.5 && !crossFx.started) {
            crossFx.started = true;
            switchTown(crossFx.seed, crossFx.ang).then(ok => { if (crossFx) { if (!ok) { crossFx = null; } else { crossFx.phase = 'in'; crossFx.t = 0; } } });
        } else if (crossFx.phase === 'in' && crossFx.t >= 0.7) crossFx = null;
    }
    // a quiet indicator while the camera is trailing someone (F, or the sheet's crosshair, toggles it)
    FOLLOW_PREV.w = FOLLOW_NEXT.w = 0;   // no banner, no clickable arrows (cleared each frame)
    if (!startScreen && followMode && followTarget && world.farmers.includes(followTarget) && !rosterOpen && !chronOpen && !boardOpen) {
        // #follow-away — the label stays TERSE by owner call (a wordy status here read as clutter): the
        // persistent away strip under the top bar carries the story of an off-field rider, and the camera
        // holds on their homestead meanwhile (the fix for "my farmer disappeared").
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
        // clickable hit zones over each arrow (padded a little so the 3px glyphs are easy to hit)
        FOLLOW_PREV.x = bxL; FOLLOW_PREV.y = boxTop; FOLLOW_PREV.w = 11; FOLLOW_PREV.h = 11;
        FOLLOW_NEXT.x = bxL + bxW - 11; FOLLOW_NEXT.y = boxTop; FOLLOW_NEXT.w = 11; FOLLOW_NEXT.h = 11;
    }

    // #update-nudge — the persistent "a new build is live" pill. Owner call: it lives WHERE THE GAME
    // SAVED BADGE APPEARS (top-right, under the gear) — not bottom-center, which the follow plate owns —
    // and wears the badge family's look (green plate, black text). It steps below the away strip and the
    // typing save badge when either holds that row; yields under full-screen panels like the toasts do.
    UPDATE_NUDGE.w = 0;
    if (_updateReady && booted && !startScreen && !worldMapOpen && !rosterOpen && !chronOpen && !boardOpen && !settingsOpen) {
        const lbl = _updateReloading ? 'SAVING...' : 'NEW BUILD READY';
        const ICON_W = 4;
        const w = textWidth(lbl) + 10 + ICON_W + 3;
        const x = SETTINGS_BTN.x - w + 8;                                       // right-aligned like the save badge
        let y = 21;
        if (AWAY_BAR.w) y = AWAY_BAR.y + AWAY_BAR.h + 2;                        // the away strip owns that row
        if (performance.now() - saveFlashAt < 2400) y = Math.max(y, 33);        // let the save badge type through above
        const hov = inRect(mouse, { x, y, w, h: 11 });
        const pulse = 0.9 + 0.1 * Math.sin(performance.now() / 500);            // a quiet breath, not an alarm
        ctx.save();
        ctx.globalAlpha = hov ? 1 : pulse;
        ctx.fillStyle = hov ? '#a8e890' : '#7dd069'; ctx.fillRect(x, y, w, 11);
        ctx.fillStyle = '#4a8a3c'; ctx.fillRect(x, y + 10, w, 1);               // grounded lower rim, badge-style
        if (hov) { ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fillRect(x, y, w, 1); }   // lit top rim — the button lifts
        drawText(ctx, lbl, x + 5, y + 3, '#0c0e16');
        {   // ► right arrow (owner: the refresh ring didn't read) — the follow plate's cycle-arrow glyph
            const ix = x + 5 + textWidth(lbl) + 3, iy = y + 3;
            ctx.fillStyle = '#0c0e16';
            for (let c = 0; c < 3; c++) ctx.fillRect(ix + c, iy + c, 1, 5 - c * 2);   // tip points right
        }
        ctx.restore();
        UPDATE_NUDGE.x = x; UPDATE_NUDGE.y = y; UPDATE_NUDGE.w = w; UPDATE_NUDGE.h = 11;
        if (hov && !_updateReloading) {
            const tip = 'REFRESH';
            const tw2 = textWidth(tip), tx2 = Math.min(x + w, GW - 4) - (tw2 + 10);   // right-aligned under the pill
            ctx.fillStyle = 'rgba(12,14,22,0.92)'; ctx.fillRect(tx2, y + 13, tw2 + 10, 11);
            ctx.fillStyle = 'rgba(125,208,105,0.6)'; ctx.fillRect(tx2, y + 13, 2, 11);
            drawText(ctx, tip, tx2 + 7, y + 16, '#a8e890');
        }
    }

    // building hover tooltip — only when hovering the world (not over a panel, not dragging,
    // and not while an inventory-slot tooltip is already showing on the open sheet)
    let worldHover = false;
    if (booted && !startScreen && !raidFx && mouse.x >= 0 && !mouse.dragging && !rosterOpen && !boardOpen && !chronOpen && !settingsOpen && !worldMapOpen && mouse.y > 18 &&
        !(selected && inRect(mouse, SHEET_RECT)) && !inRect(mouse, MINIMAP)) {
        // #hover a farmer/foe under the cursor takes priority (it's the moving thing you're tracking), then buildings
        const ent = entityUnder(mouse.x, mouse.y);
        if (ent) { drawInfoBox(mouse.x, mouse.y, ent); worldHover = true; }
        else {
            const info = buildingUnder(mouse.x, mouse.y);
            if (info) { drawInfoBox(mouse.x, mouse.y, info); worldHover = true; }
            else {   // a walking farmer under the cursor is clickable even without a tooltip
                const tile = screenToTile(mouse.x, mouse.y);
                worldHover = world.farmers.some(f => Math.hypot(f.pos.i - tile.i, f.pos.j - tile.j) < 1.6);
            }
        }
    }

    // B4: nudge the player toward a fresh off-screen story beat (drawn above the world, below the cursor)
    updateDramaSpotlight();
    if (booted && !startScreen && !rosterOpen && !chronOpen && !boardOpen) drawDramaCue();
    if (booted && !startScreen && !rosterOpen && !chronOpen && !boardOpen && !worldMapOpen && !settingsOpen) { drawSortie(); drawThreatTell(); }   // #131 / #counteroffensive
    if (!startScreen) { updateCrossing(); drawFogMarkers(); drawCrossHint(); }   // #P2 fog markers + the warn banner + crossing trigger (hidden under the launch menu)

    drawFaceoff();      // #faceoff the post-raid VS card sits above the world/panels (resume card + cursor top it)
    drawResumeCard();   // the "previously on" catch-up card sits above every panel (only the cursor tops it)
    drawMemoryIntro();  // #memory-intro the one-time reveal covers even that — dismissing it uncovers the recap

    // #START the launch menu — over the world/panels, under the cursor. Guarded: a menu-draw glitch must never
    // skip crt.render and black out the whole game (the town behind stays visible); log the first failure only.
    if (startScreen) { try { drawStartScreen(); } catch (e) { if (!_startScreenErr) { _startScreenErr = true; console.error('start screen draw error:', e); } } }

    // custom pixel hand cursor, on top of everything (dragging = pressed/gold too). Codex #69-3: a
    // tap-to-pin keeps mouse.x/y seeded for the tooltip AFTER the finger lifted — hover position and
    // cursor visibility are separate states, so the pin sets mouse.noCursor and the hand stays unpainted.
    if (mouse.x >= 0 && !mouse.noCursor) drawCursor(mouse.x, mouse.y, mouse.dragging || cursorIsHot(worldHover) || startHovering());

    crt.render(t);   // Codex #44 P2 — the CRT does full-color; the old per-season DMG palette feed was inert (removed)
}

// boot / loading screen: the CRT tunes in (heavy static settling to near-black), then a 64-bit pixel
// LOADER bar sweeps while the memories are pulled from SuperMemory, captioned "RETRIEVING MEMORIES".
// #firstframe the art the FIRST FRAME needs — one list, read by both the reveal gate and the boot bar, so the
// bar cannot drift from what is actually being waited on. Deliberately excludes the animated tree sheet,
// portraits, UI and combat sets: those have graceful fallbacks or are not on screen yet.
function firstFrameArtChecks() {
    // crateReady: the LV-0 town silo is a stack of crates in the plaza, visible from the first frame, and
    // drawSiloBarrels falls back to a flat brown box "until the sheet loads" — which is what a first-time
    // visitor was seeing and reasonably read as "the crates are procedural".
    // uiIconsReady: without it the top bar draws its inline-SVG fallbacks and then swaps to the real icons.
    // Codex #62-2 — CULTURE-AWARE. These were all human flags, so a cold orc boot could satisfy every one of
    // them while the orc character sheet, the five orc wilderness sets and the orc silo were still in flight —
    // revealing exactly the bare tiles and stand-ins this gate exists to hide.
    // Shared: the ground detail, the crate stack (both cultures start on one) and the UI icons.
    const checks = [grassDetailsReady, crateReady, uiIconsReady()];
    if (_bootIsOrc) {
        checks.push(orcSpriteReady(), orcTreeArtReady, orcRockyArtReady, orcRockArtReady,
                    orcCactusArtReady, orcBurnedArtReady, orcSiloReady);
    } else {
        checks.push(charReady(), treeArtReady, bushArtReady, rockArtReady, homeReady, guildExtReady);
    }
    // On a plain visit the START SCREEN is the first frame, and its animated title falls back to a font
    // wordmark. Only waited on for that path — an explicit ?seed= boot never shows it.
    if (_startModeBoot) checks.push(isTitleSettled());
    return checks;
}
function firstFrameArtProgress() {
    const c = firstFrameArtChecks();
    return c.filter(Boolean).length / c.length;
}
let _bootFill = 0;
// Mirrors boot()'s `startMode` at module scope: firstFrameArtChecks() runs from drawBootScreen (module level)
// and cannot see a const declared inside boot(). Referencing it there is a ReferenceError that would take the
// boot screen down on every load — parsing does not catch it.
let _startModeBoot = false;
// Which culture's art the first frame needs. Set from the boot flag immediately, then corrected from the
// hydrated world — a resumed orc town has no ?orc= in its URL, so the flag alone would be wrong.
let _bootIsOrc = false;
function drawBootScreen(t) {
    if (bootT0 == null) bootT0 = t;
    const bootTime = t - bootT0;   // #Codex-VS seconds since the first boot frame (RAF clock) — not a per-frame counter, so 30/60/120Hz all pace the same
    // TUNE-IN: heavy CRT snow that settles into a dark screen over the first ~0.6s (the set finding its channel)
    const tune = Math.max(0, 1 - bootTime / 0.6);          // 1 → 0
    const img = ctx.createImageData(GW, GH);
    const amp = 16 + tune * 120;                           // grain fades from heavy static to a faint hiss
    for (let i = 0; i < img.data.length; i += 4) {
        const v = Math.random() * amp;
        img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    ctx.fillStyle = `rgba(8,10,16,${0.9 - tune * 0.5})`;   // wash to near-black; the faint grain still shows through
    ctx.fillRect(0, 0, GW, GH);
    if (bootTime < 0.35) return;                           // let the snow play solo for a beat

    const cx = Math.round(GW / 2), cy = Math.round(GH / 2);

    // ---- 64-bit pixel LOADER: a framed bar of chunky cells with a lit band sweeping L→R (indeterminate) ----
    const CELL = 6, GAPC = 2, N = 16;
    const barW = N * CELL + (N - 1) * GAPC, barH = 10;
    const bx = cx - Math.round(barW / 2), by = cy - 8;
    ctx.fillStyle = '#2a3350'; ctx.fillRect(bx - 3, by - 3, barW + 6, barH + 6);   // bezel
    ctx.fillStyle = '#0c0f18'; ctx.fillRect(bx - 1, by - 1, barW + 2, barH + 2);   // inner well
    // DETERMINATE now: the bar reports how much of the first-frame art has actually landed, so the wait is
    // legible instead of arbitrary — the screen says "IMAGINING LIVES." and the bar shows it meaning it.
    // The sweep is kept as a shimmer riding the filled edge, so a stalled connection still looks alive rather
    // than frozen. `_bootFill` only ever climbs: art readiness is monotonic, and a bar that went backwards
    // would read as an error.
    const filled = Math.max(_bootFill, firstFrameArtProgress() * N);
    _bootFill = filled;
    const head = ((performance.now() / 1000 / 1.5) % 1) * (N + 5) - 3;             // shimmer on the leading edge
    for (let k = 0; k < N; k++) {
        const d = head - k;
        let col = '#141c18';                              // unlit cell
        if (k < filled) col = '#4a8a3c';                  // landed
        if (k < filled && d >= 0 && d < 4) col = d < 1 ? '#c8f0a0' : d < 2 ? '#7dd069' : '#4a8a3c';
        ctx.fillStyle = col;
        ctx.fillRect(bx + k * (CELL + GAPC), by, CELL, barH);
    }

    // ---- caption underneath ----
    // #Codex-VS honest per-source wording: 'offline' = still reaching the store (pending / unreachable);
    // 'invented' = the fetch failed and lives were GENERATED (not retrieved); otherwise a real pull succeeded.
    const label = memorySource === 'invented' ? 'IMAGINING LIVES'
        : memorySource === 'offline' ? 'TUNING IN'
        : 'RETRIEVING MEMORIES';
    const dots = '.'.repeat(1 + (Math.floor(t * 2.5) % 3));
    const lw = textWidth(`${label}...`, 1);               // reserve the widest dot-count so it never jitters
    drawText(ctx, `${label}${dots}`, cx - Math.round(lw / 2), by + barH + 12, '#9aa0b4', 1);
}

// ---------------------------------------------------------------------------
// Start screen (#START) — the launch menu
// ---------------------------------------------------------------------------
// A plain visit boots a live, randomised, NON-persisting town (the spectator backdrop) and paints
// this menu straight INTO the game canvas — so it rides the same CRT shader, pixel font, and panel/
// button styling as everything else (drawn just before crt.render, under the cursor). TWO screens:
//   'title'  — the animated PROPAGATE title, a tagline, a white ▶ START GAME, and a VIEW EXISTING TOWN text-button
//   'choose' — CREATE A HUMAN TOWN / RAISE AN ORC WARBAND, a VIEW A LIVING TOWN text-button, and ‹ BACK
// The title is an animated pixel spritesheet (propagate_grow, white removed → transparent); it falls
// back to the 3x5 font wordmark until the sheet loads. Buttons navigate to the real, persisting game.
// the animated title lives in title-anim.js so the mobile gate can draw it without importing this module
// (see mobile-gate.js). This shim keeps the existing callsites' signature.
function drawTitleArt(cx, topY, maxW) { return drawTitleSheet(ctx, cx, topY, maxW, GW); }

function startHovering() { return !!(startScreen && startHits && Object.values(startHits).some(r => inRect(mouse, r))); }

// right-pointing PLAY triangle of EXACT height h, top-aligned at yTop (so it matches text-cap height).
function drawPlayIcon(x, yTop, h, color) {
    ctx.fillStyle = color;
    const w = Math.max(3, Math.round(h * 0.82));
    for (let c = 0; c < w; c++) {
        const colH = Math.max(1, Math.round(h * (1 - c / w)));
        ctx.fillRect(x + c, Math.round(yTop) + Math.floor((h - colH) / 2), 1, colH);
    }
    return w;   // pixel width consumed
}

// a centred TEXT button (no plate). hotCol is the hover colour (defaults to the gold used elsewhere).
function startTextButton(key, cx, y, label, scale, baseCol, hotCol = '#ffd24a') {
    const tw = textWidth(label, scale), r = { x: Math.round(cx - tw / 2) - 6, y: y - 3, w: tw + 12, h: 5 * scale + 6 };
    const hot = inRect(mouse, r);
    drawText(ctx, label, Math.round(cx - tw / 2), y, hot ? hotCol : baseCol, scale);
    startHits[key] = r;
    return r;
}

// a full tinted-plate button in the game's FOUND-A-TOWN style. Registers its hit rect under `key`.
function startPlateButton(key, bx, y, bw, bh, label, base, fill, fillHot, textCol) {
    const cx = bx + bw / 2, r = { x: bx, y, w: bw, h: bh }, hot = inRect(mouse, r);
    ctx.fillStyle = hot ? fillHot : fill; ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = base; ctx.lineWidth = 1; ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    drawText(ctx, label, Math.round(cx - textWidth(label) / 2), r.y + (bh - 5) / 2, hot ? '#ffffff' : textCol);
    startHits[key] = r;
}

// #START choose-screen WALKERS — a looping, right-facing walk sprite per culture, cropped straight from the
// CraftPix WALK sheets (both 384x256 = 6 cols x 4 rows of 64px cells, side = row 2) so each gets a smooth
// 6-frame gait WITH its baked-in foot shadow. Human: Swordsman lvl1 walk (side faces RIGHT — no mirror).
// Orc: orc1 walk (side faces LEFT → mirrored). The old in-game farmer sprite (2-frame walk) remains only as
// a last-ditch fallback while a sheet loads. Fake farmer objects satisfy the fallback sprite builders.
const MENU_HUMAN = { sheet: { culture: 'human', seed: 77 }, moveDir: 'side', facing: 1, state: 'walk', animTime: 0 };
const MENU_ORC_FB = { sheet: { culture: 'orc', seed: 33 }, moveDir: 'side', facing: 1, state: 'walk', animTime: 0 };
// Crop cells from a 64px sheet → array of frame canvases
// maxCols limits how many columns to extract (default = all columns in the sheet)
function menuWalkFrames(img, sx0, sy0, sw, sh, row, maxCols) {
    if (!img || !img.complete || !img.naturalWidth) return null;
    row = row != null ? row : 2;
    const FW = 64;
    const totalCols = Math.max(1, Math.round(img.naturalWidth / FW));
    const cols = maxCols != null ? Math.min(maxCols, totalCols) : totalCols;
    const frames = [];
    for (let c = 0; c < cols; c++) {
        const [o, ox] = makeCanvas(sw, sh); ox.imageSmoothingEnabled = false;
        ox.drawImage(img, c * FW + sx0, row * FW + sy0, sw, sh, 0, 0, sw, sh);
        frames.push(o);
    }
    return frames;
}
let menuOrcWalk = null;
function menuOrcFrames() {
    if (menuOrcWalk) return menuOrcWalk;
    const walkSrc = orcWalkImg && orcWalkImg[1];
    return (menuOrcWalk = menuWalkFrames(walkSrc, 12, 6, 40, 44, 2));
}
let menuHumanWalk = null;
function menuHumanFrames() {
    if (menuHumanWalk) return menuHumanWalk;
    const walkSrc = menuHumanWalkImg;
    return (menuHumanWalk = menuWalkFrames(walkSrc, 18, 14, 30, 36, 2));
}
// draw a walking `culture` sprite with its FEET centred at (footX, footY), scaled to targetH.
// Loops the walk frames continuously.
function drawMenuWalker(culture, footX, footY, targetH, t) {
    const frames = culture === 'orc' ? menuOrcFrames() : menuHumanFrames();
    if (!frames || !frames.length) {
        // sheet not ready → in-game farmer sprite (2-frame walk) fallback
        const fr = farmerSprites(culture === 'orc' ? MENU_ORC_FB : MENU_HUMAN);
        const frame = Math.floor(t * 7) % 2 ? fr.walk1 : fr.walk2;
        const flip = culture === 'orc';
        const scale = targetH / frame.height, w = Math.round(frame.width * scale), h = Math.round(frame.height * scale);
        const dx = Math.round(footX - w / 2), dy = Math.round(footY - h);
        const sm = ctx.imageSmoothingEnabled; ctx.imageSmoothingEnabled = false;
        if (flip) { ctx.save(); ctx.translate(dx + w, dy); ctx.scale(-1, 1); ctx.drawImage(frame, 0, 0, w, h); ctx.restore(); }
        else ctx.drawImage(frame, dx, dy, w, h);
        ctx.imageSmoothingEnabled = sm;
        return w;
    }
    const frame = frames[Math.floor(t * 6) % frames.length];
    // human walk frames face right, orc walk frames face left
    const flip = culture === 'orc';
    if (!frame || !frame.width) return 0;
    const scale = targetH / frame.height, w = Math.round(frame.width * scale), h = Math.round(frame.height * scale);
    const dx = Math.round(footX - w / 2), dy = Math.round(footY - h);
    const sm = ctx.imageSmoothingEnabled; ctx.imageSmoothingEnabled = false;
    if (flip) { ctx.save(); ctx.translate(dx + w, dy); ctx.scale(-1, 1); ctx.drawImage(frame, 0, 0, w, h); ctx.restore(); }
    else ctx.drawImage(frame, dx, dy, w, h);
    ctx.imageSmoothingEnabled = sm;
    return w;
}

function drawStartScreen() {
    ctx.fillStyle = 'rgba(8,9,14,0.8)'; ctx.fillRect(0, 0, GW, GH);   // the ~80% black veil over the living town
    // deepen the CENTRE into a clean stage for the menu (the living town still breathes at the edges) so the
    // town's own farmers / silo badge / speech bubbles behind the centred content don't clutter it.
    const vg = ctx.createRadialGradient(GW / 2, GH / 2, 0, GW / 2, GH / 2, GH * 0.95);
    vg.addColorStop(0, 'rgba(5,7,10,0.7)'); vg.addColorStop(0.5, 'rgba(5,7,10,0.45)'); vg.addColorStop(1, 'rgba(5,7,10,0)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, GW, GH);
    const cx = GW / 2;
    startHits = {};

    // #START volume button (top-right, pulled in from the CRT-curved corner so it's easy to hit) — the launch
    // pages START MUTED (autoplay policy); click to hear the theme.
    const sndR = { x: GW - 34, y: 10, w: 20, h: 14 };
    if (inRect(mouse, sndR)) { ctx.fillStyle = 'rgba(255,255,255,0.09)'; ctx.fillRect(sndR.x, sndR.y, sndR.w, sndR.h); }
    drawSpeakerIcon(sndR.x + 6, sndR.y + 3, !menuMuted);
    startHits.sound = sndR;

    if (startPage === 'title') {
        const titleBottom = drawTitleArt(cx, GH * 0.13, Math.min(GW - 48, 300));
        // the title frame carries transparent padding below the letters — tuck the tagline up into it so it
        // sits beneath the animation (but not jammed against the vines).
        const tag = 'A world that remembers itself';
        drawText(ctx, tag.toUpperCase(), Math.round(cx - textWidth(tag) / 2), titleBottom - 8, '#9aa0b4');

        // PRIMARY: the gold ▶ with the gently BLINKING arrow. When this browser holds a played town, the
        // primary is CONTINUE — <TOWN> (#continue: a returning player's path back used to be spectate a
        // random town -> world map -> find yours); starting fresh steps down a rung. First visit: START
        // GAME stays primary and the menu reads exactly as it always did.
        const gy = titleBottom + 62, iconH = 10;
        const label = startContinue ? `CONTINUE - ${startContinue.name.toUpperCase()}` : 'START GAME';
        const iconW = Math.max(3, Math.round(iconH * 0.82)), pad = 7, lw = textWidth(label, 2);
        const groupW = iconW + pad + lw, gx = Math.round(cx - groupW / 2);
        const startRect = { x: gx - 8, y: gy - 5, w: groupW + 16, h: iconH + 10 };
        const startHot = inRect(mouse, startRect);
        const blink = 0.2 + 0.8 * (0.5 + 0.5 * Math.sin(performance.now() / 260));   // ~0.2→1.0 pulse, ~1.6s cycle
        const arrowCol = startHot ? '#ffffff' : `rgba(255,210,74,${blink.toFixed(2)})`;
        drawPlayIcon(gx, gy, iconH, arrowCol);                                        // top-aligned with the label
        drawText(ctx, label, gx + iconW + pad, gy, startHot ? '#ffffff' : '#ffd24a', 2);
        startHits[startContinue ? 'continue' : 'start'] = startRect;

        // the rungs beneath: start-fresh (only when CONTINUE took the top slot), then the spectate line —
        // relabelled honestly (#continue): it dismisses to a live RANDOM town, and "view existing town"
        // promised somebody's creation. WATCH A WILD TOWN is what it actually does.
        let ry = gy + iconH + 13;
        if (startContinue) { startTextButton('start', cx, ry, 'START A NEW TOWN', 1, '#ffffff', 'rgba(255,255,255,0.3)'); ry += 18; }
        // #start-icons (owner call): the secondary rungs became ICON buttons — the text stack was
        // outgrowing the menu. Hover names the action in a tooltip beneath; from the 1-bit pack
        // (component-library/index.html): WATCH = START_WATCH_ICON (24), IMPORT = 102 (up from tray).
        // The import CONFIRM stays as words: a destructive confirm has to say what it does.
        if (pendingImport) {
            const warn = pendingImport.occupied ? ' - OLD BATTLE TALES LOST' : '';
            startTextButton('importFile', cx, ry, `GET ${String(pendingImport.town || 'TOWN').toUpperCase().slice(0, 12)} DAY ${pendingImport.day || '?'}${warn} - CONFIRM`, 1, '#f0c860', '#ffd24a');
            ry += 18;
        } else {
            const B = 16, GAP = 6;
            const rowX = Math.round(cx - (B * 2 + GAP) / 2);
            const defs = [
                ['view', START_WATCH_ICON, 'WATCH A WILD TOWN'],
                ['importFile', 102, 'IMPORT A TOWN FILE'],   // owner pick: 102 (up from tray — loading INTO the game) over 101
            ];
            let tip = null;
            defs.forEach(([key, iconN, label], i) => {
                const r = { x: rowX + i * (B + GAP), y: ry - 3, w: B, h: B };
                const hot = inRect(mouse, r);
                ctx.fillStyle = hot ? 'rgba(255,210,74,0.14)' : 'rgba(255,255,255,0.07)';
                ctx.fillRect(r.x, r.y, r.w, r.h);
                ctx.strokeStyle = hot ? '#ffd24a' : 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1;
                ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
                const icon = packEmote(iconN, 10, hot ? '#ffd24a' : '#c8ccd8');
                if (icon) { ctx.imageSmoothingEnabled = false; ctx.drawImage(icon, r.x + 3, r.y + 3); }
                startHits[key] = r;
                if (hot) tip = label;
            });
            ry += B + 2;
            if (tip) drawText(ctx, tip, Math.round(cx - textWidth(tip) / 2), ry, '#9aa0b4');
            ry += 12;
        }
        if (saveportNote && performance.now() < saveportNote.until) {
            drawText(ctx, saveportNote.text, Math.round(cx - textWidth(saveportNote.text) / 2), ry + 2, '#9aa0b4');
        }
        return;
    }

    const heading = 'CHOOSE YOUR PATH', t = performance.now() / 1000;
    const slot = 36, boxH = 38, boxGap = 5, headGap = 18, viewGap = 20, padL = 4, padR = 8;
    const labelHuman = 'CREATE A HUMAN TOWN', labelOrc = 'CREATE AN ORC TOWN';
    const maxLabelW = Math.max(textWidth(labelHuman), textWidth(labelOrc));
    const boxW = padL + slot + 8 + maxLabelW + padR, boxX = Math.round(cx - boxW / 2);
    const blockH = 5 + headGap + boxH + boxGap + boxH + viewGap + 5;
    let y = Math.round(GH / 2 - blockH / 2);

    drawText(ctx, heading, Math.round(cx - textWidth(heading) / 2), y, '#9aa0b4');
    y += 5 + headGap;

    // spriteH matched so the two read at the SAME scale/density (orcs are bigger, so the human is a touch shorter);
    // both are down-scaled from their native sheet frames → crisp, no chunky up-scaling.
    const ctaBox = (key, culture, label, spriteH, stroke, fillHot, textCol) => {
        const r = { x: boxX, y, w: boxW, h: boxH }, hot = inRect(mouse, r);
        ctx.fillStyle = hot ? fillHot : 'rgba(255,255,255,0.05)'; ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
        drawMenuWalker(culture, r.x + padL + slot / 2, r.y + boxH / 2 + spriteH / 2, spriteH, t);
        drawText(ctx, label, r.x + padL + slot + 4, Math.round(r.y + boxH / 2 - 2), hot ? '#ffffff' : textCol, 1);
        startHits[key] = r;
        y += boxH + boxGap;
    };
    ctaBox('human', 'human', labelHuman, 30, '#7dd069', 'rgba(125,208,105,0.30)', '#b6e8a0');   // green — a human town
    ctaBox('orc',   'orc',   labelOrc,   36, '#e0806a', 'rgba(224,128,106,0.30)', '#f0b0a0');    // ember — an orc town

    y += viewGap - boxGap;
    startTextButton('view', cx, y, 'OR WATCH A WILD TOWN', 1, '#ffffff', 'rgba(255,255,255,0.3)');

    // BACK — top-left, aligned with volume button center (y=17)
    startTextButton('back', 34, 17, 'BACK', 1, '#8a8f9c');
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

(async function boot() {
    // MOBILE GATE: the sim is a fullscreen mouse+keyboard experience. CSS shows the
    // desktop-required notice immediately; this guard prevents the game from booting beneath it.
    // Deliberately use input capability rather than viewport size so a narrow desktop still works.
    // Codex #62-1 — MUST mirror the entry chooser in index.html exactly, or the two disagree and one hides the
    // canvas while the other boots (or vice versa). `any-hover`/`any-pointer` exempt hybrids that have a real
    // pointer attached; only a device with no usable pointer at all is turned away.
    const touchOnly = window.matchMedia('(hover: none) and (pointer: coarse) and (any-hover: none) and (any-pointer: coarse)').matches;
    // tablets (>=600px short side) DO boot — landscape play with the CSS rotate prompt in portrait —
    // so only a touch-only device that is also phone-sized is refused here
    const isMobile = touchOnly && Math.min(window.screen.width, window.screen.height) < 600;
    if (isMobile) {
        // index.html routes phones to mobile-gate.js, so this normally never runs. Kept as defence in depth:
        // if main.js is ever loaded on a phone directly, it must still refuse to boot the sim.
        return;
    }

    requestAnimationFrame(frame);
    loadAssetArt();

    // PERSISTENCE (#88): a plain visit RESUMES the last-played town from IndexedDB — the town
    // remembers itself. ?seed=N resumes that seed's save (or founds it fresh if none exists);
    // ?fresh=1 always founds a new town (random seed unless &seed pins it) — the reset hatch
    // and the determinism-test entrance (?fresh=1&seed=42 never loads a save).
    const bootParams = new URLSearchParams(location.search);
    // #postcard shared normalization (Codex #123-3) — queryTown is THE reading of ?seed/?orc, used
    // here and by the server's OG preview, so the preview names exactly the town this boot founds.
    const townQ = queryTown(bootParams);
    // #START the LAUNCH OVERLAY: a plain visit (no ?seed / ?fresh / ?play intent) opens the start
    // screen — three ways in over a LIVE, randomised, NON-PERSISTING town (see world._spectator).
    // The buttons then navigate to the real, persisting experience (?fresh=1 / ?fresh=1&orc=1) or
    // dismiss to spectate. ?play=1 is the "skip the menu, resume my last town" hatch for returning
    // players (plain-visit auto-resume is now gated behind the menu, so the town no longer resumes
    // silently — a menu greets you instead).
    const startMode = !bootParams.has('seed') && !bootParams.has('fresh') && !bootParams.has('play');
    _startModeBoot = startMode;   // the gate reads this from module scope
    const wantFresh = bootParams.get('fresh') != null || startMode;   // the menu's backdrop is always a fresh random town
    const worldSeed = townQ.hasSeed ? townQ.seed : Math.floor(Math.random() * 0x7fffffff);
    // ?play=1 with no ?orc keeps the human default; the menu backdrop is always a calm human town.
    const bootCulture = townQ.culture;   // #3.1 ?orc=1 raises a warband
    // Must come AFTER the const above: a `const` is in its temporal dead zone until initialised, so assigning
    // from it earlier throws "Cannot access 'bootCulture' before initialization" and kills boot entirely.
    // Corrected again once the world is hydrated — a resumed orc town carries no ?orc= in its URL.
    _bootIsOrc = bootCulture === 'orc';

    let resumed = false, quarantined = null;
    // WHY this session may not persist — a specific reason, not a boolean. One flag drove four different
    // causes and told the player the same (wrong) story for three of them: that their town "could not be
    // opened OR moved aside", when in two cases it was never opened and in one we refused on purpose.
    let noPersistReason = null;
    // Codex #56-3 — the seed the replacement town is founded on. A no-seed boot (?play=1) resolves `latest`,
    // so the unreadable snapshot's seed is NOT the random `worldSeed` this boot generated. Founding on the
    // random one left the preserved town under a seed the player was no longer in, which made
    // RYFARMS.peekSave()/restoreSave() — both defaulting to world.seed — unable to find it at all. Found on
    // the SAME seed, matching what an explicit ?seed=N boot already does.
    //
    // Codex #57-1 — the snapshot and its GENERATION are read in ONE transaction (loadTownState). Read
    // separately, a quarantine or restore landing between them pairs a stale high-rev snapshot with the newly
    // bumped generation, which then passes the epoch check and overwrites the replacement — the very thing the
    // epoch exists to stop. A snapshot is only safe to write back under the generation it was READ WITH.
    //
    // Codex #57-3 — this whole resolve now runs BEFORE the cast is generated, because `foundSeed` is what the
    // founders, the lineage and the displayed seed must all key off. Previously generateCrew()/planHeirs() ran
    // on the pre-resolution random `worldSeed`, so a no-seed recovery produced a town whose terrain came from
    // one seed and whose founding cast came from another.
    let foundSeed = worldSeed, foundGen = null;
    // Codex #58 — EVERY persisting world must get its generation from a PAIRED slot observation, so there are
    // exactly three ways in and each establishes the pair:
    //   startMode  — the menu backdrop. Never persists, never touches storage, so it needs no pair at all.
    //   ?fresh=1   — an EXPLICIT claim, and ONLY over an empty slot. If the slot is occupied we navigate to
    //                the resume URL instead: a URL parameter must not retire someone's town, and the fresh
    //                world would arrive at rev 0 against a stored rev N and never save anyway.
    //   otherwise  — resume, or found on an observed-empty slot.
    if (startMode) {
        /* spectator backdrop: no observation, no persistence (see world._spectator below) */
    } else if (wantFresh) {
        const st = await loadTownState(worldSeed);
        if (!st.ok) {
            console.error('ry-farms: could not inspect the slot before founding — running unsaved');
            noPersistReason = 'Storage could not be read, so this session will not be saved — it must not write over a town it cannot see.';
        } else if (st.snap) {
            // Codex #59 — REFUSE, do not wipe. A previous pass had ?fresh retire the occupant through the
            // undoable wipe, which was wrong twice over: a URL parameter is far too weak a thing to destroy a
            // town with, and the "undoable" guarantee is FALSE the second time — the backup is one-deep, so
            // opening the same URL again overwrites the only copy of the town retired the first time. The
            // player-facing way to start over is the NEW TOWN hatch, which asks first.
            // Codex #60-1 — do NOT launch a playable town here. The occupant is safe, but founding an
            // ephemeral replacement means the player plays on while every save is silently discarded, and a
            // log line is far too weak a boundary for that. We READ the occupant successfully, so a safe
            // destination is known: go there. (The unsaved fallback below stays for genuinely unreadable
            // storage, where no safe destination exists.)
            console.error(`ry-farms: ?fresh refused — seed ${worldSeed} already holds a town (day ${st.snap.day ?? '?'}); resuming it instead. Use the NEW TOWN hatch to retire it.`);
            // REPLACE, not assign: assigning leaves the refused ?fresh URL in history, so Back returns to it
            // and it immediately redirects again — a trap between two entries (Codex #61-1).
            // &held=1: the refusal was console-only and read as silent weirdness (it confused the game's own
            // creator within a day of shipping) — the resumed boot shows a toast explaining what happened.
            location.replace('?seed=' + worldSeed + '&held=1');   // reboots into the resume path
            return;
        } else foundGen = st.gen;   // observed EMPTY at this generation — a rev-0 claim is legitimate
    }
    if (!wantFresh && !startMode) {
        const st = await loadTownState(townQ.hasSeed ? worldSeed : undefined);
        const saved = st.snap;
        // Codex #58 — a FAILED OBSERVATION is not an empty slot. If storage could not be read we do not know
        // whether a town is sitting there, so this session must not persist: founding a savable world over a
        // slot we never managed to look at is how a town gets buried. Fail closed, same as a failed quarantine.
        if (!st.ok) {
            console.error('ry-farms: could not inspect the town slot — running unsaved so nothing is overwritten');
            noPersistReason = 'Storage could not be read, so this session will not be saved — it must not write over a town it cannot see.';
        } else if (!saved) {
            foundGen = st.gen;   // observed EMPTY at this generation — that is the pair a rev-0 claim needs
        } else {
            try { world = World.fromSave(saved); resumed = true; foundGen = st.gen; }
            catch (err) {
                // A save this build cannot read is PRESERVED, not buried. Founding a fresh town over it used
                // to destroy a played town on the next autosave — and, because saveTown is a compare-and-set
                // against the stored `_rev`, the fresh session could not save either. Moving it aside keeps
                // the town for a build that can open it AND vacates the slot so this session persists.
                console.warn('ry-farms: save unreadable — preserving it and founding fresh', err);
                const seed = st.seed ?? saved.seed ?? worldSeed;
                // Codex #58 — pass the pair we OBSERVED so the quarantine moves the snapshot that actually
                // failed to hydrate. Another tab can save between the observation and this transaction, and
                // filing away a perfectly good newer town under this failure's reason would be its own bug.
                const q = await quarantineTown(seed, err?.message, { gen: st.gen, rev: saved._rev ?? 0 });
                quarantined = q.rec;
                // Codex #56-2 — only persist if the move actually COMMITTED. A storage failure leaves the
                // unreadable snapshot in place, and founding over it means the rev guard refuses every save
                // for the session anyway; worse, persisting here is how the town would eventually be lost.
                // So on failure this session runs unsaved, deliberately, and says so.
                // Codex #58 — `stale` lands here too: the slot moved under us, so we have not preserved
                // anything and must not write. A reload re-observes and does the right thing.
                if (!q.ok) noPersistReason = q.stale
                    ? 'This town changed while it was being set aside, so this session will not be saved. Reload to pick up whichever town is really there.'
                    : 'A previous town on this seed could not be opened OR set aside, so this session will not be saved — it must not overwrite it.';
                if (q.stale) console.error('ry-farms: the town slot changed while preserving it — running unsaved; reload to re-read it');
                foundSeed = seed;
                foundGen = q.stale ? null : q.gen;
                world = null;
            }
        }
    }
    if (!world) world = new World(foundSeed, bootCulture);
    // The slot's generation this world belongs to. saveTown refuses a writer from a superseded epoch, which
    // is what stops a tab holding the quarantined town from overwriting this replacement.
    // A RESUMED town carries its own culture and may be orc with no ?orc= in the URL, so correct the mirror
    // before the gate can act on the flag alone (Codex #62-2).
    _bootIsOrc = world.culture === 'orc';

    // The pair established above. `?? 0` covers only the paths that deliberately never persist: the spectator
    // backdrop, and any session already marked non-persisting because its observation failed. There is no
    // longer a non-atomic readGen() fallback — Codex #58: every persisting world's generation comes from a
    // paired observation, because a generation read on its own is the shape of the #57-1 bug.
    world._gen = foundGen ?? 0;

    // The cast is grown from a REAL self-hosted SuperMemory corpus if one is reachable, else from INVENTED
    // past lives seeded by THIS world — which is why it has to come after the slot is resolved: on a
    // no-seed recovery the live seed is the quarantined town's, not the random one this boot generated.
    const result = await fetchMemories();
    memories = (result.memories && result.memories.length) ? result.memories : generateCrew(world.seed);
    memorySource = (result.memories && result.memories.length) ? result.source : 'invented';
    // #1.1 (Codex r20 P1) lineage is INDEPENDENT of the source corpus: even a town whose fresh cast is invented
    // (no /v3 corpus, e.g. v0.0.3) still founds heirs of PRIOR towns read back via /v4/search. Key off the
    // lineage array itself, not memorySource. Empty when no store answered at all.
    lineagePool = Array.isArray(result.lineage) ? result.lineage : [];
    // #local-memory — the player's own past towns feed the lineage pool: heirs grow from lives THIS
    // browser remembers, whether or not any server store answered. Merge dedups by real identity
    // (townSeed:farmerSeed) and stable-sorts, so heir pairing stays deterministic for a given store.
    // TIMEOUT-BOUNDED: a pathological IndexedDB open (Safari has locked up before) must not stall
    // the game's boot — 3s and the pool rides the server result alone (the store catches up next boot).
    const _bounded = (p, ms) => Promise.race([p, new Promise(res => setTimeout(() => res(null), ms))]);
    try {
        const lin = await _bounded(localLineage(), 3000);
        if (lin) lineagePool = mergeLineage(lineagePool, lin);
        const n = await _bounded(localLifeCount(), 1000);
        if (n != null) localMemoryCount = n;
    } catch { /* IDB refused (private mode) — the pool rides the server result alone */ }
    // #memory-intro — decided AT BOOT so the reveal precedes the recap outright (owner: sequential
    // modals, not an overlay on an overlay). Existing players only (a resumed town past day 1);
    // memory presence is inevitable by the 6s completion pass, so day>=2 alone gates it.
    try {
        if (!startMode && world && !world._persistenceDisabled && world.day >= 2
            && !localStorage.getItem('ryfarms-memory-intro')) openMemoryIntro();
    } catch { /* private-mode localStorage — skip the reveal */ }
    // #funnel — the two boot-side steps. Neither is once-only: town_created measures the FOUNDING
    // RATE and session_return measures RETURNS, so a once-per-browser flag would erase the very
    // signal each one exists to carry. `startMode` is the title/spectator backdrop, not a played
    // session — counting it would inflate both. Fired here rather than earlier because this is the
    // first point at which the world is hydrated and `resumed` is settled.
    if (!startMode && world) {
        if (resumed) track('session_return', { day: world.day, seed: world.seed });
        // world.culture, NOT _bootIsOrc: a resumed orc town carries no ?orc= in its URL, so the
        // boot flag misreports it (see the correction note at the top of this function).
        else {
            track('town_created', { seed: world.seed, culture: world.culture || 'human' });
            // #postcard — an arrival through a shared link. `!resumed` alone is NOT a one-time
            // founding (Codex #123-1): a fresh town is not durably saved at boot (`lastSavedDay`
            // suppresses the same-day autosave), so reloading the unchanged pc URL founds — and
            // greeted — again, and storage-failure sessions reach here every load. The durable
            // once-marker is localStorage, per seed, stamped at arm (the memory-intro precedent:
            // a crashed tab costs the greeting, accepted). If localStorage itself fails (private
            // mode) the greeting may repeat — accepted over never greeting at all.
            // !noPersistReason (Codex #123 r2): an UNSAVED boot (failed slot observation /
            // quarantine) must not spend the marker — the phantom session would greet, and the
            // genuine durable founding after storage recovers would then arrive in silence.
            if (bootParams.get('pc') != null && !noPersistReason) {
                let pcSeen = false;
                try {
                    const k = 'ryfarms-postcard-' + world.seed;
                    pcSeen = !!localStorage.getItem(k);
                    if (!pcSeen) localStorage.setItem(k, String(Date.now()));
                } catch { /* private mode — may greet again */ }
                if (!pcSeen) {
                    _postcardArrival = true;
                    track('postcard_arrival', { seed: world.seed, culture: world.culture || 'human' });
                }
            }
        }
    }
    // #memory-backfill — seed the store from towns that ALREADY exist, once the session is settled
    // (idle, off the boot path; real playing sessions only — a spectator backdrop stays read-only).
    // Refreshes the caption count and the lineage pool's source-of-truth for the NEXT founding.
    setTimeout(async () => {
        try {
            if (!world || world._persistenceDisabled) return;
            const n = await backfillMemory({ activeWorld: world });
            if (n > 0) {
                localMemoryCount = await localLifeCount();
                console.log(`ry-farms: backfilled ${n} existing town(s) into the browser memory store`);
            }
            // #memory-intro — EXISTING players only (a resumed town past day 1; a first-town founder
            // grows up with the feature), once per browser, and only when there is memory to show.
            if (!localStorage.getItem('ryfarms-memory-intro') && world && !world._persistenceDisabled
                && world.day >= 2 && (localMemoryCount > 0 || n > 0) && !startScreen) {
                openMemoryIntro();
            }
        } catch { /* best-effort — next boot self-heals */ }
    }, 6000);
    // #START the menu backdrop is a SPECTATOR town: it lives and animates but never persists — no
    // autosave, no SuperMemory writeback, no world-index entry, no cross-town raid ambush. Browsing
    // the start screen must leave zero trace (no save slots littered, no junk fed to the memory store).
    // Codex #60 — TWO flags, because they gate different things and conflating them changed gameplay.
    //   _spectator          — this town is scenery: the menu backdrop. Gates ambient/presentation behaviour
    //                         (the sentry camera, the start-screen branch) and `_live`.
    //   _persistenceDisabled — this town must not WRITE: no saves, no world-index publication, no inbox
    //                         acknowledgement, no SuperMemory writeback, no persistent-storage request.
    // A backdrop is both. A session we refused to persist (unreadable storage, a stale quarantine) is
    // persistence-disabled but NOT scenery — it still gets its founding scene and its camera, because those
    // are display, and suppressing them was an accident of reusing one flag.
    // Established HERE, before any storage/inbox/index/writeback setup reads them.
    if (startMode) { world._spectator = true; world._persistenceDisabled = true; }
    // #continue offer the latest-played town on the menu. Same read ?play=1 boots from (loadTownState with
    // no seed follows the 'latest' pointer in one transaction), so the button can never offer a town the
    // resume path would then fail to find. Fire-and-forget: the menu draws without it, the button appears
    // when the read lands; a first-time browser resolves to nothing and the menu is unchanged.
    if (startMode) {
        loadTownState().then(st => {
            if (st && st.ok && st.snap && st.snap.name) startContinue = { name: st.snap.name, day: st.snap.day, seed: st.snap.seed };
        }).catch(() => { /* no offer — the menu simply stays as-is */ });
    }
    if (noPersistReason) world._persistenceDisabled = true;
    // Only a town that actually persists is worth asking the browser to protect. Doing this on the start
    // screen's throwaway backdrop would spend the one permission prompt on a town nobody keeps.
    if (!world._persistenceDisabled) requestPersistentStorage();
    // Say it in the town's own log rather than only the console: a player whose town could not be opened
    // should learn that it was KEPT, not that nothing happened.
    if (quarantined) {
        world.addLog(`A previous town on this seed (day ${quarantined.day ?? '?'}) could not be opened by this version — it has been kept safe, not overwritten.`, '#e8b34a');
        console.warn(`ry-farms: preserved town seed ${quarantined.seed} (day ${quarantined.day}, schema v${quarantined.v}, rev ${quarantined.rev}) at 'unreadable:${quarantined.seed}' — RYFARMS.restoreSave() puts it back`);
    }
    if (noPersistReason) {
        // The flag is set above, before anything reads it; this only tells the player why.
        world.addLog(noPersistReason, '#e07a5a');
    }

    // hook tile changes to terrain redraw
    const origSet = world.set.bind(world);
    world.set = (i, j, t) => { origSet(i, j, t); world._tilesChanged = true; };
    world._tilesChanged = true;

    // #reconciliation: apply any world-layer events queued for this town WHILE IT WAS AWAY (a raid on the
    // frontier that docked its stores, a parley honored/broken) before the resume card is built, so they land
    // in the chronicle + the "PREVIOUSLY ON" recap. Deterministic consume; cleared once applied.
    // #START a spectator backdrop consumes no inbox and joins no world index — it is not a real town.
    // The READ and the ACKNOWLEDGEMENT are gated differently, and conflating them was a regression the flag
    // split introduced: reading the index is not a write, so a session that must not persist should still SEE
    // the world — it just must not consume its inbox, because consuming means acknowledging events it can
    // never durably record. Gating the whole block left a refused town with no world map and no frontier cue.
    try {
        const widx = await loadWorldIndex();
        worldMapIdx = widx;   // #P2 the frontier cue needs the neighbour map from the first frame, not first map-open
        if (!world._persistenceDisabled) {
            const pending = (widx.inbox && widx.inbox[String(world.seed)]) || [];
            if (pending.length) await consumeInbox(world, pending);   // exactly-once (Codex r20/r21)
        }
    } catch (err) { console.warn('ry-farms: inbox consume failed', err); }

    // #108 from here on this town is the WATCHED one: a cross-town raid that ARRIVES during live play stages a
    // visible warband + alarm (see World.#spawnRaid). Set AFTER the on-load inbox consume, so a raid that landed
    // while the town was dormant stays a "PREVIOUSLY ON" line rather than ambushing the player on resume.
    // (Spectator backdrops stay calm — no staged cross-town raid behind the menu.)
    world._live = !world._spectator;

    if (resumed) {
        lastSavedDay = world.day;   // don't immediately re-save what we just loaded
        world.addLog(`Welcome back - day ${world.day}, year ${world.year} (seed ${world.seed})`, '#7dd069');
        resumeCard = {
            day: world.day, season: world.season, year: world.year, shownAt: 0,
            beats: world.chronicle.slice(-5).map(c => ({ text: c.text, color: c.color, day: c.day })),
        };
    } else {
        lastSavedDay = world.day;
        world.addLog(`Propagate — seed ${world.seed}`, '#5a6672');   // the LIVE seed (Codex #57-3)
        // #lineage the roster of towns this world remembers — every OTHER town the index has seen. Set
        // BEFORE the founders spawn so each can be grown "out of" one (their past life sited at a town that
        // truly stood here). Deterministic (the index is persisted); empty on a first world, so nothing changes.
        world.rememberedTowns = Object.values((worldMapIdx && worldMapIdx.towns) || {})
            .filter(t => t && t.name && String(t.seed) !== String(world.seed))
            .map(t => ({ seed: t.seed, name: t.name }))
            .sort((a, b) => String(a.seed).localeCompare(String(b.seed)));   // stable order, index-independent
        const heirPlan = planHeirs(world.seed, 8, lineagePool);   // #1.1 which founders descend from a past town's lives (Codex #57-3: the LIVE seed, not the pre-resolution one)
        for (let i = 0; i < 8; i++) spawnFarmer(heirPlan.get(i) || null);   // start with the full founding eight
        if (world.rememberedTowns.length) world.addLog(`This valley remembers ${world.rememberedTowns.length} town${world.rememberedTowns.length > 1 ? 's' : ''} that came before.`, '#c8b0e0');
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
    const saveOnHide = () => { if (booted && world && !world._retired && !world._persistenceDisabled) saveTown(world); };
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

    // #firstframe — REVEAL WHEN THE ART IS THERE, not on a blind timer.
    //
    // This used to flip `booted` after a flat 1400ms. Measured on a cold visit, the last asset lands at
    // ~3500ms, so the town was revealed with roughly two seconds of art still in flight — and because the
    // world is not drawn at all until `booted` (see the boot-screen branch in frame()), those two seconds were
    // spent watching the game assemble itself: `drawFarmer` falls back to pixel.js's procedural sprites while
    // `charReady()` is false and swaps to the CraftPix ones the moment the sheets land, which reads as farmers
    // FLASHING in and out and walking on a slower, simpler cycle. First impressions are mostly first visits,
    // so the tuning screen — which exists precisely to cover this — now holds until the art is in.
    //
    // FLOOR so the screen still breathes rather than blinking past. CEILING so a slow connection or a dead
    // asset can never hang the boot: at that point we reveal anyway and the old fallback behaviour applies,
    // which is no worse than before. Only the art that defines the FIRST frame is waited on — the animated
    // tree sheet, portraits, UI and combat sets are deliberately excluded, since they either have a graceful
    // static fallback or are not on screen yet.
    const REVEAL_FLOOR_MS = 1400, REVEAL_CEILING_MS = 5000;
    const firstFrameArtReady = () => firstFrameArtChecks().every(Boolean);
    const revealStart = performance.now();
    const reveal = () => {
        booted = true;
        if (startMode) { startScreen = true; audio.setMenuMode(true); audio.setMuted(true); }
    };
    (function waitForFirstFrameArt() {
        const waited = performance.now() - revealStart;
        if (waited >= REVEAL_CEILING_MS) {
            console.warn(`ry-farms: revealing at the ${REVEAL_CEILING_MS}ms ceiling with art still loading — sprites may pop in`);
            return reveal();
        }
        if (waited >= REVEAL_FLOOR_MS && firstFrameArtReady()) return reveal();
        setTimeout(waitForFirstFrameArt, 80);
    })();

    // the LLM chronicler (#92 stage 2): once the town is up, offer the cast's draft tales
    // for a finer telling. One try shortly after boot; the slow recheck catches farmers
    // whose stories only reach composer-generation at the next dawn (older saves migrating)
    // and any later arrivals. Display-only, save-carried, fails silent to procedural text.
    // Returns how many tales landed, so the adaptive schedule below can tell "still working through
    // the cast" from "nothing left to do". A hidden tab returns 0 and simply retries on the slow
    // tick — it must not count as finished, or a backgrounded game would stop enriching forever.
    const tryEnrich = async () => {
        if (document.hidden || (world && world._persistenceDisabled)) return 0;   // #101 enrichment rides the save
        const w = world;
        // #dm-batch1 (Codex #105 P1-2) — the farmer whose sheet is OPEN jumps the queue. Without
        // this, "the budget follows the player's attention" was a claim the code did not implement:
        // enrichment simply walked the cast in seed order whether anyone was looking or not.
        const openSeed = (selected && selected.sheet && typeof selected.sheet.seed === 'number')
            ? selected.sheet.seed : null;
        const applied = await enrichStories(w, () => world === w, openSeed);
        if (applied) saveTown(w);
        return applied;
    };
    // #dm-batch1 — enrichment now writes ONE tale per pass (see dm.js), so the cadence has to be
    // fast enough to work through a founding cast without being a burst. Eight farmers on the old
    // 5-minute timer would take 40 minutes; at 30s it is under five, and one call is ~350 tokens in
    // / 260 out against a 6k-per-minute ceiling, so it never crowds a whisper.
    // Once the cast is done, enrichStories returns 0 immediately and we drop back to the slow tick
    // that catches later arrivals (heirs, newcomers).
    // 60s, not 30s (Codex #105 P1-2): at 30s this reserved two DM budgets a minute on top of every
    // other endpoint, and the provider quota is shared across ALL concurrent visitors on one server
    // key. One 800-token reservation a minute leaves the rest of the 6k for the game.
    const ENRICH_BUSY_MS = 60 * 1000, ENRICH_IDLE_MS = 5 * 60 * 1000;
    let enrichTimer = null;
    const scheduleEnrich = (ms) => {
        clearTimeout(enrichTimer);
        enrichTimer = setTimeout(async () => {
            const applied = await tryEnrich();
            scheduleEnrich(applied ? ENRICH_BUSY_MS : ENRICH_IDLE_MS);
        }, ms);
    };
    scheduleEnrich(5000);

    // #132b the DAY-1 FOUNDING CONVERSATION: on a fresh town's opening congregation, ask the LLM to write the
    // founders' opening exchange (bespoke, natural, per-founder). Kicked NOW so it can land while they gather;
    // until it does (or if it never does) the sim director's authored pools carry the scene. Display-only.
    if (!resumed && !world._spectator && world.congregating && world.congregating()) requestCongregation(world);

    // #91 memory writeback: persist each farmer's compiled life (creeds + beliefs + episodic) back to
    // self-hosted SuperMemory. Off the sim loop, best-effort, save-carried stamp. Slower cadence than
    // enrichment so a life is captured with a little history (beliefs form over days); no-ops offline.
    const tryPersist = async () => {
        if (document.hidden || (world && world._persistenceDisabled)) return;   // #101 STALE-TAB GUARD: no writeback
        const w = world;               // writeback while the tab is hidden OR while a spectator backdrop is up (feeds SuperMemory's paid extraction otherwise)
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
        // #ntsc live CRT controls — A/B the NTSC look vs the classic, and dial each stage 0..1.
        //   RYFARMS.crt.toggle()            → flip ntsc <-> classic
        //   RYFARMS.crt.set('ntsc', 0.7)    → keys: ntsc, scan, mask, glow, aberr, vig
        //   RYFARMS.crt.get() / .reset() / .mode('classic')
        crt: { toggle: () => crt.toggle(), mode: (m) => crt.setMode(m), set: (k, v) => crt.set(k, v), get: () => crt.get(), reset: () => crt.reset() },
        updateNudge: () => { _updateReady = true; },   // QA: raise the new-build pill without a real deploy
        // #funnel QA: re-arm every once-only step so the funnel can be walked again on a live
        // browser. Returns how many ledger keys were cleared.
        resetFunnel: () => resetFunnel(),
        select: (i) => { selected = world.farmers[i] || null; },
        // #whisperdiag — client-side record of every whisper stage (llm vs offline, and WHY it fell
        // back). RYFARMS.whisperLog() to read · .copy() for a pasteable dump · .clear() to reset.
        // Exists because the server telemetry cannot see a client-side failure: a timeout, an abort
        // and a fallback:true body all died in the same silent catch.
        whisperLog,
        watchIcon: (n) => { START_WATCH_ICON = n; },   // #start-icons side-by-side picker
        // #inspiration QA — force the selected (else first-seeded) farmer's strongest seed RIPE:
        // age backdated past GERM_MIN_AGE, weight maxed, pressure cleared — sprout-eligible at the
        // very next dawn (still subject to the roll/budget, which is the honest part to watch).
        ripen: () => {
            const f = (selected && selected.sheet.conscience?.seeds) ? selected
                : world.farmers.find(x => x.sheet.conscience?.seeds && Object.keys(x.sheet.conscience.seeds).length);
            if (!f) return 'no seeded farmer - whisper something a farmer QUESTIONs first (look for the * reply)';
            const c = f.sheet.conscience;
            let bk = null;
            for (const k of Object.keys(c.seeds)) if (!bk || c.seeds[k].w > c.seeds[bk].w) bk = k;
            const s = c.seeds[bk];
            s.firstDay = Math.min(s.firstDay, world.day - 2); s.w = 3; delete s.sprouted; delete c.pressure[bk];
            return `ripe: ${f.sheet.name.split(' ')[0]} / ${bk}${s.phrase ? ` ("${s.phrase}")` : ''} - watch the next dawn`;
        },
        // #whisper-fx live pickers — RYFARMS.keySound('bubble'|'thock'|'terminal'|'soft'|'off'),
        // RYFARMS.voiceSound('classic'|'babble'|'hum'|'off'). No arg reads the current pick. Persisted.
        keySound: (id) => { if (id === 'off' || KEY_VARIANTS.some(v => v.id === id)) { whisperKeyFx = id; try { localStorage.setItem('ryf.keyfx', id); } catch { /* private mode */ } } return whisperKeyFx; },
        voiceSound: (id) => { if (id === 'off' || VOICE_VARIANTS.some(v => v.id === id)) { whisperVoiceFx = id; try { localStorage.setItem('ryf.voicefx', id); } catch { /* private mode */ } } return whisperVoiceFx; },
        speed: (mult) => { world._speedMult = mult; },
        // #98 fire a test Moment: RYFARMS.moment() spotlights farmer 0 finding a star-crystal (with its memory why)
        momentMs: (ms) => { MOMENT_MS = ms; },   // hold a Moment open for QA/screenshots
        calloutMs: (ms) => { CALLOUT_MS = ms; },  // hold callout toasts open for QA
        callout: (txt = 'Rover invented the Emberwarm Poultice.', tone = 'triumph') => world.addChronicle('discovery', txt, world.farmers[0], null, '#ffd24a', { tier: 'callout', tone }),
        moment: (i = 0, kind = 'crystal') => { const f = world.farmers[i]; if (!f) return; world.addChronicle('find',
            `${f.sheet.name.split(' ')[0]} found a ${RARE_NAME[kind] || kind} in the deep wilds.`, f, null, '#8fd8ff',
            { tier: 'grand', tone: 'triumph', why: world.whyRareFind(f, kind), icon: 'rare:' + kind }); },
        animalRow: (n) => { ANIMAL_SIDE_ROW = n; },
        // #raidfx QA: TELEGRAPH a raid now (#131 — word arrives, the warband masses; the alarm + muster + blow
        // follow across the lead window). Advance with runSteps, or fast-forward with raidDetect()/raidLand().
        // #nemesis STABLE pairKey ('dbg-war') so repeat calls advance ONE named arc, exactly like a real
        // neighbour's raids do — the second call debuts the named return. The id is minted UNIQUE (seed +
        // ordinal + wall-clock) and the ordinal continues from the save's own watermark: the exactly-once
        // inbox ledger rides the save, so a session-reset counter ('dbg-raid-1' again) was silently deduped
        // as a stale re-delivery and the raid never fired (player report). Returns a status line, not undefined.
        raid: (commit = 0.28) => {
            world._live = true;
            const ord = (((world._inboxWatermark || {})['dbg-war']) || 0) + 1;
            const id = `dbg-raid-${world.seed}-${ord}-${Date.now().toString(36)}`;
            world.applyInbox([{ id, kind: 'raided', day: world.day, pairKey: 'dbg-war', ordinal: ord, commit, by: 'the Ashfang clan' }]);
            return world.pendingRaid
                ? `raid ${ord} telegraphed from the ${world.pendingRaid.dirName} — lands in ~${Math.round(world.pendingRaid.landsAt - world.time)}s` +
                  (world.pendingRaid.e && world.pendingRaid.e.foe ? ` — ${world.pendingRaid.e.foe.name} RETURNS` : '')
                : 'raid did not stage — check RYFARMS.pendingRaid / an active rehearsal';
        },
        // #demo the 90-second-window variant (Kimi: "demo arithmetic doesn't close" at 45s of telegraph):
        // a REAL canon raid with a compressed clock — marquee immediately, alarm at ~4s,
        // the blow at ~14s. Same raid in every other respect.
        demoRaid: (commit = 0.5) => {
            const msg = RYFARMS.raid(commit);
            const pr = world.pendingRaid;
            if (pr) { pr.detectAt = world.time + 4; pr.landsAt = world.time + 14; }
            return msg + ' (demo clock: alarm ~4s, lands ~14s)';
        },
        get pendingRaid() { return world.pendingRaid; },                                   // #131 inspect a telegraphed raid
        raidDetect: () => { const pr = world.pendingRaid; if (pr) world.time = pr.detectAt; return world.pendingRaid; },  // #131 jump to the sentry's alarm
        raidLand: () => { const pr = world.pendingRaid; if (pr) world.time = pr.landsAt; return world.pendingRaid; },     // #131 fast-forward to the blow
        // #P2 QA: force a crossing to a known neighbour (bearing optional — defaults to its real world-plane
        // bearing when it's in the index). RYFARMS.neighbors() lists who's reachable from here.
        neighbors: () => crossNeighbors(),
        cross: (seed, ang) => {
            const n = crossNeighbors().find(x => String(x.seed) === String(seed >>> 0));
            const t = worldMapIdx && worldMapIdx.towns && worldMapIdx.towns[String(seed >>> 0)];
            crossFx = { t: 0, phase: 'out', seed: seed >>> 0, ang: ang != null ? ang : (n ? n.ang : 0), name: (n && n.name) || (t && t.name) || String(seed) };
            return crossFx.name;
        },
        // #admin the director's booth (same as the settings panel): GHOST rehearsals — full show, zero record
        admin: {
            raid: () => world.startRaidRehearsal((performance.now() * 31) >>> 0 || 1, adminFoeName()),
            election: () => world.startElectionRehearsal((performance.now() * 31) >>> 0 || 1),
            sortie: (target) => world.startSortieRehearsal((performance.now() * 31) >>> 0 || 1, target || null),   // #counteroffensive
            cancel: () => world.cancelRehearsal(),
            get active() { return world.rehearsal; },
        },
        // #counteroffensive PHASE 1 (debug) — prime an eligible war of grievance so the NEXT day rollover CALLS the
        // failable town vote, and the one after TALLIES it. After arm(), let two days pass (RYFARMS.speed high helps).
        counter: {
            arm: (name = 'Gorehowl the Cruel', raidCount = 3) => {
                const w = world, hero = w.farmers.find(f => !f.downed && f.health !== 'sick') || w.farmers[0];
                if (!hero) return 'no able hero in town';
                w.nemesis = { pairKey: 'orc:debug', name, raidCount, sworeAgainst: hero.sheet.seed, lastOutcome: 'escaped', ended: false };
                w.learned = 'defense'; w.grievance = 1.8; w.counterCooldownUntil = 0; w.counterVote = null; w.counterAuthorized = null;
                return `armed: ${name} (raid ${raidCount}), sworn against ${hero.sheet.name.split(' ')[0]} — let ~2 days pass (the vote is called, then tallied)`;
            },
            status: () => ({ grievance: +(world.grievance || 0).toFixed(2), vote: world.counterVote, authorized: world.counterAuthorized,
                             cooldownUntil: world.counterCooldownUntil, learned: world.learned,
                             nemesis: world.nemesis && { name: world.nemesis.name, raidCount: world.nemesis.raidCount, escaped: world.nemesis.lastOutcome === 'escaped' } }),
        },
        // deterministic stepping for reproducibility tests: N uniform FIXED_DT sim ticks
        runSteps: (n) => { for (let k = 0; k < n; k++) world.tick(FIXED_DT); },
        rehearsalDebug: () => ({ had: _hadRehearsal, reh: !!(world && world.rehearsal), snap: !!(world && world._rehearsalSnapshot), speed: world && world._speedMult }),   // #Codex67-1 watcher visibility
        FIXED_DT,
        // QA: open the town chronicle straight to a tab (0 NEWS / 1 RECIPES / 2 TALES)
        openChron: (tab = 0) => { rosterOpen = boardOpen = worldMapOpen = settingsOpen = false; disarmImport(); chronOpen = true; chronTab = tab; chronScroll = 0; },
        // QA: open the Roster straight to a tab (0 PLAYER STATS / 1 ROLES)
        openRoster: (tab = 0) => { chronOpen = boardOpen = worldMapOpen = settingsOpen = false; rosterOpen = true; rosterTab = tab; rosterScroll = 0; },
        // center the camera on a tile (uses the REAL internal resolution — external camera
        // math can only guess GW/GH from the window aspect and lands wide of the mark)
        goTo: (i, j) => { cam.x = GW / 2 - isoX(i, j); cam.y = GH / 2 - isoY(i, j); },
        get GW() { return GW; }, get GH() { return GH; },
        get mouse() { return { x: mouse.x, y: mouse.y, drag: mouse.dragging }; },
        buildingUnder: (x, y) => buildingUnder(x ?? mouse.x, y ?? mouse.y),
        resumed,                                             // did this boot hydrate a save?
        saveNow: () => saveTown(world),                      // force an autosave (returns the saved day)
        // A town this build could not open is preserved at 'unreadable:<seed>' rather than overwritten.
        // peekSave() reports whether one is waiting; restoreSave() puts it back in the live slot — which
        // OVERWRITES whatever has been played since, so it is deliberately manual and never automatic.
        peekSave: (seed = world.seed) => peekQuarantined(seed),
        restoreSave: async (seed = world.seed) => {
            const day = await restoreQuarantined(seed);
            console.log(day ? `restored the preserved town (day ${day}) — reload to open it` : 'no preserved town for this seed');
            return day;
        },
        wipeSave: () => { world._retired = true; return wipeTown(world.seed); },   // retire this town's slot to backup (no reload; late saves refused)
        undoWipe: () => undoWipe().then(seed => {            // resurrect the last wiped town + resume it
            if (seed == null) { console.log('no wiped town to restore'); return null; }
            location.href = location.pathname + '?seed=' + seed; return seed;
        }),
        dismissCard: () => { resumeCard = null; },
        // #faceoff (debug) force the pre-battle VS card with a chosen foe name / war context, no raid needed
        demoFaceoff: (name = 'Krul the Howler', raidCount = 4, escaped = true, swornName = null) => {
            faceoffSeenEvent = world && world.raidEvent;
            faceoff = { at: performance.now(), name: String(name).toUpperCase(), raidCount: raidCount | 0, escaped: !!escaped, swornName,
                        raiders: 6, clan: 'THE ASHFANG CLAN', defenders: world ? world.farmers.filter(x => !x.downed && x.health !== 'sick').length : 8 };
            return `faceoff card: ${name}`;
        },
        enrich: tryEnrich,                                   // ask the LLM chronicler now (debug)
        NEW_BTN,                                             // (debug) reset-hatch hitbox, for UI tests
    };
})();
