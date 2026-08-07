// tests/llm-token-cap.mjs — #stickycap: surviving a 413 instead of dying on it.
//
// THE BUG (found live 2026-08-06, on the production Groq endpoint). Every LLM endpoint asks for
// 120-900 completion tokens and works. The DM tale-writer asked for 6000 and got a hard 413 on
// every call, so backstory enrichment had been silently dead in production for some time —
// soft-failing to procedural tales, which is exactly why nobody noticed. `_llm.js`'s retry loop
// only ever retried 400/422 (format rejections); a 413 broke out immediately with no degradation.
//
// Rather than hardcode a ceiling for a model this code cannot see (RY_FARMS_LLM_MODEL is set in the
// deploy env, and providers move these limits), the fix HALVES and RETRIES, then remembers what the
// model accepted — the same shape as the existing #stickyformat memory.
//
// No API key and no network: `fetch` is stubbed, so this runs anywhere and bills nothing. That is
// also the only way to test it at all — the real ceiling lives on someone else's server.

import assert from 'node:assert';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

let passes = 0, failures = 0;
async function check(name, fn) {
    try { await fn(); console.log(`  PASS  ${name}`); passes++; }
    catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failures++; }
}

// A local-looking base keeps resolveLLM in 'local' mode: no key, no billing, no paid opt-in.
process.env.OPENAI_BASE_URL = 'http://127.0.0.1:9/v1';
process.env.RY_FARMS_LLM_MODEL = 'test-model';
delete process.env.RY_FARMS_LLM_OFF;

console.log('\n#stickycap — a refused completion size degrades instead of dying\n');

// Fake upstream: rejects any max_tokens above `ceiling` with 413, mirroring the real failure.
function stubUpstream({ ceiling, log }) {
    globalThis.fetch = async (_url, opts) => {
        const body = JSON.parse(opts.body);
        log.push({ max_tokens: body.max_tokens, format: body.response_format?.type ?? 'none' });
        if (body.max_tokens > ceiling) {
            return { ok: false, status: 413, json: async () => ({}), text: async () => '{"error":{"message":"Request too large"}}' };
        }
        return {
            ok: true, status: 200,
            json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }),
            text: async () => '',
        };
    };
}

function freshState() {
    // callLLM keeps budget/breaker/caps on globalThis so they survive server.mjs's cache purge —
    // so a test must clear them explicitly or cases leak into each other.
    delete globalThis.__ryFarmsLlmState;
    for (const k of Object.keys(require.cache)) if (k.includes('_llm.js')) delete require.cache[k];
    return require('../api/_llm.js');
}

const SCHEMA = { type: 'object', properties: { ok: { type: 'boolean' } } };

await check('a 413 is retried at half the size instead of thrown', async () => {
    const log = [];
    stubUpstream({ ceiling: 1500, log });
    const { callLLM } = freshState();
    const out = await callLLM({ system: 's', user: 'u', schema: SCHEMA, maxTokens: 6000 });
    assert.deepStrictEqual(out, { ok: true }, 'the call should ultimately succeed');
    assert.deepStrictEqual(log.map(l => l.max_tokens), [6000, 3000, 1500],
        `expected halving 6000->3000->1500, got ${JSON.stringify(log.map(l => l.max_tokens))}`);
});

await check('the discovered ceiling is REMEMBERED — the next call pays no 413', async () => {
    const log = [];
    stubUpstream({ ceiling: 1500, log });
    const { callLLM } = freshState();
    await callLLM({ system: 's', user: 'u', schema: SCHEMA, maxTokens: 6000 });   // discovers 1500
    log.length = 0;
    await callLLM({ system: 's', user: 'u', schema: SCHEMA, maxTokens: 6000 });   // should start at 1500
    assert.deepStrictEqual(log.map(l => l.max_tokens), [1500],
        `a remembered cap should mean ONE request, got ${JSON.stringify(log.map(l => l.max_tokens))}`);
});

await check('a small caller is NOT throttled by another caller\'s discovered cap', async () => {
    // The subtle one. If every success recorded a cap, a 200-token whisper would pin the model at
    // 200 and then silently shrink a later 900-token congregation call.
    const log = [];
    stubUpstream({ ceiling: 1500, log });
    const { callLLM } = freshState();
    await callLLM({ system: 's', user: 'u', schema: SCHEMA, maxTokens: 200 });    // succeeds first try
    log.length = 0;
    await callLLM({ system: 's', user: 'u', schema: SCHEMA, maxTokens: 900 });
    assert.strictEqual(log[0].max_tokens, 900,
        `a 200-token success wrongly capped a later 900-token call at ${log[0].max_tokens}`);
});

await check('halving STOPS at the floor rather than shrinking forever', async () => {
    const log = [];
    stubUpstream({ ceiling: 1, log });   // nothing will ever be accepted
    const { callLLM } = freshState();
    await assert.rejects(
        () => callLLM({ system: 's', user: 'u', schema: SCHEMA, maxTokens: 6000 }),
        /413/,
        'an unsatisfiable ceiling must still fail honestly, not hang or loop',
    );
    const asks = log.map(l => l.max_tokens);
    assert.ok(asks.length <= 6, `too many attempts (${asks.length}): ${JSON.stringify(asks)}`);
    assert.ok(Math.min(...asks) >= 256, `asked below the 256 floor: ${JSON.stringify(asks)}`);
});

await check('the floor binds for a SMALL caller, where the halving budget alone would not', async () => {
    // Added after a mutation escaped: starting at 6000, CAP_MAX_HALVINGS stops the descent at 375,
    // so the 256 floor never actually engages and deleting it changed nothing. A 900-token caller
    // is where the floor does the work — without it the retries walk down to 56 tokens, which no
    // structured reply can complete, wasting requests to produce garbage.
    const log = [];
    stubUpstream({ ceiling: 1, log });
    const { callLLM } = freshState();
    await assert.rejects(() => callLLM({ system: 's', user: 'u', schema: SCHEMA, maxTokens: 900 }), /413/);
    const asks = log.map(l => l.max_tokens);
    assert.ok(Math.min(...asks) >= 256,
        `descended below the ${256}-token floor: ${JSON.stringify(asks)}`);
    assert.deepStrictEqual(asks, [900, 450, 256], `unexpected descent: ${JSON.stringify(asks)}`);
});

await check('a size rejection does not get blamed on the response FORMAT', async () => {
    // The reason the retry is a nested loop. If halving happened inside the format loop, a 413
    // would burn through json_schema -> json_object -> none and poison #stickyformat for a model
    // whose format support was never in question.
    const log = [];
    stubUpstream({ ceiling: 1500, log });
    const { callLLM } = freshState();
    await callLLM({ system: 's', user: 'u', schema: SCHEMA, maxTokens: 6000 });
    const formats = [...new Set(log.map(l => l.format))];
    assert.deepStrictEqual(formats, ['json_schema'],
        `the 413 retries should stay on the SAME format, but tried: ${JSON.stringify(formats)}`);
});

await check('a 400 still falls back through formats (the old behaviour is intact)', async () => {
    const log = [];
    globalThis.fetch = async (_url, opts) => {
        const body = JSON.parse(opts.body);
        log.push(body.response_format?.type ?? 'none');
        if (body.response_format?.type === 'json_schema') return { ok: false, status: 400, json: async () => ({}), text: async () => '{"error":{"message":"response_format not supported"}}' };
        return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }), text: async () => '' };
    };
    const { callLLM } = freshState();
    const out = await callLLM({ system: 's', user: 'u', schema: SCHEMA, maxTokens: 320 });
    assert.deepStrictEqual(out, { ok: true });
    assert.deepStrictEqual(log, ['json_schema', 'json_object'], `format fallback broke: ${JSON.stringify(log)}`);
});

await check('a 500 still fails fast without trying every format or size', async () => {
    const log = [];
    globalThis.fetch = async (_url, opts) => {
        log.push(JSON.parse(opts.body).max_tokens);
        return { ok: false, status: 500, json: async () => ({}), text: async () => 'upstream boom' };
    };
    const { callLLM } = freshState();
    await assert.rejects(() => callLLM({ system: 's', user: 'u', schema: SCHEMA, maxTokens: 6000 }), /500/);
    assert.strictEqual(log.length, 1, `a 500 should be one attempt, not ${log.length}`);
});


// ---- #modelchain + #reasoning ------------------------------------------------------------------
// Added 2026-08-07, after llama-3.1-8b-instant turned out to have a shutdown date (2026-08-16) and a
// single hardcoded model name was found to be a silent single point of failure for EVERY LLM feature.

function stubChain({ gone = [], log, reasoningRequired = false }) {
    globalThis.fetch = async (_url, opts) => {
        const body = JSON.parse(opts.body);
        log.push({ model: body.model, effort: body.reasoning_effort ?? null });
        if (gone.includes(body.model)) {
            return { ok: false, status: 400, json: async () => ({}),
                text: async () => `{"error":{"message":"The model \`${body.model}\` has been decommissioned","code":"model_decommissioned"}}` };
        }
        // Mirrors the real llama behaviour: a model that does not take reasoning_effort hard-400s.
        if (!reasoningRequired && body.reasoning_effort && !/gpt-oss/.test(body.model)) {
            return { ok: false, status: 400, json: async () => ({}),
                text: async () => '{"error":{"message":"`reasoning_effort` is not supported with this model"}}' };
        }
        return { ok: true, status: 200, text: async () => '',
            json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }) };
    };
}

await check('a DECOMMISSIONED model falls over to the next in the chain', async () => {
    const log = [];
    stubChain({ gone: ['dead-one'], log });
    process.env.RY_FARMS_LLM_MODELS = 'dead-one,live-two';
    const { callLLM } = freshState();
    const out = await callLLM({ system: 's', user: 'u', schema: SCHEMA, maxTokens: 320 });
    assert.deepStrictEqual(out, { ok: true });
    assert.deepStrictEqual(log.map(l => l.model), ['dead-one', 'live-two'],
        `expected failover, got ${JSON.stringify(log.map(l => l.model))}`);
});

await check('the dead model is REMEMBERED — later calls skip it entirely', async () => {
    const log = [];
    stubChain({ gone: ['dead-one'], log });
    process.env.RY_FARMS_LLM_MODELS = 'dead-one,live-two';
    const { callLLM } = freshState();
    await callLLM({ system: 's', user: 'u', schema: SCHEMA, maxTokens: 320 });
    log.length = 0;
    await callLLM({ system: 's', user: 'u', schema: SCHEMA, maxTokens: 320 });
    assert.deepStrictEqual(log.map(l => l.model), ['live-two'],
        `a retired model should never be tried again this process, got ${JSON.stringify(log.map(l => l.model))}`);
});

await check('a FORMAT rejection does not retire a healthy model (the 400 trap)', async () => {
    // Both retirement and format rejection arrive as 400. Reading only the status would retire a
    // perfectly good model the first time it declined strict json_schema — which is exactly what
    // llama models do on every single call.
    const log = [];
    globalThis.fetch = async (_url, opts) => {
        const body = JSON.parse(opts.body);
        log.push({ model: body.model, format: body.response_format?.type ?? 'none' });
        if (body.response_format?.type === 'json_schema') {
            return { ok: false, status: 400, json: async () => ({}),
                text: async () => '{"error":{"message":"response_format json_schema is not supported"}}' };
        }
        return { ok: true, status: 200, text: async () => '',
            json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }) };
    };
    process.env.RY_FARMS_LLM_MODELS = 'picky-one,never-reached';
    const { callLLM } = freshState();
    await callLLM({ system: 's', user: 'u', schema: SCHEMA, maxTokens: 320 });
    assert.deepStrictEqual([...new Set(log.map(l => l.model))], ['picky-one'],
        'a format rejection wrongly retired the model and fell through the chain');
});

await check('reasoning_effort is sent ONLY to gpt-oss models', async () => {
    const log = [];
    stubChain({ log });
    process.env.RY_FARMS_LLM_MODELS = 'openai/gpt-oss-120b';
    let { callLLM } = freshState();
    await callLLM({ system: 's', user: 'u', schema: SCHEMA, maxTokens: 320 });
    assert.strictEqual(log[0].effort, 'low', 'a gpt-oss model must receive reasoning_effort');

    log.length = 0;
    process.env.RY_FARMS_LLM_MODELS = 'llama-3.3-70b-versatile';
    ({ callLLM } = freshState());
    await callLLM({ system: 's', user: 'u', schema: SCHEMA, maxTokens: 320 });
    assert.strictEqual(log[0].effort, null,
        'sending reasoning_effort to a llama model is a hard 400 — it must be omitted');
});

await check('an all-dead chain retries everything rather than muting the game forever', async () => {
    const log = [];
    stubChain({ gone: ['a', 'b'], log });
    process.env.RY_FARMS_LLM_MODELS = 'a,b';
    const { callLLM } = freshState();
    await assert.rejects(() => callLLM({ system: 's', user: 'u', schema: SCHEMA, maxTokens: 320 }));
    log.length = 0;
    // Both are now marked dead. A naive filter would leave an EMPTY chain and never call again.
    await assert.rejects(() => callLLM({ system: 's', user: 'u', schema: SCHEMA, maxTokens: 320 }));
    assert.ok(log.length > 0, 'an all-dead chain stopped calling entirely — a provider blip would mute the game permanently');
});

delete process.env.RY_FARMS_LLM_MODELS;

// ---- Codex #104 regressions -------------------------------------------------------------------

function stubStatus({ first, log, body = '{}' }) {
    // `first` decides what the FIRST model in the chain returns; anything else succeeds.
    let seen = 0;
    globalThis.fetch = async (_url, opts) => {
        const b = JSON.parse(opts.body);
        log.push({ model: b.model });
        if (seen++ === 0) return { ok: false, status: first, json: async () => ({}), text: async () => body };
        return { ok: true, status: 200, text: async () => '',
            json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }) };
    };
}

await check('P1-3: "no longer supported" prose does NOT retire a healthy model', async () => {
    // Codex reproduced this exactly: a parameter error retired a working model for the whole
    // process, because _modelDead is process-lifetime. One bad request demoted a good model.
    const log = [];
    stubStatus({ first: 400, log, body: '{"error":{"message":"response_format json_schema is no longer supported","type":"invalid_request_error"}}' });
    process.env.RY_FARMS_LLM_MODELS = 'healthy-one,should-not-be-reached';
    const { callLLM } = freshState();
    await callLLM({ system: 's', user: 'u', schema: SCHEMA, maxTokens: 320 });
    assert.deepStrictEqual([...new Set(log.map(l => l.model))], ['healthy-one'],
        'a parameter error retired the model and fell through the chain');
});

await check('P1-3: a STRUCTURED decommission code does retire it', async () => {
    const log = [];
    stubStatus({ first: 400, log, body: '{"error":{"message":"anything at all","code":"model_decommissioned"}}' });
    process.env.RY_FARMS_LLM_MODELS = 'retired-one,live-two';
    const { callLLM } = freshState();
    await callLLM({ system: 's', user: 'u', schema: SCHEMA, maxTokens: 320 });
    assert.deepStrictEqual(log.map(l => l.model), ['retired-one', 'live-two']);
});

await check('P1-3: retirement PROSE counts only when it names the model itself', async () => {
    const log = [];
    stubStatus({ first: 400, log, body: '{"error":{"message":"The model `retired-one` has been decommissioned"}}' });
    process.env.RY_FARMS_LLM_MODELS = 'retired-one,live-two';
    const { callLLM } = freshState();
    await callLLM({ system: 's', user: 'u', schema: SCHEMA, maxTokens: 320 });
    assert.deepStrictEqual(log.map(l => l.model), ['retired-one', 'live-two'],
        'prose naming the model should be trusted');
});

await check('P1-4: a model-scoped 429 tries the NEXT model instead of muting the chain', async () => {
    const log = [];
    stubStatus({ first: 429, log, body: '{"error":{"message":"Rate limit reached for model `busy-one`"}}' });
    process.env.RY_FARMS_LLM_MODELS = 'busy-one,free-two';
    const { callLLM } = freshState();
    const out = await callLLM({ system: 's', user: 'u', schema: SCHEMA, maxTokens: 320 });
    assert.deepStrictEqual(out, { ok: true }, 'the second model should have answered');
    assert.deepStrictEqual(log.map(l => l.model), ['busy-one', 'free-two'],
        'a per-model rate limit opened the global breaker before trying the alternative');
});

await check('P1-4: a 403 on one model tries the next (per-model permissions)', async () => {
    const log = [];
    stubStatus({ first: 403, log, body: '{"error":{"message":"no access to model `blocked-one`"}}' });
    process.env.RY_FARMS_LLM_MODELS = 'blocked-one,allowed-two';
    const { callLLM } = freshState();
    await callLLM({ system: 's', user: 'u', schema: SCHEMA, maxTokens: 320 });
    assert.deepStrictEqual(log.map(l => l.model), ['blocked-one', 'allowed-two']);
});

await check('P1-4: a 429 on the LAST model still opens the breaker', async () => {
    // The chain must not swallow a genuine provider-wide exhaustion. Once there is nothing left to
    // try, the old fail-fast behaviour has to stand or bursts keep hammering a spent quota.
    const log = [];
    globalThis.fetch = async (_url, opts) => {
        log.push({ model: JSON.parse(opts.body).model });
        return { ok: false, status: 429, json: async () => ({}), text: async () => '{"error":{"message":"Rate limit reached"}}' };
    };
    process.env.RY_FARMS_LLM_MODELS = 'only-one';
    const { callLLM } = freshState();
    await assert.rejects(() => callLLM({ system: 's', user: 'u', schema: SCHEMA, maxTokens: 320 }));
    // the breaker should now be open: a fresh call is refused without touching the network
    log.length = 0;
    const mod = require('../api/_llm.js');
    await assert.rejects(() => mod.callLLM({ system: 's', user: 'u', schema: SCHEMA, maxTokens: 320 }), /breaker/i);
    assert.strictEqual(log.length, 0, 'the breaker should have refused before any request');
});

await check('P1-2: the default chain contains no model with a known shutdown date', async () => {
    // llama-3.3-70b-versatile shuts down 2026-08-16 — the SAME day as llama-3.1-8b-instant — so as a
    // fallback it offered no resilience against the event the chain exists to survive. A model's
    // lifecycle is a POLICY fact; the probe proves a model answers today, never that it will exist
    // next week. This asserts against the real modelChain(), not a copy of the constant.
    delete process.env.RY_FARMS_LLM_MODELS;
    delete process.env.RY_FARMS_LLM_MODEL;
    delete process.env.OPENAI_MODEL;
    const { modelChain } = freshState();
    assert.strictEqual(typeof modelChain, 'function', 'modelChain must be exported for this to mean anything');
    const chain = modelChain();
    assert.ok(chain.length >= 1, 'the default chain must not be empty');
    const retiring = chain.filter(m => /^llama-3\.(1|3)-/.test(m));
    assert.deepStrictEqual(retiring, [],
        `default chain contains models with a 2026-08-16 shutdown: ${JSON.stringify(retiring)}`);
});

await check('P1-2: isModelGone is exported and rejects the reproduced false positive', async () => {
    const { isModelGone } = freshState();
    assert.strictEqual(
        isModelGone(400, '{"error":{"message":"response_format json_schema is no longer supported"}}', 'healthy'),
        false, 'the exact string Codex reproduced must not read as retirement');
    assert.strictEqual(
        isModelGone(400, '{"error":{"code":"model_decommissioned"}}', 'anything'),
        true, 'a structured code must read as retirement');
    assert.strictEqual(
        isModelGone(400, '{"error":{"message":"The model `x` has been decommissioned"}}', 'x'),
        true, 'prose naming the model must read as retirement');
    assert.strictEqual(
        isModelGone(400, '{"error":{"message":"The model `other` has been decommissioned"}}', 'x'),
        false, 'prose naming a DIFFERENT model must not retire this one');
});

// ---- report ------------------------------------------------------------------------------------
console.log(`\n${passes} passed, ${failures} failed`);
if (failures) {
    console.log('LLM resilience is broken — a model retirement or a size limit would silently mute the game.');
    process.exit(1);
}
console.log('LLM resilience: 413 degrades, retired models fail over, reasoning_effort goes only where it is supported.');
process.exit(0);
