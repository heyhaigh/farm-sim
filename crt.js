// crt.js — CRT/NTSC TV post-process. Takes the low-res 2D game canvas and draws it to a WebGL canvas.
//
// TWO looks, toggleable at runtime for A/B (window.RYFARMS.crt):
//   'classic' — the original clean tube: chromatic aberration, scanlines, RGB aperture mask, vignette.
//   'ntsc'    — an upgraded COMPOSITE-signal look (inspired by NTSCRT / ntsc-rs + libretro crt shaders,
//               ported to a single WebGL pass): band-limited (smeared) chroma bleed, animated dot crawl,
//               luma ringing, a Gaussian scanline beam, aperture mask, and a soft phosphor glow.
// Both are FLAT (no barrel/TV frame — immersive fullscreen), so screenToGame stays a linear map.
// Every effect is DISPLAY-ONLY; nothing here touches the sim or save.

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
    vUv = aPos * 0.5 + 0.5;
    gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

// ---- CLASSIC (the original look, kept for A/B) --------------------------------------------------
const FRAG_CLASSIC = `
precision mediump float;
uniform sampler2D uTex;
uniform vec2 uTexRes;
varying vec2 vUv;

void main() {
    vec2 uv = vUv;
    vec2 c = uv - 0.5;
    float ca = 0.0006 + 0.00225 * dot(c, c);
    vec3 col;
    col.r = texture2D(uTex, uv + vec2(ca, 0.0)).r;
    col.g = texture2D(uTex, uv).g;
    col.b = texture2D(uTex, uv - vec2(ca, 0.0)).b;
    col = (col - 0.5) * 1.08 + 0.5;
    float lum = dot(col, vec3(0.30, 0.59, 0.11));
    col = clamp(mix(vec3(lum), col, 1.20), 0.0, 1.0);
    float scan = 0.5 + 0.5 * sin(uv.y * uTexRes.y * 6.28318);
    col *= mix(0.62, 1.0, scan);
    float m = mod(gl_FragCoord.x, 3.0);
    vec3 mask = m < 1.0 ? vec3(1.0, 0.92, 0.92) : m < 2.0 ? vec3(0.92, 1.0, 0.92) : vec3(0.92, 0.92, 1.0);
    col *= mask;
    col *= 1.06;
    float r2 = dot(c, c);
    float vig = clamp(1.0 - 0.85 * pow(r2, 1.8), 0.0, 1.0);
    col *= mix(0.82, 1.0, vig);
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

// ---- NTSC (the upgraded composite look) --------------------------------------------------------
// Approximates an analog composite chain in ONE pass: luma stays sharp, chroma (I/Q) is band-limited by a
// short horizontal low-pass (colours SMEAR sideways), a subcarrier ripple animates the classic "dot crawl"
// at colour edges, luma gets a touch of unsharp RINGING, then the tube passes (scanline beam, aperture
// mask, phosphor glow, vignette). Every stage has a 0..1 strength uniform so it's fully dial-able live.
const FRAG_NTSC = `
precision mediump float;
uniform sampler2D uTex;
uniform vec2 uTexRes;
uniform float uTime;
uniform float uNtsc;    // composite strength (chroma bleed + dot crawl + ringing + fringing)
uniform float uScan;    // scanline beam depth
uniform float uMask;    // aperture-grille mask depth
uniform float uGlow;    // phosphor glow / bloom
uniform float uAberr;   // edge chromatic aberration
uniform float uVig;     // corner vignette
varying vec2 vUv;

const mat3 RGB2YIQ = mat3(0.299, 0.596, 0.211,   0.587, -0.274, -0.523,   0.114, -0.322, 0.312);
const mat3 YIQ2RGB = mat3(1.0,   1.0,    1.0,     0.956, -0.272, -1.106,   0.621, -0.647, 1.703);

// channel-split sample (edge chromatic aberration grows toward the tube corners)
vec3 tap(vec2 uv, float ca) {
    vec3 c;
    c.r = texture2D(uTex, uv + vec2(ca, 0.0)).r;
    c.g = texture2D(uTex, uv).g;
    c.b = texture2D(uTex, uv - vec2(ca, 0.0)).b;
    return c;
}

void main() {
    vec2 uv = vUv;
    vec2 cc = uv - 0.5;
    float texel = 1.0 / uTexRes.x;
    float ca = (0.0006 + 0.00225 * dot(cc, cc)) * uAberr;

    // sharp centre + a 5-tap horizontal neighbourhood for the chroma low-pass
    vec3 c0 = tap(uv, ca);
    float spread = texel * 2.2;
    vec3 yqL2 = RGB2YIQ * tap(uv - vec2(2.0 * spread, 0.0), ca);
    vec3 yqL1 = RGB2YIQ * tap(uv - vec2(1.0 * spread, 0.0), ca);
    vec3 yq0  = RGB2YIQ * c0;
    vec3 yqR1 = RGB2YIQ * tap(uv + vec2(1.0 * spread, 0.0), ca);
    vec3 yqR2 = RGB2YIQ * tap(uv + vec2(2.0 * spread, 0.0), ca);

    // chroma (I,Q) = band-limited (smeared) — this is the colour bleed. luma (Y) stays SHARP.
    vec2 iq = yqL2.yz * 0.12 + yqL1.yz * 0.24 + yq0.yz * 0.28 + yqR1.yz * 0.24 + yqR2.yz * 0.12;
    float Y = yq0.x;
    // luma ringing: a mild unsharp overshoot at horizontal edges (composite "ringing")
    Y += 0.35 * (Y - 0.5 * (yqL1.x + yqR1.x));
    // dot crawl: a subcarrier ripple that crawls upward over time, gated by chroma magnitude so flats stay clean
    float crawl = sin(uv.y * uTexRes.y * 3.14159 + gl_FragCoord.x * 0.5 + uTime * 6.0);
    iq *= 1.0 + 0.18 * crawl * clamp(length(iq) * 6.0, 0.0, 1.0);

    vec3 ntsc = YIQ2RGB * vec3(Y, iq);
    vec3 col = mix(c0, ntsc, clamp(uNtsc, 0.0, 1.0));   // uNtsc dials the whole composite look in/out

    // punchy tube: gentle contrast + saturation lift
    col = (col - 0.5) * 1.08 + 0.5;
    float lum = dot(col, vec3(0.30, 0.59, 0.11));
    col = clamp(mix(vec3(lum), col, 1.20), 0.0, 1.0);

    // Gaussian scanline BEAM (brighter lines bloom a touch wider — the crt-easymode/royale feel)
    float line = fract(uv.y * uTexRes.y) - 0.5;
    float bw = mix(0.10, 0.20, clamp(lum, 0.0, 1.0));         // beam half-width² grows with brightness
    float beam = exp(-(line * line) / (2.0 * bw));
    col *= mix(1.0, beam, uScan);
    col *= mix(1.0, 1.0 + uScan * 0.35, 1.0);                 // rebrighten for the scanline dimming

    // phosphor GLOW: a cheap 4-tap bright-pass added back additively
    vec3 g = texture2D(uTex, uv + vec2( 2.5 * texel, 0.0)).rgb
           + texture2D(uTex, uv - vec2( 2.5 * texel, 0.0)).rgb
           + texture2D(uTex, uv + vec2(0.0,  2.5 / uTexRes.y)).rgb
           + texture2D(uTex, uv - vec2(0.0,  2.5 / uTexRes.y)).rgb;
    g = max(g * 0.25 - 0.42, 0.0) * 1.8;
    col += g * uGlow;

    // RGB aperture-grille mask on output columns
    float m = mod(gl_FragCoord.x, 3.0);
    vec3 maskCol = m < 1.0 ? vec3(1.0, 0.7, 0.7) : m < 2.0 ? vec3(0.7, 1.0, 0.7) : vec3(0.7, 0.7, 1.0);
    col *= mix(vec3(1.0), maskCol, uMask);
    col *= 1.0 + uMask * 0.18;                                // rebrighten for the mask dimming

    // corner vignette
    float r2 = dot(cc, cc);
    float vig = clamp(1.0 - 0.85 * pow(r2, 1.8), 0.0, 1.0);
    col *= 1.0 - uVig * (1.0 - vig) * 0.9;

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

// tasteful default preset for the NTSC look — a starting point to tune from (all 0..1 except aberr which
// scales the classic ~1.0 amount). Tweak live via window.RYFARMS.crt.set('ntsc', 0.7) etc.
const NTSC_DEFAULTS = { ntsc: 0.55, scan: 0.5, mask: 0.5, glow: 0.25, aberr: 1.0, vig: 1.0 };

export class CRT {
    constructor(outputCanvas, sourceCanvas) {
        this.out = outputCanvas;
        this.src = sourceCanvas;
        this.mode = 'ntsc';                 // start on the upgraded look; toggle to 'classic' for A/B
        this.params = { ...NTSC_DEFAULTS };
        const gl = this.gl = outputCanvas.getContext('webgl', { antialias: false });

        const compile = (type, src) => {
            const s = gl.createShader(type);
            gl.shaderSource(s, src);
            gl.compileShader(s);
            if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
            return s;
        };
        const vs = compile(gl.VERTEX_SHADER, VERT);
        const buildProg = (fragSrc, uniformNames) => {
            const p = gl.createProgram();
            gl.attachShader(p, vs);
            gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fragSrc));
            gl.linkProgram(p);
            if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
            const u = {};
            for (const n of uniformNames) u[n] = gl.getUniformLocation(p, n);
            const aPos = gl.getAttribLocation(p, 'aPos');
            return { prog: p, u, aPos };
        };
        this.progClassic = buildProg(FRAG_CLASSIC, ['uTexRes']);
        this.progNtsc = buildProg(FRAG_NTSC, ['uTexRes', 'uTime', 'uNtsc', 'uScan', 'uMask', 'uGlow', 'uAberr', 'uVig']);

        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

        this.tex = gl.createTexture();
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.bindTexture(gl.TEXTURE_2D, this.tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);   // LINEAR so the chroma/glow taps interpolate smoothly
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        this._texW = 0; this._texH = 0;
    }

    // ---- live controls (wired to window.RYFARMS.crt) ----
    setMode(m) { this.mode = (m === 'classic') ? 'classic' : 'ntsc'; return this.mode; }
    toggle() { return this.setMode(this.mode === 'ntsc' ? 'classic' : 'ntsc'); }
    set(k, v) { if (k in this.params) this.params[k] = +v; return this.params; }
    get() { return { mode: this.mode, ...this.params }; }
    reset() { this.params = { ...NTSC_DEFAULTS }; return this.get(); }

    render(time) {
        const gl = this.gl;
        gl.viewport(0, 0, this.out.width, this.out.height);
        gl.bindTexture(gl.TEXTURE_2D, this.tex);
        const sw = this.src.width, sh = this.src.height;
        if (sw !== this._texW || sh !== this._texH) {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.src);
            this._texW = sw; this._texH = sh;
        } else {
            gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.src);
        }

        const P = this.mode === 'ntsc' ? this.progNtsc : this.progClassic;
        gl.useProgram(P.prog);
        gl.enableVertexAttribArray(P.aPos);
        gl.vertexAttribPointer(P.aPos, 2, gl.FLOAT, false, 0, 0);
        gl.uniform2f(P.u.uTexRes, sw, sh);
        if (this.mode === 'ntsc') {
            const p = this.params;
            gl.uniform1f(P.u.uTime, (time || 0));
            gl.uniform1f(P.u.uNtsc, p.ntsc);
            gl.uniform1f(P.u.uScan, p.scan);
            gl.uniform1f(P.u.uMask, p.mask);
            gl.uniform1f(P.u.uGlow, p.glow);
            gl.uniform1f(P.u.uAberr, p.aberr);
            gl.uniform1f(P.u.uVig, p.vig);
        }
        gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // Map a point on the output canvas to game-canvas pixel coordinates (linear — the look is flat).
    screenToGame(x, y) {
        const u = x / this.out.clientWidth;
        const v = y / this.out.clientHeight;
        return { x: u * this.src.width, y: v * this.src.height };
    }
}
