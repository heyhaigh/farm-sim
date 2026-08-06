// tests/funnel.mjs — #funnel GA4 event contract.
//
// What this protects, and why each case exists rather than being obvious:
//
//   A. DARK HOSTS SEND NOTHING. The funnel is worthless if it is half QA traffic. This is the
//      single most likely thing to regress, because "it works on localhost" is how you'd naturally
//      test it — and working on localhost is precisely the bug.
//   B. AN UNLOADED GTAG MUST NOT BURN THE ONCE-FLAG. If an ad-blocker stops Google's script and we
//      mark the step spent anyway, that player's funnel step is muted FOREVER — silent, permanent
//      under-reporting with no way to detect it from the data.
//      NOT claimed, and not locally testable: that a *delivered* hit was received. `event_callback`
//      reports command processing, so a loaded tag whose collection request is blocked downstream
//      still spends the flag. Only post-deploy Realtime/Tag Assistant can confirm collection.
//   C. THE POLL IS CHEAP. funnelTick runs every frame; if trackOnce touches localStorage on each
//      call the game pays synchronous main-thread storage reads at 60Hz forever.
//
// The module is browser-side, so this harness installs the globals it reads (location, window,
// localStorage) and swaps them per case. Node has no DOM — importing analytics.js without these
// must not throw either, which case A0 pins.

import assert from 'node:assert';

let passes = 0, failures = 0;
function check(name, fn) {
    try { fn(); console.log(`  PASS  ${name}`); passes++; }
    catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failures++; }
}

// ---- harness ---------------------------------------------------------------

function makeStorage() {
    const map = new Map();
    return {
        map,
        get length() { return map.size; },
        key: (i) => [...map.keys()][i] ?? null,
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => { map.set(k, String(v)); },
        removeItem: (k) => { map.delete(k); },
    };
}

// Install a world. `gtag` may be absent (blocked), a thrower (a hostile shim), or a recorder.
function install({ host = 'propagate.heyhaigh.ai', gtag = 'record', storage = makeStorage() } = {}) {
    const sent = [];
    const reads = { get: 0, set: 0 };
    // Delegate, do NOT spread: `length` is a getter, and spreading evaluates it once and freezes
    // the result at 0 — which silently makes resetFunnel's iteration a no-op and reports the
    // module as broken when it is fine. (It cost one debugging round to find that.)
    const wrapped = {
        get length() { return storage.length; },
        key: (i) => storage.key(i),
        getItem: (k) => { reads.get++; return storage.getItem(k); },
        setItem: (k, v) => { reads.set++; return storage.setItem(k, v); },
        removeItem: (k) => storage.removeItem(k),
    };
    globalThis.location = { hostname: host };
    globalThis.localStorage = wrapped;
    // Three gtag worlds, and the middle one is the whole point of case F:
    //   'record'  — GA library loaded: enqueue AND invoke event_callback (command PROCESSED)
    //   'enqueue' — the COMMON ad-blocker: index.html's inline stub still exists and still succeeds,
    //               but Google's script never loads so event_callback is NEVER invoked. Nothing
    //               leaves the browser. A suite that only models a THROWING gtag misses this
    //               entirely — which is exactly how the bug shipped (Codex #97 P1-4).
    //   'throw'   — the rarer hostile shim
    const fn = gtag === 'record' ? (...a) => { sent.push(a); const cb = a[2] && a[2].event_callback; if (cb) cb(); }
        : gtag === 'enqueue' ? (...a) => { sent.push(a); /* queued only; no callback, ever */ }
        : gtag === 'throw' ? () => { throw new Error('blocked'); }
        : gtag;
    globalThis.window = fn ? { gtag: fn } : {};
    // localStorage is read through the global in the module, but `window.localStorage` is what a
    // browser exposes — keep them the same object so neither path diverges.
    globalThis.window.localStorage = wrapped;
    return { sent, reads, storage };
}

// A fresh module instance per case: `spent` is module-level state, so cases would leak into each
// other through it. The cache-busting query is what forces a real re-evaluation.
let modSeq = 0;
async function freshModule() {
    return import(`../analytics.js?case=${modSeq++}`);
}

// ---- cases -----------------------------------------------------------------

console.log('\n#funnel — GA4 event contract\n');

// A0 — importing with no browser globals at all must not throw.
{
    delete globalThis.location; delete globalThis.window; delete globalThis.localStorage;
    const m = await freshModule();
    check('A0 imports headless (no location/window/localStorage) and stays silent', () => {
        assert.strictEqual(m.track('town_created'), false, 'track must report not-sent');
        assert.strictEqual(m.trackOnce('first_whisper'), false, 'trackOnce must report not-sent');
    });
}

// A — dark hosts.
for (const host of ['localhost', '127.0.0.1', '192.168.1.40', 'farm-sim.up.railway.app', '']) {
    const { sent } = install({ host });
    const m = await freshModule();
    check(`A  host "${host}" sends nothing`, () => {
        m.track('town_created', { seed: 1 });
        m.trackOnce('first_follow');
        assert.deepStrictEqual(sent, [], `a dark host must not reach gtag (got ${JSON.stringify(sent)})`);
    });
}

// A2 — the live host DOES send, or every case above is vacuously true.
{
    const { sent } = install({});
    const m = await freshModule();
    check('A2 the live host actually sends (guards against a vacuous suite)', () => {
        assert.strictEqual(m.track('town_created', { seed: 7 }), true, 'track should report sent');
        assert.strictEqual(sent.length, 1, 'exactly one call');
        assert.deepStrictEqual(sent[0], ['event', 'town_created', { seed: 7 }]);
    });
}

// B — a blocked/throwing gtag must not mark the step spent.
{
    const { sent, storage } = install({ gtag: 'throw' });
    const m = await freshModule();
    check('B  a throwing gtag does not burn the once-flag', () => {
        assert.strictEqual(m.trackOnce('first_whisper'), false, 'send failed, so not sent');
        assert.strictEqual(storage.map.size, 0, 'nothing may be written to the ledger');
        assert.deepStrictEqual(sent, []);
    });
}

// B2 — and the NEXT session (gtag now working) still gets the event.
{
    const storage = makeStorage();
    install({ gtag: 'throw', storage });
    const blocked = await freshModule();
    blocked.trackOnce('first_whisper');
    const { sent } = install({ storage });          // same storage, gtag now healthy
    const healthy = await freshModule();
    check('B2 a step blocked in one session still fires in the next', () => {
        assert.strictEqual(healthy.trackOnce('first_whisper'), true, 'must fire now');
        assert.strictEqual(sent.length, 1);
        assert.strictEqual(sent[0][1], 'first_whisper');
    });
}

// B3 — a genuinely spent step never fires twice, across module instances (the durable ledger).
{
    const storage = makeStorage();
    const first = install({ storage });
    const m1 = await freshModule();
    m1.trackOnce('day10_reached', { seed: 3 });
    assert.strictEqual(first.sent.length, 1, 'precondition: the first call fired');
    const second = install({ storage });            // simulate a reload: same storage, new module
    const m2 = await freshModule();
    check('B3 a spent step stays spent across a reload', () => {
        assert.strictEqual(m2.trackOnce('day10_reached', { seed: 3 }), false);
        assert.deepStrictEqual(second.sent, [], 'must not re-fire from the durable ledger');
    });
}

// C — the frame-rate poll must not hit storage repeatedly.
{
    const { reads } = install({});
    const m = await freshModule();
    check('C  a spent step stops reading storage (frame-rate poll stays cheap)', () => {
        m.trackOnce('first_follow');
        const afterFirst = reads.get;
        for (let i = 0; i < 500; i++) m.trackOnce('first_follow');
        assert.strictEqual(reads.get, afterFirst,
            `500 polls added ${reads.get - afterFirst} storage reads; the in-memory shortcut is not working`);
    });
}

// C2 — same guarantee on a DARK host, where nothing is ever marked spent. This is the case the
// in-memory Set alone cannot cover, and it is the whole dev session's cost.
{
    const { reads } = install({ host: 'localhost' });
    const m = await freshModule();
    check('C2 a dark host never reads storage at all (the dev-session poll)', () => {
        for (let i = 0; i < 500; i++) m.trackOnce('first_follow');
        assert.strictEqual(reads.get, 0, `dark host performed ${reads.get} storage reads; it must bail before the read`);
    });
}

// D — resetFunnel re-arms, and clears BOTH the durable ledger and the in-memory shortcut.
{
    const { sent, storage } = install({});
    const m = await freshModule();
    m.trackOnce('first_follow');
    m.trackOnce('chronicle_opened');
    storage.setItem('ryfarms-memory-intro', '1');   // an unrelated key must survive
    check('D  resetFunnel re-arms every step and spares unrelated keys', () => {
        const cleared = m.resetFunnel();
        assert.strictEqual(cleared, 2, `expected 2 ledger keys cleared, got ${cleared}`);
        assert.strictEqual(storage.getItem('ryfarms-memory-intro'), '1', 'unrelated key must survive');
        const before = sent.length;
        assert.strictEqual(m.trackOnce('first_follow'), true, 'must fire again after a reset');
        assert.strictEqual(sent.length, before + 1);
    });
}

// D2 — the in-memory Set specifically. Without spent.clear() in resetFunnel, D above still passes
// on the storage side while the step stays muted for the session. Mutation-proven: comment out
// `spent.clear()` and this is the case that goes red.
{
    const { sent } = install({});
    const m = await freshModule();
    m.trackOnce('day10_reached');
    m.resetFunnel();
    check('D2 resetFunnel clears the in-memory shortcut, not just storage', () => {
        const before = sent.length;
        m.trackOnce('day10_reached');
        assert.strictEqual(sent.length, before + 1,
            'the step did not re-fire — spent.clear() is missing from resetFunnel');
    });
}

// E — private mode: getItem/setItem throw. The funnel may over-count; it must never throw into
// the click handler that called it.
{
    const hostile = {
        get length() { throw new Error('private mode'); },
        key() { throw new Error('private mode'); },
        getItem() { throw new Error('private mode'); },
        setItem() { throw new Error('private mode'); },
        removeItem() { throw new Error('private mode'); },
    };
    const sent = [];
    globalThis.location = { hostname: 'propagate.heyhaigh.ai' };
    globalThis.localStorage = hostile;
    globalThis.window = { gtag: (...a) => sent.push(a), localStorage: hostile };
    const m = await freshModule();
    check('E  private-mode storage degrades to over-counting, never to a throw', () => {
        assert.doesNotThrow(() => m.trackOnce('first_whisper'));
        assert.strictEqual(sent.length, 1, 'the event should still go out');
        assert.doesNotThrow(() => m.resetFunnel(), 'resetFunnel must survive a hostile store too');
    });
}

// F — THE CODEX #97 P1-4 CASE. A network-blocked GA leaves the inline gtag stub working: the
// enqueue succeeds, so a naive implementation reports "sent" and permanently spends the flag while
// nothing ever left the browser. `event_callback` distinguishes that case, because an unloaded
// library cannot invoke it.
//
// SCOPE (Codex #99 P2-4): this is NOT proof of delivery, and these cases must not be read as
// claiming it. `event_callback` fires when gtag finishes PROCESSING the command — a library that
// loaded fine but whose collection request is then blocked at the network layer will still invoke
// it and still spend the flag. What is pinned here is strictly: an UNLOADED library never spends
// the flag.
{
    const storage = makeStorage();
    const { sent } = install({ gtag: 'enqueue', storage });
    const m = await freshModule();
    check('F  an enqueue with no callback (GA never loaded) does NOT spend the durable flag', () => {
        m.trackOnce('first_whisper');
        assert.strictEqual(sent.length, 1, 'it should still attempt the send');
        assert.strictEqual(storage.map.size, 0,
            'the flag was written on a mere enqueue — a blocked player is now muted forever');
    });
}

// F2 — and the step must still be recoverable in a later session once GA is reachable.
{
    const storage = makeStorage();
    install({ gtag: 'enqueue', storage });
    const blocked = await freshModule();
    blocked.trackOnce('first_whisper');
    const { sent } = install({ gtag: 'record', storage });
    const healthy = await freshModule();
    check('F2 a step lost to a blocked GA fires again once GA is reachable', () => {
        assert.strictEqual(healthy.trackOnce('first_whisper'), true);
        assert.strictEqual(sent.length, 1);
        assert.strictEqual(storage.map.size, 1, 'now that gtag processed the command, the flag is spent');
    });
}

// F3 — while confirmation is outstanding the frame-rate poll must not re-send. Without a pending
// guard this is a hit per frame at 60Hz for the rest of the session.
{
    const { sent } = install({ gtag: 'enqueue' });
    const m = await freshModule();
    check('F3 a pending (unconfirmed) event is not re-sent every frame', () => {
        for (let i = 0; i < 300; i++) m.trackOnce('first_follow');
        assert.strictEqual(sent.length, 1, `poll re-sent the event ${sent.length} times while awaiting confirmation`);
    });
}

// F4 — a PROCESSED command marks the flag, and the mark survives a reload.
{
    const storage = makeStorage();
    const first = install({ gtag: 'record', storage });
    const m1 = await freshModule();
    m1.trackOnce('day10_reached');
    assert.strictEqual(first.sent.length, 1, 'precondition: sent');
    const second = install({ gtag: 'record', storage });
    const m2 = await freshModule();
    check('F4 a processed command spends the flag durably', () => {
        assert.strictEqual(storage.map.size, 1, 'callback should have written the ledger');
        assert.strictEqual(m2.trackOnce('day10_reached'), false);
        assert.deepStrictEqual(second.sent, [], 'must not re-fire once the command was processed');
    });
}

// F5 — Codex #98 P2-6. A callback already in flight when resetFunnel() runs must NOT resurrect the
// flag it just cleared. `pending.clear()` cannot cancel an enqueued callback, so the send carries a
// generation and a stale confirmation is dropped.
{
    const storage = makeStorage();
    const sent = [];
    let held = null;   // capture the callback instead of invoking it: the event is "in flight"
    globalThis.location = { hostname: 'propagate.heyhaigh.ai' };
    globalThis.localStorage = storage;
    globalThis.window = {
        gtag: (...a) => { sent.push(a); held = a[2] && a[2].event_callback; },
        localStorage: storage,
    };
    const m = await freshModule();
    check('F5 a callback in flight across resetFunnel cannot resurrect the flag', () => {
        m.trackOnce('first_follow');
        assert.strictEqual(typeof held, 'function', 'precondition: a callback is outstanding');
        m.resetFunnel();
        held();   // the late confirmation finally arrives, from the superseded generation
        assert.strictEqual(storage.map.size, 0,
            'the stale callback wrote the ledger — resetFunnel was silently undone');
        // and the step must genuinely be re-armed
        m.trackOnce('first_follow');
        assert.strictEqual(sent.length, 2, 'the step should be sendable again after the reset');
    });
}

// ---- report ----------------------------------------------------------------

console.log(`\n${passes} passed, ${failures} failed`);
if (failures) {
    console.log('The funnel contract is broken — see the case notes at the top of this file.');
    process.exit(1);
}
console.log('Funnel events: dark hosts silent, an UNLOADED gtag never burns a flag, the poll stays cheap.');
console.log('(Not covered, and not coverable locally: a loaded tag whose collection request is blocked.)');
