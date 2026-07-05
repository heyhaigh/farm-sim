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

const FRAG = `
precision mediump float;
uniform sampler2D uTex;
uniform vec2 uRes;        // output resolution
uniform vec2 uTexRes;     // game canvas resolution
uniform float uTime;
varying vec2 vUv;

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
    vec2 uv = vUv;

    // chromatic aberration, stronger at the edges
    vec2 c = uv - 0.5;
    float ab = dot(c, c) * 0.0035 + 0.0004;
    vec3 col;
    col.r = texture2D(uTex, uv + c * ab * 2.0).r;
    col.g = texture2D(uTex, uv).g;
    col.b = texture2D(uTex, uv - c * ab * 2.0).b;

    // scanlines follow the game canvas rows
    float scan = 0.82 + 0.18 * sin(uv.y * uTexRes.y * 3.14159 * 2.0);
    col *= scan;

    // RGB aperture stripes on output pixels
    float stripe = mod(gl_FragCoord.x, 3.0);
    vec3 mask = stripe < 1.0 ? vec3(1.05, 0.92, 0.92)
              : stripe < 2.0 ? vec3(0.92, 1.05, 0.92)
                             : vec3(0.92, 0.92, 1.05);
    col *= mask;

    // corner vignette — soft in the middle, heavy in the corners
    float r2 = dot(c, c);
    float vig = 1.0 - 1.15 * pow(r2, 1.6);
    vig = clamp(vig, 0.0, 1.0);
    col *= vig;

    // subtle rolling brightness band
    float band = 0.985 + 0.015 * sin(uv.y * 4.0 - uTime * 0.7);
    col *= band;

    // flicker + noise
    col *= 0.985 + 0.015 * sin(uTime * 110.0);
    col += (hash(uv * uTime) - 0.5) * 0.035;

    // slight brightness lift so scanlines don't crush it
    col *= 1.18;

    gl_FragColor = vec4(col, 1.0);
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
    }

    render(time) {
        const gl = this.gl;
        gl.viewport(0, 0, this.out.width, this.out.height);
        gl.bindTexture(gl.TEXTURE_2D, this.tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.src);
        gl.uniform2f(this.uRes, this.out.width, this.out.height);
        gl.uniform2f(this.uTexRes, this.src.width, this.src.height);
        gl.uniform1f(this.uTime, time);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // Map a point on the output canvas to game-canvas pixel coordinates.
    screenToGame(x, y) {
        const u = x / this.out.clientWidth;
        const v = y / this.out.clientHeight;
        return { x: u * this.src.width, y: v * this.src.height };
    }
}
