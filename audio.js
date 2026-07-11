// audio.js — procedural Web Audio for Ry Farms.
//
// Everything is synthesized (no audio assets): an N64-era town theme with a
// DIFFERENT song per season — spring's easy F-major stroll, summer's brighter
// G-major bounce, fall's warm D-minor amble, winter's sparse A-minor music
// box — plus a filtered-noise rain layer, noise-burst thunder on lightning,
// and a night chorus: several panned crickets in the green months, an owl or
// two on winter nights. A rooster (once the town hatches one) crows at dawn.
//
// The context can only start on a user gesture; main.js calls ensure() from
// the first pointerdown. Nothing here touches the sim — audio reads world
// state via update() and is deliberately non-deterministic (Math.random).

// One song per season. Each chord row: bass note, pad voicing, melody pool.
const SEASON_SONGS = [
    {   // SPRING — the original easy stroll (F major I-V-vi-IV)
        tempo: 92, lead: { type: 'square', gain: 0.055, vibrato: true },
        padGain: 0.045, bassGain: 0.30, pluckProb: 0.65, restProb: 0.42,
        chords: [
            { bass: 87.31, notes: [174.61, 220.00, 261.63, 329.63], melody: [349.23, 392.00, 440.00, 523.25, 659.26, 698.46] },
            { bass: 82.41, notes: [164.81, 196.00, 261.63, 329.63], melody: [329.63, 392.00, 523.25, 587.33, 659.26] },
            { bass: 73.42, notes: [146.83, 174.61, 220.00, 261.63], melody: [293.66, 349.23, 440.00, 523.25, 587.33] },
            { bass: 58.27, notes: [116.54, 174.61, 220.00, 293.66], melody: [293.66, 349.23, 440.00, 466.16, 587.33] },
        ],
    },
    {   // SUMMER — brighter, quicker G-major bounce
        tempo: 104, lead: { type: 'square', gain: 0.06, vibrato: true },
        padGain: 0.04, bassGain: 0.30, pluckProb: 0.8, restProb: 0.32,
        chords: [
            { bass: 98.00, notes: [196.00, 246.94, 293.66, 392.00], melody: [392.00, 440.00, 493.88, 587.33, 659.26] },
            { bass: 92.50, notes: [185.00, 220.00, 293.66, 369.99], melody: [440.00, 493.88, 587.33, 659.26, 739.99] },
            { bass: 82.41, notes: [164.81, 196.00, 246.94, 329.63], melody: [392.00, 493.88, 587.33, 659.26] },
            { bass: 65.41, notes: [130.81, 196.00, 261.63, 329.63], melody: [392.00, 440.00, 523.25, 659.26] },
        ],
    },
    {   // FALL — warm D-minor amble
        tempo: 84, lead: { type: 'triangle', gain: 0.075, vibrato: true },
        padGain: 0.05, bassGain: 0.28, pluckProb: 0.55, restProb: 0.45,
        chords: [
            { bass: 73.42, notes: [146.83, 174.61, 220.00, 293.66], melody: [293.66, 349.23, 392.00, 440.00, 523.25] },
            { bass: 58.27, notes: [116.54, 146.83, 174.61, 233.08], melody: [349.23, 392.00, 440.00, 523.25, 587.33] },
            { bass: 87.31, notes: [174.61, 220.00, 261.63, 349.23], melody: [349.23, 440.00, 523.25, 587.33] },
            { bass: 65.41, notes: [130.81, 164.81, 196.00, 261.63], melody: [293.66, 392.00, 440.00, 523.25] },
        ],
    },
    {   // WINTER — sparse A-minor music box, slow and high
        tempo: 70, lead: { type: 'sine', gain: 0.09, vibrato: false },
        padGain: 0.03, bassGain: 0.22, pluckProb: 0.35, restProb: 0.55,
        chords: [
            { bass: 55.00, notes: [110.00, 130.81, 164.81, 220.00], melody: [440.00, 523.25, 587.33, 659.26, 880.00] },
            { bass: 87.31, notes: [174.61, 220.00, 261.63], melody: [523.25, 587.33, 659.26, 698.46] },
            { bass: 65.41, notes: [130.81, 164.81, 196.00], melody: [440.00, 523.25, 659.26, 783.99] },
            { bass: 98.00, notes: [196.00, 246.94, 293.66], melody: [493.88, 587.33, 659.26, 880.00] },
        ],
    },
];

class FarmAudio {
    constructor() {
        this.ctx = null;
        this.enabled = true;        // the SND button state (persists while page lives)
        // per-channel volume + on/off, remembered across sessions (settings menu)
        const num = (k, d) => { try { const n = parseFloat(localStorage.getItem('ryf.' + k)); return isNaN(n) ? d : Math.max(0, Math.min(1, n)); } catch { return d; } };
        const on = (k) => { try { return localStorage.getItem('ryf.' + k) !== '0'; } catch { return true; } };
        this.musicVol = num('musicVol', 0.9);
        this.sfxVol = num('sfxVol', 0.85);
        this.musicOn = on('musicOn');
        this.sfxOn = on('sfxOn');
        this.master = null;
        this.sfxBus = null;         // all sound effects + ambience (chops, crickets, rain) -> master
        this.musicGain = null;      // day theme
        this.cricketGain = null;    // night ambience (crickets or owls)
        this.rainGain = null;       // weather layer
        this.nextBar = 0;
        this.barIdx = 0;
        this.timer = null;
        this.lastFlash = 0;
        this.rainTarget = 0;
        this.nightMix = 0;          // 0 = day (music), 1 = night (ambience)
        this.season = 0;
        this.wasNight = false;
        this.hasRooster = false;
        this.crickets = [];         // panned chirp voices
        this.owls = [];             // winter-night hooters
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

        // the SFX bus scales every non-music sound (its slider); ambience + per-sound stages feed it
        this.sfxBus = this.ctx.createGain(); this.sfxBus.gain.value = this.sfxOn ? this.sfxVol : 0;
        this.sfxBus.connect(this.master);

        this.musicGain = this.ctx.createGain(); this.musicGain.gain.value = this.musicOn ? this.musicVol : 0;
        this.musicGain.connect(this.master);
        this.cricketGain = this.ctx.createGain(); this.cricketGain.gain.value = 0;
        this.cricketGain.connect(this.sfxBus);
        this.#startRain();

        const t = this.ctx.currentTime;
        this.nextBar = t + 0.1;
        // a small field of crickets, spread across the stereo image, each on its own clock
        this.crickets = [-0.7, -0.25, 0.3, 0.75].map(pan => ({
            next: t + Math.random() * 1.5, pan,
            f: 3900 + Math.random() * 900,
            out: this.#panned(this.cricketGain, pan),
        }));
        this.owls = [-0.5, 0.55].map(pan => ({
            next: t + 2 + Math.random() * 5, pan,
            f: 300 + Math.random() * 70,
            out: this.#panned(this.cricketGain, pan),
        }));
        // lookahead scheduler for the music + night chorus
        this.timer = setInterval(() => this.#schedule(), 120);
    }

    #panned(dest, pan) {
        if (!this.ctx.createStereoPanner) return dest;
        const p = this.ctx.createStereoPanner();
        p.pan.value = pan;
        p.connect(dest);
        return p;
    }

    toggle() {
        this.enabled = !this.enabled;
        if (this.ctx) this.master.gain.linearRampToValueAtTime(this.enabled ? 0.8 : 0, this.ctx.currentTime + 0.15);
        return this.enabled;
    }

    // ---- settings: music + SFX channel volume (persisted) ----------------------
    #save(k, v) { try { localStorage.setItem('ryf.' + k, String(v)); } catch { /* private mode - fine */ } }
    musicLevel() { return this.musicOn ? this.musicVol : 0; }
    #applyMusic() { if (this.musicGain && this.ctx) this.musicGain.gain.setTargetAtTime(this.musicLevel() * (1 - this.nightMix), this.ctx.currentTime, 0.08); }
    #applySfx() { if (this.sfxBus && this.ctx) this.sfxBus.gain.setTargetAtTime(this.sfxOn ? this.sfxVol : 0, this.ctx.currentTime, 0.08); }
    setMusicVolume(v) { this.musicVol = Math.max(0, Math.min(1, v)); this.#save('musicVol', this.musicVol); this.#applyMusic(); }
    setSfxVolume(v) { this.sfxVol = Math.max(0, Math.min(1, v)); this.#save('sfxVol', this.sfxVol); this.#applySfx(); }
    toggleMusic() { this.musicOn = !this.musicOn; this.#save('musicOn', this.musicOn ? '1' : '0'); this.#applyMusic(); return this.musicOn; }
    toggleSfx() { this.sfxOn = !this.sfxOn; this.#save('sfxOn', this.sfxOn ? '1' : '0'); this.#applySfx(); return this.sfxOn; }

    // called every frame with sim state
    update({ isNight, weather, flash, season = 0, hasRooster = false, building = false }) {
        this.hasRooster = hasRooster;
        if (!this.ctx) { this.wasNight = isNight; this.season = season; return; }
        const t = this.ctx.currentTime;
        // (structure-raising hammer is now emitted PER FARMER by the renderer via workSfx(), so it's
        //  positioned in the stereo field and fades with camera distance — see maybeWorkSfx in main.js)
        this.season = season;
        // dawn: the rooster crow is disabled for now — the synth never read as a real crow, so
        // it's pulled from the dawn cue. (#crow()/playCrow() are left dormant below for a future
        // rework; re-enable by restoring the call: if (this.wasNight && !isNight && hasRooster) this.#crow();)
        this.wasNight = isNight;
        // day/night crossfade: music out, night chorus in (~4s)
        const target = isNight ? 1 : 0;
        this.nightMix += (target - this.nightMix) * 0.01;
        this.musicGain.gain.setTargetAtTime(this.musicLevel() * (1 - this.nightMix), t, 0.5);
        this.cricketGain.gain.setTargetAtTime(0.5 * this.nightMix, t, 0.5);
        // rain/wind bed by weather (blizzard drives the noise bed as howling wind)
        this.rainTarget = weather === 'storm' ? 0.24 : weather === 'blizzard' ? 0.2 : weather === 'rain' ? 0.13 : 0;
        this.rainGain.gain.setTargetAtTime(this.rainTarget, t, 1.2);
        // thunder on the rising edge of a lightning flash (blizzard gusts stay below the 0.9 threshold)
        if (flash > 0.9 && this.lastFlash <= 0.9) this.#thunder();
        this.lastFlash = flash;
    }

    // ---- music ----------------------------------------------------------------

    #schedule() {
        const t = this.ctx.currentTime;
        const song = SEASON_SONGS[this.season] || SEASON_SONGS[0];
        const bar = (60 / song.tempo) * 4;
        while (this.nextBar < t + 0.4) {
            if (this.nightMix < 0.85) this.#scheduleBar(this.nextBar, song, this.barIdx);
            this.nextBar += bar;
            this.barIdx = (this.barIdx + 1) % song.chords.length;
        }
        // night chorus: crickets in the green months, owls on winter nights
        const winter = this.season === 3;
        if (this.nightMix > 0.15) {
            if (!winter) for (const v of this.crickets) {
                while (v.next < t + 0.4) { this.#chirp(v.next, v); v.next += 0.3 + Math.random() * 1.1; }
            }
            if (winter) for (const v of this.owls) {
                while (v.next < t + 0.4) { this.#hoot(v.next, v); v.next += 4 + Math.random() * 7; }
            }
        }
        // idle voices drift forward so they don't burst on the next nightfall
        for (const v of [...this.crickets, ...this.owls]) if (v.next < t) v.next = t + Math.random() * 2;
    }

    #scheduleBar(t0, song, idx) {
        const ch = song.chords[idx % song.chords.length];
        const beat = 60 / song.tempo;
        const bar = beat * 4;
        // bass: round sine, on 1 and 3
        this.#tone({ t: t0, f: ch.bass, dur: beat * 1.6, type: 'sine', gain: song.bassGain, attack: 0.02, out: this.musicGain });
        this.#tone({ t: t0 + beat * 2, f: ch.bass * (idx === 3 ? 1.5 : 1), dur: beat * 1.4, type: 'sine', gain: song.bassGain * 0.8, attack: 0.02, out: this.musicGain });
        // pad: slow-attack triangles, one soft chord per bar
        for (const f of ch.notes) {
            this.#tone({ t: t0, f, dur: bar * 0.96, type: 'triangle', gain: song.padGain, attack: bar * 0.25, out: this.musicGain });
        }
        // marimba-ish comp plucks on the off-beats
        for (let k = 0; k < 4; k++) {
            if (Math.random() > song.pluckProb) continue;
            const f = ch.notes[1 + Math.floor(Math.random() * (ch.notes.length - 1))];
            this.#pluck(t0 + beat * (k + 0.5), f, 0.10);
        }
        // lead: a lazy random walk on the chord's melody pool
        const pool = ch.melody;
        let mi = Math.floor(Math.random() * pool.length);
        for (let k = 0; k < 8; k++) {
            if (Math.random() < song.restProb) continue;          // rests keep it breezy
            mi = Math.max(0, Math.min(pool.length - 1, mi + (Math.floor(Math.random() * 3) - 1)));
            const dur = Math.random() < 0.25 ? beat : beat * 0.5;
            this.#tone({ t: t0 + beat * 0.5 * k, f: pool[mi], dur, type: song.lead.type, gain: song.lead.gain, attack: 0.015, vibrato: song.lead.vibrato, out: this.musicGain });
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
        src.connect(hp); hp.connect(lp); lp.connect(this.rainGain); this.rainGain.connect(this.sfxBus);
        src.start();
    }

    // One hammer knock on wood: a short bandpass-noise thwack over a low woody thud. Called on a
    // steady rhythm from update() while any structure is being raised.
    // a per-sound output stage: a gain (proximity volume) into a stereo panner (screen position)
    #workOut(pan, vol) {
        const g = this.ctx.createGain(); g.gain.value = vol;
        g.connect(this.#panned(this.sfxBus, Math.max(-1, Math.min(1, pan))));
        return g;
    }

    // A metallic HAMMER on wood — raising a house/fence/well/structure.
    #hammer(pan = 0, vol = 1) {
        const ctx = this.ctx, t = ctx.currentTime, out = this.#workOut(pan, vol);
        const src = ctx.createBufferSource(); src.buffer = this.#noiseBuffer(0.09);
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1500; bp.Q.value = 1.1;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.12, t + 0.004);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
        src.connect(bp); bp.connect(g); g.connect(out);
        src.start(t); src.stop(t + 0.1);
        const o = ctx.createOscillator(); o.type = 'triangle';
        o.frequency.setValueAtTime(190, t); o.frequency.exponentialRampToValueAtTime(85, t + 0.08);
        const og = ctx.createGain();
        og.gain.setValueAtTime(0.08, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
        o.connect(og); og.connect(out);
        o.start(t); o.stop(t + 0.1);
    }

    // A woody CHOP — an axe biting a tree/stump. Duller + lower than the hammer.
    #chop(pan = 0, vol = 1) {
        const ctx = this.ctx, t = ctx.currentTime, out = this.#workOut(pan, vol);
        const src = ctx.createBufferSource(); src.buffer = this.#noiseBuffer(0.06);
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 780; bp.Q.value = 0.8;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.21, t + 0.003);   // a touch louder now proximity gates it
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
        src.connect(bp); bp.connect(g); g.connect(out);
        src.start(t); src.stop(t + 0.07);
        const o = ctx.createOscillator(); o.type = 'sine';
        o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(66, t + 0.08);
        const og = ctx.createGain();
        og.gain.setValueAtTime(0.155, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
        o.connect(og); og.connect(out);
        o.start(t); o.stop(t + 0.1);
    }

    // Public one-shot for a farmer's chop/hammer, placed in the stereo field (pan -1..1) at a
    // proximity volume (0..1). Driven per-frame by the renderer, which knows each farmer's screen pos.
    workSfx(kind, pan = 0, vol = 1) {
        if (!this.ctx || !this.enabled || vol <= 0.02) return;
        if (kind === 'chop') this.#chop(pan, Math.min(1, vol));
        else this.#hammer(pan, Math.min(1, vol));
    }

    // #98 Moments — a short musical STING for a profound beat. triumph = bright ascending arpeggio;
    // somber = a low minor fall; neutral = a soft two-note chime. Called by the Moments layer (display-only).
    moment(tone = 'triumph') {
        if (!this.ctx || !this.enabled) return;
        this.ensure();
        const t0 = this.ctx.currentTime + 0.02;
        // note sets (Hz). triumph rises through a major chord; somber falls a minor third; neutral a gentle 5th.
        const notes = tone === 'somber' ? [[392.0, 0], [311.1, 0.16]]
            : tone === 'neutral' ? [[587.3, 0], [880.0, 0.12]]
            : [[523.3, 0], [659.3, 0.09], [784.0, 0.18], [1046.5, 0.27]];   // triumph: C5 E5 G5 C6
        const wave = tone === 'somber' ? 'sine' : 'triangle';
        const peak = tone === 'somber' ? 0.16 : 0.14;
        for (const [f, off] of notes) {
            const t = t0 + off;
            const o = this.ctx.createOscillator(); o.type = wave; o.frequency.value = f;
            const g = this.ctx.createGain();
            g.gain.setValueAtTime(0.0001, t);
            g.gain.linearRampToValueAtTime(peak, t + 0.02);
            g.gain.exponentialRampToValueAtTime(0.0001, t + (tone === 'somber' ? 0.7 : 0.42));
            o.connect(g); g.connect(this.sfxBus);
            o.start(t); o.stop(t + 0.9);
        }
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
        src.connect(lp); lp.connect(g); g.connect(this.sfxBus);
        src.start(t); src.stop(t + 4.4);
    }

    #chirp(t0, voice) {
        // one cricket: a fast trill of 3-5 high sine pips, at this voice's pitch + pan
        const f = voice.f + Math.random() * 150;
        const pips = 3 + Math.floor(Math.random() * 3);
        for (let k = 0; k < pips; k++) {
            const t = t0 + k * 0.028;
            const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
            const g = this.ctx.createGain();
            g.gain.setValueAtTime(0.0001, t);
            g.gain.linearRampToValueAtTime(0.07 + Math.random() * 0.04, t + 0.006);
            g.gain.exponentialRampToValueAtTime(0.0001, t + 0.024);
            o.connect(g); g.connect(voice.out);
            o.start(t); o.stop(t + 0.03);
        }
    }

    #hoot(t0, voice) {
        // an owl: hoo... hoo-hoo — soft round sines with a little downward bend
        const pattern = [[0, 0.32], [0.55, 0.2], [0.82, 0.28]];
        for (const [off, dur] of pattern) {
            const t = t0 + off;
            const o = this.ctx.createOscillator(); o.type = 'sine';
            o.frequency.setValueAtTime(voice.f * 1.06, t);
            o.frequency.exponentialRampToValueAtTime(voice.f * 0.94, t + dur);
            const g = this.ctx.createGain();
            g.gain.setValueAtTime(0.0001, t);
            g.gain.linearRampToValueAtTime(0.16, t + 0.05);
            g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
            o.connect(g); g.connect(voice.out);
            o.start(t); o.stop(t + dur + 0.05);
        }
    }

    // debug/preview hook — RYFARMS.audio.playCrow() triggers a crow on demand
    playCrow() { if (this.ctx) this.#crow(); }

    // cock-a-doodle-doo: the real thing is bright and reedy with vocal-tract FORMANTS, a WARBLE on
    // the long notes, and a raspy attack — not a clean tone. Each syllable = detuned saws + a square
    // (nasal harmonics) fed through three parallel bandpass formants, warbled by an LFO on the
    // sustained notes, with a filtered noise rasp on the onset. Contour: two short calls, a rising
    // warbled note, then the long falling finish.
    #crow() {
        const ctx = this.ctx, t0 = ctx.currentTime + 0.4;   // let the dawn light land first
        // "cock-a-DOO-dle-DOOO" — FIVE articulated syllables with clear gaps between them (the
        // rhythm is what makes it read as a rooster). The "doo-dle" is an up-then-down pair, and the
        // finish is one long note that starts high and slides down with a warble. Bright & piercing.
        const syll = [
            { off: 0.00, f0: 430, f1: 470, dur: 0.11, warble: 0, gain: 0.20 },   // cock
            { off: 0.17, f0: 520, f1: 545, dur: 0.09, warble: 0, gain: 0.20 },   // a
            { off: 0.31, f0: 640, f1: 740, dur: 0.14, warble: 0, gain: 0.24 },   // DOO  (up)
            { off: 0.49, f0: 570, f1: 545, dur: 0.10, warble: 0, gain: 0.20 },   // dle  (down)
            { off: 0.63, f0: 780, f1: 430, dur: 0.60, warble: 10, gain: 0.26 },  // DOOO (long, sliding down, warbled)
        ];
        // vocal-tract formants pushed BRIGHT — a cockerel's crow is piercing, energy up past 3 kHz
        const formants = [[720, 5, 1.0], [1550, 7, 0.85], [2900, 8, 0.6], [3900, 9, 0.32]];
        const P = 1.4;   // pitch multiplier — a cockerel crows high and shrill
        for (const s of syll) {
            const t = t0 + s.off, f0 = s.f0 * P, f1 = s.f1 * P;
            const mix = ctx.createGain();
            const oscs = [];
            // a reedy, buzzy stack: two detuned saws + two detuned squares (strong odd-harmonic buzz)
            for (const [type, det] of [['sawtooth', -9], ['sawtooth', 9], ['square', -5], ['square', 6]]) {
                const o = ctx.createOscillator(); o.type = type; o.detune.value = det;
                o.frequency.setValueAtTime(f0, t);
                o.frequency.exponentialRampToValueAtTime(Math.max(90, f1), t + s.dur * 0.85);
                o.connect(mix); oscs.push(o);
            }
            // warble/yodel on the long finish — the rooster's characteristic waver
            if (s.warble) {
                const lfo = ctx.createOscillator(); lfo.type = 'triangle'; lfo.frequency.value = s.warble;
                const lg = ctx.createGain(); lg.gain.value = f0 * 0.055;
                lfo.connect(lg); for (const o of oscs) lg.connect(o.frequency);
                lfo.start(t); lfo.stop(t + s.dur + 0.05);
            }
            const g = ctx.createGain();
            g.gain.setValueAtTime(0.0001, t);
            g.gain.linearRampToValueAtTime(s.gain, t + 0.01);   // sharp attack
            g.gain.setValueAtTime(s.gain, t + s.dur * 0.55);
            g.gain.exponentialRampToValueAtTime(0.0001, t + s.dur);
            for (const [ff, q, amp] of formants) {
                const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = ff; bp.Q.value = q;
                const fa = ctx.createGain(); fa.gain.value = amp;
                mix.connect(bp); bp.connect(fa); fa.connect(g);
            }
            g.connect(this.sfxBus);
            for (const o of oscs) { o.start(t); o.stop(t + s.dur + 0.05); }
            // a rasp of filtered noise right on the onset (the throaty crack of each squawk)
            const nlen = Math.min(0.05, s.dur * 0.32);
            const ns = ctx.createBufferSource(); ns.buffer = this.#noiseBuffer(nlen);
            const nbp = ctx.createBiquadFilter(); nbp.type = 'bandpass'; nbp.frequency.value = 1900; nbp.Q.value = 0.9;
            const ng = ctx.createGain();
            ng.gain.setValueAtTime(s.gain * 0.55, t);
            ng.gain.exponentialRampToValueAtTime(0.0001, t + nlen);
            ns.connect(nbp); nbp.connect(ng); ng.connect(this.sfxBus);
            ns.start(t); ns.stop(t + nlen + 0.02);
        }
    }
}

export const audio = new FarmAudio();
