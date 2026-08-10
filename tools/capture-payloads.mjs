// tools/capture-payloads.mjs — record the request bodies the CLIENT actually sends.
//
// WHY THIS EXISTS. Fixture fidelity has now been a P1 finding three rounds running (#105 P2-6,
// #106 P1-1, #107 P1-2, #108 P1-1), and each time the answer was "write a better fixture". It never
// converged, because a hand-written body is a guess about code that is right there:
//
//   * the reply fixture carried 4 character fields; conscience.js sends ~20 plus journal and
//     relationships — 349 characters against roughly 1,531
//   * `foe` was an object where the handler does String(body.foe), so a prompt read "[object Object]"
//   * chat sent `shortName`/`trade`/nested personality; production sends `archetype`, `creed`,
//     `goal`, `mood`, `temper`
//   * founding sent `dream` as an object where production sends a string
//   * election omitted `standingFor`, the field its own prompt tells candidates to speak to
//
// So stop guessing. Every client entry point is exported: whisper(), requestCongregation(),
// requestElectionScene(), requestRaidCouncil(), requestRaidDebrief(), requestDuelBeat(),
// enrichStories(), enrichInventions(). Drive them against a REAL generated world with `fetch`
// stubbed to record, and the captured bodies ARE production by construction — they cannot drift,
// because nobody typed them.
//
// Writes tools/payloads.json, which tools/probe-endpoints.mjs consumes as its fixtures.
//
//   node tools/capture-payloads.mjs
//
// Makes NO network calls and needs no API key: the stub answers every request locally.

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// The client refuses to call at all unless it believes an endpoint exists.
process.env.OPENAI_BASE_URL = 'http://127.0.0.1:9/v1';
delete process.env.RY_FARMS_LLM_OFF;

const { World } = await import('../farm.js');
const { generateCrew, hashString } = await import('../dna.js');

// Same founding recipe the determinism suite uses, so the cast is real and reproducible.
function boot(seed = 20260706, culture = 'human') {
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

const captured = [];
let currentLabel = null;

// Record and answer locally. The reply shape only has to be plausible enough that the client does
// not treat it as a failure and stop early — we are collecting REQUESTS, not testing responses.
function installCapture() {
    globalThis.fetch = async (url, opts = {}) => {
        const endpoint = String(url);
        let body = null;
        try { body = JSON.parse(opts.body || 'null'); } catch { /* non-JSON */ }
        if (body) captured.push({ label: currentLabel, endpoint, body });
        const payload = plausibleFor(endpoint, body);
        return {
            ok: true, status: 200,
            text: async () => JSON.stringify(payload),
            json: async () => payload,
        };
    };
}

function plausibleFor(endpoint, body) {
    if (endpoint.includes('conscience')) {
        return body?.stage === 'classify'
            ? { kind: 'rest', target: '', tone: 'suggest' }
            : { line: 'Aye, in a moment.', verdict: 'HEED' };
    }
    if (endpoint.includes('dm')) {
        const seeds = (body?.characters || []).map(c => c.seed);
        return { tales: seeds.map(seed => ({ seed, tale: 'x'.repeat(420) })) };
    }
    if (endpoint.includes('invent')) return { name: 'LUCK-KNOT', lore: 'A knot of river-reed and ash.' };
    if (endpoint.includes('chat')) {
        return { speakerLine: 'Hex, that fence needs seeing to.', listenerLine: 'It can wait a day.',
                 speakerTone: 'wry', listenerTone: 'flat', memory: 'they argued about the fence',
                 relationshipDelta: 0.01, relationshipReason: 'a shared complaint' };
    }
    // congregation / raid-council both return a script of turns
    const names = (body?.founders || body?.cast || body?.candidates || []).map(f => f.name || f);
    const who = names.length ? names : ['Grull', 'Hex'];
    return {
        script: who.slice(0, 4).map((n, i) => ({ who: n, line: `A line from ${n}.`, beat: i })),
        mutters: who.slice(0, 3).map(n => `${n} mutters something.`),
        beat: { who: who[0], line: 'They strike, and it lands.' },
    };
}

installCapture();

// --- drive every client entry point ---------------------------------------------------------
async function capture(label, fn) {
    currentLabel = label;
    const before = captured.length;
    try { await fn(); } catch (err) { console.log(`  ${label.padEnd(14)} threw: ${String(err?.message || err).slice(0, 70)}`); }
    const n = captured.length - before;
    console.log(`  ${label.padEnd(14)} ${n} request(s)${n ? '' : '  <-- captured NOTHING'}`);
    currentLabel = null;
}

const w = boot();
// A few ticks so farmers have journals, opinions and state — a day-zero cast serializes thinner
// than a played one, and thinner fixtures are the whole problem this file exists to end.
for (let i = 0; i < 600; i++) w.tick(1 / 30);

const { whisper } = await import('../conscience.js');
const { requestCongregation, requestElectionScene } = await import('../congregation.js');
const { requestRaidCouncil, requestRaidDebrief, requestDuelBeat } = await import('../raidcouncil.js');
const { enrichStories } = await import('../dm.js');
const { enrichInventions } = await import('../memory-invent.js');

console.log('\ncapture-payloads — driving the real client entry points\n');

// NATURAL state first: congregating() reports differently once roles.foundingPhase is imposed
// below, so these must run before the setup or the founding scene never fires.
await capture('whisper', () => whisper(w, w.farmers[0], 'go and get some rest', () => {}));
await capture('congregation', () => requestCongregation(w));
await capture('dm', () => enrichStories(w, () => true));

// Four paths guard on state a 600-tick day-one town does not have yet. Rather than hand-write
// those bodies — the very failure this file exists to end — set up the STATE the client checks and
// let it build the payload itself. Each field below is read straight from the guard it satisfies.
//
// raid counsel + duel beat: `world.pendingRaid` with a foe (raidcouncil.js:30, :129)
// Shape taken from farm.js:2028 — `foe` is an OBJECT and `sworeAgainst` is a farmer SEED, not a
// name. The first version made it a string, so requestDuelBeat read `pr.e.foe.name` as undefined
// and posted a 101-character body the handler rightly rejected with "no named foe".
//
// The lesson underneath: capturing the payload is worth nothing if the STATE it is built from is
// fabricated. Copy the shape from the code that creates it, not from memory.
w.pendingRaid = {
    landsAt: w.day + 1,
    dirName: 'the northern pines',
    e: { id: 'probe-raid-1', pairKey: 'probe', ordinal: 2, by: 'raiders', n: 5,
         foe: { name: 'Skarn the Unbroken', raidCount: 2, sworeAgainst: w.farmers[0].sheet.seed } },
};
// election: foundingPhase 'gathering' + at least two slates (congregation.js:38, :45)
w.roles = w.roles || {};
w.roles.foundingPhase = 'gathering';
if (typeof w.electionSlates !== 'function') {
    w.electionSlates = () => w.farmers.slice(0, 3).map(f => ({
        who: f, name: f.sheet.name, standingFor: 'the watch rota', votes: 0,
    }));
}
// invention naming: one un-flavoured recipe (memory-invent.js:22, :26)
// `w.recipes` already exists (empty), so a `||` default never fired — inject into it.
w.recipes = w.recipes || {};
w.recipes.probe1 = { id: 'probe1', name: 'ROUGH LUCK-KNOT', effect: 'charm', tier: 2, quality: 3,
                     dominant: 'ember', inputs: { riverstone: 1, emberleaf: 2, hide: 1 } };
w.recipeFlavor = {};


await capture('election', () => requestElectionScene(w));
await capture('raidcouncil', () => requestRaidCouncil(w));
await capture('raiddebrief', () => requestRaidDebrief(w, { felled: 3, n: 5, harvestLost: 2, hero: 'Grull', wounded: ['Hex'] }));
await capture('duel', () => requestDuelBeat(w));
await capture('invent', () => enrichInventions(w, () => true));

const out = join(ROOT, 'tools', 'payloads.json');
writeFileSync(out, JSON.stringify({
    capturedAt: 'deterministic seed 20260706, 600 ticks',
    note: 'Generated by tools/capture-payloads.mjs. Do NOT hand-edit — regenerate instead. These are '
        + 'the bodies the CLIENT actually posts; hand-written approximations of them were a P1 finding '
        + 'in four consecutive reviews.',
    requests: captured,
}, null, 2));

console.log(`\n${captured.length} request(s) captured -> tools/payloads.json`);
if (!captured.length) {
    console.log('Nothing captured — the client entry points did not fire. The probe cannot use this.');
    process.exit(1);
}
for (const c of captured) {
    console.log(`  ${String(c.label).padEnd(14)} ${c.endpoint.replace('/api/ry-farms-', '').padEnd(14)} ${JSON.stringify(c.body).length} chars`);
}
