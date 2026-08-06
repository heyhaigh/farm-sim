// tests/whisper-telemetry.mjs — the whisper hit/fallback channel.
//
// Codex #99 P1-1 noted this boundary had NO coverage. Codex #100 P2-2 then noted that the coverage
// I wrote was half implementation-COPY: it recomputed the overall-rate formula and re-declared the
// reason ladder locally, so mutating either production implementation left the suite green. A test
// that reimplements the thing it is testing proves only that the test can do arithmetic.
//
// Everything here now runs the REAL module (`api/_whisper-telemetry.js`) or the REAL server.
//
// Three defects are pinned, and the first two are OPPOSITE errors made one round apart:
//
//   1. UNDER-COUNTING — server.mjs's per-IP limiter rejects before the conscience handler runs, so
//      throttled whispers were missing from the denominator entirely.
//   2. CONTAMINATION — the fix recorded on ALL SIX LLM routes, so throttled chat, DM, congregation,
//      raid-council and invention traffic counted as whisper failures.
//   3. RECORDED BUT NEVER EMITTED — the fix bumped counters on globalThis and never ran the
//      throttled logger. Railway stdout is the ONLY sink, so a burst of throttled whispers followed
//      by quiet or a restart vanished. My own test masked it by reading the global directly.
//
// The lesson: "record it", "record it in the right place", and "make it reach the sink" are three
// separate requirements, and I shipped a fix for each one that missed the next.

import assert from 'node:assert';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

let passes = 0, failures = 0;
function check(name, fn) {
    try { fn(); console.log(`  PASS  ${name}`); passes++; }
    catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failures++; }
}

// Async cases MUST use this. `check` calls fn() without awaiting, so a rejected promise escapes the
// try and the case reports PASS while asserting nothing — a silent false green.
async function checkAsync(name, fn) {
    try { await fn(); console.log(`  PASS  ${name}`); passes++; }
    catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failures++; }
}

const PORT = 8791;
process.argv[2] = String(PORT);
// Keep the LLM fully OFF. Clearing the key alone is not enough — _llm.js also accepts a base URL
// (a local Ollama counts as configured), and the pre-limit requests below would then make real
// model calls: slow, non-hermetic, and billable if that URL ever pointed somewhere remote.
process.env.OPENAI_API_KEY = '';
process.env.OPENAI_BASE_URL = '';
process.env.GROQ_API_KEY = '';

console.log('\n#whisper-telemetry — hit/fallback accounting\n');

// The real recorder, required exactly as production requires it.
const TEL = require('../api/_whisper-telemetry.js');

await import('../server.mjs');
await new Promise(r => setTimeout(r, 250));

function reset() {
    const t = TEL.stats;
    for (const k of ['classify', 'reply', 'unattributed', 'invalid']) { t[k].ok = 0; t[k].fail = 0; }
    for (const k of Object.keys(t.reasons)) delete t.reasons[k];
    t.lastLog = 0;   // 0 = the next note() emits immediately
}
const snap = () => JSON.parse(JSON.stringify(TEL.stats));
const post = (path, body) => fetch(`http://localhost:${PORT}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

// Capture what production actually prints, rather than recomputing it.
function captureLog(fn) {
    const lines = [];
    const real = console.log;
    console.log = (...a) => lines.push(a.join(' '));
    try { fn(); } finally { console.log = real; }
    return lines;
}

async function tripLimiter(path) {
    for (let i = 0; i < 60; i++) {
        const r = await post(path, { stage: 'classify', message: 'x' });
        if (r.status === 503 && String((await r.json()).error || '').includes('rate limited')) return true;
    }
    return false;
}

// --- 0. THE REAL SOCKET, FIRST -----------------------------------------------------------------
// This MUST run before the limiter is tripped. Codex found the null-body crash over real HTTP, and
// a fake req/res could hide a difference in the stream path — but once the per-IP limiter is open
// every later request is rejected before the handler loads, so the same case further down the file
// would pass without ever reaching the code it claims to test. Ordering IS the assertion here.
reset();
const nullBodyRes = await fetch(`http://localhost:${PORT}/api/ry-farms-conscience`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'null',
});
const afterNullBody = snap();

check('a JSON null body over real HTTP is invalid traffic, not a 500', () => {
    assert.notStrictEqual(nullBodyRes.status, 503,
        'the limiter intercepted this — the case never reached the handler and proves nothing');
    assert.notStrictEqual(nullBodyRes.status, 500, 'the handler threw on a parsed-but-not-object body');
    assert.strictEqual(nullBodyRes.status, 400, `expected 400, got ${nullBodyRes.status}`);
    assert.strictEqual(afterNullBody.invalid.fail, 1,
        'a crashing request recorded no telemetry — invisible to the channel built to watch for crashes');
    assert.strictEqual(afterNullBody.unattributed.fail, 0, 'must not count as a genuine attempt');
});

// --- 1. contamination -------------------------------------------------------------------------
reset();
const tripped = await tripLimiter('/api/ry-farms-chat');
const afterChat = snap();

check('the limiter can actually be tripped (guards against a vacuous suite)', () => {
    assert.ok(tripped, 'never reached a rate-limited response — the rest of this file proves nothing');
});

check('a throttled CHAT request does not count as a whisper failure', () => {
    assert.strictEqual(afterChat.unattributed.fail, 0,
        `chat throttling incremented whisper telemetry (${afterChat.unattributed.fail}) — the channel is contaminated`);
    assert.strictEqual(afterChat.classify.fail + afterChat.reply.fail, 0, 'no stage bucket may move');
    assert.deepStrictEqual(afterChat.reasons, {}, `unrelated route wrote a reason: ${JSON.stringify(afterChat.reasons)}`);
});

// --- 2. under-counting AND emission ------------------------------------------------------------
// The limiter is already open, so this conscience request is rejected the same way.
reset();
const consLogs = [];
{
    const real = console.log;
    console.log = (...a) => consLogs.push(a.join(' '));
    try { var consRes = await post('/api/ry-farms-conscience', { stage: 'reply', message: 'x' }); }
    finally { console.log = real; }
}
const afterCons = snap();

check('a throttled WHISPER request is recorded, so the denominator stays honest', () => {
    assert.strictEqual(consRes.status, 503, 'expected the limiter to reject this request');
    assert.strictEqual(afterCons.unattributed.fail, 1,
        'a locally throttled whisper went unrecorded — the hit-rate would overstate itself');
    assert.strictEqual(afterCons.reasons['rate-limited-local'], 1,
        'the rejection must carry its own reason, not hide inside a generic bucket');
});

check('...and it EMITS a telemetry line, because stdout is the only sink there is', () => {
    const line = consLogs.find(l => l.includes('[whisper-telemetry]'));
    assert.ok(line, 'the limiter recorded a failure without emitting anything — invisible in production');
    assert.match(line, /rate-limited-local/, `the emitted line omits the reason: ${line}`);
});

check('the rejection still returns the fallback shape the client already handles', () => {
    assert.strictEqual(consRes.status, 503);
    assert.strictEqual(consRes.headers.get('retry-after'), '600');
});

// --- 3. the REAL formatter --------------------------------------------------------------------
check('the emitted OVERALL rate counts throttled attempts (real formatLine, not a copy)', () => {
    reset();
    const t = TEL.stats;
    t.classify.ok = 9;          // nine clean hits...
    t.unattributed.fail = 1;    // ...and one throttled attempt
    const line = TEL.formatLine();
    assert.match(line, /OVERALL 9\/10 hit \(90%\)/, `overall must dilute with throttled attempts: ${line}`);
    assert.match(line, /classify 9\/9 \(100%\)/, 'the stage view is the misleading one and must still be shown');
});

check('INVALID protocol traffic is excluded from the headline (Codex #100 P2-3)', () => {
    reset();
    const t = TEL.stats;
    t.classify.ok = 9;
    t.invalid.fail = 50;        // scanner noise the shipped client cannot produce
    const line = TEL.formatLine();
    assert.match(line, /OVERALL 9\/9 hit \(100%\)/,
        `malformed traffic dragged the product-health headline down: ${line}`);
    assert.match(line, /invalid 50 \(excluded from OVERALL\)/, 'it must still be visible, just not counted');
});

check('a bad body routes to invalid, a throttled attempt to unattributed (real noteWhisper)', () => {
    reset();
    const emitted = captureLog(() => {
        TEL.noteWhisper('unattributed', false, 'bad-body');      // malformed JSON
        TEL.stats.lastLog = 0;
        TEL.noteWhisper('unattributed', false, 'rate-limited-local');   // a real attempt
    });
    assert.strictEqual(TEL.stats.invalid.fail, 1, 'bad-body must land in invalid');
    assert.strictEqual(TEL.stats.unattributed.fail, 1, 'a throttled attempt must land in unattributed');
    assert.ok(emitted.length >= 1, 'noteWhisper must emit, not just count');
});

check('the log line is THROTTLED — one a minute, not one per whisper', () => {
    reset();
    const emitted = captureLog(() => {
        for (let i = 0; i < 25; i++) TEL.noteWhisper('classify', true);
    });
    assert.strictEqual(emitted.length, 1, `25 attempts produced ${emitted.length} lines — the throttle is not working`);
});

// --- 3b. THE REAL HANDLER --------------------------------------------------------------------
// Codex #101 P2-1. Everything above reaches the server but is rejected by the limiter BEFORE the
// conscience handler loads, so the handler's own ordering was never exercised — and that is where
// the defect was: the unknown-stage branch sat BELOW the environment guards, so on an unconfigured
// deploy `{stage:"bogus"}` was answered "unconfigured" and booked as a genuine attempt.
//
// These call the handler directly. `parseBody` returns `req.body` when it is already an object, so
// no stream mocking is needed.
const handler = require('../api/ry-farms-conscience.js');
function fakeRes() {
    const r = { statusCode: 0, headers: {}, body: null };
    r.setHeader = (k, v) => { r.headers[k] = v; };
    r.end = (s) => { r.body = s; };
    return r;
}
const callHandler = async (body) => {
    const res = fakeRes();
    await handler({ method: 'POST', body }, res);
    return res;
};

await checkAsync('an unknown stage is INVALID traffic, even when the LLM is unconfigured', async () => {
    reset();
    assert.ok(!process.env.OPENAI_API_KEY && !process.env.OPENAI_BASE_URL,
        'precondition: the LLM must be unconfigured, or this cannot reproduce the defect');
    const res = await callHandler({ stage: 'bogus', message: 'x' });
    assert.strictEqual(res.statusCode, 400, `expected a protocol rejection, got ${res.statusCode}`);
    assert.strictEqual(TEL.stats.invalid.fail, 1, 'unknown-stage must land in the invalid bucket');
    assert.strictEqual(TEL.stats.unattributed.fail, 0,
        'unknown-stage was booked as a genuine attempt — it will contaminate OVERALL');
    assert.strictEqual(TEL.stats.reasons['unconfigured'], undefined,
        'protocol noise must not be answered with an LLM-health verdict');
    assert.match(TEL.formatLine(), /OVERALL 0\/0 hit \(n\/a\)/,
        `invalid traffic reached the headline: ${TEL.formatLine()}`);
});

await checkAsync('a VALID stage on an unconfigured deploy still counts as a real attempt', async () => {
    reset();
    const res = await callHandler({ stage: 'reply', message: 'x' });
    assert.strictEqual(res.statusCode, 503, 'a real attempt against a dead LLM is a 503, not a 400');
    assert.strictEqual(TEL.stats.reply.fail, 1, 'it must be booked against the reply stage');
    assert.strictEqual(TEL.stats.invalid.fail, 0, 'a valid stage is never protocol noise');
    assert.strictEqual(TEL.stats.reasons['unconfigured'], 1);
});

await checkAsync('an unreadable body is invalid traffic too', async () => {
    reset();
    const res = fakeRes();
    // no `body` property and no stream -> parseBody rejects
    await handler({ method: 'POST', on: (evt, cb) => { if (evt === 'error') cb(new Error('boom')); } }, res);
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(TEL.stats.invalid.fail, 1, 'bad-body must land in invalid');
    assert.strictEqual(TEL.stats.unattributed.fail, 0);
});

// --- 3c. PARSING IS NOT VALIDATION (Codex #102) ------------------------------------------------
// `JSON.parse` succeeds on 'null', '[]' and '"str"' — none of which are objects. Reading .stage off
// them threw OUTSIDE the parse try/catch, so the request 500'd through server.mjs's own catch and
// telemetry recorded NOTHING: a crash invisible to the channel built to watch for crashes.
for (const [label, raw] of [['null', 'null'], ['array', '[]'], ['string', '"hello"'], ['number', '7']]) {
    await checkAsync(`a JSON ${label} body is invalid traffic, not a crash`, async () => {
        reset();
        const res = fakeRes();
        // parseBody takes the string path when req.body is a string
        await handler({ method: 'POST', body: raw }, res);
        assert.strictEqual(res.statusCode, 400, `expected 400, got ${res.statusCode} (a 500 means it threw)`);
        assert.strictEqual(TEL.stats.invalid.fail, 1, `a JSON ${label} body recorded nothing — invisible failure`);
        assert.strictEqual(TEL.stats.unattributed.fail, 0, 'must not count as a genuine attempt');
    });
}

// --- 3d. AN EMPTY WHISPER IS NOT A WHISPER (Codex #102 P2-2) -----------------------------------
// This one manufactured SUCCESSES: with a configured endpoint, {stage:'reply'} with no message
// spent one of the 26/min shared budget on an empty prompt, returned 200, and incremented reply.ok.
await checkAsync('a missing message is rejected BEFORE the environment checks', async () => {
    reset();
    const res = await callHandler({ stage: 'reply' });
    assert.strictEqual(res.statusCode, 400, `expected 400, got ${res.statusCode}`);
    assert.strictEqual(TEL.stats.invalid.fail, 1, 'an empty whisper must be invalid traffic');
    assert.strictEqual(TEL.stats.reply.fail + TEL.stats.reply.ok, 0, 'it must not touch the reply stage at all');
    assert.strictEqual(TEL.stats.reasons['unconfigured'], undefined,
        'rejected for its own reason, not answered with an LLM-health verdict');
});

for (const [label, message] of [['blank string', '   '], ['a number', 42], ['null', null], ['an object', { a: 1 }]]) {
    await checkAsync(`a message that is ${label} is invalid traffic`, async () => {
        reset();
        const res = await callHandler({ stage: 'classify', message });
        assert.strictEqual(res.statusCode, 400, `expected 400, got ${res.statusCode}`);
        assert.strictEqual(TEL.stats.invalid.fail, 1, `message=${JSON.stringify(message)} was accepted as a real whisper`);
        assert.strictEqual(TEL.stats.classify.ok, 0, 'it must never be booked as a success');
    });
}

await checkAsync('a REAL message still passes validation and reaches the environment checks', async () => {
    reset();
    const res = await callHandler({ stage: 'reply', message: 'go and rest' });
    assert.strictEqual(res.statusCode, 503, 'a genuine whisper against a dead LLM is a 503, not a 400');
    assert.strictEqual(TEL.stats.invalid.fail, 0, 'a real whisper is never invalid traffic');
    assert.strictEqual(TEL.stats.reply.fail, 1, 'and it IS booked as a genuine attempt');
});

// --- 4. the REAL reason ladder ------------------------------------------------------------------
check('bucketReason separates OUR throttling from provider failure (real ladder)', () => {
    // the exact strings _llm.js throws
    assert.strictEqual(TEL.bucketReason('LLM circuit breaker open (recent failures)'), 'breaker-open');
    assert.strictEqual(TEL.bucketReason('LLM budget exceeded (26/60s)'), 'budget-exhausted');
    assert.strictEqual(TEL.bucketReason('LLM off: no key'), 'llm-off');
    assert.strictEqual(TEL.bucketReason('model did not return JSON'), 'bad-output');
    assert.strictEqual(TEL.bucketReason('HTTP 429 Too Many Requests'), 'rate-limit-upstream');
    assert.strictEqual(TEL.bucketReason('The operation was aborted'), 'timeout');
    assert.strictEqual(TEL.bucketReason('socket hang up'), 'upstream');
});

check('the ladder is ORDERED — a breaker message mentioning rate limits is still breaker-open', () => {
    assert.strictEqual(TEL.bucketReason('LLM circuit breaker open after 429 rate limit'), 'breaker-open',
        'ordering regression: our own outage would be filed as the provider throttling us');
});

console.log(`\n${passes} passed, ${failures} failed`);
if (failures) {
    console.log('Whisper telemetry is inaccurate — see the three defects noted at the top.');
    process.exit(1);
}
console.log('Whisper telemetry: right place, right denominator, reaches the sink, reasons distinguishable.');
process.exit(0);
