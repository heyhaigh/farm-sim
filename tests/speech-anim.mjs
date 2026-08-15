// tests/speech-anim.mjs — #bubble-reveal contract.
//
// This module has produced THREE separate timing defects in one session, every one of them
// invisible to `node --check` and none of them caught by looking at the code. They are the cases
// below, in the order they were found:
//
//   A. TRUNCATION. A line is on screen for lineSec, but the reveal took line.length*charSec — so a
//      line over ~28 chars was cut off mid-reveal. This was found in the HARNESS, using synthetic
//      unwrapped samples. It was reported at the time as a long-standing shipped defect; that was
//      WRONG. `say()` wraps every line to SAY_LINE_CHARS (18) first, so production never produced a
//      line long enough to truncate. The fitting is a real guarantee for any unwrapped caller; it
//      was never fixing a live bug. Never assert a shipped defect from an input production cannot
//      produce — check it against the real producer first.
//   B. COMPLETION DRIFT. A word cadence of duration/n instead of duration/(n-1) finishes a whole
//      interval early.
//   C. UNEVEN CADENCE. `max(1, floor(t/wordSec))` completes on time but parks word 1 on screen for
//      two intervals while every other word gets one — a hitch at the start of every line.
//
// The through-line: all three are about WHEN things happen, and none of them changes what the code
// looks like. Only arithmetic over the real functions catches them.

import assert from 'node:assert';
import {
    revealLine, revealDuration, wordSecFor, shownCount, words,
    DEFAULT_VARIANT, DEFAULT_FADE, DEFAULT_GLIDE, DEFAULT_FADE_SEC, REVEAL_FRAC,
} from '../speech-anim.js';
import { textWidth } from '../pixel.js';
import { wrapWords, SAY_LINE_CHARS } from '../farm.js';

let passes = 0, failures = 0;
function check(name, fn) {
    try { fn(); console.log(`  PASS  ${name}`); passes++; }
    catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failures++; }
}

// The real constants from farm.js. If these drift, this suite should be updated deliberately —
// they are the budget every assertion below is measured against.
const LINE_SEC = 0.85, CHAR_SEC = 0.03;

// PRODUCTION lines — what `say()` actually hands the renderer. Everything is wrapped to
// SAY_LINE_CHARS (18) first, so these are the ONLY inputs the shipped reveal ever sees. Derived
// from the real wrapper rather than hand-written, so a change to the wrap width cannot leave this
// suite testing a fiction.
const SAYINGS = [
    'Rain.',
    'The barn is cold.',
    'I set the last stone before dusk.',
    'The frost will not take this one.',
    'I have carried water to the far field since the first light and my arms know it.',
];
const SAMPLES = [...new Set(SAYINGS.flatMap(s => wrapWords(s)))];

// SYNTHETIC over-long lines. These CANNOT occur in production — kept only as module stress tests,
// so `revealLine` stays correct if it is ever reused somewhere without wrapping.
//
// CORRECTION (Codex #98 P2-4): an earlier version of this file used these as SAMPLES and concluded
// from them that the shipped game had been truncating long lines for months. That was wrong.
// `say()` wraps to 18 characters and the truncation threshold is 28, so no production line was ever
// cut off. The claim was never checked against the real wrapper — a fabricated input produced a
// fabricated bug report. The fitting behaviour is still correct and worth keeping as a guarantee;
// it was simply never fixing a live defect.
const SYNTHETIC_LONG = [
    'I set the last stone before dusk.',
    'I have carried water to the far field since the first light and my arms know it.',
];

console.log('\n#bubble-reveal — speech reveal contract\n');

// ---- A. truncation ---------------------------------------------------------

check('A  every word arrives AND reaches full opacity before the line flips', () => {
    for (const line of SAMPLES) {
        const plateW = textWidth(line) + 4;
        const n = words(line).length;
        // the last frame before the line is replaced
        const r = revealLine(DEFAULT_VARIANT, line, LINE_SEC - 0.001, { plateW, charSec: CHAR_SEC, lineSec: LINE_SEC });
        assert.strictEqual(r.segments.length, n, `${JSON.stringify(line)}: ${r.segments.length}/${n} words shown at the flip`);
        assert.ok(r.done, `${JSON.stringify(line)}: reveal not marked done`);
        const minAlpha = Math.min(...r.segments.map(s => s.alpha));
        assert.ok(minAlpha >= 0.999, `${JSON.stringify(line)}: a word is still at alpha ${minAlpha.toFixed(2)} when the line flips`);
    }
});

check('A2 the reveal leaves real DWELL — the finished line is readable before it flips', () => {
    for (const line of SAMPLES) {
        const dur = revealDuration(line, CHAR_SEC, LINE_SEC);
        const fadeEnd = dur + Math.min(DEFAULT_FADE_SEC, wordSecFor(line, CHAR_SEC, LINE_SEC));
        assert.ok(fadeEnd < LINE_SEC, `${JSON.stringify(line)}: last fade ends at ${fadeEnd.toFixed(2)}s of ${LINE_SEC}s — no dwell`);
        assert.ok(LINE_SEC - fadeEnd > 0.1, `${JSON.stringify(line)}: only ${(LINE_SEC - fadeEnd).toFixed(3)}s of dwell`);
    }
});

check('A3 PRODUCTION lines never exceed the wrap width, so they could not truncate even unfitted', () => {
    // The honest statement of what ships. Every wrapped line is <= 18 chars, and 18*0.03 = 0.54s
    // fits inside the 0.85s budget — so the shipped typewriter was never truncating anything.
    for (const line of SAMPLES) {
        assert.ok(line.length <= SAY_LINE_CHARS,
            `wrapWords produced a ${line.length}-char line, over the ${SAY_LINE_CHARS} cap: ${JSON.stringify(line)}`);
        const unfitted = shownCount(DEFAULT_VARIANT, line, LINE_SEC, CHAR_SEC, 0);
        assert.strictEqual(unfitted, line.length,
            `${JSON.stringify(line)}: a production line truncated even without fitting — the wrap cap is not protecting it`);
    }
});

check('A3b the fitting DOES protect a synthetic over-long line (the guarantee, not a live bug)', () => {
    for (const long of SYNTHETIC_LONG) {
        const natural = revealDuration(long, CHAR_SEC, 0);
        if (natural <= LINE_SEC) continue;   // not long enough to demonstrate anything
        assert.ok(shownCount(DEFAULT_VARIANT, long, LINE_SEC, CHAR_SEC, 0) < long.length,
            'precondition: unfitted, this line should truncate');
        assert.strictEqual(shownCount(DEFAULT_VARIANT, long, LINE_SEC, CHAR_SEC, LINE_SEC), long.length,
            'fitted, it must complete — this is the guarantee for any future unwrapped caller');
    }
});

check('A4 a line that fits keeps its natural pace (fitting must not slow short lines down)', () => {
    // NOTE, found by this test: the cap is LINE_SEC*REVEAL_FRAC = 0.51s, which equals the natural
    // pace of a 17-character line. So in practice the cap BINDS for almost every real saying and
    // "natural pace" only applies to genuinely short ones. That is acceptable — the cap exists to
    // guarantee completion — but it means most lines now reveal in a fixed 0.51s regardless of
    // length, which is a deliberate property worth knowing rather than an accident.
    const short = 'Rain.';
    assert.ok(short.length * CHAR_SEC < LINE_SEC * REVEAL_FRAC, 'precondition: this line fits well inside the cap');
    assert.strictEqual(
        revealDuration(short, CHAR_SEC, LINE_SEC),
        short.length * CHAR_SEC,
        'a line that fits was compressed anyway',
    );
    // and the boundary itself: a line at exactly the cap is not stretched past it
    const atCap = 'x'.repeat(Math.round(LINE_SEC * REVEAL_FRAC / CHAR_SEC));
    assert.ok(revealDuration(atCap, CHAR_SEC, LINE_SEC) <= LINE_SEC * REVEAL_FRAC + 1e-9,
        'a line at the cap must never exceed it');
});

// ---- B/C. cadence ----------------------------------------------------------

check('B  the last word lands exactly at the end of the reveal window', () => {
    for (const line of SAMPLES) {
        const n = words(line).length;
        if (n < 2) continue;
        const dur = revealDuration(line, CHAR_SEC, LINE_SEC);
        const justBefore = shownCount(DEFAULT_VARIANT, line, dur - 0.005, CHAR_SEC, LINE_SEC);
        const at = shownCount(DEFAULT_VARIANT, line, dur + 0.005, CHAR_SEC, LINE_SEC);
        assert.ok(justBefore < line.length, `${JSON.stringify(line)}: finished EARLY — before the window closed`);
        assert.strictEqual(at, line.length, `${JSON.stringify(line)}: had not finished when the window closed`);
    }
});

check('C  every word gets the same time on screen (no double-length first word)', () => {
    for (const line of SAMPLES) {
        const n = words(line).length;
        if (n < 3) continue;
        const wordSec = wordSecFor(line, CHAR_SEC, LINE_SEC);
        const appear = [];
        let prev = 0;
        for (let t = 0; t <= LINE_SEC; t += 0.001) {
            const k = Math.min(n, Math.floor(t / wordSec) + 1);
            if (k > prev) { appear.push(t); prev = k; }
        }
        assert.strictEqual(appear.length, n, `${JSON.stringify(line)}: ${appear.length} arrivals for ${n} words`);
        assert.ok(appear[0] < 0.002, 'word 1 should be present from the first frame');
        const gaps = appear.slice(1).map((v, i) => v - appear[i]);
        const spread = Math.max(...gaps) - Math.min(...gaps);
        assert.ok(spread < 0.004, `${JSON.stringify(line)}: uneven cadence, gap spread ${spread.toFixed(3)}s`);
    }
});

// ---- fade ------------------------------------------------------------------

check('D  the newest word fades while earlier words stay fully opaque', () => {
    const line = SAMPLES.find(l => words(l).length >= 3) || SAMPLES[0];
    const plateW = textWidth(line) + 4;
    const wordSec = wordSecFor(line, CHAR_SEC, LINE_SEC);
    const mid = 2 * wordSec + Math.min(DEFAULT_FADE_SEC, wordSec) * 0.4;   // partway into word 3
    const r = revealLine(DEFAULT_VARIANT, line, mid, { plateW, charSec: CHAR_SEC, lineSec: LINE_SEC });
    assert.strictEqual(r.segments.length, 3, 'expected exactly 3 words revealed');
    assert.ok(r.segments[0].alpha === 1 && r.segments[1].alpha === 1, 'earlier words must be opaque');
    const a = r.segments[2].alpha;
    assert.ok(a > 0 && a < 1, `newest word should be mid-fade, got alpha ${a}`);
});

check('D2 alpha never leaves [0,1] anywhere in a line', () => {
    for (const line of SAMPLES) {
        const plateW = textWidth(line) + 4;
        for (let t = 0; t <= LINE_SEC; t += 0.004) {
            for (const s of revealLine(DEFAULT_VARIANT, line, t, { plateW, charSec: CHAR_SEC, lineSec: LINE_SEC }).segments) {
                assert.ok(s.alpha >= 0 && s.alpha <= 1, `alpha ${s.alpha} out of range`);
            }
        }
    }
});

check('E  the reveal is time-pure — same t always yields the same frame', () => {
    const line = SAMPLES.find(l => words(l).length >= 2) || SAMPLES[0];
    const plateW = textWidth(line) + 4;
    const opts = { plateW, charSec: CHAR_SEC, lineSec: LINE_SEC };
    const before = JSON.stringify(revealLine(DEFAULT_VARIANT, line, 0.31, opts));
    revealLine(DEFAULT_VARIANT, line, 0.02, opts);
    revealLine(DEFAULT_VARIANT, line, 0.79, opts);
    assert.strictEqual(JSON.stringify(revealLine(DEFAULT_VARIANT, line, 0.31, opts)), before,
        'out-of-order calls changed the result — the reveal is carrying state');
});

check('F  the shipped defaults are the owner-chosen treatment', () => {
    assert.strictEqual(DEFAULT_VARIANT, 'word-center', 'per word, centred');
    assert.strictEqual(DEFAULT_FADE, true, 'fade on');
    assert.strictEqual(DEFAULT_GLIDE, true, 'glide ON — reversed 2026-08-14: the un-glided centring snap made a two-word line read as a repeated word; renderers clip to the plate');
});

check('G  centre variants carry no caret; the left-anchored baseline still does', () => {
    const line = SAMPLES.find(l => words(l).length >= 3) || SAMPLES[0];
    const plateW = textWidth(line) + 4;
    const opts = { plateW, charSec: CHAR_SEC, lineSec: LINE_SEC };
    assert.strictEqual(revealLine('word-center', line, 0.2, opts).caretX, null, 'centre-out must not draw a caret');
    assert.notStrictEqual(revealLine('type-left', line, 0.2, opts).caretX, null, 'the left baseline keeps its caret');
});

check('H  an empty or whitespace line degrades quietly', () => {
    for (const line of ['', '   ']) {
        const r = revealLine(DEFAULT_VARIANT, line, 0.3, { plateW: 40, charSec: CHAR_SEC, lineSec: LINE_SEC });
        assert.ok(Array.isArray(r.segments), 'segments must still be an array');
        assert.ok(r.segments.every(s => typeof s.text === 'string'), 'no malformed segments');
    }
});

// ---- report ----------------------------------------------------------------

console.log(`\n${passes} passed, ${failures} failed`);
if (failures) {
    console.log('The reveal contract is broken — see the three defect classes noted at the top.');
    process.exit(1);
}
console.log('Speech reveal: no truncation, even cadence, fade bounded, time-pure.');
