// tests/model-text-boundary.mjs — non-string model output must never reach the screen.
//
// Codex #111 P2 reproduced the whole path: json_schema refused with a 400, json_object succeeding,
// and ry-farms-congregation returning HTTP 200 whose every speech was the literal text
// "[object Object].". The cause is that each handler sanitises with a function beginning
// `String(value || '')`, and coercion is the opposite of a type check — it manufactures a plausible
// looking line out of a value that is obviously not one:
//
//     ['a','b','c'] -> "a,b,c."      { foo: 1 } -> "[object Object]."      42 -> "42."
//
// Every one is longer than a character, so every "non-empty" filter downstream lets it through.
//
// It is reachable exactly when structured output is NOT enforced — the json_object fallback
// constrains the answer to "some JSON object" and nothing further. That fallback is silent by
// construction, so this boundary is what stands between an unenforced contract and a player reading
// "[object Object]" in a speech bubble.
//
// The fix I shipped first covered election mutters ONLY. Codex found the same hole in the script
// lines two functions away, plus raid council, invent, chat, conscience and DM. This test drives the
// REAL handlers, because the whole reason the mutters version of this bug survived review is that it
// was reasoned about rather than executed.

import assert from 'node:assert';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let passes = 0, failures = 0;
async function check(name, fn) {
    try { await fn(); console.log(`  PASS  ${name}`); passes++; }
    catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failures++; }
}

// The signatures of coercion: if either appears, String() ran on something that was not a string
// and the result reached the caller.
function assertNoCoercion(payload, label) {
    const wire = JSON.stringify(payload);
    // The SANITISER MANGLES THE SIGNATURE, so look for what survives it rather than for what
    // String() produced. ry-farms-chat uppercases display text AND strips brackets as non-printable
    // punctuation, so "[object Object]" reaches the client as `OBJECT OBJECT` — a probe looking for
    // the literal bracketed form reports clean while the words render on screen. Match the two words
    // with any or no punctuation between them, case-insensitively.
    assert.ok(!/object\W*object/i.test(wire),
        `${label}: coerced object reached the client -> ${wire.slice(0, 160)}`);
    // an array coerces to a comma-joined run with no spaces after the commas — real prose does not
    assert.ok(!/fragment number \d+[^"]*,fragment number/.test(wire),
        `${label}: coerced array reached the client -> ${wire.slice(0, 160)}`);
}

// TARGETED junk, one field at a time, and REAL request bodies.
//
// The first version of this file sent one blob with every field wrong, and three of its seven cases
// were vacuous — they passed with the fix reverted. Each for its own reason, and each reason is a
// downstream filter masking the boundary under test:
//
//   chat            ry-farms-chat.js:54 throws on empty lines, so junk dialogue aborted the request
//                   before `memory` was ever normalised.
//   dm              ry-farms-dm.js:137 keeps tales of 200+ characters, and "[object Object]." is 17,
//                   so the junk tale was silently dropped by a length filter rather than by a type
//                   check — indistinguishable in the result, opposite in meaning.
//   raid council    the invented body did not match the handler's expectations, so it failed early
//                   for reasons unrelated to types.
//
// So: every field except the one under test is a VALID string, the junk is shaped to survive the
// filters downstream of the boundary, and the request bodies come from tools/payloads.json — the
// same captured bodies the paid probe uses, produced by the real client rather than by me.

const CAPTURED = require('../tools/payloads.json').requests;
const bodyFor = (endpoint, pick = () => true) => {
    const hit = CAPTURED.filter(r => r.endpoint === `/api/${endpoint}`).filter(r => pick(r.body));
    assert.ok(hit.length, `no captured body for ${endpoint}`);
    return JSON.parse(JSON.stringify(hit[hit.length - 1].body));
};

// Junk long enough to survive a length filter — String() on this is well over 200 characters, so a
// coerced value reaches the client instead of being dropped for being short.
const LONG_JUNK = Array.from({ length: 40 }, (_, i) => `fragment number ${i} of a tale that is not a string`);

function stubLLM(response) {
    for (const k of Object.keys(require.cache)) if (k.includes('/api/')) delete require.cache[k];
    require('../api/_llm.js');
    // Replace the chokepoint's call with one returning the junk directly. This test is about the
    // handler's type boundary, not about transport — and the handler destructures callLLM at require
    // time, so _llm.js must be patched BEFORE the handler is required (callHandler does that).
    require.cache[require.resolve('../api/_llm.js')].exports.callLLM = async () => response;
}

async function callHandler(file, body) {
    const handler = require(`../api/${file}`);
    let statusCode = 0, payload = null;
    const res = {
        setHeader() {}, set statusCode(v) { statusCode = v; }, get statusCode() { return statusCode; },
        end(b) { try { payload = JSON.parse(b); } catch { payload = b; } },
    };
    await handler({ method: 'POST', body }, res);
    return { statusCode, payload };
}

process.env.OPENAI_BASE_URL = 'http://127.0.0.1:9/v1';
process.env.OPENAI_API_KEY = 'test-key-not-used';

console.log('\n#model-text-boundary — coercion is not a type check\n');

// Build the script from the ACTUAL cast in the captured body. ry-farms-congregation enforces a
// coverage floor (a script must voice a healthy fraction of the founders), so a script naming four
// invented speakers is rejected for coverage before any type check runs — which made this case pass
// with the fix reverted. Every masking bug in this file has the same shape: the handler said no for
// a reason that was not the reason under test.
const speech = (names, line) => [...names, ...names].slice(0, Math.max(6, names.length + 2))
    .map(speaker => ({ speaker, line }));
const castNames = (body) => (body.founders || body.candidates || body.cast || []).map(f => f.name).filter(Boolean);

await check('congregation SCRIPT lines — the exact case Codex reproduced', async () => {
    // Codex's repro: every speech an object. Coerced, each renders as "[object Object]." and passes
    // the length filter, so the handler returns 200 with a full script of them.
    const body = bodyFor('ry-farms-congregation', b => !b.scene);
    stubLLM({ script: speech(castNames(body), { nested: 'object' }) });
    const { payload } = await callHandler('ry-farms-congregation.js', body);
    assertNoCoercion(payload, 'congregation script');
    assert.ok(payload?.fallback, 'a script of non-strings must fall back, not render as objects');
});

await check('congregation ELECTION mutters', async () => {
    // Valid speeches so the script survives; only the mutters are junk.
    const body = bodyFor('ry-farms-congregation', b => b.scene === 'election');
    stubLLM({ script: speech(castNames(body), 'I will keep the watch and mind the fields.'),
              mutters: { m1: { x: 1 }, m2: ['a', 'b'], m3: 7, m4: 'a real one' } });
    const { payload } = await callHandler('ry-farms-congregation.js', body);
    assertNoCoercion(payload, 'election');
    assert.deepStrictEqual(payload?.mutters ?? [], ['a real one.'],
        `only the string mutter should survive, got ${JSON.stringify(payload?.mutters)}`);
});

await check('raid council script', async () => {
    const body = bodyFor('ry-farms-raid-council', b => !b.phase);
    stubLLM({ script: speech(castNames(body), { nested: 'object' }) });
    const { payload } = await callHandler('ry-farms-raid-council.js', body);
    assertNoCoercion(payload, 'raid council');
    assert.ok(payload?.fallback, 'a council script of non-strings must fall back');
});

await check('duel bark', async () => {
    stubLLM({ beat: { stunt: 'taunt', by: 'defender', bark: { b: 1 } } });
    const { payload } = await callHandler('ry-farms-raid-council.js', bodyFor('ry-farms-raid-council', b => b.phase === 'beat'));
    assertNoCoercion(payload, 'duel bark');
});

// ONE junk field per case, the sibling VALID (Codex #112 P2). The previous version made `name` and
// `lore` junk together, and ry-farms-invent falls back when EITHER is empty — so reverting one guard
// left the other's empty string producing the same fallback, and the assertions passed under both
// single mutations. Codex reproduced exactly that.
//
// This is the fourth distinct instance of the same disease in this file: a case that fails only when
// TWO fixes are reverted covers neither.
for (const [field, junk] of [['name', { n: 1 }], ['lore', ['some', 'lore']]]) {
    await check(`invent ${field} — junk must fall back, not render`, async () => {
        const valid = { name: 'ROUGH LUCK KNOT', lore: 'A quiet charm tied from riverstone and hide.' };
        stubLLM({ ...valid, [field]: junk });
        const { payload } = await callHandler('ry-farms-invent.js', bodyFor('ry-farms-invent'));
        assertNoCoercion(payload, `invent ${field}`);
        assert.ok(payload?.fallback, `a non-string ${field} must fall back, not render as an object`);
    });
}

await check('chat memory — reached only when the LINES are valid', async () => {
    // ry-farms-chat.js:54 throws on empty lines, so junk dialogue would abort before `memory`.
    stubLLM({
        speakerLine: 'Cricket, that fence needs mending.', listenerLine: "I'll tend it after the well crew.",
        speakerTone: { t: 1 }, listenerTone: ['y'], memory: { m: 1 },
        relationshipReason: { r: 1 }, relationshipDelta: 0.01,
    });
    const { payload } = await callHandler('ry-farms-chat.js', bodyFor('ry-farms-chat'));
    assertNoCoercion(payload, 'chat');
});

await check('conscience reply line', async () => {
    stubLLM({ line: { l: 1 }, verdict: 'DISMISS' });
    const { payload } = await callHandler('ry-farms-conscience.js', bodyFor('ry-farms-conscience', b => b.stage !== 'classify'));
    assertNoCoercion(payload, 'conscience');
});

await check('dm tale — junk shaped to survive the 200-character filter', async () => {
    const seed = bodyFor('ry-farms-dm').characters[0].seed;
    stubLLM({ tales: [{ seed, tale: LONG_JUNK }] });
    const { payload } = await callHandler('ry-farms-dm.js', bodyFor('ry-farms-dm'));
    assertNoCoercion(payload, 'dm');
    assert.ok(payload?.fallback || !(payload?.tales || []).length,
        `a non-string tale survived: ${JSON.stringify(payload).slice(0, 160)}`);
});

// ONE junk field per case. Making BOTH lines junk masked the boundary: ry-farms-chat.js:54 throws
// when EITHER line is empty, so the sibling's guard produced the fallback and reverting one field's
// type check changed nothing. A test that needs two fixes reverted to fail does not cover either.
for (const field of ['speakerLine', 'listenerLine']) {
    await check(`chat ${field} — junk dialogue must fall back, not render coerced`, async () => {
        stubLLM({
            speakerLine: 'Cricket, that fence needs mending.', listenerLine: "I'll tend it after the well crew.",
            speakerTone: 'steady', listenerTone: 'steady', memory: 'they spoke about the fence',
            relationshipReason: 'shared work', relationshipDelta: 0.01,
            [field]: { junk: 1 },
        });
        const { payload } = await callHandler('ry-farms-chat.js', bodyFor('ry-farms-chat'));
        assertNoCoercion(payload, `chat ${field}`);
        assert.ok(payload?.fallback, `a non-string ${field} must fall back rather than render`);
    });
}

await check('conscience CLASSIFY target', async () => {
    // The reply stage never reads `target`, so the reply case could not cover it.
    stubLLM({ kind: 'rest', target: { t: 1 }, tone: 'suggest' });
    const { payload } = await callHandler('ry-farms-conscience.js', bodyFor('ry-farms-conscience', b => b.stage === 'classify'));
    assertNoCoercion(payload, 'conscience classify');
});

console.log(`\n${passes} passed, ${failures} failed`);
if (failures) { console.log('Model output that is not text can reach a speech bubble.'); process.exit(1); }
console.log('Text boundary: every model-originated field is type-checked before sanitising.');
process.exit(0);
