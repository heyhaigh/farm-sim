import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
process.env.OPENAI_BASE_URL = 'http://127.0.0.1:9999/v1';
process.env.OPENAI_API_KEY = '';
delete process.env.RY_FARMS_LLM_OFF;
process.env.RY_FARMS_TOKEN_BUDGET = '5000';
process.env.RY_FARMS_LLM_MODEL = 'test-model';
let now = 1_000_000, fetches = 0;
Date.now = () => now;
globalThis.fetch = async (_url, options) => {
    fetches++;
    const request = JSON.parse(options.body);
    const classify = request.response_format?.json_schema?.name.endsWith('_classify');
    return { ok: true, json: async () => ({ usage: { total_tokens: classify ? 741 : 1185 },
        choices: [{ message: { content: JSON.stringify(classify
            ? { kind: 'none', target: '', tone: 'observe' }
            : { line: 'I am thinking about the next harvest.', verdict: 'DISMISS' }) } }] }) };
};
const handler = require('../api/ry-farms-conscience.js');
const { callLLM } = require('../api/_llm.js');
const state = globalThis.__ryFarmsLlmState;
async function request(stage) {
    const response = { headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
        end(s) { this.body = JSON.parse(s); } };
    await handler({ method: 'POST', body: { stage, message: 'They do not care about you',
        verdict: 'DISMISS', character: { name: 'Rover' }, history: [] } }, response);
    return response;
}
// Replay the export's first four successful token charges, then the final short classification.
state.budget.spend = [1498, 665, 1185, 715].map((cost, i) => ({ at: now - 42_000 + i * 9_000, cost }));
let res = await request('classify');
assert.equal(res.statusCode, 200);
assert.equal(fetches, 1, 'classification must actually reach the provider');
assert.equal(state.budget.spend.reduce((n, e) => n + e.cost, 0), 4804);
res = await request('reply');
assert.equal(res.statusCode, 429, 'shared capacity exhaustion is not a generation crash');
assert.equal(res.body.reason, 'budget');
assert.equal(res.body.fallback, true);
assert.equal(res.body.retryAfter, Number(res.headers['retry-after']));
assert.ok(res.body.retryAfter > 0 && res.body.retryAfter <= 60);
assert.equal(fetches, 1, 'locally refused reply must not spend another provider request');
assert.equal(state.breaker.fails, 0, 'local exhaustion must not poison provider health');
now += res.body.retryAfter * 1000;
res = await request('reply');
assert.equal(res.statusCode, 200, 'reply recovers when enough capacity expires');
assert.equal(res.body.line, 'I am thinking about the next harvest.');
assert.equal(fetches, 2);
console.log('PASS export-shaped classification success / reply exhaustion / recovery');

state.budget.spend = [{ at: now - 50_000, cost: 1000 }, { at: now - 40_000, cost: 1000 }, { at: now - 10_000, cost: 3000 }];
await assert.rejects(callLLM({ system: '', user: '', maxTokens: 2500 }), err => {
    assert.equal(err.code, 'budget');
    assert.equal(err.retryAfter, 50, 'first expiry is insufficient; wait for enough capacity');
    return true;
});
state.budget.spend = Array.from({ length: 26 }, (_, i) => ({ at: now - 59_000 + i, cost: 1 }));
await assert.rejects(callLLM({ system: '', user: '', maxTokens: 1 }), err => {
    assert.equal(err.retryAfter, 1); return err.code === 'budget';
});
assert.equal(fetches, 2);
console.log('PASS token and request limits report the necessary rolling-window expiry');

state.budget.spend = [];
state.breaker.openUntil = now + 7000;
res = await request('reply');
assert.equal(res.statusCode, 503);
assert.equal(res.body.reason, 'circuit_open');
assert.equal(res.body.retryAfter, 7);
assert.equal(fetches, 2);
now += 7000;
res = await request('reply');
assert.equal(res.statusCode, 200);
assert.equal(fetches, 3);
// A retry can run out of capacity after a provider response; expose its cooldown too.
state.budget.spend = [];
state.breaker.fails = 3;
const previousOpenUntil = state.breaker.openUntil;
globalThis.fetch = async () => {
    fetches++;
    while (state.budget.spend.length < 26) state.budget.spend.push({ at: now, cost: 1 });
    return { ok: false, status: 413, text: async () => '{"error":{"message":"request too large"}}' };
};
await assert.rejects(callLLM({ system: '', user: '', maxTokens: 600 }), err => {
    assert.equal(err.code, 'budget');
    assert.equal(err.retryAfter, 60);
    return true;
});
assert.equal(fetches, 4);
assert.equal(state.breaker.fails, 3);
assert.equal(state.breaker.openUntil, previousOpenUntil);
console.log('PASS retry exhaustion preserves provider health and exposes cooldown');
process.env.RY_FARMS_LLM_OFF = '1';
res = await request('reply');
assert.equal(res.statusCode, 200);
assert.equal(res.body.reason, 'disabled');
assert.equal(res.body.fallback, true);
assert.equal(fetches, 4);
console.log('PASS circuit cooldown recovery and intentional offline state');
