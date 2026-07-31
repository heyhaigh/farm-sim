// tests/rest-hold.mjs — the roofless-night rest contract. Run: node tests/rest-hold.mjs
//
// Documents the #rest-hold fix directly (Codex #68 suggested pinning the behaviour, not just the digest):
//
//   1. BOUNDED REST EXITS. A settler with no roof spends the night in `rest` ("no den yet"). Before the
//      fix, the rest case exited the tick energy crossed 0.5 and #decide immediately re-rested them —
//      a per-tick rest<->decide flip-flop that fired `say('back to it')` hundreds of times a night
//      (measured worst: 822 exits in 3 days; healthy is a handful — daytime breathers + dawn wake-ups).
//   2. REST STAYS LIVE. The hold must NOT swallow a rester when the town is attacked: a raid landing
//      routes them out of `rest` (mustering/fleeing/fighting through `decide`), same as any working farmer.
//
// Both parts guard their own non-vacuity (this repo has been burned by vacuous assertions three times:
// Codex #48, #52, #55): part 1 asserts farmers actually ENTERED night rest before bounding the exits;
// part 2 asserts the victim really was resting before the raid, then really left.

import { World } from '../farm.js';
import { generateCrew, hashString } from '../dna.js';

const DT = 1 / 30;

function boot(seed, culture) {
    const m = generateCrew(seed);
    const used = new Set();
    const pick = () => {
        const un = m.filter(x => !used.has(x.id));
        let b = un[0], bh = 0xffffffff;
        for (const x of un) { const h = hashString((x.id || x.title || '') + ':pick'); if (h < bh) { bh = h; b = x; } }
        used.add(b.id); return b;
    };
    const w = new World(seed, culture);
    for (let i = 0; i < 8; i++) w.addFarmer(pick(), 0);
    w.ensureFounderVariety();
    return w;
}

let pass = true;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ FAIL ') + m); if (!c) pass = false; };

// ---------- Part 1: bounded rest exits across the roofless window ----------
console.log('Part 1 — a roofless night rest holds (no rest<->decide flip-flop)');
for (const culture of ['orc', 'human']) {
    const w = boot(20260706, culture);
    const exits = new Map(), nightRested = new Set();
    for (const f of w.farmers) {
        exits.set(f, 0);
        const orig = f.say.bind(f);
        f.say = (text, color) => { if (text === 'back to it') exits.set(f, exits.get(f) + 1); return orig(text, color); };
    }
    while (w.day < 3) {
        w.tick(DT);
        if (w.isNight()) for (const f of w.farmers) if (f.state === 'rest') nightRested.add(f);
    }
    // non-vacuity: the scenario actually occurred — roofless founders rested at night
    ok(nightRested.size >= w.farmers.length / 2, `${culture}: ${nightRested.size}/${w.farmers.length} farmers took a night rest (scenario is live)`);
    const worst = Math.max(...exits.values());
    ok(worst < 30, `${culture}: worst per-farmer rest-exit count over 3 days is ${worst} (flip-flop regression would be 100s)`);
}

// ---------- Part 2: a raid still yanks a resting farmer out of the hold ----------
console.log('Part 2 — rest stays live: a landing raid routes a rester out of rest');
{
    const w = boot(20260706, 'human');
    // tick into a night with someone actually resting (non-vacuity for the interrupt claim)
    let rester = null, guard = 0;
    while (!rester && guard++ < 30 * 60 * 60 * 3) {   // hard cap ~3 sim-hours of ticks past boot
        w.tick(DT);
        if (w.isNight()) rester = w.farmers.find(f => f.state === 'rest' && f.health === 'healthy') || null;
    }
    ok(!!rester, `found a healthy farmer resting at night (day ${w.day}, ${rester ? rester.sheet.name : 'NONE'})`);
    if (rester) {
        // stage + land a raid exactly as the adversarial suite does (telegraph, then jump to landsAt)
        w.applyInbox([{ id: 'rh-1', kind: 'raided', day: w.day, pairKey: 'rh-1', ordinal: 1, commit: 0.3, by: 'the Ashfang clan' }]);
        if (w.pendingRaid) { w.time = w.pendingRaid.landsAt; w.tick(DT); }
        let left = rester.state !== 'rest';
        for (let i = 0; i < 30 * 20 && !left; i++) { w.tick(DT); left = rester.state !== 'rest'; }   // ≤20 sim-seconds
        ok(left, `the rester left 'rest' after the raid landed (now '${rester.state}')`);
    }
}

if (!pass) { console.error('\nrest-hold contract violated'); process.exit(1); }
console.log('\nRest-hold contract holds: bounded night exits, and a raid still wakes the town.');
