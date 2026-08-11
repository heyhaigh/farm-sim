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

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// The client refuses to call at all unless it believes an endpoint exists.
process.env.OPENAI_BASE_URL = 'http://127.0.0.1:9/v1';

// Chat is browser-only: World.#initLlmChat bails unless `window` exists, and it resolves in the
// CONSTRUCTOR — so this has to be defined before boot() or chat is disabled for the whole run.
// That is exactly how chat fell out of the matrix when capture replaced the hand-written fixtures
// (Codex #109 P1-1): the capture silently produced nine shapes instead of ten.
globalThis.window = globalThis.window || { localStorage: { getItem: () => null } };
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
    try {
        await fn();
        // Some entry points are fire-and-forget (World.tryLlmChat kicks off #runLlmChat without
        // awaiting it), so returning from fn() does not mean the request has been issued yet.
        await new Promise(r => setTimeout(r, 60));
    } catch (err) { console.log(`  ${label.padEnd(14)} threw: ${String(err?.message || err).slice(0, 70)}`); }
    const n = captured.length - before;
    console.log(`  ${label.padEnd(14)} ${n} request(s)${n ? '' : '  <-- captured NOTHING'}`);
    currentLabel = null;
}

const w = boot();
// Tick to a PLAYED town, not a founding one (Codex #110 P2-3). 600 ticks is twenty sim-seconds: the
// cast is still in `assemble`, so the captured chat context had zero opinions, no journal, no
// trusts, no rumours and a null vivid memory — structurally real, socially empty, and the rich
// payload was the entire reason for capturing rather than writing it.
//
// A day is DAY_LENGTH + NIGHT_LENGTH; four days at the suite's own dt gives farmers work, meals,
// arguments and memories of each other. Slower to run, and the only way the serialiser has anything
// to serialise.
const DT = 1 / 30;

const { whisper } = await import('../conscience.js');
const { requestCongregation, requestElectionScene } = await import('../congregation.js');
const { requestRaidCouncil, requestRaidDebrief, requestDuelBeat } = await import('../raidcouncil.js');
const { enrichStories } = await import('../dm.js');
const { enrichInventions } = await import('../memory-invent.js');

console.log('\ncapture-payloads — driving the real client entry points\n');

// FOUNDING-ONLY shapes first: the gathering is a day-one event, and ticking to a played town (which
// chat needs) moves past it — capturing congregation after the ticks silently lost it entirely.
await capture('congregation', () => requestCongregation(w));

// Then play the town. Organic traffic during these ticks is labelled, because a chat the SIM
// decided to have is more faithful than one this harness triggers: real participants, real reason.
currentLabel = 'chat-natural';
const targetDay = w.day + 4;
while (w.day < targetDay) w.tick(DT);
currentLabel = null;

await capture('whisper', () => whisper(w, w.farmers[0], 'go and get some rest', () => {}));
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
// Shape copied from main.js:8145 — the totals live under `outcome`, and requestRaidDebrief reads
// battle.outcome.felled / .n / .harvestLost. The first version put them at the TOP LEVEL, so the
// captured prompt carried undefined totals, a generic "a warband", and no nemesis (Codex #109 P1-2).
// Third time a hand-written state shape has been wrong; copy it from the code that builds it.
await capture('raiddebrief', () => requestRaidDebrief(w, {
    rid: 'probe-raid-1', day: w.day, year: w.year,
    clan: 'the Ashmark band',
    nemesis: { name: 'Skarn the Unbroken', raidCount: 2, sworeAgainst: w.farmers[0].sheet.name.split(' ')[0] },
    outcome: { felled: 3, n: 5, harvestLost: 2 },
    hero: w.farmers[0].sheet.name.split(' ')[0],
    wounded: [w.farmers[1].sheet.name.split(' ')[0]],
    rounds: [{ who: w.farmers[0].sheet.name.split(' ')[0], text: 'held the line at the gate' }],
}));
await capture('duel', () => requestDuelBeat(w));
// CHAT — dropped from the matrix when capture replaced the hand-written fixtures, which silently
// removed the one shape whose budget had to be raised to 600 (Codex #109 P1-1). Driven through the
// public World.tryLlmChat(), with the ctx the sim passes at farm.js:11724.
await capture('chat', () => {
    const [speaker, listener] = w.farmers;
    const op = speaker.opinionOf(listener), rop = listener.opinionOf(speaker);
    return w.tryLlmChat(speaker, listener, {
        op, rop, grudge: null, vivid: null,
        fallback: { speakerLine: 'That fence needs seeing to.', listenerLine: 'It can wait a day.' },
    });
});

await capture('invent', () => enrichInventions(w, () => true));

// --check (Codex #109): re-capture and compare against the committed artifact instead of writing.
// Without this, "the fixtures cannot drift" is a claim rather than a guarantee — a client payload
// could change and payloads.json would quietly go stale while the probe kept reporting green.
const CHECK = process.argv.includes('--check');

// A capture that is structurally complete but socially empty is the failure this file exists to
// prevent, and it is invisible in a request count. Assert the richness, so a thin capture cannot
// pass quietly the way the first chat capture did.
{
    // Both an organic chat (the sim chose it) and a triggered one are captured. Use the RICHEST:
    // the organic one fires early in the tick loop and so carries less history, and for validating
    // a token budget the largest realistic payload is the conservative choice.
    const chats = captured.filter(c => c.endpoint.includes('chat'));
    const chat = chats.sort((a, b) => JSON.stringify(b.body).length - JSON.stringify(a.body).length)[0];
    if (chat) {
        const sp = chat.body?.context?.speaker || {};
        const social = (sp.strongestSharedMemories?.length || 0) + (sp.recentMemories?.length || 0)
            + (sp.trusts?.length || 0) + (sp.wary?.length || 0) + Math.abs(sp.opinionOfOther || 0);
        console.log(`\n  chat social state: memories ${(sp.recentMemories || []).length}, `
            + `trusts ${(sp.trusts || []).length}, opinion ${sp.opinionOfOther}, state "${sp.state}"`);
        if (!social) {
            console.error('\n  chat context is SOCIALLY EMPTY — the town has not been played long enough.');
            console.error('  Increase the tick target; a payload with no memories or opinions measures the');
            console.error('  serialiser, not the prompt production actually sends.');
            process.exit(1);
        }
    }
}

const out = join(ROOT, 'tools', 'payloads.json');
const built = JSON.stringify({
    capturedAt: 'deterministic seed 20260706, 600 ticks',
    note: 'Generated by tools/capture-payloads.mjs. Do NOT hand-edit — regenerate instead. These are '
        + 'the bodies the CLIENT actually posts; hand-written approximations of them were a P1 finding '
        + 'in four consecutive reviews.',
    requests: captured,
}, null, 2);

if (CHECK) {
    let existing = null;
    try { existing = readFileSync(out, 'utf8'); } catch { /* missing */ }
    if (existing === built) {
        console.log(`\ntools/payloads.json is CURRENT (${captured.length} requests).`);
        process.exit(0);
    }
    console.error(`\ntools/payloads.json is STALE — a client payload has changed since it was captured.`);
    console.error(`Re-run without --check to regenerate, then re-run the probe: the matrix is measuring old bodies.`);
    process.exit(1);
}

writeFileSync(out, built);
console.log(`\n${captured.length} request(s) captured -> tools/payloads.json`);
if (!captured.length) {
    console.log('Nothing captured — the client entry points did not fire. The probe cannot use this.');
    process.exit(1);
}
for (const c of captured) {
    console.log(`  ${String(c.label).padEnd(14)} ${c.endpoint.replace('/api/ry-farms-', '').padEnd(14)} ${JSON.stringify(c.body).length} chars`);
}
