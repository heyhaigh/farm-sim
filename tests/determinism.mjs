// tests/determinism.mjs — the project's #1 invariant, committed and reproducible.
//
// DOCTRINE: the SIM consumes only seeded rng (world.rand, per-farmer this.rand) + pure position hashes with
// stable, sorted iteration. Same seed => byte-identical town, twice. The LLM + SuperMemory are display/
// persistence side-channels the sim never reads in its loop (compile-don't-query), so this harness runs the
// sim headless with both OFF — which is exactly the deterministic core the doctrine describes.
//
// Run: `node tests/determinism.mjs`  (exits non-zero if any seed fails to self-compare)
//
// It boots the founder cast the way the game does (generateCrew -> addFarmer -> ensureFounderVariety), ticks
// N days, and hashes farmer + world state across TWO runs of the same seed. A same-seed run that differs
// run-to-run is a P0 determinism bug. The BASELINE hashes below fingerprint the current tree; a legitimate
// sim-affecting change re-baselines them (update the constant), but same-twice must ALWAYS hold.

import { World } from '../farm.js';
import { generateCrew, hashString } from '../dna.js';

const DT = 1 / 30, DAYS = 30;
const SEEDS = [20260706, 42, 7, 3];

// Baseline digests at HEAD (LLM + SuperMemory off, 30-day run). Update deliberately when a sim change
// legitimately re-baselines; a DRIFT here on an unrelated change is a determinism regression to investigate.
const BASELINE = {
    20260706: '9139a75d',
    42: 'c4f15880',
    7: '720c699d',
    3: 'f60ffd9b',
};

function boot(seed) {
    const m = generateCrew(seed);
    const used = new Set();
    // stable, seed-ordered founder pick (mirrors the game's founder selection; no Math.random)
    const pick = () => {
        const un = m.filter(x => !used.has(x.id));
        let b = un[0], bh = 0xffffffff;
        for (const x of un) { const h = hashString((x.id || x.title || '') + ':pick'); if (h < bh) { bh = h; b = x; } }
        used.add(b.id); return b;
    };
    const w = new World(seed);
    for (let i = 0; i < 8; i++) w.addFarmer(pick(), 0);
    w.ensureFounderVariety();
    return w;
}

function fnv(s) {
    let h = 0x811c9dc5 >>> 0;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return ('00000000' + h.toString(16)).slice(-8);
}

function digest(seed) {
    const w = boot(seed);
    const target = w.day + DAYS;
    while (w.day < target) w.tick(DT);
    const snap = {
        day: w.day, year: w.year, season: w.season,
        recipes: Object.keys(w.recipes || {}).sort(),
        tales: (w.tales || []).map(x => [x.ingredient, x.originSeed]).sort(),
        roles: w.roles ? { manager: w.roles.manager?.sheet?.seed ?? null, watch: w.roles.watch?.sheet?.seed ?? null } : null,
        farmers: w.farmers.map(f => ({
            seed: f.sheet.seed, xp: f.sheet.xp, lvl: f.sheet.level,
            inv: (f.sheet.recipes || []).slice().sort(), belief: f.sheet.rareBelief || {},
            goods: f.sheet.goods || {}, produce: f.sheet.produce || 0, i: f.pos.i, j: f.pos.j,
        })),
    };
    return fnv(JSON.stringify(snap));
}

let failed = 0;
for (const seed of SEEDS) {
    const a = digest(seed), b = digest(seed);
    const sameTwice = a === b;
    const baseline = BASELINE[seed];
    const matchesBaseline = baseline == null || a === baseline;
    const status = !sameTwice ? 'FAIL (nondeterministic)' : !matchesBaseline ? `DRIFT (baseline ${baseline})` : 'ok';
    if (!sameTwice) failed++;
    console.log(`seed ${String(seed).padEnd(9)} ${a}  same-twice=${sameTwice}  ${status}`);
}

if (failed) { console.error(`\n${failed} seed(s) failed the same-twice invariant — P0 determinism bug.`); process.exit(1); }
console.log('\nAll seeds self-compare identical. Determinism holds.');
