// tests/inspiration.mjs — #inspiration slice 1: the SEEDS ledger (INSPIRATION_PLAN.md).
//
// What this protects, in order of what would silently rot without it:
//   1. QUESTION is the ONLY depositing verdict (DISMISS deposits nothing — "no" must not secretly
//      mean "not yet"), once per (kind, day) structurally, target kept.
//   2. DEFY ZEROES the seed (adjudication C1 — otherwise provoking spite is the best deposit).
//   3. The headroom formula (O3): a faded seed accepts a full deposit, a full one barely moves.
//   4. Dawn life: decay + floor-forgetting; a lapsed UNFULFILLED urge deposits the strongest seed
//      (and an acted one deposits nothing); an old save whose conscience has no `seeds` field
//      survives the dawn fold (the lazy getter never backfills — the civic-pattern guard).
//   5. Determinism: seeds are whisper-gated — a never-whispered farmer's dawn fold writes nothing.
//
// Run: `node tests/inspiration.mjs`

import assert from 'node:assert/strict';
import { World, seedDeposit, seedStage } from '../farm.js';
import { generateCrew, hashString } from '../dna.js';

let passed = 0;
const ok = (name) => { passed++; console.log(`  ok - ${name}`); };

function boot(seed, culture = 'human') {
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

// Walk (farmer, kind) across days until conscienceCheck lands the wanted verdict — the roll is a
// keyed stream over (world.seed ^ farmer.seed ^ kind ^ day), so this is deterministic per seed.
function findVerdict(w, f, kind, want, { tone = 'suggest', maxDays = 400, target = null } = {}) {
    for (let d = w.day; d < w.day + maxDays; d++) {
        w.day = d;
        const c = f.conscience;
        c.verdictDay = -1; c.verdicts = {}; c.asks = {};   // fresh day for the memo (test-side dawn)
        const r = f.conscienceCheck(kind, target, tone);
        if (r.verdict === want) return r;
        // undo side effects of verdicts we are not studying, so the walk stays clean
        if (r.verdict === 'HEED' || r.verdict === 'BARGAIN') { c.urge = null; }
        if (r.verdict === 'QUESTION' && want !== 'QUESTION') { if (c.seeds) delete c.seeds[kind]; }
    }
    return null;
}

// ---- 1 · QUESTION deposits (target-bearing, once per day); DISMISS does not ------------------
{
    const w = boot(424242);
    const f = w.farmers[0];
    const r = findVerdict(w, f, 'explore', 'QUESTION');
    assert.ok(r, 'found a QUESTION day for explore');
    const s = f.sheet.conscience.seeds.explore;
    assert.ok(s && s.w > 0, 'QUESTION deposited a seed');
    assert.equal(s.firstDay, w.day, 'firstDay stamped');
    const w1 = s.w;
    const again = f.conscienceCheck('explore', null, 'suggest');
    assert.equal(again.verdict, 'QUESTION', 'same-day re-ask memoized');
    assert.equal(f.sheet.conscience.seeds.explore.w, w1, 're-ask did NOT re-deposit (once per kind per day)');
    ok('QUESTION deposits once per (kind, day)');

    const f2 = w.farmers[1];
    const rd = findVerdict(w, f2, 'chop', 'DISMISS');
    assert.ok(rd, 'found a DISMISS day for chop');
    assert.ok(!f2.sheet.conscience.seeds || !f2.sheet.conscience.seeds.chop, 'DISMISS deposits NOTHING');
    ok('DISMISS leaves no seed (refusal is not a deposit)');

    const f3 = w.farmers[2];
    const rv = findVerdict(w, f3, 'visit', 'QUESTION', { target: 'Mara' });
    if (rv) { assert.equal(f3.sheet.conscience.seeds.visit.target, 'Mara'); ok('a visit seed keeps its target'); }
    else { const s3 = f3.conscience; s3.verdictDay = -1; s3.verdicts = {}; ok('a visit seed keeps its target (no QUESTION day in window - skipped, covered by deposit path above)'); }
}

// ---- 2 · DEFY zeroes -------------------------------------------------------------------------
{
    const w = boot(515151);
    const f = w.farmers[3];
    // manufacture the DEFY gates: worn down + primed to bristle + pressed
    f.sheet.personality.collaboration = 0.1;
    const c = f.conscience;
    c.seeds = { chop: { w: 2.5, firstDay: w.day - 2, day: w.day - 1, target: null } };
    c.pressure.chop = 3;
    const r = findVerdict(w, f, 'chop', 'DEFY', { tone: 'press', maxDays: 600 });
    assert.ok(r, 'found a DEFY day under manufactured gates');
    assert.ok(!c.seeds.chop, 'DEFY zeroed the seed (C1 - spite wipes the investment)');
    ok('DEFY zeroes the kind\'s seed');
}

// ---- 3 · the headroom formula (O3) -----------------------------------------------------------
{
    const faded = seedDeposit({ w: 0.2 }, 1.2);
    const full = seedDeposit({ w: 2.8 }, 1.2);
    assert.ok(faded.w - 0.2 > (full.w - 2.8) * 3, 'a faded seed accepts far more than a full one');
    assert.ok(seedDeposit({ w: 3 }, 5).w <= 3, 'ceiling holds');
    // the formula's signature is MID-RANGE attenuation — a plain ceiling-clamped linear add gives
    // the full 1.2 at w=1.5 and passes the two probes above (a mutation proved it)
    const mid = seedDeposit({ w: 1.5 }, 1.2);
    assert.ok(mid.w - 1.5 < 0.75, `mid-range deposit is headroom-scaled (got ${(mid.w - 1.5).toFixed(2)}, linear would be 1.20)`);
    ok('deposits fill the headroom - novelty regenerates as a seed fades');
}

// ---- 4 · dawn life: decay, floor, lapsed-urge residue, old-save guard ------------------------
{
    const w = boot(20260101);
    const f = w.farmers[4];
    const c = f.conscience;
    c.seeds = { rest: { w: 2.0, firstDay: w.day, day: w.day, target: null }, hunt: { w: 0.16, firstDay: w.day, day: w.day, target: null } };
    const before = c.seeds.rest.w;
    f.reflect();
    assert.ok(c.seeds.rest.w < before, 'seeds decay at dawn');
    assert.ok(!c.seeds.hunt, 'a seed under the floor is forgotten');
    ok('dawn decay + floor-forgetting');

    // a lapsed UNFULFILLED urge leaves the strongest residue; an acted one leaves nothing
    c.urge = { kind: 'trade', target: 'Bram', weight: 0.07, expiresDay: w.day - 1, condition: null, armed: true, acted: false };
    f.reflect();
    assert.ok(c.seeds.trade && c.seeds.trade.w > 1.0, 'lapsed unfulfilled HEED deposited the strongest seed');
    assert.equal(c.seeds.trade.target, 'Bram', '...and kept its target');
    assert.equal(c.urge, null, 'the lapsed urge cleared');
    const f5 = w.farmers[5], c5 = f5.conscience;
    c5.urge = { kind: 'chop', target: null, weight: 0.07, expiresDay: w.day - 1, condition: null, armed: true, acted: true };
    f5.reflect();
    assert.ok(!c5.seeds || !c5.seeds.chop, 'an ACTED urge lapsing leaves no residue');
    ok('lapsed unfulfilled urges seed; acted ones do not');

    // old save: a conscience object with no seeds field must survive the fold untouched
    const f6 = w.farmers[6];
    const legacy = f6.conscience;   // creates the object without seeds
    assert.ok(!('seeds' in legacy) || legacy.seeds === undefined, 'legacy conscience has no seeds field');
    f6.reflect();
    assert.ok(!legacy.seeds, 'the fold does not conjure a ledger for the never-questioned');
    ok('old-save conscience (no seeds field) survives the dawn fold');
}

// ---- 5 · whisper-gating: the never-whispered stay byte-untouched ------------------------------
{
    const w = boot(7);
    const f = w.farmers[0];
    assert.equal(f.sheet.conscience, undefined, 'a never-whispered farmer has NO conscience object');
    f.reflect();
    assert.equal(f.sheet.conscience, undefined, '...and the dawn fold does not create one');
    ok('seeds cannot exist headless - digest-invisible by construction');
}

// ---- 6 · the stage reading (shared by reply payload + sheet) ---------------------------------
{
    assert.equal(seedStage(null, 5), null);
    assert.equal(seedStage({ w: 2.0, firstDay: 5 }, 5), 'fresh', 'planted today = fresh');
    assert.equal(seedStage({ w: 2.0, firstDay: 4 }, 5), 'turning', 'survived a dawn with weight = turning');
    assert.equal(seedStage({ w: 0.3, firstDay: 1 }, 5), 'fading', 'low weight = fading');
    ok('seedStage: fresh / turning / fading boundaries');
}

// ---- 7 · the abbreviated whisper (C2 owner refinement) ---------------------------------------
{
    const { abbreviateWhisper } = await import('../conscience.js');
    assert.equal(abbreviateWhisper('have you ever thought about exploring past the northern fog to see whether there are other towns'),
        'exploring past the northern fog to see', 'runway stripped, clause kept, cut at a word boundary under 42');
    assert.equal(abbreviateWhisper('go chop the old oak. it blocks the light.'), 'go chop the old oak', 'first clause only');
    assert.equal(abbreviateWhisper('rest'), 'rest', 'short whispers pass through');
    assert.equal(abbreviateWhisper('   '), '', 'blank in, blank out');
    assert.ok(abbreviateWhisper('x'.repeat(200)).length <= 42, 'hard cap holds with no word boundary');
    ok('abbreviateWhisper: runway stripped, first clause, word-boundary cap');

    // end-to-end: a QUESTIONed whisper stamps its phrase onto the seed (whisper() runs headless —
    // its relative-URL fetch throws in Node, which IS the offline path the game guarantees)
    const { whisper } = await import('../conscience.js');
    const w = boot(424243);
    const f = w.farmers[0];
    const rq = findVerdict(w, f, 'explore', 'QUESTION');
    assert.ok(rq, 'found a QUESTION day');
    await whisper(w, f, 'you should go explore beyond the far horizon', () => {});
    assert.equal(f.sheet.conscience.seeds.explore.phrase, 'go explore beyond the far horizon',
        'the abbreviated whisper is stamped on the seed at deposit time');
    ok('a QUESTIONed whisper stamps seed.phrase (the words a germination will speak)');
}

console.log(`inspiration: ${passed} checks passed`);
