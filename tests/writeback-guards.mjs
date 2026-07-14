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

    // #Codex25-7: null/boolean/empty/array/negative/float townSeed must NOT coerce to 0 (no shared ry-farms:0:0)
    for (const bad of [null, false, true, '', ' ', [], {}, -1, 1.5, '01x']) {
        r = await run({}, { townSeed: bad, farmers: [{ seed: 1 }] });
        ok(r.status === 400 && r.sent.length === 0, `townSeed ${JSON.stringify(bad)} refused (no 0:0 write)`);
    }
    // a null farmer seed is skipped, not coerced to 0
    r = await run({}, { townSeed: 5, farmers: [{ seed: null, name: 'x' }] });
    ok(r.sent.length === 0, `null farmer seed skipped (no ry-farms:5:0 write)`);

    // #Codex25-6: a stale (lower-or-equal) rev is refused SERVER-SIDE for the same customId within the process
    r = await run({}, { townSeed: 77, rev: 8, farmers: [{ seed: 3, name: 'v8' }] });
    ok(r.sent.length === 1, `rev 8 for ry-farms:77:3 accepted`);
    r = await run({}, { townSeed: 77, rev: 7, farmers: [{ seed: 3, name: 'v7-stale' }] });
    ok(r.sent.length === 0, `stale rev 7 rejected server-side (not written over rev 8)`);
    r = await run({}, { townSeed: 77, rev: 8, farmers: [{ seed: 3, name: 'v8-dup' }] });
    ok(r.sent.length === 0, `equal rev 8 rejected (already committed)`);
    r = await run({}, { townSeed: 77, rev: 9, farmers: [{ seed: 3, name: 'v9' }] });
    ok(r.sent.length === 1, `newer rev 9 accepted`);

    // #Codex26-3: two CONCURRENT writes to the same customId — the stale one must NOT land (per-id serialization
    // + reserve-before-fetch). Fire rev 11 and stale rev 10 together for ry-farms:55:1.
    sent = [];
    const a = mockReqRes({}, { townSeed: 55, rev: 11, farmers: [{ seed: 1, name: 'v11' }] });
    const b = mockReqRes({}, { townSeed: 55, rev: 10, farmers: [{ seed: 1, name: 'v10-stale' }] });
    await Promise.all([handler(a.req, a.res), handler(b.req, b.res)]);
    const wrote55 = sent.filter(s => s.doc.customId === 'ry-farms:55:1');
    ok(wrote55.length === 1 && wrote55[0].doc.content.includes('v11'), `concurrent: only the newer rev 11 landed (stale 10 dropped)`);

    // #Codex26-3: the registry lives on globalThis, so it survives the dev server re-requiring the module. A fresh
    // import of the handler must still reject a stale rev for a customId already committed above.
    const bust = await import('/Users/ryanhaigh/ry-farms/api/memory-writeback.js?bust=' + Math.floor(performance.now()));
    const h2 = bust.default || bust;
    sent = [];
    { const m = mockReqRes({}, { townSeed: 77, rev: 5, farmers: [{ seed: 3, name: 'stale-after-reload' }] }); await h2(m.req, m.res); }
    ok(sent.length === 0, `reloaded module still rejects a stale rev (globalThis registry survived)`);

    // #Codex27-3: the cap eviction must NEVER evict an id with an IN-FLIGHT write — else its reservation vanishes
    // and a queued stale write for it could land. Simulate a near-cap registry with the target as the OLDEST
    // entry AND in-flight, then fire a new write that overflows the cap.
    const reg = globalThis.__ryFarmsRevReg, chains = globalThis.__ryFarmsWriteChains;
    reg.clear(); chains.clear();
    const TARGET = 'ry-farms:123:9';
    reg.set(TARGET, 50);                                   // target reserved high, inserted FIRST = oldest = eviction candidate
    chains.set(TARGET, new Promise(() => {}));             // mark it in-flight (a never-settling pending write)
    for (let i = 0; i < 4096; i++) reg.set('ry-farms:fill:' + i, 1);   // push past REV_CAP so the next write evicts
    sent = [];
    { const m = mockReqRes({}, { townSeed: 500, rev: 1, farmers: [{ seed: 1, name: 'trigger-eviction' }] }); await handler(m.req, m.res); }
    ok(reg.get(TARGET) === 50, `in-flight target NOT evicted by the cap (rev ${reg.get(TARGET)} survives)`);
    chains.delete(TARGET);                                 // release the in-flight guard
    sent = [];
    { const m = mockReqRes({}, { townSeed: 123, rev: 40, farmers: [{ seed: 9, name: 'stale-vs-survivor' }] }); await handler(m.req, m.res); }
    ok(sent.length === 0, `stale rev 40 rejected (the survivor's rev-50 reservation held through eviction)`);
    reg.clear(); chains.clear();
}

console.log(pass ? '\nALL WRITEBACK-GUARD PROBES PASSED' : '\nSOME PROBES FAILED');
process.exit(pass ? 0 : 1);
