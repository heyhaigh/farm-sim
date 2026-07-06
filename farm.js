// farm.js — the Ry Farms simulation.
//
// V2: farmers are agents with personalities (collaboration / competitiveness /
// honesty / diligence) that shape WHO they help, whether they cheat, and WHEN
// they sleep, plus an energy + health economy (overwork -> illness).
//
// V3: farms diversify as they grow. Beyond crop rows a farmer can add
// FACILITIES — a water garden (lily pads + fish), a chicken coop (eggs), or a
// livestock pen (milk) — each with its own "producers" the farmer tends and
// collects from. Which facility comes first reflects the farmer's archetype.

import { mulberry32, mod, growFarmer } from './dna.js';

export const GRID = 110;
export const CENTER = GRID / 2;
const FOREST_BORDER = 5;   // keep trees this many tiles off the map edge
const ISO_HALF_W = 10;     // mirrors TILE_W / 2 without importing renderer code
const ISO_HALF_H = 5;      // mirrors TILE_H / 2 without importing renderer code

export const T = { GRASS: 0, PATH: 1, TILLED: 2, HOUSE: 3, WELL: 4, SIGN: 5, STRUCT: 6, WATER: 7, COOP: 8, BARN: 9, TREE: 10, STUMP: 11, WHEAT: 12, FLOWER: 13, ROCK: 14 };
export const FORAGE_TILES = [T.WHEAT, T.FLOWER];
export const FORAGE_NAME = { [T.WHEAT]: 'wild wheat', [T.FLOWER]: 'wildflowers' };

// wood economy
const WOOD_TREE = 3;       // wood from felling a tree
const WOOD_STUMP = 1;      // wood from grubbing out the stump
const ORE_ROCK = 2;        // iron ore from breaking a rock
const FACILITY_WOOD = 6;   // wood to raise a facility
const FENCE_WOOD = 8;      // wood to fence the new homestead
// Tiered dwellings. L1 (tipi) is quick; L2 (yurt) is a real investment; L3 (cottage) is the
// lifetime goal — the harvest gate (lifetime crops, NOT spent) makes L2->L3 take a year+.
const HOUSE_TIERS = [
    null,
    { wood: 10, ore: 2, harvested: 0, name: 'tipi' },        // L1
    { wood: 28, ore: 10, harvested: 40, name: 'yurt' },      // L2
    { wood: 70, ore: 28, harvested: 220, name: 'cottage' },  // L3 — the ultimate home
];
const START_WOOD = 4;

// Longer days so the world breathes slowly while the (now faster) farmers bustle.
export const DAY_LENGTH = 300;
export const NIGHT_LENGTH = 80;

const WEATHER_STATES = {
    sun: { label: 'SUNNY', next: { sun: 2, cloud: 3, drought: 0.6 }, dur: [26, 54] },
    cloud: { label: 'CLOUDY', next: { sun: 2, rain: 3, storm: 0.8 }, dur: [16, 34] },
    rain: { label: 'RAIN', next: { cloud: 2, sun: 1, storm: 1 }, dur: [16, 36] },
    storm: { label: 'STORM!', next: { rain: 2, cloud: 2 }, dur: [12, 22] },
    drought: { label: 'DROUGHT', next: { sun: 1.5, cloud: 1 }, dur: [22, 40] },
};

// Each season also carries a `dmg` 4-shade Game Boy palette (darkest -> lightest)
// that the CRT shader quantizes the whole scene into.
export const SEASONS = [
    { name: 'SPRING', growth: 1.15, waterMul: 1.0, ground: ['#6e8f4d', '#658447'], tilled: '#6a4c30', accent: '#7dd069',
      dmg: ['#0f2110', '#35602f', '#84a52c', '#e2f2b0'],
      weather: { sun: 3, cloud: 3, rain: 3, storm: 1, drought: 0.3 } },
    { name: 'SUMMER', growth: 1.3, waterMul: 1.5, ground: ['#5f8a38', '#578235'], tilled: '#6e4e2e', accent: '#f0d060',
      dmg: ['#12240c', '#3a6a22', '#9ab52e', '#eef8bc'],
      weather: { sun: 5, cloud: 2, rain: 1.5, storm: 1.5, drought: 2.5 } },
    { name: 'FALL', growth: 0.8, waterMul: 0.8, ground: ['#8a7038', '#7c6634'], tilled: '#5e4228', accent: '#e0803c',
      dmg: ['#201606', '#5c451c', '#b48a2c', '#f2e2a0'],
      weather: { sun: 3, cloud: 4, rain: 3, storm: 1.5, drought: 0.5 } },
    { name: 'WINTER', growth: 0.4, waterMul: 0.4, ground: ['#c6ced6', '#bac2ca'], tilled: '#8a7a68', accent: '#a8c8e8',
      dmg: ['#101c22', '#385158', '#82a0a6', '#e6f2f2'],
      weather: { sun: 2, cloud: 4, rain: 1, storm: 2, drought: 0 } },
];
export const SEASON_LENGTH = 15;

// producer tuning per kind
export const PROD = {
    pad:     { rate: 0.020, feedDecay: 0.006, yieldLo: 1, yieldHi: 2, collectT: 2.2, feedT: 1.8, wander: false },
    fish:    { rate: 0.016, feedDecay: 0.008, yieldLo: 1, yieldHi: 3, collectT: 2.4, feedT: 1.6, wander: true, aquatic: true },
    chicken: { rate: 0.030, feedDecay: 0.013, yieldLo: 1, yieldHi: 2, collectT: 1.8, feedT: 1.4, wander: true },
    cow:     { rate: 0.020, feedDecay: 0.010, yieldLo: 2, yieldHi: 3, collectT: 2.6, feedT: 2.0, wander: true },
    pig:     { rate: 0.024, feedDecay: 0.011, yieldLo: 1, yieldHi: 3, collectT: 2.2, feedT: 1.8, wander: true },
    goat:    { rate: 0.026, feedDecay: 0.011, yieldLo: 1, yieldHi: 2, collectT: 2.0, feedT: 1.6, wander: true },
};

// plot cell-set key (plots are tile-sets so they can grow into non-rectangular shapes)
export function pkey(i, j) { return i + ',' + j; }

function tileHash(i, j, seed = 0) {
    let h = Math.imul(i | 0, 374761393) ^ Math.imul(j | 0, 668265263) ^ Math.imul(seed | 0, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (h ^ (h >>> 16)) >>> 0;
}
function tileRand(i, j, seed = 0) {
    return tileHash(i, j, seed) / 4294967296;
}
function lerp(a, b, t) { return a + (b - a) * t; }
function smooth(t) { return t * t * (3 - 2 * t); }
function tileNoise(i, j, scale, seed = 0) {
    const x = i / scale, y = j / scale;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const tx = smooth(x - x0), ty = smooth(y - y0);
    const a = tileRand(x0, y0, seed);
    const b = tileRand(x0 + 1, y0, seed);
    const c = tileRand(x0, y0 + 1, seed);
    const d = tileRand(x0 + 1, y0 + 1, seed);
    return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
}

const FACILITY_DEFS = {
    pond: { label: 'water garden', w: 3, h: 3, produce: 'lily & fish' },
    coop: { label: 'chicken coop', w: 3, h: 3, produce: 'eggs' },
    pen:  { label: 'livestock pen', w: 3, h: 3, produce: 'milk' },
};

// energy / health tuning
const AWAKE_DRAIN = 0.0022;
const SLEEP_RESTORE = 0.03;
const REST_RESTORE = 0.022;
const ACTION_ENERGY = { till: 0.09, plant: 0.05, water: 0.05, harvest: 0.08, clear: 0.07, build: 0.09, collect: 0.07, tend: 0.05 };
// Clearing/building labor by effort: a shrub is quick and light, a tree is a long hard fell,
// a stump is grubbing work, a rock is the heaviest, a fence post is medium. { time, energy }.
const LABOR = {
    forage: { time: 1.6, energy: 0.05 },    // clear a shrub / brush
    fencepost: { time: 1.8, energy: 0.07 }, // set a fence post
    break: { time: 2.8, energy: 0.09 },     // grub out a stump
    chop: { time: 4.6, energy: 0.13 },      // fell a tree
    mine: { time: 4.2, energy: 0.16 },      // smash a rock
};

export function d20(rand, modifier) {
    const roll = 1 + Math.floor(rand() * 20);
    return { roll, mod: modifier, total: roll + modifier, crit: roll === 20, fumble: roll === 1 };
}

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------

export class World {
    constructor(seed = 1337) {
        this.seed = seed >>> 0;
        this.rand = mulberry32(seed);
        this.tiles = new Uint8Array(GRID * GRID).fill(T.GRASS);
        this.crops = new Map();
        this.plots = [];
        this.farmers = [];
        this.log = [];
        this.day = 1;
        this.clock = 0;
        this.harvestTotal = 0;

        this.season = 0;
        this.seasonDay = 0;
        this.year = 1;

        this.weather = 'sun';
        this.weatherTimer = 20;
        this.lightningTimer = 0;
        this.lightningFlash = 0;
        this.struckTile = null;

        this.helpBoard = [];
        this.project = null;
        this.projectIndex = 0;
        this.structures = [];
        this.bonds = new Map();
        this.workMult = 1;
        this.growthMult = 1;
        this.lightningMult = 1;
        this.leader = null;

        this.well = { i: CENTER, j: CENTER };
        this.sign = null;                                 // (RY sign removed)
        this.board = null;    // no bulletin board until the town builds one together (first communal project)
        this.wells = [this.well];
        this.set(this.well.i, this.well.j, T.WELL);

        this.slots = [];
        this.ringCount = 0;
        this.#addRing(26, 8, 0.42);

        this.#growForest();
    }

    // Wild lands on the town's outskirts: forest that grows in CLUSTERS (dense
    // copses with open meadows between), plus wild wheat + wildflower patches.
    // Trees stay clear of a border so they never clip the map edge.
    #growForest() {
        const groves = [];
        for (let g = 0; g < 22; g++) {
            const a = tileRand(g, 0, this.seed + 90) * Math.PI * 2;
            const r = 16 + tileRand(g, 1, this.seed + 91) * 23;
            groves.push({
                i: CENTER + Math.cos(a) * r + (tileRand(g, 2, this.seed + 92) - 0.5) * 5,
                j: CENTER + Math.sin(a) * r + (tileRand(g, 3, this.seed + 93) - 0.5) * 5,
                rx: 3.5 + tileRand(g, 4, this.seed + 94) * 4.8,
                ry: 3.0 + tileRand(g, 5, this.seed + 95) * 4.2,
                weight: 0.65 + tileRand(g, 6, this.seed + 96) * 0.45,
            });
        }

        // Meadows and forage are tile-level texture; trees are seeded below as
        // spaced grove points so their large billboards do not inherit grid rows.
        for (let j = 0; j < GRID; j++) {
            for (let i = 0; i < GRID; i++) {
                if (this.get(i, j) !== T.GRASS) continue;
                if (i < FOREST_BORDER || j < FOREST_BORDER || i >= GRID - FOREST_BORDER || j >= GRID - FOREST_BORDER) continue;
                const dx = i - CENTER, dy = j - CENTER;
                const r = Math.sqrt(dx * dx + dy * dy);
                const wheatN =
                    tileNoise(i - 31, j + 7, 9, this.seed + 4) * 0.58 +
                    tileNoise(i + 5, j + 29, 21, this.seed + 5) * 0.30 +
                    tileRand(i, j, this.seed + 6) * 0.12;
                const flowerN =
                    tileNoise(i + 43, j - 23, 8, this.seed + 7) * 0.56 +
                    tileNoise(i - 13, j + 17, 18, this.seed + 8) * 0.32 +
                    tileRand(i, j, this.seed + 9) * 0.12;
                let pw = 0, pf = 0;
                if (r > 12) pw = Math.max(0, wheatN - 0.55) * 0.72;         // wild wheat clumps
                if (r > 10) pf = Math.max(0, flowerN - 0.53) * 0.64;        // wildflower meadows
                const roll = tileRand(i, j, this.seed + 10);
                if (roll < pw) this.set(i, j, T.WHEAT);
                else if (roll < pw + pf) this.set(i, j, T.FLOWER);
            }
        }

        const candidates = [];
        for (let j = FOREST_BORDER; j < GRID - FOREST_BORDER; j++) {
            for (let i = FOREST_BORDER; i < GRID - FOREST_BORDER; i++) {
                const t = this.get(i, j);
                if (t !== T.GRASS && t !== T.WHEAT && t !== T.FLOWER) continue;
                const r = Math.hypot(i - CENTER, j - CENTER);
                if (r < 10) continue;
                let grove = 0;
                for (const g of groves) {
                    const dx = (i - g.i) / g.rx;
                    const dy = (j - g.j) / g.ry;
                    const v = Math.exp(-(dx * dx + dy * dy)) * g.weight;
                    if (v > grove) grove = v;
                }
                const edge = Math.max(0, Math.min(1, (r - 12) / 26));
                const texture =
                    tileNoise(i + 11, j - 5, 12, this.seed + 101) * 0.44 +
                    tileNoise(i - 37, j + 19, 27, this.seed + 102) * 0.34 +
                    tileRand(i, j, this.seed + 103) * 0.22;
                const score = grove * 0.78 + edge * 0.18 + texture * 0.30;
                const threshold = r > 25 ? 0.43 : r > 17 ? 0.52 : 0.68;
                if (score > threshold) {
                    candidates.push({
                        i, j,
                        score: score + tileRand(i, j, this.seed + 104) * 0.24,
                    });
                }
            }
        }

        candidates.sort((a, b) => b.score - a.score);
        const targetTrees = 58 + Math.floor(tileRand(0, 0, this.seed + 105) * 14);
        let planted = 0;
        for (const c of candidates) {
            if (planted >= targetTrees) break;
            const r = Math.hypot(c.i - CENTER, c.j - CENTER);
            const minX = r > 24 ? 46 : 52;
            const minY = r > 24 ? 26 : 30;
            if (!this.#treeFits(c.i, c.j, minX, minY)) continue;
            this.set(c.i, c.j, T.TREE);
            planted++;
        }
        this.#thinForest();
        this.#seedRocks();
    }

    #countTiles(i, j, tile, radius) {
        let n = 0;
        for (let y = j - radius; y <= j + radius; y++) {
            for (let x = i - radius; x <= i + radius; x++) {
                if (x === i && y === j) continue;
                if (this.get(x, y) === tile) n++;
            }
        }
        return n;
    }

    #treeFits(i, j, minX = 48, minY = 28) {
        if (i < FOREST_BORDER || j < FOREST_BORDER || i >= GRID - FOREST_BORDER || j >= GRID - FOREST_BORDER) return false;
        const t = this.get(i, j);
        if (t !== T.GRASS && t !== T.WHEAT && t !== T.FLOWER && t !== T.STUMP) return false;
        const a = i - j, b = i + j;
        for (let y = j - 9; y <= j + 9; y++) {
            for (let x = i - 9; x <= i + 9; x++) {
                if (this.get(x, y) !== T.TREE) continue;
                const dx = Math.abs(a - (x - y)) * ISO_HALF_W;
                const dy = Math.abs(b - (x + y)) * ISO_HALF_H;
                const nx = dx / minX, ny = dy / minY;
                if (nx * nx + ny * ny < 1) return false;
                const sameScreenRow = Math.abs(b - (x + y)) <= 2 && dx < 96;
                const sameScreenColumn = Math.abs(a - (x - y)) <= 2 && dy < 64;
                const sameMapRow = Math.abs(j - y) <= 1 && Math.abs(i - x) < 9;
                const sameMapColumn = Math.abs(i - x) <= 1 && Math.abs(j - y) < 9;
                if (sameScreenRow || sameScreenColumn || sameMapRow || sameMapColumn) return false;
            }
        }
        return true;
    }

    #thinForest() {
        const changes = [];
        for (let j = FOREST_BORDER; j < GRID - FOREST_BORDER; j++) {
            for (let i = FOREST_BORDER; i < GRID - FOREST_BORDER; i++) {
                if (this.get(i, j) !== T.TREE) continue;
                const close = this.#countTiles(i, j, T.TREE, 1);
                const near = this.#countTiles(i, j, T.TREE, 2);
                const inLine =
                    (this.get(i - 1, j) === T.TREE && this.get(i + 1, j) === T.TREE) ||
                    (this.get(i, j - 1) === T.TREE && this.get(i, j + 1) === T.TREE) ||
                    (this.get(i - 1, j - 1) === T.TREE && this.get(i + 1, j + 1) === T.TREE) ||
                    (this.get(i + 1, j - 1) === T.TREE && this.get(i - 1, j + 1) === T.TREE);
                let remove = 0;
                if (close >= 6) remove = 0.92;
                else if (close >= 5) remove = 0.78;
                else if (close >= 4) remove = 0.56;
                else if (close >= 3 && near >= 10) remove = 0.28;
                if (near >= 15) remove = Math.max(remove, 0.82);
                else if (near >= 12) remove = Math.max(remove, 0.62);
                else if (near >= 10) remove = Math.max(remove, 0.38);
                if (inLine) remove = Math.max(remove, 0.72);
                if (tileRand(i, j, this.seed + 31) < remove) changes.push({ i, j });
            }
        }
        for (const { i, j } of changes) {
            const r = tileRand(i, j, this.seed + 32);
            this.set(i, j, r < 0.08 ? T.WHEAT : r < 0.16 ? T.FLOWER : T.GRASS);
        }
    }

    #seedRocks() {
        for (let j = FOREST_BORDER; j < GRID - FOREST_BORDER; j++) {
            for (let i = FOREST_BORDER; i < GRID - FOREST_BORDER; i++) {
                if (this.get(i, j) !== T.GRASS) continue;
                const r = Math.hypot(i - CENTER, j - CENTER);
                const rockN =
                    tileNoise(i + 71, j - 37, 10, this.seed + 41) * 0.55 +
                    tileNoise(i - 17, j + 53, 24, this.seed + 42) * 0.33 +
                    tileRand(i, j, this.seed + 43) * 0.12;
                let p = Math.max(0, rockN - 0.62) * 0.42;
                if (r > 23) p *= 1.45;
                else if (r < 11) p *= 0.25;
                if (tileRand(i, j, this.seed + 44) < p) this.set(i, j, T.ROCK);
            }
        }
    }

    // Clear wild growth ONLY on the plot's own cells (the homestead footprint). Never touch
    // unowned tiles: a rock/tree on an expansion frontier or in an L-shaped notch is a
    // resource the bots must mine/chop — expansion must not erase it for free.
    #clearPlotWildBuffer(plot) {
        for (const key of plot.cells) {
            const c = key.indexOf(','), i = +key.slice(0, c), j = +key.slice(c + 1);
            const t = this.get(i, j);
            if (t === T.TREE || t === T.STUMP || t === T.ROCK || t === T.WHEAT || t === T.FLOWER) this.set(i, j, T.GRASS);
        }
    }

    // Nature slowly reclaims cleared land: a few outskirt tiles regrow each day.
    #regrowWild() {
        const nearAnyPlot = (i, j, pad = 2) => this.plots.some(p => i >= p.x - pad && i < p.x + p.w + pad && j >= p.y - pad && j < p.y + p.h + pad);
        let treesGrown = 0, wheatGrown = 0;
        for (let k = 0; k < 24; k++) {
            const i = 2 + Math.floor(this.rand() * (GRID - 4));
            const j = 2 + Math.floor(this.rand() * (GRID - 4));
            const t = this.get(i, j);
            if ((t !== T.GRASS && t !== T.STUMP) || nearAnyPlot(i, j)) continue;
            if (i < FOREST_BORDER || j < FOREST_BORDER || i >= GRID - FOREST_BORDER || j >= GRID - FOREST_BORDER) continue;
            const r = Math.hypot(i - CENTER, j - CENTER);
            if (r > 24) {
                // near the forest: stumps sprout saplings, gaps refill with wild growth
                if (this.rand() < 0.18 && this.#treeFits(i, j, 48, 28)) { this.set(i, j, T.TREE); treesGrown++; }
                else if (this.rand() < 0.4) { this.set(i, j, this.rand() < 0.6 ? T.WHEAT : T.FLOWER); wheatGrown++; }
            } else if (r > 10 && this.rand() < 0.16) { this.set(i, j, this.rand() < 0.5 ? T.WHEAT : T.FLOWER); wheatGrown++; }
        }
    }

    // A tile the farm is actively using resists being reclaimed by the wild.
    #onActiveField(i, j) { const t = this.get(i, j); return t === T.TILLED || !!this.cropAt(i, j); }
    #vegNeighbors(i, j) {
        let n = 0;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const t = this.get(i + di, j + dj); if (t === T.TREE || t === T.FLOWER || t === T.STUMP) n++; }
        return n;
    }
    #inAnyHouseFootprint(i, j) { for (const p of this.plots) if (this.#inHouse(p, i, j)) return true; return false; }
    #cellInAnyPlot(i, j) { const key = pkey(i, j); return this.plots.some(p => p.cells.has(key)); }
    #protectedTile(i, j) {
        if (this.#inAnyHouseFootprint(i, j)) return true;
        if (this.board && this.board.i === i && this.board.j === j) return true;
        for (const w of this.wells) if (w.i === i && w.j === j) return true;
        for (const s of this.structures) if (s.i === i && s.j === j) return true;
        const ps = this.project && this.project.site;
        if (ps && ps.i === i && ps.j === j) return true;
        return false;
    }

    // Untended land slowly reverts: standing brush/trees SPREAD into adjacent untended grass,
    // and brush ages into trees. Growth concentrates at the vegetation boundary, so it creeps
    // INTO farms (pressuring bots to keep clearing — see #nearestPlotObstacle) and onto expansion
    // frontiers (trees there block annexation). A neglected farm gets reclaimed by the wild.
    #encroach() {
        const sprouts = [], matures = [];
        for (let j = FOREST_BORDER; j < GRID - FOREST_BORDER; j++) {
            for (let i = FOREST_BORDER; i < GRID - FOREST_BORDER; i++) {
                const t = this.get(i, j);
                if (t !== T.TREE && t !== T.FLOWER) continue;
                if (t === T.FLOWER && !this.#onActiveField(i, j) && !this.#protectedTile(i, j) && this.#treeFits(i, j, 48, 28)) matures.push({ i, j });
                for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                    const gi = i + di, gj = j + dj;
                    if (this.get(gi, gj) === T.GRASS && !this.#onActiveField(gi, gj) && !this.#protectedTile(gi, gj)) sprouts.push({ i: gi, j: gj });
                }
            }
        }
        let sprouted = 0, matured = 0, ontoFarm = false;
        for (const s of matures) if (this.rand() < 0.05) { this.set(s.i, s.j, T.TREE); matured++; }
        const seen = new Set(); const CAP = 22;   // gradual — a fringe, not a takeover
        for (const s of sprouts) {
            if (sprouted >= CAP) break;
            const key = pkey(s.i, s.j);
            if (seen.has(key) || this.get(s.i, s.j) !== T.GRASS) continue;
            seen.add(key);
            if (this.rand() < 0.10) { this.set(s.i, s.j, T.FLOWER); sprouted++; if (this.#cellInAnyPlot(s.i, s.j)) ontoFarm = true; }
        }
        // weeds: idle grass on an established farm sprouts brush directly — a neglected plot
        // (grass left untilled) gets reclaimed, so farms need active upkeep, not just edge-clearing.
        for (const p of this.plots) {
            if (p.built.level < 1) continue;
            const grass = [];
            for (const key of p.cells) { const c = key.indexOf(','), i = +key.slice(0, c), j = +key.slice(c + 1); if (this.get(i, j) === T.GRASS && !this.#onActiveField(i, j) && !this.#protectedTile(i, j)) grass.push({ i, j }); }
            let weeds = Math.min(grass.length, 1 + Math.floor(grass.length * 0.05));
            for (let n = 0; n < weeds && grass.length; n++) {
                const g = grass.splice(Math.floor(this.rand() * grass.length), 1)[0];
                if (this.rand() < 0.5) { this.set(g.i, g.j, T.FLOWER); sprouted++; ontoFarm = true; }
            }
        }
        if (sprouted || matured) { this._tilesChanged = true; for (const p of this.plots) this.#rebuildFields(p); }
        if (ontoFarm && this.rand() < 0.6) this.addLog('Wild brush is creeping into the farms — clear it before it takes root.', '#8a9a5a');
    }

    // house occupies a 2x2 footprint; keep crops/facilities off it and its door
    // Reserve the house's VISUAL footprint (the sprite is ~5 tiles wide / taller than its
    // 2x3 tile base), so crops and facilities never get placed under the house sprite.
    #inHouse(plot, i, j) {
        const h = plot.house;
        return i >= h.i - 1 && i <= h.i + 2 && j >= h.j - 1 && j <= h.j + 3;
    }

    #addRing(radius, count, phase) {
        this.ringCount++;
        for (let a = 0; a < count; a++) {
            const ang = (a / count) * Math.PI * 2 + phase;
            this.slots.push({
                i: Math.round(CENTER + Math.cos(ang) * radius) - 3,
                j: Math.round(CENTER + Math.sin(ang) * radius) - 3,
                used: false,
            });
        }
    }

    idx(i, j) { return j * GRID + i; }
    get(i, j) {
        if (i < 0 || j < 0 || i >= GRID || j >= GRID) return T.GRASS;
        return this.tiles[this.idx(i, j)];
    }
    set(i, j, t) {
        if (i < 0 || j < 0 || i >= GRID || j >= GRID) return;
        this.tiles[this.idx(i, j)] = t;
        this._tilesChanged = true;
    }
    blocked(i, j) {
        const t = this.get(i, j);
        return t === T.HOUSE || t === T.WELL || t === T.SIGN || t === T.STRUCT || t === T.COOP || t === T.BARN || t === T.ROCK;
    }

    isNight() { return this.clock > DAY_LENGTH; }
    nightProgress() { return this.isNight() ? (this.clock - DAY_LENGTH) / NIGHT_LENGTH : 0; }
    get seasonDef() { return SEASONS[this.season]; }
    get seasonName() { return SEASONS[this.season].name; }

    #advanceSeason() {
        this.seasonDay++;
        if (this.seasonDay >= SEASON_LENGTH) {
            this.seasonDay = 0;
            this.season = (this.season + 1) % SEASONS.length;
            if (this.season === 0) { this.year++; this.addLog(`A new year dawns on Ry Farms — Year ${this.year}!`, '#f0d060'); }
            const def = SEASONS[this.season];
            this.addLog(`${def.name} has arrived.`, def.accent);
            this._tilesChanged = true;
            this._seasonChanged = true;
        }
    }

    addLog(text, color = '#c8ccd8') {
        this.log.push({ text, color, t: performance.now() });
        if (this.log.length > 80) this.log.shift();
    }

    nearestWell(pos) {
        let best = this.wells[0], bestD = 1e9;
        for (const w of this.wells) {
            const d = Math.abs(w.i - pos.i) + Math.abs(w.j - pos.j);
            if (d < bestD) { bestD = d; best = w; }
        }
        return best;
    }

    // ---- bonds & reputation ------------------------------------------------------

    bondKey(a, b) {
        return a.sheet.seed < b.sheet.seed ? `${a.sheet.seed}|${b.sheet.seed}` : `${b.sheet.seed}|${a.sheet.seed}`;
    }
    addBond(a, b, delta = 1) { this.bonds.set(this.bondKey(a, b), (this.bonds.get(this.bondKey(a, b)) || 0) + delta); }
    bondCount(f) {
        let n = 0;
        for (const [k, v] of this.bonds) if (k.includes(String(f.sheet.seed)) && v > 0) n++;
        return n;
    }

    updateLeader() {
        let top = null, best = -1;
        for (const f of this.farmers) if (f.sheet.harvested > best) { best = f.sheet.harvested; top = f; }
        if (top && this.leader !== top && best > 3) {
            const prev = this.leader;
            this.leader = top;
            if (prev && prev !== top) {
                this.addLog(`${top.sheet.name} overtook ${prev.sheet.name} as top farmer!`, '#f0d060');
                if (top.sheet.personality.competitiveness > 0.55) { top.say('TOP OF THE TOWN!', '#f0d060'); top.sparkle = 2; }
            }
        }
    }

    // ---- farmers -----------------------------------------------------------------

    // Same authority as addFarmer for whether a spawn is possible (a fitting slot exists, or
    // ring 2 can still open) — so the +RY button doesn't disable while ring 2 could yet open.
    canAddFarmer() {
        const B = World.BASE_PLOT;
        if (this.slots.some(s => !s.used && this.#candidateBlockers(null, s.i, s.j, B, B) !== null)) return true;
        return this.ringCount === 1;
    }

    addFarmer(memory, mutation = 0) {
        const B = World.BASE_PLOT;
        // only accept a slot whose plot rect (+buffer) clears every existing farm / the
        // commons / the map edge — ring geometry alone doesn't guarantee this once the
        // second ring opens, so validate instead of trusting the radii.
        const fits = (s) => !s.used && this.#candidateBlockers(null, s.i, s.j, B, B) !== null;
        let slot = this.slots.find(fits);
        if (!slot && this.ringCount === 1) {
            this.#addRing(40, 11, 0.18);
            this.addLog('The town has grown! New homesteads opened further out.', '#7dd069');
            slot = this.slots.find(fits);
        }
        if (!slot) return null;
        slot.used = true;

        const sheet = growFarmer(memory, mutation);
        const plot = {
            x: slot.i, y: slot.j, w: B, h: B,
            // house upper-center: ~4 tiles of fenced yard behind it, garden room in front, facility room to the sides
            house: { i: slot.i + 5, j: slot.j + 5 },
            fields: [], facilities: [],
            // plot area is a SET of tiles (starts as the base square) so it can later grow
            // into L-shapes; `rev` bumps whenever `cells` changes so the renderer re-traces fences.
            cells: new Set(), rev: 0,
            // settlers arrive to raw land: clear it, gather wood for a fence, then raise a
            // level-1 tipi and slowly upgrade it (L1 tipi -> L2 yurt -> L3 cottage) over a year+.
            // level 0 = homeless. Until level>=1 no house renders and they sleep in the open.
            built: { fence: false, level: 0 },
            fencePosts: 0, fenceTarget: 0,   // fence is raised post-by-post, not instantly
        };
        for (let j = slot.j; j < slot.j + B; j++) for (let i = slot.i; i < slot.i + B; i++) plot.cells.add(pkey(i, j));
        this.#rebuildFields(plot);   // (plot is NOT auto-cleared; the house tiles are NOT placed yet)

        const farmer = new Farmer(sheet, plot, this);
        farmer.pos = { i: plot.x + plot.w / 2, j: plot.y + plot.h };
        this.plots.push(plot);
        this.farmers.push(farmer);
        const p = sheet.personality;
        this.addLog(`${sheet.name} the ${p.label} settled in. "${p.creed}"`, '#7dd069');
        return farmer;
    }

    #hasCell(plot, i, j) { return plot.cells.has(pkey(i, j)); }
    // a cell is "interior" (plantable) only if all 4 orthogonal neighbours are also in the
    // plot — this keeps a 1-tile margin inside the fence for any shape, not just rectangles.
    #interiorCell(plot, i, j) {
        return this.#hasCell(plot, i - 1, j) && this.#hasCell(plot, i + 1, j) &&
            this.#hasCell(plot, i, j - 1) && this.#hasCell(plot, i, j + 1);
    }
    #recomputeBounds(plot) {
        let minI = Infinity, minJ = Infinity, maxI = -Infinity, maxJ = -Infinity;
        for (const key of plot.cells) {
            const c = key.indexOf(','), i = +key.slice(0, c), j = +key.slice(c + 1);
            if (i < minI) minI = i; if (i > maxI) maxI = i;
            if (j < minJ) minJ = j; if (j > maxJ) maxJ = j;
        }
        plot.x = minI; plot.y = minJ; plot.w = maxI - minI + 1; plot.h = maxJ - minJ + 1;
        plot.rev++;   // geometry changed -> renderer re-traces the fence outline
    }

    // field tiles = interior grass/tilled cells that aren't the house or a facility
    #rebuildFields(plot) {
        plot.fields = [];
        for (const key of plot.cells) {
            const c = key.indexOf(','), i = +key.slice(0, c), j = +key.slice(c + 1);
            if (this.#inHouse(plot, i, j) || !this.#interiorCell(plot, i, j)) continue;
            const t = this.get(i, j);
            if (t === T.GRASS || t === T.TILLED) plot.fields.push({ i, j });
        }
    }

    // ---- farm expansion + diversification ---------------------------------------

    static MAX_PLOT = 23;
    static BASE_PLOT = 13;   // starting plot size (square); house + garden + facility zones fit inside
    expandCost(plot) { return 4 + Math.max(0, Math.floor((Math.max(plot.w, plot.h) - 13) / 2)) * 2; }

    // Validate a candidate rect for a plot; returns null if it collides with a
    // neighbor plot / commons / edge, else the list of woodland tiles to clear.
    #candidateBlockers(plot, nx, ny, nw, nh) {
        if (nx < 2 || ny < 2 || nx + nw > GRID - 2 || ny + nh > GRID - 2) return null;
        for (const other of this.plots) {
            if (other === plot) continue;
            if (nx < other.x + other.w + 1 && nx + nw > other.x - 1 &&
                ny < other.y + other.h + 1 && ny + nh > other.y - 1) return null;
        }
        const blockers = [...this.wells, this.sign, this.board, ...this.structures, this.project?.site].filter(Boolean);
        for (const b of blockers) if (b.i >= nx - 1 && b.i <= nx + nw && b.j >= ny - 1 && b.j <= ny + nh) return null;
        const tiles = [];
        for (let j = ny; j < ny + nh; j++) for (let i = nx; i < nx + nw; i++) {
            if (plot && i >= plot.x && i < plot.x + plot.w && j >= plot.y && j < plot.y + plot.h) continue; // old interior
            const t = this.get(i, j);
            if (t === T.TREE || t === T.STUMP) tiles.push({ i, j });
        }
        return tiles;
    }

    // Can a single tile be annexed into `plot`? 'clear' = plain/forage ground, 'tree' =
    // needs chopping first, 'blocked' = off-limits (edge, another farm + its buffer, the
    // commons, water, or a rock). Rocks/neighbours block, which is what carves plots into
    // non-rectangular (L) shapes as they grow around each other.
    #annexClass(plot, i, j) {
        if (i < 2 || j < 2 || i >= GRID - 2 || j >= GRID - 2) return 'blocked';
        for (const other of this.plots) {
            if (other.cells.has(pkey(i, j))) return 'blocked';
            if (other === plot) continue;
            for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++)
                if (other.cells.has(pkey(i + di, j + dj))) return 'blocked';   // 1-tile gap between farms
        }
        const blockers = [...this.wells, this.sign, this.board, ...this.structures, this.project?.site].filter(Boolean);
        for (const b of blockers) if (Math.abs(b.i - i) <= 1 && Math.abs(b.j - j) <= 1) return 'blocked';
        const t = this.get(i, j);
        if (t === T.TREE || t === T.STUMP) return 'tree';
        if (t === T.GRASS || t === T.WHEAT || t === T.FLOWER) return 'clear';
        return 'blocked';   // water / rock / anything built
    }

    // Inspect a plot's next expansion: pick a side (outward first) and annex the FREE
    // cells along that whole frontier. Partly-blocked frontiers annex only their free
    // cells, so the plot grows into L-shapes instead of forced rectangles.
    // Returns { state: 'max'|'blocked'|'trees'|'clear', tiles?, cells? }
    expansionInfo(plot) {
        const MAX = World.MAX_PLOT;
        if (plot.w >= MAX && plot.h >= MAX) return { state: 'max' };
        const cx = plot.x + plot.w / 2, cy = plot.y + plot.h / 2;
        const dirs = [
            { di: 1, dj: 0, out: cx > CENTER, axisOk: plot.w < MAX },
            { di: -1, dj: 0, out: cx < CENTER, axisOk: plot.w < MAX },
            { di: 0, dj: 1, out: cy > CENTER, axisOk: plot.h < MAX },
            { di: 0, dj: -1, out: cy < CENTER, axisOk: plot.h < MAX },
        ];
        let fallback = null;   // best side that has legal cells but misses the 50% preference
        for (const outwardPass of [true, false]) {
            for (const d of dirs) {
                if (!d.axisOk || d.out !== outwardPass) continue;
                const clear = [], trees = [];
                let frontier = 0;
                for (const key of plot.cells) {
                    const c = key.indexOf(','), i = +key.slice(0, c), j = +key.slice(c + 1);
                    const ni = i + d.di, nj = j + d.dj;
                    if (plot.cells.has(pkey(ni, nj))) continue;
                    frontier++;
                    const a = this.#annexClass(plot, ni, nj);
                    if (a === 'clear') clear.push({ i: ni, j: nj });
                    else if (a === 'tree') trees.push({ i: ni, j: nj });
                }
                const usable = clear.length + trees.length;
                if (usable === 0) continue;
                if (usable >= Math.ceil(frontier * 0.5)) {   // clean side: take it now
                    return trees.length ? { state: 'trees', tiles: trees } : { state: 'clear', cells: clear };
                }
                if (!fallback || usable > fallback.usable) fallback = { clear, trees, usable };
            }
        }
        // No side met the 50% preference, but if ANY legal cells exist, still make progress
        // (otherwise a partly-boxed-in farm deadlocks forever with land still available).
        if (fallback) return fallback.trees.length ? { state: 'trees', tiles: fallback.trees } : { state: 'clear', cells: fallback.clear };
        return { state: 'blocked' };
    }

    // Commit an expansion (caller has already checked wood + clear state).
    expandPlot(farmer) {
        const info = this.expansionInfo(farmer.plot);
        if (info.state !== 'clear') return false;
        const p = farmer.plot;
        for (const { i, j } of info.cells) {
            p.cells.add(pkey(i, j));
            if (this.get(i, j) === T.WHEAT || this.get(i, j) === T.FLOWER) this.set(i, j, T.GRASS);
        }
        this.#recomputeBounds(p);   // updates x/y/w/h + bumps rev (re-traces fence)
        this.#clearPlotWildBuffer(p, 1);
        this.#rebuildFields(p);
        this._tilesChanged = true;
        this.addLog(`${farmer.sheet.name} fenced in new land!`, '#7dd069');
        return true;
    }

    // The building sprites are far wider than the 2x2 tile footprint, so the clear zone spans
    // the whole visual area — nothing (tree/rock/brush/water) may overlap where a dwelling sits.
    static SITE = { di0: -2, di1: 3, dj0: -2, dj1: 4 };
    houseSiteClear(plot) {
        const h = plot.house, S = World.SITE;
        for (let dj = S.dj0; dj <= S.dj1; dj++) for (let di = S.di0; di <= S.di1; di++) {
            const t = this.get(h.i + di, h.j + dj);
            if (t === T.TREE || t === T.STUMP || t === T.ROCK || t === T.WATER || t === T.FLOWER || t === T.WHEAT) return false;
        }
        return true;
    }
    // How many posts a plot's fence takes (roughly its perimeter, clamped) — the fence is
    // built one post at a time, so this is a real chunk of work.
    fencePostTarget(plot) {
        let edges = 0;
        for (const key of plot.cells) {
            const c = key.indexOf(','), i = +key.slice(0, c), j = +key.slice(c + 1);
            if (!plot.cells.has(pkey(i, j - 1))) edges++;
            if (!plot.cells.has(pkey(i + 1, j))) edges++;
            if (!plot.cells.has(pkey(i, j + 1))) edges++;
            if (!plot.cells.has(pkey(i - 1, j))) edges++;
        }
        return Math.max(8, Math.min(edges, 30));
    }
    // A border tile to stand at while raising post #idx (just for visible movement around the plot).
    fencePostSpot(plot, idx) {
        const border = [];
        for (const key of plot.cells) {
            const c = key.indexOf(','), i = +key.slice(0, c), j = +key.slice(c + 1);
            if (!plot.cells.has(pkey(i, j - 1)) || !plot.cells.has(pkey(i + 1, j)) || !plot.cells.has(pkey(i, j + 1)) || !plot.cells.has(pkey(i - 1, j))) border.push({ i, j });
        }
        if (!border.length) return { i: plot.house.i, j: plot.house.j + 2 };
        return border[idx % border.length];
    }
    completeFence(farmer) {
        farmer.plot.built.fence = true;
        farmer.plot.rev++;
        this._tilesChanged = true;
        this.addLog(`${farmer.sheet.name} finished fencing their homestead.`, '#7dd069');
    }
    // True if the farmer can afford the given tier (wood + ore spent, lifetime harvest as a gate).
    canBuild(farmer, level) {
        const c = HOUSE_TIERS[level];
        return c && farmer.wood >= c.wood && farmer.ore >= c.ore && farmer.sheet.harvested >= c.harvested;
    }
    raiseBuilding(farmer, level) {
        const p = farmer.plot, h = p.house, c = HOUSE_TIERS[level];
        farmer.wood -= c.wood; farmer.ore -= c.ore;
        for (let di = 0; di < 2; di++) for (let dj = 0; dj < 2; dj++) this.set(h.i + di, h.j + dj, T.HOUSE);
        p.built.level = level;
        this._tilesChanged = true;
        this.#rebuildFields(p);
        if (level === 1) this.addLog(`${farmer.sheet.name} pitched a tipi — a first home!`, '#f0d060');
        else this.addLog(`${farmer.sheet.name} upgraded to a ${c.name}!`, '#f0d060');
    }

    // Place the farmer's next preferred facility if there's room (no auto-expand;
    // room is the farmer's job via wood-gated expansion). Returns true if built.
    buildNextFacility(farmer) {
        const plot = farmer.plot;
        const built = new Set(plot.facilities.map(f => f.type));
        const nextType = (farmer.sheet.facilityPrefs || ['pond', 'coop', 'pen']).find(t => !built.has(t));
        if (!nextType) return false;
        const region = this.#findFacilityRegion(plot, nextType);
        if (!region) return false;
        this.#buildFacility(plot, farmer.sheet, nextType, region);
        const def = FACILITY_DEFS[nextType];
        this.addLog(`${farmer.sheet.name} added a ${def.label.toUpperCase()} to their farm!`, '#7dd069');
        farmer.say('NEW GROUNDS!', '#7dd069'); farmer.sparkle = 2;
        return true;
    }

    farmerHasUnbuiltFacility(farmer) {
        const built = new Set(farmer.plot.facilities.map(f => f.type));
        return (farmer.sheet.facilityPrefs || []).some(t => !built.has(t));
    }

    // nearest fellable tile (TREE preferred), optionally restricted to a set
    nearestWood(pos, restrict) {
        let best = null, bestD = 1e9;
        const scan = (wantStump) => {
            for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) {
                const t = this.get(i, j);
                if (wantStump ? t !== T.STUMP : t !== T.TREE) continue;
                if (restrict && !restrict.some(r => r.i === i && r.j === j)) continue;
                const d = Math.abs(i - pos.i) + Math.abs(j - pos.j);
                if (d < bestD) { bestD = d; best = { i, j, kind: wantStump ? 'stump' : 'tree' }; }
            }
        };
        scan(false);                         // prefer standing trees
        if (!best) scan(true);               // else grub a stump
        return best;
    }

    // nearest breakable rock within reach (for ore)
    nearestRock(pos, maxD = 10) {
        let best = null, bestD = maxD + 1;
        for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) {
            if (this.get(i, j) !== T.ROCK) continue;
            const d = Math.abs(i - pos.i) + Math.abs(j - pos.j);
            if (d < bestD) { bestD = d; best = { i, j }; }
        }
        return best;
    }

    // Solid obstacles farmers must walk AROUND (buildings, wells, rocks, the board).
    pathBlocked(i, j) {
        const t = this.get(i, j);
        if (t === T.HOUSE || t === T.WELL || t === T.STRUCT || t === T.COOP || t === T.BARN || t === T.ROCK || t === T.WATER) return true;
        if (this.board && this.board.i === i && this.board.j === j) return true;
        return false;
    }

    // A* over tiles avoiding obstacles. The goal tile is always allowed (so a bot can reach a
    // rock it means to mine). Returns tile waypoints (excluding the start), or null if no path
    // within the expansion cap (caller then falls back to a straight line).
    findPath(start, goal) {
        const si = Math.floor(start.i), sj = Math.floor(start.j);
        const gi = Math.floor(goal.i), gj = Math.floor(goal.j);
        if (si === gi && sj === gj) return [];
        const okTile = (i, j) => (i === gi && j === gj) || !this.pathBlocked(i, j);
        const key = (i, j) => i * GRID + j;
        const open = [{ i: si, j: sj, g: 0, f: Math.abs(gi - si) + Math.abs(gj - sj), p: null }];
        const best = new Map([[key(si, sj), 0]]);
        const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
        let expansions = 0;
        while (open.length) {
            let bi = 0;
            for (let k = 1; k < open.length; k++) if (open[k].f < open[bi].f) bi = k;
            const cur = open.splice(bi, 1)[0];
            if (cur.i === gi && cur.j === gj) {
                const path = []; let n = cur; while (n) { path.push({ i: n.i, j: n.j }); n = n.p; }
                path.reverse(); path.shift(); return path;
            }
            if (++expansions > 900) break;
            for (const [di, dj] of dirs) {
                const ni = cur.i + di, nj = cur.j + dj;
                if (ni < 0 || nj < 0 || ni >= GRID || nj >= GRID || !okTile(ni, nj)) continue;
                if (di && dj && (this.pathBlocked(cur.i + di, cur.j) || this.pathBlocked(cur.i, cur.j + dj))) continue; // no corner-cut past an obstacle edge
                const ng = cur.g + (di && dj ? 1.4 : 1), kk = key(ni, nj);
                if (best.has(kk) && best.get(kk) <= ng) continue;
                best.set(kk, ng);
                open.push({ i: ni, j: nj, g: ng, f: ng + Math.abs(gi - ni) + Math.abs(gj - nj), p: cur });
            }
        }
        return null;
    }

    // nearest patch of wild forage (wheat or flowers) within reach
    nearestForage(pos, maxD = 15) {
        let best = null, bestD = maxD;
        for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) {
            const t = this.get(i, j);
            if (t !== T.WHEAT && t !== T.FLOWER) continue;
            const d = Math.abs(i - pos.i) + Math.abs(j - pos.j);
            if (d < bestD) { bestD = d; best = { i, j, tile: t }; }
        }
        return best;
    }

    #findFacilityRegion(plot, type) {
        const def = FACILITY_DEFS[type];
        // Need a clear w x h block of plain field tiles, PLUS a 1-tile buffer so a
        // facility never sits flush against water, a building, or the house — which
        // caused ponds/coops to overlap and animals to appear standing on water.
        for (let y = plot.y + 1; y + def.h <= plot.y + plot.h - 1; y++) {
            for (let x = plot.x + 1; x + def.w <= plot.x + plot.w - 1; x++) {
                let ok = true;
                // the region itself must be plain, crop-free ground the plot actually owns
                for (let j = y; j < y + def.h && ok; j++) {
                    for (let i = x; i < x + def.w; i++) {
                        const t = this.get(i, j);
                        if (!this.#hasCell(plot, i, j) || this.#inHouse(plot, i, j) || (t !== T.GRASS && t !== T.TILLED) || this.cropAt(i, j)) { ok = false; break; }
                    }
                }
                // the 1-tile border must not be water / a building / the house
                for (let j = y - 1; j <= y + def.h && ok; j++) {
                    for (let i = x - 1; i <= x + def.w; i++) {
                        if (i >= x && i < x + def.w && j >= y && j < y + def.h) continue; // skip interior
                        const t = this.get(i, j);
                        if (t === T.WATER || t === T.COOP || t === T.BARN || t === T.STRUCT || this.#inHouse(plot, i, j)) { ok = false; break; }
                    }
                }
                if (ok) return { x, y, w: def.w, h: def.h };
            }
        }
        return null;
    }

    #buildFacility(plot, sheet, type, region) {
        const fac = { type, ...region, producers: [], struct: null, trough: null };
        const cx = region.x + region.w / 2, cy = region.y + region.h / 2;
        const rand = this.rand;

        if (type === 'pond') {
            for (let j = region.y; j < region.y + region.h; j++)
                for (let i = region.x; i < region.x + region.w; i++) this.set(i, j, T.WATER);
            // lily pads on a scattering of tiles
            for (let j = region.y; j < region.y + region.h; j++) {
                for (let i = region.x; i < region.x + region.w; i++) {
                    if ((i + j) % 2 === 0 && rand() < 0.7) fac.producers.push(this.#makeProducer('pad', i + 0.5, j + 0.5, region));
                }
            }
            for (let k = 0; k < 3; k++) fac.producers.push(this.#makeProducer('fish', cx + (rand() - 0.5), cy + (rand() - 0.5), region));
        } else if (type === 'coop') {
            fac.struct = { i: region.x, j: region.y, kind: 'coop' };
            this.set(region.x, region.y, T.COOP);
            fac.trough = { i: region.x + region.w - 1, j: region.y + region.h - 1 };
            const n = 4 + Math.floor(rand() * 3);
            for (let k = 0; k < n; k++) fac.producers.push(this.#makeProducer('chicken', cx + (rand() - 0.5) * region.w * 0.6, cy + (rand() - 0.5) * region.h * 0.6, region));
        } else if (type === 'pen') {
            fac.struct = { i: region.x, j: region.y, kind: 'barn' };
            this.set(region.x, region.y, T.BARN);
            fac.trough = { i: region.x + region.w - 1, j: region.y + region.h - 1 };
            const kind = sheet.penAnimal || 'cow';
            const n = 3 + Math.floor(rand() * 2);
            for (let k = 0; k < n; k++) fac.producers.push(this.#makeProducer(kind, cx + (rand() - 0.5) * region.w * 0.6, cy + (rand() - 0.5) * region.h * 0.6, region));
        }
        plot.facilities.push(fac);
        this.#rebuildFields(plot);   // facility tiles removed from crop fields
    }

    #makeProducer(kind, fx, fy, region) {
        const r = this.rand;
        return {
            kind, fx, fy, region,
            vx: 0, vy: 0, ready: false, prod: r() * 0.4, fed: 0.7,
            busy: false, anim: r() * 10, wanderT: r() * 2, flip: r() < 0.5 ? -1 : 1, hop: 0,
        };
    }

    allProducers(plot) {
        const out = [];
        for (const f of plot.facilities) for (const p of f.producers) out.push(p);
        return out;
    }

    // ---- communal projects -------------------------------------------------------

    #maybeStartProject() {
        if (this.project || this.projectIndex >= PROJECT_DEFS.length) return;
        const def = PROJECT_DEFS[this.projectIndex];
        if (this.harvestTotal < def.at) return;
        const site = this.#findStructureSpot();
        if (!site) return;
        this.projectIndex++;
        this.project = { ...def, site, points: 0, builders: new Set() };
        this.addLog(`TOWN PROJECT: build a ${def.label}! (${def.perk})`, '#f0d060');
    }

    #findStructureSpot() {
        for (let tries = 0; tries < 60; tries++) {
            const a = this.rand() * Math.PI * 2;
            const r = 4 + this.rand() * 4;
            const i = Math.round(CENTER + Math.cos(a) * r);
            const j = Math.round(CENTER + Math.sin(a) * r);
            if (this.get(i, j) !== T.GRASS) continue;
            let clear = true;
            for (const p of this.plots) if (i >= p.x - 1 && i <= p.x + p.w + 1 && j >= p.y - 1 && j <= p.y + p.h + 1) { clear = false; break; }
            for (const s of this.structures) if (Math.abs(s.i - i) + Math.abs(s.j - j) < 4) { clear = false; break; }
            if (Math.abs(this.well.i - i) + Math.abs(this.well.j - j) < 3) clear = false;
            if (clear) return { i, j };
        }
        return null;
    }

    contributeBuild(farmer, dt) {
        const pr = this.project;
        if (!pr) return;
        pr.builders.add(farmer);
        pr.points += dt * (1 + Math.max(0, mod(farmer.sheet.stats.str)) * 0.2) * this.workMult;
        if (pr.points >= pr.needed) this.#completeProject();
    }

    #completeProject() {
        const pr = this.project;
        this.project = null;
        const { type, site, label, perk } = pr;
        if (type === 'board') {
            // the bulletin board is its own thing (rendered from world.board, an obstacle) —
            // not a buffed structure. Once it's up, farmers can post jobs.
            this.board = { i: site.i, j: site.j };
        } else {
            this.structures.push({ type, i: site.i, j: site.j });
            this.set(site.i, site.j, T.STRUCT);
            if (type === 'toolshed') this.workMult *= 1.12;
            else if (type === 'windmill') this.growthMult *= 1.15;
            else if (type === 'tower') this.lightningMult = 0.5;
            else if (type === 'well2') this.wells.push({ i: site.i, j: site.j });
        }
        this.addLog(`The ${label} is finished! ${perk}`, '#f0d060');
        for (const f of pr.builders) {
            f.gainXP(6); f.say('HOORAY!', '#f0d060'); f.sparkle = 3;
            for (const g of pr.builders) if (g !== f && this.rand() < 0.6) this.addBond(f, g);
        }
    }

    // ---- help board (generic; helper works whatever the plot needs) --------------

    // Effort estimate for a farmer's current backlog (drives the reward a poster offers
    // and the price a helper asks).
    jobDifficulty(farmer) {
        let d = 0;                        // urgent work drives most of it
        for (const c of this.crops.values()) { if (c.owner !== farmer || c.withered) continue; if (c.stage === 3) d += 1.2; else if (c.water < 0.3) d += 0.8; }
        let fieldWork = 0;                // routine tilling/sowing contributes a little, capped
        for (const fld of farmer.plot.fields) { const t = this.get(fld.i, fld.j); if (t === T.GRASS) fieldWork += 0.15; else if (t === T.TILLED && !this.cropAt(fld.i, fld.j)) fieldWork += 0.3; }
        d += Math.min(fieldWork, 3);
        return Math.max(1, Math.min(12, Math.round(d)));
    }
    goodLabel(good) { return good; }
    // What a poster will pay: an initial offer + a private ceiling. Collaborative/honest bots
    // pay closer to fair; low-honesty bots lowball. Picks the good they can most spare.
    chooseReward(farmer, difficulty) {
        const s = farmer.sheet, p = s.personality;
        const pools = [{ good: 'wood', have: farmer.wood }, { good: 'ore', have: farmer.ore }, { good: 'crops', have: s.produce || 0 }];
        for (const [g, n] of Object.entries(s.goods || {})) pools.push({ good: g, have: n });
        pools.sort((a, b) => b.have - a.have);
        const pick = pools.find(pl => pl.have > 0);
        if (!pick) return null;
        const fair = difficulty * 0.7;
        const offer = Math.max(1, Math.min(pick.have, Math.round(fair * (0.5 + p.collaboration * 0.4 + p.honesty * 0.3))));
        const max = Math.max(offer, Math.min(pick.have, Math.round(fair * (0.9 + p.honesty * 0.5))));
        return { good: pick.good, offer, max };
    }
    transferGood(from, to, good, amount) {
        let avail;
        if (good === 'wood') avail = from.wood; else if (good === 'ore') avail = from.ore;
        else if (good === 'crops') avail = from.sheet.produce || 0; else avail = (from.sheet.goods && from.sheet.goods[good]) || 0;
        const n = Math.min(amount, avail);
        if (n <= 0) return 0;
        if (good === 'wood') { from.wood -= n; to.wood += n; }
        else if (good === 'ore') { from.ore -= n; to.ore += n; }
        // crops move a spendable produce balance, NOT lifetime `harvested` (which gates leveling/upgrades)
        else if (good === 'crops') { from.sheet.produce -= n; to.sheet.produce = (to.sheet.produce || 0) + n; }
        else { from.sheet.goods[good] -= n; to.sheet.goods = to.sheet.goods || {}; to.sheet.goods[good] = (to.sheet.goods[good] || 0) + n; }
        return n;
    }

    postHelp(farmer, genuine = true) {
        if (!this.board) return;   // no jobs until the town builds the bulletin board
        if (this.helpBoard.some(r => r.farmer === farmer)) return;
        const difficulty = this.jobDifficulty(farmer);
        const reward = this.chooseReward(farmer, difficulty);
        this.helpBoard.push({ farmer, genuine, difficulty, reward });
        const rtxt = reward ? ` (offers ${reward.offer} ${this.goodLabel(reward.good)})` : '';
        this.addLog(`${farmer.sheet.name} posted for a hand${rtxt}`, '#e0a03c');
    }

    // A helper weighs each posting: accept if the pay meets their asking price (altruists help
    // regardless), else haggle up to the poster's ceiling, else decline. Returns {req, agreed}.
    takeHelp(helper) {
        const hp = helper.sheet.personality;
        for (let i = 0; i < this.helpBoard.length; i++) {
            const req = this.helpBoard[i];
            if (req.farmer === helper) continue;
            if (req.farmer.reputation < 0.3 && this.rand() > hp.collaboration) continue;   // shun bad reputations
            const altruist = hp.collaboration > 0.7 || (helper.sheet.stats.cha >= 15 && hp.honesty > 0.5);
            const offered = req.reward ? req.reward.offer : 0;
            const ask = Math.max(1, Math.round(req.difficulty * (0.5 + hp.competitiveness * 0.5 - hp.collaboration * 0.3)));
            if (altruist || offered >= ask || !req.reward) {
                this.helpBoard.splice(i, 1);
                return { req, agreed: req.reward ? { good: req.reward.good, amount: offered } : null };
            }
            if (ask <= req.reward.max) {   // counteroffer within the poster's ceiling
                this.addLog(`${helper.sheet.name} haggled ${req.farmer.sheet.name} up to ${ask} ${this.goodLabel(req.reward.good)}`, '#c9a45a');
                this.helpBoard.splice(i, 1);
                return { req, agreed: { good: req.reward.good, amount: ask } };
            }
            // otherwise decline this posting and consider the next
        }
        return null;
    }

    clearHelp(farmer) { this.helpBoard = this.helpBoard.filter(r => r.farmer !== farmer); }

    // ---- weather -----------------------------------------------------------------

    #rollWeather() {
        const table = WEATHER_STATES[this.weather].next;
        const seasonBias = this.seasonDef.weather;
        const blended = {}; let sum = 0;
        for (const [state, w] of Object.entries(table)) { const v = w * (0.4 + (seasonBias[state] ?? 1)); blended[state] = v; sum += v; }
        let r = this.rand() * sum;
        for (const [state, w] of Object.entries(blended)) { r -= w; if (r <= 0) { this.#setWeather(state); return; } }
    }

    #setWeather(state) {
        this.weather = state;
        const [lo, hi] = WEATHER_STATES[state].dur;
        this.weatherTimer = lo + this.rand() * (hi - lo);
        const colors = { sun: '#f0d060', cloud: '#9aa0b4', rain: '#6a9ade', storm: '#c05840', drought: '#e0a03c' };
        this.addLog(`Weather: ${WEATHER_STATES[state].label}`, colors[state]);
    }

    get weatherLabel() { return WEATHER_STATES[this.weather].label; }

    // ---- crops -------------------------------------------------------------------

    cropAt(i, j) { return this.crops.get(`${i},${j}`); }
    plantCrop(i, j, type, owner) {
        this.crops.set(`${i},${j}`, { i, j, type, owner, stage: 0, growth: 0, water: 0.7, withered: false, dryTime: 0 });
    }

    #tickCrops(dt) {
        const growthBonus = { sun: 1.15, cloud: 1, rain: 1.2, storm: 0.6, drought: 0.55 }[this.weather];
        const season = this.seasonDef;
        const waterDecay = { sun: 0.014, cloud: 0.007, rain: 0, storm: 0, drought: 0.045 }[this.weather] * season.waterMul;
        const night = this.isNight();
        for (const crop of this.crops.values()) {
            if (crop.withered) continue;
            if (this.weather === 'rain' || this.weather === 'storm') crop.water = 1;
            crop.water = Math.max(0, crop.water - waterDecay * dt);
            if (crop.water <= 0.02) {
                crop.dryTime += dt;
                if (crop.dryTime > 14 && this.rand() < dt * 0.05) {
                    crop.withered = true;
                    this.addLog(`A ${crop.type} withered on ${crop.owner.sheet.name}'s farm`, '#e0a03c');
                    continue;
                }
            } else crop.dryTime = 0;
            if (!night && crop.stage < 3) {
                // ~1 stage per day of daylight -> seed -> sprout -> plant -> ripe
                // takes several days (Stardew-style), so farmers do other things
                // (forage, chop, build, help) while crops mature.
                const greenThumb = 1 + mod(crop.owner.sheet.stats.int) * 0.06;
                const waterFactor = 0.35 + 0.65 * crop.water;
                crop.growth += (dt / DAY_LENGTH) * waterFactor * growthBonus * greenThumb * this.growthMult * season.growth;
                if (crop.growth >= 1) { crop.growth = 0; crop.stage++; }
            }
        }
    }

    // ---- producers (facility animals / pond life) --------------------------------

    #tickProducers(dt) {
        const season = this.seasonDef;
        const stormy = this.weather === 'storm';
        const night = this.isNight();
        for (const plot of this.plots) {
            for (const fac of plot.facilities) {
                for (const p of fac.producers) {
                    const cfg = PROD[p.kind];
                    p.anim += dt;
                    p.fed = Math.max(0, p.fed - cfg.feedDecay * dt);
                    if (!p.ready) {
                        const rate = cfg.rate * (0.3 + 0.7 * p.fed) * season.growth * (stormy ? 0.4 : 1) * (night ? 0.5 : 1);
                        p.prod += dt * rate;
                        if (p.prod >= 1) { p.prod = 1; p.ready = true; }
                    }
                    // gentle wandering within the facility region
                    if (cfg.wander && !p.busy && !(stormy && p.kind !== 'fish')) {
                        p.wanderT -= dt;
                        if (p.wanderT <= 0) {
                            p.wanderT = 0.6 + this.rand() * 1.8;
                            const ang = this.rand() * Math.PI * 2;
                            const spd = (p.kind === 'chicken' ? 0.5 : p.kind === 'fish' ? 0.35 : 0.28);
                            p.vx = Math.cos(ang) * spd; p.vy = Math.sin(ang) * spd;
                            if (Math.abs(p.vx) > 0.02) p.flip = p.vx > 0 ? 1 : -1;
                            if (p.kind === 'chicken') p.hop = 0.35;
                        }
                        p.fx += p.vx * dt; p.fy += p.vy * dt;
                        const r = p.region, pad = 0.35;
                        if (p.fx < r.x + pad) { p.fx = r.x + pad; p.vx = Math.abs(p.vx); }
                        if (p.fx > r.x + r.w - pad) { p.fx = r.x + r.w - pad; p.vx = -Math.abs(p.vx); }
                        if (p.fy < r.y + pad) { p.fy = r.y + pad; p.vy = Math.abs(p.vy); }
                        if (p.fy > r.y + r.h - pad) { p.fy = r.y + r.h - pad; p.vy = -Math.abs(p.vy); }
                        if (p.hop > 0) p.hop = Math.max(0, p.hop - dt);
                    }
                }
            }
        }
    }

    plotOwnerOf(plot) { return this.farmers.find(f => f.plot === plot); }

    #tickLightning(dt) {
        this.lightningFlash = Math.max(0, this.lightningFlash - dt * 3);
        if (this.weather !== 'storm') return;
        this.lightningTimer -= dt;
        if (this.lightningTimer <= 0) {
            this.lightningTimer = (2.5 + this.rand() * 5) / this.lightningMult;
            this.lightningFlash = 1;
            const crops = [...this.crops.values()].filter(c => !c.withered && c.stage > 0);
            if (crops.length && this.rand() < 0.75) {
                const crop = crops[Math.floor(this.rand() * crops.length)];
                const save = d20(this.rand, mod(crop.owner.sheet.stats.con));
                this.struckTile = { i: crop.i, j: crop.j, t: 1 };
                if (save.total >= 12 || save.crit) this.addLog(`Lightning! ${crop.owner.sheet.name}'s ${crop.type} saved (d20:${save.roll}${save.mod >= 0 ? '+' : ''}${save.mod}=${save.total})`, '#6a9ade');
                else {
                    crop.stage = Math.max(0, crop.stage - 1);
                    if (this.rand() < 0.3) crop.withered = true;
                    this.addLog(`Lightning hit ${crop.owner.sheet.name}'s ${crop.type}! (save ${save.total} vs 12)`, '#c05840');
                }
            }
        }
        if (this.struckTile) { this.struckTile.t -= dt * 1.5; if (this.struckTile.t <= 0) this.struckTile = null; }
    }

    #dailyHealthCheck() {
        for (const f of this.farmers) {
            if (f.health === 'sick') {
                f.sickDays -= 1;
                if (f.sickDays <= 0) {
                    f.health = 'healthy'; f.energy = Math.max(f.energy, 0.5);
                    this.addLog(`${f.sheet.name} recovered and is back on their feet.`, '#7dd069');
                    f.say('ALL BETTER!', '#7dd069');
                }
                f.workedLate = false; continue;
            }
            if (f.workedLate) f.sleepDebt += 1.5; else f.sleepDebt = Math.max(0, f.sleepDebt - 1);
            f.workedLate = false;
            const risky = f.energy < 0.35 || f.sleepDebt >= 3 || f.strain >= 4;
            if (risky) {
                const dc = 10 + Math.floor(f.sleepDebt) + (f.energy < 0.2 ? 3 : 0) + Math.floor(f.strain / 3);
                const save = d20(this.rand, mod(f.sheet.stats.con));
                if (save.total < dc && !save.crit) {
                    f.health = 'sick'; f.sickDays = 2 + Math.floor(this.rand() * 3) + (f.strain >= 8 ? 2 : 0); f.energy = Math.min(f.energy, 0.3);
                    this.addLog(`${f.sheet.name} fell ill from overwork! (CON ${save.total} vs DC ${dc})`, '#c05840');
                    f.say('I... dont feel well', '#c05840');
                } else if (f.sleepDebt >= 2 || f.strain >= 5) this.addLog(`${f.sheet.name} looks worn out but powers through (CON ${save.total} vs ${dc})`, '#e0a03c');
            }
            f.strain = Math.max(0, f.strain - 4);   // a night's rest works off most of the strain
        }
    }

    // ---- main tick ---------------------------------------------------------------

    tick(dt) {
        this.clock += dt;
        if (this.clock >= DAY_LENGTH + NIGHT_LENGTH) {
            this.clock = 0; this.day++;
            this.#dailyHealthCheck();
            this.#advanceSeason();
            this.#regrowWild();
            this.#encroach();
            this.addLog(`Day ${this.day} begins on Ry Farms`, '#f0d060');
            if (this.rand() < 0.5) this.#rollWeather();
        }
        this.weatherTimer -= dt;
        if (this.weatherTimer <= 0) this.#rollWeather();
        this.#tickCrops(dt);
        this.#tickProducers(dt);
        this.#tickLightning(dt);
        this.#maybeStartProject();
        this.updateLeader();
        for (const f of this.farmers) f.tick(dt);
    }
}

const PROJECT_DEFS = [
    { type: 'board', label: 'BULLETIN BOARD', at: 8, needed: 22, perk: 'FARMERS CAN POST JOBS' },
    { type: 'toolshed', label: 'TOOLSHED', at: 20, needed: 30, perk: 'ALL WORK +12% FASTER' },
    { type: 'windmill', label: 'WINDMILL', at: 55, needed: 45, perk: 'CROPS GROW +15% FASTER' },
    { type: 'tower', label: 'STORM TOWER', at: 100, needed: 55, perk: 'LIGHTNING HALVED' },
    { type: 'well2', label: 'SECOND WELL', at: 160, needed: 65, perk: 'SHORTER WATER RUNS' },
];

// ---------------------------------------------------------------------------
// Farmer agent
// ---------------------------------------------------------------------------

const ACTION_TIME = { till: 3.2, plant: 2.2, water: 1.6, harvest: 2.6, clear: 2.0 };

const IDLE_THOUGHTS = [
    'NICE DAY OUT HERE',
    'THE SOIL SMELLS GOOD TODAY',
    'I SHOULD VISIT THE WELL LATER',
    'WONDER HOW THE NEIGHBORS ARE DOING',
    'A GOOD FENCE MAKES A GOOD FARM',
];

const FACILITY_YIELD_NAME = { pad: 'lily', fish: 'fish', chicken: 'egg', cow: 'milk', pig: 'truffle', goat: 'milk' };

export class Farmer {
    constructor(sheet, plot, world) {
        this.sheet = sheet;
        this.plot = plot;
        this.world = world;
        this.rand = mulberry32(sheet.seed ^ 0x51ed);
        this.p = sheet.personality;

        this.pos = { i: plot.x + 3, j: plot.y + 3 };
        this.state = 'decide';
        this.action = null;
        this.path = null;
        this.facing = 1;
        this.moveDir = 'down';   // which sheet row (down/side/up) the 4-way sprite faces
        this.stuckTimer = 0; this.lastGoalDist = Infinity;   // walk-stuck safety net
        this.carryWater = 0;
        this.carryCrop = null;     // { type, t } — produce held up briefly after a harvest
        this.bubble = null;
        this.sparkle = 0;
        this.wanderTimer = 0;
        this.animTime = this.rand() * 10;

        this.thought = 'A NEW FARM. A NEW LIFE.';
        this.thoughtBubbleTimer = 4 + this.rand() * 8;
        this.helpTask = null;
        this.helpCooldown = 0;
        this.nextExpand = 8 + (sheet.seed % 5);      // jitter so farms don't grow in lockstep
        this.nextFacility = 12 + (sheet.seed % 6);
        this.targetProd = null;

        // resource inventory (tradeable): wood from trees, ore from rocks, plus sheet.goods forage
        this.wood = START_WOOD;
        this.ore = 0;
        this.wantExpand = false;
        this.wantFacility = false;
        this.woodTarget = null;

        this.energy = 0.8 + this.rand() * 0.2;
        this.sleepDebt = 0;
        this.strain = 0;   // accumulates when laboring while exhausted -> sickness risk
        this.health = 'healthy';
        this.sickDays = 0;
        this.workedLate = false;
        this.reputation = 0.55;
        this.poachCooldown = 6 + this.rand() * 10;
        this.visitedSick = new Set();
    }

    get tired() { return this.energy < 0.35; }

    get speed() {
        // V3: farmers bustle at ~2x
        let s = (1.7 + mod(this.sheet.stats.dex) * 0.22) * 2;
        if (this.health === 'sick') s *= 0.6;
        if (this.tired) s *= 0.8;
        return Math.max(1.2, s);
    }

    get maxWater() { return this.sheet.stats.str >= 14 ? 4 : 2; }

    workSpeed() {
        let s = (1 + mod(this.sheet.stats.dex) * 0.08) * this.world.workMult;
        s *= (0.55 + 0.45 * Math.max(0, this.energy));
        if (this.health === 'sick') s *= 0.4;
        for (const other of this.world.farmers) {
            if (other === this || other.sheet.stats.cha < 14) continue;
            const d = Math.abs(other.pos.i - this.pos.i) + Math.abs(other.pos.j - this.pos.j);
            if (d < 6) { s *= 1.15; break; }
        }
        return Math.max(0.2, s);
    }

    say(text, color = '#fff') { this.bubble = { text, color, t: 2.4 }; }

    think(text) {
        this.thought = text.toUpperCase();
        if (this.thoughtBubbleTimer <= 0) {
            this.say(this.thought.length > 26 ? this.thought.slice(0, 26) + '..' : this.thought, '#c8ccd8');
            this.thoughtBubbleTimer = 9 + this.rand() * 10;
        }
    }

    adjustReputation(d) { this.reputation = Math.max(0, Math.min(1, this.reputation + d)); }

    gainXP(n) {
        const s = this.sheet;
        s.xp += n;
        if (s.xp >= s.level * 12) {
            s.xp = 0; s.level++;
            const up = ['str', 'dex', 'con', 'int', 'wis', 'cha'][Math.floor(this.rand() * 6)];
            s.stats[up] = Math.min(20, s.stats[up] + 1);
            this.world.addLog(`${s.name} reached LV ${s.level}! +1 ${up.toUpperCase()}`, '#7dd069');
            this.sparkle = 2.5; this.say('LEVEL UP!', '#7dd069');
        }
    }

    isBehindLeader() {
        const L = this.world.leader;
        return L && L !== this && L.sheet.harvested > this.sheet.harvested + 2;
    }

    // ---- perception -------------------------------------------------------------

    #findCrop(pred, plot = this.plot) {
        let best = null, bestD = 1e9;
        for (const f of plot.fields) {
            const crop = this.world.cropAt(f.i, f.j);
            if (!crop || !pred(crop)) continue;
            const d = Math.abs(f.i - this.pos.i) + Math.abs(f.j - this.pos.j);
            if (d < bestD) { bestD = d; best = crop; }
        }
        return best;
    }
    #findField(pred, plot = this.plot) {
        let best = null, bestD = 1e9;
        for (const f of plot.fields) {
            if (!pred(f)) continue;
            const d = Math.abs(f.i - this.pos.i) + Math.abs(f.j - this.pos.j);
            if (d < bestD) { bestD = d; best = f; }
        }
        return best;
    }
    #findProducer(pred, plot = this.plot) {
        let best = null, bestD = 1e9;
        for (const fac of plot.facilities) for (const p of fac.producers) {
            if (!pred(p)) continue;
            const d = Math.abs(p.fx - this.pos.i) + Math.abs(p.fy - this.pos.j);
            if (d < bestD) { bestD = d; best = p; }
        }
        return best;
    }

    // The unified "what needs doing on this plot" — crops AND facilities.
    // urgentOnly=true skips the low-priority sow/till "fill" work so a farmer
    // will choose to GROW the farm (expand/build) rather than endlessly tilling.
    #nextTaskOnPlot(plot, thirstThreshold = 0.32, urgentOnly = false) {
        // 1. collect anything ready (ripe crops, eggs, milk, blooms, catchable fish)
        const readyProd = this.#findProducer(p => p.ready, plot);
        const ripe = this.#findCrop(c => c.stage === 3 && !c.withered, plot);
        if (readyProd && (!ripe || Math.abs(readyProd.fx - this.pos.i) + Math.abs(readyProd.fy - this.pos.j) <
            Math.abs(ripe.i - this.pos.i) + Math.abs(ripe.j - this.pos.j)))
            return { act: 'collect', prod: readyProd };
        if (ripe) return { act: 'harvest', crop: ripe };
        // 2. tidy withered
        const dead = this.#findCrop(c => c.withered, plot);
        if (dead) return { act: 'clear', crop: dead };
        // 3. sustain: water thirsty crops, feed/tend hungry producers
        const thirsty = this.#findCrop(c => !c.withered && c.water < thirstThreshold && c.stage < 3, plot);
        if (thirsty) return { act: 'water', crop: thirsty };
        const hungry = this.#findProducer(p => p.fed < 0.35, plot);
        if (hungry) return { act: 'tend', prod: hungry };
        if (urgentOnly) return null;
        // 4. sow + till (crop farms only) — lowest priority "fill" work
        const emptyTilled = this.#findField(f => this.world.get(f.i, f.j) === T.TILLED && !this.world.cropAt(f.i, f.j), plot);
        if (emptyTilled) return { act: 'plant', field: emptyTilled };
        const untilled = this.#findField(f => this.world.get(f.i, f.j) === T.GRASS, plot);
        if (untilled) return { act: 'till', field: untilled };
        return null;
    }

    #countPending(plot) {
        let n = 0;
        for (const fac of plot.facilities) for (const p of fac.producers) if (p.ready || p.fed < 0.3) n++;
        n += this.#countCrops(c => (c.stage === 3 && !c.withered) || (c.water < 0.3 && c.stage < 3), plot);
        return n;
    }
    #countCrops(pred, plot = this.plot) {
        let n = 0;
        for (const f of plot.fields) { const c = this.world.cropAt(f.i, f.j); if (c && pred(c)) n++; }
        return n;
    }

    #nearestNeighborLoot() {
        // a collectible on someone else's plot (ripe crop OR ready producer) for poaching
        let best = null, bestD = 9;
        for (const plot of this.world.plots) {
            if (plot === this.plot) continue;
            for (const f of plot.fields) {
                const crop = this.world.cropAt(f.i, f.j);
                if (crop && crop.stage === 3 && !crop.withered) {
                    const d = Math.abs(f.i - this.pos.i) + Math.abs(f.j - this.pos.j);
                    if (d < bestD) { bestD = d; best = { crop }; }
                }
            }
            for (const fac of plot.facilities) for (const p of fac.producers) {
                if (!p.ready) continue;
                const d = Math.abs(p.fx - this.pos.i) + Math.abs(p.fy - this.pos.j);
                if (d < bestD) { bestD = d; best = { prod: p, plot }; }
            }
        }
        return best;
    }

    #shouldSleepNow() {
        if (this.health === 'sick') return true;
        if (this.energy < 0.2) return true;
        const np = this.world.nightProgress();
        let threshold = 0.1 + this.p.diligence * 0.55;
        if (this.isBehindLeader()) threshold += this.p.competitiveness * 0.3;
        return np > Math.min(threshold, 0.85);
    }

    #maybeAskForHelp() {
        if (this.helpCooldown > 0) return;
        const pending = this.#countPending(this.plot);
        const weak = mod(this.sheet.stats.str) <= 0 || mod(this.sheet.stats.dex) <= 0;
        let genuine = true, ask = false;
        if (pending >= 4 && weak) ask = true;
        else if (this.p.honesty < 0.3 && this.p.collaboration < 0.5 && this.rand() < 0.1) { ask = true; genuine = false; this.think('IF I LOOK BUSY, SOMEONE WILL HELP'); }
        if (ask) { this.world.postHelp(this, genuine); this.helpCooldown = 30; if (genuine) this.think('SO MUCH TO DO... I COULD USE A HAND'); }
    }

    // A raw settler clears their land, fences it, then raises a house — before normal farming.
    // Returns true if it took an action this tick.
    #pursueHomestead() {
        const w = this.world, p = this.plot;
        if (p.built.level >= 1 || w.isNight()) return false;
        const c = HOUSE_TIERS[1];
        // 1) fence the claim first — one post at a time (a real chunk of work)
        if (!p.built.fence) {
            if (!p.fenceTarget) p.fenceTarget = w.fencePostTarget(p);
            const needWood = (p.fencePosts % 2 === 0);   // ~1 wood per 2 posts
            if (needWood && this.wood < 1) {
                this.think(this.wood > 0 ? 'MORE WOOD FOR THE FENCE' : 'GATHERING WOOD TO FENCE MY LAND');
                if (this.#goChop()) return true;
                this.#backoff(); return true;
            }
            const spot = w.fencePostSpot(p, p.fencePosts);
            this.pendingFence = { needWood };
            this.think(`RAISING FENCE POST ${p.fencePosts + 1}/${p.fenceTarget}`);
            if (this.#goTo(spot.i + 0.5, spot.j + 0.5, 'fencepost')) return true;
            this.#backoff(); return true;
        }
        // 2) clear the whole building site of trees/rocks/brush
        if (!w.houseSiteClear(p)) {
            const b = this.#nearestSiteBlocker();
            if (b) { this.think('CLEARING GROUND FOR MY HOME'); this.#clearObstacle(b); return true; }
        }
        // 3) pitch the level-1 tipi once timber + stone are stockpiled
        if (this.wood >= c.wood && this.ore >= c.ore) { w.raiseBuilding(this, 1); this.say('A ROOF!', '#f0d060'); this.sparkle = 2.5; return true; }
        // 4) gather what's still missing (stone, then timber)
        if (this.ore < c.ore) {
            const rock = w.nearestRock(this.pos, 40);
            if (rock) { this.mineTarget = rock; if (this.#goTo(rock.i + 0.5, rock.j + 0.5, 'mine')) { this.think('MINING STONE FOR MY HOME'); return true; } }
        }
        this.think(this.wood > 0 ? 'MORE TIMBER FOR MY HOME' : 'FELLING TIMBER FOR MY HOME');
        if (this.#goChop()) return true;
        this.#backoff(); return true;
    }
    #backoff() { this.state = 'idle'; this.wanderTimer = 1.5 + this.rand() * 2; }
    // Save toward the next dwelling tier; upgrade when affordable. Low priority (runs after
    // normal farm work), so L2/L3 accrete slowly from surplus timber/stone over many days.
    #maybeUpgradeHome() {
        const w = this.world, p = this.plot;
        if (p.built.level < 1 || p.built.level >= 3 || w.isNight()) return false;
        const next = p.built.level + 1;
        if (!w.canBuild(this, next)) return false;   // can't afford yet — keep farming and saving
        // afford it: clear the site of any encroaching trees/rocks/brush BEFORE raising it
        if (!w.houseSiteClear(p)) {
            const b = this.#nearestSiteBlocker();
            if (b) { this.think('CLEARING SPACE TO UPGRADE MY HOME'); this.#clearObstacle(b); return true; }
        }
        w.raiseBuilding(this, next);
        this.say(next >= 3 ? 'A REAL HOME!' : 'A BIGGER HOME!', '#f0d060'); this.sparkle = 2.5;
        return true;
    }
    // Nearest tree/stump/rock/brush sitting ON my own plot cells (clutter to clear for farmland).
    #nearestPlotObstacle() {
        const w = this.world, p = this.plot;
        let best = null, bestD = 1e9;
        for (const key of p.cells) {
            const ci = key.indexOf(','), i = +key.slice(0, ci), j = +key.slice(ci + 1);
            const t = w.get(i, j);
            let kind = null;
            if (t === T.TREE) kind = 'tree'; else if (t === T.STUMP) kind = 'stump';
            else if (t === T.ROCK) kind = 'rock'; else if (t === T.FLOWER || t === T.WHEAT) kind = 'forage';
            if (!kind) continue;
            const d = Math.abs(i - this.pos.i) + Math.abs(j - this.pos.j);
            if (d < bestD) { bestD = d; best = { i, j, kind, tile: t }; }
        }
        return best;
    }
    #clearObstacle(ob) {
        if (ob.kind === 'rock') { this.think('CLEARING THIS ROCK FOR MORE FIELD'); this.mineTarget = ob; this.#goTo(ob.i + 0.5, ob.j + 0.5, 'mine'); }
        else if (ob.kind === 'forage') { this.think('CLEARING BRUSH FOR MORE FIELD'); this.forageTarget = { i: ob.i, j: ob.j, tile: ob.tile }; this.#goTo(ob.i + 0.5, ob.j + 0.5, 'forage'); }
        else { this.think('CLEARING TIMBER FOR MORE FIELD'); this.woodTarget = ob; this.#goTo(ob.i + 0.5, ob.j + 0.5, ob.kind === 'stump' ? 'break' : 'chop'); }
    }
    #nearestSiteBlocker() {
        const w = this.world, h = this.plot.house, S = World.SITE;
        let best = null, bestD = 1e9;
        for (let dj = S.dj0; dj <= S.dj1; dj++) for (let di = S.di0; di <= S.di1; di++) {
            const i = h.i + di, j = h.j + dj, t = w.get(i, j);
            let kind = null;
            if (t === T.TREE) kind = 'tree'; else if (t === T.STUMP) kind = 'stump';
            else if (t === T.ROCK) kind = 'rock'; else if (t === T.FLOWER || t === T.WHEAT) kind = 'forage';
            if (!kind) continue;
            const d = Math.abs(i - this.pos.i) + Math.abs(j - this.pos.j);
            if (d < bestD) { bestD = d; best = { i, j, kind, tile: t }; }
        }
        return best;
    }

    // ---- deciding ---------------------------------------------------------------

    #decide() {
        const w = this.world, s = this.sheet;

        if (this.health === 'sick') { this.think('NEED TO REST AND GET WELL'); this.#goHome('sick'); return; }
        // exhaustion: worn down and still grinding -> pushed to rest; pushing through deep
        // strain can make you collapse and fall ill on the spot.
        if (!w.isNight() && this.energy < 0.16) {
            if (this.strain >= 8) {
                const save = d20(this.rand, mod(s.stats.con));
                if (save.total < 12 && !save.crit) {
                    this.health = 'sick'; this.sickDays = 3 + Math.floor(this.rand() * 3); this.strain = 0;
                    w.addLog(`${s.name} collapsed from exhaustion and took ill! (CON ${save.total} vs 12)`, '#c05840');
                    this.say('I overdid it...', '#c05840'); this.#goHome('sick'); return;
                }
            }
            this.think(this.strain >= 5 ? 'IM BURNT OUT. I HAVE TO STOP.' : 'IM SPENT. NEED TO REST.');
            this.#goHome('rest'); return;
        }
        if (w.isNight()) {
            if (this.#shouldSleepNow()) { this.think(this.p.diligence > 0.6 ? 'ONE MORE THING... OK, BED.' : 'TIME TO SLEEP'); this.#goHome('sleepwalk'); return; }
            this.awakeAtNight = true;
            if (w.nightProgress() > 0.4) this.workedLate = true;
        }

        if (w.weather === 'storm') {
            const ripe = this.#findCrop(c => c.stage === 3 && !c.withered);
            if (ripe && s.stats.wis >= 13) { this.think("STORM'S HERE. SAVE THE CROPS!"); this.#pursue({ act: 'harvest', crop: ripe }, this.plot, false); return; }
            if (s.stats.con < 13) { this.think('I HATE THUNDER. HIDING.'); this.#goHome('shelter'); return; }
        }

        // a new settler must clear their land, fence it, then build a house before farming
        if (this.plot.built.level < 1 && this.#pursueHomestead()) return;
        if (this.#maybeUpgradeHome()) return;

        if (this.p.collaboration > 0.55 && !w.isNight()) {
            const sick = w.farmers.find(o => o !== this && o.health === 'sick' && !this.visitedSick.has(o.sheet.seed) &&
                Math.abs(o.pos.i - this.pos.i) + Math.abs(o.pos.j - this.pos.j) < 16);
            if (sick && this.rand() < 0.5) {
                this.visitedSick.add(sick.sheet.seed); this.careTarget = sick;
                this.think(`${sick.sheet.name.split(' ')[0].toUpperCase()} IS SICK. I'LL LOOK IN.`);
                this.#goTo(sick.plot.house.i + 0.5, sick.plot.house.j + 2.5, 'care'); return;
            }
        }

        this.#maybeAskForHelp();

        const thirstThreshold = w.weather === 'drought' && mod(s.stats.wis) > 0 ? 0.55 : 0.32;

        // 1. urgent farm chores (collect/harvest/water/tend — not filler tilling)
        const urgent = this.#nextTaskOnPlot(this.plot, thirstThreshold, true);
        if (urgent) { this.#thinkTask(urgent); this.#pursue(urgent, this.plot, false); return; }

        // 1b. grow the homestead: gather wood, clear land, fence/build
        if ((this.wantExpand || this.wantFacility) && !w.isNight()) {
            const grew = this.#pursueGrowth();
            if (grew) return;
        }

        // 1c. fill work: sow seeds, till new ground
        const fill = this.#nextTaskOnPlot(this.plot, thirstThreshold, false);

        // 1d. clear brush/trees/rocks ON my own plot to open more farmland. Interleaves with
        //     tilling (diligent bots clear more eagerly) so plots don't stay cluttered.
        if (!w.isNight()) {
            const ob = this.#nearestPlotObstacle();
            if (ob && (!fill || this.rand() < 0.35 + this.p.diligence * 0.35)) { this.#clearObstacle(ob); return; }
        }

        if (fill) { this.#thinkTask(fill); this.#pursue(fill, this.plot, false); return; }

        // 2. help a neighbor (for an agreed reward)
        const taken = w.takeHelp(this);
        if (taken) {
            const req = taken.req;
            this.helpTask = { requester: req.farmer, actionsLeft: 3 + Math.floor(this.rand() * 3), genuine: req.genuine, didWork: false, reward: taken.agreed };
            this.think(`${req.farmer.sheet.name.toUpperCase()} NEEDS A HAND!`);
            const payFor = taken.agreed ? ` FOR ${taken.agreed.amount} ${w.goodLabel(taken.agreed.good).toUpperCase()}` : '';
            this.say(`COMING ${req.farmer.sheet.name.split(' ')[0].toUpperCase()}!`, '#7dd069');
            w.addLog(`${s.name} took ${req.farmer.sheet.name}'s job${payFor}`, '#7dd069');
            this.state = 'decide-help'; return;
        }

        // 3. manipulators poach a neighbor's loot
        if (this.p.honesty < 0.32 && this.poachCooldown <= 0 && !w.isNight()) {
            const steal = this.#nearestNeighborLoot();
            if (steal) { this.think('NOBODYS WATCHING THAT ONE...'); this.#pursuePoach(steal); return; }
        }

        // 4. town project
        if (w.project && this.p.collaboration > 0.35 && this.energy > 0.3) {
            this.think(`RAISING THE ${w.project.label}!`);
            const site = w.project.site; const off = (this.sheet.seed % 3) - 1;
            this.#goTo(site.i + 0.5 + off, site.j + 1.6, 'build'); return;
        }

        // 5. competitive & behind: grind
        if (this.isBehindLeader() && this.p.competitiveness > 0.55 && this.energy > 0.4) {
            const anyField = this.#findField(f => w.get(f.i, f.j) === T.GRASS) || this.#findField(f => w.get(f.i, f.j) === T.TILLED && !w.cropAt(f.i, f.j));
            if (anyField) { this.think('I WILL NOT FALL BEHIND'); this.#pursue({ act: w.get(anyField.i, anyField.j) === T.GRASS ? 'till' : 'plant', field: anyField }, this.plot, false); return; }
        }

        // 5b. forage wild wheat / wildflowers growing nearby (free food + goods)
        if (!w.isNight() && this.energy > 0.3) {
            const wild = w.nearestForage(this.pos, 15);
            if (wild) { this.think(wild.tile === T.FLOWER ? 'WILDFLOWERS! WORTH GATHERING.' : 'WILD WHEAT! A FREE FORAGE.'); this.forageTarget = wild; this.#goTo(wild.i + 0.5, wild.j + 0.5, 'forage'); return; }
        }

        // 5c. mine a nearby rock for ore — diligent/strong bots do this on downtime
        if (!w.isNight() && this.energy > 0.35 && this.rand() < 0.3 + this.p.diligence * 0.4 + Math.max(0, mod(s.stats.str)) * 0.05) {
            const rock = w.nearestRock(this.pos, 9);
            if (rock) { this.think('GOOD STONE HERE — ORE FOR BUILDING.'); this.mineTarget = rock; this.#goTo(rock.i + 0.5, rock.j + 0.5, 'mine'); return; }
        }

        // 6. wander + muse
        this.think(this.rand() < 0.4 ? `REMEMBERING: ${String(s.memory.title).slice(0, 26)}..` : IDLE_THOUGHTS[Math.floor(this.rand() * IDLE_THOUGHTS.length)]);
        this.wanderTimer = 1.5 + this.rand() * 3;
        // wander to an owned interior field tile (works for L-shaped plots; never a hole/outside)
        const spots = this.plot.fields;
        if (spots.length) { const t = spots[Math.floor(this.rand() * spots.length)]; this.#goTo(t.i + 0.5, t.j + 0.5, 'wander'); }
        else this.#goTo(this.plot.house.i, this.plot.house.j + 3, 'wander');
    }

    #thinkTask(task) {
        if (task.act === 'collect' && task.prod) this.think(`GATHERING ${(FACILITY_YIELD_NAME[task.prod.kind] || 'produce').toUpperCase()}!`);
        else if (task.act === 'tend' && task.prod) this.think(task.prod.kind === 'pad' ? 'TENDING THE LILIES' : `FEEDING THE ${task.prod.kind.toUpperCase()}S`);
        else if (task.act === 'harvest') this.think(`MY ${task.crop.type.toUpperCase()} IS READY!`);
        else if (task.act === 'clear') this.think('CLEARING OUT THE DEAD ONES');
        else if (task.act === 'water') this.think('WATER FOR THE THIRSTY ONES');
        else if (task.act === 'plant') this.think(`SOWING ${this.sheet.crop.toUpperCase()} SEEDS`);
        else if (task.act === 'till') this.think('BREAKING NEW GROUND');
    }

    #decideHelp() {
        const task = this.helpTask;
        if (!task || task.actionsLeft <= 0) { this.#finishHelping(); return; }
        const plot = task.requester.plot;
        const t = this.#nextTaskOnPlot(plot);
        if (!t) { this.#finishHelping(); return; }
        this.#pursue(t, plot, true);
    }

    #finishHelping() {
        const task = this.helpTask;
        if (task) {
            const other = task.requester;
            if (task.genuine === false && !task.didWork) {
                this.think('THERE WAS NOTHING TO DO HERE. HMPH.');
                this.say('...you tricked me', '#e0a03c');
                this.world.addLog(`${this.sheet.name} realized ${other.sheet.name}'s plea was a ruse`, '#e0a03c');
                other.adjustReputation(-0.12); this.adjustReputation(0.02);
            } else {
                this.world.addBond(this, other);
                // pay the agreed reward from the requester's stores
                if (task.reward && task.reward.amount > 0) {
                    const owed = task.reward.amount;
                    const n = this.world.transferGood(other, this, task.reward.good, owed);
                    if (n >= owed) {
                        this.say(`+${n} ${task.reward.good}`, '#e8c860');
                        this.world.addLog(`${other.sheet.name} paid ${this.sheet.name} ${n} ${this.world.goodLabel(task.reward.good)}`, '#e8c860');
                        other.adjustReputation(0.03);   // paying in full builds a good name
                    } else if (n > 0) {
                        this.say(`only +${n} of ${owed}`, '#e0a03c');
                        this.world.addLog(`${other.sheet.name} short-paid ${this.sheet.name} (${n}/${owed} ${this.world.goodLabel(task.reward.good)})`, '#e0a03c');
                        other.adjustReputation(-0.05);  // couldn't cover the deal
                    } else {
                        this.say("...they couldn't pay", '#e0a03c');
                        other.adjustReputation(-0.08);  // welched entirely
                    }
                }
                this.world.addLog(`${this.sheet.name} finished helping ${other.sheet.name} (+bond)`, '#7dd069');
                other.say('THANKS FRIEND!', '#7dd069'); other.helpCooldown = 20;
                this.adjustReputation(0.05); this.gainXP(3);
            }
            this.helpTask = null;
        }
        this.state = 'decide';
    }

    // ---- growth: wood -> clear land -> fence / build -----------------------------

    // Returns true if it took an action toward growing the homestead.
    #pursueGrowth() {
        const w = this.world;

        // Facility first if wanted and there's already room + wood
        if (this.wantFacility) {
            if (w.farmerHasUnbuiltFacility(this)) {
                if (this.wood >= FACILITY_WOOD && w.buildNextFacility(this)) {
                    this.wood -= FACILITY_WOOD;
                    this.nextFacility = Math.round(this.sheet.harvested + 22 + this.rand() * 12);
                    this.wantFacility = false;
                    return true;
                }
                // no room -> need to expand; not enough wood -> go chop
                if (this.wood < FACILITY_WOOD) { this.#goChop(); return true; }
                // had wood but no room: fall through to expansion
                this.wantExpand = true;
            } else this.wantFacility = false;
        }

        if (this.wantExpand) {
            const info = w.expansionInfo(this.plot);
            if (info.state === 'max' || info.state === 'blocked') { this.wantExpand = false; return false; }
            if (info.state === 'trees') {
                // clear the woodland standing in the way of the new fence line
                const src = w.nearestWood(this.pos, info.tiles);
                if (src) { this.think('CLEARING TREES FOR MORE LAND'); this.#goToWood(src); return true; }
                this.wantExpand = false; return false;
            }
            // clear border — pay the wood cost to fence it in
            const cost = w.expandCost(this.plot);
            if (this.wood >= cost) {
                if (w.expandPlot(this)) { this.wood -= cost; this.nextExpand = Math.round(this.nextExpand * 2.1); this.wantExpand = false; this.think('MY FARM GROWS'); return true; }
                this.wantExpand = false; return false;
            }
            this.#goChop(); return true;
        }
        return false;
    }

    #goChop() {
        const src = this.world.nearestWood(this.pos);
        if (!src) { this.wantExpand = false; this.wantFacility = false; return false; }
        this.think(this.wood > 0 ? 'NEED MORE WOOD' : 'OFF TO CHOP SOME WOOD');
        return this.#goToWood(src);
    }

    #goToWood(src) {
        this.woodTarget = src;
        return this.#goTo(src.i + 0.5, src.j + 0.5, src.kind === 'stump' ? 'break' : 'chop');
    }

    // ---- movement & task routing -------------------------------------------------

    // Returns true if a walk was started, false if the target is unreachable (caller should
    // pick something else — we do NOT straight-line at an unreachable goal, which would slide
    // against a wall forever).
    #goTo(i, j, then) {
        const tiles = this.world.findPath(this.pos, { i, j });
        if (tiles === null) { this.path = null; this.state = 'decide'; return false; }
        let waypoints = null;
        if (tiles.length) {
            waypoints = tiles.map(t => ({ i: t.i + 0.5, j: t.j + 0.5 }));
            waypoints[waypoints.length - 1] = { i, j };   // exact final target
        }
        this.path = { i, j, then, waypoints, wi: 0 };
        this.stuckTimer = 0; this.lastGoalDist = Infinity;
        this.state = 'walk';
        return true;
    }
    #goHome(then) { this.#goTo(this.plot.house.i - 1 + 0.5, this.plot.house.j + 2.5, then); }

    // route a task into a walk + work, handling water fetch and producer targeting
    #pursue(task, plot, helping) {
        if (task.act === 'water' && this.carryWater <= 0) {
            const well = this.world.nearestWell(this.pos);
            this.pendingAfterWater = { helping };
            this.#goTo(well.i - 0.5, well.j + 1.5, helping ? 'fetchwater-help' : 'fetchwater');
            return;
        }
        let ti, tj;
        if (task.prod) { task.prod.busy = true; this.targetProd = task.prod; ti = task.prod.fx; tj = task.prod.fy; }
        else if (task.crop) { ti = task.crop.i + 0.5; tj = task.crop.j + 0.5; }
        else { ti = task.field.i + 0.5; tj = task.field.j + 0.5; }
        this.pendingWork = { task, plot, helping };
        this.#goTo(ti, tj, 'work');
    }

    #pursuePoach(loot) {
        this.poachLoot = loot;
        if (loot.prod) { loot.prod.busy = true; this.targetProd = loot.prod; this.#goTo(loot.prod.fx, loot.prod.fy, 'poach'); }
        else this.#goTo(loot.crop.i + 0.5, loot.crop.j + 0.5, 'poach');
    }

    #startWork() {
        const pw = this.pendingWork; this.pendingWork = null;
        const dur = (pw.task.prod ? PROD[pw.task.prod.kind][pw.task.act === 'collect' ? 'collectT' : 'feedT'] : (ACTION_TIME[pw.task.act] || 2)) / this.workSpeed();
        this.action = { ...pw, timer: dur, total: dur };
        this.state = 'work';
    }

    #completeWork() {
        const w = this.world, s = this.sheet;
        const { task, plot, helping } = this.action;
        this.action = null;
        this.#spendEnergy(ACTION_ENERGY[task.act] || 0.05);
        const owner = helping ? this.helpTask?.requester : this;
        if (this.targetProd) { this.targetProd.busy = false; }

        switch (task.act) {
            case 'till': w.set(task.field.i, task.field.j, T.TILLED); this.gainXP(1); break;
            case 'plant': w.plantCrop(task.field.i, task.field.j, s.crop, owner || this); this.gainXP(1); break;
            case 'water': { const c = w.cropAt(task.crop.i, task.crop.j); if (c) c.water = 1; this.carryWater = Math.max(0, this.carryWater - 1); this.gainXP(1); break; }
            case 'clear': w.crops.delete(`${task.crop.i},${task.crop.j}`); w.set(task.crop.i, task.crop.j, T.TILLED); break;
            case 'tend': { const p = task.prod; if (p) p.fed = 1; this.gainXP(1); break; }
            case 'collect': this.#doCollect(task.prod, owner, helping); break;
            case 'harvest': this.#doHarvest(task.crop, owner, helping); break;
        }
        this.targetProd = null;
        if (helping && this.helpTask) { this.helpTask.didWork = true; this.helpTask.actionsLeft--; this.state = 'decide-help'; }
        else this.state = 'decide';
    }

    #doCollect(p, owner, helping) {
        if (!p || !p.ready) return;
        const w = this.world, s = this.sheet;
        const cfg = PROD[p.kind];
        let bonusMod = mod(s.stats.int); if (this.tired) bonusMod -= 2;
        const check = d20(this.rand, bonusMod);
        let yieldN = cfg.yieldLo;
        const name = FACILITY_YIELD_NAME[p.kind] || 'produce';
        if (check.crit || check.total >= 18) { yieldN = cfg.yieldHi + 1; w.addLog(`CRIT! ${s.name} gathers a bounty of ${name} (d20:${check.roll})`, '#f0d060'); this.say('BUMPER!', '#f0d060'); this.sparkle = 1.5; }
        else if (check.fumble) { yieldN = 0; w.addLog(`${s.name} came up empty-handed... (d20:1)`, '#c05840'); this.say('nothing', '#c05840'); }
        else if (check.total >= 10) yieldN = cfg.yieldHi;
        const ownerSheet = (helping && owner) ? owner.sheet : s;
        ownerSheet.harvested += yieldN; w.harvestTotal += yieldN;
        ownerSheet.produce = (ownerSheet.produce || 0) + yieldN;   // spendable stockpile (harvested is lifetime-only)
        if (yieldN > 0 && !check.crit) this.say(`+${yieldN} ${name}`);
        p.ready = false; p.prod = 0;
        this.gainXP(2 + yieldN);
        this.#milestones(helping && owner ? owner : this);
    }

    #doHarvest(crop, owner, helping) {
        const w = this.world, s = this.sheet;
        const c = w.cropAt(crop.i, crop.j);
        if (!c || c.stage !== 3 || c.withered) return;
        let bonusMod = mod(s.stats.int); if (this.tired) bonusMod -= 2;
        const check = d20(this.rand, bonusMod);
        let yieldN = 1;
        if (check.crit || check.total >= 18) { yieldN = 3; w.addLog(`CRIT! ${s.name} harvests x3 ${c.type} (d20:${check.roll})`, '#f0d060'); this.say('CRITICAL!', '#f0d060'); this.sparkle = 1.5; }
        else if (check.fumble) { yieldN = 0; w.addLog(`${s.name} fumbled the harvest... (d20:1)`, '#c05840'); this.say('oops', '#c05840'); }
        else if (check.total >= 10) yieldN = 2;
        const ownerSheet = (helping && owner) ? owner.sheet : s;
        ownerSheet.harvested += yieldN; w.harvestTotal += yieldN;
        ownerSheet.produce = (ownerSheet.produce || 0) + yieldN;   // spendable stockpile (harvested is lifetime-only)
        if (yieldN > 0 && !check.crit) this.say(`+${yieldN} ${c.type}`);
        if (yieldN > 0) this.carryCrop = { type: c.type, t: 2.2 };   // hold the picked produce up
        w.crops.delete(`${crop.i},${crop.j}`);
        this.gainXP(3 + yieldN);
        this.#milestones(helping && owner ? owner : this);
    }

    // Harvest milestones no longer build directly — they raise an INTENT the
    // farmer acts on (gather wood -> clear land -> fence/build), so growth costs
    // real effort and lumber.
    #milestones(grower) {
        if (grower.sheet.harvested >= grower.nextExpand) {
            grower.nextExpand = Math.round(grower.nextExpand * 2.1);
            grower.wantExpand = true;
        }
        if (grower.sheet.harvested >= grower.nextFacility && this.world.farmerHasUnbuiltFacility(grower)) {
            grower.wantFacility = true;
        }
    }

    #completePoach() {
        const w = this.world, s = this.sheet;
        const loot = this.poachLoot; this.poachLoot = null;
        if (this.targetProd) this.targetProd.busy = false;
        let name = 'crop', pos;
        if (loot.crop) {
            const c = w.cropAt(loot.crop.i, loot.crop.j);
            if (c && c.stage === 3 && !c.withered) { name = c.type; this.carryCrop = { type: c.type, t: 2.2 }; w.crops.delete(`${loot.crop.i},${loot.crop.j}`); s.harvested += 1; w.harvestTotal += 1; pos = loot.crop; }
        } else if (loot.prod && loot.prod.ready) {
            name = FACILITY_YIELD_NAME[loot.prod.kind] || 'produce'; loot.prod.ready = false; loot.prod.prod = 0; s.harvested += 1; w.harvestTotal += 1;
            pos = { i: Math.round(loot.prod.fx), j: Math.round(loot.prod.fy) };
        }
        this.targetProd = null;
        if (pos) {
            this.adjustReputation(-0.06);
            const witness = w.farmers.find(o => o !== this && o.health !== 'sick' && o.p.honesty > 0.55 &&
                Math.abs(o.pos.i - pos.i) + Math.abs(o.pos.j - pos.j) < 6);
            if (witness) { witness.say('HEY! THIEF!', '#c05840'); this.say('uh oh', '#e0a03c'); this.adjustReputation(-0.12); w.addBond(this, witness, -1); w.addLog(`${witness.sheet.name} caught ${s.name} stealing ${name}!`, '#c05840'); }
            else w.addLog(`${s.name} quietly made off with a ${name}`, '#e0a03c');
        }
        this.poachCooldown = 20 + this.rand() * 25;
        this.state = 'decide';
    }

    #completeForage() {
        const w = this.world, s = this.sheet, tgt = this.forageTarget;
        this.forageTarget = null;
        this.#laborDrain('forage');
        const t = tgt && w.get(tgt.i, tgt.j);
        if (t === T.WHEAT || t === T.FLOWER) {
            w.set(tgt.i, tgt.j, T.GRASS);
            const yieldN = 1 + (mod(s.stats.wis) > 1 || this.rand() < 0.4 ? 1 : 0);
            s.harvested += yieldN; w.harvestTotal += yieldN;
            // stash the good for future bartering
            const good = t === T.FLOWER ? 'flower' : 'wheat';
            s.goods = s.goods || {};
            s.goods[good] = (s.goods[good] || 0) + yieldN;
            this.say(`+${yieldN} ${t === T.FLOWER ? 'flowers' : 'wild wheat'}`, t === T.FLOWER ? '#e878b0' : '#e8c860');
            this.gainXP(1);
        }
        this.state = 'decide';
    }

    #completeChop() {
        const w = this.world, tgt = this.woodTarget;
        this.woodTarget = null;
        if (tgt) {
            const t = w.get(tgt.i, tgt.j);
            if (t === T.TREE) {
                this.#laborDrain('chop');           // felling a tree is heavy work
                w.set(tgt.i, tgt.j, T.STUMP);
                this.wood += WOOD_TREE;
                this.say(`+${WOOD_TREE} wood`, '#c8a060');
                this.gainXP(1);
            } else if (t === T.STUMP) {
                this.#laborDrain('break');          // grubbing the stump is a bit lighter
                w.set(tgt.i, tgt.j, T.GRASS);
                this.wood += WOOD_STUMP;
                this.say(`+${WOOD_STUMP} wood`, '#c8a060');
            } else this.#laborDrain('break');
        }
        this.state = 'decide';
    }

    // Spend energy on a labor action; working while already exhausted builds STRAIN, which
    // raises the odds of falling ill (see #dailyHealthCheck + the exhaustion nudge in #decide).
    #spendEnergy(cost) {
        this.energy = Math.max(0, this.energy - cost);
        if (this.energy < 0.22) this.strain = (this.strain || 0) + (0.24 - this.energy) * 3 + 0.25;
        else this.strain = Math.max(0, (this.strain || 0) - 0.05);
    }
    // Labor duration + energy scale with STR (strong bots swing faster and tire a touch less).
    #laborTime(act) { return LABOR[act].time / (this.workSpeed() * (1 + Math.max(0, mod(this.sheet.stats.str)) * 0.12)); }
    #laborDrain(act) { this.#spendEnergy(LABOR[act].energy * (1 - Math.max(0, mod(this.sheet.stats.str)) * 0.05)); }

    #completeFencePost() {
        const p = this.plot;
        if (this.pendingFence && this.pendingFence.needWood && this.wood > 0) this.wood -= 1;
        this.pendingFence = null;
        this.#laborDrain('fencepost');
        this.gainXP(1);
        p.fencePosts++;
        if (p.fencePosts >= p.fenceTarget) { this.world.completeFence(this); this.say('FENCED!', '#7dd069'); this.sparkle = 1.5; }
        else if (p.fencePosts % 4 === 0) this.say(`${Math.round(100 * p.fencePosts / p.fenceTarget)}%`, '#c8a060');
        this.state = 'decide';
    }

    #completeMine() {
        const w = this.world, tgt = this.mineTarget;
        this.mineTarget = null;
        this.#laborDrain('mine');
        if (tgt && w.get(tgt.i, tgt.j) === T.ROCK) {
            w.set(tgt.i, tgt.j, T.GRASS);
            this.ore += ORE_ROCK;
            this.say(`+${ORE_ROCK} ore`, '#a8b0c0');
            this.gainXP(1);
        }
        this.state = 'decide';
    }

    tick(dt) {
        this.animTime += dt;
        this.helpCooldown = Math.max(0, this.helpCooldown - dt);
        this.poachCooldown = Math.max(0, this.poachCooldown - dt);
        this.thoughtBubbleTimer -= dt;
        if (this.bubble) { this.bubble.t -= dt; if (this.bubble.t <= 0) this.bubble = null; }
        if (this.carryCrop) { this.carryCrop.t -= dt; if (this.carryCrop.t <= 0) this.carryCrop = null; }
        this.sparkle = Math.max(0, this.sparkle - dt);

        if (this.state === 'sleep') this.energy = Math.min(1, this.energy + SLEEP_RESTORE * dt);
        else if (this.state === 'rest') this.energy = Math.min(1, this.energy + REST_RESTORE * dt);
        else if (this.state === 'sick') this.energy = Math.min(1, this.energy + REST_RESTORE * 0.6 * dt);
        else this.energy = Math.max(0, this.energy - AWAKE_DRAIN * dt);

        switch (this.state) {
            case 'decide': this.#decide(); break;
            case 'decide-help': this.#decideHelp(); break;

            case 'walk': {
                const P = this.path;
                const wp = (P.waypoints && P.wi < P.waypoints.length) ? P.waypoints[P.wi] : { i: P.i, j: P.j };
                const dx = wp.i - this.pos.i, dy = wp.j - this.pos.j;
                const dist = Math.hypot(dx, dy);
                const arriveR = (P.waypoints && P.wi < P.waypoints.length - 1) ? 0.3 : 0.14;
                if (dist < arriveR) {
                    if (P.waypoints && P.wi < P.waypoints.length - 1) { P.wi++; break; }   // advance to next waypoint
                    const then = P.then; this.path = null;
                    if (then === 'work') this.#startWork();
                    else if (then === 'poach') this.#startPoachAction();
                    else if (then === 'chop' || then === 'break') { this.chopTimer = this.#laborTime(then); this.state = then; }
                    else if (then === 'mine') { this.chopTimer = this.#laborTime('mine'); this.state = 'mine'; }
                    else if (then === 'forage') { this.forageTimer = this.#laborTime('forage'); this.state = 'forage'; }
                    else if (then === 'fencepost') { this.fenceTimer = this.#laborTime('fencepost'); this.state = 'fencepost'; }
                    else if (then === 'fetchwater' || then === 'fetchwater-help') {
                        this.carryWater = this.maxWater; this.say('splash');
                        // resume the original watering task
                        this.state = then === 'fetchwater-help' ? 'decide-help' : 'decide';
                    }
                    else if (then === 'sleepwalk') this.state = 'sleep';
                    else if (then === 'rest') this.state = 'rest';
                    else if (then === 'sick') this.state = 'sick';
                    else if (then === 'shelter') { this.state = 'shelter'; this.say('yikes!'); }
                    else if (then === 'build') this.state = 'build';
                    else if (then === 'care') { this.state = 'care'; this.careTimer = 1.2; }
                    else { this.state = 'idle'; this.wanderTimer = 1 + this.rand() * 2.5; }
                } else {
                    const step = Math.min((this.speed * dt) / dist, 1);
                    let ni = this.pos.i + dx * step, nj = this.pos.j + dy * step;
                    // never clip into a solid tile, even when A* failed and we're straight-lining
                    const gi = Math.floor(P.i), gj = Math.floor(P.j);
                    const solid = (ti, tj) => !(Math.floor(ti) === gi && Math.floor(tj) === gj) && this.world.pathBlocked(Math.floor(ti), Math.floor(tj));
                    if (solid(ni, nj)) {
                        if (!solid(ni, this.pos.j)) nj = this.pos.j;         // slide along i
                        else if (!solid(this.pos.i, nj)) ni = this.pos.i;    // slide along j
                        else { this.state = 'decide'; break; }               // boxed in -> pick a new task
                    }
                    this.pos.i = ni; this.pos.j = nj;
                    const sx = dx - dy; if (Math.abs(sx) > 0.05) this.facing = sx > 0 ? 1 : -1;
                    // facing row for the 4-way sprite: vertical when screen-Y dominates, else side
                    if (Math.abs(dx) + Math.abs(dy) > 0.02)
                        this.moveDir = Math.abs(dx + dy) > Math.abs(dx - dy) * 2 ? ((dx + dy) < 0 ? 'up' : 'down') : 'side';
                    // stuck safety net: if not getting closer to the FINAL target, give up and redecide
                    // (catches sliding along a wall, or a path invalidated by a mid-walk tile change)
                    const goalDist = Math.abs(P.i - this.pos.i) + Math.abs(P.j - this.pos.j);
                    if (goalDist < this.lastGoalDist - 0.03) { this.lastGoalDist = goalDist; this.stuckTimer = 0; }
                    else { this.stuckTimer += dt; if (this.stuckTimer > 2.5) { this.path = null; this.state = 'decide'; } }
                }
                break;
            }

            case 'work': this.action.timer -= dt; if (this.action.timer <= 0) this.#completeWork(); break;
            case 'poach': this.poachTimer -= dt; if (this.poachTimer <= 0) this.#completePoach(); break;
            case 'chop': case 'break': this.chopTimer -= dt; if (this.chopTimer <= 0) this.#completeChop(); break;
            case 'mine': this.chopTimer -= dt; if (this.chopTimer <= 0) this.#completeMine(); break;
            case 'forage': this.forageTimer -= dt; if (this.forageTimer <= 0) this.#completeForage(); break;
            case 'fencepost': this.fenceTimer -= dt; if (this.fenceTimer <= 0) this.#completeFencePost(); break;

            case 'build': {
                const pr = this.world.project;
                if (!pr) { this.state = 'decide'; break; }
                this.world.contributeBuild(this, dt);
                this.energy = Math.max(0, this.energy - ACTION_ENERGY.build * dt);
                if (this.world.isNight() || this.energy < 0.3 || this.rand() < dt * 0.06) this.state = 'decide';
                break;
            }

            case 'care': {
                this.careTimer -= dt;
                if (this.careTimer <= 0) {
                    const sick = this.careTarget;
                    if (sick && sick.health === 'sick') {
                        sick.sickDays = Math.max(1, sick.sickDays - 1); sick.energy = Math.min(1, sick.energy + 0.15);
                        sick.say('THANK YOU...', '#7dd069'); this.say('REST UP, FRIEND', '#7dd069');
                        this.world.addBond(this, sick); this.adjustReputation(0.06);
                        this.world.addLog(`${this.sheet.name} brought soup to ${sick.sheet.name}`, '#7dd069');
                    }
                    this.careTarget = null; this.state = 'decide';
                }
                break;
            }

            case 'idle': this.wanderTimer -= dt; if (this.wanderTimer <= 0) this.state = 'decide'; break;
            case 'sleep': if (!this.world.isNight()) { this.state = 'decide'; this.say('good morning!'); this.visitedSick.clear(); } break;
            case 'rest': if (this.energy > 0.5) { this.state = 'decide'; this.say('back to it'); } break;
            case 'sick': if (this.health !== 'sick') this.state = 'decide'; break;
            case 'shelter': if (this.world.weather !== 'storm') this.state = 'decide'; break;
        }
    }

    #startPoachAction() { this.poachTimer = 2.2 / this.workSpeed(); this.state = 'poach'; }
}
