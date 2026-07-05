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
uniform vec3 uPal0;       // darkest
uniform vec3 uPal1;
uniform vec3 uPal2;
uniform vec3 uPal3;       // lightest
varying vec2 vUv;

// 4x4 ordered (Bayer) dither -> smooth GB-style ramps between the 4 shades
float bayer4x4(vec2 p) {
    int x = int(mod(p.x, 4.0));
    int y = int(mod(p.y, 4.0));
    int idx = x + y * 4;
    float b = 0.0;
    if (idx == 0) b = 0.0;  else if (idx == 1) b = 8.0;  else if (idx == 2) b = 2.0;  else if (idx == 3) b = 10.0;
    else if (idx == 4) b = 12.0; else if (idx == 5) b = 4.0;  else if (idx == 6) b = 14.0; else if (idx == 7) b = 6.0;
    else if (idx == 8) b = 3.0;  else if (idx == 9) b = 11.0; else if (idx == 10) b = 1.0; else if (idx == 11) b = 9.0;
    else if (idx == 12) b = 15.0; else if (idx == 13) b = 7.0; else if (idx == 14) b = 13.0; else b = 5.0;
    return b / 16.0;
}

void main() {
    vec2 uv = vUv;
    vec2 c = uv - 0.5;

    // sample the game frame and reduce to luminance (the DMG is monochrome)
    vec3 src = texture2D(uTex, uv).rgb;
    float lum = dot(src, vec3(0.30, 0.59, 0.11));

    // faint LCD scanline + corner vignette bias the luminance (stays on-palette)
    float scan = 0.94 + 0.06 * sin(uv.y * uTexRes.y * 3.14159 * 2.0);
    lum *= scan;
    float r2 = dot(c, c);
    float vig = clamp(1.0 - 1.05 * pow(r2, 1.7), 0.0, 1.0);
    lum *= mix(0.72, 1.0, vig);
    lum *= 0.99 + 0.01 * sin(uTime * 90.0);        // gentle flicker

    // ordered-dither then quantize to 4 shades
    float d = (bayer4x4(gl_FragCoord.xy) - 0.5) * 0.34;
    float q = clamp(floor((lum + d) * 3.0 + 0.5), 0.0, 3.0);
    vec3 pal = q < 0.5 ? uPal0 : (q < 1.5 ? uPal1 : (q < 2.5 ? uPal2 : uPal3));

    gl_FragColor = vec4(pal, 1.0);
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
        for (let i = 0; i < 4; i++) gl.uniform3fv(this.uPal[i], this.palette[i]);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // Map a point on the output canvas to game-canvas pixel coordinates.
    screenToGame(x, y) {
        const u = x / this.out.clientWidth;
        const v = y / this.out.clientHeight;
        return { x: u * this.src.width, y: v * this.src.height };
    }
}
