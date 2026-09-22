import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { echoToServer, _resetEchoForTests, _setEchoCooldownForTests } from '../memory-writeback.js';
const require = createRequire(import.meta.url);
const sleep = ms => new Promise(r => setTimeout(r, ms));
let calls = 0;
globalThis.fetch = async () => { calls++; return { ok: false }; };
_setEchoCooldownForTests(10);
for (const hostname of ['propagate.world', 'propagate.heyhaigh.ai', 'example.com', undefined]) {
    globalThis.location = hostname ? { hostname } : undefined;
    echoToServer({ townSeed: 424242, townHistory: { year: 1 } });
    await sleep(30);
    assert.equal(calls, 0, `${hostname}: no public echo or retry`);
}
for (const hostname of ['localhost', '127.0.0.1', '[::1]']) {
    globalThis.location = { hostname };
    globalThis.fetch = async () => { calls++; return { ok: true }; };
    echoToServer({ townSeed: 424242, townHistory: { year: 1 } });
    await sleep(5);
}
assert.equal(calls, 3, 'only local requests queued; no public backlog');
_resetEchoForTests();

process.env.OPENAI_BASE_URL = 'http://127.0.0.1:9/v1';
const llm = require('../api/_llm.js');
const realCall = llm.callLLM;
let outcome;
llm.callLLM = async () => { if (outcome instanceof Error) throw outcome; return outcome; };
const handler = require('../api/ry-farms-chat.js');
async function invoke() {
    const headers = {};
    const res = { setHeader(k, v) { headers[k] = v; }, end(body) { this.body = JSON.parse(body); } };
    await handler({ method: 'POST', body: { context: {} } }, res);
    return { ...res, headers };
}
for (const [code, status, retry] of [['budget', 429, '60'], ['disabled', 200, undefined], ['circuit_open', 503, '20']]) {
    outcome = new llm.LLMDisabledError('controlled failure', code);
    const res = await invoke();
    assert.equal(res.statusCode, status);
    assert.equal(res.body.fallback, true);
    assert.equal(res.body.reason, code);
    assert.equal(res.headers['Retry-After'], retry);
    assert.equal(res.headers['Cache-Control'], 'no-store');
}
for (const failure of [new Error('LLM request failed (429)'), new Error('LLM request failed (500)'), {}, new Error('unexpected')]) {
    outcome = failure;
    assert.equal((await invoke()).statusCode, 500, 'real failures remain visible');
}
outcome = { speakerLine: 'Hello neighbor', listenerLine: 'Good morning' };
assert.equal((await invoke()).body.speakerLine, 'HELLO NEIGHBOR');

// Exercise the real admission guards, not just the handler's translation.
const state = globalThis.__ryFarmsLlmState;
state.breaker.openUntil = 0;
state.budget.spend = []; // the module holds its budget object, so replace only spend
for (let i = 0; i < 26; i++) state.budget.spend.push({ at: Date.now(), cost: 1 });
await assert.rejects(realCall({ system: '', user: '', maxTokens: 1 }), e => e.code === 'budget');
state.budget.spend = [{ at: Date.now(), cost: 4999 }];
await assert.rejects(realCall({ system: '', user: '', maxTokens: 2 }), e => e.code === 'budget');
// Budget exhaustion during a retry must not be mistaken for another provider failure.
state.budget.spend = [];
state.breaker.fails = 3;
state.breaker.openUntil = 0;
globalThis.fetch = async () => {
    while (state.budget.spend.length < 26) state.budget.spend.push({ at: Date.now(), cost: 1 });
    return { ok: false, status: 413, text: async () => '{"error":{"message":"request too large"}}' };
};
await assert.rejects(realCall({ system: '', user: '', maxTokens: 600 }), e => e.code === 'budget');
assert.equal(state.breaker.fails, 3);
assert.equal(state.breaker.openUntil, 0);
console.log('error-reporting: PASS');
