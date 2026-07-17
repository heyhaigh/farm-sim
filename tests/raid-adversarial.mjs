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

// ---------- #nemesis (council Phase 1): one named arc per faction pair, deterministic, honestly ended ----------
console.log('#nemesis — the named war: stable name, counted returns, sworn grudge, honest endings');
{
    const evt = (w, ord, pk = 'nem-pair') => ({ id: `nem-${pk}-${ord}`, kind: 'raided', day: w.day, pairKey: pk, ordinal: ord, commit: 0.5, by: 'the Ashfang clan' });
    const w = boot(20260706);
    for (let i = 0; i < 13000; i++) w.tick(DT);   // past day 1 so a guard stands
    w._live = false;
    w.harvestTotal = 100; w.applyInbox([evt(w, 0)]);
    ok(w.nemesis != null && w.nemesis.raidCount === 1, `first raid founds the arc silently (count ${w.nemesis && w.nemesis.raidCount})`);
    const name1 = w.nemesis.name;
    ok(typeof name1 === 'string' && name1.length > 3, `the foe has a seeded name (${name1})`);
    const swore = w.nemesis.sworeAgainst;
    w.harvestTotal = 100; w.applyInbox([evt(w, 1)]);
    ok(w.nemesis.raidCount === 2 && w.nemesis.name === name1, 'the second raid increments the SAME arc, name stable');
    // dormant raids have no telegraph — the NAME must still reach the record via the landing/recap line
    ok(w.chronicle.some(c => (c.text || '').includes(name1)), 'the return is chronicled by name (dormant recap included)');
    if (swore != null) ok(w.nemesis.sworeAgainst != null, 'the grudge target persists/updates');
    // determinism of the arc: a parallel world consuming the same events grows the SAME nemesis
    const w2 = boot(20260706);
    for (let i = 0; i < 13000; i++) w2.tick(DT);
    w2._live = false;
    w2.harvestTotal = 100; w2.applyInbox([evt(w2, 0)]);
    w2.harvestTotal = 100; w2.applyInbox([evt(w2, 1)]);
    ok(w2.nemesis.name === w.nemesis.name && w2.nemesis.raidCount === w.nemesis.raidCount &&
       w2.nemesis.sworeAgainst === w.nemesis.sworeAgainst, 'the arc is deterministic across parallel worlds');
    // peace ends the named war
    w.applyInbox([{ id: 'nem-peace', kind: 'reconciled', day: w.day, pairKey: 'nem-pair', ordinal: 2, withName: 'the Ashfang clan' }]);
    ok(w.nemesis.ended === true && w.nemesis.lastOutcome === 'peace', 'reconciliation ends the arc (peace)');
    // a NEW pair founds a NEW arc (one at a time — the old one is over)
    w.harvestTotal = 100; w.applyInbox([evt(w, 0, 'other-pair')]);
    ok(w.nemesis.pairKey === 'other-pair' && w.nemesis.raidCount === 1, 'a new pair founds a fresh arc after the old war ends');
    // save round-trip carries the arc
    const w3 = World.fromSave(structuredClone(w.serialize()));
    ok(w3.nemesis && w3.nemesis.pairKey === w.nemesis.pairKey && w3.nemesis.name === w.nemesis.name, 'the arc rides the save');
    // ADMIN BOOTH rehearsals are GHOSTS (user check): staging + landing + playing out a rehearsal raid must
    // not advance the arc by a single count — it reads the nemesis for the show and writes NOTHING back.
    const arcBefore = JSON.stringify(w.nemesis);
    w._live = true;
    w.startRaidRehearsal(7);
    ok(w.pendingRaid != null && w.pendingRaid.rehearsal === true, 'booth stages a rehearsal telegraph');
    w.time = w.pendingRaid.landsAt; w.tick(DT);      // land the ghost
    for (let i = 0; i < 1600; i++) w.tick(DT);       // play the whole show out (approach, duels, flee)
    ok(JSON.stringify(w.nemesis) === arcBefore, 'a rehearsal raid does NOT advance the nemesis arc');
    ok(!w.pendingRaid && !w.raidEvent && !w.rehearsal, 'the ghost cleaned up after itself');
    const s4 = w.serialize();
    ok(s4.nemesis && JSON.stringify(s4.nemesis) === arcBefore, 'the serialized arc is untouched by the rehearsal');
}

// #Codex39 P1 — the DUEL BEAT lifecycle: a beat requested during the telegraph and stamped for THIS raid
// must SURVIVE the landing (the over-eager clear used to discard the very beat it meant to keep); a beat
// stamped for a DIFFERENT raid is dropped when a new raid stages.
console.log('#duel-beat — a beat for THIS raid survives landing; a stale beat is dropped');
{
    const w = boot(20260706);
    for (let i = 0; i < 400; i++) w.tick(DT);
    w._live = true; w.harvestTotal = 100;
    w.applyInbox([raidEvt(w, 4242, 0.5)]);
    ok(w.pendingRaid != null, 'raid telegraphed for the beat probe');
    const e = w.pendingRaid.e, rid = e.id || `${e.pairKey}:${e.ordinal}`;
    w._duelBeat = { stunt: 'shove', by: 'foe', bark: 'YOU AGAIN', rid };   // a timely beat, stamped for this raid
    landPending(w);
    ok(w.raidEvent != null, 'raid landed (cinematic staged)');
    ok(w._duelBeat && w._duelBeat.rid === rid, 'a beat stamped for THIS raid SURVIVES the landing');
    for (let i = 0; i < 1600; i++) w.tick(DT);                            // play it out + clean up
    w.harvestTotal = 100;
    w._duelBeat = { stunt: 'taunt', by: 'defender', bark: 'STALE', rid: 'a-different-raid' };
    w.applyInbox([raidEvt(w, 4243, 0.5)]);
    landPending(w);
    ok(!w._duelBeat || w._duelBeat.rid !== 'a-different-raid', 'a beat for a DIFFERENT raid is dropped on staging');
}

console.log(pass ? '\nALL ADVERSARIAL PROBES PASSED' : '\nSOME PROBES FAILED');
process.exit(pass ? 0 : 1);
