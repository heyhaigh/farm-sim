// audio.js — procedural Web Audio for Ry Farms.
//
// Everything is synthesized (no audio assets): an N64-era town theme — soft
// square-wave lead with vibrato over marimba-ish plucks, warm triangle pads
// and a round bass on a I–V–vi–IV loop — plus a filtered-noise rain layer,
// noise-burst thunder when lightning strikes, and cricket chirps that take
// over when the music fades out for the night.
//
// The context can only start on a user gesture; main.js calls ensure() from
// the first pointerdown. Nothing here touches the sim — audio reads world
// state via update() and is deliberately non-deterministic (Math.random).

const TEMPO = 92;
const BEAT = 60 / TEMPO;
const BAR = BEAT * 4;

// F major-ish progression, one chord per bar: Fmaj7  C/E  Dm7  Bbmaj7
const CHORDS = [
    { bass: 87.31, notes: [174.61, 220.00, 261.63, 329.63] },   // F2 | F3 A3 C4 E4
    { bass: 82.41, notes: [164.81, 196.00, 261.63, 329.63] },   // E2 | E3 G3 C4 E4
    { bass: 73.42, notes: [146.83, 174.61, 220.00, 261.63] },   // D2 | D3 F3 A3 C4
    { bass: 58.27, notes: [116.54, 174.61, 220.00, 293.66] },   // Bb1| Bb2 F3 A3 D4
];
// melody pool per chord: pentatonic-friendly tones an octave up
const MELODY = [
    [349.23, 392.00, 440.00, 523.25, 659.26, 698.46],
    [329.63, 392.00, 523.25, 587.33, 659.26],
    [293.66, 349.23, 440.00, 523.25, 587.33],
    [293.66, 349.23, 440.00, 466.16, 587.33],
];

class FarmAudio {
    constructor() {
        this.ctx = null;
        this.enabled = true;        // the SND button state (persists while page lives)
        this.master = null;
        this.musicGain = null;      // day theme
        this.cricketGain = null;    // night ambience
        this.rainGain = null;       // weather layer
        this.nextBar = 0;
        this.barIdx = 0;
        this.timer = null;
        this.lastFlash = 0;
        this.rainTarget = 0;
        this.nightMix = 0;          // 0 = day (music), 1 = night (crickets)
        this.nextChirp = 0;
    }

    // create + start the context (must be called from a user gesture)
    ensure() {
        if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.enabled ? 0.8 : 0;
        this.master.connect(this.ctx.destination);

        this.musicGain = this.ctx.createGain(); this.musicGain.gain.value = 0.9;
        this.musicGain.connect(this.master);
        this.cricketGain = this.ctx.createGain(); this.cricketGain.gain.value = 0;
        this.cricketGain.connect(this.master);
        this.#startRain();
        this.nextBar = this.ctx.currentTime + 0.1;
        this.nextChirp = this.ctx.currentTime + 0.5;
        // lookahead scheduler for the music + crickets
        this.timer = setInterval(() => this.#schedule(), 120);
    }

    toggle() {
        this.enabled = !this.enabled;
        if (this.ctx) this.master.gain.linearRampToValueAtTime(this.enabled ? 0.8 : 0, this.ctx.currentTime + 0.15);
        return this.enabled;
    }

    // called every frame with sim state
    update({ isNight, weather, flash }) {
        if (!this.ctx) return;
        const t = this.ctx.currentTime;
        // day/night crossfade: music out, crickets in (~4s)
        const target = isNight ? 1 : 0;
        this.nightMix += (target - this.nightMix) * 0.01;
        this.musicGain.gain.setTargetAtTime(0.9 * (1 - this.nightMix), t, 0.5);
        this.cricketGain.gain.setTargetAtTime(0.5 * this.nightMix, t, 0.5);
        // rain bed by weather
        this.rainTarget = weather === 'storm' ? 0.24 : weather === 'rain' ? 0.13 : 0;
        this.rainGain.gain.setTargetAtTime(this.rainTarget, t, 1.2);
        // thunder on the rising edge of a lightning flash
        if (flash > 0.9 && this.lastFlash <= 0.9) this.#thunder();
        this.lastFlash = flash;
    }

    // ---- music ----------------------------------------------------------------

    #schedule() {
        const t = this.ctx.currentTime;
        while (this.nextBar < t + 0.4) {
            if (this.nightMix < 0.85) this.#scheduleBar(this.nextBar, this.barIdx);
            this.nextBar += BAR;
            this.barIdx = (this.barIdx + 1) % CHORDS.length;
        }
        while (this.nextChirp < t + 0.4) {
            if (this.nightMix > 0.15) this.#chirp(this.nextChirp);
            this.nextChirp += 0.35 + Math.random() * 0.9;
        }
    }

    #scheduleBar(t0, idx) {
        const ch = CHORDS[idx];
        // bass: round sine, on 1 and 3
        this.#tone({ t: t0, f: ch.bass, dur: BEAT * 1.6, type: 'sine', gain: 0.30, attack: 0.02, out: this.musicGain });
        this.#tone({ t: t0 + BEAT * 2, f: ch.bass * (idx === 3 ? 1.5 : 1), dur: BEAT * 1.4, type: 'sine', gain: 0.24, attack: 0.02, out: this.musicGain });
        // pad: slow-attack triangles, one soft chord per bar
        for (const f of ch.notes) {
            this.#tone({ t: t0, f, dur: BAR * 0.96, type: 'triangle', gain: 0.045, attack: BAR * 0.25, out: this.musicGain });
        }
        // marimba-ish comp plucks on the off-beats
        for (let k = 0; k < 4; k++) {
            if (Math.random() < 0.35) continue;
            const f = ch.notes[1 + Math.floor(Math.random() * (ch.notes.length - 1))];
            this.#pluck(t0 + BEAT * (k + 0.5), f, 0.10);
        }
        // lead: N64 square with vibrato, a lazy random walk on the chord's melody pool
        const pool = MELODY[idx];
        let mi = Math.floor(Math.random() * pool.length);
        for (let k = 0; k < 8; k++) {
            if (Math.random() < 0.42) continue;                       // rests keep it breezy
            mi = Math.max(0, Math.min(pool.length - 1, mi + (Math.floor(Math.random() * 3) - 1)));
            const dur = Math.random() < 0.25 ? BEAT : BEAT * 0.5;
            this.#tone({ t: t0 + BEAT * 0.5 * k, f: pool[mi], dur, type: 'square', gain: 0.055, attack: 0.015, vibrato: true, out: this.musicGain });
        }
    }

    #tone({ t, f, dur, type, gain, attack, vibrato, out }) {
        const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = f;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(gain, t + attack);
        g.gain.setValueAtTime(gain, t + Math.max(attack, dur * 0.6));
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        if (vibrato) {   // gentle 5.5Hz pitch wobble — the N64 lead giveaway
            const lfo = this.ctx.createOscillator(); lfo.frequency.value = 5.5;
            const lg = this.ctx.createGain(); lg.gain.value = f * 0.006;
            lfo.connect(lg); lg.connect(o.frequency);
            lfo.start(t + 0.08); lfo.stop(t + dur);
        }
        o.connect(g); g.connect(out);
        o.start(t); o.stop(t + dur + 0.05);
    }

    #pluck(t, f, gain) {
        const o = this.ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f * 2;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(gain, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
        o.connect(g); g.connect(this.musicGain);
        o.start(t); o.stop(t + 0.25);
    }

    // ---- ambience ---------------------------------------------------------------

    #noiseBuffer(seconds) {
        const len = Math.floor(this.ctx.sampleRate * seconds);
        const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        return buf;
    }

    #startRain() {
        const src = this.ctx.createBufferSource();
        src.buffer = this.#noiseBuffer(2.7); src.loop = true;
        const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 350;
        const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1100;
        this.rainGain = this.ctx.createGain(); this.rainGain.gain.value = 0;
        src.connect(hp); hp.connect(lp); lp.connect(this.rainGain); this.rainGain.connect(this.master);
        src.start();
    }

    #thunder() {
        const t = this.ctx.currentTime + 0.1 + Math.random() * 0.5;   // travel delay after the flash
        const src = this.ctx.createBufferSource();
        src.buffer = this.#noiseBuffer(4);
        const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass';
        lp.frequency.setValueAtTime(900, t);
        lp.frequency.exponentialRampToValueAtTime(80, t + 2.8);       // rumble rolls off into the distance
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.55, t + 0.04);               // the crack
        g.gain.exponentialRampToValueAtTime(0.0001, t + 2.8 + Math.random() * 1.2);
        src.connect(lp); lp.connect(g); g.connect(this.master);
        src.start(t); src.stop(t + 4.4);
    }

    #chirp(t0) {
        // one cricket: a fast trill of 3-5 high sine pips
        const f = 4100 + Math.random() * 600;
        const pips = 3 + Math.floor(Math.random() * 3);
        for (let k = 0; k < pips; k++) {
            const t = t0 + k * 0.028;
            const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
            const g = this.ctx.createGain();
            g.gain.setValueAtTime(0.0001, t);
            g.gain.linearRampToValueAtTime(0.10 + Math.random() * 0.05, t + 0.006);
            g.gain.exponentialRampToValueAtTime(0.0001, t + 0.024);
            o.connect(g); g.connect(this.cricketGain);
            o.start(t); o.stop(t + 0.03);
        }
    }
}

export const audio = new FarmAudio();
