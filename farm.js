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

export const GRID = 78;
export const CENTER = GRID / 2;

export const T = { GRASS: 0, PATH: 1, TILLED: 2, HOUSE: 3, WELL: 4, SIGN: 5, STRUCT: 6, WATER: 7, COOP: 8, BARN: 9 };

// Longer days so the world breathes slowly while the (now faster) farmers bustle.
export const DAY_LENGTH = 150;
export const NIGHT_LENGTH = 40;

const WEATHER_STATES = {
    sun: { label: 'SUNNY', next: { sun: 2, cloud: 3, drought: 0.6 }, dur: [26, 54] },
    cloud: { label: 'CLOUDY', next: { sun: 2, rain: 3, storm: 0.8 }, dur: [16, 34] },
    rain: { label: 'RAIN', next: { cloud: 2, sun: 1, storm: 1 }, dur: [16, 36] },
    storm: { label: 'STORM!', next: { rain: 2, cloud: 2 }, dur: [12, 22] },
    drought: { label: 'DROUGHT', next: { sun: 1.5, cloud: 1 }, dur: [22, 40] },
};

export const SEASONS = [
    { name: 'SPRING', growth: 1.15, waterMul: 1.0, ground: ['#4a7a42', '#457540'], tilled: '#6a4c30', accent: '#7dd069',
      weather: { sun: 3, cloud: 3, rain: 3, storm: 1, drought: 0.3 } },
    { name: 'SUMMER', growth: 1.3, waterMul: 1.5, ground: ['#5f8a38', '#578235'], tilled: '#6e4e2e', accent: '#f0d060',
      weather: { sun: 5, cloud: 2, rain: 1.5, storm: 1.5, drought: 2.5 } },
    { name: 'FALL', growth: 0.8, waterMul: 0.8, ground: ['#8a7038', '#7c6634'], tilled: '#5e4228', accent: '#e0803c',
      weather: { sun: 3, cloud: 4, rain: 3, storm: 1.5, drought: 0.5 } },
    { name: 'WINTER', growth: 0.4, waterMul: 0.4, ground: ['#c6ced6', '#bac2ca'], tilled: '#8a7a68', accent: '#a8c8e8',
      weather: { sun: 2, cloud: 4, rain: 1, storm: 2, drought: 0 } },
];
export const SEASON_LENGTH = 3;

// producer tuning per kind
export const PROD = {
    pad:     { rate: 0.020, feedDecay: 0.006, yieldLo: 1, yieldHi: 2, collectT: 2.2, feedT: 1.8, wander: false },
    fish:    { rate: 0.016, feedDecay: 0.008, yieldLo: 1, yieldHi: 3, collectT: 2.4, feedT: 1.6, wander: true, aquatic: true },
    chicken: { rate: 0.030, feedDecay: 0.013, yieldLo: 1, yieldHi: 2, collectT: 1.8, feedT: 1.4, wander: true },
    cow:     { rate: 0.020, feedDecay: 0.010, yieldLo: 2, yieldHi: 3, collectT: 2.6, feedT: 2.0, wander: true },
    pig:     { rate: 0.024, feedDecay: 0.011, yieldLo: 1, yieldHi: 3, collectT: 2.2, feedT: 1.8, wander: true },
    goat:    { rate: 0.026, feedDecay: 0.011, yieldLo: 1, yieldHi: 2, collectT: 2.0, feedT: 1.6, wander: true },
};

const FACILITY_DEFS = {
    pond: { label: 'water garden', w: 3, h: 3, produce: 'lily & fish' },
    coop: { label: 'chicken coop', w: 3, h: 3, produce: 'eggs' },
    pen:  { label: 'livestock pen', w: 3, h: 3, produce: 'milk' },
};

// energy / health tuning
const AWAKE_DRAIN = 0.0022;
const SLEEP_RESTORE = 0.03;
const REST_RESTORE = 0.022;
const ACTION_ENERGY = { till: 0.05, plant: 0.03, water: 0.03, harvest: 0.045, clear: 0.035, build: 0.05, collect: 0.04, tend: 0.03 };

export function d20(rand, modifier) {
    const roll = 1 + Math.floor(rand() * 20);
    return { roll, mod: modifier, total: roll + modifier, crit: roll === 20, fumble: roll === 1 };
}

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------

export class World {
    constructor(seed = 1337) {
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
        this.sign = { i: CENTER + 2, j: CENTER + 1 };
        this.wells = [this.well];
        this.set(this.well.i, this.well.j, T.WELL);
        this.set(this.sign.i, this.sign.j, T.SIGN);

        this.slots = [];
        this.ringCount = 0;
        this.#addRing(17, 8, 0.42);
    }

    // house occupies a 2x2 footprint; keep crops/facilities off it and its door
    #inHouse(plot, i, j) {
        const h = plot.house;
        return i >= h.i && i <= h.i + 1 && j >= h.j && j <= h.j + 2;
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
        return t === T.HOUSE || t === T.WELL || t === T.SIGN || t === T.STRUCT || t === T.COOP || t === T.BARN;
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

    addFarmer(memory, mutation = 0) {
        let slot = this.slots.find(s => !s.used);
        if (!slot && this.ringCount === 1) {
            this.#addRing(29, 11, 0.18);
            this.addLog('The town has grown! New homesteads opened further out.', '#7dd069');
            slot = this.slots.find(s => !s.used);
        }
        if (!slot) return null;
        slot.used = true;

        const sheet = growFarmer(memory, mutation);
        const plot = {
            x: slot.i, y: slot.j, w: 7, h: 7,
            house: { i: slot.i + 1, j: slot.j + 1 },
            fields: [], facilities: [],
        };
        for (let di = 0; di < 2; di++) for (let dj = 0; dj < 2; dj++) this.set(plot.house.i + di, plot.house.j + dj, T.HOUSE);
        this.#rebuildFields(plot);

        const farmer = new Farmer(sheet, plot, this);
        farmer.pos = { i: plot.x + plot.w / 2, j: plot.y + plot.h };
        this.plots.push(plot);
        this.farmers.push(farmer);
        const p = sheet.personality;
        this.addLog(`${sheet.name} the ${p.label} settled in. "${p.creed}"`, '#7dd069');
        return farmer;
    }

    // field tiles = interior grass/tilled that isn't house, commons, or a facility
    #rebuildFields(plot) {
        plot.fields = [];
        for (let i = plot.x + 1; i < plot.x + plot.w - 1; i++) {
            for (let j = plot.y + 1; j < plot.y + plot.h - 1; j++) {
                if (this.#inHouse(plot, i, j)) continue;
                const t = this.get(i, j);
                if (t === T.GRASS || t === T.TILLED) plot.fields.push({ i, j });
            }
        }
    }

    // ---- farm expansion + diversification ---------------------------------------

    expandPlot(farmer) {
        const p = farmer.plot;
        const MAX = 15;
        if (p.w >= MAX) return false;
        const nx = p.x - 1, ny = p.y - 1, nw = p.w + 2, nh = p.h + 2;
        if (nx < 2 || ny < 2 || nx + nw > GRID - 2 || ny + nh > GRID - 2) return false;
        for (const other of this.plots) {
            if (other === p) continue;
            if (nx < other.x + other.w + 1 && nx + nw > other.x - 1 &&
                ny < other.y + other.h + 1 && ny + nh > other.y - 1) return false;
        }
        const blocked = [...this.wells, this.sign, ...this.structures, this.project?.site].filter(Boolean);
        for (const b of blocked) if (b.i >= nx - 1 && b.i <= nx + nw && b.j >= ny - 1 && b.j <= ny + nh) return false;
        p.x = nx; p.y = ny; p.w = nw; p.h = nh;
        this.#rebuildFields(p);
        this._tilesChanged = true;
        this.addLog(`${farmer.sheet.name} expanded their fence line! (${nw}x${nh})`, '#7dd069');
        return true;
    }

    // Try to add the farmer's next preferred facility, expanding for room if needed.
    tryDiversify(farmer) {
        const plot = farmer.plot;
        const built = new Set(plot.facilities.map(f => f.type));
        const nextType = (farmer.sheet.facilityPrefs || ['pond', 'coop', 'pen']).find(t => !built.has(t));
        if (!nextType) return false;
        if (farmer.sheet.harvested < farmer.nextFacility) return false;

        let region = this.#findFacilityRegion(plot, nextType);
        for (let tries = 0; !region && tries < 3; tries++) { if (!this.expandPlot(farmer)) break; region = this.#findFacilityRegion(plot, nextType); }
        if (!region) return false;

        this.#buildFacility(plot, farmer.sheet, nextType, region);
        farmer.nextFacility = Math.round(farmer.sheet.harvested + 22 + this.rand() * 12);
        const def = FACILITY_DEFS[nextType];
        this.addLog(`${farmer.sheet.name} added a ${def.label.toUpperCase()} to their farm!`, '#7dd069');
        farmer.say('NEW GROUNDS!', '#7dd069'); farmer.sparkle = 2;
        return true;
    }

    #findFacilityRegion(plot, type) {
        const def = FACILITY_DEFS[type];
        // scan interior for a clear w x h block of plain field tiles
        for (let y = plot.y + 1; y + def.h <= plot.y + plot.h - 1; y++) {
            for (let x = plot.x + 1; x + def.w <= plot.x + plot.w - 1; x++) {
                let ok = true;
                for (let j = y; j < y + def.h && ok; j++) {
                    for (let i = x; i < x + def.w; i++) {
                        const t = this.get(i, j);
                        if (this.#inHouse(plot, i, j) || (t !== T.GRASS && t !== T.TILLED) || this.cropAt(i, j)) { ok = false; break; }
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
        this.structures.push({ type, i: site.i, j: site.j });
        this.set(site.i, site.j, T.STRUCT);
        if (type === 'toolshed') this.workMult *= 1.12;
        else if (type === 'windmill') this.growthMult *= 1.15;
        else if (type === 'tower') this.lightningMult = 0.5;
        else if (type === 'well2') this.wells.push({ i: site.i, j: site.j });
        this.addLog(`The ${label} is finished! ${perk}`, '#f0d060');
        for (const f of pr.builders) {
            f.gainXP(6); f.say('HOORAY!', '#f0d060'); f.sparkle = 3;
            for (const g of pr.builders) if (g !== f && this.rand() < 0.6) this.addBond(f, g);
        }
    }

    // ---- help board (generic; helper works whatever the plot needs) --------------

    postHelp(farmer, genuine = true) {
        if (this.helpBoard.some(r => r.farmer === farmer)) return;
        this.helpBoard.push({ farmer, genuine });
        this.addLog(`${farmer.sheet.name} posted: NEED A HAND ON THE FARM`, '#e0a03c');
    }

    takeHelp(helper) {
        const hp = helper.sheet.personality;
        if (hp.collaboration < 0.3 && this.rand() > 0.15) return null;
        for (let i = 0; i < this.helpBoard.length; i++) {
            const req = this.helpBoard[i];
            if (req.farmer === helper) continue;
            if (hp.competitiveness > 0.6 && req.farmer === this.leader && hp.collaboration < 0.6) continue;
            if (req.farmer.reputation < 0.35 && this.rand() > hp.collaboration) continue;
            if (hp.collaboration > 0.45 || helper.sheet.stats.cha >= 14 || this.rand() < 0.4) { this.helpBoard.splice(i, 1); return req; }
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
                const greenThumb = 1 + mod(crop.owner.sheet.stats.int) * 0.08;
                const waterFactor = 0.25 + 0.75 * crop.water;
                crop.growth += dt * 0.028 * waterFactor * growthBonus * greenThumb * this.growthMult * season.growth;
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
            const risky = f.energy < 0.35 || f.sleepDebt >= 3;
            if (risky) {
                const dc = 10 + Math.floor(f.sleepDebt) + (f.energy < 0.2 ? 3 : 0);
                const save = d20(this.rand, mod(f.sheet.stats.con));
                if (save.total < dc && !save.crit) {
                    f.health = 'sick'; f.sickDays = 2 + Math.floor(this.rand() * 3); f.energy = Math.min(f.energy, 0.3);
                    this.addLog(`${f.sheet.name} fell ill from overwork! (CON ${save.total} vs DC ${dc})`, '#c05840');
                    f.say('I... dont feel well', '#c05840');
                } else if (f.sleepDebt >= 2) this.addLog(`${f.sheet.name} looks worn out but powers through (CON ${save.total} vs ${dc})`, '#e0a03c');
            }
        }
    }

    // ---- main tick ---------------------------------------------------------------

    tick(dt) {
        this.clock += dt;
        if (this.clock >= DAY_LENGTH + NIGHT_LENGTH) {
            this.clock = 0; this.day++;
            this.#dailyHealthCheck();
            this.#advanceSeason();
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
        this.carryWater = 0;
        this.bubble = null;
        this.sparkle = 0;
        this.wanderTimer = 0;
        this.animTime = this.rand() * 10;

        this.thought = 'A NEW FARM. A NEW LIFE.';
        this.thoughtBubbleTimer = 4 + this.rand() * 8;
        this.helpTask = null;
        this.helpCooldown = 0;
        this.nextExpand = 8;
        this.nextFacility = 12;
        this.targetProd = null;

        this.energy = 0.8 + this.rand() * 0.2;
        this.sleepDebt = 0;
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
    #nextTaskOnPlot(plot, thirstThreshold = 0.32) {
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
        // 4. sow + till (crop farms only)
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

    // ---- deciding ---------------------------------------------------------------

    #decide() {
        const w = this.world, s = this.sheet;

        if (this.health === 'sick') { this.think('NEED TO REST AND GET WELL'); this.#goHome('sick'); return; }
        if (!w.isNight() && this.energy < 0.14) { this.think('IM SPENT. NEED A QUICK REST.'); this.#goHome('rest'); return; }
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

        // 1. own farm chores (crops + facilities, unified)
        const task = this.#nextTaskOnPlot(this.plot, thirstThreshold);
        if (task) { this.#thinkTask(task); this.#pursue(task, this.plot, false); return; }

        // 2. help a neighbor
        const req = w.takeHelp(this);
        if (req) {
            this.helpTask = { requester: req.farmer, actionsLeft: 3 + Math.floor(this.rand() * 3), genuine: req.genuine, didWork: false };
            this.think(`${req.farmer.sheet.name.toUpperCase()} NEEDS A HAND!`);
            this.say(`COMING ${req.farmer.sheet.name.split(' ')[0].toUpperCase()}!`, '#7dd069');
            w.addLog(`${s.name} went to lend ${req.farmer.sheet.name} a hand`, '#7dd069');
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

        // 6. wander + muse
        this.think(this.rand() < 0.4 ? `REMEMBERING: ${String(s.memory.title).slice(0, 26)}..` : IDLE_THOUGHTS[Math.floor(this.rand() * IDLE_THOUGHTS.length)]);
        this.wanderTimer = 1.5 + this.rand() * 3;
        this.#goTo(this.plot.x + 0.5 + this.rand() * (this.plot.w - 1), this.plot.y + 0.5 + this.rand() * (this.plot.h - 1), 'wander');
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
                this.world.addLog(`${this.sheet.name} finished helping ${other.sheet.name} (+bond)`, '#7dd069');
                other.say('THANKS FRIEND!', '#7dd069'); other.helpCooldown = 20;
                this.adjustReputation(0.05); this.gainXP(3);
            }
            this.helpTask = null;
        }
        this.state = 'decide';
    }

    // ---- movement & task routing -------------------------------------------------

    #goTo(i, j, then) { this.path = { i, j, then }; this.state = 'walk'; }
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
        this.energy = Math.max(0, this.energy - (ACTION_ENERGY[task.act] || 0.03));
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
        if (yieldN > 0 && !check.crit) this.say(`+${yieldN} ${c.type}`);
        w.crops.delete(`${crop.i},${crop.j}`);
        this.gainXP(3 + yieldN);
        this.#milestones(helping && owner ? owner : this);
    }

    #milestones(grower) {
        if (grower.sheet.harvested >= grower.nextExpand) {
            grower.nextExpand = Math.round(grower.nextExpand * 2.1);
            if (this.world.expandPlot(grower)) { grower.say('MORE LAND!', '#7dd069'); grower.think('MY FARM GROWS'); }
        }
        this.world.tryDiversify(grower);
    }

    #completePoach() {
        const w = this.world, s = this.sheet;
        const loot = this.poachLoot; this.poachLoot = null;
        if (this.targetProd) this.targetProd.busy = false;
        let name = 'crop', pos;
        if (loot.crop) {
            const c = w.cropAt(loot.crop.i, loot.crop.j);
            if (c && c.stage === 3 && !c.withered) { name = c.type; w.crops.delete(`${loot.crop.i},${loot.crop.j}`); s.harvested += 1; w.harvestTotal += 1; pos = loot.crop; }
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

    tick(dt) {
        this.animTime += dt;
        this.helpCooldown = Math.max(0, this.helpCooldown - dt);
        this.poachCooldown = Math.max(0, this.poachCooldown - dt);
        this.thoughtBubbleTimer -= dt;
        if (this.bubble) { this.bubble.t -= dt; if (this.bubble.t <= 0) this.bubble = null; }
        this.sparkle = Math.max(0, this.sparkle - dt);

        if (this.state === 'sleep') this.energy = Math.min(1, this.energy + SLEEP_RESTORE * dt);
        else if (this.state === 'rest') this.energy = Math.min(1, this.energy + REST_RESTORE * dt);
        else if (this.state === 'sick') this.energy = Math.min(1, this.energy + REST_RESTORE * 0.6 * dt);
        else this.energy = Math.max(0, this.energy - AWAKE_DRAIN * dt);

        switch (this.state) {
            case 'decide': this.#decide(); break;
            case 'decide-help': this.#decideHelp(); break;

            case 'walk': {
                const dx = this.path.i - this.pos.i, dy = this.path.j - this.pos.j;
                const dist = Math.hypot(dx, dy);
                if (dist < 0.14) {
                    const then = this.path.then; this.path = null;
                    if (then === 'work') this.#startWork();
                    else if (then === 'poach') this.#startPoachAction();
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
                    this.pos.i += dx * step; this.pos.j += dy * step;
                    const sx = dx - dy; if (Math.abs(sx) > 0.05) this.facing = sx > 0 ? 1 : -1;
                }
                break;
            }

            case 'work': this.action.timer -= dt; if (this.action.timer <= 0) this.#completeWork(); break;
            case 'poach': this.poachTimer -= dt; if (this.poachTimer <= 0) this.#completePoach(); break;

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
