import assert from 'node:assert/strict';
import { World } from '../farm.js';
import { generateCrew } from '../dna.js';
import { whisper } from '../conscience.js';
const w = new World(424242);
for (const person of generateCrew(424242).slice(0, 2)) w.addFarmer(person, 0);
let calls = 0, now = Date.now();
const original = Date.now;
Date.now = () => now;
globalThis.fetch = async () => { calls++; return { ok: false, status: 429, headers: { get: () => '600' } }; };
try {
    const first = await whisper(w, w.farmers[0], 'please rest');
    assert(first.reply); assert.equal(calls, 1, 'reply immediately falls back after classify was throttled');
    w.time += 10000;
    const second = await whisper(w, w.farmers[0], 'please rest');
    assert(second.reply); assert.equal(calls, 1);
    now += 599_000;
    await whisper(w, w.farmers[0], 'please rest'); assert.equal(calls, 1);
    now += 1001;
    await whisper(w, w.farmers[0], 'please rest'); assert.equal(calls, 2);
    assert.equal(w.farmers[0].conscience.log.filter(e => e.who === 'voice').length, 4);
} finally { Date.now = original; }
console.log('whisper-retry: PASS');
