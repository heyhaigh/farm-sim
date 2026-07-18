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
// call the vote (rollover 1) then tally it (rollover 2); return { called, passed }
function runVote(w) { advDay(w); const called = !!w.counterVote; advDay(w); return { called, passed: !!w.counterAuthorized }; }

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
        ok(JSON.stringify(a.counterAuthorized) === JSON.stringify(b.counterAuthorized), `seed ${seed}: same seed+config → identical verdict`);
        // WATCHED (_live) must produce the byte-identical sim outcome as DORMANT
        const live = primed(seed, null, 1.6, { live: true });
        runVote(live);
        ok(JSON.stringify(live.counterAuthorized) === JSON.stringify(a.counterAuthorized), `seed ${seed}: watched (_live) === dormant`);
    }
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
