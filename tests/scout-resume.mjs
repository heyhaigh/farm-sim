// tests/scout-resume.mjs — the cells:0 corruption class (the "naked tipi" bug). Run: node tests/scout-resume.mjs
//
// ROOT CAUSE (found 2026-07-31, live on seed 1344037703 "Brugut"): a founder's scout itinerary
// (scoutList/claim) is transient — a player who saves and reloads while the day-1 founders are
// mid-scout resumes them with neither, and #seekHomestead's old safety branch marked the plot
// `sited = true` WITHOUT staking cells. The house then built on a cell-less plot and the fence
// "completed" at fencePostTarget's empty-ring floor (Math.max(8, ...)) — the 8/8-posts +
// fence:true + cells:0 signature on every home in town, invisible headlessly because no digest
// run ever reloads inside that window.
//
// This test IS that window: boot Brugut's real seed, save when all founders are mid-scout,
// reload, play to day 4, and assert every sited home has real cells and an honest fence target.
// Also asserts #cellheal (the load-path net) still rebuilds a deliberately-corrupted old save.

import { World } from '../farm.js';
import { generateCrew, hashString } from '../dna.js';

const DT = 1 / 30;

function boot(seed, culture) {
    const m = generateCrew(seed);
    const used = new Set();
    const pick = () => {
        const un = m.filter(x => !used.has(x.id));
        let b = un[0], bh = 0xffffffff;
        for (const x of un) { const h = hashString((x.id || x.title || '') + ':pick'); if (h < bh) { bh = h; b = x; } }
        used.add(b.id); return b;
    };
    const w = new World(seed, culture);
    for (let i = 0; i < 8; i++) w.addFarmer(pick(), 0);
    w.ensureFounderVariety();
    return { w, m };
}

let pass = true;
const ok = (c, msg) => { console.log((c ? '  ✓ ' : '  ✗ FAIL ') + msg); if (!c) pass = false; };

console.log('Part 1 — reload MID-SCOUT must not produce cell-less sited homes');
{
    const { w, m } = boot(1344037703, 'orc');   // Brugut's own seed
    let guard = 0;
    while (guard++ < 30 * 300) {
        w.tick(DT);
        if (w.farmers.filter(f => f.scoutList && !f.plot.sited).length >= 6) break;
    }
    const midScout = w.farmers.filter(f => f.scoutList && !f.plot.sited).length;
    ok(midScout >= 6, `save point is genuinely mid-scout (${midScout}/8 founders en route — non-vacuity)`);
    const w2 = World.fromSave(structuredClone(w.serialize()), m);
    while (w2.day < 4) w2.tick(DT);
    const sited = w2.plots.filter(p => p.sited && p.built.level >= 1);
    const bad = sited.filter(p => p.cells.size === 0);
    const floored = sited.filter(p => p.fenceTarget === 8 && p.w + p.h > 6);   // the empty-ring floor on a big rect
    ok(sited.length >= 6, `homes actually built after the reload (${sited.length} sited level-1+ — non-vacuity)`);
    ok(bad.length === 0, `no sited home has empty cells (${bad.length} corrupted — the Brugut signature would be 7-8)`);
    ok(floored.length === 0, `no fence completed at the empty-ring floor of 8 posts (${floored.length} floored)`);
}

console.log('Part 2 — #cellheal still rebuilds an old corrupted save on load');
{
    const { w, m } = boot(1344037703, 'orc');
    while (w.day < 4) w.tick(DT);
    const save = structuredClone(w.serialize());
    // forge the pre-fix corruption into the save: empty every home's cells, floor its fence
    let forged = 0;
    for (const p of save.plots) if (p.sited && p.built.level >= 1) { p.cells = []; p.fenceTarget = 8; p.fencePosts = 8; forged++; }
    ok(forged >= 4, `forged ${forged} corrupted plots into the save (non-vacuity)`);
    // Codex #70-1 — expanded plots are naturally NON-SQUARE (#recomputeBounds). Reshape one forged plot to
    // 17x9: a single width-derived offset healed 36 of its cells OUTSIDE the saved rectangle.
    const odd = save.plots.find(p => p.sited && p.built.level >= 1);
    odd.x -= 2; odd.w = 17; odd.h = 9;
    const w2 = World.fromSave(save, m);
    // Codex #69-1 — the heal must reconstruct the STARTER claim (centred INITIAL_PLOT, 9x9=81 cells,
    // 32-post perimeter), never the full 13x13 reservation (169 cells / 48 posts — an estate overgrant).
    const span = World.INITIAL_PLOT;
    const healed = w2.plots.filter(p => p.sited && p.built.level >= 1 &&
        p.cells.size === span * span && p.fenceTarget === 4 * span - 4 && p.fencePosts <= p.fenceTarget);
    ok(healed.length === forged, `#cellheal rebuilt all ${forged} plots as the ${span}x${span} starter claim — got ${healed.length}`);
    // Codex #70-1 — every healed cell must sit INSIDE its plot's saved rectangle (per-axis offsets)
    let outside = 0;
    for (const p of w2.plots) if (p.sited && p.built.level >= 1)
        for (const k of p.cells) { const [ci, cj] = k.split(',').map(Number);
            if (ci < p.x || ci >= p.x + p.w || cj < p.y || cj >= p.y + p.h) outside++; }
    ok(outside === 0, `no healed cell falls outside its plot rect (${outside} outside — the 17x9 plot would leak 36 with a single offset)`);
    // and the healed world still runs + round-trips
    for (let i = 0; i < 30 * 10; i++) w2.tick(DT);
    const w3 = World.fromSave(structuredClone(w2.serialize()), m);
    ok(w3.plots.every(p => !p.sited || p.built.level < 1 || p.cells.size > 0), 'healed world survives tick + save round-trip');
}

if (!pass) { console.error('\nscout-resume contract violated'); process.exit(1); }
console.log('\nScout-resume contract holds: a mid-scout reload stakes honestly, and old corrupted saves heal.');
