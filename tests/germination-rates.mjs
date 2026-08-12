// tests/germination-rates.mjs — #inspiration slice 2: the RATE TABLE, enforced.
//
// The council's condition for germination (INSPIRATION_PLAN.md item 10): a rate table per
// personality archetype, verified offline BEFORE shipping — because "low-curiosity minds may
// honestly never germinate" is character only if the numbers exist; without them it is the
// perfect cover story for a dead feature. This harness measures germination from a single
// standard deposit (w=1.2, the QUESTION deposit) across many world seeds and pins BANDS, not
// exact values, so tuning changes must be deliberate re-pins.
//
// Clock context: a game day is ~6.3 real minutes at 1x. The window pinned here: a curious mind
// usually sprouts within 5 dawns; an incurious one usually does not; nobody sprouts before
// GERM_MIN_AGE; pressure blocks absolutely (tested in inspiration.mjs).
//
// Run: `node tests/germination-rates.mjs`

import assert from 'node:assert/strict';
import { World } from '../farm.js';
import { generateCrew, hashString } from '../dna.js';

let passed = 0;
const ok = (name) => { passed++; console.log(`  ok - ${name}`); };

function boot(seed) {
    const m = generateCrew(seed);
    const used = new Set();
    const pick = () => {
        const un = m.filter(x => !used.has(x.id));
        let b = un[0], bh = 0xffffffff;
        for (const x of un) { const h = hashString((x.id || x.title || '') + ':pick'); if (h < bh) { bh = h; b = x; } }
        used.add(b.id); return b;
    };
    const w = new World(seed, 'human');
    for (let i = 0; i < 8; i++) w.addFarmer(pick(), 0);
    w.ensureFounderVariety();
    return w;
}

// One trial: a standard QUESTION-sized deposit on day 1, curiosity pinned, walk N dawns.
// Returns the dawn offset the seed sprouted on, or null.
function trial(worldSeed, curiosity, kind, dawns) {
    const w = boot(worldSeed);
    const f = w.farmers[0];
    f.sheet.personality.curiosity = curiosity;
    const c = f.conscience;
    c.seeds = { [kind]: { w: 1.2, firstDay: w.day, day: w.day, target: null } };
    for (let i = 1; i <= dawns; i++) {
        w.day += 1;
        f.reflect();
        if (c.urge && c.urge.origin === 'inspiration') return i;
        if (!c.seeds[kind]) return null;   // faded to the floor - forgotten
    }
    return null;
}

const TRIALS = 60;
const seeds = Array.from({ length: TRIALS }, (_, i) => 100000 + i * 7919);

for (const kind of ['explore', 'chop']) {
    const hi = seeds.map(s => trial(s, 0.9, kind, 5)).filter(d => d != null);
    const lo = seeds.map(s => trial(s, 0.15, kind, 5)).filter(d => d != null);
    const hiRate = hi.length / TRIALS, loRate = lo.length / TRIALS;
    console.log(`  ${kind}: high-curiosity ${Math.round(hiRate * 100)}% within 5 dawns (median dawn ${hi.sort((a, b) => a - b)[Math.floor(hi.length / 2)] ?? '-'}), low-curiosity ${Math.round(loRate * 100)}%`);

    assert.ok(hiRate >= 0.35, `${kind}: a curious mind sprouts often enough to be seen (${Math.round(hiRate * 100)}% >= 35%)`);
    assert.ok(loRate <= 0.25, `${kind}: an incurious mind stays itself (${Math.round(loRate * 100)}% <= 25%)`);
    assert.ok(hiRate > loRate + 0.15, `${kind}: curiosity is the engine - the gap is visible (${Math.round((hiRate - loRate) * 100)}pt)`);
    assert.ok(hi.every(d => d >= 2), `${kind}: nothing sprouts before GERM_MIN_AGE`);
    ok(`${kind}: rate bands hold (curious ~seen, incurious ~rare, gap real, min-age respected)`);
}

console.log(`germination-rates: ${passed} checks passed`);
