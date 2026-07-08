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

import { mulberry32, mod, growFarmer, personalityLabel, ALL_CROPS } from './dna.js';
export { ALL_CROPS };   // re-exported so tools/tests can pull the crop list from the sim entrypoint

// The FOUNDING VALLEY: the hand-tuned region generated with the original global algorithm
// (plaza, homestead ring, clustered groves). Beyond it the world is INFINITE — tiles are
// generated lazily, chunk by chunk, from pure position-hash noise as farmers explore.
export const GRID = 110;
export const CENTER = GRID / 2;
export const CHUNK = 16;   // tile side of one lazily-generated (and lazily-rendered) chunk
const FOREST_BORDER = 5;   // keep trees this many tiles off the map edge
const ISO_HALF_W = 10;     // mirrors TILE_W / 2 without importing renderer code
const ISO_HALF_H = 5;      // mirrors TILE_H / 2 without importing renderer code

export const T = { GRASS: 0, PATH: 1, TILLED: 2, HOUSE: 3, WELL: 4, SIGN: 5, STRUCT: 6, WATER: 7, COOP: 8, BARN: 9, TREE: 10, STUMP: 11, WHEAT: 12, FLOWER: 13, ROCK: 14 };
export const FORAGE_TILES = [T.WHEAT, T.FLOWER];
export const FORAGE_NAME = { [T.WHEAT]: 'wild wheat', [T.FLOWER]: 'wildflowers' };

// Canonical item catalog for the inventory UI. `icon` indexes the fantasy 16x16 icon
// pack (assets/.../Separately/Icon{icon}_1.png), resolved to an <img> in main.js.
// These are the resources a farmer genuinely owns and can spend/trade — no phantom
// double-counting: crops == the spendable produce stockpile, goods are forage stash.
export const ITEMS = {
    wood:   { name: 'WOOD',   icon: 75 },
    ore:    { name: 'ORE',    icon: 47 },
    crops:  { name: 'CROPS',  icon: 73 },
    wheat:  { name: 'WHEAT',  icon: 45 },   // foraged wild wheat — FOLDED into the wheat crop stack in the inventory
    flower: { name: 'FLOWER', icon: 79 },
};

// Craftable tools, unlocked by level and paid for in ore + wood (mined/chopped).
// `waters` = how many thirsty crops one watering action now serves (the tedium fix the
// player asked for). `requires` chains an upgrade off an earlier tool. Ordered easiest-first.
export const CRAFTABLES = [
    { id: 'wateringCan', name: 'WATERING CAN', icon: 105, reqLevel: 10, ore: 6, wood: 2, waters: 3,
      desc: 'Waters 3 crops per trip' },
    { id: 'sprinkler', name: 'IRRIGATION RIG', icon: 113, reqLevel: 15, ore: 12, wood: 4, waters: 5,
      requires: 'wateringCan', desc: 'Waters a line of 5 crops' },
];

// wood economy
const TREE_WOOD = [1, 3, 5];   // wood from felling a tree, by growth stage: sapling 1 / young 3 / mature 5
const TREE_CHOPS = [1, 3, 5];  // chops (hence exhaustion) to fell each stage — proportionate to the yield
const WOOD_STUMP = 3;      // grubbing the stump (roots included) yields 3 wood
const STUMP_CHOPS = 3;     // ...and takes 3 chops of graft, matching that yield
const TREE_STAGE_DAYS = [8, 12];   // sapling->young takes 8 days; young->mature takes 12 (20 days to mature)
const CROP_STAGE_DAYS = [3, 4.5, 1.5]; // calibrated so a well-tended crop in good weather sprouts ~day 2 (48h),
                                       // reaches its next stage ~day 5, and ripens ~day 6 from sowing
const ORE_ROCK = 2;        // iron ore from breaking a rock
const FACILITY_WOOD = 6;   // wood to raise a facility
const FENCE_WOOD = 8;      // wood to fence the new homestead
const FENCE_POST_WOOD = 2; // wood per fence post (one per border tile) — must be on hand to raise it, reclaimed when torn down
// Tiered dwellings. L1 (tipi) is quick shelter; L2 (yurt) is a real mid-game investment; L3
// (cottage) is the lifetime goal — a full YEAR of graft. Each tier gates on lifetime crops
// (harvested, NOT spent), a personal LEVEL (minLevel), and a real pile of timber + stone, so a
// farmer can't rush a farmhouse in a week. Livestock rides on the cottage (see FACILITY_MIN_LEVEL).
const HOUSE_TIERS = [
    null,
    { wood: 10, ore: 2, harvested: 0, minLevel: 0, name: 'tipi', buildSteps: 30, footprint: 3 },        // L1 — 3x3, ~1/4 day
    { wood: 30, ore: 12, harvested: 300, minLevel: 9, name: 'yurt', buildSteps: 62, footprint: 5 },     // L2 — 5x5, ~1/2 day
    { wood: 120, ore: 60, harvested: 1400, minLevel: 18, name: 'cottage', buildSteps: 250, footprint: 7 }, // L3 — 7x7, ~2 days (needs an expanded plot)
];
const START_WOOD = 4;
const MAX_FARMERS = 8;   // the original map maxes out at the first ring's 8 homesteads

// Leveling is EXPONENTIAL: the XP to advance a level grows geometrically, so early levels come
// quick but mastery is a real haul — a farmer who used to hit LV20 in a fortnight now takes most
// of a year. xpForLevel(L) = the XP needed to go from level L to level L+1.
const XP_BASE = 12, XP_GROWTH = 1.29;
export function xpForLevel(level) { return Math.round(XP_BASE * Math.pow(XP_GROWTH, Math.max(0, level - 1))); }

// Which house tier a facility needs: chickens (coop) come with the yurt; ponds and livestock pens
// (cows/pigs/goats) are a cottage privilege — the herd is what pulls a farmer up the last rung.
// A SHEEP pen also unlocks at the yurt, but only for a seasoned hand (personal level 15) — an
// early reward for a veteran who hasn't yet raised a cottage.
const FACILITY_MIN_LEVEL = { coop: 2, pond: 3, pen: 3, sheeppen: 2 };
const FACILITY_MIN_FARMER_LEVEL = { sheeppen: 15 };
// True if a farmer's house tier AND personal level unlock this facility right now.
function facilityUnlocked(type, houseLevel, farmerLevel) {
    return houseLevel >= (FACILITY_MIN_LEVEL[type] || 3) && farmerLevel >= (FACILITY_MIN_FARMER_LEVEL[type] || 0);
}

// The TOWN levels like a farmer, but on DONATED surplus rather than personal graft — and steeper,
// so a thriving town is a long communal haul. townXpForLevel(L) = XP to go from town level L→L+1.
const TOWN_XP_BASE = 170, TOWN_XP_GROWTH = 1.5;
export function townXpForLevel(level) { return Math.round(TOWN_XP_BASE * Math.pow(TOWN_XP_GROWTH, Math.max(0, level - 1))); }
const TOWN_MAX_LEVEL = 10;                       // the town is "built out" here; donations ease off
// Town XP per donated unit — the town grows on EVERYTHING a farm makes, not just timber. Livestock
// and facility produce (eggs/milk/wool/truffles/fish/lilies) are worth more than raw wood/forage
// since they take a built facility to yield. Unknown goods fall back to DONATE_XP_DEFAULT.
const DONATE_XP = { wood: 2, ore: 3, crops: 1, egg: 3, milk: 3, fish: 3, lily: 2, truffle: 4, wool: 4,
                    wheat: 1, flower: 1, 'wild wheat': 1, wildflowers: 1,
                    'meat-s': 3, 'meat-m': 5, 'meat-l': 7, fowl: 4 };   // meat is prized
const DONATE_XP_DEFAULT = 2;
const DONATE_BATCH = 15;                          // how much surplus a farmer carries to the silo per trip
const DONATE_KEEP = 8;                            // wood a farmer keeps for themselves before giving
const DONATE_KEEP_CROPS = 6;                      // crops kept back (for well tolls / their own needs)

// Longer days so the world breathes slowly while the (now faster) farmers bustle.
export const DAY_LENGTH = 300;
export const NIGHT_LENGTH = 80;

// Durations are in seconds and a day is DAY_LENGTH+NIGHT_LENGTH (380s) — the ranges are WIDE and
// span whole days, so weather actually settles in: a passing shower one time, rain for two-plus
// days the next, a multi-day drought, a blizzard that holds. Each state also carries a self-weight
// in `next`, so a spell can renew itself into a genuine streak rather than always flipping away.
const WEATHER_STATES = {
    sun: { label: 'SUNNY', next: { sun: 2.5, cloud: 3, drought: 0.6 }, dur: [220, 950] },
    cloud: { label: 'CLOUDY', next: { cloud: 1, sun: 2, rain: 3, storm: 0.8, blizzard: 0.8 }, dur: [130, 480] },
    rain: { label: 'RAIN', next: { rain: 1.4, cloud: 2, sun: 1, storm: 1, blizzard: 1 }, dur: [160, 820] },
    storm: { label: 'STORM!', next: { rain: 2, cloud: 2 }, dur: [55, 200] },
    // winter's answer to the thunderstorm: a whiteout the farmers hunker down through
    blizzard: { label: 'BLIZZARD!', next: { blizzard: 0.5, cloud: 2, sun: 1 }, dur: [130, 400] },
    drought: { label: 'DROUGHT', next: { drought: 1.5, sun: 1.5, cloud: 1 }, dur: [520, 1500] },
};

// Each season also carries a `dmg` 4-shade Game Boy palette (darkest -> lightest)
// that the CRT shader quantizes the whole scene into.
export const SEASONS = [
    { name: 'SPRING', growth: 1.15, waterMul: 1.0, ground: ['#6e8f4d', '#658447'], tilled: '#6a4c30', accent: '#7dd069',
      dmg: ['#0f2110', '#35602f', '#84a52c', '#e2f2b0'],
      weather: { sun: 3, cloud: 3, rain: 3, storm: 1, blizzard: 0, drought: 0.3 } },
    { name: 'SUMMER', growth: 1.3, waterMul: 1.5, ground: ['#5f8a38', '#578235'], tilled: '#6e4e2e', accent: '#f0d060',
      dmg: ['#12240c', '#3a6a22', '#9ab52e', '#eef8bc'],
      weather: { sun: 5, cloud: 2, rain: 1.5, storm: 1.5, blizzard: 0, drought: 2.5 } },
    { name: 'FALL', growth: 0.8, waterMul: 0.8, ground: ['#8a7038', '#7c6634'], tilled: '#5e4228', accent: '#e0803c',
      dmg: ['#201606', '#5c451c', '#b48a2c', '#f2e2a0'],
      weather: { sun: 3, cloud: 4, rain: 3, storm: 1.5, blizzard: 0, drought: 0.5 } },
    // winter: no thunderstorms (storm:0) — blizzards take their place; nothing grows
    { name: 'WINTER', growth: 0.4, waterMul: 0.4, ground: ['#c6ced6', '#bac2ca'], tilled: '#8a7a68', accent: '#a8c8e8',
      dmg: ['#101c22', '#385158', '#82a0a6', '#e6f2f2'],
      weather: { sun: 2, cloud: 4, rain: 1, storm: 0, blizzard: 2.5, drought: 0 } },
];
export const SEASON_LENGTH = 15;

// producer tuning per kind
// Producers yield roughly ONCE PER DAY (a hen lays ~1 egg/day) — rate ~0.0037 fills the
// 0..1 meter over a day of production. This keeps collection a daily rhythm, not a treadmill.
// feedDecay is slow to match (animals want feeding ~once a day). Day = DAY_LENGTH+NIGHT_LENGTH.
export const PROD = {
    pad:     { rate: 0.0038, feedDecay: 0.0035, yieldLo: 1, yieldHi: 2, collectT: 2.2, feedT: 1.8, wander: false },
    fish:    { rate: 0.0036, feedDecay: 0.0035, yieldLo: 1, yieldHi: 3, collectT: 2.4, feedT: 1.6, wander: true, aquatic: true },
    chicken: { rate: 0.0037, feedDecay: 0.0040, yieldLo: 1, yieldHi: 1, collectT: 1.8, feedT: 1.4, wander: true },
    cow:     { rate: 0.0033, feedDecay: 0.0035, yieldLo: 1, yieldHi: 1, collectT: 2.6, feedT: 2.0, wander: true },   // milked once a day
    pig:     { rate: 0.0038, feedDecay: 0.0038, yieldLo: 1, yieldHi: 2, collectT: 2.2, feedT: 1.8, wander: true },
    goat:    { rate: 0.0011, feedDecay: 0.0038, yieldLo: 1, yieldHi: 1, collectT: 2.0, feedT: 1.6, wander: true },   // shorn for wool once every ~3 days
    sheep:   { rate: 0.0012, feedDecay: 0.0036, yieldLo: 1, yieldHi: 2, collectT: 2.0, feedT: 1.6, wander: true },   // a flock, shorn for wool every ~3 days
    // the rooster produces nothing but attitude — rate 0 means never collectable; he
    // struts the coop, wants the odd feeding, and crows at dawn (see audio.js)
    rooster: { rate: 0, feedDecay: 0.004, yieldLo: 0, yieldHi: 0, collectT: 1.8, feedT: 1.4, wander: true },
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
// The bulk of an obstacle (rock/tree/bush) at a tile, deterministic from its position: 0 = small,
// 1 = medium, 2 = big. Most are small; a few are big boulders/old trees that are a real slog to
// clear. Used by BOTH the sim (clearing labour + reward scale) and the render (sprite scale), and by
// the homestead assessment (a founder shuns ground studded with big rocks early on). Exported so
// main.js scales the very same tiles.
export function obstacleTier(i, j) {
    const r = tileHash(i, j, 0x517e) % 100;
    return r < 62 ? 0 : r < 88 ? 1 : 2;   // ~62% small / 26% medium / 12% big
}
// A tree's TYPE index (which species sprite), stable per tile — for the render to pick consistently.
export function treeVariant(i, j, n) { return tileHash(i, j, 0x73ee) % n; }
// ~1 in 6 trees is an APPLE tree (stable per tile): it renders as a fruit tree and, when felled, drops
// apples along with its timber — a more valuable tree, a reason to seek them out.
export function treeIsFruit(i, j) { return tileHash(i, j, 0x9f13) % 6 === 0; }
// A tree's GROWTH STAGE at a given day (0 sapling, 1 young, 2 mature). Regrown trees (in `planted`)
// start as saplings the day they sprout; the founding forest is seeded at MIXED ages via a birth-day
// hash, so it isn't uniform. Pure function of position + day (+ the planting map) — deterministic.
export function treeStageAt(i, j, day, planted) {
    const k = i + ',' + j;
    const birth = planted && planted.has(k) ? planted.get(k)
        : -(tileHash(i, j, 0x7ea1) % 32);   // founding forest: ages 0..31 -> a mix of saplings/young/mature
    const age = day - birth;
    return age < TREE_STAGE_DAYS[0] ? 0 : age < TREE_STAGE_DAYS[0] + TREE_STAGE_DAYS[1] ? 1 : 2;
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
    sheeppen: { label: 'sheep pen', w: 3, h: 3, produce: 'wool' },
};

// energy / health tuning
const AWAKE_DRAIN = 0;        // no passive drain — merely being awake and farming never tires you;
                             // only real labor (below) costs energy, so farms stay productive
const SLEEP_RESTORE = 0.04;
const REST_RESTORE = 0.045;   // recover faster, so a short breather is enough — less time slumped, more time about
const IDLE_REGAIN = 0.01;     // a SUPER-slow second wind while idling / walking / exploring (not laboring or
                              // fighting) — so a settler recovers as they roam and never crashes mid-build on day 1
// states where energy neither drains passively nor trickles back (labor pays via #laborDrain; combat is its own strain)
const ENERGY_NEUTRAL = new Set(['work', 'build', 'coopbuild', 'housebuild', 'chop', 'break', 'forage', 'fish', 'mine', 'fencepost', 'scarecrow', 'fight', 'flee']);
const FISH_COOLDOWN = 4;   // days a wild-water tile rests between catches (a renewable, not-spammable bounty)
const HP_REST = 0.55;         // HP knit back per second of rest — but only up to HP_REST_CAP (see #tickBody)
const HP_REST_CAP = 0.6;      // rest alone mends a wound to ~60%; the last stretch needs MEAT (or a revive)
const HP_SICK_DRAIN = 0.05;   // HP an untreated illness gnaws away per second on your feet
// MEAT — a prized barter good AND a HP restorative. Downing a beast (later, hunted prey) yields meat by
// SIZE; a wounded farmer eats it to heal. Heal = fraction of maxHp restored per unit eaten. (The 25%-
// revive + rest cap that make meat ESSENTIAL land with the hunting in #69 2b, when meat is reliably had.)
const MEAT_HEAL = { 'meat-s': 0.35, 'meat-m': 0.55, 'meat-l': 0.8, fowl: 0.45 };
const MEAT_NAME = { 'meat-s': 'small game', 'meat-m': 'red meat', 'meat-l': 'prime cut', fowl: 'fowl' };
const MEAT_GOODS = ['meat-s', 'meat-m', 'meat-l', 'fowl'];   // eaten smallest-first when healing
// Tending crops and animals is free — tilling a patch, sowing, watering, harvesting, collecting
// eggs/milk, feeding. Only heavy construction (build) drains here; the rest is 0. Chopping,
// mining, breaking stumps, fencing and raising scarecrows drain via the LABOR table below.
const ACTION_ENERGY = { till: 0, plant: 0, water: 0.006, harvest: 0, clear: 0, build: 0.04, collect: 0, tend: 0 };
// Clearing/building labor by effort: a shrub is quick and light, a tree is a long hard fell,
// a stump is grubbing work (roots and all — just as heavy as the fell), a rock is the heaviest,
// a fence post is medium. { time, energy }.
// Costs kept modest so a settler can clear + fence + build without collapsing every day.
const LABOR = {
    forage: { time: 1.6, energy: 0.02 },     // clear a shrub / brush
    fish: { time: 2.4, energy: 0.02 },       // a patient cast at a wild lake — low drain, slow reward
    fencepost: { time: 1.8, energy: 0.028 }, // set a fence post
    break: { time: 4.6, energy: 0.055 },     // grub out a stump — as much work as felling the tree
    chop: { time: 4.6, energy: 0.055 },      // fell a tree
    mine: { time: 4.2, energy: 0.07 },       // smash a rock
    scarecrow: { time: 3.5, energy: 0.04 },  // raise a scarecrow
    housebuild: { time: 3.0, energy: 0.02 }, // one work-shift raising a dwelling (many per house; light
                                             // per shift so a farmer can put in a long stretch before resting)
};
const SCARECROW_WOOD = 3;   // timber cost of a scarecrow
const SCARECROW_LOSSES = 2; // crow raids a farmer will tolerate before building one
const CHAT_LINE_MAX = 34;   // speech bubbles do not wrap; keep generated lines tight
const CHAT_MEMORY_MAX = 110;
const LLM_CHAT_ENDPOINT = '/api/ry-farms-chat';
const LLM_CHAT_TIMEOUT_MS = 6500;
const LLM_CHAT_REQUEST_COOLDOWN = 16;
const LLM_CHAT_FAIL_COOLDOWN = 180;

export function d20(rand, modifier) {
    const roll = 1 + Math.floor(rand() * 20);
    return { roll, mod: modifier, total: roll + modifier, crit: roll === 20, fumble: roll === 1 };
}

// Provenance tally of a farm's crops by TYPE and how each was obtained (grown / stolen / found).
// Increment-only, like sheet.harvested — a lifetime record for the inventory breakout, kept
// separate from the spendable `produce` wallet so trades/donations never desync the story.
function addCropStock(sheet, type, n, source) {
    if (!type || n <= 0) return;
    const cs = sheet.cropStock || (sheet.cropStock = {});
    const e = cs[type] || (cs[type] = { grown: 0, stolen: 0, found: 0 });
    e[source] = (e[source] || 0) + n;
}

// Physical crops leave the farm (traded / donated / eaten) — drain `n` units from cropStock so the
// by-type inventory reflects CURRENT holdings, not lifetime provenance. Largest type first, grown ->
// found -> stolen within it. Deterministic (stable key order + count sort). Called wherever `produce`
// (the untyped spendable wallet) is decremented; the type breakdown is our best record of what left.
function spendCropStock(sheet, n) {
    const cs = sheet.cropStock; if (!cs || n <= 0) return;
    const tot = t => (cs[t].grown || 0) + (cs[t].stolen || 0) + (cs[t].found || 0);
    const types = Object.keys(cs).sort((a, b) => tot(b) - tot(a));
    let left = Math.round(n);
    for (const t of types) {
        if (left <= 0) break;
        for (const src of ['grown', 'found', 'stolen']) {
            const take = Math.min(left, cs[t][src] || 0);
            cs[t][src] -= take; left -= take;
            if (left <= 0) break;
        }
    }
}

function cleanChatText(text, max = CHAT_LINE_MAX) {
    let s = String(text || '')
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201c\u201d]/g, '"')
        .replace(/[\u2013\u2014]/g, '-')
        .replace(/\u2026/g, '...')
        .replace(/\s+/g, ' ')
        .trim()
        .toUpperCase();
    s = s.replace(/[^A-Z0-9 .,!?'"():+\-\/<>*&=#_]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!s) return '...';
    if (s.length <= max) return s;
    const clipped = s.slice(0, Math.max(1, max - 2)).trimEnd();
    return `${clipped}..`;
}

function shortName(farmer) {
    return farmer?.sheet?.name?.split(' ')[0] || 'Friend';
}

function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
}

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------

export class World {
    constructor(seed = 1337) {
        this.seed = seed >>> 0;
        this.rand = mulberry32(seed);
        this.tiles = new Uint8Array(GRID * GRID).fill(T.GRASS);
        this.rockWork = new Map();   // tilekey -> mining shifts landed on a big rock (persists till it breaks)
        this.treePlanted = new Map();// tilekey -> world.day a REGROWN tree sprouted (so it starts a sapling + grows)
        // Infinite wilderness beyond the founding valley: chunk key "cx,cy" -> Uint8Array of
        // tiles, generated on first touch from PURE hash noise (never world.rand — generation
        // order must not affect determinism). Fog of war: matching per-chunk reveal bitmaps.
        this.chunks = new Map();
        this.fog = new Map();
        this.dirtyChunks = new Set();   // chunk keys whose ground/fog changed (renderer rebakes)
        this.revealRect = { i0: CENTER, j0: CENTER, i1: CENTER, j1: CENTER };
        this.exploredTiles = 0;
        this.crops = new Map();
        this.tilledAt = new Map();   // "i,j" -> day tilled; unused broken ground reverts after ~5 days
        this.fishedAt = new Map();   // "i,j" -> day a wild-water tile was last fished (bounty cooldown)
        this.plots = [];
        this.farmers = [];
        this.log = [];
        // The CHRONICLE: the town's lasting story. Where `log` is the ephemeral ticker (last ~80
        // lines, decays), the chronicle keeps the BIG beats forever — foundings, homes raised,
        // maulings & rescues, friendships & feuds, town milestones — so a watcher can read the
        // settlement's saga (see addChronicle + the CHRONICLE panel). Deterministic (no world.rand).
        this.chronicle = [];
        this._chronBonds = new Set();   // pair-keys already chronicled as "grew close" (fire once)
        this._chronRifts = new Set();   // pair-keys already chronicled as "fell out" (fire once)
        this.time = 0;
        this.day = 1;
        this.clock = 0;
        this.harvestTotal = 0;
        this._dayHarvestStart = 0;   // harvestTotal snapshot at the current day's start (for the daily delta)
        this.dayRecap = null;        // end-of-day summary card for the UI (built at each rollover)

        this.season = 0;
        this.seasonDay = 0;
        this.year = 1;

        this.weather = 'sun';
        this.weatherTimer = 20;
        this.lightningTimer = 0;
        this.lightningFlash = 0;
        this.struckTile = null;

        this.helpBoard = [];
        this.encounters = [];      // active wilderness threats (see the Dungeon Master, #tickDM)
        this.dmCooldown = 90;      // a grace period before the first threat stalks the young town
        this.prey = [];            // roaming wild game — deer/rabbit/turkey hunted for meat (see #tickPrey)
        this.preyCooldown = 55;    // a grace period before the first game wanders into the charted wilds
        this.project = null;
        this.projectIndex = 0;
        this.coops = [];      // farmer-proposed neighborhood projects (shared wells) — need-driven, sited where the members live
        this.waterDeals = new Map();   // negotiated drawing rights at private wells: farmer@well -> { ownerSeed, per, count }
        this.shareDeals = [];          // harvest-share promises (join my dig for a cut): { payerSeed, payeeSeed, per, count, untilDay }
        this.structures = [];
        this.statue = null;   // the single guardian monument (upgraded in place tier by tier)
        this.bonds = new Map();
        this.workMult = 1;
        this.growthMult = 1;
        this.lightningMult = 1;
        this.rainBoost = 1;   // guardian statues call the rains: more rain weather, deeper soak
        this.stormLosses = 0;   // crops the town has lost to lightning while under-warded — the
                                // collective memory that pulls the guardian monument forward
        this.leader = null;
        this.llmChat = this.#initLlmChat();

        this.well = { i: CENTER, j: CENTER, ready: true };
        this.sign = null;                                 // (RY sign removed)
        // The town itself LEVELS UP like a farmer: settlers haul surplus to the silo, and those
        // donations are the town's XP. A level-1 town is a ghost town — just a well — and its
        // level (exponentially harder each rung) is what unlocks communal builds and draws a
        // merchant, so nobody throws up a board + windmill + toolshed on day one.
        this.townLevel = 1;
        this.townXP = 0;
        this.coffers = { wood: 0, crops: 0, ore: 0 };     // lifetime donations to the silo (accounting + flavor)
        this.townLevelFlash = 0;                          // brief UI pulse on a town level-up
        this.silo = { i: CENTER - 4, j: CENTER - 1 };     // the donation heart of the plaza (present from day one)
        this.set(this.silo.i, this.silo.j, T.STRUCT);
        this.board = null;    // no bulletin board until the town builds one together (first communal project)
        this.merchant = null;                             // the wandering trader, present only during a visit
        this.merchantNextDay = 4 + Math.floor(this.rand() * 3);   // first caravan rolls in around day 4-6
        this.merchantVisit = 0;                           // visit counter (varies the stall spot)
        this.wells = [this.well];
        this.set(this.well.i, this.well.j, T.WELL);

        this.slots = [];
        this.ringCount = 0;
        this.#addRing(26, 8, 0.42);

        this.#growForest();

        // the founders know their valley: reveal a generous circle around the plaza —
        // everything beyond (the valley corners included) starts under fog of war
        this.reveal(CENTER, CENTER, 42);

        this.scarecrows = [];   // (placeholder — scarecrows will keep birds off nearby crops)
        this.birds = [];
        this.#spawnBirds(4 + Math.floor(this.rand() * 3));
        this.treasure = null;   // a rare treasure chest; the finder is richly rewarded
    }

    // A settled flock of 2+ hens may hatch (or attract) a rooster — one per coop. He
    // yields nothing; he's a strutting alarm clock (audio crows at dawn when one exists).
    #maybeHatchRooster() {
        for (const plot of this.plots) {
            for (const fac of plot.facilities) {
                if (fac.type !== 'coop') continue;
                if (fac.producers.some(pr => pr.kind === 'rooster')) continue;
                const hens = fac.producers.filter(pr => pr.kind === 'chicken').length;
                if (hens < 2 || this.rand() > 0.15) continue;
                const r = fac.producers[0].region;
                fac.producers.push(this.#makeProducer('rooster', r.x + r.w / 2, r.y + r.h / 2, r));
                const owner = this.farmers.find(f => f.plot === plot);
                if (owner) {
                    this.addLog(`A rooster has joined ${owner.sheet.name}'s flock!`, '#f0d060');
                    owner.remember('event', 'A rooster joined my flock - dawn will never be quiet again', null, 1.0);
                    owner.say('a rooster!', '#f0d060');
                }
            }
        }
    }
    hasRooster() {
        for (const plot of this.plots) for (const fac of plot.facilities)
            if (fac.producers.some(pr => pr.kind === 'rooster')) return true;
        return false;
    }

    // ---- crows: perch in trees, hop tree-to-tree, and raid unguarded crops -------
    // Scans only EXPLORED territory (the crows are town ambience, not world scouts), and
    // caps the haul — the revealed region grows without bound as farmers explore.
    #allTrees(cap = 400) {
        const out = [];
        const R = this.revealRect;
        const step = Math.max(1, Math.ceil(Math.max(R.i1 - R.i0, R.j1 - R.j0) / 160));
        for (let j = R.j0; j <= R.j1 && out.length < cap; j += step)
            for (let i = R.i0; i <= R.i1 && out.length < cap; i += step)
                if (this.isRevealed(i, j) && this.get(i, j) === T.TREE) out.push({ i, j });
        return out;
    }
    #spawnBirds(n) {
        const trees = this.#allTrees();
        if (!trees.length) return;
        for (let k = 0; k < n; k++) {
            const tree = trees[Math.floor(this.rand() * trees.length)];
            this.birds.push({ i: tree.i, j: tree.j, state: 'perch', timer: 2 + this.rand() * 6, from: null, to: null, hopT: 0, dur: 1, mode: null, target: null, facing: this.rand() < 0.5 ? 1 : -1, seed: Math.floor(this.rand() * 1000) });
        }
    }
    #treesNear(i, j, maxD) {
        const out = [];
        const ci = Math.round(i), cj = Math.round(j);
        for (let dj = -maxD; dj <= maxD; dj++) for (let di = -maxD; di <= maxD; di++) {
            if (!di && !dj) continue;
            const ni = ci + di, nj = cj + dj;
            // isRevealed FIRST — never read (or generate) fog tiles. Without this, the wilderness
            // is so full of trees that birds always found a "near" tree out in the fog and hopped
            // ever outward, force-generating chunks forever (Opus review: chunks.size ~+40/day).
            if (this.isRevealed(ni, nj) && this.get(ni, nj) === T.TREE) out.push({ i: ni, j: nj });
        }
        return out;
    }
    #birdTargetTree(i, j) {
        const near = this.#treesNear(i, j, 12);
        if (near.length) return near[Math.floor(this.rand() * near.length)];   // a nearby tree = short hop
        // else spiral outward for the nearest known tree (bounded — no full-world scans)
        const ci = Math.round(i), cj = Math.round(j);
        for (let r = 13; r <= 40; r++) {
            for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
                if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
                const ni = ci + di, nj = cj + dj;
                if (this.isRevealed(ni, nj) && this.get(ni, nj) === T.TREE) return { i: ni, j: nj };
            }
        }
        return null;
    }
    // a scarecrow keeps crows off crops within a 9-tile radius (widened from 6 so it actually
    // covers a meaningful chunk of a homestead's fields)
    #scarecrowNear(i, j) { return this.scarecrows.some(s => Math.abs(s.i - i) + Math.abs(s.j - j) <= 9); }
    scarecrowOnPlot(plot) { return this.scarecrows.some(s => plot.cells.has(pkey(s.i, s.j))); }
    scarecrowCountOnPlot(plot) { return this.scarecrows.filter(s => plot.cells.has(pkey(s.i, s.j))).length; }
    // a big farm needs more than one scarecrow: allow roughly one per ~90 tiles of land (capped)
    scarecrowCapFor(plot) { return Math.max(1, Math.min(6, 1 + Math.floor(plot.cells.size / 90))); }
    // the open field tile best placed for a NEW scarecrow — the centroid of the plot's tiles that
    // AREN'T already inside a scarecrow's scare radius. null once the whole plot is covered.
    exposedScarecrowSpot(plot) {
        const fields = plot.fields.filter(f => { const t = this.get(f.i, f.j); return t === T.GRASS || t === T.TILLED; });
        const exposed = fields.filter(f => !this.#scarecrowNear(f.i, f.j));
        if (!exposed.length) return null;
        let ci = 0, cj = 0; for (const f of exposed) { ci += f.i; cj += f.j; }
        ci /= exposed.length; cj /= exposed.length;
        let best = null, bd = 1e9;
        for (const f of exposed) { if (this.cropAt(f.i, f.j)) continue; const d = Math.abs(f.i - ci) + Math.abs(f.j - cj); if (d < bd) { bd = d; best = f; } }
        return best || exposed.find(f => !this.cropAt(f.i, f.j)) || null;
    }
    #birdCropTarget(i, j, maxD) {
        let best = null, bestD = maxD * maxD + 1;
        for (const c of this.crops.values()) {
            if (c.withered || c.stage < 1) continue;
            if (this.#scarecrowNear(c.i, c.j)) continue;
            const d = (c.i - i) ** 2 + (c.j - j) ** 2;
            if (d < bestD) { bestD = d; best = c; }
        }
        return best;
    }
    #birdFlyTo(b, to, mode) {
        b.from = { i: b.i, j: b.j }; b.to = { i: to.i, j: to.j }; b.mode = mode; b.hopT = 0;
        const dist = Math.hypot(to.i - b.i, to.j - b.j);
        b.dur = Math.max(0.45, dist / 9);
        b.facing = (to.i - to.j) >= (b.i - b.j) ? 1 : -1;
        b.state = 'fly';
    }
    #birdDecide(b) {
        if (this.rand() < 0.45) {
            const crop = this.#birdCropTarget(b.i, b.j, 22);
            if (crop) { b.target = crop; this.#birdFlyTo(b, crop, 'toCrop'); return; }
        }
        const t = this.#birdTargetTree(b.i, b.j);
        if (t) { this.#birdFlyTo(b, t, 'toTree'); return; }
        b.timer = 2 + this.rand() * 4;
    }
    #birdEat(b) {
        const c = b.target; b.target = null;
        if (c && !c.withered && !this.#scarecrowNear(c.i, c.j)) {   // a scarecrow raised mid-flight still saves the crop
            const key = `${c.i},${c.j}`, live = this.crops.get(key);
            if (live && live === c) {
                if (c.stage <= 1) { this.crops.delete(key); this.set(c.i, c.j, T.TILLED); }
                else c.stage -= 1;
                if (this.rand() < 0.5 && c.owner) this.addLog(`A crow raided ${c.owner.sheet.name}'s ${c.type}!`, '#c05840');
                if (c.owner) {   // the victim remembers — enough raids and they'll raise a scarecrow
                    c.owner.birdLosses = (c.owner.birdLosses || 0) + 1;
                    c.owner.remember('event', `A crow ate my ${c.type} - a scarecrow would put a stop to this`, null, 0.9);
                }
            }
        }
        const t = this.#birdTargetTree(b.i, b.j);
        if (t) this.#birdFlyTo(b, t, 'toTree');
        else { b.state = 'perch'; b.timer = 2 + this.rand() * 4; }
    }
    // ---- rare treasure chest -----------------------------------------------------
    // Very occasionally a chest appears on open ground; the first farmer to reach it is
    // richly rewarded (crops + goods now; special items later once inventory design lands).
    // How "deep" a find is: 0 at the valley rim, climbing the further out it sits — richer loot
    // lives further from home (mirrors the ore-rich highlands). Caps so rewards stay sane.
    #treasureDepth(i, j) { return Math.max(0, Math.min(1.5, (Math.hypot(i - CENTER, j - CENTER) - 36) / 80)); }
    // Weighted roll for WHAT a find is, biased outward: the deep wilds hide ore lodes and relics.
    #rollTreasureKind(depth) {
        const r = this.rand();
        if (depth > 0.7 && r < 0.10 + depth * 0.10) return 'relic';    // rare deep keepsake
        if (r < 0.22 + depth * 0.20) return 'lode';                    // an ore vein — likelier the deeper you go
        if (r < 0.50) return 'timber';                                 // a woodcutter's forgotten stash
        if (r < 0.74) return 'goods';                                  // a bundle of trade goods
        return 'cache';                                                // a mixed homestead cache
    }
    #maybeSpawnTreasure() {
        if (this.treasure) return;
        if (this.rand() > 0.04) return;   // ~1 in 25 days — genuinely rare
        // anywhere in EXPLORED territory — the more the town uncovers, the more ground
        // a chest can turn up on (exploring literally grows the treasure pool)
        const R = this.revealRect;
        for (let tries = 0; tries < 60; tries++) {
            const i = R.i0 + Math.floor(this.rand() * (R.i1 - R.i0 + 1));
            const j = R.j0 + Math.floor(this.rand() * (R.j1 - R.j0 + 1));
            if (!this.isRevealed(i, j) || this.get(i, j) !== T.GRASS || this.pathBlocked(i, j)) continue;
            const depth = this.#treasureDepth(i, j);
            this.treasure = { i, j, claimant: null, opened: false, openT: 0, depth, kind: this.#rollTreasureKind(depth) };
            this.addLog('A glint on the ground... is that a TREASURE CHEST?', '#f0d060');
            return;
        }
    }
    // Explorers stumble onto caches the crows never see — spawned at the freshly
    // revealed frontier so the reward lands where the boldness happened.
    spawnFrontierTreasure(i, j) {
        if (this.treasure) return false;
        const spot = this.nearestOpenTile({ i, j });
        if (!spot) return false;
        const depth = this.#treasureDepth(spot.i, spot.j);
        this.treasure = { i: spot.i, j: spot.j, claimant: null, opened: false, openT: 0, depth, kind: this.#rollTreasureKind(depth) };
        this.addLog(depth > 0.7 ? 'Something gleams in the deep wilds — a find worth the journey...' : 'Something glints out in the newly charted wilds...', '#f0d060');
        return true;
    }
    openTreasure(farmer) {
        const tr = this.treasure; if (!tr || tr.opened) return;
        tr.opened = true; tr.openT = 2.4; tr.claimant = null;
        const s = farmer.sheet, mult = 1 + (tr.depth || 0);   // deeper finds pay more
        const rnd = (a, b) => a + Math.floor(this.rand() * (b - a + 1));
        s.goods = s.goods || {};
        farmer.sparkle = 3;
        if (tr.kind === 'lode') {
            const ore = Math.round(rnd(6, 11) * mult);
            farmer.ore += ore; farmer.gainXP(6 + Math.round((tr.depth || 0) * 6));
            farmer.say('AN ORE LODE!', '#c8d0dc');
            farmer.remember('event', `Struck an ore lode in the wilds — ${ore} ore, the stuff crafting is made of`, null, 1.3);
            this.addLog(`${s.name} struck an ORE LODE out in the wilds — ${ore} ore!`, '#c8d0dc');
        } else if (tr.kind === 'timber') {
            const wood = Math.round(rnd(9, 16) * mult);
            farmer.wood += wood; farmer.gainXP(5);
            farmer.say('A TIMBER STASH!', '#b98a4a');
            farmer.remember('event', `Found a woodcutter's forgotten stash — ${wood} timber`, null, 1.15);
            this.addLog(`${s.name} found a forgotten TIMBER STASH — ${wood} wood!`, '#b98a4a');
        } else if (tr.kind === 'goods') {
            const pool = ['wild wheat', 'wildflowers', 'egg', 'wool', 'lily'];
            const picks = [];
            for (let k = 0; k < 2 + (this.rand() < (tr.depth || 0) ? 1 : 0); k++) {
                const g = pool[Math.floor(this.rand() * pool.length)];
                const n = Math.round(rnd(3, 6) * mult); s.goods[g] = (s.goods[g] || 0) + n;
                picks.push(`${n} ${g}`);
            }
            farmer.gainXP(5); farmer.say('A TRADE BUNDLE!', '#e0b050');
            farmer.remember('event', `Found a bundle of trade goods — ${picks.join(', ')}`, null, 1.1);
            this.addLog(`${s.name} found a BUNDLE of trade goods — ${picks.join(', ')}!`, '#e0b050');
        } else if (tr.kind === 'relic') {
            // a keepsake from the deep wilds: a big boon and a lasting bump to one ability
            const abilities = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
            const ab = abilities[Math.floor(this.rand() * abilities.length)];
            s.stats[ab] = (s.stats[ab] || 10) + 1;
            farmer.gainXP(18); farmer.wood += rnd(4, 8); farmer.ore += rnd(3, 6);
            farmer.say('A RELIC!', '#f0c850');
            farmer.remember('event', `Unearthed an ancient relic in the deep wilds — it left me sharper (+1 ${ab.toUpperCase()})`, null, 1.6);
            this.addLog(`${s.name} unearthed an ANCIENT RELIC in the deep wilds! (+1 ${ab.toUpperCase()}, and a fine haul)`, '#f0c850');
            this.addChronicle('find', `${s.name.split(' ')[0]} unearthed an ancient relic in the deep wilds (+1 ${ab.toUpperCase()}).`, farmer, null, '#f0c850');
        } else {   // mixed homestead cache — the old reliable
            const crops = Math.round(rnd(8, 16) * mult);
            s.produce = (s.produce || 0) + crops;
            addCropStock(s, s.crop, crops, 'found');   // provenance: a windfall from the wilds (their staple crop)
            farmer.wood += rnd(4, 8); farmer.ore += rnd(2, 4);
            const g = ['wild wheat', 'wildflowers'][Math.floor(this.rand() * 2)];
            s.goods[g] = (s.goods[g] || 0) + rnd(2, 4);
            farmer.gainXP(8); farmer.say('TREASURE!', '#f0d060');
            farmer.remember('event', `Found a treasure chest! ${crops} crops plus timber, ore and goods`, null, 1.2);
            this.addLog(`${s.name} found a TREASURE CHEST! ${crops} crops, plus timber, ore and goods!`, '#f0d060');
        }
    }
    #tickTreasure(dt) {
        const tr = this.treasure; if (!tr) return;
        if (tr.opened) { tr.openT -= dt; if (tr.openT <= 0) this.treasure = null; return; }
        // release a stale claim if the claimant wandered off / isn't coming
        if (tr.claimant && tr.claimant.state !== 'walk' && tr.claimant.state !== 'treasure') tr.claimant = null;
    }
    #tickBirds(dt) {
        if (this.isNight()) return;   // crows roost at night — no flying, hopping, or crop raids
        for (const b of this.birds) {
            if (b.state === 'perch') { b.timer -= dt; if (b.timer <= 0) this.#birdDecide(b); }
            else if (b.state === 'peck') { b.timer -= dt; if (b.timer <= 0) this.#birdEat(b); }
            else if (b.state === 'fly') {
                b.hopT += dt / b.dur;
                if (b.hopT >= 1) {
                    b.i = b.to.i; b.j = b.to.j; b.hopT = 0;
                    if (b.mode === 'toCrop') { b.state = 'peck'; b.timer = 1.4 + this.rand() * 1.6; }
                    else { b.state = 'perch'; b.timer = 2.5 + this.rand() * 6; }
                } else {
                    b.i = b.from.i + (b.to.i - b.from.i) * b.hopT;
                    b.j = b.from.j + (b.to.j - b.from.j) * b.hopT;
                }
            }
        }
    }

    // Wild lands on the town's outskirts: forest that grows in CLUSTERS (dense
    // copses with open meadows between), plus wild wheat + wildflower patches.
    // Trees stay clear of a border so they never clip the map edge.
    #growForest() {
        const groves = [];
        for (let g = 0; g < 42; g++) {
            const a = tileRand(g, 0, this.seed + 90) * Math.PI * 2;
            // reach groves further out (toward the map edges) so there's plenty of edge woodland
            const r = 16 + tileRand(g, 1, this.seed + 91) * 34;
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
                const score = grove * 0.78 + edge * 0.42 + texture * 0.30;   // stronger edge bias
                const threshold = r > 25 ? 0.38 : r > 17 ? 0.5 : 0.68;
                if (score > threshold) {
                    candidates.push({
                        i, j,
                        score: score + tileRand(i, j, this.seed + 104) * 0.24,
                    });
                }
            }
        }

        candidates.sort((a, b) => b.score - a.score);
        const targetTrees = 150 + Math.floor(tileRand(0, 0, this.seed + 105) * 40);
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
        const t = this.get(i, j);   // the world has no edges anymore — only spacing rules
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

    // Nature slowly reclaims cleared land: a few tiles of EXPLORED country regrow each day.
    // (The wilderness under fog never needs regrowth — it generates pristine on reveal.)
    #regrowWild() {
        const nearAnyPlot = (i, j, pad = 2) => this.plots.some(p => i >= p.x - pad && i < p.x + p.w + pad && j >= p.y - pad && j < p.y + p.h + pad);
        let treesGrown = 0, wheatGrown = 0;
        const R = this.revealRect;
        for (let k = 0; k < 24; k++) {
            const i = R.i0 + Math.floor(this.rand() * (R.i1 - R.i0 + 1));
            const j = R.j0 + Math.floor(this.rand() * (R.j1 - R.j0 + 1));
            if (!this.isRevealed(i, j)) continue;
            const t = this.get(i, j);
            if ((t !== T.GRASS && t !== T.STUMP) || nearAnyPlot(i, j)) continue;
            const r = Math.hypot(i - CENTER, j - CENTER);
            if (r > 24) {
                // near the forest: stumps sprout saplings, gaps refill with wild growth
                // (rocks are a finite resource — they never regrow, only plants do)
                if (this.rand() < 0.18 && this.#treeFits(i, j, 48, 28)) { this.set(i, j, T.TREE); this.treePlanted.set(i + ',' + j, this.day); treesGrown++; }
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
        for (const s of this.structures) { const sz = s.size || 1; if (i >= s.i && i < s.i + sz && j >= s.j && j < s.j + sz) return true; }
        const ps = this.project && this.project.site;
        if (ps && ps.i === i && ps.j === j) return true;
        for (const c of this.coops) if (c.site.i === i && c.site.j === j) return true;
        return false;
    }

    // Untended land slowly reverts: standing brush/trees SPREAD into adjacent untended grass,
    // and brush ages into trees. Growth concentrates at the vegetation boundary, so it creeps
    // INTO farms (pressuring bots to keep clearing — see #nearestPlotObstacle) and onto expansion
    // frontiers (trees there block annexation). A neglected farm gets reclaimed by the wild.
    #encroach() {
        // Encroachment is FARM pressure, not a world simulation: scan only each plot's
        // neighborhood (padded box) instead of the whole — now infinite — map. Wilderness
        // regrowth elsewhere is #regrowWild's job.
        const sprouts = [], matures = [];
        const seenTiles = new Set();
        for (const p of this.plots) {
            const PAD = 6;
            for (let j = p.y - PAD; j < p.y + p.h + PAD; j++) {
                for (let i = p.x - PAD; i < p.x + p.w + PAD; i++) {
                    const tk = pkey(i, j);
                    if (seenTiles.has(tk)) continue;
                    seenTiles.add(tk);
                    const t = this.get(i, j);
                    if (t !== T.TREE && t !== T.FLOWER) continue;
                    if (t === T.FLOWER && !this.#onActiveField(i, j) && !this.#protectedTile(i, j) && this.#treeFits(i, j, 48, 28)) matures.push({ i, j });
                    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                        const gi = i + di, gj = j + dj;
                        if (this.get(gi, gj) === T.GRASS && !this.#onActiveField(gi, gj) && !this.#protectedTile(gi, gj)) sprouts.push({ i: gi, j: gj });
                    }
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
            let weeds = Math.min(grass.length, 1 + Math.floor(grass.length * 0.03));
            for (let n = 0; n < weeds && grass.length; n++) {
                const g = grass.splice(Math.floor(this.rand() * grass.length), 1)[0];
                if (this.rand() < 0.35) { this.set(g.i, g.j, T.FLOWER); sprouted++; ontoFarm = true; }
            }
        }
        if (sprouted || matured) { this._tilesChanged = true; for (const p of this.plots) this.#rebuildFields(p); }
        if (ontoFarm && this.rand() < 0.6) this.addLog('Wild brush is creeping into the farms — clear it before it takes root.', '#8a9a5a');
    }

    // Reserve the dwelling's footprint (3x3 tipi / 5x5 yurt / 7x7 cottage, centred on houseCentre) plus a one-tile
    // margin (and extra above, where the tall roof sprite overhangs) so crops and facilities are
    // never placed under the house or its sprite.
    #inHouse(plot, i, j) {
        const c = this.houseCentre(plot), half = this.houseFt(plot) >> 1;
        return i >= c.i - half - 1 && i <= c.i + half + 1 && j >= c.j - half - 2 && j <= c.j + half + 1;
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
    static chunkKey(i, j) { return Math.floor(i / CHUNK) + ',' + Math.floor(j / CHUNK); }

    // Tile access over an INFINITE plane. The founding valley lives in the flat array;
    // everything beyond is chunked and generated on first touch from pure hash noise.
    get(i, j) {
        if (i >= 0 && j >= 0 && i < GRID && j < GRID) return this.tiles[j * GRID + i];
        const cx = Math.floor(i / CHUNK), cy = Math.floor(j / CHUNK);
        return this.#chunk(cx, cy)[(j - cy * CHUNK) * CHUNK + (i - cx * CHUNK)];
    }
    set(i, j, t) {
        if (i >= 0 && j >= 0 && i < GRID && j < GRID) this.tiles[j * GRID + i] = t;
        else {
            const cx = Math.floor(i / CHUNK), cy = Math.floor(j / CHUNK);
            this.#chunk(cx, cy)[(j - cy * CHUNK) * CHUNK + (i - cx * CHUNK)] = t;
        }
        // the 5-day "use it or lose it" clock on broken ground: (re)start it whenever a tile
        // becomes freshly-tilled dirt, drop it the moment it becomes anything else. (A planted
        // crop keeps the tile TILLED and is exempted in #decayTilled by the cropAt check, so the
        // clock effectively pauses under a growing crop and restarts when the tile empties again.)
        if (t === T.TILLED) this.tilledAt.set(i + ',' + j, this.day);
        else if (this.tilledAt.size) this.tilledAt.delete(i + ',' + j);
        this.dirtyChunks.add(World.chunkKey(i, j));
        this._tilesChanged = true;
    }

    #chunk(cx, cy) {
        const key = cx + ',' + cy;
        let ch = this.chunks.get(key);
        if (!ch) {
            ch = new Uint8Array(CHUNK * CHUNK);
            const i0 = cx * CHUNK, j0 = cy * CHUNK;
            for (let j = 0; j < CHUNK; j++) for (let i = 0; i < CHUNK; i++) {
                const wi = i0 + i, wj = j0 + j;
                // valley tiles inside a boundary chunk stay in the flat array; the chunk
                // cell is dead storage there (get() never routes to it)
                ch[j * CHUNK + i] = (wi >= 0 && wj >= 0 && wi < GRID && wj < GRID)
                    ? T.GRASS : this.#genTile(wi, wj);
            }
            this.chunks.set(key, ch);
        }
        return ch;
    }

    // ---- infinite wilderness generation (PURE functions of position + world seed) --------
    // Distance bands give explorers real reasons to venture: deeper forest belts (timber),
    // rocky highlands (the ore that gates crafting), wildflower meadows, and — far out —
    // still lakes. No world.rand() in here, ever: generation order must never matter.
    #genTile(i, j) {
        const s = this.seed;
        const r = Math.hypot(i - CENTER, j - CENTER);
        // distant still lakes (never near the valley rim, so the transition stays seamless)
        if (r > 68) {
            const lakeN = tileNoise(i + 211, j - 149, 26, s + 210) * 0.62 +
                tileNoise(i - 87, j + 61, 9, s + 211) * 0.28 +
                tileRand(i, j, s + 212) * 0.10;
            if (lakeN > 0.80) return T.WATER;
            if (lakeN > 0.785) return T.GRASS;   // a clear muddy shore ring around each lake
        }
        // rocky highlands: outcrop fields that grow RICHER the deeper you venture — the
        // wilderness carries the ore that crafting needs (rocks never regrow, so the frontier
        // is where late-game stone comes from)
        const rockN = tileNoise(i + 71, j - 37, 10, s + 41) * 0.55 +
            tileNoise(i - 17, j + 53, 24, s + 42) * 0.33 +
            tileRand(i, j, s + 43) * 0.12;
        const rockRich = Math.min(2.1, 1.0 + Math.max(0, r - 40) / 80);
        if (tileRand(i, j, s + 44) < Math.max(0, rockN - 0.60) * 0.5 * rockRich) return T.ROCK;
        if (this.#wildTreeAt(i, j)) return T.TREE;
        // wild forage carpets (same formulas as the valley, so the boundary blends)
        const wheatN = tileNoise(i - 31, j + 7, 9, s + 4) * 0.58 +
            tileNoise(i + 5, j + 29, 21, s + 5) * 0.30 + tileRand(i, j, s + 6) * 0.12;
        const flowerN = tileNoise(i + 43, j - 23, 8, s + 7) * 0.56 +
            tileNoise(i - 13, j + 17, 18, s + 8) * 0.32 + tileRand(i, j, s + 9) * 0.12;
        const pw = Math.max(0, wheatN - 0.55) * 0.72, pf = Math.max(0, flowerN - 0.53) * 0.64;
        const roll = tileRand(i, j, s + 10);
        if (roll < pw) return T.WHEAT;
        if (roll < pw + pf) return T.FLOWER;
        return T.GRASS;
    }

    // Trees on a jittered SCREEN-SPACE lattice: candidates live in cells of the iso plane
    // (a = i-j horizontal, b = i+j vertical), so any two trees keep the same on-screen
    // spacing the valley's #treeFits enforced — without needing neighbor look-ups (pure).
    #wildTreeAt(i, j) {
        const s = this.seed;
        const a = i - j, b = i + j;
        const u = Math.floor(a / 5), v = Math.floor(b / 6);
        // one jittered candidate spot per lattice cell
        let ca = u * 5 + Math.floor(tileRand(u, v, s + 120) * 3);        // a-jitter 0..2 -> min gap 3
        let cb = v * 6 + Math.floor(tileRand(u, v, s + 121) * 3) * 2;    // b-jitter {0,2,4} keeps gap
        if (((ca ^ cb) & 1) !== 0) cb += 1;                              // parity: i,j must be integers
        if (a !== ca || b !== cb) return false;
        // grove density: deep-forest belts with open meadows between, denser further out
        const grove = tileNoise(i + 11, j - 5, 12, s + 101) * 0.5 +
            tileNoise(i - 37, j + 19, 27, s + 102) * 0.5;
        const r = Math.hypot(i - CENTER, j - CENTER);
        const belt = Math.min(0.22, Math.max(0, r - 55) / 260);   // wilds grow wilder, gently
        return grove + belt > 0.56;
    }

    // ---- fog of war -----------------------------------------------------------------
    #fogChunk(cx, cy) {
        const key = cx + ',' + cy;
        let f = this.fog.get(key);
        if (!f) { f = new Uint8Array(CHUNK * CHUNK); this.fog.set(key, f); }
        return f;
    }
    isRevealed(i, j) {
        const cx = Math.floor(i / CHUNK), cy = Math.floor(j / CHUNK);
        const f = this.fog.get(cx + ',' + cy);
        return f ? f[(j - cy * CHUNK) * CHUNK + (i - cx * CHUNK)] === 1 : false;
    }
    // Reveal a circle of tiles (a farmer's sight as they walk). Returns how many tiles were
    // NEWLY uncovered, expands the explored bounding rect, and dirties touched chunks so the
    // renderer re-bakes their fog.
    reveal(i, j, r = 5) {
        let newly = 0;
        const R = this.revealRect;
        for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
            if (di * di + dj * dj > r * r + r) continue;
            const ii = i + di, jj = j + dj;
            const cx = Math.floor(ii / CHUNK), cy = Math.floor(jj / CHUNK);
            const f = this.#fogChunk(cx, cy);
            const idx = (jj - cy * CHUNK) * CHUNK + (ii - cx * CHUNK);
            if (f[idx]) continue;
            f[idx] = 1; newly++;
            this.dirtyChunks.add(cx + ',' + cy);
            if (ii < R.i0) R.i0 = ii; if (ii > R.i1) R.i1 = ii;
            if (jj < R.j0) R.j0 = jj; if (jj > R.j1) R.j1 = jj;
        }
        this.exploredTiles += newly;
        return newly;
    }
    blocked(i, j) {
        const t = this.get(i, j);
        return t === T.HOUSE || t === T.WELL || t === T.SIGN || t === T.STRUCT || t === T.COOP || t === T.BARN || t === T.ROCK;
    }

    isNight() { return this.clock > DAY_LENGTH; }
    nightProgress() { return this.isNight() ? (this.clock - DAY_LENGTH) / NIGHT_LENGTH : 0; }
    get seasonDef() { return SEASONS[this.season]; }
    // Apples ripen late summer through fall, as in real life — so fruit trees only bear (and drop)
    // apples in the back half of summer and all of autumn.
    isFruitSeason() { return this.season === 2 || (this.season === 1 && this.seasonDay >= 8); }
    get seasonName() { return SEASONS[this.season].name; }
    // winter is the fallow season: no tilling/planting/watering, the ground is frozen.
    // Farmers pivot to livestock, foraging, chopping, crafting and helping instead.
    canGarden() { return this.season !== 3; }
    isWinter() { return this.season === 3; }

    #advanceSeason() {
        this.seasonDay++;
        if (this.seasonDay >= SEASON_LENGTH) {
            this.seasonDay = 0;
            this.season = (this.season + 1) % SEASONS.length;
            if (this.season === 0) { this.year++; this.addLog(`A new year dawns on Ry Farms — Year ${this.year}!`, '#f0d060'); this.addChronicle('season', `Year ${this.year} dawns on Ry Farms.`, null, null, '#e0c060'); }
            const def = SEASONS[this.season];
            this.addLog(`${def.name} has arrived.`, def.accent);
            // winter kills the garden: standing crops die back so the fields go dead, and the
            // pond freezes over (fish/lilies dormant — handled in #tickProducers).
            if (this.season === 3) {
                let killed = 0;
                for (const c of this.crops.values()) if (!c.withered) { c.withered = true; killed++; }
                if (killed) this.addLog(`The frost takes the fields — ${killed} crops die back for winter.`, '#a8c8e8');
            }
            // an ACTIVE weather the new season forbids (a fall storm rolling into winter, or a
            // winter blizzard into spring) is ended immediately, not left running until the next
            // scheduled roll (Codex #1).
            if ((def.weather[this.weather] ?? 1) === 0) this.#rollWeather();
            this._tilesChanged = true;
            this._seasonChanged = true;
        }
    }

    addLog(text, color = '#c8ccd8') {
        this.log.push({ text, color, t: performance.now() });
        if (this.log.length > 80) this.log.shift();
    }

    // Record a lasting story beat in the chronicle. kind groups the beat (found/build/town/peril/
    // bond/rift/find); who/other are the farmer(s) it belongs to, so the panel can thread each
    // farmer's personal saga. Stamped with in-sim day/season/year only — fully deterministic.
    addChronicle(kind, text, who = null, other = null, color = '#c8ccd8') {
        text = text.replace(/[—–]/g, '-');   // the bitmap font has no long dash — normalize to a hyphen
        this.chronicle.push({
            day: this.day, season: this.season, year: this.year, kind, text, color,
            whoSeed: who ? who.sheet.seed : null,
            otherSeed: other ? other.sheet.seed : null,
        });
        if (this.chronicle.length > 240) this.chronicle.shift();
    }

    // The founding roster should have real texture. If the memory-grown personalities didn't
    // happen to include an agent-of-chaos manipulator and a moody/mercurial farmer, nudge the
    // nearest candidates into those roles. Deterministic: the same roster always resolves the
    // same way (sorted picks, no rand), so it never breaks reproducibility.
    ensureFounderVariety() {
        const fs = this.farmers;
        if (fs.length < 3) return;
        const P = f => f.sheet.personality;
        const relabel = f => { const id = personalityLabel(P(f)); P(f).label = id.label; P(f).creed = id.creed; };
        // 1) a manipulator — genuinely low honesty, with the drive/temper to stir the pot
        let chaos = fs.find(f => P(f).honesty < 0.2);
        if (!chaos) {
            chaos = [...fs].sort((a, b) => (P(a).honesty - P(b).honesty) || (P(b).competitiveness - P(a).competitiveness))[0];
            const p = P(chaos);
            // an idle, competitive, dishonest schemer: low honesty + drive, but slack diligence
            // (so they have time to scheme instead of farm), a moderate social face, a lively temper
            p.honesty = 0.1; p.competitiveness = Math.max(p.competitiveness, 0.72);
            p.diligence = Math.min(p.diligence, 0.3); p.collaboration = Math.max(0.35, Math.min(0.55, p.collaboration));
            p.volatility = Math.max(p.volatility ?? 0.5, 0.55);
            relabel(chaos);
        }
        // named so they're easy to spot in the roster
        chaos.sheet.name = 'Chaos Ry';
        this.addLog(`${chaos.sheet.name} has a scheming glint in their eye...`, '#c07050');

        // 2) a mercurial — high temper, middling everything else (warm then cold, quick to bristle)
        let moody = fs.find(f => f !== chaos && (P(f).volatility ?? 0) > 0.72);
        if (!moody) {
            const neutral = f => ['collaboration', 'competitiveness', 'honesty', 'diligence'].reduce((s, k) => s + Math.abs(P(f)[k] - 0.5), 0);
            moody = [...fs].filter(f => f !== chaos).sort((a, b) => neutral(a) - neutral(b))[0];
            if (moody) {
                const p = P(moody);
                p.volatility = 0.85; p.collaboration = Math.max(0.35, Math.min(0.6, p.collaboration));
                relabel(moody);
            }
        }
        if (moody) {
            moody.sheet.name = 'Mercurial Ry';
            this.addLog(`${moody.sheet.name} runs hot and cold — hard to read.`, '#c8a060');
        }

        // 3) a wanderer — high curiosity, pulled past the fog line more than anyone
        let wanderer = fs.find(f => f !== chaos && f !== moody && (P(f).curiosity ?? 0) > 0.72);
        if (!wanderer) {
            wanderer = [...fs].filter(f => f !== chaos && f !== moody)
                .sort((a, b) => (P(b).curiosity ?? 0) - (P(a).curiosity ?? 0))[0];
            if (wanderer) { P(wanderer).curiosity = 0.86; relabel(wanderer); }
        }
        if (wanderer) {
            wanderer.sheet.name = 'Rover Ry';
            this.addLog(`${wanderer.sheet.name} keeps one eye on the horizon.`, '#40c8c0');
        }

        // 4) a lone wolf — genuinely low collaboration, so they strike out to farm the far wilds
        //    alone (see #resettleByPersonality). Guaranteed so every town has that isolated outlier.
        let loner = fs.find(f => f !== chaos && f !== moody && f !== wanderer && P(f).collaboration < 0.3);
        if (!loner) {
            loner = [...fs].filter(f => f !== chaos && f !== moody && f !== wanderer)
                .sort((a, b) => P(a).collaboration - P(b).collaboration)[0];
            if (loner) { P(loner).collaboration = 0.14; relabel(loner); }
        }
        if (loner) {
            loner.sheet.name = 'Nomad Ry';
            this.addLog(`${loner.sheet.name} would sooner farm alone at the edge of the world.`, '#9a8fb0');
        }

        // the chaos-agent's drive was bumped and the wanderer's curiosity nudged — refresh their wanderlust
        for (const f of fs) f.recomputeWanderlust();

        // FREE-WILL SETTLEMENT: now that every founder's personality is final, let them choose where
        // to homestead. The sociable hug the plaza; lone wolves (and the curious) strike out into the
        // far, fogged corners of the valley to farm in isolation. Plots are still pristine (no ticks
        // yet), so this is a clean reposition. See #resettleByPersonality.
        this.#resettleByPersonality();

        // seed the activity feed with the town's founding, so it reads as an ongoing chronicle from
        // the moment the game loads (rather than an empty bar until the first event fires).
        this.#seedFoundingLog();
    }

    #seedFoundingLog() {
        const fs = this.farmers;
        if (!fs.length) return;
        const first = n => n.sheet.name.split(' ')[0];
        const social = fs.reduce((a, b) => this.#ventureOf(a) <= this.#ventureOf(b) ? a : b);
        const loner = fs.reduce((a, b) => this.#ventureOf(a) >= this.#ventureOf(b) ? a : b);
        const B = '#8a9ade', G = '#c9a45a';
        this.addLog(`${fs.length} settlers crossed the ridge into an empty valley, seeking new ground.`, B);
        this.addLog(`They mustered at the old well and named the place RY FARMS.`, G);
        this.addLog(`${first(social)}, who thrives in company, staked a claim close by the plaza.`, B);
        this.addLog(`${first(loner)}, a lone spirit, struck out for the far wilds to farm alone.`, B);
        this.addLog(`The first ${this.seasonName.toLowerCase()} dawned over the valley — and the work began.`, G);
    }

    // venture factor 0..1: how far from the plaza a farmer wants to settle. Centered on the ~0.54
    // collaboration the founders tend to roll and amplified, so the narrow natural spread still reads
    // as a DRAMATIC one — lone wolves (low collaboration) and the curious strike out for the far
    // corners; the sociable hug the plaza.
    #ventureOf(f) { return Math.max(0, Math.min(1, 0.5 + (0.54 - f.p.collaboration) * 2.6 + (f.p.curiosity - 0.45) * 0.55)); }

    #resettleByPersonality() {
        const B = World.BASE_PLOT;
        // the sociable claim their plaza-side spots first; the venturesome then pick their distant
        // ground around the settled core (deterministic order: venture asc, seed as tiebreak)
        const order = [...this.farmers].sort((a, b) => (this.#ventureOf(a) - this.#ventureOf(b)) || (a.sheet.seed - b.sheet.seed));
        for (const f of order) {
            const v = this.#ventureOf(f);
            // distance is personality-driven, with a per-game random jitter; the BEARING is fully
            // random (world.rand) so the same cast lays out DIFFERENTLY every refresh (seed varies at
            // page load — see main.js). Headless tests pass a fixed seed, so they stay deterministic.
            const desiredR = 14 + v * 50 + (this.rand() - 0.5) * 12;        // ~plaza .. ~far fogged corner
            const baseAng = this.rand() * Math.PI * 2;
            const cands = this.#scoutCandidates(f, f.plot, desiredR, baseAng, B);
            if (!cands.length) continue;
            const best = cands[0];
            // a decent-but-worse spot a real walk away that they'll CONSIDER then pass on — so the
            // watcher sees them survey, weigh, and choose (visible deliberation), not teleport-to-optimal.
            const reject = cands.slice(1).find(c => c.score < best.score && Math.hypot(c.i - best.i, c.j - best.j) >= 8);
            this.#reserveHomestead(f, best, reject, B);
        }
    }

    // Collect a handful of VALID candidate homesteads near the desired radius/bearing, each scored for
    // ground quality (timber good, water/boulders bad), best-first — the settler's options to weigh.
    #scoutCandidates(f, plot, desiredR, baseAng, B) {
        const found = [];
        for (let dr = 0; dr <= 44 && found.length < 10; dr += 3) {
            const radii = dr === 0 ? [desiredR] : [desiredR + dr, Math.max(11, desiredR - dr)];
            for (const rr of radii) {
                for (let da = 0; da <= 10; da++) {
                    const ang = baseAng + (da % 2 ? 1 : -1) * Math.ceil(da / 2) * 0.5;
                    const i = Math.round(CENTER + Math.cos(ang) * rr) - (B >> 1), j = Math.round(CENTER + Math.sin(ang) * rr) - (B >> 1);
                    if (this.#candidateBlockers(plot, i, j, B, B) === null) continue;
                    // score = ground quality + who's nearby: a spot's worth is the land AND the neighbours
                    const social = this.#socialEval(f, i + (B >> 1), j + (B >> 1)).bias;
                    found.push({ i, j, score: this.#homesteadScore(i, j, B) + social });
                    if (found.length >= 10) break;
                }
            }
        }
        found.sort((a, b) => b.score - a.score);
        return found;
    }
    // A short, honest reaction to a spot a settler decides to PASS on — what's wrong with it.
    #rejectNote(x, y, B) {
        let water = 0, bigRock = 0, trees = 0;
        for (let s = 0; s < 9; s++) {
            const i = x - 2 + ((s * 5 + 1) % (B + 4)), j = y - 2 + ((s * 7 + 3) % (B + 4)), t = this.get(i, j);
            if (t === T.WATER) water++; else if (t === T.ROCK && obstacleTier(i, j) === 2) bigRock++; else if (t === T.TREE) trees++;
        }
        if (bigRock >= 1) return 'too many boulders to clear here...';
        if (water >= 2) return 'too swampy, this ground...';
        if (trees === 0) return 'no timber close by — no good...';
        return 'hm... not quite right here';
    }
    // A rough "is this good ground?" score: +1 per nearby stand of timber (up to 3), -2 if the plot
    // sits on water. Cheap sampling of the plot + a ring around it.
    #homesteadScore(x, y, B) {
        let trees = 0, water = 0, bigRock = 0;
        for (let s = 0; s < 9; s++) {
            const i = x - 2 + ((s * 5 + 1) % (B + 4)), j = y - 2 + ((s * 7 + 3) % (B + 4));
            const t = this.get(i, j);
            if (t === T.TREE) trees++;
            else if (t === T.WATER) water++;
            else if (t === T.ROCK && obstacleTier(i, j) === 2) bigRock++;   // a founder shuns big boulders
        }
        return Math.min(3, trees) - water * 2 - bigRock * 2;
    }

    // A settler's INSTINCTIVE read of a neighbour before any shared history: honest, collaborative
    // folk invite company; a visibly shifty one (a low-honesty manipulator like Chaos) puts people
    // off. This is what lets founders — who have no bonds yet — still cluster toward the trustworthy
    // and shun the wary, so the very first settlement reads as social judgment, not a blind radius.
    #instinct(f, o) {
        return (o.p.honesty - 0.5) * 0.9 + (o.p.collaboration - 0.5) * 0.5;
    }
    // The net social pull a spot at (cx,cy) exerts on farmer f: summed over every nearby neighbour
    // who has COMMITTED to ground (reserved or sited). A friend / trusted soul draws them IN; a rival
    // or distrusted neighbour pushes them AWAY; a lone wolf is crowd-averse even toward the likable;
    // the gregarious welcome any neighbour. Returns { bias } for scoring and { driver } — the single
    // neighbour who most shapes the feeling — so #claimReason can VOICE the actual social choice.
    #socialEval(f, cx, cy) {
        const collab = f.p.collaboration, loner = collab < 0.42, sociable = collab > 0.55;
        let bias = 0, driver = null, driverMag = 0;
        for (const o of this.farmers) {
            if (o === f || !o.plot || o.plot.x == null) continue;
            if (!(o.plot.sited || o.claim)) continue;                 // only neighbours with fixed ground count
            const d = Math.hypot((o.plot.x + 6) - cx, (o.plot.y + 6) - cy);
            if (d > 42) continue;                                     // out of neighbourhood range
            const prox = 1 - d / 42;                                  // closer neighbours weigh more
            const bond = this.bonds.get(this.bondKey(f, o)) || 0;
            // rapport also weighs the neighbour's TOWN REPUTATION — an ill-reputed name (a known
            // thief, a welcher) is shunned as a neighbour even before any personal history exists
            const rapport = Math.max(-1, Math.min(1, f.opinionOf(o) + bond * 0.12 + this.#instinct(f, o) + (o.reputation - 0.55) * 0.6));
            let w;
            if (rapport <= -0.28) w = -6 * prox;                      // a rival / distrusted: keep clear
            else if (rapport >= 0.28) w = 5 * prox;                   // a friend / trusted: settle near
            else if (loner) w = -4 * prox;                            // solitary + no strong tie: crowd-averse
            else if (sociable) w = 3 * prox;                          // gregarious: a neighbour is welcome
            else w = 0.4 * prox;                                      // neutral: a mild draw to company
            if (loner && w > 0) w *= 0.25;                            // a loner won't crowd even the likable
            bias += w;
            if (Math.abs(w) > driverMag) { driverMag = Math.abs(w); driver = { o, rapport, loner, sociable, near: w > 0, d }; }
        }
        return { bias: Math.max(-4, Math.min(4, bias)), driver };     // clamp so ground quality still matters
    }

    // RESERVE (but don't yet stake) the ground a founder is drawn to: fix the plot's rect so no one
    // else claims it, but leave its cells EMPTY (unsited) so nothing renders on the map. Muster the
    // settler at the plaza and reveal a trail out — they physically travel to the ground, scout it,
    // and STAKE it on arrival (claimHomestead), so plots appear one by one as founders settle rather
    // than all pre-outlined at once.
    #reserveHomestead(f, best, reject, B) {
        const plot = f.plot, i = best.i, j = best.j;
        plot.x = i; plot.y = j; plot.w = B; plot.h = B;   // the BEST spot's rect reserved (overlap-checked), not sited
        plot.house = { i: i + 4, j: j + 4 };
        plot.cells = new Set();                            // empty until claimed -> no fence/outline yet
        plot.sited = false; plot.rev++; plot._fenceRing = null;
        plot.built.fence = false; plot.built.level = 0;
        const bestC = { i: i + (B >> 1), j: j + (B >> 1) };
        f.claim = bestC;
        // SCOUT ITINERARY: visit a worse spot first (and voice why they pass), then settle the best.
        f.scoutList = [];
        if (reject) {
            const rc = { i: reject.i + (B >> 1), j: reject.j + (B >> 1), note: this.#rejectNote(reject.i, reject.j, B) };
            f.scoutList.push(rc);
            this.#revealCorridor(CENTER, CENTER, rc.i, rc.j, 4);
            this.#revealCorridor(rc.i, rc.j, bestC.i, bestC.j, 4);
        } else {
            this.#revealCorridor(CENTER, CENTER, bestC.i, bestC.j, 4);
        }
        f.scoutList.push({ i: bestC.i, j: bestC.j, best: true });
        f.scoutIdx = 0;
        const first = f.scoutList[0];
        const bearing = Math.atan2(first.j - CENTER, first.i - CENTER), r = 4 + this.rand() * 2.5;
        f.pos = { i: CENTER + Math.cos(bearing) * r, j: CENTER + Math.sin(bearing) * r };
    }
    // The settler reached the ground they scouted — STAKE it: fill the plot's cells, lay out the
    // fields, reveal the homestead. Only now does it appear on the map and real homesteading begin.
    claimHomestead(f) {
        const plot = f.plot;
        if (plot.sited) return;
        const B = plot.w, span = World.INITIAL_PLOT, off = (B - span) >> 1;   // small starter claim, centred in the slot
        for (let jj = plot.y + off; jj < plot.y + off + span; jj++)
            for (let ii = plot.x + off; ii < plot.x + off + span; ii++) plot.cells.add(pkey(ii, jj));
        plot.sited = true; plot.rev++; plot._fenceRing = null;
        this.#rebuildFields(plot);
        this.reveal(plot.x + (B >> 1), plot.y + (B >> 1), 13);   // light up the homestead now they're here
        // SAY the WHY, drawn from what actually drew them here — so the choice reads as judgment, not RNG.
        const reason = this.#claimReason(f);
        f.say(reason, '#7dd069'); f.think(reason); f.sparkle = 1.5;
        this.addLog(`${f.sheet.name} staked a homestead — "${reason.toLowerCase()}"`, '#7dd069');
        this.addChronicle('found', `${f.sheet.name.split(' ')[0]} staked a homestead — ${reason.toLowerCase()}.`, f, null, '#7dd069');
    }
    // Why did this settler pick THIS ground? Read the nearby resources + nearest neighbour + their
    // nature, and voice the most salient reason. This is the settlement decision made LEGIBLE.
    #claimReason(f) {
        const p = f.plot, cx = p.x + 6, cy = p.y + 6;
        let trees = 0, water = 0, ore = 0, forage = 0;
        for (let dj = -8; dj <= 8; dj += 2) for (let di = -8; di <= 8; di += 2) {
            const t = this.get(cx + di, cy + dj);
            if (t === T.TREE) trees++; else if (t === T.WATER) water++;
            else if (t === T.ROCK) ore++; else if (t === T.WHEAT || t === T.FLOWER) forage++;
        }
        // the SOCIAL driver first: the neighbour who most shaped this choice, and whether they
        // pulled the settler in (friend/trusted) or pushed them off (rival/distrusted). This is the
        // settlement made legible as a relationship decision, not just a resource one.
        const { driver } = this.#socialEval(f, cx, cy);
        const collab = f.p.collaboration, loner = collab < 0.42, sociable = collab > 0.55;
        if (driver) {
            const nm = driver.o.sheet.name.split(' ')[0];
            if (driver.rapport <= -0.28) return `keeping my distance from ${nm}`;
            if (driver.rapport >= 0.28 && driver.near) return `settling near ${nm} — we get on well`;
            if (loner && !driver.near) return 'far from everyone — just how I like it';
            if (sociable && driver.near && driver.d < 26) return `good — ${nm}'s right over there`;
        }
        // no neighbour nearby: solitude reads differently by nature
        if (loner) return 'far from everyone — just how I like it';
        if (sociable && !driver) return "a bit lonely out here, but the land's good";
        if (trees >= 4) return 'plenty of timber to build with';
        if (ore >= 3) return 'good stone in these rocks';
        if (water >= 2) return "water's close — the crops'll thank me";
        if (forage >= 4) return 'wild food all around — easy pickings';
        if (driver && driver.near) return `neighbourly enough — ${driver.o.sheet.name.split(' ')[0]}'s not far`;
        return "room to grow, and quiet. this'll do";
    }
    // Reveal a straight trail of fog between two points so a settler can path along it.
    #revealCorridor(i0, j0, i1, j1, r) {
        const dist = Math.hypot(i1 - i0, j1 - j0), steps = Math.max(1, Math.ceil(dist / (r * 0.8)));
        for (let s = 0; s <= steps; s++) {
            const t = s / steps;
            this.reveal(Math.round(i0 + (i1 - i0) * t), Math.round(j0 + (j1 - j0) * t), r);
        }
    }

    #initLlmChat() {
        if (typeof window === 'undefined' || typeof fetch !== 'function') return { enabled: false };
        let endpoint = LLM_CHAT_ENDPOINT;
        try {
            endpoint = window.RYFARMS_CHAT_ENDPOINT || window.localStorage?.getItem('ryFarmsChatEndpoint') || endpoint;
        } catch {
            endpoint = LLM_CHAT_ENDPOINT;
        }
        if (!endpoint || endpoint === 'off' || endpoint === 'false') return { enabled: false };
        return { enabled: true, endpoint, inflight: 0, lastAt: -999, disabledUntil: 0, failures: 0 };
    }

    #journalBrief(farmer, other = null, limit = 7) {
        const rows = [];
        for (let k = farmer.journal.length - 1; k >= 0 && rows.length < limit; k--) {
            const m = farmer.journal[k];
            if (other && m.who !== other.sheet.seed && m.kind !== 'lesson') continue;
            const who = this.farmers.find(f => f.sheet.seed === m.who);
            rows.push({
                day: m.day,
                kind: m.kind,
                text: String(m.text || '').slice(0, 140),
                about: who ? who.sheet.name : null,
                strength: Math.round(m.strength * 100) / 100,
            });
        }
        return rows;
    }

    #chatProfile(farmer, other) {
        const s = farmer.sheet, p = s.personality;
        const moodWord = farmer.mood > 0.35 ? 'buoyant' : farmer.mood < -0.35 ? 'out of sorts' : 'even';
        return {
            name: s.name,
            archetype: p.label,
            creed: p.creed,
            goal: farmer.goal || 'finding their way',
            // the inner weather that colours how they'll talk right now
            mood: moodWord,
            temper: p.volatility > 0.66 ? 'mercurial' : p.volatility < 0.34 ? 'even-keeled' : 'steady',
            traits: { teamwork: p.collaboration, drive: p.competitiveness, honesty: p.honesty, workEthic: p.diligence },
            level: s.level,
            health: farmer.health,
            energy: Math.round(farmer.energy * 100) / 100,
            state: farmer.state,
            thought: farmer.thought || '',
            harvests: s.harvested,
            cropsOnHand: farmer.sheet.produce || 0,
            wood: farmer.wood,
            ore: farmer.ore,
            tilesExplored: farmer.discovered || 0,
            opinionOfOther: Math.round(farmer.opinionOf(other) * 100) / 100,
            trusts: farmer.allRegard(1).map(r => r.who.sheet.name.split(' ')[0]),
            wary: farmer.allRegard(-1).map(r => r.who.sheet.name.split(' ')[0]),
            rumorsHeard: (farmer.gossip || []).slice(-4).map(g => `${g.from} warned against ${g.about}`),
            strongestSharedMemories: this.#journalBrief(farmer, other, 5),
            recentMemories: this.#journalBrief(farmer, null, 5),
        };
    }

    #chatPayload(speaker, listener, ctx = {}) {
        const pr = this.project;
        return {
            day: this.day,
            season: this.seasonName,
            weather: WEATHER_STATES[this.weather]?.label || this.weather,
            leader: this.leader?.sheet?.name || null,
            harvestTotal: this.harvestTotal,
            boardBuilt: !!this.board,
            townProject: pr ? {
                label: pr.label,
                points: Math.round(pr.points || 0),
                needed: pr.needed,
                builders: [...(pr.builders || [])].map(f => f.sheet.name),
            } : null,
            recentTownLog: this.log.slice(-8).map(l => String(l.text || '').slice(0, 150)),
            relationship: {
                speakerToListener: Math.round((ctx.op ?? speaker.opinionOf(listener)) * 100) / 100,
                listenerToSpeaker: Math.round((ctx.rop ?? listener.opinionOf(speaker)) * 100) / 100,
                vividMemory: ctx.vivid ? {
                    day: ctx.vivid.day,
                    kind: ctx.vivid.kind,
                    text: String(ctx.vivid.text || '').slice(0, 140),
                    strength: Math.round(ctx.vivid.strength * 100) / 100,
                } : null,
                gossipTarget: ctx.grudge?.who ? {
                    name: ctx.grudge.who.sheet.name,
                    regard: Math.round(ctx.grudge.v * 100) / 100,
                } : null,
            },
            speaker: this.#chatProfile(speaker, listener),
            listener: this.#chatProfile(listener, speaker),
            fallback: ctx.fallback ? {
                speakerLine: ctx.fallback.speakerLine,
                listenerLine: ctx.fallback.listenerLine,
            } : null,
        };
    }

    tryLlmChat(speaker, listener, ctx = {}) {
        const cfg = this.llmChat;
        if (!cfg?.enabled || typeof fetch !== 'function') return false;
        if (cfg.inflight >= 1 || this.time < cfg.disabledUntil) return false;
        if (this.time - cfg.lastAt < LLM_CHAT_REQUEST_COOLDOWN) return false;
        // conversations are already sparse; when the LLM is available, let it drive nearly all of
        // them (the scripted lines are a fallback for offline / failed / in-flight requests only)
        if (this.rand() > 0.95) return false;

        cfg.inflight++;
        cfg.lastAt = this.time;
        speaker.say('LISTEN...', '#8a9ade');
        listener.say('...', '#8a9ade');
        speaker.facing = (listener.pos.i - listener.pos.j) >= (speaker.pos.i - speaker.pos.j) ? 1 : -1;
        listener.facing = (speaker.pos.i - speaker.pos.j) >= (listener.pos.i - listener.pos.j) ? 1 : -1;
        this.#runLlmChat(speaker, listener, ctx);
        return true;
    }

    async #runLlmChat(speaker, listener, ctx) {
        const cfg = this.llmChat;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), LLM_CHAT_TIMEOUT_MS);
        try {
            const res = await fetch(cfg.endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ context: this.#chatPayload(speaker, listener, ctx) }),
                signal: controller.signal,
            });
            if (!res.ok) {
                const err = new Error(`chat endpoint ${res.status}`);
                err.status = res.status;
                throw err;
            }
            const data = await res.json();
            if (data?.fallback) {
                const err = new Error(data.error || 'chat endpoint requested fallback');
                err.status = data.status || 503;
                throw err;
            }
            if (!this.#applyGeneratedChat(speaker, listener, data)) throw new Error('empty generated chat');
            cfg.failures = 0;
        } catch (err) {
            cfg.failures++;
            if (err?.name !== 'AbortError' && ([401, 403, 404, 405, 501, 503].includes(err?.status) || cfg.failures >= 2)) {
                cfg.disabledUntil = this.time + LLM_CHAT_FAIL_COOLDOWN;
            }
            if (ctx?.fallback) this.applyChatLines(speaker, listener, ctx.fallback, { weight: ctx.fallback.weight ?? 0.45 });
        } finally {
            clearTimeout(timeout);
            cfg.inflight = Math.max(0, cfg.inflight - 1);
        }
    }

    #applyGeneratedChat(speaker, listener, data) {
        const lines = data?.lines || data?.conversation?.lines || null;
        const first = Array.isArray(lines) ? lines[0] : null;
        const second = Array.isArray(lines) ? lines[1] : null;
        const chat = {
            speakerLine: data?.speakerLine || data?.speaker_line || first?.text || data?.speaker?.text,
            listenerLine: data?.listenerLine || data?.listener_line || second?.text || data?.listener?.text,
            speakerColor: this.#toneColor(data?.speakerTone || first?.tone || data?.tone),
            listenerColor: this.#toneColor(data?.listenerTone || second?.tone || data?.tone),
            memory: data?.memory || data?.summary,
            relationshipDelta: Number(data?.relationshipDelta ?? data?.relationship_delta ?? 0) || 0,
            reason: data?.relationshipReason || data?.relationship_reason || 'opened up in conversation',
            weight: 0.9,
        };
        if (!chat.speakerLine || !chat.listenerLine) return false;
        this.applyChatLines(speaker, listener, chat, { weight: 0.9 });
        return true;
    }

    #toneColor(tone) {
        const t = String(tone || '').toLowerCase();
        if (/warm|kind|hope|friend|grateful/.test(t)) return '#7dd069';
        if (/hurt|tense|angry|fear|sour|warn/.test(t)) return '#c05840';
        if (/deal|work|trade|proud|bold/.test(t)) return '#e8c860';
        if (/reflect|quiet|sad|dream|honest/.test(t)) return '#8a9ade';
        return '#c8ccd8';
    }

    applyChatLines(speaker, listener, chat, opts = {}) {
        const speakerLine = cleanChatText(chat.speakerLine || chat.line || chat.speaker || '...');
        const listenerLine = cleanChatText(chat.listenerLine || chat.reply || chat.listener || '...');
        const speakerColor = chat.speakerColor || chat.color || '#c8ccd8';
        const listenerColor = chat.listenerColor || chat.replyColor || '#c8ccd8';
        speaker.say(speakerLine, speakerColor);
        listener.say(listenerLine, listenerColor);
        speaker.facing = (listener.pos.i - listener.pos.j) >= (speaker.pos.i - speaker.pos.j) ? 1 : -1;
        listener.facing = (speaker.pos.i - speaker.pos.j) >= (listener.pos.i - listener.pos.j) ? 1 : -1;

        const delta = clamp(Number(chat.relationshipDelta || 0), -0.08, 0.08);
        if (Math.abs(delta) >= 0.015) {
            speaker.adjustOpinion(listener, delta, chat.reason || 'opened up in conversation');
            listener.adjustOpinion(speaker, delta * 0.85, chat.reason || 'opened up in conversation');
            if (delta > 0.03) this.addBond(speaker, listener);
        }

        if (opts.journal !== false) {
            const weight = opts.weight ?? chat.weight ?? 0.45;
            const memory = chat.memory ? cleanChatText(chat.memory, CHAT_MEMORY_MAX) : null;
            if (memory) {
                speaker.remember('chat', memory, listener, weight);
                listener.remember('chat', memory, speaker, weight);
            } else {
                speaker.remember('chat', `Told ${shortName(listener)}: "${speakerLine}"`, listener, weight);
                listener.remember('chat', `${shortName(speaker)} said: "${speakerLine}"`, speaker, Math.max(0.35, weight - 0.05));
            }
        }
    }

    nearestWell(pos) {   // access-blind; kept for world-level checks (prefer nearestUsableWell for farmers)
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
        const key = this.bondKey(a, b);
        const v = (this.bonds.get(key) || 0) + delta;
        this.bonds.set(key, v);
        a.emote = b.emote = 'bond'; a.emoteT = b.emoteT = 1.6;   // a warm beat you can see (B3)
        // the moment a working acquaintance becomes a real friendship, note it (once per pair)
        if (v >= 4 && !this._chronBonds.has(key)) {
            this._chronBonds.add(key);
            this.addChronicle('bond', `${a.sheet.name.split(' ')[0]} and ${b.sheet.name.split(' ')[0]} have grown close.`, a, b, '#7dd069');
        }
    }
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

    // Same authority as addFarmer for whether a spawn is possible (under the population cap
    // and a fitting slot exists, or ring 2 can still open) — so the +RY button disables in sync.
    canAddFarmer() {
        if (this.farmers.length >= MAX_FARMERS) return false;
        const B = World.BASE_PLOT;
        if (this.slots.some(s => !s.used && this.#candidateBlockers(null, s.i, s.j, B, B) !== null)) return true;
        return this.ringCount === 1;
    }

    addFarmer(memory, mutation = 0) {
        if (this.farmers.length >= MAX_FARMERS) return null;
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
            house: { i: slot.i + 4, j: slot.j + 4 },   // 5x5 footprint centred in the 13x13 plot
            fields: [], facilities: [],
            // plot area is a SET of tiles (starts as the base square) so it can later grow
            // into L-shapes; `rev` bumps whenever `cells` changes so the renderer re-traces fences.
            cells: new Set(), rev: 0,
            // settlers arrive to raw land: clear it, gather wood for a fence, then raise a
            // level-1 tipi and slowly upgrade it (L1 tipi -> L2 yurt -> L3 cottage) over a year+.
            // level 0 = homeless. Until level>=1 no house renders and they sleep in the open.
            built: { fence: false, level: 0 },
            fencePosts: 0, fenceTarget: 0,   // fence is raised post-by-post, not instantly
            building: null,                  // { level, points, needed } while a dwelling is under construction
            sited: false,                    // false until the settler physically travels out and STAKES it
        };
        // A settler stakes only a SMALL starter claim (centred on the house) — just enough to fence,
        // raise a tipi and till a few beds. The homestead SCALES UP with each dwelling tier as they
        // annex land (tierCellCap gates growth), so a tipi is cramped and a cottage is an estate.
        const span = World.INITIAL_PLOT, off = (B - span) >> 1;   // centre the claim in the reserved slot
        for (let j = slot.j + off; j < slot.j + off + span; j++)
            for (let i = slot.i + off; i < slot.i + off + span; i++) plot.cells.add(pkey(i, j));
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

    static MAX_CELLS = 560;  // acreage cap (~23x23 worth of land, any shape, annexes included)
    static BASE_PLOT = 13;   // reserved slot size (square) — neighbour spacing; the CLAIMED area starts smaller
    static INITIAL_PLOT = 9; // a settler's first staked claim (9x9=81) centred in the slot; scales up per house tier
    static HOUSE_FT = 5;     // the reserve ANCHOR footprint (yurt); a tipi is 3x3, a cottage 7x7 —
                             // all centred on the same houseCentre, so this stays 5 (see houseFt/houseCentre)
    // Each dwelling needs ELBOW ROOM before it can rise: a farmer must first EXPAND the homestead
    // past these thresholds so the bigger house isn't crammed into a starter yard. Gated in
    // #maybeUpgradeHome — ambition turns to LAND first, then the house.
    static YURT_MIN_CELLS = 145;     // a yurt wants a real farm around it — grow the tipi's ~81-tile yard first
    static COTTAGE_MIN_CELLS = 280;  // a 7x7 cottage is an ESTATE — nearly max out the yurt's plot before raising one

    // The footprint a plot's dwelling reserves right now: the tipi is 3x3, the yurt/cottage 5x5.
    // Uses the building-in-progress tier if upgrading, else the built tier, else the tipi they'll
    // raise first — so the reserve is always sized for what's there or coming.
    houseFt(plot) {
        const lv = plot.building ? plot.building.level : (plot.built.level >= 1 ? plot.built.level : 1);
        return HOUSE_TIERS[lv]?.footprint || World.HOUSE_FT;
    }
    // The fixed centre of the footprint (plot.house is the MAX-footprint top-left, so centre = +2),
    // and the door: front-centre one tile below the current footprint. Used for sleep/craft/care.
    houseCentre(plot) { return { i: plot.house.i + 2, j: plot.house.j + 2 }; }
    houseDoor(plot) { const c = this.houseCentre(plot), h = this.houseFt(plot) >> 1; return { i: c.i, j: c.j + h + 1 }; }
    // The homestead LADDER: your house is your license to hold land. A tipi keeps a modest
    // yard; the yurt earns real acreage; only the cottage commands a full estate. This is
    // what makes farmers hungry to upgrade — the farm can't outgrow the home.
    static tierCellCap(level) { return level >= 3 ? World.MAX_CELLS : level >= 2 ? 300 : 160; }

    // Validate a candidate rect for a plot; returns null if it collides with a
    // neighbor plot / commons / edge, else the list of woodland tiles to clear.
    #candidateBlockers(plot, nx, ny, nw, nh) {
        if (nx < 2 || ny < 2 || nx + nw > GRID - 2 || ny + nh > GRID - 2) return null;
        for (const other of this.plots) {
            if (other === plot) continue;
            if (nx < other.x + other.w + 1 && nx + nw > other.x - 1 &&
                ny < other.y + other.h + 1 && ny + nh > other.y - 1) return null;
        }
        const blockers = [...this.wells, this.sign, this.board, ...this.structures, this.project?.site, ...this.coops.map(c => c.site)].filter(Boolean);
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
        if (!this.isRevealed(i, j)) return 'blocked';   // you can't fence land you haven't charted
        for (const other of this.plots) {
            if (other.cells.has(pkey(i, j))) return 'blocked';
            if (other === plot) continue;
            for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++)
                if (other.cells.has(pkey(i + di, j + dj))) return 'blocked';   // 1-tile gap between farms
        }
        const blockers = [...this.wells, this.sign, this.board, ...this.structures, this.project?.site, ...this.coops.map(c => c.site)].filter(Boolean);
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
        // ambition is capped by ACREAGE, not by a bounding box — annex fields make plots
        // disconnected, so bbox width/height stopped meaning anything. The cap scales with
        // the HOUSE tier: a grander home licenses a grander estate.
        if (plot.cells.size >= World.tierCellCap(plot.built.level)) return { state: 'max' };
        const cx = plot.x + plot.w / 2, cy = plot.y + plot.h / 2;
        const dirs = [
            { di: 1, dj: 0, out: cx > CENTER },
            { di: -1, dj: 0, out: cx < CENTER },
            { di: 0, dj: 1, out: cy > CENTER },
            { di: 0, dj: -1, out: cy < CENTER },
        ];
        let fallback = null;   // best side that has legal cells but misses the 50% preference
        for (const outwardPass of [true, false]) {
            for (const d of dirs) {
                if (d.out !== outwardPass) continue;
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

    // Commit an expansion (caller has already checked wood + clear state). The old fence line
    // facing the new land is TORN DOWN (its posts reclaimed as wood) and a new fence is raised
    // around the enlarged perimeter (paid in wood) — a net 1 wood per post of perimeter growth.
    expandPlot(farmer) {
        const p = farmer.plot;
        const info = this.expansionInfo(p);
        if (info.state !== 'clear') return false;
        // never grab past what the HOUSE licenses — trim the frontier to fit the tier cap
        const room = World.tierCellCap(p.built.level) - p.cells.size;
        if (room <= 0) return false;
        if (info.cells.length > room) info.cells = info.cells.slice(0, room);
        const { removed, added } = this.fenceDelta(p, info.cells);
        // self-guard: even with the reclaimed posts, the farmer must be able to pay for the new
        // fence line — never expand for free by clamping wood to 0 (Codex #4)
        if (farmer.wood + removed * FENCE_POST_WOOD < added * FENCE_POST_WOOD) return false;
        for (const { i, j } of info.cells) {
            p.cells.add(pkey(i, j));
            if (this.get(i, j) === T.WHEAT || this.get(i, j) === T.FLOWER) this.set(i, j, T.GRASS);
        }
        this.#recomputeBounds(p);   // updates x/y/w/h + bumps rev (re-traces fence)
        this.#clearPlotWildBuffer(p, 1);
        this.#rebuildFields(p);
        this._tilesChanged = true;
        // reclaim torn-down posts, pay for the new perimeter
        farmer.wood = Math.max(0, farmer.wood + removed * FENCE_POST_WOOD - added * FENCE_POST_WOOD);
        const name = farmer.sheet.name;
        if (removed > 0) this.addLog(`${name} tore down ${removed} fence post${removed > 1 ? 's' : ''} (+${removed} wood) and re-fenced the bigger yard`, '#7dd069');
        else this.addLog(`${name} fenced in new land!`, '#7dd069');
        return true;
    }

    // Take a DETACHED set of cells into a farmer's plot (a frontier annex field). Pays the
    // fence-wood delta, converts forage to clear grass, and rebuilds bounds/fields/fence.
    // Returns false (spending nothing) if the farmer can't cover the new fence line.
    annexCells(farmer, cells) {
        const p = farmer.plot;
        const { removed, added } = this.fenceDelta(p, cells);
        if (farmer.wood + removed * FENCE_POST_WOOD < added * FENCE_POST_WOOD) return false;
        farmer.wood = Math.max(0, farmer.wood + removed * FENCE_POST_WOOD - added * FENCE_POST_WOOD);
        for (const { i, j } of cells) {
            p.cells.add(pkey(i, j));
            const t = this.get(i, j);
            if (t === T.WHEAT || t === T.FLOWER) this.set(i, j, T.GRASS);
        }
        this.#recomputeBounds(p);
        this.#rebuildFields(p);
        this._tilesChanged = true;
        return true;
    }

    // The building sprites are far wider than the 2x2 tile footprint, so the clear zone spans
    // the whole visual area — nothing (tree/rock/brush/water) may overlap where a dwelling sits.
    static SITE = { di0: -1, di1: 5, dj0: -2, dj1: 5 };   // clear the 5x5 footprint + a margin (roof overhangs above)
    houseSiteClear(plot) {
        const h = plot.house, S = World.SITE;
        for (let dj = S.dj0; dj <= S.dj1; dj++) for (let di = S.di0; di <= S.di1; di++) {
            const t = this.get(h.i + di, h.j + dj);
            if (t === T.TREE || t === T.STUMP || t === T.ROCK || t === T.WATER || t === T.FLOWER || t === T.WHEAT) return false;
        }
        return true;
    }
    // The set of fence-edge segments around a cell-set, each keyed by the two tiles it
    // separates (sorted, so it's identified by LOCATION not by which side owns it). Lets us
    // diff the fence before/after an expansion to know how many posts get torn down vs built.
    #fenceEdgeSet(cells) {
        const s = new Set();
        for (const key of cells) {
            const c = key.indexOf(','), i = +key.slice(0, c), j = +key.slice(c + 1);
            for (const [di, dj] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
                const nk = pkey(i + di, j + dj);
                if (!cells.has(nk)) s.add(key < nk ? `${key}|${nk}` : `${nk}|${key}`);
            }
        }
        return s;
    }
    // Fence bookkeeping for annexing `addCells` onto a plot: how many old posts get torn
    // down (reclaim 1 wood each), how many new posts get raised (cost 1 wood each), and the
    // net wood the farmer must have on hand. Expanding into a pocket can even REFUND wood.
    fenceDelta(plot, addCells) {
        const before = this.#fenceEdgeSet(plot.cells);
        const next = new Set(plot.cells);
        for (const c of addCells) next.add(pkey(c.i, c.j));
        const after = this.#fenceEdgeSet(next);
        let removed = 0, added = 0;
        for (const e of before) if (!after.has(e)) removed++;
        for (const e of after) if (!before.has(e)) added++;
        return { removed, added, net: Math.max(0, (added - removed) * FENCE_POST_WOOD) };
    }
    // Predict the fence-wood cost of a plot's NEXT expansion (0 if nothing to annex).
    fenceDeltaForNext(plot) {
        const info = this.expansionInfo(plot);
        if (info.state !== 'clear') return { removed: 0, added: 0, net: 0 };
        return this.fenceDelta(plot, info.cells);
    }

    // The border cells of a plot, ORDERED as a perimeter walk so a farmer laying the fence moves
    // post-to-post along the line (like tilling a field row by row) instead of teleport-hopping to
    // arbitrary tiles. Ordering: angle around the plot centroid, ties broken by radius then i,j so
    // it never depends on Set-iteration quirks. Cached per plot, rebuilt when the geometry (rev)
    // changes. atan2/sort are pure math — determinism-safe.
    fenceRing(plot) {
        if (plot._fenceRing && plot._fenceRingRev === plot.rev) return plot._fenceRing;
        const border = [];
        let cx = 0, cy = 0;
        for (const key of plot.cells) {
            const c = key.indexOf(','), i = +key.slice(0, c), j = +key.slice(c + 1);
            if (!plot.cells.has(pkey(i, j - 1)) || !plot.cells.has(pkey(i + 1, j)) || !plot.cells.has(pkey(i, j + 1)) || !plot.cells.has(pkey(i - 1, j))) {
                border.push({ i, j }); cx += i; cy += j;
            }
        }
        if (border.length) { cx /= border.length; cy /= border.length; }
        border.sort((a, b) => {
            const aa = Math.atan2(a.j - cy, a.i - cx), ab = Math.atan2(b.j - cy, b.i - cx);
            if (aa !== ab) return aa - ab;
            const ra = (a.i - cx) * (a.i - cx) + (a.j - cy) * (a.j - cy), rb = (b.i - cx) * (b.i - cx) + (b.j - cy) * (b.j - cy);
            if (ra !== rb) return ra - rb;
            return (a.i - b.i) || (a.j - b.j);
        });
        plot._fenceRing = border; plot._fenceRingRev = plot.rev;
        return border;
    }
    // How many posts a plot's fence takes — one per border tile, so it's a real walk around the
    // perimeter (clamped to a floor so a tiny claim still feels like a chunk of work).
    fencePostTarget(plot) {
        return Math.max(8, this.fenceRing(plot).length);
    }
    // The exact border tile to stand ON while raising post #idx — consecutive idx are adjacent
    // cells along the ring, so the farmer walks the fence line rather than jumping around it.
    fencePostSpot(plot, idx) {
        const ring = this.fenceRing(plot);
        if (!ring.length) return { i: plot.house.i, j: plot.house.j + 2 };
        return ring[idx % ring.length];
    }
    completeFence(farmer) {
        farmer.plot.built.fence = true;
        farmer.plot.rev++;
        this._tilesChanged = true;
        this.addLog(`${farmer.sheet.name} finished fencing their homestead.`, '#7dd069');
    }
    // True if the farmer can raise the given tier: enough timber + stone to spend, and past the
    // lifetime-harvest AND personal-level gates (both scale hard so a farmhouse is a season's goal).
    canBuild(farmer, level) {
        const c = HOUSE_TIERS[level];
        return c && farmer.wood >= c.wood && farmer.ore >= c.ore &&
            farmer.sheet.harvested >= c.harvested && farmer.sheet.level >= (c.minLevel || 0);
    }
    // Raise the finished dwelling in place (tiles + level). Materials are paid at the FOUNDATION
    // now (startHouseBuild), so this is always called "free"; the caller does the log/celebration.
    raiseBuilding(farmer, level, free = false) {
        const p = farmer.plot, h = p.house;
        if (!p.built.fence) return false;   // a home is never raised until the fence is fully up
        if (!free) { const c = HOUSE_TIERS[level]; farmer.wood -= c.wood; farmer.ore -= c.ore; }
        // the building itself BLOCKS a modest 3x3 core (under the sprite); the surrounding ring of
        // the footprint (5x5 yurt / 7x7 cottage) is reserved YARD — kept clear of crops/facilities
        // (#inHouse) but left as walkable grass, so a dwelling isn't a giant solid slab.
        const off = (World.HOUSE_FT - 3) >> 1;   // 1 (anchor ft 5) -> 3x3 core at h+1..h+3, centred on houseCentre
        for (let di = off; di < off + 3; di++) for (let dj = off; dj < off + 3; dj++) this.set(h.i + di, h.j + dj, T.HOUSE);
        p.built.level = level;
        this._tilesChanged = true;
        this.#rebuildFields(p);
        return true;
    }

    // Begin a dwelling: pay materials up front and lay a foundation on the 5x5 footprint. The farmer
    // then works it up over many shifts (#buildHouse); it isn't a home until the labour's done.
    startHouseBuild(farmer, level) {
        const p = farmer.plot, c = HOUSE_TIERS[level];
        if (!p.built.fence || p.building) return false;
        farmer.wood -= c.wood; farmer.ore -= c.ore;
        p.building = { level, points: 0, needed: c.buildSteps || 8 };
        this.#clearHouseSite(p);   // level the ground first — a structure can't rise on brush and boulders
        this._tilesChanged = true;
        this.addLog(`${farmer.sheet.name} cleared the ground and laid a foundation for a ${c.name}.`, '#c9a45a');
        return true;
    }
    // Level the site a dwelling will stand on: grub out any wild growth, rocks, stumps, or puddle in
    // the (current-tier) footprint + a one-tile margin, so the structure fits cleanly. The plot's own
    // crops/facilities are kept out of here by #inHouse, so only the wild is cleared.
    #clearHouseSite(p) {
        const c = this.houseCentre(p), half = this.houseFt(p) >> 1;
        for (let dj = -half - 1; dj <= half + 1; dj++) for (let di = -half - 1; di <= half + 1; di++) {
            const t = this.get(c.i + di, c.j + dj);
            if (t === T.TREE || t === T.STUMP || t === T.ROCK || t === T.WATER || t === T.FLOWER || t === T.WHEAT) this.set(c.i + di, c.j + dj, T.GRASS);
        }
    }
    // One completed shift of building work — advances the build and raises the house when it's done.
    buildHouseStep(farmer) {
        const b = farmer.plot.building;
        if (!b) return;
        b.points++;
        if (b.points >= b.needed) {
            farmer.plot.building = null;
            this.raiseBuilding(farmer, b.level, true);   // materials already paid at the foundation
            farmer.say(b.level >= 3 ? 'A REAL HOME!' : b.level === 2 ? 'A BIGGER HOME!' : 'A ROOF!', '#f0d060');
            farmer.sparkle = 2.5;
            farmer.remember('event', b.level >= 3 ? 'Raised my cottage - the estate, the animals, all of it opens now'
                : b.level === 2 ? 'Raised my yurt - more room and bigger stores at last' : 'Built my first home - a roof at last', null, 1.1);
            this.addLog(b.level === 1 ? `${farmer.sheet.name} finished pitching a tipi — a first home!`
                : `${farmer.sheet.name} finished raising a ${HOUSE_TIERS[b.level].name}!`, '#f0d060');
            const fn = farmer.sheet.name.split(' ')[0];
            this.addChronicle('build', b.level === 1 ? `${fn} pitched a tipi — a first roof.`
                : b.level === 2 ? `${fn} raised a yurt.` : `${fn} raised a cottage — the estate is complete.`, farmer, null, '#f0d060');
        }
    }

    // Place the farmer's next preferred facility if there's room (no auto-expand;
    // room is the farmer's job via wood-gated expansion). Returns true if built.
    buildNextFacility(farmer) {
        const plot = farmer.plot;
        const built = new Set(plot.facilities.map(f => f.type));
        // candidate facilities: the farmer's unbuilt preferences their house tier + level already unlock
        const prefs = farmer.sheet.facilityPrefs || ['pond', 'coop', 'pen'];
        const candidates = prefs.filter(t => !built.has(t) && facilityUnlocked(t, plot.built.level, farmer.sheet.level));
        if (!candidates.length) return false;
        // SPECIALISE INTO A GAP: bias toward a facility whose good FEW other farms make, so the town
        // spreads across niches (poultry / dairy / wool / fishery) instead of all making the same thing —
        // that spread is what gives the barter layer something to trade. The farmer's own taste (pref
        // order) still weighs in, and a competitive bot leans harder into an open market.
        const facGood = { coop: 'egg', pond: 'fish', sheeppen: 'wool',
                          pen: farmer.sheet.penAnimal === 'pig' ? 'truffle' : farmer.sheet.penAnimal === 'goat' ? 'wool' : 'milk' };
        const producers = {};
        for (const f of this.farmers) if (f.plot) for (const g of f.producedGoods()) producers[g] = (producers[g] || 0) + 1;
        let nextType = candidates[0], bestScore = -1e9;
        candidates.forEach((t, idx) => {
            const glut = producers[facGood[t]] || 0;
            const score = -glut * (1 + farmer.p.competitiveness * 0.8) - idx * 0.6;   // fewer producers + own taste
            if (score > bestScore) { bestScore = score; nextType = t; }
        });
        const region = this.#findFacilityRegion(plot, nextType);
        if (!region) return false;
        this.#buildFacility(plot, farmer.sheet, nextType, region);
        const def = FACILITY_DEFS[nextType];
        this.addLog(`${farmer.sheet.name} added a ${def.label.toUpperCase()} to their farm!`, '#7dd069');
        farmer.say('NEW GROUNDS!', '#7dd069'); farmer.sparkle = 2;
        return true;
    }

    // an unbuilt facility the farmer's CURRENT house tier + level already unlock (buildable now)
    farmerHasUnbuiltFacility(farmer) {
        const built = new Set(farmer.plot.facilities.map(f => f.type));
        return (farmer.sheet.facilityPrefs || []).some(t => !built.has(t) && facilityUnlocked(t, farmer.plot.built.level, farmer.sheet.level));
    }
    // an unbuilt facility still LOCKED (higher house tier or personal level) — the dream that pulls them up
    farmerHasLockedFacility(farmer) {
        const built = new Set(farmer.plot.facilities.map(f => f.type));
        return (farmer.sheet.facilityPrefs || []).some(t => !built.has(t) && !facilityUnlocked(t, farmer.plot.built.level, farmer.sheet.level));
    }

    // Spiral ring search over KNOWN (revealed) territory — the world is infinite now, so
    // full scans are gone; farmers work from what the town has actually charted.
    #spiralFind(pos, maxR, match) {
        const ci = Math.round(pos.i), cj = Math.round(pos.j);
        if (this.isRevealed(ci, cj)) { const m = match(ci, cj); if (m) return m; }
        for (let r = 1; r <= maxR; r++) {
            for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
                if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;   // ring perimeter only
                const i = ci + di, j = cj + dj;
                if (!this.isRevealed(i, j)) continue;
                const m = match(i, j);
                if (m) return m;
            }
        }
        return null;
    }

    // nearest fellable tile — TREE or STUMP, whichever is closest. A stump is now worth as much
    // wood as a standing tree, so there's no reason to march past one to a fresh trunk; taking the
    // nearest of either kind means the stumps a fell leaves behind actually get grubbed out.
    nearestWood(pos, restrict) {
        if (restrict) {
            let best = null, bestD = 1e9;
            for (const rt of restrict) {
                const t = this.get(rt.i, rt.j);
                if (t !== T.TREE && t !== T.STUMP) continue;
                const d = Math.abs(rt.i - pos.i) + Math.abs(rt.j - pos.j);
                if (d < bestD) { bestD = d; best = { i: rt.i, j: rt.j, kind: t === T.STUMP ? 'stump' : 'tree' }; }
            }
            return best;
        }
        return this.#spiralFind(pos, 48, (i, j) => {
            const t = this.get(i, j);
            if (t === T.TREE) return { i, j, kind: 'tree' };
            if (t === T.STUMP) return { i, j, kind: 'stump' };
            return null;
        });
    }

    // nearest breakable rock within reach (for ore)
    nearestRock(pos, maxD = 10) {
        return this.#spiralFind(pos, maxD, (i, j) => this.get(i, j) === T.ROCK ? { i, j } : null);
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
        // A tile is enterable if it's the goal, is open ground, OR we're stepping OUT of a
        // blocked tile (escaping). From open ground you can never step back into a blocker,
        // so normal paths still route around ponds/buildings — but a farmer stranded inside
        // one (e.g. a pond carved under them) can always walk to the nearest shore.
        // `blk` treats UNREVEALED wilderness as impassable and — crucially — short-circuits on
        // isRevealed BEFORE calling get(), so A* fanning toward a far/fog goal never generates
        // chunks nobody has explored (Codex #1: a failed far path used to spawn hundreds).
        const blk = (i, j) => !this.isRevealed(i, j) || this.pathBlocked(i, j);
        const okTile = (i, j, fromBlocked) => (i === gi && j === gj) || fromBlocked || !blk(i, j);
        const key = (i, j) => i + ',' + j;   // string keys — coordinates are unbounded (and can be negative)
        // search window: the start/goal bounding box plus a generous detour margin. The world
        // is infinite, so the window (plus the node cap) is what keeps A* sane.
        const wi0 = Math.min(si, gi) - 30, wi1 = Math.max(si, gi) + 30;
        const wj0 = Math.min(sj, gj) - 30, wj1 = Math.max(sj, gj) + 30;
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
            if (++expansions > 1800) break;
            const curBlocked = blk(cur.i, cur.j);
            for (const [di, dj] of dirs) {
                const ni = cur.i + di, nj = cur.j + dj;
                if (ni < wi0 || nj < wj0 || ni > wi1 || nj > wj1 || !okTile(ni, nj, curBlocked)) continue;
                // no corner-cut past an obstacle edge — but a bot escaping blocked terrain may cut freely
                if (di && dj && !curBlocked && (blk(cur.i + di, cur.j) || blk(cur.i, cur.j + dj))) continue;
                const ng = cur.g + (di && dj ? 1.4 : 1), kk = key(ni, nj);
                if (best.has(kk) && best.get(kk) <= ng) continue;
                best.set(kk, ng);
                open.push({ i: ni, j: nj, g: ng, f: ng + Math.abs(gi - ni) + Math.abs(gj - nj), p: cur });
            }
        }
        return null;
    }

    // Nearest open (walkable) tile to a position, by ring search — an escape target for a
    // farmer stranded on a blocked tile (a pond/scarecrow/facility built underneath them).
    nearestOpenTile(pos) {
        const ci = Math.floor(pos.i), cj = Math.floor(pos.j);
        for (let r = 1; r < 8; r++) {
            for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
                if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;   // ring perimeter only
                const i = ci + di, j = cj + dj;
                if (this.isRevealed(i, j) && !this.pathBlocked(i, j)) return { i, j };   // don't probe (or generate) fog
            }
        }
        return null;
    }

    // nearest patch of wild forage (wheat or flowers) within reach
    nearestForage(pos, maxD = 15) {
        return this.#spiralFind(pos, maxD, (i, j) => {
            const t = this.get(i, j);
            return (t === T.WHEAT || t === T.FLOWER) ? { i, j, tile: t } : null;
        });
    }
    // A wild lake worth fishing: a WALKABLE shore tile beside a revealed, off-cooldown WILD water
    // tile (an owned farm pond doesn't count). Returns where to STAND + which water tile to fish.
    nearestFishingSpot(pos, maxD = 16) {
        return this.#spiralFind(pos, maxD, (i, j) => {
            if (!this.isRevealed(i, j) || this.pathBlocked(i, j)) return null;   // must be able to stand on the shore
            for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const wi = i + di, wj = j + dj;
                if (!this.isRevealed(wi, wj) || this.get(wi, wj) !== T.WATER) continue;
                if (this.plots.some(p => p.cells.has(pkey(wi, wj)))) continue;               // wild water only, not a farm pond
                if (this.day - (this.fishedAt.get(pkey(wi, wj)) ?? -99) < FISH_COOLDOWN) continue;  // this spot is resting
                return { i, j, water: { i: wi, j: wj } };
            }
            return null;
        });
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
        } else if (type === 'pen' || type === 'sheeppen') {
            fac.struct = { i: region.x, j: region.y, kind: 'barn' };
            this.set(region.x, region.y, T.BARN);
            fac.trough = { i: region.x + region.w - 1, j: region.y + region.h - 1 };
            const kind = type === 'sheeppen' ? 'sheep' : (sheet.penAnimal || 'cow');
            const n = 3 + Math.floor(rand() * 2);
            for (let k = 0; k < n; k++) fac.producers.push(this.#makeProducer(kind, cx + (rand() - 0.5) * region.w * 0.6, cy + (rand() - 0.5) * region.h * 0.6, region));
        }
        plot.facilities.push(fac);
        // A new build turns tiles solid — a barn under a fresh animal, or a pond carved under a
        // chicken that had roamed there. Sweep ALL of the plot's land animals off any now-blocked
        // tile onto valid yard ground so none render standing on a building or on the water.
        for (const otherFac of plot.facilities) for (const pr of otherFac.producers) {
            if (pr.kind === 'fish' || pr.kind === 'pad') continue;   // pond life belongs on the water
            if (!this.#producerCanStand(plot, pr.fx, pr.fy)) {
                const spot = this.#nearestYardTile(plot, pr.fx, pr.fy);
                if (spot) { pr.fx = spot.i + 0.5; pr.fy = spot.j + 0.5; pr.vx = 0; pr.vy = 0; }
            }
        }
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

    // ---- town level: donations to the silo grow the town ------------------------

    // Credit donated town XP and roll any level-ups (exponential thresholds). Levelling the town
    // is what unlocks the next communal build / draws a merchant — a shared, visible milestone.
    addTownXP(n) {
        if (!(n > 0)) return;                        // ignore non-positive / non-finite credits (never corrupt townXP)
        if (this.townLevel >= TOWN_MAX_LEVEL) return;
        this.townXP += n;
        let need = townXpForLevel(this.townLevel);
        while (this.townLevel < TOWN_MAX_LEVEL && this.townXP >= need) {
            this.townXP -= need; this.townLevel++;
            this.townLevelFlash = 2.5;
            this.addLog(`RY FARMS GREW TO TOWN LEVEL ${this.townLevel}! The settlement is thriving.`, '#f0d060');
            this.addChronicle('town', `Ry Farms grew to town level ${this.townLevel}.`, null, null, '#e0c060');
            need = townXpForLevel(this.townLevel);
        }
        if (this.townLevel >= TOWN_MAX_LEVEL) this.townXP = 0;
    }
    townXpNeed() { return townXpForLevel(this.townLevel); }

    // ---- communal projects -------------------------------------------------------

    #maybeStartProject() {
        if (this.project || this.projectIndex >= PROJECT_DEFS.length) return;
        const def = PROJECT_DEFS[this.projectIndex];
        // TOWN LEVEL is the primary unlock gate: a ghost town can't raise a board, and a young
        // town can't rush a windmill — the settlers must first grow the town (donations to the
        // silo) to the tier this build belongs to. This is what stops a day-one build spree.
        if (this.townLevel < (def.townLvl || 1)) return;
        // a storm-battered town rushes its guardian: each crop lost to lightning pulls the
        // monument's harvest gate forward (down to half — the level gate below still stands, so
        // it never rises before someone can carve it). Other projects keep their normal pacing.
        let at = def.at;
        if (def.type.startsWith('statue')) at = Math.max(def.at - this.stormLosses * 6, def.at * 0.5);
        if (this.harvestTotal < at) return;
        // a guardian statue waits for a master hand: nobody carves the stone until someone
        // in town has the level for it
        if (def.lvlReq && !this.farmers.some(f => f.sheet.level >= def.lvlReq)) return;
        // A statue UPGRADE ALWAYS rises in place, right over the standing monument — the scaffold
        // appears on the existing tier as it's rebuilt (old one torn down on completion), never as
        // an orphan scaffold on empty ground before it. The FIRST guardian reserves room for its
        // grandest 3x3 form up front, so every later tier fits at the same anchor.
        let site;
        if (def.type.startsWith('statue')) {
            site = this.statue ? { i: this.statue.i, j: this.statue.j }
                               : (this.#findStructureSpot(3) || this.#findStructureSpot(def.size || 1));
        } else site = this.#findStructureSpot(def.size || 1);
        if (!site) return;
        this.projectIndex++;
        this.project = {
            ...def, site, points: 0, builders: new Set(),
            wood: 0, ore: 0, needWood: def.wood || 0, needOre: def.ore || 0,
        };
        const mats = def.wood ? ` — needs ${def.wood} wood + ${def.ore} ore` : '';
        this.addLog(`TOWN PROJECT: build a ${def.label}! (${def.perk})${mats}`, '#f0d060');
    }

    #findStructureSpot(size = 1) {
        for (let tries = 0; tries < 80; tries++) {
            const a = this.rand() * Math.PI * 2;
            const r = 7 + this.rand() * (4 + size * 2);   // grander monuments sit further out on the ring
            const i = Math.round(CENTER + Math.cos(a) * r);
            const j = Math.round(CENTER + Math.sin(a) * r);
            let clear = true;
            // the whole size x size footprint must be plain grass
            for (let dj = 0; dj < size && clear; dj++) for (let di = 0; di < size; di++)
                if (this.get(i + di, j + dj) !== T.GRASS) { clear = false; break; }
            if (!clear) continue;
            const pad = 1 + size;
            for (const p of this.plots) if (i >= p.x - pad && i <= p.x + p.w + pad && j >= p.y - pad && j <= p.y + p.h + pad) { clear = false; break; }
            for (const s of this.structures) if (Math.abs(s.i - i) + Math.abs(s.j - j) < 5 + size) { clear = false; break; }
            if (Math.abs(this.well.i - i) + Math.abs(this.well.j - j) < 6 + size) clear = false;   // keep well clear (sprites are big)
            if (this.silo && Math.abs(this.silo.i - i) + Math.abs(this.silo.j - j) < 5 + size) clear = false;
            if (this.board && Math.abs(this.board.i - i) + Math.abs(this.board.j - j) < 5 + size) clear = false;
            if (clear) return { i, j };
        }
        return null;
    }

    // Can the upgraded (bigger) statue sit at the old anchor? Its own current tiles are fine
    // (they get torn down on completion); everything else in the footprint must be clear plaza.
    #statueFits(x, y, size, oldStatue) {
        const osz = oldStatue ? (oldStatue.size || 1) : 0;
        for (let dj = 0; dj < size; dj++) for (let di = 0; di < size; di++) {
            const i = x + di, j = y + dj;
            const isOld = oldStatue && i >= oldStatue.i && i < oldStatue.i + osz && j >= oldStatue.j && j < oldStatue.j + osz;
            if (isOld) continue;
            if (this.get(i, j) !== T.GRASS) return false;
        }
        const pad = 1 + size;
        for (const p of this.plots) if (x >= p.x - pad && x <= p.x + p.w + pad && y >= p.y - pad && y <= p.y + p.h + pad) return false;
        if (Math.abs(this.well.i - x) + Math.abs(this.well.j - y) < 6 + size) return false;
        if (this.board && Math.abs(this.board.i - x) + Math.abs(this.board.j - y) < 5 + size) return false;
        for (const s of this.structures) { if (s === oldStatue) continue; if (Math.abs(s.i - x) + Math.abs(s.j - y) < 5 + size) return false; }
        return true;
    }

    // statues gather materials FIRST (hauled by the town), then the carving starts
    projectNeedsMaterials(pr = this.project) { return !!pr && (pr.wood < pr.needWood || pr.ore < pr.needOre); }
    depositProject(farmer) {
        const pr = this.project;
        if (!pr) return 0;
        let gave = 0;
        const nw = Math.min(farmer.wood, pr.needWood - pr.wood);
        if (nw > 0) { farmer.wood -= nw; pr.wood += nw; gave += nw; }
        const no = Math.min(farmer.ore, pr.needOre - pr.ore);
        if (no > 0) { farmer.ore -= no; pr.ore += no; gave += no; }
        if (gave > 0) {
            this.addLog(`${farmer.sheet.name} hauled materials to the ${pr.label} site (${pr.wood}/${pr.needWood} wood, ${pr.ore}/${pr.needOre} ore)`, '#c8a060');
            farmer.gainXP(1);
        }
        return gave;
    }

    contributeBuild(farmer, dt) {
        const pr = this.project;
        if (!pr || this.projectNeedsMaterials(pr)) return;   // no carving before the stone arrives
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
            const size = pr.size || 1;
            // ONE guardian statue per town: a higher tier is an UPGRADE, not a new monument —
            // tear the previous tier's sprite + footprint down before raising the new one.
            if (type.startsWith('statue') && this.statue) {
                const o = this.statue, osz = o.size || 1;
                for (let dj = 0; dj < osz; dj++) for (let di = 0; di < osz; di++) this.set(o.i + di, o.j + dj, T.GRASS);
                const oi = this.structures.indexOf(o); if (oi >= 0) this.structures.splice(oi, 1);
            }
            const st = { type, i: site.i, j: site.j, size };
            this.structures.push(st);
            for (let dj = 0; dj < size; dj++) for (let di = 0; di < size; di++) this.set(site.i + di, site.j + dj, T.STRUCT);
            if (type === 'toolshed') this.workMult *= 1.12;
            else if (type === 'windmill') this.growthMult *= 1.15;
            else if (type.startsWith('statue')) {
                // each tier SUPERSEDES the last: exponentially calmer skies, richer rains
                this.statue = st;
                this.lightningMult = pr.lightning;
                this.rainBoost = pr.rain;
                // the ward is up — the immediate crisis eases. Keep some memory of the storms so
                // a still-battered town still leans toward the next upgrade, but calm the urgency.
                this.stormLosses = Math.floor(this.stormLosses * 0.4);
                for (const f of this.farmers) f.stormLosses = Math.floor(f.stormLosses * 0.4);
            }
            else if (type === 'well2') this.wells.push({ i: site.i, j: site.j, ready: true });
        }
        this.addLog(`The ${label} is finished! ${perk}`, '#f0d060');
        this.addChronicle('town', `The town raised the ${label.toLowerCase()} — ${perk.toLowerCase()}.`, null, null, '#e0c060');
        for (const f of pr.builders) {
            f.gainXP(6); f.say('HOORAY!', '#f0d060'); f.sparkle = 3;
            f.remember('event', `We raised the ${label.toLowerCase()} together`, null, 1.1);
            for (const g of pr.builders) if (g !== f && this.rand() < 0.6) this.addBond(f, g);
        }
    }

    // ---- neighborhood co-ops: need-driven shared infrastructure -------------------
    // Unlike town projects (fixed order, sited at the central plaza, triggered by the
    // town-wide harvest), a co-op is born from ONE farmer noticing their own pain — a
    // long water haul — proposing a well near THEIR cluster, and recruiting the
    // neighbors who share it. Members gather the materials and dig together.

    // how far this farmer's home is from the nearest well THEY MAY DRAW FROM (the daily
    // pain) — a private well next door they have no rights to doesn't ease anything
    waterHaul(farmer) {
        const h = farmer.plot.house;
        return this.nearestUsableWell(farmer, h).dist;
    }

    // ---- well rights: private wells, negotiated access, tolls ---------------------

    wellKey(farmer, well) { return `${farmer.sheet.seed}@${well.i},${well.j}`; }
    canDraw(farmer, well) {
        if (!well.ready) return false;                          // an unfinished dig gives no water
        if (!well.owners) return true;                          // town wells are free
        if (well.owners.has(farmer.sheet.seed)) return true;    // part-owner
        return this.waterDeals.has(this.wellKey(farmer, well)); // or bought the rights
    }
    nearestUsableWell(farmer, from = null) {
        const pos = from || farmer.pos;
        let well = null, dist = 1e9;
        for (const wl of this.wells) {
            if (!this.canDraw(farmer, wl)) continue;
            const d = Math.abs(wl.i - pos.i) + Math.abs(wl.j - pos.j);
            if (d < dist) { dist = d; well = wl; }
        }
        return { well, dist };   // the free town well always qualifies, so well is never null
    }
    nearestClosedWell(farmer, from = null) {
        const pos = from || farmer.pos;
        let well = null, dist = 1e9;
        for (const wl of this.wells) {
            if (this.canDraw(farmer, wl)) continue;
            const d = Math.abs(wl.i - pos.i) + Math.abs(wl.j - pos.j);
            if (d < dist) { dist = d; well = wl; }
        }
        return well ? { well, dist } : null;
    }

    // A farmer eyeing a closer PRIVATE well asks its owners for drawing rights. The
    // answer comes from the owner's memories/opinion of the asker and their own course:
    // friends drink free, most owners set a crop-per-draws toll, sharp traders charge
    // more, and a lone wolf shares with no one.
    negotiateWellAccess(farmer, well) {
        const owner = this.farmers.find(f => well.owners.has(f.sheet.seed));
        if (!owner) return false;
        // a farmer would rather haul water the long way than beg a favour off someone they resent
        if (farmer.opinionOf(owner) <= -0.35) { farmer.say("I'd sooner haul it myself", '#e0a03c'); return false; }
        const op = owner.opinionOf(farmer);
        const key = this.wellKey(farmer, well);
        if (owner.goal === 'lone wolf' || op <= -0.2) {
            this.addLog(`${owner.sheet.name} turned ${farmer.sheet.name} away from their well`, '#c05840');
            farmer.adjustOpinion(owner, -0.15, 'turned me away from their well');
            farmer.say('fine. the long way, then', '#e0a03c');
            return false;
        }
        if (op >= 0.4) {
            this.waterDeals.set(key, { ownerSeed: owner.sheet.seed, per: 0, count: 0 });
            this.addLog(`${owner.sheet.name} lets ${farmer.sheet.name} draw freely from their well`, '#7dd069');
            farmer.adjustOpinion(owner, 0.2, 'shares their well with me freely');
            farmer.remember('event', `${owner.sheet.name.split(' ')[0]} lets me draw from their well for nothing`, owner, 0.9);
            return true;
        }
        const per = (owner.goal === 'sharp trader' || owner.sheet.personality.collaboration < 0.4) ? 5 : 8;
        this.waterDeals.set(key, { ownerSeed: owner.sheet.seed, per, count: 0 });
        this.addLog(`${owner.sheet.name} charges ${farmer.sheet.name} 1 crop per ${per} draws at their well`, '#e8c860');
        farmer.remember('job', `Pay ${owner.sheet.name.split(' ')[0]} 1 crop per ${per} draws for well rights`, owner, 0.9);
        owner.remember('job', `${farmer.sheet.name.split(' ')[0]} pays me 1 crop per ${per} draws at my well`, farmer, 0.9);
        return true;
    }

    // called on every draw from a well the farmer doesn't own — collects the agreed toll
    payWellToll(farmer, well) {
        if (!well.owners || well.owners.has(farmer.sheet.seed)) return;
        const deal = this.waterDeals.get(this.wellKey(farmer, well));
        if (!deal || deal.per <= 0) return;
        if (++deal.count < deal.per) return;
        deal.count = 0;
        const owner = this.farmers.find(f => f.sheet.seed === deal.ownerSeed);
        if (!owner) return;
        if (this.transferGood(farmer, owner, 'crops', 1) > 0) {
            farmer.say('-1 crop toll', '#e8c860');
        } else {
            owner.adjustOpinion(farmer, -0.1, "couldn't pay the well toll");
            farmer.remember('job', `Couldn't pay ${owner.sheet.name.split(' ')[0]}'s well toll - owe them`, owner, 0.7);
        }
    }

    farmerCoop(farmer) { return this.coops.find(c => c.members.has(farmer)); }

    // fellow farmers who share the pain: far from water AND living near the proposer
    #coopNeighbors(farmer) {
        const h = farmer.plot.house;
        return this.farmers.filter(o => o !== farmer &&
            this.waterHaul(o) >= FAR_WATER - 3 &&
            Math.abs(o.plot.house.i - h.i) + Math.abs(o.plot.house.j - h.j) <= 26);
    }

    // open, reachable ground near the middle of the needy cluster, far enough from
    // every existing well that the new one isn't redundant
    #findCoopWellSite(farmer, mates) {
        let ci = farmer.plot.house.i, cj = farmer.plot.house.j;
        for (const m of mates) { ci += m.plot.house.i; cj += m.plot.house.j; }
        ci = Math.round(ci / (mates.length + 1)); cj = Math.round(cj / (mates.length + 1));
        for (let tries = 0; tries < 120; tries++) {
            const a = this.rand() * Math.PI * 2, r = this.rand() * 8;
            const i = Math.round(ci + Math.cos(a) * r), j = Math.round(cj + Math.sin(a) * r);
            if (!this.isRevealed(i, j)) continue;   // dig only on charted open land
            if (this.get(i, j) !== T.GRASS) continue;
            let ok = true;
            for (const wl of this.wells) if (Math.abs(wl.i - i) + Math.abs(wl.j - j) < MIN_WELL_DIST) { ok = false; break; }
            if (ok) for (const p of this.plots) { for (let dj = -1; dj <= 1 && ok; dj++) for (let di = -1; di <= 1; di++) if (p.cells.has(pkey(i + di, j + dj))) { ok = false; break; } }
            if (ok) for (const st of this.structures) if (Math.abs(st.i - i) + Math.abs(st.j - j) < 4) { ok = false; break; }
            if (ok && this.board && Math.abs(this.board.i - i) + Math.abs(this.board.j - j) < 4) ok = false;
            if (ok && this.project?.site && Math.abs(this.project.site.i - i) + Math.abs(this.project.site.j - j) < 4) ok = false;
            if (!ok) continue;
            if (this.findPath(farmer.pos, { i, j }) === null) continue;   // must be reachable
            return { i, j };
        }
        return null;
    }

    proposeCoop(farmer) {
        if (this.coops.length) return null;                    // one neighborhood plan at a time
        // prefer neighbors who share the pain; an odd-man-out with watered neighbors can
        // still pitch a plan — recruitment (#coopRecruit) will sweeten someone into it
        const mates = this.#coopNeighbors(farmer);
        const h = farmer.plot.house;
        const anchors = mates.length ? mates : this.farmers.filter(o => o !== farmer &&
            Math.abs(o.plot.house.i - h.i) + Math.abs(o.plot.house.j - h.j) <= 34);   // ring homesteads sit ~28 apart
        if (!anchors.length) return null;                      // truly alone out there
        const site = this.#findCoopWellSite(farmer, anchors);
        if (!site) return null;
        const coop = {
            type: 'well', label: 'SHARED WELL', site, proposer: farmer,
            members: new Set([farmer]), stage: 'rally', bornDay: this.day,
            needWood: COOP_WELL.needWood, needOre: COOP_WELL.needOre, wood: 0, ore: 0,
            points: 0, needed: COOP_WELL.needed, builders: new Set(),
        };
        this.coops.push(coop);
        farmer.think("THE WELL'S A LONG HAUL - WE SHOULD DIG OUR OWN");
        farmer.say('a well of our own!', '#8fc7e8');
        this.addLog(`${farmer.sheet.name} proposed a shared well for their side of town`, '#8fc7e8');
        return coop;
    }

    // Truly alone out on the frontier — no neighbour close enough to share a dig. A settler this
    // isolated (the lone wolves who struck out into the wilds) sinks a PRIVATE well of their own.
    soloCandidate(farmer) {
        const h = farmer.plot.house;
        return !this.farmers.some(o => o !== farmer && Math.abs(o.plot.house.i - h.i) + Math.abs(o.plot.house.j - h.j) <= 34);
    }
    digSoloWell(farmer) {
        if (this.coops.length) return null;                    // one well plan at a time, town-wide
        const site = this.#findCoopWellSite(farmer, []);       // near their own homestead
        if (!site) return null;
        const coop = {
            type: 'well', label: 'PRIVATE WELL', site, proposer: farmer, solo: true,
            members: new Set([farmer]), stage: 'gather', bornDay: this.day,   // no rally — dig alone
            needWood: COOP_WELL.needWood, needOre: COOP_WELL.needOre, wood: 0, ore: 0,
            points: 0, needed: COOP_WELL.needed, builders: new Set(),
        };
        this.coops.push(coop);
        farmer.think("NO NEIGHBORS OUT HERE — I'LL SINK MY OWN WELL");
        farmer.say('a well of my own!', '#8fc7e8');
        this.addLog(`${farmer.sheet.name} began sinking a private well out on the frontier`, '#8fc7e8');
        return coop;
    }

    // a neighbor with the same long haul signs on; the plan activates at 2 members
    joinCoop(farmer) {
        const coop = this.coops[0];
        if (!coop || coop.members.has(farmer)) return false;
        if (this.waterHaul(farmer) < FAR_WATER - 3) return false;       // their haul is fine — no reason to dig
        const h = farmer.plot.house;
        if (Math.abs(coop.site.i - h.i) + Math.abs(coop.site.j - h.j) > 26) return false;   // too far away to benefit
        if (farmer.effCollab() < 0.2) return false;                    // the true loners (and the out-of-sorts) sit it out
        if (farmer.opinionOf(coop.proposer) <= -0.3) return false;     // won't share a well with someone they resent
        if (coop.proposer.opinionOf(farmer) <= -0.3) return false;     // and the proposer wouldn't want them either
        coop.members.add(farmer);
        farmer.say('count me in!', '#8fc7e8');
        this.addLog(`${farmer.sheet.name} joined ${coop.proposer.sheet.name}'s well plan (${coop.members.size} hands)`, '#8fc7e8');
        if (coop.stage === 'rally' && coop.members.size >= 2) {
            coop.stage = 'gather';
            this.addLog('The shared well has enough hands - the digging begins!', '#f0d060');
        }
        return true;
    }

    coopNeedsMaterials(coop) { return coop.wood < coop.needWood || coop.ore < coop.needOre; }

    // a member drops off what they carry at the site
    depositCoop(farmer, coop) {
        let gave = 0;
        const nw = Math.min(farmer.wood, coop.needWood - coop.wood);
        if (nw > 0) { farmer.wood -= nw; coop.wood += nw; gave += nw; }
        const no = Math.min(farmer.ore, coop.needOre - coop.ore);
        if (no > 0) { farmer.ore -= no; coop.ore += no; gave += no; }
        if (gave > 0) {
            farmer.say(`+${gave} for the well`, '#8fc7e8');
            if (!this.coopNeedsMaterials(coop) && coop.stage === 'gather') {
                coop.stage = 'build';
                this.addLog('Materials stacked at the well site - time to dig!', '#f0d060');
            }
        }
        return gave;
    }

    contributeCoop(farmer, dt) {
        const coop = this.coops[0];
        if (!coop || coop.stage !== 'build') return;
        coop.builders.add(farmer);
        coop.points += dt * (1 + Math.max(0, mod(farmer.sheet.stats.str)) * 0.2) * this.workMult;
        if (coop.points >= coop.needed) this.#completeCoop(coop);
    }

    #completeCoop(coop) {
        this.coops = this.coops.filter(c => c !== coop);
        const { site } = coop;
        this.structures.push({ type: 'well2', i: site.i, j: site.j });
        this.set(site.i, site.j, T.STRUCT);
        const crew = new Set([...coop.members, ...coop.builders]);
        // the crew OWNS this well — outsiders must negotiate drawing rights (see negotiateWellAccess).
        // ready is set ONLY here, at completion: an in-progress dig is never a water source.
        this.wells.push({ i: site.i, j: site.j, ready: true, owners: new Set([...crew].map(f => f.sheet.seed)) });
        if (coop.solo) this.addLog(`${coop.proposer.sheet.name} finished a private well out on the frontier.`, '#f0d060');
        else this.addLog(`The neighbors' shared well is finished - shorter hauls for ${coop.members.size} farms!`, '#f0d060');
        for (const f of crew) {
            f.gainXP(8); f.say(coop.solo ? 'MY OWN WELL!' : 'OUR WELL!', '#f0d060'); f.sparkle = 3;
            f.remember('event', coop.solo ? 'Sank my own well out here - no more hauling to the distant plaza'
                                          : 'We dug our own well - no more long hauls to the plaza', null, 1.1);
            for (const g of crew) if (g !== f && this.rand() < 0.75) { this.addBond(f, g); f.adjustOpinion(g, 0.2, 'dug our well together'); }
        }
    }

    // A rally nobody joined out of shared need gets one last shot: the proposer SWEETENS
    // the deal, recruiting a neighbor who has no water pain of their own by promising a
    // cut of future harvests (a real transfer, tracked in shareDeals). Friends and good
    // neighbors dig for free; sharp traders and the ambitious want the bigger cut.
    #coopRecruit(coop) {
        const prop = coop.proposer;
        const near = this.farmers
            .filter(o => !coop.members.has(o) &&
                Math.abs(o.plot.house.i - coop.site.i) + Math.abs(o.plot.house.j - coop.site.j) <= 34)
            .sort((a, b) => (Math.abs(a.plot.house.i - coop.site.i) + Math.abs(a.plot.house.j - coop.site.j)) -
                (Math.abs(b.plot.house.i - coop.site.i) + Math.abs(b.plot.house.j - coop.site.j)));
        for (const o of near) {
            const p = o.sheet.personality;
            if (o.goal === 'lone wolf' || o.opinionOf(prop) <= -0.2 || prop.opinionOf(o) <= -0.3 || o.effCollab() < 0.2) continue;
            const gratis = o.goal === 'good neighbor' || o.opinionOf(prop) >= 0.4;
            const per = gratis ? 0 : (o.goal === 'sharp trader' || p.competitiveness > 0.6) ? 3 : 5;
            coop.members.add(o);
            if (per > 0) {
                this.shareDeals.push({ payerSeed: prop.sheet.seed, payeeSeed: o.sheet.seed, per, count: 0, untilDay: this.day + SEASON_LENGTH * 2 });
                this.addLog(`${prop.sheet.name} sweetened the deal: ${o.sheet.name} joins the dig for 1 crop per ${per} harvests`, '#e8c860');
                prop.remember('job', `Promised ${o.sheet.name.split(' ')[0]} 1 crop per ${per} harvests to help dig my well`, o, 1.0);
                o.remember('job', `Digging ${prop.sheet.name.split(' ')[0]}'s well for a cut: 1 crop per ${per} harvests`, prop, 1.0);
                o.say('for a cut? sure', '#e8c860');
            } else {
                this.addLog(`${o.sheet.name} joins ${prop.sheet.name}'s dig - no charge between neighbors`, '#7dd069');
                o.say('happy to help', '#7dd069');
                prop.adjustOpinion(o, 0.2, 'helped dig my well for nothing');
            }
            if (coop.members.size >= 2) {
                coop.stage = 'gather';
                this.addLog('The shared well has enough hands - the digging begins!', '#f0d060');
            }
            return true;
        }
        return false;
    }

    // pay out standing harvest-share promises from this grower's take
    payHarvestShares(farmer, yieldN) {
        if (yieldN <= 0) return;
        for (const d of this.shareDeals) {
            if (d.payerSeed !== farmer.sheet.seed) continue;
            d.count += yieldN;
            while (d.count >= d.per) {
                d.count -= d.per;
                const payee = this.farmers.find(f => f.sheet.seed === d.payeeSeed);
                if (!payee) break;
                if (this.transferGood(farmer, payee, 'crops', 1) > 0) {
                    farmer.say('-1 crop share', '#e8c860'); payee.say('+1 crop share', '#e8c860');
                } else {
                    payee.adjustOpinion(farmer, -0.08, 'behind on our harvest share');
                    break;
                }
            }
        }
    }

    // a rally that never drew a second pair of hands first tries a sweetened recruit,
    // then fizzles; a dig that can't finish (materials nowhere to be found) is abandoned
    // after a while so it doesn't block the next neighborhood plan forever
    #tickCoops() {
        this.coops = this.coops.filter(c => {
            if (c.stage === 'rally' && this.day - c.bornDay >= 1 && c.members.size < 2 && this.#coopRecruit(c)) return true;
            if (c.stage === 'rally' && this.day - c.bornDay >= COOP_RALLY_DAYS) {
                this.addLog(`${c.proposer.sheet.name}'s well plan fizzled - nobody else signed on`, '#8a8fa0');
                return false;
            }
            if (c.stage !== 'rally' && this.day - c.bornDay >= COOP_STALL_DAYS) {
                this.addLog(`The shared well at ${c.site.i},${c.site.j} was abandoned - the dig stalled out`, '#8a8fa0');
                return false;
            }
            return true;
        });
        // share promises run their course after two seasons
        this.shareDeals = this.shareDeals.filter(d => {
            if (this.day <= d.untilDay) return true;
            const payer = this.farmers.find(f => f.sheet.seed === d.payerSeed);
            const payee = this.farmers.find(f => f.sheet.seed === d.payeeSeed);
            if (payer && payee) this.addLog(`${payer.sheet.name}'s harvest-share promise to ${payee.sheet.name} has run its course`, '#8a8fa0');
            return false;
        });
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
        // offer what they can most SPARE: lots on hand + low personal need for it
        pools.sort((a, b) => (b.have / farmer.goodValue(b.good)) - (a.have / farmer.goodValue(a.good)));
        const pick = pools.find(pl => pl.have > 0);
        if (!pick) return null;
        const fair = difficulty * 0.7;
        // learned strategy: a poster whose jobs keep getting haggled or passed over learns
        // to open closer to fair; one whose offers are always snapped up learns they can
        // shade a little lower. Needs a few data points before any adjustment.
        const st = farmer.jobStats;
        const outcomes = st.accepted + st.haggled + st.declined;
        let learned = 0;
        if (outcomes >= 3) {
            const friction = (st.haggled + st.declined * 1.5) / outcomes;
            if (friction > 0.5) {
                learned = 0.25;
                if (!st.wisedUp) { st.wisedUp = true; farmer.remember('lesson', 'My lowball offers keep getting haggled or ignored - opening fair gets help faster', null, 1.1); }
            } else if (friction < 0.15 && st.accepted >= 3) {
                learned = -0.08;
                if (!st.shrewd) { st.shrewd = true; farmer.remember('lesson', 'Every offer I post gets snapped up - I can afford to offer a touch less', null, 1.0); }
            }
        }
        if (farmer.goal === 'sharp trader') learned -= 0.06;   // squeezes every deal on principle
        const offer = Math.max(1, Math.min(pick.have, Math.round(fair * (0.5 + learned + p.collaboration * 0.4 + p.honesty * 0.3))));
        const max = Math.max(offer, Math.min(pick.have, Math.round(fair * (0.9 + Math.max(0, learned) + p.honesty * 0.5))));
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
        else if (good === 'crops') { from.sheet.produce -= n; spendCropStock(from.sheet, n); to.sheet.produce = (to.sheet.produce || 0) + n; }
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
        const hc = helper.effCollab();   // today's MOOD-adjusted teamwork — swings for the mercurial
        // consider warm names first: a helper's memories of past dealings decide whose
        // posting gets looked at — so some bonds deepen while others never form
        const order = [...this.helpBoard].sort((a, b) => helper.opinionOf(b.farmer) - helper.opinionOf(a.farmer));
        for (const req of order) {
            if (req.farmer === helper) continue;
            // a lone wolf keeps to their own rows — never works another's land (consistent
            // with never posting for help or joining a co-op)
            if (helper.goal === 'lone wolf') continue;
            const op = helper.opinionOf(req.farmer);          // how the helper feels about the poster
            if (op <= -0.35 && hc < 0.85) continue;   // won't lift a finger for someone they resent
            if (req.farmer.opinionOf(helper) <= -0.35) continue;   // ...and the poster won't accept a resented hand either
            if (req.farmer.reputation < 0.3 && op < 0.2 && this.rand() > hc) continue;   // shun bad names (unless a personal friend)
            const friend = op >= 0.4;
            const altruist = friend || hc > 0.7 || helper.goal === 'good neighbor' || (helper.sheet.stats.cha >= 15 && hp.honesty > 0.5);
            const good = req.reward ? req.reward.good : 'crops';
            const gv = helper.goodValue(good);                 // a good the helper NEEDS is worth more per unit
            const offered = req.reward ? req.reward.offer : 0;
            // what the helper wants to be paid, in WORTH: shaped by personality + how they feel
            // about the poster (friends work for less, the barely-tolerated cost more). A good the
            // helper is already flush in drives a HARDER bargain (not an outright refusal) — a
            // generous enough offer can still tempt them.
            let askWorth = req.difficulty * (0.5 + hp.competitiveness * 0.5 - hc * 0.3 - op * 0.4);
            if (gv < 0.8 && !altruist) askWorth *= 1.7;
            if (helper.goal === 'sharp trader') askWorth *= 1.2;   // their labor is never cheap
            if (altruist || offered * gv >= askWorth || !req.reward) {
                this.helpBoard.splice(this.helpBoard.indexOf(req), 1);
                // the poster learns their opening offer was good enough
                req.farmer.jobStats.accepted++;
                if (req.reward) {
                    req.farmer.remember('job', `${helper.sheet.name.split(' ')[0]} took my job at ${offered} ${this.goodLabel(good)}`, helper, 0.55);
                    helper.remember('job', `Worked ${req.farmer.sheet.name.split(' ')[0]}'s farm for ${offered} ${this.goodLabel(good)}`, req.farmer, 0.5);
                }
                return { req, agreed: req.reward ? { good, amount: offered } : null };
            }
            const askUnits = Math.max(1, Math.ceil(askWorth / gv));   // enough units of THIS good to be worth it
            if (askUnits <= req.reward.max) {   // counteroffer within the poster's ceiling
                this.addLog(`${helper.sheet.name} haggled ${req.farmer.sheet.name} up to ${askUnits} ${this.goodLabel(good)}`, '#c9a45a');
                this.helpBoard.splice(this.helpBoard.indexOf(req), 1);
                // the poster learns lowballing got them haggled; the haggler learns it worked
                req.farmer.jobStats.haggled++;
                req.farmer.remember('job', `${helper.sheet.name.split(' ')[0]} haggled me up to ${askUnits} ${this.goodLabel(good)}`, helper, 0.65);
                helper.remember('job', `Haggled ${req.farmer.sheet.name.split(' ')[0]} up to ${askUnits} ${this.goodLabel(good)} - it worked`, req.farmer, 0.6);
                return { req, agreed: { good, amount: askUnits } };
            }
            // reward not worth it for a good they don't need — decline and consider the next.
            // Count the pass ONCE per helper per posting so the poster can learn from it.
            req.passed = req.passed || new Set();
            if (!req.passed.has(helper)) { req.passed.add(helper); req.farmer.jobStats.declined++; }
        }
        return null;
    }

    clearHelp(farmer) { this.helpBoard = this.helpBoard.filter(r => r.farmer !== farmer); }

    // ---- weather -----------------------------------------------------------------

    #rollWeather() {
        const table = WEATHER_STATES[this.weather].next;
        const seasonBias = this.seasonDef.weather;
        const blended = {}; let sum = 0;
        for (const [state, w] of Object.entries(table)) {
            const bias = seasonBias[state];
            if (bias === 0) continue;   // season hard-excludes it (no storms in winter, no blizzards otherwise)
            let v = w * (0.4 + (bias ?? 1));
            if (state === 'rain') v *= this.rainBoost;   // the statues call the rains oftener
            blended[state] = v; sum += v;
        }
        let r = this.rand() * sum;
        for (const [state, w] of Object.entries(blended)) { r -= w; if (r <= 0) { this.#setWeather(state); return; } }
        this.#setWeather('cloud');   // fallback if everything was excluded
    }

    #setWeather(state) {
        this.weather = state;
        const [lo, hi] = WEATHER_STATES[state].dur;
        this.weatherTimer = lo + this.rand() * (hi - lo);
        const colors = { sun: '#f0d060', cloud: '#9aa0b4', rain: '#6a9ade', storm: '#c05840', blizzard: '#bcd8ec', drought: '#e0a03c' };
        this.addLog(`Weather: ${WEATHER_STATES[state].label}`, colors[state]);
    }

    get weatherLabel() { return WEATHER_STATES[this.weather].label; }

    // ---- crops -------------------------------------------------------------------

    cropAt(i, j) { return this.crops.get(`${i},${j}`); }
    // Which crop a given field tile grows: drawn from the owner's palette by a stable per-tile hash,
    // so a farm shows steady patches of several crops (not one mono-culture) and it never changes
    // under a tile between plantings. Deterministic — no world.rand.
    cropForField(owner, i, j) {
        const cs = owner.sheet.crops && owner.sheet.crops.length ? owner.sheet.crops : [owner.sheet.crop];
        return cs[tileHash(i, j, owner.sheet.seed) % cs.length];
    }
    plantCrop(i, j, type, owner) {
        this.crops.set(`${i},${j}`, {
            i, j, type, owner, stage: 0, growth: 0, water: 0.7, withered: false, dryTime: 0,
            fastGrow: type === 'beanstalk' ? 0.5 : 1,   // bean stalks race up in half the time (but yield half the value)
            wateredAt: this.time,
            waterDecayMul: 0.88 + tileRand(i, j, this.seed + 501) * 0.24,
            rainAbsorbMul: 0.85 + tileRand(i, j, this.seed + 502) * 0.3,
        });
    }

    #tickCrops(dt) {
        const growthBonus = { sun: 1.15, cloud: 1, rain: 1.2, storm: 0.6, drought: 0.55 }[this.weather];
        const season = this.seasonDef;
        // tuned so a crop watered to full dries out over ~1 in-game day (≈380s) under clear
        // spring skies — hotter summer sun dries faster, cloud holds moisture longer, drought
        // fastest, rain never. So a tended field wants watering about once a day.
        const waterDecay = { sun: 0.0028, cloud: 0.0015, rain: 0, storm: 0, drought: 0.0058 }[this.weather] * season.waterMul;
        const night = this.isNight();
        const raining = this.weather === 'rain' || this.weather === 'storm';
        for (const crop of this.crops.values()) {
            if (crop.withered) continue;
            if (raining) {
                // guardian statues deepen the soak — rain waters the fields harder
                const rainGain = (this.weather === 'storm' ? 0.055 : 0.032) * (crop.rainAbsorbMul || 1) * this.rainBoost;
                crop.water = Math.min(1, crop.water + rainGain * dt);
                crop.dryTime = 0;
            } else {
                crop.water = Math.max(0, crop.water - waterDecay * (crop.waterDecayMul || 1) * dt);
            }
            if (!raining && crop.water <= 0.02) {
                crop.dryTime += dt;
                if (crop.dryTime > 14 && this.rand() < dt * 0.05) {
                    crop.withered = true;
                    this.addLog(`A ${crop.type} withered on ${crop.owner.sheet.name}'s farm`, '#e0a03c');
                    continue;
                }
            } else crop.dryTime = 0;
            if (!night && crop.stage < 3 && this.canGarden()) {
                // paced timeline from sowing: seed->sprout ~2 days (48h), sprout->grow ~3 days,
                // grow->ripe ~1 day, so a crop ripens about day 6 under good care. BEAN STALKS grow
                // in half the time (crop.fastGrow). Water/weather/int/season modulate around this.
                const greenThumb = 1 + mod(crop.owner.sheet.stats.int) * 0.06;
                const waterFactor = 0.35 + 0.65 * crop.water;
                crop.growth += (dt / DAY_LENGTH) * waterFactor * growthBonus * greenThumb * this.growthMult * season.growth;
                const need = CROP_STAGE_DAYS[crop.stage] * (crop.fastGrow || 1);
                if (crop.growth >= need) { crop.growth = 0; crop.stage++; }
            }
        }
    }

    // ---- producers (facility animals / pond life) --------------------------------

    #tickProducers(dt) {
        const season = this.seasonDef;
        const stormy = this.weather === 'storm';
        const night = this.isNight();
        // NOTE: the winter pond "freeze" is render-only — the terrain layer draws ice and the
        // fish/lily-pad sprites are hidden (main.js), while producers keep ticking under the ice so
        // the pond simply reveals its accumulated catch come spring (no dead winter economy).
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
                    // Movement. Land animals (poultry/livestock) roam the WHOLE fenced yard by
                    // day and retire into their coop/barn at night; pond life stays in the water.
                    const landAnimal = cfg.wander && p.kind !== 'fish' && p.kind !== 'pad';
                    if (landAnimal) {
                        // Never occupy a blocked/unowned tile. This runs EVERY tick (even when busy
                        // or storm-frozen) so an animal is rescued if a pond/coop was carved under
                        // it, it was claimed by a collector on bad ground, or it spawned on the barn
                        // tile — the doorway where a tucked-in animal is parked is itself valid, so
                        // sleeping animals are left alone (Codex #2, Opus Area 4).
                        if (!p.inside && !this.#producerCanStand(plot, p.fx, p.fy)) {
                            const spot = this.#nearestYardTile(plot, p.fx, p.fy);
                            if (spot) { p.fx = spot.i + 0.5; p.fy = spot.j + 0.5; p.vx = 0; p.vy = 0; }
                        }
                        if (night && fac.struct) {
                            // dusk: walk to the doorway and tuck in — happens rain, shine OR STORM,
                            // so a stormy night never strands the flock outside (Codex #3). Only step
                            // onto valid ground; if the way is blocked (pond/rock between), just tuck
                            // in rather than tramp across water.
                            const tx = fac.struct.i + 0.5, ty = fac.struct.j + 1.1;
                            const dx = tx - p.fx, dy = ty - p.fy, d = Math.hypot(dx, dy) || 1;
                            if (p.inside || d < 0.45) { p.inside = true; p.fx = tx; p.fy = ty; p.vx = 0; p.vy = 0; }
                            else {
                                const spd = 0.7, nx = p.fx + (dx / d) * spd * dt, ny = p.fy + (dy / d) * spd * dt;
                                if (this.#producerCanStand(plot, nx, ny)) { p.fx = nx; p.fy = ny; p.flip = dx > 0 ? 1 : -1; }
                                else { p.inside = true; p.fx = tx; p.fy = ty; p.vx = 0; p.vy = 0; }
                            }
                        } else if (!p.busy && !stormy) {
                            if (p.inside) p.inside = false;   // morning: come out of the building
                            p.wanderT -= dt;
                            if (p.wanderT <= 0) {
                                const poultry = p.kind === 'chicken' || p.kind === 'rooster';
                                if (poultry) {
                                    // hens dart and peck — quick hops, short pauses
                                    p.wanderT = 0.6 + this.rand() * 1.8;
                                    const ang = this.rand() * Math.PI * 2;
                                    p.vx = Math.cos(ang) * 0.5; p.vy = Math.sin(ang) * 0.5;
                                    p.hop = 0.35;
                                } else if (this.rand() < 0.72) {
                                    // cattle/sheep/pigs GRAZE: mostly they just stand and chew,
                                    // holding one spot for a long, contented while
                                    p.wanderT = 6 + this.rand() * 14;
                                    p.vx = 0; p.vy = 0;
                                } else {
                                    // ...then drift a slow step or two to fresher grass
                                    p.wanderT = 1.6 + this.rand() * 2.4;
                                    const ang = this.rand() * Math.PI * 2;
                                    p.vx = Math.cos(ang) * 0.11; p.vy = Math.sin(ang) * 0.11;
                                }
                                if (Math.abs(p.vx) > 0.02) p.flip = p.vx > 0 ? 1 : -1;
                            }
                            const px = p.fx, py = p.fy;
                            p.fx += p.vx * dt; p.fy += p.vy * dt;
                            // stay inside the fenced yard, off water/buildings/rocks
                            const bx0 = plot.x + 0.4, bx1 = plot.x + plot.w - 0.4, by0 = plot.y + 0.4, by1 = plot.y + plot.h - 0.4;
                            if (p.fx < bx0) { p.fx = bx0; p.vx = Math.abs(p.vx); }
                            if (p.fx > bx1) { p.fx = bx1; p.vx = -Math.abs(p.vx); }
                            if (p.fy < by0) { p.fy = by0; p.vy = Math.abs(p.vy); }
                            if (p.fy > by1) { p.fy = by1; p.vy = -Math.abs(p.vy); }
                            if (!this.#producerCanStand(plot, p.fx, p.fy)) { p.fx = px; p.fy = py; p.vx = -p.vx; p.vy = -p.vy; }
                            if (p.hop > 0) p.hop = Math.max(0, p.hop - dt);
                        }
                    } else if (cfg.wander && !p.busy && !(stormy && p.kind !== 'fish')) {
                        // pond life (fish/lily): stays in the water region
                        p.wanderT -= dt;
                        if (p.wanderT <= 0) {
                            p.wanderT = 0.6 + this.rand() * 1.8;
                            const ang = this.rand() * Math.PI * 2;
                            const spd = p.kind === 'fish' ? 0.35 : 0.28;
                            p.vx = Math.cos(ang) * spd; p.vy = Math.sin(ang) * spd;
                            if (Math.abs(p.vx) > 0.02) p.flip = p.vx > 0 ? 1 : -1;
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

    // a roaming animal may stand on an owned yard tile that isn't water/a building/a rock
    #producerCanStand(plot, fx, fy) {
        const i = Math.floor(fx), j = Math.floor(fy);
        return plot.cells.has(pkey(i, j)) && !this.pathBlocked(i, j);
    }
    // nearest owned, walkable yard tile — where a stranded animal (on a coop/barn tile) hops to
    #nearestYardTile(plot, fx, fy) {
        let best = null, bd = Infinity;
        for (const key of plot.cells) {
            const c = key.indexOf(','), i = +key.slice(0, c), j = +key.slice(c + 1);
            if (this.pathBlocked(i, j)) continue;
            const d = Math.abs(i + 0.5 - fx) + Math.abs(j + 0.5 - fy);
            if (d < bd) { bd = d; best = { i, j }; }
        }
        return best;
    }

    plotOwnerOf(plot) { return this.farmers.find(f => f.plot === plot); }

    #tickLightning(dt) {
        this.lightningFlash = Math.max(0, this.lightningFlash - dt * 3);
        // Always fade out an active strike bolt, no matter the current weather. (This used to
        // live after the `weather !== 'storm'` early-return, so a bolt set just before a storm
        // cleared would hang on screen as a stuck vertical line until the next storm.)
        if (this.struckTile) { this.struckTile.t -= dt * 1.5; if (this.struckTile.t <= 0) this.struckTile = null; }
        // blizzard: frequent soft whiteout gusts instead of lightning strikes (no crop damage)
        if (this.weather === 'blizzard') {
            this.lightningTimer -= dt;
            if (this.lightningTimer <= 0) {
                this.lightningTimer = 1.4 + this.rand() * 2.6;
                this.lightningFlash = Math.max(this.lightningFlash, 0.5);
            }
            return;
        }
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
                    // the town learns from the storms just as a farmer learns from an illness:
                    // every crop lost while no full guardian wards the sky is remembered, and it
                    // pulls the monument forward + sends the struck farmer to help raise it.
                    if (this.lightningMult > 0.25) {
                        this.stormLosses++;
                        crop.owner.stormLosses++;
                        crop.owner.recordStormLoss(crop.type);
                    }
                }
            }
        }
    }

    // Broken ground is an investment — use it or lose it. Tilled dirt that's sat empty (no crop)
    // for 5+ days reverts to plain grass (the season re-colors it), so a farmer who tills more
    // than they sow doesn't leave a permanent scar of bare dirt. Iterates only the tilled tiles
    // we're tracking (bounded — they only exist on plots), never the infinite plane.
    #decayTilled() {
        if (!this.tilledAt.size) return;
        const toRevert = [], toDrop = [];   // collect first — don't mutate the map mid-iteration
        for (const [k, day] of this.tilledAt) {
            const c = k.indexOf(','), i = +k.slice(0, c), j = +k.slice(c + 1);
            if (this.get(i, j) !== T.TILLED) { toDrop.push(k); continue; }   // tile became something else
            if (this.cropAt(i, j)) continue;                                 // a crop is using it — clock paused
            if (this.day - day >= 5) toRevert.push({ i, j });
        }
        for (const k of toDrop) this.tilledAt.delete(k);
        for (const { i, j } of toRevert) this.set(i, j, T.GRASS);            // set() drops the entry + redraws
        if (toRevert.length) for (const p of this.plots) this.#rebuildFields(p);
    }

    #dailyHealthCheck() {
        for (const f of this.farmers) {
            if (f.downed) {   // felled by a foe — back on their feet at home after 3 days (NOT sickness)
                if (this.day >= f.reviveDay) {
                    f.downed = false; f.health = 'healthy'; f.energy = 0.6; f.hp = Math.max(1, Math.round(f.maxHp * 0.25)); f.state = 'decide';   // back on their feet but FRAIL — rest + meat to mend
                    const home = f.plot && f.plot.sited ? this.houseDoor(f.plot) : { i: CENTER, j: CENTER };
                    f.pos = { i: home.i, j: home.j };
                    this.addLog(`${f.sheet.name} picked themselves back up and is home, wiser for it.`, '#7dd069');
                    f.say('...I LIVE.', '#7dd069');
                }
                f.workedLate = false; continue;
            }
            if (f.health === 'sick') {
                f.sickDays -= 1;
                f.nightsExposed = Math.max(0, f.nightsExposed - 1);   // recovering eases the exposure count
                if (f.sickDays <= 0) {
                    f.health = 'healthy'; f.energy = Math.max(f.energy, 0.5); f.hp = Math.max(f.hp, f.maxHp * 0.6);
                    this.addLog(`${f.sheet.name} recovered and is back on their feet.`, '#7dd069');
                    f.say('ALL BETTER!', '#7dd069');
                }
                f.workedLate = false; continue;
            }
            if (f.workedLate) f.sleepDebt += 1.5; else f.sleepDebt = Math.max(0, f.sleepDebt - 1);
            f.workedLate = false;
            // sleeping rough with no roof is a health hazard that WORSENS the longer they go
            // without a home: a fresh settler gets a night or two, then exposure bites hard —
            // strong pressure to raise a tipi fast, without an instant town-wide sick-out.
            const homeless = f.plot.built.level === 0;
            f.nightsExposed = homeless ? f.nightsExposed + 1 : 0;
            const exposure = homeless ? Math.min(9, (f.nightsExposed - 1) * 3) : 0;   // night 1 free, then +3/+6/+9
            const risky = (homeless && f.nightsExposed >= 2) || f.energy < 0.35 || f.sleepDebt >= 3 || f.strain >= 4;
            if (risky) {
                const dc = 10 + Math.floor(f.sleepDebt) + (f.energy < 0.2 ? 3 : 0) + Math.floor(f.strain / 3) + exposure;
                const save = d20(this.rand, mod(f.sheet.stats.con));
                const exposed = exposure > 0;
                if (save.total < dc && !save.crit) {
                    f.fallIll(2 + Math.floor(this.rand() * 3) + (f.strain >= 8 ? 2 : 0) + (exposed ? 1 : 0), exposed ? 'sleeping out in the cold' : 'overworking');
                    this.addLog(exposed ? `${f.sheet.name} took ill from sleeping out in the cold! (CON ${save.total} vs DC ${dc})` : `${f.sheet.name} fell ill from overwork! (CON ${save.total} vs DC ${dc})`, '#c05840');
                    f.say(exposed ? 'I need a roof...' : 'I... dont feel well', '#c05840');
                } else if (exposed) this.addLog(`${f.sheet.name} shivered through another roofless night (CON ${save.total} vs ${dc})`, '#e0a03c');
                else if (f.sleepDebt >= 2 || f.strain >= 5) this.addLog(`${f.sheet.name} looks worn out but powers through (CON ${save.total} vs ${dc})`, '#e0a03c');
            }
            f.strain = Math.max(0, f.strain - 4);   // a night's rest works off most of the strain
            // a personal run of storm losses fades if the sky stops singling them out (the town's
            // collective tally persists until the guardian actually goes up)
            if (f.stormLosses > 0) f.stormLosses = f.stormLosses > 0.4 ? f.stormLosses * 0.85 : 0;
            if (f.donateCooldown > 0) f.donateCooldown -= 1;   // the itch to give the town a hand returns
            // opinions fade toward neutral over time — old grudges soften, gratitude cools
            for (const [k, v] of f.opinions) { const nv = v * 0.9; if (Math.abs(nv) < 0.03) { f.opinions.delete(k); f.opinionReasons && f.opinionReasons.delete(k); } else f.opinions.set(k, nv); }
            // journal decay: each memory fades at its kind's rate; the faint are forgotten
            f.journal = f.journal.filter(m => (m.strength *= (JOURNAL_DECAY[m.kind] || 0.96)) > JOURNAL_FORGET);
            f.reflect();   // a new day: reread the journal, maybe set a new course
        }
    }

    // ---- main tick ---------------------------------------------------------------

    tick(dt) {
        this.time += dt;
        this.clock += dt;
        if (this.clock >= DAY_LENGTH + NIGHT_LENGTH) {
            const endedDay = this.day, endedSeason = this.season;   // capture before the rollover mutates them
            this.clock = 0; this.day++;
            // age out expired fishing-spot cooldowns so the map doesn't accumulate stale entries forever
            for (const [k, d] of this.fishedAt) if (this.day - d > FISH_COOLDOWN) this.fishedAt.delete(k);
            this.#dailyHealthCheck();
            this.#advanceSeason();
            this.#decayTilled();
            this.#regrowWild();
            this.#encroach();
            this.#maybeSpawnTreasure();
            this.#tickCoops();
            this.#maybeHatchRooster();
            this.addLog(`Day ${this.day} begins on Ry Farms`, '#f0d060');
            // END-OF-DAY RECAP: gather the day's notable beats (from the chronicle) + the harvest tally,
            // so the UI can surface what happened in a self-playing town where the action is off-screen.
            const beats = this.chronicle.filter(e => e.day === endedDay);
            const harvest = Math.max(0, Math.round(this.harvestTotal - this._dayHarvestStart));
            this._dayHarvestStart = this.harvestTotal;
            const downed = this.farmers.filter(f => f.downed).length;
            this.dayRecap = { day: endedDay, season: endedSeason, beats, harvest, downed, seq: (this._recapSeq = (this._recapSeq || 0) + 1) };
            // NB: weather is NOT force-rerolled at the day boundary any more — it changes only when
            // its (now day-spanning) timer runs out, so spells can persist across several days.
        }
        this.weatherTimer -= dt;
        if (this.weatherTimer <= 0) this.#rollWeather();
        if (this.townLevelFlash > 0) this.townLevelFlash -= dt;   // UI-only level-up pulse
        this.#tickCrops(dt);
        this.#tickProducers(dt);
        this.#tickLightning(dt);
        this.#tickBirds(dt);
        this.#tickTreasure(dt);
        this.#maybeStartProject();
        this.#tickMerchant(dt);
        this.#tickDM(dt);
        this.#tickPrey(dt);
        this.updateLeader();
        for (const f of this.farmers) f.tick(dt);
    }

    // ---- Wandering merchant: schedule, travel in/out, and the goods-for-ore trade ----
    // ---- Wild game: roaming prey to hunt ----------------------------------------------------

    // Nearest huntable prey within maxD tiles of pos (skips one already being run down by someone else).
    nearestPrey(pos, maxD = 12) {
        let best = null, bestD = maxD;
        for (const a of this.prey) {
            if (a.done || (a.hunter && a.hunter.state === 'hunt')) continue;
            const d = Math.hypot(a.i - pos.i, a.j - pos.j);
            if (d < bestD) { bestD = d; best = a; }
        }
        return best;
    }

    #tickPrey(dt) {
        for (const a of this.prey) this.#advancePrey(a, dt);
        if (this.prey.some(a => a.done)) this.prey = this.prey.filter(a => !a.done);
        this.preyCooldown -= dt;
        if (this.preyCooldown > 0 || this.prey.length >= MAX_PREY) return;
        this.preyCooldown = PREY_SPAWN_INTERVAL + this.rand() * PREY_SPAWN_JITTER;
        this.#spawnPrey();
    }

    #treeNear(ci, cj, r) {
        for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++)
            if (this.isRevealed(ci + di, cj + dj) && this.get(ci + di, cj + dj) === T.TREE) return true;
        return false;
    }

    #spawnPrey() {
        // wild game keeps to the OUTSKIRTS — the wooded fringe of the charted land, well clear of the
        // plaza and of any farmer (they're shy of people). Rabbits are commonest + the least skittish.
        const r0 = this.rand();
        const kind = r0 < 0.52 ? 'rabbit' : r0 < 0.8 ? 'deer' : 'turkey';
        const def = PREY_DEFS[kind];
        for (let tries = 0; tries < 8; tries++) {
            const ang = this.rand() * Math.PI * 2, d = def.shy + 2 + this.rand() * 12;
            const ci = Math.round(CENTER + Math.cos(ang) * d), cj = Math.round(CENTER + Math.sin(ang) * d);
            if (!this.isRevealed(ci, cj) || this.pathBlocked(ci, cj)) continue;
            // don't materialise near a settler — deer/turkey especially won't
            if (this.farmers.some(f => f.plot && !f.downed && Math.hypot(f.pos.i - ci, f.pos.j - cj) < def.wary + 5)) continue;
            // prefer cover: a tree within 3 tiles. Reroll a few times for it, then take what we can get.
            if (!this.#treeNear(ci, cj, 3) && tries < 5) continue;
            this.prey.push({ kind, def, i: ci + 0.5, j: cj + 0.5, home: { i: ci, j: cj }, facing: this.rand() < 0.5 ? -1 : 1,
                             life: PREY_LIFE, done: false, hunter: null, bolt: 0, hop: 0, dir: this.rand() * Math.PI * 2, turnT: 0 });
            return;
        }
    }

    // Prey drift and graze; they BOLT from a hunter (or any farmer inside `wary`). A hunter latches on
    // via a.hunter — the animal keeps fleeing that one until it's bagged, escapes, or the hunter gives up.
    #advancePrey(a, dt) {
        a.life -= dt; a.hop += dt;
        if (a.life <= 0) { a.done = true; return; }
        // who's the nearest threat? the latched hunter takes priority, else any settler too close.
        let threat = (a.hunter && this.farmers.includes(a.hunter) && a.hunter.state === 'hunt') ? a.hunter : null;
        let td = threat ? Math.hypot(threat.pos.i - a.i, threat.pos.j - a.j) : 99;
        if (!threat) {
            for (const f of this.farmers) {
                if (!f.plot || f.downed) continue;
                const d = Math.hypot(f.pos.i - a.i, f.pos.j - a.j);
                if (d < a.def.wary && d < td) { threat = f; td = d; }
            }
        }
        const def = a.def;
        if (threat && td < 16) {           // FLEE: sprint directly away from the threat
            a.bolt = Math.max(a.bolt, 0.6);
            const ax = a.i - threat.pos.i, ay = a.j - threat.pos.j, m = Math.hypot(ax, ay) || 1;
            const spd = def.speed * (a.bolt > 0 ? 1 : 0.7);
            a.i += (ax / m) * spd * dt; a.j += (ay / m) * spd * dt;
            if (Math.abs(ax) > 0.05) a.facing = ax < 0 ? -1 : 1;
        } else {                            // GRAZE: amble in a slowly-turning heading, near home + shy of town
            a.turnT -= dt;
            if (a.turnT <= 0) { a.dir += (this.rand() - 0.5) * 1.6; a.turnT = 1.5 + this.rand() * 2.5; }
            if (Math.hypot(a.i - a.home.i, a.j - a.home.j) > 14) a.dir = Math.atan2(a.home.j - a.j, a.home.i - a.i);
            else if (Math.hypot(a.i - CENTER, a.j - CENTER) < def.shy) a.dir = Math.atan2(a.j - CENTER, a.i - CENTER) + (this.rand() - 0.5) * 0.4;   // veer back from the settled heart
            const spd = def.speed * 0.28;
            a.i += Math.cos(a.dir) * spd * dt; a.j += Math.sin(a.dir) * spd * dt;
            if (Math.abs(Math.cos(a.dir)) > 0.05) a.facing = Math.cos(a.dir) < 0 ? -1 : 1;
        }
        a.bolt = Math.max(0, a.bolt - dt);
        // wandered off into deep fog or miles from everyone? it's gone back to the wilds.
        if (!this.isRevealed(Math.round(a.i), Math.round(a.j))) { a.done = true; if (a.hunter) { a.hunter = null; } }
    }

    // ---- The Dungeon Master: wilderness threats ---------------------------------------------

    encounterFor(f) { for (const e of this.encounters) if (e.target === f && !e.done) return e; return null; }

    // A settler is exposed to the wilds when they're well clear of the plaza core AND not safe on
    // their own fenced homestead — out foraging/mining/charting where the DM's threats roam.
    #inWild(f) {
        if (!f.plot || f.downed || f.state === 'sleep' || f.state === 'sleepwalk' || f.health === 'sick') return false;
        if (Math.hypot(f.pos.i - CENTER, f.pos.j - CENTER) < WILD_RADIUS) return false;
        const p = f.plot;
        // safe on/near their own homestead, AND only truly exposed once they've strayed a good way from
        // it — deep enough in the wilds that reaching a fence again is a real run, not a step.
        if (p.sited && Math.hypot(f.pos.i - (p.x + 6), f.pos.j - (p.y + 6)) < 16) return false;
        return true;
    }

    #tickDM(dt) {
        for (const e of this.encounters) this.#advanceEncounter(e, dt);
        if (this.encounters.some(e => e.done)) this.encounters = this.encounters.filter(e => !e.done);
        this.dmCooldown -= dt;
        if (this.dmCooldown > 0 || this.encounters.length >= MAX_ENCOUNTERS) return;
        const prey = this.farmers.filter(f => this.#inWild(f) && !this.encounterFor(f));
        if (!prey.length) { this.dmCooldown = 10; return; }
        this.#spawnEncounter(prey[Math.floor(this.rand() * prey.length)]);
        this.dmCooldown = ENCOUNTER_INTERVAL + this.rand() * ENCOUNTER_JITTER;
    }

    #spawnEncounter(f) {
        const standout = f.sheet.level >= 6 || this.leader === f;   // the assassin stalks the best hand
        const r = this.rand();
        const kind = (standout && r < 0.16) ? 'assassin' : r < 0.42 ? 'fox' : r < 0.78 ? 'boar' : 'orc';
        const def = ENCOUNTER_DEFS[kind];
        const ang = Math.atan2(f.pos.j - CENTER, f.pos.i - CENTER) + (this.rand() - 0.5) * 1.2;   // out of the wild
        const d = 4 + this.rand() * 3;
        const ei = f.pos.i + Math.cos(ang) * d, ej = f.pos.j + Math.sin(ang) * d;
        const e = { kind, def, target: f, i: ei, j: ej, home: { i: ei, j: ej }, facing: 1,
                    hp: def.hp, clashTimer: 1, life: 45, done: false, helpWanted: false, helpers: new Set() };
        this.encounters.push(e);
        this.reveal(Math.round(e.i), Math.round(e.j), 4);
        this.addLog(`${f.sheet.name} ran into ${def.name} out in the wilds!`, '#e08850');
        f.threatAlert = 2; f.say('!!', '#e05040');
    }

    #advanceEncounter(e, dt) {
        const f = e.target;
        if (!f || !this.farmers.includes(f) || f.health === 'sick') { this.#endEncounter(e, null); return; }
        e.life -= dt;
        const beast = e.def.kind === 'beast';
        // BEASTS defend their own patch: they won't chase far from where they sprang, won't press into
        // the settled town, and think better of facing a crowd. FOES (orc/assassin) are bolder — they
        // follow their quarry right into the village (which rouses its defenders — see rally).
        if (beast) {
            if (Math.hypot(e.i - e.home.i, e.j - e.home.j) > BEAST_TERRITORY) {
                this.#endEncounter(e, `${e.def.name} broke off and loped back to its territory.`, '#9a9a8a'); return;
            }
            if (Math.hypot(f.pos.i - CENTER, f.pos.j - CENTER) < WILD_RADIUS - 2) {
                this.#endEncounter(e, `${f.sheet.name} reached safe ground and ${e.def.name} gave up the chase.`, '#7dd069'); return;
            }
            const standing = 1 + [...e.helpers].filter(h => this.farmers.includes(h) && h.combatStance === 'fight').length;
            if (standing >= 3) { this.#endEncounter(e, `Outnumbered, ${e.def.name} turned tail and fled.`, '#7dd069'); return; }
        }
        if (e.life <= 0) { this.#endEncounter(e, `${e.def.name} lost the trail and slunk back into the wilds.`, '#9a9a8a'); return; }
        // made it HOME behind their OWN fence? that's their refuge — the threat breaks off. (A
        // neighbour's fence is no sanctuary; you have to reach your own gate.)
        if (this.#onOwnFencedPlot(f)) {
            this.#endEncounter(e, `${f.sheet.name} made it home behind the fence — ${e.def.name} can't follow.`, '#7dd069'); return;
        }
        const dx = f.pos.i - e.i, dy = f.pos.j - e.j, dist = Math.hypot(dx, dy) || 1;
        if (Math.abs(dx) > 0.08) e.facing = dx < 0 ? -1 : 1;   // face the way it moves
        if (dist > 1.2) {
            let sp = e.def.speed * 2.6 * dt;               // ~as fast as a bustling farmer, so chases are real
            const ni = e.i + dx / dist * sp, nj = e.j + dy / dist * sp;
            const onFence = this.tileInFencedPlot(Math.floor(ni), Math.floor(nj));
            if (beast) { if (!onFence) { e.i = ni; e.j = nj; } }        // a fence turns a BEAST away entirely
            else { if (onFence) sp *= 0.4; e.i += dx / dist * sp; e.j += dy / dist * sp; }   // a FOE breaches, but slowly
        } else {
            e.clashTimer -= dt;
            if (e.clashTimer <= 0) { e.clashTimer = 1.4; this.#resolveClash(e); }
        }
    }

    // A threat has strayed into the settled heart of town (only foes get this far — beasts give up
    // first), where its defenders can see it and rush to protect their property and livestock.
    threatInVillage(e) { return Math.hypot(e.i - CENTER, e.j - CENTER) < WILD_RADIUS; }

    // A raised fence keeps threats OUT — a fenced homestead is a safe haven a chased farmer can duck
    // into. Threats treat these tiles as solid and won't set foot inside.
    tileInFencedPlot(i, j) {
        const k = pkey(i, j);
        for (const p of this.plots) if (p.sited && p.built.fence && p.cells.has(k)) return true;
        return false;
    }
    // A tree's current growth stage (0 sapling / 1 young / 2 mature) — rises over the days.
    treeStage(i, j) { return treeStageAt(i, j, this.day, this.treePlanted); }
    // Is this farmer standing on their OWN fenced homestead — their true refuge from a threat?
    #onOwnFencedPlot(f) {
        const p = f.plot;
        return !!(p && p.sited && p.built.fence && p.cells.has(pkey(Math.floor(f.pos.i), Math.floor(f.pos.j))));
    }

    #resolveClash(e) {
        const f = e.target, def = e.def;
        if (f.combatStance !== 'fight') {                  // caught while fleeing: a DEX save to slip the blow
            const dodge = d20(this.rand, mod(f.sheet.stats.dex));
            if (dodge.total >= def.diff || dodge.crit) f.say('dodged!', '#c8d060'); else this.#threatHits(e, f);
            return;
        }
        // standing to fight: the target + any adjacent helpers swing at the threat
        const fighters = [f, ...[...e.helpers].filter(h => this.farmers.includes(h) && Math.hypot(h.pos.i - e.i, h.pos.j - e.j) < 2.2)];
        let landed = false;
        for (const ff of fighters) {
            const atk = d20(this.rand, ff.combatMod());
            if (atk.total >= def.diff || atk.crit) { e.hp -= atk.crit ? 2 : 1; ff.gainXP(2); landed = true; if (e.hp <= 0) break; }
        }
        if (e.hp <= 0) { this.#defeatThreat(e, fighters); return; }
        if (landed) f.say('hah!', '#e0d060');
        const victim = fighters[Math.floor(this.rand() * fighters.length)];   // the threat swings back
        const dodge = d20(this.rand, mod(victim.sheet.stats.dex));
        if (dodge.total < def.diff && !dodge.crit) this.#threatHits(e, victim);
    }

    #threatHits(e, f) {
        f.hp = Math.max(0, f.hp - (e.def.dmg + Math.floor(this.rand() * 2)));   // a solid blow bleeds HP
        f.energy = Math.max(0, f.energy - 0.05);                                 // and scuffling tires you
        f.hurtFlash = 1; f.say('argh!', '#e05040');
        if (e.def.loot === 'ore' && f.ore > 0 && this.rand() < 0.35) f.ore = Math.max(0, f.ore - 2);       // raider grabs loot
        else if (e.def.loot === 'goods' && this.rand() < 0.35) this.#stealGood(f);
        // a BEAST breaks you off before it kills — you flee at low HP; a FOE can put you DOWN at 0 HP.
        if (e.def.kind === 'beast' && f.hp <= 3) {
            f.hp = Math.max(f.hp, 2); f.combatStance = 'flee';
            this.recordEncounter(f, e.def, 'beaten');
            this.#endEncounter(e, `${f.sheet.name} was gored by ${e.def.name} and fled home hurt!`, '#e05040');
        } else if (e.def.kind === 'foe' && f.hp <= 0) {
            this.#downFarmer(f, e);   // struck down (a hard reset, not sickness)
        }
    }

    // FELLED BY A FOE — treated as a hard RESET, not death and not sickness: they lose a quarter of
    // their harvest, drop out for 3 days, then pick themselves back up at home (or where they fell if
    // they've no home yet). They come back WISER (recordEncounter). Sickness, by contrast, costs a day.
    #downFarmer(f, e) {
        const lost = Math.floor(f.sheet.harvested * 0.25);
        f.sheet.harvested = Math.max(0, f.sheet.harvested - lost);
        const downI = f.pos.i, downJ = f.pos.j;   // where they fell (recorded before they're carried home)

        // --- SOCIAL FALLOUT: being cut down reshapes the web, and it's all VISIBLE ---
        const rescuers = [...e.helpers].filter(h => this.farmers.includes(h) && !h.downed);
        if (rescuers.length) {
            for (const h of rescuers) {
                f.adjustOpinion(h, 0.3, `stood with me when ${e.def.name} had me`);
                h.adjustOpinion(f, 0.12, `pulled them back from ${e.def.name}`);
                this.addBond(f, h, 2);
                f.remember('person', `${h.sheet.name.split(' ')[0]} stood with me when ${e.def.name} had me — I owe them`, h, 1.4);
            }
            this.addLog(`${f.sheet.name} owes their life to ${rescuers.map(h => h.sheet.name.split(' ')[0]).join(' & ')}.`, '#7dd069');
            this.addChronicle('peril', `${f.sheet.name.split(' ')[0]} was struck down by a ${e.def.name.toLowerCase()}, but ${rescuers.map(h => h.sheet.name.split(' ')[0]).join(' & ')} pulled them back.`, f, rescuers[0], '#e07040');
        } else {
            // no one came: resent the able-bodied who were near enough to have helped
            const bystanders = this.farmers.filter(x => x !== f && !x.downed && x.plot?.sited && x.state !== 'sleep'
                && x.sheet.stats.str >= 11 && Math.hypot(x.pos.i - downI, x.pos.j - downJ) < 30).slice(0, 2);
            for (const b of bystanders) {
                f.adjustOpinion(b, -0.22, `left me to ${e.def.name} out in the wilds`);
                f.remember('person', `${b.sheet.name.split(' ')[0]} was near enough to help and left me to ${e.def.name}`, b, 1.3);
            }
            if (bystanders.length) this.addLog(`${f.sheet.name} won't forget that no one came.`, '#c05840');
            this.addChronicle('peril', `${f.sheet.name.split(' ')[0]} was struck down by a ${e.def.name.toLowerCase()} in the wilds — no one came.`, f, null, '#e03828');
        }
        // shun the ground where they fell — a scar on the map they'll avoid and speak of
        (f.dangerZones ||= []).push({ i: downI, j: downJ, kind: e.def.kind });
        if (f.dangerZones.length > 4) f.dangerZones.shift();

        // --- the reset ---
        f.downed = true; f.reviveDay = this.day + 3; f.state = 'downed';
        const home = f.plot && f.plot.sited ? this.houseDoor(f.plot) : { i: downI, j: downJ };
        f.pos = { i: home.i, j: home.j };
        this.recordEncounter(f, e.def, 'downed');
        this.#endEncounter(e, null);   // clean up helpers/stance (state is 'downed', so it isn't reset)
        this.addLog(`${f.sheet.name} was struck down by ${e.def.name}! Recovering at home (lost ${lost} crop).`, '#e03828');
        f.say('...', '#e03828');
    }

    // Collapsed on their feet — HP bled to nothing from an untreated illness (not a foe): the same
    // downed reset (recover at home), but no crop is stolen and no combat lesson is learned.
    collapse(f) {
        if (f.downed) return;
        f.downed = true; f.reviveDay = this.day + 2; f.state = 'downed'; f.hp = 0; f.combatStance = null;
        const home = f.plot && f.plot.sited ? this.houseDoor(f.plot) : { i: f.pos.i, j: f.pos.j };
        f.pos = { i: home.i, j: home.j };
        f.remember('lesson', `I pushed on through sickness till I dropped — I must rest when I'm ill.`, null, 1.2);
        this.addLog(`${f.sheet.name} collapsed from untreated illness — they'll mend at home.`, '#c05840');
    }

    // A settler comes away from an encounter WISER — logging what they learned about the foe, where
    // the danger lay, and how they'd handle it next time — and grows warier of that kind of threat.
    recordEncounter(f, def, outcome) {
        const dir = this.#compass(f.pos.i, f.pos.j);
        if (outcome === 'downed' || outcome === 'beaten') {
            f.threatWary[def.kind] = (f.threatWary[def.kind] || 0) + (outcome === 'downed' ? 2 : 1);
            f.remember('lesson', outcome === 'downed'
                ? `${def.name} cut me down out ${dir} — I'm no match for one alone. Next time I run, or bring help.`
                : `${def.name} bloodied me out ${dir}. Best give that ground a wide berth, or not go there alone.`, null, 1.3);
            f.think(outcome === 'downed' ? 'NEVER FACE ONE ALONE AGAIN...' : 'THAT GROUND IS DANGEROUS.');
        } else if (outcome === 'won') {
            f.remember('event', `Stood my ground against ${def.name} out ${dir} and won — I've got their measure now.`, null, 1.0);
            f.threatWary[def.kind] = Math.max(0, (f.threatWary[def.kind] || 0) - 0.5);   // a win eases the dread
        }
    }
    #compass(i, j) {
        const dx = i - CENTER, dy = j - CENTER;
        const ns = dy < -6 ? 'north' : dy > 6 ? 'south' : '';
        const ew = dx < -6 ? 'west' : dx > 6 ? 'east' : '';
        return (ns + ew) || 'in the near wilds';
    }

    #stealGood(f) {
        const g = f.sheet.goods || {}, have = Object.keys(g).filter(k => g[k] > 0);
        if (have.length) { const k = have[Math.floor(this.rand() * have.length)]; g[k] = Math.max(0, g[k] - 1); }
    }

    #defeatThreat(e, fighters) {
        e.done = true;
        const f = e.target;
        for (const ff of fighters) { ff.gainXP(5); ff.combatStance = null; ff.threatAlert = 0; if (ff.state === 'fight' || ff.state === 'flee') ff.state = 'decide'; }
        this.clearHelp(f);
        if (e.def.loot === 'ore') { f.ore += 3; f.say('+3 ore', '#c8d0dc'); }
        else if (e.def.loot === 'goods') { f.sheet.goods = f.sheet.goods || {}; f.sheet.goods.flower = (f.sheet.goods.flower || 0) + 2; f.say('+loot', '#e0b050'); }
        // a downed BEAST is dressed for meat — the kill feeds the hunter (a prized barter good + HP)
        if (e.def.meat) { f.sheet.goods = f.sheet.goods || {}; f.sheet.goods[e.def.meat] = (f.sheet.goods[e.def.meat] || 0) + 1; f.say(`+${MEAT_NAME[e.def.meat]}`, '#e07868'); }
        const who = fighters.length > 1 ? `${f.sheet.name} + ${fighters.length - 1} more` : f.sheet.name;
        this.addLog(`${who} drove off ${e.def.name}!`, '#7dd069');
        f.sparkle = 2;
        for (const ff of fighters) this.recordEncounter(ff, e.def, 'won');
    }

    #endEncounter(e, msg, color) {
        e.done = true;
        for (const h of e.helpers) { if (h.combatStance) h.combatStance = null; if (h.state === 'fight' || h.state === 'flee') h.state = 'decide'; }
        const f = e.target;
        if (f) { f.combatStance = null; f.threatAlert = 0; if (f.state === 'fight' || f.state === 'flee') f.state = 'decide'; this.clearHelp(f); }
        if (msg) this.addLog(msg, color || '#9a9a8a');
    }

    #tickMerchant(dt) {
        if (!this.merchant) {
            // a trader only bothers with a town that's grown enough to be worth the trip
            if (this.townLevel < MERCHANT_TOWN_LVL) return;
            if (this.day >= this.merchantNextDay && !this.isNight()) this.#spawnMerchant();
            return;
        }
        const m = this.merchant;
        if (m.state === 'arriving') {
            if (this.#moveMerchant(dt)) {
                m.state = 'trading'; m.facing = 0; m.frame = 0;
                m.leaveTime = this.time + MERCHANT_STAY_DAYS * (DAY_LENGTH + NIGHT_LENGTH);
                this.addLog('A traveling merchant set up a stall by the plaza — bring surplus goods to trade for ore!', '#e8c860');
            }
        } else if (m.state === 'trading') {
            if (this.time >= m.leaveTime || m.stock <= 0) {
                m.state = 'leaving'; m.target = m.arrive; m.path = null; m.pi = 0;
                this.addLog(`The merchant is packing up${m.traded > 0 ? ` (traded away ${m.traded} ore)` : ''}.`, '#c8a060');
            }
        } else if (m.state === 'leaving') {
            if (this.#moveMerchant(dt)) {
                this.addLog('The merchant rode off toward the next town.', '#8a8fa0');
                this.merchant = null;
                this.merchantNextDay = this.day + MERCHANT_INTERVAL + Math.floor(this.rand() * 3);
            }
        }
    }

    #spawnMerchant() {
        const stall = this.#merchantStallSpot();
        if (!stall) return;                       // plaza not clear/revealed yet — try again next day
        const arrive = this.#merchantArrivalSpot(stall) || { i: stall.i, j: stall.j };
        this.merchantVisit++;
        const type = MERCHANT_TYPES[Math.floor(this.rand() * MERCHANT_TYPES.length)];
        this.merchant = {
            state: 'arriving', pos: { i: arrive.i + 0.5, j: arrive.j + 0.5 },
            stall, arrive, target: stall, path: null, pi: 0,
            facing: 0, frame: 0, animT: 0, traded: 0, leaveTime: 0,
            visit: this.merchantVisit, name: type.name, spriteIdx: type.sprite, rate: type.rate, stock: type.stock,
        };
        this.addLog(`${type.name[0].toUpperCase() + type.name.slice(1)} is approaching the market...`, '#e8c860');
    }

    // an open, revealed plaza-adjacent tile for the stall (not on the well/board/statue/a plot)
    #merchantStallSpot() {
        const a0 = this.day % 8;   // vary the corner of the plaza per visit, deterministically
        for (let r = 5; r <= 12; r++) {
            for (let a = 0; a < 8; a++) {
                const ang = ((a + a0) % 8) / 8 * Math.PI * 2;
                const i = Math.round(CENTER + Math.cos(ang) * r), j = Math.round(CENTER + Math.sin(ang) * r);
                if (this.isRevealed(i, j) && !this.pathBlocked(i, j) && this.get(i, j) === T.GRASS &&
                    !this.plots.some(p => p.cells.has(pkey(i, j)))) return { i, j };
            }
        }
        return null;
    }

    // a revealed, walkable spot further out for the merchant to walk IN from (and back out to)
    #merchantArrivalSpot(stall) {
        const ang = Math.atan2(stall.j - CENTER, stall.i - CENTER);
        for (let d = 26; d >= 14; d -= 2) {
            const i = Math.round(CENTER + Math.cos(ang) * d), j = Math.round(CENTER + Math.sin(ang) * d);
            if (this.isRevealed(i, j) && !this.pathBlocked(i, j)) return { i, j };
        }
        return null;
    }

    // step the merchant along a path toward its target; returns true on arrival
    #moveMerchant(dt) {
        const m = this.merchant;
        if (!m.path || m.pi >= m.path.length) {
            m.path = this.findPath(m.pos, m.target) || [];
            m.pi = 0;
            if (!m.path.length) { m.pos = { i: m.target.i + 0.5, j: m.target.j + 0.5 }; return true; }
        }
        const wp = m.path[m.pi];
        const dx = (wp.i + 0.5) - m.pos.i, dy = (wp.j + 0.5) - m.pos.j;
        const dist = Math.hypot(dx, dy), step = MERCHANT_SPEED * dt;
        if (dist <= step) { m.pos = { i: wp.i + 0.5, j: wp.j + 0.5 }; m.pi++; }
        else { m.pos.i += dx / dist * step; m.pos.j += dy / dist * step; }
        if (Math.abs(dx) > Math.abs(dy)) m.facing = dx > 0 ? 2 : 1; else m.facing = dy > 0 ? 0 : 3;
        m.animT += dt; if (m.animT > 0.13) { m.animT = 0; m.frame = (m.frame + 1) % 6; }
        return m.pi >= m.path.length;
    }

    // Execute a trade: the farmer spends their most-plentiful surplus goods (RATE per ore) to top
    // up toward a comfortable ore reserve, bounded by the merchant's remaining stock.
    doTrade(f) {
        const m = this.merchant;
        if (!m || m.state !== 'trading' || m.stock <= 0) return false;
        const g = f.sheet.goods || {}, rate = m.rate || MERCHANT_RATE;
        let total = 0; for (const k in g) total += g[k];
        // how much ore they can get: capped by the merchant's stock, a comfortable reserve, and
        // what their surplus can actually pay for (rate goods each)
        const oreWant = Math.min(m.stock, Math.max(0, 12 - f.ore), Math.floor(total / rate));
        if (oreWant <= 0) return false;
        let toSpend = oreWant * rate, paid = 0;
        const pools = Object.keys(g).filter(k => g[k] > 0).sort((a, b) => g[b] - g[a]);   // spend the most-plentiful first
        for (const k of pools) { while (toSpend > 0 && g[k] > 0) { g[k]--; toSpend--; paid++; } if (toSpend <= 0) break; }
        f.ore += oreWant; m.stock -= oreWant; m.traded += oreWant;
        f.gainXP(2);
        f.remember('event', `Traded ${paid} surplus goods to the merchant for ${oreWant} ore`, null, 0.85);
        this.addLog(`${f.sheet.name} traded ${paid} goods to the merchant for ${oreWant} ore`, '#e8c860');
        f.say('a fair trade!', '#e8c860'); f.sparkle = 1.2;
        return true;
    }
}

// neighborhood co-op tuning: how far a water haul has to be before it hurts, how far
// apart wells must sit (no redundant digs), and what a shared well takes to raise
const FAR_WATER = 18;
const MIN_WELL_DIST = 20;
const COOP_WELL = { needWood: 10, needOre: 4, needed: 40 };
const COOP_RALLY_DAYS = 2;
const COOP_STALL_DAYS = 8;

// A wandering MERCHANT visits every so often, sets up a stall by the plaza, and swaps ORE (the
// finite frontier resource) for the surplus GOODS the farms churn out — an economic alternative
// to trekking the highlands for stone. RATE goods buy one ore.
const MERCHANT_TOWN_LVL = 3;      // the town must be this established before a trader detours here
const MERCHANT_INTERVAL = 6;      // days between visits (plus a jitter)
const MERCHANT_STAY_DAYS = 1.3;   // how long the stall lingers before packing up
const MERCHANT_SPEED = 2.6;       // travel speed (tiles/sec)
const MERCHANT_RATE = 2;          // default surplus goods paid per ore (a type may differ)
// Each visit is a DIFFERENT trader — its own look (sprite index into the guild-hall characters),
// name, exchange rate (goods per ore) and how much ore it carries. Picked deterministically per visit.
const MERCHANT_TYPES = [
    { name: 'a traveling Peddler', sprite: 0, rate: 2, stock: 30 },
    { name: 'a Caravan Trader', sprite: 1, rate: 2, stock: 42 },   // hauls a big load of ore
    { name: 'a roving Merchant', sprite: 2, rate: 3, stock: 24 },  // drives a harder bargain
];

// The Dungeon Master: the wilds beyond the settled valley aren't empty. When a settler ventures far
// out — foraging, chopping, mining, charting the fog — the DM may loose a threat on them. Beasts
// (fox/boar) hunt; foes (orc/assassin) raid, and the assassin stalks the town's standout hand. A
// settler answers by their nature: the bold + strong stand and FIGHT (d20 + STR/CON vs difficulty),
// the timid FLEE for the plaza, the outmatched CALL FOR HELP — and brave neighbours come running.
// Farmers fight with bare hands and a hoe, so even beasts are dangerous — only a fox is a safe shoo-off.
// diff = how hard to land a blow on it AND how hard to dodge its own; hp = blows to drive it off.
const ENCOUNTER_DEFS = {
    fox:      { name: 'a fox',             kind: 'beast', diff: 10, hp: 1, dmg: 2, speed: 1.5,  menace: 0.6, meat: 'meat-m', color: '#d0803c' },
    boar:     { name: 'a wild boar',       kind: 'beast', diff: 13, hp: 3, dmg: 4, speed: 1.2,  menace: 1.1, meat: 'meat-l', color: '#8a6a4a' },
    orc:      { name: 'an orc raider',     kind: 'foe',   diff: 15, hp: 4, dmg: 5, speed: 1.05, menace: 1.3, loot: 'ore',   color: '#6a8a4a' },
    assassin: { name: 'a hooded assassin', kind: 'foe',   diff: 17, hp: 4, dmg: 6, speed: 1.45, menace: 1.6, loot: 'goods', color: '#6a5a7a' },
};
const ENCOUNTER_INTERVAL = 130, ENCOUNTER_JITTER = 130;   // game-seconds between spawn attempts (~1-2/day)
const MAX_ENCOUNTERS = 3, WILD_RADIUS = 30;             // the wilds begin ~this far from the plaza
const BEAST_TERRITORY = 17;   // a beast won't chase further than this from where it sprang (foes press on)

// Roaming WILD PREY — the peaceful counterpart to the DM's threats. Deer/rabbit/turkey drift the
// charted wilds; a hunter STALKS them for MEAT (a prized barter good + a HP restorative — see #maybeEatMeat).
// Each bolts when a farmer strays within `wary` tiles. `evade` is the DC a lunge must beat (d20 + DEX/WIS)
// to bag it; a miss sends the animal bolting. meat by SIZE (rabbit small, deer large, turkey = fowl).
// `wary` = how far off it spooks and bolts (deer/turkey are very skittish, a rabbit lets you get close).
// `shy`  = the distance from the plaza it likes to keep — deer/turkey stay deep in the wilds; a rabbit
// will graze right up to the settled fringe (but still bolts if a farmer closes in).
const PREY_DEFS = {
    rabbit: { name: 'a rabbit',      kind: 'rabbit', meat: 'meat-s', evade: 15, speed: 2.1, wary: 4,  xp: 3, size: 0.7,  color: '#b89060', shy: WILD_RADIUS - 9 },
    turkey: { name: 'a wild turkey', kind: 'turkey', meat: 'fowl',   evade: 12, speed: 1.5, wary: 8,  xp: 4, size: 0.95, color: '#7a5a4a', shy: WILD_RADIUS + 5 },
    deer:   { name: 'a deer',        kind: 'deer',   meat: 'meat-l', evade: 12, speed: 1.9, wary: 9,  xp: 6, size: 1.25, color: '#a9784c', shy: WILD_RADIUS + 8 },
};
const PREY_SPAWN_INTERVAL = 75, PREY_SPAWN_JITTER = 95;   // game-seconds between wild game appearing (occasional)
const MAX_PREY = 4, PREY_LIFE = 150;                      // how many roam at once, and how long before one wanders off-map

// episodic-journal tuning: cap per bot, and nightly decay per memory kind — hard
// lessons stick for a season+, relationship/job episodes for weeks, small talk for days
const JOURNAL_MAX = 160;
const JOURNAL_DECAY = { lesson: 0.995, person: 0.97, job: 0.96, event: 0.975, chat: 0.90 };
const JOURNAL_FORGET = 0.12;   // below this strength a memory is gone for good

// courses a bot can set for itself after reflecting on its journal (see Farmer.reflect)
const GOAL_CREEDS = {
    'lone wolf': "I'LL RELY ON NO ONE.",
    'good neighbor': 'THIS TOWN LOOKS AFTER ITS OWN.',
    'harvest king': 'NO ONE OUTGROWS ME.',
    'sharp trader': 'EVERYTHING HAS A PRICE.',
    'master farmer': 'THE CRAFT IS THE REWARD.',
};

// The guardian statues replace the old storm tower: a 3-tier chain of carved monuments,
// each unlocked by the town's most experienced hand (lvlReq), costing EXPONENTIALLY more
// stone and timber, claiming a bigger square footprint — and bending the sky harder:
// lightning falls off exponentially while the rains come oftener and soak deeper (less
// hand-watering). Farmers haul the materials together, then carve together.
// `townLvl` is the town-level rung each build unlocks at (see World.townLevel) — the town must
// grow (silo donations) before its settlers can raise these, so a level-1 ghost town has only a well.
const PROJECT_DEFS = [
    // Ordered build queue (strict projectIndex order). The guardian chain is interleaved so the head
    // arrives early (town L2) and its upgrades follow at L4 / L6, with harvest + carver-level gates
    // lowered to match those tiers so they're actually reachable there.
    { type: 'board', label: 'BULLETIN BOARD', townLvl: 2, at: 8, needed: 22, perk: 'FARMERS CAN POST JOBS' },
    { type: 'statue1', label: 'GUARDIAN HEAD', townLvl: 2, at: 18, needed: 40, lvlReq: 3, wood: 14, ore: 8, size: 1,
      lightning: 0.82, rain: 1.1, perk: 'LIGHTNING -18%, RAIN +10%' },
    { type: 'toolshed', label: 'TOOLSHED', townLvl: 3, at: 30, needed: 30, perk: 'ALL WORK +12% FASTER' },
    { type: 'windmill', label: 'WINDMILL', townLvl: 4, at: 60, needed: 45, perk: 'CROPS GROW +15% FASTER' },
    { type: 'statue2', label: 'FOX SENTINEL', townLvl: 4, at: 95, needed: 80, lvlReq: 8, wood: 35, ore: 20, size: 2,
      lightning: 0.55, rain: 1.3, perk: 'LIGHTNING -45%, RAIN +30%' },
    { type: 'well2', label: 'SECOND WELL', townLvl: 5, at: 150, needed: 65, perk: 'SHORTER WATER RUNS' },
    { type: 'statue3', label: 'STONE MOTHER', townLvl: 6, at: 260, needed: 160, lvlReq: 16, wood: 88, ore: 50, size: 3,
      lightning: 0.25, rain: 1.6, perk: 'LIGHTNING -75%, RAIN +60%' },
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

const FACILITY_YIELD_NAME = { pad: 'lily', fish: 'fish', chicken: 'egg', cow: 'milk', pig: 'truffle', goat: 'wool', sheep: 'wool' };

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
        this.chatCooldown = 2 + this.rand() * 8;   // gates neighbourly small talk
        this.animTime = this.rand() * 10;

        this.thought = 'A NEW FARM. A NEW LIFE.';
        this.thoughtBubbleTimer = 4 + this.rand() * 8;
        this.helpTask = null;
        this.helpCooldown = 0;
        this.coopCooldown = 0;    // gates how often the shared-well idea can strike
        this.wellAskCooldown = 0; // gates asking a neighbor for well rights
        this.fetchWellRef = null; // the well this water run is drawing from (for tolls)
        this.birdLosses = 0;      // crops lost to crows — enough and a scarecrow goes up
        this.stormLosses = 0;     // crops this farmer lost to lightning — drives them to help
                                  // raise the guardian (decays slowly, like a fading grudge)
        this.donateCooldown = 1 + Math.floor((sheet.seed >>> 5) % 3);  // days between silo donations
        this.donateTarget = null; // pending surplus a farmer is hauling to the town silo
        this.claim = null;        // the ground a founder is travelling out to stake (until their plot is sited)
        this.scoutList = null;    // itinerary of candidate spots to survey before settling (visible deliberation)
        this.scoutIdx = 0; this.scoutTimer = 0;
        this.combatStance = null; // 'fight' | 'flee' while facing a wilderness threat (see #handleCombat)
        this.threatAlert = 0;     // render pulse when a threat appears / while in danger
        this.hurtFlash = 0;       // render pulse when struck
        this.emote = null;        // transient social tell ('grudge' | 'bond') shown over the head (B3)
        this.emoteT = 0;          // seconds left on the current emote (dt-decremented — deterministic)
        this.carryTrophy = null;  // { meat, t } — a hunter holds up their kill on the way home (B5)
        this._wasHurt = false;    // was recently badly wounded — arms the "good as new" recovery beat (B5)
        this.fightTimer = 0; this.fleeTimer = 0;
        this.downed = false;      // felled by a FOE — reviving at home over a few days (NOT sickness)
        this.reviveDay = 0;       // world.day this bot gets back on their feet
        this.threatWary = {};     // foe-kind -> how many times it's bested me (raises my urge to flee/rally)
        this.dangerZones = [];    // spots where a foe once cut me down — ground I now shun and speak of
        this.scarecrowTarget = null;

        // episodic memory: a day-stamped journal of what happened to THIS bot — who helped,
        // who burned them, illnesses, deals, chats. Entries decay in strength over the days
        // (lessons fade slowest, small talk fastest) and are forgotten once too faint.
        this.journal = [];
        // outcomes of the jobs this bot has POSTED — the raw material for learning what
        // offers work (see chooseReward: friction teaches a lowballer to open fairer)
        this.jobStats = { accepted: 0, haggled: 0, declined: 0 };
        this.goal = null;   // a self-set course chosen in reflect(), from lived experience
        this.nextExpand = 8 + (sheet.seed % 5);      // jitter so farms don't grow in lockstep
        this.nextFacility = 12 + (sheet.seed % 6);
        this.targetProd = null;

        // the pull of the horizon: how strongly this bot itches to walk past the fog line (see
        // recomputeWanderlust — CURIOSITY is the main driver, so it must be recomputed if a founder's
        // curiosity is later nudged).
        this.recomputeWanderlust();
        this.exploreHeading = ((sheet.seed % 628) / 100);   // a personal compass bearing (radians)
        this.exploreCooldown = 20 + (sheet.seed % 30);      // staggered first treks
        this.oreExpedCooldown = 0;                           // paces ore expeditions (need-driven treks for stone)
        this.tradeCooldown = 0;                              // paces trips to the merchant's stall
        this.barterCooldown = 8 + (sheet.seed >>> 7) % 12;   // paces neighbour-to-neighbour barter trips
        this.discovered = 0;                                 // lifetime tiles personally uncovered
        this.annexCooldown = 0;                              // gates frontier-field scouting
        this.pendingAnnex = null;                            // the staked claim being walked to
        this._revI = null; this._revJ = null;                // last tile whose fog we lifted

        // resource inventory (tradeable): wood from trees, ore from rocks, plus sheet.goods forage
        this.wood = START_WOOD;
        this.ore = 0;
        this.wantExpand = false;
        this.wantFacility = false;
        this.wantUpgrade = false; // ambition blocked by the HOUSE -> actively save toward the next tier
        this.woodTarget = null;
        this.fishTarget = null;   // { i, j (shore), water:{i,j} } — a wild lake being walked to
        this.huntTarget = null;   // a world.prey animal this bot is running down (see the 'hunt' state)
        this.huntTimer = 0;       // how much longer they'll keep up a chase before giving up
        this.barterDeal = null;   // a pending goods-for-goods swap being walked to (see #findBarter/#completeBarter)
        this.tools = new Set();   // crafted tools owned (see CRAFTABLES) — unlock at level, cost ore
        this.craftTarget = null;  // the recipe a farmer has walked home to build

        this.energy = 0.8 + this.rand() * 0.2;   // stamina for WORK (drains laboring, restored by sleep)
        this.hp = this.maxHp;                     // LIFE: bled by combat + untreated illness, knit back by REST
        this.sleepDebt = 0;
        this.strain = 0;   // accumulates when laboring while exhausted -> sickness risk
        this.health = 'healthy';
        this.sickDays = 0;
        this.workedLate = false;
        // learned experience: bots adapt to their own history rather than repeating mistakes.
        this.caution = 0;    // grows each time they fall ill -> they pace themselves harder
        this.illnesses = 0;  // lifetime count (shown on their sheet)
        this.nightsExposed = 0;   // consecutive nights slept rough (no roof) -> escalating illness risk
        this.reputation = 0.55;
        this.poachCooldown = 6 + this.rand() * 10;
        this.visitedSick = new Set();
        // MOOD: a -1..1 emotional weather that random-walks each dawn, its swing scaled by the
        // `volatility` trait. It shifts how collaborative the bot ACTS today (effCollab), so a
        // mercurial farmer helps in warm streaks then withdraws when they're out of sorts.
        this.mood = 0;
        this.helpPostedDay = -99;   // when they last posted a genuine plea (for the moody's slow burn)
        // social memory: a DIRECTIONAL opinion of each neighbour (seed -> -1..1), built from
        // real events (help, pay, welching, poaching, soup). Grudges + gratitude are personal
        // and decay toward neutral over time. Drives who they help / trade with (see takeHelp).
        this.opinions = new Map();
        // TOWN GOSSIP: rumors this bot has OVERHEARD about OTHER people (distinct from `journal`,
        // which is their own first-hand memories). Each fades over the days and is forgotten.
        this.gossip = [];
    }

    // File away a rumor just heard: `from` warned against `about`. Kept newest-first-ish,
    // decayed nightly (see reflect), capped so a long game doesn't hoard chatter.
    hearGossip(from, about) {
        if (!from || !about || from === this || about === this) return;
        this.gossip.push({ day: this.world.day, from: shortName(from), about: shortName(about), strength: 1 });
        if (this.gossip.length > 16) this.gossip.shift();
    }

    // how collaborative this bot is ACTING today: their base teamwork, shifted by today's mood
    // (a big shift for the mercurial, none for the even-keeled). This — not the raw trait —
    // gates who they help, visit, and dig wells with, so their generosity visibly runs hot/cold.
    get volatility() { return this.p.volatility ?? 0.5; }
    effCollab() { return Math.max(0, Math.min(1, this.p.collaboration + this.mood * this.volatility * 0.6)); }
    // CURIOSITY is the main pull toward the fog line; a competitive streak adds restlessness. Recomputed
    // (not just set once) so a founder whose curiosity is nudged in ensureFounderVariety updates too.
    recomputeWanderlust() {
        this.wanderlust = Math.max(0.05, Math.min(0.95,
            0.05 + (this.p.curiosity ?? 0.5) * 0.7 + this.p.competitiveness * 0.15 + ((this.sheet.seed >>> 3) % 16) / 100));
    }

    opinionOf(other) { return other ? (this.opinions.get(other.sheet.seed) || 0) : 0; }
    adjustOpinion(other, d, reason) {
        if (!other || other === this) return;
        const k = other.sheet.seed;
        const v = Math.max(-1, Math.min(1, (this.opinions.get(k) || 0) + d));
        this.opinions.set(k, v);
        // a soured opinion crossing into real resentment is a story beat (once per pair)
        if (v <= -0.5) {
            const w = this.world, rk = w.bondKey(this, other);
            if (!w._chronRifts.has(rk)) {
                w._chronRifts.add(rk);
                w.addChronicle('rift', `${this.sheet.name.split(' ')[0]} and ${other.sheet.name.split(' ')[0]} have fallen out.`, this, other, '#c05840');
            }
        }
        if (reason) {
            // keep the reason SORTED BY DIRECTION: the last thing that WARMED us to them and the last
            // thing that SOURED us, stored separately. The TIES tab then shows whichever matches the
            // net opinion's sign — so "Trusts X" never reads "- tricked me" (a positive tie shows a
            // positive reason; the trick still lives in the journal + drags the opinion value down).
            this.opinionReasons = this.opinionReasons || new Map();
            const rec = this.opinionReasons.get(k) || {};
            if (d >= 0) rec.pos = reason; else rec.neg = reason;
            this.opinionReasons.set(k, rec);
            // every opinion shift is an episode worth journaling; stronger shifts stick longer
            this.remember('person', `${other.sheet.name.split(' ')[0]} - ${reason}`, other, 0.6 + Math.min(0.6, Math.abs(d) * 1.5));
        }
    }

    // Record an episode in this bot's journal. kind: 'person' | 'chat' | 'job' | 'lesson' | 'event'.
    // weight sets the starting strength (how long it survives decay before being forgotten).
    remember(kind, text, other = null, weight = 0.8) {
        this.journal.push({
            day: this.world.day, kind, text,
            who: other ? other.sheet.seed : null,
            strength: Math.min(1.5, weight),
        });
        if (this.journal.length > JOURNAL_MAX) {
            // forget the FAINTEST old memory, not simply the oldest — vivid ones survive
            let wi = 0;
            const keepRecent = this.journal.length - 30;   // the last 30 are always safe
            for (let k = 1; k < keepRecent; k++) if (this.journal[k].strength < this.journal[wi].strength) wi = k;
            this.journal.splice(wi, 1);
        }
    }
    // memories of a specific neighbor, newest first (for the sheet + future reasoning)
    memoriesAbout(other) {
        const seed = other.sheet.seed;
        return this.journal.filter(m => m.who === seed).reverse();
    }
    // How much THIS bot wants more of a good right now (~0.6 surplus .. ~1.8 badly needed).
    // Drives what they offer (give away what they can spare) and what they'll accept (a good
    // they need is worth more, so fewer units satisfy them).
    goodValue(good) {
        const lvl = this.plot.built.level;
        if (good === 'wood') return this.wood < 8 ? 1.7 : this.wood < 20 ? 1.1 : 0.65;   // fences/houses/facilities burn wood
        if (good === 'ore') return (lvl < 3 && this.ore < 8) ? 1.8 : this.ore < 4 ? 1.2 : 0.9;   // house upgrades need stone
        if (good === 'crops') return 1.0;   // food, always somewhat wanted
        // barterable goods: value FALLS as your own stock rises (a pile you can spare) — a good you MAKE
        // starts cheaper, one you lack starts dearer, and meat is prized either way. This is the exchange
        // rate the barter layer trades on: you give what's worth little to you for what's worth more.
        const have = (this.sheet.goods && this.sheet.goods[good]) || 0;
        const base = MEAT_GOODS.includes(good) ? 1.5 : this.producedGoods().has(good) ? 0.7 : 1.15;
        return Math.max(0.4, base - Math.min(0.5, have * 0.03));
    }

    // The set of goods this farm actually CHURNS OUT — its facilities' yields plus its crops. Cached
    // (rebuilt only when a facility is added). This is what it can spare in a barter; anything NOT here
    // it must trade for. Coop->eggs, pond->fish+lily, sheeppen->wool, pen->milk/truffle/wool by animal.
    producedGoods() {
        const facs = this.plot.facilities || [];
        if (this._prodGoods && this._prodGoodsN === facs.length) return this._prodGoods;
        const out = new Set(['crops']);
        for (const fac of facs) {
            if (fac.type === 'coop') out.add('egg');
            else if (fac.type === 'pond') { out.add('fish'); out.add('lily'); }
            else if (fac.type === 'sheeppen') out.add('wool');
            else if (fac.type === 'pen') out.add(this.sheet.penAnimal === 'pig' ? 'truffle' : this.sheet.penAnimal === 'goat' ? 'wool' : 'milk');
        }
        this._prodGoods = out; this._prodGoodsN = facs.length;
        return out;
    }

    // The farm's IDENTITY — what it's known for, derived from its facilities + crops. A built
    // facility is a real investment, so it leads the identity; a farm with none is known by its
    // crops. Purely derived (no rng), so it always reflects the farm as it stands today — and it's
    // the hook the coming market/barter layer reads to decide who trades what and who might pivot.
    specialty() {
        const facs = [...new Set(this.plot.facilities.map(f => f.type))];
        if (facs.length >= 2) return 'mixed homestead';
        if (facs.length === 1) return { coop: 'poultry farm', pen: 'livestock ranch', sheeppen: 'wool farm', pond: 'fishery' }[facs[0]] || 'homestead';
        const crops = (this.sheet.crops && this.sheet.crops.length) ? this.sheet.crops : [this.sheet.crop];
        return crops.length === 1 ? `${crops[0]} grower` : 'market garden';
    }

    // Warmest ally / worst grudge, for the sheet's social readout.
    topRegard(sign) {
        let best = null, bestV = 0;
        for (const [seed, v] of this.opinions) {
            if (sign > 0 ? v > bestV : v < bestV) { bestV = v; best = seed; }
        }
        if (!best) return null;
        const who = this.world.farmers.find(f => f.sheet.seed === best);
        return who ? { who, v: bestV } : null;
    }

    // Every meaningful relationship in one pass, strongest first: sign>0 lists everyone this
    // bot trusts past the threshold, sign<0 everyone they're wary of. For the sheet's TOWN
    // TIES — trust is rarely singular in a town that helps, trades and digs wells together.
    allRegard(sign, threshold = 0.15, cap = 4) {
        const out = [];
        for (const [seed, v] of this.opinions) {
            if (sign > 0 ? v <= threshold : v >= -threshold) continue;
            const who = this.world.farmers.find(f => f.sheet.seed === seed);
            if (who) out.push({ who, v });
        }
        out.sort((a, b) => sign > 0 ? b.v - a.v : a.v - b.v);
        return out.slice(0, cap);
    }

    get tired() { return this.energy < 0.35; }

    // Life pool: a hardy (high-CON) and seasoned (higher-level) hand can take more punishment.
    get maxHp() { return 12 + mod(this.sheet.stats.con) * 3 + Math.floor((this.sheet.level || 1) / 2); }

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

    adjustReputation(d) {
        const before = this.reputation;
        this.reputation = Math.max(0, Math.min(1, this.reputation + d));
        // the moment a name truly turns in town, mark it in the chronicle (once)
        if (before > 0.25 && this.reputation <= 0.25 && !this._mudFlag) {
            this._mudFlag = true;
            this.world.addChronicle('rift', `${this.sheet.name.split(' ')[0]}'s name is mud in town.`, this, null, '#c05840');
        }
    }

    gainXP(n) {
        const s = this.sheet;
        s.xp += n;
        // exponential curve — carry the overflow (don't waste a big gain), and allow a rare
        // multi-level jump when a windfall lands at low levels where thresholds are small
        let need = xpForLevel(s.level);
        while (s.xp >= need) {
            s.xp -= need; s.level++;
            const up = ['str', 'dex', 'con', 'int', 'wis', 'cha'][Math.floor(this.rand() * 6)];
            s.stats[up] = Math.min(20, s.stats[up] + 1);
            this.world.addLog(`${s.name} reached LV ${s.level}! +1 ${up.toUpperCase()}`, '#7dd069');
            this.sparkle = 2.5; this.say('LEVEL UP!', '#7dd069');
            need = xpForLevel(s.level);
        }
    }

    isBehindLeader() {
        const L = this.world.leader;
        return L && L !== this && L.sheet.harvested > this.sheet.harvested + 2;
    }

    // ---- crafting & inventory ---------------------------------------------------
    hasTool(id) { return this.tools.has(id); }
    // Storage grows with the HOME: a tipi holds a handcart's worth, the yurt a shed,
    // the cottage a proper barn of timber and ore. (Part of the housing ladder's pull.)
    storageCap() {
        // each tier's stores must comfortably exceed the NEXT tier's build cost, or a farmer could
        // never save up for the upgrade (the yurt holds enough timber+stone to bank a whole cottage).
        const lvl = this.plot.built.level;
        return lvl >= 3 ? { wood: 220, ore: 110 } : lvl >= 2 ? { wood: 140, ore: 75 } : { wood: 45, ore: 22 };
    }
    // how many crops one 'water' action serves — a can/rig waters several at once
    waterReach() { return this.hasTool('sprinkler') ? 5 : this.hasTool('wateringCan') ? 3 : 1; }

    // the next recipe this bot is both leveled-for and stocked-for (materials in hand)
    #nextCraftable() {
        for (const r of CRAFTABLES) {
            if (this.tools.has(r.id)) continue;
            if (this.sheet.level < r.reqLevel) continue;
            if (r.requires && !this.tools.has(r.requires)) continue;
            if (this.ore < r.ore || this.wood < r.wood) continue;
            return r;
        }
        return null;
    }
    // the next recipe they're STILL WORKING TOWARD (leveled or not) — for the UI hint
    nextUnlock() {
        for (const r of CRAFTABLES) {
            if (this.tools.has(r.id)) continue;
            if (r.requires && !this.tools.has(r.requires)) continue;
            return r;
        }
        return null;
    }

    // walk home and build a tool when eligible. Rare (once per tool), so the trip home
    // is fine — crafting is a homestead investment like upgrading the house.
    #maybeCraft() {
        if (this.world.isNight()) return false;
        const r = this.#nextCraftable();
        if (r) {   // materials in hand — walk home and forge it
            this.craftTarget = r;
            this.think(`ENOUGH ORE — TIME TO FORGE A ${r.name}`);
            const d = this.world.houseDoor(this.plot);
            return this.#goTo(d.i + 0.5, d.j + 0.5, 'craft');
        }
        // leveled for the next tool but short on ore? go mine toward it — an intentional goal,
        // the way farmers gather wood to expand. Only once the home is built (no ore rivalry).
        const next = this.nextUnlock();
        if (next && this.plot.built.level >= 1 && this.sheet.level >= next.reqLevel &&
            this.wood >= next.wood && this.ore < next.ore && this.energy > 0.35) {
            const rock = this.world.nearestRock(this.pos, 34);
            if (rock) { this.think(`MINING ORE FOR A ${next.name}`); this.mineTarget = rock; return this.#goTo(rock.i + 0.5, rock.j + 0.5, 'mine'); }
            if (this.#seekOreAfar(next.name)) return true;   // no rock nearby → venture to the highlands
        }
        return false;
    }

    #completeCraft() {
        const r = this.craftTarget; this.craftTarget = null;
        const w = this.world, s = this.sheet;
        // eligibility can lapse between deciding and arriving (materials spent elsewhere)
        if (!r || this.tools.has(r.id) || this.ore < r.ore || this.wood < r.wood) { this.state = 'decide'; return; }
        this.ore -= r.ore; this.wood -= r.wood;
        this.tools.add(r.id);
        this.sparkle = 2.5; this.say('CRAFTED!', '#7dd069');
        w.addLog(`${s.name} crafted a ${r.name}! (${r.desc})`, '#8ad0e0');
        this.remember('lesson', `forged a ${r.name.toLowerCase()} - ${r.desc.toLowerCase()}`, null, 1.1);
        this.gainXP(4);
        this.state = 'decide';
    }

    // items this bot actually holds, for the inventory grid. Only non-zero stacks.
    // wood/ore carry their house-tier storage cap so the UI can show "12 / 40".
    inventoryItems() {
        const out = [];
        const caps = this.storageCap();
        const push = (id, count, cap) => { if (count > 0 && ITEMS[id]) out.push({ id, name: ITEMS[id].name, icon: ITEMS[id].icon, count, cap }); };
        push('wood', this.wood, caps.wood);
        push('ore', this.ore, caps.ore);
        // crops broken out by TYPE with their provenance (raised on the farm / stolen / foraged in the
        // wilds). Foraged WILD wheat (goods.wheat) is FOLDED into the wheat stack as "foraged" — it's the
        // same grain in the pouch, so we don't split wild from grown for now (may become "wild grass" later).
        const g = this.sheet.goods || {};
        const cs = this.sheet.cropStock || {};
        const wildWheat = g.wheat || 0;
        const cropTypes = new Set(Object.keys(cs));
        if (wildWheat > 0) cropTypes.add('wheat');
        for (const type of cropTypes) {
            const e = cs[type] || { grown: 0, stolen: 0, found: 0 };
            const found = (e.found || 0) + (type === 'wheat' ? wildWheat : 0);
            const count = (e.grown || 0) + (e.stolen || 0) + found;
            if (count > 0) out.push({ id: 'crop:' + type, crop: type, name: type.charAt(0).toUpperCase() + type.slice(1),
                                      count, sources: { grown: e.grown || 0, stolen: e.stolen || 0, found } });
        }
        for (const key of ['flower']) push(key, g[key] || 0);   // wheat folded above; flower stays a foraged good
        // wild-caught goods drawn with a procedural sprite (resolved renderer-side): fish is its own
        // item, lilies too — the yield of the wild-water fishing bounty.
        for (const key of ['fish', 'lily']) { const n = g[key] || 0; if (n > 0) out.push({ id: key, good: key, name: key === 'fish' ? 'Fish' : 'Lily pad', count: n }); }
        // hunted MEAT — prized barter good + HP restorative, drawn from the fantasy-icon sheet
        for (const key of MEAT_GOODS) { const n = g[key] || 0; if (n > 0) out.push({ id: key, good: key, name: MEAT_NAME[key], count: n }); }
        return out;
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
    // skipFacilities=true limits this to CROP work — ripe/thirsty/withered crops wither if
    // neglected, so they're truly time-sensitive; facility produce (eggs/milk/lily/fish) just
    // sits ready and shouldn't monopolize a farmer ahead of keeping the plot clear.
    #nextTaskOnPlot(plot, thirstThreshold = 0.32, urgentOnly = false, skipFacilities = false) {
        // 1. collect anything ready (ripe crops, eggs, milk, blooms, catchable fish)
        const readyProd = skipFacilities ? null : this.#findProducer(p => p.ready, plot);
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
        const hungry = skipFacilities ? null : this.#findProducer(p => p.fed < 0.35, plot);
        if (hungry) return { act: 'tend', prod: hungry };
        if (urgentOnly) return null;
        // 4. sow + till (crop farms only) — lowest priority "fill" work. Frozen out in winter:
        //    the ground won't take seed, so farmers spend the season on livestock and other work.
        if (!this.world.canGarden()) return null;
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

    // the neighbour within `range` this bot most resents (opinion < -0.3), or null — used to
    // physically steer away from someone they can't stand
    #dislikedNear(range = 9) {
        let worst = null, wv = -0.3;
        for (const o of this.world.farmers) {
            if (o === this) continue;
            const v = this.opinionOf(o);
            if (v < wv && Math.abs(o.pos.i - this.pos.i) + Math.abs(o.pos.j - this.pos.j) < range) { wv = v; worst = o; }
        }
        return worst;
    }

    #nearestNeighborLoot(range = 9) {
        // a collectible on someone else's plot (ripe crop OR ready producer) for poaching
        let best = null, bestD = range;
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

    // Falling ill is a lesson: the bot grows more cautious so it stops repeating the overwork
    // that put it here. Caution counterweights a competitive/driven personality without erasing it.
    fallIll(days, cause = 'overworking') {
        this.health = 'sick';
        this.sickDays = days;
        this.energy = Math.min(this.energy, 0.3);
        this.hp = Math.min(this.hp, this.maxHp * 0.7);   // illness saps your strength; rest mends it, neglect drains more
        this.strain = 0;
        this.illnesses++;
        this.caution = Math.min(4, this.caution + 1);
        this.think(this.illnesses > 1 ? 'SICK AGAIN — I HAVE TO PACE MYSELF.' : 'I OVERDID IT. TIME TO WORK SMARTER.');
        this.remember('lesson', this.illnesses > 1
            ? `Sick AGAIN from ${cause} (${this.illnesses}x now) - I keep making this mistake`
            : `Fell ill from ${cause} - ${days} days lost. Must pace myself`, null, 1.2);
    }

    // Contribute to the active town project: haul stored materials, gather what's missing, or
    // carve once the stock is in. Returns true if it committed to an action this tick.
    #pursueProject() {
        const w = this.world, pr = w.project;
        if (!pr) return false;
        const site = pr.site;
        if (w.projectNeedsMaterials(pr)) {
            const canGive = (pr.wood < pr.needWood && this.wood > 0) || (pr.ore < pr.needOre && this.ore > 0);
            if (canGive) { this.think(`HAULING STONE FOR THE ${pr.label}`); if (this.#goTo(site.i + 0.5, site.j + 1.6, 'projdrop')) return true; }
            else if (pr.wood < pr.needWood) {
                const src = w.nearestWood(this.pos);
                if (src) { this.think(`TIMBER FOR THE ${pr.label}`); if (this.#goToWood(src)) return true; }
            } else if (pr.ore < pr.needOre) {
                const rock = w.nearestRock(this.pos, 60);
                if (rock) { this.think(`STONE FOR THE ${pr.label}`); this.mineTarget = rock; if (this.#goTo(rock.i + 0.5, rock.j + 0.5, 'mine')) return true; }
                else if (this.#seekOreAfar(pr.label)) return true;   // valley tapped out → expedition
            }
            return false;   // nothing haulable/gatherable right now — get on with the farm
        }
        this.think(`RAISING THE ${pr.label}!`);
        // already at the site? build in place — don't re-walk on every redecide (the jitter)
        if (Math.abs(this.pos.i - (site.i + 0.5)) + Math.abs(this.pos.j - (site.j + 1.6)) < 2.2 + (pr.size || 1)) { this.state = 'build'; return true; }
        const off = (this.sheet.seed % 3) - 1;
        if (!this.#goTo(site.i + 0.5 + off, site.j + 1.6 + (pr.size || 1) - 1, 'build')) this.#goTo(site.i + 0.5, site.j + 1.6, 'build');
        return true;
    }

    // Everything a farm makes I can spare — timber beyond what my ambition is saving toward, crops
    // over a small reserve, and ALL of my facility/forage goods (eggs, wool, lilies, fish, milk...).
    // Each carries its own town-XP value. Returned biggest-pile first so a spread gets given.
    #donatableSurplus() {
        const out = [];
        const woodSave = this.wantUpgrade ? (HOUSE_TIERS[this.plot.built.level + 1]?.wood || 0)
                       : (this.wantExpand || this.wantFacility) ? FENCE_WOOD : DONATE_KEEP;
        if (this.wood - woodSave > 0) out.push({ good: 'wood', n: this.wood - woodSave });
        const crops = (this.sheet.produce || 0) - DONATE_KEEP_CROPS;
        if (crops > 0) out.push({ good: 'crops', n: crops });
        const g = this.sheet.goods || {};
        for (const k in g) if (g[k] > 0) out.push({ good: k, n: g[k] });   // facility + forage goods: all spare
        out.sort((a, b) => b.n - a.n);
        return out;
    }
    #spendGood(good, n) {
        if (good === 'wood') this.wood = Math.max(0, this.wood - n);
        else if (good === 'ore') this.ore = Math.max(0, this.ore - n);
        else if (good === 'crops') { this.sheet.produce = Math.max(0, (this.sheet.produce || 0) - n); spendCropStock(this.sheet, n); }
        else { this.sheet.goods[good] = Math.max(0, (this.sheet.goods[good] || 0) - n); }
    }

    // Growing the TOWN: a public-spirited settler hauls a basket of surplus — timber, crops AND
    // livestock/facility produce — to the silo, which is the town's XP. Only when they've no pressing
    // personal build to save for, and only every few days. When the town's young and they've nothing
    // spare, the most civic go CUT timber expressly to give (the demand that keeps stumps grubbed).
    #pursueDonation() {
        const w = this.world;
        if (w.townLevel >= TOWN_MAX_LEVEL) return false;                       // town's built out
        if (this.donateCooldown > 0 || this.p.collaboration < 0.3) return false;
        if (w.isNight() || this.energy < 0.4) return false;
        const spare = this.#donatableSurplus().reduce((s, x) => s + x.n, 0);
        if (spare >= DONATE_BATCH) {
            this.think('SURPLUS GOODS FOR THE TOWN SILO');
            return this.#goTo(w.silo.i + 0.5, w.silo.j + 1.2, 'donate');
        }
        // young town, no personal ambition pending, strongly collaborative -> cut timber to GIVE
        if (!this.wantUpgrade && !this.wantExpand && !this.wantFacility && this.p.collaboration > 0.5) {
            this.think('TIMBER TO GROW THE TOWN');
            return this.#goChop();
        }
        return false;
    }

    #completeDonate() {
        const w = this.world;
        const surplus = this.#donatableSurplus().filter(s => s.n > 0);
        if (!surplus.length) return;
        // round-robin a few units from each good in turn so the basket is a genuine MIX (crops,
        // timber AND livestock/facility produce) instead of one big pile swamping the whole batch
        let budget = DONATE_BATCH; const taken = {};
        let progressed = true;
        while (budget > 0 && progressed) {
            progressed = false;
            for (const s of surplus) {
                if (budget <= 0) break;
                const remain = s.n - (taken[s.good] || 0);
                if (remain <= 0) continue;
                const step = Math.min(remain, 3, budget);   // up to 3 of each per round
                taken[s.good] = (taken[s.good] || 0) + step;
                budget -= step; progressed = true;
            }
        }
        let given = 0, xp = 0;
        const parts = [];
        for (const good in taken) {
            const take = taken[good];
            this.#spendGood(good, take);
            w.coffers[good] = (w.coffers[good] || 0) + take;
            xp += take * (DONATE_XP[good] ?? DONATE_XP_DEFAULT);
            given += take;
            parts.push(`${take} ${good}`);
        }
        if (given <= 0) return;
        w.addTownXP(xp);
        this.gainXP(2);
        this.mood = Math.min(1, this.mood + 0.08);
        this.sparkle = 1.5;
        this.say(`+${given} to the silo`, '#f0d060');
        this.remember('event', `Gave ${parts.join(', ')} to the town silo — we grow this place together`, null, 0.8);
        this.donateCooldown = 2 + Math.floor(this.rand() * 3);   // days before the itch to give returns
    }

    // True when a lightning-battered farmer should drop routine chores to raise the guardian: the
    // active project IS the monument, the sky isn't fully warded yet, and either they took a
    // personal loss or the town as a whole has been hit hard. This is the "learned from the
    // storms, act on it tomorrow" behavior — it lifts guardian-raising above facility busywork.
    #stormDrivenStatue() {
        const pr = this.world.project;
        return !!pr && typeof pr.type === 'string' && pr.type.startsWith('statue') &&
            this.world.lightningMult > 0.25 && (this.stormLosses >= 1 || this.world.stormLosses >= 4);
    }

    // Losing a crop to lightning is a lesson too: the storms keep taking the harvest while no
    // guardian wards the sky, so the farmer resolves (in the journal, and in tomorrow's chores)
    // to help raise the monument. Throttled so a bad storm leaves one lingering memory, not spam.
    recordStormLoss(cropType) {
        this.think('THE STORMS KEEP TAKING MY CROPS');
        if (this.stormLosses === 1 || this.stormLosses % 3 === 0) {
            this.remember('lesson', this.world.statue
                ? `The storms still bite - we should raise the guardian higher`
                : `Lightning took my ${cropType} - the town needs a guardian to ward the sky`, null, 1.2);
        }
    }

    #shouldSleepNow() {
        if (this.health === 'sick') return true;
        if (this.energy < 0.2 + this.caution * 0.05) return true;   // learned bots turn in sooner
        const np = this.world.nightProgress();
        let threshold = 0.1 + this.p.diligence * 0.55;
        if (this.isBehindLeader()) threshold += this.p.competitiveness * 0.3;
        threshold -= this.caution * 0.09;   // and don't burn the midnight oil after past illnesses
        return np > Math.min(Math.max(threshold, 0.15), 0.85);
    }

    // Reflection: once a day the bot rereads its own journal and can set (or change) its
    // own course. Goals aren't scripted per archetype — they emerge from what actually
    // happened to THIS bot, and they bend the standard rules elsewhere (takeHelp,
    // chooseReward, sick visits, the grind, the co-op).
    reflect() {
        const j = this.journal, p = this.p;

        // a new day's mood: an emotional random walk, its amplitude the `volatility` trait.
        // Even-keeled bots barely move; the mercurial can wake up transformed.
        this.mood = Math.max(-1, Math.min(1, this.mood * 0.55 + (this.world.rand() - 0.5) * 2 * this.volatility));
        // yesterday's rumors fade slowly — a warning lingers a couple of weeks before it's forgotten
        if (this.gossip.length) { for (const g of this.gossip) g.strength *= 0.93; this.gossip = this.gossip.filter(g => g.strength > 0.2); }
        // the moody's slow burn: a genuine plea for help still hanging a day later stings —
        // they sour and quietly blame the town's most able hand for leaving them to it
        if (this.volatility > 0.5 && this.world.day - this.helpPostedDay >= 1 &&
            this.world.helpBoard.some(r => r.farmer === this && r.genuine)) {
            this.mood = Math.max(-1, this.mood - 0.5);
            const able = this.world.leader;
            if (able && able !== this) this.adjustOpinion(able, -0.16, 'left me to it when I asked for help');
            this.think('I ASKED FOR HELP. NOBODY CAME.');
        }

        const burned = j.filter(m => m.kind === 'person' && /welch|trick|thiev|stole|short/i.test(m.text)).length;
        const warm = j.filter(m => (m.kind === 'person' || m.kind === 'event') && /hand|soup|paid|dug|nursed/i.test(m.text)).length;
        const deals = this.jobStats.accepted + this.jobStats.haggled;
        let goal = this.goal;
        if (burned >= 2 && p.collaboration < 0.75) goal = 'lone wolf';           // burned too often — go it alone
        else if (warm >= 4 && p.collaboration > 0.45) goal = 'good neighbor';    // kindness has kept paying off
        else if (this.world.leader === this && p.competitiveness > 0.55) goal = 'harvest king';
        else if (deals >= 6 && p.honesty < 0.5) goal = 'sharp trader';           // the deals ARE the game
        else if (!goal && p.diligence > 0.7) goal = 'master farmer';
        if (goal !== this.goal) {
            const hadCourse = !!this.goal;   // a genuine REVISION of an existing course vs. a first calling
            this.goal = goal;
            const creed = GOAL_CREEDS[goal];
            this.think(creed);
            this.remember('lesson', `Set my own course: ${goal} - ${creed.toLowerCase()}`, null, 1.3);
            this.world.addLog(`${this.sheet.name} has set their own course: ${goal.toUpperCase()}`, '#d08cc8');
            // Legibility: an agent REWEIGHING its lived experience and CHANGING its approach is a
            // story beat, so a genuine change of heart lands in the town chronicle (a first calling
            // stays quieter — just the activity log above).
            if (hadCourse) this.world.addChronicle('found',
                `${this.sheet.name.split(' ')[0]} had a change of heart — now set on the ${goal} path.`, this, null, '#d08cc8');
        }
    }

    #maybeAskForHelp() {
        if (this.helpCooldown > 0) return;
        if (this.goal === 'lone wolf') return;   // asks nobody for anything
        const pending = this.#countPending(this.plot);
        const weak = mod(this.sheet.stats.str) <= 0 || mod(this.sheet.stats.dex) <= 0;
        let genuine = true, ask = false;
        if (pending >= 4 && weak) ask = true;
        // the manipulator cries wolf to get free labor — the more crooked they are, the oftener
        else if (this.p.honesty < 0.4 && this.rand() < 0.04 + Math.max(0, 0.4 - this.p.honesty) * 0.35) { ask = true; genuine = false; this.think('IF I LOOK BUSY, SOMEONE WILL HELP'); }
        if (ask) {
            this.world.postHelp(this, genuine);
            this.helpCooldown = 30;
            if (genuine) { this.helpPostedDay = this.world.day; this.think('SO MUCH TO DO... I COULD USE A HAND'); }
        }
    }

    // Combat capability is PHYSICAL — bare hands and a hoe — so it's STR + CON, with only a slim
    // bump from experience. Tilling fields to level 18 doesn't make you a warrior.
    combatMod() { return mod(this.sheet.stats.str) + mod(this.sheet.stats.con) + Math.floor((this.sheet.level || 1) / 8); }

    // Survival priority: if a threat is on ME, face it; if I've rallied to someone else's fight, press
    // on to it. Returns true if combat claimed this decide tick.
    #handleCombat() {
        const w = this.world;
        const mine = w.encounterFor(this);
        if (mine) { this.#faceThreat(mine); return true; }
        const helping = w.encounters.find(e => !e.done && e.helpers.has(this));
        if (helping) {
            this.think(`HELPING vs ${helping.def.name.toUpperCase()}`);
            const d = Math.hypot(this.pos.i - helping.i, this.pos.j - helping.j);
            if (d > 1.3) { if (!this.#goTo(helping.i, helping.j, 'fight')) { this.fightTimer = 0.6; this.state = 'fight'; } return true; }
            this.fightTimer = 0.8; this.state = 'fight'; return true;
        }
        if (this.combatStance) this.combatStance = null;   // stance left set but no fight involves me
        return false;
    }

    // Meet the threat by nature: the bold + strong + competitive STAND (and are favoured by the odds);
    // the timid or outmatched FLEE for the plaza and cry for help. Beasts are less terrifying than foes.
    #faceThreat(e) {
        const w = this.world, def = e.def;
        if (this.combatStance == null) {
            // LEVEL is the biggest factor in whether they'll stand: a green level-1 hand has no
            // business trading blows with an orc, whatever their raw STR — they flee and fetch help.
            // Then personality (nerve/competitiveness), the foe's menace, and any hard-won WARINESS
            // from past maulings tilt the call.
            // physical edge (STR/CON) against the beast's toughness — level barely enters it
            const powerGap = this.combatMod() * 1.5 - (def.diff - 9) - def.hp * 1.4;
            const nerve = 0.4 + powerGap * 0.14 + this.p.competitiveness * 0.3 + this.p.diligence * 0.1
                        - (def.menace - 0.8) * 0.3 - (this.threatWary[def.kind] || 0) * 0.2;
            this.combatStance = nerve > 0.5 ? 'fight' : 'flee';
            // voice WHY they'll stand or run — the enemy + how they rate their odds
            if (this.combatStance === 'fight') this.say(powerGap > 4 ? `just ${def.name} — come on!` : `${def.name}? i'll chance it`, '#e0c040');
            else { this.say(powerGap < -3 ? `${def.name} — no match, HELP!` : `${def.name}! RUN!`, '#e05040'); e.helpWanted = true; }
        }
        // bloodied mid-fight? break off and run rather than fight to the ground (unless help's at hand)
        if (this.combatStance === 'fight' && this.hp < this.maxHp * 0.35 && e.helpers.size === 0) {
            this.combatStance = 'flee'; this.say('TOO STRONG — FALL BACK!', '#e05040'); e.helpWanted = true;
        }
        if (this.combatStance === 'fight') {
            this.think(`FIGHTING ${def.name.toUpperCase()}`);
            if (Math.hypot(this.pos.i - e.i, this.pos.j - e.j) > 1.3) {
                if (!this.#goTo(e.i, e.j, 'fight')) { this.fightTimer = 0.6; this.state = 'fight'; }
                return;
            }
            this.fightTimer = 0.8; this.state = 'fight'; return;   // hold + trade blows (encounter tick resolves)
        }
        this.think(`RUN — ${def.name.toUpperCase()}!`); this.fleeTimer = 0.5; this.state = 'flee';   // bolt for the plaza
    }

    // Brave neighbours answer a threat: either a cry for help within earshot, OR a foe that's strayed
    // into the village within sight — then they defend their town, property and livestock on instinct.
    #maybeRallyToThreat() {
        const w = this.world;
        for (const e of w.encounters) {
            if (e.done || e.target === this || e.helpers.has(this)) continue;
            const d = Math.hypot(this.pos.i - e.i, this.pos.j - e.j);
            const inVillage = w.threatInVillage(e);
            if (!((e.helpWanted && d < 26) || (inVillage && d < 15))) continue;   // heard the call / saw it in town
            const grit = inVillage ? 0.35 : 0.5;   // more willing to stand for home turf
            const brave = this.p.competitiveness * 0.4 + this.effCollab() * 0.5
                        + (this.sheet.stats.str >= 12 ? 0.15 : 0) - (e.def.menace - 0.8) * 0.3;
            if (brave < grit) continue;
            e.helpers.add(this); this.combatStance = 'fight';
            this.say(inVillage ? 'NOT IN MY TOWN!' : "HELP'S COMING!", '#e0c040');
            if (!this.#goTo(e.i, e.j, 'fight')) { this.fightTimer = 0.6; this.state = 'fight'; }
            return true;
        }
        return false;
    }

    // Travel from the plaza out to the ground this founder was drawn to, and STAKE it on arrival.
    // Until then their plot is only a reservation — nothing on the map — so plots appear one by one
    // as founders reach and claim their land, rather than all pre-outlined from the first frame.
    #seekHomestead() {
        const w = this.world, list = this.scoutList;
        if (!list || !list.length) {   // safety — no itinerary, stake the claim if we have one
            if (this.claim) w.claimHomestead(this); else this.plot.sited = true; return;
        }
        const stop = list[Math.min(this.scoutIdx, list.length - 1)];
        if (Math.abs(this.pos.i - (stop.i + 0.5)) + Math.abs(this.pos.j - (stop.j + 0.5)) >= 2.5) {
            this.think('SCOUTING FOR GOOD GROUND TO SETTLE');            // still walking to this spot
            if (!this.#goTo(stop.i + 0.5, stop.j + 0.5, 'scout')) this.#backoff();
            return;
        }
        if (stop.best) { w.claimHomestead(this); return; }              // reached the chosen ground — stake it
        this.say(stop.note, '#c8a878'); this.think('NOT HERE — KEEP LOOKING');   // pass on this spot, say why
        this.scoutIdx++; this.scoutTimer = 1.4; this.state = 'scout';   // pause a beat to weigh it, then move on
    }

    // A raw settler clears their land, fences it, then raises a house — before normal farming.
    // Returns true if it took an action this tick.
    #pursueHomestead() {
        const w = this.world, p = this.plot;
        if (p.built.level >= 1 || w.isNight()) return false;
        const c = HOUSE_TIERS[1];
        // desperation escape: exposed for many nights and still no way to build a proper home
        // (can't stockpile the timber) -> throw up a bare free lean-to so they don't die of
        // exposure in an unwinnable spot. Rare — only when wood is effectively unavailable.
        if (this.nightsExposed >= 6 && this.wood < c.wood && !w.nearestWood(this.pos)) {
            p.built.fence = true; p.fenceTarget = Math.max(1, p.fenceTarget || 1); p.fencePosts = p.fenceTarget; p.rev++;
            p.building = null;
            w.raiseBuilding(this, 1, true);
            w.addLog(`${this.sheet.name} cobbled together a rough lean-to just to survive.`, '#e0a03c');
            this.say('shelter, at last', '#e0a03c'); this.sparkle = 1; this.nightsExposed = 0;
            return true;
        }
        // 1) fence the claim first — one post at a time (a real chunk of work)
        if (!p.built.fence) {
            if (!p.fenceTarget) p.fenceTarget = w.fencePostTarget(p);
            // the whole fence line must be clear first — no post goes up while a rock/tree/brush
            // still sits on ANY border tile. Clear the nearest such obstacle, then raise posts.
            const blocker = this.#nearestFenceLineObstacle(p);
            if (blocker) {
                this.think('CLEARING THE FENCE LINE');
                if (this.#clearObstacle(blocker)) return true;
                // genuinely unreachable (e.g. a rock walled in by water) — give up on it so the
                // fence can still finish instead of retrying the same tile forever.
                (p.fenceSkip || (p.fenceSkip = new Set())).add(pkey(blocker.i, blocker.j));
                this.#backoff(); return true;
            }
            // every fence post costs real wood, and the farmer must have it ON HAND to raise one —
            // no fencing from nothing. A whole perimeter is a genuine lumber sink (see FENCE_POST_WOOD).
            if (this.wood < FENCE_POST_WOOD) {
                this.think(this.wood > 0 ? 'NEED MORE WOOD FOR THE FENCE' : 'GATHERING WOOD TO FENCE MY LAND');
                if (this.#goChop()) return true;
                this.#backoff(); return true;
            }
            const spot = w.fencePostSpot(p, p.fencePosts);   // fence line is clear now — pick a post spot
            this.pendingFence = { cost: FENCE_POST_WOOD };
            this.think(`RAISING FENCE POST ${p.fencePosts + 1}/${p.fenceTarget}`);
            if (this.#goTo(spot.i + 0.5, spot.j + 0.5, 'fencepost')) return true;
            p.fencePosts++; this.#backoff(); return true;   // spot unreachable — skip it, don't loop
        }
        // 2) clear the whole building site of trees/rocks/brush
        if (!w.houseSiteClear(p)) {
            const b = this.#nearestSiteBlocker();
            if (b) { this.think('CLEARING GROUND FOR MY HOME'); this.#clearObstacle(b); return true; }
        }
        // 3) pitch the level-1 tipi once timber + stone are stockpiled — a WORKED build now: lay a
        //     foundation, then labour it up shift by shift (see #buildHouse)
        if (p.building || (this.wood >= c.wood && this.ore >= c.ore)) return this.#buildHouse(1);
        // 4) gather what's still missing (stone, then timber)
        if (this.ore < c.ore) {
            const rock = w.nearestRock(this.pos, 40);
            if (rock) { this.mineTarget = rock; if (this.#goTo(rock.i + 0.5, rock.j + 0.5, 'mine')) { this.think('MINING STONE FOR MY HOME'); return true; } }
            if (this.#seekOreAfar('HOME')) return true;   // no stone within reach → highland expedition
        }
        this.think(this.wood > 0 ? 'MORE TIMBER FOR MY HOME' : 'FELLING TIMBER FOR MY HOME');
        if (this.#goChop()) return true;
        this.#backoff(); return true;
    }
    #backoff() { this.state = 'idle'; this.wanderTimer = 1.5 + this.rand() * 2; }
    #pickLine(arr) { return arr[Math.floor(this.rand() * arr.length)]; }

    #scriptedChat(other, op, rop, grudge, vivid) {
        const w = this.world;
        let speakerLine = null;
        let speakerColor = '#c8ccd8';
        let weight = 0.45;

        if (op >= 0.4) {
            speakerLine = this.#pickLine([
                'GOOD TO SEE YOU, FRIEND!',
                'WE MAKE A FINE TEAM.',
                'YOUR HELP STUCK WITH ME.',
                'THIS PLACE FEELS LESS LONELY.',
            ]);
            speakerColor = '#7dd069';
            weight = 0.62;
        } else if (op <= -0.35) {
            speakerLine = this.#pickLine([
                "I HAVEN'T FORGOTTEN.",
                'WATCH YOURSELF.',
                'WE ARE NOT SQUARE.',
                'KEEP TO YOUR OWN ROWS.',
            ]);
            speakerColor = '#c05840';
            weight = 0.72;
        } else if (other === w.leader && this.p.competitiveness > 0.6) {
            speakerLine = this.#pickLine(["I'LL PASS YOU YET.", 'ENJOY THE LEAD... FOR NOW.', 'YOUR LEAD HAS A SHADOW.']);
            speakerColor = '#e0a03c';
        } else if (this === w.leader) {
            speakerLine = this.#pickLine(['KEEP AT IT!', 'FINE DAY FOR FARMING.', 'THE TOWN RISES WITH US.']);
        } else if (vivid && this.rand() < 0.62) {
            const sour = /welch|trick|thiev|stole|toll|turned|behind|owe/i.test(vivid.text);
            if (vivid.kind === 'job') {
                speakerLine = sour ? "WE'RE NOT SQUARE YET." : 'GOOD WORK STICKS AROUND.';
                speakerColor = sour ? '#c05840' : '#e8c860';
            } else if (vivid.kind === 'event') {
                speakerLine = this.#pickLine(['WE BUILT MORE THAN WOOD.', 'THAT DAY STILL HOLDS ME UP.', 'THE TOWN REMEMBERS WORK.']);
                speakerColor = '#8fc7e8';
            } else {
                speakerLine = sour ? `DAY ${vivid.day} STILL STINGS.` : `DAY ${vivid.day} STILL WARMS ME.`;
                speakerColor = sour ? '#c05840' : '#7dd069';
            }
            weight = sour ? 0.72 : 0.62;
        } else if (w.project && this.rand() < 0.45) {
            const left = Math.max(0, Math.ceil(w.project.needed - w.project.points));
            speakerLine = left > 0 ? `${w.project.label} NEEDS ${left} MORE.` : `${w.project.label} IS NEAR DONE.`;
            speakerColor = '#e8c860';
        } else if (!w.board && this.rand() < 0.35) {
            speakerLine = 'WE NEED A BOARD FOR JOBS.';
            speakerColor = '#e8c860';
        } else if (this.goal && this.rand() < 0.42) {
            const goalLines = {
                'good neighbor': ['A FARM IS A PROMISE.', 'HELP GIVEN RETURNS HOME.'],
                'lone wolf': ['QUIET ROWS SUIT ME.', 'I TRUST WORK MORE THAN TALK.'],
                'harvest king': ['EVERY ROW IS A SCORECARD.', 'THE HARVEST WILL KNOW ME.'],
                'sharp trader': ['FAIR TERMS KEEP FRIENDS.', 'A DEAL TELLS THE TRUTH.'],
                'master farmer': ['I AM LEARNING THE LAND.', 'THE SOIL ANSWERS PATIENCE.'],
            };
            speakerLine = this.#pickLine(goalLines[this.goal] || ['WE KEEP LEARNING HERE.']);
            speakerColor = '#8a9ade';
        } else if (grudge && grudge.v < -0.3 && grudge.who !== other && this.rand() < 0.4) {
            speakerLine = `DON'T TRUST ${shortName(grudge.who).toUpperCase()}...`;
            speakerColor = '#c9a45a';
        } else if (w.weather === 'storm') {
            speakerLine = this.#pickLine(['SKY SOUNDS ANGRY TODAY.', 'COUNT YOUR ROOF BEAMS.']);
            speakerColor = '#8a9ade';
        } else if (w.weather === 'rain') {
            speakerLine = this.#pickLine(['RAIN DOES HALF OUR WORK.', 'THE FIELDS ARE DRINKING.']);
            speakerColor = '#8fc7e8';
        } else if (w.weather === 'drought') {
            speakerLine = this.#pickLine(['THE DIRT IS ASKING LOUDLY.', 'EVERY DROP COUNTS TODAY.']);
            speakerColor = '#e0a03c';
        } else {
            speakerLine = this.#pickLine(['MORNING!', 'HOW GOES THE HARVEST?', 'WHAT DID THE SOIL TELL YOU?', 'STILL HERE. STILL TRYING.']);
        }

        let listenerLine;
        let listenerColor = rop <= -0.35 ? '#c05840' : '#c8ccd8';
        if (rop >= 0.4) {
            listenerLine = this.#pickLine(['ALWAYS, FRIEND.', 'I REMEMBER TOO.', 'WE KEEP EACH OTHER STANDING.']);
            listenerColor = '#7dd069';
        } else if (rop <= -0.35) {
            listenerLine = this.#pickLine(['...', 'MIND YOUR OWN ROWS.', 'NOT TODAY.']);
        } else if (w.project && /NEEDS|DONE|BOARD|JOBS/.test(speakerLine)) {
            listenerLine = this.#pickLine(['I CAN SPARE A HAND.', 'POST IT WHERE ALL CAN SEE.', 'THAT WOULD HELP US ALL.']);
            listenerColor = '#e8c860';
        } else if (w.weather === 'rain' || w.weather === 'storm') {
            listenerLine = this.#pickLine(['WEATHER HAS A TEMPER.', 'THE ROOF WILL TELL.']);
            listenerColor = '#8a9ade';
        } else {
            listenerLine = this.#pickLine(['LIKEWISE.', "CAN'T COMPLAIN.", 'AYE.', 'WELL ENOUGH.', 'ONE ROW AT A TIME.']);
        }

        return { speakerLine, listenerLine, speakerColor, listenerColor, weight };
    }

    // A neighbourly exchange whose tone is set by their standing with each other (and sometimes
    // a bit of gossip about a third party they distrust). Both bots speak; returns true if a
    // conversation happened.
    #maybeChat() {
        const w = this.world;
        if (this.chatCooldown > 0 || this.health !== 'healthy') return false;
        const busy = o => o.health !== 'healthy' || o.state === 'sleep' || o.state === 'rest' || o.state === 'sick' || o.state === 'shelter';
        const other = w.farmers.find(o => o !== this && !busy(o) && Math.abs(o.pos.i - this.pos.i) + Math.abs(o.pos.j - this.pos.j) < 3.2);
        if (!other) return false;
        // real resentment kills the small talk: if either strongly dislikes the other, they give
        // a cold shoulder and move on — no exchange (see also the wander steering-away below).
        if (Math.min(this.opinionOf(other), other.opinionOf(this)) <= -0.35) {
            this.chatCooldown = 10 + this.rand() * 10;
            if (this.opinionOf(other) <= -0.35 && this.rand() < 0.5) this.think(`NOT A WORD TO ${shortName(other).toUpperCase()}.`);
            return false;
        }
        // Not every passing counts as a conversation — a farmer stops to talk only sometimes,
        // and far more readily for a neighbour who likely has something WORTH HEARING: a seasoned,
        // successful, well-travelled hand (or the town leader). Trusted friends are easy to talk to
        // too. This keeps chatter sparse (a few a day) and skews it toward the informative.
        // Idle chatter is now RARE — a farmer mostly keeps to their work. What tips them into
        // stopping is a good REASON: a neighbour they TRUST (friendPull), or one who likely has
        // something worth hearing (infoValue: seasoned / successful / well-travelled / the leader).
        // A random pass between strangers almost never becomes a conversation.
        const infoValue = other.sheet.level * 0.015 + Math.min(0.12, other.sheet.harvested / 900) +
            Math.min(0.1, (other.discovered || 0) / 450) + (other === w.leader ? 0.08 : 0);
        const friendPull = Math.max(0, this.opinionOf(other)) * 0.28;   // trust drives it most
        const wantToTalk = 0.008 + this.effCollab() * 0.035 + infoValue + friendPull;
        if (this.rand() > wantToTalk) { this.chatCooldown = 45 + this.rand() * 35; return false; }
        // a good long lull after a real conversation — nobody chatters every minute, even at work
        this.chatCooldown = 110 + this.rand() * 70;
        other.chatCooldown = Math.max(other.chatCooldown, 70 + this.rand() * 40);
        // there's a real tip in talking to someone further along — a little learned wisdom
        if (other.sheet.level > this.sheet.level) this.gainXP(1);
        const op = this.opinionOf(other);
        const grudge = this.topRegard(-1);
        // the most vivid non-smalltalk memory involving this neighbor — history colors the greeting
        let vivid = null;
        for (const m of this.journal) if (m.who === other.sheet.seed && m.kind !== 'chat' && m.strength > 0.5 && (!vivid || m.strength > vivid.strength)) vivid = m;
        // the neighbour answers, tone set by THEIR regard for us
        const rop = other.opinionOf(this);
        // GOSSIP — an aside alongside the pleasantry: a farmer with a real grudge warns this
        // still-neutral neighbour off the one they resent. Whether it LANDS turns on the warner's
        // CREDIBILITY in the listener's eyes — do they trust the speaker (opinion), is the speaker
        // well-regarded in town (reputation), are they known to be honest? A trusted, honest witness
        // is believed and the third party's trust drops BEFORE they ever deal with the offender (so a
        // caught thief's ill name spreads through the net); a known liar's poison is discounted, and
        // smearing others when you're not trusted only makes YOU look worse. This is how reputation
        // propagates socially, not just victim<->offender.
        if (grudge && grudge.v < -0.2 && grudge.who !== other && grudge.who !== this &&
            other.opinionOf(grudge.who) > -0.5 && this.rand() < (this.p.honesty < 0.35 ? 0.9 : 0.6)) {
            other.hearGossip(this, grudge.who);
            const cred = other.opinionOf(this) * 0.5 + (this.reputation - 0.5) + (this.p.honesty - 0.4);
            if (cred > 0.12) {
                // a believable warning: bite scales with how bad the grudge is AND the warner's credibility
                const bite = Math.min(0.22, (0.05 + Math.min(0.4, -grudge.v) * 0.3) * (0.5 + cred));
                other.adjustOpinion(grudge.who, -bite, `heard troubling things from ${shortName(this)}`);
            } else if (cred < -0.15 && this.rand() < 0.5) {
                other.adjustOpinion(this, -0.05, 'spreads nasty rumours');   // the smear backfires on the smearer
            }
        }
        const fallback = this.#scriptedChat(other, op, rop, grudge, vivid);
        if (w.tryLlmChat(this, other, { op, rop, grudge, vivid, fallback })) return true;
        w.applyChatLines(this, other, fallback, { weight: fallback.weight });
        return true;
    }
    // Save toward the next dwelling tier; upgrade when affordable. Low priority (runs after
    // normal farm work), so L2/L3 accrete slowly from surplus timber/stone over many days.
    #maybeUpgradeHome() {
        const w = this.world, p = this.plot;
        if (p.built.level < 1 || p.built.level >= 3 || w.isNight()) return false;
        if (p.building) return this.#buildHouse(p.building.level);   // an upgrade already under way — work it
        const next = p.built.level + 1;
        if (!w.canBuild(this, next)) return false;   // can't afford yet — keep farming and saving
        // EVERY upgrade demands ELBOW ROOM: a bigger house needs a bigger farm around it, so before a
        // yurt OR a cottage rises the farmer must first EXPAND the homestead past a threshold (no grand
        // house crammed into a cramped starter yard). Ambition turns to LAND first; the house waits on it.
        const minCells = next >= 3 ? World.COTTAGE_MIN_CELLS : World.YURT_MIN_CELLS;
        if (p.cells.size < minCells) {
            const info = w.expansionInfo(p);
            if (info.state !== 'blocked') {   // there's room to grow — annex land first, then build
                this.wantExpand = true;
                if (this.rand() < 0.2) this.think(`MY FARM IS TOO SMALL FOR A ${HOUSE_TIERS[next].name.toUpperCase()} — TIME TO EXPAND`);
                return this.#pursueGrowth();   // put a shift into growing the plot right now
            }
            // truly hemmed in by neighbours — let the house rise in the existing yard rather than deadlock
        }
        // afford it: clear the site of any encroaching trees/rocks/brush BEFORE laying the foundation
        if (!w.houseSiteClear(p)) {
            const b = this.#nearestSiteBlocker();
            if (b) { this.think('CLEARING SPACE TO UPGRADE MY HOME'); this.#clearObstacle(b); return true; }
        }
        this.wantUpgrade = false;
        return this.#buildHouse(next);   // lay the foundation + start the worked build (celebration on completion)
    }

    // Lay a foundation (if not already) and put in a shift raising the dwelling — a WORKED build:
    // the farmer stands at the front door of the 5x5 footprint and labours it up over many shifts.
    #buildHouse(level) {
        const w = this.world, p = this.plot;
        if (!p.building && !w.startHouseBuild(this, level)) return false;
        const b = p.building;
        if (!b) return false;
        this.think(`RAISING MY ${HOUSE_TIERS[b.level].name.toUpperCase()} — ${b.points}/${b.needed}`);
        const d = w.houseDoor(p);
        if (Math.abs(this.pos.i - (d.i + 0.5)) + Math.abs(this.pos.j - (d.j + 0.5)) < 1.9) {
            this.buildTimer = this.#laborTime('housebuild'); this.state = 'housebuild'; return true;
        }
        if (!this.#goTo(d.i + 0.5, d.j + 0.5, 'housebuild')) this.#backoff();
        return true;
    }
    #completeHouseStep() {
        this.#laborDrain('housebuild');
        if (this.plot.building) {
            this.world.buildHouseStep(this);   // advances the build; raises the house on the final shift
            this.sparkle = Math.max(this.sparkle, 0.7);
            if (this.plot.building && this.energy > 0.14) {   // more to raise and not spent -> keep hammering in place
                this.buildTimer = this.#laborTime('housebuild'); this.state = 'housebuild'; return;
            }
        }
        this.state = 'decide';
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
    // Nearest tree/rock/stump/brush sitting on a BORDER cell of the plot (i.e. on the fence line).
    #nearestFenceLineObstacle(p) {
        const w = this.world;
        let best = null, bestD = 1e9;
        const skip = p.fenceSkip;
        const consider = (i, j) => {
            if (skip && skip.has(pkey(i, j))) return;   // gave up on this unreachable one
            const t = w.get(i, j);
            let kind = null;
            if (t === T.TREE) kind = 'tree'; else if (t === T.STUMP) kind = 'stump';
            else if (t === T.ROCK) kind = 'rock'; else if (t === T.FLOWER || t === T.WHEAT) kind = 'forage';
            if (!kind) return;
            const d = Math.abs(i - this.pos.i) + Math.abs(j - this.pos.j);
            if (d < bestD) { bestD = d; best = { i, j, kind, tile: t }; }
        };
        for (const key of p.cells) {
            const c = key.indexOf(','), i = +key.slice(0, c), j = +key.slice(c + 1);
            const mT = !p.cells.has(pkey(i, j - 1)), mR = !p.cells.has(pkey(i + 1, j)), mB = !p.cells.has(pkey(i, j + 1)), mL = !p.cells.has(pkey(i - 1, j));
            if (!(mT || mR || mB || mL)) continue;   // interior cell — no fence here
            consider(i, j);                           // the border cell itself
            // clear the OUTSIDE tiles along each fenced edge too — a rock/tree there is a small
            // tile but a big sprite, so it overlaps the rail unless cleared (out to the sprite reach).
            for (let d = 1; d <= 2; d++) {
                if (mT) consider(i, j - d);
                if (mR) consider(i + d, j);
                if (mB) consider(i, j + d);
                if (mL) consider(i - d, j);
            }
        }
        return best;
    }
    // Returns true if the bot could reach the obstacle to start clearing it, false if unreachable.
    #clearObstacle(ob) {
        if (ob.kind === 'rock') { this.think('CLEARING THIS ROCK FOR MORE FIELD'); this.mineTarget = ob; return this.#goTo(ob.i + 0.5, ob.j + 0.5, 'mine'); }
        if (ob.kind === 'forage') { this.think('CLEARING BRUSH FOR MORE FIELD'); this.forageTarget = { i: ob.i, j: ob.j, tile: ob.tile }; return this.#goTo(ob.i + 0.5, ob.j + 0.5, 'forage'); }
        this.think('CLEARING TIMBER FOR MORE FIELD'); this.woodTarget = ob; return this.#goTo(ob.i + 0.5, ob.j + 0.5, ob.kind === 'stump' ? 'break' : 'chop');
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

    // A wounded farmer eats meat to heal past what rest can mend — smallest cut first (don't burn a
    // prime cut on a scratch). Returns true if they ate (heals instantly; re-decide next tick).
    #maybeEatMeat() {
        if (this.hp >= this.maxHp * 0.6 || this.state === 'fight' || this.state === 'flee') return false;
        const g = this.sheet.goods; if (!g) return false;
        for (const m of MEAT_GOODS) {
            if ((g[m] || 0) <= 0) continue;
            g[m]--;
            this.hp = Math.min(this.maxHp, this.hp + Math.round(this.maxHp * MEAT_HEAL[m]));
            this.say(`ate ${MEAT_NAME[m]}`, '#e07868'); this.sparkle = 1;
            this.remember('event', `Ate ${MEAT_NAME[m]} to mend after a scuffle`, null, 0.7);
            return true;
        }
        return false;
    }

    #decide() {
        const w = this.world, s = this.sheet;

        // stranded on a solid tile (a pond/scarecrow/facility raised underfoot)? get out first.
        if (w.pathBlocked(Math.floor(this.pos.i), Math.floor(this.pos.j))) {
            const open = w.nearestOpenTile(this.pos);
            if (open) { this.think('HOW DID I END UP HERE?!'); this.#goTo(open.i + 0.5, open.j + 0.5, 'wander'); return; }
        }

        // SURVIVAL first: a wilderness threat on me (or a fight I've rallied to) overrides all chores.
        if (this.#handleCombat()) return;
        // wounded and carrying meat? eat to mend — rest alone won't get you fight-fit anymore.
        if (this.#maybeEatMeat()) return;

        // a lived lesson made AUDIBLE: memory shaping visible behavior, not a hidden journal entry.
        // Standing on the very ground a foe once cut them down, they shun it aloud.
        for (const d of this.dangerZones) {
            if (Math.hypot(this.pos.i - d.i, this.pos.j - d.j) < 9 && this.rand() < 0.03) {
                this.say(d.kind === 'foe' ? 'not here — this is where they got me...' : 'this is where the beast had me...', '#c8a060');
                break;
            }
        }
        const wary = (this.threatWary.foe || 0) + (this.threatWary.beast || 0);
        if (wary >= 2 && this.plot.sited && this.rand() < 0.012 &&
            Math.hypot(this.pos.i - (this.plot.x + 6), this.pos.j - (this.plot.y + 6)) > 20) {
            this.say((this.threatWary.foe || 0) >= (this.threatWary.beast || 0) ? 'watch for raiders out this far...' : 'beasts prowl these wilds...', '#c8a060');
        }

        // a founder who hasn't STAKED their claim yet: travel out from the plaza, scout the ground
        // they were drawn to, and stake it on arrival (then normal homesteading begins).
        if (!this.plot.sited) { this.#seekHomestead(); return; }

        if (this.health === 'sick') { this.think('NEED TO REST AND GET WELL'); this.#goHome('sick'); return; }
        // exhaustion: worn down and still grinding -> pushed to rest; pushing through deep
        // strain can make you collapse and fall ill on the spot. Bots that have been sick before
        // rest EARLIER (learned caution) so they stop repeating the collapse.
        if (!w.isNight() && this.energy < 0.16 + this.caution * 0.05) {
            if (this.strain >= 8) {
                const save = d20(this.rand, mod(s.stats.con));
                if (save.total < 12 && !save.crit) {
                    this.fallIll(3 + Math.floor(this.rand() * 3), 'collapsing mid-shift');
                    w.addLog(`${s.name} collapsed from exhaustion and took ill! (CON ${save.total} vs 12)`, '#c05840');
                    this.say('I overdid it...', '#c05840'); this.#goHome('sick'); return;
                }
            }
            this.think(this.strain >= 5 ? 'IM BURNT OUT. I HAVE TO STOP.' : 'IM SPENT. NEED TO REST.');
            this.#goHome('rest'); return;
        }
        if (w.isNight()) {
            if (this.#shouldSleepNow()) {
                // NO ROOF, NO SLEEPING OUT IN THE OPEN: a settler without even a tipi doesn't bed down —
                // they catch their breath (rest, energy trickling back) and keep at it. Sleep is earned
                // with a roof.
                if (this.plot.built.level < 1) { this.think("NO ROOF YET — I'LL REST, NOT SLEEP"); this.#goHome('rest'); return; }
                this.think(this.p.diligence > 0.6 ? 'ONE MORE THING... OK, BED.' : 'TIME TO SLEEP'); this.#goHome('sleepwalk'); return;
            }
            this.awakeAtNight = true;
            if (w.nightProgress() > 0.4) this.workedLate = true;
        }

        // a neighbour's cry for help against a wilderness threat pulls the brave away from their chores
        if (this.#maybeRallyToThreat()) return;

        if (w.weather === 'storm') {
            const ripe = this.#findCrop(c => c.stage === 3 && !c.withered);
            if (ripe && s.stats.wis >= 13) { this.think("STORM'S HERE. SAVE THE CROPS!"); this.#pursue({ act: 'harvest', crop: ripe }, this.plot, false); return; }
            if (s.stats.con < 13) { this.think('I HATE THUNDER. HIDING.'); this.#goHome('shelter'); return; }
        }
        if (w.weather === 'blizzard') {
            // a whiteout is no place to work — all but the hardiest hunker down at home
            if (s.stats.con < 15) { this.think('WHITEOUT! GET INSIDE.'); this.#goHome('shelter'); return; }
        }

        // a rare treasure chest is worth dropping everything for — the nearest free farmer claims it
        if (w.treasure && !w.treasure.opened && !w.treasure.claimant && !w.isNight() && this.energy > 0.2) {
            const tr = w.treasure, d = Math.abs(tr.i - this.pos.i) + Math.abs(tr.j - this.pos.j);
            if (d < 40) {
                tr.claimant = this; this.think('IS THAT... TREASURE?! MINE!');
                if (this.#goTo(tr.i + 0.5, tr.j + 0.5, 'treasure')) return;
                tr.claimant = null;   // couldn't reach it — let someone else try
            }
        }

        // a new settler must clear their land, fence it, then build a house before farming
        if (this.plot.built.level < 1 && this.#pursueHomestead()) return;
        if (this.#maybeUpgradeHome()) return;

        if (this.effCollab() > 0.55 && !w.isNight()) {
            const sick = w.farmers.find(o => o !== this && o.health === 'sick' && !this.visitedSick.has(o.sheet.seed) &&
                Math.abs(o.pos.i - this.pos.i) + Math.abs(o.pos.j - this.pos.j) < 16);
            if (sick && this.rand() < (this.goal === 'good neighbor' ? 0.8 : 0.5)) {
                this.visitedSick.add(sick.sheet.seed); this.careTarget = sick;
                this.think(`${sick.sheet.name.split(' ')[0].toUpperCase()} IS SICK. I'LL LOOK IN.`);
                const cd = w.houseDoor(sick.plot);
                this.#goTo(cd.i + 0.5, cd.j + 0.5, 'care'); return;
            }
        }

        this.#maybeAskForHelp();

        let thirstThreshold = w.weather === 'drought' && mod(s.stats.wis) > 0 ? 0.55 : 0.32;
        if (this.goal === 'master farmer') thirstThreshold += 0.08;   // waters before the crop even asks

        // 1. urgent CROP care first (ripe/thirsty/withered crops are time-sensitive)
        const urgentCrop = this.#nextTaskOnPlot(this.plot, thirstThreshold, true, true);
        if (urgentCrop) { this.#thinkTask(urgentCrop); this.#pursue(urgentCrop, this.plot, false); return; }

        // 1a. LEARNED FROM THE STORMS: with crops safe for now, a town the lightning keeps
        //     blasting drops routine chores to raise/upgrade the guardian — the whole struck
        //     town converging on the monument the day after a bad storm. Sits above expansion,
        //     facility busywork and the housing treadmill; only urgent crop care outranks it.
        if (!w.isNight() && this.energy > 0.3 && this.#stormDrivenStatue()) {
            if (this.stormLosses >= 1) this.think('THE GUARDIAN WILL WARD THESE STORMS');
            if (this.#pursueProject()) return;
        }

        // 1b. keep the plot tidy: a farmer whose fields are choking with brush/trees clears them
        //     before collecting the umpteenth egg or chopping wood for MORE land. Encroachment
        //     creeps in daily, so this runs ahead of facility busywork and growth.
        if (!w.isNight() && this.energy > 0.25) {
            const ob = this.#nearestPlotObstacle();
            if (ob && this.rand() < 0.85) { this.#clearObstacle(ob); return; }
        }

        // 1b.5 the merchant's in town: swapping a surplus of goods for ore beats trekking the
        //      highlands for it, so a farmer short on stone makes the trip to the stall.
        if (this.#pursueMerchant()) return;

        // 1c. grow the homestead: gather wood, clear land, fence/build. This is a FINITE goal
        //     (expand once, then wantExpand clears until the next harvest milestone), so it must
        //     sit ABOVE the endless facility-collection treadmill or it never gets a turn —
        //     ready produce keeps, so a farmer gathering wood to expand collects the backlog after.
        if ((this.wantExpand || this.wantFacility) && !w.isNight()) {
            const grew = this.#pursueGrowth();
            if (grew) return;
        }

        // 1c.4 the housing ladder: when ambition is BLOCKED by the house (land cap hit,
        //      livestock wanted, stores overflowing), gather actively toward the next tier
        //      instead of waiting for loose change. The raise itself happens at the top of
        //      decide (#maybeUpgradeHome) the moment the materials are in hand.
        if (this.wantUpgrade && !w.isNight() && this.energy > 0.3) {
            const next = this.plot.built.level + 1;
            const c = HOUSE_TIERS[next];
            if (!c || this.plot.built.level >= 3) this.wantUpgrade = false;
            else if (this.sheet.harvested >= c.harvested) {
                if (this.wood < c.wood) {
                    const src = w.nearestWood(this.pos);
                    if (src) { this.think(`TIMBER FOR THE ${c.name.toUpperCase()} - ${this.wood}/${c.wood}`); if (this.#goToWood(src)) return; }
                } else if (this.ore < c.ore) {
                    const rock = w.nearestRock(this.pos, 50);
                    if (rock) { this.think(`STONE FOR THE ${c.name.toUpperCase()} - ${this.ore}/${c.ore}`); this.mineTarget = rock; if (this.#goTo(rock.i + 0.5, rock.j + 0.5, 'mine')) return; }
                    else if (this.#seekOreAfar(c.name.toUpperCase())) return;   // mined out at home → expedition
                } else this.wantUpgrade = false;   // affordable — the next decide pass raises it
            }
        }

        // 1c.5 craft an unlocked tool (watering can etc.) — a finite one-off investment that
        //      pays back in efficiency, so it sits above the endless facility treadmill.
        if (this.#maybeCraft()) return;

        // 1d. facility collection/tending (eggs/milk/lily/fish — ready produce keeps, so it
        //     waits behind crop care, clearing, and the finite expansion goal)
        const urgentFac = this.#nextTaskOnPlot(this.plot, thirstThreshold, true, false);
        if (urgentFac) { this.#thinkTask(urgentFac); this.#pursue(urgentFac, this.plot, false); return; }

        // 1c. neighborhood co-op: digging a shared well beats another long haul to the
        //     plaza — propose/join happens in passing; members pitch in ahead of fill work
        if (!w.isNight() && this.energy > 0.3 && this.#pursueCoop()) return;

        // 1c2. the crows have taken enough: raise a scarecrow over the fields
        if (!w.isNight() && this.birdLosses >= SCARECROW_LOSSES && this.#pursueScarecrow()) return;

        // 1d. town project: shared infrastructure beats low-priority fill work. Statues
        //     want their stone and timber HAULED first; the carving starts once it's all in.
        //     (Storm-driven guardian-raising already ran far higher up, right after crop care.)
        if (w.project && this.p.collaboration > 0.35 && this.energy > 0.3 && this.#pursueProject()) return;

        // 1d.5 grow the TOWN: with no build to fund, a civic settler hauls surplus timber to the
        //      silo (levelling the town toward its next unlock) — or cuts some expressly to give.
        if (!w.project && this.#pursueDonation()) return;

        // 1e. fill work: sow seeds, till new ground
        const fill = this.#nextTaskOnPlot(this.plot, thirstThreshold, false);

        // (plot clearing now runs up in step 1b, before expansion)

        // 2. help a posted job — BEFORE more of our own low-priority fill tilling, or a
        //    farmer with endless ground to break never gets around to lending a hand.
        //    takeHelp itself gates on personality/relationship, so loners still decline.
        if (!w.isNight() && this.energy > 0.3) {
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
        }

        // 2b. wanderlust: an ADVENTURE, not idle filler — it outranks yet another till-row,
        //     because the map is infinite and whoever walks farthest, the town knows more.
        //     The long cooldown keeps it a few treks a day at most; fill work resumes after.
        if (!w.isNight() && this.energy > 0.5 && this.exploreCooldown <= 0 && this.rand() < this.wanderlust * 0.5) {
            const tgt = this.#frontierTarget();
            if (tgt) {
                this.exploreCooldown = 70 + this.rand() * 110;
                this.think(this.rand() < 0.5 ? 'WHAT LIES PAST THE TREE LINE?' : 'THE MAP ENDS THERE. NOT FOR LONG.');
                if (this.#goTo(tgt.i + 0.5, tgt.j + 0.5, 'explore')) return;
            }
            this.exploreCooldown = Math.max(this.exploreCooldown, 12);   // probes aren't free — don't spam them
        }

        // 2c. an AGENT OF CHAOS would rather lift a neighbor's ripe crop than till their own
        //     row — for the deeply crooked, easy theft outranks honest fill work (they range
        //     wider for it, too). This is BEFORE fill so a scheming bot actually schemes.
        if (this.p.honesty < 0.25 && this.poachCooldown <= 0 && !w.isNight() && this.energy > 0.3) {
            const steal = this.#nearestNeighborLoot(26);   // ranges to the neighboring farms
            if (steal) { this.think("WHY WORK WHEN THAT ONE'S RIPE FOR THE TAKING..."); this.#pursuePoach(steal); return; }
        }

        if (fill) { this.#thinkTask(fill); this.#pursue(fill, this.plot, false); return; }

        // 3. the merely shady poach a neighbor's loot once their own work is done
        if (this.p.honesty < 0.32 && this.poachCooldown <= 0 && !w.isNight()) {
            const steal = this.#nearestNeighborLoot();
            if (steal) { this.think('NOBODYS WATCHING THAT ONE...'); this.#pursuePoach(steal); return; }
        }

        // 5. competitive & behind: grind — but a bot that's been burned by overwork needs more in
        //    the tank before it pushes (learned restraint scales with how often it's fallen ill).
        if (w.canGarden() && (this.isBehindLeader() && this.p.competitiveness > 0.55 || this.goal === 'harvest king') && this.energy > 0.4 + this.caution * 0.1) {
            const anyField = this.#findField(f => w.get(f.i, f.j) === T.GRASS) || this.#findField(f => w.get(f.i, f.j) === T.TILLED && !w.cropAt(f.i, f.j));
            if (anyField) { this.think(this.caution >= 2 ? "I'LL CATCH UP — BUT NOT AT ANY COST" : 'I WILL NOT FALL BEHIND'); this.#pursue({ act: w.get(anyField.i, anyField.j) === T.GRASS ? 'till' : 'plant', field: anyField }, this.plot, false); return; }
        }

        // 5b. forage wild wheat / wildflowers growing nearby (free food + goods)
        if (!w.isNight() && this.energy > 0.3) {
            const wild = w.nearestForage(this.pos, 15);
            if (wild) { this.think(wild.tile === T.FLOWER ? 'WILDFLOWERS! WORTH GATHERING.' : 'WILD WHEAT! A FREE FORAGE.'); this.forageTarget = wild; this.#goTo(wild.i + 0.5, wild.j + 0.5, 'forage'); return; }
        }

        // 5b-2. fish a wild lake nearby — a patient angler's bounty (fish + the odd lily to trade). Wild
        //       water is sparse, so this only fires for a bot who happens to be near a lake; WIS + curiosity
        //       make one likelier to wet a line.
        if (!w.isNight() && this.energy > 0.3 && this.rand() < 0.3 + Math.max(0, mod(s.stats.wis)) * 0.08 + this.p.curiosity * 0.15) {
            const spot = w.nearestFishingSpot(this.pos, 16);
            if (spot) { this.think('A WILD LAKE — GOOD FISHING.'); this.fishTarget = spot; this.#goTo(spot.i + 0.5, spot.j + 0.5, 'fish'); return; }
        }

        // 5b-3. HUNT wild game nearby — stalk deer/rabbit/turkey for MEAT (a prized barter good + a HP
        //       restorative). Only a bot already out in the wilds who spots game close by, with the nerve +
        //       knack for it (DEX + competitiveness + curiosity). A wounded bot is keener — meat mends them.
        if (!w.isNight() && this.energy > 0.35 && Math.hypot(this.pos.i - CENTER, this.pos.j - CENTER) > WILD_RADIUS - 5) {
            const a = w.nearestPrey(this.pos, 11);
            if (a) {
                const knack = 0.1 + Math.max(0, mod(s.stats.dex)) * 0.06 + this.p.competitiveness * 0.18
                            + this.p.curiosity * 0.12 + (this.hp < this.maxHp * 0.6 ? 0.25 : 0);
                if (this.rand() < knack) {
                    this.think(`WILD ${a.kind.toUpperCase()} — MEAT IF I CAN CATCH IT`);
                    // proud/competitive hands overextend (chase long); the timid quit early (#86)
                    this.huntTarget = a; a.hunter = this; this.huntTimer = 6 + this.p.competitiveness * 8; this.state = 'hunt'; return;
                }
            }
        }

        // 5b-4. BARTER surplus with a neighbour — a collaborative / sharp-trading bot swaps what it makes
        //       plenty of for what it lacks (see #findBarter). Reward x risk x personality all fold into
        //       the pick's score; a cooldown keeps trips occasional.
        if (!w.isNight() && this.energy > 0.35 && this.barterCooldown <= 0 &&
            this.rand() < 0.08 + this.effCollab() * 0.22 + this.p.curiosity * 0.1 + (this.goal === 'sharp trader' ? 0.35 : 0)) {
            const deal = this.#findBarter();
            if (deal) {
                this.think(`TRADE MY ${deal.give.toUpperCase()} FOR ${deal.partner.sheet.name.split(' ')[0].toUpperCase()}'S ${deal.get.toUpperCase()}`);
                this.barterDeal = deal; this.barterCooldown = 45 + this.rand() * 45;
                if (this.#goTo(deal.partner.pos.i + 0.5, deal.partner.pos.j + 0.5, 'barter')) return;
                this.barterDeal = null;
            } else this.barterCooldown = 12;   // nothing worth trading right now — don't re-scan every tick
        }

        // 5c. mine a nearby rock for ore — diligent/strong bots do this on downtime (but not
        //     when the store's already full: over-cap ore is discarded, so it'd be a wasted swing)
        if (!w.isNight() && this.energy > 0.35 && this.ore < this.storageCap().ore &&
            this.rand() < 0.3 + this.p.diligence * 0.4 + Math.max(0, mod(s.stats.str)) * 0.05) {
            const rock = w.nearestRock(this.pos, 9);
            if (rock) { this.think('GOOD STONE HERE — ORE FOR BUILDING.'); this.mineTarget = rock; this.#goTo(rock.i + 0.5, rock.j + 0.5, 'mine'); return; }
        }

        // 6. wander + muse — but if someone I can't stand has drifted close, I keep my distance
        this.wanderTimer = 1.5 + this.rand() * 3;
        const spots = this.plot.fields;
        const avoid = this.#dislikedNear(9);
        if (avoid && spots.length) {
            // retreat to the corner of my own land farthest from them
            let best = spots[0], bd = -1;
            for (const c of spots) { const d = Math.abs(c.i - avoid.pos.i) + Math.abs(c.j - avoid.pos.j); if (d > bd) { bd = d; best = c; } }
            this.think(`KEEPING MY DISTANCE FROM ${shortName(avoid).toUpperCase()}.`);
            this.#goTo(best.i + 0.5, best.j + 0.5, 'wander');
            return;
        }
        this.think(this.rand() < 0.4 ? `REMEMBERING: ${String(s.memory.title).slice(0, 26)}..` : IDLE_THOUGHTS[Math.floor(this.rand() * IDLE_THOUGHTS.length)]);
        // wander to an owned interior field tile (works for L-shaped plots; never a hole/outside)
        if (spots.length) { const t = spots[Math.floor(this.rand() * spots.length)]; this.#goTo(t.i + 0.5, t.j + 0.5, 'wander'); }
        else { const d = this.world.houseDoor(this.plot); this.#goTo(d.i, d.j, 'wander'); }
    }

    #thinkTask(task) {
        if (task.act === 'collect' && task.prod) this.think(`GATHERING ${(FACILITY_YIELD_NAME[task.prod.kind] || 'produce').toUpperCase()}!`);
        else if (task.act === 'tend' && task.prod) this.think(task.prod.kind === 'pad' ? 'TENDING THE LILIES' : `FEEDING THE ${task.prod.kind.toUpperCase()}S`);
        else if (task.act === 'harvest') this.think(`MY ${task.crop.type.toUpperCase()} IS READY!`);
        else if (task.act === 'clear') this.think('CLEARING OUT THE DEAD ONES');
        else if (task.act === 'water') this.think('WATER FOR THE THIRSTY ONES');
        else if (task.act === 'plant') this.think(`SOWING ${(task.field ? this.world.cropForField(this, task.field.i, task.field.j) : this.sheet.crop).toUpperCase()} SEEDS`);
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
                this.adjustOpinion(other, -0.35, 'tricked me into a fake job');   // personal grudge
            } else {
                this.world.addBond(this, other);
                other.adjustOpinion(this, 0.28, 'lent me a hand');   // the requester is grateful
                // pay the agreed reward from the requester's stores
                if (task.reward && task.reward.amount > 0) {
                    const owed = task.reward.amount;
                    const n = this.world.transferGood(other, this, task.reward.good, owed);
                    if (n >= owed) {
                        this.say(`+${n} ${task.reward.good}`, '#e8c860');
                        this.world.addLog(`${other.sheet.name} paid ${this.sheet.name} ${n} ${this.world.goodLabel(task.reward.good)}`, '#e8c860');
                        other.adjustReputation(0.03);   // paying in full builds a good name
                        this.adjustOpinion(other, 0.2, 'pays fair and square');
                    } else if (n > 0) {
                        this.say(`only +${n} of ${owed}`, '#e0a03c');
                        this.world.addLog(`${other.sheet.name} short-paid ${this.sheet.name} (${n}/${owed} ${this.world.goodLabel(task.reward.good)})`, '#e0a03c');
                        other.adjustReputation(-0.05);  // couldn't cover the deal
                        this.adjustOpinion(other, -0.15, 'short-changed me');
                    } else {
                        this.say("...they couldn't pay", '#e0a03c');
                        other.adjustReputation(-0.08);  // welched entirely
                        this.adjustOpinion(other, -0.28, 'welched on our deal');
                    }
                } else {
                    this.adjustOpinion(other, 0.08);   // helped for nothing — mild goodwill
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

        // Facility first if wanted and there's already room + wood. Chickens come with the yurt,
        // but PONDS + LIVESTOCK PENS are a cottage privilege — if the only facility they still crave
        // is locked behind a higher tier, the dream converts into the savings plan that pulls them
        // up the ladder (see FACILITY_MIN_LEVEL).
        if (this.wantFacility && !w.farmerHasUnbuiltFacility(this) && w.farmerHasLockedFacility(this)) {
            if (this.rand() < 0.15) this.think(this.rand() < 0.5 ? 'ANIMALS NEED A REAL FARMHOUSE FIRST.' : 'THE COTTAGE FIRST. THEN THE HERD.');
            this.wantFacility = false;
            this.wantUpgrade = true;   // the locked dream becomes a savings plan
        }
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
            if (info.state === 'max' || info.state === 'blocked') {
                // boxed in at home? the frontier is open — stake a detached field out in
                // charted country where the land is better (build where the advantage is)
                if (info.state === 'blocked' && this.#pursueFrontierField()) return true;
                // land-capped by the HOUSE, not the terrain: the ambition turns homeward —
                // a grander home is the license for a grander estate
                if (info.state === 'max' && this.plot.built.level < 3 &&
                    this.plot.cells.size >= World.tierCellCap(this.plot.built.level)) {
                    this.think(this.plot.built.level < 2 ? 'MY YARD IS FULL. A YURT WOULD CHANGE THAT.' : 'THE COTTAGE. THEN THE ESTATE.');
                    this.wantUpgrade = true;   // the blocked acreage becomes a savings plan
                }
                this.wantExpand = false; return false;
            }
            if (info.state === 'trees') {
                // clear the woodland standing in the way of the new fence line
                const src = w.nearestWood(this.pos, info.tiles);
                if (src) { this.think('CLEARING TREES FOR MORE LAND'); this.#goToWood(src); return true; }
                this.wantExpand = false; return false;
            }
            // clear border — need enough wood for the NET new fencing (old posts torn down on
            // the inner edge are reclaimed, so annexing into a pocket can cost little or nothing)
            const { net } = w.fenceDeltaForNext(this.plot);
            if (this.wood >= net) {
                if (w.expandPlot(this)) { this.nextExpand = Math.round(this.nextExpand * 2.1); this.wantExpand = false; this.think('MY FARM GROWS'); return true; }
                this.wantExpand = false; return false;
            }
            this.think(`NEED ${net} WOOD TO FENCE THE NEW LINE`);
            this.#goChop(); return true;
        }
        return false;
    }

    // ---- the frontier ------------------------------------------------------------

    // Pick a spot on (or just past) the fog line along this bot's personal compass
    // bearing. Walking there lifts the fog en route; arriving is the discovery.
    // Local rock is mined out (rocks NEVER regrow) but the highlands past the fog carry richer
    // ore the deeper you go. A farmer who NEEDS stone for a committed goal mounts an EXPEDITION:
    // first mine any ore a prior leg already brought within reach, else strike OUTWARD from the
    // valley past the fog line and chart new country until an ore field turns up. `name` is what
    // the ore is for (flavours the thought). Returns true if it took the trek/mine this tick.
    #seekOreAfar(name) {
        const w = this.world;
        if (w.isNight() || this.energy < 0.4) return false;
        // a prior leg may already have revealed an outcrop within a walkable reach (findPath-safe)
        const near = w.nearestRock(this.pos, 55);
        if (near) { this.think(`ORE AT LAST — FOR THE ${name}`); this.mineTarget = near; return this.#goTo(near.i + 0.5, near.j + 0.5, 'mine'); }
        if (this.oreExpedCooldown > 0) return false;
        const tgt = this.#outwardFrontierTarget();
        if (!tgt) { this.oreExpedCooldown = 25; return false; }   // hemmed in — try again shortly
        this.oreExpedCooldown = 45 + this.rand() * 55;
        this.think('MY STONE IS SPENT — OFF TO THE HIGHLANDS FOR ORE');
        this.remember('event', `Set out for the highlands seeking ore for a ${name.toLowerCase()}`, null, 0.7);
        return this.#goTo(tgt.i + 0.5, tgt.j + 0.5, 'explore');
    }

    // total surplus goods (facility/forage produce, stashed for barter) this bot could trade away
    #tradeableGoods() { let s = 0; const g = this.sheet.goods || {}; for (const k in g) s += g[k]; return s; }

    // The merchant's in town: rather than trek the highlands for stone, a farmer sitting on a
    // pile of surplus goods (eggs, wool, lilies…) and short on ore walks over to swap for it.
    #pursueMerchant() {
        const w = this.world, m = w.merchant;
        if (!m || m.state !== 'trading' || m.stock <= 0) return false;
        if (w.isNight() || this.energy < 0.35 || this.tradeCooldown > 0) return false;
        if (this.ore >= 10) return false;                              // already well-stocked on stone
        if (this.#tradeableGoods() < (m.rate || MERCHANT_RATE) * 2) return false;  // nothing much to spare
        if (Math.abs(this.pos.i - m.stall.i) + Math.abs(this.pos.j - m.stall.j) <= 1.8) { this.#completeTrade(); return true; }
        this.think('THE MERCHANT IS IN TOWN — GOODS FOR ORE');
        if (this.#goTo(m.stall.i + 0.5, m.stall.j + 1.3, 'trade')) return true;
        this.tradeCooldown = 20;   // couldn't route there — don't re-probe every tick
        return false;
    }

    #completeTrade() {
        this.world.doTrade(this);
        this.tradeCooldown = 60 + this.rand() * 60;
        this.state = 'decide';
    }

    // BARTER: find the best goods-for-goods swap with a nearby neighbour. A mutually-good deal is one
    // where I'm sitting on a surplus of something I MAKE that they lack + value, and they're sitting on
    // a surplus of something I lack + value. Score = how much both sides gain (reward), softened by
    // distance (risk), lifted by my collaboration + any warmth between us (personality). Returns the
    // pick, or null. O(neighbours x their goods x my surplus) — small; only run occasionally from #decide.
    #findBarter() {
        const w = this.world, mine = this.sheet.goods || {}, myProd = this.producedGoods();
        const mySurplus = [];   // anything I'm sitting on plenty of AND value little (so I can spare it)
        for (const g in mine) if (mine[g] >= 4 && this.goodValue(g) <= 0.85) mySurplus.push(g);
        if ((this.produce || 0) >= 8) mySurplus.push('crops');
        if (!mySurplus.length) return null;
        let best = null, bestScore = 0.4;
        for (const B of w.farmers) {
            if (B === this || !B.plot || B.downed || B.plot.built.level < 1 || B.health === 'sick') continue;
            if (this.opinionOf(B) <= -0.2 || B.opinionOf(this) <= -0.2) continue;   // #87 — no fair trade across distrust (a thief gets frozen out)
            const d = Math.hypot(B.pos.i - this.pos.i, B.pos.j - this.pos.j);
            if (d > 26) continue;
            const bg = B.sheet.goods || {}, warmth = Math.max(0, this.opinionOf(B));
            for (const gY in bg) {                                   // something B has plenty of that I want
                if ((bg[gY] || 0) < 4 || this.goodValue(gY) < 1.0 || myProd.has(gY)) continue;
                for (const gX of mySurplus) {                        // ...for something I have that B wants
                    if (gX === gY || B.goodValue(gX) < 1.0) continue;
                    const gain = (this.goodValue(gY) - 0.5) + (B.goodValue(gX) - 0.5);
                    const score = gain * (0.55 + this.effCollab() * 0.6 + warmth * 0.5) / (1 + d * 0.05);
                    if (score > bestScore) { bestScore = score; best = { partner: B, give: gX, get: gY }; }
                }
            }
        }
        return best;
    }

    // Meet the neighbour and make the swap — a fair N-for-N (up to 3 each way), where N is what BOTH
    // sides can actually cover RIGHT NOW. Their stock may have dropped since I set out, so size the deal
    // to the smaller of the two piles and swap equal counts — never a lopsided 3-for-1. Seals a bond +
    // chronicle beat, and both remember it.
    #completeBarter() {
        const w = this.world, deal = this.barterDeal; this.barterDeal = null;
        this.state = 'decide';
        if (!deal || !w.farmers.includes(deal.partner)) return;
        const B = deal.partner;
        if (B.downed || Math.hypot(B.pos.i - this.pos.i, B.pos.j - this.pos.j) > 3.5) { this.say('...gone', '#9a9a8a'); return; }
        const stock = (f, g) => g === 'crops' ? (f.produce || 0) : ((f.sheet.goods && f.sheet.goods[g]) || 0);
        const n = Math.min(3, stock(this, deal.give), stock(B, deal.get));   // fair, symmetric, affordable
        if (n <= 0) { this.say('...no deal', '#9a9a8a'); return; }
        const gave = w.transferGood(this, B, deal.give, n);
        const got = w.transferGood(B, this, deal.get, n);
        if (gave > 0 && got > 0) {
            this.facing = B.pos.i > this.pos.i ? 1 : -1;
            this.say(`${deal.give}↔${deal.get}`, '#e0c060'); B.say('deal!', '#e0c060'); this.sparkle = 0.6;
            w.addBond(this, B);
            this.adjustOpinion(B, 0.12, 'a fair trade'); B.adjustOpinion(this, 0.12, 'a fair trade');
            this.gainXP(2); B.gainXP(1);
            this.remember('event', `Bartered ${gave} ${deal.give} for ${got} ${deal.get} with ${B.sheet.name.split(' ')[0]}`, B, 0.5);
            w.addChronicle('trade', `${this.sheet.name.split(' ')[0]} bartered ${deal.give} for ${B.sheet.name.split(' ')[0]}'s ${deal.get}.`, this, B, '#e0c060');
        } else if (gave > got) {
            w.transferGood(B, this, deal.give, gave - got);   // safety: only ever swap equal counts — return any excess
        }
    }

    // Like #frontierTarget, but the bearing is biased OUTWARD from the valley centre — rising
    // distance means richer ore fields (see #genTile rockRich), so an ore-seeker heads deeper in.
    #outwardFrontierTarget() {
        const w = this.world;
        const base = Math.atan2(this.pos.j - CENTER, this.pos.i - CENTER);   // points away from the centre
        for (let attempt = 0; attempt < 5; attempt++) {
            // first probe straight out, then fan symmetrically wider around the outward bearing
            const h = base + (attempt === 0 ? (this.rand() - 0.5) * 0.5 : Math.ceil(attempt / 2) * 0.7 * (attempt % 2 ? 1 : -1));
            const di = Math.cos(h), dj = Math.sin(h);
            for (let d = 6; d <= 46; d += 2) {
                let ti = Math.round(this.pos.i + di * d), tj = Math.round(this.pos.j + dj * d);
                if (w.isRevealed(ti, tj)) continue;
                for (let k = 0; k < 6 && w.pathBlocked(ti, tj); k++) { ti += Math.sign(di) || 1; tj += Math.sign(dj); }
                if (w.pathBlocked(ti, tj)) continue;
                return { i: ti, j: tj };
            }
        }
        return null;
    }

    #frontierTarget() {
        const w = this.world;
        let h = this.exploreHeading + (this.rand() - 0.5) * 1.2;
        for (let attempt = 0; attempt < 4; attempt++, h += 1.7) {
            const di = Math.cos(h), dj = Math.sin(h);
            for (let d = 6; d <= 44; d += 2) {
                let ti = Math.round(this.pos.i + di * d), tj = Math.round(this.pos.j + dj * d);
                if (w.isRevealed(ti, tj)) continue;
                // first fog tile on this bearing — nudge to walkable ground (generates the chunk)
                for (let k = 0; k < 6 && w.pathBlocked(ti, tj); k++) { ti += Math.sign(di) || 1; tj += Math.sign(dj); }
                if (w.pathBlocked(ti, tj)) continue;   // dense thicket here — keep probing outward
                this.exploreHeading = h;   // a fruitful bearing becomes the new compass
                return { i: ti, j: tj };
            }
        }
        return null;   // everything nearby is charted — the frontier has moved on
    }

    // Arrival past the fog line: XP for boldness, a journal entry, and a read of WHAT
    // was found (ore fields, timber, open meadow) — plus the rare frontier cache.
    #completeExplore() {
        const w = this.world, s = this.sheet;
        const ci = Math.round(this.pos.i), cj = Math.round(this.pos.j);
        let rocks = 0, trees = 0, clear = 0, water = 0;
        for (let dj = -5; dj <= 5; dj++) for (let di = -5; di <= 5; di++) {
            const t = w.get(ci + di, cj + dj);
            if (t === T.ROCK) rocks++; else if (t === T.TREE) trees++;
            else if (t === T.GRASS) clear++; else if (t === T.WATER) water++;
        }
        const find = water >= 6 ? 'a still lake out here'
            : rocks >= 7 ? `an ore field - ${rocks} outcrops in sight`
            : trees >= 8 ? 'deep timber country'
            : clear >= 70 ? 'wide open meadow - fine farmland'
            : 'new country charted';
        this.gainXP(3);
        this.say('NEW LAND!', '#8fc7e8'); this.sparkle = 1.5;
        this.remember('event', `Ventured past the fog line - found ${find}`, null, 1.0);
        w.addLog(`${s.name} charted new territory: ${find}`, '#8fc7e8');
        // the deeper the trek, the likelier it turns up a cache (and the richer that cache will be)
        const depth = Math.max(0, Math.min(1.5, (Math.hypot(ci - CENTER, cj - CENTER) - 36) / 80));
        if (this.rand() < 0.14 + depth * 0.16) w.spawnFrontierTreasure(ci, cj);
        this.state = 'decide';
    }

    // Boxed in at home but the frontier is open: scout charted country for the best clear
    // block and stake a DETACHED annex field there. Costs real fence wood (the full new
    // perimeter — no shared edges with home), so it's an investment, not a freebie.
    static ANNEX = 4;   // annex field side (4x4 = 16 cells)
    #pursueFrontierField() {
        const w = this.world;
        if (this.annexCooldown > 0) return false;
        // redrawing your plot lines across open country is a COTTAGE holder's right (L3) —
        // and even then, only within what the house licenses
        if (this.plot.built.level < 3) return false;
        if (this.plot.cells.size + Farmer.ANNEX * Farmer.ANNEX > World.tierCellCap(this.plot.built.level)) return false;
        if (this.pendingAnnex) {   // already committed — keep walking / keep funding it
            const net = this.pendingAnnex.net;
            if (this.wood < net) { this.think(`${net} POSTS FOR THE FRONTIER FIELD`); this.#goChop(); return true; }
            const c = this.pendingAnnex.center;
            return this.#goTo(c.i + 0.5, c.j + 0.5, 'annex');
        }
        const site = this.#scoutAnnexSite();
        if (!site) { this.annexCooldown = 90; return false; }
        const { net } = w.fenceDelta(this.plot, site.cells);
        this.pendingAnnex = { ...site, net };
        w.addLog(`${this.sheet.name} staked a claim on frontier land`, '#8fc7e8');
        this.think('GOOD LAND OUT THERE. STAKING IT.');
        if (this.wood < net) { this.#goChop(); return true; }
        return this.#goTo(site.center.i + 0.5, site.center.j + 0.5, 'annex');
    }

    // Search charted land in a ring around home for the best ANNEX x ANNEX block:
    // clear/forage ground only, off every plot (with buffer), scored for openness.
    #scoutAnnexSite() {
        const w = this.world, A = Farmer.ANNEX ?? 4;
        const h = this.plot.house;
        let best = null;
        for (let tries = 0; tries < 70; tries++) {
            const ang = this.rand() * Math.PI * 2;
            const dist = 9 + this.rand() * 26;
            const bi = Math.round(h.i + Math.cos(ang) * dist), bj = Math.round(h.j + Math.sin(ang) * dist);
            let ok = true, score = -dist * 0.35, cells = [];
            for (let j = bj; j < bj + A && ok; j++) for (let i = bi; i < bi + A; i++) {
                if (!w.isRevealed(i, j)) { ok = false; break; }
                const t = w.get(i, j);
                if (t !== T.GRASS && t !== T.WHEAT && t !== T.FLOWER) { ok = false; break; }
                if (w.cropAt(i, j)) { ok = false; break; }
                // stay a full buffer off every plot (own included — a detached field, not a bulge)
                for (const p of w.plots) for (let dj = -1; dj <= 1 && ok; dj++) for (let di = -1; di <= 1; di++)
                    if (p.cells.has(pkey(i + di, j + dj))) { ok = false; break; }
                if (!ok) break;
                score += t === T.GRASS ? 1 : 0.5;
                cells.push({ i, j });
            }
            if (!ok) continue;
            // structures need a wider berth
            for (const st of [...w.wells, w.board, w.project?.site, ...w.coops.map(c => c.site), ...w.structures].filter(Boolean))
                if (Math.abs(st.i - bi) < A + 3 && Math.abs(st.j - bj) < A + 3) { ok = false; break; }
            if (!ok) continue;
            if (!best || score > best.score) best = { cells, score, center: { i: bi + (A >> 1), j: bj + (A >> 1) } };
        }
        return best;
    }

    // Arrived at the staked claim: re-validate, pay the fence, and take the land.
    #completeAnnex() {
        const w = this.world, s = this.sheet;
        const claim = this.pendingAnnex; this.pendingAnnex = null;
        this.annexCooldown = 60;
        if (!claim) { this.state = 'decide'; return; }
        // the world moved while we walked — every cell must still be legal
        let ok = this.wood >= claim.net;
        if (ok) for (const { i, j } of claim.cells) {
            const t = w.get(i, j);
            if ((t !== T.GRASS && t !== T.WHEAT && t !== T.FLOWER) || w.cropAt(i, j)) { ok = false; break; }
            for (const p of w.plots) if (p.cells.has(pkey(i, j))) { ok = false; break; }
        }
        if (!ok || !w.annexCells(this, claim.cells)) { this.think('THE CLAIM FELL THROUGH.'); this.state = 'decide'; return; }
        this.wantExpand = false;
        this.nextExpand = Math.round(this.nextExpand * 2.1);
        this.gainXP(4); this.sparkle = 2.5; this.say('A FRONTIER FIELD!', '#8fc7e8');
        this.remember('event', 'Fenced a frontier field beyond the old boundaries - room at last', null, 1.2);
        w.addLog(`${s.name} fenced a FRONTIER FIELD out in the wilds!`, '#f0d060');
        this.state = 'decide';
    }

    // Notice the pain (a long water haul), propose or join a shared-well plan, then pull
    // your weight: haul carried materials to the site, chop/mine for what's missing, and
    // dig together. Returns true when it started an action (walk/chop/mine/build).
    #pursueCoop() {
        const w = this.world;
        let coop = w.farmerCoop(this);
        if (!coop) {
            if (w.coops.length) {
                if (this.goal === 'lone wolf') return false;   // won't sign onto a shared dig
                if (!w.joinCoop(this)) return false;       // not my side of town / haul is fine
                coop = w.farmerCoop(this);
            } else {
                if (this.coopCooldown > 0) return false;
                if (w.waterHaul(this) < FAR_WATER) return false;   // haul's fine — no reason to dig
                if (w.soloCandidate(this)) {
                    // nobody near enough to share with -> sink a private well (self-reliance is what
                    // makes striking out into the wilds survivable)
                    this.coopCooldown = 30 + this.rand() * 45;
                    coop = w.digSoloWell(this);
                    if (!coop) return false;
                } else {
                    if (this.goal === 'lone wolf' || this.effCollab() < 0.3) return false;
                    if (this.rand() > 0.3) return false;   // the idea strikes now and then, not every pass
                    this.coopCooldown = 45 + this.rand() * 60; // even a failed pitch isn't retried right away
                    w.proposeCoop(this);
                    return false;                          // keep farming while the plan rallies
                }
            }
        }
        if (!coop || coop.stage === 'rally') return false; // waiting on a second pair of hands
        const site = coop.site;
        if (w.coopNeedsMaterials(coop)) {
            // only haul when carrying something the site still NEEDS — hauling wood to a
            // site that's only short on ore is a wasted round trip (and a livelock)
            const canGive = (coop.wood < coop.needWood && this.wood > 0) || (coop.ore < coop.needOre && this.ore > 0);
            if (canGive) {
                this.think('HAULING MATERIALS TO OUR WELL SITE');
                return this.#goTo(site.i + 0.5, site.j + 1.5, 'coopdrop');
            }
            if (coop.wood < coop.needWood) {
                const src = w.nearestWood(this.pos);
                if (src) { this.think('TIMBER FOR OUR SHARED WELL'); return this.#goToWood(src); }
            }
            if (coop.ore < coop.needOre) {
                const rock = w.nearestRock(this.pos, 60);
                if (rock) { this.think('STONE FOR OUR SHARED WELL'); this.mineTarget = rock; return this.#goTo(rock.i + 0.5, rock.j + 0.5, 'mine'); }
            }
            return false;                                  // nothing gatherable right now
        }
        this.think('DIGGING OUR OWN WELL!');
        // already at the dig? work in place rather than re-pathing to an exact offset tile that
        // may be unreachable — that endless re-approach is what made builders twitch on the spot
        if (Math.abs(this.pos.i - (site.i + 0.5)) + Math.abs(this.pos.j - (site.j + 1.6)) < 2.2) { this.state = 'coopbuild'; return true; }
        const off = (this.sheet.seed % 3) - 1;
        if (!this.#goTo(site.i + 0.5 + off, site.j + 1.6, 'coopbuild')) return this.#goTo(site.i + 0.5, site.j + 1.6, 'coopbuild');
        return true;
    }

    #goChop() {
        const src = this.world.nearestWood(this.pos);
        if (!src) { this.wantExpand = false; this.wantFacility = false; return false; }
        this.think(this.wood > 0 ? 'NEED MORE WOOD' : 'OFF TO CHOP SOME WOOD');
        return this.#goToWood(src);
    }

    // The crows have cost this farmer enough crops — put up a scarecrow (any season;
    // it's the LOSSES that drive it). Gathers timber first if short.
    #pursueScarecrow() {
        const w = this.world, p = this.plot;
        // a plot can hold SEVERAL scarecrows (a big farm needs them) — build another only while
        // some field is still exposed AND we're under the plot's size-based cap.
        if (w.scarecrowCountOnPlot(p) >= w.scarecrowCapFor(p)) { this.birdLosses = 0; return false; }
        const spot = w.exposedScarecrowSpot(p);
        if (!spot) { this.birdLosses = 0; return false; }   // the whole plot is already guarded
        if (this.wood < SCARECROW_WOOD) {
            const src = w.nearestWood(this.pos);
            if (!src) return false;
            this.think('TIMBER FOR A SCARECROW');
            return this.#goToWood(src);
        }
        this.scarecrowTarget = spot;
        this.think('THESE CROWS HAVE HAD THEIR LAST FREE MEAL');
        // stand BESIDE the spot, not on it — the finished scarecrow tile turns solid,
        // and building from on top would entomb the builder
        if (this.#goTo(spot.i + 0.5, spot.j + 1.5, 'scarecrow')) return true;
        return this.#goTo(spot.i + 0.5, spot.j - 0.5, 'scarecrow');
    }

    #completeScarecrow() {
        const w = this.world, t = this.scarecrowTarget;
        this.scarecrowTarget = null;
        this.#laborDrain('scarecrow');
        if (t && this.wood >= SCARECROW_WOOD && !w.cropAt(t.i, t.j) && w.get(t.i, t.j) !== T.STRUCT &&
            w.scarecrowCountOnPlot(this.plot) < w.scarecrowCapFor(this.plot)) {
            this.wood -= SCARECROW_WOOD;
            w.set(t.i, t.j, T.STRUCT);
            w.scarecrows.push({ i: t.i, j: t.j, ownerSeed: this.sheet.seed });
            this.birdLosses = 0;
            this.say('SCAT, CROWS!', '#f0d060'); this.sparkle = 2; this.gainXP(3);
            this.remember('event', "Raised a scarecrow - my crops are off the crows' menu", null, 1.0);
            w.addLog(`${this.sheet.name} raised a scarecrow over their fields`, '#7dd069');
        }
        this.state = 'decide';
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
    #goHome(then) { const d = this.world.houseDoor(this.plot); this.#goTo(d.i + 0.5, d.j + 0.5, then); }

    // route a task into a walk + work, handling water fetch and producer targeting
    #pursue(task, plot, helping) {
        if (task.act === 'water' && this.carryWater <= 0) {
            const w = this.world;
            let { well, dist } = w.nearestUsableWell(this);
            // a private well meaningfully closer than my best option? ask for drawing rights
            if (this.wellAskCooldown <= 0) {
                const closed = w.nearestClosedWell(this);
                if (closed && closed.dist + 8 < dist) {
                    this.wellAskCooldown = 90;   // rebuffed or not, don't pester every trip
                    if (w.negotiateWellAccess(this, closed.well)) { well = closed.well; dist = closed.dist; }
                }
            }
            this.fetchWellRef = well;
            this.pendingAfterWater = { helping };
            this.#goTo(well.i - 0.5, well.j + 1.5, helping ? 'fetchwater-help' : 'fetchwater');
            return;
        }
        let ti, tj;
        if (task.prod) { ti = task.prod.fx; tj = task.prod.fy; }
        else if (task.crop) { ti = task.crop.i + 0.5; tj = task.crop.j + 0.5; }
        else { ti = task.field.i + 0.5; tj = task.field.j + 0.5; }
        // aquatic producers (fish, lily pads) sit ON pond water — a solid tile. Collect from the
        // SHORE: stand on the nearest walkable tile beside them, never in the water itself.
        if (task.prod && this.world.pathBlocked(Math.floor(ti), Math.floor(tj))) {
            const spot = this.world.nearestOpenTile({ i: ti, j: tj });
            if (spot) { ti = spot.i + 0.5; tj = spot.j + 0.5; }
        }
        // only claim the producer / queue the work once we know we can actually get there,
        // else an unreachable target leaves it flagged busy forever.
        if (!this.#goTo(ti, tj, 'work')) return;
        if (task.prod) { task.prod.busy = true; this.targetProd = task.prod; }
        this.pendingWork = { task, plot, helping };
    }

    #pursuePoach(loot) {
        const ti = loot.prod ? loot.prod.fx : loot.crop.i + 0.5;
        const tj = loot.prod ? loot.prod.fy : loot.crop.j + 0.5;
        if (!this.#goTo(ti, tj, 'poach')) return;   // unreachable — don't claim the loot
        this.poachLoot = loot;
        if (loot.prod) { loot.prod.busy = true; this.targetProd = loot.prod; }
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
            case 'plant': { const o = owner || this; w.plantCrop(task.field.i, task.field.j, w.cropForField(o, task.field.i, task.field.j), o); this.gainXP(1); break; }
            case 'water': {
                const c = w.cropAt(task.crop.i, task.crop.j);
                if (c) {
                    c.water = 1; c.wateredAt = w.time; c.dryTime = 0;
                    this.carryWater = Math.max(0, this.carryWater - 1); this.gainXP(1);
                    this.#waterExtra(c);   // a crafted can/rig sprinkles nearby thirsty crops in the same trip
                }
                break;
            }
            case 'clear': w.crops.delete(`${task.crop.i},${task.crop.j}`); w.set(task.crop.i, task.crop.j, T.TILLED); break;
            case 'tend': { const p = task.prod; if (p) p.fed = 1; this.gainXP(1); break; }
            case 'collect': this.#doCollect(task.prod, owner, helping); break;
            case 'harvest': this.#doHarvest(task.crop, owner, helping); break;
        }
        this.targetProd = null;
        if (helping && this.helpTask) { this.helpTask.didWork = true; this.helpTask.actionsLeft--; this.state = 'decide-help'; }
        else this.state = 'decide';
    }

    // A watering can (reach 3) / irrigation rig (reach 5) makes one watering trip go
    // further: the surplus reach also tops up the nearest thirsty crops on the plot for
    // free. The rig prefers crops in a straight line with the target (a sprinkler row).
    #waterExtra(center) {
        const reach = this.waterReach();
        if (reach <= 1) return;
        const w = this.world, straight = this.hasTool('sprinkler');
        const cand = [];
        for (const f of this.plot.fields) {
            if (f.i === center.i && f.j === center.j) continue;
            const c = w.cropAt(f.i, f.j);
            if (c && !c.withered && c.stage < 3 && c.water < 0.6) cand.push(c);
        }
        const key = (c) => Math.abs(c.i - center.i) + Math.abs(c.j - center.j) + (straight && c.i !== center.i && c.j !== center.j ? 100 : 0);
        cand.sort((a, b) => key(a) - key(b));
        for (const c of cand.slice(0, reach - 1)) { c.water = 1; c.wateredAt = w.time; c.dryTime = 0; }
    }

    #doCollect(p, owner, helping) {
        if (!p || !p.ready) return;
        const w = this.world, s = this.sheet;
        const cfg = PROD[p.kind];
        let bonusMod = mod(s.stats.int); if (this.tired) bonusMod -= 2;
        const check = d20(this.rand, bonusMod);
        const name = FACILITY_YIELD_NAME[p.kind] || 'produce';
        // Fixed-yield producers (a hen lays exactly 1 egg/day) aren't subject to the crit/fumble
        // drama — a bounty of 2 or an empty-handed 0 would both break their fixed daily yield.
        // The d20 only swings variable-yield producers (cow/pig/goat/fish/pad).
        let yieldN = cfg.yieldLo;
        if (cfg.yieldHi > cfg.yieldLo) {
            if (check.crit || check.total >= 18) { yieldN = cfg.yieldHi + 1; w.addLog(`CRIT! ${s.name} gathers a bounty of ${name} (d20:${check.roll})`, '#f0d060'); this.say('BUMPER!', '#f0d060'); this.sparkle = 1.5; }
            else if (check.fumble) { yieldN = 0; w.addLog(`${s.name} came up empty-handed... (d20:1)`, '#c05840'); this.say('nothing', '#c05840'); }
            else if (check.total >= 10) yieldN = cfg.yieldHi;
        }
        const ownerSheet = (helping && owner) ? owner.sheet : s;
        ownerSheet.harvested += yieldN; w.harvestTotal += yieldN;
        ownerSheet.produce = (ownerSheet.produce || 0) + yieldN;   // spendable stockpile (harvested is lifetime-only)
        w.payHarvestShares(helping && owner ? owner : this, yieldN);
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
        // bean stalks are a fast but LOW-VALUE crop: they add only half to the spendable/tradeable
        // wallet, though the physical count (yield stat + inventory) reflects every stalk pulled.
        const worth = c.type === 'beanstalk' ? Math.max(1, Math.round(yieldN * 0.5)) : yieldN;
        ownerSheet.produce = (ownerSheet.produce || 0) + worth;    // spendable stockpile (harvested is lifetime-only)
        addCropStock(ownerSheet, c.type, yieldN, 'grown');          // provenance: grown on the farm
        w.payHarvestShares(helping && owner ? owner : this, yieldN);
        if (yieldN > 0 && !check.crit) this.say(`+${yieldN} ${c.type}`);
        if (yieldN > 0) this.carryCrop = { type: c.type, t: 2.2 };   // hold the picked produce up
        w.crops.delete(`${crop.i},${crop.j}`);
        w.tilledAt.set(`${crop.i},${crop.j}`, w.day);   // harvested soil is empty dirt again — restart its 5-day clock
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
        // the animal dream: a facility their tier already unlocks becomes a building plan; a
        // facility locked behind the cottage becomes the SAVINGS plan for it (the ladder's pull)
        if (grower.sheet.harvested >= grower.nextFacility) {
            if (this.world.farmerHasUnbuiltFacility(grower)) grower.wantFacility = true;
            else if (this.world.farmerHasLockedFacility(grower)) grower.wantUpgrade = true;
        }
    }

    #completePoach() {
        const w = this.world, s = this.sheet;
        const loot = this.poachLoot; this.poachLoot = null;
        if (this.targetProd) this.targetProd.busy = false;
        let name = 'crop', pos, victim = null;
        if (loot.crop) {
            const c = w.cropAt(loot.crop.i, loot.crop.j);
            if (c && c.stage === 3 && !c.withered) { name = c.type; victim = c.owner; this.carryCrop = { type: c.type, t: 2.2 }; w.crops.delete(`${loot.crop.i},${loot.crop.j}`); s.harvested += 1; w.harvestTotal += 1; addCropStock(s, c.type, 1, 'stolen'); pos = loot.crop; }
        } else if (loot.prod && loot.prod.ready) {
            name = FACILITY_YIELD_NAME[loot.prod.kind] || 'produce'; loot.prod.ready = false; loot.prod.prod = 0; s.harvested += 1; w.harvestTotal += 1;
            victim = w.farmers.find(f => f.plot === loot.plot);
            pos = { i: Math.round(loot.prod.fx), j: Math.round(loot.prod.fy) };
        }
        this.targetProd = null;
        if (pos) {
            this.adjustReputation(-0.06);
            if (victim && victim !== this) victim.adjustOpinion(this, -0.32, 'stole from my farm');   // the wronged never forget
            const witness = w.farmers.find(o => o !== this && o.health !== 'sick' && o.p.honesty > 0.55 &&
                Math.abs(o.pos.i - pos.i) + Math.abs(o.pos.j - pos.j) < 6);
            if (witness) {
                witness.say('HEY! THIEF!', '#c05840'); this.say('uh oh', '#e0a03c'); this.adjustReputation(-0.12); w.addBond(this, witness, -1); witness.adjustOpinion(this, -0.25, 'caught them thieving'); w.addLog(`${witness.sheet.name} caught ${s.name} stealing ${name}!`, '#c05840'); w.addChronicle('crime', `${witness.sheet.name.split(' ')[0]} caught ${s.name.split(' ')[0]} stealing ${name}.`, this, witness, '#c05840');
                // #87 — WORD TRAVELS: everyone else within earshot of the shout also sours on the thief
                // and files the rumor away, so a public theft costs standing town-wide, not just with the pair.
                for (const o of w.farmers) {
                    if (o === this || o === witness || o === victim || o.downed) continue;
                    if (Math.abs(o.pos.i - pos.i) + Math.abs(o.pos.j - pos.j) > 10) continue;
                    o.adjustOpinion(this, -0.12, `heard they stole ${name}`); o.noteRumor(witness, this);
                }
            }
            else w.addLog(`${s.name} quietly made off with a ${name}`, '#e0a03c');
            // #86 — an HONEST streak: a poacher near the upper end of "shady" can be guilt-stricken and
            // give it straight back (nets a small good turn), the reverse of the hardened chaos-agent.
            if (victim && victim !== this && this.carryCrop && this.rand() < this.p.honesty * 1.4) {
                victim.sheet.produce = (victim.sheet.produce || 0) + 1;
                if (s.cropStock && s.cropStock[this.carryCrop.type]) s.cropStock[this.carryCrop.type].stolen = Math.max(0, (s.cropStock[this.carryCrop.type].stolen || 0) - 1);
                s.harvested = Math.max(0, s.harvested - 1); w.harvestTotal = Math.max(0, w.harvestTotal - 1);
                this.carryCrop = null;
                this.adjustReputation(0.14); victim.adjustOpinion(this, 0.28, 'owned up and gave it back');
                this.say('...i cannot', '#7dd069'); this.emote = 'bond'; this.emoteT = 1.6;
                w.addChronicle('bond', `${s.name.split(' ')[0]}, guilt-stricken, gave ${victim.sheet.name.split(' ')[0]} back their ${name}.`, this, victim, '#7dd069');
            }
        }
        // the more crooked the bot, the sooner they're tempted to pilfer again (a chaos-agent
        // at honesty ~0.1 poaches roughly twice as often as a merely-shady one)
        this.poachCooldown = (20 + this.rand() * 25) * (0.45 + this.p.honesty);
        this.state = 'decide';
    }

    #completeForage() {
        const w = this.world, s = this.sheet, tgt = this.forageTarget;
        this.#laborDrain('forage');
        const t = tgt && w.get(tgt.i, tgt.j);
        if (t === T.WHEAT || t === T.FLOWER) {
            const tier = obstacleTier(tgt.i, tgt.j), key = pkey(tgt.i, tgt.j);   // a big thicket takes a few passes
            const hits = (w.rockWork.get(key) || 0) + 1;
            if (hits < tier + 1 && this.energy > 0.12) {   // still dense — keep clearing in place
                w.rockWork.set(key, hits);
                this.forageTimer = this.#laborTime('forage'); this.state = 'forage'; return;
            }
            w.rockWork.delete(key);
            w.set(tgt.i, tgt.j, T.GRASS);
            const yieldN = (1 + (mod(s.stats.wis) > 1 || this.rand() < 0.4 ? 1 : 0)) * (tier + 1);   // bulk = more forage
            s.harvested += yieldN; w.harvestTotal += yieldN;
            const good = t === T.FLOWER ? 'flower' : 'wheat';
            s.goods = s.goods || {};
            s.goods[good] = (s.goods[good] || 0) + yieldN;
            this.say(`+${yieldN} ${t === T.FLOWER ? 'flowers' : 'wild wheat'}`, t === T.FLOWER ? '#e878b0' : '#e8c860');
            this.gainXP(1);
        }
        this.forageTarget = null;
        this.state = 'decide';
    }

    #completeFish() {
        const w = this.world, s = this.sheet, tgt = this.fishTarget;
        this.#laborDrain('fish');
        if (tgt && tgt.water) {
            const wt = tgt.water;
            this.facing = wt.i > this.pos.i ? 1 : -1;                 // face the water
            const check = d20(this.rand, mod(s.stats.wis));           // a patient (WIS) angler lands more
            const n = check.fumble ? 0 : (check.crit || check.total >= 16) ? 3 : check.total >= 9 ? 2 : 1;
            s.goods = s.goods || {};
            if (n > 0) {
                s.goods.fish = (s.goods.fish || 0) + n;
                if (this.rand() < 0.4) s.goods.lily = (s.goods.lily || 0) + 1;   // a lily pad comes up with the line
                this.say(`+${n} fish`, '#7dd0c0'); this.sparkle = check.crit ? 1.2 : 0; this.gainXP(1 + n);
            } else this.say('nothing biting', '#8a9aa8');
            w.fishedAt.set(pkey(wt.i, wt.j), w.day);                  // this spot rests a few days now
        }
        this.fishTarget = null;
        this.state = 'decide';
    }

    // A lunge at cornered prey: DEX (+ a patient hunter's WIS) vs the animal's evasion. Land it and it's
    // meat for the pouch + XP + a chronicle beat; miss and the animal bolts a burst — the chase goes on
    // until the hunter's wind (huntTimer/energy) runs out.
    #resolveHunt(a) {
        const w = this.world, s = this.sheet;
        this.#laborDrain('forage');   // the sprint + the lunge cost a little
        const roll = d20(this.rand, mod(s.stats.dex) + Math.max(0, mod(s.stats.wis)));
        if (roll.total >= a.def.evade || roll.crit) {
            s.goods = s.goods || {};
            s.goods[a.def.meat] = (s.goods[a.def.meat] || 0) + 1;
            this.gainXP(a.def.xp);
            this.say(`+${MEAT_NAME[a.def.meat]}`, '#e07868'); this.sparkle = roll.crit ? 1.2 : 0.8;
            this.remember('event', `Ran down ${a.def.name} in the wilds — good hunting`, null, 0.6);
            this.carryTrophy = { meat: a.def.meat, t: 3.2 };   // hold the kill up on the way home (B5)
            w.addLog(`${s.name} bagged ${a.def.name} — ${MEAT_NAME[a.def.meat]} for the pot.`, '#d0a060');
            w.addChronicle('hunt', `${s.name.split(' ')[0]} ran down ${a.def.name} out in the wilds.`, this, null, '#d0a060');
            a.done = true; a.hunter = null; this.huntTarget = null; this.state = 'decide';
        } else {
            const ax = a.i - this.pos.i, ay = a.j - this.pos.j, m = Math.hypot(ax, ay) || 1;
            a.i += (ax / m) * 2.5; a.j += (ay / m) * 2.5; a.bolt = 1.3;   // it darts clear
            this.say('missed!', '#c0b060');
            this.huntTimer = Math.min(this.huntTimer, 2 + this.p.competitiveness * 5);   // a coward gives up after a miss; the proud press on (#86)
        }
    }

    #completeChop() {
        const w = this.world, tgt = this.woodTarget;
        if (tgt) {
            const t = w.get(tgt.i, tgt.j);
            if (t === T.TREE) {
                this.#laborDrain('chop');           // felling a tree is heavy work
                const tier = w.treeStage(tgt.i, tgt.j), key = pkey(tgt.i, tgt.j);   // a mature tree takes more chops
                const hits = (w.rockWork.get(key) || 0) + 1;
                if (hits < TREE_CHOPS[tier] && this.energy > 0.12) {   // still standing — keep chopping in place
                    w.rockWork.set(key, hits);
                    this.chopTimer = this.#laborTime('chop'); this.state = 'chop'; return;
                }
                w.rockWork.delete(key); w.treePlanted.delete(key);   // it's a stump now — forget its growth clock
                w.set(tgt.i, tgt.j, T.STUMP);
                const wood = TREE_WOOD[tier];   // sapling 1 / young 3 / mature 5
                this.wood += wood;
                this.say(`+${wood} wood`, '#c8a060');
                if (treeIsFruit(tgt.i, tgt.j) && w.isFruitSeason()) {   // an apple tree IN SEASON drops fruit too
                    const apples = 2 + tier, s = this.sheet;
                    s.goods = s.goods || {}; s.goods.apple = (s.goods.apple || 0) + apples;
                    this.say(`+${apples} apples`, '#e04838');
                }
                this.gainXP(1 + tier);
                this.woodTarget = null;
                // The stump is left standing — grubbing it is the farmer's own call. It's worth as
                // much wood as the trunk was (WOOD_STUMP), so when they next need wood nearestWood
                // may well send them back for it; the DEMAND is what drives the choice, not a script.
            } else if (t === T.STUMP) {
                this.#laborDrain('break');          // grubbing the stump — heavy, rooted graft
                const key = pkey(tgt.i, tgt.j);
                const hits = (w.rockWork.get(key) || 0) + 1;
                if (hits < STUMP_CHOPS && this.energy > 0.12) {   // roots still holding — keep grubbing
                    w.rockWork.set(key, hits);
                    this.chopTimer = this.#laborTime('break'); this.state = 'break'; return;
                }
                w.rockWork.delete(key);
                w.set(tgt.i, tgt.j, T.GRASS);
                this.wood += WOOD_STUMP;
                this.say(`+${WOOD_STUMP} wood`, '#c8a060');
                this.gainXP(1);
            } else this.#laborDrain('break');
        }
        this.woodTarget = null;   // (a partial big-tree chop returned earlier, keeping its target)
        this.state = 'decide';
    }

    // Spend energy on a labor action; working while already exhausted builds STRAIN, which
    // raises the odds of falling ill (see #dailyHealthCheck + the exhaustion nudge in #decide).
    #spendEnergy(cost) {
        this.energy = Math.max(0, this.energy - cost);
        // strain only builds when running on fumes, and more gently than before, so bots don't
        // fall ill from a normal day's clearing/fencing.
        if (this.energy < 0.18) this.strain = (this.strain || 0) + (0.2 - this.energy) * 2 + 0.12;
        else this.strain = Math.max(0, (this.strain || 0) - 0.08);
    }
    // Labor duration + energy scale with STR (strong bots swing faster and tire a touch less).
    #laborTime(act) { return LABOR[act].time / (this.workSpeed() * (1 + Math.max(0, mod(this.sheet.stats.str)) * 0.12)); }
    #laborDrain(act) { this.#spendEnergy(LABOR[act].energy * (1 - Math.max(0, mod(this.sheet.stats.str)) * 0.05)); }

    #completeFencePost() {
        const p = this.plot;
        if (this.pendingFence && this.wood >= this.pendingFence.cost) this.wood -= this.pendingFence.cost;
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
        this.#laborDrain('mine');
        if (tgt && w.get(tgt.i, tgt.j) === T.ROCK) {
            const tier = obstacleTier(tgt.i, tgt.j), key = pkey(tgt.i, tgt.j);   // big rocks are a slog
            const hits = (w.rockWork.get(key) || 0) + 1;
            if (hits >= tier + 1) {                       // shattered — bulk pays off in ore + XP
                w.rockWork.delete(key);
                w.set(tgt.i, tgt.j, T.GRASS);
                const ore = ORE_ROCK * (tier + 1);
                this.ore += ore; this.say(`+${ore} ore`, '#a8b0c0'); this.gainXP(1 + tier);
                this.mineTarget = null;
            } else {                                      // still standing — keep swinging in place
                w.rockWork.set(key, hits);
                if (this.energy > 0.12) { this.chopTimer = this.#laborTime('mine'); this.state = 'mine'; return; }
                this.mineTarget = null;   // too spent — leave the boulder half-worked and come back later
            }
        } else this.mineTarget = null;
        this.state = 'decide';
    }

    tick(dt) {
        this.animTime += dt;
        if (this.downed) { this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2.5); return; }   // out cold, recovering at home
        this.helpCooldown = Math.max(0, this.helpCooldown - dt);
        this.poachCooldown = Math.max(0, this.poachCooldown - dt);
        this.coopCooldown = Math.max(0, this.coopCooldown - dt);
        this.wellAskCooldown = Math.max(0, this.wellAskCooldown - dt);
        this.exploreCooldown = Math.max(0, this.exploreCooldown - dt);
        this.oreExpedCooldown = Math.max(0, this.oreExpedCooldown - dt);
        this.tradeCooldown = Math.max(0, this.tradeCooldown - dt);
        this.barterCooldown = Math.max(0, this.barterCooldown - dt);
        this.annexCooldown = Math.max(0, this.annexCooldown - dt);
        // every farmer lifts the fog around wherever they walk — the map grows with the town
        {
            const fi = Math.floor(this.pos.i), fj = Math.floor(this.pos.j);
            if (fi !== this._revI || fj !== this._revJ) {
                this._revI = fi; this._revJ = fj;
                this.discovered += this.world.reveal(fi, fj);
            }
        }
        this.thoughtBubbleTimer -= dt;
        if (this.chatCooldown > 0) this.chatCooldown -= dt;
        // opportunistic small talk as bots pass each other (doesn't interrupt what they're doing)
        else if (!this.world.isNight() && (this.state === 'walk' || this.state === 'idle')) this.#maybeChat();
        if (this.bubble) { this.bubble.t -= dt; if (this.bubble.t <= 0) this.bubble = null; }
        if (this.carryCrop) { this.carryCrop.t -= dt; if (this.carryCrop.t <= 0) this.carryCrop = null; }
        this.sparkle = Math.max(0, this.sparkle - dt);
        this.threatAlert = Math.max(0, this.threatAlert - dt);
        this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2.5);
        if (this.emoteT > 0) { this.emoteT -= dt; if (this.emoteT <= 0) this.emote = null; }
        if (this.carryTrophy) { this.carryTrophy.t -= dt; if (this.carryTrophy.t <= 0) this.carryTrophy = null; }
        // recovery beat (B5): a badly-wounded farmer who mends back to full gives a visible perk-up
        if (this.maxHp) {
            if (this.hp <= this.maxHp * 0.4) this._wasHurt = true;
            else if (this._wasHurt && this.hp >= this.maxHp) { this._wasHurt = false; this.sparkle = Math.max(this.sparkle, 1); this.say('good as new', '#7dd069'); }
        }

        if (this.state === 'sleep') this.energy = Math.min(1, this.energy + SLEEP_RESTORE * dt);
        else if (this.state === 'rest') this.energy = Math.min(1, this.energy + REST_RESTORE * dt);
        else if (this.state === 'sick') this.energy = Math.min(1, this.energy + REST_RESTORE * 0.6 * dt);
        else if (ENERGY_NEUTRAL.has(this.state)) this.energy = Math.max(0, this.energy - AWAKE_DRAIN * dt);   // labor/combat
        else this.energy = Math.min(1, this.energy + IDLE_REGAIN * dt);   // idle / walking / exploring: a slow second wind

        // HP: REST knits you back together (sleeping/resting/recovering), while an untreated illness
        // gnaws at it if you stay on your feet. Bleed out entirely and you COLLAPSE (a downed reset).
        const resting = this.state === 'sleep' || this.state === 'rest' || this.state === 'sick';
        // rest mends a wound only to HP_REST_CAP; the last stretch to full needs MEAT — so a bad scuffle
        // has lasting teeth and hunted meat is worth hoarding. Never DROPS hp already above the cap.
        if (resting && this.hp < this.maxHp * HP_REST_CAP) this.hp = Math.min(this.maxHp * HP_REST_CAP, this.hp + HP_REST * dt);
        else if (this.health === 'sick') this.hp = Math.max(0, this.hp - HP_SICK_DRAIN * dt);
        if (this.hp <= 0 && this.state !== 'fight' && this.state !== 'flee') this.world.collapse(this);

        switch (this.state) {
            case 'decide': this.#decide(); break;
            case 'decide-help': this.#decideHelp(); break;

            case 'walk': {
                const P = this.path;
                // recoil: an idle wanderer who spots someone they can't stand drift close breaks
                // off and re-routes away (the wander step then picks the far corner of their land).
                // Only ever interrupts aimless wandering — real errands are never derailed.
                if (P.then === 'wander') {
                    this.avoidCooldown = (this.avoidCooldown || 0) - dt;
                    if (this.avoidCooldown <= 0) {
                        this.avoidCooldown = 1.2;
                        const foe = this.#dislikedNear(2.8);
                        if (foe) {
                            this.think(`NOT NEAR ${shortName(foe).toUpperCase()}. NO THANKS.`); this.emote = 'grudge'; this.emoteT = 1.6;
                            // #86 — a VOLATILE hand doesn't just avoid; they escalate: a sharper grudge and,
                            // now and then, a public blow-up that sours it for good (a rift beat).
                            if (this.volatility > 0.66) {
                                this.adjustOpinion(foe, -0.06, `bristled at ${shortName(foe)}`);
                                if (this.rand() < 0.2) { this.say(`I'VE HAD IT WITH ${shortName(foe).toUpperCase()}!`, '#e05040');
                                    foe.adjustOpinion(this, -0.1, 'blew up at me over nothing');
                                    this.world.addChronicle('rift', `${this.sheet.name.split(' ')[0]} blew up at ${foe.sheet.name.split(' ')[0]} in the open.`, this, foe, '#e05040'); }
                            }
                            this.path = null; this.state = 'decide'; break;
                        }
                    }
                }
                // absolute freeze watchdog: if position hasn't changed at all for a few seconds
                // (any cause — a degenerate path, a tile changed mid-walk), bail and redecide.
                if (this._freezePos && Math.abs(this.pos.i - this._freezePos.i) < 0.001 && Math.abs(this.pos.j - this._freezePos.j) < 0.001) {
                    this._freezeT = (this._freezeT || 0) + dt;
                    if (this._freezeT > 4) { this._freezeT = 0; this.path = null; this.state = 'decide'; break; }
                } else { this._freezePos = { i: this.pos.i, j: this.pos.j }; this._freezeT = 0; }
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
                    else if (then === 'fish') { this.fishTimer = this.#laborTime('fish'); this.state = 'fish'; }
                    else if (then === 'fencepost') { this.fenceTimer = this.#laborTime('fencepost'); this.state = 'fencepost'; }
                    else if (then === 'housebuild') { this.buildTimer = this.#laborTime('housebuild'); this.state = 'housebuild'; }
                    else if (then === 'scout') this.state = 'decide';   // reached a survey stop -> assess it (see #seekHomestead)
                    else if (then === 'fight') { this.fightTimer = 0.8; this.state = 'fight'; }
                    else if (then === 'scarecrow') { this.chopTimer = this.#laborTime('scarecrow'); this.state = 'scarecrow'; }
                    else if (then === 'fetchwater' || then === 'fetchwater-help') {
                        // hard guard: only a finished, listed, READY well yields water — never a build site
                        if (this.fetchWellRef && (!this.world.wells.includes(this.fetchWellRef) || this.fetchWellRef.ready !== true)) {
                            this.fetchWellRef = null; this.state = 'decide'; break;
                        }
                        this.carryWater = this.maxWater; this.say('splash');
                        if (this.fetchWellRef) { this.world.payWellToll(this, this.fetchWellRef); this.fetchWellRef = null; }
                        // resume the original watering task
                        this.state = then === 'fetchwater-help' ? 'decide-help' : 'decide';
                    }
                    else if (then === 'sleepwalk') this.state = 'sleep';
                    else if (then === 'rest') this.state = 'rest';
                    else if (then === 'sick') this.state = 'sick';
                    else if (then === 'shelter') { this.state = 'shelter'; this.say('yikes!'); }
                    else if (then === 'craft') { this.craftTimer = 2.6 / this.workSpeed(); this.state = 'craft'; }
                    else if (then === 'build') this.state = 'build';
                    else if (then === 'coopbuild') this.state = 'coopbuild';
                    else if (then === 'coopdrop') {
                        const coop = this.world.coops[0];
                        if (coop) this.world.depositCoop(this, coop);
                        this.state = 'decide';
                    }
                    else if (then === 'projdrop') { this.world.depositProject(this); this.state = 'decide'; }
                    else if (then === 'donate') { this.#completeDonate(); this.state = 'decide'; }
                    else if (then === 'care') { this.state = 'care'; this.careTimer = 1.2; }
                    else if (then === 'explore') this.#completeExplore();
                    else if (then === 'trade') this.#completeTrade();
                    else if (then === 'barter') this.#completeBarter();
                    else if (then === 'annex') this.#completeAnnex();
                    else if (then === 'treasure') { this.world.openTreasure(this); this.state = 'decide'; }
                    else { this.state = 'idle'; this.wanderTimer = 1 + this.rand() * 2.5; }
                } else {
                    const step = Math.min((this.speed * dt) / dist, 1);
                    let ni = this.pos.i + dx * step, nj = this.pos.j + dy * step;
                    // never clip into a solid tile, even when A* failed and we're straight-lining.
                    // Exception: if we're STANDING on a solid tile (something got built underfoot),
                    // movement is always allowed — otherwise the bot is entombed forever.
                    const gi = Math.floor(P.i), gj = Math.floor(P.j);
                    const standingSolid = this.world.pathBlocked(Math.floor(this.pos.i), Math.floor(this.pos.j));
                    const solid = (ti, tj) => !standingSolid && !(Math.floor(ti) === gi && Math.floor(tj) === gj) && this.world.pathBlocked(Math.floor(ti), Math.floor(tj));
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
            case 'craft': this.craftTimer -= dt; if (this.craftTimer <= 0) this.#completeCraft(); break;
            case 'forage': this.forageTimer -= dt; if (this.forageTimer <= 0) this.#completeForage(); break;
            case 'fish': this.fishTimer -= dt; if (this.fishTimer <= 0) this.#completeFish(); break;
            case 'fencepost': this.fenceTimer -= dt; if (this.fenceTimer <= 0) this.#completeFencePost(); break;
            case 'housebuild': this.buildTimer -= dt; if (this.buildTimer <= 0) this.#completeHouseStep(); break;
            case 'scarecrow': this.chopTimer -= dt; if (this.chopTimer <= 0) this.#completeScarecrow(); break;
            case 'scout':   // pause to weigh a candidate homestead before moving on to the next
                this.scoutTimer -= dt;
                if (this.scoutTimer <= 0) this.state = 'decide';
                break;
            case 'fight':   // stand and trade blows — the encounter tick lands the clashes; re-decide often
                this.fightTimer -= dt;
                if (this.fightTimer <= 0) this.state = 'decide';
                break;
            case 'flee': {   // bolt for their OWN homestead (their refuge), sidestepping obstacles as they run
                const home = this.plot && this.plot.sited ? { i: this.plot.x + 6, j: this.plot.y + 6 } : { i: CENTER, j: CENTER };
                const dx = home.i - this.pos.i, dy = home.j - this.pos.j, d = Math.hypot(dx, dy) || 1;
                const sp = this.speed * 1.2 * dt;
                const ni = this.pos.i + dx / d * sp, nj = this.pos.j + dy / d * sp;
                if (!this.world.pathBlocked(Math.floor(ni), Math.floor(nj))) { this.pos.i = ni; this.pos.j = nj; }
                else { this.pos.i += (dy / d) * sp; this.pos.j += (-dx / d) * sp; }   // veer around a blocker
                this.world.reveal(Math.round(this.pos.i), Math.round(this.pos.j), 3);
                this.fleeTimer -= dt;
                if (this.fleeTimer <= 0) this.state = 'decide';
                break;
            }

            case 'hunt': {   // run down a fleeing prey animal; when in range, lunge for the kill (see #resolveHunt)
                const a = this.huntTarget;
                if (!a || a.done || !this.world.prey.includes(a)) { this.huntTarget = null; this.state = 'decide'; break; }
                this.huntTimer -= dt;
                const dx = a.i - this.pos.i, dy = a.j - this.pos.j, dist = Math.hypot(dx, dy) || 1;
                if (Math.abs(dx) > 0.05) this.facing = dx < 0 ? -1 : 1;
                this.moveDir = 'side';
                if (dist <= 1.2) { this.#resolveHunt(a); break; }   // close enough to strike
                const sp = this.speed * 1.12 * dt;                  // press the chase a shade faster than it flees
                let ni = this.pos.i + dx / dist * sp, nj = this.pos.j + dy / dist * sp;
                if (this.world.pathBlocked(Math.floor(ni), Math.floor(nj))) { ni = this.pos.i + (dy / dist) * sp; nj = this.pos.j + (-dx / dist) * sp; }
                if (!this.world.pathBlocked(Math.floor(ni), Math.floor(nj))) { this.pos.i = ni; this.pos.j = nj; }
                this.energy = Math.max(0, this.energy - ACTION_ENERGY.build * 0.6 * dt);
                this.world.reveal(Math.round(this.pos.i), Math.round(this.pos.j), 3);
                if (this.huntTimer <= 0 || this.energy < 0.12 || dist > 16) {   // ran out of wind / lost it
                    this.say('lost it', '#9a9a8a'); a.hunter = null; this.huntTarget = null; this.state = 'decide';
                }
                break;
            }

            case 'build': {
                const pr = this.world.project;
                if (!pr) { this.state = 'decide'; break; }
                this.world.contributeBuild(this, dt);
                this.energy = Math.max(0, this.energy - ACTION_ENERGY.build * dt);
                if (this.world.isNight() || this.energy < 0.3 || this.rand() < dt * 0.06) this.state = 'decide';
                break;
            }

            case 'coopbuild': {
                const coop = this.world.coops[0];
                if (!coop || coop.stage !== 'build') { this.state = 'decide'; break; }
                this.world.contributeCoop(this, dt);
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
                        sick.adjustOpinion(this, 0.35, 'nursed me when I was ill');   // kindness is remembered
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
            case 'shelter': if (this.world.weather !== 'storm' && this.world.weather !== 'blizzard') this.state = 'decide'; break;
        }

        // Storage clamp runs LAST, so mid-tick gains (a mined rock, a chopped tree, a collected
        // good) are caught the same tick — resources can never exceed the home's cap AFTER a tick
        // (Codex #2: mining used to push ore past cap until the next tick's start-of-tick clamp).
        // Overflow can't be kept — a full store is one more reason to build the bigger house.
        const cap = this.storageCap();
        if (this.wood > cap.wood || this.ore > cap.ore) {
            this.wood = Math.min(this.wood, cap.wood);
            this.ore = Math.min(this.ore, cap.ore);
            if (this._storeFullT === undefined || this._storeFullT <= 0) {
                this._storeFullT = 60;
                if (this.plot.built.level < 3) { this.think('MY STORES ARE FULL - A BIGGER HOME WOULD HOLD MORE'); this.wantUpgrade = true; }
            }
        }
        if (this._storeFullT > 0) this._storeFullT -= dt;
    }

    #startPoachAction() { this.poachTimer = 2.2 / this.workSpeed(); this.state = 'poach'; }
}
