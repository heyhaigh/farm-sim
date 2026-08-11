// tests/llm-error-boundary.mjs — model-generated text must never steer process-wide state.
//
// Codex #115 found two P1s of the same shape: `isFormatUnsupported` and `isModelGone` both searched
// the RAW error body as a string. Groq puts the model's attempted output in a separate
// `failed_generation` field, and that output is derived from the prompt — which, for a whisper, is
// the player's own typed message. So text influenced by a player could:
//
//   * disable structured output for the entire process, by containing the sentence
//     "This model does not support response format json_schema"; or
//   * retire the primary model, by containing "The model <name> is retired", or a NESTED
//     `code: "model_not_found"` that the structured-code check found as a substring of the body.
//
// Both reproduced end to end before the fix. This is the classic confused-deputy shape: a trusted
// decision made from untrusted bytes because nobody drew the boundary between the provider's own
// diagnostic and the payload it happened to carry.
//
// There is now exactly one parse — parseProviderError() — and every classifier reads its allow-listed
// fields. These cases attack that boundary directly.

import assert from 'node:assert';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let passes = 0, failures = 0;
async function check(name, fn) {
    try { await fn(); console.log(`  PASS  ${name}`); passes++; }
    catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failures++; }
}

function freshLlm() {
    delete globalThis.__ryFarmsLlmState;
    for (const k of Object.keys(require.cache)) if (k.includes('_llm.js')) delete require.cache[k];
    return require('../api/_llm.js');
}
function stubFetch(reply) {
    const sent = [];
    globalThis.fetch = async (_url, opts) => {
        const body = JSON.parse(opts.body);
        sent.push({ model: body.model, format: body.response_format?.type || 'none' });
        const r = reply({ format: body.response_format?.type || 'none', model: body.model });
        if (r.status !== 200) return { ok: false, status: r.status, text: async () => r.body, json: async () => ({}) };
        return { ok: true, status: 200, text: async () => '', json: async () => r.body };
    };
    return sent;
}
const completion = (obj) => ({ status: 200, body: { choices: [{ message: { content: JSON.stringify(obj) } }] } });

process.env.OPENAI_BASE_URL = 'http://127.0.0.1:9/v1';
process.env.OPENAI_API_KEY = 'test-key-not-used';
process.env.RY_FARMS_LLM_MODELS = 'primary/model,fallback/model';

console.log('\n#llm-error-boundary — generated content must not steer permanent state\n');

// The sentence that legitimately disables structured output, placed where a MODEL wrote it rather
// than where the provider did.
const POISON_FORMAT = 'This model does not support response format json_schema';

await check('failed_generation cannot disable structured output', async () => {
    const { callLLM } = freshLlm();
    const sent = stubFetch(({ format }) => (
        format === 'json_schema'
            ? { status: 400, body: JSON.stringify({ error: {
                  type: 'invalid_request_error', code: 'json_validate_failed',
                  message: 'Generated JSON did not match the schema',
                  failed_generation: JSON.stringify({ reply: POISON_FORMAT }),
              } }) }
            : completion({ ok: true })));

    await callLLM({ system: 's', user: 'u', schema: { type: 'object' }, schemaName: 'shape_a', maxTokens: 50 });
    const firstRound = sent.length;
    // A DIFFERENT schema. A format-wide verdict sends it straight to json_object; a schema-scoped one
    // leaves it free to attempt strict output.
    await callLLM({ system: 's', user: 'u', schema: { type: 'object' }, schemaName: 'shape_b', maxTokens: 50 });

    assert.strictEqual(sent.slice(firstRound)[0]?.format, 'json_schema',
        'generated content disabled structured output for a different schema');
});

await check('the same sentence in error.message DOES disable it', async () => {
    // The counterpart, or the case above would pass by simply never trusting anything. The provider's
    // own diagnostic must still be believed.
    const { callLLM } = freshLlm();
    const sent = stubFetch(({ format }) => (
        format === 'json_schema'
            ? { status: 400, body: JSON.stringify({ error: { message: `${POISON_FORMAT}.` } }) }
            : completion({ ok: true })));

    await callLLM({ system: 's', user: 'u', schema: { type: 'object' }, schemaName: 'shape_a', maxTokens: 50 });
    const firstRound = sent.length;
    await callLLM({ system: 's', user: 'u', schema: { type: 'object' }, schemaName: 'shape_b', maxTokens: 50 });

    assert.ok(!sent.slice(firstRound).some(x => x.format === 'json_schema'),
        'a real provider refusal was ignored — the boundary is now too tight to believe anything');
});

await check('failed_generation cannot retire a model', async () => {
    const { isModelGone } = freshLlm();
    const M = 'primary/model';
    // Parsed from a body whose diagnostic is innocuous and whose GENERATED text claims retirement.
    const err = { type: 'invalid_request_error', code: 'json_validate_failed', message: 'Generated JSON did not match the schema' };
    assert.strictEqual(isModelGone(400, err, M), false,
        'a model was retired by text it generated itself');
});

await check('a NESTED model_not_found code cannot retire a model', async () => {
    // The structured-code check used to test the whole body against /"code"\s*:\s*"model_not_found"/,
    // so a code nested inside failed_generation matched. Only the top-level code counts now.
    const { isModelGone } = freshLlm();
    assert.strictEqual(isModelGone(400, { code: 'json_validate_failed', message: 'nope' }, 'primary/model'), false);
    assert.strictEqual(isModelGone(400, { code: 'model_not_found', message: 'nope' }, 'primary/model'), true,
        'a genuine top-level retirement code must still be believed');
});

await check('the model must be the SUBJECT of the retirement', async () => {
    // Codex #115: the model name sits in a prepositional phrase and the subject is the schema.
    const { isModelGone } = freshLlm();
    const M = 'openai/gpt-oss-120b';
    assert.strictEqual(isModelGone(400, { message: `The response schema for model ${M} was not found.` }, M), false,
        'a schema complaint retired the model it named');
    // The sentence that actually EXERCISES the subject tie. The one above stopped depending on it the
    // moment "not found" left the predicate list, so a mutation removing the tie escaped: the case
    // still passed for an unrelated reason. This one carries real retirement wording — "has been
    // removed" — with the schema as its subject, so only the tie can reject it.
    assert.strictEqual(isModelGone(400, { message: `The response schema for model ${M} has been removed.` }, M), false,
        'retirement wording about a SCHEMA retired the model named in the prepositional phrase');
    assert.strictEqual(isModelGone(400, { message: `The model \`${M}\` has been decommissioned.` }, M), true,
        'a real retirement notice must still be believed');
});

await check('a retirement code MENTIONED in prose is not a retirement code', async () => {
    // The structured check must read the top-level `code` FIELD, not look for the string anywhere.
    // Without a case like this, a mutation matching the codes across the whole object escapes —
    // there is nothing else in a parsed error for it to find.
    const { isModelGone } = freshLlm();
    const M = 'primary/model';
    assert.strictEqual(
        isModelGone(400, { code: 'json_validate_failed', message: 'the schema property model_not_found is unknown' }, M),
        false, 'a code NAMED IN PROSE was treated as the provider\'s own error code');
});

await check('FAILOVER does not depend on recognising a retirement message', async () => {
    // WITH A SCHEMA, because every production caller supplies one and the first version of this case
    // did not (Codex #116 P1). Without a schema there is only one format to fail, so the case passed
    // while the real path — walk json_schema, json_object, none on a dead model before advancing —
    // went untested.
    const { callLLM } = freshLlm();
    const sent = stubFetch(({ model }) => (
        model === 'primary/model'
            // wording that matches NOTHING: no code, no retirement prose, no model name
            ? { status: 400, body: JSON.stringify({ error: { message: 'Service temporarily unavailable for this deployment.' } }) }
            : completion({ ok: true })));

    const out = await callLLM({ system: 's', user: 'u', schema: { type: 'object' }, schemaName: 'shape_a', maxTokens: 50 });
    assert.deepStrictEqual(out, { ok: true }, 'the call did not reach the fallback model');
    assert.ok(sent.some(x => x.model === 'fallback/model'),
        'the chain never tried the fallback because the failure was not recognised as retirement');
    // and it must not have walked the whole ladder to get there
    assert.strictEqual(sent.filter(x => x.model === 'primary/model').length, 1,
        `spent ${sent.filter(x => x.model === 'primary/model').length} requests on a dead model before failing over`);
});

await check('a dead primary cannot eat the request budget before the fallback is tried', async () => {
    // Codex #116 P1, reproduced verbatim: seven distinct schemas against a dead primary and a healthy
    // fallback. Walking json_schema -> json_object -> none on the primary for EACH schema spent three
    // requests apiece, so the seventh hit the 26-request ceiling and the healthy fallback was never
    // reached. Recognition was not an optimisation after all — under model-outer/format-inner
    // ordering it was the thing keeping a dead model from eating the failover budget. I asserted the
    // opposite twice.
    const { callLLM } = freshLlm();
    const sent = stubFetch(({ model }) => (
        model === 'primary/model'
            ? { status: 400, body: JSON.stringify({ error: { message: 'Service temporarily unavailable for this deployment.' } }) }
            : completion({ ok: true })));

    let ok = 0;
    for (let i = 1; i <= 7; i++) {
        const out = await callLLM({ system: 's', user: 'u', schema: { type: 'object' }, schemaName: `shape_${i}`, maxTokens: 50 });
        if (out?.ok) ok++;
    }
    assert.strictEqual(ok, 7, `only ${ok} of 7 schemas reached the healthy fallback`);
    assert.ok(sent.length <= 14,
        `${sent.length} upstream requests for 7 schemas — the format ladder is being walked on a model-level failure`);
});

await check('a genuine FORMAT complaint still walks the ladder', async () => {
    // The counterpart, or the fix above would pass by never degrading at all — and json_object is
    // what carries every call on a model that refuses strict output.
    const { callLLM } = freshLlm();
    const sent = stubFetch(({ format }) => (
        format === 'json_schema'
            ? { status: 400, body: JSON.stringify({ error: { code: 'json_validate_failed', message: 'Generated JSON did not match the schema' } }) }
            : completion({ ok: true })));

    const out = await callLLM({ system: 's', user: 'u', schema: { type: 'object' }, schemaName: 'shape_a', maxTokens: 50 });
    assert.deepStrictEqual(out, { ok: true });
    assert.deepStrictEqual(sent.map(x => x.format), ['json_schema', 'json_object'],
        'a schema complaint should degrade on the SAME model rather than failing over');
});

await check('an unusable 200 fails over instead of abandoning the chain', async () => {
    // Codex #116 P1: parseJson/extractContent failures escaped to the outer catch, so a primary
    // returning HTTP 200 with empty content rejected the whole call and the fallback was never asked.
    // Reasoning models returning empty content has already happened once in this migration.
    const { callLLM } = freshLlm();
    const sent = stubFetch(({ model }) => (
        model === 'primary/model'
            ? { status: 200, body: { choices: [{ message: { content: '' } }] } }
            : completion({ ok: true })));

    const out = await callLLM({ system: 's', user: 'u', schema: { type: 'object' }, schemaName: 'shape_a', maxTokens: 50 });
    assert.deepStrictEqual(out, { ok: true }, 'an empty 200 on the primary killed the call');
    assert.ok(sent.some(x => x.model === 'fallback/model'), 'the fallback was never asked');
});

await check('a proven success clears the model\'s retirement strikes', async () => {
    // Codex #116 P2. The expiring verdict inherited the stale-history problem fixed for schema skips
    // in #113: a model that answered correctly a moment ago is not a repeat offender, but its old
    // strike stood, so the next blip skipped it for five minutes instead of sixty seconds.
    const realNow = Date.now;
    const { callLLM } = freshLlm();
    let retired = true;
    const sent = stubFetch(({ model }) => (
        model === 'primary/model' && retired
            ? { status: 400, body: JSON.stringify({ error: { code: 'model_decommissioned', message: 'gone' } }) }
            : completion({ ok: true })));
    const base = realNow();

    Date.now = () => base;               await callLLM({ system: 's', user: 'u', schemaName: 'a', maxTokens: 50 });  // strike 1
    retired = false;
    Date.now = () => base + 61_000;      await callLLM({ system: 's', user: 'u', schemaName: 'a', maxTokens: 50 });  // primary proves healthy
    retired = true;
    Date.now = () => base + 62_000;      await callLLM({ system: 's', user: 'u', schemaName: 'a', maxTokens: 50 });  // strike 1 again, not 2
    retired = false;
    const before = sent.length;
    Date.now = () => base + 124_000;     await callLLM({ system: 's', user: 'u', schemaName: 'a', maxTokens: 50 });
    Date.now = realNow;

    assert.ok(sent.slice(before).some(x => x.model === 'primary/model'),
        'stale strikes survived a proven success, so the healthy primary stayed skipped');
});

await check('a retirement verdict EXPIRES rather than sticking for the process', async () => {
    // Every signal that sets this is unverified — synthetic codes and prose patterns, no captured
    // retirement response anywhere in this repository's history. A permanent verdict on unverified
    // evidence demotes a working primary model until redeploy.
    const realNow = Date.now;
    const { callLLM } = freshLlm();
    let retired = true;
    const sent = stubFetch(({ model }) => (
        model === 'primary/model' && retired
            ? { status: 400, body: JSON.stringify({ error: { code: 'model_decommissioned', message: 'gone' } }) }
            : completion({ ok: true })));

    const base = realNow();
    Date.now = () => base;
    await callLLM({ system: 's', user: 'u', schemaName: 'shape_a', maxTokens: 50 });
    retired = false;                       // it was a blip, or the provider restored it
    const firstRound = sent.length;
    Date.now = () => base + 61_000;        // past the first backoff step
    await callLLM({ system: 's', user: 'u', schemaName: 'shape_a', maxTokens: 50 });
    Date.now = realNow;

    assert.ok(sent.slice(firstRound).some(x => x.model === 'primary/model'),
        'the primary model stayed demoted after its verdict should have expired');
});

await check('END TO END: failed_generation claiming retirement does not demote the model', async () => {
    // The direct isModelGone() cases above cannot catch a mistake at the CALL SITE — passing the raw
    // body instead of the parsed error — because they never go through callLLM. A mutation doing
    // exactly that escaped them. This drives the real path: a 400 whose diagnostic is innocuous and
    // whose GENERATED output claims the model is retired.
    const { callLLM } = freshLlm();
    let injected = true;
    const sent = stubFetch(({ model }) => {
        if (model === 'primary/model' && injected) {
            return { status: 400, body: JSON.stringify({ error: {
                type: 'invalid_request_error', code: 'json_validate_failed',
                message: 'Generated JSON did not match the schema',
                failed_generation: 'The model `primary/model` has been decommissioned.',
            } }) };
        }
        return completion({ ok: true });
    });

    await callLLM({ system: 's', user: 'u', schemaName: 'shape_a', maxTokens: 50 });
    injected = false;
    const firstRound = sent.length;
    // If the injection demoted it, resolveLLM drops primary from the live chain and this goes
    // straight to the fallback.
    await callLLM({ system: 's', user: 'u', schemaName: 'shape_a', maxTokens: 50 });

    assert.strictEqual(sent.slice(firstRound)[0]?.model, 'primary/model',
        'model-generated text demoted the primary model through the call site');
});

await check('END TO END: the retained refusal never carries generated content', async () => {
    // Guards the parse itself rather than the classifiers. Leaking extra fields out of
    // parseProviderError is invisible to a classifier that reads only .message and .code — but it
    // lands in the retained refusal and in the log line.
    const { callLLM, lastRefusalFor } = freshLlm();
    stubFetch(({ format }) => (
        format === 'json_schema'
            ? { status: 400, body: JSON.stringify({ error: {
                  type: 'invalid_request_error', code: 'json_validate_failed',
                  message: 'Generated JSON did not match the schema',
                  failed_generation: 'PLAYER SAID: my private note about my neighbour',
              } }) }
            : completion({ ok: true })));
    await callLLM({ system: 's', user: 'u', schema: { type: 'object' }, schemaName: 'leaky', maxTokens: 50 });
    const kept = JSON.stringify(lastRefusalFor('leaky'));
    assert.ok(!/PLAYER SAID|private note/.test(kept), `generated content was retained: ${kept}`);
    assert.ok(!/failed_generation/.test(kept), `the field itself was retained: ${kept}`);
});

await check('one model\'s success does not clear ANOTHER model\'s strikes', async () => {
    // A mutation replacing `_modelDead.delete(model)` with `_modelDead.clear()` escaped every case in
    // this file, because none of them ever had two models flagged at once. Clearing the whole map on
    // any success would resurrect a genuinely dead model the moment its replacement answered — and
    // the replacement answering is the NORMAL state after a failover, so it would fire constantly.
    const realNow = Date.now;
    const { callLLM } = freshLlm();
    const sent = stubFetch(({ model }) => (
        model === 'primary/model'
            ? { status: 400, body: JSON.stringify({ error: { code: 'model_decommissioned', message: 'gone' } }) }
            : completion({ ok: true })));
    const base = realNow();

    Date.now = () => base;
    // primary is flagged, and the SAME call then succeeds on the fallback
    await callLLM({ system: 's', user: 'u', schemaName: 'a', maxTokens: 50 });
    const before = sent.length;
    Date.now = () => base + 30_000;   // still inside primary's 60s window
    await callLLM({ system: 's', user: 'u', schemaName: 'a', maxTokens: 50 });
    Date.now = realNow;

    assert.ok(!sent.slice(before).some(x => x.model === 'primary/model'),
        'the fallback succeeding cleared the primary\'s strike, so a dead model was retried immediately');
});

console.log(`\n${passes} passed, ${failures} failed`);
if (failures) { console.log('Model-generated text can steer process-wide state.'); process.exit(1); }
console.log('Error boundary: one parse, allow-listed fields, no permanent verdict on unverified evidence.');
process.exit(0);
