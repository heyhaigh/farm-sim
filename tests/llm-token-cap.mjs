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
// Most cases here exercise the 413/format/chain paths with synthetic 6000-token asks. The token
// budget is a SEPARATE guard, and left at its 5000 default it refuses those before they are ever
// attempted — so the cases would pass or fail for the wrong reason. The budget's own behaviour is
// pinned by the #tokenbudget block near the end, which sets its own limits per case.
process.env.RY_FARMS_TOKEN_BUDGET = '1000000';

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

await check('a discovered cap is NOT remembered across calls (Codex #105 P1-1)', async () => {
    // This case previously asserted the OPPOSITE — that the ceiling was cached to avoid paying the
    // 413 twice. Codex reproduced the harm: a cap learned from one caller throttled a different
    // caller with different needs, permanently, even after upstream capacity recovered. And the
    // signal was never sound: 413 is documented as a request-SIZE error, so a busy-minute 413 says
    // nothing durable about the model. Retry smaller now, remember nothing.
    const log = [];
    stubUpstream({ ceiling: 1500, log });
    const { callLLM } = freshState();
    await callLLM({ system: 's', user: 'u', schema: SCHEMA, maxTokens: 6000 });
    log.length = 0;
    await callLLM({ system: 's', user: 'u', schema: SCHEMA, maxTokens: 6000 });
    assert.deepStrictEqual(log.map(l => l.max_tokens), [6000, 3000, 1500],
        'the second call reused a cached ceiling instead of asking for what it needed');
});

await check('P1-1: a DM 413 does not throttle a later, larger caller', async () => {
    // Codex's exact reproduction: DM discovers 750, then congregation asks for 900 after upstream
    // capacity recovered — and got 750. The ceiling moves between the two calls to prove the second
    // caller is not carrying the first one's scar.
    const log = [];
    let ceiling = 750;
    globalThis.fetch = async (_url, opts) => {
        const b = JSON.parse(opts.body);
        log.push(b.max_tokens);
        if (b.max_tokens > ceiling) return { ok: false, status: 413, json: async () => ({}), text: async () => '{"error":{"message":"Request too large"}}' };
        return { ok: true, status: 200, text: async () => '',
            json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }) };
    };
    const { callLLM } = freshState();
    await callLLM({ system: 's', user: 'u', schema: SCHEMA, maxTokens: 1500 });   // DM: discovers 750
    ceiling = 6000;   // the busy minute passes; upstream capacity is back
    log.length = 0;
    await callLLM({ system: 's', user: 'u', schema: SCHEMA, maxTokens: 900 });    // congregation
    assert.strictEqual(log[0], 900,
        `congregation asked for ${log[0]} instead of 900 — it inherited DM's transient ceiling`);
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

// ---- Codex #105 regressions --------------------------------------------------------------------

await check('P1-4: a generic 404 does NOT retire a model (route errors are not lifecycle events)', async () => {
    const { isModelGone } = freshState();
    assert.strictEqual(isModelGone(404, '{"error":{"message":"route not found"}}', 'healthy-one'), false,
        'Codex reproduced `404 route not found` killing a healthy model');
    assert.strictEqual(isModelGone(404, '{"error":{"code":"model_not_found"}}', 'gone-one'), true,
        'a 404 WITH a model code is still retirement');
    assert.strictEqual(isModelGone(404, '{"error":{"message":"The model `gone-one` is retired"}}', 'gone-one'), true,
        'a 404 naming the model is still retirement');
});

await check('P1-4: the over-generic does_not_exist code no longer retires a model', async () => {
    const { isModelGone } = freshState();
    assert.strictEqual(
        isModelGone(400, '{"error":{"message":"schema property missing","code":"does_not_exist"}}', 'healthy-one'),
        false, 'does_not_exist can describe a schema or parameter, not just a model');
});

await check('P2-5: a terminal 429 costs ONE upstream call, not one per format', async () => {
    // Codex counted three identical 429s from a single logical call, because opening the breaker
    // did not stop the format loop. A rate limit is not a format problem.
    const log = [];
    globalThis.fetch = async (_url, opts) => {
        log.push(JSON.parse(opts.body).response_format?.type ?? 'none');
        return { ok: false, status: 429, json: async () => ({}), text: async () => '{"error":{"message":"Rate limit reached"}}' };
    };
    process.env.RY_FARMS_LLM_MODELS = 'only-one';
    const { callLLM } = freshState();
    await assert.rejects(() => callLLM({ system: 's', user: 'u', schema: SCHEMA, maxTokens: 320 }));
    assert.strictEqual(log.length, 1, `a terminal 429 burned ${log.length} requests: ${JSON.stringify(log)}`);
});

await check('P2-5: a terminal 403 also stops immediately', async () => {
    const log = [];
    globalThis.fetch = async (_url, opts) => {
        log.push(JSON.parse(opts.body).response_format?.type ?? 'none');
        return { ok: false, status: 403, json: async () => ({}), text: async () => '{"error":{"message":"no access"}}' };
    };
    process.env.RY_FARMS_LLM_MODELS = 'only-one';
    const { callLLM } = freshState();
    await assert.rejects(() => callLLM({ system: 's', user: 'u', schema: SCHEMA, maxTokens: 320 }));
    assert.strictEqual(log.length, 1, `a terminal 403 burned ${log.length} requests`);
});

// ---- #tokenbudget (Codex #106 P1-2) ------------------------------------------------------------
// Counting REQUESTS protected nothing: Groq meters tokens per minute and charges the REQUESTED
// max_tokens, so 26 permitted calls could reserve 20,000+ against an 8k ceiling. And the limit is
// per ORGANISATION, so every browser's enrichment timer lands on one server key — the guard has to
// live server-side, where they all meet.

function stubOk(log) {
    globalThis.fetch = async (_url, opts) => {
        const b = JSON.parse(opts.body);
        log.push(b.max_tokens);
        return { ok: true, status: 200, text: async () => '',
            json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }) };
    };
}

await check('the token budget stops a burst that the REQUEST cap would have allowed', async () => {
    const log = [];
    stubOk(log);
    process.env.RY_FARMS_TOKEN_BUDGET = '5000';
    process.env.RY_FARMS_LLM_MODELS = 'm';
    const { callLLM } = freshState();
    // 900-token calls: the request cap (26) would permit 26 of these — 23,400 tokens.
    let allowed = 0;
    for (let i = 0; i < 26; i++) {
        try { await callLLM({ system: 's', user: 'u', schema: SCHEMA, maxTokens: 900 }); allowed++; }
        catch { break; }
    }
    assert.ok(allowed < 26, 'the request cap alone let the whole burst through');
    assert.ok(allowed >= 4 && allowed <= 6, `expected ~5 calls inside a 5000-token minute, got ${allowed}`);
});

await check('BACKGROUND work yields before interactive work does', async () => {
    // The point of the priority split: a player waiting on a whisper must outrank a biography
    // nobody asked for, which runs on a timer in every open tab and would otherwise win by volume.
    const log = [];
    stubOk(log);
    process.env.RY_FARMS_TOKEN_BUDGET = '5000';
    process.env.RY_FARMS_LLM_MODELS = 'm';
    const { callLLM } = freshState();
    // Spend to ~65% of the minute with interactive traffic.
    for (let i = 0; i < 4; i++) await callLLM({ system: 's', user: 'u', schema: SCHEMA, maxTokens: 800 });
    await assert.rejects(
        () => callLLM({ system: 's', user: 'u', schema: SCHEMA, maxTokens: 800, priority: 'background' }),
        /background/,
        'background work should be refused past its lower ceiling');
    // ...while an interactive call still gets through on the same budget.
    await callLLM({ system: 's', user: 'u', schema: SCHEMA, maxTokens: 800 });
});

await check('the window resets, so a quiet minute restores the whole budget', async () => {
    const log = [];
    stubOk(log);
    process.env.RY_FARMS_TOKEN_BUDGET = '2000';
    process.env.RY_FARMS_LLM_MODELS = 'm';
    const { callLLM } = freshState();
    await callLLM({ system: 's', user: 'u', schema: SCHEMA, maxTokens: 900 });
    await callLLM({ system: 's', user: 'u', schema: SCHEMA, maxTokens: 900 });
    await assert.rejects(() => callLLM({ system: 's', user: 'u', schema: SCHEMA, maxTokens: 900 }), /token budget/);
    // move past the window
    const real = Date.now; const base = real();
    Date.now = () => base + 61_000;
    try { await callLLM({ system: 's', user: 'u', schema: SCHEMA, maxTokens: 900 }); }
    finally { Date.now = real; }
});

await check('the PROMPT counts too, not just the reservation', async () => {
    // Groq bills prompt + completion against the window. A budget that only counted max_tokens
    // would let a 2,000-word prompt sail through as if it were free.
    stubOk([]);
    process.env.RY_FARMS_TOKEN_BUDGET = '2000';
    process.env.RY_FARMS_LLM_MODELS = 'm';
    const { callLLM } = freshState();
    const huge = 'x'.repeat(6000);   // ~1500 tokens of prompt on its own
    await callLLM({ system: huge, user: 'u', schema: SCHEMA, maxTokens: 200 });
    await assert.rejects(
        () => callLLM({ system: huge, user: 'u', schema: SCHEMA, maxTokens: 200 }),
        /token budget/,
        'two large prompts fitted in a 2000-token minute — the prompt is not being counted');
});

await check('a FAILED call still spends its allowance', async () => {
    // The provider reserved it either way. Charging only on success would let a failing burst
    // hammer the quota for free, which is exactly when a burst is most likely.
    globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({}), text: async () => 'boom' });
    process.env.RY_FARMS_TOKEN_BUDGET = '1000';
    process.env.RY_FARMS_LLM_MODELS = 'm';
    const { callLLM } = freshState();
    await assert.rejects(() => callLLM({ system: 's', user: 'u', schema: SCHEMA, maxTokens: 900 }));
    await assert.rejects(
        () => callLLM({ system: 's', user: 'u', schema: SCHEMA, maxTokens: 900 }),
        /token budget/,
        'a failed call was refunded — a failing burst would run unmetered');
});

process.env.RY_FARMS_TOKEN_BUDGET = '1000000';   // restore headroom for any later case

await check('an ask LARGER than the whole minute is refused, not attempted', async () => {
    // Deliberate: a request that cannot fit the window can never succeed — Groq would reject it —
    // so spending the call to find that out is pure waste. This surfaced when the budget landed and
    // several 6000-token cases stopped reaching the network at all; that is the right behaviour,
    // and it is now a rule rather than a side effect. Production's largest ask is 900, so no real
    // caller is affected.
    const log = [];
    stubOk(log);
    process.env.RY_FARMS_TOKEN_BUDGET = '5000';
    process.env.RY_FARMS_LLM_MODELS = 'm';
    const { callLLM } = freshState();
    await assert.rejects(
        () => callLLM({ system: 's', user: 'u', schema: SCHEMA, maxTokens: 6000 }),
        /token budget/,
        'an impossible ask should be refused locally');
    assert.strictEqual(log.length, 0, 'it must not reach the network at all');
    process.env.RY_FARMS_TOKEN_BUDGET = '1000000';
});

await check('P1-1: no boundary burst — the window is rolling, not a fixed bucket', async () => {
    // Codex's exact reproduction: 1 token at t=0, then 4,998 at t=59.999s and another at t=60.001s.
    // A fixed bucket resets wholesale at the boundary and lets both through — 9,996 tokens reserved
    // inside two milliseconds against a 5,000 ceiling, over the provider's own limit.
    const log = [];
    stubOk(log);
    process.env.RY_FARMS_TOKEN_BUDGET = '5000';
    process.env.RY_FARMS_LLM_MODELS = 'm';
    const { callLLM } = freshState();
    const real = Date.now; const t0 = real();
    try {
        Date.now = () => t0;
        await callLLM({ system: '', user: '', schema: SCHEMA, maxTokens: 1 });
        Date.now = () => t0 + 59_999;
        await callLLM({ system: '', user: '', schema: SCHEMA, maxTokens: 4900 });
        Date.now = () => t0 + 60_001;
        await assert.rejects(
            () => callLLM({ system: '', user: '', schema: SCHEMA, maxTokens: 4900 }),
            /token budget/,
            'the boundary let a second near-full reservation through 2ms later');
    } finally { Date.now = real; }
});

await check('P1-1: spend genuinely ages out of the rolling window', async () => {
    // The counterpart — the ledger must not simply accumulate forever, or a busy minute would
    // permanently mute the game.
    const log = [];
    stubOk(log);
    process.env.RY_FARMS_TOKEN_BUDGET = '5000';
    process.env.RY_FARMS_LLM_MODELS = 'm';
    const { callLLM } = freshState();
    const real = Date.now; const t0 = real();
    try {
        Date.now = () => t0;
        await callLLM({ system: '', user: '', schema: SCHEMA, maxTokens: 4900 });
        Date.now = () => t0 + 30_000;
        await assert.rejects(() => callLLM({ system: '', user: '', schema: SCHEMA, maxTokens: 4900 }), /token budget/);
        Date.now = () => t0 + 61_000;   // the first reservation is now older than the window
        await callLLM({ system: '', user: '', schema: SCHEMA, maxTokens: 4900 });
    } finally { Date.now = real; }
});

await check('P2-4: a malformed budget override does not disable metering', async () => {
    // `Number('5_000')` is NaN and every comparison against NaN is false, so a typo silently turned
    // the entire guard off and let all 26 requests through — 23,400 tokens reserved.
    for (const bad of ['5_000', 'abc', '-1', '0', 'Infinity']) {
        const log = [];
        stubOk(log);
        process.env.RY_FARMS_TOKEN_BUDGET = bad;
        process.env.RY_FARMS_LLM_MODELS = 'm';
        const { callLLM } = freshState();
        let allowed = 0;
        for (let i = 0; i < 26; i++) {
            try { await callLLM({ system: 's', user: 'u', schema: SCHEMA, maxTokens: 900 }); allowed++; }
            catch { break; }
        }
        assert.ok(allowed < 26, `RY_FARMS_TOKEN_BUDGET="${bad}" disabled metering — ${allowed} calls got through`);
    }
    process.env.RY_FARMS_TOKEN_BUDGET = '1000000';
});

await check('P2-3: the REQUEST cap rolls too — no burst across the boundary', async () => {
    // Codex reproduced 25 calls at t=59.999s and 26 at t=60.001s: 51 admitted inside two
    // milliseconds, because the request counter still reset wholesale while its comment promised a
    // rolling limit. Both caps now derive from one ledger, so there is no edge to sit on.
    const log = [];
    stubOk(log);
    process.env.RY_FARMS_TOKEN_BUDGET = '10000000';   // isolate the REQUEST cap from the token cap
    process.env.RY_FARMS_LLM_MODELS = 'm';
    const { callLLM } = freshState();
    const real = Date.now; const t0 = real();
    try {
        Date.now = () => t0 + 59_999;
        let ok = 0;
        for (let i = 0; i < 40; i++) {
            try { await callLLM({ system: '', user: '', schema: SCHEMA, maxTokens: 1 }); ok++; } catch { break; }
        }
        assert.strictEqual(ok, 26, `expected the 26-request cap, got ${ok}`);
        Date.now = () => t0 + 60_001;   // 2ms later: a fixed window would refill entirely
        await assert.rejects(
            () => callLLM({ system: '', user: '', schema: SCHEMA, maxTokens: 1 }),
            /budget exceeded/,
            'the request cap refilled at the boundary — 52 calls in one rolling minute');
        Date.now = () => t0 + 121_000;   // genuinely past the window
        await callLLM({ system: '', user: '', schema: SCHEMA, maxTokens: 1 });
    } finally { Date.now = real; process.env.RY_FARMS_TOKEN_BUDGET = '1000000'; }
});

await check('P2-3: the ledger counts UPSTREAM attempts, not logical calls', async () => {
    // Codex reproduced 26 logical calls issuing 52 upstream fetches against a stated 26-request
    // ceiling, because the charge sat outside the retry loops. A 413-halving path makes several
    // provider requests per call; the provider counts every one of them.
    const fetches = [];
    let ceiling = 300;
    globalThis.fetch = async (_url, opts) => {
        const b = JSON.parse(opts.body);
        fetches.push(b.max_tokens);
        if (b.max_tokens > ceiling) return { ok: false, status: 413, json: async () => ({}), text: async () => '{"error":{"message":"too large"}}' };
        return { ok: true, status: 200, text: async () => '',
            json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }) };
    };
    process.env.RY_FARMS_TOKEN_BUDGET = '1000000';   // isolate the REQUEST cap
    process.env.RY_FARMS_LLM_MODELS = 'm';
    const { callLLM } = freshState();
    // Each logical call halves 1200 -> 600 -> 300: three upstream attempts apiece.
    let logical = 0;
    for (let i = 0; i < 30; i++) {
        try { await callLLM({ system: '', user: '', schema: SCHEMA, maxTokens: 1200 }); logical++; }
        catch { break; }
    }
    assert.ok(fetches.length <= 26,
        `${fetches.length} upstream requests issued against a 26-request ceiling`);
    assert.ok(logical < 26,
        `${logical} logical calls were admitted — the ledger is still counting calls, not attempts`);
    process.env.RY_FARMS_TOKEN_BUDGET = '1000000';
});

await check('a FORMAT rejection is refunded; a metered rejection is not', async () => {
    // Found in a live run: the first congregation on any fresh process failed because json_schema
    // was refused, json_object retried, and two ~1530-token charges cleared the 3000 background
    // ceiling before a single token existed. A 400 is rejected at VALIDATION and meters nothing; a
    // 413 IS metered — that is why it was rejected. The ledger has to tell them apart.
    //
    // Asserted on the LEDGER rather than on a follow-up call: two successful large calls genuinely
    // do not fit a small budget, so "the next call succeeds" cannot separate the refund from the
    // budget simply being tight. (My first version of this case made exactly that mistake.)
    const ledger = () => globalThis.__ryFarmsLlmState.budget.spend;

    // (a) format rejection then success -> ONE entry, not two
    globalThis.fetch = async (_url, opts) => {
        const b = JSON.parse(opts.body);
        if (b.response_format?.type === 'json_schema') {
            return { ok: false, status: 400, json: async () => ({}), text: async () => '{"error":{"message":"response_format not supported"}}' };
        }
        return { ok: true, status: 200, text: async () => '',
            json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }) };
    };
    process.env.RY_FARMS_TOKEN_BUDGET = '1000000';
    process.env.RY_FARMS_LLM_MODELS = 'm';
    let { callLLM } = freshState();
    await callLLM({ system: 'x'.repeat(4000), user: '', schema: SCHEMA, maxTokens: 900 });
    assert.strictEqual(ledger().length, 1,
        `a refused format was charged: ledger holds ${ledger().length} entries, expected 1`);

    // (b) a 413 IS metered -> every attempt stays on the ledger
    globalThis.fetch = async (_url, opts) => {
        const b = JSON.parse(opts.body);
        if (b.max_tokens > 300) return { ok: false, status: 413, json: async () => ({}), text: async () => '{"error":{"message":"too large"}}' };
        return { ok: true, status: 200, text: async () => '',
            json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }) };
    };
    ({ callLLM } = freshState());
    await callLLM({ system: '', user: '', schema: SCHEMA, maxTokens: 1200 });   // 1200 -> 600 -> 300
    assert.strictEqual(ledger().length, 3,
        `metered 413 attempts were refunded: ledger holds ${ledger().length}, expected 3`);
});

// ---- report ------------------------------------------------------------------------------------
console.log(`\n${passes} passed, ${failures} failed`);
if (failures) {
    console.log('LLM resilience is broken — a model retirement or a size limit would silently mute the game.');
    process.exit(1);
}
console.log('LLM resilience: 413 degrades, retired models fail over, reasoning_effort goes only where it is supported.');
process.exit(0);
