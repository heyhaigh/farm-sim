// tests/paddock.mjs — the PADDOCK + POND net, covering what determinism.mjs structurally cannot.
//
// WHY THIS EXISTS: facilities are gated on house tier, and no farm reaches a pond (or a second livestock
// pen) inside determinism.mjs's 30-day window. So the project's strongest harness pins four digests that
// never once execute this code — "determinism passed" says nothing about any of it. Three consecutive
// review rounds found real defects in exactly that blind spot: stock living behind the barn, farmers
// wading across ponds to collect, a legacy pond loading with water it didn't have, lily rafts collapsing
// to bare rootstocks. Every one was caught by a throwaway script that was then thrown away.
//
// This harness matures a town past the tier gate, builds every facility, and asserts the invariants those
// bugs violated. It also samples the lily-raft placer across many seeded rng streams, because the raft
// collapse was a TAIL defect — invisible in any single town, ~0.6% of streams.
//
// Run: `node tests/paddock.mjs`  (exits non-zero on any violation)

import { World } from '../farm.js';
import { generateCrew } from '../dna.js';

const DT = 1 / 30;
const fail = [];
const check = (ok, label, detail) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`); if (!ok) fail.push(label); };

function boot(seed) {
    const w = new World(seed, 'human');
    for (const m of generateCrew(seed)) w.addFarmer(m);
    if (w.ensureFounderVariety) w.ensureFounderVariety();
    return w;
}
function run(w, days) { const n = Math.round(days * 190 / DT); for (let k = 0; k < n; k++) w.tick(DT); }

// Mature a town to the point where every facility type is buildable, then build them all.
function matureTown(seed) {
    const w = boot(seed);
    run(w, 22);
    for (const f of w.farmers) {
        if (f.plot.built.fence) { w.raiseBuilding(f, 2, true); w.raiseBuilding(f, 3, true); }
        f.wood = 500; f.ore = 80;
        f.sheet.goods = f.sheet.goods || {}; f.sheet.goods.grain = 999;
        f.wantFacility = true;
    }
    for (let pass = 0; pass < 8; pass++) for (const f of w.farmers) w.buildNextFacility(f);
    return w;
}
const facilities = (w, type) => w.farmers.flatMap(f => f.plot.facilities.filter(x => !type || x.type === type));

console.log('PADDOCKS + PONDS — the code determinism.mjs never reaches\n');

const w = matureTown(424242);
run(w, 6);
const T_WATER = (() => { const p = facilities(w, 'pond')[0]; return p && w.get(p.water.x, p.water.y); })();

console.log('Paddock geometry');
{
    const facs = facilities(w);
    const structs = facs.filter(f => f.struct);
    // Guard on the collection each aggregate ACTUALLY iterates. Guarding on `facs` while looping over
    // `f.struct` let the geometry checks pass vacuously if nothing with a building had been raised.
    check(facs.length > 0, 'the town built facilities', `${facs.length} across ${w.farmers.length} farms`);
    check(structs.length > 0, 'and buildings to check the geometry of', `${structs.length} with a struct`);
    // The premise this file rests on: a matured town exercises EVERY facility type. Losing mill or hatchery
    // coverage would otherwise leave the harness green while testing strictly less than it claims.
    const kinds = new Set(facs.map(f => f.type));
    const wanted = ['coop', 'pen', 'pond', 'mill', 'hatchery'];
    const missing = wanted.filter(k => !kinds.has(k));
    check(missing.length === 0, 'every facility type is represented', missing.length ? `missing ${missing.join(', ')}` : [...kinds].join(', '));

    let offCentre = 0, notSolid = 0;
    for (const f of structs) {
        const s2 = f.struct;
        if (Math.abs(s2.cx - (s2.i + s2.w / 2)) > 1e-9 || Math.abs(s2.cy - (s2.j + s2.h / 2)) > 1e-9) offCentre++;
        for (let j = s2.j; j < s2.j + s2.h; j++) for (let i = s2.i; i < s2.i + s2.w; i++) if (!w.pathBlocked(i, j)) notSolid++;
    }
    check(offCentre === 0, 'draw anchor sits on the footprint centre', `${offCentre} off`);
    check(notSolid === 0, 'every footprint tile is solid', `${notSolid} walkable`);

    // CONNECTIVITY, not adjacency. Asking only "does this paddock touch another paddock" lets two paddocks
    // vouch for each other out in open country while some third, unrelated one satisfies a global
    // "something touches the yard" counter. The real invariant is that the whole facility district is
    // REACHABLE from the yard through paddocks, so traverse it: seed from every paddock flush with the
    // yard, walk paddock-to-paddock, and require the traversal to cover all of them.
    let unreachable = 0, seeded = 0;
    for (const f of w.farmers) {
        const facs2 = f.plot.facilities;
        if (!facs2.length) continue;
        const touchesYard = (fac) => {
            for (let j = fac.y - 1; j <= fac.y + fac.h; j++) for (let i = fac.x - 1; i <= fac.x + fac.w; i++) {
                if (i >= fac.x && i < fac.x + fac.w && j >= fac.y && j < fac.y + fac.h) continue;
                const k = i + ',' + j;
                if (f.plot.cells.has(k) && !f.plot.padCells.has(k)) return true;
            }
            return false;
        };
        const adjacent = (a, b) => !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y);
        const reached = new Set();
        const queue = facs2.filter(touchesYard);
        seeded += queue.length;
        queue.forEach(x => reached.add(x));
        for (let n = 0; n < queue.length; n++)
            for (const other of facs2)
                if (!reached.has(other) && adjacent(queue[n], other)) { reached.add(other); queue.push(other); }
        unreachable += facs2.filter(x => !reached.has(x)).length;
    }
    check(seeded > 0, 'the district is anchored on the yard', `${seeded} paddocks flush with it`);
    check(unreachable === 0, 'every paddock is reachable from the yard', `${unreachable} stranded`);
}

console.log('\nLivestock containment');
{
    // TWO different invariants, and the previous version conflated them into one weak check.
    //
    // (1) penYardSpot's CONTRACT: where stock is turned out. Sampled directly across every pen and many rng
    //     values, because it is a pure function and that is far stronger evidence than glancing at where a
    //     handful of animals happen to be standing. Bounds here MIRROR PRODUCTION exactly: the paddock is
    //     half-open [x, x+w), so the far edge test is >=, not >; the trough exclusion is centred on
    //     (trough.i + 0.5) at +/-1.1, matching the window in penYardSpot; and "behind the building" is the
    //     whole north OR west strip, not just the north-west corner — the spawn L is east-and-south, so
    //     anything at fx < s.i or fy < s.j is behind it.
    const pens = facilities(w).filter(f => f.struct && f.trough);
    check(pens.length > 0, 'the town has pens with a building and a trough', `${pens.length}`);
    let outside = 0, onStruct = 0, onTrough = 0, behind = 0, samples = 0;
    for (const fac of pens) {
        const s2 = fac.struct;
        for (let k = 0; k < 400; k++) {
            let seed = (k * 2654435761) >>> 0;
            const rnd = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
                t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
            const sp = w.penYardSpot(fac, k, rnd);
            samples++;
            if (!Number.isFinite(sp.x) || !Number.isFinite(sp.y)) { outside++; continue; }
            if (sp.x < fac.x || sp.x >= fac.x + fac.w || sp.y < fac.y || sp.y >= fac.y + fac.h) outside++;
            if (sp.x >= s2.i && sp.x < s2.i + s2.w && sp.y >= s2.j && sp.y < s2.j + s2.h) onStruct++;
            if (Math.abs(sp.x - (fac.trough.i + 0.5)) < 1.1 && Math.abs(sp.y - (fac.trough.j + 0.5)) < 1.1) onTrough++;
            // The contract is "in the east-or-south L", which is NOT the same as "north or west of the
            // building": the south branch legitimately spans west of it (span starts at fac.x + 1.5), and
            // that ground is in FRONT in the axis that matters — it's the up-screen quadrant, small i+j,
            // that must stay clear. So: a spot must clear the building on at least one axis.
            if (sp.x < s2.i + s2.w && sp.y < s2.j + s2.h) behind++;
        }
    }
    check(samples > 0, 'sampled the turn-out placer', `${samples} placements`);
    check(outside === 0, 'never turns stock out beyond the paddock', `${outside} outside`);
    check(onStruct === 0, 'never turns stock out inside the building', `${onStruct} on it`);
    check(onTrough === 0, 'never turns stock out in the trough', `${onTrough} on it`);
    check(behind === 0, 'never turns stock out behind the building', `${behind} behind`);

    // (2) The LIVE containment bounds, which are what #tickProducers actually guarantees after animals have
    //     wandered. Asymmetric and scaled by build (see the inset note in farm.js). Note this deliberately
    //     does NOT assert "never behind the building": the far inset limits that strip, it does not forbid
    //     it, and an animal is free to wander round. Asserting otherwise would be a false invariant.
    let loose = 0, head = 0;
    for (const fac of facilities(w)) {
        for (const p of fac.producers) {
            if (p.kind === 'fish' || p.kind === 'pad') continue;
            head++;
            const bulky = p.kind !== 'chicken' && p.kind !== 'rooster';
            const padFar = bulky ? 1.35 : 0.7, padNear = bulky ? 0.55 : 0.4;
            const r = p.region || fac;
            const eps = 1e-6;
            if (p.fx < r.x + padFar - eps || p.fx > r.x + r.w - padNear + eps ||
                p.fy < r.y + padFar - eps || p.fy > r.y + r.h - padNear + eps) loose++;
        }
    }
    check(head > 0, 'the town has livestock to check', `${head} head`);
    check(loose === 0, 'every animal inside its containment bounds', `${loose} loose`);
}

console.log('\nPonds: a bank you can walk, water you cannot');
{
    const ponds = facilities(w, 'pond');
    check(ponds.length > 0, 'the town built ponds', `${ponds.length}`);
    let bankBlocked = 0, waterOpen = 0, lifeAshore = 0;
    for (const fac of ponds) {
        for (let j = fac.y; j < fac.y + fac.h; j++) for (let i = fac.x; i < fac.x + fac.w; i++) {
            const inWater = i >= fac.water.x && i < fac.water.x + fac.water.w && j >= fac.water.y && j < fac.water.y + fac.water.h;
            if (inWater && !w.pathBlocked(i, j)) waterOpen++;
            if (!inWater && w.pathBlocked(i, j)) bankBlocked++;
        }
        for (const p of fac.producers) if (w.get(Math.floor(p.fx), Math.floor(p.fy)) !== T_WATER) lifeAshore++;
    }
    check(bankBlocked === 0, 'the bank is walkable all the way round', `${bankBlocked} blocked tiles`);
    check(waterOpen === 0, 'the water is not walkable', `${waterOpen} open tiles`);
    check(lifeAshore === 0, 'no fish or lily sitting on dry land', `${lifeAshore} ashore`);
}

console.log('\nNobody wades: sampled every tick, not once at the end');
{
    // A SNAPSHOT after the run proves nothing — everyone has long since walked back ashore. With both shore
    // redirects removed the old single-sample check still reported "0 wading". Water occupancy has to be
    // watched CONTINUOUSLY across a run long enough for pond work (and poaching) to actually happen.
    // TWO towns, deliberately. 424242 alone was seed-lucky: it never produced a foe standing in a pond, so
    // it could not see farmers wading out to FIGHT one. 20260101 did, and is kept here as the regression
    // that found it. A single-seed behavioural check is a coin toss dressed as an assertion.
    const days = 8, steps = Math.round(days * 190 / DT);
    let waded = 0, worst = null, ticks = 0, states = {};
    for (const seed of [424242, 20260101]) {
        const wv = matureTown(seed);
        for (let k = 0; k < steps; k++) {
            wv.tick(DT); ticks++;
            if (k % 3) continue;                   // every 3rd tick: 10Hz of sim time
            for (const f of wv.farmers) {
                if (!f.pos) continue;
                if (wv.get(Math.floor(f.pos.i), Math.floor(f.pos.j)) === T_WATER) {
                    waded++; states[f.state] = (states[f.state] || 0) + 1;
                    if (!worst) worst = `${f.sheet.name.split(' ')[0]} on seed ${seed} at tick ${k}, state ${f.state}`;
                }
            }
        }
    }
    check(ticks > 0, 'ran two towns long enough for pond work', `${ticks} ticks over ${days} days each`);
    check(waded === 0, 'no farmer ever stands on water, in any state',
        waded ? `${waded} samples ${JSON.stringify(states)}, first: ${worst}` : 'across every sample of both towns');
}

console.log('\nPonds: a pre-bank save keeps the shape it was built with');
{
    // Through the REAL load path. The previous version mutated a live facility and hand-assigned the region
    // that fromSave is supposed to derive — so it tested its own assignment, and restoring the exact legacy
    // bug left it green. Build a faithful legacy SAVE instead: carve the water edge to edge so the saved
    // tiles say "no bank", strip `water` from the serialized record, and let World.fromSave rebuild it.
    const wl = matureTown(424242);
    const pondRects = [];
    for (const fac of facilities(wl, 'pond')) {
        for (let j = fac.y; j < fac.y + fac.h; j++) for (let i = fac.x; i < fac.x + fac.w; i++) wl.set(i, j, T_WATER);
        pondRects.push({ x: fac.x, y: fac.y, w: fac.w, h: fac.h });
    }
    const legacySave = structuredClone(wl.serialize());
    let stripped = 0;
    for (const pd of legacySave.plots) for (const fd of pd.facilities) if (fd.type === 'pond') { delete fd.water; stripped++; }
    const wr = World.fromSave(legacySave);            // <- the code under test
    const restored = facilities(wr, 'pond');
    check(stripped > 0 && restored.length === stripped, 'legacy ponds load', `${restored.length}/${stripped}`);
    let wrongRegion = 0, tilesNotWater = 0;
    for (const fac of restored) {
        for (const p of fac.producers)
            if (!p.region || p.region.w !== fac.w || p.region.h !== fac.h) wrongRegion++;
        for (let j = fac.y; j < fac.y + fac.h; j++) for (let i = fac.x; i < fac.x + fac.w; i++)
            if (wr.get(i, j) !== T_WATER) tilesNotWater++;
    }
    // The bug: deriving an inset for a pond that has none, confining its life to an inner square while the
    // outer ring stays water on the map. The region must match the RECT, because the rect is what's wet.
    check(wrongRegion === 0, 'confinement matches the water actually on the map', `${wrongRegion} mismatched`);
    check(tilesNotWater === 0, 'the saved tiles really are edge-to-edge water', `${tilesNotWater} dry`);
    run(wr, 4);
    let ashore = 0, n = 0;
    for (const fac of facilities(wr, 'pond')) for (const p of fac.producers) { n++; if (wr.get(Math.floor(p.fx), Math.floor(p.fy)) !== T_WATER) ashore++; }
    check(n > 0 && ashore === 0, 'legacy pond keeps its life on water', `${ashore}/${n} ashore`);
}

console.log('\nPonds: save round-trip');
{
    const saved = structuredClone(w.serialize());
    const w2 = World.fromSave(saved);
    const before = facilities(w, 'pond'), after = facilities(w2, 'pond');
    check(after.length === before.length, 'ponds survive the round-trip', `${after.length}/${before.length}`);
    let mismatched = 0;
    for (const fac of after) {
        if (!fac.water) { mismatched++; continue; }
        for (const p of fac.producers) if (!p.region || p.region.w !== fac.water.w || p.region.h !== fac.water.h) { mismatched++; break; }
    }
    check(mismatched === 0, 'water rect + confinement survive the round-trip', `${mismatched} mismatched`);
    run(w2, 3);
    let strayed = 0;
    for (const fac of facilities(w2, 'pond')) for (const p of fac.producers)
        if (p.fx < fac.water.x || p.fx > fac.water.x + fac.water.w || p.fy < fac.water.y || p.fy > fac.water.y + fac.water.h) strayed++;
    check(strayed === 0, 'nothing strays after a reload', `${strayed} strayed`);
}

console.log('\nLily rafts: the tail, not the average');
{
    // The collapse defect showed up in ~0.6% of rng streams — invisible in any single town.
    const mulberry32 = (a) => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    const probe = new World(1, 'human');
    const region = { x: 0, y: 0, w: 7, h: 7 };   // the water of a standard 9x9 pond paddock
    const N = 20000;
    let min = Infinity, lowTail = 0;
    for (let s = 0; s < N; s++) {
        const pads = probe.lilyRafts(region, mulberry32(s)).length;
        if (pads < min) min = pads;
        if (pads <= 3) lowTail++;
    }
    check(min >= 4, `no stream collapses a pond to bare rootstocks`, `min ${min} pads over ${N} streams`);
    check(lowTail === 0, 'no stream yields 3 pads or fewer', `${lowTail} did`);
    const a = JSON.stringify(probe.lilyRafts(region, mulberry32(21039)));
    const b = JSON.stringify(probe.lilyRafts(region, mulberry32(21039)));
    check(a === b, 'raft placement is deterministic for a given stream');
    // pads must never sit on the bank
    const spots = probe.lilyRafts({ x: 10, y: 10, w: 7, h: 7 }, mulberry32(7));
    const out = spots.filter(s => s.x < 10 || s.x > 17 || s.y < 10 || s.y > 17).length;
    check(out === 0, 'no pad placed outside the water', `${out} outside`);
}

console.log('\nFacility cost is charged as one bill');
{
    // A town raised to the tier gate but with NOTHING built yet — matureTown() builds everything out, which
    // leaves no farm holding a buildable plan to price.
    const wc = boot(20260101);
    run(wc, 22);
    for (const f of wc.farmers) {
        if (f.plot.built.fence) { wc.raiseBuilding(f, 2, true); wc.raiseBuilding(f, 3, true); }
        f.ore = 80; f.sheet.goods = f.sheet.goods || {}; f.sheet.goods.grain = 999;
    }
    let violations = 0, tested = 0;
    for (const f of wc.farmers) {
        f.wantFacility = true; f.wood = 500;
        const plan = wc.facilityPlan(f);
        if (!plan || !plan.rect || plan.trees.length) continue;
        const cost = wc.paddockWoodCost(f.plot, plan.rect);
        f.wood = cost - 1;
        if (wc.buildNextFacility(f) !== false || f.wood !== cost - 1) violations++;   // must refuse, spending nothing
        f.wood = cost;
        if (wc.buildNextFacility(f) !== true || f.wood < 0) violations++;             // must build, never into debt
        tested++;
        if (tested >= 4) break;
    }
    check(tested > 0, 'found farms with a buildable plan', `${tested}`);
    check(violations === 0, 'refuses one short, builds at cost, never goes negative', `${violations} violations`);
    const negative = wc.farmers.filter(f => f.wood < 0).length;
    check(negative === 0, 'no farmer holds negative wood', `${negative}`);
}

console.log(`\n${fail.length ? `FAILED — ${fail.length} check(s): ${fail.join('; ')}` : 'All paddock + pond invariants hold.'}`);
if (fail.length) process.exit(1);
