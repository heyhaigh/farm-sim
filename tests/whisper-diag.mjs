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
    // clock + isNight mirror the real World (snapshotOf reads them for the time-of-day field —
    // the owner-found "quiet night at 56 AFTERNOON" fix); a fake without them throws the exact
    // producer-drift TypeError this suite exists to catch.
    const w = { farmers: [], day: 1, seasonName: 'SPRING', year: 1, weather: 'sun', culture: 'human', clock: 150, isNight: () => false };
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

await check('a fallback:true body is recorded as OFFLINE with the reason CATEGORY', async () => {
    // postJson treats fallback:true as a throw — indistinguishable from a network error to the
    // player, which is exactly why the reason must be kept. As a CATEGORY, not the raw string: the
    // first version of this case asserted the server's literal words survived, which is the exact
    // behaviour Codex #120 P2 required removing — the buffer is exportable, so free text is matched
    // into an allow-listed bucket and never quoted.
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
    assert.strictEqual(entries.find(e => e.stage === 'reply')?.detail, 'fallback: budget',
        `the reason category should survive, got: ${entries.find(e => e.stage === 'reply')?.detail}`);
    assert.ok(!/exceeded/.test(JSON.stringify(entries)), 'the raw server string must not be quoted');
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
    // EXACT form, and it is the CLASS ALONE now. Identifier extraction was deleted in #120 r3 —
    // its third redaction hole in three rounds (new TypeError('MARKER is not a function') carried
    // the marker verbatim, because an identifier pattern applied to free text IS free text). The
    // class still answers the diagnostic question: code bug, not transport.
    assert.strictEqual(reply?.detail, 'client-throw: TypeError',
        `the record should be the bare allow-listed class, got: ${reply?.detail}`);
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

await check('an HTTP 200 with the WRONG SHAPE is recorded OFFLINE, not llm (Codex #120)', async () => {
    // The instrument affirming the boundary it exists to expose: reply returned 200 `{}`, whisper
    // produced no LLM line, and the diagnostic said `reply 1/1 llm`. Shape is validated before
    // success now, on both stages.
    whisperLog.clear();
    globalThis.fetch = async (_u, opts) => ({ ok: true, status: 200, json: async () => ({}) });
    const w = world();
    const out = await whisper(w, w.farmers[0], 'go get some rest', null);
    assert.ok(out?.reply, 'the whisper must still answer via the offline path');
    assert.deepStrictEqual(diag().map(e => `${e.stage}:${e.ok}`), ['classify:false', 'reply:false'],
        `a malformed 200 was recorded as llm: ${JSON.stringify(diag())}`);
    assert.ok(diag().every(e => /malformed (classify|reply) response/.test(e.detail)),
        `the record should say WHY: ${JSON.stringify(diag().map(e => e.detail))}`);
});

await check('player-adjacent text in an error NEVER reaches the exportable buffer (Codex #120)', async () => {
    // .copy() is an export by design — the documented workflow ends with the player pasting the
    // buffer. So the reason is categorised, never quoted: Codex reproduced a fallback error carrying
    // player-like text being retained verbatim, and server parse errors can quote model output,
    // which is prompt-derived.
    whisperLog.clear();
    globalThis.fetch = async (_u, opts) => {
        const stage = JSON.parse(opts.body).stage;
        if (stage === 'classify') return { ok: true, status: 200, json: async () => ({ kind: 'rest', target: '', tone: 'suggest' }) };
        return { ok: true, status: 200, json: async () => ({ fallback: true, error: 'PLAYER PRIVATE WHISPER: visit my neighbour' }) };
    };
    const w = world();
    await whisper(w, w.farmers[0], 'go get some rest', null);
    const dump = JSON.stringify(diag());
    assert.ok(!/PLAYER PRIVATE|neighbour/.test(dump), `free text survived into the export: ${dump}`);
    const reply = diag().find(e => e.stage === 'reply');
    assert.strictEqual(reply?.ok, false);
    assert.match(reply?.detail || '', /^(fallback: |client-throw: |http |timeout )/,
        `the reason must be a category, got: ${reply?.detail}`);
});

await check('a BRANCH-RICH farmer still classifies as llm on both stages (producer drift guard)', async () => {
    // Codex #120: the base fixture leaves plot null and traits/creeds/journal/regards empty, so the
    // branchy halves of characterView never run and drift there would silently re-vacate the throw
    // case. One populated farmer exercises every conditional read.
    whisperLog.clear();
    globalThis.fetch = async (_u, opts) => {
        const stage = JSON.parse(opts.body).stage;
        return { ok: true, status: 200, json: async () => (stage === 'classify'
            ? { kind: 'rest', target: '', tone: 'suggest' }
            : { line: 'Aye, when the row is done.', verdict: 'DISMISS' }) };
    };
    const w = world();
    const f = w.farmers[0];
    const other = farmer(w); other.sheet.name = 'Cricket Kettle'; w.farmers.push(other);
    f.plot = { built: { fence: true } };
    f.specialty = () => 'root vegetables';
    f.p = { collaboration: 0.8, competitiveness: 0.2, honesty: 0.9, diligence: 0.7, volatility: 0.1, curiosity: 0.6 };
    f.creeds = [{ quote: 'the valley keeps those who keep it', overwritten: false }];
    f.journal = [{ strength: 0.9, text: 'the storm took the north fence' }];
    f.allRegard = (sign) => (sign > 0 ? [{ who: other }] : []);
    f.goal = 'a bigger barn';
    await whisper(w, f, 'go get some rest', null);
    assert.deepStrictEqual(diag().map(e => `${e.stage}:${e.ok}`), ['classify:true', 'reply:true'],
        `a populated farmer broke a producer read: ${JSON.stringify(diag())}`);
});

await check('a kind OUTSIDE the protocol is a failed stage, not an LLM success (Codex #120 r2)', async () => {
    // {kind:'bogus-kind'} passed the strings-only check, was recorded llm, rode into
    // conscienceCheck, and came back out of whisper(). The enums are the contract.
    whisperLog.clear();
    globalThis.fetch = async (_u, opts) => {
        const stage = JSON.parse(opts.body).stage;
        if (stage === 'classify') return { ok: true, status: 200, json: async () => ({ kind: 'bogus-kind', target: {}, tone: 'bogus-tone' }) };
        return { ok: true, status: 200, json: async () => ({ line: 'Aye.', verdict: 'DISMISS' }) };
    };
    const w = world();
    const out = await whisper(w, w.farmers[0], 'go get some rest', null);
    assert.notStrictEqual(out?.kind, 'bogus-kind', 'an out-of-protocol kind escaped whisper()');
    const cls = diag().find(e => e.stage === 'classify');
    assert.strictEqual(cls?.ok, false, `recorded llm for an out-of-protocol kind: ${JSON.stringify(cls)}`);
    assert.strictEqual(cls?.detail, 'malformed classify response');
});

await check('a custom Error.name cannot ride into the export (Codex #120 r2)', async () => {
    // Error.name is mutable free text. An error named PLAYER_PRIVATE_WHISPER interpolated straight
    // past the redaction; only engine classes pass now, everything else collapses to unknown.
    whisperLog.clear();
    globalThis.fetch = async (_u, opts) => {
        const stage = JSON.parse(opts.body).stage;
        if (stage === 'classify') return { ok: true, status: 200, json: async () => ({ kind: 'rest', target: '', tone: 'suggest' }) };
        const e = new Error('boom'); e.name = 'PLAYER_PRIVATE_WHISPER: visit my neighbour';
        throw e;
    };
    const w = world();
    await whisper(w, w.farmers[0], 'go get some rest', null);
    const dump = JSON.stringify(diag());
    assert.ok(!/PLAYER_PRIVATE|neighbour/.test(dump), `a custom error name reached the export: ${dump}`);
});

await check('"model generated empty reply" is bad-output, not throttled (Codex #120 r2)', async () => {
    // 'rate' as a bare substring matched 'geneRATEd' — the same substring disease as the
    // server-side 'schema' gate, found by the same reviewer on the same day.
    whisperLog.clear();
    globalThis.fetch = async (_u, opts) => {
        const stage = JSON.parse(opts.body).stage;
        if (stage === 'classify') return { ok: true, status: 200, json: async () => ({ kind: 'rest', target: '', tone: 'suggest' }) };
        return { ok: true, status: 200, json: async () => ({ fallback: true, error: 'model generated empty reply' }) };
    };
    const w = world();
    await whisper(w, w.farmers[0], 'go get some rest', null);
    const reply = diag().find(e => e.stage === 'reply');
    assert.strictEqual(reply?.detail, 'fallback: bad-output',
        `misfiled: ${reply?.detail}`);
    // and a REAL throttle must still file as throttled, or the fix is "never say throttled"
    whisperLog.clear();
    globalThis.fetch = async (_u, opts) => {
        const stage = JSON.parse(opts.body).stage;
        if (stage === 'classify') return { ok: true, status: 200, json: async () => ({ kind: 'rest', target: '', tone: 'suggest' }) };
        return { ok: true, status: 200, json: async () => ({ fallback: true, error: 'rate limit reached, retry shortly' }) };
    };
    const w2 = world();
    await whisper(w2, w2.farmers[0], 'go get some rest', null);
    assert.strictEqual(diag().find(e => e.stage === 'reply')?.detail, 'fallback: throttled');
});

await check('a marker INSIDE an engine-class message cannot ride the export (Codex #120 r3)', async () => {
    // The third door: Error.name was allow-listed, but the identifier patterns read err.message —
    // free text — so a crafted TypeError message carried its marker through the extraction.
    whisperLog.clear();
    globalThis.fetch = async (_u, opts) => {
        const stage = JSON.parse(opts.body).stage;
        if (stage === 'classify') return { ok: true, status: 200, json: async () => ({ kind: 'rest', target: '', tone: 'suggest' }) };
        throw new TypeError('PLAYER_PRIVATE_WHISPER is not a function');
    };
    const w = world();
    await whisper(w, w.farmers[0], 'go get some rest', null);
    const dump = JSON.stringify(diag());
    assert.ok(!/PLAYER_PRIVATE/.test(dump), `message content reached the export: ${dump}`);
    assert.strictEqual(diag().find(e => e.stage === 'reply')?.detail, 'client-throw: TypeError');
});

await check('{kind} alone is NOT an LLM success — all three protocol fields required (Codex #120 r3)', async () => {
    // The != null guards accepted a missing target/tone and defaulted them downstream. The real
    // producer always returns all three, so requiring them rejects nothing the server sends.
    whisperLog.clear();
    globalThis.fetch = async (_u, opts) => {
        const stage = JSON.parse(opts.body).stage;
        if (stage === 'classify') return { ok: true, status: 200, json: async () => ({ kind: 'rest' }) };
        return { ok: true, status: 200, json: async () => ({ line: 'Aye.', verdict: 'DISMISS' }) };
    };
    const w = world();
    await whisper(w, w.farmers[0], 'go get some rest', null);
    const cls = diag().find(e => e.stage === 'classify');
    assert.strictEqual(cls?.ok, false, `a partial protocol object was recorded llm: ${JSON.stringify(cls)}`);
});

await check('target semantics are the contract — not just its type (Codex #120 r4)', async () => {
    // The producer can only return a cast name on visit and '' otherwise; anything else is a
    // response the server cannot produce. Both directions, plus the valid visit — or the fix could
    // pass by rejecting every visit outright.
    const cases = [
        [{ kind: 'visit', target: 'PLAYER_PRIVATE_WHISPER', tone: 'suggest' }, false, 'unknown visit target'],
        [{ kind: 'rest', target: 'Cricket', tone: 'suggest' }, false, 'target on a non-visit'],
        [{ kind: 'visit', target: 'Cricket', tone: 'suggest' }, true, 'a REAL cast member'],
    ];
    for (const [resp, wantOk, label] of cases) {
        whisperLog.clear();
        globalThis.fetch = async (_u, opts) => {
            const stage = JSON.parse(opts.body).stage;
            if (stage === 'classify') return { ok: true, status: 200, json: async () => resp };
            return { ok: true, status: 200, json: async () => ({ line: 'Aye.', verdict: 'DISMISS' }) };
        };
        const w = world();
        const other = farmer(w); other.sheet.name = 'Cricket Kettle'; w.farmers.push(other);
        const out = await whisper(w, w.farmers[0], 'go see cricket', null);
        const cls = diag().find(e => e.stage === 'classify');
        assert.strictEqual(cls?.ok, wantOk, `${label}: recorded ${cls?.ok}, wanted ${wantOk}`);
        if (!wantOk) assert.ok(!/PLAYER_PRIVATE/.test(JSON.stringify(out)),
            `an invalid target escaped whisper(): ${JSON.stringify(out).slice(0, 120)}`);
    }
});

console.log(`\n${passes} passed, ${failures} failed`);
if (failures) { console.log('The whisper diagnostic cannot be trusted to explain a fallback.'); process.exit(1); }
console.log('Whisper diag: both stages recorded, reasons kept, ring capped, never load-bearing.');
process.exit(0);
