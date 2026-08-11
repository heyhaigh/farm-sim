// tests/llm-format-skip.mjs — #stickyformat must not let ONE bad schema disable structured output
// for every other endpoint.
//
// Found 2026-08-10 by reading a probe run, not by a test. Two consecutive matrix runs used the same
// captured chat payload; the first returned a real memory and real tones from gpt-oss-120b, the
// second returned the handler's OWN fallbacks from BOTH models. Same bytes in, different quality out.
// The only thing that had changed was the election schema — and election runs immediately before chat.
//
// The mechanism: on a 400, `_formatSkip.add(`${model}|${response_format.type}`)`. That key names the
// MODEL and the FORMAT but not the SCHEMA, while the rejection is a property of the schema. So one
// endpoint whose schema a provider won't accept silently downgrades every LATER call for that model
// to json_object, which enforces nothing at all — and the callers, all of which normalise missing
// fields to defaults, keep returning 200 with hollow content.
//
// In a probe that costs a misleading green. In production `_S` lives on globalThis in a long-lived
// server.mjs, so it is permanent until redeploy: every chat, congregation and DM in the process loses
// structured output because one election call was refused once.
//
// This test is deliberately provider-independent. It does not assert that Groq rejects the election
// schema — it asserts that IF anything is ever rejected, the blast radius is that schema alone.

import assert from 'node:assert';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let passes = 0, failures = 0;
async function check(name, fn) {
    try { await fn(); console.log(`  PASS  ${name}`); passes++; }
    catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failures++; }
}

// Fresh chokepoint per case: _formatSkip is process state and would leak between cases.
function freshLlm() {
    delete globalThis.__ryFarmsLlmState;
    for (const k of Object.keys(require.cache)) if (k.includes('_llm.js')) delete require.cache[k];
    return require('../api/_llm.js');
}

// Records every request the chokepoint makes, and lets each case decide what comes back.
function stubFetch(reply) {
    const sent = [];
    globalThis.fetch = async (_url, opts) => {
        const body = JSON.parse(opts.body);
        const format = body.response_format?.type || 'none';
        const schemaName = body.response_format?.json_schema?.name || null;
        sent.push({ model: body.model, format, schemaName });
        const r = reply({ format, schemaName });
        if (r.status !== 200) {
            return { ok: false, status: r.status, text: async () => r.body, json: async () => ({}) };
        }
        return {
            ok: true, status: 200,
            text: async () => JSON.stringify(r.body),
            json: async () => r.body,
        };
    };
    return sent;
}
const completion = (obj) => ({ status: 200, body: { choices: [{ message: { content: JSON.stringify(obj) } }] } });

// Fail-closed by design: the chokepoint refuses to run without an explicit endpoint. Point it at a
// closed port — fetch is stubbed below, so nothing leaves the machine.
process.env.OPENAI_BASE_URL = 'http://127.0.0.1:9/v1';
process.env.OPENAI_API_KEY = 'test-key-not-used';
process.env.RY_FARMS_LLM_MODELS = 'test/model-a';

console.log('\n#llm-format-skip — one refused schema must not mute the others\n');

await check('a schema-specific 400 does NOT disable json_schema for a different schema', async () => {
    const { callLLM } = freshLlm();
    // Schema "big" is refused; schema "small" is fine. This is the exact shape of the production
    // situation: one complex endpoint, nine simple ones, one shared model.
    const sent = stubFetch(({ format, schemaName }) => {
        if (format === 'json_schema' && schemaName === 'big') {
            return { status: 400, body: JSON.stringify({ error: { code: 'invalid_request', message: 'Invalid schema for response_format' } }) };
        }
        return completion({ ok: true });
    });

    await callLLM({ system: 's', user: 'u', schema: { type: 'object' }, schemaName: 'big', maxTokens: 50 });
    const firstRound = sent.length;
    await callLLM({ system: 's', user: 'u', schema: { type: 'object' }, schemaName: 'small', maxTokens: 50 });

    // Slice by CALL BOUNDARY, not by schemaName: when the bug fires, the second call goes out as
    // json_object, which carries no schema name at all — filtering on the name finds nothing and
    // reports "never went out" for a request that very much did.
    const secondRound = sent.slice(firstRound);
    assert.ok(secondRound.length > 0, 'the second call never went out');
    assert.strictEqual(secondRound[0].format, 'json_schema',
        `the second call went straight to ${secondRound[0].format}: a 400 on schema "big" muted structured output for schema "small" too`);
});

await check('the refused schema IS remembered, so its 400 is paid once per process', async () => {
    // The original purpose of #stickyformat, which must survive the fix: llama models rejected
    // json_schema on EVERY call, and re-paying that 400 per call doubled request spend on a free tier
    // metered per minute.
    const { callLLM } = freshLlm();
    const sent = stubFetch(({ format, schemaName }) => {
        if (format === 'json_schema' && schemaName === 'big') {
            return { status: 400, body: JSON.stringify({ error: { code: 'invalid_request', message: 'Invalid schema for response_format' } }) };
        }
        return completion({ ok: true });
    });

    await callLLM({ system: 's', user: 'u', schema: { type: 'object' }, schemaName: 'big', maxTokens: 50 });
    const firstRound = sent.length;
    await callLLM({ system: 's', user: 'u', schema: { type: 'object' }, schemaName: 'big', maxTokens: 50 });

    const secondRound = sent.slice(firstRound);
    assert.ok(!secondRound.some(x => x.format === 'json_schema'),
        'the same refused schema was retried with json_schema — the 400 is being paid on every call');
});

await check('a FORMAT-level rejection still disables json_schema model-wide', async () => {
    // The llama case: the model does not support the parameter at all, so no schema will ever work
    // and there is nothing to be gained by discovering that ten more times.
    const { callLLM } = freshLlm();
    const sent = stubFetch(({ format }) => {
        if (format === 'json_schema') {
            return { status: 400, body: JSON.stringify({ error: { code: 'invalid_request', message: 'response_format json_schema is not supported by this model' } }) };
        }
        return completion({ ok: true });
    });

    await callLLM({ system: 's', user: 'u', schema: { type: 'object' }, schemaName: 'first', maxTokens: 50 });
    const firstRound = sent.length;
    await callLLM({ system: 's', user: 'u', schema: { type: 'object' }, schemaName: 'second', maxTokens: 50 });

    const secondRound = sent.slice(firstRound);
    assert.ok(!secondRound.some(x => x.format === 'json_schema'),
        'a model that rejects the PARAMETER should not be asked again under a different schema name');
});

await check('the format witness records which format actually produced the answer', async () => {
    // Codex #111 P1: nothing in a provider response names the format that was applied, so the caller
    // records it. Without this the probe cannot tell an enforced schema from a fallback that happened
    // to look right — and a green matrix means only "the text was fine", never "the contract held".
    const { callLLM, lastFormatFor } = freshLlm();
    stubFetch(({ format }) => {
        if (format === 'json_schema') {
            return { status: 400, body: JSON.stringify({ error: { message: 'Invalid schema for response_format' } }) };
        }
        return completion({ ok: true });
    });
    await callLLM({ system: 's', user: 'u', schema: { type: 'object' }, schemaName: 'refused', maxTokens: 50 });
    assert.strictEqual(lastFormatFor('refused')?.format, 'json_object',
        'a schema that was refused and answered under json_object must not read as enforced');

    const { callLLM: call2, lastFormatFor: read2 } = freshLlm();
    stubFetch(() => completion({ ok: true }));
    await call2({ system: 's', user: 'u', schema: { type: 'object' }, schemaName: 'accepted', maxTokens: 50 });
    assert.strictEqual(read2('accepted')?.format, 'json_schema');
    assert.strictEqual(read2('never-called'), null, 'an unasked schema must read as null, not as a format');
});

console.log(`\n${passes} passed, ${failures} failed`);
if (failures) { console.log('One refused schema can silently mute structured output for every other endpoint.'); process.exit(1); }
console.log('Format skip: scoped to the schema that was refused, model-wide only when the format itself is refused.');
process.exit(0);
