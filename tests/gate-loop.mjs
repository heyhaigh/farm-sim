// tests/gate-loop.mjs — the mobile gate must never fork a second render loop.
//
// Every frame reschedules itself, so a duplicate entry point is permanent: the gate runs at double rate
// forever, on a phone, for a screen that is showing a static notice. Codex #65-3 found the sequence and
// measured it in a browser at 61 renders/sec guarded vs 122 unguarded. This encodes it on a fake clock.
//
// The sequence (my own guess — loss→restore→loss→restore — does NOT reproduce it, and is included below
// as a case that must stay single-looped for the right reason, not by luck):
//
//     a frame THROWS  ->  schedule(true) leaves a backoff retry pending
//     context is LOST ->  the loop parks (the frame returns without rescheduling)
//     context RESTORES BEFORE the timeout fires  ->  the restore path schedules an immediate frame
//     the old timeout then fires  ->  a SECOND permanent loop

import { createScheduler } from '../gate-loop.js';

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
    if (cond) { pass++; console.log(`  PASS  ${name}`); }
    else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

// A fake clock. rAF callbacks and timeouts both land in queues we drain by hand, so the interleaving that
// makes the race possible is expressible rather than a matter of timing luck.
function harness({ backoffMs = 1000 } = {}) {
    let now = 0;
    const rafQ = [];      // pending animation frames
    const timers = [];    // { at, fn }
    const raf = (fn) => { rafQ.push(fn); return rafQ.length; };
    const delay = (fn, ms) => { timers.push({ at: now + ms, fn }); };

    const loop = createScheduler({ raf, delay, backoffMs });

    const state = { contextLost: false, throwNext: false, frames: 0 };
    loop.onFrame(() => {
        state.frames++;
        if (state.contextLost) return;              // parked — the restore path restarts it
        if (state.throwNext) { state.throwNext = false; loop.schedule(true); return; }   // the catch branch
        loop.schedule(false);                                                            // the success branch
    });

    return {
        loop, state,
        // drain exactly one round of animation frames; returns how many ran
        tickFrames() { const n = rafQ.length; const batch = rafQ.splice(0, n); batch.forEach(fn => fn(now)); return n; },
        advance(ms) {
            now += ms;
            const due = timers.filter(t => t.at <= now);
            due.forEach(t => { timers.splice(timers.indexOf(t), 1); t.fn(); });
        },
        // THE measurement: how many independent loops are in flight. One frame each -> that many rAFs queued.
        inFlight() { return rafQ.length; },
    };
}

// ---------------------------------------------------------------------------------------------
// 1. THE RACE Codex reproduced: throw -> loss -> restore-before-backoff -> the stale timeout fires
// ---------------------------------------------------------------------------------------------
{
    const h = harness();
    h.loop.schedule(false);
    h.tickFrames();                    // a normal frame; reschedules itself

    h.state.throwNext = true;
    h.tickFrames();                    // this frame "throws" -> schedule(true), backoff pending
    check('after a throw, nothing is queued yet (waiting out the backoff)', h.inFlight() === 0);

    h.state.contextLost = true;        // context is lost while the retry is pending
    h.state.contextLost = false;       // ...and restored BEFORE the timeout fires
    h.loop.schedule(false);            // <- the restore path

    h.advance(1000);                   // the ORIGINAL backoff timeout now fires
    const queued = h.inFlight();
    // EXACTLY one, both bounds. Codex #66: `<= 1` also passes when recovery killed the loop outright —
    // it proves "did not duplicate" while saying nothing about "still alive". A mutation that discarded
    // every failed-frame retry passed all eight assertions.
    check('restore + stale backoff leaves exactly one live loop', queued === 1, `${queued} loops in flight`);

    h.tickFrames();
    check('and it is still exactly one after another round', h.inFlight() === 1, `${h.inFlight()} loops in flight`);
}

// ---------------------------------------------------------------------------------------------
// 2. The sequence I originally guessed at. It must ALSO stay single — but note it passes even without
//    the guard, which is exactly why it was not sufficient evidence on its own.
// ---------------------------------------------------------------------------------------------
{
    const h = harness();
    h.loop.schedule(false);
    h.tickFrames();
    for (let i = 0; i < 2; i++) {
        h.state.contextLost = true;
        h.tickFrames();                // parks: returns without rescheduling
        h.state.contextLost = false;
        h.loop.schedule(false);        // restore
        h.tickFrames();
    }
    check('loss/restore cycles leave exactly one live loop', h.inFlight() === 1, `${h.inFlight()} loops in flight`);
}

// ---------------------------------------------------------------------------------------------
// 3. Ordinary running never accumulates, and a parked loop really does stop.
// ---------------------------------------------------------------------------------------------
{
    const h = harness();
    h.loop.schedule(false);
    for (let i = 0; i < 30; i++) h.tickFrames();
    check('30 ordinary frames leave exactly one in flight', h.inFlight() === 1, `${h.inFlight()}`);

    h.state.contextLost = true;
    h.tickFrames();
    check('a lost context parks the loop (nothing queued)', h.inFlight() === 0, `${h.inFlight()}`);

    const before = h.state.frames;
    h.advance(5000);
    h.tickFrames();
    check('a parked loop does not run itself', h.state.frames === before, `ran ${h.state.frames - before}`);
}

// ---------------------------------------------------------------------------------------------
// 4. A permanently-failing gate backs off rather than spinning.
// ---------------------------------------------------------------------------------------------
{
    const h = harness({ backoffMs: 1000 });
    h.loop.schedule(false);
    h.tickFrames();
    let frames = 0;
    for (let s = 0; s < 5; s++) {          // five seconds of continuous failure
        h.state.throwNext = true;
        frames += h.tickFrames();
        h.advance(1000);
    }
    // Two-sided again: `<= 6` alone is satisfied by a loop that gave up entirely. The retry must actually
    // happen (one per backoff period) AND must not spin.
    check('continuous failure keeps retrying', frames >= 5, `${frames} frames over 5s — did it give up?`);
    check('continuous failure retries ~1/s, not 60/s', frames <= 6, `${frames} frames over 5s`);
}

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) { console.log('\nThe gate can fork a second render loop.'); process.exit(1); }
console.log('Gate loop stays single through throws, context loss and restoration.');
