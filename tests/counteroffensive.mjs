// tests/counteroffensive.mjs — Counter-offensive PHASE 1: the grievance ledger + the failable hero-called vote.
// DOCTRINE checks: (1) eligibility GATES correctly (needs a named, escaped, patterned nemesis + DEFENSE doctrine
// + boiled-over grievance + a present wronged hero + a body of riders); (2) the vote is FAILABLE — a dovish town
// HOLDS at moderate grievance but RIDES when the wrong runs deep, a hawkish town rides readily; (3) it is
// DETERMINISTIC (same seed+config → same verdict) and (4) identical WATCHED vs DORMANT (the vote lives in the day
// rollover, draws no world.rand, reads no display state); (5) the grievance/vote/mandate fields ROUND-TRIP a save.
import { World } from '../farm.js';
import { generateCrew } from '../dna.js';

let pass = true;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ FAIL ') + m); if (!c) pass = false; };

// build a town primed with a named nemesis that keeps ESCAPING, on the DEFENSE branch, at a given grievance.
function primed(seed, traits, grievance, opts = {}) {
    const w = new World(seed);
    if (opts.live) w._live = true;
    const crew = generateCrew(seed);
    for (let i = 0; i < 8; i++) w.addFarmer(crew[i], 0);
    if (traits) for (const f of w.farmers) Object.assign(f.sheet.personality, traits);
    const hero = w.farmers[0];
    w.nemesis = { pairKey: 'orc:99', name: 'Gorehowl the Cruel', raidCount: 3, sworeAgainst: hero.sheet.seed, lastOutcome: 'escaped', ended: false };
    w.learned = 'defense';
    w.grievance = grievance;
    return w;
}
// advance exactly one day rollover (where #tickCounterOffensive runs)
function advDay(w) { const d0 = w.day; let g = 0; while (w.day === d0 && g++ < 400000) w.tick(0.05); }
// call the vote (rollover 1) then tally it (rollover 2); a PASS launches the sortie (counterSortie set + the
// mandate consumed), so "passed" = the war party actually rode. return { called, passed }
function runVote(w) { advDay(w); const called = !!w.counterVote; advDay(w); return { called, passed: !!w.counterSortie }; }

const DOVE = { competitiveness: 0.2, collaboration: 0.8, honesty: 0.85 };
const HAWK = { competitiveness: 0.85, collaboration: 0.4, honesty: 0.3 };

console.log('#counteroffensive — eligibility gating');
{
    // the happy path fires
    ok(runVote(primed(555, null, 1.4)).called, 'an eligible war (named, escaped, defense, boiled-over) CALLS the vote');
    // each precondition, removed, must block it
    const noArc = primed(555, null, 1.4); noArc.nemesis = null;
    ok(!runVote(noArc).called, 'no nemesis → no vote');
    const held = primed(555, null, 1.4); held.nemesis.lastOutcome = 'fell';
    ok(!runVote(held).called, 'the foe did NOT get away (lastOutcome != escaped) → no vote');
    const truce = primed(555, null, 1.4); truce.learned = 'truce';
    ok(!runVote(truce).called, 'a TRUCE-branch town does not ride out → no vote');
    const calm = primed(555, null, 0.3);
    ok(!runVote(calm).called, 'grievance below threshold → no vote');
    const oneRaid = primed(555, null, 1.4); oneRaid.nemesis.raidCount = 1;
    ok(!runVote(oneRaid).called, 'a single raid (not a PATTERN) → no vote');
    const noHero = primed(555, null, 1.4); noHero.nemesis.sworeAgainst = 999999;   // sworn-against soul not in town
    ok(!runVote(noHero).called, 'the wronged hero is absent → no one to call it → no vote');
}

console.log('#counteroffensive — the vote is FAILABLE (town character decides)');
{
    ok(runVote(primed(555, DOVE, 1.2)).passed === false, 'a DOVISH town at moderate grievance HOLDS the wall (vote fails)');
    ok(runVote(primed(555, DOVE, 2.6)).passed === true, 'a DOVISH town RIDES when the wrong runs deep enough (grievance overrides)');
    ok(runVote(primed(555, HAWK, 1.2)).passed === true, 'a HAWKISH town RIDES readily at the same grievance');
}

console.log('#counteroffensive — determinism + watched-vs-dormant');
{
    for (const seed of [555, 42, 7]) {
        const a = primed(seed, null, 1.6), b = primed(seed, null, 1.6);
        runVote(a); runVote(b);
        ok(JSON.stringify(a.counterSortie) === JSON.stringify(b.counterSortie), `seed ${seed}: same seed+config → identical war party (party, days, spoils, returnAt)`);
        // WATCHED (_live) must produce the byte-identical SIM state as DORMANT (only display differs)
        const live = primed(seed, null, 1.6, { live: true });
        runVote(live);
        ok(JSON.stringify(live.counterSortie) === JSON.stringify(a.counterSortie), `seed ${seed}: watched (_live) === dormant`);
    }
}

console.log('#counteroffensive PHASE 2 — the sortie: muster, away, return');
{
    const w = primed(555, HAWK, 1.8);   // hawks ride
    runVote(w);
    const s = w.counterSortie;
    ok(!!s, 'a PASS launches the war party (counterSortie set)');
    ok(w.counterAuthorized === null, 'the mandate is consumed (being executed, not left pending)');
    ok(s && s.days >= 1 && s.days <= 3, `away window is 1..3 days (got ${s && s.days})`);
    ok(s && s.party.length >= 1 && s.party.includes(w.farmers[0].sheet.seed), 'the wronged hero rides with the party');
    ok(s && !!s.rally, 'a frontier rally point is set (the muster marches there)');
    const away = s.party.map(seed => w.farmers.find(f => f.sheet.seed === seed));
    // run until they DEPART (off-field) — the muster (hold → march → depart) completes on its own
    let g0 = 0; while (w.counterSortie && w.counterSortie.phase === 'muster' && g0++ < 30) advDay(w);
    ok(w.counterSortie && w.counterSortie.phase === 'away', 'the muster completes and the party DEPARTS (phase away)');
    ok(away.every(f => f.onSortie && !f.mustering), 'every rider is OFF-FIELD (onSortie) while away');
    ok(w.farmers.filter(f => !f.onSortie && !f.downed && f.health !== 'sick').length >= 3, 'the workforce floor stays home');
    // the town is UNDEFENDED while away — the raid defender pool excludes the riders
    const raidDefenders = w.farmers.filter(f => !f.downed && f.health !== 'sick' && !f.onSortie).length;
    ok(raidDefenders === w.farmers.length - away.length, 'the away riders are excluded from the raid defence (town holds thin)');
    // ride it out to the return
    const before = w.harvestTotal || 0;
    let guard = 0; while (w.counterSortie && guard++ < 60) advDay(w);
    ok(w.counterSortie === null, 'the sortie resolves at its deadline (counterSortie cleared)');
    ok(away.every(f => !f.onSortie && !f.mustering), 'every survivor is back on-field');
    const gainedOrCasualty = (w.harvestTotal || 0) > before || away.some(f => f.downed);
    ok(gainedOrCasualty, 'the return had CONSEQUENCE — reclaimed spoils and/or a casualty');
}

console.log('#counteroffensive PHASE 2 — the sortie rides the save');
{
    const w = primed(42, HAWK, 1.8);
    runVote(w);
    let g0 = 0; while (w.counterSortie && w.counterSortie.phase === 'muster' && g0++ < 30) advDay(w);   // let them depart (away)
    ok(!!w.counterSortie && w.counterSortie.phase === 'away', 'a war party is out (away)');
    const w2 = World.fromSave(structuredClone(w.serialize()));
    ok(JSON.stringify(w2.counterSortie) === JSON.stringify(w.counterSortie), 'the away war party round-trips a save');
    const riders = w.counterSortie.party;
    ok(riders.every(seed => w2.farmers.find(f => f.sheet.seed === seed).onSortie), 'the riders are still off-field after a reload');
    // both resolve to the same place
    let g = 0; while ((w.counterSortie || w2.counterSortie) && g++ < 60) { advDay(w); advDay(w2); }
    ok((w.counterSortie === null) && (w2.counterSortie === null), 'saved-then-loaded sortie resolves the same');
}

console.log('#counteroffensive — save round-trip');
{
    const w = primed(555, null, 1.6);
    advDay(w);   // vote is now CALLED (in flight)
    ok(!!w.counterVote && w.counterVote.phase === 'called', 'a vote is in flight (called)');
    const w2 = World.fromSave(structuredClone(w.serialize()));
    ok(Math.abs((w2.grievance || 0) - w.grievance) < 1e-9, 'grievance round-trips');
    ok(JSON.stringify(w2.counterVote) === JSON.stringify(w.counterVote), 'the in-flight counterVote round-trips');
    ok(w2.counterCooldownUntil === w.counterCooldownUntil, 'the cooldown round-trips');
    // and the RESTORED town tallies the vote to the same verdict as the original
    advDay(w); advDay(w2);
    ok(JSON.stringify(w2.counterAuthorized) === JSON.stringify(w.counterAuthorized), 'a saved-then-loaded town tallies to the SAME verdict');
}

console.log(pass ? '\nALL COUNTER-OFFENSIVE PROBES PASSED' : '\nSOME COUNTER-OFFENSIVE PROBES FAILED');
process.exit(pass ? 0 : 1);
