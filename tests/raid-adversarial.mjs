// Adversarial repro of Codex #23 raid P0s (findings 1-3). Run: node raid-adversarial.mjs
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
const raidEvt = (w, k = 1, commit = 0.3) => ({ id: 'radv-' + k, kind: 'raided', day: w.day, pairKey: 'radv-' + k, ordinal: k, commit, by: 'the Ashfang clan' });
const monCount = w => (w.monuments || []).filter(m => m.raid).length;
const woundCount = w => w.farmers.filter(f => f._wasHurt || (f.hp != null && f.maxHp != null && f.hp < f.maxHp)).length;
let pass = true; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ FAIL ') + m); if (!c) pass = false; };

// ---------- P0 #1: save mid-raid must NOT lose the outcome ----------
console.log('P0#1 — save mid-raid → reload keeps the authoritative outcome');
{
    const w = boot(20260706);
    for (let i = 0; i < 300; i++) w.tick(DT);
    w.harvestTotal = 100;                        // ensure there are stores to carry off
    w._live = true;                              // watched town — stages the cinematic
    w.applyInbox([raidEvt(w)]);
    const harvestAfter = w.harvestTotal, monAfter = monCount(w), woundAfter = woundCount(w);
    for (let i = 0; i < 90; i++) w.tick(DT);      // ~3s into the march, THEN save
    const snap = structuredClone(w.serialize());  // mimic the IndexedDB structured-clone round-trip
    const w2 = World.fromSave(structuredClone(snap));
    ok(w2.harvestTotal === harvestAfter && harvestAfter < 100, `harvest docked + survived reload (${harvestAfter})`);
    ok(monCount(w2) === monAfter, `raid monuments survived reload (${monCount(w2)})`);
    ok(woundCount(w2) >= woundAfter && woundAfter > 0, `wounds applied + survived reload (${woundCount(w2)})`);
    ok(!snap.raidEvent, 'raidEvent (display cinematic) is NOT serialized');
    const applied = (snap.inboxApplied || []).length;
    ok(applied === 1, `event marked applied exactly once (applied=${applied})`);
}

// ---------- P0 #2: back-to-back raids in one batch both resolve ----------
console.log('P0#2 — two raids in one inbox batch both apply, no orphaned encounters');
{
    const w = boot(42);
    for (let i = 0; i < 300; i++) w.tick(DT);
    w.harvestTotal = 100; w._live = true;
    const h0 = w.harvestTotal, enc0 = w.encounters.length;
    w.applyInbox([raidEvt(w, 1, 0.3), raidEvt(w, 2, 0.3)]);
    const h1 = w.harvestTotal;
    ok(h1 < h0, `both raids docked harvest (100 → ${h1})`);
    // two dock passes: 0.3 then 0.3 of the remainder → strictly less than a single dock (70)
    ok(h1 < 70, `second raid's dock was NOT lost (${h1} < 70)`);
    for (let i = 0; i < 400; i++) w.tick(DT);      // let both cinematics fully play out
    ok(w.encounters.length === enc0, `no orphaned raider encounters (${w.encounters.length} == ${enc0})`);
    ok(w.raidEvent === null, 'cinematic cleaned up (raidEvent null)');
}

// ---------- P0 #3: watching a raid must NOT change authoritative state/rng ----------
console.log('P0#3 — watched town == dormant town, byte-identically');
{
    const mk = live => { const w = boot(7); for (let i = 0; i < 300; i++) w.tick(DT); w.harvestTotal = 100; w._live = live; w.applyInbox([raidEvt(w)]); for (let i = 0; i < 400; i++) w.tick(DT); return w; };
    const watched = mk(true), dormant = mk(false);
    // canonical stringify that CAPTURES fog chunks (Map<key,Uint8Array>) + typed arrays — the exact fog-reveal
    // divergence Codex flagged. raidEvent/_rev/_live are display/persistence-meta, excluded.
    const canon = s => { const o = structuredClone(s); delete o.raidEvent; delete o._rev; delete o._live;
        return JSON.stringify(o, (k, v) => v instanceof Map ? { __map: [...v.entries()].sort((a, b) => String(a[0]) < String(b[0]) ? -1 : 1) }
            : ArrayBuffer.isView(v) ? { __ta: Array.from(v) } : v); };
    const scrub = canon;
    const sameState = scrub(watched.serialize()) === scrub(dormant.serialize());
    ok(sameState, 'serialized state identical (harvest/monuments/wounds/positions/rng)');
    ok(watched.harvestTotal === dormant.harvestTotal, `same harvest (${watched.harvestTotal} == ${dormant.harvestTotal})`);
    ok(monCount(watched) === monCount(dormant), `same monuments (${monCount(watched)} == ${monCount(dormant)})`);
    if (!sameState) {
        const a = JSON.parse(scrub(watched.serialize())), b = JSON.parse(scrub(dormant.serialize()));
        for (const k of Object.keys(a)) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) console.log('     DIFF at key:', k);
    }
}

// ---------- P1: monument cap holds across many raids ----------
console.log('P1 — raid monuments respect the 40-cap over many raids');
{
    const w = boot(3);
    for (let i = 0; i < 200; i++) w.tick(DT);
    w._live = false;
    for (let k = 0; k < 120; k++) { w.harvestTotal = 100; w.applyInbox([raidEvt(w, 1000 + k, 0.5)]); }
    ok(w.monuments.length <= 40, `monuments capped (${w.monuments.length} <= 40)`);
}

console.log(pass ? '\nALL ADVERSARIAL PROBES PASSED' : '\nSOME PROBES FAILED');
process.exit(pass ? 0 : 1);
