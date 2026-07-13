// #Codex24-3 verification: the memory-writeback endpoint's origin + identity guards, with fetch mocked so
// no real SuperMemory is needed. Confirms cross-origin rejection, numeric-identity requirement, wildcard-
// clobber removal, farmer-seed skipping, and rev stamping.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const handler = require('../api/memory-writeback.js');

let pass = true; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ FAIL ') + m); if (!c) pass = false; };

// capture what would be POSTed to SuperMemory
let sent = [];
globalThis.fetch = async (url, opts) => { sent.push({ url, doc: JSON.parse(opts.body) }); return { ok: true, status: 200, text: async () => '' }; };

function mockReqRes(headers, body) {
    const req = { method: 'POST', headers, on(ev, cb) { if (ev === 'data') cb(Buffer.from(JSON.stringify(body))); if (ev === 'end') cb(); } };
    let status = 0, payload = null;
    const res = { setHeader() {}, set statusCode(v) { status = v; }, get statusCode() { return status; }, end(s) { payload = JSON.parse(s); } };
    return { req, res, out: () => ({ status: res.statusCode, payload }) };
}
const run = async (headers, body) => { sent = []; const m = mockReqRes(headers, body); await handler(m.req, m.res); return { ...m.out(), sent }; };

console.log('#24-3 writeback endpoint guards');
{
    // cross-origin POST is refused
    let r = await run({ origin: 'https://evil.example.com' }, { townSeed: 5, farmers: [{ seed: 1, name: 'A' }] });
    ok(r.status === 403 && r.sent.length === 0, `cross-origin write refused (403, nothing sent)`);

    // loopback origin passes
    r = await run({ origin: 'http://localhost:8013' }, { townSeed: 5, rev: 7, farmers: [{ seed: 1, name: 'A' }] });
    ok(r.status === 200 && r.sent.length === 1, `same-origin (loopback) write allowed`);
    ok(r.sent[0].doc.customId === 'ry-farms:5:1', `customId keyed to real numeric identity (${r.sent[0].doc.customId})`);
    ok(r.sent[0].doc.metadata.rev === '7', `revision stamped (rev=${r.sent[0].doc.metadata.rev})`);

    // no Origin header (non-browser / same-origin) is allowed
    r = await run({}, { townSeed: 5, farmers: [{ seed: 2, name: 'B' }] });
    ok(r.status === 200 && r.sent.length === 1, `no-Origin request allowed (non-browser client)`);

    // missing/nonnumeric townSeed is refused (no wildcard `x` customId)
    r = await run({}, { farmers: [{ seed: 1 }] });
    ok(r.status === 400 && r.sent.length === 0, `missing townSeed refused (400, no wildcard doc written)`);
    r = await run({}, { townSeed: 'x', farmers: [{ seed: 1 }] });
    ok(r.status === 400, `non-numeric townSeed refused`);

    // a farmer without a numeric seed is SKIPPED (not written to a wildcard id)
    r = await run({}, { townSeed: 5, farmers: [{ name: 'no-seed' }, { seed: 9, name: 'ok' }] });
    ok(r.sent.length === 1 && r.sent[0].doc.customId === 'ry-farms:5:9', `farmer without numeric seed skipped (only the valid one written)`);
}

console.log(pass ? '\nALL WRITEBACK-GUARD PROBES PASSED' : '\nSOME PROBES FAILED');
process.exit(pass ? 0 : 1);
