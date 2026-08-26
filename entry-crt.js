// entry-crt.js — the original CRT tune-in, isolated from the simulation graph.
// Loaded early but completely dormant until the visitor engages. That gives a cold desktop visit the exact
// settling snow / segmented signal bar / TUNING IN cadence while main.js downloads, without making an
// unengaged PageSpeed run execute WebGL or the simulation.

import { CRT } from './crt.js';

const FONT = {
    'A': '010101111101101', 'E': '111100110100111', 'G': '011100101101011',
    'I': '111010010010111', 'L': '100100100100111', 'M': '101111111101101',
    'N': '101111111111101', 'R': '110101110110101', 'T': '111010010010010',
    'U': '101101101101011', 'V': '101101101010010', 'S': '011100010001110',
    ' ': '000000000000000', '.': '000000000000010', '?': '110001010000010',
};
const textWidth = (str) => String(str).length * 4 - 1;
function drawText(ctx, str, x, y, color) {
    ctx.fillStyle = color;
    let cx = Math.round(x);
    for (const raw of String(str).toUpperCase()) {
        const glyph = FONT[raw] || FONT['?'];
        for (let i = 0; i < 15; i++) if (glyph[i] === '1') ctx.fillRect(cx + (i % 3), Math.round(y) + Math.floor(i / 3), 1, 1);
        cx += 4;
    }
}

let active = false, rafId = 0, startedAt = null, crt = null;
const out = document.getElementById('tv');
const game = document.createElement('canvas');
const ctx = game.getContext('2d');
let GW = 400, GH = 300;

function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    out.width = Math.max(1, Math.round(out.clientWidth * dpr));
    out.height = Math.max(1, Math.round(out.clientHeight * dpr));
    const aspect = out.clientWidth / Math.max(out.clientHeight, 1);
    GH = 300;
    GW = Math.max(320, Math.min(760, Math.round((GH * aspect) / 2) * 2));
    if (game.width !== GW || game.height !== GH) {
        game.width = GW; game.height = GH;
        ctx.imageSmoothingEnabled = false;
    }
}

function draw(t) {
    const bootTime = t - startedAt;
    const tune = Math.max(0, 1 - bootTime / 0.6);
    const img = ctx.createImageData(GW, GH);
    const amp = 16 + tune * 120;
    for (let i = 0; i < img.data.length; i += 4) {
        const v = Math.random() * amp;
        img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    ctx.fillStyle = `rgba(8,10,16,${0.9 - tune * 0.5})`;
    ctx.fillRect(0, 0, GW, GH);
    if (bootTime < 0.35) return;

    const cx = Math.round(GW / 2), cy = Math.round(GH / 2);
    const CELL = 6, GAP = 2, N = 16;
    const barW = N * CELL + (N - 1) * GAP, barH = 10;
    const bx = cx - Math.round(barW / 2), by = cy - 8;
    ctx.fillStyle = '#2a3350'; ctx.fillRect(bx - 3, by - 3, barW + 6, barH + 6);
    ctx.fillStyle = '#0c0f18'; ctx.fillRect(bx - 1, by - 1, barW + 2, barH + 2);
    const head = ((performance.now() / 1000 / 1.5) % 1) * (N + 5) - 3;
    for (let k = 0; k < N; k++) {
        const d = head - k;
        let col = '#141c18';
        if (d >= 0 && d < 4) col = d < 1 ? '#c8f0a0' : d < 2 ? '#7dd069' : '#4a8a3c';
        ctx.fillStyle = col;
        ctx.fillRect(bx + k * (CELL + GAP), by, CELL, barH);
    }
    const dots = '.'.repeat(1 + (Math.floor(t * 2.5) % 3));
    const lw = textWidth('TUNING IN...');
    drawText(ctx, `TUNING IN${dots}`, cx - Math.round(lw / 2), by + barH + 12, '#9aa0b4');
}

function frame(now) {
    if (!active) return;
    try {
        const t = now / 1000;
        draw(t);
        crt.render(t);
        rafId = requestAnimationFrame(frame);
    } catch (err) {
        stop();
        document.documentElement.classList.remove('game-booting');
        document.documentElement.classList.add('game-loading');
        console.error('entry CRT failed:', err);
    }
}

export function start() {
    if (active) return;
    resize();
    try { crt = new CRT(out, game); }
    catch (err) { console.error('entry CRT could not start:', err); return; }
    active = true;
    startedAt = performance.now() / 1000;
    window.__propagateEntryBootT0 = startedAt;
    window.addEventListener('resize', resize);
    document.documentElement.classList.remove('game-loading');
    document.documentElement.classList.add('game-booting');
    rafId = requestAnimationFrame(frame);
}

export function stop() {
    active = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    window.removeEventListener('resize', resize);
}

window.__propagateEntryLoader = { start, stop };
