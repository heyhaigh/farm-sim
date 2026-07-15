// Adversarial repro of the raid P0s. Run: node raid-adversarial.mjs
//
// Updated for #131 THE TELEGRAPH (+ #Codex29 P1): a raid arriving during LIVE play no longer lands instantly —
// it stages a `pendingRaid` and resolves RAID_LEAD later (the sentry's lead time). A raid CONSUMED WHILE DORMANT
// (on load, world._live false) still lands SYNCHRONOUSLY — a "came while you were away" recap. These probes
// verify: (1) a telegraph SURVIVES a mid-flight save/reload and lands EXACTLY once; (2) back-to-back raids both
// dock, none dropped; (3) the AUTHORITATIVE OUTCOME (stores lost, monuments, wounds) is the same whether the
// raid was telegraphed-while-watched or landed-instantly-while-dormant — the timing/positions legitimately differ
// now (the watched town musters + lands later), so full byte-identity is NOT asserted; (4) the monument cap holds.
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
// land a telegraphed raid WITHOUT 45s of intervening farming (so the harvest-at-landing is stable): jump the
// monotonic clock to the deadline and tick once, exactly as the RYFARMS.raidLand() debug hook does.
const landPending = w => { if (w.pendingRaid) { w.time = w.pendingRaid.landsAt; w.tick(DT); } };
let pass = true; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ FAIL ') + m); if (!c) pass = false; };

// ---------- P0 #1: a telegraph must SURVIVE a mid-flight save/reload and land exactly once ----------
console.log('P0#1 — save mid-telegraph → reload lands the raid exactly once, no double-dock');
{
    const w = boot(20260706);
    for (let i = 0; i < 300; i++) w.tick(DT);
    w.harvestTotal = 100;                        // ensure there are stores to carry off
    w._live = true;                              // watched town — telegraphs (stages pendingRaid), does NOT land yet
    w.applyInbox([raidEvt(w)]);
    ok(w.pendingRaid != null, 'live raid telegraphs (pendingRaid staged)');
    ok(w.harvestTotal === 100, 'stores NOT yet docked mid-telegraph (100)');
    for (let i = 0; i < 90; i++) w.tick(DT);      // ~3s into the lead window (well before landsAt), THEN save
    const snap = structuredClone(w.serialize());  // mimic the IndexedDB structured-clone round-trip
    ok(snap.pendingRaid != null, 'pendingRaid IS serialized (survives reload)');
    ok(!snap.raidEvent, 'raidEvent (display cinematic) is NOT serialized');
    const w2 = World.fromSave(structuredClone(snap));
    landPending(w2);                              // resume: reach the deadline, land it
    ok(w2.pendingRaid == null, 'pendingRaid resolved after landing');
    ok(w2.harvestTotal < 100, `harvest docked after reload+land (${w2.harvestTotal})`);
    ok(monCount(w2) >= 0 && woundCount(w2) > 0, `outcome applied (monuments ${monCount(w2)}, wounds ${woundCount(w2)})`);
    const applied = (snap.inboxApplied || []).length;
    ok(applied === 1, `event marked applied exactly once — no re-land on replay (applied=${applied})`);
}

// ---------- P0 #2: back-to-back raids in one batch both resolve, none dropped ----------
console.log('P0#2 — two raids in one inbox batch both apply, no orphaned encounters');
{
    const w = boot(42);
    for (let i = 0; i < 300; i++) w.tick(DT);
    w.harvestTotal = 100; w._live = true;
    const h0 = w.harvestTotal, enc0 = w.encounters.length;
    // batch of two: the second's arrival lands the first in-flight telegraph immediately, then telegraphs itself
    w.applyInbox([raidEvt(w, 1, 0.3), raidEvt(w, 2, 0.3)]);
    const h1 = w.harvestTotal;
    ok(h1 < h0, `first raid docked on the second's arrival (100 → ${h1})`);
    ok(w.pendingRaid != null, 'second raid is telegraphing');
    landPending(w);                                // land the second
    const h2 = w.harvestTotal;
    ok(h2 < h1, `second raid also docked, none dropped (${h1} → ${h2})`);
    for (let i = 0; i < 800; i++) w.tick(DT);      // let the cinematic fully play out (approach + march + flee, ~16s)
    ok(w.encounters.length === enc0, `no orphaned raider encounters (${w.encounters.length} == ${enc0})`);
    ok(w.raidEvent === null, 'cinematic cleaned up (raidEvent null)');
}

// ---------- P0 #3: same AUTHORITATIVE outcome whether telegraphed-watched or landed-instantly-dormant ----------
console.log('P0#3 — telegraphed(watched) and instant(dormant) raids resolve the SAME authoritative outcome');
{
    // dormant: consumed while !_live -> lands SYNCHRONOUSLY at consume (the on-load recap path)
    const dormant = boot(7); for (let i = 0; i < 300; i++) dormant.tick(DT); dormant.harvestTotal = 100; dormant._live = false;
    dormant.applyInbox([raidEvt(dormant)]);
    ok(dormant.pendingRaid == null, 'dormant raid landed synchronously (no telegraph)');
    // watched: consumed while _live -> telegraphs, then lands at the deadline (harvest held stable via landPending)
    const watched = boot(7); for (let i = 0; i < 300; i++) watched.tick(DT); watched.harvestTotal = 100; watched._live = true;
    watched.applyInbox([raidEvt(watched)]);
    ok(watched.pendingRaid != null, 'watched raid telegraphed');
    landPending(watched);
    // the AUTHORITATIVE outcome is seeded on the raid id + harvest-at-landing (NOT time), so it must match; the
    // full serialized state (positions/chronicle/timing) legitimately differs (the watched town mustered + landed later).
    ok(watched.harvestTotal === dormant.harvestTotal, `same stores lost (${watched.harvestTotal} == ${dormant.harvestTotal})`);
    ok(monCount(watched) === monCount(dormant), `same monuments (${monCount(watched)} == ${monCount(dormant)})`);
    ok(woundCount(watched) === woundCount(dormant), `same wounds (${woundCount(watched)} == ${woundCount(dormant)})`);
}

// ---------- P0 #4: a dormant raid must NOT be silently lost (docks stores without a live tick) ----------
console.log('P0#4 — a raid consumed while dormant docks stores immediately (never left un-resolved)');
{
    const w = boot(3); for (let i = 0; i < 200; i++) w.tick(DT); w.harvestTotal = 100; w._live = false;
    w.applyInbox([raidEvt(w, 77, 0.3)]);           // NO ticks after consume — a synced-but-never-reopened town
    ok(w.harvestTotal < 100 && w.pendingRaid == null, `dormant consume docked stores with zero live ticks (${w.harvestTotal})`);
}

// ---------- #133: the guard's real wound + a frozen-roll counterfactual, WITHOUT perturbing the outcome ----------
console.log('#133 — the guard takes the real wound + an honest frozen-roll counterfactual');
{
    // a guard present must NOT change determinism of the authoritative roll (the counterfactual is a fork): the
    // same raid on the same town resolves byte-identically twice.
    const mk = () => { const w = boot(20260706); for (let i = 0; i < 13000; i++) w.tick(DT); w.harvestTotal = 100; w._live = false; w.applyInbox([raidEvt(w, 501, 0.5)]); return w; };   // past day 1 -> the founders' watch rotation is seeded, so a guard stands
    const a = mk(), b = mk();
    ok(a.harvestTotal === b.harvestTotal, `authoritative outcome reproducible with the counterfactual fork (${a.harvestTotal} == ${b.harvestTotal})`);
    // a counterfactual line is chronicled (either "turned the raid" or the zero-delta "met the same either way")
    const cf = a.chronicle.slice(-8).map(c => c.text).some(t => /kept the watch|not kept the watch|met the same either way|turned the raid/i.test(t));
    ok(cf, 'a frozen-roll counterfactual is reported (marginal effect, zero-delta kept)');
    // a housed/rostered guard exists as currentSentry by now, so the marginal path ran
    ok(a.currentSentry() != null, `a guard stood the line (currentSentry = ${a.currentSentry() ? a.currentSentry().sheet.name.split(' ')[0] : 'none'})`);
}

// ---------- #134: the learning arc — a battered town learns a character-gated response ----------
console.log('#134 — repeated raids teach the town a response (defense hardens the wall, truce sues for peace)');
{
    const mk = () => { const w = boot(20260706); for (let i = 0; i < 13000; i++) w.tick(DT); return w; };
    const raid = (w, k) => { w.harvestTotal = 100; w._live = false; w.applyInbox([raidEvt(w, 800 + k, 0.4)]); };
    // DEFENSE: a grim, low-trust town holds the wall (doctrine -> palisade, which the world layer's biteReduce halves)
    const d = mk(); d.townCollab = 0.3;
    raid(d, 1); ok(d.learned == null && d.raidsSuffered === 1, `one raid is bad luck, not yet a lesson (raidsSuffered=${d.raidsSuffered})`);
    raid(d, 2); ok(d.learned === 'defense' && d.doctrine() === 'palisade', `a grim town LEARNED defence -> palisade (${d.learned}/${d.doctrine()})`);
    raid(d, 3); ok(d.learned === 'defense', 'the learned response is STICKY across further raids');
    // TRUCE: a warm, collaborative town sues for peace (envoy comes to the table willing)
    const t = mk(); t.townCollab = 0.7;
    raid(t, 1); raid(t, 2);
    ok(t.learned === 'truce', `a warm town LEARNED to sue for peace (${t.learned})`);
    const learnBeat = [...d.chronicle, ...t.chronicle].some(c => /THE TOWN LEARNED/.test(c.label || ''));
    ok(learnBeat, 'a grand "THE TOWN LEARNED" beat is chronicled');
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
