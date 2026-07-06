// crt.js — CRT TV post-process. Takes the low-res 2D game canvas and draws it
// to a WebGL canvas with barrel curvature, scanlines, RGB aperture mask,
// vignette, chromatic aberration, flicker and noise.

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
    vUv = aPos * 0.5 + 0.5;
    gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

// CRT look: vibrant full color (no palette quantization), FLAT (no barrel/TV frame — the
// user wants immersive fullscreen), with the classic tube character back on top: horizontal
// scanlines, an RGB aperture-grille mask, edge chromatic aberration and a soft vignette (no flicker).
// Everything drawn to the source canvas — world AND the top/bottom UI bars — gets the effect.
const FRAG = `
precision mediump float;
uniform sampler2D uTex;
uniform vec2 uRes;        // output resolution
uniform vec2 uTexRes;     // game canvas resolution
uniform float uTime;
varying vec2 vUv;

void main() {
    vec2 uv = vUv;
    vec2 c = uv - 0.5;

    // chromatic aberration: split the channels, the offset grows toward the edges so the
    // text/GUI at the top and bottom fringes visibly like an old tube.
    float ca = 0.0012 + 0.0045 * dot(c, c);
    vec3 col;
    col.r = texture2D(uTex, uv + vec2(ca, 0.0)).r;
    col.g = texture2D(uTex, uv).g;
    col.b = texture2D(uTex, uv - vec2(ca, 0.0)).b;

    // gentle contrast + saturation lift for that punchy screen
    col = (col - 0.5) * 1.08 + 0.5;
    float lum = dot(col, vec3(0.30, 0.59, 0.11));
    col = clamp(mix(vec3(lum), col, 1.20), 0.0, 1.0);

    // horizontal scanlines keyed to output rows
    float scan = 0.5 + 0.5 * sin(uv.y * uRes.y * 3.14159 / 1.5);
    col *= mix(0.86, 1.0, scan);

    // RGB aperture-grille mask on output columns (subtle vertical stripes)
    float m = mod(gl_FragCoord.x, 3.0);
    vec3 mask = m < 1.0 ? vec3(1.0, 0.92, 0.92) : m < 2.0 ? vec3(0.92, 1.0, 0.92) : vec3(0.92, 0.92, 1.0);
    col *= mask;
    col *= 1.06;   // brighten back up for the mask+scanline dimming

    // soft corner vignette
    float r2 = dot(c, c);
    float vig = clamp(1.0 - 0.85 * pow(r2, 1.8), 0.0, 1.0);
    col *= mix(0.82, 1.0, vig);

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

export class CRT {
    constructor(outputCanvas, sourceCanvas) {
        this.out = outputCanvas;
        this.src = sourceCanvas;
        const gl = this.gl = outputCanvas.getContext('webgl', { antialias: false });

        const compile = (type, src) => {
            const s = gl.createShader(type);
            gl.shaderSource(s, src);
            gl.compileShader(s);
            if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
                throw new Error(gl.getShaderInfoLog(s));
            }
            return s;
        };
        const prog = this.prog = gl.createProgram();
        gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
        gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
        gl.linkProgram(prog);
        gl.useProgram(prog);

        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
        const aPos = gl.getAttribLocation(prog, 'aPos');
        gl.enableVertexAttribArray(aPos);
        gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

        this.tex = gl.createTexture();
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.bindTexture(gl.TEXTURE_2D, this.tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        this.uRes = gl.getUniformLocation(prog, 'uRes');
        this.uTexRes = gl.getUniformLocation(prog, 'uTexRes');
        this.uTime = gl.getUniformLocation(prog, 'uTime');
        this.uPal = [0, 1, 2, 3].map(i => gl.getUniformLocation(prog, `uPal${i}`));
        // default DMG green until a palette is supplied
        this.palette = [[0.06, 0.13, 0.06], [0.21, 0.38, 0.18], [0.52, 0.65, 0.17], [0.89, 0.95, 0.69]];
    }

    // palette: array of 4 [r,g,b] in 0..1, darkest -> lightest
    setPalette(palette) { if (palette) this.palette = palette; }

    render(time) {
        const gl = this.gl;
        gl.viewport(0, 0, this.out.width, this.out.height);
        gl.bindTexture(gl.TEXTURE_2D, this.tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.src);
        gl.uniform2f(this.uRes, this.out.width, this.out.height);
        gl.uniform2f(this.uTexRes, this.src.width, this.src.height);
        gl.uniform1f(this.uTime, time);
        for (let i = 0; i < 4; i++) if (this.uPal[i]) gl.uniform3fv(this.uPal[i], this.palette[i]);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // Map a point on the output canvas to game-canvas pixel coordinates.
    screenToGame(x, y) {
        const u = x / this.out.clientWidth;
        const v = y / this.out.clientHeight;
        return { x: u * this.src.width, y: v * this.src.height };
    }
}
