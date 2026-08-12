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

import fs from 'node:fs';
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

// ================================ SLICE 2 · GERMINATION =======================================

// Prime a farmer with a ripe, phraseless seed and walk dawns (day bump + reflect) until the
// returning thought wins. Deterministic per world seed — the germ roll is a keyed stream.
function ripen(f, kind, { target = null, phrase = null } = {}) {
    const c = f.conscience;
    c.seeds = c.seeds || {};
    c.seeds[kind] = { w: SEED_MAX_TEST, firstDay: f.world.day - 2, day: f.world.day, target, ...(phrase ? { phrase } : {}) };
    return c.seeds[kind];
}
const SEED_MAX_TEST = 3;   // keep chance high alongside curiosity so the walk stays short

function walkDawns(w, farmers, days, each) {
    for (let i = 0; i < days; i++) {
        w.day += 1;
        for (const f of farmers) f.reflect();
        w.dawnGermination();   // the world's post-fold arbitration pass (Codex #124 P1)
        if (each && each(i)) return true;
    }
    return false;
}

// ---- 8 · germination is SILENT at dawn; the theater waits for the act ------------------------
{
    const w = boot(424242);
    const f = w.farmers[0];
    f.sheet.personality.curiosity = 1.0;
    const s = ripen(f, 'explore', { phrase: 'explore past the northern fog' });
    const hit = walkDawns(w, [f], 40, () => f.sheet.conscience.urge?.origin === 'inspiration');
    assert.ok(hit, 'a ripe seed on a curious mind germinated within 40 dawns');
    const c = f.sheet.conscience;
    assert.equal(c.urge.kind, 'explore');
    assert.ok(s.sprouted, 'seed marked sprouted (dormant, not forgotten)');
    assert.ok(s.phrase, 'the phrase survives germination');
    // owner (2026-08-12): a dawn announcement is "too scripted" — the sprout moment is the ACT.
    // At dawn: the urge exists and quietly tilts; no credit, no telemetry, no sprout speech.
    assert.ok(!c.rooted || c.rooted.explore == null, 'no took-root credit at dawn');
    assert.ok(!w._germEvent, 'no telemetry at dawn');
    assert.ok(!(f.bubble?.lines || []).join(' ').includes('TODAY I ANSWER IT'), 'no sprout speech at dawn (the reminder musing may whisper, the sprout may not)');
    ok('germination is silent: the urge tilts quietly until the act finds its moment');
}

// ---- 8b · the sprout MOMENT is the act — when it serves them ---------------------------------
{
    const w = boot(565656);
    const f = w.farmers[0];
    const c = f.conscience;
    c.seeds = { rest: { w: 0.3, firstDay: w.day - 3, day: w.day, target: null, sprouted: w.day, phrase: 'rest those weary bones' } };
    c.urge = { kind: 'rest', target: null, weight: 0.07, expiresDay: w.day + 1, condition: null, armed: true, origin: 'inspiration' };
    f.energy = 0.05;   // spent — the decide loop will route to rest of its own accord
    let acted = false;
    for (let i = 0; i < 6000 && !acted; i++) { w.tick(1 / 30); acted = !!(c.rooted && c.rooted.rest != null); }
    assert.ok(acted, 'the act happened mid-day, chosen by the decide loop');
    assert.ok((f.bubble?.lines || []).join(' ').includes('REST THOSE WEARY BONES'), 'the sprout moment speaks the phrase AT the act');
    assert.ok(!c.seeds.rest, 'the seed became the deed');
    assert.equal(c.warmth, 1, 'O2 warmth fed at the act');
    assert.ok(w._germEvent && w._germEvent.kind === 'rest', 'telemetry stamped at the act');
    ok('the sprout moment is the act: phrase, credit, warmth, telemetry all land when it serves them');
}

// ---- 9 · the gates: pressure, kind coverage, visit target ------------------------------------
{
    const w = boot(515151);
    const f = w.farmers[1];
    f.sheet.personality.curiosity = 1.0;
    ripen(f, 'explore');
    // C3 — a nagged mind does not sprout WHILE pressure stands. Pressure ebbs at dawn (that is
    // the design: let it rest and it may grow), so the gate test must re-pin it each dawn —
    // including BEFORE the first (the callback runs after each reflect).
    f.conscience.pressure.explore = 1;
    walkDawns(w, [f], 12, () => {
        f.conscience.pressure.explore = 1;                                  // the nagging never stops
        const s = f.conscience.seeds.explore; if (s && !s.sprouted) s.w = 3;   // and the seed stays ripe
        return false;
    });
    assert.ok(!f.sheet.conscience.urge, 'no sprout while pressure stands');
    assert.ok(!f.conscience.seeds.explore.sprouted, 'seed never sprouted under held pressure');
    // ...and once the player lets it rest, the same seed may finally sprout
    delete f.conscience.pressure.explore;
    const freed = walkDawns(w, [f], 30, () => { const s = f.conscience.seeds.explore; if (s && !s.sprouted) s.w = 3; return f.sheet.conscience.urge?.origin === 'inspiration'; });
    assert.ok(freed, 'released pressure let the seed sprout');
    ok('C3: pressure hard-gates germination; letting it rest releases it');

    const f2 = w.farmers[2];
    f2.sheet.personality.curiosity = 1.0;
    ripen(f2, 'plant');                   // no decide-loop consumer -> excluded
    ripen(f2, 'visit');                   // no target -> inert
    // keep them ripe against decay so the exclusion is what's tested, not the floor
    walkDawns(w, [f2], 30, () => { const cs = f2.conscience.seeds; if (cs.plant) cs.plant.w = 3; if (cs.visit) cs.visit.w = 3; return !!f2.sheet.conscience.urge; });
    assert.ok(!f2.sheet.conscience.urge, 'plant (unwired) and targetless visit never germinate');
    ok('kind coverage honest: plant excluded, visit needs its target');
}

// ---- 10 · the town budget: at most one pending sprout ----------------------------------------
{
    const w = boot(20260101);
    const a = w.farmers[0], b = w.farmers[3];
    for (const f of [a, b]) { f.sheet.personality.curiosity = 1.0; ripen(f, 'explore'); }
    let maxPending = 0;
    walkDawns(w, [a, b], 30, () => {
        const n = [a, b].filter(f => f.sheet.conscience.urge?.origin === 'inspiration').length;
        maxPending = Math.max(maxPending, n);
        for (const f of [a, b]) { const s = f.conscience.seeds?.explore; if (s && !s.sprouted) s.w = 3; }
        return false;
    });
    assert.ok(maxPending >= 1, 'the scenario is live - at least one sprout happened');
    assert.ok(maxPending <= 1, `never more than GERM_TOWN_CAP pending sprouts (saw ${maxPending})`);
    ok('germination budget: one pending self-sown urge town-wide');
}

// ---- 11 · slot policy: a whisper cannot kill the sprout --------------------------------------
{
    const w = boot(424242 ^ 7);
    const f = w.farmers[4];
    const c = f.conscience;
    c.urge = { kind: 'explore', target: null, weight: 0.07, expiresDay: w.day + 1, condition: null, armed: true, origin: 'inspiration' };
    // walk kinds/days until a would-be HEED hits the slot-policy branch (its reason names it)
    let got = null;
    outer: for (let d = 0; d < 2; d++) {
        for (const k of ['chop', 'rest', 'build', 'hunt', 'trade']) {
            c.verdictDay = -1; c.verdicts = {}; c.asks = {};
            const r = f.conscienceCheck(k, null, 'suggest');
            if (r.reason === 'set on their own errand') { got = r; break outer; }
        }
        w.day += 1; c.urge.expiresDay = w.day + 1;   // keep the sprout alive for the search
    }
    assert.ok(got, 'found a would-be HEED while the sprout lives');
    assert.equal(got.verdict, 'QUESTION', 'the heed became a QUESTION-with-deposit');
    assert.ok(c.seeds[got.kind] && c.seeds[got.kind].w > 0, 'the whisper was seeded, not wasted');
    assert.equal(c.urge.origin, 'inspiration', 'the sprout survived the whisper');
    ok('slot policy: a live sprout absorbs a would-be HEED as a seed');
}

// ---- 12 · O2 warmth: bore fruit -> the voice is trusted a little more ------------------------
{
    const w = boot(898989);
    const f = w.farmers[5];
    const c = f.conscience;
    // find a day where warmth alone flips the verdict upward (chance +0.15 at warmth 3)
    let flipped = false;
    for (let d = 0; d < 300 && !flipped; d++, w.day += 1) {
        c.verdictDay = -1; c.verdicts = {}; c.asks = {}; c.urge = null; delete c.warmth;
        const cold = f.conscienceCheck('trade', null, 'suggest').verdict;
        c.verdictDay = -1; c.verdicts = {}; c.asks = {}; c.urge = null; if (c.seeds) delete c.seeds.trade;
        c.warmth = 3;
        const warm = f.conscienceCheck('trade', null, 'suggest').verdict;
        assert.ok(!(cold === 'HEED' && (warm === 'DISMISS' || warm === 'QUESTION')), 'warmth never lowers receptivity');
        if ((cold === 'DISMISS' || cold === 'QUESTION') && (warm === 'HEED' || warm === 'BARGAIN')) flipped = true;
        c.urge = null; delete c.warmth; if (c.seeds) delete c.seeds.trade;
    }
    assert.ok(flipped, 'warmth flipped at least one cold day upward within 300 days');
    ok('O2 warmth raises whisper receptivity (and never lowers it)');
}

// ---- 13 · a lapsed sprout re-arms ------------------------------------------------------------
{
    const w = boot(777001);
    w.day += 4;   // clear of day 1: `sprouted: w.day - 1` must be TRUTHY or the re-arm assert is vacuous (a mutation proved it)
    const f = w.farmers[6];
    const c = f.conscience;
    c.seeds = { hunt: { w: 0.3, firstDay: w.day - 3, day: w.day, target: null, sprouted: w.day - 1, phrase: 'hunt the ridge' } };
    c.urge = { kind: 'hunt', target: null, weight: 0.07, expiresDay: w.day - 1, condition: null, armed: true, origin: 'inspiration', acted: false };
    f.reflect();
    assert.equal(c.urge, null, 'the lapsed sprout cleared');
    assert.ok(c.seeds.hunt.w > 1, 'the interruption re-deposited the strongest residue');
    assert.ok(!c.seeds.hunt.sprouted, 'sprouted cleared - the thought may sprout again (item 16)');
    assert.equal(c.seeds.hunt.phrase, 'hunt the ridge', 'the phrase survived the whole cycle');
    ok('a sprout swallowed by the days re-arms instead of dying');
}

// ---- 13b · nothing sprouts before GERM_MIN_AGE (fast local pin; the rates harness re-proves it)
{
    let sprouted = 0;
    for (let i = 0; i < 20; i++) {
        const w = boot(600000 + i * 101);
        const f = w.farmers[0];
        f.sheet.personality.curiosity = 1.0;
        f.conscience.seeds = { explore: { w: 3, firstDay: w.day, day: w.day, target: null } };   // planted TODAY
        w.day += 1; f.reflect(); w.dawnGermination();                                            // dawn 1: age 1
        if (f.sheet.conscience.urge?.origin === 'inspiration') sprouted++;
    }
    assert.equal(sprouted, 0, 'a day-old thought never sprouts - the window starts at GERM_MIN_AGE');
    ok('min-age holds: no dawn-1 sprouts across 20 towns');
}

// ---- 13c · arbitration is order-independent (Codex #124 P1's exact repro shape) ---------------
// A first-sprout walk can land on a SINGLE-candidate dawn, where first-wins and min-prio agree
// (a mutation proved it). The rolls are reproducible keyed streams, so ENGINEER a dawn where BOTH
// candidates' rolls succeed — that is the only dawn arbitration exists for — then require both
// array orders to crown the keyed-priority winner.
{
    const { mulberry32 } = await import('../dna.js');
    const A = 0, B = 3;
    const probe = boot(100003);
    const sa = probe.farmers[A].sheet.seed, sb = probe.farmers[B].sheet.seed;
    const roll = (fs, d) => mulberry32((probe.seed ^ fs ^ hashString('germ:explore') ^ (d * 0x1f1f)) >>> 0)();
    // chance floor with w~2.6 (post-decay), curiosity 1, fit >= -0.4 is ~0.248 — a dawn where both
    // rolls sit under 0.24 is a guaranteed both-succeed dawn
    let D = null;
    for (let d = probe.day + 3; d < probe.day + 800 && !D; d++) if (roll(sa, d) < 0.24 && roll(sb, d) < 0.24) D = d;
    assert.ok(D, 'found an engineered both-succeed dawn');
    const expected = [sa, sb].sort((x, y) =>
        hashString('germorder:' + probe.seed + ':' + D + ':' + x) - hashString('germorder:' + probe.seed + ':' + D + ':' + y))[0];
    const run = (reverse) => {
        const w = boot(100003);
        for (const i of [A, B]) {
            const f = w.farmers[i];
            f.sheet.personality.curiosity = 1.0;
            f.conscience.seeds = { explore: { w: 3.4, firstDay: D - 2, day: D, target: null } };   // ~3 after the fold's decay
        }
        if (reverse) w.farmers.reverse();   // reverses BOTH the fold order and the scan order
        w.day = D;
        for (const f of w.farmers) f.reflect();
        w.dawnGermination();
        const win = w.farmers.find(f => f.sheet.conscience?.urge?.origin === 'inspiration');
        return win && win.sheet.seed;
    };
    const fwd = run(false), rev = run(true);
    assert.ok(fwd && rev, 'both orders sprouted on the engineered dawn');
    assert.equal(fwd, rev, 'the same farmer wins regardless of array order');
    assert.equal(fwd, expected, 'and the winner is the keyed-priority minimum, not an index');
    ok('arbitration is order-independent and keyed (engineered both-succeed dawn)');
}

// ---- 13d · the watch path completes as inspiration (Codex #124 P1) ---------------------------
{
    const w = boot(343434);
    const f = w.farmers[0];
    const c = f.conscience;
    f.plot.sited = true;   // the decide branch requires a sited plot
    c.seeds = { watch: { w: 0.3, firstDay: w.day - 3, day: w.day, target: null, sprouted: w.day, phrase: 'keep watch tonight' } };
    c.urge = { kind: 'watch', target: null, weight: 0.07, expiresDay: w.day + 1, condition: null, armed: true, origin: 'inspiration' };
    let done = false;
    for (let i = 0; i < 6000 && !done; i++) { w.tick(1 / 30); done = !!(c.rooted && c.rooted.watch != null); }
    assert.ok(done, 'the self-sown watch completed');
    assert.ok(!c.seeds.watch, 'the watch seed became the deed (was: survived, whisper-credited)');
    assert.ok(c.warmth >= 1, 'warmth fed');
    assert.equal(w.roles.watchPost?.via, 'inspiration', 'the post records its true source');
    ok('a self-sown watch completes through the inspiration path, not the whisper lines');
}

// ---- 13e · the visit branch completes (Codex #124 P1) — source pin ---------------------------
// The 5d visit branch is downtime-tier and MEASUREDLY unreachable during the founding grind
// (three instrumented probes: fence-posting owns every decide; pinning energy routes to rest) —
// which is exactly why the missing completion shipped unnoticed. The completion MECHANISM
// (#heededWhisper -> #completeInspiration) is sim-proven twice above (rest 8b, watch 13d); this
// pin holds the visit branch's two completion calls in place (near-arrival + the watch-confer
// arrived-or-can't-get-closer fallback) so a refactor cannot silently drop them again.
{
    const src = fsInspiration();
    const branch = src.slice(src.indexOf("vu.kind === 'visit'"), src.indexOf('// 5e.'));
    assert.ok(branch.length > 100, 'found the 5d visit branch');
    assert.equal((branch.match(/#heededWhisper\('visit'\)/g) || []).length, 2,
        'the visit branch completes on BOTH paths: near-arrival and goTo-false (arrived/can\'t-get-closer)');
    assert.ok(/!vu\.acted/.test(src.slice(src.indexOf("vu.kind === 'visit'") - 200, src.indexOf("vu.kind === 'visit'") + 100)),
        'an acted visit urge does not re-trigger the branch');
    ok('visit completion pinned at source (mechanism sim-proven via rest + watch)');
}
function fsInspiration() {
    return fs.readFileSync(new URL('../farm.js', import.meta.url), 'utf8');
}

// ---- 13f · the slot-policy reply sounds like an occupied mind (Codex #124 P2) ----------------
{
    const { whisper } = await import('../conscience.js');
    const w = boot(232323);
    const f = w.farmers[2];
    const c = f.conscience;
    c.urge = { kind: 'explore', target: null, weight: 0.07, expiresDay: w.day + 1, condition: null, armed: true, origin: 'inspiration' };
    let line = null;
    for (let d = 0; d < 120 && !line; d++, w.day += 1) {
        c.verdictDay = -1; c.verdicts = {}; c.asks = {}; c.urge.expiresDay = w.day + 1;
        const r = await whisper(w, f, 'go chop some wood for the pile', () => {});
        if (r && r.reason === 'set on their own errand') line = c.log[c.log.length - 1].text;
        if (c.seeds) delete c.seeds.chop;   // keep each day's probe independent
    }
    assert.ok(line, 'found a slot-policy day (a would-be HEED absorbed by the live sprout)');
    assert.ok(/own errand|mind is set|its turn|noted/i.test(line),
        `the reply acknowledges the occupied mind (got: "${line}")`);
    ok('slot-policy replies speak as an occupied mind, not an ordinary musing');
}

// ---- 13g · the took-root credit lands on the EXACT exchange (Codex #124 P2) ------------------
{
    const w = boot(575757);
    const f = w.farmers[0];
    const c = f.conscience;
    // the exchange that planted the seed, then a rival same-kind exchange logged AFTER the act
    c.log = [{ who: 'ry', text: 'the planted exchange', day: w.day - 2, verdict: 'QUESTION', kind: 'rest' }];
    c.seeds = { rest: { w: 0.3, firstDay: w.day - 3, day: w.day, target: null, sprouted: w.day, phrase: 'rest' } };
    c.urge = { kind: 'rest', target: null, weight: 0.07, expiresDay: w.day + 1, condition: null, armed: true, origin: 'inspiration' };
    f.energy = 0.05;
    let acted = false;
    for (let i = 0; i < 6000 && !acted; i++) { w.tick(1 / 30); acted = !!(c.rooted && c.rooted.rest != null); }
    assert.ok(acted, 'the act happened');
    assert.equal(c.log[0].rooted, c.rooted.rest, 'the planting exchange itself carries the credit');
    const later = { who: 'ry', text: 'a later same-kind exchange', day: w.day, verdict: 'QUESTION', kind: 'rest' };
    c.log.push(later);
    assert.ok(later.rooted == null, 'a later same-kind exchange can never inherit the earlier credit');
    ok('took-root credit is entry-exact - no same-day inheritance');
}

// ---- 14 · a pending sprout never eats the player's town cap (item 11) ------------------------
{
    const w = boot(313131);
    // fill the whisper town cap to ONE below (3 of 4), plus a pending SELF-SOWN urge — if the
    // sprout counted, townPending would read 4 and no whisper could ever HEED again
    for (let i = 0; i < 3; i++) {
        const c = w.farmers[i].conscience;
        c.urge = { kind: 'chop', target: null, weight: 0.07, expiresDay: w.day + 1, condition: null, armed: true };
    }
    const cg = w.farmers[3].conscience;
    cg.urge = { kind: 'explore', target: null, weight: 0.07, expiresDay: w.day + 1, condition: null, armed: true, origin: 'inspiration' };
    const f = w.farmers[5];
    let heeded = false;
    for (let d = 0; d < 120 && !heeded; d++, w.day += 1) {
        for (let i = 0; i < 4; i++) w.farmers[i].conscience.urge.expiresDay = w.day + 1;   // keep all four alive
        const c = f.conscience;
        c.verdictDay = -1; c.verdicts = {}; c.asks = {}; c.urge = null;
        c.heededDay = { day: -1, count: 0 };
        const r = f.conscienceCheck('rest', null, 'suggest');
        if (r.verdict === 'HEED' || r.verdict === 'BARGAIN') heeded = true;
    }
    assert.ok(heeded, 'a whisper still HEEDs with 3 whispered urges + 1 pending sprout (the sprout is off the player\'s cap)');
    ok('item 11: self-sown urges never consume the whisper town cap');
}

// ================================ SLICE 3 · THE WHITE-BEAR ====================================
// DEFY still zeroes (C1 untouched) — but a SUBSTANTIAL thought torn out sometimes echoes the
// next dawn, voiced once, purely narrative. Keyed percent, so deterministic per (town, day).

// walk manufactured DEFYs until one lands with the wanted whitebear outcome
function findDefy(w, f, kind, { seedW, wantBear, maxDays = 900 }) {
    const c = f.conscience;
    f.sheet.personality.collaboration = 0.1;
    for (let d = 0; d < maxDays; d++, w.day += 1) {
        c.verdictDay = -1; c.verdicts = {}; c.asks = {}; c.urge = null; delete c.whitebear;
        c.pressure[kind] = 3;
        c.seeds = { [kind]: { w: seedW, firstDay: w.day - 2, day: w.day, target: null, phrase: 'chop the old oak' } };
        const r = f.conscienceCheck(kind, null, 'press');
        if (r.verdict === 'DEFY') {
            assert.ok(!c.seeds[kind], 'C1 intact: the seed is gone regardless of the echo');
            if (!!c.whitebear === wantBear) return true;
        }
    }
    return false;
}
{
    const w = boot(919191);
    const f = w.farmers[0];
    assert.ok(findDefy(w, f, 'chop', { seedW: 2.5, wantBear: true }), 'a substantial torn-out thought sometimes echoes');
    const wb = f.conscience.whitebear;
    assert.equal(wb.kind, 'chop');
    assert.equal(wb.phrase, 'chop the old oak', 'the echo keeps the words');
    // the echo: once, the NEXT dawn, voiced + journaled, then done
    w.day += 1; f.reflect();
    assert.ok((f.bubble?.lines || []).join(' ').includes('WHY CAN I STILL HEAR IT'), 'the contradiction is spoken aloud');
    assert.ok((f.bubble?.lines || []).join(' ').includes('CHOP THE OLD OAK'), '...in the thought\'s own words');
    assert.ok(!f.conscience.whitebear, 'the echo fires once and is done');
    assert.ok(f.journal.some(e => e.text.includes('has not entirely left')), 'and it is journaled');
    ok('white-bear: a substantial DEFY echoes once at dawn, voiced, then rests');
}
{
    const w = boot(929292);
    const f = w.farmers[1];
    // a FAINT seed torn out never echoes — walk many DEFYs and require zero bears
    let bears = 0, defys = 0;
    const c = f.conscience;
    f.sheet.personality.collaboration = 0.1;
    for (let d = 0; d < 600 && defys < 12; d++, w.day += 1) {
        c.verdictDay = -1; c.verdicts = {}; c.asks = {}; c.urge = null; delete c.whitebear;
        c.pressure.hunt = 3;
        c.seeds = { hunt: { w: 0.5, firstDay: w.day - 2, day: w.day, target: null } };
        if (f.conscienceCheck('hunt', null, 'press').verdict === 'DEFY') { defys++; if (c.whitebear) bears++; }
    }
    assert.ok(defys >= 5, `the probe is live (${defys} DEFYs found)`);
    assert.equal(bears, 0, 'a faint thought torn out is just gone - no echo');
    ok('white-bear: only substantial thoughts echo (min-weight gate)');
}

console.log(`inspiration: ${passed} checks passed`);
