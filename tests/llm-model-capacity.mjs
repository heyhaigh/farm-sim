import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
process.env.OPENAI_BASE_URL = 'https://api.groq.com/openai/v1';
process.env.RY_FARMS_ALLOW_PAID_LLM = '1';
process.env.OPENAI_API_KEY = 'test-only';
process.env.RY_FARMS_LLM_MODELS = 'openai/gpt-oss-120b,openai/gpt-oss-20b';
delete process.env.RY_FARMS_LLM_OFF;
delete process.env.RY_FARMS_TOKEN_BUDGET;
const primary = 'openai/gpt-oss-120b', secondary = 'openai/gpt-oss-20b';
let now = 1_000_000, calls = [];
Date.now = () => now;
globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body); calls.push(body.model);
    return { ok: true, json: async () => ({ usage: { total_tokens: body.max_tokens },
        choices: [{ message: { content: '{"ok":true}' } }] }) };
};
let { callLLM } = require('../api/_llm.js');
const state = globalThis.__ryFarmsLlmState;
const reset = () => { state.budget.spend = []; state.breaker.fails = 0; state.breaker.openUntil = 0; calls = []; };
const request = (maxTokens = 1000, priority = 'interactive') => callLLM({ system: '', user: '', maxTokens, priority });
reset();
for (let i = 0; i < 14; i++) assert.deepEqual(await request(), { ok: true });
assert.deepEqual(calls, [...Array(7).fill(primary), ...Array(7).fill(secondary)]);
await assert.rejects(request(), e => e.code === 'budget' && e.retryAfter === 60);
assert.equal(calls.length, 14);
assert.equal(state.breaker.fails, 0);
console.log('PASS 14k pooled capacity without exceeding either 7k model allowance');

reset();
const results = await Promise.allSettled(Array.from({ length: 16 }, () => request()));
assert.equal(results.filter(r => r.status === 'fulfilled').length, 14);
assert.equal(calls.filter(m => m === primary).length, 7);
assert.equal(calls.filter(m => m === secondary).length, 7);
console.log('PASS concurrent reservations cannot overspend either model');

reset();
state.budget.spend = [{ at: now - 50_000, cost: 6500, model: primary }, { at: now - 10_000, cost: 6500, model: secondary }];
await assert.rejects(request(600), e => e.code === 'budget' && e.retryAfter === 10);
assert.equal(calls.length, 0);
now += 10_000;
await request(600);
assert.deepEqual(calls, [primary]);
console.log('PASS both models full: earliest usable model expiry controls recovery');

reset();
for (let i = 0; i < 3; i++) await request(1000, 'background');
await assert.rejects(request(1, 'background'), e => e.code === 'budget');
await request();
assert.equal(calls.length, 4);
console.log('PASS background allowance stays 3k and player calls retain headroom');

reset();
for (let i = 0; i < 26; i++) await request(10);
await assert.rejects(request(10), e => e.code === 'budget');
assert.equal(calls.length, 26);
console.log('PASS global request cap still applies across model capacity');

reset();
state.budget.spend = [{ at: now, cost: 6500 }];
await assert.rejects(request(600), e => e.code === 'budget');
assert.equal(calls.length, 0, 'untagged spend must count against both models');
console.log('PASS reservations without a model fail conservatively');

// Exercise the real two-stage handler with the export's observed token charges.
reset();
state.budget.spend = [{ at: now, cost: 4804, model: primary }];
globalThis.fetch = async (_url, options) => {
 const body = JSON.parse(options.body); calls.push(body.model);
 const classify = body.response_format.json_schema.name.endsWith('_classify');
 return { ok: true, json: async () => ({ usage: { total_tokens: classify ? 741 : 1185 },
  choices: [{ message: { content: JSON.stringify(classify
   ? { kind: 'none', target: '', tone: 'observe' }
   : { line: 'I am tending the seedlings.', verdict: 'DISMISS' }) } }] }) };
};
const handler = require('../api/ry-farms-conscience.js');
for (let i = 0; i < 3; i++) {
 for (const stage of ['classify', 'reply']) {
  const res = { setHeader() {}, end(s) { this.body = JSON.parse(s); } };
  await handler({ method: 'POST', body: { stage, message: 'How are the fields?', verdict: 'DISMISS',
   character: { name: 'Rover' } } }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.ok(!res.body.fallback);
 }
}
assert.equal(calls.length, 6);
assert.ok(calls.includes(secondary));
for (const model of [primary, secondary]) {
 assert.ok(state.budget.spend.filter(e => e.model === model).reduce((n, e) => n + e.cost, 0) <= 7000);
}
console.log('PASS three complete exchanges after the export-shaped 4804-token start');
globalThis.fetch = async (_url, options) => {
 const body = JSON.parse(options.body); calls.push(body.model);
 return { ok: true, json: async () => ({ usage: { total_tokens: body.max_tokens },
  choices: [{ message: { content: '{"ok":true}' } }] }) };
};

for (const base of ['http://localhost:9999/v1', 'https://api.groq.com.example.com/openai/v1']) {
 reset(); process.env.OPENAI_BASE_URL = base;
 for (let i = 0; i < 5; i++) await request();
 await assert.rejects(request(), e => e.code === 'budget');
 assert.equal(calls.length, 5);
}
process.env.OPENAI_BASE_URL = 'https://api.groq.com/openai/v1';
reset(); process.env.RY_FARMS_LLM_MODELS = 'other-model';
for (let i = 0; i < 5; i++) await request();
await assert.rejects(request(), e => e.code === 'budget');
assert.equal(calls.length, 5);
console.log('PASS unknown providers and models keep the original conservative budget');

reset(); process.env.RY_FARMS_LLM_MODELS = primary + ',' + primary;
for (let i = 0; i < 7; i++) await request();
await assert.rejects(request(), e => e.code === 'budget');
assert.equal(calls.length, 7);
console.log('PASS duplicate model names do not multiply capacity');

reset(); process.env.RY_FARMS_LLM_MODELS = primary + ',' + secondary;
process.env.RY_FARMS_TOKEN_BUDGET = '2000';
delete require.cache[require.resolve('../api/_llm.js')];
({ callLLM } = require('../api/_llm.js'));
await request(); await request();
await assert.rejects(request(), e => e.code === 'budget');
assert.equal(calls.length, 2);
console.log('PASS explicit global budget override remains authoritative');
