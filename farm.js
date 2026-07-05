// farm.js — the Ry Farms simulation: world grid, plots, crops, weather,
// day/night cycle, farmer agents (thoughts, help requests, collaboration),
// communal building projects, and farm expansion. No rendering here.

import { mulberry32, mod, growFarmer } from './dna.js';

export const GRID = 72;           // world is GRID x GRID tiles
export const CENTER = GRID / 2;

export const T = { GRASS: 0, PATH: 1, TILLED: 2, HOUSE: 3, WELL: 4, SIGN: 5, STRUCT: 6 };

export const DAY_LENGTH = 80;     // seconds of daylight
export const NIGHT_LENGTH = 18;   // seconds of night

const WEATHER_STATES = {
    sun: { label: 'SUNNY', next: { sun: 2, cloud: 3, drought: 0.6 }, dur: [18, 40] },
    cloud: { label: 'CLOUDY', next: { sun: 2, rain: 3, storm: 0.8 }, dur: [10, 25] },
    rain: { label: 'RAIN', next: { cloud: 2, sun: 1, storm: 1 }, dur: [12, 28] },
    storm: { label: 'STORM!', next: { rain: 2, cloud: 2 }, dur: [8, 16] },
    drought: { label: 'DROUGHT', next: { sun: 1.5, cloud: 1 }, dur: [16, 30] },
};

// Communal projects, in unlock order. `at` = town harvest total that triggers it.
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
        this.crops = new Map();       // "i,j" -> crop
        this.plots = [];
        this.farmers = [];
        this.log = [];
        this.day = 1;
        this.clock = 0;
        this.harvestTotal = 0;

        this.weather = 'sun';
        this.weatherTimer = 20;
        this.lightningTimer = 0;
        this.lightningFlash = 0;
        this.struckTile = null;

        // collaboration state
        this.helpBoard = [];          // { farmer, kind, stat }
        this.project = null;          // active build site
        this.projectIndex = 0;        // next PROJECT_DEFS entry
        this.structures = [];         // completed { type, i, j }
        this.bonds = new Map();       // "seedA|seedB" -> count
        this.workMult = 1;
        this.growthMult = 1;
        this.lightningMult = 1;

        // commons
        this.well = { i: CENTER, j: CENTER };
        this.sign = { i: CENTER + 2, j: CENTER + 1 };
        this.wells = [this.well];
        this.set(this.well.i, this.well.j, T.WELL);
        this.set(this.sign.i, this.sign.j, T.SIGN);

        // homestead slots — ring 1; ring 2 opens when the town fills up
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

    // ---- bonds ------------------------------------------------------------------

    bondKey(a, b) {
        return a.sheet.seed < b.sheet.seed ? `${a.sheet.seed}|${b.sheet.seed}` : `${b.sheet.seed}|${a.sheet.seed}`;
    }
    addBond(a, b) {
        const k = this.bondKey(a, b);
        this.bonds.set(k, (this.bonds.get(k) || 0) + 1);
    }
    bondCount(f) {
        let n = 0;
        for (const [k, v] of this.bonds) {
            if (k.includes(String(f.sheet.seed)) && v > 0) n++;
        }
        return n;
    }

    // ---- farmers ------------------------------------------------------------------

    addFarmer(memory, mutation = 0) {
        let slot = this.slots.find(s => !s.used);
        if (!slot && this.ringCount === 1) {
            // the town grows: open a second ring of homesteads farther out
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
        this.addLog(`${sheet.name} the ${sheet.archetype} claimed a plot!`, '#7dd069');
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

    // ---- farm expansion -------------------------------------------------------------

    expandPlot(farmer) {
        const p = farmer.plot;
        const MAX = 13;
        if (p.w >= MAX) return false;
        const nx = p.x - 1, ny = p.y - 1, nw = p.w + 2, nh = p.h + 2;

        // stay in bounds
        if (nx < 2 || ny < 2 || nx + nw > GRID - 2 || ny + nh > GRID - 2) return false;
        // don't collide with other plots (with 1 tile of breathing room)
        for (const other of this.plots) {
            if (other === p) continue;
            if (nx < other.x + other.w + 1 && nx + nw > other.x - 1 &&
                ny < other.y + other.h + 1 && ny + nh > other.y - 1) return false;
        }
        // don't swallow the commons or structures
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

    // ---- communal projects ------------------------------------------------------------

    #maybeStartProject() {
        if (this.project || this.projectIndex >= PROJECT_DEFS.length) return;
        const def = PROJECT_DEFS[this.projectIndex];
        if (this.harvestTotal < def.at) return;

        // pick a free spot near the commons
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
        else if (type === 'well2') { this.wells.push({ i: site.i, j: site.j }); }

        this.addLog(`The ${label} is finished! ${perk}`, '#f0d060');
        for (const f of pr.builders) {
            f.gainXP(6);
            f.say('HOORAY!', '#f0d060');
            f.sparkle = 3;
            // builders bond with each other
            for (const g of pr.builders) if (g !== f && this.rand() < 0.6) this.addBond(f, g);
        }
    }

    // ---- help board -----------------------------------------------------------------

    postHelp(farmer, kind) {
        if (this.helpBoard.some(r => r.farmer === farmer)) return;
        this.helpBoard.push({ farmer, kind, stat: HELP_KINDS[kind].stat });
        this.addLog(`${farmer.sheet.name} posted: NEED HELP ${HELP_KINDS[kind].verb.toUpperCase()}`, '#e0a03c');
    }

    takeHelp(helper) {
        for (let i = 0; i < this.helpBoard.length; i++) {
            const req = this.helpBoard[i];
            if (req.farmer === helper) continue;
            const m = mod(helper.sheet.stats[req.stat]);
            const kind = m >= 1 || helper.sheet.stats.cha >= 14;
            if (kind) {
                this.helpBoard.splice(i, 1);
                return req;
            }
        }
        return null;
    }

    clearHelp(farmer) {
        this.helpBoard = this.helpBoard.filter(r => r.farmer !== farmer);
    }

    // ---- weather ----------------------------------------------------------------------

    #rollWeather() {
        const table = WEATHER_STATES[this.weather].next;
        let sum = 0;
        for (const w of Object.values(table)) sum += w;
        let r = this.rand() * sum;
        for (const [state, w] of Object.entries(table)) {
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

    // ---- crops -------------------------------------------------------------------------

    cropAt(i, j) { return this.crops.get(`${i},${j}`); }

    plantCrop(i, j, type, owner) {
        this.crops.set(`${i},${j}`, {
            i, j, type, owner,
            stage: 0, growth: 0, water: 0.7, withered: false,
            dryTime: 0,
        });
    }

    #tickCrops(dt) {
        const growthBonus = { sun: 1.15, cloud: 1, rain: 1.2, storm: 0.6, drought: 0.55 }[this.weather];
        const waterDecay = { sun: 0.014, cloud: 0.007, rain: 0, storm: 0, drought: 0.045 }[this.weather];
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
                crop.growth += dt * 0.028 * waterFactor * growthBonus * greenThumb * this.growthMult;
                if (crop.growth >= 1) {
                    crop.growth = 0;
                    crop.stage++;
                }
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

    // ---- main tick -----------------------------------------------------------------------

    tick(dt) {
        this.clock += dt;
        if (this.clock >= DAY_LENGTH + NIGHT_LENGTH) {
            this.clock = 0;
            this.day++;
            this.addLog(`Day ${this.day} begins on Ry Farms`, '#f0d060');
            if (this.rand() < 0.5) this.#rollWeather();
        }

        this.weatherTimer -= dt;
        if (this.weatherTimer <= 0) this.#rollWeather();

        this.#tickCrops(dt);
        this.#tickLightning(dt);
        this.#maybeStartProject();

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
        this.helpTask = null;         // { request, actionsLeft }
        this.helpCooldown = 0;        // seconds until we may post again
        this.nextExpand = 8;          // harvest count that triggers fence expansion
    }

    get speed() {
        return Math.max(0.8, 1.7 + mod(this.sheet.stats.dex) * 0.22);
    }

    get maxWater() {
        return this.sheet.stats.str >= 14 ? 4 : 2;
    }

    workSpeed() {
        let s = (1 + mod(this.sheet.stats.dex) * 0.08) * this.world.workMult;
        for (const other of this.world.farmers) {
            if (other === this || other.sheet.stats.cha < 14) continue;
            const d = Math.abs(other.pos.i - this.pos.i) + Math.abs(other.pos.j - this.pos.j);
            if (d < 6) { s *= 1.15; break; }
        }
        return s;
    }

    say(text, color = '#fff') {
        this.bubble = { text, color, t: 2.4 };
    }

    think(text) {
        this.thought = text.toUpperCase();
        // occasionally surface the thought as a bubble so the town feels alive
        if (this.thoughtBubbleTimer <= 0) {
            this.say(this.thought.length > 26 ? this.thought.slice(0, 26) + '..' : this.thought, '#c8ccd8');
            this.thoughtBubbleTimer = 9 + this.rand() * 10;
        }
    }

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

    // ---- perception --------------------------------------------------------------

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

    // ---- deciding what to do -------------------------------------------------------

    #maybeAskForHelp() {
        if (this.helpCooldown > 0) return;
        const w = this.world, s = this.sheet;

        const thirsty = this.#countCrops(c => !c.withered && c.water < 0.3 && c.stage < 3);
        const ripe = this.#countCrops(c => c.stage === 3 && !c.withered);
        let untilled = 0;
        for (const f of this.plot.fields) if (w.get(f.i, f.j) === T.GRASS) untilled++;

        let kind = null;
        if (thirsty >= 3 && mod(s.stats.str) <= 0) kind = 'water';
        else if (ripe >= 3 && mod(s.stats.dex) <= 0) kind = 'harvest';
        else if (untilled >= 5 && mod(s.stats.str) <= 0) kind = 'till';

        if (kind) {
            w.postHelp(this, kind);
            this.helpCooldown = 30;
            this.think(`TOO MUCH ${kind.toUpperCase()}ING FOR ME ALONE...`);
        }
    }

    #decide() {
        const w = this.world, s = this.sheet;

        // night: head home
        if (w.isNight()) {
            this.think('TIME TO SLEEP');
            this.#goTo(this.plot.house.i - 1 + 0.5, this.plot.house.j + 2.5, 'sleepwalk');
            return;
        }

        // storm behavior
        if (w.weather === 'storm') {
            const ripe = this.#findCrop(c => c.stage === 3 && !c.withered);
            if (ripe && s.stats.wis >= 13) {
                this.think("STORM'S HERE. SAVE THE CROPS FIRST!");
                this.#goWork('harvest', ripe);
                return;
            }
            if (s.stats.con < 13) {
                this.think('I HATE THUNDER. HIDING AT HOME.');
                this.#goTo(this.plot.house.i - 1 + 0.5, this.plot.house.j + 2.5, 'shelter');
                return;
            }
        }

        // is my farm swamped? maybe post to the help board
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

        // 2. a neighbor needs help
        const req = w.takeHelp(this);
        if (req) {
            this.helpTask = { request: req, actionsLeft: 3 + Math.max(0, mod(s.stats[req.stat])) };
            this.think(`${req.farmer.sheet.name.toUpperCase()} NEEDS A HAND!`);
            this.say(`COMING ${req.farmer.sheet.name.split(' ')[0].toUpperCase()}!`, '#7dd069');
            w.addLog(`${s.name} went to help ${req.farmer.sheet.name} with ${req.kind}ing`, '#7dd069');
            this.state = 'decide-help';
            return;
        }

        // 3. town project
        if (w.project) {
            this.think(`RAISING THE ${w.project.label}!`);
            const site = w.project.site;
            const off = (this.sheet.seed % 3) - 1;
            this.#goTo(site.i + 0.5 + off, site.j + 1.6, 'build');
            return;
        }

        // 4. nothing to do: wander + muse
        this.think(this.rand() < 0.4
            ? `REMEMBERING: ${String(s.memory.title).slice(0, 26)}..`
            : IDLE_THOUGHTS[Math.floor(this.rand() * IDLE_THOUGHTS.length)]);
        this.wanderTimer = 1.5 + this.rand() * 3;
        const wi = this.plot.x + 0.5 + this.rand() * (this.plot.w - 1);
        const wj = this.plot.y + 0.5 + this.rand() * (this.plot.h - 1);
        this.#goTo(wi, wj, 'wander');
    }

    // help-mode decision: work the requester's farm
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
            this.world.addBond(this, other);
            this.world.addLog(`${this.sheet.name} finished helping ${other.sheet.name} (+bond)`, '#7dd069');
            other.say('THANKS FRIEND!', '#7dd069');
            other.helpCooldown = 20;
            this.gainXP(3);
            this.helpTask = null;
            this.helpPlot = null;
        }
        this.state = 'decide';
    }

    #goTo(i, j, then) {
        this.path = { i, j, then };
        this.state = 'walk';
    }

    #goWork(kind, target, helping = false) {
        this.pendingWork = { kind, target, helping };
        this.#goTo(target.i + 0.5, target.j + 0.5, 'work');
    }

    #startAction(kind, target, helping) {
        const t = (ACTION_TIME[kind] || 2) / this.workSpeed();
        this.action = { kind, target, timer: t, total: t, helping };
        this.state = 'work';
    }

    #completeAction() {
        const w = this.world, s = this.sheet;
        const { kind, target, helping } = this.action;
        this.action = null;
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
            case 'harvest': {
                const crop = w.cropAt(target.i, target.j);
                if (crop && crop.stage === 3 && !crop.withered) {
                    const check = d20(this.rand, mod(s.stats.int));
                    let yieldN = 1;
                    if (check.crit || check.total >= 18) {
                        yieldN = 3;
                        w.addLog(`CRIT! ${s.name} harvests x3 ${crop.type} (d20:${check.roll}${check.mod >= 0 ? '+' : ''}${check.mod})`, '#f0d060');
                        this.say('CRITICAL!', '#f0d060');
                        this.sparkle = 1.5;
                    } else if (check.fumble) {
                        yieldN = 0;
                        w.addLog(`${s.name} fumbled the harvest... (d20:1)`, '#c05840');
                        this.say('oops', '#c05840');
                    } else if (check.total >= 10) {
                        yieldN = 2;
                    }
                    // harvests credit the plot owner
                    const ownerSheet = (helping && owner) ? owner.sheet : s;
                    ownerSheet.harvested += yieldN;
                    w.harvestTotal += yieldN;
                    if (yieldN > 0 && !check.crit) this.say(`+${yieldN} ${crop.type}`);
                    w.crops.delete(`${target.i},${target.j}`);
                    this.gainXP(3 + yieldN);

                    // fence expansion milestones (owner's farm)
                    const grower = (helping && owner) ? owner : this;
                    if (grower.sheet.harvested >= grower.nextExpand) {
                        grower.nextExpand = Math.round(grower.nextExpand * 2.1);
                        if (w.expandPlot(grower)) {
                            grower.say('MORE LAND!', '#7dd069');
                            grower.think('MY FARM GROWS');
                        }
                    }
                }
                break;
            }
        }

        if (helping && this.helpTask) {
            this.helpTask.actionsLeft--;
            this.state = 'decide-help';
        } else {
            this.state = 'decide';
        }
    }

    tick(dt) {
        this.animTime += dt;
        this.helpCooldown = Math.max(0, this.helpCooldown - dt);
        this.thoughtBubbleTimer -= dt;
        if (this.bubble) {
            this.bubble.t -= dt;
            if (this.bubble.t <= 0) this.bubble = null;
        }
        this.sparkle = Math.max(0, this.sparkle - dt);

        switch (this.state) {
            case 'decide':
                this.#decide();
                break;

            case 'decide-help':
                this.#decideHelp();
                break;

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
                    } else if (then === 'sleepwalk') {
                        this.state = 'sleep';
                    } else if (then === 'shelter') {
                        this.state = 'shelter';
                        this.say('yikes!');
                    } else if (then === 'build') {
                        this.state = 'build';
                    } else {
                        this.state = 'idle';
                        this.wanderTimer = 1 + this.rand() * 2.5;
                    }
                } else {
                    const step = Math.min((this.speed * dt) / dist, 1);
                    this.pos.i += dx * step;
                    this.pos.j += dy * step;
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
                // check back on the farm every so often
                if (this.world.isNight() || this.rand() < dt * 0.06) this.state = 'decide';
                break;
            }

            case 'idle':
                this.wanderTimer -= dt;
                if (this.wanderTimer <= 0) this.state = 'decide';
                break;

            case 'sleep':
                if (!this.world.isNight()) {
                    this.state = 'decide';
                    this.say('good morning!');
                }
                break;

            case 'shelter':
                if (this.world.weather !== 'storm') this.state = 'decide';
                break;
        }
    }
}
