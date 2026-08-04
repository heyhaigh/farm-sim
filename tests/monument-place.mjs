// #monument-place — frontier placement, migration, and COORDINATE UNIQUENESS (Codex #85 P2: the
// old cap test checked count, not uniqueness — nearestOpenTile is terrain-only, so stones could
// stack on one tile, hiding sprites and hover targets).
// Run: node tests/monument-place.mjs
import { World, CENTER } from '../farm.js';
import { generateCrew, hashString } from '../dna.js';

const DT = 1 / 30;
function boot(seed, culture = 'human') {
    const m = generateCrew(seed);
    const used = new Set();
    const pick = () => { const un = m.filter(x => !used.has(x.id)); let b = un[0], bh = 0xffffffff;
        for (const x of un) { const h = hashString((x.id || x.title || '') + ':pick'); if (h < bh) { bh = h; b = x; } } used.add(b.id); return b; };
    const w = new World(seed, culture);
    for (let i = 0; i < 8; i++) w.addFarmer(pick(), 0);
    w.ensureFounderVariety();
    let g = 40000; while (w.day < 3 && g-- > 0) w.tick(DT);
    return w;
}
const coordsUnique = (w) => {
    const seen = new Set();
    for (const m of w.monuments) { const k = m.i + ',' + m.j; if (seen.has(k)) return false; seen.add(k); }
    return true;
};
let pass = true; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ FAIL ') + m); if (!c) pass = false; };

console.log('A — new raid stones land on the frontier, no two on one tile (past the 40 cap, both cultures)');
for (const [seed, culture] of [[42, 'human'], [7, 'orc']]) {
    const w = boot(seed, culture);
    w.harvestTotal = 5000; w._live = false;
    // churn well past the 40-stone cap so retained stones accumulate across many raids (the Codex
    // #85 repro: 1-2 duplicate coordinates among the retained 40 on every tested seed)
    let k = 1, extra = 0;
    while ((w.monuments.length < 40 || extra < 25) && k <= 200) {
        if (w.monuments.length >= 40) extra++;   // Codex #86: keep churning AFTER the cap — eviction+placement must stay unique
        w.applyInbox([{ id: 'mu-' + seed + '-' + k, kind: 'raided', day: w.day, pairKey: 'mu' + seed + '-' + k, ordinal: 1, commit: 0.5, by: 'the Ashfang clan' }]);
        // stage direction: heal the line between raids — battered defenders fell no raiders, and a
        // felled raider is what raises a stone; the probe needs stones, not attrition realism
        for (const f of w.farmers) { f.downed = false; f.hp = f.maxHp; if (f.state === 'downed') f.state = 'decide'; }
        k++;
    }
    ok(extra >= 25, `seed ${seed}: churned ${extra} raids past the cap (eviction exercised)`)
    ok(w.monuments.length >= 40, `seed ${seed}: at the cap (${w.monuments.length})`);
    ok(coordsUnique(w), `seed ${seed}: every stone on its own tile (live placement)`);
    const raidD = w.monuments.filter(m => m.raid).map(m => Math.hypot(m.i - CENTER, m.j - CENTER));
    ok(raidD.every(d => d >= 14), `seed ${seed}: raid stones on the frontier band (min ${Math.min(...raidD).toFixed(1)})`);
}

console.log('A2 — engineered collision: a pre-occupied destination tile must be refused');
{
    // twin worlds (same seed = same placement stream): learn where world 1 puts a raid stone, then
    // in world 2 pre-plant a monument on that exact tile before the same raid lands. Without the
    // taken-tile spiral the new stone stacks onto it; with it, the stone steps aside.
    const evt = { id: 'col-1', kind: 'raided', day: 3, pairKey: 'col', ordinal: 1, commit: 0.5, by: 'the Ashfang clan' };
    const w1 = boot(42);
    w1.harvestTotal = 500; w1._live = false;
    const before1 = new Set(w1.monuments.map(m => m.i + ',' + m.j));
    w1.applyInbox([structuredClone(evt)]);
    const landed = w1.monuments.filter(m => !before1.has(m.i + ',' + m.j));
    ok(landed.length > 0, `world 1 landed ${landed.length} stone(s) to learn from`);
    const w2 = boot(42);
    w2.harvestTotal = 500; w2._live = false;
    w2.monuments.push({ i: landed[0].i, j: landed[0].j, heroSeed: 9, hero: 'Squatter', foe: 'nobody', day: 1, party: 1, tier: 1 });
    w2.applyInbox([structuredClone(evt)]);
    ok(coordsUnique(w2), 'the incoming stone refused the occupied tile (stepped aside)');
}

console.log('A3 — hemmed collision: destination occupied AND its whole r<=3 neighborhood blocked');
{
    // Codex #86 repro: with every radius-3 candidate taken, the old search exhausted and STACKED the
    // stone onto the occupied tile. Now the ring search widens past the hem (or refuses to insert).
    const evt = { id: 'hem-1', kind: 'raided', day: 3, pairKey: 'hem', ordinal: 1, commit: 0.5, by: 'the Ashfang clan' };
    const w1 = boot(7, 'orc');
    w1.harvestTotal = 500; w1._live = false;
    const before1 = new Set(w1.monuments.map(m => m.i + ',' + m.j));
    w1.applyInbox([structuredClone(evt)]);
    const landed = w1.monuments.filter(m => !before1.has(m.i + ',' + m.j));
    ok(landed.length > 0, `world 1 landed ${landed.length} stone(s) to learn from`);
    const w2 = boot(7, 'orc');
    w2.harvestTotal = 500; w2._live = false;
    for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++)
        w2.monuments.push({ i: landed[0].i + di, j: landed[0].j + dj, heroSeed: 9, hero: 'Hem', foe: 'nobody', day: 1, party: 1, tier: 1 });
    w2.applyInbox([structuredClone(evt)]);
    ok(coordsUnique(w2), 'no stone stacked inside the hem (widened past it or refused)');
}

console.log('B — migration: 40 legacy old-ring stones escape, stay unique, and never walk');
{
    const w = boot(7, 'orc');
    for (let k = 0; k < 40; k++) {
        const a = k * 0.157, d = 7 + (k % 4);
        w.monuments.push({ i: Math.round(CENTER + Math.cos(a) * d), j: Math.round(CENTER + Math.sin(a) * d),
            heroSeed: 1, hero: 'Hero' + k, foe: 'Foe' + k, day: 2, party: 1, raid: true, tier: 1 + (k % 5) });
    }
    const s1 = structuredClone(w.serialize());
    const w2 = World.fromSave(structuredClone(s1));
    const d2 = w2.monuments.filter(x => x.raid).map(x => Math.hypot(x.i - CENTER, x.j - CENTER));
    ok(d2.length === 40, `all 40 stones survive the load (${d2.length})`);
    ok(d2.every(x => x > 14), `all escaped the ring (min ${Math.min(...d2).toFixed(1)})`);
    ok(coordsUnique(w2), 'every migrated stone on its own tile');
    const s2 = structuredClone(w2.serialize());
    const w3 = World.fromSave(structuredClone(s2));
    ok(JSON.stringify(s2.monuments) === JSON.stringify(structuredClone(w3.serialize()).monuments), 'second load is a byte-stable no-op (no walk)');
    const w2b = World.fromSave(structuredClone(s1));
    ok(JSON.stringify(w2.serialize().monuments) === JSON.stringify(w2b.serialize().monuments), 'migration deterministic (same save twice)');
}

console.log('C — foe-stand stones (no raid flag) are never migrated');
{
    const w = boot(3);
    w.monuments.push({ i: CENTER + 3, j: CENTER - 2, heroSeed: 1, hero: 'Stand', foe: 'a wolf', day: 2, party: 1, tier: 2 });
    const w2 = World.fromSave(structuredClone(w.serialize()));
    const s = w2.monuments.find(m => m.hero === 'Stand');
    ok(s && s.i === CENTER + 3 && s.j === CENTER - 2, 'fight-spot stone stands where the fight was');
}

console.log(pass ? '\nmonument-place: PASS' : '\nmonument-place: FAIL');
process.exit(pass ? 0 : 1);
