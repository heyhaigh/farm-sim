// main.js — Ry Farms: rendering, camera, input, UI, boot.

import { fetchMemories, mod, fmtMod, STAT_NAMES, TRAIT_NAMES, TRAIT_LABELS } from './dna.js';
import { World, GRID, T, DAY_LENGTH, NIGHT_LENGTH } from './farm.js';
import {
    TILE_W, TILE_H, makeCanvas, drawText, textWidth,
    makeFarmerSprites, makeCropSprites, makeHouse, makeWell, makeSign, makeFencePost,
    makeScaffold, makeToolshed, makeWindmill, makeTower, makeLantern,
    makeLilyPad, makeFish, makeChicken, makeCow, makePig, makeGoat, makeCoop, makeBarn, makeTrough,
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

// ---------------------------------------------------------------------------
// Terrain pre-render (redrawn only when tiles change)
// ---------------------------------------------------------------------------

const TERRAIN_OX = (GRID * TILE_W) / 2;
const [terrain, tctx] = makeCanvas(GRID * TILE_W + TILE_W, GRID * TILE_H + TILE_H);
let terrainDirty = true;

const PATH_C = '#8a7a58';

function redrawTerrain() {
    const season = world.seasonDef;
    const [GRASS_A, GRASS_B] = season.ground;
    const TILLED_C = season.tilled;
    const winter = season.name === 'WINTER';
    tctx.fillStyle = '#2a3438';
    tctx.fillRect(0, 0, terrain.width, terrain.height);
    for (let j = 0; j < GRID; j++) {
        for (let i = 0; i < GRID; i++) {
            const t = world.get(i, j);
            const sx = TERRAIN_OX + isoX(i, j) - TILE_W / 2;
            const sy = isoY(i, j);
            let col = (i + j) % 2 ? GRASS_A : GRASS_B;
            if (t === T.TILLED) col = TILLED_C;
            if (t === T.PATH) col = PATH_C;
            if (t === T.HOUSE) col = '#5a5044';
            if (t === T.WATER) col = winter ? '#5a7590' : ((i + j) % 2 ? '#2a5a72' : '#26506a');
            if (t === T.COOP || t === T.BARN) col = '#6a5a44';   // packed earth under the building
            fillDiamond(tctx, sx, sy, col);
            if (t === T.WATER) {
                // still-water highlight ripples
                tctx.fillStyle = winter ? '#8aa8c0' : '#3a6e86';
                tctx.fillRect(sx + 5 + ((i * 5 + j) % 6), sy + 3 + ((i + j) % 3), 2, 1);
            } else if (t === T.TILLED) {
                tctx.fillStyle = winter ? '#b8c0c8' : '#584028';
                tctx.fillRect(sx + 6, sy + 4, 8, 1);
                tctx.fillRect(sx + 6, sy + 6, 8, 1);
            } else if (t === T.GRASS && (i * 7 + j * 13) % 5 === 0) {
                // seasonal ground speckle: flowers in spring, snow in winter, etc.
                tctx.fillStyle = winter ? '#e8eef4'
                    : season.name === 'FALL' ? '#b8863c'
                    : season.name === 'SUMMER' ? '#6fa048' : '#e8709a';
                tctx.fillRect(sx + 6 + ((i * 3 + j) % 8), sy + 3 + ((i + j * 5) % 4), 1, 1);
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

function collectDrawables() {
    const list = [];

    // fences
    for (const plot of world.plots) {
        for (let i = plot.x; i <= plot.x + plot.w; i += 1) {
            list.push(post(i, plot.y));
            list.push(post(i, plot.y + plot.h));
        }
        for (let j = plot.y + 1; j < plot.y + plot.h; j++) {
            list.push(post(plot.x, j));
            list.push(post(plot.x + plot.w, j));
        }
    }
    function post(i, j) {
        const sx = cam.x + isoX(i, j), sy = cam.y + isoY(i, j);
        return { y: sy, draw: () => ctx.drawImage(fencePost, Math.floor(sx - 2), Math.floor(sy - 8)) };
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
                ctx.drawImage(spr, Math.floor(sx - 17), Math.floor(sy - 22));
                // lit windows when someone is home at night
                if (night && (indoors || true)) {
                    ctx.fillStyle = indoors ? '#f0d060' : 'rgba(240,208,96,0.35)';
                    ctx.fillRect(Math.floor(sx - 17) + 7, Math.floor(sy - 22) + 17, 4, 4);
                    ctx.fillRect(Math.floor(sx - 17) + 23, Math.floor(sy - 22) + 17, 4, 4);
                }
                // indoor status floating over the roof
                const roofX = Math.floor(sx), roofY = Math.floor(sy - 30);
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
        const sprites = makeCropSprites(crop.type);
        const spr = crop.withered ? sprites[4] : sprites[crop.stage];
        list.push({
            y: sy + TILE_H * 0.5, draw: () => {
                if (crop.water > 0.45 && !crop.withered) {
                    fillDiamondAlpha(sx - TILE_W / 2 + TILE_W / 2 - 10, sy, 'rgba(40,28,16,0.5)');
                }
                ctx.drawImage(spr, Math.floor(sx + TILE_W / 2 - 6 - 10), Math.floor(sy + TILE_H / 2 - 12));
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
    } else if (f.state === 'work' || f.state === 'build') {
        frame = Math.floor(f.animTime * 5) % 2 ? frames.work : frames.idle;
    } else if (f.state === 'sleep') {
        frame = frames.sleep;
    }

    const px = Math.floor(sx - 6);
    const py = Math.floor(sy + TILE_H / 2 - 15);

    // lantern glow for anyone up and about at night
    const awakeAtNight = world.isNight() && f.state !== 'sleep' && f.state !== 'shelter';
    if (awakeAtNight) {
        const flick = 0.5 + 0.12 * Math.sin(f.animTime * 9);
        const g = ctx.createRadialGradient(sx, py + 7, 2, sx, py + 7, 20);
        g.addColorStop(0, `rgba(245,215,90,${0.45 * flick})`);
        g.addColorStop(1, 'rgba(245,215,90,0)');
        ctx.fillStyle = g;
        ctx.fillRect(sx - 20, py - 13, 40, 40);
    }

    // tiny shadow
    ctx.fillStyle = 'rgba(10,14,10,0.35)';
    ctx.fillRect(px + 2, py + 14, 8, 2);

    if (f.facing < 0) {
        ctx.save();
        ctx.translate(px + 12, py);
        ctx.scale(-1, 1);
        ctx.drawImage(frame, 0, 0);
        ctx.restore();
    } else {
        ctx.drawImage(frame, px, py);
    }

    // sick tint overlay
    if (f.health === 'sick' && f.state !== 'sleep') {
        ctx.fillStyle = 'rgba(120,200,120,0.28)';
        ctx.fillRect(px + 2, py + 3, 8, 8);
    }

    // carried lantern when working at night
    if (awakeAtNight && (f.state === 'work' || f.state === 'walk' || f.state === 'build')) {
        ctx.drawImage(lanternSprite, px + (f.facing < 0 ? -3 : 11), py + 6);
    }

    // carrying water indicator
    if (f.carryWater > 0 && f.state !== 'sleep') {
        ctx.fillStyle = '#5a8ac8';
        ctx.fillRect(px + (f.facing < 0 ? -2 : 12), py + 8, 2, 3);
    }

    // work progress pips
    if (f.state === 'work' && f.action) {
        const p = 1 - f.action.timer / f.action.total;
        ctx.fillStyle = '#20222c';
        ctx.fillRect(px, py - 4, 12, 2);
        ctx.fillStyle = '#7dd069';
        ctx.fillRect(px, py - 4, Math.floor(12 * p), 2);
    }

    // status icon: sick (+) or worn out (~) while out and about, unless a bubble shows
    if (!f.bubble) {
        if (f.health === 'sick') {
            const bob = Math.floor(Math.sin(performance.now() / 400) * 1);
            drawText(ctx, '+', px + 4, py - 8 + bob, '#c05840');
        } else if (f.tired) {
            drawText(ctx, '~', px + 4, py - 7, '#e0a03c');
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
    else if (selected) drawSheet(selected);
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
    const PH = 222 + (memLines.length + thinkLines.length + creedLines.length) * 7;

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
    drawText(ctx, `YIELD:${s.harvested} BONDS:${world.bondCount(f)} REP:${rep}`, PX + 5, y, '#e8c860'); y += 8;
    const helping = f.helpTask ? ` ${f.helpTask.requester.sheet.name.split(' ')[0]}` : '';
    const actWord = f.action ? (ACT_WORD[f.action.task?.act] || f.action.task?.act || 'working') : '';
    const doing = f.state === 'work' ? actWord + helping
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
    mouse.panStart = rosterOpen ? null : { x: p.x, y: p.y, camX: cam.x, camY: cam.y };
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
    const m = pool[Math.floor(Math.random() * pool.length)];
    usedMemoryIds.add(m.id);
    return m;
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
    drawables.sort((a, b) => a.y - b.y);
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
    };
})();
