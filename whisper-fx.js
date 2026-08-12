// whisper-fx.js — the WHISPER interaction's two sounds, in one shared module:
//
//   1. keyPop     — a tiny pop per key as the PLAYER types into the whisper box.
//   2. speakWord  — an animalese chirp per word as the FARMER's reply writes itself out.
//
// Pulled into its own module for the same reason as speech-anim.js: the comparison harness
// (`whisper_sound_compare.html`) imports THIS file, so what the owner auditions side-by-side is
// literally what the game plays. Everything here is pure Web Audio synthesis on a caller-supplied
// (ctx, out) pair — the game passes audio.ctx + its SFX bus (so the volume slider and mute rule
// these too), the harness passes its own context. No assets, no game imports, off-sim by
// construction (never touches world state — determinism cannot see it).
//
// VARIANCE is designed in, not bolted on: every call takes an rng and jitters pitch, length and
// level per keystroke/word, so held-key repeats and long replies never sound machine-gunned.

// ---- shared helpers ----------------------------------------------------------------------------

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// tiny string hash (FNV-ish) for per-letter/per-word pitch that is stable per text
function hstr(s) {
    let h = 0x811c9dc5 >>> 0;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h >>> 0;
}
const h01 = (s) => hstr(s) / 0xffffffff;   // 0..1

function env(ctx, out, t, peak, attack, dur) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(out);
    return g;
}

function noiseBurst(ctx, out, t, dur, centerHz, q, peak) {
    const len = Math.max(32, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = centerHz; bp.Q.value = q;
    const g = env(ctx, out, t, peak, 0.002, dur);
    src.connect(bp); bp.connect(g);
    src.start(t); src.stop(t + dur + 0.02);
}

// ---- 1 · the keyboard pop ----------------------------------------------------------------------

// DECIDED (owner, 2026-08-12, from the harness): **soft** for the keys, **hum** for the voice.
// ALL variants stay on purpose — the owner liked every one, and this module + the harness
// (`whisper_sound_compare.html`) are the component library future sounds get auditioned against.
export const KEY_VARIANTS = [
    { id: 'bubble',   label: 'BUBBLE POP',   note: 'round water-drop blip, pitch falls as it lands' },
    { id: 'thock',    label: 'MECH THOCK',   note: 'mechanical click over a low knock' },
    { id: 'terminal', label: 'CRT TERMINAL', note: 'square micro-beep stepping a scale — the retro one' },
    { id: 'soft',     label: 'SOFT TICK',    note: 'CHOSEN — quiet laptop tap, barely there' },
];
export const DEFAULT_KEY_VARIANT = 'soft';

// kind: 'insert' (a character) | 'space' | 'delete' (backspace). Space sits lower and delete lower
// still, so the rhythm of real typing reads in the sound.
export function keyPop(ctx, out, variant = DEFAULT_KEY_VARIANT, kind = 'insert', rng = Math.random) {
    const t = ctx.currentTime;
    const kMul = kind === 'delete' ? 0.62 : kind === 'space' ? 0.78 : 1;
    const kGain = kind === 'delete' ? 0.7 : 1;
    const j = () => 1 + (rng() * 2 - 1) * 0.12;   // ±12% per-key jitter, used per-parameter

    if (variant === 'bubble') {
        const f0 = 760 * kMul * j();
        const dur = clamp(0.05 * j(), 0.03, 0.08);
        const o = ctx.createOscillator(); o.type = 'sine';
        o.frequency.setValueAtTime(f0 * 1.9, t);
        o.frequency.exponentialRampToValueAtTime(f0 * 0.55, t + dur);
        o.connect(env(ctx, out, t, 0.5 * kGain * j(), 0.004, dur));
        o.start(t); o.stop(t + dur + 0.02);
    } else if (variant === 'thock') {
        noiseBurst(ctx, out, t, 0.02 * j(), (1900 + rng() * 900) * kMul, 1.1, 0.34 * kGain);
        const o = ctx.createOscillator(); o.type = 'sine';
        o.frequency.setValueAtTime((150 + rng() * 45) * kMul, t);
        o.connect(env(ctx, out, t, 0.4 * kGain * j(), 0.003, 0.045 * j()));
        o.start(t); o.stop(t + 0.08);
    } else if (variant === 'terminal') {
        // beeps step a small pentatonic ladder — quantized jitter, so it chirps rather than slides
        const steps = [0, 2, 4, 7, 9];
        const semi = steps[Math.floor(rng() * steps.length)];
        const f = 840 * kMul * Math.pow(2, semi / 12);
        const dur = 0.024 * j();
        const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = f;
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600;
        const g = env(ctx, out, t, 0.22 * kGain * j(), 0.002, dur);
        o.connect(lp); lp.connect(g);
        o.start(t); o.stop(t + dur + 0.02);
    } else {   // 'soft'
        const o = ctx.createOscillator(); o.type = 'triangle';
        o.frequency.value = (500 + rng() * 170) * kMul;
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1300;
        const g = env(ctx, out, t, 0.3 * kGain * j(), 0.003, 0.032 * j());
        o.connect(lp); lp.connect(g);
        o.start(t); o.stop(t + 0.07);
    }
}

// ---- 2 · the farmer's animalese ----------------------------------------------------------------

export const VOICE_VARIANTS = [
    { id: 'classic', label: 'CLASSIC ANIMALESE', note: 'a squeaky chirp per letter, Animal-Crossing style' },
    { id: 'babble',  label: 'SYLLABLE BABBLE',   note: 'one rounded consonant+vowel syllable per word' },
    { id: 'hum',     label: 'MELODIC MUMBLE',    note: 'CHOSEN — soft pentatonic mumble, least chattery' },
];
export const DEFAULT_VOICE_VARIANT = 'hum';

// A farmer's voice is THEIRS: base pitch hashes off the farmer's seed so it is stable across
// sessions, and orcs sit an octave-ish down with a rougher wave. `character` nudges the range
// (0..1, e.g. from a personality axis) so the cast doesn't cluster.
export function voiceOf(seed, culture = 'human', character = 0.5) {
    const u = h01('voice:' + String(seed >>> 0));
    const orc = culture === 'orc';
    const lo = orc ? 118 : 250, hi = orc ? 205 : 430;
    const base = lo + (hi - lo) * (u * 0.7 + character * 0.3);
    return { base, orc, wave: orc ? 'sawtooth' : 'square', seed: seed >>> 0 };
}

// The reveal cadence: how long after the PREVIOUS word this word lands. Lives here (not in
// main.js) so the compare harness paces its write-out identically to the game — a harness with its
// own timing would audition a different feel than the one that ships.
export function wordDelay(word, voice) {
    return (0.10 + Math.min(0.12, String(word).length * 0.022)) * (voice && voice.orc ? 1.25 : 1);
}

const VOWELS = 'aeiouy';
// per-letter pitch factor: vowels sit low and steady, consonants jump around above them
function letterFactor(ch) {
    const c = ch.toLowerCase();
    if (VOWELS.includes(c)) return 0.88 + h01('v' + c) * 0.18;
    return 1.0 + h01('c' + c) * 0.42;
}

// One synthesized "phoneme": a pitched blip through a lowpass that keeps the buzz rounded.
function chirp(ctx, out, voice, t, f, dur, peak, rng) {
    const o = ctx.createOscillator(); o.type = voice.wave;
    const detune = 1 + (rng() * 2 - 1) * 0.04;
    o.frequency.setValueAtTime(f * detune * 1.12, t);
    o.frequency.exponentialRampToValueAtTime(f * detune * 0.92, t + dur);   // little downward gliss — speech-ish
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.value = voice.orc ? f * 4 : f * 6;
    lp.Q.value = 1.4;   // a hint of formant
    const g = env(ctx, out, t, peak, 0.008, dur);
    o.connect(lp); lp.connect(g);
    o.start(t); o.stop(t + dur + 0.03);
}

// Speak ONE word (the reveal is per-word, so this is the unit). Returns the sound's duration in
// seconds so a caller pacing itself off the babble could — the game paces off its own reveal.
export function speakWord(ctx, out, voice, word, variant = DEFAULT_VOICE_VARIANT, rng = Math.random) {
    const t0 = ctx.currentTime;
    const w = String(word).replace(/[^a-z']/gi, '');
    if (!w) return 0;
    const slow = voice.orc ? 1.25 : 1;   // orcs talk slower

    if (variant === 'classic') {
        // a chirp per letter, capped so long words stay inside the word cadence
        const letters = w.slice(0, 6).split('');
        const space = 0.038 * slow;
        letters.forEach((ch, i) => {
            const f = voice.base * letterFactor(ch) * (1 + (rng() * 2 - 1) * 0.03);
            chirp(ctx, out, voice, t0 + i * space, f, 0.05 * slow, 0.34, rng);
        });
        return letters.length * space + 0.05;
    }
    if (variant === 'babble') {
        // consonant blip + vowel body — one syllable per word, pitch from the word itself
        const f = voice.base * (0.92 + h01('w' + w.toLowerCase()) * 0.5);
        noiseBurst(ctx, out, t0, 0.016, f * 7, 2.2, 0.16);
        chirp(ctx, out, voice, t0 + 0.014, f, (0.085 + Math.min(0.05, w.length * 0.006)) * slow, 0.4, rng);
        return 0.12 * slow;
    }
    // 'hum' — a soft pentatonic note per word; melodic, least chattery
    const steps = [0, 3, 5, 7, 10];
    const semi = steps[hstr('h' + w.toLowerCase()) % steps.length];
    const f = voice.base * Math.pow(2, semi / 12) * (voice.orc ? 0.9 : 1.1);
    const dur = 0.1 * slow;
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 6.5;
    const lg = ctx.createGain(); lg.gain.value = f * 0.02;
    lfo.connect(lg); lg.connect(o.frequency);
    o.connect(env(ctx, out, t0, 0.32, 0.02, dur));
    o.start(t0); o.stop(t0 + dur + 0.03); lfo.start(t0); lfo.stop(t0 + dur);
    return dur;
}
