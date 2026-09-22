// Real HTTP boundary; provider disabled and a local upstream spy proves no memory request escapes.
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
let memoryCalls = 0;
const spy = http.createServer((req, res) => { memoryCalls++; res.end('{}'); }).listen(0, '127.0.0.1');
await once(spy, 'listening');
const reservation = net.createServer().listen(0, '127.0.0.1'); await once(reservation, 'listening');
const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
const child = spawn(process.execPath, ['server.mjs', String(port)], { cwd: new URL('../', import.meta.url), env: { ...process.env, NODE_ENV: 'production', RAILWAY_ENVIRONMENT_ID: '', OPENAI_API_KEY: '', GROQ_API_KEY: '', RY_FARMS_LLM_OFF: '1', SUPERMEMORY_URL: `http://127.0.0.1:${spy.address().port}`, SUPERMEMORY_API_KEY: 'test-only' }, stdio: ['ignore', 'pipe', 'pipe'] });
const base = `http://127.0.0.1:${port}`;
const post = (path, body = '{}', headers = {}) => fetch(base + path, { method: 'POST', body, headers });
try {
    await new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error('server boot timed out')), 5000); child.stdout.on('data', b => { if (String(b).includes('ry-farms on')) { clearTimeout(t); resolve(); } }); });
    for (const route of ['ry-farms-chat', 'ry-farms-dm', 'ry-farms-conscience', 'ry-farms-congregation', 'ry-farms-raid-council', 'ry-farms-invent']) {
        assert.equal((await post('/api/' + route, 'x'.repeat(128 * 1024 + 1))).status, 413, route);
        assert.equal((await post('/api/' + route, 'null')).status, 400, route);
    }
    // Chunked body has no Content-Length. Limit counts actual received bytes.
    await new Promise((resolve, reject) => {
        const r = http.request(base + '/api/ry-farms-chat', { method: 'POST' }, res => { assert.equal(res.statusCode, 413); res.resume(); res.on('end', resolve); });
        r.on('error', reject); r.write('x'.repeat(64 * 1024)); r.end('x'.repeat(65 * 1024));
    });
    for (const origin of [undefined, 'http://localhost:8123']) {
        const headers = origin ? { Origin: origin } : {};
        assert.equal((await post('/api/memory-writeback', '{}', headers)).status, 403);
        for (const route of ['knowledge-graph', 'memory-graph']) {
            const r = await fetch(base + '/api/' + route, { headers });
            assert.equal(r.status, 200); assert.equal((await r.json()).source, 'offline');
        }
    }
    assert.equal(memoryCalls, 0);
    // Invalid bodies consumed some attempts. Exhaust background and verify spoofed headers cannot reset it.
    let limited;
    for (let i = 0; i < 45; i++) {
        const r = await post('/api/ry-farms-chat', '{}', { 'cf-connecting-ip': `192.0.2.${i}`, 'x-forwarded-for': `198.51.100.${i}`, 'x-real-ip': `203.0.113.${i}` });
        if (r.status === 429) { limited = r; break; }
    }
    assert(limited, 'forged forwarding headers must not bypass quota');
    assert(Number(limited.headers.get('retry-after')) > 0);
    const limitedBody = await limited.json();
    assert.equal(limitedBody.fallback, true);
    assert.equal(limitedBody.reason, 'background_quota');
    assert.notEqual((await post('/api/ry-farms-conscience', '{"stage":"classify","message":"rest"}')).status, 429, 'player allowance remains available');
    let playerLimited;
    for (let i = 0; i < 125; i++) {
        const r = await post('/api/ry-farms-conscience', '{"stage":"classify","message":"rest"}');
        if (r.status === 429) { playerLimited = r; break; }
    }
    assert(playerLimited, 'the player allowance eventually closes without affecting background accounting');
    const playerLimitBody = await playerLimited.json();
    assert.equal(playerLimitBody.reason, 'player_quota');
    assert(Number(playerLimited.headers.get('retry-after')) > 0);
    assert.equal((await fetch(base + '/%ZZ')).status, 400);
    for (const route of ['/server.mjs', '/api/_llm.js', '//api/_request-guards.js']) assert.equal((await fetch(base + route)).status, 404);
    assert.equal((await fetch(base + '/')).status, 200, 'server survives malformed input');
    console.log('server-security: PASS');
} finally { child.kill(); await once(child, 'exit'); await new Promise(resolve => spy.close(resolve)); }
