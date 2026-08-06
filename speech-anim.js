// speech-anim.js — how a farmer's spoken line ARRIVES on screen.
//
// Pulled out of main.js's #bubble-typewriter into its own module for one reason: the comparison
// harness (`speech_anim_compare.html`) imports THIS file, so what you judge side-by-side is
// literally what the game runs. A harness that reimplements the effect drifts from the game within
// a week and then lies to you.
//
// THE PROBLEM. The shipped reveal types left-to-right, one letter at a time. The reader's eye
// finishes at the right edge and has to snap back across the full plate for every new line — a
// full-width return sweep, several times per saying. A centre-out reveal grows from the middle, so
// the eye stays near the centre and the return distance is roughly halved.
//
// DECIDED (owner, 2026-08-06, from the harness): **word-center** — per word, grown outward from the
// centre. Both changes together. The two variables were rendered separately (granularity: letter vs
// word; anchor: left vs centre) because the proposal changes both at once and it was worth knowing
// which one was doing the work. Both were.
//
// FOLLOW-UP (same session): word-center read "a little staccato". TWO separate causes, and they are
// worth naming because only one of them is the obvious one:
//   1. ALPHA POP — each word appears at full opacity in a single frame.
//   2. THE CENTRING JUMP — the non-obvious one. On a centre-out reveal, every new word shifts ALL
//      the previously-revealed words leftward by half its width. That is a hard positional jump of
//      the entire line on every word, and it is plausibly the larger contributor.
// `fade` softens (1) and `glide` softens (2); they are independent so the harness can attribute the
// improvement rather than guess.

import { textWidth } from './pixel.js';

export const VARIANTS = [
    { id: 'type-left',   label: 'PER LETTER · LEFT',   note: 'the pre-2026-08-06 baseline' },
    { id: 'word-left',   label: 'PER WORD · LEFT',     note: 'isolates granularity' },
    { id: 'type-center', label: 'PER LETTER · CENTRE', note: 'isolates anchor' },
    { id: 'word-center', label: 'PER WORD · CENTRE',   note: 'CHOSEN — both changes together' },
];

export const DEFAULT_VARIANT = 'word-center';

// Easing applied to a word's fade-in and to the centring glide. All ease-OUT: an arrival should
// move fastest at the start and settle gently, which is what makes it read as motion rather than
// as a switch being flipped. `linear` is kept only as the null hypothesis for the harness.
export const CURVES = {
    linear: p => p,
    quad:   p => 1 - (1 - p) * (1 - p),
    cubic:  p => 1 - Math.pow(1 - p, 3),
    sine:   p => Math.sin(p * Math.PI / 2),
};
export const DEFAULT_CURVE = 'cubic';
export const DEFAULT_FADE_SEC = 0.11;

// DECIDED (owner, 2026-08-06): FADE ONLY. The centring glide was rendered alongside it and the
// owner preferred the text without it — the sideways ease read as extra motion rather than as
// smoothing. Kept in the module (and in the harness) because it costs nothing and the judgement
// could reverse; it is simply off by default.
export const DEFAULT_FADE = true;
export const DEFAULT_GLIDE = false;

// KNOWN TRADE-OFF of per-word granularity, found by testing rather than by argument: a ONE-WORD
// line has nothing to reveal progressively — it pops fully formed while the letter variants still
// type it out. The game says plenty of one-word lines ("Rain.", "Again.", "Enough."). The fade
// softens this considerably (the word arrives over fadeSec instead of in one frame) but does not
// remove it. If it ever reads badly the fix is a hybrid — per-letter below N words — which is a
// design decision to make from the harness, not a default to sneak in here.

// Whitespace-delimited words with their character offsets.
// "the barn" -> [{text:'the', start:0, end:3}, {text:'barn', start:4, end:8}]
export function words(line) {
    const out = [];
    const re = /\S+/g;
    let m;
    while ((m = re.exec(line)) !== null) out.push({ text: m[0], start: m.index, end: m.index + m[0].length });
    return out;
}

export function wordEnds(line) { return words(line).map(w => w.end); }

// Fraction of a line's on-screen time the reveal is allowed to occupy. The remainder is DWELL —
// the whole line sitting complete and opaque, which is when it is actually read.
export const REVEAL_FRAC = 0.6;

// FITTING THE REVEAL TO THE LINE — a guarantee, NOT a fix for a shipped bug.
//
// If the reveal takes `length * charSec` but the line is only on screen for `lineSec`, a line over
// ~28 characters is cut off before it finishes. Fitting prevents that: the reveal takes its natural
// pace when that fits inside the budget and compresses when it does not, so every word always
// arrives, reaches full opacity, and the finished line dwells.
//
// HONEST SCOPE (corrected after Codex #98 P2-4). This was discovered in the harness using synthetic
// UNWRAPPED lines, and was written up at the time as a defect that had been shipping for months.
// That was wrong: `say()` wraps every bubble line to SAY_LINE_CHARS (18) before the renderer ever
// sees it, and 18 * 0.03 = 0.54s fits comfortably inside 0.85s. **No production line has ever been
// truncated.** The fitting stays because it makes the module correct for any caller and costs
// nothing, but it should not be described as having rescued anything.
//
// In practice the cap (lineSec * REVEAL_FRAC = 0.51s) binds slightly on the longest wrapped lines —
// a full 18-char line reveals in 0.51s rather than 0.54s. That is the entire live effect.
export function revealDuration(line, charSec, lineSec) {
    const natural = line.length * charSec;
    if (!lineSec) return natural;                 // no line budget supplied: caller owns the timing
    return Math.min(natural, lineSec * REVEAL_FRAC);
}

// Word i (1-based) arrives at (i-1)*wordSec, so word 1 is on screen at t=0 and word n arrives
// exactly at revealDuration. Dividing by (n-1) — NOT n — is what puts the last arrival there.
//
// Both neighbouring forms are wrong, and both were shipped here before this comment existed:
//   /n with k = floor(t/wordSec)+1  → completes one whole interval EARLY (~14% faster than letters)
//   /n with k = max(1, floor(...))  → completes on time, but word 1 lingers for TWO intervals while
//                                     every other word gets one, which reads as a hitch at the start
export function wordSecFor(line, charSec, lineSec) {
    const n = words(line).length;
    const dur = revealDuration(line, charSec, lineSec);
    if (n <= 1) return Math.max(1e-4, dur);
    return dur / (n - 1);
}

// How many characters of `line` are visible at `lineElapsed` seconds.
export function shownCount(variant, line, lineElapsed, charSec, lineSec) {
    if (!line) return 0;
    if (variant === 'word-left' || variant === 'word-center') {
        const ends = wordEnds(line);
        if (!ends.length) return line.length;
        // Word 1 at t=0, word i at (i-1)*wordSec. Correct ONLY because wordSecFor divides by
        // (n-1); see the note there for the two wrong forms this went through.
        const n = Math.floor(lineElapsed / wordSecFor(line, charSec, lineSec)) + 1;
        return ends[Math.min(ends.length - 1, Math.max(0, n - 1))];
    }
    // Letter variants are fitted the same way, so the baseline stops truncating too.
    const eff = revealDuration(line, charSec, lineSec) / Math.max(1, line.length);
    return Math.max(1, Math.min(line.length, Math.floor(lineElapsed / eff)));
}

// The whole frame's worth of decisions for one line.
//
//   plateW   pre-measured plate width (the widest line in the saying). The plate does NOT resize as
//            text arrives — a plate that grows with the text jitters the bubble and pulls the eye
//            harder than the reveal itself does.
//   fade     fade each newly-arrived word in over fadeSec (word variants only)
//   glide    ease the centring shift instead of jumping it (centre variants only)
//
// Returns { segments, caretX, done }. Each segment is { text, x, alpha } with x relative to the
// plate's LEFT edge — the caller draws each one and never has to know about the reveal's shape.
export function revealLine(variant, line, lineElapsed, opts = {}) {
    const {
        plateW = 0, charSec = 0.03, pad = 2, lineSec = 0,
        fade = DEFAULT_FADE, glide = DEFAULT_GLIDE,
        fadeSec = DEFAULT_FADE_SEC, curve = DEFAULT_CURVE,
    } = opts;
    const ease = CURVES[curve] || CURVES[DEFAULT_CURVE];
    const centred = variant === 'type-center' || variant === 'word-center';
    const perWord = variant === 'word-left' || variant === 'word-center';

    const shown = shownCount(variant, line, lineElapsed, charSec, lineSec);
    const text = line.slice(0, shown);
    const done = shown >= line.length;

    // --- letter variants: one opaque run, nothing to fade or glide -------------------------
    if (!perWord) {
        const dx = centred ? Math.floor((plateW - textWidth(text)) / 2) : pad;
        // A caret marks the growing right edge — a left-to-right reading cue. On a centre-out
        // reveal it fights the effect, re-anchoring the eye to one moving edge when the whole point
        // is that neither edge leads. Centred variants carry no caret.
        const caretX = (!done && !centred) ? dx + textWidth(text) : null;
        return { segments: [{ text, x: dx, alpha: 1 }], caretX, done };
    }

    // --- word variants ---------------------------------------------------------------------
    const ws = words(line);
    if (!ws.length) return { segments: [], caretX: null, done: true };

    const wordSec = wordSecFor(line, charSec, lineSec);
    const k = Math.min(ws.length, Math.floor(lineElapsed / wordSec) + 1);   // words revealed
    const newest = ws[k - 1];

    // Progress of the NEWEST word through its fade window. Clamped so a fadeSec longer than the
    // word cadence cannot leave a word permanently translucent.
    const span = Math.max(1e-4, Math.min(fadeSec, wordSec));
    const raw = (lineElapsed - (k - 1) * wordSec) / span;
    const p = ease(Math.max(0, Math.min(1, raw)));

    // Centring: interpolate between where the block sat with k-1 words and where it sits with k.
    // Stateless and time-pure — no per-frame accumulation, so it behaves identically at any speed
    // multiplier and under frame drops.
    const widthAt = n => (n <= 0 ? 0 : textWidth(line.slice(0, ws[n - 1].end)));
    const targetFor = n => (plateW - widthAt(n)) / 2;
    const dx = centred
        ? Math.floor(glide ? targetFor(k - 1) + (targetFor(k) - targetFor(k - 1)) * p : targetFor(k))
        : pad;

    const segments = [];
    for (let i = 0; i < k; i++) {
        const w = ws[i];
        segments.push({
            text: w.text,
            x: dx + w.start * 4,          // fixed-width 3x5 font: every glyph advances exactly 4px
            alpha: (fade && i === k - 1) ? p : 1,
        });
    }
    const caretX = (!done && !centred) ? dx + textWidth(line.slice(0, newest.end)) : null;
    return { segments, caretX, done };
}
