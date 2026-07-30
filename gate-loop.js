// gate-loop.js — the mobile gate's frame scheduler, with its timers injected.
//
// Extracted from mobile-gate.js for ONE reason: the race it guards against is not reachable from a headless
// test while it is welded to requestAnimationFrame and setTimeout, and it is not reachable from a browser
// test without deliberately corrupting a WebGL context. With the timers injected, tests/gate-loop.mjs can
// drive the exact sequence on a fake clock.
//
// The invariant: exactly ONE loop in flight. Every frame reschedules itself, so a second entry forks a
// duplicate that never merges back — the gate then runs at double rate forever (measured: 61 vs 122
// renders/sec). See the comment in mobile-gate.js for the sequence that produces it.

export function createScheduler({ raf, delay, backoffMs = 1000 }) {
    let scheduled = false;
    let frame = () => {};

    // `failed` routes through the backoff instead of the next animation frame, so a permanently-broken gate
    // retries once a second rather than spinning a phone's GPU at 60fps.
    function schedule(failed) {
        if (scheduled) return;
        scheduled = true;
        const go = () => raf((t) => { scheduled = false; frame(t); });
        if (failed) delay(go, backoffMs); else go();
    }

    return {
        schedule,
        onFrame(f) { frame = f; },
        get pending() { return scheduled; },   // tests only
    };
}
