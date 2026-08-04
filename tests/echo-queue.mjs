// #local-memory — the server-echo queue's contract (Codex #89's three P2s), driven through a
// controllable global fetch. The queue is best-effort BY CONTRACT; these probes pin that it never
// loses a distinct farmer, never deletes a mid-flight replacement, and never bypasses the cooldown.
// Run: node tests/echo-queue.mjs
import { echoToServer, _setEchoCooldownForTests, _resetEchoForTests } from '../memory-writeback.js';

let pass = true; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ FAIL ') + m); if (!c) pass = false; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sent = [];                    // every body fetch actually received, in order
let mode = 'fail';                  // 'fail' | 'ok' | 'hang'
let releaseHang = null;             // resolves the hanging fetch
globalThis.fetch = (url, opts) => {
    const body = JSON.parse(opts.body);
    if (mode === 'fail') { sent.push({ body, outcome: 'fail' }); return Promise.reject(new Error('server down')); }
    if (mode === 'hang') { sent.push({ body, outcome: 'hang' }); return new Promise(res => { releaseHang = () => res({ ok: true }); }); }
    sent.push({ body, outcome: 'ok' }); return Promise.resolve({ ok: true });
};
const lives = (seeds, rev = 1) => ({ town: 'T', townSeed: 1, rev, farmers: seeds.map(s => ({ seed: s, name: 'F' + s, rev })) });
const history = (rev) => ({ town: 'T', townSeed: 1, rev, townHistory: { manager: 'M', year: rev } });

console.log('1 — Codex #89: partial lives batches MERGE per farmer (none lost while the server is down)');
{
    _resetEchoForTests(); _setEchoCooldownForTests(40); sent.length = 0; mode = 'fail';
    echoToServer(lives([1, 2]));            // fails -> queued, retry timer armed
    await sleep(10);
    echoToServer(lives([3, 4]));            // must MERGE with the queued [1,2], not replace it
    mode = 'ok';
    await sleep(80);                        // past the cooldown -> the retry pump fires
    const delivered = sent.filter(x => x.outcome === 'ok' && x.body.farmers);
    ok(delivered.length === 1, `one merged delivery after recovery (${delivered.length})`);
    const seeds = (delivered[0]?.body.farmers || []).map(f => f.seed).sort();
    ok(JSON.stringify(seeds) === JSON.stringify([1, 2, 3, 4]), `ALL four farmers arrived (${JSON.stringify(seeds)})`);
}

console.log('2 — Codex #89: a same-key update during a successful in-flight request is NOT deleted');
{
    _resetEchoForTests(); _setEchoCooldownForTests(40); sent.length = 0; mode = 'hang';
    echoToServer(history(1));               // hangs in flight
    await sleep(10);
    echoToServer(history(2));               // replaces the QUEUED body while rev1 is in flight
    mode = 'ok';
    releaseHang();                          // rev1 completes successfully
    await sleep(30);                        // the loop's next iteration must send rev2
    const hist = sent.filter(x => x.body.townHistory);
    ok(hist.length === 2, `both revisions were sent (${hist.length})`);
    ok(hist[1] && hist[1].body.rev === 2, `the replacement (rev 2) followed (got rev ${hist[1]?.body.rev})`);
}

console.log('3 — Codex #89: new work never bypasses the failure cooldown');
{
    _resetEchoForTests(); _setEchoCooldownForTests(10 * 60 * 1000); sent.length = 0; mode = 'fail';
    echoToServer(history(1));               // fails -> long retry timer armed
    await sleep(10);
    const before = sent.length;
    mode = 'ok';
    echoToServer(lives([9]));               // must QUEUE, not fetch, while the timer holds
    await sleep(30);
    ok(sent.length === before, `no fetch during the cooldown window (${sent.length - before} extra)`);
    _resetEchoForTests();                   // clear the long timer so the process can exit
}

console.log(pass ? '\necho-queue: PASS' : '\necho-queue: FAIL');
process.exit(pass ? 0 : 1);
