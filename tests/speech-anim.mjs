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
    revealLine, revealDuration, wordSecFor, wordArrivals, shownCount, words,
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
        // 2026-08-14 cadence: per-word completes at the LAST WORD'S START position, so a sample
        // whose last arrival fits the budget can no longer demonstrate truncation — skip it, the
        // longer sample still exercises the guarantee (this keeps the test non-vacuous, not green-washed).
        const lastArrival = wordArrivals(long, CHAR_SEC, 0)[words(long).length - 1];
        if (lastArrival <= LINE_SEC) continue;
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

check('B  the last word arrives at its TYPEWRITER position — never after the window', () => {
    // REVISED with the 2026-08-14 cadence decision: the old contract pinned the last arrival to
    // the very end of the window, which on a two-word line turned the whole budget into one pause
    // (the "repeated word" report). Arrivals now follow the letter reveal's positions; the last
    // word lands at start_last * eff — inside the window — and the residue is DWELL.
    for (const line of SAMPLES) {
        const ws = words(line);
        if (ws.length < 2) continue;
        const dur = revealDuration(line, CHAR_SEC, LINE_SEC);
        const arr = wordArrivals(line, CHAR_SEC, LINE_SEC);
        const expectLast = ws[ws.length - 1].start * (dur / line.length);
        assert.ok(Math.abs(arr[arr.length - 1] - expectLast) < 1e-9, `${JSON.stringify(line)}: last arrival off its typewriter position`);
        assert.ok(arr[arr.length - 1] < dur, `${JSON.stringify(line)}: last word arrived after the window`);
        const at = shownCount(DEFAULT_VARIANT, line, arr[arr.length - 1] + 0.001, CHAR_SEC, LINE_SEC);
        assert.strictEqual(at, line.length, `${JSON.stringify(line)}: line incomplete after the last arrival`);
    }
});

check('C  the cadence is the LETTER cadence, chunked — gaps proportional to word length', () => {
    // REVISED with the 2026-08-14 decision: even spacing was the /(n-1) scheme's property; the
    // letter contract gives each word time proportional to its length, so the gap BEFORE word k
    // must equal (start_k - start_{k-1}) * eff. Word 1 is present from the first frame, arrivals
    // strictly increase, and NO gap may degenerate toward the whole window (the two-word bug).
    for (const line of SAMPLES) {
        const ws = words(line);
        if (ws.length < 2) continue;
        const dur = revealDuration(line, CHAR_SEC, LINE_SEC);
        const eff = dur / line.length;
        const arr = wordArrivals(line, CHAR_SEC, LINE_SEC);
        assert.strictEqual(arr.length, ws.length, `${JSON.stringify(line)}: arrival per word`);
        assert.ok(arr[0] < 1e-9, 'word 1 should be present from the first frame');
        for (let i = 1; i < arr.length; i++) {
            const gap = arr[i] - arr[i - 1], expect = (ws[i].start - ws[i - 1].start) * eff;
            assert.ok(gap > 0, `${JSON.stringify(line)}: arrivals must strictly increase`);
            assert.ok(Math.abs(gap - expect) < 1e-9, `${JSON.stringify(line)}: gap ${i} is ${gap.toFixed(3)}s, letter contract says ${expect.toFixed(3)}s`);
            assert.ok(gap < dur * 0.75, `${JSON.stringify(line)}: a single gap ate ${(gap / dur * 100).toFixed(0)}% of the window — the degenerate pause is back`);
        }
    }
});

// ---- fade ------------------------------------------------------------------

check('D  the newest word fades while earlier words stay fully opaque', () => {
    const line = SAMPLES.find(l => words(l).length >= 3) || SAMPLES[0];
    const plateW = textWidth(line) + 4;
    const arr = wordArrivals(line, CHAR_SEC, LINE_SEC);
    const gap3 = (arr[3] !== undefined ? arr[3] : arr[2] + DEFAULT_FADE_SEC) - arr[2];
    const mid = arr[2] + Math.min(DEFAULT_FADE_SEC, gap3) * 0.4;   // partway into word 3 (typewriter arrivals)
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

check('H2 surrounding whitespace is canonicalized — the contract COMPLETES (Codex #128 P3)', () => {
    // 'Rain. ' used to stay done:false forever (last word ended at 5, line.length 6); ' A B'
    // delayed word 1 past t=0. canon() trims at the door, so both close.
    const trailing = revealLine(DEFAULT_VARIANT, 'Rain. ', 10, { plateW: 40, charSec: CHAR_SEC, lineSec: LINE_SEC });
    assert.strictEqual(trailing.done, true, "'Rain. ' must reach done");
    const arr = wordArrivals(' A B', CHAR_SEC, LINE_SEC);
    assert.ok(arr[0] < 1e-9, "' A B': word 1 must arrive at t=0 despite the leading space");
    const leading = revealLine(DEFAULT_VARIANT, ' A B', 10, { plateW: 40, charSec: CHAR_SEC, lineSec: LINE_SEC });
    assert.strictEqual(leading.done, true, "' A B' must reach done");
});

check('H3 length-changing glyphs keep segment offsets on the DRAWN string (Codex #128 P3)', () => {
    // 'A… B' normalizes to 'A... B': the raw offset put B four pixels inside the ellipsis. After
    // canon, segment x deltas are canon-offset * 4 — exactly the renderer's per-glyph advance.
    const r = revealLine(DEFAULT_VARIANT, 'A… B', 10, { plateW: 60, charSec: CHAR_SEC, lineSec: LINE_SEC });
    assert.strictEqual(r.done, true, 'must complete');
    assert.strictEqual(r.segments.length, 2, 'two words');
    assert.strictEqual(r.segments[0].text, 'A...', 'first word is the NORMALIZED form');
    assert.strictEqual(r.segments[1].x - r.segments[0].x, 5 * 4, "'B' starts 5 canon glyphs after 'A...' — space included");
    const arrow = revealLine(DEFAULT_VARIANT, 'A↔B C', 10, { plateW: 60, charSec: CHAR_SEC, lineSec: LINE_SEC });
    assert.strictEqual(arrow.segments[1].x - arrow.segments[0].x, 5 * 4, "'C' starts after the EXPANDED 'A<>B' plus its space");
});

// ---- report ----------------------------------------------------------------

console.log(`\n${passes} passed, ${failures} failed`);
if (failures) {
    console.log('The reveal contract is broken — see the three defect classes noted at the top.');
    process.exit(1);
}
console.log('Speech reveal: no truncation, even cadence, fade bounded, time-pure.');
