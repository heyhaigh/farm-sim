// tests/whisper-diag.mjs — the client-side whisper diagnostic (#whisperdiag).
//
// This buffer exists because the server telemetry could not answer a production question: classify
// and reply were each recording attempts the other did not, and every candidate cause — a timeout,
// an abort, a non-200, a fallback:true body, or a client-side THROW between the stages — died in the
// same silent catch and read as identical offline text. The first probe of this file promptly proved
// the last class is real: a farmer stub missing allRegard() made characterView throw, and the reply
// stage failed BEFORE its fetch was ever built. Without the diagnostic that is invisible; with it,
// the entry names the function.
//
// Cases drive the real whisper() entry point, not the helpers — a mistake at the call site is the
// thing half this project's vacuous tests could not see.

import assert from 'node:assert';

let passes = 0, failures = 0;
async function check(name, fn) {
    try { await fn(); console.log(`  PASS  ${name}`); passes++; }
    catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failures++; }
}

// localStorage fake — persistence is the point, so it must actually retain
const store = {};
globalThis.localStorage = {
    getItem: (k) => store[k] ?? null,
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
};

const { whisper, whisperLog } = await import('../conscience.js');

const diag = () => JSON.parse(store['ryfarms-whisper-diag'] || '[]');

// A farmer complete enough that characterView/snapshotOf succeed — mirroring the REAL producer, so
// a reply failure in these cases is the transport's fault and only the transport's.
// Every field below is one characterView() or snapshotOf() actually READS — built from the source,
// not from memory of it. The first version of this fixture was written from memory, and its missing
// `journal` made every reply record OFFLINE with "reading 'filter'", so three cases failed for a
// reason that had nothing to do with what they tested. The same mistake this fixture exists to catch.
function farmer(w) {
    const f = {
        conscience: { log: [], pressure: {}, asks: {}, stance: 'open' },
        conscienceCheck: () => ({ verdict: 'DISMISS' }),
        allRegard: () => [],
        journal: [],
        creeds: [],
        p: null,
        world: w,
        plot: null,
        sheet: {
            name: 'Warden Test', seed: 1, stats: { str: 10, wis: 10 }, archetype: 'builder',
            personality: { label: 'steady', creed: 'the valley keeps' },
            memory: { title: 'a life before' }, story: {}, dream: { yearn: 'a good harvest' },
        },
        mood: 0, energy: 0.5, hp: 1, health: 'well', level: 1, state: 'work', thought: 'the fence again',
    };
    return f;
}
function world() {
    const w = { farmers: [], day: 1, seasonName: 'SPRING', year: 1, weather: 'sun', culture: 'human' };
    w.farmers.push(farmer(w));
    return w;
}

console.log('\n#whisper-diag — every stage outcome is recorded with its reason\n');

await check('a healthy round records llm for BOTH stages', async () => {
    whisperLog.clear();
    globalThis.fetch = async (_u, opts) => {
        const stage = JSON.parse(opts.body).stage;
        return { ok: true, status: 200, json: async () => (stage === 'classify'
            ? { kind: 'rest', target: '', tone: 'suggest' }
            : { line: 'I will rest when the work is done.', verdict: 'DISMISS' }) };
    };
    const w = world();
    await whisper(w, w.farmers[0], 'go get some rest', null);
    assert.deepStrictEqual(diag().map(e => `${e.stage}:${e.ok}`), ['classify:true', 'reply:true'],
        `got ${JSON.stringify(diag())}`);
});

await check('a fallback:true body is recorded as OFFLINE with the server reason', async () => {
    // postJson treats fallback:true as a throw — indistinguishable from a network error to the
    // player, which is exactly why the reason must be kept.
    whisperLog.clear();
    globalThis.fetch = async (_u, opts) => {
        const stage = JSON.parse(opts.body).stage;
        if (stage === 'reply') return { ok: true, status: 200, json: async () => ({ fallback: true, error: 'LLM disabled: budget exceeded' }) };
        return { ok: true, status: 200, json: async () => ({ kind: 'rest', target: '', tone: 'suggest' }) };
    };
    const w = world();
    await whisper(w, w.farmers[0], 'go get some rest', null);
    const entries = diag();
    assert.strictEqual(entries.find(e => e.stage === 'reply')?.ok, false);
    assert.match(entries.find(e => e.stage === 'reply')?.detail || '', /budget exceeded/,
        'the server-provided reason should survive into the record');
});

await check('a transport failure on classify does not mask a healthy reply', async () => {
    // The independent-stages case from production: classify can fail while reply succeeds.
    whisperLog.clear();
    globalThis.fetch = async (_u, opts) => {
        const stage = JSON.parse(opts.body).stage;
        if (stage === 'classify') return { ok: false, status: 502, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => ({ line: 'Aye.', verdict: 'DISMISS' }) };
    };
    const w = world();
    await whisper(w, w.farmers[0], 'go get some rest', null);
    assert.deepStrictEqual(diag().map(e => `${e.stage}:${e.ok}`), ['classify:false', 'reply:true'],
        `got ${JSON.stringify(diag())}`);
    assert.match(diag()[0].detail, /502/, 'the status should be in the record');
});

await check('a client-side THROW between the stages is recorded, with the throwing name', async () => {
    // The class the first probe of this file found in the wild: the reply try-block wraps
    // characterView/snapshotOf, so a broken farmer fails BEFORE the fetch — invisible to the server.
    whisperLog.clear();
    globalThis.fetch = async (_u, opts) => ({ ok: true, status: 200, json: async () => ({ kind: 'rest', target: '', tone: 'suggest' }) });
    const w = world();
    w.farmers[0].allRegard = undefined;   // the exact real-world shape the probe found
    await whisper(w, w.farmers[0], 'go get some rest', null);
    const reply = diag().find(e => e.stage === 'reply');
    assert.strictEqual(reply?.ok, false);
    assert.match(reply?.detail || '', /allRegard/, `the record should name the throw: ${reply?.detail}`);
});

await check('the buffer caps rather than growing without bound', async () => {
    whisperLog.clear();
    globalThis.fetch = async () => { throw new Error('down'); };
    const w = world();
    for (let i = 0; i < 70; i++) await whisper(w, w.farmers[0], 'rest', null);   // 2 entries each
    assert.ok(diag().length <= 120, `${diag().length} entries — the ring is not capping`);
});

await check('diagnostics failing never breaks the whisper itself', async () => {
    globalThis.localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
    globalThis.fetch = async () => { throw new Error('down'); };
    const w = world();
    const out = await whisper(w, w.farmers[0], 'go get some rest', null);
    assert.ok(out?.reply, 'the whisper must still answer when localStorage is unavailable');
    globalThis.localStorage.setItem = (k, v) => { store[k] = String(v); };
});

console.log(`\n${passes} passed, ${failures} failed`);
if (failures) { console.log('The whisper diagnostic cannot be trusted to explain a fallback.'); process.exit(1); }
console.log('Whisper diag: both stages recorded, reasons kept, ring capped, never load-bearing.');
process.exit(0);
