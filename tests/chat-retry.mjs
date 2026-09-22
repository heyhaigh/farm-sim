import assert from 'node:assert/strict';
import { World } from '../farm.js';
import { generateCrew } from '../dna.js';
globalThis.window = {};
let calls = 0;
globalThis.fetch = async () => { calls++; return { status: 429, ok: false, headers: { get: () => '600' } }; };
const w = new World(424242);
for (const person of generateCrew(424242).slice(0, 2)) w.addFarmer(person, 0);
const [a, b] = w.farmers;
const originalNow = Date.now;
let now = originalNow();
Date.now = () => now;
try {
    assert.equal(w.tryLlmChat(a, b), true);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 1);
    assert.equal(w.llmChat.retryAfterAt, now + 600_000);
    w.time += 10000; // sim speed must not outrun the provider's real-time cooldown
    assert.equal(w.tryLlmChat(a, b), false);
    assert.equal(calls, 1);
    now += 600_001;
    assert.equal(w.tryLlmChat(a, b), true);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 2);
} finally { Date.now = originalNow; }
console.log('chat-retry: PASS');
