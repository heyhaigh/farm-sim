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

// The skip is time-based now, so the clock is injectable. Real waits would make this file take
// thirty-one minutes.
const realNow = Date.now;
const atSecond = (sec) => { const base = realNow(); Date.now = () => base + sec * 1000; };
const restoreClock = () => { Date.now = realNow; };

const refuse = (matchSchema) => ({ format, schemaName }) => (
    format === 'json_schema' && (!matchSchema || schemaName === matchSchema)
        ? { status: 400, body: JSON.stringify({ error: { code: 'invalid_request', message: 'Invalid schema for response_format' } }) }
        : completion({ ok: true }));

await check('a schema refusal is remembered WITHIN its backoff window', async () => {
    // The original purpose of #stickyformat, which must survive: re-paying the same 400 on every
    // call doubled request spend on a free tier metered per minute.
    const { callLLM } = freshLlm();
    const sent = stubFetch(refuse('big'));
    atSecond(0);
    await callLLM({ system: 's', user: 'u', schema: { type: 'object' }, schemaName: 'big', maxTokens: 50 });
    const firstRound = sent.length;
    atSecond(30);   // inside the 60s window
    await callLLM({ system: 's', user: 'u', schema: { type: 'object' }, schemaName: 'big', maxTokens: 50 });
    restoreClock();
    assert.ok(!sent.slice(firstRound).some(x => x.format === 'json_schema'),
        'the same refused schema was retried immediately — the 400 is being paid on every call');
});

await check('...and RETRIED once the window expires', async () => {
    // Codex #112 P1. A schema-scoped refusal was cached for the PROCESS LIFETIME, so one transient
    // validation 400 downgraded that schema to json_object until redeploy. Codex reproduced
    // json_schema, json_object, json_object against a provider that was ready to accept strict output
    // on the second call.
    //
    // Worse, the test that used to live here ASSERTED that permanence — "paid once per process" — so
    // it would have failed the fix rather than caught the bug. A test can enshrine a defect as a
    // contract, and this one did, which is why the property under test is now stated as recovery.
    const { callLLM } = freshLlm();
    let refuseNow = true;
    const sent = stubFetch(({ format }) => (
        format === 'json_schema' && refuseNow
            ? { status: 400, body: JSON.stringify({ error: { message: 'Invalid schema for response_format' } }) }
            : completion({ ok: true })));

    atSecond(0);
    await callLLM({ system: 's', user: 'u', schema: { type: 'object' }, schemaName: 'transient', maxTokens: 50 });
    refuseNow = false;                       // the provider is healthy again
    const firstRound = sent.length;
    atSecond(61);                            // past the first 60s backoff
    await callLLM({ system: 's', user: 'u', schema: { type: 'object' }, schemaName: 'transient', maxTokens: 50 });
    restoreClock();

    const secondRound = sent.slice(firstRound);
    assert.strictEqual(secondRound[0]?.format, 'json_schema',
        `a transient refusal was made permanent: second call went out as ${secondRound[0]?.format}`);
});

await check('a repeat refusal backs off further instead of retrying every minute', async () => {
    // A schema the provider genuinely will not accept must not cost a 400 every 60 seconds forever.
    const { callLLM } = freshLlm();
    const sent = stubFetch(refuse(null));
    atSecond(0);
    await callLLM({ system: 's', user: 'u', schema: { type: 'object' }, schemaName: 'bad', maxTokens: 50 });
    atSecond(61);   // window 1 expired -> retried, refused again -> now on the 5 minute step
    await callLLM({ system: 's', user: 'u', schema: { type: 'object' }, schemaName: 'bad', maxTokens: 50 });
    const afterTwo = sent.length;
    atSecond(150);  // inside the 5 minute window
    await callLLM({ system: 's', user: 'u', schema: { type: 'object' }, schemaName: 'bad', maxTokens: 50 });
    restoreClock();
    assert.ok(!sent.slice(afterTwo).some(x => x.format === 'json_schema'),
        'the backoff did not lengthen after a second refusal');
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

    atSecond(0);
    await callLLM({ system: 's', user: 'u', schema: { type: 'object' }, schemaName: 'first', maxTokens: 50 });
    const firstRound = sent.length;
    // an hour later, and under a DIFFERENT schema name: still must not be asked
    atSecond(3600);
    await callLLM({ system: 's', user: 'u', schema: { type: 'object' }, schemaName: 'second', maxTokens: 50 });
    restoreClock();

    const secondRound = sent.slice(firstRound);
    assert.ok(!secondRound.some(x => x.format === 'json_schema'),
        'a model that rejects the PARAMETER should not be asked again — not under another schema, not later');
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

await check('request-scoped wording does NOT become a model-wide verdict', async () => {
    // Codex #112: the classifier must require explicit MODEL wording. This message complains about
    // the REQUEST, and treating it as model-wide would mute structured output for every schema.
    //
    // It uses the UNDERSCORE form deliberately. The first version of this case wrote "response
    // format" with a space, which the loosened regex would not have matched either — so the case
    // passed under a mutation that removed the model-wording requirement, proving nothing. The whole
    // risk is a request-scoped complaint that happens to spell the parameter the way the pattern
    // expects.
    const { callLLM } = freshLlm();
    const sent = stubFetch(({ format }) => (
        format === 'json_schema'
            ? { status: 400, body: JSON.stringify({ error: { message: 'response_format json_schema is not supported with this request' } }) }
            : completion({ ok: true })));
    atSecond(0);
    await callLLM({ system: 's', user: 'u', schema: { type: 'object' }, schemaName: 'shape_a', maxTokens: 50 });
    const firstRound = sent.length;
    await callLLM({ system: 's', user: 'u', schema: { type: 'object' }, schemaName: 'shape_b', maxTokens: 50 });
    restoreClock();
    assert.strictEqual(sent.slice(firstRound)[0]?.format, 'json_schema',
        'a request-scoped complaint was treated as model-wide and muted a different schema');
});

await check('a refusal keeps diagnostics and DISCARDS generated content', async () => {
    // Codex #112 P2: Groq documents 400 bodies carrying `failed_generation` — the model's attempted
    // output, which is derived from the prompt, which for a whisper is the player's own words.
    const { callLLM, lastRefusalFor } = freshLlm();
    stubFetch(({ format }) => (
        format === 'json_schema'
            ? { status: 400, body: JSON.stringify({ error: {
                  type: 'invalid_request_error', code: 'json_validate_failed',
                  message: 'Generated JSON did not match the schema',
                  failed_generation: 'PLAYER SAID: my secret diary entry about my landlord',
              } }) }
            : completion({ ok: true })));
    atSecond(0);
    await callLLM({ system: 's', user: 'u', schema: { type: 'object' }, schemaName: 'leaky', maxTokens: 50 });
    restoreClock();
    const kept = JSON.stringify(lastRefusalFor('leaky'));
    assert.ok(!/secret diary|PLAYER SAID/.test(kept), `generated content was retained: ${kept}`);
    assert.ok(/json_validate_failed/.test(kept), 'the diagnostic code should be kept');
    assert.ok(/did not match the schema/.test(kept), 'the provider message should be kept');
});

console.log(`\n${passes} passed, ${failures} failed`);
if (failures) { console.log('One refused schema can silently mute structured output for every other endpoint.'); process.exit(1); }
console.log('Format skip: scoped to the schema that was refused, model-wide only when the format itself is refused.');
process.exit(0);
