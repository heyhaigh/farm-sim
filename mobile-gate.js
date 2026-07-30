// mobile-gate.js — what a phone gets instead of the game.
//
// Propagate is a fullscreen mouse-and-keyboard sim, so a phone never boots it. But a link shared publicly is
// mostly opened on phones, and those visitors should meet PROPAGATE rather than a web page — so the notice is
// the REAL animated wordmark drawn through the REAL CRT shader onto the same #tv canvas.
//
// This is a SEPARATE ENTRY POINT, and that is the whole point (Codex #63-2). index.html imports either this
// or main.js, never both. Importing main.js on a phone would execute its module scope — measured at 96 image
// requests and ~2MB of art on production, plus the entire sim graph — for a device that renders no world.
// Here the dependency list is crt.js, pixel.js and title-anim.js; only the last fetches anything, and it is
// the one sheet actually on screen.

import { CRT } from './crt.js';
import { drawText, textWidth } from './pixel.js';
import { drawTitleArt } from './title-anim.js';
import { gateLayout, GATE_L1, GATE_L2 } from './gate-layout.js';

const out = document.getElementById('tv');
const game = document.createElement('canvas');
const ctx = game.getContext('2d');
const crt = new CRT(out, game);

let GW = 320, GH = 300;

function gateResize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    out.width = Math.max(1, Math.round(out.clientWidth * dpr));
    out.height = Math.max(1, Math.round(out.clientHeight * dpr));
    const L = gateLayout(out.clientWidth, out.clientHeight);
    GW = L.GW; GH = L.GH;
    if (game.width !== GW || game.height !== GH) {
        game.width = GW; game.height = GH;
        ctx.imageSmoothingEnabled = false;
    }
    return L;
}

window.addEventListener('resize', gateResize);
window.addEventListener('orientationchange', gateResize);
gateResize();

// Codex #63-3: `gate-live` retires the plain-text HTML fallback, so it must NOT be set until a frame has
// actually rendered. Setting it up front meant any exception in sizing, drawing or crt.render() left a
// permanently black page with the notice suppressed. Now the fallback stands until the gate proves itself,
// and a later failure puts it back.
let firstFrameDone = false;
function markLive() {
    if (firstFrameDone) return;
    firstFrameDone = true;
    document.documentElement.classList.add('gate-live');
}
function markFailed(err) {
    firstFrameDone = false;
    document.documentElement.classList.remove('gate-live');
    document.documentElement.classList.add('gate-fallback');
    if (!markFailed.logged) { markFailed.logged = true; console.error('mobile gate render failed:', err); }
}

function gateFrame(t) {
    requestAnimationFrame(gateFrame);
    try {
        const L = gateLayout(out.clientWidth, out.clientHeight);
        GW = L.GW; GH = L.GH;
        if (game.width !== GW || game.height !== GH) { game.width = GW; game.height = GH; ctx.imageSmoothingEnabled = false; }

        // the start screen's own backdrop: near-black with a soft green lift behind the letters
        ctx.fillStyle = '#05070a'; ctx.fillRect(0, 0, GW, GH);
        const vg = ctx.createRadialGradient(GW / 2, GH / 2, 0, GW / 2, GH / 2, GH * 0.7);
        vg.addColorStop(0, 'rgba(18,32,22,0.65)'); vg.addColorStop(1, 'rgba(5,7,10,0)');
        ctx.fillStyle = vg; ctx.fillRect(0, 0, GW, GH);

        const cx = GW / 2;
        const centred = (str, y, color, sc) => drawText(ctx, str, Math.round(cx - textWidth(str, sc) / 2), y, color, sc);
        const titleBottom = drawTitleArt(ctx, cx, L.titleTop, L.maxW, GW);
        centred(GATE_L1, titleBottom + L.d1, '#f0d060', L.s1);
        centred(GATE_L2, titleBottom + L.d2, '#8a8f9c', L.s2);

        // Codex #63-5: the shader's clock is in SECONDS — the game's frame loop divides the rAF timestamp
        // by 1000 before calling render. Passing raw milliseconds ran the dot-crawl 1000x too fast.
        crt.render((t || performance.now()) / 1000);
        markLive();
    } catch (err) {
        markFailed(err);
    }
}
requestAnimationFrame(gateFrame);
