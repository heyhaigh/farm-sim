// tests/llm-route-status.mjs — an expected fallback must not look like a crash in Cloudflare.
//
// 2026-10-26: after the Groq key fix, the only 5xx left in Cloudflare were /api/ry-farms-dm 500s
// during busy minutes. dm, congregation, invent and raid-council answered EVERY failure with 500,
// including the free-tier budget, upstream 429s and the breaker cooling down — the normal "use
// the canned text" path. Chat and conscience already answered those 429/503. These cases hold
// all four routes to that contract, and keep a bad key (401) a 500 so a real outage stays loud.

import assert from 'node:assert';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let passes = 0, failures = 0;
async function check(name, fn) {
    try { await fn(); console.log(`  PASS  ${name}`); passes++; }
    catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failures++; }
}

const ROUTES = {
    dm: { characters: [{ seed: 1, name: 'Ada' }] },
    congregation: { founders: [{ name: 'Ada' }, { name: 'Bo' }] },
    invent: { effect: 'heal', ingredients: ['mint', 'honey'] },
    'raid-council': { cast: [{ name: 'Ada' }, { name: 'Bo' }] },
};
// Chat and conscience handle budget / breaker / off themselves; the shared helper only adds their
// first upstream 429. Their clients honour Retry-After, so it must be the breaker's 20 s, not 60.
const OWN_HANDLING = {
    chat: { context: { speaker: { name: 'Ada' }, listener: { name: 'Bo' } } },
    conscience: { stage: 'classify', message: 'go and get some rest' },
};

function freshRoute(route) {
    delete globalThis.__ryFarmsLlmState;
    for (const k of Object.keys(require.cache)) if (k.includes('/api/')) delete require.cache[k];
    return require(`../api/ry-farms-${route}.js`);
}
let fetched = 0;
function stubFetch(status) {
    fetched = 0;
    globalThis.fetch = async () => (fetched++, { ok: false, status, text: async () => '{"error":{"message":"stub"}}', json: async () => ({}) });
}
async function call(handler, body) {
    const res = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = JSON.parse(b); } };
    await handler({ method: 'POST', body }, res);
    return res;
}

process.env.OPENAI_BASE_URL = 'http://127.0.0.1:9/v1';
process.env.OPENAI_API_KEY = 'test-key-not-used';
process.env.RY_FARMS_LLM_MODELS = 'only/model';

console.log('\n#llm-route-status — fallbacks answer 429/503/200, a bad key still answers 500\n');

for (const [route, body] of Object.entries(ROUTES)) {
    await check(`${route}: bad key (401) stays a 500`, async () => {
        stubFetch(401);
        const res = await call(freshRoute(route), body);
        assert.ok(fetched > 0, 'the request reached the model (not refused earlier)');
        assert.strictEqual(res.statusCode, 500, JSON.stringify(res.body));
        assert.strictEqual(res.body.fallback, true);
    });
    await check(`${route}: upstream 429 answers 429, then the open breaker answers 503`, async () => {
        stubFetch(429);
        const handler = freshRoute(route);
        const first = await call(handler, body);
        assert.ok(fetched > 0, 'the request reached the model');
        assert.strictEqual(first.statusCode, 429, JSON.stringify(first.body));
        assert.strictEqual(first.body.reason, 'upstream_rate_limit');
        assert.ok(Number(first.headers['retry-after']) > 0, 'Retry-After set');
        const second = await call(handler, body);
        assert.strictEqual(second.statusCode, 503, JSON.stringify(second.body));
        assert.strictEqual(second.body.reason, 'circuit_open');
        assert.strictEqual(second.body.fallback, true);
    });
    await check(`${route}: local token budget answers 429`, async () => {
        stubFetch(500);
        process.env.RY_FARMS_TOKEN_BUDGET = '1';
        try {
            const res = await call(freshRoute(route), body);
            assert.strictEqual(res.statusCode, 429, JSON.stringify(res.body));
            assert.strictEqual(res.body.reason, 'budget');
        } finally { delete process.env.RY_FARMS_TOKEN_BUDGET; }
    });
    await check(`${route}: LLM switched off answers 200 fallback`, async () => {
        process.env.RY_FARMS_LLM_OFF = '1';
        try {
            const res = await call(freshRoute(route), body);
            assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
            assert.deepStrictEqual(res.body, { fallback: true, reason: 'disabled' });
        } finally { delete process.env.RY_FARMS_LLM_OFF; }
    });
}

for (const [route, body] of Object.entries(OWN_HANDLING)) {
    await check(`${route}: bad key (401) stays a 500`, async () => {
        stubFetch(401);
        const res = await call(freshRoute(route), body);
        assert.ok(fetched > 0, 'the request reached the model (not refused earlier)');
        assert.strictEqual(res.statusCode, 500, JSON.stringify(res.body));
    });
    await check(`${route}: first upstream 429 answers 429 with Retry-After 20, then 503`, async () => {
        stubFetch(429);
        const handler = freshRoute(route);
        const first = await call(handler, body);
        assert.ok(fetched > 0, 'the request reached the model');
        assert.strictEqual(first.statusCode, 429, JSON.stringify(first.body));
        assert.strictEqual(first.headers['retry-after'], '20');
        assert.strictEqual(first.body.retryAfter, 20);
        assert.strictEqual(first.body.reason, 'upstream_rate_limit');
        const second = await call(handler, body);
        assert.strictEqual(second.statusCode, 503, JSON.stringify(second.body));
    });
}
for (const route of Object.keys(ROUTES)) {
    await check(`${route}: upstream 429 suggests the breaker's 20 s`, async () => {
        stubFetch(429);
        const res = await call(freshRoute(route), ROUTES[route]);
        assert.strictEqual(res.headers['retry-after'], '20');
    });
}

console.log(`\n${passes} passed, ${failures} failed\n`);
process.exit(failures ? 1 : 0);
