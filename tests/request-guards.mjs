import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { PassThrough } from 'node:stream';
const require = createRequire(import.meta.url);
const { clientIP, localRequest, readJSON, RequestLimits, BODY_LIMIT } = require('../api/_request-guards.js');
const req = { headers: { host: 'localhost:8123', 'cf-connecting-ip': '1.2.3.4', 'x-forwarded-for': '5.6.7.8', 'x-real-ip': '9.10.11.12' }, socket: { remoteAddress: '::ffff:127.0.0.1' } };
assert.equal(clientIP(req, false), '127.0.0.1');
assert.equal(clientIP(req, true), '9.10.11.12');
req.headers['x-real-ip'] = 'bad, address';
assert.equal(clientIP(req, true), '127.0.0.1');
process.env.NODE_ENV = 'development';
assert.equal(localRequest(req), true);
req.socket.remoteAddress = '203.0.113.4';
assert.equal(localRequest(req), false, 'forged localhost Origin/Host cannot authorize a remote caller');
req.socket.remoteAddress = '::1'; req.headers.host = 'evil.example';
assert.equal(localRequest(req), false);
req.headers.host = 'localhost:8123'; process.env.NODE_ENV = 'production';
assert.equal(localRequest(req), false, 'production disables even actual loopback access');
let now = 0;
const limits = new RequestLimits({ now: () => now, capacity: 2 });
const use = (channel) => { const r = limits.acquire('player', channel); assert.equal(typeof r.release, 'function'); r.release(); r.release(); };
for (let i = 0; i < 40; i++) use('background');
assert.deepEqual(limits.acquire('player', 'background'), { status: 429, retry: 600, reason: 'quota' });
for (let i = 0; i < 120; i++) use('interactive');
assert.deepEqual(limits.acquire('player', 'interactive'), { status: 429, retry: 600, reason: 'quota' });
now = 1000;
assert.equal(limits.acquire('player', 'interactive').retry, 599);
for (let window = 1; window < 5; window++) {
    now = window * 600_000;
    for (let i = 0; i < 120; i++) use('interactive');
}
now = 3_000_000;
assert.equal(limits.acquire('player', 'interactive').retry, 83_400, 'daily cap survives burst resets');
let other = limits.acquire('other', 'background'); other.release();
assert.equal(limits.acquire('third', 'background').reason, 'capacity', 'full table fails closed without evicting live quotas');
assert.equal(limits.entries.size, 2);
now += 86_400_001;
const third = limits.acquire('third', 'interactive'); third.release();
const active = Array.from({ length: 4 }, () => limits.acquire('third', 'interactive'));
assert.equal(limits.acquire('third', 'interactive').reason, 'concurrency');
active.forEach(r => r.release());
assert.equal(limits.active, 0);
const globalLimit = new RequestLimits();
const permits = Array.from({ length: 32 }, (_, i) => globalLimit.acquire(String(i), 'interactive'));
assert.deepEqual(globalLimit.acquire('overflow', 'interactive'), { status: 503, retry: 5, reason: 'capacity' });
permits.forEach(p => p.release());
async function body(text, headers = {}, timeout = 1000) {
    const stream = new PassThrough(); stream.headers = headers;
    const result = readJSON(stream, timeout);
    if (text !== null) stream.end(text);
    try { return await result; } finally { stream.destroy(); }
}
assert.deepEqual(await body('{"message":"hello"}'), { message: 'hello' });
for (const value of ['null', '[]', '{broken']) await assert.rejects(body(value), { status: 400 });
await assert.rejects(body('x'.repeat(BODY_LIMIT + 1)), { status: 413 });
await assert.rejects(body('{}', { 'content-length': String(BODY_LIMIT + 1) }), { status: 413 });
await assert.rejects(body('{}', { 'content-encoding': 'gzip' }), { status: 415 });
await assert.rejects(body(null, {}, 20), { status: 408 });
console.log('request-guards: PASS');
