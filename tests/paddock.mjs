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
    check(facs.length > 0, 'the town actually built facilities', `${facs.length} across ${w.farmers.length} farms`);
    // every building centred on its own footprint, and that footprint solid
    let offCentre = 0, notSolid = 0;
    for (const f of facs) {
        const s = f.struct; if (!s) continue;
        if (Math.abs(s.cx - (s.i + s.w / 2)) > 1e-9 || Math.abs(s.cy - (s.j + s.h / 2)) > 1e-9) offCentre++;
        for (let j = s.j; j < s.j + s.h; j++) for (let i = s.i; i < s.i + s.w; i++) if (!w.pathBlocked(i, j)) notSolid++;
    }
    check(offCentre === 0, 'draw anchor sits on the footprint centre', `${offCentre} off`);
    check(notSolid === 0, 'every footprint tile is solid', `${notSolid} walkable`);
    // Every paddock's fence must LINK onto ground the farm already holds — the yard for a lane-0 paddock,
    // the paddock in front of it for one further out. What must never happen is a paddock touching neither,
    // marooned out on its own. (An earlier version of this check demanded contact with the YARD specifically
    // and flagged every lane-1 paddock, which is the lattice working as designed.)
    let orphaned = 0, onYard = 0;
    for (const f of w.farmers) for (const fac of f.plot.facilities) {
        let yard = 0, pad = 0;
        for (let j = fac.y - 1; j <= fac.y + fac.h; j++) for (let i = fac.x - 1; i <= fac.x + fac.w; i++) {
            if (i >= fac.x && i < fac.x + fac.w && j >= fac.y && j < fac.y + fac.h) continue;
            const k = i + ',' + j;
            if (!f.plot.cells.has(k)) continue;
            if (f.plot.padCells.has(k)) pad++; else yard++;
        }
        if (yard === 0 && pad === 0) orphaned++;
        if (yard > 0) onYard++;
    }
    check(orphaned === 0, 'no paddock marooned away from the farm', `${orphaned} orphaned`);
    check(onYard > 0, 'the district is anchored on the yard', `${onYard} paddocks flush with it`);
}

console.log('\nLivestock containment');
{
    let behindBarn = 0, onTrough = 0, outsidePen = 0, total = 0;
    for (const fac of facilities(w)) {
        const s = fac.struct;
        for (const p of fac.producers) {
            if (p.kind === 'fish' || p.kind === 'pad') continue;
            total++;
            if (p.fx < fac.x || p.fx > fac.x + fac.w || p.fy < fac.y || p.fy > fac.y + fac.h) outsidePen++;
            if (s && p.fx < s.i && p.fy < s.j) behindBarn++;
            if (fac.trough && Math.abs(p.fx - (fac.trough.i + 0.5)) < 0.9 && Math.abs(p.fy - (fac.trough.j + 0.5)) < 0.9) onTrough++;
        }
    }
    check(total > 0, 'the town has livestock to check', `${total} head`);
    check(outsidePen === 0, 'no animal outside its own paddock', `${outsidePen} loose`);
    check(behindBarn === 0, 'no herd stranded behind its barn', `${behindBarn} behind`);
    check(onTrough === 0, 'no animal turned out standing in the trough', `${onTrough} on it`);
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
    const wading = w.farmers.filter(f => f.pos && w.get(Math.floor(f.pos.i), Math.floor(f.pos.j)) === T_WATER);
    check(wading.length === 0, 'no farmer standing on water', `${wading.length} wading`);
}

console.log('\nPonds: a pre-bank save keeps the shape it was built with');
{
    // A pond built before banks existed has water edge to edge and no `water` on the record. Deriving an
    // inset for it would confine the fish to an inner square while the outer ring stayed water on the map.
    const wl = matureTown(424242);
    for (const fac of facilities(wl, 'pond')) {
        for (let j = fac.y; j < fac.y + fac.h; j++) for (let i = fac.x; i < fac.x + fac.w; i++) wl.set(i, j, T_WATER);
        delete fac.water;
        const reg = { x: fac.x, y: fac.y, w: fac.w, h: fac.h };   // as fromSave derives it
        for (const p of fac.producers) p.region = reg;
    }
    run(wl, 4);
    let ashore = 0, n = 0;
    for (const fac of facilities(wl, 'pond')) for (const p of fac.producers) { n++; if (wl.get(Math.floor(p.fx), Math.floor(p.fy)) !== T_WATER) ashore++; }
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
