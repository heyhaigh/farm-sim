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
    // Fresh worlds exercise success pacing and fallback/failure cooldowns, independently of 429.
    const fresh = () => {
        const world = new World(515151);
        for (const person of generateCrew(515151).slice(0, 2)) world.addFarmer(person, 0);
        return world;
    };
    let reply = { speakerLine: 'HELLO', listenerLine: 'WELCOME' };
    let status = 200;
    globalThis.fetch = async () => { calls++; return { status, ok: status === 200, headers: { get: () => null }, json: async () => reply }; };
    const world = fresh();
    const attempt = async () => {
        const result = world.tryLlmChat(...world.farmers.slice(0, 2));
        await new Promise(resolve => setImmediate(resolve));
        return result;
    };
    assert.equal(await attempt(), true);
    const afterSuccess = calls;
    world.time += 1_000_000;
    now += 44_999;
    assert.equal(await attempt(), false, 'fast-forward cannot accelerate successful chat');
    assert.equal(calls, afterSuccess);
    now++;
    assert.equal(await attempt(), true);
    reply = { fallback: true, reason: 'empty_dialogue' };
    now += 45_000;
    assert.equal(await attempt(), true);
    assert.equal(world.llmChat.failures, 0, 'explicit fallback is not a transport failure');
    world.time += 1_000_000;
    now += 179_999;
    assert.equal(await attempt(), false);
    now++;
    status = 500;
    assert.equal(await attempt(), true);
    now += 45_000;
    assert.equal(await attempt(), true);
    world.time += 1_000_000;
    now += 179_999;
    assert.equal(await attempt(), false, 'repeated server failures pause in real time');
    now++;
    assert.equal(await attempt(), true);
} finally { Date.now = originalNow; }
console.log('chat-retry: PASS');
