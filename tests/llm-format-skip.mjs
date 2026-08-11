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
            // The CAPTURED sentence, not the synthetic one this case used to carry. Its previous
            // fixture — "response_format json_schema is not supported by this model" — entered the
            // repository in 497055e as a reproduction I wrote, never as provider output, and the
            // pattern branch that matched it has been deleted (Codex #114 P1).
            return { status: 400, body: JSON.stringify({ error: { code: 'invalid_request', message: 'This model does not support response format `json_schema`.' } }) };
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
    const logged = [];
    const realWarn = console.warn;
    console.warn = (...a) => { logged.push(a.map(String).join(' ')); };
    atSecond(0);
    try {
        await callLLM({ system: 's', user: 'u', schema: { type: 'object' }, schemaName: 'leaky', maxTokens: 50 });
    } finally { console.warn = realWarn; restoreClock(); }
    assert.ok(logged.length, 'the refusal should have been logged at all');
    const kept = JSON.stringify(lastRefusalFor('leaky'));
    assert.ok(!/secret diary|PLAYER SAID/.test(kept), `generated content was retained: ${kept}`);
    assert.ok(/json_validate_failed/.test(kept), 'the diagnostic code should be kept');
    assert.ok(/did not match the schema/.test(kept), 'the provider message should be kept');
    // THE LOG SINK, not only the retained object (Codex #113 P2). This case asserted lastRefusalFor()
    // alone, so restoring `console.warn` to print raw errText would have leaked failed_generation
    // into Railway while the test stayed green — a privacy test blind to the thing that publishes.
    // Codex predicted this was the tenth hollow case before finding it, from the shape alone.
    assert.ok(!/secret diary|PLAYER SAID/.test(logged.join('\n')),
        `generated content was LOGGED: ${logged.join(' | ').slice(0, 200)}`);
    assert.ok(/json_validate_failed/.test(logged.join('\n')), 'the log should still carry the diagnostic');
});

await check('a proven strict success resets the schema\'s strike history', async () => {
    // Codex #113 P2. `strikes` was kept across expiry so a repeat offender would not be re-probed
    // every minute, but nothing ever cleared it: a schema that failed in January stayed on the
    // 30-minute step forever, so any later blip cost half an hour of fallback no matter how many
    // healthy months lay between. Reproduced as refusal -> strict success -> refusal landing on the
    // FIVE minute step instead of sixty seconds.
    const { callLLM } = freshLlm();
    let refuseNow = true;
    const sent = stubFetch(({ format }) => (
        format === 'json_schema' && refuseNow
            ? { status: 400, body: JSON.stringify({ error: { message: 'Invalid schema for response_format' } }) }
            : completion({ ok: true })));

    atSecond(0);
    await callLLM({ system: 's', user: 'u', schema: { type: 'object' }, schemaName: 'flaky', maxTokens: 50 });  // strike 1
    refuseNow = false;
    atSecond(61);
    await callLLM({ system: 's', user: 'u', schema: { type: 'object' }, schemaName: 'flaky', maxTokens: 50 });  // strict SUCCESS
    refuseNow = true;
    atSecond(120);
    await callLLM({ system: 's', user: 'u', schema: { type: 'object' }, schemaName: 'flaky', maxTokens: 50 });  // refused again
    refuseNow = false;

    // If the history reset, this refusal is strike 1 again -> a 60s window -> retried at +61s.
    const before = sent.length;
    atSecond(182);
    await callLLM({ system: 's', user: 'u', schema: { type: 'object' }, schemaName: 'flaky', maxTokens: 50 });
    restoreClock();
    assert.strictEqual(sent.slice(before)[0]?.format, 'json_schema',
        'the strike count survived a proven success, so the backoff was longer than a first failure');
});

await check('THE REAL llama refusal is model-wide — read from a production log, not imagined', async () => {
    // Verbatim from Railway, 2026-08-11 00:54:21, twenty seconds after the deploy that added this
    // logging. The classifier called it schema-scoped and it is unmistakably about the MODEL; the
    // pattern required `response_format` with an underscore where Groq writes a space.
    //
    // Both of us reasoned about this string rather than reading one: Codex asked for a negative test
    // on the underscore form, and the case I deleted to make room for it used the space form that
    // production actually sends. This case exists so the next change to that pattern is measured
    // against the provider's real words.
    const REAL = 'This model does not support response format `json_schema`. '
        + 'See supported models at https://console.groq.com/docs/structured-outputs#supported-models';
    const { callLLM } = freshLlm();
    const sent = stubFetch(({ format }) => (
        format === 'json_schema'
            ? { status: 400, body: JSON.stringify({ error: { type: 'invalid_request_error', message: REAL } }) }
            : completion({ ok: true })));

    atSecond(0);
    await callLLM({ system: 's', user: 'u', schema: { type: 'object' }, schemaName: 'shape_one', maxTokens: 50 });
    const firstRound = sent.length;
    // a DIFFERENT schema, and an hour later: a model that cannot do json_schema at all must not be
    // asked again. Before the fix each of the nine schemas paid its own 400, then re-probed forever.
    atSecond(3600);
    await callLLM({ system: 's', user: 'u', schema: { type: 'object' }, schemaName: 'shape_two', maxTokens: 50 });
    restoreClock();

    assert.ok(!sent.slice(firstRound).some(x => x.format === 'json_schema'),
        'the real llama refusal was treated as schema-scoped, so every schema re-discovers it and re-probes forever');
});

// Sentences that MENTION a model but do not say the model lacks the capability. Codex #114 P1
// reproduced both being promoted to a permanent process-wide skip by a pattern that looked for
// `model ... does not support ... response format` inside a 60-character window without checking
// that "model" was the grammatical subject.
for (const [label, message] of [
    ['"this model REQUEST does not support..."', 'This model request does not support response format json_schema.'],
    ['"the MODEL-GENERATED SCHEMA does not support..."', 'The model-generated schema does not support nested objects in this response format.'],
]) {
    await check(`${label} is schema-scoped, not model-wide`, async () => {
        const { callLLM } = freshLlm();
        const sent = stubFetch(({ format }) => (
            format === 'json_schema'
                ? { status: 400, body: JSON.stringify({ error: { message } }) }
                : completion({ ok: true })));
        atSecond(0);
        await callLLM({ system: 's', user: 'u', schema: { type: 'object' }, schemaName: 'shape_a', maxTokens: 50 });
        const firstRound = sent.length;
        // A DIFFERENT schema, immediately. A model-wide verdict would send it straight to
        // json_object; a schema-scoped one leaves this schema free to try strict output.
        await callLLM({ system: 's', user: 'u', schema: { type: 'object' }, schemaName: 'shape_b', maxTokens: 50 });
        restoreClock();
        assert.strictEqual(sent.slice(firstRound)[0]?.format, 'json_schema',
            'a sentence that merely mentions a model disabled structured output for every schema');
    });
}

await check('"THE model does not support..." is currently schema-scoped — a deliberate strictness', async () => {
    // Not a bug report: a record of a CHOICE, so that widening the pattern later is a decision rather
    // than a drift. Dropping the `this` from the pattern is behaviourally invisible to every other
    // case in this file — it survived a mutation sweep — and the difference it does make is here.
    //
    // Groq sends "This model does not support...". A provider writing "The model does not support..."
    // is plausible and would be classified SCHEMA-scoped by the current pattern: that schema pays a
    // 400 and re-probes on backoff, instead of one permanent skip. Wasteful, not harmful, and it is
    // the direction the bias deliberately errs in — the opposite mistake mutes structured output
    // process-wide on a sentence that never said the model was incapable.
    //
    // If such a refusal is ever captured, widen the pattern AND move this case to the positive list.
    const { callLLM } = freshLlm();
    const sent = stubFetch(({ format }) => (
        format === 'json_schema'
            ? { status: 400, body: JSON.stringify({ error: { message: 'The model does not support response format `json_schema`.' } }) }
            : completion({ ok: true })));
    atSecond(0);
    await callLLM({ system: 's', user: 'u', schema: { type: 'object' }, schemaName: 'shape_a', maxTokens: 50 });
    const firstRound = sent.length;
    await callLLM({ system: 's', user: 'u', schema: { type: 'object' }, schemaName: 'shape_b', maxTokens: 50 });
    restoreClock();
    assert.strictEqual(sent.slice(firstRound)[0]?.format, 'json_schema',
        'the pattern was widened past the captured sentence without updating this case');
});

console.log(`\n${passes} passed, ${failures} failed`);
if (failures) { console.log('One refused schema can silently mute structured output for every other endpoint.'); process.exit(1); }
console.log('Format skip: scoped to the schema that was refused, model-wide only when the format itself is refused.');
process.exit(0);
