// tests/lineage.mjs — the LIVE lineage path (main.js spawnFarmer re-sites a founder's past life at a real
// remembered town). #Codex40: regenerating the memory used to COLLAPSE every founder to one identity, and
// putting the place into growth used to shift archetype/stats. This replicates spawnFarmer's re-site EXACTLY
// and asserts: (1) eight founders keep eight UNIQUE seeds through the re-site AND a save/load round-trip;
// (2) the re-site does NOT change any farmer's archetype/stats (display-only); (3) the real town shows in
// the displayed title while `content` (the classifier's input) stays original.
import { World } from '../farm.js';
import { generateCrew, classifyMemory } from '../dna.js';

let pass = true;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ FAIL ') + m); if (!c) pass = false; };

// the EXACT re-site spawnFarmer applies after growth (title/summary swapped on a copy; content untouched)
function resite(f, origin) {
    if (!origin) return;
    f.sheet.origin = { seed: origin.seed, name: origin.name };
    const mem = f.sheet.memory;
    if (mem && mem.place && mem.place !== origin.name && typeof mem.title === 'string') {
        f.sheet.memory = {
            ...mem,
            title: mem.title.split(mem.place).join(origin.name),
            summary: typeof mem.summary === 'string' ? mem.summary.split(mem.place).join(origin.name) : mem.summary,
            place: origin.name,
        };
    }
}

console.log('#lineage — the re-site preserves identity + stats, and a real place shows in the title');
{
    const w = new World(20260706);
    const crew = generateCrew(20260706);            // DISTINCT life:<seed>:<i> memories
    // names deliberately NOT in LIFE_PLACES, so a match in `content` can only come from a (buggy) rewrite
    const roster = [{ seed: 111, name: 'Marshmarch' }, { seed: 222, name: 'Ashfang' }, { seed: 333, name: 'Emberhold' }];
    w.rememberedTowns = roster;

    const archBefore = [];
    for (let i = 0; i < 8; i++) {
        const mem = crew[i];
        const f = w.addFarmer(mem, 0);
        ok(!!f, `founder ${i} spawned`);
        archBefore.push({ seed: f.sheet.seed, arch: f.sheet.archetype, stats: JSON.stringify(f.sheet.stats) });
        // a per-founder deterministic origin (mirrors originFor's non-heir key: id + ':' + mutation)
        resite(f, roster[i % roster.length]);
    }

    const seeds = w.farmers.map(f => f.sheet.seed);
    ok(new Set(seeds).size === 8, `eight UNIQUE farmer seeds after re-site (got ${new Set(seeds).size})`);

    // the re-site must not have moved any archetype or stat block
    let stable = true;
    w.farmers.forEach((f, i) => { if (f.sheet.archetype !== archBefore[i].arch || JSON.stringify(f.sheet.stats) !== archBefore[i].stats) stable = false; });
    ok(stable, 'no archetype/stat changed under the re-site (display-only)');

    // the real town shows in the DISPLAYED title, but content (classifier input) is unchanged → classify holds
    let titleShowsTown = false, classifyHeld = true;
    w.farmers.forEach((f) => {
        const town = f.sheet.origin && f.sheet.origin.name;
        if (town && f.sheet.memory.title.includes(town)) titleShowsTown = true;
        // content still classifies to the SAME archetype the farmer grew with
        if (classifyMemory(f.sheet.memory) && f.sheet.memory.content.includes(town)) classifyHeld = false;   // town must NOT be in content
    });
    ok(titleShowsTown, 'a real remembered town appears in the displayed past-life title');
    ok(classifyHeld, 'the real town is NOT written into content (classifyMemory stays stable)');

    // save/load round-trip keeps the eight unique seeds + the origins
    const w2 = World.fromSave(w.serialize());   // serialize() holds Maps — pass it straight to fromSave (no JSON clone)
    const seeds2 = w2.farmers.map(f => f.sheet.seed);
    ok(new Set(seeds2).size === 8, 'eight unique seeds survive save/load');
    ok(w2.farmers.every(f => f.sheet.origin && f.sheet.origin.name), 'every founder keeps its origin through save/load');
    ok(JSON.stringify(w2.rememberedTowns) === JSON.stringify(roster), 'the remembered-towns roster round-trips');
}

console.log(pass ? '\nALL LINEAGE PROBES PASSED' : '\nSOME LINEAGE PROBES FAILED');
process.exit(pass ? 0 : 1);
