// #raid-allhands — every line-holder fights. Owner report: "about half the town actually attacked the
// orcs; the other half just stood there the entire time." Root cause: duels are RAIDER-driven (each
// raider claims one defender), so any line-holder beyond the raider count had no duel, no pursuit, and
// no support role — a statue for the whole battle. The fix gives every unclaimed line-holder SUPPORT
// behavior once the clash is joined (re.phase 'march'): movement to a seeded flank slot + a D&D-style
// action per turn cadence (strike / grapple / ready / evade), all pure-hash, resolver untouched.
//
// This probe stages a live telegraphed raid, lets the town muster through the real lead window, then
// measures every non-dueling, non-pursuing line-holder through the march: each must MOVE (> 0.4 tiles
// peak displacement) or ACT (a support entry in the battle record naming them). Non-vacuous: the seed
// must actually produce supporters (more line-holders than raiders) and a march phase.
// Run: node tests/raid-allhands.mjs
import { World } from '../farm.js';
import { generateCrew, hashString } from '../dna.js';

const DT = 1 / 30;
function boot(seed, culture) {
    const m = generateCrew(seed);
    const used = new Set();
    const pick = () => { const un = m.filter(x => !used.has(x.id)); let b = un[0], bh = 0xffffffff;
        for (const x of un) { const h = hashString((x.id || x.title || '') + ':pick'); if (h < bh) { bh = h; b = x; } } used.add(b.id); return b; };
    const w = new World(seed, culture);
    for (let i = 0; i < 8; i++) w.addFarmer(pick(), 0);
    w.ensureFounderVariety();
    return w;
}
const holdsLine = f => !f.downed && f.health !== 'sick' && (f.state === 'muster' || (f.state === 'walk' && f.path && f.path.then === 'muster'));
let pass = true; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ FAIL ') + m); if (!c) pass = false; };

for (const [seed, culture] of [[42, 'human'], [7, 'orc']]) {
    console.log(`raid-allhands — seed ${seed} (${culture})`);
    const w = boot(seed, culture);
    // a MATURE town (the owner's report was day 2+): plots sited, the whole town musters on the alarm —
    // a 10s-old town only fields ~3 line-holders and every raider finds a duel (vacuously green).
    let age = 40000;
    while (w.day < 3 && age-- > 0) w.tick(DT);
    for (let i = 0; i < 600; i++) w.tick(DT);   // settle into the morning
    w.harvestTotal = 100; w._live = true;
    w.applyInbox([{ id: 'ah-' + seed, kind: 'raided', day: w.day, pairKey: 'ah-' + seed, ordinal: 1, commit: 0.3, by: 'the Ashfang clan' }]);
    ok(w.pendingRaid != null, 'raid telegraphed');
    // live the REAL lead window so the town actually musters (no clock jump — walkers count)
    let guard = 30000;
    while (w.pendingRaid && guard-- > 0) w.tick(DT);
    while (w.raidEvent && w.raidEvent.phase !== 'march' && guard-- > 0) w.tick(DT);
    const re = w.raidEvent;
    ok(!!re && re.phase === 'march', `clash joined (march phase reached, guard ${guard})`);
    if (!re || re.phase !== 'march') continue;
    // Codex #82 P1 — the approach→march flip tick runs the clash pass BEFORE duel init: support must
    // hold (no _supMove, no fx access) until duelsAssigned, or `re.fx.push` throws on undefined.
    ok(re.duelsAssigned || w.farmers.every(f => !f._supMove), 'flip-edge: no support step before duels assigned');
    while (!re.duelsAssigned && w.raidEvent === re && guard-- > 0) w.tick(DT);
    ok(re.duelsAssigned === true, 'duels assigned');

    // the measured population: line-holders with NO duel and NO pursuit at assignment time
    const dueling = new Set(re.raiders.filter(r => r.duel).map(r => r.duel.opp));
    const supporters = w.farmers.filter(f => holdsLine(f) && !dueling.has(f));
    ok(supporters.length > 0, `non-vacuous: ${supporters.length} unclaimed line-holder(s) vs ${re.raiders.length} raider(s)`);

    const start = new Map(supporters.map(f => [f, { i: f.pos.i, j: f.pos.j, disp: 0, pi: f.pos.i, pj: f.pos.j }]));
    const recBase = re.record ? re.record.length : 0;
    // Codex #82 P2 / #83 — the probe keys on MOVEMENT, not _supMove (the #83 gap: an EVADE burst moved
    // a supporter who took no flank step, so _supMove was false, the test self-excluded the tick, and
    // the square-up spun the burst backwards). Every non-swing supporter tick that actually moved must
    // (a) hold run ownership (_supMove) and (b) face the step taken.
    let runTicks = 0, backRun = 0, unowned = 0;
    while (w.raidEvent === re && re.phase === 'march' && guard-- > 0) {
        w.tick(DT);
        for (const f of supporters) {
            const s = start.get(f);
            s.disp = Math.max(s.disp, Math.hypot(f.pos.i - s.i, f.pos.j - s.j));
            const di = f.pos.i - s.pi, dj = f.pos.j - s.pj, ddx = di - dj;
            const swinging = f._swingAt && w.time - f._swingAt < 0.42;
            if (!swinging && Math.hypot(di, dj) > 1e-4) {
                if (!f._supMove) unowned++;
                if (Math.abs(ddx) > 1e-4) {
                    runTicks++;
                    if ((ddx >= 0 ? 1 : -1) !== f.facing) backRun++;
                }
            }
            s.pi = f.pos.i; s.pj = f.pos.j;
        }
    }
    ok(guard > 0, 'march completed within the guard');
    ok(runTicks > 0 && backRun === 0, `facing follows movement on every moved support tick (${runTicks} moved ticks, ${backRun} backwards)`);
    ok(unowned === 0, `every moved support tick holds run ownership (_supMove) (${unowned} unowned)`);
    const rec = (re.record || []).slice(recBase);
    const SUPPORT_TEXT = new Set(['GRAPPLE!', 'READIES!', 'EVADES!', 'HIT!', 'PARRY!']);
    let idle = 0;
    for (const f of supporters) {
        const first = f.sheet.name.split(' ')[0];
        const moved = start.get(f).disp > 0.4;
        const acted = rec.some(e => SUPPORT_TEXT.has(e.text) && e.who && e.who.startsWith(first));
        if (!moved && !acted) { idle++; console.log(`    idle: ${f.sheet.name} (disp ${start.get(f).disp.toFixed(2)}, no recorded action)`); }
    }
    ok(idle === 0, `every unclaimed line-holder moved or acted (${supporters.length - idle}/${supporters.length})`);
    const supActs = rec.filter(e => e.who && (e.text === 'GRAPPLE!' || e.text === 'READIES!' || e.text === 'EVADES!' || /flanks|grapples|readies|slips/.test(e.who))).length;
    ok(supActs > 0, `support actions landed in the battle record (${supActs})`);
}

console.log(pass ? '\nraid-allhands: PASS' : '\nraid-allhands: FAIL');
process.exit(pass ? 0 : 1);
