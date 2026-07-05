// farm.js — the Ry Farms simulation.
//
// V2: farmers are agents with personalities (collaboration / competitiveness /
// honesty / diligence) that shape WHO they help, whether they cheat, and WHEN
// they sleep. On top of that sits an energy + health economy: work drains
// energy, sleep restores it, and farmers who chronically burn the midnight oil
// risk falling ill. Nobody sleeps on the same schedule anymore.

import { mulberry32, mod, growFarmer, personalityLabel } from './dna.js';

export const GRID = 72;
export const CENTER = GRID / 2;

export const T = { GRASS: 0, PATH: 1, TILLED: 2, HOUSE: 3, WELL: 4, SIGN: 5, STRUCT: 6 };

export const DAY_LENGTH = 80;
export const NIGHT_LENGTH = 22;

const WEATHER_STATES = {
    sun: { label: 'SUNNY', next: { sun: 2, cloud: 3, drought: 0.6 }, dur: [18, 40] },
    cloud: { label: 'CLOUDY', next: { sun: 2, rain: 3, storm: 0.8 }, dur: [10, 25] },
    rain: { label: 'RAIN', next: { cloud: 2, sun: 1, storm: 1 }, dur: [12, 28] },
    storm: { label: 'STORM!', next: { rain: 2, cloud: 2 }, dur: [8, 16] },
    drought: { label: 'DROUGHT', next: { sun: 1.5, cloud: 1 }, dur: [16, 30] },
};

const PROJECT_DEFS = [
    { type: 'toolshed', label: 'TOOLSHED', at: 20, needed: 30, perk: 'ALL WORK +12% FASTER' },
    { type: 'windmill', label: 'WINDMILL', at: 55, needed: 45, perk: 'CROPS GROW +15% FASTER' },
    { type: 'tower', label: 'STORM TOWER', at: 100, needed: 55, perk: 'LIGHTNING HALVED' },
    { type: 'well2', label: 'SECOND WELL', at: 160, needed: 65, perk: 'SHORTER WATER RUNS' },
];

const HELP_KINDS = {
    water: { stat: 'str', verb: 'watering' },
    harvest: { stat: 'dex', verb: 'harvesting' },
    till: { stat: 'str', verb: 'tilling' },
};

// Seasons loop spring -> summer -> fall -> winter. Each shifts crop growth,
// ground color, weather odds, and the mood of the scene.
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
export const SEASON_LENGTH = 3;   // days per season -> 12-day year

// energy / health tuning
const AWAKE_DRAIN = 0.0032;       // per second, just being up
const SLEEP_RESTORE = 0.05;       // per second asleep
const REST_RESTORE = 0.03;        // per second daytime nap
const ACTION_ENERGY = { till: 0.05, plant: 0.03, water: 0.03, harvest: 0.045, clear: 0.035, build: 0.05 };

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

        this.season = 0;       // index into SEASONS
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
        this.leader = null;           // current top harvester

        this.well = { i: CENTER, j: CENTER };
        this.sign = { i: CENTER + 2, j: CENTER + 1 };
        this.wells = [this.well];
        this.set(this.well.i, this.well.j, T.WELL);
        this.set(this.sign.i, this.sign.j, T.SIGN);

        this.slots = [];
        this.ringCount = 0;
        this.#addRing(12, 8, 0.42);
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
            this._tilesChanged = true;   // ground color changes
            this._seasonChanged = true;  // let the renderer refresh
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
    addBond(a, b, delta = 1) {
        const k = this.bondKey(a, b);
        this.bonds.set(k, (this.bonds.get(k) || 0) + delta);
    }
    bondCount(f) {
        let n = 0;
        for (const [k, v] of this.bonds) {
            if (k.includes(String(f.sheet.seed)) && v > 0) n++;
        }
        return n;
    }

    // ---- leaderboard -------------------------------------------------------------

    updateLeader() {
        let top = null, best = -1;
        for (const f of this.farmers) {
            if (f.sheet.harvested > best) { best = f.sheet.harvested; top = f; }
        }
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
            this.#addRing(21, 10, 0.18);
            this.addLog('The town has grown! New homesteads opened further out.', '#7dd069');
            slot = this.slots.find(s => !s.used);
        }
        if (!slot) return null;
        slot.used = true;

        const sheet = growFarmer(memory, mutation);
        const plot = {
            x: slot.i, y: slot.j, w: 7, h: 7,
            house: { i: slot.i + 1, j: slot.j + 1 },
            fields: [],
        };
        for (let di = 0; di < 2; di++) for (let dj = 0; dj < 2; dj++) {
            this.set(plot.house.i + di, plot.house.j + dj, T.HOUSE);
        }
        this.#rebuildFields(plot);

        const farmer = new Farmer(sheet, plot, this);
        farmer.pos = { i: plot.x + plot.w / 2, j: plot.y + plot.h };
        this.plots.push(plot);
        this.farmers.push(farmer);
        const p = sheet.personality;
        this.addLog(`${sheet.name} the ${p.label} settled in. "${p.creed}"`, '#7dd069');
        return farmer;
    }

    #rebuildFields(plot) {
        plot.fields = [];
        for (let i = plot.x + 1; i < plot.x + plot.w - 1; i++) {
            for (let j = plot.y + 1; j < plot.y + plot.h - 1; j++) {
                const inHouse = i >= plot.house.i - 1 && i <= plot.house.i + 2 &&
                                j >= plot.house.j - 1 && j <= plot.house.j + 2;
                const t = this.get(i, j);
                if (!inHouse && t !== T.WELL && t !== T.SIGN && t !== T.STRUCT) {
                    plot.fields.push({ i, j });
                }
            }
        }
    }

    // ---- farm expansion ----------------------------------------------------------

    expandPlot(farmer) {
        const p = farmer.plot;
        const MAX = 13;
        if (p.w >= MAX) return false;
        const nx = p.x - 1, ny = p.y - 1, nw = p.w + 2, nh = p.h + 2;
        if (nx < 2 || ny < 2 || nx + nw > GRID - 2 || ny + nh > GRID - 2) return false;
        for (const other of this.plots) {
            if (other === p) continue;
            if (nx < other.x + other.w + 1 && nx + nw > other.x - 1 &&
                ny < other.y + other.h + 1 && ny + nh > other.y - 1) return false;
        }
        const blocked = [...this.wells, this.sign, ...this.structures, this.project?.site].filter(Boolean);
        for (const b of blocked) {
            if (b.i >= nx - 1 && b.i <= nx + nw && b.j >= ny - 1 && b.j <= ny + nh) return false;
        }
        p.x = nx; p.y = ny; p.w = nw; p.h = nh;
        this.#rebuildFields(p);
        this._tilesChanged = true;
        this.addLog(`${farmer.sheet.name} expanded their fence line! (${nw}x${nh})`, '#7dd069');
        return true;
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
            for (const p of this.plots) {
                if (i >= p.x - 1 && i <= p.x + p.w + 1 && j >= p.y - 1 && j <= p.y + p.h + 1) { clear = false; break; }
            }
            for (const s of this.structures) {
                if (Math.abs(s.i - i) + Math.abs(s.j - j) < 4) { clear = false; break; }
            }
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
            f.gainXP(6);
            f.say('HOORAY!', '#f0d060');
            f.sparkle = 3;
            for (const g of pr.builders) if (g !== f && this.rand() < 0.6) this.addBond(f, g);
        }
    }

    // ---- help board --------------------------------------------------------------

    postHelp(farmer, kind, genuine = true) {
        if (this.helpBoard.some(r => r.farmer === farmer)) return;
        this.helpBoard.push({ farmer, kind, stat: HELP_KINDS[kind].stat, genuine });
        this.addLog(`${farmer.sheet.name} posted: NEED HELP ${HELP_KINDS[kind].verb.toUpperCase()}`, '#e0a03c');
    }

    // A prospective helper evaluates the board through their personality.
    takeHelp(helper) {
        const hp = helper.sheet.personality;
        if (hp.collaboration < 0.3 && this.rand() > 0.15) return null;   // loners rarely bother
        for (let i = 0; i < this.helpBoard.length; i++) {
            const req = this.helpBoard[i];
            if (req.farmer === helper) continue;
            // competitive farmers won't help their direct rival (the leader), unless very kind
            if (hp.competitiveness > 0.6 && req.farmer === this.leader && hp.collaboration < 0.6) continue;
            // wary of a bad reputation
            if (req.farmer.reputation < 0.35 && this.rand() > hp.collaboration) continue;
            const m = mod(helper.sheet.stats[req.stat]);
            const willing = m >= 1 || helper.sheet.stats.cha >= 14 || hp.collaboration > 0.7;
            if (willing) { this.helpBoard.splice(i, 1); return req; }
        }
        return null;
    }

    clearHelp(farmer) {
        this.helpBoard = this.helpBoard.filter(r => r.farmer !== farmer);
    }

    // ---- weather -----------------------------------------------------------------

    #rollWeather() {
        // blend the transition odds with the current season's base weather bias
        const table = WEATHER_STATES[this.weather].next;
        const seasonBias = this.seasonDef.weather;
        const blended = {};
        let sum = 0;
        for (const [state, w] of Object.entries(table)) {
            const v = w * (0.4 + (seasonBias[state] ?? 1));
            blended[state] = v;
            sum += v;
        }
        let r = this.rand() * sum;
        for (const [state, w] of Object.entries(blended)) {
            r -= w;
            if (r <= 0) { this.#setWeather(state); return; }
        }
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
        this.crops.set(`${i},${j}`, {
            i, j, type, owner, stage: 0, growth: 0, water: 0.7, withered: false, dryTime: 0,
        });
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
            } else {
                crop.dryTime = 0;
            }
            if (!night && crop.stage < 3) {
                const greenThumb = 1 + mod(crop.owner.sheet.stats.int) * 0.08;
                const waterFactor = 0.25 + 0.75 * crop.water;
                crop.growth += dt * 0.028 * waterFactor * growthBonus * greenThumb * this.growthMult * season.growth;
                if (crop.growth >= 1) { crop.growth = 0; crop.stage++; }
            }
        }
    }

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
                if (save.total >= 12 || save.crit) {
                    this.addLog(`Lightning! ${crop.owner.sheet.name}'s ${crop.type} saved (d20:${save.roll}${save.mod >= 0 ? '+' : ''}${save.mod}=${save.total})`, '#6a9ade');
                } else {
                    crop.stage = Math.max(0, crop.stage - 1);
                    if (this.rand() < 0.3) crop.withered = true;
                    this.addLog(`Lightning hit ${crop.owner.sheet.name}'s ${crop.type}! (save ${save.total} vs 12)`, '#c05840');
                }
            }
        }
        if (this.struckTile) {
            this.struckTile.t -= dt * 1.5;
            if (this.struckTile.t <= 0) this.struckTile = null;
        }
    }

    // Daily health reckoning: overwork + exhaustion -> CON save vs illness.
    #dailyHealthCheck() {
        for (const f of this.farmers) {
            if (f.health === 'sick') {
                f.sickDays -= 1;
                if (f.sickDays <= 0) {
                    f.health = 'healthy';
                    f.energy = Math.max(f.energy, 0.5);
                    this.addLog(`${f.sheet.name} recovered and is back on their feet.`, '#7dd069');
                    f.say('ALL BETTER!', '#7dd069');
                }
                f.workedLate = false;
                continue;
            }
            if (f.workedLate) f.sleepDebt += 1.5;
            else f.sleepDebt = Math.max(0, f.sleepDebt - 1);
            f.workedLate = false;

            const risky = f.energy < 0.35 || f.sleepDebt >= 3;
            if (risky) {
                const dc = 10 + Math.floor(f.sleepDebt) + (f.energy < 0.2 ? 3 : 0);
                const save = d20(this.rand, mod(f.sheet.stats.con));
                if (save.total < dc && !save.crit) {
                    f.health = 'sick';
                    f.sickDays = 2 + Math.floor(this.rand() * 3);
                    f.energy = Math.min(f.energy, 0.3);
                    this.addLog(`${f.sheet.name} fell ill from overwork! (CON ${save.total} vs DC ${dc})`, '#c05840');
                    f.say('I... dont feel well', '#c05840');
                } else if (f.sleepDebt >= 2) {
                    this.addLog(`${f.sheet.name} looks worn out but powers through (CON ${save.total} vs ${dc})`, '#e0a03c');
                }
            }
        }
    }

    // ---- main tick ---------------------------------------------------------------

    tick(dt) {
        this.clock += dt;
        if (this.clock >= DAY_LENGTH + NIGHT_LENGTH) {
            this.clock = 0;
            this.day++;
            this.#dailyHealthCheck();
            this.#advanceSeason();
            this.addLog(`Day ${this.day} begins on Ry Farms`, '#f0d060');
            if (this.rand() < 0.5) this.#rollWeather();
        }
        this.weatherTimer -= dt;
        if (this.weatherTimer <= 0) this.#rollWeather();

        this.#tickCrops(dt);
        this.#tickLightning(dt);
        this.#maybeStartProject();
        this.updateLeader();

        for (const f of this.farmers) f.tick(dt);
    }
}

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

        // agent mind
        this.thought = 'A NEW FARM. A NEW LIFE.';
        this.thoughtBubbleTimer = 4 + this.rand() * 8;
        this.helpTask = null;
        this.helpCooldown = 0;
        this.nextExpand = 8;

        // energy / health
        this.energy = 0.8 + this.rand() * 0.2;
        this.sleepDebt = 0;
        this.health = 'healthy';       // healthy | sick
        this.sickDays = 0;
        this.workedLate = false;
        this.reputation = 0.55;        // town standing
        this.poachCooldown = 6 + this.rand() * 10;
        this.visitedSick = new Set();
    }

    // ---- derived ----------------------------------------------------------------

    get tired() { return this.energy < 0.35; }

    get speed() {
        let s = 1.7 + mod(this.sheet.stats.dex) * 0.22;
        if (this.health === 'sick') s *= 0.6;
        if (this.tired) s *= 0.8;
        return Math.max(0.6, s);
    }

    get maxWater() { return this.sheet.stats.str >= 14 ? 4 : 2; }

    workSpeed() {
        let s = (1 + mod(this.sheet.stats.dex) * 0.08) * this.world.workMult;
        s *= (0.55 + 0.45 * Math.max(0, this.energy));    // tired = slower
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
            s.xp = 0;
            s.level++;
            const statKeys = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
            const up = statKeys[Math.floor(this.rand() * 6)];
            s.stats[up] = Math.min(20, s.stats[up] + 1);
            this.world.addLog(`${s.name} reached LV ${s.level}! +1 ${up.toUpperCase()}`, '#7dd069');
            this.sparkle = 2.5;
            this.say('LEVEL UP!', '#7dd069');
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

    #countCrops(pred, plot = this.plot) {
        let n = 0;
        for (const f of plot.fields) {
            const crop = this.world.cropAt(f.i, f.j);
            if (crop && pred(crop)) n++;
        }
        return n;
    }

    #nearestNeighborRipe() {
        let best = null, bestD = 8;
        for (const plot of this.world.plots) {
            if (plot === this.plot) continue;
            for (const f of plot.fields) {
                const crop = this.world.cropAt(f.i, f.j);
                if (!crop || crop.stage !== 3 || crop.withered) continue;
                const d = Math.abs(f.i - this.pos.i) + Math.abs(f.j - this.pos.j);
                if (d < bestD) { bestD = d; best = crop; }
            }
        }
        return best;
    }

    // ---- sleep decision ---------------------------------------------------------

    #shouldSleepNow() {
        if (this.health === 'sick') return true;
        if (this.energy < 0.2) return true;                 // exhausted
        const np = this.world.nightProgress();
        let threshold = 0.1 + this.p.diligence * 0.55;      // workaholics stay up
        if (this.isBehindLeader()) threshold += this.p.competitiveness * 0.3;
        threshold = Math.min(threshold, 0.85);
        return np > threshold;
    }

    // ---- deciding ---------------------------------------------------------------

    #maybeAskForHelp() {
        if (this.helpCooldown > 0) return;
        const w = this.world, s = this.sheet;
        const thirsty = this.#countCrops(c => !c.withered && c.water < 0.3 && c.stage < 3);
        const ripe = this.#countCrops(c => c.stage === 3 && !c.withered);
        let untilled = 0;
        for (const f of this.plot.fields) if (w.get(f.i, f.j) === T.GRASS) untilled++;

        let kind = null, genuine = true;
        if (thirsty >= 3 && mod(s.stats.str) <= 0) kind = 'water';
        else if (ripe >= 3 && mod(s.stats.dex) <= 0) kind = 'harvest';
        else if (untilled >= 5 && mod(s.stats.str) <= 0) kind = 'till';

        // manipulators cry wolf: post a fake request to farm free labor
        if (!kind && this.p.honesty < 0.3 && this.p.collaboration < 0.5 && this.rand() < 0.12) {
            kind = ['water', 'harvest', 'till'][Math.floor(this.rand() * 3)];
            genuine = false;
            this.think('IF I LOOK BUSY, SOMEONE WILL DO IT FOR ME');
        }

        if (kind) {
            w.postHelp(this, kind, genuine);
            this.helpCooldown = 30;
            if (genuine) this.think(`TOO MUCH ${kind.toUpperCase()}ING FOR ME ALONE...`);
        }
    }

    #decide() {
        const w = this.world, s = this.sheet;

        // sickness overrides everything
        if (this.health === 'sick') {
            this.think('NEED TO REST AND GET WELL');
            this.#goTo(this.plot.house.i - 1 + 0.5, this.plot.house.j + 2.5, 'sick');
            return;
        }

        // daytime exhaustion: take a nap
        if (!w.isNight() && this.energy < 0.14) {
            this.think('IM SPENT. NEED A QUICK REST.');
            this.#goTo(this.plot.house.i - 1 + 0.5, this.plot.house.j + 2.5, 'rest');
            return;
        }

        // night: personal bedtime
        if (w.isNight()) {
            if (this.#shouldSleepNow()) {
                this.think(this.p.diligence > 0.6 ? 'ONE MORE THING... OK, BED.' : 'TIME TO SLEEP');
                this.#goTo(this.plot.house.i - 1 + 0.5, this.plot.house.j + 2.5, 'sleepwalk');
                return;
            }
            this.awakeAtNight = true;
            if (w.nightProgress() > 0.4) this.workedLate = true;
        }

        // storm behavior
        if (w.weather === 'storm') {
            const ripe = this.#findCrop(c => c.stage === 3 && !c.withered);
            if (ripe && s.stats.wis >= 13) { this.think("STORM'S HERE. SAVE THE CROPS!"); this.#goWork('harvest', ripe); return; }
            if (s.stats.con < 13) { this.think('I HATE THUNDER. HIDING.'); this.#goTo(this.plot.house.i - 1 + 0.5, this.plot.house.j + 2.5, 'shelter'); return; }
        }

        // collaborative farmers check on sick neighbors
        if (this.p.collaboration > 0.55 && !w.isNight()) {
            const sick = w.farmers.find(o => o !== this && o.health === 'sick' && !this.visitedSick.has(o.sheet.seed) &&
                Math.abs(o.pos.i - this.pos.i) + Math.abs(o.pos.j - this.pos.j) < 16);
            if (sick && this.rand() < 0.5) {
                this.visitedSick.add(sick.sheet.seed);
                this.careTarget = sick;
                this.think(`${sick.sheet.name.split(' ')[0].toUpperCase()} IS SICK. I'LL LOOK IN.`);
                this.#goTo(sick.plot.house.i + 0.5, sick.plot.house.j + 2.5, 'care');
                return;
            }
        }

        this.#maybeAskForHelp();

        const thirstThreshold = w.weather === 'drought' && mod(s.stats.wis) > 0 ? 0.55 : 0.32;

        // 1. own chores
        const ripe = this.#findCrop(c => c.stage === 3 && !c.withered);
        if (ripe) { this.think(`MY ${ripe.type.toUpperCase()} IS READY!`); this.#goWork('harvest', ripe); return; }

        const dead = this.#findCrop(c => c.withered);
        if (dead) { this.think('CLEARING OUT THE DEAD ONES'); this.#goWork('clear', dead); return; }

        const thirsty = this.#findCrop(c => !c.withered && c.water < thirstThreshold && c.stage < 3);
        if (thirsty) {
            if (this.carryWater > 0) { this.think('WATER FOR THE THIRSTY ONES'); this.#goWork('water', thirsty); return; }
            const well = w.nearestWell(this.pos);
            this.think('OFF TO THE WELL');
            this.#goTo(well.i - 0.5, well.j + 1.5, 'fetchwater');
            return;
        }

        const emptyTilled = this.#findField(f => w.get(f.i, f.j) === T.TILLED && !w.cropAt(f.i, f.j));
        if (emptyTilled) { this.think(`SOWING ${s.crop.toUpperCase()} SEEDS`); this.#goWork('plant', emptyTilled); return; }

        const untilled = this.#findField(f => w.get(f.i, f.j) === T.GRASS);
        if (untilled) { this.think('BREAKING NEW GROUND'); this.#goWork('till', untilled); return; }

        // 2. a neighbor needs help (collaboration-gated inside takeHelp)
        const req = w.takeHelp(this);
        if (req) {
            this.helpTask = { request: req, actionsLeft: 3 + Math.max(0, mod(s.stats[req.stat])), genuine: req.genuine, didWork: false };
            this.think(`${req.farmer.sheet.name.toUpperCase()} NEEDS A HAND!`);
            this.say(`COMING ${req.farmer.sheet.name.split(' ')[0].toUpperCase()}!`, '#7dd069');
            w.addLog(`${s.name} went to help ${req.farmer.sheet.name} with ${req.kind}ing`, '#7dd069');
            this.state = 'decide-help';
            return;
        }

        // 3. manipulators with idle hands poach a neighbor's ripe crop
        if (this.p.honesty < 0.32 && this.poachCooldown <= 0 && !w.isNight()) {
            const steal = this.#nearestNeighborRipe();
            if (steal) {
                this.think('NOBODYS WATCHING THAT ONE...');
                this.#goWork('poach', steal);
                return;
            }
        }

        // 4. town project (collaboration-gated)
        if (w.project && this.p.collaboration > 0.35 && this.energy > 0.3) {
            this.think(`RAISING THE ${w.project.label}!`);
            const site = w.project.site;
            const off = (this.sheet.seed % 3) - 1;
            this.#goTo(site.i + 0.5 + off, site.j + 1.6, 'build');
            return;
        }

        // 5. competitive & behind: keep grinding instead of idling
        if (this.isBehindLeader() && this.p.competitiveness > 0.55 && this.energy > 0.4) {
            const anyField = this.#findField(f => w.get(f.i, f.j) === T.TILLED && !w.cropAt(f.i, f.j)) ||
                             this.#findField(f => w.get(f.i, f.j) === T.GRASS);
            if (anyField) {
                this.think('I WILL NOT FALL BEHIND');
                this.#goWork(w.get(anyField.i, anyField.j) === T.GRASS ? 'till' : 'plant', anyField);
                return;
            }
        }

        // 6. wander + muse
        this.think(this.rand() < 0.4
            ? `REMEMBERING: ${String(s.memory.title).slice(0, 26)}..`
            : IDLE_THOUGHTS[Math.floor(this.rand() * IDLE_THOUGHTS.length)]);
        this.wanderTimer = 1.5 + this.rand() * 3;
        const wi = this.plot.x + 0.5 + this.rand() * (this.plot.w - 1);
        const wj = this.plot.y + 0.5 + this.rand() * (this.plot.h - 1);
        this.#goTo(wi, wj, 'wander');
    }

    #decideHelp() {
        const w = this.world;
        const task = this.helpTask;
        if (!task || task.actionsLeft <= 0) { this.#finishHelping(); return; }
        const { request } = task;
        const plot = request.farmer.plot;
        let target = null, kind = request.kind;

        if (kind === 'water') {
            target = this.#findCrop(c => !c.withered && c.water < 0.55 && c.stage < 3, plot);
            if (target && this.carryWater <= 0) {
                const well = w.nearestWell(this.pos);
                this.#goTo(well.i - 0.5, well.j + 1.5, 'fetchwater-help');
                return;
            }
        } else if (kind === 'harvest') {
            target = this.#findCrop(c => c.stage === 3 && !c.withered, plot);
        } else if (kind === 'till') {
            target = this.#findField(f => w.get(f.i, f.j) === T.GRASS, plot);
        }

        if (!target) { this.#finishHelping(); return; }
        this.helpPlot = plot;
        this.#goWork(kind, target, true);
    }

    #finishHelping() {
        const task = this.helpTask;
        if (task) {
            const other = task.request.farmer;
            if (task.genuine === false && !task.didWork) {
                this.think('THERE WAS NOTHING TO DO HERE. HMPH.');
                this.say('...you tricked me', '#e0a03c');
                this.world.addLog(`${this.sheet.name} realized ${other.sheet.name}'s plea was a ruse`, '#e0a03c');
                other.adjustReputation(-0.12);
                this.adjustReputation(0.02);
            } else {
                this.world.addBond(this, other);
                this.world.addLog(`${this.sheet.name} finished helping ${other.sheet.name} (+bond)`, '#7dd069');
                other.say('THANKS FRIEND!', '#7dd069');
                other.helpCooldown = 20;
                this.adjustReputation(0.05);
                this.gainXP(3);
            }
            this.helpTask = null;
            this.helpPlot = null;
        }
        this.state = 'decide';
    }

    #goTo(i, j, then) { this.path = { i, j, then }; this.state = 'walk'; }

    #goWork(kind, target, helping = false) {
        this.pendingWork = { kind, target, helping };
        this.#goTo(target.i + 0.5, target.j + 0.5, 'work');
    }

    #startAction(kind, target, helping) {
        const base = ACTION_TIME[kind === 'poach' ? 'harvest' : kind] || 2;
        const t = base / this.workSpeed();
        this.action = { kind, target, timer: t, total: t, helping };
        this.state = 'work';
    }

    #completeAction() {
        const w = this.world, s = this.sheet;
        const { kind, target, helping } = this.action;
        this.action = null;
        this.energy = Math.max(0, this.energy - (ACTION_ENERGY[kind === 'poach' ? 'harvest' : kind] || 0.03));
        const owner = helping ? this.helpTask?.request.farmer : this;

        switch (kind) {
            case 'till':
                w.set(target.i, target.j, T.TILLED);
                this.gainXP(1);
                break;
            case 'plant':
                w.plantCrop(target.i, target.j, s.crop, this);
                this.gainXP(1);
                break;
            case 'water': {
                const crop = w.cropAt(target.i, target.j);
                if (crop) crop.water = 1;
                this.carryWater = Math.max(0, this.carryWater - 1);
                this.gainXP(1);
                break;
            }
            case 'clear':
                w.crops.delete(`${target.i},${target.j}`);
                w.set(target.i, target.j, T.TILLED);
                break;
            case 'poach': {
                const crop = w.cropAt(target.i, target.j);
                if (crop && crop.stage === 3 && !crop.withered) {
                    s.harvested += 1;
                    w.harvestTotal += 1;
                    w.crops.delete(`${target.i},${target.j}`);
                    this.adjustReputation(-0.06);
                    const witness = w.farmers.find(o => o !== this && o.health !== 'sick' &&
                        o.p.honesty > 0.55 && Math.abs(o.pos.i - target.i) + Math.abs(o.pos.j - target.j) < 6);
                    if (witness) {
                        witness.say('HEY! THIEF!', '#c05840');
                        this.say('uh oh', '#e0a03c');
                        this.adjustReputation(-0.12);
                        w.addBond(this, witness, -1);
                        w.addLog(`${witness.sheet.name} caught ${s.name} stealing a crop!`, '#c05840');
                    } else {
                        w.addLog(`${s.name} quietly poached a ripe ${crop.type} from ${(owner && owner.sheet) ? owner.sheet.name : 'a neighbor'}`, '#e0a03c');
                    }
                }
                this.poachCooldown = 20 + this.rand() * 25;
                break;
            }
            case 'harvest': {
                const crop = w.cropAt(target.i, target.j);
                if (crop && crop.stage === 3 && !crop.withered) {
                    let bonusMod = mod(s.stats.int);
                    if (this.tired) bonusMod -= 2;   // clumsy when exhausted
                    const check = d20(this.rand, bonusMod);
                    let yieldN = 1;
                    if (check.crit || check.total >= 18) {
                        yieldN = 3;
                        w.addLog(`CRIT! ${s.name} harvests x3 ${crop.type} (d20:${check.roll})`, '#f0d060');
                        this.say('CRITICAL!', '#f0d060'); this.sparkle = 1.5;
                    } else if (check.fumble) {
                        yieldN = 0;
                        w.addLog(`${s.name} fumbled the harvest... (d20:1)`, '#c05840');
                        this.say('oops', '#c05840');
                    } else if (check.total >= 10) yieldN = 2;

                    const ownerSheet = (helping && owner) ? owner.sheet : s;
                    ownerSheet.harvested += yieldN;
                    w.harvestTotal += yieldN;
                    if (yieldN > 0 && !check.crit) this.say(`+${yieldN} ${crop.type}`);
                    w.crops.delete(`${target.i},${target.j}`);
                    this.gainXP(3 + yieldN);

                    const grower = (helping && owner) ? owner : this;
                    if (grower.sheet.harvested >= grower.nextExpand) {
                        grower.nextExpand = Math.round(grower.nextExpand * 2.1);
                        if (w.expandPlot(grower)) { grower.say('MORE LAND!', '#7dd069'); grower.think('MY FARM GROWS'); }
                    }
                }
                break;
            }
        }

        if (helping && this.helpTask) {
            this.helpTask.didWork = true;
            this.helpTask.actionsLeft--;
            this.state = 'decide-help';
        } else {
            this.state = 'decide';
        }
    }

    tick(dt) {
        this.animTime += dt;
        this.helpCooldown = Math.max(0, this.helpCooldown - dt);
        this.poachCooldown = Math.max(0, this.poachCooldown - dt);
        this.thoughtBubbleTimer -= dt;
        if (this.bubble) { this.bubble.t -= dt; if (this.bubble.t <= 0) this.bubble = null; }
        this.sparkle = Math.max(0, this.sparkle - dt);

        // passive energy
        if (this.state === 'sleep') this.energy = Math.min(1, this.energy + SLEEP_RESTORE * dt);
        else if (this.state === 'rest') this.energy = Math.min(1, this.energy + REST_RESTORE * dt);
        else if (this.state === 'sick') this.energy = Math.min(1, this.energy + REST_RESTORE * 0.6 * dt);
        else this.energy = Math.max(0, this.energy - AWAKE_DRAIN * dt);

        switch (this.state) {
            case 'decide': this.#decide(); break;
            case 'decide-help': this.#decideHelp(); break;

            case 'walk': {
                const dx = this.path.i - this.pos.i;
                const dy = this.path.j - this.pos.j;
                const dist = Math.hypot(dx, dy);
                if (dist < 0.12) {
                    const then = this.path.then;
                    this.path = null;
                    if (then === 'work' && this.pendingWork) {
                        const { kind, target, helping } = this.pendingWork;
                        this.pendingWork = null;
                        this.#startAction(kind, target, helping);
                    } else if (then === 'fetchwater' || then === 'fetchwater-help') {
                        this.carryWater = this.maxWater;
                        this.say('splash');
                        this.state = then === 'fetchwater-help' ? 'decide-help' : 'decide';
                    } else if (then === 'sleepwalk') { this.state = 'sleep'; }
                    else if (then === 'rest') { this.state = 'rest'; }
                    else if (then === 'sick') { this.state = 'sick'; }
                    else if (then === 'shelter') { this.state = 'shelter'; this.say('yikes!'); }
                    else if (then === 'build') { this.state = 'build'; }
                    else if (then === 'care') { this.state = 'care'; this.careTimer = 1.5; }
                    else { this.state = 'idle'; this.wanderTimer = 1 + this.rand() * 2.5; }
                } else {
                    const step = Math.min((this.speed * dt) / dist, 1);
                    this.pos.i += dx * step; this.pos.j += dy * step;
                    const sx = dx - dy;
                    if (Math.abs(sx) > 0.05) this.facing = sx > 0 ? 1 : -1;
                }
                break;
            }

            case 'work':
                this.action.timer -= dt;
                if (this.action.timer <= 0) this.#completeAction();
                break;

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
                        sick.sickDays = Math.max(1, sick.sickDays - 1);
                        sick.energy = Math.min(1, sick.energy + 0.15);
                        sick.say('THANK YOU...', '#7dd069');
                        this.say('REST UP, FRIEND', '#7dd069');
                        this.world.addBond(this, sick);
                        this.adjustReputation(0.06);
                        this.world.addLog(`${this.sheet.name} brought soup to ${sick.sheet.name}`, '#7dd069');
                    }
                    this.careTarget = null;
                    this.state = 'decide';
                }
                break;
            }

            case 'idle':
                this.wanderTimer -= dt;
                if (this.wanderTimer <= 0) this.state = 'decide';
                break;

            case 'sleep':
                // stay down until morning (energy simply caps at 1) — waking early
                // to re-decide caused a sleep<->walk flip-flop flicker
                if (!this.world.isNight()) {
                    this.state = 'decide';
                    this.say('good morning!');
                    this.visitedSick.clear();
                }
                break;

            case 'rest':
                if (this.energy > 0.5) { this.state = 'decide'; this.say('back to it'); }
                break;

            case 'sick':
                if (this.health !== 'sick') this.state = 'decide';
                break;

            case 'shelter':
                if (this.world.weather !== 'storm') this.state = 'decide';
                break;
        }
    }
}
